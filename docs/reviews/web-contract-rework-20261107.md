# W0 Web API 契约返工记录（MAYNE-19 第二轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md` 与 `tests/fixtures/web-contract/`。
- 基座候选：`agent/opencode/mayne-17` 的 `7ade73760058708963edfcca1a6d577a38ec5059`（第一轮返工后仍被两份独立只读评审 BLOCK 的版本）。本轮**以该候选为基座**修订，不另起一版，便于复审逐项核对关闭情况。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）；契约版本保持 `web-api/1`，本轮改动均为**兼容追加与语义澄清**（新增字段、新增 recovery cause、新增端点与场景），未改写已冻结语义。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| B1 | P1 | 退出未确认即转 `needs_review` 并释放槽，可能突破并发上限 | 新增任务资源字段 `attemptExitState`（`not_started`/`active`/`exiting`/`exited_unknown`/`exited_confirmed`）；**槽位改为跟随进程退出确认**而非业务状态（§3.2）。`cancelling` 退出无法确认 → `needs_review` 且 `attemptExitState=exited_unknown`，**槽位保持占用**、`resolve` 拒绝、不得补发；仅新实例恢复扫描确认旧进程树已退出后回收（§3.4）。新增 `cancel_exit_unconfirmed` recovery cause 与场景 19 |
| B2 | P1 | 自动重试仅按失败码放行，缺少副作用安全证明 | 失败信封新增 `sideEffectSafety`（`proven_safe`/`unknown`/`proven_unsafe`）；`auto_backoff` 只是必要条件，调度器自动重入队还要求 `sideEffectSafety=proven_safe`，否则转 `needs_review`（§3.2、§4.6）。安全证明由 `side_effect_receipts` 台账判定：存在 `provable_readonly=false` 且失败点在其之后即无法证明。新增 `failure_unknown_side_effect` cause 与场景 20 |
| A1 | P1 | 成功结果只有 `result://…/payload`，没有读取端点或解析映射 | 新增 `GET /api/tasks/{taskId}/result` 与 §4.3：定义 `result://` 为后端解析 scheme、响应信封 `{contractVersion, taskId, kind, payload, payloadRef?, acceptedByAttempt, completedAt}`、内联/有界 `Range` 读取、错误 `state_conflict`/`result_not_found`。场景 1 改为**同一 `taskId`** 贯穿 提交 → running → succeeded → 结果读取（§11、新增 `task-result-read-200.json`） |
| A2 | P2 | 固定 `configRevision` 与“修正配置后 retry”冲突 | §4.5 定义 `retry` 的可选 `configRevision`：仅 `auth_or_config_invalid`/`config_revision_unknown` 可变更，变更后 `configRevision` 更新、`originalConfigRevision` 保留、写事件历史并递增版本；其他失败码携带即 409 `config_revision_change_not_allowed`。凭据引用不经 retry 切换。新增 `task-retry-new-config-202.json`、`error-config-revision-not-allowed-409.json`、场景 21 |
| A3 | P2 | 领取先发生时，取消响应同时被规定为 409 与 202 | §4.4 统一：`expectedVersion` **可选**。携带 → 严格校验，过期 409（场景 7）；省略 → best-effort 条件更新，响应如实反映最终态（场景 6）。明确“旧版本 409 → 读回 → 新版本 202”的两步时序，禁止同一时序签署两种预期 |
| B3 | P2 | 恢复报告 `needsDecision` 与明细不符；取消意图被当作取消完成 | 两份 hold 报告的 `summary` 与明细对齐（`needsDecision` = `verificationState=pending` 条目数）；新增 `pendingCancelIntent` 字段并定义其为“`cancelIntent=true` 且仍 pending”，**单独报告、不从 `needsDecision` 扣减**；`auto_safe` 不需要处置。新增 `summaryNote` 说明口径 |
| C1 | P2 | `recovery` union 不能表达备份恢复与已有根激活 | §3.5 新增 `backup_restore`、`root_activation`、`root_import` 三个 cause，携带 `holdId`/`itemId`（`root_activation` 另含 `historyContinuity`）；定义任务 `resolve` 与 hold 条目 `resolve` 是同一操作（§3.5、§8.3）。新增 `task-recovery-backup-restore.json`、`task-recovery-root-activation.json`、场景 22 |
| C2 | P2 | restore 缺少响应丢失读回入口与 `operationId → holdId` 发现 | §8.2 新增统一 `GET /api/workspace/operations/{operationId}` 与 `GET /api/workspace/restore-operations/{operationId}`；定义 restore 202 同步返回 `holdId`，hold 创建前不做数据变更；未知操作 → 404 `operation_not_found`，不得盲目重提。新增 `workspace-restore-operation-pending.json`、场景 23 |

前轮（2026-11-06）P1×4、P2×3 的关闭情况以 `docs/reviews/web-contract-revision-20261107.md` 为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、359 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=34 parseFailures=0 contractVersions=web-api/1` |
| 任务资源字段完整性与槽位语义 | `python3 build/web-contract-20261107/verify.py` | exit 0：34 样例、15 个完整任务资源、62 条链接；`cancel_exit_unconfirmed` 与 `exited_unknown` 一一对应 |
| 快照/事件一致性 | 同上 | exit 0：游标 ≤ `highWatermark` 的任务事件与快照条目状态/版本一致 |
| hold 汇总一致性 | 同上 | exit 0：`needsDecision`/`autoSafe`/`pendingCancelIntent` 与明细逐项对齐 |
| 场景 1 链路同任务 | 同上 | exit 0：提交、running、succeeded 共用 `tsk_1a2b…` |
| 样例引用完整性 | 内联检查 | exit 0：34/34 样例被契约文档引用，无缺失引用 |
| `git diff --check` | `git diff --check` | exit 0 |

样例解析命令原文：

```sh
node --input-type=module -e "
import { readdirSync, readFileSync } from 'node:fs';
const dir = 'tests/fixtures/web-contract';
let n = 0, bad = 0; const versions = new Set();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  n++;
  try { const j = JSON.parse(readFileSync(dir + '/' + f, 'utf8')); versions.add(j.contractVersion ?? '(missing)'); }
  catch (e) { bad++; console.log('PARSE FAIL', f, e.message); }
}
console.log('files=' + n + ' parseFailures=' + bad + ' contractVersions=' + [...versions].join(','));
process.exit(bad || versions.size !== 1 ? 1 : 0);
"
```

交付内容哈希清单（37 个文件，含契约文档、两份既有记录与 34 个样例）见忽略目录 `build/web-contract-20261107/delivery-manifest.json`，其自身 SHA-256 为 `7966da8fc6267cd03509cc53a0ba105c61fdb9e0d6a5781a4ad95fe4b04b10a7`。平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；新增字段与端点是契约约定，实现切片接入时以其为测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、34 个样例可解析且版本一致、文档链接守卫通过、本轮驳回清单逐项有对应修订与样例。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
