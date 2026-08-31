async function readProviderJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Provider response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
module.exports = { readProviderJson };
