# R8-M-3＋§5.1 生产增量 `c4a9c67..0dbae12` 限定独立审记录（OpenCode，2026-11-09）

- 审阅者：OpenCode（未写本增量四个生产文件、未写更正后 W 测试字节 `82e1bf2`），派发：评论 `01a1be44`（2026-11-09T03:05Z，协调锁定 `0dbae12ce`／tree `21393729`／记录 `ae5f575`）。
- 候选：`0dbae12ced3a6a1e6b234aac9a529d4de9c081c2`／tree `21393729b794e9e967d0a58e5be226dfa1238bd7`（锁定值逐字节复核一致），基线 `c4a9c67`（其为 `0dbae12` 直接祖先，区间恰一个生产提交）。
- 范围：恰四个 `server/` 文件及受影响路径；已过面复用（R8-M-1/M-2、PC1/PC2/M1a-c、Rust／MCP／前端零 blob 交叠沿旧绿证）；F-R8-2 沿既有反证、不重跑已明确失败面；不写生产、不跑完整 check。
- 权威判据：冻结 `docs/engineering/web-api-contract.md` §4.6（行 214「无法证明即 `unknown`，转 `needs_review`。失败码本身不构成安全证明」）、§4.5 行 194、§3.2 行 104；`web-text-intake-contract.md` §5.1 行 105（`timeZone?` 可选）；更正后 W 两面控制（`82e1bf2`，测试 blob `8c641b11`）；协调冻结裁定（`workerRunLimitMs` 严格 number 整数 1..120000，默认仅省略／undefined；`'500'`／null 应拒；启动先纯校验再开资源）。

## 结论

**限定范围 SPLIT：增量自身的行为面（配置变更 retry 被下一 attempt 使用／等待中快照不漂移／缺省·显式时区与首次锚点重放）成立；R8-M-3 的信封码面（E1）与 retry 门面（E2）通过；R8-M-3 的 §4.6 安全路由面不通过——更正后 W 两面在锁定候选上动态复现双败，且 deadline 面相对 `c4a9c67` 属回归。F-R8-2 沿既有反证保持不通过（源码未动，未重跑）。增量不关闭；启动泄漏与 `workerRunLimitMs` 严格形状仍在（协调已派修，不在本增量）。**

## 身份与差异（复核通过）

- `git diff --numstat c4a9c67 0dbae12`：`web-backend-entry.mjs` +3/−0、`http-server.mjs` +14/−1、`task-service.mjs` +86/−21、`text-intake-service.mjs` +30/−4，合计 +133/−26；src-tauri／package／前端／其余 server 零差异；`ae5f575` 为其上 docs-only 交付记录（69 行，本审全文读回）。
- 提交信息与记录声明的范围（四个文件、R8-M-3 注册码／配置 retry／省略 timeZone 缺省）与实际 diff 一致；无夹带。

## 独立复跑（pristine detached 树，本机重建前置）

生产树 `0dbae12` 原字节 detached 检出，仅以更正后测试 blob `8c641b11`（`82e1bf2`，恰 `tests/unit/web-text-intake-recovery.test.mjs` 一个文件）覆盖为未跟踪修改；fixtures 用树自带 `5fe68cb4`／`6d638db0`（= 登记的 `adc31d8`/`463bf46` blob，与 `82e1bf2` 逐字节同，OhMyPi 审已核，本审 `git hash-object` 复算一致）。前置全链重建：`npm ci --ignore-scripts` exit 0；`probe:prepare-cli` lark-cli 1.0.98；`probe:prepare-pi` provenance `ad702637…`／tree `e89822b0…`（与既往登记一致）；`probe:bundle`；`cargo build --release --bin web-backend-storage` → **2649408 B、SHA-256 `42af54b5…490fc2`，与全部既往登记逐字节相同**（确定性复现）。

| 运行 | 对象 | 实测 |
|---|---|---|
| 六面聚焦（`--test-name-pattern 'PC[12]:\|E[12]:\|W \('`，20000ms 预算） | `0dbae12`＋更正 W 字节 | **6 项 4 过 2 败**，exit 1，stderr 0 字节 |

- **PC1** 5.59s ✔、**PC2** 4.84s ✔——注册表变更未回归 R8-M-1/M-2 修复面（已过面复用+回归守卫）。
- **E1** 4.11s ✔——启动失败公开信封保留 `auth_or_config_invalid`／`manual`、无 `internalCode`（`normalizeFailure` 重写＋`task-service.mjs:27-83` 注册表/别名表；scheduler launch 无快照即按注册码 stage，`task-scheduler.mjs:94-106`）。
- **E2** 4.15s ✔——`auth_or_config_invalid` 携带变更 `configRevision` 的 retry 202 且二次认领（`http-server.mjs` `taskRetry`＋`TaskService.retry` 门禁按公开码判定，§4.5 行 194 形状）。
- **W (deadline)** 7.79s ✖——实际落定 `failed`，期望 `needs_review`（断言 `:710`）；落库码为 `worker_lost` 而非映射后的 `model_request_failed`。
- **W (worker loss)** 5.11s ✖——实际落定 `failed`，期望 `needs_review`（断言 `:748`）；码／retryable 断言（`worker_lost`/`manual`）在状态断言之后，未及执行。

运行树全程仅该一文件覆盖，取证后删除；本树无残留进程（观察到的唯一 `web-backend-storage` 存活进程属 `mayne-24-d9e5f73c031e` 工作树，先于本审存在，未触碰）。

## 逐判据核验

### 1. 新配置确被下一 attempt 使用——成立（限定）

静态链完整且唯一：`taskRetry` 仅当 `configRevision` 与任务当前修订不同时经生产 `snapshotFor()` 重解析（`http-server.mjs:746-765`）；`TaskService.retry` 把 `{...inputRef, snapshot}` 与状态迁移**同一事务**写回 `input_ref`（`task-service.mjs:510-523`，`originalConfigRevision` 保留首入队值）；`claimNext` 重读行返回（`:754-791`）；launch 的快照唯一来源是 `row.inputRef?.snapshot`（`task-scheduler.mjs:94`→`:130`）；worker 帧携带该快照（`worker-host.mjs:130/:237`）。动态面：E2（202＋attempt#2）真实链过。作者 Leg B 探针声明（记录 stub 观察到 attempt 2 以新 revision/modelId 启动、`inputRef.snapshot` 同步重建）已自提交记录 `ae5f575` 读回；其原始脚本在已回收的 `build/`，内容级动态重放未独立复现，如实标注。

### 2. 等待中快照不漂移——成立（限定）

claim/launch 路径无任何 `snapshotFor()` 调用（grep 全量核验）；`input_ref.snapshot` 仅有两个写入点：提交时与「修订确有变更」的 retry。省略/同修订 retry 保持原快照；待执行期间编辑配置（作者 Leg C 负控，记录读回）不影响已入队任务——与 §3.1 行 56「待执行期间编辑/删除配置不影响本任务」一致。

### 3. 缺省／显式时区与首次锚点重放——成立（限定）

entry `:56/:71` 装配 `ApplicationSettingsService`；`submit` 对省略/`null` 解析为存储 `application.timeZone`→OS 兜底（`text-intake-service.mjs:141-152/:250-261`），显式值必须是合法 IANA 区（空串/非字符串/非法 → 400）；指纹去重返回**首个**来源及其存储锚点/时区（`:266-270`），同 `operationId` 重放返回首个任务；`anchorAtMs = sourceAtMs ?? now` 首次录入定格（`:284`）；worker 请求携带解析出的时区（`worker-host.mjs:232/:244-248`）。显式时区路径由本审六面（全部显式 `Asia/Shanghai`）动态印证；缺省面依静态＋作者 21/21 探针声明（记录读回），未独立重放，如实标注。

### 4. R8-M-3 按 §4.6／更正 W 两面——**不通过**

- **注册表豁免违反冻结行**：`FAILURE_REGISTRY` 给 `worker_lost`／`auth_or_config_invalid`／`credential_unavailable` 写 `isolateOnUnknownSafety=false`（`task-service.mjs:33-41`），使 manual 码在 `sideEffectSafety=unknown` 时不隔离、停留 `failed` 等用户 retry。§4.6 行 214 的语义是通用安全路由：「无法证明即 `unknown`，转 `needs_review`。**失败码本身不构成安全证明**」——`retryable` 只区分重试发起方（§2 行 62），不构成豁免依据。协调冻结裁定同向（`01a1be44`：「unknown→needs_review 不因 worker_lost/manual 豁免」）。动态后果：W(worker loss) 双败面上状态断言即败。
- **deadline 事实被丢弃（且回归）**：scheduler 在 `deadlineTriggered` 时算出 `model_timeout` 信封（`task-scheduler.mjs:246-250`），但 extract/revise 分支（`:251-255`）调用 `confirmExtractExit` 时**不传该事实**；`confirmExtractExit` 无 deadline 入参、无暂存收尾硬编码 `{code:'worker_lost', retryable:'manual'}`（`text-intake-service.mjs:826-840`）——超时被记成丢失，`effective` 信封对 extract 任务落在地上。**相对 `c4a9c67` 属回归**：旧收尾信封为 `auto_backoff`＋unknown，旧 `maybeAutoRetry` 会把 deadline 面隔离到 `needs_review`（更正 W(deadline) 当时通过，OhMyPi `01a1be4a`）；本增量改字面量＋注册表豁免后，deadline 面落定 `failed`＋`worker_lost`，两面俱失。
- **登记提示**：作者记录的「恢复回归 8/10 … W 通过」是**被撤回的 `adc31d8` 旧 W 预期**（worker_lost/manual/failed——`0dbae12` 恰好满足它）；协调已明示其绿色不能代签。记录 Leg E「test 型任务 unknown 按 §4.6 独立路由 needs_review」只对走 scheduler 信封的 test-kind 任务成立；extract 任务不享有该路由（上一条）。

### 5. F-R8-2——既有反证沿用，未重跑

`resolve()` 两分支在 `0dbae12` 与 `c4a9c67` 零差异（守卫读→迟读 `currentAttemptId`（`:559`）→任务 UPDATE op 无 `expectChanges`→**提交后**才查 `changes!==1` 抛 409（`:579/:601`））——F-R8-2（MAJOR）反证（`01a1be39` 确定性探针：败方事务 changes [0,1] 先提交后抛错、误闭新代 attempt、伪造退出台账）原样成立。协调已派 Kimi 修复（`expectChanges:1` 预提交断言＋CAS 绑定读），不在本审实施。

## 其余发现（按严重度）

- **F-R8-2 同族（建议随修复批次一并处理，MINOR~MAJOR 之间）**：`TaskService.retry` 的任务 UPDATE op 同样无 `expectChanges:1`、事务后不查 changes 即无条件 `insertEvent`（`task-service.mjs:514-524`）——预检通过后、CAS 命中前的窄竞窗内，任务未重入队仍会写入幻影 `task.changed{state:'queued'}` 事件并以 202 应答旧状态任务。未触 attempt 行，爆炸半径远小于 F-R8-2，但应套用同一预提交断言。
- **N-1（MINOR）**：`taskRetry` 对**任何**失败码的变更修订请求都先重解析快照，之后 `retry()` 才以 `config_revision_change_not_allowed` 拒绝非配置码（如 `worker_lost`，作者 Leg D 已证 409 正确）——注定失败的白做一次快照解析，无语义洞。
- **启动泄漏与 `workerRunLimitMs` 严格形状——仍在（协调已另派，不计本增量败因）**：entry `:52 await storage.start()` 先于 `:74 normalizeRunLimit` 校验，装配失败不释放已开适配器（作者披露＋探针：4 个被拒值各漏 1 个适配器）；`normalizeRunLimit`（`:155-163`）`null→120000`、`Number('500')=500` 接受——与协调冻结形状（严格 number 整数 1..120000、默认仅省略/undefined、`'500'`/null 应拒）相悖。两者均未在 `0dbae12` 修复。

## 边界

只读独审＋一支聚焦运行树（已删）；未写生产/测试/package/DDL/Runtime/守卫；未跑完整 check；Rust/MCP/前端零 blob 交叠沿旧绿证复用，未重跑；未触其他成员工作树（观察到的既有外部进程未动）；无真实模型/凭据/用户根；`workerRunLimitMs`/启动泄漏/F-R8-2 的修复面归协调已派批次，本审不实施。原始证据 `build/mayne24-r8-m3-review/r1/`（gitignored：admission.json、identity、TAP、stderr、SHA256SUMS；TAP 的运行树绝对路径已以 `<RUNTREE>` 占位，其余无脱敏点——stderr 0 字节），关键原件随结果评论附件交付。
