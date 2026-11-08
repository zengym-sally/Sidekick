# MAYNE-23 W1 真实产品 UI 完整业务旅程验收（OhMyPi，集成快照 404a2bc）

> 状态：**不通过**——快照 `404a2bc16a6e341687732290b0313d5a3968c793`（冻结 `2e349ec36ebc25764d17919836925598e57fb23c`）的真实产品 UI 在浏览器中**无法完成任何业务写入**：两处阻断（BLOCKER-1 工作台启动即失败、BLOCKER-2 保存被 CSRF 拒绝），均由本树 A/B 实测复现并定位到候选 I 的具体文件与行。业务旅程其余环节在把上述两处作为**诊断注入**绕开后实测全部可行，但按派发口径「不以绕过 UI 的写入签通过」，这些环节**不签业务通过**，只作为修复后的复验基线。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b8d4-c9cf-793e-9a46-8c4556972c70`。审查者未参与生产实现，候选只读。
> 依据：冻结契约 `docs/engineering/web-manual-items-contract.md`（`8d752953…b70e8d`）§3 用户路径、§4 字段与时间语义、§5 端点、§9.4 同源静态供给与「浏览器冷启动必须加载后端同源提供的静态资源，再同源访问 `/api` 与 SSE；不得以设计预览或合成 IPC 代替」、§11 端到端可观察验收；P2 九条矩阵 A-1–A-9。

## 1. 登记与快照核对

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `ad90915a445ec07932beb83bc9eaab0634b196db` | 与派发一致 |
| 快照 commit / tree | `404a2bc16a6e341687732290b0313d5a3968c793` / `03e8f8a0e0ed6abb40fe2a5b17a0ccb74755d7b1` | `git cat-file -t` = commit |
| 冻结 commit / tree | `2e349ec36ebc25764d17919836925598e57fb23c` / `d9d536c91a3464cb7d5c1911a76bfdd542825250` | 与登记一致 |
| 快照与冻结的差异 | 恰 2 文件：`docs/reviews/README.md` + `docs/reviews/web-manual-items-integration-20261108.md`（+61/−1，纯公共记录） | `git diff --stat` |
| 基座血缘 | `65469904d8baddde738646dfed3bf4a921f47b68` 为快照祖先 | `merge-base --is-ancestor` exit 0 |
| 快照取用方式 | `git archive 2e349ec` 导出到 `build/web-manual-items-browser-acceptance/snapshot/`，5 个关键文件 blob 与快照逐一相等 | 实测 |
| 业务/静态相关源码一致性 | `2e349ec` 与 `91b78ed`（队长裁定的 manifest 修复基点）在 `server/**`、`src/**`、`index.html`、`vite.config.ts` **逐字节相同**；仅 `package.json` 不同 | 逐文件 `git rev-parse` 比对 |

**可沿用性**：本旅程结果绑定 `404a2bc`/`2e349ec` 这一实际快照。后继集成若只有 `[package] default-run` 与公共记录改动（浏览器相关源码、静态产物与配置保持一致），可按上述精确差异核对沿用；若业务源码/静态产物/相关配置改变，须对受影响路径重验，最终仍以明确实际集成版本完整门禁 exit 0 为准。

## 2. 真实产物准备（全部用仓库既有命令，非桩）

| 步骤 | 命令 | exit | 结果 |
|---|---|---|---|
| 依赖 | `npm ci --ignore-scripts` | 0 | 107 packages |
| cli 前置 | `npm run probe:prepare-cli` | 0 | lark-cli v1.0.98 |
| pi 前置 | `npm run probe:prepare-pi` | 0 | vendor/pi 来源校验后真实构建，commit `ad702637…` |
| runtime 打包 | `npm run probe:bundle` | 0 | `build/s0-runtime` 就位（tauri `build.rs` 的资源前置，缺它 cargo 构建失败） |
| 前端 dist | `npm run build` | 0 | `dist/index.html` + `assets/index-BpnUy-bq.js`(729.62 kB) + `index-BlfHoOFX.css` + `SpaceGrotesk-*.ttf` |
| 存储二进制 | `cargo build --release --bin web-backend-storage` | 0 | 2 632 352 B |
| 后端装配 | `npm run build:backend` | 0 | `build/web-backend/`＝server 相对布局＋`bin/web-backend-storage`＋`static/`＝dist |

**产物哈希（真实产品）**

```
7e851caa8da0c139a933d4cb2341d5a79f928627f5aa1f21a6401c353c8dc07b  build/web-backend/bin/web-backend-storage
b29fdcbc5b6452fde9f229dd085e896ebca2c09a4d3693de08e66f279601d306  build/web-backend/static/index.html
cc59ec3f461a2ca2fa878e1ea75c9d17a256f98afd0d2786782bfaf3776ee35c  build/web-backend/static/assets/index-BlfHoOFX.css
d9632df0edb9dac0868b44ff2dfbbcd4e323a5f651490033badc08844b8361f7  build/web-backend/static/assets/index-BpnUy-bq.js
acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72  build/web-backend/static/assets/SpaceGrotesk-Dcw4Q7AU.ttf
c7234a7542c3f21401455f397bbfd739c20c8ded76ec0017df516780727e29aa  build/web-backend/server/entries/web-backend-entry.mjs
```

## 3. 方法（不绕过 UI、不签合成页）

- 后端：`startWebBackend({ root: <显式合成根>, port: 0, staticRoot: <真实 dist>, storageBin: <真实二进制>, initialize: true, onPairingCode })`。配对码**只**经私有回调在内存取得，并只进入 `POST /api/pair` 请求体（由产品 UI 的表单提交）。
- 浏览器：真实 headless Chrome 经 DevTools Protocol 驱动，导航到 `http://127.0.0.1:<port>/`。所有业务动作都通过产品 UI 的真实控件完成：配对输入框、`#quick-entry` 按钮、`dialog.capture-dialog` 内的标题输入、事项类型 combobox（点击展开后点选项）、实际负责人输入、`TimeField` 的「设置交付截止 / 仅日期」复选框与日历弹窗、详情对话框（经 `button.task-title` 打开）的「完成 / 重新打开 / 删除事项」以及「确认删除」确认框。
- 观测：页面自身的同源 `fetch`（带会话 cookie）+ 只读 SQLite（`node:sqlite` `readOnly`，同一合成根 `data/web-backend.sqlite`）双向印证。
- 未使用：`design/` 原型页、合成探针页、绕开 UI 的 HTTP 写入签通过。
- 运行拆分：旅程分两个前台运行完成（各需全新后端＋浏览器，且运行窗口有界）；两半使用同一快照、同一真实产物、同一显式合成根协议。合并矩阵见 `combined-matrix.json`。

## 4. 结果矩阵

### 4.1 原样快照实测（A-*）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A-COLD-1440 | 后端同源提供产品 UI，1440px 挂载、不横向溢出 | **PASS** | `origin=http://127.0.0.1:<port>`、`#app children=1`、`scrollWidth=1440/1440`、`title="跟班 Sidekick"` |
| A-PAIR-GATE | 未配对会话只见配对门，无工作台、无数据 | **PASS** | 唯一输入 `placeholder="配对码"`，唯一按钮「进入工作台」 |
| A-PAIR-CODE-CHANNEL | 配对码只经 `onPairingCode` 私有回调取得 | **PASS** | `length=8` |
| A-SESSION | 配对后页面同源 `GET /api/session` 得 200＋顶层 `csrfToken`＋capabilities | **PASS** | `["workspace.manage","workspace.backup"]` |
| A-COLD-640 | 640px 窄屏同源挂载、不横向溢出 | **PASS** | `scrollWidth=640/640` |
| A-FRESH-PROFILE-GATE | 新浏览器 profile 无会话时再次见到配对门 | **PASS** | `pairing=true quickEntry=false` |
| **A-BLOCKER-1** | 配对通过后工作台可启动 | **FAIL** | 见 §5.1 |
| **A-BLOCKER-2** | 通过产品 UI 的业务写入可成功 | **FAIL** | 见 §5.2 |

### 4.2 诊断注入后实测（B-*，不签业务通过，仅作复验基线）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| B-PAIR-VIA-UI | 产品 UI 表单输入配对码后进入工作台 | PASS | `ok=true` |
| B-CREATE-ACTION | 创建「待我处理」落 1 行 1 事件 | PASS | `items 0->1, events 0->1`；列表出现该标题 |
| B-CREATE-FOLLOWUP | 创建「待我跟进」落 1 行 1 事件 | PASS | `items 1->2, events 1->2`；列表出现该标题 |
| B-LIST-TWO-KINDS | 列表两类事项与库行一致 | PASS | `["followup/v1:…","action/v1:…"]` |
| B-DETAIL | 详情读回与列表同版本同字段 | PASS | `v=1`、`due.precision=minute` |
| B-TIME-INDEPENDENCE | `due` 与 `followup` 独立、互不改写 | PASS | `action.followup=null`；`followup.due=2026-11-20T01:00Z`、`followup.followup=2026-11-25T01:00Z` |
| B-TIME-DB | 库中两时间独立、精度保留 | PASS | `action(due=1795136400000,followup=null)`；`followup(due=1795136400000,followup=1795568400000,prec=minute)` |
| B-TIME-DAY-PRECISION | 仅日期精度保留原表达 | PASS | `precision="day"`、`localText="2026-12-01"`；库 `due_precision=day` |
| B-EDIT | 编辑后版本递增、标题更新 | PASS | `from=1 to=2`；库 `v=2 events=create,update` |
| B-COMPLETE | 完成后 `completed`＋`completedAt`＋版本+1 | PASS | `v=2 completedAt=2026-11-08T02:3x:xx.xxxZ` |
| B-REOPEN | 重开回 `open`、清 `completedAt`、版本+1 | PASS | `v=3 completedAt=null` |
| B-LIFECYCLE-DB | 库行一致（open、`completed_at_ms` 清空、版本连续） | PASS | `db v=3 status=open completed_at_ms=null` |
| B-LIFECYCLE-EVENTS | 事件序 `create,complete,reopen` | PASS | 实测一致 |
| B-HISTORY | 详情对话框显示本地活动历史，与 API `sequence DESC` 一致 | PASS | `api=reopen,complete,create`；UI「重新打开 / 标记完成 / 手工录入」 |
| B-DELETE | 经产品 UI（含显式确认）软删并移出默认清单 | PASS | `status=deleted version=2 deletedAt=… inDefaultList=false listCount=1` |
| B-DELETE-DB | 软删行可读、`deleted_at_ms` 置位、历史完整 | PASS | `db status=deleted deleted_at_ms=…  events=create,…,delete` |
| B-VERSION-CONFLICT | 过期 `expectedVersion` 返 409 `version_conflict`，胜者值保留 | PASS | `status=409 code=version_conflict titleAfter=跟进供应商报价` |
| B-SSE-HINT | `item.changed` 提示到达页面、无 `id` 行、不进任务 cursor | PASS | `id=""`（无 id 行时浏览器 `lastEventId` 为空串）、`objectType="item"`、`contractVersion="web-api/1"` |
| B-SSE-COMPENSATION | 提示后读回得到另一客户端的权威版本 | PASS | `v=2 title=另一标签页的修改` |
| B-SSE-NO-TASK-EVENTS | 事项提示不写 `task_events` | PASS | `taskEvents=0` |
| B-NO-MODEL | 全程无模型配置，`tasks`/`task_events` 恒 0 | PASS | `tasks=0 taskEvents=0` |
| B-RESTART-ROOT | 同根新实例可重开（根锁释放） | PASS | `http://127.0.0.1:<port>` |
| B-RESTART-DATA | 重启后事项/版本/状态逐条重现、无重复 | PASS | `items 2->2, events 4->4, rowsIdentical=true` |
| B-RESTART-HISTORY | 重启后完整历史重现 | PASS | `create,…,delete` |
| B-RESTART-UI | 重启后产品 UI 可再次配对并读到恢复的事项 | PASS | `ok=true listCount=2 hasDeleted=true` |

**汇总**：A-* 8 项中 6 项通过、2 项为阻断；B-* 27 项在诊断注入下全部通过（不签业务通过）。

## 5. 阻断项（复现与定位）

### 5.1 BLOCKER-1：配对通过后工作台启动即失败，界面只剩「重新尝试」

**现象**：在产品 UI 输入正确配对码并提交后，配对门消失，但 `#app` 显示：

> 先把本地数据找回来。**Cannot read properties of undefined (reading 'invoke')** 重新尝试 / 没有建立空清单替代原数据。

此时界面只有「重新尝试」一个按钮，无 `#quick-entry`、无清单、无任何可用业务入口。

**根因（已定位到具体文件与行）**：`src/stores/settings.ts:17`

```ts
export const useApplicationSettings=defineStore('settings',()=>createApplicationSettings(invoke));
```

`src/components/Workbench.vue:77` 的 `boot()` 在 `await store.boot()` 成功之后调用 `await settings.load()`；`settings.load()` 经该 `invoke` 绑定发 `read_application_settings`，而浏览器中 `@tauri-apps/api/core` 的 `invoke` 依赖 `window.__TAURI_INTERNALS__`（仅 Tauri 运行时注入），后端同源页面里该对象不存在，于是 `Cannot read properties of undefined (reading 'invoke')`，`boot()` 落入 `catch` 置 `startupError`，工作台停在启动错误态。

`src/stores/todos.ts:43` 已切到 HTTP（`createTodoModel(new WebApiClient().asBackend())`），但 `settings.ts`（以及 `agents/models/organizer/profile/skills/today/mcp*` 等 store）仍绑定 Tauri `invoke`；`boot()` 同步 `load()` 的 `settings` 是首个命中者，整条路径在第一个非 HTTP store 上即断。

**A/B 复现**（`ab-invoke.mjs`；被服务产物未被修改，差异仅在于是否给运行中的页面装上 `__TAURI_INTERNALS__` 诊断垫片）：

```
AS-SHIPPED       {"startupError":true,"hasRetryOnly":true,"buttons":["重新尝试"],
                  "text":"先把本地数据找回来。Cannot read properties of undefined (reading 'invoke')…"}
WITH-INVOKE-SHIM {"startupError":false,"hasRetryOnly":false,"buttons":["进入工作台"],
                  "text":"输入配对码在本机后端启动终端复制一次性配对码…"}
```

**影响**：契约 §3 路径 1 之后的全部路径（表单保存、列表/详情、编辑、完成/重开、删除、历史、重启恢复）在此快照下均不可达；§11「表单保存」「列表/详情一致」等验收项无法进行。

### 5.2 BLOCKER-2：产品 UI 的保存被 403 `csrf_invalid` 拒绝

**现象**：把 BLOCKER-1 作为诊断注入绕开后，工作台可进入、捕获对话框可打开、字段可填写，但点「保存事项」后对话框不关闭，表单错误显示 `CSRF 校验失败。`，数据库 0 行 0 事件。

**根因（已定位到具体文件与行）**：`src/stores/todos.ts:43` 与 `src/stores/pairing.ts:14` 各自 `new WebApiClient()`——**两个独立实例**。

- `pairing` store 的实例在 `pair()`/`readSession()` 时把 `csrfToken` 写进自己的私有字段（`src/lib/web-api-client.ts:191/198`）。
- `todos` store 的实例从未调用 `pair()`/`readSession()`，其 `csrfToken` 始终为 `''`，于是 `request()` 的 `if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;`（`web-api-client.ts:158`）不生效，写请求**完全不带** CSRF 头。
- 服务端 `server/lib/http-server.mjs:163-165` 对写请求强制比对 `req.headers['x-csrf-token']` 与会话令牌，缺失即 403 `csrf_invalid`。

**观测证据**（`csrf2.mjs`，拦截页面 `fetch` 记录写请求头）：

```
writes: [{ "url": "/api/manual-items", "method": "POST", "hasCsrf": false }]
err: "CSRF 校验失败。"
```

**A/B 复现**（`ab-csrf.mjs`，同一页面，唯一差异是是否给写请求补上会话的 `X-CSRF-Token`）：

```
AB1-AS-SHIPPED   {"stillOpen":true,"err":"CSRF 校验失败。","listCount":0,"listTitles":[],"dbItems":0}
AB2-WITH-CSRF    {"stillOpen":false,"err":null,"listCount":1,"listTitles":["CSRF A/B 探针事项"],"dbItems":1}
```

**影响**：契约 §3 路径 2–7、§5 全部写端点、§11 全部写相关验收项；§6 幂等/版本冲突因写请求不可达而无法验证。这也是「事项 SSE 提示 → 读回补偿」链条无法在 UI 层闭环的原因（没有成功的写入就没有可补偿的变化）。

### 5.3 与既有门禁失败的关系

两处阻断均属候选 I 的前端接线字节，且都不在历轮聚焦验证与独审范围内（I 聚焦清单为 cargo/Node 单测/HTTP smoke；II 只测夹具机制；typecheck 与 `test:desktop-controls` 已由前两轮拦下并修；第三轮门禁在第 47 组暴露 `Cargo.toml` 主二进制消歧）。这与前述同属一类：**完整链路首次跑到即拦下**。本验收不改 I/II/III 实现，不自行补实现，按派发如实列阻断与复现。

## 6. 复验基线（修复后应直接重跑）

修 BLOCKER-1（`settings.ts` 等 store 改走 HTTP 客户端，或启动路径不再依赖 Tauri `invoke`）与 BLOCKER-2（`todos` store 复用 `pairing` store 的客户端实例，或共享一个已配 CSRF 的 `WebApiClient`）后，以下 B-* 项应在**原样快照**上直接通过（本树已用诊断注入实测其可行，逐项证据见 §4.2）：创建两类事项与独立 `due`/`followup`、`minute`/`day` 精度与原表达保留、列表/详情一致、编辑版本递增、完成/重开（`completedAt` 置位与清除）、历史 `sequence DESC`、软删（默认清单排除、详情/历史可读、变更操作 409）、版本冲突 409 后重读重决、SSE `item.changed` 无 `id` 行 + 读回补偿、同根重启后事项/版本/历史逐条重现、1440/640 不溢出、新 profile 再见配对门。

## 7. 可复核原始证据

均在 `build/web-manual-items-browser-acceptance/`（gitignored，随评论附件交付）：

- `admission.json` — 登记（树/提交/快照/写入范围/方法）。
- `combined-matrix.json` — 合并结果矩阵。
- `snapshot/` — `git archive 2e349ec` 导出树 + 全部构建产物。
- `acceptance.mjs` / `acceptance-partb.mjs` — 旅程驱动（真实 Chrome + CDP + 产品 UI 控件 + 只读 SQLite 观测）。
- `ab-invoke.mjs` / `ab-csrf.mjs` / `csrf2.mjs` — 两处阻断的 A/B 复现与写请求头观测。
- `probe-conflict.mjs` — 版本冲突与 SSE 的对照探针（证明 409 与提示帧在正确头/正确读取下成立）。
- `dlg-probe.mjs` / `dlg2.mjs` / `kind.mjs` / `editprobe.mjs` — 产品控件结构探针（combobox、日历弹窗、`button.task-title`）。
- 日志：`acceptance.log`、`acceptance-full.log`、`acceptance-partb.log`、`acceptance-partb-full.log`、`acceptance-partb1.log`、`acceptance-partb2.log`、`npm-ci.log`、`prepare-cli.log`、`prepare-pi.log`、`probe-bundle.log`、`vite-build.log`、`cargo-build.log`、`build-backend.log`、`artifact-hashes.txt`。
- `snapshot/evidence/`：`01-cold-start.json`、`03-paired.json`、`05-create-action.json`、`06-create-followup.json`、`07-list.json`、`08-edit.json`、`partb-lifecycle.json`、`partb-delete.json`、`partb-sse.json`、`partb-matrix.json`；截图 `02-pairing-gate-1440.png`、`04-workbench-1440.png`、`11-after-journey-1440.png`、`12-pairing-gate-640.png`、`partb-after-journey.png`、`partb-after-restart.png`。

## 8. 未验项与收尾

- 完整 `npm run check` 不在本轮范围；`Cargo.toml` 的 `default-run` 修复由 Claude 并行交付并另派独审。
- 旅程因运行窗口限制拆成两个前台运行完成；两半使用同一快照、同一真实产物、同一合成根协议，合并矩阵见 `combined-matrix.json`。未在**同一进程内**连续跑完全部 35 项。
- Linux/代理、真实凭据/用户工作根/真实模型在授权边界外，未涉及。
- 收尾：全部自建进程（后端、Rust 存储子进程、headless Chrome）按精确句柄关闭，`pgrep` 复核无残留；合成根与临时目录删除。

## 9. 处置建议

**不通过**，要求先修 BLOCKER-1 与 BLOCKER-2（均在候选 I 原写入范围内：`src/stores/settings.ts` 与 `src/stores/todos.ts`/`src/lib/web-api-client.ts` 的客户端实例共享），由 I 原作者修订 + 未参与者独审后，在明确的新集成版上重跑本旅程（原样快照、无诊断注入）与完整门禁。本验收不代签任何业务通过，不改 MAYNE-23 状态（保持 `in_progress`）。
