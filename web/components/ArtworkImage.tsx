'use client';

import { useState } from 'react';
import { Music2 } from 'lucide-react';

export function ArtworkImage({ src, className }: { src?: string | null; className: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || src === failedSrc) {
    return <div className={`${className} flex items-center justify-center bg-bg-hover text-text-muted`}><Music2 size={20} aria-hidden="true" /></div>;
  }
  return <img src={src} alt="" className={className} onError={() => setFailedSrc(src)} />;
}
