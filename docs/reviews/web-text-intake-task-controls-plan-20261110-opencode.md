# TaskQueue 页内任务控制交互与实现方案（MAYNE-24 W1）

> 状态：**方案（plan）r2 修订版，未冻结、未实施**。r1 是协调者评论 `01a1c244`（2026-11-09）向 OpenCode 派发的交付物（提交 `9d52086`，原文见 git 历史）；其独审（Hermes，`01a1c254`）的「方案足以实施」整体结论经协调者评论 `01a1c258` 驳回，已核事实与归属／attemptCount 澄清按该评论保留。本文 r2 按 `01a1c258` 派工作独立修订；本轮仍不写生产，实施待协调者冻结并另派复审后进行。W1 授权已在 owner 评论 `01a1bb58`（2026-11-08 批准 A–C）齐备，本文不新增授权申请。
> 基点：工程接收分支 `agent/opencode/mayne-24` 提交 `5233e01da03c3254fc2d40d6549a0433dd4403c5`（r1 同基点）。前端现状以其在树六个 SSE 路径（与 R2 锚 `170f611` 逐字节全等）为准；后端语义以完整 I 候选 `cd08588` 为准（只读取证，`git show` 提取，未经本分支接收）；冻结契约以 `b190f7c` 的 `docs/engineering/web-api-contract.md`（web-api/1）与 `docs/engineering/web-text-intake-contract.md` 为准。
> 作者：OpenCode（2026-11-10；r1 与 r2 同作者——r2 是作者按派工意见的修订，不是独立评审）。评审与实施归属由协调者另行分派；TaskQueue.vue 写域按协调者裁定 `01a1c180` ③ 已转属 OpenCode（见 §8.3 依赖登记）。
>
> **r2 修订清单**（对照 r1，逐项对应 `01a1c258` 意见）：①废除「缺条目版本取 1／缺回执当空即形成有效 CAS」的客户端回退承诺——处置只来自权威条目版本与权威回执，字段缺失即禁用入口并围栏重读，后端前置显式登记，不永久豁免修复（§2.3 新增、§3、§4.3、§7 U4、§8.3）；②补足结果提交前按需核对完整内联／分段内容的路径，不再把仅标题／索引及「发布后再读」当作已充分核对；核实现成 client 方法已足够，零 client 改动（§4.3、§7 U10、§8.1、§9）；③并发写回与行内错误／pending 增加请求代次＋epoch＋组件生命周期归属与可证伪验收（§5.2、§7 U9）；④attemptCount 时点修正（调度认领时递增，非 202 即时；§4.2、§7 U1）；⑤过期写域登记更正（头部、§8.3）。

## 1. 范围与边界

本方案只覆盖 **TaskQueue 组件页内**的三类任务控制交互与实现：

1. 失败任务的 **manual retry / 配置修复后重跑**（`POST /api/tasks/{id}/retry`）；
2. `needs_review` / `interrupted` 的 **结果核对、回执确认、resume / cancel**（`POST /api/tasks/{id}/resolve`、`GET /api/tasks/{id}/result`）；
3. **并发设置 GET/PUT**（`GET`/`PUT /api/settings/agent-concurrency`）。

**不在本方案**：不新增导航项、不新增公开端点/字段/错误码、不改 client 方法签名、不改权限（BUSINESS_TABLES／settings 模板守卫零变化）、不改 Workbench 挂载决策（属页面所有者范围）、不改 organizer 候选编辑/签收面、不实施真实模型验收。取消入口已接线（现网行为），本方案仅补其 409 处置纪律与标签修正。

## 2. 现状基线（逐源）

### 2.1 前端现状（`5233e01` 在树）

- `src/components/TaskQueue.vue`（blob `1d9551a5`）：分页全量读回（page cap 200、limit 100，第 55–70 行）、请求序＋epoch 双围栏（第 47–48、57、74、77 行）、1s 轮询兜底＋SSE 失效 seam（第 93–94 行）、显示集合 `queued/running/cancelling/needs_review/interrupted`（第 37–43 行）、仅取消入口（第 81–89 行）；第 11–12 行明示 **retry/resolve/concurrency 未接线（交互未决，后端门禁未放宽）**——本方案即为该未决交互收口。
- `src/stores/pairing.ts`（blob `2910c15c`）：`syncEpoch`（第 56 行）、`setOnTasksInvalidated`（第 90–92 行）；`task.changed` 与 `settings.changed` 帧均触发队列失效（第 223–225 行）；`stream.reset` → 快照重同步（第 180–186、236–273 行）。
- `src/lib/web-api-client.ts`（blob `1b6a6cfb`）：任务控制方法已全部存在——`getTask`(638)、`readTaskResult`(642)、`cancelTask`(649，`expectedVersion?`)、`retryTask`(653，`expectedVersion, configRevision?`)、`resolveTask`(657，`expectedVersion, decision, acknowledgedReceipts`)、`readConcurrency`(681)、`writeConcurrency`(688)；线类型 `WireTask`(146–171，含 `recovery: Record<string, unknown> | null`)、`WireSnapshot`(189–198)。**本方案零 client 改动。**
- `src/stores/organizer.ts`（blob `e47ce430`）：`applySnapshot` 消费快照基线、drafts 按候选 id 存活（第 84–100 行）；`wireGenerations` 以线版本区分合法新 attempt 与陈旧响应（第 23–53 行）。任务控制动作不得绕过或复制该基线。
- 挂载现状：`TaskQueue.vue` 尚未被 `Workbench.vue` 引用（SSE 测试 harness 槽内挂载除外）。挂载位置沿用页面所有者的既有决策，本方案不新增导航、不改挂载。

### 2.2 后端语义（完整 I `cd08588`，只读依据）

| 端点 | 关键语义（源码位置） |
|---|---|
| `POST /api/tasks/{id}/cancel` | queued→`cancelled`(200)/running→`cancelling`(202)，其余 409 `state_conflict`；`expectedVersion` 携带即严格校验（task-service 508–548；预检 512–514，条件更新＋事件同事务 `expectChanges:1`、败者整事务回滚） |
| `POST /api/tasks/{id}/retry` | 仅 `failed` 且 `failure.retryable==='manual'`；`version` 严格 CAS；`configRevision` 变更仅 `auth_or_config_invalid`/`config_revision_unknown` 两码允许，否则 409 `config_revision_change_not_allowed`；重置 `attempt_budget`、清 failure/terminal、重入队（556–596；失败码注册表 40–45） |
| retry 的快照来源 | HTTP 层：请求 `configRevision` ≠ 任务当前修订时，以 `textIntake.snapshotFor()` **在 retry 时刻服务端重解析**不可变快照，随重试落 `input_ref`（http-server 785–799；RS-1：客户端永不上送 snapshot/skills） |
| `POST /api/tasks/{id}/resolve` | 仅 `needs_review`；`attemptExitState==='exited_unknown'` → 409 `exit_unconfirmed`（602–605）；`expectedVersion` 以 `inputRef.recovery.itemVersion ?? 1` 校验（606–609）——**校验对象是缺省常量而非权威 `recovery_items.version`，属冻结 §3.3/§3.5 偏差（§2.3）**；resume 须 `acknowledgedReceipts` 覆盖全部 `verifiable!==false` 回执否则 400（610–614）——回执清单同样取自 `inputRef.recovery.receipts ?? []` 而非权威表；cancel→`cancelled`、resume→重入队，均同事务关 attempt 行＋事件（616–666） |
| 暂存结局 resume 专线 | HTTP 层对 `decision==='resume' && resultPendingExit && type∈{extract,revise}` 先走 `commitStagedResume`：提交**原暂存结局**（成功发布 staged 候选为 pending、失败删除），门禁与 409 同主路径（http-server 811–826；text-intake-service 1307–1365） |
| 结果读取白名单 | 仅 `succeeded`，或 `needs_review + resultPendingExit + exited_confirmed + cause='result_exit_unconfirmed'`（task-service 673–679）；线可见性同口径（`visibleResult`/`visibleFailure` 355–376） |
| `GET /api/settings/agent-concurrency` | 无保存行返回缺省 3/version 0 且**不写库**；附 `runningCount`（占槽口径＝`attempt_exit_state IN (active,exiting,exited_unknown)`，第 18 行常量）与 `queuedCount`（762–783） |
| `PUT /api/settings/agent-concurrency` | 正整数 1..32 否则 400 `validation_failed`；设置版本 CAS 409 `version_conflict`；`settings.changed` 事件与写同事务、败者回滚（804–836）；HTTP 层提交后广播（http-server 836–850） |
| 重启恢复扫描 | 核实 worker 进程树；`running` → `needs_review`＋`cause=restart_unknown_side_effect`＋recovery item(version 1)；`needs_review(exited_unknown)` 回收→`exited_confirmed`（task-recovery 108–148）。**注意：现实现不产生 `interrupted` 状态**（全树仅读取，无写入），重启中断一律落 `needs_review` |
| 退出未确认隔离 | `confirmExit(exited:false)` → `needs_review`＋`exited_unknown` 占槽＋recovery item v1，cause 按暂存与否分流 `result_exit_unconfirmed`/`exit_unconfirmed`（task-service 1136–1170） |

线域 `recovery` 对象：`exited_unknown` → `{cause, itemVersion, stagedResult}`（**无** `decisionOptions`）；`exited_confirmed` → 追加 `decisionOptions:['resume','cancel']`（task-service 336–352）。**`exited_confirmed` 分支不返回 `itemVersion`**（348 行的 `itemVersion ?? 1` 只在 exited_unknown 分支），`receipts` 恒为 `inputRef.recovery.receipts ?? []`（345 行）——而 `inputRef.recovery` 在现实现**只读不写**。冻结 web-api/1 §3.5（`web-api-contract.md:121`）要求凡列明 cause 必带 `itemVersion`（对应 `recovery_items.version`）、`receipts` 为已知回执数组；现实现对可处置形态不暴露权威条目版本、回执恒空，构成契约偏差——登记于 §2.3，客户端消费规则见 §3.2（权威缺失即禁用，不回退）。

### 2.3 权威链路缺口登记（冻结 web-api/1 §3.3／§3.5 vs `cd08588` 现实现；r2 新增）

冻结承诺（`docs/engineering/web-api-contract.md`，冻结钉值 SHA-256 `61863271…f58d` 对当前字节复算命中）：

- §3.3（:102）：变更按被修改对象绑定三类版本，resolve 绑定**条目版本**（`recovery.itemVersion` 与 hold 报告条目 `version`），不可与任务版本混用。
- §3.5（:121）：凡 `cause ∈ {…}` 的线域 `recovery` 必带 `itemVersion: int`（**对应 `recovery_items.version`**，供两个 resolve 入口做乐观并发校验）；`receipts` 为已知外部回执数组（元素结构同 §12 `side_effect_receipts`）。
- §3.5（:136）：任务 resolve 与 hold 条目 resolve 是同一操作、同一版本守卫；处置成功后任务与条目版本**同时递增**；`verification_state ∈ {resumed, cancelled}` 的条目不可被旧请求改写（409 `state_conflict`）。
- §4.5（:198）：`acknowledgedReceipts` 必须覆盖 `recovery.receipts` 中全部 `verifiable=true` 条目，否则 400。
- §12（:389）：`recovery_items.version` 从 1 起、每次变更 +1；每个 `needs_review` 任务对应一行；任务 `recovery.itemId`/`itemVersion` 指向此行，两个 resolve 入口共用该版本做乐观并发。

现实现偏差（`git show cd08588` 逐行核）：

1. **权威源未接线**：`resolve()`（task-service 606）与 `commitStagedResume()`（text-intake-service 1316–1319）均以 `inputRef.recovery.itemVersion ?? 1` 校验，而 `inputRef.recovery` 全树只读不写——CAS 对象是缺省常量 1，不是 `recovery_items.version`；`recovery_items` 行虽在 `confirmExit` 写入（task-service 1152，version 1），但没有任何 resolve 路径读取它。
2. **可处置形态不暴露条目版本**：`recoveryFor()`（task-service 336–352）在 `exited_confirmed` 分支（唯一可 resolve 的形态）不返回 `itemVersion`；`itemVersion ?? 1` 只出现在 `exited_unknown` 分支（348）。
3. **回执门空转**：`resolve()` 的回执校验（610）与线域 `receipts`（345）均取 `inputRef.recovery.receipts ?? []`——恒空数组使「ACK 覆盖全部可核对回执」的 400 门恒过；`side_effect_receipts` 表（977–1008）未被任何 resolve 路径读取。
4. **推论**：客户端 `?? 1` 与服务端 `?? 1` 互为镜像只证明「两端同写法」，不证明符合契约——CAS 恒过（1===1）不是无错误放行依据；既有 task-version 事务围栏（resolve UPDATE 的 `WHERE … version=?`＋`expectChanges:1`）守护的是任务版本，**不能替代**冻结 §3.3 要求的提交方条目版本校验。「权威条目版本变化后的旧请求 409 且无写入」「存在待确认回执时缺 ACK 的 resume 被拒」这两条契约行为在现实现不可达成。

处置：本方案（UI 面）按「权威缺失即禁用＋围栏重读」实现（§3.2、§4.3），并把后端权威链路修复登记为显式前置（§8.3）——修复本身属 server 面，不在本方案写入范围；协调者已并行派发有界诊断（ZCode，recovery-authority，同触发评论 `01a1c258`）给出已复现／未复现、根因与最小修复文件／回归清单。本方案不把该偏差写成永久豁免。

## 3. 三类 CAS 与 409 纪律（逐源核）

冻结契约 §3.3（`docs/engineering/web-api-contract.md:102`）：三类版本按被修改对象绑定、**不可混用**。页面实现按下表各用各的来源，一个动作只携带一类版本：

| 动作 | 携带版本 | 客户端来源（读取时点） | 服务端校验源 |
|---|---|---|---|
| `cancel` | 任务 `version`（可选携带） | 列表读回行内 `task.version`（现网即此值） | `tasks.version`（508–514） |
| `retry` | 任务 `version`（必填） | 列表读回行内 `task.version` | `tasks.version`（563–565，WHERE version=? 586） |
| `resolve` | 条目 `recovery.itemVersion`（必填） | 该任务线域 `recovery.itemVersion` **权威读取**；缺失／非正整数 → **入口禁用＋围栏重读**（不上送任何回退值，§3.2） | `recovery_items.version`（冻结 §3.3/§3.5）。**后端前置未满足**：现实现以 `inputRef.recovery` 缺省 1 校验（606–609；`commitStagedResume` 1316–1319）——见 §2.3／§8.3 |
| `writeConcurrency` | 设置 `version` | 最近一次 `readConcurrency()` 快照 | `settings.version`（814–827） |

**禁止混用的具体表现**：resolve 不允许把任务 `version` 当 `expectedVersion` 上送（两类计数器独立递增）；retry 不允许沿用上一次 retry 响应的版本（重复 retry 必 409，冻结 §4.5）；并发 PUT 不允许用任务版本或应用时区设置版本。

**`recovery.itemVersion`／`receipts` 的客户端读取规则（r2 修订，废除 r1 回退承诺）**：冻结 §3.5（:121）要求列明 cause 必带 `itemVersion`（对应 `recovery_items.version`）、`receipts` 为已知回执数组。客户端**只从权威字段取值，不实现任何缺省回退**：`itemVersion` 必须为正整数（`Number.isInteger` 且 ≥1）才允许 resolve；`receipts` 必须为 `Array.isArray` 才允许进入回执确认门（空数组＝权威表明无待确认回执，合法）。任一字段缺失或形状不符 → 该行 resolve/resume 入口禁用＋触发一次围栏化重读＋行内提示「权威核对条目缺失，暂不可处置」——**缺失不等于 1、不等于空**。r1 的「`typeof itemVersion === 'number' ? itemVersion : 1`、与服务端 `?? 1` 逐字对齐即构成有效 CAS」承诺按协调者 `01a1c258` 驳回废除：两端镜像不证明符合契约，「CAS 恒过」不能作为无错误放行依据，既有 task-version 事务围栏也不能代替提交方的条目版本校验（§2.3）。对照现实现（§2.3），全部可处置行将呈禁用态——这是后端前置未满足时的正确安全行为，不是 UI 缺陷；后端补齐权威字段后客户端零改码自动启用。exited_unknown 行的线面 `itemVersion ?? 1`（348 行缺省值）不产生任何 UI 路径：该形态处置本就全禁（409 `exit_unconfirmed`）。

**409 处置纪律——重读，不盲重放**（冻结 §3.3 场景 7）：

- `version_conflict`：一律触发**围栏化重读**（走 §5 的 `refresh()`／`reReadConcurrency()`），把新状态与新版本呈给用户；**decision 类动作（retry/resolve）不得自动重发**——状态可能已使该决定失效（如任务不再 failed、条目已被他端处置），须由用户对新状态重新决策后显式再点；cancel 允许一次「重读后提示再点」，同样不自动重发（他端可能已完成取消，自动重发只会制造 `state_conflict` 噪声）。
- `state_conflict`（终态/已处置/读取白名单外）：重读＋提示，不重发。
- `exit_unconfirmed`：提示「退出尚未确认，等待系统核实」，重读保持占槽显示；处置按钮按 §4.3 矩阵本应禁用，此 409 只应来自竞态点击。
- `config_revision_change_not_allowed`：提示该失败码不允许换修订，按钮面按 §4.2 收敛（不提供换修订入口）。
- `validation_failed`（并发越界 400）：输入约束就地纠正，不发请求侧重试。

## 4. 交互设计：入口与状态矩阵

### 4.1 显示集合修正（本方案的 两处现状勘误）

1. **`failed` 必须可见**：现 `STATE_LABELS`（TaskQueue.vue 37–43 行）不含 `failed`，第 59 行过滤器将其丢弃——manual retry 入口无处安放。服务端列表本就返回全部状态（cd08588 `list()` 474–491 行无终态过滤），修正纯属客户端显示决策：显示集合扩为 `queued/running/cancelling/needs_review/interrupted/failed`（终态 `succeeded/cancelled` 仍隐藏，无页内动作）。已释放槽位的任务进入显示不改变占槽语义（占槽只跟 `attempt_exit_state`，冻结 §3.2：95 行）。
2. **`interrupted` 标签勘误**：现标签「退出未知」与冻结语义相悖——`interrupted` 是「重启、旧 worker 已确认停止、无未知副作用」（冻结 §3.2：81 行），而「退出未知」事实挂在 `needs_review(exited_unknown)` 上。修正：`interrupted` → 「重启恢复中」；`needs_review` 标签按 `attemptExitState` 二分——`exited_unknown` → 「退出未知·待系统核实」、`exited_confirmed` → 「待核对」。

### 4.2 失败任务：manual retry／配置修复后重跑

入口（行内，仅 `state==='failed'`）按 `failure.retryable` 三分：

| `failure.retryable` | 显示 | 入口 | 请求 |
|---|---|---|---|
| `manual` | 「失败」＋失败信封（code/message） | 「重试」 | `retryTask(taskId, task.version)`——**省略** `configRevision`，沿用原修订（凭据恢复、发送前失败等非配置问题，冻结 §4.5：176–181 行） |
| `manual` 且 `failure.code ∈ {auth_or_config_invalid, config_revision_unknown}` | 另示「已修复配置，用新配置重跑」次入口 | 与「重试」并列 | `retryTask(taskId, task.version, newRevision)`——`newRevision` 为**配置修订来源**：模型配置保存（`PUT /api/models`）成功后模型配置 store 持有的最新 `revision`；仅当该值存在、store 处于已读取就绪态、且 ≠ 行内 `task.configRevision` 时启用并携带，否则退化为普通重试。客户端**永不上送快照本体**（RS-1：服务端在 retry 时刻重解析，http-server 785–799） |
| `auto_backoff` | 「失败·将自动重试」 | 无手动入口（调度器处理；预算耗尽后 `retryable` 降为 `manual`，经刷新出现入口） | — |
| `none` | 「失败·无法重试」 | 无 | — |

点击后：按钮进入 per-task pending（§5.2），202 → 围栏化 `refresh()`；409 `version_conflict`/`state_conflict` → 按 §3 纪律。行内同时展示 `attemptCount`（第 N 次尝试）。**时点（r2 修正）**：`attemptCount` 是 `task_attempts` 行数的读时计数（task-service 243–245），新 attempt 行在**调度器认领时**插入（`claimNext`，841–872）——retry 事务只重置入队、不插 attempt 行；故 202 响应本身不携带 +1，+1 在调度认领（任务转 running）后经围栏刷新呈现，UI 不得在 202 即断言 +1（r1「重试后 +1 可观测」表述据此修正）。

### 4.3 needs_review：结果核对／回执确认／resume／cancel

入口出现在**展开区**（行内「核对」切换，`aria-expanded`），仅在 `decisionOptions` 存在（即 `exited_confirmed`）时提供处置按钮：

| 任务形态 | 显示 | 可用入口 |
|---|---|---|
| `needs_review` + `exited_unknown`（cause 三种 `*_unconfirmed` 之一，`recovery.stagedResult` 标注有无暂存） | 「退出未知·待系统核实」＋占槽标记（「占 1 个执行槽，等待系统核实退出」，不显示 queuePosition）＋cancelIntent=true 时提示取消待核实 | **全部处置禁用**（无 resume/cancel、无结果读取）；恢复扫描回收后经 `task.changed` 帧→围栏刷新转为下一行形态 |
| `needs_review` + `exited_confirmed`、无暂存结局（cause=`restart_unknown_side_effect`/`exit_unconfirmed` 回收后/`cancel_unknown_side_effect`） | cause 说明文案 | 「恢复执行」（resume）与「放弃取消」（cancel）；无结果核对面（`resultPendingExit=0`，读取白名单外） |
| `needs_review` + `exited_confirmed` + 暂存结局（cause=`result_exit_unconfirmed` 回收后） | **结果核对面**：`task.result`/`task.failure` 线可见（§2.2 可见性），展示暂存结局判别——成功默认示紧凑摘要（候选标题级），**并提供「查看完整内容」入口（r2 新增，提交前就地核对，见下文专段）**；失败示 failure 信封 | 「提交暂存结果」（resume→服务端 `commitStagedResume` 提交原暂存结局：成功发布 staged 候选、失败清除）与「放弃」（cancel→`cancelled`，staged 候选删除）；文案必须写明两种后果（§7 验收项） |
| 带回执（`recovery.receipts` 为数组且非空） | 回执清单：每条 `receiptId`＋kind＋`verifiable` 标注，复选确认 | resume 按钮**禁用直至全部 `verifiable!==false` 条目被勾选**（与服务端 400 校验同口径，610–614 行）；cancel 不要求回执确认。**r2 修订**：清单只来自线域 `recovery.receipts` 数组——字段缺失／非数组 → resume 禁用＋围栏重读（权威回执缺失不能当空处理，§2.3/§3.2）；空数组＝权威表明无待确认回执，resume 不因回执禁用 |

**提交前完整内容核对（r2 新增专段）**：暂存结局的 resume 会把原暂存结果发布为正式候选——该「提交」动作前，用户必须能在页内核对完整内容；仅标题／64KiB 索引＋「发布后于收件箱再读」**不构成已充分核对**（r1 口径废除）。「查看完整内容」就地展开：内联结果（≤`maxInlineBytes` 64KiB，task-service 701–716）直接渲染完整 payload 文本；大结果（>64KiB，717–731 索引信封）以 `readTaskResult(taskId, offset, limit)`（web-api-client 642–648，现成方法已支持分段参数，**零 client 改动**）按 `maxSegmentBytes` 逐段累积 `payloadBase64`→UTF-8，直到 `done===true`，展示「已载 X／共 totalBytes 字节」进度与完成态。加载会话受 §5.2 请求代次／epoch／卸载归属约束，部分累积不写入共享 store 状态。提交门控不变：resume 可用性仍只由权威条目版本＋回执 ACK 门决定，完整内容核对是提供面而非额外门——但交互文案不再以「发布后再读」替代提交前核对。

请求：`resolveTask(taskId, itemVersion, decision, acknowledgedReceipts)`，`itemVersion` 按 §3.2 规则取值——**仅权威字段值，无回退**（r2）；权威缺失时该请求根本不会发出（入口已禁用）。成功 202 → 围栏刷新；resume 后任务回 `queued`（或暂存结局终态化），cancel 后 `cancelled`（从显示集合消失）。

### 4.4 interrupted：恢复扫描所有，页面只读

`interrupted`（若后续实现产生）显示「重启恢复中」，无页内动作——冻结 §3.4：恢复扫描负责有界重入队或转 `needs_review`/`failed`，页面经由围栏刷新被动跟随。不得在此状态提供手动 resume/cancel（服务端 resolve 仅接受 `needs_review`，409 `state_conflict`）。

### 4.5 并发设置 GET/PUT

- **入口**：TaskQueue 头部「并发」控件（本组件即冻结契约 §8.2 指定的并发入口承载者），展开显示：当前值、缺省值、`version`、运行中/排队计数；数字输入（1..32，步进语义按既有数字控件约定）。
- **读**：挂载时 `readConcurrency()` 一次；此后经 `settings.changed` 帧→失效 seam 触发围栏化重读（帧不携带权威载荷，只作节奏）。重读同样受请求序＋epoch 围栏约束。
- **写**：`writeConcurrency(inputValue, version)`；200 → 用响应快照**就地安装本地并发视图**（含新 version 与计数），并触发一次围栏任务刷新；`runningCount > 新上限` 时提示「下调不中断正在执行的任务，待自然退出后生效」（冻结 §5：192–194 行）；409 `version_conflict` → 重读＋保留用户输入值，提示「设置已被其他窗口修改」，由用户显式再次提交（§3 纪律：不盲重放）；400 → 输入就地纠错。
- **不混用**：该 `version` 是设置自身版本，与应用时区设置（`/api/settings/application`）和任何任务版本无关。

### 4.6 整页状态矩阵（state × attemptExitState → 显示与入口）

| state | attemptExitState | 显示 | 取消 | 重试 | 结果核对 | resolve |
|---|---|---|---|---|---|---|
| queued | not_started | 排队中·第 N 位 | ✅(v) | — | — | — |
| running | active | 进行中 | ✅→202 取消中 | — | — | — |
| cancelling | exiting | 取消中 | ❌(已提交) | — | — | — |
| failed | exited_confirmed/not_started | 失败＋信封 | ❌ | 按 §4.2 | 失败结局不在白名单（任务行信封已可见） | — |
| needs_review | exited_unknown | 退出未知·占槽 | ❌ | ❌ | ❌ | ❌(409 exit_unconfirmed) |
| needs_review | exited_confirmed | 待核对（展开区） | — | ❌ | 按 §4.3 | ✅(itemVersion) |
| interrupted | exited_confirmed | 重启恢复中 | ❌ | ❌ | ❌ | ❌ |

（✅(v)＝携带任务 version；矩阵与冻结 §3.2/§3.5/§4.4/§4.5 逐一对应，无新增服务端路径。）

## 5. 围栏保留与异步归属

### 5.1 三道既有围栏原样保留

1. **分页全量**：`refresh()` 仍走整表分页（cap 200、limit 100），权威队列是全量列表而非首页；新增显示的 `failed` 行同样只能来自该全量走页，禁止用 `state=` 过滤参数另开第二条读取路径（那会绕过既有围栏与排序）。
2. **请求序**：每次 `refresh()` 持自增 `refreshSeq`，响应落地前校验（TaskQueue.vue 47、57、74、77 行）；动作成功后的读回统一走 `refresh()`，**动作响应体不直接写入 `tasks`**——绕过围栏的就地写入是本方案明确禁止的模式。
3. **epoch 围栏**：发起时捕获 `pairing.syncEpoch`，落地前比对（48 行）；跨 epoch 响应（`stream.reset`/快照重同步后）永不落地，由新 epoch 的下一次读回重建。并发设置的重读同样捕获并比对 `syncEpoch`。

### 5.2 await 后归属、卸载、失败与草稿

- **请求代次＋epoch＋生命周期归属（r2 新增）**：组件持全局单调 `actionSeq`；每个异步续体——cancel/retry/resolve 动作、并发 GET/PUT、结果分段加载会话——在发起时登记 `{key, generation, epoch}`（key＝`taskId+动作名`，内容加载会话用独立 key）。续体落地须**同时**满足：① `mounted` 为真（卸载后静默丢弃 UI 写入）；② `pairing.syncEpoch` 与发起时一致（跨 epoch 响应永不落地，pending 整表清空，显示由新 epoch 的围栏读回重建）；③ 该 key 无更新的 generation 已登记（旧代次续体丢弃）。服务端效果不因丢弃而回滚——权威在服务端与 organizer store，丢弃只影响显示，由下一次围栏化读回收敛。
- **await 后归属**：每个动作持有 per-task `pendingAction` 键（taskId → 'cancel'|'retry'|'resolve'|'concurrency'）；在途时同任务同动作重复点击被忽略（不入队），不同动作也互斥（一任务同时在途一个动作）。响应回来后只允许两件事：清自己的 pending 键、触发围栏化读回；动作响应里的 `task` 字段仅用于即时反馈（如成功提示），不安装进队列状态——续体落地另受上列请求代次／epoch／卸载三条件约束（不满足即丢弃，r2）。
- **行内错误与 pending 的代次归属（r2 新增）**：错误槽归该 key **最新 generation** 所有——新动作发起即清旧错误；旧 generation 的迟到错误不得渲染（含成功后到达的旧错误）；pending 键只被自身 generation 的续体清除。并发写回（动作响应）与行内错误／pending 状态因此都有明确的「请求代次＋epoch＋组件生命周期」三元归属，可证伪验收见 §7 U9。
- **卸载**：`onUnmounted` 现有清理（清定时器、摘除失效 seam，96–99 行）保持；新增：置 `mounted=false`，所有动作的 await 续体在触碰组件状态前检查该标志，卸载后静默放弃 UI 写入（authority 在服务端与 organizer store，卸载只丢显示，与组件头注释既有声明一致）。在途 HTTP 不中断（cancel 意图已提交即生效），下次挂载由首次 `refresh()` 收敛。
- **失败**：动作错误写入行内/共享错误槽（`role="alert"` 槽沿用第 105 行），逐动作隔离——一个任务的失败不遮蔽其他行；错误**永不**改动任务列表内容；409 按 §3 纪律附带围栏化重读。
- **草稿**：TaskQueue 无草稿。organizer 候选编辑草稿按候选 id 存活于同步与卸载（organizer.ts 84–100 行同 epoch 合并／跨 epoch 重建均不清 drafts）；任务控制动作不得清空或改写 drafts。resume 提交暂存结局发布候选后，草稿与候选新版本的陈旧标记沿用既有 `sync()` 版本逻辑（101–105 行），不在本方案改动面内。

## 6. a11y 与窄屏

- **键盘可达**：全部入口为真实 `type="button"`；行内动作按钮带含任务语境的可寻址名（如「取消整理任务 {kind}」「重试失败任务 {kind}」，现网取消按钮无独立可寻址名，属补齐项）；展开区用 `aria-expanded`/`aria-controls` 关联；回执复选为原生语义 input＋显式 `<label>`（DESIGN.md 控件约定：标签必须关联真实焦点元素）。
- **焦点与反馈**：错误用砖红文字＋`role="alert"`，不单靠颜色（DESIGN.md 210 行）；进行中 `aria-busy`（现网已有，103 行）扩展到行级动作在途态；动作完成后焦点不跳移——行由 `taskId` keyed 渲染，行仍在时焦点保持；行消失（终态化移出显示集合）时焦点落到列表容器并按 `aria-live="polite"` 播报结果摘要。
- **窄屏（640×900，DESIGN.md 195 行验证尺寸）**：队列行由单行 flex 改为可换行布局（`flex-wrap`），位置/动作控件不溢出不横向滚动；展开区（结果核对、回执清单、并发控件）窄屏纵向堆叠，触达目标不小于既有小按钮 30px 最小高度；展开区最大高度内滚动，不撑破页面。
- **对比与状态文字**：状态以文字标签呈现（不依赖色点）；占槽/排队位置的区分用文字（「占 1 个执行槽」vs「第 N 位」）。

## 7. 可证伪 UI 验收（绿/红对照）

每项均给出可观察结果与反向预期；红例用于证明断言真的承重。

| # | 验收项 | 绿（预期可观察） | 红（反向证伪） |
|---|---|---|---|
| U1 | failed 可见＋manual retry | 受控服务使任务失败（`auth_or_config_invalid`）→ 队列出现「失败」行＋「重试」→ 点击 → 202 → 行转「排队中」、调度认领后 `attemptCount`+1（读时计数，非 202 即时可观测，§4.2 时点） | 用 `auto_backoff` 失败行断言无「重试」按钮；带旧 version 二次点击断言 409 后不产生第二次重入队（服务端 `GET /api/tasks/{id}` attemptCount 不再变化） |
| U2 | 配置修复后重跑 | 修配置保存→「用新配置重跑」启用→ 202 → 行内 `configRevision`＝新修订、`originalConfigRevision` 不变（受控 provider 断言新 attempt 用新快照） | 对 `model_request_failed` 行注入换修订请求断言服务端 409 `config_revision_change_not_allowed`（直连 HTTP 反控）且 UI 无换修订入口 |
| U3 | 暂存结局核对→resume | 结果帧后强退→回收→行示「待核对」＋暂存结局摘要→「提交暂存结果」→ 任务终态化、staged 候选发布为 pending（收件箱可见） | 同形态点「放弃」断言候选不可见（staged 删除）且任务 `cancelled`；两条路径的候选可见性互为反例 |
| U4 | 回执确认门与权威前置（r2 扩展） | 带 `verifiable` 回执的核对区：未全勾选时 resume 禁用；直连 HTTP 绕过 UI 发 resume 断言 400；**权威前置**：构造 `itemVersion`／`receipts` 字段缺失的线域行，断言 resolve/resume 入口禁用＋行内提示且不发任何请求 | 全勾选后 resume 200/202；勾选状态与按钮可用性联动可观察；**承重反例（r2）**：「缺字段即回退 1／空」的变异客户端在同样缺失行上会发出 resolve 并被现后端缺省口径放行（200）——证明严格门承重，钉住「不回退」承诺 |
| U5 | exited_unknown 拒绝恢复 | 强退未确认：行示占槽标记、处置按钮禁用；直连 HTTP resolve 断言 409 `exit_unconfirmed`；恢复扫描回收后行转「待核对」＋按钮出现 | 回收前任何 UI 路径不发出 resolve；占槽计数（并发 GET runningCount）包含该行 |
| U6 | 并发 CAS 与下调语义 | 新根 GET 示 3/version 0；PUT 2 → version 1、运行任务不被杀、第 4 任务排队；`settings.changed` 后他端视图经围栏重读收敛 | PUT 0/33 断言 400；两窗口竞写断言后到者 409 后界面显示新版本与新值、不盲重放（旧 version 重发断言不再发出） |
| U7 | 围栏不回退 | 慢响应迟放：跨请求序/跨 epoch 响应不落地（复用 sse-client 套件 S8/S9 同型判据） | 注入旧 epoch 响应断言列表不被回写 |
| U8 | a11y/窄屏 | 键盘全流程可达（Tab 顺序、Enter/Space 激活、焦点保持/回落）；640px 无横向滚动、控件可触达 | 拆除可寻址名/换行布局的负例对照（同 capability-ui 基线负例手法） |
| U9 | 请求代次／epoch／卸载归属（r2 新增） | 同任务同动作在途重复点击被忽略；响应在**卸载后**到达 → 无状态写入、无错误渲染、无残留定时器；`stream.reset` 换 **epoch** 后到达的旧响应／旧错误被丢弃且 pending 清空；新 **generation** 发起后旧代次错误不渲染、旧代次成功不安装 | 摘除代次／epoch／卸载守卫的负例对照：迟到响应覆盖新状态、旧错误渲染（断言可观察的错误显示）——证明三元归属断言承重 |
| U10 | 提交前完整内容核对（r2 新增） | 暂存成功结局：≤64KiB「查看完整内容」展开＝完整 payload 文本；>64KiB 分段加载直至 `done===true`，累计字节数＝`totalBytes`、「已载 X／共 Y」进度与完成态可观察；加载完成后「提交暂存结果」按回执门可用 | 仅索引信封无分段加载路径（或部分加载即标「完整」）判红：断言累计字节 < totalBytes 时「完整」标记不出现、resume 文案不含「发布后再读」替代口径 |

U1–U6 的服务端行为已在 II 集成面与冻结场景（场景 6/7/19/24/27/29/30/31/33）覆盖；U4 的权威前置红例另依赖 §2.3 登记的后端偏差事实（其 server 修复面由协调者并行派发的有界诊断另交，不在本方案范围）；U1–U10 的 **UI 面**由新增聚焦单测（§8.2）+ 真实同源浏览器旅程（另派验收轮）证明，不在本轮执行。

## 8. 生产／测试路径与依赖（最小范围）

### 8.1 生产路径（实施轮的唯一生产改动面）

- `src/components/TaskQueue.vue`：显示集合与标签修正（§4.1）、三入口接线（§4.2–4.5）、提交前完整内容核对（§4.3 专段）、请求代次归属（§5.2）、a11y/窄屏（§6）。**仅此一个生产文件。**
- 零改动清单：`src/lib/web-api-client.ts`（方法全齐——r2 专项核验：`readTaskResult(taskId, offset?, limit?)` 642–648 已支持分段查询参数透传，大结果完整核对**无需新增或扩展 client 方法**；resolve/cancel/retry/concurrency 签名亦全部现成）、`src/stores/organizer.ts`、`src/stores/pairing.ts`、`server/**`、`src-tauri/**`、`package.json`、守卫与依赖锁。**单文件目标不以删减契约为代价**（r2）：若复审认为仍需 client 扩展，按协调者 `01a1c258` 口径列最小兼容扩展供审，而非回退到「仅标题／发布后再读」口径——经核验本方案不需要。

### 8.2 测试路径

- 新增 `tests/unit/web-text-intake-task-controls.test.mjs`（领域命名，`tests/unit`，符合仓库测试约定）：复用已接收 harness `tests/fixtures/web-text-intake/sse-client-harness.mjs` 的只读导出（`wireTask`/`defaultWorld`/`installControlledNetwork`/`mountGate`/`waitFor`/`settle`）挂载真实 TaskQueue；harness `routeCall` 未脚本化的面（cancel/retry/resolve/result/concurrency）由**测试本地的 fetch 包装层**先行应答、其余委托 harness 受控网络——**零改动已接收字节**（blob `82c8c0e7`/`fe2bd6b1` 保持冻结）。20s 预算与 finally 清理纪律沿用。
- 服务端语义红例（U2/U4/U5 的直连反控）登记为 II 集成面既有职责，不在新单测重复起真实服务。

### 8.3 依赖登记（实施前须成立的既有事实）

1. **写入归属（r2 更正）**：TaskQueue.vue 写域按协调者裁定 `01a1c180` ③「其中原属 OhMyPi 的三路径本包暂转你（OpenCode）」——r1 头部与此处「OhMyPi 四文件独占」登记已**过期**，按 `01a1c258`「过期写域登记」意见更正；过期归属不构成授权阻塞。实施派发归协调者裁定；作者不得自签评审（署名分离不因写域转移而失效）。
2. **挂载前置**：入口可见性依赖 TaskQueue 已被页面挂载（页面所有者范围）；未挂载时本方案全部交互不可达，属 PrerequisiteGap 而非本方案缺陷。
3. **模型配置 store 就绪**：U2 的「用新配置重跑」依赖配置已保存且 store 持有新 `revision`；未就绪时入口禁用并提示，与 organizer 既有守卫文案一致。
4. **后端权威链路前置（r2 新增）**：resolve/receipt 入口的**可用性**以后端按冻结 §3.3/§3.5 暴露权威条目版本与已知回执为前置（§2.3）；现实现（cd08588）未满足——对照现后端，本方案全部 resolve/resume 入口呈禁用态（正确安全行为，非 UI 缺陷）。后端修复属 server 面，不在本方案写入范围：由协调者并行派发的有界诊断（ZCode，recovery-authority，同触发评论 `01a1c258`）给出已复现／未复现、根因与最小修复文件／回归清单后**另派实施**。本方案不永久豁免该修复，也不以「CAS 恒过」视为入口可用；实施时序（UI 先行带禁用态 vs 与后端修复同轮）由协调者裁定。
5. **授权**：W1 授权（owner `01a1bb58` 批准 A–C）已覆盖上述文件面；本方案无新增依赖、无锁变更、无 schema/权限变更，不需要新的 owner 授权（§8.3.4 的后端修复亦属既有冻结契约的兑现，同 `01a1c258` 口径不新增授权申请）。

## 9. 未决与交回裁定项

- **快照形状（样例 vs 实现）**：`GET /api/snapshot` 冻结样例的嵌套 `settings` 形态与实现（顶层 `agentConcurrency`）差异已有专册核对分工（ZCode `web-text-intake-snapshot-alignment-20261110-zcode.md`，另交）；本方案不依赖该结论——并发入口读的是 `GET /api/settings/agent-concurrency`，不受快照形状影响。
- **`interrupted` 的产生路径**：冻结契约定义了该状态，现实现（cd08588）不产生之。本方案按「出现即只读显示」覆盖；若后续切片要求页面参与其处置，属契约面扩展，交回协调者裁定。
- **结果核对的面内摘要深度（r2 已闭合）**：r1 的「紧凑摘要以候选标题级为界＋发布后收件箱核对」口径按协调者 `01a1c258` 驳回；r2 已补「提交前完整内联／分段内容核对」路径（§4.3 专段、§7 U10），并核实现成 client 方法足够（§8.1）——本项不再是未决。

## 10. 本轮限定核查（方案轮，未跑聚合/构建/完整门禁）

- 逐源静态核查：上表全部行号与语义取自 `5233e01` 在树文件与 `git show cd08588`/`b190f7c` 提取件（r2 复核：`recoveryFor` 336–352、`resolve` 598–614、`commitStagedResume` 1307/1316–1319、`confirmExit` recovery_items 写入 1152、`side_effect_receipts` 977–1008、`attemptCount` 243–245、`claimNext` 841–872、`readResult` 669–759、client `readTaskResult` 642–648、冻结契约 :102/:121/:136/:198/:386/:389）；提取件与行号核验记录在 `build/mayne24-task-controls-plan-r2-20261110/`（gitignore，随评论附件交付摘要与 SHA256 清单）。
- `npm run check:docs`（修订 .md 后必跑）；`check:structure` FAIL 集与基线逐行比对（零新增）。未跑：聚合套件、构建、19 旅程、完整 `npm run check`、任何行为重放——实施与验收归后续轮次。

## 11. r3 补充约束：核对会话与并发视图的安装纪律

完整受审方案为 `f8599cab6efb7972a2240ae986b21d4bd853fa2c` 的 r2 原文加本节。本节细化 §4.3、§4.5、§5.2 与 U6/U9/U10；与前文宽泛表述不一致时以本节为准。方案仍为候选，准出以完整组合方案的独立评审及实际落位字节核对为准；后端权威前置另行验收，不由 UI 种子代签。不改公开 HTTP 契约、权限或写域。

### 11.1 分段结果与 ACK 必须绑定任务代次和恢复版本

分段加载会话、部分及完整结果缓存、ACK 勾选均绑定 `(taskId, syncEpoch, task.version, attemptId, recovery.itemVersion)`；服务端提供 `recovery.itemId` 时同时绑定该值。不能仅以 taskId/epoch/itemVersion 绑定，因为新 attempt 的条目版本可能再次为 1。处置所需权威字段缺失时继续执行 r2 的禁用、提示和围栏重读规则，不生成回退版本。

围栏刷新带回新行、epoch 改变或组件卸载时，绑定任一成员改变即作废旧会话：停止继续请求旧分段，清除旧部分/完整结果与完整标记、旧 ACK 和仅归旧会话所有的错误/pending。在途响应可结束，但其任何续体在写状态前必须同时核对组件生命周期、会话 generation 与当前绑定；作废后的响应不得写入新行。发出 resolve 前再次核对当前绑定，旧勾选不得转用于新条目。

U9/U10 增加确定性反例：同 taskId、同 epoch、itemVersion 同为 1 但 attempt/task.version 已变；同 attempt 但 itemVersion 已变；上述失效后旧末段才返回 done=true。三面均须证明旧结果不安装、不标完整、旧 ACK 不沿用，且不能发出携带旧核对状态的处置请求。

### 11.2 并发 GET/PUT 共用安装归属并保持版本单调

并发设置的 GET 与 PUT 作用于同一权威视图，必须共享安装归属/接受水位；各自不同 key 的最新 generation 不足以决定该视图可否安装。所有数据、错误与 pending 写入都验证组件生命周期、syncEpoch 及当前请求归属；旧操作只能清理自己仍拥有的 pending。

在同一 epoch 内，响应设置 version 小于已显示 version 时禁止安装；相同 version 的迟到响应也不能覆盖较新请求已安装的计数/状态，须有共享请求代次判据。PUT 成功响应若因归属守卫被丢弃，须通过统一围栏重读收敛，不能仅清 pending 就把陈旧视图当作已完成。新 epoch 重新建立该视图的版本基线，旧 epoch 的水位不能拒绝新 epoch 的较低合法版本。输入草稿与权威视图分离，409 重读继续保留用户输入，不自动重发。

U6/U9 增加确定性反例：旧 PUT v1 晚于 GET v2；不同 GET/PUT key 的交错；同版本旧响应晚到；epoch 改变后合法低版本读回；409 重读保留草稿。前四面均须观察实际显示值/计数/错误/pending，不能只断言守卫函数被调用；删除共享归属或版本守卫的变异应命中相应断言。
