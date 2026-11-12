# Web 文本接入 · D1／任务事件补偿收口交付记录（2026-11-09，Kimi）

派工：MAYNE-24 触发评论 `01a1be9c-999f-7475-98d5-111401a3f53d`（Codex，2026-11-09）。任务：三修冻结送审后，先完成已排 RS-1（`ef50461` 已交付），再以独立小提交闭合 **D1／任务事件补偿**——extract/revise 成功终局与真实 `task.changed` 同事务推进游标、清 pending／cancel 标记并保留结果字节；覆盖 claim／stage／retry／cancel／resolve 等受影响路径的事件一致性，提交失败或 no-op 不留幻影事件；`9b305d9` 指出的 retry 缺 `expectChanges` 且事后无条件 insertEvent 同族一并修；重复／并发旧任务版本按冻结 `version_conflict`，不全局改变其他错误映射；重放合法性用真实 DB 高水位与实际淘汰边界，审计造成的游标空隙不能误判未来 token，内部审计不得伪造 task.changed，重放仍有界、失窗／换 epoch reset 保留；广播断线不能回改已提交终态或阻塞退出链；按冻结全量语义收口 snapshot 的 200 静默截断，普通 list 分页不变；原 D1 必须转绿，并补审计空隙、真实失窗／未来游标、no-op／并发 retry 与 >200 快照的必要回归；不扩 API／DDL／依赖，原始证据一次随评论交付。

**结论先行：D1 已转绿（恢复回归 11/11）。生产面恰 5 个 `server/` 文件 +142/−55；新增独立回归 `tests/unit/web-text-intake-events.test.mjs` 11/11 全绿，其中 6 例在修复前字节上原样失败（可证伪性成立）。未扩 API／DDL／依赖，未跑完整门禁，未 push、未改状态。**

## 1. 身份与写入面

- 分支 `agent/kimi/mayne-24`，基点 `ef50461a7404ce235e4cb3015ac28dcde0fced69`（RS-1 收口记录提交）。
- 生产 diff 恰 5 个文件，全部在 `server/lib/`：`text-intake-service.mjs`、`task-service.mjs`、`task-scheduler.mjs`、`sse-hub.mjs`、`http-server.mjs`。Rust、DDL、003 冻结哈希、守卫、package、前端、Runtime、II/III 文件零差异；ZCode 恢复回归测试字节零修改（`82e1bf2` 更正字节仅按派工原样覆盖运行、跑后还原，工作树回到登记字节 `e6c90c0a…`）。
- 新增测试仅 `tests/unit/web-text-intake-events.test.mjs`（本人 II 写入面内、领域命名的新文件）；未改任何既有测试文件名或 npm 脚本名。
- **交付中登记的一次竞态与修复**（见 §3.1 注）：首轮修复后恢复回归 11/11，但在最终复核跑中 D1 以 10/11 闪败一次——令牌可续播、终态帧未及进入重放窗口。根因是 `onWorkerDone` 在广播已提交终态前先 `await workerHost.confirmExit(runId)`（进程树核实，耗时不定），已提交事件对 SSE 客户端的可见性被该书挡延迟。修复（`7613843`）：终态广播改到提交后立即触发（仍为 fire-and-forget，不阻塞退出链），auto-backoff 结局仅在实际写了事件时才补播。修复后连续两轮 11/11＋D1 单独三连跑全绿。

## 2. 修复内容（四个生产小提交）

### 2.1 D1 核心（`text-intake-service.mjs`，`confirmExtractExit`）

修复前 extract/revise 成功终局（`result_pending_exit=1` 的暂存结局提交分支）**不写任何 `task.changed` 事件**：终态提交与游标推进脱节，持有暂存窗令牌的客户端重连被 `cursor_out_of_window` 重置；且 `result_pending_exit`／`pending_outcome` 不清零（R5-M-1 D1(b) 残留，§3.1 语义偏离）。修复后同一事务内：

- `state='succeeded'`、`attempt_exit_state='exited_confirmed'`、`cancel_intent=0`、**`result_pending_exit=0,pending_outcome=NULL`**、`terminal_at`、`version+1`（`result_ref` 不动，结果字节保留）；
- `task_events` 同事务插入 `task.changed`（`objectVersion=version+1`，RETURNING cursor 即权威游标）；
- attempt 行收尾与候选发布（`staged`→`pending`）仍在原事务内。

同时补齐 `!exited` 分支（退出无法确认 → `needs_review`/`exited_unknown`）缺失的 `task.changed` 事件（与 task-service 侧同族迁移对齐；HTTP 响应语义不变，M1a/M1b/M1c 判据不受影响）。

### 2.2 事件补偿同族（`task-service.mjs`、`task-scheduler.mjs`、`text-intake-service.mjs`）

- **retry（`9b305d9` 发现）**：修复前 UPDATE 无 `expectChanges`、事后无条件 `insertEvent`——重复／并发旧版本 retry 的 UPDATE 匹配 0 行仍写一条幻影事件。修复后 `expectChanges:1`＋事件入同一事务，适配器提交前断言失败即整事务回滚；错误映射走全局默认 `version_conflict`（冻结映射未改；显式恢复项版本失配仍走原前置检查的 `version_conflict`）。
- **cancel（queued／running 两分支）**：从事后 changes 检查＋独立 insertEvent 改为 `expectChanges:1`＋事件同事务，`conflictCode='state_conflict'`（对外码不变：丢失行前提答 `state_conflict`，过期 `expectedVersion` 仍答 `version_conflict`）。
- **stage（`task-service.stageResult` 与 extract/revise 两个 staging 方法）**：UPDATE 增加 `expectChanges:1`，读取与提交之间丢失前提时载荷行与事件一并回滚；方法按既有契约返回 `false`（不向上抛，调度帧钩子行为不变）。
- **删除 `insertEvent`**：其「事务后补事件」形状正是幻影事件的入口，修复后无调用方，一并移除以防回归。
- **广播韧性与时序（`task-scheduler.notify`／`onWorkerDone`）**：`notify` 的广播及其 DB 读取包进 try/catch——断线客户端或关闭中的存储适配器不能回改已提交终态、不能阻塞退出链（事件行已落库，客户端经快照补偿）；终态广播改在提交后立即触发，不再让位于 `workerHost.confirmExit` 的进程树核实（D1 补偿窗口，`7613843`），auto-backoff 结局仅在实际写了事件时补播。

### 2.3 重放合法性与快照全量（`sse-hub.mjs`、`http-server.mjs`）

- `SseHub` 记录**实际淘汰边界** `evictedThrough`（缓冲淘汰帧的最高游标，未淘汰为 0），`replayFrom(token, watermark)` 的双边界改为：`cursor > watermark`（真实 DB 高水位，未来 token）或 `cursor < evictedThrough`（真实失窗）才 `stream.reset`；两者之间的令牌——含审计事件造成的游标空隙——保持可续播，只重放缓冲中 `cursor >` 令牌的帧。失窗／换 epoch／畸形令牌的 reset 全部保留；重放仍有界（`maxFrames` 不变）。
- `HttpServer.events` 握手前读真实 `task_events` 高水位（与 `/api/snapshot` 同一值）传入 `addClient`；`stream.ready` 的 `cursor` 改报该真实水位。
- `/api/snapshot` 按冻结 §6 全量语义分页取完全部任务（先读高水位，任何其后提交的事件游标更高、由重放补偿），不再静默截断在 200；普通 list 分页（默认 50、上限 200、越界 400）不变。

## 3. 验证（真实链，原始证据 `build/d1-events/`，gitignored）

前置链本轮实跑：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` lark-cli 1.0.98；`probe:prepare-pi` provenance `ad702637`／`e89822b0`；`probe:bundle` exit 0；cargo release 存储二进制 **2649408 B、sha256 `42af54b5…490fc2`**（与既往登记逐字节相同）；Node v24.20.0；`--test-timeout=20000`。

### 3.1 恢复回归（ZCode `adc31d8` 测试字节；W 面按派工原样覆盖 `82e1bf2` 更正字节，跑后还原）

| 运行 | 对象 | 结果 |
|---|---|---|
| 修复前基线 | `ef50461`＋`82e1bf2` 测试字节 | **10/11**：PC1/PC2/M1a/M1b/M1c/F1/E1/E2/W(deadline)/W(worker loss) 过；**D1 败**（`the staged-window snapshot token was never resumable … reason cursor_out_of_window`，8.8s），stderr 0 字节 |
| 修复后 | 同一测试字节、同一构件 | **11/11 exit 0**（56.6s，stderr 0 字节）——D1 转绿：暂存窗令牌可续播、终态帧以更高游标重放、`resultPendingExit=false` |
| 修复后（本树登记字节 `e6c90c0a`，不覆盖） | 同一生产 HEAD | **8/10**：D1 过；F1／旧 W 败——均为已登记的撤回预期（`82e1bf2` 修正的夹具交互与旧 W 预期），非本批回归 |

注：最终复核跑曾出现一次 D1 闪败（10/11，败在终态帧重放断言而非令牌可续播性）——竞态根因与修复见 §1 末条与提交 `7613843`；该修复后恢复回归**连续两轮 11/11**（57.2s／57.2s，stderr 0），D1 单独过滤**三连跑全绿**，events／lifecycle／I 单测／MCP 配对套件同字节全绿。

### 3.2 新增回归 `tests/unit/web-text-intake-events.test.mjs`（真实存储二进制＋生产服务层）

修复后 **11/11 exit 0**（stderr 0 字节）；同一文件在修复前字节（pristine detached 树 `/tmp/w1-prefix-d1`，仅差异 server 字节）**5/11**，失败项与根因一一对应：

| 用例 | 面 | 修复前实测（可证伪性） |
|---|---|---|
| E-1 | extract 成功终局同事务事件＋清暂存窗＋保留结果字节 | 败：`resultPendingExit` 仍为 true（D1(b) 残留） |
| E-2 | no-op retry（错误版本 `version_conflict`／已重排队 `state_conflict`）不留幻影事件 | 过（前置守卫既有，本批为前向保护） |
| E-3 | 并发 retry：恰一个胜出、恰一个事件 | 败：`2 !== 1`——两个 retry 都"成功"、两条事件（缺 `expectChanges`） |
| E-4 | 并发 cancel：恰一个胜出、恰一个事件 | 过（前向保护） |
| E-5 | 被取代 attempt 的 stage 不落载荷、不落幻影事件 | 过（前置读取路径既有，前向保护） |
| E-6/E-6b | 预算耗尽是内部审计，不伪造 `task.changed`（可控时钟跑满 4 个 attempt） | 过（登记面未改，前向保护） |
| E-7 | 重放合法性用真实 DB 高水位：审计游标空隙不是未来 token | 败：空隙令牌被重置（`true !== false`） |
| E-8 | 重放有界：失窗重置、epoch／畸形重置、空隙令牌可续播 | 败：无淘汰边界记录（`undefined !== 2`），边界下令牌被误重置 |
| E-9 | 快照全量 >200 不截断；list 分页不变（201 任务：快照 201、list 200＋nextCursor、`limit=201` 400） | 败：`200 !== 201`（静默截断） |
| E-10 | 广播断线不回改已提交终态 | 败：`client disconnected` 逃出 `notify` |

### 3.3 其他门禁

- I 单测：`web-text-intake` **13/13**、`web-text-intake-lifecycle` **10/10**、`web-text-intake-mcp-pairing` **11/11**（stderr 0）。
- `node --check` 五个生产文件 exit 0；`npm run check:structure` 自测通过、`server/` 与 `tests/` 零违规——全部 170 条 `[top.dir]` 违例来自会话开始前即存在的平台注入未跟踪目录 `.kimi/`（与 `ef50461` 登记一致，未删除、未触碰）；`npm run check:docs` exit 0（21 文件 513 链接）。
- 脱敏：全部运行产物 0 命中合成秘密值／配对码／cookie／CSRF；stderr 均 0 字节。

## 4. 边界（如实）

- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust 全量、前端与 II 集成套件（本批生产面不触及）；未 push、未改工单状态，MAYNE-24 保持 `in_progress`。
- 本批只闭合 D1／任务事件补偿与快照全量。MCP／M-5、身份完整性、未批 D 与其他后续面不因本批关闭；`82e1bf2` 更正字节的测试总准出仍归 ZCode 既有任务，本批仅按派工原样用作验证输入。
- 生产独审请派未写本批 5 个 `server/` 文件的成员；作者不自签。harness 与原始证据在 gitignored `build/d1-events/`（基线与修复后 TAP／stderr、修复前后回归 TAP、守卫日志），平台会回收，关键数字已录本文。
