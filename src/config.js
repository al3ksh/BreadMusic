const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function loadConfig() {
  const {
    DISCORD_TOKEN,
    DISCORD_CLIENT_ID,
    DISCORD_GUILD_ID,
    LAVALINK_HOST,
    LAVALINK_PORT,
    LAVALINK_PASSWORD,
    LAVALINK_SECURE,
    LAVALINK_NODES,
    DEFAULT_SOURCE,
    IDLE_TIMEOUT_MS,
  } = process.env;

  if (!DISCORD_TOKEN) {
    throw new Error('Missing DISCORD_TOKEN in environment.');
  }

  if (!DISCORD_CLIENT_ID) {
    throw new Error('Missing DISCORD_CLIENT_ID in environment.');
  }

  if (!LAVALINK_PASSWORD && !LAVALINK_NODES) {
    throw new Error('Missing Lavalink connection details in environment.');
  }

  let nodes = [];
  if (LAVALINK_NODES) {
    try {
      const parsed = JSON.parse(LAVALINK_NODES);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('LAVALINK_NODES must be a non-empty array.');
      }

      nodes = parsed.map((node, index) => ({
        authorization: node.password ?? node.authorization ?? LAVALINK_PASSWORD,
        host: node.host ?? LAVALINK_HOST,
        port: Number(node.port ?? LAVALINK_PORT ?? 2333),
        secure: Boolean(node.secure ?? node.ssl ?? false),
        id: node.id ?? `node-${index + 1}`,
      }));
    } catch (error) {
      throw new Error(`Invalid LAVALINK_NODES JSON: ${error.message}`);
    }
  }

  if (!nodes.length) {
    if (!LAVALINK_HOST || !LAVALINK_PORT || !LAVALINK_PASSWORD) {
      throw new Error('Missing Lavalink connection details in environment.');
    }
    nodes.push({
      authorization: LAVALINK_PASSWORD,
      host: LAVALINK_HOST,
      port: Number(LAVALINK_PORT),
      secure: String(LAVALINK_SECURE).toLowerCase() === 'true',
      id: 'main-node',
    });
  }

  const enabledSources = ['youtube', 'soundcloud', 'bandcamp', 'spotify'];

  return {
    token: DISCORD_TOKEN,
    clientId: DISCORD_CLIENT_ID,
    guildId: DISCORD_GUILD_ID,
    lavalink: {
      nodes,
      defaultSource: DEFAULT_SOURCE || 'ytsearch',
      enabledSources,
    },
    behavior: {
      idleTimeoutMs: Number(IDLE_TIMEOUT_MS ?? 300000),
    },
  };
}

module.exports = {
  loadConfig,
};
