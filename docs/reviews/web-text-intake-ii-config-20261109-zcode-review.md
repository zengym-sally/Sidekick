# II 配置夹具五文件修订 `7f3322b` 限定独审（ZCode，2026-11-09）

- 审阅人：ZCode（未参与该实现；实现者为 OhMyPi，独审对象为本条修订增量与其 TAP 证据面）。
- 派发：`01a1be9f`（2026-11-09T04:44:17Z）。边界：不改断言或生产；不重复四套件全跑或完整 gate；先复跑三份聚焦证明；依据已附 TAP 逐类定位残余失败与 `/api/models` 契约归属；交「测试须修／生产须修／待裁」证据清单。
- 结论速览：**修订面通过（限定）**；四套件残余 34 例失败按三类交付清单（生产须修 14 例／8 根因，测试须修 8 例／2 根因，待裁 12 例／5 族）；`/api/models` 形状分歧契约归属＝**生产须修**（冻结 P1 §5.3 逐字）。

## 1. 身份与基点（对象库逐字节复核）

- 修订 `7f3322b9c98d7adbb7b06e3543cd7b83bd4aab54`／tree `479edf7b27349637f4b8098ddbd1ec2b7b02312f`，父 `a94232e7`（OhMyPi 分支 F1 附录 docs 提交）；恰 **5 个新增文件**（该分支此前不携带 II 套件）：`tests/fixtures/web-text-intake/model-config.mjs`（+100）与四套件（http +1233、queue +1399、controlled-model +569、static +536，均为本分支首次入库）。docs 记录 `a142f38`（评审记录＋索引，docs-only）。
- **基点校正（登记精度事项，非缺陷）**：套件字节的直接基座是 **II r5 `61a069b`**（tree `e0a6028b`，父 `1bfc352`），不是派发点名的 r4 `1bfc352`。按 blob 逐一对比：`git diff 61a069b..7f3322b` 每套件仅 http +12/−37、queue +7/−15、controlled-model +7/−15、static +7/−30；相对 `1bfc352` 的 queue 面为 +209/−49，可精确分解为 r5 自身的 +202/−34（两剩余面，已由 `3ef87b3` 限定复核关闭、`01a1bc48` 登记）＋配置修订 +7/−15。r5 是 II 线当前已登记状态，修订骑在其上不改变任何既有判定。
- 生产参照：OhMyPi 运行树的生产取自 `ef0f0d4`（= 生产 `432305b`＋docs；admission.json 声明，storage binary `42af54b5…490fc2` 2649408 B 与既往登记逐字节同）。本审核验 `server/lib/config-store.mjs`（blob `752c414c`）在 `6681adf` 与 `ef0f0d4` **逐字节相同**，故 DTO 判定对两锚点同时成立；`http-server.mjs` 两锚点 blob 不同（Kimi R8 改动），但 GET `/api/models` 信封形状两处一致（见 §4）。

## 2. 窄差异核验（勿把新增四套件当全新通过）

四套件与夹具的全部差异（blob-to-blob，本审逐一读取）：

| 文件 | 差异内容 |
|---|---|
| http | import 共享夹具；`writeModelConfig` 体内联非法形状 → `writeControlledModelConfig(root,null,CREDENTIAL_REF)`；T-3 内 **4 处** `providers[0].credentialRefs=[…]` 突变 → `setControlledCredentialRef(...)`（missing→available→missing→available） |
| queue | import + `writeModelConfig` 体替换（1 处） |
| controlled-model | import + `writeModelConfig` 体替换（1 处） |
| static | import + **2 处**内联构造（before 钩子 + `startUnpairedBackend`）→ 夹具调用 |

- **零断言改动**：四个 diff 的全部 hunk 均在 import／注释／writer 体／撤销突变点；无任何 `assert.*` 行、无用例增删、`after` 未动、合法缺省 `timeZone` 未动、严格时限类型负例未动、故障配置用例未改成有效输入。派发授权面（配置构造处＋新夹具）逐字成立。
- **夹具注释事实核对**：`model-config.mjs` 头部对冻结 DTO 的声明逐条与生产 `config-store.mjs`（`752c414c`）一致——`PROVIDER_FIELDS`（:74）、`auth` 白名单（:114）、`MODEL_FIELDS`（:75）、`sidekick.defaultModelId/revision`（:246-247）、`normalizeAgent` 顶层 `revision`（:342）、`authMode/credentialRefs` 为 `listProviders()` 输出（:387-403）。
- **四套件现状不是通过签发**：after 状态 13/11、6/11、6/10、7/2 仍是红多绿少；新增通过的 12 例（http 8、queue 3、cm 1）只是夹具解锁后的增量面，II 既有的 r4/r5 限定审历史与未闭清单不变。

## 3. 三份聚焦证明复跑（本审新跑，非追认）

前置自建：生产五文件（`config-store.mjs`／`model-snapshot.mjs`／`manual-items-service.mjs`／`shared/dates.mjs` 取自 `ef0f0d4`，`git hash-object` 逐字节等）＋修订夹具（blob `8596b78e` 等于 `7f3322b` 版本）装入隔离目录；附件脚本按原样仅替换 `<WORKTREE>` 占位与固定 `/tmp` 路径。Node v24.20.0。

1. `dto-field-check.mjs`：旧夹具 `authMode`/`credentialRefs` 判 ILLEGAL（不在 `PROVIDER_FIELDS`）；顶层 `defaultModelId` 被忽略——exit 0，与生产源码逐行一致。
2. `fixture-against-production.mjs`：新夹具形状 `readModelConfiguration()` OK（`defaultModelId=controlled-organizer-model`）、`buildModelSnapshot()` OK（`revision=r1`）、capability 视图 `available` → 撤销后 `unavailable` → 恢复后 `available`——exit 0，完整复现声明。
3. `revocation-through-legal-field.mjs`：仅用生产 `ConfigStore` 独立复现同一 available→unavailable→available 迁移——exit 0。

撤销机理核实：`auth.apiKeyRef` 是生产真实读取的输入字段；`credentialStatusFor`（:265-272）每次经活 `credentialProvider.status(ref)` 派生；`ConfigStore` 每次调用重读盘上文件，故夹具改文件即被生产观察到。旧写法（`credentialRefs` 不在白名单）在 DTO 下确为 **no-op**，撤销用例此前静默失效——OhMyPi 归因成立。http 两 T-3 用例由败转 PASS 在真实链上补齐端到端面（撤销后任务在任何模型调用前失败、恢复后正常）。

## 4. `/api/models` 形状分歧：契约归属＝生产须修

冻结 P1 契约 `docs/engineering/web-text-intake-contract.md` §5.3（blob `6943151e` 版本，P1 `b190f7c6` 与当前 HEAD 同 blob，无漂移）逐字：

> `/api/models` GET — → 200 `{providers, models, defaultModelId, revision}`（平铺）
> `/api/models` PUT `{input, expectedRevision}` → 200 `{configuration, warning}`

生产实现（`ef0f0d4` `http-server.mjs` :822-826；`6681adf` :808-811 同形）：`modelsRead` 返回 **`{contractVersion, configuration}`**（`revision` 在 `configuration.sidekick.revision`），与 §5.3 平铺形状**不符**；PUT 形状相符（`{contractVersion, configuration, warning}`）。结论：套件平铺断言**正确**，须修的是**生产 GET 形状**；按 `01a1bbd2` 原裁定不得以双读兼容掩盖。此分歧先于本修订与 R8 存在，非本增量引入。

## 5. 残余失败三类清单（依据已附 TAP，34 例）

判读方法：四对 before/after TAP 全文解析（after 失败集 ⊆ before，comm 差集空，独立复算），逐例读测试源码与生产源码定位根因后归类。同一根因合并为一项。

### A. 生产须修（14 例／8 根因）

| # | 根因（生产证据） | 波及失败例 |
|---|---|---|
| A1 | GET `/api/models` 信封 `{contractVersion, configuration}` ≠ 冻结 §5.3 平铺（§4 已证） | http「T-2: model configuration reads back…」 |
| A2 | 候选形状：`fields`/`evidence`/`dueExpression`/`followupExpression`/`unresolved` 被包进 `draft.*`（`text-intake-service.mjs` `rowToCandidate` :204-220），契约 §5.1 将其列为候选属性、无 `draft` 包装 | http「candidates: staged candidates…」（:625 'must carry its fields'）、http「T-9」(:653 `fields.title` TypeError)、cm「T-4」(:334 map) —— 注意 cm T-4 的 `length===2` 断言已过：暂存→退出确认→发布链路本身在真实链上工作 |
| A3 | 签收批次 ≥2 规则：`signOff` :525 `choices.length < 2 → validation_failed '批量签收至少需要两条候选。'`；冻结 §5.1 无此约束（400 仅限时间未核对） | http「T-10: cross-family collision」（409 被掩盖）、http「T-10: linking…」、http「T-11」、queue「T-7」（:473）—— 四处同根因；对照：同套件「T-10: batch sign-off is atomic」用 ≥2 批次已 PASS，说明规则只挡住合法单选批次 |
| A4 | `settings.changed` SSE 帧未广播（冻结 web-api 契约 :225「变更以 settings.changed 事件广播」、:245 事件类型枚举） | queue「settings: the concurrency change…」（10s 未观察到该帧） |
| A5 | GAP-2 第二配对码：夹具经 `onPairingCode` 私有回调**确实收到**第二码，pair 却 401 `pair_code_invalid`——生产发出了自身不接受的码 | http「T-13: session revoked mid-flight…」、queue「two clients share the authoritative queue…」 |
| A6 | 错误信封空 `message`（assertEnvelope :207 'error message must not be empty'） | http「envelope hygiene」 |
| A7 | GAP-1 未闭：entry 缺省 `../../../static`、`../../../bin/web-backend-storage` 自 `build/web-backend/server/entries/` 解析到 `build/{static,bin}`，与文档及实际 `build/web-backend/{static,bin}` 差一级（`ef0f0d4` entry :27/:31；TAP stderr ENOENT 实证） | static「packaged CLI…」（GAP-1 归 I，仲裁原判） |
| A8 | 浏览器文本整理未接线（served UI 禁用页签，标题「未接通：浏览器模式不提供文本智能整理」） | static「browser text-intake journey」（前端 I/III 面） |

### B. 测试须修（8 例／2 根因）

| # | 根因 | 波及失败例 |
|---|---|---|
| B1 | cm 套件 `runFaultCase`（:448）`waitWithin(deadline, 10000)` 中 **`deadline` 未定义**（ReferenceError；该文件仅在个别用例内有局部 `const deadline`）——用例在断言前崩溃 | cm 全部 7 个「fault: …」用例。**重要含义：故障矩阵当前零产品证据，R8-M-3 故障码映射既不能由这些红签"生产失败"，也不能视为已验** |
| B2 | http「T-8」对整个任务快照做跨时刻 deepEqual（期望 `queued/version1`，实测 `succeeded/version4`）——同 `taskId`/`sourceId` 已复用，**指纹去重语义实测成立**；应比对身份字段而非可变快照 | http「T-8」 |

### C. 待裁（12 例／5 族）

| # | 争点 | 失败例 |
|---|---|---|
| C1 | PUT CAS 先后：`{input:{}}`+stale revision → 生产先内容校验（`defaultModelId` 必填 :285）后 CAS（:294-296）得 400，套件期望 409 `version_conflict`。冻结契约未定校验/CAS 先后 | http「T-2: configuration saves…」 |
| C2 | 退出确认语义：外部 SIGKILL 的 worker 被后端 reap 后 attempt 落 `exited_confirmed`，套件按保守面断言 `exited_unknown`（槽位占留＋resolve 409）。「SIGKILL 是否必须落 unknown」属 §3/§4.5 边界，与退出保证通用裁定（r1＋`01a1bd87`）相关；不影响既有路径特异结论 | queue「T-6: SIGKILLed workers…」（:380）、queue「GAP-5 exit-unknown」（:1171） |
| C3 | 协议工厂家族：暂存结果＋退出确认后，生产落 `needs_review`（recovery cause `failure_unknown_side_effect`，即 R8-M-3/§4.6 安全路由），套件期望确认退出后**发布暂存结果**（succeeded）——§4.6 安全路由 vs §4.3 暂存发布两裁定相撞。另 GAP-3-default 在**未配置**短时限时 ~14s 即终止（与缺省 120000 前提相悖），裁定前须先查明终止来源 | queue「protocol factory control」「GAP-3」「GAP-3 default limit」「GAP-4」「protocol scenario exhaustion」「protocol cleanup」（6 例） |
| C4 | 来源时间锚线形状：契约 §5.1 只钉语义（缺省＝首次录入时间），未钉线型。生产语义已实现（`anchorAtMs = sourceAtMs ?? now`，:285）但暴露 `sourceAtMs:int`＋`timeZone`＋`anchorAtMs`；套件断言 `sourceAt:{at,timeZone,localText,precision}` 对象、显式锚亦按对象提交（生产按整数校验将 400）。请求与响应线型须裁 | http「T-12」(:905) |
| C5 | M-11 联合证明：8s 内未见真实 bash 工具子进程（`pollUntil` 超时）。无法从 TAP 单独归因（受控服务的 tool_call 编码 vs 生产工具接线），M-11 本为「重申未闭」面 | cm「T-4 joint proof」；另 cm「boundary: empty candidate list」10s 未到终态，同样无法单侧归因，随本族待裁（合计本行 2 例） |

## 6. 对交付声明的核对结论

- 属实：恰 5 文件、配置构造处窄改、零断言改动、故障输入未修成有效输入、零新增失败（四套件 after ⊆ before 独立复算一致）、数字（13/11、6/11、6/10、7/2）、夹具非法/生产合法的证明顺序、14 附件（本审 CLI 原样下载，SHA256SUMS 13/13 OK，字节数逐一对上）、`<WORKTREE>` 脱敏与 0 绝对路径命中、`pointProviderAt` 保留。
- 登记补充：①修订基座是 II r5 `61a069b`（见 §1，派发点名 `1bfc352` 时应连同 r5 中间态一并登记）；②http 套件 agent 的 `supplementalInstructions` 由「保留核对依据，日期只给原文表达式。」统一为夹具短文本「保留核对依据。」——这是提示词内容统一，不是断言，不构成弱化，但登记以免误读；③`7f3322b` 所在分支此前不携带 II 夹具集（backend-child/backend-process 等不在其树内），五文件按「覆盖到 II 树上」语义交付，运行树为拼装树——与登记语义一致，集成时按此理解。

## 7. 边界与未签清单

- 本审只读候选与对象库；写入仅本评审记录（docs-only）。未改断言、生产、夹具、索引。
- 未复跑四套件、未跑完整 gate（按派发）；三份聚焦证明为本审唯一新跑动态面（Node 内存级，无网络、无真实模型／凭据／用户根）。
- 不代签：四套件业务面、R8-M-3 故障映射（B1 未验）、II 整体准出。生产须修清单不预签修复；待裁族不预设裁定方向。
