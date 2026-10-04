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

type Sound = { preset: string | null; eq: number[]; speed: number; pitch: number };

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockSoundApi(page: Page, { dj }: { dj: boolean }) {
  const state = { sound: { preset: null, eq: [0, 0, 0, 0, 0, 0], speed: 1, pitch: 1 } as Sound, sent: [] as Sound[] };
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
    filters: state.sound.preset,
    sound: state.sound,
    autoplay: false,
    voteSkip: null,
    sessionHistory: [],
  });
  const queue = () => ({ current, tracks: [], total: 0, page: 0, totalPages: 0, revision: 'rev-1' });
  const access = {
    accessLevel: dj ? 'dj' : 'member', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: dj,
    canQueue: true, canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: false, maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/player/sound')) {
      const body = request.postDataJSON() as { sound: Sound };
      state.sent.push(body.sound);
      state.sound = body.sound;
      return json(route, { success: true, filter: body.sound.preset, sound: body.sound });
    }
    if (path === '/api/me') return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status());
    if (path.endsWith('/queue')) return json(route, queue());
    if (path.endsWith('/player/filters')) return json(route, { presets: [] });
    return json(route, {});
  });
  // Keep the event stream open so the player stays online.
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

test('DJs shape the sound from the Activity panel', async ({ page }) => {
  const state = await mockSoundApi(page, { dj: true });
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: 'Sound', exact: true }).first().click();
  const panel = activity.getByRole('complementary', { name: 'sound panel' });
  await expect(panel.getByText('Presets, EQ, speed and pitch')).toBeVisible();

  await panel.getByRole('button', { name: 'Nightcore' }).click();
  await expect.poll(() => state.sent.at(-1)?.preset).toBe('nightcore');
  await expect(panel.getByRole('button', { name: 'Nightcore' })).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('slider', { name: /^Bass / }).fill('4');
  await panel.getByRole('slider', { name: /^Speed / }).fill('1.2');
  await expect.poll(() => state.sent.at(-1)).toEqual({ preset: 'nightcore', eq: [0, 4, 0, 0, 0, 0], speed: 1.2, pitch: 1 });
  await expect(activity.getByRole('button', { name: 'Sound (custom)' }).first()).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('button', { name: 'Reset sound' }).click();
  await expect.poll(() => state.sent.at(-1)).toEqual({ preset: null, eq: [0, 0, 0, 0, 0, 0], speed: 1, pitch: 1 });
  await expect(panel.getByRole('button', { name: 'Reset sound' })).toBeDisabled();
});

test('listeners without DJ see the sound settings read-only', async ({ page }) => {
  const state = await mockSoundApi(page, { dj: false });
  state.sound = { preset: 'bassboost', eq: [2, 0, 0, 0, 0, -1], speed: 1, pitch: 1 };
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: 'Sound (custom)' }).first().click();
  const panel = activity.getByRole('complementary', { name: 'sound panel' });
  await expect(panel.getByText(/Only DJs can change the sound/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Bass boost' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Bass boost' })).toBeDisabled();
  await expect(panel.getByRole('slider', { name: /^Sub \+2 dB/ })).toBeDisabled();
  expect(state.sent).toEqual([]);
});
