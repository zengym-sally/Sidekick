# W1 文本整理验收套件再修订候选（MAYNE-24 Stage 4 / II 第四轮）

> 本篇是 MAYNE-24 II（Kimi：真实 HTTP／持久队列／受控 Pi／同源 UI 验收）在第三轮候选 `a2fb15bb614db6ce7d42eb11c8b06344668ecc3f`（tree `19cd0235ccde8ae48bb52d1a16e27bfcbf72ff84`）之上的修订交付登记，落实两条派发：
>
> - 队长评论 `01a1bbd8-85ec-71c9-a98f-6d19f5690d8b`（本轮触发）：把 R2 增量独审（`d6e23bc`）的新增夹具项合入已排队的 II 修订——场景耗尽显式报错并断言 attempt 数、迟到身份帧直接观测 `rejected_late_result` 审计事件、派生进程身份登记/清理覆盖提前失败并核实全部退出；不以缩短存活时间代替 cleanup，不为本条重跑未集成的四套件；沿原路径给增量与聚焦证据；既有私有接口、20s 预算及上一轮 M-1/M-2/M-3 裁定保持。
> - 队长评论 `01a1bbd2-0945-7766-8d92-b5ac40159a4c`（本轮更早评论）：在当前已派修订后接续关闭其余 B/M 项——尤其观察器按精确 003、T-12 日期/歧义/锚点无条件可证伪、同 operationId/原版本的批次重放、全进程树秘密边界；沿原 II 路径交统一关闭矩阵、增量及聚焦证据，不整跑已知缺前置的全部套件。
>
> 输入不变：最终 P1 契约 `b190f7c6`（`docs/engineering/web-text-intake-contract.md`，SHA-256 `5982c062…`）与 P2 验收矩阵 `43433ae5`（T-1–T-14，SHA-256 `2d647417…`）；003 DDL 按 owner 授权 A 的精确字节提取复算（`src-tauri/migrations/web-backend/003_text_intake.sql`，SHA-256 `8e4e3159…7870`，与批准值逐字节一致）。本篇不实现业务、不改 I/III 文件、不宣称任何业务通过；公开业务契约不变，一切新增只涉及测试私有夹具与定点断言。r1/r2/r3 登记原文保留，未改写。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. R2 新增夹具项（派发 `01a1bbd8` 三项）

### 1.1 场景耗尽显式报错并断言 attempt 数（R2 minor）

`protocol-worker.mjs` 工厂原在场景队列耗尽时**静默回落** `well-behaved`。现改为显式错误：记录该次 attempt（`scenario: null`、`pid: null`——未 spawn 任何进程），抛出点名「已注册场景数 + 第几次 attempt」的 Error，并存入 `factory.exhaustionError()`。`factory.attempts` 因此是**真实 spawn 尝试次数**（含耗尽那次）。

queue 套件新增聚焦用例 `protocol scenario exhaustion: an attempt beyond the registered scenarios fails explicitly and the attempt count is exact`：注册 3 个场景、制造第 4 次 attempt——断言 `attempts.length === 4`、四个 attempt 的场景序列恰为 `[well-behaved ×3, null]`、耗尽错误文案匹配 `/exhausted/` 与 `3 scenario(s) registered, attempt 4`；第 4 个任务**不得 succeeded** 且零候选（生产对 spawn 失败的映射无论是 failed／parked 抑或仍持有，成功即意味着工厂被绕过）；前 3 个注册场景正常跑通。基树下入口忽略私有签名、工厂零调用，该例以命名缺口失败（attempts=0，失败信息点名 `config.workerProcessFactory`）。

### 1.2 迟到身份帧直接观测 `rejected_late_result` 审计事件（R2 minor，原 GAP-4 从候选条数反推）

GAP-4 用例在原有「恰好一个候选」推断之外，增加**直接观测**：`task_events` 中必须存在 `type='rejected_late_result'`、`object_type='task'`、`object_id=` 迟到帧所落入任务的行（冻结 web-api/1 §3.3「晚到结果以事件留痕（`rejected_late_result`），不产生业务写入」）；并断言事件 payload 不含合成秘密。失败信息列出该任务实际观测到的事件类型序列，可证伪、可诊断。候选条数推断保留为次级断言。

### 1.3 派生进程身份登记/清理覆盖提前失败并核实全部退出（R2 nit）

- **登记覆盖提前失败**：`protocol-worker-process.mjs` 在读到请求行**之前**先写 `worker-start` 注册行；派生孙进程后**立即**注册其 pid（先于任何结果帧）；spawn 本身失败时登记 `spawnFailed`（区分「从未存在」与「登记被跳过」）。工厂侧在 `spawn()` 返回时同步记录每个直接子进程 pid——worker 进程一个字都没写时也已被覆盖。
- **新增 `early-failure` 场景**：派生孙进程并注册后，在发出任何结果帧前 `exit 1`——提前失败的 worker 同样留下可清理的派生身份。
- **cleanup 核实全部退出**：`factory.cleanup()` 改为 async——先杀全部直接子进程并等待其 exit（5s 有界），再杀注册表中全部孙进程，然后**逐一核实**每个记录 pid 确已消失（`process.kill(pid,0)`；幸存者重试一次 SIGKILL），返回 `{workers, grandchildren, survivors}` 报告；任何幸存者即抛错。套件 5 处 `finally` 全部改为 `await factory.cleanup()`。
- **不以缩短存活时间代替 cleanup**：所有场景的孙进程沿用同一 300s 生命周期。新聚焦用例 `protocol cleanup: worker and derived-process identities cover early failure and every exit is verified` 在 cleanup **之前**断言两个孙进程仍存活（证明不是靠生命周期自然结束），cleanup 之后断言全部记录 pid 消失、报告 `survivors` 为空、进程表无 `protocol-worker-process.mjs` 残留。

## 2. 统一关闭矩阵（派发 `01a1bbd2` 的其余 B/M 项 + M-3 余项）

| 项 | 原缺陷（OhMyPi `e685d2c` §6 摘要） | 本轮关闭方式 | 状态 |
|---|---|---|---|
| B-1 | `db-observer` 对 `text_sources` 断言冻结 003 DDL 中不存在的 `status` 列 | `sourceRow` 所需列改为精确 003 列集（`source_id/fingerprint/raw_text/succeeded_run_id`，与授权字节 `8e4e3159…` 复算一致；来源生命周期经 `succeeded_run_id` 抵达，无 `status` 列）；全部 `manual_item_events` 列与 003 双表重建 DDL 逐列核对通过 | 关闭 |
| B-2 | T-12 读 `expected.point?.at`（shared/dates 实为 `point.atMs`）且 `candidates` 无 `due_at_ms` 列，断言恒真 | T-12 重写：已解析日期按 `JSON.parse(fields_json).due.atMs` 与 `resolveExpression(...).point?.atMs` 对比例（真实字段、真实存储） | 关闭 |
| B-3 | T-12 把 `time_review_required` 整段包在 `if (candidate.unresolved)`，脚本化答案恒 `unresolved=false` 成死代码 | 新增歧义夹具：`AMBIGUOUS_TEXT`（含逐字表达式 `下周五前后`）+ `ambiguousExtractAnswer()`；shared/dates 对该表达式返回 `unresolved:true`，用例**无条件**断言候选 `unresolved=1`、无 timeReviewed 签收 400 `time_review_required`、timeReviewed=true 200 | 关闭 |
| M-3 余项 | http `waitForTask` 默认 30000、controlled-model 轮询 40000/30000/15000 超 20s 用例预算（r3 观察项；队长 `01a1bbdc` 裁定属既有 M-3、不转交集成者） | http/controlled-model 两套件落入与 queue/static 同一模式：每例 `caseDeadline()`，全部等待 `waitWithin(deadline, cap)` 派生（http 21 处 waitForTask + SSE 30000；controlled-model 5 处 40000 + 15000 + `driveOrganizer` 默认 10000） | 关闭 |
| M-4 | T-13 宣称覆盖「backend log」但无任何采集点 | 两个真实采集点：queue T-7 断言子进程模式 backend 进程自身 stdout/stderr（击杀前与重启后两个实例）不含秘密；http T-13 在进程内模式于一次真实生产运行窗口内拦截 `process.stdout/stderr.write`，断言采集非空且不含秘密 | 关闭 |
| M-5 | fixture 模式下配对/旅程用例静默 `return` 记通过 | static 两处 `return` 改为抛 `PrerequisiteGap`，点名缺真实 product dist（`build/web-backend/static`／`WEB_TEXT_INTAKE_STATIC_ROOT`）与当前 mode | 关闭 |
| M-6 | 批量签收「重放」既未复用 `operationId` 也未复用 `expectedVersion` | T-10 重放改为**同一 batch operationId + 原 expectedVersion**（此时版本已因 accept 前进，旧版本恰证幂等短路）：断言 `replayed:true`、返回同一组当前权威 itemId、不建第二条 ledger 行、`signOffBatchRow` 在库 | 关闭 |
| M-7 | staged 不可见性从未观测暂存态 | GAP-3 暂存窗观测（HTTP 列表零可见 + DB staged 行在位 + 占槽 + 第四任务 queued + 不可签收）自 r2 落地，本矩阵登记指针 | 关闭（r2 证据） |
| M-8 | 锚点缺省规则未验 | T-12：省略 `sourceAt` 时默认首次录入时间（±120s 容差断言）与显式锚点逐字保留；T-8：指纹去重复用**原锚点**（合同 §5.1「含其原锚点」）且不建第二任务 | 关闭 |
| M-9 | 占槽断言用固定 sleep 代替调度器决策 | T-6 SIGKILL 例的固定 sleep 改为 deadline 有界连续观测：窗口内每次轮询都断言新提交保持 `queued` 且 `attemptRows===0`（调度器决策面，任何启动都会翻转状态或建 attempt 行） | 关闭 |
| M-10 | worker argv 断言漏掉真正持密的 `bash-worker.mjs` 子进程 | controlled-model 工具路径增加**全进程树**秘密边界：bash 命令自带 3s 观测窗，轮询确认 `bash-worker.mjs` 后代存在后，对测试进程全部后代（organizer worker、工具子进程、bash 命令本身）逐条断言命令行不含秘密 | 关闭 |
| M-11 | 「真实 Pi」证明强度不足（桩 organizer 可过 5/6 机械例） | 新增业务路径联合证明用例 `T-4 joint proof`：①真实构建身份——生产 spawn 的 worker 命令行必须指向本树 bundle 的 organizer 路径（非任意同名文件），runtime provenance 落证据；②工具子进程存在——运行中可观测 `bash-worker.mjs` 后代；③脚本输出回传——受控服务记录扩展 `toolContents`，脚本回显标记必须在工具消息中回到模型服务。三项在同一次真实生产运行上联合观测 | 关闭 |
| M-1/M-2/M-3 | 队长 `01a1bbd2` 裁定：M-1 原归因不成立（`[200,409]` 保留，另补 claim/cancel 明确时序建议项）、M-2 引用形状以 P1 §4.4 为准（`env:MODEL_KEY` 合法；GET/PUT 配置包络分形状断言交 I）、M-3 按 20000ms 修订 | 按裁定执行：r3 撤回超额 timeout；本矩阵登记。claim/cancel 时序补证见 §4 聚焦计划 | 按裁定保持 |

## 3. 写入范围（II 冻结范围内）

| 类别 | 文件 |
|---|---|
| 改套件 | `tests/integration/web-text-intake-queue.test.mjs`（R2 三项用例、cleanup await、M-9、M-4/T-7）、`tests/integration/web-text-intake-http.test.mjs`（T-12 重写、T-8 锚点、T-10 重放、T-13 日志采集、M-3 预算模式）、`tests/integration/web-text-intake-controlled-model.test.mjs`（M-11 联合证明、M-10 进程树、M-3 预算模式）、`tests/integration/web-text-intake-static.test.mjs`（M-5） |
| 改夹具 | `tests/fixtures/web-text-intake/protocol-worker.mjs`（耗尽显式报错、attempt 计数、pid 同步登记、cleanup 核实）、`protocol-worker-process.mjs`（worker-start 提前登记、孙进程立即登记/spawnFailed、`early-failure` 场景）、`db-observer.mjs`（B-1）、`controlled-model.mjs`（`ambiguousExtractAnswer`）、`controlled-model-service.mjs`（记录 `toolContents`）、`synthetic-inputs.mjs`（`AMBIGUOUS_TEXT/EXPRESSION/EVIDENCE`） |
| 文档 | 本篇 |

未写：I 的 unit/Rust/server/frontend、III 的构建/守卫/`package.json`/公共文档、`tests/fixtures/web-manual-items/**`、`domain/shared/runtime/vendor`。`docs/reviews/README.md` 索引归 III，未动。

## 4. 机械与聚焦验证（本树实跑）

- `node --check`：4 套件 + 12 夹具全部通过。
- `npm run check:docs` exit 0（21 文件 513 链接）；`npm run check:structure`：本轮写入文件 0 违规（仓库模式剩余违规均为开工前已存在的平台 `.kimi/` 漂移与全新树未跑前置的 vendor/pi 基线，如实保留、未过滤签绿）。
- **夹具自检 9/9**（`build/web-text-intake-tests/protocol-selfcheck-r4.mjs`，直接驱动夹具、不经后端，2.8s）：场景注册齐全；耗尽显式报错 + attempt 计数（含耗尽 attempt 记录、pid 为 null）；五个场景直驱（well-behaved 干净退出、stage-then-hang cancel 收尾、late-identity-frame 首帧身份确实不同、lingering-tree/early-failure 孙进程登记且在案）；工厂 cleanup 覆盖提前失败并核实全部退出（报告 survivors 空、全部 pid 消失、二次 cleanup 幂等）；无进程残留。自检中发现并修复两个真实缺陷：工厂原先不记录耗尽 attempt（attempt 数少 1）、自检工厂段漏写请求行导致孙进程从未派生——均已修正后 9/9。
- **聚焦用例实跑**（base 树，I/III 未集成；通过项与命名失败项如下，TAP 随附件）：

| 聚焦项 | 结果 |
|---|---|
| queue `staged resolution table`（无 backend 纯表） | **通过**（0.38s） |
| controlled-model `fixture mechanics` 5 例（真实 Pi 直驱，含新增工具回传断言） | **通过** 5/5（含 tool-call 序列的 `controlled-tool-proof` 回传观测） |
| static `browser cold start` 1440/640（真实 Chrome 冷启） | **通过** 2/2（2.16s/1.86s） |
| http `T-1` 无模型手工路径 | **通过**（0.09s） |
| static `packaged CLI` | 命名 GAP-1 PrerequisiteGap 快速失败（0.12s，stderr `spawn …/build/bin/web-backend-storage ENOENT` 原文在案） |
| static 配对旅程 1440 | 命名 GAP-2 PrerequisiteGap 失败于 12.7s（预算内；此前真实 UI 配对/失效/写入/刷新全过） |
| static 两旅程（临时移走 packaged dist 触发 synthetic 模式后恢复） | 命名 M-5 PrerequisiteGap 失败（0.07s/0.43s，点名缺真实 product dist）——静默 return 已消除 |
| queue `protocol scenario exhaustion` / `protocol cleanup` | 命名 405 缺口失败（I 未集成；工厂机械由自检 9/9 覆盖） |
| http `T-12`/`T-13` | 命名 405 缺口失败（T-13 捕获机制用 canary 单独实证：拦截/采集/还原均正常） |
| controlled-model `T-4`/`joint proof` | 命名 405 缺口失败（业务面属 I；联合证明的三项观测机械在 fixture mechanics 与自检中已实证） |

- 编译准备（用例外）：`npm ci --ignore-scripts`（根与 vendor/pi）exit 0；`npm run probe:prepare-pi` exit 0；`npm run probe:bundle` 产出 `build/s0-runtime`（organizer/node 在位；可选 lark-cli 复制处按已知基线非零退出，organizer 路径不依赖；provenance tree `e89822b0…`＝W1 登记）；`cargo build --manifest-path src-tauri/Cargo.toml --bin web-backend-storage` exit 0；`npm run build:backend` exit 0（storage 二进制 2633392B，SHA-256 前缀 `b7dd9339…`＝W1 登记值；`build/web-backend/static/index.html` 在位）。
- **未整跑四套业务测试**（已知缺 I/III 前置，按队长指示只跑必要机械/聚焦检查）；业务断言按设计显式失败的状态与前轮一致，无任何新绿声明。
- 证据脱敏核查：附件内合成秘密 0 命中、配对码/cookie/CSRF token 0 命中、绝对路径已替换 `<worktree>`；哈希清单 `SHA256SUMS.txt` 随附件。

## 5. 缺口、观察项与未验项（集成轮输入，不代签）

- **I/III 未集成**：全部整理业务断言仍显式失败（路由 404/405、schema_version=2、intake tab 禁用、第二配对码未发放、私有键未校验）；GAP-1/GAP-2 归 I 的命名失败事实原样保留。R2-2 的 `rejected_late_result` 观测、M-6 重放、M-8 锚点、M-11 联合证明等业务面断言在集成版的首次真实通过属集成轮证据，本树只能证明其机械与失败命名。
- **私有键生产语义**：`workerProcessFactory`/`workerRunLimitMs` 的校验、超时路径 cancel/杀细节、进程树退出核实范围，以 I 实现为准；协议段对两个冻结合法分支都断言完整不变量，第三落点即失败。
- **claim/cancel 明确时序**（M-1 裁定降级为建议项）：不带版本→赢 200 `cancelled`/输 202 `cancelling`、携带旧版本→409 `version_conflict` 的定点用例已在套件候补，待 I 集成后随业务面一并生效（现有 cancel/cancel 用例按裁定保留 `[200,409]`）。
- **未验证**：真实模型/真实凭据/用户根/Linux/代理（未授权未执行）；完整 `npm run check`（III 在稳定集成版另派串行执行，本候选不代跑）；`package.json` 的 `test:web-text-intake` 聚合属 III 写入范围，未动。
- 本篇增量（`a2fb15b` 之上）供 OhMyPi 限定复核；本篇作者不自签。
