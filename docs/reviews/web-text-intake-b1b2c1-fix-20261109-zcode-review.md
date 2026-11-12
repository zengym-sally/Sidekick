# II B1/B2/C1 测试候选 `45b1cfe` 限定独审（ZCode，2026-11-09）

- 审阅人：ZCode（未参与该实现；实现者为 Pi，独审对象为 B1/B2/C1 修改面与其聚焦证据面）。
- 派发：`01a1bed3`（2026-11-09T05:41:56Z）。边界：限定独审 B1/B2/C1 修改面；核预算绑定、七项故障断言未弱化、去重身份约束、合法 stale／非法 current 两路隔离；聚焦复跑 T-2/T-8，不重跑全套；B2 保留的锚点断言若在 C4 分歧下成为 `undefined===undefined`，标注不能证明锚点保持、不以该绿代签；交明确通过／不通过与范围。不改测试／生产／Runtime，不跑完整 gate。
- 结论速览：**修改面通过（限定）**。四项判据全部核过成立；聚焦复跑 after（候选字节）T-2＋T-8 **2/2 过**、before（`7f3322b` 字节、同一生产字节）**0/2 败**，翻转可归因于恰这两文件差异。**锚点断言按派发要求标注：在当前生产链上为 `undefined===undefined` 空真，不能证明锚点保持，本审不以该绿代签锚点面。**

## 1. 身份与范围（对象库逐字节复核）

- 候选 `45b1cfeec397001aef2092a4fe1e9a259a891995`／tree `b6af1ae7cd6e7bc4be01c0f42b31fb606ce2f166`，父链 `7f41f8f`→`0a7ad437`，与登记一致。
- **改动前基线导入可证**：`7f41f8f` 的两套件 blob（`3fe17f58`／`58ede62f`）与 `7f3322b:` 下同名文件 `git rev-parse` 逐字节相同——基线确为 `7f3322b` 原字节，修复增量可精确隔离。
- 修复面 `7f41f8f..45b1cfe` 恰两文件：cm `3fe17f58`→`4d9556b2`（+3/−0）、http `58ede62f`→`1bf522b8`（+30/−2），合计 +33/−2，与登记逐字吻合。
- **范围说明（登记口径澄清，非缺陷）**：`git diff 7f3322b 45b1cfe` 全树差异远大于两文件——两分支基座不同（Pi 分支只携带两套件文件、不携带 II 夹具集；`7f3322b` 分支携带五件 II 文件、不携带彼此的其余文件）。登记的「恰两文件 +33/−2」指套件文件面的差异，逐字节成立；候选的真实修改内容以 `7f41f8f..45b1cfe` 为准，即上述恰两文件。

## 2. B1（cm `4d9556b2`）：预算绑定 ✓、七项断言未弱化 ✓

- 唯一改动为 `runFaultCase` 开头插入 `const deadline = caseDeadline();`（+3/−0，含两行注释）。
- 预算语义与套件既有约定逐字一致：`caseDeadline = () => Date.now() + CASE_BUDGET_MS - CASE_MARGIN_MS`＝+18000ms（冻结 20000ms/例，`node --test --test-timeout=20000` 的 W1 值；margin 2000ms）。套件内其余每例同模式（:175/:201/:241/…），修复只是把 `runFaultCase` 补进同一纪律。唯一消费点是 `pollUntil(…, { timeoutMs: waitWithin(deadline, 10000) })`——10000ms 是可诊断性 backstop，且被剩余预算钳制。**未放大冻结预算**（18000 < 20000 外层上限）。
- **七项故障断言逐字节未动**：diff 全部 hunk 仅该插入；七项判据（`state==='failed'`、failure 信封存在、`FROZEN_FAILURE_CODES` 注册表隶属、retryable 字符串、逐例 `expectations` 回调、无候选落库 deepEqual、源保留、`attempt_exit_state==='exited_confirmed'`）与七个调用点（model 401/429/500、stream break、unreachable service、invalid output、action with followup）全部与基线 blob 相同。基线等价性由 §1 的 blob 恒等保证，非逐行目测。

## 3. B2（http T-8）：去重身份约束 ✓；锚点断言标注 ✗ 不代签

- `deepEqual(dedup.json.task, first.json.task)` 替换为两条身份断言：`task?.taskId === taskId`、`task?.operationId === op`。**两字段都是生产 wire 真实字段**：`task-service.wireFrom`（681c282 :266-267）输出 `taskId`/`operationId`；去重路径 `submitSource`（:267-270）对已存源返回 `taskService.get(succeededRunId)`＝当前权威任务资源。
- 收窄正当、非弱化：任务资源确为可变（同 wire 含 state/version/queuePosition/result/updatedAt/attemptCount），旧 deepEqual 是把首次提交时的排队快照对照终态权威状态——本审复现了基线失败差异（`attemptCount 0/not_started` vs `1/exited_confirmed`），与登记的 B2 缺陷逐字对应。冻结 web-api §3.1/§5.1 的去重身份面＝「无第二任务＋原 operationId」，替换后的断言恰是该契约面；`reused:true`、`sourceId` 复用、单行约束（`sources.length===1`）、operationId 读回等既有断言全部保留。
- **锚点断言标注（派发要求，本节为否定性结论）**：保留行 `assert.equal(dedup.json.source.sourceAt?.at, first.json.source.sourceAt?.at, …)` 在当前生产链上**空真**——生产源 wire 无 `sourceAt` 键：`rowToSource`（text-intake-service 681c282 :189-197）输出 `sourceAtMs`/`anchorAtMs` 整数，`http-server.textSourcesCreate`（:589-594）对 `result.source` 透传，两侧 `sourceAt` 均为 `undefined`，`undefined?.at === undefined?.at` 恒过。**该绿不能证明锚点保持，本审不以它代签锚点面。**生产结构上确实复用原行（指纹去重返回存储行、`anchorAtMs` 保持首录值，且有单行约束断言），但 wire 级锚点面仍是已登记的 C4 线型分歧（T-12 红族）；此绿不得被引用为锚点覆盖。

## 4. C1（http T-2）：合法 stale／非法 current 两路隔离 ✓（与校验/CAS 顺序无关）

- 生产实际顺序（681c282 `config-store.writeModelConfiguration`）：**内容校验在前**（:275-293）、CAS 在后（:294-298）；契约未规定两者先后——旧测试把两个前置条件耦在一个请求里，失败归属依赖未规定的顺序。
- 两路核验：非法 `input:{}`＋当前 revision → 校验在 ：286-288 失败 → `validation_failed` → HTTP 400（code map :14）✓；合法盘上文档体＋stale revision → 校验通过（该体即当前合法配置）、CAS :296-297 失配 → `version_conflict` → HTTP 409（code map :35）✓。
- **顺序无关性成立**：两断言结果在实际顺序（校验先）与假想顺序（CAS 先）下都成立——隔离是真隔离，不是顺序运气。失败路径均先于 `writeJson` 抛出（:303 之前），无状态污染。
- 当前 revision 取自生产用于比较的同一字段（盘上 `models.json` 的 `sidekick.revision`，:247/:295 同源）；文档形状核验（`providers.json`＝`{providers}`、`models.json`＝`{models, sidekick{version,defaultModelId,revision}}`）与 `normalizeProvidersDocument`/`normalizeModelsDocument` 输出一致。读盘取合法体正确绕开 A1（GET 信封形状是另一生产事项），注释明示不混篝。

## 5. 聚焦复跑（本审新跑，真实链；非追认 Pi 的 TAP）

- 运行树：detached `681c282` 检出＋`build/web-backend/{server, shared/dates.mjs, bin/web-backend-storage}`（server/shared 取自该树生产字节，`git status` 核实运行树生产目录零改动）＋`build/s0-runtime`；叠加候选两套件（`git hash-object`＝`4d9556b2`/`1bf522b8`）＋`7f3322b` 的 `model-config.mjs`（＝`8596b78e`）。
- 复用件经哈希核验：storage binary 2649408 B／SHA `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2` 与既往登记逐字节同；runtime provenance `ad702637`/`e89822b0`（source.json 核验）；node v24.20.0。
- **结果**：`--test-name-pattern` 聚焦两例。after（候选字节）：**T-2、T-8 均 PASS（2/2）**。before（`7f3322b` http 字节 `58ede62f`，其余字节完全不变）：**0/2 败**（T-8 即 §3 的 deepEqual 差异；T-2 败于 stale 耦合非法输入）。两轮之间生产字节为零变化，翻转可归因于恰两文件差异——可证伪形态成立。
- **B1 机械面确认**：cm 401 故障例在候选字节上**无 ReferenceError**，按预算绑定运行至 10s backstop 失败（"pollUntil deadline after 10000ms … last observed: null"）——即真实产品链观察，与登记的「ReferenceError 已消失、原断言仍红」一致。按派发注记，本审**不**据此把七项 fault 统一判为生产失败；产品侧归因属 Pi 并行只读取证范围。
- 原始 TAP（gitignored 证据区 `build/mayne24-b1b2c1-review/`）：`after-t2t8-candidate.tap`（`e05048c1ade7b89c`）、`before-t2t8-baseline.tap`（`8066a5a0270f9416`）、`fault401-candidate.tap`（`8f37d59a1207a11c`，SHA-256 前 16 位）。
- 范围：聚焦复跑而已；未重跑全套件、未跑完整 gate（派发边界）。

## 6. 结论与不代签清单

- **通过（限定）**：B1/B2/C1 修改面按派发四判据全部成立——预算绑定正确且有界；七项故障断言逐字节未弱化；去重身份约束落在真实 wire 字段的契约面上；合法 stale／非法 current 两路隔离与顺序无关且实测翻绿。
- **明确不代签**：(a) 锚点保持面——保留断言在 C4 分歧下空真（§3），锚点 wire 面仍开放；(b) 七项 fault 的产品语义——仍红且现在红在真实产品行为上，归因待 Pi 的并行取证，本审不签；(c) T-2/T-8 的绿只签这两例在 `681c282` 链上的行为——http 套件其余 9 项已登记失败（A1/A2/A3/A5/A6/C4）不变、不在本审范围。
- 候选字节零改动；本审未写任何测试／生产／Runtime 字节。
