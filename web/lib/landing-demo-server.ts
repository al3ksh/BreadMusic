import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { demoTracks } from '../components/landing-preview/demo';

type Env = Record<string, string | undefined>;
type Kind = 'search' | 'lyrics' | 'artwork';
const budgets = { search: [60, 12, 2], lyrics: [20, 6, 2], artwork: [180, 60, 8] } as const;

export function landingDemoConfig(env: Env = process.env) {
  let origin = '';
  let worker = '';
  try {
    const url = new URL(env.WEB_URL || 'http://localhost:3000');
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) origin = url.origin;
  } catch { /* Invalid configuration fails closed for writes. */ }
  try {
    const url = new URL(env.LANDING_DEMO_SEARCH_URL || '');
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) worker = url.origin;
  } catch { /* A standalone web deployment uses the sample catalogue. */ }
  const token = env.LANDING_DEMO_TOKEN || '';
  const liveSearch = Boolean(worker && token.length >= 32);
  return { origin, worker, token, liveSearch, liveLyrics: liveSearch && env.LANDING_DEMO_LYRICS_ENABLED === 'true' };
}

class DemoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number, timeout: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new DemoError(408, 'Request timed out.')); void reader.cancel().catch(() => {}); }, timeout);
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new DemoError(413, 'Request is too large.');
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function createLandingDemoHandler({ env = process.env, request = fetch, now = Date.now }: { env?: Env; request?: typeof fetch; now?: () => number } = {}) {
  const windows = new Map<string, { count: number; expires: number }>();
  const active: Record<Kind, number> = { search: 0, lyrics: 0, artwork: 0 };
  function consume(key: string, maximum: number) {
    const time = now();
    for (const [key, entry] of windows) if (entry.expires <= time) windows.delete(key);
    let entry = windows.get(key);
    if (!entry) {
      if (windows.size >= 2048) return false;
      entry = { count: 0, expires: time + 60_000 };
      windows.set(key, entry);
    }
    return ++entry.count <= maximum;
  }
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });

  return async (incoming: Request) => {
    const path = new URL(incoming.url);
    const kind = path.pathname.split('/').at(-1) as Kind;
    if (!Object.hasOwn(budgets, kind)) return json({ error: 'Not found' }, 404);
    if (incoming.method !== (kind === 'artwork' ? 'GET' : 'POST')) return json({ error: 'Method not allowed' }, 405);
    const config = landingDemoConfig(env);
    if (incoming.method === 'POST') {
      const origin = incoming.headers.get('origin');
      const allowed = [config.origin];
      if (env.BREAD_LANDING_PREVIEW === '1') allowed.push('http://localhost:3181', 'http://127.0.0.1:3181');
      if (!origin || !allowed.includes(origin) || incoming.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Untrusted origin' }, 403);
      if (incoming.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Use application/json.' }, 415);
    }
    // Trust only a single IP header explicitly configured behind a proxy which
    // overwrites it. Without one, visitors share a conservative anonymous bucket.
    const ipHeader = env.LANDING_DEMO_CLIENT_IP_HEADER?.toLowerCase();
    const rawIp = ipHeader && ['x-real-ip', 'cf-connecting-ip'].includes(ipHeader) ? incoming.headers.get(ipHeader)?.trim() : '';
    const client = rawIp && isIP(rawIp) ? createHash('sha256').update(rawIp).digest('hex') : 'anonymous';
    const [globalLimit, clientLimit, concurrency] = budgets[kind];
    if (!consume(kind, globalLimit) || !consume(`${kind}:${client}`, clientLimit) || active[kind] >= concurrency) return json({ error: 'Demo is busy. Try again in a minute.' }, 429);
    active[kind]++;
    try {
      let body: string | undefined;
      let query = '';
      if (incoming.method === 'POST') {
        const declaredLength = Number(incoming.headers.get('content-length') || 0);
        if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 2048) throw new DemoError(413, 'Request is too large.');
        let data;
        try { data = JSON.parse(new TextDecoder().decode(await readLimited(incoming.body, 2048, 3000))); }
        catch (error) { if (error instanceof DemoError) throw error; throw new DemoError(400, 'Invalid request.'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DemoError(400, 'Invalid request.');
        if (kind === 'search') {
          if (typeof data.query !== 'string' || data.query.trim().length < 2 || data.query.length > 200 || /[\x00-\x1f]/.test(data.query)) throw new DemoError(400, 'Enter a title or artist (2-200 characters).');
          query = data.query.trim();
          body = JSON.stringify({ query });
        } else {
          if (![data.artist, data.title].every(value => typeof value === 'string' && value.trim() && value.length <= 200) || !Number.isFinite(data.duration) || data.duration < 0 || data.duration > 86400000) throw new DemoError(400, 'Invalid lyrics query.');
          if (!config.liveLyrics) return json({ error: 'Live lyrics are not enabled in this demo.' }, 403);
          body = JSON.stringify({ artist: data.artist, title: data.title, duration: data.duration });
        }
      }
      const id = path.searchParams.get('id') || '';
      if (kind === 'artwork' && !/^[a-f0-9]{32}$/.test(id)) throw new DemoError(400, 'Invalid artwork.');
      if (!config.liveSearch) {
        if (kind === 'artwork') return json({ error: 'Artwork not found' }, 404);
        const normalized = query.toLowerCase().replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ');
        return json({ tracks: demoTracks.filter(track => `${track.artist} ${track.title}`.toLowerCase().includes(normalized) || `${track.title} ${track.artist}`.toLowerCase().includes(normalized)), playlist: null, mode: 'catalogue' });
      }
      const response = await request(`${config.worker}/${kind}${kind === 'artwork' ? `?id=${id}` : ''}`, {
        method: incoming.method, body, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(18_000), redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 429) return json({ error: 'Demo is busy. Try again in a minute.' }, 429);
        if (response.status === 400) return json({ error: 'Unsupported query. Use a title, artist, YouTube or SoundCloud link.' }, 400);
        if (kind === 'artwork' && response.status === 404) return json({ error: 'Artwork not found' }, 404);
        throw new DemoError(503, 'Music lookup is unavailable. Try again shortly.');
      }
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (kind === 'artwork' ? !['image/jpeg', 'image/png', 'image/webp'].includes(type) : type !== 'application/json') throw new DemoError(502, 'Invalid provider response.');
      const bytes = await readLimited(response.body, kind === 'artwork' ? 2 * 1024 * 1024 : 1024 * 1024, 18_000);
      return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': kind === 'artwork' ? 'private, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      return json({ error: error instanceof DemoError ? error.message : 'Music lookup is unavailable. Try again shortly.' }, error instanceof DemoError ? error.status : 503);
    } finally { active[kind]--; }
  };
}

export const handleLandingDemo = createLandingDemoHandler();
