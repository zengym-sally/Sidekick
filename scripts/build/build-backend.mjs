#!/usr/bin/env node
// Assemble the standalone web backend bundle (W1, owner-approved item D).
//
// Output layout (bundle root: build/web-backend/, per the frozen W1 assembly contract):
//   server/entries/web-backend-entry.mjs   Node backend entry (preserved relative layout)
//   server/lib/*.mjs                       backend libraries (preserved relative layout)
//   shared/...                             only the shared/ modules actually imported
//   bin/web-backend-storage                Rust storage adapter (release build of the
//                                          src-tauri [[bin]] web-backend-storage)
//   static/...                             frontend dist/ served same-origin by the backend
//   runtime/...                            bundled Pi Runtime closure staged from the real
//                                          build/s0-runtime output (organizer.mjs, bundled
//                                          Node, workers, builtin skills, licenses;
//                                          MAYNE-24 item C - never fabricated here)
//
// Packaging rules (enforced here, mirroring scripts/checks/check-structure.mjs):
//   - server/ code may import relative targets only inside server/ or shared/, and bare
//     specifiers only Node builtins. W1 ships zero backend npm dependencies; any bare
//     npm import is an undeclared production dependency and fails the build.
// Prerequisites are real builds, never placeholders: the server entry is candidate I's
// deliverable and the [[bin]] registration is candidate C; when they are absent this
// script fails with a named prerequisite instead of fabricating output.
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { existsSync } from 'node:fs';
import { cp, chmod, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { copyExecutable } from './copy-executable.mjs';

const bundleRoot = resolve('build/web-backend');
const serverRoot = resolve('server');
const cargoBinary = resolve('src-tauri/target/release/web-backend-storage');
const runtimeSource = resolve('build/s0-runtime');
const entryRelative = 'server/entries/web-backend-entry.mjs';

function importSpecifiers(text) {
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function isBuiltinBare(specifier) {
  if (specifier.startsWith('node:')) return true;
  return builtinModules.includes(specifier);
}

async function codeFilesUnder(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (/\.(?:mjs|cjs|js)$/.test(entry.name)) files.push(absolute);
    }
  }
  if (existsSync(directory)) await walk(directory);
  return files;
}

// Validate every relative + bare import up front (before the expensive builds) and
// collect the transitive shared/ closure the bundle must carry:
//   - server/ files: relative targets only inside server/ or shared/; bare specifiers
//     only Node builtins.
//   - shared/ files: relative targets only inside shared/; no bare imports at all
//     (mirrors the structure guard's layer.shared / layer.shared-bare rules).
async function resolveServerDependencies() {
  if (!existsSync(join(serverRoot, 'entries/web-backend-entry.mjs'))) {
    throw new Error(`Missing ${entryRelative}. The backend entry is candidate I's deliverable and has not been integrated into this tree; build-backend refuses to fabricate placeholders.`);
  }
  const sharedFiles = new Set();
  const seen = new Set();
  const queue = [];
  const enqueue = (absolutePath) => {
    if (seen.has(absolutePath)) return;
    seen.add(absolutePath);
    queue.push(absolutePath);
  };
  enqueue(join(serverRoot, 'entries/web-backend-entry.mjs'));
  for (const file of await codeFilesUnder(serverRoot)) enqueue(file);
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    const fileRelative = toPosix(relative(resolve('.'), file));
    const inServer = fileRelative.startsWith('server/');
    const inShared = fileRelative.startsWith('shared/');
    if (!inServer && !inShared) throw new Error(`Packaging violation: unexpectedly scanned ${fileRelative}.`);
    if (!existsSync(file)) {
      throw new Error(`Packaging violation: ${fileRelative} does not exist but is imported by bundled server code; fix the relative reference before packaging.`);
    }
    const text = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(text)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const targetRelative = toPosix(relative(resolve('.'), resolve(dirname(file), specifier)));
        const targetShared = targetRelative.startsWith('shared/');
        const targetServer = targetRelative.startsWith('server/');
        if (inShared && !targetShared) {
          throw new Error(`Packaging violation: shared module ${fileRelative} imports ${specifier}, which resolves outside shared/ (${targetRelative}).`);
        }
        if (inServer && !targetShared && !targetServer) {
          throw new Error(`Packaging violation: ${fileRelative} imports ${specifier}, which escapes server/ and shared/ (resolved ${targetRelative}).`);
        }
        if (targetShared) sharedFiles.add(targetRelative);
        if (/\.(?:mjs|cjs|js)$/.test(targetRelative)) enqueue(resolve(targetRelative));
        continue;
      }
      if (inShared) {
        throw new Error(`Packaging violation: shared module ${fileRelative} has bare import '${specifier}'; shared/ must stay framework/platform free.`);
      }
      if (!isBuiltinBare(specifier)) {
        throw new Error(`Packaging violation: ${fileRelative} imports bare specifier '${specifier}'. W1 server code is zero-dependency; only Node builtins are allowed.`);
      }
    }
  }
  return { sharedFiles };
}

const { sharedFiles } = await resolveServerDependencies();

// Text-intake phase (MAYNE-24 item C): the bundle must carry the real bundled Pi
// Runtime closure, staged from build/s0-runtime - the output of
// scripts/build/bundle-runtime.mjs ("npm run probe:bundle", built from the pinned
// vendor/pi source). This check runs before the expensive builds so a missing
// prerequisite fails fast with its named command instead of after the frontend and
// Rust builds.
function requireRuntimeClosure() {
  for (const name of ['organizer.mjs', 'node', 'source.json']) {
    if (!existsSync(join(runtimeSource, name))) {
      throw new Error(`Missing build/s0-runtime/${name}. The backend bundle stages the real Pi Runtime closure; run "npm run probe:prepare-cli && npm run probe:prepare-pi && npm run probe:bundle" first (build-backend refuses to fabricate runtime output).`);
    }
  }
}
requireRuntimeClosure();

console.log('Building frontend dist/ (npm run build)...');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (!existsSync(resolve('dist'))) throw new Error('Frontend build did not produce dist/.');
if (!existsSync(resolve('src-tauri/Cargo.toml'))) throw new Error('Missing src-tauri/Cargo.toml.');

console.log('Building Rust storage adapter (cargo build --release --bin web-backend-storage)...');
execFileSync('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--release', '--bin', 'web-backend-storage'], { stdio: 'inherit' });
if (!existsSync(cargoBinary)) throw new Error('Cargo build did not produce the web-backend-storage binary; check that src-tauri/Cargo.toml registers the [[bin]] (owner-approved item C).');

await rm(bundleRoot, { recursive: true, force: true });
await mkdir(bundleRoot, { recursive: true });
await cp(serverRoot, join(bundleRoot, 'server'), { recursive: true });
for (const file of sharedFiles) {
  await mkdir(dirname(join(bundleRoot, file)), { recursive: true });
  await cp(file, join(bundleRoot, file), { recursive: true });
}
await mkdir(join(bundleRoot, 'bin'), { recursive: true });
await copyExecutable(cargoBinary, join(bundleRoot, 'bin/web-backend-storage'));
await cp(resolve('dist'), join(bundleRoot, 'static'), { recursive: true });
// Stage the bundled Pi Runtime closure wholesale so the backend bundle carries the
// same reviewed runtime layout as the packaged app (s0-runtime), then restore the
// executable bits the bundled Node interpreter and lark-cli need to stay directly
// spawnable by the backend worker host.
await cp(runtimeSource, join(bundleRoot, 'runtime'), { recursive: true });
for (const executable of ['runtime/node', 'runtime/lark-cli']) {
  await chmod(join(bundleRoot, executable), 0o755);
}

const bundleBinary = await stat(join(bundleRoot, 'bin/web-backend-storage'));
const bundleRuntimeNode = await stat(join(bundleRoot, 'runtime/node'));
console.log(`Web backend bundle assembled at build/web-backend/ (server sources copied, ${sharedFiles.size} shared module(s), storage binary ${bundleBinary.size} bytes, frontend dist/ -> static/, Pi runtime closure staged with bundled Node ${bundleRuntimeNode.size} bytes).`);
console.log('Start it with: npm run start:backend -- --root <workspaceRoot> (see server/entries/web-backend-entry.mjs for the CLI contract).');
