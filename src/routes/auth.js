const express = require('express');
const crypto = require('crypto');

function createAuthRouter({ discordApi, scopes, requireAuth, requireTrustedOrigin, refreshAccessToken }) {
  const router = express.Router();

  router.get('/api/auth/discord', (req, res) => {
    const oauthState = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = oauthState;

    const redirectUri = `${process.env.WEB_URL || 'http://localhost:3000'}/api/auth/callback`;
    req.session.save((err) => {
      if (err) {
        console.error('OAuth state save error:', err);
        return res.redirect('/?error=session_failed');
      }

      const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        state: oauthState,
      });
      res.redirect(`https://discord.com/oauth2/authorize?${params}`);
    });
  });

  router.get('/api/auth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
    const expectedState = typeof req.session.oauthState === 'string' ? req.session.oauthState : '';

    delete req.session.oauthState;
    req.session.save(() => {});

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      return res.redirect('/?error=invalid_state');
    }

    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      return res.redirect('/?error=no_code');
    }

    const redirectUri = `${process.env.WEB_URL || 'http://localhost:3000'}/api/auth/callback`;

    try {
      const tokenRes = await fetch(`${discordApi}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.json().catch(() => ({}));
        console.error('Token exchange failed:', errBody);
        return res.redirect('/?error=token_failed');
      }

      const tokens = await tokenRes.json();
      const userRes = await fetch(`${discordApi}/users/@me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userRes.ok) {
        return res.redirect('/?error=user_fetch_failed');
      }

      const user = await userRes.json();
      const sessionUser = {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpires: Date.now() + tokens.expires_in * 1000,
      };

      await new Promise((resolve, reject) => {
        req.session.regenerate((sessionError) => (sessionError ? reject(sessionError) : resolve()));
      });
      req.session.user = sessionUser;
      await new Promise((resolve, reject) => {
        req.session.save((sessionError) => (sessionError ? reject(sessionError) : resolve()));
      });

      return res.redirect('/dashboard');
    } catch (err) {
      console.error('OAuth callback error:', err);
      return res.redirect('/?error=session_failed');
    }
  });

  router.post('/api/auth/logout', requireTrustedOrigin, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('bread.sid');
      res.json({ success: true });
    });
  });

  router.get('/api/auth/logout', (_req, res) => {
    res.status(405).json({ error: 'Use POST /api/auth/logout' });
  });

  router.get('/api/me', requireAuth, async (req, res) => {
    try {
      let user = req.session.user;

      if (Date.now() > (user.tokenExpires || 0)) {
        const refreshed = await refreshAccessToken(user.refreshToken);
        if (refreshed) {
          user = {
            ...user,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || user.refreshToken,
            tokenExpires: Date.now() + refreshed.expires_in * 1000,
          };
          req.session.user = user;
          req.session.save(() => {});
        }
      }

      res.json({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
      });
    } catch (err) {
      console.error('Get me error:', err);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
