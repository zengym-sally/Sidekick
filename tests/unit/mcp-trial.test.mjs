import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { modelToolName, canonicalArguments, checkArguments, checkMcpResult } from '../../runtime/lib/mcp-tool-contract.mjs';
import { McpControl } from '../../runtime/lib/mcp-control.mjs';
import { runError } from '../../src/domain/organizer.ts';

test('MCP names bind stable server identity and exact tool name within model limits', () => {
  const expected = `mcp_${createHash('sha256').update('server-a\0lookup').digest('hex').slice(0, 56)}`;
  assert.equal(modelToolName('server-a', 'lookup'), expected);
  assert.notEqual(expected, modelToolName('server-b', 'lookup'));
  assert.notEqual(expected, modelToolName('server-a', 'Lookup'));
  assert.equal(modelToolName('server-a', 'x'.repeat(256)).length, 60);
});

test('arguments bind exact UTF-8 bytes and reject implicit coercion or optional-null removal', () => {
  assert.equal(canonicalArguments({ z: [1, { b: 2, a: '中文' }], a: true }), '{"a":true,"z":[1,{"a":"中文","b":2}]}');
  assert.equal(checkArguments({ b: 2, a: 1 }, { a: 1, b: 2 }), '{"a":1,"b":2}');
  for (const [raw, converted] of [[{ x: '1' }, { x: 1 }], [{ x: null }, {}], [[], []], [{ x: Infinity }, { x: null }]]) {
    assert.throws(() => checkArguments(raw, converted), /MCP_ARGUMENT_INVALID/);
  }
  assert.throws(() => canonicalArguments({ x: '中'.repeat(22000) }), /MCP_ARGUMENT_INVALID/);
});

test('known MCP errors preserve text and structured content with a shared byte budget', () => {
  const raw = { content: [{ type: 'text', text: 'controlled result' }], structuredContent: { value: 7 }, isError: true };
  const result = checkMcpResult(raw);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'controlled result');
  assert.ok(result.content.some(x => x.text.includes('"value":7')));
  assert.deepEqual(result.result, raw);
  assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(raw)));
  assert.throws(() => checkMcpResult(raw, [], 524288), /MCP_RESULT_INVALID/);
});

test('malformed, private and oversized responses cannot become confirmed results', () => {
  for (const value of [null, [], { content: 'bad' }, { content: [{ type: 'text', text: 1 }] }, { content: [], isError: 'yes' }, { content: [{ type: 'unknown' }] }, { content: [], structuredContent: null }]) {
    assert.throws(() => checkMcpResult(value), /MCP_RESULT_INVALID/);
  }
  assert.throws(() => checkMcpResult({ content: [{ type: 'text', text: 'synth-private-123' }] }, ['synth-private-123']), /MCP_PRIVATE_OUTPUT/);
  assert.throws(() => checkMcpResult({ content: [], structuredContent: { 'synth-private-123': 1 } }, ['synth-private-123']), /MCP_PRIVATE_OUTPUT/);
  assert.throws(() => checkMcpResult({ content: [{ type: 'text', text: 'x'.repeat(262144) }] }), /MCP_RESULT_INVALID/);
});

test('ACK releases only the matching run, host nonce, request, action and call', async () => {
  const sent = [];
  const control = new McpControl({ runId: 'trial-a', hostNonce: 'host-a', deadline: Date.now() + 1000, send: frame => sent.push(frame) });
  const pending = control.request('call_begin', { serverId: 'a', callId: 'call-a' });
  const request = sent[0];
  const ack = { type: 'mcp_ack', action: request.action, requestId: request.requestId, runId: 'trial-a', hostNonce: 'host-a', serverId: 'a', callId: 'call-a' };
  for (const change of [{ runId: 'old' }, { hostNonce: 'old' }, { requestId: 'old' }, { action: 'call_response' }, { callId: 'other' }, { serverId: 'b' }]) assert.equal(control.receive({ ...ack, ...change }), false);
  assert.equal(control.receive(ack), true);
  await pending;
  assert.equal(control.receive(ack), false);
  control.close();
});

test('missing ACK and closed control never release an executable call', async () => {
  const control = new McpControl({ runId: 'trial-a', hostNonce: 'host-a', deadline: Date.now() + 25, send: () => {} });
  await assert.rejects(control.request('call_begin', { callId: 'call-a' }), /MCP_PROTOCOL/);
  control.close();
  await assert.rejects(control.request('call_begin', { callId: 'call-b' }), /MCP_PROTOCOL/);
});

test('persisted unknown has an explicit external-result warning without a retry instruction', () => {
  const message = runError({ errorCode: 'MCP_RESULT_UNKNOWN' });
  assert.match(message, /操作可能已生效/);
  assert.match(message, /核对外部结果/);
  assert.doesNotMatch(message, /重试/);
});

test('HTTP ACKs bind transport endpoint revision and session identity', async () => {
  const sent = [], control = new McpControl({ runId: 'run-http', hostNonce: 'host-http', deadline: Date.now() + 1000, send: frame => sent.push(frame) });
  const identity = { serverId: 'http-a', transport: 'http', run: 'run-http', endpointSha256: 'a'.repeat(64), configurationRevision: 'revision-a', nonce: 'b'.repeat(48) };
  const pending = control.request('catalog', identity), request = sent[0];
  const ack = { ...request, type: 'mcp_ack' };
  for (const change of [{ transport: 'stdio' }, { endpointSha256: 'c'.repeat(64) }, { configurationRevision: 'old' }, { nonce: 'd'.repeat(48) }, { run: 'other-run' }]) assert.equal(control.receive({ ...ack, ...change }), false);
  assert.equal(control.receive(ack), true); await pending; control.close();
});

test('HTTP task errors expose finite local close facts without clearing unknown', () => {
  const run = { errorCode: 'MCP_RESULT_UNKNOWN', snapshot: { mcp: { remoteClose: { 'http-a': 'unconfirmed' } } } };
  assert.match(runError(run), /操作可能已生效/); assert.match(runError(run), /远端会话关闭未确认/);
  assert.doesNotMatch(runError(run), /远端.*已清理|重试整理/);
  assert.match(runError({ errorCode: 'MCP_HTTP_AUTH' }), /工具服务认证失败/);
  assert.match(runError({ errorCode: 'MCP_ENV_MISSING' }), /宿主变量缺失/);
});
