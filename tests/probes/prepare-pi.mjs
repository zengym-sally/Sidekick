import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = JSON.parse(await readFile(new URL('./pi-source.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../../vendor/pi/', import.meta.url));
const tree = execFileSync('git', ['rev-parse', 'HEAD:vendor/pi'], { cwd: root, encoding: 'utf8' }).trim();
if (tree !== source.tree) throw new Error('Update the reviewed Pi source provenance before building a different subtree.');
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', '.'], { cwd: root, stdio: 'inherit' });
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Unreviewed source files exist in the Pi subtree.');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const script of ['hydrate:model-data', 'build:offline']) {
  if (!manifest.scripts[script]) throw new Error(`Upstream script missing: ${script}`);
}
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: root, stdio: 'inherit', timeout: 600000,
});
execFileSync('npm', ['run', 'hydrate:model-data'], { cwd: root, stdio: 'inherit', timeout: 180000 });
execFileSync('npm', ['run', 'build:offline'], { cwd: root, stdio: 'inherit', timeout: 600000 });
console.log(JSON.stringify({ sourceRoot: root, commit: source.commit, tree }));
