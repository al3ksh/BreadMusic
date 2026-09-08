import { test, expect } from '@playwright/test';

test('landing motion preserves navigation and pauses the Arcade clock during interaction', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Explore Bread' });
  await tabs.getByRole('tab', { name: 'Dashboard' }).focus();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Live lyrics' })).toBeFocused();
  await expect(page.locator('#product-panel img')).toHaveAttribute('src', /lyrics\.png$/);
  await expect.poll(() => tabs.evaluate(el => getComputedStyle(el).getPropertyValue('--view-index').trim())).toBe('2');

  const gallery = page.getByRole('region', { name: 'Bread Arcade gallery' });
  await gallery.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const clockState = () => gallery.evaluate(el => el.getAnimations({ subtree: true }).find(animation => animation.effect?.getTiming().duration === 6000)?.playState);
  await expect.poll(clockState).toBe('running');
  await gallery.hover();
  await expect.poll(clockState).toBe('paused');
  await page.mouse.move(0, 0);
  await expect.poll(clockState).toBe('running');
  await gallery.getByRole('button', { name: 'Pause slideshow' }).focus();
  await expect.poll(clockState).toBe('paused');
  await gallery.getByRole('button', { name: 'Slots', exact: true }).click();
  await expect(gallery.getByRole('button', { name: 'Slots', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await gallery.getByRole('button', { name: 'Resume slideshow' }).click();
  await gallery.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.mouse.move(0, 0);
  await expect.poll(clockState).toBe('running');
  await gallery.evaluate(el => {
    const clock = el.getAnimations({ subtree: true }).find(animation => animation.effect?.getTiming().duration === 6000);
    if (clock) clock.currentTime = 5900;
  });
  await expect(gallery.getByRole('button', { name: 'Roulette', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(clockState).toBe('paused');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reduced motion keeps the landing static and all gallery tabs usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.locator('#main-content').evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  const gallery = page.getByRole('region', { name: 'Bread Arcade gallery' });
  await gallery.scrollIntoViewIfNeeded();
  await expect(gallery.getByRole('button', { name: 'Pause slideshow' })).toBeDisabled();
  await gallery.getByRole('button', { name: 'Blackjack', exact: true }).click();
  await expect(gallery.getByRole('button', { name: 'Blackjack', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await gallery.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test('screenshot gallery gives its close control visible pointer and keyboard feedback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Bread Activity/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Activity screenshot' });
  const close = dialog.getByRole('button', { name: 'Close dialog' });
  await close.hover();
  await expect.poll(() => close.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
});
