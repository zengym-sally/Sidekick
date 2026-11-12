# R8-M-1／M-2 生产增量 `dd92757..c4a9c67` 独立审记录（OpenCode，2026-11-09）

- 审阅者：OpenCode（未写本增量三个生产文件、未写 `adc31d8` 恢复回归），派发：评论 `01a1be0b`（2026-11-09T02:03Z）。
- 候选：`c4a9c6705175ff0749904a3bbbdc96efc9b67252`／tree `9545029de58d97dd8604d7b191b9cdaa62205e5c`，基线 `dd92757ffe8386360367753e1629c611047b8114`。
- 范围：恰三个 `server/lib` 生产文件及受影响路径；测试登记提交与生产 diff 分开核验；F1 末条断言的产生者／attempt 时序核对。不跑完整 check，不改生产／测试。

## 结论

**限定范围：R8-M-1（`f9e0e4c`）通过；R8-M-2（`19778ca`）不通过——存在一个并发交错缺陷（F-R8-2，MAJOR），其余判定面通过；F1 末条红为夹具交互（产生者已核实），不是生产失败。** 五项派发判据中四项经真实 HTTP／恢复／存储链验证通过，「并发 resolve 不误闭新 attempt」一项被确定性探针推翻。R8-M-1／M-2 不因本审关闭；MCP／M-5 与后续面不受影响。

## 身份与提交分离（复核通过）

- `c4a9c67` tree 与登记逐字节一致；`dd92757..c4a9c67` 生产面恰 `http-server.mjs` +8/−6、`task-service.mjs` +34/−18、`text-intake-service.mjs` +79/−12，合计 +121/−36；`worker-host.mjs`／src-tauri／package／前端零差异。
- `463bf46`（测试登记）与生产提交分离：三文件 blob `e6c90c0a`／`5fe68cb4`／`6d638db0` 与 `adc31d8` 逐字节相同（本审对象库复核，非采信登记）。
- `c4a9c67` 为 docs-only 交付记录；其数字（基线 1/9、终态 5/5、lifecycle 10/10、service 13/13、MCP 11/11）与本审独立复跑全部吻合（见下）。中间态 `f9e0e4c`（仅 R8-M-1）的 5 过 5 败未独立重放，属登记性信息，不阻断终态评审。

## 独立复跑（pristine detached 树，本机重建前置）

存储二进制按候选自带 src-tauri 重建：2649408 B／SHA-256 `42af54b5…490fc2`，与既往各轮登记逐字节相同（确定性复现）；`build/s0-runtime` 经 `npm ci --ignore-scripts`＋`probe:bundle` 重建（organizer `08f32db2…`、node `9d050fd4…`，与既往登记一致）——套件不消费 runtime 字节（stub 替换 spawn、`assertRuntimeLayout` 零调用方），仅 tauri-build 资源检查需要该目录。

| 运行 | 对象 | 实测 |
|---|---|---|
| 恢复回归 | pristine `c4a9c67`（含登记测试字节） | **10 项 5 过 5 败**（PC1/PC2/M1a/M1b/M1c 过；F1/E1/E2/W/D1 败），stderr 0 字节，与登记形状一致 |
| 基线反证 | pristine `dd92757`＋三文件为未跟踪原字节副本（blob 复核相同） | **1 过 9 败**（仅 PC1 过），可证伪形态独立复现 |
| 受影响 I 单测 | `c4a9c67` | lifecycle **10/10**、service **13/13**，exit 0 |

两棵运行树全程 porcelain 干净（基线树仅有三个登记测试的未跟踪副本），取证后删除。

## 逐判据核验（真实 HTTP／恢复／存储链）

1. **状态＋退出＋恢复项版本 CAS：通过。** M1a/M1b：running／cancelling 带暂存窗时 `resolve(resume)` → 409 `state_conflict`，不发布、不动活 worker（新路径 `commitStagedResume` 的 `state!=='needs_review'` 先于版本 CAS 抛出）；M1c：`exited_unknown` → 409 `exit_unconfirmed`、任务保持隔离。版本 CAS 正控由 PC1/PC2 覆盖；**负控（错版本）套件未覆盖，由本审探针补齐**：`expectedVersion:2` → 409 `version_conflict`、暂存行保持 1、任务不变（probe-failed B-1）。
2. **并发 resolve 不误闭新 attempt：不通过（F-R8-2，见下节）。**
3. **旧 attempt 已闭仍可提交原暂存：通过。** PC2 真实链 202＋`succeeded`＋发布 1 候选＋暂存窗同事务清除；`commitStagedResume` 只依赖恢复项版本／任务 CAS，attempt 行为 null 时归属门放行（text-intake-service.mjs:902-906）。
4. **失败原结局保留：通过（探针补面）。** 套件 10 面未覆盖 staged-FAILED 形态；本审探针以生产原语构造（`stageResult('failed')` 覆写→`markNeedsReview(exited:false)` 隔离→真实 worker 退出经修复后的无条件 needs_review 守卫 no-op→生产 `recover()` 核实死 pid 转 `exited_confirmed`）后走真实 HTTP：`resolve(resume)` 202 → 任务 `failed`（非重排队，attemptCount 恒 1、terminal_at 落定）、暂存候选同事务删除（1→0）、零发布（pending 0）、failure 信封保留（`model_request_failed`／`manual`）、重复 resolve 惰性 409（probe-failed B-2/B-3/B-4）。构造面与 PC2/M1c 同类，已在探针内如实标注。
5. **重启重排队后年轻任务可进展：通过。** R1 中 F1 `:591` 的「第二次认领＋年轻任务进展」等待通过（超时消除）；probe-f1 进一步证实 resolve 202 → attempt#2 认领并正常完成（attemptCount 1→2，attempt#1 行由 resolve 同事务收尾 `ended_at=…792, exit_reason='confirmed'`）。

## F-R8-2（MAJOR）：败方 resolve 落定胜方新认领的 attempt 行，伪造退出事实

**机制（代码层）**：`TaskService.resolve` 顶部守卫读行（:466-479）之后才 `currentAttemptId`（:494），二者之间无任何串行化保证；守卫读可早于并发 resolve#1 提交＋调度器重新认领，而 `currentAttemptId` 晚读会取到**新认领的 attempt#2**。随后同事务两 op（任务 UPDATE 带 `state='needs_review'` CAS、attempt 收尾 `WHERE attempt_id=? AND ended_at IS NULL`）**均未声明 `expectChanges`**——Rust 存储适配器仅在声明 `expect_changes` 时做预提交断言并回滚（web_backend_store.rs:252-290），否则原样执行并 COMMIT；任务 CAS 的 0 变更在 `transact` 返回**之后**才手工检查（:509/:525）并抛 409。即：**CAS 失败不回滚同事务内已提交的 attempt 收尾**。

**确定性演示（probe-concurrent-resolve seam 模式，生产字节零修改，注入仅 fixture 缝：processFactory＋一次 getTaskRow promise 门）**：真实 SIGKILL 崩溃→生产入口重启→恢复扫描就绪（needs_review＋exited_confirmed＋attempt#1 开行）后——

- resolve#2 的守卫读被门持在过期 `needs_review` 快照上；resolve#1 经真实 HTTP 202（任务 queued、attempt#1 收尾）；
- 调度器 200ms tick 认领 attempt#2（开行、bare stub 存活）；
- 门释放后 resolve#2 继续：守卫沿过期快照通过 → `currentAttemptId` 实读返回 **attempt#2** → 事务落定 **changes [0, 1]**（任务 CAS 0、attempt#2 收尾 1）→ **已提交** → 事后检查抛 409 `state_conflict`（「任务状态已变化」）；
- 只读 SQL 复核：attempt#2 行 `ended_at=1794192201103, exit_confirmed_at=同刻, exit_reason='confirmed'`——**活 worker 从未退出即被记成已核实退出**；任务停留 running。这是 `task_attempts` 台账中的伪造退出事实。

**后果链（代码推导，未另立探针）**：attempt#2 稍后真实完成时，`confirmExtractExit` 的归属门 `currentAttempt !== attemptId → return null`（text-intake-service.mjs:778-780）——行已被闭、退出确认与暂存提交全部落空，任务卡在原状态直到 deadline／恢复路径基于假「已确认」事实动作。

**真实可达性界限（如实）**：natural 模式 6 组真实 HTTP 并发 resolve 对（无缝），**0/6 触发**——每次恰一 202/一 409、attempt#2 行完好。危害窗口＝「败方守卫读→晚读 currentAttemptId」间隙内须完成胜方提交＋tick 认领，亚毫秒级；自然触发需要极窄时序，但契约允许多客户端并发 resolve（无 operationId 幂等），重试风暴／负载抖动可放大。**交付记录 :31「新认领的 attempt 永不被误闭」不成立，需更正。**

**窄修方向（本审不实施、不改字节）**：把任务 UPDATE op 声明为 `expectChanges: 1`，使适配器预提交断言失败时回滚**整个事务**（含 attempt 收尾）——机制现成（`WEB_BACKEND_CONDITION_FAILED` → `version_conflict` 映射于 TaskService.transact:117-131），或等价的「收尾以任务 CAS 成功为同事务前置条件」。错误码落 `version_conflict` 还是 `state_conflict` 属契约面，请队长裁处。修复后应补一条并发回归面（现套件无此形态）。

## F1 末条断言（`:604`）：产生者／attempt 时序已核实

- 字节层：恢复回归 :412 `startRestartedInstance(root, { stubMode: 'result-hang', stubLifetimeMs: restartLifetimeMs })` **硬编码重启实例为 result-hang**，与 F1 传入的 `stubMode:'bare'` 无关；该 stub 模式发一帧合法 result 后挂起、3000ms 自退（exit 1）。
- 数据层（probe-f1，同 F1 形态真实链）：`task_result_payloads` 按 attempt_id 键控——唯一 result payload 行（240 B）属于 **attempt#2**（重启实例），attempt#1（bare，丢失的首 attempt）**从未暂存任何 payload**（`attempt1EverStagedPayload:false`）；attempt#2 按冻结 §3.2 正常发布 1 个 pending 候选。
- 裁定：`:604 candidates.length===0` 的红＝**夹具自身的重启实例合法发布**，非「首个 attempt 泄漏暂存」、非生产缺陷；但断言本身不可删——「首个无暂存不可发布」已由 probe-f1 的 attempt#1 零 payload＋本审 R1 通过的其余面证实，「后续合法结果可发布」由同一 probe 的 attempt#2 发布证实；ZCode 按协调裁定重排夹具时两部分证据可直接复用。本审不把该末条红计为生产失败，也不视为作者已闭。

## 登记瑕疵（不阻断）

1. PC2 测试注释「The fixed tree reaches this shape by itself（recovery closes the attempt once the exit is verified）」与生产不符：`TaskRecovery.classify`（task-recovery.mjs:116-146）两分支均**不关闭** attempt 行，闭行仍由测试显式 `closeAttempt` 构造（与 ZCode 对 `adc31d8` 的既往审记一致）；测试内联披露已在，措辞宜对齐。
2. 交付记录 :31 的竞态断言被 F-R8-2 推翻（见上），须随窄修更正。

## 边界

只读独审＋三支本审探针（seam/natural、failed-staged、F1 归因；脚本与原始输出随评论附件，原始证据 `build/mayne24-r8-m1m2-review/r1/`，gitignored）。未写生产／测试／package／DDL／Runtime／守卫；未跑完整 check；未重跑 MCP 配对套件与 Rust（前轮绿证按「未改已过面复用」沿用——三生产文件不触 scheduler 配对状态，blob 面无交叠）；未触其他成员工作树；无真实模型／凭据／用户根。MAYNE-24 保持 `in_progress`，状态未动。
