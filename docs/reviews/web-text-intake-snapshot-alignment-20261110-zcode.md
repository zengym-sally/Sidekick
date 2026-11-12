# 快照形状对齐核对：§6 规范承诺 × 冻结样例 × P1 × 完整 I × R2 客户端（MAYNE-24，2026-11-10，ZCode）

- **任务来源**：协调层派工（评论 `01a1c244-1235-7355-b438-e0adbccfa5b9`）——「只读核清快照形状差异：对照最终 P1 `b190f7c`、冻结 web-api/1 §6／样例、完整 I `cd08588` handler／服务返回、R2 `170f611` client／harness，逐字段列规范承诺、样例形状与实际实现，特别检查 P1 是否已细化早期样例。给出能否在既有授权／契约内收敛的依据及最小适配／文档处置清单；真正会改变公共承诺的项明确交回裁定。」
- **性质与边界**：纯只读核对。不改生产、不改冻结材料（契约／样例）、不改公共索引（README／manifest 本轮零字节）、不跑真实根／模型、不跑聚合／构建／19 旅程／完整 gate。原始证据在 gitignored `build/mayne24-snapshot-alignment/`，随评论交付摘要附件。
- **结论速览**：① §6 规范承诺的全部成员在完整 I 与 R2 客户端两侧**逐项成立**；样例里 §6 未承诺的成员（`workspace`／`generatedAt`／嵌套 `settings` 块／快照内设置版本）在实现与客户端**双方都不存在、也无人消费**。② **最终 P1（`b190f7c`）没有细化早期样例**——它把快照形状整体交给冻结 §6，其 R3 收口差分不含任何形状文本。③ 差异可以在**既有授权与契约内收敛**（依据见 §6），最小处置是纯文档登记（§7）；真正改变公共承诺的两个方向（样例成员升格为必备、或反向重写冻结样例迁就实现）都需 owner 裁定（§8），本轮两者都不做。

## 1. 来源身份

冻结材料在全部五棵受审树（`b190f7c`／`cd08588`／`170f611`／`9f796f0`／`5233e01`）上 **blob 全同**（`git ls-tree` 复算，`sources-identity.txt`）：契约 `6943151e…`、快照样例 `d148bec3…`。W0 冻结登记（`docs/product/05` 第一行）的钉值 `8511907c…143d`／`61863271…f58d` 为 **SHA-256** 口径，对当前字节复算**精确命中**——本记录所读的契约就是冻结 web-api/1 原字节，无冻结后漂移。样例本体不在 W0 冻结钉值清单内，其身份由五树 blob 全同＋契约 §6 引用承载（SHA-256 `d63672fd…28eb`）。

| 来源 | 锚 | 本记录引用的具体位置 |
|---|---|---|
| 冻结契约 web-api/1（SHA-256 `61863271…f58d`） | （冻结基线） | 卷首样例性质声明、§1 总则、§3.1 字段表、§5 设置资源、§6 补偿规则 |
| 冻结样例 | `tests/fixtures/web-contract/` | `snapshot-high-watermark.json`（`d63672fd…28eb`）、`settings-concurrency.json`（`525d9447…4c4a`）、`sse-events-sample.json`（`c22b65e1…f373`） |
| 最终 P1 | `b190f7c`（P1 final approval package — R3 text closure） | `docs/engineering/web-text-intake-contract.md` + `docs/reviews/web-text-intake-authorization-20261108.md` 全文与 R3 差分 |
| 完整 I | `cd08588` | `server/lib/http-server.mjs:161`（路由）、`:853–879`（handler）；`server/lib/task-service.mjs`（`wireFrom`／`readHighWatermark`／`readConcurrency`）；`server/lib/sse-hub.mjs:177–191` |
| R2 | `170f611` | `src/lib/web-api-client.ts`（`WireSnapshot`／`readSnapshot`）、`src/stores/organizer.ts`（`applySnapshot`）、`src/stores/pairing.ts`（`resync`／帧分发）、`tests/fixtures/web-text-intake/sse-client-harness.mjs`（blob `fe2bd6b1`，`snapshotBody`） |

## 2. §6 对快照的规范承诺（只列契约 prose 明说的）

1. 「返回带 `highWatermark` 的全量快照」（§6 补偿规则行）。
2. 「任务条目与 §3.1 任务资源**同形（全字段）**」。
3. 「快照包含 `highWatermark` 及之前全部事件的权威状态……不得返回落后于高水位的对象版本」。
4. 「客户端以快照返回的 `lastEventId`（`<epoch>:<highWatermark>`）重新订阅」。
5. §1 总则：「任务资源、事件、**快照**与错误包络均携带 `contractVersion` 字段」。

§6 prose **没有**约定：`epoch` 是否独立成员、`agentConcurrency` 放在哪一层、是否存在 `workspace`／`generatedAt`／设置版本。这些成员唯一的具体形状来源是 §6 引用的**样例**文件。

## 3. 快照包络逐字段对照

| 成员 | §6 prose 承诺 | 冻结样例 `d63672fd` | P1 `b190f7c` | 完整 I `cd08588` handler | R2 `170f611` client | harness `fe2bd6b1` |
|---|---|---|---|---|---|---|
| `contractVersion` | ✓（§1） | ✓ 顶层 | 委托 §6 | ✓ | ✓（客户端按常量填 `web-api/1`，不从载荷读） | ✓ |
| `highWatermark` | ✓（承诺 1） | ✓ | — | ✓（先读水位：`readHighWatermark()`） | ✓（typed `number`，消费） | ✓ |
| `lastEventId` | ✓（承诺 4，`=epoch:highWatermark`） | ✓ | — | ✓（`${epoch}:${highWatermark}` 组合） | ✓（resubscribe 令牌唯一来源，消费） | ✓ |
| `tasks[]` | ✓（承诺 2/3） | ✓ | ✓（「任务条目同形」） | ✓（limit=200 翻页走全量，绝不静默截断） | ✓（经 `toModelRun` 同一转换器） | ✓ |
| `epoch` | 未点名（经 lastEventId 组合与 §6 epoch 语义蕴含） | ✓ 顶层 | — | ✓ 顶层 | ✓（typed，消费：同/跨 epoch 判据） | ✓ |
| `agentConcurrency` | **位置未约定** | 仅嵌套于 `settings:{agentConcurrency, version}` | — | **顶层**（`readConcurrency().agentConcurrency`；不带版本） | **顶层**（`WireSnapshot` typed `number`；**下游零消费**——organizer/pairing/TaskQueue 均不读） | 顶层 |
| `settings` 嵌套块 | 未承诺 | ✓ | — | ✗ 不存在 | ✗ | ✗ |
| 设置 `version`（快照内） | 未承诺 | ✓（嵌套内） | — | ✗（CAS 版本由 `GET /api/settings/agent-concurrency` 提供，含 `version`） | ✗（并发 CAS 走 settings 端点 `readConcurrency`/`writeConcurrency`） | ✗ |
| `workspace{…}` | 未承诺 | ✓（mode/currentRoot/capabilities/recovery） | — | ✗ 不存在（P1 §5.4 store 表也无 workspace 数据源——只 SELECT `tasks`/`task_events`/`settings`） | ✗ | ✗ |
| `generatedAt` | 未承诺 | ✓ | — | ✗ 不存在 | ✗ | ✗ |
| `note` | 非契约字段（样例内部说明文字） | ✓ | — | ✗ | ✗ | ✗ |

**handler 与承诺 3 的顺序核**：`cd08588` handler 先读 `readHighWatermark()`，**之后**才翻页读任务——读到的任务版本只可能 ≥ 水位（更新），不可能落后；水位后的增量由重放补发、被客户端版本围栏忽略。顺序正确，承诺 3 成立（handler 注释即引 §6 规则）。

## 4. 任务条目（承诺 2）逐字段核对

§3.1 资源表 24 字段 vs 完整 I `wireFrom`（`task-service.mjs`）vs 样例任务条目：**24/24 全部在场**——`contractVersion, taskId, operationId, type, role, state, version, createdAt, updatedAt, terminalAt, submitSeq, queuePosition, attemptCount, attemptId, attemptExitState, cancelIntent, configRevision, originalConfigRevision, inputRef, progress, result, resultPendingExit, failure, recovery`。样例条目同样 24 字段，两侧同形成立。

条目级两点登记（均非形状冲突）：

- **`progress` 恒 null**：§3.1 定义为 `object | null`、仅展示不作业务事实；实现恒填 null 合法。样例条目展示了填充态（`{stage, detail}`），属示例选择，不构成承诺差异。
- **`inputRef` 内形**：§3.1 只定「不可变输入引用（inline 或来源引用）；不含秘密」，内形留给业务切片；样例给 `{kind, byteSize, contentHash}` 参考形，实现透传提交输入＋canonical。同一纬度内的切片自由，非同形违反；不展开（属完整 I 自己记录的范围）。

## 5. P1 是否已细化早期样例——**没有**

1. 最终 P1 契约对快照的全部文本只有两处，都是**委托**：端点表「`GET /api/snapshot`｜GET｜全量快照＋高水位（**冻结 §6；任务条目同形**）」、任务帧行「任务帧沿用冻结 §6」；另有 §5.4 store 闭合表一行 SQL 目标「SELECT `tasks`／`task_events`／`settings`」（暗示快照读 settings，但不定 wire 形状，且**无 workspace 数据源**——与实现缺 `workspace` 相互印证）。
2. `b190f7c` 的 R3 差分全文核过（`p1-b190f7c-full-diff.txt`）：恰 §4.2 单射措辞、§4.3 cause 白名单限定、§5.4 闭合表反例轴＋models/agents/providers 行、授权文档 7.1 标记与批准摘要分组——**零快照包络形状文本**。
3. P1 授权包（`web-text-intake-authorization-20261108.md`）通篇只有 settings 写模板（`agentConcurrency` 两条 INSERT＋CAS）、存储写目标与审批分组，无快照响应体形状。

即：早期样例（W0 契约自带 `snapshot-high-watermark.json`）的嵌套 `settings`／`workspace`／`generatedAt` 从未被任何后续规范文本细化、取代或批准为必备成员；至今唯一的具体形状出处仍是「样例」。

## 6. 能否在既有授权／契约内收敛——**能**，依据四条

1. **契约自己的样例定性**：web-api/1 卷首明文「样例用于**评审契约形状**，不是可运行服务或实测报文」。规范承诺以 prose 为准——§6 prose 点名的五项（§2 清单）实现全部满足；样例多出的成员 prose 从未承诺。这不是「实现偏离契约」，是「样例成员超出 prose 承诺」。
2. **冻结样例集内部自证嵌套是孤例**：同属冻结材料的 §5 设置资源样例 `settings-concurrency.json`（`525d9447…4c4a`）与 §5 prose 都是**扁平** `{contractVersion, agentConcurrency, default, version, runningCount, queuedCount}`——完整 I 的 settings 端点（`http-server.mjs:832` 直接透传 `readConcurrency()`）与 R2 客户端 settings 方法逐字段吻合。快照样例的嵌套 `settings` 块在整个冻结样例集中**没有第二个嵌套先例**；顶层 `agentConcurrency` 反而与 §5 资源自身的扁平口径一致。
3. **缺失成员无人消费**：R2 侧 `applySnapshot` 只读 `epoch`/`highWatermark`/`tasks`；`WireSnapshot.agentConcurrency` 有类型无消费者（organizer/pairing/TaskQueue 零引用）；设置版本 CAS 走 settings 端点、不经快照。即使服务端严格按样例返回（无顶层 `agentConcurrency`），R2 客户端功能也不受影响——只是类型声明与 wire 不符。故形状差异**当前不构成任何功能缺陷**。
4. **事件内层差异是同款、且客户端不可见**：`settings.changed` 样例嵌套 `setting:{agentConcurrency}` vs 实现扁平 `agentConcurrency`（`sse-hub.mjs:180–190`）；`task.changed` 样例 `taskState` vs 实现 `payload.state`。R2 客户端把帧当**纯提示**（`pairing.ts` 帧分发只看 `event` 名触发权威读回，不读任何载荷细节）——差异对现网客户端惰性。这佐证样例与实现的分歧是**样例写作风格**层面的系统性现象，不是快照单点漂移。

## 7. 最小适配／文档处置清单（本轮零字节改动的落地路径）

1. **不改**：冻结契约（`61863271…f58d`）、三个冻结样例、生产 server/client、公共索引——收敛不需要任何一方改字节。
2. **本记录**取代此前两处口头级备注，成为该分歧的逐字段权威登记：我黑盒记录（`a63a594c`）边界段的「样例嵌套形态与客户端不一致」一句、Hermes 黑盒独审发现②的四源清单（其源④「无实际实现可对裁」已按协调层 `01a1c236` 补正为 `cd08588:853–879`，本记录给出逐字段完成态）。
3. **manifest 登记（留给文档接收轮执行，非本记录写入）**：在 Task-SSE／snapshot 相关节登记「快照形状按 §6 prose 承诺对齐；样例未承诺成员（workspace/generatedAt/嵌套 settings）按样例定性处理；顶层 `agentConcurrency` 为在用读回面」并指向本记录——措辞只签 **prose 一致＋分歧登记**，不签「样例一致」。
4. **集成轮契约一致性验收判据（建议文本）**：真实 HTTP 响应断言 §2 五项 prose 承诺（contractVersion 在场、水位语义、`lastEventId` 组合、条目 §3.1 全字段、无落后版本）；**不**断言样例独有成员；**不**断言嵌套 `settings`。
5. **给 OpenCode 任务控制方案（同批并行派工）的输入**：并发设置读回/CAS 一律走 `GET/PUT /api/settings/agent-concurrency`（`{contractVersion, agentConcurrency, default, version, runningCount, queuedCount}`，扁平含 `version`）；**不要**从 `/api/snapshot` 取并发或其版本——快照既不带设置版本，客户端也不消费快照内并发值。

## 8. 真正改变公共承诺、需交回裁定的项

以下两项是**互为反向**的升格请求，任一都改动冻结材料或公共包络承诺，须 owner（或其授权的冻结协议）裁定；本记录提供精确差分供一次性决策，不代签、不预设立场：

- **甲（样例升格）**：若要把 `workspace`／`generatedAt`／嵌套 `settings`（含快照内设置版本）提升为快照**必备成员**，即修改 web-api/1 公共包络承诺——按卷首规则需升版本或在冻结记录中说明；服务端须补齐（workspace 数据源在 P1 store 表中尚不存在，属新增实现面）。**非收敛所需。**
- **乙（样例改写）**：若要重写／注释冻结样例使其匹配实现（顶层 `agentConcurrency`、去 workspace/generatedAt，乃至统一事件内层 `taskState`↔`state`、嵌套 `setting`↔扁平），属「反改冻结材料迁就实现」，本轮派工明令禁止，只能由 owner 决定是否走冻结记录注记路线（可选的中间形态：一条 docs-only 冻结注记声明「样例未承诺成员仅具评审示例性、顶层 agentConcurrency 为在用读回面」——同样须 owner 落笔，不由本记录代行）。

## 9. 未验项与边界

- 真实组合树 HTTP 实测、真实根／模型、聚合／构建／19 旅程／完整 gate：本轮一律未跑（派工边界）。
- 事件信封逐字段全量审计不在本记录范围；仅登记 §6.4 两处同款内层差异作为观察。
- W0 冻结钉值仅覆盖 001 DDL 与契约本体；样例文件不在钉值清单内，其「冻结」身份按五树 blob 全同＋契约引用登记。
- 完整 I 的 `task.progress` 事件面与 `inputRef` 内形属完整 I 自身记录范围，本记录仅在条目同形层面登记（§4）。
- R2 客户端对样例严格形状的容错性（§6.3）是**静态读码结论**，未经运行时验证。

## 10. 证据与门禁

- 原始证据（gitignored `build/mayne24-snapshot-alignment/`）：`sources-identity.txt`（五树 blob 全同＋冻结钉值 SHA-256 复算命中）、`p1-b190f7c-full-diff.txt`（R3 差分全文）、`complete-i-{http-server,task-service,sse-hub}-extract.txt`（handler／`wireFrom`／`readConcurrency`／settings.changed 帧原文）、`r2-{web-api-client,organizer,pairing}-extract.txt`（`WireSnapshot`／`readSnapshot`／`applySnapshot`／帧分发原文）、`frozen-contract-extract.txt`＋三个冻结样例副本（快照／设置／事件摘录）、`commands.txt`＋`SHA256SUMS`。摘要随评论附件交付。
- 门禁：`npm run check:docs` exit 0（本记录为恰一新增 .md＋README 索引行）；无 JS 改动故无 `node --check` 面；`check:structure` 无新增源（零生产字节）。
