import { test, expect, type Locator } from '@playwright/test';

async function swipe(element: Locator, x: number, y = 0, cancel = false) {
  const box = await element.boundingBox();
  if (!box) throw new Error('Swipe surface is missing');
  const start = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 100) };
  const session = await element.page().context().newCDPSession(element.page());
  try {
    // Native touch input covers implicit capture and scroll cancellation, not only React handlers.
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 8; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + x * i / 8, y: start.y + y * i / 8 }] });
    await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

test('gallery supports swipes, cancellation, arrows, animated exit and focus restoration', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /Bread Activity/ });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect.poll(() => dialog.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
  const surface = dialog.locator('picture').locator('..');
  await swipe(surface, -100);
  await expect(dialog).toHaveAccessibleName('Dashboard screenshot');
  await swipe(surface, -100, 0, true);
  await expect(dialog).toHaveAccessibleName('Dashboard screenshot');
  await swipe(surface, 5, 100);
  await expect(dialog).toHaveAccessibleName('Dashboard screenshot');
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toHaveAccessibleName('Shared queue screenshot');
  await dialog.getByRole('button', { name: 'Previous screenshot' }).click();
  await expect(dialog).toHaveAccessibleName('Dashboard screenshot');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await trigger.click();
  await expect(dialog).toHaveAccessibleName('Activity screenshot');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('mobile menu, compact footer, sharp hero and both demo modes remain usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile layout contract');
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation).not.toBeVisible();
  await menu.tap();
  await expect(navigation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(navigation).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.tap();
  await page.getByText('YouTube', { exact: true }).tap();
  await expect(navigation).not.toBeVisible();
  await menu.tap();
  await navigation.getByRole('link', { name: 'Try Bread' }).tap();
  await expect(navigation).not.toBeVisible();
  await page.getByRole('button', { name: 'Queue BUBBLETEA', exact: true }).tap();
  await expect(page.getByRole('log')).toContainText('BUBBLETEA');
  await expect.poll(() => page.evaluate(() => {
    const panel = document.getElementById('demo-panel-commands')!.getBoundingClientRect();
    const send = document.querySelector('[aria-label="Send command"]')!.getBoundingClientRect();
    return send.bottom - panel.bottom;
  })).toBeLessThanOrEqual(0);
  const input = page.getByRole('combobox', { name: 'Try a Bread command' });
  await input.fill('/pau');
  await page.getByRole('option', { name: /\/pause/ }).tap();
  await page.getByRole('button', { name: 'Send command' }).tap();
  await expect(page.getByRole('log').getByRole('button', { name: 'Resume playback' })).toBeEnabled();
  const slash = await page.locator('#demo-panel-commands').boundingBox();
  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Activity' }).tap();
  const activity = await page.locator('#demo-panel-activity').boundingBox();
  expect(Math.abs(slash!.height - activity!.height)).toBeLessThan(2);
  const footer = await page.locator('footer').boundingBox();
  expect(footer!.height).toBeLessThan(140);
  const image = page.locator('#main-content img[fetchpriority="high"]');
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThanOrEqual(900);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Activity demo drawers reverse interrupted exits and preserve touch button states', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Activity' }).click();
  const frame = page.frameLocator('iframe[title="Bread Activity preview"]');
  const queue = frame.getByRole('button', { name: /^Queue/ }).first();
  await queue.click();
  const drawer = frame.getByRole('complementary', { name: 'queue panel' });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
  // A second close must not postpone removal; reopening must cancel the old completion.
  await drawer.getByRole('button', { name: 'Close panel' }).evaluate(el => { (el as HTMLElement).click(); });
  await expect(drawer).toHaveClass(/is-closing/);
  await queue.evaluate(el => (el as HTMLElement).click());
  await expect(drawer).not.toHaveClass(/is-closing/);
  await expect.poll(() => drawer.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
  await expect(drawer).toBeVisible();
  if (isMobile) {
    const header = drawer.locator('.activity-drawer-header');
    await swipe(header, 0, 35, true);
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate(el => el.getAnimations().some(a => a.playState === 'running'))).toBe(false);
    await swipe(header, 0, 120);
    await expect(drawer).not.toBeVisible();
    await expect(queue).not.toHaveClass(/active/);
    await expect.poll(() => queue.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  } else {
    await page.locator('iframe[title="Bread Activity preview"]').scrollIntoViewIfNeeded();
    await drawer.getByRole('button', { name: 'Close panel' }).click();
    await expect(drawer).not.toBeVisible();
  }
});
