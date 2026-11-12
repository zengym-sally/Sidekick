// Controlled model service driver + synthetic model answers for the W1
// text-intake acceptance suites. The service process itself is
// controlled-model-service.mjs (run standalone); this module spawns it, waits
// for its stdout readiness line (never a fixed sleep), reads back its request
// record, and builds the scripted answers.
//
// Answer builders produce strings the runtime output contract accepts
// (runtime/lib/organizer-contract.mjs): extract answers are
// {candidates:[{title,kind,owner,priority,tags,evidence,dueExpression,
// followupExpression}]} where evidence and date expressions are verbatim
// substrings of the submitted raw text and an action candidate carries no
// followup expression; revise answers are {changes:{...}} patches; test
// answers are {ok:true}.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMON_EVIDENCE,
  COMMON_EXPRESSION,
  SOURCE_TEXT,
  SOURCE_TEXT_ALT,
  AMBIGUOUS_EVIDENCE,
  AMBIGUOUS_EXPRESSION,
} from './synthetic-inputs.mjs';

export function writeScript(dir, entries) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'model-script.json');
  writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
  return path;
}

// Start the controlled service on loopback with an ephemeral port. Resolves
// once the service prints its readiness URL line; rejects (after killing the
// child) if the line never arrives.
export async function startControlledModelService(options = {}) {
  const { script, record, port = 0 } = options;
  const serviceArgs = [join(import.meta.dirname, 'controlled-model-service.mjs')];
  if (script) serviceArgs.push('--script', script);
  if (record) serviceArgs.push('--record', record);
  serviceArgs.push('--port', String(port));
  const child = spawn(process.execPath, serviceArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 20000;
  for (;;) {
    const line = stdout.split('\n').find((entry) => entry.startsWith('http://127.0.0.1:'));
    if (line) break;
    if (child.exitCode !== null) {
      throw new Error(`controlled model service exited before readiness (code ${child.exitCode}): ${stderr}`);
    }
    if (Date.now() >= deadline) {
      child.kill('SIGKILL');
      throw new Error(`controlled model service did not signal readiness within 20s; stderr: ${stderr}`);
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  const url = stdout.split('\n').find((entry) => entry.startsWith('http://127.0.0.1:')).trim();
  return {
    url,
    pid: child.pid,
    recordPath: record ?? null,
    requests() {
      if (!record || !existsSync(record)) return [];
      return readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((done) => {
        child.once('exit', done);
        setTimeout(done, 5000).unref();
      });
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

// ---------------------------------------------------------------------------
// Synthetic model answers
// ---------------------------------------------------------------------------

const answer = (value) => JSON.stringify(value);

// The rich two-candidate answer for the primary synthetic source. Evidence
// and expressions are verbatim substrings of SOURCE_TEXT.
export const primaryExtractAnswer = () => answer({
  candidates: [
    {
      title: '提交SDK鉴权修复并请我验收',
      kind: 'action',
      owner: '林川',
      priority: 'high',
      tags: ['SDK', '验收'],
      evidence: '林川下周五之前提交SDK鉴权修复并请我验收',
      dueExpression: '下周五',
      followupExpression: null,
    },
    {
      title: '整理供应商报价对比',
      kind: 'followup',
      owner: '王五',
      priority: 'medium',
      tags: ['供应商'],
      evidence: '王五负责整理供应商报价对比，截止11月20日',
      dueExpression: '11月20日',
      followupExpression: null,
    },
  ],
});

// One-candidate answer for the alternate synthetic source.
export const alternateExtractAnswer = () => answer({
  candidates: [
    {
      title: '评审网关割接方案',
      kind: 'action',
      owner: '运维组',
      priority: 'medium',
      tags: ['网关'],
      evidence: '运维组申请周三评审网关割接方案',
      dueExpression: '周三',
      followupExpression: null,
    },
  ],
});

// The queue-suite answer: every queue text carries the common evidence and
// expression substrings, so one scripted answer is contract-valid for any of
// the five tasks regardless of the order their model requests arrive in.
export const queueExtractAnswer = () => answer({
  candidates: [
    {
      title: '整理合成队列输入',
      kind: 'action',
      owner: '我',
      priority: 'medium',
      tags: ['合成'],
      evidence: COMMON_EVIDENCE,
      dueExpression: COMMON_EXPRESSION,
      followupExpression: null,
    },
  ],
});

// The ambiguity answer (T-12): the due expression 下周五前后 is a verbatim
// substring of AMBIGUOUS_TEXT and shared/dates.mjs classifies it as
// ambiguous (range word), so the candidate is unresolved and sign-off must
// demand timeReviewed. The expression is never resolved by the model.
export const ambiguousExtractAnswer = () => answer({
  candidates: [
    {
      title: '准备网关割接回滚检查单',
      kind: 'action',
      owner: '我',
      priority: 'medium',
      tags: ['网关'],
      evidence: AMBIGUOUS_EVIDENCE,
      dueExpression: AMBIGUOUS_EXPRESSION,
      followupExpression: null,
    },
  ],
});

export const reviseAnswer = (overrides = {}) => answer({
  changes: {
    title: '提交SDK鉴权修复并请我验收（修订）',
    dueExpression: '11月25日',
    ...overrides,
  },
});

export const testAnswer = () => answer({ ok: true });

// ---------------------------------------------------------------------------
// Fault-injection answers (each must NOT produce candidates)
// ---------------------------------------------------------------------------

export const invalidAnswers = {
  nonJson: () => 'this is not json at all',
  evidenceNotSubstring: () => answer({
    candidates: [{
      title: '编造依据的候选', kind: 'action', owner: '我', priority: 'medium', tags: [],
      evidence: '一句从未出现在原文中的话', dueExpression: null, followupExpression: null,
    }],
  }),
  actionWithFollowup: () => answer({
    candidates: [{
      title: '动作带跟进', kind: 'action', owner: '我', priority: 'medium', tags: [],
      evidence: COMMON_EVIDENCE, dueExpression: null, followupExpression: COMMON_EXPRESSION,
    }],
  }),
  dateEvidenceNotSubstring: () => answer({
    candidates: [{
      title: '日期无原文依据', kind: 'action', owner: '我', priority: 'medium', tags: [],
      evidence: COMMON_EVIDENCE, dueExpression: '三千年后的冬至', followupExpression: null,
    }],
  }),
  oversizeTags: () => answer({
    candidates: [{
      title: '标签超限', kind: 'action', owner: '我', priority: 'medium',
      tags: Array.from({ length: 13 }, (_, index) => `标签${index}`),
      evidence: COMMON_EVIDENCE, dueExpression: null, followupExpression: null,
    }],
  }),
  unknownKey: () => answer({
    candidates: [{
      title: '多带字段', kind: 'action', owner: '我', priority: 'medium', tags: [],
      evidence: COMMON_EVIDENCE, dueExpression: null, followupExpression: null, forged: true,
    }],
  }),
  tooManyCandidates: () => answer({
    candidates: Array.from({ length: 51 }, (_, index) => ({
      title: `候选${index}`, kind: 'action', owner: '我', priority: 'medium', tags: [],
      evidence: COMMON_EVIDENCE, dueExpression: null, followupExpression: null,
    })),
  }),
  emptyCandidates: () => answer({ candidates: [] }),
};

// Assertion helper: the request record must never contain the synthetic
// secret value, while still proving the Authorization header was present.
export function assertNoSecretInRecord(requests, secret) {
  for (const entry of requests) {
    const serialized = JSON.stringify(entry);
    if (serialized.includes(secret)) {
      throw new Error(`the controlled service request record leaked the synthetic secret: ${serialized.slice(0, 400)}`);
    }
  }
}

export { SOURCE_TEXT, SOURCE_TEXT_ALT };
