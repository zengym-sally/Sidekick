# W1 P1 手工事项契约与授权提案独立评审（ZCode）：不通过（1 阻断 + 3 主要；修订量小，方向认可）

- **评审对象**：`03e544516039a9d5150681347ab0dea2bfadd190`（父 `03bf15d`＝基点内容的裸基线提交，tree `06e8f7ac4203d51251871114d161232c15689a04`），即 `docs/engineering/web-manual-items-contract.md`（293 行）与 `docs/reviews/web-manual-items-authorization-20261108.md`（197 行）。派发评论 `01a1b6ea-5d21-774d-ba22-db840de75cf5`，与 OhMyPi 的 P2 审阅并行、未参考其结论。
- **结论**：**不通过**（按派发的两分口径）。依据：1 项阻断（拟议 002 DDL 缺 schema_meta 镜像更新，实证复现打开即拒）＋ 3 项主要（删除后读取语义自相矛盾、事项 SSE 补偿路径未定义、浏览器同源静态供给缺位）。同时明确：提案的身份、引用、产品符合性与授权对应总体质量高，全部修订均为小改动，修订后可较快复审。
- **评审依据**：精确基点 `65469904d8baddde738646dfed3bf4a921f47b68`（tree `7b71cdb3…`）源码全文、`docs/product/01`–`05`、冻结 `web-api/1`（`61863271…f58d`）、冻结 001 DDL（`8511907c…143d`）、W0 runner（`web_backend_schema.rs`）、legacy `local_store.rs`／`src/domain/todos.ts`／`src/stores/todos.ts`／`shared/dates.mjs`、`web-backend-design.md`、`backend-foundation-probes.md`、`architecture.md`、owner 评论原文。
- **边界**：作者提案与实现只读；仅在本次隔离树写本记录与 `build/web-manual-items-contract-review/`。未跑完整 `npm run check`、未实施 DDL、未安装依赖、未改 manifest/锁文件、未动状态与 main。未实现的 HTTP 路径一律按契约自洽性审查，不冒称端点实测。反例只用 `node:sqlite` 内存合成库。

## 一、身份与声明核实：全部一致

| 项 | 复核结果 |
|---|---|
| 提交/树/父 | `03e5445` / `06e8f7ac…` / `03bf15d`，与交付评论一致；`03bf15d` 对基点 `6546990` 内容 diff 为空（裸基线），全增量恰为两份提案 |
| 补丁哈希 | `git diff 03bf15d 03e5445 \| shasum -a 256` ＝ `f6ac85ed4d4a2faaa76f7a71089ecbaeaed54e3a0e6a0d20cdaabff7bf00f054`，与声明逐字符一致 |
| 文档哈希 | contract `776e0bff…64a9`（293 行）、authorization `9d5cd6b2…aeaa`（197 行），均与声明一致 |
| 冻结契约 | `web-api-contract.md` 实测 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`，与授权文档 §8 声明一致 |
| 冻结 001 | 实测 `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`，与授权文档 §5.2 及 `check-structure.mjs` 冻结表一致 |
| owner 授权原文 | `01a1b648-6d01-74e8-a06a-2d824003a5e5`（MAYNE-22 线程，member，2026-11-07T13:52:42Z）原文逐字核对，与授权文档 §2 引文一致 |
| 相对链接 | 两份提案全部相对链接逐条 `git cat-file -e 03e5445:<目标>`：30/30 解析，0 断链 |
| check-docs 声明 | 「21 文件、472 链接」口径成立：守卫排除 `docs/reviews/**`（仅收 README），基线 20 文件 + 仅 contract.md 计入＝21；authorization 文档本身不入该守卫统计，其链接已由本评审独立核过 |

## 二、按派发质疑逐项结论

1. **CRUD／完成／重开／删除／历史／时间锚点／版本冲突／幂等／响应未知闭环**：主体成立。八个端点齐备；`TimePoint{at,timeZone,localText,precision}` 与 legacy `todos` 表字段（`due_at_ms/due_timezone/due_local`＋precision，`local_store.rs:15`）及 V02 锚点规则一致；`followup??due` 归组与 `src/domain/todos.ts:39 effectivePoint` 逐字一致；条件更新＋影响行数与冻结 §3.3、legacy `validate_change` 同语义；幂等重放／不同输入 409／重放不耗版本与冻结 §3.3 一致；响应未知按重放或按 itemId 读回闭环。新端点、`item_not_found`、`item.changed`/`objectType:item` 均为兼容扩展（冻结 §3.1 自身有「类型集合由 W1+ 切片按需扩充」先例，§14 允许兼容变更），未改冻结字段语义——**但删除后读取语义在 §6 与 §7/§11 之间自相矛盾（M1），事项的快照补偿路径未定义（M2）**，闭环在这两点上未合拢。
2. **stdio 连接/根锁生命周期、SQL/PRAGMA 权限、事务所有权；浏览器冷启动与无模型路径**：Rust 适配拥有连接与根锁、Node 不按路径重开业务库，与设计 §2 一致；子进程模式有探针背书，但**「已验证的 stdio JSON 子进程协议」表述过强（m4）**——探针实测的是 argv 传参＋stdout 末行 JSON 的一次性调用（78 次）与 stdin-EOF 优雅关停/锁生命周期，`init/open/close/backup/transact/query/pragma` 七命令帧协议、`transact` op-list、`backup`/`pragma` 命令均不在探针子命令集内，属本提案新增，需按 §10 步骤 1/2 的测试自证，措辞应区分「已验证模式」与「新增协议」。事务所有权清楚（端点=同步短事务、transact=单事务原子、无嵌套）；**SQL/PRAGMA 权限范围未声明（m5）**。无模型路径成立（§8 不依赖模型/凭据）；配对码终端显示在设计 §3 已定义；**但浏览器同源静态供给在逐文件清单中缺位（M3）**。
3. **拟议 DDL**：约束/索引本体质量好——CHECK 三元组、状态-时间一致性、version≥1、precision 枚举、事件 FK＋operation_id UNIQUE 共 11/11 语句反例实测按预期拒绝/接受（`foreign_keys=ON` 由 runner 每连接施加，FK 非摆设）；写入与事件同事务由 `transact` 语义保证；普通打开拒绝不写入由 W0 runner「validate 先于 configure」保持；迁移前备份＋失败整体回滚与 runner 实现相符。**但 002 缺 `UPDATE schema_meta SET schema_version=2` 镜像语句，实证使每个被迁移库在下次打开即报 `WEB_BACKEND_SCHEMA_VERSION_MISMATCH`（B1，阻断）**；列表排序列无索引（m6）；未来历史读取自洽（before/after＋规范请求＋按 sequence 索引）。
4. **纵向检查点与逐文件清单**：§10 是切片内部的构建顺序，每步有可验证产物，终点是 §11 的 13 条浏览器可观察验收＋证伪反例——是「一个纵向切片的分步落地」，不是按层推进替代纵向切片，满足派发要求。§11 未显式写数据库观测检查点（P2 矩阵有「数据库结果」一列，m7）；逐文件清单覆盖生产/测试/守卫/文档，**缺静态供给环节（M3）与事项快照形状（M2）**。
5. **授权判断逐项核对**：无增设无依据审批点。owner 评论逐字核实；#1/#6/#7/#8「已覆盖」的解读忠实（#6–8 是把 W0 语境下的一般指令沿用至 W1，授权文档已自标为原则性覆盖，准入收口时由队长/owner 确认即可，不构成新闸门）；#2（具体 DDL 须审批）与 AGENTS.md「改 schema/migrations 需单独授权」及 Kimi P2 同口径；#3（`server/` 顶层）对应 `architecture.md:68`「新增一级目录必须同步本文与守卫」——`server` 确不在 `TOP_LEVEL_DIRS`，属实；#4（`[[bin]]`）与 #5（打包入口）对应 probes §7.2「随包分发需打包授权」，非无据；#11/#12 未授权项如实。遗漏仅 package.json 变更未列入 §3 表（n4，非依赖变更，不构成缺口）。

## 三、发现项

### B1（阻断）拟议 002 DDL 缺 schema_meta 镜像更新——每个被迁移库下次打开即被拒

- **位置**：授权文档 §5.1（完整 DDL，止于 `manual_item_events` 索引）、§5.2（「`schema_version` 由 1 递增为 2」「权威与镜像…两者不符显式拒绝（沿用 W0 R2 契约）」）。
- **依据**：W0 runner `web_backend_schema.rs` 的 `validate()` 要求 `schema_meta.schema_version == PRAGMA user_version`（375 行），否则 `WEB_BACKEND_SCHEMA_VERSION_MISMATCH`；镜像递增只能发生在 002 的同一事务内（R2 的「同事务镜像」），而 §5.1 DDL 与 §5.2 runner 改动均未包含该语句。001 无触发器（全文已核）。
- **实证**（`node:sqlite` 内存库，Node v24.20.0，脚本与输出在 `build/web-manual-items-contract-review/`）：
  - Case A 全新 init(001+002)：`user_version=2, schema_version=1` → 下次 open FAIL；
  - Case B 既有 v1 库前向迁移后重开：同 FAIL；
  - Case C 末尾追加 `UPDATE schema_meta SET schema_version = 2 WHERE id = 1;`：PASS。
- **必要修改**：002 末尾（同一迁移事务内）追加该 UPDATE；W0 runner 的故障注入测试（`apply_migrations` DDL fault 分支）随之适配双迁移；§5.2 runner 小节补一句「镜像更新由 002 内 UPDATE 完成，不在 runner 代码中回写」。

### M1（主要）删除后事项的读取语义自相矛盾

- **位置**：契约 §6 第 4 条「对 `deleted` 事项的非历史读取返回 409 `state_conflict`；历史读取仍可用」vs §7「从普通清单排除，历史与详情可查」vs §11 删除行「详情与历史保留」。
- **依据**：三处直接冲突：按 §6，详情 GET 应 409；按 §7/§11，详情应可查。实现者无法同时满足。
- **必要修改**：改 §6 为「对 `deleted` 事项：详情与历史读取可用；任何变更操作（update/complete/reopen/delete）返回 409 `state_conflict`」，并在 §5 列表约定中写明默认清单排除 deleted、显式 `status=deleted` 过滤是否允许（二选一）。

### M2（主要）事项的 SSE 补偿/快照路径未定义，且与冻结事件持久化不相容

- **位置**：契约 §5 事件约定「`item.changed` 帧，信封与游标规则沿用冻结契约 §6，`objectType` 兼容扩展为 `item`」；§10 步骤 5「快照重读」。
- **依据**：(a) 冻结 §6 的短断线重放与 epoch 变化后「必须调用 `GET /api/snapshot`」都以持久事件流为前提，其持久化载体是 `task_events`（冻结 §12「SSE 与审计同源…不在表上按域分叉」），而冻结 001 的 `task_events.object_type` CHECK（`001_web_backend.sql:77`）只允许 4 个值、无 `item`，001 字节冻结不可改——`item.changed` 帧要么不落 `task_events`（则冻结 §6 的断线重放对事项帧不成立、cursor 从何而来未定义），要么需要提案未提出的迁移；(b) 快照端点形状只定义了任务条目，事项 epoch 变化后的重同步入口未定义。
- **必要修改**：三选一并写明——① 002 内为事项事件定义独立持久化与全局 cursor 分配方案；② 声明事项帧仅进程内广播、不参与断线重放，事项客户端在 `stream.reset` 后以 `GET /api/manual-items` 重读补偿（对事项对象的显式边界声明）；③ 扩展快照形状（兼容可选字段）纳入 items。同时说明事项帧 cursor 与 `task_events` cursor 的统一或隔离规则。

### M3（主要）逐文件清单缺浏览器同源静态供给

- **位置**：契约 §9.2（`http-server.mjs` 只有「路由、错误信封」）、授权文档 §4.1（无静态服务文件）、§4.2（构建入口只提「后端 bundle」）。
- **依据**：设计 §3 明确「后端监听 `127.0.0.1`，同源提供 Web 静态资源、业务 API 与 SSE」；`SameSite=Strict` cookie 与精确 Host/Origin 校验预设同源。本切片自身验收（§11 全部浏览器可观察项、§12 Playwright 矩阵）需要浏览器加载 UI 并同源访问后端，而清单中既无静态服务模块，也无前端产物进入后端 bundle 的构建步骤，也未声明开发期替代安排（如 Vite 代理 + Host/Origin 对齐）。
- **必要修改**：在 §4.1/契约 §9.2 增加静态供给（如 `server/lib/static-files.mjs` ＋构建产物对接），或显式声明本切片浏览器验收采用的开发期同源安排并把生产静态供给列入后续切片边界。

### 次要（MINOR）

- **m1** 契约 §5 列表：`cursor`/`nextCursor` 编码与插入稳定性未定义（排序键 `created_at_ms DESC, item_id` 已定，游标水印未定）。
- **m2** 契约 §4.3：更新输入是整体替换还是部分更新、`kind` 可否互换、`followup` 挂在 `action` 类上是拒绝还是接受-忽略（legacy 为接受-忽略，`effectivePoint` 对 action 忽略 followup）未声明。
- **m3** 契约 §5 reopen 行「409 `state_conflict`（非已完成或已删除）」存在两种中文析读（其一允许从 deleted 重开）；建议改显式迁移表：complete: open→completed；reopen: completed→open；delete: open|completed→deleted。
- **m4** 契约 §9.1「已验证的 stdio JSON 子进程协议」措辞过强（见上文二.2）；帧格式/请求关联/错误分类为本提案新增，应区分已验证模式与新增协议并承诺测试覆盖。
- **m5** 契约 §9.1：`transact` 接受 Node 侧原始 SQL、`pragma` 命令范围未声明；应写明 DML 限定业务表＋参数化、pragma 仅只读事实，或说明为何无需限制。
- **m6** 授权 §5.1：列表排序无支撑索引，EXPLAIN 实测 `USE TEMP B-TREE FOR ORDER BY`；建议追加 `manual_items(created_at_ms, item_id)` 索引或写明容量边界。
- **m7** 契约 §11：未显式列出数据库层观测检查点（行存在、version 递增、事件行数）；建议补一行或指明集成测试即 DB 观测层。

### 提示（NIT）

- **n1** `/history` 返回无界 `{events:[…]}`，未定义 limit/cursor。
- **n2** `operation_id` 幂等命名空间：事件表 UNIQUE 仅域内；legacy 在 ingestion 与 todo_events 间共享命名空间（`local_store.rs:1273`），后续候选签收切片接入时需声明全局或按资源族的策略。
- **n3** 授权 §4.1 列了 `src/stores/pairing.ts`（可选），契约 §9.2 前端清单未提——两文档宜同步。
- **n4** 授权 §4.2 有 package.json 变更行，§3 表无对应行（脚本≠依赖，无授权缺口，补一行更完整）。
- **n5** 契约 §3 路径 7「队列位置原样重现」：队列属任务域（W0/后续切片），手工事项切片宜删除或注明指 W0 存储保留的既有队列状态。
- **n6** 线格式较 legacy 少 `capture_method`（`local_store.rs:15`）；本切片 manual-only 可接受，候选切片需定义字段映射。
- **n7** 冻结记录应登记扩展清单（`item_not_found`、`item.changed`/`objectType:item`、002 DDL）——属 Codex 冻结动作，建议提案附此清单备收口。

## 四、实证与显式跳过

- **实证命令/版本**：Node v24.20.0（node:sqlite 内存库）；全部命令、退出码与输出逐条记录于 `build/web-manual-items-contract-review/command-log.txt`；反例脚本 `ddl-counterexample.mjs`（sha256 `e4e4f02d…ccc4`）、`ddl-secondary-checks.mjs`（`2d7e33ae…c741`）可复跑；基点关键源文件原文快照同目录留存。
- **显式跳过**：完整 `npm run check`／`check:structure` 全量（派发禁止）；DDL 实施与依赖安装；HTTP 端点实测（未实现）；P2 readiness 报告评审（OhMyPi 范围）；规模性能、SSE 实现行为、Linux/代理、真实库/凭据/工作根。

## 五、复审口径建议

B1 为一行 SQL 的修订；M1 为一句语义重写；M2/M3 为补定义（可选项②/开发期安排工作量最小）。四项修复 + 次要项表态后，本提案的结构、产品符合性与授权对应无需重写，可提交修订版由队长决定按增量或全量复审。
