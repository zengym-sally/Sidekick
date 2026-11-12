//! Parser self-test for the same-origin SSE transport (`src/lib/sse-stream.ts`).
//!
//! Scope is the transport parser ONLY, per the task-SSE dispatch: the
//! incremental `text/event-stream` line/field parsing (chunk boundaries, line
//! endings, comments, field semantics, id persistence, dispatch rules) and
//! the token-relevant id discipline. The connection-level behavior (fetch,
//! reconnect policy, snapshot resync) belongs to the pairing sync and is
//! covered by the existing SSE black-box regression owned elsewhere — no
//! production state, no network, no fixtures beyond literal strings.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSseParser, SseStreamError } from '../../src/lib/sse-stream.ts';

function collect() {
  const frames = [];
  const parser = createSseParser((frame) => frames.push(frame));
  return { frames, parser };
}

test('a complete frame dispatches event, id and data', () => {
  const { frames, parser } = collect();
  parser.push('event: task.changed\n');
  parser.push('id: inst_9f27c1aa40b2:1043\n');
  parser.push('data: {"cursor":1043}\n');
  assert.deepEqual(frames, [], 'no dispatch before the blank line');
  parser.push('\n');
  assert.deepEqual(frames, [{ event: 'task.changed', id: 'inst_9f27c1aa40b2:1043', data: '{"cursor":1043}' }]);
});

test('chunk boundaries cannot split a frame: one character at a time', () => {
  const { frames, parser } = collect();
  const wire = 'event: stream.ready\ndata: {"epoch":"inst_a","cursor":7}\n\n';
  for (const character of wire) parser.push(character);
  assert.deepEqual(frames, [{ event: 'stream.ready', id: null, data: '{"epoch":"inst_a","cursor":7}' }]);
});

test('CRLF and bare CR line endings are equivalent line breaks', () => {
  const { frames, parser } = collect();
  parser.push('event: a\r\ndata: one\r\n\r\n');
  parser.push('event: b\rdata: two\r\r');
  assert.deepEqual(frames, [
    { event: 'a', id: null, data: 'one' },
    { event: 'b', id: null, data: 'two' },
  ]);
});

test('comment lines (connected/heartbeat) never dispatch and never touch ids', () => {
  const { frames, parser } = collect();
  parser.push(': connected\n\n');
  parser.push('id: inst_a:1\n');
  parser.push(': heartbeat\n');
  parser.push('data: x\n\n');
  assert.deepEqual(frames, [{ event: 'message', id: 'inst_a:1', data: 'x' }]);
});

test('multi-line data joins with newline and a single leading space is stripped once', () => {
  const { frames, parser } = collect();
  parser.push('data: line one\n');
  parser.push('data:line two\n');
  parser.push('data:  double space kept\n\n');
  assert.deepEqual(frames, [{ event: 'message', id: null, data: 'line one\nline two\n double space kept' }]);
});

test('the id persists across dispatches until a new id line appears', () => {
  const { frames, parser } = collect();
  parser.push('id: inst_a:1\ndata: one\n\n');
  parser.push('data: two\n\n');
  parser.push('id: inst_a:5\ndata: three\n\n');
  parser.push('data: four\n\n');
  assert.deepEqual(frames.map((frame) => frame.id), ['inst_a:1', 'inst_a:1', 'inst_a:5', 'inst_a:5']);
  assert.deepEqual(frames.map((frame) => frame.data), ['one', 'two', 'three', 'four']);
});

test('an id containing NUL is ignored and the previous token survives', () => {
  const { frames, parser } = collect();
  parser.push('id: inst_a:1\ndata: one\n\n');
  parser.push('id: inst_a:2\u0000\ndata: two\n\n');
  assert.deepEqual(frames.map((frame) => frame.id), ['inst_a:1', 'inst_a:1']);
});

test('a leading UTF-8 BOM is stripped once before field parsing', () => {
  const { frames, parser } = collect();
  parser.push('\uFEFFdata: after-bom\n\n');
  parser.push('data: second\n\n');
  assert.deepEqual(frames, [
    { event: 'message', id: null, data: 'after-bom' },
    { event: 'message', id: null, data: 'second' },
  ]);
});

test('data-less frames are not dispatched and reset the event buffer; retry and unknown fields are dropped', () => {
  const { frames, parser } = collect();
  parser.push('event: task.changed\n\n');
  parser.push('retry: 3000\nx-custom: whatever\n');
  parser.push('data: real\n\n');
  // The aborted dispatch (empty data buffer) also resets the event buffer per
  // the event-stream grammar, so the next dispatched frame is a plain
  // `message` — nothing from the data-less frame leaks into it.
  assert.deepEqual(frames, [{ event: 'message', id: null, data: 'real' }]);
});

test('end() flushes a trailing unterminated line and dispatches the pending frame', () => {
  const { frames, parser } = collect();
  parser.push('event: candidate.changed\ndata: {"sourceId":"s1"}');
  assert.deepEqual(frames, [], 'nothing before a line break or end()');
  parser.end();
  assert.deepEqual(frames, [{ event: 'candidate.changed', id: null, data: '{"sourceId":"s1"}' }]);
});

test('a realistic server handshake keeps the id discipline the token rule needs', () => {
  const { frames, parser } = collect();
  parser.push(': connected\n\n');
  parser.push('event: task.changed\nid: inst_a:12\ndata: {"objectType":"task","objectId":"tsk_1","objectVersion":2}\n\n');
  parser.push('event: stream.reset\ndata: {"epoch":"inst_b","reason":"epoch_changed"}\n\n');
  parser.push('event: stream.ready\ndata: {"epoch":"inst_b","cursor":30}\n\n');
  // Per the event-stream spec the last id persists across dispatches, so the
  // handshake frames still EXPOSE the last applied task cursor. The token
  // rule is enforced by the consumer's ordering: stream.reset and
  // stream.ready are routed by event name BEFORE the id is ever applied, and
  // ready/reset frames never carry their own id line on the wire — only
  // applied frames advance the reconnect token.
  assert.deepEqual(frames.map((frame) => frame.event), ['task.changed', 'stream.reset', 'stream.ready']);
  assert.equal(frames[0].id, 'inst_a:12');
  assert.deepEqual(frames.map((frame) => frame.data), [
    '{"objectType":"task","objectId":"tsk_1","objectVersion":2}',
    '{"epoch":"inst_b","reason":"epoch_changed"}',
    '{"epoch":"inst_b","cursor":30}',
  ]);
});

test('SseStreamError keeps the HTTP status for connection-level failures', () => {
  const unauthorized = new SseStreamError(401, '会话已失效，请重新配对。');
  const transport = new SseStreamError(undefined, 'SSE 连接失败。');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.name, 'SseStreamError');
  assert.equal(transport.status, undefined);
  assert.ok(unauthorized instanceof Error);
});
