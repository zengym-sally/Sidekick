# W0 Web API 契约第四轮独立复审（MAYNE-19）

## 对象与结论

- 候选：`agent/claude/mayne-19` 的 `d29bccc6eec83ef4ded677944e020e87cba4f5b2`，父候选 `b08bf02492f2d60f59329e9cfbf0fed3dd91fa6f`；本轮 25 文件、369 行新增/55 行删除。
- 相对产品基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 共 44 个新增文件，均在本任务的契约、合成样例与记录范围，未修改生产代码、真实 schema/依赖或共享索引。
- 模式：Inspect，R3 公共契约设计闸门。评审分支保持 `agent/codex/mayne-19`，起点 `8fdc9eb25778f7492a7a25cd86234e0e5ceecc38`；候选只归档到忽略目录，未合入评审分支或 main。
- 两个全新只读 CLI 上下文独立审查：A 面 API/数据正确性为 **APPROVE_WITH_CHANGES**（4 项 P2）；B 面安全/恢复/运维为 **BLOCK**（1 项 P1）。两面只取得原始任务范围、候选和权威基线，未取得作者结论或彼此结论；执行均 exit 0，已收集结果。
- Codex 未参与实现，逐项核实发现。综合结论：**reject / BLOCK，退回 started_2；不进入 done、不合入 main、不冻结、不晋级。** 无 P0/P3。

## 新鲜证据

| 检查 | 实际结果 |
|---|---|
| 候选归档中 `npm run check:docs` | exit 0，18 文件、365 条本地链接通过 |
| CLI 下载的交付清单自身 SHA-256 | `7dc9c436c8e5969e69359d7bec8a6ad353e57f11974983166a89b36597a6b19a`，与登记值相同 |
| 清单与实际候选逐文件比对 | 44/44 哈希匹配，包括本轮返工记录 |
| `python3 build/web-contract-review-round4-20261107/audit-fixtures.py` | **exit 1，33 项通过、3 项失败**：末段 base64 填充、重试输入身份、暂存/终态的版本时序；不能签“样例全部通过” |
| 上述审计的通过项 | 39/39 JSON 可解析、版本统一 web-api/1；18 个完整任务资源具备 24 个必需字段；普通链路不可变输入、两个 hold 关联类型/条目版本、hold 汇总、事件令牌及游标 1042 状态均通过；预算耗尽与取消来源回收样例通过 |
| 分段字节检查 | 前两段均解出 256 字节；末段严格解码失败。仅为诊断补齐 `==` 后可解出 88 字节，总长 600 字节，此补齐未写回候选 |
| `git diff-tree --check b08bf02 d29bccc` | exit 0 |
| 分支与基线祖先核实 | `85feb8a` 为候选祖先，当前分支包含本轮起点 `8fdc9eb`，均 exit 0 |

补丁 SHA-256 重算为 `fdbc03afa377adbea04c4e88926f3aaa57f42c07e175ecf0b5490218928786fc`，与交付评论登记一致：

```sh
git diff b08bf02492f2d60f59329e9cfbf0fed3dd91fa6f..d29bccc6eec83ef4ded677944e020e87cba4f5b2 -- docs/engineering/web-api-contract.md docs/reviews tests/fixtures/web-contract | shasum -a 256
```

原始证据位于忽略目录 `build/web-contract-review-round4-20261107/`：候选归档、交付清单、逐文件哈希、补丁、审计脚本/结果及两面输入/输出和 CLI 日志。仓库只保留本记录。

## A 面：API 与数据正确性 — APPROVE_WITH_CHANGES

### A1 · P2：并发设置的版本校验对象写成任务版本

- 位置：`docs/engineering/web-api-contract.md:99`、`:206`、`:370`。
- 不变量：乐观并发版本应绑定被修改对象。§3.3 将“重试/并发调整”的 expectedVersion 一起注明为任务版本，而 settings 自身另有 version；请求并不携带 taskId。
- 反例：并发设置为 v5，任一任务为 v2；PUT 并发时应校验哪个对象的版本无法按本文确定。
- 修正：明确并发调整校验对应 setting 的 version，GET/PUT 返回并接受该版本；将任务版本、条目版本、设置版本分别说明。

### A2 · P2：分段结果末段缺 base64 填充

- 位置：`tests/fixtures/web-contract/task-result-read-segmented-200.json:67`；对应契约 `docs/engineering/web-api-contract.md:158`。
- 证据：末段 payloadBase64 长 118 字符，Python 严格解码返回 Incorrect padding；补上 `==` 后得到声明的 88 字节。
- 影响：样例不能直接通过采用标准带填充解码的客户端，尚不能作为完整大结果读取的可执行预期。
- 修正：补齐末段编码，逐段核对解码长度为 256、256、88，且总长为 600；不得靠 JSON 可解析代替二进制字段核验。

### A3 · P2：配置重试样例仍复用不一致的任务输入

- 位置：`tests/fixtures/web-contract/task-retry-new-config-202.json:6`、`:12`、`:25`、`:26`，对照 `task-failed-credential.json:3`、`:9`、`:20`、`:21`。
- 证据：相同 taskId/operationId 下，创建时间从 12:36:12 变为 12:30，输入从 390 字节变成 842 字节，哈希也不同。该失败前态的 code 还是 credential_unavailable，未展示允许更换配置的配置类失败前态。
- 不变量与影响：重试不能修改不可变输入；当前样例不能组成确定的“配置失败后重试”链路。
- 修正：若表示同一任务，保留原创建时间与输入并提供合法配置失败前态；若表示独立场景，使用独立 ID 并补对应前态。原普通成功链路及两个 hold 投影本轮已修正，不需重做。

### A4 · P2：暂存结果与成功终态的版本/时间冲突

- 位置：`tests/fixtures/web-contract/task-result-pending-exit.json:8`、`:10`，对照 `task-succeeded-result.json:8`、`:10`。
- 证据：同一 taskId 与 attemptId 在 12:32:30 为 succeeded/v3，12:32:31 却为 running/v3 且 resultPendingExit=true。
- 不变量与影响：状态迁移应递增版本；同一版本不能同时表示待退出与成功，客户端无法按版本确定权威状态。
- 修正：让暂存样例先于终态，成功状态版本递增，并同步完成时间与结果读取样例；若为替代时序，则明确场景身份，避免相同资源形成互斥预期。

## B 面：安全、恢复与运维 — BLOCK

### B1 · P1：正常完成任务被套用取消专属的退出回收

- 位置：`docs/engineering/web-api-contract.md:76`、`:109`、`:120`；起点样例 `tests/fixtures/web-contract/task-result-pending-exit.json:16` 的 cancelIntent=false。
- 不变量：未请求取消的任务不得仅因退出确认延迟变成 cancelled；已接收的暂存结果须有确定后续路径，不能凭空产生取消意图。
- 反例：正常任务结果已暂存，退出无法确认，按 §3.2 进入 needs_review/exited_unknown。新实例确认进程退出后，§3.4 对“所有”此类 attempt 规定：无外部副作用直接 cancelled；否则转 cancel_unknown_side_effect 并保持 cancelIntent=true。前者错误取消正常任务，后者把原 false 改成了无来源的取消意图。
- §3.5 也没有给非取消的退出未知结果提供合法 cause；不能借用 cancel_exit_unconfirmed 使正常结果恢复成立。
- 影响：成功暂存结果可能无法交付，实现者只能自行选择丢结果、错误取消或重执行。新结果暂存/保槽规则虽已建立，尚未形成完整恢复状态机。
- 必需修正：按真实取消意图、暂存结果和副作用证据分支回收。取消专属迁移仅作用于取消路径；为非取消的退出未知状态定义合法 recovery，明确退出确认后如何提交原暂存结果或进入显式核对。补有/无外部副作用的两条恢复样例，覆盖 cause、cancelIntent、result、状态和槽位。

## 本轮进展与未验边界

前轮分段读取协议、结果暂存保槽、两入口共用条目版本、普通链路不可变字段/hold 类型、自动重试预算耗尽及取消来源的回收形状均已有具体修订。剩余问题集中在这些修订的组合边界及样例，不能用作者自检“全部通过”代替当前核验。

两面已覆盖分配的全部维度；没有因其他 W0 候选或服务实现缺席新增阻断。未访问真实模型/凭据/工作根，未运行端点、真实 SSE/代理、Linux/macOS 原生适配或完整 npm run check。完整门禁仍由集成负责人在实际集成版本串行执行；文档与样例检查不构成实现通过、契约冻结或阶段晋级。修订上述 P1/P2 后重新独立复审，既有 Git/依赖/schema 授权边界不变。
