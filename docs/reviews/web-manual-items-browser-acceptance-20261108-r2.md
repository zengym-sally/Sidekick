# MAYNE-23 W1 最终独立验收：原样真实产品 UI 完整业务旅程（OhMyPi，冻结版 eca807b）

> 状态：**通过**（限本冻结版 `eca807b6d1911c115abffbb45a9371f38be4b801`／tree `9371002bd327e4ce0deee0488d097321dd9982bf`；34/34 项通过，0 阻断）。审查者未参与生产实现。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b99b-eefe-71b5-bd62-f113c8385359`；任务描述「2026-11-08 第五轮门禁已绿：最终独立验收准入」。
> **原样（AS-SHIPPED）**：无 Tauri 诊断垫片、无合成探针页、无绕开 UI 的业务写入。先前 `79774c9`（旧快照 `404a2bc`）的两处阻断结论与诊断矩阵**不签本版**——本版源码已变，全部矩阵在本版重跑。
> 依据：冻结契约 `docs/engineering/web-manual-items-contract.md` §3 用户路径、§4 字段与时间语义、§5 端点、§9.4 同源静态供给、§11 端到端可观察验收；P2 九条矩阵 A-1–A-9。

## 1. 登记与版本核对

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `98fb349630e37999b7566f669fc1cc26c800b6a8` | 与派发一致 |
| 冻结 commit / tree | `eca807b6d1911c115abffbb45a9371f38be4b801` / `9371002bd327e4ce0deee0488d097321dd9982bf` | `git cat-file -t` = commit |
| 回执 | `8902594b8d7c2ea78bc420add247a0961d7a8995`，相对冻结版**仅 1 文件 +11 行**（集成记录） | `git diff --stat` |
| 源码确已变化 | `404a2bc` → `eca807b` 在 `server/entries`、`http-server`、`manual-items-service`、`sse-hub`、`src/App.vue`、`Workbench.vue`、`web-api-client.ts`、`pairing.ts`、`todos.ts`、`settings.ts`、`package.json` 均 CHANGED | 逐文件 blob 比对 |
| 取用方式 | `git archive eca807b` 导出，20 个关键文件 blob 与冻结版逐一相等 | 实测 |

## 2. 真实产物准备（全部用仓库既有命令，非桩）

| 步骤 | 命令 | exit | 结果 |
|---|---|---|---|
| 依赖 | `npm ci --ignore-scripts` | 0 | 107 packages |
| cli 前置 | `npm run probe:prepare-cli` | 0 | lark-cli v1.0.98 |
| pi 前置 | `npm run probe:prepare-pi` | 0 | vendor/pi 校验后真实构建，commit `ad702637…`、tree `e89822b0…` |
| runtime 打包 | `npm run probe:bundle` | 0 | `build/s0-runtime` 就位（tauri `build.rs` 资源前置） |
| 前端 dist | `npm run build` | 0 | `index-CAsbIzss.js` 731.64 kB + `index-hW-4LRhn.css` + `SpaceGrotesk-*.ttf` |
| 存储二进制 | `cargo build --release --bin web-backend-storage` | 0 | 2 633 392 B，SHA-256 `b7dd9339598418a18858ed5b7d2dd8ffbf568aff6ef324fd152273421af36422` |
| 后端装配 | `npm run build:backend` | 0 | `build/web-backend/`＝server 源＋shared 1 模块＋存储二进制＋dist→static/ |

**产物哈希（本版真实产品）**

```
b7dd9339598418a18858ed5b7d2dd8ffbf568aff6ef324fd152273421af36422  build/web-backend/bin/web-backend-storage
ef649416d21062d88ffcef7b1619d556d28da732948247048d256f737e1939e3  build/web-backend/static/index.html
2706d6277641eada5cddb9a4923112818f6c9d7587ad801ce2c1320157bfc4f2  build/web-backend/static/assets/index-CAsbIzss.js
e32614bd9d15fcab15d725612c6c87b07278c5afc36c4d931a9544e454af1583  build/web-backend/static/assets/index-hW-4LRhn.css
acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72  build/web-backend/static/assets/SpaceGrotesk-Dcw4Q7AU.ttf
bff28c8749e9268e58a078c04104d2197a8f2760c37f4737a849da87fc2cca91  build/web-backend/server/entries/web-backend-entry.mjs
```

存储二进制 SHA-256 与集成者第五轮回执申报的 `b7dd9339…6422` **一致**。

## 3. 方法（不绕过 UI、不签合成页）

- 后端：`startWebBackend({ root: <显式合成根>, port: 0, staticRoot: <真实 dist>, storageBin: <真实二进制>, initialize: true, onPairingCode })`。配对码**只**经私有回调内存取得，并只进入 `POST /api/pair` 请求体（由产品 UI 的表单提交）。
- 浏览器：真实 headless Chrome 经 DevTools Protocol 驱动，导航到 `http://127.0.0.1:<port>/`。**未调用 `Page.addScriptToEvaluateOnNewDocument`**（无诊断垫片）。所有业务动作走产品 UI 真实控件：配对输入框、`#quick-entry`、捕获对话框（标题、事项类型 combobox、实际负责人、`TimeField` 的「设置交付截止／仅日期」复选框 + 日历弹窗）、经 `button.task-title` 打开的详情对话框（「标记完成／重新打开／删除事项」）与「确认删除」确认框、设置面板。
- 观测：页面自身同源 `fetch`（带会话 cookie）＋真实 HTTP＋只读 SQLite（`node:sqlite` `readOnly`，同一合成根）三方互证。
- 运行拆分：旅程分多个前台运行完成（每阶段需全新后端＋浏览器，且运行窗口有界）；每次使用**同一冻结源、同一真实产物、同一合成根协议**。合并矩阵见 `combined-matrix.json`。

## 4. 结果矩阵（34/34 PASS）

### 4.1 冷启动／配对／创建（13 项）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| COLD-1440 | 后端同源产品 UI 1440px 挂载、无启动错误 | **PASS** | `origin=http://127.0.0.1:<port>`、`#app children=1`、`scrollWidth=1440/1440`、`title="跟班 Sidekick"`、`startupError=false` |
| PAIR-GATE | 未配对只见配对门，无工作台无数据 | **PASS** | 唯一输入「配对码」、唯一按钮「进入工作台」 |
| PAIR-CODE-CHANNEL | 配对码只经 `onPairingCode` 私有回调取得 | **PASS** | `length=8` |
| SESSION | 配对后同源 `GET /api/session` 200＋顶层 `csrfToken`＋capabilities | **PASS** | `["workspace.manage","workspace.backup"]` |
| CREATE-ACTION | UI 创建「待我处理」落 1 行 1 事件 | **PASS** | `items 0->1, events 0->1`；截止 `2026-11-20 09:00` |
| CREATE-FOLLOWUP | UI 创建「待我跟进」落 1 行 1 事件 | **PASS** | `items 1->2, events 1->2`；截止与跟进分别 `2026-11-20 09:00`／`2026-11-25 09:00` |
| CREATE-DAY-PRECISION | UI 创建仅日期事项落 1 行 1 事件 | **PASS** | `items 2->3`；`2026-12-01` |
| LIST-TWO-KINDS | 列表两类事项与库行一致 | **PASS** | `["action/v1:…","followup/v1:…","action/v1:…"]`，逐条 version 相符 |
| CREATE-ACTION-UI | 创建项在产品列表可见 | **PASS** | 三条标题均在列表 |
| DETAIL | 详情读回与列表同版本同字段 | **PASS** | `v=1`、`due.precision=minute`、`localText=2026-11-20T09:00` |
| TIME-INDEPENDENCE | `due` 与 `followup` 独立、互不改写 | **PASS** | `action.followup=null`；`followup.due=2026-11-20T01:00Z`、`followup.followup=2026-11-25T01:00Z` |
| TIME-DB | 库中两时间独立、精度保留 | **PASS** | `action(due=1795136400000,followup=null)`；`followup(due=…,followup=1795568400000)`；`day(prec=day,local=2026-12-01)` |
| TIME-DAY-PRECISION | 仅日期保留 `precision=day` 与原表达 | **PASS** | `precision="day"`、`localText="2026-12-01"`、`at="2026-11-30T16:00:00.000Z"` |

### 4.2 编辑（2 项）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| EDIT | UI 编辑后版本递增、标题更新 | **PASS** | `from=1 to=2 title=…（已修订）` |
| EDIT-DB | 库行与事件历史一致 | **PASS** | `db v=2 events=create,update` |

### 4.3 生命周期／历史／删除（6 项，探针驱动，同构建同控件）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| COMPLETE | UI 完成后 `completed`＋`completedAt`＋版本+1 | **PASS** | `status=completed v=2 completedAt=2026-11-08T05:52:27.440Z` |
| REOPEN | UI 重开回 `open`、清 `completedAt`、版本+1 | **PASS** | `status=open v=3 completedAt=null` |
| LIFECYCLE-DB | 库行一致（open、`completed_at_ms` 清空、版本连续） | **PASS** | 详情对话框脚标为「标记完成／重新打开／删除事项／编辑／延期」 |
| HISTORY | 详情对话框显示本地活动历史，与 API `sequence DESC` 一致 | **PASS** | `api=reopen,complete,create`；UI「重新打开／标记完成／手工录入」 |
| DELETE | UI（含显式确认）软删并移出默认清单 | **PASS** | `status=deleted v=4 deletedAt=… inDefaultList=false inAllList=true` |
| DELETE-DB | 软删行可读、`deleted_at_ms` 置位、历史完整 | **PASS** | `db status=deleted`，事件 `create,complete,reopen,delete` |

### 4.4 设置时区持久／CAS／无模型（6 项）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| SETTINGS-READ | 页面同源可读应用设置时区 | **PASS** | `status=200`，`timeZone` 为字符串、带 `version` |
| SETTINGS-CAS-STALE | 陈旧 `expectedVersion` 的 CAS 写被拒 409 `version_conflict`，存储值不变 | **PASS** | `stale=409 version_conflict`、重读 body 与写前逐字节相同 |
| SETTINGS-CAS-WRITE | 当前版本 CAS 写成功并递增版本 | **PASS** | `status=200`、`version+1`、`tz=Europe/Paris` |
| SETTINGS-DB | 只读合成库 settings 行带写入值时区与版本 | **PASS** | `time_zone=Europe/Paris`、`version` 与响应一致 |
| SETTINGS-PERSIST-RESTART | 写入时区在同根重启后仍在 | **PASS** | 重启后 `Europe/Paris`、version 不变 |
| NO-MODEL | 全程无模型配置，`tasks`/`task_events` 恒 0 | **PASS** | `tasks=0 taskEvents=0` |

### 4.5 SSE／重启（9 项）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| UNAUTH-401-GATE | 未配对页面被告知配对（`GET /api/manual-items` 401 `unauthenticated`） | **PASS** | `pairing=true quickEntry=false listStatus=401 listCode=unauthenticated` |
| SSE-FIRST-SUBSCRIBE | 配对页面首次 SSE 订阅收到 `stream.ready` | **PASS** | `contractVersion=web-api/1`、`epoch=inst_a650debfd5b4` |
| SSE-HINT | `item.changed` 提示到达页面、无 `id` 行、不进任务 cursor | **PASS** | `id=""`、`objectType=item`、`contractVersion=web-api/1`、`itemVersion=2` |
| SSE-COMPENSATION | 提示后读回得到另一客户端权威版本 | **PASS** | `v=2 title=另一标签页的修改` |
| SSE-NO-TASK-EVENTS | 事项提示不写 `task_events` | **PASS** | `taskEvents=0` |
| RESTART-ROOT | 同根新实例可重开（根锁释放） | **PASS** | `http://127.0.0.1:<port>` |
| RESTART-DATA | 重启后事项/版本/状态逐条重现、无重复 | **PASS** | `items 2->2, events 3->3, rowsIdentical=true` |
| RESTART-HISTORY | 重启后历史逐条重现 | **PASS** | `before=[create] after=[create]`（本阶段未执行删除） |
| RESTART-UI-REPAIR-SAVE | 重启后产品 UI 可再次配对且经 UI 保存落库 | **PASS** | `paired=true saved=true allCount=3` |

### 4.6 窄屏（1 项）

| ID | 验收项 | 结果 | 证据 |
|---|---|---|---|
| COLD-640 | 640px 窄屏同源挂载、不横向溢出、无启动错误 | **PASS** | `scrollWidth=640/640`、`startupError=false` |

**合计 34/34 PASS，0 FAIL。**

## 5. 两处旧阻断在本版的关闭证据

- **BLOCKER-1**（`src/stores/settings.ts:17` 仍绑定 Tauri `invoke` → `boot()` 抛 `Cannot read properties of undefined (reading 'invoke')`）：本版 `COLD-1440`/`COLD-640` 均 `startupError=false`，`PAIR-VIA-UI` 输入配对码后 `#quick-entry` 出现并进入工作台，**无任何诊断垫片**。
- **BLOCKER-2**（`todos.ts` 与 `pairing.ts` 各自 `new WebApiClient()`，写客户端永不持 CSRF）：本版 `CREATE-ACTION`/`CREATE-FOLLOWUP`/`CREATE-DAY-PRECISION` 均经产品 UI 保存并落库（`items 0->1`、`1->2`、`2->3`），`EDIT`/`COMPLETE`/`REOPEN`/`DELETE`/`SETTINGS-CAS-WRITE`/`RESTART-UI-REPAIR-SAVE` 全部经 UI 写成功——共享 CSRF 客户端已生效。

## 6. 可复核原始证据

均在 `build/web-manual-items-browser-acceptance-r2/`（gitignored，随评论附件交付）：

- `admission.json`、`combined-matrix.json`（34 项合并矩阵）、`artifact-hashes.txt`。
- `snapshot/` — `git archive eca807b` 导出树 + 全部真实构建产物。
- `acceptance-cd.mjs`（phase C/D 驱动）、`acceptance-c2.mjs`（设置/CAS/无模型/重启持久驱动）、`probe-lifecycle.mjs`（生命周期/历史/删除控件探针）。
- 日志：`acceptance.log`、`acceptance-d.log`、`acceptance-c2.log`、`probe-lifecycle.log`、`npm-ci.log`、`prepare-cli.log`、`prepare-pi.log`、`probe-bundle.log`、`vite-build.log`、`cargo-build.log`、`build-backend.log`。
- `snapshot/evidence/`：`01-cold-start.json`、`03-paired.json`、`05-list.json`、`06-edit.json`、`c2-settings.json`、`d-sse.json`、`d-after-restart.json`、`matrix.json`、`matrix-D.json`；截图 `02-pairing-gate-1440.png`、`04-workbench-1440.png`、`d-pairing-gate.png`、`d-after-restart.png`。

## 7. 未验项与收尾

- 完整 `npm run check`（51 组）由唯一集成者在冻结 `eca807b` 上跑完并回报 exit 0（第 47 组真实打包、第 50 组 `build:backend`、第 51 组 `test:web-manual-items` 59/59），本验收**不重复完整门禁**，仅绑定本版源码/产物。
- 旅程因运行窗口限制拆多个前台运行完成，未在单一进程内连续跑完全部 34 项；各阶段使用同一冻结源、同一真实产物、同一合成根协议。
- 集成公共增量（回执 `8902594` 的接入与公共面、契约附录 B、`package.json` 仅追加 fixture 回归）由 Kimi 并行只读复核，不属本验收范围。
- Linux/代理、真实凭据/用户工作根/真实模型在授权边界外，未涉及。
- 收尾：全部自建进程（后端、Rust 存储子进程、headless Chrome、node 驱动）按精确句柄 kill，`pgrep` 复核为 0；临时目录删除；其他 agent 进程未触碰。

## 8. 处置

**通过**（限冻结版 `eca807b6`）。原样真实产品 UI 完整业务旅程 34/34 通过：1440/640 同源挂载不溢出、配对进工作台（BLOCKER-1 关闭）、无模型、两类事项与独立 `due`/`followup` 及 `minute`/`day` 精度、CRUD/完成/重开/软删/历史、编辑版本递增、删除后变更 409、版本冲突、设置时区持久与 CAS、会话内 401 回门、SSE 首订阅/提示/读回补偿、同根重启恢复与重启后重配对保存；页面动作、真实 HTTP 与只读合成 SQLite 三方互证。本结果**只绑定本版**（冻结 `eca807b`／tree `9371002b`／存储二进制 `b7dd9339…`／dist `index-CAsbIzss.js`）；后续任何源码/静态产物/配置变更须对受影响路径重验。MAYNE-23 保持 `in_progress`；main 合入/清分支由队长按 owner 既有授权确认精确版本后安排。
