//! Unit tests for the attempt-exit typed evidence judgment layer
//! (web-api/2 §3.1.1, frozen spec SHA-256 449bf0b0…f2cd).
//!
//! Purely synthetic observations: no OS calls, no processes, no I/O. These
//! tests are the independent expectation source for the veto vocabulary,
//! the deterministic precedence, the ledger arithmetic (a pending stray is
//! never overwritten by a not-found round) and the §3.1.1 invariants —
//! written against the frozen contract, not against the implementation's
//! own outputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStrayLedger,
  assertVerdictTransition,
  buildAttemptExitEvidence,
  identityToString,
  validateAttemptExitEvidence,
} from '../../server/lib/attempt-exit-evidence.mjs';

function member(pid, observation, extra = {}) {
  return {
    pid,
    identity: { lstart: `lstart-${pid}`, command: `cmd-${pid}`, nonce: null },
    sourceFrame: 'worker_frame',
    registeredAt: '2026-11-11T04:00:00.000Z',
    observation,
    evidence: `synthetic ${observation}`,
    ...extra,
  };
}

/// Everything-good observation: worker exited, group ESRCH, two registered
/// members both extinct, argv scan executed with zero hits, no ledger rows.
function goodObservation(overrides = {}) {
  return {
    workerExited: true,
    groupObservation: 'esrch',
    members: [member(101, 'extinct'), member(102, 'extinct')],
    argvScan: { performed: true, hits: [] },
    strayLedger: null,
    ...overrides,
  };
}

test('registry_extinct positive control satisfies every invariant-1 conjunct', () => {
  const evidence = buildAttemptExitEvidence(goodObservation());
  assert.equal(evidence.verdict, 'registry_extinct');
  assert.equal(evidence.workerExited, true);
  assert.equal(evidence.groupAbsent, true);
  assert.deepEqual(evidence.registry, { total: 2, confirmedExtinct: 2, unobservable: 0, survivors: [] });
  assert.deepEqual(evidence.argvScan, { performed: true, hits: 0 });
  assert.deepEqual(evidence.veto, { triggered: false, reason: null, detail: null });
  // The literal-false constant is normative: never true, never undefined.
  assert.equal(evidence.residual.treeExtinctProven, false);
  assert.equal('treeExtinctProven' in evidence.residual, true);
  assert.equal(evidence.residual.scope, 'registry_domain');
  assert.equal(evidence.residual.strayLedger, null);
  assert.equal(typeof evidence.confirmedAt, 'string');
  assert.equal(Number.isNaN(Date.parse(evidence.confirmedAt)), false);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('proof-matched live member vetoes as known_survivor', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'alive', { evidence: 'proof-matched alive: lstart-102' })],
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.triggered, true);
  assert.equal(evidence.veto.reason, 'known_survivor');
  assert.equal(evidence.confirmedAt, null);
  assert.equal(evidence.registry.survivors.length, 1);
  assert.equal(evidence.registry.survivors[0].pid, 102);
  assert.equal(typeof evidence.registry.survivors[0].identity, 'string');
  assert.equal(evidence.registry.confirmedExtinct, 1);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('stray ledger pending>0 vetoes as known_survivor even with an otherwise clean observation', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    strayLedger: { found: 1, swept: 0, pending: 1 },
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'known_survivor');
  assert.match(evidence.veto.detail, /pending=1/);
  assert.deepEqual(evidence.residual.strayLedger, { found: 1, swept: 0, pending: 1 });
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('attributable argv hit (registered pid) vetoes as known_survivor', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'extinct')],
    argvScan: { performed: true, hits: [{ pid: 102, command: 'node x --run r1' }] },
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'known_survivor');
  assert.equal(evidence.argvScan.hits, 1);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('unattributable argv hit vetoes as insufficient_evidence (invariant 3 mapping)', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    argvScan: { performed: true, hits: [{ pid: 999999, command: 'decoy --run r1' }] },
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'insufficient_evidence');
  assert.match(evidence.veto.detail, /not attributable/);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('argvScan null and generic failure veto as insufficient_evidence', () => {
  const nullScan = buildAttemptExitEvidence(goodObservation({ argvScan: null }));
  assert.equal(nullScan.verdict, 'unresolved');
  assert.equal(nullScan.argvScan, null);
  assert.equal(nullScan.veto.reason, 'insufficient_evidence');
  assert.deepEqual(validateAttemptExitEvidence(nullScan), []);

  const failed = buildAttemptExitEvidence(goodObservation({ argvScan: { performed: false, errno: null } }));
  assert.equal(failed.verdict, 'unresolved');
  assert.deepEqual(failed.argvScan, { performed: false, hits: 0 });
  assert.equal(failed.veto.reason, 'insufficient_evidence');
  assert.deepEqual(validateAttemptExitEvidence(failed), []);
});

test('argv scan EPERM vetoes as eperm and outranks generic insufficient evidence', () => {
  const eperm = buildAttemptExitEvidence(goodObservation({
    argvScan: { performed: false, errno: 'EPERM', simulated: true },
  }));
  assert.equal(eperm.verdict, 'unresolved');
  assert.equal(eperm.veto.reason, 'eperm');
  assert.match(eperm.veto.detail, /EPERM/);
  assert.match(eperm.veto.detail, /simulated observation adapter/);
  assert.deepEqual(eperm.argvScan, { performed: false, hits: 0 });
  assert.deepEqual(validateAttemptExitEvidence(eperm), []);

  // EPERM beats the generic worker-not-exited face.
  const mixed = buildAttemptExitEvidence(goodObservation({
    workerExited: false,
    argvScan: { performed: false, errno: 'EPERM' },
  }));
  assert.equal(mixed.veto.reason, 'eperm');

  // Invariant 3 is unconditional: a failed argv scan fixes the reason (eperm
  // here) even when a proof-matched survivor coexists. The survivor fact is
  // preserved in the detail rather than dropped, and the validator accepts
  // the emitted object.
  const survivorFirst = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'alive')],
    argvScan: { performed: false, errno: 'EPERM' },
  }));
  assert.equal(survivorFirst.veto.reason, 'eperm');
  assert.equal(survivorFirst.veto.detail.includes('EPERM'), true);
  assert.equal(survivorFirst.veto.detail.includes('pid=101'), true, 'coexisting survivor fact preserved in detail');
  assert.deepEqual(validateAttemptExitEvidence(survivorFirst), []);
});

test('argv degenerate faces override coexisting survivor/pending faces (invariant 3 unconditional)', () => {
  const survivor = member(101, 'alive');

  // survivor x argv null -> insufficient_evidence
  const survivorNull = buildAttemptExitEvidence(goodObservation({
    members: [survivor], argvScan: null,
  }));
  assert.equal(survivorNull.veto.reason, 'insufficient_evidence');
  assert.equal(survivorNull.veto.detail.includes('pid=101'), true, 'survivor fact preserved');
  assert.deepEqual(validateAttemptExitEvidence(survivorNull), []);

  // pending x argv null -> insufficient_evidence
  const pendingNull = buildAttemptExitEvidence(goodObservation({
    argvScan: null, strayLedger: { found: 1, swept: 0, pending: 1 },
  }));
  assert.equal(pendingNull.veto.reason, 'insufficient_evidence');
  assert.equal(pendingNull.veto.detail.includes('pending=1'), true, 'ledger fact preserved');
  assert.deepEqual(validateAttemptExitEvidence(pendingNull), []);

  // pending x argv EPERM -> eperm
  const pendingEperm = buildAttemptExitEvidence(goodObservation({
    argvScan: { performed: false, errno: 'EPERM', simulated: true },
    strayLedger: { found: 1, swept: 0, pending: 1 },
  }));
  assert.equal(pendingEperm.veto.reason, 'eperm');
  assert.equal(pendingEperm.veto.detail.includes('pending=1'), true);
  assert.deepEqual(validateAttemptExitEvidence(pendingEperm), []);

  // pending x argv generic failure -> insufficient_evidence
  const pendingFailed = buildAttemptExitEvidence(goodObservation({
    argvScan: { performed: false, errno: null },
    strayLedger: { found: 1, swept: 0, pending: 1 },
  }));
  assert.equal(pendingFailed.veto.reason, 'insufficient_evidence');
  assert.deepEqual(validateAttemptExitEvidence(pendingFailed), []);

  // identity_mismatch x argv EPERM -> eperm (argv constraint wins, mismatch preserved)
  const mismatchEperm = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'identity_mismatch')],
    argvScan: { performed: false, errno: 'EPERM' },
  }));
  assert.equal(mismatchEperm.veto.reason, 'eperm');
  assert.equal(mismatchEperm.veto.detail.includes('pid=102'), true, 'mismatch fact preserved');
  assert.deepEqual(validateAttemptExitEvidence(mismatchEperm), []);
});

test('a clean argv scan does not override a coexisting veto (control)', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'alive')],
    argvScan: { performed: true, hits: [] },
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'known_survivor');
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('identity mismatch vetoes as identity_mismatch and counts the member unobservable', () => {
  const evidence = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'identity_mismatch', { evidence: 'lstart mismatch (pid reuse suspect)' })],
  }));
  assert.equal(evidence.verdict, 'unresolved');
  assert.equal(evidence.veto.reason, 'identity_mismatch');
  assert.match(evidence.veto.detail, /102/);
  assert.equal(evidence.registry.unobservable, 1);
  assert.equal(evidence.registry.confirmedExtinct, 1);
  assert.equal(evidence.registry.survivors.length, 0);
  // Identity equation holds.
  assert.equal(evidence.registry.total, evidence.registry.confirmedExtinct + evidence.registry.unobservable + evidence.registry.survivors.length);
  assert.deepEqual(validateAttemptExitEvidence(evidence), []);
});

test('group faces: alive/failed/eperm never record groupAbsent=true', () => {
  const alive = buildAttemptExitEvidence(goodObservation({ groupObservation: 'alive' }));
  assert.equal(alive.groupAbsent, false);
  assert.equal(alive.veto.reason, 'insufficient_evidence');
  assert.match(alive.veto.detail, /group still present/);

  const failed = buildAttemptExitEvidence(goodObservation({ groupObservation: 'failed' }));
  assert.equal(failed.groupAbsent, false);
  assert.equal(failed.veto.reason, 'insufficient_evidence');

  const eperm = buildAttemptExitEvidence(goodObservation({
    groupObservation: 'eperm',
    simulated: true,
  }));
  assert.equal(eperm.groupAbsent, false, 'a denied probe must never be recorded as absence');
  assert.equal(eperm.veto.reason, 'eperm');
  assert.match(eperm.veto.detail, /simulated observation adapter/);
  assert.deepEqual(validateAttemptExitEvidence(eperm), []);
});

test('worker not exited and unobservable members veto as insufficient_evidence', () => {
  const notExited = buildAttemptExitEvidence(goodObservation({ workerExited: false }));
  assert.equal(notExited.veto.reason, 'insufficient_evidence');
  assert.match(notExited.veto.detail, /worker process exit not observed/);
  assert.equal(notExited.confirmedAt, null);

  const unobservable = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'unobservable', { evidence: 'process table unavailable (errno EIO)' })],
  }));
  assert.equal(unobservable.veto.reason, 'insufficient_evidence');
  assert.match(unobservable.veto.detail, /1 registry member\(s\) unobservable/);
  assert.deepEqual(validateAttemptExitEvidence(unobservable), []);
});

test('bad observation shapes are refused instead of producing unverifiable evidence', () => {
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ groupObservation: 'weird' })), /bad groupObservation/);
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ members: [{ pid: 0, observation: 'extinct' }] })), /positive integer pid/);
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ members: [member(101, 'guessed')] })), /bad member observation/);
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ argvScan: { performed: 'yes', hits: [] } })), /performed must be boolean/);
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ argvScan: { performed: true, hits: [{}] } })), /integer pid/);
  assert.throws(() => buildAttemptExitEvidence(goodObservation({ strayLedger: { found: 1, swept: 0, pending: 2 } })), /bad strayLedger/);
});

test('stray ledger fold: cumulative rows, pending never erased by an unobservable round', () => {
  assert.equal(aggregateStrayLedger([]), null);
  const rows = [
    { attemptId: 'a1', runId: 'r1', sweepSeq: 1, sweptAt: 't1', found: 1, swept: 0, pending: 1, members: [{ key: '500:lstart-500', pid: 500, identity: 'i', evidence: 'discovered alive' }], evidenceScope: 'registry_domain' },
    // Observation-unavailable round: counters carried forward verbatim.
    { attemptId: 'a1', runId: 'r1', sweepSeq: 2, sweptAt: 't2', found: 1, swept: 0, pending: 1, members: [], evidenceScope: 'registry_domain', notes: ['counters carried forward'] },
    // Proof-matched sweep confirms the stray's death.
    { attemptId: 'a1', runId: 'r1', sweepSeq: 3, sweptAt: 't3', found: 1, swept: 1, pending: 0, members: [{ key: '500:lstart-500', pid: 500, identity: 'i', evidence: 'swept' }], evidenceScope: 'registry_domain' },
  ];
  assert.deepEqual(aggregateStrayLedger(rows), { found: 1, swept: 1, pending: 0 });
});

test('stray ledger fold rejects corrupt rows loudly (corruption is evidence corruption)', () => {
  const base = { attemptId: 'a1', runId: 'r1', sweepSeq: 1, sweptAt: 't1', found: 1, swept: 1, pending: 0, members: [], evidenceScope: 'registry_domain' };
  assert.throws(() => aggregateStrayLedger('nope'), /not an array/);
  assert.throws(() => aggregateStrayLedger([{ ...base, swept: 2 }]), /swept exceeds found/);
  assert.throws(() => aggregateStrayLedger([{ ...base, pending: 1 }]), /pending must equal/);
  assert.throws(() => aggregateStrayLedger([{ ...base, evidenceScope: 'os_domain' }]), /registry_domain/);
  assert.throws(() => aggregateStrayLedger([
    { ...base },
    { ...base, sweepSeq: 3, found: 2, swept: 1, pending: 1 },
  ]), /sweepSeq gap/);
  assert.throws(() => aggregateStrayLedger([
    { ...base, found: 2, swept: 1, pending: 1 },
    { ...base, sweepSeq: 2, found: 1, swept: 1, pending: 0 },
  ]), /went backwards/);
});

test('validator independently rejects contract-violating evidence objects', () => {
  const good = buildAttemptExitEvidence(goodObservation());
  assert.deepEqual(validateAttemptExitEvidence(good), []);

  const treeClaim = { ...good, residual: { ...good.residual, treeExtinctProven: true } };
  assert.ok(validateAttemptExitEvidence(treeClaim).some((v) => v.includes('literal false')));

  const hitsExtinct = buildAttemptExitEvidence(goodObservation({
    argvScan: { performed: true, hits: [{ pid: 999999, command: 'x' }] },
  }));
  hitsExtinct.verdict = 'registry_extinct'; // forged: hits>0 with extinct verdict
  assert.ok(validateAttemptExitEvidence(hitsExtinct).some((v) => v.includes('invariant 3')));

  const happyUnresolved = { ...good, verdict: 'unresolved', veto: { triggered: false, reason: null, detail: null }, confirmedAt: null };
  assert.ok(validateAttemptExitEvidence(happyUnresolved).some((v) => v.includes('invariant 2')));

  const brokenEquation = { ...good, registry: { ...good.registry, confirmedExtinct: 1 } };
  assert.ok(validateAttemptExitEvidence(brokenEquation).some((v) => v.includes('identity equation')));

  const missingIdentity = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'alive')],
  }));
  missingIdentity.registry.survivors = [{ pid: 102, evidence: 'x' }]; // identity dropped
  assert.ok(validateAttemptExitEvidence(missingIdentity).some((v) => v.includes('identity')));

  const nullScanEperm = buildAttemptExitEvidence(goodObservation({ argvScan: null }));
  nullScanEperm.veto.reason = 'eperm'; // forged: null scan cannot be eperm
  assert.ok(validateAttemptExitEvidence(nullScanEperm).some((v) => v.includes('invariant 3')));

  const nullScanSurvivor = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'alive')], argvScan: null,
  }));
  nullScanSurvivor.veto.reason = 'known_survivor'; // forged: null scan must be insufficient_evidence
  assert.ok(validateAttemptExitEvidence(nullScanSurvivor).some((v) => v.includes('invariant 3')));

  const failedScanMismatch = buildAttemptExitEvidence(goodObservation({
    members: [member(101, 'extinct'), member(102, 'identity_mismatch')],
    argvScan: { performed: false, errno: null },
  }));
  failedScanMismatch.veto.reason = 'identity_mismatch'; // forged: failed scan cannot be identity_mismatch
  assert.ok(validateAttemptExitEvidence(failedScanMismatch).some((v) => v.includes('invariant 3')));

  // Failed-scan evidence built by the producer itself stays valid.
  const failedScan = buildAttemptExitEvidence(goodObservation({ argvScan: { performed: false, errno: null } }));
  assert.deepEqual(validateAttemptExitEvidence(failedScan), []);
});

test('verdict migration has exactly one direction (invariant 6)', () => {
  assert.doesNotThrow(() => assertVerdictTransition('unresolved', 'registry_extinct'));
  assert.doesNotThrow(() => assertVerdictTransition('unresolved', 'unresolved'));
  assert.doesNotThrow(() => assertVerdictTransition('registry_extinct', 'registry_extinct'));
  assert.throws(() => assertVerdictTransition('registry_extinct', 'unresolved'), /invariant 6/);
});

test('identity strings are deterministic and truncate long commands', () => {
  const identity = { pid: 7, lstart: 'Tue Nov 11 04:00:00 2026', command: 'x'.repeat(300) };
  const a = identityToString(identity);
  const b = identityToString({ ...identity });
  assert.equal(a, b);
  assert.match(a, /pid:7/);
  assert.match(a, /lstart:Tue Nov 11 04:00:00 2026/);
  assert.ok(a.length < 400);
  assert.equal(identityToString(null), 'unknown');
  assert.equal(identityToString({}), 'unknown');
});
