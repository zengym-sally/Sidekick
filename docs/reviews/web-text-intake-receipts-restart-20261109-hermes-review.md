# `5e3177d` MCP 回执跨重启回归候选独立独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf78`（Codex）。对象：`5e3177d927442fb8bdcbf68de4043a224a4ae81b`（tree `0f051d9d…9cb3`，父 `d1b87e2`）：恰三份新测试／夹具＋记录 +830，生产／既有测试／Runtime／DDL／package／索引零改动（自验）。本人未参与该候选。

## 结论

**通过（限该回归候选的判据与机制面）。** 两例在锁定 `681c282` 生产链上两连跑 2/2（TAP 随附件）；RA2 持久门判定为「充分但方向受限」；护栏分别承重经突变复验坐实；公式只校验既有行属实。

## 复跑与身份（全部本轮实跑）

- 运行树＝detached `681c282`（tree `754b7908`）＋恰四文件 overlay（三个新测试/夹具为 untracked 新增，记录不入运行树）；存储二进制由该树 Rust 编译；`node --test --test-reporter=tap --test-timeout=20000` 原样执行。
- **run1：2/2 PASS exit 0**（RA1 4.85s／RA2 6.57s，总 11.6s，stderr 0 字节）；**run2：2/2 PASS exit 0**（11.6s，stderr 0）——与作者登记的两轮形状逐项一致。
- 逐 blob/SHA 复核：测试 `bfd32f76`（SHA-256 `07a46804` ✓）、worker `eb920a1e` ✓、instance `a4716ffa` ✓；worker 夹具确从已审 `mcp-pairing-frames.mjs` 导入帧构造器（帧身份单源）；instance 与 `recovery-instance`（`5fe68cb4`）的 diff **仅 env 透传面**（receipts 模式＋身份变量替代 recovery 模式），字节镜像声明成立。
- 清理实测：三轮（两正跑＋两突变跑）后 `/tmp/w1-receipts-*` 残留 **0**、本树无残留进程；after 钩子次序＝kill 首实例 → `backend.close` → `rmSync` 最后（注册自纠的次序缺陷已修且注释说明原因）——断言失败/早退路径同样按钩子顺序执行 kill→close→删根。

## 派工重点逐项

- **真实落账跨重启**：RA1 经真实子进程 entry＋SIGKILL＋生产重启（registerEpoch＋恢复扫描＋scheduler 生产顺序），恰三行预崩溃事实（begin A/closed A/begin B）重启后可读，全行 `provable_readonly=0`、`recorded_at` 为生产时间戳；恢复信封 `restart_unknown_side_effect`/`unknown` 从生产任务行读回。
- **begin/closed 关联**：closed(A) 的 `receipt_id` 等于按冻结 P-3 公式以 begin 的 callKey `[callA, modelCallA]` 重算值——真实配对（非 FIFO/unattributed）；open begin(B) 重启后无闭合、无 unattributed 漂移（不虚构另一半）。
- **新 attempt 隔离／两护栏分别承重**：resume → 202 → 新 attempt（新 epoch、独立 run、独立 worker.json）；同 callId 闭合落 `tool_call_unattributed` 于**新** attempt（attemptId 进哈希，永不续接旧 begin）；死 attempt 写（合法身份）→ false 且账本不动；旧 epoch 对活 attempt 写 → false 且账本不动。**突变敏感性复验**：翻转旧 epoch 期望 → RA2 恰在该断言红；破坏 closed callKey 期望 → RA1 恰在公式断言红（RA2 skip）——两护栏各自承重、断言各绑其面（突变副本跑后即删，未留候选）。
- **公式只校验既有行**：`receiptId` 仅对生产已写行重算归类，无任何造行路径（代码通读＋RA2 discrimination control 佐证——正确身份写落 true 且重复幂等不增行，明确标注为合成对照不证安全）。

## RA2 持久门（worker.json＋1500ms）判定

**充分但方向受限。** 前提经生产代码实核：`worker.json` 在 `681c282` 的 worker-host 于请求行送达 stub **之前**落盘（:323 写记录 → :421 写请求），故 record-on-disk 先于帧往返成立；1500ms settle 只覆盖该往返。失败方向分析：病理性停顿 >1500ms 时崩溃先于持久化 → 重启后行数为 0 → **必然响亮红**（`rows1.length===1` 断言绑正行）；**不存在静默绿**——绿 ⇒ 行确在崩溃前已持久（SQLite 已提交事务）。即该门不是持久性证明，而是「假红可能、假绿不可能」的定时窗——对回归用途充分，登记为已知非确定性（作者已如实登记，本审确认其方向）。RA1 与 RA2 新 attempt 的回执事实走 wire 可见的 staged 窗口确定性门（更强）。

## 登记（非阻断）

1. **二进制来源漂移（重要，非候选所致，建议协调层知悉）**：本轮在 `681c282` 与 `c7cc116` 两树的构建均得 `5311ffa3…3232bd`（2647984 B，两树**字节互同**，Rust 源零行差异）——规范 `42af54b5…` 未复现。根因诊断：本机 Rust 工具链在会话中由 **1.89.0 自更新至 1.99.1**（今日 15:53 前的构建仍得 `42af54b5`），codegen 布局变化（Mach-O `__TEXT` 段尺寸/偏移前移）与环境相关、与树无关。所核回执/SQL 面来自相同 Rust 源，判定不受影响；**但全队二进制身份基线需在 1.99.1 下重新固化或回钉工具链**。
2. RA2 resume 用 `expectedVersion: 1` 依赖 `681c282` 链上 `inputRef.recovery` 未盖章的链特定事实（测试头注已声明锁定链）；换链重放时该处需复核。
3. W2 MCP 可达性、`proven_safe` 面、重启-恢复语义边界均未签署（与作者边界一致）；stub worker 是唯一替身面，帧构造器来自已审来源。

## 边界

只写本审阅文档与本机证据（两轮 TAP＋突变 TAP＋身份＋SHA256SUMS 随附件）；未改候选／生产／package／索引，未跑完整 gate；突变副本跑后即删；MAYNE-24 保持 `in_progress`。
