# P-3 回执提案独审（MAYNE-24 W1 / OpenCode）

> 派工：Codex `01a1bc3a`（接续独审回执候选 `93207de..4f7e5d1` 及补件）与触发评论 `01a1bc45`（纳入四项边界补件要求）。评审人 OpenCode **未参与**该裁定、追加 A 及其参考实现的任何编写（本分支此前仅交付过独立的 M-4 存储裁定 `65431da`/`8ac7064`，非本评审对象）。
> 本轮为**只读独审**：只写本文档与 `build/web-text-intake-receipts-decision-review/`；不实施提案、不改生产 Runtime/DDL/守卫、不跑完整门禁。只判断 P-3 在**原 I 范围内**现帧方案能否闭合，不签业务通过；M-5 保持未闭合，MAYNE-24 保持 in_progress。

## 1. 评审对象与身份（独立复算）

| 项 | 值 | 复算方式 |
|---|---|---|
| 评审范围 | `93207de4d304436383c22be0ffb091cf657d19d7..4f7e5d158d30fe59b14f1b1abf28d63b14d20b5a` | 本机 git，恰 1 提交（追加 A），父 `93207de` |
| 最终树 | `bc8f3cd976e7e133f771654ff65f9d7b12740222` | `git show --format=%T` |
| 变更面 | 仅 `docs/reviews/web-text-intake-receipts-decision-20261109.md`（+153 行纯追加；§1–§5 原稿未改写，前 223 行与 base 逐字节一致） | `git diff --stat` + 分段比对 |
| 决策文档 blob / SHA-256 | `69c12c6b` / `f9fc00b2e5ff9b3031a57de295301868f4236ccef903dc1d12c957161988aed0` | `git cat-file` 与评论附件 `cmp` 逐字节一致 |
| 证据包 | 评论 `01a1bc41` 的 11 个附件，CLI 下载后 `SHA256SUMS.txt` 9/9 OK | 本机复验（见 §5） |
| 生产基点事实 | I 候选 `738414b`（方案补丁目标）与现行 HEAD `05c66fd`（tree `c8a5bb50`） | 本机 git 直读 |

可复现性：`node p3-consumer.mjs candidate/golden-frames.jsonl` 在本机实跑，输出与 `p3-consumer-run.txt`**逐字节一致**（`probes/rerun-golden-by-opencode.txt` diff 为空）。

## 2. 方法与源码事实

逐条核实方案引用的文件：行（本机直读，标注 ← 为复用既定结论、只做廉价存在性确认）：

- `runtime/entries/organizer-entry.mjs`：`progress{phase:'tool'}` 出口仅 `{type,phase,runId,hostNonce}`（同一 `event` 含 `toolCallId/toolName/args` 被丢弃）；`onWorker→emit({type:'worker',...})`；cancel/MCP 入站帧校验 `runId`+`hostNonce` 双值（`:44` 一带，48-hex 形状校验）。
- `runtime/lib/managed-bash.mjs`：`nonce=randomUUID()` 每次 spawn 生成，`onWorker({action:'start'/'end',pid,nonce})`；`[REDACTED]` 仅作用于 bash **输出**通道（`emitText`），不覆盖参数通道。
- `runtime/lib/mcp-control.mjs` / `mcp-trial.mjs`：出站帧 `{type:'mcp',action,...body,requestId,runId,hostNonce}`；`call_begin` body 含 `serverId, callId(=randomUUID(), 每次真实调用唯一), input:{id,modelCallId,modelName,configurationRevision,schemaSha256,argumentsJson}`；`call_response` 带 `callId` 与 `result`；http identity 含 `endpointSha256/nonce/run`。
- `vendor/pi/packages/agent/src/agent-loop.ts`：`tool_execution_start{toolCallId,toolName,args}` / `_update` / `_end{toolCallId,toolName,result,isError,durationMs?}`（P-1/P-2 数据源属实；本方案不依赖）。
- `server/lib/worker-host.mjs @738414b`：`:63-64` runId/hostNonce 生成；`:129` 栅栏**只比较 runId**；`:132` `WORKER_DEBUG` 原始帧截断写 stderr；`:133-136` result/error 提取 + `listeners` 缝 ←（既定缺陷，Codex/ZCode 已立案；本轮仅确认存在）。**`@05c66fd` 已修复**：`:149` 双校验 `runId`+`hostNonce`，`WORKER_DEBUG` 已删除 ←（I 第三轮修订自述，本轮行级确认）。
- 冻结 DDL `001_web_backend.sql`（本机 `8511907c…` 复算通过）：`task_events.object_type CHECK IN ('task','setting','workspace','recovery_hold')`，索引 `(object_type,object_id)`；`side_effect_receipts(receipt_id PK, attempt_id FK, kind, external_ref, recorded_at, provable_readonly CHECK IN (0,1))`，无状态列。
- 冻结契约 `web-api-contract.md:214`（`05c66fd` blob）：**`proven_safe` 要求失败点之前不存在 `provable_readonly=false` 且可能已生效的调用；无法证明即 `unknown`，转 `needs_review`；失败码本身不构成安全证明**。
- `web_backend_store.rs:34`（`05c66fd`）：`side_effect_receipts` 在 `BUSINESS_TABLES` 白名单内；`task-service.mjs` `transact` 缝在位（含 `expectChanges` 提交前断言）。
- `runtime/`、`vendor/pi/` 自基点零改动（git log 确认；两候选均未动只读区）。

## 3. 逐项结论

### 3.1 身份/幂等（§A.3.1）——R-1 MAJOR：ref 派生身份合并真实调用，且相对原稿属回退

`receipt_id=sha256(runId:kind:ref)`、MCP `ref=<serverId>/<modelName>@<revision>#<schema16>` **不含 callId**。同一工具/schema/修订的连续两次真实调用（不同 callId/modelCallId）映射到同一 receipt：参考消费器静默合并为一行；在真实存储层则为主键碰撞（探针 D phase 6：`UNIQUE constraint failed`）。**候选自带的黄金帧就含该案例**（c-001 已应答、c-003 从未应答，同 ref）：实跑输出 `receipts=4 (2 CLOSED/2 OPEN)` 把 c-003 吸进 c-001 的 CLOSED 行，掩盖了一个未闭合调用；按 callId 身份应为 `5 receipts (2 CLOSED/3 OPEN)`（探针 B）。原稿 §2.3 本为 `sha256(runId:attemptId:kind:callId)`，追加 A 回退为 ref 派生——回退方向错误。callId（`mcp-trial.mjs:75` 每次 `randomUUID()`）与 modelCallId 都已在帧内，零 schema 即可承载：`receipt_id` 按 callId 派生、`external_ref` 追加 `#call=<callId>;modelCall=<modelCallId>`；同 callId 重复帧天然幂等（探针 D：`INSERT OR IGNORE changes=0`）。bash 侧 `pid:nonce` 每次 spawn 唯一，无合并问题。禁载 `argumentsJson`/result 内容的约束在修正后保持不变。

### 3.2 及时持久化与异步顺序（§A.3.2）——R-2 MAJOR：顺序自相矛盾且持久化无实证

§A.3.2 同时写「观察到调用开始⇒**立即**在同一事务落未闭合 receipt」与「结果暂存事务（现有）：本次 attempt 的 receipts **随事务提交**」——两句不相容：若随暂存提交，result 前 SIGKILL 恰好丢台账（正是 A-2 声称修复的缺陷）；若立即各自提交，则暂存事务无 receipts 可随提交。正确顺序须写明为：① receipt INSERT 在观察点的**独立即时事务**提交（`task-service.transact` 现有缝）；② 暂存事务不承载 receipt 写入；③ `sideEffectSafety` 判定在暂存提交后的判定点**读取已提交 receipts**（存在性测试，见 3.3）；④ 暂存从未运行的 attempt 留下未闭合 receipts 是 SIGKILL 路径的**预期形态**，恢复按 `attempt_id` 读取。探针 D phase 1–4 在**真实冻结 001 schema**（node:sqlite）上证明了正确顺序的形态：start 已提交→关闭连接→重开连接→receipt 与事件仍在；这是现有证据包没有的——`p3-consumer.mjs` 全内存（作者自己也如此声明），`p3-zero-record-cases.txt` case 3 的「persisted at observation time… survive the SIGKILL」是**对设计意图的断言，不是已证事实**。内存参考消费器只能签分类机械性（本案已证其分类还有缺陷，见 3.3），不能代签持久化。

### 3.3 未闭合恢复与零记录推导（§A.5/§A.4.2）——R-3 MAJOR：三条边界均不成立或未落地

- **R-3a（已闭合但 `provable_readonly=0` 不得变 safe）**：消费器判定链 `open.length>0` 才否决；全闭合落到 else 分支输出「proven_safe-eligible: every observed call is closed and attributable」（探针 C1：一次已闭合 bash + 一次已闭合 MCP 调用即触发）。这**直接违反**契约 ：214 的存在性测试——已运行的 bash/MCP 调用（provable_readonly=0）当然「可能已生效」，闭合只说明「看到了返回」。修复：判定改为「存在任一 `provable_readonly=0` receipt（无论闭合与否、在失败点之前）⇒ 非 proven_safe」。
- **R-3b（未归因 progress 须持久化）**：`markUnattributedToolCall()` 是内存计数（消费器 `unattributedToolCalls`），重启即清零；探针 D phase 5：only-progress 崩溃后恢复读 `receipts=0, markers=0`，与干净无调用 attempt 不可区分。须按队长已给的同规则持久化：`task_events` 内部审计事件（`object_type='task'`、`object_id=taskId`、payload 带 runId 等非秘密字段），恢复面可读。
- **R-3c（「无调用帧即可 safe」不成立于断流/崩溃）**：§A.5 第一行把「无任何帧」直接判「未发生工具调用→可判 proven_safe（就可观测面）」。断流/崩溃/后端重启窗口里「没看到帧」≠「没发生调用」。修正为必要条件组：**零 receipts ∧ 零持久化未归因标记 ∧ 本次 attempt 干净终止且退出已核实（result 帧 + `treeVerified`，均为现有事实）**，三者齐备才允许 proven_safe-eligible；任一缺失 ⇒ unknown→needs_review。这同时意味着判定必须放在持有终止事实的恢复/结局路径，不能放在只见帧的消费器里。
- 另 O-3（MINOR）：消费器 `call_response` 闭合时在**原始帧全表**里按 callId 找 begin（含被拒帧）；应改为查本 sink 已接收状态，机制上不依赖 UUID 不碰撞。

### 3.4 C1 闭合语义（§A.3.3）——R-4 MAJOR：object_id 写 receiptId 违反 task_events 引用语义

方案 C1 原文「`task_events` 记一条 `{type:'tool_call_closed', object_id:<receipt_id>}`」：`task_events.object_type` CHECK 只允许 `'task'/'setting'/'workspace'/'recovery_hold'`，唯一可行是 `object_type='task'`，而该元组下所有既有读方按 `object_id=taskId` 解释——把 receiptId 填进 object_id 会制造指向不存在任务的孤儿事件。按触发评论已给规则收口：`object_type='task'`、`object_id=taskId`、payload 关联 `receiptId/attemptId`；未闭合集合 = receipts−payload 引用的闭合事件。探针 D phase 7 在真实 001 schema 上验证了该形态可行且恢复查询正确。事件名命名空间（`tool_call_closed`、以及 R-3b 需要的 `unattributed_tool_progress`）均属任务内部审计事件，不新增公开 HTTP/SSE 类型；队长已确认前者，后者按同一规则由队长一并确认。

### 3.5 秘密边界（§A.6）——PASS（一处措辞更正）

消费器源码级确认不读 `input.argumentsJson` 与 result 内容（唯一出现是禁用注释）；我方复跑输出扫描 `synthetic-query*`/result 文本 0 命中；`external_ref` 仅含 serverId/modelName/configurationRevision/schemaSha256(/callId)/pid/nonce 非秘密标识。`WORKER_DEBUG` 删除要求成立——但依据是**mcp `call_begin` 帧含 `argumentsJson`**（stdout 帧经 ：132 落 stderr）；O-2（MINOR）：A.6 所述「帧里含 apiKey（请求帧回显）」在已核实帧形中无支撑（apiKey 只走 stdin），措辞应更正，不影响删除结论（`05c66fd` 已删）。

### 3.6 栅栏与陈旧帧（§A.4.1）——PASS（复用既定事实）

黄金帧 15 帧含「同 runId+外来 hostNonce」分歧帧，提案双校验拒绝、现行 runId-only 放行（分歧=1，矩阵诚实）；该生产缺陷 `738414b:129/131` 已由 I 第三轮 `05c66fd:149` 修复 ←（既定立案，行级确认）。陈旧帧拒绝、当前 attempt 未闭合保留两机制分离正确。内存 Map 仅作索引、身份判定逐帧进行，未以内存映射替代栅栏。

### 3.7 权限范围（§A.8）——结论：P-3 落在原 I 范围内，架构可闭合

写入面 = `server/lib/worker-host.mjs`（订阅者）、`server/lib/task-service.mjs`/调度器（receipt 事务与恢复读取）、前端零触及；不改 `runtime/**`、不改 DDL/schema_meta、不改 `BUSINESS_TABLES`、零新依赖；`task_events` 新事件名属既表内部命名，队长已给规则。P-1/P-2（Runtime 扩帧）本方案不依赖，维持未授权、另列评估。O-1（MINOR）：`p3-proposal.diff` 三项内容中双校验与 DEBUG 删除已被 `05c66fd` 收编，现对该 HEAD `patch --dry-run` 失败（1/1 hunk）——补丁**过期但不失效**：撰写时（`05c66fd` 之前）目标正确，实现授权时须对当前 HEAD 重生成，届时净增仅 `receiptSink` 订阅一行加 task-service/恢复读取。

## 4. 结论

**现帧方案在原 I 范围内架构可闭合；但按交付稿不可签闭合。** R-1～R-4 四项 MAJOR（身份合并、持久化顺序与实证、零记录/闭合判定、C1 事件语义）全部有零 schema 的明确修复方向且不越权，均须按上述口径修订提案并补真实存储路径证据后，才可交队长裁定实现授权。四项边界要求（§A.5 崩溃前提、§A.3.1 callId 身份、C1 任务对象规则、SQLite 持久化证明）经独立验证**当前补件均未满足**，本评审以探针给出了可复用的通过形态。原 M-5 未闭合；本评审不签业务通过、不批准实施；MAYNE-24 保持 in_progress。

## 5. 证据索引（`build/web-text-intake-receipts-decision-review/`）

- `candidate/`：评论 `01a1bc41` 11 附件原样，`SHA256SUMS.txt` 9/9 OK；决策文档与 `4f7e5d1` blob 逐字节一致（sha256 `f9fc00b2…`）。
- `probes/rerun-golden-by-opencode.txt`：候选消费器复跑，与 `p3-consumer-run.txt` 逐字节一致 + 我方秘密扫描 0 命中。
- `probes/probe-b-identity-merge.{mjs,txt}`：同一黄金帧上 ref 身份 1 行 vs callId 身份 3 行（c-003 掩盖实证）。
- `probes/frames-allclosed.jsonl`、`frames-unattrib-closed.jsonl`、`probe-c-*-run.txt`：全闭合 provable_readonly=0 →「proven_safe-eligible」违约输出；含未归因标记仍违约。
- `probes/probe-d-persistence.{mjs,txt}` + `persist-probe.sqlite`：真实冻结 001（`8511907c…` 复算）上的持久化/幂等/闭合/恢复四项证明，exit 0。
- `probes/p3-proposal-738414b.diff` + 对 `05c66fd` 的 `patch --dry-run` 失败记录（O-1）。
- `admission.json`：评审身份、基点、写入清单、边界。

## 6. 增量复核：追加裁定 B（`89b10f8`，派工评论 `01a1bc6f`）

> 派工要求：明确区分本评审（`7aa0aee`，对象旧 `4f7e5d1`）与新追加 B `89b10f8`；对 `89b10f8` 逐 R-1～R-4 给现版本关闭／未关闭及具体脚本 SHA；未变帧来源事实复用；不以旧稿不通过报告或自建探针代签新候选。本轮为**只读增量独审**：只写本文档本节与 `build/web-text-intake-receipts-decision-review/r2/`；不实施、不改生产/Runtime/DDL、不跑完整门禁。

### 6.1 对象身份与读取确认

| 项 | 值 | 复算方式 |
|---|---|---|
| 评审对象 | 评论 `01a1bc4f-36e0`（OhMyPi）12 个附件；作者声明候选提交 `89b10f8d28c6cf2360179fd74db5c156a254226d`（父 `3ef87b3`） | CLI 下载；提交身份为作者声明——其分支不在本机可达（成员无 push 授权），本轮签的是**附件字节面** |
| 附件校验 | `SHA256SUMS.txt` 10/10 OK | `shasum -a 256 -c` 本机复验 |
| 决策文档（含追加 B） | `f44ce70e48128b2b…7cdaa3`（45298 B） | 独立复算 |
| 指定 consumer 附件 | **`01a1bc4f-33c1-78b0-81e6-bb4976d6ab84` = `p3-consumer.mjs`**，SHA-256 `5c230c4c9fcd7e93…f7db5440` | 已确认读取、校验并复跑（见 6.3） |
| 帧来源未变 | `golden-frames.jsonl` = `35d7b97edc4fd8af…730d1a18`，与本评审 r1 `candidate/golden-frames.jsonl` **逐字节一致** | 双侧哈希比对 → r1 §2 全部帧来源/源码行级事实**原样复用** |
| 文档增量形态 | 对 r1 文档（`f9fc00b2…`，blob 逐字节取回）diff：**仅纯追加**——§A.7 证据表 4 行 + 追加 B 全文（`354a`/`376a`，零删改） | 本机 diff → A 段全部历史事实可复用，R-1～R-4 原引证行号不变 |

### 6.2 逐 R-1～R-4 现版本结论（以脚本 SHA 为证）

| 项 | 现版本 | 证据（候选自带，SHA-256 前 16） |
|---|---|---|
| **R-1** 身份合并 | **关闭** | B.2 改为 `callKey="<callId>:<modelCallId>"`（bash `"<pid>:<nonce>"`）入 `receipt_id`+`external_ref`。consumer `5c230c4c9fcd7e93` 在**未变黄金帧**上实跑输出 `receipts=5 closed=2 open=3`、从未应答的 c-003 保持 **OPEN**（与 r1 探针 B 要求的形态完全一致）；persistence `85260469adb13ff8` 同工具两次调用 2 行；NC-2 `a73cf8046a1f56b0` 同结论；对照 `8a80dca860ffde03`（旧规则 2 键 vs 新 4，含栅栏拒绝帧计数说明） |
| **R-2** 顺序矛盾＋持久化无实证 | **关闭**（留 O-4 文面标记） | B.3 明确四点：观察即独立小事务、闭合独立小事务、`stageResult`/`confirmExit` **只读**已提交未闭合集、暂存回滚不丢 receipt。persistence `85260469adb13ff8`：开始已提交→中断→**重开连接**仍在（`receipts=3 closed=2 open=1 unattributedMarks=1`）；restart `7158db6f79274815`：**新进程/新连接**同读数且 `PASS`——r1 缺失的存储路径证据由候选自备并经本机复跑证实（见 6.3） |
| **R-3** 零记录/闭合判定三边界 | **关闭** | (a) 全闭合仍有 `provable_readonly=0` ⇒ 不可判 safe：B.1 表行 4＋consumer 判定分支（r1 违约输出「proven_safe-eligible」已消失，新文案明确拒绝）＋NC-4 `a73cf8046a1f56b0`；(b) 未归因 progress 持久化为 `tool_call_unattributed`（`object_type='task'`、`object_id=taskId`）：B.1＋persistence/restart 双脚本 `unattributedMarks=1` 重开连接与新进程均保持；(c) 「无调用帧⇒safe」撤回：B.1 表行 1（`no_call_observed` → `unknown` → needs_review，`proven_safe` 需独立完整证据）＋consumer 首判定分支。注：NC-1 非判别性用例（marks=1 下旧规则同样 fail），零帧判别在 consumer 判定与 B.1 表——如实记，不另行立案 |
| **R-4** C1 事件语义 | **关闭** | B.3 按队长规则落地 `tool_call_closed`：`object_type='task'`、`object_id=taskId`、payload 关联 receiptId/attemptId，未闭合集 = receipts−payload 引用闭合事件（`json_extract` SQL）；脚本插入形状恰为 `'task'/'tsk_1'`（persistence `:116-120`、NC `:63-65`）。真实 001 CHECK 兼容性沿用 r1 探针 D phase 7（未变事实；B 脚本内嵌 DDL 不含该 CHECK，见 O-6） |

**总判定：追加 B 在其交付面（附件字节）上把 r1 的四项 MAJOR 全部闭合**；「5 receipts / 3 OPEN」即指定 consumer 附件实跑输出，已确认。旧 `4f7e5d1` 的不通过结论只对旧版本负责，本轮未以其代签新候选——全部结论出自 `89b10f8` 自带证据的本机复跑。

### 6.3 复跑记录（本机，Node v24.20.0，`node:sqlite`）

- `p3-persistence-proof.mjs`、`p3-negative-controls.mjs`（exit 0，4/4 PASS）、`p3-consumer.mjs golden-frames.jsonl`：三者输出与附件 `p3-*-run.txt`（`c2eb7febf7da45c2`/`47e59651a8edc2bc`/`8c52a77051c0a7b0`）**逐字节一致**。
- `p3-restart-proof.mjs`：**按交付稿无法直接复跑**——persistence 脚本结尾无条件 `rmSync` 删除其库，而 restart 头注释称输入「kept on disk by a flag」，该 flag 不存在（O-5）。本机以披露的 2 行 harness 变体（仅禁用清理行＋stderr 打印库路径，规则代码零改动，`447e55abecfe570d`）重建 phase-1 库（stdout 仍与 persistence 附件逐字节一致）后喂给**原样** restart 脚本：输出与 `p3-restart-run.txt`（`2eb21321878bd811`）逐字节一致、`PASS`。harness 原件与 diff 在 `build/…/r2/`。

### 6.4 O 级残留（均不重开 MAJOR；实现授权前收口）

- **O-4** §A.3.2 树图「本次 attempt 的 receipts **随事务提交**」一句在未改动的 A 段原样保留（现文档 ：286），B.3 仅以新规则隐式取代、未按本文档自身更正体例（对照 B.1/B.2 明确引用原错误）作块内废止标记；§A.3.3 的 `object_id:<receipt_id>` 已由 B 头部引语显式否定，无需另标。→ 请在 A.3.2 加一句废止标记。
- **O-7** 身份公式不一致：B.2 文档式 `sha256(runId:attemptId:kind:callKey)`（:412），三个脚本实为 `sha256(runId:kind:callKey)`（attemptId 缺席）。栅栏先于插入拒绝异 attempt 帧、receipt 行自带 `attempt_id` 列，实质风险低，但规范式与参考实现必须钉死一致。
- **O-8** payload 形状：B.3 规格含 `callId`/`closedAt`，脚本只写 `{receiptId, attemptId}`（时间走 `created_at` 列）。`openReceipts` 只需 `receiptId`，功能不受影响；实现时钉死最终形状。
- **O-6** 脚本头与 B.4 称 DDL 为「冻结 001 原文/verbatim」：实为**简化子集**——`task_attempts` 缺 `tasks` FK/`exit_reason`/两条 CHECK，`task_events` 用独立 `id` 主键、无 `object_type` CHECK、`payload` 可空；`side_effect_receipts` 逐列一致。持久化/规则结论不依赖被省略约束，且真实 001 上的插入形状兼容性已由 r1 探针 D 建立；但「原文」措辞须更正或改为嵌真字节。
- **O-5** restart 脚本配套缺失（见 6.3）——补 keep 标志或附 phase-1 产物。
- **O-1 沿承**：附件集仍无对当前 HEAD 重生成的 `p3-proposal.diff`（B.5 以表格描述接线范围）；实现授权时按 r1 口径重生成。
- **O-2 沿承**：文档 :337「frame 里含 apiKey（请求帧回显）」措辞未按 r1 更正（apiKey 只走 stdin；删除 `WORKER_DEBUG` 的依据是 `argumentsJson`）。
- **O-3 沿承**：consumer/persistence 的 `call_response` 闭合仍在原始帧全表按 callId 找 begin（含被拒帧）；现影响可忽略（幻影 id 不落 receipts），机制性修复建议不变。
- 队长确认项：`tool_call_unattributed` 第二个内部事件名按 B.5 待队长与 `tool_call_closed` 一并确认。

### 6.5 r2 证据索引（`build/web-text-intake-receipts-decision-review/r2/`）

- `admission.json`：本轮角色/树/接收身份登记；`inputs/`：评论 `01a1bc4f` 12 附件原样（SHA256SUMS 10/10 本机复验＋文档/清单独立复算）。
- `rerun/`：三脚本原样复跑输出（逐字节一致）＋restart 复跑输出；`harness-p3-persistence-phase1-keepdb.mjs`（`447e55abecfe570d`，2 行披露改动）＋`harness-dbpath.txt`。
- `r2-SHA256SUMS.txt`：上述全部本机产物的自校验清单。

### 6.6 边界

未实施提案、未改生产/Runtime/DDL/守卫、未跑完整门禁（仅文档改动后按惯例 `check:docs`）；M-5 维持未闭合（生产接线落地并过独审前不存在业务通过）；P-3 实现授权仍属队长/owner 裁定；MAYNE-24 保持 in_progress。

## 7. 增量复核：追加裁定 C（O-1～O-8 收口，`dc83b341`，派工评论 `01a1bd37`）

> 派工限定：延续 P-3 原独审，只复核 `dc83b341` 追加 C 与触发评论 `01a1bccb` 附件的 O-1～O-8 修改面（原样入口的新进程重启、完整冻结 001 字节／FK、统一身份公式／payload、被拒 begin 不可闭合、秘密边界）；未改来源事实复用旧审；交明确通过／不通过；只签参考实现与资料，不代签生产。本轮为只读增量独审：只写本文档本节与 `build/web-text-intake-receipts-decision-review/r3/`；不实施、不改生产/Runtime/DDL、不跑完整门禁。

### 7.1 接收身份与来源事实复用

| 项 | 事实 | 本机核验 |
|---|---|---|
| 评审对象 | 评论 `01a1bccb-aa86`（OhMyPi）14 附件＝追加 C 决策文档＋6 脚本＋6 实跑输出＋golden frames＋SHA256SUMS；作者声明提交 `dc83b341e063c14e9a3f9e30480c5314ec86c30d`（父 `3f5877d`） | CLI 下载 14/14；`SHA256SUMS.txt` **12/12 OK**；提交身份为作者声明——其分支不在本机可达（成员无 push 授权），本轮签的是**附件字节面** |
| 帧来源未变 | `golden-frames.jsonl` = `35d7b97edc4fd8af…730d1a18` | 与 r1/r2 已登记哈希**逐字节一致**（第三轮复验）→ r1 §2 全部帧来源/帧词汇事实原样复用 |
| 文档 A/B 段未改 | 与 r2 附件（`f44ce70e…`，45298B）逐行 diff：**恰 1 行被替换**（§A.6.4 apiKey 回显句，即 O-2 撤回目标，原句以引语保留并标「已撤回」）＋ **91 行纯新增**（4 处废止/更正标记＋§A.8 历史标记＋追加 C 全文） | 除 O-2 撤回外 A/B 原文零改动 → r1/r2 对 A/B 段的全部事实复用 |
| 冻结 001 未动 | `src-tauri/migrations/web-backend/001_web_backend.sql` 复算 = `8511907c…f143d` | 与登记冻结一致；O-6 的对照基准有效 |
| 运行时源事实 | r1 已实证的 stdin/apiKey 面、`mcp-trial.mjs` 敏感清单、双栅栏与帧词汇 | 本轮 bundle 已被平台回收（`build/`）无法重读源文件；上游 `vendor/pi` 冻结且本轮 delta 未触碰 Runtime → 按「未改来源事实复用旧审」沿用，如实披露 |

### 7.2 O-1～O-8 逐项判定（全部 PASS，两处非阻断备注）

| # | 判定 | 证据（候选自带＋本机复跑） |
|---|---|---|
| **O-1** | **关闭** | §A.8 现存历史标记（diff 在场）：`p3-proposal.diff`／`worker-host.proposed.mjs` 明标针对旧 `738414b` 的历史提案件，不重生成、不追逐未稳定 HEAD；本轮 14 附件恰不含这两个文件，与「不重生成」自洽；生产接线差异归 I 在实际基点交付。与队长 `01a1bc81` 的处置一致 |
| **O-2** | **关闭** | 旧句就地撤回并更正（引语保留＋「此说法无依据，已撤回」）；更正后口径（请求含 apiKey 只写 worker **stdin**，stdout 全为响应帧，敏感面在 stdin＋MCP sensitive 清单）与 r1 已实证源事实一致；本机直证：golden frames `apiKey` 0 命中，四个脚本源码零读取 `argumentsJson`/result 内容 |
| **O-3** | **关闭** | sink（`p3-lib.mjs createSink`）闭合只认 `accepted` 集（仅此前**已接受且已持久化**的 begin 进入该集——persistence/NC 的 `begun` Map 在 INSERT 成功后才登记）；NC-5（外来 nonce 的 begin＋同 callId response）真实且本机复跑 PASS：`sink result={"ignored":"no accepted begin"} rows=0 closed=0`。备注（非阻断）：consumer pass-2 用 `frames.find`（含栅栏过滤）解析 begin 后仍以 pass-1 `accepted` 门控闭合——被拒 begin 不可闭合的语义保持，且有序流与严格串行链等价；生产化 sink 无全表扫描 |
| **O-4** | **关闭** | §A.3.2 两行后现存废止标记（diff 在场），指向 §B.3 现行口径（观察即独立小事务；暂存/退出确认只读；不引入 `unclosed_exit`） |
| **O-5** | **关闭** | `keep`／`phase1`／`restart <db>`／`clean` 四入口真实（`p3-persistence-proof.mjs:58-172`）；`p3-restart-proof.mjs` 为**独立 node 进程**，`openFrozenDb(path,{create:false})` 不重建 schema（证明持久化而非建表）；结尾无条件删库已移除（清理收敛为显式 `clean` 入口）；本机**零 harness 修改**复跑全序列成功 |
| **O-6** | **关闭** | `FROZEN_001_DDL` 与冻结 001（`8511907c`）逐语句规范化比对：4 表全列＋全部 CHECK＋FK（`side_effect_receipts.attempt_id→task_attempts`、`task_attempts.task_id→tasks`）＋`task_attempts_current` 部分唯一索引等 6 索引**逐字一致**；`PRAGMA foreign_keys=ON`；NC-7 孤儿 receipt 被 FK 拒绝真实且本机复跑 PASS。**备注（措辞级）**：`tasks_state_active` 索引的 `WHERE state IN (…)` 部分谓词被省略为普通索引——O-6 行内**逐表枚举**（tasks 只称「全列＋2 条 CHECK」）准确，唯 C.3 概括语「含全部 CHECK/FK/索引」与「001 DDL 原文」对该索引过述；无任何被测命题依赖索引形状（FK/CHECK 语义与索引无关），不阻断 |
| **O-7** | **关闭** | `receiptIdOf` 与 consumer 内联式均为 `sha256(JSON.stringify([runId,attemptId,kind,callKey]))[0:32]`（JSON.stringify 缺省紧凑）＝队长 `01a1bc81` 公式逐字一致；§1 表与追加 A 表各现存废止标记（diff 在场）；`p3-merging-counterexample.txt` 三公式同流对比（A 合并 2／B 缺 attemptId 3／船长 3 且限 attempt）与实跑一致 |
| **O-8** | **关闭** | `closedPayload`＝`{receiptId,attemptId,callId,closedAt}`（bash `callId??null`、`toISOString()` UTC 毫秒）、未归因＝`{attemptId,runId}`；`p3-restart-proof.mjs:42-49` 形状断言不符即 `MISMATCH`→FAIL 且纳入 `ok` 门；本机复跑输出 `OK/OK → PASS` |
| r2 尾项 | **关闭** | `tool_call_unattributed` 命名经队长 `01a1bc81` 引 `01a1bc50` 确认，C.1 表已钉死 |

### 7.3 复跑记录（本机，Node v24.20.0，`node:sqlite`，零 harness 修改）

按 C.3 序列全量复跑：`keep` → `receipts=3 closed=2 open=1 unattributedMarks=2`、同工具 `rows=2 distinctCallIds=2`、重复帧 `rows 3 -> 3 (idempotent: true)`、`refused frames: 1 (stale hostNonce)`——receiptId 与附件逐字节相同（`5f5f2a71`/`e011c44e`/`f5d98393`）；`p3-restart-proof.mjs`（新进程）→ **输出与附件 `p3-restart-run.txt` SHA 逐字节相同（`22fa6006…`）**、`PASS` exit 0；`restart`（本进程重开）→ PASS exit 0；`p3-negative-controls.mjs` → **NC-1..NC-7 全 PASS、exit 0，输出与附件逐字节相同（`519edaf5…`）**；`p3-consumer.mjs golden-frames.jsonl` → **`receipts=5 closed=2 open=3`、`rejectedStaleFrames=4`、`VERDICT NOT proven_safe`，输出与附件逐字节相同（`ef0e7512…`）**，c-003（从未应答）保持独立 OPEN 行；`clean` → 本包所建库全部移除。秘密边界独立复扫：本机 4 份复跑产物 `synthetic-query`/`argumentsJson`/`apiKey` 全 0 命中，与作者 `p3-secret-scan.txt` 结论一致。

### 7.4 总判定与边界

**总判定：追加 C 在其交付面（附件字节）上把 r2 的 O-1～O-8 全部收口，参考实现与证据包与队长 `01a1bc81` 统一口径一致——本轮对「参考实现＋资料」给 PASS。** 两处非阻断备注（O-6 概括语对 `tasks_state_active` 部分谓词过述；consumer pass-2 的 `find` 解析式实现）仅涉措辞/实现风格，不涉任何被证命题，不要求返工；如后续修订可顺手收敛。

边界：只签参考实现与资料（机械分类、真实 SQLite 持久化、规则可证伪性）；**不签生产**——`dc83b341` 提交身份为作者声明（附件字节面为准），生产接线属候选 I 后继增量（帧提取已由 Claude `d79b1f6` 交付、ZCode R7 复核），M-5 仍须生产落地、独审与最终门禁后才可关闭；零记录/全闭合仍只证明「不足以推 safe」。未跑完整门禁（文档改动后跑 `check:docs`）；MAYNE-24 保持 in_progress。

### 7.5 r3 证据索引（`build/web-text-intake-receipts-decision-review/r3/`）

- `att/`：评论 `01a1bccb` 14 附件原样（SHA256SUMS 12/12 本机复验）；`r2ref/`：评论 `01a1bc4f` 7 个旧附件重下载（哈希与 r2 登记逐一相符，供逐行 diff）。
- `run/`：零 harness 修改的全序列复跑产物（persistence/restart/NC/consumer＋中间输出）；`admission.json`：本轮角色/树/接收身份登记；`r3-SHA256SUMS.txt`：本机产物自校验清单。
