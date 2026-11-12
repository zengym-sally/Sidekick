# MAYNE-24 III 聚合窄追加候选独立独审（Kimi，2026-11-09）

> 派发：工单 `01a1b046-9c0d-7515-a447-69ace095580c`（MAYNE-24）触发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bd37-7e35-7577-b50a-16e87701ff49`（Codex）：限定独审 `589eeaad2b97086030af3c7235d3b6a1f8532ae7` 三文件工程增量（交付 `01a1bd01`），复用 `ff287ab` 已过面，不运行缺 I/II 的整组或完整 check。评审人 Kimi（未参与 III；II 套件作者，但本候选零 II 字节）。候选只读；原始证据 `build/kimi-review-589eeaa/`（gitignored）。

## 1. 结论

**通过**（限 III 聚合窄追加工程增量范围）。候选如实完成派发要求：`test:web-text-intake` 聚合显式纳入候选 I 第六轮生命周期回归 `tests/unit/web-text-intake-lifecycle.test.mjs`，脚本名、`--test-timeout=20000`、52 步 check 链、其余 106 个脚本与依赖/锁逐字节不变；登记对象身份、文档、准入与哈希经本评审独立复算全部属实；前置缺口（本树 6 个聚合文件缺失）如实保留，未跑套件/完整门禁、未代签任何业务通过。不改变候选 I 的 R6/R7 部分候选状态与 M-5 未闭事实。

## 2. 候选身份（独立复算）

| 项 | 登记值 | 复算 |
|---|---|---|
| 提交 | `589eeaad2b97086030af3c7235d3b6a1f8532ae7` | 相符（`agent/opencode/mayne-24`，父 `b6e107d1`，tree `b8f9b500`，父上恰 1 个新提交） |
| 差异 | 3 文件 +57/−2 | 相符：`package.json` 恰 1 行、新工程记录、reviews 索引 126→127 |
| 补丁 | `candidate-589eeaa.patch`（`46925507…`） | SHA-256 复算相符；系 `589eeaad` 的 format-patch，diff 体与 `git diff b6e107d1 589eeaad` 逐字节相同（仅 `-- 2.56.0` 尾迹），`git apply --check` 于父树干净通过 |
| `git diff --check` | — | 干净 |

## 3. 逐焦点独立实证（非采信自述）

1. **聚合入口纳入生命周期单测**：`package.json` JSON 解析 exit 0；`test:web-text-intake` 值恰 6 文件，`tests/unit/web-text-intake-lifecycle.test.mjs` 位于第 2 位（原 I 单测之后、四个 II integration 之前且原顺序不变）；脚本名不变；`--test-timeout=20000` 保留。四个 integration 路径与 II 实际套件文件名（本分支 `tests/integration/web-text-intake-{http,queue,controlled-model,static}.test.mjs`）逐一相符。
2. **登记对象身份**（从 git 对象重新导出，未采信核查日志）：候选 I `e840533`（tree `80dbd77c`）路径 `tests/unit/web-text-intake-lifecycle.test.mjs` ＝ blob `048a3c6125a6d5b94db96e1f8b1436fd412839d4`；内容 SHA-256 复算 ＝ `254fca3f944c14c6a2eb9cca746825219f3e9cfda824048c88eeaaa231a80830`（相符）；267 行；`node --check` exit 0；4 个顶层用例、22 处断言，无 skip/todo/only；四个用例名与工程记录所述覆盖（暂存窗存活/confirmExit 缺句柄与缺记录/verifyTree 未枚举或存活成员集/回执三事实）一致；7 个 `server/lib/*.mjs` 导入在 `e840533` 树内全部在场。
3. **权责归属**：候选 I `e840533` 相对 `e84fab6` 恰 5 文件且不含 `package.json`，其树内根本没有 `test:web-text-intake` 脚本——聚合缺口确属 III 权责，与派发定位一致。
4. **`ff287ab` 已过面复用**（ZCode 独审 `01a1bb87`，结论通过限 III 范围）：与 `ff287ab` 全量对比 `package.json`——107 个脚本名集合与顺序相同、唯一值变化＝`test:web-text-intake`（其余 106 个相同）、deps/devDependencies 相同、`check` 链 52 段且逐字节相同（仍含 `test:web-text-intake`）、`package-lock.json` 零差异。已过面的守卫/构建/接收记录/公共记录在本增量零触碰（差异仅 3 文件）。
5. **文档如实**：新记录 §2 身份表、§3 核查表、§4 缺口与独立结果一致；reviews 索引行 126→127 相符；`docs/engineering/verification.md`、`docs/product/05` 未动——其既有聚合表述（「候选 I 单元＋候选 II 四套 integration——http/queue/controlled-model/static，沿用 20000ms 用例预算」「聚合脚本（20000ms 预算）接入 check 链尾」）追加第二个 I 单元文件后仍逐字为真（已读原文核对）。
6. **准入与哈希**：CLI 下载 4 附件，大小与登记相符；`SHA256SUMS` 已交付 3 项复算全部相符；`admission-lifecycle.json` 的 branch/head/head-tree/祖先链（`b6e107d→06291e0→7aa0aee→8ac7064→65431da→ff287ab→a7d2a88→1e37044`）复算属实，写入清单与实际差异恰好一一对应、零越界，接收身份与复算值一致，planned reviewer＝未参与者（本人）。
7. **门禁边界**：在 `589eeaad` 树的 `git archive` 导出上复跑 `check:docs`：exit 0（22 文件 557 链接），与登记相符。按派发未运行 `test:web-text-intake`、任何套件与完整 `npm run check`（本树/该树均缺 I/II 前置）。

## 4. 观察（不阻断）

- **OBS-1**：准入以 `recorded_before_first_modification: true` 布尔断言、无时间戳，「首次修改前登记」从留痕不可独立证实时点（与 `ff287ab` 轮 ZCode OBS-1 同类）；登记内容准确且写入清单与差异完全一致，无越界迹象，无 verdict 影响。
- **OBS-2**：`SHA256SUMS` 登记 5 项、随评论交付 3 项（`final-delta-stat.txt`/`final-identity.txt` 留存 gitignored 证据目录）；两项所述事实（3 文件 +57/−2；提交/tree/父）已由本评审从 git 对象独立验证。

## 5. 未验项（如实单列，不构成本增量否决）

- lifecycle 文件 4 个用例的**运行结果**、以及候选 I `e840` 帧 mcp `call_begin`/`call_response` 分支缺口是否被其覆盖——属候选 I 后继增量与 R6/R7 独审范围；本候选只证明「路径已入聚合＋源文件语法有效、依赖闭合」。
- 套件执行、完整门禁、cargo、typecheck：唯一集成执行者在候选齐备版本串行新跑。
- 候选 I 仍是累计复核部分候选（R6 维持不通过，M-1/M-2/M-3/M-4 等未闭）；M-5 未闭、无业务准出——本独审不改变上述任何结论。

## 6. 边界

候选树零修改；未调用真实模型/凭据/用户根；未跑完整门禁；未 push、未改工单状态（MAYNE-24 保持 `in_progress`）。
