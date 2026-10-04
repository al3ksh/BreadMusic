'use client';

import { useCallback, useEffect, useState } from 'react';
import { Play, Radio, Search, Star } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Spinner } from '@/components/dashboard/DashboardPrimitives';

export type DashboardRadioStation = {
  id: string;
  name: string;
  country: string;
  place: string;
  tags: string[];
  bitrate: number;
};

function describeStation(station: DashboardRadioStation) {
  const location = [station.place, station.country].filter(Boolean).join(', ');
  return [location, station.tags.slice(0, 3).join(', '), station.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .join(' · ') || 'Live radio';
}

// Live radio for the dashboard player: a station search plus the user's saved stations.
export function DashboardRadio({ guildId, onPlay }: { guildId: string; onPlay: (stationId: string) => Promise<unknown> }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DashboardRadioStation[]>([]);
  const [saved, setSaved] = useState<DashboardRadioStation[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ stations?: DashboardRadioStation[] }>(`/guilds/${guildId}/library`)
      .then((snapshot) => setSaved(snapshot.stations ?? []))
      .catch(() => {});
  }, [guildId]);

  const search = useCallback(async () => {
    setSearching(true);
    try {
      const result = await apiFetch<{ stations: DashboardRadioStation[] }>(`/guilds/${guildId}/radio/search?q=${encodeURIComponent(query.trim())}`);
      setResults(result.stations);
      if (result.stations.length === 0) toast.info('No stations found', 'Try a station name, a genre like jazz, or a country.');
    } catch (error) {
      toast.error('Radio search failed', error instanceof Error ? error.message : 'The radio directory is not answering.');
    } finally {
      setSearching(false);
    }
  }, [guildId, query, toast]);

  const savedIds = new Set(saved.map((station) => station.id));

  const toggleSaved = async (station: DashboardRadioStation) => {
    const isSaved = savedIds.has(station.id);
    setBusyId(`star:${station.id}`);
    try {
      const result = await apiFetch<{ stations: DashboardRadioStation[] }>(`/guilds/${guildId}/library/stations/${isSaved ? 'remove' : 'add'}`, {
        method: 'POST',
        body: JSON.stringify(isSaved ? { id: station.id } : { stationId: station.id }),
      });
      setSaved(result.stations);
    } catch (error) {
      toast.error('Could not update your stations', error instanceof Error ? error.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const play = async (station: DashboardRadioStation) => {
    setBusyId(`play:${station.id}`);
    try {
      await onPlay(station.id);
    } finally {
      setBusyId(null);
    }
  };

  const renderStation = (station: DashboardRadioStation) => {
    const isSaved = savedIds.has(station.id);
    return (
      <div key={station.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0">
        <Radio size={16} className="text-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{station.name}</p>
          <p className="text-xs text-text-muted truncate">{describeStation(station)}</p>
        </div>
        <button
          type="button"
          onClick={() => toggleSaved(station)}
          disabled={Boolean(busyId)}
          title={isSaved ? 'Remove from your stations' : 'Save station'}
          aria-pressed={isSaved}
          className={`p-2 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${isSaved ? 'text-yellow-400' : 'text-text-muted hover:text-text-primary'}`}
        >
          {busyId === `star:${station.id}` ? <Spinner /> : <Star size={15} fill={isSaved ? 'currentColor' : 'none'} />}
        </button>
        <button
          type="button"
          onClick={() => play(station)}
          disabled={Boolean(busyId)}
          title="Play station"
          className="p-2 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50"
        >
          {busyId === `play:${station.id}` ? <Spinner /> : <Play size={15} />}
        </button>
      </div>
    );
  };

  return (
    <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
      <div className="bg-bg-secondary px-5 py-3.5 border-b border-border">
        <h3 className="text-[15px] font-medium">Radio</h3>
      </div>
      <div className="p-5">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
            placeholder="Station, genre or country (empty = popular)"
            className="flex-1 rounded-md border border-border bg-bg-input text-text-primary px-4 py-2.5 text-sm outline-none placeholder:text-text-muted focus:border-accent transition-colors font-[inherit]"
          />
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="px-4 py-2.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
          >
            {searching ? <Spinner /> : <Search size={16} />}
          </button>
        </div>
        {saved.length > 0 && (
          <>
            <p className="text-xs text-text-muted mt-4 mb-2 uppercase tracking-wide">Your stations</p>
            <div className="rounded-md overflow-hidden border border-border">{saved.map(renderStation)}</div>
          </>
        )}
        {results.length > 0 && (
          <>
            <p className="text-xs text-text-muted mt-4 mb-2 uppercase tracking-wide">Results</p>
            <div className="rounded-md overflow-hidden border border-border max-h-80 overflow-y-auto">{results.map(renderStation)}</div>
          </>
        )}
      </div>
    </div>
  );
}
