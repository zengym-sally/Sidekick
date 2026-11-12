# W1 文本整理 III：test:web-text-intake 聚合补登记 lifecycle 回归（2026-11-09）

> MAYNE-24 派发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 内协调评论 `01a1bcfd-0d1d-773f-a93b-9584fb5eeaf7`（Codex，2026-11-09）：「`ff287ab` 的 test:web-text-intake 聚合仍只列原 I 单测，须显式补入 `tests/unit/web-text-intake-lifecycle.test.mjs`，保留脚本名、52 步链及 20000ms 预算，其余 I/II 文件不改」。这是对[工程候选](web-text-intake-engineering-20261108.md)交付的聚合脚本的**窄追加登记**，不是新候选轮；风险级：低（单行脚本值＋一条索引登记，全部核查聚焦）。

## 1. 范围与写入边界

唯一写入（`build/web-text-intake-engineering/lifecycle-aggregate/admission-lifecycle.json` 在首次修改前登记）：`package.json`（仅 `test:web-text-intake` 的值）、本记录、`docs/reviews/README.md`（索引 126→127）。证据在 `build/web-text-intake-engineering/lifecycle-aggregate/`（gitignored）。

未触碰：候选 I/II 全部文件（server/、src-tauri/、src/、tests/ 的任何内容——包括被登记的 lifecycle 文件本身，本树不落盘）、`scripts/checks/`、`scripts/build/`、锁文件与依赖。`docs/engineering/verification.md`、`docs/product/05`、architecture、docs/README 无需改动：其中对聚合的既有表述（「候选 I 单元＋候选 II 四套 integration——http/queue/controlled-model/static，沿用 20000ms 用例预算」「聚合脚本（20000ms 预算）接入 check 链尾」）在追加第二个 I 单元文件后仍然逐字为真，按外科改动原则不改。

## 2. 登记对象的身份（只读接收，零字节复制）

被登记文件 `tests/unit/web-text-intake-lifecycle.test.mjs` 当前只存在于候选 I 分支 `agent/claude/mayne-24` 的第六轮提交：

| 项 | 值 |
|---|---|
| 来源提交 | `e8405339eb72ca9586889a29411b8b7e6f8c545a`（父 `e84fab6`，tree `80dbd77c6058…3ccf`——与协调评论登记一致） |
| git blob | `048a3c6125a6d5b94db96e1f8b1436fd412839d4` |
| 内容 SHA-256 | `254fca3f944c14c6a2eb9cca746825219f3e9cfda824048c88eeaaa231a80830` |
| 规模 | 267 行，4 个顶层用例（暂存窗存活/confirmExit 缺句柄与缺记录/verifyTree 未枚举或存活成员集/回执事实——unattributed、重复幂等、错身份不落库） |
| 语法 | `node --check` exit 0（只读 extract 复核后已删） |
| 依赖闭合 | 其 7 个 `server/lib/*.mjs` 导入在 `e840533` 树内全部在场（blob 逐一列出见日志） |

候选 I 自身未改 `package.json`（`e840533` 的 diff 恰 5 文件，无 package.json；其树内聚合不含 lifecycle 文件）——聚合属 III 权责，缺口与协调评论定位一致。

## 3. 实施内容与实际核查

改动恰一行（`git diff ff287ab -- package.json` 仅 `test:web-text-intake` 值，单空格缩进原样保留）：

```
 "test:web-text-intake": "node --test --test-timeout=20000 tests/unit/web-text-intake.test.mjs tests/unit/web-text-intake-lifecycle.test.mjs tests/integration/web-text-intake-{http,queue,controlled-model,static}.test.mjs"
```

（实际值为展开的六个路径；上行为缩写排版。顺序：两个 I 单元在前、四个 II integration 保持原顺序在后。）

核查（日志 `verification-commands.log`，全 exit 0）：

| 核查 | 结果 |
|---|---|
| `package.json` JSON 解析 | exit 0；107 个 scripts |
| 聚合值分解 | `--test-timeout=20000` 保留；恰 6 文件，lifecycle 位于第 2 位（原 I 单测之后、四个 integration 之前） |
| 与 `ff287ab` 全量对比 | check 链 52 段且逐字节相同；107 个脚本名集合与顺序相同；依赖/devDependencies 相同；唯一值变化＝`test:web-text-intake` |
| 被登记文件只读复核 | `node --check` exit 0；blob/SHA-256 如 §2 |

## 4. 前置缺口（如实分列，不代签）

- **本树六个聚合文件全部不存在**（原 I 单测＋lifecycle＋四套 II）：本树是 III 工程/集成树，候选 I/II 未接入（与 `ff287ab` 记录 §5 同一状态）。在本树运行 `npm run test:web-text-intake` 会在文件加载处如实失败——本轮不执行该脚本、不造占位、不代签。
- **lifecycle 文件的业务有效性未验**：本登记只证明「路径已入聚合＋候选源文件语法有效、依赖闭合」。四个用例的运行结果、以及协调评论对候选 I 提出的 mcp call_begin/call_response 分支缺口（e840 帧提取目前仅 progress/worker）是否被其覆盖，属候选 I 后继增量与独审范围，本记录不签。
- **未跑**：`test:web-text-intake`、任何套件执行、完整 `npm run check`（唯一集成执行者在候选齐备版本串行执行）、cargo、typecheck。本轮核查面＝JSON/脚本值/命令清单/被登记文件语法与身份。
- 候选 I 仍是累计复核的**部分候选**（R6 维持不通过、M-1/M-2/M-3/M-4 等缺口未闭）；聚合补登记不改变任何未决结论，M-5 未闭、无业务准出。

## 5. 结论

**窄追加登记交付**：聚合脚本显式纳入候选 I 的 lifecycle 回归文件，脚本名/预算/52 步链/其余全部脚本逐字节不变；被登记对象身份（提交/blob/SHA/语法/依赖闭合）以候选 I `e840533` 为据只读核验；前置缺口如实保留。交由队长另派未参与者独审本候选；集成级验证与完整门禁不变，由唯一集成执行者在候选齐备版本串行执行。MAYNE-24 保持 in_progress，未改状态。
