# MAYNE-20 后端基础探针：第三轮修订与作者侧验证记录（2026-11-07）

> **已被第四轮修订记录取代**：本记录对应的修订候选 `fa88332`（tree `6e1b908`）被 Codex 复审出具 BLOCK/needs_revision（复查失败被当作无变化放行、FIFO 阻塞调度并占锁）。第四轮修订后的交付与实际验证证据见 [backend-foundation-20261107-r4.md](backend-foundation-20261107-r4.md)；本记录保留作历史，不再代表当前候选。
>
> 本记录是 MAYNE-20 修订候选 `a17a6b4`（tree `f3c455f`）被 Codex 复审出具 BLOCK/needs_revision 后的**第三轮修订侧证据**，结论只到“可再送独立评审”。实现者不给自己签 pass；独立复审由未参与者执行，工作流收口由 Codex 负责。历史记录见 [backend-foundation-20261106.md](backend-foundation-20261106.md)、[backend-foundation-20261107.md](backend-foundation-20261107.md) 与 [backend-foundation-20261107-r2.md](backend-foundation-20261107-r2.md)。

## 1. 版本可复核性

- 被复审候选：`a17a6b4df12f01c54a62d6d6222be08986b207b4`，tree `f3c455fd1cb41b3c57bf97b6f6ca48e614bc72cf`，代码 `d74a3b455a5b32168942f4ceb0b832655f79b261`（分支 `agent/claude/mayne-20`）。
- 第三轮修订交付：commit `f54ab36735cec1c6f34f6ecf2a275e2504064c35`，tree `04edc06b7fccc0a80140354fd9e39a2844f37db4`（分支 `agent/claude/mayne-20`，基线 `85feb8a` 仍为祖先）。
- 复核方式：`git diff a17a6b4 f54ab36`（改动清单）；下表 sha256 可对 commit `f54ab36` 的树逐文件核对。

| 文件 | sha256 |
|---|---|
| `tests/probes/backend-foundation/run-probes.mjs` | `eab74f1c2ca452107503378c35a09397f40c622167eab8af3c4158e4b13800bd` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs` | `8c7de1941f8d2ad1df0aa4e947753130d1404f4584aec739f097498dd6659d41` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/main.rs` | `7efe1610e90176fee01387379fb017608017ed85f2529c87a11a1619c767d851` |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | `4b14a4e1dbd95a80a859bdb9b6d52c2b7c763a002c46c45c8b067d01e004bf3e`（未变） |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.lock` | `3d23851408674436d286b342fff330e12945b36a4a18f7746c96f0e509088cf8`（未变） |
| `docs/engineering/backend-foundation-probes.md` | `7188b56cccfae8ff764fae65340e9a9e7e50c87392271f9345ad3697bd4b93d6` |

写入范围不变：`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本任务 `docs/reviews/backend-foundation-*.md`；未改 `src-tauri/`、生产 Cargo manifests/锁文件、`package.json`、`docs/product/05`、根 README、`docs/reviews/README.md`。Cargo.toml/Cargo.lock 哈希未变（未新增依赖）。

## 2. 逐项关闭情况

### P1 worker 核查早于根锁，使用过期记录放行 —— 已关闭

- 改动（`storage-adapter-probe/src/main.rs`）：`try_schedule` 改为**先**调用 `StorageAdapter::open(&root, false, Fault::None)` 取得完整适配与根锁，**再**读取 worker 记录。记录读取改为受控打开：`OpenOptions` 打开句柄，核对句柄 metadata 与 lstat 的 `dev/ino/mode/nlink/mtime/size` 一致后读取，并保存 `RecordSnapshot`；探测后、发布准入前调用 `recheck_worker_record` 再核对一次快照，任何身份/版本变化即置为 `Unverified` 并暂停。RootInUse 分支只把记录用于诊断，决策恒为 REJECT。
- 测试钩子：D6 用合成 Python 脚本作为 `SIDEKICK_PROBE_KILL`。脚本在探测期间先尝试 `fcntl.flock` 取根锁（验证探测受锁保护，`rootLockAvailableDuringProbe=false`），随后**不持锁**地原子替换记录为运行器存活 PID，或把记录权限降为 0644。
- 新证据（D6 3 例）：探测期间记录被原子替换 → REJECT `WORKER_UNVERIFIED`；探测期间权限降级 → REJECT `WORKER_UNVERIFIED`；记录不变的正对照 → ACCEPT。三例的 `rootLockAvailableDuringProbe` 均为 `false`，证明探测发生在锁保护之内。

### P2 运行中标记权限降级未停止读取 —— 已关闭

- 改动（`storage-adapter-probe/src/adapter.rs`）：`verify()` 对归属标记改用已有的 `same_private_file(&marker, &self.lock)` 复核，补上 `mode == 0600` 校验（此前只查类型、链接数与 dev/ino），与私有文件/目录使用同一套私有性判据。
- 新证据：新增 `Fault::DegradeMarker`，运行器 B 组 `degrade-marker` 场景断言首次使用 `PATH_CHANGED`、随后 `STORAGE_STOPPED`；新增 Rust 测试 `marker_privacy_change_must_stop_storage` 直接覆盖同一路径（打开后将标记降为 0644，首次 `count()` 为 `PATH_CHANGED`、第二次为 `STORAGE_STOPPED`）。

## 3. 实际命令与退出码（2026-11-07，macOS 合成根）

```text
node tests/probes/backend-foundation/run-probes.mjs
→ exit 0；65/65 场景通过（242 项检查、场景内记录 harness 调用 74 次；seed 播种由运行器辅助函数执行，不计入场景记录）
cargo test --offline --manifest-path …/storage-adapter-probe/Cargo.toml   # exit 0（2/2 通过）
cargo fmt --manifest-path …/storage-adapter-probe/Cargo.toml -- --check # exit 0
cargo clippy --offline --manifest-path …/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings  # exit 0
node --check tests/probes/backend-foundation/run-probes.mjs               # exit 0
npm run check:docs                                                       # exit 0（18 文件、300 本地链接；检查器排除 docs/reviews/**）
git diff --check                                                         # exit 0
```

harness 子命令实际结果（节选，完整 stdout/stderr JSON 见 `build/backend-foundation/results.json`、`run.log`）：

```text
try-schedule --root …/d-race-unchanged                       # exit 0（ACCEPT；available=false）
try-schedule --root …/d-race-replace                         # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
try-schedule --root …/d-race-chmod                           # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
open-check --root … --fault degrade-marker                   # exit 0（faultFirstUse=PATH_CHANGED，faultSecondUseStopped=true）
try-schedule --root …/d-worker-pid-range                     # exit 0（REJECT/WORKER_UNVERIFIED）
try-schedule --root …/d-worker-probe-perm                    # exit 0（REJECT/WORKER_ALIVE）
try-schedule --root …/d-worker-probe-esrch                   # exit 0（ACCEPT）
try-schedule --root …/d-schedule-empty                       # exit 0（REJECT/UNKNOWN_ROOT，目录仍为空）
```

## 4. 计数

- 场景 65/65 通过；单项检查 242/242 通过；场景内记录 harness 调用 74 次；cargo 离线构建 exit 0；`cargo test` 2/2 通过；`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings` exit 0；`node --check` exit 0；`npm run check:docs` exit 0；`git diff --check` exit 0。
- 本轮新增覆盖：D6 worker 记录准入竞争 3 例（原子替换、权限降级、正对照），B 组 `degrade-marker` 打开后标记权限降级 1 例，Rust 侧标记私有性回归 1 例。

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

作者侧结论：**第三轮修订交付，待独立复审**（pass/needs_revision/reject 由未参与实现的评审者出具）。交付物：`tests/probes/backend-foundation/`（harness + 运行器）、`docs/engineering/backend-foundation-probes.md`、本记录；代码版本 `f54ab36`（tree `04edc06`）。原始证据在 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），未入库。复现：`node tests/probes/backend-foundation/run-probes.mjs` 与 `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml`（需本机 cargo 缓存中的锁定依赖）。
