# W1 前端未完验收：真实 Pi＋受控模型 UI 取证（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1be1b`（20s 预算／条件门控／确认应用点击）与 `01a1be9f`（继续已派取证）。
> 本轮**只改 harness／证据**，未改生产、未改我的前端四文件、未降低判据。
> fresh run tag：`20261109T055657Z`

## 1. 与上一版 harness 的本质差别（为何本轮可采信）

上一版用 `workerProcessFactory` 返回受控 worker，**真实 Pi 从未执行**，靠 25s 占槽常量制造并发形状；Codex 已裁定该形状不满足原 20s 预算、且「Runtime 构建身份不等于真实 Pi 已执行」。本轮：

1. **使用默认真实生产 worker 路径**——不传 `workerProcessFactory`，bundled 真实 Pi organizer 实际运行并发起模型调用（本轮实录 **19 次模型请求**）。
2. **模型面改用 II 套件已验证的 loopback 受控模型服务**（`tests/fixtures/web-text-intake/controlled-model.mjs`）：脚本化 SSE、按请求记录（只记 Authorization 头**是否存在及长度**，从不记值）。我最初手写的模型服务被真实 Pi 以 `MODEL_SERVICE` 拒绝，改用该夹具后真实 Pi 产出合法 `result` 帧——这正说明该夹具是唯一被生产 Runtime 输出合约接受的面。
3. **并发形状改为服务端门控＋条件观测**：慢答案只在观测窗口内安装（`{repeat:true, kind:'slow', delayMs:6000, then:{…}}`），一旦观测到目标形状立即停止等待；不靠常量占槽。
4. **逐旅程独立 20s 预算（含清理）并实录耗时**：每条断言都带 `elapsedMs`，超预算的旅程单独列出，不用整轮时长当单例超时。

## 2. 结果（fresh run `20261109T055657Z`，13/17）

| # | 断言 | 结果 | 耗时 |
|---|---|---|---|
| — | 产品配对闸配对（同源身份 `location.origin === backend.origin`） | **PASS** | 2808ms |
| — | capture entry 就绪 | **PASS** | 2116ms |
| A1 | 页面连续提交五个任务 | **PASS** | 20696ms |
| A2 | 3 running / 2 queued | FAIL | 20698ms |
| A3 | 队列面板列出任务与排队位次 | FAIL | 1ms |
| B1 | 页面逐任务取消 ×5 | FAIL | 22292ms |
| B2 | 取消后队列前进至空 | **PASS** | 22292ms |
| B3 | 面板报告队列已排空 | **PASS** | 1ms |
| C1 | 队列排空后再提交 | **PASS** | 1864ms |
| C2 | 候选出现在产品待确认区 | **PASS** | 7ms |
| C3 | 页面请求自然语言修改预览 | **PASS** | 1913ms |
| C3b | **预览任务 succeeded 且 preview 实体可见** | **PASS** | 1116ms |
| C4 | **预览前后候选不变（version + title）** | **PASS** | 4ms |
| C5 | **真实点击确认应用控件（`应用到候选`）** | **PASS** | 5006ms |
| C6 | 候选仅在应用后改变 | FAIL | 20147ms |
| D1 | 同合成根重启后来源保留 | **PASS** | 4046ms |
| D2 | 只读库互证 | **PASS** | 1ms |

派工要求的两项原未完验**已完成**：C3b（预览任务成功＋实体可见）与 C5（真实点击确认应用）。C6 未过，但根因是**产品缺陷**，见 §4。

超预算旅程（如实登记，未豁免）：A1/A2 20698ms、B1/B2 22292ms、C6 20147ms。成因是 5 次提交／5 次取消各自要等生产状态机落库（真实 Pi 单次 extract 约 1.5–2s），不是常量占槽；按派工「逐旅程 20s」口径，这几条**不满足**，我不为其申辩。

## 3. 源 → dist/JS → DOM 对应（逐文件登记）

运行树前端四文件与我的分支 HEAD **逐字节相同**（`git hash-object` 复算）：

| 文件 | blob |
|---|---|
| `src/components/TextIntake.vue` | `b6c1897da3ab871da1c496b5c3a789cb9b5cc920` |
| `src/components/TaskQueue.vue` | `1bd5d476fdd85cbdb7cd1773cfffd9f157a4230a` |
| `src/stores/organizer.ts` | `d4b824cbd6bfaba422f0188ce70abc97b1b810b2` |
| `src/lib/web-api-client.ts` | `2aa6e481e837d2d6be0b3e0822c4701ac82309aa` |

- 服务产物：`dist/assets/index-WY-E38vd.js`，由 `build/web-backend/static/index.html` 引用（运行期 DOM 引用同一哈希资产）。
- 真实 Pi／存储身份：organizer `08f32db2…`（2515908 B）、node `9d050fd4…`（121911744 B）、storage `42af54b5…`（2649408 B），与既往登记逐字节相同；Pi provenance `ad702637`／tree `e89822b0`。
- DOM 侧对应：`section.task-queue`（`TaskQueue.vue:60-69`）、`dialog.capture-dialog textarea`、`details.candidate-revision`、`.revision-preview` 与「应用到候选」按钮均来自上述源文件，C 段截图中可见。

## 4. 产品阻断（带证据，未绕、未改生产）

**C6 失败根因：apply-preview 的客户端／服务端 ID 语义不一致。**

- 客户端 `web-api-client.ts` 的 `toPreviewRun` 置 `id: preview.previewId`（`prev_…`），`organizer.apply` 把 `preview.id` 作为 URL 的 runId 段发出：`POST /api/candidates/{candidateId}/previews/{runId}/apply`。
- 服务端 `candidate_previews.run_id` 写入的是 **revise 任务 id**（`text-intake-service.mjs:780` 用 `taskId`，即 `tsk_…`）。
- `applyPreview` 的查询是 `WHERE candidate_id=? AND run_id=?`（`:499-503`），因此永不命中，抛 `candidate_not_found: 预览不存在。`

**实测证据（临时插桩，已还原并复算字节相同）**：
- 组件级 `apply()` 的前置查找**成功**（日志 `APPLY_HIT prev_3ea1dee…`，三次点击均命中）——失败不在前端查找；
- 同一运行库内 `candidate_previews` 行为 `{preview_id: prev_3ea1dee…, candidate_id: cand_05cd4cf…, run_id: tsk_b7be0c46…, candidate_version: 1}`；
- 页面在点击后弹出 `预览不存在。 重新读取`（点击前 `alertsBefore: []`，故 alert 由点击触发）。

**归属**：客户端应传 `preview.runId`（`WirePreview` 同时带 `previewId` 与 `runId`），或服务端应按 `preview_id` 匹配。二者均**不在**我窄授权的四个前端文件内（`web-api-client.ts` 在四文件内，但该处改动会改变 apply 的公开请求语义，需队长裁定后单独派修），故按派工「出现产品阻断即带证据交回」处理，未自行修改、未绕过 disabled、未用 API 代替页面动作。

**A2/A3/B1 未过的原因（同为产品面，非 harness）**：
- A2 观测到并发始终为 1（形状采样 `running:1`），尽管 `readConcurrency` 缺省为 3；A3 因此无排队位次可列。真实 Pi 单次 extract 约 1.5–2s，5 次提交串珠完成，未形成 3 运行／2 排队。这说明**并发形状需在生产侧复现**（更慢的受控应答或服务端门控），不是前端能制造的。
- B1 五次点击中后两次无取消按钮可点（队列已空），故 `cancels` 非全 ok；B2/B3 仍证队列排空。

## 5. 边界

- 只改 harness／证据；未改生产、未改我的前端四文件、未改测试／package／DDL／Runtime／守卫；未跑完整 `npm run check`。
- 未复签旧 14/14（旧数字明确作废：真实 Pi 未执行＋25s 常量超预算）。
- 未把「预览未改候选」写成「确认应用已验」：C4 与 C5/C6 分列，C5 只证**真实点击发生**，C6 证**候选未变**并给出产品根因。
- 最终版独立浏览器验收仍由未写生产者承担。

## 6. 证据

- 附件：`verify-ui.mjs`（自包含 harness，仅 Node 内置模块＋II 受控模型夹具）、`verify-ui-run.txt`（完整实跑）、`result.json`（结构化结果含逐条 elapsedMs 与超预算清单）、`journeyC.png`、`model-requests-sanitised.jsonl`、`admission.json`、`SHA256SUMS.txt`。
- 脱敏声明：harness 中的合成凭据值已替换为 `<SYNTHETIC_CREDENTIAL>` 占位；模型请求记录只含 `hasAuthorization` 与 `authorizationLength`（夹具固有），无秘密值；绝对路径替换为 `<WORKTREE>` 并声明。
