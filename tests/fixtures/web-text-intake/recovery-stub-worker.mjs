//! Controlled real stub worker for the restart/recovery regression tests.
//!
//! This is a REAL process spawned through WorkerHost's `processFactory` knob:
//! it reads the frozen stdio request line (runId/hostNonce identity included),
//! answers with real protocol frames and carries the same `--run <runId>` argv
//! marker the runtime uses, so exit verification sees a faithful worker tree.
//! It never touches a model, the network or the filesystem.
//!
//! Modes (env `SIDEKICK_RECOVERY_STUB`):
//!   result-hang        emit one valid result frame, then hang until a cancel
//!                      frame (or SIGTERM/SIGINT) arrives — the deterministic
//!                      staging window.
//!   ignore-cancel-hang emit one valid result frame, then ignore cancel frames
//!                      and hang — the cancel intent cannot complete on its own.
//!   bare               emit nothing and hang — the lost/dead worker face.
//! `SIDEKICK_RECOVERY_STUB_LIFETIME_MS` (optional) self-exits the process after
//! the given delay (exit code 1, no frames) — the second-attempt rerun face.

import { env, exit, stdin, stdout } from 'node:process';

const mode = env.SIDEKICK_RECOVERY_STUB ?? 'result-hang';
const lifetimeMs = Number(env.SIDEKICK_RECOVERY_STUB_LIFETIME_MS ?? 0);

let request = null;

function send(frame) {
  stdout.write(`${JSON.stringify(frame)}\n`);
}

function candidatesFor(sourceText) {
  // The runtime's canonical candidate shape nests the editable fields.
  return [{
    fields: { title: '整理接入清单', kind: 'action', owner: '我', priority: 'high', tags: [], due: null, followup: null },
    evidence: String(sourceText ?? '').slice(0, 12), dueExpression: null, followupExpression: null,
  }];
}

function handleLine(line) {
  if (!line.trim()) return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (!request && frame.runId && frame.hostNonce) {
    request = frame;
    if (mode === 'result-hang' || mode === 'ignore-cancel-hang') {
      send({
        type: 'result',
        runId: request.runId,
        hostNonce: request.hostNonce,
        data: { candidates: candidatesFor(request.source?.rawText) },
      });
    }
    return;
  }
  if (frame.type === 'cancel' && mode === 'result-hang') exit(0);
}

stdin.setEncoding('utf8');
// The backend process speaks the request on stdin; any later line is a cancel.
let buffer = '';
stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    handleLine(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
  }
});
// A dead backend closes our stdin: exit like the real runtime would, so a
// crashed backend leaves a verifiably dead worker tree behind.
stdin.on('end', () => exit(0));
stdin.on('error', () => exit(1));
process.on('SIGTERM', () => exit(0));
process.on('SIGINT', () => exit(0));

if (lifetimeMs > 0) {
  setTimeout(() => exit(1), lifetimeMs).unref();
}
