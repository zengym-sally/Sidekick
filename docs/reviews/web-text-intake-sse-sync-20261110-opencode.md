# 任务 SSE 同步包：状态机与接口记录（MAYNE-24，2026-11-10，OpenCode）

- **授权**：协调层裁定评论 `01a1c180-e2eb-73e4-889d-6740714ff534`（SSE 路线按冻结 web-api/1 §6 字面补偿实施；五个授权写入路径＋可选 `src/lib/sse-stream.ts`；`48880a2` 工程包原样保留不重跑）。路线提案为 `f3b9d3c`／评论 `01a1c169`，其"同连接收敛等价"方案按裁定不采用。
- **基点**：分支 `agent/opencode/mayne-24`，组合基准采用提交 `fdf89c1`（恰三文件逐 blob 采纳 b5 `b5fdfb9`：client `e730d4a3`、organizer `d4b824cb`、TaskQueue `1bd5d476`；pairing `3ae7deb3`／PairingGate `01e43233` 本分支已是基准字节），实现提交 `b8a659b`。
- **冻结契约**：`docs/engineering/web-api-contract.md`（本树复算 SHA-256 ＝ 冻结 `61863271…`）§6；整理契约 §6.3（候选/来源读回补偿）。
- **写入清单**：恰 `src/stores/pairing.ts`、`src/lib/web-api-client.ts`、`src/components/PairingGate.vue`、`src/components/TaskQueue.vue`、`src/stores/organizer.ts`、新增 `src/lib/sse-stream.ts`、新增 `tests/unit/web-text-intake-sse-stream.test.mjs`（解析器自测）＋本记录与 README 索引行。作者不自签，独审由协调层另派。

## 1. 传输层（`src/lib/sse-stream.ts`，新增，零依赖）

- 同源 `fetch` 流替代原生 `EventSource`：§6 字面补偿要求以**请求头** `Last-Event-ID` 携带快照令牌重新订阅，`EventSource` 无法设置自定义头。令牌只进请求头，不进 URL（不新增公共 query 协议）；会话凭据走 same-origin credentials；**零持久化**（令牌仅在内存）。
- `createSseParser`：增量 `text/event-stream` 解析（LF/CRLF/CR、`:` 注释、`event`/`id`/`data`/`retry` 字段、值前单个空格剥离、含 NUL 的 id 拒收、前导 BOM 剥离、多行 `data` 以 `\n` 连接、无 `data` 的分发中止并复位缓冲、id 跨帧持久（spec 行为）、`end()` 冲刷未终止尾行）。
- `openSseStream`：单连接；不自动重连——自然断流经 `onEnd` 上报，显式 `close()` 静默；非 2xx 以 `SseStreamError(status)` 拒绝（401 → 会话失效路径）。

## 2. 同步状态机（`src/stores/pairing.ts`）

状态：`IDLE`（未配对）→ `CONNECTING`（fetch 在途）→ `LIVE`（流开启，收帧）→ `RESYNCING`（快照在途）；`handleSessionLost`／`dispose` → 终止态（关流＋围栏递增）。

| 触发 | 动作 |
|---|---|
| `start()`/`pair()` 成功 | `paired=true`；`subscribe()`（首订无令牌，服务端答 `stream.ready`） |
| `stream.ready` 帧 | 复位重连／重同步计数；`syncEpoch := data.epoch`；令牌**不**从 ready 取（无 `id` 行，是服务端水位而非已应用游标）；通知 `stream.ready`（todos＋organizer 读回）＋队列失效通知 |
| 带 `id:` 行的帧（task/settings/progress 类） | `token := <epoch>:<cursor>`；同 epoch 下单调推进 `appliedCursor`；task/settings 类另发队列失效通知 |
| `item.changed`/`candidate.changed` | 纯提示（无 `id`），按事件名路由（todos／organizer） |
| `stream.reset` 帧 | **冻结 §6 字面补偿**：关流 → `GET /api/snapshot` → `organizer.applySnapshot` **消费**安装权威基线 → `token := snapshot.lastEventId`、`appliedCursor := highWatermark`、`syncEpoch := snapshot.epoch` → 以快照令牌重开连接（头携带）→ 通知 `stream.reset`（todos＋organizer 读回来源/候选，快照不含它们） |
| 流自然断开（`onEnd`） | 指数退避重连（250ms×2ⁿ，上限 2s），沿用**已应用令牌**——服务端按 §6 从该游标有界重放 |
| 连接 401（`SseStreamError`） | `handleSessionLost()`：回配对门；关流＋围栏递增＋令牌/游标/epoch 清零；organizer 草稿保留 |
| 401（共享客户端请求路径） | 客户端 `handleSessionLost` → 本 store 注册的处理器 → 同上 |
| `dispose()` | 关流＋围栏递增（门卸载语义与基线一致） |

- **围栏**：`syncSeq` 单调递增；每个在途续体（帧处理、快照、重连、重订阅）捕获捕获时序号，落点前比对——被取代管线的旧异步响应一律丢弃。
- **无循环**：`ready` 不触发快照/重订阅；快照令牌按构造可续（cursor＝高水位），重订阅后服务端答 `ready`，回路终止；重同步步进（100ms×n，上限 1s，`ready` 复位）仅约束病态 reset 风暴。
- **兼容**：`setOnItemChanged` 名称与零参处理器可用性保留（处理器现接收事件名字符串）；新增 `setOnTasksInvalidated(cb|null)`（私有展示面接缝）与 `syncEpoch`（队列围栏读）。

## 3. 快照消费与代次权威（`src/stores/organizer.ts`）

- **`applySnapshot(snapshot)`**（新增导出）：过期快照栅栏（同 epoch 且 `highWatermark ≤` 已应用游标 → 丢弃，旧异步响应不落地）；`generation`/`selectionGeneration`/`startGeneration` 全部递增（被跨 epoch 取代的在途请求续体隔离）；**禁止跨 epoch 就地合并**——运行/代次基线整体替换（用户草稿按 candidateId 键保留）；基线选择优先旧选中 run 的新代次，否则最新活跃 run。
- **`acceptRun` 代次权威**：携带 wire 元数据（`StoreRun`）时——严格更新版本→安装（**同 taskId、同 createdAtMs 的合法 retry（version/attempt 递增、非运行→运行）照常显示**；不虚构时间、不改 taskId）；较旧版本→返回已安装态（旧快照/重放帧/乱序读隔离）；**同版本保留两条既有守卫**（`MCP_RESULT_UNKNOWN` 哨兵＋旧不复活）。无元数据（预览 run、注入 seam）→ 逐字保留基线守卫。`createdAtMs` 只承担跨 run 展示选择，不再充当代次判据。

## 4. 客户端与队列（`src/lib/web-api-client.ts`／`src/components/TaskQueue.vue`）

- 客户端**纯加法**（+53/−1）：`readSnapshot()` 按 §6 收窄返回，任务经既有 `toModelRun` 同一映射；`StoreRun = ModelRun & {wireVersion,wireAttemptCount,wireState}` 附加式携带代次（domain 类型零改动）；预览映射与 apply 的 task-runId 契约不变。
- TaskQueue：轮询与失效通知走**同一条受围栏读回**（请求序 `refreshSeq`＋`pairing.syncEpoch` epoch 围栏，finally 守卫同判据）；分页走满 `nextCursor`（完整权威任务集）；`needs_review`/`interrupted` 占槽可见并如实标注（退出待核对／退出未知），不再误呈"没有任务"；取消按钮仅限 queued/running/cancelling（后端退出/重试门控零放宽）；重试/处置/并发入口**不接**（未定交互，不入本包）。

## 5. 事件路由（`src/components/PairingGate.vue`）

`item.changed`/`stream.ready`/`stream.reset` → `todos.refresh()`；`candidate.changed`/`task.changed`/`settings.changed`/`stream.ready`/`stream.reset` → `organizer.refresh()`。ready 重连不再只刷 todos；reset 在快照安装**之后**通知，读回覆盖快照不含的来源/候选。离开 inbox 页：权威任务态在 organizer store＋常驻订阅中，不依赖已卸载组件回调或轮询。

## 6. 已闭合判据对照（裁定 01a1c180 逐条）

| 判据 | 闭合方式 |
|---|---|
| 首订/重连来源与候选读回（ready 不只刷 todos） | ready 路由 todos＋organizer＋队列失效（§2、§5） |
| reset/epoch 快照安装、旧基线隔离、按快照令牌重订阅 | §2 reset 行＋§3 applySnapshot（消费、栅栏、头携带重订阅） |
| 已应用游标/对象版本及旧异步响应隔离 | 令牌只取已应用 id 行＋快照；`appliedCursor` 单调；acceptRun 代次权威；syncSeq/generation 围栏 |
| 同 task 合法较新 attempt 可显示 | acceptRun 严格新版安装＋可证伪探针（GREEN/CONTROL 双向，`build/mayne24-sse-sync-20261110/accept-run-probe.mjs`） |
| 离开 inbox 仍有任务权威态 | 权威在 organizer store＋常驻订阅；TaskQueue 仅展示面注册 |
| 快照不只 GET 不消费；轮询走同一受围栏读回 | applySnapshot 消费；TaskQueue 轮询＝失效＝同一 refresh |
| 避免 ready→snapshot→重订阅循环 | 构造上不可能（§2 无循环条） |
| 401/重配/dispose 终止旧流旧同步、保留草稿、cookie/CSRF 不入 URL/持久化 | syncSeq 围栏＋handleSessionLost 清协议元数据；头携带令牌；零存储写入 |
| 只留必要协议元数据、帧载荷不当安全证明 | store 不收帧 data；仅 token/epoch/游标留内存 |

## 7. 需兼容适配的既有测试（先报不削）

- `tests/unit/web-manual-items.test.mjs` SSE 提示用例（约 :541）：以 `globalThis.EventSource` 假类注入并计数 3 次处理器调用（`stream.ready`/`item.changed`/`stream.reset`）。传输改 fetch 流后该注入面消失；**断言意图不变**（三个事件名触发提示处理器；同文件另两个 pairing 用例——会话丢失回门与 dispose——按构造仍绿）。适配方式：假类改为 mock 同源 fetch 事件流＋注入 client 增加 `readSnapshot` 桩（reset 的处理器时序按契约变为"快照安装后"）。该文件不在本包授权写入集内，本包不执行不改写，交协调层路由。
- 本分支不可运行（服务端接收集缺失，登记既有）：`web-manual-items.test.mjs`、`web-text-intake-receipts-restart.test.mjs`、`web-text-intake-test-safety.test.mjs` 等；结构守卫 FAIL 集 与父提交 `48880a2` detached 树逐行全等（11 条，零新增）。

## 8. 验证与边界

聚焦验证全绿（各例远低于 20000ms 含清理）：解析器 12/12；`npm run typecheck` exit 0；s2-client 35/35（含真实管道迟到取消用例，断言零改动全过）；layout-domain 14/14；`check:structure` FAIL 集与父全等；可证伪探针 GREEN/CONTROL 双向 exit 0。**未做**（如实）：浏览器/原生旅程、真实模型、`test:web-text-intake` 聚合（缺 I/II 接收集）、完整 `npm run check`、Pi 黑盒与 ZCode 能力 UI 套件（他人独占）、`agentConcurrency` 的 UI 消费（设置面归属他包）。**后继缺口（最小清单）**：① TaskQueue 重试/处置（resolve/retry）入口接线；② 并发设置读回 UI；③ `tests/unit/web-text-intake-sse-stream.test.mjs` 是否并入聚合命令（package.json 不在本包写入集）；④ 旧 web-manual-items SSE 用例的注入面适配。原始证据：`build/mayne24-sse-sync-20261110/`（gitignored）。
