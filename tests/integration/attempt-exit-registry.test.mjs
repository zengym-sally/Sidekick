//! Integration tests for the host registration & typed exit evidence
//! producer (MAYNE-35 bounded delivery 2; web-api/2 §3.1.1/§3.2.1/§12).
//!
//! Real SYNTHETIC processes only: the fixture leaves under
//! tests/fixtures/web-text-intake/ are self-reclaiming (bounded lifetime +
//! explicit kill with bounded reclamation polls). No real user processes,
//! credentials or working roots are read or written; every workspace is a
//! fresh temp dir. Adapter-simulated observations (EPERM probes, denied
//! kills, unavailable tables) are always labeled `simulated` in the
//! evidence and asserted as such — they never pose as real OS rejections.
//!
//! Expectations come from the frozen contract (§3.1.1 invariants,
//! §3.2.1 predicate, §12 registry/ledger fields), not from the
//! implementation's own behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerHost, verifyTree } from '../../server/lib/worker-host.mjs';
import { aggregateStrayLedger, validateAttemptExitEvidence } from '../../server/lib/attempt-exit-evidence.mjs';

const LEAF = join(import.meta.dirname, '..', 'fixtures', 'web-text-intake', 'exit-registry-leaf.mjs');

function psPids() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid='], { encoding: 'utf8', timeout: 5000 });
  return new Set(out.split('\n').map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid)));
}

async function waitGone(pid, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!psPids().has(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !psPids().has(pid);
}

async function reclaim(spawned) {
  for (const pid of spawned) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  const results = [];
  for (const pid of spawned) results.push(await waitGone(pid));
  return results.every(Boolean);
}

function leafFactory(modeArgs) {
  return (nodePath, args, opts, identity) => {
    const runId = identity?.runId ?? args[2];
    const hostNonceArgs = identity?.hostNonce ? ['--host-nonce', identity.hostNonce] : [];
    return spawn(process.execPath, [LEAF, ...modeArgs, '--run', runId, ...hostNonceArgs], {
      cwd: opts.cwd,
      env: opts.env,
      detached: opts.detached,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
}

function makeHost(root, modeArgs) {
  return new WorkerHost({
    runtimeRoot: join(root, 'unused-runtime'),
    root,
    runLimitMs: 8000,
    processFactory: leafFactory(modeArgs),
  });
}

async function runAttempt(t, modeArgs) {
  const root = mkdtempSync(join(tmpdir(), 'attempt-exit-registry-'));
  const extra = [];
  t.after(async () => {
    await reclaim(extra);
    rmSync(root, { recursive: true, force: true });
  });
  const host = makeHost(root, modeArgs);
  const handle = host.start({
    task: { taskId: 't-1', type: 'registry-probe', inputRef: {} },
    attemptId: `attempt-${Math.random().toString(16).slice(2, 8)}`,
    snapshot: {},
    credential: null,
  });
  return { root, host, handle };
}

test('registered positive control: worker+group+registry+argv all confirm, V1 boolean surface untouched', async (t) => {
  const { root, host, handle } = await runAttempt(t, ['hold', '300']);
  const outcome = await handle.done;
  // V1 surface: treeVerified is a strict BOOLEAN, not a typed object — the
  // old call convention must not silently become truthy-object.
  assert.equal(typeof outcome.treeVerified, 'boolean');
  assert.equal(outcome.treeVerified, true);
  assert.equal(verifyTree(handle.record), true);

  const observation = await host.observeAttemptExit(handle.runId);
  const evidence = observation.attemptExitEvidence;
  assert.ok(evidence, 'producer must emit evidence');
  assert.equal(evidence.verdict, 'registry_extinct');
  assert.equal(evidence.workerExited, true);
  assert.equal(evidence.groupAbsent, true);
  assert.equal(evidence.argvScan.performed, true);
  assert.equal(evidence.argvScan.hits, 0);
  assert.equal(evidence.registry.total >= 1, true, 'the worker frame itself is a registry member');
  assert.equal(evidence.registry.survivors.length, 0);
  assert.equal(evidence.registry.confirmedExtinct, evidence.registry.total);
  assert.equal(evidence.registry.unobservable, 0);
  assert.equal(evidence.veto.triggered, false);
  assert.equal(typeof evidence.confirmedAt, 'string');
  assert.equal(evidence.residual.treeExtinctProven, false);
  assert.equal(evidence.residual.scope, 'registry_domain');
  assert.equal(evidence.residual.strayLedger, null);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);

  // confirmExit keeps its exact V1 shape (boolean exited, no typed leak).
  const confirm = await host.confirmExit(handle.runId);
  assert.equal(confirm.exited, true);
  assert.equal(typeof confirm.exited, 'boolean');

  // Persisted registry carries the §12 proposal fields.
  const registry = JSON.parse(readFileSync(join(root, 'runs', handle.runId, 'attempt-registry.json'), 'utf8'));
  assert.equal(registry.attemptId, handle.attemptId);
  assert.equal(registry.runId, handle.runId);
  assert.ok(Array.isArray(registry.entries) && registry.entries.length >= 1);
  assert.equal(registry.entries[0].sourceFrame, 'worker_frame');
  assert.ok(registry.entries[0].identity.lstart, 'worker member lifetime anchor captured');
  assert.equal(typeof registry.updatedAt, 'string');
});

test('still-alive registered member vetoes; proof-matched sweep then confirms; verdict migrates once', async (t) => {
  const { root, host, handle } = await runAttempt(t, ['child', '300', '8000']);
  await handle.done;

  const vetoed = await host.observeAttemptExit(handle.runId);
  assert.equal(vetoed.attemptExitEvidence.verdict, 'unresolved');
  assert.equal(vetoed.attemptExitEvidence.veto.reason, 'known_survivor');
  assert.equal(vetoed.attemptExitEvidence.groupAbsent, false, 'the surviving child still holds the group');
  assert.equal(vetoed.attemptExitEvidence.registry.survivors.length, 1);
  const childPid = vetoed.attemptExitEvidence.registry.survivors[0].pid;
  assert.ok(psPids().has(childPid), 'survivor pid must be a real live process');

  const sweep = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.equal(sweep.disclosure.found, 1);
  assert.equal(sweep.disclosure.swept, 1);
  assert.equal(sweep.disclosure.pending, 0);
  assert.equal(sweep.row.evidenceScope, 'registry_domain');
  assert.equal(sweep.row.attemptId, handle.attemptId);
  assert.ok(await waitGone(childPid, 3000), 'proof-matched sweep must reclaim the survivor');

  const confirmed = await host.observeAttemptExit(handle.runId);
  assert.equal(confirmed.attemptExitEvidence.verdict, 'registry_extinct');
  assert.deepEqual(confirmed.attemptExitEvidence.residual.strayLedger, { found: 1, swept: 1, pending: 0 });
  assert.deepEqual(validateAttemptExitEvidence(confirmed.attemptExitEvidence), []);

  // Recovery-shaped observation: a FRESH host instance with no active handle
  // re-verifies from the persisted workspace files and reaches the same
  // verdict (invariant 6 direction preserved).
  const recovery = new WorkerHost({ runtimeRoot: join(root, 'unused-runtime'), root, runLimitMs: 8000, processFactory: null });
  const recovered = await recovery.observeAttemptExit(handle.runId);
  assert.equal(recovered.attemptExitEvidence.verdict, 'registry_extinct');
  assert.deepEqual(recovered.attemptExitEvidence.residual.strayLedger, { found: 1, swept: 1, pending: 0 });
});

test('GAP-5 registered setsid-style escape: group gone but registered member alive vetoes release', async (t) => {
  const { host, handle } = await runAttempt(t, ['detach', '300', '1500']);
  await handle.done;

  const observation = await host.observeAttemptExit(handle.runId);
  const evidence = observation.attemptExitEvidence;
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'known_survivor');
  // The escape detached into its OWN group, so the worker's group is gone…
  assert.equal(evidence.groupAbsent, true);
  // …but the FRAME-registered member is still alive: release must be vetoed.
  assert.equal(evidence.registry.survivors.length, 1);
  assert.equal(evidence.registry.survivors[0].identity.includes('nonce:fixture-'), true, 'frame-sourced identity');
  const escapedPid = evidence.registry.survivors[0].pid;
  assert.ok(psPids().has(escapedPid));

  const sweep = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.deepEqual(sweep.disclosure, { found: 1, swept: 1, pending: 0 });
  assert.ok(await waitGone(escapedPid, 3000));

  const confirmed = await host.observeAttemptExit(handle.runId);
  assert.equal(confirmed.attemptExitEvidence.verdict, 'registry_extinct');
  assert.deepEqual(confirmed.attemptExitEvidence.residual.strayLedger, { found: 1, swept: 1, pending: 0 });
});

test('unregistered & undiscovered escape: verdict is registry-domain honest, transient life disclosed', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'attempt-exit-registry-'));
  const marker = join(root, 'orphan-marker.json');
  t.after(async () => rmSync(root, { recursive: true, force: true }));
  const host = makeHost(root, ['orphan', '600', '1200', marker]);
  const handle = host.start({
    task: { taskId: 't-1', type: 'registry-probe', inputRef: {} },
    attemptId: 'attempt-orphan',
    snapshot: {},
    credential: null,
  });
  await handle.done;
  // The orphan self-exits at ~1800ms; observe inside that window.
  const observation = await host.observeAttemptExit(handle.runId);
  const evidence = observation.attemptExitEvidence;
  assert.equal(evidence.verdict, 'registry_extinct');
  assert.equal(evidence.argvScan.hits, 0, 'argv no-hit proves nothing about the orphan');
  // Honest scope: the registry-domain verdict never claims tree extinction.
  assert.equal(evidence.residual.treeExtinctProven, false);
  assert.equal(evidence.residual.scope, 'registry_domain');
  assert.equal(evidence.residual.strayLedger, null);

  // The orphan really existed inside the observation window, was never
  // registered, and is disclosed as unproven residual rather than denied.
  assert.ok(existsSync(marker), 'orphan marker proves transient life outside the registry');
  const { orphanPid } = JSON.parse(readFileSync(marker, 'utf8'));
  const registry = host.loadAttemptRegistry(handle.runId);
  assert.equal(registry.entries.some((entry) => entry.pid === orphanPid), false, 'orphan must not be a registry member');
  assert.ok(await waitGone(orphanPid, 6000), 'fixture self-reclaims the orphan');
});

test('PID reuse / identity mismatch vetoes and the mismatched occupant is never touched', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  // A live helper process stands in for a reused pid: the registry entry
  // carries a deliberately WRONG lifetime identity.
  const helper = spawn(process.execPath, [LEAF, 'hold', '8000'], { stdio: 'ignore', detached: true });
  t.after(async () => { try { process.kill(helper.pid, 'SIGKILL'); } catch { /* gone */ } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const registry = host.loadAttemptRegistry(handle.runId);
  registry.entries.push({
    pid: helper.pid,
    identity: { lstart: 'Thu Jan  1 00:00:00 2020', command: 'not-the-helper', nonce: null },
    sourceFrame: 'ppid_walk',
    registeredAt: new Date().toISOString(),
    lifetimeSpan: { firstSeenAt: new Date().toISOString(), lastSeenAt: null },
  });
  host.persistAttemptRegistry(handle.runId);

  const observation = await host.observeAttemptExit(handle.runId);
  const evidence = observation.attemptExitEvidence;
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'identity_mismatch');
  assert.equal(evidence.registry.unobservable, 1);
  assert.equal(evidence.registry.survivors.length, 0, 'a mismatched occupant is not our survivor');
  assert.equal(evidence.registry.total, evidence.registry.confirmedExtinct + evidence.registry.unobservable + evidence.registry.survivors.length);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);

  // The sweep must NOT touch the mismatched occupant.
  const sweep = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.equal(sweep.disclosure.pending, 0, 'mismatch is neither found-alive nor swept');
  assert.ok(sweep.row.members.some((row) => row.pid === helper.pid && /not touched/.test(row.evidence)));
  assert.ok(psPids().has(helper.pid), 'mismatched occupant must survive the sweep untouched');
});

test('argv scan faces: diagnostic faces first, then real decoy hit, then the clean confirmation', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  // Diagnostic faces run while the attempt verdict is still unresolved —
  // invariant 6 forbids any unresolved observation AFTER an extinct one, so
  // the clean real-scan confirmation must come last in this sequence.

  // Skip face: the round did not execute a scan.
  const skipped = await host.observeAttemptExit(handle.runId, { argvScan: 'skip' });
  assert.equal(skipped.attemptExitEvidence.argvScan, null);
  assert.equal(skipped.attemptExitEvidence.veto.reason, 'insufficient_evidence');

  // Simulated EPERM face (labeled, never posing as a real rejection).
  const eperm = await host.observeAttemptExit(handle.runId, {
    argvScan: () => ({ performed: false, errno: 'EPERM', simulated: true }),
  });
  assert.equal(eperm.attemptExitEvidence.veto.reason, 'eperm');
  assert.match(eperm.attemptExitEvidence.veto.detail, /simulated observation adapter/);

  // Simulated generic failure face.
  const failed = await host.observeAttemptExit(handle.runId, {
    argvScan: () => ({ performed: false, errno: null, simulated: true }),
  });
  assert.equal(failed.attemptExitEvidence.veto.reason, 'insufficient_evidence');

  // Decoy: an unrelated live process carrying the runId marker in argv.
  const decoy = spawn(process.execPath, [LEAF, 'hold', '4000', '--run', handle.runId], { stdio: 'ignore', detached: true });
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const hit = await host.observeAttemptExit(handle.runId);
    assert.equal(hit.attemptExitEvidence.verdict, 'unresolved');
    assert.equal(hit.attemptExitEvidence.veto.reason, 'insufficient_evidence', 'unattributable hit maps to insufficient_evidence');
    assert.equal(hit.attemptExitEvidence.argvScan.hits >= 1, true);
    assert.equal(hit.attemptExitEvidence.registry.survivors.length, 0, 'a decoy never becomes a registry member');
    assert.equal(host.loadAttemptRegistry(handle.runId).entries.some((entry) => entry.pid === decoy.pid), false, 'argv hits never register members');
  } finally {
    try { process.kill(decoy.pid, 'SIGKILL'); } catch { /* gone */ }
    await waitGone(decoy.pid);
  }

  // Real scan on a quiet system slice: performed, zero hits — this is the
  // attempt's single unresolved→extinct migration.
  const clean = await host.observeAttemptExit(handle.runId);
  assert.equal(clean.attemptExitEvidence.verdict, 'registry_extinct');
  assert.deepEqual(clean.attemptExitEvidence.argvScan, { performed: true, hits: 0 });
  assert.deepEqual(validateAttemptExitEvidence(clean.attemptExitEvidence), []);
});

test('stray pending survives denied-kill and unobservable rounds; only proof-matched sweep releases it', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  const stray = spawn(process.execPath, [LEAF, 'hold', '8000'], { stdio: 'ignore', detached: true });
  t.after(async () => { try { process.kill(stray.pid, 'SIGKILL'); } catch { /* gone */ } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  host.registerAttemptMembers(handle.runId, [{ pid: stray.pid, sourceFrame: 'ppid_walk' }]);

  // Round 1: kill denied by the simulated adapter — pending must hold.
  const denied = await host.runStraySweep(handle.runId, { kill: 'deny' });
  assert.deepEqual(denied.disclosure, { found: 1, swept: 0, pending: 1 });
  assert.ok(denied.row.notes.includes('simulated kill-denial adapter round'));
  assert.ok(denied.row.members.some((row) => /simulated kill-denial adapter/.test(row.evidence)));
  assert.ok(psPids().has(stray.pid));

  // Round 2: table unobservable (simulated adapter) — pending carried
  // forward, never overwritten by the unavailable round.
  const unavailable = await host.runStraySweep(handle.runId, {
    psTable: () => ({ ok: false, errno: 'EIO', simulated: true }),
  });
  assert.deepEqual(unavailable.disclosure, { found: 1, swept: 0, pending: 1 });
  assert.ok(unavailable.row.notes.some((note) => note.includes('counters carried forward')));
  assert.ok(psPids().has(stray.pid), 'unobservable round must not be treated as death');

  // Round 3: real proof-matched sweep confirms the stray's death.
  const swept = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.deepEqual(swept.disclosure, { found: 1, swept: 1, pending: 0 });
  assert.ok(await waitGone(stray.pid, 3000));

  // Ledger reread from disk loses no source: all three rows fold to (1,1,0).
  const { rows } = host.readStrayLedgerRows(handle.runId);
  assert.equal(rows.length, 3);
  assert.deepEqual(aggregateStrayLedger(rows), { found: 1, swept: 1, pending: 0 });
  for (const row of rows) {
    assert.equal(row.attemptId, handle.attemptId);
    assert.equal(row.evidenceScope, 'registry_domain');
  }

  const observation = await host.observeAttemptExit(handle.runId);
  assert.equal(observation.attemptExitEvidence.verdict, 'registry_extinct');
  assert.deepEqual(observation.attemptExitEvidence.residual.strayLedger, { found: 1, swept: 1, pending: 0 });
});

test('group observation faces: real ESRCH confirms absence; simulated EPERM/alive never do', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  const eperm = await host.observeAttemptExit(handle.runId, {
    groupProbe: () => ({ face: 'eperm', simulated: true }),
  });
  assert.equal(eperm.attemptExitEvidence.groupAbsent, false, 'denied probe never records absence');
  assert.equal(eperm.attemptExitEvidence.veto.reason, 'eperm');
  assert.match(eperm.attemptExitEvidence.veto.detail, /simulated observation adapter/);

  const alive = await host.observeAttemptExit(handle.runId, {
    groupProbe: () => ({ face: 'alive', simulated: true }),
  });
  assert.equal(alive.attemptExitEvidence.groupAbsent, false);
  assert.equal(alive.attemptExitEvidence.veto.reason, 'insufficient_evidence');
  assert.match(alive.attemptExitEvidence.veto.detail, /group still present/);
});

test('pending stray + argv skip: observeAttemptExit returns a legal typed unresolved instead of throwing', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  const stray = spawn(process.execPath, [LEAF, 'hold', '8000'], { stdio: 'ignore', detached: true });
  t.after(async () => { try { process.kill(stray.pid, 'SIGKILL'); } catch { /* gone */ } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  host.registerAttemptMembers(handle.runId, [{ pid: stray.pid, sourceFrame: 'ppid_walk' }]);

  const denied = await host.runStraySweep(handle.runId, { kill: 'deny' });
  assert.deepEqual(denied.disclosure, { found: 1, swept: 0, pending: 1 });

  // The argv scan was not performed this round. Invariant 3 fixes the reason
  // to insufficient_evidence even though the pending stray is a known
  // survivor face; the observation must return a legal typed object.
  const skipped = await host.observeAttemptExit(handle.runId, { argvScan: 'skip' });
  const evidence = skipped.attemptExitEvidence;
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'insufficient_evidence');
  assert.equal(evidence.argvScan, null);
  assert.deepEqual(evidence.residual.strayLedger, { found: 1, swept: 0, pending: 1 });
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('pending stray + unavailable process table: observeAttemptExit returns a legal typed unresolved instead of throwing', async (t) => {
  const { host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  const stray = spawn(process.execPath, [LEAF, 'hold', '8000'], { stdio: 'ignore', detached: true });
  t.after(async () => { try { process.kill(stray.pid, 'SIGKILL'); } catch { /* gone */ } });
  await new Promise((resolve) => setTimeout(resolve, 120));
  host.registerAttemptMembers(handle.runId, [{ pid: stray.pid, sourceFrame: 'ppid_walk' }]);

  const denied = await host.runStraySweep(handle.runId, { kill: 'deny' });
  assert.deepEqual(denied.disclosure, { found: 1, swept: 0, pending: 1 });

  // The process table is unavailable (simulated adapter): every member is
  // unobservable and the scan cannot execute. The observation must still
  // return a legal typed unresolved — it must NOT throw.
  const unavailable = await host.observeAttemptExit(handle.runId, {
    psTable: () => ({ ok: false, errno: 'EIO', simulated: true }),
  });
  const evidence = unavailable.attemptExitEvidence;
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'insufficient_evidence');
  assert.equal(evidence.argvScan.performed, false);
  assert.deepEqual(evidence.residual.strayLedger, { found: 1, swept: 0, pending: 1 });
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('corrupt stray ledger: runStraySweep reports one error shape for JSON and semantic corruption, disk untouched', async (t) => {
  const { root, host, handle } = await runAttempt(t, ['hold', '300']);
  await handle.done;

  // Seed one valid row through the host, then append a semantically corrupt
  // row (swept > found) directly to the ledger file.
  host.appendStrayLedgerRow(handle.runId, {
    attemptId: handle.attemptId,
    runId: handle.runId,
    sweepSeq: 1,
    sweptAt: new Date().toISOString(),
    found: 1, swept: 0, pending: 1,
    members: [],
    evidenceScope: 'registry_domain',
  });
  const ledgerPath = join(root, 'runs', handle.runId, 'stray-ledger.jsonl');
  const validText = readFileSync(ledgerPath, 'utf8');
  writeFileSync(ledgerPath, `${validText}${JSON.stringify({
    attemptId: handle.attemptId, runId: handle.runId, sweepSeq: 2,
    sweptAt: new Date().toISOString(), found: 1, swept: 2, pending: -1,
    members: [], evidenceScope: 'registry_domain',
  })}\n`);

  const semantic = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.equal(semantic.error, 'stray_ledger_corrupt');
  assert.match(semantic.detail, /stray_ledger_corrupt/);
  assert.equal(readFileSync(ledgerPath, 'utf8').includes('"swept":2'), true, 'the corrupt record stays on disk');

  // JSON corruption uses the same error shape.
  writeFileSync(ledgerPath, '{not json\n');
  const jsonCorrupt = await host.runStraySweep(handle.runId, { kill: 'real' });
  assert.equal(jsonCorrupt.error, 'stray_ledger_corrupt');
  assert.equal(readFileSync(ledgerPath, 'utf8'), '{not json\n', 'the corrupt record stays on disk');
});
