import { test, expect } from '@playwright/test';

test('released landing has canonical metadata, same-site dashboard and no preview stamp', async ({ page, isMobile }) => {
  const forbidden: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || /discord(app)?\.com$/.test(url.hostname) || request.resourceType() === 'media') forbidden.push(url.href);
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Bread - Music for your Discord');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'http://127.0.0.1:3100');
  await expect(page.locator('footer')).not.toContainText('Local preview');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/assets\/landing-preview\/activity.png$/);
  for (const link of await page.getByRole('link', { name: 'Dashboard', exact: true }).all()) await expect(link).toHaveAttribute('href', '/dashboard');
  if (!isMobile) await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Add to Discord', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Private access');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(forbidden).toEqual([]);
});

test('production catalogue works without a session and rejects untrusted writes', async ({ request }) => {
  const headers = { Origin: 'http://127.0.0.1:3100' };
  const response = await request.post('/demo/api/search', { headers, data: { query: 'Quebonafide' } });
  expect(response.status()).toBe(200);
  expect((await response.json()).tracks[0].title).toBe('BUBBLETEA');
  expect((await request.post('/demo/api/search', { headers: { Origin: 'https://evil.example' }, data: { query: 'Quebonafide' } })).status()).toBe(403);
  expect((await request.post('/demo/api/search', { headers, data: null })).status()).toBe(400);
  expect((await request.get('/preview/landing')).status()).toBe(404);
  expect((await request.post('/preview/api/search', { headers, data: { query: 'test' } })).status()).toBe(404);
});

test('product showcase starts with Dashboard, exposes lyrics and the edge notch returns to top', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Bread Activity/ }).click();
  await expect(page.getByRole('dialog', { name: 'Activity screenshot' })).toContainText('Bread / Activity');
  await page.keyboard.press('Escape');
  const showcaseTabs = page.getByRole('tablist', { name: 'Explore Bread' });
  await expect(showcaseTabs.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#product-panel img')).toHaveAttribute('src', /dashboard\.png$/);
  await showcaseTabs.getByRole('tab', { name: 'Live lyrics' }).click();
  await expect(page.locator('#product-panel img')).toHaveAttribute('src', /lyrics\.png$/);

  const notch = page.locator('button[aria-label="Back to top"]');
  await expect(notch).toHaveAttribute('data-visible', 'false');
  await expect(notch).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    const hero = document.getElementById('main-content');
    window.scrollTo(0, hero ? hero.offsetTop + hero.offsetHeight + 1 : innerHeight);
  });
  await expect(notch).toHaveAttribute('data-visible', 'true');
  await expect(notch).toHaveAttribute('aria-hidden', 'false');
  await notch.hover();
  const notchBox = await notch.boundingBox();
  expect(notchBox && Math.abs(notchBox.y + notchBox.height - (page.viewportSize()?.height || 0))).toBeLessThanOrEqual(1);
  await notch.click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3_000 }).toBeLessThan(2);
  await expect(notch).toHaveAttribute('data-visible', 'false');
});

test('sample queue and native Activity keep working when live search is unavailable', async ({ page }) => {
  const api: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Queue BUBBLETEA', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('BUBBLETEA');
  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Activity', exact: true }).click();
  const activity = page.frameLocator('iframe[title="Bread Activity preview"]');
  await expect(activity.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await activity.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(activity.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await expect(activity.getByRole('button', { name: 'Autoplay off', exact: true })).toBeDisabled();
  await activity.getByRole('button', { name: /^Queue/ }).click();
  await expect(activity.getByRole('complementary', { name: 'queue panel' })).toContainText('BUBBLETEA');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(api).toEqual([]);
});

test('root Activity handoff remains separate from marketing', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/?frame_id=test&instance_id=test&platform=desktop');
  await expect(page).toHaveTitle('Bread Activity');
  await expect(page.getByRole('heading', { name: 'Try Bread.' })).toHaveCount(0);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
});
