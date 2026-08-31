'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoTrack } from './demo';
import { duration } from './demo-state';
export type PreviewLyrics = { plainLyrics: string; lines: { time: number; text: string }[]; instrumental: boolean; provider: string };
export function usePreviewLyrics(track: DemoTrack | null, enabled: boolean) {
  const [lyrics, setLyrics] = useState<PreviewLyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const key = track ? `${track.artist}|${track.title}|${track.duration}` : '';
  const current = useRef(track); current.current = track;
  const load = useCallback(async () => {
    request.current?.abort();
    const track = current.current;
    if (!track) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setLyrics(null);
    try {
      const response = await fetch('/demo/api/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: track.artist, title: track.title, duration: duration(track) * 1000 }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Lyrics unavailable. Please retry.');
      if (!controller.signal.aborted) { setLyrics(result.lyrics); if (!result.lyrics) setError('No lyrics found for this track.'); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Lyrics unavailable.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    request.current?.abort(); setLyrics(null); setError(''); setLoading(false);
    if (enabled && key) void load();
    return () => request.current?.abort();
  }, [key, enabled, load]);
  return { lyrics, loading, error, load };
}
