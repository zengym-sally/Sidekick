# W0 集成：契约统一、门禁接入与依赖/schema 授权包（MAYNE-22，2026-11-07）

> 结论先行：MAYNE-18/19/20/21 四项审定交付在本隔离集成树完成接入核对；MAYNE-18 审定补丁按**逐字节一致**补入三文件；任务面板占槽/退出核实语义按已接受的 attemptExitState 契约统一并完成浏览器动态复现（四场景全过、焦点/窄屏不回归）；聚焦门禁全部 exit 0（结构、文档、语法、68/68 探针）。**完整 `npm run check` 未获绿证**：多轮尝试在同一既有测试（s32 长路径，20s 预算）因机器高负载超时失败——该测试与本轮改动无交集，按登记如实保持开放，W0 准出与 W1 晋级不因此关闭或推进。依赖/schema/Git 授权包已形成待 owner 审定，未实施任何受限动作。

## 1. 范围、基点与唯一集成树

- 执行者：OpenCode；独立评审者：ZCode（未参与本轮集成实现）。本轮按任务「本轮执行登记（2026-11-07）」执行，契约裁定与阶段晋级归 Codex。
- 唯一集成树（修改前已登记 `build/web-foundation-integration/admission.json`）：
  - `pwd` = `…/ming-space-bc02289231eb/mayne-22-431fe381e18a/worktree`
  - branch `agent/opencode/mayne-22`；起点 commit `eb431cb`（平台基线提交，树 `08694173bc7a912b316ec7fc08f5dd0f93a0eed4`，与集成基座 `9ad2d61` 逐字节一致：`git diff eb431cb 9ad2d61` 为空）
  - 祖先核对 exit 0：`9ad2d61`（集成基座）、`85feb8a`（原始基线）、`2e580aa`（快进前 main）均为 HEAD 祖先
  - 未跳回历史工作树，未改共享 main（实际 main `9ad2d61` 未移动）与其他任何树
- 风险级：R2/R3（机械守卫接收、交互语义对齐为 MAYNE-21 语义修订需独立重评；无 schema/依赖/凭据改动）。按[验证约定](../engineering/verification.md)需独立评审。

## 2. 四项接收核对（基座既有内容）

| 项 | 审定候选 | 本轮核对 | 结果 |
|---|---|---|---|
| MAYNE-18 | `3427560b`；完整补丁 sha256 `8fc1ed91…` | 本轮接入（见 §3） | 三文件与候选逐字节一致 |
| MAYNE-19 | `9d094d3`（第九轮 APPROVE）；补丁 sha256 `50b7777f…` | `git diff 2e580aa HEAD` 于其已接受范围（契约+fixture）为空；契约字段/端点未改动 | 完整保留 |
| MAYNE-20 | `5cd3538`（tree `7bf8d40b`，ZCode R3 APPROVE）；范围补丁 sha256 `8cffdd13…` | 十二个审定路径与 `5cd3538` 逐字节一致（沿用上轮收口核对，基座未动）；探针 68/68 复跑通过（§5） | 完整保留 |
| MAYNE-21 | `7b3ef31`（ZCode 第五轮 APPROVE）；范围补丁 sha256 `46a79654…` | 八个审定路径逐字节保留；其中 `task-flow.js`/`web-task-interaction.md` 按裁定做了占槽/退出核实语义修订（§4，**需独立重评**） | 保留 + 登记语义修订 |

## 3. MAYNE-18 门禁补丁接入（逐字节）

当前基座相对 `85feb8a` 在三个审定文件上无其他演化，故直接取候选版本落盘，得到**与审定补丁逐字节一致**的接入：

- `git diff HEAD -- <三文件> | shasum -a 256` = `8fc1ed91dc31941eb70eee4326a1eceaf4764bca94036f12c982058095cf8aba`，与登记的审定候选完整补丁哈希一致
- 落盘文件与 `3427560b` 逐字节一致（`git diff 3427560b -- <三文件>` 为空）；`check-structure.mjs` sha256 `22a80a4d…`、`architecture.md` sha256 `b74424cf…` 与 MAYNE-18 记录 §7 冻结哈希逐项一致
- 接入后实测：真实 `.multica/`+`.opencode/` 在场时 `node scripts/checks/check-structure.mjs` **exit 0**（215 源文件、466 相对引用）——修前该环境为 4×`top.dir`（`.playwright-mcp/` 演示工具残档，已清理）与 3×`ref.missing`（构建前置，`probe:prepare-pi` 后消除）；`--self-test` exit 0（22 违规类 + 8 逐条引用违规全检出）
- 未顺带扩任何守卫白名单；`docs/reviews/runtime-metadata-20261106.md` 随审定补丁原样入库，其 §9 交接的索引行已由本轮补登

## 4. 占槽/退出核实语义统一（按 MAYNE-19 attemptExitState 契约）

裁定口径：槽位跟随 attempt 的进程退出确认，不跟随业务状态——`active`/`exiting`/`exited_unknown` 各占一槽，`exited_confirmed`/`not_started` 释放；`needs_review` 且 `exited_unknown` 仍占槽、调度不补发；用户核对决议不等于进程退出确认（`resolve` → 409 `exUnconfirmed` 语义，文中按契约写 `exit_unconfirmed`）；仅新实例恢复扫描核实旧进程树退出后释放。

### 4.1 修订内容与理由

MAYNE-21 审定版按当时基线把占槽集合定义为「`running`+`cancelling`，转 `needs_review` 即释放」，其后又九轮评审的 API 契约演进出 `attemptExitState` 口径，两者冲突（上轮收口已登记为语义观察，本轮获裁定统一）。修订（只动占槽/退出核实与对应文案）：

- `design/web-task-flow/task-flow.js`：占槽集合改按 `attemptExitState ∈ {active, exiting, exited_unknown}`（演示字段 `exit`，非生产 API 字段）；`needs_review` 且退出未知保留「槽 n/3」徽标与行 aria；槽号分配取「第一个未被占槽 attempt 占用的空闲槽」；满槽文案列出三类占槽构成；取消转待核对**不再清槽**，note/事件说明闸门；新增「演示：扫描核实退出」动作（模拟 §3.4 恢复扫描核实：核实后释放槽、迁移为副作用未知待核对并受理决议）；决议闸门——退出未知时四项选择一律不受理并说明原因；恢复放行与槽位释放后按 FIFO 领取正确空闲槽（契约 §3.2 调度语义）
- `docs/engineering/web-task-interaction.md`：§2/§3.1/§3.2/§3.3/§6/§7.2/§11/§14 同步上述口径；撤销原文「转 `needs_review` 槽即释放」的错误边界；新增退出未核实的四条交互文案；演示边界写明扫描按钮是演示驱动入口、不代签真实 worker
- 未新增生产 API 字段/端点；`web-backend-design.md` §5 与契约本就一致（「未确认退出不释放槽」「无法核实则暂停调度」），零改动；`task-flow.css`/`index.html` 零改动

### 4.2 动态复现（实际观察值）

完整步骤与页面直读数值见 `build/web-foundation-integration/ui-repro-20261107.md`（截图两张随交付）。要点：

1. 取消→退出未知：T-2011 转「待核对 · 槽 2/3」（槽号保留），figures=`1运行中/1取消中/1退出未核实/3排队中`；新提交 T-2027 只入队（第 4 位），**领不到槽 2**
2. 决议闸门：退出未知时选「标记失败」被拒——「进程退出未核实，这项仍占执行槽，核对决议暂不受理」，选择保持未记录
3. 释放与领取：扫描核实后 T-2011 转无槽待核对，队列最前 T-2013 **领取槽 2**（非「占槽数+1」）；第二数据点：槽 3 释放后因恢复闸门未放行而不调度，恢复放行瞬间 T-2013 领取当时唯一空闲槽 3
4. 恢复闸门：恢复期提交/重提均拒（同一文案）；焦点路径（取消重绘、退出未知重绘、Enter 开详情/Esc 回触发行）不回归；窄屏 390×844 figures/徽标/按钮换行同审定基线（css 零改动）
5. 演示服务验证后已停止（127.0.0.1:4173 connection refused），无遗留进程；`.playwright-mcp/` 演示残档已清理

## 5. 验证证据（实际命令与退出码）

前置（仓库既有命令，非新增依赖）：`npm ci --ignore-scripts`（107 包）；`npm run probe:prepare-pi`（vendor/pi 固定源 commit `ad702637`、tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`，与既定一致）；`npm run probe:prepare-cli`（lark-cli v1.0.98）。

| # | 命令 | 退出码 | 说明 |
|---|---|---|---|
| 1 | `node --check scripts/checks/check-structure.mjs` | 0 | 守卫语法 |
| 2 | `node scripts/checks/check-structure.mjs --self-test` | 0 | 22 违规类+8 引用违规全检出 |
| 3 | `node scripts/checks/check-structure.mjs`（真实平台元数据在场） | 0 | 215 文件/466 引用 |
| 4 | `npm run check:docs` | 0 | 20 文件/383 本地链接（含本轮新增记录与索引） |
| 5 | `node --check design/web-task-flow/task-flow.js` | 0 | 原型语法 |
| 6 | `node tests/probes/backend-foundation/run-probes.mjs` | 0 | **68/68 场景**（MAYNE-20 交付在集成树复跑） |
| 7 | `npm run check`（R1，`build/…/full-check-r1.log`） | **1** | 首轮败于 `.playwright-mcp/` 演示残档触发 `top.dir`（守卫按设计拒绝，残档已清理；非集成内容） |
| 8 | `npm run check`（R1b／R1c／R2／R3，`full-check-r1b.log`、`full-check-r2.log`、`full-check-r3.log`） | **1** | 清理后四轮均在 `test:s32-domain` 的长路径用例超时（20.4–21.0s > 20s 预算），负载全程 5.8→14.3 |
| 9 | 负载取证与隔离复跑 | — | 失败同时段 load avg 5.8–12.5（峰值进程为所有者应用：IDEA 176%、游戏 146%）；该用例以 60s 预算单独复跑 **pass 1 / fail 0**，实测耗时 22.1–28.9s（随 load 10→12.5 变长）——功能正常，纯粹超出固定 20s 预算；MAYNE-18 记录 §5 已有同类「负载相关既有抖动」归因先例 |

**R1b 归因与开放声明**：失败测试（`tests/unit/s32-skills.test.mjs:31`「valid long-path packages…」）创建 3000 个长路径文件并扫描/冻结/恢复，纯文件系统负载敏感；本轮五文件改动与其无任何引用或数据交集（守卫引用扫描确认）。不改 package.json（无权改超时预算），故按登记如实开放：**完整门禁绿证未取得，W0 准出条件不关闭；不推进 W1**。机器空闲时的复跑由 owner/队长决定时机；若复现稳定超时则属既有性能预算问题，交 stage 2 决策（同 MAYNE-18 §5 的处置路径）。

## 6. 依赖 / schema / 后续本地 Git 授权包（未实施）

逐项（版本依据、用途、替代、拟改文件、所需动作）见 `build/web-foundation-integration/authorization-package.json`。摘要：

- **AUTH-GIT-1**：ZCode 独立评审通过后，共享本地 main 自 `9ad2d61` 快进到本轮集成提交（fast-forward，无内容变化）
- **AUTH-GIT-2**：push 远端（可选；现状 85feb8a 起均未 push）
- **AUTH-DEP-1**：W1 后端 HTTP 组装建议首选 Node 内置 `node:http`（零新增依赖/锁文件不变）；框架备选需逐包授权
- **AUTH-SCHEMA-1**：W1 任务队列持久化按契约以**追加式新迁移**（005_*，命名由切片定）实现，绝不改 001–004 既有字节；届时附逐表 DDL 与回滚说明
- 本轮**未实施**以上任何受限动作；package.json/锁文件/AGENTS/生产 src/、schema/migrations 零改动

## 7. 冻结哈希（记录时点，复核用 `git show <delivery-commit>:<path>`）

```
22a80a4d303b5ad46e111ad42df4246adb3354b5b5847f90a8a61f73ad3aea31  scripts/checks/check-structure.mjs（=MAYNE-18 §7 冻结值）
b74424cf1758ba8940862c274e07e83242725b4b41d8852831ea526f3d70aef3  docs/engineering/architecture.md（=MAYNE-18 §7 冻结值）
61843838cf6b6a5fb502e17658597a0f1001f065519a3f4f377ab5545bf4f8a2  docs/reviews/runtime-metadata-20261106.md
f358c6a871041c350f13f346a7cc425db37f1ac41be035c75cea6b1dd515336a  design/web-task-flow/task-flow.js
48cc1992a609dbb144c91e63619c613aa36194c847508fc54333e9813654f1c9  docs/engineering/web-task-interaction.md
2b53d7c4bec52919b85e677a9deb9ed75a37b7217ffcfc21e427b02d544933f0  docs/reviews/README.md
ef701f52d04a080b140ac6876b95735cdd3f004ef472c2257d1a42cae17cfae4  集成代码补丁（HEAD…工作区，除本记录与索引外）sha256
```

## 8. P3 台账（只登记，不扩大本轮修复范围）

1. **MAYNE-20**：D7 场景自建 FIFO 残留在 gitignored 草稿区至下次启动清理（`run-probes.mjs:815–826`）。
2. **MAYNE-21**：详情弹窗状态变异期间 Esc 后焦点落 BODY（`closeDetail()` 未显式恢复触发行）。
3. **MAYNE-21**：弹窗内 `[data-action="close"]` 命中头部 ✕ 而非底部「关闭」，仅观感。
4. **本轮新增观察**：`web-task-interaction.md` §12/§13 写「行内操作变为整行宽度的堆叠按钮」，而审定 CSS（≤760px）实为 flex 换行、不强制全宽——文档/CSS 口径差属 MAYNE-21 既有内容，本轮无 CSS 写入权，登记待其独立重评时一并处置。

## 9. 未验证项与开放项（保持开放）

1. **完整 `npm run check` 绿证未取得**（§5 R1b；负载归因，测试与本轮改动无交集）——W0 准出核心条件，保持开放。
2. 本机负载随所有者应用波动，空闲复跑时机由 owner/队长决定；若稳定超时属既有性能预算问题，交 stage 2。
3. Linux／Windows 未验证（macOS arm64 本机；与仓库现状一致，不外推）。
4. 共享 main 工作根、真实模型/凭据/真实工作根、部署未验（授权边界禁止；平台/真实环境未验逐项保留）。
5. 本轮对 MAYNE-21 原型/说明的语义修订（§4）**需 ZCode 独立重评**后方可视为已审定内容。
6. AUTH-GIT-1/2、AUTH-DEP-1、AUTH-SCHEMA-1 均未获授权、未实施。

## 10. 结论（限定的验收结论）

- **已证实**：四项审定交付在唯一集成树完成接入与核对；MAYNE-18 补丁逐字节接入且守卫在真实元数据环境 exit 0；占槽/退出核实语义按契约统一并通过浏览器动态复现；聚焦门禁（结构、文档、语法、68/68 探针）全部 exit 0；授权包形成。
- **未闭合**：完整门禁绿证（如实开放）；ZCode 对精确集成版本的独立评审（由 Codex 按精确版本发起）；owner 对授权包的逐项批准。
- 本记录不自签 pass／done；W0 集成准出与阶段晋级按登记由 Codex 依据独立评审结论、精确版本哈希与本项证据决定。
