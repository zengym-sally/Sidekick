# W1 test-safety 第五例：暖宿主回借负控（Pi，2026-11-09）

> test-only 待审候选，不改生产／Runtime／DDL／package／守卫／索引，不扩大 20s 用例预算，不跑完整门禁。本记录不自签任何生产候选。
> 派发：MAYNE-24 协调评论 `01a1c0e0-0633-7a5e-ae98-8a209932f590`（Codex，2026-11-09）。

## 1. 范围与锁定输入

- 交付物：仅修改 `tests/unit/web-text-intake-test-safety.test.mjs`（追加第五例）＋本记录。复用既有专用夹具 `tests/fixtures/web-text-intake/test-safety-runtime-entry.mjs`（blob `4bea6aac91550620a690d0721a4391ff5b3afd7b`，与接收字节一致）与 `test-safety-stub-worker.mjs`（blob `4f3c994031ce961070642352403629afada3805f`）；无生产／Runtime／DDL／package／守卫／索引改动。测试文件新 blob `7c0cb4ba27e41f7baa985a1dae8f2064d95d5e28`（相对接收的 `f72ff6dd` 恰追加第五例）。
- AFTER 生产字节：`cd08588328df27cabdb50f178159424a9534c0b9`／tree `776b252919e1a6eb355c147b542b0d3308c9abe2`（来源判据修订：每次 start 重验执行来源并用已验真实路径 spawn）。
- BEFORE 生产字节：`d2b2696`／tree `542c169dd9bb5f4b039ac9c4fba1c60699ba81bd`（同一 I 分支 tip 文档提交，生产子树即带 per-host 惰性缓存的 `worker-host.mjs`）。
- 运行时：`build/s0-runtime` organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`、node `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`（登记身份，复制后逐一复算命中）。
- 存储：`web-backend-storage` `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，本会话从锁定 `681c282:src-tauri`（tree `48b54730cdaa63df503706b8ec3b48c67826c999`）用 rustc 1.99.1（`58cf8f9c3`）重建，逐字节命中登记身份；未使用旧 `42af54b5`）。
- 运行树：`git archive <commit>` 双提取＋恰三未跟踪 overlay（测试文件＋两夹具）＋`build/s0-runtime`／`build/web-backend/bin/web-backend-storage` 复制；node v24.20.0。

## 2. 第五例设计

派发要求：**同一默认工厂后端、同一私有 `runtimeRoot` 别名，先指向已审根用真实 Pi 完成一次预热任务，再只换私有链接到已审测试专用合成入口，第二个 `test` 任务须 `unknown`／`needs_review`，marker 与当次 `worker.json` 绑定一致**。

- **同一宿主、同一别名**：用例自建临时根与**一个**后端实例，`startWebBackend` **不传 `workerProcessFactory`**（默认工厂），`runtimeRoot` 指向一个私有符号链接别名 `<caseRoot>/runtime-alias`。别名先 `symlinkSync(bundledRuntimeRoot, alias)` 指向已审随包根。
- **预热**：把共享受控模型脚本换成为站立合法 `testAnswer()`，提交一个 `test` 任务。真实随包 Pi 经默认工厂派生已审入口并调用受控模型，任务 `succeeded`。预热自己的 `runs/<runId>/worker.json` 断言 `executionSource.trusted===true`、`reason==='audited_deployment_runtime'`——证明别名当时确实解析到已审根。
- **只换链接**：`rmSync(alias)` 后 `symlinkSync(syntheticRoot, alias)`。合成根 `node` 是系统 node 符号链接、`organizer.mjs` 是已审测试专用入口（`test-safety-runtime-entry.mjs`，即第四例同一夹具）。后端、`WorkerHost` 与配置别名均不变。
- **第二个 `test` 任务**：同一暖宿主提交。入口回显 `runId`＋`hostNonce`、发出恰一个 `type:'error'`、`code:'MODEL_INVALID_OUTPUT'` 帧、无工具／MCP 帧、零回执、延迟 100ms 退出，整树退出经 `verifyTree` 确认——正是类型短路会提升为 `proven_safe` 的形状。
- **marker 绑定当次 worker 记录**：入口把 `{marker, runId, hostNonce, pid, argv}` 写入 worker cwd（即 `caseRoot`）。用例把 marker 与后端自己的 `runs/<runId>/worker.json` 交叉核对：`runId`／`hostNonce`／`pid` 三者相等，`argv[1]=='--run'`、`argv[2]==runId`。即 marker 证明默认工厂确实为本 run 执行了合成入口。
- **判定目标**：任务 `state=needs_review`、`failure.sideEffectSafety=unknown`、`failure.cause=failure_unknown_side_effect`、`failure.code=output_contract_invalid`、`failure.retryable=auto_backoff`；无候选落库。
- **修复证据**：第二个 run 的 `worker.json` 必须描述**实际执行**的产物：`executionSource.trusted===false`、`reason==='artifact_identity_mismatch'`、`runtimeRoot===realpathSync(syntheticRoot)`——不得继承预热对已审根的判决。
- **非空洞**：用例写入合法模型配置与可用凭据，调度器因此启动 worker 而不是以配置类失败码（携带 `proven_safe`）收口；合成入口从不调用模型（baseUrl 为受控服务但入口不访问）。

`GAP-TEST-SAFETY-3`：修订前后端把 per-host 执行来源判决缓存（`worker-host.mjs` 的 `_executionSource` 惰性缓存），第二个 start 继承预热的 `proven_safe` 并自动重排队。该断言为可证伪红，待来源判据按 run 重验并 spawn 已验真实路径后转绿。

## 3. 前后原始证据

命令（仅跑第五例，不重跑已过四例矩阵）：

```
node --test --test-reporter=tap --test-timeout=20000 \
  --test-name-pattern="warm default-factory host" \
  tests/unit/web-text-intake-test-safety.test.mjs
```

### 3.1 AFTER（`cd08588` 生产字节）

`1/1 pass`，exit 0，套件 `duration_ms` 9057（用例体 4972ms），stderr 0 字节（`/usr/bin/time -p` 三行与套件 stderr 分开登记）。原始 TAP：`build/mayne24-test-safety-r5/evidence/r5-after-5.tap`。

### 3.2 BEFORE（`d2b2696` 生产字节，同一测试文件）

`1/1 fail`，exit 1，套件 `duration_ms` 10270（用例体 6182ms），stderr 0 字节。红恒在 `GAP-TEST-SAFETY-3` 的 `sideEffectSafety` 断言：

```
GAP-TEST-SAFETY-3: the warm host re-pointed its private runtimeRoot alias at a synthetic entry, so the execution source is not credibly confirmed and must stay unknown; observed sideEffectSafety=proven_safe state=queued
+ actual - expected
+ 'proven_safe'
- 'unknown'
```

即：预热成功（真实 Pi 经已审根），换链接后默认工厂确实执行了合成入口（marker 三项绑定断言全部先通过），合法身份帧／零回执／确认退出全部成立，但修订前后端授予 `proven_safe` 并自动重排队——暖宿主回借缺口逐字复现。原始 TAP：`build/mayne24-test-safety-r5/evidence/r5-before-5.tap`。

### 3.3 既有四例不弱化

`git diff -U0 tests/unit/web-text-intake-test-safety.test.mjs`：删除断言行 0，新增断言行 29（全部在第五例内）；`node:fs` 导入追加 `readdirSync, realpathSync`。既有四例断言与用例体零改动。本会话在追加第五例**之前**已用同一运行树与登记产物跑过既有四例：`4/4 pass`、exit 0、stderr 0、套件 17.35s（原始 TAP `/tmp/r5-after-4.tap`，未随评论挂载）。

## 4. 边界

- 仅一个测试文件＋本记录；未改生产／Runtime／DDL／package／守卫／索引；未跑完整 `npm run check`／聚合 `test:web-text-intake`；未触真实模型／凭据／用户根（合成密钥仅指 loopback 受控服务，合成入口从不调用模型）。
- 未修改已审包任何字节：`s0-runtime` 与生产字节均从登记来源复制，链接只在私有临时目录内更换；未传替换工厂。
- 临时 R1 脚本已失（派发已注明），本例为全新最小永久回归，不复用、不补造旧脚本。
- nonce 仅留在临时根（marker 与 `worker.json` 均在 `caseRoot` 内，`finally` 删除）；测试只输出比对布尔（断言），不打印 nonce。
- 独立根／时钟：第五例自建 `caseRoot` 与自己的后端（默认时钟），不触碰共享 `clock`；每例含 `finally` 清理，20s 预算内（AFTER 9.06s／BEFORE 10.27s）。
- 原始证据 gitignored `build/mayne24-test-safety-r5/`（两运行树身份、存储重建记录、四份 TAP＋stderr、SHA256SUMS）。候选待独审，MAYNE-24 保持 `in_progress`。
