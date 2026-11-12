# W1 故障取证：401 与「10s 未终结」样本（Pi，2026-11-09）

> 只读取证，不改生产／测试／Runtime，不扩大预算，不跑完整门禁。本记录不自签任何测试修改。
> 派发：MAYNE-24 协调评论 `01a1bed3-d78d-74c7-b6ad-20d2bbe04950`。

## 1. 范围与基点

- 生产基座：Kimi 分支 `agent/kimi/mayne-24` 的锁定 D1 批 tip `681c2825bb053b740cc7fdfd7133e75384389139`（tree `754b790811d8c09732463cafdf6e93d4feff0284`）。`server/lib/{task-service,text-intake-service,task-scheduler,worker-host}.mjs` 与 `server/entries/web-backend-entry.mjs` 均按该提交字节调用。
- 运行时：默认真实 Pi bundle `build/s0-runtime`（organizer `08f32db2…`、node `9d050fd4…`、provenance `ad702637`/`e89822b0`）。
- 存储：`web-backend-storage` 2649408 B／`42af54b5…490fc2`。
- 测试候选（被观察对象）：Pi `45b1cfeec397001aef2092a4fe1e9a259a891995`（tree `b6af1ae7cd6e7bc4be01c0f42b31fb606ce2f166`），其 `runFaultCase` 用 `TERMINAL = ['succeeded','failed','cancelled']` 轮询。
- 夹具：`tests/fixtures/web-text-intake/*` 取 `681c282`（与 II r5 `61a069b` 的核心夹具逐字节相同）＋ `model-config.mjs` 取 `7f3322b`。

## 2. 方法

一条自包含 harness（`forensics/probe.mjs`，见证据包）在隔离 scratch 树（`/tmp/mayne24-pi-forensics`，detach 于 `681c282`）中运行，全程只用 loopback 受控模型服务与内存受控凭据：

- **Leg C（直驱）**：以与后端同形的请求直接拉起真实 `organizer.mjs`，不经过后端、无 seam，观察 Runtime 自身发出的帧。
- **Leg A/B（后端链）**：`POST /api/text-sources` → 真实调度 → 真实 WorkerHost → 默认真实 Pi → loopback 受控服务；轮询任务状态并只读观察库。唯一注入是契约允许的私有 `workerProcessFactory` seam，且只做**纯 stdout tee**（在真实子进程上多加一个 `data` 监听，不替换 spawn／请求／运行时／任何生产判据）。

## 3. Leg C：Runtime 自己的 error 帧

| 受控服务响应 | Runtime 末帧 | 退出码 |
|---|---|---|
| HTTP 401 | `{"type":"error","code":"MODEL_AUTH"}` | 1 |
| HTTP 429 | `{"type":"error","code":"MODEL_RATE_LIMIT"}` | 1 |

来源：`runtime/entries/organizer-entry.mjs:54-55` 的 `category()` 正则（`\b401\b|\b403\b|unauthori|authentic|invalid.*key` → `MODEL_AUTH`；`\b429\b|rate.limit` → `MODEL_RATE_LIMIT`），末帧在 `:140` 发出。

## 4. Leg A：401 的后端链

后端 WorkerHost 的 stdout tee 捕获到与 Leg C 相同的帧（同一 runId/hostNonce）：

```
{"type":"progress","phase":"model", ...}
{"type":"error","code":"MODEL_AUTH", ...}
```

任务状态时间线（HTTP 轮询，25ms 间隔）：`queued → running → needs_review`（本轮未采到瞬态 `failed`；库内事件证明其存在，见下）。

库内终态：

- `tasks.state = needs_review`，`attempt_exit_state = exited_confirmed`，`result_pending_exit = 0`，`terminal_at = NULL`。
- `tasks.failure = {"code":"worker_lost","message":"整理进程未返回结果。","retryable":"manual","sideEffectSafety":"unknown","cause":"failure_unknown_side_effect"}`。
- `task_attempts`：`ended_at = exit_confirmed_at`、`exit_reason = confirmed`（进程树已核实退出）。
- `task_events`：cursor 3 = `task.changed{state:'failed'}`，cursor 4 = `task.changed{state:'needs_review'}`——**`failed` 与 `needs_review` 是两次独立事务**，间隔约 1ms。
- `recovery_items`／`recovery_holds` 均空；任务级 `needs_review` 由 `maybeAutoRetry` 直接落库，不产生恢复项。

## 5. Leg B：429「10s 未终结」样本

后端 stdout tee 帧：`progress{phase:'model'}` → `error{code:'MODEL_RATE_LIMIT'}`。

任务状态时间线：`queued → running → failed → needs_review`（`failed` 在 `19.025Z`，`needs_review` 在 `19.053Z`，间隔 28ms）。库内终态与 Leg A 完全同形：`needs_review`＋`worker_lost`／`unknown`／`exited_confirmed`。

**结论：该样本不是「真正仍运行」。** 任务在约 200ms 内已终结到 `needs_review`；轮询结束时 `findOrganizerWorkers(process.pid)` 为空，attempt 行已关闭且 `exit_reason=confirmed`。测试套件用 `TERMINAL = ['succeeded','failed','cancelled']` 轮询，**`needs_review` 不在其中**，因此即使任务已稳定，轮询仍一直等到 10s 上限才抛 `pollUntil deadline`——这正是 TAP 中 429/500/断流/服务死亡/不可达/非法输出/空候选等用例统一「10s 未终结」的机制。

## 6. 根因链（源码锚点，`681c282`）

1. **Runtime 发出真实 error 帧**：`runtime/entries/organizer-entry.mjs:54-55,:140`。
2. **WorkerHost 收到并保存**：`server/lib/worker-host.mjs:355` `state.errorFrame = frame`；`:397` 退出时把 `state.errorFrame.code` 放进 `done` 的 payload。
3. **调度器丢弃 payload**：`server/lib/task-scheduler.mjs:232` 解构出 `payload`，`:248-252` 计算 `effective`，但 `:269` 调 `confirmExtractExit` 时只传 `{exited, cancel, epoch, deadlineTriggered}`——**`effective.payload` 从不传入**。
4. **收尾硬编码 worker_lost**：`server/lib/text-intake-service.mjs:864-866`：
   ```js
   const failure = deadlineTriggered
     ? normalizeFailure({ code: 'model_timeout', message: '整理超出后端时限。' })
     : normalizeFailure({ code: 'worker_lost', message: '整理进程未返回结果。' });
   ```
   只要没有暂存结局且非 deadline，一律 `worker_lost`，**不看 error 帧码**。
5. **二次丢失**：即便把 payload 传下去，`server/lib/task-service.mjs` 的 `FAILURE_CODE_ALIASES` 也没有 `MODEL_AUTH`／`MODEL_RATE_LIMIT`／`MODEL_NETWORK`／`MODEL_SERVICE`，`normalizeFailure` 会落到 `DEFAULT_PUBLIC_FAILURE_CODE = 'worker_lost'`（`task-service.mjs:44-67`）。
6. **安全路由转 needs_review**：`confirmExtractExit` 先落 `failed`（`text-intake-service.mjs:864-878`），随后 `onWorkerDone` 调 `maybeAutoRetry`（`task-scheduler.mjs:283-286`）；`maybeAutoRetry` 见 `sideEffectSafety !== 'proven_safe'` → `markNeedsReview(..., {exited:true})` → `needs_review`（`task-service.mjs:810-819`）。

因此：**已有 error 帧确实被当成「零帧死亡」重写为 `worker_lost`**；401 的真实码 `MODEL_AUTH` 与 429 的 `MODEL_RATE_LIMIT` 都没有进入公开信封。测试对 401 期望 `auth_or_config_invalid`、对 429 期望 `model_request_failed`／`auth_or_config_invalid`，在当前生产码上必然红。

## 7. 证据包

随派发评论附件交付，原始文件在 gitignored `build/mayne24-pi-forensics/package/`：

| 文件 | 内容 |
|---|---|
| `probe.mjs` | 自包含 harness（tee seam 已声明；合成密钥已脱敏） |
| `run.log` | 本轮运行日志（路径已脱敏） |
| `direct-401.json`／`direct-429.json` | Leg C 直驱帧与退出码 |
| `model-401-backend.json`／`model-429-backend.json` | Leg A/B 的 submit、状态时间线、库内行、事件、模型请求、worker 帧 |
| `worker-stdout-401.log`／`worker-stdout-429.log` | 后端 WorkerHost stdout tee 原始帧 |
| `identity.txt` | 提交／树／运行时／存储身份与环境变量 |
| `SHA256SUMS.txt` | 包内哈希（本机 `shasum -a 256 -c` 9/9 OK） |

脱敏：合成密钥值替换为 `<SYNTHETIC_KEY>`；`/Users/…` 替换为 `<HOME>/…`；scratch 树替换为 `<SCRATCH>`。worker 帧含 `runId`／`hostNonce`（非机密围栏值）；模型请求记录只含 `authorizationLength`，不含 Authorization 值。

## 8. 边界

- 只读取证：未改生产／测试／Runtime／DDL／package／守卫；未提交任何修复；未跑完整 `npm run check`；未触真实模型／凭据／用户根。
- 本记录不自签 Pi 自己的 B1/B2/C1 测试修改，也不代签任何生产候选。
- 观察范围限 401 与 429 两个样本；其余 fault 用例的「10s 未终结」按同一机制推断（同一 `confirmExtractExit` 路径），未逐一复跑。
