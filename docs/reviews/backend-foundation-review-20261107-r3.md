# MAYNE-20 第三轮修订候选复核（2026-11-07）

> 结论：**needs_revision / BLOCK**。原替换/权限竞争反例、标记私有性反例已修；新增核查仍确认“记录复查失败即放行”的 P1，且记录类型检查被移除后 FIFO 会阻塞调度并占住根锁（P2）。不合入主分支，不关闭本任务；按 workflow 交 Claude 修订，并请求 ZCode 按本轮冻结版本独立复核。

## 1. 版本与范围

- 基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`。
- 冻结候选：`fa883325a3b4ec3a492b1ec3a60b02408ea6e635`，tree `6e1b90835960f9e762056a2ae2c28f8adab19c13`，分支 `agent/claude/mayne-20`。
- 代码：`f54ab36735cec1c6f34f6ecf2a275e2504064c35`，tree `04edc06b7fccc0a80140354fd9e39a2844f37db4`；`fa88332` 补作者记录。
- 审核分支保持 `agent/codex/mayne-20`，起点 `72e8694aac6c86ff0610d4ab7e3a0ad403587d0f`。候选以 `git archive fa88332` 导出至本树 `build/backend-foundation-review-r3/candidate/`，未导入交付分支，未切换/修改共享 main，未手工 commit/push/合并。
- 相对基线新增 11 个文件，均属于允许的探针、工程说明与本任务评审记录；未改生产依赖、schema、vendor 或应用身份。
- Codex 未参与实现；风险 R3，复核根/连接生命周期、文件身份与私有性、调度失败/竞争、回归与证据范围。判据来自任务验收及 [Web/后端设计](../engineering/web-backend-design.md) §2/§5；上轮见 [第二轮复核](backend-foundation-review-20261107-r2.md)。
- 六项源码 sha256 与作者 `backend-foundation-20261107-r3.md` 的表逐项一致；关键三项：runner `eab74f1c2ca452107503378c35a09397f40c622167eab8af3c4158e4b13800bd`、adapter `8c7de1941f8d2ad1df0aa4e947753130d1404f4584aec739f097498dd6659d41`、main `7efe1610e90176fee01387379fb017608017ed85f2529c87a11a1619c767d851`。

## 2. 新鲜验证

所有候选命令在隔离副本执行。Cargo target、TMPDIR、数据库及追加 fixture 均在本轮 build 内。只使用合成根、合成钥匙串条目及自建进程。

| 命令/检查 | exit | 结果 |
|---|---:|---|
| `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建，65/65 场景、242 项检查、74 次记录调用 |
| `cargo fmt --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml -- --check` | 0 | 通过 |
| `cargo clippy --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings` | 0 | 通过 |
| `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | 0 | 关闭期与标记私有性回归 2/2 通过 |
| `node --check tests/probes/backend-foundation/run-probes.mjs` | 0 | 通过 |
| `npm run check:docs` | 0 | 候选 18 文件、300 链接；本审核树补记录后另跑 |
| `git diff --check a17a6b4..fa88332` | 0 | 通过 |
| `python3 build/backend-foundation-review-r3/failure-path-repro.py` | 0 | 成功采集下述反例与正对照；exit 0 是采集完成，不是候选通过 |

原始证据在 `build/backend-foundation-review-r3/`：`probe-run.log`、`quality-*.log`、`quality-results.json`、`failure-path-repro.py`、脱敏 `failure-path-results.json`，以及候选内 `build/backend-foundation/results.json`。仓库仅收本记录；脚本/结果随任务评论附送。

完整 `npm run check` 未运行：按父任务分工，重门禁由集成负责人在实际集成版本串行执行。本轮是拒绝结论，不以聚焦结果签全量通过或阶段晋级。

## 3. P1：快照复查失败被解释为“记录无变化”

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:498`–`:523`，尤其 `:508` 的 `fs::symlink_metadata(&snapshot.path).ok()?`；调用方 `:651`–`:656`。

违反不变量：读取之后记录被替换、消失或无法核实，不能继续用旧记录签发准入；“复查失败”与“成功复查且未变化”必须区分。

根因：`recheck_worker_record()` 返回 `Option<String>`，None 被调用方视为没有发现问题。对 metadata 错误使用 `.ok()?`，会把 NotFound、权限错误等同样折叠成 None，保留旧 `Exited` 分类并 ACCEPT。

实际复现（未修改候选二进制，使用其既有 `SIDEKICK_PROBE_KILL` 钩子）：

1. 合成根写入本次自建且已 wait 退出的 PID，记录为 0600。
2. 候选持锁读取后，探测钩子删除 `runs/worker.json`，并针对该已退出 PID 返回 `No such process`。
3. 结果仍为 **exit 0 / ACCEPT**，`worker.alive=false`；记录已不存在。
4. 不删除记录的正对照也为 ACCEPT，说明现有复查没有区分两种输入。

影响：本候选仍不能证明“核查之后发生变化即暂停”的契约，无法取得当前记录时仍沿用过期状态。删除反例已实测；其它 metadata 失败为同一错误分支的静态覆盖缺口，不冒称实测。

必需修订：用明确结果区分“确认未变化”和“无法复查/已变化”；已存在的快照消失、读失败、类型不符都返回 `WORKER_UNVERIFIED`。保留真正从未存在的记录的独立语义，补删除、受控复查错误及不变化的持久正反例。

## 4. P2：失去普通文件类型校验，0600 FIFO 阻塞调度并持有根锁

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:385`–`:395`、`:431`–`:443`。

违反不变量：worker 记录必须为普通文件；不可核实记录应明确暂停，不能在读取特殊文件时无限等待。

根因：本轮用 `RecordIdentity` 替换旧读取实现时，移除了原来的 `metadata.is_file()` / symlink 判据；`from_metadata()` 对所有类型都返回 Some，入口只检查 nlink=1 和 mode=0600。满足这两个属性的 FIFO 会进入阻塞式 `OpenOptions::open()`，还未读取或检查 JSON 就停住。

实际复现：有效合成根中以 `os.mkfifo(..., 0o600)` 创建 `runs/worker.json`，运行 `try-schedule`。两秒观察截止仍未返回；此时另一调用 `open-reject --expect ROOT_IN_USE` 返回预期的 ROOT_IN_USE，确认调度子进程持续占有根锁。测试随后只终止本次自建子进程并 wait（退出码 -9），删除自建 FIFO 后同根 `try-schedule` 恢复 ACCEPT。未留下进程或监听。

两秒是复现脚本的观察预算，不是虚构产品时限；代码没有 FIFO 写入方时会阻塞的释放路径。该结果只证明合成 FIFO 路径，不外推其它特殊文件或 Linux。

影响与修订：不合法记录可以使诊断/调度无法给出暂停原因，并让其它适配入口持续收到根占用。恢复读取前后普通文件类型验证，使用现有可用机制避免特殊文件阻塞，补 FIFO/其它可合成非普通文件的有界拒绝及根锁可回收断言；不借此新增未经授权的依赖。

## 5. 已关闭部分与交接

- 本轮顺序修订已实测：D6 的替换、权限变化、正对照三例均在根锁保护下运行，变化分别拒绝，不变化放行。原两项具体缺口不继续重复挂账。
- 标记权限变化已实测得到首次 PATH_CHANGED、随后 STORAGE_STOPPED；Rust 直接回归通过。此前根安全 10 例、PID/探测三态及关闭期测试继续通过。
- P0 未发现；本轮为上述 1 项 P1、1 项 P2，无新增独立 P3。
- Linux、正式适配、Node 绑定/分发、生产凭据 Provider、真实模型/工作根、完整 Web 业务与集成全量门禁保持未验证。未评审不在候选实现中的 UI、代理部署、业务 schema/迁移。
- 上轮 ZCode 结论只覆盖 `a17a6b4`，不能沿用到本候选；按 `fa88332` 请求新只读复核。按 workflow 退回 Claude，从冻结候选接续修订；不签 done，不提前晋级 W0 集成。
