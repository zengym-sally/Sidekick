# 任务 SSE 同步包 R2：令牌纪律／快照竞态闭合与组合基准更正（MAYNE-24，2026-11-10，OpenCode）

- **授权**：协调层核读评论 `01a1c1a5-a337-721a-80ac-ca3b4961c1c5`（对 `fdf89c1 → b8a659b → 997291e` 的三项先处理要求＋`tests/unit/web-manual-items.test.mjs` SSE 接缝适配授权＋resolve/retry、并发设置 UI 只读清单要求）。本 R2 是对评论 `01a1c1a1`（R1 交付）的最小修订；**R1 记录原样保留不反签**，本记录按三项要求逐项更正。
- **基点**：分支 `agent/opencode/mayne-24` 于 `997291e`（R1 记录顶），本轮新提交：`9cb0b70`（生产修订，恰 3 文件）→ `d3feccd`（caller-epoch 追加，恰 2 文件，由绿色探针发现的第一快照缺口）→ `c5f5234`（测试接缝适配，恰 1 文件）。作者不自签；生产修订与测试适配一并交未参与者独审。

## 1. 三项核读的逐项闭合

### 1.1 第 1 项：游标／epoch／实际应用令牌纪律（`src/stores/pairing.ts`）

R1 的 `applyFrameToken` 三处缺陷（无条件写 token、直接切换外 epoch、`appliedCursor` 不参与拒绝判据）整体替换为 `acceptFrameId` ＋ `commitAfter`/`commitApplied`：

- **`appliedCursor` 是拒绝判据**：帧 `id` 游标 ≤ 已应用游标 → 整帧忽略（不派发提示、不推进），重连令牌不可能倒退（§6 客户端应用规则字面化）。
- **epoch 不随帧切换**：外 epoch 只经 `stream.reset` → 快照路径跨越；异 epoch 数据帧路由到该路径（`void resync()`）并整帧忽略。首帧仅做初始采用（null → 首见），不是切换。`stream.ready` 的握手赋值移到令牌-epoch 不一致检查**之后**——否则新实例低游标会被快照围栏误判为同 epoch 旧快照（§6：cursor 是实例内值，新实例游标回退不构成旧事件）。
- **到达 ≠ 应用**：帧游标只在**其派发的权威读回链成功完成**后提交（`commitAfter`：`Promise.allSettled` ＋ `syncSeq` 围栏；失败链或未触发读回的提示不提交——令牌保守，重连重放补投提示）。每次读回都是全量读，一次成功链证明其游标及之前的全部事件。
- **接缝消费**：`onItemChanged`/`onTasksInvalidated` 处理器可返回 promise（void 返回仍合法——旧零参处理器不变）；`PairingGate.vue` 改为**返回原始 `Promise.all(reads)`**（不再内部吞错——失败经 allSettled 阻止令牌提交）；ready/reset 两处 fire-and-forget 通知以 `Promise.resolve(...).catch(()=>{})` 消费。
- **重同步 applied-cursor 快照围栏**：同 epoch 且 `highWatermark ≤ appliedCursor` 的快照是旧异步响应——**不消费**（R1 会安装并把令牌倒退为 `lastEventId`），以已提交令牌恢复订阅；跨 epoch 快照始终走整体换代。

### 1.2 第 2 项：快照与较新读回的竞态（`src/stores/organizer.ts`）

R1 的 `applySnapshot` 任何安装都清空版本表——同 epoch 旧快照在途期间已有较新任务读回落盘时，会抹掉版本保护并回退状态。闭合：

- **同 epoch ＝ 逐任务合并**：行经 `acceptRun`（wire 代次权威）逐行裁决——比已安装代次旧的行被拒（返回已安装态），版本表**不清空**，快照未携带的 run 保持受保护；展示 run 仅被自身更严格代次取代，否则已知即保留，再否则取快照中最新的 running 行。
- **跨 epoch ＝ 明确整体换代**：仅跨 epoch（或无 epoch 知识的调用方）清空 run/代次表整体重建，`previous??active` 选择；跨 epoch 就地合并继续禁止。
- **第一快照缺口（`d3feccd`，由确定性探针发现）**：store 只知道自己安装过的快照的 epoch，首装必然被当成跨 epoch 走整体换代——即使调用方管线同 epoch 且较新读回已装 v3。修复：`applySnapshot(snapshot, currentEpoch=null)`，同/跨 epoch 判据比较 `snapshot.epoch === (currentEpoch ?? snapshotEpoch)`；真实调用方（pairing 重同步）传 `syncEpoch.value`（在采纳快照 epoch **之前**取值）。无 epoch 知识的调用方保持历史行为。
- 等于/低于快照水位的同 epoch 快照照旧丢弃（水位围栏保留）；草稿（按候选 id 键的用户内容）两个分支都保留。

### 1.3 第 3 项：组合基准记录更正（本节替代 R1「基点」段的相应表述；R1 原文保留）

协调层指出的事实今日在对象库复算成立：

| 路径 | `fdf89c1` 实际 blob | 组合基准应为 | 判定 |
|---|---|---|---|
| `src/lib/web-api-client.ts` | `e730d4a3`（b5） | `e730d4a3`（b5 覆盖冻结 I 的 `2aa6e481`） | 相符 |
| `src/stores/organizer.ts` | `d4b824cb`（b5＝冻结 I） | `d4b824cb` | 相符 |
| `src/components/TaskQueue.vue` | `1bd5d476`（b5＝冻结 I） | `1bd5d476` | 相符 |
| `src/components/PairingGate.vue` | `01e43233`（＝main＝cd08588） | `01e43233` | 相符 |
| `src/stores/pairing.ts` | **`3ae7deb3`（main 原三事件字节）** | **`d04b09a9`（冻结 I 五事件字节）** | **不符——R1 记录称其"已是基准字节"不准确** |
| `src/lib/sse-stream.ts` | 不存在 | 不存在（本包新增文件） | — |

- **差异的准确内容**：`3ae7deb3 → d04b09a9` 恰为 +3/−1——订阅事件名清单加 `task.changed`、`candidate.changed`（三事件 → 五事件）。三文件 b5 采纳成立；实现父树（`fdf89c1`）不能称为完整组合基准。
- **真实完整基准差分**（替代 R1 随附的 `composition-baseline-delta.patch`，后者按其声明的 `fdf89c1 → b8a659b` 范围仍然真实、保留不撤）：构造真组合基准树（`fdf89c1` 树＋pairing 逐字节换 `d04b09a9`，hash-object 复算相等），对本分支 HEAD（`c5f5234`）生成恰 7 个文件节的差分（六生产路径＋解析器自测新文件），`git apply --check` 于真基准树通过。SHA-256：`7670a3a932384340a8f78d14a55c016720eaacbc965cd03af67af62af58de871`（随本评论挂载 `composition-baseline-true-delta.patch`）。pairing 的真实基准差因此从 `3ae7deb3`（R1 所用）改从 `d04b09a9`（五事件 EventSource 版）起算——完整传输重写如实计入差分。

## 2. 确定性前后反控（生产、测试、记录分清；原始证据 `build/mayne24-sse-rev-20261110/`，gitignored）

同一探针脚本两种期望模式，全部断言按模式分别成立、exit 0；观察点是**重连请求的 `Last-Event-ID` 头**（令牌的唯一可观测出口）与 store 真实状态——不在探针里过滤旧事件：

| 探针 | 红基线（受审 `b8a659b` 字节；detached 树实测） | 绿（修订后字节实测） |
|---|---|---|
| `token-discipline-probe.mjs`（真实 `createPairing`＋真实 `openSseStream` fetch 流） | 11/11：读回未完成重连头**已**是 `e1:12`（到达即提交）；更小游标 `e1:5` **令头倒退**且旧帧仍派发；异 epoch `e2:100` **就地翻转** `syncEpoch`、零快照调用；无读回 progress 帧令头 `e1:30`；重同步消费低于已应用游标的旧快照并令头倒退 | 11/11：读回未决头缺位（到达≠应用）；读回成功后头 `e1:12`；小游标帧忽略（零派发、头不退）；异 epoch 帧走快照路径（快照调用 1、`syncEpoch` 保持 `e1`、消费 1）；progress 帧头不动；旧快照不消费、头保持 `e1:20` |
| `snapshot-race-probe.mjs`（真实 `createOrganizerModel`＋脚本化假后端） | 11/11：同 epoch 旧快照把已装 v3-running **回退**为 v2-cancelled（版本表清空后旧行不拒）；后续旧 v2 读回持续占据；不含 A 的快照把展示**切换**到快照自身活动行 | 11/11：旧快照落盘后 v3-running 保持、版本保护完好（后续 v2 读回被拒）；A 不在快照中时展示保留 A；等水位快照丢弃；跨 epoch 恰为整体换代（两模式同断言） |

红基线运行树：`/private/tmp/multica-task-1204452340/opencode/rev-baseline-997291e`（detached `997291e`，其 src 与 `b8a659b` 逐字节同——其上仅 docs 提交；node_modules 符号链接至本树，零复制）。`d3feccd` 的缺口由绿探针在 `9cb0b70` 字节上实测暴露（S2 首快照回退 v3→v2）后闭合，红绿各重跑通过。

## 3. `tests/unit/web-manual-items.test.mjs` SSE 接缝适配（提交 `c5f5234`，独立小提交）

- 恰两处 hunk：import 块加 `useOrganizer`/`createPinia`/`setActivePinia`（resync 经 organizer store 消费快照需激活 pinia）；`pairing re-reads on stream.ready/stream.reset/item.changed` 一例把 `globalThis.EventSource` 假类（传输已不读该注入面——原用例断言失败且失败路径跳过 dispose，未界重连循环会挂起整个文件运行）换成**真实传输**：mock 同源 fetch 的 `text/event-stream` 体＋注入 client 的 `readSnapshot` 桩（真实 §6 快照形状，任务按客户端同形映射 StoreRun）。
- 断言意图保留并锐化：三提示各通知恰一次（`refreshes===3`，处理器本体零改动——旧零参 void 接缝）；`stream.reset` 仅在快照**消费后**通知（断言 `organizer.run.id==='tsk_snap_1'`——reset 在快照安装后的时序）；重订阅以 `Last-Event-ID: inst_probe:7` 请求头携带快照令牌；dispose 进 finally 无条件执行（失败断言不可能留下悬挂重连）。会话丢失／dispose 语义仍在其独立用例（零改动）。
- **实际运行（非按构造）**：`--test-name-pattern=pairing` → 2/2 pass exit 0（35.5ms＋0.2ms）；**全文件** → 27/27 pass exit 0（177ms），每例远低于 20000ms 含清理；基线树交叉复核未触碰用例 1/1。用例数 27＝27（`997291e` 对照），恰两 hunk，不削任何断言。
- 新解析器／黑盒／能力测试**不**并入聚合（package.json 零字节），按派工待各自审过再统一接收。

## 4. 聚焦验证（本树实测）

`npm ci --ignore-scripts` exit 0；`npm run typecheck` exit 0；`tests/unit/s2-client.test.mjs` 35/35；`tests/unit/layout-domain.test.mjs` 14/14；`check:structure` FAIL 集与 `997291e` detached 基线**逐行全等**（既有登记缺口 11 条，零新增，含 `d3feccd` 后复验）；`check:docs` exit 0（23 文件 592 链接＝581＋本记录及索引行）。未跑聚合套件／完整 gate／浏览器旅程；MAYNE-24 保持 `in_progress`。

## 5. 只读清单：resolve/retry 与并发设置 UI（后继另派，不夹入本同步修订）

**既有端点与语义（冻结 `web-api-contract.md` §4.5／§5／§3.2–3.5，客户端薄封装已在 `src/lib/web-api-client.ts`）**：

- `POST /api/tasks/{taskId}/retry` `{expectedVersion, configRevision?}` → 202 任务资源（`queued` 新 attempt）。CAS＝**任务资源 version**；错误：409 `state_conflict`（仅 `retryable=manual` 可用；`auto_backoff` 归调度器、`none` 无入口）、409 `config_revision_change_not_allowed`（非配置类失败携带 configRevision）。`configRevision` 更新当前修订、`originalConfigRevision` 保留；凭据引用不随 retry 切换。
- `POST /api/tasks/{taskId}/resolve` `{expectedVersion, decision:"resume"|"cancel", acknowledgedReceipts:[receiptId]}` → 202 任务资源。CAS＝**条目版本**（任务资源经 `recovery.itemVersion` 暴露＝`recovery_items.version`，与 hold 条目入口同一操作同一版本守卫）；`exited_unknown` 一律 409 `exit_unconfirmed`（`result_exit_unconfirmed` 回收后可见暂存结局例外）；400 `acknowledgedReceipts` 未覆盖全部可核对回执拒 resume；已 `resumed`/`cancelled` 条目旧请求 409 `state_conflict`。处置成功任务与条目版本同时递增；`resume` 需 `attemptExitState=exited_confirmed` 且回执核对完成（`needs_review`→`queued` 仅用户显式）。
- `GET /api/settings/agent-concurrency` → `{contractVersion, agentConcurrency, default, version, runningCount, queuedCount}`；`PUT` `{agentConcurrency, expectedVersion}` → 200。CAS＝**设置自身版本**（非任何任务 version）；正整数否则 400 `validation_failed`；不匹配 409 `version_conflict`。语义：默认 3 实例级持久；上调立即补发空槽、下调待自然退出不杀任务；不影响任务 version；变更广播 `settings.changed`；`exited_unknown` attempt 仍占槽不计入空槽。快照（§6）亦携带 `agentConcurrency` 读回面。

**最小文件清单（候选写入面，供后继派工裁定）**：`src/components/TaskQueue.vue`（retry/resolve 行内入口＋状态门控——取消按钮现仅 queued/running/cancelling，retry 仅 failed 且 `retryable=manual`、resolve 仅 needs_review/interrupted 占槽且按 `decisionOptions`/`cause` 出口）；`src/lib/web-api-client.ts`（零改动——`retryTask`/`resolveTask`/`readConcurrency`/`writeConcurrency` 均已在册）；并发设置读回 UI 需新面板或复用 `src/components/SettingsPanel.vue`/`TaskQueue.vue` 摘要行（写入归属按现行四文件转授裁定，未定不预造）。

**交互验收要点（冻结语义）**：① 过期版本一律 409 `version_conflict`，客户端重读后按新版本重新决策，不得自动重放旧版本；② `exited_unknown` 占槽如实呈现（退出未知），resolve 被拒时展示 `exit_unconfirmed` 事实而非报错遮蔽；③ retry 按钮仅 `retryable=manual`，配置类失败提供 configRevision 路径；④ resolve(resume) 前回执核对清单必须全部确认；⑤ 并发调整后 `settings.changed` → 受围栏读回刷新（队列/快照面已接，设置读回面接同一围栏）；⑥ 不放宽后端退出／重试门控（`auto_backoff` 归调度器、安全证明缺失不自动重入队）。

## 6. 边界与未做

未做：浏览器／原生旅程、真实模型、聚合运行、完整 gate、Pi 黑盒／ZCode 能力套件（他人独占，零触碰）；resolve/retry/并发 UI 未实现（本节为只读清单，后继另派）；R1 记录与其证据原样保留（含其中现已被本记录更正的组合基准表述——按版本保留原则不改写）。ZCode 行为回归与 Hermes 连接测试补证继续原线；E/D、GAP-5 及整体准出仍开放。
