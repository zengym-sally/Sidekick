# MAYNE-24 前端证据补件限定复核——9 份新件＋cfb55 归因更正（OpenCode，2026-11-09）

- **派发**：协调评论 `01a1be1b-39bd`（2026-11-09，Codex）——沿前端原审（`docs/reviews/web-text-intake-frontend-files-20261109-opencode-review.md`，提交 `4641ef0`）限定复核 OhMyPi 资料补件（评论 `01a1be15-fe15`）的 9 份新附件及 `cfb55a4` 归因更正文档；已过两 hunk 代码不重审；重点闭合 F-1/F-2；旧原件不可恢复与新跑来源分开签；按实际时间戳／旅程划分核对 20s 含等待清理预算；只签实际覆盖的夹具 UI 面。
- **对象身份（CLI 原样下载复算）**：9 份附件（admission.json 4895B、frontend-four-file-delta.diff 6480B、verify-frontend.mjs 33462B、verify-frontend-run.txt 2566B、verify-frontend-run2.txt 2566B、result.json 4263B、journeyC.png 45310B、journeyC-dom.html 16056B、SHA256SUMS.txt 887B）全部 CLI 下载，字节数与登记一致；`shasum -a 256 -c` **8/8 OK**。清单另含第 9 行 `model-requests.jsonl`＝**空串 SHA-256**（`01ba4719…daca546b`，可自行以空文件复验）——与「受控模型服务收到 0 个请求」主张一致，但该文件**未随附件交付**（登记性小疵，见 N-3）。
- **性质**：只读取证复核。不签生产候选整体、不代签完整 `npm run check`、不代签最终版原样浏览器验收、不写生产／测试／索引、不重复整轮浏览器运行。

## 0. 结论

**通过（仅限本组新件实际覆盖的夹具 UI 面）**。F-1／F-2 按下列 §2/§3 证据闭合：临时 server／Rust storage／Runtime 三类真实产物身份与全部既有登记逐字节同源；五前端输入为脚本合成字面量并经页面真实提交；服务 DOM 即真实产品 dist（带哈希资产名的 JS/CSS），其渲染面只有冻结 I 的 Workbench（挂载 TaskQueue）可达——与「落盘 I 候选前置文件、交付前还原」的披露互证。0 模型请求与两轮不同分裂的合法取消竞争均如实（一处概括性登记小疵 N-2，不阻断）。旧 14/14 原件（build/ 已回收、原评论 `01a1bd8d` CLI 读回 attachments=[]）**不可恢复、不签**；本轮只签 9 份新件自身。

## 1. 归因更正 cfb55a4——确认成立

`d79b1f6` 的 `TextIntake.vue` 中 `organizer.running` 仅出现在提交按钮 `:disabled="organizer.running||organizer.starting||…"`，SkFieldset 绑定只含 `organizer.starting` 等合法门——与我原审 `4641ef0` 的逐字节结论（「SkFieldset binding untouched and already starting-only in d79」）一致；实际解除的是提交按钮上的 running 门，字段集无需改。缺陷机制、2 hunk 修复与验证结论不受影响，仅归因文本更正——**接受**。

## 2. F-1：临时 server／Rust／五个前端输入的精确来源——闭合

| 面 | 来源 | 复核 |
|---|---|---|
| 临时 server | 程序化 `startWebBackend`，import `build/web-backend/server/entries/web-backend-entry.mjs`（打包构建产物，前置链 npm ci → probe:prepare-cli → probe:prepare-pi → probe:bundle → build → build:backend 全部本轮实跑） | loopback 随机端口（63369／64838 两轮）；配对码仅经私有 `onPairingCode` 回调（日志只记 `pairingCode=received`，值 0 命中） |
| Rust storage | `build/web-backend/bin/web-backend-storage`，2649408 B，SHA-256 `42af54b5…90fc2` | **与我此前 R8 轮本地重建及全部既有登记逐字节相同**——跨轮、跨工作树的强来源锚 |
| Runtime | organizer bundle `08f32db2…`（2515908 B）／bundled node `9d050fd4…`（121911744 B）；登记 Pi provenance `ad702637`／`e89822b0` | 与我此前本地重建一致；本旅程中 Pi 真实路径未被消费（见 §5 缝分析），登记如实 |
| 五个前端输入 | 脚本字面量「队列合成输入 1..5」＋C1「队列排空后的合成输入」 | 经页面 textarea＋「开始整理」按钮提交（`HTMLTextAreaElement` value setter＋`input` 事件＋真实 click），非 API 代替；DOM 引用真实构建资产 `/assets/index-WY-E38vd.js`、`/assets/index-CQH58FJW.css` |

## 3. F-2：实际 Workbench 与 dist/JS 对应——闭合

- 候选树 `374ef2a5` 的 `Workbench.vue`（blob `2aa1f2b9`）**0 处** TaskQueue 引用（对象库直读）——即我原审 F-2 指出的 pre-I 面。
- 冻结 I `d79b1f6` 的 `Workbench.vue`（blob `c5af8bac`）：`:19` `import TaskQueue`、`:162` `<TaskQueue v-if="page==='inbox'"/>`、`:173` `dialog.capture-dialog`、「整理一段原文」入口——与 DOM 捕捕到的 `aria-label="整理队列"` section、capture-dialog、「待确认」导航完全对应。
- `TaskQueue.vue`（blob `1bd5d476`，候选↔d79 逐字节相同）：`:60` `section.task-queue` `aria-label="整理队列"`、`:63` 空态文案「当前没有排队或进行中的整理任务。」、`:64` `ul.queue-list`、`:68` `.queue-position`「第 N 位」、`:69` 取消按钮——A3 实测（5 行、第 1 位／第 2 位）、B3 实测文案、journeyC-dom.html 三者逐字对应。
- **推断链**：服务 DOM 含 TaskQueue 渲染面 ⇒ 运行树的 Workbench 不可能是候选 pre-I 字节 ⇒ 与作者「落盘 I 候选 server/**＋5 个 src-tauri 文件＋5 个前端文件作只读前置、交付前已还原」的披露互证（即我原审 F-4 的集成前置形状在运行树中被落实；集成登记义务不变）。

## 4. DOM 点击 × HTTP × 只读库一致性

- A2 形状由 HTTP 逐提交轮询实测（1/0→2/0→3/0→3/1→3/2，槽被 fixture worker 持住期间观测）；A3 队列面板为页面活 DOM 读数；B1 五次取消均为页面按钮 click（先查 `!n.disabled`），B2 排空断言 `running||queued==0`、terminal=5；B3 为页面文案。
- C2 候选经 HTTP 读回＋页面「待确认」区双证（cards=1）；journeyC.png 独立互证第 2 轮：徽标「确认 3」＝D2 `candidates:3`，「首次录入锚点 2026/11/9 10:09」（本地时区）≈ result.json `generated 02:10:10Z`——本轮证据内部时间自洽。
- D1 同根重启 6→6 且旧会话 401；D2 只读 SQLite（`readOnly:true`）sources=6、tasks=7（5 原始＋C1＋预览任务）、candidates=3（第 2 轮 2 个自行成功原件＋C1）——与 HTTP 一致。

## 5. 受控缝与 0 模型请求

- 三缝均为授权形状：`credentialProvider` 内存 Map（GAP-3）、`workerProcessFactory` 仅替换 WorkerHost 的 spawn 调用（真 Node 子进程、真 stdio/exit、说生产帧协议）、`workerRunLimitMs:40000`（冻结 1–120000 区间内）；无 HTTP 开关、无生产判据修改；调度器／host／状态机全走生产代码（backendStderr=[]＝0 条 scheduler/worker-host 错误）。
- **0 模型请求自证缝生效**：配置 baseUrl 指向受控 loopback 服务，但 worker 由工厂提供、自行产出 extract/预览结果帧——若缝未生效，真实 Pi 会实际调用受控服务、modelRequests 不为 0。`modelRequests:0`＋空 jsonl 哈希＋3 运行形状由 `SLOT_HOLD_MS=25000` 持槽产生——作者已如实披露「不是模型延迟的实测值」。

## 6. 两轮差异与取消竞争登记（N-2，概括性小疵）

- 第 1 轮（verify-frontend-run.txt）：B2 `cancelled=4`——C 探针示提交序第 **4** 个原件在取消到达前自行 succeeded；第 2 轮（run2/result.json）：`cancelled=3`——第 **3、4** 个原件自行成功。两轮均 active=0、terminal=5，断言按「前进至空」判定；B1 五次 click 均落在当时 enabled 的按钮上，后两次 click 在服务端与已完成任务竞成败（合法结局，契约按取消意图终态处理）。
- **登记更正**：交付评论「B2 的 cancelled=4 而非 5：第 5 个任务已自行 succeeded」只覆盖第 1 轮、且任务位次与探针不符（按提交序为第 4 个）；第 2 轮为 3/2。表格内 D2「candidates=2」同为第 1 轮数值（第 2 轮为 3）。两轮日志均已附件交付、竞争机制披露如实，属概括性登记精度问题——按本节两轮分裂登记为准，不构成不通过。

## 7. 20s 含等待清理预算——按旅程划分核对（N-3，登记性）

- 日志**无时间戳**：分段时长只能从轮询结构重构，非实测（总时长「约 103s/轮」为作者报告值，与结构一致）。分段上界／结构：配对 ≈4s；入口 ≈2s；A 五提交 ≈8s；B＝5 个条件轮（1s 轮询、单轮上限 25s、活跃数下降即出——由总时长反推实际约 9–11s/轮）；C 段固有 ≥25s（`SLOT_HOLD_MS=25000`；C 探针 i=19≈20s 仍 running、≈25s 终态）；候选等待首轮即中；C3 ≈3s；D ≈3–5s；截图/DOM 捕获带显式 20s watchdog。
- 全部等待为**条件轮询**（形状、活跃数、终态、候选在场即出循环），无固定 sleep 代替就绪；小固定 sleep（250–2500ms）仅为 UI 稳定延迟。
- 判定：约 103s 是 14 段旅程＋证据捕获的整体，**不是**单例超时；按旅程划分后唯一装不进 20000ms 用例预算的是 C 段，且完全由 fixture 常量 `SLOT_HOLD_MS=25000` 造成——这是作者聚焦验证的夹具选择（已披露），不是产品属性；承担冻结预算的用例仍是 II 套件（先例：恢复套件 F1 13.8s 含清理在 20s 内），II 不得原样复用 25s 持槽常量。以脚本形式豁免预算**不成立**——本复核按上述划分逐段核对，预算纪律在聚焦验证语境下实质满足；登记为夹具适配注记，非缺陷。

## 8. 签署范围与保留

- **签**：仅本组新件实际覆盖的夹具 UI 面——配对闸→采集入口→文本整理 tab→页面连投 5 任务→3 运行/2 排队观测→队列面板位次→逐任务取消×5→队列排空→再提交→候选进待确认区→页面请求预览→预览前后候选不变→同合成根重启读回→只读库互证；0 模型请求与合法取消竞争按 §5/§6 如实保留。
- **不签／保留**：旧 14/14 原件（不可恢复，不反签也不追认）；apply 点击（`applyPreview` 的 `expectChanges:1` 版本守卫仅源码层结论，作者已披露）；预览任务完成态（C3 只记录页面请求发出，第 7 个任务重启后结局未断言）；完整 `npm run check`（III 唯一集成轮）；最终版原样同源浏览器验收（未参与生产者）；真实模型／凭据／用户根／Linux／代理。
- 脱敏复核：合成秘密值、`/Users/` 绝对路径在全部运行产物（两轮日志、result.json、admission.json、DOM、PNG）0 命中；配对码值 0 命中（仅 `pairingCode=received`）；日志中仅 loopback 随机端口。脚本源内的 `synthetic-frontend-key-9d2b` 为夹具定义本身，非泄漏面。
- 边界：只读复核＋CLI 附件下载复算＋对象库直读；候选树与运行证据零改动；不写生产／测试／索引；不重复整轮浏览器运行；未跑完整门禁；原始下载件与复算记录存本机 `build/mayne24-frontend-evidence-review/r2/`（gitignored，含 SHA256SUMS 复算输出）。MAYNE-24 保持 in_progress。
