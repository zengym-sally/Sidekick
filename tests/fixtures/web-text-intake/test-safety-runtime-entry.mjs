//! Test-only temporary runtime ENTRY for the default-factory negative control
//! (MAYNE-24 W1 text-intake safety regression, fourth case).
//!
//! This is the reviewed stub worker (`test-safety-stub-worker.mjs`) plus a
//! marker write. It is installed as the `organizer.mjs` of a temporary
//! runtimeRoot whose `node` is a symlink to the system node, so the DEFAULT
//! worker factory (no `workerProcessFactory`) derives and spawns it. The
//! marker — written to the worker's cwd (the backend root) — records the
//! runId/hostNonce of the frozen stdio request line, proving the default
//! factory really executed this NON-audited entry for THIS run. It then emits
//! ONE legal-identity error frame (runId + hostNonce echoed, a registered
//! model error code) and exits 0, so the attempt records zero side-effect
//! receipts and a confirmed exit.
//!
//! The real bundled Pi is never involved: the entry is a test double. The
//! production proof must keep such an execution source `unknown`; a backend
//! that promotes it to `proven_safe` on the shortcut "default factory + zero
//! receipts" fails the fourth case.

import { exit, stdin, stdout } from 'node:process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/// Marker file name, relative to the worker's cwd (the backend root).
export const MARKER_FILE = 'test-safety-runtime-entry.marker.json';

let request = null;

function send(frame) {
  stdout.write(`${JSON.stringify(frame)}\n`);
}

function handleLine(line) {
  if (!line.trim()) return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (request || !frame.runId || !frame.hostNonce) return;
  request = frame;
  try {
    writeFileSync(join(process.cwd(), MARKER_FILE), JSON.stringify({
      marker: 'test-safety-runtime-entry',
      runId: frame.runId,
      hostNonce: frame.hostNonce,
      pid: process.pid,
      argv: process.argv.slice(1),
    }, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // The marker is evidence, not a protocol step; a failed write must not
    // change the error frame. The test fails loudly if the marker is absent.
  }
  send({
    type: 'error',
    runId: frame.runId,
    hostNonce: frame.hostNonce,
    code: 'MODEL_INVALID_OUTPUT',
    message: '测试专用临时 runtime 入口返回合法身份错误帧。',
  });
  // Give the host time to read the frame before the process exits: an
  // immediate exit can race the stdout `data` event against the `exit` event,
  // which would drop the error frame and misclassify the attempt as a lost
  // worker instead of the legal-identity error this control is about.
  setTimeout(() => exit(0), 100);
}

stdin.setEncoding('utf8');
let buffer = '';
stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    handleLine(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
  }
});
stdin.on('end', () => exit(0));
stdin.on('error', () => exit(1));
