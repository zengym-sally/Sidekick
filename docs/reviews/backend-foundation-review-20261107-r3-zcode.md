# 后端基础探针候选第三轮独立复核（ZCode，2026-11-07）

> 结论：**BLOCK / needs_revision**。本轮两个反例（P1 worker 记录过期放行、P2 标记权限降级继续读取）经本机独立复现全部成立；上轮三项 P1 的关闭与 61 项既有场景复核属实。候选不得作为调度边界的准入证据合入。本记录不修改候选实现与任务状态；范围与证据约定见[验证约定](../engineering/verification.md)，上一轮记录见[第一轮复核](backend-foundation-review-20261107-zcode.md)。

## 1. 对象与边界

- 基线 `85feb8a`；冻结候选 `a17a6b4`（tree `f3c455f`），代码 `d74a3b4`（tree `dfae697`），分支 `agent/claude/mayne-20`。`git rev-parse a17a6b4^{tree}` 与 `git merge-base --is-ancestor 85feb8a a17a6b4` 均核实；候选工作树 HEAD 即 `a17a6b4`。
- 审核者 ZCode 未参与本项实现；风险级 R3（根/数据库安全、调度并发边界、验证充分性、写入范围）。
- 方法：`git archive a17a6b4` 导出到本工作树 `build/r3/candidate/` 隔离副本，全部命令针对该副本；Cargo target、TMPDIR 与合成根只落在 `build/r3/` 下。未把候选代码接入任何分支，未切共享分支，未触真实工作根/凭据/生产 schema，未修改代码与 issue 状态。
- 写入范围核对：相对基线新增 10 个文件，全部位于允许范围（`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、`docs/reviews/backend-foundation-*.md`）；`git diff --check 85feb8a a17a6b4` exit 0；`src-tauri/`、生产 manifests/锁文件、`package.json`、`docs/product/05` 零改动。
- 六项源码 sha256 与作者交付表（`backend-foundation-20261107-r2.md`）逐项一致，本轮重算：runner `19b8a5dc…8787`、adapter `c46d3436…fd38`、main `1c0308c0…8b71`、Cargo.toml `4b14a4e1…bf3e`、Cargo.lock `3d238514…8cf8`、probes 文档 `82858727…ff39`。

## 2. 新鲜验证（全部为本轮实跑）

| 检查 | 命令（要点） | exit | 结果 |
|---|---|---:|---|
| 探针全套 | `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建；**61/61 场景、228 项检查、70 次记录调用** |
| 关闭期回归 | `cargo test --offline --manifest-path …/storage-adapter-probe/Cargo.toml` | 0 | `root_lock_must_survive_until_sqlite_close` 1/1 通过 |
| 格式 | `cargo fmt --manifest-path … -- --check` | 0 | 通过 |
| Lint | `cargo clippy --offline --all-targets -- -D warnings` | 0 | 通过（target 在隔离副本 build 下） |
| 语法 | `node --check run-probes.mjs` | 0 | 通过 |
| 文档链接 | `node scripts/checks/check-docs.mjs` | 0 | 18 文件、300 本地链接 |
| P1 竞争反例 | `python3 -I build/r3/repro/zcode-p1-race-repro.py`（自建，§3） | 0 | 三组对照全部复现（采集完成 exit 0，不代表候选通过） |
| P2 追加测试 | 派生副本 `cargo test … zcode_review_marker_mode`（§4） | **101** | 标记 0644 后 `count()` 仍 `Ok(0)`，期望 `PATH_CHANGED` 的测试失败 |
| P2 对照 | 同副本无 chmod 对照测试 + 候选自身关闭期测试 | 0 | 2/2 通过，证明失败仅由权限变化引起 |

原始日志、合成根与复现脚本均在 `build/r3/`（不入库）；本记录保留命令、退出码与最小结果。

## 3. P1：worker 核查早于根锁，过期记录被放行（独立确认）

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:513`（`classify_worker` 读取并探测记录）先于 `:526`（`StorageAdapter::open` 取得完整适配与根锁），`:542`–`:570` 直接使用先前分类，无任何重新读取或身份核对。`read_worker_record`（`main.rs:378`–`:420`）还是两步路径读取：`:379` `symlink_metadata` 与 `:398` `read_to_string` 之间未持同一句柄核对身份。违反候选自身注释契约（`main.rs:506`–`:510`：准入期间持锁核查，仅确认退出的 worker 可调度）与设计不变量“无法核实即暂停”。

本轮针对未修改候选二进制、用候选自带 `SIDEKICK_PROBE_KILL` 钩子自建复现（合成进程，无提权、不触真实进程）：

| 钩子行为 | 记录身份 | 第一次准入 | 同一根不再变动后的第二次准入 |
|---|---|---|---|
| 不改记录（正对照） | 原 inode、0600 | ACCEPT（worker alive=false） | ACCEPT |
| 探测窗口内持根锁原子替换为存活 PID | 新 inode、0600 | **ACCEPT，仍报告旧 PID 已退出** | REJECT / `WORKER_ALIVE` |
| 探测窗口内持根锁改记录为 0644 | 原 inode、0644 | **ACCEPT** | REJECT / `WORKER_UNVERIFIED` |

三组钩子均观测到 `rootLockFreeDuringProbe=true`：探测期间根锁可被另一合成进程取得，证明核查不在锁保护窗口内；两次准入之间的反差证明第一次决策使用的是已过期记录。这是确定性复现，不依赖概率竞争。存活 PID 属本次复现驱动进程，退出 PID 属本次创建并 wait 的子进程。

影响：即使根与文件在最终打开时全部满足安全校验，调度结论仍对应已过期的记录版本，无法证明当前记录中的 worker 已退出；探测不能作为该启动边界的准入证据。必需修订：先取得并持有完整适配/根锁，再经受控打开（O_NOFOLLOW、同一句柄 fstat 前后核对）读取当前记录并探测，核对读取与发布准入之间的身份/私有性/版本，变化即暂停或在同一保护窗口重新核实；把原子替换与权限竞争反例连同正对照持久化进运行器矩阵。

## 4. P2：归属标记权限降级未停止读取（独立确认）

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs:526`–`:536` 的 `verify()` 对标记只检查类型、符号链接、硬链数与 dev/ino，漏掉 mode；对比 `same_private_file`（`:162`–`:175`）与取锁时检查（`:237`）均含 0600。适配生命周期内的标记权限复核缺失。

本轮在 `build/r3/repro/adapter-harness/`（候选 crate 副本）仅追加两个测试，不改候选方法：显式 init 后读 `probe_items` 为 0，把标记 chmod 0644 再读——期望 `PATH_CHANGED` 的断言失败，实测返回 **`Ok(0)`**，cargo **exit 101**；随后也无 `STORAGE_STOPPED`。同副本无 chmod 对照测试与候选自身关闭期测试 2/2 通过，证明失败仅由权限降级引起。追加测试源码随任务评论提供。

影响：活跃适配继续消费一个按自身打开规则已不合法的根，私有性证据不完整；数据库与目录的中途权限变化有持久覆盖（B 组 fault），标记没有。必需修订：`verify()` 标记检查补 mode（或复用 `same_private_file` 等价校验），并持久覆盖首次失败与随后 `STORAGE_STOPPED` 断言。本项为此前未覆盖的同类边界，不归因 `d74a3b4` 新引入。

## 5. 其余边界复核（本轮全部实跑通过）

- **连接/根锁同生命周期**：A1 通过；存活期二次打开 `ROOT_IN_USE`，drop 后可重开；关闭期回归测试证明 SQLite CLOSE 回调内锁仍被持有。
- **已有根零创建**：A2/A5/A5b 与 D5 空目录反例通过，拒绝后文件树不变；`init` 仍是唯一创建流（A4/A4b）。
- **NOFOLLOW/身份/权限/硬链**：B 组 18 例静态反例 + swap-db/replace-marker/replace-wal/replace-shm/degrade-runs 五项中途故障全部 `PATH_CHANGED`/`INVALID_ROOT` 且首用停止、次用保持停止。
- **WAL/短事务**：C 组通过（提交可见、未提交对第二只读连接不可见、失败回滚、关库检查点清除 WAL）。
- **崩溃与旧 worker 调度（静态部分）**：D1/D3 SIGKILL 后锁释放、WAL 丢弃未提交行；D2 的 11 例（损坏/缺 pid/符号链接/硬链/0644/pid 越界/探测启动失败/EPERM 按存活/ESRCH 放行/存活拒绝/无记录放行）与 D5 的 10 例调度入口根安全反例全部通过；D4 正常退出实际执行适配析构。
- 上轮三项 P1 的修订内容（调度复用完整入口、三态探测与 pid 范围、先关库再放锁及 D4 析构）复核属实，不继续挂为未关闭；本轮 P1 是调度准入中记录版本/持锁顺序的剩余缺口。

## 6. 分级结论与准出

- **P0：无。P1：一项**（§3 记录核查早于根锁、过期放行）。**P2：一项**（§4 标记中途权限降级未停止读取）。无新增独立 P3。
- 结论：**BLOCK / needs_revision**，本轮候选不得合入；与指定评审者本轮结论一致但证据独立。修订请从 `a17a6b4` 接续，新版须给出新的精确版本/哈希、实际命令与退出码，并把 §3/§4 反例持久化进候选自身矩阵后交独立复审。
- 仍未验证、不得据此晋级：Linux 实测（候选文档 §6 仅静态依据）、正式适配实现、Node 进程内绑定/随包分发、生产凭据 Provider、真实模型/真实工作根、完整集成 `npm run check`。
- 本记录登记 `docs/reviews/README.md` 由集成负责人统一处理（共享写入范围）；本审核不代改。
