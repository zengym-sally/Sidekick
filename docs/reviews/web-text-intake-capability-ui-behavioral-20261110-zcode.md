# 文本整理能力面 UI 测试行为化修订 r2（capability-UI behavioral）— 2026-11-10 ZCode

- **范围与风险级**：按派工评论 `01a1c18d`（协调层 `48880a2` 接收后的任务分派）**仅修订** capability-ui 测试及其专用夹具：把主要保护从 r1 的源码字符串／正则字节事实（测试 blob `c868820b`，七例）改为**实际编译＋挂载 SFC 的行为观测**——控件状态、真实事件触发、请求计数与既有草稿流。生产字节零改动（三面板 HEAD blob 仍为 `8a44fc3d`／`e67f8d18`／`73c1f643`，`git ls-tree` 复核）。风险级：低（纯测试面；生产路径、package、依赖锁、脚本名集合零字节）。
- **基点**：分支 `agent/zcode/mayne-24`，父提交 `60ecc75`；本切片提交 `62bdccd`（测试修订）＋（本记录提交）。
- **作者不自签**：本记录为作者自报，测试新版待另派独审（`01a1c18d`：测试修订不阻塞三组件代码审；Hermes 并行独审三生产路径）。

## 1. 方法（复用现有能力，零新增依赖）

- **编译**：仓库根 Vite dev server（`vite` 中间件模式，生产 `vite.config.ts`＋`@vitejs/plugin-vue` 管道）挂在临时 `127.0.0.1` HTTP 监听后——面板由**生产编译管线**编译（`<script setup lang="ts">` 全链真实转换）。
- **挂载**：真实 headless Chrome（DevTools 协议，零依赖驱动 `tests/fixtures/web-text-intake/capability-ui-browser.mjs`，与 `web-manual-items/browser-probe.mjs`（MAYNE-23 II r3）同一内置 WebSocket 模式）；页面内挂载工装 `tests/fixtures/web-text-intake/capability-ui-page/`（`index.html`＋`capability-ui-entry.ts`）静态导入三个生产面板与四个生产 store 工厂。
- **请求计数**：在 store 工厂文档化的注入缝上注入**记录型传输**（`web-api-client.ts`：「Tests and fixtures may still construct or inject their own client」）——`createAgentSettings(api,guard)`／`createModelSettings(api)`／`createOrganizerModel(api,guard)`／`createApplicationSettings(api)` 全部真实生产逻辑，仅 `invoke` 换为记录器；guard 回调逐字复刻生产接线行（文件头声明）。响应是后端边界的种子数据：含冻结 `WIRED_AGENT_IDS` 404 镜像（tracker/advisor 读答 `not_found`）与**活动 run 跟踪**（`test_model` 后 `active_model_run`/`read_model_run` 返回该 run——否则真实 `refresh()` 对账会把已完成的 run 清空，与真实服务不符）。夹具零生产判断：观测在页面内返回纯 JSON，**全部断言在测试文件**。
- **面（8 行为面＋1 字节负控）**：B1 角色 tab organizer-only＋「· 未接通」＋禁用点击不发 tracker 读；B2 挂载请求日志＝恰一次 `read_model_configuration`＋恰一次 `read_agent_configuration(organizer)`、tracker/advisor 零读；B3 试跑入口禁用＋如实文案（「隔离试跑在当前管道未接通」「仅保留为草稿」「暂无试跑结果」）＋开始点击不发 `start_agent_trial`；B3b Tauri 型宿主标志在场时试跑仍禁用（**不因宿主标志解锁**）；B4 凭据面（引用可解析）：认证触发器 `API Key · 凭据引用`、帮助「凭据引用可解析；留空保留原引用。」、占位「引用已配置 · 留空保留」、状态行「凭据引用可解析」、页面零钥匙串许诺渲染；B5 About「事项整理（organizer）智能体配置」＋「尚未接通」（「三个内置智能体配置」不得渲染）、真实点击 `selectTab` agents/models、tab 描述「当前仅事项整理（organizer）已接通」／「供已接通的智能体选择」、真实 agents 面板挂进真实壳且 tracker tab 禁用；B6 保留草稿流：输入草稿→保存失败（种子 `WORKSPACE_IO`）→「重新读取，保留草稿」→草稿保留而服务端值为空（保留只能是客户端行为）；B7 保留连通性测试：`测试连接` 可用、恰一次 `test_model`、refresh 运行、「连接测试通过」渲染。T1＝三份 `.vue.txt` 基线快照字节钉（负控防篡改，头部标注**非行为声明**，永不编译执行）。

## 2. 相对父提交与相对组合基准的差异（分列）

- **相对父提交 `60ecc75`**（`git diff --numstat`，恰 5 文件、全在测试面）：`tests/unit/web-text-intake-capability-ui.test.mjs` 重写（+113/−124，新 blob `44c318a7`）；新增 `capability-ui-browser.mjs`（113 行）、`capability-ui-page/capability-ui-entry.ts`（401 行）、`capability-ui-page/index.html`（5 行）、`capability-ui-session.mjs`（78 行）。r1 的源码字符串断言及其专用快照断言全部删除；三份基线 `.vue.txt` 夹具保留为负控素材（字节未动、SHA 未动，作用＝防篡改＋注册基线对照）。
- **相对组合基准（完整 I `cd08588`＋b5 所选前端）【措辞已更正，见 §5.4】**：零生产增量的比较对象是**父提交 `60ecc75`**——三生产 blob 在彼处逐项相等（`8a44fc3d`/`e67f8d18`/`73c1f643`＝`2d5e15f` 修复 blob）；相对 `cd08588`（三面板为修复前原字节 `107b8d74`/`d8273800`/`fa75f477`，`git ls-tree` 复核）三面板是**修复后字节、并不相等**。本修订对 client/store/server/package/依赖锁为零字节（均以 `60ecc75` 为基）。

## 3. 基线红、修后绿、最小反控（隔离 worktree，无 stash 往返）

运行环境：node v24.20.0、Chrome 156.0.8078.80、macOS arm64。命令统一 `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-capability-ui.test.mjs`。**前后树用隔离 git worktree**（`git worktree add … HEAD` 于 `62bdccd`，跑完 `worktree remove --force`＋prune，已删）；主树全程未 stash、未临时改字节。

| 轮 | 树 | 结果 | stderr | 外层用时（含全部清理） |
|---|---|---|---|---|
| 修后绿 `green.tap` | `62bdccd`（修复 blob） | exit 0，10/10 绿（T1＋8 面） | 0 B | ≈3.0 s（outer 2850 ms） |
| 基线红 `red.tap` | 同一 worktree 内 `git checkout 180c2ae -- <三面板>`（还原前字节） | exit 1，恰 B1–B5 六面红（B1、B2、B3、B3b、B4、B5）、B6/B7/T1 绿 | 0 B | ≈3.0 s（outer 2970 ms） |

红轮面板字节＝注册基线 blob 原字节（sha256 复算 `e289bae4`/`2e025366`/`cdaa145c`＝夹具钉）。B6/B7 红轮为绿：与 r1 一致，草稿保留与连通性测试是**保留面**（基线与修复皆真），行为化后依然成立——红绿差与保留面差分列，不以字节检查冒充行为验证。

**最小反控（击穿所保护行为）**：每个反控＝对修复树的恰一处字节替换（`apply-mutant.mjs` 唯一出现才应用，身份校验），逐个跑全套件：

| 反控 | 变异（文件／替换） | 击穿面 | 其余面 |
|---|---|---|---|
| `cc1-trial-unlock` | AgentSettingsPanel `trialWired=false`→`true` | B3＋B3b 红 | 6 面绿 |
| `cc2-preread-restore` | ModelSettingsPanel onMounted 恢复三角色循环 | B2 红 | 7 面绿 |
| `cc3-tab-gate-removal` | AgentSettingsPanel 角色门 `item.id!=='organizer'||` 删除 | B1 红＋B5 红* | 6 面绿 |
| `cc4-about-copy` | SettingsPanel About 恢复「三个内置智能体配置」 | B5 红 | 7 面绿 |
| `cc5-draft-wipe` | `src/stores/agents.ts` `fill(row,c,clean&&…)`→`fill(row,c,true)`（重读抹草稿） | B6 红 | 7 面绿 |
| `cc6-connectivity-kill` | ModelSettingsPanel `test()` 首句插 `return;` | B7 红 | 7 面绿 |

\* cc3 诚实说明：B5 末断言核挂进壳内的 agents 面板 tracker tab 禁用——与 B1 是**同一处受保护控制**（角色门绑定）在两个挂载面上的观测，故一处变异击穿两面；非面间泄漏。cc5 的变异点在 store 保留逻辑所在缝（草稿保留判据在 `createAgentSettings` 内），反控覆盖生产行为所在的字节，不局限于面板模板。

## 4. 门禁（本树）

| 命令 | 结果 |
|---|---|
| `node --check`（测试＋两夹具 mjs） | exit 0 |
| `npm run typecheck`（vue-tsc --noEmit；`npm ci --ignore-scripts` exit 0 先行） | exit 0 |
| `npm run check:structure` | 183＝本分支登记基线、零新增；capability-ui 零命中（新夹具的 `src/` 相对引用全部可解析，`.vue.txt` 仍不参与扫描） |
| 单元墙钟 | ≈3.0 s／轮（含 Vite server、Chrome 启动挂载、SIGKILL＋exit 确认、profile 根删除核验），≪20 s 含清理预算 |
| 清理核验 | 测试 `finally` 断言 `chromeClosed===true`＋`profileRemoved===true`；全部 15 个证据 `.stderr` 文件合计 0 字节 |

## 5. 过程更正（如实登记）

1. **Vite close 挂起**：首轮会话收尾用 `vite.close(callback)`——Vite 5+ 返回 Promise 且忽略回调，HTTP 监听不释放、runner 不退出（warmup.tap 表面 ok 后挂起）。改为 `await Promise.resolve(vite.close())` 后 exit 干净；该轮作废保留（`warmup*.tap`）。
2. **三轮种子／选择器修正**（各由带标签的 `waitFor` 诊断定位，修后 10/10）：B4 认证选择器曾误中「连接测试使用的模型」下拉（改为按 `认证方式` 字段标签定位）；B5 种子缺 `agentConfigs.organizer`（真实壳内 agents 面板挂载即读 organizer 配置，缺种子时读 null 在 `configDraft` 抛 TypeError，ready 永假）；B7 种子 run 快照缺 `revision`（面板陈旧判据如实报「配置已变化」）与响应端缺活动 run 跟踪（真实 `refresh()` 会清空刚完成的 run）。三处均为**测试夹具种子不真实**，非生产行为缺陷。
3. **红轮 B5 错误载荷即证据**：`red.tap` 内 B5 失败消息直接携带页面观测文本（基线 About「…三个内置智能体配置。」），行为观测的失败可读。
4. **差异措辞更正（2026-11-10，协调层派工 `01a1c1b2` 指出）**：本记录 §2 第二条曾写「相对组合基准：三生产路径逐 blob 相等」——表述错误。零生产增量的比较对象是**父提交 `60ecc75`**；相对完整 I `cd08588`，三面板是 `2d5e15f` 修复后字节（`git ls-tree` 复核：`cd08588` 处 Agent `107b8d74`、Model `d8273800`、Settings `fa75f477`），逐 blob **不相等**。§2 第二条已改为正确表述；factory 注入缝与真实默认 HTTP 接线的边界亦一并写明（记录型传输注入在 store 工厂的 Backend 缝，非默认 HTTP 接线）。当日提交 `a1e15d4` 的提交消息含同样措辞，提交消息不可改，以本条与本记录为准。

## 6. 边界与未验证项

- 未跑聚合套件、未跑完整门禁、未重跑 19 旅程；未动 SSE／server／native／D1；未改 package.json／脚本名集合／依赖锁；未新增任何依赖（Vite／Chrome 均为仓库既有能力，CDP 用内置 WebSocket 客户端）。
- 无 Chrome 环境时行为面按既有 `chromeAvailable()` 约定 skip（字节负控面仍跑），与 web-manual-items 浏览器验收套件同规。
- 记录型传输覆盖 store 工厂注入缝；HTTP 传输层（`web-api-client.ts`）本身在本分支未被这些面板走通（本分支 store 接线为原生 `invoke` 世系字节），行为面核的是「面板＋store 逻辑＋命令计数」，HTTP 适配器行为归 W1 其余接收面，不在本测试声明范围。
- 原始证据（gitignored）：`build/mayne24-capability-ui-behavioral/`（green/red/cc1–cc6 TAP＋stderr 全 0 字节、warmup 三轮迭代 TAP、`apply-mutant.mjs`、`SHA256SUMS`——green `be22d805…`、red `fe785fbd…`、cc `04e2f321…`/`68543df2…`/`0a6a36e9…`/`b48c3d4e…`/`ea71fe75…`/`311583f4…`、mutant 脚本 `1d1e0915…`）。

## 7. 结论

**限定通过（作者自报，待独审）**：派工 `01a1c18d` 五项要求逐项落地——主要保护改为实际编译／挂载 SFC 的行为观测（控件状态／真实事件／请求计数／草稿流）；复用现有 Vue／Vite／浏览器能力、零新增依赖；只镜像实现的 r1 断言及其专用快照断言已删，基线夹具保留为负控并声明非行为；三生产 blob 未动；基线红（恰六面）＋修后绿（10/10）＋六个最小反控各击穿其保护面；原始脚本／输出／SHA 已留档并将随交付评论挂载；前后树用隔离 worktree，无 stash 往返；相对父提交与相对组合基准的差异分列。MAYNE-24 保持 `in_progress`。
