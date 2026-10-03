import { expect, test, type Page, type Route } from '@playwright/test';

const guildId = '123456789012345678';

const current = {
  title: 'Digital Love',
  author: 'Daft Punk',
  uri: 'https://www.youtube.com/watch?v=current',
  duration: 301_000,
  position: 42_000,
  requester: 'tester',
  seekable: true,
  isStream: false,
};

const candidates = [
  { title: 'Midnight City', author: 'M83', uri: 'https://www.youtube.com/watch?v=m83', duration: 243_000, source: 'lastfm' },
  { title: 'Kids', author: 'MGMT', uri: 'https://www.youtube.com/watch?v=mgmt', duration: 302_000, source: 'radio' },
];

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
}

// A tiny stateful player: like toggles, reroll advances the prepared track.
async function mockAutoplayApi(page: Page) {
  const state = { feedback: null as 'like' | null, next: 0, actions: [] as string[] };
  const status = () => ({
    connected: true,
    playing: true,
    paused: false,
    voiceChannelId: 'voice-1',
    voiceChannelName: 'General',
    currentTrack: current,
    queueLength: 0,
    repeatMode: 'off',
    volume: 80,
    filters: null,
    autoplay: true,
    autoplayNext: candidates[state.next],
    autoplayFeedback: state.feedback,
    autoplayRateable: true,
    voteSkip: null,
    sessionHistory: [],
  });
  const queue = () => ({ current, tracks: [], total: 0, page: 0, totalPages: 0, revision: `rev-${state.next}` });
  const access = {
    accessLevel: 'member', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: false,
    canQueue: true, canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: false, maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const action = path.match(/\/player\/([a-z_]+)$/)?.[1];

    if (request.method() === 'POST' && action?.startsWith('autoplay_')) {
      state.actions.push(action);
      if (action === 'autoplay_like') {
        state.feedback = state.feedback === 'like' ? null : 'like';
        return json(route, { success: true, liked: state.feedback === 'like' });
      }
      if (action === 'autoplay_reroll') {
        state.next = (state.next + 1) % candidates.length;
        return json(route, { success: true });
      }
      return json(route, { success: true, message: 'Skipped', voteSkip: null });
    }
    if (path === '/api/me') return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status());
    if (path.endsWith('/queue')) return json(route, queue());
    if (path.endsWith('/player/events')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `event: snapshot\ndata: ${JSON.stringify({ status: status(), queue: queue() })}\n\n`,
      });
    }
    if (path.endsWith('/player/filters')) return json(route, { presets: [] });
    return json(route, {});
  });
  return { state, status, queue };
}

// The real stream stays open; a closed one marks the player offline. Hold the
// request and answer it only when the test wants to push a fresh snapshot.
async function holdPlayerEvents(page: Page, snapshot: () => unknown) {
  const pending: Route[] = [];
  await page.route('**/api/guilds/*/player/events?*', (route) => { pending.push(route); });
  return async () => {
    const route = pending.shift();
    await route?.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: snapshot
data: ${JSON.stringify(snapshot())}

`,
    });
  };
}

test('dashboard listeners can like, reroll and dislike autoplay picks', async ({ page }) => {
  const { state } = await mockAutoplayApi(page);
  await page.goto(`/dashboard/${guildId}?view=player`);

  const like = page.getByRole('button', { name: /^Like/ });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();
  await expect(page.getByRole('button', { name: 'Remove like' })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByText('Midnight City')).toBeVisible();
  await expect(page.getByText(/Last\.fm • M83/)).toBeVisible();
  await expect(page.getByText('Queue is empty')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pick a different next track' }).click();
  await expect(page.getByText('Kids', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Dislike and skip/ }).click();
  await expect.poll(() => state.actions).toEqual(['autoplay_like', 'autoplay_reroll', 'autoplay_dislike']);
});

test('Activity shows autoplay feedback and the prepared next track', async ({ page }) => {
  const { state, status, queue } = await mockAutoplayApi(page);
  const pushSnapshot = await holdPlayerEvents(page, () => ({ status: status(), queue: queue() }));
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

  const like = activity.getByRole('button', { name: 'Like', exact: true }).first();
  await like.click();
  await expect(activity.getByRole('button', { name: 'Liked', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');

  await activity.getByRole('button', { name: 'Queue' }).click();
  const queuePanel = activity.getByRole('complementary', { name: 'queue panel' });
  await expect(queuePanel.getByText('Midnight City')).toBeVisible();
  await expect(queuePanel.getByText('Queue is empty')).toHaveCount(0);
  await queuePanel.getByRole('button', { name: 'Pick a different next track' }).click();
  await expect.poll(() => state.next).toBe(1);
  await pushSnapshot();
  await expect(queuePanel.getByText('Kids', { exact: true })).toBeVisible();
  expect(state.actions).toEqual(['autoplay_like', 'autoplay_reroll']);
});
