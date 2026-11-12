# W1 前端四文件增量独审记录（OpenCode，2026-11-09）

- 工单：MAYNE-24（`01a1b046-9c0d-7515-a447-69ace095580c`）；派发：评论 `01a1bd8f-58ab-7d15-97c8-aea49c443521`。
- 评审者：OpenCode（III 成员，但未写四个前端文件、未写 I 后端、未写任何相关测试，具备独立性）。
- 对象：前端候选 `76f44e770487f812525b2c8f74215f9c179d9010`（tree `374ef2a5231bfaf9ea9996aba9d8f2c5f032a067`，父 `dc83b341e063c14e9a3f9e30480c5314ec86c30d`）；收口 `95801d3b84d0f4f162e40f4a64654138749ee77b`（tree `609cb40a7fcd670cc1cc8dc70cb0b467dbd51af9`）。
- 基点：冻结 I 候选 `d79b1f69d242081bee1657a2247ef6b2d28740e4`（tree `8324c0b2837e0bb0119f0222f01595e5b1ae232a`）。
- 范围：按派发**仅限四文件相对冻结基点的实际差异**（`src/components/TextIntake.vue`、`src/components/TaskQueue.vue`、`src/stores/organizer.ts`、`src/lib/web-api-client.ts`），不整分支合入；本记录为只读评审，评审者在自树零候选字节改动。
- 索引：按派发本轮不写公共索引，由 III 集成时统一登记。

## 1. 结论

**代码面（限定上述四文件差异）：通过（PASS，限定范围）。** 两处 hunk 与派发复算完全一致，实现正确满足冻结行为契约「文本提交只在本次请求发出期间受 starting／输入有效性限制；已有后端任务活动不阻止继续提交」；三份核对点（starting 在飞门、多任务权威读回／取消、单 run 选择不丢结果）在四文件字节上均无缺陷、无结果丢失路径。

**浏览器证据：本轮不签署。** CLI 实际读回交付评论 `01a1bd8d` 的 `attachments=[]`（无脚本／输入／日志／DOM／截图／哈希可核），且作者所述 14/14 旅程与**交付树自身字节**结构性不符（见 §5 F-2）——在披露补件并按真实运行树范围重交之前，浏览器证据保持未签。本结论不以 d79 后端已知缺陷给前端代签，也不把「预览未改候选」写成「确认应用已验」。

## 2. 身份复算（本机对象库实测，非采信自述）

| 项目 | 结果 |
|---|---|
| `76f44e7` commit 头 | tree `374ef2a5…`、parent `dc83b341e063…`、与派发登记逐字节一致 |
| `95801d3` commit 头 | parent `76f44e7`、tree `609cb40a…`，恰两 docs 文件 |
| `d79b1f6` commit 头 | tree `8324c0b2…`（冻结 I 候选） |
| `TaskQueue.vue` blob | `1bd5d476fdd85cbdb7cd1773cfffd9f157a4230a`，两树**逐字节相同** |
| `organizer.ts` blob | `d4b824cbd6bfaba422f0188ce70abc97b1b810b2`，两树**逐字节相同** |
| `web-api-client.ts` blob | `2aa6e481e837d2d6be0b3e0822c4701ac82309aa`，两树**逐字节相同** |
| `TextIntake.vue` blob | `1816420fef71…` → `b6c1897da3ab…`，恰 2 行改动（+2/−2，两处 hunk） |

两树整树 diff 共 30 个文件（含 server/、src-tauri/、其余前端文件）——这是**分支基座差**（OhMyPi 分支父链 `dc83b341←3f5877d8` 未携带 I 候选的多份文件），不是本次前端增量的内容；按派发「按此实际差异审查，不整分支合入」处理，整树差集登记为集成注意事项（§5 F-4）。

## 3. 差异审查（两处 hunk，均在 `TextIntake.vue`）

1. `submit()` 入口早退守卫**新增** `organizer.starting||`：`if(organizer.starting||!model.ready||model.saving||!settings.ready||…||!agents.states.organizer.ready)return;`。正确：`starting` 由 store 的 `start()` 进入时同步置位、`finally{if(request===startGeneration)starting.value=false}` 按 startGeneration 键控释放——只有最新在飞请求能落闸，异常路径（catch 重抛后 finally）也会释放，无卡死路径；并发自它之后被同步阻断（提交→`organize`→`start` 同步置位早于任何 await），单飞语义保持。
2. 提交按钮 `SkButton :disabled` **移除** `organizer.running||`（保留 `organizer.starting||!model.ready||model.saving||…`）。正确：`organizer.running` 是**当前跟踪 run**（`run.value`）的 `isRunning`（queued|running），任何后端任务活动都会让它为真——这正是 e84 诊断「页面无法提交第二个任务」的根因；移除后满足「已有后端任务活动不阻止继续提交」。

**SkFieldset 归因更正确认**：`SkFieldset :disabled` 在冻结基点 `d79b1f6` 就已是 `organizer.starting||!settings.ready||settings.loading||settings.saving`（diff 两侧逐字相同，本 hunk 未触碰）——队长对作者的更正（「fieldset 原本已仅受 starting 等限制，实际解除的是提交按钮上的 running 门」）经字节核对**成立**。

**签名与语义保持**：store 导出面、`operationId` 重试语义（`submitSource/requestRevision` 每次新 operationId、签收/应用/丢弃原样透传）、来源／候选读回面全部未被两处 hunk 触碰；改动为布尔表达式级，类型中性（`starting` 为已导出的 `Ref<boolean>`）。四文件之外的既有 `organizer.running` 使用点（CandidateCard 修改预览按钮、InboxView 重试/进行中指示、ModelSettingsPanel 测试连接）未被本差异触碰，行为不变。

## 4. 三个核对点（四文件字节内）

1. **starting 在飞门**：如 §3-1，成立。组件守卫与 store 释放键控（startGeneration/selectionGeneration 双代际校验）配合，过期响应不会误落/误开闸（`start()` 中 `request!==startGeneration||selection!==selectionGeneration` 时直接返回不写 `run.value`）。
2. **多任务权威读回／取消**：`TaskQueue.vue` 经 `client.listTasks(undefined,undefined,100)` 读权威 HTTP 队列，仅呈现 `queued|running|cancelling`，逐任务取消 `client.cancelTask(task.taskId, task.version)` 带**版本前置条件**，取消后与 1s 轮询均以读回为准，失败仅置错误文案不改本地状态——无客户端伪造队列态。`web-api-client.ts` 映射逐一对上冻结 HTTP 面：`GET /api/tasks`、`POST /api/tasks/{id}/cancel`、`read_model_run`→`GET /api/tasks/{id}`、`organize_text`→`POST /api/text-sources`（run.id 即 taskId，store 取消与队列取消同一身份）。store 侧 `refresh()` 全部经 HTTP 读回，`acceptRun` 的 `MCP_RESULT_UNKNOWN` 保护防止未知结局 run 被旧状态回写覆盖。
3. **单 run 选择不丢结果**：`organizer.ts` 的单 run 指针是**视图指针**——`start()` 成功后 newest-wins（`run.value.createdAtMs>next.createdAtMs` 阻止旧覆新），`refresh()` 按同规则与权威 `active_model_run` 合流；所有见过的 run 留在 `knownRuns`；候选结果按来源批次经 `list_import_batches`/`read_import_batch` 权威读回，提交新任务仅切换 `selected` 指向新来源，不删不改旧批次数据。四文件内**无结果丢失路径**。

## 5. 发现（不阻断四文件差异，须登记）

- **F-1 浏览器证据缺位**：交付评论 `01a1bd8d` CLI 读回 `attachments=[]`——原始验证脚本、合成输入、admission、binary/dist/runtime 身份、实跑日志、DOM／截图、哈希清单均无可核附件。按派发「浏览器证据须 CLI 实际读回后按其真实范围签署」，本轮**不签**。作者已自认 `applyPreview` 页面点击应用未验；本记录同样不把源码级 `expectChanges:1` 守卫当作「确认应用已验」。
- **F-2 所述旅程与交付树字节结构性不符（须作者披露）**：交付树 `374ef2a5` 的 `Workbench.vue` 是 I 前旧版（与 `dc83b341`/`3f5877d8` 血统一致）：无 `import TaskQueue`、无 `<TaskQueue>` 挂载（冻结 I `d79b1f6` 的 Workbench 在第 19 行 import、第 162 行挂载 `<TaskQueue v-if="page==='inbox'"/>`）；`待确认` 导航按钮 `:disabled="!nativeAvailable"`；`文本智能整理` tab `:disabled="…||!nativeAvailable"`；`boot()` 仅 `nativeAvailable` 时加载；1s 轮询在 `!nativeAvailable` 时先 return。`nativeBridgeAvailable()` 检测 `window.__TAURI_INTERNALS__`，纯 headless Chrome 恒 false——因此在**交付字节**上，所述旅程的 intake tab、队列面板、五连提交、逐任务取消**不可达**。作者自述只临时落盘 7 个 `server/lib/*.mjs` 与 003 SQL 并已移除、未提任何前端临时替换；实跑树与交付字节的关系必须明确披露，重交证据须按真实运行树范围签署。
- **F-3 `95801d3` 索引 hunk 越界**：该提交除收口文档外改 `docs/reviews/README.md`（索引 119→126 并自记「聚焦验证通过」）。按派发口径本轮不接收该 hunk，索引由 III 统一登记；作者自记结论不因登记而获得自签效力。
- **F-4 集成前提（III 收口时强制）**：`Workbench.vue`（及整树差集中的 I 范围文件）必须按冻结 I `d79b1f6` 字节取用（其已挂载 TaskQueue、已解除本切片 nativeAvailable 禁用）；不得以候选分支的旧 Workbench 整树合入。队列面板挂载面在 I 文件内，四文件差异本身不承担该挂载。

## 6. 本签收不覆盖的面

- 完整 `npm run check`、typecheck/单测实跑（评审为静态字节面 + 类型中性判断；三份未改文件系冻结 I 已审字节）。
- 后端行为：3-running/2-queued 推进、取消后队列前进等**运行时**形状依赖后端调度正确性（后端线 R8-M-1/2/3 等仍未闭合）——本前端通过**不含、不代签**任何后端面。
- 真实模型、最终版独立浏览器验收（仍由未写生产者承担）、main 收口。

## 7. 证据与边界

- 本机原始证据：`build/web-text-intake-frontend-review/r1/`（`admission.json`、`frontend-delta-d79b1f6_8324c0b2-to-76f44e7_374ef2a5.diff`、`four-file-and-workbench-identity.txt`、SHA256SUMS，gitignored）；精选随工单评论附件交付。
- 评审只读：候选树零改动；未写生产／测试／公共索引；未跑完整 check；未调用真实模型／凭据／用户根；MAYNE-24 保持 `in_progress`。
