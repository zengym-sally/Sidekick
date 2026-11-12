# 快照一致性有界核对与动态验收设计（MAYNE-32，2026-11-11，Hermes）

- **任务来源**：MAYNE-32 卡描述——对照本卡指定 `cd28027`（快照形状对齐核对报告）与 OpenCode 独审（`01a1c25f-b2ef` 附件 `web-text-intake-snapshot-alignment-20261110-opencode-review.md`）的事实与 F1–F3 更正，给出「冻结承诺／样例／实际 HTTP／客户端消费 → 最小差异 → 建议文件 → 可证伪运行观察」一张表；明确水位与并发分页哪些已证、哪些需实际组合正反控。
- **性质与边界**：只读核对＋验收设计。不改生产、样例、冻结契约、公共索引（`docs/reviews/README.md` 与 manifest 本轮零字节）；不重复 11 面黑盒或已过报告独审；不跑构建／聚合／完整 gate。唯一新增写入：本记录＋gitignored `build/mayne32-snapshot-resume/`。本卡总体仍需 Codex 裁定／必要实施／动态验收，本材料不自签卡 done、不改状态。
- **所有源锚由本审独立复算命中**（blob／SHA-256／行号逐项，证据见 §6），非转述两报告。

## 1. 来源身份（本审独立复算）

| 来源 | 锚 | 本审复算命中 |
|---|---|---|
| 受审报告 `cd28027` | `cd28027a0804…50ff9`，恰两文件 | 报告 blob `2c5db33a…b696`（15439 字节）、README numstat 2+/1−（计数 123→124＋新行）——与 OpenCode 独审登记逐字一致 |
| OpenCode 独审 | MAYNE-24 评论 `01a1c25f-b2ef` 附件 | `01a1c25f-ae8a`（15724 字节），含 F1–F3 与 Q1–Q4 |
| 冻结契约 web-api/1 | `cd08588` `docs/engineering/web-api-contract.md` blob `6943151e…501b` | SHA-256 `61863271…f58d`＝W0 冻结钉值精确命中，无冻结后漂移 |
| 冻结样例 | 同树 `tests/fixtures/web-contract/` | 快照 `d148bec3`＝SHA `d63672fd…28eb`、设置 `8ffe9b0`＝SHA `525d9447…4c4a`、事件 `e9ec352`＝SHA `c22b65e1…f373`——三枚全中 |
| 实际 HTTP | `cd08588`（完整 I） | `server/lib/http-server.mjs:161`（路由）、`:853–879`（handler）；`task-service.mjs:280`（`wireFrom`）、`:407–410`（`readHighWatermark`）、`:762`（`readConcurrency`）；`sse-hub.mjs:99`（`replayFrom`）、`:137–155`（`broadcastTaskChanged`）、`:177–190`（`broadcastSettingsChanged`） |
| R2 客户端 | `170f611` | `src/lib/web-api-client.ts:189–196`（`WireSnapshot`）、`:667–680`（`readSnapshot`）、`:681–690`（settings CAS）；`src/stores/organizer.ts:84`（`applySnapshot`） |
| harness | blob `fe2bd6b1` | `ls-tree`：`170f611`／`b190f7c`／`cd08588` **不存在**；`9f796f0`／`5233e01`／`cd28027` 存在——F2 独立复算成立 |

## 2. 主表：四源 → 最小差异 → 建议文件 → 可证伪运行观察

「承诺」列＝冻结契约 prose（blob `6943151e`）。「样例」列＝冻结快照样例（`d63672fd`）。两报告已核事实经本审逐锚复核；F3 更正已按 §3 口径吸收。

| 面 | 承诺（prose） | 冻结样例 | 实际 HTTP（`cd08588`） | 客户端消费（`170f611`） | 最小差异 | 建议文件 | 可证伪运行观察 |
|---|---|---|---|---|---|---|---|
| `contractVersion` | §1（:11）：快照携带 | ✓ 顶层 | ✓（`CONTRACT_VERSION`，:874） | ✓（按常量填，不读载荷） | 无 | — | R1 |
| `highWatermark` | §6（:250）：带高水位的全量快照 | ✓ | ✓（`readHighWatermark()`＝`MAX(cursor)`，先于翻页，:857/:858） | ✓ typed，消费（代次围栏） | 无 | — | R2/R3 |
| `lastEventId` | §6：`<epoch>:<highWatermark>` 重订阅令牌 | ✓ | ✓（`${epoch}:${highWatermark}`，:876） | ✓（重订阅令牌唯一来源） | 无 | — | R4 |
| `tasks[]` | §6：与 §3.1 同形（全字段） | ✓（24 字段） | ✓（`wireFrom` 恰 24 字段，`progress` 恒 null 合法——§3.1 定义 `object\|null` 仅展示） | ✓（经 `toModelRun` 同一转换器） | 无形状差异 | — | R1/R5/R6 |
| `epoch` 顶层成员 | prose 未点名（经 lastEventId 组合蕴含） | ✓ | ✓（:877） | ✓（同/跨 epoch 判据，消费） | 无（成员超 prose 但两侧同形、被消费） | manifest 登记措辞「prose 一致＋分歧登记」 | R7 |
| `agentConcurrency` 层位 | **位置未约定** | 仅嵌套 `settings.agentConcurrency` | **顶层**（:878） | **顶层** typed（`web-api-client.ts:196`）；**下游零消费**（src/ 全 grep 仅 web-api-client 5 处；organizer/pairing/TaskQueue 不读；CAS 走 settings 端点 :681–690） | 样例 vs 实现层位相反；客户端按实现形状取值——**静态成立，无功能缺陷**；类型陷阱仅对未来消费者 | 登记措辞（manifest）；任务控制方案：并发读回/CAS **必要项**走 `GET/PUT /api/settings/agent-concurrency`（`9d52086` 谱系方案文件，实施时按必要项执行） | R9/R10 |
| 嵌套 `settings` 块／快照内设置版本 | 未承诺 | ✓（`settings:{agentConcurrency, version}`） | ✗ 不存在 | ✗ | 样例独有成员，两方均无、零消费 | 登记措辞（manifest）；升格为必备＝公共承诺变化，交 Codex→owner（甲） | R9 |
| `workspace{…}` | 未承诺 | ✓（mode/currentRoot/capabilities/recovery） | ✗（P1 §5.4 store 只 SELECT `tasks`/`task_events`/`settings`，无数据源） | ✗ | 同上；升格需新增实现面 | 同上（甲） | R9 |
| `generatedAt`／`note` | 未承诺／非契约字段 | ✓／✓ | ✗ | ✗ | 样例独有 | 同上（甲）；`note` 无需处置 | R9 |
| `task.changed` 内层 | §6 正文内联示例即 `taskState`（:230–234） | `taskState` | **线上帧＝`taskState`**（`sse-hub:147`；重放只从内存 `frames` 服务，`replayFrom:99–108`） | 帧＝纯提示（只看 event 名触发权威读回） | **无线上分歧**（F3 更正：持久行 `payload:{state}`（task-service :529/:542/:593/:646）只喂 `MAX(cursor)`，从不下发） | 登记口径按 F3（§3）；原报告该例证作废 | R4 |
| `settings.changed` 内层 | prose 未点名 | 嵌套 `setting:{agentConcurrency}` | **扁平 `agentConcurrency`**（`sse-hub:187`） | 不读载荷细节（提示式） | **真线上分歧**（样例 vs 实现），现客户端惰性 | 登记措辞（manifest）；同归「样例独有形状」处置族 | R4 旁证 |

## 3. F1–F3 更正口径（后续引用联合口径：`cd28027`＋OpenCode 独审修正；原报告本体不改）

- **F1（登记级，本审复算成立）**：`cd28027` README numstat 实为 2+/1−（计数 123→124＋新行），新行含「核对完成（零字节改动）」与报告 §4「README／manifest 本轮零字节」自相矛盾。修正口径：「生产／冻结／样例／fixture／manifest 零字节；`docs/reviews/README.md` 为登记性增量」。本记录即按此口径自述边界。
- **F2（锚级，本审 `ls-tree` 复算成立）**：harness（blob `fe2bd6b1`）不在 `170f611` 本树，出自 `9f796f0` 叠加、经 `5233e01` 接收。其形状断言（`snapshotBody:190–198` 顶层 `agentConcurrency`、无嵌套）按 blob 逐字复核成立——错树归属不错内容。本表 harness 证据按正确锚引用。
- **F3（事实级，本审逐行复核成立）**：线上 `task.changed` 帧（实时与重放同源 `broadcastTaskChanged`）字段就是 `taskState`；「样例 `taskState` vs 实现 `payload.state`」在线上帧层面不成立。真线上分歧面收窄为：**快照包络样例独有成员＋`settings.changed` 内层嵌套**。原报告「系统性写作风格」表述按此收窄；收敛结论不受影响（承重依据 prose 定性、设置端点四方同形、零消费均独立成立）。
- M1／M2（次要措辞）随 F 组登记：钉值在 `docs/product/05` :11（总览首条）；「不读任何载荷细节」对 pairing 握手帧（`stream.ready`／`stream.reset` 读 epoch/reason）不成立、task/settings 帧成立。

## 4. 水位与并发分页：已证 vs 需实际组合正反控

**静态已证（代码事实，本审复核）**：
1. 顺序纪律存在：handler 先 `readHighWatermark()`（`MAX(task_events.cursor)`，task-service :407–410）再全量翻页（limit=200 循环至无 `nextCursor`，注释明示不得静默截断）。
2. `lastEventId` 组合、响应成员清单、`wireFrom` 24 字段同形。
3. 重放语义：`replayFrom` 只服务内存 `frames` 缓冲（cursor 严格大于令牌），epoch 不符／越窗／畸形 → `reset`。
4. 观察到的写路径（retry/cancel 等）以 ops 数组同批写事件＋状态（task-service :529/:542/:593/:646/:662/:868），与「task 行版本与事件游标同事务」不变式一致。
5. 客户端零消费集合与 settings 端点同形（§2 表）。

**静态未证、需实际组合正反控（不得把静态顺序当运行正确性）**：
- 承诺 3 前半（不返回落后版本）的**充分性**依赖写侧不变式覆盖**全部**改状态路径——上列 4 只是抽样，非全路径事务核证；
- 承诺 3 后半（含水位前全部事件）的翻页**并发一致性**（walk 中新写入任务的处理）是行为论证；
- SQLite 可见性／隔离未触及；
- 客户端对样例严格形状的运行时容错、`limit=200` 截断面、epoch/token 三分支真实时序，均无运行证据。

**动态验收设计（组合树＝含 `cd08588` 服务面＋`170f611` 谱系客户端的工程接收树；全部判据可证伪，红线用注入/变异制造）：**

| # | 正控（观测） | 反控（判红方式） |
|---|---|---|
| R1 | 真实 `GET /api/snapshot` 返回恰 6 个顶层成员（`contractVersion, highWatermark, lastEventId, epoch, tasks, agentConcurrency`）；`tasks.length`＝存储内任务总数；每条目恰 §3.1 24 字段 | 在传输边界裁掉任一成员或第 25 字段 → 判红 |
| R2 | 对每任务：快照内 `version` ≥ 该任务 cursor ≤ `highWatermark` 事件的最大 `objectVersion`（无落后版本） | 注入低于水位的对象版本 → 判红 |
| R3 | `highWatermark` 观测值＝读取时刻 `MAX(cursor)`（与事件写入并发下复测） | 注入偏小水位 → R2/R4 连带判红 |
| R4 | 以 `lastEventId` 重订阅：零帧 `cursor ≤ highWatermark` 下发；(watermark, now] 帧全部补发；补发应用后客户端任务列表＝另一次全新快照读（列表一致性不变式） | 重放陈旧帧 → 客户端围栏忽略（忽略不判红；若**应用**则判红）；补发缺帧 → 列表不一致判红 |
| R5 | 种子 >200 任务（如 450）：快照 `tasks.length`＝450（无静默截断） | handler 改为单页 200 → 判红 |
| R6 | 翻页期间并发提交：每任务要么缺席（cursor>水位、走补发）要么完整；补发后终态＝新快照 | 出现撕裂/部分行或终态不一致 → 判红 |
| R7 | 旧 epoch 令牌重连 → `stream.reset`（reason=`epoch_changed`）＋快照重同步；客户端清空跨 epoch 状态、无就地合并 | 强制跨 epoch 合并路径 → 判红 |
| R8 | 畸形/越窗令牌 → `reset`（reason 逐字）＋快照路径 | 静默继续流 → 判红 |
| R9 | 传输边界按**样例形状**喂快照（无顶层并发、嵌套 settings）：`readSnapshot().agentConcurrency === undefined` 且零消费者崩溃 | 声称「样例形状功能等价」→ 此例证伪该声明；类型陷阱（TS 标 `number` 实为 undefined）如实登记 |
| R10 | 并发读回/CAS 全走 settings 端点（含 `version` CAS 409 面）；快照并发值零读取 | 任何从快照取并发/版本的消费 → 判红 |

## 5. 最小技术处置建议（交 Codex 裁定；均不自动落笔）

优先按现有公共承诺对齐：唯一需要兑现的公共承诺就是 §6 prose 五项，实际 HTTP（`cd08588`）与 R2 客户端**已逐项满足**；「无消费者」只豁免功能缺陷定性，**不豁免登记**。因此：

1. **登记（不改字节）**：manifest（`docs/reviews/web-text-intake-integration-inventory-20261110-manifest.json` 谱系，归文档接收轮）按 F1–F3 联合口径登记「快照形状按 §6 prose 承诺对齐；样例独有成员（workspace/generatedAt/嵌套 settings/快照内设置版本）按卷首样例定性处理；顶层 `agentConcurrency` 为在用读回面；`task.changed` 线上帧与样例同形、真分歧面＝快照样例独有成员＋`settings.changed` 内层」。措辞只签 prose 一致＋分歧登记，不签样例一致。
2. **动态验收**：§4 R1–R10 判据随集成轮（MAYNE-34 谱系）执行，属本卡自身要求的组合验收，不需新增 owner 审批点。
3. **客户端类型陷阱**：`WireSnapshot.agentConcurrency` 当前零消费，本轮字节不动；任何未来快照并发消费者出现时，并发值/版本必须走 settings 端点（已写入任务控制方案为必要项）——此为护栏性技术建议，Codex 可在裁定中确认或改派。
4. **若需关闭样例形状陷阱本身**（真正改变公共承诺的选择）：甲（样例成员升格必备，需升版本＋新增 workspace 实现面）／乙（反改冻结样例，被契约 :420 明文排除）／中间形态（docs-only 冻结注记）三选一。**技术推荐：中间形态**——零生产成本、消除未来消费者的形状歧义；但任何一项都改冻结材料/公共承诺，落笔权在 owner，由 Codex 裁定是否提交。

## 6. 未验项（如实列出）

- 全部 R1–R10 未运行：真实组合树 HTTP 实测本卡未执行（待 Codex 裁定后派发），本记录只有代码事实与验收设计。
- 事件信封全量审计（`task.progress`／`workspace.changed`／`recovery.changed` 样例 vs 实现逐字段）两报告与本审均未做，仅核 task.changed/settings.changed。
- 写侧不变式的全路径事务核证（§4 静态第 4 条为抽样）。
- `cd08588`／`170f611` 之上 MAYNE-24 谱系后续演化（retry/resolve 并发面、恢复权威修复 `4bf3472` 等）不在本表范围；组合树选点由 Codex 裁定时锁定。
- 本审未复跑两报告自报的 `check:docs`（只对本记录负责，见 §7）。

## 7. 证据与门禁

- 原始证据（gitignored `build/mayne32-snapshot-resume/`）：`zcode-report-cd28027.md`（受审报告原字节副本，blob 复算）、`frozen-samples-verify.txt`（三样例 SHA-256 复算＋内容）、`contract-extract.txt`（卷首/§1/§3.5/§6/§14 原文行）、`complete-i-extract.txt`/`complete-i-extract2.txt`（路由/handler/wireFrom/readHighWatermark/sse-hub 帧原文）、`r2-client-extract.txt`（F2 ls-tree、WireSnapshot/readSnapshot/applySnapshot、src/ 全 grep）、`harness-f1-extract.txt`（snapshotBody、F1 README diff）、`SHA256SUMS`。运行证据经 MAYNE-32 评论附件交付。
- 门禁：本记录为恰一新增 .md（公共索引零字节，按 F1 修正口径自述）；`npm run check:docs` 结果随评论登记；无 JS/生产改动。
