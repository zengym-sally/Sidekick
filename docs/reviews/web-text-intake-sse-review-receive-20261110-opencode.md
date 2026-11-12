# MAYNE-24 SSE 独审记录工程接收（OpenCode，2026-11-10）

派工：MAYNE-24 评论 `01a1c1f9`（Codex：v2 绑定补证接收、解除 R2 `170f611` **同步纪律面**暂缓接收后，III 与 ZCode 黑盒回归并行，只做独立 docs／manifest 接收小提交——从 `e7b0977` 原路径原样接收 `web-text-intake-sse-sync-20261110-hermes-review.md`，追加 README 索引、manifest 的 R1 取代／R2 已审范围及未验项、本人接收记录。验收＝接收记录逐 blob／附件哈希对应、现有生产和测试字节零变化、docs 核查通过；不把 Task-SSE 标为完整验收通过，不重复行为／构建，不改 package 或 main，不启动正式集成／完整 gate）。本提交直接位于 `64f7c47`（分支 HEAD）。

## 范围与基点

- 基点：`64f7c475c2d74c3c7b28598d4cb16b53e9355c6a`（分支 HEAD，即 capability-ui 八文件闭包接收提交）。
- 来源提交：`e7b0977`（Hermes SSE 记录更正提交，本人分支 docs-only，恰 1 文件 +5/−1）；评论 `01a1c1f7`（v2 绑定补证帖，8 附件）。

## 接收清单（1 文件，逐 blob／附件哈希对应）

| 文件 | 来源 | blob | SHA-256 | bytes |
|---|---|---|---|---|
| `docs/reviews/web-text-intake-sse-sync-20261110-hermes-review.md` | `e7b0977`（原路径原样） | `ada27a8d0f64251756818c9f7e4a3a45ac04c145` | `cd71fcecb1f2e2e29bbc017aca5e83172e858fff3b9fa1679631c88b49ee6084` | 6233 |

- `git show e7b0977:<path>` 直接写盘后 `git hash-object` 复算＝`ada27a8d…c145`，与来源树逐 blob 全等。
- **附件对应**：评论 `01a1c1f7` v2 附件 `01a1c1f7-f29e-73fe-be22-752764c1ed58`（同名 md，挂载元数据 6233 字节）经 CLI 实际下载，SHA-256 复算＝`cd71fcec…6084`，与接收字节逐哈希相同——协调 `01a1c1f9`「更正记录与 `e7b0977` blob 相同」在本树独立复核成立。
- 内容与派工口径一致：R1 `b8a659b` needs_revision（取代结论保留）；R2（`9cb0b70`＋`d3feccd`，锚定 `170f611`）通过**限同步纪律范围**；冻结探针 v2（SHA-256 `d7da1fb8b8d0c2976b118e7e5e44f5a15d19497fa05f7d9eaf2119cce4cf7b51`）绿 8/8（2151ms）对锁定 `170f611`、红 7/7（4396ms）对 `b8a659b`，逐场隔离、S1b 未决读回反控、S3/S6 经真实 organizer store 状态核消费；初稿脚本/日志版本失配披露、原件保留；两缺件 `wmi-170f611.err`（0 字节）与 `parser-b8a659b.tap`（12/12）补挂；初稿误混 capability-ui `60ecc75` 零生产增量口径已由 `e7b0977` 删除，SSE 基线口径以 R2 记录组合基线更正为准。

## manifest 修订 5 → 6（恰按派工三项登记）

- F「Task-SSE」行状态更新为 **REVIEWED**：R1 `b8a659b` needs_revision（被 R2 取代，淘汰结论保留）；R2 同步纪律面按协调 `01a1c1f9` 解除暂缓接收（冻结探针 v2 绿 8/8／红 7/7 按各自模式登记）。**非完整验收**：交付字节仍未入任何聚合，package 零字节。
- 新增 `adjudications.sseSyncAdmission`：派工出处、已审范围（含冻结探针 v2 判据与重放结果）、被取代证据披露（初稿脚本/日志失配、撤回与基线更正保留）、接收身份（blob/SHA-256/附件对应）、未验项清单。
- `writeView.revision6Recount`：条目计数 142→142（F 行原位状态更新，无新条目）；`updated`／`updateDispatch` 时点同步。
- README 索引新增两行（接收的 Hermes 记录＋本接收记录），标题计数 156→158 按实际行数同步。

## 未验项（照记，不代签——按 `01a1c1f9` 原口径）

1. 2151／4396ms 仅签这两次内存探针观测；脚本仍含固定等待、末尾预算断言和吞关闭错误的 catch，不扩大为失败路径清理已核或普遍硬截止。
2. 测试适配 27/27、两树解析器各 12/12 的限定结论保留。
3. 完整组合（完整 I＋b5＋本包）、DOM、401／dispose 等动态面按原未验项登记。
4. Task-SSE **不标完整验收通过**；resolve/retry 与并发 UI 清单仍为后继输入；ZCode 黑盒回归原线继续。

## 实际核查（限定，按派工）

| 核查 | 结果 |
|---|---|
| blob 复算 | `ada27a8d…c145` 与 `e7b0977` 来源树全等（hash-object） |
| 附件哈希对应 | v2 附件 CLI 下载 SHA-256 `cd71fcec…6084` 与接收字节相同（6233 字节两处相符） |
| 生产/测试字节零变化 | `git diff 64f7c47..HEAD --stat` 恰 4 文件（接收记录＋README＋manifest＋本接收记录），src/、server/、src-tauri/、tests/、package、依赖锁零字节 |
| `npm run check:docs` | exit 0（接收后） |

未跑（按派工边界）：任何行为重放、探针复跑、解析器/适配套件重跑、构建、聚合、正式集成、完整 gate。

## 边界与结论

docs-only：恰 4 文件（接收的记录、README 两行＋计数、manifest 修订 6、本接收记录）；零生产/测试/package/锁字节；不操作 main；不启动正式集成或完整 gate。限定接收通过：接收记录逐 blob／附件哈希对应成立，现有生产和测试字节零变化，docs 核查通过。原始证据 `build/mayne24-sse-review-receive-20261110/`（gitignored：blob 复算、附件下载读回）。MAYNE-24 保持 `in_progress`，E/D、GAP-5 与整体准出边界不变。
