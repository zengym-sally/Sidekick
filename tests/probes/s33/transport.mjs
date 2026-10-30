import { StdioTransport, McpAbortError, McpConnectionClosedError } from '@earendil-works/pi-mcp';

export function stopGroup(pid) {
  for (const signal of ['SIGSTOP', 'SIGKILL']) { try { process.kill(-pid, signal); } catch {} }
}

export function managedStdio(options) {
  const inner = new StdioTransport({
    command: options.node, args: [options.guardian, '--run', options.runId, '--nonce', options.nonce],
    cwd: options.cwd, env: { PATH: '/usr/bin:/bin' }, inheritEnv: false,
    maxMessageBytes: 262144, maxStderrBytes: 4096, closeTimeoutMs: 500,
  });
  let pid, closed = false, closing, ended = false, rejectStart;
  const reap = () => {
    if (!pid || ended) return;
    const ownedPid = pid; ended = true; pid = undefined;
    stopGroup(ownedPid);
    options.onWorker({ action: 'end', pid: ownedPid, script: options.guardian });
  };
  inner.onClose(() => { closed = true; rejectStart?.(new McpConnectionClosedError()); if (!closing) reap(); });
  return {
    async start() {
      if (closed) throw new McpConnectionClosedError();
      await inner.start();
      pid = inner.pid;
      try {
        if (!pid || closed) throw new McpConnectionClosedError();
        const interrupted = new Promise((_, reject) => { rejectStart = reject; });
        await Promise.race([Promise.resolve().then(() => options.onWorker({ action: 'start', pid, script: options.guardian })), interrupted]);
        if (closed) throw new McpConnectionClosedError();
        await inner.send({ jsonrpc: '2.0', method: 'sidekick/stdio/start', params: {
          runId: options.runId, nonce: options.nonce, command: options.command, args: options.args,
          cwd: options.cwd, env: options.env, lifetimeMs: options.lifetimeMs,
        } });
      } catch (error) { await this.close(); throw error; }
      finally { rejectStart = undefined; }
    },
    async send(message, sendOptions) {
      if (closed) throw new McpConnectionClosedError();
      if (sendOptions?.signal?.aborted) throw new McpAbortError();
      await inner.send(message);
    },
    close() {
      if (!closing) {
        closed = true;
        rejectStart?.(new McpConnectionClosedError());
        closing = (async () => { try { await inner.close(); } finally { reap(); } })();
      }
      return closing;
    },
    onMessage: listener => inner.onMessage(listener),
    onError: listener => inner.onError(listener),
    onClose: listener => inner.onClose(listener),
  };
}
