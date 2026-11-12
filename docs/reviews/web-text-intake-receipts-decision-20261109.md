# 回执可观测性只读技术裁定（MAYNE-24 W1 / OhMyPi）

> 派工 `01a1bc32-a569-7e5c-aa67-8a10a90292e2`：OhMyPi 未参与生产实现，对 `side_effect_receipts` 的可观测性做**只读技术裁定**——核实已有 progress/worker/tool 帧能否支持与真实调用对应、可追溯的 `side_effect_receipts`；区分「没有只读证明」（可诚实记 0）与「虚构调用/外部引用」；**不能从模型输出格式推定无副作用**。若现有协议不足，给最小 Runtime 接线的精确文件/帧 schema/时序、非秘密字段来源、失败与兼容验证及可审补丁字节哈希。
> 本裁定**不改生产 Runtime**、不新增 schema、不实现方案；提案另派独审后统一裁定权限。MAYNE-24 保持 in_progress。

## 1. 结论

**现有协议不足以支撑可追溯的 `side_effect_receipts`；但缺口比「协议完全没有」小得多——`worker` 帧与 MCP `mcp` 控制帧已经把「哪一次外部调用、对应哪个 modelCallId、哪个 server/schema 修订」写上了 stdout，只是被后端丢弃且缺一个字段。最小接线 = 1 个后端消费点 + 1 个运行时的 3 行补丁。**

三个层次的判定：

| 层 | 现状 | 判定 |
|---|---|---|
| `progress` 帧 | `{type:'progress',phase:'tool'}` —— 无工具名、无参数、无序号、无 server | **不足**：只能证明「发生过至少一次工具调用」，不能与具体调用对应 |
| `worker` 帧 | `{type:'worker',action:'start'/'end',pid,nonce}`，由 `managed-bash.mjs:21/38` 每次真实 spawn/结束发出 | **部分可用**：能证明 bash 子进程的真实存在与 pid，但没有命令内容、没有 modelCallId 关联 |
| `mcp` 控制帧 | `{type:'mcp',action,requestId,serverId,callId,input:{id,modelCallId,modelName,configurationRevision,schemaSha256,argumentsJson},runId,hostNonce}`，由 `mcp-control.mjs:16` 每次真实 MCP 调用发出 | **基本可用**：已含 `modelCallId`、`serverId`、`callId`、`configurationRevision`、`schemaSha256`——正是 `side_effect_receipts` 需要的追溯键 |

关键机械事实（本审定实的核心）：这些帧**已经**写到 stdout、**已经**带 `runId`/`hostNonce`，因此**已经通过**后端 `worker-host.mjs:129` 的 `if (frame.runId !== runId) continue;` 身份栅栏——后端不是「收不到」，而是**收到后只取 `result`/`error`，其余全部丢弃**（`worker-host.mjs:133-134`）。

## 2. 逐帧核实（只读，附文件:行）

### 2.1 `progress` 帧——不足以对应真实调用

`runtime/entries/organizer-entry.mjs:129`：

```js
agent.subscribe(event=>{if(event.type==='tool_execution_start'){emit({type:'progress',phase:'tool'});if(proofPath&&event.toolName==='bash'&&proof.length<1000)proof.push({type:'bash',commandHash:…});}});
```

同一行的 `event` 对象里**已经有** `toolName` 与 `args`（`vendor/pi/packages/agent/src/agent-loop.ts:493-498`：`{type:"tool_execution_start", toolCallId, toolName, args}`），但 `emit` 只送出 `{type:'progress',phase:'tool'}`。也就是说：**信息在运行时内部已存在，主动在出口处被丢掉了**。这不是「协议无法承载」，是「出口没带」。

同一订阅点还能拿到 `tool_execution_end`（`agent-loop.ts:931-938`：`{type, toolCallId, toolName, result, isError, durationMs}`）与 `tool_execution_update`（`agent-loop.ts:792-797`）。这三类事件合起来已足够构成「一次真实工具调用的开始/结束/结果摘要」。

### 2.2 `worker` 帧——真实进程存在的只读证明

`runtime/lib/managed-bash.mjs`：

```js
// :21  每次真实 spawn bash-worker
children.set(child.pid,child);onWorker({action:'start',pid:child.pid,nonce});
// :38  该子进程结束
…onWorker({action:'end',pid:child.pid,nonce});
```

`onWorker` 在 organizer 入口被接到 stdout（`organizer-entry.mjs:109`：`onWorker:event=>emit({type:'worker',...event})`）。因此「bash 工具子进程真实存在过、pid 是多少、何时结束」是**已经可观测的只读事实**——II 的 M-10/M-11 用例正是靠它证明 `bash-worker.mjs` 后代存在。

缺口：没有命令内容（只有 pid/nonce），也没有 `modelCallId`，无法把「这一次 bash」归到「模型发起的哪一次 toolCall」。

### 2.3 MCP `mcp` 控制帧——已含全部追溯键

`runtime/lib/mcp-control.mjs:16` 每次请求都发：

```js
this.send({ type:'mcp', action, ...body, requestId, runId:this.runId, hostNonce:this.hostNonce })
```

而 `mcp-trial.mjs:81` 的 `call_begin` body 是：

```js
{ ...session.identity, serverId: binding.serverId, callId,
  input:{ id:callId, modelCallId, modelName:binding.modelName,
          configurationRevision:session.server.configurationRevision,
          schemaSha256:binding.schemaSha256, argumentsJson } }
```

`session.identity`（`mcp-trial.mjs:28`）对 http 传输另含 `{transport:'http', run, nonce, endpointSha256, configurationRevision}`。`call_response`（`mcp-trial.mjs:87`）带 `{serverId, callId, result:checked.result}`。

对照 `side_effect_receipts` DDL（`001_web_backend.sql:88-96`）：

| DDL 列 | 现有帧可提供的值 | 来源 |
|---|---|---|
| `receipt_id` | 派生：`sha256(runId:attemptId:kind:callId)` 或 `callId` 本身（已是 uuid） | `mcp-trial.mjs:75` `callId=randomUUID()` |

> **废止标记（O-7）**：本表派生式是**原稿 §1 的早期表述**，已由追加 C 按队长统一公式取代（§C.1）。
| `attempt_id` | 后端自身的 attempt（消费点已知） | 后端 |
| `kind` | `'mcp'` / `'bash'` / `'skill_read'` | 帧类型 + `modelName` 前缀 |
| `external_ref` | `serverId` + `binding.toolName` + `configurationRevision` + `schemaSha256`（`mcp-trial.mjs:62` 的 binding），或 bash 的 pid+nonce | 帧内已有 |
| `recorded_at` | 后端收到帧的时间 | 后端 |
| `provable_readonly` | **帧内没有**，需按工具名/服务端静态判定（见 §4.3） | 需补 |

**结论：MCP 侧的追溯键已经在协议里，只差后端消费 + `provable_readonly` 判定。**

### 2.4 后端为何「看起来没有」

`server/lib/worker-host.mjs`（I 候选 `738414b`）的帧循环：

```js
if (frame.runId !== runId) continue;                 // :129 身份栅栏
if (process.env.WORKER_DEBUG) process.stderr.write(`[worker-frame] …`);  // :132 仅调试打印
if (frame.type === 'result') result = frame.data;    // :133
else if (frame.type === 'error') errorFrame = frame; // :134
for (const listener of listeners) listener(frame);   // :136 有扩展位，但无订阅者消费 progress/worker/mcp
```

`listeners` 数组是现成的扩展缝（`:136` 已经把每一帧交给订阅者），只是当前唯一订阅者（`:161-165`）只在 `result` 上留注释。**所以最小后端改动是「加一个订阅者」，不需要改帧协议、不需要改栅栏。**

### 2.5 不能从模型输出格式推定无副作用

P2/冻结契约把 `sideEffectSafety` 定义为「失败点之前不存在 `provable_readonly=false` 且可能已生效的外部调用」（`web-api-contract.md:214`），并明确「失败码本身不构成安全证明」。候选 `738414b` 的自陈反例成立：`capabilities.toolCall=true` 且挂载 skills/MCP 时，bash/MCP 会对外产生副作用；后端只看到 `progress{phase:'tool'}`/`worker`/`result|error`，无法区分「模型输出了 3 个候选、其中没有提到调用过工具」与「模型调用过工具但输出里没提」。**输出格式与副作用事实是两个独立通道，前者不能证明后者。**

诚实记账的两种形态必须分开：
- **没有只读证明**：bash/MCP 调用发生了，但协议/后端没有留下可追溯字段 → 记 `0` 条 receipt 并在恢复面按 `unknown` 处理（冻结契约允许「无法证明即 unknown，转 needs_review」）；
- **虚构调用/外部引用**：把模型输出里出现的字符串当成调用记录写入 `external_ref` → 这是伪造，任何形态都不可接受。

## 3. 最小 Runtime 接线提案（若队长裁定需要）

> 以下为**提案**，需另派独审后统一裁定权限；本裁定不实现、不改生产 Runtime。设计约束：不新增 npm 依赖、不新增 schema、不改冻结 DDL/守卫、不把秘密写进任何帧。

### 3.1 改动清单（3 个文件，均为小补丁）

| # | 文件 | 改动 | 性质 |
|---|---|---|---|
| P-1 | `runtime/entries/organizer-entry.mjs` | `agent.subscribe` 的 `emit` 从 `{type:'progress',phase:'tool'}` 扩为带 `toolCallId`/`toolName` 的工具帧（§3.2） | 出口扩字段 |
| P-2 | `runtime/entries/organizer-entry.mjs` | 同一订阅点补 `tool_execution_end` → 工具结束帧（含 `isError`/`durationMs`，**不含 result 内容**） | 出口扩字段 |
| P-3 | `server/lib/worker-host.mjs` | 在 `listeners` 上加一个订阅者，把工具帧/MCP 帧转成 `side_effect_receipts` 行（§3.4） | 后端消费 |

`mcp` 控制帧**不需要改**（追溯键已齐）；`worker` 帧**不需要改**（pid/nonce 已够证明进程存在）。

### 3.2 帧 schema（精确）

所有新帧沿用现有出口约定：stdout 一行 JSON、带 `runId`/`hostNonce`（与 `result`/`error`/`mcp` 一致，因此自动通过 `worker-host.mjs:129` 的身份栅栏）。

**（a）工具开始帧**（替代/扩展现有 `progress{phase:'tool'}`；保留 `phase:'tool'` 以兼容现有观测）：

```json
{"type":"progress","phase":"tool","runId":"<runId>","hostNonce":"<48hex>",
 "tool":{"toolCallId":"<toolCall.id>","toolName":"<toolCall.name>","kind":"bash|mcp|skill_read"}}
```

- `toolCallId`、`toolName`：`agent-loop.ts:493-498` 的 `event.toolCallId` / `event.toolName`。
- `kind`：由 `toolName` 前缀判定——`mcp_` → `mcp`（`mcp-trial.mjs:62` 的 `modelToolName(server.id, tool.name)` 生成 `mcp_<serverId>_<tool>` 形），`bash` → `bash`，skills 的 read 工具 → `skill_read`。**判定逻辑不进帧**，帧里只放判定结果，避免后端重复解析命名约定。
- `modelName`（MCP 的 `binding.modelName`）由 P-3 从 `mcp` 控制帧的 `call_begin.input.modelName` 取，与 `toolCallId` 关联，不在此帧重复。

**（b）工具结束帧**（新增）：

```json
{"type":"progress","phase":"tool_end","runId":"<runId>","hostNonce":"<48hex>",
 "tool":{"toolCallId":"<toolCall.id>","toolName":"<toolCall.name>","isError":false,"durationMs":123}}
```

- 来源 `agent-loop.ts:931-938` 的 `tool_execution_end`。
- **不带 `result` 内容**：工具输出可能含外部数据，且 `managed-bash.mjs:24-27` 的 `[REDACTED]` 只作用于 bash 输出通道；把 result 搬到一个新通道会绕过既有脱敏面。只带 `isError`/`durationMs` 足以支撑「调用是否发生/是否失败」的台账判定。

**（c）MCP 帧不变**：`{type:'mcp',action:'call_begin'|'call_response',requestId,serverId,callId,input:{id,modelCallId,modelName,configurationRevision,schemaSha256,argumentsJson},runId,hostNonce}`。

> **秘密边界（硬约束）**：`argumentsJson` 是**模型提供的参数**，未经 `managed-bash.mjs:24-27` 那套 `[REDACTED]` 脱敏（该脱敏只作用于 bash 的**输出**）。因此 P-3 **不得**把 `argumentsJson` 写入 `side_effect_receipts.external_ref` 或任何 DB/日志/SSE；只用 `serverId`/`binding.toolName`/`configurationRevision`/`schemaSha256`/`callId` 这些**非秘密标识**。（`mcp-trial.mjs:121` 的 `sensitive` 数组证明运行时已把 apiKey 与 http sensitiveValues 视为秘密，但参数通道不在其列。）
> 同理，(a)(b) 两帧**不得**携带 `args`。

### 3.3 `side_effect_receipts` 字段映射与 `provable_readonly` 判定

| DDL 列 | 值 | 来源 |
|---|---|---|
| `receipt_id` | `sha256(<runId>:<attemptId>:<kind>:<ref>)` 前 32 hex | 后端派生，保证同 attempt 内稳定 |
| `attempt_id` | 后端当前 attempt | 后端 |
| `kind` | `'mcp'` / `'bash'` / `'skill_read'` | (a) 帧 `tool.kind` |
| `external_ref` | MCP：`<serverId>/<toolName>@<configurationRevision>#<schemaSha256前16>`；bash：`pid:<pid>:nonce:<nonce>`；skill_read：**不记**（只读本地技能文件，见下） | `call_begin` 帧 + `worker` 帧 |
| `recorded_at` | 后端收到帧的 ms | 后端 |
| `provable_readonly` | MCP：`0`（外部服务调用，无法证明只读）；bash：`0`（任意命令）；skill_read：`1` | **静态判定表**，不猜 |

**`skill_read` 的处理**：技能 read 只读工作根内文件、无外部副作用。若把它计入 receipt，应 `provable_readonly=1`；若为降低噪声不计入，则必须在恢复面明确「未记 ≠ 无调用」。本裁定倾向**计入且记 1**，理由是冻结契约的判定问的是「失败点之前是否存在 `provable_readonly=false` 的调用」，漏记只读调用不影响该判定，但漏记会让「调用集合」不完整、削弱可审计性。

**`provable_readonly` 不许动态猜**：它来自「这个工具/服务端是什么」的静态知识（bash 必然可能写；MCP 外部服务必然不可证明）。不能从模型输出、不能从工具返回内容推断。

### 3.4 后端消费点（P-3）时序

```
worker-host.start()
  ├─ spawn 子进程（现有）
  ├─ listeners.push(receiptSink)                     ← 新增订阅者
  │    sink(frame):
  │      if frame.type==='progress' && frame.phase==='tool'
  │          pending.set(frame.tool.toolCallId, {kind: frame.tool.kind, at: now()})
  │      if frame.type==='progress' && frame.phase==='tool_end'
  │          entry = pending.get(frame.tool.toolCallId); if entry && !entry.written
  │              writeReceipt(entry, isError: frame.tool.isError)   // 落 side_effect_receipts
  │      if frame.type==='mcp' && frame.action==='call_begin'
  │          mcpByCall.set(frame.input.modelCallId, {serverId, toolName,
  │              configurationRevision, schemaSha256, callId: frame.callId})
  │      if frame.type==='worker' && frame.action==='start'
  │          workerByPid.set(frame.pid, frame.nonce)
  ├─ 结果暂存事务（现有）：把本次 attempt 已落的 receipts 一并提交
  └─ 退出确认（现有）
```

要点：
1. **receipt 与 attempt 同事务**：在 `stageResult`/`confirmExit` 的既有事务内写，避免「receipt 落了但 attempt 回滚」的悬挂。这与冻结契约「副作用台账是 `needs_review`/恢复核对的数据基础」一致。
2. **bash 的 receipt 用 `worker` 帧而非工具帧**：`worker{action:'start',pid,nonce}` 是真实 spawn 的只读证据，比工具帧更硬；用 `pending` 的 `toolCallId` 关联到模型调用。
3. **迟到帧**：若 `tool_end` 迟到于 attempt 结束（异常路径），按 `pending` 未写入处理，**不补写**——与冻结契约「晚到结果不入账」同方向。
4. **失败路径**：子进程退出但无 `result` 帧时，`pending` 里未闭合的调用**保留为未闭合**，恢复面按「无法证明无副作用」处理（`sideEffectSafety=unknown` → `needs_review`）。这正是「诚实记 0」的机械形态：有未闭合调用 ⇒ 不能证明安全。

### 3.5 失败与兼容验证

| 场景 | 期望 |
|---|---|
| 现有 `progress{phase:'tool'}` 旧帧（未带 `tool` 字段） | 后端 `sink` 跳过（`frame.tool` 为空即忽略），不影响现有 result/error 路径——**向后兼容** |
| `tool_end` 无对应 `tool` 开始帧 | 忽略，不写 receipt |
| `tool_end` 重复 | 首次写入后标记 `written`，重复忽略 |
| `argumentsJson` 含类秘密字符串 | 断言：receipt 行、日志、SSE、`effectiveConfig` 均不含该字符串（脱敏扫描） |
| MCP 调用失败（`call_response` 不到） | `call_begin` 已记 ⇒ receipt 仍在（调用**已发生**），`isError` 缺省按未知处理，不因此判定 proven_safe |
| 子进程 SIGKILL | `pending` 未闭合 ⇒ 恢复面 `unknown`，占槽待核对（既有判据不变） |
| 真实 Pi 正常链（无工具） | 零 receipt，任务正常 succeeded——**零 receipt 是合法状态**，不与「漏记」混淆（判据：无 `tool` 开始帧即无调用） |

### 3.6 可审补丁字节哈希

本裁定**不产出补丁**（只读裁定，未获实现授权）。若队长裁定需要实现，补丁应按 §3.1 的三文件清单生成，并在交付时提供：
- `runtime/entries/organizer-entry.mjs` 与 `server/lib/worker-host.mjs` 的 `git diff` 及其 SHA-256；
- 帧 schema 的黄金样例（一次 bash 调用 + 一次 MCP 调用的完整 stdout 帧序列）及 SHA-256；
- 聚焦验证：receipt 行与 `worker`/`mcp` 帧一一对应、`argumentsJson` 脱敏扫描、旧帧兼容、SIGKILL 未闭合路径。

## 4. 对「是否必须现在做」的裁定意见

**不必作为 W1 集成的阻断项，但不许划去后续阶段。** 依据：

1. 冻结契约本身给了合法出口：`sideEffectSafety` 无法证明时转 `needs_review`（`web-api-contract.md:214`）。因此**诚实记 0 条 receipt** 时，行为是「有工具调用的 attempt 在失败/退出未知时按 `unknown` 处理」——这是契约允许的保守分支，不是缺陷。
2. 但当前后端连「有没有发生过工具调用」都观测不到（`progress{phase:'tool'}` 被丢弃），所以**连保守分支都选不了**——它只能默认「无调用」。这是真正的缺口：不是 receipt 为空，而是**调用集合不可观测**。
3. 因此最小价值改动是 **P-3 单独一项**（后端订阅 `progress{phase:'tool'}` 与 `worker` 帧，只记「调用是否发生 + pid」）：不需要改 Runtime、不需要新帧 schema，就能把「不可观测」变成「可观测但字段薄」。MCP 的完整追溯键已经在 `mcp` 帧里，P-3 一并消费即可，无需 P-1/P-2。
4. P-1/P-2（扩工具帧带 `toolCallId`/`toolName`）是「把已有信息搬到出口」，风险低但**改了 Runtime 出口**，按只读区规则需单独授权；建议与 W2（三角色/Skills/MCP 业务接线）合并评估，避免本轮动 Runtime。

**建议裁定口径**：W1 集成轮把「工具调用集合可观测」列为**已知限制**并诚实记账（receipts 记 0 + 恢复面按 unknown 保守处理）；P-3 的最小消费点作为独立小候选另派独审；P-1/P-2 随 W2 Runtime 接线一并裁定。**不允许**以「模型输出未提及工具调用」为由在任何报告里写成「无副作用」。

## 5. 证据索引（`build/web-text-intake-receipts-decision/`）

- `frame-observability-audit.txt`：逐帧可观测字段核实（文件:行 + 实测帧形状）
- `backend-fence-simulation.txt`：用真实帧形状跑后端 `worker-host.mjs:129` 身份栅栏的实测结果
- 未改任何生产文件；未跑完整门禁（只读裁定边界）

---

# 追加裁定 A（P-3 收口）：只用现有帧字段的可审独立方案

> 派工 `01a1bc3a-f05d-7814-a7b8-4bf4b396d42d`：原稿 §3.4 伪码依赖 `frame.tool.toolCallId` 与新 `tool_end`，§3.5 又跳过旧 progress——**当前不能据此称只消费现有协议**。本追加据此收口：明确只用现有 MCP/worker/progress **实际字段**的映射与未知边界；已观察到的调用开始必须**及时持久化真实事实**，覆盖 result 前 SIGKILL/后端重启，不能只放内存 pending 等结果/结束帧；陈旧 attempt 帧拒绝与当前 attempt 未闭合调用**分开处理**。
> 既有设计授权允许在 `build/` 形成提案补丁、黄金帧、复跑脚本/输出及哈希，**不要求修改生产 Runtime**。原稿（§1–§5）历史保留，未改写。

## A.1 原稿缺陷的自我更正（三项）

| # | 原稿问题 | 更正 |
|---|---|---|
| A-1 | §3.4 伪码读 `frame.tool.toolCallId`、等 `tool_end` 才写 receipt，§3.5 又让旧 progress 被跳过 ⇒ 若 P-1/P-2 未落地，P-3 **一条 receipt 也落不了**，却声称「只消费现有协议」 | 矛盾属实。本追加把 P-3 重写为**只用现有字段**：不再引用 `frame.tool`、不再等待 `tool_end` |
| A-2 | 「已观察到的调用开始」只进内存 `pending`，等结果/结束帧才持久化 ⇒ result 前 SIGKILL 或后端重启即丢失，恰是最需要台账的路径 | 改为**开始即持久化**：观察到调用开始就在同一事务落一条「未闭合」receipt，退出/结果/恢复路径只做闭合或标注，不再从内存重建 |
| A-3 | 陈旧 attempt 帧与当前 attempt 未闭合调用混在一处讨论 | 拆成两个独立机制：**陈旧帧 → 拒绝（不入账）**；**当前 attempt 未闭合 → 保留为未闭合（不可推导 proven_safe）** |

## A.2 现有帧的可用字段（精确，无新增）

| 帧 | 现有字段 | 能证明的真实事实 | 不能证明（未知边界） |
|---|---|---|---|
| `progress{phase:'tool'}` | `type,phase,runId,hostNonce` | 「本 run 至少发生过一次工具调用」 | 哪一次、什么工具、参数、成功与否、次数 |
| `worker{action:'start',pid,nonce}` | `+action,pid,nonce` | 「一个 bash 工具子进程以该 pid/nonce 真实存在」 | 命令内容、归属哪次 modelCall |
| `worker{action:'end',pid,nonce}` | 同上 | 「该子进程已结束」 | 退出码、是否产生外部效果 |
| `mcp{action:'call_begin',…}` | `requestId,serverId,callId,input:{id,modelCallId,modelName,configurationRevision,schemaSha256,argumentsJson}` + http 的 `endpointSha256/nonce/run` | 「一次针对 `<serverId>` 的真实 MCP 调用，`modelCallId=<…>`，schema 修订 `<configurationRevision>`/`<schemaSha256>`」 | 调用是否成功（要看 `call_response`）、参数内容（秘密边界禁载） |
| `mcp{action:'call_response',…}` | `requestId,serverId,callId,result` | 「该 callId 的调用有了返回」 | `result` 内容禁载（外部数据） |

**身份判据（可用且充分）**：每一帧都带 `runId`+`hostNonce`，`runId` 由后端 `worker-host.start()` 生成（`worker-host.mjs:63-64`），`hostNonce` 同处生成（`:64`）。因此**当前 attempt 的帧 = `runId` 与 `hostNonce` 都与本次 attempt 匹配的帧**；这正是区分「陈旧 attempt 帧」与「当前 attempt 帧」的充要条件——不需要 attemptId/epoch 进帧。

## A.3 P-3 映射（只用上表现有字段）

### A.3.1 落库事实与 `side_effect_receipts` 列映射

| DDL 列（`001_web_backend.sql:88-96`） | 值 | 来源 |
|---|---|---|
| `receipt_id` | `sha256(runId:kind:ref)[0:32]` | 后端派生，同 attempt 内稳定 |

> **废止标记（O-7）**：追加 A 的该派生式**缺 `attemptId`，且 `ref` 不含单次调用身份**，已由追加 C 按队长统一公式取代（§C.1）。
| `attempt_id` | 当前 attempt | 后端已知 |
| `kind` | `'mcp'` / `'bash'` | `mcp` 帧 / `worker` 帧 |
| `external_ref` | MCP：`<serverId>/<modelName>@<configurationRevision>#<schemaSha256前16>`；bash：`pid:<pid>:nonce:<nonce>` | `call_begin` 帧 / `worker` 帧 |
| `recorded_at` | 观察到帧的后端时钟 | 后端 |
| `provable_readonly` | MCP `0`；bash `0` | **静态判定表**，不猜 |

`progress{phase:'tool'}` **不单独落 receipt**：它无法归因到具体调用，落进去只能是「本 run 有工具调用」这种不可追溯事实，反而污染台账。它的正确用途是 §A.5 的「未归因调用存在」标记。

### A.3.2 及时持久化（覆盖 result 前 SIGKILL / 后端重启）

核心规则：**观察到调用开始 ⇒ 立即在同一事务落一条未闭合 receipt**；后续帧只做闭合/标注，不从内存重建。

```
worker-host.start({task, attemptId, …})
  ├─ 生成 runId + hostNonce（现有 :63-64）
  ├─ 订阅者 receiptSink(frame)：                       // 挂在现有 listeners 缝（:136）
  │    if (frame.runId !== runId || frame.hostNonce !== hostNonce) return;   // 见 A.4 身份加固
  │    if (frame.type === 'mcp' && frame.action === 'call_begin')
  │        persistReceipt({kind:'mcp', ref: externalRefOf(frame), open:true})   // 立即落库
  │    if (frame.type === 'worker' && frame.action === 'start')
  │        persistReceipt({kind:'bash', ref: `pid:${frame.pid}:nonce:${frame.nonce}`, open:true})
  │    if (frame.type === 'mcp' && frame.action === 'call_response')
  │        closeReceipt(callIdOf(frame))                // 标记闭合，不删行
  │    if (frame.type === 'worker' && frame.action === 'end')
  │        closeReceipt(pidNonceKey(frame))
  │    if (frame.type === 'progress' && frame.phase === 'tool')
  │        markUnattributedToolCall()                   // 只置位，不落 receipt
  ├─ 结果暂存事务（现有）：本次 attempt 的 receipts 随事务提交
  └─ 退出确认（现有）：退出前把仍 `open` 的 receipts 标为 `unclosed_exit`

> **废止标记（O-4）**：以上两行（「receipts 随暂存事务提交」「退出前标 `unclosed_exit`」）是追加 A 的原始表述，**自追加 B §B.3 起作废**。现行口径：receipt 在**观察即刻**以独立小事务写入；闭合/未归因同样独立小事务；`stageResult`／`confirmExit` **只读**已提交事实，不写 receipt、也不引入 `unclosed_exit` 状态（未闭合由「无对应 `tool_call_closed` 事件」推算）。本代码块仅为追加 A 的历史方案记录。
```

**为什么这样能覆盖 SIGKILL/重启**：
- result 前 SIGKILL：`call_begin`/`worker start` 已落库，`call_response`/`worker end` 永不到达 ⇒ 该行停在 `open` ⇒ 恢复面读到「有未闭合调用」⇒ **不能**判 `proven_safe`。
- 后端重启：receipt 在 SQLite 里，不随后端内存消失；新实例的恢复扫描按 `attempt_id` 读到旧 attempt 的未闭合行，按 §A.4 处理。

**事务归属**：receipt 写入走 `task-service.transact`（`task-service.mjs:95-97` 的既有缝），与 `stageResult`/`confirmExit` 同一存储通道；不新增存储命令、不改 DDL（`side_effect_receipts` 已在 `BUSINESS_TABLES` 白名单内，`web_backend_store.rs:34`）。

### A.3.3 「闭合」的语义（不删行）

`side_effect_receipts` 没有状态列，**不加列**（不碰冻结 DDL）。闭合用两种可审方式之一（提案二选一，供独审判定）：

- **方案 C1（推荐，零 schema）**：不更新行，用 `task_events` 记一条 `{type:'tool_call_closed', object_id:<receipt_id>}`；未闭合 = 该 receipt_id 无对应闭合事件。恢复面用「receipt 集合 − 闭合事件集合」算未闭合。
- **方案 C2（需 004 级迁移）**：新增 `state` 列。**本提案不采用**——003 已冻结，加列成本与正确方案相同而这里并非必要。

推荐 C1：`task_events` 是既有的、按 `(object_type,object_id)` 索引的事件表（`001_web_backend.sql:86`），且「以事件留痕、不产生业务写入」正是冻结契约对迟到结果的处理方式（§3.3），方向一致。

## A.4 陈旧 attempt 帧 vs 当前 attempt 未闭合调用（分开处理）

### A.4.1 陈旧 attempt 帧 → 拒绝，不入账

判据：`frame.runId !== runId || frame.hostNonce !== hostNonce` ⇒ **整帧丢弃，不落 receipt、不闭合任何行**。

现状缺陷（已由队长同步派给 I 修）：`worker-host.mjs:131` **只比较 `runId`**。`runId` 是 12 字节随机 hex，碰撞可忽略，但 `hostNonce` 才是运行时侧的握手凭据（`organizer-entry.mjs:44` 对 cancel/MCP 帧都校验 `runId`+`hostNonce`）。后端少校验一项意味着：理论上可构造一个同 `runId` 的帧穿过栅栏。P-3 的身份判据以 `runId`+`hostNonce` **双校验**为前提；该加固属 I 的修复项（队长已在同评论派给 Claude），P-3 提案补丁里**包含**这一行加固，使方案自洽。

**为什么陈旧帧必须拒绝而不是入账**：旧 attempt 的 `call_begin` 属于**另一次 attempt**。把它计入当前 attempt，会让当前 attempt 的副作用集合包含并非它产生的调用——这正是「虚构外部引用」的一种形态，只是来源是协议而非模型输出。

### A.4.2 当前 attempt 未闭合调用 → 保留，不可推导安全

判据：帧通过双校验，但直到 attempt 结束/结果提交都没有对应闭合事件 ⇒ 该 receipt **保持未闭合**，并且：

- **不得**参与 `proven_safe` 判定（`web-api-contract.md:214`：`proven_safe` 要求失败点之前不存在 `provable_readonly=false` 且可能已生效的外部调用；有未闭合的 `provable_readonly=0` 调用 ⇒ 无法证明）；
- 恢复面按 `sideEffectSafety=unknown` 走 `needs_review`（契约允许的保守分支）；
- **不得**因为「receipt 数为 0」而推 `proven_safe`——0 条的原因必须是「没有观察到任何调用开始帧」，由 §A.5 的未归因标记区分。

## A.5 零记录的两种成因必须可区分

| 观测 | 含义 | 恢复面判定 |
|---|---|---|
| 无任何 `progress{phase:'tool'}`、无 `worker`、无 `mcp` 帧 | 本 attempt **未发生工具调用** | 可判 `proven_safe`（就本次可观测面而言） |
| 有 `progress{phase:'tool'}` 但无 `worker`/`mcp` 帧 | **发生了调用但不可归因**（旧 progress 不带工具名） | **不得**判 `proven_safe`；按 `unknown` → `needs_review` |

第二种是「现有协议不足」的直接后果，也是本追加相对原稿最重要的澄清：**P-3 落地的台账在 MCP/bash 路径上是真实的，在「只有 progress 标记」的路径上必须显式记未知，不能用零 receipt 冒充无副作用。** 这也回应了派工「尤其不能以零记录推导 proven_safe」。

## A.6 秘密边界（在现有字段上的硬约束）

1. **`argumentsJson` 禁载**：模型提供、不经 `managed-bash.mjs:24-27` 的 `[REDACTED]`（只作用于 bash 输出）。`external_ref` 只用 `serverId`/`modelName`/`configurationRevision`/`schemaSha256`/`callId`。
2. **`mcp` 的 `result` 禁载**：外部数据，只用来判「闭合」，内容不入库/日志/SSE。
3. **`worker` 帧的 pid/nonce 可载**：非秘密进程标识。
4. **顺带必须删除的既有泄漏路径**：`worker-host.mjs:132` 的 `WORKER_DEBUG` 会把**原始 frame 截断**写 stderr——frame 里的字段（一旦 P-3 开始消费 `mcp` 帧，即含 MCP 调用的 `argumentsJson`）。截断不是秘密边界。

   > **更正（O-2）**：原文称该 frame 「含 `apiKey`（请求帧回显）」——**此说法无依据，已撤回**。后端只把**请求**（含 apiKey）写往 worker 的 **stdin**；从 stdout 收到的都是运行时**响应**帧（`progress`/`worker`/`mcp`/`result`/`error`），其中没有 apiKey 回显。apiKey 的敏感面在 stdin 与 MCP 的 `sensitive` 列表（`mcp-trial.mjs:121`），不在 stdout 帧内。删除 `WORKER_DEBUG` 的正确理由仅是「截断不是脱敏，且会泄露 `argumentsJson`」，**不得**以「frame 含 apiKey」为依据。队长已派 I 删除该路径；P-3 提案补丁同样删除它（它若留着，P-3 新增的帧消费会让泄漏面变大）。
5. **日志/SSE**：receipt 行只含 §A.3.1 的非秘密列；不新增任何把帧原文写日志的路径。

## A.7 复跑脚本与黄金帧（证据包）

`build/web-text-intake-receipts-decision/p3/` 下提供可下载、可复跑的材料：

| 文件 | 内容 |
|---|---|
| `golden-frames.jsonl` | 15 帧的完整 stdout 序列样例：`progress/model`+`progress/tool`×2、`worker start/end`×2、`mcp call_begin/call_response`×3、`result`，另含 1 帧陈旧 `runId` 组与 1 帧「当前 runId + 外来 hostNonce」 |
| `p3-consumer.mjs` | P-3 订阅者的**可独立运行参考实现**（零依赖、不 import 任何生产模块；吃 `golden-frames.jsonl`，输出 receipt 行、闭合/未闭合集合与判定） |
| `p3-consumer-run.txt` | 上述脚本实跑输出：4 receipts（2 CLOSED / 2 OPEN）、4 帧被拒、2 次未归因标记、判定 `NOT proven_safe` |
| `p3-identity-matrix.txt` | 15 帧逐帧身份矩阵：现行 `runId`-only 判据 vs 提案双校验，标出**唯一分歧帧** |
| `p3-zero-record-cases.txt` | §A.5 三个场景实跑：无调用（可判 safe）／只有 progress（不可判 safe）／SIGKILL 前中断（未闭合并存续） |
| `p3-secret-scan.txt` | 对黄金帧跑消费器后的脱敏扫描：所有 `argumentsJson` 值与 `mcp` result 内容在输出中 0 命中；源码级确认该字段未被读取 |
| `p3-proposal.diff` | 对生产 `server/lib/worker-host.mjs`（`738414b` 版）的 3 hunk 提案补丁：删 `WORKER_DEBUG` 原始帧写 stderr、`runId`+`hostNonce` 双校验、在既有 `listeners` 缝上挂可选 `receiptSink` |
| `worker-host.proposed.mjs` | 打上补丁后的完整文件（`node --check` 通过），供逐行核对 |
| `p3-fence-verification.txt` | 两种判据在 15 帧上的逐一对照，分歧帧数 = 1 |
| `p3-persistence-proof.mjs` / `p3-persistence-run.txt` | **真实合成 SQLite**（冻结 001 DDL 原文）证明「开始已提交 → result 前中断 → 重开连接仍在」；含同工具两次调用不合并的对照 |
| `p3-restart-proof.mjs` / `p3-restart-run.txt` | **新进程/新连接**恢复仍在（`node p3-restart-proof.mjs <db-path>`） |
| `p3-negative-controls.mjs` / `p3-negative-controls-run.txt` | 四个反例：只有 progress、连续同工具两次调用、错误 nonce、全部闭合仍有非只读调用 |
| `p3-merging-counterexample.txt` | 旧身份规则 vs 新身份规则在同一黄金流上的行数对比 |
| `p3-lib.mjs` | 共享模块：**完整冻结 001 DDL 原文**建表（`tasks`/`task_attempts`/`side_effect_receipts/`task_events`，含全部 CHECK/FK/索引，`foreign_keys=ON`）＋队长统一公式与事件 payload 构造 |
| `p3-negative-controls.mjs` / `-run.txt` | **7 个反例**：只有 progress 不可判 safe／同工具两次不合并／错 nonce 拒绝／全闭合仍有非只读不可判 safe／**闭合不得匹配被拒或未持久化的 begin（无前视）**／重复 begin 幂等／**孤儿 receipt 被冻结 FK 拒绝** |
| `p3-merging-counterexample.txt` | 三种 `receipt_id` 公式在同一黄金流上的行数对比（A 合并 / B 缺 attemptId / 队长公式既区分又限 attempt） |
| `p3-secret-scan.txt` | 四个脚本输出对 `argumentsJson` 值与 result 内容的 0 命中扫描＋源码级确认未读该字段 |
| `SHA256SUMS.txt` | 上述全部文件哈希 |

复跑方式（真实解释器命令，非本机 build 路径）：

```sh
node build/web-text-intake-receipts-decision/p3/p3-consumer.mjs \
     build/web-text-intake-receipts-decision/p3/golden-frames.jsonl
```

> **历史标记（O-1）**：本节及其 `p3-proposal.diff`／`worker-host.proposed.mjs` 是**追加 A 时期针对旧 `738414b` 目标生成的历史提案件**，按队长 `01a1bc81` 明确标注为历史，**不重生成、不追逐未稳定 HEAD**。最终生产接线差异由 I 在其实际基点交付（I 的写入范围为 `worker-host`/`task-service`/`task-scheduler`/`task-recovery` 及 I 原测试/证据路径）。下文保留仅用于追溯追加 A 的设计演化。

## A.8 候选身份与权限差异

- **候选身份**：本追加不产生生产提交；提案补丁以 `build/` 内的 diff 形式交付（`p3-proposal.diff` + SHA-256），供独审与队长裁定权限。生产 Runtime（`runtime/**`）**零改动**；P-1/P-2 仍未授权，本方案**不依赖**它们。
- **权限差异（最小）**：
  - P-3 落在**原 I 范围**内：`server/lib/worker-host.mjs`（加订阅者 + 删 `WORKER_DEBUG` + hostNonce 双校验）、`server/lib/task-service.mjs` 或调度器（receipt 事务写入）。**不改** `runtime/**`、不改 DDL/守卫、不改 `BUSINESS_TABLES`、不加 npm 依赖。
  - `task_events` 新增事件类型 `tool_call_closed`：属事件命名空间扩展，需队长确认不与冻结 §3.3 的 `rejected_late_result` 冲突（两者同为「留痕不写业务」类）。
- **未做**：不实现、不改生产文件、不跑完整门禁（只读裁定 + build 内参考实现边界）。

## A.9 结论

**P-3 在「只用现有帧字段」前提下可审且可闭合**：MCP 调用可落**完全可追溯**的真实 receipt（serverId/modelName/configurationRevision/schemaSha256/callId/modelCallId 全在帧里）；bash 调用可落**真实存在证明**（pid/nonce）但不可归到 modelCall；只有 progress 标记的调用**必须记未知**，不得以零记录推导 `proven_safe`。及时持久化覆盖 result 前 SIGKILL 与后端重启；陈旧 attempt 帧按 `runId`+`hostNonce` 双校验拒绝，当前 attempt 未闭合调用保留为未闭合并阻断 `proven_safe`。

原稿「不必作为 W1 阻断项」的意见**已被队长明确不采纳为豁免**（原 M-5 保持未闭合）；本追加不重复该意见，只提供可审方案与证据包，是否闭合由独审与队长裁定。

---

# 追加裁定 B（P-3 边界补齐）：安全判定、单次调用身份、C1 收口与持久化实证

> 派工 `01a1bc45-71a4-7517-a00d-6f0517946a52`：沿原文档/build 方案范围一次补齐四类边界，保留历史。本追加逐条更正追加 A 的不足，并用**真实合成 SQLite 路径**证明持久化（内存参考消费器只签分类机械性，不代签持久化）。仍不改生产 Runtime/DDL。
> 队长同评论确认的事件对象规则：`tool_call_closed` 作为**任务内部审计事件名**纳入方案——`object_type='task'`、`object_id=taskId`，payload 关联 `receiptId`/`attemptId`；**不是**把 receiptId 填成任务对象 ID，也不新增公开 HTTP/SSE 类型。

## B.1 「无调用帧即可 safe」不成立——已更正

**追加 A 的错误**：§A.5 表第一行把「无任何 progress/worker/mcp 帧」判为「可判 `proven_safe`（就本次可观测面而言）」。这在断流/崩溃下不成立：**流断了和「没有调用」在观测面上完全同形**—— worker 已被 spawn、正在执行外部调用，而 stdout 恰好没有送达任何帧。此时判 safe 就是把观测缺失当成安全证明。

**更正后的判定规则**：

| 观测 | 判定 |
|---|---|
| 无任何调用帧 | **不可判 safe**。记 `no_call_observed`（观测面事实），`sideEffectSafety` 仍为 `unknown` → `needs_review`。`proven_safe` 只能由**独立完整证据**给出（例如任务类型本身无可调工具、或运行时的工具白名单证明本次未挂载任何工具） |
| 有未归因 progress 标记 | `unknown` → `needs_review`（同追加 A） |
| 有未闭合的 `provable_readonly=0` 调用 | `unknown` → `needs_review`（同追加 A） |
| 全部闭合，但存在 `provable_readonly=0` 调用 | **仍不可判 safe**（见 B.4 反例 NC-4） |

**未归因 progress 标记进入持久事实**：追加 A 只说「只置位，不落 receipt」，但未说明该标记是否持久。更正：它必须是 `task_events` 的一条 `{type:'tool_call_unattributed', object_type:'task', object_id:taskId, payload:{attemptId, at}}` 行，与 `tool_call_closed` 同规则——**重启后由恢复扫描读到的仍是 1，不能清零**。实证见 B.5 的持久化/重启脚本（`unattributedMarks=1` 在重开连接与新进程中均保持）。

## B.2 单次调用身份——已更正

**追加 A 的错误**（§A.3.1）：`receipt_id = sha256(runId:kind:ref)`、`external_ref = <serverId>/<modelName>@<revision>#<schema前16>`——**不含 `callId`/`modelCallId`**。于是同一 tool/schema/revision 的两次**真实**调用会合并成一行：第二次调用被第一次吸收；更糟的是若第一次已闭合，第二次会**继承该闭合**，即一次未核实的调用被报成已闭合。

**更正后的身份规则**：

```
MCP:  callKey   = "<callId>:<modelCallId>"
      receipt_id= sha256(runId:attemptId:kind:callKey)[0:32]
      external_ref = <serverId>/<modelName>@<configurationRevision>#<schemaSha256前16>
                     /call=<callId>/modelCall=<modelCallId>
bash: callKey   = "<pid>:<nonce>"
      external_ref = pid:<pid>:nonce:<nonce>
```

- **单次身份保留**：两次真实调用 → 两行（实证：黄金流里 c-001 与 c-003 同 tool/schema/revision，旧规则合并为 1，新规则保持 2）。
- **重复帧幂等**：`callKey` 已含 `callId`，重复投递的同一 `call_begin` 仍映射到同一行（`INSERT` 前先按 `receipt_id` 存在性判断，或依赖主键冲突忽略），不会产生第二行。
- **依旧禁载**：`argumentsJson` 与 `mcp` 的 `result` 内容仍不进入任何列/日志/SSE；`external_ref` 只含非秘密标识。

## B.3 C1 按任务对象规则收口 + 异步顺序

`tool_call_closed` 按队长确认的对象规则落地：

```json
{"type":"tool_call_closed",
 "object_type":"task",
 "object_id":"<taskId>",
 "payload":{"receiptId":"<receipt_id>","attemptId":"<attempt_id>","callId":"<callId>","closedAt":<ms>}}
```

- `object_id` 是 **taskId**，不是 receiptId；receiptId 只在 payload 里关联。
- 不新增公开 HTTP/SSE 类型；这是任务内部审计事件，与冻结 §3.3 的 `rejected_late_result` 同类（「以事件留痕、不产生业务写入」）。
- 未归因标记同形：`{"type":"tool_call_unattributed","object_type":"task","object_id":"<taskId>","payload":{"attemptId":"…","at":<ms>}}`。

**未闭合集合的算法**（恢复面只读）：

```
openReceipts(attemptId) =
    SELECT r.* FROM side_effect_receipts r
    WHERE r.attempt_id = ?
      AND NOT EXISTS (SELECT 1 FROM task_events e
                      WHERE e.type='tool_call_closed'
                        AND e.object_type='task'
                        AND json_extract(e.payload,'$.receiptId') = r.receipt_id)
```

**receipt 写入完成与后续暂存/安全判定的异步顺序**（派工要求说明）：

1. **观察即写**：`call_begin`/`worker start` 帧通过身份栅栏后，**立即**以一条独立小事务写入 `side_effect_receipts`（不等结果、不等暂存）。这是「及时持久化」，保证 result 前中断不丢。
2. **闭合即写**：`call_response`/`worker end` 通过栅栏后，写 `tool_call_closed` 事件（同样独立小事务）。
3. **暂存/退出确认事务只读不写**：`stageResult`/`confirmExit` **不写 receipt**，只在同一事务内**读取**当前 attempt 的未闭合集合，用于：
   - 失败/退出未知时决定 `sideEffectSafety`（有未闭合 `provable_readonly=0` ⇒ `unknown` ⇒ `needs_review`）；
   - 成功后把 `proven_safe` 的判定条件固定下来（无未闭合非只读调用，且任务类型/工具白名单的独立证据完整）。
4. **顺序结论**：receipt 的写入**先于**任何依赖它的事务；暂存与安全判定**只读**台账。因此不存在「receipt 还没写就被用来判定」的竞态；反过来，暂存事务回滚也不会丢失已写的 receipt（它们是独立事实）。

**两级栅栏都不得靠内存映射替代**：

| 栅栏 | 持久依据 | 说明 |
|---|---|---|
| attempt/epoch | `task_attempts.attempt_id` + `epoch`（001 DDL 既有列） | 陈旧 attempt 帧的 `runId` 不在当前 attempt 的 worker 记录里 ⇒ 拒绝；恢复扫描按 `attempt_id` 读未闭合 receipt，不依赖任何进程内 Map |
| runId/nonce | `worker-host` 每次 attempt 生成并写入 worker 记录（`runs/<runId>/worker.json`，现有机制） | 帧的 `runId`+`hostNonce` 与记录比对；**双校验**（runId-only 的缺陷已派 I 修） |

内存映射（如追加 A 消费器里的 `pending`/`receipts` Map）只作为**单进程内的去重缓存**，持久事实一律以 DB 为准；进程重启后从 DB 重建，不继承旧 Map。

## B.4 反例（真实合成 SQLite，全部可复跑）

`build/web-text-intake-receipts-decision/p3/` 下四个脚本，全部用**冻结 001 DDL 原文**建表（`task_attempts`/`side_effect_receipts`/`task_events` + 索引），文件级 SQLite，`foreign_keys=ON`：

| 脚本 | 证明 |
|---|---|
| `p3-persistence-proof.mjs` | 「开始已提交 → result 前中断 → **重开连接**仍在」：3 条 receipt、2 闭合 1 未闭合、1 条未归因标记全部在读回后存在 |
| `p3-restart-proof.mjs` | 「开始已提交 → result 前中断 → **新进程/新连接**恢复仍在」：receipts/闭合集/未归因标记/开闭拆分全部幸存；未闭合非只读调用仍阻断 safe |
| `p3-negative-controls.mjs` | 四个反例：① 只有 progress → 不可判 safe；② 连续同工具两次调用 → 2 行不合并；③ 错误 nonce → 拒绝且不计账；④ 全部闭合但仍有非只读调用 → 仍不可判 safe |
| `p3-merging-counterexample.txt` | 旧身份规则 vs 新身份规则在同一黄金流上的行数对比（旧 2 / 新 4，含被栅栏拒绝的那一帧的计数说明） |

复跑命令（真实解释器调用）：

```sh
node build/web-text-intake-receipts-decision/p3/p3-persistence-proof.mjs
node build/web-text-intake-receipts-decision/p3/p3-restart-proof.mjs <db-path>
node build/web-text-intake-receipts-decision/p3/p3-negative-controls.mjs
node build/web-text-intake-receipts-decision/p3/p3-consumer.mjs \
     build/web-text-intake-receipts-decision/p3/golden-frames.jsonl
```

实测输出（随附件 `p3-*-run.txt`）：

- persistence：`receipts=3 closed=2 open=1 unattributedMarks=1`；同工具两次调用 `2`（旧规则为 `1`）。
- restart（独立进程）：`receipts=3 closed=2 open=1 unattributedMarks=1`，`open provable_readonly=0 calls: 1` → `PASS`。
- negative controls：`NC-1..NC-4` 全部 `PASS`，`ALL NEGATIVE CONTROLS BEHAVE AS REQUIRED`。
- consumer（分类机械，内存）：`receipts=5 closed=2 open=3`，4 帧被拒（3 陈旧 runId + 1 陈旧 hostNonce）。

**边界声明**：这些脚本证明的是**持久化与规则**（真实 SQLite、重开连接、新进程）。它们不证明生产接线的正确性——`worker-host` 的订阅者、`task-service.transact` 的写入、恢复扫描的读取都尚未实现（P-3 仍是未实施方案，待 OpenCode 独审与队长裁定权限）。内存消费器只签分类机械性，不代签持久化；持久化由上述三个 SQLite 脚本签。

## B.5 完整接线范围的提案差异

相对追加 A，接线范围不变但补三处：

| 文件 | 追加 A | 追加 B 增补 |
|---|---|---|
| `runtime/**` | 零改动 | **零改动**（P-1/P-2 仍未授权，本方案不依赖） |
| `server/lib/worker-host.mjs` | 删 `WORKER_DEBUG`、`runId`+`hostNonce` 双校验、挂可选 `receiptSink` | 同左；`receiptSink` 由构造参数注入（不在模块内 new） |
| `server/lib/task-service.mjs`（或调度器） | receipt 事务写入 | ① `call_begin`/`worker start` → 独立小事务写 receipt；② `call_response`/`worker end` → 独立小事务写 `tool_call_closed` 事件；③ 未归因 progress → 独立小事务写 `tool_call_unattributed` 事件；④ `stageResult`/`confirmExit` 只读未闭合集合并据此定 `sideEffectSafety` |
| `server/lib/task-recovery.mjs` | （A 未展开） | 恢复扫描按 `attempt_id` 读未闭合 receipt 与未归因标记，决定 `needs_review`/占槽；不依赖进程内状态 |
| DDL / 守卫 / `BUSINESS_TABLES` | 不改 | **不改**（`side_effect_receipts` 已在白名单） |
| 公开 HTTP/SSE | 不新增 | **不新增**（`tool_call_closed`/`tool_call_unattributed` 只是 `task_events.type` 的内部取值） |

**权限差异**：全部落在原 I 范围内；唯一需队长确认的是 `task_events.type` 的两个新内部取值（`tool_call_closed`、`tool_call_unattributed`）不与既有注册值冲突。

## B.6 结论

追加 A 的两处不足（零记录判 safe、单次调用身份合并）已更正并用真实 SQLite 反证；C1 按队长确认的任务对象规则收口，receipt 写入先于且独立于暂存/安全判定，attempt/epoch 与 runId/nonce 两级栅栏均有持久依据、不靠内存映射；持久化经「重开连接」与「新进程恢复」双路实证，四个反例全部按规则失败。方案仍**未实施**，待 OpenCode 独审与队长裁定权限。

---

# 追加裁定 C（O-1～O-8 收口）：按队长统一口径对齐参考实现与证据包

> 派工 `01a1bc81-ef38-743f-a5ec-6ebc87e3b95e`：队长接收 OpenCode `b6e107d` 对追加 B 附件面四项 MAJOR 的关闭，**批准 P-3 在原 I 范围内实施**，并以本条**统一取代存在歧义的旧公式/伪码**。本追加按该口径收口 O 级残留 O-1～O-8，保留历史（A/B 段原文不改，只加废止/更正标记），资料补件只签其实际范围。
> **M-5 仍须生产落地、独审及最终门禁后关闭；本追加不签任何业务通过。**

## C.1 队长统一口径（本追加的实现基准）

| 项 | 统一口径 |
|---|---|
| `receiptId` | `sha256(UTF-8 紧凑 JSON.stringify([runId, attemptId, kind, callKey]))` 前 32 hex |
| `callKey` | MCP `[callId, modelCallId]`；bash `[pid, nonce]` |
| `external_ref` | 只保存**已有**非秘密追溯标识并保留单次身份；重复帧只读/幂等，不覆盖另一调用；**不载** `argumentsJson`／result 内容 |
| `tool_call_closed` | 对象 `task`/`taskId`；payload `{receiptId, attemptId, callId, closedAt}`（bash `callId=null`；`closedAt` 为 ISO UTC 毫秒） |
| `tool_call_unattributed` | 对象 `task`/`taskId`；payload 至少含 `{attemptId, runId}` |
| 无前视 | 闭合**只能**匹配此前已**接受且已持久化**的 begin；不得从原始帧全集向后查未来/被拒 begin |
| 写入时序 | 开始、闭合、未归因事实**各及时提交独立小事务**；守住当前 attempt/epoch 与 runId/nonce；接入已登记的串行 onFrame 链；暂存/退出/安全判定**等待**此前写入完成并**只读**已提交事实 |
| 暂存失败 | **不撤销**已发生的调用记录 |
| 审计隔离 | 内部审计**不借其 cursor 伪造** `task.changed` |
| 安全判定 | 已 spawn 而观察不完整、仅 progress、**任何非只读调用（含全部已闭合）**均**不能**据零记录/闭合推出 `proven_safe`；只接受独立完整证据；恢复读回同一事实；不信模型输出或错误载荷自报安全 |

## C.2 O-1～O-8 逐项收口

| # | OpenCode 残留 | 本追加处置 | 状态 |
|---|---|---|---|
| O-1 | 无重生成的 `proposal.diff` | 追加 A 的 `p3-proposal.diff`／`worker-host.proposed.mjs` 在 §A.8 明标**历史提案件**（针对旧 `738414b` 目标），**不重生成、不追逐未稳定 HEAD**；最终生产接线差异由 I 在其实际基点交付 | **收口** |
| O-2 | §A.6.4 「frame 含 apiKey（请求帧回显）」无依据 | 已就地**撤回并更正**：后端只把请求（含 apiKey）写往 worker **stdin**；stdout 收到的都是运行时**响应**帧，无 apiKey 回显；apiKey 敏感面在 stdin 与 MCP `sensitive` 列表。删除 `WORKER_DEBUG` 的正确理由改为「截断不是脱敏 + 会泄露 `argumentsJson`」 | **收口** |
| O-3 | `call_response` 从原始帧全集向后查 begin | 参考实现改为**两遍**：第一遍只处理 begin（接受即持久化），第二遍处理 end/response/mark；闭合只认第一遍已接受的 receiptId。新增反例 **NC-5**：begin 被拒（外来 nonce）时，同 callId 的 `call_response` **不得**闭合任何东西 | **收口** |
| O-4 | §A.3.2 「receipts 随事务提交」原样保留 | 已在该两行后加**废止标记**，指向 §B.3 现行口径（观察即独立小事务；暂存/退出确认只读；不引入 `unclosed_exit`） | **收口** |
| O-5 | restart 配套缺失（persistence 结尾无条件删库） | 三个真实入口：`keep`（建库并**保留**在 `p3/p3-phase1.sqlite`）、`phase1`、`restart <db>`（本进程重开连接）；`p3-restart-proof.mjs <db>`（**新进程**读回）；`clean`（删除本包创建的全部库文件）。无需外改 harness | **收口** |
| O-6 | 脚本称 DDL「冻结 001 原文」实为简化子集 | `p3-lib.mjs` 改为**完整冻结 001 DDL 原文**：`tasks`（全列＋2 条 CHECK）、`task_attempts`（全列＋2 条 CHECK＋3 索引含 `task_attempts_current` 部分唯一索引）、`side_effect_receipts`（逐列一致）、`task_events`（`cursor` 主键＋`object_type` CHECK＋`payload NOT NULL`），`PRAGMA foreign_keys=ON`。反例 **NC-7** 实证孤儿 receipt 被 FK 拒绝 | **收口** |
| O-7 | 公式不一致（文档含 attemptId，三脚本无） | 全部统一为船长公式 `sha256(JSON.stringify([runId,attemptId,kind,callKey]))`；原稿 §1 表与追加 A 表各加废止标记；`p3-merging-counterexample.txt` 给出三公式同流对比（A 合并／B 缺 attemptId／船长公式既区分又限 attempt） | **收口** |
| O-8 | payload 脚本 `{receiptId,attemptId}` vs 文档含 `callId/closedAt` | 统一为 `{receiptId, attemptId, callId, closedAt}`（bash `callId=null`）；未归因 payload 至少 `{attemptId, runId}`。`p3-restart-proof.mjs` 增加**payload 形状断言**，不符即 `MISMATCH` 并 `FAIL` | **收口** |

## C.3 证据包（`build/web-text-intake-receipts-decision/p3/`，全部可复跑）

复跑序列（真实解释器命令，无需改 harness）：

```sh
cd build/web-text-intake-receipts-decision/p3
node p3-persistence-proof.mjs keep                       # 建库并保留
node p3-restart-proof.mjs ./p3-phase1.sqlite             # 新进程读回（PASS）
node p3-persistence-proof.mjs restart ./p3-phase1.sqlite # 本进程重开连接（PASS）
node p3-negative-controls.mjs                            # 7 反例全 PASS，exit 0
node p3-consumer.mjs golden-frames.jsonl                 # 分类机械：5 receipts / 2 CLOSED / 3 OPEN
node p3-persistence-proof.mjs clean                      # 清理本包创建的全部库
```

| 文件 | 内容 |
|---|---|
| `p3-lib.mjs` | 完整冻结 001 DDL 原文建表＋船长公式＋事件 payload 构造＋sink |
| `p3-consumer.mjs` | 参考消费器（分类机械；内存） |
| `p3-persistence-proof.mjs` | `keep`／`phase1`／`restart`／`clean` 四入口；真实 SQLite |
| `p3-restart-proof.mjs` | **新进程**恢复证明＋payload 形状断言 |
| `p3-negative-controls.mjs` | 7 个反例（含无前视 NC-5、FK NC-7） |
| `golden-frames.jsonl` | 15 帧序列（含同工具两次调用、陈旧 runId/hostNonce、result 前断流） |
| `p3-merging-counterexample.txt` | 三公式同流对比 |
| `p3-secret-scan.txt` | `argumentsJson`/result 内容 0 命中扫描＋源码级确认 |
| `p3-proposal.diff`、`worker-host.proposed.mjs` | **历史提案件**（§A.8 已标历史，不重生成） |
| `SHA256SUMS.txt` | 上述文件哈希 |

实测输出（随附件）：

- persistence `keep`：`receipts=3 closed=2 open=1 unattributedMarks=2`；同工具 `rows=2 distinctCallIds=2`；重复帧 `rows 3 -> 3 (idempotent: true)`；`refused frames: 1 (stale hostNonce)`。
- restart（新进程）：`receipts=3 closed=2 open=1`、`open provable_readonly=0 calls: 1`、payload 形状 `OK`／`OK` → `PASS`。
- negative controls：`NC-1..NC-7` 全 `PASS`，`ALL NEGATIVE CONTROLS BEHAVE AS REQUIRED`，exit 0。
- consumer：`receipts=5 closed=2 open=3`、`rejectedStaleFrames=4`、`VERDICT NOT proven_safe`。

## C.4 边界

- 本追加只对齐**参考实现与证据包**，未实施生产接线、未改生产 Runtime/DDL/守卫/测试，未跑完整门禁。
- 原主要项结论（R-1～R-4 四项 MAJOR 已闭）保留；资料补件只签其实际范围（机械/持久化/规则可证伪性）。
- **M-5 未关闭**：P-3 生产落地、独审与最终门禁完成前不存在业务通过；O 项资料不得提前写成已过。
- `proven_safe` 的最终判据由独立完整证据给出；本包只证明「零记录/全闭合**不足以**推出 safe」，不提供 safe 的正证。
