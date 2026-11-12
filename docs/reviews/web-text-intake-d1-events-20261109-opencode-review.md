# Web 文本接入 · D1／任务事件补偿批独审记录（2026-11-09，OpenCode）

派工：MAYNE-24 评论 `01a1bec3-5cf4-719a-b804-82249b5da59b`（Codex，2026-11-09）。先完成已排 RS-1／r2 续审（评论 `01a1bed3`、本分支 `b7c8107`），随后独审本批**生产修复**与**新增 events 测试**两部分，分别给明确结论。本人未写这两部分（作者 Kimi），符合作者／评审者分离。

## 结论先行

- **生产修复（`ef50461..7613843` 五文件 +155/−57）：通过。** 锁定身份、不变面、静态围栏全部复核一致；`82e1bf2` 恢复回归按派工原样字节独立重放：HEAD 连续两轮 **11/11**＋D1 单独三连跑全绿，基线 `ef50461` 反证 **10/11 恰 D1 红**（失败点与登记逐字一致）；派工六个重点面（提交失败／晚到竞争、retry/cancel 错误码、终态通知与重连交错、审计空隙／真实淘汰边界、全量快照分页与高水位、断线隔离）以真实 HTTP＋SSE＋调度＋真实存储二进制端到端探针 **8/8 通过**，同探针在基线上复现全部缺陷（双 202＋幻影事件、终局零游标推进、快照静默截断、`pendingExit` 残留）。
- **新增 events 测试（`727c6fb`，`tests/unit/web-text-intake-events.test.mjs` 11 例）：通过（作为本批回归接收）。** 真实存储二进制＋生产服务层驱动，HEAD 两轮 **11/11**；基线反证 **5/11**，六个失败面与本批五个修复点一一对应、可证伪性成立。E-2/E-4/E-5/E-6/E-6b 在基线通过属前向保护（守卫既有），如实登记、不计入修复证明。

## 1. 身份与锁定数

- `76138439897057ff6531527187c68c82fde1c986` tree 复算 = `c000e4a0b33b99890b59db1512a10d944fe6d6d7` ✓；`ef50461..7613843` 恰 5 提交；测试提交 `727c6fb`、交付记录 `681c282` 均在该链上 ✓。
- 生产差异 numstat 复算：`http-server.mjs` +25/−8、`sse-hub.mjs` +28/−11、`task-scheduler.mjs` +30/−11、`task-service.mjs` +36/−24、`text-intake-service.mjs` +36/−3 = **+155/−57**，与 Codex 锁定数一致；交付记录 §结论先行 的 +142/−55 是文档初稿数（作者 admission 同样登记 +142/−55），按派工以 +155/−57 为准。
- 不变面：tree diff name-status 仅 `server/lib/` 五文件＋新增 events 测试＋docs；Rust／DDL／003 冻结哈希／package／前端／Runtime／II／III 零差异，按派工复用未重跑。

## 2. 证据读回

- 作者附件 `mayne24-d1-events-evidence.tar.gz`（17783 B）CLI 下载、解包、`SHA256SUMS.txt` **24/24 项复算 OK**；全部 stderr 均为空文件哈希 `e3b0c442…`，与「stderr 0 字节」登记一致。
- **登记（非阻断）：包内缺恢复回归基线 TAP**——`01-recovery-baseline-ef50461` 只有 0 字节 stderr、无 TAP 工件，基线 10/11 反证在包内没有原始证据。这正是派工要求原样重放的原因；本审独立重放补齐了该工件（见 §3），作者登记数字与本审实测无冲突。
- 交付记录 `681c282` 全文读回；§3.1／§3.2 的数字与本审独立重放逐项吻合（基线 10/11 D1 `cursor_out_of_window` 8.8s↔8.9s；HEAD 11/11；events 修复前 5/11 失败清单逐项对应）。

## 3. 独立重放（隔离 detached 树，用后即删）

重放环境：候选树自身 Rust 源（`src-tauri` 树 `48b54730`，ef50461↔7613843 相同）编译存储二进制 **2649408 B／`42af54b5…490fc2`，与全部既往登记逐字节一致**；Pi provenance `ad702637`／`e89822b0`、organizer `08f32db2…` 2515908 B、node `9d050fd4…`、lark-cli 1.0.98、Node v24.20.0 均与既往登记相同。诊断说明：从本人（III 文档线）分支编译会得到不同二进制——III 分支不含 003/store 谱系，属编译源差异而非不确定编译，已按候选树源码重编消除。

| 运行 | 树 | 输入字节 | 结果 |
|---|---|---|---|
| 恢复回归 ×2 | HEAD `7613843` | `82e1bf2` 更正字节（sha `3ab536c9…` 核验后原样覆盖，跑后还原登记字节 `bf2e6b10…`） | **11/11 exit 0 两轮**，stderr 0；D1 过 |
| D1 单独 ×3 | HEAD | 同上 | **3/3 全绿**，stderr 0 |
| 恢复回归基线 | BASE `ef50461` | 同上 | **10/11，恰 D1 红**：`the staged-window snapshot token was never resumable (frozen §6): last reset {"reason":"cursor_out_of_window"}`（8.9s），stderr 0——失败点与作者登记逐字一致 |
| events 回归 ×2 | HEAD | `727c6fb` 原字节 | **11/11 exit 0 两轮**，stderr 0 |
| events 基线 | BASE | 同字节（仅 server 字节为基线） | **5/11**；失败面恰 E-1（`resultPendingExit` 仍 true）、E-3（`2!==1` 双 retry 双胜）、E-7（空隙令牌被重置）、E-8（无淘汰边界 `undefined!==2`）、E-9（`200!==201` 静默截断）、E-10（`client disconnected` 逃出 notify），各失败点与登记根因一一对应 |

## 4. 六重点面端到端探针（真实 HTTP＋SSE＋调度＋真实存储，DB 只读观测）

探针组装生产 HttpServer／SseHub／TaskScheduler／TaskService／TextIntakeService＋真实存储二进制，经 `/api/pair`→cookie/CSRF 真实会话驱动；非仓库测试、不写生产。HEAD 上 **8/8 通过**（exit 0，stderr 0）：

- **P1 提交失败零写入（HTTP）**：stale `expectedVersion` retry → **409 `version_conflict`**，事件计数不变、版本／状态／result 不变。
- **P2 并发 cancel 对（HTTP）**：恰一 200＋一 409，**恰一事件**；败方零业务写入。
- **P3 晚到竞争 retry 对（HTTP）**：恰一 **202**（冻结 §4.5 状态码）＋一 409，恰一事件、version 恰 +1；败方零写入。
- **P4 暂存窗令牌重连（D1 e2e）**：暂存窗内 `/api/snapshot` 的 `lastEventId` 作令牌 → 终局提交后重连 → **无 `stream.reset`**、`stream.ready.cursor`＝真实 DB 水位、终局帧以 `id: epoch:<水位>` 重放（`taskState=succeeded`、`objectId` 匹配）。
- **P4b** 追平令牌零重放零 reset；`/api/snapshot` 的 `lastEventId`／`highWatermark` 与 DB 水位相等（events 握手与快照同值）。
- **P5 全量快照并发一致性**：201 任务＋快照读取中再提交 3 任务 → 快照 **204/204 无丢失无重复**，`highWatermark` 为一致切割点（≤DB 水位）。
- **P5b 空隙补偿**：早于后到提交的令牌重连**不 reset**（审计空隙不是未来 token），未广播提交经**快照重同步**全量送达（3/3）——与冻结 §6 补偿规则一致。
- **P6 断线隔离**：SSE 客户端硬断开后走生产 `notify` → 不抛、已提交终态不动（`resultPendingExit=false`），存活客户端照常收到终局帧。

**同探针基线反证（`ef50461`，2/7）**：P3 **双 202＋双事件（4→6）**——`9b305d9` 幻影事件经真实 HTTP 复现；P4 终局**不推进 DB 水位**（成功终局零 `task.changed`）；P5 快照**静默截断 200**；P5b 重同步也只有 200；P6 `resultPendingExit` **残留 true**（D1(b)）。P1/P2 在基线通过（前置检查既有，与本批无关）。修复前后差异与本批五个修复点严格对应。

**错误码归属说明（登记）**：HTTP 层 cancel/retry 败方码随读交错在冻结映射两分支间变化——读到提交后状态走 `version_conflict`（过期 expectedVersion 前置检查），读到提交前状态走丢行前提（retry 默认 `version_conflict`／cancel `state_conflict`）。两种观察（`version_conflict` 与 `state_conflict`）均在本审多轮探针中出现过且都符合冻结语义；E-2（服务层）与 P1–P3（HTTP 层）共同覆盖。

## 5. 静态面要点（五文件逐行复核）

- `text-intake-service.mjs`：D1 核心同一事务内 `state='succeeded'`＋清 `result_pending_exit/pending_outcome`（`result_ref` 不动）＋`task.changed`（`objectVersion=version+1`）＋attempt 收尾＋候选发布；`!exited` 分支补 `needs_review` 事件；两处 staging UPDATE 加 `expectChanges:1` 且丢失前提按既有 `false` 契约返回（`version_conflict` 捕获后返回 false，不外抛）。
- `task-service.mjs`：retry 加 `expectChanges:1`＋事件同事务（全局映射未改，默认 `version_conflict`）；cancel 两分支同形＋`conflictCode:'state_conflict'`（对外码不变）；`stageResult` 同形；**删除 `insertEvent`**（幻影事件入口无残留调用方——全文件 grep 复核 0 引用）。
- `task-scheduler.mjs`：`notify` 包 try/catch（广播失败静默、不改已提交态、不阻塞退出链）；`onWorkerDone` 终态广播改提交后立即 `void notify`，再 `confirmExit`；auto-backoff 仅 `queued`/`needs_review` 补播，预算耗尽（写零事件）不伪造广播——与 `maybeAutoRetry` 返回值核对一致。
- `sse-hub.mjs`：新增 `evictedThrough`（淘汰帧最高游标，`while` 循环取 max）；`replayFrom(token, watermark)` 双边界（`> watermark` 未来、`< evictedThrough` 失窗，其间含空隙可续播）；`stream.ready.cursor` 改报真实水位。
- `http-server.mjs`：`events` 握手前读真实水位传入 `addClient`（async 化安全：`handle` 的 try/catch await 全链）；`/api/snapshot` 先读水位后分页取全（普通 list 分页未动，E-9 断言 `limit=201`→400）。

## 6. 边界（如实）

- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust／前端／II 集成套件；存储二进制编译自候选树源码并逐字节核对后使用，Rust 面未重测（复用 `0545310` 对 `expectChanges` 整事务回滚的动态验证——二进制逐字节相同）。
- 不关闭：MCP／M-5、身份完整性、未批 D、A4 `settings.changed`（本批未交付，仍开放，按派工由 Kimi 后继批处理）；`82e1bf2` 测试总准出仍归 ZCode 既有任务。
- 本审为只读评审＋隔离树内聚焦重放：未写生产／测试／守卫／package，未 push，未改工单状态（MAYNE-24 保持 `in_progress`，本批待独审状态由本记录闭合）；无真实模型／凭据／用户根；隔离树已删、零残留进程。
- 探针迭代说明：前两轮探针自身有断言字段错误（`taskId` vs 帧内 `objectId`、`stream.ready` cursor 字段位置、P5b 令牌时序），修正后最终轮 8/8 作为证据；迭代中间输出不入证据集。

## 附件

评审记录（本文件）、admission、HEAD 恢复回归两轮 TAP＋D1 三连跑、基线恢复回归 TAP（补作者包缺失件）、HEAD events 两轮 TAP、基线 events TAP、HEAD 探针 8/8 输出、基线探针反证输出、SHA256SUMS（本机复算）。原始证据 `build/mayne24-d1-events-review/r1/`（gitignored）。
