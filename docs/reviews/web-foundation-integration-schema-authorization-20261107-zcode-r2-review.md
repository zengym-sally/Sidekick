# W0 schema 授权提案修订增量独立复核（ZCode R2）：通过；R1–R3 与裁定全部落实，平台快照已核对

评审对象：Claude 按 2026-11-07 队长技术裁定与 ZCode 首轮评审 R1–R3 完成的修订待批版。提案文档 SHA-256 `bc8876c3e705e6ca1fbe83605e48e9af6c366945e561f0954c1ca2c906d9f706`，DDL 参考件 SHA-256 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`，manifest SHA-256 `e700eb19e3671f4f72758d032d5940720fde8314cfc9b2d8e2d8b115174facb1`（评审者复算）。评审人 ZCode，未参与修订撰写；实现与作者提案全程只读。派发来源：Codex 触发评论 `01a1b603-4eef-7ba5-9b81-df3417c9b40b`（沿首轮结论，只复核增量，不重开已通过且未改部分）。原始证据：`build/mayne22-schema-r2-review/`（本树，未入库路径）。上轮记录：`web-foundation-integration-schema-authorization-20261107-zcode-review.md`。

## 0. 结论

**修订增量复核：通过。** 无 BLOCKER、无 MAJOR；1 NIT（不阻塞，批准登记时可顺手修正）。触发指令的四项要求全部满足：

1. **R1–R3 与队长裁定已落实**（§3–§6）；
2. **1a/1b 绑定最终内容成立**（§7）：1a 显式含 `task_result_payloads`；1b 以修订后完整 DDL 哈希 `8511907c…143d` 绑定，该哈希在文档内嵌三处、manifest 一处，评审者逐字符比对与附件字节一致；
3. **1d 已有逐文件可审批范围**（§7）：三个确切文件＋两个确切动作＋触发条件，可逐项批准或否决；
4. **平台最终快照已生成并独立核对**（§1）：run-end 自动提交 `598d2daf9db8ab66c9760c585af7045f87eac466`（分支 `agent/claude/mayne-22`，父 `8a2a628`），其被跟踪文件内容与评论附件逐字节一致；DDL 与 manifest 位于 gitignored `build/`，按内容哈希绑定（不存在对应提交号，无猜测值，亦无「待补」——提案文档自身的提交号已闭合）。

**审批状态不变**：AUTH-SCHEMA-1a–1d 仍全部「待批准」；审批链与 W0 准出由 Codex 收口。**R5 签发范围声明**：ZCode 的 R5 APPROVE 仍仅覆盖 `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3` 的既有实现，不签任何未来 schema 实施；1d 的触发复核将发生在实施切片之后。本项保持 `in_progress`。

## 1. 完整性、平台快照与「未实施」核实

| 项 | 结果 |
|---|---|
| 附件哈希 | 提案 `bc8876c3…f706`、DDL `8511907c…143d` 与触发指令所给值**逐字符一致**；manifest `e700eb19…acb1` 为本轮新登记值 |
| 平台快照 | `598d2da`（"chore(agent): uncommitted changes from task"，父 `8a2a628`）已由平台 run-end 生成于交付评论之后（本地时间 20:38，交付评论 20:36）；其唯一被跟踪文件 `docs/reviews/web-foundation-integration-schema-authorization-20261107.md` 内容 SHA-256 与附件**逐字节一致** |
| 提交号解析 | manifest `proposal_commit` 字段登记为 `pending-platform-auto-commit`；现可解析为 `598d2da`（评审者观测值，非作者登记；若后续快照变化以新哈希为准） |
| 未实施核实 | `git diff --stat 8a2a628 598d2da` 恰为 1 个文件（提案文档）；快照树内**无** `src-tauri/migrations/web-backend/`、无 `web_backend_schema.rs`——「未创建迁移文件、未改 runner」在树级成立 |
| 增量基线 | 首轮三附件本轮重新下载复算：文档 `bcade0aa…bd447`、DDL `7c2908a…de290442`、manifest `c79485ea…cb367`，与首轮登记一致，作为增量 diff 基线 |
| 依据复算 | 契约 `61863271…b86f58d`（blob `6943151e…`）在 `598d2da` 与 `8bd29c4` 双点核对逐字节一致；设计 `d318e525…255387`（blob `2e6c75cc…`）一致；集成补丁 `93506543…3745e` 首轮已复算且本轮未涉 |

## 2. 修订增量边界（不重开清单）

**DDL（`7c2908a` → `8511907c`）恰为三处**：头注释（修订说明）；R1 部分唯一索引（1 行）；`task_result_payloads` 注释由「提案补充须审批」改为「裁定采纳、显式入 1a」。**11 张表定义逐字段未动**——首轮「§12 九对象全部逻辑字段落地、状态枚举一致、三条机械不变式反例成立、四索引满足」的结论对表体**原样沿用，不重开**。

**文档增量**全部落在裁定与 R1–R3 相关处：§5.2 schema 层强制表述、§5.11 索引汇总加行、§7.4 流程第 5 步＋依据＋5 组反例、§8 两反例段、§2 技术裁定行、§4 新库路径定案、§5.1 submit_seq／attempt_budget／progress、§5.10 裁定状态、§5.3 留存表述、§9 授权清单改写、§10 未决→逐项处置、§11 版本与哈希。未动部分（§3 既有迁移对照、§6.2 数据影响、§7.1–7.3 回滚／备份、fencing 设计）不重开。

## 3. R1 落实（独立复验通过）

DDL 第 71 行 `CREATE UNIQUE INDEX task_attempts_current ON task_attempts(task_id) WHERE ended_at IS NULL;` 与首轮评审建议**逐字一致，无豁免条款**；§5.2 改为「由 `task_attempts_current` 在 schema 层强制；调度器不再仅靠纪律保证」；§5.11 登记；§8 反例双场景如实标注「受控并发，实施验收时」。独立复验四项（内存库）：同任务第二未结束 attempt 被 UNIQUE 违例拒绝；首个 `ended_at` 置非空后新 attempt 可插；历史多条已结束＋一条未结束合法；跨任务互不影响；`index_info` 恰 `[task_id]`、谓词与 UNIQUE 语义核对成立。

## 4. R2 落实（依据源码级核实＋独立复验通过）

§7.4 第 5 步：`PRAGMA user_version` 与 `schema_meta.schema_version` 不等即 `SCHEMA_VERSION_MISMATCH` 显式拒绝，**不自动修复、不回写**；检查顺序在 lineage 之后、too-new 之前。**依据逐行核实**：`Cargo.lock` 锁定 `rusqlite_migration 2.5.0`；本地 registry 源码 `src/lib.rs:627-653` 的 `goto_up` 为 `conn.transaction()` → 循环 `tx.execute_batch(m.up)` → `set_user_version(&tx, target_version)` → `tx.commit()`——单事务、迁移 SQL 与版本号原子提交，与提案引用**逐字吻合（含行号）**，依据真实。五组反例独立复验全部与提案表格一致；另加两项：(a) 不自动修复语义为纯检查（mismatch 时两侧均无写入）；(b) 裸 `executescript` 应用 DDL（不经 runner）后 `user_version=0`／镜像 `1`，落入 (0,1) 拒绝路径——证明权威确在 `user_version`，镜像不能独立开库。

## 5. R3 落实

manifest 分列 `basis_commit=8a2a628…`（tree `91b1f92e…`）与 `proposal_commit=pending-platform-auto-commit`（§1 已解析观测）；未手工 commit 属实（树级 diff 佐证）；manifest 不含自身哈希、文档 §11 明示「本文件，不自称哈希」且内嵌修订 DDL 哈希三处（逐字符一致）。首轮指出的登记瑕疵闭合。

## 6. 队长裁定落实（8 项逐项）

| 裁定项 | 落点 | 核对 |
|---|---|---|
| payloads 采纳、显式入 1a | DDL `task_result_payloads`；§5.10「裁定状态：采纳」；§9 1a、manifest authorization 块 | 成立 |
| 路径 `<workspaceRoot>/data/web-backend.sqlite` | §2 裁定行、§4 定案表述、manifest | 成立 |
| submit_seq 提交事务内 MAX+1、UNIQUE 保留 | §5.1 明文；DDL `submit_seq INTEGER NOT NULL UNIQUE`（MAX+1 属写侧纪律，schema 只保 UNIQUE） | 成立 |
| progress 不持久化 | §5.1「不新增业务持久字段」；DDL `tasks` 无 `progress` 列（复验） | 成立 |
| attempt_budget 默认 2、首次另算、可配置、提交注入；DDL 缺省 0 保留 | §5.1、§5.9、§10；DDL `DEFAULT 0`（复验） | 成立 |
| 索引谓词按冻结契约 | §5.11；实施时 `EXPLAIN QUERY PLAN` 复核留待实施切片 | 成立 |
| 事件留存随 W1 定案、短期有界＋快照补偿、不裁剪回执 | §5.3、§10 第 7 行、manifest | 成立 |
| lineage/application_id `0x57424b31` | DDL 第 14 行；复算十进制 `1463962417` 与首轮一致 | 成立 |

## 7. 授权清单终态

**1a**：拟批内容含「明确包含 `task_result_payloads`」，与裁定绑定。**1b**：绑定修订后完整 DDL 哈希 `8511907c…143d`（文档 §9 与 manifest deliverables 双登记、字节级一致）——绑定最终内容成立；若批准后 DDL 再变，须以新哈希重新登记。**1c**：范围未变（仅新建库、旧库不动、无数据迁移），首轮结论沿用。**1d**：逐文件列明 `src-tauri/src/store/web_backend_schema.rs`（runner＋lineage／版本校验＋WAL／foreign_keys／synchronous＋备份接口）、`src-tauri/src/store/web_backend_schema_tests.rs`（单测覆盖点名迁移幂等、R2 反例、R1 反例、各表约束）、`src-tauri/migrations/web-backend/001_web_backend.sql`；动作＝`cargo test --lib web_backend_schema`（`--test-threads=1`）与 `npm run check`；触发条件「完整 `npm run check` exit 0 且增量复核通过」。可逐文件批准或否决，**满足逐文件可审批要求**。注：既有 R5 绿证（`7f536db`）针对 `8bd29c4`，不预支 1d——其门禁须在实施切片产出后重跑并复核。

## 8. 本轮独立验证

评审者自有脚本（`build/mayne22-schema-r2-review/verify/verify_r2_increment.py`，`python3 -I` 内存库，独立于作者引擎）**21/21 exit 0**：11 表、application_id、R1 四场景＋索引形状、R2 五组＋不自动修复＋裸脚本路径、三约束反例、attempt_budget 缺省 0、submit_seq UNIQUE、无 progress 列、payloads CHECK。作者声明 16/16 exit 0（manifest verification 块）与评审者独立复验一致；作者验证日志本轮未随附件交付，其登记哈希（`b807018e…`、`747614ac…`）未独立复算，不影响本轮结论（评审者已覆盖同等地面）。

## 9. 发现

- **NIT-1（不阻塞）**：§1 第 9 行「`AUTH-SCHEMA-1` **原**阶段不可批」应为「**现**阶段不可批」——首轮稿为「现阶段」，修订时误改；该句引述首轮评审结论（上轮记录 §1）。批准登记时顺手修正即可，不影响语义可复原性。
- **观察**：§7.4 R2 反例表末行「`schema_version` 缺失 → `SCHEMA_LINEAGE_MISMATCH`」实际先由第 4 步 lineage 检查命中（无 `schema_meta` 行即 lineage 不符），列于 R2 表下属归因表述而非错误，结果正确。
- **观察**：作者验证日志未随本轮附件，后续如需审计可由作者补交或引用其树内路径。

## 10. 边界

实现与提案只读；本轮仅写本记录与 `build/mayne22-schema-r2-review/`（含下载件、diff 记录、验证脚本与输出、hash-manifest）。验证全部内存库／合成数据；未跑完整重门禁、未创建迁移、未触真实库／凭据／工作根。本项保持 `in_progress`；本评审不自签 done、不关闭 W0、不推进 W1、不签未来 schema 实施。
