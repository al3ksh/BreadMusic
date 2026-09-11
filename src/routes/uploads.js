const express = require('express');
const fs = require('fs');
const path = require('path');
const { artworkPath, verifyArtworkUrl } = require('../music/uploadArtworkUrls');

function createUploadRouter({
  uploadDir,
  audioExtensions,
  hasValidUploadSignature,
  isSafeId,
  isPathInside,
  getAudioContentType,
}) {
  const router = express.Router();

  router.get('/api/uploads/:guildId/:fileId/:fileName', async (req, res) => {
    const { guildId, fileId, fileName } = req.params;
    if (!isSafeId(guildId) || !isSafeId(fileId)) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    const cover = /^artwork(\.[a-z0-9]+)\.jpg$/.exec(fileName);
    if (cover) {
      const ref = { guildId, uploadId: fileId, extension: cover[1] };
      if (!verifyArtworkUrl(ref, { expires: req.query.expires, signature: req.query.signature })) {
        return res.status(403).json({ error: 'Upload URL expired or invalid' });
      }
      const audioPath = path.join(uploadDir, guildId, `${fileId}${cover[1]}`);
      if (!isPathInside(audioPath, uploadDir)) return res.status(400).json({ error: 'Invalid upload path' });
      try {
        await fs.promises.access(audioPath, fs.constants.R_OK);
        const stats = await fs.promises.stat(artworkPath(audioPath));
        if (!stats.isFile() || !stats.size || stats.size > 256 * 1024) throw new Error('Missing artwork');
        const remaining = Math.max(0, Number(req.query.expires) - Math.ceil(Date.now() / 1000));
        res.setHeader('Cache-Control', `private, max-age=${Math.min(3600, remaining)}`);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(artworkPath(audioPath), (error) => {
          if (error && !res.headersSent) res.status(404).end();
        });
      } catch { return res.status(404).json({ error: 'Upload not found' }); }
    }

    const ext = path.extname(fileName || '').toLowerCase();
    if (!audioExtensions.has(ext)) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (!hasValidUploadSignature({
      guildId,
      uploadId: fileId,
      fileName,
      expires: req.query.expires,
      signature: req.query.signature,
    })) {
      return res.status(403).json({ error: 'Upload URL expired or invalid' });
    }

    const filePath = path.join(uploadDir, guildId, `${fileId}${ext}`);
    if (!isPathInside(filePath, uploadDir)) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Type', getAudioContentType(ext));
      res.sendFile(filePath);
    } catch {
      res.status(404).json({ error: 'Upload not found' });
    }
  });

  return router;
}

module.exports = { createUploadRouter };
