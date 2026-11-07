# W0 Web API 契约修订记录（MAYNE-19 返工）

## 范围与基点

- 修订对象：`docs/engineering/web-api-contract.md` 与 [tests/fixtures/web-contract/](../../tests/fixtures/web-contract/task-submit-request.json)。
- 修订基点：`agent/opencode/mayne-17` 的 `9750467af98cd151c7855fca6f43325ef168932f`（首轮被驳回候选），本轮在其上追加修订。
- 修订依据：队长 2026-11-06 驳回评论（`01a1b110-3796-7946-ae93-b6fd2789b556`）的全部 P1×4、P2×3，以及独立复核记录 `docs/reviews/web-contract-independent-review-20261106.md`（评审分支 `agent/codex/mayne-19` 提交 `dca8118`）。
- 结论：**7 项全部关闭**；待重新独立评审，本文不构成契约冻结或实现通过。

## BLOCK 清单逐项处置

| # | 驳回发现 | 修订 |
|---|---|---|
| P1-1 | 代理模式错误禁止备份恢复 | §8.1 拆分为两组能力：`workspace.manage`（根切换，仅 local 签发）与 `workspace.backup`（备份创建/下载/恢复，local 与代理均签发）；§8.2 注明 restore 需 `workspace.backup`、双模式可用；§2 会话能力、§10 错误注册表、场景 15 同步改写；样例 `workspace-switch-denied-403.json` 改为仅拒根切换并注明保留能力；新增 `workspace-restore-accepted-202.json` 展示代理模式恢复受理并进入恢复保持 |
| P1-2 | SSE 跨实例重连无 epoch 识别 | §6 重写订阅/重连握手：每帧 `id` 改为 `<epoch>:<cursor>` 重连令牌；每次订阅先发 `stream.ready`（无 `id`）；令牌 epoch 不符/无法解析/游标超留存 → 先发 `stream.reset` 再强制快照重同步；§1 标识行同步；样例 `sse-events-sample.json` 补 `stream.ready`/`stream.reset` 帧、事件帧改 epoch 限定 id，并新增 `settings.changed`/`workspace.changed` 帧展示通用信封 |
| P1-3 | 快照与事件冲突、非全量资源 | §6 明确快照任务条目与 §3.1 资源**同形全字段**，且快照必须包含 `highWatermark` 及之前全部事件的权威状态；样例 `snapshot-high-watermark.json` 重写：`tsk_1a2b…` 在 `highWatermark=1042` 为 `cancelling`/v3（与游标 1042 事件一致）、两个任务均为全字段资源、新增 `lastEventId` 重订令牌 |
| P1-4 | `auth_or_config_invalid` 无法手动重试 | §4.6 改为 `retryable=manual`（禁止自动退避、保留用户 `retry` 入口）；§3.1/§3.2/§4.6/§5 前注统一 `retryable` 三值语义：`auto_backoff`=调度器自动、`manual`=仅用户入口、`none`=终局无重试；retry 接口守卫同步 |
| P2-1 | 事件台账无法承载已声明事件；recovery 无稳定 schema | §12 `task_events` 改为通用对象事件流（`object_type`/`object_id`），索引改 `task_events(object_type, object_id)`，与 SSE 信封一一对应；新增 §3.5 `recovery` discriminated union（按 `cause`：`backend_restart`→`resumeEligible`，`restart_unknown_side_effect`/`cancel_unknown_side_effect`→`decisionOptions`），两个任务样例与 union 规则对齐 |
| P2-2 | 场景 1 缺成功终态、场景 11 复用 backup_restore 样例 | 新增 `task-succeeded-result.json`（`succeeded` + 完整 `result` 信封），场景 1 指向它；新增 `recovery-hold-root-activation.json`（`cause=root_activation`、`historyContinuity=unproven`、A→B→A 语义），场景 11 改为指向它，不再复用 |
| P2-3 | provider 缺 `authMode`；终态 `cancelIntent=true` 冲突 | §7 声明 `authMode`（必填）与 `apiFormat`（可选）的关系；`providers-capability.json` 三个 provider 补 `authMode:"api_key"`；§3.1 明确 `cancelIntent` 终态一律 false、留痕在事件历史；`task-cancel-queued-cancelled.json` 改 false |

自检额外修复：非终态任务样例统一补 `"terminalAt": null`（§3.1 明确该字段恒存在、仅终态非空），涉及 `task-resource-running.json`、`task-cancel-running-cancelling.json`、`task-interrupted.json`、`task-needs-review.json`、`task-submit-replay-200.json`（嵌套 task）。

## 修订后自检（本机实测）

| 检查 | 命令（摘要） | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0；18 文件、343 条链接（含 3 个新增样例的引用） |
| 样例解析与版本一致 | 逐个 `JSON.parse` 24 个 fixture，断言 `contractVersion === "web-api/1"` | exit 0；24/24 通过 |
| 快照/事件一致性 | 重放 `sse-events-sample.json` 中 cursor ≤ 1042 的事件并与 `snapshot-high-watermark.json` 比对 | exit 0；`tsk_1a2b…` 两侧同为 `cancelling`/v3，`lastEventId` 格式正确 |
| 任务资源全字段 | 快照与全部 8 个任务资源样例逐一断言 §3.1 全部 21 个字段存在 | exit 0 |
| 终态语义 | 终态 `cancelIntent=false` 且 `terminalAt` 非空；`cancelling` 保持 `cancelIntent=true`；非终态 `terminalAt=null` | exit 0 |
| provider/recovery/SSE 规则 | `authMode` 必填、recovery union 字段规则、SSE `id` 为 `<epoch>:<cursor>`、`stream.ready`/`stream.reset` 无 `id` | exit 0 |

自检脚本为一次性内联 `node --input-type=module -e` 校验（未入库，属本任务评审证据，不在写入范围内落盘为仓库脚本）。

## 未验项与边界

- 未运行任何服务端点、SSE 流、真实凭据或代理部署：本任务只交付契约提案，无实现可测。
- 契约冻结仍由队长在 W0 阶段末统一宣布（§14）；本文修订不改变授权边界，不涉及 DDL、依赖或锁文件。
- 全量门禁（`npm run check`）由集成负责人在集成版本上串行执行，不在本任务内。

## 交付

修订内容随本次运行平台自动提交落在 `agent/opencode/mayne-17`（父提交 `9750467`），以该分支新 HEAD 为准；按任务边界未自行 commit/push。修复完成后需重新独立评审（原评审者 Codex 未参与实现）。
