# MAYNE-24 slice II 候选独审（OhMyPi）：W1 文本整理验收套件 `b463f18b`

> 评审对象：Kimi 的 II 候选 `b463f18b91d3145d34596299f004ae705a39043e`（tree `442d1a46723c4297ae70baf7ae96184816a7b561`，14 文件 +4833/−0，全部为新增）。输入为最终 P1 契约 `b190f7c6`（contract `5982c062…`，本审 `git show` 复算一致）与 P2 验收矩阵 `43433ae5`（readiness `2d647417…`，复算一致）。本审未参与 I/II/III 任一切片写作。
> 范围：机械／来源／反例审阅；不跑完整门禁，不重跑未集成的全部业务套件（按派工 01a1bba1）。

## 0. 结论

**不通过（限本轮候选；返工后限定复核）。**

候选在「套件设计诚实度」上整体合格：54 例中 41 例在基树显式失败、无 `t.skip` 绕过业务、无固定 sleep 冒充就绪、夹具写入范围严格限于 II、秘密边界有系统性断言、GAP-1/GAP-2/GAP-3–5 如实登记未假报。但存在 **2 项阻断级缺陷**，都属「套件假设改写契约／与冻结来源不一致」，按派工要求「不能让套件假设改写契约」必须返工：

| # | 级别 | 缺陷 | 位置 |
|---|---|---|---|
| B-1 | 阻断 | `db-observer.mjs` 对 `text_sources` 断言了冻结 003 DDL 中**不存在**的 `status` 列，导致 `sourceRow()` 在真实 schema 上必然抛错；两个调用点又被 `try/catch` 吞成「证据缺失即通过」 | `tests/fixtures/web-text-intake/db-observer.mjs:102`；`web-text-intake-queue.test.mjs:513-518`；`web-text-intake-static.test.mjs:448-456` |
| B-2 | 阻断 | T-12「模型只交表达式、时点由 `shared/dates.mjs` 依锚点解析」的核心断言读 `expected.point?.at`，而 `shared/dates.mjs` 的返回字段是 `atMs`——断言恒等于 `null`，是死分支，**对实现无任何约束** | `tests/integration/web-text-intake-http.test.mjs:826-829` |
| B-3 | 阻断 | T-12 的 `time_review_required` 证伪整段包在 `if (candidate.unresolved)` 里，而套件唯一脚本化答案（`下周五`）经真实解析器验证为 `unresolved=false`——**该分支永不执行**，P2 T-12 的核心反例完全未验 | `tests/integration/web-text-intake-http.test.mjs:809-820` |

另有 11 项 major（M-2 夹具配置形状与生产解析面不兼容、M-3 `--test-timeout=20000` 与套件自身耗时冲突、M-4 T-13 宣称覆盖「后端日志」但无任何采集点、M-5 T-14 fixture 模式下配对/旅程用例静默 return 而非显式失败、M-6 批量签收「重放」既未复用 operationId 也未复用 expectedVersion、M-7 staged 候选不可见性从未观测暂存态、M-8 T-12 来源锚点缺省规则未验证、M-9 T-6 占槽断言用固定 sleep 代替调度器决策观测、M-10 worker argv 断言漏掉真正持密的 bash-worker 子进程、M-11 「真实 Pi」证明强度不足；**M-1 已于 2026-11-08 经队长裁定更正为「原归因不成立」，从缺陷清单移出，更正过程见 §3 M-1**）与若干 minor。详见 §3。

> **2026-11-08 队长裁定回填（`01a1bbd2`）**：M-1 原归因不成立（cancel/cancel 与 claim/cancel 被混为一类，终态二次取消按 §4.4 返回 409 `state_conflict` 正确）；M-2 中「凭据引用不得含 `:`」那一半不成立（P1 §4.4 明文认可 `env:MODEL_KEY` 形状），缺陷内核（夹具与生产解析面不兼容）保留但依据改为冻结契约；M-3 仍按 20000ms 用例预算修订，**不批准 III 延长预算**；M-4 必须补后端 stdout/stderr 秘密观测而非缩小宣称；M-5 缺真实 dist 时须 `PrerequisiteGap` 显式失败；M-11 须以真实构建身份 + 工具子进程存在 + 脚本输出回传联合证明。不通过结论与其余 B/M 项历史、证据全部保留。

## 1. 准入与来源核对（本审独立复算）

| 项 | 结果 |
|---|---|
| 候选提交/tree | `b463f18b91d3145d34596299f004ae705a39043e` / `442d1a46723c4297ae70baf7ae96184816a7b561`，本地对象库在位，`agent/kimi/mayne-24` 头即该提交 |
| 父提交 | `7074163e084644ebb4b96d18aa595700456cb0ee`（tree `77a5485`，即登记 main `1e37044` 的 tree）——基点关系与作者登记一致 |
| 写入范围 | `git diff --name-status 7074163e..b463f18b`：14 项全部 `A`（新增）。**未触碰** `tests/fixtures/web-manual-items/**`、`package.json`、守卫、I/III 任何文件——与 II 冻结写入范围一致 |
| P1 契约复算 | `git show b190f7c6:docs/engineering/web-text-intake-contract.md` → SHA-256 `5982c06220b382182ee8ff82715ca0e794b4cd51988426d7d9b37da406cfe7b0`（＝登记冻结值） |
| 授权清单复算 | `caa746bbff01ce158e04bc3330489607c8683567b5682e8ca7351b6fa6ac6b20`（＝登记值） |
| P2 报告复算 | `2d6474171802f16686d6cc4ad4613f028a48e0a253a4e7797cdb7c81125d17bc`（＝登记值） |
| 作者附件 | 10 个附件经 CLI 下载读回，ID/大小与工单登记一致；`web-text-intake-tests-20261108.md` SHA-256 `8bb38a220b49eabe3d7b0575c9886a325a19bdc0d758e802a2ddf1c120684768`，与候选树 blob `7d013db296c5e31274b4979520906fcc02909b27` 内容一致 |
| admission.json | 作者登记在首次修改前，含 pwd/branch/HEAD/基点祖先/接收哈希/写入清单/预定独审者；与工单描述一致 |
| 机械检查复跑 | `node --check` 对 14 个文件全部通过（与作者 mechanical-checks.txt 一致） |

## 2. 独立实证（本审实跑，非采信自述）

### 2.1 合成答案经真实运行时契约解析器验证（复跑通过）

用本树真实 `runtime/lib/organizer-contract.mjs` 独立验证夹具答案，**与作者 mechanical-checks.txt 逐条吻合**：

| 用例 | 结果 |
|---|---|
| `primaryExtractAnswer`（2 候选，`下周五`/`11月20日`） | 可解析，2 候选，`unresolved` 均 false |
| `queueExtractAnswer`（`下周五` + `合成整理输入标记`） | 可解析，`unresolved=false` |
| `nonJson` | 拒绝 reason `json` |
| `evidenceNotSubstring` | 拒绝 reason `evidence` |
| `dateEvidenceNotSubstring`（`三千年后的冬至`） | 拒绝 reason `date-evidence` |
| `actionWithFollowup` | 拒绝 reason `followup` |
| `oversizeTags`（13 个） | 拒绝 reason `tags` |
| `unknownKey`（`forged:true`） | 拒绝 reason `object-keys` |
| `tooManyCandidates`（51 个） | 拒绝 reason `contract` |

结论：夹具的「有效答案全部可解析、无效答案按真实 reason 拒绝」不是自证，而是与生产解析器一致。这是候选最实的一块。

### 2.2 GAP-1（打包 CLI 默认路径差一层）独立复现

`server/entries/web-backend-entry.mjs`（基树）的 `defaultStaticRoot()/defaultStorageBin()` 用 `../../../`，入口位于 `build/web-backend/server/entries/`：

```
resolve(dirname(entry), '../../../static')              → build/static
resolve(dirname(entry), '../../../bin/web-backend-storage') → build/bin/web-backend-storage
```

而 III `build-backend.mjs` 的实际 bundle 布局是 `build/web-backend/{static,bin/web-backend-storage,runtime}`。**差一层，GAP-1 属实**。候选 static TAP 的实测证据（`spawn .../build/bin/web-backend-storage ENOENT`，CLI exitCode=1）与本审复算一致。该跨项缺口已由队长在 01a1bba1 裁定归 I，本轮不改变结论。

### 2.3 「真实产品 UI」与「fixture 模式」边界（复核通过）

- `rejectPrototypeRoot()` 在 `resolveArtifacts()` 与 `resolveSuiteStaticRoot()` 的**每条分支**都生效，`design/` 显式根直接抛错——不存在把原型当产品签收的路径。
- fixture 模式（`buildSyntheticStaticRoot`）只覆盖静态供给机械，且 `static-root.json` 记录 `mode:'synthetic'`；配对/旅程用例在 synthetic 模式 `return`（见 M-5：应是显式失败而非静默 return）。
- 浏览器探针用 CDP 驱动产品自身 DOM（原生 value setter + `input` 事件 + `form.requestSubmit()`），配对码只经请求体；冷启断言要求 `#app` 在**活 DOM** 中 `childElementCount>0` 且 `textLength>0`（不是磁盘 index.html），并断言所有网络引用同源、`/api/session` 与 `/api/events` 返回 `web-api/1` 401 信封、640/1440 无横向溢出。**这部分是真实产品 UI 证据**，与派工要求一致。

### 2.4 秘密边界（复核通过，一处宣称过度见 M-4）

- 受控服务请求记录只写 `hasAuthorization` 与 `authorizationLength`，永不写值（`controlled-model-service.mjs:186-196`）。已逐行复核记录字段集。
- `backend-child.mjs` 的 controlled provider 规格只经 `child.send()` IPC 传入内存，不落文件/argv/env；`backend-process.mjs` 的 `child-config.json` 只含 entry/root/staticRoot/storageBin/initialize/runtimeRoot，**不含任何凭据**。
- worker argv 秘密断言（`findOrganizerWorkers` → `!worker.command.includes(SYNTHETIC_KEY)`）在 controlled-model 与 queue 两处都有，且同时断言进程确为 `organizer.mjs`——不是空断言。
- 证据文件均 `mode:0o600`；`effectiveConfig()` 只记非秘密配置（wire 字面/工件路径/Node 版本/凭据引用名），不含 code/cookie/token。

## 3. 缺陷清单

### B-1（阻断）db-observer 断言了 003 DDL 中不存在的 `text_sources.status` 列

`tests/fixtures/web-text-intake/db-observer.mjs:102`：

```js
requireColumns(root, 'text_sources', ['source_id', 'fingerprint', 'raw_text', 'status', 'succeeded_run_id']);
```

冻结 003（`git show 1593b43d:src-tauri/migrations/web-backend/003_text_intake.sql:98-109`，即 I 候选的 003，哈希经 III 冻结）的 `text_sources` 列为 `source_id, fingerprint, kind, raw_text, source_at_ms, imported_at_ms, anchor_at_ms, time_zone, succeeded_run_id`——**没有 `status`**。

本审实测复现：以该 DDL 建表后调用 `sourceRow(root, 'src_x')` →

```
read-only observation: table text_sources has no column status (columns: source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id)
```

后果（两级放大）：

1. 三个未包裹的调用点在集成后**必然抛错**：`web-text-intake-controlled-model.test.mjs:315,349`（`the source must be retained`）、`web-text-intake-http.test.mjs:392`（`the source must be retained for retry`）——即 T-3「凭据缺失保留原文」与 T-4/故障矩阵的「来源保留」断言会因夹具自身缺陷失败，而非业务缺陷。
2. 两个被 `try/catch` 包裹的调用点把该错误吞成「观测为空」：`web-text-intake-queue.test.mjs:513-518` 的 `sourceRowSafe` 返回 `null` → `assert.ok(sourceRowSafe(...), 'the source must reappear after the restart')` **失败**（这一处反而是显式失败，可接受）；而 `web-text-intake-static.test.mjs:448-456` 的 `sourceRowsSafe` 返回 `[]`，使 `pollUntil(() => rows.length > 0 ? rows.at(-1) : null)` **永远拿不到 source**，旅程用例在「the UI submission must create a source row」上超时——错误被转成 20s 超时，掩盖真实原因。

修法：删除 `status`（或改用真实列名）。另建议 `sourceRowsSafe`/`sourceRowSafe` 不要静默吞夹具自身错误——db-observer 的设计意图（「表/列缺失显式报错」）被这两个 safe 包装抵消了。

### B-2（阻断）T-12 的日期解析断言是死分支，对实现零约束

`tests/integration/web-text-intake-http.test.mjs:826-829`：

```js
const expected = resolveExpression(row.due_expression, Date.parse(source.sourceAt.at), source.sourceAt.timeZone ?? 'Asia/Shanghai');
if (row.due_at_ms !== null && row.due_at_ms !== undefined) {
  assert.equal(row.due_at_ms, expected.point?.at ?? null, '...');
}
```

`shared/dates.mjs` 的 `resolveExpression` 返回 `{point:{atMs,timeZone,localText,precision},warnings,unresolved}`——字段名是 **`atMs`，没有 `at`**。本审实测：`resolveExpression('下周五', …).point?.at === undefined`。

后果：`expected.point?.at ?? null` 恒为 `null`。当实现正确落库 `due_at_ms=1795104000000` 时，`1795104000000 !== null` → **断言失败**；反之若实现把 `due_at_ms` 落成 `NULL`，断言反而通过。即该断言的方向被完全颠倒，且 `candidates` 表根本没有 `due_at_ms` 列（003 DDL：`candidates` 只有 `due_expression`，时刻落在 `fields_json` 内）——`row.due_at_ms` 恒 `undefined`，外层 `if` 永不进入。

这条恰好是 P2 T-12 的**唯一可证伪点**（「时点由 `shared/dates.mjs` 依锚点解析，模型只给表达式」）。当前写法使它变成永不执行的死代码，T-12 实际只剩「`timeReviewed` 缺失 400」与「表达式逐字保留」两条，与「日期不让模型猜」的核心反例（模型直接给绝对时刻被接受）无关。

修法：从 `fields_json` 解析出 `fields.due`，与 `resolveExpression(...).point?.atMs` 比较；或按 I 的实际读回形状改写。同时应补一条**反向**断言：模型输出里出现绝对时刻形状时不得被接受为已解析时点。

### B-3（阻断）T-12 的 `time_review_required` 分支永不执行

`tests/integration/web-text-intake-http.test.mjs:809-820`：

```js
const candidate = candidates.json.candidates[0];
if (candidate.unresolved) {
  const rejected = await backend.request('POST', '/api/sign-offs', { … timeReviewed: false });
  assert.equal(rejected.status, 400, …);
  assert.equal(rejected.json.error.code, 'time_review_required');
  …
}
```

本审独立验证：套件对该来源唯一使用的脚本化答案是 `queueExtractAnswer()`，其 `dueExpression` 为 `下周五`；用真实 `runtime/lib/organizer-contract.mjs` + `shared/dates.mjs` 复算，`resolveExpression('下周五', anchor, 'Asia/Shanghai')` 走 week 分支确定性解析，`unresolved === false`、`warnings === []`。因此 `if (candidate.unresolved)` 恒假——P2 T-12 的**核心可证伪反例**（「未定期须 `timeReviewed`，核对后放行」）一次都没跑过。基树 TAP 中该用例的失败点在更前面的路由缺失，所以这个空洞在基树不可见，集成后会以「静默跳过」的形式留下。

同类条件保护还有两处，使 T-12 进一步空心化：`:823` 的 `if (row.due_expression)` 与 `:826` 的 `if (row.due_at_ms !== null …)`（后者还叠了 B-2 的字段名错误，且 `candidates` 表本无 `due_at_ms` 列，恒 `undefined`）。

修法：脚本化一个**真正歧义**的表达式（如 `下周五或周六`，`shared/dates.mjs` 的 `dates.length>1` 分支必返 `unresolved`），把 `timeReviewed:false`→400 与 `timeReviewed:true`→200 两条都变成无条件断言；同时删掉 `if (row.due_at_ms …)` 的死保护。

### M-6（major）批量签收的「重放」根本没有重放：既未复用 `operationId`，也未复用 `expectedVersion`

`tests/integration/web-text-intake-http.test.mjs:714-724` 自称「Replay returns the current authoritative items, not the old snapshot」，但：

- `signOffBody()` 未传 `operationId` → 每次调用生成**新的随机** `op_…`（`synthetic-inputs.mjs:109-111`），而 P1 §5.1 的批次重放定义是「同 `operationId` 且同规范输入 → 查 `sign_off_batches` 台账命中 → `replayed:true` 并重读当前权威对象」。用新 operationId 根本不可能命中台账；
- 两个 choice 仍带**已Accepted 后的旧 `expectedVersion`**（`one.version`/`two.version` 是 sign-off 前的值）→ 走的是版本守卫路径。

即该块实际断言的是「旧版本 + 新批次键」被拒后返回 `replayed:true`，与契约的批次幂等语义不是同一件事。对照同文件 `T-8`（`:432-449`）的 source 重放就正确复用了 `op`——sign-off 这条是漏写。

连带后果：`replay.json.items` 与首次 `ok.json.items` 的 itemId 映射从未断言（P1 §5.1「按台账的候选→事项 ID 映射重读当前权威对象」未验）；「重放不重复入库」只被 `tableCounts` 间接覆盖，而 `manualItems` 计数在一条 409 路径上本就不会变，属弱断言。

修法：显式 `const batchOp = operationId()`，首购与重放都用它；重放前先把某一事项改掉（如 complete），断言返回的是**改后**的当前权威态而非旧快照，并断言 itemId 映射一致。

### M-7（major）「staged 候选退出确认前不可见」从未观测暂存态

`tests/integration/web-text-intake-http.test.mjs:535-536`：

```js
const duringRun = await backend.request('GET', `/api/text-sources/${sourceId}/candidates`, { cookie: backend.cookie });
assert.equal(duringRun.status, 200, duringRun.text);
const task = await waitForTask(backend, taskId, isTerminal);
```

`duringRun` 在提交后立即取一次，**响应体被丢弃**（只断言了 200），且此刻调度器通常尚未启动任务。P1 §6.1 step 4 的违规形态（暂存事务里就把 `candidates` 写成 `pending`）能原样通过。真正的证伪点是「任务非终态期间候选列表持续为空」＋「DB 里存在 `status='staged'` 行」＋「终态后才发布为 `pending`」，当前只验了第三者。

修法：用 `pollUntil` 在任务 running 期间周期性读候选列表并断言始终为空；终态后断言 DB 曾出现 staged（或在 running 期间直接读 DB 断言 `status='staged'` 存在且 API 不可见）。

### M-8（major）T-12 的来源锚点缺省规则未验证

`web-text-intake-http.test.mjs:804-808` 只断言 `source.sourceAt?.at` 存在且是 ISO ms。`submitSourceBody()` 从不发送 `sourceAt`，因此「锚点缺省按首次录入时间」（P1 §5.1）这条规则没有任何约束——服务端返回启动时间、epoch 0 或固定常量都能过；服务端**忽略**显式传入的 `sourceAt` 也能过。

修法：补一条显式传 `sourceAt` 的提交，断言读回值与传入一致；再补一条不传的提交，断言锚点落在合理的录入时间窗内（与 `imported_at_ms` 一致）。

### M-9（major）T-6 占槽断言用 1500ms 固定 sleep 代替调度器决策观测

`web-text-intake-queue.test.mjs:350-354`：

```js
const fresh = await submitExtract(backend, 33);
await new Promise((done) => setTimeout(done, 1500));
const freshTask = (await readTasks(backend)).find(…);
assert.equal(freshTask.state, 'queued', …);
```

负载高时调度器 1500ms 内可能尚未 tick，任务仍是 `queued` 只因未被评估——断言假通过；反之若调度器错误补发 `exited_unknown` 槽位，也可能需要 >1500ms 才暴露。这与派工「不用固定 sleep 掩盖就绪」直接冲突（同文件 `:208`、`:256`、`:545` 的 sleep 属轮询间隔/UI 沉降，可接受；这一处是唯一代替调度器决策的）。

修法：改为 `pollUntil` 断言该任务在有界预算内**到达 running**，然后断言它没有（负向断言配正反两向观测），或读 DB 断言三个 `exited_unknown` attempt 仍占槽、无新 attempt 行。

### M-10（major）「worker argv 不含秘密」只覆盖 organizer 进程，真正持密的 `bash-worker.mjs` 子进程被过滤器排除

`tests/fixtures/web-text-intake/backend-process.mjs:186-190`：

```js
export function findOrganizerWorkers(rootPid) {
  …
  return table.filter((entry) => wanted.has(entry.pid) && /organizer\.mjs/.test(entry.command));
}
```

过滤器只匹配 `organizer.mjs`。而 `runtime/lib/managed-bash.mjs:21` 的真实 spawn 是：

```js
const child = spawn(process.execPath, [workerPath, '--run', runId, '--nonce', nonce], {detached:true, cwd, …});
```

且 `runtime/entries/organizer-entry.mjs:109` 把 `secrets:[request.apiKey]` 交给 managedBash 用于输出脱敏——**apiKey 流经 bash-worker 的托管面**。两处 argv 断言（`controlled-model.test.mjs:252`、`queue.test.mjs:317`）都只看 organizer 进程；工具路径用例（`controlled-model.test.mjs:184-214`）确实会拉起 bash-worker，却从未检查它的 argv。

后果：P2 T-13「子进程 argv 无密钥」与派工「apiKey 只进 stdin」的**最高风险进程未验**。注意 `managed-bash.mjs` 的 `[REDACTED]` 只作用于**输出**，与 argv 是两条独立通道，不能互相代替。

修法：把观测函数泛化为「backend 进程树下所有 Node 子进程」，在工具路径用例中对 organizer 与 bash-worker 的 argv 都断言不含秘密，并显式断言观测到的进程集合里**存在** `bash-worker.mjs`（否则又是空断言）。

### M-11（major）「真实 Pi」的证明强度不足：桩 `organizer.mjs` 可通过 5/6 夹具机械用例

夹具机械用例断言的是：退出码、事件类型、候选条数、`evidence` 是原文子串、action 不带 followup、受控服务看到 N 条请求、`hasAuthorization` 为真。这些都能被一个「读 stdin→回写 2 个硬编码候选→向受控服务发 N 个请求」的桩满足——套件没有任何**仅真实运行时才存在**的观测点：

- 未断言 `{type:'worker', action:'start', pid, nonce}` 帧（`runtime/entries/organizer-entry.mjs:109` 的 `onWorker` 会真实发出，桩不会）；
- 未观测 `bash-worker.mjs` 进程存在（同 M-10）；
- 未断言 `runLimitMs` 真的被运行时所接受（`organizer-entry.mjs:89` 的 `Math.min(120000, Math.max(1, …))`）。

这不是说套件造假——基树 TAP 里 5 例确实在真实 `build/s0-runtime` 上通过，本审也独立复算了答案与真实解析器一致。但**证明强度**上，「真实 Pi」目前只由进程名 `/organizer\.mjs/` 与候选可解析性支撑，不足以排除「集成版上 runtime 被换成桩」这一类回归。

修法：工具路径用例补 `assert.ok(result.events.some(e => e.type === 'worker' && e.action === 'start' && typeof e.pid === 'number'), …)`，并把 bash 脚本的真实输出（`controlled-tool-proof`）经工具结果回传到最终请求后由受控服务记录或由断言间接观测。

### M-1（major→**原归因不成立，2026-11-08 队长裁定后更正**）跨客户端取消竞争的期望

> **更正记录（队长 `01a1bbd2` 裁定，本审已回查冻结正文确认）**：原判「套件期望 `[200,409]` 与冻结契约冲突、输家应为 202 `cancelling`」**归因不成立**。

回查 `web-api-contract.md`：该用例占满三槽、两客户端均取消**同一 queued 任务**，属 **cancel/cancel 竞争**。第一次取消把任务转为终态 `cancelled`；第二次面对的是**已终态**任务，按 §4.4 端点表的 `409 state_conflict（终态）` 拒绝。§3.3 的「输→202 `cancelling`」适用于 **claim/cancel**（取消与领取在同一行上竞争、双方都在 `queued` 上做条件更新）那一类时序，不适用于第二个请求面对终态行的情形。原审把两种竞争混为一类，是误判。

保留为**有效建议**的部分（非缺陷）：套件应补一条 **claim/cancel** 明确时序——不带 `expectedVersion` → 赢家 200 `cancelled` / 输家 202 `cancelling`；携带旧 `expectedVersion` → 409 `version_conflict`——并在注释里引用契约行号，避免后续评审重犯同一归因错误。

原审误判的根源：只读了 §3.3 的 best-effort 句式，未连同 §4.4 端点表的「终态→409 `state_conflict`」与「当前态」一起判定。此项从缺陷清单移出，历史误判与更正过程按派工要求保留。

### M-2（major→**范围更正，2026-11-08 队长裁定后修订**）夹具 `config/` 形状与凭据引用形状

> **更正记录（队长 `01a1bbd2` 裁定，本审已回查 P1 冻结正文确认）**：原判把两件事捆成一条，其中**凭据引用形状那一半归因不成立**。

**已确认不成立的部分**：原审要求「引用名去掉 `:`」，依据是 I 候选 `config-store.mjs` 的 `identifier()` 字母表拒 `:`。但 **I 的解析器不是契约来源**——P1 §4.4（冻结）明文写道：

> **凭据**：`input_ref` 只保存凭据**引用**（`apiKeyRef`，如 `env:MODEL_KEY` 或 Keychain 条目名）

即 `env:MODEL_KEY` 是**契约认可的合法形状**。队长的裁定是「不批准删冒号或转成真实环境读取；引用原样交内存 controlled provider」。原审以候选实现的校验规则反推契约，属把实现当契约，误判。

**仍然成立的部分（缺陷本身保留，但依据改为契约）**：夹具的 `config/` 与 I 生产解析器不兼容，会在集成后以 400/形状不符失败，而非「I 未集成」失败。逐项对照 P1 §5.3（冻结）端点表：

| 断言 | P1 §5.3 冻结形状 | 夹具/套件当前 | 判定 |
|---|---|---|---|
| `GET /api/models` | 200 `{providers, models, defaultModelId, revision}`（**平铺**） | `readModels()` 直接 `response.json` 后读 `.revision`／`.providers` | 与 P1 平铺形状**一致**；但与 I 当前的 `{contractVersion, configuration:{…}}` 包络不符 → **按 P1 断言平铺，I 须修**（队长已把该项交 I 修复） |
| `PUT /api/models` | 200 `{configuration, warning}`（**包络**） | 未分别断言包络 | 需按 P1 分别断言两种形状，**不加双读兼容掩盖错误** |
| `GET/PUT /api/agents/{id}` | `{configuration}` / `{configuration, warning}` | 未断言包络 | 同上 |
| 凭据引用 | `apiKeyRef` 可为 `env:MODEL_KEY` | 夹具写 `credentialRefs:[{ref:'env:…',status}]`，非 `auth.apiKeyRef` | 夹具须按 P1 §4.4 的既定文件结构写 `auth.apiKeyRef`（冒号保留），**不编造凭据状态旁路** |

**修订后的修法**（替代原审「删冒号」的错误建议）：
1. 凭据引用保持 `env:WEB_TEXT_INTAKE_SYNTHETIC_KEY` 原样，经私有 `config.credentialProvider` 交内存 controlled provider；不得为了让 I 的 `identifier()` 通过而改形状，也不得转成真实环境变量读取。
2. `config/` 预置文件按 P1 §4.4 的既定文件结构补齐 `name` 等必需元数据（`providers.json` 的 provider 需 `name`；`models.json` 按 I 既定结构带默认模型与修订元数据），**业务配置优先经正式 HTTP 读写**；必须预置合成配置文件时才走文件结构，且不编写凭据状态字段。
3. HTTP 断言按 P1 §5.3 **分别**锁定：`GET /api/models` 平铺四字段、`PUT /api/models` 返回 `{configuration, warning}`、agents 两端点返回 `configuration` 包络；不写「平铺或包络都接受」的兼容分支。

原审误判的根源：以 I 候选的 `identifier()` 校验规则作为形状判据，未先回查 P1 §4.4 对 `apiKeyRef` 的明文规定。此项的缺陷内核（夹具与生产解析面不兼容）保留，依据与修法已按冻结契约重写。

### M-3（major）III 已登记的 `--test-timeout=20000` 与套件自身耗时冲突

III 候选把套件注册为 `node --test --test-timeout=20000 …web-text-intake-*.test.mjs`（`package.json` `test:web-text-intake`）。但套件自身的时间假设远超 20s：

- `web-text-intake-http.test.mjs` 的 `waitForTask` 默认 `timeoutMs = 30000`（全组 20 处调用），单用就可能超过 20s；
- queue 的 `SLOW_MS = 6000`，T-5 用 `slowScript(3)` → 仅前三槽的模型侧延迟就 18s，再加补发、降并发、五任务全部 drain；
- queue 多数用例内部 `pollUntil` 的 `timeoutMs` 就是 25000/40000，`drainTasks` 默认 90000；
- 四组 `before()` 各自 `{timeout:90000}`，但 `before` 超时不救用例超时。

后果：即使 I 完全正确，`test:web-text-intake` 也会因 `--test-timeout=20000` 大面积超时失败，与「不延长原预算掩盖缺陷」的派工要求相悖（问题不在套件慢，而在登记预算与套件形态不匹配）。修法：III 侧为该组登记与套件形态相称的 `--test-timeout`（或按用例分级），并在 `docs/reviews/web-text-intake-tests-*.md` 记录预算依据；II 侧同步把 `SLOW_MS`/超时常量收敛。

> **队长裁定（`01a1bbd2`，2026-11-08）**：M-3 **仍按 20000ms 用例预算修订，不批准 III 延长预算**。即原审「III 侧登记相称预算」的修法被否决；正确方向是由 II 重新设计观测（缩短挂起判定窗、压缩对照 sleep、把编译准备移出用例外、把 `SLOW_MS`/轮询/清理收敛到同一总 deadline），使用例体本身落在 20s 内。作者 `ab7f609` 以显式 `timeout: 60000…180000` 声明覆盖预算的做法不成立（见 R2-2.1），须按本裁定撤回。

### M-4（major）T-13 宣称覆盖「backend log」，但套件没有任何后端日志采集点

用例名：`T-13: no synthetic secret reaches any response, SSE frame, database row, child argv or backend log`。实际断言覆盖 response/SSE/DB/child argv/请求记录；**没有任何一处读取后端进程的 stdout/stderr**（`grep` 全库无 `backend.stderr()`/`stdout()` 用于秘密断言；子进程模式虽有 `stderr()`/`stdout()` 访问器，但 queue/static 都未用它做秘密扫描）。只有 static 的 CLI 用例检查了 CLI 自身的 stdout/stderr（且仅 CLI 进程，不含 worker 与调度器日志）。

后果：宣称面大于实证面。若后端把 apiKey 写进日志，当前套件抓不到。修法：要么补采集（`startBackendChild` 已有 `stderr()`/`stdout()`，可对 secret 做 grep），要么把用例名与登记文档改成实际覆盖面，不得留宣称缺口。

### M-5（major）fixture 模式下配对/旅程用例静默 `return`，把「未验证」伪装成「通过」

`web-text-intake-static.test.mjs:317-320` 与 `:381-382`：

```js
if (staticRootMode === 'synthetic') {
  return;   // fixture mechanics cannot sign the product UI
}
```

基树 TAP 显示这两例为 `✔`（1440/640 各一）。在 fixture 模式下它们是**空转通过**。P2 T-14 的证伪反例明确包含「用原型/合成 IPC 代签」，空转 return 与该反例只有一线之隔。W1 对应套件的既有约定也是同样写法，但 W1 已在其登记文档中把模式记录为证据；本候选的登记文档只说「2 例显式失败（打包 CLI 默认路径 GAP-1；整理旅程 intake tab 禁用）」，**未声明另有 4 例在 fixture 模式下空转**。

修法：fixture 模式下这两类用例应 `t.skip()` 带明确原因（或 `assert.fail` 指明需要真实 dist），使 TAP 的 `skipped` 计数如实反映未验证面；登记文档同步。

### minor / nit

| 级别 | 位置 | 内容 |
|---|---|---|
| minor | `web-text-intake-http.test.mjs:1050` | 脱敏扫描字面量含 `'SELECT '`（带尾空格）与 `'/Users/'`，方向正确但过于具体；建议同时扫描 `apiKey`/`Bearer `/`credential` 等语义标记 |
| minor | `web-text-intake-queue.test.mjs:256` | 「取消后永不启动」用 `setTimeout(500)` 后断言 attempt 行数 0，建议改有界轮询 |
| minor | `web-text-intake-queue.test.mjs:545` | 「关页不取消」用 `setTimeout(300)` 后读一次状态，同上 |
| nit | `web-text-intake-static.test.mjs:436` | 页内 `await new Promise(r=>setTimeout(r,500))` 等 UI 刷新，属浏览器侧可接受；建议与产品自身的读回补偿对齐 |
| nit | `controlled-model.test.mjs:63-66`、`queue.test.mjs:74-77` | `swapScript` 用 `setTimeout(30)` 让 mtime 越过服务端缓存——比固定 sleep 好，但仍是时序假设；可在脚本文件写入后读回 mtime 确认 |
| nit | `web-text-intake-http.test.mjs:275` | `readModels()` 未解包 `configuration`（见 M-2），修复 M-2 时一并处理 |
| nit | 全组 | `assertNoSecretInRecord`（`controlled-model.mjs` 导出）无任何用例引用；其余导出（`SOURCE_TEXT_ALT`、`alternateExtractAnswer`、`followupFields`、`retryBody`、`resolveBody`、`agentsPutBody`）仅被 import 未被实际调用。II 范围内允许预留，但登记文档未列「已导入未使用」清单，建议注明以免误当覆盖 |

## 4. T-1–T-14 逐项对应核验

| # | 套件用例 | 可证伪性判定 | 说明 |
|---|---|---|---|
| T-1 | http `T-1` | **可证伪** | 手工建/完成/历史 + `tasks`/`task_events` 零行；基树实测 `✔`（唯一通过的 http 用例） |
| T-2 | http `T-2`×2、cm `T-4` | 可证伪（但被 M-2 阻断） | `/api/providers` 只出引用状态、明文 PUT 拒 400/422 且不回显、advisor 4xx、全链路 secret grep；配置形状需按 M-2 修正 |
| T-3 | http `T-3` | 可证伪（但被 B-1 部分打断） | 缺引用→`credential_unavailable`+`manual`+`exited_confirmed`+零候选+受控服务零新请求+来源保留；撤销转换亦覆盖。`sourceRow` 调用点受 B-1 影响 |
| T-4 | cm `fixture mechanics`×5 + `T-4` | **可证伪（最强项）** | 真实 organizer 直驱 5 例本审独立复算通过；`T-4` 断言请求条数=1 证伪「未经模型」、auth 头存在不记值、候选与模型输出一致、evidence 为原文子串。**「真实 Pi」的证明强度不足（M-11）** |
| T-5 | queue `T-5` | 可证伪 | 满槽不 409、FIFO 前三占槽、`queuePosition` 1/2、DB 槽计数=3、调升补发、调降不杀、每任务恰 1 候选；耗时与 M-3 冲突 |
| T-6 | queue `T-6`×3 | 大部分可证伪 | 取消 queued 幂等/`cancel_intent=0`/`not_started`/attempt 0 行——可证伪；取消 running 先持久 `cancelling`→终态 `cancelled`+`exited_confirmed`——可证伪；cancel/cancel 竞争 `[200,409]` **正确**（终态二次取消按 §4.4 拒 `state_conflict`；原审 M-1 归因错误已更正）；缺 claim/cancel 明确时序（建议补充，非缺陷）；SIGKILL→`exited_unknown`+占槽+`resolve` 409 `exit_unconfirmed`+三槽占满新提交保持 queued——可证伪；**占槽断言用固定 sleep 代替调度器决策（M-9）** |
| T-7 | queue `T-7` | 可证伪 | 同根重开、签收项/来源/候选逐字段重现、queued 保持、旧 attempt 被结束、新 attempt 只属新 epoch、旧 cookie 401、SSE `stream.reset`+快照高水位、`instance_epochs`+1。`sourceRowSafe` 在此显式失败（B-1 的可见面） |
| T-8 | http `T-8`×2 | 可证伪 | 同 operationId 重放同一对象、异输入 409 `idempotency_conflict`、同指纹 `reused:true` 不建第二来源/任务、`?operationId=` 读回、未知 type 400 `unknown_task_type` |
| T-9 | http `T-9` | 可证伪 | 空指令 400、revision 不改 version/标题、preview 落库、过期版本 apply 409 `version_conflict`、当前版本 apply version+1 且 DB 一致 |
| T-10 | http `T-10`×5 | 大部分可证伪 | 编辑校验四条负例、过期 409、批量一失败整批回滚（`tableCounts` 前后对比）、N≥2 混合原子+台账+关联、跨族占键整批回滚、丢弃留痕+移出 pending+重复 409、关联不覆盖目标+`link` 事件+零新事项——均可证伪；**「重放返回当前权威」一条因未复用 operationId/expectedVersion 而未验批次幂等（M-6）** |
| T-11 | http `T-11` | 可证伪 | `source=signed_ai` 入列表、历史可读、`manual_item_sources` 回源、完成正常 |
| T-12 | http `T-12` | **不可证伪（B-2 + B-3）** | 表达式逐字保留可证伪；**`time_review_required` 分支被 `if (candidate.unresolved)` 永久跳过（B-3）**；**「时点由 shared/dates 依锚点解析」断言读错字段名且被 `if (row.due_at_ms …)` 双重保护成死代码（B-2）**；锚点缺省规则未验（M-8） |
| T-13 | http `T-13`×3、queue 两客户端、cm 全部 | 部分可证伪 | 未配对 401/缺 CSRF 403/跨源跨 Host 403 且零落库——可证伪；会话失效后任务继续+重配对同 ID 读回——可证伪（依赖 GAP-2 第二码）；秘密边界四层——可证伪；**「backend log」无采集点（M-4）**；**argv 断言漏掉 bash-worker 子进程（M-10）** |
| T-14 | static 全部 | 部分可证伪 | 真实 dist 同源供给/SPA 回退/`/api` 不回退、真实打包 CLI 仅 `--root/--init` 起停（GAP-1 显式失败）、1440/640 真实 Chrome 冷启、真实产品配对门/会话失效/刷新、intake tab 启用态——均可证伪；**fixture 模式下 4 例空转通过（M-5）** |

派工点名的六项核对结论：

1. **附件/准入** —— 通过（§1）。
2. **T-1–T-14 与最终 P1 逐项对应** —— T-1/T-4/T-5/T-6(cancel/cancel)/T-7/T-8/T-9/T-11 通过；T-2/T-3 受 M-2/B-1 阻断；T-6 占槽观测受 M-9；T-10 的批次重放未验（M-6）；T-12 完全不可证伪（B-2/B-3/M-8）；T-13 受 M-4/M-10；T-14 受 M-5；staged 不可见性未验（M-7）。T-4 另受 M-11（证明强度）。
3. **断言可证伪性** —— 总体合格（无 wiring-echo、无 mock 回声、无「长度变长」式断言），但有 **3 处硬伤**：B-2 死分支、B-3 条件保护致分支永不执行、M-5 空转通过；另有 M-6/M-7 两处「宣称覆盖但实际未观测」。
4. **实际产品 UI/打包默认值** —— 真实 dist/真实 CLI/真实 Chrome 三项都到位（`design/` 拒绝链在每条静态根分支上都生效，CDP 无任何注入 seam，配对/录入均走产品自身 DOM 与响应路径）；fixture 模式的声明不完整（M-5）。
5. **夹具清理** —— `close()` 先关后端句柄再删自建根、调用方根全程保留（与 W1 判据一致）；失败路径同样关句柄/删临时目录；Chrome 由 `page.close()` SIGKILL；controlled service SIGTERM→`closeAllConnections`；`db-observer` 每次 `observe()` 都在 `finally` 关闭连接、只发 SELECT。此项通过。
6. **秘密边界** —— 系统性断言在位（IPC/argv/stdout/stderr/请求记录/DB/SSE/响应/CLI），一处宣称过度（M-4）。

## 5. 未决与给队长的裁定请求

1. **GAP-2 与套件期望的耦合**：两客户端用例依赖「成功配对消费旧码后再发下一枚一次性码」。候选已按队长裁定（01a1bba1：GAP-2 归 I，经既有私有 `onPairingCode` 回调发放）把夹具写成捕获多码并在缺码时抛 `PrerequisiteGap`——方向正确。~~M-1 的 `[200,409]` 期望应独立于 GAP-2 先修正~~（已更正：该期望正确，见 §3 M-1 与 §0 裁定回填）。
2. **GAP-3/4/5 的私有签名**：候选把暂存窗口、迟到帧 fencing、`runLimitMs` 三项目前写成不变量形式并登记缺口。按队长裁定，`config.workerProcessFactory` 与 `config.workerRunLimitMs` 已批准；`backend-child.mjs` 仍在试 `handle.setCredentialProvider` / `handle.configure` 双别名（队长已裁定撤销经夹具持有的 provider 状态变化实现）。**建议返工时把双别名探测改为单一既定机制**，并按批准的 `workerProcessFactory`/`workerRunLimitMs` 签名落地 GAP-3/5 的定点断言。
3. **`db-observer` 的连接生命周期** —— 已逐行复核：`observe()` 每次调用 `new DatabaseSync(path,{readOnly:true})`，在 `finally` 中 `db.close()`；只读打开被拒（硬杀后 WAL 恢复）时退回读写打开，但**仍只发 SELECT**。无句柄泄漏，无业务写入。此项通过。

## 6. 返工清单（交 II，后续修订限定复核）

1. B-1：删 `text_sources.status` 列断言；`sourceRowsSafe`/`sourceRowSafe` 不得吞夹具自身错误。
2. B-2：T-12 从 `fields_json` 取真实时点与 `resolveExpression(...).point.atMs` 比较；补「模型给绝对时刻不被接受」反向断言；删掉 `if (row.due_at_ms …)` 死保护。
3. B-3：脚本化一个真正歧义的日期表达式（如 `下周五或周六`），把 `timeReviewed:false`→400 `time_review_required` 与 `timeReviewed:true`→200 改成无条件断言。
4. ~~M-1：取消竞争用例按冻结 §3.3 改写~~ **已由队长裁定撤销**（原归因不成立，cancel/cancel 的 `[200,409]` 正确）。改为**建议项**：补一条 claim/cancel 明确时序（不带版本→赢 200 `cancelled`/输 202 `cancelling`；携带旧版本→409 `version_conflict`）并引用契约行号。
5. M-2（按队长裁定重写）：凭据引用**保留** `env:WEB_TEXT_INTAKE_SYNTHETIC_KEY` 原样（P1 §4.4 认可该形状），经私有 `config.credentialProvider` 交内存 controlled provider，不删冒号、不转真实环境读取；`config/` 预置文件按 P1 §4.4 既定结构补 `name` 等必需元数据，业务配置优先经正式 HTTP，不编造凭据状态旁路；HTTP 按 P1 §5.3 **分别**断言 `GET /api/models` 平铺四字段、`PUT /api/models` 返回 `{configuration, warning}`、agents 两端点返回 `configuration` 包络，不写双读兼容分支。
6. M-3（按队长裁定重写）：**不批准 III 延长 `--test-timeout`**；由 II 重新设计观测（缩短挂起判定窗、压缩对照 sleep、编译准备移出用例外、`SLOW_MS`/轮询/清理收敛到同一总 deadline），使用例体本身落在 20000ms 内；撤回 `ab7f609` 的全部超额 `timeout` 声明。
7. M-4（按队长裁定重写）：**必须**补后端 stdout/stderr 的秘密观测（`startBackendChild` 已有 `stderr()`/`stdout()`，子进程模式可对 secret grep；in-process 模式需补采集），不得以缩小宣称面替代。
8. M-5（按队长裁定重写）：验收组缺真实 dist 时必须以 `PrerequisiteGap` **显式失败**，禁止静默 `return` 记通过；TAP 与登记文档如实反映未验证面。
9. M-6：批量签收重放显式复用同一 `operationId`；重放前改掉某一事项，断言返回当前权威态并校验 itemId 映射。
10. M-7：staged 不可见性改为 running 期间 `pollUntil` 周期性断言候选列表为空，并直接观测 DB 中 `status='staged'` 行。
11. M-8：补显式传 `sourceAt` 的提交，断言锚点读回一致；不传时断言与 `imported_at_ms` 同源。
12. M-9：占槽断言改用 `pollUntil` 观测调度器决策，删 1500ms 固定 sleep。
13. M-10：进程观测泛化到 backend 进程树下全部 Node 子进程，工具路径用例同时断言 organizer 与 `bash-worker.mjs` 的 argv 不含秘密，并显式断言观测到 `bash-worker.mjs` 存在。
14. M-11（按队长裁定重写）：以**真实构建身份**（runtime bundle 的 provenance/哈希）、**工具子进程存在**（`bash-worker.mjs` 进程被观测到）与**脚本输出回传**（bash 脚本真实输出经工具结果回到最终请求）三者联合证明「真实 Pi」，不只认 `organizer.mjs` 进程文件名。

以上 1–14 完成后交限定复核（只复核改动点与受影响断言，不重跑未集成的全部业务套件）。

## 7. 证据索引（`build/web-text-intake-tests-review/`）

- `admission.json`：本审准入登记（pwd/branch/HEAD/基点/接收哈希/写入清单/边界）
- `received/`：P1 契约、授权清单、P2 报告只读副本（`git show` 提取，SHA-256 复算与登记冻结值一致）
- 作者附件 CLI 读回：`web-text-intake-tests-20261108.md`、`admission.json`、`full-run-summary.txt`、四套件 `*-base-run.tap`、`mechanical-checks.txt`、`cold-start-{1440,640}.png`
- 本审独立复现实跑：真实 `runtime/lib/organizer-contract.mjs` 解析夹具答案（§2.1）、GAP-1 默认路径复算（§2.2）、`text_sources` 缺列复现（B-1）、`point?.at` 死分支复现（B-2）、`unresolved=false` 复现（B-3）、I 生产 `normalizeProvider`/`identifier` 对夹具配置的拒绝复现（M-2）
- 未跑：完整 `npm run check`、四套件整体重跑、cargo、typecheck（按派工边界）


---

# 增量独审（r2）：II 修订 `ab7f609`（`b463f18..ab7f609`）

> 派工 `01a1bbc2-e65a-73b5-a35f-0edc17171b4a`：接续限定审该增量的协议夹具、启动前凭据注入、重配对与定点断言；未改面复用原审结论。评审人 OhMyPi（未写 I/II/III）。候选只读，写入仍限于本文件与 `build/web-text-intake-tests-review/`。
> 隊長同评论已裁定：`ab7f609` 暂不准入集成，并要求 II 修正两项已核实问题（用例预算、`assertStagedResolution`）。本增量审独立复核该两项，并审新增面。

## R2-0. 候选身份与增量范围（独立复算）

| 项 | 结果 |
|---|---|
| 提交/tree | `ab7f6090a8dd10a85c8d85184f6905aab9cc4d3e` / `aed1c35a524b2410bff0b57b8ef2ec9fb7b89348`（与派工值一致），父 `b463f18b` |
| 增量 | 8 文件 +881/−117；`A`：r2 文档、`protocol-worker-process.mjs`、`protocol-worker.mjs`；`M`：`backend-child.mjs`、`backend-process.mjs`、http/queue/static 三套件 |
| 写入范围 | 增量全部落在 `tests/fixtures/web-text-intake/**`、`tests/integration/web-text-intake-*.mjs`、`docs/reviews/web-text-intake-tests-20261108-r2.md`——**未触碰** `tests/fixtures/web-manual-items/**`、`package.json`、守卫、I/III 文件，与 II 冻结范围一致 |
| 作者附件 | 12 个附件 CLI 下载读回；`web-text-intake-tests-20261108-r2.md` SHA-256 `43a9b9c7…` 与候选树 blob 逐字节一致；`admission.json` `7762005e…`、`r2-candidate.diff` `3bf947b3…`、`mechanical-checks.txt` `f7d28821…`、`self-check-protocol.txt` `6c8cadff…`、`full-run-summary.txt` `6143a6c7…` 均与作者 SHA256SUMS 一致 |
| 脱敏 spot check | 12 个附件 grep 合成秘密值 = 0 命中；配对码/cookie/CSRF token = 0 命中；`/Users/` 绝对路径仅出现在作者 admission 的 `pwd` 登记字段（作者执行位置，非测试输出），其余附件为 0 |
| 机械复跑 | `node --check` 15/15 通过（与作者 mechanical-checks.txt 一致） |

## R2-1. 增量面独立实证

### R2-1.1 协议夹具四场景实跑（复现通过）

直接驱动 `protocol-worker-process.mjs`（不经后端），验证它说的确实是真实 organizer stdio 协议：

| 场景 | 实测 |
|---|---|
| `well-behaved` | exit 0；末帧 `{type:'result',data:{candidates:[…]},runId,hostNonce}`；**stdout 不含 apiKey** |
| `stage-then-hang` | 先发 `progress`+`result`（生产可暂存），进程保活；收到匹配 runId+hostNonce 的 `{type:'cancel'}` 后 `finish()` 清 keep-alive + 销毁 stdin → exit 0 |
| `late-identity-frame` | 首帧 runId 用 registry 里上一条 attempt 的身份（实测 `run_A` ≠ 自身 `run_B`），400ms 后发正确身份帧，再 exit 0——与夹具注释的「迟到帧」语义一致 |
| `lingering-tree` | 发 result 后 spawn detached 长命孙进程（`setTimeout 300000`）再 exit 0，孙进程 pid 写入 registry 供清理 |

身份派生算法独立复算：registry 有异名条目时取 `.at(-1)`，否则变异自身 nonce 末位——两种路径都能产生「与自身不匹配」的陈旧身份，不会退化成「发正确帧」。

### R2-1.2 私有接口与冻结裁定逐条对齐

- `config.workerProcessFactory(file, args, spawnOptions)` → `protocol-worker.mjs` 的工厂同步返回 `spawn(...)` 的 ChildProcess（真实 stdio + exit 事件），**只替代 WorkerHost 的 spawn 调用**；未传时生产必须 spawn 真实 Pi，`startProtocolBackend` 之外的用例（T-4/T-5/controlled-model）都不传工厂——真实 Pi 正常链未被替换。
- `config.workerRunLimitMs` 仅在 `startBackend` 的 config 里透传，范围校验留给生产并用 `workerRunLimitMs range` 用例（`0/-1/120001/1.5/'500'/null` 须拒；`1/120000` 须收）反向锁定。**两键都不进 HTTP/CLI/env**（`resolveArtifacts()` 与 CLI 解析链未引入）。
- 两个新键均**不经** `config/` 文件、不落盘：`effectiveConfig()` 只记非秘密配置，未把工厂或时限写入证据文件。

### R2-1.3 启动前凭据注入（与裁定一致）

`backend-child.mjs` 重写为 **startup gate**：子进程在 `import` 入口前先等 IPC 消息——收到 `{type:'credential-provider',entries}` 就构建内存 controlled provider 并交给既定的 `config.credentialProvider`；收到 `{type:'begin'}` 才在不注入时继续。父侧 `startBackendChild` 相应改为**先 send 再等 ready**。撤销改为 `{type:'credential-status',ref,status}` → 子进程改自身持有的 entry 状态并回 `credential-status-applied`；父侧暴露 `setCredentialStatus()`。

核对裁定原文「II 的 `backend-child` 在启动前经专用 IPC 收到内存 controlled provider，再传既定 `config.credentialProvider`；撤销通过夹具持有的 provider 状态变化，不再猜 `handle.setCredentialProvider`/`handle.configure` 双别名」——**完全一致**。双别名探测已删除（diff 中 `setCredentialProvider`/`configure` 两支全部移除）。in-process 侧同步加了 `createControlledCredentialProvider(...).setStatus(ref,status)`，http 套件新增 `T-3: a fixture-held revocation …` 用例：不改任何配置文件，仅翻内存状态 → 下一任务必须 `credential_unavailable`+`manual`+`exited_confirmed`+零候选+受控服务零新请求+来源保留，恢复后下一任务必须 `succeeded` 且 `resolvedRefs` 增长。这正是裁定要求的「撤销通过夹具持有的 provider 状态变化」。

### R2-1.4 重配对（GAP-2，与裁定一致）

`static` 套件把原来的「记录本实例仅发 1 个码」观测改为：刷新后经 `handle.receivePairingCode(1)` 捕获**下一枚**一次性码，用产品自身配对门（`pairInPage`：原生 value setter + `input` 事件 + `form.requestSubmit()`）再次配对，断言门关闭、nav 出现，并把 `pairingCodesObserved` 写入证据。基树入口仍只发 1 枚，故该例在基树显式失败并命名缺口——未假报通过，也未新开未鉴权取码接口。

## R2-2. 队长两项已核实问题——独立复核结论

### R2-2.1 用例预算违反（队长列第 1 项）——**确认存在**

实测 `ab7f609` 的 per-test `timeout`：

| 文件 | 行→值 |
|---|---|
| queue | 143→90000、236→90000、269→90000、303→**120000**、374→**180000**、538→90000、582→90000、700→60000、730→60000、776→60000、820→60000、852→60000、907→60000 |
| static | 170→60000、319→90000、342→90000、423→120000 |
| http | 192→90000（`before` 钩子，非用例） |

基线 `b463f18` 只有 queue:127→90000（`before`）与 static:382→120000（旅程用例）。即本轮**新增**了 60000/90000/120000/180000 四档用例级覆盖，与工单冻结的 20000ms 用例预算冲突。作者在 r2 文档 §「用例预算声明」自陈「`--test-timeout=20000` 会杀死超过 20s 的用例（本树实测确认）」并选择显式声明预算——这是**用声明覆盖冻结预算**，不是收紧。队长的「全部撤回超额覆盖，按同一总 deadline 收紧轮询与清理，编译准备放用例外；不得削弱原覆盖或通过拆散关键原子旅程避开预算」判定成立。

补充独立发现（同向证据）：GAP-3 用例自身含 5s 观测 sleep + 3×3s 生产超时等待 + `pollTask` 10000ms 上限，`GAP-3 default limit` 含 5s 观测 sleep——即使把 `timeout` 全删，用例体本身也远超 20s。因此这不是「声明写大了」，而是**用例形态与冻结预算不兼容**，需要按队长要求重新设计观测（更短的挂起判定、把 5s 对照窗压缩、把编译准备移出用例外），而非调大数字。

> **队长 `01a1bbd8` 对上述论证方式的限定**：三槽并行时限与轮询上限**不能机械累加为必然运行时长**；预算按共同总 deadline 与实际耗时验证。故上面这段只作为「用例体含有远超 20s 的等待成分」的定性说明，**不作为「必然超时」的定量证明**；最终以统一 deadline 派生后的实跑耗时为据。这不影响本条的结论（超额 `timeout` 声明违反冻结预算、须撤回并重新设计观测）。

### R2-2.2 `assertStagedResolution` 允许成功暂存后落入 `failed`（队长列第 2 项）——**确认存在**

`tests/integration/web-text-intake-queue.test.mjs:674-699`：

```js
function assertStagedResolution(task, root, sourceId) {
  if (task.state === 'succeeded' || task.state === 'failed') {
    …
    if (task.state === 'succeeded') { …候选须 pending… }
    return;               // ← failed 分支只查了 attemptExitState/cancelIntent/resultPendingExit 就返回
  }
  assert.equal(task.state, 'needs_review', …);
  …
}
```

冻结 web-api/1 §3.2 与 P1 §6.1.1：**暂存结局优先**——结果已暂存后，退出确认必须提交**原暂存结局**（成功→`succeeded` 并发布原候选）。`failed` 且带暂存成功结果属于第三落点，必须证伪失败。当前实现对该落点只做通用终态检查后 `return`，未断言「失败信封与暂存成功结局矛盾」。队长判定成立，修法（「改为核对原暂存成功结局：退出确认后 `succeeded` 且发布原候选，或 `needs_review/exited_unknown/result_exit_unconfirmed` 且保留暂存、占槽不可签收；意外 `failed` 必须证伪失败」）可直接落地。

作者 r2 文档 §「两个合法分支的说明」辩称「后端超时究竟先发 cancel 帧还是直接杀、杀后是否可确认进程树退出，属 I 的实现细节」——该辩称只覆盖「退出能否确认」这一维，**不覆盖「已暂存成功结局被改判 failed」这一维**：后者由冻结契约直接锁定，与 I 的实现细节无关。

## R2-3. 增量新发现（不影响队长两项的成立，供下一修订一并处理）

| 级别 | 位置 | 内容 |
|---|---|---|
| major | `protocol-worker-process.mjs` `stage-then-hang` + `queue` GAP-3 用例 | ~~挂起结束依赖生产「发 cancel 帧」……夹具的 `finish()` 注释声称「the production run-limit path sends one」是**对 I 实现的假设**。建议把注释改为「cancel 或强杀均可，落点须落两分支之一」，避免把实现细节写成契约~~ **→ 2026-11-08 队长 `01a1bbd8` 裁定：原归因不成立，已撤回** |
| minor | `queue` GAP-3 用例 `scenarios:[…,'well-behaved']` | 第 4 个 scenario 是兜底（`queue.length>0 ? shift : 'well-behaved'`），若调度器因任何原因重试出第 4 个 attempt，会用 well-behaved 回答且**不改变** `model.requests()` 计数，属隐性兜底。建议显式断言 attempt 数，或在场景耗尽时抛错 |
| minor | `queue` GAP-4 用例 | 只断言「第二任务 succeeded、来源恰 1 条候选、第一任务候选不受影响」，未直接断言「迟到帧被拒」这一事件本身（如审计事件/日志）。当前是从候选条数反推，属可证伪但间接；若生产的迟到帧拒绝路径同时正确地不写库，反推仍成立，可接受，建议下一轮补一条直接观测 |
| nit | `queue` GAP-5 用例 | `lingering-tree` 的孙进程由 `factory.cleanup()` 依 registry 的 `lingerPid` 清理，但孙进程是 **detached**（独立进程组）。若 cleanup 早于孙进程落盘，或 registry 行未及时 flush，可能残留 300s 的 `node -e` 进程。建议孙进程改为监听父进程退出（`process.on('disconnect')`）或把 300000 缩短到与套件同量级 |

> **R2-3 首项 major 的更正记录（队长 `01a1bbd8` 裁定，本审已回查 P1 冻结正文确认）**：原判「夹具依赖生产发 cancel 帧属对 I 实现的假设，应改为 cancel 或强杀均可」**归因不成立**。
>
> 最终 P1 `b190f7c6` §7（SHA-256 `5982c062…`，本轮重新提取复算）line 232 明文：
>
> > **取消/超时**：后端发 `{type:'cancel'}` 帧；`runLimitMs` 由后端与运行时双重 enforce；子进程退出但无结果帧 → `exited_unknown`。
>
> 即「超时路径发 cancel 帧」是**冻结契约要求**，不是 I 可自由选择的实现细节；夹具依赖该帧是正确的，`stage-then-hang` 的 `finish()` 注释与契约一致。原审把契约义务误读成实现假设，方向恰好反了。队长同时明确：有界宽限后的强杀及退出核实**不改变暂存原结局规则**——即无论结束手段是 cancel 帧还是宽限后强杀，已暂存的成功结局仍须按 §3.2 提交为 `succeeded` 并发布原候选（这与 R2-2.2 的待关闭项是同一规则的两面）。
>
> 保留为有效建议的部分（非缺陷）：夹具/套件可在注释里补一句「契约 §7 要求发 cancel 帧；宽限后强杀与退出核实不改变暂存原结局规则」，让后续评审不必重新推断。

## R2-4. 原审结论的承接

- **B-1/B-2/B-3、M-1…M-11 全部仍未关闭**：本增量未触碰 `db-observer.mjs`（`text_sources.status` 仍在 `:102`）、T-12（`point?.at` 仍在 `http:870`，`if (candidate.unresolved)` 仍在 `:851`）、`config/` 形状（`credentialRefs` 仍在 `:95/:294/:380`）、批量签收重放（`signOffBody` 仍未传 `operationId`，`:786` 的 `batchOp` 属跨族占键用例而非重放）、T-13 后端日志、fixture 模式空转、1500ms sleep、bash-worker argv、「真实 Pi」证明强度。按派工「未改面复用原审结论」。
- 原审中**已被本增量正确处理**的对接项：GAP-2（下一码经私有 `onPairingCode` 发放并在真实 UI 重配对）、GAP-3/4/5（私有 `workerProcessFactory`/`workerRunLimitMs` 签名 + 生产判据不变 + 真实 Pi 链另验）、凭据撤销（夹具持有 provider 状态变化，无生产 setter 别名）。这三项的方向与队长裁定逐条一致。

## R2-5. 结论与给队长的复核意见

**本增量（协议夹具／启动前注入／重配对／定点断言）方向正确、与冻结裁定逐条对齐，可采纳为后续修订的基础；但按队长同评论的两项已核实问题，`ab7f609` 维持「暂不准入集成」，本审不代为签发。**

独立复核确认队长两项均成立：① 用例预算 60000/90000/120000/180000 违反冻结 20000ms，且用例体本身（5s 对照窗 + 3×3s 生产超时等待 + 10000ms 轮询上限）与 20s 不兼容，需重新设计观测而非调数字；② `assertStagedResolution` 对「已暂存成功结局却落入 `failed`」这一第三落点只做通用终态检查后返回，未证伪失败，须按队长给的两种合法落点改写。

建议下一修订的最小闭环：撤回全部超额 `timeout` 并按共同总 deadline 收紧轮询与清理（编译准备移出用例外）、改写 `assertStagedResolution`、并入 R2-3 的两条 minor（场景耗尽显式报错 + 断言 attempt 数；迟到身份帧直接观测审计事件）与 nit（派生进程身份登记/清理覆盖提前失败并核实全部退出，不以缩短存活时间代替 cleanup）。~~R2-3 首项 major（cancel-vs-kill 注释去实现假设）~~ 已由队长 `01a1bbd8` 裁定撤回（P1 §7 明文要求发 cancel 帧，见上方更正记录）。原审 B-1/B-2/B-3 与 M-1…M-11 仍按原返工清单推进；本增量审只复核增量改动点与受影响断言，不重跑未集成的全部业务套件。

> **队长 `01a1bbd8` 对预算验证方式的补充**：预算按**共同总 deadline 与实际耗时**验证——三槽并行时限与轮询上限**不能机械累加**为必然运行时长。即判定用例是否落在 20000ms 内，应以统一 deadline 派生 + 实跑耗时为据，而非把 `SLOW_MS`×槽数 + 各 `pollUntil` 上限相加得出「必然超时」的结论。此项与原审 M-3/R2-2.1 的结论（超额 `timeout` 声明违反冻结预算、须撤回）不冲突：被否的是「调大数字」，不是「重新设计观测」。

## R2-6. 证据索引（`build/web-text-intake-tests-review/`）

- `admission.json`：本增量审准入登记；`author-admission.json`：作者 r2 准入（CLI 读回，`7762005e…`）
- `web-text-intake-tests-20261108-r2.md`、`r2-candidate.diff`、`mechanical-checks.txt`、`self-check-protocol.txt`、`full-run-summary.txt`、`SHA256SUMS.txt`：作者附件（CLI 读回，哈希复算一致）
- `http-r2-run.tap`、`queue-r2-run.tap`、`controlled-model-r2-run.tap`、`static-r2-run.tap`、`static-cli-r2-run.tap`：作者四套件 + CLI 单跑 TAP（http 24=1/23、queue 13=0/13、controlled-model 15=5/10、static 9=5/4、static-cli 1=0/1，0 skipped）
- 本审独立复现：协议夹具四场景实跑（R2-1.1）、陈旧身份派生复算（R2-1.1）、附件脱敏 grep、`node --check` 15/15、per-test `timeout` 全量清点（R2-2.1）、`assertStagedResolution` 早返路径复核（R2-2.2）
- 未跑：完整 `npm run check`、四套件整体重跑、cargo、typecheck（按派工边界）

---

# 限定复核（r3）：两项修复 `ab7f609..a2fb15b`

> 派工 `01a1bbdc-42ae-7ac4-adc9-6a00e591588f`：限定复核 `a2fb15bb614db6ce7d42eb11c8b06344668ecc3f`（tree `19cd0235ccde8ae48bb52d1a16e27bfcbf72ff84`，父 `ab7f609`，4 文件 +365/−138），核对两项修复的共同 20s deadline（含等待/清理）、退出未知用例隔离仍保留占槽判据、staged 分类的正负对照与真实原候选发布断言；不把纯函数通过代签后端业务通过。仍只写既定评审文档追加段与 `build/web-text-intake-tests-review/`。

## R3-0. 候选身份与范围（独立复算）

| 项 | 结果 |
|---|---|
| 提交/tree | `a2fb15bb614db6ce7d42eb11c8b06344668ecc3f` / `19cd0235ccde8ae48bb52d1a16e27bfcbf72ff84`（与派工值一致），父 `ab7f609` |
| 增量 | 4 文件 +365/−138；`A`：r3 文档；`M`：`browser-probe.mjs`、queue、static |
| 写入范围 | 全部落在 II 冻结范围内——`web-manual-items` 夹具、`package.json`、守卫、I/III 文件零改动 |
| 作者附件 | 5 个附件 CLI 读回，哈希与作者 r3-SHA256SUMS 逐一吻合（diff `d3d64a18…`、mechanical `739fa001…`、focused TAP `a6912095…`、negative control `7cb6cd5c…`） |
| 脱敏 | 所有 TAP/日志/文本 0 命中合成秘密值；diff 中出现的两处是 `SYNTHETIC_KEY` **常量声明本身**（即各套件的 grep 目标），非输出泄露；配对码/cookie/CSRF token 0；测试输出中无绝对路径 |
| 机械复跑 | `node --check` 6/6（改动及被依赖文件），与作者 mechanical-checks 一致 |

## R3-1. 修复一：共同 20s deadline —— **关闭**

**per-test `timeout` 全覆盖撤回**：queue/static/http/controlled-model 四组已无任何用例级 `timeout` 覆盖，只剩 4 个 `before` 钩子的 90000（编译准备，工单许可的用例外）。

**统一派生机制**（`queue:54-58`、`static:53-58`）：

```js
const CASE_BUDGET_MS = 20000;  const CASE_MARGIN_MS = 2000;
const caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS;
const timeLeft  = (deadline) => Math.max(250, deadline - Date.now());
const waitWithin = (deadline, capMs) => Math.max(250, Math.min(capMs, deadline - Date.now()));
```

`waitWithin` 同时受「上限封顶」与「剩余时间」二次约束——任何单项等待都不可能超过用例总预算，失败也在预算内以命名错误浮现。本审逐行核对 queue 套件全部等待点：

| 等待点 | 现背衬 |
|---|---|
| `drainTasks` | `timeLeft(deadline)`（默认 8000），且语义改为「只等无 `queued/running/cancelling`」（`ACTIVE` 白名单，`:76`/`:139-144`） |
| `pollTask` / `pollUntil` | `waitWithin(deadline, 6000/8000/10000)` |
| T-5 排空循环 | 每轮复检 `Date.now() < deadline` |
| 配对码等待 | `PAIRING_WAIT_MS` 收紧，使命名 GAP-2 缺口在预算内浮出而非被预算杀成假超时 |
| browser-probe CDP | 20000→10000、30000→10000，断言一字未减 |

残留 raw sleep 全部是轮询间隔或**有意对照窗**（30ms mtime、50ms 轮询、500/1000ms 观测、300ms 流关闭沉降、25ms 轮询、5000ms 缺省时限对照），无一把固定 sleep 当就绪代理。

**断言未减**：T-5/T-6/T-7、两客户端、协议 6 例、CLI、配对旅程、整理旅程的断言与步骤原样保留；GAP-3 的 5s 缺省时限对照窗作为「证明缺省 120000 未触发」的关键对照，在预算内保留。

**连带结构修正（集成轮才会显现）**：T-6 SIGKILL 例改用专用 backend（`startCaseBackend`）——该例按设计把 attempt park 成 `exited_unknown` 且 slot 永久持有，在共享 backend 上会让后续用例全部排在死槽后假超时。这是**隔离副作用**，不是拆散关键原子旅程：旅程本身与全部判据不变（见 R3-3）。

**结论：关闭。** 一项非阻断观察（不属本两项）：`handle.close()`／`page.close()`／`factory.cleanup()` 等清理动作本身未受 case deadline 约束（`startBackendChild.close()` 最坏等 `waitExit()` 15000 才 SIGKILL）， pathological 子进程可能把清理推出预算。派工字面含「含等待/清理」，记入下一修订观察项；不影响本两项的判定。

## R3-2. 修复二：staged 分类的正负对照 —— **关闭**

原 `assertStagedResolution` 的 `if (succeeded || failed) { …generic checks…; return }` 已拆成纯函数分类器 + 只读 DB 包装：

- `classifyStagedResolution(task)`（`queue:742-767`）：`exited_confirmed` → 必须 `succeeded` + `cancelIntent=false` + `resultPendingExit=false`；否则 → 必须 `needs_review` + `exited_unknown` + `recovery.cause=result_exit_unconfirmed` + `cancelIntent=false`；任何第三落点立即证伪。
- `assertStagedResolution(task, root, sourceId)`（`:770-783`）：`committed` 分支要求 DB 原候选全部 `pending`（**真实原候选发布**，不是新建）；`held` 分支要求 staged 行保留、`pending` 零。

**本审独立复现**（括号匹配抽取该函数后直接运行，不依赖 backend/DB）：

```
committed(succeeded) = committed
held(needs_review)   = held
REJECTED  staged success landing failed after confirmed exit
REJECTED  staged success landing cancelled after confirmed exit
REJECTED  failed without confirmed exit
REJECTED  succeeded without confirmed exit
REJECTED  cancelled without confirmed exit
REJECTED  held with unregistered recovery cause
REJECTED  held without exited_unknown
REJECTED  confirmed exit with cancelIntent still set
REJECTED  confirmed exit still pending its result
REJECTED  still running with the result pending
=> ALL 10 ILLEGAL LANDINGS REJECTED
```

**负对照不是稻草人**：把 r2（`ab7f609`）的判定逻辑喂同一输入 —— `r2 logic on a staged success landing failed → terminal-ok`（**接受**，即队长点名的问题）。作者的 `r3-negative-control-run.tap` 独立佐证：把 r2 判定注入 `build/` 副本后，同一聚焦用例失败于「must reject a staged success landing failed after a confirmed exit」。

**不代签**：该聚焦用例在文档与代码注释中都明确标注为**纯表判定**（无 backend、无 DB），本审也只把它记为「分类器可证伪性的证明」；后端业务是否走通仍取决于 I 集成后的真实落点，本陪审不据此签发任何业务通过。

**结论：关闭。**

## R3-3. 退出未知用例隔离后仍保留占槽判据 —— **保留（通过）**

T-6 SIGKILL 例迁到专用 backend 后，全部判据一字未减：`needs_review` + `exited_unknown` + `cause=exit_unconfirmed` + `cancelIntent=false`；`resolve` → 409 `exit_unconfirmed`；三槽全被 `exited_unknown` 占据时新提交保持 `queued`。GAP-5 例（`:978-1032`）同样完整保留：`needs_review` + `exited_unknown` + `cause=result_exit_unconfirmed` + `result`/`failure` 对外 null；DB 三行 staged 保留；HTTP 候选列表零可见；**staged 候选不可签收**（sign-off 非 200 且 `manualItems` 为 0）；`resolve` → 409；新提交保持 `queued`。所有等待均在 case deadline 内派生。

## R3-4. staged 正负对照与真实原候选发布 —— **通过**

- **正对照（真实原候选）**：`protocol factory control` 断言发布候选的标题为 `协议夹具候选`（来自假 worker 的真实 payload）、`status='pending'`、evidence 为所提交文本的逐字子串、DB 恰 1 行；`committed` 分支要求原候选全部发布为 `pending`。
- **负对照**：10 个非法落点 + 作者 r2 注入负对照运行（见 R3-2）。
- **held 对照**：staged 保留、`pending` 零、HTTP 不可见、不可签收。

## R3-5. 未纳入本增量的项（按派工归属，不算本增量回归）

队长同评论将 R2-3 的两条 minor 与 nit 派给 Kimi **另一批**返工，本增量确实未含：`protocol-worker.mjs:36` 场景耗尽仍回落 `well-behaved`（ minor 1 的显式报错 + attempt 数断言）、迟到身份帧直接观测 `rejected_late_result` 审计事件（minor 2）、派生进程身份登记/清理覆盖提前失败并核实全部退出（nit）。原审 B-1/B-2/B-3 与 M-4…M-11 等其余项亦未触及，按原返工清单继续。

## R3-6. 结论

**两项修复均关闭**：① 共同 20s deadline（超额 `timeout` 全撤、`waitWithin`/`timeLeft` 统一派生、编译准备留在 before 钩子、断言未减、GAP-2 命名缺口在预算内浮出）；② staged 分类正负对照（纯表分类器 + 只读 DB 包装，10 个非法落点全部证伪，负对照实证非稻草人，未代签后端业务）。退出未知用例隔离后占槽判据完整保留，staged 真实原候选发布断言到位。

II 整体仍待统一关闭矩阵与独审；HTTP/controlled-model 的失败路径背衬（30000/40000）按队长裁定属既有 M-3，不作为非阻断项转交集成者。MAYNE-24 保持 in_progress，未改状态。

## R3-7. 证据索引（`build/web-text-intake-tests-review/`）

- `admission.json`：本限定复核准入登记
- `r3-scoped-review-verification.txt`：本审独立复现（deadline 派生逐点核对、分类器 10 非法落点实跑、r2 逻辑交叉验证、附件脱敏 grep、`node --check`）
- `r3-candidate.sanitized.diff`、`r3-mechanical-checks.txt`、`r3-focused-staged-table.tap`、`r3-negative-control-run.tap`、`r3-SHA256SUMS.txt`：作者附件（CLI 读回，哈希复算一致）
- `r3-ohympi-review-attachment.md`、`r3-captain-ruling-verification-attachment.txt`：前两轮已交付附件读回件
- 未跑：完整 `npm run check`、四套件整体重跑、cargo、typecheck（按派工边界）

---

# 限定独审（r4）：统一关闭矩阵 `a2fb15b..1bfc352`

> 派工 `01a1bc22-2e69-7788-bcc4-1af017c69679`：限定独审 `1bfc352bf1673004ec1554fde180e4172f0cd185`（tree `7db2481f51ffe45e3fe1c5a6c15f305f6f5d5e65`，父 `a2fb15b`，11 文件 +824/−138），按已更正的原审清单逐项核对统一关闭矩阵，复用未改已过结论；重点复核精确 DDL 观察器、T-12 无条件日期/歧义/锚点、同键原版本重放、后端日志及全进程树秘密观测、场景耗尽/迟到审计/提前失败清理、真实 Pi 联合证据的构建身份。仍只写既定评审文档追加段与 `build/web-text-intake-tests-review/`。

## R4-0. 候选身份与范围（独立复算）

| 项 | 结果 |
|---|---|
| 提交/tree | `1bfc352bf1673004ec1554fde180e4172f0cd185` / `7db2481f51ffe45e3fe1c5a6c15f305f6f5d5e65`（与派工值一致），父 `a2fb15b` |
| 增量 | 11 文件 +824/−138；`A`：r4 文档；`M`：6 夹具 + 4 套件 |
| 写入范围 | 全部落在 II 冻结范围内——`web-manual-items` 夹具、`package.json`、守卫、I/III 文件零改动 |
| 作者附件 | 14 个附件 CLI 读回，**14/14 哈希与作者 SHA256SUMS 逐一吻合** |
| 脱敏 | 所有 TAP/日志/文本 0 命中合成秘密值（diff 中两处是 `SYNTHETIC_KEY` 常量声明本身，即各套件的 grep 目标，非输出泄露）；配对码/cookie/CSRF token 0；测试输出无绝对路径 |
| 机械复跑 | `node --check` 15/15 通过 |

## R4-1. 统一关闭矩阵逐项核对

| 项 | 本轮实现（位置） | 本审独立核验 | 判定 |
|---|---|---|---|
| **B-1** 精确 DDL 观察器 | `db-observer.mjs:108` 改要求 `['source_id','fingerprint','raw_text','succeeded_run_id']` | 四列全部存在于冻结 003 DDL；幻影 `status` 列已除。本轮以真实 DDL 建表复现：`sourceRow` 不再抛错（第 1 轮必错的那条路径已闭合） | **关闭** |
| **B-2** T-12 真实字段/存储 | `http:960` 比 `JSON.parse(fields_json).due.atMs` 与 `resolveExpression(...).point?.atMs` | 独立验算 `shared/dates.mjs:54` 的返回为 `point:{atMs,…}`、`.at` 为 `undefined`；`candidates` 无 `due_at_ms` 列。旧断言确为死分支，新断言走真实字段与真实存储 | **关闭** |
| **B-3** T-12 无条件歧义 | 新夹具 `AMBIGUOUS_TEXT`/`AMBIGUOUS_EXPRESSION`（`下周五前后`）+ `ambiguousExtractAnswer()`；用例**无条件**断言 `unresolved=1`、无 timeReviewed→400 `time_review_required`、有→200 | 独立验算：`resolveExpression('下周五前后', anchor, 'Asia/Shanghai')` → `{unresolved:true, point:null, warnings:['原文日期存在多个选择…']}`；旧 `下周五` → `unresolved:false`。即在**夹具层面**修掉了根因（脚本永不歧义），不是靠弱化断言 | **关闭** |
| **M-3** http/controlled-model 预算模式 | 两套件落入同一 `caseDeadline()`/`waitWithin` 模式（http 25 处、controlled-model 9 处派生） | 无残留超预算的测试等待（唯一 4 位数 `timeoutMs` 是受控服务自身的 provider network 超时，非测试等待） | **关闭** |
| **M-4** 后端日志 | queue T-7 断言子进程 backend 自身 stdout/stderr（击杀前 + 重启后两实例）；http T-13 在一次真实生产运行窗内拦截 `process.stdout/stderr.write`，写 canary 行、断言采集非空且无秘密、还原原生 | 两处都是**真实采集点**，非缩小宣称 | **关闭** |
| **M-5** 缺真实 dist | `static:363-368`、`:451-456` 改抛 `PrerequisiteGap`，点名缺 product dist 与当前 mode | 静默 `return` 记通过已消除 | **关闭** |
| **M-6** 同键原版本重放 | `http:794` 钉 `batchOp`，成功批与重放**同 operationId + 原 expectedVersion**（版本已因 accept 前进，旧版本恰证幂等短路）；断言 `replayed:true`、同一组当前权威 itemId、无第二条 ledger 行、`signOffBatchRow(batchOp)` 在库 | 原审所指「既未复用 operationId 也未复用 expectedVersion」已修正 | **关闭** |
| **M-7** staged 不可见性 | r2 落地的暂存窗观测（HTTP 零可见 + DB staged 在位 + 占槽 + 第四任务 queued + 不可签收），本矩阵登记指针 | r2 已实证，本轮未改 | **关闭（r2 证据）** |
| **M-8** 锚点缺省规则 | T-12：省略 `sourceAt` 默认首次录入时间（±120s）且带 timeZone；显式锚点逐字保留。T-8：指纹去重复用**原锚点**且不建第二任务 | 两条都补上了 | **关闭** |
| **M-9** 调度器决策面 | `queue:404-416` 改为 deadline 有界连续观测：每轮断言新提交保持 `queued` **且** `attemptRows===0` | 固定 sleep 已除；任何启动都会翻转状态或建 attempt 行 | **关闭** |
| **M-10** 全进程树秘密边界 | `controlled-model:403-417` 取测试进程全部后代逐条断言命令行不含秘密（organizer worker、bash 工具子进程、bash 命令本身） | 真正持密的 `bash-worker.mjs` 已被覆盖 | **关闭** |
| **M-11** 真实 Pi 联合证据 | `controlled-model:358-436` 三项**在同一次真实生产运行上**联合观测：①生产 spawn 的 worker 命令行必须含本树 bundle 的 organizer 路径 + `source.json` provenance 落证据；②运行中可观测 `bash-worker.mjs` 后代；③脚本回显标记经 `toolContents` 回到模型服务 | 构建身份不是只认路径：有 provenance + 工具子进程 + 输出回传三重 corroboration | **关闭** |
| **M-1/M-2/M-3** 裁定保持 | r3 撤回超额 timeout；claim/cancel 时序作建议项待集成版 | 按队长裁定执行 | **按裁定保持** |

## R4-2. R2 新增夹具项三项

**场景耗尽显式报错 + attempt 计数 —— 关闭。** 本审直接驱动工厂（3 注册场景、4 次 spawn）：第 4 次抛出 `protocol worker scenario queue exhausted: 3 scenario(s) registered, attempt 4 requested — no silent fallback; every worker spawn must map to a registered scenario`；`attempts` 记录 4 条、场景序列 `[well-behaved ×3, null]`、第 4 条 `pid=null`（未 spawn 任何进程）；`exhaustionError()` 携带同一文案；cleanup 报告 `survivors: []`。静默回落已消除。

**迟到身份帧直接观测 `rejected_late_result` —— 关闭。** `queue:1003-1019` 直接读迟到帧所落入任务的 `task_events`，要求 ≥1 行 `type='rejected_late_result'`、`object_type='task'`、`object_id=`该任务、payload 无秘密；失败信息列出实际事件类型序列。候选条数推断保留为次级。

**派生进程身份登记/清理覆盖提前失败并核实全部退出 —— 关闭。** `protocol-worker-process.mjs:132` 在读请求行**之前**写 `worker-start`，`:121` 孙进程 spawn 后**立即**登记 pid，`:124` 记录 `spawnFailed`；新增 `early-failure` 场景（派孙进程并登记后、发任何结果帧前 exit 1）。`factory.cleanup()` 改 async：SIGKILL 全部直接子进程并等待 exit（5s 有界）→ SIGKILL 全部登记孙进程 → **逐一核实**每个 pid 确已消失（`process.kill(pid,0)`，重试一轮）→ 有幸存者即抛错。清理用例 `queue:1137-1208` 在 cleanup **之前**断言两个孙进程仍存活（证明不是靠 300s 生命周期自然结束，未以缩短存活时间代替 cleanup），之后断言 `survivors` 为空、进程表无 `protocol-worker-process.mjs` 残留；5 处 `finally` 全部 `await factory.cleanup()`。

## R4-3. 队长两项专项 cautions

**①「第四 attempt 非 succeeded」——确认存在未闭合问题（唯一未关闭项）**

`queue:1118-1121` 只用 `assert.notEqual(fourthTask.state, 'succeeded')`。本审复现：该断言对 `state='running'`（**永久卡住**）、`state='failed'`、`state='needs_review'` **一律通过**。其上方注释自陈「生产映射无论是 failed／parked 抑或仍持有」——即调度器楔死、任务永不离开 running 也被当合法结局收下。队长明确要求确认「未把永久卡 running 当合法失败」，实测**确实如此**。

建议修法：把该断言改为「有界等待任务离开 staged/active（`pollTask` 到终态或 `needs_review`，受剩余预算约束）→ 断言落点是合法非成功点之一」，使永久卡 running 失败。

附带说明：`queue:1159` 的同一 `notEqual` 模式**不受影响**——该 worker 在 `:1156-1158` 已先被 `pollTask` 到「终态或 `needs_review`」才断言，`running` 到不了那里。

**② 清理须在预算内完整回收自建进程 —— 关闭（附一项观察）。** cleanup 有界（5s 子进程退出等待 + 100ms 核实重试）、完整回收并核实每个自建进程、有幸存者即抛错，且用例先证明孙进程存活（非简单超时返回）。观察项：cleanup 调用本身未从 case deadline 派生（自带固定 5s 上界），pathological 子进程可能把用例总时长推出 20000。该观察自 r3 延续，队长已裁定留在 II 收口清单、不构成对等待/清理预算的豁免。

## R4-4. 结论

**统一关闭矩阵 14 项中 13 项关闭**（B-1/B-2/B-3、M-3/M-4/M-5/M-6/M-7/M-8/M-9/M-10/M-11，M-1/M-2/M-3 按队长裁定保持），R2 新增夹具项三项全部关闭；**唯一未关闭项**为 R4-3①：场景耗尽用例的「第四 attempt 不得 succeeded」用 `notEqual` 表达，会把永久卡 `running` 当合法结局，须改为有界等待 + 合法落点枚举。

按派工「交明确通过／不通过」：**本增量不通过（限定项）**——不是矩阵大面积未闭合，而是唯一遗留项恰好落在队长点名须确认的那条判据上；该项为单点断言改写，不影响其余 13 项的关闭结论。II 整体仍待统一关闭矩阵与独审；MAYNE-24 保持 in_progress，未改状态。

## R4-5. 证据索引（`build/web-text-intake-tests-review/`）

- `admission.json`：本限定独审准入登记
- `r4-scoped-review-verification.txt`：本审独立复现（14/14 附件哈希、逐项关闭核验、工厂耗尽实跑、`notEqual` 对 running 的接受复现、脱敏 grep、`node --check`）
- `r4-candidate.diff`、`r4-protocol-selfcheck-r4.mjs`/`.txt`、`r4-focused-*.tap`（staged-table / fixture-mechanics / cold-start / t1 / cli-gap1 / pairing-gap2 / m5-prerequisite-gap / r2-new-cases / joint-proof / t12-t13）、`r4-build-backend-r4.log`、`r4-SHA256SUMS.txt`：作者附件（CLI 读回，哈希复算一致）
- 未跑：完整 `npm run check`、四套件整体重跑、cargo、typecheck（按派工边界）

---

# 限定复核（r5）：两个剩余面 `1bfc352..61a069b`

> 派工 `01a1bc42-527f-75d0-97c7-de81bf256a81`：只审上轮两个剩余面——① 场景耗尽必须在同一 deadline 内闭合为契约允许的状态/信封/退出或恢复组合，永久 running 等负对照须失败；② 清理从 20s 硬截止派生，缺截止/无余量/提前失败都先终止自建进程并核实，无幸存者或被丢弃的退出等待。**不能仅因各字段属于枚举就签状态组合合法。** `cabfdbe` 已闭 13 项及未改面结论保留。

## R5-0. 候选身份与范围（独立复算）

| 项 | 结果 |
|---|---|
| 提交/tree | `61a069b35757187174db0e92a2b9e5fd934dc520` / `e0a6028b95408503edb2f2c22e0fc1648117bf3d`（与派工值一致），父 `1bfc352` |
| 增量 | 4 文件 +414/−63；`A`：r5 文档；`M`：`backend-process.mjs`、`protocol-worker.mjs`、queue 套件 |
| 写入范围 | 全部落在 II 冻结范围内——`web-manual-items` 夹具、`package.json`、守卫、I/III 文件零改动；http/controlled-model/static 三套件与 r4 **逐字节相同**（已闭 13 项的面未动） |
| 作者附件 | 9 个附件 CLI 读回，**9/9 哈希与作者 SHA256SUMS-r5 逐一吻合** |
| 脱敏 | 附件内合成秘密/配对码/cookie/CSRF token 0 命中；测试输出无绝对路径 |
| 机械复跑 | `node --check` 15/15 通过（与作者 mechanical-checks-r5 一致） |

## R5-1. 剩余面一：合法状态闭合 —— **关闭**

**分类器是组合判定，不是逐字段枚举**（`queue:889-933`）：

- `state='failed'` → 必须同时满足：失败信封在位、`failure.code`/`failure.message` 为非空字符串、`retryable ∈ {auto_backoff,manual,none}`、`sideEffectSafety ∈ {proven_safe,unknown,proven_unsafe}`、`attemptExitState='exited_confirmed'`（释放槽）、`cancelIntent=false`；
- `state='needs_review'` → 必须同时满足：`recovery` 对象在位、`recovery.cause` 属冻结注册白名单、`typeof recovery.itemVersion === 'number'`、`attemptExitState ∈ {exited_confirmed,exited_unknown}`（不得仍 active/exiting）；
- 其余一切状态 → 抛 `AssertionError` 并点名实际观测到的 state/attemptExitState/failure/recovery。

**注册 cause 白名单与冻结契约逐条核对**：`queue:881-885` 的 9 个 cause 与 `web-api-contract.md` §3.5 表（line 126–134）的 `needs_review` cause **完全一致**；`backend_restart`（line 125，属 `interrupted`）被正确排除。

**用例本身**（`queue:1222-1290`）：前三任务在同一 case deadline 内逐一 `pollTask` 到 `succeeded`；第四任务 `pollTask` 到 `SPAWN_FAILURE_LEGAL_STATES = ['failed','needs_review']`（同一 deadline）后过分类器——`queued/running/cancelling` 超时即失败并点名最后观测状态；`exited_unknown` 停车时另行要求 `resolve` → 409 `exit_unconfirmed` 且 `recovery.itemVersion` 为乐观锁；零候选断言保留。

**本审独立复现**（括号匹配抽取分类器后直接运行）：

```
legal failed                  -> failed
legal parked(exited_unknown)  -> parked
legal parked(exited_confirmed)-> parked
REJECTED   permanently stuck running        REJECTED   failed still holding its slot
REJECTED   still queued                     REJECTED   failed terminal with cancelIntent set
REJECTED   stuck cancelling                 REJECTED   parked without recovery
REJECTED   cancelled without a request      REJECTED   unregistered recovery cause
REJECTED   succeeded (factory bypassed)     REJECTED   parked without itemVersion
REJECTED   failed without envelope          REJECTED   parked attempt still active
REJECTED   envelope without code            REJECTED   parked attempt still exiting
REJECTED   unregistered retryable
REJECTED   unregistered sideEffectSafety
=> ALL 16 ILLEGAL LANDINGS REJECTED
交叉对照 r4 逻辑：notEqual(state,'succeeded') 对 state='running' -> 通过（即上轮缺陷本身）
```

**判定：关闭。** 「永久 running」现在被纯表证伪，真实用例也无法在「非成功」观测下闭合——必须落到合法状态＋信封＋退出态／恢复组合。

## R5-2. 剩余面二：清理从 20s 硬截止派生 —— **关闭**

**工作截止与硬截止分离**（`queue:57-64`）：`caseDeadline()` = now+20000−2000（工作轮询边界），`caseHardDeadline()` = now+20000（聚合 `--test-timeout` 强制值），两者间保留 2000ms 清理余量；全部清理等待从**剩余硬预算**派生。

**`factory.cleanup(hardDeadline)`**（`protocol-worker.mjs:111-181`）顺序为本调度要求的形态：

1. `remaining()` 在截止缺失/非有限值时抛**命名错误**——参数必需，无参调用不可能退回固定等待；
2. **先终止**：SIGKILL 全部 worker，再 SIGKILL 全部注册孙进程——发生在任何余量检查**之前**，所以缺余量也不会留进程；
3. 之后才检查 `remaining() <= 0` → 显式失败（杀已完成）；
4. 每个子进程的退出等待以 `max(0, remaining())` 为上界；
5. **逐一核实**每个记录 pid（`process.kill(pid,0)`），幸存者在剩余预算内再杀一轮，任何幸存者 → 显式失败。

固定 5000ms 退出等待与固定 2×100ms 重试轮已退役（grep 确认两 helper 内无残留）。

**`backend-process.mjs`**：新增 `terminateAndVerify(child, hardDeadline, label)`（`:192-215`）——无有限截止即命名失败；SIGTERM→有界等待→SIGKILL→有界等待→以 `exitCode/signalCode` 核实，Promise 超时绝不代签退出；子进程幸存即抛错。`release()`（启动失败路径）改用它并保留原失败为 `cause`；`waitExit()` 改无参、从句柄携带的 case 硬截止派生（退役固定 15000ms 默认）；`close()` 先终止核实再删配置目录，`.catch(() => child.kill('SIGKILL'))` 吞错已移除。

**调用点**：queue 套件 8 处 `factory.cleanup(...)` 全部传 `hardDeadline`；两个 `startBackendChild` 均传；T-7 的 `first.waitExit(5000)` 改 `first.waitExit()`；T-7 finally 吞错移除。唯一残留 `.catch`（`:1374`）是该用例已在 `:1360` 断言过 report 之后的**第二次幂等 cleanup**，属正当而非掩盖。

**本审独立复现**（直接驱动真实夹具）：

| 场景 | 实测 |
|---|---|
| ① 缺截止参数 | **显式命名失败**（"requires the case hard deadline … a fixed wait is no longer accepted"） |
| ② 无余量（过去截止） | **先终止后显式失败**：alive before=2 → after=0（信号稳定后），进程表 0 残留 |
| ③ 400ms 紧预算 + 3 workers | `survivors=[]`、耗时 4ms、全部记录 pid 消失——紧预算仍逐一核实 |
| ④ 覆盖性 | `report.workers.length` === 实际 spawn pid 数、全部消失、`survivors=[]`、进程表 0 条 `protocol-worker-process.mjs` 残留——无被丢弃的退出等待 |

作者夹具自检（`r5-protocol-selfcheck-r5.mjs`，CLI 读回）在**真实 test-owned backend 子进程**上覆盖同一地面：A1 预算派生 cleanup 逐一核实（<2s，证明每 worker 固定 5s 已除）、A2 attempt 计数精确、A3 缺截止失败、A4 无余量终止后失败、A5 400ms 紧预算仍核实、B1/B2 close 与 killHard+waitExit 核实、B3 无余量 close 终止后失败、B4 失败路径 release 核实并保留原失败——**9 passed / 0 failed**。

**判定：关闭。**

## R5-3. 夹具自检与生产语义的区分

自检与本审复现证的是**夹具 helper 的机械**（清理预算派生、退出核实、分类器可证伪性）。它们守卫的**生产语义**——spawn 失败时 I 实际选哪个落点、信封字段取值、是否 parked——在基树未集成，聚焦用例按设计显式失败（作者 TAP：`focused-r5-protocol-cases.tap`、`focused-r5-t7-gap-cases.tap`，405/404 命名缺口）。本审**不据此签发任何业务通过**。

## R5-4. 结论

**两个剩余面均关闭**，`cabfdbe` 的 13 项与其余未改面结论保留。组合级（非枚举级）的合法落点判定 + 16 个非法落点全拒 + 永久 running 被纯表证伪，满足派工「不能仅因各字段属于枚举就签状态组合合法」；清理满足「缺截止/无余量/提前失败都先终止自建进程并核实、无幸存者、无被丢弃的退出等待」。

II 整体仍待统一关闭矩阵与独审；MAYNE-24 保持 in_progress，暂不集成。

## R5-5. 证据索引（`build/web-text-intake-tests-review/`）

- `admission.json`：本限定复核准入登记
- `r5-scoped-review-verification.txt`：本审独立复现（分类器 16 非法落点实跑、r4 逻辑交叉对照、清理四场景实跑、调用点清点）
- `r5-candidate.diff`、`r5-admission-r5.json`、`web-text-intake-tests-20261108-r5.md`、`r5-mechanical-checks-r5.txt`、`r5-self-check-protocol-r5.txt`、`r5-protocol-selfcheck-r5.mjs`、`r5-focused-r5-resolution-tables.tap`、`r5-focused-r5-protocol-cases.tap`、`r5-focused-r5-t7-gap-cases.tap`、`r5-SHA256SUMS-r5.txt`：作者附件（CLI 读回，哈希复算一致）
- 未跑：完整 `npm run check`、四套件整体重跑、cargo、typecheck（按派工边界）
