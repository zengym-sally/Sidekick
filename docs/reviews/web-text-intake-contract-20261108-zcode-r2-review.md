# MAYNE-24 P1 文本整理与签收提案限定复审 R2（ZCode）：不通过（1 主要 + 4 次要，小修订可闭合；B1/B2/M1 及受影响次要项已全部实质关闭）

- **评审对象**：P1 修订提交 `617b1b9d33db395cdf80afbf3363b24e918e131d`（tree `a301e4a0553b6c4fa131cff3f0ca3033e099c039`，父恰为 `3cfc5ab42dc8a5ac9ebb71e2b54348b1f00df345`），即 `3cfc5ab..617b1b9` 增量（仅两份提案文档，+134/−39）；R1 结论见[首轮评审](web-text-intake-contract-20261108-zcode-review.md)（`c7e962a`，2 阻断 + 1 主要 + 6 次要 + 5 NIT）。派发评论 `01a1bada-6cd3-7464-a090-a240c7772b83`；源码基点仍为 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`（tree `77a54859…`，未变）。评审者未参与提案与实现，与 P2 结论无涉、予以保留。
- **结论**：**不通过（小修订后可再收口）**。B1／B2／M1 三大项经独立复算全部实质关闭（本轮以 `node:sqlite` 等价复现 + 静态取证独立验证，非沿用作者输出）；受影响次要项（MINOR-1–6、NIT-1/2/3/5）处置全部核实成立；未改已过面经 range diff 与全文比对确认保留。残留 1 项主要（agentConcurrency 设置写与「设置模板不变」在真实 runner 上矛盾，授权台账漏一项必需改动）与 4 项次要（文字级收口），均有明确小修订路径。
- **边界**：候选只读；仅写本记录与本机 `build/web-text-intake-contract-r2-review/`（gitignored；含 7 个 R2 附件原文、复算脚本与原始输出、命令日志）。未实施迁移、未创建迁移文件、未装依赖、未跑完整门禁、未调真实模型；外键结论仍由 runner 连接契约 + `node:sqlite` 等价复现支撑。MAYNE-24 保持 backlog，父任务保持 in_progress；本轮不代签授权或实施准入。

## 一、身份与哈希：全部逐字节一致（独立复算）

| 项 | 复算 |
|---|---|
| 提交身份 | `617b1b9` 父=`3cfc5ab`、tree=`a301e4a0…` 与声明一致；`3cfc5ab`（tree `8c998389…`、父 `19045b8`）不变 |
| 增量补丁 | 附件 `w1-p1-text-intake-r2.patch` SHA-256 `b7501680…96858` 与 `git diff 3cfc5ab..617b1b9` 逐字节相同；增量恰为两份文档（+134/−39），冻结文件与生产源码零触碰 |
| 提交内 blob | 两份文档 blob 与附件 diff 为空（byte-exact） |
| 拟议 003 | 附件 `003_text_intake.proposed.sql` SHA-256 `27f8ca48…249f4` 与授权文档 §5.1 围栏原样提取逐字节相同（声明「以定稿复算为准」成立） |
| R2 附件 | 7 项附件哈希全部对实际下载复算一致（含反例脚本 `2274d551…`、输出 `205cd02c…`、evidence `3ea19168…`） |
| 冻结保留 | 基点 001 `8511907c…143d`／002 `b6cb8e61…f97e`／web-api `61863271…f58d` 实测一致且在本轮增量中未被触碰 |

## 二、B1（重建迁移）已关闭：独立实证

在 `node:sqlite`（SQLite 3.53.4，连接先置 `PRAGMA foreign_keys=ON`，001+002+003+`user_version` 同一事务——对齐 runner 契约）下独立执行（脚本与原始输出随附件，非沿用作者结果）：

- **历史行＋删除空洞＋sequence 高水位升级通过**：7 行事项（含软删/完成/unicode/JSON 转义字节）硬删 2 行留 rowid 空洞、12 行事件硬删尾 3 行留 `sqlite_sequence=12 > max(seq)=9`；003 后**值逐字节保留**（含 NULL `before_json`）、事件保序保 sequence；`foreign_key_check` 空；`signed_ai`／`link` 可写；镜像与 `user_version` 3/3。
- **FK 重指实证**：RENAME 后子表 schema `REFERENCES "manual_items"`（NIT-4 的引号形态实拍）、`_v3` 零残留；孤儿事件 INSERT 被拒——外键确实指向重建后的父表。
- **索引集恰等**：重建后冻结 4 索引（`manual_items_status`／`manual_items_open_time` 含 partial `WHERE status='open'`／`manual_items_list_order`／`manual_item_events_item(item_id, sequence)`）名字与列序逐一保留，无增减。
- **中途失败回滚重开自洽**：在 RENAME 前注入失败 → 整体回滚；重开校验 `user_version=2`／镜像 2、事项与事件逐字节原样、`sqlite_sequence` 原值、零残留表；随后干净 003 一次通过、新事件 sequence 连续。
- **「rowid 不承诺」措辞诚实**：中间空洞使 rowid `1,3,4,5,6 → 1,2,3,4,5` 重编号实证（无消费方依赖：外键用 `item_id`，列表用时间序）。
- **作者反例复算**：改两条输入路径后原样重跑，B1 repro／B1 fix／B2 repro／B2 fix／B2 replay／M1／故障注入七项全部 PASS，与交付声明一致。
- **残留（新 MINOR-A）**：`sqlite_sequence` **高水位不随迁移保留**——事件行曾被物理删除的库迁移后水位回落为 `max(seq)`（`12→9`），新事件重用已删除的 sequence 值（`10–12`）。W1 store 对 `manual_item_events` 零硬删（grep=0，产品可达态水位恒等于 max，复制即保留），故不构成可达数据缺陷；但授权 §5.3/DDL 注释声明「含…AUTOINCREMENT sequence 保留」依赖这一**未声明的不变量**。小修订：§4.3/§5.3 补一句「事件行为 append-only、水位恒等于 max」的不变量声明（或迁移内显式保留水位）。不阻断。

## 三、B2（批量签收）已关闭：独立实证

按契约 §5.1 声明语义在拟议 schema 上独立实现并验证（脚本与原始输出随附件）：

- N=3 混合批次（2 新建＋1 关联）单事务一次提交；派生行键 `batch-1#cand-N` 满足 `manual_item_events.operation_id` 与 `manual_item_sources.operation_id` 两级行级 UNIQUE；`create`/`link` 动作经扩展 CHECK 放行；`source='signed_ai'` 落库。
- **重放**：同键同规范输入 → 返回台账原结果映射（`replayed:true`），事件/关联/事项/候选计数零变化。
- **同键异体**：同 `operationId` 不同规范输入 → 台账命中但请求不一致 → 409 `idempotency_conflict` 路径成立。
- **中断原子性**：事务内崩溃模拟（写入台账＋首行后 ROLLBACK）→ 台账与行全回滚、零半批；恢复后同键作为首投正常提交。
- **中途版本冲突**：第二批 stale `expectedVersion` → `changes()=0` → 整批回滚（台账/事件/关联/候选零残留）。
- **跨域命名空间行为确定**：手工操作占用派生键形状 → 批次 INSERT 撞 UNIQUE 整体回滚（可预期、可测）。W1 §13 n2（冻结 manual-items 契约「须声明全局或按资源族的幂等命名空间策略」）的声明义务已由 §5.1「批量签收幂等命名空间」段履行。
- **残留（新 NIT-a／NIT-b／MINOR-C）**：① 派生键单射性要求 `candidateId` 不含 `#`，而 `candidate_id` 格式未在契约/DDL 固化——`A`+`B#C` 与 `A#B`+`C` 同键实证；服务端 ID 固化字母表（如 `cand_<hex>`）一行即闭合。② `sign_off_batches` 缺 `status↔completed_at_ms` 元组 CHECK（`succeeded` 且 `completed_at_ms` NULL 可写入），与本轮为 `candidates` 补元组 CHECK 的风格不齐。③ 批次重放「返回原结果映射」与同段引用的手工事项契约附录 A.2「返回同一对象当前权威状态」措辞不一致——台账 `result_json` 是批次维度的权威记录（itemIds 稳定、逐条内容可经 GET 读当前态），语义可接受，但应在 §5.1 明示这是对 A.2 的批次细化。

## 四、M1（结果暂存→退出确认）已关闭：独立实证（18/18）

按契约 §6.1 声明的事务顺序 + 冻结 001 CHECK 全生命周期推演（脚本与原始输出随附件）：

- **暂存**：结果帧（attemptId+epoch 匹配）→ `result_pending_exit=1`＋`pending_outcome`（冻结 CHECK 元组满足）、`state='running'`、`result_ref`／`terminal_at` 不发布、**槽位不释放**（frozen 场景 24）；`staged` 候选对 pending 过滤不可见、签收前置（status=pending）匹配为零 → **不可签收**。
- **退出确认**：单事务提交原暂存结局（succeeded→`result_ref`/`terminal_at`/`exited_confirmed`＋staged→pending；failed→`failure`＋staged 删除），槽位释放。
- **取消分流**：无暂存 → `cancelled`＋释放槽；有暂存 → 提交原暂存结局（R2 §6.1.6），冻结 001 CHECK 可表达（实证）。
- **退出未知**：有暂存 → `needs_review`＋槽位保持＋staged 不可见（frozen §3.2 行 76）；回收干净 → 提交原暂存结局（场景 29）；副作用未知 → 保持 `needs_review`，暂存结局按冻结读白名单（`needs_review`＋`result_exit_unconfirmed`＋`exited_confirmed`）可见，`resolve(resume)` 提交原结局／`resolve(cancel)` → `cancelled`（场景 31–33 链路闭合）。无暂存 → `needs_review`（场景 30）→ 有界重入队释放槽。
- **重启**：新 `instance_epochs` 行注册（NIT-5 处置到位）；**fencing 实证**——已核实死亡的旧 attempt 的迟到结果帧被拒（attempt 不再 active）；旧 attempt 有界重入队。
- **冻结 CHECK 反向**：暂存无 `pending_outcome`、终态无 `terminal_at` 均被拒。
- **残留（新 MINOR-B）**：「取消 × 暂存并存」是冻结 §3.4 未枚举的组合——冻结 cancel 路径固定 `stagedResult:false`（cause `cancel_exit_unconfirmed`），`resultPendingExit` 分支固定 `cancelIntent=false`（行 76）。R2 §6.1.6 以「提交原暂存结局」补缺口，实证可行且与冻结「暂存结局优先」精神一致，但契约未声明这是对冻结缺口的自行补齐规则，也未规定提交后 `cancel_intent` 终值（实证可停在 `cancel_intent=1` 的 `succeeded` 终态）；§6.1.7/8 重启分支对同一组合标注「（冻结 §3.4）」属引用外推。小修订：§6.1.6/7/8 增补一段「冻结未枚举组合的补齐声明」＋规定 `cancel_intent` 终值。不阻断。

## 五、受影响次要项逐项核实：MINOR-1–6／NIT-1,2,3,5 全部成立

| 项 | 处置核实 |
|---|---|
| MINOR-1 备份承诺 | **关闭**。新文案与真实 runner 一致：`web_backend_schema.rs` 的 `consistency_backup` 确校验 `application_id`＋`user_version == SCHEMA_VERSION`（`:194–196` 实证），对 v2 库必拒；「不承诺迁移前备份＋单事务回滚＋显式备份按冻结 §8.2（`/api/workspace/backups` 端点在冻结契约在位）」表述准确 |
| MINOR-2 advisor 移出 | **关闭**（契约 §1／§8.2／§10 已清理）。但授权文档 §4.2 仍残留 `src/stores/today.ts`（advisor 任务）行 → 并入 MINOR-D |
| MINOR-3 指纹去重 | **关闭**。§5.1 `reused:true`＋UNIQUE 归并语义已声明，文本级自洽 |
| MINOR-4 元组 CHECK | **关闭**。DDL 落地且正/负双向实证：`accepted` 缺 `accepted_item_id`／`staged` 带 `accepted_item_id`／`pending` 带 `processed_at_ms` 均被拒 |
| MINOR-5 capture_method 映射 | **关闭**。§7.4 #6 交付映射：legacy `capture_method ∈ (manual, signed_ai)`（`local_store.rs`／legacy `002_ingestion.sql`）由 `source`＋`manual_item_sources.association` 承载，线格式沿用 `source`；legacy 同迁移将事件动作集扩至含 `link`，为 003 的 `action` 扩展提供前例 |
| MINOR-6 rowid 措辞 | **关闭**。§4.3/§5.3 改「值逐字节保留；rowid 不承诺」，实证吻合 |
| NIT-1 | **关闭**。契约 §8.1 Rust 清单补 `web_backend_schema.rs`（含 `SCHEMA_VERSION→3`／`migrations()` 追加/故障注入分支，与基点 `migrations()`＋`WebBackendMigrationFault` 实际形态吻合） |
| NIT-2 | **关闭**。`sign_candidates` 实际在 `ingestion.rs:645–646`，`:646` 修正成立 |
| NIT-3 | **关闭**。worker 记录措辞与[后端基础探针](../engineering/backend-foundation-probes.md) D 组一致（`runs/worker.json` 0600／pid 三态／EPERM 按存活暂停——探针记录 48/52 行实证），多槽扩展 `runs/<runId>/worker.json` 语义一致 |
| NIT-4 | 保留登记（实证 `REFERENCES "manual_items"` 引号形态，语义等价） |
| NIT-5 | **关闭**。契约 §6.1.8 注册行＋本轮 G 生命周期实证 |

## 六、未改已过面：确认保留

range diff 仅两文档；R1 已核实通过的主体（复用锚点 16 文件、Pi stdio 协议逐键、队列/槽位/取消/退出未知/有界重试与冻结 §3/§4/§5/§7 对齐、SSE 候选提示帧＝W1 M2-②＋冻结 §6 无 id 先例、重放先于守卫、授权台账 owner `01a1b648`／W1 A–D 原文、生产 OS CredentialProvider 单列「实施时另行授权」、`IMMUTABLE_MIGRATIONS` 位于 `check-structure.mjs:51` 的引用可实现）在本轮增量中未被触碰或仅按上述处置收紧，未发现回归。P2 结论不涉本增量，保留。

## 七、新发现（本轮）：1 主要 + 3 次要 + 2 NIT

- **MAJOR-1：`PUT /api/settings/agent-concurrency` 与「设置模板不变」在真实 runner 上矛盾（授权台账漏一项必需改动）**。真实写路径：Web 后端 settings 写经 Rust `transact` 守卫——`web_backend_store.rs:543–548` 仅放行业务表语句，settings 目标语句必须先过**两条逐字节生产模板**（`:555` INSERT／`:557` CAS，key 字面量大小写/空白敏感；frozen 手工事项契约附录 B.1/B.3 同口径：「不放宽任意 settings 写入」；Node 侧 `application-settings-service.mjs` 也仅接 `application.timeZone`）。`agentConcurrency` 的 INSERT/CAS 不匹配任何模板 → `WEB_BACKEND_SQL_DENIED` → 契约 §5.2 端点表、§4.1「新增 key `agentConcurrency`」、§6.2「settings 版本 CAS」承诺的并发写在声明改动集（授权 §3 #3「设置模板不变」×3 处）下**不可实现**，且所需模板扩展恰是需要 owner 授权的生产守卫改动。小修订二选一：① §4/§5.2 增补两条 `agentConcurrency` 生产模板＋授权对应表新增一项；② 将该端点 PUT 移出本切片并声明并发固定缺省 3（GET 仍可读）。判「主要」而非「次要」：准入判断（「接口/写入清单与真正新增授权收口后晋级」）本身依赖台账完整，漏项会使晋级判断失真；方向为少申报，无越权。
- **MINOR-A**：sequence 高水位不随迁移保留、不变量未声明（见 §二）。
- **MINOR-B**：取消×暂存冻结缺口补齐未声明＋`cancel_intent` 终值未定（见 §四）。
- **MINOR-C**：批次重放与附录 A.2 措辞不一致（见 §三）。
- **MINOR-D：R1 残留文案（5 处）**：契约 §4.1 `manual_item_events` 行仍写「签收以 `action='create'` 记录｜无 action 扩展」，与 §4.3「扩为含 `'link'`」及 DDL 直接矛盾（legacy `todo_events_v2` 同样扩 `link`，DDL 方向正确、该行过时）；授权 §1 目的仍列四张新表（缺 `sign_off_batches`）；授权 §3 #2 仍写「4 新表＋`manual_items` 重建」（实为五新表＋双表重建）；授权 §4.2 仍留 `src/stores/today.ts`（advisor）行（契约 §8.2 已移出）；两文档 §6/§11 合成对照仍指 R1 的 `build/web-text-intake-contract/` 路径（R2 反例系本轮附件交付）。全部一行级文案修正。
- **NIT-a**：`candidate_id` 字母表未固化，派生键单射性条件未声明（见 §三）。
- **NIT-b**：`sign_off_batches` 缺 `status↔completed_at_ms` 元组 CHECK（见 §三）；另 §5.1「不扩大事件表命名空间」措辞建议改为「不新增列/表、键族经 §5.1 声明」（派生键确实进入同一平面命名空间）。

## 八、未验项与边界

- 未跑真实 runner `cargo test`（含 003 接入后的迁移/故障注入分支与 `BUSINESS_TABLES` 反例）；外键/事务结论由 crate 源码（R1）＋runner 连接契约＋`node:sqlite` 3.53.4 等价复现支撑，最终以 Rust 侧测试为准。
- 未跑受控模型端到端、HTTP 层复用行为、调度器多写者竞争、真实打包（`build-backend.mjs` 复制 runtime 产物）——均沿用 R1 划界。
- 暂存不可见/不可签收的**服务层**强制为 DDL 不可表达的不变量（元组 CHECK 无法阻止 `staged→accepted` 直写，实证），依赖 §4.3 计划的服务层测试覆盖——列为实现期必测项。
- 附件 `tar` 包内容、作者本机 `build/` 未核验；本轮全部关键事实本地重算。
- 显式跳过：完整 `npm run check`、cargo、浏览器矩阵、任何服务与模型调用、真实凭据/用户根。
