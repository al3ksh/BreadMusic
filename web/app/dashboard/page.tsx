'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, type GuildInfo, getGuildIcon } from '@/lib/api';
import { ArrowLeft, ChevronRight, Server } from 'lucide-react';

export default function DashboardPage() {
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    apiFetch<GuildInfo[]>('/guilds')
      .then(setGuilds)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24">
        <p className="text-text-secondary mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const manageable = guilds.filter((g) => g.bot_present);
  const noBot = guilds.filter((g) => !g.bot_present);

  return (
    <div className="animate-fade-up">
      {/* Page header */}
      <div className="bg-bg-secondary border-b border-border px-6 py-5 -m-5 md:-m-8 mb-6 md:mb-8 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Server size={22} className="text-text-secondary" />
            <div>
              <h1 className="text-[22px] font-medium">Your Servers</h1>
              <p className="text-text-secondary text-[13px] mt-1">Select a server to manage settings and playback.</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Back to home"
            onClick={() => router.push('/')}
            className="hidden sm:flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer px-4 py-2 rounded-lg border border-border hover:bg-bg-hover"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        </div>
      </div>

      {manageable.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-[1px] mb-4">
            Available
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {manageable.map((guild) => (
              <button
                key={guild.id}
                onClick={() => router.push(`/dashboard/${guild.id}`)}
                className="group flex items-center gap-4 p-4 rounded-lg bg-bg-card border border-border hover:border-accent/40 transition-all text-left cursor-pointer hover:-translate-y-0.5 hover:shadow-lg"
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              >
                {guild.icon ? (
                  <img src={getGuildIcon(guild)} alt="" className="w-12 h-12 rounded-lg object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-bg-hover flex items-center justify-center text-lg font-bold text-text-muted">
                    {guild.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-text-primary">{guild.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {guild.member_count?.toLocaleString()} members · {guild.access_level}
                  </div>
                </div>
                <ChevronRight size={18} className="text-text-muted group-hover:text-accent transition-colors shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {manageable.length === 0 && (
        <div className="bg-bg-card border border-border rounded-lg p-12 text-center mb-8">
          <img src="/assets/breadicon.png?v=3" alt="" className="w-16 h-16 mx-auto mb-4 opacity-70 rounded-xl object-cover" />
          <p className="text-text-secondary font-medium mb-1">No servers found</p>
          <p className="text-sm text-text-muted">
            No server has dashboard access enabled for your account.
          </p>
        </div>
      )}

      {noBot.length > 0 && (
        <div>
          <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-[1px] mb-4">
            Bot Not Present
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {noBot.map((guild) => (
              <div
                key={guild.id}
                className="flex items-center gap-4 p-4 rounded-lg bg-bg-card/50 border border-border/50 opacity-50"
              >
                {guild.icon ? (
                  <img src={getGuildIcon(guild)} alt="" className="w-12 h-12 rounded-lg object-cover grayscale" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-bg-hover/50 flex items-center justify-center text-lg font-bold text-text-muted">
                    {guild.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-text-secondary">{guild.name}</div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                  No bot
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
