# C-4 修订：classify 扫描时围栏与 dock 提交时前提（MAYNE-30，2026-11-11，Claude）

- **任务来源**：MAYNE-30 卡 `started_2`（已驳回）。唯一待修依据＝本卡评论 `01a1c2fa-6b84-7afe-a091-442c0543049d`（Codex 审查，本地提交 `62bbd830275f2be41b1b4d33d1b4ac6608824750`）对候选 `5623faeeb75fa48ce49dcd9eb4fc983533139c70` 的 BLOCK 三项。被审候选保持原样，本文只登记修订增量。
- **身份**：被修订候选 `5623fae`（tree `6de8f341eb66a75bd96f6c81a64a68648fa27566`）；卡内基点 `25b7f69be3f4b605512f4e57203f61f5b5cd8ef5`；**本轮修订提交 `222b1b5117481ef52616cf7f4d1be081f09e49bf`（tree `3046d68dfcfd97fffcda65f970bf53d6be67f322`）**。本轮修订增量恰 6 文件（2 个生产文件＋回归主文件＋夹具＋作者记录更正＋本记录），对 `5623fae` 的最小生产差分恰 2 文件（`server/lib/task-service.mjs`、`server/lib/task-recovery.mjs`；`server/lib/text-intake-service.mjs` 零字节——其 `confirmExtractExit`/`commitStagedResume` 生产点经共享 dock op 与本修订天然同源）。

## 1. 修复内容（对应审查发现项）

1. **P1（A/B/C）— classify 扫描时围栏。** `TaskRecovery.unfinishedAttempts()` 增读 `t.version` 并随 attempt 返回；`classify` 两个分支的任务 UPDATE 把**扫描时**的 `state`＋`version` 与「被扫描 attempt 仍是该任务当前 open attempt」三者一起作为提交时 `expectChanges:1` 断言：
   - running 分支：`WHERE task_id=? AND state='running' AND version=? AND (SELECT a.attempt_id FROM task_attempts a WHERE a.task_id=tasks.task_id AND a.ended_at IS NULL ORDER BY a.started_at DESC LIMIT 1)=?`；
   - needs_review 分支：同上加 `state='needs_review'`（原分支连 `state` 都未绑，且无 `expectChanges`）。
   晚到旧分类（resolve＋re-claim 后）在提交时前提丢失，**整事务**（事件＋dock op）回滚，不再把新 attempt 错误确认退出、不再写出倒退的事件版本。事件 `object_version` 改用扫描时 `attempt.version+1`。
2. **P1（D）— dock 提交时前提与歧义拒绝。** `TaskService.recoveryItemDockOp` 重写：
   - **≥2 行 → 可见 `state_conflict`**（含「多条全部已处置」的 pre-C4 历史）：无法证明唯一对应行时拒绝，绝不按 rowid 最新猜测复用（审查 D 反例）；删除历史／新增唯一约束均未采用。
   - **恰 1 行 pending → 可见 `state_conflict`**（原语义保留）。
   - **0 行 → 条件插入** `INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM recovery_items WHERE task_id=?)`＋`expectChanges:1`：提交时仍无行才插入，首插前提在提交时成立，并发生产者不再分叉出第二行。
   - **恰 1 行已处置 → 复用 UPDATE** 绑定读时 `version` 并断言 `(SELECT COUNT(*) … WHERE verification_state='pending')=0`＋`expectChanges:1`：复用版本前提与「无活 pending 行」前提都在提交时复核。
3. **P2 — 测试 SHA 登记更正。** `docs/reviews/web-text-intake-c4-cross-episode-20261110-zcode.md` 追加 §7 更正：§1 第 9 行登记的测试 SHA 前缀 `6402bc51e66f021a…` 与实际字节不符；实际值 `1aaa8d059c339b7e8ad7bc22d04887d0f53b299874f8b835e3c80bbe137ae363`，绑定来源＝候选 blob `5623fae:tests/unit/web-text-intake-recovery-authority.test.mjs`（blob `fe746bac…`）与审查独立重跑文件，两处一致。原登记值保留，不覆盖。

## 2. 红绿证据（同一测试字节跑两树，原始 TAP 随附件）

- **面构成**：authority 套件 54 → **58 面**＝既有 54 面字节零改动＋新增 Y1–Y4（Y1 迟到的 running 分类被拒；Y2 延迟提交的跨轮 ABA＋真实 HTTP 重放拒绝；Y3 迟到的 needs_review 分类被拒；Y4 多条已处置历史拒绝）。
- **红（被审候选 `5623fae` 生产字节）**：2 个生产文件回退为 `5623fae` blob（`git hash-object` 逐文件复核＝`c732bb93…`／`3c2a9d20…`）跑同一测试字节 → **54 pass / 4 fail、exit 1**，恰 Y1–Y4 全红且各按点名症状：Y1/Y2/Y3＝`undefined !== 'version_conflict'`（迟到分类被接受、未拒绝）；Y4＝`'needs_review' !== 'state_conflict'`（歧义历史被 rowid 猜选复用）。既有 54 面全绿。原始 TAP＝`build/mayne30-c4-revision/authority-candidate-red.tap`。
- **绿（修订字节终局运行）**：**58/58 pass、exit 0、墙钟 0.87s**。原始 TAP＝`build/mayne30-c4-revision/authority-fixed-green.tap`。
- 每例 20000ms 预算未触及；无 skip/cancel。

## 3. 邻域回归与前置

- **受影响 recovery 邻域（修订字节）**：`web-text-intake-recovery.test.mjs` **11/11 exit 0（57.5s）**、`web-text-intake-events.test.mjs` **11/11 exit 0**、`web-text-intake-lifecycle.test.mjs` **10/10 exit 0**——零回归。
- **存储二进制聚焦构建前置单列**：`cargo build --release --bin web-backend-storage` exit 0（45s，前置＝本地空资源目录 `build/s0-runtime`），SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`——与前几轮登记值逐字节同值。
- 冻结契约钉值 `docs/engineering/web-api-contract.md` SHA-256 `61863271a82f46ed…` 精确命中。schema／迁移／守卫／package／锁／README／manifest 零字节。
- 门禁：`node --check` 5/5、`npm run check:docs` exit 0（21 文件 519 链接）、`git diff --check` 干净。
- **未跑**（按卡内边界）：聚合、完整 gate、19 旅程、全量 cargo test、真实模型／真实用户根；HTTP 面严格 handler 层（真实 HttpServer／配对／会话／CSRF／状态映射＋真实服务＋真实存储二进制，无真实 Pi）。

## 4. 登记（不隐瞒）

1. **`confirmExit(!exited)` 停靠面（只登记不改）**：该分支停靠后 `closeAttempt` 关闭 attempt 行，回收扫描不可达；是否修停靠语义属新授权，不在本轮写域。
2. **plain resolve-resume 在暂存任务上留下 `staged` 候选孤儿（只登记不改）**：HTTP 不可达，服务层直调面存在；是否补清理属新授权。
3. **`needs_review` 分支的重复确认**：同一 attempt 的重复扫描在版本绑定下仍会匹配（读时版本未变）并再确认一次；并发/陈旧扫描被版本前提拒绝。未新增「已确认即拒绝」语义——超出本轮三项授权。
4. **围栏错误传播**：`recover()` 在前提丢失时抛 `version_conflict`（启动可见拒绝）；合法流不可达（扫描→classify 间无并发写者时零变化）。
5. 本轮只交可审修订候选，**作者不自签**；后续由未参与该增量的成员独审，独审通过后再归唯一集成。未 push、未合并 main、未动冻结契约／schema／DDL／Gitee 分支。
