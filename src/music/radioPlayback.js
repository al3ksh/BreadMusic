// @ts-check
const defaultRadio = require('./radio');
const { isStreamTrack } = require('./autoplay/normalize');
const { queueRequestedTracks } = require('./queueInsert');
const library = require('./library');

// The stream itself carries no useful metadata, so the station details become the track info.
function dressStationTrack(track, station, radio = defaultRadio) {
  const location = radio.describeStationLocation(station);
  track.info.title = station.name;
  track.info.author = location || station.tags.join(', ') || 'Live radio';
  track.info.isStream = true;
  if (station.favicon) track.info.artworkUrl = station.favicon;
  if (station.homepage) track.info.uri = station.homepage;
  // The stream URL stays on the server; the bot reads what the station is airing from it.
  track.radioStation = { id: station.id, source: station.source, url: station.url };
  return track;
}

// Loads the station stream and starts it. A station never ends, so picking another one while
// radio plays switches right away; otherwise it queues in front of autoplay picks.
// Returns { track: null, result } when Lavalink could not load the stream; search errors are thrown.
async function playStation(player, station, requester, { radio = defaultRadio } = {}) {
  const result = await player.search(station.url, requester);
  const track = result?.tracks?.[0];
  if (!track) return { track: null, result, replaced: false };
  dressStationTrack(track, station, radio);

  const replaced = Boolean(player.queue.current && isStreamTrack(player.queue.current) && (player.playing || player.paused));
  if (replaced) {
    await player.queue.add(track, 0);
    await player.skip();
    if (player.paused) await player.resume();
  } else {
    await queueRequestedTracks(player, track);
    if (!player.playing && !player.paused) await player.play();
  }
  radio.reportPlay(station);
  return { track, result, replaced };
}

// The player heart on a radio track toggles the station in the listener's saved stations,
// the same list as the ⭐ on /radio and the Activity radio tab.
// Returns { ok, saved, name } or { ok: false, reason: 'invalid' | 'limit' }.
async function toggleStationHeart(userId, track, { radio = defaultRadio } = {}) {
  const stationId = library.stationIdOf(track);
  if (!userId || !stationId) return { ok: false, reason: 'invalid' };
  const name = track.info?.title || 'Radio station';
  if (library.isStationSaved(userId, stationId)) {
    library.removeStation(userId, stationId);
    return { ok: true, saved: false, name };
  }
  // A fresh lookup brings back the tags and country; the playing track is enough if it fails.
  // The name stays the one the listener saw on the player.
  const fromTrack = {
    id: stationId,
    source: track.radioStation.source,
    name,
    homepage: track.info?.uri || '',
    favicon: track.info?.artworkUrl || '',
  };
  const station = await radio.resolveStation(stationId).catch(() => null);
  const result = library.saveStation(userId, station?.id === stationId ? { ...fromTrack, ...station, name } : fromTrack);
  if (!result.ok) return result;
  return { ok: true, saved: true, name };
}

// What the dashboard and Activity show for a station (the stream URL stays on the server).
function publicStation(station) {
  return {
    id: station.id,
    source: station.source,
    name: station.name,
    homepage: station.homepage || '',
    country: station.country || '',
    place: station.place || '',
    tags: Array.isArray(station.tags) ? station.tags : [],
    favicon: station.favicon || '',
    codec: station.codec || '',
    bitrate: Number(station.bitrate) || 0,
    ...(station.addedAt ? { addedAt: station.addedAt } : {}),
  };
}

module.exports = { dressStationTrack, playStation, publicStation, toggleStationHeart };
