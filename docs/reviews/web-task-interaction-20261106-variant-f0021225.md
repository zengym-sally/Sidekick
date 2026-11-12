> 收束脱敏副本（2026-11-12）：仅将本机绝对路径替换为占位符；原始 blob `f002122587e09676768406b19fbb726f667b3257` 保存在本轮 Git bundle，历史结论不变。

# W0 浏览器任务交互方案（队列、取消与恢复）

> 交付物：交互契约 `docs/engineering/web-task-interaction.md` + 静态演示 `design/web-task-flow/`。只签设计与可交接材料，不实现 HTTP/SSE、不声称生产队列已可用。

## 1. 范围与风险级

| 项 | 内容 |
|---|---|
| 任务 | MAYNE-21「W0：交付浏览器队列、取消与恢复的交互方案」 |
| 实现者 | OhMyPi（独立评审指定 Claude，未参与本项实现） |
| 工作树 | `<LOCAL_PATH>`，分支 `agent/ohmypi/mayne-21`，HEAD `b199a36c586ea72f5a2c9d206efb3eee9d11e824` |
| 基线核实 | `git merge-base --is-ancestor 85feb8aaa431a2a1c9f92b238e26a7a2400baa9e HEAD` 与 `b199a36…` 均通过；未切换共享 main，未使用 `build/team-w0-*` 预备树 |
| 写入范围 | `design/web-task-flow/`、`docs/engineering/web-task-interaction.md`、本记录；未改生产 `src/`、`DESIGN.md`、其他任务契约、`package.json`、锁文件、schema/migrations、`vendor/pi`、`resources/skills`、identifier |
| 风险级 | 纯文档与设计原型，无生产代码、无依赖、无 schema、无真实凭据/工作根操作；按低风险处理，仍跑链接与结构守卫 |

## 2. 交付内容

### 2.1 交互契约（`docs/engineering/web-task-interaction.md`）

14 节：范围边界、8 种任务状态与界面语义、队列面板结构与动作矩阵、提交幂等与多客户端、刷新/重连/事件补偿、取消语义、失败分类与逐项核对、备份恢复与旧根激活、凭据与配置不可用、工作根目标、原生不可用能力与壳适配点、文案规范、键盘焦点与无障碍、窄屏适配、演示边界。

对齐的既有权威：

- 状态机与失败语义取自 [Web/后端设计](web-backend-design.md) §5（`queued`/`running`/`cancelling`/`succeeded`/`failed`/`cancelled`/`interrupted`/`needs_review`、attempt/epoch fencing、恢复标记）。
- 凭据与工作根边界取自 §2/§4；部署形态取自 §3；壳适配点取自 §6（`HostCapabilities`/`PetSnapshot`/`NotificationSink`/`BackendConnection`）。
- 产品规则取自 [用户流程](../product/02-用户流程.md) §1/§8、[分期验收](../product/04-分期交付与验收.md)「队列与多客户端」「部署、安装与恢复」。
- 界面语气与状态文案对照生产既有组件（`role="status"`/`role="alert"`、`运行中断`、`核对外部结果后重新整理` 等措辞）。

未擅自新增接口、未改并发/恢复规则：字段名用设计文档已有的逻辑名称，并注明「以契约冻结为准」。

### 2.2 静态演示（`design/web-task-flow/`）

| 文件 | 内容 |
|---|---|
| `index.html` | 三页：任务队列、待核对、能力与壳适配；SVG 图标、班班品牌资产、只引用 `src/styles/tokens.css` |
| `task-flow.css` | 复用生产令牌（`--ink`/`--amber`/`--ivory`/`--line`/`--soft-*`/`--action-*`）；≤760px 卡片化、`prefers-reduced-motion` 降级 |
| `task-flow.js` | 合成状态机：11 条种子任务覆盖全部 8 种状态；取消、重新提交、提交幂等、并发调整、断线重连、逐项核对、恢复放行 |

演示边界（页面与 `design/README.md` 均已声明）：只用合成数据，不连接模型、飞书、MCP、Bash、SQLite 或本机文件系统；刷新复位；不用合成 IPC 代签真实服务。

## 3. 实际执行的验证

预览服务：`PORT=4181 node design/serve.mjs`（127.0.0.1，只读暴露 `/design/`、`/src/assets/`、`/src/styles/`）。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --check design/web-task-flow/task-flow.js` | 0 | 语法通过 |
| `node scripts/checks/check-docs.mjs` | 0 | 18 文件、301 个本地相对链接全部解析 |
| `node scripts/checks/check-structure.mjs` | 1 | 175 项既有违规，与本任务开始前基线完全一致（见 §4）；本任务新增 0 项 |
| `PLAYWRIGHT_MODULE=<LOCAL_PATH> node build/mayne-21/verify-task-flow.cjs` | 0 | 17 组交互检查全部 PASS，7 张截图，浏览器错误 0 |

浏览器检查覆盖（Chrome，headless，deviceScaleFactor 1）：初始队列 3 运行/2 排队与执行槽 3/3；排队位置与「满槽仍入队列」；`cancelling` 未终态（不显示已取消、不释放执行槽、无操作按钮）；取消排队即 `cancelled`；取消运行中 → 无法确认副作用 → `needs_review`；断线重连三态（重连中→快照同步→已连接）；认证类失败停止重试并指向设置；详情中的配置修订固化、操作幂等键、旧事件忽略；任务行键盘可达（Enter 打开、Esc 关闭）；恢复横幅暂停提交/定时/投递；逐项核对三选一、无「全部忽略」、已选项锁定；恢复放行后提交幂等（重复点击只新增 1 行）；并发调低不杀运行任务且新任务按新上限排队；能力页原生不可用与壳适配点、凭据不回读、Linux 无钥匙串、代理模式不签发根切换；状态标签同时有文字与图标；窄屏 390×844 无横向溢出、操作可达、并发条吸顶、位置标签隐藏、待核对选项在视口内。

原始证据：`build/mayne-21/`（`web-task-flow-verification.json`、7 张截图、服务与脚本日志）。该目录已被 `.gitignore` 忽略，不随仓库提交。

### 3.1 演示期间发现并修好的两处问题

1. **并发调低后新任务被分配到超出上限的执行槽**：`槽 3/2`。根因是槽位分母按当前并发实时计算。修为在分配时记录 `slotLimit`，标签按分配时的上限显示；同时把「并发已调低，不杀正在执行的任务，本任务排队等待」与「满槽仍入队列」分成两种说明。
2. **逐项核对全部完成后恢复横幅不消失**：违反契约「核对关闭前不恢复普通调度」的反面——核对关闭后应放行。修为全部项有选择后清除恢复状态并提示恢复放行。

两处均在演示代码内修复，不属于生产缺陷；契约文档相应措辞已在 §7.3 明确。

## 4. 基线门禁状态（不作为通过证据）

`check:structure` 当前 175 项违规，与本任务开始前逐条一致，均非本任务产生：

| 规则 | 数量 | 归属 |
|---|---|---|
| `top.dir` | 172 | `.omp/`（170）与 `.multica/`（2）平台自动元数据，属 MAYNE-18「修复平台元数据导致的开发门禁阻断」范围 |
| `ref.missing` | 3 | `tests/**` 引用未构建的 `vendor/pi/.../dist/` 产物，需先准备 Pi 源码构建 |

本任务曾引入 1 项 `ref.outside`（原型内相对链接指向 `docs/`）与根目录临时 JSON 文件，均已修复/移出。**不得把本机 175 项基线当作通过，也不得以「只跑了子集」替代完整门禁**；W0 集成须由集成负责人在实际集成版本串行重跑完整 `npm run check`。

## 5. 未验证项

- 生产 HTTP/SSE、SQLite 持久队列、真实取消/恢复状态机：未实现、未验。本项只交付界面语义与可交接材料。
- 真实模型、真实凭据、真实工作根、Linux 部署与反向代理：未接触、未验。
- 原生能力（系统通知、桌宠、托盘、快捷键、登录启动、安装包）：未实现、未验；演示仅标注「薄壳阶段提供/不可用」。
- 接口字段名、错误码取值、并发与恢复规则的最终取值：待契约冻结，由队长对齐。
- 演示中的合成状态与文案不构成对真实服务行为的证明。

## 6. 结论

设计与交接材料就绪：契约 + 可打开静态原型 + 17 组浏览器交互证据 + 守卫基线对照。**不宣称生产 HTTP/队列已实现，不代替阶段准入。** 独立评审（Claude）与 Codex 收口按项目 workflow 进行。

## 7. 文件哈希（收口时冻结）

| 文件 | SHA-256 |
|---|---|
| `docs/engineering/web-task-interaction.md` | `2cb2a0ec199253bbcea934f64dc4bb0283c655731d00a4af4a91ab2231720702` |
| `design/web-task-flow/index.html` | `d8b98110cff86f8422af24502644a249413127e5bfca789a4b9440fa4fd7d72c` |
| `design/web-task-flow/task-flow.css` | `889576dee661ecf7a2636e188a7cc25cf7109724551ccb872141ea43358bb6ec` |
| `design/web-task-flow/task-flow.js` | `252d5617fd23fa564114e1de79f5f17f7f7f02299ec5d6167ef1df92f873a64c` |
| `design/README.md` | `ec45181be707921a35d26a90f1e6c1404468be4f251cce5d668d8596d0c67174` |
| `design/index.html` | `6c2e9aaedaa3afe170e5f9dd4498a4faeac081e06c0e368004493174907d3356` |

未获 Git 授权，本项未 commit/push；工作树变更以 diff 形式待审。
