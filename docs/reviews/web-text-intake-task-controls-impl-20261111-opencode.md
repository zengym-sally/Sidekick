# TaskQueue 页内任务控制实施记录（MAYNE-31，r3 方案落地）

> 状态：**待审候选（PENDING-REVIEW）**。作者 OpenCode（2026-11-11），按 MAYNE-31（`01a1c2ad`）派工与协调者移交评论 `01a1c2b2-7a60-73e8-983b-23501f2759b8` 实施；作者不自签，独审另行派发。受审方案为冻结 r3 组合：`38f07a4` 树内 `docs/reviews/web-text-intake-task-controls-plan-20261110-opencode.md`，SHA-256 `a67abe96d089a43bc69c31b571f0574c3fc33b0284665dd29c7ac7ff42f7e6ef`（44345 字节；与 MAYNE-31 卡附件经 CLI 下载件逐字节同值，`§11` 优先约束在前文窄化处生效）。
> 分支：`agent/opencode/mayne-31`（MAYNE-31 平台隔离任务分支）。提交序列：`4e03caf`（merge，带入冻结 r3 谱系，树与 `38f07a4` 逐字节全等）→ `863d598`（写域实现）→ `7cd51de`（S8 独立适配）→ 本记录。仅本地提交，零 push／PR／main 操作。

## 1. 中断现场登记（先于实施完成）

- 原父卡 UI run `01a1c2b2-7a77-744a-abbb-cf4010ce7dc2` 因 daemon 中断终止（`runtime unavailable while task was queued`，queued_expired，自动恢复 3 次未果后停止）。该 run 曾实际工作并在 `agent/opencode/mayne-24` 留下平台自动提交 **`c9a3246`**（"chore(agent): uncommitted changes from task"，父提交恰为 `38f07a4`）：7 文件 +2497/−76，含 TaskQueue.vue 实现（+874）、新回归测试（989 行）、S8 适配、task-controls 夹具三件、以及根目录 scratch `probe-m2.mjs`（79 行，**未采**）。
- 本轮处置：现场已核并登记（本节＋提交信息），**不当作已完成、不丢弃**；六个写域文件按字节承接为实施底稿，逐字节差分见 §3。probe-m2.mjs 为一次性 scratch，不属交付面。

## 2. 写域与零改动清单

- 生产改动恰一文件：`src/components/TaskQueue.vue`（`863d598` 中 +878/−49）。client／stores／server／Rust／公开签名／package／守卫／依赖锁：零字节。无新导航、无设计系统改动、无生产依赖。
- 测试新增主文件：`tests/unit/web-text-intake-task-controls.test.mjs`（989 行，16 例）；夹具限 `tests/fixtures/web-text-intake/task-controls-browser.mjs`、`task-controls-page/index.html`、`task-controls-page/task-controls-entry.ts`（均在派工许可的 `task-controls-*` 前缀内）。
- 独立小提交（`7cd51de`）恰改 S8 单例：`tests/unit/web-text-intake-sse-client.test.mjs` 两处 hunk，其余十例与 harness 字节不动（harness blob 复算＝`fe2bd6b15d790710c168df7e62b39e9709675d5f` 冻结值；测试计数 11＝11）。
- README／manifest／package：本轮零字节（统一接收面不动）。

## 3. 承接差分（本会话唯一作者增量）

`863d598` 相对现场 `c9a3246` 的六个写域文件中，恰一处生产差分：`reviewState()` 删除 r2 已废除的 `recovery.itemVersion ?? 1` 回退——缺失／非正整数 → `null` → 入口禁用＋围栏重读＋行内提示「权威核对条目缺失，暂不可处置」（方案 §3.2「缺失不等于 1、不等于空」）。现场字节本身即是该变异：U4 面对现场字节运行即红（见 §5 run1），U4 断言文本点名此变异（"a ?? 1 fallback mutant renders it here"）。其余五文件与现场逐字节同值（`git diff c9a3246` 复核）。

设计登记：配置重跑入口的修订来源经可选 `configRevision` prop 注入（挂载方／页面所有者在此接线模型配置 store 的已保存修订），缺省／未就绪／同值时退化为普通重试并禁用次入口（方案 §8.3.3 依赖登记的组件侧实现）；TaskQueue 未被 Workbench 挂载（§8.3.2），页面所有者接线前该入口呈禁用态。普通重试永不上送修订、永不上送快照（RS-1）。

## 4. 实现对照（r3 条款 → 落地面）

- §4.1：显示集合扩 `failed`；`interrupted` → 「重启恢复中」；`needs_review` 按 `attemptExitState` 二分标签。
- §4.2：`failure.retryable` 三分（manual 重试／两配置码次入口／auto_backoff、none 无入口）；`attemptCount` 行内展示，202 不断言 +1，围栏刷新后呈现。
- §4.3：核对展开区（`aria-expanded`/`aria-controls`）；仅 `decisionOptions` 存在（exited_confirmed）提供处置；exited_unknown 只读＋占槽标记＋取消意图提示；暂存结局判别与后果文案；回执清单仅来自线域 `recovery.receipts` 数组（缺失/非数组 → resume 禁用＋至多一次围栏重读；空数组合法），resume 禁用直至全部 `verifiable!==false` 勾选；`resolveTask(taskId, itemVersion, decision, acknowledgedReceipts)` 仅权威值。
- §4.3 专段/U10：内联结果直接渲染完整 payload；大结果以 `readTaskResult(taskId, offset, limit)` 既有分段参数逐段累积（零 client 改动），「已载 X／共 Y」进度＋`done===true` 完成态；部分累积不显完整标记；文案无「发布后再读」替代口径。
- §4.4：`interrupted` 只读显示。
- §4.5/§11.2：并发面板（当前/缺省/版本/计数、1..32 输入、就地纠错）；挂载读一次＋seam 围栏重读；PUT 200 就地安装响应（版本+计数）＋围栏任务刷新；`runningCount > 新上限` 下调提示；409 重读保留草稿不自动重发。GET/PUT 共享安装归属：view ticket＋epoch 内版本水位（低版本不安装、同版本迟到不覆盖）；守卫丢弃的 PUT 经统一围栏重读收敛；跨 epoch 重建水位基线。
- §5.1：三道围栏原样保留（分页全量走页 cap 200/limit 100、`refreshSeq` 请求序、`syncEpoch` epoch 围栏）；动作响应永不直接安装进 tasks。
- §5.2：全局单调 `actionSeq`＋`{key,generation,epoch}` 登记；落地须同时满足 mounted＋epoch 未变＋该 key 无更新代次；per-task pending 互斥（同任务一动作在途）；错误槽归最新代次（新动作清旧错误，迟到旧错误不渲染）；卸载静默丢弃 UI 写入。
- §11.1：分段会话/部分与完整缓存/ACK 勾选绑定 `(taskId, syncEpoch, task.version, attemptId, recovery.itemVersion)`（提供 `itemId` 时并绑）；绑定任一成员变更即清扫旧内容/完整标记/ACK/行内错误；发出 resolve 前以当前行复核绑定，旧勾选不转用。
- §3/409 纪律：按码处置（version_conflict/state_conflict/exit_unconfirmed 重读不重发；config_revision_change_not_allowed 收敛提示；validation_failed 就地纠错）；decision 类动作永不自动重发。
- §6：全部真实 `type="button"`＋任务语境可寻址名；原生 checkbox＋显式 label；错误 `role="alert"` 不单靠颜色；行级 `aria-busy`；行 keyed 渲染焦点保持、行离开焦点回落列表容器＋`aria-live="polite"` 播报；640×900 纵向堆叠、展开区内滚、无横向滚动。

## 5. 本会话验证（每例 20s 预算含清理；前置单列：Node ≥24、锁定依赖树、真实 Chrome 于平台默认路径仅浏览器面需要）

| 运行 | 对象字节 | 结果 |
|---|---|---|
| run1（现场原字节） | `c9a3246` 六文件 | 前 4 例绿，U4 红/挂（`?? 1` 变异承重反控，exit 1） |
| run2（一行修复后） | 实现底稿 | **16/16 绿，exit 0**（最慢例 1.7s） |
| 变异反控 | 摘除 §11.2 版本水位守卫 | §11.2 c1+c3 **红**（exit 1，陈旧安装被观察到）；字节恢复后复核 |
| SSE 回归 | `7cd51de`＋新 TaskQueue | **11/11 绿，exit 0**（S8 单例含其中） |
| 真实浏览器 | 终局字节 | **19/19 面绿，exit 0**（截图 2 张；chrome/vite/http/profile 清理全 true） |
| 终局确认（提交后字节） | `7cd51de` 树 | 新套件 16/16、SSE 11/11、浏览器 19/19、`npm run typecheck` exit 0 |
| 静态 | 终局字节 | `node --check` 3/3；`npm run check:structure` FAIL 集＝`38f07a4` 基线 11 项逐项同集合（1×003 冻结＋3×vendor/pi＋7×接收集 ref.missing），零写域提及（对比经 detached `38f07a4` 树 FAIL 行全等，仅测量侧 node_modules 符号链接伪影一项为基线侧测量自扰） |

测试路径纪律：只读复用已接收 harness（`wireTask`/`defaultWorld`/`installControlledNetwork`/`mountGate`/`waitFor`/`settle`，blob `fe2bd6b1` 零改动）；harness 未脚本化的面（cancel/retry/resolve/result/concurrency）由测试本地 fetch 包装层应答，其余委托受控网络；种子全部为冻结合法形态、仅落于传输边界；不直接改生产 store、不重写同步回调。浏览器夹具经真实 Vite 管线编译生产 SFC＋真实 pinia，CDP 可信 Tab/Enter 键事件，最小渲染器不签布局。

覆盖映射（U1–U10/§11 反例 → 面）：U1＝套件例 1＋例 2（红：409 不重放）＋浏览器面 11–13；U2＝套件例 1 内禁用退化断言＋浏览器面 18–19（携带保存修订／普通重试不带修订）；U3＝例 3＋例 4；U4＝例 3＋例 5（权威前置红例：现场字节运行即变异红，run1 留档）；U5＝例 6；U6＝例 7；U7＝例 2＋SSE 套件 epoch 围栏例（同型判据复用）；U8＝例 16（结构面）＋浏览器面 1–10、12、14、16–17（真实 DOM/键盘/布局/截图）；U9＝例 11＋浏览器面 13；U10＝例 12＋例 13；§11.1 c1–c3＝例 14–15；§11.2 c1–c4＝例 8–10（变异反控钉 c1）。

## 6. 边界（诚实登记）

- 全部响应为传输边界受控合法形态；本轮绿面**不签**真实后端／Pi／端到端通过。对照当前后端（权威条目版本/回执未接线，MAYNE-30 在办），resolve/resume 入口正确呈**禁用态**——这是方案 §8.3.4 登记的预期安全行为，不当作功能交付，也不以禁用态充当最终验收。
- 真实恢复处置验收依赖 MAYNE-30 权威闭环；最终接收依赖未参与者独审与唯一集成新证据。E/D、GAP-5 与整体准出边界不变。
- 未跑：聚合、构建、19 旅程、完整 `npm run check`、真实模型。`check:docs` 于本记录提交时随跑（见提交信息）。
- 原始证据：`build/mayne31-task-controls-browser/`（截图＋summary JSON，gitignored）、`build/mayne31-scene-registration/`（方案附件 CLI 下载件）；关键 TAP/日志/截图随 MAYNE-31 评论区附件交付。
