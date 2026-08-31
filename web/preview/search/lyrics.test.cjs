const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLyricsService } = require('./lyrics.cjs');
test('lyrics reuse bot normalization/parser, cache and never accept fetch URLs', async () => {
  let calls = 0;
  const lyrics = createLyricsService({ request: async url => {
    calls++;
    assert.equal(new URL(url).origin, 'https://lrclib.net');
    assert.equal(new URL(url).searchParams.get('artist_name'), 'Example Artist');
    return Response.json({ plainLyrics: 'Original test line.', syncedLyrics: '[00:01.50]Original test line.', instrumental:false });
  } });
  const query = { artist:'Example Artist - Topic',title:'Example Song (Official Video)',duration:180000 };
  const result = await lyrics(query);
  assert.equal(result.lines[0].time,1500);
  assert.equal(result.lines[0].text,'Original test line.');
  assert.deepEqual(await lyrics(query),result); assert.equal(calls,1);
  await assert.rejects(lyrics({artist:'x',title:'x',duration:Infinity}),error=>error.status===400);
  await assert.rejects(lyrics({artist:'x',title:'x'.repeat(201)}),error=>error.status===400);
});
test('lyrics unavailable and provider failures remain explicit', async () => {
  const missing = createLyricsService({request:async()=>new Response(null,{status:404})});
  assert.equal(await missing({artist:'Artist',title:'Song',duration:100000}),null);
  const broken = createLyricsService({request:async()=>new Response(null,{status:503})});
  await assert.rejects(broken({artist:'Artist',title:'Song',duration:100000}),error=>error.status===503);
});
