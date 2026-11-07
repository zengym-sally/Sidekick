# W0 schema 授权提案：`web-backend/1` 任务队列初始 DDL（2026-11-07，修订待批版）

> 状态：**提案（proposal），尚未获批、尚未实施**。本文只给出拟新增的 schema／迁移文件内容与授权请求，不改变 `web-api/1` 契约，不创建迁移文件，不执行任何 DDL，不操作真实数据库、凭据或工作根。文中所有 SQL 均为提案内容，供审批；获批前不得据此开工。
>
> 本版按队长 2026-11-07 技术裁定与 ZCode 独立评审 R1–R3 修订：R1 增加部分唯一索引 `task_attempts_current`（不走豁免）；R2 明确 `PRAGMA user_version` 为迁移进度权威、`schema_meta.schema_version` 为同事务镜像，不符显式拒绝；`task_result_payloads` 采纳并显式纳入 AUTH-SCHEMA-1a。

## 1. 目的与授权请求

本提案补齐 MAYNE-22 W0 授权包中的 `AUTH-SCHEMA-1`。ZCode 独立评审结论（2026-11-07）指出：`AUTH-SCHEMA-1` 原阶段不可批，原因是「逐表 DDL／表清单／回滚说明缺位」，并要求「届时须逐表列明后再请批」。本提案即对该缺位的补齐，并已按评审 R1–R3 与队长技术裁定修订。

依据为已接受的 `web-api/1` 契约 §12「数据结构提案（逻辑字段；非 DDL）」与《Web 与后端优先》设计 §5，并对照仓库既有迁移 `001–005` 的实际形态。

**请求批准的动作**：

1. 批准新服务数据库独立 lineage `web-backend/1` 的初始 schema 设计（§5 逐表 DDL），**明确包含 `task_result_payloads`**；
2. 批准拟新增迁移文件路径 `src-tauri/migrations/web-backend/001_web_backend.sql` 及其内容，以修订后完整 DDL 哈希绑定（§9）；
3. 批准该迁移仅作用于**新建**的 `web-backend/1` 库，不触碰既有库（§7）。

**明确不包含在授权内**：修改既有迁移 `001–005`；从旧 store（v1–v5）迁移任何数据；改变 `web-api/1` 的任何字段、端点、状态或错误码；安装任何依赖；操作真实数据库、凭据或工作根。本提案获批不等于实施已执行；迁移文件创建、runner 接线与测试仍须在获批后按仓库授权单独进行。

## 2. 依据与版本

| 项 | 值 |
|---|---|
| 契约 | `docs/engineering/web-api-contract.md`，`contractVersion: web-api/1`，MAYNE-19 已接受候选 `9d094d39937de9bdf910391e1776348fa8a576f9`（第九轮独立复核 APPROVE），随 `2e580aa` 合入；本提案撰写时该文件相对 `2e580aa` 零差异 |
| 契约文件 SHA-256 | `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` |
| 设计 | `docs/engineering/web-backend-design.md` SHA-256 `d318e525d699222bfdefe798addf56dc4bae0fc9e8d3df1fe9b492b2dc255387` |
| 集成候选 | `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`（tree `c6f20de7a5e92b6cc41268c8c254a24620388c6f`，集成补丁 SHA-256 `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e`）；其接受的 `web-api/1` 与本提案引用的契约文件内容一致 |
| 本提案基点 | 分支 `agent/claude/mayne-22`，basis commit `8a2a62878127a9c4e313616c6f6bfd9f48fa75be`（tree `91b1f92e…`）；本版为修订提交，提交号见 manifest `proposal_commit` |
| 既有迁移 | `src-tauri/migrations/001_todos.sql` … `005_today_advice.sql`（旧 store lineage `application_id=0x53444b31`，`user_version` 1–5） |
| 技术裁定 | 队长 2026-11-07：采纳 `task_result_payloads`；新库路径 `<workspaceRoot>/data/web-backend.sqlite`；`submit_seq` 提交写事务内 MAX+1；`progress` 不新增业务持久字段；索引谓词按冻结契约；实例自动重试预算默认 2（首次执行另算、可配置，仍受 `auto_backoff`/`proven_safe` 闸门约束），由提交显式注入，DDL 保守缺省 0 保留；事件重放留存数值随 W1 实施配置定案，不作为初始 DDL 审批前置，须保持短期有界、缺口快照补偿，不借此裁剪副作用回执。 |

## 3. 现状：既有迁移与旧 lineage

| 迁移 | 内容摘要 | 引入的表 |
|---|---|---|
| `001_todos.sql` | `PRAGMA application_id = 0x53444b31`；待办与事件 | `todos`、`todo_events` |
| `002_ingestion.sql` | 追加捕获方式／精度；重建事件表；来源／运行／候选／关联／操作 | `todo_events_v2`→`todo_events`、`sources`、`runs`、`candidates`、`todo_sources`、`ingestion_operations` |
| `003_agent_runs.sql` | 角色试跑 | `agent_runs` |
| `004_mcp_runs.sql` | MCP 探测与工具台账 | `agent_runs`（重建）、`tool_calls` |
| `005_today_advice.sql` | 今日建议 | `agent_runs`（重建）、相关索引／触发器 |

既有迁移的形态即本提案的约定来源：`PRAGMA application_id` 文件级归属标识；`CREATE TABLE` + `CHECK` 约束；重建表时以 `INSERT … SELECT` 保留 `rowid` 与字节；正向迁移、只追加已应用版本。新 lineage 不改动上述任何一行。

## 4. 提案目标与边界

- **新库、新 lineage**：`schema_meta.schema_lineage = "web-backend/1"`，`schema_version` 从 1 起。遇 lineage 不符或缺失的既有库一律显式报错，不静默新建、不续用、不合并。
- **新库路径**：经队长技术裁定，采用 `<workspaceRoot>/data/web-backend.sqlite`（与旧库 `<workspaceRoot>/data/sidekick.sqlite` 分离）。
- **无迁移桥**：与旧 v1–v5 store 之间不建数据迁移桥、不双写；既有库与历史资料保持不动。
- **迁移工具**：沿用已锁定的 `rusqlite_migration` 正向迁移模式；每个迁移在单个事务内应用，失败整体回滚。
- **WAL 与外键**：由连接在打开时设置（`PRAGMA journal_mode=WAL`、`PRAGMA synchronous=FULL`、`PRAGMA foreign_keys=ON`），不写入迁移文件。
- **状态迁移纪律**：所有状态变更使用带状态／版本条件的 `UPDATE` 并校验影响行数（fencing 的机械实现），详见 §5 各表约束与 §8 验收。

## 5. 逐表 DDL（提案）

> 以下为 `web-backend/1` 初始 schema 的完整 DDL。字段映射依据 `web-api/1` §12；类型与约束为工程化落地，均为提案。参考文件：`build/web-foundation-schema-authorization/ddl/001_web_backend.sql`（SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`）。

### 5.0 `schema_meta`（lineage 元数据）

```sql
PRAGMA application_id = 0x57424b31;  -- 裁定值；区别于旧 store 的 0x53444b31

CREATE TABLE schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_lineage TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    applied_at_ms INTEGER NOT NULL
);

INSERT INTO schema_meta (id, schema_lineage, schema_version, applied_at_ms)
VALUES (1, 'web-backend/1', 1, CAST(strftime('%s','now') AS INTEGER) * 1000);
```

`schema_version` 为**同事务维护的镜像**，权威为 `PRAGMA user_version`（见 §7.4）。

### 5.1 `tasks`（任务台账）

§12 字段全部落地。`state`／`attempt_exit_state`／`pending_outcome` 用 `CHECK` 枚举；`version` 为乐观并发版本；`submit_seq` 为持久提交顺序（FIFO）；`attempt_exit_state` 为槽位占用判据。

```sql
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    role TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','running','cancelling','succeeded','failed','cancelled','interrupted','needs_review')),
    version INTEGER NOT NULL CHECK (version >= 1),
    submit_seq INTEGER NOT NULL UNIQUE,
    attempt_exit_state TEXT NOT NULL CHECK (attempt_exit_state IN ('not_started','active','exiting','exited_unknown','exited_confirmed')),
    result_pending_exit INTEGER NOT NULL DEFAULT 0 CHECK (result_pending_exit IN (0,1)),
    pending_outcome TEXT CHECK (pending_outcome IN ('succeeded','failed')),
    config_revision TEXT NOT NULL,
    original_config_revision TEXT NOT NULL,
    input_ref TEXT NOT NULL,
    cancel_intent INTEGER NOT NULL DEFAULT 0 CHECK (cancel_intent IN (0,1)),
    next_attempt_at INTEGER,
    attempt_budget INTEGER NOT NULL DEFAULT 0 CHECK (attempt_budget >= 0),
    result_ref TEXT,
    failure TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    terminal_at INTEGER,
    CHECK ((result_pending_exit = 1 AND pending_outcome IS NOT NULL)
        OR (result_pending_exit = 0 AND pending_outcome IS NULL)),
    CHECK ((state IN ('succeeded','failed','cancelled') AND terminal_at IS NOT NULL)
        OR (state NOT IN ('succeeded','failed','cancelled') AND terminal_at IS NULL))
);
CREATE INDEX tasks_state_active ON tasks(state)
    WHERE state IN ('queued','running','cancelling','interrupted','needs_review');
CREATE INDEX tasks_exit_state ON tasks(attempt_exit_state)
    WHERE attempt_exit_state IN ('active','exiting','exited_unknown');
```

语义说明：

- `result_pending_exit=1` 当且仅当 `pending_outcome` 非空（暂存信封 `{outcome, result?, failure?}`）；`result`/`failure` 字段在暂存期间对外为 null，退出确认后与终态同事务提交。
- `cancel_intent` 仅表示「取消意图已持久且未终态」，不用于推断槽位；槽位只读 `attempt_exit_state`。
- `attempt_budget` 为剩余自动退避预算。**裁定默认 2 次**（首次执行另算，可配置，仍受 `auto_backoff`／`proven_safe` 闸门约束），由提交显式注入；DDL 保守缺省 0 保留。用户 `retry` 重置为配置值。
- `next_attempt_at` 为延迟重试时间，未到时不成阻塞后续就绪任务。
- `submit_seq` 为持久提交顺序；**裁定在同一提交写事务内以 `MAX(submit_seq)+1` 分配**，保留 UNIQUE 约束。
- `progress` 不入库：契约 §3.1 明确其「仅展示，不作为业务事实」，由 `task_events`（`task.progress`）与 worker 内存态派生；不新增业务持久字段。

### 5.2 `task_attempts`（尝试台账）

```sql
CREATE TABLE task_attempts (
    attempt_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    epoch TEXT NOT NULL,
    worker_pid INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_confirmed_at INTEGER,
    exit_reason TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK (exit_confirmed_at IS NULL OR exit_confirmed_at >= started_at)
);
-- R1：每任务至多一个未结束 attempt，schema 层强制（部分唯一索引，不走豁免）。
CREATE UNIQUE INDEX task_attempts_current ON task_attempts(task_id) WHERE ended_at IS NULL;
CREATE INDEX task_attempts_task ON task_attempts(task_id, started_at);
CREATE INDEX task_attempts_epoch ON task_attempts(epoch);
```

「当前 attempt」（API 的 `attemptId`）由 `task_id=? AND ended_at IS NULL` 唯一确定，并由 `task_attempts_current` 在 schema 层强制；`attemptCount` 由 `task_attempts` 计数派生。调度器不再仅靠纪律保证「至多一个未结束 attempt」。

### 5.3 `task_events`（通用对象事件流）

SSE 与审计同源；`object_type` ∈ `task/setting/workspace/recovery_hold`，与 SSE 信封 `objectType`/`objectId` 一一对应。

```sql
CREATE TABLE task_events (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    object_type TEXT NOT NULL CHECK (object_type IN ('task','setting','workspace','recovery_hold')),
    object_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    object_version INTEGER NOT NULL CHECK (object_version >= 1),
    epoch TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX task_events_object ON task_events(object_type, object_id);
CREATE INDEX task_events_epoch_cursor ON task_events(epoch, cursor);
```

`cursor` 用 `AUTOINCREMENT`：崩溃／回滚后不复用游标，满足「实例内单调递增」。留存**短期有界**（具体数值随 W1 实施配置定案，见 §10），权威状态以 SQLite 为准，缺口由快照补偿；**不得借此裁剪副作用回执**。

### 5.4 `side_effect_receipts`（外部回执台账）

`needs_review`、恢复核对与 `sideEffectSafety` 判定的数据基础：存在 `provable_readonly=0` 的调用即无法证明 `proven_safe`。

```sql
CREATE TABLE side_effect_receipts (
    receipt_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES task_attempts(attempt_id),
    kind TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    provable_readonly INTEGER NOT NULL CHECK (provable_readonly IN (0,1))
);
CREATE INDEX side_effect_receipts_attempt ON side_effect_receipts(attempt_id);
```

### 5.5 `workspace_operations`（工作根操作台账）

```sql
CREATE TABLE workspace_operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('switch','restore','backup')),
    target_root_id TEXT,
    backup_id TEXT,
    hold_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending','succeeded','failed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 5.6 `recovery_holds`（持久恢复标记）

```sql
CREATE TABLE recovery_holds (
    hold_id TEXT PRIMARY KEY,
    cause TEXT NOT NULL CHECK (cause IN ('backup_restore','root_activation','root_import')),
    paused_submissions INTEGER NOT NULL DEFAULT 1 CHECK (paused_submissions IN (0,1)),
    paused_scheduling INTEGER NOT NULL DEFAULT 1 CHECK (paused_scheduling IN (0,1)),
    paused_timers INTEGER NOT NULL DEFAULT 1 CHECK (paused_timers IN (0,1)),
    paused_outbox INTEGER NOT NULL DEFAULT 1 CHECK (paused_outbox IN (0,1)),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER
);
```

### 5.7 `recovery_items`（恢复核对条目）

每个 `needs_review` 任务对应一行；任务 `recovery.itemId`／`itemVersion` 指向此行；任务 `resolve` 与 hold 条目 `resolve` 共用该版本做乐观并发。

```sql
CREATE TABLE recovery_items (
    item_id TEXT PRIMARY KEY,
    hold_id TEXT REFERENCES recovery_holds(hold_id),
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    version INTEGER NOT NULL CHECK (version >= 1),
    verification_state TEXT NOT NULL CHECK (verification_state IN ('pending','verified','auto_safe','resumed','cancelled')),
    decision TEXT CHECK (decision IN ('resume','cancel')),
    decided_by TEXT,
    decided_at INTEGER,
    CHECK (decision IS NULL OR decided_by IS NOT NULL),
    CHECK (decision IS NULL OR decided_at IS NOT NULL)
);
CREATE INDEX recovery_items_hold ON recovery_items(hold_id);
CREATE INDEX recovery_items_task ON recovery_items(task_id);
```

### 5.8 `settings`（实例设置）

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1)
);
```

`agentConcurrency` 等实例级设置存此；`version` 为设置自身版本，与任务／条目版本无关。实例自动重试预算默认值（2）随实例配置注入，可在 `settings` 或配置修订中承载。

### 5.9 `instance_epochs`（实例更替）

```sql
CREATE TABLE instance_epochs (
    epoch TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    stopped_at INTEGER,
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
```

### 5.10 `task_result_payloads`（结果负载，已裁定采纳）

> **裁定状态：采纳**（队长 2026-11-07），**显式纳入 AUTH-SCHEMA-1a**。契约 §12 未逐表枚举本表，但 §4.3 的分段读取要求持久保存不透明字节并以 `result://<attemptId>/<name>` 寻址；`tasks.result_ref` 只保存信封 `{kind, payloadRef, acceptedByAttempt, completedAt}`，不含大负载本身。

```sql
CREATE TABLE task_result_payloads (
    attempt_id TEXT NOT NULL REFERENCES task_attempts(attempt_id),
    name TEXT NOT NULL,
    payload_blob BLOB NOT NULL,
    total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (attempt_id, name),
    CHECK (total_bytes = length(payload_blob))
);
```

### 5.11 索引汇总

契约 §12 要求的索引（`tasks(operation_id)` 由 UNIQUE 隐式建立、`tasks(submit_seq)` 由 UNIQUE 隐式建立）：

| 索引 | 表 | 说明 |
|---|---|---|
| `tasks(operation_id)` UNIQUE | `tasks` | 幂等键 |
| `tasks(submit_seq)` UNIQUE | `tasks` | FIFO 顺序（提交事务内 MAX+1） |
| `tasks_state_active` | `tasks` | 部分索引，非终态；调度／列表查询 |
| `task_events_object` | `task_events` | `(object_type, object_id)` |
| `task_events_epoch_cursor` | `task_events` | 重连／快照补偿 |
| `task_attempts_current` | `task_attempts` | 部分唯一索引；至多一个未结束 attempt（R1，裁定不走豁免） |
| `task_attempts_task` | `task_attempts` | 按任务取 attempt |
| `task_attempts_epoch` | `task_attempts` | fencing 审计 |
| `side_effect_receipts_attempt` | `side_effect_receipts` | 按 attempt 取回执 |
| `recovery_items_hold` / `recovery_items_task` | `recovery_items` | hold 报告与任务反查 |
| `tasks_exit_state` | `tasks` | 部分索引；槽位核算 |

## 6. 拟新增迁移文件与数据影响

### 6.1 拟新增文件与实施动作（AUTH-SCHEMA-1d 目标）

| 路径 | 内容 | 状态 |
|---|---|---|
| `src-tauri/migrations/web-backend/001_web_backend.sql` | §5 全部 DDL（含 `schema_meta` 初始行） | **提案，未创建** |
| `src-tauri/src/store/web_backend_schema.rs` | runner 与校验：`Migrations::new(vec![M::up(include_str!("../../migrations/web-backend/001_web_backend.sql"))])`、lineage／版本一致性校验（§7.4）、WAL／`foreign_keys`／`synchronous` 连接设置、一致性备份接口 | **实施项（1d）** |
| `src-tauri/src/store/web_backend_schema_tests.rs` | 校验单测：迁移幂等、lineage／版本镜像一致性（含 R2 反例）、`task_attempts_current`（R1 反例）、各表约束反例 | **实施项（1d）** |

实施动作（获批后）：创建上述文件；在 `src-tauri/src/store/mod.rs` 登记 `web_backend_schema` 模块；运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` 与 `npm run check`。未来同 lineage 的变更以 `002_*.sql` 等追加，`schema_version` 递增；不修改 `001` 已应用内容。

### 6.2 数据影响

- **新建空库**：首次打开 `<workspaceRoot>/data/web-backend.sqlite` 时创建并应用 `001`，写入 `schema_meta` 一行与全部空表。无既有行。
- **零数据迁移**：不从旧 store 复制／转换任何行；旧库 `sidekick.sqlite` 不被打开写入，历史资料不删除。
- **新服务为任务／队列／恢复事实的唯一写入方**：W1+ 切片的任务、事件、回执、hold、设置写入本库；旧 `runs`／`agent_runs` 仅服务既有功能，不被新契约复用。
- **用户可见影响**：无。新库在首次启动时静默创建；若检测到 lineage 不符或损坏则显式报错、不静默新建。

## 7. 回滚与恢复方案

### 7.1 迁移失败（事务级）

`rusqlite_migration` 在单个事务内应用每个迁移。DDL 或 `INSERT` 失败 → 事务整体回滚 → 库停留在上一版本 → 显式报错。不自动重试、不跳过、不部分应用。

### 7.2 初始迁移的回滚

- **空库场景**：新库无用户数据，回滚等价于删除该库文件（及 `-wal`／`-shm`）；下次打开重新创建。
- **已有数据场景**（未来 `002+` 迁移）：迁移前必须做一致性备份，回滚 = 用备份还原；不以「删除表」或「版本号回退」代替数据回退。

### 7.3 备份与还原

- 备份：关闭或 checkpoint WAL 后，用 `rusqlite::backup::Backup`（或 `VACUUM INTO`）生成带时间戳的一致性副本，存放于工作根 `backups/` 目录；备份前后校验 `PRAGMA quick_check`。
- 还原：显式恢复入口触发；先停止提交／调度，确认旧进程树退出，再用备份替换库文件并重新校验 lineage／版本／完整性。
- 备份不是「回滚」：版本号不回退，旧包不兼容时按设计走兼容包或保护原根后恢复。

### 7.4 打开校验（每次连接）

1. 库不存在且非初始化 → `MISSING_DATABASE` 类显式错误，不静默新建。
2. `PRAGMA quick_check` 非 `ok` → `CORRUPT_DATABASE`，不写入、不重建。
3. `application_id` 非 `0x57424b31` 且库非空 → `UNKNOWN_DATABASE`，不合并、不覆盖。
4. `schema_meta` 缺失或 `schema_lineage != "web-backend/1"` → `SCHEMA_LINEAGE_MISMATCH`，不新建、不续用。
5. **版本镜像一致性（R2）**：读取 `PRAGMA user_version` 与 `schema_meta.schema_version`；两者不等即 `SCHEMA_VERSION_MISMATCH` 显式拒绝，**不自动修复、不回写**。
6. `schema_version` 高于本代码支持 → `SCHEMA_TOO_NEW`；低于支持 → 应用待执行迁移；相等 → 正常打开。
7. 库为空（无表、`application_id=0`、`user_version=0`）且允许初始化 → 应用 `001`。

**R2 依据**：已锁 `rusqlite_migration 2.5.0` 的 `goto_up`（`src/lib.rs:627-653`）在**单个事务内**依次执行 `tx.execute_batch(m.up)` → `set_user_version(&tx, target_version)` → `tx.commit()`，迁移 SQL 中的 `schema_meta` 镜像写入与 `user_version` 天然原子。因此 `PRAGMA user_version` 是迁移进度权威；`schema_meta.schema_version` 为同事务镜像，仅供快速读与审计，不作为独立进度来源。

**R2 反例**（合成验证见 `build/web-foundation-schema-authorization/verification/`）：

| `user_version` | `schema_meta.schema_version` | 结果 |
|---|---|---|
| 1 | 1 | 正常打开 |
| 1 | 0 | `SCHEMA_VERSION_MISMATCH` 拒绝 |
| 0 | 1 | `SCHEMA_VERSION_MISMATCH` 拒绝 |
| 2 | 1 | `SCHEMA_VERSION_MISMATCH` 拒绝（并同时触发 `SCHEMA_TOO_NEW` 判定路径） |
| 1 | 缺失 | `SCHEMA_LINEAGE_MISMATCH` 拒绝 |

### 7.5 恢复保持

若恢复标记（`recovery_holds`）打开：新提交／调度／定时／outbox 暂停；未完成任务隔离为 `needs_review`；全部条目处置完毕后才关闭 hold、恢复普通调度。新库的恢复入口与备份还原共用同一边界（设计 §5、§8.3）。

## 8. 验收命令

以下命令在实施切片完成后执行；当前均为**待实施**，本轮不执行、不代替实施。本轮已完成的合成验证见 `build/web-foundation-schema-authorization/verification/verify-schema-result.txt`。

**聚焦 schema／迁移测试**（实施时新增，命名见 §6.1）：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1
```

覆盖：初始迁移幂等（重复应用不报错、版本不变）；lineage 不符显式报错；`user_version`／`schema_meta.schema_version` 一致性与 R2 反例；版本过新报错；空库初始化；`quick_check` 通过；`schema_meta` 行正确；`task_attempts_current` 部分唯一索引反例（R1）；各表约束（枚举、终态 `terminal_at`、暂存 `pending_outcome`、`total_bytes=length(payload_blob)`）反例拒绝。

**结构与文档门禁**：

```bash
npm run check:structure
npm run check:docs
```

**完整门禁**（W0 准出条件，由唯一集成执行者串行执行，不在本提案触发）：

```bash
npm run check
```

**手工核对**（实施后，仅对隔离测试库）：

```bash
sqlite3 <test-db> "PRAGMA user_version;"                       # 期望 1
sqlite3 <test-db> "SELECT schema_lineage,schema_version FROM schema_meta;"  # 期望 web-backend/1, 1
sqlite3 <test-db> "PRAGMA application_id;"                     # 期望 1463962417 (0x57424b31)
sqlite3 <test-db> "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
sqlite3 <test-db> "PRAGMA quick_check;"
```

**R1 反例**（受控并发，实施验收时）：同一 task 插入两个 `ended_at IS NULL` 的 attempt，第二个被 `task_attempts_current` 拒绝；将第一个 `ended_at` 置非空后，可插入新 attempt。本轮合成验证已通过。

**R2 反例**：构造 `user_version` 与 `schema_meta.schema_version` 不一致的内存库，校验函数拒绝且不自动修复。本轮合成验证已通过。

**fencing 反例**（受控并发，实施验收时）：`queued` 上「取消」与「领取」并发，恰有一个事务胜出；旧 epoch 的晚到结果被拒并记审计事件；`exited_unknown` 仍占槽、`resolve` 返回 `exit_unconfirmed`。

## 9. 授权清单（AUTH-SCHEMA-1）

| 项 | 拟批准内容 | 触发条件（建议） | 状态 |
|---|---|---|---|
| AUTH-SCHEMA-1a | 批准 `web-backend/1` 初始 schema 设计（§5），**明确包含 `task_result_payloads`** | 本提案经增量复核通过 | **待批准** |
| AUTH-SCHEMA-1b | 批准创建迁移文件 `src-tauri/migrations/web-backend/001_web_backend.sql`，内容以修订后完整 DDL 哈希 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` 绑定 | 同 1a | **待批准** |
| AUTH-SCHEMA-1c | 批准该迁移仅作用于新建 `web-backend/1` 库；旧库不动、无数据迁移 | 同 1a | **待批准** |
| AUTH-SCHEMA-1d | 批准实施切片创建／接线：`src-tauri/src/store/web_backend_schema.rs`（runner＋校验）、`src-tauri/src/store/web_backend_schema_tests.rs`（单测）、`src-tauri/migrations/web-backend/001_web_backend.sql`；动作＝`cargo test --lib web_backend_schema`、`npm run check` | 完整 `npm run check` exit 0 且增量复核通过 | **待批准** |

**所有动作尚未获批且未实施**：本轮未创建迁移文件、未改 runner、未执行 DDL、未操作任何数据库。授权包准备不等于授权执行。

## 10. 逐项处置表

| # | 未决项 | 处置 | 依据 |
|---|---|---|---|
| 1 | `task_result_payloads` 是否入库 | **裁定采纳**，显式纳入 AUTH-SCHEMA-1a | 队长裁定；§4.3 分段读取 |
| 2 | 新库文件路径 | **裁定** `<workspaceRoot>/data/web-backend.sqlite` | 队长裁定 |
| 3 | `attempt_budget` 默认值 | **裁定**默认 2（首次另算、可配置），提交显式注入，DDL 缺省 0 保留 | 队长裁定；§4.6 |
| 4 | `submit_seq` 分配策略 | **裁定**提交写事务内 MAX+1，保留 UNIQUE | 队长裁定；§3.1 |
| 5 | `application_id` 取值 | **裁定**按提案 `0x57424b31` | 队长裁定 |
| 6 | 部分索引谓词 | **契约已定**（§12），实施时 `EXPLAIN QUERY PLAN` 复核 | ZCode 分类 |
| 7 | `task_events` 留存期限 | **实施定案**（随 W1 配置），初始 DDL 审批非前置；须短期有界＋快照补偿，不裁剪回执 | 队长裁定 |
| 8 | `progress` 是否持久化 | **契约已定**不持久化（§3.1） | ZCode 分类 |

## 11. 版本与哈希

| 项 | 值 |
|---|---|
| 提案文档 | `docs/reviews/web-foundation-integration-schema-authorization-20261107.md`（本文件，不自称哈希） |
| DDL 参考文件 | `build/web-foundation-schema-authorization/ddl/001_web_backend.sql`（SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`） |
| 哈希清单 | `build/web-foundation-schema-authorization/schema-authorization-manifest.json`（含 `basis_commit`／`proposal_commit`、交付物与依据哈希） |
| 合成验证 | `build/web-foundation-schema-authorization/verification/verify-schema-result.txt`（16 项全过） |
| 状态 | 提案（修订待批），未获批，未实施 |
