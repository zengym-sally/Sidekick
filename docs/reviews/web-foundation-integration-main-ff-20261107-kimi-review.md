# MAYNE-22 W0：main 快进与守卫/公共文档增量独立审查（Kimi，2026-11-07）

## 1. 范围与边界

- **评审对象**：`7f536db..b11fd059db1c1e60882084ef56ec8ff70738ae4c` 五文件增量（OpenCode 本轮共享 main 快进 + 守卫核实 + 公共文档准备）。
- **评审者**：Kimi（`ccebc5f6-3d8d-4b27-878d-6985e3c07387`），未参与本轮公共文档编写，与 Claude 的 schema 实施并行独立审查。
- **边界**：实现与作者文档只读；未重跑完整 `npm run check`；未修改任何实现或作者记录；未提前签署新 schema 完成。本次仅在本隔离树写本记录与 `build/mayne22-main-ff-review/`。
- **结论**：**通过（限本轮五文件增量范围）**，无 BLOCKER／MAJOR；5 项不阻塞观察见 §7。

## 2. 增量身份与补丁哈希（独立复算）

| 项 | 声明值 | 复算值 | 结果 |
|---|---|---|---|
| 提交 | `b11fd059db1c1e60882084ef56ec8ff70738ae4c` | 同 | 一致 |
| 父提交 | `7f536db3d0d130f762421be3fe1d55cb2fec5309` | `git rev-parse b11fd05^` 同 | 一致 |
| tree | `0c69de9faca53ff6abd501c9fb2fb70081737304` | 同 | 一致 |
| 分支 ref | `agent/opencode/mayne-22` | `refs/heads/agent/opencode/mayne-22` = `b11fd05` | 一致 |
| 补丁 sha256 | `e5f6eb99a30755f5b253829840ddfb7f24c7ba1d1febb06d821ff8a771eeeeb3` | `git diff 7f536db b11fd05 \| shasum -a 256` 同 | 一致 |
| 与交付附件 | — | 与 `main-ff-guard-docs-b11fd05.patch` `cmp` **逐字节相同** | 一致 |
| 规模 | 5 文件 +99/−7 | `git diff --shortstat` 同；`git diff --check` exit 0 | 一致 |

三个交付附件经 `multica attachment download` 取得并复算：`admission.json` `b619197e…`、`main-ff-20261107.log` `9c9c63b1…`、补丁 `e5f6eb99…`。原始日志：`build/mayne22-main-ff-review/verify-identity.txt`。

## 3. main 快进回执与当前 ref（核实通过）

- `refs/heads/main` 当前 = `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`，tree `c6f20de7a5e92b6cc41268c8c254a24620388c6f` 与已审候选逐字节一致。
- main reflog 显示唯一一次 `merge 8bd29c4…: Fast-forward`（2026-11-07 22:05:03 +0800），前值恰为 `9ad2d61`，**无新提交**；`9ad2d61` 确为 `8bd29c4` 祖先，`7f536db` 的父确为 `8bd29c4`。
- 交付的 `main-ff-20261107.log` 与 reflog 逐字段相符（BEFORE/AFTER SHA、status 干净计数 0、ff-only、无新提交、未 push）。
- **当前 ref 与本增量的关系正确**：main 停在 `8bd29c4`，**不**包含本五文件增量；本增量仍在 `agent/opencode/mayne-22`（`b11fd05`）待最终集成轮统一处理。未发现 main 被推进到未过完整门禁或未评审版本的情况。

## 4. 精确写入范围（核实通过）

`git diff --name-status 7f536db b11fd05` 恰为 5 个文件，全部落在本轮登记允许清单内：

| 文件 | 增/删 | 归属 |
|---|---|---|
| `docs/reviews/web-foundation-integration-main-ff-20261107.md` | +80/0 | 本项记录（新建） |
| `docs/product/05-第一阶段实施计划.md` | +12/−5 | 公共文档 |
| `docs/reviews/README.md` | +3/−1 | 索引登记 |
| `docs/engineering/web-backend-design.md` | +3/0 | 公共文档 |
| `docs/engineering/architecture.md` | +1/−1 | 公共文档（原地追加） |

- `package.json`、锁文件、`AGENTS.md`、`src/`、`src-tauri/`、`scripts/`、`vendor/` 零改动（`git diff --name-only` 过滤后为空）。
- Claude 的四文件（`src-tauri/migrations/web-backend/001_web_backend.sql`、`src-tauri/src/store/web_backend_schema{,_tests}.rs`、`mod.rs` 登记）在 `b11fd05` 中**确实不存在**——未提前合入未审实现。
- `docs/README.md` 按登记仅核对未改，与作者声明一致。

## 5. 守卫无需修改：正/负例依据（独立复现通过）

用 `b11fd05` 版守卫本体（blob `2cf5a30b7f4d1118456f61a83fe944c130ad71e4`）在合成树独立复现，未使用作者日志：

**规则依据（源码级）**：`SRC_TAURI_TOP_DIRS/FILES` 只收敛 `src-tauri/src/` 第一层（`store/` 已允许）；`IMMUTABLE_MIGRATIONS` 只固定既有 001–004；`SCAN_TOPS` 为 `src/ shared/ runtime/ tests/ scripts/ design/`，**不含 `src-tauri/`**；无任何规则约束 `src-tauri/migrations/` 子目录。四个精确新授权路径全部落在既有规则内。

| 用例 | 结果 |
|---|---|
| 正例：四新路径占位 + 既有 001–005 原字节 | exit **0** |
| 负例 1：意外顶层 `randomtool/` + `src-tauri/src/loose.rs` | exit **1**，`top.dir` + `layout.src-tauri-top` 均检出 |
| 负例 2：篡改既有 `001_todos.sql` | exit **1**，`schema.immutable-migration` 检出 |
| 负例 3（本评审新增）：篡改**新** lineage `web-backend/001_web_backend.sql` | exit **0**（未检出，见观察 O3） |
| 复原复跑 | exit **0** |
| 守卫 `--self-test` | exit **0**，22 违规类 + 8 引用负例，干净样本未误报 |

**真实树规模独立复现**：以 `git archive b11fd05` 全量检出并 `git init` 后跑同一守卫——补入 prepare-pi 产物前复现 **3×`ref.missing`（同三个 s32 文件，已知前置缺失，非本轮引入）**；从主检出只读复制 `vendor/pi/.../dist` 后得 **215 文件 / 466 引用、exit 0**，与记录 §6 声明逐字一致。原始日志：`build/mayne22-main-ff-review/verify-guard-and-docs.txt`。

## 6. 文档事实分层与索引/历史保留（核实通过）

- **四类事实分开记账**：`docs/product/05` 总览以「已验证／已授权／正在实施／待办」四项分列，各自绑定精确 SHA 与 owner 评论 `01a1b648-6d01-74e8-a06a-2d824003a5e5`；W0 队列行同步；**未把 schema 写成已完成**——「四文件 schema/runner/测试由 Claude 在其隔离树交付中——未验证、未合入 main」表述准确。
- **设计文档未越界**：`web-backend-design.md` 仅在头部与 §5 追加带日期状态注记，明写「实现未验证、未合入前，本节其余内容仍是设计而非现状」；零删除。`architecture.md` 仅原地扩展「历史迁移字节」一条，原文完整保留为前缀后追加。
- **索引与历史事实保留**：`docs/reviews/README.md` 仅新增 2 行（本记录 + 上轮 R5 完整门禁记录，后者当时写入清单不含索引，属应补登），既有条目**零改动**；历史章节、旧记录路径与旧结论未被删改或反转。
- **引用的外部版本全部复算一致**：集成候选补丁 `93506543…bab3745e`、提案文档 `bc8876c3…f706`、最终 DDL `8511907c…143d`（11 表、第 71 行部分唯一索引 `task_attempts_current`、`application_id 0x57424b31`）、`vendor/pi` tree `e89822b0…`。文档中关于 11 表含 `task_result_payloads`、路径 `<workspaceRoot>/data/web-backend.sqlite`、`user_version` 权威/`schema_version` 镜像的陈述与 ZCode R2 审定提案逐条相符。
- **文档门禁**：`check:docs` 在 `8bd29c4`（= 当前 main）20 文件 / 408 链接 exit 0；在 `7f536db` 408；在 `b11fd05` **414**（+6 恰为本轮新增文档链接），全部 exit 0——与记录 §3／§6 声明一致。

## 7. 观察（不阻塞）

- **O1 原始证据未随附**：记录 §6 引用的守卫正/负例日志与 prepare-pi 日志位于已删除的 OpenCode 平台树，本次只交付了 3 个附件。本评审已独立复现上述每一项，故不影响结论；建议下次交付时随附或注明不可恢复（与上轮 ZCode 对 R1–R3 日志提出的同类缺口）。
- **O2 索引计数被静默校正**：`7f536db` 的索引实有 73 行而标题写「72 份」（存量差一）；本增量新增 2 行并将标题改为「75 份」，现已自洽（75 行）。属准确性改进，但记录未提及这次校正。
- **O3 新 lineage 迁移暂无字节冻结**：负例 3 证明篡改 `src-tauri/migrations/web-backend/001_web_backend.sql` 不会被检出——`IMMUTABLE_MIGRATIONS` 只覆盖 001–004。记录「文件尚未存在、不应现在预设哈希」的推理正确，但意味着实现落盘后该文件在最终集成轮明确决定前不受保护。建议最终集成轮显式裁定（登记哈希冻结，或书面说明为何不冻）。
- **O4 指向尚未存在记录的前向引用**：`web-backend-design.md` 引用的 `docs/reviews/web-foundation-integration-schema-authorization-20261107.md` 在 `b11fd05` 中不存在（在 Claude 分支 `598d2da`）。该引用位于行内代码，`check:docs` 按设计跳过；正文已明写「随实现交付合入」，属有意识的前向引用。风险仅在于：若实现交付遗漏该记录，文档守卫不会报错。
- **O5 `vendor/pi` 源提交号未能独立复算**：tree `e89822b0…` 已在共享对象库核实；源提交 `ad702637` 出自未随附的 prepare-pi 日志，本树无法独立复算（该值在 R5 已由本评审者核实，未变）。

## 8. 未验证项（保持开放）

1. Claude 四文件实现未交付、未验证、未合入（本评审未触碰）。
2. 最终集成版本的独立评审与完整 `npm run check` 未发生；R5 绿证只签 `8bd29c4` 既有实现，不预支新 schema。
3. `push` 不在本轮 owner 授权内；Linux/代理部署、真实凭据、真实工作根保持原有未验状态。
4. 本评审未重跑完整门禁，未对 schema 实施作任何签署。

## 9. 结论

**通过（限本轮五文件增量范围）**：增量身份与补丁 sha256 独立复算一致且与交付附件逐字节相同；main 快进回执与当前 ref 核实为「干净 main 仅 ff-only 至已审且 R5 通过的 `8bd29c4`、无新提交、未 push」，且 main 未提前包含本增量；写入范围恰为登记允许的 5 个文件；守卫无需修改的正/负例依据经同一守卫版本独立复现（含 215 文件/466 引用与 self-test 22 类）；文档准确区分已授权／正在实施／已验证，保留原有索引与历史事实，未提前签 schema 完成。5 项观察不阻塞，建议在最终集成轮处理 O1/O3/O4。

本评审不改状态、不关闭任务、不推进 W1；统一集成、新跑完整门禁与按 owner 既有授权合入 main/清理分支，待 schema 实现及其独立审查齐备后由队长收口。
