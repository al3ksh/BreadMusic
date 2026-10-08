const defaultRadio = require('./radio');
const { isStreamTrack } = require('./autoplay/normalize');
const { queueRequestedTracks } = require('./queueInsert');

// The stream itself carries no useful metadata, so the station details become the track info.
function dressStationTrack(track, station, radio = defaultRadio) {
  const location = radio.describeStationLocation(station);
  track.info.title = station.name;
  track.info.author = location || station.tags.join(', ') || 'Live radio';
  track.info.isStream = true;
  if (station.favicon) track.info.artworkUrl = station.favicon;
  if (station.homepage) track.info.uri = station.homepage;
  track.radioStation = { id: station.id, source: station.source };
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

module.exports = { dressStationTrack, playStation, publicStation };
