function formatDuration(ms, options = {}) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const showHours = options.forceHours || hours > 0;
  const mm = showHours ? minutes.toString().padStart(2, '0') : minutes.toString();
  const ss = seconds.toString().padStart(2, '0');
  return showHours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function buildProgressBar(position, duration, size = 16) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '🔘' + '▬'.repeat(size);
  }

  const ratio = Math.max(0, Math.min(1, position / duration));
  const progressIndex = Math.round(ratio * size);
  
  const lineChar = '▬';
  const knobChar = '🔘';

  const before = lineChar.repeat(progressIndex);
  const after = lineChar.repeat(Math.max(0, size - progressIndex));
  
  return `${before}${knobChar}${after}`;
}

function parseTimecode(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid time format.');
  }

  const normalized = input.trim();
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(normalized)) {
    throw new Error('Use mm:ss or hh:mm:ss format.');
  }

  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((value) => Number.isNaN(value))) {
    throw new Error('Could not parse time.');
  }

  let seconds = 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    seconds = h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const [m, s] = parts;
    seconds = m * 60 + s;
  } else {
    seconds = parts[0];
  }

  return seconds * 1000;
}

module.exports = {
  formatDuration,
  buildProgressBar,
  parseTimecode,
};
