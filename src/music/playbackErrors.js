const { EmbedBuilder } = require('discord.js');

const ERROR_COLOR = '#ef4444';
const FALLBACK_COLOR = '#22c55e';

function buildTrackField(track) {
  const title = track?.info?.title || track?.localUpload?.fileName || 'Unknown track';
  const author = track?.info?.author;
  const label = author ? `${author} - ${title}` : title;
  const uri = track?.info?.uri;
  return uri ? `[${label}](${uri})` : label;
}

function classifyPlaybackError(payload = {}) {
  const raw = [
    payload?.exception?.message,
    payload?.exception?.cause,
    payload?.exception?.error?.message,
    payload?.error?.message,
    payload?.error,
    payload?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/age.?restrict|confirm (?:your )?age|inappropriate content/.test(raw)) {
    return {
      code: 'age_restricted',
      title: 'Age-restricted track',
      description: 'The source requires an authenticated adult account, so this track cannot be played.',
    };
  }

  if (/private (?:video|track)|this video is private/.test(raw)) {
    return {
      code: 'private',
      title: 'Private track',
      description: 'This track is private and cannot be accessed by the bot.',
    };
  }

  if (/not available in your country|region.?block|geo.?restrict/.test(raw)) {
    return {
      code: 'region_blocked',
      title: 'Track unavailable in this region',
      description: 'The source does not allow playback from the server region.',
    };
  }

  if (/sign.?in|log.?in|authentication|captcha|confirm you.?re not a bot|bot check/.test(raw)) {
    return {
      code: 'authentication_required',
      title: 'Source requires verification',
      description: 'The source rejected automated playback or requires signing in.',
    };
  }

  if (/video unavailable|track unavailable|not available|removed|deleted|cannot be played/.test(raw)) {
    return {
      code: 'unavailable',
      title: 'Track unavailable',
      description: 'The source reports that this track was removed or is not currently playable.',
    };
  }

  if (/timed? ?out|timeout|stuck/.test(raw)) {
    return {
      code: 'timeout',
      title: 'Playback timed out',
      description: 'The source did not provide audio in time. The bot will continue with the next track.',
    };
  }

  if (/\b403\b|forbidden|access denied/.test(raw)) {
    return {
      code: 'forbidden',
      title: 'Playback access denied',
      description: 'The source refused access to this track.',
    };
  }

  return {
    code: 'source_error',
    title: 'Playback failed',
    description: 'The audio source could not play this track. The bot will continue with the next one.',
  };
}

function buildPlaybackErrorEmbed(track, payload) {
  const classification = classifyPlaybackError(payload);
  const trackLabel = buildTrackField(track);

  const embed = new EmbedBuilder()
    .setTitle(classification.title)
    .setDescription(`${classification.description} Looking for a replacement…`)
    .addFields({ name: 'Track', value: trackLabel })
    .setColor(ERROR_COLOR)
    .setTimestamp();

  return { embed, classification };
}

function buildReplacementEmbed(failedTrack, replacement) {
  const embed = new EmbedBuilder()
    .setTitle('Source skipped – playing a replacement')
    .setDescription('The original source was unavailable, so a matching track was found instead.')
    .addFields(
      { name: 'Failed track', value: buildTrackField(failedTrack) },
      { name: 'Replacement', value: buildTrackField(replacement) },
    )
    .setColor(FALLBACK_COLOR)
    .setTimestamp();

  return embed;
}

function describeSearchFailure(searchResult) {
  if (searchResult?.loadType === 'error' || searchResult?.exception) {
    return classifyPlaybackError(searchResult);
  }
  return {
    code: 'not_found',
    title: 'No results found',
    description: 'No playable tracks matched that query.',
  };
}

module.exports = {
  buildPlaybackErrorEmbed,
  buildReplacementEmbed,
  classifyPlaybackError,
  describeSearchFailure,
};
