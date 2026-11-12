# W1 test-safety 第四例（默认工厂＋非审定入口负控）独审（OpenCode，2026-11-09）

- 评审对象：`agent/pi/mayne-24` 提交 `6216a6b25e3869f262897852a19baffc150a879c`（tree `06834225e6fad3a753bd88665f5ecbc2584056c7`，父 `b87d054a6d36512cf2f2642125cb47034ee6e48d`），派工为 Codex 评论 `01a1c018-9e49-7d48-bab9-e9feab22751e`。
- 差异面：恰 3 文件——`tests/unit/web-text-intake-test-safety.test.mjs`（M，+146/−3）、新测试专用夹具 `tests/fixtures/web-text-intake/test-safety-runtime-entry.mjs`（A，+80）、记录 `docs/reviews/web-text-intake-test-safety-default-factory-20261109-pi.md`（A）。生产/Runtime/DDL/package/守卫/索引零差异；**不入聚合**成立（package.json 未触碰）。作者记录附件（`01a1c012` 之 `web-text-intake-test-safety-default-factory-20261109-pi.md`）SHA-256 `5c796401…` 与候选提交 blob 内容逐字节一致。
- 独审身份：OpenCode。**未写该测试/夹具/记录**——本审交付分支 `agent/opencode/mayne-24` 全部 MAYNE-24 提交均为 docs-only（`docs/reviews/`），三者由 Pi 在其分支提交，本审全程未改其字节。
- 运行形态（与作者登记、派工锁一致）：测试引用的 `controlled-model`／`db-observer`／`synthetic-inputs` 等夹具只存在于生产链，Pi 分支基线无这些文件——故复跑基线＝`git archive c32c251` 生产字节＋候选恰 3 文件 overlay（逐文件 blob-hash MATCH 复核），非候选树整体运行。

## 结论

**通过——限第四例负控及其专用夹具的派工面。** 派工六项全部成立：默认工厂确未替换；非审定入口的 marker 与当次 run／nonce／pid／argv 绑定承重；合法帧＋零回执＋确认退出＋unknown 判据承重且不可被启动失败替代；原三例断言零弱化；根／时钟隔离成立、每例 20s 含清理成立；按基线分别登记复跑结果与作者 BEFORE 逐字一致。**不签**：任何生产修法（Kimi 来源判据修订须另审）、作者 scratch 模拟 4/4 的充分性、真实 Pi 正常路径（替身不代签）、整体准出。

## 静态读证（锁定字节逐面）

- **默认工厂确未替换**：第四例的 `startWebBackend` 调用选项仅 `root/port/staticRoot/storageBin/runtimeRoot/initialize/credentialProvider`——**无 `workerProcessFactory`**（对照第三例显式传参）。生产 `worker-host.mjs` :288 `const launcher = this.processFactory ?? spawn`，:292 spawn `nodeBinary(runtimeRoot)` + `[organizerScript(runtimeRoot), '--run', runId]`（:24-28 两者均为 runtimeRoot 直下路径），cwd＝后端根——临时 runtimeRoot 的 `node` 符号链接＋`organizer.mjs`（候选夹具拷贝）因此被默认工厂实际派生。
- **marker 绑定当次 run，非空洞**：夹具读冻结 stdio 请求行（首个含 `runId`+`hostNonce` 的帧），向 worker cwd 写 `{marker, runId, hostNonce, pid, argv}`（mode 0600）。测试断言 `marker.runId/hostNonce/pid` 与后端自写的 `runs/<marker.runId>/worker.json` 三项相等——生产 ：237-266 写入该记录含 `pid/pgid`（pgid=pid，进程组组长），故三项等价绑定到本次 spawn 的进程；`argv[1]=='--run'`、`argv[2]==marker.runId` 绑定 argv 与 run 一致。marker 路径存在性不能替代执行事实：caseRoot 为全新 `mkdtempSync`，无预存 marker；worker.json 不存在则读取抛错判红。测试对 task 的 settle 轮询 gate 在 `attemptRows≥1`（DB 实证 worker 已跑），marker 独立轮询兜底执行事实。
- **合法帧＋零回执＋确认退出＋unknown 判据均承重**：断言链依次为 attempts==1 → `exit_reason=='confirmed'`（verifyTree 整树核销，:69-94）→ receipts==0 → `code=='output_contract_invalid'`（MODEL_INVALID_OUTPUT 映射）→ `retryable=='auto_backoff'` → **`sideEffectSafety=='unknown'`（GAP-2）→ `state=='needs_review'`（GAP-2）** → cause → 无候选。断言抛出即止，故 GAP-2 位置的红隐含其前全部断言绿。**不能以启动失败替代负控**：`trustedTestPathSafety`（`task-scheduler.mjs` :391-421）明文把配置类启动失败列为另两类 `proven_safe` 来源之一；本例写入合法供应商/模型/agent 配置＋可用凭据（`config-store` 自 `2022d1c` 要求的 `name`+`auth.apiKeyRef`+`sidekick.revision` 形状齐全），baseUrl 指向死端口（入口从不调模型）——配置类失败不可达；marker/绑定断言绿实证入口真实执行。
- **GAP-2 根因（生产侧实证）**：`trustedTestPathSafety` :409 `if (!state || state.replacementFactory) return 'unknown'`，而 `replacementFactory` 仅是 `this.processFactory != null`（worker-host :281）——执行来源未绑定实际 node/入口字节，默认工厂经非审定 runtimeRoot 派生的入口通过该检查拿 `proven_safe` 并自动重排队。与作者登记及 `a20c9bc` 缺口一致。
- **原三例断言零弱化**：`git diff b87d054..6216a6b` 删除行恰 3——头注 2 行（重排为四负控总注）＋`node:fs` 导入 1 行（纯追加 `readFileSync/symlinkSync/copyFileSync`）；原三例区域（:1-560）`assert.` 调用数 51==51 且排序集合 diff 为空（IDENTICAL）。新增 18 行断言全在第四例内。
- **根／时钟隔离**：第四例自建两个全新临时根（caseRoot/runtimeRoot），不触碰套件共享 `root`/`clock`，不读写 `taskService.now`（用真实时间）；前例推进的受控时钟只作用于首个后端实例。worker 的 `TMPDIR`/cwd 均为 caseRoot，marker 与 `runs/<runId>/worker.json`（含 hostNonce）只落临时根内，finally 中 `rmSync` 移除——**nonce 留测试临时根**成立。
- **每例 20s 含清理**：`CASE_BUDGET_MS=20000`（margin 2000）单点派生全部等待上限，清理在用例体 try/finally 内（计入用例时长）；`--test-timeout=20000` 下无超时触发，实测每例 0.83–4.45s。

## 动态：按基线分别登记的原字节复跑

产物身份：存储二进制本审从运行树自带 src-tauri（== 登记输入树 `48b54730`）以登记工具链 rustc 1.99.1 `58cf8f9c3` 重建，SHA-256 **`5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2647984 B）逐字节命中登记身份**——第 4 次独立复现，按派工复用正当；作者旧二进制 `42af54b5…` 证据按旧产物保留、不倒写。Runtime bundle 逐字节核登记（organizer `08f32db2`、node `9d050fd4`）；node v24.20.0。

| 基线 | 结果 |
|---|---|
| `b87d054` 原三例原字节 ×1 | **3/3 绿，exit 0**，stderr 0 字节，全程 11s |
| 候选字节 ×2（`cand-run1`/`cand-run2`） | **4 tests / 3 pass / 1 fail，exit 1**，红恒在 `GAP-TEST-SAFETY-2`，实测 `sideEffectSafety=proven_safe state=queued`——与作者 BEFORE 登记逐字一致；stderr 0 字节，全程 17s/15s，每例 0.83–4.45s（含清理） |

- **独立绑定探针**（自建 `probe-binding.mjs`，同构造、输出脱敏布尔，nonce 不出临时根）：`workerProcessFactorySupplied=false`、marker 三项绑定相等、`argv=[临时runtimeRoot/node, '--run', runId]`、`pgid==pid`、**`bindingOk=true`**；判定面复现 `proven_safe / output_contract_invalid / auto_backoff / state=queued`；RESIDUE 0。
- 按派工**未重打**作者 scratch 模拟（AFTER 4/4 仅作作者目标可满足性，不签其充分性或任何生产方案）；未跑完整 gate。

## 登记观察（非阻断）

1. 夹具对 marker 写失败取"证据非协议步骤"语义静默吞掉（注释明示）：写失败时测试在 marker 轮询超时处响亮判红（超时消息独立于断言链），不产生假绿——可接受。
2. 第四例 settle 白名单含 `queued`，但 gate 在 `attemptRows≥1` 上，初次排队态不构成空洞通过——本轮两轮红均落在 GAP-2 位而非 settle 位，实证。
3. 夹具 `setTimeout(()=>exit(0),100)` 为规避 stdout `data` 与 `exit` 事件竞态的有意延迟；`exit_reason=='confirmed'` 断言绿说明该窗口在真实 host 下足够——后续若 host 读取路径变化需重审该常数。
4. 派工要求"Kimi 来源修订后真实四例转绿仍须另审"——本审不预签该面；`proven_safe` 授予面绑定实际产物身份的修法归属与独审按协调另行分派。

## 边界

只做必要聚焦验证（三跑＋一探针）；nonce/凭据不出测试临时根，附件均为绑定结果与脱敏原始证据（无 hex40+ 串、无密钥字样，grep 复核）；运行后临时根 0 残留、本审 0 遗留进程（他成员并发进程未触碰）；运行树（`c32c251` archive＋候选 overlay＋cargo target，1.7GB，无秘密）因本环境批量删除守卫未能整体移除，保留于 gitignored `build/` 内、不进入任何交付面，如实登记；未 push、未改状态，MAYNE-24 保持 `in_progress`。原始证据 `build/mayne24-test-safety-c4-review/r1/`（gitignored：admission、identity、三次 TAP 全套、探针及输出、登记二进制副本、SHA256SUMS）。
