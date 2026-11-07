//! stdio client for the Rust storage adapter (`web-backend-storage`).
//!
//! One JSON request per stdin line, one JSON response per stdout line. The
//! child owns the business connection and the root lock; closing stdin makes
//! it release the lock and exit 0.

import { spawn } from 'node:child_process';

export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export class StorageClient {
  constructor({ binary, root, initialize = false }) {
    this.binary = binary;
    this.root = root;
    this.initialize = initialize;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.exitCode = null;
    this.started = false;
  }

  start() {
    if (this.started) return Promise.resolve();
    this.started = true;
    const child = spawn(this.binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
    child.on('exit', (code, signal) => this.onExit(code, signal));
    child.on('error', (error) => this.onExit(null, null, error));
    return this.command(this.initialize ? 'init' : 'open', { root: this.root });
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        this.failAll(new StorageError('STORAGE_PROTOCOL', 'storage adapter emitted a non-JSON line'));
        return;
      }
      const entry = this.pending.get(response.id);
      if (!entry) continue;
      this.pending.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new StorageError(response.error?.code ?? 'STORAGE_ERROR', response.error?.message ?? 'storage command failed'));
    }
  }

  onExit(code, signal, error) {
    this.exitCode = code;
    const reason = error ?? new StorageError('STORAGE_EXIT', `storage adapter exited (${code ?? signal ?? 'unknown'})`);
    this.failAll(reason);
  }

  failAll(reason) {
    for (const { reject } of this.pending.values()) reject(reason);
    this.pending.clear();
  }

  command(command, params = {}) {
    if (!this.child || this.child.stdin.destroyed) {
      return Promise.reject(new StorageError('STORAGE_NOT_RUNNING', 'storage adapter is not running'));
    }
    const id = this.nextId++;
    const request = JSON.stringify({ id, command, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${request}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(new StorageError('STORAGE_WRITE', error.message));
        }
      });
    });
  }

  async close() {
    if (!this.child) return;
    try {
      await this.command('close', {});
    } catch {
      // The adapter may already be gone; closing stdin below is enough.
    }
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    const child = this.child;
    this.child = null;
    await new Promise((resolve) => {
      if (this.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
