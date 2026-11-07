# W0 Web API 契约第八轮聚焦复审（MAYNE-19）

## 对象与结论

- 候选：`agent/claude/mayne-19` 的 `6e8b56af6e9565f4433221248d08af69de515f3a`，相对上一候选 `369ce004ce581936eb8cd824408d0095fd2cebfc` 为 3 文件、78 行新增/6 行删除。
- 相对产品基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e` 新增 57 个文件，均在本任务允许的契约、合成样例及记录范围。未改生产代码、真实 schema/依赖或共享索引。
- Inspect，R3 公共契约设计闸门。本轮仅复核统一判别字段和元信息适用范围及直接关联回归。
- 两个全新隔离的只读 CLI 上下文分别审 API/数据面与安全/恢复面，未取得作者或对方结论，均 exit 0，结果已完整收回。**A 面 APPROVE_WITH_CHANGES（1 项 P2）；B 面 APPROVE（无发现）**。无 P0/P1/P3。Codex 未参与候选实现，已核实剩余发现。
- 综合结论：**needs_revision，仅修正 §4.3 一句字段适用范围后再收口**。不关闭候选、不合入 main、不冻结、不晋级。
- 评审分支保持 `agent/codex/mayne-19`，包含起点 `589030ccaa101e53010d82b52614fe8872c8e5c3`；候选仅归档至忽略目录，未合入本分支。

## 实际检查

| 检查 | 结果 |
|---|---|
| 候选归档中 `npm run check:docs` | exit 0，18 文件、375 条本地链接通过 |
| 下载清单自身 SHA-256 | `1cf55259cca630d67f1f4089a9d846f2c64ee520854fbaf47dcae6eccd786167`，与登记一致 |
| 清单与候选逐文件哈希 | 57/57 匹配 |
| `python3 build/web-contract-review-round8-20261107/audit-fixtures.py` | **exit 0，25 项通过、0 项失败** |
| 检查覆盖 | 48/48 JSON 可解析、版本唯一 web-api/1；25 个完整任务资源具备 24 个必需字段；14 个 taskId 不可变身份一致；状态/恢复/条目版本约束、失败读取映射，以及所有读取样例的 outcome/failure 公共判别通过 |
| 分段字节与游标 | 256、256、88 字节，总长 600；偏移 0→256→512，末段 done=true、nextOffset=null，通过 |
| `git diff-tree --check 369ce004 6e8b56af` | exit 0 |
| 分支/祖先 | 产品基线为候选祖先，评审分支包含本轮起点，均 exit 0 |

补丁 SHA-256 重算为 `e125a5cc6bf221379d8ae5885051192dcea29b4a99d67a93ea676a7e952729b2`，与作者登记相同：

```sh
git diff 369ce004ce581936eb8cd824408d0095fd2cebfc..6e8b56af6e9565f4433221248d08af69de515f3a -- docs/engineering/web-api-contract.md docs/reviews tests/fixtures/web-contract | shasum -a 256
```

原始证据在忽略目录 `build/web-contract-review-round8-20261107/`：归档、清单、逐文件哈希、补丁、审计脚本/结果及两面输入/输出和 CLI 日志；仓库只保留本记录。机械检查通过不覆盖下面的规范文本一致性问题。

## A 面：API/数据 — APPROVE_WITH_CHANGES

### A1 · P2：元信息适用范围排除了已定义的内联响应

- 位置：`docs/engineering/web-api-contract.md:167`、`:171`；`tests/fixtures/web-contract/task-result-read-200.json:28`、`task-result-read-needs-review-200.json:6`。
- 不变量：字段适用范围必须与正向响应定义及样例一致。
- 证据：新说明将 totalBytes/maxInlineBytes/maxSegmentBytes/nextOffset/done 统称为“仅出现在索引与分段响应中”；但内联响应的正向定义明确包含前三项，两份内联样例同样包含这些字段。
- 反例与影响：按该“仅出现”规则建立响应校验会拒绝本文自己的内联样例；后端和客户端也无法确定内联是否保证返回大小信息。这是规范文本内部冲突，不是已执行的端点失败。
- 最小修正只改 §4.3 这句描述，保留现有响应形状与 JSON：
  - totalBytes 用于成功结局的内联、索引和分段。
  - maxInlineBytes/maxSegmentBytes 用于成功结局的内联与索引。
  - nextOffset/done 用于成功结局的索引与分段。
  - 失败结局不带上述大小/分段元信息。

上轮 outcome/failure 漏同步问题已修复：分段顶层索引及全部 interaction 响应均具有 outcome=succeeded、failure=null；失败读取仍为明确的失败分支。不应重做样例或扩展功能，只需让新增说明准确表达已有字段形状。

## B 面：直接安全/恢复回归 — APPROVE

未发现确定的 P0–P3 直接回归。公共读取判别未扩大读取白名单；失败暂存仍只在 needs_review/result_exit_unconfirmed/exited_confirmed 后可见。结果上报不释放槽位，退出未知不得处置；恢复及 resume 保留原结局。条目版本/回执核对、hold、会话/来源校验、代理能力、provider 秘密隔离及独立 control 通道不受元信息描述影响。

## 验证边界与收口

本轮未访问真实模型/凭据/工作根，未运行服务端点、真实 SSE/代理、Linux/macOS 原生或完整 npm run check。完整门禁仍归实际集成版本串行执行；本轮证据不代表实现、冻结或阶段准入。修正 A1 后聚焦核对该字段范围与现有读取形状即可，既有 Git/依赖/schema 授权边界保持不变。
