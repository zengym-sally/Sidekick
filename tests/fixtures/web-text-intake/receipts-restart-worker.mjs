//! Controlled real stub worker for the MCP-receipt cross-restart regression.
//!
//! A REAL process spawned through WorkerHost's `processFactory` knob: it reads
//! the frozen stdio request line (runId/hostNonce identity included), answers
//! with real protocol frames and carries the same `--run <runId>` argv marker
//! the runtime uses, so exit verification sees a faithful worker tree. It
//! never touches a model, the network or the filesystem.
//!
//! The MCP frames are built by the REVIEWED builders of
//! `mcp-pairing-frames.mjs` (the frames the pairing regression was accepted
//! with); this fixture only re-fences each frame to the request identity —
//! the production fence drops any frame whose runId/hostNonce pair does not
//! match the request line, so every scripted frame must carry both. The
//! receipt identities these frames produce are asserted against the frozen
//! P-3 formula in `web-text-intake-receipts-restart.test.mjs`; both sides
//! read the single `SIDEKICK_RECEIPTS_IDENTITY` JSON blob so no identity can
//! drift between fixture and test.
//!
//! Modes (env `SIDEKICK_RECEIPTS_STUB`):
//!   receipts-pair-result-hang      begin(A) + response(A) + begin(B), then the
//!                                  canonical extract result frame, then hang —
//!                                  the receipts-land-before-staging crash
//!                                  window (the staged window is the test's
//!                                  durability gate for all three facts).
//!   receipts-begin-hang            begin(A) only, then hang — an open begin
//!                                  with nothing staged (the re-queue face).
//!                                  There is no wire-visible gate for a bare
//!                                  begin row, so the test crashes only after
//!                                  the read-only SQLite observation sees the
//!                                  begin row committed in the real database
//!                                  (the persisted-begin durability gate); a
//!                                  row that never lands fails the gate
//!                                  loudly, never silently.
//!   receipts-response-result-hang  response(A) only, then the result frame,
//!                                  then hang — a fresh attempt whose
//!                                  same-callId closure can never pair with a
//!                                  previous attempt's begin (fresh pairing
//!                                  state, persistence-gated per attempt).
//!   receipts-bare                  emit nothing and hang — the safe default
//!                                  for a restarted instance that must run no
//!                                  frames at all.

import { env, exit, stdin, stdout } from 'node:process';
import { extractResultFrame, mcpBegin, mcpResponse } from './mcp-pairing-frames.mjs';

const mode = env.SIDEKICK_RECEIPTS_STUB ?? 'receipts-bare';
const identity = JSON.parse(env.SIDEKICK_RECEIPTS_IDENTITY ?? '{}');

let request = null;

function send(frame) {
  stdout.write(`${JSON.stringify(frame)}\n`);
}

/// Re-fence a reviewed builder frame to the request identity. The fence pair
/// (runId + hostNonce) is the production ownership check on EVERY frame.
function emit(frame) {
  send({ ...frame, runId: request.runId, hostNonce: request.hostNonce });
}

function begin(requestId, callId, modelCallId) {
  emit(mcpBegin({ requestId, serverId: identity.serverId, callId, modelCallId, modelName: identity.modelName }));
}

function respond(requestId, callId) {
  emit(mcpResponse({ requestId, serverId: identity.serverId, callId }));
}

function emitReceiptFrames() {
  if (mode === 'receipts-pair-result-hang') {
    begin('req-receipts-a', identity.callA, identity.modelCallA);
    respond('req-receipts-a-close', identity.callA);
    begin('req-receipts-b', identity.callB, identity.modelCallB);
  } else if (mode === 'receipts-begin-hang') {
    begin('req-receipts-a', identity.callA, identity.modelCallA);
  } else if (mode === 'receipts-response-result-hang') {
    respond('req-receipts-a-close', identity.callA);
  }
  if (mode === 'receipts-pair-result-hang' || mode === 'receipts-response-result-hang') {
    emit(extractResultFrame());
  }
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
    emitReceiptFrames();
    return;
  }
  if (frame.type === 'cancel') exit(0);
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
