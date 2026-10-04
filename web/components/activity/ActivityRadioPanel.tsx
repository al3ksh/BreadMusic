import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, Play, Radio, Search, Star } from 'lucide-react';
import { ActivitySpinner } from '@/components/activity/ActivityArtwork';
import type { LibrarySnapshot, RadioStation } from '@/components/activity/ActivityLibraryPanel';

type LibraryRequest = <T>(path: string, body?: Record<string, unknown>) => Promise<T>;

type ActivityRadioPanelProps = {
  canQueue: boolean;
  refreshKey: number;
  searchStations: (query: string) => Promise<RadioStation[]>;
  libraryRequest: LibraryRequest;
  onPlay: (station: RadioStation) => Promise<boolean>;
  onLibraryChange: () => void;
  notify: (message: string, tone: 'success' | 'error' | 'info') => void;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function describeStation(station: RadioStation) {
  const location = [station.place, station.country].filter(Boolean).join(', ');
  const details = [location, station.tags.slice(0, 3).join(', '), station.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .join(' - ');
  return details || 'Live radio';
}

export function ActivityRadioPanel({
  canQueue,
  refreshKey,
  searchStations,
  libraryRequest,
  onPlay,
  onLibraryChange,
  notify,
}: ActivityRadioPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RadioStation[]>([]);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<RadioStation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryRequest<LibrarySnapshot>('')
      .then((snapshot) => {
        if (!cancelled) setSaved(snapshot.stations ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [libraryRequest, refreshKey]);

  // An empty search lists the most popular stations, so the tab is never blank.
  const runSearch = useCallback(async (value: string) => {
    setSearching(true);
    try {
      setResults(await searchStations(value.trim()));
      setSearchedQuery(value.trim());
    } catch (error) {
      notify(errorMessage(error, 'Radio search failed'), 'error');
    } finally {
      setSearching(false);
    }
  }, [notify, searchStations]);

  useEffect(() => {
    void runSearch('');
  }, [runSearch]);

  const savedIds = new Set(saved.map((station) => station.id));

  const toggleSaved = async (station: RadioStation) => {
    setBusyId(`star:${station.id}`);
    try {
      const isSaved = savedIds.has(station.id);
      const result = await libraryRequest<{ stations: RadioStation[] }>(
        isSaved ? '/stations/remove' : '/stations/add',
        isSaved ? { id: station.id } : { stationId: station.id },
      );
      setSaved(result.stations);
      onLibraryChange();
      notify(isSaved ? `Removed ${station.name}` : `Saved ${station.name}`, 'success');
    } catch (error) {
      notify(errorMessage(error, 'Could not update your stations'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const play = async (station: RadioStation) => {
    setBusyId(`play:${station.id}`);
    try {
      await onPlay(station);
    } finally {
      setBusyId(null);
    }
  };

  const renderStation = (station: RadioStation, index: number) => {
    const isSaved = savedIds.has(station.id);
    return (
      <div key={station.id} className="activity-search-result activity-card" style={{ '--stagger-index': Math.min(index, 12) } as CSSProperties}>
        <div className="activity-queue-art"><Radio size={15} /></div>
        <span><strong>{station.name}</strong><small>{describeStation(station)}</small></span>
        <div className="activity-search-actions">
          <button
            type="button"
            className={isSaved ? 'activity-radio-star is-saved' : 'activity-radio-star'}
            disabled={Boolean(busyId)}
            onClick={() => toggleSaved(station)}
            title={isSaved ? 'Remove from your stations' : 'Save station'}
            aria-label={isSaved ? `Remove ${station.name} from your stations` : `Save ${station.name}`}
            aria-pressed={isSaved}
          >
            {busyId === `star:${station.id}` ? <ActivitySpinner /> : <Star size={15} />}
          </button>
          <button type="button" disabled={!canQueue || Boolean(busyId)} onClick={() => play(station)} title="Play station" aria-label={`Play ${station.name}`}>
            {busyId === `play:${station.id}` ? <ActivitySpinner /> : <Play size={15} />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="activity-search-panel">
      <div className="activity-search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void runSearch(query);
          }}
          placeholder="Station, genre or country"
          aria-label="Search radio stations"
        />
        <button type="button" onClick={() => runSearch(query)} disabled={searching} aria-label="Search stations">
          {searching ? <ActivitySpinner /> : <ChevronDown size={17} className="activity-search-arrow" />}
        </button>
      </div>

      {saved.length > 0 && (
        <section className="activity-library-section">
          <h3>Your stations</h3>
          <div className="activity-search-results">{saved.map(renderStation)}</div>
        </section>
      )}

      <section className="activity-library-section">
        <h3>{searchedQuery ? `Stations for "${searchedQuery}"` : 'Popular stations'}</h3>
        {results.length > 0 && <div className="activity-search-results">{results.map(renderStation)}</div>}
        {!searching && searchedQuery !== null && results.length === 0 && (
          <div className="activity-search-empty" role="status">
            <span><Radio size={21} /></span>
            <strong>No stations found</strong>
            <p>Try a station name, a genre like jazz, or a country.</p>
          </div>
        )}
      </section>
    </div>
  );
}
