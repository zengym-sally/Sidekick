# W1 启动准备：实际基座差距与浏览器验收矩阵（P2 独立核对）

> 本篇是 MAYNE-23 Stage 3 启动准备 P2 的交付物：从实际集成基座独立核对「手工事项录入、编辑完成与重启恢复」的真实差距，并独立给出浏览器验收矩阵。本篇只做事实核查与验收设计，不实现业务、不冻结契约、不宣告任何功能通过。P1（Claude）的纵向契约提案与本篇写入范围互不重叠；本篇不重复其契约内容。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. 登记与取证方法

| 项 | 值 |
|---|---|
| 执行位置 | `pwd`：本任务平台分配的独立工作树；`branch`：`agent/kimi/mayne-17` |
| 工作树 HEAD | `55684a296f81e964767dbcd7a9c9391304dfdd1b`（MAYNE-20 修订提交） |
| 读取的源码基点 | `65469904d8baddde738646dfed3bf4a921f47b68`，tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`（MAYNE-23 登记的实际集成基座） |
| 基点与本分支关系 | 基点**不是**本分支 HEAD 的祖先（本分支为首批 MAYNE-20 线）。按派发要求，全部基座事实以 `git show` / `git archive` 对精确基点取证，未以旧 HEAD 冒充当前事实，未切共享 main、未 reset/stash |
| 交叉核实 | 已测候选 `e32860f` 的 tree 与 main `6546990` 的 tree 均为 `7b71cdb3…`（实测相等），MAYNE-22「本地 main 与已测树完全一致」的说法独立复核成立；W0 门禁绿证（968/968）因此适用于本基点 |

**路径引用约定**：本分支不含 W0 集成内容。凡指向基座文件的路径以行内代码给出「位置 + 基座 sha256 前缀」，是对精确基点的取证引用，不构成本分支内可导航链接；本分支与基点内容一致的文件（产品 01–04、验证约定）用相对链接。原始证据在 `build/web-manual-items-readiness/`（本机证据目录，不入库）。

**边界**：源码与全部生产目录只读；未编写任何业务实现；未运行完整重门禁（`npm run check`）；未读取真实凭据或真实用户根；未修改共享 main、`docs/reviews/README.md` 索引或 `product/05`；未改本项/父任务状态。

## 2. 总判

W0 关闭时，新后端只落地了「存储适配 + 智能体任务队列表」两层。**手工事项（两类事项）在新库 schema、HTTP 契约、服务进程、浏览器传输四个面上全部空白**：可复用的是旧 Tauri 实现里已验证的规则与测试（绑定 legacy lineage，不是 Web 业务），以及 W0 探针证明到存储层的文件安全/连接/崩溃边界。从现状到本任务纵向验收（浏览器表单 → 后端事务 → SQLite → 列表/详情 → 编辑/完成/删除/历史 → 重启恢复）的真实差距见 §4；独立验收矩阵见 §5。

## 3. 分层现状（三层分开记账）

### 3.1 已有 Rust/Tauri 行为（legacy lineage：规则可复用，不等于 Web 业务已通）

位置均为基座文件（sha256 前缀见 §8）：

- **表结构**：`src-tauri/migrations/001_todos.sql`（`eae39795…`）建 `todos` + `todo_events`；`src-tauri/migrations/002_ingestion.sql` 增加 `capture_method`（manual/signed_ai）、`due_precision`/`followup_precision`、`todo_events_v2`（动作集合扩到 create/update/complete/reopen/delete/link）、`sources`/`candidates`/`todo_sources`。legacy 库 `application_id=0x53444b31`，路径 `<workspaceRoot>/data/sidekick.sqlite`；按已确认决定不做历史迁移或兼容桥。
- **两类事项与校验**（`src-tauri/src/store/local_store.rs`，`25d78dd f…`）：`kind ∈ action|followup`；`action` 携带 `followup` 时间点即拒（`TodoInput::normalized`，local_store.rs:113）；标题 1–200 字、负责人 1–100 字、禁控制字符；`priority ∈ low|medium|high`；标签去重、至多 12 个、每个 ≤32 字。
- **时间锚点**：`TimePoint{at_ms,time_zone,local_text,precision∈minute|day}`，due/followup 三元组落库（缺一即拒，DDL CHECK）；规则与解析在 `shared/dates.mjs`（`a97a957d…`，`zonedCandidates`/`resolveExpression`）与 `src/domain/todos.ts`（`a24a8bf5…`，`pointFromInput`/`isOverdue`/`effectivePoint`：followup 用 `followup ?? due`、action 用 `due`）。
- **状态与并发**：`open → completed/deleted`（软删除，`completed_at_ms`/`deleted_at_ms`），支持 reopen；`validate_change`（local_store.rs:1254）对已删除事项拒改、版本不符返回 `VERSION_CONFLICT`；每次变更 `version+1`。
- **幂等**：`operation_id`（≤128、`[A-Za-z0-9_-]`，`validate_operation` local_store.rs:1242）；`replay`（local_store.rs:1269）同 ID 同规范请求返回同一事项当前态，同 ID 不同请求 `OPERATION_CONFLICT`，并与 `ingestion_operations` 占线检测。
- **事件历史**：`todo_events` 记 before/after JSON（`record_event` local_store.rs:1304），`history(id)` 按 sequence 倒序返回。
- **前端动线**：`src/stores/todos.ts`（`44e9b2f7…`）以 `operationId`/`expectedVersion` 调用，`generation` 防旧响应覆盖新快照；`src/components/QuickEntry.vue` 表单字段＝类型（待我处理/待我跟进）、负责人、优先级、交付截止、下次跟进（仅 followup 显示）。
- **传输**：`src/stores/todos.ts:3` `import { invoke } from '@tauri-apps/api/core'`；命令在 `src-tauri/src/app/commands.rs`（`list_todos`/`create_todo`/`update_todo`/`set_todo_completed`/`delete_todo`/`todo_history`）。**浏览器（无 Tauri）今天够不到任何后端。**

### 3.2 W0 新库能力（web-backend/1：已验证到存储层与契约层）

- **schema**：`src-tauri/migrations/web-backend/001_web_backend.sql`（`8511907c…`，与 MAYNE-22 登记的 DDL 哈希前缀一致）11 表：`schema_meta`、`tasks`、`task_attempts`、`task_events`、`side_effect_receipts`、`workspace_operations`、`recovery_holds`、`recovery_items`、`settings`、`instance_epochs`、`task_result_payloads`。`tasks` 是**智能体任务队列**（提交/领取/取消/恢复状态机），与手工事项不是同一条动线。
- **存储适配**：`src-tauri/src/store/web_backend_schema.rs`（`d57dfbc7…`）：显式 `init` 与普通 `open` 分离、缺库拒绝不新建、lineage/version 镜像校验、WAL + `synchronous=FULL` + `foreign_keys`、NOFOLLOW、一致性备份。
- **探针证据**：`tests/probes/backend-foundation/`（runner `13e53604…`，与 MAYNE-22 登记一致）在合成根上 68/68 场景、255 项检查、78 次 harness 调用通过（记录在基座版 `docs/engineering/backend-foundation-probes.md`，`ea044698…` §4；已测树与基座同 tree，证据适用）。证明的是存储边界可达，**不是**业务 HTTP 可用。
- **契约**：`docs/engineering/web-api-contract.md`（`61863271…`）冻结 `web-api/1`：任务资源/状态机/幂等/版本/SSE 高水位快照/恢复保持/错误码注册表；`tests/fixtures/web-contract/` 48 个静态样例全部携带 `contractVersion: "web-api/1"`（实测计数）。样例与原型都不是可运行服务。

### 3.3 尚未接线的 Web 业务（空白，逐项有证据）

1. **无 HTTP/SSE 服务进程**：生产代码（`runtime/`、`src-tauri/`、`src/`）中唯一 `createServer` 是 `runtime/entries/probe-entry.mjs:90`（S0 诊断探针，`listen(0,'127.0.0.1')`）；其余命中均在 `design/serve.mjs`（设计预览）与 `tests/` 合成夹具（模型/MCP 替身服务，如 `tests/fixtures/s32-model-server.mjs`），均非业务后端。`runtime/lib/native-model-fetch.mjs` 是 HTTP/net **客户端**。没有业务后端、没有 `/api` 路由、没有配对/会话/CSRF 实现。
2. **契约无手工事项端点**：冻结契约只有 `/api/tasks*`、`/api/pair`、`/api/session`、`/api/settings/agent-concurrency`、`/api/events`、`/api/snapshot`、`/api/workspace*`、`/api/recovery*`、`/api/providers`（基座契约内 `api/todos|api/items|api/manual` 检索为 0）。
3. **新库无手工事项表**：DDL 11 表中无事项/事项事件表；`recovery_items` 是恢复核对项（DDL:120–133），不是业务事项。
4. **浏览器传输空白**：前端 store 全部经 Tauri IPC（§3.1）；无 fetch/HTTP 客户端、无会话 cookie、无 CSRF token、无 Origin 校验。
5. **无浏览器验收载体**：`design/web-task-flow/`（`f358c6a8…`）是合成原型——`setTimeout` 驱动状态切换、刷新复位、不连模型/飞书/MCP/Bash/SQLite/文件系统（实测 5 处定时器驱动）；`tests/fixtures/web-contract/` 是静态 JSON；`tests/probes/backend-foundation/` 只到 Rust 存储边界。**三者都不能签 HTTP/数据库行为。**

## 4. 实际差距清单（现状 → 本任务纵向验收）

| # | 差距 | 事实与位置（基座） | 收口需要的动作 |
|---|---|---|---|
| G-1 | **服务进程与传输完全缺失** | 生产代码中唯一 HTTP server 是诊断探针（`runtime/entries/probe-entry.mjs:90`；其余 `createServer` 命中为设计预览与 tests 合成夹具，均非业务后端）；契约 §1/§2 的 `/api` 前缀、配对换会话、cookie/CSRF/Origin 均无实现；前端 `src/stores/todos.ts:3` 走 Tauri IPC | 新增 Node 后端进程（HTTP + SSE + 会话/CSRF/Origin）；前端加 HTTP 传输 seam（保留现有 store/domain 纯逻辑） |
| G-2 | **新库无手工事项表** | DDL 11 表无事项表（§3.3-3）；legacy `todos`/`todo_events` 在另一 lineage，明确不迁移 | 追加新迁移（web-backend/002…）：事项表 + 事项事件表 + 幂等/版本字段；001 已冻结不可改（守卫 `schema.immutable-migration`，`scripts/checks/check-structure.mjs:284`） |
| G-3 | **手工事项 HTTP 契约缺口** | 冻结契约只覆盖智能体任务；事项的创建/编辑/完成/删除/历史端点、字段、错误码、幂等与版本语义未定义 | 由 P1 纵向契约提案收口；可复用契约 §1 总则、§10 错误包络、§3.3 幂等/版本范式与 §2 会话/CSRF/Origin（属提案，不是现有端点） |
| G-4 | **规则移植** | legacy 规则完整（§3.1）但绑在 v1–v5 store 与 Tauri 命令；`shared/dates.mjs`、`src/domain/todos.ts` 为跨层/纯逻辑，可随前端直接复用 | 把 `TodoInput::normalized`、`validate_change`、`replay`、`record_event` 的语义移植到新库 repository 层；领域测试（§6）随迁 |
| G-5 | **浏览器验收载体缺失** | 原型/样例/探针均不可签 HTTP（§3.3-5） | 拟新增：后端启动入口 + 配对客户端 + 事项 HTTP 夹具 + 浏览器验收运行器（可复用 `tests/integration/desktop-controls.test.mjs` 的 Vite + 无头 Chrome + 传输 seam 模式）+ 合成根重启用例 |
| G-6 | **放置与守卫写入** | 守卫白名单：顶层目录仅 `.cargo/.impeccable/design/docs/resources/runtime/scripts/shared/src/src-tauri/tests/vendor`（`check-structure.mjs:16`）；`src/` 只许相对引用 `src/`+`shared/`（:153）；`runtime/` 只许 `entries/lib/workers`（:219）；`src-tauri/src` 顶层只许 `lib.rs/main.rs/app/store/host/diagnostics`（:223）；`package.json` 为共享文件且 `scripts.check` 必须 structure 先于 docs（:190–207） | 后端放置位置需在提案中定案；**新增顶层目录＝`top.dir` 违规＝需守卫改动 + 单独授权**；`package.json`/锁文件按 MAYNE-23 归集成任务明确清单 |
| G-7 | **启动/构建前置** | 集成测试需先 `npm run probe:bundle`（`scripts/build/bundle-runtime.mjs`）；后端若要随包分发涉及 `scripts/build/` 变更（归集成/门禁负责人）；契约 §13 提议 HTTP 层零新依赖（`node:http`+`node:crypto`） | 登记后端启动命令（拟新增）；随包分发另授权；任何新生产依赖须单独授权 |
| G-8 | **授权覆盖核对** | 已授权：web-backend/1 全新建表（owner 2026-11-07，评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`）、实现完成后本地提交/main 合入/清理已合并分支、W0 基线提交 | 需进一步具体化：G-2 的事项表属「新表」，须按 P1 逐文件清单明确列入（不把 W0 的 11 表授权任意扩成新表已获批）；G-6 守卫改动、G-7 随包分发各需清单授权。**未授权**：push、部署、真实凭据/用户根 |

## 5. 浏览器验收矩阵（独立给出）

每条对应产品/既有契约来源、应观测的页面/HTTP/数据库结果，以及能证伪错误实现的反例。观测口径：页面＝浏览器实际渲染；HTTP＝对后端真实请求/响应（不是原型合成）；数据库＝同一新合成根上的 `web-backend.sqlite` 实际行。

| # | 验收项 | 来源 | 应观测结果 | 证伪反例（出现即不通过） |
|---|---|---|---|---|
| A-1 | 两类事项创建 | 产品 [01](../product/01-产品定义.md) F01/F06、[02](../product/02-用户流程.md) §2/§4；legacy 规则 local_store.rs:111–114 | 表单选「待我处理」只出现交付截止；选「待我跟进」出现截止+下次跟进；保存后列表两条分别正确归类；DB 事项行 kind/时间三元组/precision 正确 | action 事项被允许带下次跟进；followup 的「下次跟进」被渲染成截止；时间只落 epoch ms、丢时区/精度 |
| A-2 | 时间校验（时区锚点） | `shared/dates.mjs` `zonedCandidates`；`src/domain/todos.ts` `pointFromInput`；产品 02 §3（歧义保留原表达、仅日期提示补齐） | 夏令时空缺本地时刻被拒并明示「不存在」；回落歧义时刻要求显式选 UTC 偏移；仅日期精度存 `precision=day` 与原表达；逾期按应用时区计算 | 把 02:30 静默吸附到邻近时刻；歧义时刻任取一个不告知；用浏览器本地时区重渲染导致锚点漂移 |
| A-3 | 列表/详情一致 | 契约 §4.2（按 ID 读回）；产品 [04](../product/04-分期交付与验收.md)「个人管理与今日工作台」行 | 列表顺序稳定（提交顺序）；详情 GET 与列表行同版本同字段；他端变更后本页按事件/快照更新，无需手动刷新也可见权威态 | 详情显示打开时的过期快照；列表按更新时间重排；双端同事项出现两个版本并存 |
| A-4 | 编辑与双客户端版本冲突 | legacy `validate_change`（local_store.rs:1254）；契约 §3.3 乐观并发与 409 `version_conflict` | 两端各开同一事项：A 改存（v→v+1）后，B 持旧 `expectedVersion` 提交 → 409 `version_conflict` 且明示「已有更新，请刷新」；B 重读后重改成功；无丢更新 | 后写静默覆盖（last-write-wins）；冲突返回 500/通用错误；同一 operationId 被两端复用出两行 |
| A-5 | 完成/删除/历史 | legacy `set_completed`/`delete`/`history`（local_store.rs:1116/1183/1198）；产品 02 §4（删除需确认、保留历史）；产品 04「人工签收」行（事务失败无半成品） | 完成 → `completed`+`completedAtMs`+版本+1+事件；删除为软删除（`deletedAtMs`），默认列表不见但历史可查；reopen 可用；历史按序返回 before/after | 硬删除导致历史丢失；完成不升版本；事件落了行没改（或反之）；删过的项还能被改 |
| A-6 | 重复提交与失败提示 | legacy `replay`（local_store.rs:1269）；契约 §1/§3.3 幂等；产品 02 §3（重复点击只创建一次） | 双击/响应丢失重试（同 operationId 同内容）→ 返回同一事项，不新建；同 ID 不同内容 → 409 幂等冲突；校验失败 → 未落库、表单保留、错误明示 | 出现两条相同事项；重放生成新 ID；校验失败留半行；失败提示把已接收说成未接收 |
| A-7 | 无模型运行 | 产品 02 §1（无模型仍可手工管理）；产品 04 W1 退出条件（无模型可手工使用）；MAYNE-23 范围 | 未配模型/凭据/网络下完成 A-1–A-6、A-8 全动线；手工事项不进智能体任务队列（不与 `tasks` 表动线混淆） | 流程被模型配置阻塞；手工事项被悄悄入任务队列；无持久化的假成功 |
| A-8 | 同一新合成根重启/浏览器重连重读 | 设计 §5（提交成功即落 SQLite、重启队列保留）；W0 探针崩溃/WAL/根锁证据（存储层）；MAYNE-23 范围 | 新鲜合成根显式 init → 录入若干事项 → `SIGKILL` 后端 → 重启 → 浏览器重读：已提交事项与历史逐条完好、无重复、版本连续；根锁释放与重获正常（探针 D 组证据适用存储层） | 强杀后事项丢失（WAL 不同步）；重启拒开根（锁泄漏）；浏览器把本地缓存当权威显示 |
| A-9 | Origin/会话/CSRF 拒绝路径（适用项） | 契约 §2 与 §10 错误码（401 `unauthenticated`/403 `csrf_invalid`/`origin_rejected`/429 `pair_rate_limited`）；设计 §3 | 未配对请求 401；写请求缺/错 CSRF 403；跨源 403；均不入库不启动；配对码仅请求体、单次有效、失败限速 | 无会话写成功；CSRF 可选；Origin 只警告不拒；配对码进 URL/日志 |

矩阵外显式声明：**模型任务动线（提交/排队/取消/结果）不在本任务范围**（属契约 §3/§4 与后续切片）；本篇不对其签收也不替代其验收。

## 6. 命令清单：可复用 vs 拟新增

**已存在、可直接复用**（均在基座核实；聚焦入口，不替代最终完整门禁）：

| 命令 | 用途 |
|---|---|
| `node --test tests/unit/s1-domain.test.mjs tests/unit/s1-state.test.mjs` | 事项域（过滤/今日列表/迟响应）与 store 状态机回归；移植新 repository 时随迁 |
| `node --test tests/unit/s2-dates.test.mjs` | 时间锚点/时区规则（`shared/dates.mjs`）回归 |
| `node tests/probes/backend-foundation/run-probes.mjs` | 存储边界（连接/根锁/身份/WAL/崩溃/调度拒绝），离线构建，合成根 |
| `node scripts/checks/check-docs.mjs` | 文档本地链接 |
| `node scripts/checks/check-structure.mjs --self-test && node scripts/checks/check-structure.mjs` | 结构/守卫（含负例自测） |
| `npm run probe:bundle` | 集成测试前的 Runtime 打包前置 |
| `npm run check:rust` | `cargo fmt --check` + `clippy -D warnings` |
| `git diff --check` | 空白/冲突标记 |
| `tests/integration/desktop-controls.test.mjs`（模式） | Vite 构建 + 无头 Chrome + 传输 seam（`tests/fixtures/desktop-controls/api.ts` 替换 IPC）——浏览器验收运行器照此模式建 HTTP seam |

**拟新增（当前不存在，验收前须建；不冒称已执行）**：后端启动命令与服务入口；配对/会话/CSRF 的受控测试客户端；手工事项 HTTP 契约样例（`tests/fixtures/web-contract/` 现 48 个均为任务域）；浏览器验收运行器（HTTP seam 版）；同一合成根上的 `SIGKILL` 重启用例；最终版本上的完整 `npm run check`（按约定由集成/门禁负责人在实际集成版本串行执行）。

## 7. 授权与写入缺口（核对结论）

- **已覆盖**：web-backend/1 全新建表（owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`，2026-11-07）；实现完成后本地提交、合入本地 main、清理已合并分支（同一授权）；W0 基线提交已由队长执行。本轮准备不改 Git 权限、不 push。
- **需进一步具体化（不视为已获批）**：G-2 手工事项表是**新表**，须由 P1 逐文件清单列出拟议 DDL/lineage 后单独审定——不能把 W0 的 11 表授权扩成「新表已获批」；G-6 若需新增顶层目录或改层规则属守卫写入；G-7 随包分发涉 `scripts/build/`；任何新生产依赖（契约 §13 首选零依赖）须单独授权。
- **明确未授权**：push、部署、真实凭据/真实用户根、Linux/代理实测环境。

## 8. 证据与自检

**基座身份**（`build/web-manual-items-readiness/base-identity.txt`）：`6546990` tree `7b71cdb3…`；`e32860f` tree 同值；本分支 HEAD `55684a2`，基点非其祖先。

**基座文件 sha256（前缀）**（`git show <base>:<path> | shasum -a 256`）：

```text
8511907cf7555679  src-tauri/migrations/web-backend/001_web_backend.sql
eae39795f8003e82  src-tauri/migrations/001_todos.sql
61863271a82f46ed  docs/engineering/web-api-contract.md
c0cfef08cd2c0a0a  docs/engineering/web-backend-design.md
48cc1992a609dbb1  docs/engineering/web-task-interaction.md
ea0446982e2f1fc2  docs/engineering/backend-foundation-probes.md
d57dfbc7d298e683  src-tauri/src/store/web_backend_schema.rs
25d78ddff587b1af  src-tauri/src/store/local_store.rs
a24a8bf5aa2d9f1d  src/domain/todos.ts
44e9b2f75630eb07  src/stores/todos.ts
a97a957dabae72c7  shared/dates.mjs
04d9ed187fd142f4  package.json
a3901b9325c8a04f  scripts/checks/check-structure.mjs
f358c6a871041c35  design/web-task-flow/task-flow.js
13e536042f9301d3  tests/probes/backend-foundation/run-probes.mjs
```

DDL `8511907c…` 与 MAYNE-22 登记一致；runner `13e53604…` 与 MAYNE-22 登记一致。

**差距取证**（`build/web-manual-items-readiness/gap-evidence.txt`）：全仓 `createServer` 仅诊断探针一处；契约无事项端点（检索 0）；DDL 11 表且 `item` 命中仅为 `recovery_items`；前端 store 第 3 行 `invoke` 导入；web-contract 样例 48 个；原型 5 处定时器驱动；legacy 事项操作函数行号。

**本篇自检**（本机实跑，非完整门禁）：`node scripts/checks/check-docs.mjs`、`git diff --check`、`git status` 核对写入范围——退出码与结果见 `build/web-manual-items-readiness/self-check.txt`。本篇只新增 `docs/reviews/web-manual-items-readiness-20261108.md` 与 `build/web-manual-items-readiness/` 证据，未碰其余文件。

## 9. 边界与未验项

- 未验证：任何 HTTP 端点（不存在）、新库业务读写（无实现）、Linux/代理、真实凭据/用户根、模型动线；W0 探针 68/68 只签存储边界（已测树与基座同 tree）。
- 本篇「设计了用例」不等于「新功能通过」；验收矩阵全部条目待实现后按 §6 命令执行。
- 交付后按派发由 OhMyPi 独立审阅事实/覆盖/边界；两份材料齐备后由队长合并技术裁定与授权覆盖，再决定 MAYNE-23 正式实施准入。本篇作者不自签 APPROVE，不通知他人按未定草案开工。
