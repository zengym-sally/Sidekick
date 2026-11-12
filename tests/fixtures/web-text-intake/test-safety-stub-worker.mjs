//! Test-only stub worker for the untrusted-execution-source negative control
//! (MAYNE-24 W1 text-intake safety regression).
//!
//! This is NOT the bundled Pi runtime. It is a private replacement process
//! spawned through the entry's `workerProcessFactory` knob, used ONLY to break
//! the proof precondition "test type + zero receipts": a backend that promotes
//! such an attempt to `proven_safe` without a credible execution source must
//! fail the control. It reads the frozen stdio request line, answers with ONE
//! legal-identity error frame (runId + hostNonce echoed, a registered model
//! error code) and exits 0. It never touches a model, the network or the
//! filesystem, and it emits no tool/MCP frame, so the attempt records zero
//! side-effect receipts.
//!
//! The real-Pi positive control is untouched: it keeps the default worker
//! factory (no `workerProcessFactory`), so this stub can never stand in for it.

import { exit, stdin, stdout } from 'node:process';

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
  send({
    type: 'error',
    runId: frame.runId,
    hostNonce: frame.hostNonce,
    code: 'MODEL_INVALID_OUTPUT',
    message: '测试专用替身进程返回合法身份错误帧。',
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
