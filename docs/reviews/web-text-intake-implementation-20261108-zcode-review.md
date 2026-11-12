# W1 文本整理 I 候选独审（ZCode，2026-11-08）：不通过

> 评审对象：候选 I `869126644974d60c35c91ac86083f91f0344e01a`（tree `11babc28a9764bfb9126393d2bc946133fb49719`，分支 `agent/claude/mayne-24`，4 提交：`7771c25`→`6262484`→`a0afea4`→`8691266`，恰 26 文件 +4385/−65）。评审人 ZCode，未参与 I/II/III，按派发 `01a1bb90`（2026-11-08）在独立树并行独审原 I 全部验收面。**总判：不通过（尚不具备集成准出条件）**——与队长同轮裁定独立一致，且除已知缺口外新发现 1 项阻断级与 7 项主要级缺陷（§4）。候选只读；本评审仅写本文件与 `build/web-text-intake-implementation-review/`（本机证据，不入库，精选随评论附件交付）。未重开 P1/P2/III，未跑完整重门禁。

## 1. 身份与范围核对（全部通过）

- 基点：分支起点 `e7bd56e` 的 tree `77a548591ac9b02a51936c806bf4f85d774df7cb`＝本地 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5` 的 tree（逐字节相同），`git merge-base`＝main 本身 ✓。准入登记 `admission.json`（评论附件，CLI 下载读回）在首次修改前写入（head=`e7bd56e`），其 11 项接收版本/SHA-256 与权威值**逐项程序化比对全部一致**（P1 契约 `5982c062…`、授权 `caa746bb…`、P2 `2d647417…`、R3 `47d5efaa…`、001/002/web-api/1、批准 003）✓。登记 pwd 为 `mayne-24-78c573437f91`，现分支工作树目录为 `mayne-24-a8c99c46d6c2`——物理树延续无法独立证实（OBS-1），但 4 个提交内容与登记写入清单逐一对应，内容链完整。
- 实际 diff 26 文件全部落在登记写入范围内，零越界；`scripts/checks/check-structure.mjs`、`package.json`、Cargo.toml/锁、`runtime/`、vendor、II 套件均未触碰 ✓。`003_text_intake.sql` SHA-256 复算＝`8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870`（批准值逐字节）✓。
- **结构守卫（全新树实测）**：`check:structure` 先因未备前置报 3 条 vendor/pi `ref.missing`（全新树基线态，与 III 登记一致）；按仓库命令补齐 `npm ci --ignore-scripts`→`probe:prepare-cli`（v1.0.98）→`probe:prepare-pi`→`probe:bundle` 后复跑：**exit 0（248 文件 538 引用零违规）**。候选自述的「172 条 top.dir/top.file 违规」在提交树中**不存在**——那是作者工作树未跟踪平台文件（`.claude/`、`.multica/`、`CLAUDE.md`）的本地现场，过滤后「I 文件零违规」的说法与我的实测一致，且提交树本身就是原样干净。III 冻结的 003 正例随候选落盘自动激活并通过 ✓。`check:docs` exit 0 ✓。

## 2. 独立复跑候选自述的聚焦验证（全部复现）

本机 `node v24.20.0 / npm 12.2.1 / rustc 1.89.0 / macOS arm64`，CARGO_TARGET_DIR 指向评审证据目录：

| 命令 | 候选自述 | 本次独立复跑 |
|---|---|---|
| `cargo fmt --check` | exit 0 | exit 0 ✓ |
| `cargo test --lib web_backend_schema -- --test-threads=1` | 23/23 | **23 passed / 0 failed** ✓ |
| `cargo test --lib web_backend_store -- --test-threads=1` | 15/15 | **15 passed / 0 failed** ✓ |
| `cargo clippy --all-targets -D warnings` | 干净 | 干净 ✓ |
| `node --test tests/unit/web-text-intake.test.mjs` | 7/7 | **7 pass / 0 fail** ✓ |
| `npm run typecheck` | exit 0 | exit 0 ✓ |
| `npm run build:backend` | 成功 | 成功，storage 二进制 2649888 字节＝自述值 ✓ |

Rust 边界逐条核对：`BUSINESS_TABLES` 恰为授权 15 表；`agentConcurrency` INSERT/CAS 两条模板与授权 SQL 逐字节一致；`application.timeZone` 两条原样；settings/schema_meta/sqlite_sequence 仍在白名单外；写目标真实 DML 解析未被放宽（含子表名不提权的既有负例通过）✓。schema 故障注入按授权移至第三迁移后、回滚到 v2 ✓。

既有回归复现：`node --test --test-timeout=20000 tests/integration/web-manual-items-http.test.mjs`＝**17 pass / 1 fail**，唯一失败即 `:81` 的 `A-9/schema`（`AssertionError: migration 002 must advance schema_meta to 2 … 3 !== 2`）——与候选/队长描述完全一致，属 003 授权的必然同步点（队长已给窄写入授权 2→3）。该文件其余 17 断言全绿。

## 3. 真实 Pi 协议/进程接线核对（静态＋实测）

`worker-host.mjs` 对 `runtime/entries/organizer-entry.mjs`（vendor 固定源）逐帧核对：请求行含 `runId/hostNonce/kind/snapshot/anchorAtMs/timeZone/apiKey/cwd/runLimitMs`＋extract 带 `source{rawText,timeZone}`／revise 带 `candidate.draft+instruction` ✓；输出帧带 `runId/hostNonce`（organizer-entry:37）与 host 端过滤匹配 ✓；stdin 第二行 cancel 帧（`{type:'cancel',runId,hostNonce}`）被运行时接受（:43-44）✓；`apiKey` 只进 stdin，argv 仅 `node organizer.mjs --run <runId>`，env 仅 PATH/TMPDIR ✓；worker 记录 `runs/<runId>/worker.json` 0600 含 pid/hostNonce/attemptId ✓。entry 缺省 `runtimeRoot`＝`../../runtime`，对 III 的 bundle 布局（`build/web-backend/runtime/`）解析正确（派发要求的核对项：**兼容，无缺陷**）；CLI `--runtime-root` 已接入同一解析链 ✓。运行时校验 `snapshot.provider/model` 与非空 `apiKey`（organizer-entry:63），缺失即 `RUNTIME_PROTOCOL`——该事实与 §4-①③ 两项缺陷直接相关。

## 4. 分级缺陷清单（候选只读，全部留给 I 修订）

**阻断（BLOCKER）**

- **B-1 extract 结果暂存必然失败，任务永久卡 `running`、槽位泄漏、候选永远不出现**（独立实证）：`text-intake-service.mjs:601-614` 以 `candidate.ordinal` 入库，但运行时 canonical extract 输出（`runtime/lib/organizer-contract.mjs:21,32`）的候选为 `{fields,evidence,dueExpression,followupExpression,warnings,unresolved}`，**没有 `ordinal` 字段**。隔离复现：claimNext 后调用 `stageExtractResult`→`WEB_BACKEND_SQL_ERROR: NOT NULL constraint failed: candidates.ordinal`。在线复现：假 runtime 按canonical 形状回结果帧→HTTP 提交→任务 `running` 超 20s 不终态、pending=0。原因是调度器 `launch()` 以 `.catch(() => {})` 吞掉 `onWorkerDone` 全部异常（task-scheduler.mjs:102），暂存失败既不上报也不释放槽。7 项单测直接 INSERT 候选行绕开了此路径；候选的 HTTP smoke 只到「提交/去重/列表」，从未等待任务完成。**核心用户路径（提交文本→候选出现）无法走通。**

**主要（MAJOR）**

- **M-1 运行中任务的取消帧永远不会发出**：`task-service.cancel` 先置 `state='cancelling'`，`http-server.taskCancel` 随后调 `scheduler.cancelRunning`，其守卫 `if (internal.state !== 'running') return false`（task-scheduler.mjs:146）必然为假——worker-host.cancel 无其他调用点。实测：取消后 3 秒 worker 进程仍存活、任务停在 `cancelling/exiting`，直至外部 SIGKILL 才经退出确认落到 `cancelled/cancelIntent=false`。运行中取消变成「等模型自然跑完（至多 120s）」，T-6 证伪项命中。
- **M-2 明文密钥可落盘**：`normalizeProvider/normalizeModel` 以 `...raw` 透传未知顶层字段，写守卫仅拒 `input.apiKeys` 顶层键。实测：`PUT /api/models` 的 provider 对象携带 `apiKey:'sk-…'` → 200 保存，`config/providers.json` **实含明文**（T-2 证伪项「明文落盘」命中；legacy 的 `reject_plain_secrets` 语义未移植）。
- **M-3 批量签收事务不校验逐操作 changes**：`signOff` 的大事务（text-intake-service.mjs:536）从不检查 `results[i].changes`；候选条件 UPDATE（`AND version=? AND status='pending'`）落空时整批照常提交——并发/重复候选签收会产出「候选仍 pending＋事项/关联/台账已建」的静默半 apply（§5.4「条件更新」契约未满足；重放读回会固化错误映射）。
- **M-4 幂等重放未实现**：`editCandidate/discardCandidate/applyPreview` 校验 operationId 非空后即弃（`void canonical` 死代码，text-intake-service.mjs:336-337），无任何台账——响应丢失重试同 opId 得 409 version_conflict 而非「重放先于守卫、返回当前权威对象」（冻结 §5.1 约定）。`requestRevision` 更把 `anchorAtMs: this.now()` 烘进规范输入：同 opId 重试必然 `idempotency_conflict`；前端 `asBackend` 又每次重生成 opId——修改预览的「响应未知按 ID 读回」在两端都断了（§10 反例「重复创建」）。
- **M-5 恢复面与冻结闭表不符**：恢复分类不写 `task_events`（§5.4 要求恢复扫描 INSERT）；`cancelling＋暂存 extract` 复用 `taskService.confirmExit` 而非 `confirmExtractExit`——staged 候选永远停在 `staged`（不可见不可签收），任务却已 succeeded（§6.1 步骤 5「发布为 pending」缺失）；cancelling 无暂存时无条件落 cancelled，未经副作用台账证明（工具开启的 Pi 运行存在外部副作用可能）；`side_effect_receipts`/`task_result_payloads` 全程零写入、`interrupted` 状态与 `auto_backoff` 预算递减未实现（`attempt_budget` 只写不用）→ §5.4 闭表与 §6.1.9 落空（失败一律 manual，方向保守但契约功能缺失）。
- **M-6 test 任务结构性失败**：`asBackend('test_model')` 提交 `{modelId}` 输入不含 snapshot，调度器也不在领取时构建 snapshot→运行时 `!snapshot.provider/model` 即 `RUNTIME_PROTOCOL`——「配置模型→连通性测试」（契约 §3 用户路径 1）必失败。无模型时提交同样以 `RUNTIME_PROTOCOL` 收场，而交付记录 §2.2 自述为 `credential_unavailable/model_not_configured`——与实际行为不符（未配置凭据、有 ref 的路径才走 `credential_unavailable`，该路径实测符合冻结场景 12 ✓）。
- **M-7 浏览器批量签收带日期候选即崩**：`asBackend('sign_candidates')` 先 `toWireInput(choices…fields)`（web-api-client.ts:755），`signOff` 内又对同一 fields 再做一次（:463）——二次转换遇到 `{at:ISO}` 无 `atMs`，`new Date(undefined).toISOString()` 抛 `RangeError: Invalid time value`（已用同源代码逐步实证）。凡含日期候选，签收在浏览器端、HTTP 之前即崩；单测的 `due:null` 样例掩盖了它。

**次要（MINOR，择要）**

- m-1 任务 wire 的 `result` 内嵌完整 payload 字符串，非冻结 §3.1 的 `payloadRef`（`result://` scheme）；大结果无分段读取收益。
- m-2 `preview_not_found` 为未登记新错误码（P1 §5.1 仅授权 `source_not_found`/`candidate_not_found`/`time_review_required` 三个）；`applyPreview` 不核对预览基准 `candidate_version`，旧预览可静默覆盖新编辑。
- m-3 `GET …/candidates?status=` 无白名单（实测 `status=staged`/`not-a-status` 都 200 返回）——staged 不可见仅靠默认查询形状，服务层未强制（签收侧已强制 ✓）。
- m-4 `resolve()` 无条件 SQL 守卫（条目版本仅前读），并发 resolve 双写双计 version；`confirmExit` 各 UPDATE 亦无状态条件（单写者假设，但 HTTP 侧可并发进入）。
- m-5 `submit_seq=MAX+1` 在事务外计算（冻结 §8 `submit_seq UNIQUE`）→ 并发提交 500 `internal_error`；同型地，同指纹并发提交实测 `200,500`（应为 UNIQUE 归并到既有行，§5.1 明文）。
- m-6 `stageResult(taskId,attemptId,epoch,…)` 收下 epoch 但从不校验——attemptId＋epoch 的 fencing 只剩内存闭包身份，DB 层未闭环。
- m-7 前端：SSE `task.changed/candidate.changed` 订阅后只触发 `todos.refresh()`（PairingGate.vue:13），organizer/队列状态从不因提示刷新；`TaskQueue.vue` 未交付，`active_model_run` 只跟踪单个活动任务（队列位置/逐任务取消入口缺失）；`todo_source_links` 返回 `[]`，T-11 的来源回溯 UI 缺位；`fromWireItem.source` 恒映射 `'manual'`（注释仍写 002 冻结，已过时）。
- m-8 `invalid_model_config/invalid_agent_config/model_not_configured→500`（客户端可修形态映射为服务端错误，注册表归类存疑）；失败结局带 `offset/limit` 与分段参数非法均抛 `validation_failed` 而非冻结 §4.3 的 `result_range_invalid`；`/api/agents/{tracker,advisor}` 可读写（切片声明只接 organizer）；`config-store.credentialStatusFor` 直接读 `process.env` 存在性（config-store.mjs:235，需与 EnvironmentCredentialProvider 的删除一并裁定边界）；provider 保存强制要求凭据引用，无法表达「已建未配钥」状态。

**已知缺口确认（派发单所列，逐项核实）**

- K-1 `inst_legacy` 占位 epoch：task-service.mjs 6 处（:291,360,372,403,433,447）全部 task_events 用 `inst_legacy`，而 attempt/恢复用 `sse.epoch`——同一实例双 epoch 并存，持久事件流无法按实例对账（未闭合）。
- K-2 `/api/snapshot` 高水位 0 占位：实测 `highWatermark:0`、`lastEventId="<epoch>:0"`（另：tasks 取 limit 200 截断，「全量快照」名不符实）。
- K-3 SSE cursor 为实例内内存计数，无 task_events 重放/`stream.reset` 后的高水位一致性机制（§6.3 未闭合）。
- K-4 `EnvironmentCredentialProvider`（credential-provider.mjs:57-70）真实读 `process.env`＋工厂 `mode==='environment'` 分支（:79）：超出本轮授权的生产环境解析通道存在于生产源码（默认装配为空 controlled，无默认泄漏，但按派发必须删除）。
- K-5 未用打包 runtime 跑通真实 extract/revise/test；预览/混合批量签收/取消/恢复/原样无 Tauri UI 的原 I 聚焦证据全部缺失（交付记录 §5 自认；候选 smoke 只覆盖提交/去重/列表/配置读，未等待任何任务完成）。
- K-6 II 矩阵 T-1…T-14 未逐项证伪（套件属 II，未到位）；完整 `npm run check` 未跑（按派发留 III）。

## 5. 实测为「通过」的面（避免误伤）

- 身份/准入/接收哈希/写入范围/003 字节/Rust 边界：全部精确 ✓（§1-§2）。
- 会话/CSRF/Origin 边界实测：未配对 401 `unauthenticated`、无 CSRF 403 `csrf_invalid`、跨源 403 `origin_rejected`、配对后写 200 ✓；`/api/providers` 只出引用与状态、`credential_unavailable` 失败路径符合冻结场景 12（202 提交→failed manual、不 spawn worker、原文保留）✓。
- 恢复机制主干实测：SIGKILL 后端→同根重启→旧 running attempt 被分类 `needs_review/exited_confirmed`＋`recovery_items` 行＋`restart_unknown_side_effect`（冻结已枚举 cause）＋`decisionOptions:["resume","cancel"]` ✓；「无法核实→暂停调度」分支为代码审读确认（实测环境的 worker 随宿主 stdin EOF 自退，与真实 Pi 的 watchHost 行为一致，未能在本机构造存活跨重启的 worker）。
- runtime 布局缺失时以 `runtime_start`/manual/`sideEffectSafety:unknown` 类型化失败，后端不崩 ✓（比代码读感更好）。
- 前端接线真实存在：organizer/models/agents/pairing 切到 `getWebApiClient().asBackend()`，浏览器模式解除 intake/inbox 禁用，advisor/今日建议/技能仍准确不可用；`npm run typecheck` exit 0 ✓。

## 6. 结论与待关闭清单

**结论：不通过。** 数据层与守卫边界、会话安全边界、身份与范围纪律、既有回归兼容（除已知 schemaVersion 同步点）均达到可审标准；但 §4-B-1 使核心纵向路径无法走通，M-1/M-7 使取消与签收两个核心交互在真实使用中失效或崩溃，M-2 违反密钥红线，M-3~M-6 使幂等/恢复/连通性测试与冻结语义不符，K-1~K-4 为派发明列的未闭合项。上述任何一项未关闭前，不具备进入唯一集成（III 串行全门禁）的条件。

**待关闭清单（按优先级，全部属原 I 写入范围；复核仅对修订增量）**：

1. B-1：`stageExtractResult` 以运行时 canonical 形状取序号（index+1 或契约定义），调度器不得吞 `onWorkerDone` 异常——暂存/确认失败必须类型化落库并释放或转 needs_review；补「真实 canonical 形状→staged→确认发布」直达测试。
2. M-1：取消帧发送路径改为按 attempt/句柄定位（不依赖 running 状态守卫），补「取消→worker stdin 收到 cancel 帧→进程退出→cancelled」实测。
3. M-2：normalize 层剥离 provider/model 未知字段并拒绝任何形如密钥的字段（对齐 legacy `reject_plain_secrets`），补「provider 携带 apiKey → 拒绝/剥离」负例。
4. M-3：批量签收逐操作校验 `changes`，任一落空即整批回滚为 409；补并发竞争负例。
5. M-4：edit/discard/applyPreview/revisions 落实 opId 台账与「重放先于守卫」；`requestRevision` 规范输入去抖 anchorAtMs（或由服务端固定锚）。
6. M-5：恢复分类补 task_events、cancelling×staged 走 `confirmExtractExit` 发布/删除候选、cancelling 无台账不直接 cancelled；登记 side_effect_receipts/task_result_payloads 的落点或在本切片契约内显式声明不用（交队长裁定）；auto_backoff 或显式放弃声明。
7. M-6：test 任务在提交/领取时构建 snapshot；无模型任务给出配置类失败码而非 RUNTIME_PROTOCOL；修正交付记录中与实际行为不符的自述。
8. M-7：去除 asBackend sign_candidates 的重复 toWireInput；补「带日期候选批量签收 200」回归。
9. m-1~m-8 与 K-1~K-4 按派发既有清单闭合（task_events 统一实例 epoch、SSE 重放/高水位、删除 EnvironmentCredentialProvider 及 environment 工厂分支——含 config-store 的 process.env 读取一并裁定）。
10. 按窄授权把 `tests/integration/web-manual-items-http.test.mjs:81` 断言 2→3，复跑该文件纳入修订证据；结构检查保留原始失败与元数据分类，不以过滤结果代原样。
11. 补齐原 I 聚焦证据：本树显式 binary/dist/runtimeRoot 上真实 Pi＋受控服务跑通 extract/revise/test、预览/混合批量签收、取消/恢复、原样无 Tauri UI 全旅程（浏览器真实旅程仍归独立验证者，不在 I 自签范围）。

本评审未重开 P1/P2/III 结论；未跑完整 `npm run check`；未调用真实模型/凭据/用户根。所有反例与数字可按 `build/web-text-intake-implementation-review/verification-log.txt` 的命令清单复跑。MAYNE-24 保持 in_progress。

## 8. 限定复核 R2（2026-11-08，修订 `8691266..b057f0e`）：部分修订，仍不通过

> 复核对象：修订 `b057f0e28708abfcadf6c3b092bc86262959ef60`（tree `8dcc229d561104d5fc77cf8695ebb997510ef2c5`，3 提交 `1593b43`→`2022d1c`→`b057f0e`，恰 13 文件 +415/−139），按派发 `01a1bbe0`（2026-11-08）限定复核增量与受影响旧缺陷。候选只读；本轮只写本文件与 `build/web-text-intake-implementation-review/r2/`（本机证据）。Rust（schema/store/003/守卫）零改动，§1–§3 原审结论原样复用；仅聚焦验证，未跑完整门禁。

### 8.1 身份与范围（通过）

- `git diff 8691266..b057f0e` 与作者附件 `candidate-revision.patch` 逐字节相同；13 文件 SHA-256 与作者 SHA256SUMS 程序化比对 **13/13 一致**；全部落在原 I 写入清单内，Rust/003/package.json/守卫/vendor 零触碰。
- 窄授权项 A-9（`tests/integration/web-manual-items-http.test.mjs`）恰为该一处断言 2→3 的 hunk＋注释；本机复跑该套件 **18/18**（R1 的 17/18 红灯消除）。
- 本机复现：单测 **7/7**；`vue-tsc` typecheck exit 0（候选树 `npm ci --ignore-scripts` 后本树安装）；storage 二进制同法构建 exit 0（2649888 字节；构建绝对路径不同致哈希异于 W1 登记值，Rust 源码 git 身份未变，非缺陷）。s0-runtime 前置以只读复用 W1 登记闭包（provenance `e89822b0`）满足。

### 8.2 逐项关闭依据（§6 清单）

| 项 | 判定 | 依据（全部独立实证，非采信自述） |
|---|---|---|
| 1 B-1 | **关闭** | 真实调度器＋canonical 无 ordinal 输出→succeeded/exited_confirmed→候选 pending ordinal 1,2（H5/S1）；暂存失败（缺标题）→validation_failed→markNeedsReview→needs_review/exited_confirmed＋事件落库＋runningCount 1→0 槽释放（S2）；无结果死亡→failed 槽释放（S2b） |
| 2 M-1 | **关闭** | running 取消→202 cancelling→worker stdin 日志实收 `{"type":"cancel",runId,hostNonce}` 帧→进程退出→`cancelled`、cancelIntent=false、runningCount=0（H4）；`cancelRunning` 改按活动句柄定位，无 running 守卫（代码） |
| 3 M-2 | **关闭** | provider 携带 `apiKey`→422 `plain_credential`；`config/` 目录全文 grep 明文零命中；干净引用 200；`credentialStatusFor` 仅走注入 provider；`EnvironmentCredentialProvider`＋environment 工厂分支删除（grep 0 命中，K-4 同时闭合） |
| 4 M-3 | **未关闭（声明不实）** | 见 §8.3-1：changes 校验在事务提交之后，无任何回滚；「整批回滚」证伪 |
| 5 M-4 | 部分（如实声明） | requestRevision canonical 无 `anchorAtMs`（S4，重放稳定）；signOff 重放读当前权威对象（S3）；edit/discard/applyPreview 持久台账仍缺：同 opId 重试 edit→409 非 replay（S4 实测）；前端 `asBackend` 仍每次 `newOperationId()`，浏览器响应丢失重试不会命中重放；台账最小差异已交裁定 |
| 6 M-5 | 部分（两项子声明不实） | 活动路径 cancelling×staged→confirmExtractExit 发布 ✓（代码核对）；**恢复路径未修**：task-recovery.mjs 零改动，cancelling＋resultPendingExit=1 仍走 taskService.confirmExit→X2 复现「任务 succeeded、staged 候选永久停留 staged（不可见不可签收）」；「恢复分类补 task_events」不实（task-recovery 零 insertEvent，契约 §5.4 写面要求恢复扫描 INSERT task_events）；receipts/payloads 零写入＝如实声明的裁定项 |
| 7 M-6 | **关闭** | 有模型：202→succeeded＋worker 实启（H2）；无模型：202→failed `auth_or_config_invalid`、不 spawn（X1），双向实证 |
| 8 M-7 | 关闭（静态面） | asBackend 重复 toWireInput 删除；normalizeDraftFields 双形接受 atMs/at（S3/S4 服务层带日期候选全通过）；typecheck 0；浏览器真实旅程归独立验证 |
| 9 其余 | 见左 | m-2 关闭（candidate_not_found＋state_conflict 版本核对）；m-3 关闭（status 四态白名单）；m-5 关闭（submit_seq 事务内派生）；K-1 关闭（inst_legacy 0 命中，统一实例 epoch）；K-2 关闭（快照真实高水位；tasks limit 200 截断仍在）；K-3 机制关闭、事件完整性出**新缺陷 R2-M-a**；m-1/m-4/m-6/m-7/m-8 未修＝如实声明 |

### 8.3 派发焦点实证

1. **批次 changes 是否提交前保证整批回滚——否**。`signOff` 的 changes 校验在 `transact` 返回**之后**执行（text-intake-service.mjs 的 `candidateUpdateIndices` 循环），事务此时已 COMMIT，库内不存在任何回滚机制。并发双客户端同键签收实测（S3，真实 Rust 存储事务）：败者收 409 `version_conflict`，但库内已固化 **4 条 manual_items（两两重复）＋4 条 manual_item_sources＋两行 `succeeded` 台账（含被 409 的批次）**；以被拒批次同 opId 重放返回 `replayed:true`＋两份重复事项——静默半 apply（R1 形态）变为「409 后固化半 apply」，冻结 §5.4 条件更新整批语义仍未满足，交付记录 §7「整批回滚 409」的声明被证伪。
2. **错误路径退出核实与占槽——已闭**：暂存失败经 markNeedsReview 类型化落库＋事件＋槽释放（runningCount 1→0）；worker 无结果死亡→failed 释放槽；取消→cancel 帧实达→退出→cancelled→槽释放。残余（不阻断）：markNeedsReview 自身失败仍被 `.catch(()=>{})` 吞（单点）；错误路径不清 `scheduler.active` 内存句柄（槽按 attempt_exit_state 计数，无 DB 槽泄漏，仅句柄残留）。
3. **SSE/快照一致性——机制闭合，事件流不完整（新主要 R2-M-a）**：统一 epoch、真实高水位、有界重放缓冲、stream.reset（外 epoch→`epoch_changed` 实测）均成立；但全生命周期 task_events dump 显示**仅含 queued（取消任务另含 cancelling）**——claim（契约 §6.1-2 明文要求同事务写 task_events）、暂存（§6.1-4）、终态（§6.1-5）均零事件；终态 SSE 帧复用该任务已有最大游标（实测 succeeded 帧与 queued 事件同游标）；带 Last-Event-ID=高水位重连实测**重放为空**——断线客户端永久丢失终态迁移，仅靠 `/api/snapshot` 全量读回兜底。快照/重连的状态最终一致成立，事件流的持久性与可重放性未达成。
4. **真实 Pi 证据范围**：附件 `e2e-results.json` 实为**真实 Pi runtime organizer＋受控模型服务**（33 次模型请求全部 `/v1/chat/completions` 的 controlled-model；真实模型未授权未调用，符合工单边界），覆盖 extract 5 候选/edit/revise+preview+apply/test/混合批次（2 signed_ai＋1 manual 关联）/cancel/SIGKILL 重启保留/epoch_changed reset；worker 记录含 runId/pid/hostNonce。该文件为多次开发循环累计（33 请求 vs 终态 4 条 worker 记录），终值内部自洽但非单次干净运行轨迹。**UI 证据仅 index/script 200＋Tauri 桥缺失的静态取回**——按派发只签静态供给，不签真实浏览器动作。我的独立复验（真实 entry＋真实 Rust 存储＋GAP-3 私有进程工厂假 worker）覆盖调度/取消/SSE 机制面；真实 Pi runtime 链路未在本机重跑。

### 8.4 新发现

- **R2-M-a（主要）**：如 §8.3-3——运行态/终态 task_events 缺失＋终态帧游标复用，违反契约 §6.1-2/§5.4 写面与 web-api/1 §6 帧 id 可重放语义；断线重连丢终态迁移。
- **R2-OBS-1（次要）**：worker-host 新增 `WORKER_DEBUG` 环境开关输出 worker 帧到 stderr——不在本轮冻结 GAP-3–5 私有配置清单（HTTP/CLI/env 均不入口的裁定面）；默认关闭无泄漏，启用时帧内可能含用户文本，须守日志脱敏红线。
- **R2-OBS-2（次要）**：§8.3-2 的两条残余（吞异常单点、内存句柄残留）。

### 8.5 结论

**维持不通过（尚不具备集成准出条件）；按队长口径，`b057f0e` 作为部分修订接收。** 经我独立复现实闭：B-1、M-1、M-2＋K-4、M-6、M-7（静态面）、A-9（窄授权合规）、m-2/m-3/m-5、K-1、K-2、K-3 机制、GAP-2/3–5 私有对接。仍开放：**M-3（回滚声明证伪，见 §8.3-1）**、**M-5 恢复路径两子项（X2 复现＋声明不实）**、**R2-M-a（新）**、M-4 候选操作台账（待存储裁定）、m-1/m-4/m-6/m-7/m-8、side_effect_receipts/task_result_payloads（待裁定）、快照 tasks limit 200 截断、真实浏览器动作旅程（归独立验证者）、完整门禁（归唯一集成执行者）。原始证据：`build/web-text-intake-implementation-review/r2/`（三份验证日志＋可复跑脚本＋SHA-256 清单），精选随评论附件交付。本轮未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 9. 第三轮限定复核（2026-11-09，R3）：`b057f0e..738414b`

> 派发 `01a1bc32`（2026-11-08）：限定审修订 `8691266..b057f0e` 复核之后的新增增量 `b057f0e..738414b` 四焦点——结果字节/引用读取、并发与 fencing、退出核实、UI 原始证据；未改已过面沿用 §1–§8 结论；`$blob` 方案已要求撤回，记待关闭即可，不为将撤回的 codec 重跑完整矩阵；沿既定 I 评审文档/build 范围交明确结论，后续只复核替代增量。评审对象：`738414b50d328e2ce20a0451a6aebc747cab9808`（tree `9dfc61b9575f25e60360fdf7152f6f84cbfa45c7`，parent＝`b057f0e`，恰 6 文件 +244/−38）。**总判：维持不通过，按派发作为部分修订接收**——四焦点中三项机制实质闭合，新发现 2 项主要（R3-M-1 分段索引信封缺失、R3-M-2 m-4 守卫声明面过宽）与 2 项次要（R3-OBS-3 记录请求计数与证据不符、R3-OBS-4 场景 32/33 读路径无生产写入者），整树退出核实仍开放（队长已另指令）。

### 9.1 身份与范围（通过）

- commit/tree 哈希与派发逐字节一致；parent=`b057f0e`（§8 评审对象）✓。6 文件 SHA-256 与作者 `SHA256SUMS.txt` 程序化比对 **6/6 一致**；`git diff b057f0e..738414b` 与作者附件 `candidate-revision.patch` **逐字节相同**；`git diff --check` 干净 ✓。全部落在原 I 写入清单（server/lib×3、src-tauri store×1、tests/unit×1、交付记录×1）；003 迁移、SCHEMA_VERSION、BUSINESS_TABLES、守卫脚本、Runtime、vendor 零触碰（文件清单即证）；003 哈希复算 `8e4e3159…7870` 不变 ✓。Rust 变更仅 `web_backend_store.rs` 的 `json_value` 参数适配＋手写 base64 解码器（见 §9.6）。
- **作者声明数字全部复现**（标准前置链 `probe:prepare-cli`＋`probe:prepare-pi`（provenance tree `e89822b0` 与 III 冻结值一致）＋`probe:bundle`＋`build:backend` 后）：`cargo fmt --check` exit 0；clippy `--all-targets -D warnings` 干净；`web_backend_schema` **23/23**；`web_backend_store` **15/15**；单测 **9/9**（7＋本轮新增 2）；`test:web-manual-items` **59/59**；`npm run typecheck` exit 0 ✓。

### 9.2 焦点一：结果字节/引用读取——机制闭合＋R3-M-1

- **实闭（P1 探针，真实 Rust 存储）**：`stageResult` 在暂存事务内写真实字节（JSON.stringify→UTF-8），`total_bytes`＝真实字节长，BLOB 逐字节读回与写入一致（含中文/emoji）；`result_ref` 冻结 `result://<attemptId>/result` 在 stageResult/stageExtractResult/stageReviseResult 三路径均落库，读回经 `resolvePayloadRef`→`readResultPayload`；读不到引用/字节→`result_not_found`；分段路径五组非法 offset/limit 全部 `result_range_invalid`、越界 `result_range_unsatisfiable`；终态 failed 读取→409 `state_conflict`（场景 18）✓；>64KiB 分段循环拼接**逐字节一致，含跨越 16KiB 段边界的 3 字节汉字**（二进制安全成立）；nextOffset/done 数学正确（P1.2）。
- **R3-M-1（主要）：冻结 §4.3 的分段索引信封从未实现**。>64KiB 结果无 offset/limit 读取时，契约要求返回**索引响应** `{inline:false, payload:null, payloadRef, nextOffset:0, done:false, maxInlineBytes, maxSegmentBytes, kind, acceptedByAttempt, completedAt}`；实测返回的是**首段响应** `{outcome, offset:0, limit:16384, bytesReturned, totalBytes, nextOffset:16384, done:false, payloadBase64}`——缺 `inline/payload/payloadRef/maxInlineBytes/maxSegmentBytes/kind/acceptedByAttempt/completedAt` 八字段（P1.2 实测键清单），HTTP 层 `sendJson` 原样透传。§4.3 客户端以 `inline:false` 识别分段模式，该响应无 `inline` 字段、`nextOffset≠0`——契约客户端无法按冻结形状分类此响应。59/59 套件无 >64KiB 分段用例（grep 证），故全绿不覆盖此面。字节面本身正确，属协议形状缺口。
- 附带（OBS 级）：内联结果的非法 offset/limit 被静默忽略（契约对内联携带范围参数未明定，不判违）。

### 9.3 焦点二：并发与 fencing——task-service 面闭合＋R3-M-2

- **实闭（P2 探针全过）**：`resolve` 两条 UPDATE 条件于 `state='needs_review'`＋`changes!==1`→`state_conflict`（P2.1）；running 任务 resolve cancel/resume 双拒；`resolve` 于 `exited_unknown`→`exit_unconfirmed`（保守占槽语义闭环）；`confirmExit` 四条转移全部条件于 `state IN ('running','cancelling')`：终态重驱→null、needs_review 重驱→null 且状态零变化（P2.3）；槽位语义：concurrency=1 下 `exited_unknown` 占槽、`exited_confirmed` 释放（P2.2 三步实测）；m-6 fencing：陈旧 epoch `stageResult`→false 且零写入（无任务位、无 payload 行，P1.4）。
- **R3-M-2（主要）：m-4 声明面过宽——extract/revise 出口确认无状态守卫，实测可翻转 needs_review**。交付记录 §8.1「confirmExit 全部转移条件于 state IN ('running','cancelling')」仅对 `task-service.confirmExit` 成立；`text-intake-service.confirmExtractExit/confirmReviseExit`（生产主路径）的全部 UPDATE 仍无状态守卫。P2.4 实证：extract 任务经 `confirmExtractExit(exited:false)`→needs_review/exited_unknown 后，同一 attemptId 再调 `confirmExtractExit(exited:true)` 直接提交 `succeeded`＋`exited_confirmed`（终态＋槽释放，退出核实未发生）——同一输入走 `taskService.confirmExit` 则被守卫拒绝（null）。声明与代码不符，与 §8.3-1（M-3 声明证伪）同族；需实现侧补齐两函数守卫或由队长将声明收窄为「task-service.confirmExit 四转移」。
- 次要（并入既有项）：`markNeedsReview` exited=true 分支仍无状态守卫（现调用点唯一，残余归 §8 R2-OBS-2）；stageResult epoch fence 在事务外核对（TOCTOU 窄窗），extract/revise 暂存无 epoch 参数（m-6 声明字面仅覆盖 stageResult，`currentAttempt` 核对覆盖大部分陈旧面）；`persistResultPayload` 无调用者（死代码）；markNeedsReview 无操作转移仍写 `task.changed` 事件（版本噪声）。

### 9.4 焦点三：退出核实——机制分叉闭合；整树核实未实现（开放，归实现侧）

- **实闭**：`markNeedsReview {exited}` 双分支＋作者两条新单测（未核实→`exited_unknown` 保持占槽；核实→`exited_confirmed` 释放）与 P2.2 槽位实测一致；调度器仅在 `handle.done` 解析后传 `exited:true`（`task-scheduler.mjs` 代码与注释核对），无 spawn 失败路径（无模型/无凭据）的 `exited:true` 语义平凡成立（沿 R2 M-6 双向实证）。
- **未闭（派发与队长 `01a1bc3a` 均已明示，不在本轮 6 文件内）**：`handle.done`＝child `exit` 事件＝**单进程**观察；spawn 为 `detached:true` 而退出/终止路径仅 kill 直连 PID，无进程组核实——managed-bash/MCP 孙进程的树退出未验证；`worker-host.confirmExit` 对缺失条目返回 `{exited:true}`（P5.3 实证：未核实即假设）。`worker-host.mjs:131` 只比较 runId 不校验 hostNonce、`:132` `WORKER_DEBUG` 将已通过栅栏的原始帧 JSON（含结果 payload 用户文本）写后端 stderr——P5.1/P5.2 独立复现（错 runId 帧被弃、无泄漏；对 runId 帧全文落 stderr）。四项均为 Claude 待修项，本审确认开放、不计入本轮增量判定。

### 9.5 焦点四：UI 原始证据——证据为真、范围如实、记录数字不实

- `ui-journey.png`（116118 字节）为**真实产品 DOM 渲染**：待确认面板＋计数徽章、展开候选卡（事项标题/类型/负责人/优先级/签收方式）、来源批次下拉、原文依据锚点（2026-11-09 01:21，与交付时间自洽）、底部签收操作——非静态取回，可签署「文本提交→候选出现」段旅程。`ui-journey-results.json`：五步（paired→workbench-mounted→text-intake-open→submitted→candidates-visible）全过、同源 37、跨源 0。
- **R3-OBS-3（次要）：记录数字与自附证据不符**。交付记录 §8.1 与交付评论均写「43 个同源请求」，而证据文件与 verification.log 均为 **37**——须更正记录（非旅程造假：工件本身自洽）。另 `candidateCards:32` 与截图「已选 4/4」并存，DOM 计数口径未知，不判不实、记录宜注明口径。旅程脚本未随候选提交（不在 6 文件），证据只能审计工件、不可从候选树复跑——随下轮增量补交脚本即可闭合。
- 范围边界（派发已明示，作者亦如实声明）：本轮 UI 证据止于候选出现，不覆盖代签预览、混合批量签收、队列与重启 UI 验收。

### 9.6 `$blob` 处置（按派发记待关闭）

`{"$blob":"<base64>"}` 参数形＋Rust 侧内联解码器为未登记的参数协议扩展（`json_value` 白名单四类→五类）；队长已指令下轮以现有字符串参数＋`CAST(? AS BLOB)` 等价替换并撤回该协议与手写解码器（附带消除 decode_base64 接受非规范尾位的宽松解码）。本审不为将撤回的 codec 重跑完整矩阵；§9.2 全部字节结论以「真实字节 JSON.stringify→UTF-8 落库、读回逐字节一致」为准，不依赖 `$blob` 具体编码。codec 替换增量到达时按同一矩阵复核。

### 9.7 结论

**维持不通过（尚不具备集成准出条件）；`738414b` 按派发作为部分修订接收。** 聚焦判定：结果字节/引用读取＝机制闭合＋R3-M-1（分段索引信封）；并发与 fencing＝task-service 面闭合＋R3-M-2（extract/revise 出口确认无守卫、声明面过宽）；退出核实＝机制闭合、整树核实开放（归实现侧待修，非本轮 6 文件）；UI＝证据为真、范围如实、R3-OBS-3 数字更正。下一增量待闭清单：① 撤回 `$blob`（已指令）；② R3-M-1；③ R3-M-2（补守卫或声明收窄裁定）；④ 整树退出核实＋worker-host :131/:132（已指令）；⑤ 记录 43→37 更正＋旅程脚本随候选提交。§1–§8 未改面结论原样沿用：M-3、M-5 恢复两子项、R2-M-a、M-4 台账（裁定中）、m-1/m-4/m-6/m-7/m-8、快照 tasks limit 200、完整门禁均不受本轮影响。原始证据：`build/web-text-intake-implementation-review/r3/`（三份探针脚本＋日志＋作者附件读回＋SHA-256 清单），精选随评论附件交付。未跑完整门禁（派发限定）；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 10. R4 增量复核（2026-11-09）：`738414b..05c66fd`（ZCode，派发 01a1bc49）

### 10.1 身份、范围与作者数字

- 候选 `05c66fd2f42a3e97df1f8be00d591dc47a405109`（tree `c8a5bb500285641e8f05b7851389b8e7a81f09c1`，父 `738414b50d328e2ce20a0451a6aebc747cab9808`），恰 **10 文件 +353/−74**，全部在原 I 写入清单；`git diff` 与作者 `candidate-revision.patch` **逐字节相同**；10 文件 SHA-256 与作者 SHA256SUMS 程序化比对 **10/10 一致**；交付记录附件 SHA `c4ba4218…` 与清单一致（附件 6/6 CLI 读回）。
- 冻结面零触碰：003 `8e4e3159…7870` 复算不变、001 `8511907c…` 不变、`BUSINESS_TABLES` 仍 15 表、migrations/`vendor/`/`resources/`/`scripts/checks`/守卫/package.json 零差异。
- **作者声明数字全部复现**（标准前置链 `probe:prepare-cli`（lark-cli 1.0.98）＋`probe:prepare-pi`（provenance tree `e89822b0` 与 III 冻结一致）＋`probe:bundle`＋`build:backend` 后）：fmt 0；`web_backend_schema` 23/23；`web_backend_store` **16/16**（＋提交前断言 1 条）；clippy `--all-targets -D warnings` 干净；单测 **11/11**（＋批次竞争、并发同 ID 归并 2 条）；`test:web-manual-items` **59/59**；typecheck 0。

### 10.2 焦点一：`transact` 提交前断言与非法形状——**闭合**

以生产 `web-backend-storage` 二进制＋真实 001–003 迁移实测：① 先写后条件失配→`WEB_BACKEND_CONDITION_FAILED`，**先前写入零残留**（标题/版本原样，COMMIT 前整笔回滚实证）；② 非法形状 `null`/`-1`/`1.5`/`"1"`/`true` 五类全拒 `WEB_BACKEND_INVALID_PARAMS` 且零写入（`deserialize_some` 使显式 null 不再等价"无断言"；作者 Rust 测试覆盖前四类，本审加测 bool）；③ 省略保持原行为（0 命中 UPDATE 照常提交）；④ 命中断言正常提交。服务层映射符合队长 `01a1bc3e` 接口冻结：task-service 与 text-intake 的 `transact` 包装把 `WEB_BACKEND_CONDITION_FAILED` 映射既有 `version_conflict`，未新增公开 HTTP 错误/读写目标/设置模板；`signOff` 候选与关联目标 UPDATE 均带 `expectChanges:1`，**提交后 throw 冒充回滚的实现已删除**（`candidateUpdateIndices` 一并移除）。一处 nit：断言取 `tx.changes()`（最近一条语句计数），SELECT op 后跟 `expectChanges` 会读到陈旧值——服务层仅在 UPDATE 上使用，不构成缺陷。

### 10.3 焦点二：两类并发签收/重放与全表回滚——**闭合**

- **跨批次抢同候选**（服务层实测，与作者单测互证）：先签批次成功 2 事项；后签批次含已接受候选→`version_conflict`（或预检 `state_conflict`，两守卫皆合法），库内 **0 事项/0 台账/0 关联残留**——M-3 的"409 后固化半 apply"根因已消除。
- **同 operationId 并发归并**：`Promise.all` 双发同键同输入→一 `replayed:false`（2 事项）、一 `replayed:true` 且 **items 非空并等于胜者权威事项**（归并路径从台账 `result_json` 重读映射，非本调用局部映射——逐行核读确认）；库内恰 2 事项/1 台账/2 关联。同键异体→`idempotency_conflict`。**重放先于守卫**保持（台账检查在逐候选守卫之前，冻结 §5.1）。作者单测未断言重放 items 内容，本审独立补证。

### 10.4 焦点三：CAST 字节读写——**闭合（$blob 撤回完整）**

`$blob` 分支与手写 base64 解码器已删（树内 `git grep '$blob'` 仅剩交付记录历史表述，零代码残留；`json_value` 白名单复原四类）。四处 payload 写入（task-service `persistResultPayload`/`stageResult`＋text-intake extract/revise）均改既有字符串参数＋`CAST(? AS BLOB)`；JSON.stringify→UTF-8 恒为合法 UTF-8，字符串参数无损。生产二进制实测：库内 `typeof=blob`、`total_bytes=length()=JS 字节数`（35）、含中文/emoji 读回**逐字节一致**。R2/R3 全部字节结论在新 codec 下原样成立。nit 沿用：`persistResultPayload` 仍无调用者（死代码）。

### 10.5 焦点四：帧 fencing 与调试路径删除——**闭合**

`worker-host` 帧门同时校验 `runId`＋`hostNonce`，真实管线实测：合法 runId＋伪造 hostNonce 的结果帧被丢弃，done 仅由正确帧解出（`payload.forged:false`）。`WORKER_DEBUG` 全树零命中（stderr 原始帧落盘路径已删）。R2-OBS-2/P5.1/P5.2 在本增量的对应面关闭。

### 10.6 焦点五：进程树退出核实——**新主要 R4-M-1：pgid 组空被等同整树退出**

- `verifyTree` 仅做 `process.kill(-pgid,0)` 组空检查。**II 反例实证（两层）**：worker spawn detached 孙进程（孙进程自成新组）后正常退出——① 导出函数层：父已退、孙存活（`kill(-孙pid,0)` 成功）、`verifyTree({pgid:父pid})` 返回 **true**；② 完整 `WorkerHost.start` 管线层（默认 spawn、真实 record `pgid=child.pid`、真实帧门）：`done` 解出 `{outcome:'succeeded', treeVerified:true}` **而孙进程仍存活**；按 `task-scheduler.mjs` 现行映射，`treeVerified !== false` 即走暂存＋`confirmExit({exited:true})` → **终态提交＋槽释放，外部进程未退**。交付记录 §9.1「核实整树」声明被证伪（过宽），与 M-3/R3-M-2 同属"声明超出实现"族。同组孙进程幸存→诚实 `false`（unknown 占槽）；全退正控→`true` 正确：组检查对**组内**成员有效，对组外后代失效。
- 路径一致性：正常退出/暂存失败（catch 路 `{exited:false}` 保守占槽——相对 R2 已闭的"暂存失败释放槽"是按队长 `01a1bc3a` 指令的语义更替，记录为更替非回归）、取消（仅 SIGKILL 直连 PID；组内幸存→诚实 unknown；组外→同一假阳性）、`stopAll`（SIGTERM 直连、**无任何核实**）、恢复（`task-recovery.mjs` 未改，沿队长口径不得以文字关闭）。全部路径**无一处组终止**（`kill(-pgid,信号)`），组内幸存者诚实占槽但无人回收。`worker-host.confirmExit` 缺失条目仍返回 `{exited:true}`（P5.3 未改）。

### 10.7 焦点六：`GET /api/manual-items/{id}/sources` vs 登记契约（01a1bc49）——**形状不采用，登记差异实证**

真实 HttpServer（entry 同构接线）四态实测：401 未认证（`unauthenticated` 信封）；存在且无来源→200 空数组；已关联→200 `{contractVersion,sources:[{sourceId,evidence,association:'new',excerpt}]}`，excerpt=raw_text 截 200 字、无 SQL/本机路径/秘密。**与登记契约三处不符（队长已裁定"不采用"，本轮实证归档）**：① 事项不存在→**200 空数组**而非 404 `item_not_found`；② 缺 `candidateId` 字段；③ 时间为 numeric `createdAtMs/anchorAtMs` 而非 ISO UTC 毫秒字符串。另（代码核读、未实测）：无 `deleted` 可见性过滤，已删事项来源仍可读，不符"按既有读取规则"；`association` 直通未校验枚举（写入侧只产 `new|manual_link`，现值安全）。客户端 `listItemSources` 类型与现服务端一致（numeric ms），对齐时须同改。

### 10.8 DOM 取证（只签实际覆盖路径）

`ui-journey.png` 为真实产品 DOM 渲染（签收后工作台：toast「事项已签收，班班开始盯着了。」、全部事项徽章 4、BOSS 面板 4 项待闭环、4 项未定期；日期 11 月 9 日与交付时刻自洽）。`ui-journey-results.json`：7 步全过（paired→workbench→打开→提交→候选出现→**全选 4→签收**→读回 4 条 `signed_ai`）、同源 **47**、跨源 0——**R3-OBS-3 数字更正已闭合**（记录 §9 与证据同为 47）。`candidateCards:32` 与截图 4/4 计数口径差异沿 R3 不判不裁。旅程脚本仍未随候选提交（沿 R3 待闭项）。范围如实止于「提交→候选→批量签收→签收可见」；预览/修改、队列、重启 UI 未验，保持开放。

### 10.9 未改面沿用与开放清单

本轮 10 文件未触及：R3-M-1（`readResult` 分段索引信封，原样开放）、R3-M-2（`confirmExtractExit/confirmReviseExit` 无状态守卫，原样开放）、M-5 恢复子项（`task-recovery.mjs` 未改＋有界重试/`auto_backoff` 未实现）、R2-M-a（claim/终态 task_events 与 SSE cursor）、M-4（台账裁定中）、m-1/m-4/m-6/m-7/m-8、快照 tasks limit 200、完整门禁（留集成执行者）。

### 10.10 结论

**维持不通过（尚不具备集成准出条件）；`05c66fd` 按派发作为部分修订接收。** 本增量实闭：M-3 根因（提交前断言＋整笔回滚）、两类并发签收/重放与全表回滚、CAST 字节（$blob 撤回完整）、帧 fencing＋WORKER_DEBUG 删除、R3-OBS-3 更正。新开：R4-M-1（pgid 组空≠整树退出；记录声明过宽）。登记不符：来源端点三处形状（队长已裁不采用）。下一增量待闭：① 来源端点对齐登记契约＋401/404/空列表/读回聚焦；② R4-M-1 组外后代核实（无法核实保持 unknown 占槽）；③ R3-M-1、④ R3-M-2、⑤ 生命周期事件同事务/恢复暂存原结局/有界重试/TaskQueue/预览修改队列重启 UI/旅程脚本随候选。原始证据：`build/web-text-intake-implementation-review/r4/`（探针 5 份＋结果 JSON＋作者附件读回＋admission），精选随评论附件交付。未跑完整门禁（派发限定）；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 11. R5 增量复核（2026-11-09）：`05c66fd..4dfc9e9`（ZCode，派发 01a1bc58）

> 派发限定四焦点：来源四态/字段、生命周期与恢复事件事务一致性、退出核实（含**无 `--run` 标记 detached 后代反例**与"字符串未命中不能证明未带标记的后代已退出"前提修正）、受影响旧缺陷；复用未改已过面，不重跑完整门禁。评审对象：`4dfc9e9be0dcc6528e4860a18a9630852c6ad1a1`（tree `89446a4fdc7d761aca11cb15361046049364c7d0`，父＝`05c66fd`，恰 **6 文件 +126/−51**）。**总判：维持不通过，按派发作为部分修订接收**——焦点一（来源端点契约）闭合；焦点二/三部分闭合，新发现 1 项主要（R5-M-1：extract/revise 主路径终态迁移零事件＋终态帧游标复用＋Last-Event-ID 重放丢失）与 1 项主要沿用（R4-M-1 收窄后仍被无标记反例证伪）。

### 11.1 身份、范围与作者数字（通过）

- commit/tree/parent 与派发逐字节一致；`git diff 05c66fd..4dfc9e9` 与作者附件 `candidate-revision.patch` **逐字节相同**（SHA-256 `0794b4e8…` 双侧一致）；6 文件 SHA-256 与作者 `SHA256SUMS.txt` 程序化比对 **6/6 一致**；交付记录附件读回 SHA 一致（附件 6/6 CLI 下载核回）。全部落在原 I 写入清单（`server/lib`×4、`src/lib/web-api-client.ts`、交付记录）；`src-tauri`/migrations/003/`vendor/`/`resources/`/`scripts/checks`/守卫/package.json **零差异**；003 复算 `8e4e3159…7870` 不变 ✓。**零测试新增**（`git diff --stat -- tests/` 为空）——新面全部依赖既有 11/59 套件与 UI 旅程证据，未新增任何针对本轮改动的用例。
- **作者声明数字全部复现**（标准前置链 `probe:prepare-cli`（lark-cli 1.0.98）＋`probe:prepare-pi`（provenance tree `e89822b0` 与 III 冻结一致）＋`probe:bundle`＋`build:backend` 后）：fmt 0；`web_backend_schema` 23/23；`web_backend_store` 16/16；clippy `--all-targets -D warnings` 干净；`web-text-intake.test.mjs` **11/11**；`test:web-manual-items` **59/59**；typecheck 0 ✓。

### 11.2 焦点一：来源端点四态/字段 vs 登记契约——**闭合**

真实 HttpServer（生产 bundle `web-backend-entry`＋真实存储二进制＋真实调度器，本机独跑）四态实测：① 未认证→**401** `unauthenticated`；② 事项不存在→**404 `item_not_found`**（`itemsSources` 先 `await service.getItem` 抛 `item_not_found`，R4 的"missing item→200 空数组"不符已消除）；③ 存在且无来源→**200** `{contractVersion:'web-api/1', sources:[]}`；④ 已关联→**200** 且字段**恰为登记七字段** `{sourceId,candidateId,evidence,association,createdAt,anchorAt,excerpt}`——`candidateId` 在位、时间为 ISO UTC 毫秒字符串（正则实测）、`association:'new'`（003 DDL `CHECK (association IN ('new','manual_link'))` 白名单在写入侧兜底，R4"直通未校验"关注在 schema 层闭合）、excerpt 实测恰 200 字、无 SQL/本机路径/秘密 ✓。客户端 `web-api-client.ts` 同步改型（`createdAt:string`，使用点 `Date.parse` 还原 ms）✓ typecheck 0。**沿 R4 保留面（本轮实证归档，登记契约未定义，需裁定）**：已签收事项 DELETE 成功（200）后，sources 端点对该已删事项仍返回 **200＋完整来源行**——无 `deleted` 可见性过滤（R4 代码核读项，本轮线上实证）。

### 11.3 焦点二：生命周期与恢复事件事务一致性——部分闭合＋**新主要 R5-M-1**

- **实闭（五处转换点，生产 bundle 独跑＋sqlite 全表核读）**：通用路径事件链 `queued(v1)→running(v2, claimNext 同事务含 attempt 行＋事件)→running+resultPendingExit(v3, stageResult 同事务含 payload)→failed/succeeded+exited_confirmed(v4, confirmExit 同事务)`，`object_version` 1→4 逐级正确；`claimNext` 加 `expectChanges:1`。恢复面：`task-recovery.classify` running 分支单事务产出 `needs_review/exited_confirmed`＋`task_events{cause:'restart_unknown_side_effect'}`＋`recovery_items(pending)`，needs_review 分支→`exited_confirmed`＋事件（M-5"恢复分类不写事件"子面闭合；事务原子性面沿用 R4 生产二进制回滚探针）。
- **R5-M-1（主要）：extract/revise 生产主路径终态迁移零事件，终态 SSE 帧游标复用，断线重连丢终态**。`stageExtractResult/stageReviseResult`（暂存）与 `confirmExtractExit/confirmReviseExit`（终态提交）**均不写 `task_events`**（text-intake-service 零事件调用）。生产 bundle 实测：extract 任务 `succeeded/exited_confirmed`，其事件仅 cursor 5,6（queued＋claim running）——**终态迁移无事件行**；SSE 独立实测：`succeeded` 终态帧 `id=inst_…:6`＝**复用 claim running 事件的游标**，以 `Last-Event-ID: epoch:6` 重连重放**零帧**（`extractTaskFramesInReplay:0`）——断线客户端永久丢失终态迁移，仅 `/api/snapshot` 兜底。对照通用任务终态帧 `id=epoch:4`（自身终态事件游标，重放语义正确）。交付记录 §10.1"confirmExit（各分支转移＋事件）"字面对 `TaskService.confirmExit` 成立，但调度器 extract/revise 走的是 text-intake 的两个出口确认（未转换）——R2-M-a 对主产品路径仍开放，本轮关闭声明面过宽。
- 同焦点残余（代码核读，留实现侧）：`cancel`（queued→cancelled、running→cancelling）与 `resolve`（→queued）共四处转换仍以**独立事务** `insertEvent` 写事件（task-service.mjs:395-401/407-413/437-444/484-492）——崩溃窗口内"状态已变、事件丢失"仍可能，未纳入本轮同事务化。
- 次要 nit：① `claimNext` 提交后 `changes!==1→return null` 现为**死代码**（`expectChanges` 先抛）；② 并发 `claimNext` 同任务败者实测由 R4 的"返回 null"变为**抛 `version_conflict`**（Promise.allSettled 实证）——scheduler `tick().catch(()=>{})` 吞掉后 200ms 重试，进程内单写者下无影响，行为变化记录在案；③ `markNeedsReview` 的 0 行命中转移仍无条件写事件（R2-OBS-2 族，现连同事件一起）；④ 事件 `object_version` 事务外前读＋1（TOCTOU 竞态下版本号可能失真，仅信息面）。

### 11.4 焦点三：退出核实——标记类闭合，**无标记类证伪（R4-M-1 收窄后仍开放）**

- **实闭（标记类，真实进程实测）**：argv 携带 `--run <runId>` 的 detached 后代自成组且父已退→`verifyTree=false`（未核实占槽）✓；同组无标记幸存者→组检查 `false` ✓；全退正控→`true` ✓；runId 缺失→`false`、扫描失败→catch `false`、非 ESRCH→`false`（代码核读，诚实方向）。此即 R4-M-1 的"组外后代"中**带标记子类**的闭合——对应真实进程树中确实带标记的 detached 成员：organizer（`--run`）、`managed-bash` bash-worker（`--run <runId> --nonce`）、`mcp-guardian`（guardian/cleaner/keeper 均带 `--run`）。
- **证伪（派单点名反例，函数层＋管线层双层实证）**：无 `--run <runId>` 标记的 detached 后代、父已退、组已空、进程存活——`verifyTree` 返回 **true**。① 导出函数层：标记无命中字符串即判整树退出；② 完整 `WorkerHost.start` 管线层（GAP-3 工厂仅替换 spawn、真实 record `pgid/runId`、真实帧门）：`done={outcome,treeVerified:true}` **而存活后代在列**，按 `task-scheduler` 现行映射（`treeVerified!==false`→暂存＋`confirmExit({exited:true})`）→终态提交＋槽释放，存活进程置之不理——"不会错误释放槽"不成立。生产关联：`mcp-guardian.mjs:65` 以用户配置 argv 拉起 **MCP service 进程不带任何标记**（宿于 guardian 组，guardian 活着时扫描诚实保 unknown；guardian 先亡而 service 幸存则全树无标记→假阳性）；模型经 Bash 跑 `setsid` 命令同样逃逸为无标记独立组。`worker-host.mjs:28` 注释"（每个后代都携带）"与事实不符。按派发"无法证明覆盖或退出则保持 unknown 占槽"——覆盖未证明、代码亦未保持 unknown，**R4-M-1 在无标记子类持续开放**；本审未修改任何 II 夹具、未强加标记。
- **ps 截断风险——本平台证伪排除**：按 `verifyTree` 同参调用 `/bin/ps -axo pid=,ppid=,command=`，300/600/1000/2000 字符 pad 下 `--run <runId>` 标记均完整出现（行长 2135 不截断）——darwin 上非攻击面。

### 11.5 焦点四：受影响旧缺陷

沿用开放：**R3-M-2**（`confirmExtractExit/confirmReviseExit` 无状态守卫，本轮未触碰，与 R5-M-1 同在主路径未转换区）；**M-5** cancelling＋staged 仍走 `taskService.confirmExit`（task-recovery 该分支未改，staged 候选恢复后不可见，对应队长下轮授权项 2）；**R3-M-1**（readResult 分段索引信封，未触碰）；R2-M-a 主路径面（见 R5-M-1）；M-4（台账裁定中）；m-1/m-4/m-6/m-7/m-8；快照 tasks limit 200；旅程脚本仍未随候选提交（作者附件清单与 R4 同构）；完整门禁留唯一集成执行者。作者"仍未闭合"清单（auto_backoff／resolve(resume)／TaskQueue.vue／预览修改队列重启 UI／side_effect_receipts）与实际一致、如实声明——即队长下轮授权 1–4 项。

### 11.6 结论

**维持不通过（尚不具备集成准出条件）；`4dfc9e9` 按派发作为部分修订接收。** 本增量实闭：来源端点登记契约（四态＋七字段＋ISO＋白名单＋excerpt）＋客户端同改；退出核实的**带标记** detached 后代子类；生命周期事件同事务的通用五点＋恢复分类。新开/仍开：**R5-M-1**（extract/revise 主路径零事件＋终态帧游标复用＋重放丢失——R2-M-a 主路径面）、**R4-M-1 无标记子类**（派单反例双层证伪，覆盖未证明，需按登记进程身份核实完整集合或保持 unknown 占槽）。下一增量待闭：① R4-M-1 无标记子类（按实际 worker/MCP/派生进程身份核实或诚实 unknown）；② R5-M-1（extract/revise 暂存＋出口确认事件同事务化，含 SSE 终态帧游标推进与重放回归）；③ cancel/resolve 四处转换同事务化；④ R3-M-1、R3-M-2；⑤ 队长授权 1–4（auto_backoff／resolve(resume) 暂存结局／TaskQueue／预览修改队列重启 UI 旅程）；⑥ 已删事项 sources 可见性裁定；⑦ 旅程脚本随候选。原始证据：`build/web-text-intake-implementation-review/r5/`（探针 5 份＋结果 4 份＋作者附件读回＋树哈希＋SHA256SUMS 33 项，gitignored），精选随评论附件交付。未跑完整门禁（派发限定）；候选树零修改；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 12. R6 累计增量复核（2026-11-09）：`4dfc9e9..e84fab6`（ZCode，派发 01a1bc6f）

> 派发口径：R5（`05c66fd..4dfc9e9`）已随 `701234e` 交付，故本次累计增量复核以**已出报告最后 SHA `4dfc9e9` 为基线**，覆盖映射列于 §12.2，不逐旧版本重测同一稳定面。派发四焦点：①自动重试由真实调度触发且预算耗尽/安全守卫正确；②恢复合法提交原结局与普通 needs_review 重驱拒绝并存；③退出时直接子进程快照是否遗漏已重挂/无标记 detached 后代；④TaskQueue/索引信封。评审对象：`e84fab6bcebffe4249dd7439367e320d7dc63a1c`（tree `99c23bc1b8754377cb014990135373490b5a6986`，父＝`4dfc9e9`，恰 **8 文件 +350/−41**）。**总判：维持不通过，按派发作为部分候选接收**——焦点④的索引信封闭合、焦点②③按作者声明的口径被实测证伪、焦点①机制在而触发与重跑双双断裂（新主要 R6-M-1/R6-M-2/R6-M-3/R6-M-4）。

### 12.1 身份、范围与作者数字（通过）

- commit/tree/parent 与派发逐字节一致；`git diff 4dfc9e9..e84fab6` 与作者附件 `candidate-revision.patch` **逐字节相同**；8 文件 SHA-256 与作者 `SHA256SUMS.txt` 程序化比对 **8/8 一致**；作者 6 附件（verification.log／ui-journey-results.json／ui-journey.png／SHA256SUMS.txt／patch／交付记录）CLI 读回成功。全部落在原 I 写入清单（`server/lib`×4、`src/components`×2、`tests/unit`、交付记录）；`src-tauri`/003/守卫/package.json/vendor **零差异**；003 复算 `8e4e3159…7870` 不变 ✓。测试**恰新增 2 例**：大结果索引信封＋`confirmExtractExit` 守卫（无任何 auto-retry 用例）。
- **作者声明数字全部复现**（标准前置链 prepare-cli（lark-cli 1.0.98）＋prepare-pi＋probe:bundle＋build:backend 后）：fmt 0；`web_backend_schema` **23/23**；`web_backend_store` **16/16**；clippy `--all-targets -D warnings` 干净；`web-text-intake.test.mjs` **13/13**；`test:web-manual-items` **59/59**；typecheck 0 ✓。作者附件 verification.log 与本机复跑逐项一致；ui-journey-results.json 内部自洽（7 步、4 条 `signed_ai`、queueSurface 渲染空队列文案、重启 4 项保留、跨源 0）；ui-journey.png 为真实产品 DOM（签收后工作台、4 项徽标）。

### 12.2 覆盖映射（基线 `4dfc9e9` → `e84fab6`，稳定面复用 R1–R5）

| 面 | 来源轮次 | R6 处置 |
|---|---|---|
| 003 schema/迁移/守卫/vendor | R1 §1–3 | 本轮零差异，复用 |
| 提交前断言/CAS/并发签收/CAST 字节/fencing 删除 | R4 焦点 1–4 | 本轮零差异，复用 |
| 通用任务 queued→running→staged→terminal 同事务事件链 | R5 焦点 2（C2 实测 4 事件） | 复用＋本轮 C2 再证 |
| 退出核实的**带标记** detached 子类＋扫描失败保守化 | R5 焦点 3 | 复用（C1.marked 再证 false） |
| 来源端点登记契约四态/七字段 | R5 焦点 1 | 本轮零差异，复用 |
| **R3-M-1 大结果索引信封** | R3 新开 | **本轮闭合**（D1 实测） |
| **R3-M-2 confirmExtractExit/ReviseExit 无守卫** | R3 新开 | **本轮闭合**（新守卫＋B3 实测；author 单测覆盖终态重确认与异 epoch） |
| **R4-M-1 无标记/已重挂 detached 后代** | R4/R5 新开 | **仍开**（C1＋C2 双层再证伪，见 §12.5） |
| **R5-M-1 extract/revise 主路径零事件＋SSE 游标** | R5 新开 | **沿用**（delta 未触碰该路径，B3 事件计数 2 再证） |
| M-5 cancelling＋staged 经通用 confirmExit | R2/R4/R5 | **沿用**（B4 再证：succeeded＋staged 候选不可见） |
| cancel/resolve 分离事务事件 | R5 nit | 沿用（未触碰） |
| 已删事项 sources 可见性 | R5 | 沿用（待队长裁定） |
| M-4 台账／快照 tasks limit 200／完整门禁 | R1/R2 | 沿用 |

### 12.3 焦点一：有界 `maybeAutoRetry`——机制在，触发与重跑断裂（新主要 R6-M-1/R6-M-2）

- **机制面（实测成立）**：真实调度器 `onWorkerDone` 失败分支后调用 `taskService.maybeAutoRetry`；以真实调度器方法重放失败暂存后实测：state failed→**queued**、`attempt_budget` 3→**2**、`next_attempt_at`=now+60s、`attempt_exit_state`→not_started、同事务恰一条 `task.changed` 事件（payload 携带 `attemptBudget:2`）；真实 tick 在退避窗内**不**认领（2.5s 观测无第二次 attempt）；预算耗尽（budget=0，数据面注入）→ failure 降级 `retryable:'manual'`、nextAttemptAt 清空、**无事件**；`sideEffectSafety:'unknown'`→`needs_review`（cause `failure_unknown_side_effect`，槽释放，预算不消耗）；`retryable:'manual'`→不动。
- **R6-M-2（新主要）：触发前提在生产管线不可达。** `maybeAutoRetry` 仅在 `failure.retryable==='auto_backoff'` 时动作，但全树 grep 证明**没有任何生产代码产出该值**：worker-host 对 worker error 帧只取 `{code,message}`（实测：error 帧携带 `retryable:'auto_backoff'` 经真实 WorkerHost.start→scheduler 后 staged failure 仍为 `retryable:'manual'`/`sideEffectSafety:'unknown'`）；scheduler 两处自注失败硬编码 `manual`；`stageResult` 默认 `manual`。作者 13 个单测亦无一覆盖 auto-retry——记录 §11.1 以"代码＋单测 13/13"为该项证据属**过度声明**。
- **R6-M-1（新主要，旗舰缺陷）：重入队后任务永远无法被再次认领，且静默饿死整个队列。** `task_attempts` 行**没有任何代码路径关闭**（全树无 `UPDATE task_attempts`），001 部分唯一索引 `task_attempts_current(task_id) WHERE ended_at IS NULL` 使每任务终生只允许一次认领；重入队的任务到达 `next_attempt_at` 后，`claimNext` 的 INSERT 撞索引抛 `WEB_BACKEND_SQL_ERROR: UNIQUE constraint failed: task_attempts.task_id`（E1 实测，两次确定性复现），被 tick 的 `catch(()=>{})` 吞掉；该任务以最老 `submit_seq` 居于合格队列首位→**每个 tick 都抛错→其后所有排队任务被队首阻塞饿死**（E2：later 任务持续 queued，移除卡死任务后 claimNext 立即恢复）。A2 在真实调度器＋真实 spawn 管线下同证：退避期满后 76s 仍 queued。**授权项 1（有界 auto_backoff/预算）因此不可用**：预算递减、安全守卫、退避都真实存在，但第二次运行永远不会发生，且故障是静默的全局性停摆。此缺陷同时使既有 `retry()`（失败任务手动重试再认领）暴露在同一撞索引面上（前轮未实测过"重认领"，属既有潜伏面被本轮新路径激活）。
- **R6-M-4（新主要）：`sideEffectSafety` 未证转 `needs_review` 的降级结构性坏死。** `maybeAutoRetry` 的 unknown 分支对**已 failed（terminal_at 已置）**的任务调用 `markNeedsReview`，而后者从不清 `terminal_at` → tasks 表 CHECK（非终态必须 terminal_at IS NULL）必然拒绝：A4 实测 `onWorkerDone` 抛 `WEB_BACKEND_SQL_ERROR: CHECK constraint failed`，状态停留 failed、`failure_unknown_side_effect` 从未落库、预算未消耗。即"安全未证转 needs_review"面在真实失败任务上**一次都不能成功**（markNeedsReview 既有调用方均在 running/needs_review 语境，未暴露此约束）。

### 12.4 焦点二：`resolve(resume)` 原暂存结局——作者声明被证伪（新主要 R6-M-3）

- **R6-M-3（新主要）**：记录 §11.1 声明"**HTTP 层**在 resume 且 resultPendingExit=1 且类型 extract/revise 时走 confirmExtractExit，提交原暂存结局并发布候选，不再重排队丢弃"。实测证伪两层：(a) **服务层**（B1）：needs_review＋exited_confirmed＋resultPendingExit=1＋两条 staged 候选的任务经 `resolve(resume)`→**re-queued**、`pending_outcome` 清空、`result_pending_exit`→0、两条候选**仍为 staged 不可见**（唯一 resolve 实现的注释明言"the staged outcome is discarded"）；(b) **HTTP 层**（B5）：生产入口实测 `POST /api/tasks/{id}/resolve` 对非 needs_review 任务 409 `state_conflict`——`http-server.mjs`/`web-backend-entry.mjs` **不在本轮 8 文件 delta 中**，不存在任何 extract/revise 特判路由。派发要求的"普通 needs_review 重驱拒绝并存"面同样不存在：普通 needs_review（无暂存）resume **被允许**直接重排队（B2）。**授权项 2 未交付。**
- 并存面（实测通过）：`needs_review`＋`exited_unknown`→resolve 拒 `exit_unconfirmed`（B3 回归）✓；新守卫对终态/needs_review/exited_unknown 一律 no-op（B3：confirmExtractExit(exited:true) 返回 needs_review、版本零变化、零事件）✓——**R3-M-2 就此闭合**（翻转 needs_review→succeeded 的主路径缺陷被守卫阻断）。

### 12.5 焦点三：退出核实"已登记身份集"——无标记/已重挂 detached 子类仍被证伪（R4-M-1 仍开）

- 新实现：worker 退出事件时对 worker pid 做**直接子进程快照**（`childPids`）存入 record，`verifyTree` 改为核实"进程组＋快照子进程集合"，`--run` 扫描降为补充信号，集合不可枚举或任一成员存活→false（保槽）。**改进属实**：登记集合内的存活成员→false（C1.registered）；缺 children 字段→false；带标记存活→false（C1.marked，ps 全 argv 可见，R5 结论保持）。
- **但焦点问题的答案为"是——快照结构性遗漏已重挂后代"**：子进程的 `exit` 事件触发时，内核已完成对孤儿的重挂（ppid→launchd），此后 `childPids(worker.pid)` 恒为空集——**C2 全管线实测**（真实 spawn、受控 organizer 派生无标记 detached 孙进程后退出）：record.children=**[]**、组空、标记扫描不中→`verifyTree=true`→任务 **succeeded/exited_confirmed**、`runningCount=0`（槽已释放）而孙进程**实测存活**（pid 14176，`kill(pid,0)` 为真）。C1 函数级同构反例同证 true。即"已登记身份集合"在唯一重要的反例场景里恒为空集——队长 01a1bc74 指出的"父进程退出后取得的空快照不能证明此前后代集合完整"在 e84 仍成立，**未按登记进程身份（spawn 时/存活期观察）核实，未保持 unknown 占槽**。R4-M-1 维持未闭。

### 12.6 焦点四：索引信封闭合；TaskQueue 数据面实测、DOM 旅程仍开

- **R3-M-1 闭合（D1 实测）**：>64KiB 结果无范围读取返回完整索引信封，R3 列出的全部八字段在场且值正确（`inline:false`、`payload:null`、`payloadRef:result://<attemptId>/result`、`nextOffset:0`、`done:false`、`maxInlineBytes:65536`、`maxSegmentBytes:16384`、`kind`、`acceptedByAttempt`、`completedAt` ISO；outcome/contractVersion/failure 同面）；显式 offset 才返回字节段；26 段跨 UTF-8 边界重组与原字节 **逐字节一致**；非法范围 `result_range_invalid`/`result_range_unsatisfiable` 拒绝；小结果无范围读保持 inline ✓。
- **TaskQueue.vue**：组件经 web API 列出 queued/running/cancelling＋逐任务取消（1s 轮询）挂载于待确认页——数据面实测（D2）：并发 1＋占槽 worker 下后 3 任务保持 queued 且 `queuePosition` 1..3，wire 恰含组件映射的全部字段名（taskId/type/state/queuePosition/version），queued 取消同步完成。**DOM 旅程（多任务排队/逐任务取消的页面操作）作者如实列未闭合**（ui-journey-results.json 的 queueSurface 为空队列文案渲染，png 亦未含队列行）——保留给独立源模式诊断与最终浏览器验收。

### 12.7 记录更正与小项

- 记录 §11.2"旅程脚本…随附件交付，可复跑"：本轮 6 附件中**无任何旅程脚本文件**（仅 results/log/png/SHA/patch/记录），与 R5 同一残留，更正前不能算交付。
- 记录 §11.1 将"恢复事件同事务"列为本轮关闭项：task-recovery.mjs **不在本轮 delta**，该面系 R5 已实测闭合（classify 单事务含 UPDATE＋事件＋recovery_item），属归属偏差非缺陷。
- 预算耗尽路径（failed→failed 降级 manual）无事件、`nextAttemptAt` 由 `maybeAutoRetry` 在事务外读 version 的 TOCTOU nit 与 R5 同族——随 R6-M-1 重设计一并处理即可。
- 作者"仍未闭合"清单（预览/修改 UI、多任务队列 DOM、side_effect_receipts 接线、MCP 子进程身份不报告）与实测一致，如实。

### 12.8 结论与下一增量待闭清单

**维持不通过（尚不具备集成准出条件）；`e84fab6` 按派发作为部分候选接收。** 本增量实闭：R3-M-1（索引信封）、R3-M-2（出口确认守卫）、TaskQueue 数据面、auto_backoff 的预算/安全/退避机制面。新开 **R6-M-1**（重入队撞 `task_attempts_current` 唯一索引→claimNext 永久抛错＋队首饿死全队列，静默）、**R6-M-2**（`retryable:'auto_backoff'` 无任何生产产出者，触发不可达＋单测零覆盖）、**R6-M-3**（resolve(resume) 原结局提交未实现，HTTP 层无路由，普通重驱拒绝面缺失）、**R6-M-4**（安全未证降级撞 terminal_at CHECK，needs_review 降级一次都不能成功）。仍开：**R4-M-1**（无标记/已重挂 detached 后代：需存活期登记进程身份或诚实 unknown 占槽）、**R5-M-1**（extract/revise 主路径零事件＋SSE 游标）、M-5 恢复可见性、cancel/resolve 同事务、已删事项可见性裁定、M-4、旅程脚本交付。下一增量建议顺序：① 修 R6-M-1（认领/确认时关闭上一 attempt 行或改用非唯一结构）＋R6-M-2（定义 retryable 的真实产出点——worker 帧协议或 stageResult 依 failure code 派生，二选一经队长裁定）＋R6-M-4（降级路径清 terminal_at）＋补 reclaim/重跑/降级三面回归；② R6-M-3 按 §6.1.1/§3.4 冻结语义实现或收窄声明；③ R4-M-1 存活期身份登记；④ R5-M-1 主路径事件＋游标回归；⑤ 旅程脚本随候选。原始证据：`build/web-text-intake-implementation-review/r6/`（探针 A/B/C/D/E＋结果 JSON＋作者附件读回＋树哈希＋SHA256SUMS，gitignored），精选随评论附件交付。未跑完整门禁（派发限定）；候选树零修改；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 13. R7 累计增量复核（2026-11-09）：`e84fab6..e840533`（ZCode，派发 01a1bcfd）

> 派发口径：接续累计复核，把第六轮实施交付 `e840533` 纳入覆盖映射；**只审新增面**——帧暂存/退出分离、后端独立时限、关闭核实、回执与恢复；不重跑已闭 Rust/CAST/来源面。关键反例必须走真实调度器＋当前 Rust 存储（结果后仍活的暂存窗、忽略 cancel 的后端时限、未标记/已重挂后代、缺句柄/关闭失败、错身份与回执重启），核对真实 MCP `call_begin`/`call_response` 消费与生产安全判定，**不以 17 个单测通过代签**。评审对象：`e8405339eb72ca9586889a29411b8b7e6f8c545a`（tree `80dbd77c6058becc4afea293c1e36d9675e73ccf`，父＝`e84fab6`，恰 **5 文件 +645/−96**：`worker-host.mjs` +289、`task-scheduler.mjs` +109、`task-service.mjs` +48、交付记录 +28、**新增** `tests/unit/web-text-intake-lifecycle.test.mjs` +267）。**总判：维持不通过，按派发作为部分候选接收**——四个新面里暂存分离/回执事实/关闭守卫三面实测成立，**后端时限的收口声明与退出核实的身份集声明双双被真实管线证伪**（新主要 R7-M-1/R7-M-2/R7-M-3）。

### 13.1 身份、范围与作者数字（通过）

- commit/tree/parent 与派发逐字节一致；delta 5 文件全部落在原 I 写入清单；`src-tauri`/003（复算 `8e4e3159…7870` ✓）/守卫/package.json/vendor **零差异**。测试恰新增 1 文件 4 例（结果后仍活、缺句柄/缺身份、verifyTree 边界、回执幂等/错身份），与派发四反例中的前两个对应。
- **作者声明数字全部复现**（标准前置链 npm ci --ignore-scripts＋prepare-cli（lark-cli 1.0.98）＋prepare-pi（provenance `e89822b0`）＋probe:bundle＋build:backend（storage 二进制 2649408B，与本轮 build 路径绑定的哈希 `42af54b5…`，Rust 源零差异））：fmt 0；`web_backend_schema` **23/23**；`web_backend_store` **16/16**；clippy `--all-targets -D warnings` 干净；单测 **17/17**（13＋4 生命周期）；`test:web-manual-items` **59/59**；typecheck 0 ✓。候选树上全部探针只读运行，零字节修改。
- 范围说明：`test:web-text-intake` 聚合脚本不在本候选 package.json——它属 III 工程候选（`ff287ab`，OpenCode 已按派发 01a1bcfd 以 `589eeaa` 显式登记 lifecycle 文件）；I 候选本身无聚合脚本缺口，集成接线是 III 的准出条件。

### 13.2 覆盖映射（基线＝R6 已审 `e84fab6` → `e840533`，稳定面复用 R1–R6）

| 面 | 来源轮次 | R7 处置 |
|---|---|---|
| 003 schema/迁移/守卫/vendor/package.json | R1–R6 | 本轮零差异，复用 |
| CAST 字节/来源端点/并发签收/CAS 断言 | R4/R5 | 本轮零差异，复用 |
| 索引信封（R3-M-1）/出口确认守卫（R3-M-2） | R6 已闭 | 复用（delta 未触碰） |
| **结果帧立即暂存/退出分离、暂存窗不透明性** | **本轮新面** | **实测闭合**（A1/A1b：staged 持久、不可见、不可签收、占槽；退出后发布＋放槽；A2 重复结果帧首帧胜、A3 暂存胜过后续 error 帧、A4 暂存胜过 cancel 意图） |
| **`confirmExit` 不假设退出（缺句柄/缺身份/树不可核实＋记录保留）** | **本轮新面** | **实测闭合**（D1 spawn 失败→`missing_identity`＋typed `runtime_start`；D2 `unknown_handle`；C2 树不可核实→`tree_unverified`＋记录保留） |
| **`stopAll` 有界收尾（cancel→宽限→SIGTERM→宽限→SIGKILL→逐一等待）** | **本轮新面** | **机制实测、清扫证伪**（等待面成立：C3 实测 4003ms 两段宽限；但非组存活者永不清扫——R7-M-3） |
| **后端独立时限** | **本轮新面** | **回收机制成立、收口声明证伪**（B1/B2：真实忽略 cancel＋SIGTERM 的进程被 cancel→SIGTERM→SIGKILL 链在 ~6.2s 按自有 pgid 回收；B2 cancel 意图→cancelled ✓；B1 extract 无暂存→**succeeded/零候选/failure=NULL 静默假成功**——R7-M-1） |
| **P-3 回执事实（receiptId/幂等/错身份/独立小事务/安全强制）** | **本轮新面** | **实测闭合**（E1 公式逐字节等于裁定值；E2 错 epoch/死 attempt 零入账；E3 重复帧幂等、异调用异回执不覆盖；E4 存储 SIGKILL 后回执持久、安全计数存活；E5 终态 attempt 拒新回执；F2 非只读回执存在→失败强制 unknown；F3 零记录不推导 proven_safe） |
| **退出核实身份集 vs 未标记/已重挂后代** | R4-M-1 仍开 | **再证伪且扩大**（C1 已重挂 detached 孙进程→treeVerified=true、记录删除、进程实测存活；C2 **直接 detached 子进程同样逃逸**——快照结构性事后性；见 R7-M-2） |
| MCP `call_begin`/`call_response` 消费 | **本轮核对项** | **不存在（与派发口径一致）**：真实 bundle 帧词汇＝worker/progress(tool,model)/result/error＋`{type:'mcp',action,requestId}` 控制帧；F1/F4：mcp、`mcp_call_begin`、`mcp_call_response` 帧经真实 WorkerHost→零回执、零暂存、**stdin 无任何 `mcp_ack` 应答**（writer 与分支双缺）——消费缺口按派发留给 Claude 新差距增量 |
| R6-M-1/-M-2/-M-3 | R6 新开 | 沿用（delta 未触碰认领/resolve；时限路径未触及重入队） |
| **R6-M-4** | R6 新开 | **B3 再证实**：model_timeout（auto_backoff/unknown）落库后 `maybeAutoRetry`→`markNeedsReview` 撞 `terminal_at` CHECK 抛错（stderr 实录），被 done-catch 吞掉、任务停留 failed——生产不可达（extract/revise 不走该分支），通用面照旧坏死 |
| extract/revise 失败可见性 | R5/B4 家族 | **B4 跨树确认为既有行为**：仅 error 帧无结果→两树（e84fab6 与 e840533）同样 `succeeded`/零候选/failure 空——非本轮引入，但 R7-M-1 使其扩展到时限路径 |
| 已删事项 sources 可见性 | R5 沿用 | **队长 01a1bcfd 裁定收口**：冻结契约 §6 明定软删除默认列表排除、详情/历史可读；来源子资源沿此规则——deleted 的 sources 仍 200，真实缺失才 404；**当前行为即正确，无需改删除即隐藏** |
| M-4 台账/快照 limit 200/完整门禁/旅程脚本 | R1/R2/R5 | 沿用（旅程脚本第 6 轮仍不在 6 附件中，更正保留） |

### 13.3 R7-M-1（新主要）：后端时限收口声明被证伪——extract 无暂存时限即静默假成功

- 声明（交付记录 §12.1/评论）：后端到期发带身份 cancel→宽限→按自有 pgid 回收，"并按 `model_timeout`（`auto_backoff`/`unknown`）收口"。**回收机制实测成立**（B1：真实 `node -e` 进程忽略 cancel 帧且忽略 SIGTERM，`runLimitMs`=2000 下 cancel→2s 宽限→组 SIGTERM→2s 宽限→组 SIGKILL，~6.2s 退出，`deadlineTriggered` 置位）。
- **但收口只对通用任务成立，生产任务类型走不到**：`onWorkerDone` 计算的 `effective`（model_timeout 失败载荷）**只被通用分支消费**；extract/revise 分支直接 `confirmExtractExit/confirmReviseExit({exited:true,…})`，`effective` 被丢弃。B1 两次确定性实测：extract＋时限击杀＋无暂存结果→**终态 `succeeded`、候选 0 条、`pending_outcome` NULL、`failure` NULL**——`confirmExtractExit` 在 `exited:true` 且无暂存时无条件置 succeeded（`pendingOutcome!==‘succeeded’` 仅影响候选 DELETE/PUBLISH 分支）。用户看到"成功＋空候选列表"，超时事实、`auto_backoff` 与 `unknown` 安全降级全部无声丢失。**B3 反证边界**：同样的时限链对通用 `test` 任务确实落库 `model_timeout/auto_backoff/unknown`——即声明的收口面存在于生产永不创建的任务类型上，对唯一生产路径为假。这是 R7 唯一触及"静默假成功"的新主要。
- 修复方向（并入下一增量）：extract/revise 分支消费 `effective`——无暂存且非 cancel 的失败结局按冻结 §3.2 走 failed 收口（含 model_timeout/retryable/安全未知），或时限触发时显式 stage 失败再确认；同时补 B1/B4 两面回归（时限无暂存、error 帧无暂存不得 succeeded）。

### 13.4 R7-M-2/R7-M-3（新主要）：身份集核实结构性盲区扩大，stopAll 丢弃直接 pid 收尾

- **R7-M-2**：`verifyTree` 的身份集＝进程组＋**退出时**直接子进程快照＋`--run` 补充扫描。子进程 `exit` 事件触发时内核已完成孤儿重挂（ppid→launchd），故 `childPids(worker.pid)` 对任何存活直接子进程**结构性返回空集**——C2 全管线实测（真实 spawn：worker 派生 detached `/bin/sleep 25` 后退出）：`record.children=[]`、组空、扫描不中→`treeVerified=true`、`confirmExit` `exited:true`、**记录删除而 sleep 实测存活**（`kill(pid,0)` 为真）；C1 的已重挂孙进程形态同证。即作者"仍未闭合"第 1 条所称"未枚举后代保持未核实占槽"**与实测相反：槽被释放、记录被删**。R4-M-1 的根因（退出后快照不能证明前集合）在新实现中原样存留，且从"孙进程"扩大到"直接子进程"类。作者单测的 `verifyTree({pgid:deadPid,children:[process.pid]})→false`（C4 复现 ✓）只在**手工构造的 children**上成立，真实管线填不进存活成员。
- **R7-M-3**：新 `stopAll`＝cancel 帧→2s 宽限→`kill(-pgid,SIGTERM)`→2s 宽限→`kill(-pgid,SIGKILL)`→逐一 `await done`（等待面 C3 实测 4003ms 成立）。但旧实现的直接 pid `SIGTERM`（`entry.child.kill`）被删除，非本组存活者（managedBash `detached:true` 自成组、mcp-guardian detached，R4 已立）**没有任何回收路径**：C3 实测 stopAll 后 sleep 存活者依旧存活、且因 `treeVerified!==false` 记录被删——收尾清扫对"树内组外"成员从"部分收尾"退化为"零收尾"。与 R7-M-2 同根：运行时不上报子进程身份＋核实/清扫都只认组。
- 修复方向（同根一并处理）：存活期登记子进程身份（runtime 协议上报，或 host 侧对已知派生面登记 pid），核实与清扫都以登记集为准；快照为空或不可枚举时**诚实 unknown 占槽**（`tree_unverified` 已有形状，接线即可）；stopAll 对登记集逐 pid 升级 SIGTERM→SIGKILL。

### 13.5 实测通过的新面（避免误伤）

- **暂存窗**（A1/A1b/A2/A3/A4 全过）：结果帧到达即持久化（真实 Rust 存储）、running/active/占槽/候选 staged 不可见/不可签收（signOff 拒绝）、worker 退出后发布＋放槽；重复结果帧首帧胜（1 行候选，title=first）；暂存胜过后续 error 帧与 cancel 意图（§6.1.1 面：cancelling 中暂存→发布而非静默丢弃）。
- **关闭守卫**（D1/D2/C2）：缺句柄 `unknown_handle`；spawn 失败记录 pid/pgid 空→`missing_identity`＋typed `runtime_start` 失败、记录保留；树不可核实→`tree_unverified`＋记录保留（C2 前半）。
- **回执事实**（E1–E5/F1–F4）：`receiptId`=SHA-256(紧凑 JSON `[runId,attemptId,kind,callKey]`) 前 32 hex 与裁定逐字节一致；错 epoch/死 attempt 零入账；重复帧幂等（同 id 不覆盖异身份）；异调用异回执（`tool_call_closed`+nonce-x 独立成行）；**存储子进程 SIGKILL 后回执与安全计数持久**（真实重启读回 2 行、`hasNonReadonlyReceipts` 仍真）；终态 attempt 拒新回执；非只读回执存在→失败强制 `sideEffectSafety:'unknown'`（F2 实测落库）；零记录不推导 `proven_safe`（F3）；`external_ref` 仅非秘密标识（unattributed 自标记/nonce）。
- **MCP 消费核对**（F1/F4，与派发"目前仅 progress/worker"一致）：真实 bundle 可发的全部 stdout 帧词汇已枚举（worker start/end、progress tool/model、result、error、`{type:'mcp',action,…,requestId}` 控制帧）；mcp 控制帧与假想的 `mcp_call_begin`/`mcp_call_response` 帧经真实 WorkerHost→零回执、零暂存、零 `mcp_ack` 应答（stdin 仅 request+cancel 两类写入）；`tool_call_closed` 由 worker start/end 两帧同 callKey 幂等塌缩为 1 行。
- **时限回收链**（B1/B2）：cancel→宽限→组 SIGTERM→宽限→组 SIGKILL→`done(deadlineTriggered)`；cancel 意图先行时时限完成取消（B2→cancelled ✓）；通用任务 model_timeout/auto_backoff/unknown 落库（B3）。
- 作者 4 个新生命周期单测全部真实走 Rust 存储与本轮新增路径（非静态替身），复现 4/4。

### 13.6 小项与更正

- **回执的 closed 早记**：`receiptFactsFor` 忽略 `frame.action`——`worker` 帧 `action:'start'` 也记 `tool_call_closed`；同 callKey 的 end 帧幂等塌缩后行值自愈，但 attempt 中途死亡时该行永久声称"已闭合"（方向安全：仍非只读→unknown，不发明安全性，但不满足"真实事实"字面）。
- **epoch 缺省的错 attempt 回执**抛裸 `WEB_BACKEND_SQL_ERROR`（FK）而非 typed false——调度器恒传 epoch 故生产不可达，记录为 OBS。
- spawn 失败记录（pid null）在 `active` 中永久保留（confirmExit 不删）——有界泄漏，进程退出即清，stopAll 安全跳过。
- 作者"仍未闭合"三条与实测一致、如实；§12.1/§12.2 的数字本轮全部复现。`17/17` 不覆盖时限路径、stopAll 真实等待、已重挂/直接子幸存者三面——R7-M-1/-M-2/-M-3 均在这些盲区，派发"不以单测代签"的判断成立。

### 13.7 结论与下一增量待闭清单

**维持不通过（尚不具备集成准出条件）；`e840533` 按派发作为部分候选接收。** 本增量实闭：暂存/退出分离全反例面、confirmExit 三守卫、P-3 回执事实全反例面（含真实 SIGKILL 持久）、时限回收链与 cancel 收口。新开 **R7-M-1**（extract/revise 时限无暂存→succeeded 假成功，收口声明对生产路径为假）、**R7-M-2**（身份集核实结构性盲：退出后快照恒空集，直接/已重挂 detached 存活者→treeVerified=true、记录删除、槽释放——R4-M-1 原样存留且扩大）、**R7-M-3**（stopAll 丢直接 pid 收尾，组外存活者零清扫）。仍开：R6-M-1/-M-2/-M-3（未触碰）、R6-M-4（B3 再证）、R5-M-1、M-5、cancel/resolve 同事务、M-4、旅程脚本。下一增量顺序：① R7-M-1（extract/revise 消费 effective 的失败收口）＋R7-M-2/-M-3（存活期身份登记＋unknown 占槽＋登记集清扫，一根因一并修）；② R6-M-1/-M-2/-M-4 重入队族；③ R6-M-3 resolve(resume)；④ R5-M-1 事件/游标；⑤ 旅程脚本随候选。原始证据：`build/web-text-intake-implementation-review/r7/`（探针 A/B/C/DE/F 脚本＋全量日志＋SHA256SUMS 22 项，gitignored），精选随评论附件交付。未跑完整门禁（派发限定）；候选树零修改；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。

## 14. R8 累计增量复核（2026-11-09）：`d79b1f6..5926cbc`（ZCode，派发 01a1bd4d/a837）

> 派发口径：延续 I 独审，限定复核五文件增量及受影响生产路径，已过面复用。以真实存储／调度器验证：extract/revise 无暂存错误及超时不假成功、重试后实际第二次认领且年轻任务不饿死、失败降级不撞 CHECK、真实 HTTP resume 只在退出已核实后提交原结局；同时验证主路径事件／游标推进与断线重放；重点核对退出确认是否在实际 extract/revise 路径关闭 attempt、`worker_lost` 等失败码与冻结 §4.6 的 retryable 组合、恢复版本／退出守卫和失败原结局；勿以直接调用 helper／handler 替代全链；交明确通过／不通过。MCP 配对、身份集、安全重试正控仍开放，不由本增量代签；不跑完整 check。评审对象：`5926cbc81422f550bdd9db253e794ca1e0b6f1b6`（tree `2c7bfae696bb1745c64906ee2d6a448381fc561b`，父＝`d79b1f69d242081bee1657a2247ef6b2d28740e4`，恰 **5 文件 +250/−24**：`http-server.mjs` +13、`task-service.mjs` +53/−13、`text-intake-service.mjs` +68/−11、交付记录 +26、lifecycle 测试 +114）。**总判：维持不通过，按派发作为部分候选接收**——R7-M-1／R6-M-4／R6-M-1 终态重认领族／R6-M-3 恢复面四组声明经真实管线复验成立，但 resume 强制路径存在**未核实退出即提交**的暂存窗洞（R8-M-1）、**重启恢复路径的第二次认领仍撞唯一索引并饿死全队列**（R8-M-2）、失败码注册表被改写破坏既有 retry 契约面（R8-M-3），R5-M-1 仅部分闭合（成功终局转移仍无事件、游标复用）。

### 14.1 身份、范围与作者数字（通过）

- commit/tree/parent 与派发登记逐字节一致；作者 patch 与 `git diff d79b1f6..5926cbc` **逐字节相同**；5/5 文件 SHA-256 与作者 SHA256SUMS 一致；003 复算 `8e4e3159…7870` 不变；守卫/package.json/vendor 零差异；delta 全部落在 I 写入清单（2 个 server lib、1 个 HTTP 入口、1 个测试文件、1 个交付记录）。
- **作者声明数字全部复现**（标准前置链 npm ci --ignore-scripts＋prepare-cli（lark-cli 1.0.98）＋prepare-pi（provenance `ad702637`/tree `e89822b0`，与 W1 登记一致）＋probe:bundle＋build:backend，storage 二进制 2649408B）：fmt 0；`web_backend_schema` **23/23**；`web_backend_store` **16/16**；clippy `-D warnings` 干净；单测 **22/22**（13＋9 lifecycle，新增 6 例与提交描述一致）；`test:web-manual-items` **59/59**；typecheck 0 ✓。候选树（独立 detached worktree）零字节修改。
- 作者 4 附件（verification.log/SHA256SUMS/candidate-revision.patch/交付记录）CLI 读回且内部自洽。

### 14.2 覆盖映射（基线＝R7 已审 `d79b1f6` → `5926cbc`，稳定面复用 R1–R7）

| 面 | 来源轮次 | R8 处置 |
|---|---|---|
| 003 schema/迁移/守卫/vendor/package.json | R1–R7 | 本轮零差异，复用 |
| 暂存/退出分离、confirmExit 三守卫、P-3 回执事实、时限回收链 | R7 已闭 | 复用（delta 未触碰） |
| **R7-M-1：extract/revise 无暂存错误/超时假成功** | R7 新开 | **实测闭合**（A1 真实时限击杀→failed(worker_lost/auto_backoff/unknown)→§4.6 安全路由 needs_review、0 候选、attempt 关闭；A2 仅 error 帧→同样收口——R7-B4 家族的 succeeded/空假成功消除） |
| **R6-M-4：失败降级撞 terminal_at CHECK** | R6 新开 | **实测闭合**（A1 全链路：failed→markNeedsReview(exited:true) 清 terminal_at→needs_review 落库，无 CHECK 错误） |
| **R6-M-1：重入队第二次认领/队首饿死** | R6 新开 | **分裂**：终态失败族闭合（B1 真实链 needs_review→HTTP resume→第二次认领成功、双 attempt 均闭、更年轻任务正常认领不饿死；B2 机制面 61s 退避尊重）；**重启恢复族再撞墙——R8-M-2**（F1：恢复 classify 不关 attempt 行→resolve(resume) 重排队→claimNext 每 tick 撞 `task_attempts_current`→全队列饿死） |
| **R6-M-2：retryable 产出点** | R6 新开 | **部分闭合**：`normalizeFailure` 依可信后端码派生 auto_backoff（机制真实、生产可达）；但安全证明无产出者——生产全部 auto_backoff 失败依 §4.6 行 88 路由 needs_review（契约一致的安全方向）；失败码信封改写见 R8-M-3 |
| **R6-M-3：resolve(resume) 原暂存结局** | R6 新开 | **恢复面实测闭合**（C1：真实帧→暂存→SIGKILL→真实 recovery 存活核实→真实 HTTP POST resume→202 succeeded、暂存候选发布、attempt 关闭）；C3 二次 resume 被"attempt 已关"结构性挡下（409、版本不变）；**暂存窗洞——R8-M-1** |
| **R5-M-1：主路径事件/游标/断线重放** | R5 沿用 | **部分闭合**：暂存转移首次有同事务事件（cursor 3）、failed/cancel 转移有事件（D1/D2 实测）；**成功终局转移仍零事件、广播帧复用暂存游标**——staged 窗内的快照令牌重连重放为零（D1(b)），冻结契约 §6 的短断线重放与快照高水位重订阅两条目下该转移不可恢复 |
| MCP begin/closed 配对、身份集（R7-M-2/M-3）、安全重试正控、旅程脚本 | 派发明示开放 | **不由本增量代签**；d79b1f6 的 MCP 帧消费面本轮未复审（派发限定增量），开放状态沿用 |

### 14.3 实测闭合的面（真实调度器＋真实 Rust 存储＋真实 HTTP，非 helper 直调）

- **R7-M-1**（A1/A2）：`runLimitMs`=1200 下真实 SIGTERM 忽略进程走完 cancel→组 SIGTERM→组 SIGKILL 链，`deadlineTriggered`→extract 分支 `confirmExtractExit` 无暂存→**failed** 落库（failure：`code=model_request_failed`、`internalCode=worker_lost`、`retryable=auto_backoff`、`sideEffectSafety=unknown`），事件游标推进（failed cursor 3）、0 候选、`task_attempts.ended_at/exit_confirmed_at/exit_reason='confirmed'` 关闭；随后 `maybeAutoRetry`→needs_review（cursor 4）。仅 error 帧（code=model_timeout）无结果帧同样收口——R7 双假成功面消除。旧树的 succeeded/0 候选/failure=NULL 在本树不可复现。
- **R6-M-4**（A1 全链）：对已 failed（terminal_at 已置）任务的 unknown 降级清 terminal_at 后落库 needs_review，全链无任何 `WEB_BACKEND_SQL_ERROR`/CHECK 违例；cause=`failure_unknown_side_effect`。
- **R6-M-1 终态族**（B1/B2）：worker_lost→needs_review→**真实 HTTP** `POST /api/tasks/{id}/resolve`（decision=resume，无暂存→走 `taskService.resolve` 重排队）→调度器第二次认领（两行 attempt、id 不同、均关闭、`exit_reason='confirmed'`）→第二跑发布候选；更年轻任务在 T1 停等期间被正常认领并成功（不饿死）。机制面（合成安全，标注）：auto_backoff+proven_safe→queued、61s 真实时钟退避被尊重、退避期内年轻任务可认领。
- **R6-M-3 恢复面**（C1）：完整链＝结果帧真实暂存→`SIGKILL` 真实 worker→真实 `TaskRecovery.recover()`（`processIsAlive` 核实死亡→classify：needs_review＋exited_confirmed＋recovery_items(pending)）→真实 HTTP resume→202 succeeded＋staged→pending 候选发布（1 条）＋attempt 关闭。**原暂存结局保留**（pending_outcome=succeeded 全程未清）。
- **幂等栅栏**（C3）：首次 resume 后 attempt 已关→`currentAttemptId=null`→force 门失效→落 `taskService.resolve`→409 `state_conflict`、版本不变——二次提交被结构性挡下（注意：`result_pending_exit` 在 succeeded 行上仍为 1，快照 wire `resultPendingExit:true` 属观感小疵）。
- **退出守卫**（B3）：exited_unknown＋暂存的 resume 不提交（force 内 `exited_unknown` 早退返回 needs_review，状态不变）——方向安全；但 HTTP 状态码 202 而非契约 resolve() 的 409 `exit_unconfirmed`（小项，见 14.6）。
- 迟到收口竞争（C1/F1 stderr 实录）：SIGKILL 后 done 与恢复 classify 竞争时，`expectChanges` 栅栏使迟到方以 CONDITION_FAILED 失败并被 done-catch 吞掉，终态不被覆写——栅栏面成立。

### 14.4 R8-M-1（新主要）：HTTP resolve(resume) 强制路径在退出未核实（暂存窗）即提交原结局

- `http-server.taskResolve` 的强制门只有 `decision==='resume' && resultPendingExit && attemptId && type∈{extract,revise}`——**无任何状态门槛**。暂存窗（§6.1.1：state=running、attempt_exit_state=active、resultPendingExit=1、worker 仍活）内的 POST 直接进 force 路径：`confirmExtractExit(force)` 绕过终态守卫、`exited_unknown` 早退不命中（active≠exited_unknown）、`stateGuard=''` 去 state 过滤→**succeeded 提交、候选发布、attempt 关闭、槽释放**，全程无任何存活核实。
- **C2 实测**（真实 HTTP＋真实进程）：worker `kill(pid,0)` 存活确认下 POST resume→**202 succeeded**，POST 后 worker 仍实测存活，行 `['succeeded', 4, 'exited_confirmed', terminal_at 已置]`（attempt 关闭）；按 force 路径代码面（pendingOutcome=succeeded 分支）staged 候选同时翻 pending 发布；worker 随后退出，迟到 `onWorkerDone` 被 expectChanges 栅栏挡下（本例终态恰同为 succeeded 未致错，但暂存后若 worker 本应继续产生不同结果或错误，第二结果帧因 attemptExitState≠active 被静默丢弃）。
- 同一去守卫使 `cancelling`＋暂存任务可被 resume 强制 succeeded——用户取消意图可被一次 POST 静默击败（§6.1.1 属退出路径规则，非用户入口；代码面 text-intake-service.mjs:824）。派发要求"真实 HTTP resume **只在退出已核实后**提交原结局"——本面不成立。
- 修复方向：强制门加 `state==='needs_review' && attemptExitState==='exited_confirmed'`（恢复前置条件即派发要求）；或 force 路径前置 `processIsAlive`/记录核实；exited_unknown 返回契约 409 `exit_unconfirmed` 而非 202 空操作；补 staged 窗/cancelling 两面回归。

### 14.5 R8-M-2（新主要）：重启恢复路径的第二次认领仍撞 `task_attempts_current`——R6-M-1 未在恢复族闭合

- `markNeedsReview` 有意保留 attempt 行（注释：needs_review 不可认领、resolve 需当前 attempt）；`confirmExtractExit`/`confirmExit` 的终态/cancel 分支关闭它。但 **`task-recovery.classify` 的 running 分支（重启最常见的 needs_review 来源）不关 attempt 行**——needs_review＋exited_confirmed＋attempt 开着。
- **F1 实测**（真实恢复＋真实 HTTP）：extract 运行中 worker SIGKILL（无结果帧）→真实 `recover()`→needs_review（attempt 行 ended_at=NULL 实证开着）→HTTP resolve(resume)→202 queued→**tick 反复撞 `UNIQUE constraint failed: task_attempts.task_id`**（001:71 部分唯一索引），`void this.tick().catch(()=>{})` 吞掉→2.5s 后 **T1 仍 queued、更年轻 T2 仍 queued 且从未被认领（零 attempt 行）——全队列饿死**，与 R6 E1/E2 同机制，经恢复路径复活。作者单测覆盖终态失败重认领（confirmExit 已闭 attempt）与 HTTP resume 强制路径（同样闭 attempt），恰未覆盖恢复族。
- 修复方向：恢复 classify（cancelling 分支外的 running/needs_review 分支）在确认退出后关闭 attempt 行，或 resolve(requeue)/claimNext 前关行；补 F1 面回归（重启→needs_review→resume→第二次认领＋年轻任务推进）。

### 14.6 R8-M-3（新主要）：失败码注册表被 `normalizeFailure` 改写——`auth_or_config_invalid` 信封失真且 retry 配置变更入口坏死

- `normalizeFailure` 对**所有** stageResult 失败强制 `code='model_request_failed'`，把真实码降格为信封外字段 `internalCode`（冻结 §4.6 失败信封形状为 `{code, message, retryable, sideEffectSafety, nextAttemptAt?}`，无 internalCode；`failure.code` 即注册表键）。
- **E1/E2 实测**（真实 HTTP）：无模型配置提交→launch 失败（原码 `auth_or_config_invalid`、retryable=manual、proven_safe）→wire/库内 failure `code=model_request_failed`＋`internalCode=auth_or_config_invalid`；随后 **retry 携变更 configRevision→409 `config_revision_change_not_allowed`**——契约行 149 明定该面恰对 `auth_or_config_invalid` 开放，`retry()` 按改写后的 code 判定→注册流程断裂。同修订普通 retry 仍通（E3：202 queued→第二次认领成功）。
- 组合偏差：`worker_lost`→internal 映射 `model_request_failed`→retryable **auto_backoff**，与冻结注册表 worker_lost 行（`manual`，"恢复扫描预算耗尽或不可自动续跑"）相悖；`output_contract_invalid` 同被掩码为 model_request_failed。安全闸（unknown→needs_review）使行为落在契约要求的安全路由上，故未观察到不安全自动重试，但信封语义与注册表已不一致，客户端按 code 区分"配置类失败/请求类失败"的能力被移除。
- 修复方向：failure.code 保留注册表原码（internal 判定只用于 retryable 派生，可留在服务端不外泄），或注册表扩展经队长裁定；E1/E2 面回归；worker_lost 映射按注册表改 manual（若队长维持 auto_backoff 需明示裁决记录）。

### 14.7 R5-M-1 部分闭合：主路径事件已写、成功终局转移仍零事件（游标复用）

- **已闭合**：`stageExtractResult`/`stageReviseResult` 同事务写 `task.changed`（state=running＋resultPendingExit:true，cursor 3 实测）；failed/cancel 转移同事务事件（A1/D2）；游标随事件推进（快照 lastEventId 1→3 实测）。
- **残余**：`confirmExtractExit` 成功分支（暂存→succeeded＋候选发布）**不写任何 task_events 行**，`notify` 广播帧复用暂存事件游标（id=epoch:3）。**D1(b) 实测**：staged 窗内快照（lastEventId=inst:3，冻结契约 §6 规定的客户端重订阅令牌）→退出成功后重连→令牌可恢复（无 reset）→重放 `cursor>3` **零帧**→成功转移对断线客户端不可恢复，停留 running 直至外部重拉快照。对照组：失败路径每个转移自带事件/游标，旧令牌按契约获 `stream.reset` 后重拉快照即恢复，无不可恢复的滞留态——不对称 precisely 在成功终局。R5-M-1 的根形态（成功终局转移无独立游标）保留，窗口从"全运行期"缩窄到"staged 窗内快照/断线"。提交信息"confirmExtractExit 各分支在同事务写 task.changed"对成功分支**过度声明**。
- 次要：成功 UPDATE 不清 `result_pending_exit`（succeeded 行恒 1，CHECK 满足、无功能危害）；`markNeedsReview` 注释称降级"清 staged 列"与代码不符（仅清 terminal_at）。

### 14.8 小项与更正

- 强制路径完全忽略 `expectedVersion`（注释明示 epoch 栅栏有意不设——恢复新实例语境成立；但任务版本 CAS 亦无，与 resolve() 的条目版本 CAS 语义不一致，若采纳 14.4 的 needs_review 门槛则并发面由 state 守卫＋409 覆盖，记录在案）。
- B3：exited_unknown＋暂存 resume→202（needs_review 原样返回）而非 409 `exit_unconfirmed`——方向安全、状态码偏离 resolve() 契约（并入 14.4 修复面）。
- 提交信息"R5-M-1 各分支同事务事件"过度声明（见 14.7）；作者"仍未闭合"四条与实测一致、如实（身份集/MCP 配对/正控/旅程脚本均未在本增量闭合，也不由其代签）。
- 单测 6 例全部落在服务/handler 层（R6-M-3 例以假 req/res 直调 taskResolve）；本轮全链探针证实其结论对真实 HTTP/恢复链成立（C1），但对 R8-M-1/-M-2 两面无覆盖。

### 14.9 结论与下一增量待闭清单

**维持不通过（尚不具备集成准出条件）；`5926cbc` 按派发作为部分候选接收。** 本增量实闭：**R7-M-1**（无暂存错误/超时假成功，A1/A2 全链）、**R6-M-4**（降级 CHECK）、**R6-M-1 终态重认领族**（B1 真实第二次认领＋不饿死；B2 机制面）、**R6-M-3 恢复面**（C1 全链原结局提交；C3 幂等栅栏）、R6-M-2 机制产出点（生产路由依 §4.6 落 needs_review，方向契约一致）。新开 **R8-M-1**（resume 强制路径退出未核实即提交——暂存窗/取消意图两面，202≠409 小项并入）、**R8-M-2**（恢复族第二次认领撞唯一索引→全队列饿死）、**R8-M-3**（失败码注册表改写→auth_or_config_invalid 信封失真＋配置变更 retry 坏死＋worker_lost retryable 偏差）；**R5-M-1 部分闭合**（成功终局转移零事件/游标复用残余）。仍开（不由本增量代签）：MCP begin/closed 配对、身份集（R7-M-2/M-3）、真实 test 任务安全正控、旅程脚本、M-5、cancel/resolve 同事务、M-4。下一增量顺序：① R8-M-1（needs_review＋exited_confirmed 门槛/退出核实＋409 语义）＋R8-M-2（恢复 classify 关 attempt 行＋F1 回归）；② R8-M-3（failure.code 保留注册表码＋E1/E2 回归＋worker_lost 映射裁定）；③ R5-M-1 成功终局事件＋游标回归（D1(b) 面）；④ 身份集方案与 OpenCode 只读裁定交叉核对后统一定准出；⑤ 旅程脚本随候选。原始证据：`build/web-text-intake-implementation-review/r8/`（探针 A/B/C/D/E/F 脚本＋stub worker＋全量日志＋结果 JSON＋作者附件读回＋树哈希＋SHA256SUMS，gitignored），精选随评论附件交付。未跑完整门禁（派发限定）；候选树零修改；未调用真实模型/凭据/用户根；MAYNE-24 保持 in_progress。
