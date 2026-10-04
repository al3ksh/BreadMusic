import { expect, test, type Page, type Route } from '@playwright/test';

const current = {
  title: 'Digital Love',
  author: 'Daft Punk',
  uri: 'https://www.youtube.com/watch?v=current',
  duration: 301_000,
  position: 42_000,
  requester: 'tester',
  seekable: true,
  isStream: false,
};

type Entry = { key: string; title: string; author: string; duration: number; artwork: null };
type Playlist = { id: string; name: string; tracks: Entry[]; shareCode?: string | null };

const entry = (key: string, title: string): Entry => ({ key, title, author: 'Bread Band', duration: 200_000, artwork: null });

function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockLibraryApi(page: Page) {
  const state = {
    liked: [entry('id:fav', 'Favourite')],
    playlists: [{ id: 'pl-1', name: 'Road trip', tracks: [entry('id:r1', 'Highway'), entry('id:r2', 'Night drive')] }] as Playlist[],
    played: [] as { playlistId: string; shuffle: boolean }[],
    imported: [] as string[],
  };
  const summary = (playlist: Playlist) => ({
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.tracks.length,
    duration: playlist.tracks.reduce((total, track) => total + track.duration, 0),
    artwork: null,
    updatedAt: 1,
    shareCode: playlist.shareCode ?? null,
  });
  const snapshot = () => ({ liked: state.liked, playlists: state.playlists.map(summary), limits: { liked: 500, playlists: 50, tracks: 500, name: 60 } });
  const status = {
    connected: true, playing: true, paused: false, voiceChannelId: 'voice-1', voiceChannelName: 'General', currentTrack: current,
    queueLength: 0, repeatMode: 'off', volume: 80, filters: null, autoplay: false, voteSkip: null, sessionHistory: [],
  };
  const access = {
    accessLevel: 'member', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: false,
    canQueue: true, canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: false, maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.method() === 'POST' ? (request.postDataJSON() ?? {}) : {};
    const library = path.match(/\/guilds\/[^/]+\/library(\/.*)?$/);
    if (library) {
      const rest = library[1] ?? '';
      if (rest === '') return json(route, snapshot());
      if (rest === '/import') {
        state.imported.push(body.url);
        const playlist = { id: 'pl-2', name: 'Imported mix', tracks: [entry('id:i1', 'Imported one')] };
        state.playlists.unshift(playlist);
        return json(route, { success: true, playlist: summary(playlist), added: 1, skipped: 0 });
      }
      if (rest === '/playlists') {
        const playlist = { id: 'pl-3', name: body.name, tracks: [entry('id:now', current.title)] };
        state.playlists.unshift(playlist);
        return json(route, { success: true, playlist: summary(playlist), added: 1, skipped: 0 });
      }
      const match = rest.match(/^\/playlists\/([^/]+)(?:\/(remove|delete|share))?$/);
      const playlist = match && state.playlists.find((item) => item.id === match[1]);
      if (match && playlist) {
        if (match[2] === 'remove') {
          playlist.tracks.splice(body.index, 1);
          return json(route, { success: true, playlist });
        }
        if (match[2] === 'share') {
          playlist.shareCode = body.enabled === false ? null : 'BRD2345K';
          return json(route, { success: true, playlist: summary(playlist), code: playlist.shareCode });
        }
        if (match[2] === 'delete') {
          state.playlists = state.playlists.filter((item) => item !== playlist);
          return json(route, { success: true });
        }
        return json(route, playlist);
      }
      return json(route, { error: 'Playlist not found.' }, 404);
    }
    if (request.method() === 'POST' && path.endsWith('/player/library')) {
      state.played.push(body);
      return json(route, { success: true, title: 'Road trip', count: 2, mode: 'queue' });
    }
    if (path === '/api/me') return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, status);
    if (path.endsWith('/queue')) return json(route, { current, tracks: [], total: 0, page: 0, totalPages: 0, revision: 'rev-1' });
    return json(route, {});
  });
  // Keep the event stream open so the player stays online.
  await page.route('**/api/guilds/*/player/events?*', () => {});
  return state;
}

async function openActivity(page: Page) {
  await page.addInitScript(() => {
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
  });
  await page.setContent('<iframe title="Bread Activity" src="http://127.0.0.1:3100/activity?frame_id=test&instance_id=test&platform=desktop" style="width:100%;height:100vh;border:0"></iframe>');
  const activity = page.frameLocator('iframe[title="Bread Activity"]');
  await expect(activity.getByText('Music Activity')).toBeVisible({ timeout: 30_000 });
  return activity;
}

test('listeners play, import and curate their own library', async ({ page }) => {
  const state = await mockLibraryApi(page);
  const activity = await openActivity(page);

  await activity.getByRole('button', { name: 'Library', exact: true }).click();
  const panel = activity.getByRole('complementary', { name: 'library panel' });
  await expect(panel.getByText('Your Liked tracks and playlists')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Open Liked' })).toContainText('1 track');

  await panel.getByRole('button', { name: 'Shuffle Road trip' }).click();
  await expect.poll(() => state.played.at(-1)).toEqual({ playlistId: 'pl-1', shuffle: true });

  await panel.getByRole('textbox', { name: 'Playlist link or share code to import' }).fill('https://open.spotify.com/playlist/abc');
  await panel.getByRole('button', { name: 'Import' }).click();
  await expect(panel.getByRole('button', { name: 'Open Imported mix' })).toBeVisible();
  expect(state.imported).toEqual(['https://open.spotify.com/playlist/abc']);

  await panel.getByRole('textbox', { name: 'New playlist name' }).fill('Tonight');
  await panel.getByRole('button', { name: 'Save queue' }).click();
  await expect(panel.getByRole('button', { name: 'Open Tonight' })).toBeVisible();

  await panel.getByRole('button', { name: 'Open Road trip' }).click();
  await expect(panel.getByText('Night drive')).toBeVisible();
  await panel.getByRole('button', { name: 'Remove Highway' }).click();
  await expect(panel.getByText('Highway')).toHaveCount(0);
  await expect(panel.getByText('1 track', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Share Road trip' }).click();
  const share = panel.getByRole('group', { name: 'Share code' });
  await expect(share.locator('code')).toHaveText('BRD2345K');
  await expect(panel.getByRole('button', { name: 'Copy share code for Road trip' })).toBeVisible();
  await share.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(share).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Share Road trip' })).toBeVisible();

  await panel.getByRole('button', { name: 'Delete Road trip' }).click();
  await panel.getByRole('button', { name: 'Confirm deleting Road trip' }).click();
  await expect(panel.getByRole('button', { name: 'Open Liked' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Open Road trip' })).toHaveCount(0);
});
