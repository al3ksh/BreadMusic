# Local Landing Preview

The landing now also serves `/`; release configuration and rollback are described
in [landing-release.md](../../docs/landing-release.md). This local Compose project
remains separate from production. Shared Activity components only gain optional
demo-only disabled flags; their existing behavior stays unchanged. Nothing in
this local stack connects to the production API, Discord or Raspberry Pi.

## Run

From the repository root:

```sh
docker compose -f compose.landing-preview.yml up -d --build
docker compose -f compose.landing-preview.yml down
```

Open http://localhost:3181/preview/landing.

The separate Compose project contains Next.js, a metadata-only search service
and its own Lavalink 4.2.2 with the same pinned YouTube plugin as the bot.
Only port 3181 is exposed, on loopback. No production volumes, credentials,
environment files or databases are mounted. The normal `/api` proxy points
at a closed local port. Preview routes require `BREAD_LANDING_PREVIEW=1`.

## Working Demo

- `/play` uses the bot's `applyPreferredSource` helper, Lavalink's loadtracks
  endpoint and actual `buildTrackEmbed` / `buildNowPlayingEmbed` presenters.
  It does not create a Lavalink player, invoke Discord commands or fetch audio.
- Text search defaults to YouTube. YouTube and SoundCloud links work, as does
  `scsearch:artist title`. Spotify resolution is deliberately not configured:
  no production Spotify credentials are copied into a public preview.
- Search yields up to 10 tracks; playlists up to 50. `/play` picks the first
  result or queues the playlist. Activity search lets you choose a result.
- Slash commands and Activity share a browser-tab-local reducer: current track,
  queue, previous tracks, pause, seek, volume and loop. Switching tabs retains
  the session. Refresh/reset restores illustrative starter tracks. No audio.
- The Activity tab is the real Activity: the same `ActivityApp` the Discord
  Activity renders, loaded in an iframe at `/activity/demo` with an in-browser
  fake backend instead of the Discord SDK and `/api`. Library, karaoke, the
  view-transition morph, drawers, autoplay, Radio and the Sound panel are the
  production components, not copies. The backend answers Activity requests from
  the shared reducer, so slash commands and the Activity stay in sync (`/lyrics`
  opens the lyrics panel). Search and lyrics go through `/demo/api`; nothing is
  sent to `/api` or Discord, and upload stays disabled. The page is noindex,
  and real Activity auth is untouched.
- Slash autocomplete searches after 450 ms of idle typing, discards stale
  responses, shows real tracks, and tokenizes the command/argument. Choosing a
  result fills the argument; Enter submits. Selected results are reused without
  performing the same search again.
- Actual Discord embed fields, button IDs/order and paginated queue formatting
  come from the presenters and checked-in generated `bot-contract.json`.
- Arcade rotates real renderer output for RPS, Blackjack, Slots and Roulette
  every six seconds. Hover/focus, offscreen, hidden tabs and reduced-motion stop
  rotation. Manual selection pauses it. Slots commands use pre-rendered GIF/PNG
  sample rounds, with no economy or real bets.
- Screenshots, image enlargement, FAQ, mobile navigation and the existing
  private-access invitation modal still work. The dashboard link is explicit;
  the preview does not load the public dashboard automatically.

## Search Boundary

The demo uses `/demo/api/search` and `/demo/api/lyrics` (POST) and
`/demo/api/artwork` (GET). Legacy `/preview/api` aliases exist only in preview mode.
This local configuration accepts the two local origins on port 3181. Body size is capped at
2 KB and query length at 200. Supported HTTPS hosts and search prefixes are
allowlisted; local files, arbitrary HTTP sources and arbitrary URLs are rejected.
The private search service permits two concurrent searches and 30 requests per
minute globally. Results cache for five minutes, bounded to 60 entries.
Artwork URLs are registered from provider results on four allowed CDN hosts;
the browser receives an opaque ID, never an arbitrary fetch proxy. Images have
a two-MB cap, MIME validation, timeout and no redirects. Encoded tracks and
Lavalink credentials never reach the browser.

Lyrics have a separate 20-requests/minute budget, two concurrent lookups,
12-second total provider deadline and a bounded 75-entry cache. They use only
the fixed LRCLIB API origin and at most three normalized query variants.
Availability of synchronized lyrics depends on the provider and track metadata.

The public handler additionally enforces client/global quotas, bounded streamed
bodies and private worker authentication. This local stack enables live lyrics;
production does not enable them by default. See the release guide for proxy trust,
resource budgets, configuration and provider-rights considerations. Audio stays disabled.

## Verification

From the repository root, with the Docker preview running:

```sh
npm run test:landing --prefix web
node web/preview/bot-contract.cjs --check
npm run typecheck --prefix web
node web/preview/verify-live.mjs
node web/preview/verify-behavior.mjs
node web/preview/verify-discord-preview.mjs
node web/preview/live-search-smoke.mjs
docker compose -f compose.landing-preview.yml config --quiet
git diff --check
```

The browser suite mocks search responses for repeatability and checks five
desktop/mobile sizes, shared state, errors, drawers, no horizontal overflow,
no production/Discord/media requests and readable control layouts. The separate
smoke test makes real searches through the local stack. Screenshots go to
`.tmp/landing-preview`. The Docker build also runs the optimized Next build.

Asset generators (no bot startup or economy imports):

```sh
node web/preview/bot-contract.cjs
node web/preview/arcade-assets.cjs
node web/preview/carousel-assets.cjs
```

`capture.mjs` retains the real Activity/dashboard screenshot capture with mocked
API/SDK data, including the karaoke `lyrics*.png` shots. Run it from `web`
with a local web dev server on port 3180: once plain, then with
`--activity-hero-only` (2x hero) and `--activity-mobile-only` (3x phone shots).
Self-hosted Manrope includes its OFL license. Starter cover art is from album
metadata: [Not Like Us](https://music.apple.com/pl/album/not-like-us/1781353928?i=1781353929)
and [BUBBLETEA](https://music.apple.com/pl/album/bubbletea/1633288384?i=1633289330).
