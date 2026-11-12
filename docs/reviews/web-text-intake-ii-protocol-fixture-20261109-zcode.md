# II 协议夹具 canonical 结果帧修复 + 协议家族聚焦重放 — ZCode 独立小提交记录（2026-11-09）

派工：01a1beec（Codex）。本记录佐证同分支提交 `5b06f0d`（恰 1 文件：`tests/fixtures/web-text-intake/protocol-worker-process.mjs`，+212 新增 —— 本分支此前不携带 II 夹具集，属既定 overlay 语义）。实现者与记录者同为 ZCode；该文件此前由 II r5 `61a069b` 冻结，本轮为该夹具在任务线上的首次修改，派工明确授权。

## 1. 修改面（可证伪形式）

基线 blob `c9f28a8a`（r5 冻结字节，文件 sha256 `3ddf71bd…a2823`）→ 修复后文件 sha256 `1af86498…bfac5`。`git diff --no-index --numstat`：恰 `+17/-5`，单一面 = `payloadFor` 的 extract 分支 + 其注释：

- extract 候选改为真实 organizer `parseModelResult`/`extraction()`（`runtime/lib/organizer-contract.mjs`）的 canonical 形：草案在 `fields` 键下（title/kind/owner/priority/tags/due/followup，未表达时 due/followup 为 null），外加 `evidence`、`dueExpression`、`followupExpression`、`warnings: []`、`unresolved: false`。这正是生产 `stageExtractResult` 逐候选读取的键集（`server/lib/text-intake-service.mjs` 候选循环 `normalizeDraftFields(candidate.fields)`；帧到服务的路径 `server/lib/task-scheduler.mjs` `onWorkerFrame` → `frame.data?.candidates`）。
- 原扁平候选（无 `fields`）使 `normalizeDraftFields(undefined)` 在暂存事务前抛校验异常 → `resultPendingExit` 恒 0 → 全家族走 worker_lost／§4.6 安全路由（C3 根因，aad4b82 登记；01a1beec 撤回旧解释并按夹具载荷缺陷定案）。
- 逐字节未动面（diff 前后段比对）：身份围栏（`staleIdentity` 注册表查找 + cancel 帧 runId/hostNonce 身份检查）、挂起／逃逸场景（stage-then-hang keepAlive、lingering-tree、early-failure）、300s 后代寿命（`setTimeout 300000`，spawn 后立即登记）、worker-start 预登记、SIGTERM 收尾。`test`/`revise` kind 不变（`{changes:{title}}` 的非 canonical 仍为已登记 future 项，协议家族不用 revise）。

## 2. 重放链身份

运行树 = `4fc9537`（tree `52b71a2f`，锁定生产候选线）detached checkout；`npm ci --ignore-scripts`；`probe:prepare-pi`（provenance `ad702637`/`e89822b0`，与既有登记一致）→ `probe:bundle` → `build:backend`（storage binary 2649408B sha256 `42af54b5…490fc2`，与登记逐字节一致）。叠加 `7f3322b` 的 queue 套件与 `model-config.mjs`（sha256 与 7f3322b blob 内容逐一相等）。运行树生产目录零改动。两轮重放生产字节完全相同，仅夹具文件翻转（before = blob 字节 / after = 修复字节）——归因形式可证伪。命令：`node --test --test-name-pattern='protocol|GAP' --test-timeout=20000 tests/integration/web-text-intake-queue.test.mjs`（7 例：control、GAP-3、GAP-3 default、GAP-4、GAP-5、exhaustion、cleanup）。原始 TAP（gitignored `build/mayne24-c3-fixture/`）：before-run.tap sha256 前 16 `3cdb9c53caea762c`，after-run.tap `e26bcc6b7fc9df28`。

## 3. 重放结果

**BEFORE（基线夹具）0/7 红，且红面与登记一致**：control 落 `needs_review`/`failure_unknown_side_effect`（暂存级联登记面）；GAP-5 `attemptExitState=exited_confirmed` vs 期望 `exited_unknown`（登记面原文）。

**AFTER（修复夹具）**：

- **control 通过（端到端）**：暂存 → `exited_confirmed` → 发布，线上 `candidate.fields.title === '协议夹具候选'`、恰 1 行、零模型调用。
- **暂存接受另有两例直接观察**：GAP-3 与 GAP-3 default 都先轮询到「3 行 staged 候选」（sqlite 直读）通过后，才在更后面的断言失败——「帧可被真实 stage 接受」由此三例独立证实。
- **GAP-5 与 cleanup 保持红（派工要求：真实红不掩盖）**，红面更锐：canonical 帧暂存成功 → 生产 `verifyTree` 对 setid 逃逸后代假 TRUE → `exited_confirmed` + **发布成功（succeeded）**，后代仍存活（last observed `state=succeeded attemptExitState=exited_confirmed`）。这正是已登记的生产侧 verifyTree 覆盖边界缺陷（R7-M-2/M-3 生产退出保证缺口）的直接演示；GAP-5 的 unknown 判据未动。
- **新暴露三面（此前被暂存级联遮蔽、本记录只登记落点，裁定归协调者）**：
  1. **staged 候选可见**（GAP-3 `:1032`、GAP-3 default `:1087`）：`GET /api/text-sources/:id/candidates` 在任务仍 running/resultPendingExit 时返回 staged 行——`listCandidates`（`server/lib/text-intake-service.mjs:351-367`）无默认排除 staged，仅显式 status 过滤；套件引冻结 §4.2/§10「退出确认前不可见」。生产缺口 vs 套件从严，待裁定。
  2. **晚到帧审计事件缺失**（GAP-4 `:1141`）：功能性围栏全部通过（恰 1 候选、首任务不受扰、任务 succeeded），但 task_events 仅 `task.changed`×4——冻结 web-api §3.3（`docs/engineering/web-api-contract.md:103`）要求的 `rejected_late_result` 审计事件在生产 server/ 源码零出现（grep 空），worker-host 对身份不匹配帧静默 `continue`。
  3. **spawn 同步抛出落 needs_review 无 recovery**（exhaustion `classifySpawnFailureResolution`）：第四 attempt 同步抛出 → worker-host 同步抛出路径（`server/lib/worker-host.mjs:290-305`）`treeVerified:false` → `confirmExtractExit(exited:false)` → `needs_review`/`exited_unknown` 但读回 `recovery=null`；套件分类器要求 parked spawn 失败落点带已登记 recovery cause。对照：spawn-failure 表格例（预修复已过）走的是另一机制。

**准出含义（不签收）**：协议家族七例中 1 绿 6 红；C3 的「夹具缺陷」根因修复使控制链（暂存→确认→发布）首次真实通过，但 GAP-3×2／GAP-4／exhaustion 的红现在是各自下一层的生产面，GAP-5／cleanup 的红是已登记生产缺陷的强化演示。四套件准出状态不变。

## 4. T-6 结论收窄（登记补充，按 01a1beec）

对 aad4b82 C2 段的收窄：

- **维持**：SIGKILL 本身不决定 unknown——生产不做 root-exit/tree-exit 混同：`verifyTree`（worker-host）独立做组灭 ESRCH + 直接子代 + `ps --run` 扫描三查，`confirmExit` 以 `treeVerified` 为门；该轮观察中三查均通过（组灭、子代空、无扫描命中）。
- **收窄（撤回「契约相符」作为准出结论）**：该例是工具可达的 extract（runtime 对 extract 开放 useTools），三查是对该次特定运行的静态观察，只证明该次树灭绝，不证明 verifyTree 覆盖边界的完整性——GAP-5 的 setid 逃逸后代即为可假 TRUE 的具体反例类。在与 trusted test 同级的路径证明（如 tte2e r2 的 path-integrity 限定域）存在之前，不接收「confirmed 契约相符」为准出结论。
- **不变**：T-6 的 unknown 判据不改（套件 blanket 断言维持，park 在 r1+01a1bd87 §7 裁定）；C2 的 GAP-5 生产侧 verifyTree 覆盖边界缺陷登记不变，且被本轮 after-run 的「发布时树成员仍存活」直接观察进一步强化。

## 5. 范围与卫生

本轮字节改动：本分支恰 2 个提交（`5b06f0d` 夹具 1 文件 + 本 docs 记录 1 文件）。生产 `server/`、`runtime/`、`shared/`、四套件、配置零改动。无真实模型／凭据／用户根（合成密钥、回环受控服务、临时根）。未跑完整门禁（按派工；`check:docs` 于 docs 提交后运行）。MAYNE-24 保持 `in_progress`。
