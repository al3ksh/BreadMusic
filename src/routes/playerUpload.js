// @ts-check
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareUploadArtwork, storeUploadArtwork } = require('../music/uploadArtwork');
const { uploadArtworkUrl } = require('../music/uploadArtworkUrls');
const { fitQueueLimit } = require('../music/queueInsert');
const { CommandError } = require('../utils/commandError');

function createPlayerUploadRouter({
  client,
  requireAuth,
  requirePlayerAccess,
  requireTrustedOrigin,
  requireDashboardActionRateLimit,
  acquireGuildMutex,
  resolvePlayerTextChannelId,
  getConfig,
  sanitizeUploadName,
  decodeUploadHeader,
  isAllowedAudioUpload,
  uploadDir,
  uploadMaxBytes,
  activeUploadTempPaths,
  streamUploadToFile,
  isPathInside,
  acquireUploadQuotaMutex,
  cleanupExpiredAudioUploads,
  fileExists,
  safeDeleteFile,
  touchFile,
  makeRoomForAudioUpload,
  renameFileWithRetry,
  createSignedUploadUrl,
  getUploadPlaybackBaseUrl,
  getDashboardRequester,
  getUsableNode,
  isUnknownTrackAuthor,
  addManualTrackToQueue,
  audioUploadTtlMs,
  audioUploadQuotaBytes,
  savePlayerState,
  waitForPlayerVoice,
  activityVoiceReconnectDelayMs,
  hydratePlayer,
  audioUploadDirectory,
  broadcastPlayerUpdate,
}) {
  const router = express.Router();

  router.post(
    '/api/guilds/:guildId/player/upload',
    requireAuth,
    requirePlayerAccess,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    async (req, res) => {
      const canUpload = req.activityUser
        ? req.dashboardCapabilities?.canControlPlayer
        : req.dashboardCapabilities?.canUpload;
      if (canUpload !== true) {
        return res.status(403).json({ error: 'Player control is not enabled for your role' });
      }
      const guildId = req.params.guildId;
      res.once('finish', () => broadcastPlayerUpdate(guildId));
      const releaseUpload = await acquireGuildMutex(guildId);
      const guild = client.guilds.cache.get(guildId);
      let player = client.lavalink?.players?.get(guildId);
      let uploadTempPath = null;
      let activeUploadTempPath = null;
      let storedFilePath = null;
      let protectedUploadPath = null;

      try {
        const guildConfig = getConfig(guildId);
        const resolveUploadChannel = () => {
          const memberVoiceChannelId = req.guildMember?.voice?.channelId;
          const botVoiceChannelId = guild?.members?.me?.voice?.channelId;
          const channelId = req.activityUser
            ? memberVoiceChannelId
            : memberVoiceChannelId || botVoiceChannelId || player?.voiceChannelId;
          if (!channelId) {
            res.status(403).json({ error: 'Join a voice channel before uploading audio' });
            return null;
          }
          if (!guild?.channels?.cache?.get(channelId)?.isVoiceBased()) {
            res.status(400).json({ error: 'The Activity channel is not a voice channel' });
            return null;
          }
          if (botVoiceChannelId && botVoiceChannelId !== channelId) {
            res.status(409).json({ error: 'Bread is already active in another voice channel' });
            return null;
          }
          return channelId;
        };
        if (!resolveUploadChannel()) return;
        // Refuse before a long upload when the person has no room left in the queue.
        const limitOptions = { userId: getDashboardRequester(req, client).id, member: req.guildMember, config: guildConfig };
        if (player) fitQueueLimit(player, [null], limitOptions);

        const originalName = sanitizeUploadName(decodeUploadHeader(req.get('x-file-name')) || 'upload');
        const ext = path.extname(originalName).toLowerCase();
        const mimeType = String(req.get('content-type') || '').split(';')[0].toLowerCase();

        if (!isAllowedAudioUpload(ext, mimeType)) {
          return res.status(400).json({ error: 'Unsupported audio file type' });
        }

        const guildUploadDir = path.join(uploadDir, guildId);
        await fs.promises.mkdir(guildUploadDir, { recursive: true });

        uploadTempPath = path.join(
          guildUploadDir,
          `.incoming-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tmp`,
        );
        activeUploadTempPath = path.resolve(uploadTempPath);
        activeUploadTempPaths.add(activeUploadTempPath);
        const streamedUpload = await streamUploadToFile(req, uploadTempPath, uploadMaxBytes);
        const streamedUploadId = streamedUpload.uploadId;
        uploadTempPath = streamedUpload.path;
        if (!streamedUpload.size) {
          return res.status(400).json({ error: 'Upload body is empty' });
        }

        const filePath = path.join(guildUploadDir, `${streamedUploadId}${ext}`);
        if (!isPathInside(filePath, audioUploadDirectory)) {
          return res.status(400).json({ error: 'Invalid upload path' });
        }

        const releaseQuota = await acquireUploadQuotaMutex();
        let alreadyStored;
        try {
          await cleanupExpiredAudioUploads(client);
          alreadyStored = await fileExists(filePath);
          if (alreadyStored) {
            await safeDeleteFile(uploadTempPath);
            uploadTempPath = null;
            await touchFile(filePath);
          } else {
            const hasRoom = await makeRoomForAudioUpload(streamedUpload.size, client, uploadTempPath);
            if (!hasRoom) {
              await safeDeleteFile(uploadTempPath);
              uploadTempPath = null;
              return res.status(507).json({
                error: `Upload storage limit reached (${Math.floor(audioUploadQuotaBytes / (1024 * 1024))} MB); all older files are still in use`,
              });
            }

            await renameFileWithRetry(uploadTempPath, filePath);
            uploadTempPath = null;
            storedFilePath = filePath;
          }
          protectedUploadPath = path.resolve(filePath);
          activeUploadTempPaths.add(protectedUploadPath);
        } finally {
          releaseQuota();
        }

        const playbackUrl = createSignedUploadUrl({
          baseUrl: getUploadPlaybackBaseUrl(),
          guildId,
          uploadId: streamedUploadId,
          fileName: originalName,
        });
        const requester = getDashboardRequester(req, client);
        const node = getUsableNode(client);
        if (!node) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          return res.status(503).json({ error: 'No Lavalink node available' });
        }

        let result;
        try {
          result = await node.search({ query: playbackUrl }, requester);
        } catch (error) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          console.error('Lavalink upload load failed:', error);
          return res.status(502).json({ error: `Lavalink could not load upload URL: ${error.message}` });
        }

        const track = result?.tracks?.[0];
        if (!track) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          return res.status(400).json({ error: 'Lavalink could not load this audio file' });
        }

        const uploadTitle = track.info?.title || path.basename(originalName, ext);
        const uploadAuthor = isUnknownTrackAuthor(track.info?.author) ? 'Local upload' : track.info.author;
        const queuedTrack = {
          ...track,
          info: {
            ...track.info,
            title: uploadTitle,
            author: uploadAuthor,
            uri: track.info?.uri || playbackUrl,
            sourceName: 'localUpload',
            isLocalUpload: true,
          },
          origin: 'upload',
        };
        queuedTrack.localUpload = {
          guildId,
          uploadId: streamedUploadId,
          fileName: originalName,
          filePath,
          expiresAt: Date.now() + audioUploadTtlMs,
          cached: alreadyStored,
        };

        // Artwork is optional and bounded; finish it before publishing the queue
        // so SSE clients see the same track and cover in their first snapshot.
        try {
          const artwork = await prepareUploadArtwork(filePath);
          let available = artwork?.cached && artwork.hasCover;
          if (artwork && !artwork.cached) {
            const releaseArtworkQuota = await acquireUploadQuotaMutex();
            try {
              if (await makeRoomForAudioUpload(artwork.data.length, client)) {
                available = await storeUploadArtwork(filePath, artwork.data) && artwork.hasCover;
              }
            } finally { releaseArtworkQuota(); }
          }
          if (available) {
            queuedTrack.info.uploadArtwork = { guildId, uploadId: streamedUploadId, extension: ext };
            queuedTrack.info.artworkUrl = uploadArtworkUrl(queuedTrack.info.uploadArtwork, { publicUrl: true });
          }
        } catch { /* Cover failures must never reject a playable upload. */ }

        // Uploads can take minutes. Recheck voice state before joining, and
        // only summon the bot once Lavalink has accepted the audio file.
        const voiceChannelId = resolveUploadChannel();
        if (!voiceChannelId) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          return;
        }
        const connectedBotVoiceChannelId = guild.members.me?.voice?.channelId;
        const createdPlayer = !player;
        const textChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player?.textChannelId ?? null);
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId,
            textChannelId,
            selfDeaf: true,
            volume: guildConfig.defaultVolume ?? 60,
          });
        } else {
          player.voiceChannelId = voiceChannelId;
          player.textChannelId = textChannelId;
        }
        if (createdPlayer || !connectedBotVoiceChannelId) {
          if (createdPlayer && connectedBotVoiceChannelId) {
            await player.disconnect(true).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, activityVoiceReconnectDelayMs));
          }
          await player.connect();
          const voiceReady = await waitForPlayerVoice(player);
          if (!voiceReady) console.warn(`[Player] Voice handshake still pending for guild ${guildId}; continuing upload request.`);
          if (createdPlayer) {
            await hydratePlayer(player, client).catch((error) => {
              console.error(`Failed to restore upload player for ${guildId}:`, error.message);
            });
          }
        }

        fitQueueLimit(player, [queuedTrack], limitOptions);
        const startedFromIdle = !player.queue.current || (!player.playing && !player.paused);
        await addManualTrackToQueue(player, queuedTrack);

        if (startedFromIdle) {
          await player.play();
          await client.musicUI?.refresh(player).catch(() => {});
        }

        await savePlayerState(player).catch(() => {});

        res.json({
          success: true,
          title: queuedTrack.info.title,
          author: queuedTrack.info.author,
          size: streamedUpload.size,
          cached: alreadyStored,
          started: startedFromIdle,
        });
      } catch (err) {
        console.error('Player upload error:', err);
        await safeDeleteFile(uploadTempPath);
        if (!res.headersSent && err instanceof CommandError) {
          res.status(409).json({ error: err.message });
        } else if (!res.headersSent) {
          const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code === 'ECONNABORTED' ? 400 : 500;
          res.status(status).json({ error: `Upload failed: ${err.message}` });
        }
      } finally {
        if (activeUploadTempPath) activeUploadTempPaths.delete(activeUploadTempPath);
        if (protectedUploadPath) activeUploadTempPaths.delete(protectedUploadPath);
        releaseUpload();
      }
    },
  );

  return router;
}

module.exports = { createPlayerUploadRouter };
