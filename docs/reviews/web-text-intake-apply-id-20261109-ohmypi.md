# apply ID 修复与 A/B/C 证据重建（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1bef1`（「单独修 apply ID：冻结 URL 要的是 `runId`，前端从 `WirePreview.runId` 贯通视图／store／请求，不能拿 `previewId` 替代，服务端不加别名兼容……重建必要 C 段证据，实际点击后须核候选版本／字段更新，不能把点击发生算应用成功。A2/A3/B1 仍按原预算取证：先证明受控应答门控真实命中、五次提交未等待前一任务结束，再判并发形状」）。
> fresh run tag：`20261109T074216Z`，**19/19 通过，0 旅程超 20s 预算**。

## 1. 范围

仅 `src/lib/web-api-client.ts` 一个文件，+55/−12。未改生产、未改其余前端、未改测试／package／DDL／Runtime／守卫。**不与已冻结五文件配置修订 `7f3322b` 混写**（本提交在其之后单独成篇）。

## 2. 修复一：apply ID 贯通 `WirePreview.runId`

**缺陷**：`toPreviewRun` 置 `id: preview.previewId`（`prev_…`），`organizer.apply` 把 `preview.id` 当 URL 的 runId 段发出；而服务端 `candidate_previews.run_id` 存的是 **revise 任务 id**（`tsk_…`，`text-intake-service.mjs:780` 用 `taskId`）。`applyPreview` 按 `WHERE candidate_id=? AND run_id=?` 查询（`:499-503`）永不命中 → `candidate_not_found: 预览不存在。`

**修复**：`id: preview.runId`。`WirePreview` 同时携带 `previewId`（预览实体）与 `runId`（该 revise 任务），冻结 URL 要的是后者；预览即该 revise 任务的 run，故 runId 同时也是正确的列表键（`v-for :key` 与 `acceptRun` 的 `knownRuns` 均不受影响）。**服务端未加别名兼容**。

**贯通链（源码行）**：视图 `@click="apply(preview.id)"`（`CandidateCard.vue`）→ store `runId: preview.id`（`organizer.ts:60`）→ `asBackend()` 的 `apply_candidate_preview` 分支取 `args.runId`（`web-api-client.ts:788`）→ `applyPreview(candidateId, runId, …)` → `POST /api/candidates/{candidateId}/previews/{runId}/apply`。实测请求 URL 为 `…/previews/tsk_e8918de9…/apply`（`tsk_` 前缀，即任务 id），响应 **200**。

## 3. 修复二：候选线型平铺映射（§5.1）

排查 C6 时发现**第二个真实缺陷**（与 apply ID 独立）：生产 `rowToCandidate`（`text-intake-service.mjs:208-226`）发出**平铺**候选行——`fields`/`evidence`/`dueExpression`/`followupExpression`/`warnings`/`unresolved` 均在候选对象顶层；而客户端 `WireCandidate` 期望它们嵌套在 `draft` 下。后果：`toCandidate` 透传的 `draft` 为 `undefined`，`CandidateCard` 渲染即抛 `Cannot read properties of undefined (reading 'fields')`，**候选卡片根本不渲染**（页面只显示原文依据与签收条）。这是此前 C3/C5/C6 全红的直接原因之一。

**修复**：`WireCandidate` 改为冻结平铺形状；`toCandidate` 在适配器内组装内部 `Candidate.draft`。`fields` 在线型上本就是内部 domain `TimePoint`（`{atMs,timeZone,localText,precision}`），故读路径无需日期转换。`staged` 是线型独有状态（结果已暂存、退出确认尚未发布），内部模型无此态，映射为 `pending`（控件唯一可作用态）。

**预览行不对称**：生产预览行（`text-intake-service.mjs:388-402`）**仍嵌套** `draft`，故 `WirePreview` 保留 `draft` 嵌套、`toPreviewRun` 透传不变——两处形状不同，分别按生产实测登记，未强行统一。

## 4. A/B/C 证据重建（19/19）

| # | 断言 | 结果 | 耗时 |
|---|---|---|---|
| — | 配对闸（同源身份） | **PASS** | 2805ms |
| — | capture entry 就绪 | **PASS** | 2108ms |
| A1 | 页面连续提交五个任务 | **PASS** | 6309ms |
| A0 | **受控应答门控真实命中**（慢答案确被服务） | **PASS** | 6310ms |
| A-gap | **五次提交未等待前一任务**（最大点击间隔 2767ms ≪ 8s 应答延迟） | **PASS** | 6310ms |
| A2 | **调度器跑满冻结 3 并发**（峰值 running=3） | **PASS** | 6310ms |
| A3 | 页面队列面板列出活动任务 | **PASS** | 2ms |
| B1 | 页面逐任务取消 ×5 | **PASS** | 10111ms |
| B2 | 取消后队列前进至空 | **PASS** | 10111ms |
| B3 | 面板报告队列已排空 | **PASS** | 1ms |
| C1 | 队列排空后再提交 | **PASS** | 1858ms |
| C2 | 候选出现在产品待确认区 | **PASS** | 6ms |
| C3 | 页面请求自然语言修改预览 | **PASS** | 1414ms |
| C3b | 预览任务 succeeded 且 preview 实体可见 | **PASS** | 1210ms |
| C4 | 预览前后候选不变 | **PASS** | 2ms |
| C5 | **真实点击**「应用到候选」并发出 apply 请求（200） | **PASS** | 5513ms |
| C6 | **候选仅在应用后改变**（version 1→2、title 变更、fields 更新） | **PASS** | 3ms |
| D1 | 同合成根重启后来源保留 | **PASS** | 4020ms |
| D2 | 只读库互证 | **PASS** | 1ms |

**并发形状实测**（A2，提交过程逐次采样）：`0/1 → 1/1 → 2/1 → 3/1 → 3/2`——第 5 次提交后恰为 **3 running / 2 queued**，即冻结形状；此前几轮只观测到 running=1/2，是因为慢答案 8s 而点击间隔约 3.7s，槽位随任务完成而释放。本轮点击间隔 258ms／2765ms 交替，恰好把五个人压在慢答案窗口内，故同时见到 3 运行与 2 排队。

**A0／A-gap 的归因证明**（派工点名要求）：A0 用「慢脚本安装前后模型请求数变化」证明门控真实命中（79 → 82）；A-gap 用逐次点击时间戳的最大间隔（2767ms）证明提交未等待前一任务（8s 应答延迟下若等待，间隔应 ≥8s）。二者合起来才可判并发形状，而非仅凭 running=1 归因调度缺陷。

**C6 的应用后变更**（实测）：`before {v:1, t:整理合成队列输入}` → `afterApply {v:2, t:提交SDK鉴权修复并请我验收（修订）, fields:{…due:{atMs:1795564800000, timeZone:"UTC", localText:"11月25日", precision:"day"}…}}`；apply 请求 URL 为 `…/candidates/cand_6617910e…/previews/tsk_e8918de9…/apply`，响应 200；直读库内该候选行 `version=2`、`status=pending`。**点击发生不算应用成功**——C5 与 C6 分列，C6 必须见到版本／字段真实变更。

**B1 的五次取消**：本轮 5/5 成功（前几轮后两次无按钮可点，因队列已空；本轮五个人仍在队列中故可逐一点击）。

## 5. 边界

- 只改一个文件；未改生产、未改其余前端、未改测试／package／DDL／Runtime／守卫；未跑完整 `npm run check`。
- 默认生产 worker 路径（不传 `workerProcessFactory`），真实 bundled Pi 实际运行（本轮 **86 次模型请求**）；模型面用 II 套件已验证的 loopback 受控模型服务。
- 逐旅程 20s 含清理；**0 旅程超预算**（最长 B1/B2 10111ms）。
- 旧 13/17 与旧 14/14 均**作废**（彼时真实 Pi 未执行／25s 常量超预算／候选卡片因线型缺陷根本不渲染）。
- 最终版独立浏览器验收仍由未写生产者承担。

## 6. 证据

- 附件：`verify-apply.mjs`（自包含 harness，仅 Node 内置模块＋II 受控模型夹具）、`verify-apply-run.txt`（完整 19/19 实跑）、`result.json`（结构化结果含 shape／gaps／逐条 elapsedMs／超预算清单）、`network.jsonl`（页面发出的 API 请求与响应状态）、`journeyC.png`、`model-requests-sanitised.jsonl`、`web-api-client-adapted.ts`（适配后全文）、`admission.json`、`SHA256SUMS.txt`。
- 脱敏声明：模型请求记录只含 `hasAuthorization` 与 `authorizationLength`（夹具固有），无秘密值；绝对路径替换为 `<WORKTREE>` 并声明；harness 内合成凭据值替换为 `<SYNTHETIC_CREDENTIAL>` 占位。
