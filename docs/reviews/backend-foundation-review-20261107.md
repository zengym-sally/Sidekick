# MAYNE-20 修订候选复核（2026-11-07）

> 结论：**needs_revision / BLOCK**。原有 47 个场景及 Rust 质量检查通过，但补充反例确认调度入口绕过根安全检查、进程探测失败被当作退出、关库之前提前释放根锁。不得合入或关闭；修订后仍需指定的 ZCode 独立复审。本记录不修改候选实现。

## 1. 对象与边界

- 基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`。
- 本轮候选：`55684a296f81e964767dbcd7a9c9391304dfdd1b`，tree `cdd47fa86fab38b37076f570eb34a2e3821d2977`，分支 `agent/kimi/mayne-17`。
- 代码修订：`9cffe394c1c90d73a60c7effe563189e185cce5a`；上轮候选 `355d1a0`，上轮评审见 [2026-11-06 记录](backend-foundation-review-20261106.md)。
- 审核者 Codex 未参与探针实现；风险 R3，覆盖根/数据库安全、连接生命周期、调度失败语义、验证充分性及写入范围。
- 对照 [Web/后端设计](../engineering/web-backend-design.md) §2/§5、[验证约定](../engineering/verification.md) 及 MAYNE-20 的合成根探针验收。候选相对基线新增 9 个文件，均在允许的探针、工程说明和本任务评审记录范围。
- 审核分支保持 `agent/codex/mayne-20`，起点 `6c42ac6`。通过 `git archive 55684a2` 导出隔离副本到 `build/backend-foundation-review/candidate/` 验证；未接入候选代码、切分支、操作共享 main 或真实工作根。

## 2. 新鲜验证

下表探针和质量检查均针对该候选的隔离副本；追加的关闭回调测试另在忽略目录中的派生 harness 执行。

| 命令 | exit | 结果 |
|---|---:|---|
| `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 47/47 场景、175 项检查、56 次记录调用；离线构建成功；自建 worker 已收尾 |
| `cargo fmt --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml -- --check` | 0 | 通过 |
| `cargo clippy --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings` | 0 | 通过，target 仅在本轮 build 下 |
| `node --check tests/probes/backend-foundation/run-probes.mjs` | 0 | 通过 |
| `node scripts/checks/check-docs.mjs` | 0 | 候选的 18 文件、300 本地链接通过 |
| `git diff --check 85feb8a..55684a2` | 0 | 通过 |
| `node build/backend-foundation-review/review-repros.mjs` | 0 | 复现下述调度/进程探测反例；脚本 exit 0 表示成功采集，不表示候选通过 |
| 派生 harness：`cargo test --offline --manifest-path Cargo.toml root_lock_must_survive_until_sqlite_close -- --nocapture` | 101 | 1 个测试失败：SQLite CLOSE 回调内已能取得根锁 |
| 同一测试的字段顺序对照副本 | 0 | 仅将根锁字段移到最后，1/1 测试通过；仅为诊断对照，不是已交付修复 |

本轮未运行完整 `npm run check`：父任务明确将串行重门禁交给门禁/集成负责人，本候选先按自身探针验收审查。本轮为 BLOCK，不签全量门禁、集成通过或阶段准入。没有复用作者的历史通过作为新证据。

原始证据位于 `build/backend-foundation-review/`：`probe-run.log`、候选内 `build/backend-foundation/results.json`、`review-repros.mjs`、脱敏 `review-repros.json`、`trace-close-order.log`、`trace-close-order-control.log`。不入库；本记录保留版本、命令和最小结果。关闭回调的追加测试源码 `close-order-repro.rs` 与脱敏反例结果随任务评论附送。

## 3. P1：调度入口绕过完整适配，仍会创建标记并接受不安全根

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:425`、`:452`、`:478`；`src/adapter.rs:210` 的 `acquire_root_lock()`。

违反不变量：已有根的所有打开入口都要拒绝意外创建，并检查根、目录、主库和侧文件的身份/私有性；调度不能旁路同一存储适配。工程说明 §2 明确把 `try-schedule` 列在已有根打开入口中。

实测：

| 合成输入 | `try-schedule` 的实际结果 |
|---|---|
| 空的 0700 目录，无归属标记 | exit 1 / `CORRUPT_DATABASE`，但目录从空变成含 `.sidekick-workspace` |
| 有效种子库增加一个硬链 | exit 0 / `ACCEPT` |
| 有效种子库权限改为 0644 | exit 0 / `ACCEPT` |
| `runs/` 改为指向挪走目录的符号链接，无 worker 记录 | exit 0 / `ACCEPT` |
| 归属标记改为 `unrecognized-root`，其余保持有效 | exit 0 / `ACCEPT` |

根因：修订只在 `StorageAdapter::open(false, ...)` 前置了校验；调度仍直接调用可创建标记的 `acquire_root_lock()`，之后只验证数据库内容，未走目录/文件身份及 MAGIC 校验。

影响：不能把调度探针的 ACCEPT 解释成根安全准入；错误目录会被修改，不安全根仍被放行。上轮普通打开零创建问题只在部分入口关闭。

必需修订：调度复用已有根的完整校验及适配生命周期，或使用完全等价且不创建的共同入口；显式 init 才能创建。把上述反例加入持久矩阵，断言拒绝后目录项和相关文件内容不变，避免只测试 `open-check`。

## 4. P1：进程探测的失败仍折叠成“worker 已退出”

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:413`、`:432`–`:436`。

违反不变量：无法确认旧 worker 已停止时暂停调度；“非零退出”不能直接等同于“进程不存在”。

实测：种子根的 0600 `runs/worker.json` 写入 `{"pid":9223372036854775000}` 后，`try-schedule` 返回 exit 0 / `ACCEPT`，`worker.alive=false`。单独对照 `/bin/kill -0 9223372036854775000` 返回 **exit 2**，stderr 为 `illegal process id`，并未确认任何 worker 已退出。

根因：记录只验证 pid 为正 i64；存活探测把所有非成功状态及命令启动失败都变成 false。内容损坏 JSON 的反例已补，但合法 JSON 中不可探测的 PID 及探测错误仍漏过。

影响：一旦 OS 进程查询失败，调度可以在无法确认旧 worker 的情况下继续；与明确的失败关闭契约相反。本轮实测的是非法 PID，权限拒绝和命令启动失败属于该分支的静态覆盖缺口，未冒称实测。

必需修订：限制有效 PID 范围，区分 alive、确认 exited、unverified 三态；只有明确不存在才放行，权限不足/非法 PID/命令错误均暂停。增加合成探测失败/权限错误的受控测试，不用真实进程或提权来制造反例。

## 5. P1：根锁先于 SQLite 连接析构，关闭期出现空窗

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs:134`、`:142`；`src/main.rs:362`–`:364`。

违反不变量：连接和根锁同生命周期，必须先关库再释放锁，不能让下一打开者在旧连接关闭/检查点期间取得根锁。

实测办法：在候选 crate 的隔离副本中，仅追加 Rust 单元测试。测试通过 `rusqlite::ffi::sqlite3_trace_v2` 注册 `SQLITE_TRACE_CLOSE` 回调；回调使用新的文件描述符尝试同一根锁。原适配器执行正常 `drop` 时，回调内 `try_lock()` **成功**，断言失败，cargo exit 101。相同测试仅将 `lock: File` 字段移到结构体最后的对照副本，回调内不能取锁，cargo exit 0。

追加测试没有修改候选方法或 SQLite 实现，只观察关闭边界；两个副本及编译 target 均在本轮 build 内。它不是生产运行证据，也不是候选原有的 47 场景之一。

根因与影响：结构体中的 `lock` 位于 `db` 之前，当前释放顺序会先放锁再关库；另一个实例可在旧连接尚未关闭时开始打开同根。原 A1 只检查存活期间/整体 drop 之后，没有观察 drop 内部顺序。D4 的 `hold` 在 EOF 后直接 `exit(0)`，也未覆盖注释声称的适配器正常析构。

必需修订：让连接完全关闭后再释放锁，并持久加入关闭期竞争断言；正常退出用例实际执行连接/适配析构，和内核因进程退出回收锁的场景分开留证。

## 6. 原清单处置与准出条件

- 原 P1-1：`open-check` 的空根/缺目录反例已修；所有已有根入口零创建仍未关闭，见本轮 §3。
- 原 P1-2：损坏 JSON、缺 pid、静态符号链接/硬链/权限反例已修；进程查询不可核实仍未关闭，见 §4。
- 原 P1-3：目录和 SHM、打开后的侧文件反例明显补强；这些通过只证明相应入口，不能外推调度入口。另见 §5 的生命周期空窗。
- 原 P2：Linux Keychain 断言已按平台分支处理；fmt/clippy 新跑通过；根锁文案已改为 advisory/代码访问纪律。Linux 实际运行仍未验证。
- 原 P3：已补具体代码 commit/tree 和源码哈希，六项逐文件哈希与 `9cffe39` 的交付表核对一致。
- P0：未发现；本轮阻断项为以上三项 P1，不以数量代替影响判断。

仍未验证：Linux、正式 Node/Rust 绑定与打包、生产凭据 Provider、真实模型/工作根、完整 Web 业务和集成全量门禁。未做 UI、代理部署、业务 schema/迁移评审：本候选没有这些实现。

保持原写入范围退回修订。新版交付必须提供新的精确版本/哈希与实际命令、退出码，补齐反例后交 ZCode 独立复审；候选通过和 W0 集成/阶段准入分别验收，不把本轮聚焦结果作为全量通过。未手工 commit/push/合并；评审记录按运行环境的分支交付机制保存。
