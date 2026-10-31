import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';

const directory = resolve('build/s0-runtime'), marker = 'SIDEKICK_MCP_AUDIT_FD';
const pause = ms => new Promise(r => setTimeout(r, ms));
const processInfo = pid => {
  try {
    const text = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=,pgid=,stat=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = text.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/s);
    return m && !m[3].startsWith('Z') ? { parent: Number(m[1]), group: Number(m[2]), command: m[4] } : null;
  } catch { return null; }
};
const groupGone = group => !execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' }).split('\n').some(l => { const p = l.trim().split(/\s+/); return Number(p[0]) === group && !p[1]?.startsWith('Z'); });
const cases = [
  { name: 'none', fd: 'ignore' }, { name: 'unrelated-readonly', fd: 'r' }, { name: 'unrelated-writable', fd: 'a+' },
  { name: 'explicit-writable', fd: 'a+', audit: '3' }, { name: 'explicit-readonly', fd: 'r', audit: '3', failure: true },
  { name: 'explicit-no-file', fd: 'ignore', audit: '3', failure: true, noStart: true },
  { name: 'explicit-pipe', fd: 'pipe', audit: '3', failure: true, noStart: true },
  { name: 'unknown-marker', fd: 'ignore', audit: '4', failure: true, noStart: true },
  { name: 'service-only-marker', fd: 'a+', serviceMarker: true },
  { name: 'keeper-recovery', fd: 'a+', audit: '3', failure: true, cleanupRecovery: true },
];
for (const mode of cases) test(`native descriptor regression: ${mode.name}`, async t => {
  const root = await mkdtemp('/tmp/sidekick-s33-native-fd-'), log = join(root, 'service.jsonl'), fdPath = join(root, 'descriptor.txt');
  const initial = mode.audit === '3' && mode.fd === 'a+' ? '' : 'unrelated-file-preserve\n';
  await writeFile(fdPath, initial, { mode: 0o600 });
  const file = ['r', 'a+'].includes(mode.fd) ? await open(fdPath, mode.fd) : null;
  const runId = `fd-${randomUUID()}`, hostNonce = randomUUID(); let owner, terminal, stderr = '', protocolFailure, fixtureCleanup = false, endFrames = 0, endAcks = 0, guardianKilled = false;
  const child = spawn(join(directory, 'node'), [join(directory, 'mcp-probe.mjs'), '--run', runId, '--nonce', hostNonce], {
    env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp', ...(mode.audit ? { [marker]: mode.audit } : {}) }, stdio: ['pipe', 'pipe', 'pipe', file ? file.fd : mode.fd],
  });
  child.stdin.on('error', () => {}); child.stderr.on('data', b => { stderr += b; });
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const owns = pid => {
    const p = processInfo(pid);
    return p && p.group === owner.guardian && p.command.includes(join(directory, 'mcp-guardian.mjs')) && p.command.includes(`--run ${runId} `) && p.command.includes(`--nonce ${owner.nonce} `);
  };
  const teardown = async () => {
    if (owner && !groupGone(owner.guardian)) {
      fixtureCleanup = true;
      for (const signal of ['SIGSTOP', 'SIGKILL']) {
        if (groupGone(owner.guardian)) break;
        assert.ok([owner.guardian, owner.keeper].some(owns), 'fixture cleanup must revalidate ownership');
        process.kill(-owner.guardian, signal);
      }
      for (let n = 0; n < 100 && !groupGone(owner.guardian); n++) await pause(20);
      assert.ok(groupGone(owner.guardian));
    }
    if (child.exitCode === null && child.signalCode === null) { child.stdin.end(); await Promise.race([done, pause(1000)]); }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  t.after(async () => { await teardown(); child.stdio[3]?.destroy?.(); await file?.close(); });
  const reply = frame => child.stdin.write(JSON.stringify(frame) + '\n');
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const f = JSON.parse(line); assert.equal(f.runId, runId); assert.equal(f.hostNonce, hostNonce);
      if (f.type === 'prepare') { assert.equal(f.guardian, 0); assert.equal(f.keeper, 0); reply(f); }
      else if (f.type === 'owner') {
        owner = f; assert.equal(processInfo(f.guardian)?.parent, child.pid); assert.equal(processInfo(f.keeper)?.parent, f.guardian);
        assert.ok([f.guardian, f.keeper].every(owns)); reply(f);
      } else if (f.type === 'end') { endFrames++; assert.ok(!mode.failure || mode.cleanupRecovery, 'audit failure cannot request end confirmation'); assert.ok(groupGone(f.guardian), 'end ACK only after independent group disappearance'); reply(f); endAcks++; }
      else if (['result', 'error'].includes(f.type)) terminal = f;
      else throw new Error('unexpected Runtime frame');
    } catch (error) { protocolFailure = error; }
  });
  reply({ runId, hostNonce, command: join(directory, 'node'), args: [resolve('tests/fixtures/s33-discovery/service.mjs'), log, mode.cleanupRecovery ? 'wait-list' : 'normal'], cwd: root, runDirectory: root, env: mode.serviceMarker ? { [marker]: '3' } : {}, sensitiveNames: [], directory, totalDeadline: Date.now() + 18000, connectTimeoutMs: 10000 });
  const serviceRows = () => readFile(log, 'utf8').then(x => x.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (let n = 0; n < 650 && !terminal && !protocolFailure; n++) {
    if (mode.cleanupRecovery && owner && !guardianKilled) {
      const rows = await serviceRows();
      if (rows.filter(x => x.event === 'started').length === 3 && rows.some(x => x.method === 'tools/list')) {
        assert.ok(owns(owner.guardian)); process.kill(owner.guardian, 'SIGKILL'); guardianKilled = true;
      }
    }
    await pause(20);
  }
  assert.ifError(protocolFailure); assert.ok(terminal, 'bounded terminal response');
  const failedGroupWasAlive = !!owner && !groupGone(owner.guardian);
  const beforeTeardown = await serviceRows();
  if (mode.name === 'explicit-readonly') {
    assert.equal(terminal.code, 'MCP_CLEANUP'); assert.equal(endFrames, 0); assert.equal(endAcks, 0); assert.ok(failedGroupWasAlive);
    assert.ok(beforeTeardown.filter(x => x.event === 'started').every(x => processInfo(x.pid)), 'audit failure leaves ordinary processes alive before fixture cleanup');
    const states = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' }).split('\n').map(x => x.trim().split(/\s+/)).filter(p => Number(p[0]) === owner.guardian).map(p => p[1]);
    assert.ok(states.length && states.every(s => !s.startsWith('T')), 'audit failure did not send SIGSTOP');
  }
  if (terminal.type === 'error') await teardown();
  const exit = await Promise.race([done, pause(2000).then(() => null)]); assert.ok(exit, 'Runtime exits after its result or separately recorded fixture cleanup');
  const rows = await readFile(log, 'utf8').then(x => x.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.ok(!rows.some(x => x.method === 'tools/call'));
  if (mode.failure) {
    assert.equal(terminal.type, 'error'); assert.notEqual(exit.code, 0);
    if (mode.noStart) assert.equal(rows.length, 0, 'invalid explicit audit cannot start a service');
    if (!mode.cleanupRecovery) { assert.equal(endFrames, 0); assert.equal(endAcks, 0); }
    else { assert.ok(guardianKilled && groupGone(owner.guardian)); assert.equal(fixtureCleanup, false, 'keeper must clean without a host teardown'); }
  } else {
    assert.equal(terminal.type, 'result', JSON.stringify({ type: terminal.type, code: terminal.code })); assert.equal(exit.code, 0); assert.equal(fixtureCleanup, false);
    assert.deepEqual(terminal.catalog.tools.map(x => x.name), ['lookup', 'second']); assert.equal(rows.filter(x => x.method === 'tools/list').length, 2);
    assert.ok(owner && groupGone(owner.guardian)); assert.ok(rows.filter(x => x.event === 'started').every(x => !processInfo(x.pid)));
  }
  assert.ok(rows.every(x => !x.auditFdInherited));
  assert.ok(rows.filter(x => x.event === 'started' && x.role === 'service').every(x => x.envKeys.includes(marker) === !!mode.serviceMarker), 'host private marker is not injected into the service');
  const final = await readFile(fdPath, 'utf8');
  if (!mode.audit || mode.fd === 'r') assert.equal(final, initial, 'unrelated or readonly file must retain its exact bytes');
  if (mode.audit === '3' && mode.fd === 'a+') {
    const audits = final.trim().split('\n').filter(Boolean).map(JSON.parse); assert.ok(audits.length >= 2);
    assert.ok(audits.every(x => x.matched && x.group === owner.guardian));
    if (mode.cleanupRecovery) {
      assert.deepEqual(audits.map(x => x.signal), ['SIGSTOP', 'SIGKILL']);
      assert.ok(audits.every(x => x.run === runId && x.nonce === owner.nonce && x.proofPid === owner.keeper), 'keeper identity and capability reach its cleaner');
    }
  }
  t.diagnostic(JSON.stringify({ scenario: mode.name, terminal: terminal.type, code: terminal.code, toolsCall: 0, fixtureCleanup, failedGroupWasAlive, descriptorSha256: createHash('sha256').update(final).digest('hex'), isolatedRoot: root }));
});
