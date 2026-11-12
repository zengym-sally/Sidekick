# W1 test-safety 第四例：默认工厂＋非审定 runtime 入口负控（Pi，2026-11-09）

> test-only 待审候选，不改生产／Runtime／DDL／package／守卫，不扩大 20s 用例预算，不跑完整门禁。本记录不自签任何生产候选。
> 派发：MAYNE-24 协调评论 `01a1bffb-3fe7-76f9-b208-001f439eeacf`（Codex，2026-11-09）。

## 1. 范围与锁定输入

- 生产基座：Kimi I 分支 tip `c32c251cdf60d453efc74c62ab4432a2558b8800`（tree `96d1e3510690c5d1f9d6e4399c68107d91f541bd`）。该提交 `server/` 与 `ceece1f` 逐字节相同（`git diff ceece1f c32c251 -- server/` 为 0 行，仅追加记录），即 `a20c9bc` 判不通过的可信 test 安全证明候选。测试从源码入口 `server/entries/web-backend-entry.mjs` 导入 `startWebBackend`。
- 运行时：默认真实 Pi bundle `build/s0-runtime`（organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`）。
- 存储：`web-backend-storage` `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`（2649408 B，既有登记二进制；其 003 模式与 c32c251 兼容，第三例既审已用同一二进制）。
- 交付物：仅修改 `tests/unit/web-text-intake-test-safety.test.mjs`（追加第四例）＋新增测试专用夹具 `tests/fixtures/web-text-intake/test-safety-runtime-entry.mjs`＋本记录。无生产／Runtime／DDL／package／守卫／索引改动。

## 2. 第四例设计

派发要求的反例：**无 `workerProcessFactory`、临时 runtime 测试入口实际被默认工厂派生（marker 绑定当次 run）、合法身份错误帧／零回执／确认退出仍必须 `unknown`＋`needs_review`**。

- **默认工厂派生非审定入口**：用例自建临时根与第二个后端实例，`startWebBackend` **不传 `workerProcessFactory`**，`runtimeRoot` 指向一个临时 runtime 根：`node` 是系统 node 的符号链接，`organizer.mjs` 是测试专用入口 `test-safety-runtime-entry.mjs`（经审查的 stub 夹具＋marker 写入）。`WorkerHost` 的 `processFactory ?? spawn` 因此用默认 `spawn` 派生该非审定入口。
- **marker 绑定当次 run**：入口读取冻结 stdio 请求行，把 `{marker, runId, hostNonce, pid, argv}` 写入 worker 的 cwd（即后端根）。用例把 marker 与后端自己的 worker 记录 `runs/<runId>/worker.json` 交叉核对：`runId`／`hostNonce`／`pid` 三者相等，且 `argv[1]=='--run'`、`argv[2]==runId`。即 marker 证明默认工厂确实为本 run 执行了该入口，而不是路径／存在性检查或预存 marker 可替代。
- **合法身份错误帧／零回执／确认退出**：入口回显 `runId`＋`hostNonce`，发出恰一个 `type:'error'`、`code:'MODEL_INVALID_OUTPUT'` 帧；无工具／MCP 帧，回执计数为 0；进程延迟 100ms 退出，整树退出经 `verifyTree` 确认。
- **判定目标**：任务 `state=needs_review`、`failure.sideEffectSafety=unknown`、`failure.cause=failure_unknown_side_effect`、`failure.code=output_contract_invalid`、`failure.retryable=auto_backoff`；无候选落库。
- **非空洞**：用例写入合法模型配置与可用凭据，调度器因此启动 worker 而不是以配置类失败码（配置类携带 `proven_safe`）收口；入口从不调用模型，baseUrl 为死端口。

`GAP-TEST-SAFETY-2`：当前后端 `trustedTestPathSafety` 只检查 `state.replacementFactory`，默认工厂派生的非审定入口实际拿到 `proven_safe` 并自动重排队。该断言为可证伪红，待 I 绑定实际 node／入口产物身份后转绿。

## 3. 前后原始证据

命令：`node --test --test-timeout=20000 --test-reporter=tap tests/unit/web-text-intake-test-safety.test.mjs`

### 3.1 BEFORE（c32c251 生产字节，未打补丁）

三轮独立运行均 `tests 4 / pass 3 / fail 1`，退出码 1，stderr 0 字节。红恒在第四例的 `GAP-TEST-SAFETY-2` 断言：

```
GAP-TEST-SAFETY-2: the default factory derived a non-audited runtime entry, so the
execution source is not credibly confirmed and must stay unknown; observed
sideEffectSafety=proven_safe state=queued
+ actual - expected
+ 'proven_safe'
- 'unknown'
```

即：默认工厂确实派生了临时非审定入口（marker 三项绑定断言全部先通过），合法身份帧／零回执／确认退出全部成立，但后端授予 `proven_safe` 并自动重排队——正是 `a20c9bc` 判不通过的缺口。原三例（extract 零回执、真实 Pi 正控退避、私有替换工厂）三轮均绿。

### 3.2 AFTER（隔离 scratch 树的来源判据模拟，不交付）

在 `/tmp/mayne24-pi-safety4/run-fix`（c32c251 的完整拷贝）对 `server/lib/worker-host.mjs` 与 `server/lib/task-scheduler.mjs` 打**临时**模拟补丁：worker-host 在每次 run 的 state 上记录 `organizer.mjs` 的 SHA-256，scheduler 的 `trustedTestPathSafety` 在授予前要求该哈希等于登记的随包 organizer 哈希（`08f32db2…`）。补丁以 `SCRATCH SIMULATION` 标记，运行后逐字节回退，未进入交付分支。

三轮独立运行均 `tests 4 / pass 4 / fail 0`，退出码 0：第四例转绿（非审定入口哈希不匹配 → `unknown` → `needs_review`），真实 Pi 正控仍绿（登记入口哈希匹配 → `proven_safe`），原两负控保持 `unknown`。即该负控在来源判据绑定实际入口产物身份后可转绿，且方向与派工修法一致（不能只查路径／存在性，须绑定产物身份）。

### 3.3 marker 绑定探针（一次性，scratch）

独立探针（复制第四例的默认工厂装配，dump marker 与 worker 记录）输出：

```json
MARKER { "marker": "test-safety-runtime-entry", "runId": "run_0d0ebfb70e64d001cad57cba",
  "hostNonce": "22b49c1989812198e11ee27b7b2eca9d4c8501d2d0ba609f", "pid": 7070,
  "argv": ["…/organizer.mjs", "--run", "run_0d0ebfb70e64d001cad57cba"] }
WORKER_RECORD { "runId": "run_0d0ebfb70e64d001cad57cba",
  "hostNonce": "22b49c1989812198e11ee27b7b2eca9d4c8501d2d0ba609f",
  "attemptId": "att_…", "taskId": "tsk_…", "pid": 7070, "pgid": 7070, "children": [] }
BINDING_OK true
```

`runId`／`hostNonce`／`pid` 三项相等，`--run` 指向同一 run：默认工厂派生该非审定入口为本 run 的执行来源，成立。

## 4. 原三例不弱化

`git diff` 对 `tests/unit/web-text-intake-test-safety.test.mjs` 的改动为：头注追加第四例说明、`node:fs` 导入追加 `readFileSync, symlinkSync, copyFileSync`、文末追加第四例。既有三例的断言与用例体零改动；`git diff -U0` 的既有断言行改动为 0。

## 5. 边界

- 仅一个测试文件＋一个测试专用夹具＋本记录；未改生产／Runtime／DDL／package／守卫／索引；未跑完整 `npm run check`；未触真实模型／凭据／用户根（合成密钥仅指 loopback 受控服务，第四例入口从不调用模型）。
- BEFORE 为可证伪红（GAP-TEST-SAFETY-2），AFTER 为 scratch 模拟绿；未为全绿修改生产或降低预期。
- 第四例的 `after` 模拟补丁仅为方向验证，真实修法归 Kimi 的来源判据修订，另送独审。
- 本记录不自签 Pi 自己的测试候选，也不代签任何生产候选；未改 MAYNE-24 状态。
