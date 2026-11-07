# W0 Web API 契约返工后的独立复审（MAYNE-19）

## 对象、边界与结论

- 候选：`agent/opencode/mayne-17`，`7ade73760058708963edfcca1a6d577a38ec5059`；父提交 `9750467af98cd151c7855fca6f43325ef168932f`，包含已确认基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`。
- 相对产品基线：27 个文件、1164 行新增，全部位于本任务允许的契约、合成 JSON 和本任务记录路径；未改生产源码、DDL、manifest、锁文件或共享索引。
- 评审分支仍为 `agent/codex/mayne-19`，起点 `dca811894b80dca5f790673988226d7c66e0596b`。通过归档候选到忽略目录进行只读核验，没有把候选合入评审分支或 `main`。
- 影响面 R3：这是供后续实现遵循的公共契约，涉及任务执行、进程与数据恢复边界。原定评审者 OpenCode 已成为实现者，本轮由未参与实现的 Codex 收口，并使用两个全新上下文的只读 CLI 评审面。
- A 面（正确性/可行性）：**BLOCK**；B 面（安全/恢复/运维）：**BLOCK**。两面分别取得产物、原始任务范围和权威基线，没有取得作者结论或彼此结论；各自前台完成，退出码均为 0。
- 综合结论：**reject / BLOCK，退回 `started_2` 修订，不进入 done、不合入 main、不宣布冻结。** 去重后有 3 项 P1、5 项 P2；无 P0、P3。下方保留各面的结论归属，共同发现只展开一次。

## 新鲜验证与交付身份

| 检查 | 实际结果 |
|---|---|
| 候选归档中运行 `npm run check:docs` | exit 0，18 个文件、343 条本地链接通过 |
| `node build/web-contract-review-20261107/check-fixtures.mjs` | exit 0，24/24 JSON 可解析，顶层版本唯一为 `web-api/1`；10 个完整任务资源（含两个快照条目）均具备 21 个必需字段 |
| 同一检查：终态、provider、SSE、快照 | 终态取消意图与时间字段符合修订；provider 的 authMode 齐全；事件 ID 与 epoch/cursor 一致；游标 1042 的任务状态与快照均为 cancelling/v3 |
| 同一检查：恢复明细 | 两份报告各有 3 个 pending 条目，summary.needsDecision 却均为 2；任务 recovery union 均不包含对应 hold 的 cause |
| `git merge-base --is-ancestor 85feb8aaa431a2a1c9f92b238e26a7a2400baa9e 7ade73760058708963edfcca1a6d577a38ec5059` | exit 0 |
| `git diff-tree --check 9750467 7ade737` | exit 0；候选改动路径均在任务范围 |
| 新增本记录后，在评审工作树运行 `npm run check:docs` | exit 0，17 个文件、297 条本地链接通过；历史评审正文按守卫约定不计入扫描 |

原始证据保留在忽略目录 `build/web-contract-review-20261107/`：候选归档、两个隔离评审输入与输出、CLI 日志、`fixture-check.json`、`candidate-manifest.json` 和修订补丁。入库仅保留本记录，未把日志或整份归档作为交付源码。

交付评论登记的修订补丁 SHA-256 为 `7ec103370d52a7a0aa09978b9848e7e950f50507180f5a67bcf915be0c0c3da4`，按其给出的命令对实际提交重算，结果为 **`1e7cdc315ce7f24f85a24ca64836dc24dacf6ade4a8d20513797dc61bfb173e2`**：

```sh
git diff 9750467..7ade73760058708963edfcca1a6d577a38ec5059 -- docs/engineering/web-api-contract.md docs/reviews/web-contract-revision-20261107.md tests/fixtures/web-contract | shasum -a 256
```

本轮已按实际 SHA 重新取证，不能沿用原登记哈希作为这一提交的身份；后续交付须以提交完成后的完整补丁登记，包含新文件。此处更正证据，不把哈希差异另算一项代码缺陷。

## A 面：正确性与可行性 — BLOCK

### A1 · P1：成功结果没有可执行的读取协议

- 位置：`docs/engineering/web-api-contract.md:58`、`:116`、`:254`；`tests/fixtures/web-contract/task-succeeded-result.json:26`。
- 证据与不变量：任务目标要求从提交走到用户看到结果；GET 任务只返回 `result.payloadRef = result://…/payload`，契约未定义引用解析规则、读取端点或业务资源映射。场景 1 的运行任务和成功任务还使用不同 taskId，不能组成同一次提交的完整查询链。
- 影响：客户端拿到 succeeded 后，无法按本契约确定下一次请求；补一个成功 JSON 仍不足以关闭端到端验收。
- 必需修正：定义通用结果获取协议、授权及未就绪/缺失等错误行为；业务 payload 字段仍可由 W1+ 定义。补同一 taskId 的提交、完成和结果读取样例。

### A2 · P2：修正配置后 retry 仍只能使用错误的旧修订

- 位置：`docs/engineering/web-api-contract.md:55`、`:119`、`:131`；依据 `docs/product/03-智能体与架构.md:138` 的任务快照不变规则。
- 反例：任务因旧 configRevision 的错误端点失败，用户保存了正确的新修订；retry 请求仅有 expectedVersion，既不能选择新修订，也不能绕过任务固定快照。按旧修订重跑继续失败，静默读新配置又违反快照规则。
- 必需修正：明确哪些引用修复可在原修订重试；改变非秘密配置时采用关联的新任务，或定义显式重试修订及其幂等语义，补请求/响应样例。

### A3 · P2：领取先发生时，取消响应的版本规则互相冲突

- 位置：`docs/engineering/web-api-contract.md:49`、`:84`、`:91`、`:259`。
- 反例：页面已见 queued/v1，调度器先领取为 running/v2，随后取消请求仍带 expectedVersion=1。§3.3 要求 409 version_conflict，§3.2 和场景 6 却要求领取赢后返回 202 cancelling。
- 必需修正：统一版本校验与内部领取竞争的优先级；若严格校验，分别记录旧版本 409、读回新版本后取消 202，不能用同一时序签两种预期。

A 面也独立发现下方 B1/B2，证据核实一致，归于其直接负责的进程/副作用边界，不重复计数。

## B 面：安全、数据恢复与运维 — BLOCK

### B1 · P1：退出未确认的 worker 被提前释放槽位

- 位置：`docs/engineering/web-api-contract.md:74`、`:85`；违反 `docs/engineering/web-backend-design.md:96` 的未确认退出不释放槽规则。
- 反例：默认 3 个 worker，取消其中一个但无法确认退出，任务按表转 needs_review；按槽位表该状态不占槽，于是可补发第 4 个 worker。全部三个都转待核对时甚至可再启动三个。§3.4/§9 的新实例启动清理未覆盖同一运行实例的这条迁移。
- 影响：实际执行突破配置上限，旧进程仍可产生外部副作用；仅拒绝晚到结果不能阻止工具继续执行。
- 必需修正：把 attempt 的退出确认与业务核对状态分开；未确认时保留占用或阻止补发，用户 resolve 也不能绕过退出确认。区分“进程已停但副作用未知”和“进程是否已停未知”，补两类场景。

### B2 · P1：自动重试没有副作用安全守卫

- 位置：`docs/engineering/web-api-contract.md:79`、`:130`、`:135`；违反 `docs/engineering/web-backend-design.md:100` 的仅发送前/可安全重复才自动重试规则。
- 反例：Pi 已通过 Bash/MCP 发出消息，后续模型调用失败或最终输出格式错误；注册表默认归 auto_backoff，状态机仅按重试标记重入队，可能再次发送。重启扫描的安全判断不覆盖普通失败后的自动重试。
- 必需修正：失败码不能独自授予重跑；自动重入队必须由可信类型/工具台账证明副作用安全，无法证明进入 needs_review。补“工具已执行，后续模型失败/结构无效”场景及样例。

### B3 · P2：恢复报告把尚未处置的条目从待决计数中漏掉

- 位置：`tests/fixtures/web-contract/recovery-hold-report.json:19`、`tests/fixtures/web-contract/recovery-hold-root-activation.json:22`。
- 证据：前者 rci_02/03/04、后者 rci_11/12/13 均为 pending 且提供 resume/cancel，两份 needsDecision 都是 2，实际应为 3；没有任何已取消任务。cancelIntent=true 仍有待决选项，不能等同取消完成。
- 必需修正：汇总与明细一致；明确 cancelledWithIntent 的含义，区分待决取消意图与已完成取消，不用汇总提前关闭 hold。

## 收口方补充核实

### C1 · P2：任务 recovery union 仍不能表达备份恢复与已有根激活

- 位置：`docs/engineering/web-api-contract.md:60`、`:103`、`:107`、`:212`；这是前轮 P2-1 中 recovery 完整性的未关闭部分。
- 证据：§3.5 仅允许 backend_restart、restart_unknown_side_effect、cancel_unknown_side_effect，§8.3 却要求恢复/激活出的未完成任务都成为 needs_review。其 GET 任务资源必须有 recovery，但三种原因都不能如实表示 backup_restore/root_activation/import；两个新增/既有 hold 报告也不能代替该任务资源字段。
- 必需修正：为这些任务定义 recovery 变体或有类型的 hold/item 引用，并规定任务 resolve 与 hold 内逐项 resolve 的关系；补恢复后 GET 任务/快照的完整样例，覆盖 cause 与 holdId/itemId 的对应。

### C2 · P2：restore 操作缺少明确的响应丢失读回入口

- 位置：`docs/engineering/web-api-contract.md:17`、`:201`、`:203`、`:204`；`tests/fixtures/web-contract/workspace-restore-accepted-202.json:4`。
- 证据：总则承诺所有异步操作可按 operationId 读回；端点表只有 switch-operations/{operationId} 的 GET，restore 只有 POST，hold 查询又依赖客户端尚未知的 holdId。restore 202 样例本身也没有 holdId。不能要求客户端猜测 switch 查询是否接受 restore ID。
- 必需修正：明确 restore 的操作查询端点或统一操作查询映射，以及 operationId → holdId 的发现方式、未知/失败/完成状态。补“restore 已受理但 202 丢失，仅凭原 operationId 恢复查询”的样例。

## 前轮修订与未验边界

前轮代理模式备份恢复授权、SSE epoch 令牌/ready/reset、游标 1042 快照与任务全字段、provider authMode 和终态 cancelIntent 的具体问题已修正。成功终态与 root_activation 样例也已补齐。retryable=manual 的入口矛盾虽已改，配置修正语义仍受 A2 阻断；通用事件流字段已补，任务 recovery 的完整性仍受 C1 阻断。不能据作者侧“7 项全关”直接关闭本任务。

未运行服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 npm run check。本项为尚未实现的契约提案，重门禁按父任务由集成负责人在实际集成版本串行执行；本次文档/样例检查既不代替该门禁，也不构成阶段晋级。修订本清单后交新的独立复审，Git、schema/依赖及真实环境授权边界保持原任务约定。
