const crypto = require('node:crypto');
const express = require('express');
const { createSearchService } = require('./service.cjs');
const { createLyricsService } = require('./lyrics.cjs');

function createMetadataApp({ token = process.env.LANDING_DEMO_TOKEN, service, lyrics, lyricsEnabled = process.env.LANDING_DEMO_LYRICS_ENABLED === 'true' } = {}) {
  if (!token || token.length < 32) throw new Error('LANDING_DEMO_TOKEN must contain at least 32 characters');
  service ||= createSearchService({ address: process.env.LANDING_LAVALINK_URL || 'http://landing-lavalink:2333', password: process.env.LANDING_LAVALINK_PASSWORD || '' });
  lyrics ||= createLyricsService();
  const expected = Buffer.from(`Bearer ${token}`);
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    const supplied = Buffer.from(req.get('authorization') || '');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(403).json({ error: 'Forbidden' });
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  app.post('/search', async (req, res) => {
    try { res.json(await service.search(req.body?.query)); }
    catch (error) { res.status(error.status || (/Enter|supports|Unsupported/.test(error.message) ? 400 : 503)).json({ error: 'Search unavailable' }); }
  });
  app.get('/artwork', async (req, res) => {
    try {
      if (typeof req.query.id !== 'string' || !/^[a-f0-9]{32}$/.test(req.query.id)) return res.status(400).end();
      const image = await service.artwork(req.query.id);
      res.set('Cache-Control', 'private, max-age=300').type(image.type).send(image.body);
    } catch (error) { res.status(error.status || 502).end(); }
  });
  app.post('/lyrics', async (req, res) => {
    if (!lyricsEnabled) return res.status(403).json({ error: 'Lyrics disabled' });
    try { res.json({ lyrics: await lyrics(req.body) }); }
    catch (error) { res.status(error.status || 503).json({ error: 'Lyrics unavailable' }); }
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request' }));
  return app;
}

if (require.main === module) {
  const app = createMetadataApp();
  const server = app.listen(3001, '0.0.0.0', () => console.log('Landing metadata service on 3001; no playback endpoints.'));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { createMetadataApp };
