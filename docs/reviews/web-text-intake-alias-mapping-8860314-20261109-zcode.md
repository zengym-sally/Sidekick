# MAYNE-24 — `8860314` FAILURE_CODE_ALIASES（四模型传输类别名）+ scheduler failurePayload 白名单：限定独立复审（ZCode，2026-11-09）

派工：协调 `01a1bf92`（锁定生产 `8860314bec56c2a72e88ea556355e77667d339ae`／tree `b166fc4491c35bc8cda5a974817b30f5b94e4577`，父 `0536a44`，记录 `cbb04f7`）。作者 Kimi（`01a1bf90`），评审人未参与实现。

## 结论：通过（限四别名映射面、未知码兜底面、deadline／暂存优先未退化面、安全声明剥离与 launch 可信安全边界面）

不签逐码矩阵闭合（59/57 整表按派工未重复）、不签聚合准入、不跑完整 gate。

## 身份复核

- `8860314` tree `b166fc44…` 与锁定一致，父恰 `0536a44`；差异恰两文件 +23/−3：`server/lib/task-service.mjs`（FAILURE_CODE_ALIASES 恰 +4 行：`MODEL_AUTH→auth_or_config_invalid`、`MODEL_RATE_LIMIT/MODEL_NETWORK/MODEL_SERVICE→model_request_failed`，注释同步）与 `server/lib/task-scheduler.mjs`（failurePayload 白名单：`succeeded || payload == null → null`，否则仅取 `{code, message}`）。其余（Rust／DDL／003／守卫／package／前端／Runtime）零差异自验（`git diff 0536a44..8860314` 全量核对）。
- `src-tauri`：`681c282..8860314` 与 `0536a44..8860314` 均零行。
- 运行输入：存储二进制 `5311ffa3d3d26e19…753232bd`（2647984 B）——复用既有产物并与本审运行树核对 sha256 逐字节一致，与 Kimi（`01a1bf90` 如实披露）及 Hermes（`01a1bf87`）两次独立构建登记互证；s0-runtime organizer `08f32db2…`、随包 node `9d050fd4…`（与全部既往登记一致）。rustc 本轮独立读回 `1.99.1 (58cf8f9c3, aarch64-apple-darwin)`（与协调 `01a1bf96` 读回一致）；`42af54b5…` 旧证据不改写，`5311ffa3…` 按实际输入另记。

## 静态判据（逐字节）

1. **映射面**：alias 表恰 +4，全部落入既有注册码（registry `:42` auth_or_config_invalid: manual、model_request_failed: auto_backoff）；`normalizeFailure`（task-service `:98-112`）路径未动：code 先查注册再查别名、未知码默认 `worker_lost`（不伪装成功），retryable 恒来自 registry，信封恒四键、无 internalCode。
2. **白名单面**：scheduler `onWorkerDone` 中 failurePayload 只携带 `{code, message}`——payload 自带 `sideEffectSafety` 声明不可能随信封落库。hasNonReadonlyReceipts 强制 unknown（`:97-100`）与 deadline 覆盖块（`:101-105`）都在白名单**之前**构造 payload，行为不变（白名单剥掉的只是已经 unknown 的声明，无语义损失）。
3. **launch 可信安全边界（本审核心）**：两条 launch 前置 proven_safe 路径（no-snapshot `task-scheduler.mjs:105-115`、credential-unavailable `:120-130`）调用 **`taskService.stageResult(...)` 直传完整 payload**（含 `sideEffectSafety: 'proven_safe'`），**不经 failurePayload**——白名单不可能伤及（字节证明）。`maybeAutoRetry`（task-service `:888+`）proven_safe 路由未动。
4. **deadline／暂存优先**：差异只改 failurePayload 的构造表达式，`confirm*Exit` 内部优先级结构（text-intake-service `:970+`：tree 未证实分支→needs_review/exited_unknown；staged 胜 failurePayload；deadline 胜帧码）零改动。

## 动态反控（真实链，最小面；本审自有探针 `build/mayne24-alias-review/alias-probe.mjs` + 受控 stub，scratch 不入树）

生产 entry（startWebBackend）＋真实随包 Pi（build/s0-runtime）＋真实存储二进制＋loopback 受控模型服务（或死端口 127.0.0.1:1）；提交走公共 `/api/text-sources`；信封从真实 SQLite 文件按只读 db-observer 读回；`assertNoSecretInRecord` 通过（合成密钥值不入记录）。**AFTER 树 `8860314` 两连跑 9/9 逐字节一致**（`after-run1.json`／`after-run2.json`）：

| 面 | 落库信封（真实链读回） |
|---|---|
| 真实 401 | `auth_or_config_invalid`／`manual`／`unknown` ＋ needs_review ＋ cause `failure_unknown_side_effect` |
| 真实 429 / 真实 500 / 拒连 | `model_request_failed`／`auto_backoff`／`unknown` ＋ needs_review ＋ `failure_unknown_side_effect` |
| launch 无模型配置 | **failed** ＋ `auth_or_config_invalid`／`manual`／**proven_safe**（不转 needs_review） |
| launch 凭据缺失 | **failed** ＋ `credential_unavailable`／`manual`／**proven_safe** |
| stub 未知码＋载荷毒化声明（`MODEL_BOGUS` + `sideEffectSafety:'proven_safe'`） | `worker_lost`／`manual`／**unknown**——兜底不伪装成功、声明被剥（端到端；宿主 `worker-host.mjs:417` 已收敛 `{code,message}`，白名单为纵深防线） |
| stub 错误帧＋挂起（runLimit 1500ms） | deadline 胜帧码：信封 `model_request_failed`／`auto_backoff`，message=`整理超出后端时限。`（帧码 MODEL_AUTH 未胜出） |
| stub 先暂存合法结果帧＋再错误帧 | **succeeded**＋候选发布、无 failure 信封——暂存胜 failurePayload |

**BEFORE 树 `0536a44` 反控**（`before-run1.json`）：同一探针默认 9 面全跑——四个传输面（真实 401/429/500/拒连）全部落 `worker_lost`/`manual`（恰为协调登记的缺口复现），launch 两面 proven_safe 与三个 stub 面逐字节同 AFTER（未知码兜底、deadline 优先、暂存优先为本差异未触的行为，前后一致即未退化反证）。两面树差**只在四别名的落库信封**，与静态判据互证。

边界（如实）：本审验证"真实请求→落库信封"面；帧层帧码观测（MODEL_AUTH 等四码由真实 organizer 发出）留在作者 `01a1bf90` 已登记探针（59/59）与 Hermes `01a1bf56` service 级复放内，未独立重复；generic（非 extract/revise）任务路径的 stageResult 仍收完整 effective.payload（差异未触、宿主上游剥离仍在）——登记为边界非缺陷。

## 卫生与证据

零 `/tmp/w1-alias-probe-*`／`w1-alias-script-*` 残留、零本树进程遗留（pgrep 复核），运行树（detached `8860314`／`0536a44`＋二进制＋s0-runtime 覆盖物）整体移除，探针 scratch 不入树。原始证据 gitignored `build/mayne24-alias-review/`（两树三份 JSON、探针与 stub 副本、SHA256SUMS），随评论挂载摘要 JSON。未跑完整 gate（按派工）；未触真实模型／真实凭据／用户根（合成密钥、loopback、合成临时根）；MAYNE-24 保持 `in_progress`。
