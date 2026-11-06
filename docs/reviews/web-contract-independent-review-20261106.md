# W0 Web API 契约独立复核（MAYNE-19）

## 范围与结论

- 被评审修订：`agent/opencode/mayne-17` 的 `9750467af98cd151c7855fca6f43325ef168932f`，相对 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 共 23 个文件、888 行新增。
- 评审请求：判断任务交付能否完成并合入主分支；不可时按 P0–P3 给出原因。
- 影响面：R3。交付虽只含文档与合成样例，但定义了跨进程公共契约、认证/代理边界、持久队列、取消/恢复和 SSE 补偿，后续实现会按它执行。
- 评审面：Codex，未参与实现。本记录只作独立复核，不修改被评审产物，也不代表契约冻结或实现通过。
- 结论：**BLOCK / 驳回**。存在 4 个 P1 契约问题，不能合入主分支。

## 实际验证

| 检查 | 结果 |
|---|---|
| 从 `9750467` 归档后运行 `node scripts/checks/check-docs.mjs` | exit 0，18 个文件、336 条本地链接通过 |
| 21 个 `tests/fixtures/web-contract/*.json` 解析与 `contractVersion` 汇总 | 21/21 可解析，版本唯一为 `web-api/1` |
| 按快照 `highWatermark` 重放事件并与快照任务状态比较 | 发现 `tsk_1a2b3c4d5e6f708192a3b4c5d6e7f809` 在游标 1042 已是 `cancelling`/v3，快照仍为 `running`/v2 |
| 按契约字段抽查任务资源、provider、恢复对象 | 发现下方列出的字段和样例不一致 |
| `git diff-tree --check` 与 commit 范围核对 | 通过；改动均在任务允许的契约、样例和本任务记录路径 |

未运行服务端点或真实代理/凭据验证，因为本任务明确只交付契约提案，没有实现。

## 发现项

### P1：代理模式错误地禁止备份恢复

- 证据：`docs/engineering/web-api-contract.md:176` 规定代理模式对“任何切换/恢复请求”返回 403，`tests/fixtures/web-contract/workspace-switch-denied-403.json:6` 也明确写为 root switching and restore are refused。
- 违反：`docs/engineering/web-backend-design.md:43` 与 `docs/product/02-用户流程.md:26` 规定代理模式只拒绝工作根切换，仍允许已认证业务会话创建、下载和恢复已校验备份。
- 影响：按本契约实现会使 Linux 代理部署无法完成 F14/W5 的备份恢复，直接删减已承诺能力。
- 修正：把工作根切换与备份/恢复拆成不同 capability 或明确不同授权条件；场景 15 只拒绝切换，并补代理模式可执行备份恢复的成功/拒绝边界。

### P1：SSE 跨实例重连无法判断或处理 epoch 变化

- 证据：`docs/engineering/web-api-contract.md:14` 把 cursor 定义为实例内单调；`:157` 要求以整数 `Last-Event-ID=highWatermark` 重订；`:158` 又规定跨 epoch 必须走快照。但重连请求不携带 epoch，也没有首帧 `stream.ready/reset` 语义。
- 影响：新实例 cursor 可能从较小值重新开始。客户端保留旧 epoch 的较大 cursor 时，会忽略新实例事件或无法触发快照，页面可长期停在旧状态。
- 修正：定义可识别 epoch 的重连令牌/头（例如 `Last-Event-ID=<epoch>:<cursor>`），或规定每次订阅先发送带 epoch 的 ready/reset 帧；明确跨 epoch 无条件快照重同步。

### P1：高水位快照样例与权威状态冲突，且不是“全量”任务资源

- 证据：`tests/fixtures/web-contract/sse-events-sample.json:33-45` 在 cursor 1042 已将任务推进到 `cancelling`/v3；`tests/fixtures/web-contract/snapshot-high-watermark.json:4-17` 的 highWatermark 同为 1042，却仍返回同一任务 `running`/v2。
- 证据：契约 `docs/engineering/web-api-contract.md:41` 说所有任务类响应用同一资源形状，`:143` 称快照为全量快照；快照中的任务却缺少 `contractVersion`、`operationId`、`type`、`role`、`configRevision`、`inputRef`、`result`、`failure`、`recovery` 等字段。
- 影响：客户端按“快照 + highWatermark 重订”恢复时会丢掉游标 1042 的取消状态，也没有足够字段重建任务资源。
- 修正：让快照包含 highWatermark 之前的最新权威状态及完整的已声明投影；若有意提供精简投影，单独定义快照 DTO 和补全路径，不得声称与任务资源同形。更新样例并增加语义一致性检查。

### P1：`auth_or_config_invalid` 的 retryable 与手动重试契约矛盾

- 证据：`docs/engineering/web-api-contract.md:121` 将该失败码标为 `retryable=none`，同句又要求修正配置后用户调用 `retry`；`:109` 则只允许 `retryable=manual` 的任务调用 retry。
- 影响：该失败任务按接口守卫永远无法手动重试；实现方若放行又违反另一条契约，客户端无法得到稳定行为。
- 修正：将“是否自动重试”和“是否允许用户手动重试”拆开，或把 `auth_or_config_invalid` 明确设为 `manual`（仍禁止自动退避）并统一状态迁移、接口守卫和样例。

### P2：事件台账与 recovery 对象不足以生成已声明契约

- 证据：`docs/engineering/web-api-contract.md:155` 声明 `task.changed/task.progress/settings.changed/workspace.changed/recovery.changed` 共用事件流；`:263` 的 `task_events` 只有 `task_id`，没有事件所需的对象类型/对象 ID/作用域字段。
- 证据：`:60` 未定义 `recovery` 对象结构；`task-interrupted.json:25-32` 与 `task-needs-review.json:26-41` 两个同名字段分别使用 `resumeEligible` 和 `decisionOptions`，客户端无法形成稳定类型。
- 影响：实现必须自行猜测非任务事件如何落库、如何形成 SSE 信封，以及不同恢复状态下客户端的判断字段。
- 修正：把事件表定义为通用 `object_type/object_id/object_version` 流，或分别定义各域事件表及统一投射；为 recovery 定义 discriminated union/统一字段，并让两个样例遵循同一 schema。

### P2：验收要求的场景样例不完整或指向错误类型

- 证据：场景 1 要求 `succeeded + result`（`docs/engineering/web-api-contract.md:237`），但只链接 `task-resource-running.json`，没有任何成功终态或 result 信封样例。
- 证据：场景 11 是已有根/退役源根激活（`:247`），却复用 `recovery-hold-report.json`；该样例 `cause=backup_restore` 且只有 `restoredFromBackupId`，没有 root activation、A→B→A 或已有根连续性证据。
- 影响：任务要求覆盖的“用户看到结果”和“旧根”缺少可校验样例，后续实现可产生与矩阵文字不同的 DTO。
- 修正：增加成功终态/result 样例和独立的 root activation 恢复样例，并让矩阵逐项指向语义匹配文件。

### P2：若干字段样例违反字段定义

- 证据：`docs/engineering/web-api-contract.md:164` 要求 provider 含 `authMode`，`providers-capability.json:10-33` 的三个 provider 均为 `apiFormat` 且没有 `authMode`。
- 证据：`docs/engineering/web-api-contract.md:54` 把 `cancelIntent=true` 限定为任务尚未终态；`task-cancel-queued-cancelled.json:7,16` 已为终态 `cancelled` 却仍为 true，且 `:81` 的取消迁移只说保留在事件历史。
- 影响：样例不能作为字段级实现依据，测试会固化互相矛盾的字段语义。
- 修正：补齐 provider 的契约字段并决定 `authMode` 与 `apiFormat` 的关系；明确终态是否保留 `cancelIntent`，然后统一字段说明、状态迁移和样例。

## 已检查与显式跳过

- 已检查：规格符合度、公共契约与数据形状、失败/取消/重试语义、SSE 补偿、安全与部署边界、恢复数据模型、仓库结构与文档约定、样例可解析性。
- 显式跳过：端点运行、真实模型/凭据、代理网络、macOS/Linux 原生适配。本项是未实现提案，不能以这些未执行检查宣称实现通过。

## 处置

需要按上述 P1/P2 修订后重新提交独立评审。当前交付不合入 `main`，任务退回修订步骤。
