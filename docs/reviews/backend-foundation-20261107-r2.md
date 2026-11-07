# MAYNE-20 后端基础探针：第二轮修订与作者侧验证记录（2026-11-07）

> 本记录是 MAYNE-20 修订候选 `55684a2`（tree `cdd47fa`）被 Codex 复审出具 BLOCK/needs_revision 后的**第二轮修订侧证据**，结论只到“可再送独立评审”。实现者不给自己签 pass；独立复审由未参与者执行，工作流收口由 Codex 负责。历史记录见 [backend-foundation-20261106.md](backend-foundation-20261106.md) 与 [backend-foundation-20261107.md](backend-foundation-20261107.md)。

## 1. 版本可复核性

- 被复审候选：`55684a296f81e964767dbcd7a9c9391304dfdd1b`，tree `cdd47fa86fab38b37076f570eb34a2e3821d2977`（分支 `agent/kimi/mayne-17`，已 cherry-pick 到本任务分支 `agent/claude/mayne-20`）。
- 第二轮修订交付：commit `d74a3b455a5b32168942f4ceb0b832655f79b261`，tree `dfae697f61a117c98c99527853bdb93d7255ca97`（分支 `agent/claude/mayne-20`，基线 `85feb8a` 仍为祖先）。
- 复核方式：`git diff 55684a2 d74a3b4`（改动清单）；下表 sha256 可对 commit `d74a3b4` 的树逐文件核对。

| 文件 | sha256 |
|---|---|
| `tests/probes/backend-foundation/run-probes.mjs` | `19b8a5dc9f819426e3caabcc4571ea6b5494b3d26041ca86ccee6a1879ce8787` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs` | `c46d343681c7d1a60005d9293eff8591e988a58306f1c2caf1c05ab06b60fd38` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/main.rs` | `1c0308c0ceca1b7c125e2a9d4ba98631b2f97f0001f11108909b6d9bd5a38b71` |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | `4b14a4e1dbd95a80a859bdb9b6d52c2b7c763a002c46c45c8b067d01e004bf3e`（未变） |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.lock` | `3d23851408674436d286b342fff330e12945b36a4a18f7746c96f0e509088cf8`（未变） |
| `docs/engineering/backend-foundation-probes.md` | `8285872717cc194c0f1f9cbb0b3a7372a82d625c514c153d0eb734e046aeff39` |

写入范围不变：`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本任务 `docs/reviews/backend-foundation-*.md`；未改 `src-tauri/`、生产 Cargo manifests/锁文件、`package.json`、`docs/product/05`、根 README、`docs/reviews/README.md`。Cargo.toml/Cargo.lock 哈希未变（未新增依赖）。

## 2. 逐项关闭情况

### P1-1 调度入口绕过根安全校验 —— 已关闭

- 改动（`storage-adapter-probe/src/main.rs`）：`try_schedule` 不再直接调用 `acquire_root_lock` 后只校验数据库内容，改为调用 `StorageAdapter::open(&root, false, Fault::None)`，与普通打开共用同一完整入口：归属标记存在与 MAGIC、7 个必需私有目录身份（存在、普通目录、0700、非符号链接）、数据库身份/私有性（单一硬链、0600、非符号链接）与内容均先校验，根锁在决策期间持有。空目录不再被创建归属标记，不安全根不再被放行。
- 新证据（运行器 D5，10 例，均断言拒绝后文件树不变）：空目录/标记内容错误 → `UNKNOWN_ROOT`；标记符号链接/硬链/缺私有目录 → `INVALID_ROOT`；缺库 → `MISSING_DATABASE`；数据库硬链/0644、`runs/` 符号链接、根目录 0755 → `PATH_CHANGED`。

### P1-2 进程探测失败被当作退出 —— 已关闭

- 改动（`main.rs`）：新增 `WorkerLiveness`（存活/确认退出/无法核实）与 `WorkerStatus`，`probe_worker` 先限制 PID 在 `1..=2147483647`（`i32::MAX`）内；`kill -0` 成功即存活；stderr 含 `Operation not permitted`（EPERM）按存活处理（进程存在但无信号权限）；含 `No such process`（ESRCH）为确认退出；其它非零退出、被信号终止、命令启动失败均为无法核实。只有 `Absent` 或 `Exited` 才放行，`Alive`/`Unverified` 一律 REJECT。
- 测试钩子：`SIDEKICK_PROBE_KILL` 覆盖探测程序，运行器用合成脚本注入权限拒绝与启动失败，不触碰真实进程、不提权。
- 新证据（D2 新增 4 例）：pid 超出有效范围 → REJECT/`WORKER_UNVERIFIED`；探测命令无法启动 → REJECT/`WORKER_UNVERIFIED`；探测权限不足 → REJECT/`WORKER_ALIVE`；探测确认不存在 → ACCEPT。

### P1-3 关库前提前释放根锁 —— 已关闭

- 改动（`adapter.rs`）：`StorageAdapter` 字段重排，`db: Connection` 位于 `lock: File` 之前；Rust 按字段声明顺序析构，保证 SQLite 连接完全关闭后才释放根锁。
- 改动（`main.rs`）：`hold` 在 stdin EOF 后显式 `drop(adapter)`，正常退出实际执行连接/适配析构；SIGKILL 场景仍由内核回收锁，两种留证分开。
- 回归测试（`adapter.rs` `close_order_tests::root_lock_must_survive_until_sqlite_close`）：通过 `rusqlite::ffi::sqlite3_trace_v2` 注册 `SQLITE_TRACE_CLOSE` 回调，回调内用新 fd 尝试 `try_lock`。修复前该断言失败（cargo exit 101，回调内可取得根锁），修复后 1/1 通过。

## 3. 实际命令与退出码（2026-11-07，macOS 合成根）

```text
node tests/probes/backend-foundation/run-probes.mjs
→ exit 0；61/61 场景通过（228 项检查、场景内记录 harness 调用 70 次；seed 播种由运行器辅助函数执行，不计入场景记录）
cargo test --offline --manifest-path …/storage-adapter-probe/Cargo.toml   # exit 0（1/1 通过）
cargo fmt --manifest-path …/storage-adapter-probe/Cargo.toml -- --check # exit 0
cargo clippy --offline --manifest-path …/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings  # exit 0
node --check tests/probes/backend-foundation/run-probes.mjs               # exit 0
npm run check:docs                                                       # exit 0（见 §4 计数）
git diff --check                                                         # exit 0
```

harness 子命令实际结果（节选，完整 stdout/stderr JSON 见 `build/backend-foundation/results.json`、`run.log`）：

```text
try-schedule --root …/d-schedule-empty                          # exit 0（REJECT/UNKNOWN_ROOT，目录仍为空）
try-schedule --root …/d-schedule-marker-content                  # exit 0（REJECT/UNKNOWN_ROOT）
try-schedule --root …/d-schedule-marker-symlink                  # exit 0（REJECT/INVALID_ROOT）
try-schedule --root …/d-schedule-marker-hardlink                 # exit 0（REJECT/INVALID_ROOT）
try-schedule --root …/d-schedule-missing-dirs                    # exit 0（REJECT/INVALID_ROOT）
try-schedule --root …/d-schedule-missing-db                      # exit 0（REJECT/MISSING_DATABASE）
try-schedule --root …/d-schedule-db-hardlink                     # exit 0（REJECT/PATH_CHANGED）
try-schedule --root …/d-schedule-db-mode                         # exit 0（REJECT/PATH_CHANGED）
try-schedule --root …/d-schedule-runs-symlink                    # exit 0（REJECT/PATH_CHANGED）
try-schedule --root …/d-schedule-root-mode                       # exit 0（REJECT/PATH_CHANGED）
try-schedule --root …/d-worker-pid-range                         # exit 0（REJECT/WORKER_UNVERIFIED）
try-schedule --root …/d-worker-probe-spawn                       # exit 0（REJECT/WORKER_UNVERIFIED）
try-schedule --root …/d-worker-probe-perm                        # exit 0（REJECT/WORKER_ALIVE）
try-schedule --root …/d-worker-probe-esrch                       # exit 0（ACCEPT）
try-schedule --root …/d-worker-dead                               # exit 0（ACCEPT）
try-schedule --root …/d-worker-absent                             # exit 0（ACCEPT）
```

## 4. 计数

- 场景 61/61 通过；单项检查 228/228 通过；场景内记录 harness 调用 70 次；cargo 离线构建 exit 0；`cargo test` 1/1 通过；`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings` exit 0；`node --check` exit 0；`npm run check:docs` exit 0（18 文件、300 本地链接；检查器按约定排除 `docs/reviews/**`）；`git diff --check` exit 0。
- 负例覆盖新增：调度入口 10 项根安全反例（空目录、标记内容/符号链接/硬链、缺目录、缺库、库硬链/权限、`runs/` 符号链接、根权限）与 4 项进程探测反例（pid 越界、启动失败、权限不足、确认不存在）。

## 5. 未验证项（保持开放）

1. **Linux 全部未实测**：本机无 Linux 机器；`docs/engineering/backend-foundation-probes.md` §6 只给静态依据与准入清单，不伪称跨平台通过。运行器已按平台分支断言，Linux 上可重跑。
2. 正式适配未实现、未生产化：本 harness 是参考实现；schema/迁移/依赖授权未申请。
3. 进程内 Node→Rust 绑定（N-API 类）与随包分发适配二进制：需要新构建链/依赖授权，本轮未做。
4. 生产 Keychain 后端现状为关闭（`production_credentials()` 固定 `enabled: false`）；macOS 无桌面会话不可用、Linux env 引用与缺失引用失败均未实测。
5. 并发 3/持久队列/取消/恢复/幂等等队列语义属 W1–W2，本探针只验证存储边界前提。
6. 真实模型/凭据/工作根、代理部署、浏览器 G1–G3 业务均不在本范围。
7. 未运行 `npm run check`：按父任务约定，重门禁由门禁/集成负责人串行执行；本轮只跑本探针命令与上述单项检查，不用聚焦通过代签全量。
8. `docs/reviews/README.md` 索引登记待集成负责人补（共享写入范围）。

## 6. 结论

作者侧结论：**第二轮修订交付，待独立复审**（pass/needs_revision/reject 由未参与实现的评审者出具）。交付物：`tests/probes/backend-foundation/`（harness + 运行器）、`docs/engineering/backend-foundation-probes.md`、本记录；代码版本 `d74a3b4`（tree `dfae697`）。原始证据在 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），未入库。复现：`node tests/probes/backend-foundation/run-probes.mjs` 与 `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml`（需本机 cargo 缓存中的锁定依赖）。
