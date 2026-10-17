import { expect, test, type Page } from '@playwright/test';
import { json, mockApi } from './mockApi';

async function openActivity(page: Page, guildId: string | null = '123456789012345678') {
  // The shared mock closes the live stream after one snapshot, which marks the player offline;
  // keep it pending so the initial connected status stands.
  await page.route('**/api/guilds/*/player/events?*', () => new Promise<void>(() => undefined));
  await page.addInitScript((sdkGuildId) => {
    window.__BREAD_TEST_ACTIVITY_SDK__ = {
      guildId: sdkGuildId,
      channelId: 'voice-1',
      ready: async () => undefined,
      commands: {
        authorize: async () => ({ code: 'test-code' }),
        authenticate: async () => ({ access_token: 'test-activity-token' }),
        openExternalLink: async () => ({ opened: true }),
        setActivity: async (options) => options.activity,
      },
    };
  }, guildId);
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><iframe title="Bread Activity" src="http://127.0.0.1:3100/activity?frame_id=test&instance_id=test&platform=desktop" style="width:100%;height:100vh;border:0"></iframe>');
  return page.frameLocator('iframe[title="Bread Activity"]');
}

test('Activity reports the bot offline when the config proxy fails and offers the runner game', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/activity/config', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
  await page.route('**/api/healthz', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
  const activity = await openActivity(page);

  await expect(activity.getByRole('heading', { name: 'Bot is offline' })).toBeVisible({ timeout: 30_000 });
  await expect(activity.getByText('Activity is not configured')).toHaveCount(0);
  const runner = activity.locator('.activity-runner');
  await expect(runner).toHaveAttribute('data-state', 'idle');
  await expect(runner.getByText('Jump on the beat, hold to float. Space or tap to play')).toBeVisible();
  const invite = await runner.locator('canvas').boundingBox();

  await runner.click();
  await expect(runner).toHaveAttribute('data-state', 'running');
  // Starting a run folds the message into a bar and gives the game the room, Retry included.
  await expect(activity.locator('.activity-outage.is-stage')).toBeVisible();
  await expect(activity.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect.poll(async () => (await runner.locator('canvas').boundingBox())?.width ?? 0).toBeGreaterThan(invite?.width ?? 0);
  await expect.poll(() => runner.locator('.activity-runner-score span').last().textContent()).not.toBe('00000');
  // The toast eventually burns when nobody jumps.
  await expect(runner).toHaveAttribute('data-state', 'over', { timeout: 30_000 });
  await expect(runner.getByText(/Burnt!/)).toBeVisible();
});

test('Runner mute does not start a run and is remembered', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/activity/config', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
  await page.route('**/api/healthz', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
  let activity = await openActivity(page);

  const mute = activity.getByRole('button', { name: 'Mute game sound' });
  await mute.click();
  await expect(activity.getByRole('button', { name: 'Unmute game sound' })).toHaveAttribute('aria-pressed', 'true');
  await expect(activity.locator('.activity-runner')).toHaveAttribute('data-state', 'idle');
  await expect(activity.locator('.activity-outage.is-stage')).toHaveCount(0);

  activity = await openActivity(page);
  await expect(activity.getByRole('button', { name: 'Unmute game sound' })).toBeVisible({ timeout: 30_000 });
});

/** Reports the bot down until `recover` is called, the way /api/healthz does during an outage. */
async function botOutage(page: Page) {
  let healthy = false;
  await page.route('**/api/activity/config', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
  await page.route('**/api/healthz', (route) => json(route, { discord: { ok: healthy }, lavalink: { ok: true } }));
  return { recover: () => { healthy = true; } };
}

test('Activity reloads into the player once the bot is back', async ({ page }) => {
  await page.clock.install();
  await mockApi(page);
  const outage = await botOutage(page);
  let loads = 0;
  page.on('request', (request) => {
    if (request.url().includes('/activity?frame_id=')) loads += 1;
  });
  const activity = await openActivity(page);
  await expect(activity.getByRole('heading', { name: 'Bot is offline' })).toBeVisible({ timeout: 30_000 });
  expect(loads).toBe(1);

  outage.recover();
  await page.clock.fastForward(10_000);
  await expect.poll(() => loads).toBe(2);
});

test('Activity asks instead of reloading twice in a row', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    if (window.location.port === '3100') window.sessionStorage.setItem('bread-activity-recovery-at', String(Date.now()));
  });
  await mockApi(page);
  const outage = await botOutage(page);
  const activity = await openActivity(page);
  await expect(activity.getByRole('heading', { name: 'Bot is offline' })).toBeVisible({ timeout: 30_000 });

  outage.recover();
  await page.clock.fastForward(10_000);
  await expect(activity.getByRole('heading', { name: 'Bread is back' })).toBeVisible();
  await expect(activity.getByRole('button', { name: 'Open player' })).toBeVisible();
});

test('Activity lets a run finish when the bot comes back mid-game', async ({ page }) => {
  await page.clock.install();
  await mockApi(page);
  const outage = await botOutage(page);
  const activity = await openActivity(page);
  await expect(activity.getByRole('heading', { name: 'Bot is offline' })).toBeVisible({ timeout: 30_000 });
  await activity.locator('.activity-runner').click();
  await expect(activity.locator('.activity-outage.is-stage')).toBeVisible();

  outage.recover();
  await page.clock.fastForward(10_000);
  await expect(activity.getByRole('heading', { name: 'Bread is back' })).toBeVisible();
  await expect(activity.getByRole('button', { name: 'Open player' })).toBeVisible();
  await expect(activity.locator('.activity-runner')).toBeVisible();
});

test('Activity does not call a failing token exchange an expired session', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/activity/token', (route) => route.fulfill({ status: 502, json: { error: 'Bad gateway' } }));
  await page.route('**/api/healthz', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));
  const activity = await openActivity(page);

  await expect(activity.getByRole('heading', { name: 'Bot is offline' })).toBeVisible({ timeout: 30_000 });
  await expect(activity.getByRole('heading', { name: 'Session expired' })).toHaveCount(0);
});

test('Activity explains private calls and still lets the user play', async ({ page }) => {
  await mockApi(page);
  const activity = await openActivity(page, null);

  await expect(activity.getByRole('heading', { name: 'Bread plays on servers' })).toBeVisible({ timeout: 30_000 });
  await expect(activity.locator('.activity-runner')).toBeVisible();
});

test('Activity keeps the auth screen free of the game', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/activity/token', (route) => route.fulfill({ status: 401, json: { error: 'Invalid code' } }));
  const activity = await openActivity(page);

  await expect(activity.getByRole('heading', { name: 'Session expired' })).toBeVisible({ timeout: 30_000 });
  await expect(activity.locator('.activity-runner')).toHaveCount(0);
});

test('Artwork stays on the player while lyrics load and does not open karaoke without synced lyrics', async ({ page }) => {
  await mockApi(page);
  let release: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/guilds/*/lyrics', async (route) => {
    await answered;
    return json(route, { id: 1, title: 'Test track', artist: 'Bread', album: null, duration: 180, instrumental: false, plainLyrics: 'Only plain words', syncedLyrics: '' });
  });
  const activity = await openActivity(page);
  await expect(activity.getByText('Music Activity')).toBeVisible({ timeout: 30_000 });

  await activity.getByRole('button', { name: 'Open karaoke' }).click();
  await expect(activity.getByText('Finding lyrics')).toBeVisible();
  await expect(activity.locator('.activity-karaoke-stage')).toHaveCount(0);

  release();
  await expect(activity.getByText('Synced lyrics are unavailable for this track.')).toBeVisible();
  await expect(activity.locator('.activity-karaoke-stage')).toHaveCount(0);
  await expect(activity.locator('.activity-player-stage')).toBeVisible();
});

test('Artwork opens karaoke once synced lyrics arrive', async ({ page }) => {
  await mockApi(page);
  let lyricsRequests = 0;
  await page.route('**/api/guilds/*/lyrics', (route) => {
    lyricsRequests += 1;
    return json(route, { id: 1, title: 'Test track', artist: 'Bread', album: null, duration: 180, instrumental: false, plainLyrics: 'First line', syncedLyrics: '[00:00.00] First line\n[09:00.00] Second line' });
  });
  const activity = await openActivity(page);
  await expect(activity.getByText('Music Activity')).toBeVisible({ timeout: 30_000 });

  await activity.getByRole('button', { name: 'Open karaoke' }).click();
  await expect(activity.locator('.activity-karaoke-stage')).toBeVisible();
  await expect(activity.locator('.activity-karaoke-lines .is-current')).toHaveText('First line');
  // Opening karaoke reuses the lyrics it just fetched instead of loading them again.
  expect(lyricsRequests).toBe(1);
});
