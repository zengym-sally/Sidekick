//! Attempt-exit typed evidence — pure judgment layer (web-api/2 §3.1.1).
//!
//! No OS access and no I/O here: observations gathered by the host go in, a
//! typed `attemptExitEvidence` object conforming to the frozen web-api/2
//! contract comes out. The frozen spec (§3.1.1) is the sole authority; this
//! module never relaxes an invariant and never infers a registration from an
//! argv scan — members arrive already registered from frame sources.
//!
//! The contract pins part of the veto vocabulary; where several blocking
//! faces hold at once it does not fix a total order, so this producer uses
//! one deterministic precedence, documented here and asserted by tests:
//!
//!   0. argv degenerate faces — UNCONDITIONAL invariant-3 constraint on the
//!                            emitted reason: argvScan=null forces
//!                            insufficient_evidence; argvScan performed=false
//!                            forces insufficient_evidence, or eperm when the
//!                            scan was denied by the OS. These override every
//!                            other face (a coexisting survivor or pending
//!                            stray cannot relabel a null/failed scan).
//!   1. known_survivor      — a proof-matched live registry member, or
//!                            stray-ledger pending > 0 (found, not swept), or
//!                            an argv hit attributable to a registered pid.
//!   2. insufficient_evidence — argv hits > 0 that cannot be attributed
//!                            (invariant 3 forces this face into
//!                            known_survivor/insufficient_evidence whenever
//!                            hits > 0).
//!   3. identity_mismatch   — an occupant of a registered pid whose
//!                            lifetime identity does not proof-match
//!                            (PID-reuse suspect). Never swept, never killed.
//!   4. eperm               — a group probe denied by the OS; EPERM beats
//!                            generic failure.
//!   5. insufficient_evidence — every remaining face (worker not observed
//!                            exited, group still present, unobservable
//!                            members, ...).
//!
//! Coexisting faces are never dropped: `veto.detail` concatenates every
//! blocking face's detail, so a survivor or a pending stray stays visible
//! even when the argv constraint fixes the reason.
//!
//! Adapter-simulated observations (tests only) must carry `simulated: true`
//! and are named as such in the veto detail — never presented as real OS
//! rejections.

const VETO_REASONS = new Set(['known_survivor', 'insufficient_evidence', 'identity_mismatch', 'eperm']);
const GROUP_FACES = new Set(['esrch', 'alive', 'eperm', 'failed']);
const MEMBER_FACES = new Set(['extinct', 'alive', 'identity_mismatch', 'unobservable']);

function isInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIso8601(value) {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/// Deterministic compact identity string for `registry.survivors[].identity`.
export function identityToString(identity) {
  if (identity === null || identity === undefined) return 'unknown';
  if (typeof identity === 'string') return identity;
  const parts = [];
  if (Number.isInteger(identity.pid)) parts.push(`pid:${identity.pid}`);
  if (typeof identity.lstart === 'string' && identity.lstart !== '') parts.push(`lstart:${identity.lstart}`);
  if (typeof identity.command === 'string' && identity.command !== '') {
    parts.push(`cmd:${identity.command.slice(0, 120)}`);
  }
  if (typeof identity.nonce === 'string' && identity.nonce !== '') parts.push(`nonce:${identity.nonce}`);
  return parts.length ? parts.join(' | ') : 'unknown';
}

/// Fold an append-only stray ledger (oldest row first) into the disclosure
/// object. Each row carries CUMULATIVE per-attempt counters, so a round that
/// could not observe anything copies the previous counters forward and a
/// pending stray can never be erased by a later "found nothing" round —
/// pending may only drop when a row proves a proof-matched sweep (swept
/// grows while found stays). Throws on any structural or monotonicity
/// violation (a corrupt ledger is evidence corruption, not silence).
export function aggregateStrayLedger(rows) {
  if (!Array.isArray(rows)) throw new Error('stray_ledger_corrupt: rows is not an array');
  if (rows.length === 0) return null;
  let previous = null;
  for (const row of rows) {
    const where = `row sweep_seq=${row?.sweepSeq}`;
    if (!row || typeof row !== 'object') throw new Error(`stray_ledger_corrupt: ${where} not an object`);
    if (!isInteger(row.sweepSeq)) throw new Error(`stray_ledger_corrupt: ${where} bad sweepSeq`);
    if (!isInteger(row.found) || !isInteger(row.swept) || !isInteger(row.pending)) {
      throw new Error(`stray_ledger_corrupt: ${where} counters must be non-negative integers`);
    }
    if (row.swept > row.found) throw new Error(`stray_ledger_corrupt: ${where} swept exceeds found`);
    if (row.pending !== row.found - row.swept) {
      throw new Error(`stray_ledger_corrupt: ${where} pending must equal found - swept`);
    }
    if (row.evidenceScope !== 'registry_domain') {
      throw new Error(`stray_ledger_corrupt: ${where} evidenceScope must be registry_domain`);
    }
    if (previous !== null) {
      if (row.sweepSeq !== previous.sweepSeq + 1) throw new Error(`stray_ledger_corrupt: ${where} sweepSeq gap`);
      if (row.found < previous.found || row.swept < previous.swept) {
        throw new Error(`stray_ledger_corrupt: ${where} cumulative counters went backwards`);
      }
    }
    previous = row;
  }
  const last = rows[rows.length - 1];
  return { found: last.found, swept: last.swept, pending: last.pending };
}

/// Invariant 6 (§3.1.1): the only migration is unresolved -> registry_extinct.
/// Idempotent re-observations of the same verdict are allowed. Throws on an
/// illegal transition (registry_extinct is irreversible).
export function assertVerdictTransition(previous, next) {
  if (previous === 'registry_extinct' && next !== 'registry_extinct') {
    throw new Error(`illegal verdict migration: registry_extinct -> ${next} (invariant 6)`);
  }
}

/// Build the typed `attemptExitEvidence` object from one host observation.
///
/// `observation`:
///   workerExited      bool — the worker process exit was observed.
///   groupObservation  'esrch' | 'alive' | 'eperm' | 'failed'
///   members           [{ pid, identity, sourceFrame, registeredAt,
///                        observation: 'extinct'|'alive'|'identity_mismatch'|'unobservable',
///                        evidence }]
///   argvScan          { performed: true, hits: [{pid, command}] }
///                   | { performed: false, errno: 'EPERM'|null, simulated? }
///                   | null
///   strayLedger       { found, swept, pending } | null   (pre-aggregated on disk rows)
///
/// Returns the §3.1.1 object. Throws on observation shapes that would make
/// the invariants unverifiable (bad faces, negative counters, survivors not
/// proof-matched) — the producer refuses to emit evidence it cannot ground.
export function buildAttemptExitEvidence(observation, { now = () => new Date().toISOString() } = {}) {
  if (!observation || typeof observation !== 'object') {
    throw new Error('attempt-exit-evidence: observation object required');
  }
  const workerExited = observation.workerExited === true;
  const face = observation.groupObservation;
  if (!GROUP_FACES.has(face)) {
    throw new Error(`attempt-exit-evidence: bad groupObservation face ${JSON.stringify(face)}`);
  }
  const groupAbsent = face === 'esrch';

  const members = Array.isArray(observation.members) ? observation.members : [];
  const survivors = [];
  let confirmedExtinct = 0;
  let unobservable = 0;
  let identityMismatch = false;
  const memberPids = new Set();
  for (const member of members) {
    if (!member || typeof member !== 'object' || !Number.isInteger(member.pid) || member.pid <= 0) {
      throw new Error('attempt-exit-evidence: registry member needs a positive integer pid');
    }
    memberPids.add(member.pid);
    if (!MEMBER_FACES.has(member.observation)) {
      throw new Error(`attempt-exit-evidence: bad member observation face ${JSON.stringify(member.observation)}`);
    }
    if (member.observation === 'extinct') confirmedExtinct += 1;
    else if (member.observation === 'alive') {
      survivors.push({
        pid: member.pid,
        identity: identityToString(member.identity),
        evidence: String(member.evidence ?? 'proof-matched alive'),
      });
    } else {
      // unobservable or identity_mismatch: neither death nor (matched) life.
      unobservable += 1;
      if (member.observation === 'identity_mismatch') identityMismatch = true;
    }
  }
  const total = members.length;
  if (total !== confirmedExtinct + unobservable + survivors.length) {
    throw new Error('attempt-exit-evidence: registry identity equation violated by input');
  }

  // argvScan: normalize to the wire shape, keep details for the veto face.
  let argvScan = null;
  let argvFace = 'not_performed'; // not_performed | eperm | failed | hit | clean
  let argvAttributableHits = 0;
  const rawScan = observation.argvScan ?? null;
  if (rawScan !== null) {
    if (rawScan.performed === true) {
      const hits = Array.isArray(rawScan.hits) ? rawScan.hits : [];
      for (const hit of hits) {
        if (!hit || typeof hit !== 'object' || !Number.isInteger(hit.pid)) {
          throw new Error('attempt-exit-evidence: argv hit needs an integer pid');
        }
        if (memberPids.has(hit.pid)) argvAttributableHits += 1;
      }
      argvScan = { performed: true, hits: hits.length };
      argvFace = hits.length > 0 ? (argvAttributableHits > 0 ? 'hit' : 'unattributed_hit') : 'clean';
    } else if (rawScan.performed === false) {
      argvScan = { performed: false, hits: 0 };
      argvFace = rawScan.errno === 'EPERM' ? 'eperm' : 'failed';
    } else {
      throw new Error('attempt-exit-evidence: argvScan.performed must be boolean');
    }
  }

  const strayLedger = observation.strayLedger ?? null;
  if (strayLedger !== null) {
    if (!isInteger(strayLedger.found) || !isInteger(strayLedger.swept) || !isInteger(strayLedger.pending)
      || strayLedger.swept > strayLedger.found || strayLedger.pending !== strayLedger.found - strayLedger.swept) {
      throw new Error('attempt-exit-evidence: bad strayLedger disclosure');
    }
  }

  // Deterministic veto precedence (module docstring). The argv degenerate
  // faces are an UNCONDITIONAL invariant-3 constraint on the emitted reason,
  // so they are collected first and override every other face; coexisting
  // facts are preserved in the concatenated detail rather than dropped.
  const faces = [];
  if (argvScan === null) {
    faces.push({ reason: 'insufficient_evidence', detail: 'argv scan not performed this round' });
  } else if (argvFace === 'eperm') {
    faces.push({ reason: 'eperm', detail: 'argv scan denied by OS (EPERM)' + (observation.argvScan?.simulated ? ' (simulated observation adapter)' : '') });
  } else if (argvFace === 'failed') {
    faces.push({ reason: 'insufficient_evidence', detail: 'argv scan failed before executing' });
  }
  if (survivors.length > 0) {
    faces.push({ reason: 'known_survivor', detail: `${survivors.length} proof-matched live registry member(s): ${survivors.map((s) => `pid=${s.pid}`).join(', ')}` });
  }
  if (strayLedger !== null && strayLedger.pending > 0) {
    faces.push({ reason: 'known_survivor', detail: `stray ledger pending=${strayLedger.pending} (found, not swept; pending is never overwritten by a not-found round)` });
  }
  if (argvFace === 'hit') {
    faces.push({ reason: 'known_survivor', detail: `argv scan hit ${argvScan.hits} line(s) attributable to registered pid(s)` });
  }
  if (argvFace === 'unattributed_hit') {
    faces.push({ reason: 'insufficient_evidence', detail: `argv scan hit ${argvScan.hits} line(s) not attributable to any registered pid` });
  }
  if (identityMismatch) {
    const conflicts = members.filter((m) => m.observation === 'identity_mismatch').map((m) => `pid=${m.pid}`);
    faces.push({ reason: 'identity_mismatch', detail: `occupant identity does not proof-match registry entry for ${conflicts.join(', ')}; member neither confirmed dead nor swept` });
  }
  if (face === 'eperm') {
    faces.push({ reason: 'eperm', detail: 'process group probe denied by OS (EPERM); group absence not observed' + (observation.simulated ? ' (simulated observation adapter)' : '') });
  }
  if (!workerExited) faces.push({ reason: 'insufficient_evidence', detail: 'worker process exit not observed' });
  if (face === 'alive') faces.push({ reason: 'insufficient_evidence', detail: 'process group still present' });
  if (face === 'failed') faces.push({ reason: 'insufficient_evidence', detail: 'process group probe failed; group absence not observed' });
  if (unobservable > 0) faces.push({ reason: 'insufficient_evidence', detail: `${unobservable} registry member(s) unobservable` });

  const triggered = faces.length > 0;
  const reason = triggered ? faces[0].reason : null;
  const detail = triggered ? faces.map((f) => f.detail).join('; ') : null;
  if (triggered && !VETO_REASONS.has(reason)) {
    throw new Error(`attempt-exit-evidence: internal veto reason ${reason} outside contract vocabulary`);
  }

  // Invariant 1 conjuncts, re-checked on the derived values — a violation is
  // an internal error, never silently emitted evidence.
  const extinct = !triggered
    && workerExited && groupAbsent
    && survivors.length === 0
    && confirmedExtinct === total && unobservable === 0
    && argvScan !== null && argvScan.performed === true && argvScan.hits === 0
    && (strayLedger === null || strayLedger.pending === 0);
  if (extinct && reason !== null) throw new Error('attempt-exit-evidence: internal verdict contradiction');
  if (!extinct && reason === null) throw new Error('attempt-exit-evidence: unresolved without a blocking face');

  return {
    verdict: extinct ? 'registry_extinct' : 'unresolved',
    workerExited,
    groupAbsent,
    registry: { total, confirmedExtinct, unobservable, survivors },
    argvScan,
    veto: { triggered, reason, detail },
    residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger },
    confirmedAt: extinct ? now() : null,
  };
}

/// Independent structural + invariant check of an emitted evidence object
/// (§3.1.1 table and invariants 1–4). Used by tests as a mechanical gate on
/// every fixture-shaped object. Returns a list of violations; empty = valid.
export function validateAttemptExitEvidence(evidence) {
  const v = [];
  const e = evidence ?? {};
  if (e.verdict !== 'registry_extinct' && e.verdict !== 'unresolved') v.push('verdict outside enum');
  if (typeof e.workerExited !== 'boolean') v.push('workerExited not boolean');
  if (typeof e.groupAbsent !== 'boolean') v.push('groupAbsent not boolean');

  const r = e.registry ?? {};
  for (const key of ['total', 'confirmedExtinct', 'unobservable']) {
    if (!isInteger(r[key])) v.push(`registry.${key} must be a non-negative integer`);
  }
  if (!Array.isArray(r.survivors)) v.push('registry.survivors must be an array');
  else for (const s of r.survivors) {
    if (!Number.isInteger(s?.pid) || s.pid <= 0) v.push('survivor pid must be a positive integer');
    if (typeof s?.identity !== 'string' || s.identity === '') v.push('survivor identity must be a non-empty string');
    if (typeof s?.evidence !== 'string' || s.evidence === '') v.push('survivor evidence must be a non-empty string');
  }
  if (isInteger(r.total) && isInteger(r.confirmedExtinct) && isInteger(r.unobservable) && Array.isArray(r.survivors)) {
    if (r.total !== r.confirmedExtinct + r.unobservable + r.survivors.length) {
      v.push('registry identity equation violated');
    }
  }

  const a = e.argvScan ?? null;
  if (a !== null && (typeof a !== 'object' || typeof a.performed !== 'boolean' || !isInteger(a.hits))) {
    v.push('argvScan must be null or {performed: boolean, hits: int>=0}');
  }

  const veto = e.veto ?? {};
  if (typeof veto.triggered !== 'boolean') v.push('veto.triggered not boolean');
  if (veto.reason !== null && veto.reason !== undefined && !VETO_REASONS.has(veto.reason)) {
    v.push('veto.reason outside contract vocabulary');
  }
  if (veto.triggered === true && (veto.reason === null || veto.reason === undefined)) v.push('triggered veto without reason');
  if (veto.triggered === false && (veto.reason !== null && veto.reason !== undefined)) v.push('untriggered veto with reason');

  const residual = e.residual ?? {};
  if (residual.treeExtinctProven !== false) v.push('residual.treeExtinctProven must be literal false (invariant 4)');
  if (residual.scope !== 'registry_domain') v.push('residual.scope must be registry_domain');
  const sl = residual.strayLedger ?? null;
  if (sl !== null) {
    if (!isInteger(sl.found) || !isInteger(sl.swept) || !isInteger(sl.pending)) v.push('strayLedger counters must be non-negative integers');
    else if (sl.swept > sl.found || sl.pending !== sl.found - sl.swept) v.push('strayLedger arithmetic violated');
  }

  if (e.confirmedAt !== null && e.confirmedAt !== undefined && !isIso8601(e.confirmedAt)) v.push('confirmedAt must be ISO 8601 or null');

  // Invariant 1 / 2 re-derived from the object itself.
  const conjuncts = e.verdict === 'registry_extinct'
    && e.workerExited === true && e.groupAbsent === true
    && Array.isArray(r.survivors) && r.survivors.length === 0
    && r.confirmedExtinct === r.total && r.unobservable === 0
    && a !== null && a.performed === true && a.hits === 0
    && (sl === null || sl.pending === 0)
    && veto.triggered === false
    && typeof e.confirmedAt === 'string';
  if (e.verdict === 'registry_extinct' && !conjuncts) v.push('invariant 1 violated for registry_extinct');
  if (e.verdict === 'unresolved') {
    if (!(veto.triggered === true && veto.reason != null && (e.confirmedAt ?? null) === null)) {
      v.push('invariant 2 violated for unresolved');
    }
  }
  // Invariant 3.
  if (a !== null && a.performed === true && a.hits > 0) {
    if (e.verdict !== 'unresolved' || !(veto.reason === 'known_survivor' || veto.reason === 'insufficient_evidence')) {
      v.push('invariant 3 violated: hits>0 must veto as known_survivor/insufficient_evidence');
    }
  }
  if (a === null && e.verdict === 'unresolved' && veto.reason !== 'insufficient_evidence') {
    v.push('invariant 3 violated: null scan must veto as insufficient_evidence');
  }
  if (a !== null && a.performed === false && e.verdict === 'unresolved'
      && !(veto.reason === 'insufficient_evidence' || veto.reason === 'eperm')) {
    v.push('invariant 3 violated: failed scan must veto as insufficient_evidence/eperm');
  }
  return v;
}
