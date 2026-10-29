import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProbeEvent } from './card-state.mjs';
import { forwardListenerSignals } from './listener-lifecycle.mjs';

const directory = process.env.SIDEKICK_PROBE_PRIVATE_DIR;
const profile = process.env.SIDEKICK_LARK_PROFILE;
if (!directory || !profile) throw new Error('Set the private probe directory and explicit CLI profile');
const identity = JSON.parse(await readFile(join(directory, 'auth-status.json'), 'utf8'));
const operator = identity.identities.user.openId;
const records = [];
const sent = JSON.parse(await readFile(join(directory, 'card-send-private.json'), 'utf8'));
const expectedMessage = sent.response.data.message_id;
const state = { events: [], items: {
  's0-fixture-a': { status: 'pending', dueAt: 2000000000000, reminderAt: 0, version: 1 },
  's0-fixture-b': { status: 'pending', dueAt: 2000000000000, reminderAt: 0, version: 1 },
} };
const cli = spawn(fileURLToPath(new URL('../../node_modules/@larksuite/cli/bin/lark-cli', import.meta.url)), ['--profile', profile, 'event', 'consume', 'card.action.trigger', '--as', 'bot', '--timeout', '15m'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
});
let buffer = '';
let ready = false;
let processing = Promise.resolve();
cli.stderr.on('data', (data) => {
  if (!ready && data.toString().includes('[event] ready event_key=card.action.trigger')) {
    ready = true;
    console.log('Card callback listener ready.');
  }
});
cli.stdout.on('data', (data) => {
  buffer += data.toString();
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n');
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    processing = processing.then(async () => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const outcome = applyProbeEvent(state, event, { operator, message: expectedMessage, now: Date.now() });
      if (!['complete', 'snooze'].includes(outcome)) return;
      const action = JSON.parse(event.action_value);
      records.push({ action: outcome, todoId: action.todoId, expectedVersion: 1, syntheticOnly: true });
      await writeFile(join(directory, 'card-events-private.json'), JSON.stringify(records), { mode: 0o600 });
      await writeFile(join(directory, 'last-card-event-private.json'), JSON.stringify(event), { mode: 0o600 });
      await writeFile(join(directory, 'card-state-private.json'), JSON.stringify(state), { mode: 0o600 });
      console.log(JSON.stringify({ callbackReceived: true, action: outcome, syntheticOnly: true, events: records.length }));
      if (new Set(records.map((record) => record.action)).size === 2) cli.kill('SIGTERM');
    }).catch(() => { console.error('Controlled callback recording failed.'); process.exitCode = 1; cli.kill('SIGTERM'); });
  }
});
cli.on('exit', (code, signal) => {
  void processing.then(() => console.log(JSON.stringify({ listenerExited: true, cliExitCode: code, signal, distinctActions: [...new Set(records.map((record) => record.action))] })));
  if (code && code !== 0) process.exitCode = code;
});
forwardListenerSignals(cli);
