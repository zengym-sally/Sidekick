# W0 最终集成准备候选独立审查（Kimi）：`b11fd05..882e6e3` 通过（1 项不阻塞 NIT）

- **评审对象**：`882e6e380ef483be77e9c1f00ea113671bf92b48`（父 `b11fd059db1c1e60882084ef56ec8ff70738ae4c`，tree `55c358a2eaf09ade85e4959f65a40258fa0d3ef2`）。派发评论 `01a1b68e-7308-779e-ab53-f8aa52a6f81c`，与 ZCode 的 F-1 增量复核并行。
- **结论**：**通过**（限本准备增量）。审定来源逐字节接收、W0 基座保留、最终提案与全部审查记录/索引落地、守卫仅新增指定迁移哈希冻结且正/负例独立复现、文档如实保留 F-1 待接入与最终门禁未跑——全部核实。F-1 修订待接入与最终门禁未跑是任务已登记的两项依赖，不构成本准备候选的新增缺陷。
- **边界**：实现与作者记录只读；仅在本次隔离树写本记录与 `build/mayne22-integration-prep-review/`；未跑完整 `npm run check`、未合 main、未清理分支、未改任何实现。评审者未参与本准备增量（上一轮 Kimi 审查范围是 `7f536db..b11fd05` 五文件增量，与本轮 16 文件增量无重叠）。

## 一、补丁身份：一致

- `git diff b11fd05 882e6e3 | shasum -a 256` = `2a04c62bd63161ff534e774e059af911ad808800ec8f2748def4167afa697641`，与派发值逐字符一致；父提交恰为 `b11fd05`。
- 16 文件 +1863/−12，与交付评论一致；重算 diff 与附件 `integration-prep-882e6e3.patch` **逐字节相同**（`cmp` exit 0）。
- name-status：M 5（`architecture.md`、`web-backend-design.md`、`product/05`、`reviews/README.md`、`check-structure.mjs`、`local_store.rs`——其中 `local_store.rs` 为 M，共 6 个 M）+ A 10（7 条 `docs/reviews/` 记录、DDL、runner、tests）。`package.json`、锁文件、`AGENTS.md`、`src/`、`lib.rs`、既有迁移 001–005、`vendor/`、`resources/`、Cargo 文件**零改动**（机械核对，无一条命中禁改清单）。

## 二、W0 基座保留：核实通过

- `git diff 8bd29c4 882e6e3 -- src-tauri/` 仅 4 个新文件（DDL、runner、tests、`local_store.rs` +10 行）；`-- scripts/` 仅 `check-structure.mjs`；其余为 `b11fd05` 已审文档增量与 7 条新记录。基座 `8bd29c4` / 已审公共文档 `b11fd05` 无覆盖。
- 作者声明 `git diff b11fd05 598d2da -- src-tauri/` 为空——独立复算为空，接入无覆盖冲突成立。
- 共享 main 仍为 `8bd29c4`（tree `c6f20de7`），reflog 仅一次 `Fast-forward`（前值 `9ad2d61`），未新建提交、未 push；准备增量只在 `agent/opencode/mayne-22`，未合入 main。

## 三、审定来源逐字节接收：blob 级机械证明全过

- **候选 `67860d3`**（父 `598d2da`）：4 个生产文件 + 实施记录在 `882e6e3` 的 blob 与源提交逐一相等（`git diff <源> 882e6e3 -- <paths>` 全部为空）。落地 sha256：DDL `8511907c…143d`、runner `324e62eb…2ec1`、tests `1f1224a4…7b8a`、`local_store.rs` `25d78ddf…3592e`，与交付声明逐项一致；候选补丁复算 `c3fe7148…405da2` 一致；`598d2da..67860d3` 恰为登记的五文件。
- **最终提案 `598d2da`**：提案文档内容 sha256 `bc8876c3…f706`，与 `598d2da` blob 逐字节相同。
- **审查记录落地**：`86b7300`（提案 R1）、`f0eaee3`（R2）、`ac2601d`（实施 ZCode 评审）、`49d2152`（Kimi main-ff 评审）在 `882e6e3` 的 blob 与源提交逐一相等；实施记录（`67860d3` 内）同样零差异。
- **F-1 修订确实未接入**：落地 runner 为 `324e62eb…`（12929 字节，`67860d3` 版）；F-1 修正版（`cab73aa`，`d57dfbc7…`，13572 字节）不在候选中——与「F-1 修订待接入」的真实状态一致，未提前合入未复核修订。

## 四、守卫增量：仅新增指定迁移哈希冻结 + 原地自测

- `check-structure.mjs` 全量 diff 恰 3 处：① `IMMUTABLE_MIGRATIONS` 仅新增 `src-tauri/migrations/web-backend/001_web_backend.sql → 8511907c…143d`；既有 001–004 四项冻结值逐字节不动（map 区 diff 恰一行新增）。② 违规提示语由「Historical migrations 001-004」同步为「Frozen migrations (001-004 and web-backend/1)」——新冻结路径生效后原措辞即失实，属必要同步，非规则扩张。③ `--self-test` 补两条断言：原字节不得被标（缺文件则自测失败）、篡改字节必须命中该路径。
- `SCAN_TOPS`、`TOP_LEVEL_DIRS`、`SRC_TAURI_TOP_*`、`FORBIDDEN_TRACKED` 等其余规则零改动，白名单零扩张。

## 五、守卫正/负例独立复现（合成树，未依赖作者日志）

方法：`git archive 882e6e3`（本环境对该 commit 直接 archive 异常，改以其 tree `55c358a2` 归档，4883→4894 条目差 11 与 16 文件增量中新增 11 个文件相符）导入临时目录并 `git init` 复现跟踪集；守卫以 `git ls-files` 取工作集，与真树同构。

| 用例 | 结果 |
|---|---|
| 正例 A：候选原字节，prepare-pi 前 | exit 1，**恰 3×`ref.missing`**（同三个 s32 文件，已知前置缺失），新迁移**未**被标 |
| 正例 B：补齐 3 个缺失引用目标后 | exit **0**，**215 文件 / 466 引用**——与 R5/Kimi/作者同规模逐字一致 |
| 负例 N1：篡改**新**迁移（追加字节） | exit **1**，`schema.immutable-migration` 恰好命中 `web-backend/001_web_backend.sql`；还原后 sha256 复归 `8511907c…143d`，复跑 exit 0 |
| 负例 N2：篡改**既有** `001_todos.sql` | exit **1**，`schema.immutable-migration` 命中——既有冻结不回归 |
| 负例 N3：意外顶层 `randomtool/` + `src-tauri/src/loose.rs` | exit **1**，`top.dir` + `layout.src-tauri-top` 均检出——既有布局规则不回归 |
| `--self-test` | exit **0**（22 违规类 + 8 引用负例；新冻结断言：原字节通过、篡改被标） |
| `npm run check:docs` | exit **0**，20 文件 / **424** 链接 |
| `git diff --check` / `--cached --check` | exit 0 / exit 0 |

## 六、文档真实状态：F-1 待接入与最终门禁未跑如实保留

- `docs/product/05`：总览与 W0 队列行以「已验证／已授权／正在实施／待办」四项分列——`67860d3` 独立评审通过并登记 F-1 MINOR；正在实施=① F-1 最小修正（未验证未合入）② 本准备候选（未合入 main）；待办=F-1 增量复核 → 接入后唯一集成执行者在实际最终版本串行重跑完整 `npm run check` → 统一提交/合入/清理；明写「均未合入 main，最终完整门禁未跑」。未提前签任何未验事实。
- 准备记录 `…-schema-integration-prep-20261107.md` §4/§5：完整门禁本轮未跑、R5 绿证不预支；F-1 未闭合、main 保持 `8bd29c4`、未 push、未清理分支——与事实一致。
- `web-backend-design.md` / `architecture.md`：仅带日期状态注记，明写「未合入 main、最终门禁未跑前，本节其余内容仍区分设计与已验证现状」；既有事实零删除。
- **索引**：`docs/reviews/README.md` 恰新增 7 条（准备记录、实施 ZCode 评审、实施记录、Kimi main-ff 评审、提案 R2/R1、最终提案），计数 75→82 与实有行数（82）相符；既有条目零改动。
- **admission**：登记先行（树/branch/HEAD=`b11fd05`/祖先链/接收版本与哈希/写入清单/越界清单），HEAD tree `0c69de9f…` 与 `b11fd05` 实际 tree 一致；写入清单与实际 16 文件改动一一对应，无越界。

## 七、发现（不阻塞）

- **NIT-1**：准备记录 §4 表与索引条目写 `check:docs`「20 文件 / **414** 链接」——414 是基座 `b11fd05` 的值（本评审在基座树复现 414），候选实际为 **424**（本评审复现；作者自带附件 `prep-final-checks.txt` 亦为 424）。数字陈旧且偏保守（少报 10 条），`check:docs` 本身两种计数下均 exit 0，不影响结论；建议最终集成轮顺手更正。
- **观察-1**：守卫提示语随新冻结路径同步改写（见 §4②），在登记的「仅新增指定冻结 + 原地 self-test」范围内，但严格说多改了一行文案；不构成规则扩张，登记备查。
- **观察-2（环境，非候选缺陷）**：作者本轮平台树已不存在，原始 build 日志未随附件全量交付（关键日志 6 件已随附）；本评审全部结论均在本次隔离树独立重建，不依赖缺失日志。另：本机 `git archive <b11fd05 commit>` 返回空归档（改以 tree 归档绕开），系本地 git 行为，与候选无关。

## 八、边界与未验项（保持开放）

未跑完整 `npm run check`（按登记留给 F-1 修订接入后唯一集成执行者）；未合 main、未 push、未清理分支；未签署 F-1 修订（`cab73aa` 待 ZCode 增量复核）；未跑 cargo（落地 Rust 与已审 `67860d3` 逐字节一致，候选内聚焦 cargo 证据按字节同一性适用，最终版本仍须完整门禁实证）；Linux/代理部署、真实凭据与真实工作根保持原未验状态。

## 交付物

- 本记录：`docs/reviews/web-foundation-integration-schema-integration-prep-20261107-kimi-review.md`
- 版本/哈希清单：`build/mayne22-integration-prep-review/kimi-prep-review-manifest.json`
- 原始证据：`build/mayne22-integration-prep-review/`（`verify-01-identity.txt`、`verify-01b-namestatus.txt`、`verify-02-byte-reception.txt`、`verify-03-source-hashes.txt`、`verify-04-guard-diff.txt`、`verify-05..08` 守卫正/负例、`verify-09-docs.txt`、`verify-10-docs-diff.txt`、`verify-11-design-arch-diff.txt`、下载的 6 个作者附件、合成树 `synth-882e6e3/` 与 `synth-b11fd05/`）
