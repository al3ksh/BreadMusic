const intentionallyStoppedPlayers = new WeakSet();

function markPlayerStopping(player) {
  if (player && typeof player === 'object') intentionallyStoppedPlayers.add(player);
}

function isPlayerStopping(player) {
  return Boolean(player && intentionallyStoppedPlayers.has(player));
}

module.exports = {
  isPlayerStopping,
  markPlayerStopping,
};
