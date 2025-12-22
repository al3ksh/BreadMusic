# 🍞 Bread Music Bot

> Note: This bot was fully AI "vibecoded" – commands, logic and docs were generated and refined with an AI assistant.

## 1. Quick start

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

# Last.fm API (required for autoplay similar artists)
LASTFM_API_KEY=your_lastfm_api_key

DEFAULT_SOURCE=ytsearch
IDLE_TIMEOUT_MS=300000
```

### Install & run
```powershell
npm install
npm run register   # register slash commands (one-time)
npm start
```

## 2. Key features

### 🎵 Music Playback
- **Multi-source support**: YouTube, Spotify, SoundCloud, Bandcamp
- **Spotify integration**: Play tracks, albums, playlists directly from Spotify links
- **Now-playing embed** with progress bar, artwork, source link and control buttons
- **Autocomplete** suggestions while typing in `/play`

### � Autoplay
- **Smart autoplay**: Automatically finds and plays similar tracks when queue ends
- **Last.fm integration**: Uses Last.fm API to discover similar artists
- **Intelligent filtering**: Excludes remixes, covers, live versions and very short/long tracks
- **Track history**: Prevents recently played tracks from repeating
- **Persistent setting**: Autoplay preference saved per guild

### �📋 Queue Management
- `/queue` - Paginated queue view with ETA and total duration
- `/remove`, `/move`, `/skipto` - Precise queue control
- `/shuffle`, `/loop off|track|queue` - Playback modes
- `/clearqueue` - Clear upcoming tracks
- `/back`, `/replay` - Navigation controls
- `/autoplay` - Toggle smart autoplay

### 🎛️ Audio Filters
- `/filter preset bassboost|nightcore|soft|vaporwave|karaoke`
- `/filter list`, `/filter clear`

### ⚙️ Guild Configuration
- `/config set` - Per-guild settings
- DJ role requirement for admin commands
- Vote-skip with configurable threshold
- 24/7 mode with queue persistence
- Custom announce channel

### 🎮 Fun & Games
- `/blackjack` - Single-player card game with betting
- `/bread` - Send some fresh bread 🍞
- `/help` - Paginated help with categories

### 🛡️ Stability
- Graceful shutdown with queue saving
- Auto-reconnect to Lavalink nodes (exponential backoff)
- Auto-leave on inactivity (configurable timeout)
- Empty channel detection (30s timeout)
- Mutex locks prevent race conditions on UI updates

## 3. Lavalink Configuration

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

### Required plugins
Place these in `lavalink/plugins/`:
- `youtube-plugin-1.x.x.jar` - [GitHub](https://github.com/lavalink-devs/youtube-source)
- `lavasrc-plugin-4.x.x.jar` - [GitHub](https://github.com/topi314/LavaSrc)

## 4. Commands Reference

### 🎵 Music
| Command | Description |
| --- | --- |
| `/play <query>` | Play a track/playlist (YouTube, Spotify, SoundCloud) |
| `/skip` | Skip current track (vote-skip if configured) |
| `/stop` | Stop playback and clear queue |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/seek <time>` | Seek to position (e.g., `1:30`, `90`) |
| `/back` | Go back to the previous track |
| `/replay` | Replay current track from start |
| `/nowplaying` | Show current track info |

### 📋 Queue
| Command | Description |
| --- | --- |
| `/queue` | Show queue with pagination |
| `/remove <start> [end]` | Remove track(s) from queue |
| `/move <from> <to>` | Move track in queue |
| `/skipto <index>` | Skip to specific position |
| `/shuffle` | Shuffle the queue |
| `/loop off\|track\|queue` | Set repeat mode |
| `/clearqueue` | Clear upcoming tracks |
| `/autoplay` | Toggle autoplay (plays similar tracks) |

### 🎛️ Audio
| Command | Description |
| --- | --- |
| `/volume <0-100>` | Set volume (bounded by maxVolume) |
| `/filter preset <name>` | Apply audio filter |
| `/filter list` | Show active filters |
| `/filter clear` | Reset all filters |

### ⚙️ Settings
| Command | Description |
| --- | --- |
| `/config get` | Show current configuration |
| `/config set` | Configure guild settings |
| `/config reset` | Restore default settings |
| `/leave` | Disconnect bot from voice channel |

### 🎮 Fun
| Command | Description |
| --- | --- |
| `/blackjack [bet]` | Play blackjack card game |
| `/bread` | Send some fresh bread 🍞 |
| `/help` | Show help menu |
| `/ping` | Check bot latency |

## 5. Permissions

- **Admin commands** (`/stop`, `/volume`, `/filter`, `/remove`, `/move`): Require DJ role or Manage Guild/Administrator
- **Playback buttons**: Only work for users in the same voice channel as the bot
- **Vote-skip**: Configurable via `/config set vote_skip_percent:<0-100>`

## 6. Timeouts & Auto-leave

| Scenario | Timeout |
| --- | --- |
| Bot alone in channel | 30 seconds |
| Bot idle (nothing playing) | 5 minutes |
| Configurable via `/config` | `afk_timeout` option |

## 7. Troubleshooting

| Issue | Solution |
| --- | --- |
| `401 Unauthorized` | Check Lavalink password matches in `.env` and `application.yml` |
| No YouTube results | Verify `youtube-plugin` loaded correctly |
| Spotify not working | Check `SPOTIFY_CLIENT_ID/SECRET` and restart Lavalink |
| WebSocket 1006 | Check firewall, host/port, Java version (17/21) |
| Autoplay not working | Check `LASTFM_API_KEY` in `.env` |
| `normalize` errors | Requires LavaDSP plugin |

## 8. Project Structure

```
src/
├── bot.js              # Main entry, event handlers
├── config.js           # Environment configuration
├── register-commands.js
├── commands/
│   └── index.js        # Slash command definitions
├── music/
│   ├── autoplay.js     # Autoplay with Last.fm integration
│   ├── embeds.js       # Now-playing embed builder
│   ├── ui.js           # Button components & mutex locks
│   ├── idleTracker.js  # Auto-leave logic
│   ├── skipManager.js  # Vote-skip & skip handling
│   ├── voteManager.js  # Vote tracking
│   └── ...
├── state/
│   ├── guildConfig.js  # Per-guild settings
│   ├── queueStore.js   # Queue persistence
│   └── searchCache.js  # Search result caching
├── games/
│   ├── blackjack.js    # Blackjack game
│   └── economy.js      # Currency system
└── utils/
    └── ...
lavalink/
├── application.yml     # Lavalink config
└── plugins/            # JAR plugins
data/
├── configs.json        # Guild configurations
├── economy.json        # User balances
└── queues.json         # Saved queues
```

---

Made with 🍞 and AI assistance.

```
