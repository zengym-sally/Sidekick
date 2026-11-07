# MAYNE-23 切片 II 修订交付（Kimi）：F-1/F-2/F-3 退修 + 线格式固定 + 失败清理 + 真实 dist 断言

> 状态：**修订候选已交付，未验业务**。本篇是 MAYNE-23 派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 对切片 II 候选 `c24dc4a` 的退修（r2）：按 OhMyPi 独立审查 `fe8ac7b` 的 F-1/F-2/F-3 与第 6/7 节建议，以及队长 2026-11-08 接口补充裁定（配对字段 `pairingCode`、响应顶层 `csrfToken`、写头 `X-CSRF-Token`、未知 `status`/无效 `limit` 400 `validation_failed`、`limit` 缺省 50 且显式仅接受 1–200 整数）修订。原候选交付记录见 [web-manual-items-tests-20261108.md](web-manual-items-tests-20261108.md)（其 §3 接口假设已被本轮裁定取代）；审查记录 `docs/reviews/web-manual-items-tests-20261108-ohmypi-review.md` 在 OhMyPi 树。证据约定见[验证约定](../engineering/verification.md)。

## 1. 逐项处置

| 项 | 审查发现 | 处置 |
|---|---|---|
| F-1（阻断） | `web-manual-items-http.test.mjs:424` 把**全局** `manual_item_events` 计数与**单事项**计数比较；共享 file-level 后端根在 A-6 前已累计约 10 条事件而本事项仅 3 条，等式永不可能成立，A-6 对任何正确实现都失败 | 测试开头捕获 `eventsBefore`，改为 `assert.equal(counts.manualItemEvents, eventsBefore + 3, …)`（创建/更新/删除是唯一新增事件行），保留逐事项 `deepEqual(['create','update','delete'])`。反例：`probe-f1-events.mjs`（合成库 + 只读观测器复现：退役行在正确实现下失败、修订行在正确数据通过、在"重放多写一条事件"的坏实现下两者都失败） |
| F-2（阻断） | 真实 dist 模式 `findHashedAsset()` 取 `readdirSync` 首个匹配不区分扩展名，Vite 产物 `index-<hash>.css` 字典序在 `.js` 前时返回样式表却断言 `/javascript/`，候选 I/III 落地后必现行 | 改 `findHashedAssets()` 返回全部 hash 资产，按扩展名分发 MIME 期望（js→javascript、css→text/css、字体/图片各自映射），逐个断言 200 + MIME + 长缓存；未知扩展名显式失败要求有意识扩表。反例：`probe-f2-hashed-asset.mjs`（仅含 hash 样式表的 dist：退役选择器必返回 `.css`，`/javascript/` 对 `text/css` 失败；修订分发对该 dist 与混合 dist 均通过） |
| F-3（阻断） | 真实 dist 模式浏览器例只断言 `<div id="app"` 与跨源引用；`#app` 来自静态 index.html，Vue 未挂载也满足；契约 §9.4「再同源访问 /api 与 SSE」与宽窄屏在真实 dist 模式下完全没有断言（合成模式反而更全） | 浏览器检查改走 Chrome DevTools Protocol，在**被服务页面内部**执行探针（`tests/fixtures/web-manual-items/browser-probe.mjs`）：等待并断言应用挂载（`#app` 出现元素子节点且非空文本——空 `#app` 明确不算挂载）、全部静态引用同源、页面自身同源访问 `/api/session` 与 `/api/events` 得 401 JSON 信封（`contractVersion`+`error.code`）、两档 1440/640 的 `scrollWidth <= innerWidth` 不溢出；截图与实时 DOM 落证据。两种静态根模式跑同一断言集（`assertColdStartReport` 共享）。反例：`probe-f3-mounted.mjs`（未挂载页：退役 dump-dom 断言通过（空洞）、修订断言拒绝；已挂载页：修订断言通过，含 640px 溢出测量） |
| 失败清理（第 6 节，同批补） | `startBackendChild` 在配对码超时/`pair`/`readSession` 抛错时不 kill 子进程、不清 `configDir`，restart 重试循环每次失败泄漏一个临时目录；in-process 助手在配对失败（甚至普通前置缺口）时泄漏后端句柄与临时根 | 两条路径都包 try/catch：in-process 失败即 `handle.close()` 并删除自建临时根（前置缺口时不再创建根）；child 失败即 SIGKILL 子进程、清除待定定时器并删除 `configDir`。反例：`probe-cleanup.mjs`（对 `c24dc4a` 原夹具逐路径复现泄漏：服务器/子进程/根/目录各 +1；修订夹具全部为 0；本树三套件 before 钩子失败后 `/tmp` 无残留） |
| 显式静态根拒绝 design/原型（第 7 节①，同批补） | `WEB_MANUAL_ITEMS_STATIC_ROOT` 可指向 design/ 原型，契约 §9.4 禁止以设计预览代替验收，原先只有"证据记录 root 路径"的事后审计 | 夹具 `rejectPrototypeRoot()`/`resolveSuiteStaticRoot()` 在浏览器启动前机器拒绝位于仓库 `design/` 下（含自身）的显式静态根，普通目录放行。反例：`probe-wire.mjs`（`design`、`design/prototype`、`design/web-task-flow` 全部抛错；`resolveSuiteStaticRoot` 在 before 阶段即拒绝） |
| 去除可改变线格式的环境覆盖 + 非秘密配置证据（第 7 节②，同批补） | `WEB_MANUAL_ITEMS_PAIR_FIELD`/`WEB_MANUAL_ITEMS_CSRF_HEADER` 可把字面名切到非标准值，与"不靠环境变量静默改业务契约"相抵；生效字面名未落入任何运行证据 | 两个字面名改为常量 `PAIR_FIELD='pairingCode'`、`CSRF_RESPONSE_FIELD='csrfToken'`、`CSRF_HEADER='X-CSRF-Token'`（`pairRequestBody()` 单一构造点），`readSession` 严格读顶层 `csrfToken` 不兜底；环境变量只剩指向本树产物的 `WEB_MANUAL_ITEMS_{ENTRY,STORAGE_BIN,STATIC_ROOT}`。三套件 before 成功后写 `build/web-manual-items-tests/{http,restart,static}-effective-config.json`（生效字面名、limit 规则、产物路径、node/平台；不含码/cookie/token/凭据）。反例：`probe-wire.mjs`（敌对环境变量下字面名不变、`pairRequestBody` 仍发 `{pairingCode}`、夹具源码不再引用被删变量） |
| `limit`/`status` 参数规则（新增登记） | 原候选只断言 `limit=201` 与未知 `status` 两例 | 新增专例（A-3）：缺省页大小 50（51 项→首页 50 + nextCursor，次页 1）、`limit` 显式仅接受 1–200 整数（1/50/200 通过；201/0/-1/1.5/abc 均 400 `validation_failed`）、history 同规则、未知 `status` 400 |
| 存储子进程退出断言（第 6 节建议，不阻断） | 模块对接约定 1 承诺 close 等待存储子进程退出与锁释放；审查建议候选 I 落地后补断言 | 未进套件（真实 entry 的 spawn 命令行本树不可见，ps 断言有误伤风险）；先以 `probe-storage-exit.mjs` 对 mock 验证机制（close 前可见携带 storageBin 路径的进程、close 后为 0），供集成轮在可见真实 spawn 后采纳为套件断言 |

## 2. 版本与文件哈希（git blob 前 16 位）

| 文件 | blob | 变更 |
|---|---|---|
| `tests/integration/web-manual-items-http.test.mjs` | `fc2ce9287bc5ae70` | 18 例（+1 limit 专例）；F-1 修订；`pairingCode` 字面；effective-config 证据 |
| `tests/integration/web-manual-items-restart.test.mjs` | `2f88a2d473499848` | 2 例；effective-config 证据；头注同步 |
| `tests/integration/web-manual-items-static.test.mjs` | `c66e8a4d61da772d` | 6 例；F-2/F-3 修订；design 拒绝走夹具；证据扩充 |
| `tests/fixtures/web-manual-items/backend-process.mjs` | `63b9a26a073ae046` | 字面名常量、失败清理、design 拒绝、effective-config/writeEvidence |
| `tests/fixtures/web-manual-items/browser-probe.mjs` | `57a0fdd65f4bede6` | 新增：CDP 驱动 + 页面内探针 + 共享冷启动断言 |
| `tests/fixtures/web-manual-items/{backend-child,db-observer,sse-listener,static-root}.mjs` | 未变（`3e7f5ef7…`/`7f2c0428…`/`0ec66505…`/`9b4c4d3e…`） | — |

精确提交 SHA/tree 与相对 `c24dc4a` 的补丁哈希见派发线程回帖；admission（含 pwd/branch/HEAD/祖先核对/写入范围/评审者登记）随评论附件。

## 3. 本机已执行验证（均非完整门禁）

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（3 套件 + 6 夹具） | 0 | 9/9 |
| `node --test --test-timeout=20000` 三套件 | 1/1/1 | tests 18/2/6，全部 PrerequisiteGap（缺 I/III 产物），无跳过关键断言；失败后 `/tmp` 无 `web-manual-items-*` 残留 |
| `node scripts/checks/check-structure.mjs --self-test` | 0 | 22 类违规 + 8 处引用违规检出，clean 不误报 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | 1 | 173 处**全部为先存环境条件**（`.kimi/` CLI 技能目录 170 处 `top.dir`、未构建 `vendor/pi` dist 3 处 `ref.missing`），0 处引用本切片文件（与上轮同口径） |
| `node scripts/checks/check-docs.mjs` | 0 | 20 文件 429 链接 |
| `git diff --check` | 0 | 干净 |
| `build/web-manual-items-tests/coverage-check.mjs`（重建） | 0 | 48/48：§5 端点、错误码、A-1–A-9、M1/M2/MINOR-1/n1 与 §2/§9 语义均被套件/夹具引用（上轮 `build/` 证据随平台回收工作树丢失，脚本按同一口径重建，非原文） |
| `probe-f1-events.mjs` | 0 | 见 §1 F-1 反例 |
| `probe-f2-hashed-asset.mjs` | 0 | 见 §1 F-2 反例 |
| `probe-f3-mounted.mjs` | 0 | 见 §1 F-3 反例（真实 Chrome，headless） |
| `probe-cleanup.mjs` | 0 | 见 §1 失败清理反例（退役夹具 8 项泄漏全部复现；修订夹具 8 项全 0；进程/目录收尾干净） |
| `probe-wire.mjs` | 0 | 见 §1 线格式/design 反例 |
| `probe-storage-exit.mjs` | 0 | 见 §1 存储退出机制验证（mock） |

探针与 mock（`mock-entry.mjs`、`mock-static-server.mjs`、`old-fixture/` 退役夹具副本）只在 `build/web-manual-items-tests/`（gitignored），随评论附件交付；它们只证断言/清理机制可证伪，不签任何业务行为。

## 4. 未验项与边界

- 任何业务行为仍未执行：端点、持久化、重启恢复、同源静态、浏览器矩阵等候选 I/III 齐备后按显式测试配置（`WEB_MANUAL_ITEMS_ENTRY`/`WEB_MANUAL_ITEMS_STORAGE_BIN`/`WEB_MANUAL_ITEMS_STATIC_ROOT` 指向本树 source 入口/cargo 产物/dist，或 `npm run build:backend` 后的默认产物）在实际集成版执行；本交付只签"修订可证伪 + 机制有效 + 前置缺口如实失败"。
- 真实 dist 浏览器路径（挂载/API/SSE/溢出）只在 mock 静态根上验证了断言机制；产品 UI 的 640px 不溢出等结论以集成轮实测为准。
- CLI 路径仍未被套件直接 exercise；完整浏览器用户旅程按派发归独立验证；完整 `npm run check` 与 cargo 未跑（留唯一集成者）。
- Linux/代理、真实凭据/用户根/模型未涉及；`node:sqlite` 实验性警告只进 stderr。
- 存储子进程退出断言待集成轮采纳（§1 末行）；MAYNE-23/父任务状态未动，未 push、未部署。

## 5. 交付物

分支 `agent/kimi/mayne-23` 上相对 `c24dc4a` 的新提交（精确 SHA 见派发线程回帖）：三个修订套件、修订夹具、新增 `browser-probe.mjs`、本篇记录。随评论附件：admission.json、三套件前置缺口日志、守卫/文档/覆盖日志、六个探针与两个 mock 脚本、退役夹具副本。
