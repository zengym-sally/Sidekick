# 增量① `58a4cdc`／增量② `95907cd` 独立限定独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf3e`（Codex）。对象：`29305daeff13207e9c75e46b0bb246b041bcdb62`（tree `f91ddf56…5598`，父链 `4fc9537`→①→②→记录逐级复核一致），相对 `4fc9537` 生产四文件 +212/−74（manual-items-service 5/1、task-scheduler 9/2、task-service 31/26、text-intake-service 167/45）＋记录 50/0；Rust／DDL／003／守卫／package／前端／Runtime 零差异（自验）。两增量分别给结论；未跑完整 gate／未改 Rust 全套。

## 增量①（宿主 error 帧码进入 extract/revise 无暂存收口）：通过（限传递与分类优先序面）

- **传递面**：scheduler 把 `failurePayload`（`outcome==='succeeded' ? null : effective.payload`）传入 `confirmExtractExit`/`confirmReviseExit`；**成功载荷永不转发**，`treeVerified=false` 路径不传——原暂存优先结构未动。
- **优先序**：`deadlineTriggered ? model_timeout 信封 : failurePayload ?? worker_lost`——后端 deadline > 收到的帧码 > 零帧死亡。service 级独立复放 **7/7**（真存储二进制 `42af54b5…490fc2` 逐字节同登记）：`MODEL_TIMEOUT`→`model_request_failed/auto_backoff`、`MCP_HTTP_STATUS`→`tool_execution_failed/manual`、零帧（null）→`worker_lost/manual`、**deadline 胜过帧码**、**暂存胜过 failurePayload**（succeeded＋候选发布，payload 忽略）。
- **安全面**：worker-host 对 error 帧只取 `{code,message}`（`state.finish('failed', {code: frame.code ?? 'runtime_exit', message: …})` 实读）——模型自报安全字段**在宿主边界即被剥离**，信封恒 `unknown`；无 `internalCode`；Runtime 协议零改动。
- **明确不代签**：`FAILURE_CODE_ALIASES` 仍无 `MODEL_AUTH/RATE_LIMIT/NETWORK/SERVICE`——本审实测 `MODEL_AUTH` 帧码落 `worker_lost`（与协调登记一致）；逐码闭合归 Kimi 已派最小提交，本审只签传递与优先序面。

## 增量②（C4 日期点＋首次规范输入入 `tasks.input_ref`）：通过（限 C4 sourceAt 面与既有 normalizePoint 复用面）

- **companionOps**：`TaskService.submit` 新可选参数，**函数类型**（`typeof companionOps === 'function'` 才展开）——HTTP `/api/tasks` 与 `/api/text-sources` 均无法经 wire 注入（http-server 零改动、`submitSource` 闭包传入）；不形成额外写能力，SQL 仍是既有 BUSINESS_TABLES 白名单内 `text_sources` INSERT。
- **事务回滚**：来源行＋任务行＋`task_events`＋`succeeded_run_id` 链接同事务提交，替代旧的「先插源、失败后 best-effort DELETE」（旧路径可留孤儿）——实测时区冲突 400 **零落库**。
- **同 operationId 异输入 vs 指纹复用**：实测同文本新 operationId → 200 `reused:true` 且绑回原锚点完整点；同 operationId 异文本 → 409 `idempotency_conflict`——两路分明，指纹优先顺序与基点一致（非本批新行为）。
- **公共点 DTO／私有 ms 分明**：HTTP 读写 `sourceAt` 为 `{at,timeZone,localText,precision}`；ms 桥接（`source_at_ms`/`anchor_at_ms` 列、runtime `input.anchorAtMs`）保持私有；复用 `manual-items-service` 的**既有** `normalizePoint`（仅加 `export`，校验语义未动）。
- **首锚实际传入**：extract 输入携 `anchorAtMs=首锚`，revise 携候选来源首锚（`getSourceRow[6]`）；worker-host（零改动）读 `input.anchorAtMs ?? now()` 与 `input.source?.timeZone`——排队/重启不再静默漂移到启动时刻；revise 时区此前传顶层 `timeZone`（宿主从不读、静默落 UTC）改走 `source:{timeZone}`，顺带修正。**真实 Pi 两锚反控仍属作者探针，本审以「锚在 input_ref＋宿主读取点」静态闭合，不代签真实解析面。**
- **nullability／回落**：`sourceWire` 以首个任务的 `input_ref.source.sourceAt` 为唯一完整载体；无点（旧记录/缺链接）回落列值，`localText:null`、`precision:'minute'`，不默造；listSources 批量读 `input_ref`（`row[8]=succeeded_run_id` 列序实核）。冲突点（显式锚时区≠顶层时区）400 且零落库；省略点默认首次录入时刻。
- **独立复放（真实 entry＋Rust 存储＋真实 HTTP，16/16 两轮同配置）**：显式点提交 200＋响应/详情/列表三路完整点；DB 实证来源列 ms＋链接＋首任务 `input_ref` 双载（ms 与点并存）；时区冲突 400 零落库；指纹复用/operationId 冲突区分；**同根重启后读回不漂移**；旧记录回落 `localText:null` 不默造。I 单测：service 13/13、lifecycle 10/10、events 11/11、MCP 11/11、recovery（`82e1bf2` overlay 原样覆盖）11/11——与作者登记逐套吻合。

## 登记（非阻断）

1. **`normalizeFailure` 会透传 `payload.sideEffectSafety`**（本审 service 级实测：直接调用可把 `proven_safe` 带入信封）——宿主白名单 `{code,message}` 使真实帧不可达，且该行为先于本批存在（D1 起 generic task 失败即走同一 normalize）；但①新增把宿主载荷路由进该函数，建议随 Kimi 别名增量一并加服务级剥除（一行防御），属加固非缺陷。
2. ①②均不改 II 断言；作者登记的 II 套件既有夹具阻塞（缺 `name` 的非法 providers.json）为已登记既存条件，未计入任何判定，本审亦未运行 II 套件。
3. ②的候选/预览内部日期点线上转换仍未闭（协调既登记项），不由本批 sourceAt 面代签。

## 边界

只写本审阅文档与本机证据（两探针＋日志＋SHA256SUMS 随评论交付）；真实 Pi 两锚日期解析与 error 帧真机链属作者证据，本审未代签；未跑完整 gate／未改 Rust 全套；未触其他工作树／真实凭据；MAYNE-24 保持 `in_progress`。
