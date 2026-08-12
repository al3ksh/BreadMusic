const API_URL = '';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('/api') ? `${API_URL}${path}` : `${API_URL}/api${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as { reauth?: boolean; error?: string };
    if (typeof window !== 'undefined') {
      if (body.reauth) window.location.href = '/api/auth/discord';
      else if (!window.location.pathname.startsWith('/dashboard')) window.location.href = '/dashboard';
    }
    throw new Error(body.error || 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string;
  global_name: string | null;
}

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  permissions: number;
  member_count: number;
  bot_present: boolean;
  access_level: 'admin' | 'dj' | 'member';
  dashboard_access: 'admin' | 'dj' | 'members';
  can_access: boolean;
  can_invite: boolean;
}

export interface DashboardCapabilities {
  accessLevel: 'admin' | 'dj' | 'member';
  dashboardAccess: 'admin' | 'dj' | 'members';
  canAccess: boolean;
  canView: boolean;
  canControlPlayer: boolean;
  canUpload: boolean;
  canManageConfig: boolean;
  canManageEconomy: boolean;
  canUseRemoteControl: boolean;
  maxVolume: number;
}

export interface GuildConfig {
  preferredSource: string | null;
  djRoleId: string | null;
  djRoleName: string | null;
  playerTextChannelId: string | null;
  playerTextChannelName: string | null;
  maxVolume: number;
  voteSkipPercent: number;
  stayInChannel: boolean;
  afkTimeout: number;
  persistentQueue: boolean;
  twentyFourSevenChannelId: string | null;
  twentyFourSevenChannelName: string | null;
  defaultVolume: number;
  autoplay: boolean;
  voiceChannelStatus: boolean;
  dashboardAccess: 'admin' | 'dj' | 'members';
}

export interface HistoryEntry {
  id: string;
  playedAt: number;
  autoplay: boolean;
  track: {
    title: string;
    author: string;
    uri: string;
    duration: number;
    artwork: string | null;
    source: string | null;
  };
  requester: {
    userId: string;
    username: string;
    displayName: string;
    avatar: string | null;
  } | null;
}

export interface HistoryPage {
  items: HistoryEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface LyricsResult {
  id: number | null;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
  provider: string;
}

export interface PlayerStatus {
  connected: boolean;
  playing: boolean;
  paused: boolean;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  currentTrack: {
    title: string;
    author: string;
    uri: string;
    duration: number;
    position: number;
    seekable: boolean;
    artwork?: string;
    requester: string;
  } | null;
  queueLength: number;
  repeatMode: string;
  volume: number;
  filters: string | null;
  autoplay: boolean;
  voteSkip: {
    votes: number;
    requiredVotes: number;
  } | null;
  sessionHistory: {
    title: string;
    author: string;
    uri: string;
    duration: number;
    artwork?: string;
  }[];
}

export interface GuildHealth {
  api: {
    ok: boolean;
    timestamp: number;
  };
  discord: {
    ok: boolean;
    wsStatusCode: number | null;
    ping: number | null;
  };
  lavalink: {
    ok: boolean;
    connectedNodes: number;
    totalNodes: number;
  };
  player: {
    exists: boolean;
    connected: boolean;
  };
  playerMessageChannel: {
    configured: boolean;
    channelId: string | null;
    channelName: string | null;
    sendable: boolean | null;
  };
}

export interface GuildInsightsTrack {
  rank: number;
  key: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
  artwork: string | null;
  count: number;
  lastPlayedAt: number | null;
}

export interface GuildInsightsUser {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  count: number;
  lastPlayedAt: number | null;
}

export type GuildInsightsRange = '24h' | '7d' | 'all';

export interface GuildInsightsTrendPoint {
  dateKey: string;
  label: string;
  count: number;
}

export interface GuildInsights {
  range: GuildInsightsRange;
  summary: {
    totalPlays: number;
    uniqueTracks: number;
    uniqueUsers: number;
    lastPlayAt: number | null;
  };
  topTracks: GuildInsightsTrack[];
  topUsers: GuildInsightsUser[];
  trend14d: GuildInsightsTrendPoint[];
}

export interface FilterPreset {
  value: string;
  label: string;
  description?: string;
}

export interface EconomyLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  balance: number;
}

export interface EconomyMember {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  balance: number;
}

export interface QueueTrack {
  title: string;
  author: string;
  uri: string;
  duration: number;
  requester: string;
  artwork?: string;
  source?: string | null;
  seekable?: boolean;
  isStream?: boolean;
}

export interface BotStats {
  guilds: number;
  users: number;
  players: number;
  uptime: string;
}

export interface BotInfo {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
  clientId: string;
}

export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const DISCORD_CDN = 'https://cdn.discordapp.com';

export function getGuildIcon(guild: GuildInfo): string {
  if (guild.icon) {
    return `${DISCORD_CDN}/icons/${guild.id}/${guild.icon}.png?size=128`;
  }
  return '';
}

export function getUserAvatar(user: DiscordUser): string {
  if (user.avatar) {
    return `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const discriminator = parseInt(user.discriminator) || 0;
  const index = discriminator % 5;
  return `${DISCORD_CDN}/embed/avatars/${index}.png?size=128`;
}

export function getUserAvatarUrl(userId: string, avatar: string): string {
  if (avatar) {
    return `${DISCORD_CDN}/avatars/${userId}/${avatar}.png?size=64`;
  }
  return `${DISCORD_CDN}/embed/avatars/0.png?size=64`;
}
