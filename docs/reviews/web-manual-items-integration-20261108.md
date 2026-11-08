# W1 最终集成记录（2026-11-08，OpenCode 唯一集成执行）

> 范围：MAYNE-23 W1 三候选（I 生产实现／II 验收测试／III 工程接入）的唯一最终集成、公共记录补齐与串行完整门禁。风险级：R2（跨候选集成＋全量门禁）。
> 集成基点：本地 main `65469904d8baddde738646dfed3bf4a921f47b68`（tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`，未 push）；集成工作树为本次平台分配的隔离 worktree（branch `agent/opencode/mayne-23`），不使用共享 main 或历史预备树。
> admission：`build/web-manual-items-integration/admission.json`（修改前登记，gitignored；编号证据 `00`–`03` 同目录）。

## 1. 接收与身份核实（全部实测逐字节相符）

三候选完整经审链均从基点 `6546990` 分出（merge-base 实测三者皆为 `6546990`）；文件集两两不相交（`comm -12` 空），合并无冲突。

| 候选 | 接收版本 | tree | 关键增量哈希（复算） | 独立审查覆盖 |
|---|---|---|---|---|
| I 生产实现（Claude） | `4ca93440` | `cfda86b5…`（＝登记） | 累计 diff `bc4b1c3..4ca93440` `ff79d46b…f74a4`；修复增量 `4052d47..4ca93440` `d3a01ce3…ba890`；参数增量 `74c023c..4052d47` `e1d19cd0…575e` | ZCode R1 `12d42f2`（FAIL→闭）、ZCode R2 `4889f87`（PASS）、OpenCode 参数 `a5708d5`（PASS） |
| II 验收测试（Kimi） | `19418ef` | `85badfe1…`（＝登记） | 修订 diff `c24dc4a..19418ef` `97dfd92a…2cf5`；format-patch `e585b642…40b1` | OhMyPi R1 `fe8ac7b`（退修→闭）、OhMyPi R2 `ad90915`（PASS） |
| III 工程接入（OpenCode） | `133a2a1`（已在集成树祖先） | `15ad350a…`（＝登记） | format-patch `ab696b8..133a2a1` `4109daa9…5aa` | ZCode `3e8d310`（PASS）；其后 `a5708d5` 仅参数审查记录，按登记原样接收 |

冻结文件实测：001 `8511907c…143d`、002＝批准 DDL `b6cb8e61…f97e`、web-api/1 `61863271…8f58`、契约 19045b8 原审版 `8d752953…0e8d`；授权清单 19045b8 原版 `452dc436…`，现树 `242ea3db…` 的差异仅为批准状态行＋§12 实施准入登记（ZCode III 审查 `3e8d310` 已覆盖该 delta）。

接收方式：merge 提交接入 I/II 完整链（非仅末次修复）；五份审查记录按原路径从审查提交逐文件接收（blob 级一致：`c0d2da59`/`121be7c1`/`2df4a32c`/`68ea3f96`/`36be131d`），不整树合并外部分支。交叉验证：`git diff 4ca93440 <集成树>` 与 `git diff 19418ef <集成树>` 的差异文件恰为另一候选＋III＋本集成新增文件，I/II 写入范围无一文件偏离候选原样。

## 2. 本集成新增公共记录

- 契约附录：`docs/engineering/web-manual-items-contract.md` 追加「附录A」，仅转录两次已登记协调裁定（A.1 接口字面名与列表参数；A.2 幂等作用域 OBS-2）。正文 §1–§14 与冻结 DDL 逐字节未改（diff 纯追加，0 删除行）。追加后本文件 SHA-256：`32910de72ceb20b9e4aa8226754316ee7400166c25e9d295bf0ef1811ce11eb4`（追加前 `8d752953…0e8d`）。该文档增量按登记须与集成一起独立复核。
- 评审索引：`docs/reviews/README.md` 登记 10 条新记录（I 交付＋I R1/R2＋参数审查、II 交付原版/r2＋OhMyPi R1/R2、III ZCode 审查、本集成记录），索引计数 91→101。
- 本记录：`docs/reviews/web-manual-items-integration-20261108.md`。

## 3. 集成提交与冻结

- 集成冻结提交：本记录随候选接入一起提交后登记于 §4（gate 回执补记）。
- 结构：`a5708d5`（III＋参数审查）→ merge I（`4ca93440`）→ merge II（`19418ef`）→ 公共记录提交（冻结 SHA）。

## 4. 完整门禁（原预算串行，冻结 SHA 上执行）

按登记：先以仓库既有命令真实准备构建前置（`npm ci --ignore-scripts`、`probe:prepare-cli`、`probe:prepare-pi`；不以空目录/桩产物替代），核实 `check` 链尾含 `build:backend` 与 `test:web-manual-items`（III 已接入，本轮核实未改），然后在冻结提交上串行执行一次完整 `npm run check`。退出码、逐组结果与警告分类记入本节（gate 回执）；不重复孤立运行同版整套 Web 测试。

### 4.1 冻结与前置（全部实测）

- 冻结提交 `a02bfef2945bc7c147eef14746a14f180a9c2578`，tree `5fe0b3907b83d95b7d722280c437ffde6cf467eb`。起点表述（按 Kimi 公共审查 NIT-1 更正，见 §7.1）：前置阶段于 2026-11-08T00:19Z 启动（`npm ci` 起）；正式 gate（冻结提交上的完整 `npm run check`）于 00:26:51Z 启动（日志 `GATE_START`）、00:26:57Z 结束。原表述「gate 于 00:19Z 启动」把前置起点误写作 gate 起点，仅措辞更正，不改变任何结果。
- 前置：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` exit 0（lark-cli v1.0.98 实装）；`probe:prepare-pi` exit 0（vendor/pi 按 `pi-source.json` 来源校验后真实构建）。前置后 `check:structure` 全绿（236 文件／498 引用，exit 0；含 server/、bin/、新测试目录与 002 冻结自测正/负例）、`check:docs` exit 0（21 文件／493 链接）。
- 冻结前聚焦检查亦留档：docs exit 0（同上）、structure self-test exit 0、仓库模式仅 3 处 `ref.missing`（vendor/pi 构建产物，前置后消除，0 处引用候选文件）。

### 4.2 结果：**不通过（gate exit 2，`typecheck` 组失败）**

`&&` 链在第 5 组 `typecheck` 失败后按序短路，其后全部组未执行：

| # | 组 | 结果 |
|---|---|---|
| 1–4 | `check:structure`、`check:docs`、`test:executable-copy`、`probe:bundle` | 全部 exit 0（无警告） |
| 5 | `typecheck`（vue-tsc --noEmit） | **exit 2，3 处 TS 错误** |
| 6–末尾 | `test:s1-domain` … `test:web-manual-items`（含 `check:rust`、`build:backend`、新 Web 三套件等约 35 组） | **未执行**（前置组失败短路；非跳过、非豁免） |

原始日志：`build/web-manual-items-integration/11-check-full.log`（逐组边界、完整错误输出）；typecheck 段落摘录 `12-typecheck-fail-section.log`。

### 4.3 缺陷定位与归因（证据确凿，属候选 I 交付缺陷）

三处错误全部位于候选 I 交付文件 `src/lib/web-api-client.ts`，与冻结域类型不一致：

- L91/L92 TS2322：`WirePoint.precision`（`'minute' | 'day'`，L14）赋给域类型 `TimePoint.precision?: 'day'`（`src/domain/todos.ts:3`，仅 `'day' | undefined`）——`'minute'` 不可赋。
- L101 TS2367：`WireItem.source` 被声明为字面量 `'manual'`（L33），与 `'signed_ai'` 比较无重叠；域类型 `Todo.source` 为 `'manual' | 'signed_ai'`（`src/domain/todos.ts:5`）。

归因证据（`13-ab-candidate-i-typecheck.log`）：对候选 I 树（`4ca93440`，`git archive` 导出、共享同一 node_modules）单独运行 `vue-tsc --noEmit`，exit 2 且错误逐字节相同——缺陷内在于候选 I 交付字节，非集成组装产物；`web-api-client.ts` 与 `src/domain/`、`shared/` 在基点→集成树逐字节未改（blob 同一）。服务端 `manual-items-service.mjs:83` 实际线格式即 `precision ?? 'minute'`，说明线协议含 `'minute'`，是客户端类型声明与转换函数（`fromWireItem`）未对齐域可空语义，属 I 范围内可修的对接缺陷。

按登记处置：**不擅改 I 文件、不弱化类型、不为过门禁放宽任何检查**；附证据回报，由队长派 I 原作者（Claude）修订并另派独立复审，其后在新的冻结版本重跑完整门禁。失败/缺前置/未分类警告均不准出，不沿用任何旧绿证。

## 5. 未验项与边界

- 本轮门禁在第 5 组短路，其后的 Rust 全套、两包构建、`build:backend` 真实打包、新 Web 三套件（`test:web-manual-items`）与浏览器路径在本集成版**均未执行**（不作为已验或已否证；待 I 修订后的新集成版重跑）。
- 完整浏览器业务旅程与集成公共增量的独立验收：按登记由未参与实现者在明确集成版本另行执行，本记录不代签。
- main 合入与分支清理：留队长按既有 owner 授权另次确认精确版本后执行；本集成不 push、不改任务状态（MAYNE-23 保持 in_progress）。
- Linux/代理、真实凭据/真实用户工作根/真实模型：授权边界外，未涉及。
- 集成后如任何业务/测试变更，须再独审并重跑相应门禁，不得以旧 SHA 绿证覆盖。

## 6. 收尾

- 自建进程：本 run 未启动常驻服务；gate 进程随失败退出；A/B 取证用的临时导出树与 tar 已删除，仅留证据日志。`pgrep` 复核无 `web-backend-storage`／调试浏览器残留（见 `14-cleanup-pgrep.log`）。
- 未分类警告：前置聚焦检查与已执行 4 组均无警告输出。

## 7. 第二轮：客户端类型映射修复接入（2026-11-08）

按队长派发（评论 `01a1b8a1-37cc-7915-97a8-041bcb9f9327`）：以第一轮回执提交 `868eaaf3c75f5de6f52b76533802a022a9b96ca2` 为当前集成基点，按原集成写入边界接入候选 I 客户端修复精确增量，原样接收本轮两份审查记录，更新 admission 与公共记录。第一轮失败回执（§4.2–§4.3）原样保留，不以聚焦绿证替代全门禁。

### 7.1 接收与身份（全部实测逐字节相符）

- 修复提交 `ff5d6c24e1a8c4ad006ad52532b64fdf47f7c064`（tree `f99af22cb00b40dc7d7d07bd2c81e501f9aeaf32`，父即 `4ca93440`）：增量恰 3 文件 +93/−8；增量补丁（`4ca93440..ff5d6c2`）SHA-256 `7ef64137ecc2253557099cbfcfa66ac6f794620e9403ff616089d1ae7d25331f`、相对基点 `bc4b1c3` 累计补丁 `b0e03254f3530d44607d24861729889b1e86dc480742a41bc98decee58aaa002` 复算一致；`src/lib/web-api-client.ts` `b4bec882…fc16`、`tests/unit/web-manual-items.test.mjs` `d0b7ebfe…1d7a` 与申报一致，第三文件为 I 自有交付记录（哈希刷新＋纯追加 §8）。
- 接入方式：merge（父 `4ca93440` 已在集成树祖先，合并零冲突，合并 diff 恰为该 3 文件）。合并前实测三个目标文件与 `4ca93440` blob 同一、I 写入范围（`server/`、`src-tauri/`、`src/`、`tests/unit/`）相对 `4ca93440` 零差异、II 夹具目录相对 `19418ef` 零差异——增量逐字节落在申报范围。admission 见 `build/web-manual-items-integration/admission.json`（修改前登记）。
- 独立审查覆盖：ZCode R3 `3810ee95…` 限定复审通过（共享 node_modules A/B：父版 `4ca93440` 逐字节复现门禁三处 TS 错误、候选 exit 0；单测 16/16；可证伪回归两向）。
- 两份审查记录原样接收（blob 级，`git show <commit>:<path>`）：ZCode typecheck 审查 `docs/reviews/web-manual-items-implementation-20261108-zcode-typecheck-review.md`（自 `3810ee9`）、Kimi 集成公共增量审查 `docs/reviews/web-manual-items-integration-20261108-kimi-review.md`（自 `b15eaa17`，tree `304ce35b…`）。评审索引 101→103。Kimi 审查两项 NIT 处置：NIT-1 前置/gate 起点表述已在 §4.1 更正；NIT-2 本轮证据包连同前置、逐组与收尾日志一并打包哈希交付。
- 冻结文件复核：001 `8511907c…143d`、002 `b6cb8e61…f97e`、web-api/1 `61863271…8f58`、契约（含附录A）`32910de72ceb20b9e4aa8226754316ee7400166c25e9d295bf0ef1811ce11eb4` 本轮逐字节未动。

### 7.2 第二轮冻结与完整门禁（原预算串行，冻结 SHA 上执行）

- 第二轮冻结提交 `c26f40d11b6c5a4f3d7e9b1418b32d01dba12a38`，tree `b106679c2dd31725126873820b011bd8d9397d2b`（本节与 §7.1 随修复接入一起提交；gate 逐组结果与归因见 §8 回执）。
- 前置与门禁计划同 §4：冻结后从头真实准备构建前置（`npm ci --ignore-scripts`、`probe:prepare-cli`、`probe:prepare-pi`，不以桩产物替代），再在冻结提交上串行执行一次完整 `npm run check`——保留全部脚本、预算与默认产品 dist，不孤立预跑同版整套 Web 组；逐组结果、exit、警告分类与未验项记入 §8。若仍失败，沿 §4.3 同一路径归因回报，不擅改 I/II。

## 8. 第二轮完整门禁回执（2026-11-08，冻结 `c26f40d` 上串行执行）：**不通过（gate exit 1，`test:desktop-controls` 组）**

### 8.1 前置与正式 gate 起点（本轮即区分登记）

- 前置阶段于 00:54:43Z 启动：`npm ci --ignore-scripts` exit 0（00:54:43–46Z）；`probe:prepare-cli` exit 0（lark-cli v1.0.98，00:54:49–51Z）；`probe:prepare-pi` exit 0（vendor/pi 按 `pi-source.json` 来源校验后真实构建，82 文件 9.0 MiB，00:54:55Z–00:55:10Z）。前置后聚焦 `check:structure` exit 0（236 文件／499 引用）、`check:docs` exit 0（21 文件／495 链接）。
- 正式 gate（冻结提交 `c26f40d` 上的完整 `npm run check`）`GATE_START=2026-11-08T00:55:26Z`、`GATE_END=00:55:38Z`，exit 1。

### 8.2 逐组结果（51 组链）

| # | 组 | 结果 |
|---|---|---|
| 1 | `check:structure`（self-test＋全库） | exit 0 |
| 2 | `check:docs` | exit 0（21 文件／495 链接） |
| 3 | `test:executable-copy` | exit 0（4/4） |
| 4 | `probe:bundle` | exit 0 |
| 5 | `typecheck`（vue-tsc --noEmit） | **exit 0——首轮 3 处 TS 错误已由 `ff5d6c2` 修复闭合** |
| 6 | `test:s1-domain` | exit 0（51/51） |
| 7 | `test:s2-domain` | exit 0（47/47） |
| 8 | `test:s31-domain` | exit 0（183/183） |
| 9 | `test:today-domain` | exit 0（26/26） |
| 10 | `test:layout-domain` | exit 0（14/14） |
| 11 | `test:desktop-controls` | **exit 1（9 tests，0 pass，9 fail；全部挂于 `before` 钩子的 vite build，见 §8.3）** |
| 12–51 | `test:pet-domain` … `test:web-manual-items`（含 `check:rust`、两包构建、`build:backend` 真实打包、新 Web 三套件等约 40 组） | **未执行**（第 11 组失败 `&&` 短路；非跳过、非豁免） |

已执行 10 个绿色组均无警告输出（扫描 `warn`／`deprecat` 仅命中既有测试名文本）；首轮失败回执（§4）原样保留。

### 8.3 失败定位与三向归因（证据确凿，属候选 I 交付缺陷；首轮短路致其首次暴露）

9 个用例全部失败于同一构建错误：`[UNLOADABLE_DEPENDENCY] Could not load ../lib/<绝对路径>/tests/fixtures/desktop-controls/api.ts.ts`（`tests/integration/desktop-controls.test.mjs:22` 的 `before` 钩子 vite build）。机制：

- 候选 I 适配（`da79aed`，在 I 授权的最小 desktop-controls 适配内）为 `src/stores/todos.ts`／`src/stores/pairing.ts` 引入带扩展名导入 `from '../lib/web-api-client.ts'`，并在该测试的 fixture alias 追加 `{find:/web-api-client/, replacement:join(fixture,'api.ts')}`——**无锚点子串正则**。vite/rollup alias 对正则 `find` 按「匹配子串」替换：说明符中 `web-api-client` 被替换为 fixture 绝对路径，残留前缀 `../lib/` 与后缀 `.ts`，拼出 `../lib/<abs>api.ts.ts` 解析失败。对照基线既有第一 alias（`^…$` 锚定整串替换）无此问题。
- 基线 `6546990` 的 `src/` 无任何 `web-api-client` 导入（todos.ts 走 Tauri `invoke`），alias 不触发——该组在基线绿（W0 全门禁 968/968 含本组）。
- **三向对照（共享同一 node_modules）**：基线导出树 `test:desktop-controls` **9/9 pass、exit 0**（`13-ab-baseline-desktop-controls.log`）；候选 I 树（`4ca93440`）导出 **9 tests／0 pass／9 fail，错误与集成树逐字节同构**（`12-ab-candidate-i-desktop-controls.log`）；集成冻结树 gate 复现（`11-check-full.log`）。缺陷内在于候选 I 交付字节，非集成组装产物。
- **为何历轮未暴露**：I 聚焦验证清单未含 `test:desktop-controls`；`typecheck`／单测／HTTP smoke 均不经过该 fixture alias 构建（真实布局下 `.ts` 导入可解析）；II 不触该组；首轮 gate 在第 5 组 `typecheck` 短路，第 11 组从未执行；ZCode R1–R3、OhMyPi R1/R2、Kimi 公共审查范围均不含该组。完整门禁首次跑到第 11 组即拦下——与其设计目的相符。

按登记处置：**不修改 I/II、不豁免守卫、不弱化断言**；本回执即归因回报。修复面（alias 锚定方式或导入写法）在候选 I 原有写入授权内，由队长派 I 原作者修订并另派独立复审，之后在新的冻结版本从头重跑完整门禁。

### 8.4 未验项与收尾

- 未验项：第 12–51 组（Rust 全套、两包构建、`build:backend` 真实打包、`test:web-manual-items` 新 Web 三套件、浏览器路径等约 40 组）在本冻结版零证据；完整浏览器业务旅程独立验收仍待明确新集成版另派；Linux/代理、真实凭据/真实用户工作根/真实模型在授权边界外。
- 收尾：本 run 无常驻服务；gate 与聚焦进程随退出结束，`pgrep` 复核无 `web-backend-storage`／vite preview／调试浏览器残留（`15-cleanup-pgrep.log`）。A/B 三向对照的临时导出树（`ab-baseline-r2`、`ab-candidate-i-r2`）留在 gitignored `build/`（沙箱拒绝 `rm -rf`，不入库不交付）。
- 证据包：`web-manual-items-integration-r2-evidence.tar.gz`（SHA-256 `f73e4c49a5b0cb02676cd9fe6293d896282fb4e6c4cd39f204de49e7aa2c3a25`）含前置、逐组 gate、A/B 对照与收尾全部编号日志及 `SHA256SUMS.txt` 清单；不含配对码／cookie／token（已扫描）。


## 9. 第三轮：desktop-controls alias 修复接入（2026-11-08）

按队长派发（评论 `01a1b8b2-5714-72ea-98eb-50045bb6a60a`）：OpenCode 先对 `ff5d6c2..91b78ed` 独立审查（不通过即止步），仅审查通过后以集成回执 `ecb7804` 为基点在同一 run 接入该两文件精确增量，按原集成边界更新 admission/索引/公共回执，冻结新 SHA/tree 后从头串行完整门禁。§4/§8 两轮失败回执原样保留，不以聚焦绿证替代全门禁。

### 9.1 独立审查（先决条件，已满足）

- 审查者 OpenCode 未参与 alias 修改（增量由 I 作者 Claude 提交于 `91b78ed`）；判定**通过**，记录 `docs/reviews/web-manual-items-implementation-20261108-opencode-alias-review.md`（本树 `1802a05`）。
- 要点：增量恰 2 文件 +19/−2、补丁 SHA-256 `5a339edc…365ea0`、累计 `bc4b1c3..91b78ed` `8634afb4…36bae2` 逐字节复算相符；仅 alias 一行改锚定精确匹配＋I 自有记录刷新；九用例断言/30000ms 预算未动；共享 node_modules 动态复跑候选 9/9 pass exit 0、旧 alias A/B 逐字复现第二轮回执失败（9/0/9 `[UNLOADABLE_DEPENDENCY]`）；typecheck exit 0。

### 9.2 接收与身份（全部实测逐字节相符）

- 修复提交 `91b78ede9f072598b7879aa461cdc03625ac1ccf`（tree `da4061a74e2578b9a28154c534fefa885bfef547`，父即 `ff5d6c2`）：增量恰 2 文件 +19/−2——`tests/integration/desktop-controls.test.mjs`（blob `2ee8c910…4632`）与 I 自有交付记录（blob `de9ef735…57fd`，哈希表刷新＋纯追加 §9）。
- 接入方式：merge（父 `ff5d6c2` 已在集成树祖先，合并零冲突，合并 diff 恰为该 2 文件 +19/−2）。合并前实测两个目标文件与 `ff5d6c2` blob 同一（diff 空）；合并后与 `91b78ed` blob 同一（diff 空）——增量逐字节落在申报范围。
- 相对第二轮回执 `ecb7804`（含其冻结树 `c26f40d`）的偏差恰为：alias 修复 2 文件＋本审查记录＋评审索引行＋本记录 §9——I/II 交付字节除经审增量外零偏离（`git diff c26f40d HEAD --name-only` 实测恰 5 文件，其中 2 文件与候选 blob 同一）。
- 审查记录接收：本审查由集成者本人执笔、随本树 `1802a05` 提交（评审索引 103→104），无跨树接收。
- admission：`build/web-manual-items-integration/admission.json`（修改前登记：实际 pwd/branch/HEAD `1802a05`、基点祖先核对、接收增量与审查身份、写入清单、门禁计划）。

### 9.3 第三轮冻结与完整门禁（原预算串行，冻结 SHA 上执行）

- 第三轮冻结提交＝本节随 alias 修复接入一起提交的那个提交；其 SHA/tree 于 §10 回执登记（gate 在该冻结提交上执行）。
- 前置与门禁计划同 §4：冻结后从头真实准备构建前置（`npm ci --ignore-scripts`、`probe:prepare-cli`、`probe:prepare-pi`，不以空目录/桩产物替代），再在冻结提交上串行执行一次完整 `npm run check`——保留全部脚本、预算与默认产品 dist，不孤立预跑同版整套 Web 组；逐组结果、exit、警告分类与未验项记入 §10。若仍失败，沿 §4.3/§8.3 同一路径归因回报，不擅改 I/II。

## 10. 第三轮完整门禁回执（2026-11-08，冻结提交上串行执行）：**不通过（gate exit 1，第 47 组 `check:s33-p2-package`）**

### 10.1 冻结与前置（全部实测）

- 第三轮冻结提交 `2e349ec36ebc25764d17919836925598e57fb23c`，tree `d9d536c91a3464cb7d5c1911a76bfdd542825250`（§9 随 alias 修复接入提交）。
- 前置阶段 2026-11-08T01:18:28Z–01:18:52Z：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` exit 0；`probe:prepare-pi` exit 0（vendor/pi 按 `pi-source.json` 来源校验后真实构建，82 文件 9.0 MiB，commit `ad702637…`）。前置后聚焦 `check:structure` exit 0（236 文件／499 引用，vendor 构建产物就位后零 `ref.missing`）、`check:docs` exit 0（21 文件／496 链接）。
- 正式 gate（冻结提交上的完整 `npm run check`）：`GATE_START=2026-11-08T01:20:25Z`、`GATE_END=01:32:03Z`，**exit 1**（11.6 分钟，含本 worktree 首次全新 Rust 全套编译）。

### 10.2 逐组结果（51 组链）

| # | 组 | 结果 |
|---|---|---|
| 1 | `check:structure`（self-test＋全库） | exit 0（236 文件／499 引用） |
| 2 | `check:docs` | exit 0（21 文件／496 链接） |
| 3 | `test:executable-copy` | exit 0 |
| 4 | `probe:bundle` | exit 0 |
| 5 | `typecheck`（vue-tsc --noEmit） | **exit 0——首轮失败面保持闭合（`ff5d6c2`）** |
| 6–10 | `test:s1/s2/s31/today/layout-domain` | exit 0（逐组） |
| 11 | `test:desktop-controls` | **exit 0：9 tests／9 pass／0 fail——第二轮失败面由 `91b78ed` alias 修复闭合** |
| 12–21 | `test:pet-*` 五组＋`check:pet-ui`＋ui-entries＋pet-native＋check:pet-native | exit 0（逐组） |
| 22–31 | `test:s32/s33-*-domain` 五组＋`test:mcp-contract/http/recovery`＋model-budget/output-diagnostics＋mcp-native-fetch | exit 0（逐组） |
| 32 | `check:rust`（fmt --check＋clippy -D warnings） | exit 0 |
| 33–37 | `check:s33-p2-runtime`、`test:s33-lifecycle`、`probe:runtime/card/contracts` | exit 0（逐组） |
| 38 | `probe:native`（cargo test --lib -- --test-threads=1） | exit 0（**323 passed／0 failed／3 ignored**，307.8s） |
| 39–42 | `test:mcp-budgeted`、`probe:toolchain`、`test:s2-runtime`、`test:today-runtime` | exit 0（逐组） |
| 43–45 | inline `node --test`：s31-runtime／layout-runtime／s32-runtime | exit 0（链条继续，为 `&&` 语义下的通过证明） |
| 46 | `probe:bundle-smoke` | exit 0 |
| 47 | `check:s33-p2-package` | **exit 1——`build:s33-ui-verify` 内 `tauri build` 主二进制解析失败（见 §10.3）** |
| 48–51 | `test:pet-ui-artifacts`、`test:mcp-native-launcher`、`build:backend`、`test:web-manual-items` | **未执行**（第 47 组失败 `&&` 短路；非跳过、非豁免） |

已执行 46 组无新增警告类别：唯一命中为 vite「Some chunks are larger than 500 kB」提示（第 47 组 beforeBuildCommand 的 `npm run build` 内，W0 既有已知提示类别）；警告扫描中的其余 `warn`/`warning` 命中均为既有测试名文本。

### 10.3 失败定位与三向归因（证据确凿，属候选 I 已批字节与既有打包路径的交互；前两轮短路致其首次暴露）

失败点：`check:s33-p2-package` → `build:s33-ui-verify` → `node scripts/build/build-app.mjs tests/fixtures/s33-ui-verify.config.json` → `tauri build --bundles app`。beforeBuildCommand `npm run build` 全绿（typecheck exit 0、vite 483ms 构建成功）后，tauri CLI 报：

```
failed to find main binary, make sure you have a `package > default-run` in the Cargo.toml file
```

机制：候选 I 已批变更 C 向 `src-tauri/Cargo.toml` 追加 `[[bin]] web-backend-storage`。基线 `6546990` 的 Cargo.toml 无任何 `[[bin]]` 段（唯一二进制来自 `src/main.rs` 的隐式 `sidekick`），tauri CLI 单二进制无需消歧；现为两个 bin 且无 `default-run`，主二进制解析失败。打包链自 W0 未改：`build-app.mjs` 对基线 diff 为空（`tauri build --bundles app`，无 bin 选择参数）。

**三向对照**（`git archive` 导出至沙箱临时树＋共享 node_modules，到达判定标记即收尾进程树；日志 `31/32/33-ab*-p2package.log`）：

| 实验 | 树 | 结果 |
|---|---|---|
| AB1 | 候选 `91b78ed`（I 交付字节原样，typecheck 绿） | **RESOLUTION_FAILED**：错误与门禁逐字同构 |
| AB2 | 基线 `6546990`（W0，Cargo.toml 零 `[[bin]]`） | **RESOLUTION_PASSED**：7.7s 越过解析进入 cargo 编译（到达标记即杀） |
| AB3 | 候选 `91b78ed`＋仅在丢弃型导出内插入 `default-run = "sidekick"` | **RESOLUTION_PASSED**：同上越过解析（到达标记即杀） |

结论：缺陷内在于候选 I 已批字节（变更 C）与 W0 既有打包消费方（`build:s33-ui-verify`／`probe:app`／`test:mcp-native-launcher` 同走 `tauri build`）的交互；本轮接入的 alias 增量与本失败无关——第 5、11 两组此前失败面本轮双双转绿。第 1–2 轮 gate 分别于第 5/11 组短路，第 47 组从未执行，本轮为首次暴露。

按登记处置：**不修改 I/II、不豁免守卫、不动冻结树**（AB3 的 `default-run` 仅存在于丢弃型导出，作机制证据回报）。`Cargo.toml` 属候选 I 唯一写入范围，补 `default-run = "sidekick"`（或队长裁定的等效方案）须由队长派 I 原作者修订＋独审后，另冻结新版本从头重跑完整门禁。

### 10.4 未验项与收尾

- 未验项：第 48–51 组（pet-ui-artifacts、mcp-native-launcher、`build:backend` 真实打包、`test:web-manual-items` 新 Web 三套件含 HTTP/重启/同源浏览器）在本冻结版零证据；完整浏览器业务旅程独立验收仍待明确集成版另派；Linux/代理、真实凭据/真实用户工作根/真实模型在授权边界外。
- 收尾：`pgrep` 复核无 `cargo`/`rustc`/`build-app`/`web-backend-storage`/`web-backend-entry` 残留（`40-cleanup-pgrep-r3.log`）；A/B 判定驱动的进程树按标记即杀，无孤儿编译。
- 证据包：`web-manual-items-integration-r3-evidence.tar.gz`（哈希见 `SHA256SUMS-r3.txt` 与随附清单）含前置、逐组 gate、A/B 三向与收尾全部编号日志；不含配对码/cookie/token（已扫描）。

## 11. 第四轮：manifest default-run 消歧修复接入（2026-11-08）

按队长派发（评论 `01a1b8dc-2640-7bd0-a4a4-0561cb8c08b4`）：OpenCode 先对 `91b78ed..e750302` 独立审查（不通过即止步回报、不代修），仅独审通过后以集成回执 `404a2bc` 为基点在同一 run 接入该两文件精确增量，按原唯一集成范围更新 admission/索引/回执并冻结新 SHA/tree，从头串行完整门禁（保留 51 组、预算与真实前置；真实应用打包由本轮第 47 组验证，不预先重复同版整组打包；新 Web 组仍用默认真实产物）。§4/§8/§10 三轮失败回执原样保留。

### 11.1 独立审查（先决条件，已满足）

- 审查者 OpenCode 未编写该 manifest 增量（由 I 作者 Claude 提交于 `e750302`）；判定**通过**（0 阻断、0 NIT），记录 `docs/reviews/web-manual-items-implementation-20261108-opencode-default-run-review.md`（本树 `afa0f5f`，评审索引 104→105）。
- 要点：增量恰 2 文件 +24/−1、补丁 SHA-256 `4b300494…77f83b3`、累计 `bc4b1c3..e750302` `a2c7d8d4…40fa9a6` 逐字节复算相符；`[package]` 仅追加裁定行 `default-run = "sidekick"`＋5 行注释，I 自有证据哈希表刷新＋纯追加 §10；边界核实：`Cargo.lock`/`tauri.conf.json`/`src-tauri/src/main.rs`/`src-tauri/src/bin/web-backend-storage.rs` 两版本 blob 完全相同，001/002 冻结 blob 不变，依赖段逐字节相同；`e750302` 导出树 `cargo metadata --no-deps` exit 0，`default-run: sidekick` 被接受且 bin targets 恰为 `sidekick`＋`web-backend-storage` 两个；完整打包签署按派发由本轮第 47 组完成。

### 11.2 接收与身份（全部实测逐字节相符）

- 修复提交 `e750302cdb1a6718b3260929707d351163015176`（tree `48aef46ca89dbe0f740d8466b4ec4163fea623f7`，父即 `91b78ed`）：增量恰 2 文件 +24/−1——`src-tauri/Cargo.toml`（blob→`922938c7…dba194a`）与 I 自有交付记录（blob→`517777d5…260a3e`，哈希表刷新＋纯追加 §10）。
- 接入方式：merge（merge-base 恰 `91b78ed`，已在集成树祖先，合并零冲突；合并 diff 恰为该 2 文件 +24/−1，`git diff HEAD^1 HEAD` SHA-256＝申报增量 `4b300494…`）。合并前实测两个目标文件与 `91b78ed` blob 同一；合并后与 `e750302` blob 同一（diff 空）——增量逐字节落在申报范围。
- 浏览器相关源码/配置一致性（相对回执 `404a2bc` 冻结树 `2e349ec3`）：本增量零改动 `src/`、`server/`、II 测试、`tauri.conf.json`、`package.json`、vite/测试配置与静态产物清单——除经审 2 文件与公共记录（本审查记录、索引行、本节）外 `git diff 2e349ec3 HEAD --name-only` 无其他文件。按任务描述「后继集成只有 manifest 主入口/公共记录改动且浏览器相关源码及配置保持一致时，可按精确差异核对沿用此旅程结果」的登记，本增量符合沿用条件；最终一致性结论与逐文件核对见 §12.4。
- admission：`build/web-manual-items-integration/admission-r4.json`（修改前登记：实际 pwd/branch/HEAD `afa0f5f`（直接立于 `404a2bc`）、基点祖先核对、接收增量与审查身份、写入清单、门禁计划；本轮 worktree 由平台重建，gitignored 历史证据不在，`npm ci --ignore-scripts` 已重跑 exit 0）。

### 11.3 第四轮冻结与完整门禁（原预算串行，冻结 SHA 上执行）

- 第四轮冻结提交＝本节随接入一起提交的公共记录提交；其 SHA/tree 于 §12 回执登记（gate 在该冻结提交上执行）。
- 前置与门禁计划同 §4/§9.3：冻结后从头真实准备构建前置（`npm ci --ignore-scripts` 已 exit 0、`probe:prepare-cli`、`probe:prepare-pi`，不以空目录/桩产物替代），核实 check 链尾含 `build:backend` 与 `test:web-manual-items`（第 50/51 组）后，在冻结提交上串行执行一次完整 `npm run check`——保留全部脚本、51 组、预算与默认产品 dist，不孤立预跑同版整套 Web 组，不以聚焦/打包绿证替代全门禁；逐组结果、exit、警告分类与未验项记入 §12。若仍失败，沿 §4.3/§8.3/§10.3 同一路径归因回报，不擅改 I/II。

## 12. 第四轮完整门禁回执（2026-11-08，冻结提交上串行执行）：**不通过（gate exit 1，第 51 组 `test:web-manual-items`）**——第三轮失败面第 47 组已转绿（`default-run` 修复闭合），第 48–51 组首次执行；第 51 组 42 用例 36 pass／5 fail＋1 cancelled，六项失败经源码级精确归因：3 项属候选 I 实现缺口、3 项属候选 II 测试缺陷（2 缺陷）

### 12.1 冻结与前置（全部实测）

- 冻结提交 `6bf69a3edcf9aa4be44013948c825f683f4eada4`，tree `60ba4a30b1e780c632142cbfb1c4ce73c64d3998`。gate 2026-11-08T02:05:31Z 启动、02:20:01Z 结束（日志 `61-check-full-r4.log`，`GATE_START`／`GATE_EXIT=1`／`GATE_END` 标记）。
- 前置（`60-prereq-r4.log`）：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` exit 0（lark-cli v1.0.98）；`probe:prepare-pi` exit 0（vendor/pi 按 `pi-source.json` 校验后真实构建，commit `ad702637`／tree `e89822b0`）。check 链尾核实含第 50 组 `build:backend`、第 51 组 `test:web-manual-items`（本轮未改 package.json）。

### 12.2 逐组结果与警告分类

| # | 组 | 结果 |
|---|---|---|
| 1–4 | `check:structure`、`check:docs`、`test:executable-copy`、`probe:bundle` | exit 0（逐组） |
| 5 | `typecheck` | exit 0（第一轮失败面保持绿） |
| 6–10 | s1/s2/s31/today/layout domain | exit 0（逐组） |
| 11 | `test:desktop-controls` | exit 0（第二轮失败面保持绿，9 用例） |
| 12–31 | pet 五组＋`check:pet-ui`＋ui-entries＋pet-native＋`check:pet-native`＋s32/s33 domain 五组＋mcp contract/http/recovery＋model-budget/output-diagnostics＋mcp-native-fetch | exit 0（逐组） |
| 32 | `check:rust`（fmt --check＋clippy -D warnings） | exit 0 |
| 33–37 | `check:s33-p2-runtime`、`test:s33-lifecycle`、`probe:runtime/card/contracts` | exit 0（逐组） |
| 38 | `probe:native`（cargo test --lib -- --test-threads=1） | exit 0（323 passed／0 failed／3 ignored） |
| 39–45 | `test:mcp-budgeted`、`probe:toolchain`、`test:s2-runtime`、`test:today-runtime`、inline s31/layout/s32-runtime | exit 0（逐组） |
| 46 | `probe:bundle-smoke` | exit 0 |
| 47 | `check:s33-p2-package` | **exit 0**——`build:s33-ui-verify` 真实 `tauri build` 产出 `Sidekick MCP Verify.app`（ad-hoc 签名替换成功）→ `probe:app` → `test:s33-ui-artifacts`；**第三轮 `failed to find main binary (package > default-run)` 失败面被本轮 `default-run = "sidekick"` 修复闭合** |
| 48 | `test:pet-ui-artifacts` | exit 0（第三轮未达，首次执行通过） |
| 49 | `test:mcp-native-launcher` | exit 0（同上） |
| 50 | `build:backend` | exit 0（真实产出 `build/web-backend/`：`bin/web-backend-storage` 存储二进制＋`static/` 前端 dist，第 51 组默认真实产物即来源于此） |
| 51 | `test:web-manual-items` | **exit 1——42 tests／36 pass／5 fail／1 cancelled（超时）**（第三轮未达，首次执行；失败归因见 §12.3） |

警告分类：全链仅两类既有类别，无新增——① vite「Some chunks are larger than 500 kB」（×3：`probe:bundle` 组、第 47 组 beforeBuildCommand、第 50 组 build:backend，W0 已知）；② tauri「Warn skipping app notarization」（×2：无 APPLE 凭据环境下的预期跳过，与历轮打包一致）。其余 `warn`/`-D warnings` 命中均为命令行文本或 clippy 参数。

### 12.3 第 51 组六项失败的精确归因（源码＋实测证据；按登记不代修，交队长归派原作者修订）

| # | 失败用例（文件:断言行） | 期望／实得 | 归因 | 机制证据 |
|---|---|---|---|---|
| F-1 | A-1/A-2 非法输入（`web-manual-items-http.test.mjs:234`，失败于 ：254 循环内『non-ISO instant』用例） | 400 `validation_failed`／200 成创建 | **候选 I 实现缺陷** | `server/lib/manual-items-service.mjs` `normalizePoint`（:69–71）以裸 `Date.parse` 解析 `at`；V8 对非 ISO `'2026-11-13 18:00'` 按服务器本地时区解析成功（本机 Asia/Shanghai → `2026-11-13T10:00:00.000Z`，与响应体逐字一致，机制独立复现）。契约 §4.2 TimePoint `at`＝「ISO 8601 UTC 毫秒」，非 ISO 输入应 400 |
| F-2 | A-2 不存在本机时刻（同文件 ：263，失败于 ：284） | 400／200 | **候选 I 实现缺陷** | `normalizePoint` 从不交叉校验 `(at, timeZone, localText)` 存在性/一致性。P2 矩阵 A-2（`docs/reviews/web-manual-items-readiness-20261108.md` §A-2）判据明示「夏令时空缺本地时刻被拒并明示『不存在』」、反例即「把 02:30 静默吸附到邻近时刻」；契约 §7 时间语义「沿用 `shared/dates.mjs`」——`zonedCandidates`（空集＝不存在／双解＝歧义）服务端未调用 |
| F-3 | A-8 重启恢复（`web-manual-items-restart.test.mjs:79`，失败于 ：139） | 完成时间戳保留／实得时间戳 vs 期望 null | **候选 II 测试缺陷（假阴性）** | 断言 `restoredAction.completedAt === action.completedAt`，而 `action` 是 **create 响应**（`completedAt` 恒 null，:83–84），complete 响应（:85–88）未捕获更新引用；正确实现下该断言恒假。实测 `2026-11-08T02:19:41.108Z` 恰为完成时刻——实现把 completedAt 正确持久化并在重启后保留，恰是断言声称要验证的性质 |
| F-4 | A-8/M2 重连重置（同文件 ：176，20s 超时） | 旧 epoch `Last-Event-ID` 重连收到 `stream.reset`／帧从未到达 | **候选 I 实现缺口** | `server/lib/sse-hub.mjs` `addClient` 只发 `stream.ready`；`server/` 全目录 0 处读取 `last-event-id`、0 处出现 `stream.reset`（grep 实测）。冻结 web-api/1 §6（`web-api-contract.md:249`）：「epoch 变化：令牌 epoch ≠ 当前实例 epoch…服务端先发一帧 `stream.reset`」；W1 契约 §5（:182）「`stream.ready`/`stream.reset` 的 cursor/epoch 语义完全不变」 |
| F-5 | 浏览器冷启动 1440px（`web-manual-items-static.test.mjs:147`） | crossOriginRefs=[]／[1 条 `data:image/svg+xml`] | **候选 II 测试缺陷（假阳性）** | `browser-probe.mjs` PAGE_PROBE 以 `new URL(value, location.href).origin === location.origin` 判同源；`data:` URI 的 origin 为字面量 `'null'` 被误判跨源（独立复现）。该 URI 来自 `src/components/PairingGate.vue` `<img :src="mark">`（`src/assets/brand/sidekick-mark.svg` 经 vite 内联）——W0 既有产品资产，内联内容不发网络请求，非跨源引用 |
| F-6 | 浏览器冷启动 640px（同文件 ：147） | 同上 | 同 F-5 | 同一探针逻辑同一资产，宽窄两档双 false-positive |

归因汇总：**候选 I 3 项**（F-1 时间格式校验、F-2 存在性校验、F-4 epoch 重置帧）→ 须 I 作者 Claude 在原 I 范围修订＋独审；**候选 II 2 项缺陷致 3 项失败**（F-3 过期引用断言、F-5/F-6 data: URI 误判）→ 须 II 作者 Kimi 在原 II 测试范围修订＋独审。集成组装零偏离：本轮回执 `6bf69a3` 相对第 4 轮接入前目标文件 blob 与 `e750302` 逐一相同（§11.2），失败均不源于组装。

### 12.4 浏览器相关源码/配置一致性（相对第 4 轮基点回执 `404a2bc`，冻结树 `2e349ec3`）

`git diff 2e349ec3 6bf69a3 --name-only` 实测恰 5 文件：`src-tauri/Cargo.toml`（manifest 消歧行，非浏览器路径）、`docs/reviews/web-manual-items-implementation-20261108.md`（I 证据）、`docs/reviews/web-manual-items-implementation-20261108-opencode-default-run-review.md`（审查记录）、`docs/reviews/README.md`（索引）、`docs/reviews/web-manual-items-integration-20261108.md`（回执）。`src/`、`server/`、`tests/`、`src-tauri/tauri.conf.json`、`package.json`、`vite.config.ts` 与静态产物清单零改动。按任务描述登记（「后继集成只有 manifest 主入口/公共记录改动且浏览器相关源码及配置保持一致时，可按精确差异核对沿用此旅程结果」），**本增量符合 OhMyPi 浏览器旅程结果沿用的精确差异条件**；沿用与否及其签署权在 OhMyPi（其验收并行进行中，本集成不代签）。

### 12.5 未验项与准出判定

- **W1 仍不准出**：第 51 组 6 项失败未闭合，任何旧 SHA 绿证不得沿用；I/II 修订各自独审通过后，由唯一集成者再冻结新版本从头重跑完整 `npm run check`（第 51 组届时按修订范围复验）。
- 本轮已真实验证面（供后续轮引用）：第 47 组真实打包在含 `default-run` 的 manifest 上 exit 0；第 48–50 组（pet-ui-artifacts、mcp-native-launcher、build:backend 真实打包）首次执行全部通过；`probe:native` 323/0/3。
- 完整浏览器业务旅程独立验收：OhMyPi 对 `404a2bc` 快照进行中，结果由其自行签署（并行，未签）。
- Linux/代理、真实凭据/真实用户工作根/真实模型：授权边界外，未涉及。

### 12.6 收尾

- 自建进程：gate 进程随第 51 组失败退出；`pgrep` 复核本树（`mayne-23-ad9709fb52de`）无 `cargo`/`rustc`/`build-app`/`web-backend-storage`/`web-backend-entry`/headless Chrome 残留（`70-cleanup-pgrep-r4.log`）。
- 并行说明：pgrep 中可见的 `web-backend-storage`×4 与 headless Chrome×多 例属于并行 OhMyPi 浏览器验收 run（其树 `mayne-23-d94e04dd568b` 与其任务临时目录），以及其它 agent 的运行时进程；均非本 run 自建，本集成未触碰、由其各自收尾。
- 证据包：`web-manual-items-integration-r4-evidence.tar.gz`（哈希见 `SHA256SUMS-r4.txt` 与随附清单）含前置、逐组 gate、失败详情与收尾编号日志；不含配对码/cookie/token（已扫描）。
