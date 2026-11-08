# Web 手工事项纵向契约（W1 P1 提案）

> 状态：**提案（proposal），未冻结、未实现**。本文是 MAYNE-23 P1 的交付物；契约冻结与实施准入由 Codex/owner 依据独立评审与授权收口。本文不创建迁移文件、不安装依赖、不改 manifest/锁文件、不操作真实数据库、凭据或工作根。
> 共同基点：本地 main `65469904d8baddde738646dfed3bf4a921f47b68` / tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`（未 push）。W0 已测候选 `e32860f` 与该 tree 逐字节一致；`web-api/1` 已按实际版本冻结。
> 依据：[产品定义](../product/01-产品定义.md)、[用户流程](../product/02-用户流程.md)、[智能体与架构](../product/03-智能体与架构.md)、[分期交付与验收](../product/04-分期交付与验收.md)、[实施计划](../product/05-第一阶段实施计划.md)、[Web/后端设计](web-backend-design.md)、[Web API 契约](web-api-contract.md)（`web-api/1`）、[工程架构](architecture.md)、[后端基础探针](backend-foundation-probes.md)、[浏览器任务交互](web-task-interaction.md)。
> 授权对应与逐文件变更／DDL 提案见[授权差异提案](../reviews/web-manual-items-authorization-20261108.md)。
> **本轮修订**：本版为 P1 首轮独立评审（ZCode `2706044`）后的修订版，处理 B1、M1–M3、m1–m7；逐项处置见授权文档 §9 与 `build/web-manual-items-contract/revision-disposition.md`。已核实的产品方向、身份与授权对应不变。

## 1. 范围与边界

W1 的完整纵向是：**浏览器表单 → HTTP → 后端事务 → 新库 → 列表/详情 → 编辑/完成/删除/历史 → 重启恢复；无模型也能用**，并保留产品规定的两类事项（待我处理／待我跟进）与时间规则。

本提案只覆盖其中的**手工事项纵向切片**，即无模型、无飞书、无候选签收时也能完整使用的一条端到端路径。以下事项**不在本切片**，其契约与准入在后续切片处理（见 §13）：

- 模型配置、Provider 能力与凭据引用（W1 后半）；
- 最小 organizer/Pi 执行链、候选编辑／自然语言预览／批量签收（W1 后半）；
- 今日建议的模型部分（W2）；
- 飞书来源、进展跟踪、提醒与日报（W3/W4）。

本切片必须交付的是上述纵向中**不依赖模型与来源**的部分，以及承载后续切片的 HTTP/会话/静态供给/存储底座。

## 2. 来源逐项处置（已明确可复用 / 实际缺口 / 提案）

处置分三类：**复用**＝已有已确认契约或已验证实现可直接使用；**缺口**＝目标需要但当前不存在；**提案**＝本文件给出的最小一致设计，待评审。

| 领域 | 来源（已确认／已验证） | 处置 | 说明 |
|---|---|---|---|
| 用户路径·表单录入 | [用户流程 §2](../product/02-用户流程.md)、[实施计划 §10 S1](../product/05-第一阶段实施计划.md) | 复用＋缺口 | 产品动线已确认；浏览器表单已存在于旧 Tauri 实现（`src/components/QuickEntry.vue`、`src/domain/todos.ts`），但经 Tauri IPC，需切换到 HTTP（提案 §9） |
| 用户路径·列表／详情 | [用户流程 §4](../product/02-用户流程.md)、旧实现 `src/components/Workbench.vue`／`TodoRow.vue` | 复用＋缺口 | 两类事项、无截止、本周／逾期／完成筛选与今日归组逻辑已在 `src/domain/todos.ts` 实现并经旧门禁；需改为读 HTTP 资源 |
| 用户路径·编辑／完成／重开／删除 | [用户流程 §4](../product/02-用户流程.md)、[产品定义 §3](../product/01-产品定义.md) | 复用＋缺口 | 业务规则已确认；旧实现 `local_store.rs` 的 `update`／`set_completed`／`delete` 可复用其语义，但需在新库以 HTTP 事务重新落地 |
| 用户路径·历史 | [用户流程 §4](../product/02-用户流程.md)、旧库 `todo_events` | 复用＋缺口 | 事件台账语义已确认（操作 ID、动作、前后快照）；新库需新增 `manual_item_events`（提案 §7） |
| 用户路径·重启恢复 | [用户流程 §8](../product/02-用户流程.md)、[分期验收 §2](../product/04-分期交付与验收.md) | 缺口 | 旧实现依赖 Tauri 应用生命周期；新后端须显式实现重启后事项／历史恢复（提案 §10） |
| 字段 | [实施计划 §10 S1](../product/05-第一阶段实施计划.md)、旧库 `001_todos.sql`／`002_ingestion.sql` | 复用＋提案 | 标题、类型、负责人、优先级、截止、下次跟进、标签、状态、版本、来源已确认；新库字段与线格式见 §4 |
| 错误与状态 | [Web API 契约 §3.2/§10](web-api-contract.md) | 复用＋提案 | 错误包络、`validation_failed`／`version_conflict`／`state_conflict`／`idempotency_conflict` 等已冻结；新增 `item_not_found`（提案 §5） |
| 版本冲突 | [Web API 契约 §3.3/§4.4](web-api-contract.md) | 复用 | `expectedVersion` 乐观并发、过期 409、读回后按新版本决策；旧实现 `local_store.rs::validate_change` 已验证同一语义 |
| 幂等 | [Web API 契约 §3.3/§4.1](web-api-contract.md) | 复用 | `operationId` 全局唯一、同 ID 同规范输入重放返回同一对象、不同输入 409；旧实现 `replay`／`validate_operation` 可复用 |
| 响应未知 | [Web API 契约 §1.1/§4.2](web-api-contract.md) | 复用 | 提交成功才返回；响应丢失按 ID 读回，不盲目重复提交 |
| 时间语义 | [用户流程 §3](../product/02-用户流程.md)、[实施计划 V02](../product/05-第一阶段实施计划.md)、`shared/dates.mjs` | 复用 | 时点存 UTC＋时区＋原表达、仅日期精度、相对日期按来源锚点；`shared/dates.mjs` 与 `src/domain/todos.ts` 已实现并经旧门禁 |
| 删除与历史语义 | [用户流程 §4](../product/02-用户流程.md)、旧库 `todos`／`todo_events` | 复用＋提案 | 删除为软删除；默认清单排除、详情与历史可读、变更操作一律拒绝（提案 §6/§7） |
| 无模型可用性 | [用户流程 §1](../product/02-用户流程.md)、[分期验收 §1](../product/04-分期交付与验收.md) | 复用 | 已确认“无模型连接时仍可手工管理事项”；本切片即该路径的最小完整实现 |
| 会话／CSRF／Origin | [Web API 契约 §2/§10](web-api-contract.md) | 复用＋缺口 | 配对码换会话、HttpOnly/SameSite=Strict cookie、写请求 CSRF＋精确 Host/Origin 已冻结；当前无实现（提案 §9） |
| 错误包络 | [Web API 契约 §10](web-api-contract.md) | 复用 | `{"contractVersion":"web-api/1","status":<int>,"error":{"code","message","details"?}}` |
| 端到端可观察验收 | [分期验收 §2](../product/04-分期交付与验收.md)、[Web/后端设计 §7](web-backend-design.md) | 复用＋提案 | 验收组与反例要求已确认；本切片的可观察验收见 §11 |
| 同源静态供给 | [Web/后端设计 §3](web-backend-design.md) | 缺口 | 设计明确“同源提供 Web 静态资源、业务 API 与 SSE”；当前无实现（提案 §9.2/§9.4） |
| 存储边界 | [Web/后端设计 §2](web-backend-design.md)、[后端基础探针](backend-foundation-probes.md) | 复用＋缺口 | Rust 适配拥有连接／根锁／短事务的模式已验证（68/68 探针）；生产适配二进制与事项操作未落地（提案 §9） |
| 新库 schema | `src-tauri/migrations/web-backend/001_web_backend.sql`（W0 已审） | 复用＋缺口 | 11 张任务队列表已交付；手工事项表缺失（提案见授权文档 §5） |
| 前端 HTTP 客户端 | 无 | 缺口 | 当前 `src/stores/todos.ts` 直连 `@tauri-apps/api/core`；需新增 HTTP 客户端（提案 §9） |
| 后端进程 | 无 | 缺口 | 无 Node HTTP 服务端；需新增（提案 §9） |

## 3. 用户路径

本切片必须覆盖的路径（与[用户流程](../product/02-用户流程.md)、[实施计划 §10 S1](../product/05-第一阶段实施计划.md)一致）：

1. **配对**：启动本机后端 → 浏览器打开 → 输入后端显示的一次性配对码 → 进入工作台。
2. **表单保存**：填写标题、类型（待我处理／待我跟进）、实际负责人、优先级、可空截止、独立的下次跟进、标签 → 保存 → 事项出现在真实列表。
3. **列表／详情**：今日工作台与完整清单可查看；详情展示全部字段与历史；两类事项与无截止事项归组正确。
4. **编辑**：修改任一字段 → 保存 → 版本递增；旧版本提交被拒并提示刷新。
5. **完成／重开**：完成 → 状态与完成时间更新；重开 → 回到待处理；历史保留两次动作。
6. **删除**：明确确认 → 软删除 → 从默认清单排除、详情与历史保留。
7. **重启恢复**：关闭浏览器不丢；后端重启后事项、状态与历史原样重现（W0 任务队列状态按其自身契约保留，不在本切片范围）。
8. **无模型**：无模型、无飞书、无 MCP 时，上述 1–7 完整可用。

## 4. 手工事项资源与字段

### 4.1 线格式（wire format）

响应与请求体为 UTF-8 JSON，均携带 `contractVersion: "web-api/1"`（沿用冻结契约的版本标识；本资源为兼容扩展，不改动冻结契约已有字段）。时间字段用 ISO 8601 UTC 毫秒字符串；带时区语义的时间点用 `TimePoint` 对象。

```json
{
  "contractVersion": "web-api/1",
  "itemId": "mi_0f3a9c21e7b44d58a6c0f1e2d3b4a5c6",
  "title": "周五前提交方案并请张三评审",
  "kind": "action",
  "owner": "李四",
  "priority": "high",
  "status": "open",
  "due": {
    "at": "2026-11-13T10:00:00.000Z",
    "timeZone": "Asia/Shanghai",
    "localText": "2026-11-13 18:00",
    "precision": "minute"
  },
  "followup": null,
  "tags": ["方案", "评审"],
  "createdAt": "2026-11-08T02:30:00.000Z",
  "updatedAt": "2026-11-08T02:30:00.000Z",
  "completedAt": null,
  "deletedAt": null,
  "version": 1,
  "source": "manual"
}
```

本切片为 manual-only，线格式不含 legacy 的 `capture_method`（`local_store.rs:15`）；候选签收切片接入时再定义 `capture_method` 与 `source` 的字段映射（见 §13）。

### 4.2 字段规则

| 字段 | 类型 | 规则 |
|---|---|---|
| `itemId` | string | `mi_<32hex>`，后端生成 |
| `title` | string | 非空，去首尾空白；最大长度 500 字符 |
| `kind` | enum | `action`（待我处理）／`followup`（待我跟进） |
| `owner` | string | 非空；最大长度 200 字符 |
| `priority` | enum | `low`／`medium`／`high` |
| `status` | enum | `open`／`completed`／`deleted`；由后端派生，不接受客户端直接设置 |
| `due` | TimePoint \| null | 我的截止时间；可空 |
| `followup` | TimePoint \| null | 下次跟进时间；仅 `followup` 类型有意义，可空 |
| `tags` | string[] | 去重、去空白、每项 ≤50 字符、最多 20 项 |
| `version` | int | 从 1 起，每次变更递增；客户端变更必须携带已见版本 |
| `source` | enum | 本切片恒为 `manual`；候选签收切片再扩展 |
| `createdAt`／`updatedAt` | string | ISO 8601 UTC 毫秒；后端写入 |
| `completedAt`／`deletedAt` | string \| null | 仅对应状态为非空时间，其余恒为 `null` |

`TimePoint` 对象：

| 字段 | 类型 | 规则 |
|---|---|---|
| `at` | string | ISO 8601 UTC 毫秒 |
| `timeZone` | string | IANA 时区标识，非空 |
| `localText` | string | 用户原始表达，原样保留 |
| `precision` | enum | `minute`／`day`；仅日期时 `day` |

### 4.3 创建／更新输入与更新语义

```json
{
  "title": "周五前提交方案并请张三评审",
  "kind": "action",
  "owner": "李四",
  "priority": "high",
  "due": { "at": "2026-11-13T10:00:00.000Z", "timeZone": "Asia/Shanghai", "localText": "2026-11-13 18:00", "precision": "minute" },
  "followup": null,
  "tags": ["方案", "评审"]
}
```

创建请求体：`{ "operationId": "op_<32hex>", "input": { … } }`。
更新请求体：`{ "operationId": "op_<32hex>", "expectedVersion": 1, "input": { … } }`。
完成／重开／删除请求体：`{ "operationId": "op_<32hex>", "expectedVersion": 1 }`。

更新语义（m2）：

- **整体替换**：`input` 为完整字段集，未出现的字段按缺省处理；不提供部分更新（partial patch）。
- **`kind` 可互换**：`action` ↔ `followup` 允许，版本递增并留历史。
- **`followup` 挂在 `action` 类**：接受但忽略（与 legacy `effectivePoint` 一致，`src/domain/todos.ts:39`）；不报错、不写入有效归组。
- **`due` 挂在 `followup` 类**：允许，作为回退归组时间。

## 5. HTTP 接口提案

所有端点位于 `/api` 前缀下，沿用[冻结契约](web-api-contract.md)的会话、CSRF、Origin 与错误包络。除注明外均为同步短事务，成功返回 200。

| 端点 | 方法 | 请求 → 成功响应 | 主要错误 |
|---|---|---|---|
| `/api/manual-items` | POST | `{operationId, input}` → 200 `{item}`；同 `operationId` 重放 → 200 `{replayed:true, item}` | 400 `validation_failed`；409 `idempotency_conflict` |
| `/api/manual-items` | GET | `?status=&kind=&cursor=&limit=` → 200 `{items:[…], nextCursor}` | 400 `validation_failed` |
| `/api/manual-items/{itemId}` | GET | — → 200 `{item}` | 404 `item_not_found` |
| `/api/manual-items/{itemId}` | PUT | `{operationId, expectedVersion, input}` → 200 `{item}` | 409 `version_conflict`／`state_conflict`；404 `item_not_found` |
| `/api/manual-items/{itemId}/complete` | POST | `{operationId, expectedVersion}` → 200 `{item}` | 409 `state_conflict`（当前态非 `open`） |
| `/api/manual-items/{itemId}/reopen` | POST | `{operationId, expectedVersion}` → 200 `{item}` | 409 `state_conflict`（当前态非 `completed`） |
| `/api/manual-items/{itemId}` | DELETE | `{operationId, expectedVersion}` → 200 `{item}` | 409 `state_conflict`（当前态为 `deleted`） |
| `/api/manual-items/{itemId}/history` | GET | `?limit=&cursor=` → 200 `{events:[…], nextCursor}` | 404 `item_not_found` |

**状态迁移表**（m3，取代自然语言描述）：

| 动作 | 允许的当前状态 | 次态 | 版本 |
|---|---|---|---|
| `complete` | `open` | `completed` | +1 |
| `reopen` | `completed` | `open` | +1 |
| `delete` | `open`／`completed` | `deleted` | +1 |
| `update` | `open`／`completed` | 不变 | +1 |

约定：

- **配对与会话**：`POST /api/pair`、`GET/DELETE /api/session` 沿用[冻结契约 §2](web-api-contract.md)，本切片不新增端点。
- **写请求**：必须携带有效会话、CSRF token 与精确 Host/Origin；不合格返回 403 `csrf_invalid`／`origin_rejected`，请求不入库。
- **列表分页**（m1）：排序键 `created_at_ms DESC, item_id ASC`；`cursor` 为不透明 token，编码复合水印 `(created_at_ms, item_id)`；`nextCursor` 为空表示没有更多；`limit` 默认 50、最大 200。插入稳定性（MINOR-1）：`created_at_ms DESC` 下，新事项只出现在**重新读取的首页**；进行中分页不被打乱、游标不跳行；同毫秒并列由 `item_id` 决定。
- **列表过滤与删除可见性**（M1）：`status` 缺省 = `open`＋`completed`（排除 `deleted`）；`status=deleted` 显式返回已删除事项（历史/审计）；`status=all` 返回全部；`status=open`／`completed` 分别过滤。
- **历史分页**（n1）：`/history` 按 `sequence DESC` 稳定分页，`cursor` 编码 `sequence` 水印，`limit` 默认 50、最大 200，`nextCursor` 为空表示没有更多。
- **事件（M2，选项②：进程内提示）**：事项变更经 `GET /api/events`（SSE）广播 `item.changed` 帧作为**进程内变更提示**，不享有冻结任务事件流的持久游标与断线重放能力：
  - 帧形如 `event: item.changed`，`data` 携带 `{contractVersion, objectType:"item", itemId, itemVersion, at}`；**不带 `id` 行**，**不计入任务 cursor**，不写入 `task_events`。
  - 任务帧（`task.changed`／`task.progress`／`settings.changed`／`workspace.changed`／`recovery.changed`）与 `stream.ready`／`stream.reset` 的 cursor／epoch 语义完全不变；事项帧与任务 cursor 相互隔离。
  - 客户端在**首次订阅后、每次重连后、收到 `stream.reset` 后**，以及怀疑提示丢失时，通过 `GET /api/manual-items`／`/{itemId}` 读回补偿；提示仅用于触发刷新，不作为事实来源。
  - 列表分页期间的一致性以列表／详情读回为准；提示漏收不得造成可见状态回退。
- **新增错误码**：仅 `item_not_found`（404）；其余复用冻结契约 §10 注册表。

## 6. 版本冲突、幂等与响应未知

- **幂等**：`operationId` 由客户端为每次用户意图生成稳定键。同一 `operationId` 重放按幂等规则返回 `replayed:true` 与当前权威状态，不创建第二件事；同 ID 不同规范输入返回 409 `idempotency_conflict`。规范输入含 `input` 的规范化形式与 `expectedVersion`。
- **重放优先于状态守卫**（M1）：同 `operationId` 且同规范输入的已提交操作，即使事项当前处于 `deleted` 等状态，仍按幂等规则返回 `replayed:true` 与当前权威状态，不因当前状态返回 409；状态守卫不得前置于幂等重放。
- **版本冲突**：更新／完成／重开／删除必须携带客户端已见的 `expectedVersion`。后端以 `UPDATE … WHERE item_id=? AND version=?` 的条件更新并校验影响行数；不匹配返回 409 `version_conflict`，客户端读回后按新版本重新决策。同 `operationId` 重放不消耗版本。
- **响应未知**：提交成功（返回 200）即已落库；响应丢失时客户端用同一 `operationId` 重放或按 `itemId` 读回，不盲目重复提交。后端不承诺网络层去重，只承诺幂等键去重。
- **删除后的读取与变更**（M1）：对 `deleted` 事项，`GET /api/manual-items/{itemId}` 与 `/history` 可读；`PUT`／`complete`／`reopen`／`DELETE` 一律返回 409 `state_conflict`。

## 7. 时间、删除与历史语义

- **时间**：时点存 UTC 毫秒＋时区＋原表达；`precision=day` 时只保证日历日，不编造时刻。相对日期以来源时间与时区为锚，缺失时明示使用解析时间（沿用[用户流程 §3](../product/02-用户流程.md)与 `shared/dates.mjs`）。
- **两类事项的时间**：`action` 用 `due`（我的截止时间）；`followup` 的今日归组优先用 `followup`，未设时回退 `due`；两个时间独立保存、独立展示、互不改写（沿用 `src/domain/todos.ts::effectivePoint`）。
- **删除**：软删除，`status=deleted`、`deleted_at_ms` 非空；默认清单排除，详情与历史可查；删除需明确确认。
- **历史**：每次变更写一条 `manual_item_events`，含 `operationId`、动作、发生时点、规范请求与前后快照；事项与历史在同一事务提交，失败整体回滚。
- **完成／重开**：完成写 `completed_at_ms`；重开清空 `completed_at_ms` 并回到 `open`；两者都递增版本并留历史。

## 8. 无模型可用性

- 本切片不调用模型、飞书、MCP 或 Bash；后端启动不要求模型配置或凭据可用。
- 前端在模型/来源不可用时，手工表单、列表、详情、编辑、完成、删除、历史、重启恢复全部可用；界面不显示假的成功状态。
- 后续切片接入模型任务时，手工事项路径不得回归。

## 9. 模块／目录／函数提案

### 9.1 存储边界（Rust → Node）

沿用[Web/后端设计 §2](web-backend-design.md)：Rust 适配统一拥有业务连接与根锁，暴露异步调用的存储接口；Node 不用 `node:sqlite` 按路径重开业务库。接口形态沿用[后端基础探针](backend-foundation-probes.md)已验证的**子进程 stdio JSON 模式**（argv 传参、stdout 末行 JSON、退出码 0/1、stdin-EOF 优雅关停、根锁生命周期；零新依赖）：

| 命令 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `init` | `{root}` | `{ok}` | 显式初始化新根（唯一创建路径） |
| `open` | `{root}` | `{ok}` | 打开已有根并校验 lineage／版本／文件身份 |
| `close` | — | `{ok}` | 关库并释放根锁 |
| `backup` | `{destination}` | `{ok}` | 一致性备份（迁移前必做） |
| `transact` | `{ops:[{sql,params}]}` | `{results:[{rows:[…]}]}` | 单事务原子执行；任一句失败整体回滚 |
| `query` | `{sql,params}` | `{rows:[…]}` | 只读查询 |
| `pragma` | `{name}` | `{value}` | 只读事实 |

**新增与已验证的边界**（m4）：上表七命令帧协议、`transact` 的 op-list 帧格式与请求关联为本提案**新增**，不在探针子命令集内；探针已验证的是子进程调用模式与锁生命周期，新协议须经 §10 步骤 1/2 的测试自证，不冒称已被探针实测。

**SQL／PRAGMA 权限范围**（m5）：

- `transact` 仅接受参数化 SQL（`params` 数组绑定），语句目标限于 `web-backend/1` 业务表（本切片为 `manual_items`、`manual_item_events`，后续切片按表扩展）；不接受 `ATTACH`／`DETACH`／`PRAGMA` 写入／`load_extension`／`VACUUM`／`COPY` 等。
- `query` 只读，限 `SELECT` 与只读 `PRAGMA`。
- `pragma` 仅返回只读事实（`journal_mode`／`user_version`／`application_id`／`foreign_keys`／`busy_timeout` 等），不接受写入类 PRAGMA。
- 适配二进制以受控权限运行，不暴露 shell；路径参数经规范化与根锁校验。

Node 侧 `server/lib/storage-client.mjs` 封装子进程拉起、stdin/stdout 帧解析、退出码与错误映射。

### 9.2 目录与落点

新增顶层 `server/`（与 `runtime/` 分离：`runtime/` 是随包任务 Runtime，`server/` 是后端主机进程）：

```text
server/
  entries/
    web-backend-entry.mjs        # 进程入口：启动配置、根锁、装配 HTTP/SSE、静态供给、恢复扫描、优雅关停
  lib/
    http-server.mjs              # node:http 服务器、路由、错误信封
    session-store.mjs            # 配对码/会话/CSRF/限速
    manual-items-service.mjs     # 事项业务事务（校验、版本、幂等、历史）
    storage-client.mjs           # Rust 适配 stdio 客户端
    sse-hub.mjs                  # SSE 广播（任务帧不变；事项帧为进程内提示）
    static-files.mjs             # 同源静态供给：服务前端 dist/，MIME/缓存/SPA fallback
```

Rust 侧（登记点按基点源码核实，见 §9.5）：

```text
src-tauri/src/store/web_backend_store.rs         # 事项存储操作（transact/query/backup 协议实现）
src-tauri/src/store/web_backend_store_tests.rs   # 事项存储操作单测
src-tauri/src/bin/web-backend-storage.rs         # stdio 二进制入口（新增 bin/ 顶层，见 §9.5）
src-tauri/migrations/web-backend/002_manual_items.sql  # 新表迁移
```

前端侧（接线文件按基点源码核实，见 §9.6）：

```text
src/lib/web-api-client.ts    # 新增：fetch 封装（base URL、CSRF、错误包络、operationId）
src/stores/pairing.ts        # 新增：配对会话状态（参照 createDesktopPreferences 的 create*(api) 模式）
src/components/PairingGate.vue  # 新增：无会话时显示配对码输入，成功后渲染默认 surface
src/App.vue                  # 修改：默认 surface 经 PairingGate 渲染 Workbench
src/stores/todos.ts          # 修改：由 Tauri invoke 切换到 HTTP 客户端（保留 domain 逻辑）
```

### 9.3 关键函数（提案）

- `manual-items-service.mjs`：`createItem`、`updateItem`、`completeItem`、`reopenItem`、`deleteItem`、`getItem`、`listItems`、`history`。每个写操作：校验输入 → 组事务脚本（条件更新＋历史插入）→ `transact` → 失败整体回滚。
- `http-server.mjs`：`route(req,res)` 按 `(method, pathname)` 分发；写请求经 `session-store` 校验；错误经 `errorEnvelope` 输出；`/api` 之外的路径交给 `static-files`。
- `web-api-client.ts`：`request(method, path, body)` 注入 CSRF、解析错误包络、把 `item_not_found`／`version_conflict` 映射为可识别错误。
- `web_backend_store.rs`：`transact`／`query`／`backup`／`open`／`init` 的协议帧解析与执行。

### 9.4 同源静态供给与构建接入（M3）

设计 §3 要求后端**同源**提供静态资源、业务 API 与 SSE。逐文件清单：

| 路径 | 内容 |
|---|---|
| `server/lib/static-files.mjs` | 从可配置静态根（默认为随包前端产物目录）提供 `index.html` 与资源；正确 MIME；带 hash 的资源长缓存，`index.html` 不缓存；`/api` 路径不 fallback；SPA 路由 fallback 到 `index.html` |
| `scripts/build/build-backend.mjs`（确定落点，不再二选一） | 打包 `server/entries/web-backend-entry.mjs` 与依赖，并把前端 `dist/` 复制进后端 bundle 输出目录；不新增生产依赖 |
| `package.json` | 新增 `build:backend`／`start:backend` 脚本（由集成任务统一维护） |
| `tests/integration/web-manual-items-static.test.mjs` | 同源静态供给集成测试：浏览器加载后端同源 UI 再访问 `/api`／SSE（NIT-3） |

- **开发期补充**：Vite dev server 经代理访问后端，Host/Origin 对齐后校验；仅作开发便利，**不作为验收链路**。
- **验收链路**：浏览器冷启动必须加载后端同源提供的静态资源，再同源访问 `/api` 与 SSE；不得以设计预览或合成 IPC 代替。

### 9.5 Rust 模块／测试登记路径与 `src/bin` 布局（按基点源码核实）

基点 `src-tauri/src/lib.rs:29-30` 以 `#[path = "store/local_store.rs"] pub mod local_store;` 引入 store；`local_store.rs` 内部再用 `#[path = "…"] mod …;` 声明各特性模块与测试（如 `local_store.rs:1471-1475` 的 `web_backend_schema`／`web_backend_schema_tests` 与 `pub use`）。

- **登记路径**：`web_backend_store.rs` 与 `web_backend_store_tests.rs` 以同样方式在 `src-tauri/src/store/local_store.rs` 内 `#[path = "web_backend_store.rs"] mod web_backend_store;`／`#[path = "web_backend_store_tests.rs"] mod web_backend_store_tests;` 并 `pub use`；**不创建无调用方的 `store/mod.rs`**。
- **既有测试适配**：`src-tauri/src/store/web_backend_schema_tests.rs` 需按双迁移（001＋002）适配故障注入用例，与已审 runner 变更语义一致（`web_backend_schema.rs` 的 `apply_migrations` fault 分支）。
- **`src/bin` 布局**：新二进制 `src-tauri/src/bin/web-backend-storage.rs` 的顶层 `bin` 当前不在 `scripts/checks/check-structure.mjs` 的 `SRC_TAURI_TOP_DIRS`（仅 `app`／`store`／`host`／`diagnostics`）内，会被 `layout.src-tauri-top` 拒绝。需对该**具体路径**同步：
  - 守卫：`SRC_TAURI_TOP_DIRS` 增加 `bin`；新增收敛规则 `layout.src-tauri-bin`，限定 `src-tauri/src/bin/` 只允许 `web-backend-storage.rs`。
  - 正例：`src-tauri/src/bin/web-backend-storage.rs` → 通过。
  - 负例：`src-tauri/src/bin/scratch.rs` → `layout.src-tauri-bin` 拒绝；`src-tauri/src/other/foo.rs` → 仍由 `layout.src-tauri-top` 拒绝（不借此放开任意生产目录）。
  - `docs/engineering/architecture.md`：`src-tauri/src/` 布局描述与放置决策表同步 `bin/`。
  - 该改动须在实施切片授权；不改其他顶层收敛。

### 9.6 浏览器冷启动／配对的实际接线文件（按基点源码核实）

| 文件 | 基点事实 | 最小作用 |
|---|---|---|
| `src/main.ts:1-8` | `createApp(App).use(createPinia()).mount('#app')` | 无需改动；Pinia 已装配 |
| `src/App.vue:1-20` | `useDesktopPreferences()`；`onMounted(() => preferences.start(document.documentElement))`；默认 surface 渲染 `Workbench` | 默认 surface 改为经 `PairingGate` 渲染 `Workbench` |
| `src/components/Workbench.vue:77` | `boot()` → `store.boot()`（`workspace_info`＋`list_todos`）；已有 `needsSetup` onboarding 分支 | 由 `PairingGate` 保证会话后再挂载；`boot()` 不改 |
| `src/stores/todos.ts:43` | `createTodoModel(invoke)` | 改为 `createTodoModel(httpBackend)`，保留 `createTodoModel` 结构与 `src/domain/todos.ts` 纯逻辑 |
| `src/stores/desktopPreferences.ts` | `createDesktopPreferences(api)` 的 `start(target, events, visibility, subscribe)` 模式 | 新 `src/stores/pairing.ts` 的参照（`createPairing(api)` ＋ `start`） |
| `src/components/PairingGate.vue` | 不存在（新增） | 无会话时显示配对码输入；成功后渲染默认 slot（`Workbench`） |
| `src/lib/web-api-client.ts` | 不存在（新增） | `fetch` 封装：base URL、CSRF、错误包络、operationId |

以上清单覆盖契约 §3 路径 1（配对）与路径 2–7（工作台）的实际入口；不新增产品行为，仅落地同一已审路径。

## 10. 完整纵向实现顺序

一条可独立交付的顺序，每步都有可验证产物：

1. **存储层**：新增 `002_manual_items.sql` 与 `web_backend_store.rs` 的事项操作，并在 `src-tauri/src/store/local_store.rs` 登记模块与测试；单测覆盖创建／更新／完成／重开／删除／历史／版本冲突／幂等／原子回滚。产物：Rust 侧可原子读写事项。
2. **后端进程**：`web-backend-entry.mjs` ＋ `http-server.mjs` ＋ `session-store.mjs` ＋ `storage-client.mjs` ＋ `manual-items-service.mjs`；集成测试覆盖配对、CSRF/Origin 拒绝、CRUD、历史、错误包络。产物：HTTP 端点可用。
3. **静态供给与构建接入**：`static-files.mjs` ＋ `build-backend.mjs` ＋ `package.json` 脚本；浏览器可加载后端同源 UI。产物：真实同源链路可用。
4. **前端客户端与配对门**：`web-api-client.ts` ＋ `todos` store 切换 ＋ `pairing.ts` ＋ `PairingGate.vue` ＋ `App.vue` 接线；保留 `src/domain/todos.ts` 纯逻辑。产物：浏览器可经 HTTP 完成 CRUD 与配对。
5. **重启恢复与多客户端**：事项帧进程内提示 ＋ 列表／详情读回补偿；重启后事项／历史恢复。产物：跨刷新／跨客户端一致。
6. **验收**：聚焦测试 ＋ 浏览器矩阵 ＋ 重启／失败／冲突 ＋ 完整门禁。

## 11. 端到端可观察验收

| 验收项 | 可观察结果 | 反例（证伪错误实现） |
|---|---|---|
| 表单保存 | 列表立即出现该事项；详情字段与输入一致 | 未落库就显示成功；刷新后消失 |
| 列表／详情一致 | 今日、全部、详情三处字段与状态一致 | 列表与详情版本／状态不一致 |
| 编辑 | 版本递增；历史含前后快照 | 旧版本提交覆盖新值 |
| 版本冲突 | 旧 `expectedVersion` 返回 409 `version_conflict`；前端提示刷新 | 旧版本静默覆盖新值 |
| 幂等 | 同 `operationId` 重放返回同一事项；不创建第二件 | 重复点击创建两件事 |
| 响应未知 | 响应丢失后按 ID 读回，状态正确 | 读回抛出或状态缺失 |
| 完成／重开 | 状态、完成时间、历史一致 | 重开不清完成时间；历史缺动作 |
| 删除 | 默认清单排除；详情与历史保留；变更操作 409 | 删除后历史丢失；删除可从列表恢复；删除后仍可变更 |
| 重启恢复 | 后端重启后事项、状态、历史原样重现 | 重启后事项丢失或状态回退 |
| 无模型 | 无模型／飞书／MCP 时 1–7 路径完整可用 | 启动即要求模型配置 |
| 多客户端 | 另一标签页／浏览器看到同一事项与状态 | 页面内存态不一致且无补偿 |
| 时间 | 两类事项时间独立；仅日期不编造时刻；相对日期按锚点 | `followup` 等于 `due`；旧纪要“明天”被当成导入次日 |
| 会话边界 | 无会话／错 Origin／缺 CSRF 的写请求被拒且不入库 | 跨源页面可提交事项 |
| 同源静态供给 | 浏览器冷启动加载后端同源 UI 与资源，再同源访问 `/api`／SSE | 依赖设计预览或合成 IPC；静态资源跨源 |
| 数据库层（m7） | 事项行存在、`version` 递增、事件行与动作一致 | 事件缺失或版本未递增（集成测试即数据库观测层） |

## 12. 验证命令

以下为实施切片的验收命令；除注明外当前均**拟新增**，本提案不执行、不冒称已跑。

| 层面 | 命令 | 状态 |
|---|---|---|
| Rust 存储 | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 拟新增 |
| Rust schema | `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 已有（W0 17/17；接入 002 后须重跑并适配双迁移故障注入） |
| 前端域 | `node --test tests/unit/web-manual-items.test.mjs` | 拟新增 |
| HTTP 集成 | `node --test --test-timeout=20000 tests/integration/web-manual-items-http.test.mjs` | 拟新增 |
| 重启恢复 | `node --test --test-timeout=20000 tests/integration/web-manual-items-restart.test.mjs` | 拟新增 |
| 同源浏览器 | Playwright 驱动 1440×1000 与 640×900，加载后端同源 UI，覆盖 §11 全部验收项 | 拟新增 |
| 结构／文档 | `npm run check:structure && npm run check:docs` | 已有 |
| 完整门禁 | `npm run check`（由唯一集成执行者在实际集成版本串行执行） | 流程要求 |

**本轮合成对照（证据见附件）**：`build/web-manual-items-contract/ddl-counterexample.mjs` 以 `node:sqlite` 内存库复现 B1 与镜像修复、v1→v2 前向迁移、故障注入回滚；脚本与输出随评论附件交付，不在仓库内。

## 13. 依赖与后续

- **本切片依赖**：W0 准出（已达成）、`web-api/1` 冻结（已达成）、本提案评审通过、具体 DDL 与结构性改动的授权（见授权文档）。
- **后续切片**：模型配置与 Provider、organizer/Pi 最小链路、候选编辑／自然语言预览／批量签收、今日建议的模型部分。这些切片复用本切片的 HTTP/会话/静态供给/存储底座与新库表，不重做底座。
- **`operation_id` 命名空间**（n2）：`manual_item_events.operation_id` 的 UNIQUE 目前域内唯一；legacy 在 `ingestion_operations` 与 `todo_events` 间共享命名空间（`local_store.rs:1273`）。候选签收切片接入时须声明全局或按资源族的幂等命名空间策略，本切片不预先扩大。
- **不在本切片**：飞书来源、进展跟踪、提醒、日报、薄壳与原生能力。

## 14. 未决与边界

- 本文件是提案，不是冻结契约或实施通过声明；字段、端点、错误码与模块落点经独立评审后冻结。
- 本切片不创建迁移文件、不安装依赖、不改 manifest/锁文件、不操作真实数据库/凭据/工作根。
- Linux/代理部署、真实模型/凭据/工作根、push 与发布均未授权，不在本切片验收范围。
- 既有 Tauri/Rust 实现的分层证据继续有效于其原版本，本提案不外推为新 Web/Linux 已通过。

## 附录A：实施期接口补充裁定（2026-11-08，W1 最终集成登记）

本附录仅登记任务描述两次协调裁定（MAYNE-23 派发线程）中对上文接口字面与幂等作用域的补充；正文 §1–§14 与冻结 DDL（001 `8511907c…`、002 `b6cb8e61…`、web-api/1 `61863271…`）逐字节保持 19045b8 原审内容不变。裁定原文以 MAYNE-23 评论记录为准，本附录为集成接收转录。

### A.1 接口字面名与列表参数（2026-11-08 裁定一）

- `POST /api/pair` 请求体标准字段为 `pairingCode`；不接受别名或环境变量切换。
- 配对与 `GET /api/session` 的 CSRF token 位于响应顶层 `csrfToken`；写请求使用 `X-CSRF-Token` 头（HTTP 头名大小写不敏感）。cookie 从 `Set-Cookie` 捕获，不冻结名字。
- 事项列表 `status` 缺省及 `open`/`completed`/`deleted`/`all` 语义沿原契约；显式未知 `status` 返回 400 `validation_failed`。
- 列表和历史分页 `limit` 缺省 50；显式值须为 1–200 整数，否则 400 `validation_failed`，不静默截断或回退。
- 证据只记录生效字段/头名，不写码、cookie 或 token 值。

### A.2 幂等作用域（2026-11-08 裁定二，OBS-2 补充）

- 事项域内同 `operationId` 仅在动作、目标事项、规范化 input 及 `expectedVersion`（各自适用时）均相同才重放；重放先于状态和版本守卫，返回同一对象当前权威状态。
- `create` 无客户端目标 `itemId`；跨动作或跨 `itemId` 复用已成功 `operationId` 返回 409 `idempotency_conflict`，不写任何新事件。
- 可在规范请求中编码动作/目标，或以已存事件 `action`/`itemId` 显式绑定；不扩大域内命名空间、不改 001/002/schema 或 legacy。

本附录与集成一起独立复核；追加后本文件 SHA-256 见 `docs/reviews/web-manual-items-integration-20261108.md` 登记。

## 附录B：启动/会话与 settings 写范围实施期补充（2026-11-08，第五轮集成登记）

本附录仅登记任务描述「最小启动契约」「启动增量审查分面与宿主 helper 归位」两节及 MAYNE-23 派发线程评论 `01a1b961-1495-7708-b4dd-04382c60a71c` 的队长裁定；正文 §1–§14、附录A 与冻结 DDL（001 `8511907c…`、002 `b6cb8e61…`、web-api/1 `61863271…`）逐字节保持原审内容不变。裁定原文以任务描述与 MAYNE-23 评论为准，本附录为集成接收转录。

### B.1 最小启动契约（浏览器无 Tauri 可用）

1. `src/lib/web-api-client.ts` 导出 `getWebApiClient(): WebApiClient`，懒加载同一默认实例；生产 pairing/todos/application settings 共用它，保留构造器/工厂显式注入便于测试。配对/会话读回设置的 CSRF 必须供真实事项/设置写入共享；logout/401 失效清理共享令牌与配对/SSE 状态并回到配对门；秘密不落本地存储、不注入虚假 Tauri bridge。
2. 复用冻结 001 已有 `settings(key,value,version)` 表；新增 key 仅 `application.timeZone`，value 为合法 timeZone 字符串。`GET /api/settings/application` 要求会话，返回 `{contractVersion:"web-api/1",settings:{timeZone},version}`；无保存值时由后端当前实例 OS 默认时区提供一致默认，version=0 且 GET 不写库。`PUT` 同路径要求会话/CSRF/精确 Origin，体 `{timeZone,expectedVersion}`；首次以 version 0 创建 version 1，随后原子 CAS 递增；冲突 409 `version_conflict`，非法参数 400 `validation_failed`；成功返回上述信封及 `warning:null`。保存不得盲用与表单基准脱节的最新缓存版本，版本随读取快照传递。
3. 应用时区值和版本随后端 SQLite 保存并跨重启可读；HTTP 仅读写此 key。Rust 适配独占连接/根锁，写权限精确限此 key 与两条固定参数化 INSERT/CAS 语句，不放宽任意 settings 写入或 task 表写入；七命令 stdio、001/002、依赖/锁/标识及旧库不变，无新增迁移或生产依赖。本项是已授权手工事项路径所需设置接线，非整个设置/模型系统迁移，不引入 legacy 兼容桥。
4. settings store 走真实 HTTP 时区读写，只有成功读回才能 ready；Workbench 在浏览器不自动调用尚未实现的 native models/agents/skills/profile/organizer 等加载/监听/轮询，无相应能力的入口明确显示未接通/禁用，不伪造配置成功；保留原 `create*(api)` 领域工厂与手工录入/详情/历史能力。

### B.2 宿主能力 helper 归位

- 宿主检测 `nativeBridgeAvailable` 原样位于 `src/lib/host-capabilities.ts`；未获批的 `src/domain/capabilities.ts` 已删除。不扩大 domain 边界，不改既有 domain/shared 文件、业务行为或后端字节。

### B.3 settings 写守卫与 DML 写目标分派（2026-11-08 队长裁定，R2 MAJOR-1 收口）

- `transact` 权限按真实 DML 写目标分派：settings 目标语句一律先过两条生产模板（规范化空白/注释后逐字比对，key 字面量大小写/空白敏感）；业务放行仅适用于真正以 `manual_items`/`manual_item_events` 为目标的语句；子查询/EXISTS/注释中的表名提名不能授予写权限。
- 目标识别不可靠的形态（引号 `"…"`／`` `…` ``／`[…]`、schema 限定名含 `.`、无法定位写目标）直接返回 `WEB_BACKEND_SQL_DENIED`，不新增解析依赖。
- 合法条件历史 `INSERT INTO manual_item_events … SELECT … WHERE (SELECT changes())=1`、settings 首写/CAS 模板及空白/注释变体保持放行；A11/A12 及业务提名组合变体被拒且零落库（OpenCode R3 限定独审记录 `docs/reviews/web-manual-items-implementation-20261108-opencode-settings-sql-r3-review.md` 通过）。
