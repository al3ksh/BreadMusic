import { BookOpenText, Library, ListMusic, Search } from 'lucide-react';

type ActivityPanel = 'queue' | 'search' | 'lyrics' | 'sound' | 'library' | null;

type NavPanel = Exclude<ActivityPanel, null | 'sound'>;

type ActivityPanelNavProps<P extends NavPanel> = {
  activePanel: ActivityPanel;
  queueTotal: number;
  canQueue: boolean;
  hasTrack: boolean;
  togglePanel: (panel: P) => void;
  // The Library tab only shows where the listener has a personal library (not the landing demo).
  showLibrary?: boolean;
};

export function ActivityPanelNav<P extends NavPanel>({ activePanel, queueTotal, canQueue, hasTrack, togglePanel, showLibrary }: ActivityPanelNavProps<P>) {
  const toggle = togglePanel as (panel: NavPanel) => void;
  return (
    <nav className="activity-panel-nav" aria-label="Player panels">
      <button type="button" className={activePanel === 'queue' ? 'active' : ''} aria-pressed={activePanel === 'queue'} onClick={() => toggle('queue')}>
        <ListMusic size={18} /><span>Queue</span><em>{queueTotal}</em>
      </button>
      <button type="button" className={activePanel === 'search' ? 'active' : ''} aria-pressed={activePanel === 'search'} disabled={!canQueue} onClick={() => toggle('search')}>
        <Search size={18} /><span>Add music</span>
      </button>
      <button type="button" className={activePanel === 'lyrics' ? 'active' : ''} aria-pressed={activePanel === 'lyrics'} disabled={!hasTrack} onClick={() => toggle('lyrics')}>
        <BookOpenText size={18} /><span>Lyrics</span>
      </button>
      {showLibrary && (
        <button type="button" className={activePanel === 'library' ? 'active' : ''} aria-pressed={activePanel === 'library'} onClick={() => toggle('library')}>
          <Library size={18} /><span>Library</span>
        </button>
      )}
    </nav>
  );
}
