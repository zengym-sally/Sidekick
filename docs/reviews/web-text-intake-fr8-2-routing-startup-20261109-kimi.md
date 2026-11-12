# F-R8-2 resolve CAS、§4.6 失败路由与启动校验／泄漏修复（Kimi，2026-11-09）

本记录覆盖分支 `agent/kimi/mayne-24` 上、锁定送审基点 `0dbae12ced3a6a1e6b234aac9a529d4de9c081c2`（tree `21393729b794e9e967d0a58e5be226dfa1238bd7`）之上的三个生产小提交。派工来源：队长评论 `01a1be44`——「原 I 授权内直接修这两类偏差及启动泄漏，分小提交保存」。修复面全在 `server/`（I 授权后端生产清单），Rust、DDL、003 冻结哈希、守卫、package、前端、II/III 文件相对基点零差异；ZCode 的恢复回归测试字节零修改（更正版 `82e1bf2` 仅作运行输入原样覆盖、跑后还原）。

## 身份与生产差异

- 分支 `agent/kimi/mayne-24`；三个提交（未 push、未改 `main`、未改工单状态，MAYNE-24 保持 `in_progress`）：
  - `e12c569`（tree `fd046fd3`）：F-R8-2 resolve CAS（恰 1 文件 +33/−19）。
  - `db96401`（tree `6078f95f`）：§4.6 失败路由（3 文件 +50/−29）。
  - `432305b`（tree `c87f0178`）：启动校验与装配失败释放（1 文件 +123/−99，大部为 try 包裹再缩进）。
- 前置链（本树重建）：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli`（lark-cli 1.0.98）；`probe:prepare-pi`（provenance `ad702637`／tree `e89822b0`）；`probe:bundle`；cargo 存储二进制 2649408 B、sha256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`；runtime bundle organizer `08f32db2…`／node `9d050fd4…`——均与既往登记逐字节相同。

## 一、F-R8-2（MAJOR）：败方 resolve 误闭新代 attempt

**根因**（OpenCode `01a1be39` 独立审，确定性 seam 探针）：`TaskService.resolve` 的 cancel／resume 两分支把「任务 UPDATE（条件 `state='needs_review'`）」与「读时 attempt 收尾」放进同一事务，但任务 UPDATE **未声明 `expectChanges`**，适配器只在声明时做提交前断言；`changes !== 1` 的检查发生在 `transact` 返回**之后**。守卫读早于并发 resolve#1 提交＋tick 重新认领时，晚读取到新认领的 attempt#2，事务落定 `changes [0,1]`（任务 CAS 0、attempt#2 收尾 1）**已提交**，随后才抛 409 `state_conflict`——活 worker 从未退出即被记成已核实退出（`ended_at/exit_confirmed_at/exit_reason='confirmed'`），任务却停留 running。

**修复**（`server/lib/task-service.mjs`）：两分支的任务 UPDATE 绑定**读时事实**——`version=?`、`state='needs_review'`、`attempt_exit_state='exited_confirmed'`（已核实退出）——并声明 `expectChanges: 1`，适配器提交前断言失败即回滚**整个**事务（attempt 收尾与事件一并回滚）；`task.changed` 事件从事后独立 `insertEvent` 移入同一事务（收尾及事件同事务）。并发状态前提丢失按合同答 409 `state_conflict`：事务包装器新增**按调用**的冲突码参数（默认仍 `version_conflict`，全局映射不变；显式恢复项版本失配仍走原有前置检查答 `version_conflict`）。

## 二、§4.6 失败路由：真实传递退出／超时事实，unknown 不按码豁免

**根因**（OhMyPi W 审 `d8c7a39` D-1/D-2；队长 `01a1be44` 复核「源码仍有 `worker_lost.isolateOnUnknownSafety=false`、extract 无暂存硬编码 worker_lost 且未接收 deadline 事实」）：extract/revise 无暂存收尾对**两种败面共用同一字面量**（`worker_lost`/manual），`confirmExtractExit` 没有 `deadlineTriggered` 入参，worker-host 已算出的事实被丢弃；`maybeAutoRetry` 的 §4.6 安全路由按码的 `isolateOnUnknownSafety` 判定，`worker_lost`+unknown 因此停在 `failed`，到不了 `needs_review`。

**修复**（`task-service.mjs`＋`text-intake-service.mjs`＋`task-scheduler.mjs`）：

1. `deadlineTriggered` 沿 `onWorkerDone → confirmExtractExit/confirmReviseExit` 真实传递；无暂存收尾按事实经冻结注册表构造信封（`normalizeFailure`：内部 `model_timeout` → `model_request_failed`/`auto_backoff`；意外死亡保持 `worker_lost`/`manual`）。原暂存结局优先——事实仅在无暂存时被查阅（§3.2/§6.1.1 不变）。
2. 注册表删除 `isolateOnUnknownSafety`，安全路由改为**码无关**：任何非 `proven_safe` 的失败都转 `needs_review`（冻结 §4.6「无法证明即 unknown，转 needs_review」；失败码本身不构成安全证明，`worker_lost`/manual 不豁免）。注册表仍是 `retryable` 默认的唯一来源（导出供收尾信封共用）。

## 三、启动校验与装配失败释放（I 生命周期缺陷）

**根因**（本人 `ae5f575` 登记）：entry 先 `storage.start()` 后才校验 `workerRunLimitMs`，且 `Number()`  coercion 接受 `'500'`、`null` 当缺省；被拒值在适配器启动后抛错且不关闭，其 stdio 管道使套件进程永不退出（队列套件 after 挂起）。

**修复**（`server/entries/web-backend-entry.mjs`）：`normalizeRunLimit` 改为严格 number 整数 1..120000（仅省略／`undefined` 取缺省 120000；`'500'`／`null` 拒绝而非 coercion），并在**开启任何资源之前**纯校验；适配器之后的整个装配包进 try/catch，失败时按逆序释放本实例已开资源（scheduler→SSE hub→HTTP socket→storage 适配器）再 rethrow。

## 验证（真实链；scratch 证据 `build/r8-fixes/`，gitignored）

更正版 W 正反控按派工「原样用 `82e1bf2`」：该测试文件字节覆盖进工作树运行、跑后 `git checkout` 还原（工作树测试字节回到登记的 `e6c90c0a`）。

| 运行 | 对象 | 结果 |
|---|---|---|
| 恢复回归（`82e1bf2` 更正字节覆盖） | 基点 `0dbae12`（修前基线） | tests 11 / pass 8 / fail 3——W(deadline)、W(worker loss) 双面红（`failed ≠ needs_review`），D1 红 |
| 恢复回归（同字节） | HEAD `432305b` | tests 11 / **pass 10 / fail 1**——PC1/PC2/M1a/M1b/M1c/F1/E1/E2 保持绿，**W(deadline) 与 W(worker loss) 双面转绿**（前者 `needs_review`+`model_request_failed`/`auto_backoff`，后者 `needs_review`+`worker_lost`/`manual`，均关闭 attempt 行且 `exit_reason='confirmed'`）；D1 失败点与基线逐字相同（`cursor_out_of_window`，R5-M-1 后续批次面，非本次回归） |
| F-R8-2 竞争探针（真 SIGKILL→重启→恢复，resolve#2 守卫读持过期快照，胜方经真实 HTTP 后 tick 认领 attempt#2） | 修前三文件（`ae5f575` 字节） | **复现缺陷**：事务 `changes=[0,1]` 已提交，attempt#2 被收尾（`exit_reason='confirmed'`）后才抛 409 |
| 同上 | HEAD | **通过**：整个事务提交前回滚，attempt#2 保持打开（`ended_at` NULL），败方 409 `state_conflict`，attempt#1 由胜方正常收尾 |
| resolve cancel 分支聚焦探针（同崩溃/重启形状） | HEAD | 通过：202+cancelled、读时 attempt 同事务关闭（`confirmed`）、事件同事务落库；重复 resolve → 409 `state_conflict` |
| 恢复项版本失配探针（`expectedVersion=99`） | HEAD | 通过：409 `version_conflict`、零写入（任务停留 `needs_review`、attempt 保持打开）——显式版本失配未被全局改码 |
| 启动泄漏探针（生产 entry、真实适配器子进程、真实 socket） | 修前 entry | 接受 `'500'`／`null`；泄漏 7 个 `web-backend-storage` 适配器（4 个校验拒绝＋2 个完整后端＋1 个装配失败） |
| 同上 | HEAD | 六个非法值（`0/-1/120001/1.5/'500'/null`）均在开启资源前被范围校验拒绝；EADDRINUSE 装配失败释放已开适配器；零残留适配器进程 |
| 队列套件 `workerRunLimitMs range` 单测 | HEAD | **通过**（6 拒绝＋边界 `1`/`120000` 接受）；套件进程正常退出（修前 after 挂起） |
| 队列套件全套 | HEAD | 17 例 3 过 14 败——14 败全部为既有 II 配置形状问题（`供应商名称无效`，OhMyPi 并行夹具任务），与登记基线一致；无新增失败 |
| I lifecycle／service／MCP 配对 | HEAD | 10/10、13/13、11/11 |
| typecheck | HEAD | exit 0 |
| check:structure | HEAD | `server/` 零违规；170 条 `[top.dir]` 违规全部来自会话开始前即存在的平台注入未跟踪目录 `.kimi/`（非本改动静员，未删除） |

## 边界（未验证／不代签）

- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust；未 push、未合 `main`、未改工单状态。
- D1（`cursor_out_of_window`）保持其后继批次归属；R8-M-1/M-2/M-3 与 MCP/M-5 不因本提交整体关闭。
- 旧 `adc31d8` W 预期已按 `01a1bdda` 撤回，本记录不以任何旧 W 绿色代签；两面 W 均以更正版 `82e1bf2` 正反控为准。
- 队列套件其余 14 败与 II 配置形状问题归 OhMyPi 并行任务；本记录不修改任何 II 夹具或测试。
- 真实模型／真实凭据／用户根／Linux／代理：未授权未执行。

## 结论

三类偏差（F-R8-2 事务原子性、§4.6 真实败面路由与码无关安全路由、启动严格校验与资源释放）已以三个小提交闭合，各自带可证伪正反控；按派工待独立评审（另派），MAYNE-24 保持 `in_progress`。
