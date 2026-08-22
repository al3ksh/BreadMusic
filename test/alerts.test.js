const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAlertManager,
  createDmTransport,
  checkDiskSpace,
} = require('../src/utils/alerts');

function collectTranscript() {
  const sent = [];
  return {
    sent,
    transport: async (payload, meta) => {
      sent.push({ meta, title: payload.embeds[0].title });
    },
  };
}

test('alerts fire only after consecutive failures reach the threshold', async () => {
  const { sent, transport } = collectTranscript();
  const alerter = createAlertManager({ transports: [transport], thresholds: { lavalink: 2 } });

  await alerter.recordFailure('lavalink', 'down 1', { threshold: 2 });
  assert.equal(sent.length, 0);

  await alerter.recordFailure('lavalink', 'down 2', { threshold: 2 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Failure: lavalink/);

  await alerter.recordFailure('lavalink', 'still down', { threshold: 2 });
  assert.equal(sent.length, 1);
});

test('a success resets the failure streak before the threshold', async () => {
  const { sent, transport } = collectTranscript();
  const alerter = createAlertManager({ transports: [transport] });

  await alerter.recordFailure('discord', 'ws down');
  await alerter.recordSuccess('discord');
  await alerter.recordFailure('discord', 'ws down again');
  assert.equal(sent.length, 0);
});

test('recovery sends exactly one resolved message', async () => {
  const { sent, transport } = collectTranscript();
  const alerter = createAlertManager({ transports: [transport] });

  for (let index = 0; index < 3; index += 1) await alerter.recordFailure('disk', 'low space');
  assert.equal(sent.length, 1);

  assert.equal(await alerter.recordSuccess('disk'), true);
  assert.equal(await alerter.recordSuccess('disk'), false);
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /Resolved: disk/);
});

test('a failing transport never breaks the manager', async () => {
  const good = [];
  const alerter = createAlertManager({
    transports: [
      async () => {
        throw new Error('network down');
      },
      async (payload) => good.push(payload.embeds[0].title),
    ],
  });

  await alerter.recordFailure('gemini', 'breaker open', { threshold: 1, severity: 'warning' });
  assert.deepEqual(good, ['Warning: gemini']);
});

test('snapshot exposes per-key alert state', async () => {
  const alerter = createAlertManager({ transports: [] });
  await alerter.recordFailure('lavalink', 'x', { threshold: 5 });
  assert.deepEqual(alerter.snapshot(), { lavalink: { failures: 1, alerted: false } });
});

test('dm transport resolves the application owner when no id is configured', async () => {
  const sent = [];
  const client = {
    isReady: () => true,
    application: { fetch: async () => ({ owner: { ownerId: '111222333444555666' } }) },
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          sent.push({ id, payload });
        },
      }),
    },
  };
  const transport = createDmTransport(client, null);

  await transport({ embeds: [{ title: 'Test' }] }, { kind: 'failure', key: 'lavalink' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, '111222333444555666');
});

test('disk space check compares available bytes against the minimum', async () => {
  const gb = 1024 * 1024 * 1024;
  const statfs = async () => ({ bavail: 10, bsize: gb });

  const healthy = await checkDiskSpace({ dataDir: '/data', minBytes: 5 * gb, statfsImpl: statfs });
  assert.equal(healthy.ok, true);

  const low = await checkDiskSpace({ dataDir: '/data', minBytes: 20 * gb, statfsImpl: statfs });
  assert.equal(low.ok, false);
  assert.match(low.detail, /free in \/data/);
});

test('memory tick alerts when RSS stays above the configured limit', async () => {
  const { sent, transport } = collectTranscript();
  const alerter = createAlertManager({ transports: [transport] });
  const { startMonitoring } = require('../src/utils/alerts');
  let rss = 700 * 1024 * 1024;
  let clock = 0;

  const monitor = startMonitoring({
    client: { isReady: () => true, lavalink: { nodeManager: { nodes: new Map() } } },
    alerter,
    rssMaxBytes: 650 * 1024 * 1024,
    diskMinBytes: 512 * 1024 * 1024,
    statfsImpl: async () => ({ bavail: 1024, bsize: 1024 }),
    getMemoryUsageBytes: () => rss,
    getLavalinkStatus: () => ({ ok: true }),
    getDiscordStatus: () => ({ ok: true }),
    now: () => clock,
    intervalMs: 60_000,
  });

  await monitor.checks.serviceTick();
  await monitor.checks.diskTick();

  await monitor.checks.memoryTick();
  assert.equal(sent.length, 0);
  await monitor.checks.memoryTick();
  assert.equal(sent.length, 0);
  await monitor.checks.memoryTick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Failure: memory/);

  rss = 300 * 1024 * 1024;
  await monitor.checks.memoryTick();
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /Resolved: memory/);

  monitor.stop();
});
