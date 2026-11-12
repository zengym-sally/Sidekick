# 回执跨重启回归 — 清理错误传播面 Pi 点检（MAYNE-24）

- 日期：2026-11-09；点检者：Pi（`7a94d966-38f6-422d-a785-f565d828dbfa`）。未写该候选，仅点检派工指定的错误传播面。
- 派工：issue 线程回复 `01a1c022-f75c-7ca2-bd06-10f9c16b338e`（Codex）。背景：ZCode 的 `f7e8307` 最小修订（父 `76f1523`）。
- 身份：候选 `f7e830701b85ca15abd6efde82b11c439ef9ebdf`／tree `6076c08a724117fd5f7a303f15afeadfa4408fec`；差异恰 2 文件——测试 +77/−8（blob `715f123f`→`be90f096`）＋新记录 +45；assert 调用 58→58，`git diff -U0` assert 行 0；worker `11f498d9`／instance `a4716ffa` 夹具零字节。
- 运行树：`git archive 681c282`（tree `754b7908…`）＋恰 3 个未跟踪覆盖（`git hash-object` 复核）＋登记存储二进制 `5311ffa3…232bd`（2647984 B，SHA-256 复制后复核）＋node v24.20.0；runtime 字节未被消费（stub 工厂）。

## 结论

**不通过——限「真实 kill／close 错误到达收集器」面。** 外层「步骤必抛」管道本身正确且可工作（见下正控），但两个关键清理步的内层无条件 `catch {}` 仍把真实非 ESRCH 错误吞掉，close 步在生产上不可拒绝，因此派工要求的「关键 kill／close 失败使原本成功的用例判红」未达成。其余派工面（t.passed 双重可见性、预算、原断言保留、F2 登记）按证据通过。

## 一、静态：真实清理错误到不了收集器

- **kill 步**：`tests/unit/web-text-intake-receipts-restart.test.mjs:254`
  `try { child.kill('SIGKILL'); } catch { /* already gone */ }` —— 无条件吞掉**任何**错误，包括非 ESRCH 的 EPERM 等真实失败；`killWorkerTrees`（:186）内的 `try { process.kill(-record.pgid, 'SIGKILL'); } catch {}`（:199）同样无条件。外层 `step.run()` 的 `try/catch`（:383）只能接到这两个函数**抛出**的错误，而它们实际永不抛出。
- **close 步**：`run: () => backend.close()`（:337）→ 生产 `server/entries/web-backend-entry.mjs:144-151` `shutdown`：
  - `scheduler.stop()`（`task-scheduler.mjs:52-57`）→ `workerHost.stopAll()`（`worker-host.mjs:482-516`）每处 `process.kill`／`stdin.write`／`entry.done` 都在 `try/catch` 内，恒 resolve；
  - `sse.stop()`（`sse-hub.mjs:36-45`）`res.end()` 单独 `try/catch`；
  - `httpServer.close()`（`http-server.mjs:207-212`）`new Promise((resolve) => server.close(() => resolve()))` 只 resolve、永不 reject；
  - `storage.close()`（`storage-client.mjs:100-127`）command／stdin 错误均 catch，退出等待有 2000ms 定时器兜底，恒 resolve。
  故 `close()` 对任何真实失败都不拒绝，close 步的传播判据为空。
- **唯一可达失败**：`rmSync`（:393）自身抛出 → 被收集 → 传播。

## 二、动态：受控非 ESRCH 注入（指向本测试所拥有的进程）

`probe-kill-inject.mjs` 在测试进程内包裹 `ChildProcess.prototype.kill` 与 `process.kill`：对**已退出**的首实例子进程（spawnargs 含 `receipts-restart-instance.mjs`）以及对**已消失**的 worker 进程组（`SIGKILL`，signal-0 存活探测不动）注入受控 `EPERM`（非 ESRCH）。每次注入写日志，确保非空洞。

- 候选**未修改**，带注入跑：`run-killpoison.tap` —— **2/2 PASS、exit 0、stderr 0 字节、`[cleanup]` 0 行**；`injections-killpoison.log` 恰 4 次（每例 child kill＋worker-tree kill 各一）。即真实非 ESRCH kill 错误仍被吞，成功体**不判红**。
- 对照（可达失败）：`probe-rmsync-poison.cjs` 只毒 `rmSync` → `run-rmsync-poison.tap` **2/2 `hookFailed`、exit 1、`[cleanup]` 诊断点名 `remove root last`**（脱敏 `<repo>`）。证明收集器与判红管道本身可用，缺口就在内层 catch。

## 三、正控：把内层 catch 收窄到只吞 ESRCH（scratch 副本，未改候选）

在 /tmp 运行树内把两处 `catch {}` 改为 `catch (error) { if (error?.code !== 'ESRCH') throw error; }`：

- `run-narrow-catch.tap`（只收窄 child.kill）：同一注入 → 两例 `hookFailed`、exit 1、`[cleanup]` 诊断点名 `kill first instance + surviving worker trees`（脱敏栈 `file://<repo>/…`）；**毒步之后 rmSync 仍执行，根残留 0**。
- `run-narrow-worker.tap`（只收窄 `killWorkerTrees`）：worker-tree EPERM 到达收集器 → 两例 `hookFailed`、exit 1、诊断点名该步；根残留 0。
- 即「真实关键错误须诊断且让成功体判红，其他清理仍执行」在收窄后成立；这是最小修法方向。

## 四、t.passed 与双重可见性、预算

- `run-dual-visibility.tap`（scratch：收窄 worker-tree catch ＋ 强制用例体后段断言失败）：两例 `testCodeFailure`，失败详情即**原断言全文**（`'needs_review' !== 'bogus-state'`），`[cleanup]` 诊断并排存在，exit 1，根残留 0——原断言可见性与清理诊断互不遮蔽，`t.passed` 在 after 时点可靠。
- 预算：正常一跑 `run-final.tap` RA1 5194.1ms／RA2 5305.2ms（含 after 钩子），≪20s；注入跑同带（RA1 5031.4ms／RA2 5296.1ms）。

## 五、F2 挂起可达范围（如实登记）

作者登记「kill 步真实失败且首实例仍存活（piped stderr）→ runner 退出等待该子进程，响亮非静默；真实流程不可达」。本点检裁定：**该挂起在「真实 kill 失败」路径上可达**——候选的 :254 无条件 catch 会吞掉该失败，首实例孤儿保持存活并持有 piped stderr，runner 退出时等待，且唯一症状就是这个挂起（无诊断、无判红）。正常路径（kill 步先于 close、首实例在用例体内已被 SIGKILL）不可达，作者对正常路径的判断成立；但「真实流程不可达」作为全称判断不成立。可达条件：`child.kill('SIGKILL')` 对首实例子进程抛非 ESRCH 错误；对进程内同 UID spawn，EPERM 预期不出现，但 catch 的无条件性使任何此类错误都不可见。作者 F2 的显式定点清理登记如实保留，**不签成 runner 自然非零退出**。

## 六、边界与未签范围

- 仅点检本错误传播面；持久门、身份两面、早退覆盖、2500ms 延迟前后反控按 Pi `01a1bfec` 复用，未重跑。
- close 步「生产不可拒绝」是第二处观察：是否要求生产 `close()` 对真实关闭失败拒绝（或显式登记 close 为可失败）由协调者裁定；本点检不以该面单独定候选。
- 未跑完整 gate／五探针；未触真实模型／凭据／用户根；候选与生产字节未改（scratch 仅在 /tmp 运行树）。
- 原始证据（gitignored）：`build/mayne24-cleanup-prop-review/`（identity.txt、7 份 TAP＋stderr、2 份注入日志、2 个探针脚本、SHA256SUMS）。
- MAYNE-24 保持 `in_progress`。
