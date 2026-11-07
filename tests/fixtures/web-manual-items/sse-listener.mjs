// SSE client for GET /api/events used by the acceptance suites. Parses the frozen event
// stream shape: `event:`/`id:`/`data:` lines separated by blank lines, with `:` comment
// heartbeats. Item change hints (event: item.changed) carry data
// {contractVersion, objectType:"item", itemId, itemVersion, at} and no `id:` line; the
// subscription handshake frame is stream.ready (also without an `id:` line).
export async function openEventStream(origin, options = {}) {
  const { cookie, lastEventId, timeoutMs = 20000 } = options;
  const controller = new AbortController();
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const response = await fetch(`${origin}/api/events`, { headers, signal: controller.signal });
  const contentType = response.headers.get('content-type') ?? '';
  const stream = {
    status: response.status,
    contentType,
    frames: [],
    readError: null,
    async waitFor(predicate, ms = timeoutMs) {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = stream.frames.find(predicate);
        if (found) return found;
        if (stream.readError) throw stream.readError;
        if (Date.now() >= deadline) {
          throw new Error(`SSE frame not observed within ${ms}ms; frames so far: ${JSON.stringify(stream.frames)}`);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    close() { controller.abort(); },
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = parseFrame(block);
          if (frame) stream.frames.push(frame);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') stream.readError = error;
    }
  })();
  return stream;
}

function parseFrame(block) {
  const lines = block.split('\n');
  if (lines.every((line) => line === '' || line.startsWith(':'))) return null;
  const frame = { event: null, id: null, data: null, raw: block };
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') frame.event = value;
    else if (field === 'id') frame.id = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length) {
    frame.dataText = dataLines.join('\n');
    try { frame.data = JSON.parse(frame.dataText); } catch { /* non-JSON data kept as text */ }
  }
  return frame;
}
