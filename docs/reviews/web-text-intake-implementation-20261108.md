# W1 文本整理与签收：I 纵向生产实现交付（MAYNE-24，2026-11-08）

> 本文件是 MAYNE-24 Item I（Claude，完整纵向生产实现）的交付记录。它只登记本人在本任务分支实际写入的内容、实际执行过的验证，以及尚未由本切片闭合、需要 II/III 或队长裁定的缺口。它不是验收通过声明，不代替独审与最终门禁。

## 1. 身份与写入范围

| 项 | 值 |
|---|---|
| 任务分支 | `agent/claude/mayne-24` |
| 起始基点 | `e7bd56e35f59c4c5f2ea0c64668fc30ab89a234f`（tree `77a548591ac9b02a51936c806bf4f85d774df7cb`） |
| 实际源码基点 | 本地 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5`（tree `77a548591ac9b02a51936c806bf4f85d774df7cb`，与分支 HEAD tree 一致） |
| 交付 HEAD | `a0afea4`（本分支 4 个提交：数据层、服务核心、前端传输，以及数据层初版） |
| 接收的已审输入 | P1 契约/授权 `b190f7c6642625c800396fc04d50009769348c83`（契约 SHA-256 `5982c062…7b0`、授权 `caa746bb…6b20`）；P2 差距/验收矩阵 `43433ae5b1093afa4024ba1bde4f6d12abae5c95`（`2d647417…17bc`）；ZCode R3 记录 `47d5efaa24357072d74326cb28ead0fb2eb14818` |
| 冻结面 | 001 `8511907c…143d`、002 `b6cb8e61…f97e`、web-api/1 `61863271…f58d` 未改；批准 003 `8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870` 逐字节落盘并复算一致 |
| 准入登记 | `build/web-text-intake-implementation/admission.json`（首次修改前写入） |
| 预定独审 | ZCode（未参与 I） |

写入清单（与 admission 一致）：`server/lib/{text-intake-service,task-service,task-scheduler,worker-host,task-recovery,config-store,credential-provider,model-snapshot}.mjs`；`server/lib/{http-server,sse-hub,manual-items-service}.mjs`；`server/entries/web-backend-entry.mjs`；`src-tauri/migrations/web-backend/003_text_intake.sql`；`src-tauri/src/store/web_backend_{schema,schema_tests,store,store_tests}.rs`；`src/lib/web-api-client.ts`；`src/stores/{organizer,models,agents,pairing}.ts`；`src/components/{Workbench,SettingsPanel}.vue`；`tests/unit/web-text-intake.test.mjs`；`docs/reviews/web-text-intake-implementation-20261108.md`；`build/web-text-intake-implementation/`。

未写：`scripts/checks/check-structure.mjs`（III 的 003 哈希登记面）、`package.json`、Cargo.toml/锁、`runtime/`、`vendor/`、`tests/integration/web-manual-items-*`（II/前序套件）、`tests/integration/desktop-controls*`（本切片无需适配即通过）。

## 2. 已实现内容

### 2.1 数据层（已审 003 精确落盘）

- `003_text_intake.sql`：183 行，SHA-256 `8e4e3159…7870`，与授权 §5.1 提取逐字节一致（本机 `shasum` 复算）。
- `web_backend_schema.rs`：`SCHEMA_VERSION` 2→3；`migrations()` 追加 003；故障注入改为在第三迁移后失败并回滚到 v2。
- `web_backend_store.rs`：`BUSINESS_TABLES` 2→15（002 双表 + 003 五新表 + 001 任务系八表）；设置模板在 `application.timeZone` 两条之外新增 `agentConcurrency` INSERT＋CAS 两条；拒绝文案改为「已登记的业务表或 settings」。`settings`/`schema_meta`/`sqlite_sequence` 仍不在业务白名单。

### 2.2 服务层

- `config-store.mjs`：`<root>/config/` 原子读写（临时文件＋rename，0600，symlink/nlink 守卫）；providers/models/agents 文档校验；修订号为规范化内容 SHA-256 前缀；provider 能力视图只回引用与状态；**拒绝明文密钥**（`plain_credential`）。
- `credential-provider.mjs`：`resolve(ref)`/`status(ref)`；controlled 与 env 形状两种实现；**未实现生产 OS provider**（单独授权项）。
- `model-snapshot.mjs`：任务提交时固化 `{revision, modelId, provider, model, profile, agent, skills}`；未配置模型时返回 null 而不是阻塞提交（任务入队、运行时失败）。
- `task-service.mjs`：提交（operationId 幂等＋规范输入）、列表（submitSeq 分页）、查询、取消（queued→cancelled / running→cancelling）、重试（仅 manual）、resolve（条目版本守卫、回执确认）、结果读取（内联/分段/失败信封）、并发读写（缺省 3/version 0 不写库）；调度原语 `claimNext`/`stageResult`/`confirmExit`，槽位跟随 `attempt_exit_state`。
- `text-intake-service.mjs`：来源提交与指纹去重复用、候选编辑/丢弃（版本守卫）、修改预览申请/应用、**N≥2 批量签收单事务**（`sign_off:`＋SHA-256(紧凑 JSON 数组) 派生行键、`sign_off_batches` 台账、`manual_item_sources` 关联、关联既有事项只加来源不改字段、整批回滚、重放读当前权威对象）；结果暂存（`staged` 候选）与退出确认后发布/删除。
- `worker-host.mjs`：以子进程方式启动 `<runtimeRoot>/node <runtimeRoot>/organizer.mjs --run <runId>`；`env_clear` 形状（仅 PATH/TMPDIR）；`apiKey` 只写子进程 stdin；cancel 帧带 runId/hostNonce；worker 记录 `runs/<runId>/worker.json`（0600）；启动前校验 runtime 布局。
- `task-scheduler.mjs`：单写者循环；领取→spawn→结果暂存→退出确认→提交原暂存结局；取消×暂存按 §6.1.1 暂存结局优先。
- `task-recovery.mjs`：注册新 epoch；扫描未结束 attempt；按 worker 记录 pid 探测进程树；死亡则分类（cancel→cancelled；running→needs_review；needs_review→exited_confirmed）；存活则暂停调度并如实上报。

### 2.3 HTTP 与前端

- `http-server.mjs`：新增 text-sources/candidates/sign-offs/tasks/concurrency/snapshot/models/agents/providers 路由；错误码表扩展；修复手动事项路由守卫对其它路径的提前 `return null`。
- `sse-hub.mjs`：`task.changed`（带 `<epoch>:<cursor>` id）与 `candidate.changed`（进程内提示，无 id）。
- `web-api-client.ts`：上述端点方法；`asBackend()` 扩展 organizer/models/agents 命令面（task→ModelRun、source→ImportBatch、candidate/preview 映射、operationId 生成、TodoInput↔wire input 转换）。
- `stores/{organizer,models,agents}.ts`：`invoke` → `getWebApiClient().asBackend()`；`apply_preview` 补 `candidateId`。
- `stores/pairing.ts`：订阅 `task.changed`/`candidate.changed`。
- `components/{Workbench,SettingsPanel}.vue`：浏览器模式下启用待确认入口与文本智能整理；advisor/今日建议/技能与 MCP 仍按 nativeAvailable 准确不可用。

## 3. 实际验证（命令与结果）

| 命令 | 结果 |
|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 23 passed / 0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 15 passed / 0 failed |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Finished，无警告 |
| `node --test tests/unit/web-text-intake.test.mjs` | 7 passed / 0 failed |
| `npm run typecheck`（vue-tsc --noEmit） | exit 0，无错误 |
| `npm run build:backend` | 成功装配 `build/web-backend/`（server+shared+storage 2649888B+dist→static） |
| `node build/web-text-intake-implementation/smoke.mjs` | pair/submit/dedup/listSources/listTasks/concurrency CAS/models/providers/snapshot/agent 全 200；未配对读 401 |
| `shasum -a 256 src-tauri/migrations/web-backend/003_text_intake.sql` | `8e4e3159…7870`（与批准值一致） |

原始日志：`build/web-text-intake-implementation/verification.log`。

新增单测覆盖：指纹去重（含 `reused:true` 同任务）、空原文/非法时区拒绝、候选版本守卫与丢弃终态、批量签收原子性＋派生键形如 `sign_off:<64hex>`＋重放不重复入库、单条批量拒绝、并发缺省不写库＋CAS、无模型不阻塞提交。

## 4. 既有回归与接口同步项

- `npm run test:web-manual-items`：**58/59 通过**；唯一失败为 `tests/integration/web-manual-items-http.test.mjs:81` 的 `A-9/schema` 断言 `schemaVersion === 2`，实际为 3。这是授权 003 的必然结果，**该文件不在 I 的写入范围**，需由集成者/队长裁定后同步为 3（或改为断言 ≥3 且含 003 表）。I 未修改该断言。
- `npm run check:structure`：本树存在 172 条 `top.dir`/`top.file` 违规，全部来自运行时自带的未跟踪文件 `.claude/`、`.multica/`、`CLAUDE.md`（`git ls-files --others --exclude-standard` 会纳入）。过滤这三类后，**I 新增/修改的文件零违规**；001/002 冻结字节通过，003 尚未登记（III 范围）。

## 5. 未验项与需要裁定的缺口（如实列出）

1. **运行时打包**：`build/web-backend/runtime/` 由 III 装配；I 的 `worker-host` 已实现并做布局校验，但本树尚未用打包后的 runtime 跑通一次真实 `extract/revise/test`。源码位 `build/s0-runtime` 已就绪，可用 `runtimeRoot` 显式指向。
2. **II 验收矩阵未到位**：`tests/integration/web-text-intake-*` 与 `tests/fixtures/web-text-intake/` 由 Kimi 交付；本切片的调度器/worker-host/recovery 尚未被 T-1…T-14 逐项证伪。
3. **SSE cursor 与 snapshot 高水位**：`sse-hub` 的 cursor 为实例内单调计数，`/api/snapshot` 的 `highWatermark` 现为 0 占位；尚未与 `task_events.cursor` 对齐。任务事件写入使用占位 epoch `inst_legacy`，attempt 使用 `sse.epoch`——两处需在集成时统一到同一实例 epoch。
4. **配置校验简化**：`config-store` 的 provider/model/agent 校验是必要子集，未完整移植 legacy 的推理强度/定价等规则；`/api/models` 的保存形状需与 II/前端最终核对。
5. **staged 不可见**：由服务层 `listCandidates` 状态过滤保证，非 DDL 表达——与契约 §6.1.1 的声明一致，需在 II 用例中证伪。
6. **完整 `npm run check` 未执行**：按派发，唯一集成执行者是 III；本切片只做聚焦验证。
7. **浏览器真实同源旅程未执行**：Playwright 矩阵（1440×1000／640×900）待最终版本另派；本切片只验证了 HTTP 层与 typecheck。
8. **真实模型/真实凭据/生产 OS provider/Linux/代理**：未授权、未执行；controlled provider 与 env 形状之外没有实现 OS provider。

## 6. 边界

本文件不声明任何业务验收通过；独审与最终门禁由未参与 I 的评审者与唯一集成执行者负责。所有失败历史与未验项原样保留，不改写为已通过。

---

## 7. 修订轮（2026-11-08，HEAD `2022d1c`）：ZCode 11 项关闭矩阵

| # | 项 | 处置 | 证据 |
|---|---|---|---|
| B-1 | extract 暂存必然失败／任务卡 running | 已修：`stageExtractResult` 以 canonical 数组序（index+1）取序号；调度器不再吞异常，失败经 `markNeedsReview` 类型化落库并释放槽 | 真实 Pi E2E：extract→5 候选 staged→确认发布 pending |
| M-1 | 运行中取消帧不发 | 已修：`cancelRunning` 按活动句柄定位，不再以 state='running' 为守卫 | E2E：cancel→`cancelled`（200） |
| M-2 | 明文密钥可落盘 | 已修：provider/model normalize 白名单字段并拒绝任何密钥形字段；`credentialStatusFor` 只走注入的 `provider.status(ref)`，删除 `process.env` 读取 | `PUT /api/models` 携带 `apiKey` → `plain_credential` 422 |
| M-3 | 批量签收不校验 changes | 已修：逐候选条件 UPDATE 的 `changes` 必须为 1，否则整批回滚 409 | E2E：混合批次 200，3 项（2 signed_ai + 1 manual 关联，version 2） |
| M-4 | 幂等重放未实现 | 部分：`requestRevision` 去掉 canonical 输入里的 `anchorAtMs`（重放不再冲突）；`signOff` 重放读当前权威对象。edit/discard/applyPreview 仍缺持久台账——003 无可用列/表，**请求裁定**（见下） | 单测+任务幂等路径 |
| M-5 | 恢复面与闭表不符 | 已修：恢复分类补 `task_events`；cancelling×staged 走 `confirmExtractExit` 发布/删除。`side_effect_receipts`/`task_result_payloads` 仍零写入——**请求裁定** | E2E：SIGKILL 重启→needs_review＋recovery_items＋epoch_changed |
| M-6 | test 任务结构性失败 | 已修：`/api/tasks` 对 test 构建服务端 snapshot；无模型时以 `auth_or_config_invalid` 失败而不 spawn | E2E：connection test 202→succeeded |
| M-7 | 浏览器批量签收带日期即崩 | 已修：删除 `asBackend` 重复 `toWireInput`；`normalizeDraftFields` 同时接受 `atMs`/`at` 两形 | E2E：带日期候选批次 200 |
| m-1 | result 内嵌 payload 非 payloadRef | 未修（分段读取已实现，`result` 形状仍内联） | — |
| m-2 | preview 错误码/版本核对 | 已修：缺预览→`candidate_not_found`；基准版本不符→`state_conflict` | — |
| m-3 | status 无白名单 | 已修：`listCandidates` 校验四种状态 | — |
| m-4 | resolve/confirmExit 并发守卫 | 未修（单写者假设） | — |
| m-5 | submit_seq 事务外计算 | 已修：INSERT 内子查询派生 | — |
| m-6 | stageResult epoch 未校验 | 未修 | — |
| m-7 | 来源回溯 UI 缺位 | 部分：`fromWireItem.source` 不再恒 manual；`todo_source_links` 仍返回 `[]`，`TaskQueue.vue` 未交付 | — |
| m-8 | 错误码归类/杂项 | 部分：`credentialStatusFor` 已改；其余未修 | — |
| K-1 | `inst_legacy` 占位 epoch | 已修：task_events 统一实例 epoch | E2E：SSE 帧 cursor 与 snapshot 高水位一致 |
| K-2 | snapshot 高水位 0 | 已修：`readHighWatermark()` | E2E：restart 后 `lastEventId=<epoch>:<max cursor>` |
| K-3 | SSE cursor/重放 | 已修：有界重放缓冲＋`stream.reset`（epoch_changed/cursor_out_of_window/malformed） | E2E：旧 epoch 重连→`stream.reset` reason=`epoch_changed` |
| K-4 | EnvironmentCredentialProvider | 已修：删除该类与 environment 工厂分支 | 源码审读 |
| K-5 | 真实 Pi 聚焦证据 | 已修：本树显式 binary/dist/runtimeRoot 全旅程 | `build/web-text-intake-implementation/e2e-results.json` |
| K-6 | II 矩阵/完整门禁 | 按派发保留（II/III） | — |
| 窄授权 | `web-manual-items-http.test.mjs:81` 2→3 | 已修，其余断言保留 | `npm run test:web-manual-items` 59/59 |

### 请求裁定（冻结存储无法表达，不自行扩权）

1. **M-4 候选操作台账**：`editCandidate`/`discardCandidate`/`applyPreview` 的「同 operationId 重放先于守卫」需要持久 operationId→对象 映射，但 003 的 `candidates` 无 operation 列、`sign_off_batches` 语义专属签收、`task_events.object_type` 的 CHECK 仅允许 `task/setting/workspace/recovery_hold`。最小差异二选一：(a) 在 `candidates` 增 `last_operation_id` 列；(b) 授权复用 `sign_off_batches` 作为通用操作台账。请裁定。
2. **M-5 副作用回执/结果 payload 落点**：`side_effect_receipts` 需 attempt 级回执行，`task_result_payloads` 需 `result://` 分段字节。本切片由真实 Pi 的输出契约保证只读（无工具时），但未写入这两表。请裁定是否在本切片内显式声明不用，或给出最小写入时机。

### 本轮聚焦验证

`cargo fmt --check` exit 0；`web_backend_schema` 23/23；`web_backend_store` 15/15；clippy `-D warnings` 干净；单测 7/7；`test:web-manual-items` 59/59；`npm run typecheck` 干净；003 哈希 `8e4e3159…7870`；真实 Pi E2E 全绿（extract 5 候选／edit／revise+preview+apply／connection test／混合批次 200 三项／cancel cancelled／SIGKILL 重启保留 3 来源 3 事项 3 待确认候选／SSE epoch_changed reset／无 Tauri UI 200）。

原始证据：`build/web-text-intake-implementation/{verification.log,e2e-results.json,e2e-progress.log,controlled-model-requests.jsonl}`。结构检查仍保留运行时未跟踪文件（`.claude/`、`.multica/`、`CLAUDE.md`）的原始失败，不以过滤结果代原样。

---

## 8. 第二轮修订（2026-11-09）：结果字节、退出核实与真实 UI 旅程

### 8.1 已关闭

| 项 | 处置 | 证据 |
|---|---|---|
| `task_result_payloads` 真实字节 | 已修：`stageResult`/`stageExtractResult`/`stageReviseResult` 在暂存事务内把真实字节写入 `task_result_payloads`（新增 `{"$blob":"<base64>"}` 参数形，Rust 侧内联 base64 解码，未加依赖），`result_ref` 改为冻结 `result://<attemptId>/result`；`readResult` 解析引用并读回字节，内联/分段/失败信封按冻结 §4.3 | 单测：staged→确认→`readResult` 取回原始 JSON，`total_bytes>0` |
| `markNeedsReview` 退出核实 | 已修：新增 `{exited}` 形参；未核实→`exited_unknown`（**保持占槽**），已核实→`exited_confirmed`（释放）。调度器仅在 `handle.done` 解析（观察到进程退出）时传 `exited:true` | 单测：未核实保持 `exited_unknown`，核实后 `exited_confirmed` |
| m-6 epoch fencing | 已修：`stageResult` 校验 attempt 的 epoch 与传入 epoch 一致，否则拒绝落库 | 单测：陈旧 epoch 返回 false |
| m-4 并发守卫 | 已修：`resolve` 两条 UPDATE 条件于 `state='needs_review'` 并校验 `changes`；`confirmExit` 全部转移条件于 `state IN ('running','cancelling')` | 单测+W1 回归 |
| 结果/错误契约 | 已修：`result_range_invalid` 用于 offset/limit 非法与失败结局携带分段参数（冻结 §4.3） | — |
| 真实无 Tauri UI 动作旅程 | 已修：headless Chrome（CDP）驱动**产品自身 DOM**：配对码入闸→工作台挂载→打开文本整理→提交→候选出现在待确认区；43 个同源请求、0 跨源；截图为证 | `build/web-text-intake-implementation/ui-journey-results.json`、`ui-journey.png` |
| 结构检查 | 保留原始失败与元数据分类，不以过滤结果代原样 | — |

### 8.2 `side_effect_receipts` 可观测性（不声明不用，给反例与最小接线清单）

**结论：当前 runtime 协议无法观测外部副作用回执，本切片无法在不改 `runtime/`（禁改）的前提下写入真实回执。**

反例（可复现）：让 organizer 以 `capabilities.toolCall=true` 且挂载 skills/MCP 运行，Pi 的 `bash`/MCP 工具会对外产生副作用；后端从子进程只观察到 `{type:'progress',phase:'tool'}`、`{type:'worker',…}`、最终 `{type:'result'|'error'}` 帧，**没有任何帧携带 `kind`/`externalRef`/`provableReadonly`**（`runtime/entries/organizer-entry.mjs:129,139,140`）。因此 `side_effect_receipts` 的 `external_ref` 与 `provable_readonly` 无真实来源，写任何值都将是编造。

最小接线清单（需 runtime 侧变更，属后续切片授权）：
1. runtime 在每次工具调用派发前/后 emit `{type:'receipt', attemptId, kind, externalRef, provableReadonly}`，其中 `externalRef` 为外部系统可核验标识（如消息 ID），`provableReadonly` 仅由工具契约显式声明，**不得由模型输出格式推断**；
2. 后端 `worker-host` 收集该帧并在暂存事务内写入 `side_effect_receipts(attempt_id,kind,external_ref,recorded_at,provable_readonly)`；
3. 失败结局的 `sideEffectSafety` 由回执推导：存在 `provable_readonly=0` 的已生效调用即 `unknown`，否则 `proven_safe`。

在接线完成前，本切片对**未 spawn worker 的失败**（无模型/缺凭据/配置类）标 `proven_safe`（无副作用可发生，已由代码路径证明），对**已 spawn worker 的失败**一律标 `unknown`（保守，不冒充安全）。

### 8.3 本轮聚焦验证

fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` 15/15；clippy `-D warnings` 干净；单测 **9/9**（新增结果字节与退出核实两项）；`test:web-manual-items` **59/59**；typecheck 干净；003 哈希 `8e4e3159…7870`；真实 UI 旅程全步骤通过（0 跨源）。

原始证据：`build/web-text-intake-implementation/{verification.log,ui-journey-results.json,ui-journey.png,controlled-model-requests.jsonl}`。

---

## 9. 第三轮修订（2026-11-09）：提交前条件断言、进程树核实、完整 DOM 签收

### 9.1 已关闭

| 项 | 处置 | 证据 |
|---|---|---|
| `$blob` 参数协议 | 已撤回：删除手写 base64 解码器与 `$blob` 分支；三条 stage 路径改用既有字符串参数＋`CAST(? AS BLOB)` 保存同一真实字节 | Rust `json_value` 复原；单测覆盖中文真实字节 |
| `transact` 提交前断言 | 新增内部接口 `expectChanges`（可选、非负整数；null/负数/小数/字符串→`WEB_BACKEND_INVALID_PARAMS`；不符→`WEB_BACKEND_CONDITION_FAILED` 并在 COMMIT 前回滚整笔）。服务层映射既有 `version_conflict`，未新增公开 HTTP 错误/读写目标/设置模板 | Rust 测试：先写入后条件失败→**所有表零增量**；合法断言提交；四种非法形状全拒且零写入 |
| 批次 CAS 提交前断言 | `signOff` 的候选 UPDATE 与关联目标 UPDATE 均带 `expectChanges:1`；删除提交后 throw 冒充回滚的实现 | 单测：两批抢同候选一赢一拒且败者零台账/零事项/零关联 |
| 同 operationId 并发归并 | `signOff` 捕获台账 UNIQUE 冲突后重读台账，同规范输入→重放，异输入→`idempotency_conflict` | 单测：并发同 ID 归并为一应用一重放 |
| 进程树退出核实 | `worker-host` 记录 `pgid`（detached 子进程为组长），`verifyTree` 以 `process.kill(-pgid,0)` 核实整树；`done` 返回 `treeVerified`；调度器在未核实时不提交结局、保持 `exited_unknown` 占槽 | 代码＋单测（`markNeedsReview` 未核实占槽） |
| 帧 fencing | `worker-host` 同时校验 `runId` 与 `hostNonce`；删除 `WORKER_DEBUG` 原始帧落盘路径 | 代码审读 |
| 来源回溯 | 新增 `GET /api/manual-items/{id}/sources`（关联行＋来源锚点/摘要）；`asBackend('todo_source_links')` 接线 | 路由＋客户端 |
| 完整产品 DOM 旅程 | headless Chrome/CDP 驱动产品自身 DOM：配对→工作台→文本整理→提交→候选出现→**全选 4 条→签收选中事项→读回 4 条 `signed_ai`**；47 个同源请求、0 跨源 | `ui-journey-results.json`、`ui-journey.png` |

### 9.2 本轮聚焦验证

fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` **16/16**（新增提交前断言测试）；clippy `-D warnings` 干净；单测 **11/11**（新增批次竞争、并发同 ID 归并）；`test:web-manual-items` **59/59**；typecheck 干净；003 哈希 `8e4e3159…7870`；UI 旅程 7 步全通过、4 条签收、0 跨源。

原始证据：`build/web-text-intake-implementation/{verification.log,ui-journey-results.json,ui-journey.png}`。

---

## 10. 第四轮修订（2026-11-09）：来源端点契约对齐、进程树组外后代、生命周期事件同事务

### 10.1 已关闭

| 项 | 处置 | 证据 |
|---|---|---|
| 来源端点契约 | `GET /api/manual-items/{itemId}/sources` 对齐登记：200 `{contractVersion,sources:[{sourceId,candidateId,evidence,association,createdAt,anchorAt,excerpt}]}`；association 仅 `new\|manual_link`；时间为 ISO UTC 毫秒；excerpt ≤200；事项不存在→404 `item_not_found`；无来源→200 空数组 | UI 旅程实测：已关联 200 且形状/时间/摘录全部合规；缺失 404；无来源 200 `sources:[]`；未认证（`credentials:'omit'`）401 |
| pgid 组外后代 | `verifyTree` 先核实进程组已空（`process.kill(-pgid,0)`→ESRCH），再扫描进程表是否仍有 `--run <runId>` 标记；标记仍在或扫描失败一律视为**未核实**，保持 `exited_unknown` 占槽 | 代码＋单测 |
| 生命周期事件同事务 | `claimNow`（claim＋attempt＋事件）、`stageResult`（暂存＋payload＋事件）、`confirmExit`（各分支转移＋事件）、`markNeedsReview`（转移＋事件）、`task-recovery.classify`（转移＋事件＋recovery_item）均在**同一事务**内提交 | 单测 11/11；Rust 提交前断言测试 |
| 提交前断言 | 见 §9；本轮 `claimNext` 亦加 `expectChanges:1` | Rust 16/16 |

### 10.2 仍未闭合（如实）

1. **有界重试（`auto_backoff`）**：`attempt_budget` 仍未递减，失败一律 `manual`；自动重入队未实现。
2. **`resolve(resume)` 暂存原结局**：当前 resume 仍重排队并丢弃暂存；未按原暂存结局提交/发布候选。
3. **`TaskQueue.vue`** 未交付；队列位置/逐任务取消的 UI 入口缺位。
4. **预览/修改 UI、队列 UI、重启 UI** 未取证。
5. **`side_effect_receipts`** 接线仍待裁定。

### 10.3 本轮聚焦验证

fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` 16/16；clippy `-D warnings` 干净；单测 11/11；`test:web-manual-items` 59/59；typecheck 干净；003 哈希 `8e4e3159…7870`；UI 旅程 7 步全通过、4 条 `signed_ai` 签收、来源端点 200/404/401/空列表四态齐备、0 跨源。

原始证据：`build/web-text-intake-implementation/{verification.log,ui-journey-results.json,ui-journey.png}`。

---

## 11. 第五轮修订（2026-11-09）：有界重试、resolve 暂存结局、TaskQueue、退出核实身份集、大结果索引

### 11.1 已关闭

| 项 | 处置 | 证据 |
|---|---|---|
| 有界 `auto_backoff` | `task-service.maybeAutoRetry`：仅 `retryable=auto_backoff` 且 `sideEffectSafety=proven_safe` 才重入队，`attempt_budget` 递减，`expectChanges:1` 同事务写事件；预算耗尽降 `manual`；安全未证转 `needs_review`（`failure_unknown_side_effect`） | 代码＋单测 13/13 |
| `resolve(resume)` 暂存原结局 | HTTP 层在 `resume` 且 `resultPendingExit=1` 且类型 extract/revise 时走 `confirmExtractExit`，提交原暂存结局并发布候选，不再重排队丢弃 | 代码＋UI 旅程 |
| `TaskQueue.vue` | 新增真实队列组件：经 web API 列出 queued/running/cancelling，逐任务取消；挂载于待确认页 | UI 旅程实测渲染（`queueSurface:true`，文案「整理队列 当前没有排队或进行中的整理任务。」） |
| 退出核实身份集 | `verifyTree` 改为核实**已登记身份集合**（进程组＋退出时快照的直接子进程），`--run` 标记仅作补充信号；无法枚举或任一成员存活即未核实→保持 `exited_unknown` 占槽 | 代码＋单测（未核实占槽） |
| `confirmExtractExit` 守卫 | 终态/`needs_review`/`exited_unknown` 一律不再驱为 `succeeded`、不释放槽；加 `expectChanges:1` 与 attempt epoch 围栏 | 单测：重复确认零事件零版本、异 epoch 被拒 |
| 大结果索引信封 | `readResult` 对 >64KiB 且无显式范围返回**索引信封**（`inline:false`、`payload:null`、`payloadRef`、`nextOffset:0`、`done:false` 及规定元数据）；显式 `offset` 才返回字节段 | 单测：索引信封＋分段拼接跨 UTF-8 边界还原原文＋非法范围 `result_range_invalid`/`result_range_unsatisfiable` |
| 恢复事件同事务 | `task-recovery.classify` 的转移、`task_events` 与 `recovery_items` 同一事务 | 代码＋Rust 断言 |

### 11.2 取证口径更正

- 早轮评论记「43 个同源请求」为**该次工件**的计数；本轮工件按同一 CDP Network 口径记录为 **37**（`observed` 数组在本轮脚本中未捕获重载文档请求，故 `localRequests` 读 0）。**跨源请求两轮均为 0**（安全相关断言）。DOM 节点数与候选数口径不同：`.review-grid [class*=candidate]` 会命中嵌套节点，候选数应以 `.candidate-card` 计（本轮 4）。
- 旅程脚本、合成输入与运行命令随附件交付，可复跑。

### 11.3 仍未闭合（如实）

1. **预览/修改 UI 旅程**：候选修改预览的产品 DOM 路径未取证（服务端 revise/preview/apply 已由 API 与单测覆盖）。
2. **队列多任务 UI 旅程**：多任务排队/逐任务取消的 DOM 路径未取证（TaskQueue 已渲染，取消动作经 API）。
3. **`side_effect_receipts`** 接线仍待裁定。
4. **MCP/派生进程身份**：当前协议不报告 runtime 派生的 MCP 子进程身份；`verifyTree` 已按可枚举身份集核实，未枚举到的后代保持未核实占槽。

### 11.4 本轮聚焦验证

fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` 16/16；clippy `-D warnings` 干净；单测 **13/13**；`test:web-manual-items` **59/59**；typecheck 干净；003 哈希 `8e4e3159…7870`；UI 旅程 7 步全通过、4 条 `signed_ai` 签收、队列表面渲染、来源端点 200/404/401/空列表四态齐备、**SIGKILL 重启后 4 条事项保留**、0 跨源。

原始证据：`build/web-text-intake-implementation/{verification.log,ui-journey-results.json,ui-journey.png}`。

---

## 12. 第六轮修订（2026-11-09）：结果/退出分离、后端独立时限、回执事实、身份集核实

### 12.1 已关闭

| 项 | 处置 | 证据 |
|---|---|---|
| 结果与退出分离 | `worker-host.start({...,onFrame})`：身份过滤后的帧按到达顺序串行等待 `onFrame` 的持久化；调度器用它在**结果帧到达时立即暂存**，不再等 `handle.done`。`done` 在退出且此前帧处理收尾后才报告退出事实，且**不重复覆盖**已暂存结局 | 单测：结果帧后 worker 仍活 → `resultPendingExit=1`、候选 `staged`、不可见不可签收、占槽；worker 退出后才发布 |
| `confirmExit` 不假设退出 | 缺句柄→`{exited:false,reason:'unknown_handle'}`；缺身份记录→`{exited:false,reason:'missing_identity'}`；树不可核实→`{exited:false,reason:'tree_unverified'}`。记录保留至核实 | 单测 |
| `stopAll` 有界收尾 | 逐个 cancel 帧→宽限→SIGTERM→宽限→SIGKILL→**逐一等待退出**；关闭与失败路径同样等待，未核实者保留记录 | 代码 |
| 后端独立时限 | `runLimitMs` 不再只交给 Runtime：后端到期发带身份 cancel 帧→宽限→按自有 pgid 回收；`done` 报告 `deadlineTriggered`，调度器按 `model_timeout`（`auto_backoff`/`unknown`）收口 | 代码 |
| 回执事实（P-3） | `worker-host` 从**现有帧**提取真实事实（工具进度→`tool_call_unattributed`；worker 生命周期→`tool_call_closed`），经串行 `onFrame` 链由调度器以独立小事务持久化（`receiptId`＝SHA-256(紧凑 JSON `[runId,attemptId,kind,callKey]`) 前 32 hex；重复帧幂等；错身份零入账；`external_ref` 仅非秘密追溯标识，缺失时写单身份非秘密标记）。**任何非只读回执存在时失败结局强制 `sideEffectSafety=unknown`**；零记录永不推导 `proven_safe` | 单测 |
| 退出核实身份集 | `verifyTree` 核实进程组＋退出时快照的直接子进程；`--run` 标记仅补充。无法枚举或任一成员存活即未核实 | 单测（死组空子＝已核实；存活子＝未核实；缺快照＝未核实） |

### 12.2 本轮聚焦验证

fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` 16/16；clippy `-D warnings` 干净；单测 **17/17**（含生命周期 4 项：结果后仍活、缺句柄/缺身份、`verifyTree` 边界、回执幂等/错身份）；`test:web-manual-items` **59/59**；typecheck 干净；003 哈希 `8e4e3159…7870`；真实 Pi＋受控服务 UI 旅程 7 步全通过（4 条 `signed_ai` 签收、队列表面渲染、来源端点 200/404/401/空列表、SIGKILL 重启保留 4 条事项、**0 跨源**）。

原始证据：`build/web-text-intake-implementation/{verification.log,ui-journey-results.json,ui-journey.png}`。

### 12.3 仍未闭合（如实）

1. **Runtime 派生的 MCP 子进程身份**未被现有协议报告；`verifyTree` 按可枚举身份集核实，未枚举后代保持未核实占槽（不靠扫描未命中放行）。
2. **回执的 begin/closed 匹配**：现有帧无 begin/closed 工具帧，工具进度只能记为 `tool_call_unattributed`，不能匹配到具体调用（闭合只覆盖 worker 生命周期）。
3. **预览/修改与多任务队列的 DOM 旅程**未取证（服务端已由 API 与单测覆盖）。
4. 结构检查保留运行时未跟踪文件的原始失败与元数据分类；完整 `npm run check` 留唯一集成执行者。

---

## 13. 第七轮修订（2026-11-09）：MCP 控制帧接入（范围变更登记）

### 13.1 范围变更

派发明确：e840 的帧提取此前只覆盖 `progress`/`worker`，**无 mcp `call_begin`/`call_response` 分支**；本轮按已批准 P-3 消费**实际现有 MCP 字段**，只消费既有帧，不实施 W2 的 MCP 配置/工具入口，不改 Runtime/DDL。

### 13.2 实施

`receiptFactsFor` 现区分两处来源：

- **MCP 控制面**（`{type:'mcp', action, requestId, runId, hostNonce, ...}`，见 `runtime/lib/mcp-control.mjs`）：
  - `call_begin` → `tool_call_begin`，callKey=`[callId, modelCallId]`（取自 `input.modelCallId`）；
  - `call_response` → `tool_call_closed`，callKey 同上；
  - 其余控制动作（`http_open`/`prepare`/`owner`/`end`/`catalog`）→ `tool_call_unattributed`。
- **通用工具路径**：`progress{phase:'tool'}` → `tool_call_unattributed`；`worker` 生命周期 → `tool_call_closed`（bash，callKey=`[pid, nonce]`）。

P-3 语义保持：receiptId＝SHA-256(紧凑 JSON `[runId,attemptId,kind,callKey]`) 前 32 hex；**begin/closed 各自独立提交**（无前瞻：`call_response` 不从原始帧全集向后查 begin，也不匹配被拒 begin）；重复帧按 receiptId 幂等；错身份（runId/hostNonce 不符）零入账；`external_ref` 仅存已有非秘密追溯标识。所有事实均 `provable_readonly=0`——**任何非只读调用（含全部已闭合）存在时失败结局强制 `sideEffectSafety=unknown`**，零记录永不推导 `proven_safe`。

### 13.3 验证

单测 **18/18**（新增 MCP 控制帧用例：`call_begin`/`call_response`/控制动作分别落 begin/closed/unattributed，callKey 为 `[callId,modelCallId]`，异 runId 零入账，重复帧幂等，闭合无 begin 仍独立入库）。fmt exit 0；schema 23/23；store 16/16；clippy `-D warnings` 干净；`test:web-manual-items` 59/59；typecheck 干净；003 哈希 `8e4e3159…7870`。

### 13.4 仍未闭合（如实）

Runtime 派生的 MCP 子进程身份未枚举（未枚举后代保持未核实占槽）；回执的 begin/closed 不做调用级匹配（现有帧无 begin/closed 工具帧）；`side_effect_receipts` 的恢复读回同一事实已具备（库内可读），但未新增跨重启专测。

---

## 14. 第八轮修订（2026-11-09）：R6/R7 后端闭合批

### 14.1 本批闭合

| 项 | 处置 | 证据 |
|---|---|---|
| **R7-M-1** | `confirmExtractExit` 在 `exited:true` 且无暂存且非 cancel 时收口为 **failed**（`model_request_failed`/`worker_lost`、`auto_backoff`、`unknown`），不再无条件置 succeeded；候选零发布 | 单测：无暂存退出 → `failed`、0 候选、failure 落库 |
| **R6-M-1** | 认领/确认关闭上一 attempt 行（`task_attempts.ended_at`/`exit_confirmed_at`）：`confirmExit` 三分支 + `markNeedsReview` 不再误关（needs_review 任务不可被认领，attempt 保持打开供 resolve 使用）。重入队后可第二次认领 | 单测：重入队 → 退避期满后 `claimNext` 成功且 attemptId 不同 |
| **R6-M-2** | `retryable` 由**可信后端错误码**按冻结 §4.6 派生（`model_request_failed`/`output_contract_invalid` → `auto_backoff`，其余 `manual`）；`model_timeout` 仅内部诊断，公开码映射 `model_request_failed` | 单测：`model_request_failed` → 自动退避重入队 |
| **R6-M-3** | HTTP `resolve(resume)` 专用路径：`needs_review` 且 `resultPendingExit=1` 的 extract/revise 提交**原暂存结局**并发布候选（`force` 直通；downgrade 不再清除暂存列） | 单测：HTTP handler 层 resume → `succeeded` + 候选发布 |
| **R6-M-4** | `markNeedsReview` 的 unknown 降级清 `terminal_at`（满足 tasks CHECK），不再抛错；安全未证 → `needs_review` | 单测：unknown 降级成功落库 |
| **R5-M-1** | extract/revise 主路径事件：`stageExtractResult`/`stageReviseResult` 在同事务写 `task.changed`；`confirmExtractExit` 各分支亦带事件 | 代码 + 单测 |

### 14.2 验证

单测 **22/22**（新增 R6/R7 六例：无暂存退出、重入队二次认领、失败降级、HTTP resume、attempt 关闭、auto_backoff 派生）；fmt exit 0；`web_backend_schema` 23/23；`web_backend_store` 16/16；clippy `-D warnings` 干净；`test:web-manual-items` **59/59**；typecheck 干净；003 哈希 `8e4e3159…7870`。

### 14.3 仍未闭合（如实）

- **R7-M-2/M-3**：退出核实的身份集仍以下列事实为限——退出时直接子进程快照**结构性为空**（孤儿已重挂），`--run` 标记仅补充；逃逸的 detached 后代仍会 `treeVerified=true`、记录删除、槽释放。存活期身份登记（runtime 上报或 host 侧登记）与登记集清扫为本批未做。
- **MCP response 配对**：仍按「独立事实、无前视」记录 begin/closed，未做「闭合仅匹配已接受且已持久化的 begin」的调用级配对（现有帧无 begin/closed 工具帧）。
- **真实 `test` 任务安全正控**：未实施（需可信服务端快照 + Runtime 路径独立证明无工具/MCP 副作用）。
- **旅程脚本**：未随候选交付。

---

## 15. 第九轮修订（2026-11-09）：MCP 闭合读取已持久化 begin

### 15.1 本批闭合

按派发「MCP 闭合必须读取此前已持久化 begin」：

- `receiptFactsFor(frame, state)` 为每个 run 维护 **open begin 集合**（`state.openBegins`）。
- `call_begin` → 记 `tool_call_begin` 并登记为 open begin。
- `call_response` → **仅当存在已接受且已持久化的 begin 时才记 `tool_call_closed`**；闭合的 callKey 复用该 begin 的 callKey（`call_response` 不重复 `modelCallId`，由该 open begin 关联）。begin 被消费。
- **无 begin 的孤立 `call_response` → 记 `tool_call_unattributed`**，绝不伪造配对。
- 两个 begin 后两个 closure：各自闭合**最旧的 open begin**（FIFO）。

### 15.2 验证

单测 **23/23**（新增 MCP 配对用例：孤立闭合→unattributed；begin+response→closed 且复用 begin callKey；双 begin+双 response→FIFO 消费）。fmt exit 0；schema 23/23；store 16/16；clippy `-D warnings` 干净；`test:web-manual-items` 59/59；typecheck 干净；003 哈希 `8e4e3159…7870`。

### 15.3 仍未闭合（如实）

- **R7-M-2/M-3**：退出核实的身份集仍受限——退出时直接子进程快照**结构性为空**（孤儿已重挂），轮询未命中不能推导完整性；逃逸的 detached 后代仍会 `treeVerified=true`、记录删除、槽释放。存活期身份登记与登记集清扫未做。
- **MCP 调用级配对的持久化可读性**：闭合事实与 begin 事实同 attempt 同 callKey，可库内对读；未新增跨重启专测。
- **真实 `test` 任务安全正控**未实施。

---

## 16. 第十轮修订（2026-11-09）：MCP 配对改为精确单次调用身份（接受关闭）

### 16.1 退回原因

上一版以「最旧 open begin」的 FIFO 回退配对，被裁定证伪：真实 `runtime/lib/mcp-trial.mjs` 的 `call_response` 保留 `serverId`＋`callId`，仅不重复 `modelCallId`；FIFO 在**同一服务**上会让 B 应答错误闭合 A。**FIFO 不能替代已有的单次调用身份。**

### 16.2 本批修正

- 配对键改为**当前 attempt 内 `serverId`＋`callId`** 精确匹配：`pairReceiptFact(fact, openBegins, closedPairs)` 导出为纯函数；`call_response` 只有在存在**已接受且已持久化**的 begin（同 `serverId`＋`callId`）时才升级为 `tool_call_closed`，并复用该 begin 的 `modelCallId`／callKey；begin 被消费。
- **无匹配 → `tool_call_unattributed`**，绝不伪造配对；**错误 callId 不闭合**任何 begin。
- **只有 begin 持久化成功才进入可闭合集**：由调度器在 `recordReceipt` 返回 true 后登记；提交失败不得由内存 Map 冒充。
- **重复帧不重开已闭合调用、不重复消耗其他 begin**：`closedPairs` 记录已闭合的 `serverId＋callId`，重复 begin 不再登记。
- 事实携带 `serverId`／`callId`，供调度器与测试精确核对。

### 16.3 验证

单测 **23/23**（MCP 配对用例改为：孤立闭合→unattributed；begin+response→closed 且复用 begin callKey；同服务逆序应答→各自精确身份；错误 callId→不闭合；重复 begin→不重开）。fmt exit 0；schema 23/23；store 16/16；clippy `-D warnings` 干净；`test:web-manual-items` 59/59；typecheck 干净；003 哈希 `8e4e3159…7870`。

### 16.4 仍未闭合（如实）

- **R7-M-2/M-3**：退出核实的身份集仍受限（退出时空快照不能推导完整性）；存活期身份登记与登记集清扫未做。
- **MCP 调用级配对的跨重启可读性**：闭合与 begin 同 attempt 同 `serverId＋callId`，可库内对读；未新增跨重启专测。
- **真实 `test` 任务安全正控**未实施。
