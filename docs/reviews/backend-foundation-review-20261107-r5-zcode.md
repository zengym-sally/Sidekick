# 后端基础探针候选第五轮独立复审（ZCode，2026-11-07）

> 结论：**APPROVE**。冻结候选 `5cd3538` 上，上轮两项失败路径反例（P1 复查失败放行、P2 FIFO 阻塞占锁）经本机独立实跑确认已关闭：代码审查通过 + 自建反例复现消失 + 反例已持久化进候选自身矩阵。全套既有边界矩阵在本轮重新实跑通过（**68/68 场景、255/255 项检查、78 次 harness 调用**，连跑两次），增量审查未发现新的 P0–P2，仅 1 项非阻断 P3（草稿区 FIFO 残留卫生）。本记录只交评审，不改候选实现与任务状态；上一轮记录见[第四轮复核](backend-foundation-review-20261107-r4-zcode.md)，范围与证据约定见[验证约定](../engineering/verification.md)。

## 1. 对象与边界

- 基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（已核实为本候选祖先）；冻结候选 **`5cd3538809dc1694954c66f24155d6005d299898`**（tree `7bf8d40b5b4866709df4356dd883857b3298522b`），代码 `9efa9082645bac09ed711ca698f3f62a171ff1ca`（tree `8057bb266c69697b9842bd1d3f7f6989c953694b`），分支 `agent/claude/mayne-20`（本地 ref 指向 `5cd3538`，`git cat-file` 逐项核实）。`5cd3538` 相对代码提交仅改两份评审记录：新增 `backend-foundation-20261107-r4.md`（79 行作者侧关闭证据）并给 `r3.md` 加 2 行"已被第四轮取代"横幅（防止旧结论被沿用，正确做法）。
- 复核者 ZCode 未参与实现；旧 `fa88332` 的 BLOCK 结论不沿用，本轮针对 `5cd3538` 全量重做。
- 方法：`git archive 5cd3538` 导出到本工作树 `build/r5-review/candidate/` 隔离副本；全部命令针对该副本与其中离线构建的二进制；Cargo target、合成根、复现脚本只落在 `build/r5-review/`。未切任何分支，未触真实工作根/凭据/生产 schema/依赖；自建进程与合成 FIFO 已收尾（`leftover-fifo-audit=0`、无残留 probe 进程）。
- 写入范围核对：相对基线新增 12 个文件，全部位于允许范围（`tests/probes/backend-foundation/`、`docs/engineering/backend-foundation-probes.md`、本任务 `docs/reviews/backend-foundation-*.md`）；`git diff --check` exit 0；`src-tauri/`、生产 manifests/锁文件、`package.json`、`docs/product/05` 零改动。
- 六项源码 sha256 与作者 `backend-foundation-20261107-r4.md` 交付表逐项一致（本轮重算）：runner `13e53604…ce7c`、adapter `8c7de194…9d41`（未变）、main `76c3ced0…8f2d9`、Cargo.toml `4b14a4e1…bf3e`（未变）、Cargo.lock `3d238514…8cf8`（未变）、probes 文档 `ea044698…bd58`。

## 2. 新鲜验证（全部为本轮实跑，2026-11-07，macOS 27.0.1 arm64）

| 检查 | 命令（要点） | exit | 结果 |
|---|---|---:|---|
| 探针全套（第 1 次） | `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建；**68/68 场景、255/255 项检查、78 次调用**（results.json 汇总核对） |
| 探针全套（第 2 次，清理验证） | 同上 | 0 | 68/68 再次通过；`d-race-chmod-runs` 后 `runs/` 权限恢复有效 |
| 格式 | `cargo fmt --check` | 0 | 通过 |
| Lint | `cargo clippy --offline --all-targets -- -D warnings` | 0 | 通过 |
| 回归 | `cargo test --offline` | 0 | CLOSE 持锁 + 标记私有性 2/2 通过 |
| 语法 | `node --check run-probes.mjs` | 0 | 通过 |
| 文档链接 | `node scripts/checks/check-docs.mjs`（候选副本内） | 0 | 18 文件、300 本地链接 |
| P1 反例 | `python3 build/r5-review/my-repros/p1.py <候选二进制>`（自建，§3） | 0 | 三组对照复现（采集完成 exit 0，不代表候选通过） |
| P2 反例 | `python3 build/r5-review/my-repros/p2.py <候选二进制>`（自建，§4） | 0 | 有界拒绝 + 锁回收复现，无遗留进程/FIFO |
| 增量三角度 | `python3 build/r5-review/my-repros/p3-extra.py <候选二进制>`（自建，§5） | 0 | 原位改写/换符号链接/降权 0000 均 REJECT |

原始日志、合成根与复现脚本在 `build/r5-review/`（不入库）。完整 `npm run check` 未运行：按父任务分工由集成负责人在实际集成版本串行执行。

## 3. P1 复查失败被当作"无变化"放行 —— 确认关闭

- 代码（`storage-adapter-probe/src/main.rs:524`–`:563`）：`recheck_worker_record` 改为显式三态——只有成功复查且 `is_file`/非符号链接/身份七元组均未变才返回 `None`（确认未变化）；`NotFound` 返回"记录在准入前被删除"、其它 IO 错误返回"记录在准入前无法复查"、类型不符返回"被替换为特殊文件或符号链接"，全部走暂停路径。调用方 `:694`–`:696` 将任何暂停原因置为 `WORKER_UNVERIFIED` 并 REJECT，不再沿用读取时的旧分类。r4 指出的 `:548` `from_metadata(&metadata)?` 现为不可达死分支（该函数对任何 metadata 恒返回 `Some`，且前面已过普通文件门），不构成新折叠点。
- 独立复现（自建脚本，未修改候选二进制）：①正对照（记录不变）ACCEPT、`alive=false` —— 正确行为保留；②**探测期间删除 `runs/worker.json`** → **REJECT/`WORKER_UNVERIFIED`**，原因"记录在准入前被删除"（上轮此项为 ACCEPT，缺口确已关闭）；③探测期间换成 0600 FIFO → REJECT。候选矩阵新增 `d-race-delete`、`d-race-chmod-runs`（`runs/` 降权 0644 致复查 EACCES）两例持久化，均断言探测期间锁未释放（`rootLockAvailableDuringProbe=false`）。

## 4. P2 普通文件类型校验缺失、FIFO 阻塞占锁 —— 确认关闭

- 代码（`main.rs:439`–`:454`、`:458`–`:491`）：lstat 身份门恢复普通文件判据（`is_file()` 且非符号链接）；打开改用 `custom_flags(O_NONBLOCK)`（macOS `0x0004` / Linux `0o4000`，本地常量不新增依赖，常量值与两平台 fcntl 定义一致）；打开后先按句柄 fstat 判型（特殊文件/符号链接即拒）再核对身份，lstat→open TOCTOU 窗口由句柄身份比对关闭。
- 独立复现（自建脚本）：合成 0600 FIFO `runs/worker.json`（lstat 证实 FIFO/0600/nlink=1），`try-schedule` **0.01 秒**内返回 REJECT/`WORKER_UNVERIFIED`（身份门拒绝"不能是符号链接或特殊文件"，4 秒观察预算未触发、无阻塞、无占锁）；随后同根 `try-schedule` **ACCEPT**，证明根锁已回收。候选矩阵新增 D7 `d-worker-fifo`（5 秒有界断言 + `open-check` 锁回收断言）。

## 5. 增量审查：针对修复本身的三项新角度（本轮独立设计）

| 角度 | 机制 | 结果 |
|---|---|---|
| 探测期间原位改写内容 | 同 ino，mtime/size 变化进入身份七元组 | REJECT/`WORKER_UNVERIFIED`，原因含读取时/当前 mtime 对照 ✓ |
| 探测期间换为指向 0600 普通文件的符号链接 | 复查 `symlink_metadata` 命中 `is_symlink` | REJECT，原因"被替换为特殊文件或符号链接" ✓ |
| 探测期间权限降为 0000 | mode 参与身份 | REJECT，原因含 mode 对照 ✓ |

三项均不走 ACCEPT，修复未引入新的放行路径；`adapter.rs` 未变（哈希一致），本轮未见其它回归。

## 6. 既有边界矩阵复核（本轮全部通过）

根锁与连接同生命周期（含 SQLite CLOSE 回归）、零创建（普通 open 不建标记/目录/库）、NOFOLLOW／身份／权限／硬链拒绝（标记、目录、库、WAL/SHM，含打开后替换/降权 fault 注入）、WAL/短事务/崩溃恢复、SIGKILL 崩溃释放与正常退出释放锁、调度入口复用完整根校验（10 例）、旧 worker 三态探测与记录不可核实即暂停（13 例）、主机事实与合成 Keychain 往返（仅合成条目）——上述在 68/68 场景、255/255 项检查（连跑两次）中全部成立。主机能力事实记录与实测一致（macOS 27.0.1 arm64、cargo/rustc 1.89.0、Node 24.20.0、bundled SQLite 3.51.3）。Linux §6 明确"仅静态依据，未验证"，准入清单完整（Linux 环境重跑 harness、glibc/musl 目标、代理部署另属 W5）；未验证清单（§7）如实保留：正式适配、N-API 绑定/随包分发、生产凭据后端（当前关闭）、真实模型/工作根、完整集成门禁。

## 7. 分级结论与准出

- **P0：无。P1：无。P2：无。P3：1 项** —— D7 场景结束后不删除自建的 FIFO（`run-probes.mjs:815`–`:826`），`build/backend-foundation/roots/d-worker-fifo/runs/worker.json` 以 FIFO 形态残留到下一次运行的启动期整体清理（`run-probes.mjs:254`）；位于 gitignored 草稿区、无读者、不影响任何断言与结论，属草稿卫生改进建议（场景末尾 `rmSync` 一行即可），不阻断。
- 结论：**APPROVE**。候选 `5cd3538`（代码 `9efa908`）可作为"独立存储适配与主机运行边界"探针交付的准入证据；本轮两项失败路径修复经代码审查、独立复现消失与反例持久化三重确认。
- 仍未验证，不得写成已验证：Linux 全部行为、正式生产适配、Node 进程内绑定/随包分发、真实模型/凭据/工作根、完整 `npm run check` 集成门禁（归集成负责人在实际集成版本执行）。本记录不签 done、不改任务状态；workflow 收口归指定评审者与队长。
