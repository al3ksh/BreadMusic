const fs = require('node:fs/promises');
const path = require('node:path');

const ICON_DIR = path.join(__dirname, '..', '..', 'assets', 'discord-player-icons');
const ICON_NAMES = [
  'previous', 'play', 'pause', 'skip', 'stop', 'loop', 'shuffle',
  'lyrics', 'dashboard', 'like', 'dislike', 'reroll',
];
// Application emoji names are shared by everything the app owns, so the player ones get a prefix.
const EMOJI_PREFIX = 'bread_';

const emojiIds = new Map(parseEmojiIds(process.env.PLAYER_EMOJI_IDS));

function parseEmojiIds(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().split(':'))
    .filter(([name, id]) => name && /^\d{17,20}$/.test(id))
    .map(([name, id]) => [name, { name, id }]);
}

function playerEmoji(name, fallback) {
  return emojiIds.get(name) ?? fallback;
}

// Uploads any missing player icon as an application emoji, so the buttons use them without
// hand-copied ids. Ids from PLAYER_EMOJI_IDS still win.
async function syncPlayerEmojis(application, { iconDir = ICON_DIR, log = console } = {}) {
  if (!application?.emojis) return 0;
  const missing = ICON_NAMES.filter((name) => !emojiIds.has(name));
  if (!missing.length) return 0;

  let existing;
  try {
    existing = await application.emojis.fetch();
  } catch (error) {
    log.warn?.('Could not fetch application emojis:', error.message);
    return 0;
  }

  let added = 0;
  for (const name of missing) {
    const emojiName = `${EMOJI_PREFIX}${name}`;
    let emoji = existing.find((entry) => entry.name === emojiName);
    if (!emoji) {
      try {
        const attachment = await fs.readFile(path.join(iconDir, `${name}.png`));
        emoji = await application.emojis.create({ attachment, name: emojiName });
        added += 1;
      } catch (error) {
        log.warn?.(`Could not upload player icon ${name}:`, error.message);
        continue;
      }
    }
    emojiIds.set(name, { name: emoji.name, id: emoji.id });
  }
  return added;
}

module.exports = {
  ICON_NAMES,
  playerEmoji,
  syncPlayerEmojis,
  __testing: { emojiIds, parseEmojiIds },
};
