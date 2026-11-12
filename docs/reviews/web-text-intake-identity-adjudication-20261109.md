# MAYNE-24 身份核实只读技术裁定（2026-11-09，OpenCode）

## 1. 范围与基点

- **派发**：协调评论 `01a1bd4d-a837-7efb-b3ce-bcadc65eceff`（2026-11-08，Codex 协调 run）——OpenCode 未写生产，做身份核实的只读技术裁定：以 `5926cbc`／现有 Runtime 帧为源，验证存活期轮询、现有 worker／MCP 身份帧分别能证明什么，尤其能否排除短命父进程在两次扫描之间派生无标记 detached 后代；给出原 I 范围内可证完整的最小接线方案，或不可证时保持 unknown 的精确边界与确需 Runtime 变更的最小权限差异；用可携带反例／正控支撑。**不实施、不改 Runtime／DDL／守卫、不跑完整门禁。**
- **裁定源**：候选 I 第七轮 `5926cbc81422f550bdd9db253e794ca1e0b6f1b6`（tree `2c7bfae696bb1745c64906ee2d6a448381fc561b`，父 `d79b1f6`），本工作树对象库实测与队长登记一致。
- **方法**：生产代码锚定（逐 blob 引行号）＋ 端到端进程探针——探针**直接 import 5926cbc 的 `worker-host.mjs` 原字节**（`git show` 导出，`git hash-object` 复算 = 候选 blob `cfdd335468d52673d1c65cb8123f5d1bf90ba78f`，内容 SHA-256 `817591ec…5ae81`），零转录。探针只用 node:child_process ＋ `/bin/ps`（生产同款机制），离线、合成拓扑，macOS arm64。
- **本记录性质**：技术裁定，不是准出；不签任何候选通过。与 ZCode R7-M-2/-M-3 实测、Claude 批次自述交叉印证，供队长统一身份方案准出口径。

## 2. 事实清单（全部锚定 5926cbc 行号＋探针实测）

| # | 事实 | 锚点 | 证据 |
|---|---|---|---|
| F-1 | **退出时快照结构性为空**：`record.children` 只写两次——spawn 时 `children: []`（worker-host:285），退出事件后 `const children = childPids(record.pid)`（:337）。worker 已死、存活直接子进程已被内核重挂，`ps` 的 ppid 关系恒空 | worker-host.snapshot:337 | P0 CONFIRMED：存活期扫描能看到 child，`record.children=[]` 且 child 实测存活 |
| F-2 | **5926cbc 不存在任何存活期轮询**：`childPids` 全文仅 finish 一处调用；server/lib 其余文件无 `/bin/ps`／轮询 | worker-host.snapshot 全文 | 代码枚举 |
| F-3 | **verifyTree 的健全域只有进程组**：组 ESRCH（:72）＋children 全死＋`--run <runId>` argv 全表字符串扫描（:88）。而 bash worker（managed-bash:20 `detached:true`）与 MCP guardian（managed-mcp:27 `detached:true`）**按设计是独立进程组组长**——天然在组外；argv-clean 的后代对 `--run` 扫描恒盲 | worker-host.snapshot:72/:88；managed-bash:20；managed-mcp:27 | P1 CONFIRMED（组内 leaf：verifyTree=false 诚实阻断，组杀后 true 且 leaf 真死——组内行为健全）；E1（detached leaf：true 而叶存活——组外不可见） |
| F-4 | **帧身份证据清单**：`{type:'worker',action:'start'/'end',pid,nonce}`（organizer-entry:109，managedBash 只报自己 Map 里的直接派生）；`{type:'mcp',action:'owner',guardian,keeper,nonce,run,serverId}`（managed-mcp:58→mcp-control request body）；`call_begin`/`call_response`（归属，无 pid）；`progress`/`result`/`error`（无 pid）。**MCP service pid（guardian 之子）与 cleaner pid 不在任何帧里**；`emit` 在 stdout destroyed 时静默跳过（organizer-entry:37）→ 帧缺席≠未派生 | organizer-entry:37/:109；managed-mcp:27/:58；mcp-control 全文 | 代码枚举；R7 已实测帧词汇一致 |
| F-5 | **mcp_ack 回路缺失**：5926cbc 的 server/lib 全部文件 0 处 `mcp_ack` 写入 → runtime `control.request` 的 ack 等待超时（MCP_PROTOCOL）→ 配置了 MCP server 时连接无法完成。owner 帧（guardian/keeper pid）字节确实到达 host stdout 解析器，但其身份证据的**端到端可用性以 ack 回路闭合为前提**（属 R7 已记录缺口，ZCode 面） | server/lib 全文件 grep=0 命中 | 代码枚举；R7-C 探针 stderr 实录一致 |
| F-6 | **重启恢复核实更弱**：`recover()` 仅 `processIsAlive(record.pid ?? attempt.workerPid)`（task-recovery:86）——不查组、不查 children、不查 argv；organizer 死而后代活→按已退出分类；cancelling 任务重启即 `confirmExit({exited:true,cancel:true})` 完成取消（:125 附近） | task-recovery:86 | 代码枚举 |
| F-7 | **E1 端到端反例**：生产 WorkerHost 起真实进程树——短命父进程（worker-start 帧已上报 host）派生 argv-clean detached 叶并在同一事件循环 tick 内退出。50ms 存活期轮询（模型）0 捕获、`record.children=[]`、组 ESRCH 通过、`--run` 扫描无命中、注册集全灭 → 生产 `verifyTree=true`、`confirmExit` 释放（`exited:true,treeVerified:true`），随后 `stopAll()` 后叶**实测仍存活**（双次复查） | E1 run.log | E1 CONFIRMED |
| F-8 | **存活期登记的正控收益真实**：P2 中轮询在父进程 300ms 存活窗内观察到 [父→detached 叶] 对并注册，退出后注册集检出叶存活、proof-matched 组杀收尾成功——登记把 E1 的不可见逃逸变成**可检出、可清扫**的幸存者（仅限被观察过的成员） | P2 run.log | P2 CONFIRMED |
| F-9 | **proof-gated 清扫的安全正控**：guardian `proof()` 语义（pgid＋非僵尸＋argv 标记子串）对无标记 pid 拒绝击杀——pid 复用场景不误伤 | lib.mjs identityProof；mcp-guardian:proof | P3 CONFIRMED |
| F-10 | 附带现场观察（非本候选声明）：mayne-22/mayne-23 两个工作树 build 目录各有一个 20h＋ 前遗留的 `s0-runtime mcp-guardian --mode cleaner` 进程——逃逸进程类的真实实例，与 F-3 的组外盲区一致 | 本机 ps | 记录在案，不展开 |

## 3. 裁定

**R-1（主裁定）：原 I 范围内不存在可证完整的接线方案。** 内核不为无特权查询保存进程祖先史；一切 host 侧证据（帧＝事件驱动、只覆盖 organizer 自报的派生；轮询＝时刻采样）都是有限观察集，「派生→脱离组→祖先全灭」整个序列落在观察集之外即永久不可见。轮询频率只能缩小窗口（窗口≈观察间隔），不能闭合。**对派发问题的直接回答：不能排除短命父进程在两次扫描之间派生无标记 detached 后代——E1 在生产代码上端到端复现。**

**R-2（unknown 的精确边界）。** 在现有帧＋合理接线下，可证与不可证分界如下：

- **可证**：(a) worker 自身退出（exit 事件＋pid 三态探测）；(b) 进程组灭绝（`kill(-pgid,0)`→ESRCH，健全域=组内，P1）；(c) **注册集内**每个成员死／活的逐个证明（帧来源：worker start/end、mcp owner；轮询来源：递归 ppid 闭包；动作须 proof-matched，P3）；(d) argv 带标记进程的**存在**（`--run` 扫描是存在性检测器，缺席是弱信号）。
- **不可证**：argv-clean detached 后代的**缺席**。因此当前 `verifyTree=true` 的真实语义是「组内灭绝＋注册集（空）全灭＋argv 扫描无命中」，**不是**「树完整灭绝」；由空快照推导 true 并据此发布候选／释放槽（E1 实测发生）是不健全的。未知残余=「观察间隔内完成全部派生链死亡的后代」。

**R-3（Runtime 变更的最小权限差异）。** 若授权改 Runtime：为 organizer 侧每次直接派生**同步前置**一个登记帧（扩展现有 `worker` 帧族；guardian/keeper 已由 `owner` 帧上报）可把直接派生的登记从「轮询采样」升级为「事件驱动」，消除**直接派生**的 between-scans 竞态。但孙代（bash 脚本内部派生、guardian 派生的 MCP service、任何 setsid/双 fork 逃逸）对 runtime 自身也不可见——**帧化之后完整性仍不可证**。真正的完整性证明只有两类来源，均为超出 I 范围的权限／基建跃迁、需 owner 单独授权：(a) OS 级事件源——Linux netlink proc connector（无特权但有损，不完整）、auditd/eBPF（特权）、macOS EndpointSecurity framework（需专用 entitlement＋用户批准）、kqueue NOTE_TRACK（无特权但丢事件）；(b) 隔离构造——attempt 级沙箱/容器，使「逃逸后代」按构造不存在。**结论：不存在「加一帧就完整」的最小 Runtime 差异；帧化只买窗口缩小，不买完整性。**

**R-4（对队长既有指示的验证）。** 「逃逸后代须存活期登记，缺完整性证据保持 unknown」经本裁定**成立**：存活期登记是 I 范围内唯一能缩小盲区的机制且正控收益真实（P2/P3）；但登记集全灭不得推导树全灭（E1），登记后的诚实语义仍是 unknown-when-remainder-unobserved。Claude 批次自述「退出时直接子进程快照结构性为空（孤儿已重挂）→ treeVerified=true、记录删除、槽释放」与 F-1/E1 逐点一致；其「--run 标记仅补充」的表述按实测是「argv 存在性检测器」，对 argv-clean 后代恒盲。

**R-5（最小健全接线建议——未实施，供 I 后继增量与队长裁定）。** 全部在 server/lib 内，**无 DDL 变更**（注册集落 `runs/<runId>/worker.json`——host 私有 0600 文件，`children` 字段可承载注册数组；SQLite 不动）：

1. **帧注册**：host 消费已到达的 `worker start/end`（bash pid+nonce）与 `mcp owner`（guardian/keeper pid+nonce+serverId）帧建立注册集——帧字节今天已在流动，零 Runtime 变更；owner 帧的消费以 ack 回路闭合为前提（F-5，属既录缺口）。
2. **存活期登记**：递归 ppid 闭包（生产同款 `/bin/ps` 机制）挂接在 cancel／deadline／stopAll 发起点、退出处理点，可选帧到达点；注册项带 `[pid, pgid, argv-proof, 观察时刻]`。
3. **verifyTree 语义收窄**：true 仅当「组 ESRCH ∧ 注册集逐成员 proof-matched 确认全灭 ∧ argv 扫描无命中」，且该 true 的**命名与用途**改为「注册集＋组已核实灭绝」——是否据此释放槽位是契约层选择（冻结 §202/§217 已有 `exited_unknown` 占槽＋恢复重核实机制可承接 unknown 路径）；不得把 true 当树完整性证明无条件发布。
4. **注册幸存者 proof-matched 清扫**（P3 语义），stopAll 补逐 pid 收尾，修 M-3 的已登记部分。
5. **恢复扫描同步收紧**：`recover()` 至少加组 ESRCH＋注册集检查，避免重启面把「organizer 死＋后代活」分类为已退出（F-6 的 cancelling 重启即 cancel-complete 盲区）。

## 4. 证据与复跑

- 证据目录：`build/web-text-intake-identity-adjudication/r1/`（gitignored）——`admission.json`、`worker-host.snapshot.mjs`（5926cbc 原字节，blob id 复算一致）、`fake-runtime/organizer.mjs`（合成拓扑 stand-in，拓扑按 managedBash/guardian 生产形态缩尺）、`probe-p0…p3`＋`probe-e1`、`run-all.mjs`、`run.log`、`SHA256SUMS.txt`（11 项，`shasum -a 256 -c` 全 OK）。
- 复跑：`cd build/web-text-intake-identity-adjudication/r1 && node run-all.mjs`——**5/5 CONFIRMED**（2026-11-08T22:55Z，node v24.20.0，darwin arm64，总时长约 7s，确定性时序、无网络）。
- 探针清洁：跑后无本探针残留进程（P3 首轮崩溃遗留的 1 个 `tail -f` 已手工清理）；探针自身曾因 `process.kill(-null)` 触发组杀 bug，已修复并在终版 run.log 中无残留。
- 未验证项（如实）：探针为合成拓扑，未在真实打包 bundle 上重放（E1 的结论锚定生产 blob 行为本身，不受 bundle 打包影响）；未测 5s 以下更高频率轮询的窗口量化（裁定只依赖「有限观察集」的一般论证，频率只影响窗口大小）；macOS arm64 单平台（`/bin/ps` 通道 Linux 通用，未实测）；真实模型／凭据／用户根未触碰。

## 5. 结论

限本裁定范围（身份核实的可证明性）：**维持未知边界——原 I 范围内不可证完整**；存活期登记＋proof-matched 清扫是唯一有正控收益的 I 范围内机制（P2/P3），`verifyTree=true` 必须语义收窄并由契约既有 unknown 机制承接；任何完整性闭合都需 OS 级事件源或隔离构造级别的权限跃迁（R-3），不是 Runtime 加帧所能达成。MAYNE-24 保持 in_progress，状态未改。
