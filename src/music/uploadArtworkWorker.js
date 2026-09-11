const sharp = require('sharp');

sharp.cache(false);
sharp.concurrency(1);

async function extract(filePath) {
  const { parseFromTokenizer } = await import('music-metadata');
  const { fromFile } = await import('strtok3');
  const tokenizer = await fromFile(filePath);
  let bytesRead = 0;
  // Check token sizes before the parser allocates buffers; seeking past audio
  // remains cheap, so MP4 artwork at the end of a large file still works.
  for (const method of ['readToken', 'peekToken']) {
    const original = tokenizer[method].bind(tokenizer);
    tokenizer[method] = (token, ...args) => {
      if (!Number.isSafeInteger(token.len) || token.len < 0 || token.len > 8 * 1024 * 1024) {
        throw new Error('Metadata token limit');
      }
      return original(token, ...args);
    };
  }
  for (const method of ['readBuffer', 'peekBuffer']) {
    const original = tokenizer[method].bind(tokenizer);
    tokenizer[method] = (buffer, options) => {
      const length = options?.length ?? buffer.length;
      bytesRead += length;
      if (length > 8 * 1024 * 1024 || bytesRead > 24 * 1024 * 1024) throw new Error('Metadata read limit');
      return original(buffer, options);
    };
  }
  let metadata;
  try {
    metadata = await parseFromTokenizer(tokenizer, { duration: false, skipPostHeaders: true });
  } finally { await tokenizer.close(); }
  const pictures = [...(metadata.common.picture || [])];
  pictures.sort((a, b) => Number(/front/i.test(b.type || '')) - Number(/front/i.test(a.type || '')));
  for (const picture of pictures.slice(0, 8)) {
    if (!picture.data?.length || picture.data.length > 5 * 1024 * 1024) continue;
    // Allow only raster signatures, never feed SVG or another document to sharp.
    const data = Buffer.from(picture.data);
    const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp) continue;
    if (png) {
      let animated = false;
      for (let offset = 8; offset + 12 <= data.length;) {
        if (data.toString('ascii', offset + 4, offset + 8) === 'acTL') { animated = true; break; }
        offset += 12 + data.readUInt32BE(offset);
      }
      if (animated) continue;
    }
    try {
      const image = sharp(data, { limitInputPixels: 16 * 1024 * 1024, failOn: 'warning' });
      const info = await image.metadata();
      if ((info.pages || 1) > 1) continue;
      const output = await image.rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#171717' }).jpeg({ quality: 80 }).toBuffer();
      if (output.length <= 256 * 1024) return output;
    } catch { /* A broken picture must not hide another valid embedded cover. */ }
  }
  return Buffer.alloc(0);
}

extract(process.argv[2]).then((buffer) => {
  process.stdout.write(buffer);
}).catch(() => { /* Cache a failed parse as no artwork; never fail playback. */ });
