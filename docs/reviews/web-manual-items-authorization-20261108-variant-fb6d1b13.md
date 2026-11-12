# W1 手工事项：逐文件变更与授权差异提案（2026-11-08，P1）

> 状态：**提案（proposal），未获批、未实施**。本文是 MAYNE-23 P1 的授权对应与变更清单；只给出拟新增／修改／删除的文件、拟议 DDL 与授权请求，不创建迁移文件、不安装依赖、不改 manifest/锁文件、不操作真实数据库、凭据或工作根。
> 共同基点：本地 main `65469904d8baddde738646dfed3bf4a921f47b68` / tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`（未 push）。契约内容见[手工事项纵向契约](../engineering/web-manual-items-contract.md)。
> 依据：owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`（2026-11-07）、MAYNE-22 实际执行登记、[Web API 契约](../engineering/web-api-contract.md)（`web-api/1` 已冻结）、[Web/后端设计](../engineering/web-backend-design.md)、[工程架构](../engineering/architecture.md)。
> **本轮修订**：本版处理 P1 首轮独立评审（ZCode `2706044`）的 B1、M1–M3、m1–m7，并逐项处置 n1–n7；处置汇总见 §9 与 `build/web-manual-items-contract/revision-disposition.md`。

## 1. 目的

W1 手工事项纵向切片需要：新库表（手工事项与历史）、后端 HTTP/会话/静态供给进程、Rust 存储适配二进制、前端 HTTP 客户端，以及配套的构建入口、守卫与测试。本文件逐项对应到现有授权，分清**已覆盖**、**需要进一步具体化**与**真正需要新增批准**，并给出完整拟议 DDL 与数据影响，供 Codex/owner 审批。

## 2. 现有授权台账

| 来源 | 内容 | 范围 |
|---|---|---|
| owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`（2026-11-07） | “本体集成，无需考虑历史数据，直接按照全新的脚本去新建表结构之类的。完成相关功能后，记得提交并合并到main，然后清理分支。” | 全新建表方案（不做历史迁移）；完成后的本地提交、合入本地 main、清理已合并任务分支 |
| MAYNE-22 执行登记 | W0 已按上述授权完成：新库 `web-backend/1` 11 表、本地提交并合入 main `6546990`、四个成员任务分支已清理；未 push | 仅 W0 精确 DDL 与上述 Git 动作 |
| [实施计划 §当前实施总览](../product/05-第一阶段实施计划.md) | 除此之外的依赖安装与库版本仍须具体清单授权；真实模型/飞书凭据、生产部署和真实工作根操作仍须对应授权；Git 授权不含 push | 边界 |

## 3. 授权对应表

| # | 拟批准动作 | 来源 | 处置 | 说明 |
|---|---|---|---|---|
| 1 | 新 lineage 新表方案（不做历史迁移、不建兼容桥） | owner 评论 `01a1b648` | **已覆盖（原则）** | W1 沿用 `web-backend/1` 新库，不迁移旧库数据；具体表清单见 §5，仍须本提案评审 |
| 2 | W1 具体 DDL：`002_manual_items.sql` 两张新表 | 本提案 §5 | **需要进一步具体化／新增批准** | 不把 W0 精确 DDL 扩成“新表已获批”；本提案即为该具体清单 |
| 3 | 新增顶层 `server/` 目录与守卫同步 | 本提案 §4 | **需要新增批准** | 结构性改动：`architecture.md` ＋ `check-structure.mjs` 同步 |
| 4 | `src-tauri/Cargo.toml` 新增 `[[bin]] web-backend-storage` | 本提案 §4 | **需要新增批准** | manifest 变更；不新增依赖，复用已锁版本 |
| 5 | 构建入口 `scripts/build/build-backend.mjs`（打包后端并复制前端 `dist/`） | 本提案 §4 | **需要新增批准** | 打包脚本变更；不新增生产依赖 |
| 5a | `src-tauri/src/bin/` 新顶层与守卫收敛（仅 `web-backend-storage.rs`） | 本提案 §4.6 | **需要新增批准** | 该路径当前被 `layout.src-tauri-top` 拒绝；需 `architecture.md` ＋ `check-structure.mjs` 同步 |
| 6 | 完成后的本地提交 | owner 评论 `01a1b648` | **已覆盖** | 不重复索取 |
| 7 | 合入本地 main | owner 评论 `01a1b648` | **已覆盖** | 不重复索取 |
| 8 | 清理已合并任务分支 | owner 评论 `01a1b648` | **已覆盖** | 不重复索取 |
| 9 | 新增生产依赖 | — | **不需要（首选零依赖）** | HTTP／会话／CSRF／UUID 用 `node:http`／`node:crypto` 实现；如确需框架，另行具体清单 |
| 10 | `package.json` 新增启动／测试脚本 | 本提案 §4.2 | **需要进一步具体化** | 脚本变更非依赖变更；共享文件由集成任务统一维护（n4） |
| 11 | 完整 `npm run check` | 集成流程 | **已覆盖（流程要求）** | 由唯一集成执行者在实际集成版本串行执行 |
| 12 | push | — | **未授权** | 不在本切片范围 |
| 13 | 部署、真实凭据、真实工作根、真实模型 | — | **未授权** | 不在本切片范围 |

## 4. 逐文件拟新增／修改／删除

### 4.1 生产代码（拟新增）

| 路径 | 内容 | 说明 |
|---|---|---|
| `server/entries/web-backend-entry.mjs` | 后端进程入口 | 启动配置、根锁、装配 HTTP/SSE、静态供给、恢复扫描、优雅关停 |
| `server/lib/http-server.mjs` | `node:http` 服务器、路由、错误信封 | 零依赖路由；`/api` 前缀 |
| `server/lib/session-store.mjs` | 配对码／会话／CSRF／限速 | 沿用 `web-api/1` §2 |
| `server/lib/manual-items-service.mjs` | 事项业务事务 | 校验、版本、幂等、历史 |
| `server/lib/storage-client.mjs` | Rust 适配 stdio JSON 客户端 | 子进程拉起、帧解析、错误映射 |
| `server/lib/sse-hub.mjs` | SSE 广播 | 任务帧沿用 `web-api/1` §6；事项帧为进程内提示（契约 §5） |
| `server/lib/static-files.mjs` | 同源静态供给 | 服务前端 `dist/`；MIME／缓存／SPA fallback（M3） |
| `src-tauri/src/store/web_backend_store.rs` | 事项存储操作协议实现 | `transact`／`query`／`backup`／`open`／`init` |
| `src-tauri/src/store/web_backend_store_tests.rs` | 事项存储操作单测 | 原子事务、条件更新影响行数、历史同事务、回滚 |
| `src-tauri/src/bin/web-backend-storage.rs` | stdio 二进制入口 | 由 Node 子进程调用；`bin/` 布局见 §4.6 |
| `src-tauri/migrations/web-backend/002_manual_items.sql` | 手工事项表迁移 | 完整 DDL 见 §5 |
| `src/lib/web-api-client.ts` | 前端 HTTP 客户端 | fetch、CSRF、错误包络、operationId |
| `src/stores/pairing.ts` | 配对会话状态 | 承载配对码输入与会话自检；参照 `createDesktopPreferences(api)` 模式（契约 §9.6） |
| `src/components/PairingGate.vue` | 配对门组件 | 无会话时显示配对码输入，成功后渲染默认 slot（`Workbench`） |

### 4.2 生产代码（拟修改）

| 路径 | 修改 | 说明 |
|---|---|---|
| `src/stores/todos.ts` | 由 Tauri `invoke` 切换到 HTTP 客户端 | 保留 `createTodoModel` 结构与 `src/domain/todos.ts` 纯逻辑；映射线格式↔领域类型（契约 §9.6） |
| `src/App.vue` | 默认 surface 经 `PairingGate` 渲染 `Workbench` | 基点事实：`App.vue:1-20` 的 `useDesktopPreferences()`＋默认 surface（契约 §9.6） |
| `src-tauri/src/store/local_store.rs` | 登记 `web_backend_store`／`web_backend_store_tests` 模块与 `pub use` | 实际登记点：`lib.rs:29-30` 以 `#[path = "store/local_store.rs"]` 引入，模块以 `#[path]` 声明（契约 §9.5）；**不创建无调用方的 `store/mod.rs`** |
| `src-tauri/src/store/web_backend_schema.rs` | `SCHEMA_VERSION` 1→2；`migrations()` 追加 002；故障注入分支适配双迁移 | 001 冻结字节不变；镜像更新由 002 内 UPDATE 完成（B1） |
| `src-tauri/src/store/web_backend_schema_tests.rs` | 双迁移故障注入用例适配 | 既有测试文件，与 runner 故障分支语义一致 |
| `src-tauri/Cargo.toml` | 新增 `[[bin]] name="web-backend-storage"` | manifest 变更，需批准 |
| `scripts/build/build-backend.mjs`（确定落点） | 打包后端入口并把前端 `dist/` 复制进后端 bundle 输出 | 同源静态供给的构建接入（M3）；不新增生产依赖 |
| `scripts/checks/check-structure.mjs` | `TOP_LEVEL_DIRS` 增加 `server` 与 `bin`；新增 `server/` 收敛与 `layout.src-tauri-bin`（仅 `web-backend-storage.rs`）；`IMMUTABLE_MIGRATIONS` 增加 002 哈希 | 守卫与 `architecture.md` 同步；见 §4.6 |
| `docs/engineering/architecture.md` | 新增 `server/` 与 `src-tauri/src/bin/` 放置规则及依赖边界 | 结构性改动必须同步守卫；见 §4.6 |
| `package.json` | 新增启动／测试脚本（如 `start:backend`、`build:backend`、`test:web-manual-items`） | 共享文件，由集成任务统一维护（n4） |

### 4.3 测试（拟新增）

| 路径 | 覆盖 |
|---|---|
| `tests/unit/web-manual-items.test.mjs` | 服务层纯逻辑：字段校验、版本冲突、幂等、时间语义、删除／历史 |
| `tests/integration/web-manual-items-http.test.mjs` | HTTP 端到端：配对、CSRF/Origin 拒绝、CRUD、历史、错误包络（合成根、临时端口）；**本测试即数据库观测层**（m7） |
| `tests/integration/web-manual-items-restart.test.mjs` | 重启后事项／历史恢复；多客户端一致 |
| `tests/integration/web-manual-items-static.test.mjs` | 同源静态供给：浏览器加载后端同源 UI 再访问 `/api`／SSE（M3） |
| `src-tauri/src/store/web_backend_store_tests.rs` | 事项存储操作：原子事务、条件更新影响行数、历史同事务、回滚 |
| `tests/fixtures/web-manual-items/` | 契约样例（可选，随契约冻结补充） |

### 4.4 文档（拟修改）

| 路径 | 修改 | 说明 |
|---|---|---|
| `docs/product/05-第一阶段实施计划.md` | W1 状态更新 | **共享文件，由集成任务统一维护，本提案不写** |
| `docs/reviews/README.md` | 索引登记 | **共享文件，由集成任务统一维护，本提案不写** |

### 4.5 拟删除

无。不删除既有 Tauri/Rust 实现与历史证据；旧路径保留，但新业务不再以 Tauri IPC 为唯一写入方。

### 4.6 布局守卫与架构同步（`server/` 与 `src-tauri/src/bin/`）

| 项 | 现状（基点源码） | 拟议改动 | 正／负例 |
|---|---|---|---|
| `server/` | 不在 `check-structure.mjs` 的 `TOP_LEVEL_DIRS`（仅 12 个目录） | `TOP_LEVEL_DIRS` 增加 `server`；新增 `server/` 顶层收敛（只允许 `entries/`／`lib/`） | 正：`server/lib/static-files.mjs`；负：`server/other/x.mjs` → 收敛规则拒绝 |
| `src-tauri/src/bin/` | 不在 `SRC_TAURI_TOP_DIRS`（仅 `app`／`store`／`host`／`diagnostics`），新路径会被 `layout.src-tauri-top` 拒绝 | `SRC_TAURI_TOP_DIRS` 增加 `bin`；新增 `layout.src-tauri-bin`，限定 `src-tauri/src/bin/` 只允许 `web-backend-storage.rs` | 正：`src-tauri/src/bin/web-backend-storage.rs`；负：`src-tauri/src/bin/scratch.rs` → `layout.src-tauri-bin`；`src-tauri/src/other/foo.rs` → 仍由 `layout.src-tauri-top` 拒绝 |
| `docs/engineering/architecture.md` | `src-tauri/src/` 布局仅列 `lib.rs`／`main.rs`／`app`／`store`／`host`／`diagnostics` | 同步 `bin/` 与新放置规则 | 与守卫一致 |

- 不借此放开任意生产目录；除上述两条具体路径外，其他顶层收敛不变。
- 守卫与 `architecture.md` 必须同一次改动落地，否则 `npm run check:structure` 失败（架构文档规则）。

## 5. 拟议 DDL（`002_manual_items.sql`）

> 本节为提案内容，**不创建文件、不执行 DDL**。迁移文件路径：`src-tauri/migrations/web-backend/002_manual_items.sql`。

### 5.1 完整 DDL

```sql
-- Proposed migration: src-tauri/migrations/web-backend/002_manual_items.sql
-- Lineage: web-backend/1 (schema_version 2)
-- Status: PROPOSAL ONLY — not approved, not applied, not executed.
-- Basis: docs/engineering/web-manual-items-contract.md §4/§7 and
--        docs/engineering/web-api-contract.md (web-api/1, frozen).
-- Appends to the frozen 001_web_backend.sql; does not modify it.

CREATE TABLE manual_items (
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
    source TEXT NOT NULL CHECK (source IN ('manual')),
    CHECK ((due_at_ms IS NULL AND due_timezone IS NULL AND due_local IS NULL)
        OR (due_at_ms IS NOT NULL AND due_timezone IS NOT NULL AND due_local IS NOT NULL)),
    CHECK ((followup_at_ms IS NULL AND followup_timezone IS NULL AND followup_local IS NULL)
        OR (followup_at_ms IS NOT NULL AND followup_timezone IS NOT NULL AND followup_local IS NOT NULL)),
    CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL)
        OR (status <> 'completed' AND completed_at_ms IS NULL)),
    CHECK ((status = 'deleted' AND deleted_at_ms IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at_ms IS NULL))
);
CREATE INDEX manual_items_status ON manual_items(status, kind);
CREATE INDEX manual_items_open_time ON manual_items(kind, followup_at_ms, due_at_ms)
    WHERE status = 'open';
-- m6: supports ORDER BY created_at_ms DESC, item_id ASC and the (created_at_ms, item_id)
-- cursor watermark without a TEMP B-TREE.
CREATE INDEX manual_items_list_order ON manual_items(created_at_ms DESC, item_id ASC);

CREATE TABLE manual_item_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES manual_items(item_id),
    action TEXT NOT NULL CHECK (action IN ('create','update','complete','reopen','delete')),
    occurred_at_ms INTEGER NOT NULL,
    request_json TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL
);
CREATE INDEX manual_item_events_item ON manual_item_events(item_id, sequence);

-- B1: the schema_meta mirror must be advanced inside the SAME migration transaction
-- that raises PRAGMA user_version 1 -> 2; otherwise the runner's validate() rejects
-- the database on the next open with WEB_BACKEND_SCHEMA_VERSION_MISMATCH.
UPDATE schema_meta SET schema_version = 2 WHERE id = 1;
```

### 5.2 lineage／版本与冻结迁移保留

- **lineage 不变**：`schema_meta.schema_lineage` 仍为 `web-backend/1`；`schema_version` 由 1 递增为 2。
- **权威与镜像**：`PRAGMA user_version` 为迁移进度权威，`schema_meta.schema_version` 为同事务镜像；两者不符显式拒绝（沿用 W0 R2 契约）。**镜像更新由 002 内的 `UPDATE schema_meta SET schema_version = 2 WHERE id = 1;` 完成，不在 runner 代码中回写（B1）**。
- **冻结保留**：`001_web_backend.sql` 逐字节不变（守卫 `IMMUTABLE_MIGRATIONS` 已冻结 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`）；002 只追加，不改 001。
- **runner 改动**：`web_backend_schema.rs` 的 `SCHEMA_VERSION` 改为 2，`migrations()` 改为 `vec![M::up(SQL_001), M::up(SQL_002)]`；`SQL_002` 以 `include_str!` 引入；`apply_migrations` 的故障注入分支适配双迁移（在 002 之后注入失败，验证整体回滚到 v1）。
- **守卫改动**：`IMMUTABLE_MIGRATIONS` 在 002 定稿后追加其精确 SHA-256；同步更新原地自测正／负例。

### 5.3 数据影响

- **仅新合成根**：002 只作用于 `web-backend/1` 库；旧库 `sidekick.sqlite` 与既有 001–005 不动，无数据迁移、无兼容桥。
- **新增两张空表**：`manual_items`、`manual_item_events`；W0 的 11 张任务队列表结构与数据不变。
- **用户可见影响**：无。新表在首次打开已有 `web-backend/1` 库时由迁移创建；未初始化的新根由显式 `init` 流程创建。

### 5.4 失败原子性与恢复／回滚

- **原子性**：`rusqlite_migration` 在单个事务内应用 002；任一句失败整体回滚，库停留在 `user_version=1`／`schema_version=1`，显式报错，不部分应用、不自动重试。
- **迁移前备份**：对已有数据的库，迁移前调用适配的 `consistency_backup` 生成一致性副本；失败时用备份还原。
- **回滚**：空库场景回滚等价于删除该库（及 `-wal`／`-shm`）；已有数据场景以备份还原，不以“删除表”或“版本号回退”代替数据回退（沿用 W0 §7.2 边界）。
- **恢复保持**：若 `recovery_holds` 打开，新提交／调度暂停；恢复流程与备份还原共用同一边界（沿用 W0 §7.5）。

### 5.5 拟登记冻结扩展清单（n7）

以下为本切片对冻结 `web-api/1` 的**兼容扩展**，建议 Codex 在冻结记录中登记（不影响既有任务字段与语义）：

| 类别 | 扩展 |
|---|---|
| 端点 | `/api/manual-items`（POST/GET）、`/api/manual-items/{itemId}`（GET/PUT/DELETE）、`/api/manual-items/{itemId}/complete`、`/reopen`、`/history` |
| 错误码 | `item_not_found`（404） |
| 事件 | `item.changed`（`objectType: "item"`；进程内提示，无 `id`，不计任务 cursor） |
| 线格式 | `manual_items` 资源（`contractVersion: "web-api/1"`） |
| DDL | `002_manual_items.sql`（`manual_items` ＋ `manual_item_events`，含 `schema_meta` 镜像更新） |

## 6. 验收命令

以下为实施切片的验收命令；除注明外当前均**拟新增**，本提案不执行。

| 层面 | 命令 | 状态 |
|---|---|---|
| Rust 存储 | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 拟新增 |
| Rust schema | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 已有（W0 17/17；接入 002 后须重跑并适配双迁移故障注入） |
| 前端域 | `node --test tests/unit/web-manual-items.test.mjs` | 拟新增 |
| HTTP 集成 | `node --test --test-timeout=20000 tests/integration/web-manual-items-http.test.mjs` | 拟新增 |
| 重启恢复 | `node --test --test-timeout=20000 tests/integration/web-manual-items-restart.test.mjs` | 拟新增 |
| 同源静态 | `node --test --test-timeout=20000 tests/integration/web-manual-items-static.test.mjs` | 拟新增（M3） |
| 结构／文档 | `npm run check:structure && npm run check:docs` | 已有 |
| 完整门禁 | `npm run check`（由唯一集成执行者在实际集成版本串行执行，原预算、单次，失败如实回报） | 流程要求 |
| 浏览器矩阵 | Playwright 驱动 1440×1000 与 640×900，加载后端同源 UI，覆盖纵向契约 §11 全部验收项 | 拟新增 |

**串行负责人要求**：最终版本的新完整 `npm run check` 必须由唯一集成执行者在实际集成版本上串行执行；失败、缺前置或仅聚焦通过均不得晋级，不沿用 W0 绿证。

**本轮合成对照（证据见附件）**：`build/web-manual-items-contract/ddl-counterexample.mjs` 以 `node:sqlite` 内存库复现 B1 与镜像修复、v1→v2 前向迁移、故障注入整体回滚；脚本与输出随评论附件交付，不在仓库内。

## 7. NIT 逐项处置（n1–n7 ＋ R2 新增）

| # | 发现 | 处置 | 依据 |
|---|---|---|---|
| n1 | `/history` 返回无界 | **采纳**：契约 §5 增加 `limit`／`cursor` 分页（`sequence DESC`，默认 50、最大 200） | 与列表分页同一约定 |
| n2 | `operation_id` 幂等命名空间域内 | **保留（下游边界）**：契约 §13 明确候选签收切片接入时须声明全局或按资源族策略；本切片不预先扩大 | 避免在 manual-only 切片引入未用的全局约束 |
| n3 | `pairing.ts` 两文档不同步 | **采纳**：契约 §9.2 前端清单补 `src/stores/pairing.ts`，与授权 §4.1 一致 | 文档同步 |
| n4 | `package.json` 变更未入 §3 表 | **采纳**：§3 增加 #10「`package.json` 新增启动／测试脚本」，定性为需具体化（脚本非依赖） | 表格完整性 |
| n5 | §3 路径 7「队列位置」属任务域 | **采纳**：改为「事项、状态与历史原样重现」，并注明 W0 任务队列状态按其自身契约保留 | 范围准确 |
| n6 | 线格式缺 legacy `capture_method` | **保留（下游边界）**：契约 §4.1 注明本切片 manual-only，候选签收切片再定义 `capture_method` 与 `source` 映射 | 本切片无 `signed_ai` 来源 |
| n7 | 冻结记录应登记扩展清单 | **采纳**：§5.5 附拟登记清单，交 Codex 冻结动作 | 属队长冻结动作，提案只备清单 |
| MINOR-1（R2） | 契约 §5 插入稳定性句与 `created_at_ms DESC` 方向相反 | **采纳**：改为「新事项只出现在重新读取的首页；进行中分页不被打乱、游标不跳行；同毫秒并列由 `item_id` 决定」 | 契约 §5；单句事实修正，免于再轮复审 |
| NIT-1（R2） | §6「原结果」与「当前权威状态」措辞不一致 | **采纳**：统一为「按幂等规则返回 `replayed:true` 与当前权威状态，不因当前状态 409」 | 契约 §6 |
| NIT-2（R2） | §5.1 m6 注释「without a TEMP B-TREE」仅对无过滤扫描成立 | **保留（下游边界）**：缺省 status 过滤仍走 `manual_items_status`＋排序；事项规模下无影响。DDL 保持已审 `b6cb8e6…f97e`，不改注释 | 契约/授权 §5.1；未来如需可加 `(status, created_at_ms DESC, item_id)` 变体 |
| NIT-3（R2） | 契约 §9.4 未列 static 测试文件名 | **采纳**：契约 §9.4 表补 `tests/integration/web-manual-items-static.test.mjs` | 与授权 §4.3 同步 |

## 8. 未验项与边界

- 本提案未创建迁移文件、未执行 DDL、未安装依赖、未改 manifest/锁文件、未操作真实数据库/凭据/工作根。
- Linux/代理部署、真实模型/飞书凭据、真实工作根、push 与发布均未授权，不在本切片验收范围。
- 既有 Tauri/Rust 实现与 W0 探针证据继续有效于其原版本，本提案不外推为新 Web/Linux 已通过。
- 本提案由未参与实现的 ZCode 独立评审；Claude 不自签 APPROVE，不通知他人按草案开工。

## 9. 本轮修订处置汇总

| 发现 | 处置 | 落点 |
|---|---|---|
| B1 002 缺 `schema_meta` 镜像更新 | **采纳**：002 末尾同事务 `UPDATE schema_meta SET schema_version = 2 WHERE id = 1;`；runner 故障注入适配双迁移 | §5.1／§5.2；合成对照 Case A/B/C |
| M1 删除后读取矛盾 | **采纳**：详情与历史可读、变更操作一律 409；默认清单排除 deleted、显式 `status=deleted` 可读；重放优先于状态守卫 | 契约 §5／§6；本文件 §3 无 |
| M2 事项 SSE 补偿未定义 | **采纳选项②**：事项帧为进程内提示，无 `id`、不计任务 cursor、不写 `task_events`；首订阅／重连／reset 后以事项接口读回补偿；任务流语义不变 | 契约 §5 事件约定 |
| M3 同源静态供给缺位 | **采纳**：新增 `static-files.mjs`＋构建接入＋同源浏览器验收测试；开发期代理仅补充 | 契约 §9.2/§9.4/§11；本文件 §4 |
| m1 列表 cursor 编码 | **采纳**：复合水印 `(created_at_ms, item_id)`，默认 50、最大 200 | 契约 §5 |
| m2 更新语义 | **采纳**：整体替换；`kind` 可互换；`followup` 挂 `action` 接受但忽略 | 契约 §4.3 |
| m3 reopen 中文析读 | **采纳**：显式状态迁移表 | 契约 §5 |
| m4 stdio 协议措辞过强 | **采纳**：区分已验证子进程模式与新增七命令帧协议，承诺测试自证 | 契约 §9.1 |
| m5 SQL/PRAGMA 权限 | **采纳**：`transact` 限参数化业务表 DML；`query` 只读；`pragma` 只读事实 | 契约 §9.1 |
| m6 列表排序无索引 | **采纳**：新增 `manual_items_list_order(created_at_ms DESC, item_id ASC)` | §5.1 |
| m7 缺数据库观测点 | **采纳**：契约 §11 增「数据库层」行；HTTP 集成测试即 DB 观测层 | 契约 §11；本文件 §4.3 |

## 10. 最终审批摘要

**既有授权覆盖（不重复索取）**：新 lineage 新表原则（§3 #1）；完成后的本地提交（#6）、合入本地 main（#7）、清理已合并分支（#8）——owner 评论 `01a1b648`。

**本轮申请新增批准（仅以下具体项）**：

| # | 申请项 | 落点 |
|---|---|---|
| A | 具体 DDL：`002_manual_items.sql`（原样哈希 `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e`） | §5.1 |
| B | 新顶层目录与守卫收敛：`server/`（只含 `entries/`／`lib/`）与 `src-tauri/src/bin/`（只含 `web-backend-storage.rs`）；`architecture.md` 同步 | §4.6 |
| C | 二进制 manifest：`src-tauri/Cargo.toml` 新增 `[[bin]] name="web-backend-storage"` | §4.2 |
| D | 构建接入：`scripts/build/build-backend.mjs`（打包后端并复制前端 `dist/`）＋ `package.json` 脚本 | §4.2 |

**明确未授权（不在本切片范围）**：push、部署、真实凭据/工作根、真实模型。

**独立评审指涉**：ZCode R1 `2706044`（不通过 → 已修订）；ZCode R2 `c0f88f6`（通过，B1/M1–M3 关闭，MINOR-1/NIT-1–3 已处置）；OhMyPi P2 `f031e21`（通过，结论保留）。

**数据影响／回滚**：见 §5.3／§5.4（仅新合成根、同事务原子迁移、备份还原）。

**验收命令**：见 §6（聚焦／浏览器／重启／失败／冲突＋完整门禁由唯一集成执行者串行）。

## 11. 版本与哈希

| 项 | 值 |
|---|---|
| 提案文档 | 本文件；契约内容见[手工事项纵向契约](../engineering/web-manual-items-contract.md) |
| 基点 | `65469904d8baddde738646dfed3bf4a921f47b68` / tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf` |
| 冻结 DDL（001） | `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` |
| 冻结契约（web-api/1） | `docs/engineering/web-api-contract.md` SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` |
| 本轮修订 | 见本文件 §9 与 `build/web-manual-items-contract/revision-disposition.md` |
| 状态 | 提案（未获批、未实施） |
