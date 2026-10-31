#!/usr/bin/env node
// Mechanical structure guard for the Sidekick repository.
// - Working set: `git ls-files` (tracked + untracked, ignored paths excluded).
// - Checks: relative-reference boundaries/existence, top-level whitelist, tracked forbidden paths,
//   directory layout, expected packaging entries, package.json path hygiene.
// - `--self-test` builds a synthetic tree under a temp directory and asserts violations are detected.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();

const TOP_LEVEL_DIRS = new Set(['.cargo', '.impeccable', 'design', 'docs', 'resources', 'runtime', 'scripts', 'shared', 'src', 'src-tauri', 'tests', 'vendor']);
const ROOT_FILES = new Set(['.gitignore', '.env.example', 'AGENTS.md', 'DESIGN.md', 'PRODUCT.md', 'README.md', 'index.html', 'package-lock.json', 'package.json', 'tsconfig.json', 'vite.config.ts']);
const FORBIDDEN_TRACKED = ['build/', 'dist/', 'src-tauri/target/', 'node_modules/'];
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;

const RUNTIME_TOP = new Set(['entries', 'lib', 'workers']);
const SCRIPTS_TOP = new Set(['build', 'checks', 'probes']);
const TESTS_TOP = new Set(['unit', 'integration', 'probes']);
const SRC_TAURI_TOP_DIRS = new Set(['app', 'store', 'host', 'diagnostics']);
const SRC_TAURI_TOP_FILES = new Set(['lib.rs', 'main.rs']);
const EXPECTED_ENTRIES = [
  'runtime/entries/probe-entry.mjs',
  'runtime/entries/organizer-entry.mjs',
  'runtime/entries/mcp-probe-entry.mjs',
  'runtime/entries/skills-manager.mjs',
  'runtime/workers/bash-worker.mjs',
  'runtime/workers/mcp-guardian.mjs',
];

const SCAN_TOPS = ['src/', 'shared/', 'runtime/', 'tests/', 'scripts/', 'design/'];
const CODE_EXT = /\.(?:mjs|cjs|js|mts|cts|ts|jsx|tsx|vue)$/;
const CSS_EXT = /\.css$/;
const HTML_EXT = /\.html?$/;
const RESOLVE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.cjs', '.jsx', '.tsx', '.vue', '.css', '.json', '.d.mts', '.d.ts'];
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function gitFiles(args) {
  const output = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', ...args], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  return output.toString('utf8').split('\0').filter(Boolean).map(toPosix);
}

function repoFiles() {
  return gitFiles(['--cached', '--others', '--exclude-standard']);
}

function trackedFiles() {
  return gitFiles(['--cached']);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function splitPath(path) {
  return toPosix(path).split('/').filter(Boolean);
}

function absOf(root, repoPath) {
  return resolve(root, ...splitPath(repoPath));
}

function relOf(root, absPath) {
  return toPosix(relative(root, absPath));
}

function relativeSpecifierExists(absTarget) {
  if (existsSync(absTarget)) return true;
  for (const extension of RESOLVE_EXTENSIONS) if (existsSync(`${absTarget}${extension}`)) return true;
  for (const extension of RESOLVE_EXTENSIONS) if (existsSync(join(absTarget, `index${extension}`))) return true;
  return false;
}

function importSpecifiers(text) {
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push({ specifier: match[1], index: match.index ?? 0 });
  }
  return found;
}

function cssSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(/@import\s+(url\(\s*)?['"]([^'"]+)['"]/g)) found.push({ specifier: match[2], index: match.index ?? 0, packageImport: !match[1] });
  for (const match of text.matchAll(/url\(\s*(?:['"]([^'"]+)['"]|([^'")]+?))\s*\)/g)) found.push({ specifier: match[1] ?? match[2], index: match.index ?? 0 });
  return found;
}

function htmlSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)) found.push({ specifier: match[1], index: match.index ?? 0 });
  return found;
}

function specifiersOf(file, text) {
  if (CODE_EXT.test(file)) return importSpecifiers(text);
  if (CSS_EXT.test(file)) return cssSpecifiers(text);
  if (HTML_EXT.test(file)) return htmlSpecifiers(text);
  return [];
}

function isRelativeSpecifier(specifier, file = '') {
  if (!specifier || specifier.startsWith('#') || specifier.startsWith('?') || specifier.startsWith('//')) return false;
  if (SCHEME.test(specifier)) return false;
  if (specifier.startsWith('/') || specifier.startsWith('~')) return false;
  return CSS_EXT.test(file) || HTML_EXT.test(file) || specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
}

function layerFor(file) {
  if (file.startsWith('src/')) return { rule: 'layer.src', allowed: ['src/', 'shared/'] };
  if (file.startsWith('runtime/')) return { rule: 'layer.runtime', allowed: ['runtime/', 'shared/'] };
  if (file.startsWith('shared/')) return { rule: 'layer.shared', allowed: ['shared/'] };
  if (file.startsWith('design/')) return { rule: 'layer.design', allowed: ['design/', 'src/assets/', 'src/styles/'] };
  return null;
}

function targetWithin(targetRel, allowed) {
  const normalized = targetRel.endsWith('/') ? targetRel : `${targetRel}/`;
  return allowed.some((prefix) => normalized.startsWith(prefix));
}

function checkReferenceTarget(root, file, specifier, line, add) {
  const clean = specifier.split('#')[0].split('?')[0];
  if (!clean) return null;
  const parts = splitPath(file);
  const fromDirectory = resolve(root, ...parts.slice(0, -1));
  const absTarget = resolve(fromDirectory, clean);
  const targetRel = relOf(root, absTarget);
  if (targetRel === '..' || targetRel.startsWith('../') || isAbsolute(targetRel)) {
    add('ref.outside', file, line, `relative reference escapes the repository: ${specifier}`);
    return { absTarget, targetRel };
  }
  const layer = layerFor(file);
  if (layer && !targetWithin(targetRel, layer.allowed)) {
    add(layer.rule, file, line, `${file.split('/')[0]}/ may only reference ${layer.allowed.join(' or ')}; got ${specifier} (${targetRel})`);
  }
  if (!relativeSpecifierExists(absTarget)) {
    add('ref.missing', file, line, `relative reference target does not exist: ${specifier} (${targetRel})`);
  }
  return { absTarget, targetRel };
}

function checkPackageJson(root, packagePath, add) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    add('pkg.unreadable', 'package.json', 1, `cannot parse package.json: ${error.message}`);
    return new Set();
  }
  const scripts = manifest.scripts ?? {};
  const check = typeof scripts.check === 'string' ? scripts.check : '';
  const structureAt = check.indexOf('check:structure');
  const docsAt = check.indexOf('check:docs');
  if (structureAt < 0 || docsAt < 0) add('pkg.check-order', 'package.json', 1, 'scripts.check must include check:structure and check:docs');
  else if (structureAt > docsAt) add('pkg.check-order', 'package.json', 1, 'scripts.check must run check:structure before check:docs');
  for (const name of ['check:structure', 'check:docs']) {
    if (typeof scripts[name] !== 'string' || !scripts[name].trim()) add('pkg.check-order', 'package.json', 1, `missing scripts.${name}`);
  }
  const raw = readFileSync(packagePath, 'utf8');
  if (/tests\/s[0-9]/.test(raw)) add('pkg.old-test-path', 'package.json', 1, 'package.json still contains a flat tests/s<slice> path');
  if (/tests\/layout-/.test(raw)) add('pkg.old-test-path', 'package.json', 1, 'package.json still contains a flat tests/layout- path');
  if (/scripts\/probes\/bundle-runtime/.test(raw)) add('pkg.old-script-path', 'package.json', 1, 'package.json still points at scripts/probes/bundle-runtime');
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
}

function checkLayout(files, add) {
  for (const file of files) {
    const parts = splitPath(file);
    const base = parts.at(-1) ?? '';
    if (file.startsWith('tests/')) {
      const isTest = base.endsWith('.test.mjs');
      if (file.startsWith('tests/fixtures/') && isTest) add('layout.fixtures-test', file, 1, 'tests/fixtures is input-only; test files must live in unit/, integration/ or probes/');
      else if (isTest && !TESTS_TOP.has(parts[1] ?? '')) add('layout.tests-flat', file, 1, '*.test.mjs must live in tests/unit/, tests/integration/ or tests/probes/');
    }
    if (file.startsWith('runtime/') && !RUNTIME_TOP.has(parts[1] ?? '')) add('layout.runtime-top', file, 1, 'runtime/ top level may only contain entries/, lib/, workers/');
    if (file.startsWith('scripts/') && !SCRIPTS_TOP.has(parts[1] ?? '')) add('layout.scripts-top', file, 1, 'scripts/ top level may only contain build/, checks/, probes/');
    if (file.startsWith('src-tauri/src/')) {
      const top = parts[2] ?? '';
      if (!SRC_TAURI_TOP_DIRS.has(top) && !SRC_TAURI_TOP_FILES.has(top)) add('layout.src-tauri-top', file, 1, 'src-tauri/src top level may only contain lib.rs, main.rs, app/, store/, host/, diagnostics/');
    }
  }
}

function checkTopLevel(files, add) {
  for (const file of files) {
    const parts = splitPath(file);
    if (parts.length === 1) {
      if (!ROOT_FILES.has(parts[0])) add('top.file', file, 1, `unexpected tracked root file: ${parts[0]}`);
    } else if (!TOP_LEVEL_DIRS.has(parts[0])) {
      add('top.dir', file, 1, `unexpected top-level directory: ${parts[0]}`);
    }
  }
}

function checkTrackedForbidden(tracked, add) {
  for (const file of tracked) {
    if (FORBIDDEN_TRACKED.some((prefix) => file.startsWith(prefix))) add('tracked.forbidden', file, 1, 'generated/vendor output must never be tracked');
    if (ENV_FILE.test(file) && !file.endsWith('.env.example')) add('tracked.env', file, 1, 'environment files must not be tracked (except .env.example)');
  }
}

const DESIGN_NODE_TOOLS = new Set(['design/serve.mjs', 'design/verify.cjs']);

function checkBareImports(root, files, add) {
  for (const file of files) {
    if (!CODE_EXT.test(file)) continue;
    const inShared = file.startsWith('shared/');
    const inDesign = file.startsWith('design/');
    if (!inShared && !inDesign) continue;
    const text = readFileSync(absOf(root, file), 'utf8');
    for (const { specifier, index } of importSpecifiers(text)) {
      if (isRelativeSpecifier(specifier)) continue;
      const line = lineOf(text, index);
      if (inShared && (specifier === 'vue' || specifier.startsWith('vue/') || specifier.startsWith('@tauri-apps/') || specifier.startsWith('node:'))) {
        add('layer.shared-bare', file, line, `shared/ must stay framework/platform free; forbidden import: ${specifier}`);
      }
      if (inDesign && specifier.startsWith('node:') && !DESIGN_NODE_TOOLS.has(file)) {
        add('layer.design-node', file, line, `design/ may only use node:* in serve.mjs/verify.cjs tooling; got ${specifier}`);
      }
    }
  }
}

function collect(options) {
  const { root, files, tracked, packagePath } = options;
  const violations = [];
  const add = (rule, file, line, message) => violations.push({ rule, file, line, message });
  checkTopLevel(files, add);
  checkTrackedForbidden(tracked, add);
  checkLayout(files, add);
  checkBareImports(root, files, add);
  const packageImports = packagePath && existsSync(packagePath) ? checkPackageJson(root, packagePath, add) : new Set();

  let scannedFiles = 0;
  let references = 0;
  for (const file of files) {
    if (!SCAN_TOPS.some((prefix) => file.startsWith(prefix))) continue;
    // The guards live here and contain intentionally invalid synthetic references for --self-test.
    if (file.startsWith('scripts/checks/')) continue;
    if (!CODE_EXT.test(file) && !CSS_EXT.test(file) && !HTML_EXT.test(file)) continue;
    scannedFiles++;
    const text = readFileSync(absOf(root, file), 'utf8');
    for (const { specifier, index, packageImport } of specifiersOf(file, text)) {
      if (packageImport && file.startsWith('src/') && packageImports.has(specifier)) continue;
      if (!isRelativeSpecifier(specifier, file)) continue;
      references++;
      checkReferenceTarget(root, file, specifier, lineOf(text, index), add);
    }
  }
  for (const entry of EXPECTED_ENTRIES) {
    if (!existsSync(absOf(root, entry))) add('layout.entry-missing', entry, 1, 'expected Runtime packaging entry is missing');
  }
  return { violations, scannedFiles, references };
}

function report(violations) {
  if (!violations.length) return;
  for (const violation of violations) console.log(`FAIL [${violation.rule}] ${violation.file}:${violation.line} ${violation.message}`);
  const rules = new Set(violations.map((violation) => violation.rule));
  console.log(`\n✗ structure check failed: ${violations.length} violation(s) across ${rules.size} rule(s).`);
}

function runRepoCheck() {
  let files;
  let tracked;
  try {
    files = repoFiles();
    tracked = trackedFiles();
  } catch (error) {
    console.log(`✗ structure check failed: cannot read git file list: ${error.message}`);
    return 1;
  }
  const { violations, scannedFiles, references } = collect({ root: ROOT, files, tracked, packagePath: join(ROOT, 'package.json') });
  if (violations.length) {
    report(violations);
    return 1;
  }
  console.log(`✓ structure check passed (${scannedFiles} source files scanned, ${references} relative references resolved).`);
  return 0;
}

function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), 'sidekick-structure-self-test-'));
  const files = [];
  const write = (relativePath, content = '') => {
    const abs = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    files.push(relativePath);
    return relativePath;
  };
  try {
    write('package.json', `${JSON.stringify({ devDependencies: { tailwindcss: '0.0.0' }, scripts: { check: 'node tests/s1-domain.test.mjs && node scripts/probes/bundle-runtime.mjs && npm run probe:bundle' } }, null, 2)}\n`);
    write('.gitignore');
    write('.env.local');
    write('build/leak.txt');
    write('dist/bundle.js');
    write('agent-notes.md');
    write('shared/clean.mjs', "export const value = 1;\n");
    write('shared/bad.mjs', "import { ref } from 'vue';\nimport { readFile } from 'node:fs/promises';\n");
    write('src/clean.mjs', "import { value } from '../shared/clean.mjs';\nimport { ref } from 'vue';\n");
    write('src/clean.css', '@import "tailwindcss";\n');
    write('src/bad-package-url.css', 'body { src: url(tailwindcss); }\n');
    write('src/bad-package-path.html', '<script src="tailwindcss"></script>\n');
    write('src/bad.mjs', "import { managedBash } from '../runtime/lib/managed-bash.mjs';\nimport { missing } from './missing-module.mjs';\nexport { value } from '../shared/clean.mjs';\n");
    write('runtime/lib/managed-bash.mjs');
    write('runtime/flat.mjs');
    write('design/assets/style.css');
    write('design/assets/script.js');
    write('design/assets/font.ttf');
    write('design/clean.html', '<a href="#top">anchor</a><a href="https://example.invalid/">external</a><img src="data:image/png;base64,AA"><link href="assets/style.css"><script src="assets/script.js"></script>\n');
    write('design/clean.css', '@import "assets/style.css";\nbody { src: url(assets/font.ttf); background: url(https://example.invalid/image.png); }\n');
    write('design/bad.html', '<a href="../../src-tauri/tauri.conf.json">escape</a>\n<script src="missing.js"></script>\n<link href="missing.css">\n');
    write('design/bad.css', '@import "missing.css";\nbody { src: url(font.ttf); }\n');
    write('design/bad-bare-layer.html', '<script src="assets/../../runtime/lib/managed-bash.mjs"></script>\n');
    write('design/bad-bare-layer.css', 'body { src: url(assets/../../runtime/lib/managed-bash.mjs); }\n');
    write('design/bad-layer.html', '<link rel="stylesheet" href="../docs/README.md">\n');
    write('design/serve.mjs', "import { statSync } from 'node:fs';\n");
    write('design/bad-node.mjs', "import { readFileSync } from 'node:fs';\n");
    write('tests/s2-bash.test.mjs');
    write('tests/fixtures/sample.test.mjs');
    write('scripts/loose.mjs');
    write('src-tauri/src/lib.rs');
    write('src-tauri/src/loose.rs');
    write('vendor/pi/README.md');

    const { violations } = collect({ root, files, tracked: files, packagePath: join(root, 'package.json') });
    const observed = new Set(violations.map((violation) => violation.rule));
    const expected = [
      ['layer.src', 'cross-layer import outside src/shared'],
      ['layer.design', 'design reference outside design/src assets/src styles'],
      ['layer.design-node', 'node:* import outside design tooling'],
      ['layer.shared-bare', 'shared framework/node import'],
      ['ref.missing', 'missing relative target'],
      ['ref.outside', 'reference escaping the repository'],
      ['layout.tests-flat', 'flat tests/*.test.mjs'],
      ['layout.fixtures-test', 'test file inside tests/fixtures'],
      ['layout.runtime-top', 'file directly under runtime/'],
      ['layout.scripts-top', 'file directly under scripts/'],
      ['layout.src-tauri-top', 'unexpected src-tauri/src top-level file'],
      ['tracked.forbidden', 'forbidden tracked build/dist path'],
      ['tracked.env', 'tracked .env file'],
      ['top.file', 'unexpected root file'],
      ['pkg.check-order', 'npm check does not run structure/docs guards'],
      ['pkg.old-test-path', 'legacy flat tests/s<slice> path'],
      ['pkg.old-script-path', 'legacy scripts/probes/bundle-runtime path'],
      ['layout.entry-missing', 'missing Runtime packaging entry'],
    ];
    const missing = expected.filter(([rule]) => !observed.has(rule));
    if (missing.length) {
      console.log('✗ structure self-test failed; expected violations were not detected:');
      for (const [rule, description] of missing) console.log(`  - ${rule}: ${description}`);
      console.log(`  observed: ${[...observed].sort().join(', ')}`);
      return 1;
    }
    const expectedReferences = [
      ['ref.missing', 'design/bad.html', 2],
      ['ref.missing', 'design/bad.html', 3],
      ['ref.missing', 'design/bad.css', 1],
      ['ref.missing', 'design/bad.css', 2],
      ['layer.design', 'design/bad-bare-layer.html', 1],
      ['layer.design', 'design/bad-bare-layer.css', 1],
      ['ref.missing', 'src/bad-package-url.css', 1],
      ['ref.missing', 'src/bad-package-path.html', 1],
    ];
    const missingReferences = expectedReferences.filter(([rule, file, line]) => !violations.some((violation) => violation.rule === rule && violation.file === file && violation.line === line));
    if (missingReferences.length) {
      console.log('✗ structure self-test failed; expected reference violations were not detected:');
      for (const [rule, file, line] of missingReferences) console.log(`  - [${rule}] ${file}:${line}`);
      return 1;
    }
    const cleanFiles = ['design/clean.html', 'design/clean.css', 'design/assets/style.css', 'design/assets/script.js', 'design/serve.mjs', 'src/clean.mjs', 'src/clean.css', 'shared/clean.mjs'];
    const cleanFalsePositive = violations.some((violation) => cleanFiles.includes(violation.file));
    if (cleanFalsePositive) {
      console.log('✗ structure self-test failed: valid sample files were flagged:');
      for (const violation of violations.filter((item) => cleanFiles.includes(item.file))) console.log(`  - [${violation.rule}] ${violation.message}`);
      return 1;
    }
    console.log(`✓ structure self-test passed (${expected.length} violation classes and ${expectedReferences.length} individual reference violations detected in a synthetic tree; clean samples stayed clean).`);
    return 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

process.exitCode = process.argv.includes('--self-test') ? runSelfTest() : runRepoCheck();
