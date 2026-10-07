import type { Page, Route } from '@playwright/test';

// Shared mocked dashboard backend for the e2e specs.
export const guildId = '123456789012345678';
export const artwork = 'https://i.ytimg.com/vi/test/hqdefault.jpg';
export const localArtwork = `/api/uploads/${guildId}/${'a'.repeat(64)}/artwork.mp3.jpg?expires=9999999999&signature=test`;

export const track = {
  title: 'Test track',
  author: 'Test artist',
  uri: 'https://www.youtube.com/watch?v=test',
  duration: 180_000,
  position: 12_000,
  requester: 'tester',
  artwork,
  source: 'youtube',
  seekable: true,
  isStream: false,
};

export const status = {
  connected: true,
  playing: true,
  paused: false,
  voiceChannelId: 'voice-1',
  voiceChannelName: 'General',
  currentTrack: track,
  queueLength: 1,
  repeatMode: 'off',
  volume: 80,
  filters: null,
  autoplay: true,
  voteSkip: null,
  sessionHistory: [],
};

export function json(route: Route, body: unknown, statusCode = 200) {
  return route.fulfill({
    status: statusCode,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockApi(page: Page, options: { canControlPlayer?: boolean; currentTrack?: typeof track } = {}) {
  const canControlPlayer = options.canControlPlayer ?? true;
  const currentTrack = options.currentTrack ?? track;
  const playerStatus = { ...status, currentTrack };
  const access = {
    accessLevel: canControlPlayer ? 'admin' : 'member',
    dashboardAccess: canControlPlayer ? 'admin' : 'members',
    canAccess: true,
    canView: true,
    canControlPlayer,
    canQueue: true,
    canUpload: canControlPlayer,
    canManageConfig: canControlPlayer,
    canManageEconomy: canControlPlayer,
    canUseRemoteControl: canControlPlayer,
    maxVolume: 100,
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/me') {
      return json(route, { id: 'user-1', username: 'tester', discriminator: '0001', avatar: '', global_name: 'Tester' });
    }
    if (path === '/api/guilds' && request.method() === 'GET') {
      return json(route, [{ id: guildId, name: 'Test Guild', icon: null, permissions: 8, member_count: 4, bot_present: true, access_level: 'admin', dashboard_access: 'admin', can_access: true, can_invite: false }]);
    }
    if (path.endsWith('/access')) return json(route, access);
    if (path.endsWith('/status')) return json(route, playerStatus);
    if (path.endsWith('/health')) return json(route, {
      api: { ok: true, timestamp: Date.now() },
      discord: { ok: true, wsStatusCode: 0, ping: 30 },
      lavalink: { ok: true, connectedNodes: 1, totalNodes: 1 },
      player: { exists: true, connected: true },
      playerMessageChannel: { configured: false, channelId: null, channelName: null, sendable: null },
    });
    if (path.endsWith('/insights')) return json(route, { range: '7d', summary: { totalPlays: 1, uniqueTracks: 1, uniqueUsers: 1, lastPlayAt: Date.now() }, topTracks: [], topUsers: [], trend14d: [] });
    if (path.endsWith('/queue')) return json(route, { current: currentTrack, tracks: [currentTrack], total: 1, page: 0, totalPages: 1, revision: 'test-revision' });
    if (path.endsWith('/player/events')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `event: snapshot\ndata: ${JSON.stringify({ status: playerStatus, queue: { current: currentTrack, tracks: [currentTrack], total: 1, page: 0, totalPages: 1, revision: 'test-revision' } })}\n\n`,
      });
    }
    if (path.endsWith('/player/search')) return json(route, { tracks: [{ ...track, encoded: 'encoded-test' }], playlist: null });
    if (path.endsWith('/player/filters')) return json(route, { presets: [] });
    if (path.endsWith('/channels') || path.endsWith('/roles')) return json(route, []);
    if (path === '/api/activity/config') return json(route, { enabled: true, clientId: 'test-client-id' });
    if (path === '/api/activity/token') return json(route, { access_token: 'test-activity-token' });
    if (path.endsWith('/config')) return json(route, { dashboardAccess: 'admin', djRoleId: null, maxVolume: 100, defaultVolume: 80, autoplay: true, persistentQueue: false, preferredSource: null, playerTextChannelId: null, playerTextChannelName: null, voteSkipPercent: 50, stayInChannel: false, afkTimeout: 300, twentyFourSevenChannelId: null, twentyFourSevenChannelName: null, voiceChannelStatus: false });
    if (request.method() === 'POST' || request.method() === 'PUT' || request.method() === 'PATCH' || request.method() === 'DELETE') return json(route, { ok: true, success: true, message: 'Action applied' });

    return json(route, {});
  });
}
