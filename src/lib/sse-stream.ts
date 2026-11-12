//! Minimal same-origin SSE transport for the task sync subscription.
//!
//! The frozen `web-api/1` §6 compensation requires the client to RESUBSCRIBE
//! with the snapshot's `lastEventId` (`<epoch>:<cursor>`) as a request header.
//! Native `EventSource` reconnects on its own and cannot carry a custom
//! `Last-Event-ID` header, so the subscription is a same-origin `fetch` read
//! stream instead: the reconnect token travels in the header (never in the
//! URL — no public query protocol is added), the session cookie rides the
//! same-origin credentials, and the reconnect/reconnect-pacing policy stays
//! with the caller (the pairing store), not with the transport.
//!
//! Two pieces live here:
//! 1. `createSseParser` — an incremental `text/event-stream` line/field parser
//!    (WHATWG view-source semantics: LF/CRLF/CR line breaks, `:` comment
//!    lines, `event`/`id`/`data`/`retry` fields, dispatch on the blank line).
//!    It is dependency-free and unit-tested in isolation.
//! 2. `openSseStream` — one SSE connection: `fetch` + reader + parser. It
//!    never reconnects on its own; it reports a natural stream end through
//!    `onEnd` (an explicit `close()` stays silent), so the owner decides
//!    between plain reconnect and snapshot resync.

export interface SseFrame {
  event: string;
  /// The last `id:` line seen before this frame dispatched, or null when the
  /// frame carries no id (hint frames and the `stream.ready`/`stream.reset`
  /// handshake frames have none — exactly what the token discipline needs:
  /// only applied frames advance the reconnect token).
  id: string | null;
  /// `data:` lines joined with `\n` (the wire payload is one JSON document).
  data: string;
}

export type SseFrameSink = (frame: SseFrame) => void;

export interface SseStreamOptions {
  /// Reconnect token sent as the `Last-Event-ID` request header on THIS
  /// connection (frozen §6). Omitted on a first subscribe.
  lastEventId?: string | null;
  onFrame(frame: SseFrame): void;
  /// Natural termination only: the server closed the stream or the body read
  /// failed. Not called after an explicit `close()`.
  onEnd?(): void;
}

export interface SseStreamHandle {
  close(): void;
}

/// A fetch/connection failure before the stream could open. `status` is the
/// HTTP status when the server answered non-2xx (e.g. an expired session
/// answers 401), and undefined for transport-level failures.
export class SseStreamError extends Error {
  status?: number;

  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = 'SseStreamError';
    this.status = status;
  }
}

export function createSseParser(onFrame: SseFrameSink): { push(chunk: string): void; end(): void } {
  let buffer = '';
  let bomStripped = false;
  let eventName = 'message';
  let dataLines: string[] = [];
  // The event id persists across dispatches (WHATWG): it changes only when a
  // new `id:` line is seen.
  let currentId: string | null = null;

  function dispatch() {
    if (dataLines.length > 0) {
      onFrame({ event: eventName || 'message', id: currentId, data: dataLines.join('\n') });
    }
    eventName = 'message';
    dataLines = [];
  }

  function processLine(line: string) {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'id') {
      // A NUL inside an id makes the whole line invalid (WHATWG), so such an
      // id never touches the reconnect token. The retry field carries no
      // information this transport acts on and is dropped silently.
      if (!value.includes('\u0000')) currentId = value;
    }
  }

  /// Consume every complete line in the buffer; `breaks` returns the length
  /// of the line terminator starting at the match (LF, CRLF or bare CR).
  function drain() {
    for (;;) {
      const index = buffer.search(/\r\n|\n|\r/);
      if (index === -1) break;
      const line = buffer.slice(0, index);
      const match = /^(\r\n|\n|\r)/.exec(buffer.slice(index));
      const breakLength = match ? match[0].length : 1;
      buffer = buffer.slice(index + breakLength);
      processLine(line);
    }
  }

  return {
    push(chunk: string) {
      if (!bomStripped) {
        // A leading UTF-8 BOM is stripped once, before any field parsing.
        buffer = (buffer + chunk).replace(/^\uFEFF/, '');
        bomStripped = true;
      } else {
        buffer += chunk;
      }
      drain();
    },
    end() {
      // The spec processes a final unterminated line, then dispatches any
      // pending frame, so a truncated tail cannot silently drop data.
      if (buffer !== '') {
        const line = buffer;
        buffer = '';
        processLine(line);
      }
      dispatch();
    },
  };
}

/// Open one SSE connection over a same-origin fetch stream and pump parsed
/// frames into `options.onFrame`. Resolves with a handle once the response
/// head is OK; rejects (with `SseStreamError`) before any frame is delivered
/// when the server answers non-2xx or the connection cannot be established.
export async function openSseStream(path: string, options: SseStreamOptions): Promise<SseStreamHandle> {
  const controller = new AbortController();
  let closedByCaller = false;
  const headers: Record<string, string> = { Accept: 'text/event-stream', Host: window.location.host };
  // The token is a header, never a query parameter: no public URL protocol is
  // added, and nothing about the session (cookie/CSRF) touches the URL.
  if (options.lastEventId) headers['Last-Event-ID'] = options.lastEventId;
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (reason) {
    controller.abort();
    throw reason instanceof Error ? reason : new SseStreamError(undefined, 'SSE 连接失败。');
  }
  if (!response.ok) {
    const status = response.status;
    controller.abort();
    throw new SseStreamError(status, status === 401 ? '会话已失效，请重新配对。' : '事件流暂时无法建立。');
  }
  if (!response.body) {
    controller.abort();
    throw new SseStreamError(response.status, '事件流没有返回内容。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSseParser(options.onFrame);
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } catch {
      // Reader failures (network drop or the caller's abort) both end here.
    } finally {
      if (!closedByCaller) options.onEnd?.();
    }
  })();
  return {
    close() {
      closedByCaller = true;
      controller.abort();
    },
  };
}
