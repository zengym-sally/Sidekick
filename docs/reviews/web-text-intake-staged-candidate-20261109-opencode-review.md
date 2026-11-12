# staged 候选不得 surfaced 窄增量独审（OpenCode，2026-11-09）

> 派工来源：评论 `01a1bf8c`（协调锁定前端 `4846e610`／tree `92151ae2`，父 `6e27d1e`；本审者未写该客户端；「分别判源码与 5/5 证据」；「核原字节适配器的列表过滤、三种 mutation 响应拒绝 staged、已发布候选及 runId 应用回归；不要用脚本复刻映射代签生产方法」；「测试 S1 公共读取能返回 staged 的后端必须精确登记，不能当最新 I 行为」；「客户端异常响应防线可用明确标注的私有响应夹具验证；人工种行／改状态不代签真实退出发布链」）。作者 OhMyPi 交付评论 `01a1bf89`。

## 0. 结论

**源码面：通过（限该窄增量四判据面），两条登记项随录（计数面缺口需窄修或裁定、两处注释失实需更正）。5/5 证据面：部分采信——S1/S4/S5 是真实 HTTP 观察成立；S2/S3 是脚本内复刻映射的检查，未触生产字节，其「适配器／被拒绝」措辞与实际证据不符，须更正或由本审的实字节探针替代承载。不签整体准出；未跑完整 gate／19 旅程；MAYNE-24 保持 `in_progress`。**

身份：`4846e610ae1349921a06003a7abe2513ba045857`／tree `92151ae2150a95acc77530236862e609ccd64ada`／父 `6e27d1ed`（tree `eeef6c83`）逐项复核一致；整提交恰三文件（源码 `src/lib/web-api-client.ts` blob `70ea8976` **+47/−11**、记录 `+63/−0`、索引 `+2/−1`），与协调登记逐字节吻合。

## 1. 源码面判据（逐条，静态＋实字节动态）

- **列表过滤 ✓**：`toCandidate` 遇 `staged` 返 `null`（不再改贴 `pending`）；`toCandidateList` 过滤 null 行；`read_import_batch` 改用 `toCandidateList`。类型收窄成立（`WireCandidate.status` 四态 → 内部三态，typecheck 在候选树上 exit 0）。全文件仅 `toCandidateList`/`requirePublished` 两处调用 `toCandidate`，无 null 泄漏路径。
- **三种 mutation 拒绝 staged ✓**：`save_candidate`／`discard_candidate`／`apply_candidate_preview` 三处响应统一走 `requirePublished`，staged 响应抛 `WebApiError('state_conflict', 409)`。实字节 × 私有响应夹具 11/11×2 轮（探针 A）：三条命令逐一实throw、`code/status` 精确；**父字节 `6e27d1e`（blob `d65f6f64`）同一夹具下同响应被改贴为可操作 `pending`**——可证伪性在**实字节两侧**成立，不依赖作者脚本内的复刻映射。
- **已发布候选不误伤 ✓**：pending/accepted/discarded 原样透传（A1 状态保真、A7 三 mutation 负控全部通过）；真实链上退出确认后的候选经适配器照常可见可操作（探针 B R2/R7）。
- **runId 应用回归 ✓**：apply 请求 URL 恒携带冻结 runId 段（A6：`/previews/{runId}/apply`，非 previewId）；真实链端到端——适配器 `revise_candidate` → 终局 → `read_import_batch.previews[0].id`＝revise 任务 id（`tsk_` 前缀）→ `apply_candidate_preview` 成功、候选 version 1→2、标题按修订更新，只读库交叉复核 `candidate_previews.run_id` 与 `candidates.version=2/status='pending'`（探针 B R7，实字节 × 实后端）。此面在作者 5/5 中只有 raw HTTP 观察、无适配器参与，本审补齐。
- **注释校正 ✓**：wire `fields` 注释改为「当前服务域形状、非已批准线上契约、C4 仍开放」——与本审 apply-ID 轮 F2 登记及 `29305da` 服务端实际落库形状（`{atMs,timeZone,localText,precision}`）一致。
- **边界纪律 ✓**：服务端零兼容（未改 `server/`）；客户端防线不替代服务端义务（`ba92104` 已获 `2979afe` 限定通过）；冻结 web-api/1 线型未动。

### 登记项一（真实缺口，需窄修或裁定）：计数面仍统计 staged

`list_import_batches`（同文件，:819-826）用**raw wire 计数**：`total: all.candidates.length`、`pending: pending.candidates.length`。在公共读会泄 staged 的后端上（本审登记的 `29305da` 类构建），`total` 把 staged 行计入——批摘要展示了一个与过滤后详情不一致、且泄露「存在未发布候选」的数字，与本提交自述目标「must never be displayed or acted on」相悖。实字节（A9）与真实线数据（探针 B R3：total=2、可见=1）均实证。合格最新 I（`0536a44` 谱系）上服务端已隐身，此面休眠——但客户端防线存在的意义恰是防泄漏后端。建议同文件窄修（计数改用 `toCandidateList` 或排除 staged），另派处理，不在本增量内代签。

### 登记项二（注释失实，minor）：`toCandidateOrNull` 与单读面

- `toCandidate` 文档注释称「Callers use `toCandidateOrNull`」——该方法不存在，实际是 `toCandidateList`（:671 vs :699）。
- 注释称公共单候选读也「the adapter treats it as a contract violation and returns null」，但 raw `getCandidate()`（/api/candidates/{id} 包装）仍是未映射直通；本提交树内无生产调用方（grep 全树仅定义），实际暴露面只在 `read_import_batch` 与三 mutation——注释超出实际接线，宜更正措辞。

## 2. 5/5 证据面（与源码面分别判）

**附件 CLI 读回**：评论 `01a1bf89` 实挂 4 件（`verify-staged.mjs` `c6273d95…`、`verify-staged-run.txt` `7e93d859…`、`web-api-client-adapted.ts` `5db799b8…`、`SHA256SUMS.txt`），逐件哈希与清单相符；`web-api-client-adapted.ts` 与提交 blob `70ea8976` **逐字节一致**；提交记录 blob `4b7e3a5e…` 与清单 `review-record.md` 行相符。

**采信（真实观察）**：

- **S1**：真实后端、人工种行（构造方式已披露）、停机写行重启后 unfiltered 公共读返回 staged——本审在精确登记的同类构建上独立复现（见 §3 R1，`["pending","staged"]`）。
- **S4**：`getSource` 服务端本就 `status:'pending'` 过滤（`29305da` :485 实读复核），真实链候选在退出确认后可见——成立（「actionable」由其 S5 revise/apply 与本审 R7 承载）。
- **S5**：raw HTTP revise→preview→apply 200、runId=`tsk_`——真实观察成立。

**不采信为适配器证据（须更正措辞或由本审替代承载）**：

- **S2/S3 是复刻映射检查**：`verify-staged.mjs:61-63` 自注「Re-derive the client's mapping exactly as implemented」，在脚本内重写 `toCandidate`/`toCandidateList` 并对同一行求值——全程未 import 生产 `web-api-client.ts`。S3 的「旧行为会 surface 成 pending」也在复刻上求值。这恰是派工点名不得用于代签生产方法的形态。而其记录 §5 把 S2 写作「**适配器**把 staged 行过滤出列表」、S3 写作「staged 行**被拒绝**为契约违例」——未披露复刻性质，证据措辞超出实测面。本审探针 A（实字节 × 明确标注的私有响应夹具）与探针 B（实字节 × 实后端）已在生产字节上覆盖同两面，作者的 S2/S3 只保留「意图与差异方向」的参考价值。
- **S3 在真实后端上的实际行为登记**：staged 行上的三 mutation 在既有 I 构建上由**服务端栅栏**先行拒绝（`text-intake-service` :519/:547/:616 `stateConflict('仅待核对候选可…')`，探针 B R4-R6 实测 409）——`requirePublished` 在真实链上不可达，其防线价值只在「mutation 响应含 staged」的异常服务端形态下兑现（私有夹具面，已按派工授权验证）。

**登记缺口**：

1. `admission.json` 列于记录 §7 与 SHA256SUMS（`7bda5a23…`），但**未实际挂载**（CLI 读回恰 4 件）——准入登记不可读回。
2. **5/5 所用后端构建身份全记录未登记**：脚本从 cwd 引 `build/web-backend/{server,bin}`＋`build/s0-runtime`，不锁哈希；记录 §5 无 entry/blob/二进制/runtime 身份。协调「S1 后端必须精确登记」的要求在作者记录中未满足——本审按 §3 自行登记承载。
3. 「三连跑稳定」仅附一轮原始输出。

## 3. S1 后端精确登记（本审独立验证所用的构建身份）

**窗口构建（公共读可返回 staged——非最新 I 行为）**：`29305da`（错误帧收口＋C4 日期点之后、`ba92104` 服务端隐身之前）。detached 树构建：

- entry `5a799cdb…` ≡ `git show 29305da:server/entries/web-backend-entry.mjs`；`text-intake-service.mjs` `85212b72…` ≡ 同树 blob（`listCandidates` 无默认 staged 排除，仅显式 status 过滤，:453-467 实读）。
- 存储二进制 `5311ffa3d3d26e19…232bd`（2647984 B）——rustc **1.99.1**（`58cf8f9c3`，aarch64-apple-darwin）下与既有登记相符的工具链漂移身份；两树构建同哈希（`src-tauri/` 在 `29305da`↔`0536a44` 间零差异）。
- 随包 runtime：organizer `08f32db2…911a7`、node `9d050fd4…588a`——与既往登记逐字节一致。
- Node v24.20.0；controlled-model 夹具取自同树（`queueExtractAnswer`/`reviseAnswer`，输入文本含 `合成整理输入标记`＋`下周五` 逐字子串以过真实校验）。

**边界构建（合格最新 I 谱系）**：`0536a44`（`ba92104`＋`6caba12`＋`c7cc116`，Hermes `2979afe` 限定通过）。`text-intake-service.mjs` `0dc3424f…` ≡ 同树 blob：`listCandidates` 默认与显式过滤均排除 staged、显式 `status=staged` 400（:453-465 实读）。同二进制、同 runtime。

**边界实测（探针 B R8/R9）**：运行期采样×N＋终局列表 0 staged；显式 staged 过滤 400；任务 succeeded 后真实候选 `pending` 可见；适配器防线休眠且无害（`read_import_batch` 正常返回）。**结论：作者 S1 与本审 R1 的「公共读返回 staged」是窗口构建（pre-`ba92104`）的登记行为，不是最新 I 行为；在合格最新 I 上该前提不复现。**

## 4. 本审独立验证（可复跑）

探针 A `probe-adapter-faces.mjs`（实字节 × 私有响应夹具，仅 Node 内置＋加载提交 blob）：**11/11 ×2 轮**——A1 列表过滤＋状态保真、A2 缺字段鲁棒、A3-A5 三 mutation staged 拒绝、A6 runId 段保真、A7 三 mutation published 负控、A8 父字节同夹具 surface 为 pending（实字节可证伪）、A9 计数面缺口实证。

探针 B `probe-backend-faces.mjs`（实字节 × 两实后端构建）：**7/7 ×2 轮**——R1 窗口登记（种行披露）、R2 适配器过滤＋真实链候选可见、R3 计数面线数据实证、R4-R6 三 mutation 服务端栅栏 409、R7 runId apply 全链回归（version 1→2＋库内复核）、R8 隐身边界、R9 防线休眠无害。R7 的发布候选来自真实链退出确认（**无人工改状态**）；种行仅用于窗口面且明确标注。

`npm run typecheck` 于候选树 `4846e610` 实跑 **exit 0**。未跑完整 `npm run check`（III 集成轮）、未跑 19 旅程；未触真实模型／凭据／用户根（合成引用仅指 loopback 受控服务）；两临时根运行后删除、无本树进程残留。

## 5. 边界与后继

- 本审不签：整体准出、计数面窄修（需另派）、作者记录/证据更正（措辞与补件由作者或协调裁定）、最终独立浏览器验收（另派）、C4 候选日期与显式 `sourceAt`（保持开放）、`097127d`/`ed8f0e4` 等更新增量（未在锁定范围）。
- 人工种行／`getSource` 观察不代签真实退出发布链；真实退出链由 R7 无改状态的真实链承载。
- 评审记录已提交本人分支（docs-only）；探针脚本、两轮结果 JSON、身份清单与 SHA256SUMS 随评论附件交付。
