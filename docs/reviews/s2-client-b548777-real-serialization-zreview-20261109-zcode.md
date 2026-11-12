# MAYNE-24 s2-client 修订 `b548777` 限定点检独审（ZCode，2026-11-09）

> 派发：协调评论 `01a1c0f3-6209`（Codex）。评审人未写该测试（本审者既有 MAYNE-24 提交为 receipts-restart 测试线、来源缓存/T-2/T-10 审与工程接入审记录），在前项工程审完成后作本限定点检。判据：以锁定 `cd08588` 实际序列化为准，不把旧审对来源 run 的假定带入新判据。不重跑旧 14 件矩阵／Web 聚合／完整 gate，不改候选或生产。记录 docs-only 恰 1 文件（本分支惯例：不另动 README 索引）。

## 结论（分别）

- **夹具（fixture）面：通过。** 四条任务线型（queued v1 上下文／running v2／cancelling v3／needs_review v4）与来源线型逐字段 `deepEqual` 生成样本（24 键×4＋9 键）；四项特别核全部成立：真实 running 初读（v2/`active`/`cancelIntent:false`＋`wireReads` 传输层 `deepEqual`）、实际 **202** `{task}`（cancelling v3 体）＋`cancelArrived` 先于 refresh、exited_unknown 的 wire `failure:null`／`terminalAt:null`（冻结 001 CHECK）／recovery（`exit_unconfirmed`＋`itemVersion:1`＋`stagedResult:false`）、来源详情 `run:null`（真实 `getSource` 仅回 `succeededRunId` 的 run——`text-intake-service.mjs:615`）。原始行满足 001 迁移全部 CHECK（状态注册表／version≥1／exit_state 注册表／`result_pending_exit`–`pending_outcome` 配对／非终态 `terminal_at` NULL）；版本链 v1→v2→v3→v4 与生产 SQL 逐条对上（submit INSERT v1、claimNext `state='running',attempt_exit_state='active',version=version+1`、cancel `state='cancelling',cancel_intent=1,attempt_exit_state='exiting',version=version+1`＋HTTP 202、exit-unknown `attempt_exit_state='exited_unknown',state='needs_review',failure=?,version=version+1` 不触 `terminal_at`／`cancel_intent`＋同事务 `recovery_items` v1 pending）。
- **生成器（generator）面：通过。** `generate-fixtures.mjs` 确实 import 锁定 `cd08588` 的真实生产模块（`TaskService` 的 `rowToInternal`/`wireFrom`/`visibleFailure`/`visibleResult`/`normalizeFailure`/`FAILURE_REGISTRY`/`TERMINAL_STATES`＋`TextIntakeService` 的 `sourceWire`/`rowToSource`；storage 为纯序列化 stub，`command()` 直接 throw）。本审从对象库另行 `git archive cd08588` 提取后独立复跑：**exit 0、输出与作者 `samples.json` 逐字节相同**（SHA-256 `199649fa…6539` 两边全等），内含 4 条 registry/state 合法性断言亦通过。生成器注释所引 5 处迁移/转换 SQL 与生产字节逐条相符；unit 零新增前置（只收生成的字面量）。
- **接线因果（wiring）面：通过。** 相对待修 `0633388` 的差异**恰在末例内**（两文件第 1–142 行 `cmp` 逐字节相同，四 hunk 全部 ≥143 行＝最后一个 `test(`；其余用例含原生 `MCP_RESULT_UNKNOWN` sentinel 覆盖零字节触碰）；b5 五文件 overlay 逐 blob＝`b5fdfb9` 登记（ModelSettingsPanel `0216921e`／TaskQueue `1bd5d476`／TextIntake `b6c1897d`／web-api-client `e730d4a3`＝已审 `531157f` blob／organizer `d4b824cb`）；真实接线确认为 store 源码事实（`useOrganizer=createOrganizerModel(getWebApiClient().asBackend(),…)`，无 `__TAURI_INTERNALS__` 即走 web 管）；传输层断言在位——`wireReads` 事实三连（list+detail 必须消费 `running`/v2、detail 消费 `needs_review`/v4、cancel-response 必须 `{status:202,state:'cancelling',version:3}`），URL 别名由穷举匹配＋未知路径 throw 钉死，`/api/tasks/A/cancel` 真实 POST 断言显式在位；`run`／`batch.run` 断言为「不被旧响应伪造出 run」（与真实 `getSource` 发布条件一致）；读取失败隔离（post-cancel refresh 合成 outage）保留且如实披露；Pinia／window／fetch 全局恢复与前后 `no active Pinia` 夹持保留。
- **证据面：通过。** 作者 10 附件经 CLI 重下载对登记 `SHA256SUMS` 全 OK（另有 2 项为其自身工作树绝对路径，本审改为对 git blob 复算全等：测试内容 SHA-256 `e87ecbfc…3214`、记录 `d18974f4…b495`）；沿原 15s 预算本文件一次回归 **35/35 PASS、exit 0**（wall 0.16s，总 137.9ms，TAP 与作者初跑仅 duration 差异）＋反控恢复后终跑再绿（stderr 0 字节）；三反控全部复现且目标断言精确命中（见 §3）；恢复后五 overlay＋测试六文件 blob 全部回到登记身份（`恢复后字节` ✓）。「一层删除仍绿」确系冗余承重（CC2 由 generation 围栏、CC3 由 no-resurrect 子句＋读取失败隔离各自独立承重），与登记口径一致，不再要求强打原生 sentinel 分支。

**总判定：`b548777` 通过——限「s2-client 末例夹具真实序列化＋接线＋本文件回归与三反控」面。** 不构成真实后端 E2E／原生运行验收（HTTP 响应仍是私有 fetch 夹具）；不作聚合准入与整体准出。

## 1. 身份与锁定（对象库直读）

- 候选 `b54877796ddf08c0c02f382d351587e82e8f86dc`／tree `bdc3692f089ef50b58482c08608894f582bee799`／父 `6fad178f0ee7c14170d6ab456da596d8c17b4656` ✓；记录提交 `923ef54`（恰 2 文件：记录 56 行＋README 索引 144→145）✓。
- `6fad178..b548777` numstat 恰 `tests/unit/s2-client.test.mjs` 136+/6−；生产／store／client／package／锁零触碰 ✓。
- 待修输入 `0633388`（tree `9575344f`）vs `b548777`：93+/62−，**全部位于第 143 行起的末例**（第 1–142 行逐字节相同）✓。
- 序列化基点 `cd08588`（tree `776b2529`）；b5 字节 `b5fdfb9`（tree `283ba665`，父 `e54c273`）。
- 工具链：node v24.20.0、npm 12.2.1；运行树审后 `git worktree remove` 清净。

## 2. 生成器与夹具——逐字段核验

- **独立复跑**：`git archive cd08588 server shared` 提取至本审 `prod-cd08588/`，作者生成器原样置于其相对位置运行：exit 0、stderr 0、输出与 `orig/samples.json` **逐字节相同**。
- **生产转换实读**（`cd08588` 字节）：`rowToInternal` 21 列序＝生成器 raw-row 注释序＝`SELECT_TASK` 序；`wireFrom` 的 `cancelIntent: internal.cancelIntent===1 && !TERMINAL_STATES.includes(state)`（needs_review 保持 true）；`visibleFailure` 对 `exited_unknown`（非 staged-failed-confirmed 形态）返回 null；`recoveryFor` exited_unknown 分支产出恰 `{cause:'exit_unconfirmed',sideEffectKnown:false,autoResume:false,reason:null,receipts:[],itemVersion:1,stagedResult:false}`；`sourceWire` 9 键与测试 `sourceRow()` 全等（fingerprint＝合成原文 SHA-256，由生成器实算）。
- **迁移约束**：001 `tasks` 表 CHECK 全部满足（含 `state IN (...8 值)`、`terminal_at` 与终态互斥、`result_pending_exit/pending_outcome` 配对）；exit-unknown 分支 SQL 原文与生成器注释一致且不改 `cancel_intent`/`terminal_at`。
- **逐字段比对**：本审比对脚本将测试夹具字面量（`taskRow` 三实例＋`sourceRow`）对生成样本 `deepEqual`——4/4 PASS（任务行 24 键、来源行 9 键）。
- **非阻断观察**：测试的列表／详情／取消 envelope（`{tasks,…}`／`{task}`／`{source,run,…}`）未带真实 http-server 的顶层 `contractVersion` 字段；b5 客户端对 envelope 顶层版本无运行时校验（类型声明有、解析不查），夹具行内 `contractVersion:'web-api/1'` 在位。不影响本例断言与合法性判定，登记为 envelope 形状偏差观察。

## 3. 回归与三反控（15s 预算内，运行树独立复建）

运行树＝`git worktree add --detach … 6fad178`＋b5 五文件 overlay（checkout 后逐 blob 复核）＋`git checkout b548777 -- tests/unit/s2-client.test.mjs`；`npm ci --ignore-scripts` exit 0。逐字命令 `node --test --test-reporter=tap --test-timeout=15000 tests/unit/s2-client.test.mjs`。

| 项 | 本审结果 | 与作者登记对照 |
|---|---|---|
| 正常回归（初跑） | **35/35 PASS、exit 0**，wall 0.16s／TAP 总 137.9ms ≪ 15s | 与 `file-regression.tap` 仅 duration 差异 |
| CC1 两子句同删（mutation generation 守卫＋acceptRun no-resurrect） | exit 1，29/6——红恰 #15/16/23/24/27/**#35**；#35 恰落在命名断言（actual `running` ≠ expected `interrupted`） | not-ok 集合逐项相同 |
| CC2 仅删 no-resurrect | exit 1，32/3——红恰 #15/16/27（依赖该子句的既有例），**#35 绿**（generation 围栏独立承重） | 与作者 cc2 TAP 仅 duration／绝对路径差异 |
| CC3 仅删 generation 守卫 | exit 1，33/2——红恰 #23/24（依赖围栏的既有例），**#35 绿**（no-resurrect＋读取失败隔离承重） | 与作者 cc3 TAP 仅 duration 差异（本审首次尝试即复现该面） |
| 恢复 | `git checkout b5fdfb9 -- src/stores/organizer.ts` 后 blob＝`d4b824cb`＝b5；终跑 **35/35 PASS、exit 0、stderr 0 字节** | 与「两绿 TAP＋恢复后字节」登记一致 |

反控仅以临时 perl 精确删子句作用于本审自有运行树副本；三反控后六文件全部回到登记 blob（无泄漏）。「一层删除仍绿」的冗余解释成立，无需强打原生 sentinel 分支（原生 sentinel 覆盖在既有用例 #13/14/26 内未被触碰，见 §1 第 142 行一致性）。

## 4. 证据链

- 作者附件 10/10 对其 `SHA256SUMS` OK（`admission-identity`／生成器／samples／两绿 TAP／三反控 TAP／record-copy）；其 2 项绝对路径条目改以对象库 blob 复算全等。
- 本审原件：gitignored `build/mayne24-s2client-b5-zreview/`（`orig/` 重下载件＋`SHA256SUMS-zreview` 16 项、独立复跑 `samples-zreview.json`、`generate-fixtures-zreview.mjs`、`fixture-compare-zreview.mjs`、两绿 TAP、三反控 TAP、npm-ci 日志、`prod-cd08588/` 提取、`work/` 三版测试文件与 diff）；精选件随评论实际挂载。
- `check:docs` 随本记录提交登记；未跑完整 gate／聚合／旧矩阵／check:structure（恰为登记外范围）。

## 5. 边界与不签范围

- HTTP 响应仍为私有 fetch 夹具：结论不扩成真实后端 E2E、原生运行或浏览器验收；`cancelArrived` 时序为受控 deferred，非真实网络延迟分布。
- envelope 顶层 `contractVersion` 缺失为非阻断观察（§2）；不因此改候选。
- 不作聚合准入、不作 III 集成代签、不预签整体准出；GAP-5／E/D／第五例（Pi 线）各走原线。
- 候选与生产零改动；MAYNE-24 保持 `in_progress`。
