import { expect, test, type Page } from '@playwright/test';
import { guildId, json, mockApi, status, track } from './mockApi';

function guild(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, icon: null, permissions: 8, member_count: 12, bot_present: true, access_level: 'admin', dashboard_access: 'admin', can_access: true, can_invite: false, ...extra };
}

const guilds = [
  guild(guildId, 'Test Guild'),
  guild('223456789012345678', 'Alpha Beats', { access_level: 'mod', member_count: 340 }),
  guild('323456789012345678', 'Beta Lounge', { access_level: 'member' }),
  guild('423456789012345678', 'Gamma Room'),
  guild('523456789012345678', 'Delta Den', { access_level: 'member' }),
  guild('623456789012345678', 'Quiet Beta Corner', { bot_present: false }),
  guild('723456789012345678', 'Empty Server', { bot_present: false }),
];

async function mockGuilds(page: Page, respond: () => Promise<unknown> | unknown = () => guilds) {
  await page.route('**/api/guilds', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    try {
      return json(route, await respond());
    } catch {
      return json(route, { error: 'Server list is unavailable' }, 500);
    }
  });
}

// The cookie notice sits over the bottom of the page on phones; these tests are not about it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('bread_cookie_notice_v1', 'accepted'));
});

test.describe('dashboard select', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.goto(`/dashboard/${guildId}`);
    await expect(page.getByRole('heading', { name: 'Server Settings' })).toBeVisible();
  });

  test('opens on click and picks an option', async ({ page }) => {
    const access = page.getByRole('combobox', { name: 'Dashboard Access' });
    await expect(access).toHaveText('Administrators only');
    await expect(access).toHaveAttribute('aria-expanded', 'false');

    await access.click();
    const list = page.getByRole('listbox', { name: 'Dashboard Access' });
    await expect(list).toBeVisible();
    await expect(access).toHaveAttribute('aria-expanded', 'true');
    await expect(list.getByRole('option')).toHaveCount(3);
    await expect(list.getByRole('option', { name: 'Administrators only' })).toHaveAttribute('aria-selected', 'true');

    await list.getByRole('option', { name: 'All server members' }).click();
    await expect(list).toBeHidden();
    await expect(access).toHaveText('All server members');
  });

  test('works from the keyboard and closes on Escape', async ({ page }) => {
    const source = page.getByRole('combobox', { name: 'Preferred Source' });
    await expect(source).toHaveText('Auto');
    await source.focus();

    await page.keyboard.press('ArrowDown');
    const list = page.getByRole('listbox', { name: 'Preferred Source' });
    await expect(list).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    await expect(source).toHaveText('YouTube');
    await expect(source).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(source).toBeFocused();
    await expect(source).toHaveText('YouTube');

    // Typing a letter on the closed select jumps to the next matching option.
    await page.keyboard.press('s');
    await expect(source).toHaveText('SoundCloud');
  });

  test('closes when clicking outside without changing the value', async ({ page }) => {
    const access = page.getByRole('combobox', { name: 'Dashboard Access' });
    await access.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('heading', { name: 'Server Settings' }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(access).toHaveText('Administrators only');
  });
});

test('each guild view has its own header', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/guilds/*/history**', (route) => json(route, { items: [], page: 1, limit: 25, total: 0, totalPages: 0 }));
  await page.goto(`/dashboard/${guildId}?view=history`);
  await expect(page.getByRole('heading', { name: 'Listening History', level: 2 })).toBeVisible();
  await expect(page.getByText('Everything played here, ready to queue again')).toBeVisible();
  await page.goto(`/dashboard/${guildId}?view=status`);
  await expect(page.getByRole('heading', { name: 'Server Status' })).toBeVisible();
  await expect(page.getByText('Bot health, connections and listening stats')).toBeVisible();
});

test.describe('server list', () => {
  test('filters servers and keeps servers without the bot folded away', async ({ page }) => {
    await mockApi(page);
    await mockGuilds(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Your Servers' })).toBeVisible();
    await expect(page.getByText('5 servers with Bread')).toBeVisible();
    await expect(page.getByRole('button', { name: /Alpha Beats/ })).toContainText('Mod');

    const noBot = page.getByRole('button', { name: /Bot not present/ });
    await expect(noBot).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Empty Server')).toBeHidden();
    await noBot.click();
    await expect(noBot).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Empty Server')).toBeVisible();
    await noBot.click();

    await page.getByRole('searchbox', { name: 'Filter servers' }).fill('beta');
    await expect(page.getByRole('button', { name: /Beta Lounge/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alpha Beats/ })).toBeHidden();
    // Matches among servers without the bot are revealed while filtering.
    await expect(page.getByText('Quiet Beta Corner')).toBeVisible();
    await expect(page.getByText('Empty Server')).toBeHidden();

    await page.getByRole('searchbox', { name: 'Filter servers' }).fill('nothing here');
    await expect(page.getByText(/No servers match/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(page.getByRole('button', { name: /Gamma Room/ })).toBeVisible();

    await page.getByRole('button', { name: /Gamma Room/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/423456789012345678/);
  });

  test('shows a skeleton while loading and recovers from an error with Retry', async ({ page }) => {
    await mockApi(page);
    // Dev mode runs effects twice, so every request made before the release fails, not just the first.
    let released = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = () => { released = true; resolve(); }; });
    await mockGuilds(page, async () => {
      if (!released) {
        await gate;
        throw new Error('first load fails');
      }
      return guilds;
    });
    await page.goto('/dashboard');

    await expect(page.getByTestId('guilds-loading')).toBeVisible();
    release();
    await expect(page.getByText('Could not load your servers')).toBeVisible();
    await expect(page.getByTestId('guilds-loading')).toBeHidden();

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: /Test Guild/ })).toBeVisible();
  });

  test('short lists do not show the filter', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /Test Guild/ })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Filter servers' })).toHaveCount(0);
  });
});

const twoTrackQueue = {
  current: track,
  tracks: [{ ...track, title: 'First up', uri: 'https://example.com/1' }, { ...track, title: 'Second up', uri: 'https://example.com/2' }],
  total: 2,
  page: 0,
  totalPages: 1,
  revision: 'two',
};

async function mockPlayer(page: Page, playerStatus: Record<string, unknown>, queue: Record<string, unknown>) {
  const actions: { action: string; body: unknown }[] = [];
  await page.route('**/api/guilds/*/player/events?*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `event: snapshot\ndata: ${JSON.stringify({ status: playerStatus, queue })}\n\n`,
  }));
  await page.route('**/api/guilds/*/status', (route) => json(route, playerStatus));
  await page.route('**/api/guilds/*/queue**', (route) => json(route, queue));
  await page.route('**/api/guilds/*/player/*', (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const action = new URL(request.url()).pathname.split('/').pop()!;
    const body = request.postDataJSON();
    actions.push({ action, body });
    // Keep the mocked queue in step so the refetch after a move agrees with the UI.
    const tracks = queue.tracks as unknown[] | undefined;
    if (action === 'move' && tracks) tracks.splice(body.to, 0, tracks.splice(body.from, 1)[0]);
    return json(route, { ok: true, success: true });
  });
  return actions;
}

test.describe('player accessibility', () => {
  test('volume, autoplay and seek are usable from the keyboard', async ({ page }) => {
    await mockApi(page);
    const actions = await mockPlayer(page, status, twoTrackQueue);
    await page.goto(`/dashboard/${guildId}?view=player`);

    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /of 3:00$/);
    const volume = page.getByRole('slider', { name: 'Volume' });
    await expect(volume).toHaveAttribute('aria-valuenow', '80');
    await volume.focus();
    await page.keyboard.press('ArrowRight');
    await expect(volume).toHaveAttribute('aria-valuenow', '90');
    await page.keyboard.press('Home');
    await expect(volume).toHaveAttribute('aria-valuetext', '0%');
    await expect.poll(() => actions.filter((a) => a.action === 'volume').map((a) => (a.body as { volume: number }).volume)).toEqual([90, 0]);

    await expect(page.getByRole('button', { name: /^Autoplay/ })).toHaveAttribute('aria-pressed', 'true');
    // No filter is active, so there is nothing to clear.
    await expect(page.getByRole('button', { name: 'Clear filter' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Audio filter' })).toHaveText('Audio filter');
  });

  test('queue rows can be reordered and removed from the keyboard', async ({ page }) => {
    await mockApi(page);
    const actions = await mockPlayer(page, status, structuredClone(twoTrackQueue));
    await page.goto(`/dashboard/${guildId}?view=player`);

    await expect(page.getByText('2 tracks', { exact: true })).toBeVisible();
    const handle = page.getByRole('button', { name: 'Reorder First up' });
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    const rows = page.getByRole('list', { name: 'Queued tracks' }).getByRole('listitem');
    await expect(rows.first()).toContainText('Second up');
    await expect(page.getByRole('button', { name: 'Reorder First up' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Remove Second up' })).toBeVisible();
    await expect.poll(() => actions.find((a) => a.action === 'move')?.body).toEqual({ from: 0, to: 1 });
  });

  test('a disconnected bot gets an explanation instead of dead controls', async ({ page }) => {
    await mockApi(page);
    await mockPlayer(page, { ...status, connected: false, playing: false, currentTrack: null }, { current: null, tracks: [], total: 0, page: 0, totalPages: 0, revision: 'empty' });
    await page.goto(`/dashboard/${guildId}?view=player`);
    await expect(page.getByText('Bread is not in a voice channel')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveCount(0);
  });
});

test('empty views point back to the player', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/guilds/*/history**', (route) => json(route, { items: [], page: 1, limit: 25, total: 0, totalPages: 0 }));
  await page.goto(`/dashboard/${guildId}?view=history`);
  await expect(page.getByText('No playback history yet')).toBeVisible();
  await page.getByRole('button', { name: 'Open Player' }).click();
  await expect(page).toHaveURL(/view=player/);
});

test('settings toggles and sliders are labelled', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/dashboard/${guildId}`);
  await expect(page.getByRole('switch', { name: 'Autoplay' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Vote skip threshold' })).toBeVisible();
});

test('take turns toggles and the DJ fallback only shows with a DJ role', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/dashboard/${guildId}`);
  const turns = page.getByRole('switch', { name: 'Take Turns' });
  await expect(turns).toHaveAttribute('aria-checked', 'false');
  await turns.click();
  await expect(turns).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('You have unsaved changes')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Open Controls Without a DJ' })).toHaveCount(0);
  await expect(page.getByLabel('Tracks per person')).toHaveValue('0');
});

test('phones get a top bar with a menu that opens and closes', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The top bar only exists on phones');
  await mockApi(page);
  await page.route('**/api/guilds/*/history**', (route) => json(route, { items: [], page: 1, limit: 25, total: 0, totalPages: 0 }));
  await page.goto(`/dashboard/${guildId}?view=history`);

  const open = page.getByRole('button', { name: 'Open menu' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  // The page header sits below the bar instead of under a floating button.
  const bar = await page.getByRole('banner').boundingBox();
  const heading = await page.getByRole('heading', { name: 'Listening History', level: 2 }).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);

  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(open).toHaveAttribute('aria-expanded', 'false');

  await open.click();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
});
