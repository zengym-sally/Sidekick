// Synthetic inputs for the W1 text-intake acceptance suites. Everything here is
// test-owned synthetic data: no real user root, no real credential, no real
// model. The corpus is built so the controlled model service can return
// answers that satisfy the frozen runtime output contract
// (runtime/lib/organizer-contract.mjs): evidence and date expressions must be
// substrings of the submitted raw text, an action candidate must not carry a
// followup expression, tags are at most 12 entries of at most 32 characters,
// and a revise answer is a patch object with at least one declared key.
import { randomBytes } from 'node:crypto';

export const operationId = () => `op_${randomBytes(16).toString('hex')}`;

export const ID_PATTERNS = {
  source: /^src_[0-9a-f]{32}$/,
  candidate: /^cand_[0-9a-f]{32}$/,
  preview: /^prev_[0-9a-f]{32}$/,
  task: /^tsk_[0-9a-f]{32}$/,
  attempt: /^att_[0-9a-f]{32}$/,
  operation: /^op_[0-9a-f]{32}$/,
};

export const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The synthetic source text. Every expression the controlled service cites is
// a verbatim substring of this text (contract rule `evidence` / `date-evidence`).
export const SOURCE_TEXT = '林川下周五之前提交SDK鉴权修复并请我验收；王五负责整理供应商报价对比，截止11月20日；提醒我周六前确认试点名单。';

// A second, distinct text so fingerprint deduplication and multi-source flows
// have an independent fixture.
export const SOURCE_TEXT_ALT = '运维组申请周三评审网关割接方案，需要我提前准备回滚检查单。';

// The ambiguity fixture (T-12): the raw text carries the verbatim expression
// 下周五前后, which shared/dates.mjs classifies as ambiguous (a range word
// present) and therefore UNRESOLVED — the candidate must demand timeReviewed
// at sign-off. The evidence substring is verbatim too (runtime output
// contract rule).
export const AMBIGUOUS_EXPRESSION = '下周五前后';
export const AMBIGUOUS_TEXT = '运维组提醒：网关割接评审安排在下周五前后，具体时间待定，请提前准备回滚检查单。';
export const AMBIGUOUS_EVIDENCE = '网关割接评审安排在下周五前后';

// The queue suite submits five distinct texts (identical texts would collapse
// to one source through fingerprint deduplication). Every queue text carries
// these two verbatim substrings, so one scripted model answer is contract
// valid for any of the five tasks regardless of request arrival order.
export const COMMON_EVIDENCE = '合成整理输入标记';
export const COMMON_EXPRESSION = '下周五';

export const queueText = (index) => `队列合成输入 ${index}：合成整理输入标记，请在下周五前完成整理并回报。`;

export const timePoint = (overrides = {}) => ({
  at: '2026-11-13T10:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  localText: '2026-11-13 18:00',
  precision: 'minute',
  ...overrides,
});

export function submitSourceBody(options = {}) {
  const { operationId: op = operationId(), text = SOURCE_TEXT, sourceAt, timeZone } = options;
  const input = { text };
  if (sourceAt) input.sourceAt = sourceAt;
  if (timeZone) input.timeZone = timeZone;
  return { operationId: op, input };
}

// Candidate fields are isomorphic with the manual-item fields (contract §5.1):
// title/kind/owner/priority/due/followup/tags, plus the original-expression
// carriers dueExpression/followupExpression the model is allowed to emit.
export const candidateFields = (overrides = {}) => ({
  title: '提交SDK鉴权修复并请我验收',
  kind: 'action',
  owner: '林川',
  priority: 'high',
  due: timePoint({ at: '2026-11-20T02:00:00.000Z', localText: '2026-11-20 10:00' }),
  followup: null,
  tags: ['SDK', '验收'],
  ...overrides,
});

export const followupFields = (overrides = {}) => candidateFields({
  title: '整理供应商报价对比',
  kind: 'followup',
  owner: '王五',
  priority: 'medium',
  due: timePoint({ at: '2026-11-20T02:00:00.000Z', localText: '2026-11-20 10:00' }),
  followup: timePoint({ at: '2026-11-18T02:00:00.000Z', localText: '2026-11-18 10:00' }),
  tags: ['供应商'],
  ...overrides,
});

export const editBody = (options = {}) => {
  const { operationId: op = operationId(), expectedVersion, fields = candidateFields(), timeReviewed = false } = options;
  return { operationId: op, expectedVersion, input: fields, timeReviewed };
};

export const discardBody = (options = {}) => {
  const { operationId: op = operationId(), expectedVersion } = options;
  return { operationId: op, expectedVersion };
};

export const revisionBody = (options = {}) => {
  const { operationId: op = operationId(), instruction = '把截止时间改到11月25日并把我改成负责人' } = options;
  return { operationId: op, instruction };
};

export const applyPreviewBody = (options = {}) => {
  const { operationId: op = operationId(), expectedVersion } = options;
  return { operationId: op, expectedVersion };
};

// A sign-off choice: new item (target null) or manual link
// (target {id, expectedVersion} against an existing manual item).
export const signOffChoice = (options = {}) => {
  const { candidateId, expectedVersion, fields = candidateFields(), timeReviewed = false, target = null } = options;
  return { candidateId, expectedVersion, fields, timeReviewed, target };
};

export const signOffBody = (options = {}) => {
  const { operationId: op = operationId(), choices } = options;
  return { operationId: op, choices };
};

export const taskSubmitBody = (options = {}) => {
  const { operationId: op = operationId(), type = 'extract', role = 'organizer', input } = options;
  return { operationId: op, type, role, input };
};

export const cancelBody = (options = {}) => {
  const { expectedVersion } = options;
  return expectedVersion === undefined ? {} : { expectedVersion };
};

export const retryBody = (options = {}) => {
  const { expectedVersion, configRevision } = options;
  return { expectedVersion, ...(configRevision === undefined ? {} : { configRevision }) };
};

export const resolveBody = (options = {}) => {
  const { expectedVersion, decision = 'resume', acknowledgedReceipts = [] } = options;
  return { expectedVersion, decision, acknowledgedReceipts };
};

export const concurrencyPutBody = (options = {}) => {
  const { agentConcurrency, expectedVersion } = options;
  return { agentConcurrency, expectedVersion };
};

export const modelsPutBody = (options = {}) => {
  const { input, expectedRevision } = options;
  return { input, expectedRevision };
};

export const agentsPutBody = (options = {}) => {
  const { input } = options;
  return { input };
};
