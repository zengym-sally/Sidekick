# MAYNE-20 第二轮修订候选复核（2026-11-07）

> 结论：**needs_revision / BLOCK**。上轮三项具体反例已修，61 个既有场景和关闭期回归测试通过；但 worker 记录在取得根锁之前被读取、在准入时不再核对，替换后的存活 worker 仍可被放行。另有运行中归属标记权限降级未被检出的 P2。保持原范围退修，不合入主分支；指定的 ZCode 需对本轮冻结版本独立复核。

## 1. 版本、范围与方法

- 基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`。
- 冻结候选：`a17a6b4df12f01c54a62d6d6222be08986b207b4`，tree `f3c455fd1cb41b3c57bf97b6f6ca48e614bc72cf`，分支 `agent/claude/mayne-20`。
- 代码：`d74a3b455a5b32168942f4ceb0b832655f79b261`，tree `dfae697f61a117c98c99527853bdb93d7255ca97`；`a17a6b4` 补作者证据记录，代码不变。
- 审核分支 `agent/codex/mayne-20` 保持起点 `03cf67090293037ff5dd391a92c1f5e48439f184`，未导入候选代码、切分支、手工提交/推送或合并。
- 候选通过 `git archive a17a6b4` 导出到 `build/backend-foundation-review-r2/candidate/`。相对基线新增 10 个文件，全部属于本任务允许的探针、工程说明与评审记录；无生产依赖、schema、vendor、应用身份改动。
- 审核者 Codex 未参与实现；风险 R3，检查存储/锁生命周期、文件安全、调度失败与并发、持久反例及证据范围。对照 [Web/后端设计](../engineering/web-backend-design.md) §2/§5 和任务要求。上轮记录见 [2026-11-07 复核](backend-foundation-review-20261107.md)。
- 六项源码 sha256 与作者 `backend-foundation-20261107-r2.md` 的表逐项一致。关键三项为 runner `19b8a5dc9f819426e3caabcc4571ea6b5494b3d26041ca86ccee6a1879ce8787`、adapter `c46d343681c7d1a60005d9293eff8591e988a58306f1c2caf1c05ab06b60fd38`、main `1c0308c0ceca1b7c125e2a9d4ba98631b2f97f0001f11108909b6d9bd5a38b71`。

## 2. 新鲜验证

下列候选命令在隔离副本运行。Cargo target 和 TMPDIR 均设置在本轮 build 目录，测试只用合成根/合成钥匙串条目。运行器的自建 worker 已退出，无服务交付。

| 命令/检查 | exit | 结果 |
|---|---:|---|
| `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建；61/61 场景、228 项检查、70 次记录调用 |
| `cargo fmt --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml -- --check` | 0 | 通过 |
| `cargo clippy --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings` | 0 | 通过 |
| `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | 0 | 原生关闭期回归 1/1 通过 |
| `node --check tests/probes/backend-foundation/run-probes.mjs` | 0 | 通过 |
| `npm run check:docs` | 0 | 候选 18 文件、300 链接通过；本审核树补记录后另跑 |
| `git diff --check 55684a2..a17a6b4` | 0 | 通过 |
| `python3 build/backend-foundation-review-r2/worker-race-repro.py` | 0 | 成功采集下面三组对照；exit 0 表示采集完成，不表示候选通过 |
| 派生副本：`cargo test --offline --manifest-path build/backend-foundation-review-r2/attribute-harness/Cargo.toml marker_privacy_change_must_stop_storage -- --nocapture` | 101 | 标记变为 0644 后读取仍为 `Ok(0)`，期望拒绝的测试失败 |

未运行完整 `npm run check`：按父任务分工，由集成负责人在实际集成版本串行执行。本轮是拒绝结论，不以聚焦通过签全量门禁或阶段准入。未复用旧候选的测试结果。

## 3. P1：worker 核查发生在根锁之前，记录替换后仍按旧结果放行

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:513`、`:526`、`:542`；记录读取在 `:378`–`:419`。

违反不变量：启动前确认当前历史记录中的旧 worker 已停止；无法核实则暂停调度。根/记录的身份与进程状态必须属于同一次受保护的准入检查。原修订要求还明确包含记录替换反例。

根因：`classify_worker()` 先读取/探测记录，随后才调用 `StorageAdapter::open()` 取得根锁；之后直接匹配先前的 `status`，既不重新读取记录，也不核对记录 inode/权限/内容是否变化。读取本身还先 lstat 再按路径 `read_to_string()`，未持有对应文件句柄核对前后身份。

复现针对未修改的候选二进制，使用候选既有 `SIDEKICK_PROBE_KILL` 钩子，不改生产或候选实现：

1. 合成根中写入已退出的自建子进程 PID，记录为 0600。
2. 调度进入探测钩子时，另一个合成进程以 `fcntl.flock` 成功取得同一根锁，证明核查尚未受该锁保护。
3. 持锁进程把记录原子替换为复现驱动进程的存活 PID，或将记录权限改为 0644，然后释放锁；针对原已退出 PID 返回 `No such process`。
4. 候选取得根锁后，仍使用变更前的状态 ACCEPT。没有再修改该根，立即按默认真实 `/bin/kill -0` 重查则拒绝。

| 钩子行为 | 记录身份 | 第一次准入 | 同一根不再变动后的第二次准入 |
|---|---|---|---|
| 不改记录（正对照） | 原 inode、0600 | ACCEPT | ACCEPT |
| 持锁原子替换为存活 PID | 新 inode、0600 | **ACCEPT，仍报告旧 PID 已退出** | REJECT / `WORKER_ALIVE` |
| 持锁将记录改为 0644 | 原 inode、0644 | **ACCEPT** | REJECT / `WORKER_UNVERIFIED` |

三组钩子均记录 `rootLockAvailableDuringProbe=true`；不是依赖概率的竞争压测。存活 PID 属于本次复现驱动进程，退出 PID 属于本次创建并 wait 的子进程，没有对任意用户进程发信号。原始结果已用 `<synthetic-roots>` 脱敏。

影响：即使所有文件在最终打开时满足根安全检查，调度结论仍可能对应已经过期的 worker 记录，无法证明当前 worker 已退出，可能允许超发。探针不能作为该启动边界的准入证据。

必需修订：先取得并持有完整适配/根锁，再读取 worker 记录并探测；对记录使用受控打开/同一句柄读取，核对读取和发布准入前的身份、私有性与版本，变化则暂停或在同一保护范围内重新核实。持久覆盖本轮原子替换、权限变化及不变化的正对照，不能只覆盖静态坏文件和探测命令错误。

## 4. P2：运行中归属标记的权限降级未触发存储停止

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs:526`–`:535`。

违反不变量：归属标记要求 0600；适配生命周期内对持有文件复核身份/私有性，失败即停止读写。当前取得锁时检查权限，后续 `verify()` 对 marker 只检查类型、链接数和 dev/ino，漏掉 mode。

复现：在 build 下复制候选 crate，仅追加 `marker_privacy_change_must_stop_storage` 单元测试。显式 init 后读 `probe_items` 为 0，随后将同一 marker 改为 0644，再调用 `count()` 仍得到 **`Ok(0)`**；期望 `PATH_CHANGED` 的断言失败，cargo exit 101。没有修改候选适配方法。追加测试源码随任务评论提供。

影响和修订：活跃适配继续消费一个按自身打开规则已经不合法的根，私有性证据不完整。复用已有文件私有性复核或补等价校验，并覆盖首次失败、随后 `STORAGE_STOPPED` 的持久断言。本项是此前未覆盖的同类边界，不归因为 `d74a3b4` 新引入。

## 5. 已关闭部分、未验与交接

- 上轮静态调度根安全 10 例、PID 越界与探测错误三态、连接关闭前根锁保持及真实适配析构均已复核通过；这些具体修订不继续挂为未关闭。当前 P1 是记录版本/持锁顺序的剩余缺口。
- P0 未发现；本轮为 1 项 P1、1 项 P2，无新增独立 P3。
- Linux、正式适配与 Node/Rust 绑定、生产凭据 Provider、真实模型/工作根、Web 业务与集成全量门禁仍未验证；UI、代理部署和业务 schema 不属于本候选实现，未评审。
- 指定的 ZCode 上一结论仅覆盖旧 `55684a2`，不能用于本候选。按新冻结版本请求只读复核；workflow 收口退回 Claude 修订，不签 done。
- 原始证据仅留在 `build/backend-foundation-review-r2/`：`probe-run.log`、`quality-*.log`、`quality-results.json`、`worker-race-repro.py`、`worker-race-results.json`、`marker-mode-test.log`、`marker-mode-repro.rs`，以及候选内的探针结果。任务评论附送本记录、可复现脚本/脱敏结果和追加测试源码；仓库仅收本记录，索引仍由集成负责人维护。
