'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/api';
import type { BotStats } from '@/lib/api';
import { Server, Users, Play, Clock } from 'lucide-react';

export function Stats() {
  const [stats, setStats] = useState<BotStats | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const items = [
    {
      icon: <Server size={24} />,
      color: 'blue',
      label: 'Servers',
      value: stats ? formatNumber(stats.guilds) : '--',
    },
    {
      icon: <Users size={24} />,
      color: 'green',
      label: 'Users',
      value: stats ? formatNumber(stats.users) : '--',
    },
    {
      icon: <Play size={24} />,
      color: 'orange',
      label: 'Active Players',
      value: stats ? String(stats.players) : '--',
    },
    {
      icon: <Clock size={24} />,
      color: 'red',
      label: 'Uptime',
      value: stats?.uptime || '--',
      compact: true,
    },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-accent/20 text-accent',
    green: 'bg-success/20 text-success',
    orange: 'bg-[#f39c12]/20 text-[#f39c12]',
    red: 'bg-danger/20 text-danger',
  };

  return (
    <section className="w-full py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex min-w-0 items-center gap-4 p-5 rounded-lg bg-bg-card border border-border"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
            >
              <div className={`stat-icon ${colorMap[item.color]} rounded-lg`}>
                {item.icon}
              </div>
              <div className="min-w-0">
                <div className={`${item.compact ? 'text-xl sm:text-2xl xl:text-3xl' : 'text-2xl sm:text-3xl'} whitespace-nowrap font-bold tabular-nums`}>
                  {item.value}
                </div>
                <div className="text-xs text-text-secondary uppercase tracking-wider font-medium mt-1">
                  {item.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
