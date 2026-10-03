# Autoplay rework — design

Date: 2026-10-03 · Branch: `feat/autoplay-rework` · Status: approved direction (approach A)

## Goal

Make Bread's autoplay feel instant and learn from listeners:

1. **Speed & reliability** — skipping an autoplay track never produces seconds of silence; retrieval runs in parallel; better search source; silent failures become visible.
2. **Persistent profile** — session seeds survive bot restarts; taste signals (likes, dislikes, strong skips, recent plays) persist for days in SQLite; the profile can be rebuilt from play history.
3. **Feedback & control** — 👍 / 👎 on the current track, an "Up next" preview and a reroll, consistently in Discord, the dashboard and the Discord Activity.
4. **Last.fm** — `track.getSimilar` / `artist.getSimilar` as an additional candidate source.

Success criteria:

- Skip of an autoplay track → next track starts in < 1.5 s when the pool has candidates (today: 5–15 s).
- No autoplay pick repeats a track played in the guild in the last 3 days (manual replays excepted).
- When autoplay cannot find anything, the text channel and dashboard say so.
- The public API of `src/music/autoplay.js` stays compatible; existing tests keep passing (adapted only where behaviour intentionally changes).

## Findings that shape the design

- `recordAutoplaySkip` calls `clearAutoplayPrefetch`, so every skip triggers a full recompute: resolve YouTube id → Radio Mix → 3 searches → Gemini plan → 6 discovery searches → Gemini ranking, mostly sequential.
- Production Lavalink runs the youtube-plugin with the `MUSIC` client: `ytmsearch:` works (≈0.8 s) and returns clean `Artist | Title` metadata, where `ytsearch:` returns lyric videos and reuploads.
- Last.fm `track.getSimilar` for *Linkin Park – Lost* returns relevant results in ≈0.7 s (Papa Roach, Limp Bizkit, Slipknot…). `LASTFM_API_KEY` exists locally but **not** in the production `.env`.
- Gemini "too few valid artists" counts as a provider failure and opens the 20 s circuit breaker, which also disables ranking.
- Genre-radio backup candidates are taken `slice(0, 4)` without sorting by score.
- `queueEnd` with nothing found is silent.

## Architecture

`src/music/autoplay.js` becomes a thin orchestrator keeping its exported API. New focused modules:

```
src/music/autoplay/
  normalize.js      track normalization, keys, artist extraction, term lists (moved from autoplay.js)
  scoring.js        scoreCandidate, pickCandidateLocally (moved, takes a context incl. profile signals)
  sources.js        candidate sources with a common interface + parallel runner
  lastfm.js         Last.fm client (similar tracks / artists), in-memory cache
  pool.js           per-guild candidate pool + "next pick" lifecycle
  profileStore.js   SQLite-backed per-guild profile (session + taste)
  events.js         EventEmitter: 'next-changed', 'exhausted'
src/music/autoplay.js   orchestration: findNextTrack, handleAutoplay, prefetch, feedback API
src/music/autoplayAi.js Gemini (unchanged contract; breaker fix)
```

### Sources (`sources.js`)

Each source: `async fetch(ctx) → Candidate[]` where `Candidate = { track, source, sourceIndex, anchorKey?, anchorRank?, discoveryDistance?, lastfmMatch? }`. All sources run concurrently via `Promise.allSettled`, each with its own timeout; a global retrieval budget of 9 s caps the whole build (late sources are dropped, not awaited).

| Source | How | Priority |
|---|---|---|
| `radio` | resolve YouTube id (`ytmsearch` then `ytsearch`) → `watch?v=ID&list=RDID` | 3 |
| `lastfm` | `track.getSimilar` for up to 2 active seeds (fallback `artist.getSimilar` → top tracks via search); top 8 by match, excluding recent/disliked artists; each resolved with `ytmsearch:"artist title"` (1 result) | 3 |
| `search` | existing `buildSearchQueries`, executed with `ytmsearch:` and falling back to `ytsearch:` when the result is empty or errors | 2 |
| `discovery` | Gemini plan (mode `ai_assisted` / `discovery`) → `ytmsearch:"artist"` (4 results) per artist | 1 |

`searchTracks(node, query, { limit, prefer: 'music' | 'video' })` centralises the prefix + fallback. Radio Mix keeps using URLs.

### Candidate pool (`pool.js`)

Per guild: `{ profileKey, builtAt, picksSinceBuild, candidates: Map<key, Candidate>, next: { track, candidate, reason, preparedFor } | null, building: Promise | null }`.

- **Build**: runs all sources, merges with still-fresh candidates (≤ 20 min old, cap 150), dedupes by track key with source priority (existing `addCandidate` rules).
- **Pick**: re-score every pooled candidate against the *current* context (cheap, pure), then select (Gemini ranking for non-classic modes, local weighted pick otherwise / on failure). The picked candidate is removed from the pool.
- **Refresh**: after a pick, rebuild in the background if eligible candidates < 6, the pool is older than 20 min, `picksSinceBuild ≥ 3` (keeps the manual-seed rotation working), or `profileKey` (hash of manual seed keys) changed.
- **Next pick (prefetch)**: prepared shortly after `trackStart` (3 s delay; not 20 s before the end) whenever autoplay is on and the queue is empty. This enables the "Up next" preview for the whole track. Emits `next-changed`.
- **Skip fast path**: `recordAutoplaySkip` no longer clears the pool. It records feedback, then validates `next` against the new skip signals (re-score; if rejected/penalised below threshold → local re-pick from the pool, *no network*). `handleAutoplay` consumes `next` immediately. Only an empty pool falls back to a synchronous build.
- **Genre radio**: backup candidates are sorted by score before taking the top 4.

### Profile store (`profileStore.js`)

One `SqliteStore('autoplayProfiles.json')` (namespace `autoplayProfiles`), key = guildId:

```js
{
  session: {            // what the current listening session is about
    manualSeeds: [...], // ≤ 40, same shape as today
    seedCursor: 0,
    currentSeed: {...} | null,
    recent: [...],      // ≤ 40 normalized entries
    updatedAt
  },
  taste: {              // long-lived signals
    likes:    { [trackKey]: { title, author, artistKey, at } },   // ≤ 200, kept 90 days
    dislikes: { [trackKey]: { title, author, artistKey, authorKey, at } }, // ≤ 300, kept 30 days
    skips:    [ { key, artistKey, authorKey, strength, at } ],    // ≤ 200, kept 7 days
    played:   { [trackKey]: at },                                 // ≤ 600, kept 3 days
  }
}
```

- In-memory Maps stay as the hot cache; writes go through the store's debounced `save()` (1 s), so playback never blocks on disk.
- Loaded lazily on first access per guild; pruned on load and on write.
- `clearAutoplayState` (player destroyed: stop/leave) clears **session** only; **taste** survives. Turning autoplay off also clears session only.
- Bot restart: session is restored, so a 24/7 or rehydrated player continues with the same seeds.
- `played` is fed from `trackStart` for every track (manual too); scoring rejects autoplay candidates played within 3 days. Manual seeds themselves are already rejected.

Scoring uses taste signals:

- dislike of the same track → reject; ≥ 2 disliked tracks by the artist in 30 days → reject artist; 1 → −30.
- skips: today's rules (strong/normal, artist/channel thresholds) but read from the 7-day list with time decay (full weight < 2 h, half weight < 24 h, quarter after).
- like of the artist → +10 (cap one bonus); liked track itself is never re-picked within the 3-day window but may be after.

**Rebuild from history** (`rebuildProfileFromHistory(guildId)`): takes the last 12 distinct non-autoplay, non-upload plays from `analyticsStore.getGuildHistory` plus up to 6 liked tracks, writes them as session manual seeds (oldest first), resets cursor, invalidates the pool. Exposed as dashboard action.

### Feedback API (in `autoplay.js`)

- `likeTrack(guildId, track)` → taste.likes + `addManualSeed` (invalidates pool profile → background refresh). Toggle: liking again removes the like.
- `dislikeTrack(guildId, track)` → taste.dislikes + strong skip signal; caller then skips through the normal skip path.
- `rerollNext(player, client)` → current `next` gets a mild "rerolled" mark (excluded from this session, no artist penalty), new local/Gemini pick from the pool, emits `next-changed`. Rate-limited to 1 per 1.5 s per guild.
- `getAutoplayNext(guildId)` → `{ title, author, uri, artworkUrl, source, reason } | null` for UIs.
- `getTrackFeedback(guildId, track)` → `'like' | 'dislike' | null`.

Permissions: like/dislike/reroll are available to anyone allowed to use the player controls (same voice channel), not DJ-only. 👎 performs a skip via the existing skip handler, so vote-skip rules still apply; the dislike is recorded regardless.

### Events & visibility (`events.js`)

`autoplayEvents.emit('next-changed', guildId)` → `bot.js` refreshes the now-playing message (through the existing `MusicUI.refresh` lock) and `broadcastPlayerUpdate`.

`autoplayEvents.emit('exhausted', guildId, { reason })` when `handleAutoplay` runs with autoplay on and finds nothing → `MusicUI.sendAutoplayNotice` posts an auto-deleting (30 s, same as playback errors) embed "Autoplay couldn't find a fitting track — add a song to keep going", and the dashboard notice channel (`getPlayerNotice`) shows the same text.

### Gemini fixes

- A structurally valid response with too few artists no longer calls `recordGeminiFailure` (no breaker); it logs at `info` and returns `[]`. HTTP/timeout/invalid-JSON failures keep the breaker.
- Plan is requested once per pool build (not once per track), ranking once per pick → fewer calls overall.

### Misc fixes

- `addManualSeed` also ignores live streams (`info.isStream`) and tracks without duration.
- Prefetch is skipped for live streams.

## UI

All UI copy in English (matches existing bot/dashboard copy).

### Discord now-playing message

- When autoplay is on, the embed gains a field **Up next** · `Artist — Title` (or *finding a track…* while preparing). For autoplay tracks, the footer shows the pick reason source, e.g. `Autoplay · similar on Last.fm` / `from YouTube radio` / `AI discovery`.
- Third button row, only when autoplay is on: `👍` (Success style when liked) · `👎` · `🎲 Reroll next` (disabled until a next pick exists). Custom ids use the existing `music:<action>:<guildId>` scheme (`like`, `dislike`, `reroll`); ephemeral confirmations are not sent — the message itself updates.

### Dashboard (`/dashboard/[guildId]`)

- Player controls: when autoplay is on, 👍/👎 buttons next to the track title (lucide `ThumbsUp`/`ThumbsDown`, filled state when active).
- Queue: after the last queued track, a dimmed **Up next · Autoplay** row with artwork, title, source chip and a reroll (`Dices`) button. Hidden when autoplay is off or nothing is prepared.
- Settings → Autoplay section: "Rebuild from history" button with a short description, plus a "Last.fm" status line (enabled / not configured).

### Activity

- Same 👍/👎 pair in `ActivityPlayerControls` (compact icon buttons), same ghost "Up next" row with reroll in `ActivityQueuePanel`.

### API

- `buildPlayerStatusSnapshot` adds `autoplayNext` and `autoplayFeedback` (for the current track).
- `POST /api/guilds/:guildId/player/:action` gains `autoplay_like`, `autoplay_dislike`, `autoplay_reroll` (player access, not DJ-only) and `autoplay_rebuild` (DJ-only).
- `web/lib/api.ts` types updated accordingly.

## Error handling

- Every source is isolated: a timeout/exception yields `[]` and a `debug` log; the build continues with the rest.
- Last.fm: disabled without `LASTFM_API_KEY`; HTTP 429/5xx opens a 5-minute local breaker; responses cached 6 h per `(artist,title)`.
- SQLite write failures are logged by `SqliteStore` and never interrupt playback; corrupt rows are dropped by the existing loader.
- Epoch checks (`autoplayEpoch`) also guard background pool builds and next-pick preparation, so a stopped player never gets a late track.
- `exhausted` is emitted at most once per 2 minutes per guild to avoid spam.

## Testing

- Unit (node:test, added to the `npm test` list): `normalize`/`scoring` (moved tests keep passing), `pool` (skip fast path re-picks without network, refresh triggers, epoch guard), `sources` (parallel runner budget, ytm→yt fallback with a fake node), `lastfm` (parsing, filtering, cache, breaker with fake fetch), `profileStore` (prune windows, session vs taste clearing, restart round-trip with a temp `BREAD_DB_PATH`), feedback API, Gemini breaker fix.
- `scripts/evaluate-autoplay.js` against production Lavalink data paths where possible.
- Web: `npm run typecheck` + build; Playwright smoke for the dashboard ghost row if the existing e2e harness supports player fixtures.
- Live: each stage deployed to the Pi after user confirmation, verified with `AUTOPLAY_LOG_LEVEL=info` logs (skip latency, source mix) and by playing in the test guild.

## Delivery stages (one PR each)

1. **Engine**: module split, sources + ytmsearch, parallel retrieval, pool + skip fast path, early prefetch, Gemini/genre fixes, `exhausted` notice.
2. **Persistence**: profile store, taste-aware scoring, 3-day no-repeat, rebuild from history (API only).
3. **Last.fm** source (needs `LASTFM_API_KEY` on the Pi).
4. **UI**: Discord row + Up next field, dashboard & Activity feedback/ghost row/reroll, settings rebuild button.

## Out of scope

Radio stations (Radio Browser) — separate project. Per-user (rather than per-guild) taste profiles.
