# MAYNE-23 P2 准备材料独立审阅：W1 实际基座差距与浏览器验收矩阵（OhMyPi）

> 单面聚焦评审：对象是 Kimi 的 P2 报告 `docs/reviews/web-manual-items-readiness-20261108.md`（提交 `d94de69be5d3b837395f3aa8a823bde7d34fd167`，父 `55684a2`）。我未参与该报告的任何部分。本篇只审事实、覆盖、边界与授权判断，不实现业务、不冻结契约、不宣告任何功能通过，也不替代 Claude 的 P1 契约提案。
> 评审方法与派发一致：报告只读；基座事实从精确源码基点 `65469904d8baddde738646dfed3bf4a921f47b68`（tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`）用 `git show`/`git grep` 独立重建，不整树合入旧分支；作者 `build/` 证据未随评论交付，全部关键事实本地重算。原始观察值见 `build/web-manual-items-readiness-review/evidence-log.txt`。

## 1. 结论

**通过（无阻塞项；3 项不阻塞 NIT 见 §6）。**

报告的四项基座差距、九条验收矩阵的来源与观测/证伪设计、现有/拟新增命令的划分，以及授权判断的逐条出处，都在精确基点 `65469904` 上独立重建成立：我复算了报告登记的报告哈希与补丁哈希、DDL 哈希、11 张表清单、契约端点全集、`createServer` 全集、前端传输形态、legacy 规则与行号、守卫行号与白名单、可复用命令的存在性与拟新增命令的缺失。没有发现把未实现说成已实现、把原型/样例/探针外推为 HTTP/数据库证据、或把 W0 的 11 表授权扩成新表已获批的情况。

报告对其自身边界诚实：明确「设计了用例 ≠ 新功能通过」、明确原型/样例/探针三者都不能签 HTTP/数据库行为、明确 Linux/代理与真实凭据未验、明确不自签 APPROVE。这正是一份「启动准备」材料应有的口径。

## 2. 交付身份核验

| 项 | 声明值 | 我复算 |
|---|---|---|
| 报告 sha256 | `900d28c1…` | `900d28c11281863ada072a9f7da19659bcc62ed9e37548a44ac300ad77ff5778` ✓ |
| 补丁 sha256（`55684a2..d94de69`） | `8211d648…` | `8211d6481f955c69a307cb43c5c961cdd488a00a4e479f23bb4555c6cfb5cb70` ✓ |
| 增量范围 | 仅报告一个文件 | `git diff --stat` = 1 file changed, 143 insertions(+) ✓ |
| 基座 tree | `7b71cdb3…` | `git rev-parse 65469904^{tree}` = `7b71cdb36888dd1e2955cfa566d2ca606670d4bf` ✓ |
| 基座与分支关系 | 基点非本分支祖先（登记取证） | 本评审树同样不含该祖先；全部事实按精确基点 `git show` 重建，未以旧 HEAD 冒充 ✓ |

取证方式本身成立：报告分支只承载报告，源码按精确基点单独读取，这避免了「把旧基线整树合入」的内容污染，与派发要求一致。

## 3. 四项基座差距逐项重建

### G-1 无业务 HTTP/SSE 服务进程 —— 成立

`git grep createServer` 限定生产目录（`runtime src-tauri src shared scripts design`）只有两处：`design/serve.mjs:96`（设计预览）与 `runtime/entries/probe-entry.mjs:90`（S0 诊断探针，`listen(0,'127.0.0.1')`，见该文件 :137）。`tests/` 下的 `createServer` 命中（`s32-model-server.mjs`、`mcp-http.mjs`、`mcp-trial.mjs`、`openai-ui-server.mjs`、多个 integration 测试内联服务器）都是模型/MCP 合成替身，不是业务后端。`src/` 内 `fetch(` 命中 0、`csrf|xsrf|originReject` 命中 0。结论与报告一致：没有业务后端、没有 `/api` 路由、没有配对/会话/CSRF 实现，前端够不到后端。

### G-2 冻结契约无手工事项端点 —— 成立

从契约正文抽出全部 `/api/...` 端点（含 §6/§7 行内的 `GET /api/events`、`GET /api/snapshot`、`GET /api/providers`）：`pair`、`session`、`settings/agent-concurrency`、`tasks`(+`/{taskId}`)、`events`、`snapshot`、`workspace`(+`backups`/`operations`/`switch-operations`/`restore-operations`)、`recovery/holds`/`recovery/items`、`providers`。`api/todos|api/items|api/manual` 检索为 0。契约 §12 的九个对象也全是任务域。结论成立。

### G-3 新库无手工事项表 —— 成立

`001_web_backend.sql` 共 11 张 `CREATE TABLE`：`schema_meta`、`tasks`、`task_attempts`、`task_events`、`side_effect_receipts`、`workspace_operations`、`recovery_holds`、`recovery_items`、`settings`、`instance_epochs`、`task_result_payloads`。全表内 `item` 命中只有 `recovery_items`（DDL:120–133，恢复核对项）。文件 sha256 = `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`，与 MAYNE-22 登记的审定 DDL 一致。结论成立。

### G-4 浏览器传输空白 —— 成立

`src/stores/todos.ts:3` 正是 `import { invoke } from '@tauri-apps/api/core'`；`src/` 下 16 个 store/组件都经 Tauri IPC；无 `fetch`、无会话 cookie、无 CSRF token、无 Origin 校验。`src-tauri/src/app/commands.rs` 的 `list_todos`(:250)/`todo_history`(:254)/`create_todo`(:261)/`update_todo`(:272)/`set_todo_completed`(:288)/`delete_todo`(:304) 全部存在且只经 IPC。结论成立。

**附带核实（报告 §3.1 的 legacy 规则可信度）**：`local_store.rs` 被引行号逐一命中——:111 kind 校验、:113 action 不得带 followup、:114 收束、:1242 `validate_operation`（≤128、`[A-Za-z0-9_-]`）、:1254 `validate_change`、:1269 `replay`、:1304 `record_event`、:1116 `history`、:1183 `set_completed`、:1198 `delete`；`APPLICATION_ID = 0x53444b31`(:13) 与库路径 `<workspaceRoot>/data/sidekick.sqlite` 亦属实。`shared/dates.mjs` 的 `zonedCandidates`/`resolveExpression` 与 `src/domain/todos.ts` 的 `pointFromInput`/`isOverdue`/`effectivePoint`（followup 用 `followup ?? due`、action 用 `due`）均按报告描述存在。`QuickEntry.vue:32-34` 的类型/负责人/优先级字段与报告一致。**报告把 legacy 规则标为「可复用但绑 legacy lineage、不等于 Web 业务已通」是准确且有依据的。**

## 4. 九条验收矩阵

逐条核对了来源可引用性、观测口径与证伪反例：

| # | 来源核对 | 观测/反例核对 |
|---|---|---|
| A-1 | product/01 的 F01「表单录入」、F06「个人事项管理」存在（P0）；product/02 §2「四类入口汇入同一套事项与候选」、§4 存在；legacy :111–114 支持「action 不得带 followup」 | 页面字段条件渲染、DB kind/时间三元组/precision 三类观测均可执行；反例（action 带 followup、followup 被渲染成截止、只落 epoch ms）都能证伪错误实现 |
| A-2 | `shared/dates.mjs:9 zonedCandidates`、`:24 resolveExpression`；`domain/todos.ts:21 pointFromInput`；product/02 §3「日期只到周五或语义有歧义时，卡片保留原表达并提示补齐」 | 夏令时空缺、回落歧义、仅日期精度、逾期按应用时区四类观测对应权威规则；反例（静默吸附、任取不告知、浏览器时区重渲染）成立 |
| A-3 | 契约 §4.2「查询」（`GET /api/tasks/{taskId}` 全字段、列表按 `submitSeq` 稳定分页）；product/04「个人管理与今日工作台」 | 「详情不返回过期快照、列表不按更新时间重排」与 §4.2 的全字段/稳定分页一致 |
| A-4 | legacy `validate_change`(:1254) 与契约 §3.3「过期一律 409 `version_conflict`，客户端重读后按新版本重新决策」 | 双端冲突、409、重读后成功、无丢更新的反例设计正确 |
| A-5 | legacy `set_completed`(:1183)/`delete`(:1198)/`history`(:1116)；002 迁移的 action 集合含 complete/reopen/delete；product/02 §4 删除需确认 | 软删（`deleted_at_ms`）、版本+1、事件 before/after、reopen 观测可执行；「硬删除致历史丢失」「完成不升版本」反例成立 |
| A-6 | legacy `replay`(:1269) 与契约 §3.3 幂等三态（同 ID 同输入 200 `replayed:true`、同 ID 不同输入 409 `idempotency_conflict`）；product/02 §3「重复点击只创建一次」 | 反例（两条相同事项、重放生成新 ID、校验失败留半行、把已接收说成未接收）与契约 §1.1「未接收」边界一致 |
| A-7 | product/02 §1「无模型连接时仍可手工管理事项」；product/04 W1 退出条件 | 「手工事项不进 `tasks` 表」的观测正好对上 G-3 的两条动线分离，反例（流程被模型配置阻塞、悄悄入任务队列）成立 |
| A-8 | 设计 §5 提交即落 SQLite/重启队列保留；W0 探针崩溃/WAL/根锁证据（仅存储层） | SIGKILL→重启→浏览器重读的观测设计正确，且报告明确标注根锁/崩溃证据只适用于存储层，不外推为 HTTP 证据 |
| A-9 | 契约 §2 会话/配对/跨源与 §10 错误码（401 `unauthenticated`/403 `csrf_invalid`/403 `origin_rejected`/429 `pair_rate_limited`） | 「未配对 401、缺/错 CSRF 403、跨源 403、均不入库不启动、配对码仅请求体单次有效」与契约逐条对应；反例（无会话写成功、CSRF 可选、Origin 只警告、配对码进 URL/日志）成立 |

矩阵外声明「模型任务动线不在本任务范围」与契约 §3/§4 的归属一致，没有越界代签。

**一处需在实施时留意的口径（不阻塞本报告）**：A-3 引用契约 §4.2 的任务查询语义作为「列表/详情一致」的范式来源。报告本身已说明这是范式借用（「可复用契约 §1 总则、§10 错误包络、§3.3 幂等/版本范式」），事项端点属 P1 提案范围。只要 P1 落地时按同一范式定义事项的列表/详情分页与全字段读回，该矩阵条目不落空。

## 5. 命令划分与授权判断

**可复用 8 项全部在基点存在**（`tests/unit/s1-domain.test.mjs`、`s1-state.test.mjs`、`s2-dates.test.mjs`、`tests/probes/backend-foundation/run-probes.mjs`、`scripts/checks/check-docs.mjs`、`check-structure.mjs`、`scripts/build/bundle-runtime.mjs`、`tests/integration/desktop-controls.test.mjs` + `tests/fixtures/desktop-controls/api.ts`）。`desktop-controls` 的 seam 机制我实际读过：Vite 插件把 `@tauri-apps/api/{core,event,app}` 与 `plugin-dialog` 别名到夹具 `api.ts`，由夹具导出合成 `invoke()`——「照此模式建 HTTP seam」的建议可行且不虚构能力。

**拟新增 6 项确实都不存在**：无后端启动入口、无配对/会话/CSRF 测试客户端、`tests/fixtures/web-contract` 48 个样例全是任务域（我逐个确认 `contractVersion` 唯一为 `web-api/1`）、无 HTTP seam 浏览器运行器、无 SIGKILL 重启用例。报告没有把「拟新增」写成「已存在」或「已执行」。

**授权判断逐条核对**：

- **已覆盖**：owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`（2026-11-07，MAYNE-22）「直接按照全新的脚本去新建表结构之类的。完成相关功能后，记得提交并合并到main，然后清理分支」，队长在 `01a1b64d…` 登记为「全新建表 + 完成后本地提交/合 main/清理已合并分支」。该授权的对象是已审 DDL `8511907c…143d` 的 11 张 web-backend/1 表。**报告没有把它外推到事项新表，正确。**
- **需具体化**：G-2 事项新表、G-6 守卫写入（新增顶层目录＝`top.dir` 违规，`check-structure.mjs:16` 白名单中确实只有报告列出的 12 个目录）、G-7 随包分发（涉 `scripts/build/`）、任何新生产依赖——四项都要求单独清单授权，与守卫源码和 AGENTS.md 的授权条款一致。**报告主动收窄而非放宽，正确。**
- **明确未授权**：push、部署、真实凭据/用户根、Linux/代理实测。与既有授权状态一致。

守卫行号我也逐行核对：`:16` 顶层目录白名单、`:153` `src/` 只许 `src/`+`shared/`、`:219` `runtime/` 只许 `entries/lib/workers`、`:223` `src-tauri/src` 顶层只许 `lib.rs/main.rs/app/store/host/diagnostics`、`:284` `schema.immutable-migration` 冻结迁移哈希、`:190-207` `scripts.check` 必须 structure 先于 docs。报告引用无误。

## 6. 发现项（均不阻塞）

**NIT-1 措辞精度（P3）**：报告 §3.1 写「`todo_events_v2`（动作集合扩到 create/update/complete/reopen/delete/link）」。实际 `002_ingestion.sql:4-14` 是建 `todo_events_v2` → 拷贝 → DROP 旧表 → RENAME 回 `todo_events`，动作集合确为那六项，最终表名仍是 `todo_events`。措辞可更准确，事实无误。

**NIT-2 术语一致性（P3）**：报告用「两类事项」指 action/followup，同时 W0 契约域有「三类不可混用的版本」（任务/条目/设置）。实施期建议在 P1 契约里固定术语，避免「两类/三类」在评审与验收中串味。属行文建议，不影响本报告结论。

**NIT-3 来源标注（P3）**：A-3 借用契约 §4.2 的任务查询语义作为事项列表/详情的范式来源（见 §4 末段）。报告已在 §4 G-3 说明属「范式借用」，但矩阵表内可再显式标注一次，防止后续读者误以为事项端点已在冻结契约中。

**未发现**：虚报实现、把原型/样例/探针外推为服务证据、越出写入范围、把授权扩写、把未验说成已验证。

## 7. 显式跳过与残余不确定性

- 未跑完整 `npm run check`、cargo 测试、探针套件、任何浏览器交互检查（按派发边界；本评审是报告单面聚焦评审）。
- 未启动任何服务、未读真实凭据/用户根、未动共享 main 与任务状态。
- 作者 `build/web-manual-items-readiness/` 原始证据未随评论交付，我按派发要求全部关键事实本地重建；不引用不可达日志。
- Linux/代理、真实模型：报告已标未验，我亦未验。
- MAYNE-23 的最终技术裁定与授权覆盖由队长在两份材料（P1 契约提案 + 本 P2 报告）及两份独立评审齐备后统一收口；本评审不代签实施准入。

## 8. 本次评审实际执行

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git diff --stat 55684a2 d94de69` | 0 | 1 file changed, 143 insertions(+) |
| `git show d94de69:<report> \| shasum -a 256` | 0 | 与登记值一致 |
| `git diff 55684a2 d94de69 \| shasum -a 256` | 0 | 与登记补丁值一致 |
| `git rev-parse 65469904^{tree}` | 0 | `7b71cdb3…`，与登记基座一致 |
| `git grep createServer <base> -- runtime src-tauri src shared scripts design` | 0 | 仅设计预览 + 诊断探针 |
| `git grep "api/todos\|api/items\|api/manual" <base>:web-api-contract.md` | 1（无命中） | 契约无事项端点 |
| `git show <base>:001_web_backend.sql \| grep -c "CREATE TABLE"` | 0 | 11 |
| `git grep -l "@tauri-apps/api/core" <base> -- src` | 0 | 16 个前端文件，无 fetch/CSRF/Origin |
| legacy 行号与导出核对（`sed -n`/`grep`） | 0 | 全部命中 |
| 守卫行号核对（`sed -n '16p;153p;219p;223p;284p'` 等） | 0 | 全部命中 |
| 可复用/拟新增命令存在性核对 | 0 | 8 项存在、6 类拟新增缺失 |
| `node --check design/web-task-flow/task-flow.js` | 0 | 语法通过（本树既有交付物，未改动） |
| `node scripts/checks/check-docs.mjs` | 0 | 18 文件、302 链接 |
| `git diff --check` | 0 | 无空白/冲突标记 |

写入范围：仅 `docs/reviews/web-manual-items-readiness-20261108-ohmypi-review.md` 与 `build/web-manual-items-readiness-review/`（`report-under-review.md`、`contract-endpoints.txt`、`ddl-001.sql`、`evidence-log.txt`）。未改实现、未跑完整重门禁、未动 main、未改本项/父任务状态、未读真实凭据/用户根。
