# W1 manifest default-run 消歧增量独立审查（OpenCode，2026-11-08）：通过

- 审查对象：`91b78ede9f072598b7879aa461cdc03625ac1ccf..e750302cdb1a6718b3260929707d351163015176`（Claude 的 Task I manifest default-run 消歧增量，父提交即 `91b78ed`）。
- 判定依据：集成第三轮回执 §（第 47 组 `check:s33-p2-package` 失败归因：候选 I 已批 `[[bin]] web-backend-storage` 使包内出现两个 bin 且无 `package.default-run`，`tauri build` 报 `failed to find main binary…`）与队长派审要求（评论 `01a1b8dc-2640-7bd0-a4a4-0561cb8c08b4`，含任务描述「第三轮门禁接力」登记的裁定：`[package]` 仅补 `default-run = "sidekick"`）。
- 审查者：OpenCode（III 工程作者兼唯一集成者；本 manifest 增量未参与编写——增量交付与提交均由 I 作者 Claude 完成，`e750302` 在其候选链上，无利益冲突）。
- 边界：只审本增量；候选只读（`git archive` 导出沙箱临时树核验，全程不改候选字节）；不代修、不豁免守卫、不改 I/II/III 交付字节。真实完整打包验证按派发授权由本轮集成第 47 组在同一冻结版本执行，本审查不做同版整组打包的预先重复。

## 结论：**通过**（0 阻断；0 NIT——申报身份、增量构成、边界与消歧语义逐项独立复算全部属实）

## 1. 版本与身份（全部实测相符）

| 项 | 申报 | 实测 | 一致 |
|---|---|---|---|
| `e750302` 父提交 | `91b78ede` | `91b78ede9f072598b7879aa461cdc03625ac1ccf` | ✓ |
| `e750302` tree | `48aef46ca89dbe0f740d8466b4ec4163fea623f7` | 同左（`git rev-parse ^{tree}`） | ✓ |
| 增量补丁 SHA-256（`git diff 91b78ed e750302`） | `4b3004942e957ed0c419affd8022fff4e1aa58d6f14069daa142fc56e77f83b3` | 同左（逐字节复算） | ✓ |
| 累计补丁 SHA-256（`git diff bc4b1c3 e750302`） | `a2c7d8d4bb36560d6da7a6808cc7c834905fc86d0740d8dea8b2eb86a40fa9a6` | 同左（逐字节复算） | ✓ |
| `format-patch` SHA-256（申报未含，本审查补记） | — | `0de4035b905aec2694b2a8c0351535212e0760fe5095ef323e76aea300525c31` | — |
| 链完整性 | 父即 `91b78ed`，无 squash/amend/rebase | `bc4b1c3..e750302` 七个提交均单父线性；`6546990` 为 `e750302` 祖先；`74c023c`/`4052d47`/`4ca9344`/`ff5d6c2`/`91b78ed` 全部为祖先 | ✓ |

## 2. 增量构成与写入范围（恰 2 文件，+24/−1）

| 文件 | 变化 | SHA-256（在 `e750302` 实测） | 范围 |
|---|---|---|---|
| `src-tauri/Cargo.toml` | +6/−0，`[package]` 内追加 5 行注释＋`default-run = "sidekick"` | `922938c7d58d86b70b72317d6be7f51b20e358cdd6d292a919c9e1f50dba194a` | 与申报逐字节一致 |
| `docs/reviews/web-manual-items-implementation-20261108.md` | +18/−1（哈希表行刷新＋纯追加 §10） | `517777d5ee1cd62027b3ca6f576e6043d84ba2b1df73c2054f1dc54484260a3e` | I 自有证据路径 |

- 第 1 文件与裁定精确一致：插入位置在 `[package]` 段（`rust-version = "1.89"` 之后、`[lib]` 之前），语义即任务描述裁定的 `package.default-run="sidekick"`；`git diff 91b78ed e750302 -- src-tauri/Cargo.toml` 全文核对仅此一 hunk，`diff`（91b 版 vs e750 版）除该块外零差异。
- 第 2 文件为 I 自身交付记录：Cargo.toml 哈希表行 `99ac5709…`→`922938c7…`（两值分别等于 91b78ed/e750302 两版 Cargo.toml 的实测 SHA-256，逐字节相符）与 §10 纯追加，落在 I 允许的 `docs/reviews/web-manual-items-implementation-*.md` 证据范围内。
- 除这 2 文件外无任何改动：`git diff --numstat` 仅此 2 行；`server/`、`src/`、II 测试、III 工程/公共文件零触碰；`git diff --check` 干净（exit 0）。

## 3. 边界核验（默认/显式两个 bin、锁/标识/依赖）

- **两个 bin 且主次分明**：`src-tauri/src/main.rs`（隐式 `sidekick` 主 bin，blob `c4677148…`）与 `src-tauri/src/bin/web-backend-storage.rs`（已批显式存储 bin，blob `73b10884…`）在 `91b78ed`→`e750302` 两版本 blob 完全相同、零改动；`Cargo.toml` 仅一处 `[[bin]]`（`web-backend-storage` → `src/bin/web-backend-storage.rs`），依赖段逐字节不变。
- **锁/标识不变**：`src-tauri/Cargo.lock` 两版本 blob 相同（`e0184154…`）；`src-tauri/tauri.conf.json` blob 相同（`9c0eab4c…`，identifier 不动）。`default-run` 是包级元数据字段，不影响依赖解析（锁文件不含该字段），与「零新增生产依赖、不改锁/标识」边界相符。
- **冻结 DDL/契约未触碰**：001（blob `93b0ed00…`）、002（blob `874c6049…`）两版本 blob 相同；契约（含附录A，`32910de7…`）与授权清单（`242ea3db…`）为集成树 III 公共文件，候选链上不存在，本增量 2 文件范围不可能触碰（在集成树复核值与第一轮回执登记值一致）。
- **TOML/解析有效性**：在 `e750302` 导出树实测 `cargo metadata --no-deps`：exit 0，`sidekick 0.3.0`，`default-run: sidekick`，bin targets 恰为 `sidekick` 与 `web-backend-storage` 两个（其余为 lib/example/custom-build，与基线一致）——消歧字段被 cargo 正确接受且指向桌面主入口。
  - 补记：同导出树 `cargo metadata --locked --offline` 因本机离线无法下载 `async-broadcast v0.7.2`（exit 101）——环境网络限制而非 manifest 缺陷；锁一致性由「Cargo.lock blob 相同＋依赖段逐字节相同」结构性覆盖。
- **与第三轮回执失败机制闭合**：第三轮 A/B 已证「两个 bin 且无 default-run → `tauri build` 报 `failed to find main binary…`（第 47 组逐字错误）」「补 default-run → 解析通过」（throwaway 机制证据）；本增量正是把该已证机制落为候选字节。作者侧申报的整组验证（真实 `check:s33-p2-package` exit 0；移除该行 → `build-app.mjs` exit 1 逐字同构错误；`cargo build --bin web-backend-storage` exit 0）与本审查静态/解析证据方向一致；最终打包签署按派发由本轮集成第 47 组在冻结版本上完成。

## 4. 接入精度预检（集成同一 run 接续）

- 集成树（本树 HEAD `404a2bc`）`src-tauri/Cargo.toml` blob ＝ 候选 `91b78ed` 版 blob（`cf7d6dee…`）；I 证据文档 blob 同样相等（`9b582921…`）。
- 字节级重构验证：本树两文件＋本增量插入块 ＝ `e750302` 两文件逐字节相同——即接入后的合并差异恰为本审查通过的两文件增量，无任何漂移。

## 5. 处置

- 审查通过。按派发授权（评论 `01a1b8dc`），集成轮在同一 run 以集成回执 `404a2bc16a6e341687732290b0313d5a3968c793` 为基点接入该两文件精确增量，更新 admission/索引/回执并冻结新 SHA/tree，从头串行执行完整 `npm run check`（保留 51 组、预算与真实前置；真实应用打包由本轮第 47 组验证）；结果与逐组回执见 `docs/reviews/web-manual-items-integration-20261108.md`。
- 本审查不代修、不重开 I/II 任何已审未改结论；ZCode R1–R3/OhMyPi R1–R2/Kimi 公共审查与本参数/alias 两轮 OpenCode 独审的原结论全部沿用。OhMyPi 浏览器旅程验收并行进行，其结果由其自行签署，本审查/集成不代签。
- 未验项：完整重门禁 51 组与真实打包在第 47 组的签署属集成轮（本审查不预先重复）；Linux/代理、真实凭据/真实用户工作根/真实模型在授权边界外。

原始证据：`build/web-manual-items-default-run-review/`（gitignored：admission.json、01-env、02-identity-hashes、03-boundary、04-cargo-metadata、05-increment.patch、06-ancestry），随集成证据包归档哈希。
