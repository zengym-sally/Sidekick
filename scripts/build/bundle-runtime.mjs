import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { copyExecutable } from './copy-executable.mjs';

if (process.env.SIDEKICK_PI_ROOT) throw new Error('Delivery builds only use the reviewed vendor/pi subtree; unset SIDEKICK_PI_ROOT.');
const source = resolve('vendor/pi');
const sourcePackages = join(await realpath(source), 'packages') + sep;
const metadata = JSON.parse(await readFile('tests/probes/pi-source.json', 'utf8'));
const actualTree = execFileSync('git', ['rev-parse', 'HEAD:vendor/pi'], { encoding: 'utf8' }).trim();
if (actualTree !== metadata.tree) throw new Error('Pi tree does not match the reviewed source provenance.');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'vendor/pi'], { encoding: 'utf8' }).trim()) throw new Error('Review changes to the Pi subtree before packaging.');
const require = createRequire(join(resolve(source), 'package.json'));
const { build } = require('esbuild');
const directory = resolve('build/s0-runtime');
await mkdir(directory, { recursive: true });
const result = await build({
  entryPoints: ['runtime/entries/probe-entry.mjs'], outfile: join(directory, 'probe.mjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  banner: { js: "import { createRequire as s0CreateRequire } from 'node:module'; const require = s0CreateRequire(import.meta.url);" },
  nodePaths: [join(resolve(source), 'node_modules')],
  alias: {
    '@sidekick/pi-bash': join(resolve(source), 'packages/coding-agent/dist/core/tools/bash.js'),
    '@sidekick/pi-read': join(resolve(source), 'packages/coding-agent/dist/core/tools/read.js'),
    '@sidekick/pi-skills': join(resolve(source), 'packages/coding-agent/dist/core/skills.js'),
    '@sidekick/pi-paths': join(resolve(source), 'packages/coding-agent/dist/core/tools/path-utils.js'),
  },
  logLevel: 'info',
  metafile: true,
});
const business = await build({
  entryPoints: ['runtime/entries/organizer-entry.mjs'], outfile: join(directory, 'organizer.mjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  banner: { js: "import { createRequire as runtimeRequire } from 'node:module'; const require = runtimeRequire(import.meta.url);" },
  nodePaths: [join(resolve(source), 'node_modules')],
  alias: {
    '@sidekick/pi-mcp-client': join(resolve(source), 'packages/mcp/src/client.ts'),
    '@sidekick/pi-http': join(resolve(source), 'packages/mcp/src/transports/streamable-http.ts'),
    '@sidekick/pi-jsonrpc': join(resolve(source), 'packages/mcp/src/protocol/jsonrpc.ts'),
    '@sidekick/pi-bash': join(resolve(source), 'packages/coding-agent/dist/core/tools/bash.js'),
    '@sidekick/pi-read': join(resolve(source), 'packages/coding-agent/dist/core/tools/read.js'),
    '@sidekick/pi-skills': join(resolve(source), 'packages/coding-agent/dist/core/skills.js'),
    '@sidekick/pi-paths': join(resolve(source), 'packages/coding-agent/dist/core/tools/path-utils.js'),
  }, logLevel: 'info', metafile: true,
});
if (Object.keys(business.metafile.inputs).some(input => /transports[\/]stdio\.ts$/.test(input))) throw new Error('Organizer must use the managed MCP signal path.');
const skillsBuild = await build({entryPoints:['runtime/entries/skills-manager.mjs'],outfile:join(directory,'skills-manager.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import { createRequire as skillsRequire } from 'node:module'; const require = skillsRequire(import.meta.url);"},nodePaths:[join(resolve(source),'node_modules')],alias:{'@sidekick/pi-skills':join(resolve(source),'packages/coding-agent/dist/core/skills.js')},logLevel:'info',metafile:true});
const mcpBuild = await build({
  entryPoints: ['runtime/entries/mcp-probe-entry.mjs'], outfile: join(directory, 'mcp-probe.mjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  nodePaths: [join(resolve(source), 'node_modules')],
  alias: {
    '@sidekick/pi-mcp-client': join(resolve(source), 'packages/mcp/src/client.ts'),
    '@sidekick/pi-http': join(resolve(source), 'packages/mcp/src/transports/streamable-http.ts'),
    '@sidekick/pi-jsonrpc': join(resolve(source), 'packages/mcp/src/protocol/jsonrpc.ts'),
  }, logLevel: 'info', metafile: true,
});
if (Object.keys(mcpBuild.metafile.inputs).some(input => /transports[\/]stdio\.ts$/.test(input))) throw new Error('Discovery must not bundle the SDK StdioTransport signal path.');
await build({entryPoints:['runtime/entries/today-facts.mjs'],outfile:join(directory,'today-facts.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',logLevel:'info'});
await copyFile('runtime/workers/mcp-guardian.mjs', join(directory, 'mcp-guardian.mjs'));
const skillManifest=JSON.parse(await readFile('resources/skills/manifest.json','utf8'));
const {createHash}=await import('node:crypto');
for(const pack of skillManifest.packages)for(const file of pack.files){const bytes=await readFile(join('resources/skills/packages',pack.id,file.path));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Bundled skill provenance mismatch.');}
for(const file of skillManifest.supportReferences||[]){const bytes=await readFile(join('resources/skills',file.resourcePath));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Skill support provenance mismatch.');}
await cp('resources/skills',join(directory,'builtin-skills'),{recursive:true});
await copyFile('runtime/workers/bash-worker.mjs', join(directory, 'bash-worker.mjs'));
await copyExecutable(process.execPath, join(directory, 'node'));
await copyFile(resolve(dirname(process.execPath), '../LICENSE'), join(directory, 'NODE-LICENSE'));
await copyFile('node_modules/@larksuite/cli/bin/lark-cli', join(directory, 'lark-cli'));
await chmod(join(directory, 'lark-cli'), 0o755);
await copyFile('node_modules/@larksuite/cli/LICENSE', join(directory, 'LARK-CLI-LICENSE'));
await copyFile('src/assets/fonts/OFL.txt', join(directory, 'FONT-OFL.txt'));
await cp('tests/probes/fixtures/skills', join(directory, 'skills'), { recursive: true });
await copyFile(join(source, 'LICENSE'), join(directory, 'PI-LICENSE'));
await cp(join(source, 'packages/mcp/LICENSES'), join(directory, 'licenses/pi-mcp'), { recursive: true });
const packages = new Map();
for (const input of new Set([...Object.keys(result.metafile.inputs), ...Object.keys(business.metafile.inputs), ...Object.keys(skillsBuild.metafile.inputs), ...Object.keys(mcpBuild.metafile.inputs)])) {
  let parent = dirname(resolve(input));
  while (parent !== dirname(parent)) {
    try {
      const info = JSON.parse(await readFile(join(parent, 'package.json'), 'utf8'));
      if (info.name?.startsWith('@earendil-works/') && !(await realpath(parent)).startsWith(sourcePackages)) throw new Error('A Pi dependency resolved outside the reviewed source workspace.');
      if (info.name && !packages.has(info.name)) {
        packages.set(info.name, { name: info.name, version: info.version, license: info.license });
        const licenseDirectory = join(directory, 'licenses', info.name.replaceAll('/', '_'));
        await mkdir(licenseDirectory, { recursive: true });
        for (const name of await readdir(parent)) {
          if (/^(license|licence|copying|notice)(\.|$)/i.test(name)) {
            await copyFile(join(parent, name), join(licenseDirectory, name));
          }
        }
      }
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    parent = dirname(parent);
  }
}
await writeFile(join(directory, 'licenses/inventory.json'), JSON.stringify([...packages.values()], null, 2));
await writeFile(join(directory, 'source.json'), JSON.stringify({ ...metadata, node: process.version, larkCli: '1.0.98', mcpDiscovery:{client:'@earendil-works/pi-mcp public McpClient',transport:'Sidekick ManagedMcpTransport',sdkStdioBundled:false,inputs:Object.keys(mcpBuild.metafile.inputs)}, role: 'S0 diagnostics, organizer, Skills and MCP discovery Runtime; business state belongs to the Rust host', skills:{source:skillManifest.source,packages:skillManifest.packages.length,files:skillManifest.packages.reduce((sum,p)=>sum+p.files.length,0),supportFiles:(skillManifest.supportReferences||[]).length,license:'builtin-skills/LICENSE'} }, null, 2));
console.log('Bundled diagnostic Runtime prepared; no model credentials included.');
