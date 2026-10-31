#!/usr/bin/env node
// Local-link guard for the authoritative Markdown documents.
// Checks README.md, AGENTS.md, DESIGN.md, design/README.md and docs/**/*.md
// (docs/reviews/** is excluded, but docs/reviews/README.md is included).
// Skips code fences, inline code, external links, anchors, data:/mailto:, and absolute paths.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();
const ROOT_DOCS = ['README.md', 'AGENTS.md', 'DESIGN.md', 'design/README.md'];

function collectDocsFiles() {
  const files = [];
  for (const rel of ROOT_DOCS) if (existsSync(join(ROOT, rel))) files.push(rel);
  const walk = (relativeDirectory) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, relativeDirectory), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === 'docs/reviews') {
          if (existsSync(join(ROOT, 'docs/reviews/README.md'))) files.push('docs/reviews/README.md');
          continue;
        }
        walk(rel);
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        files.push(rel);
      }
    }
  };
  if (existsSync(join(ROOT, 'docs'))) walk('docs');
  return [...new Set(files)].sort();
}

function extractLinkTargets(line) {
  const targets = [];
  for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) targets.push(match[1]);
  return targets;
}

function normalizeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#') || target.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return null;
  if (target.startsWith('/') || target.startsWith('~')) return null;
  const hash = target.indexOf('#');
  const query = target.indexOf('?');
  let end = target.length;
  if (hash >= 0) end = Math.min(end, hash);
  if (query >= 0) end = Math.min(end, query);
  let pathPart = target.slice(0, end);
  if (!pathPart) return null;
  if (/%[0-9a-fA-F]{2}/.test(pathPart)) {
    try {
      pathPart = decodeURIComponent(pathPart);
    } catch {
      // Keep the literal path when percent-decoding is not valid UTF-8.
    }
  }
  return pathPart;
}

function checkFile(relativeFile) {
  const text = readFileSync(join(ROOT, relativeFile), 'utf8');
  const lines = text.split('\n');
  const problems = [];
  let checked = 0;
  let fenceMarker = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[1][0];
      else if (fence[1][0] === fenceMarker) fenceMarker = null;
      continue;
    }
    if (fenceMarker) continue;
    const withoutInlineCode = line.replace(/(`+)([\s\S]*?)\1/g, ' ');
    for (const rawTarget of extractLinkTargets(withoutInlineCode)) {
      const pathPart = normalizeTarget(rawTarget);
      if (!pathPart) continue;
      checked++;
      if (!existsSync(resolve(ROOT, dirname(relativeFile), pathPart))) problems.push({ line: index + 1, target: rawTarget, pathPart });
    }
  }
  return { checked, problems };
}

const files = collectDocsFiles();
let checked = 0;
let failures = 0;
for (const file of files) {
  const { checked: fileChecked, problems } = checkFile(file);
  checked += fileChecked;
  for (const problem of problems) {
    failures++;
    console.log(`FAIL ${file}:${problem.line} local link target does not exist: ${problem.target} (resolved ${problem.pathPart})`);
  }
}
if (failures) {
  console.log(`\n✗ docs link check failed: ${failures} broken local link(s) in ${files.length} files (${checked} local links checked).`);
  process.exitCode = 1;
} else {
  console.log(`✓ docs link check passed (${files.length} files, ${checked} local links resolved).`);
}
