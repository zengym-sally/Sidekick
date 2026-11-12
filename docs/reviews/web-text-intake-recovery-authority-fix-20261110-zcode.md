# 恢复条目／回执权威链路最小修复：两文件写域 × 完整 I `cd08588`（MAYNE-24，2026-11-10，ZCode）

- **任务来源**：协调层派工（评论 `01a1c26d-ce8e-7991-9edb-c25675337432`）——沿既有已审冻结契约实施最小修复；把且仅把 `server/lib/task-service.mjs`、`server/lib/text-intake-service.mjs` 的本缺陷修订写域转交本人；从精确 `cd08588` 建修复分支、保留原分支／诊断提交、不改共享 main、不整枝合并；十面固化为 `tests/unit/web-text-intake-recovery-authority.test.mjs`（夹具限 `recovery-authority-*`）；红在原基线、绿在修复后；补受控真实 HTTP 的版本冲突／缺 ACK／合法处置状态码核证。
- **修复分支**：`agent/zcode/mayne-24-recovery-authority-fix`，提交 **`b4aea55d34c4cda8228d064eb5ac4ba425bd2d5e`**，直接位于精确 `cd08588328df27cabdb50f178159424a9534c0b9` 之上，恰 4 文件 +837/−27（两生产文件＋测试＋夹具）；已推送 origin（gitee）。诊断提交链（`e361be7` 等）与原分支原样保留；main 未触碰；未整枝合并。
- **本分支载体**：`agent/zcode/mayne-24` 只新增测试／夹具（与修复分支逐字节同 blob：测试 SHA-256 `636ac06777c12870…`、夹具 `52fc79bd802d4a5f…`）与本记录；**未改公共 README／manifest／package**（按派工留工程接收，不带前轮索引增量）。本分支树上夹具的 5 条 `server/lib/*` 引用为 `[ref.missing]`——候选树约束（本分支无完整 I 服务文件），与 SSE 轮登记的同类约束同口径：字节以修复分支谱系为准，工程接收时落位到含完整 I 的谱系即解析。

## 1. 身份

- 受审／修复基点：完整 I `cd08588`（冻结契约 `docs/engineering/web-api-contract.md` SHA-256 `61863271…f58d`＝W0 钉值，与诊断记录同口径复核）。
- 修复后两文件（`git hash-object`）：`task-service.mjs`、`text-intake-service.mjs`（详见附件 SHA256SUMS）；diff 全文随附件 `fix-b4aea55.patch`（`git diff cd08588..b4aea55`）。
- 存储二进制：`web-backend-storage` 从修复树 `src-tauri` 构建，SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`——与诊断轮构建**逐字节同值**（同树确定性构建；`src-tauri` 在两树间零差异，单二进制同时服务红绿两轮）。`build/s0-runtime` 目录复制自本机 candidate 树（tauri-build 资源存在性校验前置，不进存储 bin 编译面），与诊断轮同口径登记。
- 新回归字节：测试 `636ac06777c12870…`＋夹具 `52fc79bd802d4a5f…`，红绿两轮逐字节相同（sha256sum 复核）。

## 2. 修复内容（冻结 §3.3/§3.5/§4.5/§12 语义，无新增规则）

1. **`recoveryFor` 改异步、权威化**（task-service.mjs）：`itemVersion` 从任务当前 `recovery_items` 行（`rowid` 最新＝当前 episode）读取，凡冻结 §3.5 cause 集（九 cause 常量 `RECOVERY_ITEM_CAUSES`）**两个退出分支都暴露**（`exited_unknown` 保 `stagedResult`、不出 `decisionOptions`；`exited_confirmed` 出 `decisionOptions`——与冻结样例 `87fedac0` 的 `itemVersion`＋`decisionOptions` 并存一致）；条目行缺失**不造值**——成员缺席即线面可见信号；`receipts` 从该任务最新 attempt 的 `side_effect_receipts` 行映射为冻结样例元素形状 `{receiptId,kind,externalRef,recordedAt,verifiable}`，`verifiable ⇔ provable_readonly=0`（§12 字段语义溯源，非另造规则；跨 attempt 隔离是结构性的——子查询只绑本任务最新 attempt）。`inputRef.recovery` 仅剩展示字段（cause 回退／sideEffectKnown／reason）与既有行为同口径；版本与回执从此**从不读镜像**。`wireFrom` 随之异步（树内调用方 `toWire`/`list` 均 await；无树外调用方）。
2. **`TaskService.resolve` 权威 CAS＋同事务处置**：条目行缺失 → 可见拒绝（`state_conflict`「恢复条目缺失」，不造版本）；已处置（`resumed`/`cancelled`）→ 409 `state_conflict`；`expectedVersion` 对权威行版本，不匹配 → 409 `version_conflict`；resume 需 `acknowledgedReceipts` 覆盖 attempt 台账全部 `verifiable=true` 回执，否则 400（§4.5）。条目处置（`version+1`＋`verification_state`＋`decision`／`decided_by='user'`／`decided_at`）与任务迁移、attempt 收尾、事件**同一事务**（`expectChanges:1` 前置断言——前提丢失整批回滚，零副作用；任务与条目版本同事务递增）。既有任务／attempt 围栏、退出门（`exit_unconfirmed`）原样保留。
3. **`commitStagedResume` 同守卫同处置**（text-intake-service.mjs）：同一权威 CAS、同一缺失／已处置拒绝、同一回执门（新增第 4 参 `acknowledgedReceipts=[]`——既有 3 参调用点保持兼容），条目处置并入同一发布事务（任务终态＋candidates 发布＋attempt 收尾＋条目推进同批）；被拒的 staged resume **零发布零写入**；暂存原结局提交语义原样保留。
4. **`markNeedsReview` 补条目 INSERT**：§12「每个 needs_review 任务对应一行」——最后一个不写条目的 producer 补齐（与 `confirmExit`／`confirmExtractExit`／`TaskRecovery.classify` 同款同事务），失败停靠任务保持可解析的权威链。
5. **`http-server.mjs` 有意不触碰**（两文件写域之外）：其 staged-resume 路由仍不转发 ACK——HTTP 缺 ACK 面因此正确答 400（H2 实测），而 staged 入口的 HTTP 完整 ACK 面待**一行转发**（`body.acknowledgedReceipts ?? []` 作第 4 参）即闭合；此为报请最小越界项（§5），本轮未自行实施。服务层 C4 面已证守卫本体就绪。

## 3. 红绿证据（同测试字节，两树各一次终局运行）

| 树 | 命令 | exit | 结果 | 墙钟 |
|---|---|---|---|---|
| 修复树 `b4aea55` | `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-recovery-authority.test.mjs` | **0** | **25/25** | 0.49s |
| 基线 `cd08588`（detached worktree，生产字节零改动） | 同上，逐字节同文件 | **1** | **20 fail / 5 pass** | 0.97s |

- **20 红全部命中其指名症状**：A1 `undefined !== 2`（确认退出后版本不可读＝判据 1）；B3/B5/C1/C3「Missing expected rejection」＝旧版本／缺 ACK 请求被**接受**（判据 2/3，staged 面旧请求直接发布暂存结局）；B4/C2 假冲突（真权威版本 409）；B1/B2/C4/C5 条目永不推进（F1）；D2 条目版本停 1；A3 回执不上线；A4 镜像覆盖线面；H1/H2/H3 HTTP 状态码面（202 而非 409/400）；H4 HTTP 回执不可读→ACK 不可构造。
- **5 个基线绿全部可解释**：B8/B9/D1/H5＝登记对照面（基线经非权威机制给出同码答案）；**B7 基线绿是「因错而绿」**——基线 CAS 读伪造镜像本身，999 拒而 1 会过（客户端值把守 CAS＝缺陷最纯形态）；已在测试内注释与派工口径登记。修复树 25 面全绿＝契约理由。
- 每面独立实例（真实存储二进制＋真实服务），业务路径到位（`submitSource`→`claimNext`→`recordReceipt`→`stageExtractResult`→`confirmExtractExit(exited:false)`→真实 `TaskRecovery.recover()` 回收）；**唯一状态注入**＝权威面 `UPDATE recovery_items SET version=?`（夹具内逐点标注，全程不经 `inputRef`）；无等待／定时依赖，最慢面 0.52s，20000ms 预算未触及。
- **受控真实 HTTP**（H1–H5）：真实 `HttpServer`（真实配对／会话／CSRF／Origin／状态码映射）＋真实服务＋真实存储，无调度器／无 worker／**无真实 Pi**——严格 handler 层取证：陈旧版本 409 `version_conflict`（H1）、staged 缺 ACK 400 `validation_failed` 且零发布（H2）、普通缺 ACK 400（H3）、合法处置 202（H4）、退出未确认 409 `exit_unconfirmed`（H5 对照）。

## 4. 既有 recovery 邻域回归（PC2/M1c 口径）

修复树 8/10 绿：**PC1、PC2、M1a、M1b、M1c、E1、E2、D1 全过**（CAS 换源不回归——PC1/PC2 的 `expectedVersion:1` 与重启重建的权威 v1 恰合，回执门空集不受影响）；**F1 与 W 在修复树与基线树以逐字节相同的断言与数值失败**（F1：`candidates 1 !== 0`；W：settled envelope 缺失）——本机真实进程时序前置条件（stub 生命周期／SIGTERM 链），**非本次修复的回归**，登记为本机未证面；两轮原始 TAP 随附件可核对。

## 5. 登记项（不隐瞒）

1. **越界最小项（报请，未实施）**：staged 入口的 HTTP 完整 ACK 需 `http-server.mjs` 一行转发（写域属完整 I 作者）；不转发则该入口缺 ACK 正确 400、完整 ACK 只能在服务层通行（C4 已证守卫就绪）。
2. **B7 基线绿因错而绿**（§3）；B8/B9/D1/H5 为对照面。
3. **F1/W 本机时序失败两树同值**（§4）——本机未证，不代签。
4. **候选树约束**：本分支夹具 5 条 server 引用 `[ref.missing]`（structure 记录在案）；修复分支谱系内零违反（该树 check:structure 3 条违反全部为该树自身 vendor/pi dist 缺失基线，零 recovery-authority 提及）。
5. `recoveryFor` 的 `sideEffectKnown`／`reason` 仍按既有行为读 `inputRef.recovery` 展示字段（门控面已全部权威化；展示元数据的权威化不在本缺陷范围，既有登记不变）。
6. `interrupted`（`backend_restart`）面在完整 I 无 producer（全树零写入点），本轮未触；hold 来源条目（`backup_restore` 等）的条目绑定属 hold 服务写域，未触。

## 6. 门禁与边界

- 修复树：`node --check` 4 文件 exit 0；`npm ci --ignore-scripts` exit 0；`typecheck` exit 0；`check:docs` exit 0（21 文件 513 链接）；`check:structure` 3 违反＝该树自身基线（§5.4）。
- 本分支：`npm ci --ignore-scripts` exit 0；`typecheck` exit 0；`check:docs` exit 0（21 文件 519 链接，含本记录）；`check:structure` 较登记基线的增量恰为本记录已登记的候选树 5 条 `[ref.missing]`（§0），无行为／依赖类违反。
- 未跑（按派工边界）：聚合套件、完整 gate、19 旅程、`cargo test`、真实模型；HTTP 面限 handler 层（无真实 Pi）。
- 原始证据（gitignored `build/mayne24-recovery-authority-fix/`）：`evidence/green-final.tap`、`red-final.tap`、`recovery-suite-fixed.tap`、`recovery-suite-baseline.tap`、门禁日志、`fix-b4aea55.patch`、`SHA256SUMS.txt`——随评论附件交付摘要。独立修复独审待协调层另派，作者不自签；MAYNE-24 保持 `in_progress`。
