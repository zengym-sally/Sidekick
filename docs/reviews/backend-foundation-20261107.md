# MAYNE-20 后端基础探针：评审修订与作者侧验证记录（2026-11-07）

> **已被第二轮修订记录取代**：本记录对应的修订候选 `55684a2`（tree `cdd47fa`）被 Codex 复审出具 BLOCK/needs_revision（调度入口绕过根安全校验、进程探测失败被当作退出、关库前提前释放根锁）。第二轮修订后的交付与实际验证证据见 [backend-foundation-20261107-r2.md](backend-foundation-20261107-r2.md)；本记录保留作历史，不再代表当前候选。
>
> 本记录是 MAYNE-20 候选 `355d1a0` 被独立评审（ZCode）出具 BLOCK/needs_revision 后的**修订侧证据**，结论只到“可再送独立评审”。实现者不给自己签 pass；修订后的独立复审由未参与者执行，工作流收口由 Codex 负责。第一轮记录见 [backend-foundation-20261106.md](backend-foundation-20261106.md)（已被本记录取代）。

## 1. 版本可复核性（回应 P3：补实际 commit/tree、改动清单与源码哈希）

- 被评审候选：`355d1a0d317ed9a6bce80a7df732f615161fefc1`，tree `0ee251229ce3d6b80d9336bb33c7984f3b1bf01b`（分支 `agent/kimi/mayne-17`）。
- 修订交付：commit `9cffe394c1c90d73a60c7effe563189e185cce5a`，tree `9e6c6731561374cbc309462ed15ab1f0bc4d9abd`；只在该分支上新增提交，未 reset/rebase/amend `355d1a0`，基线 `85feb8a` 仍为祖先。
- 复核方式：`git diff 355d1a0 9cffe39`（改动清单）；下表 sha256 可对工作树逐文件核对交付版本。

| 文件 | sha256 |
|---|---|
| `tests/probes/backend-foundation/run-probes.mjs` | `340774cd01167e32e0fef933d5e862ea3af62d0a20ece23c1d76a6c00636da74` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs` | `e96ad2237ad314de9eb537553b2c51d7240ffe04bb23c269570ba2b7207a78ed` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/main.rs` | `c784fbc9562fd3e08913d6c81dced237495388a2b1fc7768e7314e5cca41916b` |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | `4b14a4e1dbd95a80a859bdb9b6d52c2b7c763a002c46c45c8b067d01e004bf3e` |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.lock` | `3d23851408674436d286b342fff330e12945b36a4a18f7746c96f0e509088cf8` |
| `docs/engineering/backend-foundation-probes.md` | `379d553cb87accd47b60dd9b2a7373d7131e1d88eeb4d324aa12f919783c81a7` |

写入范围不变：`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本任务 `docs/reviews/backend-foundation-*.md`；未改 `src-tauri/`、Cargo manifests 之外的生产文件、`package.json`、锁文件、`docs/product/05`、根 README、`docs/reviews/README.md`。Cargo.toml/Cargo.lock 哈希未变（未新增依赖）。

## 2. 逐项关闭情况

### P1-1 普通打开仍有创建副作用 —— 已关闭

- 改动（`storage-adapter-probe/src/adapter.rs`）：`open()` 现在把两条路径完全分离。`allow_init=false`（普通打开）在取得根锁后、任何写入前校验归属标记（存在且身份相符）与 7 个必需私有目录（存在、普通目录、0700、非符号链接）；缺失标记返回 `UNKNOWN_ROOT`、缺目录返回 `INVALID_ROOT`、缺库返回 `MISSING_DATABASE`，全程不创建任何文件。`allow_init=true` 是唯一创建流程（新增 `init` 子命令）：创建标记并写入 MAGIC、0700 私有目录、0600 数据库并写入 application_id/user_version 与合成 schema。原 `private_dir()` 的隐式创建只保留在 init 路径。
- 新证据（运行器）：A5 空目录 `open-reject` 得 `UNKNOWN_ROOT` 且目录仍为空；A5b 有标记缺目录得 `INVALID_ROOT` 且不补建；A2 缺库拒绝后库文件仍缺席；A4 证明 `init` 产物可作已有根 `open-check`（`countBefore=0`）；A4b 证明 init 不吞并非有目录。所有拒绝类场景统一附加“拒绝后文件树不变”断言（运行器 `snapshot()` 前后对比，含类型与权限位）。

### P1-2 无法核实的旧 worker 被当作可调度 —— 已关闭

- 改动（`main.rs`）：`try_schedule` 区分三种记录状态——无历史记录（`Absent`，可继续）、已核实（`Verified{pid}`，按 PID 存活判断）、不可核实（`Unverified`：读取失败、非法 JSON、缺有效 pid、记录文件是符号链接/额外硬链/权限非 0600）。不可核实时返回明确 `WORKER_UNVERIFIED`（decision=REJECT），不再折叠成“无记录”后 ACCEPT。`hold` 写 worker 记录改用 0600 创建，与调度侧身份校验一致。
- 新证据：D2 矩阵 8 例——内容损坏、缺 pid、符号链接、额外硬链、权限 0644 均 REJECT/`WORKER_UNVERIFIED`；存活 PID REJECT/`WORKER_ALIVE`；已退出 PID 与无记录均 ACCEPT。

### P1-3 文件安全证据矩阵未闭合 —— 已关闭

- 打开时负例（运行器 B 组，期望 `PATH_CHANGED`）：`data/`、`runs/`、`config/` 的符号链接与 0755 权限各 2 例；`-shm` 符号链接、硬链（nlink=2）、0644 各 1 例。适配侧 `verify()` 现持有全部 7 个必需目录的句柄逐次校验，`open()` 对普通打开先验目录身份再开库。
- 打开后身份变化（`open-check --fault`，首次使用 `PATH_CHANGED`、之后 `STORAGE_STOPPED`）：`replace-wal`（写入后 `-wal` 被换符号链接）、`replace-shm`（写入后 `-shm` 被换额外硬链）、`degrade-runs`（打开后 `runs/` 降为 0755）。

### P2-1 Linux 运行路径必然误报失败 —— 已关闭

- 改动（运行器 E 场景）：按 `process.platform` 分支断言。macOS 检查合成钥匙串往返（`syntheticOnly`/`fixtureRemoved`）；非 macOS 只断言 `supported=false` 且不宣称已验证。Linux 上存储场景不再被 Keychain 断言误报为失败。

### P2-2 Rust 质量门禁失败 —— 已关闭

- `cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings`（均带 `--offline`，`CARGO_TARGET_DIR=build/backend-foundation/target`）现均 exit 0；修掉原两处 `needless_borrows_for_generic_args`（`adapter.rs` 的 `fs::copy`、`main.rs` wal_check 只读连接）与格式问题。

### P2-3 文档过度解释根锁 —— 已关闭

- `docs/engineering/backend-foundation-probes.md` §4 尾段改为：根锁是 advisory 文件锁，只约束通过同一适配器取得锁的打开者（C 场景第二只读连接本身按路径直接开库即为反证）；正式适配必须把“业务库只由持锁适配打开”作为**代码层访问纪律**实现与审查，不暗示文件系统级强制隔离。

## 3. 实际命令与退出码（2026-11-07，macOS 合成根）

```text
node tests/probes/backend-foundation/run-probes.mjs
→ exit 0；47/47 场景通过（175 项检查、场景内记录 harness 调用 56 次；seed 播种由运行器辅助函数执行，不计入场景记录）
cargo build --release --manifest-path …/storage-adapter-probe/Cargo.toml --offline   # exit 0（CARGO_TARGET_DIR=build/backend-foundation/target）
cargo fmt --check（harness 目录）                                                    # exit 0
cargo clippy --all-targets --offline -- -D warnings（harness 目录）                  # exit 0
node --check tests/probes/backend-foundation/run-probes.mjs                          # exit 0
npm run check:docs                                                                    # exit 0（18 文件、300 链接）
git diff --check                                                                      # exit 0
```

harness 子命令实际结果（节选，完整 stdout/stderr JSON 见 `build/backend-foundation/results.json`、`run.log`）：

```text
init --root …/a-init                                            # exit 0（创建标记/7 目录/库，身份写入）
open-check --root …/a-init                                      # exit 0（countBefore=0，init 产物可作已有根）
init --root …/a-init-reject                                     # exit 1（UNKNOWN_ROOT，文件树不变）
open-reject --root …/a-open-empty --expect UNKNOWN_ROOT         # exit 0（目录仍为空）
open-reject --root …/a-open-missing-dirs --expect INVALID_ROOT  # exit 0（不补建目录）
open-reject --root …/b-{data,runs,config}-{symlink,mode} --expect PATH_CHANGED   # exit 0 ×6
open-reject --root …/b-shm-{symlink,hardlink,mode} --expect PATH_CHANGED         # exit 0 ×3
open-check --root … --fault replace-wal                         # exit 0（faultFirstUse=PATH_CHANGED，faultSecondUseStopped=true）
open-check --root … --fault replace-shm                         # exit 0（同上）
open-check --root … --fault degrade-runs                        # exit 0（同上）
try-schedule --root …/d-worker-{corrupt,no-pid,symlink,hardlink,mode}           # exit 0（REJECT/WORKER_UNVERIFIED ×5）
try-schedule --root …/d-worker-live                             # exit 0（REJECT/WORKER_ALIVE）
try-schedule --root …/d-worker-{dead,absent}                    # exit 0（ACCEPT ×2）
open-check --root … --fault swap-db                             # exit 1（PATH_CHANGED，原库保留）
host-facts / keychain-facts                                     # exit 0（macOS 合成往返；非 macOS 只报 supported=false）
```

## 4. 计数

- 场景 47/47 通过；单项检查 175/175 通过；场景内记录 harness 调用 56 次；cargo 离线构建 exit 0；fmt/clippy exit 0。
- 负例（拒绝类）覆盖：缺库不新建、空目录不建标记、缺目录不补建、非空无标记不吞并、符号链接（db/-wal/-shm/标记/data/runs/config）、硬链（db/-wal/-shm/标记/worker 记录）、权限位（db/-wal/-shm/标记/目录/根/worker 记录）、身份替换（swap-db、replace-marker）、损坏库、错误 application_id、未来 schema、未知根、打开后 -wal/-shm/runs 身份变化、worker 记录不可核实五种形态、worker 存活占锁、写事务中崩溃。

## 5. 未验证项（保持开放）

1. **Linux 全部未实测**：本机无 Linux 机器；`docs/engineering/backend-foundation-probes.md` §6 只给静态依据与准入清单，不伪称跨平台通过。运行器已按平台分支断言，Linux 上可重跑。
2. 正式适配未实现、未生产化：本 harness 是参考实现；schema/迁移/依赖授权未申请。
3. 进程内 Node→Rust 绑定（N-API 类）与随包分发适配二进制：需要新构建链/依赖授权，本轮未做。
4. 生产 Keychain 后端现状为关闭（`production_credentials()` 固定 `enabled: false`）；macOS 无桌面会话不可用、Linux env 引用与缺失引用失败均未实测。
5. 并发 3/持久队列/取消/恢复/幂等等队列语义属 W1–W2，本探针只验证存储边界前提。
6. 真实模型/凭据/工作根、代理部署、浏览器 G1–G3 业务均不在本范围。
7. 未运行 `npm run check`：按父任务约定，重门禁由门禁/集成负责人串行执行；本轮只跑本探针命令与上述单项检查，不用聚焦通过代签全量。注：本工作树 `npm run check:structure` 存在 175 项既有失败（`.multica/`、`.kimi/` 平台元数据与缺失的 `vendor/pi/**/dist` 构建产物），均与本任务写入范围无关，属既有环境问题（门禁任务范围）。
8. `docs/reviews/README.md` 索引登记待集成负责人补（共享写入范围）。

## 6. 结论

作者侧结论：**修订候选交付，待独立复审**（pass/needs_revision/reject 由未参与实现的评审者出具）。交付物：`tests/probes/backend-foundation/`（harness + 运行器）、`docs/engineering/backend-foundation-probes.md`、本记录；代码版本 `9cffe39`（tree `9e6c673`）。原始证据在 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），未入库。复现：`node tests/probes/backend-foundation/run-probes.mjs`（需本机 cargo 缓存中的锁定依赖）。
