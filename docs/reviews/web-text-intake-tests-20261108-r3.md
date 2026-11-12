# W1 文本整理验收套件再修订候选（MAYNE-24 Stage 4 / II 第三轮）

> 本篇是 MAYNE-24 II（Kimi：真实 HTTP／持久队列／受控 Pi／同源 UI 验收）在第二轮候选 `ab7f6090a8dd10a85c8d85184f6905aab9cc4d3e`（tree `aed1c35a524b2410bff0b57b8ef2ec9fb7b89348`）之上的修订交付登记，落实队长 2026-11-08 评论 `01a1bbc2-e65a-73b5-a35f-0edc17171b4a`：该修订暂不准入集成，II 沿原范围修正两项已核实问题。输入不变：最终 P1 契约 `b190f7c6`（`docs/engineering/web-text-intake-contract.md`，SHA-256 `5982c062…`）与 P2 验收矩阵 `43433ae5`（T-1–T-14，SHA-256 `2d647417…`），均 `git show` 提取并复算一致。本篇不实现业务、不改 I/III 文件、不宣称任何业务通过；公开业务契约不变，一切新增只涉及测试私有夹具与定点断言。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。第一轮 `b463f18`／第二轮 `ab7f609` 登记原文保留，未改写。

## 1. 修正项一：用例预算——撤回全部超额覆盖，同一总 deadline 收紧轮询与清理

**已核实问题**：第二轮为 queue/static 套件用例显式声明 `timeout: 60000/90000/120000/180000`，违反工单冻结的 20000ms 用例预算（聚合以 W1 同款 `node --test --test-timeout=20000` 执行）。

**修正**：

- **全部撤回超额覆盖**：queue 13 例、static 6 例的显式 `timeout` 一律移除，用例回归冻结默认预算；两套件的 `before` 钩子（backend/model 启动、静态根解析＝编译准备）保留自身预算，即工单许可的用例外。
- **同一总 deadline 模式**：每例入口取 `const deadline = caseDeadline()`（20000ms 预算留 2000ms 余量）；所有轮询与清理从该 deadline 派生（`timeLeft`/`waitWithin`：上限封顶后再受剩余时间二次约束），任何单项等待都不可超过用例总预算，失败也在预算内以命名错误浮现，不再被预算杀掉呈现假超时。
- **轮询/清理收紧**（均为内部等待背衬，断言一字未减）：

| 位置 | 原背衬 | 现背衬 |
|---|---|---|
| `drainTasks` 默认 | 90000（且等待全部终态） | 8000，且只等无 `queued/running/cancelling` |
| T-5 形状/加并发轮询 | 25000 ×2 | ≤10000（受 deadline 约束） |
| T-5 排空循环 | 90s 独立 deadline | 同一 case deadline |
| T-6 取消运行/终态/SIGKILL/needs_review | 25000/40000 | ≤10000 |
| T-7 快任务/形状轮询 | 40000/25000 | ≤10000 |
| T-7 子进程 ready | 30000（×2） | 8000；`waitExit` 15000→5000 |
| 两客户端 SSE 帧等待 | 30000/60000 | ≤10000 |
| 协议段 `pollTask` | 10000/8000 | ≤10000 / ≤6000 |
| static CLI 启动轮询 | 30000 | ≤12000 |
| static 整理旅程来源/任务轮询 | 20000/60000 | ≤8000 / ≤10000 |
| 配对码等待 `pairingTimeoutMs` | 20000 | 6000（GAP-2 命名缺口必须在预算内浮出） |
| browser-probe CDP 背衬 | 20000/30000 | 10000/10000（失败仍为命名错误） |

- **不削弱覆盖、不拆散关键原子旅程**：T-5/T-6/T-7、两客户端、协议 6 例、CLI、配对旅程、整理旅程的断言与步骤原样保留；GAP-3 缺省时限对照的 5s 观测窗是有意对照（证明缺省 120000 未触发），在预算内保留。
- **唯一结构性变更（隔离副作用，非拆散旅程）**：T-6 SIGKILL 例改用专用 backend（`startCaseBackend`，与协议段同一helper）。原因：该例按设计把 attempt park 成 `exited_unknown` 且 `resolve` 409 拒绝，槽位在共享 backend 上被永久持有——集成轮后续用例（T-7、两客户端）会全部排在死槽后假超时。旅程本身（三真实 Pi worker 跨进程树 SIGKILL → needs_review/exited_unknown/占槽/resolve 409/新提交保持 queued）不变，只隔离其副作用。
- **连带修正（集成轮才会显现的结构性问题）**：`drainTasks` 原语义等待全部任务终态，而 SIGKILL 例留下的 `needs_review` 永不到终态，集成轮必致假超时；已改为只等待仍占用 worker/槽位的活跃态（parked 态的不变量由制造它的用例断言）。

## 2. 修正项二：`assertStagedResolution`——暂存成功落入 `failed` 必须证伪

**已核实问题**：原实现对 `succeeded || failed` 一律按「退出已确认」接受并直接返回——成功结果已暂存后落入 `failed` 会被放过，正是必须拒绝的错误落点。

**修正**：纯函数 `classifyStagedResolution(task)` 落地冻结迁移表，两个合法落点都核对**原暂存成功结局**：

- `attemptExitState=exited_confirmed` → 必须 `succeeded` 且 `cancelIntent=false`、`resultPendingExit=false`，数据库发布原候选（`pending`）；
- 否则 → 必须 `needs_review` + `exited_unknown` + `recovery.cause=result_exit_unconfirmed`，暂存行保留、`pending` 零、占槽不可签收；
- 任何第三落点（`failed`、`cancelled`、无确认退出的 `succeeded`、未注册 cause、仍 `running` 等）立即证伪失败，失败信息点名非法落点。

**聚焦验证（能拒绝该错误落点）**：queue 套件新增无 backend 纯表用例 `staged resolution table: ...`——对 2 个合法落点断言分类结果，对 10 个非法落点（含「确认退出后 landed failed」「无确认退出 landed failed」「确认退出后 cancelled」等）断言 `assert.throws(..., assert.AssertionError)`。该例不依赖 I 前置，本树 base 实跑通过（见 §4）。

## 3. 写入范围（II 冻结范围内）

| 类别 | 文件 |
|---|---|
| 改套件 | `tests/integration/web-text-intake-queue.test.mjs`（预算模式、drain 语义、SIGKILL 例专用 backend、迁移表重写+聚焦用例）、`tests/integration/web-text-intake-static.test.mjs`（预算模式、CLI/旅程轮询、配对等待） |
| 改夹具 | `tests/fixtures/web-text-intake/browser-probe.mjs`（CDP 背衬收紧，断言不变） |
| 文档 | 本篇 |

未写：I 的 unit/Rust/server/frontend、III 的构建/守卫/`package.json`/公共文档、`tests/fixtures/web-manual-items/**`、`domain/shared/runtime/vendor`。http 与 controlled-model 两套件本轮**未改**：其内部轮询背衬（30000/40000）属第一轮候选内容且在失败路径才触及，不属本轮两项已核实问题，作为观察项列 §5 交集成轮/OhMyPi 增量独审。`docs/reviews/README.md` 索引归 III，未动。

## 4. 机械与聚焦验证（本树实跑）

- `node --check`：4 套件 + 相关夹具全部通过。
- `npm run check:docs` exit 0；`npm run check:structure`：本轮写入文件 0 违规（仓库模式剩余违规均为开工前已存在的平台 `.kimi/` 漂移，如实保留、未过滤签绿）。
- **聚焦用例** `staged resolution table`：本树 base（I 未集成）实跑通过（0.77s，含 before 钩子启动）——纯表判定不依赖业务前置，证明修正后的迁移表拒绝错误落点。
- **负对照（证伪能力实证）**：把 r2（`ab7f609`）的判定（`succeeded || failed` 一律接受）注入 queue 套件副本（仅写 `build/`，gitignored，套件本身未改），同一聚焦用例在该副本上**失败**：`Missing expected exception (AssertionError): the staged-resolution table must reject a staged success landing failed after a confirmed exit`——证明该聚焦验证确实能否决错误落点，而非永远通过。
- **聚焦机械**：queue `settings` 例（重构后的 drain/deadline/SSE 机械）跑至命名缺口（`GET /api/tasks` 404，I 未集成）；static `browser cold start` 1440/640 两例通过（1.98s/1.89s，远低于 20000ms 预算，验证收紧后的 browser-probe CDP 背衬未削弱 happy path）；static `packaged CLI` 例以命名 GAP-1 PrerequisiteGap 快速失败（0.24s，历史失败事实保留）；static 配对旅程以命名 GAP-2 PrerequisiteGap 失败于 12.7s（旧 20s 配对等待会被预算杀成假超时，现改名缺口在预算内浮现）。
- 协议夹具（`protocol-worker*.mjs`）本轮**零改动**（与 r2 已自检状态逐字节一致，`git diff ab7f609` 可证），其 7 项协议机械自检结论随 r2 登记保留，未重跑。
- 编译准备（用例外，仅为让聚焦用例的 before 钩子可起 backend）：`npm ci --ignore-scripts`（根与 vendor/pi）exit 0；`npm run probe:prepare-pi` exit 0（provenance tree `e89822b0…`＝W1 登记）；`npm run probe:bundle` 产出 `build/s0-runtime`（organizer/node 在位；可选 lark-cli 复制处按已知基线非零退出，organizer 路径不依赖）；`cargo build --manifest-path src-tauri/Cargo.toml --bin web-backend-storage` exit 0；`npm run build:backend` exit 0（storage 二进制 2633392B，SHA-256 前缀 `b7dd9339…`＝W1 登记值）。
- **未整跑四套业务测试**（已知缺 I/III 前置，按队长指示只跑必要机械/聚焦检查）；业务断言按设计显式失败的状态与第二轮一致，无任何新绿声明。

## 5. 缺口、观察项与未验项（集成轮输入，不代签）

- **I/III 未集成**：全部整理业务断言仍显式失败（路由 404/405、schema_version=2、intake tab 禁用、第二配对码未发放、私有键未校验）；GAP-1/GAP-2 归 I 的命名失败事实原样保留。
- **观察项（不阻断，交集成轮）**：http 套件 `waitForTask` 默认 30000、controlled-model 套件轮询 40000 为失败路径背衬、超过 20000 用例预算；二者均属第一轮候选内容，如需可按本轮同一 deadline 模式收紧（不改变断言）。
- **私有键生产语义**：`workerProcessFactory`/`workerRunLimitMs` 的校验、超时路径 cancel/杀细节、进程树退出核实范围，以 I 实现为准；协议段对两个冻结合法分支都断言完整不变量，第三落点即失败（本轮起含 `failed` 证伪）。
- **未验证**：真实模型/真实凭据/用户根/Linux/代理（未授权未执行）；完整 `npm run check`（III 在稳定集成版另派串行执行，本候选不代跑）；`package.json` 的 `test:web-text-intake` 聚合属 III 写入范围，未动。
- OhMyPi 增量独审（`b463f18..ab7f609`）待关闭两项即本篇 §1/§2；本篇增量（`ab7f609` 之上）供作者下一修订复核。本篇作者不自签。
