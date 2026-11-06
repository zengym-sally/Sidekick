# Web 任务提交到结果查询的端到端契约（W0 候选草案）

> **状态：候选草案，未经独立评审，未被冻结。** 任何成员不得按本文开工；契约由队长在阶段末统一冻结（见 §15）。
> 契约标识：`sidekick.web-contract/1.0.0`。本文所有 JSON 样例与 `tests/fixtures/web-contract/` 内样例携带同一版本。
> 编写基点：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）；日期 2026-11-06。
> 权威来源：[产品定义](../product/01-产品定义.md)、[用户流程](../product/02-用户流程.md)、[智能体与架构](../product/03-智能体与架构.md)、[分期交付与验收](../product/04-分期交付与验收.md)、[Web/后端设计](web-backend-design.md)、[工程架构](architecture.md)、[验证约定](verification.md)。
> 本任务是 W0 四项并行交付之一，唯一写入范围为 `docs/engineering/web-api-contract.md`、`tests/fixtures/web-contract/` 的合成 JSON 样例、`docs/reviews/web-contract-*.md`。

## 0. 范围、边界与前提

### 0.1 覆盖

沿[Web/后端设计](web-backend-design.md)的既定方向，冻结从**任务提交**到**用户看到结果或错误**的端到端契约：

- 提交、查询、取消、重试四类操作，以及任务幂等与版本规则；
- 默认 3 并发的实例设置与排队语义（满槽只排队，不丢任务）；
- SSE 事件、游标、实例 epoch 与高水位快照补偿；
- worker `attempt`/`epoch`、退出与进程清理、宿主消失检测；
- 重启、旧备份恢复、已有工作根激活的恢复语义与持久标记；
- 受限工作根管理的会话能力、目标白名单、操作 ID 与结果读回；
- provider 能力与控制通道边界；
- 字段、错误、状态与边界，覆盖 `queued`/`cancelling`/`interrupted`/`needs_review`、响应未知与副作用未知；
- 场景矩阵与可解析 JSON 样例；拟议任务台账／事件／恢复数据结构与 schema/migration 变更建议；可复用依赖与确需新增生产依赖清单。

### 0.2 不覆盖（明确排除）

- 不执行真实 DDL、不改 `src-tauri/src/store/` 的 001–005 迁移、不改 `package.json`／锁文件、不安装依赖；
- 不读取真实模型环境／凭据、不操作真实工作根、不部署、不提交／推送／合并；
- 不定义旧 IPC／旧 schema 兼容桥；不恢复 `RUNTIME_BUSY` 作为普通提交契约；
- 不定义业务表（事项／候选／来源／进展／提醒／日报）的完整结构，只定义任务队列与恢复所必需的任务侧结构；
- 不替代 MAYNE-20（存储与平台探针）的 `node:sqlite`／Keychain／Linux 结论，也不替代 MAYNE-21（浏览器交互方案）的界面状态设计；本文只引用其后续结论，不等待其完成即可评审。

### 0.3 前提

- 单后端实例、单工作根、唯一正常业务写入方；浏览器与后端默认同机，主机部署经可信反向代理（设计 §3）。
- 凭据随后端 OS（macOS 可用 Keychain，Linux 默认环境引用）；秘密不入库、不入队、不入日志／SSE（设计 §4）。
- 任务入队即已接收，提交成功代表已落 SQLite；满槽进入 `queued`，原 `RUNTIME_BUSY`/409 不再作为普通提交契约（设计 §5）。

## 1. 通用约定

### 1.1 版本与媒体类型

- 业务 API 与 SSE 同源，默认 `http://127.0.0.1:<port>`；代理模式为单个 HTTPS 公共 origin（设计 §3）。
- 请求体 `application/json; charset=utf-8`；响应体同名，SSE 为 `text/event-stream`。
- 契约版本通过请求头 `X-Sidekick-Contract: sidekick.web-contract/1.0.0` 声明；响应头回显 `X-Sidekick-Contract` 与 `X-Sidekick-Epoch`。版本不一致时以响应头为准，客户端不得混用两版语义。

### 1.2 标识与时间

- `taskId`：`tsk_` + 24 位小写十六进制；`operationId`：`op_` + UUID；`attemptId`：`att_` + UUID；`epoch`：`ep_` + UUID；`requestId`：`req_` + UUID；`cursor`：实例内单调递增整数。
- 所有时间点序列化为 ISO 8601 UTC（`...Z`）；带时区的业务时间另存时区与原表达，规则见[用户流程](../product/02-用户流程.md) §3。

### 1.3 会话、来源与 CSRF

- 写请求校验精确 `Host`/`Origin` 与 CSRF；会话 cookie 为 `HttpOnly`、`SameSite=Strict`、限制 `Path`、不设 `Domain`；回环 HTTP 不依赖 `Secure`，代理模式强制 `Secure`（设计 §3）。
- 代理模式必须显式配置 `publicOrigin`、允许来源与代理秘密头；秘密缺失或来源不符一律拒绝，不因 `X-Forwarded-*` 切换信任模式。
- 不符合来源／CSRF 的请求不得入队、不得启动 worker，返回 `403`。

### 1.4 错误信封

所有错误响应使用同一信封，HTTP 状态与 `error.code` 对齐：

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "任务不存在或已被清除。",
    "details": { "taskId": "tsk_000000000000000000000000" },
    "requestId": "req_00000000-0000-4000-8000-000000000000"
  }
}
```

- `details` 只含非敏感字段；`message` 面向用户，可本地化；`requestId` 用于服务端检索，不携带秘密。
- 日志与 SSE 不得回显密钥、凭据引用明文、模型原始输出中的敏感片段；脱敏规则沿用设计 §4 与 §7。

### 1.5 幂等与版本

- `POST /api/tasks` 必须携带 `Idempotency-Key` 头（即业务操作 ID），长度 ≤255，字符集 `[A-Za-z0-9._:-]`。
- 服务端在**同一短事务**内保存任务、输入引用、角色／配置修订、提交顺序与初始事件；提交成功才返回 `202 + taskId + state`。
- 同一 `Idempotency-Key` 重复提交：输入摘要一致时返回**同一个** `taskId`（幂等重放）；摘要不一致时返回 `409 IDEMPOTENCY_KEY_CONFLICT`，不新建任务。
- 输入摘要 = `sha256(canonicalJson({type, roleId, input, configRevision}))`，秘密不参与摘要。
- 响应丢失但服务端已接收时，客户端用同一 `Idempotency-Key` 重试或按 `operationId` 查询；不得再次创建任务。
- 所有变更型操作接受 `expectedVersion`；版本不匹配返回 `409 TASK_VERSION_CONFLICT`，不产生副作用。

## 2. 任务状态机

### 2.1 状态定义

| 状态 | 含义 | 是否终态 | 可转 |
|---|---|---|---|
| `queued` | 已接收并持久化，未领取 | 否 | `running`、`cancelled`、`queued`（重试重置） |
| `running` | 已原子领取，worker 执行中 | 否 | `cancelling`、`succeeded`、`failed`、`needs_review`、`interrupted` |
| `cancelling` | 已持久取消意图，worker／工具树停止中 | 否 | `cancelled`、`needs_review`、`interrupted` |
| `succeeded` | 结果被当前 attempt 接受并持久化 | 是 | — |
| `failed` | 无结果，且已判定为可安全重试或终止 | 是 | `queued`（仅显式重试） |
| `cancelled` | 取消已确认，无未知副作用 | 是 | — |
| `interrupted` | 宿主／worker 消失，无外部副作用证据，等待显式处理 | 是（需显式动作离开） | `queued`（显式重试） |
| `needs_review` | 外部副作用结果不明，禁止自动重放 | 是（需人工核对） | `queued`（用户确认重试）、`cancelled`（用户确认取消） |

`RUNTIME_BUSY` 与“满槽即 409 丢任务”不再是本契约的提交语义；满槽一律 `202 queued`。

### 2.2 转换规则与不变量

| 从 | 事件 | 到 | 保证 |
|---|---|---|---|
| — | 提交（新操作 ID） | `queued` | 任务与初始事件同事务提交；失败则未接收 |
| `queued` | 领取 | `running` | 原子检查状态并写入 `attemptId`/`epoch`；每个 attempt 只启动一次 worker |
| `queued` | 取消 | `cancelled` | 与领取竞争必须有一个确定结果；调度器不得启动 |
| `running` | 取消请求 | `cancelling` | 先持久取消意图，再停止 worker／工具树；未确认退出不释放槽 |
| `cancelling` | worker 退出且无未知副作用 | `cancelled` | 释放槽；结果仅被当前 attempt 接受 |
| `cancelling` | worker 退出但副作用未知 | `needs_review` | 释放槽；保留输入与已知回执，禁止自动重放 |
| `running` | 正常结束 | `succeeded`／`failed` | 结果、终态与可见事件同事务提交 |
| `running` | 认证／配置错误 | `failed` | 停止重试 |
| `running` | 副作用未知 | `needs_review` | 保留输入与已知回执 |
| `running`／`cancelling` | 宿主／worker 消失 | `interrupted`／`needs_review` | 重启扫描全部未终态 attempt，保留取消意图 |
| `interrupted`／`needs_review`／`failed` | 显式重试 | `queued` | `retryCount + 1`，写入新 attempt；不得覆盖已确认结果 |
| `needs_review` | 用户确认取消 | `cancelled` | 需 `mode: "user_confirmed"` |

不变量：

1. 已 ACK 的 `queued` 任务不因排队满、页面关闭或服务重启被静默丢弃。
2. 晚到结果不得覆盖新 attempt 或已取消任务；结果仅被当前 `attemptId`/`epoch` 接受。
3. 取消意图跨重启保留；未确认进程树退出且无未知副作用前不得显示已取消。
4. 任务终态与可见事件在同一事务提交；签收仍由用户单独确认，`task success` 不等于正式事项已签收。
5. `version` 在每次持久状态变更时递增，作为乐观并发锚点。

### 2.4 未知语义

| 未知 | 触发 | 处置 | 场景 |
|---|---|---|---|
| 响应未知 | 提交／迁移请求已到达服务端，但调用方未收到响应 | 用同一 `Idempotency-Key`／操作 ID 重放或读回；服务端幂等，不重复创建任务或重复迁移 | S03、S24 |
| 副作用未知 | 外部工具／来源／迁移可能已执行，结果不明 | 任务置 `needs_review`，保留输入与已知回执，禁止自动重放；由用户核对后显式重试或取消 | S13、S22、S23 |

### 2.3 attempt 与 epoch

- `epoch` 是后端实例代次；领取时写入，修复“旧 worker 未停就恢复调度”的问题。
- `attemptId` 单次领取唯一；worker 结果必须携带 `attemptId` 与 `epoch`，服务端 fencing 拒绝过期提交。
- worker 以父管道／guardian 检测宿主消失；下一实例拿根锁不等于旧 worker 已停，启动前必须清理或核实上次实例所属进程，无法核实则暂停调度并显示原因。

## 3. 拟议任务台账与事件数据结构

以下为**逻辑结构与建议 DDL 提案**，未执行；表名与 DDL 在实施切片定案，由 Rust 存储适配统一拥有连接、短事务与根锁（设计 §2）。旧 `src-tauri/src/store/` 的 001–005 迁移保持历史，不被改写。

### 3.1 `tasks`（任务台账）

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | TEXT PK | `tsk_...` |
| `operation_id` | TEXT UNIQUE NOT NULL | 幂等操作 ID |
| `type` | TEXT NOT NULL | 见 §4.1 |
| `role_id` | TEXT | 固定三角色之一；非角色任务为 NULL |
| `channel` | TEXT NOT NULL | `agent`（模型槽）或 `service`（有界非模型资源） |
| `state` | TEXT NOT NULL | §2.1 |
| `version` | INTEGER NOT NULL | 每次变更 +1 |
| `attempt_id` | TEXT | 当前 attempt，未领取为 NULL |
| `epoch` | TEXT | 当前实例代次，未领取为 NULL |
| `input_ref` | TEXT NOT NULL | 不可变输入引用（`runs/<runId>/input.json`） |
| `input_hash` | TEXT NOT NULL | 幂等摘要 |
| `config_revision` | TEXT NOT NULL | 启动时配置／技能快照修订 |
| `snapshot_ref` | TEXT | 私有 run 快照引用（cwd、凭据引用、技能） |
| `result_ref` | TEXT | 结果引用，未完成为 NULL |
| `error_code` | TEXT | 失败／需核对的错误码 |
| `cancel_intent` | INTEGER NOT NULL | 0/1，取消意图跨重启保留 |
| `retry_count` | INTEGER NOT NULL | 已重试次数 |
| `next_attempt_at` | INTEGER | 延迟重试时间，未到期不阻塞后续就绪任务 |
| `queued_at` / `started_at` / `ended_at` / `updated_at` | INTEGER | 毫秒时间戳 |

### 3.2 `task_events`（有序事件）

| 字段 | 类型 | 说明 |
|---|---|---|
| `cursor` | INTEGER PK AUTOINCREMENT | 实例内递增游标，SSE `id` |
| `epoch` | TEXT NOT NULL | 实例代次 |
| `task_id` | TEXT NOT NULL | 关联任务 |
| `event_type` | TEXT NOT NULL | `task.created`/`task.state`/`task.progress`/`task.result`/`task.error` |
| `version` | INTEGER NOT NULL | 任务版本 |
| `state` | TEXT NOT NULL | 事件后状态 |
| `payload_json` | TEXT NOT NULL | 非敏感载荷 |
| `created_at` | INTEGER NOT NULL | 毫秒时间戳 |

索引：`(task_id, cursor)`、`(cursor)`、`(epoch, cursor)`。

### 3.3 `task_attempts`（尝试与清理证据）

| 字段 | 类型 | 说明 |
|---|---|---|
| `attempt_id` | TEXT PK | `att_...` |
| `task_id` | TEXT NOT NULL | 关联任务 |
| `epoch` | TEXT NOT NULL | 领取实例 |
| `worker_pid` | INTEGER | 子进程 PID，用于清理核实 |
| `guard_ref` | TEXT | guardian／管道引用，用于宿主消失检测 |
| `started_at` / `ended_at` | INTEGER | 毫秒时间戳 |
| `outcome` | TEXT | `running`/`succeeded`/`failed`/`cancelled`/`interrupted`/`needs_review` |

### 3.4 `recovery_markers`（持久恢复标记）

| 字段 | 类型 | 说明 |
|---|---|---|
| `marker_id` | TEXT PK | |
| `kind` | TEXT NOT NULL | `backup_restore`／`existing_root_activation` |
| `state` | TEXT NOT NULL | `pending`/`blocked`/`resolved` |
| `payload_json` | TEXT NOT NULL | 待核对任务、来源游标、备份标识 |
| `created_at` | INTEGER NOT NULL | 毫秒时间戳 |

恢复期间调度、定时收集、提醒／outbox 与补偿投递全部暂停；标记未解决前，变更型接口返回 `409 RECOVERY_ACTIVE`。

### 3.5 `workspace_operations`（受限工作根操作）

| 字段 | 类型 | 说明 |
|---|---|---|
| `operation_id` | TEXT PK | 持久操作 ID |
| `kind` | TEXT NOT NULL | `switch_root`／`restore_backup` |
| `target_id` | TEXT | 目标根白名单 ID |
| `expected_version` | INTEGER | 预期版本校验 |
| `state` | TEXT NOT NULL | `pending`/`succeeded`/`failed`/`unknown` |
| `result_json` | TEXT | 结果或失败详情 |
| `created_at` / `resolved_at` | INTEGER | 毫秒时间戳 |

### 3.6 建议迁移

- 新增 Web 后端迁移 `001_web_init`（或实施切片约定的命名），建上述五表与索引；**不追加、不改写**旧 001–005。
- 迁移由 Rust 存储适配执行，遵循“只追加、失败不回滚原根”的既有约定（[工程架构](architecture.md) §5）。
- 具体 DDL、索引与约束在实施切片提交可审清单，按仓库授权执行；本文仅为提案。

## 4. HTTP 契约

### 4.1 任务类型与通道

| `type` | `roleId` | `channel` | 槽 |
|---|---|---|---|
| `extract` | `organizer` | `agent` | 模型槽 |
| `revise` | `organizer` | `agent` | 模型槽 |
| `role_trial` | 三角色之一 | `agent` | 模型槽 |
| `advice` | `advisor` | `agent` | 模型槽 |
| `model_test` | NULL | `agent` | 模型槽 |
| `source_collect` | `tracker` | `service` | 有界非模型资源 |
| `mcp_probe` | NULL | `service` | 有界非模型资源 |

模型任务共用默认 3 个执行槽；`service` 通道不占模型槽，但同样受每任务取消、cwd 与清理归属约束（设计 §5）。

### 4.2 端点总表

| 方法 | 路径 | 用途 | 写操作 |
|---|---|---|---|
| POST | `/api/tasks` | 提交任务（幂等） | 是 |
| GET | `/api/tasks` | 列表；`?operationId=` 按操作 ID 查询 | 否 |
| GET | `/api/tasks/{taskId}` | 查询单任务 | 否 |
| POST | `/api/tasks/{taskId}/cancel` | 取消 | 是 |
| POST | `/api/tasks/{taskId}/retry` | 显式重试 | 是 |
| GET | `/api/tasks/{taskId}/events` | 单任务事件（轮询回退） | 否 |
| GET | `/api/events` | SSE 订阅 | 否 |
| GET | `/api/capabilities` | provider／凭据能力 | 否 |
| GET | `/api/config` | 实例设置（含并发） | 否 |
| PATCH | `/api/config/agent-concurrency` | 调整并发 | 是 |
| GET | `/api/workspace` | 当前工作根 | 否 |
| GET | `/api/workspace/targets` | 允许目标列表 | 否 |
| POST | `/api/workspace/switch-intents` | 提交切换意图 | 是 |
| GET | `/api/workspace/operations/{operationId}` | 切换结果读回 | 否 |
| POST | `/api/backups` | 创建备份 | 是 |
| GET | `/api/backups` | 列出备份 | 否 |
| GET | `/api/backups/{backupId}` | 备份详情 | 否 |
| POST | `/api/backups/{backupId}/restore-intents` | 提交恢复意图 | 是 |
| GET | `/api/recovery` | 恢复状态 | 否 |
| POST | `/api/pairing` | 一次性配对码交换 | 是 |
| POST | `/api/session` | 建立／刷新会话 | 是 |
| DELETE | `/api/session` | 退出并撤销会话 | 是 |

控制通道（发现、退出、任意主机管理）**不在**上述业务路由内，使用独立 control token 与独立端口／origin，代理不得暴露（设计 §2、§3）。

### 4.3 提交任务

`POST /api/tasks`

```json
{
  "type": "extract",
  "roleId": "organizer",
  "input": { "rawText": "合成样例：下周五17点前交付方案。" },
  "configRevision": "rev_000000000000000000000001",
  "anchorAtMs": 1793884800000,
  "timeZone": "Asia/Shanghai"
}
```

- 头：`Idempotency-Key: op_...`（必填）、`X-Sidekick-Contract`、CSRF。
- 成功：`202`，体：

```json
{
  "taskId": "tsk_000000000000000000000001",
  "state": "queued",
  "version": 1,
  "position": 1,
  "queueLength": 1,
  "runningCount": 0,
  "acceptedAt": "2026-11-06T10:00:00.000Z"
}
```

- 满槽：仍 `202`，`state: "queued"`，`position` 为持久提交顺序位置；不返回忙碌错误。
- 幂等重放：同一 `Idempotency-Key` 且输入摘要一致，返回同一 `taskId` 与当前 `state`/`version`，不新建。
- 错误：`400 INVALID_INPUT`／`IDEMPOTENCY_KEY_REQUIRED`、`409 IDEMPOTENCY_KEY_CONFLICT`、`403 ORIGIN_REJECTED`／`CSRF_REJECTED`／`PROXY_SECRET_MISSING`、`503 NOT_ACCEPTED`（存储失败，操作 ID 未被消费，可原键重试）。

### 4.4 查询任务

`GET /api/tasks/{taskId}` → `200`：

```json
{
  "taskId": "tsk_000000000000000000000001",
  "operationId": "op_00000000-0000-4000-8000-000000000001",
  "type": "extract",
  "roleId": "organizer",
  "state": "running",
  "version": 4,
  "attemptId": "att_00000000-0000-4000-8000-000000000001",
  "epoch": "ep_00000000-0000-4000-8000-000000000001",
  "position": null,
  "queueLength": 2,
  "runningCount": 3,
  "configRevision": "rev_000000000000000000000001",
  "inputRef": "runs/att_00000000-0000-4000-8000-000000000001/input.json",
  "snapshotRef": "runs/att_00000000-0000-4000-8000-000000000001/snapshot.json",
  "resultRef": null,
  "error": null,
  "cancelIntent": false,
  "retryCount": 0,
  "nextAttemptAt": null,
  "queuedAt": "2026-11-06T10:00:00.000Z",
  "startedAt": "2026-11-06T10:00:01.000Z",
  "endedAt": null,
  "updatedAt": "2026-11-06T10:00:01.000Z"
}
```

- `GET /api/tasks?operationId=op_...` 返回同一任务或 `404`，用于响应丢失后读回。
- `GET /api/tasks?state=queued&limit=50&cursor=...` 按持久提交顺序返回队列；不承诺不准确的等待时长。
- 错误：`404 TASK_NOT_FOUND`。

### 4.5 取消

`POST /api/tasks/{taskId}/cancel`，体 `{ "reason": "user", "expectedVersion": 4 }`。

- `queued` → `cancelled`：原子置终态，调度器不得启动。
- `running` → `cancelling`：先持久取消意图，再停止 worker／工具树；未确认退出前不释放槽、不显示已取消。
- 终态任务返回 `409 TASK_NOT_CANCELLABLE`；版本不匹配返回 `409 TASK_VERSION_CONFLICT`。
- 取消与领取竞争必须有一个确定结果：领取事务与取消事务在同一状态机上串行化，先到者生效，后到者按结果返回或拒绝。

### 4.6 重试

`POST /api/tasks/{taskId}/retry`，体 `{ "expectedVersion": 4, "mode": "user_confirmed" }`。

- 仅 `failed`（可安全重试的临时失败）、`interrupted`、`needs_review` 可显式重试；`needs_review` 必须 `mode: "user_confirmed"`。
- 成功：`202`，任务回到 `queued`，`retryCount + 1`，写入新 attempt；已确认结果不被覆盖。
- 认证／配置错误等不可重试终态返回 `409 TASK_NOT_RETRYABLE`。
- 自动重试仅用于已证“发送前／可安全重复”的临时失败，有界退避；未知 MCP／飞书发送或 Bash 副作用不得自动重放。

### 4.7 事件与轮询回退

`GET /api/tasks/{taskId}/events?since=<cursor>` → `200`，返回该任务的事件数组（`cursor` 递增）。用于 SSE 不可用时的降级；权威状态始终以查询为准。

## 5. SSE 契约与高水位快照补偿

`GET /api/events`（可带 `Last-Event-ID` 头或 `?since=<cursor>`）。

事件帧：

```
id: 42
event: task.changed
data: {"epoch":"ep_...","cursor":42,"taskId":"tsk_...","version":3,"state":"running","objectVersion":3,"updatedAt":"..."}

: heartbeat
```

- 事件只通知**已经提交**的变化，附实例 `epoch`、递增 `cursor`、对象 `version`。
- 客户端忽略 `cursor` ≤ 已应用游标或 `version` ≤ 对象已见版本的事件；不得用旧 `running` 覆盖新 `interrupted`。

快照补偿：

1. 无 `Last-Event-ID`：发送 `snapshot` 事件，含全量任务列表、`epoch` 与 `highWaterCursor`（当前游标），随后从 `highWaterCursor + 1` 续传实时事件。
2. `Last-Event-ID` 超出留存或 `epoch` 变化：同样发送 `snapshot`，客户端整体替换本地状态。
3. `Last-Event-ID` 在留存内：重放 `cursor > lastEventId` 的事件，再转实时。
4. 快照与订阅之间的变化必须可补发；事件丢失不能丢任务，权威队列与业务状态在 SQLite。

```
id: 0
event: snapshot
data: {"epoch":"ep_...","highWaterCursor":128,"tasks":[...],"capabilities":{...}}
```

SSE 关闭代理缓冲与缓存，配置心跳、读取超时与会话过期后的断开／重新认证（设计 §3）。

## 6. 场景矩阵（提交到用户可见结果／错误）

下表覆盖正常提交、重复提交、满槽、取消竞争、重启、旧备份、旧根、凭据缺失、跨源拒绝，以及响应未知、副作用未知与晚到结果。每行指向可解析样例；样例与本文同版本。

| ID | 场景 | 前置 | 请求 | 期望（用户可见） | 样例 |
|---|---|---|---|---|---|
| S01 | 正常提交并排队 | 已配对会话 | `POST /api/tasks` | `202 queued`，返回 `taskId` 与队列位置 | [submit-accepted-202.json](../../tests/fixtures/web-contract/submit-accepted-202.json) |
| S02 | 重复提交（同操作 ID 同输入） | 已提交 S01 | 同 `Idempotency-Key` 再提交 | 返回**同一** `taskId`，不新建 | [submit-duplicate-idempotent-202.json](../../tests/fixtures/web-contract/submit-duplicate-idempotent-202.json) |
| S03 | 响应丢失后按操作 ID 读回 | S01 已接收但响应丢失 | `GET /api/tasks?operationId=...` | `200` 同一任务，不重复创建 | [submit-response-unknown-query-200.json](../../tests/fixtures/web-contract/submit-response-unknown-query-200.json) |
| S04 | 同操作 ID 不同输入 | 已提交 S01 | 同键不同 `input` | `409 IDEMPOTENCY_KEY_CONFLICT`，不新建 | [submit-duplicate-conflict-409.json](../../tests/fixtures/web-contract/submit-duplicate-conflict-409.json) |
| S05 | 满槽排队（默认 3） | 3 个运行中 | 再提交 2 个 | 均 `202 queued`，返回位置；无忙碌错误 | [queue-full-accepted-202.json](../../tests/fixtures/web-contract/queue-full-accepted-202.json) |
| S06 | 查询排队 | 任务已排队 | `GET /api/tasks/{id}` | `200 queued`，含 `position` | [task-queued-200.json](../../tests/fixtures/web-contract/task-queued-200.json) |
| S07 | 查询运行中 | 任务已领取 | 同上 | `200 running`，含 `attemptId`/`epoch` | [task-running-200.json](../../tests/fixtures/web-contract/task-running-200.json) |
| S08 | 查询成功结果 | 任务完成 | 同上 | `200 succeeded`，含 `resultRef` | [task-succeeded-200.json](../../tests/fixtures/web-contract/task-succeeded-200.json) |
| S09 | 查询失败错误 | 任务失败 | 同上 | `200 failed`，含 `error.code` | [task-failed-200.json](../../tests/fixtures/web-contract/task-failed-200.json) |
| S10 | 取消排队任务 | 任务 `queued` | `POST .../cancel` | `200 cancelled`，永不执行 | [cancel-queued-200.json](../../tests/fixtures/web-contract/cancel-queued-200.json) |
| S11 | 取消与领取竞争 | 任务 `queued`，调度器同时领取 | `cancel` 与领取并发 | 确定结果：`cancelled` 或 `running`，不出现“已取消却运行” | [cancel-race-200.json](../../tests/fixtures/web-contract/cancel-race-200.json) |
| S12 | 取消运行中 | 任务 `running` | `POST .../cancel` | `200 cancelling`，确认退出后 `cancelled` | [cancel-running-cancelling-200.json](../../tests/fixtures/web-contract/cancel-running-cancelling-200.json) |
| S13 | 取消中重启 | 任务 `cancelling`，宿主消失 | 重启扫描 | 保留取消意图；副作用未知则 `needs_review`，不自动重入队 | [cancel-restart-needs-review-200.json](../../tests/fixtures/web-contract/cancel-restart-needs-review-200.json) |
| S14 | 重启后 running 中断 | 任务 `running`，宿主消失 | 重启扫描 | `interrupted`，队列其余保留 | [restart-interrupted-snapshot.json](../../tests/fixtures/web-contract/restart-interrupted-snapshot.json) |
| S15 | 晚到结果被拒 | 任务已取消／已新 attempt | 旧 worker 提交结果 | fencing 拒绝，不覆盖新状态 | [late-result-rejected-200.json](../../tests/fixtures/web-contract/late-result-rejected-200.json) |
| S16 | 安全临时失败重试 | 任务 `failed`（可安全重试） | `POST .../retry` | `202 queued`，`retryCount + 1`，新 attempt | [retry-safe-202.json](../../tests/fixtures/web-contract/retry-safe-202.json) |
| S17 | 认证／配置错误不重试 | 任务 `failed`（401／配置） | `POST .../retry` | `409 TASK_NOT_RETRYABLE` | [retry-blocked-409.json](../../tests/fixtures/web-contract/retry-blocked-409.json) |
| S18 | 凭据缺失 | 任务执行前凭据引用不存在 | 任务执行 | 仅该任务 `failed`，`CREDENTIAL_REF_MISSING`；其他任务不受影响 | [credential-missing-failed-200.json](../../tests/fixtures/web-contract/credential-missing-failed-200.json) |
| S19 | Provider 能力查询 | 已配对 | `GET /api/capabilities` | 返回 provider 能力与可用性，不回读秘密 | [capabilities-200.json](../../tests/fixtures/web-contract/capabilities-200.json) |
| S20 | 跨源拒绝 | 恶意／未知 Origin | 任意写请求 | `403 ORIGIN_REJECTED`，不入队、不启动 worker | [cross-origin-rejected-403.json](../../tests/fixtures/web-contract/cross-origin-rejected-403.json) |
| S21 | 代理伪造头／缺秘密 | 代理模式 | 写请求 | `403 PROXY_SECRET_MISSING`，不切换信任模式 | [proxy-secret-missing-403.json](../../tests/fixtures/web-contract/proxy-secret-missing-403.json) |
| S22 | 旧备份恢复 | 存在旧快照 | `POST .../restore-intents` | `202` 操作 ID；恢复后未完成任务隔离为 `needs_review`，调度暂停 | [backup-restore-request-202.json](../../tests/fixtures/web-contract/backup-restore-request-202.json)、[backup-restore-recovery-state-200.json](../../tests/fixtures/web-contract/backup-restore-recovery-state-200.json) |
| S23 | 旧根激活无连续性证明 | 目标为已有／退役根 | 激活请求 | 进入持久恢复核对，暂停调度，不自动重发 | [workspace-existing-root-continuity-409.json](../../tests/fixtures/web-contract/workspace-existing-root-continuity-409.json) |
| S24 | 工作根切换意图 | 本机、有 `workspace.manage` 能力 | `POST /api/workspace/switch-intents` | `202` 操作 ID，结果按 ID 读回 | [workspace-switch-intent-202.json](../../tests/fixtures/web-contract/workspace-switch-intent-202.json) |
| S25 | 工作根切换被拒 | 代理模式／无能力／目标非法／版本不符 | 同上 | `403`／`409`，不执行 | [workspace-switch-rejected-403.json](../../tests/fixtures/web-contract/workspace-switch-rejected-403.json) |
| S26 | SSE 高水位快照补偿 | 游标超留存／epoch 变化 | `GET /api/events` | `snapshot` + `highWaterCursor`，再续实时 | [sse-snapshot-compensation-200.json](../../tests/fixtures/web-contract/sse-snapshot-compensation-200.json) |
| S27 | 并发调整 | 实例运行中 | `PATCH /api/config/agent-concurrency` | `200`，上调补发空槽，下调不杀运行任务 | [concurrency-adjust-200.json](../../tests/fixtures/web-contract/concurrency-adjust-200.json) |
| S28 | 错误信封 | 任意失败 | — | 统一 `error` 信封，状态与码对齐 | [error-envelope-400.json](../../tests/fixtures/web-contract/error-envelope-400.json) |

完整场景—样例映射见 [scenario-manifest.json](../../tests/fixtures/web-contract/scenario-manifest.json)。

## 7. 错误目录

| `code` | HTTP | 触发 | 客户端处置 |
|---|---|---|---|
| `INVALID_INPUT` | 400 | 字段缺失／非法 | 修正后重试 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 缺少操作 ID 头 | 补头重试 |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | 同键不同输入 | 不新建，提示冲突 |
| `CONCURRENCY_INVALID` | 400 | 并发值非正整数 | 修正后重试 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 | 视为未知，重新读取 |
| `TASK_VERSION_CONFLICT` | 409 | `expectedVersion` 不匹配 | 重读后重试 |
| `TASK_NOT_CANCELLABLE` | 409 | 终态任务取消 | 停止重试 |
| `TASK_NOT_RETRYABLE` | 409 | 不可重试终态 | 人工核对 |
| `RECOVERY_ACTIVE` | 409 | 恢复标记未解决 | 等待恢复流程 |
| `CREDENTIAL_REF_MISSING` | 200（任务失败） | 引用不存在／无权重读 | 仅该任务失败，修复引用或换 provider |
| `CREDENTIAL_UNAVAILABLE` | 200（任务失败） | provider 不可用（如钥匙串未解锁） | 显式报错，不无限重试 |
| `ORIGIN_REJECTED` | 403 | Host／Origin 不符 | 不重试 |
| `CSRF_REJECTED` | 403 | CSRF 校验失败 | 重新建立会话 |
| `PROXY_SECRET_MISSING` | 403 | 代理秘密缺失／来源不符 | 不重试，检查部署 |
| `WORKSPACE_CAPABILITY_REQUIRED` | 403 | 无 `workspace.manage` 能力 | 不重试 |
| `WORKSPACE_TARGET_NOT_ALLOWED` | 409 | 目标不在白名单 | 不重试 |
| `WORKSPACE_VERSION_MISMATCH` | 409 | 目标版本不符 | 重新读取后核对 |
| `WORKSPACE_SWITCH_REJECTED_PROXY` | 403 | 代理模式请求切换 | 不重试 |
| `WORKSPACE_OPERATION_UNKNOWN` | 404 | 操作 ID 未知 | 用原 ID 读回，不重复迁移 |
| `BACKUP_VALIDATION_FAILED` | 409 | 备份校验失败 | 不恢复，保留原根 |
| `NOT_ACCEPTED` | 503 | 存储失败，未接收 | 可原操作 ID 重试 |
| `SESSION_REQUIRED` | 401 | 会话缺失／过期 | 重新配对／登录 |
| `RATE_LIMITED` | 429 | 配对／登录限速 | 退避重试 |

## 8. 恢复语义

### 8.1 原库重启

1. 取根锁，核实旧实例进程树已退出（guardian／管道／PID 归属）。
2. 扫描全部未终态 attempt：`running` → `interrupted`；有外部副作用证据不明 → `needs_review`。
3. 保留 `cancelling` 与取消意图；确认进程树退出且无未知副作用才置 `cancelled`，否则保留意图并 `needs_review`。
4. `queued` 保留；无法核实旧 worker 时暂停调度并显示原因，避免默认 3 实际超发。
5. 正常关停：先停新提交与调度，保留队列，再取消／等待运行任务并 reap，最后关库释放锁。

### 8.2 旧备份恢复

- 使用独立入口与持久恢复标记，不是原库重启。
- 先停提交／调度并确认旧进程树退出，再校验恢复数据。
- 恢复出的未完成任务全部保留并隔离为待核对；取消意图仍保留。
- 定时收集、提醒／outbox 与补偿投递同时暂停；重启服务不能绕过恢复标记重新触发。
- 快照中的 `queued` 可能在备份后已完成外部操作，幂等键与 attempt fencing 不能证明其尚未发送；无法核实时须用户明确选择重试／取消。
- 对可证无副作用的只读任务可安全恢复，判定须由可信任务类型／工具记录证明；未知一律保留待核对。

### 8.3 已有根激活

- 更换到已有工作根、重新激活退役迁移源根或导入工作根副本时，除校验数据格式外，还须证明它延续当前执行历史。
- 无法证明连续性或已知发生状态回退，一律进入上述持久恢复核对流程，暂停任务、定时／提醒／outbox，保留取消意图与全部任务。
- 不得凭根锁可获取、格式合法或 `queued` 状态自动调度。
- 验收覆盖 A→B 迁移、B 发生外部操作、再激活保留的 A 时不重发。

## 9. 受限工作根管理

- 本机配对会话由后端签发受限 `workspace.manage` 能力，仅允许：查看当前根、列出启动配置允许的目标 ID、提交选定 ID 的切换意图、查询其结果。
- 能力不由页面自行声明，也不授予任意路径访问、进程启停或控制秘密。
- 后端校验会话能力、`local` 模式、目标白名单与预期版本，再以持久操作 ID 执行停止调度／处理任务／一致性迁移／校验／切换。
- 响应丢失按操作 ID 读回，不盲目重复迁移。
- 代理模式不签发根切换能力，后端拒绝此类请求（`403 WORKSPACE_SWITCH_REJECTED_PROXY`），即使客户端绕过 UI 或代理路由限制也不能调用。
- Linux 固定根的变更由服务操作者完成；浏览器仍能在业务会话下申请受限的备份创建、下载和恢复已校验备份。

## 10. Provider 能力与控制通道

- `GET /api/capabilities` 返回 provider 能力与可用性（如 macOS Keychain 可用／不可用、Linux 环境引用），不回读秘密。
- Linux 不模拟 macOS 钥匙串，也不自动降级成明文凭据文件；无桌面会话的 macOS 服务也可能无法解锁 Keychain，须显式报错。
- 引用不存在或无权读取时，只影响依赖该凭据的任务；前端禁止保存无法兑现的钥匙串引用。
- 任务入队只保存配置修订与凭据引用，秘密到执行前由后端解析，按 run 私有 stdin／环境注入 worker；不写入队列、SQLite、argv、配置、日志或 SSE。
- 控制通道（发现、退出、任意主机管理）使用独立 control token 与独立端口／origin，不放进代理暴露的业务路由；代理公开 HTTP 服务不能关停宿主或获得控制秘密。

## 11. 信任边界与威胁控制

| 威胁 | 控制落点 | 失败行为 | 验证 |
|---|---|---|---|
| 外站诱导本机浏览器提交任务 | 会话 + CSRF + 精确 Origin/Host | `403`，不入队 | S20、S21；部署实测（W5） |
| 代理客户端伪造转发头 | 代理秘密 + 来源双核验 | `403 PROXY_SECRET_MISSING` | S21；设计 §3 |
| 多次提交／取消与晚到结果竞争 | 持久幂等键、原子领取、attempt/epoch fencing | 确定结果，不重复写 | S02、S04、S11、S15 |
| 重启后重发工具 | 持久化 `interrupted`／`needs_review`、取消意图保留 | 禁止自动重放 | S13、S14 |
| 凭据被写进排队快照 | 只存引用、执行前解析、run 私有注入 | 任务失败，秘密不落盘 | S18、S19；设计 §4 |
| 普通业务会话请求退出服务／读凭据 | 控制通道独立、控制秘密不交页面 | `403`／不可达 | 设计 §2、§3；W0 探针 |
| 恢复旧备份／旧根导致重发 | 持久恢复标记、任务隔离待核对、调度暂停 | 不自动重发 | S22、S23 |
| 模型／来源文本诱导 Bash 越界 | 模型输出按不可信输入校验，签收走可信 API | 通用 Bash 无沙箱，残余风险明确 | 设计 §7；不在本契约扩大边界 |

## 12. 依赖清单

### 12.1 可复用现有依赖与能力

| 项 | 版本／位置 | 用途 | 备注 |
|---|---|---|---|
| Node 内置 `node:http`／`node:fs`／`node:crypto`／`node:child_process` | Node ≥24（`package.json` engines） | HTTP/SSE、进程与哈希 | 无需新依赖 |
| `node:sqlite` | Node ≥24 内置 | 直接 SQLite 的备选 | 设计 §2 倾向由 Rust 适配统一拥有连接，是否使用待 MAYNE-20 探针结论 |
| `shared/dates.mjs` | 仓库 `shared/` | 日期／时间锚点 | 跨进程纯逻辑，已锁定 |
| `runtime/lib/organizer-contract.mjs` 校验风格 | 仓库 `runtime/` | 手写契约校验 | 沿用既有约定，不引第三方校验库 |
| Pi（`@sidekick/pi-*`） | `vendor/pi` 固定源码 | 模型／工具循环 | 只读上游，版本以固定提交为准 |
| `@larksuite/cli` | 1.0.98（`package.json`） | 飞书读取／提醒 | 既有依赖 |
| Vue／Pinia／Vite／TDesign／Tailwind／motion-v／@vueuse/core | 见 `package.json` | 前端 | 既有锁定版本 |

### 12.2 确需新增生产依赖（提案，未安装）

| 候选 | 版本依据 | 用途 | 可替代项 | 授权动作 |
|---|---|---|---|---|
| macOS Keychain 访问 | 系统 `security` CLI（macOS 自带） | 读取 `apiKeyRef` 指向的钥匙串项 | ① `security` CLI + `child_process`（零依赖，推荐 W0）；② 小型原生 helper／Swift 封装；③ 第三方 keytar 类模块（维护状态差） | 新增原生构建或第三方依赖需 owner 明确授权；W0 先用 ① |
| HTTP 框架 | — | 路由／中间件 | ① Node 内置 `node:http`（推荐 W0）；② `fastify`／`hono`／`express` | 若 ① 不满足，单列名称／版本／理由再授权 |
| 校验库 | — | 请求／响应校验 | ① 手写（沿用既有约定，推荐）；② `zod`／`valibot` | 同上一行 |
| SQLite 驱动 | — | 直接建连 | ① Rust 存储适配（设计 §2，推荐）；② `node:sqlite`；③ `better-sqlite3` | 改动存储所有权需授权 |

**结论**：W0 契约层面**不要求新增生产依赖**；上述候选均为条件项，在未获 owner 明确授权前不安装、不写入 `package.json`／锁文件。

## 13. 授权清单

### 13.1 本任务已获授权并在范围内完成

- 在任务工作树 `agent/claude/mayne-19` 写入 §0 所列三处文件；
- 运行只读与本地校验命令（JSON 解析、文档链接检查、哈希核对）；
- 形成契约、样例、schema／依赖提案与评审记录。

### 13.2 本任务未做、仍需具体授权的动作

| 动作 | 状态 |
|---|---|
| commit／push／合并、建远端 PR | 未做；由队长按后续 Git 授权收口 |
| 新增生产依赖、改 `package.json`／锁文件 | 未做；仅提案 |
| 执行真实 DDL／迁移、改业务 schema | 未做；仅提案 |
| 读取真实模型环境／凭据、操作真实工作根 | 未做 |
| 部署、代理配置、真实服务启停 | 未做 |
| 改 `vendor/pi`／`resources/skills`／identifier | 未做 |
| 修改共享 `product/05`、根 `README`、`package.json`、锁文件、全局文档索引 | 未做 |

## 14. 未验证项

- 本文为**设计契约候选**，未实现、未部署；没有真实服务、真实凭据、Linux 或原生证据。
- 未运行全量 `npm run check`：既有结构守卫与平台 `.multica` 元数据冲突（MAYNE-18 范围），不在本任务收口。
- `node:sqlite` 在目标 Node 的行为、macOS Keychain 服务身份解锁、Linux 环境与代理部署均为 MAYNE-20／后续切片的验证项，本文只引用其结论位置。
- SSE 在真实代理下的缓冲、重连与快照补偿需部署实测；本文只定义契约。
- 场景矩阵与样例为合成输入，不证明任何运行时行为。

## 15. 与现有实现的关系与冻结程序

- 当前生产代码仍为 Tauri/Rust 宿主；`RUNTIME_BUSY` 单飞槽与 store v1–v5 是**现状**，不是本契约的一部分（[Web/后端设计](web-backend-design.md) §8）。新后端不建旧 IPC／旧 schema 兼容桥。
- 本契约是 W0 候选交付，**未冻结**。契约冻结由队长在阶段末统一宣布；在冻结前，任何成员不得按本文开工，也不得把它作为已批准的目标契约引用。
- 独立评审：OpenCode（不参与本项实现）；最终收口与阶段晋级由 Codex 依据评审结论、精确版本／补丁哈希与本项证据处理。
