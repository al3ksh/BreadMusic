const express = require('express');

function createHealthRouter(client) {
  const router = express.Router();

  router.get('/api/healthz', (_req, res) => {
    let totalNodes = 0;
    let connectedNodes = 0;
    const nodes = client.lavalink?.nodeManager?.nodes;
    if (nodes) {
      for (const node of nodes.values()) {
        totalNodes += 1;
        if (node.connected) connectedNodes += 1;
      }
    }

    const discordReady = Boolean(client.isReady?.());
    const lavalinkReady = connectedNodes > 0;
    const ok = discordReady && lavalinkReady;

    res.status(ok ? 200 : 503).json({
      ok,
      api: { ok: true },
      discord: {
        ok: discordReady,
        wsStatusCode: client.ws?.status ?? null,
      },
      lavalink: {
        ok: lavalinkReady,
        connectedNodes,
        totalNodes,
      },
      timestamp: Date.now(),
    });
  });

  return router;
}

module.exports = { createHealthRouter };
