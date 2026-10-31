import { readFileSync } from 'node:fs';
const mode = readFileSync(new URL('./mode.txt', import.meta.url), 'utf8').trim();
const runId = process.argv[process.argv.indexOf('--run') + 1];
const emit = value => process.stdout.write(JSON.stringify({ ...value, runId }) + '\n');
if (mode === 'no-read') {
  emit({ type: 'progress', phase: 'model' });
  setInterval(() => {}, 1000);
} else if (mode === 'result-tail') {
  emit({ type: 'result', data: { candidates: [] } });
  process.stdout.end('{"unterminated":');
} else if (mode === 'large-frame') {
  process.stdout.end(JSON.stringify({ type: 'progress', phase: 'model', runId, padding: 'x'.repeat(1200000) }) + '\n');
} else if (mode === 'total-bytes') {
  emit({ type: 'result', data: { candidates: [] } });
  for (let index = 0; index < 4; index++) emit({ type: 'progress', phase: 'model', padding: 'x'.repeat(600000) });
  process.stdout.end();
} else if (mode === 'result-only') {
  emit({ type: 'result', data: { candidates: [] } });
  process.stdout.end();
} else if (mode === 'many-frames') {
  for (let index = 0; index < 513; index++) emit({ type: 'progress', phase: 'model' });
  process.stdout.end();
} else throw new Error('Unknown controlled Runtime fault.');
