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
  await expect(page.getByRole('dialog', { name: 'Activity screenshot' })).not.toBeVisible();
  const showcaseTabs = page.getByRole('tablist', { name: 'Explore Bread' });
  await expect(showcaseTabs.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#product-panel img')).toHaveAttribute('src', /dashboard\.png$/);
  await showcaseTabs.getByRole('tab', { name: 'Live lyrics' }).click();
  await expect(page.locator('#product-panel img')).toHaveAttribute('src', /lyrics\.png$/);

  const notch = page.locator('button[aria-label="Back to top"]');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(notch).toHaveAttribute('data-visible', 'false');
  await expect(notch).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    const hero = document.getElementById('main-content');
    window.scrollTo(0, hero ? window.scrollY + hero.getBoundingClientRect().bottom + 1 : innerHeight);
  });
  await expect.poll(() => page.locator('#main-content').evaluate(hero => hero.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
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
  // Smooth page scrolling keeps drawer controls inside the iframe moving while Playwright scrolls them into view.
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await page.getByRole('button', { name: 'Queue BUBBLETEA', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('BUBBLETEA');
  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Activity', exact: true }).click();
  const activity = page.frameLocator('iframe[title="Bread Activity preview"]');
  await expect(activity.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await activity.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(activity.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await activity.getByRole('button', { name: 'Autoplay off', exact: true }).click();
  await expect(activity.getByRole('button', { name: 'Autoplay on', exact: true })).toBeVisible();
  await activity.getByRole('button', { name: /^Queue/ }).click();
  await expect(activity.getByRole('complementary', { name: 'queue panel' })).toContainText('BUBBLETEA');
  await activity.getByRole('button', { name: /^Add music/ }).click();
  // Playwright only scrolls inside the iframe, so bring the whole preview into the page viewport first.
  await page.locator('iframe[title="Bread Activity preview"]').evaluate(frame => frame.scrollIntoView({ block: 'center' }));
  await activity.getByRole('tablist', { name: 'Add music view' }).getByRole('tab', { name: 'Radio' }).click();
  await activity.getByRole('button', { name: 'Play Midnight Jazz', exact: true }).click();
  await expect(activity.locator('.activity-player-stage h1')).toHaveText('Midnight Jazz');
  await page.keyboard.press('Escape');
  await expect(activity.getByRole('complementary')).toHaveCount(0);
  await activity.getByRole('button', { name: /^Volume \d+%/ }).click();
  await activity.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(activity.getByRole('complementary', { name: 'sound panel' })).toContainText('Presets, EQ, speed and pitch');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(api).toEqual([]);
});

test('the Activity demo is the real Activity: library, karaoke and /lyrics share the chat session', async ({ page }) => {
  // Karaoke closes itself without synced lyrics, so give the demo lyrics endpoint a short song.
  await page.route('**/demo/api/lyrics', route => route.fulfill({ json: { lyrics: { plainLyrics: 'First line\nSecond line', lines: [{ time: 0, text: 'First line' }, { time: 600_000, text: 'Second line' }], instrumental: false, provider: 'lrclib' } } }));
  const api: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await page.getByRole('button', { name: 'Queue BUBBLETEA', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('BUBBLETEA');
  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Activity', exact: true }).click();
  const frame = page.locator('iframe[title="Bread Activity preview"]');
  // Playwright only scrolls inside the iframe, so keep the whole preview in the page viewport.
  const center = () => frame.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await center();
  const activity = page.frameLocator('iframe[title="Bread Activity preview"]');
  await expect(activity.locator('.activity-player-stage h1')).toHaveText('Instant Crush');

  await activity.getByRole('button', { name: 'Library', exact: true }).click();
  const library = activity.getByRole('complementary', { name: 'library panel' });
  await library.getByRole('textbox', { name: 'New playlist name' }).fill('Tonight');
  await center();
  await library.getByRole('button', { name: 'Save queue' }).click();
  await center();
  await library.getByRole('button', { name: 'Open Tonight' }).click();
  await expect(library.getByText('BUBBLETEA').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activity.getByRole('complementary')).toHaveCount(0);

  await center();
  await activity.getByRole('button', { name: 'Open karaoke' }).click();
  await expect(activity.getByRole('button', { name: 'Exit karaoke' })).toBeVisible();
  await activity.getByRole('button', { name: 'Exit karaoke' }).click();
  await expect(activity.getByRole('button', { name: 'Open karaoke' })).toBeVisible();

  await page.getByRole('tablist', { name: 'Playground mode' }).getByRole('tab', { name: 'Slash commands' }).click();
  await page.getByRole('combobox', { name: 'Try a Bread command' }).fill('/lyrics');
  // The first Enter picks the suggestion, the second sends it.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(activity.getByRole('complementary', { name: 'lyrics panel' })).toBeVisible();
  expect(api).toEqual([]);
});

test('the Activity iframe loads on first use and /lyrics before that still opens the panel', async ({ page }) => {
  const frames: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/activity/demo')) frames.push(request.url()); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(frames).toEqual([]);
  await page.getByRole('combobox', { name: 'Try a Bread command' }).fill('/lyrics');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const activity = page.frameLocator('iframe[title="Bread Activity preview"]');
  await expect(activity.getByRole('complementary', { name: 'lyrics panel' })).toBeVisible();
  expect(frames.length).toBeGreaterThan(0);
});

test('root Activity handoff remains separate from marketing', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/?frame_id=test&instance_id=test&platform=desktop');
  await expect(page).toHaveTitle('Bread Activity');
  await expect(page.getByRole('heading', { name: 'Try Bread.' })).toHaveCount(0);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
});
