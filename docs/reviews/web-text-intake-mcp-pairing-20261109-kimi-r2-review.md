# MAYNE-24 MCP 配对增量（替代提交）限定独审（Kimi，2026-11-09）

> 派发：工单 `01a1b046-9c0d-7515-a447-69ace095580c`（MAYNE-24）触发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bd62-8309-752d-9307-e03b834a9c31`（Codex）：修订先按待审候选接收、不关闭 MCP 项；已核实提交为 `31434282f8622873db9471e9596433abd413a1a8`（tree `19e746b39a323cfcdc189e1996897af4ce12c6f0`，父 `0a7ac202`，四文件 +144/−144），正文所提 `8c54a0b` 本机不可达、不能代替已核实身份；要求先核对触发附件 patch／逐文件哈希，一致后限定复核精确调用配对及受影响生产链，实证 begin 存储失败不进入可闭合集、同服务逆序应答、错误／孤立／重复 response 与 begin、同 callId 跨 server／attempt 隔离，并从真实持久行核对闭合关联，勿以纯函数或新增断言替代 WorkerHost→异步事务链；交明确通过／不通过；身份集、跨重启恢复与安全重试正控未验部分单列，不跑完整 check。评审人 Kimi（未参与 I/III 生产；II 套件作者，本候选零 II 字节）。前序轮次：`0a7ac202` 独审记录 `web-text-intake-mcp-pairing-20261109-kimi-review.md`（NOT PASS，5/11）。候选只读；原始证据 `build/mcp-pairing-review-r2/`（gitignored）。

## 1. 结论

**不通过（NOT PASS）**——限本 MCP 配对替代增量。身份核对无缺口（§2），但派发要求的精确调用配对在生产链上**完全不可用**：候选把配对规则改为 `serverId`＋`callId` 精确匹配（方向正确），却未在生产调度器里算出配对键——`task-scheduler.mjs:175-176` 引用了**从未定义的 `pairKey`**，每个成功持久化的 begin 都在注册前抛 `ReferenceError`，被 `:178` 的 catch 吞掉并误记为「receipt persist failed」。后果：可闭合集 `openBegins` 恒为空，**任何 `call_response` 都不可能闭合**，全部落为 `tool_call_unattributed`。13 项链级检查 6 过 7 败：

- **败（正向配对全面缺失）**：golden 真实帧精确落账（S1，第一轮 PASS 面**回归**）；同服务逆序应答无任何闭合（S2）；重复 response 无闭合（S4）；attempt 隔离无 closed 回执（S6，**回归**）；重复 begin 无闭合（S8，**回归**）；同 callId 跨 server 无闭合（S9，新增）；闭合后重复 begin 重开无闭合（S10，新增）。
- **过（真实或虚胜）**：外来身份帧零入账（S1，真实）；孤立 response → unattributed（S7，真实）；错误 callId 不闭合（S3）、begin 提交失败／静默拒不产生孤立 closed（S5/S5b）、配对不变量（无 closed 行可错指）——后四项因「什么都不闭合」而**虚胜**，不构成对派发要求的满足。

旧 FIFO 失败历史（第一轮 S2/S3/S4/S5/S5b 的错闭合反例）保留有效：本增量改变了失败形态（从「错闭合」变为「无闭合」），未提供任何正确闭合证据。MCP 项不关闭；P-3 参考实现已过不代签生产接线，M-5 未闭事实不变。

## 2. 候选身份（独立复算，非采信自述；无身份缺口）

| 项 | 登记值 | 复算 |
|---|---|---|
| 提交 | `31434282f8622873db9471e9596433abd413a1a8` | 相符（`agent/claude/mayne-24` HEAD，父 `0a7ac20220fbf2991887cfcab363fa86b51d7e8e`，父上恰 1 个新提交） |
| tree | `19e746b39a323cfcdc189e1996897af4ce12c6f0` | `git rev-parse ^{tree}` 相符 |
| 差异 | 四文件 +144/−144 | 相符：`server/lib/worker-host.mjs`、`server/lib/task-scheduler.mjs`、`tests/unit/web-text-intake-lifecycle.test.mjs`、实施记录；无 Rust／DDL／守卫／package.json／vendor／runtime 字节 |
| `8c54a0b` | 正文所提 HEAD | 本机 `git cat-file` 报 "Not a valid object name"——确不可达，协调替换为 `31434282` 正确，全程以已核实身份为准 |
| 补丁 | 触发线程交付评论 `01a1bd61` 附件 `candidate-revision.patch`（22134 B，`c3471d84…`） | diff 体与 `git diff 0a7ac20 31434282` **逐字节相同**（plain diff，无格式尾迹差） |
| `SHA256SUMS.txt` | 4 项 | 与 `31434282` blob 逐项相符：记录 `a3fb6db8…`、scheduler `6dd20735…`、worker-host `c317f009…`、lifecycle `81408eca…`（复算全等） |
| 003 哈希 | `8e4e3159…7870` | 候选树内复算相符（冻结不变） |

## 3. 方法：真实链，非纯映射函数（与第一轮同构， Round-2 重建环境）

1. **存储二进制按候选自带 Rust 源编译**（本分支缺 003 迁移与候选业务表白名单）：`cargo build --release --bin web-backend-storage`，产物 2649408 B、SHA-256 `42af54b5…`——与第一轮二进制**逐字节相同**（本增量不含 Rust 变更，源身份延续；本轮从头重建复现该哈希）。
2. **Runtime bundle 按仓库标准链重建**（`npm ci --ignore-scripts`＋`probe:prepare-cli`＋`probe:prepare-pi`＋`scripts/build/bundle-runtime.mjs`）：`organizer.mjs` `08f32db2…`、随包 `node` `9d050fd4…`，与此前登记逐字节一致。
3. **真实帧**：形状取自 `runtime/lib/mcp-trial.mjs:81/87`（`call_begin` 带 `input.modelCallId`；`call_response` 只带 `serverId`+`callId`+`result`，无 `input`）与 `runtime/lib/mcp-control.mjs:16`；golden 真实捕获帧 `golden-frames.jsonl` SHA-256 `35d7b97e…`（第四次复验，与 r1/r2/r3 登记一致）。
4. **链路**：`WorkerHost.start`（ScriptedWorker 按脚本时序发真实形状帧）→ stdout 身份栅栏 → `receiptFactsFor(frame)` → `state.receipts` → `TaskScheduler.onWorkerFrame` 有序 await → `pairReceiptFact`（调度器 `openBegins`/`closedPairs`）→ `TaskService.recordReceipt` 逐事实独立小事务 → 真实 sqlite；断言全部落在读回的 `side_effect_receipts` 行上。第一轮 11 项检查逻辑逐字节保留以便对照；按派发新增 S9（同 callId 跨 server）与 S10（闭合后重复 begin 不得重开）。

## 4. 逐焦点结果（全部为库内实测行）

| # | 场景 | 结果 | 实测（读回行） |
|---|---|---|---|
| S1 | golden 真实帧回放 | **FAIL（回归）** | 恰 6 行：unattributed(null)、closed[1001,nonce-bash-1]、begin[c-001,mc-001]、begin[c-002,mc-002]、closed[1002,nonce-bash-2]、begin[c-003,mc-003]——两个 MCP closed 行消失（应答落 unattributed，与 progress 帧按 receiptId 合并且行）；外来身份帧仍零入账（PASS） |
| S2 | 同服务 A、B 双 begin，B 先应答 | **FAIL** | closed=0——无任何闭合（第一轮为互换错闭合；本轮连正确闭合也不存在） |
| S3 | 无匹配 begin 的 `c-ZZZ` 应答 | PASS（虚胜） | closed=0、unattributed=c-ZZZ——不闭合正确，但同样因为「从不闭合」 |
| S4 | A 的 response 帧重复一次（B 仍 open） | **FAIL** | closed=0 |
| S5 | begin 持久化抛错（存储失败） | PASS（虚胜） | begin=0、closed=0——无孤立 closed；但可闭合集从未被注册，门控未被正向证明 |
| S5b | begin 被静默拒（`recordReceipt` 返回 false） | PASS（虚胜） | 同 S5 |
| S6 | 两 attempt 同 callId `c-A` | **FAIL（回归）** | 两 attempt 各 1 begin、0 closed；closed receipt 不存在（第一轮为双 closed 且互异） |
| S7 | 完全无 begin 的孤立 response | PASS（真实） | 恰 1 行 unattributed，external_ref=c-ORPHAN |
| S8 | 重复 begin 帧 + 单 response | **FAIL（回归）** | begin 1 行（幂等在）；closed=0，response 落 unattributed(null)=c-A |
| S9 | 同 callId `c-X` 跨 srv-a／srv-b，仅 srv-b 应答 | **FAIL** | begins=1、closed=0、unattributed=1——无任何跨服务闭合（预期 srv-b 闭合 1 行；见 OBS-4） |
| S10 | begin→response→重复 begin→重复 response | **FAIL** | begin 1 行、closed=0、unattributed 1 行（两应答合并且行）——无闭合，重开保护无从验证 |
| 不变量 | S2 库内复检：closed 须指向同 attempt 已持久化且同 callId 的 begin | PASS（虚胜） | orphans=0、矛盾=0——无 closed 行可错指 |

scheduler stderr 实录：**18 次** `[scheduler] receipt persist failed for <task>: pairKey is not defined`——恰等于 13 个场景中成功持久化的 begin 次数，与根因完全吻合。

## 5. 根因（代码定位，候选树行号）

1. **可闭合集注册引用未定义变量**：`server/lib/task-scheduler.mjs:175-176`：`if (persisted && kind === 'tool_call_begin' && pairKey !== null && !this.closedPairs.has(pairKey)) { this.openBegins.set(pairKey, { callKey }); }`——全文仅此两处出现 `pairKey`，从未声明（`const`/`let`/参数/全局均无）。每个持久化成功的 begin 都在注册前抛 `ReferenceError`。
2. **异常被吞并误标签**：`server/lib/task-scheduler.mjs:178-180` 的 catch 将其写为 `[scheduler] receipt persist failed`——代码缺陷在生产日志里伪装成存储失败（若真实环境出现，将误导排障方向）。
3. **后果链**：`openBegins` 恒空 → `pairReceiptFact`（`worker-host.mjs:165-180`）永不相中 → `call_response` 全部落 `tool_call_unattributed`（`:174-178`）。精确配对语义（`serverId`＋`callId`、无匹配不伪造、重复帧不重开）在纯函数层正确，但生产调度器层从未执行到注册，「只有 begin 持久化成功才进入可闭合集」退化为「任何 begin 都不进入可闭合集」。
4. **作者单测结构性覆盖不到**：候选自带 `tests/unit/web-text-intake-lifecycle.test.mjs` 10/10 通过，但 MCP 配对用例（`:270-304`）在**测试内重写了调度器注册循环**（`:277-280` 正确算出 `${serverId}\u0000${callId}`）并直接驱动纯函数 `pairReceiptFact`，从不构造生产调度器收据路径——正是派发「勿以纯函数或新增断言替代 WorkerHost→异步事务链」所警示的证据形态；第一轮 §15.2 的同类问题在替代提交中原样存在。

## 6. 与派发核对项逐项对照

| 派发要求 | 结果 |
|---|---|
| 先核对附件 patch／逐文件哈希与 `31434282` | **一致**（§2：diff 体逐字节相同、4/4 哈希相符、`8c54a0b` 确认不可达）——无身份缺口，进入复核 |
| begin 存储失败不进入可闭合集 | **FAIL**：门控条件写在 `:175`（`persisted &&`），但因 `pairKey` 未定义，**任何** begin（含存储成功者）都不进入可闭合集；负例 S5/S5b 仅虚胜，正向门禁未被证明 |
| 同服务逆序应答 | **FAIL**（S2：无闭合；且不存在错闭合） |
| 错误／孤立／重复 response 与 begin | 错误 callId 虚胜（S3）；孤立 response 真实 PASS（S7）；重复 response **FAIL**（S4 无闭合）；重复 begin **FAIL**（S8/S10 无闭合、重开保护无从验证） |
| 同 callId 跨 server 隔离 | **FAIL**（S9：无任何闭合；跨服务器错闭合亦不可能——同样因为从不闭合） |
| 同 callId 跨 attempt 隔离 | **FAIL（回归）**（S6：无 closed 回执；attempt 间无串扰但功能缺失） |
| 从真实持久行核对闭合关联 | 已满足方法层（全部断言落库后读回）；不变量虚胜（无 closed 行） |
| 勿以纯函数或新增断言替代真实链 | 独审侧已满足；**候选侧反例**——作者单测重写注册循环驱动纯函数（§5.4） |
| 明确通过／不通过 | **不通过（NOT PASS）** |
| 身份集、跨重启恢复、安全重试正控未验部分单列 | §8 单列；未跑完整 check |

## 7. 观察（不阻断）

- **OBS-1（死状态）**：`worker-host.mjs:268` 仍初始化 `state.openBegins = new Map()`、`:353` 仍以 `receiptFactsFor(frame, state)` 传第二个参数——新签名已不用；属清理项。
- **OBS-2（作用域隐患，当前被缺陷掩盖）**：`openBegins`/`closedPairs` 是调度器实例级 Map/Set（`task-scheduler.mjs:35-36`），`pairKey` 为 `serverId\u0000callId`、**不含 attempt/run 作用域**；一旦注册缺陷修复，跨 attempt／跨任务的配对键空间与 `closedPairs` 无界增长需要一并收窄（建议并入 attemptId 或按 attempt 清理）。
- **OBS-3（日志误导）**：catch 将代码缺陷记为 "receipt persist failed"（§5.2），生产排障时会指向存储层。
- **OBS-4（S9 判据披露）**：冻结 `receipt_id` 公式只含 `[runId,attemptId,kind,callKey]`，同 callKey 的跨 server 两个 begin 落同一行（S9 实测 begins=1 而非 2），故 S9 的「begins=2」判据本身不可表达；其决定性证据为 closed=0（正确实现应为 closed=1）。该公式粒度问题与此前各轮一致，不因本增量改变。
- **OBS-5（构建披露）**：本轮存储二进制由候选 `src-tauri` 源从头重建（哈希与第一轮逐字节相同），仅用于驱动候选持久化链，不构成对任何已登记二进制的代签；`build/s0-runtime` 由仓库标准链重建并与此前登记一致。

## 8. 未验项（如实单列）

- **身份集／退出核实（R7-M-2/M-3）**：不在本增量范围（OpenCode 只读裁定 `23eb1a1` 已受理，完整性缺口仍阻断准出）。
- **跨重启恢复**：未做跨重启读回专测（派发明示单列）。
- **真实 `test` 任务安全重试正控**：未实施、未验（派发明示单列）。
- 未跑完整 `npm run check`、未调用真实模型／真实 MCP 服务／真实凭据／用户根；帧为真实形状与 golden 真实帧，序列（逆序、错 callId、重复、注入提交失败、跨 server、重开）为按真实形状构造的反例。
- 候选 I 其余未闭项（R6/R7 已报面、M-5、旅程脚本）结论不变。
- 替代提交再版到位后，本探针 `build/mcp-pairing-review-r2/probe-mcp-pairing-r2.mjs` 可直接复跑作为回归：S1 精确集、S2、S4、S6、S8、S9、S10 须转 PASS，且 scheduler stderr 不得再出现 `pairKey is not defined`。

## 9. 边界

候选树零修改（仅读 git 对象与 CLI 附件）；未改任何 I/II/III 文件；未跑完整门禁；未 push、未改工单状态（MAYNE-24 保持 `in_progress`）。原始证据在 `build/mcp-pairing-review-r2/`（gitignored）：探针脚本、实跑日志、scheduler stderr、结果 JSON、身份与哈希清单、golden 帧、候选树导出、重建的存储二进制与 Runtime bundle；精选随评论附件交付。本记录未登 `docs/reviews/README.md` 索引（该文件属 III 写入范围）。
