# W1 执行来源每 run 缓存边界增量 cd08588 独审（OpenCode，2026-11-09）

> 独审记录，非作者自签（增量作者为 Kimi，`agent/kimi/mayne-24`；本审者此前只交付打包分支验证 `eb2cc15` 与第四例独审 `94f8d85`，未写这两个生产文件）。派发：MAYNE-24 协调评论 `01a1c09d-746d-7d61-b776-1f06676b37a6`（Codex，2026-11-09）——逐 run 重验实际来源、期望身份仅来自模块部署位置、spawn 使用当次验过的真实路径、worker.json 与实际执行一致，分别给结论；同一 host／同一配置别名预热后换向的真实默认工厂反控对照父字节；核固定 launcher 实参的独立承重，不能只用布尔矩阵或路径存在性代签；在新生产树上原样复跑 `6216a6b` 四例一次；挂原始反控、身份、计时与零残留证据；不重跑四套 II／完整 gate。
>
> **结论：通过——限本增量（`cd08588`，恰 `server/lib/worker-host.mjs` +66/−34 与 `server/lib/task-scheduler.mjs` 仅注释）的上述四面、`6216a6b` 四例复跑与本审三支独立探针面。不作 T-2/T-10/来源修订聚合准入、不作整体准出（III 唯一集成轮＋完整 `npm run check` 仍待）；MAYNE-24 保持 `in_progress`，E/D 仍待 owner。**

## 1. 锁定与身份复核

- 候选 `cd08588328df27cabdb50f178159424a9534c0b9`／tree `776b252919e1a6eb355c147b542b0d3308c9abe2`，父 `d2b2696d965f81de67155c5ee037a744f1b56f34`，记录 `56cf3db`（同作者交付记录）。`git show --stat`：恰两文件 +66/−34；`task-scheduler.mjs` 的 5 行变化全部位于 `trustedTestPathSafety` 文档注释块内，零行为字节（逐行核对）。
- 运行树以 `git archive` 物化候选与父两棵原始树；生产子树字节复核：`worker-host.mjs` blob `52198fa`、`task-scheduler.mjs` blob `8684d44` 与 `cd08588` 对象逐字节相等，父树 `worker-host.mjs` blob `8506103` 与 `d2b2696` 相等。
- 被删除的 `executionSource()` 方法在候选树全仓 `git grep` 无残留调用者；`state.executionSource?.trusted`（task-scheduler :424）是唯一外部消费点，与父一致。
- 登记产物（本审独立复算）：存储二进制 `5311ffa3…232bd`（2 647 984 B，从候选树 `src-tauri`＝登记输入树 `48b54730` 以 rustc 1.99.1 `58cf8f9c3` 重建，逐字节命中，第 6 次独立复现）；organizer `08f32db2…9111a7`、node `9d050fd4…0588a`（主树 `build/s0-runtime` 复算命中登记，复制进两棵运行树）。node v24.20.0（系统与随包同字节）。

## 2. 静态四面结论（逐行读候选字节）

1. **逐 run 重验实际来源——成立**。`start()` 每次（L352）对当前配置根调 `verifyExecutionSource` → `runtimeArtifactIdentity`（每次 `realpathSync` ＋ node／organizer.mjs 全内容 SHA-256）；`WorkerHost` 的 `_executionSource`／`executionSource()` 每 host 缓存被整体删除且无残留调用者。配置根解析在 run 间变化时按新事实裁决。
2. **期望身份仅来自模块部署位置——成立**。`auditedRuntimeIdentity()` 进程级缓存的是 `trustedRuntimeRoot()`（自 `import.meta.url` 解析 `<base>/runtime`／`<base>/build/s0-runtime`，与配置根无关、不读被验根内任何 manifest）的产物身份；缓存只持有**期望**，不持有关于任何配置路径的**结论**。登记一条非阻塞观察：首次解析即 null（无可共部署运行时）会随进程存活保持 null——fail-closed 方向（授予恒 `unknown`），与打包形态既有登记一致，不构成本增量的授予风险。
3. **spawn 使用当次验过的真实路径——成立**。`nodePath`／`entryPath` 取 `executionSource.node`／`.entry`（刚被哈希的 realpath 结果），仅身份不可解析时回退配置路径且授予保持 `unknown`；哈希→spawn 的配置别名窗口由此关闭。动态面见 §4 探针与 §5 突变。
4. **worker.json 与实际执行一致——成立**。正常记录与 spawnError 记录均内嵌同一份当次 `state.executionSource`；R1 反控以入口 marker（runId／hostNonce／pid／argv）与 `runs/<runId>/worker.json` 交叉核对，候选树三项相等＋argv[0] 与记录 entry 相等（三方一致），父树则暴露记录（已审根/已审哈希）与 marker argv（配置别名串）的直接矛盾。

边界（沿用作者登记，本审不放宽）：已审定包内产物被**就地篡改**仍不设防——属构建树完整性（`probe:bundle` 哈希/洁净度校验与结构守卫管辖）；配置别名窗口与包内就地篡改边界已分清，本增量只关前者。

## 3. `6216a6b` 四例原样复跑（候选树一次）

运行构造与该候选的已审独审（`94f8d85`）一致：`git archive cd08588` 运行树 ＋ `6216a6b` 三文件 overlay（测试 blob `f72ff6dd`、runtime-entry `4bea6aac`、stub-worker `4f3c9940`，git hash-object 复核相等），夹具取候选树自带已审版本，`node --test --test-timeout=20000`。

结果：**4/4 通过，exit 0，stderr 0 字节，总 16.6s**（逐例含清理：extract 负控 1975ms／真实 Pi 正控 1450ms／私有工厂负控 4533ms／默认工厂非审定入口负控 4529ms，均 ≪ 20s）。派工要求逐面对照：

- **真实随包 Pi 正控完整重试序列保持**：首 attempt `output_contract_invalid`（恰 1 次模型请求、无工具帧、零回执、exit confirmed）→ `proven_safe` → `auto_backoff` 重排队（`next_attempt_at` 越前）、窗口内不被认领 → 时钟过窗后第二 attempt 成功、预算递减、恰 2 attempts、零回执。
- **两原负控保持 unknown**：extract 零回执失败（含客户端伪 proof/伪 snapshot）`needs_review`/`unknown`；私有替换工厂替身真实派生（invocations=1）仍 `needs_review`/`unknown`——私有替换接口未误获授予、未失去运行能力。
- **默认工厂非审定入口负控保持 unknown**：marker 绑定当次 run，仍 `needs_review`/`unknown`。

## 4. 独立反控探针（本审自写，真实默认工厂，登记产物）

探针 `esrc-review-probe.mjs`（每例 20s 冻结预算含清理，受控凭据/loopback 模型/库只读）在候选与父两棵原始树上对同一段字节分别运行；全部用例原始输出 stderr 0 字节。

- **R1 同 host 预热换向反控（同一后端、同一 WorkerHost 实例、同一配置别名符号链接）**：run 1 别名→已审根，真实 Pi `test` 契约失败——两树均 `proven_safe`＋`queued`、记录绑定已审身份（`08f32db2`/`9d050fd4`）、模型请求恰 1、无 marker。换向合成根（系统 node 符号链接＋Pi 已审 runtime-entry 夹具副本，sha `54e1d84c…`＝作者登记夹具哈希）后 run 2：
  - 候选（4.97s）：`needs_review`/`unknown`，记录 `trusted:false`、`reason=artifact_identity_mismatch`、绑定合成根 realpath 与 `54e1d84c`，marker runId/hostNonce/pid/argv 与 worker.json 三方一致，模型请求 0（stub 确已执行、真实 Pi 未参与）。
  - 父（6.12s，对照父字节）：**`queued`/`proven_safe`**，记录仍写 `trusted:true`＋已审根/已审哈希，而 marker argv[0]＝配置别名串——旧结论借给另一产物、记录与实际执行直接矛盾。与作者登记的 BEFORE/AFTER D 例 JSON（附件 ID `01a1c09b-7e08`/`01a1c09b-7ecc`，本审按 ID 分别保存不覆盖）逐点相符，且由本审独立探针、独立运行树与登记产物复现。
- **R2 launcher 实参捕获（透明包装工厂，捕获后真实 spawn）**：换向后候选 launcher 收到合成根 **realpath**（file＝realpath node、args[0]＝realpath organizer.mjs、args[2]＝当次 runId），与 worker.json 逐项相等、无配置别名串泄漏；父收到 `<alias>/node`、`<alias>/organizer.mjs`（配置串再解析）——哈希→spawn 窗口的父字节实据。预热 run 1 两树均收到已审根真实路径。
- **R3 期望身份不可解析面（两树各一）**：后端树无共部署运行时（`trustedRuntimeRoot`→null），配置根指向登记 bundle 的外部副本——两树同结果：真实 Pi 照常执行（模型请求 ≥1、exit confirmed）、`needs_review`/`unknown`、记录 `reason=no_audited_runtime_resolved` 并如实绑定外部产物（两哈希＝登记值）。身份不可解析不误获授予、不失去既有运行能力，且本增量对父无回归。

## 5. 固定 launcher 实参的独立承重（突变，跑后即弃）

突变树＝候选字节**仅**将 spawn 派生两行（L429-430）回退为配置串（`diff` 恰 2 行），每 run 重验保持。同一段 R2 探针、同一候选期望在突变树上 **R2 转红**（exit 1，断言恰落在 `cap2.file` realpath 期望），候选原树同探针保持绿——固定 launcher 实参断言可证伪且独立承重，不是布尔矩阵或路径存在性代签。每 run 重验的承重由父树对照本身证成（父字节即"恢复缓存"的实现，R1 run 2 回 `proven_safe`）。

## 6. 边界与未签范围

- 未重跑四套 II、未跑完整 `npm run check`（III 唯一集成轮）；`eb2cc15` 旧版打包分支限定证据原样保留，本次未重建整包、未追签新代码打包准入。
- 聚合准入（来源修订＋T-2＋T-10）、III 工程候选正式独审、整体准出不预签；真实外部模型/凭据/浏览器旅程不在本审。
- 静态观察（非阻塞）：期望身份进程级缓存的"首次 null 粘滞"为 fail-closed；`verifyExecutionSource` 每次 still 调 `trustedRuntimeRoot()` 仅用于 null 判定与 reason 标注，trusted 判据全部落在缓存期望上，语义与注释一致。
- 零残留：TMPDIR 下 `esrc-*` 临时根 0 个、本审进程 0 个遗留；突变树与全部 scratch 位于任务临时目录（`/private/tmp/multica-task-786099651/opencode/mayne24-esrc-review/`），不属交付面。六次运行的 stderr 全部 0 字节。
- 原始证据：六份运行输出（四例复跑＋R1/R2 候选/父＋R2 突变红＋R3 两树）与六份证据 JSON（worker 记录全文、marker、launcher 实参、模型请求数、状态/判定/计时）随评论挂载，SHA256SUMS 覆盖。
