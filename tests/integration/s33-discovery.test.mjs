import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, symlink, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
const binary = resolve('src-tauri/target/debug/examples/s33-mcp-host');
const directory = resolve('build/s0-runtime');
const pause = ms => new Promise(r => setTimeout(r, ms));
const wait = async (fn, ms = 8000) => { const until = Date.now() + ms; while (Date.now() < until) { const value = await fn(); if (value) return value; await pause(25); } throw new Error('verification timeout'); };
async function host(app, nonce, reopen = false, assets = directory, legacyV3 = false) {
  const child = spawn(binary, [app, nonce, assets, ...(reopen ? ['--reopen'] : legacyV3 ? ['--v3'] : [])], { env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp', SYNTHETIC_MODEL_KEY: 'must-not-inherit', TEST_MCP_REF: 'synthetic-private-marker-271828', TEST_MCP_CONTROL: '\x01'.repeat(4096) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const queue = [], lines = []; let error = '';
  child.stdin.on('error', () => {});
  child.stderr.on('data', c => { error += c; });
  createInterface({ input: child.stdout }).on('line', line => { const v = JSON.parse(line); const next = queue.shift(); if (next) next(v); else lines.push(v); });
  const receive = () => lines.length ? Promise.resolve(lines.shift()) : Promise.race([new Promise(r => queue.push(r)), new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`host timeout ${error}`)), 10000); t.unref(); })]);
  const ready = await receive(); assert.equal(ready.ready, true, error);
  return { child, request: async input => { child.stdin.write(JSON.stringify(input) + '\n'); return receive(); }, stop: async () => { if (child.exitCode !== null || child.signalCode !== null) return; child.stdin.end(); await new Promise(r => child.once('exit', r)); } };
}
async function fixture(mode, assets = directory, legacyV3 = false) {
  const base = await mkdtemp('/tmp/sidekick-s33-discovery-'); const app = join(base, 'isolated'); const nonce = randomBytes(24).toString('hex'); const log = join(base, 'service.jsonl');
  const h = await host(app, nonce, false, assets, legacyV3);
  const config = (await h.request({ op: 'config' })).ok;
  const input = { expectedRevision: config.revision, server: { name: 'Controlled discovery', transport: 'stdio', enabled: false, command: join(directory, 'node'), args: [resolve('tests/fixtures/s33-discovery/service.mjs'), log, mode], cwd: null, env: [], connectTimeoutMs: ['wait-init', 'slow-pages'].includes(mode) ? 1000 : 5000, toolTimeoutMs: 30000 } };
  const saved = await h.request({ op: 'save', input }); assert.ok(saved.ok, JSON.stringify(saved));
  return { base, app, nonce, log, h, server: saved.ok.serverId, revision: saved.ok.configuration.revision, input };
}
async function records(f) { try { return (await readFile(f.log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function alive(pid) { try { const text = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return text && !text.startsWith('Z'); } catch { return false; } }
async function cleanupProof(f) {
  const rs = await records(f); assert.equal(rs.filter(r => r.method === 'tools/call').length, 0);
  await wait(() => rs.filter(r => r.event === 'started').every(r => !alive(r.pid)), 5000);
  if (f.runtimePid) await wait(() => !alive(f.runtimePid), 5000);
  const audits = (await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(audits.length > 0, 'real negative PGID signals recorded');
  const groups = [...new Set(audits.map(a => a.group))];
  const processTable = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
  assert.ok(groups.every(group => !processTable.split('\n').some(line => { const p = line.trim().split(/\s+/); return Number(p[0]) === group && !p[1]?.startsWith('Z'); })), 'all guardian and keeper groups exited');
  const proofAt = Date.now(); await pause(100);
  assert.equal((await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).length, audits.length, 'no signal sent after group disappearance'); assert.ok(audits.every(a => a.matched && a.proofPid > 1 && a.group > 1));
  assert.ok(rs.every(r => !r.auditFdInherited), 'service cannot inherit private audit FD');
  await capture(f, { records: rs, audits, groupsGone: groups, proofAt, ...(f.runtimePid ? { runtime: { pid: f.runtimePid, exited: !alive(f.runtimePid) } } : {}), ...(f.controlPid ? { unrelatedControl: { pid: f.controlPid, alive: Boolean(alive(f.controlPid)) } } : {}) });
  return { modes: f.input.server.args[2], processes: rs.filter(r => r.event === 'started').length, methods: rs.filter(r => r.method).map(r => r.method), signals: audits.map(a => a.signal) };
}
async function capture(f, data) {
  if (!process.env.SIDEKICK_DISCOVERY_EVIDENCE) return;
  const target = resolve(process.env.SIDEKICK_DISCOVERY_EVIDENCE);
  await mkdir(target, { recursive: true, mode: 0o700 });
  f.capture = (f.capture || 0) + 1;
  await writeFile(join(target, `${f.evidenceLabel || f.input.server.args[2]}-${f.capture}.json`), JSON.stringify({ source: 'actual controlled run; synthetic values only', isolatedApp: f.app, ...data }, null, 2) + '\n', { mode: 0o600 });
}
async function finish(f, id) {
  return wait(async () => { const r = await f.h.request({ op: 'read', id }); assert.ok(r.ok, JSON.stringify(r)); return r.ok.status === 'running' ? null : r.ok; });
}
test('real Rust host discovers pages, cleans owned group and reopens full catalog', async () => {
  const f = await fixture('normal');
  try {
    const start = await f.h.request({ op: 'start', server: f.server, revision: f.revision }); assert.ok(start.ok, JSON.stringify(start));
    const result = await finish(f, start.ok.id); assert.equal(result.status, 'succeeded', JSON.stringify(result));
    const catalog = await f.h.request({ op: 'catalog', id: result.id }); assert.deepEqual(catalog.ok.tools.map(t => t.name), ['lookup', 'second']);
    assert.ok(result.result.catalogSha256);
    const proof = await cleanupProof(f); console.log(JSON.stringify({ scenario: 'normal', ...proof }));
    await f.h.stop(); f.h = await host(f.app, f.nonce, true);
    assert.deepEqual((await f.h.request({ op: 'catalog', id: result.id })).ok, catalog.ok);
  } finally { await f.h.stop(); }
});
for (const mode of ['large', 'limit', 'ref', 'cycle', 'bad-then-valid', 'oversize-then-valid', 'unknown-response', 'duplicate-response', 'tail-bad', 'tail-incomplete', 'changed', 'wait-init', 'catalog-exact', 'catalog-plus-one', 'schema-exact', 'schema-plus-one', 'pages-exact', 'pages-plus-one', 'duplicate-tool', 'invalid-utf8', 'stderr-overflow', 'notifications-overflow', 'slow-pages']) test(`real process ${mode} publishes only after valid discovery and cleanup`, async () => {
  const f = await fixture(mode);
  try {
    const start = await f.h.request({ op: 'start', server: f.server, revision: f.revision }); assert.ok(start.ok, JSON.stringify(start));
    const result = await finish(f, start.ok.id);
    assert.equal(result.status, ['large', 'catalog-exact', 'schema-exact', 'pages-exact'].includes(mode) ? 'succeeded' : 'failed', JSON.stringify(result));
    const catalog = await f.h.request({ op: 'catalog', id: result.id });
    if (['large', 'catalog-exact'].includes(mode)) assert.ok(Buffer.byteLength(JSON.stringify(catalog.ok)) > 262144); else if (!['schema-exact', 'pages-exact'].includes(mode)) assert.equal(catalog.ok, null);
    if (mode === 'catalog-exact') assert.equal(Buffer.byteLength(JSON.stringify(catalog.ok)), 524288);
    if (mode === 'pages-exact') assert.equal((await records(f)).filter(r => r.method === 'tools/list').length, 64);
    if (['wait-init', 'slow-pages'].includes(mode)) assert.equal(result.errorCode, 'MCP_TIMEOUT');
    console.log(JSON.stringify({ scenario: mode, status: result.status, code: result.errorCode, ...await cleanupProof(f) }));
  } finally { await f.h.stop(); }
});
test('shared slot, cancellation, active deletion and frozen edits use actual host', async () => {
  const f = await fixture('gate');
  try {
    const start = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await records(f)).some(r => r.method === 'tools/list'));
    const status = (await f.h.request({ op: 'status' })).ok; assert.equal(status.active, start.id); assert.equal(status.business, null); assert.equal(status.trial, null);
    assert.equal((await f.h.request({ op: 'start', server: f.server, revision: f.revision })).error.code, 'RUNTIME_BUSY');
    assert.equal((await f.h.request({ op: 'business' })).error.code, 'RUNTIME_BUSY');
    assert.equal((await f.h.request({ op: 'remove', input: { id: f.server, expectedRevision: f.revision } })).error.code, 'MCP_PROBE_ACTIVE');
    const edited = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, env: [{ name: 'TOOL_NAME', source: 'literal', value: 'after_edit' }] } } }); assert.ok(edited.ok, JSON.stringify(edited));
    await writeFile(f.log + '.release', 'release');
    const done = await finish(f, start.id); assert.equal(done.status, 'succeeded');
    assert.equal((await f.h.request({ op: 'catalog', id: done.id })).ok.tools[0].name, 'lookup');
    await cleanupProof(f);
    const next = (await f.h.request({ op: 'start', server: f.server, revision: edited.ok.configuration.revision })).ok;
    assert.equal((await finish(f, next.id)).status, 'succeeded');
    assert.equal((await f.h.request({ op: 'catalog', id: next.id })).ok.tools[0].name, 'after_edit');
    await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('cancel during initialize cleans descendants and frees slot', async () => {
  const f = await fixture('wait-list'); f.evidenceLabel = 'cancel-list';
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await records(f)).some(r => r.method === 'tools/list'));
    await f.h.request({ op: 'cancel', id: run.id });
    assert.equal((await finish(f, run.id)).status, 'cancelled');
    await cleanupProof(f); assert.equal((await f.h.request({ op: 'status' })).ok.active, null);
  } finally { await f.h.stop(); }
});
for (const target of ['host', 'runtime', 'guardian', 'service']) test(`SIGKILL ${target} still cleans owned group with unrelated control alive`, async () => {
  const f = await fixture('wait-list'); const control = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); f.evidenceLabel = `kill-${target}`; f.controlPid = control.pid;
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await records(f)).some(r => r.method === 'tools/list'));
    const status = (await f.h.request({ op: 'status' })).ok;
    f.runtimePid = status.process.pid;
    const service = (await records(f)).find(r => r.role === 'service');
    const pid = target === 'host' ? f.h.child.pid : target === 'runtime' ? status.process.pid : target === 'guardian' ? status.process.owner.guardian : service.pid;
    process.kill(pid, 'SIGKILL');
    console.log(JSON.stringify({ scenario: `kill-${target}`, ...await cleanupProof(f) }));
    assert.equal(Boolean(alive(control.pid)), true);
    if (target === 'host') {
      await wait(() => f.h.child.signalCode !== null);
      f.h = await host(f.app, f.nonce, true); assert.equal((await f.h.request({ op: 'read', id: run.id })).ok.status, 'interrupted');
    } else assert.equal((await finish(f, run.id)).status, 'failed');
  } finally { control.kill('SIGKILL'); await f.h.stop(); }
});
test('explicit environment only; referenced secret output is never published', async () => {
  const f = await fixture('secret');
  try {
    const saved = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, env: [{ name: 'REFERENCED_SECRET', source: 'environment', value: 'TEST_MCP_REF' }] } } });
    assert.ok(saved.ok, JSON.stringify(saved));
    const run = (await f.h.request({ op: 'start', server: f.server, revision: saved.ok.configuration.revision })).ok;
    const done = await finish(f, run.id); assert.equal(done.status, 'failed'); assert.equal(done.errorCode, 'MCP_PRIVATE_OUTPUT');
    const rs = await records(f); const env = rs.find(r => r.role === 'service').envKeys;
    assert.ok(!env.includes('SYNTHETIC_MODEL_KEY') && !env.includes('TEST_MCP_REF')); assert.ok(env.includes('REFERENCED_SECRET'));
    assert.ok(!JSON.stringify(done).includes('synthetic-private-marker')); await cleanupProof(f);
  } finally { await f.h.stop(); }
});
for (const policy of ['missing-ack', 'wrong-ack', 'cancel-before-ack', 'duplicate-owner']) test(`verification-only host policy ${policy} cannot publish; bootstrap requires matching ACK`, async () => {
  const f = await fixture('normal');
  try {
    if (policy === 'missing-ack') {
      const saved = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, connectTimeoutMs: 1000 } } }); f.revision = saved.ok.configuration.revision;
    }
    assert.equal((await f.h.request({ op: 'policy', value: policy })).ok, null);
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    const done = await finish(f, run.id); assert.notEqual(done.status, 'succeeded');
    if (policy !== 'duplicate-owner') assert.deepEqual(await records(f), [], 'no private bootstrap without matching ACK');
    if (['missing-ack', 'wrong-ack', 'cancel-before-ack'].includes(policy)) {
      const audit = (await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8')).trim(); assert.ok(audit.length > 0);
    }
    await capture({ ...f, input: { server: { args: ['', '', `policy-${policy}`] } } }, { policy, result: done, records: await records(f), audits: await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8') });
    console.log(JSON.stringify({ scenario: `host-policy-${policy}`, kind: 'verification-instrumented host with real guardian', status: done.status, serviceStarts: (await records(f)).filter(r => r.event === 'started' && r.role === 'service').length }));
  } finally { await f.h.stop(); }
});
test('verification-only blocked stdin cannot block host cancellation or deadline supervisor', async () => {
  const base = await mkdtemp('/tmp/sidekick-s33-channel-'); const assets = join(base, 'assets'); await mkdir(assets, { mode: 0o700 });
  await symlink(join(directory, 'node'), join(assets, 'node'));
  await copyFile(join(directory, 'mcp-guardian.mjs'), join(assets, 'mcp-guardian.mjs'));
  await writeFile(join(assets, 'mcp-probe.mjs'), 'process.stdin.pause(); setInterval(()=>{},1000);\n');
  const f = await fixture('blocked-writer', assets);
  try {
    const input = { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, args: Array.from({ length: 16 }, () => 'x'.repeat(4096)), env: Array.from({ length: 40 }, (_, i) => ({ name: `FILL${i}`, source: 'literal', value: 'x'.repeat(4096) })) } };
    const saved = await f.h.request({ op: 'save', input }); assert.ok(saved.ok, JSON.stringify(saved));
    await f.h.request({ op: 'policy', value: 'blocked-writer' });
    const at = Date.now(); const run = (await f.h.request({ op: 'start', server: f.server, revision: saved.ok.configuration.revision })).ok;
    assert.equal((await f.h.request({ op: 'status' })).ok.active, run.id, 'host remains responsive during blocked write');
    const result = await finish(f, run.id); assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'MCP_TIMEOUT'); assert.ok(Date.now() - at < 5000);
    assert.equal((await f.h.request({ op: 'status' })).ok.active, null); assert.deepEqual(await records(f), []);
    await capture(f, { kind: 'verification-only blocked Runtime stdin; no MCP process', result, elapsedMs: Date.now() - at });
  } finally { await f.h.stop(); }
});
test('explicit cancellation while initialize has no response', async () => {
  const f = await fixture('wait-init'); f.evidenceLabel = 'cancel-initialize';
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await records(f)).some(r => r.method === 'initialize'));
    await f.h.request({ op: 'cancel', id: run.id }); assert.equal((await finish(f, run.id)).status, 'cancelled');
    await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('isolated ordinary v3 refuses production start without auto migration', async () => {
  const f = await fixture('normal', directory, true);
  try {
    assert.equal((await f.h.request({ op: 'start', server: f.server, revision: f.revision })).error.code, 'MCP_SCHEMA_REQUIRED');
    assert.deepEqual(await records(f), []); assert.equal((await f.h.request({ op: 'status' })).ok.active, null);
    await capture({ ...f, evidenceLabel: 'v3-refusal' }, { kind: 'real isolated v3 store and production entry', serviceStarts: 0 });
  } finally { await f.h.stop(); }
});
test('business and trial slot fixtures reject probe before preparation without model access', async () => {
  const f = await fixture('normal');
  try {
    for (const kind of ['business', 'trial']) {
      assert.equal((await f.h.request({ op: 'reserve', kind })).ok, null);
      assert.equal((await f.h.request({ op: 'start', server: f.server, revision: f.revision })).error.code, 'RUNTIME_BUSY');
      assert.deepEqual(await records(f), []);
      assert.equal((await f.h.request({ op: 'release' })).ok, null);
    }
    await capture({ ...f, evidenceLabel: 'reverse-slot-reservations' }, { kind: 'verification-only slot fixtures; no business model execution', serviceStarts: 0 });
  } finally { await f.h.stop(); }
});
async function faultAssets(kind) {
  const base = await mkdtemp('/tmp/sidekick-s33-fault-'); const assets = join(base, 'assets'); await mkdir(assets, { mode: 0o700 });
  await symlink(join(directory, 'node'), join(assets, 'node')); await copyFile(join(directory, 'mcp-guardian.mjs'), join(assets, 'mcp-guardian.mjs'));
  let source = await readFile(join(directory, 'mcp-probe.mjs'), 'utf8');
  if (kind === 'owner-delay') {
    const target = 'send({ type: kind, ...owner }).catch(reject);'; assert.ok(source.includes(target));
    source = source.replace(target, `if (kind === 'owner') { import('node:fs').then(fs => { fs.writeFileSync(config.args[1]+'.owner-pending', JSON.stringify(owner)); }); } else ${target}`);
  } else if (kind === 'tail-fence') {
    const target = 'catalog = await Promise.race([discover(), timeout]);'; assert.ok(source.includes(target));
    source = source.replace(target, target + ` const fs = await import('node:fs'); fs.writeFileSync(p.args[1]+'.discovered','ready'); while (!fs.existsSync(p.args[1]+'.release')) await new Promise(r=>setTimeout(r,10));`);
  } else if (kind === 'blocked') source = 'process.stdin.pause(); setInterval(()=>{},1000);\n';
  else throw new Error('unknown fault asset');
  await writeFile(join(assets, 'mcp-probe.mjs'), source); return assets;
}
function killExact(pid, expected, signal = 'SIGKILL') {
  if (!alive(pid)) return false;
  const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  assert.ok(command.includes(expected), 'fixture teardown identity'); process.kill(pid, signal); return true;
}
for (const policy of ['old-run', 'old-nonce']) test(`review regression one stale owner and result (${policy}) cannot change current task`, async () => {
  const f = await fixture('normal'); f.evidenceLabel = `stale-${policy}`;
  try {
    await f.h.request({ op: 'policy', value: policy });
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    const done = await finish(f, run.id); assert.equal(done.status, 'succeeded', JSON.stringify(done));
    assert.deepEqual((await f.h.request({ op: 'catalog', id: run.id })).ok.tools.map(t => t.name), ['lookup', 'second']); await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('review regression known publication collision finishes failed without overwriting', async () => {
  const f = await fixture('artifact-collision');
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await f.h.request({ op: 'status' })).ok.active === null);
    const done = (await f.h.request({ op: 'read', id: run.id })).ok; assert.equal(done.status, 'failed', JSON.stringify(done)); assert.equal(done.errorCode, 'MCP_CATALOG_SAVE');
    assert.equal(await readFile(join(f.app, 'workspace/runs', run.id, 'mcp-catalog.json'), 'utf8'), 'collision-sentinel'); await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('review regression blocked stdin explicitly cancels and releases only after Runtime exit', async () => {
  const assets = await faultAssets('blocked'); const f = await fixture('blocked-cancel', assets);
  try {
    const saved = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, args: Array.from({ length: 16 }, () => 'x'.repeat(4096)), env: Array.from({ length: 40 }, (_, i) => ({ name: `FILL${i}`, source: 'literal', value: 'x'.repeat(4096) })) } } }); assert.ok(saved.ok);
    const run = (await f.h.request({ op: 'start', server: f.server, revision: saved.ok.configuration.revision })).ok;
    const status = await wait(async () => { const v = (await f.h.request({ op: 'status' })).ok; return v.process?.pid > 1 ? v : null; });
    await pause(100); await f.h.request({ op: 'cancel', id: run.id }); assert.equal((await finish(f, run.id)).status, 'cancelled');
    assert.ok(!alive(status.process.pid)); assert.equal((await f.h.request({ op: 'status' })).ok.active, null);
    await capture(f, { kind: 'blocked Runtime stdin fixture; actual explicit cancel', runtimePid: status.process.pid, exited: true });
  } finally { await f.h.stop(); }
});
test('review regression cancellation cannot hide unconfirmed cleanup', async () => {
  const f = await fixture('wait-list'); f.evidenceLabel = 'cancel-unconfirmed';
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => (await records(f)).some(r => r.method === 'tools/list'));
    const status = (await f.h.request({ op: 'status' })).ok; const owner = status.process.owner;
    process.kill(owner.guardian, 'SIGKILL'); process.kill(owner.keeper, 'SIGKILL');
    await f.h.request({ op: 'cancel', id: run.id }); const done = await finish(f, run.id);
    assert.equal(done.status, 'failed', JSON.stringify(done)); assert.equal(done.errorCode, 'MCP_CLEANUP'); assert.equal((await f.h.request({ op: 'status' })).ok.active, run.id);
    assert.ok((await records(f)).some(r => alive(r.pid))); await capture(f, { kind: 'both ownership proofs deliberately removed; production must not guess group', result: done, active: run.id, testTeardownRequired: true });
  } finally {
    for (const r of await records(f)) if (r.event === 'started') killExact(r.pid, f.log);
    await f.h.stop();
  }
});
test('review regression missing owner registration cannot release slot with live stopped helpers', async () => {
  const assets = await faultAssets('owner-delay'); const f = await fixture('normal', assets); f.evidenceLabel = 'unregistered-owner'; let owner;
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    owner = await wait(async () => { try { return JSON.parse(await readFile(f.log + '.owner-pending', 'utf8')); } catch { return null; } });
    process.kill(owner.guardian, 'SIGSTOP'); process.kill(owner.keeper, 'SIGSTOP');
    const status = (await f.h.request({ op: 'status' })).ok; assert.equal(status.process.owner, null); assert.equal(status.process.intent, owner.nonce); process.kill(status.process.pid, 'SIGKILL');
    const done = await finish(f, run.id); const active = (await f.h.request({ op: 'status' })).ok.active;
    const gone = !alive(owner.guardian) && !alive(owner.keeper);
    assert.ok(gone || (active === run.id && done.errorCode === 'MCP_CLEANUP'), JSON.stringify({ active, done, gone }));
    if (active === null) assert.ok(gone); assert.deepEqual(await records(f), []);
    await capture(f, { kind: 'delayed owner frame with real stopped guardian/keeper and killed Runtime', result: done, helpersGone: gone, active });
  } finally {
    if (owner) for (const pid of [owner.guardian, owner.keeper]) killExact(pid, owner.nonce);
    await f.h.stop();
  }
});
test('review regression raw service tail written behind stopped guardian is still validated', async () => {
  const assets = await faultAssets('tail-fence'); const f = await fixture('tail-fence', assets); f.evidenceLabel = 'drain-fence';
  try {
    const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    await wait(async () => { try { return await readFile(f.log + '.discovered', 'utf8'); } catch { return null; } });
    const status = (await f.h.request({ op: 'status' })).ok; process.kill(status.process.owner.guardian, 'SIGSTOP');
    await writeFile(f.log + '.write-tail', 'write'); await wait(async () => (await records(f)).some(r => r.event === 'tail-written'));
    await writeFile(f.log + '.release', 'release'); const done = await finish(f, run.id); assert.equal(done.status, 'failed', JSON.stringify(done)); assert.equal((await f.h.request({ op: 'catalog', id: run.id })).ok, null); await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('large escaped private bootstrap passes without copying P1 startup limit', async () => {
  const f = await fixture('large-bootstrap');
  try {
    const saved = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, env: Array.from({ length: 40 }, (_, i) => ({ name: `FILL${i}`, source: 'environment', value: 'TEST_MCP_CONTROL' })) } } }); assert.ok(saved.ok, JSON.stringify(saved));
    const run = (await f.h.request({ op: 'start', server: f.server, revision: saved.ok.configuration.revision })).ok;
    assert.equal((await finish(f, run.id)).status, 'succeeded');
    const received = (await records(f)).find(r => r.event === 'synthetic-env-received').items;
    assert.equal(Object.keys(received).length, 40); const digest = createHash('sha256').update('\x01'.repeat(4096)).digest('hex');
    assert.ok(Object.values(received).every(i => i.bytes === 4096 && i.sha256 === digest));
    assert.ok(Buffer.byteLength(JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`FILL${i}`, '\x01'.repeat(4096)])))) > 900000);
    await cleanupProof(f);
  } finally { await f.h.stop(); }
});
test('nonempty bounded raw stderr is discarded while private control stream remains separate', async () => {
  const f = await fixture('stderr-allowed');
  try { const run = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok; const done = await finish(f, run.id); assert.equal(done.status, 'succeeded'); assert.ok(!JSON.stringify(done).includes('synthetic-private-stderr')); await cleanupProof(f); }
  finally { await f.h.stop(); }
});
test('verification carrier rejects a symlink app even with copied valid marker', async () => {
  const f = await fixture('normal'); await f.h.stop();
  const alias = join(f.base, 'app-link'); await symlink(f.app, alias);
  assert.throws(() => execFileSync(binary, [alias, f.nonce, directory, '--reopen'], { env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' }, stdio: ['ignore', 'pipe', 'pipe'] }), error => error.status === 2 && error.stderr.toString().includes('VERIFY_INPUT'));
  await capture({ ...f, evidenceLabel: 'carrier-symlink-refusal' }, { kind: 'verification-only carrier boundary', refused: true });
});

for (const [kind, code] of [['command', 'MCP_COMMAND_MISSING'], ['cwd', 'MCP_DIRECTORY_MISSING'], ['environment', 'MCP_ENV_MISSING'], ['resources', 'MCP_DEPENDENCY_MISSING']]) test(`real host preparation rejects missing ${kind} without starting a service or losing history`, async () => {
  const f = await fixture('normal'); f.evidenceLabel = `preflight-${kind}`;
  try {
    const control = (await f.h.request({ op: 'start', server: f.server, revision: f.revision })).ok;
    assert.equal((await finish(f, control.id)).status, 'succeeded');
    const catalog = (await f.h.request({ op: 'catalog', id: control.id })).ok;
    assert.deepEqual(catalog.tools.map(t => t.name), ['lookup', 'second']);
    await cleanupProof(f);
    const beforeRecords = await records(f), beforeAudit = await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8');
    if (kind === 'resources') {
      const empty = join(f.base, 'missing-assets'); await mkdir(empty, { mode: 0o700 });
      await f.h.stop(); f.h = await host(f.app, f.nonce, true, empty);
    } else {
      const changes = kind === 'command' ? { command: join(f.base, 'missing-program') } : kind === 'cwd' ? { cwd: join(f.base, 'missing-directory') } : { env: [{ name: 'REQUIRED', source: 'environment', value: 'SIDEKICK_PREPARATION_MISSING' }] };
      const saved = await f.h.request({ op: 'save', input: { ...f.input, id: f.server, expectedRevision: f.revision, server: { ...f.input.server, ...changes } } });
      assert.ok(saved.ok, JSON.stringify(saved)); f.revision = saved.ok.configuration.revision;
    }
    const start = await f.h.request({ op: 'start', server: f.server, revision: f.revision }); assert.ok(start.ok, JSON.stringify(start));
    const failed = start.ok; assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.equal(failed.errorCode, code);
    assert.equal(failed.result, null); assert.equal((await f.h.request({ op: 'catalog', id: failed.id })).ok, null);
    assert.equal((await f.h.request({ op: 'status' })).ok.active, null);
    assert.deepEqual(await records(f), beforeRecords, 'preparation must not launch another service');
    assert.equal(await readFile(join(f.app, 'signal-audit.jsonl'), 'utf8'), beforeAudit, 'no group signal without a service');
    assert.deepEqual((await f.h.request({ op: 'catalog', id: control.id })).ok, catalog, 'prior valid catalog remains');
    await f.h.stop(); f.h = await host(f.app, f.nonce, true);
    const reopened = (await f.h.request({ op: 'read', id: failed.id })).ok;
    assert.equal(reopened.status, 'failed'); assert.equal(reopened.errorCode, code);
    assert.deepEqual((await f.h.request({ op: 'catalog', id: control.id })).ok, catalog);
    assert.deepEqual(await records(f), beforeRecords, 'reopen must not auto-start a service');
    await capture(f, { kind: 'actual Rust host preparation rejection with prior real process positive control', expectedCode: code, controlRunId: control.id, failed: reopened, priorCatalogPreserved: true, records: [], serviceStartsAfterRejection: 0, auditUnchanged: true, coldReopen: true });
  } finally { await f.h.stop(); }
});
