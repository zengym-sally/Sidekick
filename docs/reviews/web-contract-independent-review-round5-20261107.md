# W0 Web API 契约第五轮独立复审（MAYNE-19）

## 对象与结论

- 候选：`agent/claude/mayne-19` 的 `307c7b959b280f1501702bb0521b349ceb1f761d`；相对上一候选 `d29bccc6eec83ef4ded677944e020e87cba4f5b2` 为 11 文件、241 行新增/31 行删除。
- 相对产品基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 新增 48 个文件，均在本任务契约、合成样例及记录范围，没有生产源码、真实 schema/依赖或共享索引改动。
- Inspect 模式，R3 公共契约设计闸门。评审分支保持 `agent/codex/mayne-19`，起点 `e9eb1f0ec1ce792bdc09586e28bba1ff34c896b9`；候选只归档至忽略目录，未合入本分支或 main。
- 两个隔离的全新只读 CLI 上下文分别负责 A 面 API/数据正确性、B 面安全/恢复/运维；仅取得原始请求、候选与权威基线，未取得作者结论或彼此结论。两面均 exit 0、结论均为 **BLOCK**，已完整收回结果。Codex 未参与候选实现，核实并去重发现。
- 综合结论：**reject / BLOCK，退回 started_2；不进入 done、不合入 main、不冻结、不晋级。** 去重后 2 项 P1、2 项 P2，无 P0/P3。

## 实际验证与交付身份

| 检查 | 结果 |
|---|---|
| 候选归档中 `npm run check:docs` | exit 0，18 文件、369 条本地链接通过 |
| 下载的清单自身 SHA-256 | `be7aeecefa5b179e525f7d10e43a77f5b886055cd7ede6e158baba5c360a445e`，与登记值一致 |
| 清单与候选逐文件哈希 | 48/48 匹配 |
| `python3 build/web-contract-review-round5-20261107/audit-fixtures.py` | **exit 1，36 项通过、2 项失败**：同任务不可变身份、recovery 状态约束；详见 A2/A3 |
| 上述通过项 | 42/42 JSON 可解析、版本统一 web-api/1；21 个完整任务资源均具备 24 个必需字段；普通链路输入/版本时序/结果时间、配置失败→重试配对、hold 关联与汇总、条目版本、SSE 令牌/高水位、分段严格解码、样例引用均通过 |
| 分段结果字节 | 严格解码依次为 256、256、88，总长 600；前轮填充问题已修复 |
| `git diff-tree --check d29bccc 307c7b9` | exit 0 |
| 祖先与分支核对 | 产品基线是候选祖先，评审分支包含本轮起点，均 exit 0 |

补丁 SHA-256 重算为 `3bd2b7a8971478459af2d5e00507f411ac91a93c8272179ada6a172b8f7a4f03`，与作者登记一致：

```sh
git diff d29bccc6eec83ef4ded677944e020e87cba4f5b2..307c7b959b280f1501702bb0521b349ceb1f761d -- docs/engineering/web-api-contract.md docs/reviews tests/fixtures/web-contract | shasum -a 256
```

原始证据放在忽略目录 `build/web-contract-review-round5-20261107/`：候选归档、清单、逐文件哈希、补丁、审计脚本/结果及两个评审面的输入/输出和 CLI 日志。入库仅新增本记录，不收原始归档或日志。

## A 面：API 与数据正确性 — BLOCK

### A1 · P1：待核对结果没有可用的读取路径

- 位置：`docs/engineering/web-api-contract.md:60`、`:113`、`:146`、`:170`；`tests/fixtures/web-contract/task-result-reclaimed-needs-review.json:27`。
- 不变量：既然暂存结果用于用户核对，就必须在决定前可以读取实际 payload。
- 反例：场景 29 退出已确认、任务仍为 needs_review，资源 result 只暴露 result:// 引用。客户端被禁止直接访问该引用；唯一结果端点又对所有非 succeeded 状态返回 409。用户只能先确认成功，才能读取原本应先核对的内容。
- 影响：新增恢复路径的“结果可见”仅停留在信封，不能完成实际核对。B 面独立发现相同问题，不重复计数。
- 必需修正：将有明确守卫的恢复状态加入结果读取白名单，沿用内联/分段协议，同步端点表及错误规则；补 needs_review 下读取结果再处置的完整样例。未确认退出的状态仍应拒绝读取/处置，不能扩大例外。

### A2 · P2：场景 24 样例提前携带了恢复状态

- 位置：`tests/fixtures/web-contract/task-result-pending-exit.json:7`、`:29`、`:38`；契约 `docs/engineering/web-api-contract.md:63`、`:128`。
- 证据：样例为 running、attemptExitState=active、resultPendingExit=true，却携带只允许在 needs_review 出现的 result_exit_unconfirmed recovery。§3.1 同时限定 recovery 仅出现在 interrupted/needs_review。
- 影响：按契约生成的状态校验器会拒绝契约指定的正常暂存样例。B 面也独立发现这一项。
- 必需修正：正常暂存样例保持 running/active，recovery 为 null；退出确认失败后的 needs_review/exited_unknown 用独立样例表示，不用同一资源混合两个阶段。

### A3 · P2：同一身份的不可变输入/顺序仍有冲突

- 位置：`tests/fixtures/web-contract/task-needs-review.json:9`、`:18`，对照 `task-recovery-backup-restore.json:9`、`:20`；违反契约的不可变输入规则。
- 证据：相同 taskId/operationId 的输入分别为 source_ref/512 字节与 inline_text/842 字节，内容哈希不同，创建时间也从 11:52:44 改成 12:30。
- 收口补核：同一 `tsk_3f8a…` 的 submitSeq，在 `snapshot-high-watermark.json` 与 `task-cancel-running-cancelling.json` 为 1043，在 `task-needs-review-exit-unconfirmed.json` 和 `task-needs-review-exit-reclaimed.json` 为 1041。持久提交顺序不能随退出核对改变。
- 影响：关联样例为同一任务提供互斥事实，无法作为幂等、快照和恢复的稳定验收输入。
- 必需修正：统一同一任务的原始输入、创建时间和提交顺序；若确为独立场景，换独立 ID 并同步关联引用。当前普通成功链路和配置重试配对已经通过，不需重做；应把同身份一致性检查覆盖所有完整任务资源。

## B 面：安全、恢复与运维 — BLOCK

### B1 · P1：退出回收会把暂存的失败结局提交为成功

- 位置：`docs/engineering/web-api-contract.md:75`、`:84`、`:113`。
- 不变量：进程退出确认只解除进程是否仍存活的不确定性，不能改变已经暂存的执行结局。
- 反例：§3.2 正常路径允许暂存结局在退出确认后成为 succeeded 或 failed。同一个失败结局若先经历退出未知、再由新实例回收，§3.4 却规定无未知副作用统一转 succeeded；用户 resume 也只提交为成功。
- 影响：同一次模型/工具失败仅因退出确认时序不同就呈现相反终态，错误的成功还可能触发后续业务流程。本轮已避免无来源取消，但尚未保持暂存失败的真实语义。
- 必需修正：暂存信封保留成功/失败判别及对应结果/失败字段，回收和人工确认均提交原结局；重试仍走明确的重入队路径。补“暂存失败→退出未知→确认退出→保留失败”的样例，并覆盖副作用未知时的核对处置。

## 进展与未验边界

上一轮设置版本对象、末段 base64、配置失败重试身份以及普通暂存→成功版本时序均已有效修订；取消与非取消回收也已分支，原先错误套用取消意图的具体问题得到修正。剩余问题是新分支的读取能力、暂存失败结局和两个样例一致性问题，不能以作者自检“全部通过”关闭。

两面已覆盖各自分配的全部维度；未因其他 W0 候选、Linux/原生适配或服务实现缺席新增阻断。没有访问真实模型、凭据或工作根，没有运行服务端点、真实 SSE/代理或完整 npm run check。完整门禁仍归集成负责人在实际集成版本串行执行；本轮检查不代表实现通过、契约冻结或阶段准入。修订以上 P1/P2 后重新独立复审，既有 Git/依赖/schema 授权边界不变。
