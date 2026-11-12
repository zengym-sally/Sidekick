# W1 receipts-restart 窄修 r2（`a1562c1`）Pi 点检（2026-11-09）

> 只读点检，未写候选任何字节。派发：MAYNE-24 协调评论 `01a1c0db-04e8-7068-8e47-7f4b001147e3`（Codex，2026-11-09）。
> 结论：**两处派工差异均通过**（collect-all-then-propagate；handle-based storage exit gate）；静态核发现一处**非阻断观察**（undefined 句柄／监听注册抛错时 close／门注册在 `once` 之后，见 §3）。正常两例 2/2 通过，F1′／F2′ 安全反控均复现预期红。

## 1. 范围与锁定输入

- 候选：`a1562c1f96d9eb86191d62ce453fa2180eb9783d`／tree `f4ee780f274cd47163d0ee3e8517c77696eff612`，父 `c29219f`，测试 blob `b422ee08bfe8a530901cc146fed3c7448926234d`（恰一个测试文件＋一份新记录，生产零字节）。
- 运行树：`git archive 681c2825bb053b740cc7fdfd7133e75384389139`（tree `754b790811d8c09732463cafdf6e93d4feff0284`）＋恰三未跟踪 overlay（测试 `b422ee08`／worker `11f498d912e59cc4aa49779a6ba433829f64bbca`／instance `a4716ffa302c35b110e0b4a80fde0ae29bec90c8`，逐一 `git hash-object` 复算命中）＋`build/s0-runtime`（organizer `08f32db2…911a7`、node `9d050fd4…0588a`）＋存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，本会话从 `681c282:src-tauri`（tree `48b54730cdaa63df503706b8ec3b48c67826c999`）用 rustc 1.99.1（`58cf8f9c3`）重建，逐字节命中登记身份）。node v24.20.0。
- 命令：`node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-receipts-restart.test.mjs`。

## 2. 两处派工差异

### 2.1 collect-all-then-propagate（首个目标失败后仍逐个尝试其余自有目标，错误最后到达收集器）——通过

- `killWorkerTrees`（`:214-242`）：`for` 循环遍历 `runs/*/worker.json`，对每个 `pgid` 调 `process.kill(-pgid,'SIGKILL')`；仅 `ESRCH` 豁免，其余失败 `failures.push(error)` 后**继续**循环；循环结束 `await sleep(200)` 后 `failures[0].errors = failures; throw failures[0]`。即所有目标都被尝试，错误在循环后传播。
- `killFirstInstance`（`:291-311`）：`child.kill('SIGKILL')` 的失败先 `failures.push`（ESRCH 豁免），随后**无条件** `await killWorkerTrees(root)`，把 `killWorkerTrees` 的 `.errors` 并入同一集合，最后 `throw failures[0]`。即首个目标失败不跳过 worker trees，所有自有目标尝试完毕后才传播。

### 2.2 handle-based storage exit gate（取得本次真实 ChildProcess，正常退出与超时强制均绑定该句柄）——通过

- `startRestartedInstance`（`:398-445`）：`backend.recovery?.storage?.child` 在 `startWebBackend` 返回后、任何 close 之前捕获；校验 `typeof storageChild.once === 'function' && typeof storageChild.kill === 'function`，否则记 `storageCaptureError`；`storageChild.once('exit', ...)` 注册在真实句柄上；`graceful close` 与 `verify own storage subprocess exited after close` 两步按序注册进 `teardown`。
- 门（`:413-445`）：`exited()` 读句柄自身的 `storageExitSeen`／`exitCode`／`signalCode`；5000ms 有界窗口内未退出则 `storageChild.kill('SIGKILL')`（句柄，非裸 PID）＋有界等退出，再响亮抛错。全程无 `ps` 扫描、无裸 PID 信号。
- 正常路径：close 触发句柄 exit 事件，`storageExitSeen` 置位，门通过（sub-second 开销）。

## 3. 静态核（捕获失败／undefined·null／监听注册失败）

- **捕获失败（非句柄对象）**：通过。捕获检查抛错→`storageCaptureError` 记录；`storageChild !== null` 为真，`once` 被调用（该对象 `once` 是函数）；close／门仍注册；门步 `if (storageCaptureError !== null) throw storageCaptureError` 响亮重抛。close 仍被尝试，门不空洞。
- **null**：通过。`storageChild !== null` 为假→跳过 `once`；close／门注册；门抛 `storageCaptureError`。
- **undefined**：**非阻断观察**。`storageChild = backend.recovery?.storage?.child` 在 `recovery` 缺失时为 `undefined`；捕获检查 `!storageChild` 抛错并记 `storageCaptureError`，但 `storageChild` 仍是 `undefined`，`storageChild !== null` 为**真**，`storageChild.once('exit', …)` 抛 `TypeError`，被外层 `catch` 吞为 `lastError` 并重试启动；**close／门两步尚未注册**，该次 `backend` 句柄未关闭。锁定链上 `entry` 恒返回 `recovery`、`StorageClient.child` 恒为真实 ChildProcess，故此分支不可达；但静态上 `!== null` 未排除 `undefined`。
- **监听注册失败**：同上。`storageChild.once('exit', …)` 在捕获 `try/catch` 之外、且在 `teardown.push(close)`／`teardown.push(gate)` 之前；若 `once` 抛错，close／门均不注册。真实 ChildProcess 的 `once` 对 `'exit'` 不抛，故不可达；静态上注册顺序使监听失败先于 close 注册。
- **t.passed 双重可见性**：通过。`t.after` 内 `if (t.passed) throw …`，body 已失败时保留原断言失败，`reportCleanupFailures` 同时进 TAP（`t.diagnostic`）与 stderr（F2′ 实测，见 §4.3）。

## 4. 动态证据

### 4.1 正常两例（`a1562c1` 字节）

`2/2 pass`，exit 0，stderr 0 字节，RA1 5416ms／RA2 5316ms，套件 10790ms（每例含 after 清理均 ≪ 20s）。零 `[cleanup]` 行、零 `/tmp/w1-receipts-*` 残留、零遗留进程。原始 TAP：`build/mayne24-test-safety-r5/evidence-receipts/r5-receipts-normal.tap`。

### 4.2 F1′（首个自有目标 EPERM，其余目标仍被尝试，错误传播）

scratch 副本注入：`startFirstInstance` 的 `child.kill` 在**第二次**调用（teardown 那次；第一次是 crash）抛 `Error: kill EPERM`；RA1 播种两个探针自持的 detached 组（`66041`／`66042`）为生产形状 `worker.json` 记录。结果：exit 1，两例 `hookFailed`，`[cleanup] kill first instance + surviving worker trees: Error: kill EPERM`（脱敏栈），**探针对 `66041`／`66042` 复检均 ESRCH（被套件真实清除）**，零根残留，套件 10425ms。原始 TAP：`…/r5-receipts-f1.tap`。即 collect-and-continue 与错误传播成立，非空洞。

### 4.3 F2′（close 返回但自有存储仍活，安全形态）

scratch 副本注入：`--import` 预载仅把 `StorageClient.prototype.close` 改为立即返回（绕过优雅握手，子进程仍活），并翻转 RA1 末断言 `true→false`。结果：exit 1；RA1 `testCodeFailure`，**原断言 `true !== false`（`:649`）完整可见**，同时 `[cleanup] verify own storage subprocess exited after close: Error: own storage subprocess (handle pid 63563) was still alive 5000ms after close() resolved …`；RA2 `hookFailed`（`cleanup did not complete (verify own storage subprocess exited after close)`，handle pid 63648）；进程自行退出，套件 20706ms（两例总时长，单例 RA1 10198ms／RA2 10453ms，均 < 20s），零根残留。原始 TAP：`…/r5-receipts-f2.tap`。即 close 解析不代签退出，门在句柄上超时并强制，t.passed 双重可见性成立。

## 5. 边界

- 只读点检：未改候选／生产／package／守卫；scratch 注入仅作用于本点检自行启动并持有的进程／副本，未向外部受保护组发信号；注入副本已逐字节回退（测试文件恢复 `b422ee08`）。
- 未重跑持久门／五探针／四套件／完整 gate；未触真实模型／凭据／用户根（合成根、受控 stub、零外联）。
- F1′ 的「循环内对已死探针组再抛 EPERM」未单独注入（readdir 顺序相关的独立可见性按作者登记保留）；F2′ 的 200 字符诊断截断同作者登记，完成由结果（自行退出＋句柄子进程死亡＋零残留）证明。
- 原始证据 gitignored `build/mayne24-test-safety-r5/`（两运行树身份、存储重建记录、六份 TAP＋stderr、SHA256SUMS）。MAYNE-24 保持 `in_progress`。
