# Web 文本整理候选操作幂等存储裁定（2026-11-08/09）

> **性质**：只读技术裁定。裁定者 OpenCode（未参与 I/II/III 的实现写入；本项 III 工程候选作者，本轮写入范围仅本文件与 `build/web-text-intake-storage-decision/`）。由队长 Codex 在评论 `01a1bbe0-5771-7b32-87f6-a2127673b07e`（2026-11-08）中派发，回应候选 I（Claude，`b057f0e28708abfcadf6c3b092bc86262959ef60`）交付记录 §7 提出的 M-4 裁定请求。本轮**不是**集成派发，不跑完整门禁。
>
> **结论先行**：候选 I 提出的两个选项**均不可接受**；在精确 001–003 冻结 DDL、15 表写入白名单、「重放先于守卫」「候选提示不写 task_events」的约束下，**不存在**语义一致且跨重启/并发可用的既有存储方案——一条**最小新增表**的后续迁移（004）是必要的。可审提案见 §8（精确字节哈希 `5de175b6…c5bf`），本轮不创建生产迁移文件、不实现方案；提案须先经未参与者复核，再由队长判断是否需要新增 owner 授权。

## 1. 裁定范围与输入

### 1.1 裁定的问题（候选 I M-4 原文诉求）

`editCandidate`/`discardCandidate`/`applyPreview` 三个候选直改操作要满足冻结契约的幂等语义（同 `operationId` 重放先于状态/版本守卫），需要持久的 operationId→（规范输入、目标对象）映射；候选 I 声明 003 中无可用列/表，请求在两个「最小差异」中裁定：(a) `candidates` 增 `last_operation_id` 列；(b) 授权复用 `sign_off_batches` 作通用操作台账。

### 1.2 范围界定

- **在范围内**：edit/discard/applyPreview 三个**不产生任务、不产生事项**的候选直改操作的幂等存储。
- **不在范围内**（已有既有方案，本轮复核确认，无需裁定）：`POST /api/tasks` 与 `/api/candidates/{id}/revisions`（提交任务类）由冻结 `tasks.operation_id UNIQUE` + `input_ref.canonical` 覆盖（候选 I `task-service.mjs::submit` 已实现重放/异体分支）；批量签收由 `sign_off_batches` + `sign_off:` 派生行键覆盖（P1 §5.1）；同指纹来源去重由 `text_sources.fingerprint UNIQUE` 覆盖。
- 约束（按派发原文，全部接受为前提）：精确 001–003 字节冻结；15 表写入白名单；P1「重放先于守卫」；候选事件不写 `task_events`。

### 1.3 输入与哈希复核（本轮独立复算）

| 输入 | 来源 | SHA-256（本轮复算） |
|---|---|---|
| 001 | 本树 `src-tauri/migrations/web-backend/001_web_backend.sql` | `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` ＝登记冻结值 |
| 002 | 本树 `src-tauri/migrations/web-backend/002_manual_items.sql` | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` ＝登记冻结值 |
| 003 | 授权记录 §5.1 原样提取，**并**与 `git show b057f0e:src-tauri/migrations/web-backend/003_text_intake.sql` 双源比对 | 两源逐字节相同，均 `8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870` ＝冻结值 |
| P1 契约 | 本树 `docs/engineering/web-text-intake-contract.md`；与已审定稿 `b190f7c6`（`5982c062…fe7b`）diff 恰为 III 追加的一行实施登记 blockquote，业务字节零改动 | `673f5cc4…76e3`（含登记行） |
| web-api/1 | 本树 `docs/engineering/web-api-contract.md` | `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` ＝冻结值 |
| 手工事项契约 | 本树 `docs/engineering/web-manual-items-contract.md`（含附录 A.2 重放语义） | `08afea02…ad3c`（W1 集成登记态） |
| 候选 I 实现 | `git show b057f0e:server/lib/{text-intake-service,task-service,manual-items-service}.mjs`、`src-tauri/src/store/web_backend_store.rs`（只读取证） | `BUSINESS_TABLES: [&str; 15]` 确认 |

## 2. 冻结契约要求（判定基准）

以下条文构成本裁定的判据，全部为已审冻结内容：

- **R1 重放**：web-api/1 §3.3「同 ID + 同规范输入 → 返回既有任务当前权威状态（200，`replayed:true`）」；P1 §5.1 约定「同 `operationId` 且同规范输入（**动作＋目标＋input＋expectedVersion**）才重放；**重放先于状态/版本守卫**，返回同一对象当前权威状态（沿用手工事项契约附录 A.2）」；手工事项契约 §6「重放优先于状态守卫（M1）……状态守卫不得前置于幂等重放」。
- **R2 异体**：web-api/1 §3.3「同 ID + 不同规范输入 → 409 `idempotency_conflict`」。
- **R3 跨用**：手工事项契约附录 A.2「跨动作或跨 `itemId` 复用已成功 `operationId` 返回 409 `idempotency_conflict`，不写任何新事件」——P1 明示沿用。对候选操作即：跨动作、跨候选目标复用一律 409。**这要求 operationId 键的全局（跨候选）唯一可见性**，不是单候选局部可见性。
- **R4 不消耗**：web-api/1 §3.3「同 ID 重放不消耗版本」——重放路径只读。
- **R5 只记成功**：A.2 措辞「已成功 `operationId`」＋web-api/1 §2「校验失败……请求未接收：不落库……不绑定幂等键」——守卫/校验拒绝不写台账。
- **R6 持久**：幂等键状态在 SQLite（web-api/1 §6「SSE 留存短期有界，权威状态在 SQLite」；P2 T-8 与 II 验收矩阵明列「操作ID重放/异体与版本冲突」）——跨重启可用是验收内需求，内存 Map 不合格。
- **R7 并发**：手工事项/签收既有先例均以「同一事务提交，失败整体回滚」＋行级 UNIQUE 归并并发（P1 §5.1「并发下由 `UNIQUE` 冲突归并」）——并发仲裁必须是数据库层约束，不能是应用层先读后写。

## 3. 否定选项 (a)：`candidates.last_operation_id` 单列

单列在结构上无法同时满足 R1/R2/R3；这不是实现质量问题，而是信息容量问题。反例 `ce1-last-operation-single-column.mjs`（本轮实跑，判定 CONFIRMED）：

- **F1 旧请求重放必失效**：列只存**最近一个** operationId。op1（v1→2）、op2（v2→3）之后重放 op1：存储值 `op_2 ≠ op_1`，重放判定必然落空 → 落入版本守卫 → 409 `version_conflict`，而 R1 要求 200 `replayed:true`＋当前权威态。一个候选上有 N 个已提交操作，则任意时刻有 N−1 个 operationId 不可重放。ce1 实测 `[409,'version_conflict']`，违反 R1。
- **F2 同键异体不可判定**：即使对当前存储的那个 id，规范输入字节也无处可存——判定函数只有 `{stored_id, incoming}` 两个输入。ce1 实测两种可行决策函数**各违反一条**：id 命中即按重放 → 异体请求答 200，违反 R2；id 命中即按冲突 → 合法重放答 409，违反 R1。**不存在**满足两条的决策函数。
- **F3 跨候选复用不可见**：列挂在目标行上。op 在候选 A 上成功后复用于候选 B：B 行的列是 NULL，ce1 实测该请求按新操作执行（200），违反 R3（要求 409）。跨候选可见性要求键**全局**唯一，单候选列结构性做不到。
- **附加上不利**：003 逐字节冻结，加列本身就需要一次 004 级迁移（`ALTER TABLE` 或重建）——**成本与正确方案相同而能力严格更弱**，被正确方案直接支配（dominated）。

**裁定：拒绝 (a)。**

## 4. 「无台账的状态收敛」替代方案同样不可行

审查是否存在**完全不用记录历史**的方案（例如：discard 重放时发现已是 `discarded` 就答 200）。不可行的原因是信息论层面的：

重放请求与「全新请求」可以**逐字节相同**，而契约要求它们得到**不同响应**。典型对照（候选 edit）：op1 已在 v1→v2 提交；此后 op2 又把候选改到 v3。

- op1 的**重放**（同 ID 同规范输入，expectedVersion=1）→ R1 要求 **200** `replayed:true`＋当前态 v3；
- 一个**新的** edit 请求（不同 operationId，expectedVersion=1）→ 守卫要求 **409** `version_conflict`。

两个请求字节不同（operationId 不同），但**当前状态完全相同**（同一候选、同一 version、同一 status）；反之 discard 场景里两个请求可以完全同字节而要求不同响应。当前状态是**抹去历史**的投影：`(state, version)` 的值域无法区分「这个 operationId 曾被应用」与「从未见过」。区分二者所必需的信息**只存在于历史中**，因此持久台账是**必要条件**，不是实现选择。这也直接否定 `last_operation_id` 之外的一切「单值/无键」方案。

## 5. 既有 15 表逐表审计（必要性证明）

反例 `ce4-frozen-tables-audit.mjs`：加载**真实冻结字节**（三哈希逐一复核，见 §1.3）到 `node:sqlite` 内存库（`foreign_keys=ON`），按序应用 001→002→003（schema_meta=3 达成），然后对全部 15 张授权业务表逐一尝试落一条候选 edit 台账（operationId＋candidate_id＋规范请求＋时点）。结果 **15/15 全部被拒**（本轮实跑，判定 CONFIRMED）：

| 表 | 结果 | 依据 |
|---|---|---|
| `candidates` | **DDL 拒绝** | 无 operation 列（`no such column`） |
| `manual_item_events` | **DDL 拒绝** | action CHECK 仅 `create/update/complete/reopen/delete/link`；UNIQUE 命名空间已由 `sign_off:` 派生键占用；还需伪造 item_id |
| `manual_item_sources` | **DDL 拒绝** | FK item_id＋association 枚举：纯 edit/discard 不存在事项关联；UNIQUE 命名空间保留给 `sign_off:` 派生键 |
| `task_events` | **DDL 拒绝** | `object_type CHECK` 仅 `task/setting/workspace/recovery_hold`——冻结 DDL 本身禁止候选行；且被派发约束明文排除 |
| `candidate_previews` | **DDL 拒绝** | FK `run_id`→`tasks` 仅收伪造任务行；即便伪造，draft_json 无 operation 键、无 UNIQUE 仲裁 |
| `tasks` | 仅伪造可写 | 只能造**假终态任务**：污染队列/FIFO（submit_seq）、任务列表、SSE 语义与重启恢复扫描 |
| `task_attempts` | 仅伪造可写 | attempt 是运行时退出核实状态（pid/exit），台账不是 attempt |
| `task_result_payloads` | 仅伪造可写 | 分段结果字节按 `result://<attemptId>/<name>` 寻址、经退出确认发布；塞台账破坏结果暂存 |
| `side_effect_receipts` | 仅伪造可写 | 回执记录 attempt 的**外部**副作用；本地候选变更不是回执 |
| `instance_epochs` | 破坏性可写 | epoch 是实例身份（`inst_<12hex>`），驱动 stream.reset fencing 与重启簿记 |
| `recovery_holds` | 仅伪造可写 | hold 会全局暂停提交/调度/定时器——行为级破坏 |
| `recovery_items` | 仅伪造可写 | 需要整条伪造链（hold+task） |
| `text_sources` | 破坏性可写 | fingerprint 是提交去重 UNIQUE 键，覆写即静默破坏去重 |
| `sign_off_batches` | 仅伪造可写 | 只能以**假签收批次**落行——见 §6，语义专属 |
| `manual_items` | 仅伪造可写 | 只能造不存在的事项，污染事项域 |

「某 TEXT/JSON 列能塞数据」正是上面 10 张「仅伪造/破坏性可写」表的陷阱：机械可写≠兼容。**裁定：既有存储无方案，新增 schema 是必要的。**

## 6. 否定选项 (b)：泛化 `sign_off_batches`

反例 `ce3-sign-off-reuse.mjs`（判定 CONFIRMED）。三个独立否定依据：

- **G1 共享主键命名空间**：泛化后批次键与候选直改键共用一张表的 `operation_id` PK。两个键族都取自同一 `op_<32hex>` 格式（web-api/1 §2），跨族同串是**合法输入下的现实冲突**，不是畸形输入。ce3 实测：批次 `op_K` 在表后，同串 edit 落行撞 `UNIQUE` 被拒——一个合法操作无故失败；反之 edit 先到则合法批次撞墙。且「先占者应答后到者的重放查询」会把另一键族的重放判给错误语义。
- **G2 无判别列**：冻结表没有 kind/action 列；批次行与 edit 行在**schema 层完全同形**，动作只存在于 `request_json` 字节内——ce3 实测两行列结构逐一相同、判定必须解析载荷。这正是派发禁止的「把某 TEXT 列能塞数据当兼容证据」的形态：约定住在数据里，无 schema 背书，后续写入可无声漂移。
- **G3 冻结契约绑定**：003 DDL 注释（`8e4e3159…7870` 字节）明文「Batch sign-off ledger: one row per client batch operationId, binding the canonical request and the candidate -> item ID mapping」；P1 §5.1 幂等命名空间条款明文「批次操作键为客户端 `operationId`，写入 `sign_off_batches`」。该表在该条款下是**签收专属**的存储绑定。泛化＝改已审契约的存储语义，属 owner 层级动作；且 G1/G2 表明即使修订契约它在工程上也不成立。

附带说明（避免误读）：P1 §5.1 的「不新增列／表」字样**仅**是签收命名空间条款内部的方案描述（履行 W1 §13 n2），不是对其它操作族的普适禁令；W1 契约 n2 恰恰要求签收切片「声明全局或按资源族的幂等命名空间策略」——候选直改操作正是尚未被任何已审条款声明命名空间的那一族。**裁定：拒绝 (b)。**

## 7. 其余走私路径

- **JSON 列（`fields_json`/`warnings_json`）内嵌台账**：反例 `ce2-json-column-smuggling.mjs`（判定 CONFIRMED）。D1：`fields_json` 是 GET /api/candidates 的权威载荷，内嵌台账字节直接泄入 wire 契约（ce2 实测客户端可见字段集被污染）。D2：容器列无 UNIQUE 仲裁，应用层「先读后判」在异步间隙交织后，同键并发请求无法归并——ce2 实测败者被判 409 `version_conflict`，而 R1 要求判 200 `replayed:true`。键族无 schema 背书、行内无界增长，同属 §6 G2 形态。
- **`task_events` 落候选事件**：`object_type` CHECK 冻结枚举不含 `candidate`（ce4 实测 CHECK 拒绝），且被派发约束明文排除（「候选提示不写 task_events」）。即使放宽 CHECK，task_events 是带 epoch/游标的运行时事件流（SSE 重放、重启扫描消费），不是幂等键仲裁结构——无 UNIQUE(operation_id)、无候选 FK。
- **`settings`/`schema_meta`/`sqlite_sequence`/`workspace_operations`**：settings 写面被两条精确模板锁死（timeZone；agentConcurrency INSERT/CAS），其余目标显式拒绝（授权 B 条）；schema_meta/sqlite_sequence 业务写明文拒绝；`workspace_operations`（001 line 98）是 001 期内部操作表，不在 15 表业务白名单内，按目标表守卫同样拒绝——候选 I `web_backend_store_tests.rs:193-196` 有显式越权拒绝用例（含注释「001 table but not in this slice's BUSINESS_TABLES whitelist」）。四者均不属于可选面；004 提案不触碰它们（新表走白名单扩员的授权决定）。

## 8. 提案：后续迁移 004（最小独立新增表）

> **本轮状态**：仅提案。生产路径 `src-tauri/migrations/web-backend/004_candidate_operations.sql` **未创建**；提案字节存于 `build/web-text-intake-storage-decision/004_candidate_operations.proposal.sql`。采纳前提：未参与者复核（§9）→ 队长判断是否需要新增 owner 授权。

### 8.1 提案字节与哈希

1774 字节，SHA-256 **`5de175b6f00ae40d8a1ed5272b6225dc5f98434815a1d089062ed34a7f39c5bf`**（若采纳，此值即守卫冻结目标；文件内容逐字节见 build 目录，头部含 `Status: PROPOSAL ONLY` 注释与依据指针。补件轮 2026-11-09 复算：字节未变，哈希仍为该值）。核心 DDL（示意，字节以提案文件为准）：

```sql
CREATE TABLE candidate_operations (
    operation_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    action TEXT NOT NULL CHECK (action IN ('edit','discard','apply_preview')),
    request_json TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL
);
UPDATE schema_meta SET schema_version = 4 WHERE id = 1;
```

### 8.2 设计论证（对照 §2 判据）

- **R1**：`operation_id` PK 一行一操作，重放路径先查本表（重放先于守卫），命中且 `request_json` 字节相等 → 只读返回候选**当前权威态**＋`replayed:true`，不触碰 version；不存响应快照（契约只要求当前态，签收条款明示「不返回旧对象快照」同理）。
- **R2**：命中但 `request_json` 不等 → 409 `idempotency_conflict`。规范输入字节落库，判定函数有完整输入（对照 §3 F2 的无输入困境）。
- **R3**：PK 是**全局**命名空间：跨动作（action 列＋canonical 首元素双录）、跨候选复用一律命中他族行 → 409。
- **R4/R5**：重放只读；只有**成功提交**的事务写行，守卫/校验拒绝零落库。
- **R6**：行在 SQLite，跨重启天然可用（ce5 F6 实测 close+reopen 后重放仍答 200 `replayed:true`）。
- **R7**：PK 即数据库层仲裁。服务层协议（与手工事项 A.2/签收同型）：`BEGIN IMMEDIATE` → 查本表 → 重放/409 → 过守卫 → 候选 UPDATE＋台账 INSERT **同一事务** → COMMIT；并发同键在写锁上串行，败者看到胜者已提交行走重放路径，无双应用窗（ce5 F5/F8 实测）。
- **最小性**：5 列，无快照、无 before/after（无任何已审读路径需要候选操作历史；GET /api/candidates/{id} 只回候选本体）、无冗余索引（PK 覆盖唯一授权查询路径；将来如出现按候选列操作的读端点，再按当时流程追加索引迁移）、行不可变——**这是服务层 append-only 协议性质，不是守卫级保证**：目标表守卫按**目标表**放行（授权 B 机制，`web_backend_store.rs:607` `BUSINESS_TABLES.contains`），白名单业务表上的 UPDATE/DELETE 机械上被允许；守卫层面的「仅 INSERT」精确模板只存在于 settings 两条款。协议中只存在台账 INSERT 路径（与现行 `sign_off_batches` 同型）。提案 SQL 头注释「no UPDATE and no DELETE exist in any authorized template」按此协议语义读；字节与哈希不因措辞变更（`5de175b6…c5bf` 保持，见 §10 ④⑤）。
- **FK 依赖**：候选行并非「永不删除」——staged 行在退出核实失败路径确被删除（候选 I `text-intake-service.mjs:798`，全仓唯一 `DELETE FROM candidates` 且限定 `status='staged'`）。台账行仍不可能挂在会被删的候选上：三直改操作全部守卫 `status='pending'`（`:400/:424/:488`），staged 行对它们不可达，而 pending 行没有任何删除路径。因此「FK 无需 ON DELETE 动作」的结论不变，但理由是**可达边界**（三操作的成功态只存在于 pending 行），不是「候选行只改状态不删除」。runner 与运行时连接本就 `foreign_keys=ON`（003 头部既有约定），FK 自首日生效。（初稿措辞更正见 §10 ④）

### 8.3 `request_json` 规范化定义（提案级，与既有实现同型）

存**规范请求字节**（不透明载荷，schema 不解释内容），由服务层用既有 `canonicalize`（`manual-items-service.mjs` 导出的排序键紧凑 JSON，候选 I 已 import）序列化 P1 四元组，并**完整绑定全部影响行为的字段**：

- edit：`{"action":"edit","candidateId":…,"expectedVersion":N,"input":<规范化input>,"timeReviewed":<bool>}`
- discard：`{"action":"discard","candidateId":…,"expectedVersion":N}`
- apply_preview：`{"action":"apply_preview","candidateId":…,"runId":…,"expectedVersion":N}`

与 P1 §5.1「动作＋目标＋input＋expectedVersion」一致。**绑定是必要的，不是可省略的**（本段为对初稿前提的更正，见下）：冻结契约 §5.1 端点表中 `timeReviewed` 是 `POST /api/candidates/{id}/edits` 请求体的一级字段，而「时间未核对→400 `time_review_required`」只列在 `/api/sign-offs`；契约明文为「`unresolved` 时签收须 `timeReviewed=true`」，候选 I 实现同型（`draft.unresolved && !timeReviewed` 才 400）。因此**时间已解析或无时间歧义的候选上 `timeReviewed=false` 是合法可达输入**——`timeReviewed` 与预览目标 `runId` 任一字节在同名键下变化都必须判 409 `idempotency_conflict`（ce6 B1–B5 实证，含「精确同字节仍 200 `replayed:true`」正控，绑定不会误拒诚实重放）；台账 schema 对载荷字节不敏感（存储层不解释内容），采纳时由 I 与独审按本节字段集对齐。

> **更正记录（2026-11-09，队长评论 `01a1bc38`）**：本节初稿曾写「候选 I 现把 `timeReviewed` 也编入 canonical 对象——因 `timeReviewed=false` 的尝试必被 400 拒绝（不落台账），可达状态内与四元组无行为分歧」。该前提**不成立**：`timeReviewed=false` 仅在候选 `unresolved` 时被 400 拒绝，已解析/无歧义候选上该输入可达，故「无行为分歧」的论证作废；结论反向收紧——`timeReviewed` 恰恰**必须**编入规范字节（ce6 B1/B3）。初稿原文保留于本更正记录，未删除。

### 8.4 采纳时的配套影响（本轮均不执行；清单按当前精确 I/II 候选核实）

| 面 | 变更 | 性质 |
|---|---|---|
| 迁移 | 新增 `004_candidate_operations.sql`（§8.1 字节）；runner 迁移清单登记第 4 项（`web_backend_schema.rs:30`）；`user_version` 3→4 由 runner 推进，schema_meta 同事务镜像由 004 内 UPDATE 完成 | 常规追加，001/002/003 字节不动 |
| 权限 | `web_backend_store.rs` `BUSINESS_TABLES` 15→16（追加 `candidate_operations`）；无新增 settings 形状模板（业务表按目标放行，现状不变）；DML 目标解析、子查询提名拒绝等全部保持 | 与本轮授权 B 同机制 |
| 守卫 | `check-structure.mjs` `IMMUTABLE_MIGRATIONS` 追加 004 精确哈希（§8.1）＋三态自测（缺失/篡改拒绝、候选落地后激活）——与 003 现行模式一致；违规说明文字中的版本枚举（001-004）同步更新 | 只追加，不放宽 |
| 测试断言 | 既有断言翻转与破测清单见 §8.4.1（R1–R8/J1–J2，含 3 个哨兵 4→5 与 10 处表计数 18→19）；回滚/故障注入语义见 §8.4.2；新增用例面见 §8.4.1 末与 §8.4.3 | 实现轮扩展 |
| 验证 | I unit：重放/异体/跨目标/跨动作/守卫不落账/重启/并发原子性；**II 的 edit/discard/applyPreview 三族幂等验收须新增**（现有 T-8 系条目只覆盖 source/task 提交两路径，不能称已覆盖，见 §8.4.3）；本提案的正控 `ce5` 即其存储层语义子集 | 聚焦先行，全门禁仍归 III 唯一集成轮 |

核实基线（2026-11-09，本轮逐项核实）：候选 I `4dfc9e9be0dcc6528e4860a18a9630852c6ad1a1`（tree `89446a4fdc7d761aca11cb15361046049364c7d0`）、候选 II `61a069b35757187174db0e92a2b9e5fd934dc520`（tree `e0a6028b95408503edb2f2c22e0fc1648117bf3d`）。行号均指这两个精确树；后续 I/II 增量若移动行号，以事实为准重新核对（逐条命令与输出见本轮 `build/web-text-intake-storage-decision/f34-verification.log`）。

#### 8.4.1 受影响断言完整清单（R1–R8 / J1–J2，含必然破测项）

**Rust（I `4dfc9e9`，`src-tauri/src/store/`）**

| # | 位置（当前行号） | 现状 | 004 后 |
|---|---|---|---|
| R1 | `web_backend_schema_tests.rs` `migration_003_preserves_rows_and_widened_check_constraints`：`schema_version` 断言值 :678、`user_version` 断言值 :685 | 3 | 4（open 自 v2 应用全部四迁移） |
| R2 | `web_backend_schema_tests.rs:228` `open_rejects_version_mirror_mismatch` 镜像哨兵 `UPDATE schema_meta SET schema_version = 4` | 4 | **5**（init 后镜像即 4，哨兵 4 不再触发 mismatch——**必然破测**） |
| R3 | `web_backend_schema_tests.rs:245` `open_rejects_too_new` 哨兵 `schema_version = 4; PRAGMA user_version = 4` | 4 | **5**（4 不再「过新」——**必然破测**） |
| R4 | `web_backend_schema_tests.rs:645` `version_rejection_leaves_database_untouched` 镜像哨兵 `schema_version = 4` | 4 | **5**（镜像 4 将与 user_version 4 相等，mismatch 不再触发——**必然破测**） |
| R5 | `web_backend_schema_tests.rs` 表计数 `table_count == 18` ×7（:97/:188/:305/:352/:425/:668/:921） | 18 | 19 |
| R6 | `web_backend_schema_tests.rs` `migration_fault_after_003_rolls_back_to_v2_and_retry_completes`（fn :865）：回滚断言 :880 `== 13`、:885/:895 `== 2`；**重试完成段**断言 :921 `== 18`、:927 `== 3` | 回滚=v2/13；重试=18/3 | **回滚断言组保持一字不改**（§8.4.2：004 落地后故障注入仍指向第 3 迁移，v2 整笔回滚期望继续成立，不得机械把 13 改 18）；重试完成段翻转 19/4 |
| R7 | `web_backend_store_tests.rs` 表计数 ×3（:50/:73/:272） | 18 | 19 |
| R8 | `web_backend_store_tests.rs` 版本字面量 ×3（:54 `user_version`、:62 `schema_version`、:238 `pragma_is_read_only_and_whitelisted` 的 `user_version`） | 3 | 4 |

- **常量引用点自动适配**：`web_backend_schema.rs:13` `SCHEMA_VERSION` 3→4（另 :30 迁移清单追加 `M::up(SQL_004)`）后，`web_backend_schema_tests.rs` 引用该常量的断言（:118/:132/:316/:358/:431）随动，无字面量编辑。
- **核实后确认不受影响**：:345 `== 0`（故障后空库 `user_version`）、:380/:397/:404 `== 1`（v1 回滚）、:885/:895 `== 2`（v2 回滚）、:377/:394 `== 11`（v1 库表数）、:182 `== 0`（init 后辅助表 `_web_backend_seq_high_water` 不存在）、:342 `== 0`（故障回滚后空库表数）、:419 `== 0`（v1 回滚库无 `manual_items`）；`web_backend_store_tests.rs:195/:247` 的 `PRAGMA user_version = 3` 字符串是越权拒绝探针（拒绝因 pragma 写不在白名单，与取值无关）；II 其余三套件（queue/controlled-model/static）无 schema/表计数断言；`tests/unit/web-manual-items.test.mjs` 合成 `schema_meta=1` 夹具、native/today-advisor 的 `schemaVersion` 协议命名空间、`tests/unit/web-text-intake.test.mjs` 均无关。
- **相对评审清单的精化**：①`web_backend_store_tests.rs` 版本字面量实为 **3 处**（:54/:62/:238）——评审 §4.7 R8 列 :53/:59，未含 :238（`pragma_is_read_only_and_whitelisted`，初版 b057f0e 即已存在）；②J1/J2 行号按当前 II 树更新为 :82/:255（评审稿为 :81/:253）。
- **新增用例面（非既有断言翻转）**：store 层 16 表正面/负面（`candidate_operations` INSERT 放行、白名单外仍拒、settings 模板不变）；schema 层第四迁移 FK/镜像/高水位；runner 故障注入扩展（§8.4.2）。

**JS（II `61a069b`，冻结写入面）**

| # | 位置（当前行号） | 现状 | 004 后 |
|---|---|---|---|
| J1 | `tests/integration/web-manual-items-http.test.mjs:82`（「A-9/schema」用例 :81；II 基座现状为 2，I 的 003 集成后按已派窄授权放宽为 3） | 2 | 4 |
| J2 | `tests/integration/web-text-intake-http.test.mjs:255`（schema 前置用例 :249，断言信息「migration 003 must advance schema_meta to 3」） | 3 | 4（断言信息同步改写） |

#### 8.4.2 回滚预期与第四迁移故障注入（按测试起始版本分别定义）

机制依据（逐字核实）：runner 为 `rusqlite_migration` 2.5.0（`src-tauri/Cargo.lock` 冻结版本）；其 `goto_up` 把一次 `to_latest` 的**全部待应用迁移放进同一事务**（crate `src/lib.rs` :615-651：单个 `conn.transaction()` 内循环应用、末尾统一 `set_user_version`＋commit；crate 文档明言「The migrations are applied atomically」），任一迁移脚本失败则整链回滚到**起始版本**。因此回滚预期必须按测试起始版本分别定义，不是单一全局常数：

- **v3 起、第 4 迁移失败** → 回 v3：`user_version == 3`、镜像 `schema_version == 3`、表计数 `== 18`；
- **v2 起、跨迁移链（003+004 同一 to_latest）中途失败** → 整笔回 v2：`user_version == 2`、镜像 `== 2`、表计数 `== 13`。

**保留原 003 回归意义**：`migration_fault_after_003_rolls_back_to_v2_and_retry_completes`（fn :865）在 004 落地后，故障注入分支仍指向第 3 迁移（§8.4.1 R6），其 v2 整笔回滚断言组（:880 `table_count == 13, "003 must roll back, leaving v2"`、:885/:895 `== 2`、:905 `text_sources` 不存在、:908-918 行/高水位保留）**逐项继续成立、一字不改**——不能机械把计数 13 改 18。该测试的**重试完成段**才翻转：:921 `table_count == 18` → 19、:927 `user_version == 3` → 4（重试走无故障 `open`，应用全部四迁移；`web_backend_schema.rs:122-130` 路径核实）。

**故障注入扩展**：`#[cfg(test)] apply_migrations`（`web_backend_schema.rs:391-403`）现把失败语句硬编码追加到 `SQL_003`（注释「Inject the failure after the third migration … leaving the database at v2」）。004 落地后该分支不再覆盖最新迁移，须扩展为可指认故障点（如 `WebBackendMigrationFault` 增加第 4 迁移变体、把失败语句追加到 `SQL_004`），并新增两个用例分别承载上列两组起始版本期望；`schema_meta` 镜像随同事务回滚在两用例中一并断言（004 新表为 TEXT PK、无 AUTOINCREMENT，不触碰 sqlite_sequence）。

#### 8.4.3 II 三族幂等验收新增（edit/discard/applyPreview——不能称现有 T-8 已覆盖）

现有 II 套件的 operationId 幂等条目只覆盖既有两路径：`web-text-intake-http.test.mjs:526`（T-8，`/api/text-sources`）与 :567（T-8，`/api/tasks` 提交）。三族直改操作的请求体虽已带 `operationId`（`tests/fixtures/web-text-intake/synthetic-inputs.mjs:91-109`，每次新建、从无重放），但**不存在任何**同键重放/异体冲突/跨目标/跨动作/守卫拒绝不落账/重启重放用例（61a069b 树逐用例核实；T-10 对 edit/discard 的既有覆盖是版本/状态守卫与校验，:888-905 的二次 discard 断言 `409 state_conflict`，不是 operationId 语义）。004 采纳后，三族幂等验收**必须新增**（自然落点为承载三端点的 http 套件 T-9/T-10 邻域；重启重放用既有后端重启机制），至少覆盖：① 同键同规范字节重放 → 200 `replayed:true`＋当前权威态、不消耗版本；② 同键异体（任一行为字段变化，含 `timeReviewed`/`runId`，对照 §8.3）→ 409 `idempotency_conflict`；③ 跨候选目标/跨动作复用 → 409；④ 守卫/校验拒绝 → 错误响应且 `candidate_operations` 零新行；⑤ 后端重启后同键重放仍 200。上述用例落地前，该三族不得签业务通过。

### 8.5 反例与正控证据（本轮全部实跑，exit 0）

| 文件 | 判定 | 证明 |
|---|---|---|
| `ce1-last-operation-single-column.mjs` | CONFIRMED | §3 三结构缺陷（F1/F2/F3） |
| `ce2-json-column-smuggling.mjs` | CONFIRMED | §7 JSON 列（D1/D2） |
| `ce3-sign-off-reuse.mjs` | CONFIRMED | §6 泛化三依据（G1/G2/G3） |
| `ce4-frozen-tables-audit.mjs` | CONFIRMED | §5 逐表审计：真实冻结字节上 15/15 被拒 |
| `ce5-proposed-schema-proof.mjs` | CONFIRMED | §8 正控：004 提案字节在冻结链上应用，F1–F8 全过 |
| `ce6-normative-request-binding.mjs` | CONFIRMED | §8.3 绑定反例与正控：B1 `timeReviewed=false` 在已解析候选可达（初稿前提证伪）；B2 400 门恰为 `unresolved && !timeReviewed` 且不落账；B3 同键翻转 `timeReviewed` → 409；B4 同键换预览目标 `runId` → 409（`run_2` 独立键应用不同字段，证明目标是行为性字段）；B5 精确同字节重放 → 200 `replayed:true` 且不消耗版本 |

复跑（真实解释器命令，Node ≥ 24 的 `node`；用例只用 `node:sqlite`，确定性、无网络、无后端）：在本目录执行 **`sh run-all.sh`**（逐例写 `<case>.out`），或逐例 **`node ce1-last-operation-single-column.mjs`** … **`node ce6-normative-request-binding.mjs`**。冻结迁移字节从本目录 `inputs/`（001/002/003，逐哈希复核）或仓库 `src-tauri/migrations/web-backend/` 解析，失配即硬失败；`004_candidate_operations.proposal.sql` 哈希复验后按 §8.1 应用。补件轮全套 6/6 exit 0 CONFIRMED；其中 ce4/ce5 本轮输出与上轮裁定评论所附输出**逐字节一致**（SHA-256 `c4ea2acb…3da7`、`fb50c671…ec56` 与上轮 SHA256SUMS 登记值相同），忠实度证据见 `verification.md`。全部产物哈希见 `build/web-text-intake-storage-decision/SHA256SUMS.txt`；脚本、精确输入、原始输出与哈希均随裁定评论附件实际交付，不在回收的 build 路径上。

## 9. 边界、后续与复核要点

- **本轮不做什么**：不创建生产迁移文件；不改 server/src/src-tauri/tests 任何代码；不改守卫与白名单；不跑完整 `npm run check`；不改 MAYNE-24 状态（保持 in_progress）。本裁定**不是**集成派发，不阻塞候选 I 其余未闭合项的并行修复（与 Claude 并行面无关）。
- **后续路径**：提案（§8）交**未参与者**复核（OpenCode/Claude 均为利益相关不可自签；建议 ZCode/OhMyPi/Kimi 中由队长另派）→ 复核通过后由队长判断是否需要新增 owner 授权（新增表＋第 4 迁移＋白名单扩员属新授权面）→ 授权后由 I 在其授权范围内落地为 004 实施候选并按既有独审流程复审。**未复核/未授权前，M-4 维持「未闭合」，不得以 (a)/(b) 任一方案临时实现。**
- **复核要点（给未参与者）**：① §2 判据条文是否引用完整（特别是 A.2 与 P1 §5.1 的重放语义）；② ce4 是否遗漏既有表的可行落点（15 表清单与授权 B 是否一致）；③ §8.1 提案字节与哈希复算；④ §8.2 对 R1–R7 的覆盖是否有反例；⑤ §8.4 配套面是否遗漏（尤其 runner 故障注入与守卫自测）；⑥ ce1–ce6 用附件脚本按 §8.5 真实解释器命令复跑 exit 0；⑦ §8.3 更正后的绑定字段集（`timeReviewed`/`runId`）是否仍有遗漏的行为性字段（ce6 可作对照）。

## 10. 记录

- 裁定者：OpenCode（`agent/opencode/mayne-24` @ `ff287ab937d0b30b246302a7b24d30df68cc59da` 之上，仅本文件）；写入清单与输入哈希见 `build/web-text-intake-storage-decision/admission.json`。
- 派发依据：MAYNE-24 评论 `01a1bbe0-5771-7b32-87f6-a2127673b07e`（Codex，2026-11-08）；裁定对象：候选 I 交付记录 §7 请求 1（M-4）。
- **补件记录（2026-11-09，队长评论 `01a1bc38-1cef-7ad8-8f81-62b54561df11`）**：①平台回收本机 build 后，ce1–ce5 脚本与 `run-all.sh` 全部重建并重新实跑，实际脚本、精确输入（`inputs/` 三迁移文件）、原始输出与 `SHA256SUMS.txt` 随评论附件交付，附真实解释器命令；②按队长复核更正 §8.3 前提并新增 `ce6-normative-request-binding.mjs`（初稿前提原文保留于 §8.3 更正记录）；③提案 SQL 字节未变，SHA-256 复算仍为 `5de175b6…c5bf`，未沿旧值签发新内容；④ce4/ce5 重建输出与上轮所附输出逐字节一致（忠实度证据见 `verification.md`）。004 仍未授权、16 表权限未授权、原 003 继续冻结、M-4 保持未闭合；本轮不实施、不改生产路径、不改状态。
- **F-3/F-4 补齐记录（2026-11-09，队长评论 `01a1bc53-b832-7d35-9d86-9966bbd741d6`；承接 Kimi 评审 §4.7 F-3、§4.3 F-4）**——逐项处置：
  ① **F-3 §8.4 清单**：受影响断言完整清单（R1–R8/J1–J2，含 3 个必然破测哨兵 4→5、10 处表计数 18→19、runner 故障注入硬编码）纳入 §8.4.1/§8.4.2，逐项按当前精确候选核实——I=`4dfc9e9…`（tree `89446a4f…`）、II=`61a069b…`（tree `e0a6028b…`）；相对评审清单两处精化：store_tests 版本字面量实为 3 处（:54/:62/:238，评审列 :53/:59 未含 :238 的 `pragma_is_read_only_and_whitelisted` 断言，b057f0e 初版即存在）、J1/J2 行号按当前 II 树更新（:82/:255）。
  ② **回滚预期**：§8.4.2 按测试起始版本分别定义——v3→4 失败回 v3（18）、v2 跨迁移失败整笔回 v2（13）；机制依据 rusqlite_migration 2.5.0 `goto_up` 单事务（`src-tauri/Cargo.lock` 冻结版本，crate 源逐字核实）。原 003 回归（`migration_fault_after_003…:880 == 13`）保持原意义一字不改，不机械把 13 改 18；其重试完成段（:921/:927）才翻转 19/4。评审稿 R6「故障点移至 004 后期望 18；保留 003 故障则须文档化降级理由」按队长口径修正为「保留 003 故障回归＋新增第四迁移变体」，无降级。
  ③ **II 三族幂等**：§8.4.3 明确 edit/discard/applyPreview 幂等验收须新增（重放/异体/跨目标/跨动作/守卫不落账/重启重放五组），现有 T-8 系条目只覆盖 `/api/text-sources`（:526）与 `/api/tasks`（:567）两路径——原 §8.4「既有条目由此可签业务通过」的表述作废。
  ④ **F-4 措辞三处**（不动任何字节）：§8.2 FK 依赖改为可达边界论证（staged 行确被删：`text-intake-service.mjs:798`；三操作守卫 pending：:400/:424/:488——初稿「candidates 行只改状态不删除」作废，结论「FK 无需 ON DELETE」不变）；§8.2 行不可变改为服务层 append-only 协议性质（守卫按目标表放行：`web_backend_store.rs:607`，非 INSERT-only 模板；settings 两条款除外）；§7 点名 `workspace_operations`（001:98，白名单外，显式拒绝用例 `web_backend_store_tests.rs:193-196`）。
  ⑤ **004 字节**：本轮从补件轮附件（`01a1bc4a-6ef9-7ded-b543-ef0074851570`，1774 字节）恢复至 `build/web-text-intake-storage-decision/004_candidate_operations.proposal.sql` 并复算，SHA-256 仍为 `5de175b6…c5bf`——仅字节复算一致，不签发新内容；平台已回收旧 build 目录（本目录为第 3 轮重建，见 admission.json）。
  ⑥ **边界**：本轮零代码/权限/测试/守卫/生产迁移改动（`src-tauri/migrations/web-backend/004_candidate_operations.sql` 生产路径仍不存在）；未跑完整门禁，仅 `npm run check:docs`；验证证据 `build/web-text-intake-storage-decision/f34-verification.log`（17 组命令与输出）＋`f34-SHA256SUMS.txt`。M-4 维持未闭合；材料交限定复核（修改面仅为 §7 一句、§8.2 两条、§8.4 及新增三个子节、本条记录）；MAYNE-24 保持 in_progress。
- 本文件不修改任何冻结契约/DDL 的业务字节；不构成对 001–003 的解释变更——§2 全部引用既审原文。
