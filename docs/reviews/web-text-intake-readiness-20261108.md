# W1 启动准备：文本整理实际基座差距与可证伪验收矩阵（P2 独立核对）

> 本篇是 MAYNE-24 Stage 4 启动准备 P2 的交付物（父任务 MAYNE-17 派发评论 `01a1ba9e-a217-7e67-85ac-ab7d847ba8b1`）：从实际集成基座 `1e37044` 独立盘点「浏览器真实文本整理、候选修改与批量签收闭环」的真实差距，并独立给出可证伪验收矩阵。本篇只做事实核查与验收设计，不实现业务、不冻结契约、不宣告任何功能通过。P1（Claude）的纵向契约提案与真实授权差异和本篇写入范围互不重叠；本篇不重复其契约内容，也不等它才能开工。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. 登记与取证方法

| 项 | 值 |
|---|---|
| 执行位置 | `pwd`：本任务平台分配的独立工作树；`branch`：`agent/kimi/mayne-17` |
| 工作树 HEAD | `d94de69be5d3b837395f3aa8a823bde7d34fd167`（MAYNE-20 线，非 W1 线） |
| 读取的源码基点 | `1e3704432e7014f1e23b40e9aff9791662e9c6f5`，tree `77a548591ac9b02a51936c806bf4f85d774df7cb`（MAYNE-24 登记的实际本地 main；实测 `git rev-parse <base>^{tree}` 与登记值一致） |
| 基点与本分支关系 | 基点**不是**本分支 HEAD 的祖先。按 MAYNE-24 P2 派发要求，全部基座事实以 `git show` / `git grep` / `git ls-tree` 对精确基点只读取证，未 checkout、未 reset/stash、未以旧 HEAD 冒充新 main、未把旧工作树覆盖现场 |
| 盘点方法 | 路由表逐条核对（`matchRoute` 全文）；迁移目录列举；`git grep` 全仓检索调度器/队列表引用；存储适配写守卫常量与分派函数原文；Pi 接线（`Command::new`、payload 构造、kinds 白名单）；前端 store 传输导入行；构建脚本输出布局；测试与夹具清单；关键文件 sha256 前缀逐条记录 |

**路径引用约定**：本分支不含 W0/W1 集成内容。凡指向基座文件的路径以行内代码给出「位置 + 基座 sha256 前缀」，是对精确基点的取证引用，不构成本分支内可导航链接；本分支与基点一致的产品 01–04、验证约定用相对链接。原始证据在 `build/web-text-intake-readiness/`（本机证据目录，不入库）。

**边界**：源码与全部生产目录只读；未编写任何业务实现或测试；未运行完整重门禁（`npm run check`），未重跑已通过的 W1 测试来为前序结果背书；未读取真实凭据、`.env.deepseek` 或真实用户根；未发起任何真实模型/来源请求；未修改共享 main、`docs/reviews/README.md` 索引或 `product/05`；未改本项/父任务状态。

## 2. 总判

`1e37044` 已包含 W1 手工事项纵向切片（MAYNE-23 done）：真实同源 HTTP/会话/CSRF/Origin、静态产品 UI、stdio 存储适配、手工事项全端点、`application.timeZone` 单 key CAS、SIGKILL 重启恢复都在位并可复用。**文本整理（模型配置 → Pi organizer → 候选 → 预览 → 签收）在 Web 四个面上全部空白**：HTTP 路由无 tasks/providers/批次/候选/签收；前端 organizer store 仍走 Tauri IPC；新库无整理相关表；001 的任务队列表没有对应调度器实现（全仓检索 0 命中）；随包后端进程与随包 Pi Runtime 之间没有接线。可复用的是 legacy Tauri 实现（`ingestion.rs` 状态机、`runtime_host.rs` Pi 接线、`organizer-contract.mjs` 输出契约、`src/domain/organizer.ts` 类型与错误谱系、`TextIntake/CandidateCard/ModelSettingsPanel` 三件组件与带传输 seam 的 organizer store）——绑定 legacy lineage，不等于 Web 业务已通。差距清单见 §4，验收矩阵见 §5。

## 3. 分层现状（三层分开记账）

### 3.1 已有 legacy Tauri 文本整理实现（规则可复用，不等于 Web 业务已通）

位置均为基座文件（sha256 前缀见 §10）：

- **状态机**：`src-tauri/src/store/ingestion.rs`（`3a3c4914…`）：`sources`（原文 + 锚点 + 时区）、`candidates`（pending/accepted/discarded、version、draft）、`model_runs`（extract/revise/test、running/queued/succeeded/failed/cancelled/interrupted）；`begin_import`/`publish_candidates`/`finish_run_error`/`cancel_run`/`edit_candidate`/`discard_candidate`/`begin_revision`/`publish_revision`/`apply_preview`/`sign_candidates`/`interrupt_unowned_runs`/`run_directory` 全链在位。库为 legacy lineage（与 `todos` 同库），明确不做迁移/兼容桥。
- **Pi 接线**：`src-tauri/src/host/runtime_host.rs`（`71fe977f…`）：`Command::new(directory.join("node")).arg(directory.join("organizer.mjs")).args(["--run", id])`，`env_clear()` 仅留 `PATH`/`TMPDIR`，`process_group(0)`，stdin 写一行 JSON payload（`runId/kind/snapshot/mcp/apiKey/cwd/runLimitMs(≤120000)/anchorAtMs/source{rawText,timeZone}/candidate/instruction/hostNonce`），stdout 逐行 JSON 事件；`owned()` 用 `ps` 核对 pid/脚本/run/nonce 归属，`reap_workers` 杀 bash-worker 树；启动前 `interrupt_unowned_runs`。**apiKey 只经 stdin 进进程，不进 argv/环境变量。**
- **Pi 侧输出契约**：`runtime/entries/organizer-entry.mjs`（`c2c13249…`）只接受 `kind ∈ extract|revise|test|trial|today` 且 `snapshot.provider/model` 与 `apiKey` 必备，否则 `RUNTIME_PROTOCOL`；`runtime/lib/organizer-contract.mjs`（`a0a50440…`）：extract → `candidates`（≤50、`evidence` 必须是 `source.rawText` 子串、action 禁带 followup、标签 ≤12×≤32、日期表达式交 `shared/dates.mjs` 解析并保留待核对警告）；revise → `preview` 补丁（禁止 action 带跟进）；test → `{ok:true}`。错误分类含 `MODEL_INVALID_OUTPUT/MODEL_AUTH/MODEL_RATE_LIMIT/MODEL_TIMEOUT/MODEL_NETWORK/MODEL_SERVICE/CANCELLED/RUNTIME_PROTOCOL/RUNTIME_EXIT/RUNTIME_START`。
- **模型配置与凭据**：`src-tauri/src/store/model_config.rs`（`6480544e…`）：`<root>/config/providers.json` + `models.json`（symlink/nlink 守卫），密钥按 `credential-*` 引用存 macOS Keychain（`apple_native_keyring_store`），或 `apiKeyEnv` 指向宿主环境变量；`credential_status` 只报 `stored/missing/environment/unavailable`；`reject_plain_secrets` 禁明文；`expected_revision` 乐观并发（`MODEL_VERSION_CONFLICT`）。
- **前端**：`src/domain/organizer.ts`（`b7c26455…`）类型与 26 条错误文案；`src/stores/organizer.ts`（`c213a947…`）已是传输 seam 结构（`createOrganizerModel(api)`，命令面 `list_import_batches`/`read_import_batch`/`read_model_run`/`active_model_run`/`save_candidate`/`discard_candidate`/`apply_candidate_preview`/`sign_candidates`/`cancel_model_run`…）；`src/components/TextIntake.vue`（`8c8992e4…`）/`CandidateCard.vue`（`0fa155ce…`）/`ModelSettingsPanel.vue`（`3a68cfb3…`）为既有 UI，但全部经 Tauri `invoke`（organizer.ts:5 实测）。
- **传输现状**：`src/stores/todos.ts`（`d5e63732…`）已切 HTTP（`getWebApiClient`）；`src/stores/models.ts`（`9436163e…`）等 organizer 相关 store 仍 `import { invoke } from '@tauri-apps/api/core'`。

### 3.2 W1 已交付的 Web 基座（`1e37044` 实测在位，可直接复用）

- **服务进程**：`server/entries/web-backend-entry.mjs`（`bff28c87…`）：`startWebBackend({root,port,staticRoot,storageBin,initialize})` 程序化装配 + CLI（`--root/--port/--init`）；`npm run start:backend` 已在 `package.json`（`24927d48…`）。
- **路由**（`server/lib/http-server.mjs` `ae4287be…`，`matchRoute` 全文逐条核对）：`POST /api/pair`、`GET|DELETE /api/session`、`GET /api/events`（SSE）、`GET /api/workspace`、`GET|PUT /api/settings/application`、`GET|POST /api/manual-items`、`GET|PUT|DELETE /api/manual-items/{id}`、`POST .../complete|reopen`、`GET .../history`。错误码表与冻结契约一致（401/403/404/409/429/500）。
- **会话与 SSE**：`server/lib/session-store.mjs`（`9823db95…`，配对码换会话 cookie + CSRF）；`server/lib/sse-hub.mjs`（`f49951aa…`）：`stream.ready`/`stream.reset`（epoch 不符先重置）/`item.changed` 提示帧，客户端按提示重读。
- **存储适配**：`server/lib/storage-client.mjs`（`c721fc11…`）stdio JSON 一行一协议 spawn `bin/web-backend-storage`；Rust 侧 `src-tauri/src/bin/web-backend-storage.rs`（`71b83d7a…`）→ `web_backend_store.rs::run_stdio`，分派 `init/open/close/backup/transact/query/pragma`（`c1a3a157…`）。**写守卫**：`BUSINESS_TABLES = ["manual_items","manual_item_events"]`，`settings` 仅允许两条逐字节模板（`application.timeZone` 的 INSERT/UPDATE CAS）；读守卫 SELECT-only + 禁关键字。
- **schema**：`web-backend/001_web_backend.sql`（`8511907c…`，11 表：`schema_meta/tasks/task_attempts/task_events/side_effect_receipts/workspace_operations/recovery_holds/recovery_items/settings/instance_epochs/task_result_payloads`）+ `web-backend/002_manual_items.sql`（`b6cb8e61…`，`manual_items`/`manual_item_events`，`schema_meta` 镜像升 2 同事务）。
- **构建**：`scripts/build/build-backend.mjs`（`1acfe88f…`）产出 `build/web-backend/`（server/ + shared/ + bin/ + static/，**不含 Pi Runtime**，零 npm 依赖）；`scripts/build/bundle-runtime.mjs`（`0261e3ed…`）产出 `build/s0-runtime/`（`node`、`organizer.mjs`、`probe.mjs`、`skills-manager.mjs`、`mcp-probe.mjs`、`today-facts.mjs`、`bash-worker.mjs`、`mcp-guardian.mjs`、`builtin-skills`…）；Tauri 侧 `tauri.conf.json` resources 把 `../build/s0-runtime/` 映射为包内 `s0-runtime/`。
- **层界守卫**：`scripts/checks/check-structure.mjs`（`c98f79d0…`）：`server/` 只许相对引用 `server/`+`shared/`、裸导入只许 Node 内置（`layer.server`/`layer.server-bare`，:161/:288）、顶层只许 `entries/`+`lib/`（`layout.server-top`，:229）；`TOP_LEVEL_DIRS` 已含 `server`（:16）。
- **验收载体**：`tests/unit/web-manual-items.test.mjs` + `tests/integration/web-manual-items-{http,restart,static,fixture}.test.mjs`（`test:web-manual-items`，HTTP/重启/静态/夹具四类，夹具 `tests/fixtures/web-manual-items/`：backend-process 子进程 + 配对码 IPC、db-observer 只读同根观测、sse-listener）；`tests/integration/s31-runtime.test.mjs`（`b3dd4a0f…`）已示范「受控模型服务 + 真实 `build/s0-runtime/organizer.mjs` 子进程」驱动法；`tests/fixtures/s32-model-server.mjs`（`d796cefc…`）是 OpenAI 兼容 SSE 受控模型服务。

### 3.3 文本整理 Web 化空白（逐项有证据）

1. **路由空白**：`http-server.mjs` 中 `/api/tasks`、`/api/providers`、batches/candidates/sign/agent-concurrency、`/api/snapshot`、`/api/recovery*` 检索均为 0（§10 gap-evidence [2]）。冻结契约 §4/§5/§7 的端点一个都没实现。
2. **调度器空白**：`tasks/task_attempts/task_events/side_effect_receipts/instance_epochs/task_result_payloads/recovery_*` 在 `server/`、`web_backend_store.rs`、`web_backend_schema.rs`、`runtime/`、`src/` 中 0 引用；唯一命中是 `web_backend_schema_tests.rs`（schema 自测）。legacy `RuntimeState` 是单槽 `Option<Job>` + `RUNTIME_BUSY`，与 Web 要求的 3 槽 FIFO 持久队列不是一回事。**001 有表不等于调度器已实现。**
3. **整理数据空白**：新库无 sources/candidates/model_runs/预览表；legacy 同名表在另一 lineage，不迁移。
4. **后端→Pi 接线空白**：`build-backend.mjs` 全文 0 处 `s0-runtime`/`organizer`；`server/` 层界禁止引用 `runtime/`。后端要跑真实整理，必须像 Tauri 那样以子进程方式启包内 Runtime，需要新的装配/授权。
5. **凭据出口空白**：Web 侧没有 model config 读写端点；legacy 凭据解析在 Rust（Keychain/env）。后端进程如何拿到 `apiKey`（经存储适配代理？经 Rust 辅助命令？）未有实现，也没有任何把密钥送出后端的通道（正确）。
6. **前端空白**：`TextIntake.vue`/`CandidateCard.vue`/`ModelSettingsPanel.vue` 与 organizer/models/agents store 绑 Tauri；浏览器里今天的整理入口不可用（§3.1 实测 import 行）。
7. **SSE 空白**：现仅 `item.changed` 提示；任务进度/排队/取消中/`needs_review`/未知结果帧与 epoch/cursor 高水位补偿（冻结契约 §6、`/api/snapshot`）未接线。

## 4. 实际差距清单（现状 → 本任务纵向验收）

| # | 差距 | 事实与位置（基座） | 收口需要的动作 |
|---|---|---|---|
| G-1 | **整理 HTTP 端点全无** | §3.3-1；冻结契约 §4/§5/§7 有 `POST /api/tasks`、`GET /api/tasks*`、`/cancel|retry|resolve`、`result`、`/api/providers`、`/api/settings/agent-concurrency` | 按 P1 契约新增路由；任务域端点走冻结契约原文，整理业务 payload 由本切片兼容扩展定义，不改冻结契约 |
| G-2 | **持久队列与调度器** | §3.3-2；设计文档 §5（基座 `46e3a9dc…`）：`agentConcurrency` 默认 3、FIFO 按提交序、领取事务写 attemptId/epoch、下调不杀运行、重启先核实旧 worker | 实现领取/调度/并发设置/取消竞争/重启扫描；`RUNTIME_BUSY` 只作内部错误，不作提交契约 |
| G-3 | **整理数据落库** | §3.3-3；legacy `ingestion.rs` 全链可移植 | 新迁移（web-backend/003?）sources/candidates/model_runs（或等效拆分）+ 事件/回执；**新 DDL 需单独授权**；存储适配 `BUSINESS_TABLES` 写守卫与 schema 测试同步扩展（守卫改动需随授权包送审） |
| G-4 | **后端启 Pi 子进程** | §3.3-4/5；legacy 接线在 `runtime_host.rs`（`Command::new(node)+organizer.mjs --run`、env_clear、process_group、`owned()` 核实、stdin 单行 payload、apiKey 只进 stdin） | 后端进程按同协议 spawn 包内 Runtime；bundle 布局变更（随包分发或引用应用资源）属构建授权项；`server/` 零依赖层界不变 |
| G-5 | **模型配置与凭据出口** | §3.1；`model_config.rs` 文件 + Keychain/env 引用；`credential_status` 语义 | 新增 provider/模型配置读写端点（只出引用状态不出秘密）；后端执行前解析密钥并经私有通道（stdin）给子进程；与 Rust 既有凭据库的复用/分工由 P1 定案 |
| G-6 | **并发设置端点与 settings 守卫** | 现 `settings` 仅允许 `application.timeZone` 两条模板（§10 [5][13]）；冻结契约 §5 的 `agent-concurrency` 有自己的设置版本 CAS | 新增并发 key 需在 Rust 守卫增加精确模板（与 timeZone 同规格逐字节比对）——**属守卫改动，随新 DDL 授权包送审** |
| G-7 | **SSE 任务帧与快照补偿** | §3.3-7；设计 §5「多客户端与事件补偿」；冻结契约 §6 | 任务事件带 epoch/递增游标/对象版本；`/api/snapshot` 高水位全量快照；`stream.reset` 后强制重同步；页面关闭不取消任务 |
| G-8 | **重启/恢复与副作用未知** | W1 重启测试只覆盖手工事项 + 根锁；设计 §5 恢复边界（旧 worker 核实、`needs_review`、禁止自动重放） | 整理任务纳入恢复扫描；外部副作用回执（`side_effect_receipts`）落库；用户决议入口；受控服务下先验「退出未知占槽、重启先核实再调度」 |
| G-9 | **前端 UI 接线** | §3.3-6；交互方案已在 MAYNE-21 交付（`design/web-task-flow/` 原型 + `web-task-interaction` 契约，基座 `f358c6a8…` 线） | organizer/models/agents store 增 HTTP 传输实现（复用 `createOrganizerModel(api)` seam）；`TextIntake`/`CandidateCard`/`ModelSettingsPanel` 改注入客户端；排队位置/取消中/待核对/失败态与窄宽屏 |
| G-10 | **授权覆盖核对** | 已授权：W1 A–D 的 002/目录/二进制/构建清单（owner `01a1b80b`）、完成后本地提交/main 合入/清分支（`01a1b648`） | **真正新增**：G-3 新 DDL、G-4 bundle 布局、G-6 守卫模板、G-9 若需新 npm 脚本（`package.json` 共享文件）——逐项精确清单后一次送审；未授权：push、部署、真实凭据/用户根、真实模型 |

## 5. 可证伪验收矩阵（独立给出）

观测口径：**页面**＝浏览器实际渲染（真实同源 UI，不是原型合成）；**HTTP**＝对后端真实请求/响应；**库**＝同一新合成根上 `web-backend.sqlite` 实际行（只读观测）；**进程**＝后端子进程与 Pi Runtime 子进程的实际行为（ps/退出码/stdout 事件行）。不用 HTTP 代 UI，不用日志摘要代原始记录。ID 与 W1 矩阵（A-*）并列不冲突，供实现测试引用。

| # | 验收项 | 来源 | 应观测结果 | 证伪反例（出现即不通过） |
|---|---|---|---|---|
| T-1 | 无模型时不回归 | 产品 [02](../product/02-用户流程.md) §1（无模型仍可手工管理）；MAYNE-24 范围 | 未配模型/凭据：手工事项全动线（录入/编辑/完成/历史/重启重读）与 W1 验收一致；整理入口明示「先配置模型」但不阻塞手工路径；整理不进任务队列 | 手工流程被模型配置阻塞；整理请求在无凭据时静默入队；用 W1 绿证概括本项新代码 |
| T-2 | 模型配置与凭据引用状态 | 产品 [03](../product/03-智能体与架构.md) 凭据归属；legacy `model_config.rs` `credential_status`；冻结契约 §7 | 配置页可读 provider/模型列表与 `credentialRefs` 状态（available/missing）；保存只落引用与文件、禁明文（`PLAIN_CREDENTIAL` 拒）；浏览器任何响应/SSE/日志 grep 不到密钥值 | 响应体带回 `apiKey`；状态把「未配置」显示成可用；明文落库或落盘 |
| T-3 | 缺失/撤销凭据的整理 | legacy 错误谱系（`CREDENTIAL_MISSING`/`MODEL_AUTH`）；`src/domain/organizer.ts` 文案 | 缺密钥提交 → run `failed` + `CREDENTIAL_MISSING`，无候选、原文保留、可重试；撤销密钥 → `MODEL_AUTH`；两者都不产生候选、不占死执行槽 | 缺失凭据也启动 Pi 子进程；失败后槽不释放；错误提示把未接收说成已接收 |
| T-4 | 受控服务经真实 Pi 执行 | MAYNE-24 范围（受控模型路径先行）；`s31-runtime`/`s32-model-server` 模式（基座哈希见 §10） | 受控 OpenAI 兼容服务作 provider `baseUrl`；提交后**真实** `organizer.mjs` 子进程发起对话（受控服务记录到请求）；候选由模型输出经 `organizer-contract` 解析产生；`evidence` 为原文子串 | 候选在无任何模型请求时出现（硬编码 UI 候选）；请求未带密钥引用/用了明文；解析失败被静默吞掉 |
| T-5 | 5 任务 3 运行 2 排队与调并发 | 设计 §5（`agentConcurrency` 默认 3、FIFO、下调不杀运行）；冻结契约 §5 | 连续提交 5 个整理任务：3 `running` + 2 `queued` 且各带 `queuePosition`；领取顺序＝提交序（`submitSeq`）；`PUT agent-concurrency` 带 `expectedVersion` 调升 → 空槽补发；调降 → 运行中不被杀、自然退出后满足新上限；某任务结束/取消 → 队首晋升 | 满槽拒绝提交（`RUNTIME_BUSY`/409 当普通提交契约）；并发可瞬时超发；排队顺序按更新时间重排；下调杀运行中任务 |
| T-6 | 取消竞争与退出未知占槽 | 设计 §5（queued 取消事务、running 取消先持久 `cancelling`、未确认退出不释放槽）；冻结契约 §4.4 | 取消 queued → `cancelled` 且调度器不再启动；取消 running → `cancelling` → 子进程退出核实后 `cancelled`；两客户端同取消 → 一赢一 `409 state_conflict`；`SIGKILL` Pi 子进程 → attempt 记退出未知、**槽保持占用**、run `needs_review` 不明示「已取消」 | 后取消静默覆盖；取消后槽立即释放并调度下一任务；退出未知显示成 succeeded/cancelled；竞争双方都 200 |
| T-7 | 服务 SIGKILL 同根重启先核实再调度 | 设计 §5 重启边界；W1 重启测试模式（基座 `web-manual-items-restart` 线） | 合成根显式 init → 提交若干（部分 running）→ `SIGKILL` 后端 → 重启同根：queued 保留；上次 running 记 `interrupted`/`needs_review`；**先核实旧 worker 进程树已停再恢复调度**；根锁释放与重获正常；SSE epoch 变 → `stream.reset` → 客户端 `/api/snapshot` 重同步；已签收候选与事项逐条完好 | 重启直接重跑未核实任务（副作用重放）；锁泄漏拒开根；浏览器把本地缓存当权威；快照落后于高水位 |
| T-8 | 重复提交与响应未知不多建 | 冻结契约 §3.3/§4.1；legacy `operation_id` 语义 | 同 `operationId` + 同规范输入 → 200 `replayed:true` 同一任务；不同输入 → 409 `idempotency_conflict`；响应丢失 → `GET /api/tasks?operationId=` 读回；全程候选/任务行数不超 | 重放建新任务/新候选；同 ID 两行；冲突返回 500 或通用错误 |
| T-9 | 修改先预览不直接覆盖 | legacy `begin_revision`/`publish_revision`/`apply_preview`；MAYNE-24 范围 | 对候选下自然语言指令 → 返回 `preview` 草稿（原候选 version/内容不变）；`apply` 带 `expectedVersion` 才落；过期版本 → 409 `version_conflict`；预览里 action 被指令改成带跟进 → 拒绝并说明 | 指令直接覆盖候选；apply 不带版本；预览即入库 |
| T-10 | 候选编辑/关联/丢弃/批量签收原子性 | legacy `edit_candidate`/`discard_candidate`/`sign_candidates`；产品 [02](../product/02-用户流程.md) §4（签收才成为事项） | 编辑校验与手工事项同规则；关联既有事项带目标 `expectedVersion`（过期 409）；丢弃 → `discarded` 且不计 pending；批量签收单事务：全部成功才建事项，任一失败 → 无事项、候选仍 pending、错误明示；**task 成功 ≠ 签收** | 批量签收留半成品；关联覆盖出新版本事项；丢弃候选仍出现在待签收计数 |
| T-11 | 今日/完成/来源证据 | 产品 [04](../product/04-分期交付与验收.md)；legacy `todo_source_links` | 签收后事项出现在今日/完成列表，可回溯来源（原文 + 锚点 + run）；未签收候选不进入正式列表 | 签收后事项无来源链路；候选直接出现在今日；完成列表混入未签收项 |
| T-12 | 时区锚点与日期不让模型猜 | `shared/dates.mjs`（`zonedCandidates`/`resolveExpression`）；legacy organizer-contract 日期证据规则；产品 02 §3 | 来源时刻夏令时缺口/歧义按 W1 A-2 同规则处理；模型只交表达式，时点由 `shared/dates.mjs` 依锚点解析；待核对项有警告且不静默 | 时间只落 epoch ms 丢时区/精度；歧义任取不告知；模型直接给绝对时间被接受且无证据要求 |
| T-13 | Origin/CSRF/会话失效与秘密不泄漏 | 冻结契约 §2/§10；W1 A-9 同规则 | 未配对 401；写缺/错 CSRF 403；跨源 403；会话过期中途 → 后端任务继续，重新配对后按同一 ID 读回；全部响应/SSE/子进程 argv 与日志无密钥 | 无会话写成功；CSRF 可选；Origin 只警告；密钥进 argv/日志/SSE |
| T-14 | 窄宽屏与真实同源 UI | MAYNE-21 交互方案（基座 `design/web-task-flow/`）；产品 04 工作台行 | 真实浏览器（窄/宽）走完：贴文 → 来源时刻 → 整理中（排队位置/运行）→ 候选卡片（编辑/预览/丢弃/签收）→ 今日可见；状态文案与键盘焦点符合交互方案；静态资源由后端同源服务 | 用原型/合成 IPC 代签；窄屏横向滚动或状态不可达；刷新后排队位置丢失且无读回 |

矩阵外显式声明：**三角色/Skills/MCP/飞书/提醒/薄壳不在本任务范围**；真实模型动线见 §8，不用受控服务结果冒充。

## 6. 命令清单：现存可复用 vs 拟新增

**已存在、可直接复用**（均在 `1e37044` 核实；聚焦入口，不替代最终完整门禁，不重跑 W1 已通过项）：

| 命令 | 用途 |
|---|---|
| `npm run build:backend` | 装配 `build/web-backend/`（server+shared+bin+static）；新端点开发的前置 |
| `npm run start:backend` | 启动后端（`--root` 合成根 + `--init`） |
| `npm run test:web-manual-items` | W1 五文件回归（HTTP/重启/静态/夹具）；整理端点不得破坏它 |
| `npm run probe:bundle` | 产出 `build/s0-runtime/`（含 `node`、`organizer.mjs`）——真实 Pi 执行的前提 |
| `npm run test:s31-runtime` | 「受控模型服务 + 真实 organizer.mjs 子进程」驱动法现成模式（stdin 单行 payload、stdout 事件行、t.after 清理） |
| `npm run dev:s32-native-model` | 启 OpenAI 兼容受控模型服务（`tests/fixtures/s32-model-server.mjs`，SSE + tool_calls） |
| `node --test tests/unit/s31-client.test.mjs tests/unit/tracker-contract.test.mjs tests/unit/advisor-contract.test.mjs` | organizer 侧契约/客户端单测（legacy 线，移植时随迁） |
| `node --test tests/unit/s2-dates.test.mjs` | 日期锚点/时区规则回归 |
| `node --test tests/unit/web-manual-items.test.mjs` | 手工事项域单测（签收/版本/幂等语义参照） |
| `npm run check:rust` / `npm run check:structure` / `npm run check:docs` | Rust 门禁 / 结构守卫（含 server 层界负例）/ 文档链接 |
| `npm run probe:bundle-smoke` | 包冒烟 |
| `git diff --check` | 空白/冲突标记 |

**拟新增（当前不存在，验收前须建；不冒称已执行）**：整理域 HTTP 测试（仿 `tests/fixtures/web-manual-items/` 建 `tests/fixtures/web-text-intake/`：backend-process、db-observer、sse-listener、controlled-provider）；受控 provider 服务的故障注入矩阵（§7）；队列/调度测试（5 任务并发、取消竞争、SIGKILL 同根重启核实）；后端→Pi spawn 集成测试（子进程归属核实、cancel 协议、apiKey 只进 stdin 的断言）；整理态浏览器旅程运行器（HTTP seam + 无头 Chrome，仿 `desktop-controls` 模式）；`npm run test:web-text-intake` 脚本（`package.json` 属共享文件，按集成任务清单改）；最终版本上的完整 `npm run check`（由唯一集成负责人在实际集成版本串行执行）。

## 7. 受控 provider 服务规格（实现前供队长冻结）

- **协议面**：OpenAI 兼容 chat completions（ organizer 经 `@earendil-works/pi-ai` openai-completions 流式调用）；受控服务返回 SSE（`data: {...choices:[{delta}]}` + `[DONE]`），可按脚本分两段：先 tool_calls（read/bash）后最终 JSON。现成底座：`tests/fixtures/s32-model-server.mjs`（`stream()` 助手 + `SIDEKICK_SYNTHETIC_PORT` 就绪信号 + SIGTERM `closeAllConnections` 清理）。
- **就绪与观测**：端口监听后向 stdout 写一行 URL（现成模式）；每次请求落 `model.jsonl`（runId/请求体摘要/是否带 Authorization 头但**不记值**）；测试以「记录条数」证伪「未经模型」。
- **故障注入点**（每点一条可证伪断言）：① 401/429/5xx 状态 → `MODEL_AUTH`/`MODEL_RATE_LIMIT`/`MODEL_SERVICE`，原文保留；② 慢响应超过 `runLimitMs`(≤120s) → `MODEL_TIMEOUT` 且槽释放；③ 流中断（写一半 close）→ `MODEL_NETWORK`/未知处理，不产生半候选；④ 进程退出（受控服务自杀）→ 子进程退出核实路径；⑤ 非法输出（非 JSON/形状不符/`evidence` 非原文子串/action 带 followup）→ `MODEL_INVALID_OUTPUT`，无候选落库；⑥ tool_calls 序列（read → bash → 最终）驱动 ManagedBash 路径，验证 cwd/清理归属。
- **同步就绪**：以后端「任务进入 running 且受控服务收到首个请求」为同步点；排队断言用 `queuePosition` 与 DB 行，不用 sleep 猜。
- **清理策略**：受控服务 SIGTERM → `closeAllConnections` + close；测试 `t.after` 杀子进程、`rmSync` 临时根与 run 目录；后端 `close()` 先停 SSE/HTTP 再关存储适配（stdin EOF 释放根锁，现成 `StorageClient.close`）。
- **秘密边界**：受控服务可断言「请求带认证头」但不记录值；`apiKey` 只经 stdin payload 进 organizer（legacy 现约），禁 argv/环境变量/日志。

## 8. 真实模型验收（单列；未授权，本轮不执行）

- **所需 owner 输入**：指定凭据来源（项目惯例为 owner 指定的 `.env.deepseek`，本轮未读）与端点/模型标识；明确授权真实模型调用范围（仅合成原文，不触真实用户资料）。
- **最小验收集**（授权后另立）：① 真实 extract：一段合成纪要 → 候选（含日期表达式与 evidence）→ 签收 → 今日可见；② 真实 revise：一条指令 → 预览 → apply；③ 失败面：错误密钥 → `MODEL_AUTH`。③②①各留原始证据（请求/响应脱敏、DB 行、页面截图）。
- **边界**：受控服务结果不得改称真实模型通过；真实模型验收不阻塞本切片受控实现与门禁。

## 9. 授权与写入缺口（核对结论）

- **已覆盖**：W1 A–D 的 002 迁移/目录/二进制 manifest/构建清单（owner `01a1b80b-f132-716c-bebb-28f260f0c73d`）；完成后本地提交、合入本地 main、清理已合并分支（`01a1b648-6d01-74e8-a06a-2d824003a5e5`）；均不含 push/部署/真实凭据。
- **真正新增、须逐项精确送审（不视为已获批）**：G-3 新 DDL（web-backend/003 或等效）及 `BUSINESS_TABLES` 写守卫扩展；G-4 随包后端布局纳入/引用 Pi Runtime 的构建变更；G-6 `agent-concurrency` 设置 key 的 Rust 精确模板；G-9 新 npm 脚本（`package.json`）；以上随 P1 授权差异文档一次成包，由队长合并裁定。
- **明确未授权**：push、远端 PR、部署、真实凭据/用户根、真实模型调用、新增生产依赖（server 层现为零 npm 依赖，保持）。

## 10. 证据与自检

**基座身份**（`build/web-text-intake-readiness/base-tree.txt`、`base-file-list.txt`）：`1e37044` tree `77a5485…`（与 MAYNE-24 登记一致）；本分支 HEAD `d94de69`，基点非其祖先（`git merge-base --is-ancestor` 实测 NOT_ANCESTOR）。

**基座关键文件 sha256 前缀**（`git show 1e37044:<path> \| shasum -a 256`，全表 `build/web-text-intake-readiness/base-file-hashes.txt`）：

```text
8511907cf7555679  src-tauri/migrations/web-backend/001_web_backend.sql
b6cb8e61609f8345  src-tauri/migrations/web-backend/002_manual_items.sql
bff28c8749e9268e  server/entries/web-backend-entry.mjs
ae4287bee7649e87  server/lib/http-server.mjs
c4e4da19f4318840  server/lib/manual-items-service.mjs
9823db95128835c8  server/lib/session-store.mjs
f49951aa6fbcc9f6  server/lib/sse-hub.mjs
c721fc110b1fc962  server/lib/storage-client.mjs
b9add2f41b39c46b  server/lib/application-settings-service.mjs
c1a3a15781e378af  src-tauri/src/store/web_backend_store.rs
73892eb80b8f8625  src-tauri/src/store/web_backend_schema.rs
3a3c4914e1676807  src-tauri/src/store/ingestion.rs
6480544e675b1f6f  src-tauri/src/store/model_config.rs
71fe977f25d3ed4c  src-tauri/src/host/runtime_host.rs
71b83d7a240f50c2  src-tauri/src/bin/web-backend-storage.rs
c213a94792847ba8  src/stores/organizer.ts
d5e63732d4760a65  src/stores/todos.ts
b7c26455a70c6ada  src/domain/organizer.ts
8c8992e4299ef58c  src/components/TextIntake.vue
0fa155ce3359ec16  src/components/CandidateCard.vue
c2c1324993500501  runtime/entries/organizer-entry.mjs
a0a5044091d9098a  runtime/lib/organizer-contract.mjs
1acfe88f89e11eb4  scripts/build/build-backend.mjs
0261e3edbcb5b845  scripts/build/bundle-runtime.mjs
61863271a82f46ed  docs/engineering/web-api-contract.md（基点文件，本分支无）
08afea02c5185b76  docs/engineering/web-manual-items-contract.md（基点文件，本分支无）
46e3a9dc7daa7a32  docs/engineering/web-backend-design.md（基点版本）
7e235f61b217b74d  tests/integration/web-manual-items-http.test.mjs
b3dd4a0fe3fcecf9  tests/integration/s31-runtime.test.mjs
d796cefc2a0206d2  tests/fixtures/s32-model-server.mjs
```

**差距取证**（`build/web-text-intake-readiness/gap-evidence.txt`）：`matchRoute` 路由全表；tasks/providers/batches/candidates/sign/agent-concurrency/snapshot/recovery 在 `http-server.mjs` 检索 0；调度器关键词（claim/scheduler/fifo/submit_seq/queuePosition）在 `server/`+两个 web_backend Rust 文件检索 0；task 系表仅 `web_backend_schema_tests.rs` 命中；`BUSINESS_TABLES` 与两条 settings 模板原文；organizer-entry kinds 白名单行；SSE 事件名三枚；build-backend 布局注释与 `s0-runtime` 检索 0；tauri resources 映射；bundle-runtime 产物清单；`test:web-manual-items` 脚本原文。

**本篇自检**（本机实跑，非完整门禁）：`node scripts/checks/check-docs.mjs`、`git diff --check`、`git status` 核对写入范围——退出码与结果见 `build/web-text-intake-readiness/self-check.txt`。本篇只新增 `docs/reviews/web-text-intake-readiness-20261108.md` 与 `build/web-text-intake-readiness/` 证据，未碰其余文件。

## 11. 边界与未验项

- 未验证：任何整理 HTTP 端点（不存在）、新库整理读写（无实现）、后端→Pi 接线（无实现）、队列/调度（无实现）、Linux/代理、真实凭据/用户根、真实模型；W1 门禁 51 组绿证只覆盖 W1 已交付代码，不构成本切片任何担保。
- 本篇「设计了用例」不等于「新功能通过」；T-1..T-14 全部待实现后按 §6 命令执行；拟新增命令未跑过，不冒称存在。
- 与 P1 的关系：接口字段/DDL 形状以 P1 契约与队长裁定为准；本篇的差距事实（路由/表/守卫/接线空白）与验收观测点不依赖 P1 草案，若 P1 改变接口形状，矩阵的「应观测结果」按冻结契约与产品来源校准，证伪反例不变。
- 交付后按派发由 OhMyPi 独立审阅事实/覆盖/边界；两份材料齐备后由队长合并技术裁定与授权覆盖，再决定 MAYNE-24 正式实施准入。本篇作者不自签 APPROVE，不通知他人按未定草案开工。
