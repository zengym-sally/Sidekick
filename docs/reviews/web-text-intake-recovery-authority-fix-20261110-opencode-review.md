# 恢复条目／回执权威链路修复候选 b4aea55 独审（OpenCode，2026-11-10）

> 派工来源：评论 `01a1c292`（协调层锁定候选 `b4aea55d34c4cda8228d064eb5ac4ba425bd2d5e` 送审，暂不整体接收；「你未写两后端文件，请与补线并行独审锁定 `b4aea55` 四文件及回归：沿 `01a1c26d` 契约核当前条目／attempt 精确绑定、缺失或多条权威行的拒绝、同事务 CAS／处置／结果／事件回滚、伪造 inputRef 隔离及 async wire 调用闭包；特别逐源核 `verifiable ⇔ provable_readonly=0` 的依据。必要独立复跑／定向反控，分别报告服务层与 handler 证据，当前缺 ACK 接线明确不准整体放行；后继差分另锁定，不静默替换受审版。F1/W 目前只证明两树同失败，尚不能凭此认定本机时序已归因，保留未决。仅新增本人 `docs/reviews/web-text-intake-recovery-authority-fix-*-opencode-review.md`／build 附件，不改候选或 package」）。作者 ZCode 交付评论 `01a1c28c`；修复契约基线 `01a1c26d`。本审者未写两生产文件。

## 0. 结论

**源码面：通过（限本候选四文件与 `01a1c26d` 契约的五个判据面，六条登记项随录）。独立复跑：自建二进制 25/25 绿（服务层 A/B/C/D ＋ handler H 分层成立）；定向反控 6/6，其中 CC1d 在真实 HTTP 上实证暂存路径完整 ACK 仍 400 且零发布——ACK 接线缺口确如协调层所锁，整体明确不放行。F1/W 按派工保留未决，本审不复跑、不归因。后继差分须另锁定另审，不得静默替换本受审版。MAYNE-24 保持 `in_progress`。**

身份：候选 `b4aea55`／tree `73de1b46`／父 `cd085883`（精确基线）逐项复核一致；整提交恰四文件，与协调登记吻合——`server/lib/task-service.mjs` blob `1ada87c1` **+130/−19**（sha256 `d740c642…343b`）、`server/lib/text-intake-service.mjs` blob `79bf0a71` **+40/−8**（sha256 `1ca63cd3…795`）、`tests/unit/web-text-intake-recovery-authority.test.mjs` blob `4b1093e1` +422/−0（sha256 `636ac067…bc12`，与作者登记「同测试字节 636ac067…」逐字节同值）、`tests/fixtures/web-text-intake/recovery-authority-instance.mjs` blob `063659e1` +245/−0（sha256 `52fc79bd…4a0`）。测试／夹具 blob 与作者自述任务分支增量（`4b1093e1`／`063659e1`）完全一致。受审树内冻结契约 `docs/engineering/web-api-contract.md` sha256 复算＝`61863271…f58d`（W0 冻结钉值精确命中）；schema／守卫／package 零字节（四文件 diff 即全部改动）。

## 1. 判据一：当前条目／attempt 精确绑定 ✓

- **条目绑定**：`currentRecoveryItem`（task-service :384）按 `task_id` 取 `rowid DESC LIMIT 1`——语义是「该任务**当前**的权威条目」。§12:389 钉定「每个 `needs_review` 任务对应一行；任务 `recovery.itemId`/`itemVersion` 指向此行；两个 resolve 入口共用该版本」。候选把两个 resolve 入口的 CAS 源从 `inputRef.recovery.itemVersion ?? 1`（业务流零写入的客户端镜像）改为该权威行，并保证 `resolve` 处置写 `item_id=? AND version=? AND verification_state='pending'`（同 itemId 绑定）——读侧与写侧绑同一行，无跨行漂移。
- **attempt 绑定**：`recoveryReceipts`（:408）以「最新 attempt（`started_at DESC, rowid DESC`）」的 `side_effect_receipts` 为回执台账。needs_review 停靠期间最新 attempt 即受审 attempt；resume 提交后任务转 `queued`、调度器 claim 才生成新 attempt 行，期间任务不在 needs_review，`recoveryFor` 早退返回 null——回执暴露窗口与受审 attempt 一一对应。跨 attempt 隔离是**结构性**的（WHERE 绑定 attempt_id），不是过滤；B9 绿例实证：第二集回执为空、条目为新行 v1，旧 attempt 回执不再闸门。
- **§12 生产者闭合**：候选为 `markNeedsReview` 补条目 INSERT（:1058，与任务迁移＋事件同事务）。至此五处 `needs_review` 生产者（`confirmExit` !exited :1259、`markNeedsReview` 两变体 :1041/:1044、`confirmExtractExit` !exited、`confirmReviseExit`（委托）、`TaskRecovery.classify` running 分支）**全部**同事务插入 pending 条目——§12「每个 needs_review 任务对应一行」的不变量在所有入口成立。基线缺口（`failure_unknown_side_effect` 任务无条目可 CAS、`recoveryFor` 造 `?? 1`）由此闭合；CC 层面核实 `markNeedsReview(exited:true)` 的调用方 `maybeAutoRetry` 有 `state==='failed'` 读时前置，单集单插。

## 2. 判据二：缺失／多条权威行的处置 ✓／登记项

- **缺失 → 可见拒绝 ✓**：条目行不存在时两入口同答 `state_conflict('恢复条目缺失，无法处置。')`（task-service :693、text-intake :1329），不造版本、不放行；`recoveryFor` 对 `RECOVERY_ITEM_CAUSES` 九 cause 缺行时**不造** `itemVersion`（缺席成员即可见信号），与冻结 §3.5「客户端不得造值」一致。A1（注入 v2 后 wire 读 2）、B3（陈旧 409 零写入）、B4（真版本放行）绿例承载。
- **已处置 → 409 ✓**：`verification_state !== 'pending'` 前置拒绝＋事务内条件 UPDATE 双保险（B8 绿例；连续处置答 `state_conflict`）。
- **多条权威行 → 最新行绑定，无歧义拒绝（登记项 C-2，见 §6）**：DDL `001_web_backend.sql` 对 `recovery_items` 无 task 唯一约束（按集多行是设计形态），候选以 `rowid DESC LIMIT 1` 取最新、不检测「同任务多条 pending」的歧义态。CC2 反控（标注注入第二条 pending 行）实证：`expectedVersion=1` 直接对**最新行**放行并处置，另一 pending 行**永久悬挂**，无任何歧义信号。结合 §6-C-2 的并发双插 race，该不变量靠生产者守卫而非入口拒绝兜底——登记为风险面，非本候选回归（见 §6 分级）。

## 3. 判据三：同事务 CAS／处置／结果／事件回滚 ✓

- **普通 resolve**（:736–767）：`[任务迁移 UPDATE（version+1，绑读时 version/state/exit 三前提，expectChanges:1）, dispositionOp（version+1＋verification_state/decision/decided_by/decided_at，`WHERE item_id=? AND version=? AND verification_state='pending'`，expectChanges:1）, closeAttemptOp?, eventOp]` 单事务提交，`conflictCode:'state_conflict'`。`transact`（:206）把适配器 `WEB_BACKEND_CONDITION_FAILED` 映射为调用方冲突码并**整批回滚**——B3/B5 绿例断言零版本推进、零幻影事件、条目 untouched、候选保持 staged；D2 并发双 resolve 实证恰一胜者、败者整批回滚（事件计数 +1、处置恰一次）。
- **暂存 resume**（text-intake :1345–1386）：任务终态 UPDATE＋事件＋候选发布（succeeded→pending / failed→DELETE staged）＋attempt 收尾＋dispositionOp 同事务——被拒 resume 在任何 op 执行前抛出，绿例 C1/C3 断言候选保持 staged、零发布；C2/C4 断言放行时条目与任务同事务推进（v3/v2＋审计列）。暂存原结局语义、attempt 归属门（现开 attempt 必须是所读 attempt）原样保留。
- **回执闸门时点**：两入口的回执读取/校验都在事务前的显式拒绝段——停靠态无并发回执写入方（attempt 已停/收尾），TOCTOU 面由条目条件 UPDATE 兜底；并发处置落空时整批回滚答 409。语义自洽。

## 4. 判据四：伪造 inputRef 隔离 ✓

- 版本与回执两条权威链路**不再读** `inputRef.recovery`：CAS 读权威行、ACK 覆盖校验读权威台账；`inputRef` 仅剩 `cause` 兜底（`failure.cause` 优先）、`sideEffectKnown`/`reason` 两展示字段。夹具 `parkTask({recoveryMirror})` 走**真实原始任务入口**提交任意 `input.recovery`（客户端可控通道的实证），A4/B7 绿例：镜像 `itemVersion:999` 与伪造回执 id 对 wire 事实、CAS、ACK 闸门三面全部无效；测试注释如实登记 B7 在基线「因错而绿」的形态（999 拒、1 会过）。
- **async wire 调用闭包 ✓**：`wireFrom` 变 async 后，直接调用方仅 `listTasks`（:576，已改 `await`）与 `toWire`（:291，async 返回自动展平）；`toWire` 在基线 `cd08588` 已是 async（:268），`http-server` 全部既有 `await this.taskService.*` 不变即正确；`recoveryFor`/`currentRecoveryItem`/`recoveryReceipts` 无服务层外调用方；调度器/SSE 帧面不触 `wireFrom`。`node --check` 4/4；25 面含真实 HTTP 全绿即闭包行为的运行时证明。登记一笔性能注记（见 §6-C-6）：额外两查询仅发生在 `interrupted`/`needs_review` 任务的 wire 构造，早退守卫使活跃态零增量。

## 5. 判据五：`verifiable ⇔ provable_readonly=0` 逐源依据 ✓（映射成立；假值侧为推导无样例钉定，随录）

逐源核得四层依据，映射与全部既有语义一致：

1. **契约 §12:386**（行 :386）：`provable_readonly=false` 的调用存在即「无法证明 `proven_safe`」——即副作用可能已落地、需人工核对的回执全集。
2. **契约 §3.5 cause 表 :131**：`failure_unknown_side_effect` 的成因定义就是「台账存在 `provable_readonly=false` 的调用且失败点在其之后」；§4.5:198：「`acknowledgedReceipts` 必须覆盖 `recovery.receipts` 中全部 `verifiable=true` 条目，否则 400」。两句合读：需 ACK 的集合＝副作用不可排除安全的集合＝`provable_readonly=false` ⇒ wire `verifiable=true`；`provable_readonly=1`（显式证明只读）的调用不可能落地副作用 ⇒ 无需 ACK ⇒ `verifiable=false`。
3. **冻结样例**：`task-needs-review.json` 回执元素 `{receiptId,kind:'lark_message_send',externalRef,recordedAt,verifiable:true}`——send 类（非只读）样例值恰为 `verifiable:true`；元素键集与候选 wire 映射逐键一致（`attemptId`/`provable_readonly` 不上线，`recordedAt` 为 ISO 毫秒串，`Date.toISOString` 精确复现样例形状）。**边界**：六处冻结样例的 `verifiable` 全部为 `true`，无 `false` 样例——假值侧（provable_readonly=1 ⇒ false）靠上述推导与内部一致性成立，不是样例钉定。
4. **代码内既有消费方**：`recordReceipt`（:1087，`provableReadonly ? 1 : 0`，注释「only ever true when the fact itself is an explicitly read-only operation」）与既有 `hasNonReadonlyReceipts`（:1108，`provable_readonly=0` 即不可证明安全）——候选映射与该列**唯一既有权威侧语义**对齐，非新造规则。作者自述「§12 字段语义溯源，NOT a new rule」与源码相符，本审签可。

## 6. 独立复跑与定向反控（服务层／handler 分层报告）

**复跑环境**：本审自有 detached worktree（`/private/tmp/.../review-b4aea55`，b4aea55 精确检出，本地不推）；存储二进制**由本审从受审树 src-tauri 自行构建**（cargo 1.99.1/rustc `58cf8f9c3`，release `--bin web-backend-storage`），sha256 `5311ffa3…232bd`（2647984 B）——与作者登记值、本审前轮（29305da 树）自建值**三方逐字节同值**（src-tauri 谱系零差异的独立再证）；`build/s0-runtime` 自本机源树只读复制（tauri-build 资源存在性校验，对存储二进制惰性）。Node v24.20.0。夹具每面独立真实实例（真实存储适配器进程＋真实服务），业务路径到位（submit→claim→真实 verifiable 回执→stage→`confirmExtractExit(exited:false)` 停靠→真实 `recover()` 回收），唯一状态注入＝权威面标注 `UPDATE recovery_items SET version=?`，全程不经 `inputRef`。

**服务层证据（A1–A4／B1–B9／C1–C5／D1–D2）**：本审独立复跑 **25/25 绿、exit 0、441.7ms**（`node --test --test-reporter=tap`，原始 TAP 随附件 `green-final.tap`）——§1–§5 全部判据在运行时成立，每面断言含零写入（版本／事件计数／候选 status）与条目审计列核验。

**handler 层证据（H1–H5＋CC1b/c/d）**：真实 `HttpServer`＋真实配对/会话/CSRF＋真实服务（无调度器/worker/真实 Pi），同轮绿。CC 反控（本审自写探针，6/6、172.8ms，观察值随附件）：

| 面 | 注入 | 实测 |
|---|---|---|
| CC1a（服务层） | ACK 传**字符串**（含正确 receiptId） | **放行**，条目 disposed——`.includes` 子串语义 |
| CC1b（HTTP） | `acknowledgedReceipts: 5`（数字） | **500 `internal_error`**（TypeError 非 ServiceError → :60 `?? 500`） |
| CC1c（HTTP） | `acknowledgedReceipts: {receiptId:'x'}`（对象） | **500 `internal_error`** |
| CC1d（HTTP） | 暂存路径**正确完整 ACK** | **400 `validation_failed`，候选保持 staged**——:817 未转发第 4 参，ACK 永不可达服务层 |
| CC2（服务层） | 标注注入第二条 pending 行（同 v1） | `expectedVersion=1` **放行**并处置最新行；原 pending 行悬挂，零歧义信号 |
| CC3（服务层） | 集一成功请求（v1＋旧 ACK id）原样重放到集二 | **放行**，集二条目被处置（集级版本从 1 重起） |

### 登记发现（分级）

- **C-1〔阻塞整体，已由协调层锁定；归属后继接线差分〕ACK 接线缺口**：`http-server.mjs:817` 暂存分支调用 `commitStagedResume(taskId, current.attemptId, body.expectedVersion)` 未传第 4 参；服务层闸门就绪（C4 绿）但 HTTP 完整 ACK 面**不可构造**（CC1d 直证 400＋零发布）。普通路径 `:821-825` 已正确转发 `body.acknowledgedReceipts ?? []`（H3/H4 承载）。本审独立复核与协调层判定一致：**整体不放行**。
- **C-2〔本候选新引风险的登记项，advisory〕多条 pending 权威行无歧义拒绝＋并发双插窗口**：入口级 latest-wins（§2）叠加 `markNeedsReview(exited:true)` 变体任务 UPDATE 无状态守卫（:1041，`WHERE task_id=?` 仅绑 id；该未守卫形状系基线既有，基线无 INSERT 故幂等，候选使其**非幂等**）——两个并发 `maybeAutoRetry` 同读 `failed` 可双插 pending 行，此后一行为悬挂、`resolve` 仍可处置。触发窗口窄（单飞调度路径＋状态前置），契约 CAS 本身不受影响；建议后继窄修（入口歧义检测或该变体补状态守卫），**不在本候选内代签**。
- **C-3〔边界登记，observation〕非法 ACK 形状**：非数组 ACK 走 `.includes`——数字/对象 → TypeError → **500**（应为 400 校验语义，对照 `settingsWrite:452` 的显式形状校验）；字符串 → 子串语义放行（子串需含完整 32 位 id，实际等同正确 ACK，无提权）。派工已把「非法 ACK 形状也须按已有校验语义处理」钉入后继接线范围——本审实测值即该差分的验收基线。随录：`expectedVersion` 非整数在服务层答 `version_conflict` 而非 400（基线同语义，非回归）。
- **C-4〔契约内设计边界，observation〕跨集陈旧重放窗口**：条目版本按集从 1 起（§12:389「version(从 1 起，每次变更 +1)」），resolve 请求形状无集/attempt 身份令牌（契约 :150 只钉 `{expectedVersion, decision, acknowledgedReceipts}`）——CC3 实证集一成功请求可原样重放处置集二。这是**契约自身 CAS 设计的残余窗口**，候选实现与契约字面一致；非本候选缺陷，登记供契约演进参考。
- **C-5〔预存未闭合面，非本候选范围〕hold 系 cause 的 wire 补充字段**：§3.5 cause 表钉定 `backup_restore`/`root_activation`/`root_import` 另带 `holdId`/`itemId`（root_activation 另 `historyContinuity`）；候选 `recoveryFor` 暴露了九 cause 集 `itemVersion`（:121 需求，基线为镜像 `?? 1` 的改进）但未补 hold 三字段——基线同缺，候选未回退亦未扩权；hold 报告面（§8.3）本切片未实施，遗留按登记。
- **C-6〔注记〕性能**：`wireFrom` 异步化后，`interrupted`/`needs_review` 任务的每次 wire 构造多 2 次存储 IPC 查询（活跃/终态早退零增量）；列表/快照放大量受分页上限约束，合成规模无感（441ms/25 实例），未做规模验证。

## 7. F1/W 未决

按派工原文保留：F1（业务 resolve 后权威条目不推进）与 W（settled envelope 缺失）在修复树与基线树的既有套件中「同断言同数值失败」只证明**两树同失败**，不构成本机时序归因，也不在本审复跑范围——本审既未运行该邻域套件，也未对失败模式做任何归因陈述。该面保持未决，不因本候选签发而变化。

## 8. 边界与未跑

本审只跑：候选四文件 `node --check` 4/4、独立二进制构建（48.2s）、新回归 25 面 TAP、CC 反控 6 面。**未跑**（按派工边界）：完整基线红矩阵（作者红证 20 fail/5 pass 按其登记采信形态保留，本审不重复）、既有 recovery 邻域套件（PC2/M1c——F1/W 未决面，不归因）、聚合、构建、19 旅程、完整 gate、真实模型、cargo test。身份/核查输出经实际附件交付；原始证据 `build/mayne24-recovery-authority-fix-review/`（gitignored）。后继 ACK 接线差分交付时**须另锁定新 SHA/tree 送独立复审**，不得以本记录覆盖新差分；本记录只签 `b4aea55` 精确字节。

## 9. 复核清单（派工逐项）

| 派工判据 | 结果 | 承载 |
|---|---|---|
| 当前条目／attempt 精确绑定 | ✓ | §1；A1/B9 绿例；blob/行号实读 |
| 缺失权威行拒绝 | ✓ | §2；B3/CC 面；无造值 |
| 多条权威行 | 最新行绑定，无歧义拒绝 | §2/§6 C-2；CC2 实测 |
| 同事务 CAS／处置／结果／事件回滚 | ✓ | §3；B3/B5/C1/C3/D2 |
| 伪造 inputRef 隔离 | ✓ | §4；A4/B7（真实提交通道） |
| async wire 调用闭包 | ✓ | §4；调用方全量核＋运行时 25/25 |
| `verifiable ⇔ provable_readonly=0` 逐源 | ✓（假值侧推导，随录边界） | §5 四层依据 |
| 服务层／handler 证据分别报告 | ✓ | §6 表；A–D vs H/CC |
| 独立复跑／定向反控 | ✓ | 自建二进制三方同值＋6 反控 |
| 缺 ACK 接线 → 不整体放行 | 确认 | CC1d 直证；C-1 |
| F1/W 保留未决 | 遵守 | §7 |
| 只新增本人记录／build 附件 | ✓ | 恰 1 文档提交；候选/package 零字节 |
