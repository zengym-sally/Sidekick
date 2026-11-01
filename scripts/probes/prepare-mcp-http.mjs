import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = resolve('vendor/pi');
const provenance = JSON.parse(await readFile('tests/probes/pi-source.json', 'utf8'));
if (execFileSync('git', ['rev-parse', 'HEAD:vendor/pi'], { encoding: 'utf8' }).trim() !== provenance.tree || execFileSync('git', ['status', '--porcelain', '--', 'vendor/pi'], { encoding: 'utf8' }).trim()) throw new Error('Fixed Pi provenance required.');
const { build } = createRequire(join(source, 'package.json'))('esbuild');
const directory = resolve('build/mcp-http/probe');
await mkdir(directory, { recursive: true });
const result = await build({ stdin: { contents: "export { ManagedHttpTransport } from '../../runtime/lib/managed-mcp-http.mjs'; export { McpClient } from '@sidekick/pi-mcp-client'; export { StreamableHttpTransport } from '@sidekick/pi-http';", resolveDir: resolve('scripts/probes'), sourcefile: 'mcp-http-probe.mjs' }, outfile: join(directory, 'entry.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm', nodePaths: [join(source, 'node_modules')], alias: { '@sidekick/pi-mcp-client': join(source, 'packages/mcp/src/client.ts'), '@sidekick/pi-http': join(source, 'packages/mcp/src/transports/streamable-http.ts'), '@sidekick/pi-jsonrpc': join(source, 'packages/mcp/src/protocol/jsonrpc.ts') }, metafile: true, logLevel: 'silent' });
if (Object.keys(result.metafile.inputs).some(path => /transports[\/]stdio\.ts$/.test(path))) throw new Error('HTTP probe must not bundle SDK StdioTransport.');
console.log('Prepared fixed-Pi controlled HTTP seams; no model or credential access.');
