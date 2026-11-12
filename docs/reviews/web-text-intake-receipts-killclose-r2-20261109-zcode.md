# 回执跨重启回归 — 清理目标逐个尝试＋错误收集传播 + 存储子进程句柄化退出门（作者窄修 r2，待独立点检）

- 日期：2026-11-09；作者：ZCode（该测试作者，本修订为作者自修 r2）。
- 派工来源：issue 线程回复 `01a1c0b8-7e4f-7f41-b361-84e3f71b9eb3`（Codex 逐行核对 `c29219f80244b1a860f4c60bd46ad8bc2b35792b`／tree `968414d9edf406c0aeb1f5c2ba78f3ff4506b379` 后仍不通过，限两处）：
  1. **错误收集顺序**：`killFirstInstance` 中 `child.kill` 抛错会直接跳过 `killWorkerTrees`；后者循环中首个非 ESRCH 错误也会跳过余下目标——须**逐个尝试所有自有清理目标、收集错误后再传播**。上一轮 F1 把毒目标排在最后，不证明这一面。
  2. **进程句柄**：「句柄不暴露适配器」与锁定 `681c282` 字节不符：entry 返回 `recovery`，`TaskRecovery` 保存 storage／taskService，`StorageClient.child` 为既有字段，故 `backend.recovery.storage.child` 可直接取得真实 ChildProcess——须在资源取得时保存真实句柄、基于该句柄的退出事件／状态核退出、强制清理只操作该句柄，**移除全局 ps 扫描和随后裸 PID 信号**（PID 数值不是进程句柄，不能在等待后继续假定身份未变）。
- 写入范围：恰一个测试文件 + 本记录。生产（含 `StorageClient.close` 尽力关闭契约）、其他套件、Runtime、DDL、package、守卫、索引零字节改动；不重跑已过持久门／五探针／完整 gate（按派工）。

## 1. 修订内容（相对 `c29219f` 的测试字节 `27d5ee66`，新 blob `b422ee08`）

1. **清理目标逐个尝试＋收集后再传播**：`killWorkerTrees` 把每条记录的非 ESRCH kill 失败**收进数组**并继续访问余下记录，循环＋等待全部完成后抛出首个收集错误（原 syscall 栈不变，其余随 `.errors` 携带）；`killFirstInstance` 同型——`child.kill` 的非 ESRCH 失败进收集数组后**无条件**继续执行 `killWorkerTrees`，两处收集合并后抛首个错误。任何自有目标的失败不再跳过任何其余自有目标。
2. **存储子进程退出门句柄化**：删除 `findOwnStoragePid()`（全局 `ps` 扫描）与门的全部裸 PID 信号（`process.kill(pid,0)` 探测／强制 SIGKILL 裸 pid）；`spawnSync` 导入一并移除。取而代之在**资源取得时**（`startWebBackend` 返回后、close 之前）直接取 `backend.recovery.storage.child`——锁定链 entry 返回 `recovery`（`TaskRecovery` 存 storage/taskService）、`StorageClient.child` 是 spawn 出的真实 ChildProcess 既有字段——非真句柄（缺 `once`／`kill`）即记录捕获错误、由门步响亮重抛（close 仍执行，门不得空洞）；句柄上注册 `once('exit')` 记录退出事件。门步在 5000ms 有界窗口内以**句柄自身退出事件／退出态**（`exit` 事件、`exitCode`、`signalCode`）核退出；超时的存活者只在**句柄上**强制（`storageChild.kill('SIGKILL')`＋有界等待退出），随后门步响亮抛错。生产 `close()` 尽力关闭契约零改动。
3. **全部业务断言与既有语义保留**：`git diff -U0` assert 行 0（58 个 assert 调用不变）；`t.passed` 条件抛出、`[cleanup]` 双通道脱敏诊断、kill → close → 门 → 删根恒末顺序——`f7e8307`／`c29219f` 已登记语义逐字保留；crash 面的组 kill 与 worker 树消失等待（`record.pid` 的信号 0 等待）为 crash 时点既有登记面，不属退出门，未改。
4. 文件头注释同步（收集传播＋句柄化门）；`node --check` 通过。

## 2. 验证（锁定链 + 恰 3 个未跟踪覆盖 + 登记二进制，第 7 次独立复现）

运行树：`git archive 681c282…9139`（tree `754b790811d8c097…`）提取 ×2，`diff -r` 零差；覆盖恰 3 个未跟踪文件（测试 `b422ee08…`、worker `11f498d9…`、instance `a4716ffa…`＝登记 blob）；`build/s0-runtime` 复制自本机已备 runtime 树（organizer `08f32db2…911a7`、node `9d050fd4…0588a`＝登记身份，runtime 字节未被消费）；存储二进制**在运行树内从锁定链 Rust 源重建**：`cargo build --manifest-path src-tauri/Cargo.toml --release --bin web-backend-storage` → `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2647984 B）＝登记身份逐字节命中（第 7 次）。node v24.20.0、rustc 1.99.1 `58cf8f9c3`。逐字命令：`node --test --test-reporter=tap --test-timeout=20000 <file>`。

| 项 | 结果 |
|---|---|
| FINAL 字节一次正常回归 | **2/2 PASS、exit 0**，TAP 零 `[cleanup]` 行，总 10953 ms（与既往 5288–5403 ms/例同域——句柄门在绿路上仅亚秒），套件自身 stderr 0 字节（捕获文件仅含 `/usr/bin/time -p` 三行报告），`w1-receipts-*` 残留 0、遗留进程 0 |
| F1' 反控：**首个自有目标**调用层 EPERM（scratch 副本，已删；driver 自带锚点注入，全部目标为探针自有进程） | 注入 A：`killFirstInstance` 的 `child.kill` 调用层受控抛 `Error: kill EPERM`（**第一个**自有清理目标）；注入 B/C：向用例根播种**探针自有**进程组记录——两个**活的**分离组＋一个已死组（生产形 `worker.json`，attemptId/taskId 前缀 `probe-` 不污染业务断言）；注入 D：循环内对该**探针自有已死组**的 kill 调用层抛 EPERM。**AFTER（新字节）**：**exit 1**、两例 `hookFailed`、`[cleanup]` 点名 kill 步且错误即 `Error: kill EPERM`（脱敏栈 `file://<repo>/…:302`）——**两个活的探针自有组被套件真正 SIGKILL（driver 事后 `kill(pid,0)` 核实均 ESRCH，幸存者 0）**，根残留 0（rmSync 恒末）、进程残留 0、stderr 0 字节，总 11044 ms；循环内注入 D 的错误被收集且不中止（无论 readdir 访问顺序如何，结局确定性成立）。**BEFORE（交付字节 `27d5ee66` 同注入）**：`child.kill` 抛错 → `killWorkerTrees` **从未执行** → 两个活的探针自有组**双双幸存**（driver 核实 alive 后代为强制清场）——协调者指名的缺口在交付字节上逐字复现，证明 AFTER 的通过面真实绑定、非空洞 |
| F2' 反控：close 返回但自有存储仍活（scratch 副本，已删；安全形态） | disclosed 落日志包裹仅旁路 `StorageClient.prototype.close` 优雅握手（其余关闭步与生产字节全真），且 RA1 **最后一条断言**期望值翻转（true→false）→ `backend.close()` **返回而句柄子进程仍在运行** → 句柄门 5000ms 判活超时 → **句柄上强制 SIGKILL 完成** → 门步响亮抛错 → **exit 1**（自动、全程无人工终止，进程自行退出，总 20629 ms）；**RA1 原断言失败完整可见**（`the production non-readonly check reads the preserved facts`、`failureType: 'testCodeFailure'`）且 `[cleanup]` 门步诊断**并存**（`handle pid 5381`／`5562`）；RA2 绿体 → `hookFailed`；其余清理继续、根残留 0、存储进程残留 0、stderr 0 字节 |

观察登记：`[cleanup]` 诊断单行 200 字符截断使门错误信息的「enforcement 完成」尾缀在 TAP 中不可见——完成面由结局证明（probe 自行退出＋两个句柄子进程死亡＋除旁路注入外无任何他者可杀它们＋残留 0）；driver 判定表中的 `did not complete` 唯一命中是 RA2 hook 自身措辞（`cleanup did not complete (…) — teardown failures must not pass silently`），非 enforcement 失败尾缀。F1' 的循环内注入 D 的「收集后继续」结局与访问顺序无关（两活组无论先后均被清），但其单独可见性依赖顺序，登记为顺序依赖观察。

## 3. 边界与未签范围

- **作者交付，非独审**：按派工修订后另派独审；聚合准入仍在协调者。
- 生产 `close()` 尽力关闭契约原样保留；F2' 旁路仅为反控 disclosed 注入，不代表生产语义。
- 反控目标边界（派工 `01a1c0b8`）：全部毒目标与清理目标均为**本测试／探针自行启动并持有的进程／进程组**（探针分离 node 进程＋用例根内生产形记录）；**未选择、未试探、未向任何外部受保护组发信号**。上一轮（`c29219f`）对真实受保护组的信号 0 试探与注定 EPERM 的 SIGKILL 动作按该派工保留登记为「未实际送达」的事实，不作为可复跑方法，本轮未重复。
- 旧证据披露：上一轮帖子 CLI 读回附件 0 件；此前各轮原始证据目录位于更早的工作树实例，本工作树内已不存在（如实披露，不补造）。本轮证据全部为本次实测新产出并实际挂附件。
- 未重跑持久门／五探针／四套件／完整 gate；未触真实模型／凭据／用户根（合成临时根、受控 stub、零外联）。
- `check:structure` 183＝登记基线（零新增）；`check:docs` exit 0（21 文件 513 链接）。
- 卫生：运行树、scratch 探针与双提取副本整体移除；`/tmp/w1-receipts-*` 残留 0；匹配本运行树／探针标记的进程 0；其他成员工作树进程（`mayne-24-164938414566` 的 2 个存储进程）未触碰。原始证据（gitignored）：`build/mayne24-receipts-killclose-r2/`（4 组 TAP+stderr、2 个 sidecar、3 份探针副本、2 份 driver、identity.txt、SHA256SUMS 16 项）。
