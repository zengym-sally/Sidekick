import { spawn } from 'node:child_process';

const group = process.pid, runId = process.argv[3], nonce = process.argv[5];
let server, buffer = Buffer.alloc(0), bootstrapped = false, closing = false;
let timer = setTimeout(cleanup, 2000);
function cleanup() {
  if (closing) return;
  closing = true; clearTimeout(timer); process.stdin.pause();
  const cleaner = spawn(process.execPath, ['-e', "const pid=Number(process.argv[1]);for(const signal of ['SIGSTOP','SIGKILL']){try{process.kill(-pid,signal)}catch{}}", String(group)], {
    detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' },
  });
  cleaner.on('error', () => { try { process.kill(-group, 'SIGKILL'); } catch { process.exit(1); } });
  cleaner.unref();
}
process.stdin.on('end', cleanup); process.stdin.on('error', cleanup);
process.stdout.on('error', cleanup); process.on('SIGTERM', cleanup); process.on('SIGHUP', cleanup);
process.stdin.on('data', chunk => {
  if (closing) return;
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.includes(10)) {
    const boundary = buffer.indexOf(10);
    if (boundary > 262144) { cleanup(); return; }
    const line = buffer.subarray(0, boundary + 1); buffer = buffer.subarray(boundary + 1);
    if (!bootstrapped) {
      let request;
      try { const frame = JSON.parse(line); if (frame.method !== 'sidekick/stdio/start') throw new Error(); request = frame.params; } catch { cleanup(); return; }
      if (request.runId !== runId || request.nonce !== nonce || typeof request.command !== 'string' || !Array.isArray(request.args) || !request.args.every(x => typeof x === 'string') || typeof request.cwd !== 'string' || !Number.isInteger(request.lifetimeMs) || request.lifetimeMs < 1 || request.lifetimeMs > 120000) { cleanup(); return; }
      bootstrapped = true; clearTimeout(timer); timer = setTimeout(cleanup, request.lifetimeMs);
      server = spawn(request.command, request.args, { cwd: request.cwd, env: request.env || { PATH: '/usr/bin:/bin' }, detached: false, stdio: ['pipe', 'pipe', 'pipe'] });
      server.stdin.on('error', cleanup); server.stdout.on('error', cleanup); server.stderr.on('error', cleanup);
      server.stdout.pipe(process.stdout, { end: false }); server.stderr.on('data', () => {});
      server.on('error', cleanup); server.on('exit', cleanup);
    } else if (!server.stdin.write(line)) {
      process.stdin.pause(); server.stdin.once('drain', () => { if (!closing) process.stdin.resume(); });
    }
  }
  if (buffer.length > 262144) cleanup();
});
