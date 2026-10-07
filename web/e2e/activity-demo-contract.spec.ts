import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artwork, autoplayPool, demoStations, demoTracks } from '../components/landing-preview/demo';
import { createDemoBackend, createLocalHost } from '../components/landing-preview/demo-backend';

// The landing demo runs the real ActivityApp against an in-browser fake backend. This reads every request
// the Activity can make from its source and checks the fake backend knows it, so a new endpoint, player
// action or library route fails here instead of breaking quietly on the landing page.
const root = join(__dirname, '..');
const sources = ['components/activity', 'lib/activity']
  .flatMap(dir => readdirSync(join(root, dir)).filter(file => /\.tsx?$/.test(file)).map(file => readFileSync(join(root, dir, file), 'utf8')))
  .join('\n');
const all = (pattern: RegExp) => [...new Set([...sources.matchAll(pattern)].map(match => match[1]))].sort();
const fill = (template: string) => template.replace(/\$\{(?:sdk\.)?guildId\}/g, 'demo').replace(/\$\{[^}]+\}/g, 'x');

// Not fetched through the backend: artwork is an <img> proxy for remote covers (the demo only has local
// ones, checked below) and uploads is a URL check. Helper templates are covered by the action and library lists.
const notFetched = ['/api/activity/artwork?url=${encodeURIComponent(value)}', '/api/uploads/'];
const endpoints = all(/[`'](\/api\/[^`']*)[`']/g).filter(path => !notFetched.includes(path) && !/\$\{(action|path)\}/.test(path));
const actions = all(/(?:playerAction|runControlAction)\(\s*'([a-z_]+)'/g);
const libraryPaths = all(/(?:libraryRequest|request)(?:<[^>]*>)?\(\s*[`']((?:\/[^`']*)?)[`']/g).filter(path => !path.startsWith('/api/'));

test('the source scan finds the Activity requests', () => {
  expect(endpoints).toEqual(expect.arrayContaining(['/api/activity/config', '/api/guilds/${guildId}/status', '/api/guilds/${guildId}/player/events?page=0']));
  expect(actions).toEqual(expect.arrayContaining(['toggle', 'skip', 'seek', 'autoplay_reroll']));
  expect(libraryPaths).toEqual(expect.arrayContaining(['', '/sounds/save', '/liked/add']));
});

test('the demo backend answers every request the Activity makes', async () => {
  const origin = 'http://demo.test';
  Object.assign(globalThis, { window: { location: { origin, href: `${origin}/activity/demo` }, setInterval, clearInterval, open: () => null } });
  const passthrough: string[] = [];
  const backend = createDemoBackend(createLocalHost(), async input => {
    passthrough.push(String(input));
    return Response.json({ tracks: [], playlist: null, mode: 'catalogue' });
  });

  const unknown: string[] = [];
  const known = async (path: string, init?: RequestInit) => {
    const controller = new AbortController();
    const response = await backend.fetch(`${origin}${fill(path)}`, { ...init, signal: controller.signal });
    // A domain error (nothing playing, demo limits) is fine; the router not knowing the route is not.
    const body = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
    controller.abort();
    return !(body?.error === 'Not found' || /^Unknown action/.test(body?.error || ''));
  };
  const check = async (path: string, init?: RequestInit) => { if (!await known(path, init)) unknown.push(`${init?.method || 'GET'} ${path}`); };
  for (const path of endpoints) await check(path, /\/player\//.test(path) && !path.includes('events') ? { method: 'POST', body: '{}' } : undefined);
  for (const action of actions) await check(`/api/guilds/demo/player/${action}`, { method: 'POST', body: '{}' });
  // Library reads are GETs and writes are POSTs; either is fine as long as the route exists.
  for (const path of libraryPaths) {
    const url = `/api/guilds/demo/library${path}`;
    if (!await known(url) && !await known(url, { method: 'POST', body: '{}' })) unknown.push(`library ${path}`);
  }
  expect(unknown).toEqual([]);
  // Search and lyrics are proxied to the public demo endpoints, never to the real API.
  expect(passthrough.filter(url => !url.startsWith('/demo/api/'))).toEqual([]);
});

test('demo artwork is local, so the Activity never sends it through the /api artwork proxy', () => {
  const covers = [...demoTracks, ...autoplayPool].map(artwork).concat(demoStations.map(station => station.artwork));
  expect(covers.filter(cover => !cover.startsWith('/') && !cover.startsWith('data:image/'))).toEqual([]);
});
