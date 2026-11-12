# MAYNE-24 任务 SSE 最小修复路线（只读）与本审角色／native 推导更正

- 日期：2026-11-10；作者：OpenCode（III／工程，本人未写相关生产字节）
- 派工：协调层评论 `01a1c15f-071c-7020-bcb8-9d8f123d9320`（对本记录的唯一任务来源）
- 性质：**只读路线提案**。无生产／测试／package 改动；实施待协调层裁定后另派。MAYNE-24 保持 `in_progress`。

## 1. 范围与字节基点

- 本分支 `agent/opencode/mayne-24` HEAD `84aa934`；全部生产字节从共享对象库读取：
  - 后端＝`cd08588`（完整 I，已接收 `01a1c0c4`）；
  - 前端＝冻结 I `d79b1f6` ＋ b5 所选覆盖 `b5fdfb9`（`web-api-client.ts` `e730d4a3`、`stores/organizer.ts` `d4b824cb`（与冻结 I 同 blob）、`TaskQueue.vue` `1bd5d476`（与冻结 I 同 blob）、`TextIntake.vue` `b6c1897d`、`ModelSettingsPanel.vue` `0216921e`）；`pairing.ts` 取冻结 I `d04b09a9`（b5 未选）；`PairingGate.vue`／`App.vue` 与 main `1e37044` 同字节（`01e43233`／`a4f6a495`，本日 `git rev-parse` 复核）。
- 冻结输入复核：`docs/engineering/web-api-contract.md` 本树 SHA-256 `61863271…cab86f58d` ＝ 冻结登记值，逐字节一致；整理契约 §6.3 按本树文件读回（该文件经 III 元数据登记流程，正文条款未动）。

## 2. 冻结契约条款（本路线的判定基准）

**web-api/1 §6（SSE 事件与高水位快照补偿）**：订阅握手每 次（首订或重连）必发 `stream.ready{contractVersion,epoch,cursor}`（无 `id` 行）；事件帧 SSE `id`＝`<epoch>:<cursor>`，客户端回传 `Last-Event-ID`；短断线（同 epoch、游标在留存窗）从该游标后补发；epoch 变化／令牌不可解析／游标超窗→先发 `stream.reset`（带当前 epoch 与原因，无 `id`），客户端**必须** `GET /api/snapshot` 重新同步，禁止跨 epoch 就地合并；快照含 `highWatermark` 与此前全部事件的权威态，客户端以快照 `lastEventId` 重订，快照生成期间变化按 `cursor > highWatermark` 补发；客户端只应用同 epoch 事件，`cursor ≤` 已应用游标或 `objectVersion` 更旧的事件忽略。

**整理契约 §6.3（候选提示与 SSE 补偿）**：任务帧沿用冻结 §6；`candidate.changed` 为进程内提示帧（无 `id`、不计任务 cursor、不写 `task_events`）；客户端在**首次订阅／重连／`stream.reset` 后**经 `/api/text-sources`／`/api/candidates` 读回补偿。

## 3. 现有接口实际支持程度（本日字节核对）

### 3.1 服务端（cd08588）——冻结 §6 已完整实现

- `server/lib/sse-hub.mjs`：单实例 `epoch`（`inst_<hex>`）；`addClient` 先按调用方传入的**真实** `task_events` 高水位做 `replayFrom(last-event-id)` 判定（epoch 不符→`epoch_changed`、格式错→`malformed_last_event_id`、游标 > 水位或 < 驱逐界 `evictedThrough`→`cursor_out_of_window`，均先发 `stream.reset`＋原因；合法→按游标过滤 500 帧有界留存窗补发），随后**必发** `stream.ready{contractVersion,epoch,cursor:高水位}`，同一连接继续。`task.changed`／`settings.changed` 带 `id:<epoch>:<cursor>` 并入留存窗；`candidate.changed`（`{objectType:'candidate',sourceId}`）与 `item.changed` 为无 `id` 提示帧，不入窗。
- `server/lib/http-server.mjs` `:410-424`：`GET /api/events` 先 `taskService.readHighWatermark()`（`task_events` MAX(cursor)）再 `addClient`；`snapshot` handler：先读水位→任务列表按 200/页拉平为**全量**→返回 `{contractVersion,highWatermark,lastEventId:"<epoch>:<hw>",epoch,tasks,agentConcurrency}`，与冻结 §6 同形。
- `server/lib/task-scheduler.mjs` `notify()`（:61-78）：任务迁移**提交后**按 `latestEventCursor`（该任务 `task_events` 真实 cursor）广播，尽力而为、失败不回滚已提交态；`server/entries/web-backend-entry.mjs` `:79-89`：SSE、`task_events`、`instance_epochs` 共用单一 epoch；`onCandidatesChanged→sse.broadcastCandidateChanged`。

### 3.2 客户端（b5 `e730d4a3`）——无快照方法、无 SSE；但 §6.3 读回端点已全命中

- 全文无 `/api/snapshot` 调用、无 `EventSource`（订阅在 pairing store）。
- organizer 命令面映射（:970 起）逐条命中：`list_import_batches`→`GET /api/text-sources`（limit 200）＋每来源 `GET /api/text-sources/{id}/candidates?status=pending` 与无 status 各一次；`read_import_batch`→`GET /api/text-sources/{id}`（source+run+candidates+previews）；`active_model_run`→`GET /api/tasks`；`read_model_run`→`GET /api/tasks/{id}`。**即一次 `organizer.refresh()` 恰为 §6.3 要求的 text-sources／candidates 读回**。
- `stores/organizer.ts`（`d4b824cb`，64 行）`refresh()`：`generation` 逐请求丢弃过期响应；`acceptRun` 旧不复活（`MCP_RESULT_UNKNOWN` 不复活终态）＋仅当无旧值／同 id／`createdAtMs` 更新才接受新 run——旧响应隔离与「合法新 attempt 不被挡」的现成判据。
- `stores/agents.ts`（`da044b6e`）：`load(id)`→`GET /api/agents/{id}`，带 per-role `generation` 围栏。

### 3.3 订阅接缝与补偿现状

- `stores/pairing.ts`（`d04b09a9`）`subscribe()`：`new EventSource('/api/events',{withCredentials:true})`，事件名表 `['stream.ready','stream.reset','item.changed','task.changed','candidate.changed']` **五事件全部汇入同一无参回调** `onItemChanged`；`dispose()`／401 `handleSessionLost()` 关流。`:27-28` 注释「the handler re-reads through the task/text-source endpoints」与实际不符（r1 ④ 已定位）。
- `PairingGate.vue`（`01e43233`）`:13`：`pairing.setOnItemChanged(()=>{void todos.refresh().catch(()=>{});})`——唯一回调＝manual-items 重读。
- 补偿的真实覆盖面：`TaskQueue.vue`（`1bd5d476`）挂载读＋1s `listTasks` 轮询，但**仅挂载在 inbox 页**（Workbench `c5af8bac` `:162` `v-if="page==='inbox'"`），且其 `refresh()` 无请求序围栏；Workbench poller `:121` 仅 `organizer.running` 时每秒 `organizer.refresh()`；boot `loadTextIntake()` 一次性 `organizer.refresh()`。
- 传输事实：原生 `EventSource` 断线自动重连时**自动**回传 `Last-Event-ID`（浏览器标准行为，服务端 `replayFrom` 直接消费）；但手动重订阅无法经原生 API 携带自定义 `Last-Event-ID` 头。

**结论**：`candidate.changed`／`task.changed`／`stream.ready`／`stream.reset` 的重读均只到达 todos（manual-items），organizer 拥有的来源／候选／run 与 TaskQueue 拥有的任务列表不经提示补偿；离开 inbox 页后任务侧零重读。这就是 §6.3「首次订阅／重连／reset 后读回」与冻结 §6「reset→快照重同步」未落地的全部残差；r1 ④ 定位成立且需要比「并入一个 organizer.refresh()」更精确的路线。

## 4. 最小修复路线（四文件，全部既有冻结 HTTP 与既有接缝上加法）

> 不新增公共查询协议、授信开关、依赖；不改 server／domain／shared／package；不把 `organizer.refresh()` 或秒轮询写成完整补偿——轮询仅保留为兜底，不承担契约责任。

- **R1 `src/stores/pairing.ts`**：把「五事件→单无参回调」改为事件名感知提示——`setOnItemChanged(handler)` 形参扩为 `(event: string)`（推荐，保持单一接缝；备选：新增第二 setter）。`dispose()`／`handleSessionLost()`／配对流程不动；不向回调传帧 `data`，不做任何帧载荷落库。
- **R2 `src/lib/web-api-client.ts`（b5 字节，OhMyPi 唯一写入）**：新增**唯一**私有方法 `readSnapshot()`→`GET /api/snapshot`，返回按冻结 §6 收窄（`{epoch,lastEventId,highWatermark,tasks,agentConcurrency}`）。此外零 client 改动。
- **R3 `src/components/PairingGate.vue`（基线字节，路由待协调）**：按事件名路由——`stream.ready`／`item.changed`→`todos.refresh()`（现状保持）；`candidate.changed`→`organizer.refresh()`（§6.3 读回，端点已验证全命中）；`task.changed`→`organizer.refresh()`＋TaskQueue 失效通知；`stream.reset`→`client.readSnapshot()` 建立新 epoch 权威基线后触发同一组重读。
- **R4 `src/components/TaskQueue.vue`（OhMyPi 唯一写入）**：仿 `setOnItemChanged` 形态新增私有失效回调（如 `setOnTasksInvalidated(cb)`），收到通知立即用其现有 `refresh()` 重读（跨客户端提交／补发帧不再等 ≤1s 轮询，且覆盖离开 inbox 页的时段）。可选并入：`refresh()` 补 `generation` 围栏（现无请求序围栏，慢响应可覆盖新响应——**既有缺口**，登记待裁定是否随本包修）。

### 逐条款核对（本路线 vs 冻结 §6／§6.3）

| 条款 | 现状 | 修复后 |
|---|---|---|
| 首次订阅读回 | `stream.ready`→仅 todos | `stream.ready`→todos＋organizer（§6.3）＋TaskQueue 挂载读（现状） |
| epoch/reset→GET snapshot | 无 snapshot 调用；reset→仅 todos | `stream.reset`→`readSnapshot()`＋同组重读；帧不落状态，跨 epoch 就地合并结构性不存在 |
| 高水位／Last-Event-ID 补发 | 原生重连自动带令牌；服务端按真实水位判合法并补发（既有） | 不需 client 改动；补发帧经 R3 路由触发正确重读 |
| 旧事件／旧响应隔离 | 帧无载荷进 store；organizer `generation`＋`acceptRun` 既有 | 不变；R4 可选补 TaskQueue 同形围栏 |
| 合法新 attempt | `acceptRun` 新 `createdAtMs` 接受；retry 后提示触发读回 | 修复不得改动该判据（测试钉住） |

## 5. 私有接口约束（供实施与红绿回归钉住）

1. pairing 提示回调形参＝SSE 事件名字符串；五事件名与服务端 sse-hub 实发名逐一相等（字节事实）；回调不得收到帧 `data`。
2. `readSnapshot()` 只 GET 冻结端点 `/api/snapshot`；返回值不作 store 合并，仅作 reset 基线＋重读触发；不新增任何查询面。
3. TaskQueue 失效回调为私有组件接缝（与 `setOnItemChanged` 同形），不进 store、不进公共 API。
4. store 围栏不动：organizer `generation`／`acceptRun`、agents per-role `generation` 语义保持。
5. **传输约束（如实报告）**：冻结 §6「以快照 `lastEventId` 重新订阅」的字面完整实现需把原生 `EventSource` 换为 fetch 流读取器才能携带自定义 `Last-Event-ID` 头——属传输层设计变更，**本路线不采用**。等价达成：reset/ready 在同一连接上由服务端完成握手（`replayFrom` 对旧 epoch 令牌一律 reset，不存在跨 epoch 合并路径），reset 后基线由 `readSnapshot()`＋重读建立，其后每帧继续触发重读收敛。若裁定必须字面重订阅，另派传输层改动，不夹入本最小包。

## 6. 待协调裁定

1. 传输层：接受「同连接 reset＋快照重读收敛」为 §6 reset 条款的实现形态，还是要求字面重订阅（需 fetch-stream，另派）。
2. R4 的 TaskQueue `generation` 围栏微修是否并入本包（属既有缺口，非 SSE 引入）。
3. 四文件写入归属路由：`web-api-client.ts`／`TaskQueue.vue`＝OhMyPi 唯一写入；`PairingGate.vue`＝基线字节；`pairing.ts`＝原 I 清单（现无活跃写入者）。Pi 的 `tests/unit/web-text-intake-sse-client.test.mjs` 黑盒回归按本节约束钉接缝形态。

## 7. 本审（r1 `84aa934`）角色／native 推导更正

1. **③更正**：撤回「tracker/advisor 配置标签页所发均为真实支持的端点（懒触发），非误请求」。实际：`cd08588` `server/lib/http-server.mjs` `:19` `WIRED_AGENT_IDS=['organizer']`；agentRead/Write/Reset（:916-941）均先过 `requireWiredAgent`（:910-914）——tracker/advisor 属已知未接线角色，GET/PUT/reset 一律 **404 `not_found`**「该智能体角色不在本切片接线范围内」。`config-store.mjs` `:32` `AGENT_IDS` 三角色是领域储备，不是 HTTP 接线证明。浏览器打开这两页（含 ModelSettingsPanel b5 `:64` 对三角色的 eager 预读）会收到真实 404 并进入错误态。r1 ③ 中仍成立的部分：organizer 提交路径、试跑五命令浏览器零 HTTP（read/active/latest/cancel 客户端返回 null、start 在任何 fetch 前抛 `unsupported_command`）、五文件无钥匙串／CredentialProvider／D1 触点。
2. **⑤更正**：撤回「About『三个内置智能体配置』在浏览器已成真」。实际仅 organizer 接线，About 文案仍超出真实可用范围；能力面修复属 ZCode 三文件包（本路线不含）。
3. **native 推导更正**：撤回「native 无回归」。七项载荷与 main 逐项相同是结构字节事实，未运行 native 路径，不能推导运行行为无回归；降级为「载荷结构相同，native 运行行为未验证」。
4. 对协调层 b5 能力面核读的认同（本日字节复核）：ModelSettingsPanel b5（`0216921e`）`:64` 确对 `['organizer','tracker','advisor']` 逐一 eager `agents.load`（后两者即两次真实 404）；AgentSettingsPanel（`107b8d74`，与 main 同字节）标签均可点；`:49` 凭 `nativeBridgeAvailable` 选钥匙串文案而 models/agents 默认均 asBackend、隔离试跑在该适配器对所有宿主 unsupported——修复必须按实际管道（HTTP organizer-only）表述与禁用，不能只加 `nativeAvailable` 解锁。

## 8. 边界与未验证项

- 静态只读：`git show`／`git rev-parse`／`shasum`；无构建、无门禁、无动态探针；未操作 main；零生产／测试／package 改动。
- 本路线是提案，未实施、未跑任何红绿回归；Pi 的 SSE 黑盒回归与其红面归属以裁定后的接缝形态为准。
- native 路径运行行为、真实模型、Linux、真实凭据／用户根等未验项原样保留；GAP-5／E／D 等准出前置不变。
