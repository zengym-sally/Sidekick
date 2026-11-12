# 五份前端接线差异限定代码审（OpenCode，2026-11-10）

- **范围与风险级**：MAYNE-24 W1。协调派工 `01a1c136-26d4-7623-bf30-b93c21ca7ab1`（接清单修订 2 `5215c80` 的「待确认覆盖」划分）：本人未写这五份生产字节，做限定代码审——只审 main→锁定字节的接线变化及必要调用上下文，复用既过 F-2/F-4（`4641ef0`）与 4a6eb63 及 b5 客户端／面板结论，不重审整个前端。风险级：中（浏览器接线面首次整面核对；静态只读审，无生产改动）。
- **基点**：本分支 `agent/opencode/mayne-24` HEAD `5215c802bf5546b20f67c8146eab67a3bc44d39c`（清单修订 2，docs-only）。审对象锁定 `d79b1f69d242081bee1657a2247ef6b2d28740e4`（五路径与 `cd08588328df27cabdb50f178159424a9534c0b9` 同 blob，本日 `git rev-parse` 复算）；差异基座 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5`；后端调用上下文取已修 T-2 的 `cd08588` 字节。
- **五路径与差异量**（`git diff --numstat 1e37044 d79b1f6`，合计 16+/11−，与派工一致）：SettingsPanel.vue `fa75f477`（1+/1−）、Workbench.vue `c5af8bac`（8+/5−）、stores/agents.ts `da044b6e`（2+/2−）、stores/models.ts `2be89983`（2+/2−）、stores/pairing.ts `d04b09a9`（3+/1−）。
- **方法**：只读静态审（`git rev-parse`／`git diff`／`git show` 共享对象库复算），无构建、无门禁、无动态探针。动态反证判定为**不需要**：试跑零请求性质是纯代码序事实（客户端在 fetch 前抛出）；事件名相等与处理器身份是直接字节事实；启动／刷新可达已有已接收真实浏览器证据（4a6eb63 F-1/F-2，真实 dist DOM 旅程）按派工复用。原始证据 `build/mayne24-fivefile-wiring-review/r1/`（gitignored：identity、wiring-evidence、五文件完整 patch），精选件随评论附件。

## 按派工五项分别结论

### ① 浏览器设置与启动／刷新可达 — 通过

- SettingsPanel `:26`：models／agents 两个 section 由「nativeAvailable 门 + 未接通文案」改为无条件渲染真实面板。tab 栏七个入口 main/d79 均无条件渲染（`:14` tabs 数组未改），可达性成立；desktop（`:27`）与 tools（`:28`）的 native 门与「未接通」文案原样保留。
- Workbench `:38-39`：`loadNative` 拆为 `loadTextIntake`（modelSettings.load＋agents.load('organizer')＋organizer.refresh）＋native 专属四项（advisor／todayAdvice／skills／profile）。`:82` boot() 改为无条件 `loadNative()`——浏览器启动即加载模型配置、organizer 配置并刷新 organizer；native 路径七项载荷与 main 逐项相同，无 native 回归。`:121` poller 把 organizer 秒级刷新移到 native 门之前——浏览器任务运行期（organizer.running）持续刷新；`:122` clock 仍 native 门（浏览器无 advisor 时效检查），未变。
- 面板自加载（复用 b5／既有字节）：ModelSettingsPanel `:25` onMounted 加载模型＋三角色 agent 配置；AgentSettingsPanel `:25` onMounted select('organizer')；TextIntake `:9` 懒加载模型＋organizer 配置；TaskQueue `:52-54` 挂载即自刷＋1s 轮询（F-4 复用：TaskQueue 于 `:162` 挂载）。
- 非阻断观察：`:83` initialize() 仍保留 `if(nativeAvailable)loadNative()`——浏览器首次建根后不做急加载，依赖懒挂载与 inbox 手动刷新兜底；逐路径走查未发现用户可见断点（首建根本无候选，录入流 `sourceSubmitted→organizer.select→refresh` 自愈），不判缺陷。

### ② models／agents 实际 backend 选择、草稿／错误／401 会话语义 — 通过

- 两 store 仅换接线：`invoke`→`getWebApiClient().asBackend()`（agents.ts `:28`、models.ts `:35`），工厂体（草稿/baseline/error/generation 逻辑）零改动。asBackend 命令面（b5 已审 blob `e730d4a3`）：`read/save/reset_model_configuration`→`/api/models` GET/PUT、`read/save/reset_agent_configuration`→`/api/agents/:id` GET/PUT//reset——cd 后端 `config-store.mjs:32` `AGENT_IDS=['organizer','tracker','advisor']` 全支持、路由在案（http-server `:174-181`），命令→端点映射逐一命中。
- 草稿／错误：agents.save 已知校验码保留草稿、未知码「保存结果暂无法确认，草稿已保留」（`:55`）未变；models 草稿仅在用户 discard 时清（`:32`）未变。
- 401：共享客户端 `handleSessionLost`（b5 已审）清 CSRF 并回调→pairing `handleSessionLost`→`paired=false`＋`dispose()` 关流回配对门；草稿存于 Pinia 单例 store，跨门往返保留；重配对后 boot() 重新 `loadTextIntake`。agents 试跑 guard（须模型配置就绪）原样。

### ③ organizer-only 接线（tracker/advisor 误请求或误展示；T-2 cd 字节上下文）— 通过（展示面观察移⑤）

- 不误请求：浏览器任务管道仅 organizer——后端 `TASK_ROLES=['organizer']`（task-service `:16`）；客户端 `organize_text`/`test_model` 均以 organizer 提交（b5 已审）；Workbench 浏览器只 `agents.load('organizer')`（`:38`），advisor 加载仍 native 门（`:39`）。试跑五命令在浏览器**零 HTTP**：read 类客户端返回 null（client `:811-814`）、start 客户端先抛 `unsupported_command '本切片不支持智能体试跑。'`（`:815-816`，先于任何 fetch）、cancel 返回 null（`:817-818`）。
- tracker/advisor 配置标签页可点且**有真实能力支撑**：`/api/agents/:id` GET/PUT/reset 三角色全通（config-store AGENT_IDS），加载均为用户点击懒触发或 ModelSettingsPanel onMounted——都是真实端点，非误请求。
- T-2 上下文：providers 端点返回 `credentialRefs` 状态（available/missing，T-2 已修字节 `01a1c0c4` 接收），客户端 `listProviders` 消费状态字段；五文件内无任何钥匙串／CredentialProvider／D1 触点。

### ④ task/candidate SSE 提示、重读、失效与订阅释放 — 不通过（仅「重读目标」一面）

- 提示（通过）：pairing.ts `:30` 五事件名与 cd 后端 sse-hub 实发名逐一相等（`item.changed` `:121-131`、`task.changed` `:134-157`、`candidate.changed` `:159-169`、`stream.ready/reset` 握手对）。
- 失效（通过）：401→共享客户端清 CSRF→`handleSessionLost`→`paired=false`＋`dispose()` 关 EventSource 回门（pairing.ts `:38`、`:69-74`）。
- 订阅释放（通过）：`dispose()` 于 gate unmount（PairingGate `:15`）；gate 以 `<slot/>` 常驻（App.vue `:21`，两文件与 main 字节相同），配对成功不卸载、流不断。
- **重读目标（不通过）**：五个事件全部→`onItemChanged()`→PairingGate `:13` 注册的处理器＝`todos.refresh()`（GET /api/manual-items）**单一**。`item.changed` 接对 store（手工事项）；`task.changed`/`candidate.changed` 的重读**未到达拥有任务／候选／来源的 organizer store**（organizer 无自有订阅，grep 在案）。pairing.ts `:27-28` 注释声称「the handler re-reads through the task/text-source endpoints」与实际处理器不符。
- 影响有界（不推翻已接收证据）：TaskQueue 自有 1s 轮询（b5 已审）、Workbench poller 运行期 organizer 秒刷（`:121`）、首订阅补偿由 boot `loadTextIntake` 覆盖（订阅先于 Workbench boot）、用户动作（select／手动刷新）触发重读——已接收的单客户端真实浏览器旅程（b5、4a6eb63）全部不受影响。残差：跨客户端／断线重连后 organizer 态不经提示补偿，与整理契约 §6.3「客户端在首次订阅/重连/`stream.reset` 后经 text-sources/candidates 读回补偿」及代码自述意图不一致。
- **最小修法（不在本轮实施）**：PairingGate `:13` 的处理器并入 `void organizer.refresh()`（或为 task/candidate 帧注册独立处理器），并把 pairing.ts `:27-28` 注释改为描述实际行为；触点在 baseline 字节（PairingGate.vue）与本五文件之一（pairing.ts），按派工只报不修，待协调路由。

### ⑤ 能力／文案与实际管道相符 — 一面不通过（trial 面板），其余相符

- 相符：About「手工录入、文本智能整理、人工签收、本地事项管理与三个内置智能体配置」（SettingsPanel `:29`）在浏览器**由本切片变为真**（main 时为假）；inbox 导航无条件可达＋「待确认」文案、capture 文本页签无条件可用均与真实管道一致；desktop/tools/version/profile 保持 native 与诚实「未接通／无法读取」文案。
- **不通过（minor）**：AgentSettingsPanel 隔离试跑区在浏览器展示为可跑——`canTrial`（`:14`）无 nativeAvailable 项，模型配置就绪后「开始隔离试跑」按钮可用，样例文案「使用已保存配置与已发布技能索引。」暗示可跑；实际点击得诚实内联错误（零请求）。能力／文案不匹配，源于 SettingsPanel/Workbench 接线使 d79 原字节面板首次在浏览器可达。
- **最小修法（不在本轮实施）**：AgentSettingsPanel 试跑启动按钮（或整个试跑区）按 nativeAvailable 禁用并给「未接通：浏览器模式不提供智能体试跑」级文案（与 tools 页签既有模式一致）；该文件属 d79 I 生产字节（非本五文件），待协调路由给相应作者。

## 命令与证据

全部只读：`git rev-parse`（blob 身份，全命中）、`git diff --numstat`（16+/11−）、`git diff`（五文件 patch＋App/PairingGate 空差异核验）、`git show`（上列行号摘录）。无构建、无门禁、无测试执行、无动态探针、未操作 main、未改生产／测试／package 字节。原始证据 `build/mayne24-fivefile-wiring-review/r1/`：`identity.txt`（身份与 blob 复算）、`wiring-evidence.txt`（行号级摘录）、`fivefile-diff-main-to-d79.patch`（五文件完整 diff），SHA256SUMS 在案；精选件随评论附件。

## 结论

限「main→`d79b1f6` 五份接线差异＋必要调用上下文」面：**①②③ 通过；④ 不通过（仅重读目标一面，影响有界、已接收旅程不受影响）；⑤ 一面不通过（浏览器 trial 面板文案，minor）**。两处缺陷仅登记最小修法，不兼做生产修复；coverage 更新待协调接收后另行执行。不外推为整文件通过、前端整体通过或集成准入；MAYNE-24 保持 in_progress。
