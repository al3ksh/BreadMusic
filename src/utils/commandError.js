class CommandError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CommandError';
    this.ephemeral = options.ephemeral ?? true;
  }
}

module.exports = { CommandError };
