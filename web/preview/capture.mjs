import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3180';
const assets = path.resolve('public/assets/landing-preview');
await fs.mkdir(assets, { recursive: true });
const captures = path.resolve('../.tmp/landing-preview');
await fs.mkdir(captures, { recursive: true });
const require = createRequire(import.meta.url);
const { renderArcadeImage } = require('../../src/games/arcadeRenderer');
await fs.writeFile(path.join(assets, 'arcade.png'), await renderArcadeImage({
  type: 'slots', title: 'Slots', username: 'alex', status: 'JUST FOR FUN', detail: 'A little luck. No wager.',
  data: { symbols: ['🍞', '🍒', '💎'] },
  metrics: [{ label: 'BET', value: 'JUST FOR FUN' }, { label: 'RESULT', value: 'NO MATCH' }, { label: 'BALANCE', value: 'UNCHANGED' }],
}));
const songs = [
  ['instant-crush', 'Daft Punk Instant Crush', 'Instant Crush', 'Daft Punk', 337000],
  ['not-like-us', 'Kendrick Lamar Not Like Us', 'Not Like Us', 'Kendrick Lamar', 274000],
  ['bubbletea', 'Quebonafide BUBBLETEA', 'BUBBLETEA', 'Quebonafide', 284000],
];
for (const [id, query, , artist] of songs) {
  const destination = path.join(assets, `${id}.jpg`);
  try { await fs.access(destination); } catch {
    const trackIds = { 'not-like-us': '1781353929', 'bubbletea': '1633289330' };
    const response = await fetch(trackIds[id] ? `https://itunes.apple.com/lookup?country=PL&id=${trackIds[id]}` : `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=20`);
    const result = (await response.json()).results.find((entry) => entry.artistName?.split(', ').includes(artist) && !/remix|mixed|karaoke/i.test(entry.trackName || ''));
    if (!result?.artworkUrl100) throw new Error(`No artwork for ${query}`);
    const image = await fetch(result.artworkUrl100.replace('100x100bb', '600x600bb'));
    if (!image.ok) throw new Error('Artwork download failed');
    await fs.writeFile(destination, Buffer.from(await image.arrayBuffer()));
  }
}
const tracks = songs.map(([id, , title, author, duration], index) => ({
  title, author, duration, position: 82000, encoded: `demo-${id}`,
  uri: 'https://www.youtube.com/watch?v=a5uQMwRMHcs', artwork: `/assets/landing-preview/${id}.jpg`,
  source: 'youtube', seekable: true, isStream: false, requester: index ? 'mika' : 'alex',
}));
const status = { connected: true, playing: true, paused: false, voiceChannelId: 'voice-1', voiceChannelName: 'listening room',
  currentTrack: tracks[0], queueLength: 2, repeatMode: 'off', volume: 60, filters: null, autoplay: true, voteSkip: null, sessionHistory: [], };
const queue = { current: tracks[0], tracks: tracks.slice(1), total: 2, page: 0, totalPages: 1, revision: 'demo' };
const guildId = '123456789012345678';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    localStorage.setItem('bread_cookie_notice_v1', 'accepted');
    window.__BREAD_TEST_ACTIVITY_SDK__ = {
      guildId: '123456789012345678', channelId: 'voice-1', ready: async () => {},
      commands: { authorize: async () => ({ code: 'demo' }), authenticate: async () => ({ access_token: 'demo' }),
        setActivity: async (options) => options.activity, openExternalLink: async () => ({ opened: true }) },
    };
  });
  await page.addInitScript((snapshot) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('/player/events')) {
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
          init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
        } }), { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return originalFetch(input, init);
    };
  }, { status, queue });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const send = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (p.endsWith('/player/events')) return route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ status, queue })}\n\n` });
    if (p.endsWith('/status')) return send(status);
    if (p.endsWith('/queue')) return send(queue);
    if (p.endsWith('/me')) return send({ id: 'demo-user', username: 'alex', global_name: 'Alex', avatar: '' });
    if (p.endsWith('/access')) return send({ accessLevel: 'admin', canAccess: true, canView: true, canControlPlayer: true, canQueue: true, canUpload: true, canManageConfig: true, canManageEconomy: true, canUseRemoteControl: true, maxVolume: 100 });
    if (p === '/api/guilds') return send([{ id: guildId, name: 'The listening room', icon: null, permissions: 8, bot_present: true, access_level: 'admin', can_access: true }]);
    if (p === '/api/activity/config') return send({ enabled: true, clientId: 'demo' });
    if (p === '/api/activity/token') return send({ access_token: 'demo' });
    if (p.endsWith('/config')) return send({ defaultVolume: 60, maxVolume: 100, autoplay: true, dashboardAccess: 'admin', voteSkipPercent: 50 });
    if (p.endsWith('/health')) return send({ api: { ok: true }, discord: { ok: true, ping: 26 }, lavalink: { ok: true }, player: { exists: true, connected: true } });
    if (p.endsWith('/channels') || p.endsWith('/roles')) return send([]);
    if (p.endsWith('/player/filters')) return send({ presets: [] });
    return send({ success: true });
  });
  await page.goto(`${base}/dashboard/${guildId}?view=player`);
  await page.getByText('Instant Crush').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(assets, 'dashboard.png') });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(assets, 'dashboard-phone.png') });
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.setContent(`<iframe title="Activity" src="${base}/activity?frame_id=demo&instance_id=demo&platform=desktop" style="width:100%;height:100vh;border:0"></iframe><style>body{margin:0}</style>`);
  const activity = page.frameLocator('iframe');
  await activity.getByText('Music Activity').waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  const frame = page.frames().find((entry) => entry.url().includes('/activity'));
  await frame.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: path.join(assets, 'activity.png') });
  await activity.locator('.activity-player-stage').screenshot({ path: path.join(assets, 'activity-hero.png') });
  await activity.getByRole('button', { name: /^Queue/ }).click();
  await activity.getByRole('complementary', { name: 'queue panel' }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(assets, 'activity-queue.png') });
  await page.setViewportSize({ width: 360, height: 600 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(assets, 'activity-queue-phone.png') });
  await activity.getByRole('complementary', { name: 'queue panel' }).getByRole('button', { name: 'Close panel' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(assets, 'activity-phone.png') });
  await activity.locator('.activity-player-stage').screenshot({ path: path.join(assets, 'activity-mobile.png') });
  await page.setViewportSize({ width: 360, height: 260 });
  await page.waitForTimeout(400);
  await activity.locator('.activity-compact-player').screenshot({ path: path.join(assets, 'activity-compact.png') });
  console.log('Captured actual Bread UI with illustrative data. No backend or Discord connection.');
} finally {
  await browser.close();
}
