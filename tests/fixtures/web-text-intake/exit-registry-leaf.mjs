//! Synthetic process fixture for the attempt-exit registry tests (MAYNE-35).
//!
//! Self-reclaiming by construction: every mode exits on its own after the
//! given lifetime, so a test that spawns it never leaks a process even on
//! failure. No real user processes, credentials or working roots are touched.
//!
//! Identity flags: `--run <runId> --host-nonce <nonce>` are echoed into any
//! emitted frame so the host's stdio transport fence (web-api/1 §3.3)
//! accepts it as a real attempt frame — tool-owner registration is bound to
//! fence-valid frames, never to arbitrary stdout lines.
//!
//! Modes:
//!   hold <ms> [ignored...]              stay alive ms, then exit 0
//!   child <ms> <childMs>                spawn a direct (same-group) child
//!                                       leaf that outlives this process,
//!                                       emit a `worker` frame naming it,
//!                                       then exit
//!   detach <ms> <grandchildMs>          spawn a DETACHED (own process group)
//!                                       grandchild leaf, emit a `worker`
//!                                       frame naming it, then exit — the
//!                                       registered setsid-style escape
//!                                       (GAP-5) control
//!   orphan <ms> <orphanMs> <markerPath> double-fork an orphan (reparented to
//!                                       launchd before any registration can
//!                                       see it), orphan writes the marker
//!                                       file, then self-exits — the
//!                                       unregistered & undiscovered escape
//!                                       control. Emits no frame: the point
//!                                       is that no registration source
//!                                       ever sees it.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const leafPath = fileURLToPath(import.meta.url);
const here = dirname(leafPath);

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--run') { flags.runId = argv[i + 1]; i += 1; continue; }
  if (argv[i] === '--host-nonce') { flags.hostNonce = argv[i + 1]; i += 1; continue; }
  positional.push(argv[i]);
}
const [mode, msArg, secondArg, thirdArg] = positional;
const ms = Number(msArg ?? 0);

function emitWorkerFrame(pid) {
  if (!flags.runId || !flags.hostNonce) return; // unfenceable: never emitted
  process.stdout.write(`${JSON.stringify({ type: 'worker', runId: flags.runId, hostNonce: flags.hostNonce, pid, nonce: `fixture-${pid}` })}\n`);
}

function hold(msToLive) {
  setTimeout(() => process.exit(0), msToLive);
}

if (mode === 'hold' && Number.isFinite(ms) && ms >= 0) {
  hold(ms);
} else if (mode === 'child' && Number.isFinite(ms) && Number.isFinite(Number(secondArg))) {
  const child = spawn(process.execPath, [leafPath, 'hold', String(secondArg)], {
    cwd: here,
    stdio: 'ignore', // same process group as this leaf (no detach)
  });
  emitWorkerFrame(child.pid);
  hold(ms);
} else if (mode === 'detach' && Number.isFinite(ms) && Number.isFinite(Number(secondArg))) {
  const grandchild = spawn(process.execPath, [leafPath, 'hold', String(secondArg)], {
    cwd: here,
    detached: true, // own process group: survives the worker's group death
    stdio: 'ignore',
  });
  grandchild.unref();
  emitWorkerFrame(grandchild.pid);
  hold(ms);
} else if (mode === 'orphan' && Number.isFinite(ms) && Number.isFinite(Number(secondArg)) && typeof thirdArg === 'string') {
  const intermediate = spawn(process.execPath, [leafPath, 'orphan-inner', String(secondArg), thirdArg], {
    cwd: here,
    stdio: 'ignore',
  });
  intermediate.unref();
  hold(ms);
} else if (mode === 'orphan-inner' && Number.isFinite(Number(msArg)) && typeof secondArg === 'string') {
  const orphan = spawn(process.execPath, [leafPath, 'hold', String(msArg)], {
    cwd: here,
    detached: true,
    stdio: 'ignore',
  });
  orphan.unref();
  // Marker proves the orphan really existed (transient life even if no
  // registration ever caught it). The intermediate exits at once so the
  // orphan is reparented to launchd before any ppid walk can reach it.
  writeFileSync(secondArg, `${JSON.stringify({ orphanPid: orphan.pid, bornAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  process.exit(0);
} else {
  process.exit(2);
}
