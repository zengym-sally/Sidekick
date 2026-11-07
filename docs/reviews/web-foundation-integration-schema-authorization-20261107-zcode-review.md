# W0 schema 授权提案独立评审（ZCode）：提案质量通过，附两项批准前条件；W0 准出与其余授权保持开放

评审对象：`8a2a62878127a9c4e313616c6f6bfd9f48fa75be`（分支 `agent/claude/mayne-22`，tree `91b1f92edaf72af4ff63398238976ede09aacbe5`，父 `507c49af2cbb0f52a0483c681d0f254fc2023aa8`）。评审人 ZCode，未参与该提案撰写；实现与作者提案全程只读。派发来源：Codex 触发评论 `01a1b5e7-5383-7e31-aea9-63d4026b4d38`（与 OpenCode 完整门禁补跑并行、互不依赖）。原始证据：`build/mayne22-schema-review/`（本树，未入库路径）。

## 0. 结论

**提案质量：通过（附两项批准前条件 R1、R2，均不构成契约变更）。** 无 BLOCKER、无 MAJOR。

**审批状态不变**：AUTH-SCHEMA-1a–1d 仍全部「待批准」；W0 准出、契约冻结、MAYNE-23 晋级仍由 Codex 收口。本提案获批不等于实施已执行，`task_result_payloads` 的批准须显式落在 AUTH-SCHEMA-1a 内，不因提案写入而视为已批，也不构成 `web-api/1` 的契约变更。

## 1. 完整提交与哈希核对（全部独立复算）

| 项 | 结果 |
|---|---|
| 提交完整性 | `8a2a628` 仅新增 1 个文件 `docs/reviews/web-foundation-integration-schema-authorization-20261107.md`（398 行），无其他路径改动 |
| 提案哈希 | 提交内容 SHA-256 `bcade0a…37bd447`，与评论附件**逐字节一致** |
| DDL 参考哈希 | 附件 SHA-256 `7c2908a…de290442`，与作者 manifest 声明一致 |
| manifest 本体 | SHA-256 `c79485e…51fcb367`（评审者复算）；其 `deliverables`/`integration_candidate`/`basis`/`evidence_downloads` 四块声明逐项核对通过 |
| 基点树 | 父 `507c49af` tree `08694173…`，与集成基座 `9ad2d61` tree 相同——提案确实撰写在已冻结集成内容之上 |
| 契约依据 | `docs/engineering/web-api-contract.md` SHA-256 `6186327…b86f58d`、blob `6943151…`；且该文件在 `8bd29c4` 上**逐字节相同**（独立复算）——「提案与已冻结 web-api/1 相容」的前提成立 |
| 设计依据 | `docs/engineering/web-backend-design.md` SHA-256 `d318e52…dc255387`、blob `2e6c75c…`，一致 |
| 既有迁移 | `001`–`005` 五个 SHA-256 全部复算一致；旧 lineage `application_id=0x53444b31`（`001_todos.sql:1`）与 §3 表清单（含 `agent_runs_v4`/`v5` 重建临时表）属实；旧 runner 以 `PRAGMA user_version` 记账属实 |
| 依赖声明 | `rusqlite =0.39.0`（bundled+backup）与 `rusqlite_migration =2.5.0` 已锁定于 `src-tauri/Cargo.toml:22-23`，「沿用已锁定迁移工具」属实 |
| OpenCode 证据交叉核对 | manifest 引用的 `admission.json`（`1741862…5f0e11`）与 `delivery-summary.json`（`856a8b0…c2b62e`）两附件由评审者独立下载复算，一致 |

发现一处登记瑕疵（不阻塞，见 R3）：manifest 的 `commit` 字段登记的是基点 `507c49af`（提案 §2 同），未写交付提交 `8a2a628`。

## 2. 提案与 web-api/1 的相容性（逐项，独立判定）

**逐表核对：§12 九个对象的全部逻辑字段在 DDL 中逐一落地，无遗漏、无擅自改名。** 状态枚举（`tasks.state` 八值、`attempt_exit_state` 五值、`pending_outcome`、`recovery_items.verification_state`/`decision`、`workspace_operations.kind/state`、`recovery_holds.cause`）与契约 §3.2/§3.5/§4.5/§8.3 一致。三条机械不变式经反例验证成立：暂存信封配对（`result_pending_exit=1 ↔ pending_outcome` 非空）、终态 `terminal_at`（三个终态必须有、非终态必须无，双向拒绝）、`recovery_items.decision ⇒ decided_by/decided_at`。

**索引：契约 §12 点名的四个索引全部满足**（`tasks(operation_id)`、`tasks(submit_seq)` 由 UNIQUE 隐式建立，`tasks(state)` 部分索引含全部非终态，`task_events(object_type,object_id)`）；`task_events_epoch_cursor` 与 `tasks_exit_state` 为提案补充，依据充分（重连补偿与槽位核算）。

**fixture 状态可表示性（本评审新增验证，作者未做）**：用真实契约 fixture 核对 DDL 可表达契约全部状态——回收前 `needs_review`（`resultPendingExit=true`、`result/failure=null`，fixture `task-result-exit-unconfirmed.json`）由 `pending_outcome` 暂存表示；回收后（`resultPendingExit=false`，fixtures `task-needs-review-exit-reclaimed.json`、`task-failed-result-reclaimed-needs-review.json`）暂存信封迁入 `result_ref`/`failure`、`pending_outcome` 由 CHECK 强制清空，恰与契约「暂存结局转为可见」的读白名单语义吻合。结论：**DDL 可表示 web-api/1 全部场景状态，回收事务须在同一 UPDATE 内完成信封迁移**（写侧纪律，非 schema 缺陷）。

**`task_result_payloads`（提案补充表）**：契约 §12 未列、但 §4.3 要求持久不透明字节与 `result://<attemptId>/<name>` 寻址，`tasks.result_ref` 只是信封。该表 PK `(attempt_id,name)`、FK、`CHECK(total_bytes=length(payload_blob))` 与 §4.3 寻址/分段协议吻合；与库同存使备份原子性天然成立。作者已明确标注「须审批确认」，处理方式正确。**批准与否是实施切片对持久化机制的定案（契约 §12 明言「表名与类型由实施切片定案」），不属于 §14 意义上的契约变更；但必须显式获批**——若 Codex 否决入库方案，须另行交代 §4.3 持久化与备份原子性（作者已写明此义务）。

**新 lineage 与旧库隔离**：`schema_meta` + `application_id=0x57424b31`（"WBK1"，≠旧 "SDK1"，评审者复算十进制 `1463962417` 与提案 §8 一致）；§7.4 打开校验对 lineage 不符、过新、损坏、旧格式库均显式拒绝，不静默新建/合并/续用——与契约 §12 迁移建议及「无迁移桥」裁定一致。旧 runner 以 `user_version` 记账、新 lineage 另立 `schema_meta`，两套机制不冲突（见 R2 的同步要求）。

**回滚与恢复**：§7.1 单事务迁移失败整体回滚（评审者以事务内注入失败复现，回滚后零表残留）；空库回滚=删库、已有数据回滚=备份还原而非版本回退，方向正确。验收命令（§8）全部标注为实施后执行，未冒称已测；fencing 反例（取消/领取竞争、旧 epoch 晚到拒绝、`exited_unknown` 占槽 409）与契约场景 5/6/19/28/29/30 对得上。

**审批动作具体性**：AUTH-SCHEMA-1 拆为 1a–1d，逐项有拟批准内容、触发条件与「待批准」状态；1d 自身触发条件（完整 `npm run check` exit 0 + 独立复核）与上轮评审对 AUTH-GIT-1 的收紧建议同构。对比上轮「不可批」的三项缺位（逐表 DDL、表清单、回滚说明），本轮全部补齐且具体到可逐条批驳——授权包形式要件成立。

## 3. 受控验证（内存库，22/22 通过）

方法：`node:sqlite`（SQLite 3.53.4，Node 24.20.0）对附件 DDL 逐字节应用——独立于作者的 python3 引擎交叉复证。脚本与完整输出：`build/mayne22-schema-review/scripts/verify-schema.mjs`、`verify-schema-result.md`（exit 0）。

- 作者三项反例全部复现（非法 `state`、暂存无 `pending_outcome`、终态无 `terminal_at`），另加第 4 反例（非终态带 `terminal_at`）；
- 11 表建成、`schema_meta` 行正确、`application_id` 十进制/ASCII 核对；
- FK 语义实测：孤儿 attempt 在 `foreign_keys=OFF` 时**被接受**、`ON` 后被拒——实证 §4「外键由连接打开时设置」为强制性要求而非风格偏好；
- 部分索引 `tasks_exit_state` 实测恰好覆盖 `active/exiting/exited_unknown`（占槽集合），终态/未启动排除；
- `task_result_payloads` 的 `total_bytes=length` 与复合 PK 均实测拒绝反例；
- 单事务迁移：注入失败后 ROLLBACK，零表残留（对应 rusqlite_migration 每迁移一事务语义）；
- 其余：`task_events` AUTOINCREMENT 游标删除后不复用、`object_type` 枚举恰为 SSE `objectType` 四值、`recovery_holds.cause` 取 `root_import`（契约 §12 简写 "import"，DDL 取 §3.5 规范值——正确选择）、settings/workspace_operations 枚举与版本约束、epoch 时间序 CHECK。

边界：仅内存库与合成数据；未创建迁移文件、未改 runner、未跑完整重门禁、未触真实库/凭据/工作根。

## 4. 发现清单

**R1（MINOR，建议作为 AUTH-SCHEMA-1a 批准前条件）**：§5.2「每任务任一时刻至多一个未结束 attempt」仅靠调度器串行纪律保证，schema 层未强制；而 API 的「当前 attempt」推导（`ended_at IS NULL`）与 fencing 都依赖该不变式。建议在 001 加入部分唯一索引（评审者已验证其与契约各状态相容：取消/回收/重试路径旧 attempt 均先闭再开新）：

```sql
CREATE UNIQUE INDEX task_attempts_current ON task_attempts(task_id) WHERE ended_at IS NULL;
```

或由 Codex 在 1a 中明示接受调度器纪律为唯一保障。两者择一，不允许默认放行。

**R2（MINOR，随 AUTH-SCHEMA-1d 定案）**：`schema_meta.schema_version` 与 `PRAGMA user_version` 是两个版本源——rusqlite_migration 以 `user_version` 记账，001 只写 `schema_meta`。须在 runner 接线时定单一权威（建议：`user_version` 为迁移账本；每个迁移文件末尾同事务 `UPDATE schema_meta`，校验逻辑以两者一致性为前置），否则未来 002+ 可漂移、§7.4 第 5 步判定失真。001 本身不受影响。

**R3（MINOR）**：manifest `commit` 字段（及提案 §2「本提案基点」行）登记基点 `507c49af` 而非交付提交 `8a2a628`。内容完整性已由附件哈希覆盖，不阻塞；建议 manifest 补一行交付提交号，形成 提案→提交→附件 的完整审计链。

**R4（NIT）**：DDL 手工应用后 `user_version=0`（§8 手检「期望 1」是 runner 应用之后的值）；提案宜注明 runner 外手工应用不受支持（该路径会因 §7.4 第 5 步重复应用而失败——该失败本身是防护，不是缺陷）。

**R5（NIT，可选加固，不要求）**：可考虑 `CHECK (exit_confirmed_at IS NULL OR ended_at IS NOT NULL)`（退出确认不得先于结束记录）与暂存期 `result_ref`/`failure` 为 NULL 的 CHECK；二者现由写侧纪律保证，加入需重验，非批准前必需。

**观察项（非缺陷）**：① DDL `recovery_holds.cause` 用 `root_import` 而契约 §12 行内简写为 `import`——以 §3.5 规范 union 为准，DDL 选择正确，建议契约维护时统一措辞；② Claude 树结构守卫 177 违规全部来自平台目录（`.claude`/`.multica`/`CLAUDE.md`）与既有 3 个 vendor `ref.missing`，与我上轮在 ZCode 树观察到的 `.zcode` 同类，属平台环境观察，MAYNE-18 白名单补丁按登记由唯一集成执行者树收口；③ 提案无相对文档链接，并入 `docs/reviews/` 不影响 `check:docs`。

## 5. §10 八项未决逐项分类

判定标准：**契约已定**＝现有已冻结契约/设计已确定其语义或选择，剩余为实施落实；**队长裁定**＝契约留白、属技术方案取舍，由 Codex 裁定；**owner 选择**＝涉及产品承诺、数据布局或既定五项方向之外的取舍。

| # | 未决项 | 分类 | 建议与依据 |
|---|---|---|---|
| 1 | `task_result_payloads` 是否入库 | **队长裁定**（Codex） | 建议采纳（§4.3 持久化+备份原子性论证成立，评审实测约束有效）；裁定后须**显式写入 AUTH-SCHEMA-1a** 获批——这是实施定案，不是契约变更；否决则须另行交代持久化与备份方案（提案已自设此义务） |
| 2 | 新库文件确切路径 | **队长裁定**（Codex） | 契约/设计均未定路径；建议采纳 `<workspaceRoot>/data/web-backend.sqlite`（符合单工作根既有布局：`data/` 已有 `sidekick.sqlite`）；路径随实施切片授权落定即可，无 owner 阻塞项 |
| 3 | `attempt_budget` 默认值 | **队长裁定**（Codex） | 语义契约已定（§4.6 耗尽行为、`retry` 重置），仅数值留白；建议与 `agentConcurrency` 同置实例配置（owner 已确认方向），初始值建议 2–3；裁定结论随 product/05 登记供 owner 知情，不必 owner 单独批准 |
| 4 | `submit_seq` 分配策略 | **契约已定**（机制属实施细节） | 语义已定（实例内持久 FIFO、UNIQUE、按此分页）；提案建议「提交事务内 `MAX+1`」可作为实施采纳值，无需再裁 |
| 5 | `application_id` 取值 | **队长裁定**（Codex） | 技术常量，契约留白；建议照案采纳 `0x57424b31`（"WBK1"≠旧 "SDK1"，已实测无冲突） |
| 6 | 部分索引谓词（`tasks_state_active`） | **契约已定**（谓词细节属实施验证） | 契约 §12 已要求 `tasks(state)` 部分索引；谓词覆盖非终态是合理实现，实测按索引查询与全表计数一致；实施时按提案建议以 `EXPLAIN QUERY PLAN` 复核即可 |
| 7 | `task_events` 留存期限 | **队长裁定**（Codex） | 策略形状契约已定（「短期有界 + 快照补偿」，§6）；仅数值留白，建议给出初始值（如 7 天或行数上限）随实施切片定，并在快照补偿路径上有验收 |
| 8 | `progress` 是否持久化 | **契约已定** | §3.1 明文「仅展示，不作为业务事实」；采纳提案建议不持久化，由 `task_events`（`task.progress`）与 worker 内存态派生 |

小结：八项中**无一项需要 owner 现在裁决**；#4/#6/#8 现有契约已定，#1/#2/#3/#5/#7 待队长技术裁定。裁定结论建议随批准登记 product/05 供 owner 知情。

## 6. 审批动作建议（供 Codex 收口，均未获批）

- **AUTH-SCHEMA-1a**（schema 设计）：建议可批，附 R1 条件（加部分唯一索引，或明示豁免并记录理由）与 §5 表格中 `task_result_payloads` 的显式纳入/否决决定。
- **AUTH-SCHEMA-1b**（创建迁移文件 `src-tauri/migrations/web-backend/001_web_backend.sql`）：1a 收口后可批；若按 R1 修订 DDL，则以**修订后新哈希**重新登记为准，现哈希 `7c2908a…` 只对应当前参考件。
- **AUTH-SCHEMA-1c**（仅作用新库、旧库不动、零数据迁移）：建议可批——§7.4 校验实测可拒旧格式库，与「node:sqlite 不得按路径重开业务库」及无迁移桥裁定一致。
- **AUTH-SCHEMA-1d**（runner 接线）：按其自身触发条件**尚不可批**（完整 `npm run check` exit 0 + 独立复核）；届时按 R2 定版本源权威。
- 与 OpenCode 门禁补跑的关系：本评审不依赖、不代替其结果；W0 准出仍以「完整门禁绿证 + 本提案批准链闭合 + Codex 宣布」为准。

## 7. 评审边界

实现与作者提案只读；写入仅本记录与 `build/mayne22-schema-review/`；验证全部内存库/合成数据，未跑完整重门禁（结构守卫不受 docs+build 写动影响，上轮已在其树定性，完整门禁仍归唯一集成执行者串行补跑）、未创建生产迁移、未动真实库/凭据/工作根。本项保持 `in_progress`；本评审不自签 done、不关闭 W0、不推进 W1。P3 台账维持原登记，不因本评审扩大。
