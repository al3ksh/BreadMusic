import { Activity, BookOpenText, Coins, History, Play, Settings, Terminal, type LucideIcon } from 'lucide-react';

export type DashboardView = 'settings' | 'status' | 'player' | 'history' | 'lyrics' | 'economy' | 'control';

// One place for each guild view's sidebar label, page title, subtitle and icon.
export const dashboardViews: Record<DashboardView, { label: string; title: string; description: string; icon: LucideIcon }> = {
  settings: { label: 'Settings', title: 'Server Settings', description: 'Permissions, volume, playback behaviour and integrations', icon: Settings },
  status: { label: 'Status', title: 'Server Status', description: 'Bot health, connections and listening stats', icon: Activity },
  player: { label: 'Player', title: 'Music Player', description: 'Now playing, queue and playback controls', icon: Play },
  history: { label: 'History', title: 'Listening History', description: 'Everything played here, ready to queue again', icon: History },
  lyrics: { label: 'Lyrics', title: 'Lyrics', description: 'Synced lyrics for the current track or any song', icon: BookOpenText },
  economy: { label: 'Economy', title: 'Economy', description: 'Bread balances and the server leaderboard', icon: Coins },
  control: { label: 'Control', title: 'Remote Control', description: 'Send messages as Bread and move it between channels', icon: Terminal },
};

export const isDashboardView = (view: string | null): view is DashboardView => Boolean(view && view in dashboardViews);
