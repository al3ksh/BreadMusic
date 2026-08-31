# Landing Release

## Scope

The new landing replaces `/`. Root requests containing `frame_id`, `instance_id`
and `platform` still render the real Discord Activity. `/activity`, `/dashboard`
and the existing `/api` proxy are unchanged. The private-access Add to Discord
modal is unchanged. Dashboard links on the public page are same-site links.

No audio streams, Discord sessions, real queues, uploads, economy transactions
or bot control endpoints are used by the demo. The browser-tab queue is ephemeral.
The files under `web/components/landing-preview` are the shared production/demo
UI; that directory name is historical, not an environment toggle.

## Default Deployment

The normal web Docker target includes all UI, sample metadata, images and fonts.
Set `WEB_URL` to the exact public origin, for example `https://bread.example`.
It controls canonical/OG URLs and the trusted origin for `/demo/api/*` POSTs.
It is passed to the web container as well as the bot. Do not set
`BREAD_LANDING_PREVIEW=1` in production: the legacy preview page and API alias
are otherwise disabled with 404, and the public landing has no preview stamp.

With no `LANDING_DEMO_SEARCH_URL` and dedicated token, the demo searches its
sample catalogue only. Example-track buttons and all local player/queue controls
work without an upstream service. Unknown queries explain that live search is
not enabled. This default adds no Java process or third-party search traffic.

After taking the usual deployment snapshot, rebuild **only web**:

```sh
docker compose build web
docker compose up -d --no-deps web
```

Do not restart bot/Lavalink just to publish this landing. Adapt these commands
to any existing host-specific compose files and project name. This change does
not modify production environment files, SQLite or uploaded audio.

## Optional Live Search

`compose.landing-live.yml` adds an isolated metadata worker and a separate
Lavalink. Neither service exposes a host port or joins the bot network. The web
container is the bridge via authenticated HTTP, with no cookies or user bearer
tokens forwarded. There is no playback route in the metadata worker.

1. Generate a separate random `LANDING_DEMO_TOKEN` (at least 32 characters).
   Supply it through your existing environment/secret management, never Git.
   Do not reuse the bot's Lavalink password, Discord token or session secret.
2. Reserve up to **1024 MiB extra RAM**: worker 256 MiB, search Lavalink 768 MiB.
   CPU caps are 0.5 and 1.0 respectively. Logs rotate at 2 x 5 MiB per service.
3. Merge the override and start just the new services and web:

```sh
docker compose -f docker-compose.yml -f compose.landing-live.yml config --quiet
docker compose -f docker-compose.yml -f compose.landing-live.yml build web landing-search
docker compose -f docker-compose.yml -f compose.landing-live.yml up -d landing-lavalink landing-search
docker compose -f docker-compose.yml -f compose.landing-live.yml up -d --no-deps web
```

The override supplies `LANDING_DEMO_SEARCH_URL=http://landing-search:3001`.
Outside Compose, configure that URL and the matching token manually. The worker
also needs `LANDING_LAVALINK_URL` and `LANDING_LAVALINK_PASSWORD`; never point it
at the playback node merely to avoid the additional memory reservation.

Live lyrics require a separate `LANDING_DEMO_LYRICS_ENABLED=true` in both web and
worker. They are off by default. Review provider terms and rights for public
lyrics/artwork before publishing them; this implementation does not grant rights
to recordings, artwork or lyrics. Audio remains disabled in every mode.

## Network And Abuse Controls

- Public paths: POST `/demo/api/search`, POST `/demo/api/lyrics`, GET
  `/demo/api/artwork?id=...`. No arbitrary URL proxy, no CORS allowance.
- Writes require configured Origin and JSON. Bodies are streamed with a 2 KiB
  cap and 3-second read deadline, including chunked requests. Only required
  metadata fields are forwarded. Upstream responses are capped at 1 MiB JSON
  or 2 MiB artwork; errors do not expose upstream URLs or credentials.
- Per-minute web limits, including cached results: search 60 global / 12 client,
  lyrics 20 / 6, artwork 180 / 60. Simultaneous work is capped at 2 / 2 / 8.
  The worker additionally caps searches at 30/minute and artwork at 180/minute
  with four simultaneous downloads. It has a 16 MiB artwork cache (max 32 items).
- `LANDING_DEMO_CLIENT_IP_HEADER` is empty by default: everyone shares one
  anonymous client bucket. Only set `x-real-ip` or `cf-connecting-ip` when your
  trusted reverse proxy **overwrites** that header and direct web-port access is
  blocked. Arbitrary `X-Forwarded-For` values are never trusted. Malformed or
  missing IPs use the shared bucket. IP counters contain hashes and expire after
  one minute; queries, tokens and IPs are not logged by these handlers.
- These are process-local limits intended for this single-host deployment.
  Multiple web/worker replicas require edge/distributed limits before scaling.
  Origin checks are not bot authentication; global quotas and proxy limits still
  matter. At the public proxy also cap `/demo/api/` request size, connection rate
  and timeouts. Keep existing 256 MB upload handling for `/api` untouched.
- Search/artwork cache: five minutes; lyrics: up to one hour. No persistent data.
  An upstream failure leaves local sample buttons and player controls usable.

## Verification

```sh
npm test
npm run test:landing --prefix web
node web/preview/bot-contract.cjs --check
npm run typecheck --prefix web
npm run build --prefix web
npm run test:e2e --prefix web
docker compose config --quiet
git diff --check
```

`test:landing` covers query validation, tokens at the service boundary,
origin spoofing, bounded bodies/responses, quotas, concurrency, catalogue mode,
worker auth, disabled lyrics and artwork cache. No Discord credentials are used.
E2E covers both desktop/mobile and the actual root route, dashboard and mocked
Discord SDK. CI runs both suites. For the local isolated preview:

```sh
docker compose -f compose.landing-preview.yml up -d --build
node web/preview/verify-live.mjs
node web/preview/verify-discord-preview.mjs
node web/preview/verify-behavior.mjs
node web/preview/live-search-smoke.mjs
```

The last command uses real external metadata providers and can fail during an
upstream outage. The other suites mock those responses for repeatability.

## Manual Smoke Test

- Open `/` desktop/mobile; check hero, gallery enlargement, Arcade and FAQ.
- Check Add to Discord modal and same-site Dashboard navigation/login.
- Try slash autocomplete, example tracks, pause, seek, volume, skip, queue and
  switching to Activity. Confirm no audio and no change to a real Discord queue.
- In live mode search a YouTube title and SoundCloud title; test source failure
  and verify sample buttons still work. Check lyrics only when explicitly enabled.
- Open the real Activity from Discord, including the root URL mapping. Verify DJ
  and view-only permissions, queue sync, upload and playback on the real bot.
- Verify canonical domain, HTTPS, proxy IP-header policy, metadata service health,
  memory use and 429 behavior. Ensure metadata ports are not publicly exposed.

## Rollback Without Bot Restart

Before deployment record the current web image ID and compose configuration.
If necessary, restore that web image/configuration and recreate **only web** with
`--no-deps`. Do not reset the repository, database, uploads or bot container.

To disable live metadata while keeping the new landing, remove its web URL/token
and recreate web with the base compose configuration; then stop only
`landing-search` and `landing-lavalink`. Do not run a whole-project `down`.
The sample catalogue and local demo controls will remain available.
