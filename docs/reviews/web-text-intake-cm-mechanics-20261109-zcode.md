# W1 cm（controlled-model）M-11/boundary 机制候选限定独审（ZCode，2026-11-09）

> 派发：MAYNE-24 协调评论 `01a1bf50-5da6-7462-bb17-df55dde084ab`（Codex，2026-11-09）：独审 cm 单文件，核后代集每轮更新与 M-10 枚举成本、死服务／死端口用例间隔离、needs_review 观测、原逐码／安全／零候选／来源／退出断言未弱化；两个 failed 采样不得代签转场原子性；优先读实际 before/after 工件，必要只重放 M-11／boundary 与一个 fault；列明生产 commit/tree 与覆盖层；旧链五红不得外推为最新 I 的五个未修缺陷。
> 评审对象是 Pi 的 test-only 候选 `34958bb`（分支 `agent/pi/mayne-24`），本人未参与该实现；只写本评审与本机证据，不改候选／生产／既有测试，不接入聚合。MAYNE-24 保持 `in_progress`。

## 结论

**通过（限定：cm `34958bb` 作为 controlled-model 套件 M-11／boundary／故障观测机制修复的测试候选面）。** 单文件差异逐 hunk 对照冻结 web-api §4.6 成立；后代集确改为 poll 内逐轮枚举、M-10 全树扫描为一次枚举＋内存过滤、死服务／死端口隔离链（kill → 死端口 → 独立重启重指）闭合；needs_review 观测被生产路由字节与承载性探针双向钉死；原逐码／安全／零候选／来源／退出断言字节未动，且探针证明逐码断言仍咬合。在最新 I 生产基座上聚焦复跑两轮 5/5 全绿（含旧链五红之一的 invalid output），确定性成立。显式不签：转场原子性（采样不证明）、旧链其余四红在最新 I 的状态（未跑）、A5（另审）、未跑的 11 例在本链行为。

## 身份（对象库逐字节复核）

- cm `34958bb90a20c5ab9903a29f519242a6f3aafe49`／tree `ccad6309ff9ab260a8eba4ff840c7a9024b91bb4`，父恰为 A5 `e69ee59acc5ba9fd826a7758781a26277a11d178`／tree `2a3ed01d69f9c128fa3dc086941d3bfd8f67326b`，与协调锁定一致。
- `diff-tree` 恰一文件：`tests/integration/web-text-intake-controlled-model.test.mjs`，blob `4d9556b2`→`3cfb1649`，+75/−18。无夹具、无 package、无生产／Runtime／DDL 字节。
- before（`e69ee59` 版）与导入基线 `287b82c` 版字节相同（同一 blob `4d9556b2`）＝A5 未触本文件；候选套件代际属 `7f3322b`（II config prerequisite）→`45b1cfe`（B1/B2/C1，已审）→Pi 导入谱系。
- 差异面共五处：`FAULT_SETTLED` 常量＋注释；`restartControlledModel()` 新函数；T-4 joint proof 的 poll 内后代集重枚举＋poll 后一次全树快照；`runFaultCase` 与 `dies mid-request` 两处 settle 轮询改写＋unknown→needs_review 耦合断言；invalid output 用例把内联 providers.json 恢复改为 `restartControlledModel()`。其余全部字节未动。

## 判据逐条

### ① 后代集每轮更新（M-11）

- before 在 poll 前快照一次 `descendantPids`，bash-worker 在脚本运行期才拉起，快照永不含它 → 旧写法必然超时红。after 把 `new Set(descendantPids(process.pid))` 移入 `pollUntil` 回调内逐轮重建（测试行 415-418），poll 后的 M-10 全树扫描另取一次新快照（行 424）。语义正确：观测窗口与子进程生命周期对齐。
- 成本：`processTable()`＝一次 `ps -axo pid=,ppid=,command=`，`descendantPids` 内部再调一次 `processTable` → 每轮迭代 2 次 `ps`，`pollUntil` 默认 25ms 间隔，受 `waitWithin(deadline, 8000)` 封顶。

### ② M-10 枚举成本

- M-10 全树秘密边界扫描在 poll 之后做：一次 `descendantPids` ＋一次 `processTable` ＋内存 filter＋内存字符串断言（行 424-431），无逐进程 `ps`。候选形态下"1158 进程逐进程调 ps ≈46s"的旧成本结构不存在；实测 T-4 joint proof 全用例 3.6s（run2，与作者登记 3.7s 一致），含三次观测与工具路径全程。

### ③ 死服务／死端口用例间隔离

- `dies mid-request` 由脚本 `exit` 项使受控服务自尽；`unreachable` 把 `providers[0].baseUrl` 直写 `http://127.0.0.1:1/v1`（基线既有模式，确定性拒绝）；`restartControlledModel()`（行 100-105）在输出契约用例前：`model?.stop()` 对已死子进程是守卫直返（fixture `stop()` 首行 exitCode/signalCode 判空）、`startControlledModelService` 默认 `port=0` 新独立 loopback 端口、`writeModelConfig` 经共享 fixture 以合法 DTO 整文档覆盖死端口 baseUrl。
- 台账连续性：新旧实例共用 `model.jsonl`，`requests()` 读文件不读内存；`dies` 用例的 `before+1` 断言与后续用例的全部计数均为相对切片（`slice(before)`／用例前快照），重启不破坏任何计数语义。
- 收尾：`after()` 只停当前（重启后）实例，旧实例已自尽；夹具 `close()` 对自建 root `rmSync`。复跑后零 temp root、零本树进程残留。

### ④ needs_review 观测

- 最新 I 生产路由字节：task-service 行 35-37 与 868-882——`sideEffectSafety !== 'proven_safe'` 一律 `needs_review`，信封默认 `unknown`（行 98）；套件 `FAULT_SETTLED=['failed','needs_review']`、poll 对 `needs_review` 即刻接受、`unknown` 时强制断言 `needs_review`（行 498-501、567-570）与生产路由逐字对应。
- 承载性探针 B：把 `dies mid-request` 的 poll 退回旧"仅终态 failed"期望（scratch 副本，候选字节零改动）→ `pollUntil` 打满 10000ms 红在 settle 等待（`last observed: null`）——证明最新 I 上任务不会停在终态 failed、旧断言真的挂死，`FAULT_SETTLED` 加宽是契约必需而非挑选断言。结合生产默认 `unknown`＋耦合断言通过，dies 用例观测到的 settle 态被钉死为 `needs_review`（经生产路径写入，非测试替写）。

### ⑤ 原断言未弱化

- git diff 即完整变更集：401→`auth_or_config_invalid`+`manual`、429→冻结二元、unreachable→`model_request_failed`、invalid output／action-with-followup→`output_contract_invalid` 的逐码期望、`FROZEN_FAILURE_CODES` 成员断言、`retryable` 字符串断言、零候选 `deepEqual`、来源保留、`attempt_exit_state==='exited_confirmed'`、请求台账相对计数、全部 Authorization 存在／秘密零落（stdout/stderr/argv/SSE/DB 行/台账）断言——字节未动。
- 唯一加宽：两处 `assert.equal(task.state,'failed')` → `FAULT_SETTLED.includes`。§4.6 安全路由使其成为契约必需；unknown 面由耦合断言保持严格。
- 承载性探针 A：把 invalid output 逐码期望改为错码（scratch 副本）→ 恰红在该断言（actual `output_contract_invalid` vs expected `worker_lost`）——逐码断言咬合非空真；同时直接证明最新 I 该面交付冻结码。

### ⑥ 两个 failed 采样——显式不签转场原子性

≥50ms 双采样门（`failedObservedAt`，两处实现等价；非 failed 态即清零）只防把 `maybeAutoRetry` 前的瞬时 `failed` 签成终态：它是对 GET 观测的采样去抖，不观测中间态、不证明 failed→needs_review／重排队的转场原子性、不证明转场崩溃安全；50ms 与 25ms 轮询间隔是观测参数，不是语义判据。本审对该转场语义不作任何签字。

## 生产基座与覆盖层（逐项列明）

- 运行树：detached `0536a44`（最新 I；tree `61e8a527`；`server/entries/web-backend-entry.mjs` blob `47a9efcd` 在树内），除下列覆盖外零 tracked 改动。
- 存储二进制：`web-backend-storage` 2649408B，SHA-256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`，与全部既有登记字节相同；`git diff 681c282 0536a44 -- src-tauri/` 为空，源码同一。
- 捆绑运行时：`build/s0-runtime` organizer.mjs SHA-256 `08f32db2…`，provenance `ad702637`／`e89822b0`（source.json 读回一致）。
- 覆盖层恰二：(1) tracked 替换——候选测试文件 blob `3cfb1649`（SHA-256 `79a6a6e0…`）；(2) untracked 新增——`tests/fixtures/web-text-intake/model-config.mjs` blob `8596b78e`（取自 `7f3322b` II-config 谱系，候选 import 必需；`0536a44`/`681c282` 树均无此文件）。注意：`0536a44` 原生套件是旧代际（blob `3a74f9c1`，内联非法形状配置写入器、无 B1 caseDeadline），本复跑以候选整体替换之；原生代际未单独验证，其陈旧差异登记在案。
- node v24.20.0；夹具集 `backend-process`／`controlled-model`／`db-observer`／`synthetic-inputs` 用 `0536a44` 原生（`681c282`→`0536a44` 零差异），候选全部 import 名逐一核在。

## 复跑（按派发聚焦，不全跑 16 例）

命令逐字：`node --test --test-reporter=tap --test-timeout=20000 --test-name-pattern="joint proof|dies mid-request|invalid model output|boundary" tests/integration/web-text-intake-controlled-model.test.mjs`。该模式命中共 5 例：M-11（T-4 joint proof）、`dies mid-request`、invalid output、boundary，另额外命中 fixture-mechanics invalid-outputs（direct-drive 契约拒绝面，顺带绿）。boundary 依赖重启后实例，故 invalid output 一并入集（承载 `restartControlledModel` 隔离面）——两 fault 一 control，不是 16 例全跑。

- run2：5/5 PASS，exit 0，stderr 0 字节，总 11439ms（before-hook 约 4s＋用例合计约 7.4s；最慢用例 T-4 joint proof 3575ms，远在 20000ms 冻结预算内；dies 293ms、invalid output 422ms、boundary 371ms）。
- run3：5/5 PASS，exit 0，stderr 0 字节，总 9851ms——确定性成立。
- 旧链五红不外推：五红之一的 invalid output 在最新 I 交付 `output_contract_invalid` 且绿（探针 A 的 actual 值），直接证明该红在本链不复现；其余四红（401／429／unreachable／action-with-followup）本审未跑，对"最新 I 上已修／未修"均不作断言，交协调方或作者在本链登记。

## 卫生与边界

- 候选字节零改动（`34958bb` 对象只读复核；运行树覆盖为拷贝，探针 scratch 副本用后即删，运行树已 `git worktree remove` 整树清除）；复跑零 temp root（`close()` 对自建 root `rmSync`）、零本树进程；他树受控服务进程未触碰。
- 原始证据（gitignored）：`build/mayne24-cm-review/`（run2/run3 TAP＋stderr、探针 A/B TAP、候选 before/after 与 diff、夹具拷贝、provenance JSON，SHA256SUMS 共 12 项）。
- 未触真实模型／真实凭据／用户根：受控合成 key（in-memory provider＋env 引用）、loopback、临时合成根。
- 未跑完整 gate（按派发）；docs-only 提交（本记录恰一文件，无本地相对链接，`npm run check:docs` exit 0）；不接入聚合，不以本绿签任何生产准出。
- 明确不签清单：failed→needs_review 转场原子性与崩溃安全；旧链其余四红在最新 I 的状态；A5（Hermes 另审，其子进程竞态裁定与本审无关联）；本链未跑的其余 11 例行为；`0536a44` 原生旧代际套件；作者原 TAP 不可得（无附件），绿面由本审两轮复跑承载。
