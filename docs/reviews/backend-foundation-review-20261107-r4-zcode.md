# 后端基础探针候选第四轮独立复核（ZCode，2026-11-07）

> 结论：**BLOCK / needs_revision**。冻结候选 `fa88332` 上，指定评审者本轮两项失败路径反例（P1 复查失败放行、P2 FIFO 阻塞占锁）经本机独立实跑全部成立；既有边界矩阵与质量门禁复核属实（65/65 场景、242 项检查、fmt/Clippy/回归/文档链接均 exit 0）。候选仍不能作为旧 worker 调度边界的准入证据合入。本记录只交评审，不改候选实现与任务状态；上一轮记录见[第三轮复核](backend-foundation-review-20261107-r3-zcode.md)，范围与证据约定见[验证约定](../engineering/verification.md)。

## 1. 对象与边界

- 基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`；冻结候选 `fa883325a3b4ec3a492b1ec3a60b02408ea6e635`（tree `6e1b90835960f9e762056a2ae2c28f8adab19c13`），代码 `f54ab36735cec1c6f34f6ecf2a275e2504064c35`（tree `04edc06b7fccc0a80140354fd9e39a2844f37db4`），分支 `agent/claude/mayne-20`。均以 `git cat-file` 核实。
- 复核者 ZCode 未参与实现；旧 `a17a6b4` 结论不沿用，本轮针对 `fa88332` 全量重做。
- 方法：`git archive fa88332` 导出到本工作树 `build/r3-review/candidate/` 隔离副本，全部命令针对该副本与其中离线构建的二进制；Cargo target、合成根、复现脚本只落在 `build/r3-review/`。未切任何分支，未把候选接入任何交付分支，未触真实工作根/凭据/生产 schema/依赖。
- 写入范围核对：相对基线新增 11 个文件，全部位于允许范围（探针、工程说明、本任务评审记录）；`git diff --check a17a6b4..fa88332` exit 0；`src-tauri/`、生产 manifests/锁文件、`package.json`、`docs/product/05` 零改动。
- 六项源码 sha256 与作者 `backend-foundation-20261107-r3.md` 交付表逐项一致（本轮重算）：runner `eab74f1c…00bd`、adapter `8c7de194…9d41`、main `7efe1610…d851`、Cargo.toml `4b14a4e1…bf3e`、Cargo.lock `3d238514…8cf8`、probes 文档 `7188b56c…d93d6`。

## 2. 新鲜验证（全部为本轮实跑）

| 检查 | 命令（要点） | exit | 结果 |
|---|---|---:|---|
| 探针全套 | `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建；**65/65 场景、242 项检查** |
| 格式 | `cargo fmt --manifest-path … -- --check` | 0 | 通过 |
| Lint | `cargo clippy --offline --all-targets -- -D warnings` | 0 | 通过 |
| 回归 | `cargo test --offline --manifest-path …` | 0 | 关闭期 + 标记私有性 2/2 通过 |
| 语法 | `node --check run-probes.mjs` | 0 | 通过 |
| 文档链接 | `node scripts/checks/check-docs.mjs`（候选副本内） | 0 | 18 文件、300 本地链接 |
| P1 反例 | `python3 build/r3-review/my-repros/zcode-p1-recheck-gap.py <候选二进制>`（自建，§3） | 0 | 三组对照复现（采集完成 exit 0，不代表候选通过） |
| P2 反例 | `python3 build/r3-review/my-repros/zcode-p2-fifo-block.py <候选二进制>`（自建，§4） | 0 | 阻塞与占锁复现，收尾后无遗留进程/FIFO |

原始日志、合成根与复现脚本在 `build/r3-review/`（不入库）。完整 `npm run check` 未运行：按父任务分工由集成负责人在实际集成版本串行执行；本轮为拒绝结论，不以聚焦结果签全量通过。

## 3. P1：记录复查失败被解释为“无变化”，删除后仍 ACCEPT（独立确认）

- 位置：`storage-adapter-probe/src/main.rs:499`–`:524`，尤其 `:508` `fs::symlink_metadata(&snapshot.path).ok()?`；调用方 `:652`–`:657`。
- 机制：`recheck_worker_record` 返回 `Option<String>`，`None` 同时表达“确认未变化”和“无法复查”。`:508` 把 NotFound、权限、EIO 等 metadata 失败统一折叠成 `None`，调用方 `if let Some` 不触发，保留读取时的旧分类（`Exited`），走 ACCEPT 分支。`:509` 的 `RecordIdentity::from_metadata(&metadata)?` 目前恒返回 `Some`，是该分支的死代码；若修复时让它对非普通文件返回 `None`，这里会形成新的同型折叠点，修复必须改用显式结果而非 `Option`。
- 独立复现（自建脚本，未修改候选二进制，使用其既有 `SIDEKICK_PROBE_KILL` 钩子）：
  1. 正对照（记录不变）：ACCEPT，`alive=false` —— 行为正确。
  2. **探测期间删除 `runs/worker.json`**：探测后记录已不存在（`recordPresentAfter=false`），决策仍 **ACCEPT**、`alive=false`；应为 REJECT/`WORKER_UNVERIFIED`。成立。
  3. 锐化对照（探测期间原子替换为 0600 FIFO）：REJECT/`WORKER_UNVERIFIED` —— 说明身份比对分支本身有效，缺口精确在 metadata 失败路径，而非整个复查。
- 影响：候选不能证明“核查之后发生变化/消失即暂停”的契约；准入可基于一条已无法核实的过期观察签发。必需修订：复查用显式三态（确认未变化／已变化／无法复查），已存在快照的消失、读失败、类型不符一律 `WORKER_UNVERIFIED`；保留真 Absent（从未有记录）语义；把删除、受控复查错误与不变正对照持久化进运行器矩阵。

## 4. P2：普通文件类型校验缺失，0600 FIFO 阻塞调度并持有根锁（独立确认）

- 位置：`storage-adapter-probe/src/main.rs:385`–`:395`（`from_metadata` 对所有类型返回 `Some`）、`:431`–`:440`（身份门只查 `nlink == 1 && mode == 0600`）、`:443`（无 `O_NONBLOCK` 的阻塞 `open`）。
- 机制：本轮以 `RecordIdentity` 替换旧读取实现时丢掉了普通文件判据；`:435` 的拒绝消息与 `:344` 注释都声称“普通文件”，代码却未检查。0600、nlink=1 的 FIFO 通过身份门，进入阻塞式 `OpenOptions…open()`，未读 JSON 先挂起，且此时已持有根锁。
- 独立复现（自建脚本）：合成 0600 FIFO `runs/worker.json`（lstat 证实 FIFO/0600/nlink=1），`try-schedule` 4 秒观察截止未返回；期间另一调用 `open-reject --expect ROOT_IN_USE` 返回 `ROOT_IN_USE`，证实调度子进程持续持有根锁。终止本次自建子进程（wait，退出 -9）、删除自建 FIFO 后，同根 `try-schedule` 恢复 ACCEPT（`worker:null`）。无遗留进程或命名管道。
- 影响：不合法记录可使调度既无暂停原因又长期占锁，其它入口持续 `ROOT_IN_USE`。必需修订：lstat 与打开句柄两处都恢复普通文件校验；打开需避免特殊文件阻塞（如 `O_NONBLOCK` 打开后按句柄 fstat 判型再读），关闭 lstat→open 窗口的 TOCTOU；补 FIFO/其它可合成特殊文件的有界拒绝与锁可回收反例进矩阵。

## 5. 既有边界矩阵复核（本轮全部通过）

根锁与连接同生命周期（含 SQLite CLOSE 回归）、零创建（普通 open 不建标记/目录/库）、NOFOLLOW／身份／权限／硬链拒绝（标记、目录、库、WAL/SHM）、标记权限降级停止读取（`same_private_file` 补 0600）、D6 锁保护下探测竞争三态、WAL/短事务/只读并发、SIGKILL 崩溃恢复与正常退出释放锁、合成 Keychain 往返——上述在 65/65 场景与本轮 2/2 回归中全部成立。两项缺陷均限于 `main.rs` 的 worker 记录路径；`adapter.rs` 未发现同类问题。

## 6. 分级结论与准出

- **P0：无。P1：1 项（§3）。P2：1 项（§4）。无新增独立 P3。**
- 结论：**BLOCK / needs_revision**，与指定评审者本轮结论方向一致但证据独立（自建脚本、独立构建、独立对照）。修订从冻结候选 `fa88332` 接续；新版须给出新的精确版本/补丁哈希、实际命令与退出码，并把 §3/§4 反例持久化进候选自身矩阵后交独立复审。
- 仍未验证，不得写成已验证：Linux 行为、正式生产适配、Node 绑定/分发、真实模型/工作根、完整集成门禁。本记录不签 done，不触发状态变更；workflow 收口归指定评审者与队长。
