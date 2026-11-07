# MAYNE-22 W0：main 快进 8bd29c4 与守卫/公共文档准备（2026-11-07）

## 1. 范围与风险级

- **范围**：owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`（2026-11-07）授权全新建表方案并要求完成后本地提交、合入 main、清理分支；队长按该授权派发（触发评论 `01a1b64d-0596-7834-88dd-caa2bcff23af`）两项并行工作——Claude 实施四文件 schema/runner/测试，OpenCode 执行共享 main 快进与守卫/公共文档准备。本记录覆盖 OpenCode 部分。
- **风险级**：本轮唯一共享写动作是本地 main 快进（`--ff-only`、无新提交、不 push），前置条件收紧为「干净 main 且恰为核实的 `9ad2d61`」；其余全部为文档与守卫核对，不改生产代码。新 schema 的四文件由 Claude 在其隔离树交付，本记录不代签其完成。

## 2. 基点与登记

- 本工作树：branch `agent/opencode/mayne-22`，HEAD `7f536db3d0d130f762421be3fe1d55cb2fec5309`（= 候选 `8bd29c4` + R5 完整门禁记录），工作区仅平台注入的 AGENTS.md 块与 `.multica/`、`.opencode/` 元数据，零实现改动。
- 接收核对（修改前复算，全部一致）：候选 `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`，tree `c6f20de7a5e92b6cc41268c8c254a24620388c6f`，集成补丁 sha256 `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e`（`git diff eb431cb 8bd29c4` 复现）；祖先核对 `9ad2d61`→`8bd29c4`、`85feb8a`→`8bd29c4` 均通过。
- schema 最终提案 `598d2daf9db8ab66c9760c585af7045f87eac466`：提案 SHA-256 `bc8876c3e705e6ca1fbe83605e48e9af6c366945e561f0954c1ca2c906d9f706`，DDL SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`（ZCode R2 增量复核通过；本轮不重审、不实施）。
- admission 登记先于全部修改：本树 `build/web-foundation-integration/admission.json`（gitignored，随评论附件交付）。

## 3. 共享 main 快进（已验证事实）

前置核实：`/Users/zengym/workspace/projects/ai/sidekick`（与本树共享对象库）检出 main、HEAD 恰为 `9ad2d61e4665d2515d6fcb9f444b3ec884d6127d`、`git status --porcelain` 为空、main 仅在该主检出使用。

| 步骤 | 命令 | 结果 |
|---|---|---|
| 快进 | `git merge --ff-only 8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`（在主检出） | Fast-forward `9ad2d61..8bd29c4`，exit 0，未创建任何新提交 |
| 快进后 | `git rev-parse refs/heads/main` | `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3` |
| 内容互证 | `git rev-parse refs/heads/main^{tree}` | `c6f20de7a5e92b6cc41268c8c254a24620388c6f` ＝ 候选 tree，逐字节一致 |
| 工作区 | `git status --porcelain` | 空（0 条） |
| 文档检查 | `node scripts/checks/check-docs.mjs`（main 上，只读） | exit 0（20 文件 / 408 本地链接） |

原始日志：本树 `build/web-foundation-integration/main-ff-20261107.log`。未 push；本轮不合并任何 schema 实施。

## 4. 结构守卫评估：无需改动（核实结论）

登记允许为精确新授权路径同步守卫规则，并要求先核实是否需要。逐条核对既有规则后结论：**已有规则足够，`scripts/checks/check-structure.mjs` 本轮零改动**。

- `layout.src-tauri-top` 只收敛 `src-tauri/src/` 第一层（`lib.rs`、`main.rs`、`app/`、`store/`、`host/`、`diagnostics/`）——`web_backend_schema.rs`、`web_backend_schema_tests.rs` 落在已允许的 `store/` 内。
- `src-tauri/migrations/` 没有顶层收敛规则；新子目录 `web-backend/001_web_backend.sql` 不触发任何布局违规。`IMMUTABLE_MIGRATIONS` 只固定既有 001–004，新 lineage 文件不在其内，也不应现在登记（文件尚未存在，预设哈希会直接打红门禁；合入后是否冻结由最终集成轮决定）。
- 守卫的相对引用扫描（`SCAN_TOPS`）不覆盖 `src-tauri`，`.rs`/`.sql` 不在引用语法内，新文件不产生引用检查面。

**合成树实证**（不触碰任何真实工作树）：

| 用例 | 内容 | 结果 |
|---|---|---|
| 正例 | 独立合成 git 仓库含四个精确新路径占位文件 + 既有 001–005 原字节 | `node scripts/checks/check-structure.mjs` exit 0 |
| 负例 1 | 同仓库加意外顶层目录 `randomtool/` 与 `src-tauri/src/loose.rs` | exit 1，`FAIL [top.dir]` + `FAIL [layout.src-tauri-top]` 均检出 |
| 负例 2 | 追加篡改既有迁移 `001_todos.sql` 字节 | exit 1，`FAIL [schema.immutable-migration]` 检出 |
| 复原复跑 | 恢复后重跑 | exit 0 |

日志：`build/web-foundation-integration/probe-positive.txt`、`probe-negative.txt`、`probe-negative2.txt`。守卫 `--self-test` 全量负例另行在本树复跑（见 §6）。

## 5. 公共文档增量（区分已授权 / 正在实施 / 已验证）

- `docs/reviews/README.md`：仅补登记两条——本记录，及上轮 R5 完整门禁记录 `web-foundation-integration-fullgate-20261107.md`（当时写入清单不含索引，本轮补登）；更新索引计数；既有条目零改动。
- `docs/product/05-第一阶段实施计划.md`：仅更新顶部 as-of 与「当前实施总览」至 2026-11-07——已验证（候选评审+完整门禁绿证+main 快进）、已授权（全新建表、提交/合入/清理）、正在实施（四文件 schema，未验证未合入）、待办（实现独立评审→最终版本完整门禁→统一提交/合入/清理）逐项分开表述；W0 队列行同步。历史章节零改动。
- `docs/engineering/web-backend-design.md`：仅在头部与 §5 增加带日期的状态注记（web-backend/1 lineage、`data/web-backend.sqlite`、11 表含 `task_result_payloads`、实施中未合入）；设计正文与历史表述零改动。
- `docs/engineering/architecture.md`：仅在 §2「历史迁移字节」条目追加新 lineage 路径的授权状态与「守卫无需新规则」核实结论；其余零改动。
- `docs/README.md`：核对后无需改动——「目标尚未实现」的表述在当前事实下仍准确（新后端未合入），文档地图不因单轮记录变化。

文档不提前签署新 schema 完成：所有实施中表述均显式标注「未验证、未合入」。

## 6. 本轮验证（实际命令与退出码）

| 命令 | 位置 | 结果 |
|---|---|---|
| `git merge --ff-only 8bd29c4`（前置核实后） | 主检出（main） | exit 0，`9ad2d61→8bd29c4`，tree 互证一致 |
| `node scripts/checks/check-docs.mjs` | main | exit 0（20 文件 / 408 链接） |
| `npm run probe:prepare-pi`（仓库既有构建前置，不改 vendor 源码） | 本树 | exit 0；vendor/pi 源 `ad702637`/tree `e89822b0…` 与登记一致。就绪前守卫按预期报 3×`ref.missing`（同三个 s32 文件，与 R5 记录的前置缺失状态一致），非本轮改动引入 |
| `npm run check:structure`（真实仓库守卫，含 `--self-test`） | 本树 | exit 0（self-test 22 类 + 8 引用负例；全查 215 文件 / 466 引用，与 R5 记录值一致） |
| `npm run check:docs` | 本树 | exit 0（20 文件 / 414 链接，较快进后 main 的 408 增加 6 条为本轮新增文档链接） |
| `git diff --check`（工作区与暂存增量） | 本树 | exit 0 |

**本轮未跑完整 `npm run check`**：按登记，完整门禁由唯一集成执行者在实现合入后的实际最终版本串行新跑；R5 绿证（968/968）仅签 `8bd29c4` 既有实现，不预支新 schema 实施。

## 7. 未验证项（保持开放）

1. Claude 四文件（`src-tauri/migrations/web-backend/001_web_backend.sql`、`src-tauri/src/store/web_backend_schema.rs`、`web_backend_schema_tests.rs`、`mod.rs` 登记）尚未交付，未实现、未验证、未合入。
2. 最终集成版本的独立评审与完整 `npm run check` 未发生（待队长于候选评审后另行派发）。
3. `push` 不在本轮 owner 授权范围内，未执行。
4. Linux/代理部署、真实凭据、真实工作根：不在本轮范围，保持原有未验状态。

## 8. 结论

按新登记完成本轮 OpenCode 部分共享 main 快进与守卫/文档准备：**pass（限本记录范围）**。main 已仅快进至已审且 R5 通过的 `8bd29c4`（无新提交）；守卫核实为无需改动并以正/负例实证；公共文档已按「已授权／正在实施／已验证」区分更新，未提前签署 schema 完成。后续由 Claude 交付实现、独立评审后，再由队长派发唯一集成执行者重跑完整门禁并统一提交/合入/清理。
