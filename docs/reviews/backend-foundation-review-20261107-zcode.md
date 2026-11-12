# 后端基础探针候选独立复核（ZCode，2026-11-07）

> 结论：**BLOCK / needs_revision**。三项 P1 经本机独立复现全部成立，本轮候选不得合入；上一轮已关闭项复核属实。本记录不修改候选实现，不改任务状态；范围与证据约定见[验证约定](../engineering/verification.md)。

## 1. 对象与边界

- 基线 `85feb8a`；候选链 `355d1a0`（上轮候选）→ `9cffe39`（代码修订）→ `55684a2`（交付记录），分支 `agent/kimi/mayne-17`。`git merge-base --is-ancestor` 逐一核实为线性祖先，无 reset/rebase。
- 审核者 ZCode 未参与本项实现；风险级 R3（根/数据库安全、连接生命周期、调度失败语义、验证充分性、写入范围）。
- 方法：`git archive 55684a2` 导出到本工作树之外的隔离副本，全部命令针对该副本；合成根只落在副本自身 `build/` 下。未把候选代码接入任何分支，未切共享分支，未触真实工作根/凭据，未修改代码与 issue 状态。
- 写入范围核对：相对基线新增 9 个文件，全部位于允许范围（`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、`docs/reviews/backend-foundation-*.md`）；`git diff --check 85feb8a 55684a2` exit 0。生产实现、`src-tauri/`、Cargo manifests、锁文件、共享文档零改动。

## 2. 新鲜验证（全部为本轮实跑）

| 检查 | 命令（要点） | exit | 结果 |
|---|---|---:|---|
| 版本可复核性 | 六文件 sha256 对照 `55684a2` 交付表 | — | 六项全部一致 |
| 探针全套 | `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建成功；**47/47 场景、175 项检查、56 次调用** |
| 格式 | `cargo fmt -- --check`（probe manifest） | 0 | 通过 |
| Lint | `cargo clippy --offline --all-targets -- -D warnings` | 0 | 通过，target 在隔离副本 build 下 |
| 语法 | `node --check run-probes.mjs` | 0 | 通过 |
| 文档链接 | `node scripts/checks/check-docs.mjs` | 0 | 18 文件、300 本地链接 |
| 调度/进程反例 | 自建 `repro.mjs`（§3/§4） | 0 | 反例全部复现 |
| 关闭顺序观察 | 派生 harness `cargo test root_lock_must_survive_until_sqlite_close`（§5） | **101** | 候选副本测试失败 |
| 同测试对照 | 仅把 `lock` 字段移到结构体末尾的副本 | 0 | 1/1 通过 |

原始日志与合成根均在隔离副本的 `build/` 下（不入库）；本记录保留命令、退出码与最小结果。

## 3. P1：调度入口绕过根安全准入（独立确认）

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:452`（直接 `acquire_root_lock`）、`src/adapter.rs:227`–`:229`（标记缺失即 `create_new`）、`main.rs:478`–`:479`（仅 `validate_existing_database` 内容校验）。候选自己的工程说明 §2 把 `try-schedule` 列为已有根入口并承诺"任何缺失都拒绝且不创建"，实现与之矛盾。

本轮实测（自建合成根，每例含对照）：

| 合成输入 | `try-schedule` | 对照 `open-reject` 同根 |
|---|---|---|
| 空 0700 目录 | exit 1 / REJECT `CORRUPT_DATABASE`，**但目录出现空 `.sidekick-workspace`（0600）** | — |
| db 额外硬链 | exit 0 / **ACCEPT** | `PATH_CHANGED` 拒绝 |
| db 0644 | exit 0 / **ACCEPT** | `PATH_CHANGED` 拒绝 |
| `runs/` 换符号链接 | exit 0 / **ACCEPT** | `PATH_CHANGED` 拒绝 |
| 标记内容改 `unrecognized-root` | exit 0 / **ACCEPT** | `UNKNOWN_ROOT` 拒绝 |
| 根目录 0755 | exit 0 / **ACCEPT** | `PATH_CHANGED` 拒绝 |

影响：调度探针的 ACCEPT 不能解释为根安全准入；非根目录会被写入标记，不安全根被放行。上轮"零创建"只在普通打开入口关闭。

必需修订：调度复用 `StorageAdapter::open(false)` 的完整准入（或完全等价、零创建的共同入口）；显式 `init` 才可创建；把上述反例加进持久矩阵并断言拒绝后文件树不变（当前仅 `open-check` 有该断言）。

## 4. P1：进程探测失败折叠为"已退出"（独立确认）

位置：`main.rs:413`–`:414`（记录 pid 只要为正 i64 即 `Verified`，无 pid_t 范围约束）、`main.rs:432`–`:436`（`/bin/kill -0` 的非成功退出与命令启动失败一律 `alive=false`）。

实测：`runs/worker.json`（0600）写入 `{"pid":9223372036854775000}` 后 `try-schedule` exit 0 / **ACCEPT** 且 `worker.alive=false`；对照 `/bin/kill -0 9223372036854775000` **exit 2**（`illegal process id`），并未确认任何进程退出。`main.rs:368`–`:370` 的注释自己写明契约是"unverifiable ⇒ pause"，该实现违反了它。

必需修订：区分 alive / 确认 exited / 无法核实三态，只有确认不存在才放行；pid 范围约束到目标平台 pid_t；权限不足、非法 PID、命令失败均暂停；补受控探测失败反例（不用真实进程或提权）。

## 5. P1：根锁先于连接关闭，drop 内出现空窗（独立确认）

位置：`src/adapter.rs:134`（`lock: File`）声明于 `:142`（`db: Connection`）之前；Rust 按声明序 drop，因此适配析构先释放 advisory 根锁、后执行 `sqlite3_close`（含 WAL 检查点）。`:132`–`:133` 注释声称"锁生命周期等于连接生命周期"，在 drop 这一刻不成立。

实测：在候选 crate 的派生副本中仅追加观察测试（`sqlite3_trace_v2` 的 `SQLITE_TRACE_CLOSE` 回调内对新 fd `try_lock` 同根标记；未改候选任何方法）——候选副本断言失败 `root lock already available inside SQLite CLOSE callback`，cargo **exit 101**；同一测试仅把 `lock` 字段移到结构体末尾的对照副本 **exit 0**（1/1 通过）。

候选套件缺口：A1 只观察 drop 之前与之后；D4 的优雅退出在 stdin EOF 后调用 `std::process::exit(0)`（`main.rs:364`），**跳过全部析构**，锁由内核回收——`main.rs:362`–`:363` 注释"dropping the adapter releases the root lock"与实际机制不符，D4 也未覆盖适配析构路径。

必需修订：保证先关连接再释放锁（调整字段序或显式控制释放顺序），并把关闭期竞争断言持久化进候选自身测试矩阵；优雅退出用例实际执行适配析构，与内核回收分开留证（此注释失真可与修订同轮处理，记 P3）。

## 6. 上轮清单处置复核

- 上轮 P1-1（普通打开创建副作用）：已关。`open(false)` 全程零创建（`adapter.rs:285`–`:290`、`:320`–`:334`），A5/A5b/A2 附"拒绝后文件树不变"断言，本轮实跑通过。但调度入口未关（§3）。
- 上轮 P1-2（不可核实记录被当作无记录）：损坏 JSON、缺 pid、符号链接、额外硬链、0644 五例均 REJECT `WORKER_UNVERIFIED`（本轮实跑）；探测错误族未关（§4）。
- 上轮 P1-3（证据矩阵）：B 组 18 例 + 目录身份 6 例 + 打开后侧文件/权限 fault 3 例已持久，本轮实跑通过；只证明普通打开入口，不能外推调度入口。
- 上轮 P2（Linux 平台断言、fmt/clippy、根锁文案）：已关，本轮全部实跑证实；Linux 实测仍缺，按候选文档 §6 保持"仅静态依据"。
- 上轮 P3（版本哈希）：六项源码哈希与 `9cffe39` 交付表逐文件一致（本轮重算）。

## 7. 分级结论与准出

- **P0：无。P1：三项**（§3 调度绕过、§4 探测失败折叠、§5 关闭顺序空窗）。P3 一项（D4 注释与 `exit(0)` 机制不符）。
- 结论：**BLOCK / needs_revision**，本轮不合入。修订者从 `55684a2` 接回；新版必须给出新的精确版本/哈希与实际命令、退出码，反例补进持久矩阵后交独立复审。
- 仍未验证、不得据此晋级：Linux 实测、正式适配实现、Node 进程内绑定/随包分发、生产凭据 Provider、真实模型/真实工作根、完整集成 `npm run check`。
- 本记录登记 `docs/reviews/README.md` 由集成负责人统一处理（共享写入范围）；本审核不代改。
