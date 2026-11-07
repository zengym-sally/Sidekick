# W0 schema 实施独立评审（ZCode）：候选 `67860d3` —— **通过**（1 项 MINOR 不阻塞 + 4 项 NIT）

> 评审者：ZCode（未参与实现）。评审对象：`67860d3042e0bf7aa5c42bcea0a2325e96b8b399`（父 `598d2daf9db8ab66c9760c585af7045f87eac466`），按两者精确五文件增量审查。评审日期：2026-11-07。实现与作者记录只读；受控验证在评审者隔离树（`agent/zcode/mayne-22` @ `f0eaee3`）完成，原始证据在本树 `build/mayne22-schema-implementation-review/`（哈希清单、19 场景证伪全量日志、真树复跑日志、独立证伪 crate 源码），精选件随最终评论附件交付。

## 1. 结论

**通过。** 四生产文件与实施记录符合已审提案 `598d2da` 与 owner 授权（评论 `01a1b648`）的范围与行为；DDL 与审定哈希逐字节一致；所有身份哈希独立复算一致；拒绝、回滚、设置、备份、路径边界在合成库独立证伪下全部成立。发现 1 项 MINOR（拒绝路径对 DELETE 模式外来库的 journal 转换写入，数据无损、不阻塞）与 4 项 NIT，均不构成退回理由；处理建议见 §6。最终集成须保留 `8bd29c4` 与已审 `b11fd05` 内容，不得以候选全树覆盖基座；完整重门禁由唯一集成执行者另跑，本评审不预支。

## 2. 身份与哈希（全部独立复算，非转抄）

| 项 | 结果 |
|---|---|
| 父提交恰为 `598d2da` | ✓（`git cat-file` 核实） |
| 增量范围 | 恰 5 文件 +972/−0：`001_web_backend.sql`、`web_backend_schema.rs`、`web_backend_schema_tests.rs`、`local_store.rs`（+10）、实施记录；无任何其他文件改动 |
| 补丁 sha256 | `c3fe7148e2cac266c03b936f6a2bbe391341ee8f63836759e8962c2455405da2`（`git diff 598d2da 67860d3` 复算） |
| DDL | `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`，与审定值逐字节一致（哈希相等即字节同一；该审定哈希在 ZCode R2 已独立复算） |
| `web_backend_schema.rs` | `324e62eb75ed11b2…c2ec1`，与声明一致 |
| `web_backend_schema_tests.rs` | `1f1224a422547bfc…37b8a`，与声明一致 |
| `local_store.rs` | `25d78ddff587b1af…3592e`，与声明一致；增量恰 10 行 = `#[path]` 模块/测试登记 + re-export，无其他改动 |
| `lib.rs` | 未在本增量中改动；`lib.rs:29–30` 的 `#[path = "store/local_store.rs"] pub mod local_store;` 为既有声明，登记偏差说明（无 `store/mod.rs`）属实，路径修正是授权接线的落实 |

## 3. 独立验证方法（不复跑作者测试作依据）

1. **合成库证伪**：在 `build/mayne22-schema-implementation-review/verify/` 搭独立外壳 crate，被测模块为候选逐字节副本（复制前后哈希复核）；外壳仅按 `local_store.rs` 接口提供 `use super::*` 所需项；依赖锁定 rusqlite 0.39.0（bundled+backup）/ rusqlite_migration 2.5.0 与候选 Cargo.toml/lock 一致。19 个证伪场景（v01–v21）全部通过，观察值全量留存。
2. **真树复跑**：`git archive 67860d3` 检出副本，`cargo fmt --check` / `check --lib` / 聚焦测试（12/12）/ `clippy -D warnings` / `check:docs`（20 文件 383 链接）/ `check:structure` 全部 exit 0；非测试 rlib strings 扫描故障钩子 0 命中（测试二进制 1 命中，`cfg(test)` 门控有效，钩子不入生产）。
3. 作者 12 用例仅作回归佐证；本评审结论以下述独立证伪为准。

## 4. 逐项证伪结果（触发评论点名目标）

**4.1 普通打开拒绝路径的创建/写入/修复副作用**
- 缺库：显式 `WEB_BACKEND_MISSING_DATABASE`，文件与父目录均不创建（v01）；空文件保持 0 字节、无 `-wal`/`-shm`（v02）。
- 垃圾文件：classify 只读打开（`SQLITE_OPEN_READ_ONLY|NOFOLLOW`）+ quick_check 失败 → `CORRUPT_DATABASE`，1024 字节逐字节不变（v05）。
- 合法库各拒绝路径（lineage 不符 / 镜像不符双可达方向 / 过新）：文件字节逐字节不变、不回写、不修复，再开仍复现同一拒绝（v06/v07）。
- 回滚遗留（见 4.2）对 `open()` 呈 `MISSING_DATABASE`，不静默补完迁移（v08）。
- **F-1（MINOR）**：对 **DELETE 模式的外来/旧标记库**（application_id 非 `0x57424b31`，含 `0x53444b31` 旧标记），`open()`/`init()` 在拒绝前已按连接契约执行 `PRAGMA journal_mode=WAL`，被拒文件头部 18/19 字节发生 1/1→2/2 转换写入（v03/v04/v20）。实测边界：数据零丢失（外来表逐行可读）、不合并不覆盖、错误码与文案如实（「未合并、覆盖或续用」）、合法库路径完全不受影响（本就 WAL）、缺库/空/垃圾路径无任何写入。定级 MINOR 的依据：仅误配置场景、无数据损失、可逆且 SQLite 全兼容；但按验收措辞「无创建/写入/修复副作用」的字面口径，这是一处真实写副作用，须如实列报。修复建议见 §6。

**4.2 初始化与迁移失败原子回滚**
- 故障注入迁移失败（真实 cfg(test) 钩子 + 独立断言）：整体回滚成立——0 表、`user_version=0`、无 `-wal`/`-shm` 残留；文件保留非空；`application_id=0x57424b31` 因先于迁移单独提交而保留（v08）。
- 遗留文件 classify 判为 Blank（tables=0 且 version=0，与 application_id 无关，故遗留状态不影响分类）→ `open()` 显式拒绝；`init()` 重试走 create 路径完整恢复 11 表/版本 1（v08）。
- `open()` 待执行迁移路径（提案 §7.4 第 6 步「低于支持→应用待执行迁移」）在当前构建不可达：DDL CHECK 要求 `schema_version>=1` 且镜像须与 `user_version` 相等，单一迁移下不存在「合法但落后」状态；作者名为 open-with-fault 的用例实际覆盖空文件拒绝。该未来路径的回滚与 init 同走单事务 `goto_up`（R2 已源码级核实 rusqlite_migration 2.5.0:627-653），本评审确认其当前不可达且无暴露面（O-2）。

**4.3 版本/lineage/每连接设置**
- 镜像不符双可达方向（`user_version=0,meta=1`；`user_version=2,meta=1`）均拒绝且先于 too_new 判定，符合提案 §7.4 R2 表（`meta=0` 被 CHECK 禁止，提案表中该行不可构造，已核）（v07）；过新 (2,2) 拒绝、无迁移尝试、字节不变（v07）。
- lineage 不符拒绝、不回写（v06）；新旧 application_id 常量互异（v18）。
- 每连接设置：configure 后 FK=ON 且实测拦截悬挂 attempt、busy_timeout=5000、WAL、synchronous=FULL（v17）；bundled 构建默认即 FK=ON（`compile_options` 含 `DEFAULT_FOREIGN_KEYS`），候选的逐连接显式设置属契约兜底而非冗余缺陷（O-1）。

**4.4 备份一致性**
- 内容一致：11 表、application_id、user_version 外加**逐字节 64KiB payload blob 与业务行**在副本中还原（作者未断言 blob 等值）；源库不受备份影响且仍可写（v10）；副本旁无 `-wal`/`-shm` 残留。
- 失败边界：已存在目标拒绝且哨兵内容逐字节不变（v11）；目标==源拒绝、源完好（v12）；父路径为文件显式失败且不落目标文件（v13）。
- **N-1（NIT）**：副本终态 journal_mode=WAL——页复制携带源头部标记，使 `consistency_backup` 中目标连接前置的 `PRAGMA journal_mode=DELETE` 不生效。无害（副本数据完整；还原后与生产同为 WAL），建议删去该 PRAGMA 或复制后重设，避免误导。
- **N-2（NIT）**：副本 `user_version` 校验对 `SCHEMA_VERSION`（构建最新值）而非源库实际值；未来 002+ 且存在合法旧版本库时，忠实的备份会被误拒。当前 `SCHEMA_VERSION=1` 不可达，属潜在缺陷，建议改为与源库 `user_version` 比对。

**4.5 路径/失败边界**
- 符号链接文件被 NOFOLLOW 拒绝（open/init 均显式报错），真实库字节不变、真实路径可正常打开（v14）——错误码现为 `CORRUPT_DATABASE`，语义可辨但不精确（N-3，NIT）。
- 父目录符号链接经 `canonicalize` 解析后正常初始化/打开，两条路径访问同一库，实现与记录 §2.2 所述约定一致（v15）。
- 目录路径显式拒绝、不改动（v16）；`consistency_backup` 父目录创建失败走 `io_error`（`WORKSPACE_IO`）而非 `BACKUP_FAILED`（v13，N-4，NIT）。

## 5. 实施记录与授权范围交叉核对

- 记录 §1–§2 的范围、常量、初始化/打开/备份行为与代码逐项相符；「写入清单偏差说明」（`store/mod.rs` 不存在，登记落在 `local_store.rs`）经核实属实，且属队长已修正的授权路径落实（触发评论 01a1b66c 与任务描述「模块登记实际路径修正」）。
- 增量 +972/−0 的纯新增性质，机械证明未触碰公共文档、守卫、`product/05`、`package.json`、锁文件、既有迁移 001–005 与 vendor。
- 记录 §3 所列验证命令（fmt/check/聚焦测试/clippy/docs）本评审全部独立复跑 exit 0，数字一致（12 passed、20 文件/383 链接）；其引用的原始日志位于作者树 gitignored `build/`，不在提交内——符合仓库证据约定，本评审以其复跑结果为准。
- DDL 与 R1–R3 已审内容一致：R1 部分唯一索引 `task_attempts_current` 在位；`task_result_payloads` 11 表在位且 `total_bytes=length(payload_blob)` 约束实测生效；11 表/10 索引计数与提案一致。
- 结构守卫不覆盖 `src-tauri` 引用扫描、顶层收敛不含本路径——OpenCode「守卫无需改动」的裁定复算成立（check:structure exit 0）。

## 6. 发现清单与处理建议

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| F-1 | MINOR | 拒绝路径对 DELETE 模式外来/旧库发生 WAL 转换写入（§4.1） | 不阻塞候选。建议在 W1 接线前由实现者改序（validate 先于 `configure_connection`，或复用 classify 只读连接完成校验）；若队长裁定接受现状，则在记录中明示该边界即可 |
| N-1 | NIT | 备份副本终态 WAL，目标 `journal_mode=DELETE` 不生效 | 删去或复制后重设 |
| N-2 | NIT | 备份版本校验对构建最新值而非源库实际值 | 改为与源 `user_version` 比对（当前不可达，002+ 前完成即可） |
| N-3 | NIT | 符号链接拒绝误标 `CORRUPT_DATABASE` | 可选：细分 NOFOLLOW 专属错误码 |
| N-4 | NIT | 备份父目录创建失败走 `WORKSPACE_IO` | 可选：映射为 `BACKUP_FAILED` 族 |

观察项（非缺陷）：O-1 bundled 默认 FK=ON，逐连接设置为契约兜底；O-2 open 待执行迁移路径当前不可达；O-3 故障钩子不入生产（strings 双向验证）；O-4 失败遗留的 Blank 分类与 application_id 保留实测成立；O-5 application_id 在迁移 SQL 与 runner 双处设置，幂等无害。

## 7. 边界与未验项（如实）

- 未跑完整 `npm run check`（按派发不由评审者执行）；R5 绿证仅签 `8bd29c4`，不覆盖本增量——最终集成版本的新完整门禁仍开放，由唯一集成执行者串行补跑。
- 未验证 Linux/Windows（本轮仅在 macOS arm64）；未操作真实工作根/凭据/旧库；`consistency_backup` 未在多连接并发写入下压测（Backup API 单事务读一致性由 rusqlite 保证，未独立复核其并发语义）。
- `open()` 的 WAL 只读分类在无 `-shm` 场景（如外部只读挂载）可能误报 `CORRUPT_DATABASE`，未构造该环境验证，列入后续留意项。
