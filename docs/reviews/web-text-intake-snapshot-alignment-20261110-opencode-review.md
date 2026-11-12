# 快照形状对齐核对报告独审（MAYNE-24，2026-11-10，OpenCode）

- **受审对象（锁定）**：`cd28027a0804a5c34c9089636e8a39745ce50ff9`，恰两文件——`docs/reviews/web-text-intake-snapshot-alignment-20261110-zcode.md`（blob `2c5db33a…a696`，15439 字节，97 行）＋`docs/reviews/README.md`（numstat 2+/1−：索引计数 123→124、新增一行）。作者 ZCode，本审未参与撰写，作者/评审者分离。
- **任务来源**：协调层派工（评论 `01a1c252-5914-7789-a1be-719d9c9aeea1`）：只读独审该文件，重点判断 §6 样例引用与卷首定性赋予的约束、扁平形状＋无消费者的兼容结论边界、先读水位再分页的静态顺序证明面、P1 是否真排除 workspace 成员；逐树核对来源锚；事实/解释/建议验收/未验项分开。
- **审性质**：纯只读。不改生产、样例、原报告、公共索引；本记录为本分支恰一新增文件。未跑聚合、构建、19 旅程、完整 gate。
- **结论速览**：**通过（限核对与解释面）**。原报告的来源身份、逐字段对照、P1 未细化判定、收敛判定与甲/乙交回裁定的分界，全部经本审独立复算成立。登记三项发现：**F1**「公共索引零字节」叙述与同一提交的 README 增量自相矛盾（报告内部两处互相冲突）；**F2** harness 锚树归属错误（`fe2bd6b1` 不在 `170f611` 本树）；**F3** §6.4 第二例证（task.changed「样例 `taskState` vs 实现 `payload.state`」）在客户端可见线上帧层面不成立。三项均不推翻原报告实质结论，但其修正须随本记录进入后续登记与验收措辞，不得单引原报告。

## 1. 事实：独立复核成立的部分

### 1.1 来源身份（本审全部独立复算命中）

- W0 冻结钉值为 SHA-256 口径，对 `cd08588` 处字节复算精确命中：web-api/1 契约 `61863271…f58d`、001 DDL `8511907c…143d`——无冻结后漂移。
- 契约 blob `6943151e…` 与快照样例 blob `d148bec3…` 在全部受审树（`b190f7c`／`cd08588`／`170f611`／`9f796f0`／`5233e01`，本审另加 `9d52086`／`cd28027`）逐树 `git ls-tree` 全同。
- 三个冻结样例 SHA-256 独立复算全中：快照 `d63672fd…28eb`、设置 `525d9447…4c4a`、事件 `c22b65e1…f373`。
- 钉值登记位于 `docs/product/05` 总览首条（**:11 行**，非文件字面第一行——原报告「第一行」定位不精确，内容无误，见 §2 M1）。

### 1.2 契约 prose 承诺逐字在文

§6 补偿规则行（:250）逐字含：带 `highWatermark` 的全量快照、任务条目与 §3.1 **同形（全字段）**、不得返回落后于高水位的对象版本、客户端以 `lastEventId`（`<epoch>:<highWatermark>`）重新订阅；§1（:10）逐字含「任务资源、事件、快照与错误包络均携带 `contractVersion`」。§6 prose 未点名：epoch 是否独立快照成员、`agentConcurrency` 层位、`workspace`／`generatedAt`／快照内设置版本——原报告 §2 清单精确。

### 1.3 样例成员与逐字段对照表逐列核实

- 快照样例（`d63672fd`）确实独有：顶层 `epoch`、`generatedAt`、嵌套 `settings:{agentConcurrency, version}`、`workspace{mode/currentRoot/capabilities/recovery}`、`note`；两条任务条目各恰 24 字段，与 §3.1 全集一致。
- 设置样例（`525d9447`）扁平 `{contractVersion, agentConcurrency, default, version, runningCount, queuedCount}`＝§5 prose 枚举逐字吻合——冻结样例集内嵌套块确为孤例（全 fixtures 目录核查）。
- 事件样例（`c22b65e1`）`task.changed` 用 `taskState`、`settings.changed` 用嵌套 `setting:{agentConcurrency}`——§6 正文内联示例同样用 `taskState`（:230–234）。
- 完整 I `cd08588`：`/api/snapshot` 路由在 `http-server.mjs:161`；handler :853–879 先 `readHighWatermark()`（= `MAX(task_events.cursor)`，task-service :407–410）再 limit=200 全量翻页，响应恰 `{contractVersion, highWatermark, lastEventId: \`${epoch}:${highWatermark}\`, epoch, tasks, agentConcurrency}`——顶层 `agentConcurrency`、无版本/嵌套/workspace/generatedAt；settings GET 在 :832 原样透传扁平 `readConcurrency()`；`wireFrom`（task-service :280–306）恰 24 字段、`progress` 恒 null。
- R2 `170f611` 客户端：`WireSnapshot`（web-api-client.ts :189–196）顶层 `agentConcurrency: number`；`applySnapshot`（organizer.ts :84–101）只读 `snapshot.epoch`/`snapshot.highWatermark`/`snapshot.tasks`；**全 src/ 无过滤 grep**：`agentConcurrency` 仅出现在 web-api-client.ts 5 处（类型×3＋透传＋settings 方法）——`WireSnapshot.agentConcurrency` 下游零消费者成立；settings CAS 走扁平 settings 端点（:683–690）。

### 1.4 P1 未细化（原报告 §5 成立）

P1 `b190f7c` 对快照的全部文本＝两处委托（契约 :136「冻结 §6；任务条目同形」、:222「任务帧沿用冻结 §6」）＋ §5.4 store 读目标行（:181 `SELECT tasks／task_events／settings`，query 类）；R3 差分（b190f7c 对父提交）对 snapshot/快照全部命中恰 2 处，均为 §4.2/§13 重写中保留的「不返回旧对象快照」重放语义措辞——**零快照包络形状文本**。

## 2. 事实：三项登记发现与两处次要措辞

### F1（登记级）：「公共索引零字节」叙述自相矛盾

原报告「性质与边界」写「不改公共索引（**README／manifest 本轮零字节**）」，同报告 §10 又写「本记录为**恰一新增 .md＋README 索引行**」；提交说明同句先列「README index 123->124」再称「zero … index-byte changes」。**事实**：`cd28027` numstat＝README 2+/1−（计数 123→124＋新行）、报告文件 97+；生产/冻结材料/样例/fixture/manifest 确为零字节。**修正口径**：「生产/冻结/样例/fixture/manifest 零字节；`docs/reviews/README.md` 为登记性增量」。README 新行内的「（零字节改动）」措辞同此修正。按事实登记；后续接收不整枝、只取已审文件。

### F2（锚级）：harness 树归属错误

原报告 §1 来源表把 `tests/fixtures/web-text-intake/sse-client-harness.mjs`（blob `fe2bd6b1`）列在 R2 `170f611` 锚下。`git ls-tree` 证明该路径在 `170f611`（及 `b190f7c`/`cd08588`）**不存在**；blob `fe2bd6b1` 仅存在于 `9f796f0`（黑盒作者树）与接收后谱系 `5233e01`/`9d52086`/`cd28027`。harness 的形状断言（`snapshotBody` 顶层 `agentConcurrency`、无嵌套 settings/workspace/generatedAt，:190–198）按 `9f796f0` blob 逐字复核**成立**——只错树归属，不错内容。§1 五树 blob 全同声明明确限定于「冻结材料」，范围无误。正确锚：「harness 出自 `9f796f0` 叠加、经 `5233e01` 接收，非 `170f611` 本树文件」。

### F3（事实级）：§6.4 第二例证在线上帧层面不成立

原报告 §6.4：「`task.changed` 样例 `taskState` vs 实现 `payload.state`」。本审核出：客户端可见帧（实时与重放）均由 `sse-hub.broadcastTaskChanged`（`cd08588` sse-hub :137–155）发出，字段名就是 **`taskState`**（:147；调用点 task-scheduler.mjs:75 `taskState: task.state`）；重放只从内存 `this.frames` 缓冲服务（replayFrom :99–108），持久 `task_events` 行的 `payload:{state}`（task-service :529/:542/:593/:646）只用于 `MAX(cursor)` 水位，**从不下发**。故线上 `task.changed` 帧与样例及 §6 正文内联示例**同形**——该事件上不存在「样例 vs 实现」的线上分歧；`payload:{state}` 是内部持久行形状。**影响**：收敛依据④的第二个例证不成立；settings.changed 半边（样例嵌套 `setting` vs 实现扁平 `agentConcurrency`，sse-hub :187）仍成立且是真线上分歧。「样例分歧是系统性写作风格」须收窄为：已证实的线上分歧面＝快照包络样例独有成员＋settings.changed 内层。整体收敛结论不受影响——其承重依据（§6.1 prose 定性、§6.2 设置端点同形、§6.3 零消费）全部独立复核成立；「客户端把帧当提示」独立成立。

### M1／M2（次要措辞，随 F 组登记）

- M1：§1「`docs/product/05` 第一行」——钉值实际在 :11（总览首条）；内容无误。
- M2：§6.4「不读任何载荷细节」稍宽——pairing 对 `stream.ready`/`stream.reset` 读 payload 的 epoch/reason（握手帧）；task/settings 帧的载荷细节确实不读。实质（task/settings 帧纯提示）成立。

## 3. 解释：派工四个问题的独立判断

### Q1 §6 样例引用＋卷首定性赋予哪些约束

卷首（契约 :5）明文「样例用于**评审契约形状**，不是可运行服务或实测报文」——定性为评审辅助，并明确否认样例是实测报文。契约全部样例引用均为括号式辅助（:41、:220、:235、:250 等），每处形状承诺由 prose 自身枚举。§6 prose 点名承诺之外，样例成员不构成义务——**但须如实登记边界**：契约没有一条显式的「prose 与样例冲突时以 prose 为准」条款；prose-first 是由卷首定性＋引用实践＋两条总则共同推出的**解释**，不是逐字条款。两条未被原报告引用、本审补充的总则进一步锁死处置分界：§3.5（:121）「客户端不得依赖所在取值未声明的字段」；§14「实现与契约不一致按缺陷处理，**不反向改契约迁就实现**」「新增可选字段按兼容变更处理」。据此：即便采最严解读（样例即形状），「乙」（反向改样例）也被 §14 明文排除；「甲」（升格必备成员）属规格变更，须按 §1/§14 升版本并在冻结记录说明。样例并非全无分量：其 vocabulary（顶层 epoch、lastEventId、tasks）与 prose 全部相容，分歧仅限**多余成员**——是「超出 prose 承诺」而非「与 prose 冲突」，原报告 §6.1 定性准确。

### Q2 扁平形状＋无消费者能否支持兼容结论

**在「当前消费者集合」域内成立**：零消费已穷尽复核（§1.3）；organizer/pairing/TaskQueue 均不读快照并发值；设置 CAS 走扁平 settings 端点（prose、样例、实现、客户端四方同形）。原报告措辞已自限「当前」，§9 已登记静态读码性质——边界如实，未宣布差异关闭。须随行的三个边界：(a) 若服务端严格按样例返回，`WireSnapshot.agentConcurrency` 运行时为 undefined 而 TS 类型仍写 `number`——对**未来**消费者的潜在类型陷阱（原报告已提「类型声明与 wire 不符」）；(b) 结论是时点性事实，任何新增快照消费者立即改变前提，故「并发/CAS 一律走 settings 端点」是必要护拦而非可选建议（§7.5 应作必要项执行）；(c) 集成轮真实 HTTP 验收前，证据等级是「代码事实」非「实测事实」。

### Q3 先读水位再分页的静态顺序证明什么

**静态已证（代码事实）**：顺序纪律存在（水位先读、:853–879 handler 注释自引冻结 §6）；全量 walk（limit=200 循环至无 nextCursor，注释明示不得静默截断）；`lastEventId` 组合逐字符合承诺 4；响应成员清单。**静态依赖但未证（运行时剩余）**：承诺 3 的两半——(a)「不得返回落后版本」的充分性依赖写侧不变式（task 行与 task_events 游标同事务提交、版本单调）；本审观察到 retry/cancel 等路径以 ops 数组同批写事件＋状态（task-service :529/:542/:593/:646），与不变式一致，但「全部写路径」的事务性核证不在原报告范围，其「顺序正确，承诺 3 成立」应理解为**设计级**结论；(b)「包含水位及之前全部事件」的完整性在全量 walk 下成立，但并发写入下的翻页一致性（walk 中新任务＞水位、由重放覆盖）是行为论证；(c) SQLite 可见性/隔离未触及。**判定**：静态顺序证明「设计上按承诺 3 组织读取」；运行时成立须集成轮真实 HTTP 验收（§7.4 建议判据方向正确）。此拆分应随验收判据进入登记。

### Q4 P1 真排除还是仅未细化

**仅未细化（沉默）**。P1 快照文本＝两处委托＋§5.4 读目标行；R3 差分零形状文本（§1.4）。§5.4 是读目标/权限分类行，不含 workspace 是「计划实现无数据源」的**佐证**（相互印证），不是规范排除——原报告「暗示…相互印证」措辞恰当；§3 表 P1 列用「—」编码沉默，准确。样例成员的规范地位至今＝「样例独有、prose 未承诺、未被任何后继文本细化或排除」。

## 4. 建议验收与最小处置（既有授权内，本轮均未写入）

1. **登记口径**（留给 manifest/文档接收轮）：采原报告 §7.3「prose 一致＋分歧登记」，并附加本审三条修正——F1 按「README 登记性增量」表述（弃用「公共索引零字节」）；F2 按「harness 出自 `9f796f0` 叠加、经 `5233e01` 接收」表述；F3 按「task.changed 线上帧与样例同形（taskState）；`payload:{state}` 仅为持久行内部形状」表述。后续引用以「原报告 cd28027＋本审修正」联合口径，原报告本体不改。
2. **集成轮验收判据**（另派轮执行）：断言 prose 五项承诺＋承诺 3 的运行时拆分（写侧事务不变式以读序观测、全量 walk 完整性）；不断言样例独有成员、不断言嵌套 settings（确认原报告 §7.4）。
3. **任务控制方案**（本审者此前交付 `9d52086`）：维持「并发读回/CAS 走 settings 端点、不从快照取并发或其版本」——与原报告 §7.5 一致，实施时按必要项执行。
4. **接收纪律**：涉及 `cd28027` 谱系的后续接收只提取已审文件，不整枝合并（与协调层派工口径一致）。

## 5. 须交 owner 裁定的公共承诺变化

与原报告 §8 相同的两项及可选中间形态，本审无新增；按 §14 补强后分界更稳固：**乙**被契约文本明文排除（不反向改契约迁就实现）；**甲**属规格变更须升版本/冻结记录说明。甲/乙均不启动（与协调层口径一致）。

## 6. 未验项

- 真实组合树 HTTP 实测（承诺 3 运行时拆分三项：写侧不变式×全部路径、翻页完整性、可见性）。
- 事件信封全量审计（task.progress/workspace.changed/recovery.changed 等其余事件的样例 vs 实现逐字段）——原报告与本审均只核 task.changed/settings.changed 两处。
- R2 客户端对严格样例形状的运行时容错（静态结论，§9 原报告已登记）。
- 原报告自报的 `check:docs` exit 0 未由本审复跑（本审只对自己新增记录负责，见 §7）。

## 7. 边界与证据

- 只读独审；本记录为本分支恰一新增文件；生产/样例/原报告/公共索引零字节；未跑聚合、构建、19 旅程、完整 gate。
- 证据（gitignored `build/mayne24-snapshot-alignment-opencode-review/`）：`identity.txt`（七树 blob＋五项 SHA-256 复算）、`diff-cd28027.patch`（受审提交全文差分）、`contract-extract.txt`（卷首/§3.1/§5/§6 原文）、`complete-i-extract.txt`（路由/handler/settings 帧/持久行 payload/replayFrom/wireFrom/readHighWatermark/readConcurrency 原文）、`r2-client-extract.txt`（WireSnapshot/readSnapshot/applySnapshot＋无过滤 grep）、`harness-extract.txt`（七树存在性＋snapshotBody）、`p1-extract.txt`（三处锚行＋R3 差分计数）；摘要经评论附件交付。门禁：本记录新增后跑 `npm run check:docs`（结果随评论登记）。
