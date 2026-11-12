# C-4 跨轮旧请求重放修复：恢复条目单行单调复用（MAYNE-30，2026-11-10，ZCode）

- **任务来源**：MAYNE-30 卡（子卡，父 MAYNE-24）。C-4＝Hermes 在 `4bf3472` 原字节上以同 taskId 两轮合法业务路径实证的跨轮重放窗口（父卡评论 `01a1c2af-5584-732d-b06b-bd4f1cf16d9d`）：每轮停靠 INSERT 新行 v1/pending，第一轮 `ev=1` 请求在第二轮再次被接受。裁定（同评论＋卡内）：冻结 §12（`docs/engineering/web-api-contract.md:389`「每个 `needs_review` 任务对应一行；`version` 从 1 起、每次变更 +1」）支持在既有契约内修复——**再次进入核对时复用可证明的对应行并推进 version、回到 pending、清当前处置字段**；「每轮新集合从 1 起」不构成豁免。本轮按卡内冻结契约直接修复，作者不自签，完成后按项目 workflow 交独审。
- **交付拓扑（平台起点约束的安全方案）**：平台把本 run 分支钉在 `agent/zcode/mayne-30`、起点 `8d0ccd9`（其树与共同祖先 `1e37044` 逐字节相同），而卡内基点为候选 `25b7f69`（分支 `agent/zcode/mayne-24`，`4bf3472` 直上）。解法＝**merge 提交 `b1c6014`**（第一父＝`8d0ccd9`，第二父＝`25b7f69`，零冲突，合并树与 `25b7f69` 逐字节相同——`git diff 25b7f69 b1c6014` 为空），C-4 修复提交直接落在该合并之上；无 reset/rebase/push，全部历史原样保留，对基点的最小生产差分可从「本提交 vs `25b7f69`」直接取得。

## 1. 身份

- 基点：`25b7f69be3f4b605512f4e57203f61f5b5cd8ef5`（C2/C3 阶段候选）；经 merge `b1c6014` 后本提交第一父＝`b1c6014`，生产差分恰 3 文件（§2）。
- 文件 SHA-256（修复后工作树字节）：`server/lib/task-service.mjs` `dfb333094f982159…`、`server/lib/text-intake-service.mjs` `2b6f71ecbe80db6e…`、`server/lib/task-recovery.mjs` `ce328b6732ffddf1…`、`tests/unit/web-text-intake-recovery-authority.test.mjs` `6402bc51e66f021a…`、`tests/fixtures/web-text-intake/recovery-authority-instance.mjs` `1dd94d0a0c64fc01…`。生产 3 文件的最小差分随卡附件（`fix-production-3files.patch`，patch 自身 SHA-256 `23bd4b11affe9222…`）。
- 存储二进制：本 worktree 聚焦重建 `cargo build --release --bin web-backend-storage`，SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`——与诊断／修复／接线三轮登记值**逐字节同值**（`build/s0-runtime` 空资源目录按前几轮口径本地补齐，不进存储 bin 编译面）。同命令在本 worktree 首跑曾因该资源目录缺失失败（`resource path ../build/s0-runtime doesn't exist`），补目录后 exit 0——登记为聚焦构建前置。
- 冻结契约钉值：`docs/engineering/web-api-contract.md` 本树 SHA-256 `61863271a82f46ed…`（W0 冻结钉值精确命中，零漂移）。schema／迁移／守卫／package／锁／README／manifest 零字节。

## 2. 修复内容（恰 3 个授权生产文件）

1. **共享停靠写 op**：`task-service.mjs` 新增 `recoveryItemDockOp(taskId)`——读该任务全部 `recovery_items` 行（rowid DESC）：**0 行 → INSERT v1 pending**（首次 episode，语义不变）；**恰有已处置行 → 复用最新行**（`UPDATE … SET version=version+1,verification_state='pending',decision=NULL,decided_by=NULL,decided_at=NULL WHERE item_id=? AND verification_state<>'pending'`，`expectChanges:1`）——条目身份（`item_id`）跨轮可追踪、version 单调推进（1→2→3）、处置审计字段清空、历史不删除；**存在任一 pending 行 → 可见拒绝 `state_conflict`**（上一 episode 未合法结束＝权威异常，与两入口歧义拒绝同口径，绝不定选最新行分叉权威）。读在调用者事务外、前提（新 INSERT 或精确 item_id+非 pending）作为 `expectChanges` 前置断言随 op 进事务——读提交间前提丢失整事务回滚。
2. **四个 needs_review 生产点全部换接同一 op**（策略一致）：`markNeedsReview`（两变体）、`TaskService.confirmExit(!exited)`、`TextIntakeService.confirmExtractExit(!exited)`、`TaskRecovery.classify` running 分支（卡内点名接续：`25b7f69:113–135` 原为每次 INSERT version=1）。
3. **必要围栏**：`classify` running 分支任务 UPDATE 加 `AND state='running'` ＋ `expectChanges:1`；`confirmExit(!exited)` 任务 UPDATE 补 `expectChanges:1`（此前两处均无前置断言，并发双生产者可双插条目——C2/C3 登记观察 #3 的同类窗口）。配对矩阵闭合：classify/markNeedsReview/confirmExit/confirmExtractExit 两两并发时，败者或命中状态前提（changes 0）或命中 expectChanges，整事务（含条目 op、事件）回滚。`resolve`／`commitStagedResume`／`http-server.mjs` **零字节改动**——两入口的权威 CAS（pending 行版本）随复用语义自然拒绝跨轮旧请求（`item.version !== expectedVersion → version_conflict`），处置前零副作用。
4. **效果（对照 C-4 实测账本）**：ep2 停靠后 wire `itemVersion=3`（非 1），第一轮旧请求 `ev=1 → 409 version_conflict`、任务／条目／候选／事件零副作用；从 wire 重读 `ev=3` 的合法请求成功。

## 3. 红绿证据（同一测试字节跑两树）

- **面构成**：authority 套件 **54 面**＝既有 45（44 面字节零改动＋B9 按 §12 裁定修订，见 §5.1）＋新增 9 面 X1–X9。X1＝C-4 主面（confirmExtractExit 生产点：单行复用、身份一致、version 单调 1→2→3、旧请求 `version_conflict` 零副作用、wire 重读成功）；X2＝暂存入口跨轮（ep1 无暂存 plain 重排 → ep2 暂存停靠：旧形态请求 `version_conflict` 零发布、恰一次发布）；X3＝restart classify 路径跨轮（同上，`restart_unknown_side_effect`）；X4＝两个并发 `recover()` 恰一胜者（恰一条目、恰一事件、版本恰推进一次）；X5＝markNeedsReview 跨轮复用；X6＝陈旧 attempt 归属拒绝（同轮外来 attemptId＋跨轮 attempt1 皆 `state_conflict` 零写入，attempt 归属不回退）；X7＝运行态注入 pending 行后停靠可见拒绝（零写入零停靠）；X8/X9＝真实 HTTP 跨轮旧请求 **409**＋新鲜请求 **202**（普通／暂存入口，handler 层、无真实 Pi，与 H1–H11 同缝）。
- **红（基点字节）**：3 个生产文件回退为 `25b7f69` 字节（blob `git hash-object` 逐文件复核＝`b26ba8a4`/`09c7b2a1`/`5099d4aa`）跑同一测试字节 → **44 pass / 10 fail、exit 1**，恰 10 个面全红且各按点名症状：B9/X1/X5＝跨轮条目身份不同（新行 `rec_… ≠ rec_…`，未复用）；X2/X3/X6/X8/X9＝`1 !== 3`（每轮新 v1，wire 暴露 1 非单调 3）；X4＝版本 `4 !== 3`（并发双胜、双推进）；X7＝「Missing expected rejection」（pending 异常面未拒绝、权威被分叉）。44 个既有面全保持绿。原始 TAP＝`build/mayne30-c4-cross-episode/authority-baseline-red.tap`。
- **绿（修复字节终局运行）**：还原修复（`git apply` 后 `git hash-object` 复核）跑同一测试字节 → **54/54 pass、exit 0、墙钟 1.3s、stderr 仅 time -p**；每例 20000ms 预算未触及（最慢面 23ms 量级）。原始 TAP＝`build/mayne30-c4-cross-episode/authority-fixed-green.tap`。
- 每轮红／绿共 4 次完整运行（X2/X6 夹具前提两轮修正如实留档：修正只动测试文件字节，最终红绿以最终字节双跑为准）。

## 4. 邻域回归与前置

- **受影响 recovery 邻域（修复字节）**：`web-text-intake-recovery.test.mjs` **11/11 exit 0（58s）**、`web-text-intake-events.test.mjs` **11/11 exit 0**、`web-text-intake-lifecycle.test.mjs` **10/10 exit 0**——本轮写域零回归（F1/W 修正夹具按确切来源未动）。
- **web-text-intake-receipts-restart.test.mjs**：RA2 在**基点字节与本修复字节同症状同面红**（resume `400 !== 202`——verifiable  begin 回执在台账而 `acknowledgedReceipts: []`，两树 `expected/actual/location` 全同）。C2/C3 轮登记的复跑集不含本套件；判定为**基点既有红**，本轮未触碰其面、不 claim 修复、不覆盖归因。RA1 两树皆绿。
- **集成套件环境面**：`web-text-intake-http`（6/24）与 `web-text-intake-queue`（4/17）在基点与修复两树**失败面逐条相同**（bundle 自基点字节重建后差分 `diff` 为空）；症状＝`config-store.mjs`「供应商名称无效」的受控模型 provider 配置前置缺失（本轮零触碰的 config/credential 子系统；本 fresh worktree 无该环境的 workspace 配置）。判为环境前置红，登记不 claim；`build:backend` 聚焦构建（npm ci `--ignore-scripts` + bundle 组装）作为其前置单列，exit 0。
- **未跑**（按卡内边界）：聚合、完整 gate、19 旅程、全量 cargo test、真实模型／真实用户根。

## 5. 登记（不隐瞒）

1. **B9 修订**：既有 B9 CONTROL 曾钉「新 episode 携带自己的 fresh authority item（version 1）」——该断言编码的正是裁定已否决的 per-episode 读法。修订后 B9 的**回执隔离主张逐字保留**（新 episode 只见自己的台账、旧 attempt 回执不拦新 episode），版本断言改为 §12 语义（同一 `item_id`、version 1→2→3、`decision` 字段清空、wire `itemVersion=3`、按 wire 重读版本 resolve 成功），修订在面内逐行标注来源（§12:389＋Hermes `01a1c2af`）。B9 在基点字节按新断言红（症状＝未复用）、修复字节绿。
2. **`TaskService.confirmExit(!exited)` 停靠面（只登记不改）**：该分支停靠后 `closeAttempt` 关闭 attempt 行，而回收扫描只扫 open 行 → 任务停留 `exited_unknown` 不可被两入口处置（X6 红轮实证：reclaim 后 resolve 仍 `exit_unconfirmed`）。这是基点既有行为（注释「keeps its slot」与关行事实相悖），**经该生产者的合法跨轮链路在本树不可构造**，故该生产者只接同一共享 op（X7 实测其拒绝接线）而不设跨轮复用面；是否修停靠语义属新授权，不在本轮写域。
3. **plain resolve-resume 在暂存任务上留下 `staged` 候选孤儿（只登记不改）**：`resolve(resume)` 不清理暂存候选行，同 source 再次暂存时 `(source_id,ordinal)` UNIQUE 冲突（X2 红轮实证）。HTTP 不可达（handler 将暂存+resume 路由至 `commitStagedResume`），服务层直调面存在；是否补清理属新授权。X2/X6/X9 的夹具已改为不经该面。
4. **围栏错误传播语义**：`recover()`（entry 启动唯一调用点 `web-backend-entry.mjs:139`）在前提丢失时抛 `version_conflict`——启动可见拒绝，替代此前对运行态的无守卫覆盖写入；合法流不可达（扫描→classify 间无并发写者时零变化）。
5. **生产者拒绝新路径**：`markNeedsReview` 等生产点在存在 pending 行时抛 `state_conflict`——既有调用方（scheduler `.catch`、worker-done 链 catch）承接口径与 C2/C3 轮登记一致。
6. **X4 的确定性说明**：两并发 `recover()` 的扫描查询先于任何 classify 事务进入存储队列，两扫描同取 running 前提，围栏恰拒其一（K6 同款 `Promise.allSettled` 机理）。

## 6. 结论

本卡阶段目标达成：**C-4 跨轮重放窗口在本切片四个生产点全部闭合**（单行单调复用＋并发围栏），同 taskId 跨轮旧请求 `version_conflict` 零副作用、wire 重读成功，既有 45 面中 44 面零改动保持绿、受影响邻域零回归。**作者不自签**：本提交为可审修复候选（本地 SHA／patch／TAP／双树差分随卡附件），整体独审按 MAYNE-30 workflow 交回；未 push、未合并 main、未动冻结契约／schema／Gitee 分支。

## 7. 更正（2026-11-11，Claude，接 Codex 审查 P2）

§1 第 9 行登记的测试文件 SHA-256 前缀 `6402bc51e66f021a…` **不是**该文件的实际字节身份，特此更正，原登记值保留如下作为差异记录，不覆盖：

- 登记值（§1 第 9 行）：`6402bc51e66f021a…`（仅前缀，来源与对应字节未登记）。
- **实际值**：`1aaa8d059c339b7e8ad7bc22d04887d0f53b299874f8b835e3c80bbe137ae363`。
- 绑定来源（实际执行字节）：候选提交 `5623faeeb75fa48ce49dcd9eb4fc983533139c70` 的 git blob `5623fae:tests/unit/web-text-intake-recovery-authority.test.mjs`（blob `fe746bac4397650aced8846bbd34c7c3224cf724`）逐字节 SHA-256＝上述实际值；Codex 审查独立重跑所用文件（候选 `git archive` 导出）SHA-256 同为该值。两处独立来源一致，**以 `1aaa8d05…` 为作者实际运行／交付的测试字节身份**。
- 同节其余 4 个文件 SHA-256 经复核与本树字节一致，无需更正：`server/lib/task-service.mjs` `dfb333094f982159…`、`server/lib/text-intake-service.mjs` `2b6f71ecbe80db6e…`、`server/lib/task-recovery.mjs` `ce328b6732ffddf1…`、`tests/fixtures/web-text-intake/recovery-authority-instance.mjs` `1dd94d0a0c64fc01…`。
- 证据边界：本更正只登记字节身份，不回推 §3 的红／绿 TAP 对应哪一份测试源码；审查重跑的 TAP 与源码对应关系以审查记录为准。
