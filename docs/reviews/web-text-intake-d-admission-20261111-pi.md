# MAYNE-24 D 授权材料整理（Pi，2026-11-11）

> **性质**：只读整理。本文件不实施 004、不扩白名单、不发真实请求、不替 owner 批准、不按草案开工。
> **状态**：D 仍未获 owner 批准；MAYNE-33 保持 `blocked`，等待原有必要授权。
> **整理范围**：仅从既有 MAYNE-24 评论、D 审批包与候选文档按有界读重建；事实／建议／未核验分列。
> **来源包**：`build/mayne33-d-admission/package/mayne33-d-admission-source-20261111.tar.gz`（随本卡评论附件交付），SHA-256 见 §6。

## 一屏摘要

| 项 | 内容 |
|---|---|
| **D 是什么** | 新增 `004_candidate_operations.sql`（5 列候选直改操作台账 + 同事务 `schema_meta` 到 4，runner 推进 `user_version` 3→4）；`BUSINESS_TABLES` 15→16 仅追加 `candidate_operations`；配套哈希冻结/三态自测、第四迁移与故障回滚、受影响断言与 edit/discard/applyPreview 幂等用例。目的是让三个候选直改操作满足冻结契约的跨重启／并发幂等（重放先于守卫、同键异体 409、只记成功、不耗版本）。 |
| **为什么需要新授权** | 仓库 `AGENTS.md` §4「授权」要求改 schema／migrations 单独授权；已批准的 MAYNE-24 A–C 只覆盖精确 003 与 15 表，未覆盖 004 与第 16 表。 |
| **独审状态** | Kimi `c642b45`（2026-11-08）**通过（限定于提案文档与证据面；不构成实施准入）**；Kimi `5a4f5f3`（2026-11-08）F-3/F-4 文档／影响清单／哈希面**通过**，附 1 项实现轮必改（N-1）。两者都不是生产／DDL 落地验收。 |
| **owner 已有答复** | 仅有 A–C 批准（`01a1bb58`，2026-11-08「批准」）与更早的 W1 A–D 批准（`01a1b80b`，2026-11-07）。D 申请（`01a1bc66`，2026-11-08T18:23Z）**无 owner 回复**；其后 owner 两条评论（`01a1c2a7`、`01a1c65a`）是进度询问与续推，不构成 D 批准。 |
| **决策点** | 是否批准 **MAYNE-24 D**（新增 004 迁移 + 第 16 写目标 + 配套冻结/验证）。这是本材料唯一新增审批项；不重复索取 A–C 或本地 Git 授权。 |
| **与 E／GAP-5／A–C 的边界** | E 是退出保证 B(a)（`01a1bfd2`，未批准，改公共保证）；GAP-5 是 lingering-tree 测试例暴露的 `verifyTree` 覆盖边界缺陷（未修）；A–C 是 003 + 15 表 + Runtime 打包。三者与 D 互不覆盖，D 不改变其中任何一项。 |
| **Pi 本地核验** | 004 SQL／审批包／001–003 哈希与包内清单**逐项复算一致**（§3）。未运行 ce1–ce6、未跑 SQL、未跑门禁。 |

## 1. 事实（Pi 从来源重建）

### 1.1 D 的精确范围（来源：`01a1bc66`）

| 项 | 具体授权 |
|---|---|
| **D1** | 精确 `004_candidate_operations.sql`：五列台账 ＋ 同事务 `schema_meta` 到 4，runner 推进 `user_version=4`；1774 B，SHA-256 `5de175b6f00ae40d8a1ed5272b6225dc5f98434815a1d089062ed34a7f39c5bf` |
| **D2** | `BUSINESS_TABLES` 15→16，仅追加 `candidate_operations`，保留真实 DML 解析及全部既有拒绝边界 |
| **D3** | 004 精确哈希冻结／三态自测、第四迁移与故障回滚、受影响断言和 edit/discard/applyPreview 幂等用例配套 |

原 A–C 与本地 Git 授权沿用；该包不是代码／业务验收或提前集成。

### 1.2 DDL 内容（来源：审批包 `materials/004_candidate_operations.proposal.sql`）

```sql
CREATE TABLE candidate_operations (
    operation_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
    action TEXT NOT NULL CHECK (action IN ('edit','discard','apply_preview')),
    request_json TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL
);
UPDATE schema_meta SET schema_version = 4 WHERE id = 1;
```

文件头部注明 `Status: PROPOSAL ONLY — not approved, not applied, not executed`，并指向 `docs/reviews/web-text-intake-storage-decision-20261108.md` §8 与两份冻结契约。

### 1.3 当前仓库基线（Pi 从本工作树读回）

| 面 | 本工作树（`5a5689d`，main `1e37044`） | W1 候选（`agent/claude/mayne-24`、`agent/kimi/mayne-24`） |
|---|---|---|
| `src-tauri/migrations/web-backend/` | `001_web_backend.sql`、`002_manual_items.sql` | 另含 `003_text_intake.sql` |
| `BUSINESS_TABLES` | `["manual_items", "manual_item_events"]`（2 项） | `[&str; 15]` |
| `check-structure.mjs` `IMMUTABLE_MIGRATIONS` | 无 `web-backend/003` | 含 003 精确冻结 |

因此 D2 的「15→16」是相对 **A–C 已批准的候选树**，不是相对本地 main；本工作树尚未接入 003。

### 1.4 独审状态（来源：MAYNE-24 评论）

- **Kimi `c642b45`**（`01a1bc59`，2026-11-08T18:08:59Z）：**通过（限定于提案文档与证据面；不构成实施准入）**。离线重建 22 个附件、实跑 `sh run-all.sh` 6/6 CONFIRMED；F-1（§8.3 `timeReviewed` 前提被冻结正文与候选 I 实现否证）与 F-2（ce2/ce3 证据不可复跑）已闭合；F-3/F-4 列为实现轮。
- **Kimi `5a4f5f3`**（`01a1bc7d`，2026-11-08T18:48:47Z）：F-3/F-4 文档／影响清单／哈希面**通过**，附实现轮必改 **N-1**（`web_backend_store_tests.rs` 第 4 处版本字面量，须改为 ×4 并补 `:530`）。
- **队长实施判据**（`01a1bc84`，2026-11-08T18:56:19Z）：N-1～N-5 逐条登记，含按目标表放行机制、`workspace_operations` 不可复用、旧血统 `001_todos`–`004_mcp_runs` 枚举不动。
- 两轮独审均**未跑 cargo／完整门禁**，均未创建 004 生产迁移、未改守卫/白名单/测试/生产代码。

### 1.5 owner 已有答复（Pi 从 MAYNE-17／MAYNE-24 评论核查）

| 评论 | 时间 | 内容 | 覆盖 D？ |
|---|---|---|---|
| `01a1b80b` | 2026-11-07T22:05:52Z | 「批准 W1 A–D」 | 否（更早的 W1 手工事项范围） |
| `01a1bb58` | 2026-11-08T13:27:51Z | 「批准」（MAYNE-24 A–C） | 否 |
| `01a1bc66` | 2026-11-08T18:23:01Z | D 申请（队长发出） | 申请本身，无 owner 回复 |
| `01a1c2a7` | 2026-11-09T23:32:10Z | 询问进展、要求拆子任务 | 否 |
| `01a1c65a` | 2026-11-10T16:46:30Z | 「继续，当前网络已经恢复…」 | 否 |

结论：截至本材料整理时，**D 无 owner 批准记录**；E（`01a1bfd2`，2026-11-09T10:19:39Z）同样无 owner 回复。

## 2. 与 E／GAP-5／原 A–C 的边界

| 项 | 内容 | 与 D 的关系 |
|---|---|---|
| **原 A–C** | 精确 003（5 新表 + 双表重建，`8e4e3159…7870`）、15 表写目标 + 两条并发模板、Pi Runtime 后端打包接入（`01a1bb58` 批准） | D 在其上**追加** 004 与第 16 目标；不修改 003、不重做 A–C。 |
| **E** | `01a1bfd2`：是否采用 r4 的 B(a)「登记域退出保证」，升级 `web-api/1→web-api/2`，在 worker／进程组／已登记成员退出条件满足后释放槽位；明确放弃「整棵进程树已灭绝」保证。**未批准**。 | D 不改退出语义、不改 `web-api` 版本、不碰 Runtime；两者是不同申请。 |
| **GAP-5** | 测试例名（lingering-tree）：夹具孙进程 detached 自成组、argv 无 `--run`，`verifyTree` 三重检查全盲返回**假 TRUE**，属生产侧覆盖边界缺陷（`01a1bee4` 登记）。 | D 不修复 GAP-5；GAP-5 是缺陷／验收边界，不是授权项。 |

## 3. Pi 本地核验（只读复算，非独审）

| 项 | 声明值 | Pi 复算 | 结果 |
|---|---|---|---|
| `004_candidate_operations.proposal.sql` | 1774 B / `5de175b6…c5bf` | 1774 B / `5de175b6f00ae40d8a1ed5272b6225dc5f98434815a1d089062ed34a7f39c5bf` | ✅ 一致 |
| `mayne-24-D-approval-20261109.tar.gz` | `af332316…d9c4` | 159591 B / `af33231651e1d5c43d7a33e92367a65cbe8b3feacf5316c2bbca2f0607d7d9c4` | ✅ 一致 |
| 审批包 `README.md` | — | `2d4ab0ab2478de803c7aaf325b4c05cc2674cfb662e7a48ea52b916a5b558aa0` | ✅ 与包内 `README.md` 同值 |
| 包内 `SHA256SUMS.txt` | 9 项 | `shasum -c` 9/9 OK | ✅ |
| `001_web_backend.sql` | `8511907c…143d` | 同值（本工作树 + 包内 `inputs/`） | ✅ |
| `002_manual_items.sql` | `b6cb8e61…f97e` | 同值（本工作树 + 包内 `inputs/`） | ✅ |
| `003_text_intake.sql` | `8e4e3159…7870` | 同值（包内 `inputs/` + 候选分支 `git show`） | ✅ |
| 包内 ce1–ce6／`run-all.sh`／`run-all.transcript.txt`／`verification.md`／`admission.json` | 清单登记 | `shasum -c` 全部 OK | ✅ |

`run-all.transcript.txt` 内含 6 个 `CONFIRMED` 判定与 1 行 `all 6 cases exit 0 — suite CONFIRMED`。

## 4. 建议（非批准，供 owner／Codex 裁定）

- **若批准 D**：按审批包精确字节落盘 004，并严格按 `IMPLEMENTATION-SCOPE.md` 的 N-1～N-5 与验证判据实施；实施后交未参与者独审，并在冻结实际集成 SHA/tree 上新跑一次完整 `npm run check`。
- **若不批准 D**：保持 M-4 未闭合，不得以 (a) `candidates.last_operation_id` 或 (b) 复用 `sign_off_batches` 临时实现（两者均已被 `ce1`/`ce3` 实质排除）。
- 本材料不新增任何审批点，也不替代 owner 决定。

## 5. 未核验／缺口（如实单列）

1. **Pi 未运行 ce1–ce6 或任何 SQL**：6/6 CONFIRMED 是 Kimi `c642b45` 的独立复跑结论（来源：`run-all.transcript.txt` 与 `01a1bc59`），Pi 只核验哈希与文本，未复跑探针。
2. **Pi 未验证候选树 15 表清单的具体内容**：只读回 `BUSINESS_TABLES: [&str; 15]` 声明与 003 哈希，未逐表核对。
3. **无 owner 决定**：D 申请后没有任何 owner 回复；本材料不推断「网络恢复＝批准」。
4. **独审面有限**：两轮独审均限定于提案／证据／文档面，未做生产 DDL 落地验收，未跑 cargo 或完整门禁。
5. **M-4／M-5 仍未闭合**：M-4 即本 D 提案面；M-5（回执/ACK 生命周期）与 D 无关，继续开放。
6. **未覆盖项**：真实模型／生产 OS provider／真实凭据／用户根／push／部署均不在 D 范围，本材料不涉及。

## 6. 来源包与 SHA 清单

包：`build/mayne33-d-admission/package/mayne33-d-admission-source-20261111.tar.gz`

| 文件 | 说明 |
|---|---|
| `PI-SUMMARY.md` | 本文件同一内容（一屏摘要 + 事实/建议/未核验分列） |
| `004_candidate_operations.proposal.sql` | D1 精确提案字节（`5de175b6…c5bf`） |
| `mayne-24-D-approval-20261109.tar.gz` | 队长发出的 D 审批包原件（`af332316…d9c4`） |
| `mayne-24-D/AUTHORITY.md` | 授权来源（`AGENTS.md` §4 + A–C 批准评论锚） |
| `mayne-24-D/IMPLEMENTATION-SCOPE.md` | D 实施与验证范围（N-1～N-5 配套） |
| `mayne-24-D/README.md` | D 授权内容说明 |
| `mayne-24-D/leader-verification.json` | 队长下载与逐字节核验登记 |
| `web-text-intake-storage-decision-20261108.md` | OpenCode 存储裁定（§8 提案与 ce1–ce6 论证） |
| `web-text-intake-storage-decision-20261109-kimi-review.md` | Kimi 独审记录（F-1～F-4） |
| `admission.json` / `verification.md` / `run-all.sh` / `run-all.transcript.txt` | 裁定附件与 6/6 复跑记录 |
| `ce1`–`ce6`（`.mjs` + `.out`） | 反例与正控脚本及原始输出 |
| `001_web_backend.sql` / `002_manual_items.sql` / `003_text_intake.sql` | 冻结输入字节 |
| `pi-verification.txt` | Pi 本地复算记录 |
| `SHA256SUMS.txt` | 包内逐文件 SHA-256 |

包 SHA-256 与大小见本卡评论附件说明；包内 `SHA256SUMS.txt` 可独立复算。
