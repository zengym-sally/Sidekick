# MAYNE-23 切片 II 修订候选独立复审（OhMyPi，R2）

> 状态：**通过**（限 II 修订增量与受影响路径；3 项观察非阻断）。复审对象是切片 II 修订候选 `c24dc4a8c2b4d5c79a3bf68c86d45fb972530350..19418ef8c82de498318d80a39260d1c9778f29c3`（7 文件 +622/−201）。首轮审查 `fe8ac7b` 的 F-1/F-2/F-3 逐项复核关闭；未改且已过的部分沿用首轮证据，不重开。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b867-ae66-7bf3-85fd-c6c7cd240a68`。审查者未参与本套件编写。候选只读。
> 依据：冻结契约 `docs/engineering/web-manual-items-contract.md`（`8d752953…b70e8d`）、冻结 `web-api/1`（`61863271…f58d`）、队长 2026-11-08 接口补充裁定（`pairingCode`／顶层 `csrfToken`／`X-CSRF-Token`；未知 `status` 或无效 `limit` → 400 `validation_failed`；分页缺省 50、显式仅接受 1–200 整数）、候选 I 参数增量 `4052d47`（OpenCode 已独立通过）。

## 1. 登记与版本复算

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `fe8ac7b56a9e990caf2033da08ebc4be2ddb28ad` | 与派发一致 |
| 候选 HEAD / tree | `19418ef8c82de498318d80a39260d1c9778f29c3` / `85badfe11156af26c2e55735fa02d7ef6d156367` | `git cat-file -t` = commit |
| 提交链 | `c24dc4a` → `2110cd1`（tree `3e3fc773…`）→ `19418ef`；两段均为直接父子，无 squash/amend/rebase | 实测 |
| `19418ef` 自身 diff | 仅 1 行：修订记录中 `backend-process.mjs` blob 哈希更正为提交后字节 | 与候选说明一致（首版记录写了 `2110cd1` 的旧哈希） |
| 增量 diff（`git diff c24dc4a 19418ef`） | 1676→7 文件 +622/−201；SHA-256 `97dfd92aee0e3a1e086171ea74a1f8f2a0925eae493ad24f7ee297ba4f3d2cf5` | **＝候选申报值** |
| format-patch（`git format-patch c24dc4a..19418ef --stdout`） | SHA-256 `e585b642af0fe6f6e6bc9ea6b1d616968adff6fce13fe865dfe65653bb0240b1` | **＝候选申报值** |
| 基座血缘 | `65469904`（tree `7b71cdb3…`）为 `19418ef` 祖先 | `merge-base --is-ancestor` exit 0 |
| 未改文件 | `backend-child` `3e7f5ef7…`、`db-observer` `7f2c0428…`、`sse-listener` `0ec66505…`、`static-root` `9b4c4d3e…` 与 `c24dc4a` blob 逐一相等 | 实测 SAME |
| 改后文件 blob | http `fc2ce9287bc5ae70`、restart `2f88a2d473499848`、static `c66e8a4d61da772d`、backend-process `224a0b6b57e851c9`、browser-probe `57a0fdd65f4bede6` | 与候选申报一致 |

## 2. 独立复跑（本树实测，退出码与原始日志）

日志在 `build/web-manual-items-tests-r2-review/`：`syntax-check.log`、`ohmypi-r2-{http,restart,static}-prerequisite-gap.log`、`ohmypi-r2-check-structure.log`、`ohmypi-r2-structure-self-test.log`、`ohmypi-r2-check-docs.log`、`ohmypi-r2-diff-check.log`、`f1-verification.log`、`f2-verification.log`、`f3-verification.log`、`f3-overflow-check.log`、`cleanup-verification.log`、`evcheck.log`。

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（3 套件 + 6 夹具） | 0 | 9/9 |
| `node --test --test-timeout=20000` 三套件（真实目录布局） | 1/1/1 | tests 18/2/6，pass 0，fail 18/2/6，**全部 PrerequisiteGap**；失败后 `/tmp/web-manual-items-*` = 0 |
| `check:structure`（候选 11 文件写入本树） | 1 | 173 处 = 本树 `.omp/` 170 处 `top.dir` + `vendor/pi` 3 处 `ref.missing`，**全部基线既有，0 处引用候选文件** |
| `check:structure --self-test` | 0 | 22 类违规 + 8 引用违规检出，clean 不误报，002 原样通过/篡改拒绝 |
| `check:docs` | 0 | 20 文件 429 链接 |
| `git diff --cached --check` | 0 | 干净 |
| 自建 F-1 端到端（真实 SQLite + 修订夹具） | 0 | 6/6 |
| 自建 F-2 端到端（真实静态服务器，css-first / 混合 dist） | 0 | 6/6 |
| 自建 F-3 端到端（真实 headless Chrome + CDP） | 0 | 18/18 |
| 自建 F-3 溢出反例 | 0 | 溢出页被拒 |
| 自建失败清理 7 路径 | 0 | 12/12 |

## 3. F-1/F-2/F-3 逐项关闭证据

### F-1（首轮阻断）— **已关闭**

修订：A-6 开头 `const eventsBefore = tableCounts(backend.root).manualItemEvents`，末尾 `assert.equal(counts.manualItemEvents, eventsBefore + 3, 'the create/update/delete writes must be the only new event rows; replays and conflicts must not write events')`，并保留逐事项 `assert.deepEqual(events, ['create','update','delete'])`。

独立验证（`f1-verification.mjs`，用修订夹具 + 真实 SQLite，先在共享根写入 4 条事件复现首轮缺陷前提）：

- `PASS shared root carries earlier events (F-1 precondition) :: events=4`
- `PASS RETIRED assertion would fail here (global != per-item) :: global=5 perItem=1` —— 首轮永真失败的前提在本树复现
- `PASS REVISED assertion (globalBefore + 1) holds on correct data :: globalAfter=5 globalBefore=4`
- `PASS per-item action list is exactly [create]`

即修订式在正确数据上成立、在「重放多写一条事件」的坏实现下必然失败（增量不再是 3），可证伪性恢复。其余 12 处计数断言首轮已判定合法，本轮流式未动。

### F-2（首轮阻断）— **已关闭**

修订：`findHashedAsset()` → `findHashedAssets()`，枚举 `assets/` 下全部 `/-[…]{8,}\.[A-Za-z0-9]+$` 文件并 `.sort()`，按扩展名从 `HASHED_MIME`（js/mjs→javascript、css→`^text/css`、map→json、woff/woff2/ttf/otf、svg/png/jpg/jpeg/gif/ico/webp/avif）取期望，逐个断言 200 + MIME + 长缓存；未知扩展名 `assert.ok(expected, …)` 显式失败。

独立验证（`f2-verification.mjs`，真实 HTTP 静态服务器）：

- `PASS RETIRED selector picks the .css and its /javascript/ assertion fails :: picked=/assets/index-abc12345def6.css content-type=text/css` —— 首轮误拒前提复现
- `PASS REVISED extension dispatch passes on the css-only dist`
- `PASS REVISED selector returns every hashed asset in a mixed dist :: ["…css","…js","…woff2"]` + `PASS REVISED extension dispatch passes on the mixed dist`
- `PASS unclassified hashed extension is explicitly rejected by the map`

### F-3（首轮阻断）— **已关闭**

修订：退役 `--dump-dom`，改 `tests/fixtures/web-manual-items/browser-probe.mjs` 以 Chrome DevTools Protocol 驱动真实 headless Chrome（临时调试端口 + `/json/list` + WebSocket `Page.enable`/`Runtime.enable`/`Page.navigate`/`Runtime.evaluate`/`Page.captureScreenshot`），在被服务页面**内部**执行探针；`assertColdStartReport()` 为两种静态根模式共用的断言集：`origin` 相同、`app.present`、挂载判定（synthetic 查 `data-probe==='ready'`；真实 dist 查 `mounted && childElementCount>0 && textLength>0`）、`crossOriginRefs` 为空、页面自身同源 `/api/session` 与 `/api/events` 均为 401 + `application/json` + `contractVersion` + `error.code==='unauthenticated'`、`scrollWidth <= innerWidth`。

独立验证（`f3-verification.mjs` + `f3-overflow-check.mjs`，真实 Chrome 1440/640）：

- `PASS retired dump-dom assertion accepts the unmounted page :: dom contains <div id="app"> = true`
- `PASS revised CDP assertion REJECTS the unmounted page :: the application must mount into #app in the live DOM (childElementCount=0, textLength=0); an empty #app inside index.html is not evidence of a mounted UI`
- `PASS the unmounted page really has an empty #app :: {"present":true,"childElementCount":0,"textLength":0,"dataProbe":null}`
- `PASS the in-page probe still reached /api/session with the 401 envelope on the unmounted page`
- 1440px 与 640px：`ACCEPTS the mounted page` / `rendered elements and text into #app` / `no horizontal overflow` / `all static references same-origin` / `reached /api/events same-origin with the 401 envelope` 全部 PASS
- `PASS an overflowing page is REJECTED by the revised assertion :: the page must not overflow horizontally at 1440px (scrollWidth=3008, innerWidth=1440)` —— 溢出断言可证伪

即首轮三项缺陷的「退役式误签 / 漏签」均已被修订式堵住，且修订式本身在正反两向上都可证伪。

## 4. CDP 与失败清理生命周期

- **CDP 进程**：`probeWithChrome` 用 `try { … } finally { child.kill('SIGKILL') }` 包住全部 CDP 交互；`socket.close()` 在返回前执行；CDP `send()` 每调用 30s 上限且 `.unref()`；`waitForCdpTarget` 20s 上限。独立实测 `PASS the CDP probe leaves no chrome process behind :: before=0 after=0`（pgrep 前后均为 0）。
- **待定定时器**：子进程路径新增 `timers` Set + `armTimer`，`release()` 先 `clearTimeout` 全清再 kill 子进程并 `rmSync(configDir)`；`waitFor` 的 resolve/reject 两条分支都 `clearTimeout(timer); timers.delete(timer)`。
- **in-process 路径**：`ownsRoot = options.root === undefined`，try/catch 中 `handle.close()` + 仅删除自建根。独立实测 6 项：配对码超时仍报错且不泄漏临时根、缺 `startWebBackend` 导出 → `PrerequisiteGap` 且不泄漏、入口文件缺席 → `PrerequisiteGap` 且不泄漏、child 配对码超时报错且不泄漏 `configDir`、child 入口缺席 → `PrerequisiteGap` 且不泄漏 `configDir`、**调用方自备根在失败后不被删除**（`PASS a caller-supplied root survives a failed start`）。
- **套件层**：三套件 before 失败后 `/tmp/web-manual-items-*` = 0；`after()` 中 `backend?.close()` 与 `rmSync(syntheticRoot)` 照旧。
- **SSE 句柄**：http 的 `stream`/`reconnect`、restart 的 `stream`/`hintStream` 仍在 `finally` abort；restart 中 `stream` 在 `killHard()` 前已关。本轮未改动这些路径。

## 5. 固定线格式与非秘密证据

- **字面名已固定为常量**：`PAIR_FIELD='pairingCode'`、`CSRF_RESPONSE_FIELD='csrfToken'`、`CSRF_HEADER='X-CSRF-Token'`；`pairRequestBody(code)` 是唯一构造点；`readSession` 严格读顶层 `csrfToken`，**无兜底**，缺 token 时抛错并说明检查过的字段。`WEB_MANUAL_ITEMS_PAIR_FIELD`/`WEB_MANUAL_ITEMS_CSRF_HEADER` 已从源码中删除（全树 grep 无残留）。
- **与候选 I 实测一致**：`4052d47` 的 `http-server.mjs` 读 `body.pairingCode`（注释明写无别名兜底）、响应顶层 `csrfToken`、写请求读 `req.headers['x-csrf-token']`（HTTP 头名大小写不敏感，与 `X-CSRF-Token` 等价）；`manual-items-service.mjs` 的 `ALLOWED_STATUSES=['open','completed','deleted','all']` 未知即 `validation_failed`，`parseLimit` 缺省返回 `DEFAULT_LIMIT`、显式须 `Number.isInteger` 且 1..`MAX_LIMIT` 否则 `validation_failed`，无静默钳制。测试与实现双向对齐。
- **`nextCursor` 空值语义一致**：候选 I 两处均显式 `: null`；测试用严格 `assert.equal(…, null)`，不会因 `undefined`/`''` 误通过。
- **非秘密配置证据**：三套件 before 成功后写 `build/web-manual-items-tests/{http,restart,static}-effective-config.json`，内容为 `pairBodyField`/`csrfResponseField`/`csrfRequestHeader`/`listLimit`/`artifacts`/`node`/`platform`/`generatedAt`/`suite`/`staticRootMode`。实测 dump（`evcheck.log`）确认无码、无 cookie、无 CSRF token、无凭据。证据目录 `/build/` 已被 `.gitignore:11` 忽略，不入库。
- **design/ 原型机器拒绝**：`rejectPrototypeRoot()` 对 `repositoryRoot/design` 及其子路径抛错；`resolveSuiteStaticRoot()` 三个分支都过该检查。实测 `design`、`design/prototype` 均被拒、普通临时目录放行。

## 6. 既有断言未削弱

- **无测试被删或改名削弱**：http 17→18（新增 A-3 limit/status 专例），restart 2→2，static 6→6（2 个 test 名改写为描述更强断言）。`diff` 仅出现 `>` 新增行，无 `<` 删除的 test 声明。
- **关键断言计数不降**：`HttpOnly`/`SameSite=Strict`/`Domain=`/`pair_code_invalid`/`pair_rate_limited`/`csrf_invalid`/`origin_rejected`/`item_not_found`/`version_conflict`/`idempotency_conflict`/`state_conflict`/`replayed`/`MINOR-1`/`sequence DESC`/`stream.reset`/`stream.ready`/`item.changed`/`taskEvents`/`SIGKILL` 全部 R1=R2；`validation_failed` 7→12、`assertEnvelope` 25→28、`nextCursor` 4→7（增强）。
- **`unauthenticated` 7→5 的甄别**：减少的 2 处是 static 套件内联断言，已上移到 `browser-probe.mjs` 的 `assertColdStartReport`，且该函数被**两种模式共用**——真实 dist 模式从「只查 `#app` 与跨源引用」变为**也**断言 `/api/session`、`/api/events` 的 401 信封，是增强不是削弱。
- **预算**：`--test-timeout=20000` 未变；http/restart 的 before 与 static 的 before/浏览器例仍为 `timeout: 60000`（与 R1 相同）。唯一消失的 45000 是退役 `--dump-dom` 路径内 `execFile` 的超时，随该路径一起移除。新增 A-3 例创建 51 个事项，实测同等请求量在回环后端 185ms（mock）；即使真实 Rust 存储按每次写 5–20ms 计也在 1s 量级，远低于 20000ms，且 before 钩子独立 60000ms。**预算未放宽**。

## 7. 观察项（非阻断）

- **OBS-1 真实 dist 模式的挂载判据对产品 UI 是必要的但尚未实测**：`assertColdStartReport` 在 `mode!=='synthetic'` 时要求 `#app` 有元素子节点与非空文本。这对 Sidekick 的 Vue 应用应当成立（`Workbench` 会渲染内容），但本树无真实 dist，未跑过。集成轮首次以 `mode='packaged'` 运行时若产品 UI 因配对门先渲染空态，可能需要按实际首屏调整判据（例如允许配对门文案作为「已挂载」证据）。这是集成轮的可预期调整点，不是候选缺陷。
- **OBS-2 CDP 内部各步 30s 上限之和（约 170s）大于该例 60000ms 声明**：实际每步毫秒级返回，60s 宽裕；若某步挂起，测试超时后 `finally` 仍会 `SIGKILL` chrome，不会泄漏进程（已实测）。建议集成轮如遇 flaky 再收紧单步上限。
- **OBS-3 存储子进程退出仍未进套件**：候选 I 的模块对接约定 1 承诺 `close()` 等待存储子进程退出与锁释放，但夹具看不到生产侧 spawn 命令行，ps 断言有误伤风险，故只以 `probe-storage-exit.mjs`（mock）验证机制。集成轮在可见真实 spawn 后应补该断言。首轮已列为不阻断建议，本轮维持。
- **OBS-4 有效配置证据含本机绝对路径**：`artifacts` 三个字段是 `repositoryRoot` 派生的绝对路径。证据落在 gitignored `/build/`，不入库、不违反「本机私有路径不入库」；但若把该 JSON 作为评论附件上传，会暴露机器路径。建议集成轮上传证据前对 `artifacts` 做仓库相对化，或只上传摘要。

## 8. 未验项（如实开放）

- 任何业务行为仍未执行：端点、持久化、重启恢复、同源静态、浏览器矩阵依赖候选 I/III 齐备后按显式测试配置或 `npm run build:backend` 默认产物在实际集成版执行。本复审只签「修订可证伪 + 机制有效 + 前置缺口如实失败 + 既有断言未削弱」。
- 真实产品 dist 的浏览器冷启动（挂载/同源 API/SSE/640px 不溢出）未实测，只以自建 mock 静态根验证了断言机制的正反两向。
- CLI 路径（`--root/--port/--static-root/--storage-bin/--init`）仍未被套件直接 exercise。
- 完整 `npm run check` 与 cargo 未跑（按派发留唯一集成者）；候选 I 的 MAJOR-1（并发败者幽灵历史）由 Claude 另批修订，不属本复审范围。
- Linux/代理、真实凭据/用户根/模型未涉及。

## 9. 处置

**通过**（限 II 修订增量与受影响路径）。F-1/F-2/F-3 三项首轮阻断缺陷均已以可证伪的方式关闭，并有本树独立正反例证据；失败清理、CDP 生命周期、固定线格式、非秘密证据、既有断言与预算均符合派发要求。OBS-1–OBS-4 提交集成轮处理，不阻断。MAYNE-23 保持 `in_progress`；实际集成后的完整浏览器用户旅程按派发另行分派，本复审不代签任何业务通过。
