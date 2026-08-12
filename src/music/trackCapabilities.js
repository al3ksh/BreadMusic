const MIRROR_SOURCES = new Set(['spotify', 'applemusic', 'apple-music', 'tidal']);

function getMirrorSource(track) {
  const sourceName = String(track?.info?.sourceName || '').toLowerCase();
  return MIRROR_SOURCES.has(sourceName) ? sourceName : null;
}

function isTrackSeekable(track) {
  const info = track?.info || {};
  if (info.isStream) return false;
  if (info.isSeekable) return true;

  const duration = Number(info.duration ?? info.length ?? 0);
  // LavaSrc exposes mirror sources with conservative seek metadata even when
  // the mirrored audio track is finite and has a usable duration.
  return Boolean(getMirrorSource(track)) && Number.isFinite(duration) && duration > 0;
}

function getTrackCapabilityMetadata(track) {
  const info = track?.info || {};
  return {
    seekable: isTrackSeekable(track),
    isStream: Boolean(info.isStream),
  };
}

function isMirrorTrack(track) {
  const info = track?.info || {};
  const duration = Number(info.duration ?? info.length ?? 0);
  return Boolean(getMirrorSource(track))
    && !info.isStream
    && Number.isFinite(duration)
    && duration > 0;
}

async function seekTrack(player, position) {
  const track = player?.queue?.current;
  if (!track || !isTrackSeekable(track)) {
    throw new RangeError('Current Track is not seekable / a stream');
  }

  if (!isMirrorTrack(track)) {
    return player.seek(position);
  }

  const duration = Number(track.info.duration ?? track.info.length);
  const boundedPosition = Math.max(Math.min(Number(position), duration), 0);
  player.lastPositionChange = Date.now();
  player.lastPosition = boundedPosition;
  player.triggerPlayerClientUpdate?.();
  await player.node.updatePlayer({
    guildId: player.guildId,
    playerOptions: { position: boundedPosition },
  });
  return player;
}

function isUnseekableTrackError(error) {
  return error instanceof RangeError
    && /not seekable|a stream/i.test(String(error.message || ''));
}

module.exports = {
  isTrackSeekable,
  getTrackCapabilityMetadata,
  isUnseekableTrackError,
  getMirrorSource,
  isMirrorTrack,
  seekTrack,
};
