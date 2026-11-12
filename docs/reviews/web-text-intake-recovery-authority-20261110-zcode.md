# 恢复条目／回执权威链路有界诊断：冻结 §3.3/§3.5 × 完整 I `cd08588`（MAYNE-24，2026-11-10，ZCode）

- **任务来源**：协调层裁定（评论 `01a1c258-0e65-7bf9-9a8e-60c9a4491017`）——按 sop-bug-fix 对完整 I `cd08588` 做「恢复条目／回执权威链路的有界诊断」，追 `recovery_items`／`side_effect_receipts` → 任务线资源 → 普通 resolve／`commitStagedResume` 两路径，三判据：已确认退出后版本可读；权威条目版本变化后的旧请求 409 且无写入；存在待确认回执时缺 ACK 的 resume 被拒。本轮不改生产。
- **性质与边界**：诊断保持只读（生产／schema／守卫／冻结契约零字节）；不起聚合、全量构建或完整 gate；优先复用真实服务层与现有存储形态，区分业务路径与定向合法状态注入，不给 `inputRef` 补假权威值。原始证据在 gitignored `build/mayne24-recovery-authority/`，摘要经评论附件交付。
- **结论速览**：三判据全部**缺陷复现**（契约行为未复现）——10 面实测 9 DEFECT／1 PASS，exit 1，墙钟 0.17s；根因单一（§6）：两条 resolve 入口的条目版本 CAS 与回执校验读 `inputRef.recovery`（业务流恒缺失 → 常量回退 `1`／`[]`），权威表从不参与该链路；Codex 指控的三处静态事实逐条成立且运行时坐实。既有任务／attempt 事务围栏完好（F2 PASS），但如派工所言**不能替代**条目版本校验。最小修复落点两文件（§7），无 schema／守卫／契约改动。

## 1. 来源身份

- **受审树**：完整 I `cd08588328df27cabdb50f178159424a9534c0b9`，隔离 detached worktree `build/mayne24-recovery-authority/wt-cd08588`（诊断期间工作树零改动，`build/` 为 gitignored）。诊断在本任务分支的独立 worktree 进行，不改 `agent/zcode/mayne-24` 上任何生产字节。
- **冻结契约**：`docs/engineering/web-api-contract.md` 在受审树 SHA-256 `61863271…f58d`＝W0 冻结钉值精确命中（与 `cd28027` 核对记录同口径），所读即冻结原字节。
- **受审文件**（git blob ／ SHA-256 前 16 位）：`task-service.mjs` `c3eaafea`/`d162fd34353839ec`、`text-intake-service.mjs` `edd53a85`/`19f1007d8e9ff3f4`、`task-recovery.mjs` `5099d4aa`/`84b5c0fd7bb26640`、`http-server.mjs` `e3e61be3`/`63056f0a8be15990`；样例 `task-needs-review-exit-reclaimed.json` `87fedac0`、`task-needs-review.json` `96efc939d91b9d7d`。
- **存储二进制**：`web-backend-storage` 从受审树 `src-tauri` 构建（`cargo build --release --bin web-backend-storage`，exit 0），SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`。tauri-build 的资源存在性校验所需 `build/s0-runtime` 目录复制自本机另一 candidate 树既有构建产物——该目录只进应用打包资源清单，不进存储适配器编译面（bin 仅链接 `local_store::web_backend_store` 的 rusqlite／协议层），登记为构建前置而非证据面。
- **探针脚本**：`build/mayne24-recovery-authority/recovery-authority-probe.mjs`，SHA-256 `6b17383c6018796e7529712825e0e6b2c119e08c1c3198493eaeaead7f9fd958`。

## 2. 判据的规范依据（冻结 prose 原文锚点）

| 判据 | 契约锚 | 承诺 |
|---|---|---|
| 版本可读 | §3.5 L121 | 凡 cause ∈ {…`result_exit_unconfirmed`、`exit_unconfirmed`…} 的 `recovery` 另带 `itemVersion: int`（**对应 `recovery_items.version`**）；基础字段含 `receipts`（已知外部回执） |
| 两入口同守卫 | §3.5 L136、§3.3 L102 | 任务 resolve 与 hold 条目 resolve 同一操作同一版本守卫；`expectedVersion` 校验**条目版本**，不匹配 409 `version_conflict`；处置成功后**任务与条目版本同时递增**；`verification_state ∈ {resumed, cancelled}` 的条目不可被旧请求改写（409 `state_conflict`） |
| 缺 ACK 拒绝 | §4.5 L198、§4 端点表 L150 | `acknowledgedReceipts` 必须覆盖 `recovery.receipts` 中全部 `verifiable=true` 条目，否则 **400**（拒绝 resume） |
| 版本语义 | §12 `recovery_items` 行 | `version` 从 1 起，**每次变更 +1**；两个 resolve 入口共用该版本做乐观并发 |

冻结样例 `task-needs-review-exit-reclaimed.json`（`exited_confirmed` 回收态）同时携带 `itemVersion: 2` 与 `decisionOptions`，是「退出已确认后版本仍可读」的直接样例；`task-needs-review.json`（`restart_unknown_side_effect`）携带可核对回执＋`itemVersion: 1`。

## 3. 受审字节现状（逐点，行号对受审树）

1. **`recoveryFor`（task-service.mjs:336–351）**：`receipts ← inputRef.recovery.receipts ?? []`（345）；`exited_unknown` 分支 `itemVersion ← inputRef.recovery.itemVersion ?? 1`（348）；**`exited_confirmed` 分支只返回 `decisionOptions`（350），无 `itemVersion`**——与冻结样例 `87fedac0` 直接相悖。
2. **`resolve`（task-service.mjs:598–667）**：CAS 读 `inputRef.recovery.itemVersion ?? 1`（606–609）；回执校验读 `inputRef.recovery.receipts ?? []`（610–614）；写面＝tasks 条件 UPDATE（`state/version/attempt_exit_state` 条件＋`expectChanges:1`）＋ `task_events`，**触碰不到 `recovery_items`／`side_effect_receipts`**。
3. **`commitStagedResume`（text-intake-service.mjs:1307–1355）**：同 `inputRef` CAS（1319–1322）；**无任何回执校验**；写面＝tasks UPDATE＋event＋candidates 发布/清除＋attempt 收尾。
4. **权威表写入/读取**：`recovery_items` 全树仅 3 处 INSERT（version 硬编码 1：`confirmExtractExit` ~1198、`confirmExit` 1152、`classify` 114），**无 SELECT、无 UPDATE、无版本递增**；`side_effect_receipts` 经 `recordReceipt`（977–992）写入，读取仅 COUNT（997/1008，`sideEffectSafety` 判定），从未进 wire 或 resolve。
5. **`inputRef.recovery` 业务流零写入**：`input_ref` 仅 submit（429/443，客户端输入＋canonical）与 retry（572–574/585，原样或＋snapshot）两处写。附带登记：`inputRef` 来自客户端提交体，客户端理论上可自带 `recovery` 字段——权威值绝不能住在这个客户端可控的通道里。
6. **回收扫描**（task-recovery.mjs:61–78、108–149）：只扫 `ended_at IS NULL` 的 attempt；文本面停靠不关 attempt 行（可回收），而 `task-service.confirmExit(!exited)` 在停靠后 `closeAttempt`（1157）——该路径的 `exited_unknown` 任务不在扫描内。次生面，只登记不深挖（§8）。

## 4. 诊断方法（sop-bug-fix 复现环）

一条命令、秒级可复跑：`PROBE_TREE=<wt-cd08588> node recovery-authority-probe.mjs [out.json]`。真实服务层（受审树 `TaskService`／`TextIntakeService`／`TaskRecovery`）＋真实存储二进制（受审树构建），**每面独立后端实例**（避免 FIFO 队列跨面污染）。所有受审状态经**业务路径**到位：submit → `claimNext` → `recordReceipt`（真实 verifiable 回执，`provableReadonly=false`）→ `stageResult` → `confirmExtractExit(exited:false)` 停靠（真实调度器树验证失败面：needs_review＋exited_unknown＋recovery item INSERT＋attempt 行保持开放）→ 真实 `TaskRecovery.recover()` 回收（无 worker record、无活 pid → classify → exited_confirmed）。**唯一状态注入**＝`UPDATE recovery_items SET version=2`（权威面推进模拟，逐调用点标注；业务无写者本身即发现 F1），直接落权威表，不经 `inputRef`、不经服务写入路径。无等待/定时依赖，确定性时钟。

**最终绑定运行**（同一脚本字节）：exit **1**，`/usr/bin/time -p` real **0.17s**，10 面＝**9 DEFECT／1 CONFORMS**；stdout `71391fd536aa6a03`、stderr（仅 time -p 输出）`a354e3d4accbb006`、报告 JSON `44126e0d381a71ea`。

## 5. 判据逐条裁定

| 面 | 契约期望 | 观测（受审字节） | 裁定 |
|---|---|---|---|
| C1a 停靠态回执可见 | 已知回执进 `recovery.receipts` | `side_effect_receipts` 1 行真实回执在库，wire `recovery.receipts=[]` | **缺陷复现** |
| C1b 回收后版本可读 | `itemVersion:int`（=权威行 version） | `exited_confirmed` 态 wire **无 `itemVersion`**；权威行 version=1 在库不可读 | **缺陷复现** |
| C2a 旧 resolve | 409 `version_conflict`＋零写入 | 注入 version=2 后 `expectedVersion=1` → **202 接受**：needs_review→queued、version 4→5、＋1 event；`recovery_items` 纹丝未动（仍 2） | **缺陷复现** |
| C2b 真版本 resolve | 携真实权威版本 → 202 | `expectedVersion=2` → **409 `version_conflict`**（假冲突；且公共 API 无处可读 2——C1b 使正确请求不可构造） | **缺陷复现** |
| C2c 旧 staged-resume | 409＋零写入（不得发布暂存结局） | `expectedVersion=1` → **接受并发布**：state=succeeded、version 5→6、＋1 event、candidates 发布 | **缺陷复现** |
| C2d 真版本 staged-resume | 202 | `expectedVersion=2` → **409** | **缺陷复现** |
| C3a 缺 ACK resume | 400＋零写入 | 存在 1 条 verifiable 回执、`acknowledgedReceipts=[]` → **202 接受**并重入队；闭环：客户端**无从 ACK**（回执不上 wire） | **缺陷复现** |
| C3b 缺 ACK staged-resume | 同 §3.5 L136 同守卫 | `commitStagedResume` **无回执校验**，暂存结局照常发布 | **缺陷复现** |
| F1 处置后条目推进 | version+1、`verification_state`→resumed/cancelled | resolve 成功后条目仍 version=1／`pending`／decision NULL → §3.5 L136 的 409 `state_conflict` 面不可达 | **缺陷复现** |
| F2 既有任务围栏 | 二次 resolve 被拒 | state/version CAS＋`expectChanges:1` → **409 `state_conflict`** | **保留（PASS）** |

三判据答复：**判据 1／2／3 全部「缺陷复现」**（契约行为未复现）；两路径（普通 resolve／`commitStagedResume`）同源同病，staged-resume 面更重（旧请求直接发布暂存结局）。

## 6. 根因（单一，多面同源）

`resolve`／`commitStagedResume`／`recoveryFor` 把 `inputRef.recovery` 当条目版本与回执的唯一权威源，而该字段业务流恒缺失 → CAS 恒为 `1===1`（空转）、回执校验恒空；真实权威 `recovery_items.version`／`verification_state` 与 `side_effect_receipts` 从不进入该链路，也无任何推进写者。任务行版本／attempt 事务围栏约束的是**任务行**竞争（C2a 中 expectChanges 生效、F2 PASS），与条目自身生命周期正交，故不能替代条目版本校验——权威推进后的旧提交方请求被照单全收（C2a/C2c）。Codex 三项静态指控（`recoveryFor` 确认分支无 itemVersion、resolve 读 inputRef 回退 1／空回执、镜像不证契约）在受审字节逐条成立，并由本探针运行时坐实。

## 7. 最小修复清单（本轮不改生产，供方案修订与修复派工引用）

1. **`server/lib/task-service.mjs`**：`recoveryFor` 按 §3.5 L121 cause 集在**两个分支**都暴露权威 `itemVersion`（读 `recovery_items` 该任务行），并按隔离 attempt 的 `side_effect_receipts` 行暴露已知回执（映射冻结样例结构 `{receiptId, kind, externalRef, recordedAt, verifiable}`）；`resolve` 的 CAS 改绑权威条目版本（建议把条目版本条件并入同事务的 tasks 条件 UPDATE 子查询，与现有 fencing 风格一致），处置成功**同事务**递增条目版本并写 `verification_state`（resume→`resumed`／cancel→`cancelled`）／`decision`／`decided_by`／`decided_at`；resume 前回执覆盖校验按 `provable_readonly=0`（=verifiable）行。
2. **`server/lib/text-intake-service.mjs`**：`commitStagedResume` 同一权威 CAS、同一回执校验、同一条目处置写。
3. **不需要** schema／迁移改动（`recovery_items` 现有列已承载全部所需语义）、不需要守卫或冻结契约改动；既有任务／attempt 围栏原样保留。
4. **回归清单**（修复时落地；红＝cd08588 字节、绿＝修复后）：§5 十面转 `tests/unit/web-text-intake-recovery-authority.test.mjs`（领域命名，入既有聚合脚本行沿用当前接入规则）；另回跑既有 recovery 套件（PC2／M1c 等面）确认 CAS 换源不回归。

## 8. 未验项与边界

- 未跑：HTTP 端到端（真实 server 起服）、聚合、19 旅程、完整 gate、`cargo test`。诊断在服务层入口观测；HTTP 层 `taskResolve`（http-server.mjs:804–822）对 `expectedVersion`／`acknowledgedReceipts` 原样透传，ServiceError→状态码沿用既有注册表（`validation`→400、`version_conflict`/`state_conflict`→409），未在本轮重跑。
- 次生发现只登记未深挖：`task-service.confirmExit(!exited)` 关闭 attempt 行后，其 `exited_unknown` 任务不被 `recover()` 扫描（扫描只看开放行）。
- 存储二进制为本机新构建（身份 §1）；`build/s0-runtime` 目录来源登记为构建前置。
- 与本轮并行的方案修订（OpenCode）及归属／attemptCount 既有澄清不冲突；「缺版本取 1／缺回执当空即有效 CAS」的规范承诺在本诊断下**不成立**，应从方案中去除（与派工对 OpenCode 的要求一致）。

## 9. 证据与门禁

- 原始证据：`build/mayne24-recovery-authority/`（探针脚本、`probe-output.json`、`probe-final.stdout`／`.stderr`、SHA256SUMS、受审树 worktree 与二进制）——gitignored，随评论附件交付摘要。
- 门禁（本分支改动仅 docs）：`npm run check:docs` exit 0；`check:structure` 183＝既有登记基线，零生产提及。生产／package／server／src-tauri 零字节改动；`agent/zcode/mayne-24` 只新增本记录与 README 索引行。
