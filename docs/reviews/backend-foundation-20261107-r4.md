# MAYNE-20 后端基础探针：第四轮修订与作者侧验证记录（2026-11-07）

> 本记录是 MAYNE-20 修订候选 `fa88332`（tree `6e1b908`）被 Codex 复审出具 BLOCK/needs_revision 后的**第四轮修订侧证据**，结论只到“可再送独立评审”。实现者不给自己签 pass；独立复审由未参与者执行，工作流收口由 Codex 负责。历史记录见 [backend-foundation-20261106.md](backend-foundation-20261106.md)、[backend-foundation-20261107.md](backend-foundation-20261107.md)、[backend-foundation-20261107-r2.md](backend-foundation-20261107-r2.md) 与 [backend-foundation-20261107-r3.md](backend-foundation-20261107-r3.md)。

## 1. 版本可复核性

- 被复审候选：`fa883325a3b4ec3a492b1ec3a60b02408ea6e635`，tree `6e1b90835960f9e762056a2ae2c28f8adab19c13`，代码 `f54ab36735cec1c6f34f6ecf2a275e2504064c35`（分支 `agent/claude/mayne-20`）。
- 第四轮修订交付：commit `9efa9082645bac09ed711ca698f3f62a171ff1ca`，tree `8057bb266c69697b9842bd1d3f7f6989c953694b`（分支 `agent/claude/mayne-20`，基线 `85feb8a` 仍为祖先）。
- 复核方式：`git diff fa88332 9efa908`（改动清单）；下表 sha256 可对 commit `9efa908` 的树逐文件核对。

| 文件 | sha256 |
|---|---|
| `tests/probes/backend-foundation/run-probes.mjs` | `13e536042f9301d3b9eab5c8dbd34b7ceda7814ff561d01d36c02e659632ce7c` |
| `tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs` | `8c7de1941f8d2ad1df0aa4e947753130d1404f4584aec739f097498dd6659d41`（未变） |
| `tests/probes/backend-foundation/storage-adapter-probe/src/main.rs` | `76c3ced08cddd9e6fbe005b99e6a3be16d4a445e5e2e017e3c24c4960428f2d9` |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | `4b14a4e1dbd95a80a859bdb9b6d52c2b7c763a002c46c45c8b067d01e004bf3e`（未变） |
| `tests/probes/backend-foundation/storage-adapter-probe/Cargo.lock` | `3d23851408674436d286b342fff330e12945b36a4a18f7746c96f0e509088cf8`（未变） |
| `docs/engineering/backend-foundation-probes.md` | `ea0446982e2f1fc24c42b51c38ce9e037eb4cff24a610ca802eed63511a8bd58` |

写入范围不变：`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本任务 `docs/reviews/backend-foundation-*.md`；未改 `src-tauri/`、生产 Cargo manifests/锁文件、`package.json`、`docs/product/05`、根 README、`docs/reviews/README.md`。Cargo.toml/Cargo.lock 哈希未变（未新增依赖）。

## 2. 逐项关闭情况

### P1 复查失败仍当作无变化放行 —— 已关闭

- 改动（`storage-adapter-probe/src/main.rs`）：`recheck_worker_record` 不再用 `.ok()?` 把 metadata 失败折叠为 `None`。现在显式区分：“确认未变化”（成功复查且身份/版本/类型均未变）才返回 `None`；记录被删除（`NotFound`）返回“记录在准入前被删除”暂停原因；其它 IO 错误返回“记录在准入前无法复查”暂停原因；类型不符（非普通文件/符号链接）返回暂停原因。调用方据此把状态置为 `WORKER_UNVERIFIED` 并 REJECT，不再沿用过期的 `Exited`。
- 新证据（D6 新增 2 例，均断言 `rootLockAvailableDuringProbe=false`）：探测期间删除 `worker.json` → REJECT `WORKER_UNVERIFIED`；探测期间把 `runs/` 权限降为 0644 使记录不可复查（`symlink_metadata` 得 EACCES）→ REJECT `WORKER_UNVERIFIED`。记录不变的正对照仍 ACCEPT。

### P2 失去普通文件类型校验，FIFO 阻塞并占锁 —— 已关闭

- 改动（`main.rs`）：`read_worker_record` 恢复普通文件类型校验——lstat 后要求 `metadata.is_file()` 且非符号链接才继续；打开时使用 `O_NONBLOCK`（本地常量，macOS `0x0004` / Linux `0o4000`，不新增依赖），避免特殊文件在 lstat 与 open 之间被换入时阻塞读取；打开后再校验句柄为普通文件且非符号链接，并核对身份。
- 新证据（D7）：0600 FIFO `worker.json` 下，`try-schedule` 在 5s 内返回 REJECT `WORKER_UNVERIFIED`（`signal=null`、`error=null`，未被阻塞），随后 `open-check` exit 0 证明根锁已回收；运行器连续两次运行均正常清理合成根。

## 3. 实际命令与退出码（2026-11-07，macOS 合成根）

```text
node tests/probes/backend-foundation/run-probes.mjs
→ exit 0；68/68 场景通过（255 项检查、场景内记录 harness 调用 78 次；seed 播种由运行器辅助函数执行，不计入场景记录）
node tests/probes/backend-foundation/run-probes.mjs（第二次，验证清理）
→ exit 0；68/68 场景通过（chmod-runs 用例后 runs/ 权限被恢复，roots/ 可正常清理）
cargo test --offline --manifest-path …/storage-adapter-probe/Cargo.toml   # exit 0（2/2 通过）
cargo fmt --manifest-path …/storage-adapter-probe/Cargo.toml -- --check # exit 0
cargo clippy --offline --manifest-path …/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings  # exit 0
node --check tests/probes/backend-foundation/run-probes.mjs               # exit 0
npm run check:docs                                                       # exit 0（18 文件、300 本地链接；检查器排除 docs/reviews/**）
git diff --check                                                         # exit 0
```

harness 子命令实际结果（节选，完整 stdout/stderr JSON 见 `build/backend-foundation/results.json`、`run.log`）：

```text
try-schedule --root …/d-race-unchanged      # exit 0（ACCEPT；available=false）
try-schedule --root …/d-race-delete         # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
try-schedule --root …/d-race-chmod-runs     # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
try-schedule --root …/d-worker-fifo         # exit 0（REJECT/WORKER_UNVERIFIED，5s 内返回）
open-check --root …/d-worker-fifo           # exit 0（锁已回收）
try-schedule --root …/d-race-replace        # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
try-schedule --root …/d-race-chmod          # exit 0（REJECT/WORKER_UNVERIFIED；available=false）
```

## 4. 计数

- 场景 68/68 通过；单项检查 255/255 通过；场景内记录 harness 调用 78 次；cargo 离线构建 exit 0；`cargo test` 2/2 通过；`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings` exit 0；`node --check` exit 0；`npm run check:docs` exit 0；`git diff --check` exit 0。
- 本轮新增覆盖：D6 删除记录与受控复查错误（`runs/` 权限降级）2 例，D7 特殊文件（0600 FIFO）有界拒绝与锁回收 1 例。

## 5. 未验证项（保持开放）

1. **Linux 全部未实测**：本机无 Linux 机器；`docs/engineering/backend-foundation-probes.md` §6 只给静态依据与准入清单，不伪称跨平台通过。运行器已按平台分支断言，Linux 上可重跑。`O_NONBLOCK` 常量按 macOS/Linux 分别给出。
2. 正式适配未实现、未生产化：本 harness 是参考实现；schema/迁移/依赖授权未申请。
3. 进程内 Node→Rust 绑定（N-API 类）与随包分发适配二进制：需要新构建链/依赖授权，本轮未做。
4. 生产 Keychain 后端现状为关闭（`production_credentials()` 固定 `enabled: false`）；macOS 无桌面会话不可用、Linux env 引用与缺失引用失败均未实测。
5. 并发 3/持久队列/取消/恢复/幂等等队列语义属 W1–W2，本探针只验证存储边界前提。
6. 真实模型/凭据/工作根、代理部署、浏览器 G1–G3 业务均不在本范围。
7. 未运行 `npm run check`：按父任务约定，重门禁由门禁/集成负责人串行执行；本轮只跑本探针命令与上述单项检查，不用聚焦通过代签全量。
8. `docs/reviews/README.md` 索引登记待集成负责人补（共享写入范围）。

## 6. 结论

作者侧结论：**第四轮修订交付，待独立复审**（pass/needs_revision/reject 由未参与实现的评审者出具）。交付物：`tests/probes/backend-foundation/`（harness + 运行器）、`docs/engineering/backend-foundation-probes.md`、本记录；代码版本 `9efa908`（tree `8057bb2`）。原始证据在 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），未入库。复现：`node tests/probes/backend-foundation/run-probes.mjs` 与 `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml`（需本机 cargo 缓存中的锁定依赖）。
