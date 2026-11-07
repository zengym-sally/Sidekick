# W0 Web API 契约第三轮独立复审（MAYNE-19）

## 对象与结论

- 候选：`agent/claude/mayne-19` 的 `b08bf02492f2d60f59329e9cfbf0fed3dd91fa6f`；内容对照上一候选 `7ade73760058708963edfcca1a6d577a38ec5059`，相对产品基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 共新增 38 个文件，全部在本任务允许范围。
- 模式：Inspect，只读评审契约与合成样例。R3 公共契约设计闸门；没有服务实现，不以缺少实现级测试判缺陷。
- 评审工作分支保持 `agent/codex/mayne-19`，起点 `76ea4cfe2939ea137fd8267fa371dcf5e88edba4`。候选仅归档至忽略目录供核验，未合入评审分支或 main。
- 两个隔离的全新只读 CLI 上下文分别负责 A 面（API/数据正确性）和 B 面（安全/恢复/运维），仅取得候选、原始任务范围及权威基线，没有取得作者结论或对方结论；两面均退出 0、结论均为 **BLOCK**。Codex 未参与候选实现，逐项核实发现并补充关联样例检查。
- 综合结论：**reject / BLOCK，退回 started_2；不进入 done，不合入 main，不冻结、不晋级。** 去重后 3 项 P1、3 项 P2；无 P0、P3。

## 身份与实际检查

| 检查 | 结果 |
|---|---|
| 候选归档中 `npm run check:docs` | exit 0，18 文件、359 条本地链接通过 |
| `python3 build/web-contract-review-round3-20261107/audit-fixtures.py` | **exit 1**；19 项检查通过、3 项语义一致性检查失败，见 A2；不能将此汇总成“样例全部通过” |
| 上述审计的通过项 | 34/34 JSON 可解析，版本统一 web-api/1；15 个完整任务资源均具备 23 个必需字段；终态时间、hold 汇总、事件令牌、游标 1042 快照状态、34/34 样例引用通过 |
| 经 CLI 下载交付清单并核对 | 清单自身 SHA-256 与登记值 `7966da8fc6267cd03509cc53a0ba105c61fdb9e0d6a5781a4ad95fe4b04b10a7` 一致；37/37 文件哈希均匹配候选。清单不含其后新增的返工记录，提交 SHA 固定全部 38 个文件 |
| `git diff-tree --check e94c991 b08bf02` | exit 0；无范围外改动 |
| 基线与评审分支祖先核对 | `85feb8a` 为候选祖先，`76ea4cf` 为当前评审 HEAD 祖先；均 exit 0 |

作者登记的相对执行起点 `e94c99178f946d6a937b8c6b5543ee2532e043a4` 的补丁哈希重算为 `c2354d294e76c70e8c1eefc9bee04c1ebbce54a77c598d115c9b140806dce073`，**匹配**。相对前次被评审内容 `7ade737` 的补丁哈希为 `8577ac949884e6c25c167f015b0358aeb2e442a31a7bb96ed0b3c07232c0d0e7`。复核命令：

```sh
git diff 7ade73760058708963edfcca1a6d577a38ec5059..b08bf02492f2d60f59329e9cfbf0fed3dd91fa6f -- docs/engineering/web-api-contract.md docs/reviews tests/fixtures/web-contract | shasum -a 256
```

原始证据在忽略目录 `build/web-contract-review-round3-20261107/`：候选归档、两面输入/输出与 CLI 日志、下载清单、逐文件哈希、补丁、审计脚本及 `fixture-audit.json`。仓库只新增本记录，不收整份归档或日志。

## A 面：API 与数据正确性 — BLOCK

### A1 · P1：大结果读取仍没有确定的后续请求

- 位置：`docs/engineering/web-api-contract.md:151`、`:152`、`:153`；`tests/fixtures/web-contract/task-result-read-200.json:27`。
- 不变量：成功任务必须能沿公开 API 读到结果；结果引用由后端解析，不能要求客户端直接请求 result://。
- 反例：结果超出内联上限，响应只含 payloadRef。契约只写“支持 Range/分页”，没有选定请求参数/Range 单位、分段对象、响应形状与状态、结束条件；客户端无法确定下一次请求。当前样例仅证明小结果内联返回。
- 影响：前轮 A1 只在小结果路径修复，尚不能作为完整结果读取契约冻结。
- 必需修正：选定一个分段读取协议，给出请求、响应、边界与错误、完成条件，以及一次超限结果的完整交互样例；具体阈值可由配置决定。

### A2 · P2：同一任务的不可变事实和关联投影不一致

- 位置：`tests/fixtures/web-contract/task-resource-running.json:9`、`:20`、`:21` 与 `task-succeeded-result.json:9`、`:20`、`:21`；违反契约 `docs/engineering/web-api-contract.md:58`、`:155`。
- 证据：场景 1 虽已统一 taskId，但 running → succeeded 的 createdAt 从 12:30 变成 12:20，inputRef.byteSize 从 842 变成 1180，contentHash 也改变。不能用改了 ID 的两份不同输入证明同一任务链路。
- 收口补核：`task-recovery-backup-restore.json:5` 和 `task-recovery-root-activation.json:5` 的 type 均为 organize_text；它们明确引用的同一 hold/item 在 `recovery-hold-report.json:41`、`recovery-hold-root-activation.json:33` 却均为 reminder_send。审计这两项也失败。
- 影响：场景与投影会给实现者互斥预期，恢复时还涉及只读/外部发送类型的安全判断。
- 必需修正：按同一 taskId 固定创建时间、提交顺序、不可变输入与类型；关联 hold/item 只投影该任务的真实字段。增加关联一致性核验，不能只核字段存在和顶层版本。

### A3 · P2：自动重试预算耗尽后的可见状态被漏掉

- 位置：`docs/engineering/web-api-contract.md:83`、`:183`、`:190`、`:348`；对照前次候选 §4.6，其 model_request_failed 原先明确“预算耗尽转 manual”，本轮删掉该句。
- 反例：model_request_failed/proven_safe 达到 attempt_budget；契约要求有界，却未定义停止后的 retryable、nextAttemptAt 与用户操作，用户 retry 又只接受 manual。
- 影响：可能形成不能自动继续、也不能手动重试的 failed/auto_backoff；不同实现只能各自猜测。
- 必需修正：恢复明确的预算耗尽迁移与字段清理，说明人工重试如何处理预算并补耗尽样例；无需在本轮确定具体退避算法。

## B 面：安全、恢复与运维 — BLOCK

### B1 · P1：正常结果上报仍被当成进程树退出确认

- 位置：`docs/engineering/web-api-contract.md:73`、`:90`；依据设计中进程清理与执行槽的边界。
- 反例：状态机以“当前 attempt 提交结果”为事件，直接设置 exited_confirmed。worker 已发结果但尚未退出，或所属工具子进程尚存活，按槽位规则即可释放并补发新任务。
- 影响：新字段修好了取消未知退出的路径，但正常完成路径仍可超过并发限制；业务结果成功不等于进程树已退出。
- 必需修正：明确结果暂存与宿主确认退出的先后关系；终态提交或槽位释放须以所属进程树确已退出为守卫，并规定“结果已到、退出未确认”的状态、事件及槽位表现。补该路径的样例，不能只写字段值。

### B2 · P1：恢复处置别名绕开了同一版本守卫

- 位置：`docs/engineering/web-api-contract.md:96`、`:123`、`:136`、`:262`、`:354`；`tests/fixtures/web-contract/recovery-resolve-request.json:2`。
- 不变量：任务 resolve 与 hold 条目 resolve 被声明为同一操作，必须遵循同一份乐观并发规则。
- 证据：任务端点要求 expectedVersion，条目端点及其样例没有该字段；文档声称同时递增任务和条目版本，但 recovery_items 逻辑结构和报告均没有条目版本或可用于条件提交的任务版本。
- 影响：两个窗口持旧报告分别提交 resume/cancel 时，旧请求应冲突还是允许更新没有统一契约；不能将没有版本输入的端点视为相同的受版本保护操作。
- 必需修正：统一版本来源、读取/提交字段及 409 行为，报告返回可用版本；明确已经处置的条目不可被旧请求改写，补两个入口交叉竞争的请求/响应样例。

### B3 · P2：退出回收后没有合法的 recovery 形状

- 位置：`docs/engineering/web-api-contract.md:80`、`:106`、`:110`、`:117`。
- 证据：新实例只将 exited_unknown 改为 exited_confirmed，业务状态仍为 needs_review，并允许后续 resolve；cancel_exit_unconfirmed 分支却被定义为退出未知且无 decisionOptions，也禁止客户端依赖分支外字段。未规定扫描后 cause 与动作集合如何变化。
- 影响：后端不能同时满足原 cause 的结构和“退出已确认、可处置”的新状态，前端也没有稳定的动作判据。
- 必需修正：定义回收时的 cause、版本与 decisionOptions 迁移，分别给出回收前后资源及一次合法处置样例。

## 前轮修订的核实与证据边界

前轮自动重试的副作用安全门槛、显式配置修订 retry、取消的版本竞争规则、hold 汇总计数、restore 的 operationId/holdId 读回，均有相应修订且本轮核实成立。退出未知保槽已在取消路径明确；结果端点、恢复变体与别名也已新增，但分别受上述剩余问题约束，不能仅据作者侧“清单全关”完成任务。

已覆盖两面分配的全部维度，未以其他 W0 候选、原生/Linux 探针或生产实现缺席阻塞本契约评审。没有访问真实凭据/模型/工作根，没有运行端点、真实代理或完整 npm run check。重门禁仍归集成负责人在实际集成版本串行执行；本轮检查不构成新后端运行、契约冻结或阶段准入。修订后交新独立复审，原 Git/依赖/schema 授权边界不变。
