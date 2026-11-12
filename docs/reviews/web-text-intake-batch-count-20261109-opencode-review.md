# batch-count 窄增量独审（OpenCode，2026-11-09）

> 派工来源：评论 `01a1bfd2`（协调层：独审 `5255c1c` 的计数／注释窄增量及旧证据更正；原字节适配器核四项前后对照；不重跑 19 旅程／完整 gate）。评审对象：`agent/ohmypi/mayne-24` 分支提交 `5255c1c`，作者 OhMyPi，交付评论 `01a1bfc9`（4 附件）。本审者未写该客户端。MAYNE-24 保持 `in_progress`。

## 0. 结论

**窄增量面：通过。** 旧证据更正面：通过与本人 `bf81826` 登记逐字吻合。四项前后对照在**两套原字节**上独立复跑成立（收口前恰 1 红、失败值 `total got 3`；收口后 4/4）。两条非阻断 nit 随录。不签：整体准出、最终浏览器验收、F1 线型修正（`090872a`，Hermes 范围）。

身份逐项复核：`5255c1c`／tree `e0845413c316d1032026685ff382860a860a3c1c`／父 `125280d`（tree `d2028221c7839de6e87f0b99ddf01e1b6f31a040`＝Hermes F2/F3 锁定值）一致；整提交恰 4 文件（README +3/−2、batch-count 记录新增 +95、staged 记录 +37/−0、`src/lib/web-api-client.ts` +20/−4）；源码 blob `c28227a5d66e`→`f3e956edace9`，`ModelSettingsPanel.vue` `0216921e5e13` 两侧行未动，与记录 §四逐字节吻合；声明谱系 `b29afdc`／`4c98309`／`6e27d1e`／`4846e61`／`125280d` 全部 `merge-base --is-ancestor` 通过。范围注记：该分支是前端增量分支，不是集成后的完整 I（协调层提示照办）；分支顶端 `090872a`（F1 线型修正 +33/−9）不在本审。

## 1. 四项前后对照（原字节独立复跑）

本审从对象库提取两套字节到独立 scratch 树（`125280d` 收口前／`5255c1c` 收口后），挂作者脚本**逐字节副本**（CLI 读回 `253d94a0…`，与提交无转录），Node v24.20.0 原生 type-stripping 直载真实 `WebApiClient`：

- 脚本审计：真实 `asBackend()` 驱动；夹具为明确标注的私有响应 fixture，按客户端真实构造的请求 URL 匹配（无形状漂移）；4 项断言与记录 §三表格一一对应。
- **收口前（`125280d` 字节）：4 项 3 绿 1 红**，唯一失败正是派工登记的计数缺口：`total must count the visible set, got 3`（期望 2）——与作者 `verify-prefix.txt` 及 checks.txt 的 PRE 3+1 一致。
- **收口后（`5255c1c` 字节）：4/4，exit 0**——与作者 POST 4/4 一致。
- 四项即：(1) `total`＝可见集合 2 非 raw 行数 3、`pending`＝1、`total ≥ pending`（前后对照恰此一项翻绿）；(2) `read_import_batch` 只显示可见候选、`accepted` 保留 `acceptedTodoId`（两侧均绿）；(3) staged mutation 仍被 `state_conflict` 拒绝（两侧均绿）；(4) raw `getCandidate()` 未映射直通保留 runId／status（两侧均绿）。

提取字节内容 SHA-256：收口后 `6b3426072ea1d6489bdb42f56ceab3faf5fd4ba8fa8fb120b4b5cdbfc455ab2a`；收口前 `a0c8be399071bd9a053a92b95778e9076aa46e1f3ab080038fe05d186f84a1d0`。原始输出随 `build/mayne24-batch-count-review/r1/replay-{post,pre}.txt` 留档。

## 2. 源码面判据（逐条对代码核）

- **计数修法 ✓**：`list_import_batches`（:846）改 `const visible = this.toCandidateList(all.candidates ?? [])`（:858），`total: visible.length`、`pending` 显式按 `c.status === 'pending'` 过滤计数（:860，防服务端未正确执行 `?status=pending` 的纵深防御）。`status` 派生（`succeededRunId ? 'succeeded' : 'imported'`）与 runId 路径未动。计数即可见集合（pending+accepted+discarded 经映射行），staged 永不进入；`total ≥ pending` 不变式成立（探针断言）。
- **注释更正 ✓（精确）**：收口前字节中 `toCandidateOrNull` 全文件恰出现 1 次——只在失实注释里，该符号不存在；真实符号 `toCandidateList` 收口前即在 :721/:868。BOUNDARY 段（:694a）逐句对代码核验：raw `getCandidate`（:474）确为薄直通、原样返回 `WireCandidate`、不做状态判断；staged 拒绝只在 `asBackend()` case shim——`save_candidate`／`discard_candidate`／`apply_candidate_preview`（:920/:932/:941）统一经 `requirePublished`（:743，映射 null → `WebApiError('state_conflict', 409)`）；`read_import_batch`（:884）经 `toCandidateList`。**raw API 契约未改**（签名、返回类型、路径均未动，收口前后 diff 仅 4 hunk 全在上述两处）。

## 3. 旧证据更正面（docs-only，与 bf81826 登记对照）

`5255c1c` 恰是本人 `bf81826` 两条登记项＋证据面更正要求的落地，逐项核对：

- **登记项一（计数缺口）→ 修法同处方**：`bf81826` 建议「计数改用 `toCandidateList` 或排除 staged」，本次即按可见集合计数实现，并经 §1 双侧字节复跑证明。
- **登记项二（`toCandidateOrNull` 失实＋raw 单读直通）→ 更正精确**：见 §2。
- **S2/S3 非适配器证据 → §8 原文吻合**：`verify-staged.mjs:61-63` 脚本内复刻映射、全程未 import 生产客户端——与 `bf81826` §2 判定逐字一致；改由本审实字节 11/11×2 与真实链 7/7×2 承载，引用正确。
- **S1 窗口构建登记 → 身份逐字一致**：`29305da` entry `5a799cdb`／service `85212b72`／存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2647984 B）／rustc 1.99.1 `58cf8f9c3`；边界 `0536a44` service `0dc3424f`；`ba92104` 后服务端隐身——全部与 `bf81826` §3 自登记逐位相符，「不得倒写成最新 I 行为」措辞正确。
- **附件缺口披露 → 三项俱全**：`admission.json` 列而未挂、「三连跑」仅一轮原始输出、后端构建身份当时未登记——照录不改写。
- **留档纪律 ✓**：staged 记录 diff 内容删除行 0（纯追加，§8 不改写上文）；旧 `42af54b5…` 记录按原产物保留不追改；README 索引行只加注不改结论。
- **README**：标题 135→136、恰加 1 行（batch-count 记录），行文与 §8 一致。该分支标题数与实际行数的漂移在父提交即已存在（父 129 行／标题 135），非本提交引入；集成时由 III 统一核对。

## 4. 采信边界与未签面

- 作者自证检查（checks.txt）**未在本树复跑**（树态不同避免噪声）：typecheck exit 0、check:docs 21 文件 524 链接、check:structure 194 项全为预先存在（改动文件 0 项）、repo 单测含 s2-client 34/1（预先存在 Tauri 迟到取消路径）。本审侧：4/4 复跑已证明候选 TS 可被 Node 解析并运行（运行期语法面）；类型检查以作者登记为准。
- 本审**不签**：整体准出、最终独立浏览器验收、C4 候选日期、F1 线型修正（`090872a`，Hermes）、服务端暴露面（客户端防线不替代服务端义务，`ba92104`/`2979afe` 服务端面维持原判）。
- 按派工：未重跑 19 旅程、未跑完整 gate。

## 5. 登记 nit（非阻断）

1. `verify-batch-count.mjs:44-47` 有一段重复的不可达 guard/return（一次性证据脚本，装饰性）。
2. 本人 `a054244` 加索引行时漏改标题计数（135→应 136）——本轮随本记录一并更正（自登不讳）。
3. README 索引仍是 III 集中登记面；本轮作者行按既有实践接收（`4846e61`/`bf81826` 先例），集成时 III 统一核对。

## 6. 证据

`build/mayne24-batch-count-review/r1/`（gitignored）：`admission.json`、`verification.log`（全部命令与结果）、`replay-post.txt`／`replay-pre.txt`（原字节复跑原始输出）、`downloads/`（作者 4 附件逐字节）、`pre/`／`post/` scratch 树（对象库提取字节＋脚本副本）。哈希清单随 `SHA256SUMS.txt`。
