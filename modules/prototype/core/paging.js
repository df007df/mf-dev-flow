const json = JSON.stringify;
export function boundedPage(items, { maxBytes = 16384, cursor = 0, nextCursor = null, revision = 0, metadata = {} } = {}) {
  maxBytes = Number(maxBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536) throw new Error('max-bytes must be 1024..65536');
  const out = { schemaVersion: 1, revision, ...metadata, items: [], nextCursor, bytes: 0 };
  for (const item of items) {
    let selected = item;
    if (Buffer.byteLength(json({ ...out, items: [item] })) + 64 > maxBytes) selected = { type: item.type, id: item.id, revision: item.revision, status: item.status, oversized: true, detail: 'Use field + text-offset/text-limit; full record remains in the source archive.' };
    const next = { ...out, items: [...out.items, selected] };
    if (Buffer.byteLength(json(next)) + 64 > maxBytes) { out.nextCursor = cursor + out.items.length; break; }
    out.items.push(selected);
  }
  // bytes includes the final newline; converge when the digit width changes.
  for (let i = 0; i < 4; i++) out.bytes = Buffer.byteLength(json(out)) + 1;
  return out;
}
