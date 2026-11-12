// Test-owned fake Pi worker process (MAYNE-24 slice II protocol fixtures,
// frozen 2026-11-08 arbitration GAP-3..GAP-5). Spawned by
// protocol-worker.mjs's workerProcessFactory IN PLACE OF the real bundled
// organizer, it speaks the same stdio JSON-line protocol as
// runtime/entries/organizer-entry.mjs so every staging / publish / fence /
// exit-verification decision below is made by PRODUCTION code reacting to
// real frames:
//
//   stdin  : one request line {runId, hostNonce, kind, snapshot, source|...,
//            apiKey, cwd, runLimitMs, ...}; later lines may carry
//            {type:'cancel'} (identity-checked like the real runtime does).
//   stdout : {type:'progress'|'result'|'error', ..., runId, hostNonce} lines.
//
// The apiKey is never echoed, logged or placed in argv. Scenarios are
// test-private argv (they never reach HTTP/CLI/env configuration) and each
// one exercises a frozen decision point:
//   well-behaved         control: valid result + clean exit 0 (the normal
//                        chain, without any model call).
//   stage-then-hang      emit a contract-valid result (production stages it
//                        through its own parse/persist chain:
//                        resultPendingExit=1, staged candidates invisible),
//                        then hang; a {type:'cancel'} frame (the production
//                        run-limit path sends one) ends the run cleanly.
//   late-identity-frame  first emit a result stamped with a STALE identity
//                        (a previous attempt's runId+hostNonce from the
//                        registry, or a mutated nonce) — production fencing
//                        must reject it — then the correctly stamped result
//                        and a clean exit.
//   lingering-tree       emit a contract-valid result, spawn a detached
//                        grandchild that outlives this process, then exit 0:
//                        the direct child is gone but the process TREE exit
//                        cannot be confirmed, which the frozen contract maps
//                        to exited_unknown (scenario 24).
//   early-failure        derive a detached grandchild, register it, then exit
//                        non-zero BEFORE emitting any result frame: the
//                        worker failed early, yet its derived process must
//                        already be registered so cleanup can reach and
//                        verify it (R2-3: identity registration/cleanup must
//                        cover the early-failure path, not only the happy
//                        scenario paths).
//
// The registry file records every worker's identity (and any derived
// grandchild pid) so a later worker can stamp a genuinely late frame and the
// factory's cleanup can reach every derived process. Registration happens at
// the earliest possible moment — a worker-start line before the request line
// and the grandchild pid immediately after its spawn — so a worker that fails
// early is still fully covered. The detached grandchildren carry the SAME
// 300s lifetime in every scenario: cleanup must kill them, and the suites
// assert they were still alive at cleanup time (shortening the lifetime is
// not a substitute for cleanup).
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { COMMON_EVIDENCE, COMMON_EXPRESSION } from './synthetic-inputs.mjs';

const argv = process.argv.slice(2);
const valueOf = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
};
const scenario = valueOf('scenario') ?? 'well-behaved';
const registryPath = valueOf('registry');

const send = (frame) => {
  if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(frame)}\n`);
};
const emit = (frame, runId, hostNonce) => send({ ...frame, runId, hostNonce });

// A contract-valid canonical output for the request's kind. Evidence and date
// expressions are verbatim substrings of the submitted raw text (the runtime
// output contract's rule); the fallback keeps the payload valid for any text.
// The extract candidates mirror the real organizer's parseModelResult shape:
// the drafted item lives under `fields` (with due/followup points, null when
// unexpressed) alongside evidence, the two date expressions, warnings and the
// unresolved flag — production stageExtractResult reads candidate.fields and
// persists the staged rows from exactly these keys, so a flat candidate (no
// `fields`) is a frame the stage can never accept.
function payloadFor(request) {
  if (request?.kind === 'test') return { ok: true };
  if (request?.kind === 'revise') return { changes: { title: '协议夹具修订标题' } };
  const raw = String(request?.source?.rawText ?? '');
  const evidence = raw.includes(COMMON_EVIDENCE) ? COMMON_EVIDENCE : [...raw].slice(0, 12).join('');
  const dueExpression = raw.includes(COMMON_EXPRESSION) ? COMMON_EXPRESSION : null;
  return {
    candidates: [{
      fields: {
        title: '协议夹具候选',
        kind: 'action',
        owner: '我',
        priority: 'medium',
        tags: ['协议夹具'],
        due: null,
        followup: null,
      },
      evidence,
      dueExpression,
      followupExpression: null,
      warnings: [],
      unresolved: false,
    }],
  };
}

function staleIdentity(request) {
  try {
    const entries = readFileSync(registryPath, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry && entry.runId && entry.hostNonce);
    const previous = entries.filter((entry) => entry.runId !== request.runId).at(-1);
    if (previous) return { runId: previous.runId, hostNonce: previous.hostNonce };
  } catch { /* no registry yet: fall through to the mutated nonce */ }
  const nonce = String(request.hostNonce ?? '');
  const last = nonce.at(-1);
  return { runId: request.runId, hostNonce: nonce.length > 0 ? `${nonce.slice(0, -1)}${last === '0' ? '1' : '0'}` : '0'.repeat(48) };
}

function noteRegistry(entry) {
  if (!registryPath) return;
  try { appendFileSync(registryPath, `${JSON.stringify(entry)}\n`); } catch { /* registry is diagnostics-only */ }
}

// Derive a detached grandchild with the same 300s lifetime in every scenario
// and register its pid IMMEDIATELY — before any result frame — so the
// factory's cleanup can reach it even when this worker fails early. A spawn
// failure is registered too (spawnFailed), so cleanup can tell "the derived
// process never existed" apart from "the registration was skipped".
const deriveGrandchild = (entry) => {
  try {
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], {
      detached: true,
      stdio: 'ignore',
    });
    grandchild.unref();
    noteRegistry({ ...entry, pid: process.pid, lingerPid: grandchild.pid });
    return grandchild.pid;
  } catch (error) {
    noteRegistry({ ...entry, pid: process.pid, spawnFailed: String(error?.message ?? error) });
    return null;
  }
};

// Worker-start registration: this runs before the request line is even read,
// so a worker that crashes or fails early is still covered by the factory's
// cleanup (which also records the pid synchronously at spawn time).
noteRegistry({ role: 'worker-start', pid: process.pid, scenario, at: Date.now() });

let request = null;
let lingerPid = null;
let keepAlive = null;

const finish = () => {
  // Mirror the real runtime's shutdown: close stdin and let the process end
  // naturally (exit code 0) so the exit is a clean, confirmable one. The
  // keep-alive interval (stage-then-hang) must go too, or the event loop
  // never drains and the cancel/timeout path cannot end the run.
  if (keepAlive) clearInterval(keepAlive);
  process.stdin.destroy();
};

const run = async (value) => {
  request = value;
  noteRegistry({ runId: value.runId, hostNonce: value.hostNonce, pid: process.pid, scenario });
  emit({ type: 'progress', phase: 'model' }, value.runId, value.hostNonce);
  if (scenario === 'well-behaved' || scenario === 'stage-then-hang' || scenario === 'lingering-tree') {
    emit({ type: 'result', data: payloadFor(value) }, value.runId, value.hostNonce);
    if (scenario === 'well-behaved') { finish(); return; }
    if (scenario === 'lingering-tree') {
      // A detached grandchild that outlives this worker: the direct child
      // exits cleanly after the staged result, but the process tree still
      // has a live member, so production cannot confirm the tree exit.
      lingerPid = deriveGrandchild({ runId: value.runId, hostNonce: value.hostNonce, scenario: 'lingering-tree' });
      finish();
      return;
    }
    // stage-then-hang: stay alive. The production run limit sends the cancel
    // frame (frozen contract §7 取消/超时); the default-limit observation
    // case relies on nothing arriving and the run staying staged.
    keepAlive = setInterval(() => {}, 1 << 30);
    return;
  }
  if (scenario === 'early-failure') {
    // Fail early: derive a grandchild (registered immediately), then exit
    // non-zero before any result frame. Production must classify the failure
    // itself; the fixture's contract is that the derived process is
    // registered for cleanup even though the worker never completed.
    lingerPid = deriveGrandchild({ runId: value.runId, hostNonce: value.hostNonce, scenario: 'early-failure' });
    process.exit(1);
  }
  if (scenario === 'late-identity-frame') {
    const stale = staleIdentity(value);
    emit({ type: 'result', data: payloadFor(value) }, stale.runId, stale.hostNonce);
    await new Promise((done) => setTimeout(done, 400));
    emit({ type: 'result', data: payloadFor(value) }, value.runId, value.hostNonce);
    finish();
  }
};

const { createInterface } = await import('node:readline');
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let value = null;
  try { value = JSON.parse(line); } catch { return; }
  if (!request) { void run(value); return; }
  if (value?.type === 'cancel') {
    // Identity-checked like the real runtime: a cancel frame for another run
    // is a protocol violation; ours ends the run cleanly (exit 0).
    if (value.runId !== undefined && value.runId !== request.runId) return;
    if (value.hostNonce !== undefined && value.hostNonce !== request.hostNonce) return;
    finish();
  }
});

process.on('SIGTERM', () => finish());
