const { FileStore } = require('../state/fileStore');

const economyStore = new FileStore('economy.json', {});

const HOURLY_MIN = 100;
const HOURLY_MAX = 200;
const HOURLY_COOLDOWN = 60 * 60 * 1000;
const GAMBLING_COOLDOWN = 3000; 

const gamblingCooldowns = new Map();

function getUserData(userId) {
  return economyStore.get(userId, { balance: 0, lastHourly: 0 });
}

function saveUserData(userId, data) {
  economyStore.set(userId, data);
}

function getBalance(userId) {
  return getUserData(userId).balance;
}

function addBalance(userId, amount) {
  const data = getUserData(userId);
  data.balance = Math.max(0, data.balance + amount);
  saveUserData(userId, data);
  return data.balance;
}

function removeBalance(userId, amount) {
  return addBalance(userId, -amount);
}

function hasBalance(userId, amount) {
  return getBalance(userId) >= amount;
}

function checkGamblingCooldown(userId) {
  const lastGamble = gamblingCooldowns.get(userId) || 0;
  const now = Date.now();
  const remaining = GAMBLING_COOLDOWN - (now - lastGamble);
  
  if (remaining > 0) {
    return { onCooldown: true, remaining };
  }
  
  gamblingCooldowns.set(userId, now);
  return { onCooldown: false };
}

function claimHourly(userId) {
  const data = getUserData(userId);
  const now = Date.now();
  const timeSinceLastClaim = now - (data.lastHourly || 0);

  if (timeSinceLastClaim < HOURLY_COOLDOWN) {
    const remaining = HOURLY_COOLDOWN - timeSinceLastClaim;
    return { success: false, remaining };
  }

  const reward = Math.floor(Math.random() * (HOURLY_MAX - HOURLY_MIN + 1)) + HOURLY_MIN;
  data.balance += reward;
  data.lastHourly = now;
  saveUserData(userId, data);

  return { success: true, reward, newBalance: data.balance };
}

function getLeaderboard(limit = 10) {
  const entries = economyStore.entries();
  return entries
    .map(([userId, data]) => ({ userId, balance: data.balance || 0 }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

module.exports = {
  getBalance,
  addBalance,
  removeBalance,
  hasBalance,
  claimHourly,
  getLeaderboard,
  getUserData,
  checkGamblingCooldown,
  HOURLY_COOLDOWN,
  GAMBLING_COOLDOWN,
};
