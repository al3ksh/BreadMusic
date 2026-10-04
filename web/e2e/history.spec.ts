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

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockHistoryApi(page: Page) {
  const state = {
    liked: [] as string[],
    added: [] as { playlistId: string; uri: string }[],
    queued: [] as string[],
  };
  const status = {
    connected: true, playing: true, paused: false, voiceChannelId: 'voice-1', voiceChannelName: 'General', currentTrack: current,
    queueLength: 0, repeatMode: 'off', volume: 80, filters: null, autoplay: false, voteSkip: null, sessionHistory: [],
  };
  const access = {
    accessLevel: 'member', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: false,
    canQueue: true, canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: false, maxVolume: 100,
  };
  const history = {
    items: [
      { id: 'h1', playedAt: Date.now() - 60_000, autoplay: false, track: { title: 'Old favourite', author: 'Bread Band', uri: 'https://www.youtube.com/watch?v=old', duration: 200_000, artwork: null, source: 'youtube' }, requester: null },
      { id: 'h2', playedAt: Date.now() - 120_000, autoplay: true, track: { title: 'Upload clip', author: 'Someone', uri: '', duration: 90_000, artwork: null, source: 'local' }, requester: null },
    ],
    page: 0, limit: 25, total: 2, totalPages: 1,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.method() === 'POST' ? (request.postDataJSON() ?? {}) : {};
    if (path.endsWith('/library/liked/add')) {
      state.liked.push(body.uri);
      return json(route, { success: true, liked: true, title: 'Old favourite' });
    }
    const add = path.match(/\/library\/playlists\/([^/]+)\/add$/);
    if (add) {
      state.added.push({ playlistId: add[1], uri: body.uri });
      return json(route, { success: true, added: 1, skipped: 0 });
    }
    if (path.endsWith('/library')) {
      return json(route, { liked: [], playlists: [{ id: 'pl-1', name: 'Road trip', trackCount: 2, duration: 400_000, artwork: null }] });
    }
    if (request.method() === 'POST' && path.endsWith('/player/play')) {
      state.queued.push(body.query);
      return json(route, { success: true, title: 'Old favourite' });
    }
    if (path.endsWith('/history')) return json(route, history);
    if (path === '/api/me') return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status);
    if (path.endsWith('/queue')) return json(route, { current, tracks: [], total: 0, page: 0, totalPages: 0, revision: 'rev-1' });
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

test('listeners like, save and re-queue tracks from history', async ({ page }) => {
  const state = await mockHistoryApi(page);
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: /^Queue/ }).first().click();
  const panel = activity.getByRole('complementary', { name: 'queue panel' });
  await panel.getByRole('tab', { name: 'History' }).click();
  await expect(panel.getByText('Old favourite')).toBeVisible();

  // A non-DJ listener can queue and save, but not jump the queue.
  await expect(panel.getByRole('button', { name: 'Play Old favourite now' })).toHaveCount(0);
  // Rows without a link (uploads) have nothing to save or replay.
  await expect(panel.getByRole('button', { name: 'Like Upload clip' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Like Old favourite' }).click();
  await expect(panel.getByRole('button', { name: 'Old favourite is liked' })).toBeDisabled();
  expect(state.liked).toEqual(['https://www.youtube.com/watch?v=old']);

  await panel.getByRole('button', { name: 'Add Old favourite to a playlist' }).click();
  await panel.getByRole('menuitem', { name: 'Road trip' }).click();
  await expect.poll(() => state.added).toEqual([{ playlistId: 'pl-1', uri: 'https://www.youtube.com/watch?v=old' }]);
  await expect(panel.getByRole('menu', { name: 'Add to playlist' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Add Old favourite to queue' }).click();
  await expect.poll(() => state.queued).toEqual(['https://www.youtube.com/watch?v=old']);
});
