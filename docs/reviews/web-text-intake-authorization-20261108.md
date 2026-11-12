# W1 文本整理与签收：逐文件变更与授权差异提案（2026-11-08，MAYNE-24 P1）

> 状态：**提案（proposal），未获批、未实施**。本文是 MAYNE-24 P1 的授权对应与变更清单；只给出拟新增／修改／删除的文件、拟议 DDL 与授权请求，不创建迁移文件、不安装依赖、不改 manifest/锁文件/守卫、不操作真实数据库、凭据或工作根。
> 实际基点：本地 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5` / tree `77a548591ac9b02a51936c806bf4f85d774df7cb`（未 push）。契约内容见[文本整理与签收纵向契约](../engineering/web-text-intake-contract.md)。
> 依据：owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`、owner 批准 `01a1b80b-f132-716c-bebb-28f260f0c73d`（W1 A–D）、MAYNE-23 已 done、[Web API 契约](../engineering/web-api-contract.md)（`web-api/1` 已冻结）、[手工事项契约](../engineering/web-manual-items-contract.md)（含附录 A/B）、[Web/后端设计](../engineering/web-backend-design.md)、[工程架构](../engineering/architecture.md)。

## 1. 目的

MAYNE-24 文本整理与签收纵向切片需要：新库表（文本来源/候选/预览/事项来源关联/签收批次台账）、`manual_items`／`manual_item_events` 扩展、后端文本与任务服务、任务系表的写权限、并发设置模板、Pi Runtime 进程接线与 bundle 纳入、配置与凭据 provider、前端 HTTP 切换。本文件逐项对应到现有授权，分清**已覆盖**、**需要进一步具体化**与**真正需要新增批准**，并给出完整拟议 DDL、写权限闭合表与数据影响。

## 2. 现有授权台账

| 来源 | 内容 | 范围 |
|---|---|---|
| owner `01a1b648`（2026-11-07） | 全新建表方案；完成后的本地提交、合入本地 main、清理已合并分支 | 原则与 Git 动作 |
| owner `01a1b80b`（2026-11-07） | **批准 W1 A–D**：002 两表；`server/` 与 `src-tauri/src/bin/` 新目录及守卫；`Cargo.toml` 的 `[[bin]]`；`build-backend.mjs` 与脚本（零新增生产依赖） | 仅 W1 精确清单 |
| MAYNE-23 已 done | 手工事项契约（含附录 A/B）、002 DDL `b6cb8e61…f97e`、W1 实现已合入 main `1e37044`，完整门禁 51 组通过 | 已审契约与实现 |
| [实施计划 §当前实施总览](../product/05-第一阶段实施计划.md) | 依赖安装与库版本须具体清单授权；真实模型/飞书凭据、生产部署、真实工作根操作须对应授权；Git 授权不含 push | 边界 |

## 3. 授权对应表

| # | 拟批准动作 | 来源 | 处置 | 说明 |
|---|---|---|---|---|
| 1 | 新 lineage 新表方案（不做历史迁移、不建兼容桥） | owner `01a1b648` | **已覆盖（原则）** | 本切片沿用 `web-backend/1` 新库；具体表清单见 §5，仍须本提案评审 |
| 2 | 具体 DDL：`003_text_intake.sql`（5 新表＋`manual_items`／`manual_item_events` 双表重建） | 本提案 §5 | **需要进一步具体化／新增批准** | 不把 W1 的 002 授权扩为新表已获批 |
| 3 | Rust `BUSINESS_TABLES` 扩展写目标（15 表，含 001 任务系表） | 本提案 §4/§5.2／契约 §5.4 | **需要新增批准** | 现守卫仅 `manual_items`／`manual_item_events`；任务系表（`tasks`／`task_attempts`／`task_events`／`task_result_payloads`／`side_effect_receipts`／`instance_epochs`／`recovery_holds`／`recovery_items`）与本切片 5 新表均须纳入，否则队列/结果/恢复写全被拒；不得改全库放行 |
| 4 | settings 写模板新增 `agentConcurrency` 两条（INSERT＋expectedVersion CAS） | 本提案 §5.2／契约 §5.4 | **需要新增批准** | 时区模板原样保留；其它 settings 写仍拒；`GET` 缺省 3/version 0 不写库 |
| 5 | Pi Runtime 纳入后端 bundle（`build-backend.mjs` 复制 runtime 产物） | 本提案 §4 | **需要新增批准** | 构建接入变更；不引新依赖、不改 vendor |
| 6 | 生产 OS CredentialProvider（Keychain/env） | 设计 §4 | **需要新增批准（实施时）** | 受控测试 provider 先行；生产 provider 的实施需另行授权 |
| 7 | 完成后的本地提交 | owner `01a1b648` | **已覆盖** | 不重复索取 |
| 8 | 合入本地 main | owner `01a1b648` | **已覆盖** | 不重复索取 |
| 9 | 清理已合并任务分支 | owner `01a1b648` | **已覆盖** | 不重复索取 |
| 10 | 新增生产依赖 | — | **不需要（首选零依赖）** | HTTP／队列／进程接线用 `node:http`／`node:child_process`／`node:crypto`；不引新依赖 |
| 11 | `package.json` 新增启动／测试脚本 | 本提案 §4 | **需要进一步具体化** | 脚本非依赖；共享文件由集成任务统一维护 |
| 12 | 完整 `npm run check` | 集成流程 | **已覆盖（流程要求）** | 唯一集成执行者在实际集成版本串行执行 |
| 13 | push | — | **未授权** | 不在本切片范围 |
| 14 | 部署、真实凭据/工作根、真实模型调用 | — | **未授权** | 受控模型路径先行；真实模型验收另行开放 |

## 4. 逐文件拟新增／修改／删除

### 4.1 生产代码（拟新增，均在 `server/`）

| 路径 | 内容 |
|---|---|
| `server/lib/text-intake-service.mjs` | 来源/候选/预览/签收事务 |
| `server/lib/task-service.mjs` | 任务提交/查询/取消/重试/并发 |
| `server/lib/task-scheduler.mjs` | 单写者调度循环、槽位分配、取消/退出处理 |
| `server/lib/worker-host.mjs` | Pi 子进程 stdio 协议、超时、取消、worker 记录 |
| `server/lib/task-recovery.mjs` | 重启扫描与恢复分流 |
| `server/lib/config-store.mjs` | 工作根 `config/` 原子读写与修订 |
| `server/lib/credential-provider.mjs` | 凭据引用解析接口＋controlled/os 实现 |
| `server/lib/model-snapshot.mjs` | 任务输入快照 |

### 4.2 生产代码（拟修改）

| 路径 | 修改 | 说明 |
|---|---|---|
| `src/lib/web-api-client.ts` | 扩展 text-sources/candidates/sign-offs/tasks/models/agents 方法 | 复用既有 `WebApiClient` 与会话/CSRF 通道 |
| `src/stores/organizer.ts` | `invoke` → HTTP（`createOrganizerModel(httpBackend, guard)`） | 保留 `src/domain/organizer.ts`／`candidate.ts` 与组件 |
| `src/stores/models.ts` | `invoke` → HTTP | 配置端点 |
| `src/stores/agents.ts` | `invoke` → HTTP（本切片只接线 `organizer`） | tracker/advisor 后续；今日只保留事项事实与完成，advisor 归 W2 |
| `src-tauri/src/store/web_backend_store.rs` | `BUSINESS_TABLES` 扩展 15 表；settings 写模板新增 `agentConcurrency` 两条；写目标分派与拒绝反例 | 时区模板原样保留；其它 settings 写仍拒；见 §5.2 |
| `src-tauri/src/store/web_backend_store_tests.rs` | 新表写目标、settings 模板与拒绝反例 | 与 runner 语义一致 |
| `scripts/build/build-backend.mjs` | 将 `build/s0-runtime` 的 `organizer.mjs` 及依赖复制进 `build/web-backend/runtime/` | 不引新依赖、不改 vendor |
| `package.json` | 新增启动／测试脚本（如 `start:backend`、`test:web-text-intake`） | 共享文件，集成任务统一维护 |

### 4.3 测试（拟新增）

| 路径 | 覆盖 |
|---|---|
| `tests/unit/web-text-intake.test.mjs` | 服务层纯逻辑：候选校验、版本、幂等、签收原子性、时间核对 |
| `tests/integration/web-text-intake-http.test.mjs` | HTTP 端到端：来源/候选/预览/签收/错误包络（合成根、临时端口） |
| `tests/integration/web-text-intake-queue.test.mjs` | 提交/排队/取消/退出未知/重启核实/有界重试 |
| `tests/integration/web-text-intake-controlled-model.test.mjs` | 受控服务经真实 Pi 执行 extract/revise/test |
| `tests/integration/web-text-intake-static.test.mjs` | 同源静态与宽窄屏冷启动（复用 W1 模式） |
| `src-tauri/src/store/web_backend_store_tests.rs`（修改） | 新表写目标与拒绝反例 |

### 4.4 文档（拟修改）

| 路径 | 修改 | 说明 |
|---|---|---|
| `docs/product/05-第一阶段实施计划.md` | 状态更新 | **共享文件，集成任务统一维护，本提案不写** |
| `docs/reviews/README.md` | 索引登记 | **共享文件，集成任务统一维护，本提案不写** |

### 4.5 拟删除

无。既有 Tauri/Rust 实现与历史证据保留；旧路径不再作为新业务唯一写入方。

### 4.6 依赖图与可并行范围

```text
003 DDL + Rust BUSINESS_TABLES 扩展
        │
        ├──> config-store / credential-provider（controlled）
        │
        └──> task-service ─> task-scheduler ─> worker-host ─> Pi Runtime 子进程
                        │
                        └──> task-recovery（重启扫描）
        │
        └──> text-intake-service ─> /api/text-sources|/api/candidates|/api/sign-offs
                        │
                        └──> web-api-client 扩展 ─> organizer/models/agents/today stores ─> 既有组件
```

- **可并行**：①数据层（003＋Rust 写目标）；②配置/凭据；③任务底座；④文本与候选服务；⑤Pi bundle 接线；⑥前端接线。①③⑤可并行（写入路径不同：迁移/Rust、`server/` 任务模块、`scripts/build/`）；②④依赖①，⑥依赖④。
- **模块对接签名**（提案）：
  - `text-intake-service.mjs`：`submitSource(operationId,input)`、`listSources(cursor,limit)`、`getSource(sourceId)`、`editCandidate(candidateId,operationId,expectedVersion,input,timeReviewed)`、`discardCandidate(candidateId,operationId,expectedVersion)`、`requestRevision(candidateId,operationId,instruction)`、`applyPreview(candidateId,runId,operationId,expectedVersion)`、`signOff(operationId,choices)`。
  - `task-service.mjs`：`submit(operationId,type,role,input)`、`list(query)`、`get(taskId)`、`cancel(taskId,expectedVersion?)`、`retry(taskId,expectedVersion,configRevision?)`、`readResult(taskId,offset,limit)`、`readConcurrency()`、`writeConcurrency(value,expectedVersion)`。
  - `task-scheduler.mjs`：`start()`、`stop()`、`tick()`、`recover()`。
  - `worker-host.mjs`：`spawn(task)`、`cancel(runId,hostNonce)`、`confirmExit(runId)`。
  - `config-store.mjs`：`read(kind)`、`write(kind,value,expectedRevision)`。
  - `credential-provider.mjs`：`resolve(ref)`、`status(ref)`。
- **公共文档**：`docs/product/05`／`docs/reviews/README.md` 由集成任务统一维护，本提案不写。

## 5. 拟议 DDL（`003_text_intake.sql`）

> 本节为提案内容，**不创建文件、不执行 DDL**。迁移文件路径：`src-tauri/migrations/web-backend/003_text_intake.sql`。

### 5.1 完整 DDL

```sql
-- Proposed migration: src-tauri/migrations/web-backend/003_text_intake.sql
-- Lineage: web-backend/1 (schema_version 3)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/engineering/web-text-intake-contract.md §4/§6 and
--        docs/engineering/web-api-contract.md (web-api/1, frozen).
-- Appends to frozen 001/002; does not modify them.
--
-- The runner applies every migration in ONE transaction with
-- `PRAGMA foreign_keys=ON` (web_backend_schema.rs::configure_connection).
-- `ALTER TABLE ... RENAME` is used for both tables so the child FK is
-- repointed to the rebuilt parent; the old child is dropped before the old
-- parent, so no FK blocks the rebuild. Existing rows are preserved
-- byte-for-byte (rowid is NOT promised). The AUTOINCREMENT high-water is
-- preserved explicitly so a hard-deleted tail can never be reused.

-- 0. Capture the historical AUTOINCREMENT high-water before the rebuild.
CREATE TABLE _web_backend_seq_high_water (name TEXT PRIMARY KEY, seq INTEGER);
INSERT INTO _web_backend_seq_high_water(name, seq)
SELECT 'manual_item_events', seq FROM sqlite_sequence WHERE name = 'manual_item_events';

-- 1. Parent first: rebuild manual_items with source extended to signed_ai.
CREATE TABLE manual_items_v3 (
    item_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('action','followup')),
    owner TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
    status TEXT NOT NULL CHECK (status IN ('open','completed','deleted')),
    due_at_ms INTEGER, due_timezone TEXT, due_local TEXT,
    due_precision TEXT NOT NULL DEFAULT 'minute' CHECK (due_precision IN ('minute','day')),
    followup_at_ms INTEGER, followup_timezone TEXT, followup_local TEXT,
    followup_precision TEXT NOT NULL DEFAULT 'minute' CHECK (followup_precision IN ('minute','day')),
    tags_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER, deleted_at_ms INTEGER,
    version INTEGER NOT NULL CHECK (version >= 1),
    source TEXT NOT NULL CHECK (source IN ('manual','signed_ai')),
    CHECK ((due_at_ms IS NULL AND due_timezone IS NULL AND due_local IS NULL)
        OR (due_at_ms IS NOT NULL AND due_timezone IS NOT NULL AND due_local IS NOT NULL)),
    CHECK ((followup_at_ms IS NULL AND followup_timezone IS NULL AND followup_local IS NULL)
        OR (followup_at_ms IS NOT NULL AND followup_timezone IS NOT NULL AND followup_local IS NOT NULL)),
    CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL)
        OR (status <> 'completed' AND completed_at_ms IS NULL)),
    CHECK ((status = 'deleted' AND deleted_at_ms IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at_ms IS NULL))
);
INSERT INTO manual_items_v3
    (item_id,title,kind,owner,priority,status,
     due_at_ms,due_timezone,due_local,due_precision,
     followup_at_ms,followup_timezone,followup_local,followup_precision,
     tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source)
SELECT item_id,title,kind,owner,priority,status,
       due_at_ms,due_timezone,due_local,due_precision,
       followup_at_ms,followup_timezone,followup_local,followup_precision,
       tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source
FROM manual_items;

-- 2. Child: rebuild manual_item_events with the link action and an FK to the
--    rebuilt parent. Copy preserves row order and the sequence values.
CREATE TABLE manual_item_events_v3 (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES manual_items_v3(item_id),
    action TEXT NOT NULL CHECK (action IN ('create','update','complete','reopen','delete','link')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL
);
INSERT INTO manual_item_events_v3
    (sequence,operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json)
SELECT sequence,operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json
FROM manual_item_events;

-- 3. Drop the old child first, then the old parent (no FK blocks).
DROP TABLE manual_item_events;
DROP TABLE manual_items;

-- 4. Rename both to the frozen names (RENAME repoints the child FK).
ALTER TABLE manual_items_v3 RENAME TO manual_items;
ALTER TABLE manual_item_events_v3 RENAME TO manual_item_events;

-- 5. Restore the historical AUTOINCREMENT high-water (migration-only write to
--    sqlite_sequence; never in the business transact whitelist).
DELETE FROM sqlite_sequence WHERE name = 'manual_item_events';
INSERT INTO sqlite_sequence(name, seq)
SELECT 'manual_item_events', seq FROM _web_backend_seq_high_water WHERE seq IS NOT NULL;
DROP TABLE _web_backend_seq_high_water;

-- 6. Rebuild the frozen index set under the original names.
CREATE INDEX manual_items_status ON manual_items(status, kind);
CREATE INDEX manual_items_open_time ON manual_items(kind, followup_at_ms, due_at_ms)
    WHERE status = 'open';
CREATE INDEX manual_items_list_order ON manual_items(created_at_ms DESC, item_id ASC);
CREATE INDEX manual_item_events_item ON manual_item_events(item_id, sequence);

-- 7. Text sources (one per intake; fingerprint dedups re-submission).
CREATE TABLE text_sources (
    source_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('text')),
    raw_text TEXT NOT NULL,
    source_at_ms INTEGER,
    imported_at_ms INTEGER NOT NULL,
    anchor_at_ms INTEGER NOT NULL,
    time_zone TEXT NOT NULL,
    succeeded_run_id TEXT REFERENCES tasks(task_id),
    CHECK (source_at_ms IS NULL OR source_at_ms > 0)
);
CREATE INDEX text_sources_imported ON text_sources(imported_at_ms DESC, source_id ASC);

-- 8. Candidate cards (versioned, signable, source-evidenced). `staged` rows are
--    written by the result-staging transaction and are invisible/unsignable
--    until the worker exit is confirmed (frozen web-api/1 §3.2).
CREATE TABLE candidates (
    candidate_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES text_sources(source_id),
    run_id TEXT NOT NULL REFERENCES tasks(task_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
    status TEXT NOT NULL CHECK (status IN ('staged','pending','accepted','discarded')),
    version INTEGER NOT NULL CHECK (version >= 1),
    fields_json TEXT NOT NULL,
    evidence TEXT NOT NULL,
    due_expression TEXT,
    followup_expression TEXT,
    warnings_json TEXT NOT NULL,
    unresolved INTEGER NOT NULL CHECK (unresolved IN (0,1)),
    accepted_item_id TEXT REFERENCES manual_items(item_id),
    processed_at_ms INTEGER,
    UNIQUE (source_id, ordinal),
    CHECK ((status = 'accepted' AND accepted_item_id IS NOT NULL AND processed_at_ms IS NOT NULL)
        OR (status = 'discarded' AND accepted_item_id IS NULL AND processed_at_ms IS NOT NULL)
        OR (status IN ('staged','pending') AND accepted_item_id IS NULL AND processed_at_ms IS NULL))
);
CREATE INDEX candidates_pending ON candidates(source_id, ordinal) WHERE status = 'pending';
CREATE INDEX candidates_status ON candidates(status, source_id, ordinal);

-- 9. Natural-language revise previews (never auto-applied).
CREATE TABLE candidate_previews (
    preview_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    run_id TEXT NOT NULL REFERENCES tasks(task_id),
    candidate_version INTEGER NOT NULL CHECK (candidate_version >= 1),
    draft_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);
CREATE INDEX candidate_previews_candidate ON candidate_previews(candidate_id, candidate_version);

-- 10. Item <-> source <-> candidate association with evidence.
CREATE TABLE manual_item_sources (
    item_id TEXT NOT NULL REFERENCES manual_items(item_id),
    source_id TEXT NOT NULL REFERENCES text_sources(source_id),
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    evidence TEXT NOT NULL,
    association TEXT NOT NULL CHECK (association IN ('new','manual_link')),
    operation_id TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (item_id, candidate_id)
);
CREATE INDEX manual_item_sources_source ON manual_item_sources(source_id);
CREATE INDEX manual_item_sources_item ON manual_item_sources(item_id);

-- 11. Batch sign-off ledger: one row per client batch operationId, binding the
--     canonical request and the candidate -> item ID mapping. Per-row
--     operationIds are the deterministic `sign_off:` + SHA-256(UTF-8 JSON
--     ["sign_off", batchOperationId, candidateId]) keys, so the frozen per-row
--     UNIQUE constraints are satisfied without widening the event table's
--     namespace. Replay reads the current authoritative objects by mapping.
CREATE TABLE sign_off_batches (
    operation_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    CHECK ((status = 'succeeded' AND completed_at_ms IS NOT NULL)
        OR (status = 'failed' AND completed_at_ms IS NOT NULL)
        OR (status NOT IN ('succeeded','failed') AND completed_at_ms IS NULL))
);
CREATE INDEX sign_off_batches_created ON sign_off_batches(created_at_ms DESC);

-- 12. Advance the schema_meta mirror inside the SAME migration transaction.
UPDATE schema_meta SET schema_version = 3 WHERE id = 1;
```

### 5.2 lineage／版本与冻结迁移保留

- **lineage 不变**：`schema_meta.schema_lineage` 仍为 `web-backend/1`；`schema_version` 由 2 递增为 3。
- **权威与镜像**：`PRAGMA user_version` 为迁移进度权威，`schema_meta.schema_version` 为同事务镜像；镜像更新由 003 内的 `UPDATE` 完成（沿用 W0 R2／W1 B1 契约）。
- **冻结保留**：`001_web_backend.sql`（`8511907c…143d`）与 `002_manual_items.sql`（`b6cb8e61…f97e`）逐字节不变；003 只追加。
- **runner 改动**：`web_backend_schema.rs` 的 `SCHEMA_VERSION` 改为 3，`migrations()` 追加 003；故障注入分支适配三迁移（在 003 之后注入失败，验证整体回滚到 v2）。runner **无需**为 003 增加迁移前备份钩子（见 §5.4）。
- **守卫改动**：`IMMUTABLE_MIGRATIONS` 在 003 定稿后追加其精确 SHA-256；`BUSINESS_TABLES` 扩展为 **15 表**——既有 `manual_items`／`manual_item_events`，加上 `text_sources`／`candidates`／`candidate_previews`／`manual_item_sources`／`sign_off_batches`／`tasks`／`task_attempts`／`task_events`／`task_result_payloads`／`side_effect_receipts`／`instance_epochs`／`recovery_holds`／`recovery_items`（写目标分派，**不得改全库放行**）。
- **settings 写模板**：在既有 `application.timeZone` 两条**原样保留**之外，新增 `agentConcurrency` 两条精确模板（INSERT＋expectedVersion CAS，见契约 §5.4）；其它 settings 写仍拒。
- **迁移期写（不在 `transact` 白名单）**：`schema_meta` 镜像 `UPDATE` 与 `sqlite_sequence` 高水位保留由 `rusqlite_migration` 在迁移事务内执行；`schema_meta`／`sqlite_sequence` **不进入业务白名单**。
- **architecture 同步**：无新顶层目录（均在 `server/` 与既有 Rust 模块内）。

### 5.3 数据影响

- **仅新合成根**：003 只作用于 `web-backend/1` 库；旧库与既有 001–005 不动。
- **双表重建**：`manual_items` 与 `manual_item_events` 的值**逐字节保留**（含删除空洞）；**rowid 不承诺**（无消费方依赖 rowid：外键用 `item_id`，列表用时间序／`item_id`）。`source` 扩至 `signed_ai`，`action` 扩至含 `link`。
- **sequence 高水位显式保留**：003 在重建前捕获 `sqlite_sequence` 的历史高水位、重建后恢复，即使尾行曾被硬删也不再复用旧值（不依赖 append-only 前提）。
- **新增五张空表**：`text_sources`／`candidates`／`candidate_previews`／`manual_item_sources`／`sign_off_batches`；001/002 既有表的数据不变。
- **用户可见影响**：无。

### 5.4 失败原子性与恢复／回滚

- **原子性**：`rusqlite_migration` 在**单事务**内应用 003（`configure_connection` 先置 `foreign_keys=ON`）；任一句失败整体回滚，库停留在 `user_version=2`／`schema_version=2`，事件与事项行原样、零残留表（本轮合成对照已实证）。**不承诺迁移前备份**：`consistency_backup` 校验 `user_version == SCHEMA_VERSION`（升级后为 3），对 v2 库会拒绝，故迁移前备份不可实现也**无必要**——单事务回滚即保证迁移失败时数据不丢。显式备份入口仍按冻结契约 §8.2 提供，与迁移解耦。
- **回滚**：空库等价于删除该库；已有数据由单事务回滚保护，不以「删除表」「版本号回退」或「事务内切外键」代替数据回退。
- **恢复保持**：若 `recovery_holds` 打开，新提交／调度暂停；恢复流程与备份还原共用边界。

## 6. 验收命令

| 层面 | 命令 | 状态 |
|---|---|---|
| Rust 存储 | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 已有（接入 003 后扩展 15 表目标与 settings 模板反例） |
| Rust schema | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 已有（接入 003 后重跑，含 sequence 高水位） |
| 服务域 | `node --test tests/unit/web-text-intake.test.mjs` | 拟新增 |
| HTTP 集成 | `node --test --test-timeout=20000 tests/integration/web-text-intake-http.test.mjs`（含 tasks 提交/结果/cancel/retry/**resolve**、agent-concurrency 模板） | 拟新增 |
| 队列/重启 | `node --test --test-timeout=20000 tests/integration/web-text-intake-queue.test.mjs` | 拟新增 |
| Pi 受控 | `node --test tests/integration/web-text-intake-controlled-model.test.mjs` | 拟新增 |
| 结构／文档 | `npm run check:structure && npm run check:docs` | 已有 |
| 完整门禁 | `npm run check`（唯一集成执行者串行，原预算、单次，失败如实回报） | 流程要求 |
| 浏览器矩阵 | Playwright 1440×1000／640×900，加载后端同源 UI，覆盖契约 §10 | 拟新增 |

**串行负责人要求**：最终版本的新完整 `npm run check` 必须由唯一集成执行者在实际集成版本上串行执行；失败、缺前置或仅聚焦通过均不得晋级，不沿用 W1 绿证。

**本轮合成对照（证据见附件）**：`build/web-text-intake-contract/ddl-counterexample.mjs` 以 `node:sqlite`＋`foreign_keys=ON` 内存库验证：003 双表重建（行＋事件＋`sqlite_sequence` 高水位保留）、删尾／无行非零高水位边界、N≥2 批次与 `sign_off:` 派生键、重放映射、`staged` 不可见→确认发布、终态 `cancel_intent=false`、故障回滚重开。脚本与输出随评论附件交付。

## 7. 首轮评审逐项处置与下游边界

### 7.1 阻断／主要（ZCode `c7e962a`）

| # | 发现 | 处置 | 落点 |
|---|---|---|---|
| B1 | 003 单表重建在 `foreign_keys=ON` 下被既有 `manual_item_events` 行阻断（`DROP manual_items` → FK 失败，升级不可达） | **采纳**：003 改为同事务**双子表重建**（父先建→子建（外键指父 `_v3`）→复制事件保序保 sequence→先 DROP 子再 DROP 父→双 RENAME→重建索引→镜像） | §5.1／§5.2；对照 B1 repro＋fix |
| B2 | 批量签收单 `operationId` 撞两级行级 UNIQUE；未声明 W1 §13 n2 幂等命名空间 | **采纳**：新增 `sign_off_batches` 台账（批次键单行，绑定规范输入与结果映射）；每行 operationId 确定性派生（**R1 形式 `<batchOperationId>#<candidateId>`，已由 §7.5 的 `sign_off:`＋SHA-256 取代**）；重放查台账、同键异体 409 | §4.2／§5.1；对照 B2 repro＋fix＋replay |
| M1 | 结果事务跳过 `resultPendingExit` 暂存语义 | **采纳**：结果帧→暂存事务（`result_pending_exit=1`、`pending_outcome`、`staged` 候选不可见/不可签收）；退出确认→单事务提交原暂存结局＋发布 `staged`→`pending`／删除＋释放槽；取消/退出未知/重启补暂存变体 | 契约 §4.2／§6.1；对照 M1 |

### 7.2 次要（MINOR-1–6）

| # | 发现 | 处置 |
|---|---|---|
| MINOR-1 | 迁移前 `consistency_backup` 承诺不可实现（`SCHEMA_VERSION`→3 后对 v2 库必拒绝） | **采纳**：删除该承诺；单事务回滚即保证迁移失败数据不丢；显式备份入口按冻结 §8.2，与迁移解耦（§5.4） |
| MINOR-2 | advisor 列入范围但任务类型集无 advisor | **采纳**：从本切片移除 advisor；今日只保留事项事实列表与完成路径，模型建议归 W2（契约 §1／§8.2／§10） |
| MINOR-3 | 同指纹重复提交语义未定义 | **采纳**：指纹命中→200 复用既有 source＋`reused:true`；并发由 `UNIQUE` 冲突归并，不建第二来源/任务（契约 §5.1） |
| MINOR-4 | `candidates` 缺状态↔时间戳/外键元组 CHECK | **采纳**：补 `accepted`/`discarded`/`staged`＋`pending` 的元组 CHECK（§5.1） |
| MINOR-5 | 未交付 `capture_method`／`source` 映射 | **采纳**：`source='signed_ai'` ∧ `manual_item_sources` 关联行承载 legacy `capture_method` 语义（见 §7.3） |
| MINOR-6 | 「rowid 与值不变」不成立 | **采纳**：改为「值逐字节保留；**rowid 不承诺**」（§4.3／§5.3） |

### 7.3 NIT（NIT-1–5）

| # | 发现 | 处置 |
|---|---|---|
| NIT-1 | 契约 §8.1 Rust 清单缺 `web_backend_schema.rs` | **采纳**：契约 §8.1 补齐 |
| NIT-2 | `ingestion.rs:612` 行号漂移 | **采纳**：改为 `:646` |
| NIT-3 | worker 记录路径与探针布局有差 | **采纳**：以探针 `runs/worker.json` 布局为准；并发多槽扩展为 `runs/<runId>/worker.json`，语义一致（契约 §7） |
| NIT-4 | 重建后 `sqlite_master` 表 SQL 带引号 | **保留（登记）**：语义等价、索引名一致，无需处理 |
| NIT-5 | `instance_epochs` 注册行未提 | **采纳**：启动注册新 epoch 行，与恢复扫描同事务（契约 §6.1.8） |

### 7.4 下游边界

| # | 项 | 处置 |
|---|---|---|
| 1 | `agentConcurrency` 设置 key | 复用 001 `settings` 表（key/value/version），无 schema 变更；写经 §5.4 两条新模板；GET 缺省 3/version 0 不写库 |
| 2 | 配置存储 | 沿用工作根 `config/` 文件（设计 §4），不新增 DB 表；原子读写＋修订哈希 |
| 3 | 生产 OS CredentialProvider | 受控测试 provider 先行；生产 provider（Keychain/env）实施时另行授权；与真实凭据授权分开列 |
| 4 | 真实模型 | 本切片只用受控服务；真实模型验收另行开放，不以受控验证冒称真实通过 |
| 5 | `todo_sources` 等价关联 | 由新表 `manual_item_sources` 承载；不迁移 legacy `todo_sources` 数据 |
| 6 | `capture_method`／`source` 映射 | 签收事项 `source='signed_ai'`；legacy `capture_method` 的语义（`manual`／`signed_ai`）由 `source`＋`manual_item_sources.association` 共同承载，线格式沿用 `source` |

### 7.5 限定复审 R2 逐项处置（ZCode `89df585`）

| # | 发现 | 处置 | 落点 |
|---|---|---|---|
| MAJOR-1 | `PUT /api/settings/agent-concurrency` 与「设置模板不变」在真实 runner 上矛盾（`agentConcurrency` 写必被 `WEB_BACKEND_SQL_DENIED`） | **采纳**：保留可配并发 PUT；新增 `agentConcurrency` 两条精确模板（INSERT＋expectedVersion CAS）；时区模板原样保留、其它 settings 写仍拒；授权表新增 #4 | 契约 §5.4／§6.2；授权 §3 #4／§5.2 |
| MINOR-A | `sqlite_sequence` 高水位不随迁移保留，不变量未声明 | **采纳**：003 迁移内**显式保留历史高水位**（重建前捕获、重建后恢复）；不依赖 append-only 前提；补删尾／无行非零对照 | §5.1 step 0/5；§5.3 |
| MINOR-B | 取消×暂存为冻结未枚举组合，补齐未声明、`cancel_intent` 终值未定 | **采纳**：契约 §6.1.1 明确记作本切片对冻结未枚举组合的补齐（优先级／恢复 cause／白名单／拒绝路径）；**所有终态 `cancel_intent=false`**，意图留事件历史 | 契约 §6.1.1 |
| MINOR-C | 批次重放与附录 A.2 措辞不一致 | **采纳**：§5.1 明示为对 A.2 的批次级细化——按台账候选→事项 ID 映射**重读当前权威对象**，不返回旧快照 | 契约 §5.1 |
| MINOR-D | R1 残留文案 5 处 | **采纳**：契约 §4.1 改 `action` 扩至含 `link`；授权 §1 补 `sign_off_batches`；§3 #2 改「5 新表＋双表重建」；§4.2 删 `today.ts`（advisor）；§6/§11 对照路径更新 | 两文档 |
| NIT-a | `candidate_id` 字母表未固化 | **采纳**：§4.2 固定 `cand_<32hex>`（`src_`/`prev_` 同风格），派生键单射 | 契约 §4.2 |
| NIT-b | `sign_off_batches` 缺 `status↔completed_at_ms` 元组 CHECK | **采纳**：§5.1 补元组 CHECK | §5.1 step 11 |
| NIT-c | 派生键裸 `#` 有歧义 | **采纳**：改为 `sign_off:`＋SHA-256(UTF-8 JSON `["sign_off", batchOperationId, candidateId]`) | 契约 §5.1；§5.1 step 11 注释 |

**同类缺口闭合**：授权 §3 #3 已把 001 任务系 8 表纳入 `BUSINESS_TABLES`（共 15 表），契约 §5.4 给出「端点→服务→SQL 目标／模板→权限→反例」闭合表；`schema_meta`／`sqlite_sequence` 仅迁移期可写，不入业务白名单；任务 `resolve` 入口已补（契约 §5.2）。

### 7.6 限定复审 R3 逐项处置（ZCode `47d5efa`，通过）

| # | 发现 | 处置 |
|---|---|---|
| MINOR-R3-1 | 授权 §7.1 B2 处置文案仍为 R1 旧派生键形与旧重放语义 | **采纳**：在该行加「R1 形式，已由 §7.5 取代」标记（规范性章节 §5.1/契约 §5.1 已为新形） |
| NIT-R3-1 | 契约 §4.2「固定字母表保证单射」理由句过时 | **采纳**：改为「单射由 JSON 数组编码＋SHA-256 保证，不依赖字母表」 |
| NIT-R3-2 | §6.1.1 读取白名单引用省略冻结 §4.3 的 cause 限定 | **采纳**：补 `cause='result_exit_unconfirmed'` 限定；本组合 cause 为 `cancel_unknown_side_effect` 时结果不可读（与 staged 候选不可见一致） |
| NIT-R3-3 | 闭合表反例「非参数化→拒绝」超出真实守卫拒绝轴；未列 REPLACE | **采纳**：改按真实拒绝轴（非 DML／多语句／禁用关键字／非白名单目标；settings 按模板）；DML 列补 REPLACE；注明参数化是服务层约定 |
| NIT-R3-4 | 闭合表缺 `/api/models`／`/api/agents`／`/api/providers` 行；派生键 JSON 分隔符建议固化 | **采纳**：补该行（写 `config/` 文件、不经 `transact`）；派生键明确为紧凑 `JSON.stringify` 无多余空白 |

## 8. 未验项与边界

- 本提案未创建迁移文件、未执行 DDL、未安装依赖、未改 manifest/锁文件/守卫、未操作真实数据库/凭据/工作根、未调用真实模型。
- Linux/代理部署、真实模型/来源调用、真实凭据/工作根、push 与发布均未授权，不在本切片验收范围。
- 既有 Tauri/Rust 实现与 W0/W1 证据继续有效于其原版本，本提案不外推为新 Web/Linux 已通过。
- 本提案由未参与实现的 ZCode 独立评审；Claude 不自签 APPROVE，不通知他人按草案开工。

## 9. 版本与哈希

| 项 | 值 |
|---|---|
| 提案文档 | 本文件；契约内容见[文本整理与签收纵向契约](../engineering/web-text-intake-contract.md) |
| 基点 | `1e3704432e7014f1e23b40e9aff9791662e9c6f5` / tree `77a548591ac9b02a51936c806bf4f85d774df7cb` |
| 冻结 001 | `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` |
| 冻结 002 | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` |
| 冻结契约（web-api/1） | `docs/engineering/web-api-contract.md` SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` |
| 拟议 003（§5.1 原样提取） | SHA-256 `8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870` |
| 本轮修订 | R1 见 §7.1–7.4（ZCode `c7e962a`）；R2 见 §7.5（ZCode `89df585`）；R3 见 §7.6（ZCode `47d5efa`） |
| 状态 | 提案（未获批、未实施） |

## 10. 审批摘要（MAYNE-24 三项）

**本次申请新增批准仅以下三项**：

| # | 申请项 | 精确范围 | 依据 |
|---|---|---|---|
| **A** | 精确 003 DDL | `src-tauri/migrations/web-backend/003_text_intake.sql`（5 新表＋`manual_items`／`manual_item_events` 双表重建；含 `sqlite_sequence` 高水位保留；SHA-256 `8e4e3159…7870`） | §5；契约 §4 |
| **B** | 15 表写目标＋两条并发模板 | `web_backend_store.rs`：`BUSINESS_TABLES` 扩为 15 表；settings 模板新增 `agentConcurrency` INSERT＋CAS（时区模板原样保留、其它 settings 写仍拒） | §5.2；契约 §5.4 |
| **C** | Pi Runtime 后端打包接入及脚本/守卫清单 | `scripts/build/build-backend.mjs` 将 `organizer.mjs` 及依赖复制进 `build/web-backend/runtime/`；`package.json` 脚本；无新依赖、无新顶层目录（守卫不变） | §4.2；契约 §7 |

**当前授权覆盖／未覆盖（不将接口与受控实现混成真实凭据授权）**：

| 项 | 当前覆盖 | 未覆盖 |
|---|---|---|
| 本地 Git（完成后提交／合 main／清分支） | owner `01a1b648` | push／远端 PR／部署 |
| 目录／构建／依赖 | W1 A–D（`01a1b80b`）：002、`server/`、`src-tauri/src/bin/`、`build-backend.mjs`、零新增依赖 | 新增生产依赖（本提案不需要） |
| 生产 OS CredentialProvider | —（设计 §4 已定方向；keyring 依赖已锁） | **未授权**：生产 OS provider 的实施；本切片只做 controlled 测试 provider 与接口 |
| 真实凭据 | — | **未授权**：读取真实凭据/钥匙串；本切片只落引用、经私有通道注入 |
| 真实模型 | — | **未授权**：真实模型调用；本切片只用受控服务验证生产 Pi 调用与任务路径，真实模型验收另行开放 |
