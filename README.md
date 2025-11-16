> Note: This bot was fully AI "vibecoded" – commands, logic and docs were generated and refined with an AI assistant.
### 1. Quick start
1. **Requirements:** Node 18+, Java 17/21, Lavalink 4.x (with the `youtube-source` plugin).
2. **Environment:** copy `.env.example` to `.env` and fill in the values:
   ```ini
   DISCORD_TOKEN=bot_token
   DISCORD_CLIENT_ID=application_id
   # DISCORD_GUILD_ID=optional_test_guild_id

   # single node option
   LAVALINK_HOST=127.0.0.1
   LAVALINK_PORT=2333
   LAVALINK_PASSWORD=youshallnotpass
   LAVALINK_SECURE=false

   # multiple nodes option (JSON)
   # LAVALINK_NODES=[{"id":"main","host":"127.0.0.1","port":2333,"password":"youshallnotpass","secure":false}]

   DEFAULT_SOURCE=ytsearch
   IDLE_TIMEOUT_MS=300000
   ```
3. **Install & run:**
   ```powershell
   npm install
   npm run register   # register slash commands (one-time)
   npm start
   ```

### 2. Key features
- Now-playing embed with an ASCII progress bar, artwork, source link and control panel (play/pause/skip/stop/loop/shuffle/back/replay). Buttons only respond to users in the same voice channel as the bot.
- `/play` respects a preferred provider (configured via `/config`), falls back to SoundCloud when no results are found, and provides autocomplete suggestions while typing.
- Queue management: `/queue` shows ETA, total duration and supports pagination with buttons.
- Queue controls: `/remove`, `/move`, `/seek`, `/skipto`, `/back`, `/replay`, `/shuffle`, `/loop`, `/volume` (per-guild limit), `/clearqueue` (clears upcoming tracks) and `/blackjack` for a small mini-game.
- Lavalink filters: `/filter preset bassboost|nightcore|soft|vaporwave|karaoke`, `/filter list`, `/filter clear`, `/crossfade`.
- Vote-skip: when DJ role is configured in `/config`, skipping may require votes according to `voteSkipPercent` (configurable).
- Per-guild configuration: `/config set` controls preferred provider, DJ role, maxVolume, AFK timeout, persistent queue, 24/7 mode (stayInChannel + voice channel), announce channel, etc.
- Stability: persistent queues stored in `data/queues.json`, automatic reconnection to nodes, auto-leave on inactivity, and detailed Lavalink logging (trackStart/End/Stuck/Exception).
- Diagnostics: `/ping` (RTT + websocket latency), `/stats`, `/node`.

### 3. Minimal `application.yml` (Lavalink 4)
```yml
server:
  port: 2333

lavalink:
  server:
    password: "youshallnotpass"
    sources:
      youtube: false
      soundcloud: true
      bandcamp: true
    playerUpdateInterval: 5

plugins:
  youtube:
    enabled: true
    allowSearch: true
```
Place the `youtube-source` plugin in the `lavalink/plugins` folder. Test the server with `curl http://127.0.0.1:2333/version`.

### 4. Most used commands
| Command | Description |
| --- | --- |
| `/play <query>` | Add a track or playlist. Autocomplete shows matches while typing. |
| `/queue` | Show queue with pagination and ETA. |
| `/loop off|track|queue` | Control repeat mode. |
| `/filter preset bassboost` | Apply audio filter presets. |
| `/volume 75` | Set volume (bounded by `maxVolume` from config). |
| `/clearqueue` | Clear upcoming queue while keeping the currently playing track. |
| `/config set stay_24_7:true voice_channel:#music` | Enable 24/7 mode with queue restore options. |
| `/skip` | Skip the current track (may trigger vote-skip depending on config). |
| `/blackjack` | Start a single-player blackjack mini-game against the dealer. |
| `/ping` | Diagnostic ping (RTT + websocket latency). |

### 5. DJ role and permissions
- Administrative commands (`/stop`, `/volume`, `/filter`, `/remove`, `/move`) require the DJ role configured in `/config` or Manage Guild/Administrator permissions.
- Buttons (play/pause/skip/loop/shuffle) only work if the user is in the same voice channel as the bot.

### 6. Persistence and 24/7 behavior
- Queues are saved to `data/queues.json` for guilds with persistent queues enabled. Note: on some setups the bot may clean stale saved queues on restart — test in your environment.
- 24/7 mode (`stayInChannel` + `twentyFourSevenChannelId`) will make the bot rejoin the configured voice channel after restart; queue restoration depends on configuration.
- Auto-leave is controlled by `afkTimeout` (default 5 minutes, configurable via `/config`).

### 7. Troubleshooting
- `401 Unauthorized`: ensure the Lavalink password in `.env` matches `application.yml`.
- No YouTube results: confirm the `youtube-source` plugin loaded correctly on Lavalink; as a fallback set `preferred_source=scsearch` in guild config.
- WebSocket 1006 or disconnects: check firewall rules, Lavalink host/port accessibility and Java version (17/21 recommended).
- `normalize` errors: require the LavaDSP plugin (lavalink-lava-dsp) installed on the Lavalink server.

### 8. Project structure
- `src/bot.js` - client initialization, event handlers, Lavalink integration.
- `src/commands/index.js` - slash command definitions and handlers (queue, playback, filters, diagnostics).
- `src/music/*.js` - UI helpers (embeds, buttons), idle tracker, vote manager, filter handling.
- `src/state/*.js` - persistent storage for guild config and queues.
- `README.md` - this document.

Implemented items: help UX (`/help`), extended queue commands, audio filters, stability features (auto-leave, 24/7, persistence), per-guild configuration, diagnostics and Lavalink logs. Ready for further extension (web panel, multi-shard support, etc.).

```
