# W0 最终集成准备：接入已审 schema 候选、最终提案、审查记录与迁移哈希冻结（2026-11-07）

- **范围与风险级**：MAYNE-22 W0 最终集成准备轮（与 Claude 的 F-1 最小修正并行）。只接审定路径、补守卫精确冻结与公共记录；不动共享 main、不跑完整重门禁。风险级：中低——生产文件为已审候选的逐字节副本，新增行为为零；守卫改动限于一条精确冻结与原地自测。
- **执行者 / 独立评审**：执行者 OpenCode；本准备候选的独立评审由队长在收到精确交付后另行派发（Kimi 或 OhMyPi，未参与本增量）。派发指令见任务触发评论 `01a1b682-2430-7b0b-9649-78c442f595fc`。
- **基点**：`b11fd059db1c1e60882084ef56ec8ff70738ae4c`（分支 `agent/opencode/mayne-22`；父 `7f536db` ← `8bd29c4`）。基点树 `0c69de9f…7304` 与 Kimi 评审记录一致。登记先行：`build/web-foundation-integration/admission.json`（含 pwd、branch、HEAD、接收版本/哈希与写入清单）。

## 1. 接入清单与逐字节核实

全部文件以 `git checkout <commit> -- <path>` 取自共享对象库中的审定提交，staged blob 与源提交逐一比对相等（机械证明，见 `build/web-foundation-integration/prep-identity-hashes.txt`）：

| 文件 | 来源提交 | 核实 |
|---|---|---|
| `src-tauri/migrations/web-backend/001_web_backend.sql` | `67860d3` | SHA-256 `8511907c…143d` 与审定 DDL 一致 |
| `src-tauri/src/store/web_backend_schema.rs` | `67860d3` | SHA-256 `324e62eb…2ec1` 与交付声明一致 |
| `src-tauri/src/store/web_backend_schema_tests.rs` | `67860d3` | SHA-256 `1f1224a4…7b8a` 与交付声明一致 |
| `src-tauri/src/store/local_store.rs` | `67860d3` | SHA-256 `25d78ddf…3592e`（恰 10 行模块/测试登记与 re-export）；`lib.rs:29–30` 既有 `#[path]` 注册未动 |
| `docs/reviews/web-foundation-integration-schema-implementation-20261107.md` | `67860d3` | 实施记录原文 |
| `docs/reviews/web-foundation-integration-schema-authorization-20261107.md` | `598d2da` | 最终提案，内容 SHA-256 `bc8876c3…f706` 与登记一致 |
| `docs/reviews/web-foundation-integration-schema-authorization-20261107-zcode-review.md` | `86b7300` | 提案首轮独立评审（R1） |
| `docs/reviews/web-foundation-integration-schema-authorization-20261107-zcode-r2-review.md` | `f0eaee3` | 提案修订增量独立复核（R2） |
| `docs/reviews/web-foundation-integration-schema-implementation-20261107-zcode-review.md` | `ac2601d` | 实施独立评审：通过，1 MINOR（F-1）+ 4 NIT |
| `docs/reviews/web-foundation-integration-main-ff-20261107-kimi-review.md` | `49d2152` | main 快进增量独立审查：通过 |

候选补丁复算：`git diff 598d2da 67860d3 | shasum -a 256` = `c3fe7148e2cac266c03b936f6a2bbe391341ee8f63836759e8962c2455405da2`，与登记接收值一致。基座 `8bd29c4` / 已审公共文档 `b11fd05` 内容全部保留（`git diff b11fd05 598d2da -- src-tauri/` 为空，接入无覆盖冲突）。

## 2. 守卫：新迁移精确哈希冻结 + 原地自测

`scripts/checks/check-structure.mjs` 仅两处增量（不扩其它路径规则，既有 001–004 冻结值不动）：

1. `IMMUTABLE_MIGRATIONS` 新增 `src-tauri/migrations/web-backend/001_web_backend.sql → 8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`；违规提示语同步为覆盖 web-backend/1。
2. `--self-test` 原地补冻结断言：合成树先载入仓库内原字节（缺文件则自测失败），断言不产生违规；再篡改新迁移字节重跑 collect，断言 `schema.immutable-migration` 恰好命中该路径。

实际命令与退出码（完整输出见 `build/web-foundation-integration/prep-guard-logs.txt`）：

- `node scripts/checks/check-structure.mjs`：接入原字节 + `npm run probe:prepare-pi` 后 **exit 0**（215 文件 / 466 引用，与 R5/Kimi 证据同规模；prepare-pi 报 vendor/pi `ad702637` / tree `e89822b0…68` 与登记一致）。prepare-pi 前为已知 3×`ref.missing`（同三个 s32 文件，前置缺失，非本轮引入）。
- `node scripts/checks/check-structure.mjs --self-test`：**exit 0**（22 违规类 + 8 引用负例；新增冻结断言生效：原字节通过、篡改字节被标记）。
- 真树篡改负例：向新迁移追加字节后运行守卫 → **exit 1**，`schema.immutable-migration` 命中 `web-backend/001_web_backend.sql`；`git checkout --` 还原后 SHA-256 复归 `8511907c…143d`。
- 既有迁移冻结回归：self-test 内 `001_todos.sql` 篡改负例继续被检出（22 类含 `schema.immutable-migration`）。

## 3. 索引与公共文档

- `docs/reviews/README.md`：新登 7 条（本记录、实施 ZCode 评审、实施记录、Kimi main-ff 评审、提案 R2/R1、最终提案），计数 75 → 82，既有条目零改动。
- `docs/product/05`：总览与 W0 队列行更新——已验证（`67860d3` 独立评审通过、F-1/NIT 如实登记）、正在实施（F-1 修正与本准备候选并行）、待办（F-1 增量复核 → 接入后唯一集成执行者重跑完整门禁 → 统一提交/合入/清理）；历史章节零改动。
- `docs/engineering/web-backend-design.md`、`architecture.md`：仅更新带日期状态注记（提案文件已落地、冻结已登记、未合入未终验）；既有事实零删除。
- `docs/README.md`：核对后无需改动。

## 4. 本轮聚焦验证汇总

| 命令 | 结果 |
|---|---|
| `node scripts/checks/check-structure.mjs`（prepare-pi 后） | exit 0，215 文件 / 466 引用 |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0（含新冻结正/负断言） |
| 真树篡改新迁移负例 | exit 1，规则命中新路径；还原后哈希复归 |
| `npm run check:docs` | exit 0（20 文件 / 424 链接） |
| `git diff --check` / `git diff --cached --check` | exit 0 |
| blob / SHA-256 / 补丁哈希核实 | 全部与审定值一致 |

**完整 `npm run check` 本轮未跑**：按登记留给 F-1 修订接入后的唯一集成执行者，在实际最终版本串行新跑；R5 绿证不预支新 schema。

## 5. 未验证项与边界

- **F-1 未闭合**：`67860d3` 的拒绝路径 WAL 改写（MINOR）由 Claude 修正中；本准备候选接入的是已审原字节，不含修订。
- **最终门禁未跑**、**未合入 main**（main 保持 `8bd29c4`）、**未 push**、分支清理未发生。
- 本树未重跑 `cargo check/test/clippy`：落地 Rust 文件与候选 `67860d3` 的 `src-tauri` 逐字节一致，Claude 候选内聚焦 cargo 证据（fmt/check/test 12/12/clippy 全 exit 0）按字节同一性适用；最终版本仍须完整门禁实证。
- Linux/代理部署、真实凭据与真实工作根保持原未验状态。
- 原始证据留存：`build/web-foundation-integration/`（gitignored），关键日志随交付评论附件保存。

## 6. 结论

**pass（限本准备增量）**：已审候选、最终提案与审查记录逐字节落地；新迁移精确哈希冻结与自测正/负例生效；索引与公共文档与事实一致且明确 F-1/最终门禁未闭合。后续：F-1 修订独立复核通过后接入本树，唯一集成执行者跑新完整门禁，再按 owner 既有授权统一提交/合入/清理。
