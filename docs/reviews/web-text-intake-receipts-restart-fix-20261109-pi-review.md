# MAYNE-24 — MCP 回执跨重启候选 `db95ea3` 两项测试窄修：独立差异复审（Pi，2026-11-09）

派工：协调 `01a1bfc8`（锁定 `681c282`＋精确三文件／已审 db-observer 与帧 builders，使用并核对实际 `5311ffa3…`，不从分支旧 Rust 重建；核新持久门绑定、资源取得即登记清理、早退无进程／根遗留、原断言零弱化与每例 20s 含清理；必要聚焦重放含原两例、首次启动失败、存活 worker 时门超时、重启失败清理反控，并检查清理异常是否被静默吞成成功；延迟正控须大于旧 1500ms 窗口）。评审人未参与该候选实现（作者 ZCode）。

## 结论：通过（限本次派工的差异复审面）

不签聚合准入、不签完整 gate；MAYNE-24 保持 `in_progress`。

## 身份复核

- 候选 `db95ea31cbe9d47ddc06da702f22490d6cd55f95`／tree `c7b24416ab0414c908aba3281a6b48d782f33790`／父 `eb9d461175b4877e67385be64cb610887d6b3f89`；对父差异恰 4 文件 +168/−42（两 code＋两 docs）。
- 运行输入＝锁定链 `681c282`（tree `754b790811d8c09732463cafdf6e93d4feff0284`）＋恰 3 个未跟踪候选覆盖：`tests/unit/web-text-intake-receipts-restart.test.mjs` blob `715f123f…`（SHA-256 `560f1a00…`）、`tests/fixtures/web-text-intake/receipts-restart-worker.mjs` blob `11f498d9…`（SHA-256 `ec5645b5…`）、`receipts-restart-instance.mjs` blob `a4716ffa…`（逐字节未动）。`git archive 681c282` 重 extraction 与运行树 `diff -r`：除 3 候选文件与 build 产物外零差异。
- 存储二进制从 `681c282` 的 `src-tauri` 源码以 rustc `1.99.1 (58cf8f9c3)` 构建：`5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`，2647984 B，与派工登记逐字节一致；未从分支旧 Rust 重建。node v24.20.0。
- 已审夹具：`db-observer.mjs` blob `173857dd…`（SHA-256 `d13d5ec6…`，a5-fix-rev 审记录在案）；`mcp-pairing-frames.mjs` blob `7a1dfac0…`（SHA-256 `1b7ba122…`，与 MCP 配对审记录 `1b7ba122…` 一致，导出 `mcpBegin/mcpResponse/extractResultFrame` 与 worker 导入相符）。

## 静态判据（逐字节）

1. **原断言零弱化**：`5e3177d` 与 `db95ea3` 的 test 文件 assert 行集合排序后逐行相同（各 58 行，`diff` 为空）；两例名称与结构未变。
2. **新持久门**：RA2 崩溃门由「worker.json＋1500ms settle」改为只读观测 `side_effect_receipts r JOIN task_attempts a ON a.attempt_id=r.attempt_id WHERE a.task_id=? AND r.kind='tool_call_begin'`，`rows.length===1` 才崩溃；`RECEIPT_SETTLE_MS` 常量删除。SQL 为纯 SELECT，列名／kind 与 001 DDL 及生产 `worker-host.mjs` 一致。
3. **资源取得即登记清理**：`restartWorld` 在根创建后即建 `teardown` 并注册唯一 `t.after`；`startFirstInstance` 在 `spawn` 成功后立即压入 kill 步（child＋`killWorkerTrees` 按 `worker.json` pgid）；`startRestartedInstance` 在 `startWebBackend` 返回后立即压入 `backend.close()`；`rmSync` 恒在钩子末尾。
4. **worker 夹具差异**：对 `5e3177d` 仅文件头注释 5/4 行，代码零改动。

## 动态验证（锁定链＋三覆盖＋`5311ffa3…`）

逐字命令：`node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-receipts-restart.test.mjs`。

- **原两例**：4 连跑 2/2 PASS、exit 0、stderr 0 字节（RA1 5022–5329ms、RA2 5276–5298ms）。
- **延迟正控（2500ms＞旧 1500ms 窗）**：scratch worker 把 `receipts-begin-hang` 的 begin 发射延迟 2500ms——新字节 2/2 PASS（RA2 7849ms，门等到落账才崩溃）；**旧字节 `5e3177d` 同探针 RA2 红**于 `exactly the one pre-crash begin is readable after the restart`（expected 1／actual 0），旧门在落账前崩溃。两面互证门非空洞、且确实等待持久行。
- **门绑定正确 task／attempt**：探针副本在门通过后断言 `gateRows[0].attempt_id === 崩溃任务当前 attempt`（RA2 PASS）；同一 SQL 以伪 taskId 查询返回 0 行（RA2 PASS）——task 过滤与 attempt 绑定均承重。
- **门永不出现则门处失败**：RA2 首实例改 `receipts-bare`（从不发射）→ 红于 `timeout waiting for persisted begin row before the crash`，零残留。
- **首次启动失败**：scratch instance 即刻 fatal → 两例红于 `first instance failed to boot`，`$TMPDIR` 根残留 0、进程 0。
- **重启失败**：scratch 测试令 `startRestartedInstance` 即刻 throw → 两例红于该 throw，根残留 0、进程 0。
- **存活 worker 时门超时**：RA1 用「只发 begin 即挂」scratch worker＋staged 门超时 → 红于 `timeout waiting for staged window before the crash`；运行期间 worker 进程峰值 1（PID 捕获），结束后 0；根残留 0。RA2 仍 PASS。
- **每例 20s 含清理**：hook 计时探针证明 `duration_ms` 含 after 钩子（1000ms body＋2000ms after＝3002ms），且 `--test-timeout` 作用于钩子（2000ms 超时使 3000ms after 钩子 `hookFailed`）；全部用例含清理均在预算内（最慢约 7.8s）。

## 清理异常处理（派工点名检查）

- **逐位清理异常被静默吞成成功**：scratch 测试在 `teardown` 注入一个必抛步骤 → after 钩子的 per-step `try/catch` 吞掉，两例仍 PASS、exit 0。设计注释为「teardown 不得掩盖测试自身失败」。
- **根移除异常不被吞**：scratch 测试把末尾 `rmSync` 换成必抛 → 两例均 FAIL（`hookFailed`），根残留 2（对应两例），清理后 0。
- 登记为边界（非阻塞）：测试通过与否不反映 kill／close 步骤的清理成败；本次所有探针均以外部 `TMPDIR` 残留与进程复核补偿（均 0）。若 `backend.close()` 真实失败，存储适配器子进程可能存活而不被测试判红——建议后继在聚合前以外部残留探针复核，或令关键清理步失败可观测。

## 卫生与证据

- `$TMPDIR`（本机为 `/tmp/multica-task-204538997`）下 `w1-receipts-*` 残留：全部运行／探针后 0；运行树进程 0（仅他 agent 工作树进程，未触碰）。scratch 探针文件仅存在于 /tmp 运行树，候选三文件逐字节未动。
- `check:docs` exit 0（21 文件、513 链接）。`check:structure` 在锁定链＋候选树上为 3 条既存 `vendor/pi` ref.missing，无一来自候选；候选记录所称 +1 ref.missing 相对分支基线 `eb9d461`（该树无 `db-observer.mjs`，锁定链有），已核实。
- 原始证据（本机，gitignored）：`/tmp/mayne24-pi-receipts-review/evidence/`（4 连跑 TAP＋stderr、延迟正控两树 TAP、五类清理／门探针 TAP、hook 计时探针、SHA256SUMS）；精选随评论挂载。
- 未跑完整 gate（按派工）；未触真实模型／真实凭据／用户根（合成根、受控 stub、loopback 无外联）；未跑真实 runtime 字节（stub 工厂替换 spawn，runtime 仅满足 tauri-build 资源检查存在性）。
