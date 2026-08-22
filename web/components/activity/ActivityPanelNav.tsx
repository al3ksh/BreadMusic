import { BookOpenText, ListMusic, Search } from 'lucide-react';

type ActivityPanel = 'queue' | 'search' | 'lyrics' | null;

type ActivityPanelNavProps = {
  activePanel: ActivityPanel;
  queueTotal: number;
  canDj: boolean;
  hasTrack: boolean;
  togglePanel: (panel: Exclude<ActivityPanel, null>) => void;
};

export function ActivityPanelNav({ activePanel, queueTotal, canDj, hasTrack, togglePanel }: ActivityPanelNavProps) {
  return (
    <nav className="activity-panel-nav" aria-label="Player panels">
      <button type="button" className={activePanel === 'queue' ? 'active' : ''} aria-pressed={activePanel === 'queue'} onClick={() => togglePanel('queue')}>
        <ListMusic size={18} /><span>Queue</span><em>{queueTotal}</em>
      </button>
      <button type="button" className={activePanel === 'search' ? 'active' : ''} aria-pressed={activePanel === 'search'} disabled={!canDj} onClick={() => togglePanel('search')}>
        <Search size={18} /><span>Add music</span>
      </button>
      <button type="button" className={activePanel === 'lyrics' ? 'active' : ''} aria-pressed={activePanel === 'lyrics'} disabled={!hasTrack} onClick={() => togglePanel('lyrics')}>
        <BookOpenText size={18} /><span>Lyrics</span>
      </button>
    </nav>
  );
}
