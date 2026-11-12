# W1 真实 `test` 任务安全重试正控回归（Pi，2026-11-09）

> test-only 待审候选，不改生产／Runtime／DDL／package／守卫，不扩大 20s 用例预算，不跑完整门禁。本记录不自签任何生产候选。
> 派发：MAYNE-24 协调评论 `01a1bed7-34ff-76c2-80b4-9099ac72bee9`（Codex，2026-11-09）。

## 1. 范围与锁定输入

- 生产基座：Kimi I 分支 tip `681c2825bb053b740cc7fdfd7133e75384389139`（tree `754b790811d8c09732463cafdf6e93d4feff0284`）。测试从源码入口 `server/entries/web-backend-entry.mjs` 导入 `startWebBackend`，`server/lib/{task-service,task-scheduler,text-intake-service,worker-host,config-store}.mjs` 均按该提交字节调用。
- 运行时：默认真实 Pi bundle `build/s0-runtime`（organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`）。
- 存储：`web-backend-storage` 2649408 B／`42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`。
- 交付物：仅新建 `tests/unit/web-text-intake-test-safety.test.mjs`（无新夹具、无生产改动、无 package/脚本改动）。

## 2. 方法

每个用例都走真实链：HTTP → `TaskScheduler` → `WorkerHost` → 默认真实 Pi → loopback 受控模型服务 → 真实 Rust 存储。无脚本化 worker、无替写调度逻辑、无注入 `proven_safe`。

时钟只通过**现有** `TaskService.now` 属性控制（生产入口构造 `TaskService` 时已使用的同一 `now` 选项），并在 `before` 中明示：

```js
taskService = handle.scheduler.taskService;
clock = Date.now();
taskService.now = () => clock;
assert.equal(taskService.now(), clock, 'the existing TaskService.now property must control the clock');
```

不新增任何生产开关。`AUTO_BACKOFF_MS = 60_000` 仅在测试中重述为时钟推进量。

## 3. 结果（交付候选，未打补丁）

命令：`node --test --test-timeout=20000 --test-reporter=tap tests/unit/web-text-intake-test-safety.test.mjs`

| 用例 | 结果 |
|---|---|
| 负控：真实 extract 零回执 | ✔ 通过 |
| 正控：真实 test 输出契约失败 → auto_backoff | ✘ 失败（GAP-TEST-SAFETY-1） |

两轮独立运行均为 `tests 2 / pass 1 / fail 1`，退出码 1，结果确定。

### 3.1 负控（绿）

真实 `extract` 提交 → 受控服务返回违反输出契约的答案 → 真实 Pi 发出 `MODEL_INVALID_OUTPUT` → 后端收口。断言：

- 任务 `state=needs_review`、`failure.sideEffectSafety=unknown`、`failure.cause=failure_unknown_side_effect`；
- 该 attempt 的 `side_effect_receipts` 计数为 0，`hasNonReadonlyReceipts` 为 false；
- 无候选落库；
- 客户端携带 `input.sideEffectSafety='proven_safe'` 与伪造 `snapshot` 重复提交：判定仍为 `unknown`/`needs_review`，`input_ref.snapshot` 仍为服务端派生（provider/model 与配置一致）。

即：零回执没有被提升为安全，客户端证明字段不能改变判定。

### 3.2 正控（红，GAP-TEST-SAFETY-1）

真实 `test` 提交（固定 kind、无工具路径）→ 第一次模型回答 `{ok:false}` 违反 runtime 契约 → 第二次及以后为合法 `{ok:true}`。观测到的真实事实（绿）：

- `modelRequests[0].hasTools=false`（固定 kind 无工具路径）；
- `snapshot.provider.id`/`snapshot.model.id` 均为服务端派生；
- 第一次 attempt `exit_reason=confirmed`、回执计数 0；
- `failure.code=output_contract_invalid`、`failure.retryable=auto_backoff`。

目标断言（红）：

```
GAP-TEST-SAFETY-1: the backend has no trusted safety proof for a zero-receipt
test failure, so maybeAutoRetry routes it to needs_review instead of
auto-backoff; observed state=needs_review
failure={"code":"output_contract_invalid","message":"整理进程返回错误。",
"retryable":"auto_backoff","sideEffectSafety":"unknown",
"cause":"failure_unknown_side_effect"}
```

即：当前后端没有把零回执的 `test` 失败提升为 `proven_safe` 的可信证明，`maybeAutoRetry` 一律走 `needs_review`。正控的 `proven_safe → queued → 到期前不认领 → 到期后新 attempt 成功 → 预算递减` 目标序列因此为可证伪红；安全证明实现留 I 后续小增量独审。

## 4. 目标路径的本地验证（已回退，不交付）

为确认正控的目标断言在安全证明落地后能真正转绿，在隔离 scratch 树（detach 于 `681c282`）中对 `server/lib/task-scheduler.mjs` 做了**临时**模拟：对零回执的 `test` 失败在 `effective.payload` 上补 `sideEffectSafety:'proven_safe'`。该补丁**仅存在于本次本地实验**，运行后已逐字节回退（`TEMP-EXPERIMENT` 标记计数 0），未进入交付分支。

结果：`tests 2 / pass 2 / fail 0`，退出码 0。这验证了：

- 正控的 `queued`／`next_attempt_at`／到期前不认领／时钟推进后二次 attempt 成功／`attempt_budget` 递减／零回执等断言在目标状态成立；
- 负控在目标状态依然成立（extract 收口不读客户端证明字段）。

该实验不代表生产已通过；它只证明测试的目标路径可证伪且方向正确。

## 5. 证据

原始 TAP 与身份在 gitignored `build/web-text-intake-test-safety/`（隔离 scratch 树内）：`run1.tap`、`run2.tap`（交付候选两轮的 1 绿 1 红）、`target-path-validation.tap`（临时模拟下的 2 绿）。测试自身的 `build/web-text-intake-tests/web-text-intake-test-safety-effective-config.json` 记录运行时/存储/时钟控制/锁定输入。

## 6. 守卫状态

- `npm run check:docs`：通过（21 文件、513 本地链接）。
- `npm run check:structure`：在隔离交付分支上失败，但**不是本候选引入的退化**：
  - 改动前（`45b1cfe`）该分支已有 14 条 `ref.missing`（`tests/fixtures/web-text-intake/` 夹具与 `vendor/pi/.../dist/` 产物不在本分支，而在 I/II 分支）；
  - 本候选新增 4 条同类的 `ref.missing`（测试引用同一批共享夹具），合并 I/II 分支后自然消解；
  - 工作树另有 10 条 `top.dir` 来自平台注入的 `.pi/`（未被本候选提交，不随交付分支走）。
  - 未跑完整 `npm run check`（III 集成轮）。

## 7. 边界

- 仅新建一个测试文件与本记录；未改生产／Runtime／DDL／package／守卫／夹具；未跑完整 `npm run check`；未触真实模型／凭据／用户根（合成密钥仅指 loopback 受控服务）。
- 正控为可证伪红，负控为绿；未为全绿修改生产或降低预期。
- 本记录不自签 Pi 自己的测试候选，也不代签任何生产候选；未改 MAYNE-24 状态。

## 8. 未可信执行来源负控（2026-11-09 增量）

派发：MAYNE-24 协调评论 `01a1bf42-af15-7a41-b2d2-7fc9f034e5f0`（Codex，2026-11-09）。生产基座：Kimi I 分支 tip `0536a44`（tree 见交付身份），测试从源码入口导入。

### 8.1 用例与夹具

在 `tests/unit/web-text-intake-test-safety.test.mjs` 追加第三个用例，并新增测试专用夹具 `tests/fixtures/web-text-intake/test-safety-stub-worker.mjs`。用例／根隔离：新用例自建临时根与第二个后端实例，`finally` 关闭并删除；原默认真实 Pi 正控保持原样，不被脚本化工厂代签。

- **私有替换工厂**：`startWebBackend({ workerProcessFactory })` 用测试专用替身进程替换真实 Pi；`stubInvocations === 1` 断言替身确实运行、真实 Pi 未被派生。
- **合法身份错误帧**：替身读取冻结 stdio 请求行，回显 `runId`＋`hostNonce`，发出 `type:'error'`、`code:'MODEL_INVALID_OUTPUT'` 帧；无工具／MCP 帧，回执计数为 0。
- **判定**：任务 `state=needs_review`、`failure.sideEffectSafety=unknown`、`failure.cause=failure_unknown_side_effect`、`failure.code=output_contract_invalid`、`failure.retryable=auto_backoff`；无候选落库。

### 8.2 快捷 scratch 规则的证伪（不交付生产补丁）

在隔离 scratch 树（detach `0536a44`）对 `server/lib/task-scheduler.mjs` 临时加入「`test` 类型＋零回执 ⇒ `proven_safe`」的快捷规则（`SCRATCH SHORTCUT` 标记），运行后逐字节回退。结果：正控由红转绿（快捷规则满足了它），而未可信来源负控转红——`an untrusted execution source must never be promoted to proven_safe`（actual `proven_safe`／expected `unknown`）。即该负控确实抓住 type＋零记录捷径，而真实 Pi 正控不能被脚本化工厂代签。

### 8.3 now 接缝头注更正

原头注称 `TaskService.now` 是「生产入口已使用的构造选项」；实际 `server/entries/web-backend-entry.mjs` 构造 `TaskService` 时未传 `now`（用默认）。已更正为「生产入口未传 `now`，依赖默认；本回归只赋值该既有实例属性，不新增生产开关」。

### 8.4 结果

命令：`node --test --test-timeout=20000 --test-reporter=tap tests/unit/web-text-intake-test-safety.test.mjs`

两轮独立运行均为 `tests 3 / pass 2 / fail 1`，退出码 1；红仍是 GAP-TEST-SAFETY-1 正控。未可信来源负控约 4.4s ≪ 20s；运行后零残留进程／临时根。
