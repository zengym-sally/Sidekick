# MAYNE-20 后端基础探针：实现与作者侧验证记录（2026-11-06）

> 本记录是 MAYNE-20 候选交付的作者侧证据，结论只到“可送独立评审”。实现者不给自己签 pass；独立评审由未参与者 ZCode 执行，工作流收口由 Codex 负责。

## 1. 范围与风险级

- 任务：W0 验证独立存储与主机运行边界，形成原生适配准入证据（父任务 MAYNE-17，stage 1）。
- 写入范围（严格遵守）：`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本记录。未改 `src-tauri/` 业务实现/Cargo manifests/锁文件、`package.json`、`docs/product/05`、根 README、`docs/reviews/README.md`（共享索引登记留给集成负责人）。
- 风险级：R3（触及凭据能力边界与存储文件安全），但全部为隔离合成环境；未安装生产依赖、未改 schema/迁移、未动真实凭据/工作根、未 commit/push。
- 边界：harness 的 Rust crate 是按目标契约写的**参考实现**，仅用于验证边界假设，不并入生产；探针证据只证明探针覆盖的那一段。

## 2. 基点与环境

- 工作树：`/Users/zengym/…/mayne-17-3b4e99be33eb/worktree`，分支 `agent/kimi/mayne-17`，HEAD `fdc37e8cd01a8a58db340fafb191b748f15041ba`；`git merge-base --is-ancestor 85feb8aaa431a2a1c9f92b238e26a7a2400baa9e HEAD` 通过（基线为该 HEAD 祖先）。未切换到共享 main 或 `build/team-w0-*` 预备树。
- 主机：macOS 27.0.1（26A434）arm64；Apple clang 21.0.0；cargo/rustc 1.89.0；Node v24.20.0；harness 内 SQLite 3.51.3（rusqlite 0.39.0 bundled）。
- 依赖：harness Cargo.toml 锁定 rusqlite `=0.39.0`（bundled）、serde_json `=1.0.154`、keyring-core `=1.0.1`、apple-native-keyring-store `=1.0.2`，与 `src-tauri/Cargo.lock` 一致；构建使用本机 cargo 缓存。

## 3. 实际命令与退出码

```text
# 构建与全量探针（运行器内部先 cargo build --release --offline，失败才回退联网）
node tests/probes/backend-foundation/run-probes.mjs
→ exit 0；24/24 场景通过（80 项检查、33 次 harness 调用）
```

实际执行记录（节选自 `build/backend-foundation/run.log`，原始证据含每次调用的完整 stdout/stderr JSON）：

```text
cargo build --release --manifest-path …/storage-adapter-probe/Cargo.toml --offline   # exit 0（CARGO_TARGET_DIR=build/backend-foundation/target）
sidekick-storage-adapter-probe seed --root …/a-valid                                 # exit 0
sidekick-storage-adapter-probe open-check --root …/a-valid                           # exit 0
sidekick-storage-adapter-probe open-reject --root …/a-missing-db --expect MISSING_DATABASE   # exit 0（code=MISSING_DATABASE）
sidekick-storage-adapter-probe control-default-open --path …/created-by-default.sqlite       # exit 0（created=true）
sidekick-storage-adapter-probe open-reject --root …/b-db-symlink --expect PATH_CHANGED       # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-db-hardlink --expect PATH_CHANGED      # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-db-mode --expect PATH_CHANGED          # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-wal-symlink --expect PATH_CHANGED      # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-wal-hardlink --expect PATH_CHANGED     # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-marker-symlink --expect INVALID_ROOT   # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-marker-hardlink --expect INVALID_ROOT  # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-marker-mode --expect INVALID_ROOT      # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-root-mode --expect PATH_CHANGED        # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-corrupt --expect CORRUPT_DATABASE      # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-app-id --expect UNKNOWN_DATABASE       # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-future --expect SCHEMA_TOO_NEW         # exit 0
sidekick-storage-adapter-probe open-reject --root …/b-unknown-root --expect UNKNOWN_ROOT     # exit 0
sidekick-storage-adapter-probe open-check --root …/b-swap-db --fault swap-db                # exit 1（PATH_CHANGED，原库保留）
sidekick-storage-adapter-probe open-check --root …/b-replace-marker --fault replace-marker  # exit 0（faultFirstUse=PATH_CHANGED，faultSecondUseStopped=true）
sidekick-storage-adapter-probe wal-check --root …/c-wal                                  # exit 0
sidekick-storage-adapter-probe hold --root …/d-worker-alive --worker-file …/runs/worker.json   # 由运行器拉起后 SIGKILL
sidekick-storage-adapter-probe try-schedule --root …/d-worker-alive                       # exit 0（存活期 REJECT/ROOT_IN_USE；崩溃后 ACCEPT）
sidekick-storage-adapter-probe try-schedule --root …/d-lock-not-proof                     # exit 0（REJECT/WORKER_ALIVE → ACCEPT）
sidekick-storage-adapter-probe rows --root …/d-crash-during-write                        # exit 0（ids=[seed-a,seed-b,worker-committed]）
sidekick-storage-adapter-probe host-facts / keychain-facts                               # exit 0（合成钥匙串往返通过）
```

验证期间发现并修复了两处作者侧缺陷（均已复测通过）：harness `hold` 子命令曾把适配创建在闭包内导致根锁提前释放（崩溃/调度场景的核心 bug）；运行器曾把 `repoRoot` 少解析一级导致证据写错目录（已清理误建目录）。

## 4. 计数

- 场景 24/24 通过；单项检查 80/80 通过；harness 调用 33 次；cargo 离线构建 exit 0。
- 负例（拒绝类）覆盖：缺库不新建、符号链接、硬链、权限位、身份替换、损坏库、错误 application_id、未来 schema、未知根、worker 存活占锁、锁空闲但 worker 记录存活、写事务中崩溃。

## 5. 未验证项（保持开放）

1. **Linux 全部未实测**：本机无 Linux 机器；`docs/engineering/backend-foundation-probes.md` §6 只给静态依据与准入清单，不伪称跨平台通过。
2. 正式适配未实现、未生产化：本 harness 是参考实现；schema/迁移/依赖授权未申请。
3. 进程内 Node→Rust 绑定（N-API 类）与随包分发适配二进制：需要新构建链/依赖授权，本轮未做。
4. 生产 Keychain 后端现状为关闭（`production_credentials()` 固定 `enabled: false`）；macOS 无桌面会话不可用、Linux env 引用与缺失引用失败均未实测。
5. 并发 3/持久队列/取消/恢复/幂等等队列语义属 W1–W2，本探针只验证存储边界前提。
6. 真实模型/凭据/工作根、代理部署、浏览器 G1–G3 业务均不在本范围。
7. 未运行 `npm run check`：按父任务约定，重门禁由门禁/集成负责人串行执行；本轮只跑本探针命令，不用聚焦通过代签全量。
8. `docs/reviews/README.md` 索引登记待集成负责人补（共享写入范围）。

## 6. 结论

作者侧结论：**候选交付，待独立评审**（pass/needs_revision/reject 由 ZCode 按评审判据出具）。交付物：`tests/probes/backend-foundation/`（harness + 运行器 + README）、`docs/engineering/backend-foundation-probes.md`、本记录。原始证据在 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），未入库。复现：`node tests/probes/backend-foundation/run-probes.mjs`（需本机 cargo 缓存中的锁定依赖）。
