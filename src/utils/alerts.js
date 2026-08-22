const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_DISK_MIN_MB = 512;
const DEFAULT_RSS_MAX_MB = 650;
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_GEMINI_INTERVAL_MS = 60_000;
const DEFAULT_DISK_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_MEMORY_INTERVAL_MS = 60_000;

const SEVERITY_COLORS = {
  error: 0xef4444,
  warning: 0xf59e0b,
  recovery: 0x22c55e,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function createAlertManager({
  transports = [],
  thresholds = {},
  now = () => Date.now(),
  logger = (message) => console.warn(message),
} = {}) {
  const states = new Map();

  function getState(key) {
    let state = states.get(key);
    if (!state) {
      state = { failures: 0, successes: 0, alerted: false, lastDetail: null };
      states.set(key, state);
    }
    return state;
  }

  async function dispatch(kind, key, detail, severity = 'error') {
    if (!transports.length) return;
    const embed = {
      title: kind === 'recovery' ? `Resolved: ${key}` : `${severity === 'warning' ? 'Warning' : 'Failure'}: ${key}`,
      description: String(detail || '').trim()
        || (kind === 'recovery' ? 'Service returned to normal.' : 'Condition persisted.'),
      color: SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.error,
      footer: { text: 'Bread monitoring' },
      timestamp: new Date(now()).toISOString(),
    };
    const payload = { embeds: [embed] };

    await Promise.allSettled(
      transports.map(async (transport) => {
        try {
          await transport(payload, { kind, key });
        } catch (error) {
          logger(`[Alerts] Transport failed (${key}/${kind}): ${error.message}`);
        }
      }),
    );
  }

  async function recordFailure(key, detail = '', options = {}) {
    const state = getState(key);
    state.successes = 0;
    state.failures += 1;
    state.lastDetail = detail || state.lastDetail;

    const threshold = Math.max(1, options.threshold ?? thresholds[key] ?? DEFAULT_FAILURE_THRESHOLD);
    if (state.alerted) return false;
    if (state.failures < threshold) return false;

    state.alerted = true;
    await dispatch('failure', key, state.lastDetail, options.severity ?? 'error');
    return true;
  }

  async function recordSuccess(key, detail = '') {
    const state = getState(key);
    const wasAlerted = state.alerted;
    state.failures = 0;
    state.successes += 1;

    if (!wasAlerted) return false;

    state.alerted = false;
    await dispatch('recovery', key, detail || `${key} recovered.`);
    return true;
  }

  function snapshot() {
    return Object.fromEntries([...states.entries()].map(([key, state]) => [key, {
      failures: state.failures,
      alerted: state.alerted,
    }]));
  }

  return { recordFailure, recordSuccess, snapshot };
}

function createDmTransport(client, userId, { logger = () => {} } = {}) {
  let resolvedUserId = userId ? String(userId) : null;

  return async (payload) => {
    if (!client?.isReady?.()) throw new Error('client not ready for DM');

    if (!resolvedUserId) {
      const application = await client.application.fetch();
      const owner = application?.owner;
      const ownerId = owner?.ownerId ?? owner?.id ?? null;
      if (!ownerId) throw new Error('no alert DM recipient configured');
      resolvedUserId = String(ownerId);
      logger(`[Alerts] DM recipient resolved from the application owner (${resolvedUserId}).`);
    }

    const user = await client.users.fetch(resolvedUserId);
    if (!user) throw new Error('alert DM user not found');
    await user.send(payload);
  };
}

async function checkDiskSpace({ dataDir, minBytes, statfsImpl = fs.promises.statfs }) {
  const stats = await statfsImpl(dataDir);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  return {
    ok: freeBytes >= minBytes,
    freeBytes,
    minBytes,
    detail: `${formatBytes(freeBytes)} free in ${dataDir} (minimum ${formatBytes(minBytes)})`,
  };
}

function startMonitoring({
  client,
  alerter,
  dataDir = path.join(process.cwd(), 'data'),
  intervalMs = DEFAULT_INTERVAL_MS,
  geminiIntervalMs = DEFAULT_GEMINI_INTERVAL_MS,
  diskIntervalMs = DEFAULT_DISK_INTERVAL_MS,
  memoryIntervalMs = DEFAULT_MEMORY_INTERVAL_MS,
  diskMinBytes = DEFAULT_DISK_MIN_MB * 1024 * 1024,
  rssMaxBytes = DEFAULT_RSS_MAX_MB * 1024 * 1024,
  statfsImpl,
  getMemoryUsageBytes,
  getLavalinkStatus,
  getDiscordStatus,
  getGeminiStatus,
} = {}) {
  const timers = [];
  const safeTick = (fn) => () => Promise.resolve(fn()).catch((error) =>
    console.warn('[Alerts] monitor tick failed:', error.message));

  const lavalinkStatus = getLavalinkStatus ?? (() => ({
    ok: [...(client.lavalink?.nodeManager?.nodes?.values() ?? [])].some((node) => node.connected),
    detail: '',
  }));
  const discordStatus = getDiscordStatus ?? (() => ({
    ok: Boolean(client.isReady?.()),
    detail: `ws status ${client.ws?.status ?? 'unknown'}`,
  }));

  const serviceTick = safeTick(async () => {
    const lavalink = lavalinkStatus();
    if (lavalink.ok) {
      await alerter.recordSuccess('lavalink', 'A Lavalink node reconnected.');
    } else {
      await alerter.recordFailure('lavalink', lavalink.detail || 'No Lavalink node is connected.', { threshold: 2 });
    }

    const discord = discordStatus();
    if (discord.ok) {
      await alerter.recordSuccess('discord', 'The Discord gateway reconnected.');
    } else {
      await alerter.recordFailure('discord', discord.detail || 'The Discord gateway is disconnected.');
    }
  });

  const geminiTick = safeTick(async () => {
    if (typeof getGeminiStatus !== 'function') return;
    const gemini = getGeminiStatus();
    if (!gemini.enabled) return;
    if (gemini.circuitOpen) {
      const minutes = Math.max(1, Math.round((gemini.retryInMs || 0) / 60_000));
      await alerter.recordFailure(
        'gemini',
        `Gemini autoplay has been failing for several cycles; retrying in ~${minutes} min. Classic autoplay continues in affected guilds.`,
        { threshold: 5, severity: 'warning' },
      );
    } else {
      await alerter.recordSuccess('gemini', 'Gemini autoplay recovered.');
    }
  });

  const memoryUsageBytes = getMemoryUsageBytes ?? (() => process.memoryUsage().rss);

  const memoryTick = safeTick(async () => {
    const rss = memoryUsageBytes();
    if (!Number.isFinite(rss)) return;
    if (rss <= rssMaxBytes) {
      await alerter.recordSuccess('memory', `Process memory back to ${formatBytes(rss)}.`);
    } else {
      await alerter.recordFailure(
        'memory',
        `Bot process is using ${formatBytes(rss)} RSS (limit ${formatBytes(rssMaxBytes)}). Restart the bot before the container gets killed.`,
        { threshold: 3 },
      );
    }
  });

  const diskTick = safeTick(async () => {
    const disk = await checkDiskSpace({ dataDir, minBytes: diskMinBytes, statfsImpl });
    if (disk.ok) {
      await alerter.recordSuccess('disk', disk.detail);
    } else {
      await alerter.recordFailure('disk', disk.detail, { threshold: 2 });
    }
  });

  timers.push(setInterval(serviceTick, intervalMs));
  timers.push(setInterval(geminiTick, geminiIntervalMs));
  timers.push(setInterval(diskTick, diskIntervalMs));
  timers.push(setInterval(memoryTick, memoryIntervalMs));
  timers.forEach((timer) => timer.unref?.());

  return {
    stop() {
      timers.forEach((timer) => clearInterval(timer));
    },
    checks: { serviceTick, geminiTick, diskTick, memoryTick },
  };
}

module.exports = {
  createAlertManager,
  createDmTransport,
  checkDiskSpace,
  startMonitoring,
};
