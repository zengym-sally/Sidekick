# MAYNE-24 能力面 UI 测试套件工程接收（OpenCode，2026-11-10）

派工：MAYNE-24 评论 `01a1c1cf`（Codex：Hermes 对 `8164dea`＋记录 `1e679ac` 测试面通过结论接收后，III 串行另作小提交——从 `8164dea` 原样接收主测试、browser/session、页内 entry/HTML 五文件，从 `60ecc75` 接收三份 `capability-ui-baseline-*.vue.txt` 字节负控补齐八文件闭包；从 `1e679ac` 原路径接收 behavioral/cleanup 两份记录及本帖 Hermes 评审附件；README/manifest 逐项登记来源、已审范围和未验项；不整枝覆盖）。前置：三面板接收 `31d7e04`（评论 `01a1c1d0`）已完成，本提交直接位于其上。

## 范围与基点

- 基点：`31d7e046`（分支 HEAD，即 `agent/opencode/mayne-24` 三面板接收提交）。
- 来源提交：`8164dea`（ZCode 测试 r2.1，父 `a1e15d4`）、`60ecc75`（r1 测试基点，父 `61bd170`）、`1e679ac`（ZCode r2.1 记录提交）、评论 `01a1c1cd`（Hermes 独审附件）。

## 接收清单（11 文件，逐 blob 复算全等）

八文件测试闭包（`git show <commit>:<path>` 直接写盘后 `git hash-object` 复算，与来源树逐 blob 全等）：

| 文件 | 来源 | blob | bytes |
|---|---|---|---|
| `tests/unit/web-text-intake-capability-ui.test.mjs` | `8164dea` | `7b9c0e59175de8020a79e27722dccfeb5f72db48` | 23118 |
| `tests/fixtures/web-text-intake/capability-ui-browser.mjs` | `8164dea` | `ea0991d7c12918cb78e80d18a5581e32af873ace` | 8612 |
| `tests/fixtures/web-text-intake/capability-ui-session.mjs` | `8164dea` | `486493a87b6c069de580afb41b0990f51ec19e36` | 10165 |
| `tests/fixtures/web-text-intake/capability-ui-page/capability-ui-entry.ts` | `8164dea` | `23b0c93757848cf9e8511688ec53a699bdb80ba8` | 18251 |
| `tests/fixtures/web-text-intake/capability-ui-page/index.html` | `8164dea` | `897ff75b37fcac7b1a8aff2296765ae925aac2f7` | 225 |
| `tests/fixtures/web-text-intake/capability-ui-baseline-AgentSettingsPanel.vue.txt` | `60ecc75` | `107b8d74f9edd6a1d8da50e3eeb0e6f9259b8188` | 13701 |
| `tests/fixtures/web-text-intake/capability-ui-baseline-ModelSettingsPanel.vue.txt` | `60ecc75` | `0216921e5e13fa41362a935a6c45b1a38f4bbfba` | 20898 |
| `tests/fixtures/web-text-intake/capability-ui-baseline-SettingsPanel.vue.txt` | `60ecc75` | `fa75f477cad4074625a665365709819e8eb6d9f2` | 9103 |

- 派工 blob 命中：test `7b9c0e59…db48`、browser `ea0991d7…3ace`、session `486493a8…9e36` 与协调/Hermes 派工值全等。
- 页内 entry/HTML 交叉稳定：`62bdccd` 与 `8164dea` 两提交 `git ls-tree` 复算同 blob（`23b0c937`/`897ff75b`），与 Hermes「页内工装与 HTML 与 `62bdccd` 零差异」一致。
- 三份 `.vue.txt` 为**修复前基线字节钉**（负控，永不编译执行）：测试 T1 断言的 SHA-256 `e289bae4…`/`2e025366…`/`cdaa145c…` 对本树实际字节复算全部命中。其 blob 即三面板被取代的 pre-fix 字节（frozen-I/b5 世系），与本分支现役面板字节（`8a44fc3d`/`e67f8d18`/`73c1f643`，`31d7e04` 接收）不同——这正是负控的承重设计。
- 引用闭包核验：test→session＋三 `.vue.txt`；session→browser＋`capability-ui-page/index.html`；entry→vue/pinia＋三面板＋四 store（`agents`/`models`/`organizer`/`settings`，均在本树）——八文件闭包齐全，零缺引用。

三份记录文档（原路径原样字节，`git show 1e679ac:<path>` 提取）：

| 文档 | 来源 | blob |
|---|---|---|
| `docs/reviews/web-text-intake-capability-ui-behavioral-20261110-zcode.md` | `1e679ac` | `1e952f7f4fc00f471a04052409f977bd45f86f1f` |
| `docs/reviews/web-text-intake-capability-ui-cleanup-20261110-zcode.md` | `1e679ac` | `23ad196d0e4518e474ce03c6bd405d48dbb65829` |
| `docs/reviews/web-text-intake-capability-ui-test-review-20261110-hermes-review.md` | 评论 `01a1c1cd` 附件（CLI 下载） | 内容 SHA-256 `a192142cac31c7559623b3b03547dffdf0d8ca5c2d4c2dfe171478ff342d1efd` |

- Hermes 独审附件以 CLI 实际下载六件（评审记录 md、identity.txt、rev-green.tap、rev-green.err、rev-mutant.tap、SHA256SUMS.txt），大小与评论挂载元数据逐一相符；清单内四件身份/运行附件按其 `SHA256SUMS.txt`（`evidence-h17/` 前缀为其本机目录布局）复算 SHA-256 全匹配。评审记录 md 本体另存本记录表列 SHA-256。运行类原始件留 `build/` 不入库（gitignored）。
- **派工出处补注（历史原件保留）**：Hermes 评审记录第 3 行把派工出处记为 `01a1c1b6`，协调层已指明系误记——有效目标更新以 `01a1c1c8` 为准（沿 `01a1c1b2` 定界）。评审文件字节不改，本条补注即登记；README/manifest 条目均按 `01a1c1c8` 标注有效出处。

## 已审范围（按 `01a1c1cf` 接收口径登记）

Hermes 独审（记录如上，结论**通过，限测试能力面**）：五文件全读静态核查（预算 14s+6s 用例入口显式分账、迟到续体 no-op 防崩、startChrome 失败回收、逐步关闭收集＋传播、fault 缝 verdict/真实事实结构分离、注入边界与种子合法性）；独立复跑 12/12 exit 0（墙钟 6.68s、stderr 29B、残留 0）；自选变异（`trialWired false→true`）恰 B3+B3b 红、其余六面绿、残留 0；两受控反控（启动失败 CC 117ms、关闭 fault CC 918ms）同过。

## 未验项（照记，不代签）

1. 真实关闭错误传播未动态诱导（fault CC 按设计仅覆盖判定；「Chrome 拒不退出→exitConfirmed=false」分支仅静态核）。
2. Chrome 启动失败 CC 用 `/bin/echo`（spawn 成功后即退）；spawn 拒绝（ENOENT）路径静态成立、未动态诱导。
3. 作者六变异矩阵未重跑（旧输出原样保留）；其余五个变异承重依赖 r2 输出＋未动页内工装。
4. 记录型 Backend 命令计数与种子 succeeded run 仍非真实 HTTP/Pi；B3b 仍为标志条件面（native 不签）。
5. 本接收不重跑套件（按派工「不重跑已过行为」）；套件在本树的首次执行留待聚合/集成轮。
6. package 未接入：`test:web-text-intake` 聚合命令本轮零改动，待 SSE／黑盒各自审过后统一接入。

## 实际核查（限定，按派工）

| 核查 | 结果 |
|---|---|
| blob 复算 ×11 | 全等来源（八文件＋两记录 hash-object；评审记录 SHA-256 见上表） |
| `node --check` ×3（test/browser/session） | exit 0 |
| `npm run typecheck`（接收后，vue-tsc 全树，含页内 entry.ts） | exit 0 |
| `npm run check:structure`（前后对照，基线＝detached `31d7e04` 临时树） | FAIL 集逐行全等：11 条在册（1×003 冻结＋3×vendor/pi＋7×在册接收集 ref.missing），零新增零消失 |
| 引用闭包 | 八文件互相引用＋src 依赖全部在树（见上） |
| 基线负控 SHA-256 ×3 | 与测试 T1 断言值逐字命中 |

未跑（按派工边界）：套件重跑、vite build／打包重建、聚合、完整 gate。

## README/manifest 登记

- README 索引新增四行（behavioral／cleanup／Hermes 评审记录／本接收记录）并**校准标题计数**：本分支索引此前存在 +1 偏差（`997291e` 加行未同步标题：行 150 对标题 149，随后每轮顺延；接收前 152 行对标题 151）——本轮新增四行后按实际行数校准标题为 156（151→156，含校准 +1），偏差来源在此如实登记。
- manifest 修订 4 → 5：新增 `sections.Z_capability_ui_suite`（八文件条目：path/sourceCommit/blob/sha256/bytes/lineage/review/status）、F 新增一行「capability-ui behavioral test suite r2.1」＝RECEIVED、新增 `adjudications.capabilityUiSuiteAdmission`（来源、已审范围、未验项、出处补注）、`writeView.revision5Recount`（条目计数 133→142：Z 八条目＋F 一行）。聚合命令、package、依赖锁零字节。

## 不接收清单（不整枝覆盖）

`8164dea`/`1e679ac`/`a1e15d4` 的整枝树不合并；r1 记录 `web-text-intake-capability-ui-20261110-zcode.md` 未在派工清单内，不接；ZCode 分支上的 README/记录提交（`62bdccd`/`a1e15d4` 中非清单文档）不接；生产、package、脚本、依赖锁零字节。

## 边界与结论

不重跑已过行为；不改其他生产文件；不操作 main；不启动聚合、正式集成或完整 gate；Pi 现有 SSE 独审继续原线。MAYNE-24 保持 `in_progress`，E/D、GAP-5 与整体准出边界不变。限定接收通过：八文件闭包逐 blob 与指定来源相等，两记录＋Hermes 评审记录原样入册，来源/已审范围/未验项已按派工逐项登记。原始证据 `build/mayne24-capability-ui-receive-20261110/`（gitignored：blob 复算清单、结构前后对照、Hermes 附件六件下载读回）。
