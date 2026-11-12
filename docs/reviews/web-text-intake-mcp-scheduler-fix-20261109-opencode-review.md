# W1 MCP 调度器单文件修复独立审（OpenCode，2026-11-09）

- 派发：MAYNE-24 评论 `01a1bdec-595e-7792-a92a-91831bb783aa`（Codex，2026-11-09T01:29:05Z）。
- 对象：Kimi 生产修复 `59b405f9a6c2b4968904cd03ee362ecba9ddc2af`（tree `395d4ac4831ae702a00503ed8aa11486f8e01510`，父 `6681adf` 接收合并），生产面相对精确 `31434282f8622873db9471e9596433abd413a1a8` 仅 `server/lib/task-scheduler.mjs` 一个文件。审查者 OpenCode 未写生产 scheduler、未写本套测试，符合作者不自签分离。
- 登记保留：**测试作者与生产作者同为 Kimi**（`a02af9e` 套件与本修复同人）。本审只签生产修复与受影响路径；测试自身的限定独审仍归 ZCode，本通过不预签测试审。

## 结论

**限定范围：通过。** 单文件修复实现正确、可证伪、独立复跑全绿；派发点名的四项核对（真实闭合正控、attempt 隔离、帧队列沉降后清理、stop 清理）全部核实；新声明的"双向持久化门控"由本审自建探针独立证实（作者套件不覆盖 closure 失败路径，见下）。MCP／M-5 不因本审关闭。

## 身份与附件读回（CLI 实际读回 + 本机对象库复算）

- `59b405f` tree/父与登记一致；`git diff --numstat 6681adf 59b405f` 恰 `33 7 server/lib/task-scheduler.mjs`，生产面相对 `31434282` 仅此一处（`server/` 其余、`src-tauri/`、`package.json` 零差异）。
- blob/SHA-256 逐字节吻合：before `2c85d661`/`6dd20735…7225b1`（= `31434282` 原字节，`6681adf` 同 blob 复核），after `195bf4d1`/`3b3100de…a0bce6`。
- 附件 9/9 经 CLI 下载并复算：与作者 `SHA256SUMS.txt` 逐一吻合（`candidate-revision.patch` `b519da41…`、`production-diff-vs-31434282.diff` `baa91c93…`、三份 TAP `7f4fe503…`/`45701f67…`/`46990d38…` 等）。
- 两份 diff 附件与对象库实际字节互证：`production-diff-vs-31434282.diff` 与 `git diff 31434282 59b405f -- server/ src-tauri/ package.json` 逐字节相同；`candidate-revision.patch`（format-patch 邮件头格式）hunk 体与 `git diff 6681adf 59b405f` 逐字节相同（仅差 git 签名尾行）。

## 差异与代码核对

- **根因与修复成立**：旧版 `onWorkerFrame`（`31434282` :167）在 `persisted && kind === 'tool_call_begin' && pairKey !== null` 处引用未定义 `pairKey`——每个成功持久化的 begin 都抛 `ReferenceError` 并被 catch 吞为「receipt persist failed」，`openBegins` 恒空、任何 `call_response` 不可闭合。新版在循环内定义 `pairKey = serverId + NUL + callId`（与 `pairReceiptFact` 内部键同格式），`serverId`/`callId` 缺失即 `null`、永不可闭合。
- **attempt 隔离**：`openBegins`/`closedPairs` 改两级结构 `attemptId -> Map/Set`；同 `serverId+callId` 的并发 attempt 状态互不可见，闭合按各自 attempt 独立登记。
- **双向持久化门控（快照判定）**：`pairReceiptFact` 本身会变更传入集合（delete+add），新版传 `new Map(openBegins)`/`new Set(closedPairs)` 快照做判定，真实集合只在 `recordReceipt` 返回 true 后由调度器自行推进：begin 仅在持久化成功且未闭合时入集（已闭合不重开）；closure 仅在 `fact.needsPairing === true` 且判定为配对、且闭合行自身持久化成功后才 `openBegins.delete` + `closedPairs.add`。`recordReceipt` 抛错落 catch、返回 false 走 `continue`——两条失败路径都零集合变更。
- **帧队列沉降后清理**：清理置于 `onWorkerDone` 入口（先删状态再走 `getTaskRow`，早退路径同样清理）。`done` 严格晚于该 attempt 全部帧的持久化由未改字节的 worker-host 结构性保证：`state.frameQueue = state.frameQueue.then(() => onFrame(frame))` 有序串接（worker-host.mjs:344-352），`finish` 经 `state.frameQueue.then(() => state.resolveDone(...))` 才落定（:378-388）——不存在"清理早于帧处理"的窗口。
- **stop 清理**：`stop()` 在 `await workerHost.stopAll()` 后 `openBegins.clear()`/`closedPairs.clear()`；`active.clear()` 同步完成。
- 变更布尔级、无接口签名变化；`worker-host.mjs`（`pairReceiptFact`/`receiptFactsFor`）、`task-service.mjs`（`recordReceipt`：false=非活跃/epoch 不符/无行、true=幂等或新插入、throw=存储故障）语义未被触碰。

## 实跑与可证伪性（本审独立复跑，非沿用作者数字）

前置链本机复建（顺序 prepare-pi → prepare-cli → probe:bundle → build:backend，全部 exit 0）：存储二进制 2649408 B、SHA-256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`（与登记及既往各轮审查二进制逐字节相同）；organizer `08f32db2…911a7`、随包 node `9d050fd4…588a`、lark-cli 1.0.98、prepare-pi provenance tree `e89822b0…3c68`。四测试文件在 `59b405f` 树内 blob 与 `a02af9e` 逐字节一致（`3011552f`/`d8bf1dab`/`7a1dfac0`/`97f8bfaf`）。

| 运行 | 对象 | 本审实测 |
|---|---|---|
| 修复后链级回归 | pristine detached `59b405f`，原样 `a02af9e` 11 项 | **tests 11 / pass 11 / fail 0**，`pairKey` 0 次，stderr 0 字节，exit 0（TAP `0046f89e…c98df4`，2026-11-09T01:42:27Z） |
| 基线反证 | pristine detached `6681adf`（scheduler=`2c85d661` 旧字节） | **tests 11 / pass 4 / fail 7**，TAP 流内 16× `pairKey is not defined`（parent stderr 0 字节），失败用例清单与作者 baseline.tap 逐项相同，exit 1 |
| 受影响 I 单测 lifecycle | `59b405f` | **10/10**，exit 0，stderr 0 |
| 受影响 I 单测 service 层 | `59b405f` | **13/13**，exit 0，stderr 0 |

可证伪性成立：同一套件在旧字节上 7 失败、新字节上 11 全绿，失败面恰为修复根因（闭合不可达）；两棵运行树全程 pristine（ porcelain 0），取证后删除，临时根与进程零残留。

## 双向持久化门控独立验证（派发点名，套件外的独立探针）

作者 11 项套件只覆盖 **begin 侧**失败（test 5 抛错／test 5b 静默 false）；**closure 行持久化失败 → begin 不被消耗 → 后续合法 response 仍可闭合**无套件用例。本审自建探针（真实 `TaskScheduler` + 真实 `pairReceiptFact`，取自 `59b405f` 树原字节；事实对象按生产 `receiptFactsFor` 形状；`recordReceipt` 在服务缝脚本化——与套件同一接缝类别；不写树、不走存储）：**18/18 全绿**。

| 组 | 断言 | 结果 |
|---|---|---|
| P1 closure 抛错 | begin 入集；抛错后 begin 仍开放、pair 未闭合；失败经 stderr 浮出且循环存活；失败前持久化的闭合行 kind 为 `tool_call_closed`（判定见过开放 begin）；**重试 response 以原 begin callKey 配对闭合（非 unattributed）**；成功后 begin 消费+pair 登记；其后重复 response 记 unattributed 不重开 | 7/7 |
| P2 closure 静默 false | begin 保留开放、pair 未闭合；后续合法 response 仍以原 callKey 闭合 | 3/3 |
| P3 同批 begin+失败 closure | 同批中 begin 成功保留、失败 closure 不消费；后续 response 可闭合 | 2/2 |
| P4 attempt 隔离（状态级） | A 闭合不消费/不关闭 B 的 begin；B 自身 response 独立闭合；两条配对闭合行 callKey 相同、按 attempt 各自持久化 | 3/3 |
| P5 done 清理 | `onWorkerDone` 入口即删该 attempt 状态（含 `getTaskRow` 早退路径） | ✔ |
| P6 stop 清理 | `stop()` 全清；stop 后到达的帧惰性（不崩溃、不复活状态） | 2/2 |

探针首跑 17/18：唯一失败（P6b）是探针自身缺陷（stop 后经已清除的 handle 注入事实，帧未达 `onWorkerFrame`），修正注入路径后 18/18；修正仅涉及探针文件，不涉候选树。

## S9 更正帧型核实

`a02af9e` 的 cross-server 用例（test 10）用 `srv-a`/`srv-b` 同 `callId c-X`、不同 `modelCallId`（`mc-X`/`mc-Y`）表达两个可区分调用，期望两 begin 各自闭合（`["c-X","mc-X"]=c-X` 与 `["c-X","mc-Y"]=c-X`）、零 unattributed——按 `01a1bd85` 更正执行，冻结公式未变，无 `closed=1/unattributed=0` 预签。本审 11/11 实跑含该用例。

## 证据读回与登记瑕疵

- 派发点名的 9 份附件全部存在并经 CLI 读回复算通过，无缺口。
- 登记瑕疵（不阻断）：作者 `admission.json` 的 `production_diff` 写 +35/−9，git numstat 与交付评论均为 +33/−7（本审 numstat 复核 33/7）；权威 diff 附件逐字节正确，属登记笔误，请 III 集成登记时以此为准。

## 边界

只读独审 + 本审自建探针；候选树与两棵 detached 运行树零改动（pristine 取证后删除）；未写生产／测试／package／DDL／Runtime／守卫，未跑完整 `npm run check`；未触碰其他成员工作树。探针走调度器状态缝、套件走真实链，两者互补：本通过不含真实模型链路（受控 stub 帧）、不含 R8-M-1/M-2/M-3、成功终态事件、身份登记、跨重启读回、真实 `test` 任务安全正控（后续增量各自送审）。测试作者／生产作者同一这一点保留，测试自身独审归 ZCode。MCP／M-5 未关闭；MAYNE-24 保持 `in_progress`。

本审原始证据（TAP／探针脚本与输出／运行摘要／SHA256SUMS）随评论附件交付，存档于 `build/mayne24-mcp-sched-review/r1/`（gitignored）。
