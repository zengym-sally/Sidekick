# Web 文本整理与签收纵向契约（W1 阶段4 / MAYNE-24 P1 提案）

> **实施登记（2026-11-08，工程候选 III 接收时追加；仅元数据登记，业务规范与 DDL 围栏零改动）**：owner 已于评论 `01a1bb58-0b0c-7010-80f0-0664dbcd107a`（member Mayne，2026-11-08，与最终申请 `01a1bb3d-c624-7ae1-9e1e-e1e57560d061` 同线程）明确回复「批准」，批准范围 A–C；审批包 SHA-256 `d8fc4f3fdbd18cff1f2b5a031509650966ec7e50fbd01875026203e32837e74c`（合包附件 `01a1bb3d-c223-7c41-926c-08f645b69bfc`）。本文由工程候选从已审定稿 `b190f7c6642625c800396fc04d50009769348c83`（tree `306ff22c9e2182b71a2e0214eedb499e232bbc7e`）逐字节接收，接收态 SHA-256 `5982c06220b382182ee8ff82715ca0e794b4cd51988426d7d9b37da406cfe7b0`（＝登记冻结值）。下方正文（含「提案／未获批／不创建」等表述）保持已审字节不动，仅描述接收前的准备状态；实施依据是本登记与 owner 授权，当前实施状态以[实施计划](../product/05-第一阶段实施计划.md)为准。
> 状态：**提案（proposal），未冻结、未实现**。本文是 MAYNE-24 P1 的交付物；接口/写入清单与真正新增授权收口前不晋级、不实施。本文不创建迁移文件、不安装依赖、不改 manifest/锁文件/守卫、不操作真实数据库/凭据/工作根、不调用真实模型。
> 实际基点：本地 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5` / tree `77a548591ac9b02a51936c806bf4f85d774df7cb`（未 push）。本分支不含该基点，已用 `git show`/`git archive` 精确取证，不以旧 HEAD 冒充。
> 依据：[产品定义](../product/01-产品定义.md)、[用户流程](../product/02-用户流程.md)、[智能体与架构](../product/03-智能体与架构.md)、[分期交付与验收](../product/04-分期交付与验收.md)、[实施计划](../product/05-第一阶段实施计划.md)、[Web/后端设计](web-backend-design.md)、[Web API 契约](web-api-contract.md)（`web-api/1`）、[手工事项契约](web-manual-items-contract.md)（含附录 A/B）、[工程架构](architecture.md)、[后端基础探针](backend-foundation-probes.md)。
> 授权对应与逐文件变更／DDL 提案见[授权差异提案](../reviews/web-text-intake-authorization-20261108.md)。
> **本轮修订**：本版经两轮独立评审修订——R1（ZCode `c7e962a`）处理 B1（003 双表重建）、B2（批量签收批次台账＋派生行键）、M1（结果暂存→退出确认）；R2（ZCode `89df585`）处理 MAJOR-1（并发设置模板）、sequence 高水位显式保留、取消×暂存补齐声明、`sign_off:` 派生键与闭合表；逐项处置见授权文档 §7。

## 1. 范围与边界

纵向交付：**文本提交 → 模型整理（Pi organizer）→ 候选核对 → 编辑/关联/丢弃 → 自然语言修改预览 → 批量签收 → 今日/完成/重启**；含失败、取消、重复提交、响应未知与副作用未知。无模型时手工事项路径不回归。

本提案覆盖的切片：

- 文本来源、候选、修改预览、批量签收、来源证据与候选→事项关联；
- 模型配置（Provider/Model）与 organizer 配置（偏好/补充说明）的读取与保存、配置修订；
- 凭据**引用**的解析（生产 OS provider 与受控测试注入分开）；
- 任务提交/排队/调度/取消/退出确认/重启核实/有界重试/未知结果；
- 后端到随包 Pi Runtime 的进程/stdio 接线与 bundle 路径；
- 今日的事项事实列表与完成路径（沿用既有纯逻辑，不新增模型类型）。

**不在本切片**：advisor 模型建议（W2）、飞书链接/主动收集/进展跟踪（W3）、提醒与日报（W4）、三角色完整配置页与 Skills/MCP 业务接线（W2/W3）、薄壳与原生能力（D1）、真实模型验收（另行开放）。

## 2. 来源逐项处置（已明确可复用 / 实际缺口 / 提案）

| 领域 | 来源（已确认／已验证） | 处置 | 说明 |
|---|---|---|---|
| 文本提交动线 | [用户流程 §2](../product/02-用户流程.md)、旧 S2 实现 `src/components/TextIntake.vue`、`src/stores/organizer.ts` | 复用＋缺口 | 动线已确认；旧实现经 Tauri IPC，需切换到 HTTP（提案 §9） |
| 候选核对/编辑/丢弃 | [用户流程 §3](../product/02-用户流程.md)、旧 `src/components/InboxView.vue`／`CandidateCard.vue`、`src/domain/candidate.ts` | 复用＋缺口 | 组件与纯逻辑可复用；数据层需切换到新库表 |
| 自然语言修改预览 | [用户流程 §3](../product/02-用户流程.md)、旧 `organizer.revise()`／`apply()`、`runtime/lib/organizer-contract.mjs` 的 `parseModelResult(revise)` | 复用＋缺口 | Pi 输出契约与预览语义已验证；需在新后端落地任务与预览表 |
| 批量签收 | [产品定义 §3](../product/01-产品定义.md)、旧 `sign_candidates`（`ingestion.rs:646`） | 复用＋提案 | 事务语义（原子、版本守卫、时间核对、关联/新建）可复用；需在新库表落地（提案 §4/§5） |
| 来源证据/去重 | [用户流程 §2](../product/02-用户流程.md)、旧 `sources.fingerprint`／`todo_sources` | 复用＋提案 | 来源身份+内容哈希去重；候选→事项关联表为提案新表 |
| 模型配置 | [智能体与架构 §6](../product/03-智能体与架构.md)、旧 `src/stores/models.ts`／`domain/model-catalog.ts` | 复用＋缺口 | 配置编辑逻辑可复用；需后端配置存储与 HTTP 端点（提案 §4/§5） |
| organizer 配置 | [智能体与架构 §1](../product/03-智能体与架构.md)、旧 `src/stores/agents.ts`／`domain/agents.ts` | 复用＋缺口 | 三角色配置域逻辑可复用；本切片只接线 organizer，tracker/advisor 后续 |
| 凭据引用 | [Web API 契约 §7](web-api-contract.md)、[Web/后端设计 §4](web-backend-design.md) | 复用＋缺口 | 引用模型与 provider 能力已冻结；解析实现缺失（提案 §7） |
| 任务队列 | [Web API 契约 §3/§5/§6](web-api-contract.md)、001 任务/attempt/事件/恢复/结果表 | 复用＋缺口 | 表结构已冻结；**调度器未实现**（提案 §6） |
| 结果读回 | [Web API 契约 §4.3](web-api-contract.md)、`task_result_payloads`（001） | 复用＋提案 | 内联/分段读回协议已冻结；本切片 payload 为候选/预览（兼容扩展） |
| 并发与槽位 | [Web API 契约 §3.2/§5](web-api-contract.md) | 复用＋缺口 | 语义已冻结；`settings.agentConcurrency` 为 001 settings 的新 key，无 schema 变更 |
| SSE | [Web API 契约 §6](web-api-contract.md)、W1 手工事项契约 §5（M2 选项②） | 复用＋提案 | 任务帧冻结；候选提示为进程内提示，不伪冒 task_events |
| Pi Runtime | `runtime/entries/organizer-entry.mjs`、`runtime/lib/organizer-contract.mjs`、`scripts/build/bundle-runtime.mjs` | 复用＋缺口 | 运行时与 stdio 协议已验证；后端进程接线与 bundle 未落地（提案 §7） |
| 今日事实/完成 | [用户流程 §7](../product/02-用户流程.md)、`shared/today-facts.mjs`、旧 `src/stores/today.ts` | 复用 | 事项事实列表与完成路径沿用既有纯逻辑（基于事项列表计算）；advisor 模型建议归 W2 |
| 手工事项路径 | W1 已实现（main `1e37044`） | 复用 | 手工表单/列表/详情/编辑/完成/删除/历史/重启保持可用，不回归 |

## 3. 用户路径

1. **配置模型**：设置 Provider/Model/凭据引用 → 保存（配置修订）→ 发起连通性测试（`test` 任务）。
2. **提交文本**：贴入原文（可选来源时间）→ 开始整理 → 后端保存来源并提交 `extract` 任务。
3. **排队/运行**：任务入持久队列；满槽排队；页面显示排队位置/运行中，可取消。
4. **候选核对**：整理完成后候选出现在待确认区，展示原文依据、字段、日期推断与重复提示。
5. **编辑/关联/丢弃**：直接改字段并保存（版本守卫）；选择关联已有事项；丢弃；过期版本被拒并提示刷新。
6. **自然语言修改**：输入修改要求 → 生成预览（不直接覆盖）→ 应用预览到候选。
7. **批量签收**：选择多条 → 一次事务签收；新建或关联；已签收不重复入库。
8. **今日/完成/重启**：签收进入今日与完整清单；完成后状态一致；重启后来源、候选、任务与事项原样重现。
9. **失败/未知**：模型失败保留原文与输入；副作用未知转待核对；响应丢失按 ID 读回，不重复创建。

## 4. 对象与数据契约

### 4.1 复用 001/002 现有表

| 现有表 | 本切片用法 | 变更 |
|---|---|---|
| `tasks`（001） | 模型任务台账：`type ∈ {extract,revise,test}`、`role='organizer'`；`input_ref` 携不可变输入与配置快照；`result_ref` 携候选/预览/错误；`failure` 携失败信封；`state`/`attempt_exit_state` 承载队列 | 无 schema 变更（type/role 无 CHECK） |
| `task_attempts`（001） | 每任务至多一个未结束 attempt；worker pid 与退出确认 | 无 |
| `task_events`（001） | `task.changed`／`task.progress` 事件流（`object_type='task'`） | 无 |
| `side_effect_receipts`（001） | 模型工具外部回执，供 `sideEffectSafety` 判定 | 无 |
| `instance_epochs`（001） | 实例更替与 fencing | 无 |
| `settings`（001） | 新增 key `agentConcurrency`（值 JSON）与既有 `application.timeZone` | 无 schema 变更（key/value/version 通用） |
| `manual_items`（002） | 签收后的正式事项 | **需扩展 `source` 至 `signed_ai`（003 重建，见 §4.3）`|
| `manual_item_events`（002） | 事项历史 | 003 重建时 `action` 扩至含 `'link'`（关联签收）；新建签收用 `create`＋`source='signed_ai'` |
| `task_result_payloads`（001） | 候选/预览大 payload 的持久字节（`result://<attemptId>/<name>`） | 无 |

### 4.2 提案新表（003）

| 表 | 用途 | 关键约束 |
|---|---|---|
| `text_sources` | 文本来源身份、原文、来源时间、锚点、导入时间、指纹去重 | `fingerprint UNIQUE`；`succeeded_run_id` 指向 extract 任务 |
| `candidates` | 候选卡片：字段草稿、原文依据、日期原表达、警告、未定期标记、状态、版本、签收目标 | `status IN (staged,pending,accepted,discarded)`；`UNIQUE(source_id,ordinal)`；`accepted_item_id` 指向事项；状态↔时间戳/外键元组 CHECK（见 §4.3） |
| `candidate_previews` | 自然语言修改预览（候选某版本的拟改草稿） | `candidate_version` 为基准版本；`run_id` 指向 revise 任务 |
| `manual_item_sources` | 事项↔来源↔候选关联与证据 | `association IN (new,manual_link)`；`operation_id UNIQUE`；`(item_id,candidate_id)` 主键 |
| `sign_off_batches` | 批量签收台账（批次单行） | `operation_id`（批次键）`PRIMARY KEY`；绑定规范输入 `request_json` 与结果映射 `result_json`；`status IN (succeeded,failed)` |

`candidates.status` 语义：`staged`＝结果暂存事务内写入、**退出确认前不可见/不可签收**；`pending`＝已发布可核对；`accepted`／`discarded`＝已处理。

标识字母表：`source_id` 用 `src_<32hex>`；`candidate_id` 用 `cand_<32hex>`；`preview_id` 用 `prev_<32hex>`。固定字母表用于可读性与排序稳定；§5.1 的批量派生行键单射由 JSON 数组编码＋SHA-256 保证，**不依赖字母表**。

### 4.3 003 双表重建（数据保留；rowid 不承诺）

002 的两处 `CHECK` 需扩展：`manual_items.source` 由 `('manual')` 扩为 `('manual','signed_ai')`；`manual_item_events.action` 由 `('create','update','complete','reopen','delete')` 扩为含 `'link'`（关联签收）。SQLite 的 `CHECK` 无法 `ALTER`，且 `manual_item_events.item_id` 有指向 `manual_items` 的外键——**单表 `DROP manual_items` 会因子表外键被拒**。003 采用同事务**双子表重建**：先建 `manual_items_v3` 并复制父行 → 建 `manual_item_events_v3`（外键指向 `manual_items_v3`）并复制事件行（保序保 `sequence`）→ 先 `DROP` 子表再 `DROP` 父表 → 双 `RENAME` 回原名（`RENAME` 重指子表外键）→ **显式恢复 `sqlite_sequence` 历史高水位**（重建前捕获、重建后恢复，即使尾行曾被硬删也不再复用旧值）→ 按原名重建索引。既有行与事件**值逐字节保留**；**rowid 不承诺**（含删除空洞的表重建后可能重编号，无消费方依赖 rowid）。详见授权文档 §5.1。

### 4.4 配置与凭据（不新增 DB 表）

- **配置文档**：沿用[设计 §4](../engineering/web-backend-design.md)的工作根 `config/` 约定——`config/providers.json`、`config/models.json`、`config/agents/<agentId>.json`；由新 `server/lib/config-store.mjs` 原子读写（临时文件＋`rename`，0600），修订号为规范化内容的 SHA-256 前缀。
- **配置修订快照**：任务提交时，`input_ref` 固化 `{configRevision, snapshot:{provider,model,agent,skills,profile}}`；执行期编辑配置不影响已入队任务（冻结契约 §3.1）。
- **凭据**：`input_ref` 只保存凭据**引用**（`apiKeyRef`，如 `env:MODEL_KEY` 或 Keychain 条目名）；秘密在执行前由 `CredentialProvider` 解析，经 worker 私有 stdin 注入，不写入队列/SQLite/argv/配置/日志/SSE。

## 5. HTTP 接口提案

沿用[冻结契约](web-api-contract.md)的会话/CSRF/Origin/错误包络；写请求校验 CSRF＋精确 Host/Origin。除注明外成功返回 200。

### 5.1 文本来源与候选

| 端点 | 方法 | 请求 → 响应 | 主要错误 |
|---|---|---|---|
| `/api/text-sources` | POST | `{operationId, input:{text, sourceAt?, timeZone?}}` → 200 `{source, task}`；同 `operationId` 重放 → 200 `{replayed:true, source, task}` | 400 `validation_failed`；409 `idempotency_conflict` |
| `/api/text-sources` | GET | `?cursor=&limit=` → 200 `{sources:[…], nextCursor}` | 400 |
| `/api/text-sources/{sourceId}` | GET | — → 200 `{source, run, candidates, previews}` | 404 `source_not_found` |
| `/api/text-sources/{sourceId}/candidates` | GET | `?status=&cursor=&limit=` → 200 `{candidates:[…], nextCursor}` | 404 |
| `/api/candidates/{candidateId}` | GET | — → 200 `{candidate}` | 404 `candidate_not_found` |
| `/api/candidates/{candidateId}/edits` | POST | `{operationId, expectedVersion, input, timeReviewed}` → 200 `{candidate}` | 409 `version_conflict`／`state_conflict` |
| `/api/candidates/{candidateId}/discard` | POST | `{operationId, expectedVersion}` → 200 `{candidate}` | 409 `state_conflict`（非 pending） |
| `/api/candidates/{candidateId}/revisions` | POST | `{operationId, instruction}` → 200 `{task}`（type=revise） | 409 `state_conflict`；400（指令为空） |
| `/api/candidates/{candidateId}/previews/{runId}/apply` | POST | `{operationId, expectedVersion}` → 200 `{candidate}` | 409 `state_conflict`（候选已更新/处理） |
| `/api/sign-offs` | POST | `{operationId, choices:[{candidateId, expectedVersion, fields, timeReviewed, target:{id,expectedVersion}|null}]}` → 200 `{items:[…]}` | 409 `version_conflict`／`state_conflict`；400（时间未核对） |

约定：

- **来源时间锚点**：`sourceAt` 缺省按首次录入时间；相同时点候选需客户端选择（沿用 `shared/dates.mjs`）。
- **指纹去重**：`text_sources.fingerprint` 为规范原文的 SHA-256。同指纹重复提交（含并发）**返回 200 复用既有 `source`**（含其原锚点）并在响应标 `reused:true`；并发下由 `UNIQUE` 冲突归并到既有行，不创建第二来源、不提交第二任务。
- **候选字段**：`fields` 与手工事项同构（标题/类型/负责人/优先级/截止/下次跟进/标签），`dueExpression`/`followupExpression` 为原文连续片段，`unresolved` 时签收须 `timeReviewed=true`。
- **幂等**：同 `operationId` 且同规范输入（动作＋目标＋input＋expectedVersion）才重放；重放先于状态/版本守卫，返回同一对象当前权威状态（沿用手工事项契约附录 A.2）。
- **批量签收幂等命名空间**（履行冻结 W1 契约 §13 n2）：批次操作键为客户端 `operationId`，写入 `sign_off_batches`（`operation_id` 主键，绑定规范输入与结果映射）；每行 `operationId` 由**确定性派生** `sign_off:`＋SHA-256(UTF-8 字节) 写入 `manual_item_events` 与 `manual_item_sources`，其中 SHA-256 输入为**紧凑格式** `JSON.stringify(["sign_off", batchOperationId, candidateId])`（即 `["sign_off","<batchOperationId>","<candidateId>"]`，无多余空白分隔符）。JSON 数组编码无歧义（不依赖 `candidateId` 字母表），两级**按行 UNIQUE** 满足；**不新增列／表**，键族按本节声明。跨族已占用同形键时按 UNIQUE 冲突**整批回滚**（事务原子）。重放：先查 `sign_off_batches`，命中且规范输入一致→按台账的候选→事项 ID 映射**重读当前权威对象**（`replayed:true`，不返回旧对象快照；这是对冻结附录 A.2「当前权威状态」的批次级细化）；同键不同规范输入→409 `idempotency_conflict`；每行值与台账在同一事务写入。
- **新增错误码**：`source_not_found`（404）、`candidate_not_found`（404）、`time_review_required`（400）；其余复用冻结 §10 注册表。

### 5.2 任务提交与结果读回（复用冻结契约）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/tasks` | POST | 提交 `{operationId, type, role, input}`；`type ∈ {extract,revise,test}`、`role='organizer'`；返回 202 `{taskId,state,version,queuePosition}`（冻结 §4） |
| `/api/tasks` | GET | 列表（按 `submitSeq` 稳定分页） |
| `/api/tasks/{taskId}` | GET | 任务资源（冻结 §3.1 全字段） |
| `/api/tasks/{taskId}/result` | GET | 结果信封（冻结 §4.3 内联/分段；payload 为候选/预览，兼容扩展） |
| `/api/tasks/{taskId}/cancel` | POST | 取消（冻结 §4.4；`expectedVersion` 可选） |
| `/api/tasks/{taskId}/retry` | POST | 重试（冻结 §4.5；仅 `retryable=manual`） |
| `/api/tasks/{taskId}/resolve` | POST | 处置 `needs_review`（冻结 §3.5/§4.5）：`{expectedVersion, decision:"resume"|"cancel", acknowledgedReceipts}`；校验**条目版本**；`exited_unknown`→409 `exit_unconfirmed` |
| `/api/settings/agent-concurrency` | GET/PUT | 并发（冻结 §5；默认 3；见 §5.4 写模板） |
| `/api/snapshot` | GET | 全量快照＋高水位（冻结 §6；任务条目同形） |
| `/api/events` | GET（SSE） | 任务帧（冻结 §6）＋候选提示帧（进程内，无 `id`，不计 cursor） |

### 5.3 配置与 Provider

| 端点 | 方法 | 请求 → 响应 | 说明 |
|---|---|---|---|
| `/api/models` | GET | — → 200 `{providers, models, defaultModelId, revision}` | 配置读取 |
| `/api/models` | PUT | `{input, expectedRevision}` → 200 `{configuration, warning}` | 配置保存（修订 CAS） |
| `/api/agents/{agentId}` | GET | — → 200 `{configuration}` | 本切片只接线 `organizer` |
| `/api/agents/{agentId}` | PUT | `{input:{expectedRevision,…}}` → 200 `{configuration, warning}` | 保存角色配置 |
| `/api/agents/{agentId}/reset` | POST | `{expectedRevision}` → 200 `{configuration}` | 恢复默认 |
| `/api/providers` | GET | — → 200 provider 能力与凭据引用状态（冻结 §7） | 不回读秘密 |

### 5.4 端点→服务→SQL 目标／模板→权限→反例 闭合表

Rust `transact` 写目标分派（`web_backend_store.rs`）：**业务表**走 `BUSINESS_TABLES` 白名单（DML 含 INSERT/UPDATE/DELETE/REPLACE，语句写目标须为白名单表；守卫的拒绝轴为**非 DML／多语句／禁用关键字／非白名单目标**，settings 另按逐字节模板；**业务表语句不校验参数化**——参数化是服务层约定）；`schema_meta`／`sqlite_sequence` **仅迁移期可写**（由 `rusqlite_migration` 事务执行，不进入 `transact` 白名单）。因此本切片须把 001 的任务系表一并纳入 `BUSINESS_TABLES`，并新增 `agentConcurrency` 两条模板；**不得改为全库放行**。

**`BUSINESS_TABLES` 扩展清单（15 表）**：既有 `manual_items`、`manual_item_events`；新增 `text_sources`、`candidates`、`candidate_previews`、`manual_item_sources`、`sign_off_batches`、`tasks`、`task_attempts`、`task_events`、`task_result_payloads`、`side_effect_receipts`、`instance_epochs`、`recovery_holds`、`recovery_items`。

**settings 模板（在既有 `application.timeZone` 两条之外新增两条，其余 settings 写仍拒）**：

```sql
INSERT INTO settings(key,value,version)VALUES('agentConcurrency',?,1)
UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency' AND version=?
```

| 端点 | 服务函数 | SQL 目标（模板） | 权限条目 | 反例（拒绝） |
|---|---|---|---|---|
| `POST /api/text-sources` | `text-intake-service.submitSource` | INSERT `text_sources`；INSERT `tasks`；INSERT `task_events` | BUSINESS_TABLES | 非 DML／多语句／禁用关键字／非白名单目标→`WEB_BACKEND_SQL_DENIED` |
| `GET /api/text-sources`、`/{id}`、`/{id}/candidates` | `listSources`／`getSource` | SELECT `text_sources`／`candidates`／`tasks` | query（只读 SELECT） | 写语句→拒 |
| `GET /api/candidates/{id}` | `getCandidate` | SELECT `candidates` | query | 写语句→拒 |
| `POST /api/candidates/{id}/edits` | `editCandidate` | UPDATE `candidates`（条件 version） | BUSINESS_TABLES | 非条件更新→影响行数 0→409 |
| `POST /api/candidates/{id}/discard` | `discardCandidate` | UPDATE `candidates`（条件） | BUSINESS_TABLES | 同上 |
| `POST /api/candidates/{id}/revisions` | `requestRevision` | INSERT `tasks`；INSERT `task_events` | BUSINESS_TABLES | — |
| `POST /api/candidates/{id}/previews/{runId}/apply` | `applyPreview` | UPDATE `candidates`（条件）；SELECT `candidate_previews` | BUSINESS_TABLES | 版本不符→409 |
| `POST /api/sign-offs` | `signOff` | INSERT `sign_off_batches`；INSERT `manual_items`；INSERT `manual_item_events`（派生键）；INSERT `manual_item_sources`；UPDATE `candidates`；UPDATE `manual_items`（关联时版本+1） | BUSINESS_TABLES | 单操作键 N≥2→UNIQUE 整批回滚；跨族占键→UNIQUE 整批回滚 |
| `POST /api/tasks` | `task-service.submit` | INSERT `tasks`；INSERT `task_events` | BUSINESS_TABLES | 重复 `operationId` 异输入→409 |
| `GET /api/tasks`、`/{id}`、`/{id}/result` | `list`／`get`／`readResult` | SELECT `tasks`／`task_result_payloads` | query | 写语句→拒 |
| `POST /api/tasks/{id}/cancel` | `cancel` | UPDATE `tasks`（条件）；INSERT `task_events` | BUSINESS_TABLES | 终态→`state_conflict` |
| `POST /api/tasks/{id}/retry` | `retry` | UPDATE `tasks`（条件）；INSERT `task_events` | BUSINESS_TABLES | 非 `retryable=manual`→409 |
| `POST /api/tasks/{id}/resolve` | `resolve` | UPDATE `recovery_items`（条件条目版本）；UPDATE `tasks`（条件）；INSERT `task_events` | BUSINESS_TABLES | `exited_unknown`→409 `exit_unconfirmed` |
| `GET /api/settings/agent-concurrency` | `readConcurrency` | SELECT `settings`（缺省返回 3/version 0，**不写库**） | query | — |
| `PUT /api/settings/agent-concurrency` | `writeConcurrency` | INSERT／UPDATE `settings`（**仅 `agentConcurrency` 两条模板**） | settings 模板扩展 | 非模板形状／其它 key→`WEB_BACKEND_SQL_DENIED` |
| `GET/PUT /api/settings/application` | 既有 | `application.timeZone` 两条模板（**原样保留**） | settings 模板（既有） | 其它 settings 写→拒 |
| `GET /api/snapshot` | `snapshot` | SELECT `tasks`／`task_events`／`settings` | query | 写语句→拒 |
| `GET /api/events`（SSE） | `sse-hub` | 无写（候选帧进程内） | — | — |
| 调度器（内部） | `task-scheduler` | UPDATE `tasks`；INSERT `task_attempts`；UPDATE `task_attempts`；INSERT `task_events`／`task_result_payloads`／`side_effect_receipts`／`instance_epochs` | BUSINESS_TABLES | 迟到结果（attempt/epoch 不匹配）→拒并记审计 |
| 恢复扫描（内部） | `task-recovery` | UPDATE `tasks`／`recovery_items`／`recovery_holds`；INSERT `task_events`／`instance_epochs` | BUSINESS_TABLES | 无法核实旧进程→暂停调度 |
| `GET/PUT /api/models`、`GET/PUT /api/agents/{id}`、`POST /api/agents/{id}/reset`、`GET /api/providers` | `config-store`／`credential-provider` | **不经 `transact`**：读写工作根 `config/` 文件（§4.4）；provider 只读能力／引用状态 | 文件系统原子读写（0600＋rename） | 配置写不进 DB；秘密不回读 |

**迁移期写（不在 `transact` 白名单）**：003 内的 `schema_meta` 镜像 `UPDATE` 与 `sqlite_sequence` 高水位保留，均由 `rusqlite_migration` 在迁移事务内执行。

## 6. 队列、调度与任务生命周期

**实现落点**：`server/lib/task-service.mjs`（提交/查询/取消/重试/并发读改）、`server/lib/task-scheduler.mjs`（单写者调度循环）、`server/lib/worker-host.mjs`（Pi 子进程协议）、`server/lib/task-recovery.mjs`（重启扫描）（后两者可合并）。

### 6.1 提交与调度事务顺序

1. **提交**（单事务）：`INSERT tasks`（`state='queued'`、`attempt_exit_state='not_started'`、`submit_seq=MAX(submit_seq)+1`、`config_revision`、`input_ref`）＋初始 `task_events`（`task.changed`）。成功才返回 202；响应丢失按 `operationId` 重放。
2. **调度**（单写者循环，逐任务单事务）：取最旧 `queued` 且有空槽（`attempt_exit_state IN (active,exiting,exited_unknown)` 计数 `< agentConcurrency`）的任务；条件更新 `state='running'`、`attempt_exit_state='active'`、`version+1`，写 `task_attempts`（attemptId、epoch、worker_pid、started_at）与 `task_events`；`changes=0` 表示被其他写者抢先，跳过。
3. **执行**：`worker-host.spawn(task)` 拉起 Pi 子进程；执行不在事务内。
4. **结果暂存**（单事务）：仅接受 `attemptId`＋`epoch` 匹配的结果帧。置 `result_pending_exit=1`、`pending_outcome='succeeded'|'failed'`、`state='running'`、`version+1`；`extract` 成功时同事务写 `candidates`（`status='staged'`，**退出确认前不可见/不可签收**）＋`side_effect_receipts`＋`task_events`。此时 `result_ref`／`failure`／`terminal_at` 不发布；**槽位不释放**（冻结 §3.2）。
5. **退出确认**（单事务）：worker 退出确认后提交**原暂存结局**：成功→`state='succeeded'`、`result_ref`、`terminal_at`、`attempt_exit_state='exited_confirmed'`，并把 `staged` 候选发布为 `pending`；失败→`state='failed'`、`failure`、`terminal_at`、`attempt_exit_state='exited_confirmed'`，`staged` 候选删除。释放槽位。
6. **取消**：先持久 `cancel_intent=1`、`state='cancelling'`、`attempt_exit_state='exiting'`，再向 worker 发 cancel 帧。退出确认后按是否有暂存结果分流（见 §6.1.1）。
7. **退出未知**：worker 未确认退出时 `attempt_exit_state='exited_unknown'`、**槽位保持占用**、调度器不补发。有暂存结果→`state='needs_review'`、`cause='result_exit_unconfirmed'`、`staged` 候选保持不可见；恢复扫描确认退出后按 §6.1.1 分流。无暂存结果→`state='needs_review'`、`cause='exit_unconfirmed'`。
8. **重启**：启动时注册新 `instance_epochs` 行（与恢复扫描同事务），扫描全部未终态 attempt，核实旧 worker 进程树已退出（worker 记录＋pid 探测）；按 §6.1.1 的分流规则处理（冻结 §3.4 已枚举路径＋本切片补齐组合）。
9. **有界重试**：`retryable=auto_backoff` 且 `failure.sideEffectSafety='proven_safe'` 才自动重入队；预算耗尽降 `manual`；认证/配置错误停止自动重试。

#### 6.1.1 冻结未枚举组合的补齐声明（取消 × 暂存并存）

冻结 §3.4 的取消路径固定 `stagedResult:false`（`cancel_exit_unconfirmed`），`resultPendingExit` 分支固定 `cancelIntent=false`；**「取消 × 暂存并存」未被冻结契约枚举**。本切片按下列规则补齐（不冒称冻结场景已定义）：

- **优先级**：取消意图与暂存结局并存时，**暂存结局优先**（冻结 §3.2「提交原暂存结局」精神）；退出确认且无未知副作用→提交原暂存结局（成功→`succeeded`／失败→`failed`）。
- **恢复 cause／白名单**：若退出确认但副作用未知→保持 `needs_review`，`cause='cancel_unknown_side_effect'`（冻结已枚举）；冻结 §4.3 的读取白名单要求 `needs_review` 且 `cause='result_exit_unconfirmed'` 且 `attempt_exit_state='exited_confirmed'`——本组合 cause 为 `cancel_unknown_side_effect`，**结果不可读**，`staged` 候选保持不可见。若退出无法确认→`needs_review`、`attempt_exit_state='exited_unknown'`、占槽、`resolve`→409 `exit_unconfirmed`。
- **终值**：**所有终态 `cancel_intent=false`**（冻结 §3.1：终态一律 false，意图留事件历史）。提交原暂存结局时同事务置 `cancel_intent=0`。
- **拒绝路径**：非本组合的写入（如把 `staged` 直写 `accepted`）由服务层测试覆盖（DDL 元组 CHECK 不表达该不变量）。

### 6.2 槽位与并发

- 槽位跟随 `attempt_exit_state`（`active`/`exiting`/`exited_unknown` 各占一槽），不跟随业务状态（冻结 §3.2）。
- `agentConcurrency` 缺省 3；上调补发空槽，下调不杀运行任务；`settings` 版本 CAS（冻结 §5）。**写经 §5.4 的两条 `agentConcurrency` 精确模板**（INSERT＋expectedVersion CAS）；`GET` 无保存值时返回缺省 3/version 0 且**不写库**；其它 settings 写仍被守卫拒绝。
- 满槽一律入 `queued`，无「忙碌拒绝」路径。

### 6.3 候选提示与 SSE 补偿

- 任务帧沿用冻结 §6（`id: <epoch>:<cursor>`、`stream.ready`/`stream.reset`、高水位快照）。
- 候选/来源变更经 `GET /api/events` 广播 `candidate.changed` 帧作为**进程内提示**：无 `id` 行、不计任务 cursor、不写 `task_events`；客户端在首次订阅/重连/`stream.reset` 后经 `/api/text-sources`／`/api/candidates` 读回补偿（沿用 W1 M2 选项②）。

## 7. Pi Runtime 进程接线与 bundle 路径

**层界**：`server/` 只可相对引用 `server/`／`shared/`，不得 import `runtime/`（`scripts/build/build-backend.mjs` 强制）。因此后端**以子进程方式**调用随包 Pi Runtime，不引用其模块。

- **bundle 路径**：`build-backend.mjs` 在装配后端 bundle 时，将 `bundle-runtime.mjs` 产出的 `organizer.mjs` 及其依赖（`bash-worker.mjs`、`mcp-guardian.mjs`、`skills/`、`lark-cli`、随包 `node`）复制进 `build/web-backend/runtime/`；后端启动参数 `--runtime-root` 指向该目录（缺省 `../runtime`）。
- **协议**：复用 `runtime/entries/organizer-entry.mjs` 的 stdio JSON 行协议——请求行 `{runId,hostNonce,kind,snapshot,source|candidate,instruction,anchorAtMs,timeZone,apiKey,cwd,runLimitMs,mcp?}`；输出行 `{type:'progress'|'result'|'error'|'worker',…}`。请求/响应帧不得写入日志或 SSE。
- **秘密**：`apiKey` 由 `CredentialProvider` 在执行前解析，经 stdin 私有通道注入；不落 SQLite/argv/配置/日志/SSE。
- **取消/超时**：后端发 `{type:'cancel'}` 帧；`runLimitMs` 由后端与运行时双重 enforce；子进程退出但无结果帧 → `exited_unknown`。
- **worker 记录**：每次 attempt 在工作根写 0600 记录（pid＋hostNonce＋身份快照），布局以[后端基础探针](backend-foundation-probes.md)已验证的 `runs/worker.json` 为准；并发多槽时扩展为 `runs/<runId>/worker.json`，语义（0600／pid 三态探测／不可核实即暂停调度）与探针 D 组一致。重启扫描核实记录与进程树，无法核实则暂停调度。
- **CredentialProvider**：
  - `controlled`（受控测试）：测试专用注入，供受控模型服务验证生产 Pi 调用与任务路径；
  - `os`（生产）：macOS Keychain / Linux env；经 Rust 凭据 helper（新增命令面或独立二进制）解析，Node 不直接读钥匙串。生产 provider 的实施需另行授权（见授权文档）。

## 8. 模块／目录／函数提案

### 8.1 后端（新增，均在 `server/`）

```text
server/lib/text-intake-service.mjs     # 来源/候选/预览/签收事务（版本、幂等、原子）
server/lib/task-service.mjs            # 任务提交/查询/取消/重试/并发
server/lib/task-scheduler.mjs          # 单写者调度循环、槽位分配、取消/退出处理
server/lib/worker-host.mjs             # Pi 子进程 stdio 协议、超时、取消、worker 记录
server/lib/task-recovery.mjs           # 重启扫描与恢复分流
server/lib/config-store.mjs            # 工作根 config/ 原子读写与修订
server/lib/credential-provider.mjs     # 引用解析接口＋controlled/os 实现
server/lib/model-snapshot.mjs          # 任务输入快照（provider/model/agent/skills）
```

Rust 侧：

```text
src-tauri/src/store/web_backend_schema.rs  # SCHEMA_VERSION→3；migrations() 追加 003；故障注入分支适配三迁移
src-tauri/src/store/web_backend_store.rs   # BUSINESS_TABLES 扩到新表；写目标分派
src-tauri/src/store/web_backend_store_tests.rs  # 新表写目标与拒绝反例
src-tauri/migrations/web-backend/003_text_intake.sql  # 双表重建＋五新表
```

### 8.2 前端（新增/修改）

```text
src/lib/web-api-client.ts   # 扩展 text-sources/candidates/sign-offs/tasks/models/agents 方法
src/stores/organizer.ts     # invoke → HTTP（保留 domain/candidate.ts 与组件）
src/stores/models.ts        # invoke → HTTP（配置端点）
src/stores/agents.ts        # invoke → HTTP（本切片只接线 organizer）
src/components/TextIntake.vue / InboxView.vue / CandidateCard.vue  # 复用，仅按新错误码/状态调整
```

今日建议的**事项事实列表与完成路径**沿用既有纯逻辑（`shared/today-facts.mjs` 基于事项列表计算），本切片不新增模型类型；advisor 模型建议归 W2，故 `src/stores/today.ts` 的模型运行部分不在本切片。

### 8.3 关键函数

- `text-intake-service.mjs`：`submitSource`、`listSources`、`getSource`、`editCandidate`、`discardCandidate`、`requestRevision`、`applyPreview`、`signOff`。每个写操作组单事务（条件更新＋候选/事项/来源关联/事件同事务）。
- `task-scheduler.mjs`：`tick()`（领任务→spawn→结果/取消/退出）、`recover()`（重启扫描）、`requeueBackoff()`。
- `worker-host.mjs`：`spawn(task)`、`cancel(runId)`、`confirmExit()`。
- `config-store.mjs`：`read(kind)`、`write(kind, value, expectedRevision)`。
- `credential-provider.mjs`：`resolve(ref)`、`status(ref)`。

## 9. 实现顺序

1. **数据层**：003 迁移＋Rust `BUSINESS_TABLES` 扩展＋新表单测（约束/迁移/回滚反例）。
2. **配置与凭据**：`config-store.mjs`＋`credential-provider.mjs`（controlled 先行）。
3. **任务底座**：`task-service`＋`task-scheduler`＋`worker-host`＋`task-recovery`；集成测试覆盖提交/排队/取消/退出未知/重启。
4. **文本与候选**：`text-intake-service`＋来源/候选/预览/签收端点。
5. **Pi 接线**：`build-backend.mjs` 纳入 runtime bundle；受控服务跑通 extract/revise/test。
6. **前端接线**：`web-api-client` 扩展＋`organizer/models/agents/today` store 切换。
7. **验收**：聚焦＋浏览器矩阵＋重启/失败/冲突＋完整门禁。

## 10. 端到端可观察验收

| 验收项 | 可观察结果 | 反例 |
|---|---|---|
| 文本提交 | 来源落库、任务入队、页面显示排队/运行 | 未落库就显示成功；重复提交创建两个任务 |
| 满槽排队 | 第 4 个任务 `queued`＋`queuePosition`；无忙碌拒绝 | 返回 409 忙碌 |
| 候选核对 | 候选字段/依据/警告与模型输出一致；未签收零正式事项 | 未签收即出现正式事项 |
| 编辑/版本冲突 | 旧版本提交 409；刷新后按新版本 | 旧版本静默覆盖 |
| 关联/丢弃 | 关联只加来源不覆盖目标；丢弃留痕 | 关联改写目标字段；丢弃可恢复 |
| 修改预览 | 预览不直接覆盖；应用后版本递增 | 预览直接改候选 |
| 批量签收 | N≥2 一次事务新建/关联；批次台账＋派生行键；部分失败整体回滚；重放返回原结果 | 单操作键撞行级 UNIQUE；半批入库；重放重复入库 |
| 时间核对 | 未定期须 `timeReviewed`；原文表达保留 | 编造时刻 |
| 结果暂存/退出确认 | 结果帧先暂存（`result_pending_exit=1`、`staged` 候选不可见/不可签收）；退出确认才发布原结局并释放槽 | 结果帧即终态；暂存候选提前展示/签收 |
| 取消/退出未知 | 取消意图持久；退出未知占槽、不自动重发；暂存结果按冻结 §3.4 分流 | 退出未知释放槽并重发 |
| 重启恢复 | 来源/候选/任务/事项/历史原样重现；暂存结果按原结局提交 | 重启丢候选或任务回退 |
| 响应未知 | 按 `operationId`/`taskId` 读回，不重复创建 | 读回缺失或重复入库 |
| 并发设置 | `PUT` 走 `agentConcurrency` 两条模板；非模板形状被拒；`GET` 缺省 3/version 0 不写库 | 其它 settings 写被拒；GET 写库 |
| 序列高水位 | 迁移保留历史 `sqlite_sequence` 高水位（含删尾与无行非零）；新事件不复用旧值 | 高水位回落致复用 |
| 秘密 | 凭据引用入库；秘密不入日志/SSE/argv | 日志出现密钥 |
| 无模型 | 手工事项路径完整可用 | 无模型时手工路径回归 |
| 真实同源 UI | 浏览器加载后端同源静态资源与 API | 依赖设计预览/合成 IPC |

## 11. 验证命令

| 层面 | 命令 | 状态 |
|---|---|---|
| Rust 存储 | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 已有（接入 003 后须扩展新表目标用例） |
| Rust schema | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 已有（接入 003 后重跑） |
| 服务域 | `node --test tests/unit/web-text-intake.test.mjs` | 拟新增 |
| HTTP 集成 | `node --test --test-timeout=20000 tests/integration/web-text-intake-http.test.mjs` | 拟新增 |
| 队列/重启 | `node --test --test-timeout=20000 tests/integration/web-text-intake-queue.test.mjs` | 拟新增 |
| Pi 受控 | `node --test tests/integration/web-text-intake-controlled-model.test.mjs` | 拟新增（受控服务） |
| 结构／文档 | `npm run check:structure && npm run check:docs` | 已有 |
| 完整门禁 | `npm run check`（唯一集成执行者串行） | 流程要求 |
| 浏览器矩阵 | Playwright 1440×1000／640×900，加载后端同源 UI，覆盖 §10 | 拟新增 |

**本轮合成对照（证据见附件）**：`build/web-text-intake-contract/ddl-counterexample.mjs` 以 `node:sqlite`＋`foreign_keys=ON` 内存库验证：003 双表重建（行＋事件＋`sqlite_sequence` 高水位保留）、删尾／无行非零高水位边界、N≥2 批次与 `sign_off:` 派生键、重放映射、`staged` 不可见→确认发布、终态 `cancel_intent=false`、故障回滚重开。脚本与输出随评论附件交付。

## 12. 依赖与后续

- **本切片依赖**：W1 手工事项已准出（main `1e37044`）、本提案评审通过、具体 DDL 与新增授权收口。
- **后续切片**：飞书链接与主动收集（W3）、提醒与日报（W4）、Skills/MCP 业务接线（W2/W3）、真实模型验收（另行开放）。
- **真实模型**：本切片只用受控服务验证生产 Pi 调用与任务路径；真实模型验收单独开放，不以受控验证冒称真实通过。

## 13. 未决与边界

- 本文件是提案，不是冻结契约或实施通过声明；字段、端点、错误码、表结构与模块落点经独立评审后冻结。
- 本切片不创建迁移文件、不安装依赖、不改 manifest/锁文件/守卫、不操作真实数据库/凭据/工作根、不调用真实模型。
- Linux/代理部署、真实模型/来源调用、真实凭据/用户根、push 与发布均未授权，不在本切片验收范围。
- 既有 Tauri/Rust 实现与 W0/W1 证据继续有效于其原版本，本提案不外推为新 Web/Linux 已通过。
