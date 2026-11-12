//! HTTP transport for the Web backend (`web-api/2`).
//!
//! The browser talks to the same-origin backend host: session cookie plus CSRF
//! token on writes, frozen error envelope, and `operationId`/`expectedVersion`
//! carried through to the manual-item endpoints. The domain logic in
//! `src/domain/todos.ts` stays untouched.
//!
//! V2 identification (frozen web-api/2 §1): every JSON response body — task
//! resources, settings, session, error envelope, snapshot — carries
//! `contractVersion: "web-api/2"`, and this transport REJECTS anything else
//! outright (V1, missing, malformed). There is no fallback and no V1
//! compatibility shim: a V1 response can never land as evidence. The V2-only
//! `attemptExitEvidence` typed shape (§3.1.1) is validated structurally
//! (including its normative invariants) before it reaches a store, and
//! invalid/missing evidence stays rejected with a readable reason — it is
//! never silently coerced into a truthy object or a legacy boolean.

import type { Todo, TodoInput, TodoEvent, TimePoint, WorkspaceInfo } from '../domain/todos.ts';
import type {
  Candidate,
  ModelRun,
  TextSource,
  ImportBatch,
  BatchSummary,
  SignChoice,
  ModelConfiguration,
  Provider,
  ModelDefinition,
} from '../domain/organizer.ts';
import type { AgentConfig, AgentId } from '../domain/agents.ts';

export interface WirePoint {
  at: string;
  timeZone: string;
  localText: string;
  precision: 'minute' | 'day';
}

export interface WireItem {
  contractVersion: 'web-api/2';
  itemId: string;
  title: string;
  kind: 'action' | 'followup';
  owner: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'completed' | 'deleted';
  due: WirePoint | null;
  followup: WirePoint | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  version: number;
  source: 'manual' | 'signed_ai';
}

interface WireWorkspace {
  root: string | null;
  needsSetup: boolean;
  pendingRoot: string | null;
  capabilities: string[];
}

export interface WireSource {
  sourceId: string;
  fingerprint: string;
  kind: string;
  rawText: string;
  /// C4: the source anchor is the shared `{at,timeZone,localText,precision}`
  /// date point, NOT a millisecond number. The read-back binds to the FIRST
  /// task's immutable `input_ref` because the three source columns cannot carry
  /// `localText`/`precision`; a source whose first task (or its point) is missing
  /// falls back to the columns with the unknown parts left null, so `localText`
  /// is legitimately null and must never be presented as the user's words.
  sourceAt: WirePoint | null;
  importedAtMs: number;
  anchorAtMs: number;
  timeZone: string;
  succeededRunId: string | null;
}

/// Frozen W1 contract §5.1: the candidate wire row is FLAT — `fields`,
/// `evidence`, `dueExpression`, `followupExpression`, `warnings` and
/// `unresolved` are top-level members of the candidate object. `fields` carries
/// the internal domain `TimePoint` (`{atMs,timeZone,localText,precision}`), so
/// the read path needs no date conversion.
/// Frozen W1 contract §7: the provider capability view returned by
/// `GET /api/providers`. It never carries a secret value — only the credential
/// REFERENCE identity and its live status, whose vocabulary is exactly
/// `available | missing | unavailable`.
export interface WireCredentialRef {
  ref: string;
  status: 'available' | 'missing' | 'unavailable';
  detail?: string | null;
}

export interface WireProviderCapability {
  providerId: string;
  enabled: boolean;
  authMode: string;
  apiFormat?: string;
  credentialRefs: WireCredentialRef[];
}

export interface WireProviderCapabilities {
  providers: WireProviderCapability[];
}

/// Editable `fields` on the wire: the domain `TodoInput` with the two date
/// points on the shared DatePoint line instead of the internal `TimePoint`.
/// Everything else is identical, so a bridge between the two only touches the
/// two points.
export type WireFields = Omit<TodoInput, 'due' | 'followup'> & {
  due: WirePoint | null;
  followup: WirePoint | null;
};

export interface WireCandidate {
  candidateId: string;
  sourceId: string;
  runId: string;
  ordinal: number;
  status: 'staged' | 'pending' | 'accepted' | 'discarded';
  version: number;
  /// Flat, unlike the preview row. `due`/`followup` are DatePoints (§1).
  fields: WireFields;
  evidence: string;
  dueExpression: string | null;
  followupExpression: string | null;
  warnings: string[];
  unresolved: boolean;
  acceptedItemId: string | null;
  processedAt: string | null;
}

export interface WirePreview {
  previewId: string;
  candidateId: string;
  runId: string;
  candidateVersion: number;
  /// Unlike the candidate row (§5.1 flat), the preview row nests its editable
  /// content under `draft`; `fields` carries DatePoints, exactly like the
  /// candidate row's flat `fields`.
  draft: {
    fields: WireFields;
    evidence: string;
    dueExpression: string | null;
    followupExpression: string | null;
    warnings: string[];
    unresolved: boolean;
  };
  createdAt: string;
}

/// Frozen web-api/2 §3.1.1: the typed exit-evidence object. All members are
/// REQUIRED unless marked nullable; a client must not depend on undeclared
/// members. The struct is validated (including the normative invariants)
/// before it is mapped into a store row — malformed, missing or
/// self-contradictory evidence never becomes a truthy object on this side.
export type AttemptExitVerdict = 'registry_extinct' | 'unresolved';

export type AttemptExitVetoReason = 'known_survivor' | 'insufficient_evidence' | 'identity_mismatch' | 'eperm';

export interface WireRegistrySurvivor {
  pid: number;
  identity: string;
  evidence: string;
}

export interface WireStrayLedger {
  found: number;
  swept: number;
  pending: number;
}

export interface WireAttemptExitEvidence {
  verdict: AttemptExitVerdict;
  workerExited: boolean;
  groupAbsent: boolean;
  registry: {
    total: number;
    confirmedExtinct: number;
    unobservable: number;
    survivors: WireRegistrySurvivor[];
  };
  /// `null` = the scan did not run this round (§3.1.1). A `performed: false`
  /// row records a failed/refused scan. Either non-performing form vetoes.
  argvScan: { performed: boolean; hits: number } | null;
  veto: { triggered: boolean; reason: AttemptExitVetoReason | null; detail: string | null };
  /// `treeExtinctProven` is the normative literal `false` — any other value
  /// (in particular `true`) is self-contradictory and rejected.
  residual: { treeExtinctProven: false; scope: string; strayLedger: WireStrayLedger | null };
  /// Non-null ⇔ `verdict === 'registry_extinct'`.
  confirmedAt: string | null;
}

export interface WireTask {
  contractVersion: 'web-api/2';
  taskId: string;
  operationId: string;
  type: string;
  role: string;
  state: 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'needs_review';
  version: number;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  submitSeq: number;
  queuePosition: number | null;
  attemptCount: number;
  attemptId: string | null;
  attemptExitState: string;
  /// V2 §3.1: non-null exactly when `attemptExitState` is `exited_unknown` /
  /// `exited_confirmed`; null for `not_started`/`active`/`exiting`. Preserved
  /// with the task (terminal states do not clear it).
  attemptExitEvidence: WireAttemptExitEvidence | null;
  cancelIntent: boolean;
  configRevision: string;
  originalConfigRevision: string;
  inputRef: Record<string, unknown>;
  progress: unknown;
  result: unknown;
  resultPendingExit: boolean;
  failure: { code: string; message: string; retryable: string; sideEffectSafety: string; cause?: string } | null;
  recovery: Record<string, unknown> | null;
}

export interface ParsedExitEvidence {
  /// The validated typed evidence, or null when the wire evidence is absent
  /// or untrustworthy.
  evidence: WireAttemptExitEvidence | null;
  /// A readable reason when the evidence was rejected, else null. A non-null
  /// error FAILS CLOSED: dispositions must stay disabled and the UI must show
  /// the rejection, never a guessed state.
  error: string | null;
}

const isWireInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isIsoString = (value: unknown): value is string => typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));

/// Frozen web-api/2 §3.1: every member of the task resource. §6.1 member 1
/// promises the snapshot carries FULL-FIELD §3.1 task resources — a trimmed
/// row (a member simply absent) violates the same-shape goal and is rejected.
/// Presence is the gate; nullability follows the §3.1 table.
const TASK_RESOURCE_MEMBERS = [
  'contractVersion', 'taskId', 'operationId', 'type', 'role', 'state', 'version',
  'createdAt', 'updatedAt', 'terminalAt', 'submitSeq', 'queuePosition',
  'attemptCount', 'attemptId', 'attemptExitState', 'attemptExitEvidence',
  'cancelIntent', 'configRevision', 'originalConfigRevision', 'inputRef',
  'progress', 'result', 'resultPendingExit', 'failure', 'recovery',
] as const;

function isFullTaskResource(task: unknown): boolean {
  return typeof task === 'object' && task !== null && !Array.isArray(task)
    && TASK_RESOURCE_MEMBERS.every((member) => member in (task as Record<string, unknown>));
}

/// Frozen web-api/2 §1/§3.1: a task resource is V2-identified by its OWN
/// `contractVersion`, not by the outer envelope that carried it. A V1 row, a
/// row with the member absent, or a row with an invalid version is a different
/// contract generation and can never be consumed as V2 evidence — the outer
/// envelope cannot authorize a nested resource of another generation.
function isV2TaskResource(task: unknown): boolean {
  return isFullTaskResource(task)
    && (task as Record<string, unknown>).contractVersion === CONTRACT_VERSION;
}

/// Readable actual-version extraction for the rejection messages below.
function taskVersionOf(task: unknown): string {
  const actual = task && typeof task === 'object' && !Array.isArray(task)
    ? (task as Record<string, unknown>).contractVersion
    : undefined;
  return actual === undefined ? '缺失版本' : String(actual);
}

/// Frozen web-api/2 §3.1.1 structural validation for `attemptExitEvidence`,
/// INCLUDING the normative invariants that make the object self-consistent:
///
/// - identity: `registry.total === confirmedExtinct + unobservable + survivors.length`;
/// - invariant 1: `verdict = 'registry_extinct'` requires the full confirming
///   conjunction (worker exited, group absent, no survivors, every member
///   confirmed, argv scan performed with zero hits, no unswept stray, no veto,
///   `confirmedAt` set);
/// - invariant 2: `verdict = 'unresolved'` requires a triggered veto with a
///   reason, a null `confirmedAt`, AND at least one expressible blocking face
///   (worker not exited, group not absent, a registered survivor, an
///   unobservable member, an unperformed/failed/positive argv scan, or an
///   unswept stray) — a "unresolved" verdict with no actual blocker is
///   self-contradictory and rejected;
/// - invariant 3: the argv observation constrains the veto reason —
///   `argvScan=null` ⇒ `insufficient_evidence`; `performed=false` ⇒
///   `insufficient_evidence`/`eperm`; `hits>0` ⇒
///   `known_survivor`/`insufficient_evidence`. A scan that did not run cannot
///   carry hits;
/// - invariant 4: `residual.treeExtinctProven` is the literal `false`;
/// - §3.1 appearance rules: evidence is null exactly when the exit state is
///   `not_started`/`active`/`exiting`, and the verdict must agree with the
///   exit state (`exited_confirmed` ⇔ `registry_extinct`,
///   `exited_unknown` ⇔ `unresolved`).
///
/// This is a SHAPE and consistency check, not a re-derivation of the server's
/// predicate: the client cannot and must not pretend to re-verify the
/// registry. Anything that fails is reported with a readable reason and the
/// mapping fails closed.
export function parseAttemptExitEvidence(raw: unknown, attemptExitState: string): ParsedExitEvidence {
  const stateExpectsEvidence = attemptExitState === 'exited_unknown' || attemptExitState === 'exited_confirmed';
  if (raw === null || raw === undefined) {
    return stateExpectsEvidence
      ? { evidence: null, error: `退出证据缺失（attemptExitState=${attemptExitState} 必须携带证据），已按不可信处理。` }
      : { evidence: null, error: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { evidence: null, error: '退出证据不是对象，已拒绝。' };
  }
  if (!stateExpectsEvidence) {
    // not_started / active / exiting (or an unknown state) must not carry
    // evidence; present evidence is a self-contradiction and stays unusable.
    return { evidence: null, error: `退出证据出现异常（attemptExitState=${attemptExitState} 不应携带证据），已按不可信处理。` };
  }
  const reject = (why: string): ParsedExitEvidence => ({ evidence: null, error: `退出证据不合规，已拒绝：${why}` });
  const row = raw as Record<string, unknown>;
  const verdict = row.verdict;
  if (verdict !== 'registry_extinct' && verdict !== 'unresolved') return reject('verdict 不在契约枚举内。');
  if (typeof row.workerExited !== 'boolean' || typeof row.groupAbsent !== 'boolean') return reject('workerExited/groupAbsent 缺失或非布尔。');
  const registry = row.registry;
  if (typeof registry !== 'object' || registry === null) return reject('registry 缺失。');
  const reg = registry as Record<string, unknown>;
  if (!isWireInt(reg.total) || !isWireInt(reg.confirmedExtinct) || !isWireInt(reg.unobservable) || !Array.isArray(reg.survivors)) {
    return reject('registry 计数缺失或非法。');
  }
  const survivors: WireRegistrySurvivor[] = [];
  for (const entry of reg.survivors) {
    if (typeof entry !== 'object' || entry === null) return reject('registry.survivors 成员不是对象。');
    const member = entry as Record<string, unknown>;
    if (!isWireInt(member.pid) || typeof member.identity !== 'string' || typeof member.evidence !== 'string') {
      return reject('registry.survivors 成员字段缺失或非法。');
    }
    survivors.push({ pid: member.pid, identity: member.identity, evidence: member.evidence });
  }
  // Normative identity: total = confirmedExtinct + unobservable + survivors.
  if (reg.total !== reg.confirmedExtinct + reg.unobservable + survivors.length) {
    return reject('registry 计数自相矛盾（total ≠ confirmedExtinct + unobservable + survivors）。');
  }
  const argvScan = row.argvScan;
  if (argvScan !== null) {
    if (typeof argvScan !== 'object' || argvScan === null) return reject('argvScan 形状非法。');
    const scan = argvScan as Record<string, unknown>;
    if (typeof scan.performed !== 'boolean' || !isWireInt(scan.hits)) return reject('argvScan 字段缺失或非法。');
    // §3.1.1 shape: a scan that did not run (`performed=false`) records
    // `hits: 0` by definition — a failed/refused scan cannot have matched
    // anything, so `performed=false ∧ hits>0` is self-contradictory.
    if (scan.performed === false && scan.hits !== 0) return reject('argvScan.performed=false 时 hits 必须为 0（§3.1.1 形状）。');
  }
  const veto = row.veto;
  if (typeof veto !== 'object' || veto === null) return reject('veto 缺失。');
  const vetoRow = veto as Record<string, unknown>;
  if (typeof vetoRow.triggered !== 'boolean') return reject('veto.triggered 缺失或非布尔。');
  const reason = vetoRow.reason;
  if (reason !== null && reason !== 'known_survivor' && reason !== 'insufficient_evidence' && reason !== 'identity_mismatch' && reason !== 'eperm') {
    return reject('veto.reason 不在契约枚举内。');
  }
  if (vetoRow.triggered === false && (reason !== null || vetoRow.detail !== null)) return reject('veto.triggered=false 时 reason/detail 必须为 null。');
  if (vetoRow.triggered === true && reason === null) return reject('veto.triggered=true 时必须给出 reason。');
  const detail = vetoRow.detail;
  if (detail !== null && typeof detail !== 'string') return reject('veto.detail 非字符串。');
  const residual = row.residual;
  if (typeof residual !== 'object' || residual === null) return reject('residual 缺失。');
  const residualRow = residual as Record<string, unknown>;
  // Invariant 4: the literal false — a truthy value here is the exact
  // "tree extinct proven" claim the contract forbids.
  if (residualRow.treeExtinctProven !== false) return reject('residual.treeExtinctProven 必须为字面量 false。');
  if (residualRow.scope !== 'registry_domain') return reject('residual.scope 必须为 registry_domain。');
  const strayLedger = residualRow.strayLedger;
  if (strayLedger !== null) {
    if (typeof strayLedger !== 'object' || strayLedger === null) return reject('residual.strayLedger 形状非法。');
    const ledger = strayLedger as Record<string, unknown>;
    if (!isWireInt(ledger.found) || !isWireInt(ledger.swept) || !isWireInt(ledger.pending)) return reject('residual.strayLedger 计数缺失或非法。');
  }
  const confirmedAt = row.confirmedAt;
  if (confirmedAt !== null && !isIsoString(confirmedAt)) return reject('confirmedAt 非法。');
  // Normative direction: confirmedAt is non-null exactly for registry_extinct.
  if ((verdict === 'registry_extinct') !== (confirmedAt !== null)) return reject('confirmedAt 出现规则与 verdict 矛盾。');
  const evidence: WireAttemptExitEvidence = {
    verdict,
    workerExited: row.workerExited as boolean,
    groupAbsent: row.groupAbsent as boolean,
    registry: {
      total: reg.total as number,
      confirmedExtinct: reg.confirmedExtinct as number,
      unobservable: reg.unobservable as number,
      survivors,
    },
    argvScan: argvScan === null ? null : { performed: (argvScan as Record<string, unknown>).performed as boolean, hits: (argvScan as Record<string, unknown>).hits as number },
    veto: { triggered: vetoRow.triggered as boolean, reason: (reason ?? null) as AttemptExitVetoReason | null, detail: (detail ?? null) as string | null },
    residual: { treeExtinctProven: false, scope: 'registry_domain', strayLedger: strayLedger === null ? null : { found: (strayLedger as Record<string, unknown>).found as number, swept: (strayLedger as Record<string, unknown>).swept as number, pending: (strayLedger as Record<string, unknown>).pending as number } },
    confirmedAt: confirmedAt as string | null,
  };
  // Invariants 1/2, now over the normalized shape.
  if (verdict === 'registry_extinct') {
    const ledgerOk = evidence.residual.strayLedger === null || evidence.residual.strayLedger.pending === 0;
    const confirmed = evidence.workerExited
      && evidence.groupAbsent
      && evidence.registry.survivors.length === 0
      && evidence.registry.confirmedExtinct === evidence.registry.total
      && evidence.registry.unobservable === 0
      && evidence.argvScan !== null
      && evidence.argvScan.performed === true
      && evidence.argvScan.hits === 0
      && ledgerOk
      && evidence.veto.triggered === false
      && evidence.confirmedAt !== null;
    if (!confirmed) return reject('verdict=registry_extinct 不满足 §3.1.1 不变式 1 的确认条件。');
  } else {
    if (evidence.veto.triggered !== true || evidence.veto.reason === null || evidence.confirmedAt !== null) {
      return reject('verdict=unresolved 不满足 §3.1.1 不变式 2 的否决条件。');
    }
    // §3.1.1 invariant 2: an `unresolved` verdict must have at least one
    // EXPRESSIBLE blocking face. A row whose observations all satisfy the
    // confirming conjunction but that still claims `unresolved` (with a
    // fabricated veto) is self-contradictory and fails closed.
    const blockingFace = evidence.workerExited === false
      || evidence.groupAbsent === false
      || evidence.registry.survivors.length > 0
      || evidence.registry.unobservable > 0
      || evidence.argvScan === null
      || evidence.argvScan.performed === false
      || evidence.argvScan.hits > 0
      || (evidence.residual.strayLedger !== null && evidence.residual.strayLedger.pending > 0);
    if (!blockingFace) return reject('verdict=unresolved 没有任何可表达阻塞面（§3.1.1 不变式 2）。');
  }
  // §3.1.1 invariant 3: the argv observation constrains the veto reason.
  // `null` (not run) ⇒ insufficient_evidence; `performed=false` ⇒
  // insufficient_evidence/eperm (EPERM wins for an OS refusal); `hits>0` ⇒
  // known_survivor/insufficient_evidence. A clean executed scan imposes no
  // reason constraint (the blocker then lies elsewhere).
  if (evidence.argvScan === null) {
    if (evidence.veto.reason !== 'insufficient_evidence') {
      return reject('argvScan=null 时 veto.reason 必须为 insufficient_evidence（§3.1.1 不变式 3）。');
    }
  } else if (evidence.argvScan.performed === false) {
    if (evidence.veto.reason !== 'insufficient_evidence' && evidence.veto.reason !== 'eperm') {
      return reject('argvScan.performed=false 时 veto.reason 只能为 insufficient_evidence 或 eperm（§3.1.1 不变式 3）。');
    }
  } else if (evidence.argvScan.hits > 0) {
    if (evidence.veto.reason !== 'known_survivor' && evidence.veto.reason !== 'insufficient_evidence') {
      return reject('argvScan.hits>0 时 veto.reason 只能为 known_survivor 或 insufficient_evidence（§3.1.1 不变式 3）。');
    }
  }
  // §3.1 appearance rules: the verdict must agree with the exit state.
  if (attemptExitState === 'exited_confirmed' && verdict !== 'registry_extinct') {
    return { evidence: null, error: '退出证据自相矛盾（attemptExitState=exited_confirmed 但 verdict 非 registry_extinct），已拒绝。' };
  }
  if (attemptExitState === 'exited_unknown' && verdict !== 'unresolved') {
    return { evidence: null, error: '退出证据自相矛盾（attemptExitState=exited_unknown 但 verdict 非 unresolved），已拒绝。' };
  }
  return { evidence, error: null };
}

/// A mapped task run carrying the wire generation ADDITIVELY on top of the
/// frozen domain `ModelRun` shape (the domain type itself is untouched).
/// Frozen web-api/1 §6: production retry keeps `taskId`/`createdAt` and bumps
/// `version`/`attemptCount`, so the wire row — not `createdAtMs` — is the
/// generation authority that decides whether a same-id state change is a
/// legitimate newer attempt or a stale response.
export type StoreRun = ModelRun & {
  wireVersion: number;
  wireAttemptCount: number;
  wireState: WireTask['state'];
  /// Attempt identity on the wire (§3.1). The store's generation fence uses
  /// it: at the SAME task version a different attemptId is a stale/self-
  /// contradictory row and must never overwrite the installed one.
  wireAttemptId: string | null;
  /// `attemptExitState` verbatim ('' when the wire row lacked it).
  wireExitState: string;
  /// The VALIDATED typed exit evidence (V2 §3.1.1) — null when the wire row
  /// carries none or when validation rejected it. Check `wireExitEvidenceError`
  /// to tell the two apart; a non-null error fails closed.
  wireExitEvidence: WireAttemptExitEvidence | null;
  /// Readable rejection reason when the wire evidence was missing/malformed/
  /// self-contradictory while the exit state demanded it, else null.
  wireExitEvidenceError: string | null;
};

/// Frozen web-api/2 §6.1 compensation entry: the full-volume snapshot with the
/// high-watermark cursor and the ONE canonical shape (spec text, frozen sample
/// and client expectation are the same shape). The client validates the whole
/// envelope before the store sees any of it.
/// Frozen web-api/2 §6.1 snapshot: normative `settings`/`workspace`/`generatedAt`
/// members plus the full-field task list (incl. `attemptExitEvidence`). The
/// top-level `agentConcurrency` is the OPTIONAL compatible extra field
/// (§6.1 member 5): present rows must equal `settings.agentConcurrency`
/// (same-source invariant), absent is legal, and it is NEVER a CAS input —
/// the settings ENDPOINT's `version` is.
export interface WireSnapshotSettings {
  agentConcurrency: number;
  version: number;
}

export interface WireSnapshotWorkspace {
  mode: string;
  currentRoot: { id: string; label: string };
  capabilities: string[];
  recovery: unknown;
}

export interface WireSnapshot {
  contractVersion: typeof CONTRACT_VERSION;
  epoch: string;
  highWatermark: number;
  /// Snapshot generation time (normative member, §6.1 member 3).
  generatedAt: string;
  /// `<epoch>:<highWatermark>` — the token a reconnect MUST send as the
  /// `Last-Event-ID` request header after consuming this snapshot.
  lastEventId: string;
  /// Normative nested settings block (§6.1 member 4): same source and value
  /// as the concurrency endpoint; its `version` is the ONLY CAS input.
  settings: WireSnapshotSettings;
  /// Normative workspace block (§6.1 member 6).
  workspace: WireSnapshotWorkspace;
  /// The optional compatible top-level mirror, or null when the server
  /// omitted it. Validated same-source; never authoritative.
  agentConcurrency: number | null;
  tasks: StoreRun[];
}

type Backend = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export class WebApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'WebApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const CONTRACT_VERSION = 'web-api/2';

/// Frozen web-api/2 §1: every JSON response body carries the contract version.
/// A body that is not a `web-api/2` envelope — V1, missing, malformed, an
/// array, or an empty body — is rejected outright, with no default and no
/// compatibility shim: it can never land as evidence on this client.
function isV2Envelope(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    && (payload as Record<string, unknown>).contractVersion === CONTRACT_VERSION;
}

function requireV2Envelope(payload: unknown, status: number): void {
  if (isV2Envelope(payload)) return;
  const actual = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).contractVersion
    : undefined;
  throw new WebApiError(
    'contract_version',
    status,
    `服务响应不是 ${CONTRACT_VERSION} 契约格式（实际 ${actual === undefined ? '缺失版本' : String(actual)}），已拒绝处理。`,
  );
}

export function toWirePoint(point: { atMs: number; timeZone: string; localText: string; precision?: 'day' } | null): WirePoint | null {
  if (!point) return null;
  return {
    at: new Date(point.atMs).toISOString(),
    timeZone: point.timeZone,
    localText: point.localText,
    precision: point.precision ?? 'minute',
  };
}

/// The domain `TimePoint.precision` is optional and only ever `'day'`; the wire
/// always carries an explicit `'minute'`/`'day'`. Map `'minute'` back to the
/// domain default (`undefined`) and keep an explicit `'day'`.
export function toDomainPoint(point: WirePoint): TimePoint {
  return {
    atMs: Date.parse(point.at),
    timeZone: point.timeZone,
    localText: point.localText,
    precision: point.precision === 'day' ? 'day' : undefined,
  };
}

/// Bridge an editable `fields` object from the wire to the internal domain
/// shape. `due`/`followup` are the only differences: the wire carries the shared
/// DatePoint line, the domain carries `TimePoint` (`{atMs,…}`). Every other
/// attribute — title, kind, owner, priority, tags — is identical on both sides
/// and is copied through untouched, so this cannot silently drop metadata.
///
/// `null`/`undefined` points map to `null` rather than to a fabricated point,
/// matching the domain's "no date" value.
export function toDomainFields(fields: WireFields): TodoInput {
  return {
    ...fields,
    due: fields.due ? toDomainPoint(fields.due) : null,
    followup: fields.followup ? toDomainPoint(fields.followup) : null,
  };
}

/// C4 write bridge: build the shared date point for an explicit millisecond
/// instant, so `organize_text` can send what the HTTP surface requires.
///
/// DERIVATION RULE (declared, and the only one this bridge uses):
///   `at`        the instant VERBATIM, rendered as ISO 8601 UTC with
///               milliseconds — the exact form `normalizePoint` requires and
///               round-trips. The wire time format is "ISO 8601 UTC
///               milliseconds" with NO minute granularity limit, so an explicit
///               millisecond instant is preserved exactly. Silently truncating
///               it would hand the store back a DIFFERENT instant than the one
///               the caller supplied, which the caller cannot detect.
///   `timeZone`  the caller's requested zone, verbatim.
///   `localText` the same instant rendered in that zone, at the SAME precision
///               as the instant itself. This is DERIVED from the instant, not
///               the user's original expression: the caller (the store, the
///               Tauri bridge) carries an instant and has no original text to
///               forward. Presenting it as a quote would be a fabrication, so
///               the field is filled from the instant and documented as such at
///               the call site.
///
/// WHY THE LOCAL TEXT CARRIES SECONDS: `normalizePoint` cross-checks a
/// structured `localText` against `at` only when the text matches
/// `STRUCTURED_LOCAL` — `YYYY-MM-DD HH:mm`, no seconds. A minute-shaped text
/// paired with a seconds-carrying `at` is therefore REJECTED, because the
/// minute expression's only candidate is the exact minute. Rendering the text
/// at the instant's own precision keeps the pair consistent, so the
/// cross-check either passes or is skipped (a text with seconds does not match
/// the structured pattern at all) — and in neither case is `at` altered.
/// Verified against the real server: `…T01:02:03.000Z` + `… 01:02:03` → 200
/// with `at` returned to the millisecond; the same `at` + `… 01:02` → 400.
///
/// A zone the host cannot resolve is a caller error and surfaces as the point
/// being unbuildable rather than silently falling back to UTC.
export function pointFromInstant(atMs: number, timeZone: string): WirePoint {
  const instant = new Date(atMs);
  const at = instant.toISOString();
  // Render the local wall clock in the requested zone. `formatToParts` is used
  // so the parts are taken from the zone's own calendar, not from the host's.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant);
  const pick = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  const base = `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
  // Sub-second input keeps millisecond precision in the text too, so the pair
  // stays at one granularity; a whole second is expressed to the second.
  const ms = instant.getUTCMilliseconds();
  const localText = ms === 0 ? `${base}:${pick('second')}` : `${base}:${pick('second')}.${String(ms).padStart(3, '0')}`;
  return { at, timeZone, localText, precision: 'minute' };
}

export function toWireInput(input: TodoInput) {
  return {
    title: input.title,
    kind: input.kind,
    owner: input.owner,
    priority: input.priority,
    due: toWirePoint(input.due),
    followup: toWirePoint(input.followup),
    tags: input.tags,
  };
}

export function fromWireItem(item: WireItem): Todo {
  return {
    id: item.itemId,
    data: {
      title: item.title,
      kind: item.kind,
      owner: item.owner,
      priority: item.priority,
      due: item.due ? toDomainPoint(item.due) : null,
      followup: item.followup ? toDomainPoint(item.followup) : null,
      tags: item.tags,
    },
    status: item.status,
    createdAtMs: Date.parse(item.createdAt),
    updatedAtMs: Date.parse(item.updatedAt),
    completedAtMs: item.completedAt ? Date.parse(item.completedAt) : null,
    deletedAtMs: item.deletedAt ? Date.parse(item.deletedAt) : null,
    version: item.version,
    // 003 widened the CHECK to ('manual','signed_ai'); the wire value maps
    // straight onto the domain kind instead of being pinned to manual.
    source: item.source === 'signed_ai' ? 'signed_ai' : 'manual',
  };
}

export function fromWireEvent(event: {
  operationId: string;
  action: string;
  occurredAt: string;
  before: WireItem | null;
  after: WireItem;
}): TodoEvent {
  return {
    operationId: event.operationId,
    action: event.action,
    occurredAtMs: Date.parse(event.occurredAt),
    before: event.before ? fromWireItem(event.before) : null,
    after: fromWireItem(event.after),
  };
}

export interface SessionInfo {
  capabilities: string[];
  csrfToken: string;
}

export interface ApplicationSettingsSnapshot {
  contractVersion: 'web-api/2';
  settings: { timeZone: string };
  version: number;
  warning: string | null;
}

export class WebApiClient {
  private baseUrl: string;
  private csrfToken = '';
  private sessionLostHandler: (() => void) | null = null;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getCsrfToken() {
    return this.csrfToken;
  }

  /// Register for an in-session authentication loss (401 or logout): the
  /// shared CSRF token is cleared and the pairing gate is shown again.
  onSessionLost(handler: () => void) {
    this.sessionLostHandler = handler;
  }

  private handleSessionLost() {
    this.csrfToken = '';
    this.sessionLostHandler?.();
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Host: window.location.host };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      headers.Origin = window.location.origin;
      if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      // An in-session 401 means the session expired: clear the shared token and
      // let the pairing store return to the gate. The fresh-load probes
      // (pair, session check) are excluded so an unpaired app still shows the
      // gate instead of looping.
      const isFreshProbe = path.includes('/api/pair') || (method === 'GET' && path.includes('/api/session'));
      if (response.status === 401 && !isFreshProbe) this.handleSessionLost();
      // The error envelope is a web-api/2 envelope too (§1): a V1/missing
      // version is rejected with the version reason instead of being consumed.
      if (!isV2Envelope(payload)) {
        const actual = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).contractVersion
          : undefined;
        throw new WebApiError(
          'contract_version',
          response.status,
          `服务错误响应不是 ${CONTRACT_VERSION} 契约格式（实际 ${actual === undefined ? '缺失版本' : String(actual)}），已拒绝处理。`,
          payload && typeof payload === 'object' ? (payload as { error?: unknown }).error : undefined,
        );
      }
      const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new WebApiError(
        envelope?.error?.code ?? 'internal_error',
        response.status,
        envelope?.error?.message ?? '操作暂未完成，请重试。',
        envelope?.error?.details,
      );
    }
    requireV2Envelope(payload, response.status);
    return payload;
  }

  async pair(pairingCode: string): Promise<SessionInfo> {
    const payload = await this.request('POST', '/api/pair', { pairingCode }) as { session?: { capabilities?: string[] }; csrfToken?: string };
    const capabilities = payload.session?.capabilities ?? [];
    const csrfToken = payload.csrfToken ?? '';
    this.csrfToken = csrfToken;
    return { capabilities, csrfToken };
  }

  async readSession(): Promise<SessionInfo | null> {
    const payload = await this.request('GET', '/api/session') as { session?: { capabilities?: string[] }; csrfToken?: string };
    const csrfToken = payload.csrfToken ?? '';
    this.csrfToken = csrfToken;
    return { capabilities: payload.session?.capabilities ?? [], csrfToken };
  }

  async logout(): Promise<void> {
    try {
      await this.request('DELETE', '/api/session');
    } catch {
      // The session may already be gone; clearing local state is still correct.
    }
    this.handleSessionLost();
  }

  async listItems(): Promise<Todo[]> {
    const payload = await this.request('GET', '/api/manual-items?status=all') as { items?: WireItem[] };
    return (payload.items ?? []).map(fromWireItem);
  }

  async createItem(operationId: string, input: TodoInput): Promise<Todo> {
    const payload = await this.request('POST', '/api/manual-items', { operationId, input: toWireInput(input) }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async updateItem(itemId: string, expectedVersion: number, operationId: string, input: TodoInput): Promise<Todo> {
    const payload = await this.request('PUT', `/api/manual-items/${itemId}`, {
      operationId,
      expectedVersion,
      input: toWireInput(input),
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async setCompleted(itemId: string, expectedVersion: number, operationId: string, completed: boolean): Promise<Todo> {
    const payload = await this.request('POST', `/api/manual-items/${itemId}/${completed ? 'complete' : 'reopen'}`, {
      operationId,
      expectedVersion,
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  async deleteItem(itemId: string, expectedVersion: number, operationId: string): Promise<Todo> {
    const payload = await this.request('DELETE', `/api/manual-items/${itemId}`, {
      operationId,
      expectedVersion,
    }) as { item: WireItem };
    return fromWireItem(payload.item);
  }

  /// Source traceability for a signed-off item (T-11). The wire contract is
  /// the registered read endpoint: ISO UTC millisecond times, association
  /// limited to `new|manual_link`.
  async listItemSources(itemId: string) {
    return this.request('GET', `/api/manual-items/${itemId}/sources`) as Promise<{
      sources: { sourceId: string; candidateId: string; evidence: string; association: string; createdAt: string; anchorAt: string; excerpt: string }[];
    }>;
  }

  async history(itemId: string): Promise<TodoEvent[]> {
    const payload = await this.request('GET', `/api/manual-items/${itemId}/history`) as { events?: unknown[] };
    return (payload.events ?? []).map((event) => fromWireEvent(event as {
      operationId: string; action: string; occurredAt: string; before: WireItem | null; after: WireItem;
    }));
  }

  /// Read the application settings snapshot. The backend supplies the OS
  /// default timezone at version 0 when nothing has been saved, so a fresh
  /// install still has a consistent value.
  async readApplicationSettings(): Promise<ApplicationSettingsSnapshot> {
    const payload = await this.request('GET', '/api/settings/application') as {
      settings?: { timeZone?: string };
      version?: number;
    };
    return {
      contractVersion: CONTRACT_VERSION,
      settings: { timeZone: payload.settings?.timeZone ?? '' },
      version: payload.version ?? 0,
      warning: null,
    };
  }

  /// Write the application timezone with an atomic compare-and-set on the
  /// version from the last successful read.
  async writeApplicationSettings(timeZone: string, expectedVersion: number): Promise<ApplicationSettingsSnapshot> {
    const payload = await this.request('PUT', '/api/settings/application', { timeZone, expectedVersion }) as {
      settings?: { timeZone?: string };
      version?: number;
      warning?: string | null;
    };
    return {
      contractVersion: CONTRACT_VERSION,
      settings: { timeZone: payload.settings?.timeZone ?? timeZone },
      version: payload.version ?? expectedVersion + 1,
      warning: payload.warning ?? null,
    };
  }

  async workspace(): Promise<WorkspaceInfo> {
    const payload = await this.request('GET', '/api/workspace') as Partial<WireWorkspace>;
    return {
      needsSetup: Boolean(payload.needsSetup),
      root: payload.root ?? null,
      defaultRoot: payload.root ?? '',
      pendingRoot: payload.pendingRoot ?? null,
    };
  }

  // --- text sources / candidates / sign-off ---------------------------------

  async submitSource(operationId: string, input: { text: string; sourceAt?: WirePoint | null; timeZone: string }) {
    return this.request('POST', '/api/text-sources', { operationId, input }) as Promise<{
      replayed: boolean; reused: boolean; source: WireSource; task: WireTask;
    }>;
  }

  async listSources(cursor?: string, limit?: number) {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request('GET', `/api/text-sources?${query.toString()}`) as Promise<{
      sources: WireSource[]; nextCursor: string | null;
    }>;
  }

  async getSource(sourceId: string) {
    return this.request('GET', `/api/text-sources/${sourceId}`) as Promise<{
      source: WireSource; run: WireTask | null; candidates: WireCandidate[]; previews: WirePreview[];
    }>;
  }

  async listCandidates(sourceId: string, status?: string, cursor?: string, limit?: number) {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request('GET', `/api/text-sources/${sourceId}/candidates?${query.toString()}`) as Promise<{
      candidates: WireCandidate[]; nextCursor: string | null;
    }>;
  }

  async getCandidate(candidateId: string) {
    return this.request('GET', `/api/candidates/${candidateId}`) as Promise<{ candidate: WireCandidate }>;
  }

  async editCandidate(candidateId: string, operationId: string, expectedVersion: number, input: TodoInput, timeReviewed: boolean) {
    return this.request('POST', `/api/candidates/${candidateId}/edits`, {
      operationId, expectedVersion, input: toWireInput(input), timeReviewed,
    }) as Promise<{ candidate: WireCandidate }>;
  }

  async discardCandidate(candidateId: string, operationId: string, expectedVersion: number) {
    return this.request('POST', `/api/candidates/${candidateId}/discard`, {
      operationId, expectedVersion,
    }) as Promise<{ candidate: WireCandidate }>;
  }

  async requestRevision(candidateId: string, operationId: string, instruction: string) {
    return this.request('POST', `/api/candidates/${candidateId}/revisions`, {
      operationId, instruction,
    }) as Promise<{ task: WireTask }>;
  }

  async applyPreview(candidateId: string, runId: string, operationId: string, expectedVersion: number) {
    return this.request('POST', `/api/candidates/${candidateId}/previews/${runId}/apply`, {
      operationId, expectedVersion,
    }) as Promise<{ candidate: WireCandidate }>;
  }

  async signOff(operationId: string, choices: SignChoice[]) {
    return this.request('POST', '/api/sign-offs', {
      operationId,
      choices: choices.map((choice) => ({ ...choice, fields: toWireInput(choice.fields) })),
    }) as Promise<{ replayed: boolean; items: WireItem[] }>;
  }

  // --- tasks ----------------------------------------------------------------

  async submitTask(operationId: string, type: 'extract' | 'revise' | 'test', role: 'organizer', input: Record<string, unknown>) {
    return this.request('POST', '/api/tasks', { operationId, type, role, input }) as Promise<{
      replayed: boolean; taskId: string; state: string; version: number; queuePosition: number | null; task: WireTask;
    }>;
  }

  async listTasks(state?: string, cursor?: string, limit?: number) {
    const query = new URLSearchParams();
    if (state) query.set('state', state);
    if (cursor) query.set('cursor', cursor);
    if (limit !== undefined) query.set('limit', String(limit));
    const payload = await this.request('GET', `/api/tasks?${query.toString()}`) as {
      tasks: WireTask[]; nextCursor: string | null;
    };
    // §1/§3.1: every task resource carries its OWN `contractVersion`. A V1,
    // versionless or invalid nested row is rejected readably — the outer V2
    // envelope cannot authorize it, and a V1+V2 field mixture is never treated
    // as valid evidence.
    (payload.tasks ?? []).forEach((task, index) => {
      if (!isV2TaskResource(task)) {
        throw new WebApiError(
          'contract_version',
          200,
          `任务列表 tasks[${index}] 不是 ${CONTRACT_VERSION} 契约格式（实际 ${taskVersionOf(task)}），已拒绝处理。`,
        );
      }
    });
    return payload;
  }

  async getTask(taskId: string) {
    const payload = await this.request('GET', `/api/tasks/${taskId}`) as { task: WireTask };
    // §1/§3.1: the detail resource's own version is the identity gate — a V1
    // or versionless detail row is rejected readably, never mapped.
    if (!isV2TaskResource(payload.task)) {
      throw new WebApiError(
        'contract_version',
        200,
        `任务详情不是 ${CONTRACT_VERSION} 契约格式（实际 ${taskVersionOf(payload.task)}），已拒绝处理。`,
      );
    }
    return payload;
  }

  async readTaskResult(taskId: string, offset?: number, limit?: number) {
    const query = new URLSearchParams();
    if (offset !== undefined) query.set('offset', String(offset));
    if (limit !== undefined) query.set('limit', String(limit));
    return this.request('GET', `/api/tasks/${taskId}/result?${query.toString()}`) as Promise<Record<string, unknown>>;
  }

  async cancelTask(taskId: string, expectedVersion?: number) {
    return this.request('POST', `/api/tasks/${taskId}/cancel`, { expectedVersion }) as Promise<{ task: WireTask }>;
  }

  async retryTask(taskId: string, expectedVersion: number, configRevision?: string) {
    return this.request('POST', `/api/tasks/${taskId}/retry`, { expectedVersion, configRevision }) as Promise<{ task: WireTask }>;
  }

  async resolveTask(taskId: string, expectedVersion: number, decision: 'resume' | 'cancel', acknowledgedReceipts: string[]) {
    return this.request('POST', `/api/tasks/${taskId}/resolve`, {
      expectedVersion, decision, acknowledgedReceipts,
    }) as Promise<{ task: WireTask }>;
  }

  /// Frozen web-api/2 §6.1 compensation entry: GET /api/snapshot. The response
  /// is validated against the ONE canonical snapshot shape — the same shape as
  /// the spec text and the frozen sample — before any of it is mapped:
  ///
  /// - normative members: `epoch`, `highWatermark`, `generatedAt`,
  ///   `lastEventId` (`<epoch>:<highWatermark>`), nested `settings`
  ///   (`agentConcurrency` + its own `version`), nested `workspace`
  ///   (`mode`/`currentRoot{id,label}`/`capabilities`/`recovery`), and
  ///   `tasks` as FULL §3.1 task resources (trimmed rows are a violation);
  /// - the optional top-level `agentConcurrency` is accepted only as the
  ///   same-source mirror of `settings.agentConcurrency` (§6.1 member 5); a
  ///   mismatch or a non-number is a rejection, and absence is legal;
  /// - the transport has already rejected any non-`web-api/2` envelope.
  ///
  /// Read-only and side-effect free — the CALLER consumes the returned
  /// baseline (the organizer store installs it) and resubscribes with
  /// `lastEventId`. This validation proves the SHAPE only: whether the server
  /// actually keeps its transactional watermark promises is not something a
  /// client read can demonstrate.
  async readSnapshot(): Promise<WireSnapshot> {
    const payload = await this.request('GET', '/api/snapshot') as Record<string, unknown>;
    const reject: (why: string) => never = (why) => {
      throw new WebApiError('contract_shape', 200, `快照形状不合规，已拒绝消费：${why}`);
    };
    const str = (value: unknown, why: string): string => {
      if (typeof value !== 'string' || value === '') reject(why);
      return value;
    };
    const int = (value: unknown, why: string): number => {
      if (!isWireInt(value)) reject(why);
      return value;
    };
    const epoch = str(payload.epoch, 'epoch 缺失或非法。');
    const highWatermark = int(payload.highWatermark, 'highWatermark 缺失或非法。');
    const generatedAt = str(payload.generatedAt, 'generatedAt 缺失或非法。');
    const lastEventId = str(payload.lastEventId, 'lastEventId 缺失或不是 <epoch>:<cursor> 形状。');
    const tokenShape = /^([^:]+):(\d+)$/.exec(lastEventId);
    if (!tokenShape || tokenShape[1] !== epoch || Number(tokenShape[2]) !== highWatermark) {
      reject('lastEventId 与 epoch/highWatermark 不一致（§6.1 同形目标要求 <epoch>:<highWatermark>）。');
    }
    const settingsRow = payload.settings;
    if (typeof settingsRow !== 'object' || settingsRow === null) reject('嵌套 settings 块缺失（§6.1 规范性成员）。');
    const settingsAgentConcurrency = int((settingsRow as Record<string, unknown>).agentConcurrency, 'settings.agentConcurrency 缺失或非法。');
    const settingsVersion = int((settingsRow as Record<string, unknown>).version, 'settings.version 缺失或非法。');
    const workspaceRow = payload.workspace;
    if (typeof workspaceRow !== 'object' || workspaceRow === null) reject('嵌套 workspace 块缺失（§6.1 规范性成员）。');
    const workspace = workspaceRow as Record<string, unknown>;
    const mode = str(workspace.mode, 'workspace.mode 缺失或非法。');
    const currentRoot = workspace.currentRoot;
    if (typeof currentRoot !== 'object' || currentRoot === null) reject('workspace.currentRoot 缺失或非法。');
    const root = currentRoot as Record<string, unknown>;
    const rootId = str(root.id, 'workspace.currentRoot.id 缺失或非法。');
    const rootLabel = str(root.label, 'workspace.currentRoot.label 缺失或非法。');
    const capabilities = workspace.capabilities;
    if (!Array.isArray(capabilities) || !capabilities.every((entry) => typeof entry === 'string')) {
      reject('workspace.capabilities 缺失或非法。');
    }
    if (!('recovery' in workspace)) reject('workspace.recovery 成员缺失。');
    if (!Array.isArray(payload.tasks)) reject('tasks 缺失或不是数组。');
    // §6.1 member 1: full-field §3.1 task resources only — no trimmed rows —
    // and §1/§3.1: each resource's OWN `contractVersion` must be web-api/2.
    // A nested V1/versionless row is a different contract generation and is
    // rejected readably instead of being consumed as V2 evidence.
    const tasks = payload.tasks as unknown[];
    tasks.forEach((task, index) => {
      if (!isFullTaskResource(task)) reject(`tasks[${index}] 不是 §3.1 全字段任务资源（裁剪形按违规拒绝）。`);
      if (!isV2TaskResource(task)) {
        reject(`tasks[${index}] 自身契约版本不是 ${CONTRACT_VERSION}（实际 ${taskVersionOf(task)}），已拒绝消费。`);
      }
    });
    // §6.1 member 5: the top-level mirror is OPTIONAL; when present it must
    // equal the nested settings value (same source), else the snapshot is
    // rejected instead of silently trusted.
    const rawMirror = payload.agentConcurrency;
    let mirror: number | null = null;
    if (rawMirror !== undefined) {
      const mirrored = int(rawMirror, '顶层 agentConcurrency 非法。');
      if (mirrored !== settingsAgentConcurrency) reject('顶层 agentConcurrency 与 settings.agentConcurrency 不一致（§6.1 同源不变式）。');
      mirror = mirrored;
    }
    return {
      contractVersion: CONTRACT_VERSION,
      epoch,
      highWatermark,
      generatedAt,
      lastEventId,
      settings: { agentConcurrency: settingsAgentConcurrency, version: settingsVersion },
      workspace: {
        mode,
        currentRoot: { id: rootId, label: rootLabel },
        capabilities: capabilities as string[],
        recovery: workspace.recovery,
      },
      agentConcurrency: mirror,
      tasks: (tasks as WireTask[]).map((task) => this.toModelRun(task)),
    };
  }

  async readConcurrency() {
    return this.request('GET', '/api/settings/agent-concurrency') as Promise<{
      contractVersion: string; agentConcurrency: number; default: number; version: number;
      runningCount: number; queuedCount: number;
    }>;
  }

  async writeConcurrency(agentConcurrency: number, expectedVersion: number) {
    return this.request('PUT', '/api/settings/agent-concurrency', { agentConcurrency, expectedVersion }) as Promise<{
      contractVersion: string; agentConcurrency: number; default: number; version: number;
      runningCount: number; queuedCount: number;
    }>;
  }

  // --- configuration / providers -------------------------------------------

  /// Frozen W1 contract §5.3: `GET /api/models` answers the FLAT shape
  /// `{providers, models, defaultModelId, revision}` — there is no
  /// `configuration` envelope. The HTTP surface reads exactly that one frozen
  /// shape and the adapter converts it into the internal model so the stores
  /// and controls keep their existing shape; the Tauri bridge path is untouched.
  ///
  /// Credential reference status is NOT part of that frozen shape: it is
  /// exposed by `GET /api/providers` (§7), whose rows carry the provider id and
  /// the reference identity (`ref`) alongside the live status. The adapter
  /// therefore joins the two reads BY PROVIDER IDENTITY and records the status
  /// under the internal `credentialStatus` map keyed by provider id, which is
  /// what the settings panel reads. A missing providers read leaves the entry
  /// absent rather than guessing a status.
  async readModels(): Promise<{ configuration: ModelConfiguration | null }> {
    const flat = await this.request('GET', '/api/models') as {
      providers: Provider[]; models: ModelDefinition[]; defaultModelId: string; revision: string;
    } | null;
    if (!flat) return { configuration: null };
    const credentialStatus = await this.readCredentialStatus(flat.providers ?? []);
    return {
      configuration: {
        providers: { providers: flat.providers ?? [] },
        models: { models: flat.models ?? [] },
        defaultModelId: flat.defaultModelId ?? '',
        revision: flat.revision ?? '',
        credentialStatus,
      },
    };
  }

  /// Read the live credential-reference status per provider from
  /// `GET /api/providers` (frozen §7). The vocabulary is exactly
  /// `available | missing | unavailable`; the adapter keeps it verbatim and
  /// does NOT translate `available` into a "stored" claim — whether a secret is
  /// persisted in an OS store is not something this endpoint asserts.
  ///
  /// The status is matched BY REFERENCE IDENTITY, not by provider id alone: the
  /// models read and the providers read are two independent HTTP round trips, so
  /// a configuration write between them can change a provider's reference. A
  /// status row whose reference does not match the reference the configuration
  /// snapshot carries is DROPPED (the entry stays absent, so the control shows
  /// its own "unknown" copy) rather than attributed to the snapshot's reference.
  /// That is deliberately conservative: a mismatched row can describe a
  /// different credential than the one the configuration would actually use.
  ///
  /// The identity is (providerId, authMode, rawReference). `authMode` is the
  /// capability view's own value (`api_key` | `env`), and the raw reference is
  /// the server's `auth.apiKeyRef ?? auth.apiKeyEnv` — an `apiKeyEnv` provider's
  /// reference is the BARE ENV NAME, with no `env:` prefix. That prefix is a
  /// private derivation inside `credentialStatusFor` for the injected provider
  /// to answer a synthetic reference; it never crosses the wire, so matching
  /// against it here would make every env-mode provider look unknown.
  private async readCredentialStatus(configuredProviders: Provider[]): Promise<Record<string, string>> {
    let providers: WireProviderCapabilities | null = null;
    try {
      providers = await this.listProviders();
    } catch {
      // An unreadable providers surface must not fabricate a status: leave the
      // map empty and let the control show its own "unknown" copy.
      return {};
    }
    // The reference the configuration snapshot carries, per provider, keyed the
    // same way the server builds the capability view: `apiKeyRef ?? apiKeyEnv`
    // with NO prefix, plus the auth mode that selected it. The `env:` prefix is
    // a PRIVATE derivation the credential provider uses to answer a synthetic
    // reference (`credentialStatusFor`); it is never on the wire, so the client
    // must not match against it.
    const configuredRef = new Map<string, { ref: string; authMode: string }>();
    for (const provider of configuredProviders) {
      const auth = provider.auth ?? {};
      const ref = auth.apiKeyRef ?? auth.apiKeyEnv ?? null;
      if (!ref) continue;
      configuredRef.set(provider.id, { ref, authMode: auth.apiKeyRef ? 'api_key' : 'env' });
    }
    const status: Record<string, string> = {};
    for (const provider of providers?.providers ?? []) {
      const expected = configuredRef.get(provider.providerId);
      // No configured reference for this provider: nothing to attribute to.
      if (!expected) continue;
      // Same provider AND same auth mode: a provider that switched between the
      // key and env modes is a different credential even when the reference
      // string coincides, so the mode is part of the identity, not decoration.
      if (provider.authMode !== expected.authMode) continue;
      const ref = (provider.credentialRefs ?? [])[0];
      if (!ref) continue;
      // Cross-read identity mismatch: the providers row describes a different
      // reference than the configuration snapshot. Drop the entry.
      if (ref.ref !== expected.ref) continue;
      status[provider.providerId] = ref.status;
    }
    return status;
  }

  async writeModels(input: { providers: Provider[]; models: ModelDefinition[]; defaultModelId: string }, expectedRevision: string) {
    return this.request('PUT', '/api/models', { input, expectedRevision }) as Promise<{
      configuration: ModelConfiguration; warning: string | null;
    }>;
  }

  async readAgent(agentId: AgentId) {
    return this.request('GET', `/api/agents/${agentId}`) as Promise<{ configuration: AgentConfig }>;
  }

  async writeAgent(agentId: AgentId, input: { modelId: string | null; preferences: { detail: string; focus: string }; supplementalInstructions: string }, expectedRevision: string) {
    return this.request('PUT', `/api/agents/${agentId}`, { input, expectedRevision }) as Promise<{
      configuration: AgentConfig; warning: string | null;
    }>;
  }

  async resetAgent(agentId: AgentId, expectedRevision: string) {
    return this.request('POST', `/api/agents/${agentId}/reset`, { expectedRevision }) as Promise<{ configuration: AgentConfig }>;
  }

  async listProviders(): Promise<WireProviderCapabilities> {
    return this.request('GET', '/api/providers') as Promise<WireProviderCapabilities>;
  }

  // --- legacy command-surface mapping (organizer/models/agents stores) ------

  private toTextSource(source: WireSource): TextSource {
    return {
      id: source.sourceId,
      rawText: source.rawText,
      // C4: the wire carries the shared date point; the internal domain keeps
      // the millisecond instant, so the bridge is exactly `toDomainPoint`'s
      // `atMs`. The point's `localText`/`precision` are NOT carried into the
      // domain shape (it has no field for them), and the anchor keeps its own
      // column value — the domain's `anchorAtMs` remains the first-import
      // anchor, which is what the UI labels as such.
      sourceAtMs: source.sourceAt ? toDomainPoint(source.sourceAt).atMs : null,
      importedAtMs: source.importedAtMs,
      anchorAtMs: source.anchorAtMs,
      timeZone: source.timeZone,
      succeededRunId: source.succeededRunId,
    };
  }

  /// Map the frozen flat candidate row (§5.1) into the internal `Candidate`
  /// whose editable content lives under `draft`.
  ///
  /// A `staged` row is a result that has been persisted but whose exit has NOT
  /// been confirmed, so it is not published and must never be displayed or
  /// acted on. The public candidate reads (`GET /api/candidates/{id}` and an
  /// unfiltered `GET /api/text-sources/{id}/candidates`) can still return such
  /// a row while a worker holds the slot, so the adapter treats it as a
  /// contract violation and returns null rather than relabelling it `pending`:
  /// relabelling would put an unpublished candidate in the inbox as an
  /// actionable one. The batch read (`getSource`) already filters to `pending`
  /// server-side, so the normal inbox path is unaffected. `toCandidateList`
  /// applies this mapping to a list and drops the nulls.
  ///
  /// BOUNDARY: this is the DOMAIN adapter layer. The raw methods
  /// (`listCandidates`, `getCandidate`, `editCandidate`, …) are thin HTTP
  /// passthroughs that return `WireCandidate` verbatim and make no status
  /// judgement — they exist so callers that need the untouched wire shape can
  /// get it, and they do NOT inherit the staged rejection above. A caller that
  /// wants the domain view must go through the `case` shims in `asBackend()`
  /// (which map via `toCandidate`/`toCandidateList` and reject a staged single
  /// read with `state_conflict`), not through the raw methods.
  ///
  /// DATE POINTS: the wire carries `fields.due`/`fields.followup` on the shared
  /// DatePoint line (`{at,timeZone,localText,precision}`, frozen web-api/1 §1),
  /// converted server-side by `fieldsToWire`. The internal domain keeps
  /// `TimePoint` (`{atMs,…}`), so this mapping bridges each point through
  /// `toDomainPoint` — the same conversion the manual-item read already uses.
  /// The bridge is one-way here (wire → domain); the write path sends the
  /// domain point back through `toWirePoint`. No dual-read of a retired `atMs`
  /// wire shape: the server no longer emits it, so there is nothing to fall
  /// back to and no second date implementation.
  private toCandidate(candidate: WireCandidate): Candidate | null {
    if (candidate.status === 'staged') return null;
    return {
      id: candidate.candidateId,
      sourceId: candidate.sourceId,
      runId: candidate.runId,
      status: candidate.status,
      version: candidate.version,
      draft: {
        fields: toDomainFields(candidate.fields),
        evidence: candidate.evidence,
        dueExpression: candidate.dueExpression,
        followupExpression: candidate.followupExpression,
        warnings: candidate.warnings,
        unresolved: candidate.unresolved,
      },
      acceptedTodoId: candidate.acceptedItemId,
    };
  }

  /// List-view wrapper: drop any `staged` row instead of surfacing it.
  private toCandidateList(candidates: WireCandidate[]): Candidate[] {
    const out: Candidate[] = [];
    for (const candidate of candidates ?? []) {
      const mapped = this.toCandidate(candidate);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  /// A mutation's response must name a PUBLISHED candidate. A `staged` row here
  /// means the server let an unpublished candidate be acted on, which the
  /// client treats as a contract violation and surfaces as an error rather than
  /// displaying or persisting it.
  private requirePublished(candidate: WireCandidate, command: string): Candidate {
    const mapped = this.toCandidate(candidate);
    if (!mapped) {
      throw new WebApiError('state_conflict', 409, `${command} returned an unpublished (staged) candidate`);
    }
    return mapped;
  }

  private toModelRun(task: WireTask): StoreRun {
    // §1/§3.1: the task resource's OWN version is the identity gate. A V1 or
    // versionless row can never be mapped into a store run, even when the outer
    // envelope was V2 — defense in depth behind listTasks/getTask/readSnapshot.
    if ((task as { contractVersion?: unknown }).contractVersion !== CONTRACT_VERSION) {
      throw new WebApiError(
        'contract_version',
        200,
        `任务资源不是 ${CONTRACT_VERSION} 契约格式（实际 ${taskVersionOf(task)}），已拒绝处理。`,
      );
    }
    const inputRef = (task.inputRef ?? {}) as Record<string, unknown>;
    const stateMap: Record<string, ModelRun['status']> = {
      queued: 'queued',
      running: 'running',
      cancelling: 'running',
      succeeded: 'succeeded',
      failed: 'failed',
      cancelled: 'cancelled',
      interrupted: 'interrupted',
      needs_review: 'interrupted',
    };
    // V2 §3.1.1: the typed exit evidence is validated ONCE here, so every
    // consumer (list, detail, SSE read-back, snapshot) sees the same mapping.
    // Invalid or missing evidence fails closed with a readable reason instead
    // of becoming a truthy object.
    const parsed = parseAttemptExitEvidence(
      (task as { attemptExitEvidence?: unknown }).attemptExitEvidence,
      typeof task.attemptExitState === 'string' ? task.attemptExitState : '',
    );
    return {
      id: task.taskId,
      sourceId: (inputRef.sourceId as string) ?? null,
      kind: task.type as ModelRun['kind'],
      status: stateMap[task.state] ?? 'failed',
      snapshot: (inputRef.snapshot as Record<string, unknown>) ?? {},
      input: inputRef,
      candidateId: (inputRef.candidateId as string) ?? null,
      candidateVersion: (inputRef.candidateVersion as number) ?? null,
      preview: null,
      errorCode: task.failure?.code ?? null,
      createdAtMs: Date.parse(task.createdAt),
      finishedAtMs: task.terminalAt ? Date.parse(task.terminalAt) : null,
      // Wire generation, carried additively (see `StoreRun`): the store uses
      // it to tell a legitimate newer attempt (retry keeps taskId/createdAt
      // and bumps version/attempt) apart from a stale response re-running an
      // old state.
      wireVersion: task.version,
      wireAttemptCount: task.attemptCount,
      wireState: task.state,
      wireAttemptId: task.attemptId ?? null,
      wireExitState: typeof task.attemptExitState === 'string' ? task.attemptExitState : '',
      wireExitEvidence: parsed.evidence,
      wireExitEvidenceError: parsed.error,
    };
  }

  private toPreviewRun(preview: WirePreview): ModelRun {
    return {
      // Frozen W1 contract: the apply URL segment is the RUN id, and
      // `candidate_previews.run_id` stores the revise TASK id. `WirePreview`
      // carries both `previewId` (the preview entity) and `runId` (that task);
      // the run identity the store forwards to the request must be `runId`,
      // never `previewId`. A preview IS the revise task's run, so the run
      // identity is also the correct list key.
      id: preview.runId,
      sourceId: null,
      kind: 'revise',
      status: 'succeeded',
      snapshot: {},
      input: {},
      candidateId: preview.candidateId,
      candidateVersion: preview.candidateVersion,
      // The preview's editable content is NESTED under `draft` (unlike the
      // candidate row's flat `fields`), and its `fields.due`/`fields.followup`
      // are DatePoints on the same §1 line — bridged the same way, through the
      // same helper. The remaining draft attributes (evidence, both
      // expressions, warnings, unresolved) are copied verbatim, so a preview
      // loses nothing on the way in.
      preview: {
        fields: toDomainFields(preview.draft.fields),
        evidence: preview.draft.evidence,
        dueExpression: preview.draft.dueExpression,
        followupExpression: preview.draft.followupExpression,
        warnings: preview.draft.warnings,
        unresolved: preview.draft.unresolved,
      },
      errorCode: null,
      createdAtMs: Date.parse(preview.createdAt),
      finishedAtMs: Date.parse(preview.createdAt),
    };
  }

  private newOperationId() {
    return `op_${crypto.randomUUID().replaceAll('-', '')}`;
  }

  asBackend(): Backend {
    return async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case 'workspace_info':
          return this.workspace();
        case 'read_application_settings': {
          const snapshot = await this.readApplicationSettings();
          return { timeZone: snapshot.settings.timeZone, version: snapshot.version };
        }
        case 'save_application_settings': {
          const input = args.input as { timeZone?: string; expectedVersion?: number };
          const snapshot = await this.writeApplicationSettings(input.timeZone ?? '', input.expectedVersion ?? 0);
          return { settings: snapshot.settings, version: snapshot.version, warning: snapshot.warning };
        }
        case 'initialize_workspace':
          return this.workspace();
        case 'list_todos':
          return this.listItems();
        case 'create_todo':
          return this.createItem(args.operationId as string, args.input as TodoInput);
        case 'update_todo':
          return this.updateItem(args.id as string, args.expectedVersion as number, args.operationId as string, args.input as TodoInput);
        case 'set_todo_completed':
          return this.setCompleted(args.id as string, args.expectedVersion as number, args.operationId as string, Boolean(args.completed));
        case 'delete_todo':
          return this.deleteItem(args.id as string, args.expectedVersion as number, args.operationId as string);
        case 'todo_history':
          return this.history(args.id as string);
        case 'todo_source_links': {
          const payload = await this.listItemSources(args.id as string);
          return (payload.sources ?? []).map((source) => ({
            sourceId: source.sourceId,
            evidence: source.evidence,
            association: source.association,
            createdAtMs: Date.parse(source.createdAt),
          }));
        }
        case 'open_workspace_directory':
          return null;
        // --- organizer command surface -------------------------------------
        case 'list_import_batches': {
          const payload = await this.listSources(undefined, 200);
          const summaries: BatchSummary[] = [];
          for (const source of payload.sources) {
            const pending = await this.listCandidates(source.sourceId, 'pending', undefined, 200);
            const all = await this.listCandidates(source.sourceId, undefined, undefined, 200);
            // Count from the FILTERED set, not the raw wire rows: a `staged` row
            // is an unpublished result and must not reach a display summary. The
            // two counts are derived from the same filter the list read applies,
            // so `total` can never exceed the number of candidates the UI can
            // actually show — the counts are the visible collection, not the
            // server's row count.
            const visible = this.toCandidateList(all.candidates ?? []);
            summaries.push({
              id: source.sourceId,
              excerpt: source.rawText.slice(0, 80),
              importedAtMs: source.importedAtMs,
              pending: pending.candidates.filter(c => c.status === 'pending').length,
              total: visible.length,
              status: source.succeededRunId ? 'succeeded' : 'imported',
            });
          }
          return summaries;
        }
        case 'active_model_run': {
          const payload = await this.listTasks(undefined, undefined, 200);
          const active = (payload.tasks ?? []).find((task) => ['queued', 'running', 'cancelling'].includes(task.state));
          return active?.taskId ?? null;
        }
        case 'read_model_run': {
          const payload = await this.getTask(args.id as string);
          return this.toModelRun(payload.task);
        }
        case 'read_import_batch': {
          const payload = await this.getSource(args.id as string);
          const batch: ImportBatch = {
            source: this.toTextSource(payload.source),
            run: payload.run ? this.toModelRun(payload.run) : null,
            candidates: this.toCandidateList(payload.candidates ?? []),
            previews: (payload.previews ?? []).map((preview) => this.toPreviewRun(preview)),
            started: Boolean(payload.run),
          };
          return batch;
        }
        case 'organize_text': {
          const input = args.input as { text: string; sourceAtMs: number | null; timeZone: string };
          const payload = await this.submitSource(this.newOperationId(), {
            text: input.text,
            // C4: the HTTP surface speaks the shared `{at,timeZone,localText,precision}`
            // point, so the store's internal millisecond instant is converted here,
            // at the boundary — the store/Tauri ms shape is not widened to carry a
            // point.
            //
            //   omitted/null  → the point is OMITTED, which keeps the server's
            //                   first-import semantics: the anchor is taken from
            //                   the import instant and the fingerprint dedup /
            //                   operationId replay paths return that same first
            //                   point. Sending a synthesised point instead would
            //                   change what a replay returns.
            //   explicit ms   → a legal point whose `at` is the SAME instant,
            //                   carried to the millisecond. The instant is all
            //                   the caller has, so `localText` is DERIVED from
            //                   that instant in the requested zone (at the
            //                   instant's own precision, so the server's
            //                   structured cross-check cannot reject it) and
            //                   `precision` is `minute`; the derivation is
            //                   declared here rather than presented as the
            //                   user's original words (a derived local text is a
            //                   rendering of the instant, not a quote).
            sourceAt: input.sourceAtMs == null ? undefined : pointFromInstant(input.sourceAtMs, input.timeZone),
            timeZone: input.timeZone,
          });
          return this.toModelRun(payload.task);
        }
        case 'revise_candidate': {
          const payload = await this.requestRevision(
            args.candidateId as string,
            this.newOperationId(),
            args.instruction as string,
          );
          return this.toModelRun(payload.task);
        }
        case 'test_model': {
          const payload = await this.submitTask(
            this.newOperationId(),
            'test',
            'organizer',
            { modelId: (args.modelId as string) || null },
          );
          return this.toModelRun(payload.task);
        }
        case 'cancel_model_run': {
          const payload = await this.cancelTask(args.id as string);
          return this.toModelRun(payload.task);
        }
        case 'save_candidate': {
          const payload = await this.editCandidate(
            args.id as string,
            args.operationId as string,
            args.expectedVersion as number,
            args.input as TodoInput,
            Boolean(args.timeReviewed),
          );
          return this.requirePublished(payload.candidate, 'save_candidate');
        }
        case 'discard_candidate': {
          const payload = await this.discardCandidate(args.id as string, args.operationId as string, args.expectedVersion as number);
          return this.requirePublished(payload.candidate, 'discard_candidate');
        }
        case 'apply_candidate_preview': {
          const payload = await this.applyPreview(
            args.candidateId as string,
            args.runId as string,
            args.operationId as string,
            args.expectedVersion as number,
          );
          return this.requirePublished(payload.candidate, 'apply_candidate_preview');
        }
        case 'sign_candidates': {
          // The service normalizes the domain field shape itself; converting
          // here first would turn `{atMs}` into `{at}` and then throw in the
          // service's second conversion (M-7).
          const payload = await this.signOff(args.operationId as string, args.choices as SignChoice[]);
          return payload.items.map((item) => fromWireItem(item));
        }
        // --- model configuration command surface ---------------------------
        case 'read_model_configuration': {
          const payload = await this.readModels();
          return payload.configuration;
        }
        case 'save_model_configuration': {
          const input = args.input as {
            providers: Provider[]; models: ModelDefinition[]; defaultModelId: string;
            expectedRevision?: string; apiKeys?: Record<string, string>;
          };
          // The web pipe has no keychain and no way to persist a secret, so
          // `apiKeys` cannot be honoured: dropping it silently would lose a
          // user's typed credential while still reporting a successful save.
          //
          // The code below is the WEB pipe's own decision. It deliberately does
          // NOT claim that native rejects the same input: native ACCEPTS
          // `apiKeys` and writes each value to the OS keychain under a freshly
          // generated reference (`model_config.rs`), so the two hosts genuinely
          // differ on this field. `PLAIN_CREDENTIAL` here is a LOCAL command-
          // compatibility code chosen so the store and the user see a familiar
          // failure; the server's PUBLIC contract code for the same input is
          // `plain_credential` (lower case, `writeModelConfiguration`), and the
          // frozen HTTP codes are not changed by this shim.
          for (const [providerId, value] of Object.entries(input.apiKeys ?? {})) {
            if (!value) continue;
            throw new WebApiError(
              'PLAIN_CREDENTIAL',
              400,
              `浏览器模式没有钥匙串，无法保存服务 ${providerId} 的密钥明文；请改用环境变量引用，或在桌面端保存。`,
            );
          }
          const payload = await this.writeModels(
            { providers: input.providers, models: input.models, defaultModelId: input.defaultModelId },
            input.expectedRevision ?? '',
          );
          return { configuration: payload.configuration, warning: payload.warning };
        }
        // --- agent configuration command surface ---------------------------
        case 'read_agent_configuration': {
          const payload = await this.readAgent(args.agentId as AgentId);
          return payload.configuration;
        }
        case 'save_agent_configuration': {
          const input = args.input as { agentId: AgentId; expectedRevision: string } & Record<string, unknown>;
          const payload = await this.writeAgent(
            input.agentId,
            {
              modelId: (input.modelId as string) ?? null,
              preferences: input.preferences as { detail: string; focus: string },
              supplementalInstructions: (input.supplementalInstructions as string) ?? '',
            },
            input.expectedRevision,
          );
          return { configuration: payload.configuration, warning: payload.warning };
        }
        case 'reset_agent_configuration': {
          const payload = await this.resetAgent(args.agentId as AgentId, args.expectedRevision as string);
          return { configuration: payload.configuration, warning: null };
        }
        case 'active_agent_trial':
        case 'read_agent_trial':
        case 'latest_agent_trial':
          return null;
        case 'start_agent_trial':
          throw new WebApiError('unsupported_command', 500, '本切片不支持智能体试跑。');
        case 'cancel_agent_trial':
          return null;
        default:
          throw new WebApiError('unsupported_command', 500, `不支持的命令：${command}`);
      }
    };
  }
}

let sharedClient: WebApiClient | null = null;

/// The one production client: pairing/session establish the CSRF token, and the
/// manual-item and application-settings writes reuse it. Tests and fixtures may
/// still construct or inject their own client.
export function getWebApiClient(): WebApiClient {
  if (!sharedClient) sharedClient = new WebApiClient();
  return sharedClient;
}
