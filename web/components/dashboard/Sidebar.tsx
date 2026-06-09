'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { apiFetch, type DiscordUser, getUserAvatar } from '@/lib/api';
import {
  LayoutDashboard,
  LogOut,
  Settings,
  Activity,
  Play,
  Coins,
  Menu,
  X,
  Home,
  Terminal,
} from 'lucide-react';

interface SidebarProps {
  user: DiscordUser;
  onLogout: () => void;
}

export function Sidebar({ user, onLogout }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const botName = 'Bread';
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const searchParams = useSearchParams();
  const currentView = searchParams.get('view') || 'settings';

  const isActive = (path: string, view?: string) => {
    if (view) return pathname === path && currentView === view;
    return pathname === path && !searchParams.get('view');
  };

  // Extract guildId from pathname if on a guild page
  const guildMatch = pathname?.match(/^\/dashboard\/(\d+)/);
  const currentGuildId = guildMatch ? guildMatch[1] : null;

  const navItems = [
    { href: '/', icon: <Home size={18} />, label: 'Home' },
    { href: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Servers', exact: true },
  ];

  const guildNavItems = currentGuildId
    ? [
        { href: `/dashboard/${currentGuildId}`, view: 'settings', icon: <Settings size={18} />, label: 'Settings', exact: true },
        { href: `/dashboard/${currentGuildId}?view=status`, view: 'status', icon: <Activity size={18} />, label: 'Status' },
        { href: `/dashboard/${currentGuildId}?view=player`, view: 'player', icon: <Play size={18} />, label: 'Player' },
        { href: `/dashboard/${currentGuildId}?view=economy`, view: 'economy', icon: <Coins size={18} />, label: 'Economy' },
        { href: `/dashboard/${currentGuildId}?view=control`, view: 'control', icon: <Terminal size={18} />, label: 'Control' },
      ]
    : [];

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className={`fixed top-3.5 z-[201] flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-bg-secondary text-text-primary shadow-lg transition-[left] duration-300 cursor-pointer md:hidden ${
          mobileOpen ? 'left-4' : 'left-3.5'
        }`}
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-[2px] z-[199] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen h-dvh z-[200] w-[min(320px,calc(100vw-56px))] bg-bg-secondary border-r border-border flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] md:w-[260px] md:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-[4px_0_20px_rgba(0,0,0,0.5)]' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-5 border-b border-border md:px-5">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity md:pl-0 pl-12"
          >
            <div className="relative w-8 h-8 rounded-lg shadow-md overflow-hidden shrink-0">
              <img src="/assets/breadicon.png?v=3" alt="" className="w-full h-full object-cover" />
            </div>
            <h1 className="font-semibold text-xl tracking-wide text-text-primary">{botName}</h1>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2.5 overflow-y-auto">
          <div className="px-5 py-2.5 text-[11px] uppercase text-text-secondary tracking-[1px] mt-1.5">
            Menu
          </div>
          {navItems.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : isActive(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-all border-l-[3px] cursor-pointer ${
                  active
                    ? 'bg-bg-card text-text-primary border-l-accent'
                    : 'text-text-secondary border-l-transparent hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className="flex items-center justify-center w-5">{item.icon}</span>
                {item.label}
              </button>
            );
          })}

          {guildNavItems.length > 0 && (
            <>
              <div className="px-5 py-2.5 text-[11px] uppercase text-text-secondary tracking-[1px] mt-3">
                Server
              </div>
              {guildNavItems.map((item) => {
                const active = item.view
                  ? isActive(item.href.split('?')[0], item.view)
                  : pathname === item.href;
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-all border-l-[3px] cursor-pointer ${
                      active
                        ? 'bg-bg-card text-text-primary border-l-accent'
                        : 'text-text-secondary border-l-transparent hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <span className="flex items-center justify-center w-5">{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </>
          )}
        </nav>

        {/* User profile footer */}
        <div className="p-4 border-t border-border bg-black/10">
          <div className="flex items-center gap-3 bg-bg-card p-3 rounded-lg border border-border">
            <img
              src={getUserAvatar(user)}
              alt={user.username}
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text-primary truncate">
                {user.global_name || user.username}
              </div>
              <div className="text-[11px] text-text-secondary truncate font-mono">
                @{user.username}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 text-text-muted hover:text-danger rounded-md transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---- Auth Hook (kept here for backwards compat) ----

export function useAuth() {
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<DiscordUser>('/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        setUser(null);
        window.location.href = '/';
      });
  };

  return { user, loading, logout };
}
