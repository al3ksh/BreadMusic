import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = process.env.LANDING_TEST_ORIGIN || 'http://localhost:3181';
const landingPath = process.env.LANDING_TEST_PATH || '/preview/landing';
const output = path.resolve('.tmp/landing-preview');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const tracks = [{ title: 'TACONAFIDE - Tamagotchi', artist: 'Taco Hemingway', duration: '3:25', uri: 'https://www.youtube.com/watch?v=odWxQ5eEnfE', artwork: '/assets/landing-preview/instant-crush.jpg', cover: '', seekable: true }];
try {
  for (const [label, width, height] of [['desktop',1920,1040],['laptop',1536,832],['small-laptop',1366,668],['mobile',390,844],['small-mobile',320,568]]) {
    if (process.env.VIEWPORT_FILTER && !label.includes(process.env.VIEWPORT_FILTER)) continue;
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    const forbidden = [];
    page.on('request', req => { const url = new URL(req.url()); if (url.pathname.startsWith('/api/') || /discord(app)?\.com/.test(url.hostname) || req.resourceType() === 'media') forbidden.push(req.url()); });
    await page.route('**/demo/api/search', route => { const query = route.request().postDataJSON().query; return route.fulfill({ json: query === 'broken' ? { error: 'Source unavailable. Retry.' } : { tracks: query === 'empty' ? [] : tracks, playlist: null }, status: query === 'broken' ? 503 : 200 }); });
    await page.addInitScript(() => localStorage.setItem('bread_cookie_notice_v1', 'accepted'));
    await page.goto(`${base}${landingPath}`, { waitUntil:'networkidle' });
    await expect(page.getByRole('heading',{level:1,name:'Bread'})).toBeVisible();
    const hero = await page.locator('#main-content').boundingBox();
    expect(hero.y + hero.height).toBeLessThan(height - 5);
    await page.locator('#inside-bread').getByRole('tab',{name:'Dashboard',exact:true}).click();
    await page.getByRole('button',{name:'Expand Dashboard screenshot'}).click();
    await expect(page.getByRole('dialog',{name:'Dashboard screenshot'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({ path:path.join(output,`${label}-live-hero.png`) });
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const playground = page.locator('#playground');
    await playground.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    const log = page.getByRole('log');
    const input = page.getByRole('combobox');
    if (width <= 620) {
      const composer = await input.boundingBox();
      expect(composer.y).toBeGreaterThanOrEqual(0);
      expect(composer.y + composer.height).toBeLessThanOrEqual(height);
      for (const name of ['Send command', 'Reset demo', 'Show demo queue', 'Toggle navigation']) {
        const target = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(target.height, `${name} touch height`).toBeGreaterThanOrEqual(44);
      }
      const samples = await page.getByRole('complementary', { name: 'Demo music library' }).boundingBox();
      expect(samples.y).toBeGreaterThan(composer.y);
    }
    const send = async command => { await input.fill(command); await input.press('Escape'); await input.press('Enter'); await expect(log).toHaveAttribute('aria-busy','false'); };
    const live = log.locator('[data-live-player]');
    const title = await live.getByRole('heading').boundingBox();
    const bounds = await log.boundingBox();
    expect(title.y).toBeGreaterThanOrEqual(bounds.y);
    if (width >= 1000) {
      const controls = await page.getByRole('button',{name:'Open Activity preview'}).boundingBox();
      expect(controls.y+controls.height).toBeLessThanOrEqual(bounds.y+bounds.height);
      const composer = await input.boundingBox();
      expect(composer.y+composer.height).toBeLessThanOrEqual(height);
    }
    await playground.screenshot({path:path.join(output,`${label}-live-commands.png`)});
    await send('/play taconafide');
    await expect(log.locator('article').last()).toContainText('Tamagotchi');
    await send('/pause'); await send('/volume 35'); await send('/seek 2:10');
    await page.getByRole('button',{name:'Open Activity preview'}).click();
    const activity = page.frameLocator('iframe[title="Bread Activity preview"]').getByTestId('activity-demo');
    await expect(activity).toBeVisible();
    await expect(activity.getByRole('button',{name:'Resume',exact:true})).toBeEnabled();
    await expect(activity.getByRole('slider',{name:'Track position',exact:true})).toHaveValue('130000');
    await expect(activity.getByRole('button',{name:'Autoplay off',exact:true})).toBeDisabled();
    await expect(activity.getByRole('button',{name:'Volume 35%',exact:true})).toBeVisible();
    await playground.screenshot({path:path.join(output,`${label}-live-activity.png`)});
    await activity.getByRole('button',{name:/^Queue/}).click();
    await expect(activity.locator('.activity-queue-row')).toHaveCount(3);
    await expect(activity.getByRole('complementary',{name:'queue panel'})).toContainText('Tamagotchi');
    await activity.getByRole('button',{name:'Remove Not Like Us'}).click();
    await expect(activity.locator('.activity-queue-row')).toHaveCount(2);
    await playground.screenshot({path:path.join(output,`${label}-live-queue.png`)});
    await activity.locator('aside').getByRole('button',{name:'Close panel',exact:true}).click();
    await expect(activity.locator('aside')).not.toBeVisible();
    await activity.getByRole('button',{name:'Add music',exact:true}).click();
    await activity.getByRole('textbox',{name:'Search for a track'}).fill('Tamagotchi');
    await activity.getByRole('textbox',{name:'Search for a track'}).press('Enter');
    await expect(activity.locator('.activity-search-result')).toHaveCount(1);
    await activity.getByRole('button',{name:'Play TACONAFIDE - Tamagotchi now'}).click();
    await playground.screenshot({path:path.join(output,`${label}-live-search.png`)});
    await activity.locator('aside').getByRole('button',{name:'Close panel',exact:true}).click();
    await expect(activity.locator('.activity-track-copy h1')).toHaveText('TACONAFIDE - Tamagotchi');
    await page.getByRole('tab',{name:'Slash commands',exact:true}).click();
    await expect(live).toContainText('Tamagotchi');
    const returnedTitle = await live.getByRole('heading').boundingBox();
    const returnedLog = await log.boundingBox();
    expect(returnedTitle.y).toBeGreaterThanOrEqual(returnedLog.y);
    expect(returnedTitle.y + returnedTitle.height).toBeLessThanOrEqual(returnedLog.y + returnedLog.height);
    await send('/play broken'); await expect(playground.getByRole('alert')).toContainText('Source unavailable');
    await send('/play empty'); await expect(log.locator('article').last()).toContainText('No results found');
    await send('/slots'); await expect(log.locator('article').last().locator('picture img')).toBeVisible();
    const gallery = page.getByRole('region',{name:'Bread Arcade gallery'});
    await gallery.scrollIntoViewIfNeeded();
    await gallery.getByRole('button',{name:'Blackjack',exact:true}).click();
    await expect(gallery.locator('img[data-active=true]')).toHaveAttribute('alt',/Blackjack/);
    await page.waitForTimeout(500);
    await gallery.screenshot({path:path.join(output,`${label}-live-arcade.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(forbidden).toEqual([]);
    console.log(`${label}: shared queue, controls, search, errors, silent isolation, responsive layout passed`);
    await page.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
