> 收束脱敏副本（2026-11-12）：仅将本机绝对路径替换为占位符；原始 blob `dbcf0646862472231451090b56293d3d350c7ca2` 保存在本轮 Git bundle，历史结论不变。

# MAYNE-24 证据补件 `308ddc1` + 工程接入 `6fad178` 限定独审（ZCode，2026-11-09）

> 派发：协调评论 `01a1c0e0`（Codex）。评审人未写两项受审字节（本审者既有 MAYNE-24 提交均为 receipts-restart 测试线与 docs 记录），并行限定独审、分别给结论。仅做必要静态／语法／docs／参数核查，不重跑旧功能、不跑聚合／完整 gate、不补造临时脚本。记录 docs-only 恰 1 文件。

## 结论（分别）

- **工程接入 `6fad178`（tree `25090a1a`）：通过——限「接收与结构核查」面。** 三文件逐 blob 与 `6216a6b` 原样、package 恰一行追加一次、原九文件顺序／预算／107 脚本名／52 步 check 链／依赖与锁逐字节不变、缺失 I／II 引用如实列为待接收且无占位、限定核查（语法／参数分解／structure 基线差分类／docs）全部复现。**两面如实限定：`check:structure` 在两棵树均 exit 1（并非结构整体绿）；验证的是「自测 exit 0 + 基线 4 条不变 + 新增恰 4 条预期 `ref.missing`」这一差分事实。**
- **证据补件 `308ddc1`（tree `bb872f74`）：通过——限「证据载体收口」面。** 六份原附件对登记 `SHA256SUMS` 逐字节 OK；脱敏副本实际修改字段恰为登记范围；替代附件 ID／原 SHA 全对；**布尔来源合法**（见 §4——未把字段存在当相等证明、未声称从现存文件重算三方 nonce 相等）；临时脚本缺件按事实保留、零补造。

## 1. 身份与运行输入（对象库直读，全哈希）

- `308ddc13007ca3838ff4f692f0503f94bcd481de`／tree `bb872f748a6bcfdd171818cd2aff7e7b0b866624`／父 `0ff27bb210293eebcdf9abd7eb4d16bca071ab05`。
- `6fad178f0ee7c14170d6ab456da596d8c17b4656`／tree `25090a1a9911fcb48fac036a89dbf0c66069a8f6`／父 `308ddc1`。
- 锚点复算：`6216a6b` tree `06834225`/父 `b87d054`/三 blob `f72ff6dd`/`4bea6aac`/`4f3c9940`；`cd08588` tree `776b2529`/父 `d2b2696`/blob `52198fa`+`8684d44`；`9ab8ee0` tree `5e7d02b3`/父 `cce6cfbb`/package.json blob `17d3825a`＝`0ff27bb` 同 blob（逐字节 diff 0）。
- 交叉绑定独立复算：`4bea6aac` 内容 SHA-256＝`54e1d84c…daee9`＝两份 R1 证据 JSON 的 `syntheticEntrySha256`（本审从 worktree 字节与两份原 JSON 各自读出后全等比对）。
- 工具链：node v24.20.0；核查在我分支工作树与本日 detached 临时 worktree 内完成，审后已 `git worktree remove` 清净（他人 worktree 未触碰）。

## 2. 工程接入 `6fad178`——逐面核验

- **提交形状**：恰 6 文件＝3 接收文件＋`package.json`＋作者记录＋README 索引行（143→144）；`0ff27bb..6fad178` 对 `src/`、`server/`、`src-tauri/`、`runtime/`、`package-lock.json`、其他测试零改动。
- **三 blob 原样**：`git ls-tree` 三 blob 与派发登记及 `6216a6b` 完全同哈希；内容 SHA-256 `2bb552e6…`／`54e1d84c…`／`c593be63…` 与接收记录表格逐一相等；作者记录 md 未接收（`6216a6b` 内两份 Pi 记录不在树中）✓。
- **package 恰一行**：pre-image blob＝`9ab8ee0` 审定 blob `17d3825a`（diff 0）；post-image 唯一差异为第 111 行值末尾追加 ` tests/unit/web-text-intake-test-safety.test.mjs` 恰一次；聚合分解＝`node --test`＋`--test-timeout=20000`×1＋10 路径、无其他参数；原九文件按序在前；107 脚本名集合（含顺序）相等；`dependencies`/`devDependencies` 相等；锁文件零改动；check 链 52 步不变。
- **语法**：三文件 `node --check` exit 0 ×3。
- **缺失引用如实**：四条 II 夹具导入（`backend-process`／`controlled-model`／`db-observer`／`synthetic-inputs`）在树内确缺失、guard `ref.missing` 指向恰此四处；`server/entries/web-backend-entry.mjs` 路径闭合但字节为 MAYNE-23 版 blob `be009408`（≠候选 I `cd08588` 的 `47a9efcd`，已实读两 blob 确认差异真实）；聚合原九文件在树内亦缺失（登记状态不变）；夹具目录恰 2 文件、零占位；测试 `:452`（stub-worker）／`:569`（runtime-entry）引用行实读相符；两夹具自足仅依赖 `node:` 内建。
- **structure 差分（repo 模式重做）**：首次在 `git archive` 无 `.git` 树上跑出的结果对引用扫描无效（守卫以 `git ls-files` 为工作集，archive 树落到上级仓库被 ignore 排除——本审过程教训，如实登记）；改用 `git worktree add --detach` 两棵真树重跑：基线（`308ddc1`）4 条＝003 冻结待候选 I＋3 条 vendor/pi dist 缺失；tip（`6fad178`）8 条＝基线 4 条＋恰 4 条新 `ref.missing` 全指向上述 II 夹具导入；触及接收文件字节或 `package.json` 的违规 0 条；`--self-test` exit 0。**两树均非结构绿，与本审口径一致。**
- **docs**：`check:docs` exit 0，基线 22 文件 574 链接／tip 22 文件 575 链接，与两提交登记逐一相符。
- **边界尊重**：提交未跑聚合／完整 gate／未整树合并，与登记一致；本审同样未跑（聚合九＋II 夹具缺失，本树本就不可运行聚合）。

## 3. 补件 `308ddc1`——SHA／ID／字段核验

- **docs-only**：numstat 恰 2 文件（新记录 36 行＋README 141→143：自行＋补登 `0ff27bb` 行）。
- **原件链条**：经 multica CLI 重下载评论 `01a1c0bc-fd5d` 全部 13 附件（四例 TAP＋五探针 TAP＋六 JSON＋`SHA256SUMS`），对登记 `SHA256SUMS`（`01a1c0bc-fc85`）12 项全部 OK——与补件记录「六份逐字节 OK」一致。
- **脱敏副本**：六份对 `SHA256SUMS-sanitized.txt` 全 OK；六份全哈希与记录表格逐一相等。
- **实际修改字段**（jq -S 归一化后 diff）：R1 两件＝`marker.hostNonce` 值→占位＋新增 `marker.hostNonceVerified:true`＋新增 `sanitization` 块，其余逐字段零差异；R2/R3 四件＝仅新增 `sanitization` 块、证据字段零差异——与「仅替换 hostNonce／R2R3 无 nonce 随套改版」登记一致。
- **替代 ID／原 SHA**：六份 `replacesAttachmentId` 与原附件实际 ID 逐一相等；内嵌 `originalSha256` 与原件实算 SHA-256 逐一相等。
- **nonce 不转载**：两处原 nonce 值在六份副本、清单、`SHA256SUMS-sanitized` 与 `308ddc1` 已提交 docs 内出现均为 0 次。
- **登记产物三值**（`5311ffa3`／`08f32db2`／`9d050fd4`）在六 JSON worker 记录内可核，与清单§2「随副本可核」一致；本审不持有运行树产物副本，不声称产物字节复算（登记与 JSON 为权威载体——与补件口径相同）。

## 4. 布尔来源（派发重点）——逐条独立重算

**事实基座**：R1 原 JSON 内**只有一个** nonce 比较值（`marker.hostNonce`）与一个 `marker.pid`；`run1/run2` worker 记录不含 nonce/pid 字段。故文件内**不存在**第二个 nonce/pid 比较值，三方（marker↔worker.json↔请求帧）相等在今日**不可能**从现存文件重算。

**判定**：脱敏副本的构造恰与该事实相容，未犯派发列出的两种错误——

- `hostNonceVerified:true` 并非重算结论：其 `redactionPolicy` 明文「the value was verified against the run worker.json during the 0ff27bb review and is not re-published」——**引用当时审内断言**（`0ff27bb` 提交文与记录原样可查「marker runId/hostNonce/pid/argv three-way consistent with worker.json」），补件记录亦明写「三方一致系 `0ff27bb` 审内已验事实」。
- 「本日从下载字节重算」的布尔集合＝`sanitization.verifiedComparisons`，逐名核对语义后**全部为文件内可比或对已登记常量可比**（如 `markerRunIdEqualsRun2RunId`、`run2EntryShaEqualsSyntheticFixture`、`markerArgv0EqualsRun2WorkerEntry`、`run2NodeShaEqualsRegisteredNode` 等）；nonce 不在其中；唯一涉 pid 的布尔名为 `markerPidPositiveInteger`（正整数检查，非相等断言——命名如实）。
- **独立重算**：本审以自有脚本从六份副本字节重算全部 37 个 `verifiedComparisons` 布尔（R1 候选 10＋R1 父 10＋R2 候选 5＋R2 父 4＋R3 两树各 4），全部 TRUE、零失配；其中 26 个纯文件内比较、11 个需对照清单§2 登记的 organizer/node/fixture 常量哈希（`externalEntryShaEqualsRegisteredOrganizer` 等）。
- 边界如实：文件内布尔证明的是**副本内部自洽**，不重建运行本身的真实性（仍归 `0ff27bb`＋TAP）；补件自身「删字段不是重新验证，原附件与哈希仍权威」与本审读法一致。
- 脱敏副本继承原件的非 nonce 标识（任务临时路径、`<LOCAL_PATH>` node 路径、pid 57216/57412）未再脱敏——原件已随 `01a1c0bc-fd5d` 在案，副本无新增暴露面；登记为边界观察。

## 5. 临时脚本缺件——事实核查

- `308ddc1` 提交内零脚本字节（docs-only 已证）；清单§4 逐件披露 `esrc-review-probe.mjs`／四例驱动仅存于 `/private/tmp/multica-task-786099651/opencode/mayne24-esrc-review/`、运行末清理、不可恢复。
- 本审核实：该临时目录现不存在（`ls` 报 No such file or directory）；评审时 13 附件计数与本审实际重下载清单一致；未发现任何冒充原脚本的字节。符合「不补造旧件」判据；未来复现属新运行、须新哈希登记（清单原文）。

## 6. 边界与不签范围

- 不作聚合准入、不作 III 正式独审代签、不预签整体准出；GAP-5、E/D、第五例（Pi 线）、s2-client（OpenCode 线）各走原线。
- 运行行为证据仍归 `0ff27bb` 独审及其协调接收；本审只核「接收与载体」面，不重跑、不代签。
- 本记录 docs-only 恰 1 文件（本审者分支惯例：不另动 README 索引）；`check:docs` 结果随提交登记。原始核查输出 gitignored `build/mayne24-esrc-zreview/`（双树 structure/docs 输出、重下载原件与副本、SHA256SUMS、身份），精选输出随评论附件。
- MAYNE-24 保持 `in_progress`。
