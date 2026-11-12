# MAYNE-30 C4 修订复核（2026-11-11，Codex）

代码审查结论：**pass / APPROVE，限本卡三项退回问题的修订候选准入**。候选 `d70280c452038210c0ae6a60f980623de79c8d93` 已关闭上轮两个 P1 和一个 P2；本增量未发现新的阻断项。此结论不替代 W1 整体准出、完整门禁或 main 集成。

## 范围与来源

- 任务：MAYNE-30 2026-11-11 限定接续，作者评论 `01a1c677-94a7-73cf-8991-17f769dcdf1c`；退回依据为 `01a1c2fa-6b84-7afe-a091-442c0543049d` 与本人前次记录。已读取本卡、父卡当前说明及线程，父卡无 active，本卡仅此审查 run。
- 被修订候选 `5623faeeb75fa48ce49dcd9eb4fc983533139c70`；本轮候选 tree `694dfd773e738dc7e337ccb54eca93d1f088530d`。实现提交 `222b1b5117481ef52616cf7f4d1be081f09e49bf`，后继 `d70280c` 只校准记录身份；相对 `5623fae` 恰 6 文件 +297/−42，其中生产仅 `task-service.mjs`、`task-recovery.mjs`。
- Inspect；非批量，单候选的限定审查面。涉及恢复退出安全，按 R3 关注事务、并发、attempt 隔离及证据，不签完整双面发布准出。本轮只新增本人记录与忽略目录证据，未改受审文件。
- 候选由 `git archive` 导出，HEAD 始终保留在 `agent/codex/mayne-30`、起点 `62bbd830275f2be41b1b4d33d1b4ac6608824750` 之上。核对 4660 个 tracked 输入，无意外漂移；两份未运行的 vendor Windows 脚本仅有仓库配置指定的 CRLF 导出转换。未写 main、未 push、未整枝接入候选。

## 发现项关闭证据

| 上轮问题 | 修订及独立复核 | 判定 |
|---|---|---|
| P1：迟到分类污染新 attempt / C4 ABA 重放 | `unfinishedAttempts` 携带扫描时任务 version；classify 的 running、needs_review 分支在事务提交时同时校验扫描状态、version 与当前 open attempt，均检查影响行数。事件版本使用扫描 version+1。原审查 A/B/C 原字节重跑，均返回 `version_conflict`，task/attempt/item/event/candidate 快照不变。B 的第一轮合法 HTTP 仍 202，旧请求重放为 409；没有误确认新 attempt 退出。 | 关闭 |
| P1：多条已处置历史被选最新行复用 | dock 读取两行及以上直接 `state_conflict`，不按 rowid 猜选。原审查 D 原字节以基点服务合法生成两条处置历史，修订拒绝且全快照不变；不仅依赖新增 Y4 的 SQL 合成种子。历史保留，无新增唯一约束。 | 关闭 |
| P2：测试 SHA 登记错误 | 原作者记录追加 §7，保留错误前缀并更正为被审候选测试实际 SHA `1aaa8d05…ae363`。本轮修订测试另登记 SHA `784429d5686be472eb7716e1b2073e389edad20887791929a315d75a4564c66d`，与导出提交及实跑文件一致。未把本轮结果回签为旧作者 TAP 的来源证明。 | 关闭 |

额外核实条目提交前提，避免仅靠 classify 任务校验遮住缺陷：S1 先准备首次 INSERT，再以真实生产停靠建立条目，旧 op 提交被拒；S2 先准备已处置行复用，再合法完成另一轮至更高版本，旧 op 提交被拒。两个用例都在旧 op 前插入审计事件，拒绝后连同事件全部回滚；修订 2/2 绿，旧候选同测试 0/2，均为具名断言红。

首次条目写采用 `INSERT … SELECT … WHERE NOT EXISTS`，复用写同时校验条目 version、非 pending 与无活 pending；两者均 `expectChanges:1`。已有 ACK 类型门、完整 ACK 的真实 handler 正控、双 pending 拒绝、markNeedsReview 幂等及事务回滚面在既有 54 项中保持通过。未触碰公开请求字段、HTTP 路由、schema/迁移、依赖/锁、白名单、UI 或 Runtime。

## 实际验证

环境 Node v24.20.0、npm 12.2.1、macOS arm64。聚焦构建前置：候选 `src-tauri/` 执行 `cargo build --release --bin web-backend-storage`，先创建候选本地空 `build/s0-runtime/`，exit 0（36.78s）。二进制 SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd` 与前轮相同；冻结契约 SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` 命中。

测试统一 `node --test --test-timeout=20000 --test-reporter=tap <文件>`；串行执行，无 skip/cancel，每例预算含清理。邻域 recovery 的总时长不等于单例时长。

| 测试来源 | 通过/失败 | exit | 秒 |
|---|---:|---:|---:|
| 修订 authority 58 项 | 58/0 | 0 | 1.232 |
| 旧候选生产 + 同一修订测试/夹具 | 54/4，仅 Y1–Y4 红 | 1 | 0.847 |
| 原审查反例 A–D，原脚本字节不变 | 4/0 | 0 | 0.160 |
| dock 提交前提 S1/S2，修订 | 2/0 | 0 | 0.109 |
| 同一 S1/S2，旧候选 | 0/2 | 1 | 0.109 |
| recovery 邻域 | 11/0 | 0 | 57.607 |
| events 邻域 | 11/0 | 0 | 0.311 |
| lifecycle 邻域 | 10/0 | 0 | 5.136 |

来源身份：生产 `task-service.mjs` SHA `239205e1…b1e0d`，`task-recovery.mjs` SHA `7c0527d5…2e637`；authority 夹具 SHA `db17a509…edc0a`；原审查脚本 SHA `ede8ccfe9ac5213f3fd2e42c7a4dfaee435b3b74a378d1e98248cb48851a4b7f` 与上一轮附件精确相同。完整值、命令、退出码和源/产物清单在证据包 `identity.json`、各 `*.result.json` 中。

作者新附件的生产 patch 与提交差分逐字节相同，下载的红/绿 TAP 哈希命中其 SHA 清单。本轮另留独立原始 TAP、HTTP 机器观察与原件/脱敏交付件双 SHA；不以作者报告代替本轮实跑。

## 边界与收口

已检查冻结规格符合度、上轮问题的修复与反证、相关并发/回滚/退出安全、依赖与写域、干净导出输入可取得性。未跑卡内禁止的聚合、完整 `npm run check`、19 旅程、全量 cargo test；未访问真实模型、凭据、用户根或部署环境。HTTP 结论限真实 HttpServer/服务/存储上的受控交错，不外推为真实 Pi、完整调度器/worker 或浏览器端到端通过。

既有未决项保持：F1/W 的历史来源边界、RA2、`confirmExit(!exited)` 关闭 attempt 的回收不可达、服务层 plain resume 的 staged 孤儿、needs_review 重复确认语义，以及 E/D、GAP-5 和最终组合准出。它们未在本轮被改动或由计数覆盖。

本卡正文将本轮交付限定为“可审候选”，要求“共享 main 只读、独审后归唯一集成”；MAYNE-24 当前说明也将新完整门禁、19 旅程和 main 收口归 MAYNE-34。Auto Review 的通用步骤另要求“可完成且分支有交付时合入主分支”。本轮代码已具备限定准入证据；完成状态与 main 合入应先明确这两条收口指令的优先边界，不能把局部审查擅自扩为 W1 集成。
