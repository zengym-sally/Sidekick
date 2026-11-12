# test-safety 第五例（暖宿主回借负控）— 限定独审（ZCode，未写该例）

- 日期：2026-11-10；评审：ZCode（独立独审；被审增量作者为 Pi，本人 MAYNE-24 提交为回执测试线与评审记录）。
- 派工来源：issue 线程回复 `01a1c11e-a2ff-7afa-b161-dde7694dbaea`（Codex）：锁定第五例 `bdf3ae4`／tree `36eb847`（父 `7ee7304`），并行独审——确认原四例断言不动、真实 Pi 成功预热且实际请求属于本例、同 backend／同 WorkerHost／同配置别名后只换私有链接、第二 run 的合法帧与 marker 身份绑定、d2 错误授予→cd 保持 unknown 的前后判别；只跑新例必要前后反控，20s 含清理，复用原四例已过证据；不改候选、Runtime／package，不重跑整套矩阵或完整 gate，实际挂本审原件。
- **总判定：通过——限「第五例增量（恰一测试文件＋一份记录）的派工五面」**。回执点检 `b93a048` 不在本审范围（协调层已按限定范围接收其两处主体）。

## 1. 身份与差异面：通过

- `bdf3ae479ee3452f161158c2e41571e7863879b5`：tree `36eb84715a8bb5640b3d306492209fe9eb0783b8`、parent `7ee730429a69d6e1145209a79913351684553ce1`＝派工锁定值；`git diff --numstat 7ee7304..bdf3ae4` 恰两文件：新记录 `docs/reviews/web-text-intake-test-safety-warm-host-20261109-pi.md`（68 行）＋测试 `tests/unit/web-text-intake-test-safety.test.mjs`（191+/1−）。
- **原四例断言零删除**：`git diff -U0` 中唯一删除行是 `node:fs` import 行（仅新增 `readdirSync, realpathSync` 两名，原名全保留）；删除断言／`t.passed`／诊断行 0。全部其余新增行在唯一 hunk `@@ -674,3 +674,193 @@`＝既有第四例（pre-image 最后一例，起于 ：565）之后的新例体内；pre/post 676→866 行。
- pre-image blob＝`f72ff6ddc94e1a5ae1533af45df3b4b3aa7c71ef`＝已收 `6216a6b` 字节（内容 SHA-256 `2bb552e6…`＝登记表）；两夹具 blob 逐字节未变（`4bea6aac`／`4f3c9940`，内容 SHA `54e1d84c…`／`c593be63…`）。post blob `7c0cb4ba…`（内容 SHA `dec1eb9d…`）。

## 2. 五面逐项：全部成立

1. **原四例断言不动**：见上节（唯一差异行是 import 扩展；190 行新增全部在新例内）。
2. **真实 Pi 成功预热且实际请求属于本例**：新例自建 `caseRoot`／`caseBackend`／`caseRequest`（`startWebBackend` 一次，`runtimeRoot: alias` 私有别名在 caseRoot 内）；预热为真实 Pi `test` 任务（常驻合法脚本应答），断言终态 `succeeded`、`readdirSync(runs).length===1`（预热是唯一 run）、其 `worker.json` `trusted===true`＋`reason==='audited_deployment_runtime'`。本审 dump 探针（disclosed，仅 scratch）取回的真实记录：预热 run `trusted=true`／`audited_deployment_runtime`／runtimeRoot＝运行树 `build/s0-runtime`（审计根，别名解析）。
3. **同 backend／同 WorkerHost／同配置别名后只换私有链接**：两任务间唯一变更即 `rmSync(alias); symlinkSync(syntheticRoot, alias)`——backend 对象、会话、请求器、模型配置别名全不变。hostNonce 为**每次 start 生成**（`worker-host.mjs` `start()` 内 `randomBytes(24)`，两 run 值不同属预期）；同宿主事实由结构（同一 backend 实例两 run）＋ BEFORE 反控的 d2 缓存继承红面机制性证明（缓存继承只可能发生在同一宿主实例）。
4. **第二 run 合法帧与 marker 身份绑定**：marker（`test-safety-runtime-entry` 夹具写入，绑定首个冻结 stdio 帧）与本审 dump 的真实 `worker.json` 逐项相等（runId／hostNonce／pid；argv `[synthetic organizer, '--run', runId]`）；错误帧为注册码 `MODEL_INVALID_OUTPUT`→`output_contract_invalid`＋`auto_backoff`，exit `confirmed`、回执 0。第二 run 记录 `trusted=false`／`artifact_identity_mismatch`／runtimeRoot＝合成根 realpath。
5. **d2 错误授予→cd 保持 unknown 的前后判别**：见下节动态反控——BEFORE 红恰在命名的 `GAP-TEST-SAFETY-3` 断言（观察值逐字 `sideEffectSafety=proven_safe state=queued`），AFTER 同断言绿（`unknown`／`needs_review`）；生产字节注释（`worker-host.mjs` 构造器＋`start()`）与本例场景逐句对应（per-start 重验、不继承）。

## 3. 动态反控（本审独立运行树，第 8 次登记产物复现）

运行树：`git archive cd08588`（tree `776b2529`）／`git archive d2b2696`（tree `542c169d`）双提取＋恰三文件 overlay（测试 `7c0cb4ba`＋两夹具＝登记 blob）＋登记产物：存储二进制**本审从 `48b54730`（两树 `src-tauri` 同树）重建**＝`5311ffa3…232bd`（2 647 984 B，逐字节命中，第 8 次）；s0-runtime organizer `08f32db2`／node `9d050fd4`＝登记身份（`probe:prepare-pi`＋`bundle-runtime.mjs`；bundle 仅在 lark-cli 复制处 exit 1——`probe:prepare-cli` 未跑、超出登记范围，本套件只需 organizer＋node）。node v24.20.0、rustc 1.99.1。逐字命令：`node --test --test-reporter=tap --test-timeout=20000 --test-name-pattern='warm default-factory host' tests/unit/web-text-intake-test-safety.test.mjs`。

| 项 | 本审结果 |
|---|---|
| AFTER `cd08588`＋overlay | **1/1 PASS、exit 0**，用例 6209 ms（含清理），整跑 10299 ms，套件 stderr 0 字节 |
| BEFORE `d2b2696`＋同 overlay | **1/1 FAIL、exit 1**，红恰在 `GAP-TEST-SAFETY-3`（`testCodeFailure`，:702），错误信息逐字 `observed sideEffectSafety=proven_safe state=queued`——d2 错误授予逐字复现 |
| dump 探针（AFTER 树，disclosed scratch：finally 前 dump 两 run 记录＋marker） | 1/1 PASS exit 0；真实记录证明第 2/4/5 面事实（见上节） |

两例均 ≪ 20s 含清理。原四例不重跑（复用 `6216a6b` 四例已过证据与 OpenCode `cd08588` 四例复跑）；未跑整套矩阵／完整 gate。

## 4. 边界与登记观察

- 真实 Pi warm-up 与合成入口第二 run 均在受控模型／合成根内：未触真实模型凭据／用户根；结论不扩成真实后端 E2E 或原生运行验收。
- 夹具 `backend-process.mjs` 消费 `cd08588` 树内版本（`7069c665`）——与 OpenCode 四例复跑同一构成；`bdf3ae4` 树内该文件为 Pi 分支 II 谱系字节（`04dcd4c5`），不在本增量两文件内，不构成差异面。
- dump 探针为本审自有 scratch（已还原注册 blob 后删除）；宿主 nonce/pid 只存于 gitignored 原始证据，附件为脱敏副本。
- 零残留：`/tmp/web-text-intake-test-safety-*` 0；本审运行树进程 0；他成员工作树的两个存储进程（`mayne-24-164938414566`）未触碰。
- 原始证据 gitignored `build/mayne24-test-safety-5th-zreview/`（双树 TAP＋stderr、zprobe dump、identity.txt、SHA256SUMS、双提取树、cargo/prepare 日志）；精选原件随交付评论实际挂载。第五例候选维持协调层聚合准入，不自动替换工程清单已锁字节。
