import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const source = resolve('vendor/pi'), directory = resolve('build/s33-lifecycle');
const provenance = JSON.parse(await readFile('tests/probes/pi-source.json', 'utf8'));
if (execFileSync('git', ['rev-parse', 'HEAD:vendor/pi'], { encoding: 'utf8' }).trim() !== provenance.tree || execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'vendor/pi'], { encoding: 'utf8' }).trim()) throw new Error('The lifecycle probe requires the unchanged pinned Pi source.');
const { build } = createRequire(join(source, 'package.json'))('esbuild');
await mkdir(directory, { recursive: true });
await build({ entryPoints: ['tests/probes/s33/process.mjs'], outfile: join(directory, 'process.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm', nodePaths: [join(source, 'node_modules')], alias: { '@earendil-works/pi-mcp': join(source, 'packages/mcp/src/index.ts') }, banner: { js: "import { createRequire as probeRequire } from 'node:module'; const require = probeRequire(import.meta.url);" }, logLevel: 'warning' });
await build({ entryPoints: ['tests/probes/s33/ownership.test.mjs'], outfile: join(directory, 'ownership.test.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm', alias: { '@earendil-works/pi-mcp': resolve('tests/probes/s33/transport-stub.mjs') }, logLevel: 'warning' });
await copyFile('tests/probes/s33/service.mjs', join(directory, 'service.mjs'));
await copyFile('tests/probes/s33/guardian.mjs', join(directory, 'guardian.mjs'));
const node = resolve('build/s0-runtime/node');
await writeFile(join(directory, 'source.json'), JSON.stringify({ ...provenance, nodeSha256: createHash('sha256').update(await readFile(node)).digest('hex'), runtime: JSON.parse(execFileSync(node, ['-p', 'JSON.stringify({node:process.version,arch:process.arch})'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })), productionWiring: false }, null, 2));
