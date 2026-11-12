# R8-M-3 注册失败码／配置变更 retry 与省略 timeZone 生产缺省修复（Kimi，2026-11-09）

本记录覆盖分支 `agent/kimi/mayne-24` 上、冻结送审基点 `c4a9c6705175ff0749904a3bbbdc96efc9b67252`（tree `9545029de58d97dd8604d7b191b9cdaa62205e5c`，父 `dd92757`）之上的两个生产增量：**R8-M-3 注册失败码／配置变更 retry** 与**省略 timeZone 的生产缺省修复**。按 `01a1be0b` 派工分别提交、不与 I 既有生产提交混写；测试登记提交（`463bf46`，ZCode `adc31d8` 原字节）与生产 diff 分开。

## 身份与生产差异

- 分支 `agent/kimi/mayne-24`，HEAD 起点 `c4a9c67`；未 push、未改 `main`、未改工单状态（MAYNE-24 保持 `in_progress`）。
- 前置链（本树重建，与既往登记一致）：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` lark-cli 1.0.98；`probe:prepare-pi` provenance `ad702637fdf6fbd3f965c5dba0b14bae100b74eb`／tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`；`probe:bundle` 产出 `build/s0-runtime`；cargo 存储二进制 2649408 B、sha256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`（与既往登记逐字节相同）。
- 生产 diff（相对 `c4a9c67`）：恰 4 个 `server/` 文件 +133/−26——`task-service.mjs`、`text-intake-service.mjs`、`http-server.mjs`、`entries/web-backend-entry.mjs`。Rust、DDL、003 冻结哈希、守卫、package、前端、II/III 文件相对 `c4a9c67` 零差异。

## R8-M-3：公开失败信封保留注册码

**根因**（ZCode r8 审 R8-M-3）：`normalizeFailure` 把一切 `failure.code` 强制改写为 `model_request_failed`，注册表码降格为信封外字段 `internalCode`（冻结信封形状无此字段）；`worker_lost` 因此公开显示 `auto_backoff`；契约行 149 允许的 `auth_or_config_invalid` 配置变更 retry 因公开码被改写而恒 409 `config_revision_change_not_allowed`。

**修复**（`server/lib/task-service.mjs`）：

1. 冻结 §4.6 注册表落成显式表：六个注册码各自携带 `retryable` 默认与「副作用未证明时是否隔离待核对」。`retryable` 只区分重试发起方；安全路由按码的注册语义判定，**不派生自 `retryable`**——`tool_execution_failed`（manual）在副作用未知时仍转 `needs_review`，`worker_lost`（manual）按 §3.2 保持 `failed`，任何码在安全未证明时都不自动重入队。
2. 内部／runtime 码经别名表映射到承载其含义的注册码，永不进入公开信封：内部 `model_timeout`（后端时限）与 runtime `MODEL_TIMEOUT` → `model_request_failed`（已登记超时映射）；`MODEL_INVALID_OUTPUT` → `output_contract_invalid`；`runtime_start`/`runtime_exit`/`RUNTIME_PROTOCOL`/`CANCELLED` → `worker_lost`（worker 进程丢失／未产出结果，永不自动重试）；`INVALID_TIMEZONE`/`UNSUPPORTED_MODEL_PARAMETERS` → `auth_or_config_invalid`；`MCP_*` → `tool_execution_failed`；未识别码按丢失的 worker 运行处理（不发明分类）。
3. 公开信封收敛为 `{code, message, retryable, sideEffectSafety}`：`code` 恒为注册码，删除 `internalCode`；`retryable` 取注册表默认（预算耗尽降级写回的 `manual` 仍被尊重），不取模型／worker 载荷。
4. `maybeAutoRetry` 重排：先按注册表做安全路由（unknown → `needs_review`，`cause=failure_unknown_side_effect`），再按存储的 `retryable` 做有界退避；§4.6 场景 26 的预算耗尽降级语义不变。
5. extract 无暂存收尾（`text-intake-service.mjs` `confirmExtractExit`）：信封由 `{code:'model_request_failed', internalCode:'worker_lost', retryable:'auto_backoff'}` 更正为注册信封 `{code:'worker_lost', retryable:'manual'}`，与 `task-service.mjs` 的同类收尾一致（R7-M-1 的「无暂存即失败、0 候选、attempt 关闭」面不变）。

## 配置变更 retry：新配置必须被下一 attempt 使用

**根因**：`retry` 只更新 `config_revision` 列，`input_ref.snapshot`（launch 实际消费的不可变运行快照）原样保留——用户按 §4.5「修正后用户 retry，可携带新 configRevision」的意图重试后，下一 attempt 仍用旧快照，新配置从未生效。

**修复**（`task-service.mjs` + `http-server.mjs`）：`TaskService.retry` 接受可选 `{snapshot}`，与状态迁移同事务写回 `input_ref`（`originalConfigRevision` 保留首次入队值，`canonical` 不变故幂等重放语义不变）；HTTP `taskRetry` 在 `configRevision` 与当前修订不同时，先经生产 `TextIntakeService.snapshotFor()`（未配置模型时容忍为 null）重解析快照再传入。省略 `configRevision` 或同修订时不重建——待执行期间编辑配置不影响已入队任务（§3.1）。§4.5 门禁不变：仅 `auth_or_config_invalid`/`config_revision_unknown` 可变更修订，其他码携带变更 → 409 `config_revision_change_not_allowed`（该门禁现在按公开注册码判定）。

## 省略 timeZone 的生产缺省

**根因**：冻结 P1 `b190f7c6` §5.1 line 104 明确 POST 请求为 `{operationId,input:{text,sourceAt?,timeZone?}}`，`timeZone` 为可选输入；生产 `submitSource` 对省略时区一律 400，II 队列套件因此结构性失败（T-5 在 pristine 基线上同样失败）。按 `01a1be0b` 归属更正：这是生产缺陷，不是测试缺陷。

**修复**（`text-intake-service.mjs` + `entries/web-backend-entry.mjs`）：省略（`undefined`/`null`）时解析为**生产缺省**——复用既有应用时区解析语义：`ApplicationSettingsService.read()` 的 `application.timeZone` 存储值，未存储时回落实例 OS 时区（与设置服务其它读取同一解析；未接线设置服务时直接取 OS 时区，缺省不依赖调用方）。显式提供的时区必须是合法 IANA 区（显式非法、空串、非字符串仍 400 `validation_failed`）。解析出的时区即来源的时间锚区；指纹去重（同文本不同 operationId）保留**首次**锚点与时区，同 operationId 重放返回首个任务（其首次锚点／时区），首次录入锚点规则（`anchorAtMs = sourceAtMs ?? now`）不变。公开 DTO 未收紧（`inputRef.source.timeZone` 与 `source.timeZone` 照常暴露）。

## 验证（真实链，非 helper 直调）

聚焦命令与本树重建前置（存储二进制 2649408 B／`42af54b5…`、runtime bundle organizer `08f32db2…`／node `9d050fd4…` 与既往登记一致）：

| 运行 | 对象 | 结果 |
|---|---|---|
| 恢复回归（`adc31d8` 原字节，第一遍） | HEAD 生产 diff | tests 10 / pass 8 / fail 2 |
| 恢复回归（第二遍，稳定性） | 同一工作树 | tests 10 / pass 8 / fail 2，stderr 0 字节 |
| I lifecycle 单测 | HEAD | 10/10 |
| I service 单测 | HEAD | 13/13 |
| MCP 配对回归（`a02af9e` 原字节） | HEAD | 11/11，`pairKey` 0 次 |
| R8-M-3 重试／配置探针（scratch，build/） | 生产 entry 全链路 | 31/31 检查 |
| timeZone 缺省探针（scratch，build/） | 生产 entry 全链路 | 21/21 检查 |
| entry 存储泄漏探针（scratch，build/） | 生产 entry | 4 个被拒值各泄漏 1 个适配器（见下） |
| `npm run check:structure` | HEAD | 170 项违规全部为既有 `.kimi/`／`.multica/` 运行时目录，本 diff 零违规 |

**恢复回归 8/10 明细**：PC1/PC2（暂存恢复正控／恢复已闭 attempt 仍按条目版本 CAS 提交原暂存）、M1a/M1b/M1c（活 worker／cancelling／exited_unknown 不得发布）、**E1**（无模型启动失败公开码 `auth_or_config_invalid`、`manual`、无 `internalCode`）、**E2**（`auth_or_config_invalid` 携带变更 `configRevision` 的 retry 202 且二次认领）、**W**（后端时限收尾保留 `worker_lost`/`manual`/`failed`、无 `internalCode`、attempt 关闭）均通过。余 2 项按派工归属：**F1** 仅余末条夹具断言（`:604` 候选数，重启实例第二次 attempt 合法产出 1 个候选——`01a1be0b` 已派 ZCode 按真实产生者／attempt 时序裁处，`:591` 的「二次认领＋年轻任务不饿死」等待已通过，R8-M-2 修复未回归）；**D1**（成功终态事件／游标）为后续批次面。

**R8-M-3 探针（31 检查，生产 entry→HTTP→调度→WorkerHost→真实 stub 进程→真实存储）**：Leg A 复现 E1 面；Leg B 证明 retry 202 后**下一 attempt 实际使用新配置**（记录式 stub 观察到 attempt 2 以 `revision=r1`/`modelId=controlled-model-v1` 启动，任务 `inputRef.snapshot` 同步重建，来源文本不变）；Leg C 负控——重试后编辑配置（r2）不影响等待中的任务，不带 `configRevision` 的 retry 后 attempt 3 仍用 r1；Leg D——`worker_lost` 携带变更修订被 409 `config_revision_change_not_allowed`（§4.5 门禁按公开码判定）；Leg E——test 型任务走后端时限时内部 `model_timeout` → 公开 `model_request_failed`/`auto_backoff`，副作用 unknown 按 §4.6 独立路由 `needs_review`。

**timeZone 探针（21 检查）**：无存储设置时省略时区取 OS 时区；写入 `application.timeZone=Asia/Tokyo` 后省略时区取存储值；显式合法时区被遵从；显式非法／空串／非字符串 400；同 operationId 重放 `replayed:true` 且保留首个 source/task/锚点；指纹去重保留首次时区；worker 请求携带解析出的时区。

## 队列套件 after 挂起：持有句柄与清理根因（按派工只交根因，修复另列）

一次定向观察（17 项报完后进程不退出；不以跑绿为目的）：套件进程（node）在 TAP 报完后**永不退出**，其下遗留 **4 个 `web-backend-storage` 适配器子进程**（ppid＝套件 node 进程），与上次「遗留 4 个本树存储二进制」数量一致。

**根因（探针独立复现，`build/r8-m3/probe-entry-storage-leak.mjs`）**：生产 entry 先 `storage.start()`，**之后**才校验 `workerRunLimitMs`（`normalizeRunLimit`）。末例 `workerRunLimitMs range` 的 6 个非法值中，`0`/`-1`/`120001`/`1.5` 四个在适配器已启动后抛错，而 `startWebBackend` 的抛错路径不关闭适配器（调用方只收到 rejection，拿不到 handle）——每个被拒值泄漏 1 个适配器；其 stdio 管道被调用方事件循环持有，套件进程因此无法退出（探针进程自身同样在打印完所有行后挂住，直至被 kill）。`'500'`（`Number('500')=500` 被接受）与 `null`（按未设置取默认 120000）不抛错，不计入泄漏——与「恰 4 个」吻合。挂起的 adapters 仅在父进程死亡、stdin 关闭后才退出。

**必要修复（另列最小差异，未纳入本批 I 生产提交）**：`server/entries/web-backend-entry.mjs` 中把 `storage.start()` 之后的装配包进 try/catch，失败时 `await storage.close()` 后再 rethrow（约 6 行），使迟到的启动失败不泄漏适配器。请队长裁定后派未写该文件的成员修订。

**附带发现（II 候选结构性问题，非本批生产范围）**：timeZone 修复后，队列套件（及 http／controlled-model／static 套件）手写的 `providers.json` 使用**线上形状**（`authMode`+`credentialRefs`、缺 `name`），`models.json` 缺 `sidekick` 包装——config-store 读取路径分别以 `供应商名称无效`／`plain_credential`／`默认模型无效` 拒绝（本轮 12 例 400 均为 `供应商名称无效`）。套件自身注释预写了该分叉（「if slice I lands a different shape, the read-back assertions below fail explicitly」）。文件形状应以生产 `PUT /api/models`（`auth.apiKeyRef` + sidekick 包装）为准；属 II 夹具修订，另案处理。另：末例期望 `'500'`/`null` 被拒，而生产范围检查接受 `'500'`（ coercion ）与 `null`（未设置默认）——预期分叉留 II／队长裁处。

## 边界

未跑完整 `npm run check`（III 唯一集成轮）、未重跑未改 Rust（仅按前置编译存储二进制）、未 push、未改工单状态；MCP／M-5 未关闭（配对修复 `59b405f` 的独审通过面不变，本轮复跑 11/11）；成功终态事件（R5-M-1 D1(b)）与身份登记／保守恢复按后续批次推进；未调用真实模型／凭据／用户根；探针与原始证据在 `build/r8-m3/`（gitignored），本树运行残留进程已清理（其他成员工作树的进程按范围未触碰）。
