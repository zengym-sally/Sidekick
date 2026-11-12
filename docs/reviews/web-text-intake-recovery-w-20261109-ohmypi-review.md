# W 一文件修改面限定独审（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1be1b`（MAYNE-24）。承接已取消的 OpenCode W 审队列，审 `b232828c5850d90759ca436bfd3b4d0d0e478c74` 的 **W 一文件修改面**，沿 `cd5f6c1` 已过面复用。
> 本项与 OhMyPi 自己的前端作者证据签署**分开**，不自审前端。

## 1. 范围与身份

- 候选：`b232828`（tree `5f27dc5f4127d6b8647bfdc5559935e29b2a5296`，父 `c05e545`）。
- 修改面复算：`adc31d8..b232828` 恰 **1 个测试文件 +73/−14**（`tests/unit/web-text-intake-recovery.test.mjs` 742→801 行）；两个 fixture（`recovery-instance.mjs` `256001ac…9065`、`recovery-stub-worker.mjs` `8e76c570…c484`）**逐字节未变**；另两份 docs 为 ZCode 评审记录，非本修改面。
- 生产树：`5926cbc`（该测试的既定目标树，`cd5f6c1` 已登记）。
- 前置复建：`cargo build --release --bin web-backend-storage` → **2649408 B、sha256 `42af54b5…490fc2`**，与既往登记逐字节相同。
- 运行树：`git archive 5926cbc` + `b232828` 三测试文件原字节覆盖，`git hash-object` 逐一相等；候选树零改动。

## 2. 结论

**W 修改面：通过（限定范围）。** 拆分方向、两触发分离、公开码/默认 retryable、unknown→needs_review 的判据均符合 `01a1bdda` 裁定与冻结 `web-api/1` §4.6；400ms 复采样**不吞错、不代签原子性**（详见 §4）。

**但本审在 `5926cbc` 上新发现两处耦合生产缺陷（D-1/D-2）**，是 W(worker loss) 失败的根因，且二者不能各自单独修——见 §5。测试本身可证伪性成立，失败**不是**夹具问题。

## 3. 独立复跑（数字为本审新跑，未沿提交信息）

命令：`node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs`

| 运行 | 结果 |
|---|---|
| 全套 11 例 | **2 过 / 9 败**（exit 1，suite 67.19s，stderr 0 字节） |
| 仅两条 W | W(deadline) **PASS** 7.87s；W(worker loss) **FAIL** 5.63s |

- W(deadline) 通过：`state=needs_review`、`failure.code=model_request_failed`、`retryable=auto_backoff`、attempt 行 `ended_at` 非空且 `exit_reason='confirmed'`。
- W(worker loss) 失败点精确：`AssertionError: the registry code stays in failure.code`，`actual 'model_request_failed' / expected 'worker_lost'`（`:735`）。**尚未到达**其后的 `retryable` 与 state 断言。

## 4. 对派工三项核对的裁定

**4.1 两种触发确实分离——成立。**
- W(deadline)：`setup({stubMode:'bare', runLimitMs:1200})`。`bare` 夹具不发射任何帧并挂起，由**后端独立时限**（`worker-host.mjs:368-373` 的 `deadlineTimer` → `enforceDeadline`：cancel 帧 → 宽限 → 组 SIGTERM → 宽限 → 组 SIGKILL）击杀。这是超时，不是进程意外死亡。
- W(worker loss)：`setup({stubMode:'lifetime', stubLifetimeMs:500})`，**不传** `runLimitMs`（默认 30000）。夹具 `:79-80` 在 500ms 后 `exit(1)`、零帧。这是无时限的意外死亡。
- 两条路径的 stub 模式、时限配置、退出方式三者皆不同，分离成立。我另用独立探针（`evidence/probe-two-w-triggers.mjs`）复现 worker-loss 面落库：`state=needs_review`、`code=model_request_failed`、`internalCode=worker_lost`、`retryable=auto_backoff`、`sideEffectSafety=unknown`、`cause=failure_unknown_side_effect`、`exit_reason=confirmed`——与测试失败形态一致，非夹具偶发。

**4.2 公开码/默认 retryable 与 unknown→needs_review——判据正确，实现在目标树不符。**
- 冻结 `web-api-contract.md:210` 钉死 `worker_lost → manual`；`:87` 要求 interrupted 恢复 `failure.code=worker_lost`、`retryable=manual`。W(worker loss) 断言与此逐字一致。
- W(deadline) 断言 `model_request_failed`/`auto_backoff`：`task-scheduler.mjs:206-209` 对 `deadlineTriggered && outcome!=='succeeded'` 显式置 `model_timeout → model_request_failed/auto_backoff`，与「内部 model_timeout → 公开 model_request_failed」的既定映射一致。
- unknown→needs_review **独立于 retryable** 这一点，W(deadline) 已实证成立：`task-service.mjs:725-728` 在 `retryable==='auto_backoff'` 分支内以 `sideEffectSafety!=='proven_safe'` 转 `markNeedsReview`，未为了 manual 断言强制留 failed。

**4.3 400ms 复采样不吞错、不代签原子性——成立，且其边界已核清。**
- 复采样是**稳定性判据**而非首次命中：先读一次，`sleep(400)` 后再读，**要求两次 state 相等**才接受。瞬态（两事务未落完）会被拒并继续轮询，不会把中间态当终态。
- 它**不能**吞掉错误信封：`failure.code`/`retryable` 是在 settle 之后**另起独立读取**（`ctx.taskService.query('SELECT failure …')`），与轮询解耦。
- 它**不能**代签原子性：两事务窗口仍是观察项，测试不声称原子性已闭（头部与注释均如此写明）。
- 判据接受集 `{needs_review, failed}` 看似宽，但**最终断言是 `assert.equal(settled.state,'needs_review')`**，宽集只用于「已沉降」判定，不放宽结论。若某错误态稳定存在，复采样会稳定接受它——这是任何轮询判据的固有上限，本审如实登记，不视为测试缺陷。

## 5. 新发现：两处耦合生产缺陷（`5926cbc`，非测试问题）

**D-1（根因）`server/lib/text-intake-service.mjs:810`** 对「已核实退出且无暂存结局」的 extract 收尾**硬编码**：
`{code:'model_request_failed', internalCode:'worker_lost', retryable:'auto_backoff', sideEffectSafety:'unknown'}`。
后果：`worker_lost` 永远进不了公开信封（被降格进 `internalCode`），且 `auto_backoff` 与契约 `manual` 相反。同时 `task-service.mjs:29` 的 `normalizeFailure` 也把 `worker_lost` 与 `model_timeout` 一并改写为 `model_request_failed`，是同一偏差的第二处。

**D-2 `server/lib/task-service.mjs:722`** `maybeAutoRetry` 以 `if (failure.retryable !== 'auto_backoff') return null;` **挡在安全路由之前**：`manual` + `sideEffectSafety='unknown'` 因此停在 `failed`，永远到不了 `:725` 的 `markNeedsReview`。即 §4.6「无法证明即 unknown，转 needs_review」在该组合下**不独立于 retryable**。

**二者耦合，不能各自单独修**（本审用 scratch 实证，未交付、已还原）：
- 只修 D-1（`:810 → worker_lost/manual`）：W(worker loss) 前进到 state 断言并以 `failed ≠ needs_review` 失败——暴露 D-2。
- 再删 D-2 的 retryable 门：W(worker loss) **转 PASS**，但 **W(deadline) 回归**（`worker_lost ≠ model_request_failed`）——因为两条 W 面共用 `:810` 同一个字面量，而 `confirmExtractExit(taskId, attemptId, {exited, cancel, epoch, force})` **没有 `deadlineTriggered` 入参**，`worker-host` 已算出的 `deadlineTriggered`（`:351/:371`）没有传到该分支。

**修复方向（交生产作者，非本审实施）**：把 `deadlineTriggered` 经 `onWorkerDone → confirmExtractExit` propagate 到 `:810`，使超时面落 `model_request_failed/auto_backoff`、意外丢失面落 `worker_lost/manual`；并把 §4.6 安全路由改为**不**以 `retryable` 为前置（`unknown` 即转 `needs_review`）。两条 W 面正好是这两个判据的正反控。

## 6. 边界（不代签）

- 未改测试、生产、package、DDL/Runtime；未跑完整 `npm run check`。
- 只跑了必要的 W 正反控与全套一次；未重复整轮浏览器运行（本项无浏览器面）。
- F1 末条夹具/候选归因仍归 ZCode 既有修订任务，本审不裁。
- PC2 等构造前置标注沿用 `cd5f6c1` 既有登记。
- 20s 预算：最慢单例 W(deadline) 8.28s（含 400ms 复采样与 settle 窗口），在 20000ms 内；全套 suite 67.19s 为 11 例累计，未以整轮时长当单例超时。
- scratch 修改（D-1/D-2 探针用）已全部还原，`diff` 复算两文件与候选字节逐一相同。

## 7. 证据

- 原始证据（gitignored）：`build/w-review/`（`5926cbc` 导出树 + 三测试文件覆盖 + cargo 产物）、`build/w-review/evidence/`（`full-suite-tap.txt`、`w-only-tap.txt`、`wloss-scratchA-tap.txt`、`wdeadline-scratchAB-tap.txt`、`probe-two-w-triggers.mjs`、`README.txt`）。
- 复跑命令见 `evidence/README.txt`。
