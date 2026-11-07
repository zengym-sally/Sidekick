# W0 schema F-1 修订增量独立复核（ZCode）：**通过**

> 评审者：ZCode（未参与实现与修订）。评审对象：F-1 修订增量 `67860d3042e0bf7aa5c42bcea0a2325e96b8b399..cab73aaa670b423bb6ce33874465e0d1479e523e`（派发评论 `01a1b68a`）。评审日期：2026-11-07。实现与作者记录只读；受控验证在评审者隔离树（`agent/zcode/mayne-22` @ `ac2601d` 基线）完成，原始证据在本树 `build/mayne22-schema-f1-review/`（判别矩阵 4 轮全量日志、真树复跑日志、外壳 crate 源码、哈希清单），精选件随最终评论附件交付。沿首轮结论（`ac2601d` 记录），不重开已通过且未改的部分与 NIT。

## 1. 结论

**通过。** F-1 修订以最小增量消除了首轮记录的 MINOR：拒绝外来 DELETE-mode 库前不再触碰日志模式，open/init 两入口对被拒库实测零写入（主文件字节与旁文件集合均不变）；配套的 classify application_id 判定在「拒绝不覆盖外来库」同一验收口径内，且实测补上了首轮未点名的误初始化缺口。同一合成反例修前稳定复现、修后稳定消失（双向判别矩阵成立）。DDL 审定哈希不变，合法路径行为（初始化/幂等/每连接契约/回滚重试）保持。未引入新 BLOCKER/MAJOR/MINOR；N-1–N-4 维持登记不修。W0 准出与新完整门禁仍开放，不由本复核签发。

## 2. 身份与哈希（全部独立复算，非转抄）

| 项 | 结果 |
|---|---|
| `cab73aa` 父提交恰为 `67860d3` | ✓（`git cat-file` 核实；`67860d3` 父恰为 `598d2da`，与首轮一致） |
| F-1 增量补丁 sha256 | `99706d935225cf40279c72947e6586fdcb56f3efbf808892f5e0856d328ae587`（`git diff 67860d3 cab73aa` 复算） |
| 增量范围 | 恰 3 文件 +161/−3：`web_backend_schema.rs`（+14/−2）、`web_backend_schema_tests.rs`（+119/−1）、实施记录（+28/−0）；清单外文件零改动（name-status 全集核对） |
| 冻结项 | `001_web_backend.sql` 两树均 `8511907c…143d`，与审定 DDL 逐字节一致；`local_store.rs`（`25d78ddf…`）与 `lib.rs` 未动 |
| 源码哈希 | `web_backend_schema.rs` 修后 `d57dfbc7…4008` / 修前 `324e62eb…2ec1`（与首轮声明一致）；`web_backend_schema_tests.rs` 修后 `06a30f7b…452b` / 修前 `1f1224a4…7b8a`（与首轮声明一致） |
| 分支 | `refs/heads/agent/claude/mayne-22` = `cab73aa` |

## 3. 独立验证方法（不以复跑作者测试作依据）

1. **判别性外壳 crate**（`build/mayne22-schema-f1-review/harness/`，源码留存）：被测模块为两提交的逐字节副本（每次换入后复制前后哈希复核），依赖锁 rusqlite `=0.39.0`（bundled+backup）/ rusqlite_migration `=2.5.0` 与候选一致；外壳仅提供 `use super::*` 所需项（逐字复制 `local_store.rs` 相应函数体）。两套**判别性**测试：`before_repro`（3 例，断言 F-1 存在）与 `after_verify`（9 例，断言修复成立），DDL 为审定件逐字节副本。
2. **双向交叉运行**（原始日志 `zcode-f1-falsify-logs.txt`）：

   | 套件 \ 被测模块 | 67860d3（修前） | cab73aa（修后） |
   |---|---|---|
   | `before_repro`（断言 F-1 存在） | **3/3 过**（复现） | 0/3，全败（副作用已消除） |
   | `after_verify`（断言修复成立） | 5 过 / **4 败**（恰为修复目标 a1/a2/a3/r3） | **9/9 过** |

   同一反例在修前按断言失败、修后按断言通过，且各在对方代码上反向失败——套件判别力成立。
3. **真树复跑**（`git archive cab73aa` 检出，`build/s0-runtime` 构建前置自本机主检出复制）：`cargo fmt --check` / `cargo test --lib web_backend_schema`（**17 passed / 0 failed**，原 12 + 新 5）/ `cargo clippy --all-targets -- -D warnings`（0 warning）/ `node scripts/checks/check-docs.mjs`（20 文件 383 链接）全部 exit 0，与作者声明一致。

## 4. 派发点名项逐条结果

**4.1 修前能复现（同一合成反例）**
- 外来 DELETE-mode 库（旧标记 `0x53444b31`+表；错误 application_id `12345`+表）：`open()` 返回 `WEB_BACKEND_UNKNOWN_DATABASE`，但主文件头部发生 WAL 转换写入——严格字节 diff 实测受写字节 **[18, 19, 27, 95]**：写/读版本 1/1→2/2，另含 file change counter 与 version-valid-for 簿记字节的递增。如实勘误：首轮记录仅引用「字节 18/19」，本轮严格 diff 显示写副作用还波及簿记字节，属同一根因、证据更强，不改变首轮定性与修复方案。
- 另复现修前 classify 缺口：外来标记、无表、`user_version=0` 的文件被判 Blank，`init()` 直接**误初始化覆盖**外来库（`before_repro` 第 3 例）。该缺口首轮未点名，本轮 classify 修订实测将其一并关闭（见 4.3）。

**4.2 修后 open/init 拒绝外来 DELETE-mode 库：零写入**
- `open_existing_with_fault` 改为 `validate` → `configure_connection` → `apply_migrations`（源码 diff 核实，仅调序+注释）；`validate` 全程只读（quick_check、pragma 读、schema_meta 查询），被拒库在 `configure_connection` 的 `PRAGMA journal_mode=WAL` 之前即返回。
- 实测（a1/a2/a3/r3）：旧标记+表、错误 application_id+表、仅旧标记无表、外来标记无表四类库，open+init 双入口均显式拒绝（`UNKNOWN_DATABASE`），主文件字节逐字节不变、目录旁文件集合不变、无 `-wal`/`-shm` 出现；0.01–0.04s 内快照比对全过。
- 合法路径不回归：lineage/版本镜像不符拒绝前后字节与旁文件集合不变（a4）；被外部翻回 DELETE 模式的合法库，`open()` 仍在校验通过后完成 WAL 转换并正常打开（c3）——改序只是把转换挪到校验之后，合法转换能力保留。

**4.3 classify 空白/回滚半成品可重试 + 外来 lineage 拒绝**
- 空白（0 字节）文件：`init()` 正常初始化（11 表、lineage `web-backend/1`、WAL），随后 `open()` 可复开（r1）。
- 迁移回滚半成品（`0x57424b31`、无表、`user_version=0`）：`open()` 呈 `WEB_BACKEND_MISSING_DATABASE` 不静默补完；`init()` 重试完整重建（11 表、`user_version=1`、application_id 保持）——首轮记录的回滚遗留可重试语义保持（r2）。
- 携带其他 lineage application_id 的库（含无表形态）：走校验拒绝而非误初始化（r3/a3），拒绝零写入。classify 判定条件（`tables==0 && version==0 && (application==0 || application==WEB_BACKEND_APPLICATION_ID)`）与提案 §7.4「外来 lineage 既有库须校验拒绝」一致；`unwrap_or(0)` 的 pragma 读失败兜底发生在 quick_check 通过之后，未构成可构造暴露面。

**4.4 合法每连接配置行为保持**
- 合法 init：`journal_mode=wal`、`synchronous=FULL`（实测 2）、`foreign_keys=ON`（实测拦截悬挂 task_attempts 插入）、`busy_timeout=5000`（c1）。
- 第二个裸连接经 `configure_connection` 后同样 FK=ON 且实测拦截悬挂插入——「每个连接逐连接应用契约」的语义保持（c1）。
- 真 17 例中作者原 12 例全过，迁移失败回滚与重试等未改路径未回归。

## 5. 最小性与写入范围

- 增量恰 3 文件且均为派发给 Claude 的允许写入路径（runner、schema 测试、本项 schema-implementation 记录）；`lib.rs`、`local_store.rs`、DDL、既有迁移 001–005、公共文档、守卫、`package.json`/锁文件均未触碰（name-status 全集 + 指定文件 diff 为空双重核对）。
- classify 的 application_id 判定严格说超出「仅调序」的字面最小，但服务同一验收条款（「拒绝不写入」的外来库不覆盖面），并在作者实施记录 §5 与交付评论中如实登记（含新增 5 例回归的明细）；判为最小修正的组成部分而非范围扩张。
- 实施记录 §5 增量（+28 行）内容与实测一致：5 例回归名称、17/17、聚焦命令 exit 0、NIT 登记均与本复核独立复算吻合。

## 6. NIT 与遗留（不重开）

- N-1（备份副本终态 WAL）、N-2（备份版本校验对构建最新值）、N-3（符号链接拒绝误标 `CORRUPT_DATABASE`）、N-4（备份父目录失败走 `WORKSPACE_IO`）：本轮 diff 未触碰备份与错误码路径，维持登记不修，与派发口径一致。
- 首轮勘误项：F-1 受写字节实测为 [18,19,27,95] 而非仅 18/19（§4.1），首轮记录保留原文、以本记录为勘误附注，不改写历史。

## 7. 边界与未验项（如实）

- 未跑完整 `npm run check`（按派发不由评审者执行）；R5 绿证仅签 `8bd29c4`，不覆盖 `67860d3` 或 `cab73aa` 增量——含已审 F-1 修订的最终集成版本上，由唯一集成执行者串行补跑新完整门禁的条件仍开放。
- 仅 macOS arm64（rustc/cargo 1.89.0）；未验证 Linux；未操作真实工作根/凭据/旧库；本复核未动 main、未 push，评审分支提交仅含本记录一个文件。
- 交叉判别使用同一机器同一 SQLite 构建（bundled libsqlite3-sys 0.37.0）；不同 SQLite 版本的头部簿记写字节集合可能略有差异，不影响「修前有写、修后零写」的定性结论。
