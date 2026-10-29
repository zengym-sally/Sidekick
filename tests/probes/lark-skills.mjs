import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const input = process.env.SIDEKICK_SKILLS_SOURCE;
assert.ok(input, 'Set SIDEKICK_SKILLS_SOURCE to the explicitly selected local lark skill directory');
const piRoot = fileURLToPath(new URL('../../vendor/pi/', import.meta.url));
const { loadSkills } = await import(pathToFileURL(join(piRoot, 'packages/coding-agent/dist/core/skills.js')));
const root = await mkdtemp(join(tmpdir(), 'sidekick-lark-skills-'));
try {
  const packages = (await readdir(input)).filter((name) => name.startsWith('lark-'));
  for (const name of packages) await cp(join(input, name), join(root, 'skills', name), { recursive: true, dereference: true });
  const loaded = loadSkills({ cwd: root, agentDir: join(root, 'empty-agent'), skillPaths: [join(root, 'skills')], includeDefaults: false });
  assert.equal(loaded.skills.length, packages.length);
  assert.equal(loaded.diagnostics.filter((item) => item.type === 'collision').length, 0);
  for (const skill of loaded.skills) assert.ok(resolve(skill.filePath).startsWith(root));
  const doc = loaded.skills.find((skill) => skill.name === 'lark-doc');
  assert.ok((await readFile(join(doc.baseDir, 'references/lark-doc-fetch.md'), 'utf8')).includes('+fetch'));
  assert.ok((await readFile(resolve(doc.baseDir, '../lark-shared/SKILL.md'), 'utf8')).includes('lark-cli'));
  console.log(JSON.stringify({ status: 'passed', explicitPackages: packages.length, loadedPackages: loaded.skills.length, defaultGlobalScan: false, referenceFileRead: true, crossPackageReferenceRead: true, sourceFilesChanged: false, productSeedInstallation: false }));
} finally { await rm(root, { recursive: true, force: true }); }
