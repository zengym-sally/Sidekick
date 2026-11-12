// Capability-UI BEHAVIORAL faces for the three dispatched production paths
// (src/components/AgentSettingsPanel.vue, ModelSettingsPanel.vue,
// SettingsPanel.vue), MAYNE-24, revision r2 per dispatch comment 01a1c18d
// (r1 pinned the same faces as source-string byte facts; r2 replaces that
// protection with observation of the actually compiled and mounted SFCs).
//
// Method, stated honestly:
// - The panels are compiled by the production Vite pipeline (repo
//   vite.config.ts + @vitejs/plugin-vue) inside the Vite dev server this test
//   starts in middleware mode, and mounted in real headless Chrome through the
//   zero-dependency DevTools driver (same pattern as
//   tests/fixtures/web-manual-items/browser-probe.mjs). The in-page harness is
//   tests/fixtures/web-text-intake/capability-ui-page/; the faces OBSERVE and
//   return plain JSON, every assertion lives HERE.
// - Real behavior is exercised: control states read from the live DOM, real
//   click/input events dispatched in the page, request counting at the store
//   transport boundary, and the existing draft-retention flow. The store
//   factories are injected with a RECORDING transport at their documented
//   injection seam (src/lib/web-api-client.ts: "Tests and fixtures may still
//   construct or inject their own client"); the guard callbacks replicated in
//   the harness are the production store wiring lines verbatim. No production
//   judgment lives in the fixtures — responder answers are seed data at the
//   backend boundary only (including the frozen WIRED_AGENT_IDS 404 mirror for
//   tracker/advisor reads).
// - The three production blobs are NOT touched by this revision: faces mount
//   the production paths (fixed blobs 8a44fc3d/e67f8d18/73c1f643 at the r2
//   authoring commit).
// - Negative controls: tests/fixtures/web-text-intake/capability-ui-baseline-*.vue.txt
//   stay byte-pinned snapshots of the registered pre-fix baseline blobs. They
//   are tamper-evidence ONLY (never compiled, never executed) — the byte pin
//   below is NOT a behavior claim. Harness sensitivity is demonstrated by the
//   RED tree run (isolated worktree with the pre-fix production blobs restored)
//   and by the minimal counter-control mutants recorded in
//   build/mayne24-capability-ui-behavioral/ (each pierces exactly the face that
//   protects the mutated behavior).
// - Boundaries: no server/SSE/native/D1 claims, no aggregate suite, no full
//   gate. Without Chrome the behavioral faces skip, the same convention as
//   the web-manual-items browser acceptance suite.
// - Zero production increment is measured against the PARENT commit `60ecc75`
//   (the three blobs are equal there) — NOT against the cd08588+b5 combined
//   baseline, where these paths hold the post-fix bytes and differ from the
//   cd08588 originals (107b8d74/d8273800/fa75f477; corrected per coordinator
//   dispatch 01a1c1b2). The recording transport is injected at the store
//   factories' documented Backend seam; the default HTTP wiring is NOT what
//   these faces exercise.
// - Budget + reclaim contract (hardened per coordinator dispatch 01a1c1b2):
//   every case passes its hard budget at the entry — WORK_MS bounds all
//   resource work and a RESERVED CLEANUP_MS bounds the whole close path
//   (14000 + 6000 = the runner's 20s per-test timeout). Startup waits, CDP
//   calls and in-page waits are bounded by the remaining work budget;
//   startChrome reclaims the child (socket close + SIGKILL + exit confirm) on
//   every startup failure before propagating; session.close() attempts every
//   step (chrome, vite, http, profile) regardless of earlier failures and
//   reports ok=false when any failed — nothing skipped, nothing silently
//   swallowed; a failed session start attaches the SAME report to the
//   ORIGINAL error (error.cleanupReport), so the case failure and cleanup
//   diagnostics are preserved together. close(faults) carries a TEST-ONLY
//   counter-control seam: hooks run after the real attempt and only override
//   the recorded verdict. The runner's forced exit is never relied upon as
//   cleanup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromeAvailable, startCapabilityUiSession } from '../fixtures/web-text-intake/capability-ui-session.mjs';

// Hard budget passed at the case entry (the runner gives each test 20000ms):
// resource work 14s + reserved cleanup 6s. The split guarantees cleanup has
// its own time even when the work budget is exhausted by a failure path.
const WORK_MS = 14000;
const CLEANUP_MS = 6000;
const CASE_BUDGET_MS = WORK_MS + CLEANUP_MS;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// T1 — negative-control byte pins (NOT a behavior claim; see header).
// ---------------------------------------------------------------------------
test('baseline fixture snapshots stay byte-identical to the registered blobs (negative control only)', () => {
  const baselineAgent = read('../fixtures/web-text-intake/capability-ui-baseline-AgentSettingsPanel.vue.txt');
  const baselineModel = read('../fixtures/web-text-intake/capability-ui-baseline-ModelSettingsPanel.vue.txt');
  const baselineSettings = read('../fixtures/web-text-intake/capability-ui-baseline-SettingsPanel.vue.txt');
  assert.equal(sha256(baselineAgent), 'e289bae48e7a09a61f208d4cf0c238fa0c8dec1f88d44c474331527e2d9d7630');
  assert.equal(sha256(baselineModel), '2e0253663bd083f5c5e75a9c1ef6749dd14c059d077c8797f43630955b071f7d');
  assert.equal(sha256(baselineSettings), 'cdaa145c97684c102315065ec30eec08a0df4fd6dba4ef2b60e48fbbd9b1fcf1');
});

// ---------------------------------------------------------------------------
// Seed data — answers the recording transport gives at the backend boundary.
// ---------------------------------------------------------------------------
const seedConfiguration = {
  providers: { providers: [{ id: 'p1', name: '网关一号', apiFormat: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1', auth: { type: 'bearer', apiKeyRef: 'ref:sidekick-p1' }, enabled: true }] },
  models: { models: [{ id: 'm1', providerId: 'p1', name: '主力模型', apiModelId: 'gpt-x', enabled: true, limits: { maxInputTokens: 32000, maxOutputTokens: 4096 }, capabilities: { toolCall: true } }] },
  defaultModelId: 'm1',
  revision: 'cfg-7',
  credentialStatus: { p1: 'available' },
};
const seedOrganizerConfig = { version: 1, agentId: 'organizer', revision: 'org-7', modelId: null, preferences: { detail: 'standard', focus: 'balanced' }, supplementalInstructions: '' };
// The "server" value after a successful re-read: still empty — the typed draft
// was never saved, so a retained draft can only come from the client.
const seedSavedOrganizerConfig = { ...seedOrganizerConfig, revision: 'org-8', supplementalInstructions: '' };
// The snapshot carries the configuration revision the test ran against, like
// the real service — the panel compares it to flag stale results.
const seedTestRun = { id: 'run-1', sourceId: null, kind: 'test', status: 'succeeded', snapshot: { modelId: 'm1', revision: 'cfg-7' }, input: {}, candidateId: null, candidateVersion: null, preview: null, errorCode: null, createdAtMs: Date.now(), finishedAtMs: Date.now() };

const agentSeed = { preload: ['settings', 'models', 'agent-organizer'], configuration: seedConfiguration, agentConfigs: { organizer: seedOrganizerConfig } };
const modelSeed = { configuration: seedConfiguration, agentConfigs: { organizer: seedOrganizerConfig } };
const credentialSeed = { preload: ['models'], configuration: seedConfiguration, agentConfigs: { organizer: seedOrganizerConfig } };
// The settings mount renders the real shell; switching to the agents tab
// mounts the real AgentSettingsPanel, whose onMounted reads the organizer
// configuration, so the seed carries it.
const settingsSeed = { agentConfigs: { organizer: seedOrganizerConfig } };
const draftSeed = { preload: ['settings', 'models', 'agent-organizer'], configuration: seedConfiguration, agentConfigs: { organizer: seedOrganizerConfig }, failAgentSave: true, savedAgentConfig: seedSavedOrganizerConfig };
const connectivitySeed = { preload: ['models'], configuration: seedConfiguration, agentConfigs: { organizer: seedOrganizerConfig }, testRun: seedTestRun };

// ---------------------------------------------------------------------------
// Behavioral faces on the compiled+mounted production panels.
// ---------------------------------------------------------------------------
test('behavioral faces on the compiled+mounted panels', async (t) => {
  if (!chromeAvailable()) return t.skip('Chrome unavailable; behavioral mount acceptance not verified');
  const session = await startCapabilityUiSession({ workMs: WORK_MS, cleanupMs: CLEANUP_MS });
  try {
    // B1 — only the wired role is configurable: tracker/advisor tabs disabled
    // and marked 未接通; clicking tracker cannot select it (real event, and the
    // request log proves no tracker configuration read follows).
    await t.test('B1 role tabs open organizer only and mark unwired roles', async () => {
      const obs = await session.face('role-tabs', agentSeed);
      assert.deepEqual(obs.tabsBefore.map((tab) => tab.text), ['事项整理', '进展跟踪 · 未接通', '工作参谋 · 未接通']);
      assert.equal(obs.tabsBefore[0].disabled, false);
      assert.equal(obs.tabsBefore[1].disabled, true);
      assert.equal(obs.tabsBefore[2].disabled, true);
      assert.equal(obs.tabsBefore[0].pressed, 'true');
      assert.equal(obs.selectedAfter, 'organizer');
      assert.ok(!obs.callsAfterTrackerClick.includes('read_agent_configuration'),
        `clicking the disabled tracker tab must issue no agent read: ${JSON.stringify(obs.callsAfterTrackerClick)}`);
    });

    // B2 — no pre-read of unwired roles: the mount-time request log contains
    // exactly one model-configuration read and exactly one agent read, for the
    // organizer only.
    await t.test('B2 model panel mount pre-reads organizer only', async () => {
      const obs = await session.face('model-mount-requests', modelSeed);
      assert.equal(obs.calls.filter((c) => c.command === 'read_model_configuration').length, 1,
        `model configuration must be read once: ${JSON.stringify(obs.calls)}`);
      const agentReads = obs.calls.filter((c) => c.command === 'read_agent_configuration');
      assert.deepEqual(agentReads.map((c) => c.agentId), ['organizer'],
        `only the organizer agent may be pre-read: ${JSON.stringify(agentReads)}`);
    });

    // B3 — isolated trial run is disabled with the honest not-wired copy; the
    // start button click (real event) issues no start command.
    await t.test('B3 trial entry is disabled with honest copy and issues no start command', async () => {
      const obs = await session.face('trial-disabled', agentSeed);
      assert.equal(obs.startFound, true, 'the trial start button must render');
      assert.equal(obs.startDisabled, true, 'the trial start button must be disabled');
      assert.equal(obs.sampleDisabled, true, 'the trial sample input must be disabled');
      assert.ok(obs.noteText.includes('隔离试跑在当前管道未接通'), `honest not-wired note expected, got: ${JSON.stringify(obs.noteText)}`);
      assert.ok(obs.noteText.includes('仅保留为草稿'), `draft-only disclosure expected, got: ${JSON.stringify(obs.noteText)}`);
      assert.ok(obs.resultText.includes('暂无试跑结果'), `empty trial result copy expected, got: ${JSON.stringify(obs.resultText)}`);
      assert.ok(!obs.callsAfterStartClick.includes('start_agent_trial'),
        `a disabled start button must issue no start command: ${JSON.stringify(obs.callsAfterStartClick)}`);
    });

    // B3b — the trial entry stays disabled with a Tauri-like host flag present:
    // the gate is the pipe, not the host flag (试跑不因宿主标志解锁).
    await t.test('B3b trial entry stays disabled with a native host flag present', async () => {
      const obs = await session.face('trial-native-flag', agentSeed);
      assert.equal(obs.startFound, true, 'the trial start button must render');
      assert.equal(obs.startDisabled, true, 'the trial start button must stay disabled under a host flag');
      assert.ok(!obs.callsAfterStartClick.includes('start_agent_trial'),
        `a host flag must not unlock the trial pipe: ${JSON.stringify(obs.callsAfterStartClick)}`);
    });

    // B4 — credential help describes the actual HTTP capability for a resolved
    // reference: status-aware help, the credential-reference auth label, and no
    // keychain promise anywhere in the rendered editor.
    await t.test('B4 credential help follows the actual pipe', async () => {
      const obs = await session.face('credential-help', credentialSeed);
      assert.equal(obs.authTriggerLabel, 'API Key · 凭据引用', `auth option label: ${JSON.stringify(obs.authTriggerLabel)}`);
      assert.equal(obs.keyHelp, '凭据引用可解析；留空保留原引用。', `resolved-reference help: ${JSON.stringify(obs.keyHelp)}`);
      assert.equal(obs.keyPlaceholder, '引用已配置 · 留空保留', `resolved-reference placeholder: ${JSON.stringify(obs.keyPlaceholder)}`);
      assert.equal(obs.credentialStatusText, '凭据引用可解析', `credential status line: ${JSON.stringify(obs.credentialStatusText)}`);
      assert.equal(obs.promisesKeychainWrite, false, 'no keychain write promise may render');
      assert.equal(obs.mentionsDesktopKeychain, false, 'no desktop-keychain redirection may render');
      assert.equal(obs.mentionsKeychainLabel, false, 'no keychain auth label may render');
    });

    // B5 — About and tab descriptions state the real availability scope, and
    // the tab switch is a real event that mounts the real agents panel.
    await t.test('B5 About and tab copy state the real scope and the tab switch mounts the real panel', async () => {
      const obs = await session.face('settings-tabs', settingsSeed);
      assert.ok(obs.aboutText.includes('事项整理（organizer）智能体配置'), `About availability: ${JSON.stringify(obs.aboutText)}`);
      assert.ok(obs.aboutText.includes('尚未接通'), `About unwired disclosure: ${JSON.stringify(obs.aboutText)}`);
      assert.ok(!obs.aboutText.includes('三个内置智能体配置'), 'About must not claim three configurable agents');
      assert.ok(obs.emitted.some((e) => e[0] === 'selectTab' && e[1] === 'agents'), `tab events: ${JSON.stringify(obs.emitted)}`);
      assert.ok(obs.headerAfterAgentsClick.includes('当前仅事项整理（organizer）已接通'),
        `agents tab description: ${JSON.stringify(obs.headerAfterAgentsClick)}`);
      assert.ok(obs.emitted.some((e) => e[0] === 'selectTab' && e[1] === 'models'), `tab events: ${JSON.stringify(obs.emitted)}`);
      assert.ok(obs.headerAfterModelsClick.includes('供已接通的智能体选择'),
        `models tab description: ${JSON.stringify(obs.headerAfterModelsClick)}`);
      assert.ok(!obs.headerAfterModelsClick.includes('供不同角色选择'), 'models tab must not claim role choice');
      assert.equal(obs.modelsPanelPresent, true, 'the real models panel must mount');
      const tracker = obs.agentsTabsAfter.find((tab) => tab.text.includes('进展跟踪'));
      assert.ok(tracker, 'the mounted agents panel must render role tabs');
      assert.equal(tracker.disabled, true, 'tracker tab must be disabled inside the mounted agents panel');
    });

    // B6 — preserved draft flow: a typed draft survives a failed save plus
    // re-read (重新读取，保留草稿) even though the "server" never had it.
    await t.test('B6 draft retention survives failed save and re-read', async () => {
      const typed = '自定义草稿说明，重读后必须保留。';
      const obs = await session.face('draft-retention', draftSeed);
      assert.equal(obs.formFound, true, 'the supplemental-instructions textarea must render');
      assert.equal(obs.draftAfterType, typed, 'the typed draft must reach the store draft');
      assert.ok(obs.saveErrorText.includes('工作目录暂时不可用'), `failed-save error expected, got: ${JSON.stringify(obs.saveErrorText)}`);
      assert.equal(obs.rereadFound, true, 'the 重新读取，保留草稿 control must appear after a failed save');
      assert.equal(obs.rereadDisabled, false, 'the re-read control must be enabled');
      assert.equal(obs.draftAfterReread, typed, 'the draft must survive the re-read');
      assert.equal(obs.readyAfterReread, true, 'the role must be ready again after the re-read');
      assert.equal(obs.serverSupplementalInstructions, '', 'the server-side value must be empty (retention is client-side)');
    });

    // B7 — preserved capability: the model connectivity test still issues a
    // real test command and reports the outcome.
    await t.test('B7 model connectivity test still works', async () => {
      const obs = await session.face('connectivity-test', connectivitySeed);
      assert.equal(obs.testButtonFound, true, 'the 测试连接 button must render');
      assert.equal(obs.testDisabledBefore, false, 'the 测试连接 button must be enabled for a usable model');
      assert.equal(obs.commands.filter((c) => c === 'test_model').length, 1,
        `exactly one test command must be issued: ${JSON.stringify(obs.commands)}`);
      assert.ok(obs.commands.includes('list_import_batches'), 'the post-test refresh must run');
      assert.ok(obs.resultText.includes('连接测试通过'), `success status expected, got: ${JSON.stringify(obs.resultText)}`);
      assert.equal(obs.organizerError, '', `no organizer error expected: ${JSON.stringify(obs.organizerError)}`);
    });
  } finally {
    // session.close() never throws: every outcome lands in the report, so
    // this assertion cannot mask a failed face — failed subtests keep their
    // own diagnostics, and cleanup failures attach here separately.
    const closed = await session.close();
    assert.equal(closed.ok, true, `every cleanup step must succeed: ${JSON.stringify(closed)}`);
    assert.equal(closed.chromeClosed, true, 'chrome must exit after the faces');
    assert.equal(closed.profileRemoved, true, 'the chrome profile root must be removed');
    assert.equal(closed.steps.vite.ok, true, 'the vite server must close');
    assert.equal(closed.steps.http.ok, true, 'the http listener must close');
    assert.ok(closed.elapsedMs <= CLEANUP_MS, `cleanup must stay inside its reserved slice: ${JSON.stringify(closed)}`);
  }
});

// ---------------------------------------------------------------------------
// Counter-controls for the cleanup/budget machinery itself (per coordinator
// dispatch 01a1c1b2: one startup-failure and one close-failure control; the
// original six-mutant behavior matrix is NOT rerun). Each control must show:
// the failure actually surfaces red, the REMAINING cleanup still runs, zero
// residue, and everything inside the 20s case budget.
// ---------------------------------------------------------------------------
test('counter-control: a chrome startup failure is reclaimed in place and the remaining cleanup still completes', async (t) => {
  if (!chromeAvailable()) return t.skip('Chrome unavailable; cleanup counter-controls not verified');
  const startedAt = Date.now();
  // /bin/echo exists and is not Chrome: spawn succeeds, the process exits
  // immediately, and the DevTools wait must fail FAST (child-exit fail-fast,
  // not a full-budget poll). The reclaim contract then runs inside
  // startChrome and the session's startup catch path cleans the rest.
  await assert.rejects(
    startCapabilityUiSession({ workMs: WORK_MS, cleanupMs: CLEANUP_MS, chromePath: '/bin/echo' }),
    (error) => {
      assert.ok(error.message.includes('exited'), `the actual startup failure must surface: ${JSON.stringify(error.message)}`);
      assert.equal(error.chromeReclaim?.exitConfirmed, true, 'the spawned child must be reclaimed and its exit confirmed');
      const report = error.cleanupReport;
      assert.ok(report, 'the startup failure must carry its cleanup report');
      assert.equal(report.ok, true, `the remaining cleanup must still complete: ${JSON.stringify(report)}`);
      assert.equal(report.steps.vite.ok, true, 'vite must still close after the startup failure');
      assert.equal(report.steps.http.ok, true, 'the http listener must still close after the startup failure');
      assert.equal(report.steps.profile.ok, true, 'the profile root must still be removed after the startup failure');
      assert.equal(report.profileRemoved, true, 'zero profile residue after a failed start');
      return true;
    },
    'a non-Chrome binary must fail the session start (actual red), never pass silently',
  );
  assert.ok(Date.now() - startedAt < CASE_BUDGET_MS, `the startup-failure control must finish inside the ${CASE_BUDGET_MS}ms case budget (took ${Date.now() - startedAt}ms)`);
});

test('counter-control: a forced close fault propagates, the remaining cleanup still runs, zero residue', async (t) => {
  if (!chromeAvailable()) return t.skip('Chrome unavailable; cleanup counter-controls not verified');
  const session = await startCapabilityUiSession({ workMs: WORK_MS, cleanupMs: CLEANUP_MS });
  const startedAt = Date.now();
  // TEST-ONLY seam: the real chrome reclaim still runs first; the fault only
  // overrides the recorded verdict. The control proves the failure is
  // propagated (no silent success), the later steps are not skipped, and the
  // real attempts still verify zero residue.
  const report = await session.close({ chrome: () => new Error('injected chrome close fault (counter-control only)') });
  assert.equal(report.ok, false, 'a forced close fault must fail the close verdict — no silent success');
  assert.match(String(report.steps.chrome.error), /injected chrome close fault/);
  assert.equal(report.steps.chrome.detail?.exitConfirmed, true, 'the real reclaim still ran and confirmed the child exit (the fault only overrides the verdict)');
  assert.equal(report.steps.vite.ok, true, 'vite close must still run after the chrome step failed');
  assert.equal(report.steps.http.ok, true, 'http close must still run after the chrome step failed');
  assert.equal(report.steps.profile.ok, true, 'profile removal must still run and be verified after the chrome step failed');
  assert.equal(report.profileRemoved, true, 'zero profile residue despite the forced chrome fault');
  assert.ok(report.elapsedMs <= CLEANUP_MS, `cleanup must stay inside its reserved slice: ${JSON.stringify(report)}`);
  assert.ok(Date.now() - startedAt < CASE_BUDGET_MS, `the close-failure control must finish inside the ${CASE_BUDGET_MS}ms case budget (took ${Date.now() - startedAt}ms)`);
});
