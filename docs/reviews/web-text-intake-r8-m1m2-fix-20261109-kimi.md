# MAYNE-24 R8-M-1/M-2 修复交付记录（Kimi，2026-11-09，生产增量）

> 派发：工单 `01a1b046-9c0d-7515-a447-69ace095580c`（MAYNE-24）触发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bdec-595e-7792-a92a-91831bb783aa`（Codex）：MCP 增量 `59b405f` 冻结送审；本增量**先只闭合 R8-M-1／M-2（恢复入口与 attempt 收尾）**——按 `01a1bd74` 判据同时守住活 worker／cancelling 不得发布、unknown 必须 409、恢复项版本 CAS、已核实且旧 attempt 已闭仍能提交原暂存，以及重启重排队前旧 attempt 正确收尾不饿死年轻任务；用 `adc31d8` 的 PC1/PC2/M1a–c/F1 原字节作真实链正反控，标明 PC2 等构造前置，保留基线失败与合法恢复正控；不采用待更正的 W 预期；小段及时保存待审提交，交精确生产差异与 TAP。R8-M-3／成功终态事件、身份方案与安全正控留后续分批；不扩 Runtime／DDL／守卫／前端范围，不重跑未改 Rust 或完整门禁。作者身份：Kimi（本增量起按工单正文「后端修订主责转交」担任 I 生产修订作者，不自签；独审由协调另派未写这三个 `server/lib` 文件的成员）。

## 1. 结论

**本增量交付 R8-M-1／M-2 生产修复（3 个 `server/lib` 文件，两个提交：`f9e0e4c` 门控＋`19778ca` attempt 收尾；`463bf46` 独立登记 `adc31d8` 测试原字节作验证输入），真实链回归实测：PC1／PC2／M1a／M1b／M1c 5 项由败转通过并保持合法恢复正控 PC1 绿；F1 的饿死回归已消除（第二次认领与年轻任务进展的等待在基线上超时、本树通过），其余面按派发保留。** 修复前在同一工作树、同一存储二进制上以 `adc31d8` 原字节复现可证伪原始失败 **10 项 1 过 9 败**（PC2 `queued≠succeeded`、M1a/M1b/M1c `202≠409`、F1 第二次认领超时饿死）；仅应用 R8-M-1 时 **5 过**（F1 饿死仍在），叠加 R8-M-2 后 F1 饿死消除。两个受影响 I 单测 **10/10** 与 **13/13** 通过；MCP 配对回归 **11/11** 通过（`pairKey` 0 次、stderr 0 字节）；II `web-text-intake-queue` 套件 17 项 2 过 15 败但**全部先存失败、与本增量无关**（T-5 在 pristine 基线上逐字节同样失败，见 §5）。

## 2. 身份（独立复算）

| 项 | 值 | 复算 |
|---|---|---|
| 分支基点 | `dd92757ffe8386360367753e1629c611047b8114`（tree `395d4ac4…`，父 `59b405f`） | `git rev-parse` 相符；`59b405f` 生产仅 `server/lib/task-scheduler.mjs` +33/−7（相对 `31434282`） |
| 恢复回归测试原字节（验证输入，零修改） | `adc31d895186960372af7b9c55abc6a58d35abdc`（tree `7ed233b8…`，父 `2f6a261`，3 新文件 +905） | 工作树三文件 blob 与 `adc31d8:<path>` 逐字节相同：unit `e6c90c0a…`／instance `5fe68cb4…`／stub `6d638db0…`（`git hash-object` 相等） |
| 生产差异（3 文件，`dd92757..HEAD`） | `server/lib/http-server.mjs` +8/−6；`server/lib/task-service.mjs` +34/−18；`server/lib/text-intake-service.mjs` +79/−12 | 仅这三个文件；`worker-host.mjs`、Rust、DDL、守卫、package、前端、II/III 文件相对 `dd92757` 零差异；HEAD blob：http-server `02c615b5…`／task-service `c5bce9a6…`／text-intake `b27a4cba…` |
| 003 冻结哈希 | `8e4e3159…7870` | 未触碰（本增量无 migrations 写入） |

准入登记：`build/mayne24-r8-m1m2/admission.json`（gitignored）。

## 3. 修复内容（判据 → 实现，逐条对应 `01a1bd74`）

**R8-M-1（恢复入口门控）**。根因：HTTP `taskResolve` 的 `force` 专用路径只要求 `resultPendingExit && attemptId`，不校验任务状态与退出核实——活 worker 暂存窗（running/active）、cancelling+暂存、exited_unknown+暂存 都被一次 POST 打成 202 succeeded／202 空操作（C2/M1a/M1b/M1c 实测）；且 `current.attemptId` 要求使恢复已闭 attempt 的任务回落到普通 `resolve` 重排队、丢弃原暂存（PC2）。

1. **新设专用入口 `TextIntakeService.commitStagedResume(taskId, attemptId, expectedVersion)`**（`server/lib/text-intake-service.mjs`）：`needs_review` + 已核实退出（`exited_confirmed`）+ 冻结恢复项 `expectedVersion` CAS（`inputRef.recovery.itemVersion ?? 1`）+ 当前 attempt 归属四条前置全部满足才提交**原暂存结局**（`pendingOutcome` 决定 succeeded/failed，同事务发布暂存候选或清除、写 `task.changed` 事件、清 `result_pending_exit`/`pending_outcome`/`cancel_intent`）；attempt 行仍开则同事务收尾（`ended_at`/`exit_confirmed_at`/`exit_reason='confirmed'`），已闭则穿透执行——提交**不依赖 attempt 行**，只依赖恢复项版本／任务状态 CAS（PC2 判据 2）。
2. **`confirmExtractExit` 移除 `force` 参数**：attempt 收尾（退出事实）与暂存发布（恢复决定）自此彻底分离，调度器路径恢复无条件状态守卫，`needs_review` 永不被退出确认推成 succeeded。
3. **HTTP `taskResolve` 改为路由**（`server/lib/http-server.mjs`）：`resume` 且暂存且 extract/revise → 进 `commitStagedResume`（门控不过由其按契约抛 409：running/cancelling → `state_conflict`、exited_unknown → `exit_unconfirmed`、版本不符 → `version_conflict`）；其余 → 原 `taskService.resolve`。无 `force` 旁路。
4. **`markNeedsReview` 注释同步**：attempt 行保持打开的理由改为「记录未完成 attempt，由暂存提交或重排队收尾」，不再声称 resume 需要该行提交暂存。

**R8-M-2（重排队前 attempt 收尾）**。根因：恢复把 running 尝试分类为 needs_review 时 attempt 行保持打开，`resolve(resume)` 重排队不收尾该行，部分唯一索引 `task_attempts_current`（`ended_at IS NULL`）使随后每次 `claimNext` 的 INSERT 抛 UNIQUE、被 tick catch 吞掉——队列头任务永不被二次认领，年轻任务饿死（F1：9s 观察窗零认领）。

5. **`TaskService.resolve` 的 cancel/resume 两分支在同一事务内按读时 attempt id 收尾**（`server/lib/task-service.mjs`）：`UPDATE task_attempts SET ended_at=?, exit_confirmed_at=?, exit_reason='confirmed' WHERE attempt_id=? AND ended_at IS NULL`。按读时 attempt id 而非任务维度关闭，使「重复 resolve 与重新认领并发」竞态诚实：他人已收尾的行是 no-op，新认领的 attempt 永不被误闭（任务维度版本会误闭活 attempt 行，本增量自行收紧）。

## 4. 验证（命令／TAP／stderr／哈希）

前置（本树重建）：`npm ci --ignore-scripts`（exit 0，107 包）→ `probe:prepare-cli`（lark-cli 1.0.98）→ `probe:prepare-pi`（provenance `ad702637…`/`e89822b0…`）→ `probe:bundle`（organizer `08f32db2…`、node `9d050fd4…`）→ `build:backend`：存储二进制 2649408 B、SHA-256 `42af54b5…490fc2`，与既往登记**逐字节相同**。

**修复前基线（HEAD `dd92757`，`adc31d8` 三文件原字节复制入树，树零修改）**：

```
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs
→ # tests 10 / # pass 1 / # fail 9；stderr 0 字节；EXIT=1
→ not ok PC2（'queued' ≠ 'succeeded'：恢复已闭 attempt 后 resume 丢弃原暂存）
→ not ok M1a（202 !== 409：活 worker 暂存窗被发布）、M1b（202 !== 409：cancelling 被一次 POST 击败）、M1c（202 !== 409：exited_unknown 得 202 空操作）
→ not ok F1（timeout waiting for second claim and younger progress: null——UNIQUE(task_attempts_current) 每 tick 失败被吞，年轻任务零认领）
→ not ok E1/E2/W/D1（后续分批面，如实保留）
→ ok PC1（合法恢复正控保持绿）
```

**修复后（分提交验证，`adc31d8` 原字节不变）**：

```
# 提交 f9e0e4c（R8-M-1 门控单独在位，R8-M-2 未应用）：
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs
→ # tests 10 / # pass 5 / # fail 5；stderr 0 字节；EXIT=1
→ ok PC1 / ok PC2 / ok M1a / ok M1b / ok M1c
→ not ok F1（仍是 time out waiting for second claim and younger progress: null——饿死尚在，R8-M-2 未应用）
→ not ok E1/E2/W/D1（后续分批面）

# 提交 19778ca（R8-M-1 + R8-M-2 合并树，最终交付态）：
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs
→ # tests 10 / # pass 5 / # fail 5；stderr 0 字节；EXIT=1
→ ok PC1 / ok PC2 / ok M1a / ok M1b / ok M1c
→ not ok F1（:604 末条候选计数 1 !== 0，见 §5——:591 的「第二次认领＋年轻任务进展」等待已通过，饿死回归消除）
→ not ok E1/E2/W/D1（后续分批面）
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-lifecycle.test.mjs → # tests 10 / # pass 10 / # fail 0；EXIT=0
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake.test.mjs            → # tests 13 / # pass 13 / # fail 0；EXIT=0
$ node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-mcp-pairing.test.mjs → # tests 11 / # pass 11 / # fail 0；stderr 0 字节、pairKey 0 次；EXIT=0
$ node --test --test-reporter=tap --test-timeout=60000 tests/integration/web-text-intake-queue.test.mjs → # tests 17 / # pass 2 / # fail 15（全部先存失败，见 §5；进程在 after 清理挂起后被止停，TAP 17/17 已完整落盘）
```

**R8-M-2 机制直证（scratch 探针，`build/r8-m1m2/probe-attempt-close.mjs`，gitignored；真实崩溃→重启→恢复→resume 链，只读 `task_attempts`）**：

```
基线（dd92757 生产字节）：after recovery: attempts[0].endedAt=null → resolve 202 queued → after resolve: endedAt 仍 null → 第二次认领超时（attemptCount 恒 1）
本增量：after recovery: attempts[0].endedAt=null → resolve 202 queued → after resolve: endedAt=1794188838470, exitReason='confirmed'（同一事务收尾）→ re-claimed: state=running, attemptCount=2
```

全部断言落在真实链上：首实例为经生产入口 `startWebBackend` 的真实子进程、SIGKILL 真崩溃、重启走生产「先恢复后调度」顺序、HTTP 全走配对/CSRF/Origin 真端点、worker 为经生产 `processFactory` 接缝 spawn 的真实 stub 进程、真实存储二进制；无迁移逻辑复制、无 helper 直调替代。

## 5. 未验与边界（如实单列）

- **F1 末条断言（:604 `candidates.length===0`，实测 1）**：`:591` 的饿死回归等待已通过（第二次认领＋年轻任务进展均发生）；末条失败源于夹具自身设计——`restartWithStagedOutcome` 对重启实例硬编码 `result-hang` 模式（`startRestartedInstance(root, { stubMode: 'result-hang', … })`），第二次 attempt 正常运行并成功、按冻结 §3.2 发布 1 个候选，与「第一个（丢失的）attempt 无暂存」这一断言意图不符。属测试/夹具交互，非生产缺陷；按派发不改 `adc31d8` 原字节，留待测试作者（ZCode）与独审者裁处。
- **II `web-text-intake-queue` 集成套件 17 项 2 过 15 败，全部为先存失败、与本增量无关**（实测证据）：该套件的 `submitExtract` 提交体不带 `timeZone`（`submitSourceBody({ text })`），而 `submitSource` 自 W1 服务端首个提交 `6262484` 起即要求非空且 `Intl` 可解析的 `timeZone`——凡经 HTTP 提交的用例一律 400 `validation_failed: timeZone 无效`（T-5 在** pristine 基线 `dd92757` 上同样失败、逐字节相同**：`git stash` 本增量后单跑 T-5 复现同一 400）；#17（`workerRunLimitMs` 字符串 `"500"` 被 `Number()`  coercion 接受）位于本增量未触碰的入口参数校验。该套件因此对本增量不提供回归信号（其 resolve 面由恢复回归 M1c 与 lifecycle R6-M-3 等效覆盖）；另该套件 17/17 用例报完后在 `after` 清理挂起（>5 分钟），被止停，其遗留的 4 个本树存储二进制已清理。此为本人 II 候选的结构性缺陷，按派工另案处理，不混入本增量。
- **E1/E2/W/D1 仍败**：分属 R8-M-3（公开失败信封／配置修订重试／`worker_lost` 映射）与 R5-M-1 D1(b)＋判据 4（成功终态事件／游标／暂存窗令牌重放），按派发留后续分批，不以本增量代签。
- 本增量**不**处理：身份登记／存活期清扫与保守恢复（R7-M-2/M-3）、真实 `test` 任务安全重试正控、MCP／M-5 关闭判定。
- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust 的 fmt／clippy／cargo test（仅按前置需要编译存储二进制）；未 push、未改工单状态。
- 恢复回归三文件为 `adc31d8` 原字节，仅独立登记；未改写任何测试判差。
- 原始证据：`build/r8-m1m2/`（gitignored）：基线／修复后全量 TAP 与 stderr、机制探针脚本与基线对照输出、准入登记。
- 独审：由协调另派未写 `server/lib/http-server.mjs`、`task-service.mjs`、`text-intake-service.mjs` 的成员；作者不自签。过审前本增量只是待审候选。
