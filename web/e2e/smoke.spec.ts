import { expect, test, type Page, type Route } from '@playwright/test';

const guildId = '123456789012345678';
const artwork = 'https://i.ytimg.com/vi/test/hqdefault.jpg';

const track = {
  title: 'Test track',
  author: 'Test artist',
  uri: 'https://www.youtube.com/watch?v=test',
  duration: 180_000,
  position: 12_000,
  requester: 'tester',
  artwork,
  source: 'youtube',
  seekable: true,
  isStream: false,
};

const status = {
  connected: true,
  playing: true,
  paused: false,
  voiceChannelId: 'voice-1',
  voiceChannelName: 'General',
  currentTrack: track,
  queueLength: 1,
  repeatMode: 'off',
  volume: 80,
  filters: null,
  autoplay: true,
  voteSkip: null,
  sessionHistory: [],
};

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({
    status: statusCode,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page, options: { canControlPlayer?: boolean } = {}) {
  const canControlPlayer = options.canControlPlayer ?? true;
  const access = {
    accessLevel: canControlPlayer ? 'admin' : 'member',
    dashboardAccess: canControlPlayer ? 'admin' : 'members',
    canAccess: true,
    canView: true,
    canControlPlayer,
    canQueue: true,
    canUpload: canControlPlayer,
    canManageConfig: canControlPlayer,
    canManageEconomy: canControlPlayer,
    canUseRemoteControl: canControlPlayer,
    maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/me') {
      return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    }
    if (path === '/api/guilds' && request.method() === 'GET') {
      return json(route, [{ id: guildId, name: 'Test Guild', icon: null, permissions: 8, member_count: 4, bot_present: true, access_level: 'admin', dashboard_access: 'admin', can_access: true, can_invite: false }]);
    }
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status);
    if (path.endsWith('/health')) return json(route, {
      api: { ok: true, timestamp: Date.now() },
      discord: { ok: true, wsStatusCode: 0, ping: 30 },
      lavalink: { ok: true, connectedNodes: 1, totalNodes: 1 },
      player: { exists: true, connected: true },
      playerMessageChannel: { configured: false, channelId: null, channelName: null, sendable: null },
    });
    if (path.endsWith('/insights')) return json(route, { range: '7d', summary: { totalPlays: 1, uniqueTracks: 1, uniqueUsers: 1, lastPlayAt: Date.now() }, topTracks: [], topUsers: [], trend14d: [] });
    if (path.endsWith('/queue')) return json(route, { current: track, tracks: [track], total: 1, page: 0, totalPages: 1, revision: 'test-revision' });
    if (path.endsWith('/player/events')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `event: snapshot\ndata: ${JSON.stringify({ status, queue: { current: track, tracks: [track], total: 1, page: 0, totalPages: 1, revision: 'test-revision' } })}\n\n`,
      });
    }
    if (path.endsWith('/player/search')) return json(route, { tracks: [{ ...track, encoded: 'encoded-test' }], playlist: null });
    if (path.endsWith('/player/filters')) return json(route, { presets: [] });
    if (path.endsWith('/channels') || path.endsWith('/roles')) return json(route, []);
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/config')) return json(route, { dashboardAccess: 'admin', djRoleId: null, maxVolume: 100, defaultVolume: 80, autoplay: true, persistentQueue: false, preferredSource: null, playerTextChannelId: null, playerTextChannelName: null, voteSkipPercent: 50, stayInChannel: false, afkTimeout: 300, twentyFourSevenChannelId: null, twentyFourSevenChannelName: null, voiceChannelStatus: false });
    if (request.method() === 'POST' || request.method() === 'PUT' || request.method() === 'PATCH' || request.method() === 'DELETE') return json(route, { ok: true, success: true, message: 'Action applied' });

    return json(route, {});
  });
}

test('landing reaches the mocked dashboard and player', async ({ page, isMobile }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bread' }).first()).toBeVisible();
  if (isMobile) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard' }).click();
  } else await page.getByRole('link', { name: /dashboard/i }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your Servers' })).toBeVisible();
  await page.getByRole('button', { name: /Test Guild/ }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${guildId}`));
  await page.goto(`/dashboard/${guildId}?view=player`);
  await expect(page.getByText('Music Player')).toBeVisible();
  await expect(page.getByText('Test track').first()).toBeVisible();
});

test('dashboard player controls and drawer work without horizontal overflow', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/dashboard/${guildId}?view=player`);
  await expect(page.getByText('Music Player')).toBeVisible();
  await expect(page.getByText('Test track').first()).toBeVisible();

  const sliders = page.getByRole('slider');
  await expect(sliders.first()).toBeVisible();
  await sliders.first().evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '42';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.getByPlaceholder(/paste link or search title/i).fill('test query');

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('dashboard mobile layout stays within viewport', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/${guildId}?view=player`);
  await expect(page.getByText('Music Player')).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('Activity uses mocked SDK and respects read-only access', async ({ page }) => {
  await mockApi(page, { canControlPlayer: false });
  await page.addInitScript(() => {
    window.__BREAD_TEST_RICH_PRESENCE_CALLS__ = [];
    window.__BREAD_TEST_ACTIVITY_SCOPES__ = [];
    window.__BREAD_TEST_ACTIVITY_SDK__ = {
      guildId: '123456789012345678',
      channelId: 'voice-1',
      ready: async () => undefined,
      commands: {
        authorize: async (options) => {
          window.__BREAD_TEST_ACTIVITY_SCOPES__ = Array.isArray(options.scope) ? options.scope : [];
          return { code: 'test-code' };
        },
        authenticate: async () => ({ access_token: 'test-activity-token' }),
        openExternalLink: async () => ({ opened: true }),
        setActivity: async (options) => {
          window.__BREAD_TEST_RICH_PRESENCE_CALLS__?.push(options.activity);
          return options.activity;
        },
      },
    };
  });

  await page.setContent(`<iframe title="Bread Activity" src="http://127.0.0.1:3100/activity?frame_id=test&instance_id=test&platform=desktop" style="width:100%;height:100vh;border:0"></iframe>`);
  const activity = page.frameLocator('iframe[title="Bread Activity"]');
  await expect(activity.getByText('Music Activity')).toBeVisible({ timeout: 30_000 });
  await expect(activity.getByText('View only')).toBeVisible();
  await expect(activity.getByRole('button', { name: 'Add music' })).toBeEnabled();
  await expect.poll(async () => {
    const activityFrame = page.frames().find((frame) => frame.url().includes('/activity'));
    return activityFrame?.evaluate(() => window.__BREAD_TEST_RICH_PRESENCE_CALLS__?.some((entry) => entry?.details === 'Test track'));
  }).toBe(true);
  const activityFrame = page.frames().find((frame) => frame.url().includes('/activity'));
  expect(await activityFrame?.evaluate(() => window.__BREAD_TEST_ACTIVITY_SCOPES__)).toContain('rpc.activities.write');
  await activity.getByRole('button', { name: 'Queue' }).click();
  const queuePanel = activity.getByRole('complementary', { name: 'queue panel' });
  await expect(queuePanel).toBeVisible();
  await expect(queuePanel.getByRole('button', { name: /autoplay/i })).toHaveCount(0);
  await queuePanel.getByRole('button', { name: 'Close panel' }).click();
  await activity.getByRole('button', { name: 'Add music' }).click();
  const searchPanel = activity.getByRole('complementary', { name: 'search panel' });
  await searchPanel.getByLabel('Search for a track').fill('test track');
  const playNow = searchPanel.getByRole('button', { name: 'Play Test track now' });
  if (await playNow.count()) await expect(playNow).toBeDisabled();
  await expect(searchPanel.getByRole('button', { name: 'Add Test track to queue' })).toBeEnabled();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('Activity can upload with the bot offline and reports playback starting', async ({ page }) => {
  await mockApi(page);
  const offline = { ...status, connected: false, playing: false, currentTrack: null, queueLength: 0 };
  const emptyQueue = { current: null, tracks: [], total: 0, page: 0, totalPages: 0, revision: 'empty' };
  await page.route('**/api/guilds/*/status', (route) => json(route, offline));
  await page.route('**/api/guilds/*/queue?*', (route) => json(route, emptyQueue));
  await page.route('**/api/guilds/*/player/events?*', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: snapshot\ndata: ${JSON.stringify({ status: offline, queue: emptyQueue })}\n\n`,
  }));
  await page.route('**/api/guilds/*/player/upload', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-activity-token');
    expect(route.request().headers()['x-file-name']).toBe('demo.mp3');
    return json(route, { success: true, started: true, title: 'Uploaded audio' });
  });
  await page.addInitScript(() => {
    window.__BREAD_TEST_ACTIVITY_SDK__ = {
      guildId: '123456789012345678',
      channelId: 'voice-1',
      ready: async () => undefined,
      commands: {
        authorize: async () => ({ code: 'test-code' }),
        authenticate: async () => ({ access_token: 'test-activity-token' }),
        openExternalLink: async () => ({ opened: true }),
        setActivity: async (options) => options.activity,
      },
    };
  });
  await page.setContent('<iframe title="Bread Activity" src="http://127.0.0.1:3100/activity?frame_id=test&instance_id=test&platform=desktop" style="width:100%;height:100vh;border:0"></iframe>');
  const activity = page.frameLocator('iframe[title="Bread Activity"]');
  await expect(activity.getByText('Music Activity')).toBeVisible({ timeout: 30_000 });
  await activity.getByRole('button', { name: 'Add music' }).click();
  const searchPanel = activity.getByRole('complementary', { name: 'search panel' });
  await searchPanel.locator('input[type="file"]').setInputFiles({
    name: 'demo.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('mock audio'),
  });
  await searchPanel.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(activity.getByText('Playing now: Uploaded audio')).toBeVisible();
  await expect(activity.getByRole('complementary', { name: 'queue panel' })).toBeVisible();
});
