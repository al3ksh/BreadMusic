const crypto = require('crypto');
const { SqliteStore } = require('../state/sqliteStore');
const { normalizeTrack, isLocalUploadTrack, isStreamTrack } = require('./autoplay/normalize');
const userTaste = require('./autoplay/userTaste');
const { normalizeSoundState } = require('./sound');

// Per-user library: a "Liked" list and named playlists. Stored as encoded Lavalink tracks
// so playing them back needs no search.
const LIBRARY_LIMITS = {
  liked: 500,
  playlists: 50,
  tracks: 500,
  name: 60,
  stations: 25,
  sounds: 15,
  soundName: 40,
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
    library = { liked: [], playlists: [], stations: [], sounds: [] };
    data[userId] = library;
  }
  if (library) {
    if (!Array.isArray(library.liked)) library.liked = [];
    if (!Array.isArray(library.playlists)) library.playlists = [];
    if (!Array.isArray(library.stations)) library.stations = [];
    if (!Array.isArray(library.sounds)) library.sounds = [];
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
  // Liking a track takes back the person's autoplay dislike of it.
  if (liked) userTaste.removeDislike(userId, entry.key);
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
    shareCode: playlist.shareCode ?? null,
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

// Imports never fail on a taken name; they get "Name (2)", "Name (3)", ...
function createPlaylistWithFreeName(userId, rawName, tracks = [], now = Date.now()) {
  const name = normalizeName(rawName) || 'Imported';
  let result = createPlaylist(userId, name, tracks, now);
  for (let suffix = 2; !result.ok && result.reason === 'exists' && suffix < 100; suffix += 1) {
    result = createPlaylist(userId, `${name.slice(0, LIBRARY_LIMITS.name - 6)} (${suffix})`, tracks, now);
  }
  return result;
}

// Share codes skip look-alike characters (0/O, 1/I/L) so they survive being read out loud.
const SHARE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SHARE_CODE_LENGTH = 8;

function newShareCode() {
  const bytes = crypto.randomBytes(SHARE_CODE_LENGTH);
  return Array.from(bytes, (byte) => SHARE_ALPHABET[byte % SHARE_ALPHABET.length]).join('');
}

// Accepts "ABCD2345" or "abcd-2345"; returns null otherwise.
function parseShareCode(value) {
  if (typeof value !== 'string') return null;
  const compact = value.toUpperCase().replace(/[\s-]/g, '');
  if (compact.length !== SHARE_CODE_LENGTH) return null;
  return [...compact].every((char) => SHARE_ALPHABET.includes(char)) ? compact : null;
}

function findShared(code) {
  const wanted = parseShareCode(code);
  if (!wanted) return null;
  for (const [ownerId, library] of Object.entries(getStore().data)) {
    const playlist = library?.playlists?.find?.((candidate) => candidate.shareCode === wanted);
    if (playlist) return { ownerId, playlist };
  }
  return null;
}

// Gives a playlist a share code (keeping an existing one) or, with enabled=false, revokes it.
function setPlaylistShared(userId, idOrName, enabled = true) {
  const playlist = findPlaylist(userId, idOrName);
  if (!playlist) return { ok: false, reason: 'missing' };
  if (!enabled) {
    delete playlist.shareCode;
  } else if (!playlist.shareCode) {
    let code = newShareCode();
    while (findShared(code)) code = newShareCode();
    playlist.shareCode = code;
  }
  getStore().save();
  return { ok: true, playlist: summarize(playlist), code: playlist.shareCode ?? null };
}

// Copies a shared playlist into the user's library. The copy does not follow later edits.
function importShared(userId, code, rawName, now = Date.now()) {
  const shared = findShared(code);
  if (!shared) return { ok: false, reason: 'unknown' };
  if (shared.ownerId === userId) return { ok: false, reason: 'own' };
  const tracks = shared.playlist.tracks.map((entry) => entryToTrack(entry, null));
  return createPlaylistWithFreeName(userId, rawName || shared.playlist.name, tracks, now);
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

// Saved radio stations keep what is needed to show them; playing one resolves the id again,
// so a station that moved its stream keeps working.
function stationEntry(station) {
  if (!station || typeof station.id !== 'string' || !station.id || station.id.length > 500) return null;
  const text = (value, length = 200) => (typeof value === 'string' ? value.slice(0, length) : '');
  return {
    id: station.id,
    source: text(station.source, 30),
    name: text(station.name, 120) || 'Radio station',
    homepage: text(station.homepage, 300),
    country: text(station.country, 80),
    place: text(station.place, 80),
    tags: Array.isArray(station.tags) ? station.tags.filter((tag) => typeof tag === 'string').slice(0, 4).map((tag) => tag.slice(0, 40)) : [],
    favicon: /^https:\/\//i.test(station.favicon || '') ? text(station.favicon, 300) : '',
    codec: text(station.codec, 20),
    bitrate: Number(station.bitrate) || 0,
  };
}

function listStations(userId) {
  return [...(getUserLibrary(userId)?.stations ?? [])].reverse();
}

function isStationSaved(userId, stationId) {
  return Boolean(getUserLibrary(userId)?.stations.some((entry) => entry.id === stationId));
}

// Returns { ok, saved } or { ok: false, reason: 'invalid' | 'limit' }.
function saveStation(userId, station, now = Date.now()) {
  const entry = stationEntry(station);
  if (!userId || !entry) return { ok: false, reason: 'invalid' };
  const library = getUserLibrary(userId, true);
  const without = library.stations.filter((existing) => existing.id !== entry.id);
  if (without.length >= LIBRARY_LIMITS.stations) return { ok: false, reason: 'limit' };
  library.stations = [...without, { ...entry, addedAt: now }];
  getStore().save();
  return { ok: true, saved: true };
}

function removeStation(userId, stationId) {
  const library = getUserLibrary(userId);
  if (!library) return false;
  const before = library.stations.length;
  library.stations = library.stations.filter((entry) => entry.id !== stationId);
  if (library.stations.length === before) return false;
  getStore().save();
  return true;
}

// Saved sound presets: a named copy of the full /sound state (preset, EQ, speed, pitch).
function listSounds(userId) {
  return [...(getUserLibrary(userId)?.sounds ?? [])].reverse();
}

function findSound(userId, idOrName) {
  const sounds = getUserLibrary(userId)?.sounds ?? [];
  const lowered = String(idOrName ?? '').trim().toLowerCase();
  return sounds.find((entry) => entry.id === idOrName) ?? sounds.find((entry) => entry.name.toLowerCase() === lowered) ?? null;
}

// Saving under an existing name overwrites that preset.
// Returns { ok, entry, replaced } or { ok: false, reason: 'name' | 'limit' }.
function saveSound(userId, rawName, sound, now = Date.now()) {
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim().slice(0, LIBRARY_LIMITS.soundName) : '';
  if (!userId || !name) return { ok: false, reason: 'name' };
  const library = getUserLibrary(userId, true);
  const existing = library.sounds.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!existing && library.sounds.length >= LIBRARY_LIMITS.sounds) return { ok: false, reason: 'limit' };
  const entry = { id: existing?.id ?? crypto.randomUUID().slice(0, 8), name, sound: normalizeSoundState(sound), createdAt: now };
  library.sounds = [...library.sounds.filter((item) => item !== existing), entry];
  getStore().save();
  return { ok: true, entry, replaced: Boolean(existing) };
}

function removeSound(userId, idOrName) {
  const library = getUserLibrary(userId);
  const entry = findSound(userId, idOrName);
  if (!library || !entry) return null;
  library.sounds = library.sounds.filter((item) => item !== entry);
  getStore().save();
  return entry;
}

function getLibrarySnapshot(userId) {
  return {
    liked: listLiked(userId),
    playlists: listPlaylists(userId),
    stations: listStations(userId),
    sounds: listSounds(userId),
    limits: LIBRARY_LIMITS,
  };
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
  createPlaylistWithFreeName,
  parseShareCode,
  setPlaylistShared,
  importShared,
  addToPlaylist,
  removeFromPlaylist,
  deletePlaylist,
  resolvePlayable,
  shuffled,
  listStations,
  isStationSaved,
  saveStation,
  removeStation,
  listSounds,
  findSound,
  saveSound,
  removeSound,
  getLibrarySnapshot,
  flush,
  __testing: { resetForTesting },
};
