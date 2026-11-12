# MAYNE-35 后端候选限定修复（2026-11-12，Claude）

## 0. 性质与身份

接 MAYNE-39 独审（3×P1）与交付审核（A1/A2）的限定修复。冻结规范 `0c9febc`、producer `5f3f656`、D `8b6052b`、已审客户端 `329ea3f` 均保留；D/E 批准不重问。

- 受审候选：`4fc5b0c68cd2fac8e812afc1129beacd273e1a32` / tree `9ed060abf1dc99d07726c88e6ab7039f54e37e0b`。
- 任务分支 `agent/claude/mayne-35`，起点 `f59c26537b008c0dd20a046a80bd6f42091c1edc`（含上一轮部分编辑的自动提交）。
- 写域：`server/lib/task-service.mjs`、`task-recovery.mjs`、`task-scheduler.mjs`、`text-intake-service.mjs`、`worker-host.mjs`、`http-server.mjs`、`sse-hub.mjs`、`server/entries/web-backend-entry.mjs`；`tests/unit/attempt-exit-consumer.test.mjs`、`tests/integration/attempt-exit-consumer.test.mjs`、recovery/lifecycle/events/queue 邻域与 `tests/fixtures/web-text-intake/*`；本人记录与 `build/mayne35-exit-consumer-repair/`。

## 1. 逐项修复

- **F-1（P1）回收不可达**：`unfinishedAttempts` 现在按 `attempt_exit_state='exited_unknown'` 收录（要求该 attempt 是任务的最后一个 attempt），不再受 `task_attempts.ended_at` 限制——已 park 且行已关的历史形态可被重扫。未确认 park 不再把行记为 `exit_reason='confirmed'`（`closeAttempt` 参数化原因）。
- **F-2（P1）恢复回退 fail-open**：无 host observer/无 worker 记录/证据不可得时，`recover` 一律记为**证据不足**（`exit_evidence_unavailable` / `exit_unverified`），不再写 `exited_confirmed`、不再开裸 `resolve`；`classify` 无 `registry_extinct` 证据直接返回。取消/非取消/暂存成功/失败方向一致。**合法未启动**（无模型/无凭据的 launch 预检）单独走 `confirmNoWorkerExit`：以退化 typed 证据（`total=0`，冻结 §3.1 合法 B(a) 形状）确认，永不使用旧 boolean。
- **F-3（P1）快照同形**：`GET /api/snapshot` 补齐 `generatedAt`、`settings{agentConcurrency,version}`（与设置端点同一设置行）、`workspace{mode,currentRoot{id,label},capabilities,recovery}`；顶层 `agentConcurrency` 与 `settings` 同源同值；`epoch/highWatermark/lastEventId`、全量分页与水位优先次序保留。真实 HTTP 输出已喂给已审客户端 `readSnapshot`（通过），缺 `generatedAt` 的负例被拒（`contract_shape`）。
- **A1（P1 风险）完整证据与归属门**：`confirmExit`/`confirmExtractExit`/`confirmReviseExit` 不再只信 `evidence.verdict`；新增 `validateExitEvidenceFor`——结构 + 不变式 + `registry_extinct` + **持久化归属一致**（必须是同一份落盘记录）。伪造/截断/自相矛盾/错归属/晚到旧观察一律 fail closed。
- **A2（P1 风险）持久化顺序**：新增 `persistAttemptExitEvidenceStrict`——写入后**重读字节核对**，写失败/重读失败/不符都返回 false；调度器与恢复在释放/事件/可见前调用它，失败即 evidence=null（fail closed），不再 best-effort 吞掉后按内存判定。覆盖真实 EISDIR（证据路径为目录）、坏文件、重读失败。
- **P2/A3**：`classify` 收尾写 `markAttemptExitConfirmed`（记录 `exit_confirmed_at`，不关行——resolve 才终结），并加 `attempt_exit_state!='exited_confirmed'` 幂等前置（重复扫描不推进版本/重发事件）。T-7 归因以代码证据为准。

## 2. 测试适配（冻结 V2 内最小适配，已明确授权）

- `recovery-authority` 夹具新增**合成合法观察**（无 host observer 时的退化 `registry_extinct`）并在 `claimNext` 后播种 run 记录；`TaskService` 补 `root`。**保留缺观察者反控**（新 `MISSING OBSERVER counter-control`：无 observer ⇒ `recovered:0`、`exited_unknown`、resolve 409）。
- Y1/Y2/Y3 的 `classify` 直接调用补合成证据（原本验证版本/并发语义）。
- `recovery` 单测的 `TaskService` 补 `root`。
- lifecycle/events 的 `TaskService` 补 `root`（证据落盘域）。
- 队列套件第二个 `pairAdditionalClient` 的索引修正（原索引 1 已被首个用例消费，属测试自身缺陷，非业务放宽）。
- 新增消费者单测 6 例（原 4 例）：伪造证据 fail closed、持久化失败（EISDIR）fail closed。

## 3. 验证（本轮实际执行）

- 消费者单测 6/6、集成 2/2（含已审客户端 `readSnapshot` 正/负例）；producer 29/29、lifecycle 10/10、events 11/11、recovery 69/69（含缺观察者反控）；并集 **128/128 pass**。
- 队列套件 **17/17 pass**（T-7 与全部 B(a) 退出语义用例）。
- `npm run check:docs` exit 0（22 文件/527 链接）；`git diff --check` 干净；受影响文件 `node --check` 通过。
- 未跑完整 check/19 旅程（任务书排除）；不自签 E/W1 完成。

## 4. 未验与边界

- 真实 OS EPERM/拒绝仍为 adapter 模拟（证据 `simulated` 明注）；实机标定留后继。
- 证据落盘为**每 attempt run 目录**（无 DDL/迁移）；极端根目录不可写时 fail closed（不释放）。
- 未改 DDL/Rust/Runtime/vendor/package/依赖、冻结规范/55 样例、前端、公共索引/product05、main/远端/真实凭据。最终组合新全门禁、原样旅程与主线接收仍归 MAYNE-34。
