# W0 schema 实施记录：`web-backend/1` schema/runner/测试（2026-11-07）

> 状态：**已实施，待独立审查**。按 owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5` 与任务描述「Owner 新授权执行登记」实施，仅在登记的生产写入清单内交付。

## 1. 授权与范围

- 授权来源：owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`（「本体集成，无需考虑历史数据，直接按照全新的脚本去新建表结构……完成相关功能后，记得提交并合并到main，然后清理分支」），由队长登记入任务描述。
- 实施对象：已独立通过的最终提案 `598d2daf9db8ab66c9760c585af7045f87eac466`（提案 SHA-256 `bc8876c3e705e6ca1fbe83605e48e9af6c366945e561f0954c1ca2c906d9f706`，DDL SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`）。
- 冻结代码基座：`8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`（集成补丁 `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e`）。
- 本任务分支：`agent/claude/mayne-22`，起点 `598d2daf9db8ab66c9760c585af7045f87eac466`。

**生产写入清单（仅此四项）**：

| 文件 | 动作 |
|---|---|
| `src-tauri/migrations/web-backend/001_web_backend.sql` | 新增，与审定 DDL 字节一致 |
| `src-tauri/src/store/web_backend_schema.rs` | 新增，runner 与校验 |
| `src-tauri/src/store/web_backend_schema_tests.rs` | 新增，单元测试 |
| `src-tauri/src/store/local_store.rs` | 仅模块/测试登记 |

**写入清单偏差说明**：任务登记写的是 `src-tauri/src/store/mod.rs`，但本仓库没有该文件——`lib.rs` 以 `#[path = "store/local_store.rs"] pub mod local_store;` 声明 store 模块，子模块登记的实际位置是 `src-tauri/src/store/local_store.rs`。因此模块/测试登记加在该文件，未新建死文件 `store/mod.rs`。

## 2. 交付内容

### 2.1 迁移文件

`src-tauri/migrations/web-backend/001_web_backend.sql`：与审定 DDL 字节一致（SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`）。11 张表（含 `task_result_payloads`）与 10 个索引，包括 R1 部分唯一索引 `task_attempts_current`。

### 2.2 runner 与校验（`web_backend_schema.rs`）

- 常量：`SCHEMA_LINEAGE = "web-backend/1"`、`WEB_BACKEND_APPLICATION_ID = 0x57424b31`、`SCHEMA_VERSION = 1`、`DEFAULT_DB_FILE = "data/web-backend.sqlite"`。
- `WebBackendSchema::init(path)`：显式初始化；空文件创建并迁移；既有合法库校验并应用待执行迁移；幂等。
- `WebBackendSchema::open(path)`：普通打开；缺库/空文件显式拒绝，不静默创建。
- `configure_connection(conn)`：`busy_timeout` + `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;`（每连接）。
- `consistency_backup(destination)`：`wal_checkpoint(TRUNCATE)` 后经 `rusqlite::backup::Backup` 复制到新建文件，校验目标 `quick_check`、`application_id`、`user_version`。
- 打开校验：`quick_check` → `application_id` → `schema_meta.schema_lineage` → `schema_meta.schema_version == PRAGMA user_version`（R2，不符即 `WEB_BACKEND_SCHEMA_VERSION_MISMATCH`，不自动修复）→ `schema_version <= SCHEMA_VERSION`。
- 路径处理：打开前对父目录做 `canonicalize`，避免符号链接目录组件触发 `SQLITE_OPEN_NOFOLLOW` 误报（与旧 store 对 app 目录 `canonicalize` 的约定一致）。

### 2.3 测试（`web_backend_schema_tests.rs`）

12 个用例，覆盖：精确 DDL/11 表/唯一索引；初始化幂等；缺库与空文件拒绝；未知 lineage 拒绝；版本镜像不一致拒绝；版本过新拒绝；损坏库拒绝；连接设置（foreign_keys/WAL/FULL）；一致性备份校验；迁移失败回滚与重试；部分唯一索引（未结束 attempt 重复拒绝、结束后允许新 attempt）；约束反例（非法 state、暂存无 outcome、终态无 terminal_at、payload 长度不符）。

## 3. 验证证据（实际命令与退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | 格式通过 |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib` | 0 | 编译通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema` | 0 | 12 passed / 0 failed |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 0 | 无警告 |
| `node scripts/checks/check-docs.mjs` | 0 | 20 文件 / 383 链接 |
| DDL 合成验证（内存库 `executescript`） | 0 | 11 表 / 10 索引 / `schema_meta` 正确 |

原始日志：`build/web-foundation-schema-authorization/verification/`（`cargo-check.log`、`cargo-test.log`、`cargo-clippy.log`、`verify-schema-result.txt`、`hash-correspondence-result.txt`）。

**结构守卫**：本树在交付前移除构建用的临时 `node_modules` 链接；守卫剩余违规为平台 `.claude/`、`.multica/`、`CLAUDE.md` 与既有 vendor/pi `ref.missing` 环境项，本交付未新增生产路径违规。

## 4. 边界与未验项

- 未改既有迁移 `001–005`、旧库、公共文档、守卫、`product/05`、`package.json`、锁文件、`vendor/pi` 源码、`resources/skills`、identifier。
- 未执行生产迁移、未操作真实数据库/凭据/工作根；验证仅用内存库与新建合成临时根。
- 模块当前无并行调用方；函数签名随候选交付给后续使用者。
- 完整 `npm run check` 由唯一集成执行者在实际最终版本串行执行，本记录不预支该绿证。
- 独立审查：实现交付后由未参与实现的 ZCode 复核增量。

## 5. F-1 修订（2026-11-07）

ZCode 独立评审 F-1（MINOR）：对 DELETE 模式的外来／旧标记库，`open()`／`init()` 在拒绝前执行 `journal_mode=WAL`，被拒文件头部发生转换写入（字节 18/19：1/1→2/2）。数据零丢失、不合并不覆盖、错误如实，但与本项「拒绝不写入」验收存在实测偏差。

**最小修正**

- `open_existing_with_fault` 顺序调整为 `validate` → `configure_connection` → `apply_migrations`：校验通过前不触碰日志模式，被拒库零写入。
- `classify` 增加 `application_id` 判定：空白文件或迁移回滚遗留的 `web-backend/1` 半成品（`application_id = 0x57424b31`、无表、`user_version=0`）视为可重新初始化；携带其他 lineage application_id 的库视为既有库并走校验拒绝。

**新增回归（5 例，共 17 例全过）**

- `rejection_leaves_foreign_delete_mode_database_untouched`：旧库标记 `0x53444b31` 的 DELETE-mode 库，`open`／`init` 均拒绝，文件字节与旁文件集合不变，无 `-wal`／`-shm`。
- `rejection_leaves_wrong_application_id_database_untouched`：错误 application_id（12345）同上。
- `rejection_leaves_legacy_marked_empty_database_untouched`：仅旧标记、无表的库，`init` 拒绝且字节不变。
- `lineage_rejection_leaves_database_untouched`：lineage 不符拒绝前后字节不变。
- `version_rejection_leaves_database_untouched`：版本镜像不符拒绝前后字节不变。

**保留行为**：合法 `init`／`open`、幂等、每连接 `foreign_keys=ON`／WAL／FULL、迁移失败回滚与重试均不变（原 12 例仍全过）。

**NIT 登记（不修）**

- N-1：备份副本终态为 WAL，目标 `journal_mode=DELETE` 未生效（无害）。
- N-2：备份版本校验对构建最新值而非源库实际值（当前不可达，002+ 前改）。
- N-3：符号链接拒绝误标 `CORRUPT_DATABASE`（错误码语义）。
- N-4：备份父目录失败走 `WORKSPACE_IO`（错误码语义）。

**聚焦验证**：`cargo fmt --check` 0；`cargo check --lib` 0；`cargo test --lib web_backend_schema` 0（17 passed／0 failed）；`cargo clippy --all-targets -- -D warnings` 0；`check:docs` 0。未改 DDL，未跑完整重门禁。提交号见 `build/web-foundation-schema-authorization/implementation-manifest.json`。
