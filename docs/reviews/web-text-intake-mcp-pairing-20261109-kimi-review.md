# MAYNE-24 MCP 配对增量限定独审（Kimi，2026-11-09）

> 派发：工单 `01a1b046-9c0d-7515-a447-69ace095580c`（MAYNE-24）触发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bd56-69bb-7a63-a9fc-6735272f2410`（Codex）：并行限定独审 MCP 增量 `0a7ac20220fbf2991887cfcab363fa86b51d7e8e`（父 `5926cbc`，三文件 +113/−9），以真实既有帧经 WorkerHost→异步持久化链验证配对问题，核对存储失败、被拒 begin、孤立 response、重复帧、同服务逆序应答与 attempt/epoch 隔离，确认闭合指向同一个持久 begin，不能只跑纯映射函数；候选只读，仅写本次评审记录与 build 证据，不改 I/II/III 文件，不跑完整 check。评审人 Kimi（未参与 I/III 生产；II 套件作者，本候选零 II 字节）。候选只读；原始证据 `build/mcp-pairing-review/`（gitignored）。

## 1. 结论

**不通过（NOT PASS）**——限本 MCP 配对增量。派发关注的配对问题全部经真实持久化链复现：候选 `worker-host` 的 `call_response` 回退只比 `serverId` 并取最旧 open begin（FIFO），不使用 response 自带的 `callId`；且可闭合集是**内存 Map**，不与 begin 的持久化结果对账。11 项链级检查 5 过 6 败：

- **败**：同服务逆序应答互换闭合（S2）；错误 callId 闭合无辜 begin（S3）；重复 response 帧消耗另一 begin（S4）；begin 提交失败后仍被闭合、产生无 begin 的孤立 closed 回执（S5/S5b）；闭合 callKey 与应答 callId 系统性矛盾（不变量检查）。
- **过**（未改已过面复用＋本链复验）：golden 真实帧精确落账、外来身份帧零入账（S1）；attempt 隔离、同 callId 跨 attempt 独立（S6）；孤立 response → unattributed（S7）；重复 begin 帧幂等且单次闭合正确（S8）。

结论与协调评论「MCP 配对暂不接受关闭」一致；P-3 参考实现已过不代签生产接线，M-5 未闭事实不变。

## 2. 候选身份（独立复算，非采信自述）

| 项 | 登记值 | 复算 |
|---|---|---|
| 提交 | `0a7ac20220fbf2991887cfcab363fa86b51d7e8e` | 相符（`agent/claude/mayne-24` HEAD，父 `5926cbc81422f550bdd9db253e794ca1e0b6f1b6`，父上恰 1 个新提交） |
| tree | `1872c1bb4c35ea1c11a697fdeccf38a2fee10505` | `git rev-parse ^{tree}` 相符 |
| 差异 | 3 文件 +113/−9 | 相符：`server/lib/worker-host.mjs` +53/−6、`tests/unit/web-text-intake-lifecycle.test.mjs` +45/−3、实施记录 §15 +24 |
| 补丁 | `candidate-revision.patch`（10158 B，`397edb0f…`） | diff 体与 `git diff 5926cbc 0a7ac20` **逐字节相同**（仅本地 format-patch 尾迹 `-- 2.56.0` 之差） |
| `SHA256SUMS.txt` | 3 项 | 与候选 blob 逐项相符：worker-host `6c11d6be…`、lifecycle `79d16bae…`、记录 `cd85de17…`（复算全等） |
| 003 哈希 | `8e4e3159…7870` | 候选树内复算相符（冻结不变） |

## 3. 方法：真实链，非纯映射函数

1. **存储二进制按候选自带 Rust 源编译**：本分支（`agent/kimi/mayne-24`）树只有 001/002 迁移，缺 003 与候选的业务表白名单；故从候选树 `git archive` 导出 `src-tauri/`＋`src/assets/brand/`（tray 图标）后 `cargo build --release --bin web-backend-storage`，产物 2649408 B——与既有登记大小（`b7dd9339…`，2649408 B）一致（哈希不同：构建路径/元数据差异，已披露，源身份以 git tree 为准）。
2. **真实帧**：形状取自真实 Runtime 源 `runtime/lib/mcp-trial.mjs:81`（`call_begin` 带 `input.modelCallId`）与 `:87`（`call_response` 只带 `serverId`+`callId`+`result`，**无 `input`**）、`runtime/lib/mcp-control.mjs:16`（`{type:'mcp',action,...body,requestId,runId,hostNonce}`）；另用 P-3 证据包真实捕获帧 `golden-frames.jsonl`，SHA-256 复算 `35d7b97e…` 与 r1/r2/r3 登记逐字节一致（第三方次复验）。
3. **链路**：`WorkerHost.start`（`processFactory` 注入 ScriptedWorker，按脚本时序写真实形状帧）→ stdout 身份栅栏（`runId`+`hostNonce`）→ `receiptFactsFor(frame, state)` → `state.receipts` → `TaskScheduler.onWorkerFrame` 有序 await → `TaskService.recordReceipt` 逐事实独立小事务 → 真实 sqlite；断言全部落在读回的 `side_effect_receipts` 行上（`receipt_id/kind/external_ref`），`receipt_id` 按冻结公式独立重算后归类。
4. **场景**：S1 golden 回放（对照）；S2 同服务双调用逆序应答；S3 错误 callId；S4 重复 response；S5 begin 提交抛错；S5b begin 静默拒（`recordReceipt` 返回 false）；S6 双 attempt 同 callId；S7 孤立 response；S8 重复 begin；S2 不变量复检。

## 4. 逐焦点结果（全部为库内实测行）

| # | 场景 | 结果 | 实测（读回行） |
|---|---|---|---|
| S1 | golden 真实帧回放 | **PASS** | 恰 7 行且序列全对：unattributed、closed[1001,nonce-bash-1]、begin[c-001,mc-001]、closed[c-001,mc-001]、begin[c-002,mc-002]、closed[1002,nonce-bash-2]、begin[c-003,mc-003]；`run_STALE`/错 nonce 的 4 帧零入账；重复 progress/worker 帧按 receiptId 幂等合并且行 |
| S2 | 同服务 A、B 双 begin，B 先应答 | **FAIL** | closed callKey `["c-A","mc-A"]` 而 `external_ref=c-B`；closed callKey `["c-B","mc-B"]` 而 `external_ref=c-A`——**互换错闭合**，B 的应答闭合了 A 的 begin |
| S3 | 无匹配 begin 的 `c-ZZZ` 应答 | **FAIL** | closed=1（A 被闭合，external_ref=c-ZZZ）、unattributed=0——错误 callId 闭合了无辜 begin |
| S4 | A 的 response 帧重复一次（B 仍 open） | **FAIL** | closed `["c-A","mc-A"]`=c-A（首次正确）；随后 closed `["c-B","mc-B"]`=c-A——**重复帧消耗了 B 的 begin** |
| S5 | begin 持久化抛错（存储失败） | **FAIL** | begin 行=0、closed 行=1——begin 从未落库，closed 回执仍落库（孤立闭合）；scheduler stderr 实录 `[scheduler] receipt persist failed … simulated storage commit failure` |
| S5b | begin 被静默拒（`recordReceipt` 返回 false，如异 epoch/attempt 非 active） | **FAIL** | 同 S5：begin 行=0、closed 行=1 |
| S6 | 两 attempt 同 callId `c-A` | **PASS** | 两 attempt 各 1 begin+1 closed，closed receipt_id 互不相同（`d2fad87c…`/`dd93d83e…`），无跨 attempt 串扰 |
| S7 | 完全无 begin 的孤立 response | **PASS** | 恰 1 行 unattributed，external_ref=c-ORPHAN，零闭合 |
| S8 | 重复 begin 帧 + 单 response | **PASS** | begin 1 行（幂等）、closed 1 行且 callKey/external_ref 均 `c-A` |
| 不变量 | S2 库内复检：closed 必须指向同 attempt 已持久化且同 callId 的 begin | **FAIL** | orphans=0 但 callKey↔callId 矛盾 2 处（`["c-A","mc-A"]~c-B`、`["c-B","mc-B"]~c-A`）——闭合指向了**另一个调用**的持久 begin |

## 5. 根因（代码定位，候选树行号）

1. **回退配对忽略单次调用身份**：`server/lib/worker-host.mjs:142-143` 的精确匹配要求 response 重复 `modelCallId`，而真实 response 永不重复（`mcp-trial.mjs:87`；golden 帧实证），故生产路径必然落入 `:144-154` 回退——只比 `serverId`、按 Map 插入序取**最旧** open begin，全程不读 `frame.callId`。同服务并发的 B 应答因此闭合 A（S2）；陌生 callId 也闭合最旧 begin（S3）；重复应答继续消耗下一 begin（S4）。
2. **可闭合集不受持久化门控**：`state.openBegins` 在帧到达时同步维护（`:137`、`:272`），而 begin 事实的持久化发生在之后 scheduler 的 `onWorkerFrame`（`task-scheduler.mjs:145-165`），失败仅 catch+打日志（`:164`），`recordReceipt` 的静默 false 路径（`task-service.mjs:804-805`：attempt 非 active、epoch 不符）同样不回滚 Map。begin 提交失败后 response 照常闭合并落库（S5/S5b）——正是派发要求的「提交失败不可由内存 Map 冒充」的反例。
3. **作者自述与实测不符**：实施记录 §15.1 称「仅当存在**已接受且已持久化**的 begin 时才记 `tool_call_closed`」——S5/S5b 证伪；§15.1 将「各自闭合最旧 open begin（FIFO）」写成预期行为——S2/S3/S4 证伪；§15.2 的 23/23 单测只驱动纯映射函数且应答同序，结构上不可能触及 S2–S5，属派发明示不足的证据形态。

## 6. 与派发核对项逐项对照

| 派发要求 | 结果 |
|---|---|
| 存储失败 | **FAIL**（S5：孤立 closed） |
| 被拒 begin | 帧级被拒（外来身份）**PASS**（S1 零入账）；持久级被拒 **FAIL**（S5b） |
| 孤立 response | **PASS**（S7 unattributed） |
| 重复帧 | begin 重复 **PASS**（S8 幂等）；response 重复 **FAIL**（S4 消耗他人 begin） |
| 同服务逆序应答 | **FAIL**（S2 互换） |
| attempt/epoch 隔离 | **PASS**（S6 独立；S1 栅栏；异 epoch 零入账为已过面复用） |
| 闭合指向同一个持久 begin | **FAIL**（S2 指向另一调用的 begin；S5/S5b 无 begin 可指） |
| 不能只跑纯映射函数 | 已满足——全部断言经 WorkerHost→异步持久化链落库后读回 |

## 7. 观察（不阻断）

- **OBS-1（可达性分级）**：真实 Pi 将全部 MCP 工具注册为 `executionMode:'sequential'`（`runtime/lib/mcp-trial.mjs:64`；`vendor/pi/packages/agent/src/agent-loop.ts:527` 及 README：含 sequential 工具的批次整批串行），故**当前** Runtime 经模型工具批次不会产生同服务 begin 交叠；S2/S4 是配对规则层的反例（帧身份在场而未被使用），S3/S5/S5b 则不依赖并发、直接可达。按协调已冻结口径（「FIFO 不能替代已有的单次调用身份」「按 `serverId`＋`callId` 精确找」），缺陷定级不因当前串行执行而降低。
- **OBS-2（风格）**：`worker-host.mjs:144` 回退条件 `!open && a === undefined || !open && a === null` 运算优先级正确但可读性差；建议改写为显式括号或 `== null` 判断。
- **OBS-3（构建披露）**：本评审存储二进制由候选 `src-tauri` 源编译（2649408 B，与登记大小一致、哈希因构建路径不同而异），仅用于驱动候选持久化链，不构成对任何已登记二进制的代签。

## 8. 未验项（如实单列）

- 未跑完整 `npm run check`、未调用真实模型/真实 MCP 服务/真实凭据/用户根；帧为真实形状与 golden 真实帧，序列（逆序、错 callId、重复、注入提交失败）为按真实形状构造的反例。
- 跨重启回执读回、R7-M-2/M-3（退出核实身份集）、M-5、候选 I 其余未闭项均不在本增量范围，结论不变。
- 替代提交（Claude 修正批）到位后，本探针 `build/mcp-pairing-review/probe-mcp-pairing.mjs` 可直接复跑作为回归（S2–S5 须转 PASS）。

## 9. 边界

候选树零修改（仅读 git 对象与 CLI 附件）；未改任何 I/II/III 文件；未跑完整门禁；未 push、未改工单状态（MAYNE-24 保持 `in_progress`）。原始证据在 `build/mcp-pairing-review/`（gitignored）：探针、实跑日志、结果 JSON、scheduler stderr、golden 帧、候选树导出与存储二进制；精选随评论附件交付。
