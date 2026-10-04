# Autoplay Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instant, learning autoplay: candidate pool with skip fast path, ytmsearch + parallel sources, SQLite taste profile, Last.fm source, and 👍/👎/Up next/reroll UI.

**Architecture:** `src/music/autoplay.js` stays the public orchestrator; pure logic moves into `src/music/autoplay/` (normalize, scoring, sources, pool, lastfm, profileStore, events). A per-guild pool of scored candidates is rebuilt in the background and re-scored on every pick, so skips never wait for the network.

**Tech Stack:** Node.js (CommonJS, `node:test`), lavalink-client 2.9, discord.js 14, `node:sqlite` via `SqliteStore`, Next.js web app.

**Spec:** `docs/superpowers/specs/2026-10-03-autoplay-rework-design.md`

**Status:** all four stages shipped to main (Oct 2026); boxes below are ticked for the record.

## Global Constraints

- Public exports of `src/music/autoplay.js` keep their names and call signatures; `handleAutoplay` still returns a boolean.
- New test files must be appended to the explicit file list in `package.json` → `scripts.test`.
- UI copy is English.
- Retrieval budget 9 s per pool build; next pick prepared 3 s after `trackStart`; pool candidates expire after 20 min, cap 150; refresh when eligible < 6, age > 20 min, `picksSinceBuild ≥ 3`, or profileKey changed.
- No-repeat window 3 days; dislikes kept 30 days; skips 7 days; likes 90 days.
- `exhausted` notice at most once per 2 min per guild; reroll at most 1 per 1.5 s per guild.
- Never push to `main`; one PR per stage; production deploy only after the user confirms in chat.

## Review Focus

- Skip during a background pool build: the skip must still use the existing `next`/pool and not wait for the build → test in Task 3 (`skip while building uses pool immediately`).
- Player destroyed while a build or next-pick preparation is in flight: no track may be queued afterwards (epoch guard) → test in Task 3 (`stale epoch never queues`).
- Every candidate rejected after a skip (e.g. the pool is all one disliked artist): falls back to a synchronous build, then emits `exhausted` → test in Task 3 (`empty eligible pool triggers build then exhausted`).
- Lavalink node disconnected mid-build: sources return `[]`, no throw → test in Task 2 (`disconnected node yields no candidates`).
- Manual track added while `next` is prepared: autoplay must not jump the manual queue; the profile change marks the pool stale → covered by existing `handleAutoplay` queue-length guards plus a Task 3 test (`manual seed marks pool stale`).

---

## Stage 1 — Engine (PR 1)

### Task 1: Extract normalize + scoring modules

**Files:**
- Create: `src/music/autoplay/normalize.js`, `src/music/autoplay/scoring.js`
- Modify: `src/music/autoplay.js` (remove moved code, import it)
- Test: existing `test/autoplay.test.js` (must pass unchanged)

**Interfaces:**
- Produces `normalize.js`: `normalizeTrack(track)`, `normalizeComparable(s)`, `makeTrackKey(o)`, `snapshotTrackInfo(t)`, `isLocalUploadTrack(t)`, `isYouTubeIdentifier(id)`, `getTrackCacheKey(t)`, `cleanTitle`, `tokenOverlap(a,b)`, `logAutoplay(level,msg)`.
- Produces `scoring.js`: `scoreCandidate(candidate, context) → {score, rejected, reason}`, `pickCandidateLocally(scored, random?)`, `MIN_SCORE`. Scoring reads recency only from `context.recent` (no module Maps) so it is pure.

- [x] Step 1: Move code; replace `isTrackRecent(guildId, …)` / `isArtistOverplayed(guildId, …)` with versions taking `context.recent`.
- [x] Step 2: `npm test` → all autoplay tests PASS.
- [x] Step 3: Commit `refactor(autoplay): extract normalization and scoring modules`.

### Task 2: Sources with ytmsearch fallback and parallel runner

**Files:**
- Create: `src/music/autoplay/sources.js`
- Test: `test/autoplaySources.test.js` (add to package.json)

**Interfaces:**
- Produces: `searchTracks(node, query, { requester, limit = 12, prefer = 'music' }) → Promise<Track[]>` (`prefer:'music'` tries `ytmsearch:` then `ytsearch:` when empty/error; `'video'` only `ytsearch:`); `resolveYouTubeId(node, normalizedTrack, requester)`; `fetchRadioMix(node, videoId, requester)`; `collectCandidates(sourceTasks, { budgetMs = 9000 }) → Promise<Candidate[]>` where `sourceTasks` is `Array<{ name, run: () => Promise<Candidate[]> }>`; results from tasks finishing after the budget are dropped; a rejected task yields `[]`.

- [x] Step 1: Tests with a fake node `{ connected, search({query}) }`:
  - `ytmsearch empty falls back to ytsearch` — fake returns `[]` for `ytmsearch:` prefix → result comes from the `ytsearch:` call; calls recorded in order `['ytmsearch:x','ytsearch:x']`.
  - `ytmsearch error falls back to ytsearch`.
  - `disconnected node yields no candidates` — `connected:false` → `[]`, `search` never called.
  - `collectCandidates drops sources past budget` — one task resolves at 10 ms, one at 200 ms, `budgetMs:50` → only the first's candidates; total elapsed < 150 ms.
  - `collectCandidates isolates failures` — a throwing task does not lose the other task's candidates.
- [x] Step 2: Run `node --test test/autoplaySources.test.js` → FAIL (module missing).
- [x] Step 3: Implement.
- [x] Step 4: Run → PASS. Commit `feat(autoplay): ytmsearch sources with parallel budgeted retrieval`.

### Task 3: Candidate pool, early next pick, skip fast path

**Files:**
- Create: `src/music/autoplay/pool.js`, `src/music/autoplay/events.js`
- Modify: `src/music/autoplay.js` (findNextTrack → `buildPool` + `pickNext`; `scheduleAutoplayPrefetch`, `consumePrefetchedTrack`, `recordAutoplaySkip`, `handleAutoplay`, `clearAutoplayState`, `setAutoplay`, `addManualSeed`)
- Test: `test/autoplayPool.test.js` (add to package.json)

**Interfaces:**
- `events.js`: `autoplayEvents` (EventEmitter) with `'next-changed' (guildId)` and `'exhausted' (guildId, { reason })`.
- `pool.js` (pure state, no network): `getPool(guildId)`, `mergeCandidates(guildId, candidates, { profileKey, now })` (dedupe by `normalized.key` with source priority radio=lastfm 3 > search 2 > discovery 1; drop entries older than 20 min; cap 150 keeping highest priority/newest), `removeCandidate(guildId, key)`, `needsRefresh(guildId, { eligibleCount, profileKey, now }) → boolean`, `setNext(guildId, next)`, `getNext(guildId)`, `clearPool(guildId)`.
- `autoplay.js` new exports: `getAutoplayNext(guildId) → { title, author, uri, artworkUrl, source } | null`, `autoplayEvents`, `__testing.setSearchImpl(fn)` for injecting a fake search.
- Behaviour: `scheduleAutoplayPrefetch(player, track, client)` waits 3 s then calls `prepareNext`; `prepareNext` = ensure pool (build if empty/needsRefresh, background otherwise) → re-score with fresh context → select (Gemini unless classic) → `setNext` → emit `next-changed`. `recordAutoplaySkip` records feedback then, if `next` now scores `rejected`, replaces it via local pick from the pool (no network) and emits `next-changed`. `handleAutoplay` uses `next` if its `preparedFor` epoch matches; otherwise local pick from pool; otherwise synchronous build; if still nothing and autoplay is on → emit `exhausted` (rate-limited 2 min).

- [x] Step 1: Tests (fake player `{ guildId, node:{connected:true, search}, queue:{tracks:[],current,add}, playing:false, paused:false, play }`, fake client with `lavalink.players.get(guildId) === player`, mode `classic` via `setAutoplayMode`, autoplay enabled via `setAutoplay`):
  - `prepared next is consumed without new searches` — after `prepareNext`, record search count; `handleAutoplay` queues `getAutoplayNext` track and search count unchanged.
  - `skip while building uses pool immediately` — pool has candidates, a background build is pending (search never resolves); skip of artist A + `handleAutoplay` resolves < 100 ms and queues a non-A track.
  - `skip rejection re-picks next from pool` — `next` is artist A; two strong skips of A → `getAutoplayNext` is not A and `next-changed` fired.
  - `stale epoch never queues` — start `handleAutoplay` with slow search, call `clearAutoplayState` → resolves `false`, `queue.add` never called.
  - `empty eligible pool triggers build then exhausted` — search returns only rejected tracks → `handleAutoplay` false and `exhausted` emitted once; second call within 2 min emits nothing.
  - `manual seed marks pool stale` — after `addManualSeed` with a new key, `needsRefresh` is true.
  - pool unit tests: merge dedupe/priority, 20-min expiry, cap 150.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Implement; genre radio backup sorted by score desc before `slice(0, 4)`; `addManualSeed` ignores `info.isStream` and tracks without positive duration; no prefetch for streams.
- [x] Step 4: `npm test` → all PASS (old `__testing` helpers kept or adapted only where behaviour intentionally changed).
- [x] Step 5: Commit `feat(autoplay): candidate pool with instant skips and early next pick`.

### Task 4: Gemini breaker fix

**Files:** Modify `src/music/autoplayAi.js:594-650`; Test `test/autoplayAi.test.js`

- [x] Step 1: Test `too few valid artists does not open the breaker` — fetch returns valid JSON with 1 artist → `getDiscoveryArtists` returns `[]` and `getGeminiStatus().circuitOpen === false`. Keep existing genre test semantics for HTTP failure (adjust its fixture if it relied on too-few-artists).
- [x] Step 2: Run → FAIL. Step 3: implement (log `info`, return `[]`, call `recordGeminiSuccess`). Step 4: PASS. Commit `fix(autoplay-ai): sparse plans no longer trip the breaker`.

### Task 5: Wire events into bot (Up-next refresh + exhausted notice)

**Files:** Modify `src/bot.js` (Lavalink events ~544–610), `src/music/ui.js` (add `sendAutoplayNotice(player, text)` reusing the 30 s TTL path of `sendPlaybackError`), `src/server.js` (`setPlayerNotice` for exhausted, see existing `getPlayerNotice`).

- [x] Step 1: `autoplayEvents.on('next-changed')` → `broadcastPlayerUpdate(guildId)`; `on('exhausted')` → `musicUI.sendAutoplayNotice(player, "Autoplay couldn't find a fitting track — add a song to keep going.")` + dashboard notice.
- [x] Step 2: `npm test` PASS; manual smoke with `scripts/evaluate-autoplay.js` if it still runs.
- [x] Step 3: Commit `feat(autoplay): announce when autoplay runs dry`.

### Task 6: Stage 1 ship

- [x] Push branch `feat/autoplay-stage1`, open PR to `al3ksh/BreadMusic`, bind with ccd_pr, check CI.
- [x] Ask user to confirm deploy; back up `~/apps/discord-bot` on the Pi; sync only changed `src/music/**`, `src/bot.js`, `package.json`, tests; `docker compose up -d --build bot`; watch logs with `AUTOPLAY_LOG_LEVEL=info`; measure skip→trackStart latency.

---

## Stage 2 — Persistence (PR 2), task outline

- **Task 7 `profileStore.js`**: `SqliteStore('autoplayProfiles.json')`; `getProfile(guildId)`, `saveSession(guildId, session)`, `clearSession(guildId)`, `recordPlayed`, `recordLike/toggleLike`, `recordDislike`, `recordSkip`, `getTasteSignals(guildId, now)` with pruning windows from Global Constraints. Tests with temp `BREAD_DB_PATH`: restart round-trip, prune windows, clearSession keeps taste.
- **Task 8 taste-aware scoring**: context gains `taste`; rules from spec (dislike track reject; ≥2 disliked by artist reject, 1 → −30; skip decay 1 / 0.5 / 0.25 at <2 h / <24 h / older; liked artist +10; played < 3 days reject). Tests per rule.
- **Task 9 wire persistence**: session Maps hydrate from store, writes debounced; `trackStart` → `recordPlayed`; `clearAutoplayState`/autoplay-off clear session only; `rebuildProfileFromHistory(guildId)` using `getGuildHistory` (12 distinct non-autoplay non-upload + 6 likes). Tests.

## Stage 3 — Last.fm (PR 3), task outline

- **Task 10 `lastfm.js`**: `getSimilarTracks({artist,title})`, `getSimilarArtists(artist)`; disabled without `LASTFM_API_KEY`; 6 h cache; 5-min breaker on 429/5xx; fake-fetch tests.
- **Task 11 lastfm source**: up to 2 active seeds → top 8 by match excluding recent/disliked artists → `searchTracks(..., {limit:1, prefer:'music'})` each; candidates `source:'lastfm'`, score bonus `+10 + round(match*12)`; footer reason label. Requires `LASTFM_API_KEY` on Pi (ask user).

## Stage 4 — UI (PR 4), task outline

- **Task 12 feedback API**: `likeTrack`, `dislikeTrack`, `rerollNext` (1.5 s limit), `getTrackFeedback`; tests.
- **Task 13 Discord**: third button row (`like`, `dislike`, `reroll`) when autoplay on; Up next field + autoplay reason footer in `embeds.js`; handlers in `bot.js` (`dislike` → record then existing `skipTrack`); embed tests.
- **Task 14 API**: status snapshot `autoplayNext`, `autoplayFeedback`; actions `autoplay_like|autoplay_dislike|autoplay_reroll` (player access) and `autoplay_rebuild` (DJ); `web/lib/api.ts` types.
- **Task 15 Dashboard**: thumbs in `DashboardPlayerControls`, ghost Up next row with reroll in `DashboardQueue`, rebuild button + Last.fm status in `DashboardSettings`. Read `web/node_modules/next/dist/docs/` first (web/AGENTS.md).
- **Task 16 Activity**: same in `ActivityPlayerControls` and `ActivityQueuePanel`; typecheck, build, e2e.
