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

- 冻结提交 `a02bfef2945bc7c147eef14746a14f180a9c2578`，tree `5fe0b3907b83d95b7d722280c437ffde6cf467eb`；gate 于 2026-11-08T00:19Z 启动、00:26:57Z 结束。
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

