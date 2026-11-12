# MAYNE-35 后端消费者 / 恢复 / API2 线域候选（2026-11-11，Claude）

## 0. 性质与身份

接 MAYNE-35 修复复审 §4 的有界后端候选：把 typed 退出证据接进任务服务、调度、恢复与全局线域信封。这不是 E 完成声明，不是最终组合门禁。

- 输入：D 后端 `8b6052b5f54f3f4dff89e46a1a49bd852c7b68da`（tree `883930de…`）、producer `5f3f6563…`、冻结规范/55 样例 `0c9febc5…`（SHA-256 `449bf0b0…f2cd`）。
- 任务分支 `agent/claude/mayne-35`，起点 `5f3f6563…`；按路径接收 D 的 `server/`、`tests/`、`src-tauri/` 迁移与 Rust store、`scripts/checks/check-structure.mjs` 作为**基线**（未修改），其哈希登记在 `build/mayne35-exit-consumer/admission.json`。
- 写域：`server/lib/task-service.mjs`、`task-recovery.mjs`、`task-scheduler.mjs`、`text-intake-service.mjs`、`worker-host.mjs`、`http-server.mjs`（经共享版本）、`sse-hub.mjs`、`manual-items-service.mjs`、`static-files.mjs`、`server/entries/web-backend-entry.mjs`；新增 `tests/unit/attempt-exit-consumer.test.mjs`、`tests/integration/attempt-exit-consumer.test.mjs`；本人记录与 `build/mayne35-exit-consumer/`。

## 1. 落地要点

- **typed verdict 显式判别**：`confirmExit`/`confirmExtractExit`/`confirmReviseExit` 新增 `evidence` 选项；提供时按 `evidence.verdict === 'registry_extinct'` 判别，缺失/非确认一律 fail closed。调度器 `onWorkerDone` 改为消费 `workerHost.observeAttemptExit(runId)` 的 typed 证据，不再用 V1 `treeVerified` 布尔放行。
- **证据持久化与线域**：`TaskService` 新增 `root`，把证据落在 attempt 的 run 目录（`runs/<runId>/attempt-exit-evidence.json`，无 schema/migration）；`wireFrom` 仅在 `exited_*` 态读取并在资源上暴露 `attemptExitEvidence`（终态不清除，缺失/损坏显示 null）。
- **恢复先重验/清扫后释放**：`TaskRecovery.recover` 对每个未完结 attempt 先 `observeAttemptExit` 重验、`runStraySweep` 重跑清扫、再复验，只有 `registry_extinct` 才分类释放；无 worker-host/记录时保留 V1 liveness 前提（不冒用 registry 判定）。
- **来源守卫**：`registerAttemptMembers` 拒收帧源白名单之外的 `sourceFrame`（如 `argv_scan`），argv 永不反向创建登记。
- **全局 API2**：共享 `CONTRACT_VERSION` 升 `web-api/2`；`static-files` 404 硬编码同步；SSE `task.changed` 增 `attemptExitState`。
- **保留**：任务/attempt/epoch/条目版本与 ACK 围栏、暂存成功/失败原结局、分段读取门、命名空间/attemptId 归属均逐字未改。

## 2. 验证（本轮实际执行）

- 新增消费者单测 4/4、集成 1/1：版本/证据线域、known-survivor 否决（`exited_unknown`＋resolve 409）、缺失证据 fail closed、证据持久化/损坏读回、SSE `attemptExitState`、404 信封。
- 既有聚焦回归：producer 29/29、lifecycle 10/10、events 11/11、recovery 69/69；消费者并集 55/55。
- `npm run check:docs` exit 0（22 文件/527 链接）；`git diff --check` 干净；受影响文件 `node --check` 通过。
- 队列套件（II）：14–15/17。**T-7**（重启回收断言 `ended_at`）与 **two clients**（第二个配对码）为 D 基线固有/待裁项，非本轮引入；**GAP-3** 在满负载下偶发超时（单跑通过）。

## 3. 边界

- 未改 DDL/Rust/Runtime/vendor/package/依赖、冻结规范/样例、前端、公共索引/product05、main/远端/真实凭据/用户根。
- 未跑完整 check/19 旅程；不自签 E 完成。交精确 SHA/tree、最小差分与原始证据回独审。最终组合新全门禁、原样旅程与主线接收仍归 MAYNE-34。
