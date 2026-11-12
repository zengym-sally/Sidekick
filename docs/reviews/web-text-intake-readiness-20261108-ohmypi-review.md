# MAYNE-24 P2 准备材料独立审阅：文本整理实际基座差距与可证伪验收矩阵（OhMyPi）

> 单面聚焦评审：对象是 Kimi 的 P2 报告 `docs/reviews/web-text-intake-readiness-20261108.md`（提交 `43433ae5b1093afa4024ba1bde4f6d12abae5c95`，父 `d94de69`）。我未参与该报告的任何部分。本篇只审事实、覆盖、边界与授权判断，不实现业务、不冻结契约、不宣告任何功能通过，也不替代 Claude 的 P1 契约提案。
> 评审方法与派发一致：候选只读；基座事实从精确源码基点 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`（tree `77a548591ac9b02a51936c806bf4f85d774df7cb`）用 `git show`／`git grep`／`git ls-tree` 独立重建，不整树合入旧分支；作者 `build/` 证据未随评论交付，全部关键事实本地重算。原始观察值见 `build/web-text-intake-readiness-review/evidence-log.txt`。

## 1. 结论

**通过（无阻塞项；4 项不阻塞 NIT 见 §6）。**

报告的基座身份、G-1–G-10 十项差距、T-1–T-14 十四条验收矩阵的来源/观测/证伪设计、受控 provider 服务规格、真实模型验收的单列边界，以及授权判断的逐条出处，都在精确基点 `1e37044` 上独立重建成立。我复算了报告与补丁哈希、`matchRoute` 路由全表、存储写守卫与 settings 模板、构建/bundle 布局、legacy Pi 接线与输出契约、模型配置凭据语义、前端传输分层、23 个基座文件哈希、11 条可复用命令与 6 类拟新增命令的缺失，以及两处 owner 授权原文。没有发现把未实现说成已实现、把原型/受控服务外推为真实模型证据、把 W1 A–D 授权扩写到本切片新增项，或把未验说成已验证的情况。

报告对其边界的表述诚实且可核验：明确「001 有表不等于调度器已实现」、明确「设计了用例不等于新功能通过」、明确 W1 门禁 51 组绿证只覆盖 W1 已交付代码、明确受控服务结果不得改称真实模型通过、明确作者不自签 APPROVE。

## 2. 交付身份核验

| 项 | 声明值 | 我复算 |
|---|---|---|
| 报告 sha256 | `2d647417…` | `2d6474171802f16686d6cc4ad4613f028a48e0a253a4e7797cdb7c81125d17bc` ✓ |
| 补丁 sha256（format-patch 形式） | `659616d3…` | `659616d3e4b9a92d814cda3d0c68d1e82dcb4bc794fb1cd176c636f68b358931` ✓ |
| 补丁 sha256（plain diff 形式，补充记录） | — | `64d8da3846a847b0a7c5c90530edcd2946aba3fcc527ee22e61598779f44e14c` |
| 增量 | 仅报告一个文件 | `git diff --stat d94de69 43433ae` = 1 file changed, 186 insertions(+) ✓ |
| 基座 tree | `77a5485…` | `git rev-parse 1e37044^{tree}` = `77a548591ac9b02a51936c806bf4f85d774df7cb` ✓ |
| 基座与分支关系 | 基点非本分支祖先 | 本评审树同样不含该祖先；`git merge-base --is-ancestor 1e37044 HEAD` = 1；全部事实按精确基点只读重建 ✓ |

取证方式成立：报告分支只承载报告，源码按精确基点单独读取，避免把旧基线整树合入，与派发要求一致。

## 3. 十项差距逐项重建

**G-1 整理 HTTP 端点全无——成立。** `server/lib/http-server.mjs` 的 `matchRoute`（:66–89）我逐行复现：`/api/pair`、`/api/session`（GET/DELETE）、`/api/events`、`/api/workspace`、`/api/settings/application`（GET/PUT）、`/api/manual-items`（GET/POST）与 `/api/manual-items/{id}`（GET/PUT/DELETE + complete/reopen/history）。`tasks`/`providers`/`batches`/`candidates`/`sign`/`agent-concurrency`/`organizer`/`recovery` 检索均为 0；`snapshot` 的 4 处命中全是 :274/:287 的局部变量，不是路由。冻结契约 §4/§5/§7 的端点一个都没实现。

**G-2 持久队列与调度器空白——成立。** `task_attempts`/`side_effect_receipts`/`task_result_payloads`/`instance_epochs`/`recovery_*` 在 `server/` 命中 0；`claim`/`scheduler`/`fifo`/`submit_seq`/`queuePosition` 在 `server/` 命中 0；全仓 `task_attempts` 命中里代码只有 `web_backend_schema_tests.rs`（schema 自测）。legacy 侧 `mcp_host.rs:327` 是 `self.slot.lock().map_err(|_| error("RUNTIME_BUSY"))` 的单槽实现，与 Web 要求的 3 槽 FIFO 持久队列不是一回事。**「001 有表不等于调度器已实现」的表述准确。**

**G-3 整理数据落库空白——成立。** `001_web_backend.sql`（sha256 `8511907cf7555679…`，与登记一致）11 表无事例/候选/运行表；`002_manual_items.sql`（`b6cb8e61609f8345…`，与 MAYNE-23 审定 DDL 一致）只有 `manual_items`/`manual_item_events` 且末句正是 `UPDATE schema_meta SET schema_version = 2 WHERE id = 1;`。legacy 同名表在另一 lineage，报告「不迁移」与权威定案一致。

**G-4 后端→Pi 接线空白——成立。** `build-backend.mjs` 中 `s0-runtime|organizer` 检索 0，产物为 `build/web-backend/`（server/ + shared/ + bin/web-backend-storage + static/）；`bundle-runtime.mjs` 产物含 `node`、`organizer.mjs` 等，`tauri.conf.json:33-34` 把 `../build/s0-runtime/` 映射为包内 `s0-runtime/`。守卫 `check-structure.mjs:161`（`server/` 只许相对引用 `server/`+`shared/`）、`:35`+`:229`（顶层只许 `entries/`+`lib/`）、`:288`（裸导入只许 Node 内置）共同构成「后端不能直接引 runtime/」的层界。legacy `runtime_host.rs` 的接线我逐行核实：`:680 Command::new(node)`、`:682 .arg(organizer.mjs)`、`:683 .args(["--run", run_id])`、`:685 .env_clear()`、`:688 .stdin(piped())`，payload 于 :244/:678 含 `apiKey` 与 `hostNonce`，apiKey 出现在 argv/arg 的行数为 0——**apiKey 只进 stdin 属实**；`:90 owned()` 用 `/bin/ps` 核实归属、`:105 reap_workers`、`:226 interrupt_unowned_runs` 均在位。

**G-5 凭据出口空白——成立。** `model_config.rs` 的 `credential_status`（:25）、`reject_plain_secrets`（:99）、`apiKeyEnv`/`apiKeyRef` 二选一（:168）、状态词表 `stored/missing/environment/unavailable`（:452–460）、目录符号链接与 `nlink()==1` 守卫（:314–320）全部存在；Web 侧确实没有 model config 读写端点（路由表已证）。

**G-6 并发设置端点与 settings 守卫——成立。** `web_backend_store.rs:18` 的 `BUSINESS_TABLES = ["manual_items","manual_item_events"]`、:543 的写守卫分支、:555/:557 两条 `application.timeZone` 逐字节模板都已核验；不存在 `agent-concurrency` 模板，因此报告把「新增并发 key 需在 Rust 守卫增加精确模板」列为随授权包送审的守卫改动，判断正确。

**G-7 SSE 任务帧与快照补偿空白——成立。** `sse-hub.mjs` 只有 `stream.ready`/`stream.reset`/`item.changed` 三枚事件；无任务进度/排队/取消中帧，无 epoch/cursor 高水位补偿（`/api/snapshot` 路由不存在，已证）。

**G-8 重启/恢复与副作用未知——成立。** W1 重启测试只覆盖手工事项与根锁（`tests/integration/web-manual-items-restart.test.mjs` 存在且内容为事项域）；整理任务纳入恢复扫描、`side_effect_receipts` 落库、用户决议入口均无实现。

**G-9 前端 UI 接线空白——成立。** `src/stores/todos.ts` 已切 `getWebApiClient`（HTTP）；`src/stores/organizer.ts:5` 与 `src/stores/models.ts:1` 仍 `import { invoke } from '@tauri-apps/api/core'`。同时 `organizer.ts:11` 的 `createOrganizerModel(api:Backend, guard)` seam 与 :64 的 `createOrganizerModel(invoke, …)` 装配确认存在——报告「复用该 seam 增 HTTP 传输实现」的路径可行，不是虚构能力。

**G-10 授权覆盖核对——成立（详见 §5）。**

**附带的 legacy 可复用性核实**：`ingestion.rs` 的 12 个被引函数（`begin_import`/`publish_candidates`/`finish_run_error`/`cancel_run`/`edit_candidate`/`discard_candidate`/`begin_revision`/`publish_revision`/`apply_preview`/`sign_candidates`/`interrupt_unowned_runs`/`run_directory`）各存在一次；`organizer-entry.mjs:63` 的 kinds 白名单（extract/revise/test/trial/today + provider/model/apiKey 必备，否则 `RUNTIME_PROTOCOL`）与 :54–58 的错误映射（401/403→`MODEL_AUTH`、429→`MODEL_RATE_LIMIT`、timeout→`MODEL_TIMEOUT`、network→`MODEL_NETWORK`、其余→`MODEL_SERVICE`）逐字命中；`organizer-contract.mjs` 的 candidates ≤50（:31）、evidence 必须是原文子串（:20）、日期表达式也须为子串（:22）、action 禁带 followup（:23）、标签 ≤12 且去重（:8–9）全部存在。`organizer-entry.mjs:5-6` 确认走 `@earendil-works/pi-ai` 的 openai-completions 流式接口——**这使「OpenAI 兼容受控服务可作 provider baseUrl」的技术判断成立。**

## 4. T-1–T-14 验收矩阵

逐条核对了来源可引用性、四类观测口径（页面/HTTP/库/进程）与证伪反例：

| # | 来源核对 | 观测/反例核对 |
|---|---|---|
| T-1 | product/02 §1「无模型连接时仍可手工管理事项」原文命中 | 「手工流程不被模型配置阻塞」「整理不进任务队列」「不借用 W1 绿证概括新代码」三类反例均可执行且口径正确 |
| T-2 | product/03 凭据归属（`CredentialProvider`：环境引用/OS 凭据存储）；`model_config.rs` `credential_status`/`reject_plain_secrets` 已核 | 「响应不带 apiKey」「明文拒收」「状态不把未配置显示成可用」反例与代码行为一致 |
| T-3 | `organizer.ts` 文案表含 `CREDENTIAL_MISSING`/`MODEL_AUTH`（我实测该文件导出这 12 个错误码） | 「缺凭据也启动子进程」「失败后槽不释放」反例成立 |
| T-4 | `s31-runtime.test.mjs:50` spawn 真实 `build/s0-runtime/organizer.mjs` + :52 内联受控 SSE 服务；`s32-model-server.mjs:2` 支持 tool_calls、:10 就绪写 URL、:11 SIGTERM 清理 | 「无任何模型请求却出现候选」可用受控服务请求计数证伪——观测设计可执行 |
| T-5 | 设计 §5（`agentConcurrency` 默认 3、FIFO 按提交序、上调补发/下调不杀、领取事务写 attemptId/epoch）；契约 §5（GET/PUT agent-concurrency + expectedVersion 校验设置版本） | 「满槽 409 当提交契约」「瞬时超发」「下调杀运行」反例与权威条文一一对应 |
| T-6 | 设计 §5 queued/running 取消规则；契约 §4.4（expectedVersion 可选、竞争时序场景 6） | 「退出未知显示成 succeeded/cancelled」「取消后立即释放槽」「竞争双方都 200」反例成立 |
| T-7 | 设计 §5 重启边界（先确认旧 worker 已停、`interrupted`/`needs_review`、禁止自动重放）；契约 §6 epoch 变化先 `stream.reset` 再快照 | 「重启直接重跑未核实任务」「锁泄漏」「快照落后高水位」反例成立 |
| T-8 | 契约 §3.3/§4.1 幂等三态；legacy `validate_operation`/`replay` 已核 | 「重放建新任务」「同 ID 两行」「冲突返 500」反例成立 |
| T-9 | legacy `begin_revision`/`publish_revision`/`apply_preview` 已核存在 | 「指令直接覆盖候选」「apply 不带版本」「预览即入库」反例成立 |
| T-10 | legacy `edit_candidate`/`discard_candidate`/`sign_candidates` 已核；product/02 §4「签收后才成为事项」 | 「批量签收留半成品」「task 成功当签收」反例与权威「签收单独由用户确认」一致 |
| T-11 | product/04 今日/完成列表行；legacy `todo_source_links`（我核实 002 迁移建 `todo_sources`，legacy 侧为来源链路表） | 「签收后无来源链路」「候选直接进今日」反例成立 |
| T-12 | `shared/dates.mjs` `zonedCandidates`/`resolveExpression`；organizer-contract 的 date-evidence 规则（表达式须为原文子串） | 「时间只落 epoch ms」「歧义任取」「模型直接给绝对时间」反例成立 |
| T-13 | 契约 §2/§10（401 `unauthenticated`/403 `csrf_invalid`/`origin_rejected`/429 `pair_rate_limited`）；W1 A-9 同规则 | 「无会话写成功」「密钥进 argv/日志/SSE」反例成立，且 argv 结论我已用 `grep apiKey | grep -c argv` = 0 独立证实 |
| T-14 | MAYNE-21 交互方案（`design/web-task-flow/` + `web-task-interaction` 契约，基座 `f358c6a8…` 线） | 「用原型/合成 IPC 代签」「窄屏横向滚动」「刷新后位置丢失且无读回」反例成立 |

矩阵外声明「三角色/Skills/MCP/飞书/提醒/薄壳不在本任务范围；真实模型动线见 §8，不用受控服务结果冒充」与派发一致，没有越界代签。T-1..T-14 与 W1 的 A-* 编号并列不冲突，且报告明确「若 P1 改变接口形状，矩阵的应观测结果按冻结契约与产品来源校准，证伪反例不变」——这个不变量声明使矩阵对 P1 草案不构成隐性依赖，处理得当。

## 5. 授权判断逐条核对

**已覆盖（报告未扩大）**：owner 评论 `01a1b80b-f132-716c-bebb-28f260f0c73d`（Mayne，2026-11-07T22:05:52Z）原文为「批准 W1 A–D」，其范围由队长在 `01a1b72f…` 明确列为 A 新 `002_manual_items.sql`（DDL `b6cb8e6…f97e`）、B 新增 `server/` 与 `src-tauri/src/bin/` 及精确布局守卫、C `Cargo.toml` 登记 `web-backend-storage`、D 后端/前端静态构建与启动/测试脚本且零新增生产依赖。本地 Git 授权 `01a1b648-6d01-74e8-a06a-2d824003a5e5` 覆盖「完成后本地提交、合入本地 main、清理已合并分支」。**报告把这两项列为已覆盖，且没有把它们外推到 003 迁移、`BUSINESS_TABLES` 扩展、bundle 布局变更、`agent-concurrency` 设置模板或新 npm 脚本——正确。**

**真正需 owner 新批准（报告列明，我核对仓库规则支持）**：G-3 新 DDL 及 `BUSINESS_TABLES` 写守卫扩展（AGENTS.md §4 明确「改 schema/migrations」需单独授权，且写守卫是 `web_backend_store.rs` 的代码常量，扩展即生产代码变更）；G-4 随包后端布局纳入/引用 Pi Runtime 的构建变更（涉 `scripts/build/` 与 `tauri.conf.json` resources，属构建授权项）；G-6 `agent-concurrency` 设置 key 的 Rust 精确模板（同为写守卫变更）；G-9 新 npm 脚本（`package.json` 是共享文件）。四项都与仓库既有规则对应，**不是凭报告增设的审批闸门**。

**明确未授权**：push、远端 PR、部署、真实凭据/用户根、真实模型调用、新增生产依赖（`server/` 现为零 npm 依赖，`check-structure.mjs:288` 的 `layer.server-bare` 规则强制这一点，我实测该规则存在）。与既有授权状态一致。

**§8 真实模型验收单列的处理值得肯定**：报告把「所需 owner 输入」（凭据来源、端点/模型标识、调用范围）与「最小验收集」分开写，并明确「受控服务结果不得改称真实模型通过」「真实模型验收不阻塞本切片受控实现与门禁」。这既没有偷偷把真实模型塞进受控验收，也没有用未授权事项阻塞准入判断。

## 6. 发现项（均不阻塞）

**NIT-1 术语精度（P3）**：报告 §3.2 与 §5 T-11 用 `todo_source_links` 指 legacy 来源链路表，而 002 迁移实际建表名为 `todo_sources`（我实测 `CREATE TABLE todo_sources`；`local_store.rs` 侧另有链接语义）。事实指向明确（签收事项可回溯来源），仅表名写法可在 P1 定案时统一，避免实现者按错名字检索。

**NIT-2 口令措辞（P3）**：§6 把 `npm run test:s31-runtime` 描述为「受控模型服务 + 真实 organizer.mjs 子进程」驱动法。实测 `tests/integration/s31-runtime.test.mjs:50` spawn 的是 `build/s0-runtime/organizer.mjs`，受控 SSE 服务是测试内联 `createServer`（:52）而非 `s32-model-server.mjs`；`dev:s32-native-model` 才是独立可控服务。两者都被报告列为可复用项且用途描述分别正确，但「驱动法现成模式」若被理解为「s31-runtime 已用 s32-model-server」会略有偏差。建议 P1/实施时按「s31-runtime 提供 spawn+stdin/stdout 模式、s32-model-server 提供可控 SSE 服务」分别引用。

**NIT-3 观测口径补强（P3）**：T-4 的证伪依赖「受控服务记录到请求」。报告 §7 已要求每次请求落 `model.jsonl` 且「不记密钥值」，但未显式要求记录 `Authorization` 头的**存在性**（只说了「是否带认证头但不记值」在观测项里）。实际上 §7 秘密边界段已写到「可断言请求带认证头但不记录值」，两处合并看是闭合的；建议在 T-4 的「应观测结果」里也显式写出该断言，与 T-13 的反例「请求未带密钥引用/用了明文」形成对称。

**NIT-4 覆盖声明（P3）**：§11 写「W1 门禁 51 组绿证只覆盖 W1 已交付代码」。这个「51 组」数字来自队长评论 `01a1ba9e…` 的转述，我未在本轮重跑门禁（按派发边界不跑完整门禁），因此不对该数字本身背书；报告的用法（仅用来划边界、不用来为本切片背书）是正确的。建议在最终实施准入时由集成执行者以实际门禁输出为准。

**未发现**：虚报实现、把原型/受控服务外推为真实模型或生产证据、越出写入范围、把 W1 A–D 授权扩写、把未验说成已验证、虚构审批点。

## 7. 显式跳过与残余不确定性

- 未跑完整 `npm run check`、cargo 测试、探针套件、浏览器交互检查（按派发边界；本评审是报告单面聚焦评审）。
- 未启动任何服务、未发起任何模型调用、未读真实凭据/`.env.deepseek`/真实用户根。
- 作者 `build/web-text-intake-readiness/` 与三个附件未随评论交付到本机，我按派发要求全部关键事实本地重建；不引用不可达日志。附件哈希（`659616d3…`、`a39fadfc…`）我复算了补丁哈希，tar 包内容无法本地核验，如实列为未核验。
- 「51 组门禁通过」的数字未独立重跑（见 NIT-4）。
- Linux/代理、真实模型：报告已标未验，我亦未验。
- MAYNE-24 的最终技术裁定与授权覆盖由队长在 P1 契约提案与本报告及独立评审齐备后统一收口；本评审不代签实施准入。

## 8. 本次评审实际执行

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git diff --stat d94de69 43433ae` | 0 | 1 file changed, 186 insertions(+) |
| `git show 43433ae:<report> \| shasum -a 256` | 0 | 与登记值 `2d647417…` 一致 |
| `git format-patch -1 --stdout 43433ae \| shasum -a 256` | 0 | 与登记补丁值 `659616d3…` 一致 |
| `git rev-parse 1e37044^{tree}` | 0 | `77a5485…`，与登记基座一致 |
| `git show 1e37044:server/lib/http-server.mjs`（matchRoute :66–89） | 0 | 路由全表复现，无事例/任务路由 |
| `git grep task_attempts\|side_effect_receipts… <base> -- server` | 1（无命中） | 调度器/队列表在服务层 0 引用 |
| `git grep RUNTIME_BUSY <base> -- src-tauri/src` | 0 | `mcp_host.rs:327` 单槽实现 |
| `git show <base>:src-tauri/src/store/web_backend_store.rs` | 0 | `BUSINESS_TABLES` 两表 + 两条 settings 模板 |
| `git show <base>:scripts/build/build-backend.mjs` | 0 | `s0-runtime\|organizer` 检索 0，产物布局如报告所述 |
| `git show <base>:scripts/checks/check-structure.mjs` | 0 | :16/:161/:35/:229/:288 规则逐行命中 |
| `git show <base>:src-tauri/src/host/runtime_host.rs` | 0 | spawn/env_clear/stdin payload/owned/reap 全链；apiKey 进 argv 行数 0 |
| `git show <base>:runtime/entries/organizer-entry.mjs`、`organizer-contract.mjs` | 0 | kinds 白名单、错误映射、候选/evidence/日期/标签规则逐条命中 |
| `git show <base>:src-tauri/src/store/model_config.rs` | 0 | credential_status 词表、明文拒收、symlink/nlink 守卫 |
| `git show <base>:src/stores/{todos,organizer,models}.ts` | 0 | todos 已 HTTP；organizer/models 仍 IPC；seam 存在 |
| `git show <base>:src-tauri/src/store/ingestion.rs` | 0 | 12 个被引函数各存在一次 |
| 23 个基座文件 `git show <base>:<f> \| shasum -a 256` | 0 | 与报告 §10 声明前缀逐一相符 |
| 11 条可复用命令存在性 / 6 类拟新增缺失性 | 0 | 如报告所述 |
| `node --check design/web-task-flow/task-flow.js` | 0 | 语法通过（本树既有交付物，未改动） |
| `node scripts/checks/check-docs.mjs` | 0 | 18 文件、302 链接 |
| `git diff --check` | 0 | 无空白/冲突标记 |
| owner 授权原文核对（`01a1b80b`、`01a1b648`） | 0 | 范围与报告「已覆盖」行一致，未外推 |

写入范围：仅 `docs/reviews/web-text-intake-readiness-20261108-ohmypi-review.md` 与 `build/web-text-intake-readiness-review/`（`report-under-review.md`、`evidence-log.txt`）。未改实现、未跑完整重门禁、未动 main、未改本项/父任务状态（MAYNE-24 保持 backlog）、未读真实凭据/用户根、未发起模型调用。

## 9. 来源更正与附件补核（第二轮，仅材料核验）

**来源更正**：本篇 §1、§7 及首轮回帖中「作者 `build/` 证据未随评论交付」的表述**不准确，此处分条更正**。经队长读回作者原评论确认：补丁与证据包两个附件**实际均已挂载**在 Kimi 的 P2 评论 `01a1baa7-4b0c-76de-aecd-bc3ee242b0b2` 上（附件 ID `01a1baa7-4860-70f9-8c7f-c8508dcfa284`、`01a1baa7-49ee-7932-a114-d9c30233bbd1`）。首轮的准确情况是「本次未下载核验」，不是「未随评论交付」。首轮全部源码事实均按派发要求从精确基点独立重建，未引用不可达日志，该结论不受影响；本条只更正交付事实的措辞。

**补核范围**（按队长 `01a1baaf-e684-7ee9-b60f-bccc509d6f1b` 指派）：只做材料核验——经 CLI 下载两个附件，复算身份/哈希、安全路径，以及 admission/原始观察与精确基点的对应；不重做已通过的源码审阅，不运行测试。完整观察值见 `build/web-text-intake-readiness-review/attachment-verification-log.txt`。

### 9.1 附件身份与哈希（复算一致）

| 附件 | 声明 sha256 | 我复算 | 结果 |
|---|---|---|---|
| `web-text-intake-readiness-43433ae.patch`（35717 B） | `659616d3…` | `659616d3e4b9a92d814cda3d0c68d1e82dcb4bc794fb1cd176c636f68b358931` | ✓ 一致 |
| `web-text-intake-readiness-evidence-43433ae.tar.gz`（36146 B） | `a39fadfc…` | `a39fadfc2a20e529d5a736d1a5919ced4b74ac7800791d18d942d6a27252ad32` | ✓ 一致 |

补丁同时与共享对象库中候选自身的 format-patch 逐字节相同（`git format-patch -1 --stdout 43433ae | shasum -a 256` = 同一值）。

### 9.2 安全路径审计（通过）

- 补丁：只有一个 diff 头，目标 `docs/reviews/web-text-intake-readiness-20261108.md`（new file mode 100644，`--- /dev/null`，+186/−0）。无绝对路径、无 `../` 穿越、无声明写入范围之外的路径。
- 证据包：`tar -tzf | grep -c "^/\|\.\./"` = 0；成员全部位于 `web-text-intake-readiness/` 下（`self-check.txt`、`gap-evidence.txt`、`base-file-list.txt`、`base-tree.txt`、`base-file-hashes.txt`、`head.txt`、`admission.json`），只解到证据目录内。

### 9.3 admission 与精确基点的对应（通过）

`admission.json` 登记 `received_base=1e37044…`、`received_base_tree=77a5485…`、`base_is_ancestor_of_head=false`、`head_before_work=d94de69…`、取证方法为对精确基点 `git show`/`git grep`/`git ls-tree` 且未 checkout/reset/stash、写入范围两份。我独立复核：

| 项 | admission/证据值 | 我复算 | 结果 |
|---|---|---|---|
| 基点 tree | `77a548591ac9b02a51936c806bf4f85d774df7cb` | `git rev-parse 1e37044^{tree}` 同值 | ✓ |
| 基点非 HEAD 祖先 | `false` | `git merge-base --is-ancestor 1e37044 d94de69` → false | ✓ |
| `base-tree.txt` | `77a5485…` | 同上 | ✓ |
| `head.txt` | `d94de69be5d3b837395f3aa8a823bde7d34fd167` | 存在于共享对象库，且为 `43433ae` 之父 | ✓ |
| `base-file-list.txt`（4547 条） | — | 与 `git ls-tree -r --name-only 1e37044 \| sort` 逐字节相同 | ✓ |

### 9.4 基座文件哈希：38/38 复算一致

对 `base-file-hashes.txt` 的每一行用 `git show 1e37044:<path> | shasum -a 256` 取前 16 位比对：**38 条全部一致，0 处不符**。覆盖 001/002 迁移、server 六件、Rust 存储/schema/ingestion/model_config/runtime_host/bin、前端 organizer/todos/models/domain/三组件、runtime organizer 两件、构建两件、契约与设计文档、`package.json`、守卫、W1 与 s31 测试与受控模型服务夹具等。

### 9.5 原始观察（gap-evidence）抽复算

- 路由缺失项（tasks/providers/batches/candidates/agent-concurrency/snapshot/recovery）我独立重算均为 0，与证据一致。
- 调度器关键词在 `server/`＋两个 `web_backend_*` Rust 文件中 0 命中；task 系表在 schema+测试之外仅 `web_backend_schema_tests.rs` 命中——与证据一致。
- SSE 三事件名与证据一致（证据按「带引号的字面量」计数；裸 `grep -c stream.reset` 为 3，因该词另出现于 :6/:52 的注释与握手说明，实际发送帧是 :56 的单字面量——计数口径差异，无实质出入）。
- `build-backend.mjs` 布局注释与 `s0-runtime|organizer` 检索 0、`tauri.conf.json` resources 映射、`test:web-manual-items` 脚本原文，均与证据一致。
- `self-check.txt` 记录 `check:docs` exit 0（18 文件/300 链接）、`git diff --check` exit 0、`git status` 仅新增评审文档加平台目录与平台注入的 AGENTS.md 块——与声明写入范围一致。

### 9.6 补丁可应用于精确基点并复现候选内容（通过）

以临时索引载入 `1e37044` 后 `git apply --cached` 该补丁（exit 0），写出树 `58d8496c…`；其中报告 blob 为 `3aa3904fa453f5f78328d6e817c38106459b5c1f`，与 `git rev-parse 43433ae:docs/reviews/web-text-intake-readiness-20261108.md` **完全相同**。即：把下载到的补丁应用到精确基点，逐字节复现被审报告。（用朴素文本抽取补丁内容会多出 git footer `-- \n2.56.0`，那不是文件内容，故以 blob 比对为准。）

### 9.7 补核结论

两个附件真实挂载且可下载；补丁与证据包哈希与声明一致；补丁仅含声明范围内的一个新文件、无绝对/穿越路径；admission 与精确基点 `1e37044`/tree `77a5485…` 完全对应；38/38 基座文件哈希复算一致；`base-file-list` 与基点树清单逐字节相同；gap-evidence 的关键零命中与布局结论可复现；补丁应用到基点后复现被审报告的同一 blob。**未发现任何改变首轮「通过」结论的差异**；唯一需要更正的是首轮关于附件交付事实的措辞（已在本节首段更正）。
