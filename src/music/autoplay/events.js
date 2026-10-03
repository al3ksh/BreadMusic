const { EventEmitter } = require('node:events');

// 'next-changed' (guildId): the prepared autoplay track changed or was cleared.
// 'exhausted' (guildId, { reason }): autoplay could not find anything to play.
const autoplayEvents = new EventEmitter();
autoplayEvents.setMaxListeners(20);

module.exports = { autoplayEvents };
