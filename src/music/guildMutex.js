const queues = new Map();

async function acquireGuildMutex(guildId) {
  if (!guildId) {
    throw new TypeError('A guild id is required.');
  }

  const previous = queues.get(guildId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  queues.set(guildId, tail);

  await previous.catch(() => {});
  return () => {
    release();
    if (queues.get(guildId) === tail) queues.delete(guildId);
  };
}

async function withGuildMutex(guildId, operation) {
  const release = await acquireGuildMutex(guildId);
  try {
    return await operation();
  } finally {
    release();
  }
}

function clearGuildMutex(guildId) {
  queues.delete(guildId);
}

module.exports = {
  acquireGuildMutex,
  withGuildMutex,
  clearGuildMutex,
};
