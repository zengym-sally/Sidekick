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

- [待回执] 命令／exit／逐组计数／警告分类／未验项。

## 5. 未验项与边界

- 完整浏览器业务旅程与集成公共增量的独立验收：按登记由未参与实现者在明确集成版本另行执行，本记录不代签。
- main 合入与分支清理：留队长按既有 owner 授权另次确认精确版本后执行；本集成不 push、不改任务状态。
- Linux/代理、真实凭据/真实用户工作根/真实模型：授权边界外，未涉及。
- 集成后如任何业务/测试变更，须再独审并重跑相应门禁，不得以旧 SHA 绿证覆盖。
