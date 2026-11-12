# MAYNE-24 s2-client 迟到取消用例真实序列化修订（OpenCode，2026-11-09）

- **范围**：接续派工 `01a1c0c8-e93c`（原派 Kimi，两次运行失败后由协调评论 `01a1c0d1-74bf` 转交 OpenCode 唯一写入）。以 `0633388ccb0a`（tree `9575344f`，OhMyPi 法定因果重写版）为待修输入，只交 `tests/unit/s2-client.test.mjs` 一个测试文件与本记录；生产、store、client、package 零改动。
- **验证输入锁定**：b5 所选前端字节 `b5fdfb9b1445`（tree `283ba665`）——协调已按 `531157f` 限定接收的 e54→b5 对照通过版。
- **序列化基准**：协调评论 `01a1c0d1` 点名的 `56cf3db`（Kimi 交付记录；其生产字节＝父提交 `cd08588`，即本分支 `0ff27bb` 独审通过的来源缓存增量树）。
- **结论**：夹具按真实序列化核定后，本文件 35/35 通过、exit 0、stderr 0 字节（初跑与恢复后终跑各一次）；三件可证伪反控与既有承重结构一致。独审请另派未参与本修订者。MAYNE-24 保持 in_progress，GAP-5／E/D／整体准出仍开放。

## 1. 待修输入的夹具事实缺陷（对照真实序列化）

协调层逐行介入指出的三处 + 本轮生成器对照新发现的两处，全部以 `cd08588` 真实序列化函数输出核定：

| # | 面 | `0633388` 夹具 | 真实序列化（cd08588 生成） | 生产出处 |
|---|---|---|---|---|
| 1 | 初始权威行 | `cancellingTask()`（v2 exiting）——仅因 mapper 把 cancelling 折叠成 running 才过 `status==='running'` 断言 | running **v2**（`attemptExitState:'active'`、`cancelIntent:false`），且用 `wireReads` 传输层事实断言钉住（cancelling 行无法产生） | `claimNext`：`UPDATE tasks SET state='running',attempt_exit_state='active',version=version+1`（task-service.mjs:859） |
| 2 | 取消响应状态 | `json()` 助手固定 status 200，所谓 202 从未实现 | 恰为 **202** `{task}`，body＝cancelling v3（`cancelIntent:true`、`attemptExitState:'exiting'`） | `cancel()`：queued→200 cancelled、running→**202** cancelling、其余 409 `state_conflict`（task-service.mjs:508-547，545 为 202 返回点） |
| 3 | needs_review 公开 failure | 线上公开 `failure:{code:'worker_lost',…,cause:'exit_unconfirmed'}` | 线上 `failure:**null`——内部信封（`normalizeFailure`＋cause）只入库不上线 | `visibleFailure`（task-service.mjs:323-334）：needs_review 仅在暂存 failed＋`exited_confirmed` 时发布，`exited_unknown` 一律 null |
| 4 | needs_review `terminalAt` | `'1970-01-01T00:00:00.005Z'` | **null**（客户端 `finishedAtMs` 随之为 null） | 冻结 001 CHECK：`state IN ('succeeded','failed','cancelled') ⇔ terminal_at IS NOT NULL`（001_web_backend.sql:50-51）；exit-unknown 迁移 SQL 不触碰 terminal_at（text-intake-service.mjs:1198-1199） |
| 5 | needs_review `cancelIntent`／version／recovery | cancelIntent:false（继承基行）、version 3、recovery 无 itemVersion/stagedResult | cancelIntent:**true**（迁移不清 cancel_intent 且 needs_review 非 TERMINAL）、version:**4**（submit v1→claim v2→cancel v3→review v4）、recovery 含 `itemVersion:1`＋`stagedResult:false` | 迁移 SQL（text-intake-service.mjs:1198）；`TERMINAL_STATES`（task-service.mjs:17）；`wireFrom` cancelIntent 组合（:298）；`recoveryFor`（:336-351） |
| 6 | 来源详情 run 行 | `run:authoritative()`（把取消意图直接写进 batch.run） | **`run:null`**——详情的 run 是来源的**已成功** run；本场景 extract 未成功 | `getSource`：`run = succeededRunId ? get(succeededRunId) : null`（text-intake-service.mjs:617） |
| 7 | `inputRef` 线上形状 | `{sourceId:'source-a'}` 最小形 | 真实 submit 形 `{configRevision,snapshot,sourceId,anchorAtMs,source:{text,timeZone,sourceAt}}`（wire 原样发布 inputRef） | `submitSource` input 组装（text-intake-service.mjs:469-485）＋ submit INSERT（task-service.mjs:434-446）；`wireFrom` `inputRef:internal.inputRef`（:301） |

客户端侧随之修正的断言：needs_review 经 b5 `toModelRun` 映射为 `status:'interrupted'` 且 `errorCode = failure?.code ?? null` ＝ **null**（web-api-client.ts blob `e730d4a3` :885）——原稿断言的 `errorCode==='worker_lost'` 在真实线型下不可成立。`MCP_RESULT_UNKNOWN` 原生 sentinel 的既有领域覆盖在其他用例中原样保留，本轮未触碰。

## 2. 真实序列化样本的生成（仅准备阶段）

- `git archive cd08588` 提取 `server/`＋`shared/` 到运行树外目录，生成器 `build/mayne24-s2client-fixture-r1/generate-fixtures.mjs` 直接 **import 真实生产模块**（`TaskService`/`TextIntakeService`/`normalizeFailure`/`TERMINAL_STATES`/`FAILURE_REGISTRY`），以镜像引用迁移 SQL 的原始 DB 行喂真实 `rowToInternal`→`wireFrom`（内部调用真实 `visibleFailure`/`visibleResult`/`recoveryFor`），sourceWire 用真实 `sourceWire()`。**未复制任何生产转换逻辑充当 oracle**；时间线钉在 1/2/3/4 ms。
- 生成器内置合法性交叉断言：`FAILURE_REGISTRY.MCP_RESULT_UNKNOWN === undefined` 且 `normalizeFailure({code:'MCP_RESULT_UNKNOWN'}).code==='worker_lost'`；`needs_review ∉ TERMINAL_STATES`；`visibleFailure/visibleResult` 对 exited_unknown needs_review 返回 null；recovery 恰为 `{cause:'exit_unconfirmed',sideEffectKnown:false,autoResume:false,reason:null,receipts:[],itemVersion:1,stagedResult:false}`。输出 `samples.json`（四行线型＋来源行＋内部信封），SHA 见 SHA256SUMS。
- unit 本身零新增前置：修订后的用例只接收生成字面量，不 import server/、不起 Rust/Pi/打包。

## 3. 保留与修改（相对 `0633388`）

- **保留**：真实接线（进程隔离 Pinia `useOrganizer`→`asBackend()`→全局 `fetch`）、合法时序方向（初读 running→POST 到达即捕获并延迟 202→确认到达后 refresh 读较新 needs_review→交还旧响应）、run/batch.run 双断言、读取失败隔离（post-cancel refresh 以已披露读取失败防权威行回读掩蔽）、POST 取消、Pinia／window／fetch 全局恢复、`assert.throws(useOrganizer,/no active Pinia/)` 前后夹持。
- **修改**：上表 7 项夹具事实；`json()` 助手改 `(status,body)`；新增 `cancelArrived` deferred（派工点名的"确认请求已到达后"确定性顺序）；新增 `wireReads` 传输层日志并断言其逐项事实——初始两次读取恰为 `running`/v2、refresh 消费 `needs_review`/v4、取消响应恰为 `{status:202,state:'cancelling',version:3}`。状态断言从此不依赖 mapper 折叠：running 与 cancelling 两线型在 `wireReads` 事实（version/attemptExitState/cancelIntent）上可区分。

## 4. 验证（b5 前端字节 overlay，限定范围）

- 运行树：`git worktree add --detach`（HEAD `6fad178f`）＋ overlay b5 五文件（`git checkout b5fdfb9 --`，blob 逐项 MATCH：ModelSettingsPanel `0216921e`、TaskQueue `1bd5d476`、TextIntake `b6c1897d`、web-api-client **`e730d4a3`**＝`531157f` 已审登记 blob、organizer `d4b824cb`）；`npm ci --ignore-scripts` exit 0。
- 命令（沿 `test:s2-domain` 中本文件的注册预算）：`node --test --test-reporter=tap --test-timeout=15000 tests/unit/s2-client.test.mjs`
  - 初跑：**tests 35 / pass 35 / fail 0，exit 0，stderr 0 字节**（`file-regression.tap`）；与 `0633388` 登记的 35 例计数一致。
  - 反控后恢复重跑：同上全绿（`file-regression-final.tap`），恢复后 `organizer.ts` blob 复核 `d4b824cb`＝b5。
- 可证伪反控（在运行树临时改 b5 `organizer.ts`，各一次后恢复；不重复旧 14 件矩阵）：

| 反控 | 突变 | 本例结果 | 承重归属 |
|---|---|---|---|
| CC1 | 同时删 mutation generation 守卫＋acceptRun no-resurrect 子句 | **红**（本例恰落"迟到取消不得覆盖较新权威态"命名断言；另有 5 个自身依赖被删子句的既有用例连带红：#15/16/23/24/27，逐件见 `cc1-both-deleted.tap`） | 本例可证伪、非空洞 |
| CC2 | 仅删 no-resurrect 子句 | **绿** | generation 围栏独立承重 |
| CC3 | 仅删 generation 守卫 | **绿** | no-resurrect 子句＋读取失败隔离独立承重 |

- 边界：未跑完整 gate、未跑聚合 `test:web-text-intake`、未跑旧 14 件矩阵、未跑 check:structure（本轮仅测试文件与 docs；`check:docs` 见下）；本分支自有（集成前）前端字节上不断言——验证输入按派工锁定 b5，属既存缺口登记不新增。
- `check:docs`：exit 0（22 文件 576 链接，含本记录与索引行）。

## 5. 记录与历史

- `8aaf8c5`（OhMyPi 撤回＋修法 B 记录）与 `3ee282e`（Kimi 夹具线型不通过独审）的全部历史结论**保留不改写**；本轮在其上追加：接手、真实序列化核定事实（§1 表）、生成与验证（§2–4）。
- 原始证据（gitignored `build/mayne24-s2client-fixture-r1/`）：生成器与 `samples.json`、两次全绿 TAP、三件反控 TAP、npm-ci 日志；精选件随协调评论附件交付（SHA256SUMS 覆盖）。
- 后续：独审另派未参与本修订者；s2-client 修订线就此收口，其余已派工作不受影响。
