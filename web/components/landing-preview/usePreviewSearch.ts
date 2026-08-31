'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoTrack } from './demo';
export type SearchResult = { tracks: DemoTrack[]; playlist: { name: string; total: number; truncated: boolean } | null };
export function usePreviewSearch() {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = useCallback(() => { controller.current?.abort(); controller.current = null; setSearching(false); setError(''); }, []);
  const search = useCallback(async (query: string): Promise<SearchResult | null> => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setSearching(true); setError('');
    try {
      const response = await fetch('/demo/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed. Please retry.');
      if (data.mode === 'catalogue' && !data.tracks.length) throw new Error('Live search is not enabled. Choose one of the sample tracks.');
      return data as SearchResult;
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search failed. Please retry.');
      return null;
    } finally { if (controller.current === request) setSearching(false); }
  }, []);
  return { search, searching, error, cancel };
}
