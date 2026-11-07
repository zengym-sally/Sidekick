# W1 P1 修订版独立复审（ZCode R2）：通过（B1/M1/M2/M3 全部关闭，实证复核；新发现仅非阻断）

- **评审对象**：修订提交 `1a50a149b4b251ab13a051f4ac892c041d44d62b`（tree `2629e59389aeb3b74327c67d8d02f8802f2688b4`，父恰为 `03e544516039a9d5150681347ab0dea2bfadd190`），即 `docs/engineering/web-manual-items-contract.md`（350 行）与 `docs/reviews/web-manual-items-authorization-20261108.md`（253 行）。规范增量 `03e5445..1a50a149`：2 files changed, +164/−51，恰为两份提案。派发评论 `01a1b70c-5840-718d-83fa-92ceb51d049b`；沿首轮结论（`2706044`，不通过：1 阻断 + 3 主要）复审，与作者及生产实现均无参与关系。
- **结论**：**通过**。首轮 1 阻断 + 3 主要全部关闭（B1 经内存库四用例对照实证，M1/M2/M3 经契约文本与冻结契约逐条核对）；m1–m7、n1–n7 处置逐项落实且与两文档正文一致。本轮新发现问题仅 1 项次要（文档措辞方向性错误）+ 3 项 NIT，均不阻断，不重开方案。MAYNE-23 实施准入仍由队长按流程收口，本复审不代签。
- **评审依据**：精确基点 `65469904d8baddde738646dfed3bf4a921f47b68`（tree `7b71cdb3…`）源码全文、冻结 `web-api/1`（`61863271…f58d`）、冻结 001 DDL（`8511907c…143d`）、W0 runner（`web_backend_schema.rs`）、legacy `local_store.rs`／`src/domain/todos.ts`、产品与工程文档（同首轮）。首轮已核实且本轮未变的结论（owner 授权原文、授权对应表 #1–#13、产品符合性主体）按派发复用，不再重开。
- **边界**：提案与生产实现只读；仅写本记录与本机 `build/web-manual-items-contract-r2-review/`。验证限轻量检查与 `node:sqlite` 内存合成库；未实施迁移、未安装依赖、未跑完整门禁、未改状态/main。未实现的 HTTP 路径按契约自洽性审查，不冒称端点实测。作者 `build/` 证据未随评论可达，关键关闭结论全部独立取证，未引用不可达日志。

## 一、身份与不变量核实：全部一致

| 项 | 复核结果 |
|---|---|
| 提交/树/父 | `1a50a149` / `2629e593…` / 父恰 `03e5445`，与交付评论一致；增量恰改两份提案（+164/−51） |
| 修订补丁 | `git diff 03e5445 1a50a149 \| shasum -a 256` ＝ `0ecfa20e91c8fc716ede2758896c8774dba4d940a4a6fc54a4af6a13f574fd86`，与声明逐字符一致 |
| 两文档哈希/行数 | contract `838c6188…6447`（350 行）、authorization `0838af41…8104`（253 行），均与声明一致 |
| 拟议 DDL | §5.1 原样 SQL 块提取（授权文档 99–153 行）SHA-256 ＝ `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e`，与候选 DDL 哈希声明一致；末句即镜像 UPDATE |
| 冻结 001 | `8511907c…143d`，在 `6546990`／`03e5445`／`1a50a149` 三点实测逐字节相同 |
| 冻结 web-api/1 | `61863271…f58d`，同上三点实测相同 |
| 相对链接 | 两份修订文档全部唯一相对 .md 链接逐条 `git cat-file -e 1a50a149:<目标>`：16/16 解析（contract 11 + authorization 5），0 断链 |
| 行号引用复核 | `local_store.rs:15`（capture_method）、`local_store.rs:1273`（ingestion 共享命名空间）、`src/domain/todos.ts:39`（`effectivePoint`＝`followup??due`）在基点原文逐条命中 |

## 二、按派发重点逐项结论

### 1. B1（阻断关闭）镜像更新已入 002 同一事务，四用例对照全部通过

Runner 事实复核（基点 `web_backend_schema.rs`）：`validate()` 在 `apply_migrations` 之前执行，`schema_version != PRAGMA user_version` 即 `WEB_BACKEND_SCHEMA_VERSION_MISMATCH`（375 行）；镜像行由 001 的 `INSERT INTO schema_meta (… id=1 …)` 建立，002 的 `UPDATE … WHERE id = 1` 有确定目标；`configure_connection` 每连接 `PRAGMA foreign_keys=ON`。

`node:sqlite` 内存库对照矩阵（Node v24.20.0，脚本 `build/web-manual-items-contract-r2-review/r2-ddl-matrix.mjs` 可复跑，逐事务模拟 rusqlite_migration 的单迁移事务＋事务内 user_version 语义）：

| 用例 | 结果 |
|---|---|
| A 全新 init(001+002) → 重开 validate | PASS `{userVersion:2, schemaVersion:2}` |
| B 既有 v1 库 → 前向迁移 002 → 重开 validate | PASS `2/2`（迁移前 v1 校验亦过） |
| C 同一 DDL 去掉镜像 UPDATE（首轮提案）→ 重开 | FAIL `WEB_BACKEND_SCHEMA_VERSION_MISMATCH`（2/1）——首轮 B1 精确复现，证明修复项就是关闭项 |
| D 002 事务内故障注入（runner `Ddl` 分支同型）→ 整体回滚 | `user_version=1`／`schema_version=1`、两新表缺席，重开 validate PASS——§5.4「停留 v1、不部分应用」实证成立 |
| E 约束健全性 | 重复 `operation_id`／`version=0`／completed 缺时间戳/坏 FK/坏枚举 5/5 按预期拒绝 |

§5.2 runner 改动（`SCHEMA_VERSION`→2、`migrations()` 追加 002、故障注入适配双迁移「在 002 之后注入失败，验证整体回滚到 v1」）与现 runner 的单迁移故障分支（向 SQL 末尾追加 `INSERT INTO missing_web_backend_table`）同构，按描述可实现；用例 D 即该语义的实证。**B1 关闭。**

### 2. M1（主要关闭）删除后读写与幂等重放顺序已自洽且成闭环

- §6 改为「详情与历史可读；`PUT`／`complete`／`reopen`／`DELETE` 一律 409 `state_conflict`」，与 §7（默认清单排除、详情与历史可查）、§11 删除行（含反例「删除后仍可变更」）一致；首轮的 §6 vs §7/§11 矛盾消除。
- §5 补删除可见性约定：缺省＝`open`+`completed`，`status=deleted` 显式可读（历史/审计），`status=all` 全量——首轮要求「二选一写明」已落实且与端点表错误列一致（GET 仅 404，无 409 残留）。
- **重放优先于状态守卫**明文化：同 `operationId` 同规范输入即使已删除仍按重放规则返回、守卫不得前置；与删除变更 409、响应未知重放路径组合后顺序闭环（重放判定 → 状态守卫 → 版本守卫），`idempotency_conflict`（不同规范输入）语义与冻结 §3.3 一致。显式迁移表（m3）与各端点错误列（complete 仅 open、reopen 仅 completed、delete 拒 deleted）互洽。**M1 关闭。**
- 措辞残留（新，NIT-1）：§6 首条「重放返回既有事项当前权威状态」与次条「按重放规则返回原结果」中「原结果」可被误读为历史快照；按冻结 §4.1「重放返回同一对象」语义应统一为「按幂等规则返回（`replayed:true`）＋当前权威状态，不因当前状态 409」。一句措辞统一即可，不改语义。

### 3. M2（主要关闭）事项提示帧与任务 cursor 完全隔离，补偿路径闭合，且与冻结契约相容

- 修订采用队长登记的选项②：`item.changed` 为进程内提示——无 `id` 行、不计任务 cursor、不写 `task_events`；首订阅／每次重连／`stream.reset` 后及怀疑丢失时以 `GET /api/manual-items`／`/{itemId}` 读回补偿，提示仅触发刷新、不作事实来源；提示漏收不得造成可见状态回退。
- 与冻结 `web-api/1` 逐条核对：冻结 §6 自身已有无 `id`、不参与重放与游标推进的帧先例（`stream.ready`／`stream.reset` 明文「无 `id` 行」），`item.changed` 沿同一模式属兼容扩展（冻结 §3.1 有「类型集合按需扩充」先例、§14 允许兼容变更）；不写 `task_events` 即不触碰冻结 001 的 `object_type` CHECK（4 值，字节冻结），首轮识别的持久化不相容消除；任务帧与 `stream.ready`／`stream.reset` 语义「完全不变」，冻结 §6 的 epoch→快照规则保持任务域原样，事项域另立读回规则，两域隔离明确无交叉污染；`Last-Event-ID` 重放不适用于事项帧由「不享有持久游标与断线重放能力」明示。**M2 关闭。**

### 4. M3（主要关闭）真实同源静态供给与构建/测试清单闭合

- 契约 §9.4 逐文件清单（`server/lib/static-files.mjs`：MIME/缓存/SPA fallback、`/api` 不 fallback；`scripts/build/build-backend.mjs` 打包入口＋复制前端 `dist/`；`package.json` 脚本）与授权 §4.1/§4.2 逐行对应；§9.2 目录树、§9.3（`/api` 之外交 `static-files`）、§1/§13（底座含静态供给）、§10 步骤 3、§11 验收行（含反例「静态资源跨源」「依赖设计预览」）全线贯通。
- 测试闭合：授权 §4.3/§6 增 `tests/integration/web-manual-items-static.test.mjs`（同源静态）与浏览器矩阵行（1440×1000／640×900，加载后端同源 UI 覆盖 §11 全部项）；开发期 Vite 代理明文「仅开发便利、不作为验收链路」，真实同源验收要求保留。首轮识别的「验收依赖清单中不存在的东西」消除。**M3 关闭。**

### 5. m1–m7、n1–n7 处置逐项核对：全部落实，两文档一致

| 项 | 核对 |
|---|---|
| m1 | cursor＝不透明 token 编码复合水印 `(created_at_ms, item_id)`，limit 50/200——已落 §5；**残留一处方向性措辞错误（新，MINOR-1，见下）** |
| m2 | §4.3 整体替换、`kind` 可互换、`followup` 挂 `action` 接受但忽略（引 `effectivePoint` 正确）、`due` 挂 `followup` 作回退——与 §4.2 字段表及 DDL 列结构相容 |
| m3 | 显式状态迁移表取代自然语言，首轮两种析读歧义消除 |
| m4 | §9.1「新增与已验证的边界」明文区分探针已验证的子进程模式与新增七命令帧协议，承诺 §10 步骤 1/2 测试自证——措辞不再过强 |
| m5 | SQL/PRAGMA 权限范围四条明文（transact 参数化限业务表、禁 ATTACH/PRAGMA 写/load_extension/VACUUM/COPY；query 只读；pragma 只读事实；无 shell、路径规范化） |
| m6 | `manual_items_list_order(created_at_ms DESC, item_id ASC)` 已入 §5.1；EXPLAIN 实测：无过滤扫描走 COVERING INDEX、无 TEMP B-TREE；**默认过滤（status IN open,completed）规划器仍选 `manual_items_status`＋TEMP B-TREE 排序（NIT-2，见下）** |
| m7 | §11 增「数据库层」行（行存在/版本递增/事件一致），授权 §4.3 明文「HTTP 集成测试即数据库观测层」 |
| n1 | `/history` 限 `sequence DESC` 分页＋limit/cursor（§5），与 `manual_item_events_item(item_id, sequence)` 索引相容 |
| n2 | 保留域内 UNIQUE＋§13 下游边界声明（引 `local_store.rs:1273` 核实无误）；DDL 未预先扩大，处置一致 |
| n3 | `src/stores/pairing.ts` 已入契约 §9.2，两文档同步 |
| n4 | §3 表增 #10 package.json 行（需具体化，非依赖） |
| n5 | §3 路径 7 改「事项、状态与历史原样重现」＋W0 队列状态按自身契约保留的注记；§2/§11 同步改 |
| n6 | 保留 manual-only 线格式，§4.1 注明候选切片再定义 `capture_method`/`source` 映射（引 `local_store.rs:15` 核实无误） |
| n7 | §5.5 拟登记冻结扩展清单五类齐全，与契约正文逐一对应（端点/错误码/事件/线格式/DDL 含镜像更新），交队长冻结动作 |

两文档一致性：§5.5 扩展清单、命令表（授权 §6 比契约 §12 多一条「同源静态」显式行，内容一致不冲突）、runner/守卫改动描述、M1/M2/M3 落点全部互洽；全文扫荡无首轮矛盾语句残留（「队列」仅存于 W0 范围注记，「非历史读取」旧表述已清除）。

## 三、本轮新发现（均非阻断，不重开方案）

- **MINOR-1（新）插入稳定性句与声明排序方向相反**：契约 §5 列表分页写「新事项 `created_at_ms` 更晚，只出现在后续页」，而声明排序键为 `created_at_ms DESC`（最新在前）。DESC 下新事项只会出现在**重新读取的首页**，进行中的游标遍历后续页永远不会包含它（水印之后＝更早创建）。按该句写测试（「新事项出现在后续页」）必然失败。建议改为「新事项只出现在重新读取的首页；进行中的分页不被打乱，游标不跳行」。一句措辞修正，排序键/水印/索引本体自洽，不构成语义缺陷。
- **NIT-1** §6「原结果」措辞见二.2，建议与「当前权威状态」统一。
- **NIT-2** §5.1 m6 注释「without a TEMP B-TREE」仅对无过滤扫描成立；缺省过滤列表实测仍有规划器排序（`USE TEMP B-TREE FOR ORDER BY`）。事项规模下无实际影响；如未来需要可加 `(status, created_at_ms DESC, item_id)` 变体或按容量边界说明，不要求本轮处理。
- **NIT-3** 契约 §9.4 表未列 `tests/integration/web-manual-items-static.test.mjs`（仅在授权 §4.3/§6 命名）；契约 §12 已有「同源浏览器」行覆盖，可选择性同步命名。

## 四、实证与显式未验项

- **实证**：Node v24.20.0（`node:sqlite` 内存库）；全部命令、哈希、退出码与输出见附件 `command-log.txt`／`r2-ddl-matrix-output.txt`；脚本 `r2-ddl-matrix.mjs`、DDL 原样提取 `002_manual_items.extracted.sql`、冻结 001 与 web-api 契约原文快照均在 `build/web-manual-items-contract-r2-review/`（本机，gitignored），可复跑。
- **显式未验**：完整 `npm run check`（按派发由集成执行者串行执行）；DDL 实施与 `rusqlite_migration` 真实行为（内存库按其单迁移事务语义模拟，非 rusqlite 实测）；HTTP/SSE 端点行为（未实现，按契约自洽审查）；静态供给与构建脚本（未实现）；作者本地 `build/` 证据与合成反例脚本（未随评论可达，关键结论已独立重建）；P2 报告（OhMyPi 范围，结论保留）；规模性能、Linux/代理、真实库/凭据/工作根。

## 五、结论与建议

**通过**：B1（一行 UPDATE＋runner 故障注入适配）、M1（语义重写＋列表可见性约定）、M2（选项②边界声明＋读回补偿）、M3（静态供给逐文件清单＋构建/测试接入）全部关闭且经独立取证；m1–m7/n1–n7 处置属实、两文档一致；冻结 001 与 web-api/1 逐字节未动；授权对应沿用首轮结论未放宽未收紧。本轮新增 1 次要（MINOR-1 措辞方向）与 3 NIT，均可在实施前随手修正，不需要再次独立复审循环；建议队长在收口 MAYNE-23 实施准入时把 MINOR-1 的句子修正列为实施前置项即可。P2 通过结论保留；MAYNE-23 维持 backlog。
