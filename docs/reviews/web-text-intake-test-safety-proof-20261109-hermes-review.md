# 可信 test 安全证明 `ceece1f` 独立独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bfe2`（Codex）。对象：`ceece1f85ea0bc7e6970495930cad2f83e5125a0`（tree `72c1669c…7efe`，父 `a3506af`），恰三生产文件 +101/−0（task-scheduler +75、task-service +11、worker-host +15）＋记录 `c32c251`；本审未写这三个文件。

## 结论

**不通过——"默认工厂＝已审随包 Pi"判据未成立**：新增判据只检查 `replacementFactory`，经 `runtimeRoot` 私有覆盖路径，**默认工厂spawn 的非已审入口实际获得了 `proven_safe`**（本审受控负控实测）。其余已核面（真实正控完整退避/预算序列、两负控、事实围栏、快照来源、deadline veto、逐 attempt 隔离）全部成立。修复方向已登记；该面收口前，证明缺口与聚合准入不关闭。

## 复跑（锁定 `0443e00` 三例，本审实跑，登记二进制 `5311ffa3…`）

运行树＝detached `ceece1f` ＋恰两测试文件 overlay（`0443e00` 的 test `10eb7031`＋stub 夹具 `4f3c9940`）；存储二进制＝登记的 `5311ffa3…232bd`（2647984 B，哈希读回验证）；`node --test --test-reporter=tap --test-timeout=60000`：

- **run1 与 run2 均 3/3 exit 0、stderr 0 字节**——真实随包 Pi 正控完整序列（proven_safe→queued→窗口内不认领→到期后二次 attempt 成功→预算递减→零回执）＋两负控（真实 extract 失败伪造客户端证明字段/快照保持 unknown；私有替换工厂 `stubInvocations===1` 保持 unknown/needs_review）全部复绿，与作者登记一致（作者数字按登记对待，本审为独立复跑）。

## 事实围栏核验（不以作者 15 项布尔矩阵替代来源验证）

- **快照来源**：负控 1 复现——客户端携带伪造 `inputRef.snapshot` 被忽略，服务端派生快照是判定前置（rerun 通过）。
- **当前 attempt/epoch**：`receiptCount`/`hasNonReadonlyReceipts` 按 `attempt_id` 查询；`trustedTestPathSafety` 以正在关闭的 attempt 的行/`handle.state` 计算，经 epoch 围栏 `stageResult` 落库；正控序列演示第二 attempt 以新 run 状态与新裁决结算（第一 attempt 事实不借给新代——worker-host state 逐次 start 重建）。静态核＋正控实跑。
- **合法帧 vs 错误帧**：`state.errorFrame` 仅合法身份帧置位；无帧死亡不授予（负控 2 路径实跑）。
- **工具/MCP/worker 观测**：三计数逐 run 统计，任一 >0 → unknown（静态核；正控断言 no-tools 前置）。
- **deadline veto**：`!deadlineFailure` 显式跳过——deadline 击杀永不 proven_safe（静态核＋正控窗口序列）。
- **回执写失败**：`receiptPersistFailed` 标志在回执持久化 catch 置位、判据检查——**仅静态核**（未动态强制写失败；诚实登记为该面未动态反控）。

## 不通过面：受控负控实测（派工指定项）

**既有入口校验范围读出**：`assertRuntimeLayout`（worker-host :188-196）全树仅出现一次＝定义本身，**运行时从未被调用**；即便调用也只查 `runtimeRoot/node` 与 `organizer.mjs` **存在性**，不查产物身份。spawn 的入口与 node 全部由 `runtimeRoot` 推导（`--runtime-root` CLI→entry config→WorkerHost），无身份校验。

**受控负控（本审构造，全程不改受审 Runtime 字节）**：默认工厂（无 `workerProcessFactory`）＋独立临时根合成 runtime（`node`=系统 node 符号链接、`organizer.mjs`=已审 stub 夹具的副本＋marker 写入——测试专用入口，非已审 organizer）：真实 HTTP 建 `test` 任务 → 真实 spawn → **合法身份帧 + 零回执 + exit confirmed 全部成立**（marker 证明默认工厂确实执行了该非已审入口）→ **实测 `sideEffectSafety=proven_safe`，任务 `queued` 自动重排队**。

即：`replacementFactory` 缺失 ≠ 「真实随包 Pi」。一个测试专用入口（可执行任意代码、不走回执协议）在默认工厂下同样拿到 `proven_safe` 并被盲目自动重排队——违反派工判据「可信执行来源不足就必须 unknown」。**修法方向（登记给作者）**：授予前绑定实际执行入口的产物身份（runtimeRoot 等于登记 bundle 路径，或 node+organizer.mjs 产物哈希绑定登记身份），身份不足一律 unknown；`assertRuntimeLayout` 若保留应升级为身份校验并被实际调用。

## 边界

不跑完整 gate；合成凭据/引用；运行后 tmp root 残留 0（套件自清理＋本探针自清理）；候选字节未改。原始证据（两轮套件 TAP、受控负控日志、身份清单、SHA256SUMS）随评论挂载。此审与日期 DTO 后继并行；E 仍待 owner；不因 test 路径绿放宽工具可达路径。MAYNE-24 保持 `in_progress`。
