const DEFAULT_CONTACT = 'aleksh8';

function createGuildAccessPolicy(env = process.env) {
  const mode = String(env.GUILD_ACCESS_MODE || 'public').trim().toLowerCase();
  const allowedGuildIds = new Set(
    String(env.ALLOWED_GUILD_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value)),
  );

  return {
    mode: mode === 'allowlist' ? 'allowlist' : 'public',
    allowedGuildIds,
    contact: String(env.PRIVATE_ACCESS_CONTACT || DEFAULT_CONTACT).trim() || DEFAULT_CONTACT,
  };
}

function isGuildAllowed(policy, guildId) {
  if (!policy || policy.mode !== 'allowlist') return true;
  if (!guildId) return false;
  return policy.allowedGuildIds.has(String(guildId));
}

function buildAccessDeniedMessage(policy) {
  const contact = policy?.contact || DEFAULT_CONTACT;
  return `Bread is currently private on this server. To request access, send a DM to **${contact}**.`;
}

module.exports = {
  buildAccessDeniedMessage,
  createGuildAccessPolicy,
  isGuildAllowed,
};
