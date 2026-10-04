const crypto = require('crypto');
const { SqliteStore } = require('../state/sqliteStore');
const { normalizeTrack, isLocalUploadTrack, isStreamTrack } = require('./autoplay/normalize');

// Per-user library: a "Liked" list and named playlists. Stored as encoded Lavalink tracks
// so playing them back needs no search.
const LIBRARY_LIMITS = {
  liked: 500,
  playlists: 50,
  tracks: 500,
  name: 60,
};

const LIKED_ID = 'liked';

let store = null;

// Created lazily so the database path is resolved after tests (or the bot) configure the env.
function getStore() {
  if (!store) store = new SqliteStore('userLibrary.json', {});
  return store;
}

function getUserLibrary(userId, create = false) {
  if (!userId) return null;
  const data = getStore().data;
  let library = data[userId];
  if (!library && create) {
    library = { liked: [], playlists: [] };
    data[userId] = library;
  }
  if (library) {
    if (!Array.isArray(library.liked)) library.liked = [];
    if (!Array.isArray(library.playlists)) library.playlists = [];
  }
  return library ?? null;
}

function artworkFor(info) {
  if (typeof info.artworkUrl === 'string' && info.artworkUrl) return info.artworkUrl;
  const uri = typeof info.uri === 'string' ? info.uri : '';
  if ((uri.includes('youtube.com') || uri.includes('youtu.be')) && info.identifier) {
    return `https://i.ytimg.com/vi/${info.identifier}/mqdefault.jpg`;
  }
  return null;
}

// Uploads expire and streams have no fixed identity, so neither can be saved.
function libraryEntry(track) {
  if (!track?.info || typeof track.encoded !== 'string' || !track.encoded) return null;
  if (isLocalUploadTrack(track) || isStreamTrack(track)) return null;
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  const info = track.info;
  return {
    key: normalized.key,
    encoded: track.encoded,
    title: normalized.title,
    author: typeof info.author === 'string' ? info.author : '',
    uri: typeof info.uri === 'string' ? info.uri : '',
    identifier: typeof info.identifier === 'string' ? info.identifier : '',
    duration: normalized.duration,
    artwork: artworkFor(info),
    source: typeof info.sourceName === 'string' ? info.sourceName : '',
    seekable: info.isSeekable !== false,
  };
}

function canSaveTrack(track) {
  return libraryEntry(track) !== null;
}

function entryToTrack(entry, requester) {
  return {
    encoded: entry.encoded,
    info: {
      identifier: entry.identifier || '',
      title: entry.title,
      author: entry.author,
      uri: entry.uri || null,
      duration: entry.duration,
      artworkUrl: entry.artwork,
      sourceName: entry.source,
      isSeekable: entry.seekable !== false,
      isStream: false,
    },
    requester,
  };
}

function isLiked(userId, track) {
  const entry = libraryEntry(track);
  if (!entry) return false;
  return Boolean(getUserLibrary(userId)?.liked.some((liked) => liked.key === entry.key));
}

// Sets the liked state explicitly. Returns null when the track cannot be saved.
function setLiked(userId, track, liked, now = Date.now()) {
  const entry = libraryEntry(track);
  if (!userId || !entry) return null;
  const library = getUserLibrary(userId, true);
  const without = library.liked.filter((existing) => existing.key !== entry.key);
  library.liked = liked ? [...without, { ...entry, addedAt: now }].slice(-LIBRARY_LIMITS.liked) : without;
  getStore().save();
  return { liked };
}

function toggleLiked(userId, track, now = Date.now()) {
  if (!canSaveTrack(track)) return null;
  return setLiked(userId, track, !isLiked(userId, track), now);
}

function removeLiked(userId, key) {
  const library = getUserLibrary(userId);
  if (!library) return false;
  const before = library.liked.length;
  library.liked = library.liked.filter((entry) => entry.key !== key);
  if (library.liked.length === before) return false;
  getStore().save();
  return true;
}

// Newest like first.
function listLiked(userId) {
  return [...(getUserLibrary(userId)?.liked ?? [])].reverse();
}

function summarize(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.tracks.length,
    duration: playlist.tracks.reduce((total, entry) => total + (Number(entry.duration) || 0), 0),
    artwork: playlist.tracks.find((entry) => entry.artwork)?.artwork ?? null,
    updatedAt: playlist.updatedAt,
  };
}

function listPlaylists(userId) {
  return (getUserLibrary(userId)?.playlists ?? [])
    .map(summarize)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizeName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, LIBRARY_LIMITS.name) : '';
}

// Looks a playlist up by id or (case-insensitively) by name.
function findPlaylist(userId, idOrName) {
  const library = getUserLibrary(userId);
  if (!library || !idOrName) return null;
  const wanted = String(idOrName);
  const byId = library.playlists.find((playlist) => playlist.id === wanted);
  if (byId) return byId;
  const name = normalizeName(wanted).toLowerCase();
  return library.playlists.find((playlist) => playlist.name.toLowerCase() === name) ?? null;
}

function getPlaylist(userId, idOrName) {
  const playlist = findPlaylist(userId, idOrName);
  return playlist ? { ...summarize(playlist), tracks: [...playlist.tracks] } : null;
}

function toEntries(tracks) {
  const seen = new Set();
  const entries = [];
  let skipped = 0;
  for (const track of tracks ?? []) {
    const entry = libraryEntry(track);
    if (!entry || seen.has(entry.key)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.key);
    entries.push(entry);
  }
  return { entries, skipped };
}

// Returns { ok: true, playlist, added, skipped } or { ok: false, reason }.
function createPlaylist(userId, rawName, tracks = [], now = Date.now()) {
  const name = normalizeName(rawName);
  if (!userId || !name) return { ok: false, reason: 'name' };
  if (findPlaylist(userId, name)) return { ok: false, reason: 'exists' };
  const library = getUserLibrary(userId, true);
  if (library.playlists.length >= LIBRARY_LIMITS.playlists) return { ok: false, reason: 'limit' };

  const { entries, skipped } = toEntries(tracks);
  const kept = entries.slice(0, LIBRARY_LIMITS.tracks);
  const playlist = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    tracks: kept.map((entry) => ({ ...entry, addedAt: now })),
    createdAt: now,
    updatedAt: now,
  };
  library.playlists.push(playlist);
  getStore().save();
  return { ok: true, playlist: summarize(playlist), added: kept.length, skipped: skipped + entries.length - kept.length };
}

function addToPlaylist(userId, idOrName, tracks, now = Date.now()) {
  const playlist = findPlaylist(userId, idOrName);
  if (!playlist) return { ok: false, reason: 'missing' };
  const existing = new Set(playlist.tracks.map((entry) => entry.key));
  const { entries, skipped } = toEntries(tracks);
  const fresh = entries.filter((entry) => !existing.has(entry.key));
  const room = Math.max(0, LIBRARY_LIMITS.tracks - playlist.tracks.length);
  const kept = fresh.slice(0, room);
  if (kept.length === 0 && fresh.length > 0) return { ok: false, reason: 'full' };
  playlist.tracks.push(...kept.map((entry) => ({ ...entry, addedAt: now })));
  if (kept.length > 0) playlist.updatedAt = now;
  getStore().save();
  return { ok: true, playlist: summarize(playlist), added: kept.length, skipped: skipped + entries.length - kept.length };
}

function removeFromPlaylist(userId, idOrName, index, now = Date.now()) {
  const playlist = findPlaylist(userId, idOrName);
  if (!playlist || !Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) return false;
  playlist.tracks.splice(index, 1);
  playlist.updatedAt = now;
  getStore().save();
  return true;
}

function deletePlaylist(userId, idOrName) {
  const library = getUserLibrary(userId);
  const playlist = findPlaylist(userId, idOrName);
  if (!library || !playlist) return false;
  library.playlists = library.playlists.filter((existing) => existing.id !== playlist.id);
  getStore().save();
  return true;
}

// The entries to play for the Liked list (LIKED_ID) or a playlist, or null if it is missing.
function resolvePlayable(userId, idOrName) {
  if (idOrName === LIKED_ID) return { name: 'Liked', tracks: listLiked(userId) };
  const playlist = findPlaylist(userId, idOrName);
  return playlist ? { name: playlist.name, tracks: [...playlist.tracks] } : null;
}

function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function getLibrarySnapshot(userId) {
  return { liked: listLiked(userId), playlists: listPlaylists(userId), limits: LIBRARY_LIMITS };
}

function flush() {
  if (store) store.saveImmediate();
}

// Tests reopen the database between cases to simulate a restart.
function resetForTesting() {
  if (store?.saveTimeout) clearTimeout(store.saveTimeout);
  store = null;
}

module.exports = {
  LIBRARY_LIMITS,
  LIKED_ID,
  libraryEntry,
  canSaveTrack,
  entryToTrack,
  isLiked,
  setLiked,
  toggleLiked,
  removeLiked,
  listLiked,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  deletePlaylist,
  resolvePlayable,
  shuffled,
  getLibrarySnapshot,
  flush,
  __testing: { resetForTesting },
};
