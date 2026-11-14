export async function readBytes(response, limit) {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.ok ? 'Upstream response too large' : `Upstream HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Missing upstream body');

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw new Error('Upstream response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
