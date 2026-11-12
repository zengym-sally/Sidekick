# MAYNE-24 P1 文本整理与签收提案独立评审（ZCode）：不通过（2 阻断 + 1 主要，小修订可闭合）

- **评审对象**：P1 提交 `3cfc5ab42dc8a5ac9ebb71e2b54348b1f00df345`（tree `8c998389b787075e2a391ab2558da156d50e3146`，父 `19045b81049e9831195da88a1e821645ba0813f7`）的两份提案：`docs/engineering/web-text-intake-contract.md`（278 行，SHA-256 `c28eba62…db6622`）与 `docs/reviews/web-text-intake-authorization-20261108.md`（305 行，SHA-256 `86ad3333…b9055`），附拟议 `003_text_intake.sql`（SHA-256 `921fc97e…79bdc`）、反例脚本与输出。派发评论 `01a1baad-7c70-7f32-9cf2-377bc477e633`；源码基点 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`（tree `77a548591ac9b02a51936c806bf4f85d774df7cb`）。评审者未参与本项提案与实现，与 OhMyPi 的 P2 审阅相互独立、并行。
- **结论**：**不通过（不通过＝小修订后重审，非方向否定）**。身份/哈希/引用/授权台账全部核实无误，冻结契约兼容性主体成立，但拟议 003 的 `manual_items` 重建在真实 runner 外键语义下被既有 `manual_item_events` 行阻断（阻断 1），批量签收与两级 UNIQUE 主键约束冲突且未声明 W1 §13 n2 义务的幂等命名空间策略（阻断 2），任务结果事务跳过冻结契约的 `resultPendingExit` 暂存语义（主要 1）。三项均有明确小修订路径（见各条处置），无需推翻方案结构。
- **边界**：候选只读；仅写本记录与本机 `build/web-text-intake-contract-review/`（gitignored，原始证据：附件原文、复算脚本与输出、命令日志）。未改生产/DDL、未创建迁移文件、未装依赖、未跑完整门禁、未调真实模型；验证限 `node:sqlite` 内存/临时合成库与静态取证，未实施迁移、未运行真实 runner 二进制。MAYNE-24 保持 backlog，父任务保持 in_progress，不代签实施准入。

## 一、身份与引用核实：全部一致

| 项 | 复核结果 |
|---|---|
| 提交/树/父 | `git cat-file` 实测一致；非基点祖先（`git merge-base --is-ancestor` NO），与登记「不以旧 HEAD 冒充」一致 |
| 补丁 | `git diff 19045b8..3cfc5ab` SHA-256 `b871b1c8…1d293` 与声明逐字符一致；增量恰为两份新文档（+583/−0），生产源码零触碰 |
| 附件哈希 | 四项声明哈希（两文档、003、补丁）对实际下载附件逐一 byte-exact；提交内 blob 与附件内容逐字节相同 |
| 基点身份 | `1e37044` tree `77a5485…` 实测与登记一致 |
| 冻结哈希 | 授权文档 §9 三项在基点实测相同：001 `8511907c…143d`、002 `b6cb8e61…f97e`、web-api/1 `61863271…f58d` |
| 复用锚点 | 契约 §2/§8 引用的 16 个文件全部在基点存在（`TextIntake.vue`、`InboxView.vue`、`CandidateCard.vue`、`src/domain/candidate.ts`、`src/stores/organizer.ts`、`models.ts`、`agents.ts`、`today.ts`、`src/lib/web-api-client.ts`、`runtime/entries/organizer-entry.mjs`、`runtime/lib/organizer-contract.mjs`、`scripts/build/bundle-runtime.mjs`、`shared/today-facts.mjs` 等） |
| 行号引用 | `ingestion.rs` `sign_candidates` 实际在 `:646`（提案写 `:612`，NIT-2）；`web_backend_store.rs:18` `BUSINESS_TABLES` 恰为 `["manual_items","manual_item_events"]` 二元组；`check-structure.mjs:51` `IMMUTABLE_MIGRATIONS` 含 001/002 精确哈希，授权 §5.2 的追加方式可实现 |
| Pi 协议 | 契约 §7 的 stdio 请求/输出帧键集与 `organizer-entry.mjs` 实测逐键一致（`runId/hostNonce/kind∈{extract,revise,test,…}/snapshot/apiKey/anchorAtMs/timeZone/runLimitMs/cwd/mcp`；`progress/result/error/worker` 四种输出），`kind` 集合覆盖提案三类型 |
| 反例复算 | 附件反例仅改两条输入路径后原样重跑，A–E 五用例结果与交付声明完全一致（诚实）；但其用例从未写入 `manual_item_events` 行，恰是两个阻断未被发现的原因 |

## 二、阻断 1：003 重建在真实 runner 外键语义下被既有事件行阻断（实证）

- **Runner 事实**（基点 `web_backend_schema.rs`）：`configure_connection` 对每个连接先执行 `PRAGMA foreign_keys=ON` 再 `apply_migrations`；`rusqlite_migration 2.5.0`（Cargo.toml 锁定 `=2.5.0`）在**单个事务**内执行待应用迁移并在同一事务内置 `user_version`（crate 源 `lib.rs` `goto_up`：`conn.transaction()` → 逐条 `execute_batch` → `set_user_version` → `commit`），且 crate 文档明文警告不得在迁移脚本内调用 `PRAGMA foreign_keys`（事务内为 no-op）。
- **反例实证**（`node:sqlite` 内存库 + 临时文件库，复现脚本与输出随评论附件）：001→002→写入 1 条 `manual_items` ＋ 1 条 `manual_item_events` → 应用拟议 003 → `DROP TABLE manual_items` 触发对子表外键的隐式 DELETE 检查，报 `FOREIGN KEY constraint failed`，迁移整体回滚；文件库重开后 `user_version=2`/`schema_meta=2` 一致、1 行事项与 1 行事件原样、零残留表（数据库无损坏，但升级不可达）。任何真实用户至少有一条事项历史（创建/编辑/完成/删除均写事件），即**全部既有库升级被阻断**。
- **事务内 PRAGMA 救不了**：同一事务内 `PRAGMA foreign_keys=OFF` 后仍 `FOREIGN KEY constraint failed`，事务后 `PRAGMA foreign_keys` 读回仍为 1——拟议脚本内加 PRAGMA 语句不可行。
- **处置（小修订）**：003 改为**同事务双子表重建**：先建 `manual_item_events_v3`（DDL 逐字节取自 002，仅表名/FK 目标改指 `_v3`）→ 复制事件行（保序保 sequence）→ 先 DROP 子表再 DROP 父表 → 双 RENAME → 按原名重建四个索引 → 同事务镜像 UPDATE。同一修复方向已实证可行（附件 extras 输出 F5：FK=ON 全程、事件逐字节保留、`AUTOINCREMENT` sequence 连续、镜像/版本 3/3、`foreign_key_check` 空集、`signed_ai` 可写入）。拟议 003 的表定义本身（列序/CHECK/索引名）与 002 语义一致，仅需扩展重建范围，不需第二个迁移文件。

## 三、阻断 2：批量签收与冻结 UNIQUE 冲突，n2 幂等命名空间义务未声明（实证）

- **契约事实**：§5.1 `POST /api/sign-offs` 请求体为单个 `operationId` 覆盖整个 `choices[]` 批次（§8.3 `signOff(operationId, choices)` 同）。而冻结 002 的 `manual_item_events.operation_id` UNIQUE（逐行唯一）与拟议 003 的 `manual_item_sources.operation_id` UNIQUE 均按**行**唯一：N≥2 的批次要写 N 行事件＋N 行关联，两处第二行即撞 UNIQUE。
- **反例实证**（附件 blockers 输出 F3/F3b/F3c）：N=2、同一 `operationId` → `UNIQUE constraint failed: manual_item_events.operation_id`（冻结表）与 `UNIQUE constraint failed: manual_item_sources.operation_id`（拟议表）；N=1 对照组全程可写。批量签收正是本切片标题能力（契约 §1「批量签收」、§10「一次事务签收」），按现文案+DDL 实现，主路径必然失败。
- **义务缺口**：冻结 W1 契约 §13 n2 明文「`manual_item_events.operation_id` 的 UNIQUE 目前域内唯一；**候选签收切片接入时须声明全局或按资源族的幂等命名空间策略**」——本切片恰为该切片，两文档均未声明策略（0 处提及命名空间/派生规则）。
- **处置（小修订）**：二选一并写入两文档：①按确定性规则派生每行 operationId（如 `批次 operationId + '#' + candidateId`），事件与关联行存派生值，批次 operationId 另存一处用于幂等重放定位（如 003 增加 `sign_off_batches` 台账表，或以批次哈希索引既有行）；②放弃按行 UNIQUE、批次键单行落账。①可不动 003 的两级 UNIQUE、仅改语义文案；但 n2 要求的声明必须补上，重放判定须说明派生映射。

## 四、主要 1：结果事务跳过冻结契约的 `resultPendingExit` 暂存语义

- 契约 §6.1.4「结果（单事务）……并置 `state='succeeded'`、`result_ref`、`terminal_at`」在**收到结果帧时**直接落终态。冻结 `web-api/1` §3.1（`resultPendingExit` 字段行）、§3.2（running→running(resultPendingExit=true)「结果暂存……result 不可见；槽位不释放」；退出确认后才「与终态在同一事务提交」）与场景 24/29/31/32/33 均要求：**结果上报不构成进程退出确认**；暂存结局在退出确认（或恢复回收）时才提交为终态。
- 内部不自洽：§4.1 声称复用 001 的 `result_pending_exit`/`pending_outcome`，但 §6.1 全流程从不置位二者，场景 29/31 的「暂存结局回收后按原结局提交」与 §3.5 `result_exit_unconfirmed` 分支按此设计不可达；§6.1.6/§6.1.7 只覆盖无结果的退出未知与重启分流，缺暂存结果变体。
- **处置（小修订）**：§6.1.4 改为「结果帧 → 暂存事务（`result_pending_exit=1`、`pending_outcome` 按判别置值、`state` 保持 `running`；candidates/回执可在暂存事务内一并落库，不构成终态）」；新增「退出确认 → 单事务提交原暂存结局＋`attempt_exit_state='exited_confirmed'`＋释放槽位＋`terminal_at`」；§6.1.6/§6.1.7 补暂存结果变体（对应冻结 §3.4 回收三分支）。领域写库时序不受影响，改动集中在任务生命周期文案。

## 五、次要与 NIT

| 级别 | 项 | 说明与处置 |
|---|---|---|
| MINOR-1 | 授权 §5.4「迁移前 `consistency_backup`；失败时还原」按现文案不可实现 | `consistency_backup` 校验 `user_version == SCHEMA_VERSION`；§5.2 把 SCHEMA_VERSION 升到 3 后，对 v2 库的迁移前备份必以 `backup_failed` 拒绝；且冻结 runner 的 open 路径没有迁移前备份钩子，§5.2 的 runner 改动清单也未含此项。既无必要（阻断 1 处置已证单事务回滚＋重开自洽），应删除该承诺或把相应 runner 变更补入 §5.2 清单 |
| MINOR-2 | 范围自相矛盾：§1 把「今日建议的模型路径（advisor）」列入本切片，§8.2 又列 `src/stores/today.ts` 切换，但 §4.1 任务类型集合仅 `{extract,revise,test}` | advisor 任务无类型、无端点、§10 无验收行。从本切片移除 advisor 或补类型/端点/验收行 |
| MINOR-3 | 同指纹重复提交语义未定义 | §5.1 POST 只列 400/409；「同一文本指纹重提交沿用原锚点」暗示去重复用，但 UNIQUE 命中后返回什么、并发双提交谁胜谁负（400/409/200 复用既有 source）未写。按幂等语义补一段（建议：指纹命中→200 复用既有 source＋提示，竞态按 UNIQUE 冲突归并） |
| MINOR-4 | `candidates` 缺状态↔时间戳/外键元组 CHECK | 冻结 001/002 风格把 `completed↔completed_at_ms`、`deleted↔deleted_at_ms` 等不变量放 DDL；`accepted↔accepted_item_id/processed_at_ms`、`discarded↔processed_at_ms` 无对应约束，全靠应用层。对齐冻结风格补 tuple CHECK（可与阻断 1/2 的 003 修订同批） |
| MINOR-5 | 冻结 W1 契约 §13 欠本切片的「`capture_method` 与 `source` 字段映射」定义未交付 | W1 §13 明文「候选签收切片接入时再定义」；两文档 0 处提及 `capture_method`。补一句映射说明（`source='signed_ai'` ∧ `manual_item_sources` 关联行承载 legacy `capture_method` 语义）即可 |
| MINOR-6 | 「rowid 与值不变」不成立 | 附件 F4/F4 变体实证：原始 1..N 表重建后 rowid 恰好不变；含删除空洞的表重建后 2,3→1,2 重编号。rowid 无消费方（FK/游标均用 `item_id`/时间序），实际无害，但 §5.3/§4.3 的声明应改为「值逐字节保留；rowid 不承诺」 |
| NIT-1 | 契约 §8.1 Rust 侧清单缺 `web_backend_schema.rs` | `SCHEMA_VERSION`→3 与 `migrations()` 追加 003 在授权 §5.2 已覆盖；契约单读会漏。两文档清单对齐 |
| NIT-2 | `ingestion.rs:612` 应为 `:646` | 行号漂移，引用修正 |
| NIT-3 | worker 记录路径 `runs/<runId>/worker.json` 与探针已验证的 `runs/worker.json` 布局不同 | 「沿用已验证模式」的声明按模式成立（0600/pid 探测/不可核实即暂停语义与 W0 探针 D 组一致），按文件布局有差；实现时以探针 harness 布局为准或注明差异 |
| NIT-4 | 重建后 `sqlite_master` 中表 SQL 带引号（`CREATE TABLE "manual_items"`） | 与冻结 002 的无引号字节形态不同；语义等价、索引名一致，无需处理，登记备查 |
| NIT-5 | 新 epoch 的 `instance_epochs` 注册行未写入调度/恢复生命周期 | §6.1.4 fencing 依赖 epoch 比对，启动注册时机未提；补一句即可 |

## 六、核实无误的主体（按派发重点逐项）

- **队列/槽位/取消/退出未知/重启/重试**：§6.1.1–3/5–8 与冻结 §3.2/§3.3/§3.4/§4.4–§4.6 逐条对齐（满槽入 `queued` 无忙碌拒绝、槽位跟随 `attempt_exit_state`、取消意图先持久、退出未知占槽不补发、重启先核进程树、`auto_backoff` 须 `proven_safe`、凭据引用不随 retry 切换、`changes=0` 条件更新防双写者）。唯结果时序为主要 1。
- **SSE/快照补偿**：候选提示帧＝W1 M2 选项②先例（冻结 W1 契约 §5 明文「无 id 行、不计 cursor、不写 task_events、首订阅/重连/reset 后读回补偿」）＋冻结 web-api/1 §6 自带无 id 帧先例（`stream.ready`/`stream.reset`）；任务帧 `id=<epoch>:<cursor>`、快照高水位同形均照抄冻结，无交叉污染。
- **签收事务语义**：版本 CAS、`timeReviewed` 对 `unresolved` 的强制、关联只加来源不覆盖目标、部分失败整体回滚、按 `operationId` 重放先于状态守卫（＝W1 附录 A.2 规则）均与冻结语义一致；唯批次主键冲突为阻断 2。
- **凭据与授权边界**：`apiKeyRef` 只存引用、执行前解析、经 worker 私有 stdin 注入、不落 SQLite/argv/配置/日志/SSE——与冻结 web-api/1 §7 与设计 §4/§7 措辞一致；`organizer-entry.mjs` 实测 apiKey 只经 stdin 行、bash worker 以 `secrets:[apiKey]` 隔离，接线可行。**授权台账逐项核实无扩大**：#1/6/7/8 对 owner `01a1b648`（原文逐字比对：「全新的脚本去新建表结构……提交并合并到main，然后清理分支」）；#2 对 W1 A–D（owner `01a1b80b`「批准 W1 A–D」，范围与落地 W1 授权文档 §3/§12 登记一致，未把 002 授权偷扩为新表）；#3/4（`BUSINESS_TABLES` 扩展、runtime bundle 纳入）确为真实新增变更点；#5 生产 OS CredentialProvider 单列「实施时另行授权」，受控 provider 先行——**实现 CredentialProvider 接口与受控实现不索取真实凭据读取授权，未混淆两者**；#9–13（零新依赖、共享文件收口、完整门禁唯一执行者、push/部署/真实凭据/真实模型未授权）与父任务登记边界一致。`keyring-core`/`apple-native-keyring-store` 已锁版本在基点 Cargo.toml 实测在案，生产 provider 未来实施有已锁依赖可依，无需本轮索取。
- **产品符合性**：切片范围＝MAYNE-24（stage 4 文本签收），与父任务 stage 计划、W1 §13 后续切片登记、产品 02/04 的候选核对/签收/重启路径一致；「真实模型验收单列、受控服务先行」符合既定开放条件。
- **合成对照诚实性**：附件反例 A–E 复算结果与声明一致（仅缺事件行种子，见阻断 1/2——是覆盖缺口，不是造假）；补丁/文档/DDL 四哈希全对。

## 七、验证命令与未验项

命令（本轮全部执行，日志在证据目录 `command-log.txt`）：`git cat-file`/`git diff`/`git merge-base`（身份）、`shasum -a 256`（附件/冻结哈希）、`git show` 抽取冻结件、`node scratch/blockers.mjs`、`node scratch/extras.mjs`、`node scratch/rowid-variant.mjs`、`node scratch/their-counterexample-adapted.mjs`（附件反例原样复算，仅改两条输入路径）、crate 源与 runner 静态取证、owner 两评论原文调取比对。

未验项（不因本轮通过与否关闭）：
- 未运行真实 Rust runner/`cargo test`（含 §5.2 故障注入分支适配）；外键阻断结论由 crate 2.5.0 源码语义＋冻结 runner 连接契约＋`node:sqlite` 等价复现支撑，最终以接入 003 后的 `cargo test --lib web_backend_schema` 为准。
- 未实施迁移、未跑完整门禁、未运行受控模型服务与 Pi 子进程端到端；`build-backend.mjs` runtime 复制为静态可行性核实（层界守卫与 bundleRoot 实测），未实跑打包。
- HTTP/会话/CSRF/静态供给复用沿用 W1 已准出行为，本轮未重测。
- 调度器多写者竞争、真实 WAL/文件级并发未测；`node:sqlite` 与 rusqlite(bundled SQLite 3.51.3) 在外键/隐式 DELETE 语义上一致，但最终以 Rust 侧实证为准。

## 八、证据索引（本机 `build/web-text-intake-contract-review/`，随评论附件交付精选）

- `raw/`：P1 全部 8 附件原文＋SHA-256 清单（`raw-hashes.txt`）。
- `scratch/blockers.mjs` + `raw/zcode-blockers-output.txt`：阻断 1（FK=ON DROP 失败、回滚重开、事务内 PRAGMA 无效）与阻断 2（N=2 UNIQUE 冲突、N=1 对照）实证。
- `scratch/extras.mjs` + `raw/zcode-extras-output.txt`：A'/B'/E' 独立复算、F4 rowid、F5 同事务双子表重建修复可行性（事件保留/sequence 连续/fk_check 空/signed_ai 可写）。
- `scratch/rowid-variant.mjs` + `raw/zcode-rowid-variant-output.txt`：rowid 重编号反例。
- `scratch/their-counterexample-adapted.mjs` + `raw/their-counterexample-rerun-output.txt`：附件反例复算（仅两条输入路径差异）。
- `raw/zcode-sqlite-master-output.txt`：重建后 sqlite_master 引号形态与索引名核实。
- 冻结件抽取与 runner/crate/守卫静态取证：`scratch/base-extract/`。
