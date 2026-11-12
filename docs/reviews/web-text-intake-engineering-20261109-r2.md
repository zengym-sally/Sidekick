# W1 文本整理 III：test:web-text-intake 聚合补登记 MCP 配对／recovery／events 三套已审回归（2026-11-09，r2）

> MAYNE-24 派发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bef5-caab-7cfb-bc03-99641fd5b809`（Codex，2026-11-09）：「在 lifecycle 后登记已审 MCP 配对、`82e1bf2` recovery、events 三文件，原六文件相对顺序、20000ms、脚本名集合／check 链／依赖／lock 不变；只写 package、独立工程记录与 reviews 索引，登记精确候选字节和前置构造边界，不造占位、不整树合入 I／II，也不跑完整 gate；尚未交审的 test-safety 不纳入」。这是对[聚合脚本](web-text-intake-engineering-20261109.md)的第二次**窄追加登记**（前次为 lifecycle 单文件），不是新候选轮；风险级：低（单行脚本值＋一条索引登记，核查面聚焦）。登记不重新签署任何独审结论——各套件的通过状态以其原有独审记录为准，本记录只登记「哪些精确字节进入聚合」与「跑起来需要什么前置」。

## 1. 范围与写入边界

唯一写入（`build/web-text-intake-engineering/aggregate-20261109-r2/admission.json` 在首次修改前登记）：`package.json`（仅 `test:web-text-intake` 的值）、本记录、`docs/reviews/README.md`（索引 129→130，顶部追加一行）。证据在 `build/web-text-intake-engineering/aggregate-20261109-r2/`（gitignored）。

未触碰：候选 I／II 全部文件（server/、src-tauri/、src/、tests/ 任何内容——三个被登记文件与全部夹具本树不落盘）、`scripts/`、`runtime/`、`vendor/`、锁文件与依赖、其余 106 个脚本值与 check 链。`docs/engineering/verification.md`、`docs/product/05`、architecture、docs/README 无需改动：聚合的既有表述（候选 I 单元＋II 四套 integration、20000ms 预算、check 链尾接入）在追加三个单元文件后仍逐字为真。

**排除项（按派工）**：`tests/unit/web-text-intake-test-safety.test.mjs`（Pi 按派工 `01a1bed7` 尚未交付、未经独审）**不纳入**聚合；其将来交审通过后由后续窄登记处理。

## 2. 登记对象的身份（只读对象库核验，零字节复制）

三套来源与逐文件身份（提交／tree 均为本轮对象库实测；blob id 即内容寻址；内容 SHA-256 与 `node --check` 为本轮对提取副本独立复算，见核查日志 §3–§4）：

**A. 已审 MCP 配对回归——Kimi II 窄追加候选 `a02af9e`**（完整 `a02af9e18e8b1a9417bd6de5f55fc027a1b1f4ba`，tree `2fda915fdbbb5befee024cbf483e8d8a1eeb7f53`，父 `85fb851`，恰 4 新文件）：

| 文件 | blob | 内容 SHA-256 | 规模 |
|---|---|---|---|
| `tests/unit/web-text-intake-mcp-pairing.test.mjs` | `3011552fb78af2e9…5d78b4` | `80717c43…802b3d` | 479 行／27047 B |
| `tests/fixtures/web-text-intake/mcp-pairing-frames.mjs` | `7a1dfac038826281…59e979` | `1b7ba122…ca216` | 76 行／3135 B |
| `tests/fixtures/web-text-intake/mcp-pairing-golden-frames.jsonl` | `97f8bfaf2525af5b…c2e9b6` | `35d7b97e…d1a18` | 15 行／3719 B |
| `tests/fixtures/web-text-intake/mcp-pairing-worker.mjs` | `d8bf1dab6f7161a1…633b6e` | `d07c6007…14a3` | 77 行／2977 B |

已审状态（如实引用，不新签）：golden 帧 SHA-256 `35d7b97e…d1a18` 与 P-3 冻结帧包第 6 次独立复验一致；ZCode 限定独审**通过（限定范围）**——作为对已核生产候选 `31434282` 的可证伪回归输入（破损链 4 过/7 败＋scratch 修正满足性 11/11 两遍），不签生产（评论 `01a1bdf9`，记录在其作者分支 `agent/zcode/mayne-24` 的 `web-text-intake-mcp-pairing-test-20261109-zcode-review.md`）；生产 pairKey 修复 `59b405f`（仅 `task-scheduler.mjs` +33/−7）经 OpenCode 独审，同四文件原字节在其树实跑 **11/11**（本分支记录 [web-text-intake-mcp-scheduler-fix-20261109-opencode-review.md](web-text-intake-mcp-scheduler-fix-20261109-opencode-review.md)）。四文件 blob 与该审登记（`3011552f`/`d8bf1dab`/`7a1dfac0`/`97f8bfaf`）逐字节一致。

**B. 恢复回归（更正字节）——ZCode `82e1bf2`**（完整 `82e1bf2cee161c829dd1d2919ec272b8b681693d`，tree `a6b25de9bb0cf0ee234470b7bd688583458b3524`，父 `b232828`；该提交恰改 1 文件，两夹具与其更正前字节一致）：

| 文件 | blob | 内容 SHA-256 | 规模 |
|---|---|---|---|
| `tests/unit/web-text-intake-recovery.test.mjs`（更正版） | `8c641b1178b54ccd…978bd` | `3ab536c9…0746b86` | 817 行／42909 B |
| `tests/fixtures/web-text-intake/recovery-instance.mjs` | `5fe68cb4651c017f…b714` | `256001ac…b1339065` | 82 行／3868 B |
| `tests/fixtures/web-text-intake/recovery-stub-worker.mjs` | `6d638db05e588bfd…a007` | `8e76c570…d58c484` | 81 行／2984 B |

已审状态：更正字节 `3ab536c9…` 在后续各轮独审中按「原样覆盖运行、跑后还原」反复使用（本分支 [web-text-intake-fr82-routing-startup-20261109-opencode-review.md](web-text-intake-fr82-routing-startup-20261109-opencode-review.md)、[web-text-intake-d1-events-20261109-opencode-review.md](web-text-intake-d1-events-20261109-opencode-review.md)——后者在 D1 批 HEAD `7613843` 两轮 **11/11**＋基线 `ef50461` 10/11 恰 D1 红，并补齐了作者证据包缺失的基线 TAP）；协调评论 `01a1bef5` 明确「`82e1bf2` recovery」按已审接收、基线缺件由该独审重放补齐、不再派重复补件。登记对象＝**更正后的测试字节＋同树两夹具**；D1 批生产面（`ef50461..7613843`）已按 `cce6cfb` 独审限定接收。

**C. 任务事件补偿／SSE 回归——Kimi II `727c6fb`**（完整 `727c6fb50b2f915455a981e6e2a9d53466e0d35f`，tree `70b77cda65fae8607fc9622d9ba91ffe657113a6`，父 `599d1cf`，恰 1 新文件）：

| 文件 | blob | 内容 SHA-256 | 规模 |
|---|---|---|---|
| `tests/unit/web-text-intake-events.test.mjs` | `67f52618e3232af9…703e4` | `937989b2…2d65506` | 513 行／24934 B |

已审状态：OpenCode 独审**通过（作为本批回归接收）**——真实存储二进制＋生产服务层，HEAD 两轮 11/11、基线 5/11 六个失败面与五个修复点一一对应（本分支 [web-text-intake-d1-events-20261109-opencode-review.md](web-text-intake-d1-events-20261109-opencode-review.md)，提交 `cce6cfb`）；协调评论 `01a1bef5` 按该独审限定接收。

## 3. 实施内容与实际核查

改动恰一行（`git diff cce6cfb -- package.json` 仅 `test:web-text-intake` 值，单空格缩进原样保留）：

```
 "test:web-text-intake": "node --test --test-timeout=20000 tests/unit/web-text-intake.test.mjs tests/unit/web-text-intake-lifecycle.test.mjs tests/unit/web-text-intake-mcp-pairing.test.mjs tests/unit/web-text-intake-recovery.test.mjs tests/unit/web-text-intake-events.test.mjs tests/integration/web-text-intake-{http,queue,controlled-model,static}.test.mjs"
```

（实际值为展开的九个路径；上行为缩写排版。顺序：两个 I 单元在前，**三个新单元紧随 lifecycle 之后、按派工点名顺序 MCP 配对→recovery→events**，四个 II integration 保持原顺序在后——原六文件相对顺序不变。）

核查（日志 `verification-commands.log`，全 exit 0）：

| 核查 | 结果 |
|---|---|
| `package.json` JSON 解析 | exit 0；scripts **107 个**，名称与顺序和 `cce6cfb` 完全一致 |
| 聚合值分解 | 前缀 `node --test --test-timeout=20000` 原样；恰 9 文件；原 6 文件全部在场且相对顺序不变；恰 3 个新文件插在 lifecycle（第 2 位）之后 |
| 与 `cce6cfb` 全量对比 | check 链 52 段且逐字节相同（`test:web-text-intake` 在链尾引用 1 次不变）；107 个脚本名集合与顺序相同；dependencies／devDependencies 相同；唯一值变化＝`test:web-text-intake` |
| 被登记 8 个文件只读复核 | 对象库提取副本逐一复算 blob／SHA-256（§2 表）；7 个 `.mjs` `node --check` 全部 exit 0（jsonl 不适用）；无占位文件落盘 |

## 4. 前置构造边界（如实分列，不代签）

- **本树九个聚合文件全部不存在**（原 I 两单测＋三套新登记＋四套 II）：本树是 III 工程／集成树，候选 I／II 未接入（与前次登记同一状态）。在本树运行 `npm run test:web-text-intake` 会在文件加载处如实失败——本轮不执行该脚本、不造占位、不代签、不整树合入任何候选分支。
- **接入方式边界**：集成时三套文件必须从本登记锁定的提交**按精确字节落盘**（blob id 即内容寻址，`git show <commit>:<path>` 提取后复算）；不得按记忆重写、不得取其它版本。夹具随套件同源落盘：recovery 套件以**路径**加载两夹具（`recovery-instance.mjs`／`recovery-stub-worker.mjs` 由测试内 `join(repositoryRoot, …)` spawn），路径与字节缺一不可；MCP 配对测试 import 其两夹具模块；events 套件无夹具（9 个 `server/lib` 模块导入在集成生产树上闭合）。
- **各套件的已验证生产基线（登记事实，不外推）**：MCP 配对——`59b405f` 生产修复树上 11/11（OpenCode 独审实跑）、`31434282` 上 4/7 可证伪形态（ZCode 独审）；recovery 更正字节——`7613843` 两轮 11/11、基线 `ef50461` 10/11（`cce6cfb` 重放）；events——`7613843` 两轮 11/11、基线 5/11（`cce6cfb`）。这些数字属于对应独审记录；本登记不重跑、不复制其结论为「聚合通过」。
- **未跑**：`test:web-text-intake`、任何套件执行、完整 `npm run check`（唯一集成执行者在候选齐备版本串行执行）、cargo、typecheck。本轮核查面＝JSON／脚本值／命令清单／被登记文件身份与语法。
- **不改变任何未决结论**：M-5 未闭、A4／身份完整性／MCP 生产面／未批 D 均按各记录保持开放；聚合补登记不构成业务准出，MAYNE-24 保持 `in_progress`。

## 5. 结论

**窄追加登记交付**：聚合脚本在 lifecycle 后按派工顺序登记三套已审回归的精确候选字节（`a02af9e` 四文件、`82e1bf2` 三文件、`727c6fb` 一文件），脚本名集合、20000ms 预算、52 步 check 链、依赖与锁逐字节不变；test-safety 按派工排除；前置构造边界（字节落盘、夹具路径、已验证生产基线）如实登记。交由队长另派未参与者独审本登记；集成级验证与完整门禁不变，由唯一集成执行者在候选齐备版本串行执行。MAYNE-24 保持 `in_progress`，未改状态。
