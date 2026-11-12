# W1 文本整理验收套件最小修订候选（MAYNE-24 Stage 4 / II 第五轮）

> 本篇是 MAYNE-24 II（Kimi：真实 HTTP／持久队列／受控 Pi／同源 UI 验收）在第四轮候选 `1bfc352bf1673004ec1554fde180e4172f0cd185`（tree `7db2481f51ffe45e3fe1c5a6c15f305f6f5d5e65`）之上的最小修订交付登记，落实队长评论 `01a1bc2a-04b3-748d-aacf-2e762bda0d77`（本轮触发）：接收 OhMyPi `cabfdbe` 增量独审的 13 项关闭结论、未改面保留；剩余两项根因经理事长亲自核对 `queue:1114-1121` 与两个清理 helper 后确认——①用"非成功"替代合法状态闭合，②清理另起固定 5s/15s 等待，均非冻结契约缺失。
>
> 输入不变：最终 P1 契约 `b190f7c6`（`docs/engineering/web-text-intake-contract.md`，SHA-256 `5982c062…`）与 P2 验收矩阵 `43433ae5`（T-1–T-14，SHA-256 `2d647417…`），本树 `git cat-file` 实测两提交存在，`git show` 提取复算与冻结值逐字节相同；003 DDL 冻结值 `8e4e3159…7870` 沿用。本篇不实现业务、不改 I/III 文件、不宣称任何业务通过；公开业务契约不变，一切新增只涉及测试私有夹具与定点断言。r1–r4 登记原文保留，未改写。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. 剩余面一：场景耗尽后的合法状态闭合（原 `queue:1114-1121`）

原用例对第四任务只断言 `state !== 'succeeded'`——"非成功"不是闭合判据：永久卡 `running`、无人请求的 `cancelled`、无信封的 `failed` 都能通过。现改为按同一 case deadline 等待第四任务落入**合法**落点并分别核对：

- **合法落点枚举**（`SPAWN_FAILURE_LEGAL_STATES`）：`failed` 或 `needs_review`。`pollTask` 以 `waitWithin(deadline, 10000)` 有界轮询；超时即失败并点名最后观测状态——`queued/running/cancelling` 超时按派工必须失败，不被当作关闭。
- **`failed` 落点**（失败信封／退出态）：`classifySpawnFailureResolution` 断言失败信封在位且形状合法（`code`/`message` 非空、`retryable ∈ {auto_backoff,manual,none}`、`sideEffectSafety ∈ {proven_safe,unknown,proven_unsafe}`，web-api/1 §3/§4.6）；spawn 失败从未拉起 worker，按 §4.6 执行前失败先例（`credential_unavailable`）必须 `attemptExitState='exited_confirmed'`（不占槽）；终态 `cancelIntent=false`（§3.1）。
- **`needs_review` 落点**（注册 recovery cause／占槽语义）：`recovery.cause` 必须属冻结注册白名单（§4.4 九个 cause）、`recovery.itemVersion` 为数字（resolve 入口的乐观锁）；`attemptExitState` 必须为 `exited_confirmed` 或 `exited_unknown`（不得仍 active/exiting）；`exited_unknown` 时另行核验占槽语义——`POST /api/tasks/{id}/resolve` 必须 409 `exit_unconfirmed`（§3.5/§4.5）。
- **前三任务**：改为同一 deadline 内逐一 `pollTask` 到 `succeeded`（原为终态即返回、末尾无界读回）；精确 4 次 attempt、场景序列 `[well-behaved×3, null]`、耗尽错误文案（`/exhausted/`、`3 scenario(s) registered, attempt 4`）与零候选断言全部保留，attempt 计数断言移到第四任务合法落点之后（claim→spawn 序列已必然发生，消除竞态）。
- **聚焦负对照**：新增纯表用例 `spawn-failure resolution table: the two legal landings classify and a permanently running task is rejected`——两个合法落点分类通过，16 个非法落点全部被拒（永久 `running`、仍 `queued`、卡 `cancelling`、无人取消的 `cancelled`、工厂被绕过的 `succeeded`、无信封/缺 code/未注册 retryable|sideEffectSafety 的 `failed`、仍占槽的 `failed`、终态带取消意图、无 recovery 对象/未注册 cause/缺 itemVersion/attempt 仍 active|exiting 的 `needs_review`）。该例是"第四 attempt 非 succeeded 不得当合法失败"的可证伪证明；自检中它当场抓出并修正了分类器 `new assert.AssertionError(message)` 的参数形状错误（须传 `{message}`）。

## 2. 剩余面二：清理预算从剩余硬截止派生（两个清理 helper）

- **工作截止与硬截止分离**：`caseDeadline()`（工作轮询边界，20000−2000）与新增 `caseHardDeadline()`（聚合 `--test-timeout=20000` 强制）之间保留 2000ms 清理余量；全部清理等待从**剩余硬预算**派生。
- **`protocol-worker.mjs` `factory.cleanup(hardDeadline)`**：截止时间为必需参数（缺失即命名失败，不再接受无参调用）；先终止自建进程（全部 worker SIGKILL、注册表内孙进程 SIGKILL），再**逐一核实**每个记录 pid 确已消失（`process.kill(pid,0)`；存活者按剩余预算重试 SIGKILL）；剩余预算 ≤0 或任何幸存者即显式失败（终止先行，无余量也先杀后报）。退役：固定 5000ms exit 等待与固定 2×100ms 重试轮。
- **`backend-process.mjs`**：新增 `terminateAndVerify(child, hardDeadline, label)`（SIGTERM→有界等待→SIGKILL→有界等待→以 `exitCode/signalCode` 核实，Promise 超时绝不代签退出）；`release()`（启动失败路径）改用它——退役 5s unref'd Promise 超时掩盖；子进程句柄 `waitExit()` 改为无参、从句柄携带的 case 硬截止派生（退役固定 15000ms 默认，超时即拒绝）；`close()` 先终止核实再删配置目录——退役 `.catch(() => child.kill('SIGKILL'))` 的吞错。`startBackendChild` 接收 `hardDeadline`；release 自身失败时以组合错误同时呈报原启动失败（`cause` 保留）。
- **调用点**：queue 套件 8 处 `factory.cleanup()` 全部传 `hardDeadline`；T-7 两个 `startBackendChild` 传 `hardDeadline`、`first.waitExit(5000)` 改 `first.waitExit()`；T-7 两个 finally 的吞错 catch 移除（清理失败显式冒泡，不再被 Promise 超时掩盖）。

## 3. 关闭矩阵（`cabfdbe` 之后的两项剩余根因）

| 项 | 剩余根因（队长 `01a1bc2a` 亲核 `queue:1114-1121` 与两个清理 helper） | 本轮关闭方式 | 状态 |
|---|---|---|---|
| 状态闭合 | 用"非成功"替代合法状态闭合 | §1：同一 deadline 等合法 `failed`/`needs_review` 并分别核对信封/退出态或注册 cause/占槽（resolve 409）；active 态超时必失败；取消/无信封被分类器拒绝；补永久 running 负对照 | 关闭 |
| 清理预算 | 清理另起固定 5s/15s 等待 | §2：工作/硬截止分离保留 2000ms 余量；`factory.cleanup`、子进程 close/退出核实/release 及全部调用点从剩余硬预算派生；先终止再逐一核实；无余量/幸存者/缺截止显式失败 | 关闭 |
| `cabfdbe` 13 项 | 已关闭结论 | 未改面保留，本轮零触碰 | 保持 |

## 4. 写入范围（II 冻结范围内）

| 类别 | 文件 |
|---|---|
| 改夹具 | `tests/fixtures/web-text-intake/protocol-worker.mjs`（cleanup 预算派生、终止先行、逐一核实、显式失败）、`tests/fixtures/web-text-intake/backend-process.mjs`（`terminateAndVerify`、release/waitExit/close 预算派生与退出核实、原失败保留） |
| 改套件 | `tests/integration/web-text-intake-queue.test.mjs`（`caseHardDeadline`、T-7 子截止与 finally、8 处 cleanup 调用点、耗尽用例合法闭合、新增 spawn-failure 负对照表） |
| 文档 | 本篇 |

未写：I 的 unit/Rust/server/frontend、III 的构建/守卫/`package.json`/公共文档、`tests/fixtures/web-manual-items/**`、`domain/shared/runtime/vendor`、其余三套件（http/controlled-model/static 零改动）。自检 harness 属本机证据（`build/web-text-intake-tests/protocol-selfcheck-r5.mjs`，build 已忽略），随附件交付、不入库。`docs/reviews/README.md` 索引归 III，未动。

## 5. 机械与聚焦验证（本树实跑）

- `node --check`：2 夹具 + queue 套件 + 自检 harness 全部通过。
- `npm run check:docs` exit 0；`npm run check:structure`：本轮写入文件 0 违规（仓库模式剩余违规均为开工前已存在的平台 `.kimi/` 漂移与全新树 vendor/pi 基线，如实保留）。
- **夹具自检 9/9**（`build/web-text-intake-tests/protocol-selfcheck-r5.mjs`，直接驱动真实夹具与真实 test-owned backend 子进程，总耗时约 1.2s）：A1 三场景直驱＋孙进程登记且在案＋budget 派生 cleanup 全部核实退出（报告 survivors 空、全部 pid 消失、二次 cleanup 幂等、耗时 <2s——证明不再是每 worker 固定 5s）；A2 第四次 attempt 显式耗尽报错且 attempt 计数精确；A3 缺截止参数命名失败；A4 无余量显式失败且挂起 worker 仍被终止；A5 400ms 紧预算仍逐一核实退出（<1.5s）；B1 真实 backend 子进程 close 终止并核实退出（<5s，退役固定 15s）；B2 killHard＋waitExit 核实退出；B3 过期截止 close 显式失败且子进程已终止；B4 启动失败路径 release 核实退出并原样呈报原失败。
- **聚焦用例实跑**（base 树，I/III 未集成；TAP 随附件）：

| 聚焦项 | 结果 |
|---|---|
| queue `staged resolution table`＋`spawn-failure resolution table`（纯表，无 backend） | **通过** 2/2（0.43s；新表 16 个非法落点全部被拒，含永久 running） |
| queue `protocol scenario exhaustion`／`protocol cleanup` | 命名 405 缺口失败（`source submit must succeed; got 405 method_not_allowed`；finally 的新 `factory.cleanup(hardDeadline)` 在失败路径静默通过，未改动失败面貌） |
| queue T-7 | 命名 404 缺口失败于 `drainTasks`（base 树共享 backend 无 `/api/tasks`；子进程 close/退出路径由自检 B1–B4 在真实 backend 子进程上实证） |
| queue `workerRunLimitMs range` | 命名缺口失败（base 入口未校验私有键范围） |

- 编译准备（用例外）：`npm ci --ignore-scripts`（vendor/pi）exit 0；`npm run probe:prepare-pi` exit 0（provenance tree `e89822b0…`＝W1 登记）；`npm run probe:bundle` 产出 `build/s0-runtime`（organizer/node 在位；可选 lark-cli 复制处按已知基线非零退出，organizer 路径不依赖）；`cargo build --manifest-path src-tauri/Cargo.toml --bin web-backend-storage` exit 0。
- **未整跑四套业务测试**（已知缺 I/III 前置，按派工只跑必要机械/聚焦检查）；业务断言按设计显式失败的状态与前轮一致，无任何新绿声明。
- 证据脱敏核查：附件内合成秘密 0 命中、配对码/cookie/CSRF token 0 命中；哈希清单 `SHA256SUMS.txt` 随附件。

## 6. 缺口、观察项与未验项（集成轮输入，不代签）

- **I/III 未集成**：第四任务的合法落点（信封字段、recovery cause、resolve 409）与全部整理业务断言仍只能在集成版首次真实通过；本树证明的是分类器可证伪性、清理预算派生与退出核实机械，以及失败路径的命名面貌。
- **私有键生产语义**：`workerProcessFactory`/`workerRunLimitMs` 的校验与 spawn 失败的生产映射（code/retryable/sideEffectSafety 取值、是否 parked）以 I 实现为准；分类器对两个冻结合法分支都断言完整不变量，第三落点即失败。
- **未验证**：真实模型/真实凭据/用户根/Linux/代理（未授权未执行）；完整 `npm run check`（III 在稳定集成版另派串行执行，本候选不代跑）；`package.json` 的 `test:web-text-intake` 聚合属 III 写入范围，未动。
- 本篇增量（`1bfc352` 之上）供 OhMyPi 按队长派工只复核这两个剩余面；本篇作者不自签，MAYNE-24 保持 in_progress。
