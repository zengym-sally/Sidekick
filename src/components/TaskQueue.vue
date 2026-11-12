<script setup lang="ts">
// Real queue surface: the persisted task queue with per-task cancel, manual
// retry, needs-review verification/resolve and the agent-concurrency control
// (r3 plan: docs/reviews/web-text-intake-task-controls-plan-20261110-opencode.md,
// SHA-256 a67abe96…; §11 takes precedence where it narrows earlier text).
//
// Every read goes through ONE fenced read-back: a request sequence AND the
// sync epoch fence (a response that started under an older request or epoch
// never lands), the list covers the FULL authoritative task set (pages are
// walked to the end; failed rows and the occupied-but-exited states stay
// visible instead of posing as "no tasks"), and the sync invalidation seam
// only paces it — the 1s poll stays as an offline fallback. The authoritative
// task state lives in the organizer store and the pairing sync, so leaving
// the inbox page loses only this display, never the authority. Action
// responses NEVER install into the task list — after an action only two
// things happen: its own pending key clears and a fenced read-back runs.
//
// Version discipline (frozen §3.3, three CAS families never mixed): cancel
// carries the task version from the row it was read from, retry carries the
// task version (optionally the SAVED config revision for the two config
// failure codes — never a client-built snapshot, RS-1), resolve carries the
// AUTHORITATIVE recovery.itemVersion (missing/malformed authority disables
// the entry, shows a hint and fires ONE fenced re-read — there is NO
// fallback to 1 or to an empty receipt list), and the concurrency write
// carries the settings version. 409s re-read and re-present; decision
// actions are never auto-replayed.
//
// Exit-evidence discipline (frozen web-api/2 §3.1.1/§3.1.2): the queue never
// enables a disposition from the state string alone or from a truthy
// evidence object — resolve exists only behind attemptExitState=
// exited_confirmed AND a validated registry_extinct evidence object. An
// unconfirmed exit always displays the slot-held fact and keeps every
// disposition disabled; a confirmed exit discloses the registry-domain
// boundary honestly (the descendant tree is NOT proven extinct; a zero
// stray count is not proof of absence); missing/malformed/self-
// contradictory evidence fails closed with the readable rejection reason.
//
// Async attribution (§5.2/§11): every continuation is registered as
// {key, generation, epoch}; it may touch component state only while the
// component is mounted, the epoch is unchanged and no newer generation
// exists for its key. Segment-loading sessions and receipt ACKs are bound to
// (taskId, syncEpoch, task.version, attemptId, recovery.itemVersion) plus
// recovery.itemId when present (§11.1) — a binding change invalidates the
// cached content, the complete marker, the ACKs and the session-owned
// errors. The concurrency GET/PUT share ONE install ownership: a shared
// view-generation ticket plus an epoch-scoped version watermark (§11.2) —
// same-epoch lower-version responses never install, equal-version late
// responses cannot overwrite a newer install, and a discarded PUT converges
// through the unified fenced re-read, never by just clearing pending.
//
// The config-revision rerun entry reads the SAVED revision through the
// optional `configRevision` prop (the page owner wires the model-configuration
// store here); absent/not-ready/identical revisions degrade to the plain
// retry entry, per the plan's §8.3.3 dependency registration.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getWebApiClient, parseAttemptExitEvidence, type WireAttemptExitEvidence } from '../lib/web-api-client.ts';
import { usePairing } from '../stores/pairing.ts';

interface QueueTask {
  taskId: string;
  kind: string;
  state: string;
  queuePosition: number | null;
  version: number;
  attemptCount: number;
  attemptId: string | null;
  attemptExitState: string;
  /// The typed exit evidence AFTER the shared client-side validation
  /// (V2 §3.1.1) — null when absent or rejected; see the error field.
  attemptExitEvidence: WireAttemptExitEvidence | null;
  /// Readable rejection reason for missing/malformed/self-contradictory
  /// evidence; non-null FAILS CLOSED (dispositions stay disabled).
  attemptExitEvidenceError: string | null;
  cancelIntent: boolean;
  configRevision: string;
  result: unknown;
  resultPendingExit: boolean;
  failure: { code?: string; message?: string; retryable?: string } | null;
  recovery: Record<string, unknown> | null;
}

interface ReceiptView {
  receiptId: string;
  kind: string;
  verifiable: boolean;
}

interface ContentSession {
  binding: string;
  loading: boolean;
  done: boolean;
  text: string;
  loaded: number;
  total: number;
}

const props = defineProps<{ configRevision?: string | null }>();

const client = getWebApiClient();
const pairing = usePairing();
const tasks = ref<QueueTask[]>([]);
const error = ref('');
const loading = ref(false);
const listEl = ref<{ focus?: () => void } | null>(null);
const announce = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let refreshSeq = 0;
let mountedFlag = true;

// The full authoritative in-flight set: queued/running/cancelling plus the
// occupied-but-exited states AND failed (the manual-retry entry lives there).
// Terminal succeeded/cancelled have no in-page action and stay hidden.
const DISPLAY_STATES = new Set(['queued', 'running', 'cancelling', 'needs_review', 'interrupted', 'failed']);
const CANCELLABLE_STATES = new Set(['queued', 'running', 'cancelling']);
const CONFIG_RETRY_CODES = new Set(['auth_or_config_invalid', 'config_revision_unknown']);

// --- async attribution (§5.2/§11) -----------------------------------------

let actionSeq = 0;
const generations = new Map<string, number>();
// The pending slot is owned by the action binding that created it: a binding
// change sweeps it (§11.1) and a late continuation may only clear its own.
const pending = ref<Record<string, { binding: string; label: string }>>({});
const rowErrors = ref<Record<string, { binding: string; message: string }>>({});

function issue(key: string): number {
  const generation = ++actionSeq;
  generations.set(key, generation);
  return generation;
}

function live(key: string, generation: number, epoch: unknown): boolean {
  return mountedFlag && pairing.syncEpoch === epoch && generations.get(key) === generation;
}

function clearOwnedPending(taskId: string, binding: string) {
  if (pending.value[taskId]?.binding === binding) delete pending.value[taskId];
}

// --- row mapping and labels ------------------------------------------------

function mapRow(task: Record<string, unknown>): QueueTask {
  const attemptExitState = String(task.attemptExitState ?? '');
  // One shared validation for every entry surface: the same parser the store
  // mapping uses, so a queue row can never trust evidence the client layer
  // would reject (V2 §3.1.1).
  const evidence = parseAttemptExitEvidence(task.attemptExitEvidence, attemptExitState);
  return {
    taskId: String(task.taskId),
    kind: String(task.type ?? ''),
    state: String(task.state),
    queuePosition: (task.queuePosition as number | null) ?? null,
    version: Number(task.version ?? 0),
    attemptCount: Number(task.attemptCount ?? 0),
    attemptId: (task.attemptId as string | null) ?? null,
    attemptExitState,
    attemptExitEvidence: evidence.evidence,
    attemptExitEvidenceError: evidence.error,
    cancelIntent: task.cancelIntent === true,
    configRevision: String(task.configRevision ?? ''),
    result: task.result ?? null,
    resultPendingExit: task.resultPendingExit === true,
    failure: (task.failure as QueueTask['failure']) ?? null,
    recovery: (task.recovery as Record<string, unknown> | null) ?? null,
  };
}

function stateLabel(task: QueueTask): string {
  switch (task.state) {
    case 'queued': return '排队中';
    case 'running': return '进行中';
    case 'cancelling': return '取消中';
    // interrupted means restart with the exit CONFIRMED (frozen §3.2) — the
    // unknown-exit wording belongs to needs_review(exited_unknown) only.
    case 'interrupted': return '重启恢复中';
    case 'needs_review': return task.attemptExitState === 'exited_unknown' ? '退出未知·待系统核实' : '待核对';
    case 'failed': return '失败';
    default: return task.state;
  }
}

function failedNote(task: QueueTask): string {
  if (task.state !== 'failed') return '';
  if (task.failure?.retryable === 'auto_backoff') return '失败·将自动重试';
  if (task.failure?.retryable === 'manual') return '';
  return '失败·无法重试';
}

function occupiedUnknown(task: QueueTask): boolean {
  // V2 §3.1.2/§3.2: the slot follows the attempt's exit state, and an
  // unconfirmed exit ALWAYS holds the slot — this is displayed from the
  // attemptExitState field itself, never inferred from a truthy evidence
  // object or from the business state.
  return task.attemptExitState === 'exited_unknown';
}

/// Readable veto reason for an unresolved evidence object (V2 §3.1.1). Only a
/// VALIDATED unresolved evidence produces text — a truthy-looking object that
/// failed validation renders nothing here (the rejection line shows instead).
function exitVetoText(task: QueueTask): string {
  const evidence = task.attemptExitEvidence;
  if (task.attemptExitState !== 'exited_unknown' || evidence?.verdict !== 'unresolved') return '';
  const reason = evidence.veto.reason;
  if (!reason) return '';
  // `known_survivor` names an OBSERVED live process, which the evidence may
  // locate in the registered set, in the stray ledger, or only in the argv
  // scan. The wording must describe where the survivor actually is — a
  // registered member is never claimed alive unless `registry.survivors`
  // reports one (§3.1.1 invariant 2: a group/argv observation failure is not
  // a member unknown).
  if (reason === 'known_survivor') {
    if (evidence.registry.survivors.length > 0) return '登记进程集中仍有存活的成员';
    if (evidence.residual.strayLedger !== null && evidence.residual.strayLedger.pending > 0) return '发现未登记的残余进程仍存活且未清扫';
    if (evidence.argvScan !== null && evidence.argvScan.performed && evidence.argvScan.hits > 0) return 'argv 扫描命中仍存活的进程';
    if (evidence.groupAbsent === false) return '进程组仍存在，已知有未登记进程存活';
    return '存在已知存活证据，退出未确认';
  }
  const map: Record<string, string> = {
    insufficient_evidence: '退出证据不足，无法确认',
    identity_mismatch: '登记成员身份核对未完成，无法确认退出',
    eperm: '退出观察或清扫被操作系统拒绝',
  };
  return map[reason] ?? reason;
}

/// The read-only honest disclosure for a validated exit-evidence object
/// (V2 §3.1.2). Built ONLY from validated evidence — `registry_extinct` for a
/// confirmed exit, `unresolved` for an unconfirmed one — and available for
/// EVERY row that carries valid evidence, independent of whether the row is
/// disposable (a failed/terminal row still discloses what was observed).
/// Every wording below is honest about the boundary: the registry domain may
/// be confirmed while the whole process tree is NOT proven extinct, a
/// zero-count stray sweep is not proof of absence, and an unresolved exit
/// keeps the slot with the observed facts only. Returns null when there is no
/// valid evidence to disclose (the rejection line speaks instead).
function exitEvidenceView(task: QueueTask): {
  boundarySentence: string;
  registryLine: string;
  argvLine: string;
  strayLine: string;
  strayBoundary: string;
  pendingWarning: string;
  confirmedAtLine: string;
} | null {
  const evidence = task.attemptExitEvidence;
  if (!evidence) return null;
  const confirmed = task.attemptExitState === 'exited_confirmed' && evidence.verdict === 'registry_extinct';
  const unresolved = task.attemptExitState === 'exited_unknown' && evidence.verdict === 'unresolved';
  if (!confirmed && !unresolved) return null;
  const registry = evidence.registry;
  const registryLine = `登记进程 ${registry.total} 个：确认退出 ${registry.confirmedExtinct} · 存活 ${registry.survivors.length} · 无法观察 ${registry.unobservable}。`;
  const argvLine = evidence.argvScan === null
    ? 'argv 扫描：本轮未执行（作为补充信号，未执行不构成确认，也不单独构成否决以外的事实）。'
    : evidence.argvScan.performed
      ? `argv 扫描：已执行，命中 ${evidence.argvScan.hits}。`
      : 'argv 扫描：执行失败或被操作系统拒绝（按否决处理，不作为确认依据）。';
  const ledger = evidence.residual.strayLedger;
  const strayLine = ledger === null
    ? '残余清扫台账：本 attempt 暂无清扫台账记录（未扫）。'
    : `残余清扫台账：发现 ${ledger.found} · 已清扫 ${ledger.swept} · 待清扫 ${ledger.pending}。`;
  // found=0 is NOT "no residue": unregistered escapees are undiscoverable by
  // definition — the boundary must always be stated, never a clean claim.
  const strayBoundary = '未登记的后代进程不在台账范围内，发现为 0 不等于不存在残余。';
  const pendingWarning = ledger !== null && ledger.pending > 0
    ? `仍有 ${ledger.pending} 项已发现未清扫的残余，槽位不得释放。`
    : '';
  const confirmedAtLine = evidence.confirmedAt ? `登记域确认时间：${evidence.confirmedAt}。` : '';
  const boundarySentence = confirmed
    ? '已确认登记进程集全部退出；不证明全部后代进程已退出。'
    : '退出未确认，槽位保持占用；以下为已观测事实，不构成退出确认。';
  return { boundarySentence, registryLine, argvLine, strayLine, strayBoundary, pendingWarning, confirmedAtLine };
}

// --- review authority (§3.2 rules: no fallback values) ---------------------

interface ReviewState {
  decisionOptions: string[];
  itemVersion: number | null;
  receipts: ReceiptView[] | null;
  staged: boolean;
  authorityOk: boolean;
  /// V2 §4.5: a disposition is only available behind a CONFIRMED registry-
  /// domain exit with VALID typed evidence — never behind a truthy evidence
  /// object, never behind the state string alone.
  evidenceOk: boolean;
}

function recoveryMember(task: QueueTask, member: string): unknown {
  return task.recovery ? task.recovery[member] : undefined;
}

function reviewState(task: QueueTask): ReviewState {
  const rawOptions = recoveryMember(task, 'decisionOptions');
  const decisionOptions = Array.isArray(rawOptions) ? rawOptions.filter((o): o is string => typeof o === 'string') : [];
  // §3.2 (r2): the authoritative item version is the ONLY accepted source — a
  // missing/malformed member is null (entries disabled + fenced re-read), it
  // never falls back to 1. "缺失不等于 1".
  const rawItemVersion = recoveryMember(task, 'itemVersion');
  const itemVersion = typeof rawItemVersion === 'number' && Number.isInteger(rawItemVersion) && rawItemVersion >= 1
    ? rawItemVersion
    : null;
  const rawReceipts = recoveryMember(task, 'receipts');
  let receipts: ReceiptView[] | null = null;
  if (Array.isArray(rawReceipts)) {
    receipts = [];
    for (const entry of rawReceipts) {
      if (!entry || typeof entry !== 'object' || typeof (entry as Record<string, unknown>).receiptId !== 'string') {
        receipts = null;
        break;
      }
      const record = entry as Record<string, unknown>;
      receipts.push({
        receiptId: String(record.receiptId),
        kind: String(record.kind ?? ''),
        verifiable: record.verifiable !== false,
      });
    }
  }
  const staged = task.resultPendingExit === true && recoveryMember(task, 'cause') === 'result_exit_unconfirmed';
  const authorityOk = decisionOptions.length > 0 && itemVersion !== null && receipts !== null;
  const evidenceOk = task.attemptExitState === 'exited_confirmed'
    && task.attemptExitEvidence?.verdict === 'registry_extinct';
  return { decisionOptions, itemVersion, receipts, staged, authorityOk, evidenceOk };
}

function reviewAvailable(task: QueueTask): boolean {
  return task.state === 'needs_review' && task.attemptExitState === 'exited_confirmed';
}

/// §4.3: the review face explains the recovery cause in words.
function causeText(task: QueueTask): string {
  const map: Record<string, string> = {
    restart_unknown_side_effect: '重启时外部副作用结果不明，需人工核对。',
    cancel_unknown_side_effect: '取消已退出，但副作用结果未知，需人工核对。',
    exit_unconfirmed: '登记域退出已确认，无暂存结局；可恢复执行或放弃取消。',
    failure_unknown_side_effect: '失败点之后存在无法证明只读的外部调用，需人工核对。',
    result_exit_unconfirmed: '结果已暂存且退出已确认，核对后可提交或放弃。',
    backup_restore: '备份恢复隔离待核对。',
    root_activation: '根激活历史连续性未证明，禁止自动重发。',
    root_import: '导入根副本，适用与根激活相同的边界。',
  };
  const cause = String(recoveryMember(task, 'cause') ?? '');
  return map[cause] ?? '恢复场景需人工核对。';
}

function requiredReceipts(task: QueueTask): ReceiptView[] {
  return reviewState(task).receipts?.filter((receipt) => receipt.verifiable) ?? [];
}

// --- session binding (§11.1) -----------------------------------------------

const contents = ref<Record<string, ContentSession>>({});
const acks = ref<Record<string, { binding: string; checked: Record<string, boolean> }>>({});
const expanded = ref<Record<string, boolean>>({});
const contentOpen = ref<Record<string, boolean>>({});
const authorityReRead = new Set<string>();

function bindingOf(task: QueueTask): string {
  const itemVersion = recoveryMember(task, 'itemVersion');
  const itemId = recoveryMember(task, 'itemId');
  return [
    pairing.syncEpoch ?? '',
    task.taskId,
    `v${task.version}`,
    `a${task.attemptId ?? ''}`,
    `i${typeof itemVersion === 'number' ? itemVersion : ''}`,
    typeof itemId === 'string' ? `r${itemId}` : '',
  ].join('|');
}

function sweepSessions() {
  for (const id of Object.keys(contents.value)) {
    const task = tasks.value.find((row) => row.taskId === id);
    if (!task || contents.value[id].binding !== bindingOf(task)) delete contents.value[id];
  }
  for (const id of Object.keys(acks.value)) {
    const task = tasks.value.find((row) => row.taskId === id);
    if (!task || acks.value[id].binding !== bindingOf(task)) delete acks.value[id];
  }
  for (const id of Object.keys(rowErrors.value)) {
    const task = tasks.value.find((row) => row.taskId === id);
    if (!task || rowErrors.value[id].binding !== bindingOf(task)) delete rowErrors.value[id];
  }
  // §11.1: a binding change also voids the action pending owned by the old
  // binding and invalidates its generation, so a late resolve/retry/cancel
  // continuation can neither keep the new row's entries disabled nor write the
  // old failure onto the new row.
  for (const id of Object.keys(pending.value)) {
    const task = tasks.value.find((row) => row.taskId === id);
    if (task && pending.value[id].binding === bindingOf(task)) continue;
    delete pending.value[id];
    for (const key of generations.keys()) {
      if (key.startsWith(`${id}:`)) generations.delete(key);
    }
  }
  // The content panel follows its session: a stale binding closes it, so the
  // only way back in is a fresh load against the new binding.
  for (const id of Object.keys(contentOpen.value)) {
    if (contents.value[id] === undefined) delete contentOpen.value[id];
  }
}

function requestAuthorityReReads() {
  for (const task of tasks.value) {
    if (!reviewAvailable(task)) continue;
    if (reviewState(task).authorityOk) continue;
    const binding = bindingOf(task);
    if (authorityReRead.has(binding)) continue;
    authorityReRead.add(binding);
    void refresh();
  }
}

function isChecked(task: QueueTask, receiptId: string): boolean {
  const session = acks.value[task.taskId];
  return session !== undefined && session.binding === bindingOf(task) && session.checked[receiptId] === true;
}

function allVerifiedChecked(task: QueueTask): boolean {
  return requiredReceipts(task).every((receipt) => isChecked(task, receipt.receiptId));
}

function setChecked(task: QueueTask, receiptId: string, value: boolean) {
  const binding = bindingOf(task);
  const session = acks.value[task.taskId];
  if (session === undefined || session.binding !== binding) {
    acks.value[task.taskId] = { binding, checked: { [receiptId]: value } };
    return;
  }
  session.checked[receiptId] = value;
}

function resumeEnabled(task: QueueTask): boolean {
  const review = reviewState(task);
  return review.authorityOk
    && review.evidenceOk
    && review.decisionOptions.includes('resume')
    && pending.value[task.taskId] === undefined
    && allVerifiedChecked(task);
}

function cancelDecisionEnabled(task: QueueTask): boolean {
  const review = reviewState(task);
  return review.authorityOk
    && review.evidenceOk
    && review.decisionOptions.includes('cancel')
    && pending.value[task.taskId] === undefined;
}

// --- per-ID install fence (V2 §3.1.1 / task acceptance 2) -------------------
//
// The queue display follows the authoritative list, but a stale read must
// never displace a newer installed generation: a lower version, the same
// version under a different attempt id, or a SAME-ATTEMPT evidence regression
// is rejected. Every ID seen in the CURRENT epoch keeps its version/attempt
// watermark AND its last installed row: a list that OMITS a known ID does not
// erase that history (a late/partial list can omit a task that is still
// current). Only an explicit epoch/session reload clears it (see the
// syncEpoch watcher).
interface InstalledRowBaseline {
  version: number;
  attemptId: string | null;
  verdict: string | null;
}

interface InstalledRow {
  baseline: InstalledRowBaseline;
  row: QueueTask;
}

let installedRows = new Map<string, InstalledRow>();

function baselineOf(task: QueueTask): InstalledRowBaseline {
  return {
    version: task.version,
    attemptId: task.attemptId,
    verdict: task.attemptExitEvidence?.verdict ?? null,
  };
}

/// True when the incoming row would move the installed generation BACKwards.
/// Mirrors the organizer store's generation fence (§3.1.1 invariant 6): the
/// version is the migration authority and the attempt id names the generation.
/// The verdict-irreversibility rule is PER-ATTEMPT: a NEW attempt (a different
/// attemptId — e.g. a normal failure retry) starts with no exit evidence and
/// must not be judged against the previous attempt's verdict.
function isRegression(base: InstalledRowBaseline, task: QueueTask): boolean {
  if (task.version < base.version) return true;
  if (task.version === base.version && task.attemptId !== base.attemptId) return true;
  if (task.attemptId !== base.attemptId) return false;
  const nextVerdict = task.attemptExitEvidence?.verdict ?? null;
  if (base.verdict === 'registry_extinct' && nextVerdict !== 'registry_extinct') return true;
  if (base.verdict === 'unresolved' && nextVerdict === null) return true;
  return false;
}

/// Install one authoritative read under the per-ID fence.
///
/// A read that carries ANY regressing row is not authoritative about the queue
/// as a whole: it is dropped outright (fail closed), and the installed rows
/// the fence protects are restored into the display (an earlier omission may
/// have dropped them), so a stale read can neither overwrite newer evidence
/// nor reauthorize an old attempt.
///
/// Otherwise the carried rows install and every seen ID's row + watermark is
/// retained for the epoch; the display follows the read, so a row the read
/// carries in a terminal state leaves the display. Only an explicit
/// epoch/session reload clears the baseline.
function installRows(collected: QueueTask[]) {
  const regressed = new Set<string>();
  for (const task of collected) {
    const installed = installedRows.get(task.taskId);
    if (installed !== undefined && isRegression(installed.baseline, task)) regressed.add(task.taskId);
  }
  if (regressed.size > 0) {
    const merged = new Map<string, QueueTask>();
    for (const row of tasks.value) merged.set(row.taskId, row);
    for (const id of regressed) {
      const installed = installedRows.get(id);
      if (installed !== undefined) merged.set(id, installed.row);
    }
    tasks.value = [...merged.values()].filter((task) => DISPLAY_STATES.has(task.state));
    return;
  }
  for (const task of collected) {
    installedRows.set(task.taskId, { baseline: baselineOf(task), row: task });
  }
  tasks.value = collected.filter((task) => DISPLAY_STATES.has(task.state));
}

// --- fenced read-back (existing fences preserved verbatim) -----------------

async function refresh() {
  const seq = ++refreshSeq;
  const epochAtStart = pairing.syncEpoch;
  loading.value = true;
  try {
    const collected: QueueTask[] = [];
    let cursor: string | undefined = undefined;
    // Walk every page: the authoritative queue is the whole list, not the
    // first page. The page cap is a runaway guard, not a display limit.
    for (let page = 0; page < 200; page += 1) {
      const payload = await client.listTasks(undefined, cursor, 100);
      if (seq !== refreshSeq || epochAtStart !== pairing.syncEpoch) return;
      for (const raw of payload.tasks ?? []) {
        collected.push(mapRow(raw as unknown as Record<string, unknown>));
      }
      if (!payload.nextCursor) break;
      cursor = payload.nextCursor;
    }
    installRows(collected);
    error.value = '';
    sweepSessions();
    requestAuthorityReReads();
  } catch (reason) {
    if (seq !== refreshSeq || epochAtStart !== pairing.syncEpoch) return;
    error.value = reason instanceof Error ? reason.message : '队列暂时无法读取。';
  } finally {
    if (seq === refreshSeq && epochAtStart === pairing.syncEpoch) loading.value = false;
  }
}

// --- 409 discipline (§3): re-read, never blind replay ----------------------

function conflictHint(code: string, fallback: string): { message: string; reread: boolean } {
  switch (code) {
    case 'version_conflict':
      return { message: '版本已过期：该对象已被其他操作更新，已重新读取，请基于新状态重新操作。', reread: true };
    case 'state_conflict':
      return { message: '任务状态已变化，已重新读取。', reread: true };
    case 'exit_unconfirmed':
      return { message: '退出尚未确认，等待系统核实。', reread: true };
    case 'config_revision_change_not_allowed':
      return { message: '该失败类型不允许更换配置重跑。', reread: false };
    default:
      return { message: fallback, reread: false };
  }
}

function errorCode(reason: unknown): string {
  return reason && typeof reason === 'object' && 'code' in reason ? String((reason as { code: unknown }).code) : '';
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function rowAction(task: QueueTask, action: 'cancel' | 'retry' | 'resolve', run: () => Promise<unknown>, busyName: string) {
  const key = `${task.taskId}:${action}`;
  if (pending.value[task.taskId] !== undefined) return;
  const binding = bindingOf(task);
  pending.value[task.taskId] = { binding, label: busyName };
  delete rowErrors.value[task.taskId];
  const generation = issue(key);
  const epochAtStart = pairing.syncEpoch;
  // §11.1: a continuation may write state only while the row it acted on is
  // still the current binding — a late response must never land on a new row.
  const bindingCurrent = () => {
    const current = tasks.value.find((row) => row.taskId === task.taskId);
    return current !== undefined && bindingOf(current) === binding;
  };
  void (async () => {
    try {
      await run();
      if (!live(key, generation, epochAtStart)) return;
      clearOwnedPending(task.taskId, binding);
      await refresh();
      // The refresh is a SECOND await window: a legal snapshot may have flipped
      // the epoch, or a newer action superseded this one, while it ran. Every
      // UI write below is re-fenced before it lands (§5.2/U9).
      if (!live(key, generation, epochAtStart)) return;
      const current = tasks.value.find((row) => row.taskId === task.taskId);
      // A row replaced under the same taskId by a NEW binding belongs to a new
      // session: the old action must neither announce nor steer focus onto it.
      // A row that left the display set entirely is the legitimate terminal
      // departure and keeps its focus fallback.
      if (current !== undefined && bindingOf(current) !== binding) return;
      // Focus discipline (§6): the row is keyed by taskId, so focus stays
      // while the row and its control remain; if the action consumed the
      // focused control but the row remains, focus moves to the row's first
      // live control; if the row left the display set, focus falls to the
      // list container with the aria-live announcement.
      const owner = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
      const stillThere = current !== undefined;
      if (!stillThere) {
        announce.value = `整理任务 ${task.kind} 的动作已完成，队列已刷新。`;
        if (typeof listEl.value?.focus === 'function') listEl.value.focus();
      } else if (owner && !owner.isConnected) {
        const rowEl = typeof document !== 'undefined' ? document.getElementById(`task-row-${task.taskId}`) : null;
        const target = rowEl?.querySelector<HTMLButtonElement>('button:not([disabled])') ?? null;
        target?.focus();
      }
    } catch (reason) {
      if (!live(key, generation, epochAtStart)) return;
      // Never clear a newer action's pending nor write the old failure onto a
      // row whose binding moved on (§11.1).
      if (!bindingCurrent()) return;
      clearOwnedPending(task.taskId, binding);
      const hint = conflictHint(errorCode(reason), errorMessage(reason, '操作暂未完成，请重试。'));
      rowErrors.value[task.taskId] = { binding, message: hint.message };
      if (hint.reread) void refresh();
    }
  })();
}

function cancel(task: QueueTask) {
  rowAction(task, 'cancel', () => client.cancelTask(task.taskId, task.version), 'cancel');
}

const rerunRevision = computed(() => {
  const value = typeof props.configRevision === 'string' ? props.configRevision.trim() : '';
  return value ? value : null;
});

function rerunEligible(task: QueueTask): boolean {
  return task.state === 'failed'
    && task.failure?.retryable === 'manual'
    && CONFIG_RETRY_CODES.has(String(task.failure?.code ?? ''));
}

function rerunEnabled(task: QueueTask): boolean {
  return rerunEligible(task) && rerunRevision.value !== null && rerunRevision.value !== task.configRevision;
}

function retry(task: QueueTask, withNewConfig: boolean) {
  const useRevision = withNewConfig && rerunEnabled(task) ? rerunRevision.value ?? undefined : undefined;
  rowAction(task, 'retry', () => client.retryTask(task.taskId, task.version, useRevision), 'retry');
}

function resolve(task: QueueTask, decision: 'resume' | 'cancel') {
  // Re-derive from the CURRENT row: the binding is re-checked right before
  // the send, so stale ACKs can never ride to a new entry (§11.1).
  const current = tasks.value.find((row) => row.taskId === task.taskId);
  if (!current || bindingOf(current) !== bindingOf(task)) return;
  const review = reviewState(current);
  // V2 §4.5: without a valid confirmed exit the server would answer 409
  // exit_unconfirmed — the entry refuses locally instead of sending.
  if (!review.evidenceOk) return;
  if (!review.authorityOk || !review.decisionOptions.includes(decision) || review.itemVersion === null) return;
  const acknowledged = decision === 'resume'
    ? requiredReceipts(current).filter((receipt) => isChecked(current, receipt.receiptId)).map((receipt) => receipt.receiptId)
    : [];
  const itemVersion = review.itemVersion;
  rowAction(current, 'resolve', () => client.resolveTask(current.taskId, itemVersion, decision, acknowledged), 'resolve');
}

function toggleReview(task: QueueTask) {
  expanded.value[task.taskId] = !expanded.value[task.taskId];
}

// --- full-content verification (§4.3专段/§11.1) ----------------------------

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function contentSession(task: QueueTask): ContentSession {
  const binding = bindingOf(task);
  const session = contents.value[task.taskId];
  if (session === undefined || session.binding !== binding) {
    const fresh: ContentSession = { binding, loading: false, done: false, text: '', loaded: 0, total: 0 };
    contents.value[task.taskId] = fresh;
    return fresh;
  }
  return session;
}

async function loadFullContent(task: QueueTask) {
  const key = `${task.taskId}:result`;
  const session = contentSession(task);
  if (session.loading || session.done) return;
  const binding = session.binding;
  // A (re)start always reads from offset 0 with a fresh decoder: the partial
  // prefix of a failed attempt must never survive into the new accumulation,
  // and this session's own load error is cleared with it (§11.1/U10). The
  // complete marker and byte counters are re-derived from the segments below.
  session.text = '';
  session.loaded = 0;
  session.total = 0;
  session.done = false;
  if (rowErrors.value[task.taskId]?.binding === binding) delete rowErrors.value[task.taskId];
  session.loading = true;
  const generation = issue(key);
  const epochAtStart = pairing.syncEpoch;
  const bindingCurrent = () => {
    const current = tasks.value.find((row) => row.taskId === task.taskId);
    return current !== undefined && bindingOf(current) === binding;
  };
  void (async () => {
    try {
      const first = await client.readTaskResult(task.taskId) as Record<string, unknown>;
      if (!live(key, generation, epochAtStart) || !bindingCurrent()) return;
      if (first.inline === true && typeof first.payload === 'string') {
        session.text = first.payload;
        session.total = Number(first.totalBytes ?? byteLength(first.payload));
        session.loaded = session.total;
        session.done = true;
        session.loading = false;
        return;
      }
      const total = Number(first.totalBytes ?? 0);
      const segmentBytes = Number(first.maxSegmentBytes ?? 65536);
      session.total = total;
      let offset = Number(first.nextOffset ?? 0);
      const decoder = new TextDecoder('utf-8');
      let done = first.done === true;
      while (!done) {
        const segment = await client.readTaskResult(task.taskId, offset, segmentBytes) as Record<string, unknown>;
        if (!live(key, generation, epochAtStart) || !bindingCurrent()) return;
        const bytes = typeof segment.payloadBase64 === 'string' ? decodeBase64(segment.payloadBase64) : new Uint8Array(0);
        session.text += decoder.decode(bytes, { stream: true });
        session.loaded += bytes.length;
        done = segment.done === true;
        const next = segment.nextOffset;
        if (done || typeof next !== 'number') break;
        offset = next;
      }
      if (!live(key, generation, epochAtStart) || !bindingCurrent()) return;
      if (done) {
        session.text += decoder.decode();
        session.done = true;
      }
      session.loading = false;
    } catch (reason) {
      if (!live(key, generation, epochAtStart) || !bindingCurrent()) return;
      session.loading = false;
      rowErrors.value[task.taskId] = { binding, message: errorMessage(reason, '结果内容暂时无法读取。') };
    }
  })();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function toggleFullContent(task: QueueTask) {
  contentOpen.value[task.taskId] = !contentOpen.value[task.taskId];
  if (contentOpen.value[task.taskId]) void loadFullContent(task);
}

// --- concurrency view (§4.5/§11.2 shared install ownership) ---------------

const concurrency = ref<{ value: number; fallback: number; version: number; runningCount: number; queuedCount: number } | null>(null);
const concurrencyDraft = ref('');
const concurrencyPanelOpen = ref(false);
const concurrencyReadPending = ref(false);
const concurrencyWritePending = ref(false);
const concurrencyError = ref('');
const downscaleHint = ref('');
let viewTicket = 0;
let concurrencyWatermark: { epoch: unknown; version: number } | null = null;
// A convergence read requested while another read is still in flight is held
// and replayed when that read settles, so a discarded write still lands one
// authoritative read AFTER the overlapping read (§11.2).
let concurrencyReReadQueued = false;

const READ_KEY = 'concurrency:read';
const WRITE_KEY = 'concurrency:write';

/// §11.2: data, errors and pending all share ONE view ownership — a response
/// only speaks for the view while its ticket is still the newest one.
function ownsView(ticket: number): boolean {
  return mountedFlag && ticket === viewTicket;
}

function installConcurrencyView(payload: Record<string, unknown>, key: string, generation: number, ticket: number, epoch: unknown): boolean {
  if (!mountedFlag || pairing.syncEpoch !== epoch) return false;
  if (generations.get(key) !== generation) return false;
  if (ticket !== viewTicket) return false;
  const version = Number(payload.version);
  if (concurrencyWatermark !== null
    && concurrencyWatermark.epoch === epoch
    && version < concurrencyWatermark.version) {
    // §11.2: within one epoch a lower settings version is never installed.
    return false;
  }
  concurrency.value = {
    value: Number(payload.agentConcurrency),
    fallback: Number(payload.default),
    version,
    runningCount: Number(payload.runningCount ?? 0),
    queuedCount: Number(payload.queuedCount ?? 0),
  };
  concurrencyWatermark = { epoch, version };
  return true;
}

/// The unified convergence re-read. When a read is already in flight the
/// request is queued and replayed from that read's finally, guaranteeing one
/// authoritative read happens after the overlapping one instead of being
/// swallowed by the pending flag.
function queueConcurrencyReRead() {
  if (!mountedFlag) return;
  if (concurrencyReadPending.value) {
    concurrencyReReadQueued = true;
    return;
  }
  void readConcurrencyView();
}

async function readConcurrencyView() {
  if (!mountedFlag || concurrencyReadPending.value) return;
  concurrencyReadPending.value = true;
  // Deliberately NOT clearing the error here: the 409 hint must survive its
  // own convergence re-read (§3/§4.5). Errors clear when the next write
  // attempt starts, the epoch re-baselines, or the user retries by hand.
  const generation = issue(READ_KEY);
  const ticket = ++viewTicket;
  const epochAtStart = pairing.syncEpoch;
  try {
    const payload = await client.readConcurrency() as unknown as Record<string, unknown>;
    if (!live(READ_KEY, generation, epochAtStart)) return;
    installConcurrencyView(payload, READ_KEY, generation, ticket, epochAtStart);
  } catch (reason) {
    if (!live(READ_KEY, generation, epochAtStart)) return;
    if (!ownsView(ticket)) return;
    concurrencyError.value = errorMessage(reason, '并发设置暂时无法读取。');
  } finally {
    if (live(READ_KEY, generation, epochAtStart)) concurrencyReadPending.value = false;
    if (mountedFlag && pairing.syncEpoch === epochAtStart && concurrencyReReadQueued) {
      concurrencyReReadQueued = false;
      void readConcurrencyView();
    }
  }
}

/// User-initiated retry from the empty/failed panel: the stale failure is
/// replaced by the pending state and a fresh authoritative read runs.
function retryConcurrencyRead() {
  if (!mountedFlag || concurrencyReadPending.value) return;
  concurrencyError.value = '';
  void readConcurrencyView();
}

function clampConcurrency(value: number): number {
  return Math.min(32, Math.max(1, value));
}

async function writeConcurrencyView() {
  if (!mountedFlag || concurrencyWritePending.value) return;
  const parsed = Number(concurrencyDraft.value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
    if (Number.isFinite(parsed) && parsed > 0) {
      concurrencyDraft.value = String(clampConcurrency(parsed));
      concurrencyError.value = '并发需为 1–32 的整数，已就地纠正。';
    } else {
      concurrencyError.value = '并发需为 1–32 的整数。';
    }
    return;
  }
  const current = concurrency.value;
  if (current === null) return;
  concurrencyWritePending.value = true;
  concurrencyError.value = '';
  downscaleHint.value = '';
  const generation = issue(WRITE_KEY);
  const ticket = ++viewTicket;
  const epochAtStart = pairing.syncEpoch;
  try {
    const payload = await client.writeConcurrency(parsed, current.version) as unknown as Record<string, unknown>;
    // A write discarded by the ownership guard converges through the shared
    // fenced re-read, never by merely clearing pending (§11.2).
    if (!live(WRITE_KEY, generation, epochAtStart)) {
      if (mountedFlag && pairing.syncEpoch === epochAtStart) queueConcurrencyReRead();
      return;
    }
    if (installConcurrencyView(payload, WRITE_KEY, generation, ticket, epochAtStart)) {
      concurrencyDraft.value = '';
      announce.value = `并发设置已更新为 ${concurrency.value?.value}。`;
      void refresh();
      const running = Number(payload.runningCount ?? 0);
      const limit = Number(payload.agentConcurrency ?? 0);
      if (running > limit) {
        downscaleHint.value = '下调不中断正在执行的任务，待自然退出后生效。';
      }
    } else {
      queueConcurrencyReRead();
    }
  } catch (reason) {
    if (!live(WRITE_KEY, generation, epochAtStart)) return;
    // §11.2: an error speaks for the shared view only while its ticket is the
    // newest one — a late PUT failure must not surface over a newer install.
    if (!ownsView(ticket)) return;
    const code = errorCode(reason);
    if (code === 'version_conflict') {
      concurrencyError.value = '设置已被其他窗口修改，已重新读取；请确认后再次提交。';
      queueConcurrencyReRead();
    } else if (code === 'validation_failed') {
      concurrencyError.value = '并发需为 1–32 的整数。';
    } else {
      concurrencyError.value = errorMessage(reason, '并发设置暂未保存，请重试。');
    }
  } finally {
    if (live(WRITE_KEY, generation, epochAtStart)) concurrencyWritePending.value = false;
  }
}

function onDraftInput(event: Event) {
  const value = (event.target as { value?: unknown } | null)?.value;
  concurrencyDraft.value = typeof value === 'string' ? value : String(value ?? '');
}

// --- lifecycle -------------------------------------------------------------

watch(() => pairing.syncEpoch, () => {
  // Cross-epoch responses never land; pending clears wholesale and display
  // is rebuilt by the new epoch's fenced read-back (§5.2). The concurrency
  // watermark baseline is re-established in the new epoch (§11.2).
  pending.value = {};
  rowErrors.value = {};
  concurrencyReadPending.value = false;
  concurrencyWritePending.value = false;
  concurrencyReReadQueued = false;
  concurrencyError.value = '';
  downscaleHint.value = '';
  concurrencyWatermark = null;
  // The per-ID install baseline belongs to the epoch that built it: a new
  // epoch is the EXPLICIT reload that clears it (and the display), so the new
  // generation installs from a clean slate. An ordinary read never clears it.
  installedRows = new Map();
  tasks.value = [];
  sweepSessions();
});

onMounted(() => {
  mountedFlag = true;
  void refresh();
  void readConcurrencyView();
  timer = setInterval(() => { void refresh(); }, 1000);
  // The invalidation seam covers BOTH task and settings notifications: an
  // external settings change must converge through the same queueable re-read
  // as a discarded write, so a notification landing while a read is in flight
  // is held and replayed instead of being dropped (§4.5/§11.2).
  pairing.setOnTasksInvalidated(() => { void refresh(); queueConcurrencyReRead(); });
});

onUnmounted(() => {
  mountedFlag = false;
  if (timer) clearInterval(timer);
  pairing.setOnTasksInvalidated(null);
});
</script>

<template>
  <section class="task-queue" aria-label="整理队列" :aria-busy="loading">
    <div class="queue-head">
      <h2>整理队列</h2>
      <button
        class="text-button"
        type="button"
        aria-label="并发设置"
        :aria-expanded="concurrencyPanelOpen ? 'true' : 'false'"
        aria-controls="task-queue-concurrency"
        @click="concurrencyPanelOpen = !concurrencyPanelOpen"
      >并发</button>
    </div>
    <div
      v-if="concurrencyPanelOpen"
      id="task-queue-concurrency"
      class="concurrency-panel"
    >
      <template v-if="concurrency">
        <span class="queue-meta">当前 {{ concurrency.value }} · 缺省 {{ concurrency.fallback }} · 版本 {{ concurrency.version }}</span>
        <span class="queue-meta">运行中 {{ concurrency.runningCount }} · 排队中 {{ concurrency.queuedCount }}</span>
        <span class="concurrency-input">
          <label class="queue-meta" for="task-queue-concurrency-input">并发上限</label>
          <input
            id="task-queue-concurrency-input"
            type="number"
            min="1"
            max="32"
            step="1"
            :value="concurrencyDraft"
            :aria-invalid="concurrencyError ? 'true' : undefined"
            @input="onDraftInput"
          >
        </span>
        <button
          class="text-button"
          type="button"
          aria-label="应用并发设置"
          :disabled="concurrencyWritePending || concurrencyReadPending"
          @click="writeConcurrencyView"
        >应用</button>
        <p v-if="downscaleHint" class="queue-meta">{{ downscaleHint }}</p>
        <p v-if="concurrencyError" class="form-error" role="alert">{{ concurrencyError }}</p>
      </template>
      <template v-else>
        <!-- No view yet: a failed first read must surface its feedback and a
             explicit re-read entry instead of posing as an endless pending
             state (§4.5/§11.2). -->
        <p v-if="concurrencyError" class="form-error" role="alert">{{ concurrencyError }}</p>
        <p v-else class="muted">并发设置读取中…</p>
        <button
          v-if="concurrencyError"
          class="text-button"
          type="button"
          aria-label="重试读取并发设置"
          :disabled="concurrencyReadPending"
          @click="retryConcurrencyRead"
        >重试</button>
      </template>
    </div>
    <p aria-live="polite" class="queue-announce">{{ announce }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="!tasks.length" class="muted">当前没有排队或进行中的整理任务。</p>
    <ul v-else ref="listEl" class="queue-list" tabindex="-1">
      <li
        v-for="task in tasks"
        :key="task.taskId"
        :id="`task-row-${task.taskId}`"
        :aria-busy="pending[task.taskId] !== undefined ? 'true' : undefined"
      >
        <div class="queue-row">
          <span class="queue-kind">{{ task.kind }}</span>
          <span class="queue-state">{{ stateLabel(task) }}</span>
          <span v-if="task.state === 'queued' && task.queuePosition" class="queue-position">第 {{ task.queuePosition }} 位</span>
          <span v-else-if="occupiedUnknown(task)" class="queue-position">占 1 个执行槽，等待系统核实退出</span>
          <span v-if="exitVetoText(task)" class="queue-meta">未确认原因：{{ exitVetoText(task) }}</span>
          <span v-if="task.cancelIntent && task.state === 'needs_review'" class="queue-meta">取消意图待核实</span>
          <span v-if="task.attemptCount > 0" class="queue-meta">第 {{ task.attemptCount }} 次尝试</span>
          <span v-if="failedNote(task)" class="queue-meta">{{ failedNote(task) }}</span>
          <span class="queue-actions">
            <button
              v-if="CANCELLABLE_STATES.has(task.state)"
              class="text-button"
              type="button"
              :aria-label="`取消整理任务 ${task.kind}`"
              :disabled="pending[task.taskId] !== undefined"
              @click="cancel(task)"
            >取消</button>
            <template v-if="task.state === 'failed'">
              <button
                v-if="task.failure?.retryable === 'manual'"
                class="text-button"
                type="button"
                :aria-label="`重试失败任务 ${task.kind}`"
                :disabled="pending[task.taskId] !== undefined"
                @click="retry(task, false)"
              >重试</button>
              <button
                v-if="rerunEligible(task)"
                class="text-button"
                type="button"
                :aria-label="`用新配置重跑整理任务 ${task.kind}`"
                :disabled="!rerunEnabled(task) || pending[task.taskId] !== undefined"
                :title="rerunEnabled(task) ? undefined : '保存新的模型配置后可用'"
                @click="retry(task, true)"
              >用新配置重跑</button>
            </template>
            <button
              v-if="reviewAvailable(task)"
              class="text-button"
              type="button"
              :aria-label="`核对整理任务 ${task.kind}`"
              :aria-expanded="expanded[task.taskId] ? 'true' : 'false'"
              :aria-controls="`task-review-${task.taskId}`"
              @click="toggleReview(task)"
            >{{ expanded[task.taskId] ? '收起核对' : '核对' }}</button>
          </span>
        </div>
        <p v-if="task.state === 'failed' && task.failure" class="queue-envelope">
          {{ task.failure.code }}：{{ task.failure.message }}
        </p>
        <!-- V2 §3.1.1: missing/malformed/self-contradictory evidence fails
             closed with the readable rejection reason — the row never guesses
             a state from what it could not validate. -->
        <p v-if="task.attemptExitEvidenceError" class="form-error" role="alert">{{ task.attemptExitEvidenceError }}</p>
        <!-- V2 §3.1.2: the read-only evidence disclosure is INDEPENDENT of
             disposition eligibility. Every row with VALID typed evidence —
             confirmed OR unresolved — discloses the observed facts and the
             honest boundary; a terminal/failed row is not exempt, and a
             rejected/absent object renders the rejection line above instead. -->
        <div v-if="exitEvidenceView(task)" class="task-evidence">
          <p class="queue-meta">{{ exitEvidenceView(task)?.boundarySentence }}</p>
          <p class="queue-meta">{{ exitEvidenceView(task)?.registryLine }}</p>
          <p class="queue-meta">{{ exitEvidenceView(task)?.argvLine }}</p>
          <p class="queue-meta">{{ exitEvidenceView(task)?.strayLine }} {{ exitEvidenceView(task)?.strayBoundary }}</p>
          <p v-if="exitEvidenceView(task)?.pendingWarning" class="form-error" role="alert">{{ exitEvidenceView(task)?.pendingWarning }}</p>
          <p v-if="exitEvidenceView(task)?.confirmedAtLine" class="queue-meta">{{ exitEvidenceView(task)?.confirmedAtLine }}</p>
        </div>
        <p v-if="reviewAvailable(task) && !reviewState(task).authorityOk" class="form-error" role="alert">
          权威核对条目缺失，暂不可处置。
        </p>
        <p v-if="rowErrors[task.taskId]" class="form-error" role="alert">{{ rowErrors[task.taskId].message }}</p>
        <div
          v-if="reviewAvailable(task) && expanded[task.taskId]"
          :id="`task-review-${task.taskId}`"
          class="task-review"
        >
          <p class="queue-meta">{{ causeText(task) }}</p>
          <template v-if="reviewState(task).authorityOk">
            <template v-if="reviewState(task).staged">
              <p v-if="task.failure" class="queue-envelope">
                暂存失败结局：{{ task.failure.code }}：{{ task.failure.message }}。恢复执行将按失败终态提交原结局。
              </p>
              <p v-else class="queue-meta">暂存成功结局：提交后将发布为待确认候选，进入收件箱核对；放弃则删除暂存候选并取消任务。</p>
              <div v-if="!task.failure" class="task-content">
                <button
                  class="text-button"
                  type="button"
                  :aria-label="`查看完整内容 整理任务 ${task.kind}`"
                  :aria-expanded="contentOpen[task.taskId] ? 'true' : 'false'"
                  @click="toggleFullContent(task)"
                >{{ contentOpen[task.taskId] ? '收起完整内容' : '查看完整内容' }}</button>
                <template v-if="contentOpen[task.taskId]">
                  <!-- The content body carries ONLY the accumulated payload: the
                       in-progress note rides beside it, so the rendered body is
                       byte-for-byte the result being verified (§4.3/U10). -->
                  <pre class="task-content-body">{{ contentSession(task).text }}</pre>
                  <p v-if="!contentSession(task).done" class="queue-meta">…（内容继续载入，尚未完整）</p>
                  <p class="queue-meta">
                    已载 {{ contentSession(task).loaded }}／共 {{ contentSession(task).total }} 字节{{ contentSession(task).done ? '，内容完整。' : '' }}
                  </p>
                </template>
              </div>
            </template>
            <p v-else class="queue-meta">登记域退出已确认，无暂存结局；可选择恢复执行或放弃取消。</p>
            <div v-if="requiredReceipts(task).length" class="task-receipts">
              <span class="queue-meta">待确认回执（恢复执行前需全部确认）</span>
              <label v-for="receipt in reviewState(task).receipts" :key="receipt.receiptId" class="task-receipt">
                <input
                  type="checkbox"
                  :checked="isChecked(task, receipt.receiptId)"
                  :disabled="!receipt.verifiable || pending[task.taskId] !== undefined"
                  @change="setChecked(task, receipt.receiptId, ($event.target as HTMLInputElement).checked)"
                >
                <span>确认回执 {{ receipt.receiptId }}（{{ receipt.kind }}{{ receipt.verifiable ? '·需确认' : '·无需确认' }}）</span>
              </label>
            </div>
            <div class="task-review-actions">
              <button
                class="text-button"
                type="button"
                :aria-label="`${reviewState(task).staged ? '提交暂存结果' : '恢复执行'}整理任务 ${task.kind}`"
                :disabled="!resumeEnabled(task)"
                @click="resolve(task, 'resume')"
              >{{ reviewState(task).staged ? '提交暂存结果' : '恢复执行' }}</button>
              <button
                class="text-button"
                type="button"
                :aria-label="`${reviewState(task).staged ? '放弃暂存结果' : '放弃取消'}整理任务 ${task.kind}`"
                :disabled="!cancelDecisionEnabled(task)"
                @click="resolve(task, 'cancel')"
              >{{ reviewState(task).staged ? '放弃' : '放弃取消' }}</button>
            </div>
          </template>
          <p v-else class="form-error" role="alert">权威核对条目缺失，暂不可处置。</p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.task-queue{margin-top:24px;border-top:1px solid var(--line);padding-top:16px}
.task-queue h2{font-size:16px;margin:0}
.queue-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.queue-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.queue-list li{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px;background:var(--surface)}
.queue-list li:focus{outline:2px solid var(--amber);outline-offset:2px}
.queue-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.queue-kind{font-weight:600;overflow-wrap:anywhere}
.queue-state{color:var(--muted,#6b6b6b)}
.queue-position{margin-left:auto}
.queue-meta{color:var(--muted,#6b6b6b);font-size:12px}
.queue-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.queue-envelope{margin:0;font-size:12px;color:var(--brick,#b4442c);overflow-wrap:anywhere}
.queue-announce{margin:0;font-size:12px;color:var(--muted,#6b6b6b);min-height:1em}
.concurrency-panel{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--surface)}
.concurrency-input{display:flex;align-items:center;gap:6px}
.concurrency-input input{width:72px;min-height:30px;border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:4px 8px;font:12px var(--font,inherit);color:var(--ink)}
.concurrency-input input:focus{outline:2px solid var(--ink);outline-offset:2px}
.task-review{display:grid;gap:8px;border-top:1px dashed var(--line);padding-top:8px;max-height:320px;overflow:auto}
.task-evidence{display:grid;gap:4px;border:1px dashed var(--line);border-radius:6px;padding:8px}
.task-evidence .queue-meta{overflow-wrap:anywhere}
.task-review-actions{display:flex;gap:10px;flex-wrap:wrap}
.task-receipts{display:grid;gap:4px}
.task-receipt{display:flex;align-items:center;gap:8px;font-size:12px;min-height:24px}
.task-receipt input[type="checkbox"]{width:16px;height:16px;accent-color:var(--ink)}
.task-content{display:grid;gap:6px}
.task-content-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 var(--font,monospace);background:var(--ivory);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:220px;overflow:auto}
.text-button:disabled{opacity:.5;cursor:not-allowed}
@media (max-width: 640px) {
  .queue-row{flex-direction:column;align-items:flex-start;gap:4px}
  .queue-position{margin-left:0}
  .concurrency-panel{flex-direction:column;align-items:stretch}
}
</style>
