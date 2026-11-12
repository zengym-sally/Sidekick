# Web API 契约 V2：登记域退出确认与快照同形目标（web-api/2）

> 状态：**候选规范（candidate spec），未冻结、未实施**。本文是 MAYNE-35 的交付物：把 owner 已批准的 E-B(a) 决策（MAYNE-17 评论 `01a1c890-956e-7b11-9745-cd5717ee7fc2`「D批准；E选B(a)」；决策包 SHA-256 `9f29189ee8ada5ee170f76855a422b847e42638122d2e3971dc9bc6c60d2e647`）从已冻结的 [web-api/1 契约](web-api-contract.md)（SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`，字节冻结不动）与 E 具体差异包（`329cf86` 提交的 `docs/reviews/web-text-intake-exit-guarantee-owner-package-20261109.md`，包内副本 SHA-256 `ea620194d415184ffdd9b0a19b44d8742ba9126c897c409fb3fb0b962eee08b6`；该文件不在本树主干，按提交取证）精确派生为可直接实施、可独立审查的 V2 规范。实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；本文被独审通过并按 §14 宣布冻结前，任何成员不得按本文开工改生产。V1 原文件与原 fixtures（`tests/fixtures/web-contract/`）保留为历史来源，本轮零字节改动。
>
> 本轮只交付规范与样例；登记域谓词的实际实现（帧注册、清扫、恢复扫描收紧）由后继生产候选另派实施，D（`004_candidate_operations.sql`）由 MAYNE-33 按其已批范围实施，二者与本文的关系见 §16 执行边界。

## 0. B(a) 保证了什么、放弃了什么（阅读前提）

- **保留**：worker 退出、所属进程组消失、已登记进程逐个按身份确认退出三个主条件全部成立，且 argv 扫描已执行且无命中（补充信号）、无任何已知存活者或证据缺口时，attempt 才算退出确认（技术名 `registry_extinct`）；任何已知存活者或证据不足都否决确认，`exited_unknown` 继续占槽、`resolve` 继续一律 409 `exit_unconfirmed`；未知副作用门控（§4.6）、needs_review、禁止自动重放、暂存结局语义全部不变。
- **放弃（显式接受）**：`exited_confirmed` 不再声称、也不得被 UI 表述为「整棵进程树已灭绝的证明」。两次观察之间经 setsid/setpgid/双 fork 派生的未登记后代仍可能以用户权限运行、存活时间无界；普通工作目录命名空间**不是权限隔离**。此类残余按 stray 台账逐次登记披露（found/swept/pending 与证据范围），`none` 不等于不存在；**已发现且未清扫的残余（`pending>0`）视为已知存活者/证据不足，必须否决**，只有未登记且未发现的逃逸后代才不阻塞释放。
- **版本后果**：这是不兼容语义变更，按 V1 总则升 `contractVersion` 为 **`web-api/2`**，全部信封（任务资源、事件、快照、错误、设置、工作根操作、结果读取、SSE 握手帧）统一携带；迁移声明要求见 §14。DDL 零变更；`schema_lineage` 不变。

## 1. 总则

| 项 | 契约 |
|---|---|
| 契约版本 | `web-api/2`；任务资源、事件、快照、错误包络与全部端点响应携带 `contractVersion` 字段。不兼容变更必须升版本并在冻结记录中说明（本次升版原因：§0 退出确认谓词重定义＋新增 `attemptExitEvidence` 有类型证据；V1→V2 逐触点映射见 §15） |
| 传输 | HTTP/1.1 及以上；业务路径前缀 `/api`；请求与响应体为 UTF-8 JSON（SSE 除外）——与 V1 一致 |
| 时间 | ISO 8601 UTC 毫秒——与 V1 一致 |
| 标识 | `taskId`=`tsk_<32hex>`；`operationId`=`op_<32hex>`；`attemptId`=`att_<32hex>`；实例 `epoch`=`inst_<12hex>`；事件 `cursor` 为实例内单调递增整数；SSE 重连令牌 `Last-Event-ID: <epoch>:<cursor>`——与 V1 一致 |
| 会话 | 配对码换短时会话、CSRF、精确 Host/Origin——与 V1 §2 逐字一致，零变更 |
| 幂等 | 提交与迁移类请求携带提交方 `operationId`；同 ID 同规范输入重试返回同一对象当前权威状态——与 V1 一致；规范输入含 `type`、`role`、规范化后的 `input` 与 `configRevision`（V2 不改变提交语义；候选直改幂等台账属 D/MAYNE-33 范围，不在本文） |
| 响应丢失 | 异步操作一律可按 ID 读回——与 V1 一致 |
| 错误包络 | `{"contractVersion":"web-api/2","status":<int>,"error":{"code","message","details"?}}`；错误体一律 JSON，不含内部路径、SQL、堆栈或秘密 |
| 已移除语义 | 无"忙碌丢任务"路径——与 V1 一致 |

## 2. 会话、配对与跨源边界

与 V1 §2 **逐字一致，零变更**（`/api/pair`、`/api/session`、CSRF/Origin、代理信任边界、`proxy_trust_invalid`）。本文不重复其正文。

## 3. 任务资源与状态机

### 3.1 任务资源字段

`GET /api/tasks/{taskId}` 与所有任务类响应共用的资源形状（样例：[task-resource-running.json](../../tests/fixtures/web-contract-v2/task-resource-running.json)）。相对 V1 的字段差异只有两处：`contractVersion` 值变为 `web-api/2`；新增 `attemptExitEvidence`（有类型退出证据）。其余字段名称、类型、出现规则与 V1 逐字一致：

| 字段 | 类型 | 说明 |
|---|---|---|
| `contractVersion` | string | 恒为 `web-api/2` |
| `taskId` / `operationId` | string | 同 V1 |
| `type` / `role` | string | 同 V1（类型集合由 W1+ 切片扩充；未知类型提交即 400） |
| `state` | enum | 同 V1 §3.2（`queued`/`running`/`cancelling`/`succeeded`/`failed`/`cancelled`/`interrupted`/`needs_review`） |
| `version` | int | 任务乐观并发版本；每次状态迁移递增——同 V1 |
| `createdAt` / `updatedAt` / `terminalAt` | string | 同 V1；`terminalAt` 仅终态非空 |
| `submitSeq` / `queuePosition` | int / int\|null | 同 V1 |
| `attemptCount` / `attemptId` | int / string\|null | 同 V1；每 attempt 只启动一次 worker；attemptCount 由调度认领时点的事实派生（读侧计数 `task_attempts` 行），202 响应不承诺 +1 |
| `attemptExitState` | enum | `not_started` \| `active` \| `exiting` \| `exited_unknown` \| `exited_confirmed`：当前 attempt 的**登记域退出确认状态**。枚举值集合与 V1 相同；`exited_confirmed` 的确认谓词为**登记域退出确认（§3.2.1）**，是 `registry_extinct` 有类型证据的收敛判定，**不构成进程树完整灭绝证明**。槽位占用跟随该字段而不是业务状态；`resolve` 在 `exited_unknown` 下一律拒绝 |
| `attemptExitEvidence` | object \| null | **V2 新增**。当前 attempt 的有类型退出证据，结构见 §3.1.1。`attemptExitState ∈ {not_started, active, exiting}` 时恒为 `null`；`exited_unknown`/`exited_confirmed` 时非空，并随任务资源生命周期保留（终态不清除） |
| `cancelIntent` | bool | 同 V1 |
| `configRevision` / `originalConfigRevision` | string | 同 V1 |
| `inputRef` | object | 同 V1（不可变输入引用，不含秘密） |
| `progress` | object \| null | 同 V1（仅展示）；`resultPendingExit=true` 或 `cancelling` 期间的展示文案必须使用 §3.1.2 的诚实措辞 |
| `result` | object \| null | 同 V1：仅终态可见，唯一例外（`cause=result_exit_unconfirmed` 且 `attemptExitState=exited_confirmed` 的暂存成功结局可见、可经结果端点读取）不变；`payloadRef` 的 `result://<attemptId>/<name>` scheme 不变——**attemptId 绑定是 V2 的归因纪律要求（§9）** |
| `resultPendingExit` | bool | 同 V1：结局已暂存但登记域退出未确认；`state` 仍 `running`、`result`/`failure` 均为 null、槽位不释放；**结果上报不构成退出确认** |
| `failure` | object \| null | 同 V1（含 `sideEffectSafety`，§4.6 语义零变更） |
| `recovery` | object \| null | 同 V1 §3.5 的 discriminated union；`itemVersion`/`receipts` 的权威出现规则见 §3.5.1（V2 显文化已审修订） |

### 3.1.1 `attemptExitEvidence` 对象规范（V2 新增，规范性）

所有成员除标注可空外**必须出现**；客户端不得依赖所在取值未声明的成员：

| 成员 | 类型 | 说明 |
|---|---|---|
| `verdict` | enum | `"registry_extinct"` \| `"unresolved"`：登记域退出判定的收敛结果 |
| `workerExited` | bool | worker 进程退出已观察 |
| `groupAbsent` | bool | `kill(-pgid, 0)` 返回 ESRCH（进程组已不存在）；观察请求本身失败（如 EPERM）不得记为 `true` |
| `registry` | object | `{total: int≥0, confirmedExtinct: int≥0, unobservable: int≥0, survivors: registrySurvivor[]}`：该 attempt **注册进程集**（按帧来源＋存活期身份登记，§9）的逐成员核对结果。`survivors` 只收录**按身份匹配仍存活**的成员；既未能确认死亡也未能观察存活的成员计入 `unobservable`。恒等式：`total = confirmedExtinct + unobservable + survivors.length` |
| `registry.survivors[]` | object | 每项 `{pid: int, identity: string, evidence: string}`：帧来源＋存活期身份描述与存活证据摘要 |
| `argvScan` | object \| null | `{"performed": true, "hits": int≥0}`（已执行，命中数）\| `{"performed": false, "hits": 0}`（执行失败，含被 OS 以 EPERM 拒绝）\| `null`（本轮未执行）。**仅补充信号**：`hits>0` 必须否决（§3.1.1 不变式 3）；`hits=0` 不单独证明任何方向；`performed=false` 或 `null` 必须否决（不变式 1/3），不得跳过该项检查 |
| `veto` | object | `{triggered: bool, reason: "known_survivor"\|"insufficient_evidence"\|"identity_mismatch"\|"eperm"\|null, detail: string\|null}`：已知存活者/证据不足/身份不匹配/EPERM 否决。`triggered=false` 当且仅当 `verdict="registry_extinct"`，此时 `reason`/`detail` 为 `null` |
| `residual` | object | `{treeExtinctProven: false, scope: "registry_domain", strayLedger: {found: int≥0, swept: int≥0, pending: int≥0} \| null}`：**`treeExtinctProven` 恒为字面量 `false`**（规范性常量；任何实现不得输出 `true`）。`strayLedger` 为该 attempt 的 stray 台账披露（found=已发现、swept=已清扫、pending=已发现未清扫），`null` = 本 attempt 尚无台账清扫记录；清扫由恢复扫描逐次执行并登记，`none/pending` 都是台账记录，**`pending>0` 必须否决**（§3.1.1 不变式 1/3：已发现未清扫＝已知存活者或清扫/身份核实不足），不得释放槽；`swept` 计数已清扫（确认死亡）的残余；`found=0` 不等于不存在未登记逃逸后代，仍须披露 |
| `confirmedAt` | string \| null | ISO 8601；非空 ⇔ `verdict="registry_extinct"` |

**不变式（规范性，逐条可测）**：

1. `verdict="registry_extinct"` ⇔ `workerExited=true ∧ groupAbsent=true ∧ registry.survivors=[] ∧ registry.confirmedExtinct=registry.total ∧ registry.unobservable=0 ∧ argvScan.performed=true ∧ argvScan.hits=0 ∧ (residual.strayLedger=null ∨ residual.strayLedger.pending=0) ∧ veto.triggered=false ∧ confirmedAt≠null`。
2. `verdict="unresolved"` ⇔ 不变式 1 的条件不全部成立；`veto.triggered=true ∧ veto.reason≠null ∧ confirmedAt=null`；`attemptExitState="exited_unknown"` 的资源上 `verdict` 必为 `"unresolved"`。可表达阻塞面（至少一项成立，且与 `veto.reason` 对应）：`workerExited=false`、`groupAbsent=false`、`registry.survivors` 非空、`registry.unobservable>0`、`argvScan=null`、`argvScan.performed=false`、`argvScan.hits>0`、`residual.strayLedger.pending>0`。不得把组/argv 观察失败伪记为某个登记成员不明。
3. `argvScan.hits>0` ⇒ `verdict="unresolved"` 且 `veto.reason` ∈ `known_survivor`/`insufficient_evidence`（命中身份可匹配→`known_survivor`；不可归因→`insufficient_evidence`；argv 命中只补充、不能单独确认，也不能被忽略）。`argvScan=null` ⇒ `veto.reason="insufficient_evidence"`；`argvScan.performed=false` ⇒ `veto.reason` ∈ `insufficient_evidence`/`eperm`（通用失败→`insufficient_evidence`；扫描请求被操作系统拒绝→`eperm`，EPERM 优先于通用证据不足）。`argvScan.performed=true ∧ argvScan.hits=0` 是 `registry_extinct` 的必要条件之一，不单独证明完整树。
4. `residual.treeExtinctProven` 恒为 `false`；派生面（UI、SSE、快照）不得引入把 `registry_extinct` 表述为树灭绝/完整退出的字段或文案（§3.1.2）。
5. 槽位释放 ⇔ `verdict="registry_extinct"`；`verdict="unresolved"` 的 attempt 占槽（§3.2 槽位核算）。
6. `verdict` 迁移只有一条方向：`"unresolved" → "registry_extinct"`，且仅发生在运行期确认或恢复扫描重验（§3.4）通过时；`"registry_extinct"` 不可逆。

### 3.1.2 状态与证据的用户可见文案（规范性建议值）

| `attemptExitState` | 状态标签 | 必备伴随文案语义 |
|---|---|---|
| `not_started` | 未运行 | — |
| `active` | 运行中 | — |
| `exiting` | 正在退出 | 不得显示任何终局结果 |
| `exited_unknown` | 退出未确认 | 必须显示占槽事实（如「占 1 个执行槽，等待系统核实退出」）；不得显示"已完成/已失败"；`resolve` 入口禁用（409 面，§4.5） |
| `exited_confirmed` | 退出已确认（登记域） | 必须可展开诚实细节：「已确认登记进程集全部退出；不证明全部后代进程已退出」，残余按 `attemptExitEvidence.residual` 披露 |

**禁用文案（规范性禁止）**：任何把 `exited_confirmed`/`registry_extinct` 表述为「进程树已全部退出」「完整退出已证明」「无残余」「已证明灭绝」的用户可见字符串。`needs_review` + `exited_unknown` 行必须呈现「退出未知·待系统核实」类措辞，不得暗示终局。

### 3.2 状态集合与迁移

状态集合、终态集合与 V1 相同：`queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`、`interrupted`、`needs_review`；终态 `succeeded`/`failed`/`cancelled`。迁移表逐行给出（Δ 标注相对 V1 的改动行；未标注行与 V1 逐字同义，仅谓词含义随 §3.2.1 更新）：

| 当前态 | 事件 | 次态 | 守卫与边界 |
|---|---|---|---|
| —（新建） | `POST /api/tasks` 接收 | `queued` | 短事务保存；202 才算接收；`attemptExitState=not_started`、`attemptExitEvidence=null` |
| `queued` | 调度器领取（原子条件更新） | `running` | 占一个执行槽；事务内写入 `attemptId` + 实例 epoch；`attemptExitState=active`、`attemptExitEvidence=null`；attempt 行在领取事务内登记 |
| `queued` | 取消（事务内条件更新） | `cancelled` | 与领取竞争恰有一个胜出（场景 5/6）；`attemptExitState=not_started`、`attemptExitEvidence=null` |
| `running` | 当前 attempt 提交结果 | `running`（`resultPendingExit=true`） | 结果暂存；仅接受 `attemptId` 与 epoch 都匹配的结果；晚到结果记审计事件；`result` 不可见；**槽位不释放**（场景 24） |
| `running`（`resultPendingExit=true`） | **登记域退出确认成立**（§3.2.1，Δ） | `succeeded` / `failed` | `attemptExitState=exited_confirmed`、`attemptExitEvidence.verdict="registry_extinct"`；**释放槽**；**提交原暂存结局**，与终态在同一事务提交后才可见（场景 24/31）；**终态不早发布**：确认前任何读取不得见到终态或终态结果 |
| `running`（`resultPendingExit=true`） | **登记域退出确认不成立（含证据不足/已知存活者否决/身份不匹配/EPERM）**（Δ） | `needs_review` | `attemptExitState=exited_unknown`、`attemptExitEvidence.verdict="unresolved"`（否决原因入 `veto`）；**槽位保持占用**；保留已暂存结局（含成功/失败判别）；`cause=result_exit_unconfirmed`、`cancelIntent=false`；`resolve` → 409 `exit_unconfirmed`（场景 24/29/31） |
| `running` | 取消（先持久取消意图） | `cancelling` | 再停止 worker/工具树；`attemptExitState=exiting`、`attemptExitEvidence=null`；槽不释放；不显示"已取消"（场景 6） |
| `cancelling` | **登记域退出确认成立**且无未知副作用（Δ） | `cancelled` | `attemptExitState=exited_confirmed`、证据 `registry_extinct`；释放槽 |
| `cancelling` | **登记域退出确认成立**但副作用未知（Δ） | `needs_review` | `attemptExitState=exited_confirmed`；**释放槽**（登记域已确认退出）；`cancelIntent` 保持 true；不得自动重入队（场景 9） |
| `cancelling` | **登记域退出确认不成立**（Δ） | `needs_review` | `attemptExitState=exited_unknown`、证据 `unresolved`；**槽位保持占用**；`resolve` 一律 409 `exit_unconfirmed`；不得补发新 worker；仅新实例恢复扫描重验登记域谓词成立后释放（§3.4，场景 19） |
| `running` | 后端重启，旧 worker **登记域确认退出**，无未知副作用（Δ） | `interrupted` | 由恢复扫描处置（§3.4，场景 8）；`attemptExitState=exited_confirmed` |
| `running` | 后端重启，外部副作用结果不明 | `needs_review` | `attemptExitState=exited_confirmed`；保留输入与已知回执；禁止自动重放 |
| `needs_review`（`exited_unknown`，`cancelIntent=true`） | 新实例恢复扫描**重验登记域退出谓词成立**（Δ） | `cancelled` / `needs_review` | 释放槽；重验通过后执行 stray 台账清扫登记（§3.4）；台账证明无副作用 → `cancelled`；否则 `cause` 迁移为 `cancel_unknown_side_effect` 并补 `decisionOptions`（§3.4，场景 19/28） |
| `needs_review`（`exited_unknown`，`cancelIntent=false`，`resultPendingExit=true`） | 新实例恢复扫描**重验登记域退出谓词成立**（Δ） | `succeeded` / `failed` / `needs_review` | 台账证明无未知副作用 → **提交原暂存结局**（释放槽）；否则保持 `needs_review`（暂存结局转为可见、补 `decisionOptions`），`resolve(resume)` 提交原结局、`resolve(cancel)` → `cancelled`（§3.4，场景 29/31） |
| `needs_review`（`exited_unknown`，`cancelIntent=false`，`resultPendingExit=false`） | 新实例恢复扫描**重验登记域退出谓词成立**（Δ） | `queued` / `needs_review` | 台账证明无副作用且可安全重跑 → 有界重入队（**新 attempt、新命名空间**，§9）；否则保持 `needs_review`（`cause=exit_unconfirmed`，补 `decisionOptions`）（§3.4，场景 30） |
| `interrupted` | 恢复扫描判定可安全重跑 | `queued` | 同 V1：类型/工具记录证明无外部副作用或仅发送前副作用，且重试预算未耗尽 |
| `interrupted` | 恢复扫描判定未知或预算耗尽 | `needs_review` / `failed` | `failed` 时 `failure.code=worker_lost`、`retryable=manual` |
| `failed` | 自动重试（`auto_backoff` 到期**且** `sideEffectSafety=proven_safe`）或用户 `retry` | `queued` | 同 V1：有界退避；安全证明缺失不得自动重入队（场景 20） |
| `failed` | `auto_backoff` 但 `sideEffectSafety` 非 `proven_safe` | `needs_review` | 同 V1（场景 20） |
| `needs_review` | `resolve(decision=resume)` 且回执核对完成、`attemptExitState=exited_confirmed` | `queued` | 同 V1：仅用户显式；条目版本与 ACK 门见 §3.5.1/§4.5 |
| `needs_review` | `resolve(decision=cancel)` | `cancelled` | 同 V1：仅用户显式 |
| 终态 | 同 `operationId` 重放 / 晚到结果 | 不变更 | 幂等返回当前态；晚到结果以事件留痕，不入账 |

- **queued 取消/领取竞争、`expectedVersion` 可选语义**：与 V1 §3.2 尾注逐字同义（严格校验 409 `version_conflict` / best-effort 条件更新，场景 6/7）。
- **槽位核算（Δ）**：**槽位跟随 attempt 的登记域退出确认，不跟随业务状态**。`attemptExitState ∈ {active, exiting, exited_unknown}` 各占一个执行槽；`attemptExitEvidence.verdict="registry_extinct"`（即 `exited_confirmed`）与 `not_started` 释放槽；**判定不成立（`unresolved`）不得释放**。`needs_review` 若为 `exited_unknown` 仍占槽，调度器不得补发；`queued`/终态不占槽；`resultPendingExit=true` 期间占槽——结果上报不是退出确认。
- **暂存信封**：与 V1 同义：`resultPendingExit=true` 期间保存 `{outcome: "succeeded"|"failed", result?, failure?}`，对外 `result`/`failure` 均为 null；登记域确认、恢复扫描回收与用户 `resolve(resume)` 均**提交原暂存结局**，不因退出确认时序改变成功/失败判别（场景 31）。
- 没有 `RUNTIME_BUSY` 状态，也没有"忙碌拒绝提交"路径。

#### 3.2.1 登记域退出确认谓词（`registry_extinct`，规范性定义）

> **登记域退出确认**：attempt 的 worker 进程已退出，且其所属进程组已不存在（`kill(-pgid, 0)` → ESRCH），且该 attempt **注册进程集**逐成员按帧来源＋存活期完成身份匹配的死亡确认，且 argv 扫描已执行且无命中（`argvScan.performed=true ∧ hits=0`，仅补充信号；未执行/失败均不满足）。此条件成立记为 `registry_extinct`，对应 `attemptExitEvidence.verdict="registry_extinct"`；它是**有类型证据的收敛判定，不构成整棵进程树已灭绝的证明**——两次观察之间经 setsid/setpgid/双 fork 派生的后代仍可能存活（残余进程以用户权限运行、存活时间无界，按 stray 台账与吊销责任披露，§9）。
>
> **否决（veto）**：出现下列任一情形，判定不成立，attempt 保持 `exited_unknown` 占槽——①注册集内存在按身份匹配仍存活的成员（`known_survivor`）；②任一成员既不能确认死亡也不能观察存活、或组观察不可得（`insufficient_evidence`）；③注册成员身份匹配失败、无法完成 proof-matched 核对（`identity_mismatch`）；④观察/清扫请求被操作系统拒绝（`eperm`）。argv 扫描命中按 ①/② 口径否决（命中身份可匹配→`known_survivor`；不可归因→`insufficient_evidence`）；argv 扫描未执行或失败按 ② 口径否决（未执行或通用失败→`insufficient_evidence`；因操作系统拒绝导致的失败按 ④ 口径记 `eperm`，EPERM 优先）；stray 台账 `pending>0`（已发现未清扫/已确认存活/清扫核实不足）按 ①/②/④ 口径否决；**任何已知存活者或证据不足均否决，不得以"多数成员已确认"或超时推定放行**。
>
> **释放与发布（B(a) 发布政策）**：`registry_extinct` 成立即释放槽位；在其它守卫（§3.2 暂存信封、§4.6 副作用门控）同时满足时提交原暂存结局/终态。**未登记且未发现的逃逸后代不阻塞释放**（无法证明其不存在），但必须经 stray 台账逐次披露（§3.1.1 `residual`）——这是 owner 批准 B(a) 时显式接受的保证取舍；**已发现且存活/清扫核实不足的残余（`strayLedger.pending>0`）必须否决**，不得释放槽；任何验收措辞不得把此类逃逸写成"已证明树灭绝"。

### 3.3 幂等、版本与 attempt/epoch fencing

- 提交幂等、规范输入、`replayed:true`、`idempotency_conflict`：与 V1 逐字同义。
- **三类版本不可混用（沿已审修订显文化，不倒退）**：**任务版本**（`retry` 严格、取消可选）、**条目版本**（`resolve`/hold 条目 `resolve` 的 `expectedVersion` = 权威 `recovery_items.version`）、**设置版本**（并发调整的 `expectedVersion` = `GET /api/settings/agent-concurrency` 返回的 `version`）。过期一律 409 `version_conflict`。同 ID 重放不消耗版本。
- **条目与回执的权威来源（V2 规范性，消除 V1 实现期的缺省回退）**：`recovery.itemVersion` 与 `recovery.receipts` 只来自权威存储（`recovery_items` 行与 attempt 的 `side_effect_receipts` 行），**不得从任何客户端镜像字段缺省推导**；不存在"缺省为 1"或"缺省为空数组"的有效 CAS/ACK。权威行缺失或存在多条待核对行（歧义）时，线域**不出现** `itemVersion` 成员（可见信号），两个 resolve 入口都拒绝处置（§3.5.1、§4.5）。客户端规则同口径：`itemVersion` 必须为正整数、`receipts` 必须为数组才允许发起处置；缺失/形状不符 → 入口禁用 + 围栏重读，**缺失不等于 1、不等于空**。
- fencing：结果仅被"当前 attempt"接受（`attemptId` + `epoch` + 状态可接受）；晚到结果 `rejected_late_result` 留痕——与 V1 同义。
- 自动重入队守卫、取消不是副作用撤销：与 V1 同义。

### 3.4 重启与恢复扫描

- 后端重启：`queued` 全部保留；新实例必须先清理/核实上一实例所属 worker 及其登记进程集（登记域口径），无法核实则暂停调度并暴露原因，不得按默认并发直接开工——与 V1 同义。
- 上次 `running` 的 attempt 记为 `interrupted`，随后逐任务扫描：可证无外部副作用 → 有界重入队；副作用未知 → `needs_review`，禁止自动重放——与 V1 同义。
- **重启时有取消意图的（Δ）**：保留 `cancelling`/`cancelIntent`，**登记域退出谓词重验成立**且无副作用未知后才置 `cancelled`；不成立则保持取消意图并置 `needs_review`。
- **`exited_unknown` 回收（Δ）**：新实例启动时扫描所有 `attemptExitState=exited_unknown` 的 attempt：**重验登记域退出谓词（§3.2.1），成立后**把该字段改为 `exited_confirmed`、`attemptExitEvidence.verdict="registry_extinct"`（带新 `confirmedAt`），**释放槽位**，并**重执行 stray 台账清扫登记**（清扫结果更新该 attempt 的 `residual.strayLedger` 与台账文件，实现面）。重验不成立（含否决）→ 保持 `exited_unknown` 占槽。`recovery` 按真实取消意图与暂存结果分支，三分支语义与 V1 逐字同义（取消路径 / 非取消+结果已暂存 / 非取消+无暂存结果）。回收完成前，调度器不得把该槽位分配给新任务，用户 `resolve` 不得绕过退出确认（场景 28/29/30）。
- **重启扫描是独立预期**：恢复扫描必须重验谓词与重跑清扫，不得把"上次已判"当作本次证据；清扫逐次登记 found/swept/pending 与证据范围。

### 3.5 `recovery` 对象结构（按 `cause` 的 discriminated union）

基础字段、cause 表、附加字段与 V1 §3.5 逐字同义（`backend_restart`/`restart_unknown_side_effect`/`cancel_unknown_side_effect`/`cancel_exit_unconfirmed`/`result_exit_unconfirmed`/`exit_unconfirmed`/`failure_unknown_side_effect`/`backup_restore`/`root_activation`/`root_import`；样例：[task-interrupted.json](../../tests/fixtures/web-contract-v2/task-interrupted.json)、[task-needs-review.json](../../tests/fixtures/web-contract-v2/task-needs-review.json)、[task-needs-review-exit-unconfirmed.json](../../tests/fixtures/web-contract-v2/task-needs-review-exit-unconfirmed.json)、[task-needs-review-exit-reclaimed.json](../../tests/fixtures/web-contract-v2/task-needs-review-exit-reclaimed.json)、[task-recovery-backup-restore.json](../../tests/fixtures/web-contract-v2/task-recovery-backup-restore.json)）。

#### 3.5.1 权威条目版本与 ACK 规则（V2 显文化，规范性）

- **凡列明 cause 必带权威 `itemVersion`（当且仅当权威行存在且无歧义）**：`recovery.itemVersion` 映射 `recovery_items.version`；`attemptExitState=exited_confirmed` 的可处置形态**同样必须暴露**权威 `itemVersion`（V1 文本未言明的实现偏差已由已审修订 d70280c 闭合，V2 将其定为规范）。权威行缺失或多条待核对（歧义）→ 线域**不出现**该成员，`resolve` 拒绝（`state_conflict`），歧义状态不得暗中按"最新行"放行。
- `decisionOptions` **仅在 `attemptExitState=exited_confirmed` 时出现**；`exited_unknown` 时 `resolve` 一律 409 `exit_unconfirmed`（唯一例外：`result_exit_unconfirmed` 回收后的可见暂存 `result`，与 V1 相同）。
- `recovery.receipts` 是权威回执数组（元素结构同 §12 `side_effect_receipts`）；空数组是合法事实（无待核对回执），**字段缺失或非数组不是空数组**（§4.5 ACK 门）。
- `backup_restore`/`root_activation`/`root_import` 的 `autoResume` 恒为 `false`；hold 关闭前不参与调度——与 V1 同义。
- 任务 `resolve` 与 hold 条目 `resolve` 是同一操作、同一版本守卫；处置成功后任务与条目版本同事务递增；`verification_state ∈ {resumed, cancelled}` 不可被旧请求改写——与 V1 同义。

## 4. 任务 API

端点表与 V1 §4 逐字同义（`POST /api/tasks`、`GET /api/tasks/{taskId}`、`GET /api/tasks`、`GET /api/tasks/{taskId}/result`、`POST /api/tasks/{taskId}/cancel`、`POST /api/tasks/{taskId}/retry`、`POST /api/tasks/{taskId}/resolve`；错误码与样例映射不变，样例目录换为 [tests/fixtures/web-contract-v2/](../../tests/fixtures/web-contract-v2/task-submit-202-queued.json)）。V2 显文化条目：

### 4.1 提交与幂等
与 V1 逐字同义：提交体不含秘密、`configRevision` 必须存在、页面关闭不取消任务。

### 4.2 查询
与 V1 逐字同义：全字段资源、`submitSeq` 稳定分页、`?operationId=` 读回。

### 4.3 结果读取（提交 → 用户看到结果的闭环）
与 V1 逐字同义（内联/索引/分段协议、`outcome`/`failure` 公共判别、读取白名单、错误码、`result://` scheme 不得客户端拼接；场景 25 不变）。V2 补充两点归因纪律（语义不变，显文化）：
- `result://<attemptId>/<name>` 的 **attemptId 绑定是强制的归因纪律**：产物引用必须携带产生它的 attemptId（§9）；attempt 命名空间永不复用，因此引用无歧义。
- 白名单判定所依赖的 `attemptExitState=exited_confirmed` 在 V2 中按 §3.2.1 登记域谓词解释；"待核对先读后处置"（场景 32/33）行为不变。

### 4.4 取消与版本
与 V1 逐字同义（`expectedVersion` 可选、竞争时序、取消不撤销外部副作用、`cancelling` 期间槽位不释放）。

### 4.5 重试与处置
`retry` 全部规则与 V1 逐字同义（`configRevision` 变更白名单、预算重置、409 语义）。`resolve` 沿已审修订显文化：
- `needs_review` 且 `attemptExitState=exited_unknown` → 409 `exit_unconfirmed`（必须先由恢复扫描重验确认，§3.4）——与 V1 同义。
- `expectedVersion` 为**条目版本**，必须等于权威 `recovery_items.version`；任务条目与 hold 条目入口同规则（场景 27）。**不得实现任何缺省值**：请求携带的 `expectedVersion` 缺失/非正整数 → 400 `validation_failed`；权威行缺失 → 409 `state_conflict`；歧义（多条待核对）→ 409 `state_conflict`，不得静默按最新行处置。
- `acknowledgedReceipts` 必须是回执 id **字符串数组**；非数组/非字符串成员 → 400 `validation_failed`（不得子串匹配、不得静默改形）。`decision=resume` 时必须覆盖权威回执中全部 `verifiable=true` 条目，否则 400（不得空回执回退）；`decision=cancel` 不要求回执确认。
- 条目已处置（`resumed`/`cancelled`）→ 409 `state_conflict`。
- `retry` 与 `resolve` 是仅有的用户驱动重入队路径；`needs_review` 没有"自动恢复"——与 V1 同义。

### 4.6 任务级失败码（`failure.code`）

**与 V1 逐字一致，零变更**：六类失败码、`retryable` 三值、`sideEffectSafety ∈ proven_safe|unknown|proven_unsafe`、"失败码本身不构成副作用安全证明"、未知副作用转 `needs_review` 与禁止自动重放规则全部保留。B(a) 改变的是**退出证据的依据**（死亡证明 → 登记域判定＋台账归因），不改变本节任何判定或路由；不因 E 批准自动重发，也不以"有错误码"当安全证明。

## 5. 并发配置

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/settings/agent-concurrency` | GET | 返回 `{contractVersion, agentConcurrency, default, version, runningCount, queuedCount}`；`version` 为**设置自身版本**（样例 [settings-concurrency.json](../../tests/fixtures/web-contract-v2/settings-concurrency.json)） |
| `/api/settings/agent-concurrency` | PUT | `{agentConcurrency, expectedVersion}` → 200；`expectedVersion` 校验**设置版本**；校验正整数否则 400 `validation_failed`；不匹配 409 `version_conflict` |

- 默认 3；实例级设置，持久保存；上调立即补发空槽、下调待自然退出；变更以 `settings.changed` 事件广播；不影响任务 `version`——与 V1 同义。
- **并发 CAS 以设置端点真实 `version` 为准**：快照 `settings.version` 与设置端点 `version` 同源（同一设置行，§6）；快照顶层兼容附加字段 `agentConcurrency`（§6）**不得**作为 CAS 输入。
- **补发计数只统计已释放的槽（Δ 措辞）**：`attemptExitState=exited_unknown`（判定不成立）的 attempt 仍占槽，不计入可用空槽；`registry_extinct` 判定成立即释放，判定不成立不得释放。

## 6. SSE 事件与高水位快照补偿

| 端点 | 说明 |
|---|---|
| `GET /api/events`（SSE） | 同 V1：只推送已提交变化；心跳注释行；会话过期/代理超时按重连与重认证处理 |
| `GET /api/snapshot` | 全量快照 + 高水位游标；断线补偿入口；**V2 明确同形目标（下述）** |

事件信封（样例 [sse-events-sample.json](../../tests/fixtures/web-contract-v2/sse-events-sample.json)）：

```text
event: task.changed
id: inst_9f27c1aa40b2:1043
data: {"contractVersion":"web-api/2","cursor":1043,"epoch":"inst_9f27c1aa40b2",
       "objectType":"task","objectId":"tsk_1a2b…","objectVersion":3,
       "taskState":"cancelling","attemptExitState":"exiting","at":"2026-11-06T12:31:20.000Z"}
```

- 事件携带实例 `epoch`、实例内递增 `cursor`、对象 `objectVersion` 与 `objectType`/`objectId`；`event` 类型与 `objectType` 集合同 V1（`task.changed`/`task.progress`/`settings.changed`/`workspace.changed`/`recovery.changed`；`task`/`setting`/`workspace`/`recovery_hold`）。
- **`task.changed` 的 `data` 在 V2 新增规范性成员 `attemptExitState`**（值域同 §3.1）：退出确认驱动的状态迁移是 V2 的核心语义，客户端凭它可以不轮询地维护占槽/诚实文案。`task.progress`/`settings.changed`/`workspace.changed`/`recovery.changed` 的 data 形状同 V1。
- 订阅握手、重连令牌、短断线重放、epoch 变化 `stream.reset`、客户端应用规则（epoch 一致、cursor/objectVersion 单调）：**与 V1 逐字同义**。

### 6.1 快照同形目标（V2 规范性；收敛 MAYNE-32 登记的形状分歧）

`GET /api/snapshot` 返回**唯一同形目标**——规范正文、样例与客户端预期以本节为同一形状：

```json
{
  "contractVersion": "web-api/2",
  "epoch": "inst_…",
  "highWatermark": 1042,
  "generatedAt": "2026-11-06T12:32:00.000Z",
  "lastEventId": "inst_…:1042",
  "settings": { "agentConcurrency": 3, "version": 5 },
  "agentConcurrency": 3,
  "workspace": {
    "mode": "local",
    "currentRoot": { "id": "root_…", "label": "…" },
    "capabilities": ["workspace.manage", "workspace.backup"],
    "recovery": null
  },
  "tasks": [ /* §3.1 全字段任务资源（含 attemptExitEvidence） */ ]
}
```

规范性成员与承诺（继承 V1 §6 全部五条散文承诺并逐条保留）：

1. **任务条目与 §3.1 任务资源同形（全字段）**：含 `attemptExitState` 与 `attemptExitEvidence`；快照不得返回裁剪形任务对象。
2. **权威性**：快照包含 `highWatermark` 及之前全部事件的权威状态（游标 N 事件的最终状态必须已体现在 `highWatermark=N` 的快照中），不得返回落后于高水位的对象版本；生成期间的变化按 `cursor > highWatermark` 补发。
3. **重订阅**：客户端以快照返回的 `lastEventId`（`<epoch>:<highWatermark>`）重新订阅；`generatedAt` 为快照生成时间（规范性成员）。
4. **`settings` 嵌套块为规范性成员**（自 V1 冻结样例成员提升）：`settings.agentConcurrency` 与 `settings.version` 与设置端点同源同值（同一设置行）；并发 CAS 使用该 `version`（§5）。
5. **顶层 `agentConcurrency` 为兼容附加字段**：与 `settings.agentConcurrency` **同源同值**（同一设置行的一次读取）；仅为兼容保留，客户端**不得**将它用于 CAS 或当作与 `settings.version` 独立的权威。服务端可省略；出现时两者必须一致（同源不变式）。
6. **`workspace` 嵌套块为规范性成员**：`mode`/`currentRoot{id,label}`/`capabilities`/`recovery` 语义同 V1 冻结样例。
7. **水位优先次序（规范性设计序）**：服务端先确定 `highWatermark` 再分页读取任务（有界分页走完全部页，不以单页截断冒充全量）；该次序是设计级规范，运行期验证（含并发写入下的分页完备性）属后继组合验收。
8. 样例与真实 HTTP 的一致性是**独立验收预期**（后继组合轮以真实 HTTP 核对同形性），本轮样例不冒称已实测。

## 7. 凭据与 provider 能力

与 V1 §7 **逐字一致，零变更**（`GET /api/providers` 形状、引用化凭据、OS 分支、`credential_ref_unsavable`、`credential_unavailable`、前端禁止回读秘密）。样例：[providers-capability.json](../../tests/fixtures/web-contract-v2/providers-capability.json)。

## 8. 受限工作根管理与恢复

§8.1 能力模型、§8.2 端点表与 V1 **逐字一致，零变更**（`workspace.manage` 仅 local、`workspace.backup` 双模式、操作读回统一端点、hold 发现路径）。§8.3 恢复保持步骤中仅第 1 步措辞随谓词更新（Δ）：

1. 打开持久恢复标记（`hold`）：停止新提交（503 `intake_closed`）、停止调度、暂停定时收集/提醒/outbox/补偿投递；**确认旧进程登记域退出（§3.2.1）并重执行 stray 台账清扫登记**、校验恢复数据。
2. –6. 与 V1 逐字同义（隔离为 `needs_review`、逐项核对回执、全部处置完才关闭 hold、`recovery` 取值含 `holdId`/`itemId`、验收锚点）。

## 9. 控制通道与退出/清理

- 宿主控制通道、正常关停顺序：与 V1 §9 逐字同义（控制通道独立、不向页面发放；关停三步保队列）。
- worker 生命周期（V2 显文化 B(a) 的实现面义务，公开 API 不变）：
  - **注册进程集（registry）**：worker 启动帧（`worker start`）与工具宿主帧（`mcp owner` 等）登记归属；存活期内以递归 ppid 链登记派生后代；登记挂接 cancel/deadline/stopAll/退出钩子。登记是**最佳努力**，不承诺任何派生后代必被登记；未登记逃逸按 stray 台账披露。登记数据落 attempt 工作区台账文件（实现面，`runs/<runId>/worker.json`），**无 DDL**。
  - **attempt 命名空间永不复用**：新 attempt 使用新命名空间；产物引用绑定 `attemptId`（§4.3）。这是**归因与清扫对象纪律，不是 OS 权限隔离**：不得声称幸存者只能影响已退役目录。
  - **stray 台账**：每次恢复扫描（及确认时的补充清扫）逐次登记 found/swept/pending（含证据范围）；台账是**审计面**，不是完整性声明；`none`（found=0）不等于不存在。**`pending>0` 必须否决释放**；未登记且未发现的逃逸后代以用户权限运行、存活时间无界，按台账与吊销责任披露。
  - 已登记幸存者的 proof-matched 清扫：先按身份匹配再清扫；身份不匹配或 EPERM 记录为否决/失败，不得静默跳过或改写为已清扫。
  - `verifyTree` 类核实收窄为"组＋注册集已核实灭绝"；`true` 不得当树完整性发布（与 §3.2.1 同口径）。
- 下一实例拿到根锁不等于旧 worker 已停；启动前必须清理/核实，无法核实则暂停调度——与 V1 同义。

## 10. 错误码注册表

错误包络携带 `contractVersion: "web-api/2"`。**错误码集合、HTTP 状态、触发条件与客户端处置和 V1 §10 逐字一致，零变更**（含 `exit_unconfirmed` 的触发与处置）。仅 `exit_unconfirmed` 的示例消息按诚实文案更新（Δ 措辞，语义不变）：

| HTTP | code | 场景 | 客户端处置 |
|---|---|---|---|
| 409 | `exit_unconfirmed` | `attemptExitState=exited_unknown` 时请求 `resolve`（登记域判定未成立，含否决） | 等待恢复扫描重验确认退出（场景 19）；不得重试绕过 |

（其余各行见 V1 §10；V2 不新增、不删除、不改名任何错误码。）

## 11. 契约场景矩阵（提交 → 用户看到结果/错误）

33 个场景编号、触发条件、样例映射与 V1 一致；样例目录为 [tests/fixtures/web-contract-v2/](../../tests/fixtures/web-contract-v2/task-submit-202-queued.json)（48 个 V1 同名文件＋7 个 V2 新增独立否决样例：stray-pending/group-EPERM/group-survivor/argv-hit/argv-not-performed/argv-scan-failed/argv-scan-eperm）。**改动行仅 6/8/9/19/24/28/29/30/31 的"契约行为"列措辞**（登记域谓词口径），其余 24 行与 V1 逐字同义：

| # | 场景 | 触发 | 契约行为（V2 口径；Δ=措辞改动） |
|---|---|---|---|
| 1–5 | 正常提交到结果 / 重复提交 / 幂等冲突 / 满槽 / 取消竞争·取消赢 | 同 V1 | 与 V1 逐字同义（信封 `web-api/2`） |
| 6 | 取消竞争·领取赢（Δ） | 领取先于取消 | 省略 `expectedVersion` → 202 `cancelling`；携带过期版本 → 409 后读回再取消；先持久取消意图再停 worker；**登记域退出确认成立前**槽不释放、不显示已取消 |
| 7 | 过期版本操作 | 同 V1 | 同 V1 |
| 8 | 重启·可安全恢复（Δ） | 后端重启，旧 worker **登记域确认退出**、无未知副作用 | 上次 running → `interrupted`；扫描后有界重入队（新 attempt、新命名空间、新 epoch） |
| 9 | 重启·副作用未知（Δ） | 重启时工具副作用不明，**登记域退出已确认** | `needs_review`（`cause=restart_unknown_side_effect`）：保留输入、已知回执；禁止自动重放；仅 `resolve` 放行 |
| 10–18 | 备份恢复 / 根激活 / 凭据缺失 / 跨源 / 迁移响应丢失 / 代理模式 / SSE 断线补偿 / 并发调整 / 结果读取失败 | 同 V1 | 与 V1 逐字同义（场景 16/17 的快照形状按 §6.1 同形目标；17 的占槽措辞按 §5） |
| 19 | 取消后退出未确认（Δ） | 取消 running 任务，**登记域退出无法确认** | `needs_review` + `attemptExitState=exited_unknown`（证据 `unresolved`，含否决原因），槽位保持占用、不释放；`resolve` → 409 `exit_unconfirmed`；新实例恢复扫描**重验登记域谓词**成立后释放槽并重跑清扫登记 |
| 20–27 | 工具已执行后失败 / 配置修正重试 / 恢复后任务资源 / restore 响应丢失 / 结果已到退出未确认（见 24）/ 超限分段 / 预算耗尽 / 恢复处置版本冲突 | 同 V1 | 与 V1 逐字同义（24 见下；27 的条目版本守卫按 §3.5.1 权威规则） |
| 24 | 结果已到、退出未确认（Δ） | attempt 提交结果，但**登记域退出未确认** | 任务保持 `running`、`resultPendingExit=true`、`result` 不可见、**槽位不释放**；登记域判定不成立则转 `needs_review`/`exited_unknown`（`cause=result_exit_unconfirmed`、`cancelIntent=false`）；**`registry_extinct` 成立后才提交原暂存结局并释放槽**；终态不早发布 |
| 28 | 退出回收后处置（取消路径）（Δ） | `exited_unknown` 被恢复扫描回收 | 恢复扫描**重验登记域谓词成立** → `attemptExitState=exited_confirmed`（证据 `registry_extinct`，清扫结果入台账）、释放槽；`cause` 迁移为 `cancel_unknown_side_effect` 并补 `decisionOptions`；台账证明无副作用时直接 `cancelled`；重验不成立保持占槽 |
| 29 | 结果暂存后回收（非取消）（Δ） | 结果已暂存、退出无法确认，随后回收 | 重验成立后：无未知副作用 → **提交原暂存结果**转 `succeeded`；副作用未知 → 保持 `needs_review`（`result` 可见、补 `decisionOptions`）；残余按台账披露，**`pending>0` 必须否决回收**，只有未登记且未发现的逃逸后代不阻塞 |
| 30 | 无暂存结果退出未知（Δ） | 运行中退出无法确认且无暂存结果，随后回收 | 重验成立且台账证明无副作用且可安全重跑 → 有界重入队（新 attempt、新命名空间）；否则保持 `needs_review`（`cause=exit_unconfirmed`、`cancelIntent=false`）；**已知注册幸存者否决时不得回收** |
| 31 | 暂存失败被回收（Δ） | 暂存**失败**结局后退出无法确认并被回收 | 回收与 `resolve(resume)` 均提交**原失败结局**（登记域谓词口径下同 V1 语义），不因退出时序改为成功 |
| 32–33 | 待核对的成功/失败结局先读取后处置 | 同 V1 | 与 V1 逐字同义（读取白名单的 `exited_confirmed` 按 §3.2.1 解释） |

**W1 冻结旅程验收措辞（B(a) 口径，规范性）**：取消/退出核实步骤按**登记域退出谓词**放行；stray 台账逐次清扫披露 found/swept/pending 与成员身份；**`pending>0` 视为已知存活者/证据不足，必须否决**；只有未登记且未发现的逃逸后代按台账接受；任何验收记录不得写成"逃逸已证明树灭绝"（E1 类逃逸在 B(a) 下是登记域残余，不是树灭绝证据）。

## 12. 数据结构提案（逻辑字段；非 DDL）

与 V1 §12 同性质的提案层；V1 各对象字段与提案内容**全部保留**（`tasks`/`task_attempts`/`task_events`/`side_effect_receipts`/`workspace_operations`/`recovery_holds`/`recovery_items`/`settings`/`instance_epochs`；schema/migration 建议、WAL、条件 UPDATE fencing、索引建议不变）。V2 新增两个提案对象（实现面落 attempt 工作区台账文件，**无 DDL**；表名/类型由实施切片定案）：

| 对象（拟） | 逻辑字段（拟） | 说明 |
|---|---|---|
| `attempt_registry` | `attempt_id`、`epoch`、`entries`（成员数组：`pid`、`identity`、`source_frame`、`registered_at`、`lifetime_span`）、`updated_at` | 注册进程集：帧来源＋存活期身份；`attemptExitEvidence.registry` 的数据基础；挂接 cancel/deadline/stopAll/退出钩子更新 |
| `stray_ledger` | `attempt_id`、`sweep_seq`、`swept_at`、`found`、`swept`、`pending`、`members`（身份与证据摘要）、`evidence_scope`（恒 `registry_domain`） | stray 台账：每次恢复扫描（及确认时补充清扫）逐次追加一行；审计面，非完整性声明；`attemptExitEvidence.residual.strayLedger` 取最近一次（或聚合）披露 |

- `task_attempts` 增补提案字段：`exit_verdict`（`registry_extinct`/`unresolved`/NULL）、`exit_evidence`（JSON 快照，与线域 `attemptExitEvidence` 同形）。**DDL 零变更**：001/002/003 冻结不动；上述对象本轮不落 DDL，D 的 `004` 属 MAYNE-33、不在此。
- 命名空间纪律（提案，规范性）：attempt 工作区目录名含 `attemptId` 且永不复用；产物引用携带 `attemptId`。

## 13. 依赖清单

与 V1 §13 **逐字一致：零新增生产依赖**。登记域实现只用 OS 既有原语（进程组信号、进程表观察、argv 扫描）；不安装 helper/VM/守护，不引入新包。Linux 落地后 pidns 原语可替代本机制（B 的放宽在该平台不必要），属另域演进，不在本契约。

## 14. 冻结与变更流程

- 本文为**候选规范**：独审（未参与者点对点复核）通过后，由队长按 V1 同流程宣布冻结；冻结前不得据本文改生产。
- **升版声明（冻结记录必备）**：`web-api/1` → `web-api/2` 的原因＝§0/§3.2.1 退出确认谓词重定义（不兼容语义变更）＋新增 `attemptExitEvidence`；迁移方式＝信封版本字段整体切换，客户端按 `contractVersion` 判别；V1 文件与 fixtures 冻结保留为历史来源。
- 兼容/不兼容判级同 V1：新增可选字段（如快照顶层 `agentConcurrency`、事件 `attemptExitState` 成员、`attemptExitEvidence` 本身按"随版本切换一次性引入"处理）按兼容处理；未来再改退出语义必须升 `web-api/3`。
- 实现切片接入时，本文的字段/错误/状态/证据表是对应测试断言的**独立预期来源**；实现与契约不一致按缺陷处理，不反向改契约迁就实现（同 V1 §14）。II 套件 T-6 类 SIGKILL 面的期望值改写必须**按 §3.2.1 谓词显式重写判据文本**（成立→放行；不可证→`exited_unknown`），不得仅改期望值签通过；`TERMINAL` 轮询集合与 `needs_review` 观测不变。

## 15. V1 → V2 逐触点映射（规范性对照；行号以冻结 blob `61863271…58d` 为准）

| V1 触点（行号） | V1 现文关键句 | V2 处置 |
|---|---|---|
| :5 头注样例引用 | `web-api/1`＋`tests/fixtures/web-contract/` | 本文头注指向 `tests/fixtures/web-contract-v2/`；V1 文件/样例冻结不动 |
| :11 总则·契约版本 | `web-api/1` | `web-api/2`（§1）；升版原因见 §14 |
| :45 `contractVersion` 字段 | 恒为 `web-api/1` | 恒为 `web-api/2`（§3.1） |
| :54 `attemptExitState` | "进程退出确认状态" | 谓词重定义为登记域退出确认（§3.1/§3.2.1）；枚举值不变；新增 `attemptExitEvidence`（§3.1.1） |
| :75 running 确认行 | "所属进程树退出已确认" | "登记域退出确认成立"（§3.2 行表；释放槽＋提交原暂存结局行为不变；终态不早发布显文化） |
| :76/:80 无法确认行 | "退出无法确认" | "登记域退出确认不成立（含证据不足/否决）"；`exited_unknown` 占槽、resolve 409 语义不变 |
| :83-85 回收分支行 | "恢复扫描确认进程树已退出" | "重验登记域退出谓词成立，并重执行 stray 台账清扫登记"（§3.4） |
| :95/:226 槽位核算 | `exited_unknown` 占槽 | 规则不变；补 "`registry_extinct` 成立即释放，不成立不得释放"（§3.2/§5） |
| :111 重启取消意图 | "确认进程树退出且无副作用未知" | "登记域退出谓词重验成立且无副作用未知"（§3.4） |
| :112 `exited_unknown` 回收 | "核实旧进程树确已退出后改 `exited_confirmed`" | "重验登记域谓词成立后改 `exited_confirmed`（证据 `registry_extinct`）并释放槽位；清扫结果落 stray 台账"（§3.4） |
| :128 `cancel_exit_unconfirmed` | 取消路径退出无法确认 | 同 :76 口径镜像（§3.5） |
| :137 `decisionOptions` 门 | 仅 `exited_confirmed` 出现 | 不变；补权威 `itemVersion` 出现规则（§3.5.1） |
| :167-:173 结果读取信封 | `web-api/1` 字段组 | 信封版本切换；语义零变更；attemptId 绑定显文化为归因纪律（§4.3） |
| :198 `resolve` 门 | `exited_unknown` → 409；ACK 覆盖 | 不变；ACK 形状/无回退显文化（§4.5，沿已审修订） |
| :220 设置端点 | `{contractVersion, agentConcurrency, default, version, …}` | 同形，`web-api/2`；CAS 以设置版本为准（§5） |
| :236-:250 SSE 信封/握手/重连 | `web-api/1` 帧 | `web-api/2`；`task.changed` 增规范性成员 `attemptExitState`；其余同义（§6） |
| :252-:258 快照补偿规则 | 全字段同形/高水位权威 | 全部保留（§6.1 承诺 1–3）；快照同形目标显文化（嵌套 `settings`/`workspace`/`generatedAt` 规范化；顶层 `agentConcurrency` 兼容附加字段同源声明；§6.1 承诺 4–6） |
| :309 错误包络 | `web-api/1` | `web-api/2`；错误码表零变更（§10） |
| :331 `exit_unconfirmed` 错误行 | 等待恢复扫描确认退出 | 不变；措辞按 §3.2.1（§10） |
| :334-:373 场景矩阵 | 33 行 | 编号/触发/样例不变；6/8/9/19/24/28/29/30/31 行为列按登记域口径改写，其余逐字同义（§11） |
| :294 §8.3 hold 第 1 步 | "确认旧进程树退出并校验恢复数据" | "确认旧进程登记域退出并重执行 stray 台账清扫登记、校验恢复数据"（§8.3） |
| §3.2/:102/:121/:136/:386-:389 版本与 ACK 散文 | 任务/条目/设置三类版本；ACK 覆盖 | 与已审修订对齐显文化：权威条目版本、无缺省回退、ACK 形状 400（§3.3/§3.5.1/§4.5）；不倒退到"缺省 1/空回执" |
| §4.6 安全路由 | sideEffectSafety/needs_review | **零变更，明确不动**（§4.6） |
| §12 数据结构提案 | 九对象 | 全部保留；新增 `attempt_registry`/`stray_ledger` 提案与 `task_attempts` 证据字段（§12）；DDL 零变更 |
| §13 依赖清单 | 零新增 | 同（§13） |
| 场景 17 位置说明 | — | 17 不含退出确认措辞；其占槽语义归 §5（与 E 包 §2.2 核对结论一致） |

## 16. 执行边界（本文与 D、SSE 谱系、前端派生面的关系）

- **D（MAYNE-33）**：`004_candidate_operations.sql`、业务写表 15→16、三类候选直改操作族——不在本文范围，不捆绑；实施时若与本文信封版本切换触碰同一文件，按接续表串行（见 [实施接续表](../reviews/web-api-v2-exit-admission-20261111-opencode.md)）。
- **恢复权威已审修订（d70280c）**：§3.3/§3.5.1/§4.5 的权威条目版本与 ACK 规则是对该已审候选行为 contract-level 的显文化，**不是**对其的改写；V2 不倒退到缺省回退。
- **前端/SSE 派生面**：`web-api-client.ts`、前端四文件、SSE 载荷与快照消费按 §6.1 同形目标适配，属另行分派的派生实施；本文只规定线域目标，不预设前端实现。
- **残余披露与吊销责任**：W2 MCP 凭据政策（引用化或显式接受）不在本文，不受 B(a) 批准捆绑；本文只保留 stray 台账披露验收措辞（§9/§11）。
