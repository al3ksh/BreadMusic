'use client';

import { memo, useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';

function activityArtworkSrc(value: string | null | undefined) {
  if (!value || value.startsWith('/')) return value || '';
  return `/api/activity/artwork?url=${encodeURIComponent(value)}`;
}

export const ActivitySpinner = memo(function ActivitySpinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
});

export const ActivityArtwork = memo(function ActivityArtwork({ src, large = false }: { src?: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div className={large ? 'activity-art-fallback' : 'activity-queue-art'}>
        <Music2 size={large ? 46 : 15} />
      </div>
    );
  }

  return <img src={activityArtworkSrc(src)} alt="" onError={() => setFailed(true)} />;
});
