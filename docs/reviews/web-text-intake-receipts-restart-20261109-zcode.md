# MCP 回执跨重启可读性回归 — 测试候选交付（ZCode，2026-11-09）

- 派工：MAYNE-24 触发评论 `01a1bf42`（Codex 分派，接 `d1b87e2` 的 test-safety 限定审）。本记录只登记交付物与实测事实，不关闭任何缺口；MAYNE-24 保持 `in_progress`。
- 交付物：恰三个新文件，零生产／既有测试／Runtime／DDL／package／索引字节改动。
  - `tests/unit/web-text-intake-receipts-restart.test.mjs` — blob `bfd32f76f97b86c682d80250ec282cd3626cd983`，SHA-256 `07a46804…bba41e`
  - `tests/fixtures/web-text-intake/receipts-restart-worker.mjs` — blob `eb920a1e90b84deeebeed3e9f70b60626d790aff`，SHA-256 `567188ec…c3cdaa`
  - `tests/fixtures/web-text-intake/receipts-restart-instance.mjs` — blob `a4716ffa302c35b110e0b4a80fde0ae29bec90c8`，SHA-256 `d21a7d64…5d241`
- 状态：**独立待审测试候选**。未参与本轮独立审（作者本人交付），green 事实只在锁定链上登记，不构成任何签字。

## 1. 复用与冻结输入

- **帧形**：夹具直接 import `./mcp-pairing-frames.mjs`（`mcpBegin`／`mcpResponse`／`extractResultFrame`）——即 MCP 配对回归的已审 builders（本链 `681c282` 上与 Kimi 候选 `a02af9e` 逐字节相同，`git diff` 为空；评审记录 `docs/reviews/web-text-intake-mcp-pairing-test-20261109-zcode-review.md`）。`call_response` 不重复 `modelCallId`，配对只认 serverId+callId 单调用身份。夹具只做逐帧重围栏（runId/hostNonce）。
- **receiptId 公式**：冻结 P-3，按生产 `server/lib/task-service.mjs`（`681c282`）`receiptId` 原样重述：SHA-256(紧凑 `JSON.stringify([runId, attemptId, kind, callKey])`) 前 32 hex。测试只对生产已写行做重算归类，从不生成行。
- **写护栏**（被测面）：生产 `recordReceipt` —— 任务 `attemptExitState !== 'active'` 拒写；`epoch !== attemptEpoch(attemptId)` 拒写；`receipt_id` 主键幂等。配对为 persistence-gated、按 attempt 隔离（`worker-host.pairReceiptFact` + `task-scheduler.onWorkerFrame`：无同 attempt 内已持久 begin 的闭合落 `tool_call_unattributed`，绝不虚构配对）。
- **两实例架座**：复用恢复套件（`82e1bf2` 已登记）的两实例模式——第一实例经生产入口以真实子进程启动并被 SIGKILL（真实崩溃），重启实例在本进程经同一生产入口启动（registerEpoch + 恢复扫描 + scheduler 启动的生产顺序）。子进程 runner `receipts-restart-instance.mjs` 是 `recovery-instance.mjs`（blob `5fe68cb4`，本分支与 `681c282` 逐字节相同）的字节镜像，恰改一处：stub 环境透传换成本套件的 `SIDEKICK_RECEIPTS_STUB`／`SIDEKICK_RECEIPTS_IDENTITY`（身份单源，测试与夹具共读，防漂移）。

## 2. 用例与断言（每例 20s 含清理）

- **RA1 begin/closed 关联＋开放／非只读事实跨重启保留**：首实例 emit begin(A)+response(A)+begin(B)+result（暂存窗为持久门：调度器在同一次帧钩子里先持久回执再暂存），SIGKILL，生产重启。读回（生产 `storage.command('query')` 路径）：恰 3 行都在，closed 行的 receipt_id 按公式证明其 callKey 继承自 begin（真实配对而非 unattributed）；开放 begin(B) 之后无任何闭合行（重启不虚构另一半）；全部 `provable_readonly=0`、`recorded_at` 为真实生产时间戳；`hasNonReadonlyReceipts=true`；恢复 failure（从生产任务行读回——线上 `visibleFailure` 对未暂存的 needs_review 为 null）`cause=restart_unknown_side_effect`、`sideEffectSafety=unknown`——**真实非只读回执永不被读成 safe；断言全部绑定正行，零记录／全闭合不作为 safe 证据**。
- **RA2 死 attempt／旧 epoch 拒写＋新 attempt 同 callId 身份隔离**：首实例仅 begin(A)（无 result，重启后 resume 走再排队路径；resolve 的 `expectedVersion=1` 为本链 `inputRef.recovery` 未盖章下的条目版本语义），重启后先核：恰 1 行 begin 存活；对死 attempt（needs_review）的 `recordReceipt` 生产调用返回 false 且账本不变。resume（同事务关闭旧 attempt 行，`681c282` 已含 R8-M-2 修复）→ 新 attempt 在新 epoch 下被认领 → 重启 stub 仅 emit response(A)+result（暂存窗为该行持久门）：同 callId 闭合在新 attempt 下落 `tool_call_unattributed`（fresh attempt 无已持久 begin，绝不延续旧 attempt 的 begin——旧账本恰 1 行、kind 不变、无 fabricated closure）；receipt_id 按公式含新 runId/attemptId，与旧行不碰撞；对活跃新 attempt 的旧 epoch 写被拒（false 且无写入）；判别对照：正确身份的生产写入落账（true，恰 +1 行且 id 合公式），重复写幂等（true，行数不变）——护栏按身份判别而非一刀切拒绝；该对照行明确标注为合成，不构成任何安全证明。

## 3. 实测（锁定链 `681c282`，tree `754b7908`）

- 运行树：detached `681c282` 零 tracked 改动；存储二进制从该树自身 Rust 源编译＝`2649408 B`／SHA-256 `42af54b5…490fc2`，与全部既往登记逐字节相同；node v24；聚焦命令 `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-receipts-restart.test.mjs`。
- **最终字节（blob `bfd32f76`）两连跑 2/2 PASS、exit 0、stderr 0 字节**：run4（RA1 4851ms／RA2 6568ms，总 11478ms）、run5（RA1 4844ms／RA2 6554ms，总 11455ms）——两例各在 20s 预算内（含清理）。
- 修正前字节（blob `37132f80`，恰一处清理顺序缺陷，见 §4）三连跑同为 2/2 PASS 同形（run1 TAP 存档为 `run1-prefix-bytes.tap`）；两字节版本的断言集合相同，green 面不因修正改变。
- **可证伪性探针（隔离树内 scratch，跑后即删）**：P1 把旧 epoch 拒写期望翻为 true → RA2 恰在该断言红（拒写面咬合）；P2 把 closed 行期望 callKey 换成 unattributed/null → RA1 恰在配对公式断言红（关联面咬合，RA2 不受影响）。两条 green 面均非空洞。
- 清理：最终字节两连跑后 `/tmp` 零 `w1-receipts-*` 残留；本运行树零进程残留（pgrep 命中的 2 个 `web-backend-storage` 属其他 agent 工作树，未触碰）；运行树终态恰 3 个未跟踪候选文件、零 tracked 改动。原始 TAP 与 SHA256SUMS 在 gitignored `build/mayne24-receipts-restart/`（run4/run5 终字节＋stderr＋run1 前字节存档）。

## 4. 修正登记（作者对自身首稿）

- **after 钩子顺序缺陷**：首稿把 `rmSync(root)` 注册为第一个 after 钩子，而 node:test 按注册顺序执行 after——root 在优雅停机前被删，而活 worker 的退出路径（`WorkerHost.state.finish`）会重写 worker.json， recreating `runs/<runId>` 空壳（run1-3 每轮遗留 1 个 root）。修正：rmSync 注册移到最后（kill 子进程 → backend.close → rmSync），并在夹具注释里写明原因；run4/run5 起零残留。

## 5. 边界与不签字项

- 本套件**不签**：W2 MCP 可达性（MCP 真实接线、guardian、catalog 面一律未触——帧经已审 builders 注入，替代 worker 二进制是唯一替换点）；`proven_safe` 判定面（零记录／全闭合不作为 safe 证据，本套件也不构造或验证任何 safe 结论）；重启恢复语义（恢复分类面归恢复套件既有登记）。
- **已登记非确定性一处**：RA2 首 attempt 的裸 begin 行没有线上可见门，崩溃门为 worker.json＋1500ms settle；若极端停顿导致行未及持久，重启后读回恰 0 行会让断言**响亮地红**（不可能静默绿）——正行只可能来自实例 1 的崩溃前写入。
- 本分支 `check:structure` 基线本就 FAIL（180 项既有违规，含恢复套件同类 ref.missing）；本交付新增同类 ref.missing 恰 2 条（worker 夹具对 `./mcp-pairing-frames.mjs`——`681c282` 上存在、本分支基线尚未携带；test 对 `server/lib/credential-provider.mjs`——已被恢复套件同文件引用先标）。test 的 `server/entries/web-backend-entry.mjs` import 在本分支可解析（该文件存在，但本分支携带的是 5 月基线旧入口字节而非锁定链入口——候选只在锁定链上运行，本分支不执行）。逐字节事实登记，非新违规类别；check:structure 由 180 项到 182 项。
- `check:docs`（新增本记录后）本地相对链接须过；无 README 索引改动（沿用既定范围）。
- 未触真实模型／凭据／用户根（`controlled:e2e` 合成凭据、死端口 baseUrl、受控 stub、合成 temp root）；未跑完整 gate（候选交付按派工不属收口）。
