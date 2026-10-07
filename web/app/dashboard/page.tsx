'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, type GuildInfo, getGuildIcon } from '@/lib/api';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, RotateCw, Search, Server, Users, X } from 'lucide-react';
import { Skeleton } from '@/components/dashboard/DashboardPrimitives';

// The filter only earns its space once the list is long enough to scan.
const FILTER_THRESHOLD = 6;

const accessBadges: Record<GuildInfo['access_level'], { label: string; className: string }> = {
  admin: { label: 'Admin', className: 'border-accent/35 bg-accent/15 text-accent-text' },
  mod: { label: 'Mod', className: 'border-info/30 bg-info/10 text-info' },
  member: { label: 'Member', className: 'border-border-light bg-bg-hover text-text-secondary' },
};

function GuildIcon({ guild, muted }: { guild: GuildInfo; muted?: boolean }) {
  if (guild.icon) {
    return <img src={getGuildIcon(guild)} alt="" className={`h-14 w-14 shrink-0 rounded-xl object-cover ${muted ? 'grayscale' : ''}`} />;
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border-light bg-bg-hover text-xl font-semibold text-text-muted">
      {guild.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function DashboardPage() {
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showNoBot, setShowNoBot] = useState(false);
  const router = useRouter();

  const loadGuilds = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<GuildInfo[]>('/guilds')
      .then(setGuilds)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load servers.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(loadGuilds, [loadGuilds]);

  const needle = query.trim().toLowerCase();
  const matches = (guild: GuildInfo) => !needle || guild.name.toLowerCase().includes(needle);
  const manageable = guilds.filter((g) => g.bot_present);
  const noBot = guilds.filter((g) => !g.bot_present);
  const shownManageable = manageable.filter(matches);
  const shownNoBot = noBot.filter(matches);
  const noBotOpen = showNoBot || Boolean(needle && shownNoBot.length);

  return (
    <div className="animate-fade-up">
      {/* Page header */}
      <div className="bg-bg-secondary border-b border-border -mx-4 -mt-16 mb-6 px-4 py-4 pl-16 md:-m-8 md:mb-8 md:px-8 md:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent-text sm:flex">
              <Server size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-medium sm:text-[22px]">Your Servers</h1>
              <p className="mt-1 truncate text-[12px] text-text-secondary sm:text-[13px]">
                {loading || error
                  ? 'Select a server to manage settings and playback.'
                  : `${manageable.length} ${manageable.length === 1 ? 'server' : 'servers'} with Bread · pick one to manage settings and playback`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Back to home"
            onClick={() => router.push('/')}
            className="hidden sm:flex shrink-0 items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer px-4 py-2 rounded-lg border border-border hover:bg-bg-hover"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        </div>
      </div>

      {loading ? (
        <div data-testid="guilds-loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 rounded-xl border border-border bg-bg-card p-4">
              <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2.5">
                <Skeleton className={`h-4 ${['w-3/5', 'w-2/3', 'w-1/2'][index % 3]}`} />
                <Skeleton className="h-3 w-2/5 opacity-60" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mx-auto max-w-md rounded-xl border border-border bg-bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle size={22} />
          </div>
          <p className="font-medium text-text-primary">Could not load your servers</p>
          <p className="mt-1 text-sm text-text-muted">{error}</p>
          <button
            type="button"
            onClick={loadGuilds}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover cursor-pointer"
          >
            <RotateCw size={14} />
            Retry
          </button>
        </div>
      ) : (
        <>
          {guilds.length >= FILTER_THRESHOLD && (
            <div className="relative mb-5 max-w-sm">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter servers"
                aria-label="Filter servers"
                className="h-[38px] w-full rounded-lg border border-border bg-bg-input pl-9 pr-9 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {manageable.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[1px] text-text-secondary">
                Available
                <span className="rounded-full bg-bg-hover px-1.5 py-px text-[10px] tabular-nums text-text-muted">{shownManageable.length}</span>
              </h2>
              {shownManageable.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {shownManageable.map((guild) => {
                    const badge = accessBadges[guild.access_level] ?? accessBadges.member;
                    return (
                      <button
                        key={guild.id}
                        type="button"
                        onClick={() => router.push(`/dashboard/${guild.id}`)}
                        className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-border bg-bg-card p-4 text-left shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:border-accent/45 hover:bg-[#171717] hover:shadow-[0_10px_28px_rgba(0,0,0,0.35)] focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                      >
                        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-accent opacity-0 transition-opacity group-hover:opacity-100" />
                        <GuildIcon guild={guild} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium text-text-primary">{guild.name}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            {typeof guild.member_count === 'number' && (
                              <span className="inline-flex items-center gap-1">
                                <Users size={12} />
                                {guild.member_count.toLocaleString()}
                              </span>
                            )}
                            <span className={`rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wider ${badge.className}`}>
                              {badge.label}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={18} className="shrink-0 text-text-muted transition-all group-hover:translate-x-0.5 group-hover:text-accent-text" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
                  No servers match &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
            </section>
          )}

          {manageable.length === 0 && (
            <div className="mb-8 rounded-xl border border-border bg-bg-card p-12 text-center">
              <img src="/assets/breadicon.png?v=3" alt="" className="mx-auto mb-4 h-16 w-16 rounded-xl object-cover opacity-70" />
              <p className="mb-1 font-medium text-text-secondary">No servers found</p>
              <p className="text-sm text-text-muted">No server has dashboard access enabled for your account.</p>
            </div>
          )}

          {noBot.length > 0 && (
            <section>
              <button
                type="button"
                aria-expanded={noBotOpen}
                onClick={() => setShowNoBot((open) => !open)}
                className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[1px] text-text-secondary transition-colors hover:text-text-primary cursor-pointer"
              >
                <ChevronDown size={14} className={`transition-transform ${noBotOpen ? '' : '-rotate-90'}`} />
                Bot not present
                <span className="rounded-full bg-bg-hover px-1.5 py-px text-[10px] tabular-nums text-text-muted">{needle ? shownNoBot.length : noBot.length}</span>
              </button>
              {noBotOpen && (
                <div className="grid grid-cols-1 gap-3 animate-view-in sm:grid-cols-2 xl:grid-cols-3">
                  {shownNoBot.map((guild) => (
                    <div key={guild.id} className="flex items-center gap-4 rounded-xl border border-border/60 bg-bg-card/50 p-4">
                      <div className="opacity-50"><GuildIcon guild={guild} muted /></div>
                      <div className="min-w-0 flex-1 truncate text-sm font-medium text-text-muted">{guild.name}</div>
                      <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning/80">
                        No bot
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
