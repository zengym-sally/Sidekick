# MAYNE-24 — MCP 回执跨重启候选 `5e3177d` 两项测试窄修交付（ZCode 作者自改，2026-11-09）

派工：协调 `01a1bf96`（`5e3177d` 暂不准入聚合，两项窄修：RA2 崩溃门改真实已持久 begin 行；资源取得时即登记有序清理）。作者本人按派工交付，交付后另派独审（本轮不自审签字）。

## 交付物（恰两文件，零生产／既有其他套件／Runtime／DDL／package／索引字节）

- `tests/unit/web-text-intake-receipts-restart.test.mjs`：blob `bfd32f76` → `715f123f…`（SHA-256 `560f1a00…`）
- `tests/fixtures/web-text-intake/receipts-restart-worker.mjs`：blob `eb920a1e` → `11f498d9…`（SHA-256 `ec5645b5…`，仅 mode 注释更新）
- `receipts-restart-instance.mjs` 逐字节未动（blob `a4716ffa` 不变）。

**原两例与原断言完整保留**：`git diff -U0` 断言行改动恰 0——全部 assert 为逐字节原样；窄修只动 import（+db-observer）、文件头注释、RECEIPT_SETTLE_MS 常量删除、清理登记机制与 RA2 崩溃门两处实现。

## 窄修一：RA2 崩溃门 = 绑定 task／attempt 的真实已持久 begin 行（只读 SQLite 观测）

替换原 worker.json＋1500ms settle 门（登记过的非确定性）。新门沿既有只读观测夹具 `db-observer.mjs`（`node:sqlite` `readOnly:true`、纯 SELECT——`681c282` 在树既有已审夹具，非新生产接缝、不写事实）：轮询真实数据库文件中**绑定该 task 的 attempt 的已提交 begin 行**（`side_effect_receipts JOIN task_attempts ON attempt_id WHERE task_id=? AND kind='tool_call_begin'`），恰 1 行才 SIGKILL——行本身即持久性证明，无 settle 窗口、无时序竞态。行永不出现则门在 6s 处响亮超时（见探针 E），不静默滑入崩溃。文件头与夹具 mode 注释同步更正。

## 窄修二：资源取得时即登记有序清理（启动／重启失败也覆盖）

单一 `t.after` 钩子在**根创建那一刻**注册；teardown 步骤按资源取得顺序追加——首实例子进程 spawn 成功即登记 kill 步（含 `killWorkerTrees`：按 `worker.json` pgid 清理存活 worker 树）；重启后端 handle 成功即登记 graceful close；**rmSync 恒为最后一步**（kill → close → 删根纪律保持，WorkerHost.state.finish 重写 worker.json 的旧坑不复现）。任何早退路径——首次启动失败、提交断言失败、task-running／gate 超时、crash 中途、重启失败——都走同一钩子，不再依赖"重启成功后才注册"的旧注册点。`startWebBackend` 自身失败路径本就释放其打开的资源（entry 字节核实），故重启失败只需登记成功 boot 的 close。

## 验证（锁定链 `681c282`，tree `754b7908`，detached 运行树＋恰 3 个未跟踪候选覆盖＋存储二进制 `5311ffa3…232bd` 2647984 B——与 Kimi/Hermes 独立构建互证；s0-runtime `08f32db2`／node `9d050fd4` 与既往登记一致；node v24.20.0）

逐字命令：`node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-receipts-restart.test.mjs`

- **终字节三连跑 2/2 PASS、exit 0、stderr 0 字节**（run1 5402.9/5319.1ms suite 10778.2；run2 5050.7/5309.7 suite 10424.4；run3 5043.7/5288.0 suite 10391.1）——两例均在 20s 预算内含清理；RA2 较旧字节更快（settle 窗移除，门轮询即达）。
- **探针 A（受控延迟·不假红）**：scratch 夹具把 stub 帧发射延迟 1200ms（慢写模拟，跑后即删）——RA2 仍 PASS（7713ms），门等待真实落行而非竞速固定窗。
- **探针 B（首次启动失败）**：scratch instance 即刻 fatal——测试在"first instance failed to boot"响亮红，**删根 0 残留、子进程 0 遗留**。
- **探针 C（重启失败）**：scratch 测试让 startRestartedInstance 即刻 throw——恰在该 throw 红，删根 0 残留、0 进程遗留。
- **探针 D（存活 worker 早退）**：RA1 用 begin-hang stub（worker 永挂存活）+ staged 门超时——响亮红后 **存活 worker 被清理**（pgrep 0）、0 根残留。协调点名的"存活 worker 未被早退路径覆盖"窗口闭合。
- **探针 E（门承重）**：RA2 用从不发射的 receipts-bare stub——恰在新门处红（`timeout waiting for persisted begin row`），门非空洞。
- 全部运行／探针后：`/tmp/w1-receipts-*` 0 残留、运行树 0 进程、树终态恰 3 个未跟踪候选 0 tracked 改动，运行树整体移除，scratch 即删。

## 边界与登记

- `check:structure` 基线原 FAIL 182（会话前既存＋前次候选同类），现 183（+1 同类 ref.missing：`test → ../fixtures/db-observer.mjs`，该夹具在 `681c282` 在树、分支基线不存在——候选仍只在锁定链运行）。无守卫改动。
- 不代签：聚合准入仍待协调；原两例断言语义未变（本轮只换门与清理机制），独立独审仍按派工另交；RA2 判别对照行依旧明确合成、不构成安全证明；W2 MCP 可达性与 proven_safe 面未触及。
- 原始证据 gitignored `build/mayne24-receipts-restart-fix/`（三连跑 TAP＋stderr＋五探针 TAP＋SHA256SUMS），终字节 TAP 与摘要随评论挂载。
- 未跑完整 gate（按派工）；未触真实模型／真实凭据／用户根（合成根、受控 stub、loopback 无外联）；MAYNE-24 保持 `in_progress`。
