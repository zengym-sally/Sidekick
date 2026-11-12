# 能力面三组件候选 `60ecc75` 独立独审（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c18d`（Codex，引 `01a1c15f` 五项要求；本文初稿误记出处为 `01a1c02a`，更正于此）。对象：`60ecc75594a8c9ecbcf2397d03c843580f36c415`（tree `2e57f7a0…b791`，父 `61bd170`），三个生产 blob 与锁定一致（Agent `8a44fc3d`、Model `e67f8d18`、Settings `73c1f643`，逐 blob 复核）；基准＝完整 I `cd08588`＋b5 所选前端（三面板基线 blob 逐项核对：Agent `107b8d74`＝cd08588＝b5、Model `0216921e`＝b5、Settings `fa75f477`＝cd08588 冻结 I；180c2ae 对齐提交后逐面修订）。本审未参与编写。生产零字节（client/store/server/src-tauri/package 全零差异自验）；差异恰三面板＋docs＋测试＋三基线夹具。

## 结论（分面板）

- **AgentSettingsPanel `8a44fc3d`：通过。**
- **ModelSettingsPanel `e67f8d18`：通过。**
- **SettingsPanel `73c1f643`：通过。**
- 五项要求静态全数成立；**运行时面 7/8 实测通过**（真实 Chrome × 真实编译组件 × 真实后端）；第 8 面（模型连接测试完成时点）机制可达性已证、完成时点未观测到（诚实登记，非候选回归信号）。

## 五项要求逐项（静态 + 真实运行时）

1. **只开 organizer**：静态—角色 tab `:disabled="item.id!=='organizer'||…"`＋「· 未接通」标注（依据 cd08588 `WIRED_AGENT_IDS=['organizer']`/`requireWiredAgent` 404，只读引用未重推导）。**运行时实测**：真实 DOM 三 tab＝`事项整理 (enabled) / 进展跟踪 · 未接通 (disabled) / 工作参谋 · 未接通 (disabled)`。
2. **去预读**：静态—onMounted 三角色循环删除，仅 organizer 预读＋requireWiredAgent 理由注释。**运行时请求事实**：页面级 fetch 计数器（挂载模型服务＋智能体两 tab 后）agent 请求恰 `["organizer"]`，零 tracker/advisor 读。
3. **试跑不因宿主标志解锁**：`trialWired=false` 常量（非 `nativeBridgeAvailable` 门控，import 未引入）；textarea/开始按钮 `:disabled="!trialWired||…"`；按角色许诺文案（宿主固定样本/固定日期合成场景/已发布技能索引）全删，换「隔离试跑在当前管道未接通……仅保留为草稿，不会被发送」「当前管道未接通隔离试跑，开始按钮保持禁用」。**运行时实测**（普通浏览器、无任何桩）：开始隔离试跑按钮 live DOM `disabled=true`、诚实文案可见、全页无钥匙串/试跑许诺残留。
4. **凭据帮助按实际 HTTP 能力**：`keychainPipe`/`nativeBridgeAvailable` 分支与 import 全删；keyHelp 无条件如实（available → 留空保留；missing → 未解析到值＋环境变量引用＋草稿保留；其余 → 不接收明文密钥）；keyPlaceholder「当前管道不保存明文 · 请改用环境变量引用」（resolved 时「引用已配置 · 留空保留」）；认证选项改「API Key · 凭据引用」。**残留核查**：Model 面仅存 1 处「钥匙串」＝§7 原生历史词汇 `已有钥匙串凭据`（stored 映射，非许诺）✓。
5. **About/tab 收窄**：models「供已接通的智能体选择」、agents「当前仅事项整理（organizer）已接通」、About「事项整理（organizer）智能体配置；进展跟踪、工作参谋的配置与隔离试跑尚未接通」。**运行时实测** About 文案两段俱在 ✓。

## 保留面核查

模型连通性测试机制（测试连接按钮＋organizer.testModel＋testRun）字节未动 ✓；文本整理、非空密钥拒载（SkSecretInput 仅绑 keys 草稿）、草稿保留/「重新读取，保留草稿」、§7 五态词表＋`credentialResolved` 判据逐字保留 ✓；领域三角色（`agents.ts`）与原生工厂（`host-capabilities.ts`）真实 import 保留 ✓；真实 models/agents 面板保持冻结 I 字节、无 native 门复辟 ✓；desktop/tools/version 的 native-only 文案未动 ✓。

## 运行时验证环境与方法（真实编译组件，非源码匹配）

运行树＝detached `cd08588`＋恰 b5 client blob（`e730d4a`）＋恰候选三面板 overlay → `vite build` exit 0 → 后端＝`cd08588` entry＋登记二进制 `5311ffa3…232bd`（读回验证）＋真实随包 Pi（默认工厂、无替换）＋loopback 受控模型；真实 Chrome（puppeteer-core）加载真实页面：真实配对门 → 工作台 → 设置。请求事实用页面级 fetch 计数器（仅计数，不注入状态）。

**第 8 面（模型连接测试完成时点）——初稿归因更正（2026-11-10 补充，协调 `01a1c1a2`）**：初稿称「不构成回归信号（服务端调度/退避时序所系）」——该归因**有误**。经协调层核对探针，本审探针把模型答案**双重编码**（`JSON.stringify(testAnswer())` 包住已是 JSON 文本的返回值），真实 Pi 收到的是 JSON 字符串而非 `{ok:true}` 对象——首次尝试的 `output_contract_invalid` 失败由**本探针自身脚本错误**所致，与服务端调度/退避无关。**修正编码后的单次重放**（真实 UI→HTTP→默认真实 Pi→loopback 模型链）：模型收到合法裸 JSON、真实模型请求 1 次、test 任务一次尝试即 `succeeded`（506ms）、确认退出、全部清理步骤成功、自有进程/根残留 0、totalMs=5539 ≤ 20000 预算——第 8 面改判**通过**。本初稿其余七条运行观察（①–④＋保留面）不受影响，按原范围登记。修正探针与原始收尾输出见交付评论附件（cap-replay），与本初稿字节测试分开保留。

## 边界

只读候选（未替作者改测试——c868820b 字节测试的修订归 ZCode 派工）；本审的运行时探针为一次性验证脚本，不入候选。未跑 19 旅程/完整 gate；合成密钥/文本，未触真实凭据；运行后 tmp root 残留 0。原始证据（探针脚本＋9 项运行时输出＋身份清单＋SHA256SUMS）随评论挂载。E/D、GAP-5 仍开放；MAYNE-24 保持 `in_progress`。

## 补充：探针声明的窄收口（2026-11-10，协调 `01a1c1b6`）

协调层不接收的两项探针声明——残留检查只查名称＋root 子串、`backend.close()` 尽力关闭不能替代确认退出事实——已按派工窄收口为补充证据（单次重放，硬预算覆盖启动＋观察＋全部清理；旧 5539ms 原件不改）：每次资源取得即捕获**当次句柄的真实 PID**（Chrome=`browser.process().pid`、模型服务=夹具暴露的子进程 pid、存储=probe 子进程扫描、Pi worker=运行中服务进程的子进程扫描，`build/s0-runtime/node` 即当次 worker，瞬态 ps 与句柄 PID 已剔除）；收尾后**逐 PID** `kill -0` 核退出（全部 individually dead）；attempt 的确认事实不取自 close 契约，而是**宿主关闭后**读 DB `task_attempts.exit_reason`＝`confirmed`（本例 `att_278a…|confirmed`）。同例复证：test 任务一次尝试 succeeded（604ms）、恰 1 次真实模型请求、totalMs=6251 ≤ 20000（含清理）、exitCode=0。环境事实如实登记：当前夹具树的服务端为 **进程内**（`startWebBackend` 导入运行，监听 PID＝探针自身），服务端退出与探针同生共死，逐 PID 退出核验落在 worker／存储／Chrome／模型服务四个真实子进程上；旧夹具时代（子进程型 backend-child）的两对孤儿（PID 44734/44735、45201/45202，来自已回收 worktree 的早期崩溃轮）已作为卫生清理击杀并披露。上一轮（5539ms）的 DB/attempt 事实因其临时根已按清理契约删除而**不可补采**——此为该重放被判定「确有必要」的依据。新探针与原始收尾输出随交付评论挂载（cap-replay2），与本文件早前证据分开保留。
