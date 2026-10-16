import { expect, test, type Page } from '@playwright/test';
import { mockApi, status, track } from './mockApi';

type PushStatus = (next: unknown) => void;

// Opens the Activity with nothing playing. The live stream stays open, as the real one does, and
// the test feeds it through window.__BREAD_TEST_PUSH_STATUS__.
async function openIdleActivity(page: Page) {
  await mockApi(page, { currentTrack: null as unknown as typeof track });
  await page.addInitScript((idle) => {
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
    const original = window.fetch.bind(window);
    const encoder = new TextEncoder();
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/player/events')) return original(input, init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const push: PushStatus = (next) => controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ status: next })}\n\n`));
          (window as unknown as { __BREAD_TEST_PUSH_STATUS__?: PushStatus }).__BREAD_TEST_PUSH_STATUS__ = push;
          push(idle);
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, { ...status, playing: false, currentTrack: null, queueLength: 0 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><iframe title="Bread Activity" src="http://127.0.0.1:3100/activity?frame_id=test&instance_id=test&platform=desktop" style="width:100%;height:100vh;border:0"></iframe>');
  const activity = page.frameLocator('iframe[title="Bread Activity"]');
  await expect(activity.getByRole('heading', { name: 'Nothing is playing' })).toBeVisible({ timeout: 30_000 });
  return activity;
}

async function startSong(page: Page) {
  const frame = page.frames().find((candidate) => candidate.url().includes('/activity'));
  await frame?.evaluate((next) => {
    (window as unknown as { __BREAD_TEST_PUSH_STATUS__?: PushStatus }).__BREAD_TEST_PUSH_STATUS__?.(next);
  }, { ...status, currentTrack: track });
}

test('The idle cover opens the runner in the player\'s place and gives it back', async ({ page }) => {
  const activity = await openIdleActivity(page);
  const cover = activity.getByRole('button', { name: 'Play a round' });

  await cover.click();
  const stage = activity.locator('.activity-game-stage');
  await expect(stage).toBeVisible();
  await expect(stage.getByText('Nothing is playing yet')).toBeVisible();
  await expect(stage.locator('.activity-runner')).toHaveAttribute('data-state', 'idle');
  await expect(activity.getByRole('button', { name: 'Add music' })).toBeVisible();

  await activity.getByRole('button', { name: 'Back to player' }).click();
  await expect(stage).toHaveCount(0);
  await expect(cover).toBeFocused();

  // Escape leaves too, as long as no run is going.
  await cover.click();
  await expect(stage.locator('.activity-runner')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stage).toHaveCount(0);
});

test('A song that starts mid-run waits for the run to end before taking the view back', async ({ page }) => {
  const activity = await openIdleActivity(page);
  await activity.getByRole('button', { name: 'Play a round' }).click();
  const runner = activity.locator('.activity-game-stage .activity-runner');
  await expect(runner).toBeFocused();
  await page.keyboard.press('Space');
  await expect(runner).toHaveAttribute('data-state', 'running');

  await startSong(page);
  const bar = activity.locator('.activity-game-bar');
  await expect(bar).toHaveAttribute('data-live', 'true');
  await expect(bar.getByText('Now playing')).toBeVisible();
  await expect(bar.getByText('Test track')).toBeVisible();
  await expect(activity.getByRole('button', { name: 'Open player' })).toBeVisible();
  await expect(runner).toHaveAttribute('data-state', 'running');

  // Nobody jumps, so the toast burns; the score stays up a moment before the player returns.
  await expect(runner).toHaveAttribute('data-state', 'over', { timeout: 30_000 });
  await expect(activity.locator('.activity-game-stage')).toHaveCount(0, { timeout: 5_000 });
  await expect(activity.getByRole('heading', { name: 'Test track' })).toBeVisible();
});

test('A song that starts before a run returns to the player at once', async ({ page }) => {
  const activity = await openIdleActivity(page);
  await activity.getByRole('button', { name: 'Play a round' }).click();
  await expect(activity.locator('.activity-game-stage .activity-runner')).toHaveAttribute('data-state', 'idle');

  await startSong(page);
  await expect(activity.locator('.activity-game-stage')).toHaveCount(0);
  await expect(activity.getByRole('button', { name: 'Open karaoke' })).toBeVisible();
});

test('An open panel pauses the run and keeps keys away from the game', async ({ page }) => {
  const activity = await openIdleActivity(page);
  await activity.getByRole('button', { name: 'Play a round' }).click();
  const runner = activity.locator('.activity-game-stage .activity-runner');
  await runner.click();
  await expect(runner).toHaveAttribute('data-state', 'running');

  await activity.getByRole('button', { name: 'Queue' }).click();
  await expect(runner).toHaveAttribute('data-state', 'paused');
  // Escape closes the panel only; the game stays open and paused.
  await page.keyboard.press('Escape');
  await expect(activity.getByRole('complementary', { name: 'queue panel' })).toHaveCount(0);
  await expect(runner).toHaveAttribute('data-state', 'paused');
});
