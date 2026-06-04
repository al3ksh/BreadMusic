# 🍞 Bread Music Bot

> Discord music bot with economy, games, and advanced audio features. Fully AI "vibecoded" – commands, logic and docs were generated and refined with an AI assistant.

## Quick Start

### Requirements
- Node.js 18+
- Java 17/21
- Lavalink 4.x with plugins:
  - `youtube-plugin` (YouTube support)
  - `lavasrc-plugin` (Spotify, Deezer, Apple Music support)

### Environment
Copy `.env.example` to `.env` and fill in the values:
```ini
DISCORD_TOKEN=bot_token
DISCORD_CLIENT_ID=application_id
DISCORD_CLIENT_SECRET=oauth2_client_secret
# DISCORD_GUILD_ID=optional_test_guild_id

# Lavalink connection
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false

# Multiple nodes (JSON format)
# LAVALINK_NODES=[{"id":"main","host":"127.0.0.1","port":2333,"password":"youshallnotpass","secure":false}]

# Spotify API (required for Spotify links)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

DEFAULT_SOURCE=ytsearch
IDLE_TIMEOUT_MS=300000

# Web Dashboard
WEB_PORT=3001
WEB_HOST=0.0.0.0
WEB_URL=http://localhost:3000
SESSION_SECRET=random-secret-change-this

# Optional (used by /dashboard command for external link)
# DASHBOARD_URL=https://your-domain.example
```

### Install & Run
```powershell
npm install
npm run register   # register slash commands (one-time)
npm start
```

### Run With Dashboard (development)
Use three terminals:

```powershell
# 1) Lavalink
cd lavalink
java -jar Lavalink.jar
```

```powershell
# 2) Bot + API
npm run dev:api
```

```powershell
# 3) Next.js dashboard
npm run dev:web
```

---

## Features

### 🎵 Music Playback
- **Multi-source**: YouTube, Spotify, SoundCloud, Bandcamp
- **Spotify integration**: Play tracks, albums, playlists directly from Spotify links
- **Now-playing embed** with progress bar, artwork, source link and control buttons
- **Autocomplete** suggestions while typing in `/play`

### 🔁 Autoplay
- **Smart autoplay**: Automatically finds and plays similar tracks when queue ends
- **YouTube Radio Mix**: Uses YouTube's own recommendation system as primary source
- **Heuristic fallback**: Scores YouTube/Lavalink search candidates when YouTube Mix is weak
- **Intelligent filtering**: Excludes remixes, covers, live versions
- **Loop detection**: Prevents getting stuck on same tracks
- **`[AUTO]` indicator**: Shows in now-playing when track was auto-queued

### 📋 Queue Management
- Paginated queue view with ETA and total duration
- Remove, move, skip to specific tracks
- Shuffle, loop (off/track/queue)
- Back/replay navigation
- Queue persistence across restarts (24/7 mode)

### 🎛️ Audio Filters
9 presets with custom EQ curves:

| Preset | Description |
|--------|-------------|
| `bassboost` | Gentle bass boost (+3dB sub-bass) - warm, no distortion |
| `nightcore` | Speed 1.25x, pitch 1.2x - anime/happy hardcore style |
| `vaporwave` | Speed 0.85x, pitch 0.8x - slowed, dreamy aesthetic |
| `soft` | FullSound EQ - warm mids, enhanced vocals |
| `karaoke` | Center channel cancellation - reduces lead vocals |
| `8d` | Rotating stereo panning (0.15 Hz) - immersive effect |
| `vibrato` | Pitch modulation (8 Hz, 100%) - wobble/synth effect |
| `tremolo` | Volume modulation (4 Hz, 60%) - pulsating effect |
| `radio` | Lo-fi telephone effect - cuts lows & highs + lowpass |

### 💰 Economy System
- **Currency**: 🍞 (bread)
- `/hourly` - Claim reward every hour
- `/balance` - Check your or someone's balance
- `/leaderboard` - Server ranking

### 🎰 Gambling Games
| Game | Description |
|------|-------------|
| `/blackjack [bet]` | Classic 21 card game with Hit/Stand/Double |
| `/slots [bet]` | Slot machine with multipliers (up to 10x) |
| `/roulette <red\|black\|green> [bet]` | Roulette with color bets |
| `/coinflip <heads/tails> [bet]` | 50/50 coin flip |
| `/rps solo <choice>` | Rock-Paper-Scissors vs bot |
| `/rps duel <opponent> [bet]` | Duel another user with hidden move selection |

### ⚙️ Guild Configuration
- DJ role requirement for admin commands
- Vote-skip with configurable threshold (`0.0`-`1.0`)
- 24/7 mode with queue persistence
- Custom announce channel
- Max volume limit

### 🌐 Web Dashboard
- Discord OAuth2 login + protected dashboard routes
- Tabs for **Settings**, **Status**, **Player**, **Economy**, **Control**
- Live player state and bot session history
- Per-guild configuration without typing all options in slash commands
- `/dashboard` command opens the right guild panel directly

---

## Commands Reference

### 🎵 Music
| Command | Description |
|---------|-------------|
| `/play <query>` | Play track/playlist (YouTube, Spotify, SoundCloud) |
| `/skip` | Skip current track (vote-skip if configured) |
| `/stop` | Stop playback and clear queue |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/seek <time>` | Seek to position (e.g., `1:30`, `90`) |
| `/back` | Go back to previous track |
| `/replay` | Replay current track from start |
| `/nowplaying` | Show current track info |

### 📋 Queue
| Command | Description |
|---------|-------------|
| `/queue` | Show queue with pagination |
| `/remove <start> [end]` | Remove track(s) from queue |
| `/move <from> <to>` | Move track in queue |
| `/skipto <index>` | Skip to specific position |
| `/shuffle` | Shuffle the queue |
| `/loop <off\|track\|queue>` | Set repeat mode |
| `/clearqueue` | Clear upcoming tracks |
| `/autoplay` | Toggle autoplay (plays similar tracks) |

### 🎛️ Audio
| Command | Description |
|---------|-------------|
| `/volume <0-100>` | Set volume (bounded by maxVolume) |
| `/filter preset <name>` | Apply audio filter |
| `/filter list` | Show active filters |
| `/filter clear` | Reset all filters and EQ |

### ⚙️ Settings
| Command | Description |
|---------|-------------|
| `/dashboard` | Open web dashboard for current server |
| `/config get` | Show current configuration |
| `/config set` | Configure guild settings |
| `/config reset` | Restore default settings |
| `/leave` | Disconnect bot from voice channel |

### 💰 Economy
| Command | Description |
|---------|-------------|
| `/hourly` | Claim hourly reward (50-150 🍞) |
| `/balance [user]` | Check balance |
| `/leaderboard` | Server top 10 ranking |

### 🎰 Games
| Command | Description |
|---------|-------------|
| `/blackjack [bet]` | Play blackjack (min bet: 10 🍞) |
| `/slots [bet]` | Spin the slot machine |
| `/roulette <red\|black\|green> [bet]` | Spin roulette |
| `/coinflip <side> [bet]` | Flip a coin |
| `/rps solo <choice>` | Play RPS against bot |
| `/rps duel <opponent> [bet]` | Challenge user with hidden moves |
| `/8ball <question>` | Ask magic 8-ball |
| `/roll [dice]` | Roll dice notation (e.g. `2d20`) |

### 🎮 Fun
| Command | Description |
|---------|-------------|
| `/bread` | Send some fresh bread 🍞 |
| `/help` | Show help menu |
| `/ping` | Check bot latency |

---

## Dashboard & OAuth Setup

For dashboard auth to work, set these environment variables:
- `DISCORD_CLIENT_SECRET`
- `WEB_URL`
- `SESSION_SECRET`

Discord OAuth2 redirect URI must match:

```text
{WEB_URL}/api/auth/callback
```

Example for local development:

```text
http://localhost:3000/api/auth/callback
```

If you deploy dashboard externally, set `DASHBOARD_URL` so `/dashboard` points to your public domain.

---

## Permissions

| Command Type | Required Permission |
|--------------|---------------------|
| Admin commands (`/stop`, `/volume`, `/filter`, `/remove`, `/move`) | DJ role OR Manage Guild OR Administrator |
| Playback buttons | Must be in same voice channel as bot |
| Vote-skip | Anyone in voice channel (configurable threshold) |

---

## Timeouts & Auto-leave

| Scenario | Timeout |
|----------|---------|
| Bot alone in channel | 30 seconds |
| Bot idle (nothing playing) | 5 minutes (configurable) |
| Configure via | `/config set afk_timeout` |

---

## Lavalink Configuration

### Minimal `application.yml`
```yaml
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
  lavasrc:
    providers:
      - "ytsearch:\"%ISRC%\""
      - "ytsearch:%QUERY%"
    sources:
      spotify: true
      applemusic: false
      deezer: false
      yandexmusic: false
    spotify:
      clientId: "your_spotify_client_id"
      clientSecret: "your_spotify_client_secret"
      countryCode: "PL"
      playlistLoadLimit: 6
      albumLoadLimit: 6
```

### Required Plugins
Place these in `lavalink/plugins/`:
- `youtube-plugin-1.x.x.jar` - [GitHub](https://github.com/lavalink-devs/youtube-source)
- `lavasrc-plugin-4.x.x.jar` - [GitHub](https://github.com/topi314/LavaSrc)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `401 Unauthorized` | Check Lavalink password matches in `.env` and `application.yml` |
| No YouTube results | Verify `youtube-plugin` loaded correctly |
| Spotify not working | Check `SPOTIFY_CLIENT_ID/SECRET` and restart Lavalink |
| WebSocket 1006 | Check firewall, host/port, Java version (17/21) |
| Autoplay not working | Check Lavalink/YouTube search and try a different seed track |
| Filter not clearing | Use `/filter clear` - resets both filters and EQ |
| Vibrato too weak | It's now set to 8 Hz / 100% depth - should be very noticeable |

---

## Project Structure

```
src/
├── bot.js              # Main entry, event handlers
├── config.js           # Environment configuration
├── server.js           # Express API + OAuth + dashboard endpoints
├── register-commands.js
├── commands/
│   └── index.js        # Slash command definitions
├── music/
│   ├── autoplay.js     # Autoplay with YouTube Mix + candidate scoring
│   ├── embeds.js       # Now-playing embed builder
│   ├── ui.js           # Button components & mutex locks
│   ├── idleTracker.js  # Auto-leave logic
│   ├── skipManager.js  # Vote-skip & skip handling
│   ├── voteManager.js  # Vote tracking
│   ├── queueFormatter.js # Queue pagination
│   ├── searchUtils.js  # Track search helpers
│   └── utils.js        # Music utilities
├── state/
│   ├── guildConfig.js  # Per-guild settings
│   ├── queueStore.js   # Queue persistence
│   ├── fileStore.js    # JSON file storage
│   ├── searchCache.js  # Search result caching
│   └── analyticsStore.js # Dashboard analytics persistence
├── games/
│   ├── blackjack.js    # Blackjack game logic
│   ├── gambling.js     # Slots, coinflip, RPS
│   ├── economy.js      # Balance, hourly, leaderboard
│   └── fun.js          # RPS logic
└── utils/
    ├── commandError.js # Error handling
    ├── interactions.js # Interaction helpers
    └── time.js         # Time formatting

lavalink/
├── application.yml     # Lavalink config
└── plugins/            # JAR plugins

data/
├── configs.json        # Guild configurations
├── economy.json        # User balances
└── queues.json         # Saved queues (24/7 mode)

web/
├── app/                # Next.js App Router pages
├── components/         # Dashboard + landing UI components
├── lib/                # API client and utilities
└── public/assets/      # Static dashboard/landing assets
```

---

Made with 🍞 and AI assistance.
