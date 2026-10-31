import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { McpControl } from '../../runtime/lib/mcp-control.mjs';

const directory = resolve('build/p4-recovery/probe');
const { McpTrial, ManagedMcpTransport, McpClient } = await import(pathToFileURL(join(directory, 'entry.mjs')).href);
const service = resolve('tests/fixtures/mcp-trial.mjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try { const state = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim(); return !!state && !state.startsWith('Z'); } catch { return false; }
};

async function seam(mode, body) {
  assert.equal(process.env.SIDEKICK_MCP_AUDIT_FD, undefined);
  const root = await mkdtemp(join(await realpath('/tmp'), 'sidekick-p4-node-'));
  const record = join(root, 'service.jsonl'), actions = [], runId = `recovery-${randomUUID()}`;
  const control = { request: async (action, value) => { actions.push({ action, value }); if (action === 'call_begin') await control.begin?.(); return {}; }, close: () => {} };
  const trial = new McpTrial({ runId, directory, cwd: root, deadline: Date.now() + 6000, servers: [], control, sensitive: [], onFatal: () => {} });
  const transport = new ManagedMcpTransport({ directory, command: process.execPath, args: [service, 'service', record, mode], cwd: root, runDirectory: root, runId, env: {}, deadline: trial.deadline, totalDeadline: trial.deadline }, { prepare: async () => {}, own: async () => {}, end: async () => {}, callGuard: () => trial.guard() });
  const client = new McpClient({ name: 'Recovery seam', version: '1', capabilities: {}, requestTimeoutMs: 1000 });
  const session = { server: { id: 'controlled', configurationRevision: 'synthetic-revision', toolTimeoutMs: 250 }, transport, client };
  const binding = { serverId: 'controlled', toolName: 'lookup', modelName: 'controlled-tool', schemaSha256: 'a'.repeat(64) };
  trial.sessions.push(session);
  const events = async () => { try { return (await readFile(record, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
  let succeeded = false;
  try {
    await client.connect(transport);
    await body({ trial, transport, client, session, binding, control, actions, events, root });
    succeeded = true;
  } catch (error) {
    error.message += ` (synthetic evidence retained: ${root})`;
    throw error;
  } finally {
    let cleanup;
    try { await trial.close(); } catch (error) {
      cleanup = error;
      const owner = transport.owner;
      if (owner) for (const pid of [owner.guardian, owner.keeper]) {
        try {
          const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
          if (command.includes(join(directory, 'mcp-guardian.mjs')) && command.includes(`--run ${runId} `) && command.includes(`--nonce ${owner.nonce} `)) execFileSync('/bin/kill', ['-KILL', `-${owner.guardian}`]);
        } catch {}
      }
    }
    for (const event of await events()) if (event.type === 'pid') assert.equal(alive(event.pid), false, `owned synthetic process remained alive; evidence: ${root}`);
    if (cleanup) { cleanup.message += ` (synthetic evidence retained: ${root})`; throw cleanup; }
    if (succeeded) await rm(root, { recursive: true });
  }
}

test('real Runtime/Pi seam has a successful positive control', async () => {
  await seam('normal', async ({ trial, session, binding, actions, events }) => {
    const result = await trial.call(session, binding, 'model-positive', { text: 'controlled' });
    assert.equal(result.content[0].text, 'controlled-text');
    assert.deepEqual(actions.map(item => item.action), ['call_begin', 'call_response']);
    assert.equal((await events()).filter(item => item.type === 'call').length, 1);
  });
});

test('cancellation after matching begin ACK prevents real dispatch', async () => {
  await seam('normal', async ({ trial, session, binding, control, actions, events }) => {
    const controller = new AbortController(); control.begin = () => controller.abort();
    await assert.rejects(trial.call(session, binding, 'model-cancel', { text: 'controlled' }, controller.signal));
    assert.deepEqual(actions.map(item => item.action), ['call_begin']);
    assert.equal((await events()).filter(item => item.type === 'call').length, 0);
  });
});

test('actual transport send refuses a cancelled granted call', async () => {
  await seam('normal', async ({ transport, trial, events }) => {
    transport.grantCall('lookup', { text: 'controlled' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(transport.send({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'lookup', arguments: { text: 'controlled' } } }, { signal: controller.signal }));
    trial.fail('CANCELLED');
    assert.equal((await events()).filter(item => item.type === 'call').length, 0);
  });
});

for (const mode of ['recovery-late-success', 'recovery-late-error']) test(`${mode} arrives through Pi but cannot revive the run`, async () => {
  await seam(mode, async ({ trial, transport, session, binding, actions, events }) => {
    let arrivals = 0; transport.onMessage(message => { if (message.result?.content?.[0]?.text === 'late-controlled') arrivals++; });
    await assert.rejects(trial.call(session, binding, 'model-late', { text: 'controlled' }));
    const stopped = trial.error, deadline = Date.now() + 1500;
    while ((!arrivals || !(await events()).some(item => item.type === 'late_written')) && Date.now() < deadline) await pause(10);
    assert.ok(arrivals > 0, 'late response must actually traverse the transport');
    assert.ok((await events()).some(item => item.type === 'late_attempt'));
    assert.ok((await events()).some(item => item.type === 'late_written'));
    await assert.rejects(trial.call(session, binding, 'fresh-model-retry', { text: 'controlled' }));
    assert.equal(trial.error, stopped);
    assert.deepEqual(actions.map(item => item.action), ['call_begin']);
    assert.equal((await events()).filter(item => item.type === 'call').length, 1);
  });
});

test('real Pi progress resets its soft timeout but cannot extend the Runtime hard deadline', async () => {
  await seam('recovery-progress', async ({ trial, client, session, binding, events }) => {
    let progress = 0, aborted = false;
    const call = client.callTool.bind(client);
    client.callTool = (name, args, options) => { options.signal.addEventListener('abort', () => { aborted = true; }); return call(name, args, { ...options, onProgress: () => { progress++; } }); };
    const started = performance.now();
    await assert.rejects(trial.call(session, binding, 'model-progress', { text: 'controlled' }));
    assert.ok(progress >= 2, 'the real SDK progress-reset path must run');
    assert.ok(aborted, 'the independent hard-deadline AbortSignal must fire');
    assert.ok(performance.now() - started < 1000);
    assert.equal((await events()).filter(item => item.type === 'call').length, 1);
  });
});

test('an expired ACK cannot release a fresh request with another identity', async () => {
  const sent = [];
  const control = new McpControl({ runId: 'run', hostNonce: 'host', deadline: Date.now() + 1000, send: value => sent.push(value) });
  await assert.rejects(control.request('call_begin', { callId: 'old' }, Date.now() + 10));
  const current = control.request('call_begin', { callId: 'new' }); let released = false; current.then(() => { released = true; });
  assert.equal(control.receive({ type: 'mcp_ack', action: 'call_begin', requestId: sent[0].requestId, runId: 'run', hostNonce: 'host', callId: 'old' }), false);
  await pause(10); assert.equal(released, false);
  assert.equal(control.receive({ type: 'mcp_ack', action: 'call_begin', requestId: sent[1].requestId, runId: 'run', hostNonce: 'host', callId: 'new' }), true);
  await current; control.close();
});


test('matching ACK after its deadline is rejected even before the timer runs', async () => {
  let control, accepted;
  const deadline = Date.now() + 30;
  control = new McpControl({ runId: 'run', hostNonce: 'host', deadline: Date.now() + 1000, send: frame => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, deadline - Date.now() + 30));
    accepted = control.receive({ ...frame, type: 'mcp_ack' });
  } });
  try {
    await assert.rejects(control.request('call_begin', { callId: 'late' }, deadline));
    assert.equal(accepted, false);
    assert.equal(control.pending.size, 0);
  } finally { control.close(); }
});

test('an already expired control request never reaches its send callback', async () => {
  let sends = 0;
  const control = new McpControl({ runId: 'run', hostNonce: 'host', deadline: Date.now() + 1000, send: () => { sends++; } });
  try {
    await assert.rejects(control.request('call_begin', { callId: 'expired' }, Date.now() - 1));
    assert.equal(sends, 0);
  } finally { control.close(); }
});

for (const stage of ['begin', 'result', 'response']) test(`local tool deadline remains absolute during a blocked ${stage} continuation`, async () => {
  let deadline, dispatches = 0, responses = 0;
  const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, deadline - Date.now() + 30));
  const control = { close: () => {}, request: async (action, _body, until) => {
    deadline = until;
    if (action === 'call_begin' && stage === 'begin') block();
    if (action === 'call_response') { responses++; if (stage === 'response') block(); }
    return {};
  } };
  const trial = new McpTrial({ runId: 'synthetic-deadline', directory: '/tmp', cwd: '/tmp', deadline: Date.now() + 10000, servers: [], control, sensitive: [], onFatal: () => {} });
  const transport = new ManagedMcpTransport({}, { callGuard: () => trial.guard() });
  transport.write = async () => { dispatches++; };
  const session = { server: { toolTimeoutMs: 1000, configurationRevision: 'synthetic' }, transport, client: { callTool: async (name, args, options) => {
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, options);
    if (stage === 'result') block();
    return { content: [{ type: 'text', text: 'controlled' }] };
  } } };
  const binding = { serverId: 'controlled', toolName: 'lookup', modelName: 'controlled', schemaSha256: 'a'.repeat(64) };
  await assert.rejects(trial.call(session, binding, 'model-id', { text: 'controlled' }), /MCP_TIMEOUT/);
  assert.equal(dispatches, stage === 'begin' ? 0 : 1);
  assert.equal(responses, stage === 'response' ? 1 : 0);
  assert.equal(trial.error, 'MCP_TIMEOUT');
});

test('the real transport refuses an expired call permit before writing', async () => {
  let writes = 0;
  const transport = new ManagedMcpTransport({}, { callGuard: () => {} });
  transport.write = async () => { writes++; };
  const deadline = Date.now() + 20;
  transport.grantCall('lookup', { text: 'controlled' }, deadline);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  await assert.rejects(transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lookup', arguments: { text: 'controlled' } } }), /MCP_TIMEOUT/);
  assert.equal(writes, 0);
});

test('a failed real seam keeps its synthetic service evidence after natural cleanup', async () => {
  let retained;
  const expected = new Error('Expected controlled assertion failure.');
  await assert.rejects(seam('normal', async ({ root }) => { retained = root; throw expected; }), error => error === expected);
  await access(join(retained, 'service.jsonl'));
  await rm(retained, { recursive: true });
});
