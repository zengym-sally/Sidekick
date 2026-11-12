# MAYNE-33 D 后端候选独立审查（Codex，2026-11-11）

结论：**needs_revision / BLOCK**。审查对象为 `8480b2e49dc60e1f2b5107fba7fe97818256acf4`，tree `bc2f742944ad37b31737df2048298fd334475cfb`；相对接续基点 `d70280c452038210c0ae6a60f980623de79c8d93` 的 12 文件增量。不修改候选，不合 main，不签 D 整体完成。无 P0/P1 发现；两项 P2 未闭合，尚不满足本轮明确验收。

## 范围与证据身份

- 本次为单个候选的只读审查，非批量改写。规格依据 MAYNE-33 当前正文，父卡 MAYNE-24 提供接续与最终集成边界；D 已批准，不重新申请授权。
- 迁移及存储写权限按仓库标准属于 **R3**，不是作者记录所称的“中”。本轮是未参与实现者的一个独立审查面，未取得 R3 双面通过；已有缺陷即停止准出，不把工具检查计作第二个人的判断。
- 当前任务分支始终为 `agent/codex/mayne-33`，从 `4c3620a73b09cd721cb72b97f844e75095825a9f` 继续。候选用 `git archive 8480b2e` 导出到忽略的审查目录执行，未切分支、未写共享 main。主线仍为 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`。
- 经 CLI 下载作者附件 `01a1c8df-0cf5-7caf-899b-58adf737a9b1`，28814 B，SHA-256 `d98902534fb823f192b306748c6eb7e9d84461fb5c4e1ef75f41b1f4edffebe3`；包内 12 个源码哈希均匹配候选。
- 004 为 1774 B，SHA-256 `5de175b6f00ae40d8a1ed5272b6225dc5f98434815a1d089062ed34a7f39c5bf`。本轮真实重建存储二进制 SHA-256 `111d6d25673e3f6815674381e81ad912f0a52d1ceb311b3af9e5e14e7a189062`，与作者登记值相同。

## F1 · P2 · 三族的目标存在性判断抢在幂等台账前

位置：`server/lib/text-intake-service.mjs:724`、`:756`、`:833`。

已批准规则要求先查台账，同键改变目标候选或动作返回 `409 idempotency_conflict`。三个入口均先 `getCandidateRow`，不存在就立即 `notFound()`，尚未读取已提交的操作记录。

真实 Rust/HTTP 反例：先成功编辑 `cand_review`，使用键 `op_bound`；再用同键向 `cand_missing` 发起 edit、discard、apply_preview，三者均为 **404 `candidate_not_found`**。相同键在现存候选上换动作的控制组为 409，旧键在后续编辑后重放也返回当前 v3，证明偏差来自目标存在性前置，而非配对或存储前置失败。输入和根均为合成数据。

影响：已用键的冲突语义随另一个目标是否存在而变化，违反本轮点名的跨候选/动作键冲突与台账优先契约。须将台账裁决提前到候选存在性和业务守卫之前，保留未知键访问不存在候选时的 404，并加入三族真实 HTTP 正反控。修复无需改精确 004。

证据附件 `probe.mjs` / `probe.jsonl` 保留可复跑脚本和观察。探针另记录了同键非法标题返回 400；无效输入的优先级未另行裁定，不把该观察扩充成独立发现项。

## F2 · P2 · 点名的迁移中断及响应未知矩阵未覆盖

位置：`src-tauri/src/store/web_backend_schema_tests.rs:1057`；`tests/integration/web-text-intake-candidate-operations.test.mjs:294`；`tests/unit/web-text-intake.test.mjs:454` 起的新增组。

迁移反例目前分别覆盖“v2 在第三迁移失败”和“v3 在第四迁移失败”。缺少本轮明确要求的 **从 v2 开始，003 已执行、004 再失败，整个 pending 集合回 v2** 的证明。现有两例不能证伪“每个迁移单独提交”的错误 runner。须用 v2 种子配 `AfterFourth`，检查表/两版本镜像/原行及 sequence 高水均回 v2，再正常重开。

HTTP 重启例先读取成功 200，再正常关闭，仅覆盖 edit；没有制造响应未知。discard 没有失败不占键证明，apply_preview 没有后续修改后旧键读当前态的回归。三族同根重启的响应未知重放未齐备。须在现有授权测试文件中补齐这些点名面，保留每例 20s 含清理；不能将当前 6/6 扩称整套矩阵完成。

这是验收证据与回归保护缺口，不宣称已经复现迁移数据损坏或重启重复写入。本轮独立探针确证了一条额外正控：在候选 UPDATE 后使台账 INSERT 触发真实 FK 失败，候选版本/字段回滚、键未占用、通知不增加，同键随后成功；此证据不补齐上述其余面。

## 实际复核

环境：macOS arm64，Node v24.20.0，npm 12.2.1，Cargo 1.99.1。前置 `npm ci --ignore-scripts`、`probe:prepare-cli`、`probe:prepare-pi`、`probe:bundle` 及必要前端/存储构建均完成。首次存储构建因真实 Runtime 尚未准备失败，准备后重跑通过；未用占位资源。

| 检查 | 实际结果与边界 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend -- --test-threads=1` | exit 0，42/42 |
| `node --test --test-timeout=20000 tests/unit/web-text-intake.test.mjs` | exit 1，17/18，新增 5 例全绿；旧 `markNeedsReview` 失败保留 |
| 新增 HTTP 套件，`--test-reporter=tap --test-timeout=20000` | exit 0，6/6；显式指向候选源码入口、本树新编二进制及真实生产 dist；真实 HTTP/受控模型/真实 Pi，不代表真实模型 |
| 独立 `probe.mjs` | exit 0，记录 F1 的三族 404 及控制组；事务 FK 失败回滚正控通过，合成根删除、存储子进程 exit 0 |
| 原单元字节对照 | 原文件是候选文件的完整字节前缀，TaskService 两版本完全相同；仅调整导入/根定位后，以原 13 例和本轮二进制运行 12/13，同一失败。未声称重建了旧版本二进制 |
| 结构 self-test / 仓库扫描 | 均 exit 0；26 类/8 引用负例，004 缺失/篡改/原字节三态；285 源文件/642 引用。仓库扫描用候选独立临时 index 与 `GIT_WORK_TREE`，未移动平台文件或修改守卫 |
| `check:docs` | exit 0，21 文件/519 本地链接 |
| Node 语法 / `cargo fmt --check` | exit 0 |
| 标准 `cargo clippy --all-targets -- -D warnings` | **exit 101**，`web_backend_store.rs:289` unnecessary_cast、`tray_icon.rs:12` 与 `mcp_formal_tests.rs:1387` chunks_exact_to_as_chunks；三处相关字节均为接续基点已有。本轮不加 allow，也不宣称标准 Rust 门禁通过 |

审查已覆盖：规格符合度、精确 DDL/镜像/外键、写目标与只读边界、规范输入、重放/CAS/失败回滚、并发/重启证据及验证口径。未发现本增量修改依赖、001–003、根锁或七命令。003 冻结清单缺口按原派工留待集成接收，不越权增补。

明确未做：完整 `npm run check`、全量 Cargo、19 业务旅程、浏览器 operationId 接线、E/V2 生产切换、R3 第二审查面、真实凭据/用户根/模型、push/PR/部署。完整门禁与最终组合仍归 MAYNE-34；本报告不提供整体准出结论。main 保持原样，MAYNE-33 按工作流退回已驳回。
