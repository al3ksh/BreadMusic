const express = require('express');

function createActivityRouter({
  discordApi,
  artworkMaxBytes,
  artworkRateLimit,
  tokenRateLimit,
  isAllowedArtworkHost,
}) {
  const router = express.Router();

  router.get('/api/activity/config', (_req, res) => {
    res.json({
      enabled: process.env.ACTIVITY_ENABLED !== 'false',
      clientId: process.env.DISCORD_CLIENT_ID || null,
    });
  });

  router.get('/api/activity/artwork', async (req, res) => {
    const artworkLimit = artworkRateLimit.check(req.ip || req.socket.remoteAddress);
    if (!artworkLimit.allowed) {
      res.setHeader('Retry-After', Math.ceil(artworkLimit.retryAfterMs / 1000));
      return res.status(429).json({ error: 'Too many artwork requests' });
    }

    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let artworkUrl;

    try {
      artworkUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid artwork URL' });
    }

    if (artworkUrl.protocol !== 'https:' || !isAllowedArtworkHost(artworkUrl.hostname)) {
      return res.status(403).json({ error: 'Artwork host is not allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(artworkUrl, {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'User-Agent': 'Bread Discord Activity' },
      });
      const contentType = response.headers.get('content-type') || '';
      const contentLength = Number(response.headers.get('content-length') || 0);

      if (!response.ok || !contentType.startsWith('image/')) {
        return res.status(404).json({ error: 'Artwork unavailable' });
      }
      if (contentLength > artworkMaxBytes) {
        return res.status(413).json({ error: 'Artwork is too large' });
      }

      const payload = Buffer.from(await response.arrayBuffer());
      if (payload.length > artworkMaxBytes) {
        return res.status(413).json({ error: 'Artwork is too large' });
      }

      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('Content-Type', contentType);
      return res.send(payload);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Activity artwork proxy failed:', error.message);
      }
      return res.status(502).json({ error: 'Could not load artwork' });
    } finally {
      clearTimeout(timeout);
    }
  });

  router.post('/api/activity/token', async (req, res) => {
    if (process.env.ACTIVITY_ENABLED === 'false') {
      return res.status(404).json({ error: 'Activity is disabled' });
    }

    const tokenLimit = tokenRateLimit.check(req.ip || req.socket.remoteAddress);
    if (!tokenLimit.allowed) {
      res.setHeader('Retry-After', Math.ceil(tokenLimit.retryAfterMs / 1000));
      return res.status(429).json({ error: 'Too many authorization attempts' });
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 512) {
      return res.status(400).json({ error: 'Activity authorization code is required' });
    }

    try {
      const tokenRes = await fetch(`${discordApi}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
        }),
      });
      const payload = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !payload.access_token) {
        return res.status(401).json({ error: 'Activity authorization failed' });
      }

      return res.json({
        access_token: payload.access_token,
        expires_in: payload.expires_in || 604800,
      });
    } catch (error) {
      console.error('Activity token exchange failed:', error.message);
      return res.status(502).json({ error: 'Could not reach Discord authorization service' });
    }
  });

  return router;
}

module.exports = { createActivityRouter };
