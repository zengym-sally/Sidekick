# W0 集成候选独立评审（ZCode，2026-11-07）

> 结论先行：**候选质量：通过**。精确候选 `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3` 的集成补丁 sha256 与登记值逐字节一致，四项审定交付接收核对全部零差异，占槽/退出核实/恢复决议语义与已接受的 attemptExitState 契约一致，四项要求的动态场景由评审者在候选检出上**独立复现**，聚焦门禁全部独立复现 exit 0。**W0 准出：未闭合**（保持开放）：完整 `npm run check` 绿证仍未取得；完整门禁超时的负载归因假设被本次独立复跑**削弱**（未复现作者测得的时长量级）；原始 build 证据（门禁日志、ui-repro、授权包 JSON）因 OpenCode 平台树已不存在而**无法只读核对**；授权包中 Git 两项具体可批、schema 项尚不具备可批细节。本评审不关闭阶段、不推进 W1，完整门禁仍由唯一集成执行者串行补齐。

- 评审者：ZCode，未参与本轮集成实现。发起：Codex（评论 `01a1b5b0-728c-7d71-98a4-d37764b725e2`）。
- 评审方式：实现文件只读；受控验证在 ZCode 本次平台隔离树（`agent/zcode/mayne-22`，其基线 `d705fc5` 与集成基座 `9ad2d61`、OpenCode 起点 `eb431cb` 三者 tree 均为 `08694173bc7a912b316ec7fc08f5dd0f93a0eed4`，逐字节同树）；候选经 `git archive` 提取到 `build/mayne22-review/candidate/` 验证，未修改任何实现文件。
- 本记录只写本项允许路径；索引登记（[docs/reviews/README.md](README.md)）不在评审者写入清单，留给队长/集成执行者。

## 1. 版本与补丁哈希核对（全部一致）

| 项 | 登记值 | 评审实测 | 结果 |
|---|---|---|---|
| 集成提交 | `8bd29c4`（tree `c6f20de7…`，父 `eb431cb`） | `git log` 实测一致；提交信息与交付声明相符 | ✓ |
| 集成补丁 sha256 | `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e` | `git diff eb431cb 8bd29c4 \| shasum -a 256` 逐字节一致 | ✓ |
| 基座祖先 | `9ad2d61` 为父提交祖先 | `git merge-base --is-ancestor` exit 0；且 `eb431cb`/`9ad2d61`/`d705fc5` tree 相同 | ✓ |
| 改动范围 | 7 文件、全部在登记写入清单内 | `git diff --stat`：7 文件，无清单外文件；package.json/锁文件/AGENTS/生产 src/、schema/migrations/vendor 零改动 | ✓ |
| 记录 §7 冻结哈希 | 6 文件哈希 + 1 补丁哈希 | 7/7 逐项复算一致（含「除记录与索引外」补丁 `ef701f52…` 复现） | ✓ |

## 2. 四项接收核对（独立验证，全部零差异）

- **MAYNE-18**：三文件（`scripts/checks/check-structure.mjs`、`docs/engineering/architecture.md`、`docs/reviews/runtime-metadata-20261106.md`）与审定候选 `3427560b` 逐字节一致（路径级 `git diff 3427560b 8bd29c4 -- <三文件>` 为空）；`check-structure.mjs`、`architecture.md` 哈希与 MAYNE-18 记录 §7 冻结值一致；未顺带扩任何守卫白名单。
- **MAYNE-19**：契约与既有 fixtures 相对 `9d094d3` 零差异（`docs/engineering/web-api-contract.md`、`tests/fixtures/web-contract/`），字段/端点未动。
- **MAYNE-20**：探针全部路径相对 `5cd3538` 零差异；评审者在候选检出独立复跑探针 **68/68 exit 0**（含离线 cargo 构建 probe 二进制）。
- **MAYNE-21**：五个未涉改路径（`design/README.md`、`design/index.html`、`design/web-task-flow/index.html`、`task-flow.css`、`docs/reviews/web-task-interaction-20261106.md`）相对 `7b3ef31` 零差异；`task-flow.js`/`web-task-interaction.md` 按裁定做占槽/退出核实语义修订（本次评审重点，见 §3）；`docs/reviews/README.md` 仅补 25 条已收口交付与本项的索引登记，既有条目未删改，符合登记范围。

## 3. 契约一致性（通过）

裁定口径：槽位跟随 attempt 的进程退出确认，不跟随业务状态。逐条对照已接受的[契约](../engineering/web-api-contract.md) §3.2/§3.4/§3.5：

| 契约要求 | 候选实现（`task-flow.js` + `web-task-interaction.md` 修订） | 结果 |
|---|---|---|
| 占槽集合 = `active/exiting/exited_unknown`；`exited_confirmed/not_started` 释放（§3.2 槽位核算） | `occupiesSlot()` 恰按该集合；`counts()`/`nextFreeSlot()`/`dispatchQueued()`/提交与重提闸门全部走该判定 | ✓ |
| `needs_review` 且 `exited_unknown` 仍占槽，调度不补发（场景 19） | 取消转待核对**不再清槽**（原 `task.slot = undefined` 已移除），徽标/行 aria 保留「槽 n/3」；`nextFreeSlot` 视其为占用 | ✓ |
| `resolve` 在 `exited_unknown` 下一律拒绝，409 `exit_unconfirmed`（§3.5） | `reviewChoice` 在任何选项生效前闸门拦截并说明原因，选择不落盘 | ✓ |
| 用户核对决议 ≠ 进程退出确认；仅恢复扫描核实释放（§3.4） | 「演示：扫描核实退出」明确标注为演示驱动入口、模拟新实例恢复扫描，[交互文档 §14](../engineering/web-task-interaction.md) 写明不代签真实 worker；核实前决议不受理 | ✓ |
| 核实后按真实取消意图与暂存结果分支（§3.4 取消路径） | 核实后释放槽、迁移为「副作用未知待核对」并受理决议；文案与两分支（台账证明无副作用→cancelled；否则补决议）一致 | ✓ |
| 槽号分配取第一个未被占槽 attempt 占用的空闲槽，不用「占槽数+1」（§3.2/设计 §5） | `nextFreeSlot()` + `dispatchQueued()` FIFO；动态复现领取被释放的槽 2（见 §4） | ✓ |
| 恢复放行前普通调度暂停；提交/重提拒绝（契约 §3.4/§5） | `submitTask`/`resubmit`/`dispatchQueued` 三处均受 `recovery.active` 闸门 | ✓ |
| `resultPendingExit` 期间占槽 | 交互文档 §3.1 已写明；原型未建模该演示态（可接受，文档为权威口径） | ✓（文档层） |
| 不新增生产 API 字段 | 契约文件零改动；`exit` 仅为演示合成数据字段，交付与文档均注明演示边界 | ✓ |

另：原审定版「占槽保留到 `cancelling` 为止，转 `needs_review` 槽即释放」的**错误边界已在交互文档 §6 正确拆除**，改为按退出核实结果分流（退出已核实+副作用未知→释放槽；退出未核实→继续占槽），与契约场景 9/19 一致；`web-backend-design.md` §5 零改动且本就与契约一致。

## 4. 动态证据：评审者独立复现（通过）

作者的 `ui-repro-20261107.md` 与门禁日志属 build/ 原始证据，其平台树已不存在、无法只读核对（见 §7）；随交付的两张截图核对为真实页面。评审者在候选检出以浏览器驱动**独立复现全部四项要求场景**，页面直读值完整记录于 `build/mayne22-review/zcode-repro-20261107.md`，截图 `build/mayne22-review/zcode-repro-fifo-slot2.png`：

1. 取消→退出未核实：T-2011 转「待核对 · 槽 2/3」仍占槽，figures 1/1/1/3，aria「槽位跟随 attempt 退出确认，未核实不释放」——与作者截图 1 逐项一致。
2. 新任务领不到被占槽：T-2027 入队第 4 位，排队 4，槽 2 未被领取。
3. 决议闸门：`exited_unknown` 下选「标记失败」被拒，选择保持未记录，文案说明闸门原因。
4. 核实释放 + FIFO：扫描核实后 T-2011 释放槽 2，队列最前 T-2013 **领取槽 2**（非槽 1/3，非占槽数+1）——与作者截图 2 逐项一致；核实后决议受理、恢复不放回暂停。
5. 恢复期提交/重提均拒（同文案）。焦点保持与窄屏路径：`task-flow.css` 与 `render()` 焦点恢复逻辑相对审定基线零改动，本轮修订不触及，按零改动认定不回归（未独立重测，如实注明）。

## 5. 聚焦门禁：独立复现（全部 exit 0）

在候选检出（补齐仓库既有构建前置 `npm run probe:prepare-pi`，vendor/pi tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68` 与登记值一致；未新增任何依赖）：

| 命令 | 评审实测 | 交付声明 | 结果 |
|---|---|---|---|
| `node --check scripts/checks/check-structure.mjs` | exit 0 | exit 0 | ✓ |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0（22 违规类 + 8 引用违规全检出） | exit 0（同） | ✓ |
| `node scripts/checks/check-structure.mjs` | exit 0，**215 源文件 / 466 相对引用** | exit 0（215/466） | ✓ |
| `node scripts/checks/check-docs.mjs` | exit 0，20 文件 / **408 链接** | exit 0 | ✓（见 §8 NIT-1） |
| `node --check design/web-task-flow/task-flow.js` | exit 0 | exit 0 | ✓ |
| `node tests/probes/backend-foundation/run-probes.mjs` | exit 0，**68/68 场景** | 68/68 | ✓ |

前置前状态亦复现：未跑 prepare-pi 时守卫报 3×`ref.missing`（同记录所述三个 s32 测试文件的构建前置引用），与交付声明的环境描述一致。

## 6. 完整门禁超时归因：证据部分成立，量级未获独立支持

- **机制核查（成立）**：`test:s32-domain` 的 20s 为 package.json 固定 `--test-timeout=20000`（无授权不得改）；失败用例 `tests/unit/s32-skills.test.mjs`「valid long-path packages…」确为负载敏感（7 段长路径 + 3000 文件创建/扫描/冻结/恢复）；该测试与本轮 7 文件改动无引用/数据交集（守卫引用扫描佐证）；vendor/pi 来源 tree 与登记一致。
- **独立复跑（削弱归因量级）**：评审者在同一台机器、load avg 6.3–8.4（与作者报告的 5.8–14.3 区间重叠）复跑该用例：**8.6–9.8 秒完成**，60s 与 20s 预算下均 pass（多次复跑一致）；整文件 23/23 在 20s 预算下 pass（exit 0）。作者的隔离复跑「22.1–28.9s」与门禁内「20.4–21.0s 超时」**均未复现**——同机器、相近负载区间下时长相差约 2.5–3 倍。
- **评审判断**：作者如实报告了当时观察（R1b/R2/R3 日志、逐轮数值），未虚构通过，这一点可信；但「纯负载、接近预算」的归因假设在本次独立复跑中**不成立或不稳定**——该用例在当前负载下距 20s 预算有约 2 倍余量。可能解释：作者时段瞬时争用远高于 load 均值显示（IDEA/游戏持续高 CPU、热限频）或文件缓存状态差异；无法在现证下进一步区分。
- **处置（与登记一致，不因本评审改变）**：完整门禁绿证未取得，W0 准出不关闭；由唯一集成执行者按队长安排的时机串行复跑完整 `npm run check`。若空闲复跑仍稳定超时，按记录 §5 已写明的路径交 stage 2 处理（既有性能预算问题，与本轮改动无关）。评审者不重跑完整门禁（评审指令禁止）。

## 7. 缺失证据清单（如实列出）

1. **build/ 原始证据不可只读核对**：OpenCode 本轮平台隔离树 `mayne-22-431fe381e18a` 在本机已不存在；`build/web-foundation-integration/` 下的 `full-check-r1/r1b/r2/r3.log`、`ui-repro-20261107.md`、`authorization-package.json` 原文件均无树可核。可核的替代物：议题附件（集成补丁、admission.json、delivery-summary.json、两张截图）与本记录 §1–§5 的独立复现——核心声明（哈希、零差异、聚焦门禁、动态场景）均已由评审者独立重建，故不阻塞候选结论；但完整门禁超时的**原始日志**与授权包**原文件**仍需执行者在下次交付随附（补存档或重跑时重新生成）。
2. 场景 1/2（恢复期拒绝、决议闸门）无随附截图——已由本评审 §4 独立复现补足，不再阻塞。
3. 焦点/窄屏回归为「零改动路径推定」，未独立重测（如实登记，风险低：CSS 与焦点逻辑零 diff）。

## 8. 问题清单（均不阻塞候选结论）

- **NIT-1（证据数字不一致）**：集成记录 §5 表第 4 行写「20 文件/383 本地链接」，实测集成树为 **408**（delivery-summary.json 正确写 408；383 是基座 main 的旧值）。数字更正不改变 exit 0 结论。
- **NIT-2（演示种子数据）**：终态任务 T-2001/T-1998 与三个 queued 种子任务缺 `exit` 字段（其余任务显式 `exited_confirmed`/`not_started`）。占槽判定不受影响（`occupiesSlot` 对 undefined 返回 false），纯演示数据一致性瑕疵。
- **NIT-3（文案措辞差）**：交互文档 §12 闸门文案「请先等恢复扫描核实旧进程已退出」，演示 toast 为「请先执行「演示：扫描核实退出」」——语义一致，措辞不同（演示需指向自身入口，可接受；建议后续统一）。
- **环境观察（非候选缺陷）**：MAYNE-18 审定补丁的平台元数据白名单仅 `.multica/`、`.opencode/`。评审者所在 ZCode 平台树存在 `.zcode/`（172 个文件），在该树跑守卫会报 `top.dir`——本轮完整门禁按登记在集成执行者树补跑不受影响；若未来需在 ZCode/其他平台树跑完整门禁，须按授权流程另立门禁补丁扩白名单，不得顺带改（本轮未扩是正确行为）。实测记录：`build/mayne22-review/zcode-verify-zcode-tree-topdir.log`。
- **P3 ×4**：维持作者登记（MAYNE-20 ×1、MAYNE-21 ×2、文档/CSS 口径差 ×1），不因本评审扩大修复范围。

## 9. 授权包评估（按记录 §6 摘要；原 JSON 文件缺失，见 §7）

| 项 | 内容评估 | 可批性 |
|---|---|---|
| AUTH-GIT-1 | 本地 main `9ad2d61`→`8bd29c4` fast-forward（无内容变化） | 动作与目标具体、可批；**但建议把触发条件从「ZCode 评审通过后」收紧为「完整门禁绿证补齐后」**——按本项准出约定，main 不应停在未过完整门禁的提交上 |
| AUTH-GIT-2 | push 远端（可选） | 具体、可批、可选 |
| AUTH-DEP-1 | W1 HTTP 组装首选 Node 内置 `node:http`（零新增依赖）；框架备选需逐包授权 | 决策建议而非待批动作；零依赖路径无需授权，备选路径的逐包授权留待具体清单——表达清晰 |
| AUTH-SCHEMA-1 | W1 队列持久化以追加式新迁移（005_*）实现，001–004 字节不动，届时附逐表 DDL 与回滚说明 | **尚不可批**：DDL/表清单/回滚说明缺失（作者也明示届时附）；届时须逐表列明后再请批 |

package.json/锁文件/AGENTS/生产 src/、schema/migrations 本轮零改动，与「未实施任何受限动作」声明一致（§1 改动范围核对佐证）。

## 10. 结论与边界

- **候选质量：通过。** 集成补丁哈希、四项接收零差异、契约一致性、动态场景、聚焦门禁五类声明全部经评审者独立复现成立；发现 3 项 NIT 与 1 项环境观察，均不阻塞。
- **W0 准出：未闭合（保持开放）。** 开放项：① 完整 `npm run check` 绿证（唯一集成执行者串行补跑；本评审复跑削弱了超时归因量级，空闲复跑是唯一收口路径）；② AUTH-GIT-1/2、AUTH-DEP-1、AUTH-SCHEMA-1 均未获 owner 批准（AUTH-SCHEMA-1 现阶段不可批）；③ build/ 原始证据存档缺失，需下次交付随附或重新生成；④ 本评审不等于阶段关闭——契约冻结、W1 晋级、MAYNE-23 晋级由 Codex 依据本结论与后续完整门禁结果决定。
- 本项保持 `in_progress`；本记录不签 done、不推进 W1。评审证据：`build/mayne22-review/`（gitignored；含独立复现脚本/直读值 `zcode-repro-20261107.md`、截图 `zcode-repro-fifo-slot2.png`、聚焦门禁日志 `zcode-verify-*.log`、附件核对副本 `attachments/`）。
