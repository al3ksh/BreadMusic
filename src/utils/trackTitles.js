const BRACKET_NOISE_PATTERN = /[\[(][^\])]*(official|video|audio|lyric|visualizer|m\/v|\bmv\b|\bhd\b|\bhq\b|4k|color\s*coded|performance|stage\s*(mix|video)|comeback)[^\])]*[\])]/gi;
const DASHED_VIDEO_PATTERN = /\s*[-–—|]\s*(official\s+)?(music\s+)?(video|audio|lyric(s)?(\s+video)?|visualizer|performance\s+video)\s*$/i;
const PROD_BRACKET_PATTERN = /\s*[\[(]\s*prod(?:uced)?\.?(?:\s*by\b)?[^\])]*[\])]/gi;
const PROD_DASH_PATTERN = /\s+[-–—]\s+prod(?:uced)?\.?(?:\s*by\b)?.*$/i;
const FEAT_PATTERN = /\s*[\[(]?\s*\b(?:ft|feat|featuring)\b\.?\s+[^\])]+[\])]?/gi;
const CHANNEL_SUFFIXES = [
  /\s+-\s+topic$/i,
  /\s*vevo$/i,
  /\s+official(\s+artist(\s+channel)?)?$/i,
  /\s+offizielles?\s+kanal$/i,
];

function cleanTrackTitle(value) {
  return String(value || '')
    .replace(PROD_DASH_PATTERN, ' ')
    .replace(BRACKET_NOISE_PATTERN, ' ')
    .replace(PROD_BRACKET_PATTERN, ' ')
    .replace(DASHED_VIDEO_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripFeaturedArtists(value) {
  return String(value || '')
    .replace(FEAT_PATTERN, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanArtist(value) {
  let artist = String(value || '');
  for (const pattern of CHANNEL_SUFFIXES) artist = artist.replace(pattern, '');
  return stripFeaturedArtists(artist.replace(/\s{2,}/g, ' ').trim());
}

function primaryArtistName(value) {
  const cleaned = cleanArtist(value);
  if (!cleaned) return '';
  const primary = cleaned.split(/\s*,\s*|\s*&\s*/)[0].trim();
  return primary || cleaned;
}

function stripBracketedContent(value) {
  return String(value || '')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = {
  cleanTrackTitle,
  stripFeaturedArtists,
  cleanArtist,
  primaryArtistName,
  stripBracketedContent,
};
