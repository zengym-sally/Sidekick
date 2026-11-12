# Web 文本接入 · 可信 test 端到端只读取证（2026-11-09，ZCode）

派工：MAYNE-24 触发评论 `01a1be33`（Codex）。任务：锁定生产候选 `c4a9c67` 与已登记 Runtime 字节，沿真实 HTTP test 入口 → 服务端 snapshot/kind/MCP 派生 → 默认 WorkerHost 启动请求 → Runtime 空工具／拒 MCP／惰性 bash 派生做只读取证，区分失败安全证明与退出完整证明；只写取证文档、build 脚本与原始证据，不改生产／测试／Runtime／DDL，不跑完整门禁。**结论先行：可信 test 链的输入侧派生与失败安全已沿真实链核清；路径特异的“无派生面”成立；通用进程树退出完整性仍未证（与 23eb1a1 裁决一致，不因本轮改变）。**

## 1. 身份锁定

- 生产候选：`c4a9c6705175ff0749904a3bbbdc96efc9b67252`，tree `9545029de58d97dd8604d7b191b9cdaa62205e5c`，与派工锁定一致；相对 `dd92757` 恰三个生产文件 `http-server.mjs` +8/−6、`task-service.mjs` +34/−18、`text-intake-service.mjs` +79/−12（合计 +121/−36），其余为文档与测试登记，与裁定一致。
- Runtime 字节：`23eb1a1`（tree `cb976998…`，blob `9414f23f…` 为 `runtime/entries/organizer-entry.mjs`）与 `c4a9c67` 的 `runtime/` 目录 **逐字节相同**（`git diff --stat 23eb1a1 c4a9c67 -- runtime/` 为空）——已登记的 Runtime 锚点（r1/r2/r3 各轮）对本候选直接适用。`src-tauri/`、`vendor/pi`、`shared/` 在 `5926cbc..c4a9c67` 之间同样无变化。
- 运行时构件：runtime bundle 由候选树自身 `npm run probe:bundle` 离线重建（vendor/pi 来源校验通过：HEAD:vendor/pi = `e89822b0…`，与 `tests/probes/pi-source.json` 登记 ad702637/e89822b0 一致）；bundle 内已核锚点结构逐字在位：`useTools = … && request2.kind !== "test" && …`、`const tools = !useTools ? [] : [createSkillRead…`、`…includes(request2.kind) || !request2.mcp?.servers?.length)) throw new Error("RUNTIME_PROTOCOL")`。storage 二进制沿用既往登记字节（sha256 `42af54b5…490fc2`，`build/web-backend/bin/web-backend-storage`）。
- 运行组合（如实登记）：服务端 = 候选树 `server/entries/web-backend-entry.mjs` 源字节直接以 `startWebBackend` 启动（该入口声明的程序化测试面；`git status` 干净，HEAD 即 c4a9c67）；Runtime = 候选树重建的 `build/s0-runtime` 真实 bundle（默认真实 Pi，非替身 worker）；存储 = 已登记 release 二进制。

## 2. 静态沿链（全部为 c4a9c67 / 已登记 blob 字节）

1. **HTTP 入口**：`POST /api/tasks`（`http-server.mjs:139` → `tasksCreate:688`，requireWrite：session+CSRF+Origin/Host）。`snapshotForTest`（`:676-686`）：type='test' 且客户端已带 `input.snapshot` 时**原样采用**（`:678`）；否则 `buildModelSnapshot`（`configStore.resolveModel` 默认模型，`model-snapshot.mjs:17-39`，skills=null）；解析抛错则回退无 snapshot。
2. **submit 白名单**：`task-service.mjs:15` `TASK_TYPES=['extract','revise','test']`、`:16` `TASK_ROLES=['organizer']`、`:315-317` 校验；`operationId` 幂等。tasks 表的 type/inputRef 只有这一个写入方（唯一 `INSERT INTO tasks` 在 `:336`）；`retry` 复用原行（type/inputRef 不变）。
3. **调度**：`task-scheduler.mjs:93-149` `launch`——无 snapshot → `auth_or_config_invalid` 落库 + confirmExit，**不 spawn**（`:95-107`）；凭据解析失败 → `credential_unavailable`，**不 spawn**（`:110-123`）；否则 `workerHost.start`（`:127`）。`WorkerHost` 全树唯一构造点 `web-backend-entry.mjs:72`、唯一 `start` 调用点 `task-scheduler.mjs:127`；服务端另一 spawn 仅 `storage-client.mjs:34`（存储子进程，非 worker）。
4. **启动请求构造**：`worker-host.mjs:227-252`——`kind = task.type`（`:231`，来自 submit 白名单）；请求对象为 `{runId, hostNonce(48hex), kind, snapshot, anchorAtMs, timeZone, apiKey, cwd=root, runLimitMs, source}`；**没有任何 `mcp` 字段、没有 `tools` 字段、没有 `verification*` 字段**（服务端全树 0 处 `verification*`/`SIDEKICK_S36` 引用）；env 恰 `{PATH, TMPDIR}`（`:280-283`）；`detached` 组长（`:285`）；apiKey 只写 stdin（`:421`）。extract 之外的 `source.rawText=''`（`:246-248`），test 请求不携带用户文本。
5. **Runtime 输入门（已登记锚点，本轮 blob 复核）**：`organizer-entry.mjs:63`（runId 正则 + kind 白名单 {extract,revise,test,trial,today} + snapshot.provider/model + 非空 apiKey，否则 RUNTIME_PROTOCOL）；`:114` `useTools` 含 `request.kind!=='test'` 合取；`:115` 空工具集（skill-read 与 bash 工具对象都不构造）；`:116-117` `request.mcp?.servers?.length` 对 kind='test' 一律 RUNTIME_PROTOCOL（fail-closed）；`:109` managedBash 构造但惰性（`managed-bash.mjs:12-14` 仅闭包，detached spawn 在 `operations.exec` 内 `:20`）；bash.operations 唯一消费方是 `:115` 的 bash 工具——test 不构造 ⇒ exec 不可达；`:131` test 的模型上下文为常量 `{task:'connection test'}`；`organizer-contract.mjs:29` test 结果契约恰为 `{ok:true}`。g1 传输需控制环境变量 + argv 旗标 + 请求字段三重同时在位（`:64-74`），本链全缺。`skillSnapshot` 存在即设 `proofPath`（`:114`）——见 §5 RS-4。

## 3. 动态正反控（两轮完整运行，run A `03:10-03:11Z` / run B `03:16-03:17Z`，结论一致）

环境：合成根、内存 `ControlledCredentialProvider`（生产本切片唯一 provider，注入合成引用 `controlled:e2e`）、loopback 受控模型服务（OpenAI SSE 形状，固定返回 `{"ok":true}`，逐请求审计日志）、默认真实 Pi bundle。无假 worker、无 proven_safe 伪造、无新增接口。

| 场景 | 结果 | 关键数字（run B） |
|---|---|---|
| S1 正控：真实 HTTP 全链 | `succeeded`，结果载荷恰 `{"ok":true}` | 模型请求恰 1（Bearer 与合成密钥匹配，bodyModel=synthetic-test，lastUserContent 恒 `{"task":"connection test"}`）；`side_effect_receipts`=0；attempt `exit_reason=confirmed`；worker.json `pgid==pid, children=[]`；ps 全程仅 organizer 一进程，**无 `--nonce` bash worker、无 mcp-guardian**；worker argv/env 均不含密钥值（env 恰 PATH+TMPDIR）；queued→running→succeeded ≈650ms |
| S2 反控：未配置模型 | `failed`，**0 spawn**（runs 目录空） | `auth_or_config_invalid`，public code=`model_request_failed`+internalCode——与已登记 E1/R8-M-3 信封偏差一致（非新发现，登记为 c4a9c67 上的一致性确认） |
| S3 反控：凭据引用未注册 | `failed`，**0 spawn**，模型 0 请求 | `credential_unavailable`，同上信封一致 |
| S4 客户端自带 snapshot | 带 `provider.auth.apiKeyRef` 时 `succeeded`，模型服务收到 bodyModel=**client-specified-model** | 客户端派生面真实存在（见 RS-1）；run A 变体（无 auth）→ 服务端不给凭据 → Runtime `:63` fail-closed（动态实证该门在真实链上工作） |
| S5 客户端发送 mcp 配置 | `succeeded` 正常完成 | 服务端**结构性丢弃** input.mcp；全程 0 guardian/bash 进程、receipts=0、1 次模型请求（见 RS-2） |
| S7 扫描灵敏度反控 | 阳性 | 用已登记 blob 字节（hash-object 复核 `8efb358d`/`b2212ef6`）真实 exec 一个 bash worker：扫描器生命周期内 13 次捕获 `--run <marker> --nonce` 形状 ⇒ S1/S5 的零观测有灵敏度支撑 |

**receipts=0 的强语义**：worker-host 把 `worker` 帧（bash worker 启动）、`mcp` 帧、`progress{phase:'tool'}` 一一映射为 receipt 事实（`receiptFactsFor`，`:124-167`），有序持久化且先于 done settle（`:347-351/:378`）——故 receipts=0 ⇒ 该 attempt 全程未出现任何工具/MCP/bash 帧，不依赖 ps 采样间隔。S1/S5 双树（run A/run B）一致。

## 4. 失败安全证明 vs 退出完整证明（派工要求的区分）

- **已证（失败安全 / 输入侧派生，路径特异）**：对 kind='test'，本链在四个独立层面 fail-closed——服务端（无 snapshot/凭据不 spawn，S2/S3 实证）、Runtime 输入门（`:63`，S4-runA 实证）、Runtime MCP 门（`:116-117`，且服务端结构性不发 mcp，S5 实证双保险）、结果契约（`{"ok":true}` 唯一接受形状）。运行期无任何派生面：bash exec 不可达（无工具对象）、guardian 链不可达（无 mcp）、g1 不可达（三重控制全缺）、模型通道为纯 HTTP fetch；请求不含用户文本，密钥仅走 stdin（argv/env 实测无密钥）。
- **路径特异退出论证（新增，弱于通用完整性但强于泛化 unknown）**：运行时全部 7 处 spawn 位点（managed-bash:20、managed-mcp:27、bash-worker:7/20、mcp-guardian:39/48/65）都位于上述三门之后；test 路径三门全闭 + 动态零帧（receipts=0）+ 退出时 children=[] + 组长即单进程 ⇒ **本路径上“退出即组灭”与既有 verifyTree 语义在事实上重合**，派发方 23eb1a1 裁决的 E1「between-scans 派生 unmarked detached 后代」反例形状在本路径**没有派生面**（E1 的父进程正是 bash worker，本路径不产生它）。
- **仍未证（登记不变）**：通用（任意 kind、任意面、对抗性）进程树退出完整性未证——verifyTree 仍只覆盖「组 + 退出时直录子进程 + argv 补充信号」，恢复扫描仍只查 organizer pid；本轮不改变也不代签该义务。proposal §7 的通用 unknown 执行落点不变；本证只供 N-1 修订把「可信 test 行」的证据类别填实（已有结构事实 → 服务端沿链保证已核 + 可达面动态核实；完整退出义务 → 路径特异论证 + 通用未证）。

## 5. 可达面与派生面登记（I 相关的精确差异）

- **RS-1（客户端 snapshot 面）**：`http-server.mjs:678` 对 `body.input.snapshot` 原样采用，无服务端 schema 校验；客户端可指定 provider.baseUrl/model（S4 实证到达真实 Pi HTTP 客户端），并可携带 `provider.auth.apiKeyRef` 让服务端解析凭据注入。无 auth 时服务端不给凭据 → Runtime fail-closed（`:63`）。前端为本机同信任域，风险低，但这是**客户端派生**而非服务端派生：与 `:673-675` 注释「client 只送 modelId」的意图不符，建议 I 收口（收紧为服务端派生或补服务端校验）——属接线差异，不阻塞本证。
- **RS-2（mcp 结构性丢弃）**：`worker-host.mjs` 请求构造无 mcp 字段、服务端全树无 request.mcp 写者 ⇒ 客户端 input.mcp 永不抵达 Runtime（S5 实证）；Runtime `:116-117` 门对本链是不可达的第二道保险，对 app 侧 trial/extract/revise 直连另有意义。
- **RS-3（verification/g1 面）**：服务端 0 处 `verification*`/`SIDEKICK_S36` 引用 ⇒ g1 传输在本链不可达（`:64-74` 三重门缺二）。
- **RS-4（skills-proof 写入面）**：`:114` `if(skillSnapshot){proofPath=join(request.cwd,'skills-proof.json')}` —— 服务端派生 snapshot skills=null（S1/S4/S5 根目录均无该文件）；但客户端自带 snapshot 且带 skills 时，即使 test（useTools=false）也会在退出时写一个 `skills-proof.json`（内容为空数组 proof）。文件写面、非进程面；登记为 RS-1 的子项，建议并入同一收口。
- **信封一致性**：S2/S3 的 public envelope 形状 = 已登记 E1（R8-M-3）偏差原样存在于 c4a9c67，属已知欠账，本轮不新增也不关闭。

## 6. 边界与证据

- 本提交 docs-only（1 个评审文件）；harness 脚本与原始证据在 `build/trusted-test-e2e/`（r1 主证据 + r1-runA 复跑 + SHA256SUMS 清单，gitignored，关键数字已录本文）：受控模型服务审计日志、各场景 evidence JSON、四份 SQLite 只读副本、S7 反控记录。运行时间窗 run A 2026-11-09T03:10–03:11Z、run B 03:16–03:17Z。
- 候选隔离树 `/tmp/tte2e-r1/wt`（detach 于 c4a9c67）全程零改动，运行后 `git status` 干净；无遗留进程（organizer/bash-worker/guardian/storage 均无 strays）；合成密钥仅合成值，无真实模型／凭据／用户根接触。
- 未跑完整门禁（派工禁止）；本文档改动触发 `npm run check:docs`（随提交执行）。`check:structure` 不涉及（无代码改动）。

## 附录 A：r2 补件复跑（2026-11-09，按派工 `01a1be6b`；原件回收披露＋两轮新证据＋口径更正＋范围声明）

### A.1 原件回收披露（不沿旧值签发）

r1 的 `build/trusted-test-e2e/`（原始证据）与候选隔离树 `/tmp/tte2e-r1/wt`（含预编译构件）已被平台回收，**不可恢复**。幸存并于本轮复用的只有 `/tmp/tte2e-r1/scripts/` 下 4 个 harness 脚本与 2 个已登记 blob 副本（代码，非证据；blob 副本经 sha256 与对象库字节逐一复核相等）。本附录全部数字来自 **r2 两轮新跑**（新时间戳、新哈希），不沿用 §3 的 r1 旧值；§3 保留为历史登记，以本附录为准。

### A.2 r2 身份重验（全部 exit 0，对象库/复算核验）

- 候选：`git worktree add --detach /tmp/tte2e-r2/wt c4a9c67`，tree `9545029de58d97dd8604d7b191b9cdaa62205e5c` 与锁定一致；运行前后 `git status` 干净（tracked 零改动）。
- storage 二进制：`npm run build:backend` 内 `cargo build --release --bin web-backend-storage` 重建，2649408 B、sha256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`，与既往登记**逐字节相同**（src-tauri/target 与 build/web-backend/bin 双路径同值）。
- runtime bundle：`npm run probe:prepare-pi`（vendor/pi npm ci＋hydrate＋build:offline，输出 provenance ad702637/e89822b0）＋`npm run probe:bundle` 重建；`build/s0-runtime/source.json` commit/tree 同值、node v24.20.0。已核锚点在**构建产物** organizer.mjs 中逐字在位（esbuild 双引号规范形）：`:64875` kind 白名单＋provider/model＋apiKey 门、`:64948` `useTools` 含 `kind !== "test"`、`:64953` `tools = !useTools ? [] : […`、`RUNTIME_PROTOCOL` ×24。
- `git diff 23eb1a1 c4a9c67 -- runtime/` 为空（本轮复验，字节相同）；`node_modules/@larksuite/cli` lark-cli v1.0.98（prepare-cli 重装）。

### A.3 r2 两轮动态实测（run A 自 `2026-11-09T04:09:07Z`、run B 自 `04:11:00Z`，结论逐项一致）

环境同 §3（合成根、内存 ControlledCredentialProvider、loopback 受控模型服务逐请求审计、默认真实 Pi bundle；无假 worker、无 proven_safe 伪造、无新增接口）。harness：4 脚本（仅 Node 内置模块）路径参数化（`TTE2E_WT/TTE2E_EV/TTE2E_ROOTS/TTE2E_REPO`），场景逻辑与 r1 等价；新增 **S4b**（客户端 snapshot 无 auth——即 r1 run-A 变体的显式场景化重登记；r1 变体的原始执行载体已随回收不可考，本轮以独立场景重新落地、数值全部新测）。

| 场景 | run A | run B |
|---|---|---|
| S1 正控全链 | `succeeded`；载荷恰 `{"ok":true}`（11 B）；模型请求恰 1（Bearer=合成密钥，bodyModel=synthetic-test）；receipts=0；exit `confirmed`；worker.json `pid==pgid, children=[]`；ps 全程仅 organizer（无 `--nonce` bash、无 guardian）；argv 仅 `node …/organizer.mjs --run run_…`；env 恰 PATH+TMPDIR；argv/env 无密钥值 | 同左（run_5d66…，pid==pgid==34361，children=[]，模型请求 1，receipts=0，env 2 项） |
| S2 无配置 | `failed`，0 spawn，`auth_or_config_invalid`（public code=`model_request_failed`，E1/R8-M-3 既有信封形状） | 同左 |
| S3 凭据未注册 | `failed`，0 spawn，0 模型请求，`credential_unavailable` | 同左 |
| S4 客户端 snapshot＋auth 引用 | `succeeded`；模型服务收到 bodyModel=**client-specified-model**；receipts=0 | 同左 |
| S4b 客户端 snapshot 无 auth（新登记） | spawn 恰 1 → Runtime `:63` fail-closed：task `failed`，信封 `{code:model_request_failed, internalCode:RUNTIME_PROTOCOL, retryable:manual, sideEffectSafety:unknown}`；0 次有效鉴权模型请求；exit `confirmed` | 同左 |
| S5 客户端发送 mcp | `succeeded` 正常完成；全程 0 guardian/bash 进程；receipts=0；模型请求 1 | 同左 |
| S7 扫描灵敏度反控（两轮各一） | 阳性：已登记 blob 字段（hash-object 复核 `8efb358d`/`b2212ef6`）真实 exec bash worker，扫描器生命周期内捕获 12 次 | 同左（12 次） |

### A.4 口径更正（按 `01a1be6b`）

固定 kind 的**无工具门**（kind='test' ⇒ useTools=false、空工具集、MCP 拒绝、bash 惰性不可达）与本证中已沿真实链核清的部分，**不等于**「所有 snapshot 均服务端可信派生」已证：服务端可信派生只对未携带 `input.snapshot` 的提交成立（`buildModelSnapshot`，skills=null）；客户端携带 `input.snapshot` 时按 RS-1 **原样生效**（S4 实证 client 指定 model 到达真实 Pi HTTP 客户端；S4b 实证无 auth 时凭据不注入且 Runtime `:63` fail-closed）。两者必须分开登记，后者仍以 RS-1/RS-4 的收口为准（Kimi 已另派）。

### A.5 范围声明（三面分别给出）

- **结构事实（已证范围）**：§2 静态沿链＋已登记 Runtime 锚＋本轮构建产物锚复核——仅覆盖 c4a9c67／blob `9414f23f`/`8efb358d`/`b2212ef6` 字节及其离线重建 bundle 的输入侧处理；不构成可达性证明。
- **路径完整性（路径特异，已证范围）**：kind='test' 且沿本链（服务端 submit→launch→worker-host 请求构造→默认 bundle）时，四层 fail-closed＋receipts=0＋退出 children=[] ⇒ 本路径「退出即组灭」与 verifyTree 语义重合；**通用（任意 kind/面/对抗性）进程树退出完整性仍未证**，23eb1a1 裁决与通用 unknown 落点不变。
- **配置输入可信性（未证，登记不变）**：「所有 snapshot 均服务端可信派生」**不成立**——RS-1（客户端 snapshot 原样生效）、RS-4（客户端 skills → skills-proof.json 写面）仍开放；已证下界仅是：无有效凭据引用时无有效模型请求（S2/S3/S4b），及客户端 mcp 字段结构性不可达（RS-2）。本轮新证据不升级也不关闭 RS-1。

### A.6 命令、哈希与附件映射

- 预备链（全部 exit 0）：`git worktree add --detach /tmp/tte2e-r2/wt c4a9c67` → `npm ci --ignore-scripts` → `npm run probe:prepare-cli` → `npm run probe:prepare-pi` → `npm run probe:bundle` → `npm run build:backend`。
- 取证命令：`TTE2E_EV=…/ev-runA node scripts/run-forensics.mjs`（S1–S5＋S4b）→ `node scripts/scan-counter-control.mjs`（S7）→ 同法 ev-runB。两轮 stderr 0 字节；运行后隔离树 tracked 零改动、无遗留进程。
- 原始证据包：`tte2e-r2-evidence-pack.tar.gz`（133546 B，sha256 `f5e73414b9a2a4b04a13298047c29ce72d5115d3aa14d9187e13a072e0f89bd3`）＝harness 6 文件＋ev-runA/ev-runB 全部原始输出（forensics-summary、逐场景 evidence JSON、模型服务审计 JSONL、S7 记录、stdout/stderr、sqlite 只读副本）＋`input-identity.txt`＋`SHA256SUMS-r2.txt`（46 项，逐项复算 OK）。本包随交付评论单次挂载；本地另存 gitignored `build/trusted-test-e2e/`。平台再回收时，本附录＋包内哈希清单为恢复依据。
- 脱敏声明：证据内唯一密钥形状值为合成 fixture `sk-synthetic-tte2e-…`（本证自造、仅指向 loopback 受控服务）；无真实凭据／cookie／token／用户根内容；sqlite 副本均为合成根任务库。

### A.7 边界

本节为 docs-only 附录追加；未改生产／测试／Runtime／DDL；未跑完整门禁；未接触真实模型／凭据／用户根。MAYNE-24 保持 in_progress。
