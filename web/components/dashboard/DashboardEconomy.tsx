'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type EconomyLeaderboardEntry, type EconomyMember } from '@/lib/api';
import { Coins } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { ListSkeleton, Section, SectionSkeleton, Skeleton } from '@/components/dashboard/DashboardPrimitives';
import { Select } from '@/components/dashboard/DashboardSelect';

const inputClass = 'w-48 rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit]';

export function DashboardEconomy({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [leaderboard, setLeaderboard] = useState<EconomyLeaderboardEntry[]>([]);
  const [members, setMembers] = useState<EconomyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [amount, setAmount] = useState(100);

  const fetchEconomy = useCallback(() => {
    Promise.allSettled([
      apiFetch<{ entries: EconomyLeaderboardEntry[] }>(`/guilds/${guildId}/economy/leaderboard?limit=20`),
      apiFetch<{ members: EconomyMember[] }>(`/guilds/${guildId}/economy/members?limit=120`),
    ])
      .then(([leaderboardRes, membersRes]) => {
        if (leaderboardRes.status === 'fulfilled') {
          setLeaderboard(leaderboardRes.value.entries || []);
        }
        if (membersRes.status === 'fulfilled') {
          const list = membersRes.value.members || [];
          setMembers(list);
          if (!selectedUserId && list.length > 0) {
            setSelectedUserId(list[0].userId);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [guildId, selectedUserId]);

  useEffect(() => {
    fetchEconomy();
    const interval = setInterval(fetchEconomy, 15000);
    return () => clearInterval(interval);
  }, [fetchEconomy]);

  const selectedUser = members.find((member) => member.userId === selectedUserId) || null;

  const adjustBalance = useCallback(async () => {
    if (!selectedUserId) return;
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Invalid amount', 'Amount must be 0 or higher.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; balance: number }>(`/guilds/${guildId}/economy/adjust`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, mode, amount: Math.floor(amount) }),
      });
      toast.success('Balance updated', `New balance: ${res.balance.toLocaleString()} bread.`);
      fetchEconomy();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to update balance';
      toast.error('Balance update failed', text);
    } finally {
      setSaving(false);
    }
  }, [amount, fetchEconomy, guildId, mode, selectedUserId, toast]);

  if (loading) {
    return (
      <div className="space-y-5 w-full max-w-6xl mx-auto">
        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border"><Skeleton className="h-4 w-44" /></div>
          <div className="p-4 sm:p-5">
            <ListSkeleton items={5} />
          </div>
        </div>
        <SectionSkeleton rows={2} />
      </div>
    );
  }

  return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <Section title="Economy Leaderboard">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-text-muted">No economy data for this guild yet.</p>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((entry) => (
              <div key={entry.userId} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border/50 bg-bg-secondary/40">
                <span className="w-8 text-xs tabular-nums text-text-muted">#{entry.rank}</span>
                {entry.avatar ? (
                  <img src={entry.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-bg-hover flex items-center justify-center text-xs text-text-muted">{entry.displayName.charAt(0).toUpperCase()}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.displayName}</p>
                  <p className="text-xs text-text-muted truncate">{entry.username}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-accent">{entry.balance.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Manage Balance">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Member</label>
            <Select
              ariaLabel="Member"
              value={selectedUserId}
              onChange={setSelectedUserId}
              options={members.map((member) => ({ value: member.userId, label: `${member.displayName} (${member.balance.toLocaleString()} bread)` }))}
              placeholder="No members yet"
              className="w-full max-w-md"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Mode</label>
              <Select
                ariaLabel="Mode"
                value={mode}
                onChange={(value) => setMode(value as 'add' | 'remove' | 'set')}
                options={[{ value: 'add', label: 'Add' }, { value: 'remove', label: 'Remove' }, { value: 'set', label: 'Set' }]}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Amount</label>
              <input
                type="number"
                min={0}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className={inputClass + ' w-full'}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={adjustBalance}
                disabled={saving || !selectedUserId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Coins size={15} />
                {saving ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>

          {selectedUser && (
            <p className="text-xs text-text-muted">
              Current balance for {selectedUser.displayName}: <span className="text-text-secondary font-medium">{selectedUser.balance.toLocaleString()} bread</span>
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
