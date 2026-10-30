import { spawn, execFileSync } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJsonRpcMessage } from '@sidekick/pi-jsonrpc';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ManagedMcpTransport {
  constructor(config, control) {
    this.config = config; this.control = control; this.nonce = randomUUID();
    this.messages = new Set(); this.errors = new Set(); this.closes = new Set();
    this.fatal = false; this.closing = false; this.total = 0; this.notifications = 0;
    this.buffer = Buffer.alloc(0); this.controlBytes = 0; this.ownerBytes = 0;
  }
  onMessage(fn) { this.messages.add(fn); return () => this.messages.delete(fn); }
  onError(fn) { this.errors.add(fn); return () => this.errors.delete(fn); }
  onClose(fn) { this.closes.add(fn); return () => this.closes.delete(fn); }
  fail() { if (!this.fatal) { this.fatal = true; for (const fn of this.errors) fn(new Error('MCP_PROTOCOL')); this.readyReject?.(new Error('MCP_PROTOCOL')); void this.close().catch(() => {}); } }
  async start() {
    if (this.child || this.closing) throw new Error('MCP_PROTOCOL');
    await this.control.prepare({ guardian: 0, keeper: 0, run: this.config.runId, nonce: this.nonce });
    if (this.closing || this.fatal) throw new Error('MCP_PROTOCOL');
    let audit = false; try { audit = fstatSync(3).isFile(); } catch {}
    const env = { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' };
    this.child = spawn(process.execPath, [join(this.config.directory, 'mcp-guardian.mjs'), '--mode', 'guardian', '--run', this.config.runId, '--nonce', this.nonce, '--lifetime', String(Math.max(1, this.config.deadline - Date.now()))], { detached: true, env, stdio: ['pipe', 'pipe', 'pipe', audit ? 3 : 'ignore', 'pipe'] });
    const child = this.child;
    this.closed = new Promise(resolve => child.once('close', code => {
      this.drained = true;
      if (this.buffer.length || !this.closing || (code !== null && code !== 0)) this.fail();
      for (const fn of this.closes) fn(); resolve();
    }));
    child.once('error', () => this.fail()); child.stdin.on('error', () => { if (!this.closing) this.fail(); });
    child.stderr.on('data', chunk => { this.controlBytes += chunk.length; if (this.controlBytes > 2000000) this.fail(); });
    child.stdio[4].on('data', () => this.fail()); child.stdio[4].on('error', () => this.fail());
    child.stdout.on('data', chunk => {
      this.total += chunk.length; if (this.total - this.ownerBytes > 2000000 + (this.owner ? 0 : 4096)) { this.fail(); return; }
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.includes(10)) {
        const i = this.buffer.indexOf(10); const line = this.buffer.subarray(0, i); this.buffer = this.buffer.subarray(i + 1);
        if (i + 1 > 1048576) { this.fail(); continue; }
        try {
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (!this.owner) {
            if (value.sidekick !== 'owner' || value.guardian !== child.pid || value.run !== this.config.runId || value.nonce !== this.nonce || !Number.isSafeInteger(value.keeper)) throw new Error();
            this.owner = value; this.ownerBytes = i + 1; if (this.total - this.ownerBytes > 2000000) throw new Error(); this.readyResolve();
          } else {
            const message = parseJsonRpcMessage(value);
            if (message.method && message.id === undefined && ++this.notifications > 64) throw new Error();
            for (const fn of this.messages) fn(message);
          }
        } catch { this.fail(); }
      }
      if (this.buffer.length >= 1048576) this.fail();
    });
    await new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; if (this.fatal) reject(new Error('MCP_PROTOCOL')); });
    await this.control.own(this.owner);
    if (this.closing || this.fatal) throw new Error('MCP_PROTOCOL');
    const envValues = this.config.env;
    const path = `${this.config.directory}:${envValues.PATH || ''}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
    const serviceEnv = { ...envValues, PATH: path, TMPDIR: envValues.TMPDIR || this.config.runDirectory };
    if (Buffer.byteLength(path) + Buffer.byteLength(serviceEnv.TMPDIR) > 16384) throw new Error('MCP_PROTOCOL');
    const frame = JSON.stringify({ run: this.config.runId, nonce: this.nonce, command: this.config.command, args: this.config.args, cwd: this.config.cwd, env: serviceEnv }) + '\n';
    if (Buffer.byteLength(frame) > 2000000) throw new Error('MCP_PROTOCOL');
    await this.write(frame);
  }
  async write(frame) {
    if (!this.child || this.closing) throw new Error('MCP_PROTOCOL');
    await new Promise((resolve, reject) => this.child.stdin.write(frame, error => error ? reject(new Error('MCP_PROTOCOL')) : resolve()));
  }
  async send(message, options) {
    if (options?.signal?.aborted) throw new Error('MCP_CANCELLED');
    if (message.method && !['initialize', 'tools/list', 'notifications/initialized', 'notifications/cancelled'].includes(message.method)) throw new Error('MCP_PROTOCOL');
    await this.write(JSON.stringify(message) + '\n');
  }
  groupAlive() {
    try { return execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).split('\n').some(line => { const p = line.trim().split(/\s+/); return Number(p[0]) === this.child.pid && !p[1]?.startsWith('Z'); }); } catch { return true; }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; this.readyReject?.(new Error('MCP_PROTOCOL'));
    this.closePromise = (async () => {
      if (!this.child) return;
      this.child.stdin.destroy();
      const deadline = Math.min(this.config.totalDeadline, Date.now() + 5000);
      while ((!this.drained || this.groupAlive()) && Date.now() < deadline) await pause(25);
      if (!this.drained || this.groupAlive()) { this.fatal = true; throw new Error('MCP_CLEANUP'); }
      if (this.owner) await this.control.end(this.owner);
    })();
    this.closePromise.catch(() => this.fail());
    return this.closePromise;
  }
}
