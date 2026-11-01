import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedMcp } from '../../src/domain/mcp.ts';
import { inspectMcpJson, formatMcpJson } from '../../src/domain/mcpJson.ts';
import { createMcpSettings } from '../../src/stores/mcp.ts';

const http = () => ({ name: '合成HTTP', transport: 'http', enabled: true, url: 'http://127.0.0.1:43123/mcp', headers: [{ name: 'X-Auth', source: 'environment', value: 'SIDEKICK_HTTP_SYNTH_AUTH' }], connectTimeoutMs: 10000, toolTimeoutMs: 30000 });
for (const type of ['http', 'streamable-http', 'streamable_http']) test(`HTTP JSON ${type} imports only whole host-variable references`, () => {
  const preview = inspectMcpJson(JSON.stringify({ mcpServers: { '合成HTTP': { type, url: http().url, headers: { 'X-Auth': '${SIDEKICK_HTTP_SYNTH_AUTH}' } } } }));
  assert.equal(preview.error, ''); assert.equal(preview.entries[0].error, ''); assert.deepEqual(preview.entries[0].draft, http());
});
test('HTTP JSON roundtrip retains header references and excludes stdio fields', () => {
  const exported = formatMcpJson(http()); assert.deepEqual(inspectMcpJson(exported).entries[0].draft, http());
  assert.equal(exported.includes('"command"'), false); assert.equal(exported.includes('"env"'), false); assert.equal(exported.includes('"args"'), false);
});
test('HTTP normalization has a valid positive control and preserves its exclusive wire shape', () => {
  assert.deepEqual(normalizedMcp(http()), http());
  assert.equal(normalizedMcp({ ...http(), url: 'https://example.invalid/mcp' }).url, 'https://example.invalid/mcp');
});
for (const value of ['Bearer synthetic-literal', 'Bearer ${TOKEN}', '{env:TOKEN}', '!command']) test(`HTTP JSON refuses unsupported header value ${value}`, () => {
  const preview = inspectMcpJson(JSON.stringify({ type: 'http', url: http().url, headers: { Authorization: value } })); assert.ok(preview.entries[0].error); assert.equal(preview.entries[0].draft, undefined);
});
for (const url of ['file:///synthetic', 'http://example.invalid/mcp', 'https://user:synthetic@example.invalid/mcp', 'https://example.invalid/mcp#', 'https://example.invalid/mcp?api_key=synthetic', 'https://example.invalid/mcp?auth=synthetic']) test(`HTTP normalization rejects invalid endpoint ${url}`, () => {
  assert.throws(() => normalizedMcp({ ...http(), url }), /HTTP|地址|认证|凭据|URL/);
});
for (const headers of [[{ name: 'Host', source: 'environment', value: 'HOST_VAR' }], [{ name: 'X-A', source: 'environment', value: 'A' }, { name: 'x-a', source: 'environment', value: 'B' }], [{ name: 'X-A', source: 'literal', value: 'synthetic' }], [{ name: 'X-A', source: 'environment', value: '${NOT_A_VARIABLE_NAME}' }]]) test(`HTTP normalization rejects unsupported header configuration ${headers[0].source}/${headers.length}`, () => {
  assert.throws(() => normalizedMcp({ ...http(), headers }), /请求头|头引用|宿主变量/);
});
test('old SSE transport and mixed transport fields remain explicitly refused', () => {
  for (const value of [{ type: 'sse', url: http().url }, { type: 'http', url: http().url, command: '/synthetic' }, { type: 'http', url: http().url, env: {} }, { type: 'stdio', url: http().url }]) assert.ok(inspectMcpJson(JSON.stringify(value)).entries[0].error);
});
function backend() {
  let configuration = { version: 1, revision: '', servers: [] }, lose = false; const calls = [];
  return { calls, lose: () => { lose = true; }, api: async (command, args) => {
    calls.push(command); if (command === 'read_mcp_configuration') return structuredClone(configuration);
    assert.equal(command, 'save_mcp_server'); const input = args.input; assert.equal(input.expectedRevision, configuration.revision);
    const id = input.id || 'mcp-synthetic-http'; configuration = { version: input.server.transport === 'http' ? 2 : configuration.version, revision: 'next', servers: [{ ...structuredClone(input.server), id }] };
    if (lose) { lose = false; throw { code: 'MCP_SAVE_UNCERTAIN', message: '合成响应丢失' }; }
    return { configuration: structuredClone(configuration), serverId: id, warning: null };
  } };
}
test('HTTP settings create and save without executing or reading a credential', async () => {
  const host = backend(), model = createMcpSettings(host.api); await model.load(); model.add('http'); Object.assign(model.current.value, http());
  await model.save(); assert.equal(model.configuration.value.version, 2); assert.equal(model.dirty.value, false); assert.equal(model.notice.value, '服务配置已保存。');
  assert.deepEqual(host.calls, ['read_mcp_configuration', 'save_mcp_server']); assert.equal(Object.hasOwn(model.configuration.value.servers[0], 'env'), false);
  assert.throws(() => model.setSecret('X-Auth', 'synthetic-never-used'));
});
test('HTTP uncertain save reconciles by readback without creating a second server', async () => {
  const host = backend(), model = createMcpSettings(host.api); await model.load(); model.add('http'); Object.assign(model.current.value, http()); host.lose();
  await assert.rejects(model.save()); assert.equal(model.ready.value, false); await model.load(); assert.equal(model.dirty.value, false); assert.equal(model.configuration.value.servers.length, 1);
  assert.deepEqual(host.calls, ['read_mcp_configuration', 'save_mcp_server', 'read_mcp_configuration']);
});
test('transport switching preserves branch drafts and never copies stdio env into HTTP headers', async () => {
  const model = createMcpSettings(backend().api); await model.load(); model.add(); model.current.value.name = '分支草稿'; model.current.value.command = '/synthetic'; model.current.value.env.push({ name: 'A', source: 'literal', value: 'public-value' });
  model.setTransport('http'); assert.equal(model.current.value.name, '分支草稿'); assert.deepEqual(model.current.value.headers, []); model.current.value.url = http().url;
  model.setTransport('stdio'); assert.equal(model.current.value.command, '/synthetic'); assert.equal(model.current.value.env[0].value, 'public-value');
  model.setTransport('http'); assert.equal(model.current.value.url, http().url); assert.equal(Object.hasOwn(model.current.value, 'env'), false);
});
test('a newer invalid HTTP draft cannot turn an acknowledged save into an uncertain result', async () => {
  const host = backend(); let finish, issued; const waiting = new Promise(resolve => { issued = resolve; });
  const model = createMcpSettings(async (command, args) => { const result = await host.api(command, args); if (command === 'save_mcp_server') { issued(); return new Promise(resolve => { finish = () => resolve(result); }); } return result; });
  await model.load(); model.add('http'); Object.assign(model.current.value, http()); const saving = model.save(); await waiting;
  model.current.value.url = 'invalid-newer-draft'; finish(); await saving; assert.equal(model.ready.value, true); assert.equal(model.dirty.value, true); assert.equal(model.current.value.url, 'invalid-newer-draft');
});
