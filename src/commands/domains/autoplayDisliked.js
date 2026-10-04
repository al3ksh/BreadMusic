const userTaste = require('../../music/autoplay/userTaste');

const COMPONENT_PREFIX = 'autoplay:dislikes:';
const MAX_OPTIONS = 25;
const MAX_VALUE_LENGTH = 100;
const LIST_LIMIT = 15;

function clip(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

// Select values carry a kind prefix, so keys too long for Discord's 100 characters are left out.
function buildOptions({ artists, tracks }) {
  const options = [];
  for (const artist of artists) {
    const value = `a:${artist.artistKey}`;
    if (value.length > MAX_VALUE_LENGTH) continue;
    options.push({ label: clip(`Unblock ${artist.author}`, 100), value, description: 'Also forgets its disliked tracks.', emoji: '🚫' });
  }
  for (const track of tracks) {
    const value = `t:${track.key}`;
    if (value.length > MAX_VALUE_LENGTH) continue;
    options.push({ label: clip(`Undo: ${track.title}`, 100), value, description: clip(track.author || 'Unknown artist', 100), emoji: '👎' });
  }
  return options.slice(0, MAX_OPTIONS);
}

function buildDislikedPanel(context, userId, { notice } = {}) {
  const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, BRAND_COLORS } = context;
  const dislikes = userTaste.getDislikes(userId);
  const lines = [];
  if (dislikes.artists.length) {
    lines.push('**Blocked artists**');
    for (const artist of dislikes.artists.slice(0, LIST_LIMIT)) {
      lines.push(`🚫 ${clip(artist.author, 80)}${artist.tracks ? ` · ${artist.tracks} disliked` : ''}`);
    }
  }
  if (dislikes.tracks.length) {
    if (lines.length) lines.push('');
    lines.push('**Disliked tracks**');
    for (const track of dislikes.tracks.slice(0, LIST_LIMIT)) {
      lines.push(`👎 ${clip(track.title, 70)} — ${clip(track.author || 'Unknown artist', 40)} · <t:${Math.floor(track.at / 1000)}:R>`);
    }
    if (dislikes.tracks.length > LIST_LIMIT) lines.push(`…and ${dislikes.tracks.length - LIST_LIMIT} more`);
  }
  if (!lines.length) lines.push('Nothing here. Use `/autoplay dislike` on a track autoplay should avoid.');

  const embed = new EmbedBuilder()
    .setTitle('👎 Disliked')
    .setDescription(`${notice ? `${notice}\n\n` : ''}${lines.join('\n')}`)
    .setColor(BRAND_COLORS.secondary)
    .setFooter({ text: 'Autoplay avoids these for you. Two dislikes of one artist block the artist.' });

  const options = buildOptions(dislikes);
  const components = options.length
    ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`${COMPONENT_PREFIX}${userId}`)
      .setPlaceholder('Unblock an artist or undo a dislike')
      .addOptions(options))]
    : [];
  return { embeds: [embed], components };
}

async function handleDislikedComponent(context, interaction) {
  const ownerId = interaction.customId.slice(COMPONENT_PREFIX.length);
  if (ownerId !== interaction.user.id) throw new context.CommandError('This list belongs to someone else. Open your own with `/autoplay disliked`.');
  const [value] = interaction.values ?? [];
  const dislikes = userTaste.getDislikes(ownerId);
  let notice = 'That entry was already gone.';
  if (value?.startsWith('a:')) {
    const artist = dislikes.artists.find((entry) => entry.artistKey === value.slice(2));
    if (userTaste.unblockArtist(ownerId, value.slice(2))) notice = `Unblocked **${artist?.author ?? 'the artist'}**.`;
  } else if (value?.startsWith('t:')) {
    const track = dislikes.tracks.find((entry) => entry.key === value.slice(2));
    if (userTaste.removeDislike(ownerId, value.slice(2))) notice = `Undid your dislike of **${track?.title ?? 'the track'}**.`;
  }
  await interaction.update(buildDislikedPanel(context, ownerId, { notice }));
}

module.exports = { COMPONENT_PREFIX, buildDislikedPanel, handleDislikedComponent, buildOptions };
