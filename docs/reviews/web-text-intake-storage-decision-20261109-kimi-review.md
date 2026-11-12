# 候选操作幂等存储提案独立审阅（2026-11-09）

> **审阅人**：Kimi（MAYNE-24 II 作者；未参与该存储提案的裁定与写入，与 OpenCode／Claude 的候选操作面独立）。
> **派发依据**：MAYNE-24 评论 `01a1bc38-1cef-7ad8-8f81-62b54561df11`（Codex，2026-11-08）。与 II r5 最小修订（`61a069b`）及 I 修复/独审并行。
> **审阅对象**：`65431dae8fe07cdac781ecb174d3e8729046cce4`（tree `243a1ab47107dc2cf1126e051f90ad17a50aa5bd`）＋ 6 个附件（裁定文档、004 提案 SQL、ce4/ce5 输出、SHA256SUMS、admission）。
> **写入范围**：仅本文件与 `build/web-text-intake-storage-decision-review/`。未实现、未创建生产迁移、未改任何生产代码/守卫/白名单、未跑完整门禁。
>
> **结论：第一轮不通过（当时形态）；补件轮增量复核（§7）通过；F-3/F-4 补齐增量复核（§10）通过（附 N-1 实现轮必改）。** 裁定的核心——持久台账必要、选项 (a)/(b)/JSON 走私均被实质排除、最小 5 列 004 提案满足 R1–R7——我独立复算后**确认成立**；第一轮的两项阻断（F-1 §8.3 `timeReviewed` 前提被冻结正文与候选 I 实现否证、F-2 ce2/ce3 证据不可复跑）已由补件轮（`8ac7064`，22 附件）按队长评论 `01a1bc4c` 的要求逐项闭合，我离线重建附件目录、实跑 `sh run-all.sh`（6/6 exit 0，输出与附件逐字节一致）独立验证。§10 轮（OpenCode `06291e00`，派发 `01a1bc6f`）只复核 F-3/F-4 的文档/影响清单/哈希：R1–R8/J1–J2 逐项按当前精确候选核实成立、补出的 R8 第三处版本断言（`web_backend_store_tests.rs:238`）为真实遗漏项，另发现 `web_backend_store_tests.rs:530` 第 4 处版本字面量清单未列（N-1）。采纳仍待队长判断是否需新增 owner 授权（004、16 表权限未授权，原 003 冻结，M-4 未闭合）。

## 1. 审阅方法与材料边界

- 提案提交与 6 个附件经 CLI 读回；`004_candidate_operations.proposal.sql`、ce4/ce5 输出、admission 的 SHA-256 与附件清单逐一吻合（`5de175b6…c5bf`、`c4ea2acb…3da7`、`fb50c671…ec56`、`2f5c42fe…25e`）。
- 裁定文档本身**不在**其 SHA256SUMS.txt 清单内（清单 16 项覆盖 build 目录产物），附件文档与提案分支 `65431dae` 上的同路径文件一致（我已 `git show` 比对）。
- ce1–ce5 脚本与 run-all **未随附件交付**；我在提案作者本机 build 目录找到 ce1/ce4/ce5 三个脚本并原样复跑（下文 §3），ce2/ce3 脚本与全部 `.out`、run-all.sh、verification.md 在**附件与本机 build 目录中均不存在**（见 §2 缺口）。
- 判据全部回到冻结正文独立核对：最终 P1 `b190f7c6`（contract `5982c062…fe7b`）、web-api/1 `61863271…`、手工事项契约 `08afea02…ad3c`、001/002/003 冻结字节、候选 I `b057f0e` 只读取证。

## 2. 材料缺口（如实列出，按队长评论要求）

| # | 缺口 | 影响 |
|---|---|---|
| G-1 | ce1–ce3 脚本与 `.out`、ce4/ce5 的 `.mjs`、`run-all.sh`、`verification.md`、`003_text_intake.extracted.sql` 均未附（清单 16 项中仅 4 项随评论到达） | §3/§6/§7 的 ce2/ce3 判定第一轮**不可复跑** |
| G-2 | 复看提案作者本机 `build/web-text-intake-storage-decision/`：现存仅 ce1/ce4/ce5 三个 `.mjs` 与 `inputs/`；ce2/ce3 脚本、run-all.sh、verification.md 与全部 `.out` 在本地也已缺失 | ce2/ce3 结论（§6 G1–G3、§7 D1/D2）第一轮只存在于裁定文档文字中，无可执行载体 |
| G-3 | 我仅能复跑 ce1/ce4/ce5（自作者本机 build 复制，已在本人证据目录留哈希与来源） | ce1 无原始 `.out` 可比对（脚本自判 CONFIRMED，exit 0）；ce4/ce5 输出与附件**逐字节一致** |

> **补件轮更新（§7）**：G-1/G-2 已由补件候选 `8ac7064` 的 22 个附件闭合（脚本＋输入＋原始输出＋run-all＋SHA256SUMS＋verification.md，平台回收后重建的事实已如实披露），本人在离线重建目录实跑 `sh run-all.sh` 6/6 exit 0 且输出与附件逐字节一致；G-3 的 ce1 输出比对亦随之闭合。上表保留第一轮事实，不改写历史。

**G-1/G-2 是采纳的硬前置**：队长已向 OpenCode 提出同样的补齐要求；本审阅不因缺口推定提案有误，但**不能**把不可复跑的输出签为证据。我用自行重建的探针（§3 K5/K6）独立支持了 ce2/ce3 的核心论断，这不等同于作者证据链复跑成功。

## 3. 独立复算与复跑证据（全部 exit 0，可复跑）

 frozen 输入哈希复算（与登记冻结值逐一相符）：

| 输入 | 复算值 | 判定 |
|---|---|---|
| 001 | `8511907c…ff143d`（本树仓库文件） | ＝冻结值 |
| 002 | `b6cb8e61…e2f97e`（本树仓库文件） | ＝冻结值 |
| 003 | `8e4e3159…7870`；授权记录 §5.1 提取 与 `git show b057f0e:src-tauri/migrations/web-backend/003_text_intake.sql` **双源逐字节相同** | ＝冻结值，双源确认 |
| P1 契约 | `b190f7c6` 提取 `5982c062…fe7b` | ＝冻结值 |
| web-api/1 | main `1e37044` 提取 `61863271…` | ＝冻结值 |
| 手工事项契约 | `08afea02…ad3c`（W1 集成登记态） | 与裁定文档 §1.3 登记一致 |
| 004 提案 | 附件 `5de175b6…c5bf`；与作者本机 build 副本一致 | 与 §8.1 登记一致 |

复跑与自建探针（`build/web-text-intake-storage-decision-review/rerun/`，Node v24.20.0，纯 `node:sqlite`，确定性、无网络）：

- `ce4-frozen-tables-audit.mjs`：exit 0，输出与附件 `ce4-frozen-tables-audit.out` **逐字节一致**（15/15 拒绝结论复现）。
- `ce5-proposed-schema-proof.mjs`：exit 0，输出与附件 `ce5-proposed-schema-proof.out` **逐字节一致**（F1–F8 复现）。
- `ce1-last-operation-single-column.mjs`：exit 0，CONFIRMED（无原始 `.out` 可 diff，见 G-3）。
- `kimi-independent-probes.mjs`（本人编写，10 组全过）：K1 004 落链＋schema_meta 镜像到 4；K2 PRAGMA table_info 形状（PK／NOT NULL／单 FK NO ACTION／action CHECK／无二级索引）；K3 `operation_id TEXT PRIMARY KEY` 的 SQLite NULL/空串怪癖与冻结 `sign_off_batches` **同款先例**、服务层非空校验在场；K4 FK 执行依赖每连接 pragma，`configure_connection` 确设 `foreign_keys=ON`（静态比对候选 I `web_backend_schema.rs`）；K5 重建 ce2（JSON 列无仲裁、载荷泄入 wire）；K6 重建 ce3（泛化单表后两键族撞共享 PK、无判别列）；K7 双真实连接 WAL 并发（写锁串行化、败者见胜者已提交行走重放、PK 终裁、deferred 升级显式失败不双应用）；K8 事务中强制失败→变更与台账同滚；K9 close+reopen 重放在；K10 `timeReviewed` 规范绑定反例（见 §5 F-1）。

## 4. 逐项核对（按派工清单）

### 4.1 持久台账必要性 — 确认成立

- §2 判据引用与冻结正文逐一相符：P1 §5.1 幂等条款（冻结件 line 120「同 `operationId` 且同规范输入（**动作＋目标＋input＋expectedVersion**）才重放；**重放先于状态/版本守卫**，返回同一对象当前权威状态」）；web-api/1 §3.3 重放/异体/不消耗版本；手工事项契约附录 A.2 跨动作/跨 `itemId` 复用 409；R6 引 P2 T-8 与我 II 套件 T-8 条目（`tests/integration/web-text-intake-http.test.mjs:523`）属实。
- §4 信息论论证独立复核成立：重放与全新请求可要求不同响应而当前可观测态相同，区分信息只在历史中；候选 I 现状佐证——`editCandidate`/`discardCandidate`/`applyPreview`（`server/lib/text-intake-service.mjs:371/400/455`，候选 I `b057f0e`）算出 canonical 后 `void canonical;` 丢弃，三操作**无任何幂等存储**，M-4 缺口属实。
- 候选 I 的 `canonicalize`（`manual-items-service.mjs:67`）排序键紧凑 JSON，确定性无歧义——提案复用它可行。

### 4.2 15 表替代方案是否实质排除 — 确认排除（一处完备性小瑕）

- ce4 的 15 表清单与授权 B 的 `BUSINESS_TABLES: [&str; 15]`（候选 I `web_backend_store.rs:22`）**逐项一致**，无遗漏授权面。
- 我按冻结 DDL 直接复核了关键拒绝依据：`task_events.object_type CHECK` 仅 `task/setting/workspace/recovery_hold`（001 line 77）；`candidates` 无 operation 列；`manual_item_events.action CHECK` 六枚举且 `operation_id UNIQUE` 已被 `sign_off:` 派生键占用（003 line 60-68）；`sign_off_batches.operation_id TEXT PRIMARY KEY` 且无 kind/action 判别列（003 line 169-179）。
- 非白名单三表（`schema_meta`、`settings`、`workspace_operations`）按授权 B 拒写，裁定 §7 点名了前两张与 `sqlite_sequence`，**未点名 `workspace_operations`**（001 line 98，非业务白名单表）——完备性小瑕，不影响结论，建议补一句。

### 4.3 004 原字节/FK/空键约束 — 字节与结构确认；两处措辞需精确化

- 字节：附件与作者 build 副本一致，`5de175b6…c5bf`；头部 `Status: PROPOSAL ONLY`、未创建生产路径（`src-tauri/migrations/web-backend/004_candidate_operations.sql` 不存在，admission 与我的目录核查双证）。
- 结构（K1/K2）：5 列；`candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id)`；`action CHECK` 三值；`occurred_at_ms` 与 `manual_item_events` 计时列同名同型（003 line 66）；`UPDATE schema_meta SET schema_version = 4 WHERE id = 1` 与 003 line 183 同型；无二级索引（PK 覆盖唯一授权读路径）。
- 空键（K3）：`operation_id TEXT PRIMARY KEY` 在 SQLite 下**允许 NULL 与空串**（非 INTEGER PK 的遗留怪癖）——冻结 `sign_off_batches` 同款，属代码库既有性质而非本提案引入；空串/NULL 由服务层拦截（候选 I `text-intake-service.mjs:372` 等三处 `typeof operationId !== 'string' || !operationId.trim()`）。建议实现轮在文档明记「schema 不设防、服务层是唯一闸口」，不因此改字节。
- FK（K4）：执行依赖每连接 `foreign_keys=ON`；候选 I `configure_connection`（`web_backend_schema.rs:86-89`）确设该 pragma，003 头部亦有同样约定。无 ON DELETE 动作安全：`DELETE FROM candidates` 仅删 `status='staged'` 行（`text-intake-service.mjs:749`），而三直改操作全部守卫 `status='pending'`，台账行**不可能**挂在会被删的候选上。
- 措辞小瑕（不影响结论）：§8.2「candidates 行只改状态不删除」不精确（staged 行在非成功 extract 时确被删，line 749）；「行不可变（授权模板仅 INSERT）」不精确——守卫按**目标表**放行（授权 B 机制），业务表上的 UPDATE/DELETE 机械上被允许，不可变性是**服务层协议**性质，应如是描述。

### 4.4 规范输入与幂等命名空间 — §8.3 前提被冻结正文与实现否证（F-1）

- `runId` 绑定：apply_preview 的规范元组含 `runId`（§8.3），与「目标」要素一致——确认。
- **`timeReviewed` 前提不成立**：§8.3 称「因 `timeReviewed=false` 的尝试必被 400 拒绝（不落台账），可达状态内与四元组无行为分歧」。冻结正文相反：P1 §5.1 edits 行（line 109）错误列**只有 409**；400 时间错误只挂在 `/api/sign-offs`（line 113）；`timeReviewed=true` 要求系于「`unresolved` 时**签收**」（line 119）。候选 I 实现同样只对未定期候选拒绝（`text-intake-service.mjs:381` `if (candidate.draft.unresolved && !timeReviewed) throw timeReviewRequired()`）。即：**已解析/无时间歧义候选的 `timeReviewed=false` 是可达接受态**，该字段影响行为（未定期时翻转 200/400）。
- 反例（K10，用候选 I 真实 `canonicalize` 计算）：同 `operationId`、同四元组、仅 `timeReviewed` 不同——若**绑定**（候选 I 现行做法，line 383），规范字节不同 → 409 `idempotency_conflict`；若按 §8.3 四元组**省略**，两请求规范字节**完全相同** → 重放 200，而全新求值本应 400。规范请求必须完整绑定影响行为的字段。
- 台账 schema 对载荷字节不敏感（`request_json` 不透明），故 F-1 是 **§8.3 定义层修正，不需要改 DDL 字节、不需要新哈希**；但「采纳时由 I 与独审对齐其一」须收敛为**绑定 `timeReviewed`**（与候选 I 现行 canonical 一致），并在提案中改写该备注的理由。

### 4.5 真实并发仲裁/回滚重启 — 不采信字样，功能实证成立

- 未采信「BEGIN IMMEDIATE」字样，以两个真实连接在生产同款 WAL 模式下重放服务层协议（K7）：写锁串行化（第二个 `BEGIN IMMEDIATE` 在首事务开放期间被阻）、胜者提交后败者**看到已提交行走重放路径**、盲目二次 INSERT 被 PK 拒绝；deferred 读-写升级显式失败（`database is locked`）而非双应用——SQLite 快照隔离下两种模式都不会双应用，`BEGIN IMMEDIATE` 的价值是免掉应用层重试循环。仲裁实质＝**单写事务＋PK**，与 §8.2 R7 主张一致。
- 原子性（K8）：事务中强制失败 → 候选变更与台账行**同滚**。重启（K9）：close+reopen 后重放命中。与 ce5 F5/F6/F8 结论一致（ce5 输出已逐字节复现）。

### 4.6 runner/权限/守卫 — 机械追加成立；故障注入分支须显式扩展

- runner：候选 I `web_backend_schema.rs` 以 `include_str!`＋`M::up(SQL_00x)` 清单（`migrations()`，line 30）经 `rusqlite_migration::to_latest` 推进 `user_version`；追加第 4 项＝`M::up(SQL_004)`＋`SCHEMA_VERSION` 3→4，机械成立。
- **故障注入**：`apply_migrations` 的 `#[cfg(test)]` 分支**硬编码「after the third migration」并断言回滚后 `table_count == 13`（v2）**（候选 I `web_backend_schema.rs:391-403`、`web_backend_schema_tests.rs:880`）。004 落地后该分支不再覆盖最新迁移：须扩展到第四迁移，并把回滚期望改为 18（v3）；否则最新迁移的回滚路径无任何测试覆盖。§8.4 只说「实现轮扩展」，未点名此硬编码，见 F-3。
- 权限：`BUSINESS_TABLES` 15→16 追加 `candidate_operations`，与授权 B 同机制；settings 两模板不变——机械成立。
- 守卫：III 现行 `check-structure.mjs` `IMMUTABLE_MIGRATIONS`（Map 追加＋三态自测 missing/tampered/落地激活，self-test line 473/525-539 覆盖）模式明确；004 采纳时以 `5de175b6…` 追加同款条目即可；顺带需更新违规说明文字「(001-004 and web-backend/1-3)」中的版本枚举。

### 4.7 受影响 schemaVersion 断言的完整清单（F-3，§8.4 未列）

以下断言在 004 落地后**必然翻转或破测**，实现轮必须逐项处理（我已在候选 I 树与本 II 树逐文件核对）：

**Rust（候选 I 树 `src-tauri/src/store/`）**

| # | 位置 | 现状 | 004 后 |
|---|---|---|---|
| R1 | `web_backend_schema_tests.rs` `migration_003_preserves_rows_and_widened_check_constraints` 的 `SELECT schema_version … == 3` | 3 | 4（init/open 应用全部四迁移） |
| R2 | `web_backend_schema_tests.rs:228` `open_rejects_version_mirror_mismatch` 哨兵 `schema_version = 4` | 4 | **5**（init 后镜像即 4，哨兵不破测的条件消失） |
| R3 | `web_backend_schema_tests.rs:245` `open_rejects_too_new` 哨兵 `schema_version = 4; PRAGMA user_version = 4` | 4 | **5**（4 不再「过新」，现必然破测） |
| R4 | `web_backend_schema_tests.rs:645` `version_rejection_leaves_database_untouched` 哨兵 `schema_version = 4` | 4 | **5**（镜像 4 将与 user_version 4 相等，mismatch 不再触发，现必然破测） |
| R5 | `web_backend_schema_tests.rs` `table_count == 18` ×7（line 97/188/305/352/425/668/921） | 18 | 19 |
| R6 | `web_backend_schema_tests.rs:880` 回滚断言 `table_count(&probe) == 13, "003 must roll back, leaving v2"` ＋ 故障分支注释 | 003 后故障 | 故障点移至 004 后期望 18（v3）；保留 003 故障则须文档化降级理由 |
| R7 | `web_backend_store_tests.rs` 表计数 18 ×3（line 50/73/272） | 18 | 19 |
| R8 | `web_backend_store_tests.rs:53/59` `user_version == 3`、`schema_version == 3` | 3 | 4 |

**JS（II 冻结写入面）**

| # | 位置 | 现状 | 004 后 |
|---|---|---|---|
| J1 | `tests/integration/web-manual-items-http.test.mjs:81`（A-9；II 基座现状为 2，I 的 003 落地后按已派窄授权放宽为 3） | 2→3 | 4 |
| J2 | `tests/integration/web-text-intake-http.test.mjs:253`（schema 前置断言） | 3 | 4 |

**核查后确认不受影响**：`tests/unit/web-manual-items.test.mjs:28-29`（自建合成 `schema_meta=1` 夹具，与迁移链无关）；`native-launcher`/`today-advice`/docs/reviews s2–s34 的 `schemaVersion`（原生 UI 校验协议命名空间，非 SQLite schema_version）；store 测试中 `PRAGMA user_version = 3` / `"user_version=3"` 探针（越权拒绝用例，取值偶然）；文档无「当前 schema_version=3」的既述 claims（web-backend-design line 95 只述机制）。

**II 套件新增面（§8.4 表述不精确）**：裁定 §8.4 称「II 四套件既有『操作ID重放/异体与版本冲突』条目（T-8 系）由此可签业务通过」——实际既有条目只覆盖 `/api/text-sources`（T-8，line 523）与 `/api/tasks`（line 575-591）两条既有路径；**edit/discard/applyPreview 三操作的幂等重放/异体/跨目标/跨动作/守卫不落账/重启重放用例尚不存在**，须在 II 四套件新增后才能签该族业务通过。这是实现轮范围提示，不是提案缺陷。

## 5. 发现项分级

| # | 级别 | 内容 | 处置 |
|---|---|---|---|
| F-1 | **Major** | §8.3 `timeReviewed` 前提被冻结正文（P1 §5.1 line 109/113/119）与候选 I 实现（line 381）双重否证；规范定义须绑定 `timeReviewed`（runId 已正确包含）；反例见 K10 | **已闭合**（补件轮 §8.3 更正＋ce6 B1–B5，§7 独立复跑验证）；DDL 字节不变、哈希不变 |
| F-2 | **Major** | ce2/ce3 脚本与输出、run-all.sh、verification.md 在附件与本机 build 均缺失，§6/§7 两条否定判定当前不可复跑（K5/K6 只支持其核心论断） | **已闭合**（补件轮 22 附件＋`sh run-all.sh` 实跑 6/6，输出与附件逐字节一致，§7） |
| F-3 | Minor | §8.4 未列受影响断言完整清单（§4.7 R1–R8、J1–J2 共 10 项，含 3 项**必然破测**的哨兵 4→5）、未点名故障注入硬编码「after the third migration」；§8.4 对 II 既有条目的可签范围表述不精确 | **已闭合**（§10：`06291e00` §8.4 重写为三子节，R1–R8/J1–J2 逐项按当前候选核实成立）；遗留 **N-1**（`web_backend_store_tests.rs:530` 第 4 处版本字面量须补入 R8）与 N-2/N-3/N-4/N-5 列实现轮/文档微调 |
| F-4 | Minor | 措辞不精确：「candidates 只改状态不删除」（staged DELETE 存在）、「行不可感（授权模板仅 INSERT）」（守卫按目标表放行，不可变性是服务层协议性质）、§7 未点名 `workspace_operations` | **已闭合**（§10.5：三项措辞更正逐项核实成立，零字节改动） |

## 6. 结论与采纳前条件（第一轮）

**第一轮结论：不通过（当时形态）**，理由为 F-1/F-2；技术内核（必要性、15 表排除、(a)/(b)/JSON 走私否定、004 五列结构、R1–R7 的功能满足）经独立复算与复跑**确认成立**，F-3/F-4 不阻断。

第一轮列出的三项采纳前条件（① §8.3 绑定 `timeReviewed` 并改写理由；② 补齐 ce1–ce5/run-all 可复跑材料；③ §8.4 附受影响断言完整清单与故障注入扩展方案）中，①② 已由补件轮闭合（见 §7）；③ 属实现轮清单，本审阅 §4.7 的 R1–R8/J1–J2 即为其参照，不阻断提案本身。

## 7. 修订增量复核（补件轮，2026-11-09；派发：队长评论 `01a1bc4c`）

补件候选：`8ac706456081a892734a804d52974bd387439d54`（tree `e3f41328899a36758913755f19e4f89b2ed69891`，仅裁定文档 +10/−6）＋ 22 个附件。本段只接续修订增量，未改面复用第一轮结论。

**离线重建与复跑（本人独立执行）**

- 22 个附件经 CLI 读回至 `build/web-text-intake-storage-decision-review/supplements/offline-rebuild/`，按附件清单重建 `inputs/` 布局；`SHA256SUMS.txt` 20 项**全部验过**（含 003 `8e4e3159…7870` 与 004 `5de175b6…c5bf`）。
- 在本目录实跑真实解释器命令 **`sh run-all.sh`**：exit 0，6/6 例 CONFIRMED；6 个重新生成的 `.out` 与重新下载的附件**逐字节一致**（ce1/ce2/ce3/ce4/ce5/ce6 均验）。
- ce4/ce5 重建输出与第一轮裁定评论所附输出逐字节一致（`c4ea2acb…3da7`、`fb50c671…ec56`），`verification.md` 如实披露「平台回收后重建、ce1–ce3/ce6 的旧输出从未附且不可恢复」——按队长口径，ce1–ce5 只签本轮重建复跑，不反签前轮原件；此披露方式接受。

**F-1 闭合（§8.3 更正）**：更正后文档显式撤回初稿前提并保留原文于更正记录块；edit 规范元组改为 `{action,candidateId,expectedVersion,input,timeReviewed}`，apply_preview 绑定 `runId`，并声明「绑定是必要的，不是可省略的」。新增 ce6 B1–B5 与我的 K10 独立结论一致：B1 已解析候选 `timeReviewed=false` → 200 可达落账（前提证伪）；B2 400 门恰为 `unresolved && !timeReviewed` 且零落账；B3 同键翻转 `timeReviewed` → 409；B4 同键换 `runId` → 409（`run_2` 独立键应用出不同字段，证明目标为行为性字段）；B5 精确同字节重放仍 200 `replayed:true` 不耗版本（绑定不误拒诚实重放）。

**F-2 闭合（证据可复跑）**：ce1–ce5 脚本、ce6、run-all.sh、精确输入、原始输出、SHA256SUMS、run-all.transcript、verification.md 全部随附件交付；本人在干净离线目录实跑通过。清单核查更正：`run-all.sh` 实际**已在**补件 `SHA256SUMS.txt` 清单内（`6fe9e857…f39427`，验过）——第一轮 run-all 入口本身缺失（即 F-2），补件轮重建后已补登，该项无遗留。

**并发证据（队长专项要求：独立连接/进程的真实竞争）**：ce5 F5 使用**两个真实连接**（`busy_timeout=0`）：tx1 持写锁期间 tx2 `BEGIN IMMEDIATE` 被阻（`database is locked`）、tx2 不见未提交行、tx1 提交后 tx2 走重放路径且候选版本不二次递增、盲目二次 INSERT 撞 UNIQUE。本人 K7 另以**生产同款 WAL 模式**双连接独立复现同一串行化，并补充 deferred 读-写升级显式失败（不双应用、须应用层重试）的反向证据。两级证据均为真实连接竞争，非顺序调用代签。范围注记：ce5 库运行在默认 journal 模式（未设 WAL），生产 `configure_connection` 为 WAL——本人 K7 覆盖 WAL，结论不受影响。

**004 字节**：补件轮复算仍为 `5de175b6…c5bf`（文档明示「字节未变，哈希仍为该值」的复算表述，未沿旧值签发新内容）；本人 manifest 复核一致。DDL 无需变化，`request_json` 不透明使 §8.3 绑定更正不触及字节。

**仍未闭合（不阻断提案，列实现轮）**：F-3 受影响断言完整清单（§4.7 R1–R8/J1–J2，含 3 项必然破测的哨兵 4→5、10 处表计数 18→19、runner 故障注入「after the third migration」扩展、II 三操作幂等等例新增）——补件轮未涉及，按队长分工属实现轮；F-4 三处措辞小瑕（staged DELETE、服务层协议不可变性、§7 未点名 `workspace_operations`）中前两处已被 §8.3 更正间接改善，`workspace_operations` 一句仍可补。

**增量结论：通过（限定于提案文档与证据面；不构成实施准入）**。M-4 维持未闭合，004/16 表权限仍待队长判断是否需新增 owner 授权，原 003 继续冻结，MAYNE-24 保持 in_progress。

**§7 附记（交付线程更正后的第一手复验，2026-11-09）**：上轮增量结论误回复到派发线程 `01a1bc38`（第一轮独审派发）之下；本条审阅按队长评论 `01a1bc4c`（补件派发）的线程正式交付，并在交付前对全部关键面做第一手复验（非采信附件自述、非复用上轮记忆）：22 个补件附件经 CLI 重新读回并按清单重建 `inputs/` 布局，`SHA256SUMS.txt` 20/20 全部验过（003 `8e4e3159…7870`、004 `5de175b6…c5bf`、run-all.sh `6fe9e857…f39427` 均在列）；在重建目录实跑真实命令 `sh run-all.sh` exit 0、6/6 CONFIRMED，6 个重新生成的 `.out` 与附件逐字节一致；ce4/ce5 输出与第一轮登记值逐字节一致（`c4ea2acb…3da7`、`fb50c671…ec56`）；004 提案字节（1774 B）与 003 附件字节独立复算相符；ce5 F5 源码核查为两个真实 `DatabaseSync` 连接（`busy_timeout=0`）写锁竞争；本人 K1–K10 探针复跑 exit 0、35/35 ok、输出与上轮登记逐字节一致（含 K7 生产同款 WAL 双连接串行化与 deferred 升级显式失败）。复验未改变 §7 结论；唯一修正是 F-2 的 `run-all.sh` 清单缺席记述（见上），剩余项仍为 F-3/F-4。

## 8. 复跑说明

```sh
# 补件轮全套（离线重建目录 supplements/offline-rebuild/）：
sh run-all.sh                                                       # ce1–ce6，exit 0，6/6 CONFIRMED
# 第一轮自建探针（rerun/）：
node build/web-text-intake-storage-decision-review/rerun/kimi-independent-probes.mjs   # K1–K10，exit 0
node build/web-text-intake-storage-decision-review/rerun/ce4-frozen-tables-audit.mjs   # 输出与附件逐字节一致
node build/web-text-intake-storage-decision-review/rerun/ce5-proposed-schema-proof.mjs # 输出与附件逐字节一致
node build/web-text-intake-storage-decision-review/rerun/ce1-last-operation-single-column.mjs
```

全部哈希清单：`build/web-text-intake-storage-decision-review/SHA256SUMS.txt`（第一轮证据）与 `supplements/offline-rebuild/SHA256SUMS.txt`（补件轮 20 项全验）；写入登记：`build/web-text-intake-storage-decision-review/admission.json` 与 `supplements/offline-rebuild/admission.json`。ce1/ce4/ce5 第一轮复跑脚本自提案作者本机 build 目录原样复制（复制件哈希在案）；补件轮 ce1–ce5 为平台回收后作者重建件（忠实度披露见其 `verification.md`，ce4/ce5 输出与第一轮附件逐字节一致）。

## 9. 记录

- 审阅人：Kimi（`agent/kimi/mayne-24`，II 作者；未写存储提案、未写 I/III）。
- 审阅基座：本分支 `61a069b`（II r5）之上追加本审阅文档（第一轮提交 `dc33721`，增量轮更新同文件）；证据目录只读自提案分支 `65431dae`/`8ac7064` 与本机各候选 build。
- 增量轮材料：补件 22 附件（评论 `01a1bc4a`，commit `8ac7064`）离线重建于 `build/web-text-intake-storage-decision-review/supplements/offline-rebuild/`，实跑记录随证据包。
- 未做：未实现、未创建 `src-tauri/migrations/web-backend/004_candidate_operations.sql`、未改 server/src/src-tauri/tests/守卫/白名单/package、未跑完整 `npm run check`、未动 MAYNE-24 状态。

## 10. F-3/F-4 补齐增量复核（2026-11-09；派发：队长评论 `01a1bc6f`）

> **审阅对象**：OpenCode 追加候选 `06291e00cd50e7fb10f1ae50e7badd765da35cc6`（父 `7aa0aee`，仅裁定文档一文件，+59/−8；§8.4 重写为三个子节、§8.2 两条措辞、§7 一句、§10 ⑥）。
> **本轮边界**：按派发只复核 F-3/F-4 的**文档、影响清单与哈希**；复用已过的 ce1–ce6/WAL 内核证据，**不整轮重跑**。唯一第一手执行是新增的 P1–P5 机制探针（覆盖的恰是 F-3/F-4 才引入的断言：按起始版本回滚、哨兵必然破测、staged 删除可达边界），不覆盖也不重签已过面。

### 10.1 身份与哈希（全部独立复算）

| 项 | 值 | 复核 |
|---|---|---|
| 追加候选 | `06291e00…5cc6`（父 `7aa0aee`，1 文件 +59/−8） | 附件文档 `dafb59a9…9120` 与其 `f34-SHA256SUMS.txt` 登记值一致；`004_candidate_operations.proposal.sql` 仍为 `5de175b6…c5bf`、1774 B，**字节未变** |
| 核实基线 | 文档自述 I=`4dfc9e9`（tree `89446a4f…`）、II=`61a069b`（tree `e0a6028b…`） | 与作者 admission.json 一致；我另按派发补核当前 I 候选 `e84fab6b`（tree `99c23bc1…`） |
| 001/002/003 | `8511907c…`、`b6cb8e61…`、`8e4e3159…7870` | 自 `e84fab6b` 取出复算相符，且与 `4dfc9e9` **blob 相同**（`git rev-parse` 逐文件比对） |
| `rusqlite_migration` | 2.5.0 | `src-tauri/Cargo.lock:3030-3033` 相符 |

### 10.2 F-3 §8.4.1 受影响断言清单——逐项第一手核实（Rust，I 树）

`src-tauri` 全部文件在 `4dfc9e9` 与 `e84fab6b` 之间 **blob 一致**（已逐文件比对），故下列行号对两个候选同时成立：

- **R1** `web_backend_schema_tests.rs:678/:685` 确为 `migration_003_preserves_rows_and_widened_check_constraints`（fn `:658`）内 `schema_version`/`user_version` 两个字面量 `3` → 4。
- **R2/R3/R4** 三个哨兵确在 `:228`（fn `:223`）、`:245`（fn `:239`）、`:645`（fn `:640`），现值均为 4。
- **R5** 表计数 `== 18` 全仓恰好 **7 处**，行号 `:97/:188/:305/:352/:425/:668/:921` 与文档逐一相符（`:342 == 0`、`:377/:394 == 11`、`:880 == 13` 另行核实为不受影响）。
- **R6** `migration_fault_after_003_rolls_back_to_v2_and_retry_completes` fn `:865`；回滚断言 `:880 == 13, "003 must roll back, leaving v2"`、`:885/:895 == 2`；重试完成段 `:921 == 18`、`:927 == 3`——与文档一致。
- **R7** `web_backend_store_tests.rs` 表计数 3 处 `:50/:73/:272` 全部相符。
- **R8** 版本字面量 3 处 `:54/:62/:238` 全部相符。**其中 `:238` 是真实补出项**：`pragma_is_read_only_and_whitelisted`（fn `:234`）内 `assert_eq!(store.pragma(...user_version...)["value"], 3)`，我第一轮 §4.7 只列了 `:53/:59`（请求行），该处确属遗漏，本轮补充成立。
- **常量引用点** `SCHEMA_VERSION` 在 `web_backend_schema_tests.rs` 恰好 5 处（`:118/:132/:316/:358/:431`），随 `web_backend_schema.rs:13` 自动适配，无字面量编辑——相符。
- **不受影响清单**逐条语义核实成立：`:276 == 1`（foreign_keys）、`:291 == 2`（synchronous）、`:326 == 1`（tasks 行数）、`:708 == 2`（事件行数）、`:778 == 6`／`:818 == 4`（high-water）、`:347 == 0`／`:382 == 1`／`:399 == 1`／`:409 == 1`／`:419 == 0`（各回滚态）、`:905 == 0`（回滚后 `text_sources` 不存在）、`store_tests:195/:247` 的 `PRAGMA user_version = 3` 确为越权拒绝探针（拒绝原因是 pragma 写不在白名单，与取值无关）。仅**引用风格**不统一（见 N-5）。
- **`web_backend_schema.rs`**：`:13 SCHEMA_VERSION = 3`、`:30/:31` 迁移清单、`:391-403` 故障注入硬编码 `SQL_003` 且注释明写「after the third migration … leaving the database at v2」——与文档描述逐字相符；生产路径无其他版本字面量。

### 10.3 F-3 §8.4.1/§8.4.3 JS 与 II 三族缺口——逐项第一手核实（II `61a069b`）

- **J1** `web-manual-items-http.test.mjs:81` 用例、`:82` 断言值 `2`；**J2** `web-text-intake-http.test.mjs:249` 用例、`:255` 断言值 `3` 与信息「migration 003 must advance schema_meta to 3」——均相符。
- 全 II 写入面 `schemaVersion` 断言**仅此两处**（四套 integration 全文检索确认）；`tableCounts` 只数 `manualItems`/`manualItemEvents`，无总表计数断言——JS 清单完整。
- **§8.4.3 三族缺口成立**：`replayed` 断言仅见于 `:532/:540`（text-sources）、`:585`（tasks）、`:831/:832/:835`（签收批次）；T-8 仅 `:526`（`/api/text-sources`）与 `:567`（`/api/tasks`）；夹具 `synthetic-inputs.mjs:91-109` 的 `editBody`/`discardBody`/`applyPreviewBody`（含 `revisionBody`）每次默认新建 `operationId()`，无任何同键重放/异体/跨目标/跨动作/守卫不落账/重启重放用例；T-10 对 edit/discard 的既有覆盖是版本/状态守卫（`:738/:743/:747` 的 400/409、`:905` 二次 discard `409 state_conflict`），apply preview 仅 `:704/:708`（409 与成功）——**不能称现有 T-8 已覆盖该三族**，文档表述准确。
- **tests/unit 不受影响**：`web-manual-items.test.mjs:28-29` 为手工搭建的 `schema_meta=1` 夹具；`today-advice.test.mjs` 的 `schemaVersion` 属 today-facts 协议命名空间——均与文档一致。

### 10.4 F-3 §8.4.2 按起始版本回滚——机制实证（新增 P1–P5 探针，27/27 CONFIRMED）

探针 `build/web-text-intake-storage-decision-review/round4/kimi-f34-mechanism-probes.mjs`（Node ≥24、纯 `node:sqlite`、确定性无网络；输入为候选树冻结 001/002/003 字节＋004 提案字节，4/4 哈希先验后用）。它按 `rusqlite_migration` 2.5.0 `goto_up` 的**真实形状**建模：一次 `to_latest` 的全部待应用迁移进同一 `conn.transaction()`、`set_user_version` 在同一事务内、失败语句追加到链末（即 `web_backend_schema.rs` `#[cfg(test)] apply_migrations` 的注入方式）。

| 探针 | 断言 | 结果 |
|---|---|---|
| P1 | v3 起、故障注入进 004 → 回 v3（镜像 3／`user_version` 3／18 表／`candidate_operations` 不存在／`validate()` 仍通过） | CONFIRMED |
| P2 | v2 起、003+004 同一 `to_latest`、故障在 004 → **整笔回 v2**（镜像 2／`user_version` 2／13 表／`text_sources` 与 `candidate_operations` 均不存在／002 既有行保留） | CONFIRMED |
| P3 | 四迁移一次落地：镜像 4／`user_version` 4／19 表／五列齐备／`sqlite_sequence` 逐字节不变（004 无 AUTOINCREMENT） | CONFIRMED |
| P4 | 三个哨兵（R2/R3/R4）在值 **4** 一律不再触发拒绝（必然破测），在值 **5** 分别回到 `MISMATCH`/`TOO_NEW`/`MISMATCH` | CONFIRMED |
| P5 | 全仓唯一 `DELETE FROM candidates` 限定 `status='staged'`：staged 行可删、挂台账的 pending 行不被该 DELETE 触及、`foreign_keys=ON` 下直接删挂账候选被 FK 拒绝、 guarded pending 更新后台账 FK 仍完整 | CONFIRMED |

机制另经**源码直读**独立佐证：`rusqlite_migration-2.5.0/src/lib.rs:618-651` 的 `goto_up` 用单个 `conn.transaction()`（`:629`）循环 `current_version..target_version` 应用 `m.up`，`set_user_version(&tx, target_version)` 在事务内、末尾 `tx.commit()`；crate 文档 `:756/:834` 明言 "The migrations are applied atomically."；003 迁移头部（`:8-10`）本身也写明 "The runner applies every migration in ONE transaction with `PRAGMA foreign_keys=ON`"——与 §8.4.2 的结论双向印证。`web_backend_schema.rs:89` 确设 `PRAGMA foreign_keys=ON`。

### 10.5 F-4 措辞更正——逐项核实（零字节改动）

- **§8.2 FK 可达边界成立**：`DELETE FROM candidates` 全仓唯一（`git grep` 于 `4dfc9e9` 与 `e84fab6b` 两树均只 1 处，另 `:286` 是 `DELETE FROM text_sources`，不同表）；三直改操作分别由 `editCandidate`（fn `:384`，守卫 `:400`）、`discardCandidate`（fn `:412`，守卫 `:424`）、`applyPreview`（fn `:465`，守卫 `:488`）以 `status='pending'` 为前提；且已晋级候选**没有任何路径回到 `staged`**（`'staged'` 只由 INSERT `:716` 写入，`:793`/`:804` 仅做 staged→pending 单向晋级）——故「FK 无需 ON DELETE 动作」的结论与更正后的可达边界论证均成立，初稿「候选行只改状态不删除」确属作废。
- **§8.2 不可变性更正成立**：`write_target`（`web_backend_store.rs:555-579`）对 INSERT/REPLACE/UPDATE/DELETE 一律抽取目标表名，再由 `:607 BUSINESS_TABLES.contains` 放行；`candidate_operations` 一旦入白名单，其上的 UPDATE/DELETE 机械上被允许，「仅 INSERT」精确模板只存在于 settings 两条款——「行不可变是服务层 append-only 协议性质」的表述比初稿准确。
- **§7 点名 `workspace_operations` 成立**：001:98 `CREATE TABLE workspace_operations`，`web_backend_store_tests.rs:193` 有显式越权 INSERT 拒绝用例（注释 `:191-192` 明写 "001 table but not in this slice's BUSINESS_TABLES whitelist"），`:195` 的 `PRAGMA user_version = 3` 同在拒绝清单内。

### 10.6 本轮新发现项

| # | 级别 | 内容 | 处置 |
|---|---|---|---|
| **N-1** | Minor→**实现轮必改** | `web_backend_store_tests.rs:530` `assert_eq!(response.result.unwrap()["value"], 3);`（`dispatch_maps_requests_to_responses`，fn `:521`）是 `web_backend_store_tests.rs` 的**第 4 处**版本字面量。R8 写「×3（:54/:62/:238）」、f34 日志 [7] 只取到请求行 `:526` 而未取到断言值行。004 落地后 `init_store` 的 `user_version` 为 4，该断言**必然破测** | R8 须改为 **×4** 并补 `:530`；源码级核实（本轮未跑 cargo，非运行级证据） |
| **N-2** | Minor | `business_table_whitelist_covers_the_fifteen_registered_targets`（fn `:416`）自带局部 `const BUSINESS_TABLES: [&str; 15]`（`:421`）镜像生产白名单。不改仍能通过（只遍历自己的列表），但函数名会变成假陈述、新表的正面路径无覆盖 | §8.4.1「新增用例面」已泛泛提到「store 层 16 表正面/负面」；建议点名该 fn 与行号，避免留下 "fifteen" 旧名 |
| **N-3** | Minor | §8.2 的 `text-intake-service.mjs:798` 对文档自述基线 `4dfc9e9` 正确，但当前候选 `e84fab6b` 中 staged DELETE 已移至 **`:809`**（staged→pending 晋级由 `:793` 移至 `:804`）。三个 pending 守卫 `:400/:424/:488` 未动；`src-tauri` 与 II 测试文件在两候选间 blob 一致，故影响清单其余部分不受新候选影响 | 文档已自带「后续 I/II 增量若移动行号，以事实为准重新核对」的口径；实现轮按 `e84fab6b` 现行号取源 |
| **N-4** | Minor | §8.4 守卫行称「违规说明文字中的版本枚举（001-004）同步更新」——该枚举在 `check-structure.mjs:300`，指的是**旧血统** `src-tauri/migrations/001_todos.sql`–`004_mcp_runs.sql`，与 web-backend/004 无关，**无需改文字**。另「与 003 现行模式一致」并非现状：`IMMUTABLE_MIGRATIONS` 目前只冻结 web-backend/001 与 /002（全文件 0 处 `003_text_intake`），003 的冻结仍是 III 的待办 | 改为「按 /002 现行模式（`:525-545` 三态自测）追加，003 冻结由 III 一并落地」 |
| **N-5** | Trivial | 「不受影响」清单部分引用指向查询行而非字面量行（`:345`→值在 `:347`、`:380`→`:382`、`:397`→`:399`、`:404`→`:409`）；crate `goto_up` 实为 `:618-651`（文档写 `:615-651`）；迁移清单在 `web_backend_schema.rs:31`（文档指向 fn `:30`） | 值与语义全部相符，仅指针风格；不影响结论 |

### 10.7 增量结论

**通过（限定于 F-3/F-4 的文档、影响清单与哈希面；不构成实施准入）**，附一项实现轮必改（N-1）：F-3 的 R1–R8/J1–J2 逐项按当前精确候选核实成立，补出的 R8 第三处版本断言（`web_backend_store_tests.rs:238`）确为真实遗漏项；§8.4.2「按起始版本分别定义回滚」的机制经源码直读与 P1/P2 真实迁移实证双向成立（v3→4 失败回 v3、v2 跨迁移失败整笔回 v2），003 既有回归断言组一字不改的要求正确；三个哨兵 4→5 必然破测经 P4 实证；F-4 的 staged 删除可达边界、服务层 append-only 性质与 `workspace_operations` 点名三项措辞更正均成立且未动冻结字节。004 提案字节仍为 `5de175b6…c5bf`（1774 B），`request_json` 不透明使文档更正不触及 DDL。

M-4 维持未闭合；004／第 16 表权限仍待队长判断是否需新增 owner 授权（D 申请 `01a1bc66` 的 SQL 字节与授权范围不变）；原 003 继续冻结；MAYNE-24 保持 in_progress，本轮不动状态。

### 10.8 本轮复跑说明

```sh
node build/web-text-intake-storage-decision-review/round4/kimi-f34-mechanism-probes.mjs   # P1–P5，exit 0，27/27 CONFIRMED
```

**复用未重跑**：ce1–ce6 与 `sh run-all.sh` 的既有通过证据、K1–K10（含 K7 生产同款 WAL 双连接串行化与 deferred 升级反向证据）按派开口径复用，本轮不整轮重跑；平台已回收早前 build 目录，上述材料的哈希与转录保留在 §3/§7/§8 与各轮证据包内。

### 10.9 本轮记录

- 审阅人：Kimi（`agent/kimi/mayne-24` @ `d8058c4` 之上；II 作者，未写存储提案、未写 I/III）。
- 材料：评论 `01a1bc68` 的 5 个附件（裁定文档、`f34-verification.log`、`f34-SHA256SUMS.txt`、`admission.json`、004 提案字节副本）经 CLI 读回；候选源码自本仓库 `4dfc9e9`／`e84fab6b`／`61a069b` 三个精确树取出。
- 写入登记：`build/web-text-intake-storage-decision-review/round4/admission.json`；本轮哈希清单 `round4/SHA256SUMS.txt`。
- 未做：未实现、未创建 `004_candidate_operations.sql` 生产路径、未改 server/src/src-tauri/tests/守卫/白名单/package、未跑 `npm run check`、未跑 cargo、未动 MAYNE-24 状态。
