function isTrackSeekable(track) {
  const info = track?.info || {};
  return Boolean(info.isSeekable && !info.isStream);
}

function isUnseekableTrackError(error) {
  return error instanceof RangeError
    && /not seekable|a stream/i.test(String(error.message || ''));
}

module.exports = {
  isTrackSeekable,
  isUnseekableTrackError,
};
