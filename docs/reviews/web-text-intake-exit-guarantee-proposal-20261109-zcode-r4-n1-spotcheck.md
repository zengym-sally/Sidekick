# 提案 r4 N-1 点检记录（2026-11-09，ZCode）

派工：MAYNE-24 触发评论 `01a1be6b-f259-7b45-8357-f253a8b198ae`（Codex）——「先按原 N-1 审只点检 `04f3264` 修改面、三级事实与引用对应（尤其权威输入评论 ID），不重跑旧 OS 证明」。本记录为只读对象库取证，零树改动（除本文档），未重跑任何探针／OS 证明，未跑完整门禁。

## 结论

**N-1 收口与锚点登记本身：通过。引用对应：一处缺陷（C-1，登记级更正项）——权威输入评论 ID 写错载体**：r4 把 ZCode r3 独审的议题评论写成 `01a1be2c-c92d`（实为 OhMyPi 的 W 独审评论），正确值是 `01a1be2c-7454`（两评论同前缀、相隔 22 秒；附件 ID 本身是对的，挂错了评论）。内容归属无误、附件可读，属载体 ID 误引而非内容虚构；按 §1/§2/§12 三处 docs-only 更正后即闭合。提案仍不采纳、不代签任何生产或授权。

## 1. 身份与修改面（复核通过）

- `04f32640472ce3a20feeb34e80c3e400df057013`，tree `0e5066af7dfed00ff6af9a1bfbc53c6c2955e5f9`，父 `4a6eb63`——与锁定值逐字节一致。
- numstat 恰 1 文件：`docs/reviews/web-text-intake-exit-guarantee-proposal-20261109.md` +24/−3，docs-only；六处编辑与提交声明逐一对应（§1 r4 行、§2 O-15 行、§4-A-UID 一处括注、§7 矩阵第三行、§11 一句、§12 r4 块）。生产／测试／Runtime／DDL／守卫零差异。

## 2. 三级事实（§7 矩阵「可信 test 面」行，对照原 N-1 判据逐项成立）

- ①**已有已核结构事实**：登记的输入侧锚与本轮对象库复读**逐行一致**（`git cat-file blob` 直读）：`organizer-entry.mjs` blob `9414f23f…` :63（kind 白名单 {extract,revise,test,trial,today}＋`snapshot?.provider/model`＋apiKey 协议校验，单行全在）；:109 managedBash 无条件构造；:114 `useTools` 合取含 `request.kind!=='test'`；:115 `tools=!useTools?[]:[…]`；:116-117 MCP 分支仅 {trial,extract,revise}、test＋MCP→`RUNTIME_PROTOCOL` throw。`managed-bash.mjs` blob `8efb358d…` :12-14 仅建 `children` Map＋close 闭包（无 spawn）、:20 detached spawn 位于 `operations.exec` 内（惰性派生成立）。「唯一已核的通用 spawn 形状事实」这一不准概括已删除。
- ②**尚缺端到端完整证明**：服务端沿真实调用链的 kind/snapshot/MCP 输入派生一致保证**未核**，登记为取证欠账——与 N-1 要求一致，未以入口结构事实代签。
- ③**双向可达性未验证**：登记为架构推断——与 N-1 要求一致。
- 停车结论不变：仍由通用裁定支撑（r1 主裁定＋协调 `01a1bd87`；通用 unknown 是证据不足的执行落点、不代替路径特异性核验）；「无探针」保持不变。F-3 外推禁令与「不依赖本面存在 detached 后代」保留。

## 3. 锚点登记（O-15，复核通过）

- O-15（`KERN_PROC_UID` 按 effective uid、`KERN_PROC_RUID` 按 real uid 过滤，XNU `xnu-11215.81.4` `bsd/kern/kern_sysctl.c:752-769`）内容与 ZCode r3 审 §1 的登记一致；**转引状态如实标注**（「ZCode r3 独审已核、本修订转引未独立复验该源文件」）——未核路径未写成已证，符合原审建议的可选补登定位。§2 行、§4-A-UID 括注、§12 锚表三处一致。

## 4. 引用对应（C-1 缺陷在此）

- **C-1（须更正）**：`01a1be2c-c92d` 在 r4 文件中出现 3 处（§1 r4 行「议题评论」、§2 O-15 行「ZCode r3 独审 §1 复核（评论 …）」、§12 r4 块「权威输入」），提交信息中另有 1 处。实际：`01a1be2c-c92d-7e5b-8990-334da9f1b9d0`（02:39:28Z）是 **OhMyPi 的 W 一文件修改面独审**交付评论，`attachments=[]`；ZCode r3 限定独审的交付评论是 `01a1be2c-7454-7400-a080-f7ea705212bc`（02:39:06Z），其附件 `01a1be2c-735b-7455-b190-4bbe88b278fc`＝`web-text-intake-exit-guarantee-proposal-20261109-zcode-review-r3.md`（9692 B）——r4 所引附件 ID 正确但挂在 `-c92d` 名下。根因：两评论同分钟发布、共享 `01a1be2c` 前缀，作者取错后缀。被归属的内容（P-1/P-2/P-3/mcp_ack 成立、N-1 须收口）与 r3 评审实际内容完全一致。**更正方式**：三处 `01a1be2c-c92d` → `01a1be2c-7454`（docs-only；提交信息不可变，无须处理）。
- 其余引用逐项核实准确：协调派发与锁定 `01a1be33-775f`（内容确为「P-1/P-2/P-3 更正成立，N-1 仍须收口」）；作者交付评论 `01a1be0f-6a3f`（原文确含被更正的「可信 test 面**无锚、无探针**」概括）；评审记录文件名与附件名一致；`01a1bdf9-460b`／`01a1bdfb-b508`／`01a1bd87`／`01a1bd64` 系 r3 及之前已核引用，本轮未改动。
- r4 锚表对 r3 锚表各行「未改动来源、原样复用」的声明与 diff 相符（r3 块零字节改动）。

## 5. 边界

只读对象库取证＋本记录文档；未重跑 E1/PC-G/PC-H 或任何 OS 源码核验（O-15 沿 r3 已核结论转引核对）；未跑完整门禁；未实施、未申请权限；候选树与提案作者分支零改动。MAYNE-24 保持 in_progress。
