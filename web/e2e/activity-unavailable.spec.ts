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
  await expect(runner.getByText('Press space or tap to play')).toBeVisible();

  await runner.click();
  await expect(runner).toHaveAttribute('data-state', 'running');
  await expect.poll(() => runner.locator('.activity-runner-score span').last().textContent()).not.toBe('00000');
  // The toast eventually burns on an obstacle when nobody jumps.
  await expect(runner).toHaveAttribute('data-state', 'over', { timeout: 15_000 });
  await expect(runner.getByText('Burnt! Tap to try again')).toBeVisible();
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
