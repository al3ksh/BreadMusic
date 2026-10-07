import { expect, test, type Page } from '@playwright/test';
import { guildId, json, mockApi } from './mockApi';

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
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await mockGuilds(page, async () => {
      calls += 1;
      if (calls === 1) {
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
