# W0 最终集成：接入已审 F-1 修订与两份复核记录，形成唯一重门禁候选（2026-11-07）

- **范围与风险级**：MAYNE-22 W0 最终集成轮。在已通过独立审查的准备候选 `882e6e3` 上逐字节接入已复核的 F-1 修订增量与两份复核记录，修正已指出的链接计数，更新公共文档 F-1 事实状态，形成冻结提交后由唯一集成执行者串行跑原预算完整门禁。风险级：中低——生产文件为已审提交的逐字节副本，守卫零改动；新增内容为记录与状态注记。
- **执行者 / 独立评审**：执行者 OpenCode（唯一重门禁执行者，队长评论 `01a1b69d-83e8-76f8-885d-d10bb71746bf` 派发）；F-1 修订与准备候选分别由 ZCode（`f758e53`）、Kimi（`70d7a01`）独立复核通过，本记录不代签新实现。
- **基点与登记**：`882e6e380ef483be77e9c1f00ea113671bf92b48`（分支 `agent/opencode/mayne-22`；父 `b11fd05` ← `7f536db` ← `8bd29c4`，祖先核对通过）。登记先行：`build/web-foundation-integration/admission.json`（pwd、branch、HEAD、接收版本/哈希、写入清单、门禁约定），登记先于任何修改。

## 1. 接入清单与逐字节核实

全部文件以 `git checkout <commit> -- <path>` 取自共享对象库中的审定提交；staged blob 与源提交逐一比对相等（机械证明，见 `build/web-foundation-integration/final-identity-hashes.txt`）：

| 文件 | 来源提交 | 核实 |
|---|---|---|
| `src-tauri/src/store/web_backend_schema.rs` | `cab73aa` | blob 与 `cab73aa` 相等；增量恰 +14/−2（validate 先于 configure_connection） |
| `src-tauri/src/store/web_backend_schema_tests.rs` | `cab73aa` | blob 相等；增量恰 +119/−1（新增 5 例回归，共 17 例） |
| `docs/reviews/web-foundation-integration-schema-implementation-20261107.md` | `cab73aa` | blob 相等；实施记录含 F-1 修订章节 |
| `docs/reviews/web-foundation-integration-schema-integration-prep-20261107-kimi-review.md` | `70d7a01` | blob 相等；准备候选独立审查记录（通过） |
| `docs/reviews/web-foundation-integration-schema-implementation-20261107-zcode-f1-review.md` | `f758e53` | blob 相等；F-1 修订独立复核记录（通过） |

四生产文件与 `cab73aa` 逐字节一致的 blob 级证明：`001_web_backend.sql`、`web_backend_schema.rs`、`web_backend_schema_tests.rs`、`local_store.rs` 四个 blob 在本树与 `cab73aa` 完全相等；`git diff cab73aa -- <三个 F-1 变更文件>` 为空。DDL 字节未变：SHA-256 复算 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`，与守卫冻结值及审定 DDL 一致。F-1 增量补丁复算：`git diff 67860d3 cab73aa | shasum -a 256` = `99706d935225cf40279c72947e6586fdcb56f3efbf808892f5e0856d328ae587`，与队长派发及 ZCode 复核值逐字符一致（恰 3 文件 +161/−3）。守卫 `scripts/checks/check-structure.mjs` 本轮零改动；`8bd29c4`/`b11fd05` 已接收内容零覆盖（本提交相对 `882e6e3` 的增量只含上表五文件、链接计数两处修正、索引与状态注记）。

## 2. 已指出项修正与公共文档事实状态

- **链接计数（Kimi NIT）**：`web-foundation-integration-schema-integration-prep-20261107.md` §4 表与 `docs/reviews/README.md` 对应索引条目的 `check:docs` 计数 `20/414` → `20/424`（414 为基座 `b11fd05` 值，候选实测 424；两种计数下均 exit 0，仅修正陈旧数字，不改写结论）。
- **公共文档 F-1 状态**：`docs/product/05`（头部注记、总览四类记账、W0 队列行）与 `docs/engineering/web-backend-design.md`（两处带日期注记）更新为已验证事实——`cab73aa` 通过 ZCode 独立增量复核、`882e6e3` 通过 Kimi 独立审查、修订与复核记录已接入最终候选；完整门禁在本冻结提交上执行、结果以回执与 `build/` 证据为准，不预签。`docs/engineering/architecture.md` 核对无 F-1 陈旧表述（其带日期注记仍准确），本轮零改动。均未合入 main 的事实保持不变。

## 3. 冻结前聚焦验证（实际命令与退出码）

前置按仓库既有命令准备（全部 exit 0）：`npm ci --ignore-scripts`、`npm run probe:prepare-cli`（lark-cli v1.0.98）、`npm run probe:prepare-pi`（vendor/pi `ad702637` / tree `e89822b0…3c68`，与登记一致）、`npm run probe:bundle`。

| 命令 | 结果 |
|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | exit 0 |
| `cargo check --lib --manifest-path src-tauri/Cargo.toml` | exit 0 |
| `cargo test --lib web_backend_schema --manifest-path src-tauri/Cargo.toml` | exit 0，**17 passed / 0 failed**（与 ZCode 对 `cab73aa` 真树复跑一致） |
| `node scripts/checks/check-structure.mjs` | exit 0（215 文件 / 466 引用） |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0（含既有迁移冻结正/负断言） |
| `npm run check:docs` | exit 0（20 文件 / 429 链接；含本记录与两份复核记录新链接） |
| `git diff --check` | exit 0 |

## 4. 完整门禁执行约定（本记录不预签）

本记录随冻结提交先于门禁入库。完整门禁为该冻结提交上的单次串行 `npm run check`：原预算（`package.json` 原值，不改 `--test-timeout`）、不重试、不改预算；完整原始日志、真实退出码、测试计数、警告分类、哈希清单写入 `build/web-foundation-integration/` 并随交付评论附件留存。**门禁结果以本轮回执为准**；通过与否均如实回报，失败不盲目重试。门禁后已测跟踪树冻结（不再改动跟踪文件）。旧 R5 绿证（`8bd29c4`）只签其原版本，不预支本候选。

## 5. 未验证项与边界

- **完整门禁结果待回执**（正在本冻结提交上执行）；**未合入 main**（main 保持 `8bd29c4`）、**未 push**、分支清理未发生（均由队长按 owner 既有授权接续）。
- Linux/代理部署、真实凭据、真实工作根、真实模型保持原未验状态；NIT N-1–N-4 维持 ZCode 登记不修；W1 保持 backlog。
- 聚焦 cargo 证据为冻结前抽样；最终版本以门禁完整日志为唯一绿证依据。

## 6. 结论

**pass（限本集成增量）**：F-1 修订与两份复核记录逐字节落地，四生产文件与 `cab73aa` 逐字节一致，DDL/守卫冻结与已审版本一致，已指出链接计数已修正，公共文档与事实一致且不预签门禁。完整门禁按 §4 约定执行，结果以回执为准。
