# web-api/2 client fixtures（MAYNE-38 专用）

本目录是 MAYNE-38（退出核实证据与断线恢复的浏览器呈现）自有回归夹具，来源两类：

## `frozen/` — 冻结样例的字节级拷贝（16 份）

来源：冻结 V2 规范配套样例 `tests/fixtures/web-contract-v2/`，精确 commit
`0c9febc5010015418a5778a49f76d4e0c01f7f9f`（tree `06adbf5095d8a265f1b6e09cade1a5918bc1fdf6`，
契约文件 sha256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`）。

每份文件用 `git show <commit>:<path>` 提取后逐字节复制，并经 SHA-256 逐文件比对
（`build/mayne38-api2-browser/frozen-sample-copies.sha256`；提取脚本在两棵树上重算哈希全部相等）。
冻结原件本身只读，本目录的拷贝不构成对冻结位置的写入。

清单：`task-resource-running`（active、证据 null）、7 份独立否决样例
（stray-pending／argv-hit／argv-not-performed／argv-scan-failed／argv-scan-eperm／group-eperm／group-survivor）、
`task-needs-review-exit-reclaimed`（registry_extinct 确认证据＋decisionOptions）、
`task-needs-review-exit-unconfirmed`、`task-result-pending-exit`（暂存结局不早发布）、
`snapshot-high-watermark`（§6.1 同形快照）、`sse-events-sample`（握手/事件/reset 信封）、
`settings-concurrency`（设置版本来源）、`error-exit-unconfirmed-409`、`error-version-conflict-409`。

## `derived/` — 由冻结样例派生的受控负例（规范 §3.1.1/§6.1 可证伪面）

每份文件以对应冻结样例为底，只引入规范明确要求拒绝的一个缺陷；字段形状与其余值保持
冻结样例同形。对应关系：

| 文件 | 底样例 | 引入缺陷（契约依据） |
|---|---|---|
| `snapshot-missing-generatedat.json` | snapshot-high-watermark | 删除规范性成员 `generatedAt`（§6.1 成员 3） |
| `snapshot-missing-settings.json` | snapshot-high-watermark | 删除嵌套 `settings` 块（§6.1 成员 4） |
| `snapshot-missing-workspace.json` | snapshot-high-watermark | 删除嵌套 `workspace` 块（§6.1 成员 6） |
| `snapshot-agentconcurrency-mismatch.json` | snapshot-high-watermark | 顶层 `agentConcurrency=4` ≠ `settings.agentConcurrency=3`（§6.1 成员 5 同源不变式） |
| `snapshot-lasteventid-mismatch.json` | snapshot-high-watermark | `lastEventId` 游标 ≠ `highWatermark`（§6.1 成员 3） |
| `snapshot-trimmed-task.json` | snapshot-high-watermark | 任务条目缺 `attemptExitState/attemptExitEvidence` 全字段承诺（§6.1 成员 1） |
| `task-evidence-malformed-tree-proven.json` | task-needs-review-exit-reclaimed | `residual.treeExtinctProven=true`（§3.1.1 不变式 4 字面量 false） |
| `task-evidence-malformed-identity.json` | task-needs-review-exit-reclaimed | `registry.total ≠ confirmedExtinct + unobservable + survivors`（§3.1.1 恒等式） |
| `task-evidence-null-on-exited-unknown.json` | task-needs-review-exit-unconfirmed | `exited_unknown` 证据为 null（§3.1 出现规则） |
| `task-evidence-on-active.json` | task-resource-running | `active` 携带证据（§3.1 出现规则） |
| `task-evidence-verdict-state-mismatch.json` | task-needs-review-exit-reclaimed | `exited_confirmed` 携带 `unresolved` 证据（§3.1.1 不变式 2） |
| `task-evidence-argv-hit-confirmed.json` | task-needs-review-exit-reclaimed | `registry_extinct` 但 `argvScan.hits=1`（§3.1.1 不变式 1/3） |

这些负例是客户端「缺失/畸形/自相矛盾证据保持拒绝」与「快照必需成员缺失拒绝」的可证伪
对照；正控为 `frozen/` 的对应样例。
