# MAYNE-24 W1：新暴露三面生产收口（Kimi，2026-11-09）

派工：评论 `01a1bf24-7364-74d7-adb5-8d83e03117d9`（2026-11-09T07:09:59Z）。在 `29305da`（错误帧收口码＋C4 日期点两增量及其记录）之上，以小提交收口 ZCode `6ef1910` 经修正协议夹具暴露的三个**生产缺口**。MAYNE-24 保持 `in_progress`，未 push、未改状态、未提前集成。

## 身份

- 分支 `agent/kimi/mayne-24`，基点 `29305daeff13207e9c75e46b0bb246b041bcdb62`（tree `f91ddf56…`），只在其上新增提交。
- 生产面恰 4 个 `server/lib/` 文件；Rust／DDL／003 冻结哈希／package／守卫／前端／II 套件／Runtime 零差异。
- admission：`build/web-text-intake-implementation/admission.json`（gitignored）。
- 构件：存储二进制 2649408 B／`42af54b5…490fc2`、organizer `08f32db2…`、node `9d050fd4…`，与历次登记逐字节一致；最终证据跑前完整重跑 `npm run build:backend`（bundle server 与源树 `diff -rq` 一致）。

## 增量① staged 候选公开读取不可见（`listCandidates`／`getCandidate`／来源详情）

冻结 P1 §4.3：`staged`＝结果暂存事务内写入、**退出确认前不可见/不可签收**。此前 `listCandidates`（`server/lib/text-intake-service.mjs:453`）无默认排除，running／resultPendingExit 期间 `GET /api/text-sources/:id/candidates` 直接返回 staged 行（ZCode GAP-3×2）。

- `listCandidates` 恒定附加 `status!='staged'`；显式过滤词表收窄为可见状态（`pending`/`accepted`/`discarded`），`?status=staged` 由 200 泄出改为 **400 `validation_failed`**——请求一个任何公开读取都不得返回的状态，拒绝而非 silent 空页。
- `getCandidate`（单候选读取）对 staged 行答 **404 `candidate_not_found`**，不揭示行存在。
- 来源详情内嵌候选本就走 `status='pending'`（不变）；其 previews 子查询同幂追加 `status!='staged'`，把不变量钉在结构上而非偶合上。
- 内部暂存与结果字节原样保留：staging 事务、`result_pending_exit`、暂存行、`commitStagedResume`／发布路径零改动；写路径（编辑／丢弃／修改／签收）仍读原行并由状态守卫拒绝（`dd60976` 钉住的 staged 409 不变）。
- II http 套件 `?status=pending` 两处、I 单测 `status:'pending'` 均不受影响。

## 增量② 晚到结果按冻结 `rejected_late_result` 留独立审计

冻结 web-api/1 §3.3：「晚到结果以事件留痕（`rejected_late_result`），不产生业务写入」。此前 worker-host 对身份不匹配帧静默丢弃、调度器状态栅栏静默返回，`server/` 零该事件（ZCode GAP-4）。

- `task-service.mjs` 新增 `recordRejectedLateResult(taskId, attemptId, reason)`：独立 `task_events` 行，`type='rejected_late_result'`、`object_version` 取**当前版本**（不 +1）、不广播。不产生业务／任务版本变更；不伪造 `task.changed`（payload 只带 `{attemptId, reason}`，无 state）；不存 raw 帧／nonce／秘密。
- `worker-host.mjs` 传输层身份围栏（runId＋hostNonce 不匹配）由静默 `continue` 改为经 `onRejectedFrame` 钩子在**同一有序帧队列**上报告（审计保持到达时序，晚于它的合法帧之后暂存也不会乱序）；帧字节、nonce、载荷不越界。
- `task-scheduler.mjs` 三处栅栏均审计：传输层身份（`attempt_identity`）、结果帧到达时 attempt 已非 active（`attempt_state`）、暂存函数返回 false 即 attempt/epoch 归因失败（`attempt_or_epoch`）。审计写失败只记 stderr，不影响接受路径（与回执持久化失败同纪律）。
- cursor 前进而无广播：SSE 重连／淘汰纪律（D1 的 `evictedThrough`／gap 语义）原样容纳此类「已提交未广播」空隙；`/api/snapshot` 水位随之真实前进。

## 增量③ 同步 spawn 失败落 needs_review 必须同事务登记 cause 与恢复条目

冻结 §3.2/§3.5：`needs_review` 无 recovery cause 不是契约状态（`recovery` 对象为 null、resolve 无版本可校验）。此前 `!exited` 分支（`confirmExtractExit`／`confirmExit`）只改状态不写 failure，spawn 同步失败（exhaustion）与树不可核实 exit 均落 `recovery=null`（ZCode exhaustion 面）。

- `!exited` 分支现按暂存分支登记 cause：有暂存结局 → `result_exit_unconfirmed`（暂存信封原样保留、只缀 cause）；无暂存 → `exit_unconfirmed`，信封携带 worker-host 真实收口事实经 §4.6 注册表映射（spawn 码 `runtime_start` → `worker_lost`/`manual`，无 internalCode）。
- 同事务插入 `recovery_items`（version 1、`verification_state='pending'`，task-recovery 先例），slot 保持占用；**不因缺句柄伪造 `exited_confirmed`**。
- `onWorkerDone` 重排：先算 `effective`／`failurePayload`（含回执 veto 与后端时限映射），再进 `treeVerified===false` 分支并把真实收口事实传入；其余路径逐字节不变。
- `visibleFailure` 不受影响：needs_review 的 failure 仅在暂存失败结局＋退出已确认时可见，staged 成功结局的 wire `failure` 恒 null（GAP-5 断言保持）。

## 验证（真实链；全部聚焦前后同环境）

**协议家族重放**（修正夹具 `986f4cfe`＋合法配置夹具＋队列套件 `fccd8675`，测试侧覆盖物仅本机复跑、不随本分支交付）：

| 例 | 前（pristine `29305da`） | 后（本批） |
|---|---|---|
| spawn-failure 判定表（纯） | 绿 | 绿 |
| protocol factory control | 绿 | 绿 |
| GAP-3 staged 不可见（短 run limit） | **红**（1!==0） | 绿 |
| GAP-3 default staged 不可见 | **红**（1!==0） | 绿 |
| GAP-4 `rejected_late_result` 审计 | **红**（事件类型仅 task.changed×4） | 绿 |
| GAP-5 exit-unknown | 红（succeeded＋发布，树成员存活） | **红，同点保留**（R7-M-2/M-3 退出保证缺口，按派工不掩） |
| scenario exhaustion（spawn 失败） | **红**（recovery=null） | 绿 |

**作者探针**（`scripts/probes/facet1-staged-visibility-probe.mjs`、`facet23-audit-recovery-probe.mjs`，一次性探针、不入库；覆盖冻结套件未钉的面）：修复树 7/7＋7/7；pristine 同探针 4/7＋3/7（默认读泄出 staged、`?status=staged` 200 泄出、单候选 200 泄出、无审计事件、recovery=null、无 failure 信封——逐面可证伪）。

**回归**（同环境，pristine 对照证明零回归）：

- I 单测五套（含 `82e1bf2` 更正字节的 recovery）：**56/56**。
- `test:web-manual-items`：**59/59**。
- II http（合法配置字节）：21/24；T-2（advisor 未接线角色 200）、T-10（跨族键撞 500 未落 409）、T-13（A5 取码索引）三例在 pristine 同点同签名，均既存。
- II controlled-model：11/16；5 个 fault 例在 pristine 同点同签名（与 Pi 登记 16/5/11 一致）。
- II static：8/9；浏览器旅程停在已登记 UI 阻断（`开始整理` 按钮 disabled，前端四文件属 OhMyPi）。
- II queue 全量：12/17；T-6 SIGKILLed、T-7 重启、protocol cleanup 在 pristine 同点同签名（真实 Pi 进程树可核实／退出保证缺口类），two-clients 为 A5 顺序依赖（单跑绿、pristine 同行为）。
- `check:structure`：自测通过，`server/` 零违规（170 条均为会话前既存 `.kimi/`）；`check:docs` 见下。

## 边界

- 未跑完整 `npm run check`（III 唯一集成轮）；未跑未改 Rust 全套／typecheck（前端零改动）。
- GAP-5／cleanup 生产退出保证缺口保持开放（owner 差异包已另案登记，不在本批扩权）。
- 候选／预览线上日期点的线型后继按派工归 OhMyPi 适配轨（本批未动 DTO）；HTTP 与私有 ms 桥接分明，Runtime／DDL 零扩张。
- 可信 test 安全证明增量仍待 ZCode 对 `959f54b` 的测试独审结论，本批未启动。
- 测试侧覆盖物（修正协议夹具、合法配置夹具、队列／http／controlled-model 套件更正字节、recovery 更正字节）均为他人在审候选，本批只本机复跑用，**未随分支提交**；复跑后已还原。
