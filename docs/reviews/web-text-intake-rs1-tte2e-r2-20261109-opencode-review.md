# Web 文本接入 · RS-1 单文件增量独审 + 可信 test r2 动态补件续核（2026-11-09，OpenCode）

- 评审者：OpenCode（未写 RS-1 生产增量、未写 r2 补件；作者分别为 Kimi／ZCode）。
- 派工：议题评论 `01a1be9f-0f9c-7994-bf0c-f649a9205292`（Codex），接本审 `01a1bec1`／`0545310` 三修独审之后续审两项，分别给结论。
- 复用既过面：`e97621b`（`b72c4b9` 取证静态面：七 spawn 点普查、请求构造无 mcp/tools/verification 字段、Runtime 门 `:63/:114/:115/:116-117/:131/:64-74`、契约 `:29`、receipts 帧映射、以及「`:678` 原样采纳整个 `body.input`，RS-1 收口必须重derive整个 input 形状」的登记）。
- 审计方式：对象库直读（`git show`／`git cat-file`／`git grep`，零网络）＋两棵隔离 detached 树上的独立动态复跑（默认真实 Pi bundle＋受控模型；无脚本化 worker 代签）。树用后即删，零残留进程。

## 1. RS-1 单文件增量 `6f12c3a`：通过（限定）

### 1.1 身份与交付读回

- `6f12c3a81a79a25261be5c02e5d0220d60b6f44d`／tree `60cf9da954ab2d41655bed675d2d35f68081c4bb`、父 `ef0f0d4e097391a8e01a8a346973f0fc9b9c45ee`——与登记逐字一致；恰 `server/lib/http-server.mjs` 一文件 +25/−8（blob `f474cc7`→`5226b39e`，文件 sha256 `2072fca27d9737356d6a1a870ea1ed46d0488ce521ae365a8d59aa97551bd46d` 复算相等）。Rust／DDL／003／package／Runtime／前端零差异。
- 交付评论 `01a1be7f` 附件 **13/13 件 CLI 实读回**，逐件大小与登记相等；`SHA256SUMS.txt` 覆盖其余 12 件 **12/12 OK**。`production-diff.diff` 附件与对象库 `git diff ef0f0d4 6f12c3a -- server/lib/http-server.mjs` **逐字节相同**。

### 1.2 静态面（核整个 test input 的服务端派生、合法 modelId、未知值语义、不执行不落库）

`snapshotForTest` 新体四条路径全部收口（旧体在 `body.input.snapshot` 存在或 `configStore` 缺失时原样放行客户端字节——即 ZCode S4/S4b 实证的缺口）：

1. **整输入服务端派生**：`type==='test'` 时一律先解构剥离客户端 `snapshot`/`skills`，再经 `buildModelSnapshot({configStore, agentId:'organizer', profile:{}, modelId: rest.modelId ?? null})` 服务端重建；成功与 `catch` 两分支都只返回 `rest`＋服务端 snapshot，`configStore` 缺失分支返回剥离后的 `rest`。派生失败（`model_not_configured` 等）统一落「无 snapshot」fail-closed 路径，不存在客户端字节旁路。
2. **合法 modelId 选择**：客户端唯一影响是按冻结 DTO 命名 `modelId`；`ConfigStore.resolveModel`（config-store `:407`）做严格同匹配（`entry.id === (modelId ?? defaultModelId)`），model/provider 任一 `enabled===false` 或无配置即 `null`→抛 `model_not_configured`；snapshot 内 `modelId` 写的是服务端解析结果 `resolved.model.id`，不是客户端字符串。
3. **未知值语义**：未知名／非字符串值／禁用模型统一走「照常入队、无 snapshot、运行时 `auth_or_config_invalid`、零模型请求」（既有 S2 形状）。本审动态确认修复前未知 modelId 被静默回退默认模型（pristine N3 `succeeded`），修复后如实失败（fixed N3 `failed`）——登记的语义变化成立且方向正确：「允许的模型选择必须真实生效，未知名不得静默换成别的模型」。
4. **客户端 snapshot/skills 不执行不落库**：剥离先于返回值；`task-service.submit` 持久化的 `input_ref` 即返回值 JSON（`:387` `{...input, canonical}`→`:402` 落库），worker-host 运行时请求（`:230` `task.inputRef`）也来自同一对象——客户端 `snapshot`/`skills` 在执行与持久化两条路径上都不可达。RS-4 随之闭合：服务端 snapshot 恒 `skills=null`，Runtime `:114` 的 `skills-proof.json` 写面对 test 链消失。
5. **消费面普查（复用 `e97621b`＋本轮复读）**：`TASK_TYPES=['extract','revise','test']`（`trial`/`today` 不可经 HTTP 达）；`kind='test'` 时 Runtime 只读 `request.snapshot`（provider/model/agent/skills，全部服务端派生）、host 解析的 `apiKey`、`runId`/`kind`，`context` 为常量 `{task:'connection test'}`、`shape` 为常量 `Return exactly {"ok":true}`（organizer-entry `:63/:88/:114/:127/:131`，契约 `:29`）；extract/revise 与 retry 快照重建路径本 diff 未触碰。

登记两点非阻断精化：① `rest` 透传意味着 test input 中 DTO 之外的任意客户端标量字段仍会原样存入 `input_ref`（本链 Runtime 消费为零，惰性载荷；intake 宽容行为沿既有面未变）——登记在案，防未来 Runtime 新增字段静默继承客户端输入；② `catch{}` 吞掉 `buildModelSnapshot` 全部异常统一落 fail-closed，属期望行为。

### 1.3 动态面（本审独立复跑，非追认作者数字）

- 隔离树：detached `6f12c3a`（fixed）与 `ef0f0d4`（pristine）；harness 用交付附件 `rs1-controls.mjs` 原字节（SHA-256 对 `SHA256SUMS.txt` 校验相等），置于 `<RUNTREE>/build/rs1-closure/`。
- 前置链全部实跑 exit 0，与既往登记逐字节相同：npm ci、probe:prepare-cli、probe:prepare-pi、probe:bundle、cargo release；storage 二进制 2649408 B `42af54b5…490fc2`、organizer `08f32db2…`（2515908 B）、node `9d050fd4…`（121911744 B）、pi provenance `ad702637`/tree `e89822b0`（bundle source.json）、lark-cli 1.0.98、node v24.20.0；bundle 锚复核（RUNTIME_PROTOCOL ×24、`request2.kind !== "test"` 门在位）。
- 链路：生产 entry→HTTP→调度→默认真实 Pi bundle→loopback 受控模型服务（rogue＋configured 双服务）；内存受控凭据 provider；数据库只读观测。**无脚本化 worker 代签。**
- 结果：fixed **23/23 两连跑**（P1 默认模型 succeeded＋恰 1 请求＋configured api model＋Authorization 头存在＋持久化 snapshot 服务端派生＋skills=null＋无 skills-proof；P2 选中第二模型 succeeded＋请求携带 `rs1-model-2-api`＋持久化 snapshot 为所选模型；N1 rogue 服务零请求＋rogue 引用从未解析＋仍按配置默认成功＋持久化 snapshot 服务端派生；N2 客户端 skills snapshot→无 skills-proof、持久化 skills=null；N3 未知 modelId→`auth_or_config_invalid`、零模型请求、无 snapshot 键、modelId 仍记录）——与作者登记逐项一致。pristine（`RS1_ENTRY` 指 `ef0f0d4`）**4/4**：rogue 服务收 1 请求、rogue 引用被解析、skills-proof.json 写出、客户端 skills 原样持久化；且 N3 静默回退默认模型 succeeded——可证伪性成立，正反控确实能检出越界输入生效。三轮 stderr 均 0 字节，零残留进程。

**结论：RS-1 `6f12c3a` 通过（限定：RS-1/RS-4 收口面；静态＋本审独立动态）。** 未跑完整门禁（III 集成轮），extract/revise/retry 快照面沿 `9b305d9`/`0545310` 既过面复用未重跑。

## 2. ZCode r2 动态补件：作为 c4a9c67 记录的证据补件接收（r1 数字继续不追认）

### 2.1 包身份与内部清单读回

- CLI 下载 `tte2e-r2-evidence-pack.tar.gz`：133546 B，SHA-256 `f5e73414b9a2a4b04a13298047c29ce72d5115d3aa14d9187e13a072e0f89bd3` 独立复算相符（与 Codex 登记一致）。
- 解包读回：`SHA256SUMS-r2.txt` **46/46 项逐项复算 OK**。内容＝harness 4 脚本（`lib/model-service/run-forensics/scan-counter-control`）＋2 个已登记 blob 副本＋`input-identity.txt`＋ev-runA/ev-runB 全部原始输出（forensics-summary、逐场景 evidence JSON＋sqlite 只读副本、模型服务审计 JSONL、S7 记录、stdout/stderr）。

### 2.2 输入身份核验

- 候选 `c4a9c67`/tree `9545029d`、`git diff 23eb1a1 c4a9c67 -- runtime/` 0 行（字节同）；storage `42af54b5`、bundle provenance `ad702637`/`e89822b0`（与既往登记逐字节同）。
- **已登记 blob 复核**：对象库 `git cat-file blob 8efb358d`→sha256 `efe0b87f…`、`b2212ef6`→`86f7c3b8…`，与 `input-identity.txt` 登记及包内副本逐一相等。
- 构建产物锚：`:63` RUNTIME_PROTOCOL 门、`useTools`（kind!=='test'）、空工具集三锚在 built organizer.mjs 逐字在位。

### 2.3 声明数字 vs 包内原始证据（两轮逐项核对，全部相符）

- S1 两轮：`succeeded`、模型请求恰 1（`bodyModel=synthetic-test`、`authMatchesToken=true`、Bearer 前缀、值不记录）、`lastUserContent` 恒 `{"task":"connection test"}`、receipts=0、exit `confirmed`、worker.json `pid==pgid, children=[]`（run B pid==pgid==34361）、argv/env 无密钥值、无 bash/guardian 进程。
- S2/S3 两轮：`failed`、0 spawn、`auth_or_config_invalid`／`credential_unavailable`（E1 既有信封形状；一致性确认非新发现）。
- S4 两轮：`succeeded`、模型服务收到 `bodyModel=client-specified-model`——RS-1 缺口实证，包如实登记、未粉饰。
- S4b 两轮（新登记）：spawn 恰 1→Runtime `:63` fail-closed（`internalCode=RUNTIME_PROTOCOL`、`sideEffectSafety=unknown`）、0 次有效鉴权模型请求、exit confirmed。
- S5 两轮：`succeeded`、0 guardian/bash、receipts=0、模型请求 1（客户端 mcp 字段结构性不可达，RS-2）。
- S7 两轮各 12/12：已登记 blob 字节真实 bash worker 被扫描器捕获 12 次（阳性灵敏度反控）。
- 两轮 stderr 均 0 字节；时间戳（run A 04:09:07Z 起、run B 04:11:00Z 起）与附录 A.3 一致。
- harness 方法论核验：`run-forensics.mjs` 经 `lib.mjs` 以候选树自己的 entry＋storage bin＋`runtimeRoot=build/s0-runtime`（默认真实 Pi bundle）启动，内存受控凭据＋loopback 受控模型——满足「默认真实 Pi＋受控模型，不用脚本化 worker 代签」。
- 附录 A（A.1–A.7）全文读回：回收披露、r2 身份、两轮实测、口径更正（A.4：固定 kind 无工具门 ≠「所有 snapshot 服务端可信派生」）、三面范围、命令/哈希/附件映射、边界——与包内原始证据逐项吻合，无一处超出或粉饰。

**结论：r2 动态补件接收为 `c4a9c67` 记录的证据补件；`e97621b` 遗留的动态面欠账（自包含 harness＋输入身份＋两轮原始证据＋哈希）至此补齐；§3 的 r1 旧数字继续不追认，以附录 A＋r2 包为准。本轮不重复重跑 r2 全套（包自含原始输出＋清单已逐项核对；RS-1 修复面已由本审 §1.3 独立动态复验）。**

### 2.4 三面分别签署

1. **路径特异退出（kind='test' 沿本链）：签署「证据登记成立」。** S1 两轮 pid==pgid、children=[]、exit confirmed、全程无 bash/guardian——该路径「退出即组灭」与 verifyTree 语义重合的路径特异论证由两轮一致原始输出支撑。receipts=0 只作为该链路的观测事实之一，**不构成安全证明**。
2. **配置可信性：缺口登记成立，收口已闭合（本审独立复验）。** 在 `c4a9c67`「所有 snapshot 均服务端可信派生」不成立（S4/S4b 实证客户端 snapshot 生效——RS-1/RS-4 真实缺口，包如实登记）；该缺口即本审 §1 的 RS-1 `6f12c3a`，静态四路径收口＋本审 23/23×2／4/4 独立复跑证明修复后 test 面全部路径 snapshot 服务端派生、客户端 snapshot/skills 不执行不落库、未知 modelId fail-closed。此签署仅覆盖 RS-1/RS-4 收口面，不升级为「全部输入全域可信」的通用证明（未批 D 边界不变）。
3. **通用完整性：仍未证，登记不变。** S7 阳性反控只证明扫描灵敏度（12/12 捕获真实 bash worker），不证明「无发现＝无进程」；通用（任意 kind/面/对抗性）进程树退出完整性维持 23eb1a1 裁决与通用 unknown 落点，r1＋`01a1bd87` 口径不变。receipts=0 不单独作为安全证明。

## 3. 边界

未跑完整 `npm run check`（III 唯一集成轮）；未重跑 r2 全套（§2.3 为包内原始证据逐项核对）；未重跑未改 Rust/前端；未 push、未改工单状态；未触真实模型／凭据／用户根（合成密钥仅指向 loopback 受控服务，配对码/token 零记录）；隔离树用后即删、零残留进程。RS-2/RS-3 维持 `b72c4b9` 已核 fail-safe 面；本审不关闭 R8-M-1/M-2/M-3 残余、MCP/M-5，不提前集成。

## 4. 证据

`build/mayne24-rs1-tte2e-review/r1/`（gitignored，平台回收后以本记录＋评论附件哈希为恢复依据）：admission.json、本审三轮运行输出（fixed-run1/2、pristine-run1，stderr 0 字节）、两模式 summary/checks JSON（`<RUNTREE>` 占位）、包哈希与清单复算记录、SHA256SUMS。
