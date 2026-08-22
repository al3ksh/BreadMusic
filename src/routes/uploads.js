const express = require('express');
const fs = require('fs');
const path = require('path');

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
