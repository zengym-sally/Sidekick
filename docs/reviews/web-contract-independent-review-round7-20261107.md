# W0 Web API 契约第七轮聚焦复审（MAYNE-19）

## 对象与结论

- 候选：`agent/claude/mayne-19` 的 `369ce004ce581936eb8cd824408d0095fd2cebfc`，相对上一候选 `bd374a1d556f2dcca37a73e200af0a48f78d60b7` 为 6 文件、148 行新增/8 行删除。
- 相对产品基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 新增 56 个文件，均在本任务允许的契约、合成样例及记录范围；未改生产代码、真实 schema/依赖或共享索引。
- Inspect，R3 公共契约设计闸门。本轮按前次约定聚焦“待核对失败读取”及关联回归，未重新打开无关范围。
- 两个全新隔离的只读 CLI 上下文分别负责 API/数据面和直接安全/恢复回归；仅收到原始请求、候选及权威基线，没有作者或彼此结论。均 exit 0，结果已完整收回。A 面 **APPROVE_WITH_CHANGES（1 项 P2）**，B 面 **APPROVE（无发现）**；无 P0/P1/P3。
- Codex 未参与候选实现，已核实发现。综合结论：**needs_revision，仅修正下面一处关联回归后再收口**。不进入 done、不合入 main、不冻结、不晋级。
- 评审分支保持 `agent/codex/mayne-19`，包含起点 `bd6b28bd82304a92cd3b17c65d729497c19435df`；候选仅归档至忽略目录，没有合入本分支。

## 实际验证

| 检查 | 实际结果 |
|---|---|
| 候选归档中 `npm run check:docs` | exit 0，18 文件、375 条本地链接通过 |
| 下载清单自身 SHA-256 | `1d3f736fc5c47c0943b052a6860ffae623aad242e69b1c390c9aeea634126d14`，与登记一致 |
| 清单与实际候选逐文件哈希 | 56/56 匹配 |
| `python3 build/web-contract-review-round7-20261107/audit-fixtures.py` | **exit 1，38 项通过、1 项失败**：大结果索引未提供新增必需判别字段 |
| 通过项 | 48/48 JSON 可解析、版本唯一 web-api/1；25 个完整任务资源具备 24 个必需字段；14 个 taskId 不可变身份一致；recovery/条目版本、普通链路、配置重试、hold 投影/汇总、SSE/高水位、成功和失败核对读取配对均通过 |
| 分段严格解码 | 256、256、88 字节，总长 600，通过；本项不是编码损坏 |
| `git diff-tree --check bd374a1 369ce004` | exit 0 |
| 祖先/分支 | 产品基线为候选祖先，评审分支包含本轮起点，均 exit 0 |

补丁 SHA-256 重算为 `f726a9bd1082413c7ef5d2e41e9ed1cce43e7084a89e09350923ac5621e42f56`，与登记相同：

```sh
git diff bd374a1d556f2dcca37a73e200af0a48f78d60b7..369ce004ce581936eb8cd824408d0095fd2cebfc -- docs/engineering/web-api-contract.md docs/reviews tests/fixtures/web-contract | shasum -a 256
```

原始证据位于忽略目录 `build/web-contract-review-round7-20261107/`：候选归档、清单、逐文件哈希、补丁、审计脚本/结果及两面输入/输出和 CLI 日志；仓库只保留本记录。

## A 面：读取契约及关联样例 — APPROVE_WITH_CHANGES

### A1 · P2：分段路径没有同步新增的统一结局字段

- 位置：`docs/engineering/web-api-contract.md:166`、`:168`、`:170`；`tests/fixtures/web-contract/task-result-read-segmented-200.json:1`、`:20`、`:31`、`:45`、`:59`。
- 不变量：§4.3 新增“读取响应一律带 outcome”，成功响应的 failure 为 null；所有适用的 DTO/样例须与同一判别联合一致。
- 证据：内联成功、待核对成功、待核对失败读取样例已更新，但大结果索引顶层没有 outcome/failure；interaction 内的索引及三个分段 response 也没有。§4.3 的分段响应字段定义同样遗漏这两个公共判别字段。
- 反例与影响：客户端按本轮新增的 outcome 判别联合校验场景 25，索引或分段无法匹配成功分支。字节本身可完整解码，不能据此认为 JSON 响应形状也通过。
- 最小修正，仅涉及本项契约与该分段样例：
  1. 分段响应定义补齐 `outcome: "succeeded"`、`failure: null`，明确分段 DTO 的公共判别与索引元信息的适用范围。
  2. 样例顶层索引及 interaction 的每个 response（索引＋三段）同步补齐这两个字段。
  3. 核验全部成功/失败读取响应的判别一致性，同时保留 256/256/88 字节与 600 总长断言；不新增功能、端点或依赖。

前轮剩余的“待核对失败读回”问题本身已修复：failure 可见守卫、结果白名单、`outcome=failed` 响应、同任务失败信封及先读后处置路径一致。该项无需重做；当前发现是新增判别约定对既有分段路径的漏同步。

## B 面：直接安全/恢复回归 — APPROVE

未发现确定的 P0–P3 直接回归。失败读取仍限于 needs_review/result_exit_unconfirmed/exited_confirmed；未确认退出不提前读取或释放槽。读取不构成处置，resume 仍提交原失败结局，条目版本与回执核对规则保持；会话/来源授权、凭据边界、独立控制通道未被扩大。新增失败读取样例与对应任务的 ID、attempt、失败信封及退出确认状态一致。

## 边界与收口

本轮未访问真实模型/凭据/工作根，未运行服务端点、真实 SSE/代理、Linux/macOS 原生或完整 npm run check。完整门禁仍归实际集成版本串行执行；文档和样例检查不代表实现、契约冻结或阶段准入。修正 A1 后只需对统一读取判别及直接关联回归做新独立核实，原 Git/依赖/schema 授权边界不变。
