# Web API 契约：任务提交到结果查询（W0 提案）

> 状态：**提案（proposal），未冻结、未实现**。本文是 MAYNE-19 的交付物；契约冻结由队长在 W0 阶段末统一宣布，冻结前任何成员不得按本文草案开工实现。契约内容以[Web/后端设计](web-backend-design.md)为设计权威，两者不一致时以设计为准并回改本文。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)。本文只定义接口、字段、错误、状态与边界；不含 DDL、迁移文件、依赖安装或实现代码。第 12–13 节是提案，不是已批准变更。
> 合成样例在 [tests/fixtures/web-contract/](../../tests/fixtures/web-contract/task-submit-request.json)（21 个 JSON，全部携带相同 `contractVersion: "web-api/1"`），逐场景映射见第 11 节。样例用于评审契约形状，不是可运行服务或实测报文。

## 1. 总则

| 项 | 契约 |
|---|---|
| 契约版本 | `web-api/1`；任务资源、事件、快照与错误包络均携带 `contractVersion` 字段。不兼容变更必须升版本并在冻结记录中说明 |
| 传输 | HTTP/1.1 及以上；业务路径前缀 `/api`；请求与响应体为 UTF-8 JSON（SSE 除外） |
| 时间 | ISO 8601 UTC 毫秒（如 `2026-11-06T12:30:00.000Z`）；本地化呈现由前端按工作根时区处理 |
| 标识 | `taskId`=`tsk_<32hex>`；`operationId`=`op_<32hex>`（提交方生成）；`attemptId`=`att_<32hex>`；实例 `epoch`=`inst_<12hex>`；事件 `cursor` 为实例内单调递增整数 |
| 会话 | 配对码经 POST 请求体换短时会话（cookie：HttpOnly、SameSite=Strict、限定 Path、不设 Domain；代理模式强制 Secure）；写请求同时校验会话、CSRF token 与精确 Host/Origin |
| 幂等 | 提交与迁移类请求携带提交方 `operationId`；同 ID 同规范输入的重试返回同一对象的当前权威状态，不重复创建 |
| 响应丢失 | 异步操作一律可按 ID 读回：任务按 `taskId` 或重放 `operationId`，工作根操作按 `operationId`；客户端不得盲目重复提交或迁移 |
| 错误包络 | 见第 10 节；错误体一律 JSON，不含内部路径、SQL、堆栈或秘密 |
| 已移除语义 | 旧实现的 `RUNTIME_BUSY`/409 忙碌拒绝不再是提交契约；满槽一律入 `queued`（场景 4）。恢复、重启或重试流程不得重新引入"忙碌丢任务" |

### 1.1 接收与"未接收"的边界

- 校验失败（400）、会话/来源不合格（401/403）、服务处于恢复保持或关停排水（503 `intake_closed`）时，请求**未接收**：不落库、不产生 `taskId`、不绑定幂等键；服务恢复后可携带同一 `operationId` 重新提交。
- 一旦返回 `202`，任务已落 SQLite：页面关闭、排队满、服务重启均不得使其消失（设计 §5）。

## 2. 会话、配对与跨源边界

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/pair` | POST | 一次性配对码换会话。码仅存在于请求体，不进 URL/日志/metadata；单次有效、5–10 分钟过期、失败限速（401 `pair_code_invalid` / 429 `pair_rate_limited`） |
| `/api/session` | GET | 会话自检：返回 `session`（含 `capabilities`）与 CSRF token。本机 local 模式签发 `workspace.manage`；代理模式不签发（§8） |
| `/api/session` | DELETE | 退出并撤销会话；SSE 断开 |

- 所有非配对请求要求有效会话；写请求另校验 CSRF 与精确 `Host`/`Origin`，不合格返回 403 `origin_rejected` 或 `csrf_invalid`，请求不入队（场景 13）。
- 代理模式：后端只对可信代理（秘密头 + 完整外部 Host/Origin 校验）接受 public origin 语义；秘密缺失即拒绝（403 `proxy_trust_invalid`）。代理认证不代替业务写请求的 CSRF 校验。

## 3. 任务资源与状态机

### 3.1 任务资源字段

`GET /api/tasks/{taskId}` 与所有任务类响应共用的资源形状（样例：[task-resource-running.json](../../tests/fixtures/web-contract/task-resource-running.json)）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `contractVersion` | string | 恒为 `web-api/1` |
| `taskId` / `operationId` | string | 标识；`operationId` 为提交方幂等键 |
| `type` / `role` | string | 任务类型与固定角色（`organizer`/`tracker`/`advisor` 及模型测试类）；类型集合由 W1+ 切片按需扩充，未知类型提交即 400 |
| `state` | enum | 见 §3.2 |
| `version` | int | 任务乐观并发版本；每次状态迁移递增；变更类请求必须携带提交方已见的 `expectedVersion` |
| `createdAt` / `updatedAt` / `terminalAt` | string | 时间；`terminalAt` 仅终态存在 |
| `submitSeq` | int | 实例内持久提交顺序；就绪任务按此 FIFO 领取 |
| `queuePosition` | int \| null | 仅 `queued` 存在；服务返回队列位置，不承诺等待时长 |
| `attemptCount` / `attemptId` | int / string \| null | 已耗尝试数与当前 attempt；每 attempt 只启动一次 worker |
| `cancelIntent` | bool | 取消意图已持久但任务未终态（`cancelling` 或恢复保持中）时为 true |
| `configRevision` | string | 入队时固定的非秘密配置修订；待执行期间编辑/删除配置不影响本任务 |
| `inputRef` | object | 不可变输入引用（inline 或来源引用）；不含秘密 |
| `progress` | object \| null | 运行中进度（阶段、可读描述）；仅展示，不作为业务事实 |
| `result` | object \| null | 终态结果信封：`{kind, payloadRef, acceptedByAttempt, completedAt}`；业务 payload 结构由各业务切片另行定义 |
| `failure` | object \| null | 终态失败信封：`{code, message, retryable, nextAttemptAt?}`，`retryable ∈ auto_backoff / manual / none`；任务级失败码注册表见 §4.6 |
| `recovery` | object \| null | 仅 `interrupted`/`needs_review` 存在，见 §3.4 |

### 3.2 状态集合与迁移

状态集合：`queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`、`interrupted`、`needs_review`。终态：`succeeded`/`failed`/`cancelled`。

| 当前态 | 事件 | 次态 | 守卫与边界 |
|---|---|---|---|
| —（新建） | `POST /api/tasks` 接收 | `queued` | 短事务保存任务、输入引用、配置修订、提交顺序与初始事件；成功才返回 202 |
| `queued` | 调度器领取（原子条件更新） | `running` | 占一个执行槽；事务内写入 `attemptId` + 实例 epoch，执行不在事务内 |
| `queued` | 取消（事务内条件更新） | `cancelled` | 调度器此后不得启动；与领取竞争恰有一个胜出（场景 5/6） |
| `running` | 当前 attempt 提交结果 | `succeeded` / `failed` | 仅接受 `attemptId` 与 epoch 都匹配的结果；晚到结果记审计事件，不覆盖新尝试或终态 |
| `running` | 取消（先持久取消意图） | `cancelling` | 再停止 worker/工具树；槽不释放；不显示"已取消"（场景 6） |
| `cancelling` | worker 退出已确认且无未知副作用 | `cancelled` | 释放槽 |
| `cancelling` | 退出无法确认或副作用未知 | `needs_review` | `cancelIntent` 保持 true；不得自动重入队（场景 9） |
| `running` | 后端重启，旧 worker 已确认停止，无未知副作用 | `interrupted` | 由恢复扫描处置（§3.4，场景 8） |
| `running` | 后端重启，外部副作用结果不明 | `needs_review` | 保留输入与已知回执；禁止自动重放 |
| `interrupted` | 恢复扫描判定可安全重跑 | `queued` | 类型/工具记录证明无外部副作用或仅发送前副作用，且重试预算未耗尽；有界重入队（新 attempt） |
| `interrupted` | 恢复扫描判定未知或预算耗尽 | `needs_review` / `failed` | `failed` 时 `failure.code=worker_lost`、`retryable=manual` |
| `failed` | 自动重试（`auto_backoff` 到期）或用户 `retry` | `queued` | 有界退避；`nextAttemptAt` 未到不阻塞后续就绪任务；认证/配置错误类失败停止自动重试 |
| `needs_review` | `resolve(decision=resume)` 且回执核对完成 | `queued` | 仅用户显式；不自动 |
| `needs_review` | `resolve(decision=cancel)` | `cancelled` | 仅用户显式；取消意图保留在事件历史 |
| 终态 | 同 `operationId` 重放 / 晚到结果 | 不变更 | 幂等返回当前态；晚到结果不入账 |

- `queued` 的取消与领取在同一行上竞争：两个条件更新只有一个生效；取消请求的响应如实反映最终态（赢→`cancelled` 200；输→202 `cancelling`）。
- 槽位核算：仅 `running` 与 `cancelling` 各占一个执行槽；`queued`/`interrupted`/`needs_review`/终态不占槽。
- 没有 `RUNTIME_BUSY` 状态，也没有"忙碌拒绝提交"路径。

### 3.3 幂等、版本与 attempt/epoch fencing

- 提交：`POST /api/tasks` 以 `operationId` 为幂等键。同 ID + 同规范输入 → 返回既有任务当前权威状态（200，`replayed:true`）；同 ID + 不同规范输入 → 409 `idempotency_conflict`（场景 2/3）。规范输入含 `type`、`role`、规范化后的 `input` 与 `configRevision`。
- 变更：取消/重试/处置/并发调整携带 `expectedVersion`；过期返回 409 `version_conflict`，客户端重读后按新版本重新决策（场景 7）。同 ID 重放不消耗版本。
- fencing：结果仅被"当前 attempt"接受（`attemptId` 匹配 + 实例 `epoch` 匹配 + 状态可接受）。后端重启后新实例 epoch 变化，旧实例的任何残留写入一律拒绝。晚到结果以事件留痕（`rejected_late_result`），不产生业务写入。
- 取消不是外部副作用撤销：`cancelled` 不承诺已发出的消息/已写文件被回滚（设计 §5）。

### 3.4 重启与恢复扫描

- 后端重启：`queued` 全部保留；新实例必须先清理/核实上一实例所属 worker 进程树，无法核实则暂停调度并暴露原因，不得按默认并发直接开工。
- 上次 `running` 的 attempt 记为 `interrupted`，随后逐任务扫描：可证无外部副作用（可信任务类型/工具台账证明）→ 有界重入队；副作用未知 → `needs_review`，保留全部已知回执，禁止自动重放。
- 重启时有取消意图的：保留 `cancelling`/`cancelIntent`，确认进程树退出且无副作用未知后才置 `cancelled`；未知则保持取消意图并置 `needs_review`。

## 4. 任务 API

| 端点 | 方法 | 请求 → 成功响应 | 主要错误 |
|---|---|---|---|
| `/api/tasks` | POST | 提交体（样例 [task-submit-request.json](../../tests/fixtures/web-contract/task-submit-request.json)）→ 202 `{taskId, state, version, queuePosition}`（样例 [task-submit-202-queued.json](../../tests/fixtures/web-contract/task-submit-202-queued.json)）；重放同 ID → 200 `{replayed:true, task}`（样例 [task-submit-replay-200.json](../../tests/fixtures/web-contract/task-submit-replay-200.json)） | 400 `validation_failed`/`unknown_task_type`；409 `idempotency_conflict`（样例 [task-submit-conflict-409.json](../../tests/fixtures/web-contract/task-submit-conflict-409.json)）；503 `intake_closed` |
| `/api/tasks/{taskId}` | GET | — → 200 任务资源 | 404 `task_not_found` |
| `/api/tasks` | GET | `?state=&cursor=&limit=`（按 `submitSeq` 稳定分页）→ 200 `{tasks:[...], nextCursor}` | 400 |
| `/api/tasks/{taskId}/cancel` | POST | `{expectedVersion}` → 赢得竞争且原为 queued：200 任务资源（`cancelled`，样例 [task-cancel-queued-cancelled.json](../../tests/fixtures/web-contract/task-cancel-queued-cancelled.json)）；原为 running：202 任务资源（`cancelling`，样例 [task-cancel-running-cancelling.json](../../tests/fixtures/web-contract/task-cancel-running-cancelling.json)） | 404；409 `version_conflict`（样例 [error-version-conflict-409.json](../../tests/fixtures/web-contract/error-version-conflict-409.json)）/`state_conflict`（终态） |
| `/api/tasks/{taskId}/retry` | POST | `{expectedVersion}` → 202 任务资源（`queued`，新 attempt） | 409 `state_conflict`（仅 `failed` 且 `retryable=manual` 可用；`auto_backoff` 由调度器处理） |
| `/api/tasks/{taskId}/resolve` | POST | `{expectedVersion, decision:"resume"\|"cancel", acknowledgedReceipts:[receiptId]}` → 202 任务资源 | 409；400（`acknowledgedReceipts` 未覆盖全部可核对回执时拒绝 resume） |

- 提交体不含秘密：凭据只允许引用形态（§7）；`configRevision` 必须指向已存在的修订，否则 400 `config_revision_unknown`。
- `retry` 与 `resolve` 是仅有的用户驱动重入队路径；`needs_review` 没有"自动恢复"。
- 页面关闭不取消任务；所有操作按 `taskId` + `expectedVersion` 定位，不依赖发起窗口的内存状态。

### 4.6 任务级失败码（`failure.code`）

| code | retryable 默认 | 说明 |
|---|---|---|
| `model_request_failed` | `auto_backoff` | 有界退避重入队；预算耗尽转 `manual` |
| `auth_or_config_invalid` | `none` | 认证/配置错误不自动重试；修正配置后用户 `retry` |
| `credential_unavailable` | `manual` | 执行前解析凭据引用失败；保留可重试输入，不无限占槽（场景 12） |
| `tool_execution_failed` | `manual` | MCP/Bash 明确失败；副作用已知未发生时才可安全重试 |
| `worker_lost` | `manual` | 恢复扫描预算耗尽或不可自动续跑 |
| `output_contract_invalid` | `auto_backoff` | 模型输出不满足结构契约，可安全重试 |

## 5. 并发配置

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/settings/agent-concurrency` | GET | 返回 `{contractVersion, agentConcurrency, default, runningCount, queuedCount}`（样例 [settings-concurrency.json](../../tests/fixtures/web-contract/settings-concurrency.json)） |
| `/api/settings/agent-concurrency` | PUT | `{agentConcurrency, expectedVersion}` → 200；校验正整数，否则 400 `validation_failed` |

- 默认 3；实例级设置，持久保存。
- 上调：立即补发空槽；下调：不杀正在执行的任务，待自然退出后满足新上限。
- 调整不影响既有任务的 `version`；变更以 `settings.changed` 事件广播。

## 6. SSE 事件与高水位快照补偿

| 端点 | 说明 |
|---|---|
| `GET /api/events`（SSE） | 只推送已提交的变化；心跳周期发送注释行；会话过期/代理超时按重连与重认证处理 |
| `GET /api/snapshot` | 全量快照 + 高水位游标；断线补偿入口 |

事件信封（样例 [sse-events-sample.json](../../tests/fixtures/web-contract/sse-events-sample.json)）：

```text
event: task.changed
id: 1043
data: {"contractVersion":"web-api/1","cursor":1043,"epoch":"inst_9f27c1aa40b2",
       "objectType":"task","objectId":"tsk_1a2b…","objectVersion":3,
       "taskState":"cancelling","at":"2026-11-06T12:31:20.000Z"}
```

- 事件携带实例 `epoch`、递增 `cursor`、对象 `objectVersion`；`event` 类型：`task.changed`、`task.progress`、`settings.changed`、`workspace.changed`、`recovery.changed`。
- 短断线：按 `Last-Event-ID` 重放留存期内事件；SSE 留存短期有界，权威状态在 SQLite，事件丢失不能丢任务。
- 补偿规则：游标超出留存、`epoch` 变化或检测到缺口时，客户端调 `GET /api/snapshot` 取带 `highWatermark` 的全量快照，再以 `Last-Event-ID=highWatermark` 重新订阅；快照生成期间发生的变化必须可补发（cursor > `highWatermark`）（样例 [snapshot-high-watermark.json](../../tests/fixtures/web-contract/snapshot-high-watermark.json)）。
- 客户端应用规则：`cursor ≤` 已应用游标或 `objectVersion` 低于本地对象版本的事件直接忽略——不能用旧 `running` 覆盖新 `interrupted`；跨 `epoch` 的事件一律走快照，不就地合并。

## 7. 凭据与 provider 能力

| 端点 | 说明 |
|---|---|
| `GET /api/providers` | 返回 provider 能力与凭据引用状态：`{providerId, enabled, authMode, credentialRefs:[{ref, status: available\|missing\|unavailable, detail?}]}`；不含任何秘密值（样例 [providers-capability.json](../../tests/fixtures/web-contract/providers-capability.json)） |

- 任务入队只保存配置修订与凭据**引用**；秘密在执行前由后端 CredentialProvider 解析，经 run 私有 stdin/环境注入 worker，不进队列、SQLite、argv、配置、日志或 SSE。
- 凭据引用随后端 OS：macOS 本机/壳可用 Keychain 引用；Linux 默认 env 引用，不模拟钥匙串、不生成明文文件。保存当前环境不可兑现的引用（Linux 上保存 Keychain 引用）→ 422 `credential_ref_unsavable`。
- 队列等待期间凭据可撤销；执行时解析失败 → 任务 `failed`（`credential_unavailable`、`manual`），保留可重试输入，不无限占槽（场景 12）。
- 前端禁止回读秘密；API/事件只返回引用与状态。

## 8. 受限工作根管理与恢复

### 8.1 能力模型

- `workspace.manage` 能力由后端在 local 模式会话签发，页面不可自行声明；能力仅允许：查看当前根、列出启动配置允许的目标 ID、提交选定 ID 的切换意图、查询切换结果、创建/下载/恢复已校验备份。不授予任意路径访问、进程启停或控制秘密。
- 代理模式不签发该能力；任何切换/恢复请求返回 403 `workspace_manage_denied`，即使客户端绕过 UI 也不能调用（场景 15）。

### 8.2 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/workspace` | GET | 当前根（逻辑位置）、部署模式、目标白名单、会话能力 |
| `/api/workspace/switch-operations` | POST | `{operationId, targetId, expectedRootVersion}` → 202 `{state:"pending"}`；后端校验会话能力、local 模式、目标白名单与预期版本后以持久操作 ID 执行（样例 [workspace-switch-request.json](../../tests/fixtures/web-contract/workspace-switch-request.json)）。有未终态任务/进行中操作时 409 `workspace_busy` |
| `/api/workspace/switch-operations/{operationId}` | GET | 读回操作结果：`succeeded` / `failed` / `pending`（响应丢失时持续按同一 ID 查询，不提交新的迁移；样例 [workspace-operation-pending.json](../../tests/fixtures/web-contract/workspace-operation-pending.json)） |
| `/api/workspace/backups` | GET / POST | 列出/创建一致性备份；下载经业务会话受限入口 |
| `/api/workspace/restore-operations` | POST | `{operationId, backupId}` → 202；进入恢复保持（§8.3） |
| `/api/recovery/holds/{holdId}` | GET | 恢复报告：暂停面、逐项核对清单（样例 [recovery-hold-report.json](../../tests/fixtures/web-contract/recovery-hold-report.json)） |
| `/api/recovery/items/{itemId}/resolve` | POST | `{decision:"resume"\|"cancel", acknowledgedReceipts:[...]}` 逐项放行（样例 [recovery-resolve-request.json](../../tests/fixtures/web-contract/recovery-resolve-request.json)） |

### 8.3 恢复保持（备份恢复与已有根激活共用）

**备份恢复不是原库重启**；**已有根激活/退役源根再激活/导入根副本适用同一边界**：

1. 打开持久恢复标记（`hold`）：停止新提交（503 `intake_closed`）、停止调度、暂停定时收集/提醒/outbox/补偿投递；确认旧进程树退出并校验恢复数据。
2. 恢复出/激活出的未完成任务全部保留并隔离为 `needs_review`，取消意图保留；不按 `queued` 状态、旧成功回执或定时周期自动重发。
3. 逐项核对：可验证外部回执（如飞书 message_id）核对后才能放行；无法核实的须用户显式选择 `resume`/`cancel`；可证无副作用的只读任务标记 `auto_safe`，但其执行仍等调度恢复后进行。
4. 全部条目处置完毕（或用户显式确认）才关闭 hold、恢复普通调度；不静默删除任务；不承诺重建备份之后发生的外部事实。
5. 验收锚点：备份时 queued → 外部执行成功 → 恢复旧备份，不再执行；A→B 执行外部操作 → 再激活 A，不重发（设计 §5、[分期验收](../product/04-分期交付与验收.md)）。

## 9. 控制通道与退出/清理

- 宿主控制接口（服务发现、退出、任意主机管理）使用独立控制通道与 control token，**不在 `/api` 业务路由内、不经代理暴露、不向页面发放**；业务会话请求退出服务 → 403/404，不执行。
- 正常关停顺序（控制通道触发，样例契约仅记录顺序）：① 停止接收新提交与调度（新提交 503 `intake_closed`）；② 取消/等待运行任务并 reap；③ 关库、释放根锁。队列保留，不走"丢任务退出"。
- worker 生命周期：以父管道/guardian 检测宿主消失；下一实例拿到根锁不等于旧 worker 已停——启动前必须清理/核实，无法核实则暂停调度并显示原因，避免默认 3 实际超发。

## 10. 错误码注册表

HTTP 错误包络：`{"contractVersion":"web-api/1","status":<int>,"error":{"code","message","details"?}}`。

| HTTP | code | 场景 | 客户端处置 |
|---|---|---|---|
| 400 | `validation_failed` | 字段缺失/类型/时间格式非法 | 修正后重试；未消耗幂等键 |
| 400 | `unknown_task_type` / `unknown_role` | 类型或角色不在固定集合 | 不重试 |
| 400 | `config_revision_unknown` | 配置修订不存在/已删除 | 不自动重试；换修订提交视为不同输入 |
| 401 | `unauthenticated` | 无会话/过期 | 重新配对 |
| 401 | `pair_code_invalid` | 配对码错/过期/已用 | 取新配对码 |
| 429 | `pair_rate_limited` | 配对失败限速 | 等待后重试 |
| 403 | `csrf_invalid` | 写请求缺/错 CSRF token | 刷新 token；不入队 |
| 403 | `origin_rejected` | Host/Origin 不匹配（跨源拒绝） | 不入队；不得重试（场景 13） |
| 403 | `proxy_trust_invalid` | 代理秘密/来源校验失败 | 不入队 |
| 403 | `workspace_manage_denied` | 无 `workspace.manage` 能力（含代理模式） | 不重试（场景 15） |
| 403 | `workspace_target_not_allowed` | 目标不在启动配置白名单 | 不重试 |
| 404 | `task_not_found` / `operation_not_found` | ID 不存在 | 不重试 |
| 409 | `idempotency_conflict` | 同 `operationId` 不同规范输入 | 停止重放；换新 ID（场景 3） |
| 409 | `version_conflict` | `expectedVersion` 过期 | 重读后按新版本决策（场景 7） |
| 409 | `state_conflict` | 动作与当前状态不允许 | 重读当前态 |
| 409 | `workspace_busy` | 有未终态任务/进行中迁移时请求切换 | 先处理任务或等待 |
| 422 | `credential_ref_unsavable` | 保存当前环境不可兑现的凭据引用 | 改用 env 引用 |
| 500 | `internal_error` | 未分类服务错误 | 按 ID 重读；不盲目重复提交 |
| 503 | `intake_closed` | 恢复保持/关停排水期拒绝新提交 | 等待；恢复后同 ID 重试 |
| 503 | `backend_unavailable` | 服务不可达/重启中 | 重读 |

## 11. 契约场景矩阵（提交 → 用户看到结果/错误）

| # | 场景 | 触发 | 契约行为（用户可见结果） | 样例 |
|---|---|---|---|---|
| 1 | 正常提交到结果 | 提交 → 领取 → 完成 | 202 `queued` → SSE `task.changed` → `succeeded` + `result` 信封；用户经业务入口看到结果；签收独立于任务成功 | [task-resource-running.json](../../tests/fixtures/web-contract/task-resource-running.json) |
| 2 | 重复提交 | 响应丢失后同 `operationId` 重放 | 200 `replayed:true` 返回同一任务当前态；不创建第二个任务 | [task-submit-replay-200.json](../../tests/fixtures/web-contract/task-submit-replay-200.json) |
| 3 | 幂等键冲突 | 同 ID 不同输入 | 409 `idempotency_conflict`，指向既有任务 | [task-submit-conflict-409.json](../../tests/fixtures/web-contract/task-submit-conflict-409.json) |
| 4 | 满槽 | 3 个槽被占时第 4 个任务提交 | 202 `queued` + `queuePosition`；无 `RUNTIME_BUSY`/忙碌拒绝 | [task-submit-202-queued.json](../../tests/fixtures/web-contract/task-submit-202-queued.json) |
| 5 | 取消竞争·取消赢 | queued 上取消先于领取 | 事务置 `cancelled`；调度器不得再启动该任务 | [task-cancel-queued-cancelled.json](../../tests/fixtures/web-contract/task-cancel-queued-cancelled.json) |
| 6 | 取消竞争·领取赢 | 领取先于取消 | 202 `cancelling`；先持久取消意图再停 worker；确认退出前槽不释放、不显示已取消 | [task-cancel-running-cancelling.json](../../tests/fixtures/web-contract/task-cancel-running-cancelling.json) |
| 7 | 过期版本操作 | 旧窗口携过期 `expectedVersion` 取消 | 409 `version_conflict`；重读后重新决策 | [error-version-conflict-409.json](../../tests/fixtures/web-contract/error-version-conflict-409.json) |
| 8 | 重启·可安全恢复 | 后端重启，旧 worker 确认停止、无未知副作用 | 上次 running → `interrupted`；扫描后有界重入队（新 attempt、新 epoch） | [task-interrupted.json](../../tests/fixtures/web-contract/task-interrupted.json) |
| 9 | 重启·副作用未知 / 取消意图 | 重启时工具副作用不明或取消未确认 | `needs_review`：保留输入、已知回执与取消意图；禁止自动重放；仅 `resolve` 放行 | [task-needs-review.json](../../tests/fixtures/web-contract/task-needs-review.json) |
| 10 | 旧备份恢复 | 恢复旧快照（备份时 queued 的任务其后已完成外部操作） | 恢复保持：提交/调度/定时/outbox 暂停；未完成任务隔离待核对；不自动重发；逐项核对回执后放行 | [recovery-hold-report.json](../../tests/fixtures/web-contract/recovery-hold-report.json) |
| 11 | 已有根/退役源根激活 | 激活无法证明执行历史连续的根 | 与场景 10 同一恢复核对流程；A→B→A 不重发 | 同上 |
| 12 | 凭据缺失 | 提交成功但执行时引用解析失败 | 提交仍 202（只存引用）；执行 → `failed` `credential_unavailable`（`manual`）；输入保留，不无限占槽 | [task-failed-credential.json](../../tests/fixtures/web-contract/task-failed-credential.json)、[providers-capability.json](../../tests/fixtures/web-contract/providers-capability.json) |
| 13 | 跨源拒绝 | 外站页面诱导提交 | 403 `origin_rejected`；不入队、不启动 worker | [error-origin-rejected-403.json](../../tests/fixtures/web-contract/error-origin-rejected-403.json) |
| 14 | 迁移响应丢失 | 工作根切换后响应未达 | 按同一 `operationId` 读回 `pending`/终态；不盲目重复迁移 | [workspace-operation-pending.json](../../tests/fixtures/web-contract/workspace-operation-pending.json) |
| 15 | 代理模式请求根切换 | 无能力的会话请求切换/恢复 | 403 `workspace_manage_denied` | [workspace-switch-denied-403.json](../../tests/fixtures/web-contract/workspace-switch-denied-403.json)、[workspace-switch-request.json](../../tests/fixtures/web-contract/workspace-switch-request.json) |
| 16 | SSE 断线补偿 | 短断线 / 实例更替 / 游标缺口 | `Last-Event-ID` 重放；否则高水位快照 + 重新订阅；旧事件按 cursor/objectVersion 忽略 | [sse-events-sample.json](../../tests/fixtures/web-contract/sse-events-sample.json)、[snapshot-high-watermark.json](../../tests/fixtures/web-contract/snapshot-high-watermark.json) |
| 17 | 并发调整 | PUT `agent-concurrency`（3→4、3→1） | 校验正整数；上调补发空槽、下调待自然退出；不影响任务 `version` | [settings-concurrency.json](../../tests/fixtures/web-contract/settings-concurrency.json) |

## 12. 数据结构提案（逻辑字段；非 DDL，表名与类型由实施切片定案）

以下为任务台账、事件与恢复逻辑的最小对象集，全部为**提案**；不改真实 DDL、manifest 或锁文件。

| 对象（拟） | 逻辑字段（拟） | 说明 |
|---|---|---|
| `tasks` | `task_id` PK、`operation_id` UNIQUE、`type`、`role`、`state`、`version`、`submit_seq` UNIQUE、`config_revision`、`input_ref`(JSON)、`cancel_intent`、`next_attempt_at` NULL、`attempt_budget`、`result_ref`(JSON) NULL、`failure`(JSON) NULL、`created_at`、`updated_at`、`terminal_at` NULL | 幂等键全局唯一；`submit_seq` 定 FIFO |
| `task_attempts` | `attempt_id` PK、`task_id` FK、`epoch`、`worker_pid` NULL、`started_at`、`ended_at` NULL、`exit_reason` NULL | 每任务多 attempt；fencing 依据 |
| `task_events` | `cursor` PK 自增、`task_id`、`type`、`payload`(JSON)、`object_version`、`epoch`、`created_at` | SSE 与审计同源；留存短期有界，快照补偿 |
| `side_effect_receipts` | `receipt_id` PK、`attempt_id` FK、`kind`、`external_ref`、`recorded_at`、`provable_readonly` | 已知外部回执；`needs_review` 与恢复核对的数据基础 |
| `workspace_operations` | `operation_id` PK、`kind`(switch/restore/backup)、`target_root_id` NULL、`backup_id` NULL、`state`(pending/succeeded/failed)、`created_at`、`updated_at` | 响应丢失读回；不盲目重复迁移 |
| `recovery_holds` | `hold_id` PK、`cause`(backup_restore/root_activation/import)、`paused_submissions`、`paused_scheduling`、`paused_timers`、`paused_outbox`、`opened_at`、`closed_at` NULL | 持久恢复标记；关闭前不恢复普通调度 |
| `recovery_items` | `item_id` PK、`hold_id` FK、`task_id`、`verification_state`(pending/verified/auto_safe/resumed/cancelled)、`decision` NULL、`decided_by` NULL、`decided_at` NULL | 逐项核对台账 |
| `settings` | `key` PK、`value`(JSON)、`version` | `agentConcurrency` 等；PUT 携带 `expectedVersion` |
| `instance_epochs` | `epoch` PK、`started_at`、`stopped_at` NULL | 实例更替与旧写入拒绝 |

schema/migration 建议（提案）：新服务数据库独立 lineage（元数据表记录 `schema_lineage = "web-backend/1"`、`schema_version` 从 1 起），遇 lineage 不符的既有库一律显式报错，不静默新建或续用；迁移工具沿用已锁定的 `rusqlite_migration` 正向迁移模式；开启 WAL；全部状态迁移用带状态/版本条件的 UPDATE 并校验影响行数（fencing 的机械实现）；索引：`tasks(operation_id)`、`tasks(state)`（部分索引）、`tasks(submit_seq)`、`task_events(task_id)`。与旧 v1–v5 store 之间不做迁移桥。

## 13. 依赖清单提案（只提案；本轮不安装、不改 manifest/锁文件）

复用现有锁定版本（依据 `package.json` 与 `src-tauri/Cargo.toml` 当前清单）：

| 依赖 | 已锁版本 | 用途 | 说明 |
|---|---|---|---|
| `rusqlite` | =0.39.0（bundled+backup） | Rust 存储适配的 SQLite 连接/备份 | 新后端存储适配直接复用；`node:sqlite` 不得按路径重开业务库 |
| `rusqlite_migration` | =2.5.0 | 正向 schema 迁移 | 与 §12 迁移建议一致 |
| `keyring-core` / `apple-native-keyring-store` | =1.0.1 / =1.0.2 | macOS Keychain 凭据 provider | 已锁定；Linux 侧按设计走 env 引用，不新增 |
| `serde` / `serde_json` | 当前锁定 | 契约序列化 | 错误包络与事件负载 |
| Vue 3 / Pinia / TDesign / Tailwind v4 | 当前锁定 | 前端 | 不因本契约变化 |

确需新增的生产依赖候选（引入前须锁版本、按仓库授权单独批准；含替代项）：

| 候选 | 用途 | 替代项 | 建议处置 |
|---|---|---|---|
| 无（HTTP 层） | `node:http` + 自建薄路由 + 原生 SSE（`text/event-stream`） | `h3`/`fastify` | 首选零依赖；路由/SSE 复杂度超出阈值时再评审框架候选 |
| 无（会话/CSRF/限速/UUID） | `node:crypto`（CSPRNG、HMAC、`randomUUID`）+ 内存令牌桶 | — | 零依赖实现 |
| 校验库（如 `zod`，版本待锁定调查） | 请求/事件运行时校验与类型推导 | 手写校验函数（仓库既有模式） | 引入前按 R3 列清单评审；非 W0 必需 |

## 14. 冻结与变更流程

- 本文为提案；契约冻结由队长在 W0 阶段末统一宣布，成员不得自行宣布冻结或通知他人按草案开工（MAYNE-19 约束）。
- 冻结后变更：不兼容字段/语义变更必须升 `contractVersion` 并在冻结记录中写明迁移方式；新增可选字段按兼容变更处理。
- 原生适配/跨平台探针由独立负责人推进，可引用其后续结论；本契约不等待其它候选交付即可评审。
- 实现切片接入时，本文的字段/错误/状态表是对应测试断言的独立预期来源；实现与契约不一致按缺陷处理，不反向改契约迁就实现。
