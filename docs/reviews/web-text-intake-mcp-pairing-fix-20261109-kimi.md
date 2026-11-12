# MAYNE-24 MCP 注册修复交付记录（Kimi，2026-11-09，生产增量）

> 派发：工单 `01a1b046-9c0d-7515-a447-69ace095580c`（MAYNE-24）触发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bdd7-ddb7-7aba-b9bf-9f7033f66459`（Codex）：本轮先只交 **`server/lib/task-scheduler.mjs` 的 MCP 注册修复**——消除未定义 `pairKey`、open/closed 集按 attempt 隔离、保持持久化成功才推进状态；可继续使用平台现有 `6681adf` 接收树，勿重做接收；交该文件相对精确 `31434282` 的生产 diff／blob，II 测试原字节独立登记；及时保存最小待审提交，再运行原样 `a02af9e` 的 11 项真实链回归及受影响 I 单测，附命令／TAP／stderr／哈希；所有闭合正控须真正在库内出现，S9 按 `01a1bd85` 更正；此轮不并入 R8／身份大批改动、不重复未改 Rust 或完整 check。作者身份：Kimi（II 配对测试 `a02af9e` 作者；本增量起按工单正文「后端修订主责转交」担任 I 生产修订作者，不自签，独审由协调另派未写该生产文件的成员）。

## 1. 结论

**本增量已交付并实测通过**（限 MCP 注册修复范围）：`server/lib/task-scheduler.mjs` 单文件生产修复 `59b405f`（父 `6681adf8b3eea9bd8899869f9718b93aecadb5ef`）。修复后原样 `a02af9e` 的 11 项真实链回归 **11/11 通过**（修复前同一工作树、同一存储二进制上复现 **4 过 7 败**、stderr 实录 16 次 `pairKey is not defined` 的可证伪原始失败）；两个受影响 I 单测 **10/10** 与 **13/13** 通过。MCP 配对项是否关闭、M-5、R8、身份集与跨重启恢复等**不在本增量范围**，由协调按独审结论另行处置；MAYNE-24 保持 `in_progress`。

## 2. 身份（独立复算）

| 项 | 值 | 复算 |
|---|---|---|
| 接收基点 | `6681adf8b3eea9bd8899869f9718b93aecadb5ef`（tree `2fda915f…`，父 `a02af9e`＋`31434282` 接收 merge） | `git rev-parse` 相符；其 `server/`、`src-tauri/`、I 两个单测相对 `31434282` 零差异（`git diff 31434282 HEAD -- server src-tauri tests/unit/web-text-intake.test.mjs tests/unit/web-text-intake-lifecycle.test.mjs` 为空） |
| 精确生产基点 | `31434282f8622873db9471e9596433abd413a1a8`（tree `19e746b3…`） | `task-scheduler.mjs` blob `2c85d661a6a55306e710098a54310044377f5d12`，与 `31434282:server/lib/task-scheduler.mjs` 逐字节相同 |
| 修复提交 | `59b405f`（父 `6681adf`，恰 1 文件） | `git diff --numstat 6681adf 59b405f`＝`server/lib/task-scheduler.mjs` +33/−7（相对 `31434282` 同为 +33/−7，该文件在接收 merge 中未变）；`worker-host.mjs`、`task-service.mjs` 及其余全部字节相对 `31434282` 零差异（`git diff --numstat 31434282 HEAD -- server src-tauri tests/unit/web-text-intake.test.mjs tests/unit/web-text-intake-lifecycle.test.mjs` 仅该文件一行） |
| II 测试原字节（独立登记，未改） | `tests/unit/web-text-intake-mcp-pairing.test.mjs` blob `3011552f…`／SHA-256 `80717c43…`；`mcp-pairing-worker.mjs` blob `d8bf1dab…`／`d07c6007…`；`mcp-pairing-frames.mjs` blob `7a1dfac0…`／`1b7ba122…`；`mcp-pairing-golden-frames.jsonl` blob `97f8bfaf…`／`35d7b97e…` | 与 `a02af9e` 逐字节相同（`git diff a02af9e HEAD -- <四路径>` 为空）；golden 帧第 6 次独立复验 |
| 003 冻结哈希 | `8e4e3159…7870` | 本树 `src-tauri/migrations/web-backend/003_text_intake.sql` 复算相符（未触碰） |

准入登记：`build/mayne24-mcp-fix/admission.json`（gitignored），含实际 pwd／branch／HEAD／基点树身份／写入清单／预定独审者口径。

## 3. 修复内容（仅 `server/lib/task-scheduler.mjs`）

根因（承 R2 独审 `85fb851` 实证）：`:175-176` 引用从未定义的 `pairKey`，每个成功持久化的 begin 都在注册前抛 `ReferenceError`，被 `:178` 的 catch 吞掉并误写 `[scheduler] receipt persist failed`；可闭合集恒空，任何 `call_response` 都不可能闭合；且 open/closed 集为调度器全局，同 `serverId+callId` 在并发 attempt 间会互相配对。

1. **定义并一致使用配对身份**：`pairKey = serverId + '\u0000' + callId`（与 `worker-host.mjs` 的 `pairReceiptFact` 配对键逐字节同格式）；`serverId` 或 `callId` 缺失时无配对键、永不可闭合。配对判定仍由生产纯函数 `pairReceiptFact` 作出，未在调度器重写注册逻辑。
2. **open/closed 集按 attempt 隔离**：`openBegins`／`closedPairs` 改为 `attemptId -> pair-key 状态` 的两级 Map；同一 attempt 的帧经 WorkerHost `frameQueue` 严格串行，跨 attempt 状态互不干扰。attempt 的 worker 完成（`done` 在帧队列沉降后才 resolve）即删除其配对状态，`stop()` 全清，避免常驻增长。
3. **持久化成功才推进状态（双向）**：begin 仅在 `recordReceipt` 返回 true 后进入可闭合集（抛错或静默 false 均不进入；已闭合调用不重开）；closure 也只在**闭合行自身持久化成功后**才消费 begin 并登记 `closedPairs`。配对判定跑在该 attempt 集合的快照上，因此闭合行持久化失败时 begin 保持可闭合，而非被静默消耗。
4. `worker-host.mjs`／`task-service.mjs` 零字节修改；未新增 Runtime 帧、DDL、依赖、守卫、预算改动。

## 4. 验证（命令／TAP／stderr／哈希）

前置（本树重建，未造占位）：`npm ci --ignore-scripts`（exit 0）→ `npm run probe:prepare-cli`（lark-cli 1.0.98）→ `npm run probe:prepare-pi`（provenance `e89822b0…`，commit `ad702637…`）→ `npm run probe:bundle`（`organizer.mjs` `08f32db2…`、随包 `node` `9d050fd4…`，与此前登记逐字节一致）→ `cargo build --manifest-path src-tauri/Cargo.toml --release --bin web-backend-storage`：产物 2649408 B、SHA-256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`，与 R2／`a02af9e` 轮登记二进制**逐字节相同**。

**修复前基线（可证伪原始失败，本树 pristine `31434282` 字节，树零修改）**：

```
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-mcp-pairing.test.mjs
→ # tests 11 / # pass 4 / # fail 7；TAP 流内 16× "[scheduler] receipt persist failed … pairKey is not defined"
→ 7 个失败均为「该闭合而零闭合」：golden 序列缺 tool_call_closed(["c-001","mc-001"]) 行；逆序／重复 response／attempt 隔离／重复 begin／跨 server／重开均 closed receipts: none
```

**修复后（HEAD `59b405f`）**：

```
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-mcp-pairing.test.mjs
→ # tests 11 / # pass 11 / # fail 0；EXIT=0；TAP 流内 pairKey is not defined 0 次；stderr 0 字节
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-lifecycle.test.mjs
→ # tests 10 / # pass 10 / # fail 0；EXIT=0
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake.test.mjs
→ # tests 13 / # pass 13 / # fail 0；EXIT=0
```

11 项全部落在 `WorkerHost.start`（runId+hostNonce 围栏）→ `receiptFactsFor` → 调度器 `onWorkerFrame`（有序 await）→ `TaskService.recordReceipt`（独立小事务）→ 真实 sqlite 读回的 `side_effect_receipts` 行上：golden 精确 7 行正控（含 `tool_call_closed(["c-001","mc-001"])=c-001` 与 `["c-002","mc-002"]` 前的外来帧零入账）、同服务逆序各自闭合、错误 callId 不闭合、重复 response 不消耗他人 begin、begin 提交抛错／静默 false 均不可闭合、两并发 attempt 同 callId 独立闭合且 receipt_id 互异、孤立 response 未归因、重复 begin 幂等且单次闭合、跨 server 同 callId 各自闭合、闭合后不重开。**闭合正控均为库内真实行**（测试只读 sqlite 分类，未直写业务结果）。

**S9 按 `01a1bd85` 更正**：跨 server 场景夹具使用不同 `modelCallId`（`mc-X`/`mc-Y`）表达两个可区分调用；旧帧同 run/attempt 复用同一 callKey 的预期已撤回，冻结公式不变；旧跨 server 身份碰撞作为异常单列，未预签 `closed=1/unattributed=0`。

## 5. 未验与边界（如实单列）

- 本增量**不**处理：R8 三项与成功终态事件、身份登记／存活期清扫与保守恢复、跨重启读回、真实 `test` 任务安全重试正控；MCP／M-5 未关闭，不代签。
- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust 的 fmt／clippy／cargo test（仅按前置需要编译存储二进制）；未 push、未改工单状态。
- II 测试与配对夹具为 `a02af9e` 原字节，仅独立登记哈希；生产注册循环未在测试内重写。
- 原始证据：`build/mayne24-mcp-fix/`（gitignored）：准入、四条命令上下文、TAP／stderr 全量日志、`SHA256SUMS.txt`。
- 独审：由协调另派未写 `server/lib/task-scheduler.mjs` 的成员；作者不自签。生产替代版过审前，本增量只是待审候选。
