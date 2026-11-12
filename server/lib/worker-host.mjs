//! Pi Runtime subprocess host.
//!
//! The backend never imports `runtime/` (layer guard): it starts the packaged
//! Pi Runtime as a child process and speaks the frozen stdio JSON-line protocol.
//! The API key is written to the child's private stdin and never appears in
//! argv, the environment, a log line or SSE.
//!
//! Two distinct moments are kept separate on purpose:
//!   1. a valid-identity result frame is persisted immediately (staging), and
//!   2. the process tree's exit is confirmed before the staged outcome is
//!      committed.
//! A result followed by a still-running worker therefore has a real staging
//! window: the staged rows are durable while the slot stays occupied.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateStrayLedger,
  assertVerdictTransition,
  buildAttemptExitEvidence,
  identityToString,
  validateAttemptExitEvidence,
} from './attempt-exit-evidence.mjs';

const DEFAULT_RUN_LIMIT_MS = 120000;
const DEADLINE_GRACE_MS = 2000;

/// The only frame sources allowed to register attempt members. An argv scan
/// hit is a supplementary veto signal and must never create a registry member
/// (frozen §3.1.1: argv is supplementary-only). A caller passing any other
/// source (e.g. `'argv_scan'`) is a wiring defect and is refused loudly.
const FRAME_SOURCE_ALLOWLIST = new Set([
  'worker_frame',
  'tool_owner_frame',
  'exit_children_snapshot',
  'ppid_walk',
]);

function nodeBinary(runtimeRoot) {
  return join(runtimeRoot, 'node');
}

function organizerScript(runtimeRoot) {
  return join(runtimeRoot, 'organizer.mjs');
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/// Direct children of `pid` right now, or null when the process table cannot
/// be read (in which case callers must treat the tree as unverified).
function childPids(pid) {
  try {
    const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
      timeout: 5000,
    });
    const children = [];
    for (const line of ps.split('\n')) {
      const [child, parent] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(child) && parent === pid) children.push(child);
    }
    return children;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Attempt registry & typed exit evidence (web-api/2 §3.1.1 / §12 producer).
//
// Everything below is ADDITIVE: the existing boolean surface above
// (`verifyTree`, `confirmExit`, the `done` outcome's `treeVerified`) keeps its
// exact V1 semantics and is never fed a typed object. The typed producer is a
// separate entry point (`observeAttemptExit`) that consumers adopt explicitly
// in a later serial candidate.
//
// Registration discipline (frozen spec §3.2.1 / §9 / §12):
//   * members enter the registry from FRAME sources (the worker's own spawn
//     frame, runtime `worker` tool-owner frames, the exit-time children
//     snapshot, best-effort recursive ppid walks) — never inferred from an
//     argv scan result;
//   * identity = frame source + lifetime anchor (ps lstart + command captured
//     at registration), so a later occupant of the same pid (reuse) cannot
//     proof-match;
//   * a sweep kills only after the occupant proof-matches the registered
//     identity; identity mismatch, EPERM, any known survivor or any evidence
//     gap vetoes;
//   * the stray ledger is append-only with cumulative counters, so a later
//     "found nothing" round can never overwrite an earlier pending stray;
//   * workspaces are keyed by the never-reused runId (attempt workspace);
//     attemptId rides inside every record — attemptId is attribution data,
//     never the namespace key.
// ---------------------------------------------------------------------------

/// One process-table snapshot: `{ok:true, rows:[{pid,ppid,lstart,command}]}`
/// or `{ok:false, errno, message}`. Never throws; callers must treat a failed
/// read as "unverified", never as "absent".
function processTable(factory = null) {
  if (typeof factory === 'function') return factory();
  try {
    const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
      timeout: 5000,
    });
    const rows = [];
    for (const line of ps.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Fixed-width lstart (e.g. "Mon Nov 11 04:00:00 2026") sits between ppid
      // and command; split off the first two numeric columns and the rest is
      // the command line.
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.{24})\s(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      rows.push({ pid, ppid, lstart: match[3].trim(), command: match[4] });
    }
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, errno: error?.code ?? null, message: String(error?.message ?? error) };
  }
}

function rowForPid(table, pid) {
  if (!table.ok) return null;
  return table.rows.find((row) => row.pid === pid) ?? null;
}

/// Proof-match a live occupant against a registered member identity. Only a
/// match justifies a sweep; a different occupant at the same pid is a
/// PID-reuse suspect and must never be touched. A registration without at
/// least one positive identity anchor (lstart or command) can never
/// proof-match — killing on it would be unverifiable.
function proofMatchMember(member, row) {
  const identity = member.identity ?? {};
  if ((typeof identity.lstart !== 'string' || identity.lstart === '')
    && (typeof identity.command !== 'string' || identity.command === '')) {
    return { matched: false, why: 'registration identity incomplete; occupant cannot be proof-matched' };
  }
  if (typeof identity.lstart === 'string' && identity.lstart !== ''
    && typeof row.lstart === 'string' && row.lstart !== ''
    && identity.lstart !== row.lstart) {
    return { matched: false, why: 'lstart mismatch (pid reuse suspect)' };
  }
  if (typeof identity.command === 'string' && identity.command !== ''
    && typeof row.command === 'string' && row.command !== ''
    && identity.command !== row.command) {
    return { matched: false, why: 'command mismatch (pid reuse suspect)' };
  }
  return { matched: true, why: null };
}

/// Best-effort recursive descendant discovery: walk the ppid graph from the
/// given roots. Returns discovered pids (roots included) plus each discovery's
/// source label; a failed table read yields an empty set with ok:false —
/// best-effort only, never a completeness claim.
function walkDescendants(table, rootPids) {
  if (!table.ok) return { ok: false, pids: [] };
  const byParent = new Map();
  for (const row of table.rows) {
    if (!byParent.has(row.ppid)) byParent.set(row.ppid, []);
    byParent.get(row.ppid).push(row);
  }
  const found = new Map();
  const queue = [...rootPids];
  while (queue.length) {
    const pid = queue.shift();
    if (found.has(pid)) continue;
    const row = table.rows.find((candidate) => candidate.pid === pid);
    if (row) found.set(pid, row);
    for (const child of byParent.get(pid) ?? []) queue.push(child.pid);
  }
  return { ok: true, pids: [...found.keys()], rows: found };
}

/// Whether the worker's whole process tree is gone.
///
/// A string match alone cannot prove exit: an unmarked descendant would be
/// missed. We verify the **registered identity set** — the worker's process
/// group plus the direct children observed at exit — and treat the tree as
/// unverified (so the caller keeps `exited_unknown` and the slot held) whenever
/// that set cannot be enumerated or any member survives. The `--run <runId>`
/// scan is a supplementary signal, never the sole proof.
export function verifyTree(record) {
  if (!Number.isInteger(record?.pgid) || record.pgid <= 0) return false;
  try {
    process.kill(-record.pgid, 0);
    return false;
  } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  if (!Array.isArray(record.children)) return false;
  for (const child of record.children) {
    if (processIsAlive(child)) return false;
  }
  if (record.runId) {
    try {
      const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
        timeout: 5000,
      });
      if (ps.includes(`--run ${record.runId}`)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/// Map the EXISTING runtime frames to real side-effect facts.
///
/// Two distinct sources are kept apart:
///   * the generic tool path — `progress{phase:'tool'}` (a tool start we cannot
///     attribute to a call) and `worker` lifecycle events (a closed bash call);
///   * the MCP control plane — `{type:'mcp', action}` frames, where `call_begin`
///     / `call_response` are the real external MCP calls and the remaining
///     actions (`http_open`/`prepare`/`owner`/`end`/`catalog`) are control-plane
///     interactions.
///
/// MCP callKey is `[callId, modelCallId]`; bash callKey is `[pid, nonce]`.
/// Begin and closed are recorded as INDEPENDENT facts (no lookahead): a
/// `call_response` never searches the raw frame set for a future or rejected
/// begin, and every fact commits in its own transaction. Nothing here infers
/// safety from a closure or from the absence of a record — all of these are
/// non-readonly, so a zero count never yields `proven_safe`.
export /// Map the EXISTING runtime frames to real side-effect facts.
///
/// Pairing is exact and persistence-gated (frozen P-3): a `call_response` closes
/// a begin only when the scheduler has already persisted a begin with the SAME
/// `serverId` + `callId` in the current attempt. The runtime does not repeat
/// `modelCallId` on the response, so the association is by the single-call
/// identity, never by service alone and never FIFO: a B response can never
/// close A's begin. A closure with no persisted begin is recorded as
/// `tool_call_unattributed` and never fabricates a pairing. Duplicate frames
/// neither reopen a closed call nor consume another begin.
///
/// Facts carry the pairing inputs; the scheduler owns the persisted-begin set.
function receiptFactsFor(frame) {
  if (frame.type === 'mcp') {
    const action = frame.action ?? null;
    if (action === 'call_begin') {
      return [{
        kind: 'tool_call_begin',
        serverId: frame.serverId ?? null,
        callId: frame.callId ?? null,
        callKey: [frame.callId ?? null, frame.input?.modelCallId ?? null],
        externalRef: frame.callId ?? null,
        provableReadonly: false,
      }];
    }
    if (action === 'call_response') {
      return [{
        kind: 'tool_call_closed',
        serverId: frame.serverId ?? null,
        callId: frame.callId ?? null,
        callKey: null,
        needsPairing: true,
        externalRef: frame.callId ?? null,
        provableReadonly: false,
      }];
    }
    return [{
      kind: 'tool_call_unattributed',
      serverId: frame.serverId ?? null,
      callId: null,
      callKey: null,
      externalRef: action,
      provableReadonly: false,
    }];
  }
  if (frame.type === 'progress' && frame.phase === 'tool') {
    return [{ kind: 'tool_call_unattributed', serverId: null, callId: null, callKey: null, externalRef: null, provableReadonly: false }];
  }
  if (frame.type === 'worker') {
    const pid = frame.pid ?? frame.workerPid ?? null;
    const nonce = frame.nonce ?? frame.hostNonce ?? null;
    if (pid === null && nonce === null) return [];
    return [{ kind: 'tool_call_closed', serverId: null, callId: null, callKey: [pid, nonce], externalRef: nonce, provableReadonly: false }];
  }
  return [];
}

/// Pair a closure fact with a previously persisted begin. `openBegins` maps
/// `serverId\u0000callId` to `{ callKey }`; `closedPairs` records pairs already
/// closed so a duplicate frame can never reopen them. Returns the fact to
/// persist; a closure without a persisted begin becomes unattributed.
export function pairReceiptFact(fact, openBegins, closedPairs) {
  if (!fact.needsPairing) return fact;
  const pairKey = fact.serverId != null && fact.callId != null
    ? `${fact.serverId}\u0000${fact.callId}`
    : null;
  if (pairKey !== null && openBegins.has(pairKey)) {
    const open = openBegins.get(pairKey);
    openBegins.delete(pairKey);
    closedPairs.add(pairKey);
    return { ...fact, kind: 'tool_call_closed', callKey: open.callKey, needsPairing: false };
  }
  return { ...fact, kind: 'tool_call_unattributed', callKey: null, needsPairing: false };
}

/// Verify the runtime bundle layout before spawning. Existence is a hard
/// prerequisite for the spawn itself (a missing binary or entry is a typed
/// `runtime_start` failure), never a safety verdict: it is called on every
/// start, and the trusted-artifact binding below is what the safety proof
/// consumes.
export function assertRuntimeLayout(runtimeRoot) {
  const entries = [
    { path: nodeBinary(runtimeRoot), what: '随包 Node' },
    { path: organizerScript(runtimeRoot), what: 'organizer 入口' },
  ];
  const missing = entries.filter((entry) => !existsSync(entry.path));
  if (missing.length) {
    throw new Error(`runtime 根目录缺少 ${missing.map((entry) => entry.what).join('、')}：${runtimeRoot}`);
  }
  return true;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/// The audited runtime root, resolved from THIS module's own deployment
/// location — never from the configured `runtimeRoot` and never from a
/// manifest carried inside a runtime root. The server module is deployed
/// together with its runtime by the audited builder, so the co-deployed tree
/// is the only independent trusted source of the expected artifact identity:
///
///   * packaged bundle: `<bundle>/server/lib/worker-host.mjs` -> the runtime
///     co-deployed at `<bundle>/runtime`;
///   * source/test tree: `<repo>/server/lib/worker-host.mjs` -> `<repo>/runtime`
///     is the runtime SOURCE (no bundled `organizer.mjs`/`node`), so the
///     sanctioned bundle produced by `npm run probe:bundle` at
///     `<repo>/build/s0-runtime` is the audited runtime.
///
/// A root is only accepted when it carries the bundle shape (`organizer.mjs`
/// plus `node`); anything else resolves to null, which keeps every grant at
/// `unknown` rather than guessing.
export function trustedRuntimeRoot() {
  const base = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  for (const candidate of [join(base, 'runtime'), join(base, 'build', 's0-runtime')]) {
    if (existsSync(join(candidate, 'organizer.mjs')) && existsSync(join(candidate, 'node'))) return candidate;
  }
  return null;
}

/// The artifact identity of one runtime root: the real (symlink-resolved)
/// node binary and organizer entry with their SHA-256 content hashes. Any
/// unreadable or missing artifact yields null — an unidentified root is never
/// partially trusted.
export function runtimeArtifactIdentity(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || runtimeRoot === '') return null;
  try {
    const root = realpathSync(runtimeRoot);
    const node = realpathSync(nodeBinary(root));
    const entry = realpathSync(organizerScript(root));
    return { root, node, entry, nodeSha256: sha256File(node), entrySha256: sha256File(entry) };
  } catch {
    return null;
  }
}

/// The audited runtime identity — the expected artifact digests of the
/// runtime co-deployed with THIS module. Cached per PROCESS: the expectation
/// is derived from the module's own deployment location and never from any
/// configured root, so it is stable for the life of the process and caching
/// it can lend nothing to a configured path. Only the CONCLUSION about a
/// configured root is recomputed on every start (`verifyExecutionSource`).
let cachedAuditedIdentity = null;
let auditedIdentityResolved = false;
function auditedRuntimeIdentity() {
  if (!auditedIdentityResolved) {
    const expectedRoot = trustedRuntimeRoot();
    cachedAuditedIdentity = expectedRoot !== null ? runtimeArtifactIdentity(expectedRoot) : null;
    auditedIdentityResolved = true;
  }
  return cachedAuditedIdentity;
}

/// Bind the ACTUAL execution source of one start to the audited runtime the
/// server's own deployment carries. The configured `runtimeRoot` is resolved
/// (symlinks included) and its artifacts content-hashed on EVERY call: the
/// verdict is a per-start fact, never cached and never inherited, so a root
/// whose resolution changes between starts — a symlink re-pointed at a
/// synthetic tree, a file swapped under a stable path — can never borrow an
/// earlier start's conclusion. A private replacement factory, an explicit
/// `--runtime-root` override or any other root keeps WORKING (the worker
/// still spawns and runs) — only the trusted-path safety grant is withheld,
/// which routes the failure to `needs_review` instead of an automatic
/// re-queue.
export function verifyExecutionSource(runtimeRoot) {
  const actual = runtimeArtifactIdentity(runtimeRoot);
  const expectedRoot = trustedRuntimeRoot();
  // The expected identity is only worth resolving once the actual artifacts
  // exist: a configured root carrying no identifiable artifacts is untrusted
  // without hashing anything. The expectation itself is the cached audited
  // package identity above.
  const expected = actual !== null && expectedRoot !== null ? auditedRuntimeIdentity() : null;
  const trusted = actual !== null && expected !== null
    && actual.root === expected.root
    && actual.node === expected.node
    && actual.nodeSha256 === expected.nodeSha256
    && actual.entry === expected.entry
    && actual.entrySha256 === expected.entrySha256;
  const reason = trusted
    ? 'audited_deployment_runtime'
    : actual === null
      ? 'actual_artifacts_unidentified'
      : expectedRoot === null
        ? 'no_audited_runtime_resolved'
        : 'artifact_identity_mismatch';
  return {
    trusted,
    reason,
    runtimeRoot: actual?.root ?? null,
    node: actual?.node ?? null,
    entry: actual?.entry ?? null,
    nodeSha256: actual?.nodeSha256 ?? null,
    entrySha256: actual?.entrySha256 ?? null,
    expectedRoot,
  };
}

export class WorkerHost {
  constructor({ runtimeRoot, root, runLimitMs = DEFAULT_RUN_LIMIT_MS, processFactory = null, now = () => Date.now() }) {
    this.runtimeRoot = runtimeRoot;
    this.root = root;
    this.runLimitMs = runLimitMs;
    this.processFactory = processFactory;
    this.now = now;
    this.active = new Map();
    // Attempt registry memory layer (runId -> registry); the file under the
    // run workspace is the durable source. Additive state only — existing
    // fields and their semantics are untouched.
    this.attemptRegistries = new Map();
    // Stray keys already counted as "found" per attempt (survives reload via
    // the ledger rows' members).
    this.attemptDiscovered = new Map();
    // No per-host execution-source cache: the configured root's resolution is
    // re-verified at every start, so a root switched between starts (a symlink
    // re-pointed at a synthetic tree) can never inherit an earlier verdict.
    // Only the audited package's EXPECTED digests are cached, per process, in
    // `auditedRuntimeIdentity()` above.
  }

  workerRecordPath(runId) {
    return join(this.root, 'runs', runId, 'worker.json');
  }

  writeWorkerRecord(runId, record) {
    const path = this.workerRecordPath(runId);
    mkdirSync(join(this.root, 'runs', runId), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
  }

  // --- attempt registry & stray ledger (web-api/2 §12; producer layer) ---

  attemptRegistryPath(runId) {
    return join(this.root, 'runs', runId, 'attempt-registry.json');
  }

  strayLedgerPath(runId) {
    return join(this.root, 'runs', runId, 'stray-ledger.jsonl');
  }

  /// Load the registry for one attempt: memory first, then the persisted
  /// workspace file. Returns null when this attempt has no registry.
  loadAttemptRegistry(runId) {
    if (this.attemptRegistries.has(runId)) return this.attemptRegistries.get(runId);
    const path = this.attemptRegistryPath(runId);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      this.attemptRegistries.set(runId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  persistAttemptRegistry(runId) {
    const registry = this.attemptRegistries.get(runId);
    if (!registry) return;
    registry.updatedAt = new Date().toISOString();
    const path = this.attemptRegistryPath(runId);
    mkdirSync(join(this.root, 'runs', runId), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(registry, null, 2), { mode: 0o600 });
  }

  /// Register members from FRAME sources only. `candidates`:
  /// [{pid, sourceFrame: 'worker_frame'|'tool_owner_frame'|'exit_children_snapshot'|'ppid_walk', nonce?}].
  /// Each new pid is enriched once from a single process-table read (lifetime
  /// anchor: lstart + command). A pid missing from that read stays registered
  /// with an incomplete identity and is late-enriched (runId command-signature
  /// gated) on later reads — never from argv scan RESULTS, only from the
  /// frame that named it. Registration never removes or rewrites a member.
  registerAttemptMembers(runId, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.sourceFrame !== 'string' || !FRAME_SOURCE_ALLOWLIST.has(candidate.sourceFrame)) {
        throw new Error(`worker-host: registerAttemptMembers refused non-frame source ${JSON.stringify(candidate?.sourceFrame)}`);
      }
    }
    const registry = this.loadAttemptRegistry(runId);
    if (!registry) return;
    const known = new Set(registry.entries.map((entry) => entry.pid));
    const fresh = candidates.filter((candidate) => candidate
      && Number.isInteger(candidate.pid) && candidate.pid > 0 && !known.has(candidate.pid));
    if (fresh.length === 0) return;
    const table = processTable();
    const now = new Date().toISOString();
    for (const candidate of fresh) {
      const row = rowForPid(table, candidate.pid);
      registry.entries.push({
        pid: candidate.pid,
        identity: {
          lstart: row?.lstart ?? null,
          command: row?.command ?? null,
          nonce: candidate.nonce ?? null,
        },
        sourceFrame: candidate.sourceFrame,
        registeredAt: now,
        lifetimeSpan: { firstSeenAt: now, lastSeenAt: null },
      });
    }
    this.persistAttemptRegistry(runId);
  }

  /// Late enrichment for members whose registration-time table read missed
  /// them. The signature gate is strict: the occupant's command must carry
  /// this attempt's own `--run <runId>` marker, and lstart is adopted once,
  /// never overwritten afterwards.
  lateEnrichMembers(runId, table) {
    const registry = this.loadAttemptRegistry(runId);
    if (!registry || !table.ok) return;
    let changed = false;
    for (const entry of registry.entries) {
      if (entry.identity.lstart !== null) continue;
      const row = rowForPid(table, entry.pid);
      if (!row) continue;
      if (typeof row.command === 'string' && row.command.includes(`--run ${runId}`)) {
        entry.identity.lstart = row.lstart;
        if (entry.identity.command === null) entry.identity.command = row.command;
        changed = true;
      }
    }
    if (changed) this.persistAttemptRegistry(runId);
  }

  /// Read the raw append-only stray ledger. Returns `{rows, corrupt}`; a
  /// corrupt line makes the ledger unusable for evidence (the observation
  /// reports it instead of guessing).
  readStrayLedgerRows(runId) {
    const path = this.strayLedgerPath(runId);
    if (!existsSync(path)) return { rows: [], corrupt: null };
    try {
      const text = readFileSync(path, 'utf8');
      const rows = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        rows.push(JSON.parse(line));
      }
      return { rows, corrupt: null };
    } catch (error) {
      return { rows: [], corrupt: String(error?.message ?? error) };
    }
  }

  appendStrayLedgerRow(runId, row) {
    const path = this.strayLedgerPath(runId);
    mkdirSync(join(this.root, 'runs', runId), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  }

  /// Verify every registered member against one process-table snapshot.
  /// Returns the member observation list consumed by the pure judgment
  /// layer, plus whether the table itself was readable. Late enrichment of
  /// incomplete identities only runs against the REAL process table — an
  /// adapter-supplied table must never write synthetic rows into the
  /// persisted registry.
  verifyRegistryMembers(runId, table, { allowLateEnrich = true } = {}) {
    const registry = this.loadAttemptRegistry(runId);
    if (!registry) return { registry: null, members: [] };
    if (allowLateEnrich) this.lateEnrichMembers(runId, table);
    const members = registry.entries.map((entry) => {
      if (!table.ok) {
        return {
          pid: entry.pid,
          identity: entry.identity,
          sourceFrame: entry.sourceFrame,
          registeredAt: entry.registeredAt,
          observation: 'unobservable',
          evidence: `process table unavailable (errno ${table.errno ?? 'unknown'})`,
        };
      }
      const row = rowForPid(table, entry.pid);
      if (!row) {
        return {
          pid: entry.pid,
          identity: entry.identity,
          sourceFrame: entry.sourceFrame,
          registeredAt: entry.registeredAt,
          observation: 'extinct',
          evidence: 'pid absent from process table (lifetime identity vacated)',
        };
      }
      const match = proofMatchMember(entry, row);
      if (match.matched) {
        return {
          pid: entry.pid,
          identity: entry.identity,
          sourceFrame: entry.sourceFrame,
          registeredAt: entry.registeredAt,
          observation: 'alive',
          evidence: `proof-matched alive: ${identityToString(entry.identity)}`,
        };
      }
      const anchorsMissing = (typeof entry.identity.lstart !== 'string' || entry.identity.lstart === '')
        && (typeof entry.identity.command !== 'string' || entry.identity.command === '');
      return {
        pid: entry.pid,
        identity: entry.identity,
        sourceFrame: entry.sourceFrame,
        registeredAt: entry.registeredAt,
        observation: anchorsMissing ? 'unobservable' : 'identity_mismatch',
        evidence: match.why,
      };
    });
    return { registry, members };
  }

  /// One proof-matched stray sweep round. Appends exactly one cumulative
  /// ledger row. A sweep kills a member ONLY after its live occupant
  /// proof-matches the registered identity; identity mismatches are never
  /// touched. When the process table cannot be read the counters are carried
  /// forward unchanged — a pending stray is never erased by an unobservable
  /// round. Options (test seams, always labeled in the row):
  ///   kill: 'real' (default) | 'deny' (simulated denial adapter)
  ///   psTable: () => table   (simulated table adapter)
  ///   now: () => iso
  async runStraySweep(runId, { kill = 'real', psTable = null, now = () => new Date().toISOString() } = {}) {
    const registry = this.loadAttemptRegistry(runId);
    if (!registry) return { error: 'unknown_attempt' };
    const { rows, corrupt } = this.readStrayLedgerRows(runId);
    if (corrupt) return { error: 'stray_ledger_corrupt', detail: corrupt };
    let disclosure;
    try {
      disclosure = aggregateStrayLedger(rows) ?? { found: 0, swept: 0, pending: 0 };
    } catch (error) {
      // Semantic corruption (monotonicity/seq/arithmetic) is the same class
      // of evidence corruption as a JSON-corrupt line: report it through the
      // same error shape instead of throwing into the caller.
      return { error: 'stray_ledger_corrupt', detail: String(error?.message ?? error) };
    }
    const seq = rows.length > 0 ? rows[rows.length - 1].sweepSeq : 0;

    const table = typeof psTable === 'function' ? psTable() : processTable();
    if (!table.ok) {
      // Unobservable round: counters copied forward verbatim.
      const row = {
        attemptId: registry.attemptId,
        runId,
        sweepSeq: seq + 1,
        sweptAt: now(),
        found: disclosure.found,
        swept: disclosure.swept,
        pending: disclosure.pending,
        members: [],
        evidenceScope: 'registry_domain',
        notes: [`process table unavailable (errno ${table.errno ?? 'unknown'}); counters carried forward, pending not overwritten`],
      };
      this.appendStrayLedgerRow(runId, row);
      return { row, disclosure: { found: row.found, swept: row.swept, pending: row.pending } };
    }

    const discovered = new Set(this.attemptDiscovered.get(runId) ?? []);
    for (const row of rows) {
      for (const member of row.members ?? []) discovered.add(member.key);
    }

    const memberNotes = [];
    let found = disclosure.found;
    let swept = disclosure.swept;
    const killedKeys = new Set();

    // Pass 1: classify members against the table.
    const classifications = new Map();
    for (const entry of registry.entries) {
      const row = rowForPid(table, entry.pid);
      const key = `${entry.pid}:${entry.identity.lstart ?? 'unknown'}`;
      if (!row) {
        classifications.set(entry.pid, { state: 'absent', entry, key });
        continue;
      }
      const match = proofMatchMember(entry, row);
      classifications.set(entry.pid, match.matched
        ? { state: 'alive', entry, key, row }
        : { state: 'mismatch', entry, key, row, why: match.why });
    }

    // Pass 2: count newly discovered strays and proof-matched kill.
    for (const classification of classifications.values()) {
      if (classification.state !== 'alive') continue;
      if (!discovered.has(classification.key)) {
        discovered.add(classification.key);
        found += 1;
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: 'discovered alive (proof-matched)' });
      }
      if (kill === 'deny') {
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: 'kill denied by simulated kill-denial adapter' });
        continue;
      }
      try {
        process.kill(classification.entry.pid, 'SIGKILL');
        killedKeys.add(classification.key);
      } catch (error) {
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: `kill failed (errno ${error?.code ?? 'unknown'})` });
      }
    }
    // Identity mismatches: never killed, never swept — recorded verbatim.
    for (const classification of classifications.values()) {
      if (classification.state === 'mismatch') {
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: `identity mismatch, not touched: ${classification.why}` });
      }
    }

    // Pass 3: re-observe proof-matched kills with a bounded wait (a SIGKILLed
    // process can linger in the table until reaped; only a table absence or a
    // matching identity's disappearance confirms the sweep).
    let confirmTable = table;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const stillListed = [...killedKeys].filter((key) => {
        const pid = Number(key.split(':')[0]);
        const row = rowForPid(confirmTable, pid);
        if (!row) return false;
        const entry = registry.entries.find((candidate) => candidate.pid === pid);
        return entry ? proofMatchMember(entry, row).matched : true;
      });
      if (stillListed.length === 0) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      confirmTable = processTable();
    }
    for (const classification of classifications.values()) {
      if (classification.state !== 'alive' || !killedKeys.has(classification.key)) continue;
      const row = rowForPid(confirmTable, classification.entry.pid);
      const match = row ? proofMatchMember(classification.entry, row) : { matched: false };
      if (!row || !match.matched) {
        swept += 1;
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: 'swept: killed after proof-match, exit confirmed' });
      } else {
        memberNotes.push({ key: classification.key, pid: classification.entry.pid, identity: identityToString(classification.entry.identity), evidence: 'kill issued but exit not confirmed; stays pending' });
      }
    }

    const pending = found - swept;
    const row = {
      attemptId: registry.attemptId,
      runId,
      sweepSeq: seq + 1,
      sweptAt: now(),
      found,
      swept,
      pending,
      members: memberNotes,
      evidenceScope: 'registry_domain',
      notes: kill === 'deny' ? ['simulated kill-denial adapter round'] : [],
    };
    this.attemptDiscovered.set(runId, [...discovered]);
    this.appendStrayLedgerRow(runId, row);
    return { row, disclosure: { found, swept, pending } };
  }

  /// Typed exit observation — the web-api/2 §3.1.1 producer entry point.
  /// Completely separate from the V1 boolean surface (`verifyTree`,
  /// `confirmExit`, `done.treeVerified`): consumers adopt it explicitly.
  /// Options (all optional; the real OS is used when a seam is omitted):
  ///   argvScan: 'perform' (default) | 'skip' (null scan face) | fn adapter
  ///   groupProbe: fn adapter returning {face, simulated}
  ///   psTable: fn adapter returning a process table
  ///   now: () => iso
  async observeAttemptExit(runId, { argvScan = 'perform', groupProbe = null, psTable = null, now = () => new Date().toISOString() } = {}) {
    const entry = this.active.get(runId) ?? null;
    let record = entry?.record ?? null;
    if (!record) {
      const path = this.workerRecordPath(runId);
      if (!existsSync(path)) return { attemptExitEvidence: null, reason: 'unknown_attempt' };
      try {
        record = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        return { attemptExitEvidence: null, reason: 'worker_record_unreadable' };
      }
    }

    const { rows, corrupt } = this.readStrayLedgerRows(runId);
    if (corrupt) return { attemptExitEvidence: null, reason: 'stray_ledger_corrupt', detail: corrupt };
    let strayLedger;
    try {
      strayLedger = aggregateStrayLedger(rows);
    } catch (error) {
      return { attemptExitEvidence: null, reason: 'stray_ledger_corrupt', detail: String(error?.message ?? error) };
    }

    // Worker exit: prefer the observed exit event on a live handle; on a
    // recovery observation fall back to the lifetime-anchored process table
    // (the worker member's registered identity), never to a bare pid check.
    let workerExited = false;
    if (entry) {
      if (!entry.state.exited) {
        await entry.done;
      }
      workerExited = entry.state.exited === true
        && Number.isInteger(record.pid)
        && !entry.state.spawnError;
    } else {
      const table = typeof psTable === 'function' ? psTable() : processTable();
      const registry = this.loadAttemptRegistry(runId);
      const workerMember = registry?.entries.find((candidate) => candidate.pid === record.pid) ?? null;
      if (workerMember && workerMember.identity.lstart) {
        const row = table.ok ? rowForPid(table, record.pid) : null;
        workerExited = row === null || row.lstart !== workerMember.identity.lstart;
      } else {
        workerExited = !processIsAlive(record.pid);
      }
    }

    // Group observation: absence ONLY from ESRCH; a denied or failed probe
    // is never recorded as absent.
    let face;
    let simulated = false;
    if (typeof groupProbe === 'function') {
      const probe = groupProbe();
      face = probe.face;
      simulated = probe.simulated === true;
    } else if (Number.isInteger(record.pgid) && record.pgid > 0) {
      try {
        process.kill(-record.pgid, 0);
        face = 'alive';
      } catch (error) {
        face = error?.code === 'ESRCH' ? 'esrch' : error?.code === 'EPERM' ? 'eperm' : 'failed';
      }
    } else {
      face = 'failed';
    }

    const table = typeof psTable === 'function' ? psTable() : processTable();
    const { registry, members } = this.verifyRegistryMembers(runId, table);

    let scan;
    if (argvScan === 'skip') {
      scan = null;
    } else if (typeof argvScan === 'function') {
      scan = argvScan();
    } else if (!table.ok) {
      scan = { performed: false, errno: table.errno ?? null, message: table.message };
    } else {
      const hits = table.rows
        .filter((row) => typeof row.command === 'string' && row.command.includes(`--run ${runId}`))
        .map((row) => ({ pid: row.pid, command: row.command }));
      scan = { performed: true, hits };
    }

    const evidence = buildAttemptExitEvidence({
      workerExited,
      groupObservation: face,
      members,
      argvScan: scan,
      strayLedger,
      simulated,
    }, { now });

    // Invariant 6: verdict migration has one direction. Guarded in-memory for
    // live handles; consumers re-verifying persisted evidence must enforce it
    // with `assertVerdictTransition`.
    const previous = entry?.state.attemptExitVerdict ?? null;
    assertVerdictTransition(previous ?? undefined, evidence.verdict);
    if (entry) entry.state.attemptExitVerdict = evidence.verdict;

    const violations = validateAttemptExitEvidence(evidence);
    if (violations.length > 0) {
      throw new Error(`attempt-exit-evidence: emitted evidence failed validation: ${violations.join('; ')}`);
    }

    return {
      attemptExitEvidence: evidence,
      registry: registry ? {
        attemptId: registry.attemptId,
        epoch: registry.epoch ?? null,
        entries: registry.entries,
        updatedAt: registry.updatedAt,
      } : null,
      ledgerAggregate: strayLedger,
      workerRecord: {
        runId: record.runId,
        attemptId: record.attemptId,
        taskId: record.taskId,
        pid: record.pid,
        pgid: record.pgid,
      },
    };
  }

  /// Persist-only registry touch for the cancel/deadline/stopAll hooks
  /// (§12: those hooks update the registry). Never throws into the caller.
  touchAttemptRegistry(runId) {
    try {
      if (this.attemptRegistries.has(runId)) this.persistAttemptRegistry(runId);
    } catch {
      // registry bookkeeping must never break a deadline/cancel path
    }
  }

  /// Start a worker for one attempt.
  ///
  /// `onFrame(frame)` is optional and may return a promise: after identity
  /// filtering, frames are handled strictly in arrival order and each
  /// persistence step is awaited before the next frame is processed. This is
  /// the staging hook — the result frame is persisted while the worker may
  /// still be running.
  ///
  /// `onRejectedFrame({reason})` is optional and may return a promise: it runs
  /// on the SAME ordered queue when a frame is dropped by the transport
  /// identity fence, so the caller can audit the rejection in arrival order
  /// (frozen web-api/1 §3.3). The frame itself is never decoded into a
  /// result, and its bytes, nonce and payload never cross this boundary.
  start({ task, attemptId, snapshot, credential, onFrame = null, onRejectedFrame = null, attemptEpoch = null }) {
    const runId = `run_${randomBytes(12).toString('hex')}`;
    const hostNonce = randomBytes(24).toString('hex');
    // The execution-source identity is resolved and content-hashed at EVERY
    // start (never cached, never inherited from an earlier run): the verdict
    // about this host's configured runtimeRoot is a per-run fact, while the
    // audited package's expected digests are the cached ones. The REAL
    // (symlink-resolved) paths it carries are what gets spawned below, so the
    // run record always matches the artifacts that actually executed.
    const executionSource = verifyExecutionSource(this.runtimeRoot);
    const input = task.inputRef ?? {};
    const kind = task.type;
    const timeZone = input.source?.timeZone ?? 'UTC';
    const request = {
      runId,
      hostNonce,
      kind,
      snapshot,
      anchorAtMs: input.anchorAtMs ?? this.now(),
      timeZone,
      apiKey: credential ?? '',
      cwd: this.root,
      runLimitMs: this.runLimitMs,
    };
    // The runtime reads `request.source.timeZone` for date resolution on every
    // kind, and `request.source.rawText` for evidence checks on extract.
    request.source = kind === 'extract'
      ? { rawText: input.source?.text ?? '', timeZone }
      : { rawText: '', timeZone };
    if (kind === 'revise') {
      request.candidate = { draft: input.candidate ?? {} };
      request.instruction = input.instruction ?? '';
    }

    const state = {
      runId,
      hostNonce,
      attemptId,
      taskId: task.taskId,
      result: null,
      errorFrame: null,
      frameQueue: Promise.resolve(),
      frameFailures: [],
      exited: false,
      deadlineTimer: null,
      deadlineTriggered: false,
      registryTimer: null,
      children: null,
      spawnError: null,
      receipts: [],
      openBegins: new Map(),
      // Execution-source facts for the scheduler's trusted-path safety proof:
      // whether a PRIVATE replacement factory spawned this worker (the default
      // factory spawns the configured runtime root itself), and whether the
      // ACTUAL artifacts that were spawned — the real node binary and the
      // organizer entry, resolved and content-hashed at THIS start — are
      // identical to the audited runtime the server's own deployment carries.
      // Both are per run and never consumed.
      replacementFactory: this.processFactory != null,
      executionSource,
      toolFrames: 0,
      mcpFrames: 0,
      workerFrames: 0,
    };

    let child;
    const launcher = this.processFactory ?? spawn;
    try {
      // Layout is a hard spawn prerequisite for the DEFAULT factory — the one
      // that really executes `<runtimeRoot>/node` (a missing binary or entry is
      // a typed `runtime_start` failure). A private replacement factory owns
      // its own payload binary, so the configured root's layout says nothing
      // about what it spawns and must never gate it: the private replacement
      // interface keeps working, and only the safety grant is withheld.
      // Neither check is a safety verdict — the trusted-artifact binding is.
      if (this.processFactory == null) assertRuntimeLayout(this.runtimeRoot);
      // Execute the VERIFIED artifacts: the real (symlink-resolved) node and
      // entry that were just hashed, never a re-derivation from the configured
      // string — otherwise a root switched between hashing and spawning would
      // run bytes the record never covered. An unidentified root falls back to
      // the configured paths; the grant is withheld regardless, so the record
      // never claims an identity it did not check.
      const nodePath = executionSource.node ?? nodeBinary(this.runtimeRoot);
      const entryPath = executionSource.entry ?? organizerScript(this.runtimeRoot);
      // The 4th argument carries the attempt's transport identity for PRIVATE
      // replacement factories (the default `spawn` ignores extra arguments).
      // Frames emitted by a runtime are only accepted across the stdio fence
      // when they carry this pair (§web-api/1 3.3 lineage), so tool-owner
      // registration is bound to fence-valid frames.
      child = launcher(
        nodePath,
        [entryPath, '--run', runId],
        {
          cwd: this.root,
          env: {
            PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            TMPDIR: this.root,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        },
        { runId, hostNonce },
      );
    } catch (error) {
      // Synchronous spawn failure: surface it as an unverified, typed outcome.
      state.spawnError = { message: String(error?.message ?? error) };
      state.exited = true;
      const record = {
        runId, hostNonce, attemptId, taskId: task.taskId, pid: null, pgid: null,
        children: [], startedAt: this.now(),
        executionSource: {
          trusted: state.executionSource.trusted,
          reason: state.executionSource.reason,
          runtimeRoot: state.executionSource.runtimeRoot,
          node: state.executionSource.node,
          entry: state.executionSource.entry,
          nodeSha256: state.executionSource.nodeSha256,
          entrySha256: state.executionSource.entrySha256,
        },
      };
      this.writeWorkerRecord(runId, record);
      // Registry lifecycle hook (spawn failure): the attempt workspace gets a
      // registry with zero members — there was never a process to register,
      // so exit confirmation stays honestly unresolvable.
      this.attemptRegistries.set(runId, {
        attemptId,
        epoch: attemptEpoch ?? null,
        runId,
        entries: [],
        updatedAt: new Date().toISOString(),
      });
      this.persistAttemptRegistry(runId);
      state.record = record;
      const done = Promise.resolve({
        outcome: 'failed',
        payload: { code: 'runtime_start', message: '未能启动随包整理进程。', retryable: 'manual', sideEffectSafety: 'unknown' },
        code: null,
        stderr: '',
        treeVerified: false,
        spawnError: state.spawnError,
      });
      this.active.set(runId, { state, child: null, done, record });
      return { runId, hostNonce, attemptId, done, cancel: () => {}, record, state };
    }

    const record = {
      runId,
      hostNonce,
      attemptId,
      taskId: task.taskId,
      pid: child.pid,
      // `detached` makes the child a process-group leader, so the group id
      // identifies the whole worker tree for exit verification.
      pgid: child.pid,
      children: [],
      startedAt: this.now(),
      // The actual execution-source identity this run was spawned with: the
      // real (symlink-resolved) node binary and organizer entry — the same
      // paths the default factory executes — resolved and content-hashed at
      // THIS start, plus whether they are the audited deployment runtime.
      // This is the audit trail the trusted-path safety grant is bound to.
      executionSource: {
        trusted: state.executionSource.trusted,
        reason: state.executionSource.reason,
        runtimeRoot: state.executionSource.runtimeRoot,
        node: state.executionSource.node,
        entry: state.executionSource.entry,
        nodeSha256: state.executionSource.nodeSha256,
        entrySha256: state.executionSource.entrySha256,
      },
    };
    state.record = record;
    this.writeWorkerRecord(runId, record);
    // Registry lifecycle hook (spawn): the worker's own frame is the first
    // member — frame source, lifetime identity enriched from the process
    // table when available. Registration always precedes observation; an
    // argv scan result can never create a registry member.
    this.attemptRegistries.set(runId, {
      attemptId,
      epoch: attemptEpoch ?? null,
      runId,
      entries: [],
      updatedAt: new Date().toISOString(),
    });
    this.registerAttemptMembers(runId, [{ pid: child.pid, sourceFrame: 'worker_frame', nonce: hostNonce }]);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        // Both halves of the fencing pair must match: a frame from another run
        // (or a forged nonce) is dropped, never decoded into a result.
        if (frame.runId !== runId || frame.hostNonce !== hostNonce) {
          // The drop is AUDITED, not silent: the rejection hook runs on the
          // same ordered queue as the staging hook, so the audit keeps frame
          // arrival order (a rejected frame is audited before any later frame
          // of this attempt is staged). Only the fact and the reason cross —
          // the stale identity values themselves are not persisted.
          if (typeof onRejectedFrame === 'function') {
            state.frameQueue = state.frameQueue
              .then(() => onRejectedFrame({ reason: 'attempt_identity' }))
              .catch((error) => {
                state.frameFailures.push({ at: this.now(), message: String(error?.message ?? error) });
              });
          }
          continue;
        }
        // Execution-path facts for the trusted-path safety proof: the audited
        // no-tool/no-MCP `test` path emits none of these frames, so any of
        // them disproves the proof precondition for this run.
        if (frame.type === 'mcp') state.mcpFrames += 1;
        else if (frame.type === 'progress' && frame.phase === 'tool') state.toolFrames += 1;
        else if (frame.type === 'worker') {
          state.workerFrames += 1;
          // Registry lifecycle hook (tool-owner frame): a runtime `worker`
          // frame names a tool-owner process — register it from THIS frame
          // source with its lifetime anchor. Best-effort and deduped; a
          // frame without a usable pid registers nothing.
          const framePid = frame.pid ?? frame.workerPid ?? null;
          if (Number.isInteger(framePid) && framePid > 0) {
            this.registerAttemptMembers(runId, [{ pid: framePid, sourceFrame: 'tool_owner_frame', nonce: frame.nonce ?? frame.hostNonce ?? null }]);
          }
        }
        if (typeof onFrame === 'function') {
          // Ordered, awaited persistence: the staging write happens now, while
          // the worker may still be running.
          state.frameQueue = state.frameQueue
            .then(() => onFrame(frame))
            .catch((error) => {
              state.frameFailures.push({ at: this.now(), message: String(error?.message ?? error) });
            });
        }
        for (const fact of receiptFactsFor(frame, state)) state.receipts.push(fact);
        if (frame.type === 'result') state.result = frame.data;
        else if (frame.type === 'error') state.errorFrame = frame;
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const done = new Promise((resolve) => {
      state.resolveDone = (value) => resolve(value);
    });
    state.finish = (outcome, payload) => {
      if (state.exited) return;
      state.exited = true;
      if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
      if (state.registryTimer) clearInterval(state.registryTimer);
      // Observing this one process exit does not prove the whole tree is gone.
      const children = childPids(record.pid);
      if (children !== null) record.children = children;
      state.children = record.children;
      // Registry lifecycle hook (exit): register the direct-children
      // snapshot and the best-effort recursive ppid walk as members, then
      // close the lifetime span of members. The direct children array above
      // keeps feeding verifyTree exactly as before — discoveries here extend
      // the registry, they never change the V1 boolean surface.
      try {
        const table = processTable();
        const knownPids = this.loadAttemptRegistry(runId)?.entries.map((candidate) => candidate.pid) ?? [];
        const walk = walkDescendants(table, [record.pid, ...(Array.isArray(record.children) ? record.children : []), ...knownPids]);
        if (walk.ok) {
          const directSet = new Set(Array.isArray(record.children) ? record.children : []);
          const candidates = walk.pids
            .filter((pid) => pid !== record.pid)
            .map((pid) => ({
              pid,
              sourceFrame: directSet.has(pid) ? 'exit_children_snapshot' : 'ppid_walk',
            }));
          this.registerAttemptMembers(runId, candidates);
          const registry = this.loadAttemptRegistry(runId);
          if (registry) {
            for (const registryEntry of registry.entries) {
              if (registryEntry.lifetimeSpan.lastSeenAt === null) {
                registryEntry.lifetimeSpan.lastSeenAt = new Date().toISOString();
              }
            }
            this.persistAttemptRegistry(runId);
          }
        }
      } catch {
        // registry bookkeeping must never break the exit path
      }
      this.writeWorkerRecord(runId, record);
      const treeVerified = verifyTree(record);
      // Report the exit fact only after the exit and every prior frame's
      // persistence step have settled.
      state.frameQueue.then(() => {
        state.resolveDone({
          outcome,
          payload,
          code: child.exitCode,
          stderr: stderr.trim(),
          treeVerified,
          deadlineTriggered: state.deadlineTriggered,
          frameFailures: state.frameFailures.slice(),
        });
      });
    };

    child.on('error', () => {
      state.spawnError = { message: 'worker process error' };
      state.finish('failed', { code: 'runtime_start', message: '未能启动随包整理进程。', retryable: 'manual', sideEffectSafety: 'unknown' });
    });
    child.on('exit', () => {
      if (state.result) return state.finish('succeeded', state.result);
      if (state.errorFrame) return state.finish('failed', { code: state.errorFrame.code ?? 'runtime_exit', message: state.errorFrame.message ?? '整理进程返回错误。' });
      return state.finish('failed', { code: 'runtime_exit', message: '整理进程未返回结果。' });
    });

    // Backend-side independent deadline: the runtime also enforces its own
    // limit, but the backend must not depend on it.
    state.deadlineTimer = setTimeout(() => {
      if (state.exited) return;
      state.deadlineTriggered = true;
      void this.enforceDeadline(state);
    }, Math.max(1, this.runLimitMs));
    if (state.deadlineTimer.unref) state.deadlineTimer.unref();

    const cancel = () => {
      try {
        child.stdin.write(`${JSON.stringify({ type: 'cancel', runId, hostNonce })}\n`);
      } catch {
        // The child may already be gone.
      }
    };
    state.cancel = cancel;

    // Registry lifecycle hook (periodic best-effort registration): while the
    // worker runs, walk the ppid graph from the worker pid every 150ms and
    // register newly appeared descendants BEFORE the worker's death can
    // reparent them out of reach. Best-effort only — a descendant spawned
    // between two walks can still escape registration, which is exactly the
    // disclosed residual the stray ledger exists for.
    state.registryTimer = setInterval(() => {
      try {
        const table = processTable();
        if (!table.ok) return;
        const registry = this.loadAttemptRegistry(runId);
        if (!registry) return;
        const roots = [record.pid, ...registry.entries.map((candidate) => candidate.pid)];
        const walk = walkDescendants(table, roots);
        if (!walk.ok) return;
        const known = new Set(registry.entries.map((candidate) => candidate.pid));
        const candidates = walk.pids
          .filter((pid) => pid !== record.pid && !known.has(pid))
          .map((pid) => ({ pid, sourceFrame: 'ppid_walk' }));
        this.registerAttemptMembers(runId, candidates);
      } catch {
        // best-effort only
      }
    }, 150);
    if (state.registryTimer.unref) state.registryTimer.unref();

    this.active.set(runId, { state, child, done, record });
    try {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    } catch {
      // The child may have exited before the request was written.
    }
    return { runId, hostNonce, attemptId, done, cancel, record, state };
  }

  /// Backend deadline enforcement: identity-bearing cancel frame, a grace
  /// window, then termination of the worker's own process group. The exit is
  /// still confirmed through `done` — the kill is not treated as proof.
  async enforceDeadline(state) {
    if (state.exited) return;
    // Registry lifecycle hook (deadline): record the touch before enforcing.
    this.touchAttemptRegistry(state.runId);
    try {
      state.child.stdin.write(`${JSON.stringify({ type: 'cancel', runId: state.runId, hostNonce: state.hostNonce })}\n`);
    } catch {
      // already gone
    }
    await new Promise((r) => setTimeout(r, DEADLINE_GRACE_MS));
    if (state.exited) return;
    try {
      process.kill(-state.record.pgid, 'SIGTERM');
    } catch {
      // group already gone
    }
    await new Promise((r) => setTimeout(r, DEADLINE_GRACE_MS));
    if (state.exited) return;
    try {
      process.kill(-state.record.pgid, 'SIGKILL');
    } catch {
      // group already gone
    }
  }

  cancel(runId) {
    const entry = this.active.get(runId);
    if (!entry) return false;
    entry.state.cancel?.();
    return true;
  }

  /// Confirm a worker's exit. A missing handle, a missing identity record or a
  /// tree that cannot be verified is reported as UNVERIFIED — never assumed to
  /// have exited. The record is kept until the tree is verified.
  async confirmExit(runId) {
    const entry = this.active.get(runId);
    if (!entry) return { exited: false, reason: 'unknown_handle' };
    if (!Number.isInteger(entry.record?.pid) || !Number.isInteger(entry.record?.pgid)) {
      return { exited: false, reason: 'missing_identity' };
    }
    const outcome = await entry.done;
    if (outcome.treeVerified === false) {
      return { exited: false, reason: 'tree_unverified', outcome };
    }
    this.active.delete(runId);
    return { exited: true, treeVerified: true, outcome };
  }

  /// Bounded, verified shutdown: cancel every registered own process, give each
  /// a grace window, terminate the survivors, then wait for each exit. Records
  /// whose tree cannot be verified are kept.
  async stopAll() {
    const entries = [...this.active.values()];
    // Registry lifecycle hook (stopAll): touch every registered attempt.
    for (const entry of entries) this.touchAttemptRegistry(entry.record.runId);
    for (const entry of entries) {
      try {
        entry.child?.stdin.write(`${JSON.stringify({ type: 'cancel', runId: entry.record.runId, hostNonce: entry.record.hostNonce })}\n`);
      } catch {
        // already gone
      }
    }
    await new Promise((r) => setTimeout(r, DEADLINE_GRACE_MS));
    for (const entry of entries) {
      if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
        try {
          process.kill(-entry.record.pgid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
    }
    await new Promise((r) => setTimeout(r, DEADLINE_GRACE_MS));
    for (const entry of entries) {
      if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
        try {
          process.kill(-entry.record.pgid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    for (const entry of entries) {
      try {
        const outcome = await entry.done;
        if (outcome.treeVerified !== false) this.active.delete(entry.record.runId);
      } catch {
        // keep the record; the tree stays unverified
      }
    }
  }
}

export function defaultRuntimeRoot() {
  return join(process.cwd(), 'build', 'web-backend', 'runtime');
}
