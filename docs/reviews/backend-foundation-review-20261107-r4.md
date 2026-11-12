# MAYNE-20 第四轮修订候选复验（2026-11-07）

> Codex 增量评审与复验：**pass（限本记录范围）**。上轮 P1/P2 已关闭，未发现新的 P0–P3。指定的 ZCode 尚未对本轮冻结版本出具结论，任务保持 in_review；本记录不代签独立复审、集成门禁或主分支合入。

## 1. 对象与范围

- 冻结交付：`5cd3538809dc1694954c66f24155d6005d299898`，tree `7bf8d40b5b4866709df4356dd883857b3298522b`，分支 `agent/claude/mayne-20`。
- 代码：`9efa9082645bac09ed711ca698f3f62a171ff1ca`，tree `8057bb266c69697b9842bd1d3f7f6989c953694b`。`5cd3538` 补作者记录，代码不变。
- 基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 是候选祖先；相对基线新增 12 文件，全部属于本任务的探针、工程说明和评审记录。无生产依赖、schema、vendor 或应用身份变化。
- Codex 未参与实现；R3，复核范围为本轮记录读取/复查修订、相关失败语义与原探针矩阵。依据任务验收、[Web/后端设计](../engineering/web-backend-design.md) §2/§5、[上轮发现](backend-foundation-review-20261107-r3.md)。
- 审核分支保持 `agent/codex/mayne-20`，起点 `c4f20b3afc707ae2219297f18e337642b5204182`。候选通过 `git archive 5cd3538` 导出至 `build/backend-foundation-review-r4/candidate/`；未导入候选、手工 commit/push/合并或操作共享 main。
- 六项源码 sha256 与作者 `backend-foundation-20261107-r4.md` 的表逐项一致：runner `13e536042f9301d3b9eab5c8dbd34b7ceda7814ff561d01d36c02e659632ce7c`、adapter `8c7de1941f8d2ad1df0aa4e947753130d1404f4584aec739f097498dd6659d41`、main `76c3ced08cddd9e6fbe005b99e6a3be16d4a445e5e2e017e3c24c4960428f2d9`；manifest/lock 未变。

## 2. 新鲜验证

在隔离候选执行，Cargo target、TMPDIR、数据库及 fixture 均放本轮 build 下，只使用合成根/合成钥匙串条目与自建进程。

| 命令/检查 | exit | 结果 |
|---|---:|---|
| `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 离线构建；68/68 场景、255 项检查、78 次记录调用 |
| `cargo fmt --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml -- --check` | 0 | 通过 |
| `cargo clippy --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings` | 0 | 通过 |
| `cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml` | 0 | 关闭期与标记私有性 2/2 通过 |
| `node --check tests/probes/backend-foundation/run-probes.mjs` | 0 | 通过 |
| `npm run check:docs` | 0 | 候选 18 文件、300 链接；本审核树补记录后另跑 |
| `git diff --check fa88332..5cd3538` | 0 | 通过 |
| `python3 build/backend-foundation-review-r4/verify-failure-paths.py` | 0 | 另写脚本直接调用未修改候选二进制，四组独立断言通过，见下表 |

| 独立复验输入 | 实际结果 |
|---|---|
| 已退出的自建 PID，探测期间记录不变 | ACCEPT（正对照） |
| 探测期间删除已读取的 `worker.json` | REJECT / `WORKER_UNVERIFIED`，原因明确为记录被删除 |
| 探测期间把 `runs/` 改为 0644 | REJECT / `WORKER_UNVERIFIED`，实际 Permission denied / os error 13；脚本恢复目录权限 |
| 0600 FIFO `worker.json` | 约 0.013 秒返回 REJECT / `WORKER_UNVERIFIED`；随后 `open-check` exit 0，根锁已回收 |

## 3. 发现项关闭与结论边界

- 上轮 P1 关闭：metadata 复查错误不再通过 `.ok()?` 折叠为“无变化”；记录删除、无法 stat、类型不符均明确暂停，原不变正对照仍可放行。直接复验和 D6 持久场景一致。
- 上轮 P2 关闭：读取前后恢复普通文件判型，受控打开加入 `O_NONBLOCK`，避免特殊文件在检查窗口换入时阻塞；D7 与独立 FIFO 用例均有界拒绝并回收锁。后者直接验证静态 FIFO；窗口内换入的规避机制经代码检查，未冒称另做过窗口注入实测。
- 原根安全、PID/探测三态、记录替换/权限竞争、标记降级、WAL/短事务、崩溃释放等继续由本轮 68 场景和两项 Rust 回归覆盖。本轮增量未发现新的 P0–P3，不为增加轮次扩张验收。
- 全量 `npm run check` 按父任务分工留给集成负责人在实际集成版本串行执行；本轮聚焦通过不能代替它。Linux、正式适配/Node 绑定与分发、生产凭据 Provider、真实模型/工作根和完整 Web 业务仍未验证；UI、代理部署、业务 schema/迁移不属于本候选实现。
- 指定 ZCode 的已有结论覆盖旧 `fa88332`，不能直接用于当前交付。请求其对冻结 `5cd3538` 只读复审后，再按精确版本、证据和授权收口；本轮保持 in_review，不作完成或合入决定。
- 原始证据仅留 `build/backend-foundation-review-r4/`：`probe-run.log`、`quality-*.log`、`quality-results.json`、`verify-failure-paths.py`、脱敏 `independent-results.json` 及候选内的探针结果。自建进程已退出，无遗留服务。任务评论附本记录、独立脚本与脱敏结果；仓库仅收本记录，索引由集成负责人维护。
