// Deterministic response-dropper for the candidate-operation restart suite.
//
// The MAYNE-33 restart case must prove that the ledger answers a retry whose
// response the client NEVER received. A plain fetch cannot guarantee that: the
// backend writes its response immediately after the commit, so aborting the
// request after observing the commit races the in-flight response (the Codex
// re-review 01a1c911 reproduced exactly that — three 200s consumed before the
// abort).
//
// This fixture is a minimal HTTP proxy: it forwards the client's request to
// the real backend (rewriting `Host`/`Origin` so the backend's same-origin
// check still sees its own host), DROPS every upstream response byte, and
// destroys the client socket on the first response byte. The client therefore
// always sees a transport failure with no status and no body — deterministically,
// with no dependence on timing. The commit itself is still observed read-only
// through the database, so the test knows the write landed before the socket
// dies.
//
// `close()` also has to finish without external help: a `net.Server` has no
// `closeAllConnections()` and `server.close()` waits for live connections, so
// an unfinished request (a half-sent head, a silent upstream) would otherwise
// hold the listener open. Every client/upstream socket is tracked and destroyed
// on close.
import { createServer, connect } from 'node:net';

export function startResponseDropper(targetOrigin) {
  const target = new URL(targetOrigin);
  const targetHost = target.host;
  const targetOriginHeader = `http://${targetHost}`;
  const sockets = new Set();
  const server = createServer((clientSocket) => {
    const upstream = connect(Number(target.port), target.hostname);
    sockets.add(clientSocket);
    sockets.add(upstream);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    upstream.on('close', () => sockets.delete(upstream));
    let headDone = false;
    let buffer = Buffer.alloc(0);
    clientSocket.on('data', (chunk) => {
      if (headDone) {
        upstream.write(chunk);
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      headDone = true;
      const head = buffer.subarray(0, end).toString('latin1');
      const rest = buffer.subarray(end + 4);
      const rewritten = head
        .split('\r\n')
        .map((line) => {
          if (/^host:/i.test(line)) return `Host: ${targetHost}`;
          if (/^origin:/i.test(line)) return `Origin: ${targetOriginHeader}`;
          return line;
        })
        .join('\r\n');
      upstream.write(`${rewritten}\r\n\r\n`);
      if (rest.length) upstream.write(rest);
      buffer = Buffer.alloc(0);
    });
    // Deliberately NO upstream -> client pipe: the backend's response is
    // dropped. Destroying both sockets on the first upstream byte makes the
    // client's transport failure deterministic.
    const drop = () => {
      try { upstream.destroy(); } catch { /* already gone */ }
      try { clientSocket.destroy(); } catch { /* already gone */ }
    };
    upstream.on('data', drop);
    upstream.on('error', drop);
    upstream.on('end', drop);
    clientSocket.on('error', () => {
      try { upstream.destroy(); } catch { /* already gone */ }
    });
    clientSocket.on('close', () => {
      try { upstream.destroy(); } catch { /* already gone */ }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => {
          server.close(() => done());
          // net.Server has no closeAllConnections(): destroy every tracked
          // socket ourselves so an unfinished connection cannot hold the
          // listener open.
          for (const socket of sockets) {
            try { socket.destroy(); } catch { /* already gone */ }
          }
          sockets.clear();
        }),
      });
    });
  });
}
