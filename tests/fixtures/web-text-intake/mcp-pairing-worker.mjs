// Scripted pairing worker (MAYNE-24 MCP begin/closed pairing regression).
//
// A controllable worker process with the exact interface the production
// WorkerHost uses (pid/exitCode/signalCode/stdin/stdout/stderr, `exit` and
// `error` events, stdio JSON-line protocol). It replaces ONLY the spawn call:
// fencing, receipt extraction, ordered frame persistence and exit verification
// stay production code reacting to this worker's real stdio frames.
//
// Protocol: the WorkerHost writes one request line (carrying `runId` and
// `hostNonce`) and the worker then emits its scripted frames in order. Every
// scripted frame is re-fenced to the request's identity — exactly what the
// real runtime does — unless the entry sets `keepFence`, which is how the
// golden control replays foreign-identity frames (a stale runId or a forged
// nonce) that the production fence must drop.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export class ScriptedPairingWorker extends EventEmitter {
  constructor({ frames, delayMs = 60 }) {
    super();
    this.pid = 41000 + Math.floor(Math.random() * 5000);
    this.exitCode = null;
    this.signalCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.frames = frames;
    this.delayMs = delayMs;
    this.doneEmitting = new Promise((resolveDone) => { this.resolveEmitted = resolveDone; });
    let buffer = '';
    this.stdin.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.type === 'cancel') continue;
        void this.emitScript(frame);
      }
    });
  }

  async emitScript(request) {
    for (const entry of this.frames) {
      const frame = entry.keepFence ? { ...entry } : { ...entry, runId: request.runId, hostNonce: request.hostNonce };
      delete frame.keepFence;
      this.stdout.write(`${JSON.stringify(frame)}\n`);
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.resolveEmitted();
  }

  exit(code = 0) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit('exit', code, null);
  }

  kill() { this.exit(1); return true; }
}

/// Build a processFactory for WorkerHost that hands every spawned worker the
/// same scripted frame sequence. The created workers are returned so a
/// scenario can wait for the script to land and then exit them explicitly.
export function createScriptedWorkerFactory({ frames, delayMs = 60 }) {
  const workers = [];
  const factory = () => {
    const worker = new ScriptedPairingWorker({ frames, delayMs });
    workers.push(worker);
    return worker;
  };
  return { factory, workers };
}
