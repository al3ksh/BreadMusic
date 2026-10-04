import { expect, test, type Page, type Route } from '@playwright/test';

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

const track = (title: string, id: string) => ({
  title,
  author: 'Bread Band',
  uri: `https://www.youtube.com/watch?v=${id}`,
  duration: 200_000,
  requester: 'tester',
  seekable: true,
  isStream: false,
});

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockQueueApi(page: Page) {
  const state = {
    tracks: [track('First song', 'a'), track('Second song', 'b'), track('Third song', 'c')],
    removed: [] as number[],
  };
  const status = () => ({
    connected: true,
    playing: true,
    paused: false,
    voiceChannelId: 'voice-1',
    voiceChannelName: 'General',
    currentTrack: current,
    queueLength: state.tracks.length,
    repeatMode: 'off',
    volume: 80,
    filters: null,
    autoplay: false,
    voteSkip: null,
    sessionHistory: [],
  });
  const access = {
    accessLevel: 'dj', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: true,
    canQueue: true, canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: false, maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/player/remove')) {
      const { start } = request.postDataJSON() as { start: number };
      state.removed.push(start);
      state.tracks.splice(start, 1);
      return json(route, { success: true });
    }
    if (path === '/api/me') return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status());
    if (path.endsWith('/queue')) {
      return json(route, { current, tracks: state.tracks, total: state.tracks.length, page: 0, totalPages: 1, revision: `rev-${state.removed.length}` });
    }
    return json(route, {});
  });
  await page.route('**/api/guilds/*/player/events?*', () => {});
  return state;
}

async function openActivity(page: Page) {
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
  return activity;
}

test('removing a queue card collapses it and keeps the others', async ({ page }) => {
  const state = await mockQueueApi(page);
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: /^Queue/ }).first().click();
  const panel = activity.getByRole('complementary', { name: 'queue panel' });
  await expect(panel.getByText('Second song')).toBeVisible();

  await panel.getByRole('button', { name: 'Remove Second song' }).click();
  await expect.poll(() => state.removed).toEqual([1]);
  await expect(panel.getByText('Second song')).toHaveCount(0);
  await expect(panel.getByText('First song')).toBeVisible();
  await expect(panel.getByText('Third song')).toBeVisible();
});

test('reduced motion turns the card and panel animations off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockQueueApi(page);
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: /^Queue/ }).first().click();
  const panel = activity.getByRole('complementary', { name: 'queue panel' });
  const card = panel.locator('.activity-card').first();
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});
