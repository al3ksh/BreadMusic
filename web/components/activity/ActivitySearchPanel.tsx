import { ChevronDown, FileAudio, ListPlus, Play, Search, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { QueueTrack } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';

type SearchTrack = QueueTrack & { encoded?: string };
type SearchPlaylist = { key: string; name: string; trackCount: number; totalDuration: number; artwork?: string | null; truncated?: boolean };

type ActivitySearchPanelProps = {
  canDj: boolean;
  canQueue: boolean;
  hasTrack: boolean;
  actionBusy: string | null;
  searchQuery: string;
  searching: boolean;
  searchPlaylist: SearchPlaylist | null;
  searchResults: SearchTrack[];
  searchCompletedQuery: string;
  uploadFile: File | null;
  uploading: boolean;
  onQueryChange: (value: string) => void;
  submitSearch: () => void | Promise<unknown>;
  handleUploadSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  handleUpload: () => void | Promise<unknown>;
  addSearchPlaylist: () => void | Promise<unknown>;
  playSearchResult: (track: SearchTrack, mode: 'now' | 'queue') => void | Promise<unknown>;
};

export function ActivitySearchPanel({
  canDj,
  canQueue,
  hasTrack,
  actionBusy,
  searchQuery,
  searching,
  searchPlaylist,
  searchResults,
  searchCompletedQuery,
  uploadFile,
  uploading,
  onQueryChange,
  submitSearch,
  handleUploadSelection,
  handleUpload,
  addSearchPlaylist,
  playSearchResult,
}: ActivitySearchPanelProps) {
  return (
    <div className="activity-search-panel">
      <div className="activity-search-box">
        <Search size={18} />
        <input
          disabled={!canQueue}
          value={searchQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submitSearch();
          }}
          placeholder="Search YouTube or paste a link"
          aria-label="Search for a track"
        />
        <button type="button" onClick={submitSearch} disabled={!canQueue || searching || !searchQuery.trim()} aria-label="Search">
          {searching ? <ActivitySpinner /> : <ChevronDown size={17} className="activity-search-arrow" />}
        </button>
      </div>
      <div className="activity-upload-row">
        <input type="file" accept=".mp3,.flac,.wav,.ogg,.m4a,.aac,.opus,.webm,audio/*" className="sr-only" id="activity-upload" disabled={!canDj} onChange={handleUploadSelection} />
        <label htmlFor="activity-upload" className={`activity-upload-picker ${!canDj ? 'disabled' : ''}`}><Upload size={15} /> Choose audio</label>
        {uploadFile && (
          <>
            <span className="activity-upload-name" title={uploadFile.name}>{uploadFile.name}</span>
            <button type="button" className="activity-upload-submit" disabled={uploading || !canDj} onClick={handleUpload}>
              {uploading ? <ActivitySpinner /> : <FileAudio size={15} />} {uploading ? 'Uploading' : 'Queue'}
            </button>
          </>
        )}
      </div>
      {(searchPlaylist || searchResults.length > 0) && (
        <div className="activity-search-results">
          {searchPlaylist && (
            <div className="activity-search-playlist">
              <ActivityArtwork src={searchPlaylist.artwork} />
              <span>
                <strong>{searchPlaylist.name}</strong>
                <small>{searchPlaylist.trackCount} tracks - {formatMs(searchPlaylist.totalDuration)}{searchPlaylist.truncated ? ' - first 500 loaded' : ''}</small>
              </span>
              <button type="button" disabled={!canDj || Boolean(actionBusy)} onClick={addSearchPlaylist} title={hasTrack ? 'Add playlist to queue' : 'Play playlist'} aria-label={hasTrack ? `Add ${searchPlaylist.name} to queue` : `Play ${searchPlaylist.name}`}>
                {hasTrack ? <ListPlus size={15} /> : <Play size={15} />}
              </button>
            </div>
          )}
          {searchResults.map((track, index) => (
            <div key={`${track.uri}-${index}`} className="activity-search-result">
              <ActivityArtwork src={track.artwork} />
              <span><strong>{track.title}</strong><small>{track.author} - {formatMs(track.duration)}</small></span>
              <div className="activity-search-actions">
                {hasTrack && <button type="button" disabled={!canDj || Boolean(actionBusy)} onClick={() => playSearchResult(track, 'now')} title="Play now" aria-label={`Play ${track.title} now`}><Play size={15} /></button>}
                <button type="button" disabled={!canQueue || Boolean(actionBusy)} onClick={() => playSearchResult(track, 'queue')} title={canDj && !hasTrack ? 'Play' : 'Add to queue'} aria-label={canDj && !hasTrack ? `Play ${track.title}` : `Add ${track.title} to queue`}>
                  {canDj && !hasTrack ? <Play size={15} /> : <ListPlus size={15} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!searching && searchResults.length === 0 && searchCompletedQuery === searchQuery.trim() && searchCompletedQuery && (
        <div className="activity-search-empty" role="status">
          <span><Search size={21} /></span>
          <strong>No results found</strong>
          <p>Try another title or artist, or paste a direct track link.</p>
        </div>
      )}
    </div>
  );
}

function formatMs(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
