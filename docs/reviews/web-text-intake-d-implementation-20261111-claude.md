# Web 文本整理候选直改幂等台账（004）实施记录（Claude，2026-11-11）

## 0. 必备字段

| 项 | 内容 |
|---|---|
| 范围与风险级 | MAYNE-33／owner 授权 D：新增 `004_candidate_operations.sql` 与第 16 张业务表、`edit`/`discard`/`apply_preview` 三直改族的持久幂等台账与规范输入接线。风险级：中（新增 DDL 与写目标，append-only，无快照/无 before-after）。 |
| 授权来源 | owner Mayne `[D批准；E选B(a)]`，MAYNE-17 评论 `01a1c890-956e-7b11-9745-cd5717ee7fc2`；决策申请 `01a1c884-b4a1-741a-9b1e-24d3be5c2fe6`；完整包 SHA-256 `9f29189ee8ada5ee170f76855a422b847e42638122d2e3971dc9bc6c60d2e647`。 |
| 基点 | 生产接续基点 `d70280c452038210c0ae6a60f980623de79c8d93`／tree `694dfd773e738dc7e337ccb54eca93d1f088530d`（MAYNE-30 独审 `a177d9240a5cc2e9a3e78eab902da4a31b2c7cf6` 通过）。主线只读基点 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`／tree `77a548591ac9b02a51936c806bf4f85d774df7cb`。 |
| 实际命令与退出码 | 见 §4 证据。 |
| 通过／失败计数 | Rust `web_backend*` 43/43 exit 0；结构自测 exit 0；`tests/unit/web-text-intake.test.mjs` 21/22（1 条为接续基线固有红，见 §5）；新增 HTTP 套件 11/11 exit 0。 |
| 未验证项 | 完整 `npm run check`、19 业务旅程、真实浏览器验收、main 合并、跨候选实际组合——均按派工不在本轮。 |
| 结论 | **三轮修订后限定通过（作者自报，待独审）**——已关闭 Codex 独审 `01a1c8e9` 的 F1（台账裁决先于目标存在性）与 F2（迁移中断矩阵）、复审 `01a1c911` 的"响应未知"证据缺陷（改由响应丢弃代理确定地阻断响应），以及三审 `01a1c928` 的 F3（夹具清理）。精确 004 与第 16 目标、三直改族重放/异体/守卫/重启/并发语义在真实 Rust 存储适配器与真实 HTTP 上闭合；不自签、不提前 done、不合 main。 |

## 1. 准入与基点安全方案

平台分配的工作树分支 `agent/claude/mayne-33` 起于空基线 `5fc5478`（父 `1e37044`，tree 与主线基点相同）。该分支**不包含**生产接续基点 `d70280c4`（`merge-base` 为 `1e37044`）。按本卡派工的基点安全指令，采用**本地 `--no-ff` 合并**把精确接续基点接入：一侧是空基线提交，故合并树与 `d70280c4` **逐字节相同**（`694dfd773e738dc7e337ccb54eca93d1f088530d`），零冲突，无 reset、无 stash、无 push、未写共享 main。合并提交 `a46e31e`，父为 `5fc5478`＋`d70280c4`。准入登记见 `build/mayne33-d-implementation/admission.json`（gitignored）。

接收材料：附件 `mayne33-d-admission-source-20261111.tar.gz`（232556 B，SHA-256 `7b0298485c5b95754223ba36162583ff7f7622052405b190f0246cd9d0c6a3db`，本地复算一致；包内 `SHA256SUMS.txt` 29/29 复核一致）。

## 2. 精确 004 与第 16 目标

`src-tauri/migrations/web-backend/004_candidate_operations.sql`：**1774 B，SHA-256 `5de175b6f00ae40d8a1ed5272b6225dc5f98434815a1d089062ed34a7f39c5bf`**，与提案字节逐字节相同（含 PROPOSAL 注释，以保持精确字节；批准事实记于本记录）。

- 仅新增五列 `candidate_operations(operation_id PK, candidate_id FK→candidates, action CHECK∈{edit,discard,apply_preview}, request_json, occurred_at_ms)`，同事务 `UPDATE schema_meta SET schema_version=4 WHERE id=1`。
- runner 迁移清单追加第 4 项，`PRAGMA user_version` 3→4；`SCHEMA_VERSION` 3→4。
- `web_backend_store.rs` `BUSINESS_TABLES` 15→16，仅追加 `candidate_operations`。台账 append-only 是**服务层协议**，不声称存储适配器已有 INSERT-only 模板守卫；DML 目标解析、子查询提名拒绝、`settings` 精确模板、`schema_meta`/`sqlite_sequence` 拒绝边界全部保留。
- 001/002/003 字节不动；`schema_meta`/`sqlite_sequence` 仍不在业务写白名单。

## 3. 服务层协议（text-intake-service.mjs）

三直改族共用同一协议（与 `signOff` 既有实现同型， ruler §8.2/§8.3）：

1. `operationId` 非空校验；
2. 计算**规范请求字节**（`canonicalize`，排序键紧凑 JSON）：
   - edit：`{action:'edit',candidateId,expectedVersion,input:<规范化input>,timeReviewed:<bool>}`
   - discard：`{action:'discard',candidateId,expectedVersion}`
   - apply_preview：`{action:'apply_preview',candidateId,runId,expectedVersion}`
3. **先查台账**（`SELECT request_json FROM candidate_operations WHERE operation_id=?`）：
   - 命中且字节相等 → 重读该候选**当前权威态**返回（200），不重复变更、不写事件、不消耗版本；
   - 命中且字节不等 → 409 `idempotency_conflict`；
   - 未命中 → 继续；
4. 目标存在性与状态/版本/发布围栏等守卫（**台账裁决先于目标存在性与全部守卫**：已用键即使另一个目标已不存在也答 409；未用键访问不存在的候选仍答 404 `candidate_not_found`）；
5. 变更 + 台账 `INSERT` **同一事务**提交；事务失败全回滚（含台账行）；
6. **任何失败都再裁决一次台账**（`runCandidateOperation`）：并发的同键请求可能在我们首次裁决之后、自己尝试之前提交。命中且字节相等 → 重放；不等 → 409；无行 → 原样重抛。该再裁决同时覆盖了"版本守卫因并发提交而失败"这一 check-then-act 窗口——同键同规范输入的并发竞争者答重放 200，而不是 `version_conflict`。

`timeReviewed` 与预览目标 `runId` 是行为性字段，已编入规范字节（ce6 B1–B5 裁定）。校验/守卫失败不占键；staged 候选不可直达（`status!='pending'` 拒绝），不落账。

## 4. 证据（实际命令与结果）

构建前置（派工允许"构建前置在外"）：`npm ci`（107 包）→ `npm run probe:prepare-cli`（lark-cli 1.0.98）→ `npm run probe:prepare-pi`（provenance tree `e89822b0`）→ `npm run probe:bundle` → `npm run build:backend`。

| 命令 | 结果 |
|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml` | exit 0 |
| `cargo clippy --all-targets -- -D warnings` | 3 条**接续基线固有**工具链漂移（`web_backend_store.rs:289` 的 `changes as u64`、`tray_icon.rs:12`、`mcp_formal_tests.rs:1387`）；对此三项加以放行后 exit 0，本增量新增代码零 clippy 告警 |
| `cargo test --lib web_backend -- --test-threads=1` | **43/43 exit 0**（含新增 `migration_004_*`、`migration_fault_after_004_*`、`migration_fault_after_004_on_v2_*`、`candidate_operations_ledger_*`） |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0（004 缺失/篡改拒绝、原字节通过三态） |
| `node scripts/checks/check-structure.mjs` | 仓库内容 exit 0（把平台注入的 `.claude/`、`CLAUDE.md` 暂时移出扫描后；工作树内 172 条告警全部来自这两个平台路径，与本增量无关） |
| `node --test --test-timeout=20000 tests/unit/web-text-intake.test.mjs` | 21/22（新增 9 例全绿；1 条固有红见 §5） |
| `node --test --test-timeout=20000 tests/integration/web-text-intake-candidate-operations.test.mjs` | **11/11 exit 0**（连跑两次均 11/11；真实 HTTP＋真实 Rust 适配器；三族重放/异体、双客户端并发、同根重启、台账裁决先于存在性、丢弃失败不占键、应用后当前态、经响应丢弃代理的三族响应未知重启＋正常响应控制组、代理未完成连接清理反例） |
| `node --check`（service／check-structure／新增套件） | exit 0 |

原始 TAP／HTTP 观察、清理证明与哈希清单见 `build/mayne33-d-implementation/`（gitignored），精选随本卡评论附件交付。

## 5. 接续基线固有红（非本增量引入，未修）

`tests/unit/web-text-intake.test.mjs` 的 `markNeedsReview releases the slot only on an observed exit` 在**接续基点 `d70280c4` 的原始测试字节上同样失败**（已用 `git show d70280c4:tests/unit/web-text-intake.test.mjs` 单跑复核：13 例 12 过 1 败，同一 `recoveryItemDockOp` 的 `state_conflict`）。根因是 MAYNE-30 C4 修订（`5623fae` 起）引入"恢复条目仍待核对，不能重复停靠"的围栏，而该用例仍期望第二次 `markNeedsReview` 成功。按派工"遗留 C4/recovery 受影响邻域保留正确语义、旧未决不被新数量覆盖"，本轮**不改**该用例、不改恢复语义，仅登记。

## 5A. Codex 独审驳回项的闭合（F1／F2）

Codex 独审 `01a1c8e9`（报告 `307700e`）判定 needs_revision／BLOCK，两项 P2 已在本修订关闭：

- **F1（台账裁决先于目标存在性）**：`editCandidate`／`discardCandidate`／`applyPreview` 原先先 `getCandidateRow` 后查台账，导致"复用已成功键＋换成不存在的候选"答 404 而非 409。现已把台账裁决提到目标存在性与全部守卫之前：已用键即使另一个目标不存在也答 409 `idempotency_conflict`；未用键访问不存在的候选仍答 404。单元与 HTTP 均补三族正反控（用键＋缺失目标→409；未用键＋缺失目标→404）。
- **F2（迁移中断与响应未知矩阵）**：
  - 新增 `migration_fault_after_004_on_v2_rolls_back_to_v2_and_retry_completes`：v2 种子＋`AfterFourth`，003 已在 pending 集合内执行、004 失败，整笔回 v2（表数 13／两版本镜像 2／`text_sources` 与 `candidate_operations` 均不存在／原行与高水保留），再正常重开至 v4——证伪"每迁移单独提交"。
  - 新增单元例：三族**同根重启**重放（edit／discard／apply 各一键，重开后逐键重放当前态、每键恰一行）；discard 失败不占键；apply 在后续编辑后旧键读当前态。
  - 新增 HTTP 例：**响应未知**重启——三族写请求先发后弃（用只读观测确认提交后再 abort，客户端始终拿不到响应），同根重开后逐键重放，版本均只前进一次、每键恰一行。**该实现未通过复审**：abort 晚于响应到达，三族实际都读到了 200；已由 §5B 的响应丢弃代理取代。
- 附带修正：新增 HTTP 套件的受控模型脚本把修订答案改为**常驻（`repeat: true`）**，否则一套多轮修订会让后续修订落到 extract 回退而被 revoke 成 `needs_review`（此前 6/6 的偶发失败源）。

## 5B. Codex 复审驳回项的闭合（响应未知）

Codex 复审 `01a1c911`（报告 `4544ad4`）确认 F1 已闭、F2 的迁移回滚／discard 不占键／apply 当前态／普通三族重启均通过，但指出上一轮的"响应未知"用例**实际已消费了成功响应**：`fireWrite` 的 fetch 成功回调读取了 status 与完整正文，主用例随后才 abort 并忽略 promise 结果；复审的观察副本显示三族均 `status 200, aborted false`。该声明不成立，本节为如实更正。

更正：**删除 `fireWrite`**，改为新增授权夹具 `tests/fixtures/web-text-intake/candidate-operations-response-dropper.mjs`——一个最小 HTTP 代理，把客户端请求转发给真实后端（重写 `Host`/`Origin` 使同源校验仍看到后端自己的 host），**丢弃全部上游响应字节**，并在首个响应字节到达时销毁客户端套接字。因此客户端**确定地**只看到传输失败，没有任何 status／正文，不依赖时序。用例逐族断言：

- 三族写请求在代理上发出后，**只读观测**确认台账落行（提交确实发生）；
- 客户端**未收到任何 status／正文**且传输失败（`outcome.status === undefined && outcome.transport` 非空）；
- 同根重开后以原键重放：当前态正确、版本均只前进一次、每键恰一行；
- 保留**正常响应控制组**（同一编辑走正常路径返回 200＋版本＋1）。

套件连跑三次均 10/10。后端实现未改（复审也明确无需重写）。

## 5C. Codex 三审驳回项的闭合（F3 · 夹具清理）

Codex 三审 `01a1c928`（报告 `b6107a1`）确认 F1／F2 已关闭、真实 HTTP 10/10，但指出响应丢弃夹具的 `close()` 清不掉未完成连接：夹具是 `net.Server`，**没有** `closeAllConnections()`（可选调用无操作），且未跟踪套接字；`server.close()` 会等待活动连接，半截 HTTP 请求＋不响应上游时 finally 无法自行收尾。

更正（仅夹具与聚焦回归）：

- 夹具改为**跟踪**每个客户端／上游套接字（`Set`，连接关闭时移除），`close()` 先停止接入、再**显式销毁**所有本夹具持有的套接字，最后完成收尾；删除对不存在方法的依赖。
- 新增聚焦回归 `the response dropper closes unfinished connections without external intervention`：合成静默上游（接受但永不响应）＋客户端只发半截请求头并挂起，等夹具的上游套接字建立后调用 `close()`，断言**无需任何外部销毁**即在 2s 内完成。该反例在**修复前失败**（约 2s 超时），修复后约 70ms 通过。
- 三族真实丢包／重启证明（F2）逐字节保留，套件 11/11。

## 6. 写入范围与边界

写入：精确 004；`web_backend_schema.rs`／`_tests.rs`；`web_backend_store.rs`／`_tests.rs`；`server/lib/text-intake-service.mjs`；`scripts/checks/check-structure.mjs`（仅追加 004 冻结哈希与三态自测）；`tests/unit/web-text-intake.test.mjs`（仅追加）；新增 `tests/integration/web-text-intake-candidate-operations.test.mjs` 与 `tests/fixtures/web-text-intake/candidate-operations-response-dropper.mjs`；两处既有 schema 断言 3→4；本记录与 `build/mayne33-d-implementation/`。

未写：浏览器源文件（稳定 operationId 与套件聚合保留后继）；公共 README／manifest／package／版本 2 规范／前端／Runtime／vendor／锁／依赖／identifier；001/002/003 冻结字节；main 合并／push／远端 PR／部署／真实凭据／真实模型／用户根。

观察（不改）：`check-structure.mjs` 的 `IMMUTABLE_MIGRATIONS` 在本基点**不含** `web-backend/003_text_intake.sql`（该冻结由候选 III `ff287ab` 承载，未并入本基点）。按派工"仅追加 004"，本轮只追加 004；003 的登记缺口交回队长裁定。

## 7. 结论

授权 D 的精确 004、第 16 目标与三直改族幂等台账已在真实存储适配器与真实 HTTP 上闭合：台账裁决先于目标存在性与全部守卫、重放先于守卫、异体 409、守卫失败不占键、变更与台账同事务、任何失败再裁决（并发同键竞争者答重放）、跨重启可用、三族响应未知重启单一应用。Codex 独审两项 P2（F1／F2）已闭合。**作者不自签、不提前 done、不合 main**；后继浏览器稳定 operationId 与套件聚合、E 的生产实施与最终组合验收另派。
