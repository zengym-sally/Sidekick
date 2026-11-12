# W1 test-safety 正反控候选限定独审（ZCode，2026-11-09）

> 派发：MAYNE-24 协调评论 `01a1bf13-c61b-7b95-9770-23ec61d22bc5`（Codex，2026-11-09）。
> 评审对象是 Pi 的 test-only 候选（分支 `agent/pi/mayne-24`），本人未参与该实现；
> 只写本评审与本机证据，不改测试／生产，不接入聚合。本记录不自签任何生产候选，也不预签 Kimi 后续安全证明增量。MAYNE-24 保持 `in_progress`。

## 结论

**通过（限定：该正反控作为"真实链安全回归候选"的登记与判据面）。** 四项判据（默认真实 Pi／服务端快照与输入身份／clock 唯一接缝／失败→退避→新 attempt／预算断言）逐条对照冻结契约成立；原样复跑两轮均 1 绿 1 红、退出码 1，红恰落在具名的 GAP-TEST-SAFETY-1 断言，负控经静态与动态双向核验不是空真；20s 用例预算未扩大，清理无残留。scratch 2/2 未作为任何判定依据（按派发明示不接收）。

## 身份（对象库逐字节复核）

- `959f54b95f1f5559f5e9b429f1d685f0bc5a00b5`／tree `11a118f806149ad8e899272ffb4e2769861fa17d`、父 `75d49cb3e1b381d547e06428be5a47e22851e56e`，与登记一致；`diff-tree --root` 恰两个新增文件：`tests/unit/web-text-intake-test-safety.test.mjs`（blob `4ed197de`，内容 SHA-256 `c3d3ce10…`）＋`docs/reviews/web-text-intake-test-safety-20261109-pi.md`（blob `2be9c1ce`）。无新夹具、无 package／生产／Runtime 改动。
- 父链：`959f54b`→`75d49cb`（401/429 取证记录）→`45b1cfe`（II B1/B2/C1，已审）→`7f41f8f`→`0a7ad43`（C-1，已审）→`e0341dc`→`1d6101d`（Mayne-23 基线）。Pi 分支不携带共享夹具目录与 `server/` 生产树，故其记录 §6 登记的隔离分支 `check:structure` 14 条存量 + 4 条同类 `ref.missing` 与字节事实相符（合并 I/II 后消解）。
- 锁定输入：`681c2825bb053b740cc7fdfd7133e75384389139`（tree `754b790811d8c09732463cafdf6e93d4feff0284`），测试自源码入口 `server/entries/web-backend-entry.mjs` 导入 `startWebBackend`；生产字节按该提交调用。

## 判据逐条（对照冻结契约与 681c282 生产字节）

### ① 默认真实 Pi

- `before` 首行断言 `runtimeRootAvailable()`（`build/s0-runtime` 必含 `organizer.mjs`＋`node`），`startWebBackend` 传 `runtimeRoot: bundledRuntimeRoot`；不传 `workerProcessFactory`（entry `:91` 为 `?? null`）→ 真实 WorkerHost 拉起真实 Pi。
- 受控模型服务只替模型面（loopback 脚本应答，W1 既有夹具），输出契约校验发生在真实 Pi 内：负控首答 evidence 非原文子串、正控 test 首答 `{ok:false}`，均由真实 runtime 依 `runtime/lib/organizer-contract.mjs`（test 契约要求恰 `{ok:true}`，`:29`）拒为 `MODEL_INVALID_OUTPUT`，经 `FAILURE_CODE_ALIASES`（task-service `:48`）映射为注册码 `output_contract_invalid`。模型请求事实读自受控服务的请求台账（`model.requests()`）。
- 无脚本化 worker、无替写调度：测试对生产唯一的状态干预是下述 clock 接缝。

### ② 服务端快照与输入身份

- `tasks-create` → `snapshotForTest` 先剥离客户端 `snapshot`/`skills` 再服务端派生（RS-1 已审面）；extract 路径 `submitSource` 只读 `input.text`/`timeZone`/`sourceAt`（text-intake-service `:240-263`），客户端 `sideEffectSafety`/伪造 `snapshot` 不可达任务 `input_ref` 与失败信封。
- 两个用例都断言 `input_ref.snapshot.provider.id/model.id` 等于受控配置（`PROVIDER_ID`/`MODEL_ID`）；负控伪造面把 `sideEffectSafety:'proven_safe'`＋rogue snapshot 真实发上线（200 受理），随后断言判定不变、`input_ref.snapshot` 仍为服务端派生值——伪造字段被服务端忽略是承载性断言，不是恒真。
- 输入身份：`operationId` 幂等键＋`ID_PATTERNS.task` 断言；`GET /api/tasks/{id}` 200 判定 settle。

### ③ clock 唯一接缝

- `TaskService` 构造器既有 `now = () => Date.now()` 选项（`:152`），内部全部时钟读经 `this.now()`（`claimNext` `:778`、`maybeAutoRetry` `:816`、`submit`、`confirmExit` 等）；测试仅在 `before` 中赋值该既有实例属性并断言生效，未新增任何生产开关（候选 diff 仅两文件，字节核验无开关）。
- `AUTO_BACKOFF_MS = 60_000` 仅重述生产常量（task-service `:20`）作时钟推进量；`claimNext` 的 `(next_attempt_at IS NULL OR next_attempt_at<=?)` 门由同一 `now` 驱动，故"到期前不认领／到期后可认领"完全在该接缝内。
- 登记精度备注（MINOR，非缺陷）：测试头注称该选项是"生产入口已使用的选项"，实际 entry 构造 `new TaskService({ storage, epoch })` 未传 `now`（entry `:75`）；"既有接缝、无新增开关"的实质成立，措辞按此更正。
- 用例顺序依据核实成立：001 DDL `task_attempts` 有 `CHECK (ended_at >= started_at)`（001_web_backend.sql `:71`），extract 收口的 `ended_at` 用 TextIntakeService 自有时钟（真实时钟，text-intake `:834→:876`），而 `started_at` 来自受控的 `claimNext` 时钟——若正控先推进时钟再跑负控 extract，会产生 `ended_at<started_at` 的夹具级误伤。负控在前使两控独立，排序理由与字节一致。

### ④ 失败→退避→新 attempt／预算断言（冻结 §4.6／§3.2）

- 注册表：冻结 web-api 契约 §4.6 表列 `output_contract_invalid | auto_backoff`（"自动重入队仅当失败点在所有外部副作用工具调用之前，否则转 needs_review"）；生产 `FAILURE_REGISTRY` 同值（`:30`）。正控观测面断言 `failure.code`/`failure.retryable` 恰为该注册行为，绿。
- 安全路由优先：冻结"§4.6 转场表 + 自动重入队守卫"（`retryable=auto_backoff` 只是必要条件，`sideEffectSafety=proven_safe` 才放行，否则 `needs_review`/`cause=failure_unknown_side_effect`）＝生产 `maybeAutoRetry` 先判安全再判重试（`task-service :816-820`）。当前链零回执失败一律 `unknown`→`needs_review`：负控把它钉为绿，正控把它钉为具名红的根因。
- 目标序列逐项映射生产：`proven_safe`→重入队 `queued`＋`next_attempt_at=now+60000`＋`attempt_budget-1`（`:829-847`）；预算耗尽降级 `manual`、`nextAttemptAt=null`（冻结 §4.6 场景 26 语义）；`claimNext` 门实现"到期前不认领"；二轮 attempt 对standing 合法答案成功后 `attempt_budget=2`、恰 2 条 attempt、回执仍 0。目标断言与生产字节与冻结语义三方一致，转绿条件唯一落在"后端可信安全证明"（Kimi 增量）。
- 无注入核验：无 `proven_safe` 注入、无脚本化 worker、无替写调度逻辑；`startWebBackend` 调用面仅用其公开配置项。

## 原样复跑（本审独立证据；不代签 Pi 的 TAP）

- 运行树：detach `681c282`（`git status` 零跟踪改动，生产字节＝锁定提交）＋恰一文件 overlay 候选测试（`4ed197de`，SHA-256 `c3d3ce10`）；复用并逐哈希核验的存储二进制 `42af54b5…490fc2`（2649408 B，置于运行树 `build/web-backend/bin/`）与 `build/s0-runtime`（`organizer.mjs` `08f32db2…`，与登记一致）；node v24.20.0。
- 命令按 Pi 记录原文：`node --test --test-timeout=20000 --test-reporter=tap tests/unit/web-text-intake-test-safety.test.mjs`。
- **run1**：`tests 2 / pass 1 / fail 1`，退出码 1；负控 2366ms、正控 420ms（红于 GAP 首断言，故退避段未执行）、整表 6864ms。**run2**：同 1 绿 1 红、退出码 1；827ms／402ms／5308ms。两轮确定，与 Pi 登记的"两轮独立运行均 1 绿 1 红"一致。
- **红恰在具名缺口**：`not ok 2` 的失败即 `GAP-TEST-SAFETY-1` 断言（测试 `:389`）——actual `'unknown'` vs expected `'proven_safe'`，实测失败信封 `{"code":"output_contract_invalid","message":"整理进程返回错误。","retryable":"auto_backoff","sideEffectSafety":"unknown","cause":"failure_unknown_side_effect"}` 与 Pi 记录 §3.2 引文逐字节一致；因断言顺序执行，其前全部观测事实断言（恰 1 次模型请求、`hasTools=false`、零回执、恰 1 attempt、`exit_reason=confirmed`、服务端派生 snapshot、注册码/可重试类）均绿——红归因于"后端无可信安全证明"这一具名缺口，非夹具或链路缺陷。
- **负控非空真**：断言全部绑定生产派生事实——受控服务台账恰 1 次请求、真实 `side_effect_receipts` 表计数 0、`needs_review` 状态、生产写入的 `cause=failure_unknown_side_effect`、`hasNonReadonlyReceipts=false`、无候选落库；伪造面承载（rogue snapshot 在 `input_ref` 中被服务端值取代、客户端证明字段不进失败信封）。反事实核验：若生产按 scratch 方式把零回执提为 `proven_safe`，负控的 `unknown`/`needs_review` 断言即失败——该绿对"零记录补 safe"捷径有否定力，且在当前与目标后端都成立。

## 20s 预算与清理

- 每用例 `caseDeadline = now+20000-2000`，所有等待经 `waitWithin(deadline, cap)` 受余量约束；实测最慢用例 2366ms ≪ 20000ms，两轮整表 6.9s/5.3s。`before` 钩子 90s 为 W1 套件既有的重准备豁免（启动后端/受控服务），聚合命令 `--test-timeout=20000` 不变。
- 两轮结束后核验：本运行零残留进程（organizer/受控服务/存储二进制/入口均被 `after` 的 `model.stop()`→`handle.close()`（scheduler.stop→workerHost.stopAll→sse/http/storage.close）→`rmSync(root)` 链终止）、`/tmp/web-text-intake-test-safety-*` 零残留。机器上另有 4 个他 agent 目录的受控服务进程，非本运行产物，未触碰。

## 不签与范围

- **scratch 不作为依据**：Pi 的临时补丁实验（2/2）按派发不接收为生产安全判定；本审亦无法验证其 scratch 树回退（仅在 Pi 现工作树读到 `TEMP-EXPERIMENT` 计 0，且该树存在其他未提交改动）——此项对结论无影响，因为目标序列的可绿性由生产字节＋冻结契约的静态映射独立支撑。
- **Pi 原始 TAP 不可复核**：交付评论无附件、scratch 树内文件不在可读范围；登记结果以本审两轮独立复现为准。
- **目标路径绿不预签**：`queued`/到期前不认领/时钟推进后二轮成功/预算递减在当前链不可执行（红于 GAP 首断言）；本审只确认其与生产字节及冻结契约的映射正确，Kimi 增量落地后的转绿仍需按派发另送独审。
- **MINOR**：测试头注"生产入口已使用 `now` 选项"措辞不精确（见 ③）；套件不钉 extract 失败码映射（`worker_lost` 硬编码）为记录内明示的非目标，与已登记的 R8-M-3（extract/revise 收口丢弃错误帧码）一致，属诚实缩窄。
- 未接入聚合（`test:web-text-intake` 不加本文件，按派发）；候选字节零改动；未跑完整 `npm run check`（按既定范围）。

## 证据

原始 TAP、stderr、候选两文件提取副本与 SHA-256 在 gitignored `build/mayne24-test-safety-review/`（`SHA256SUMS` 6 件）；运行树与本分支工作区生产字节零改动。
