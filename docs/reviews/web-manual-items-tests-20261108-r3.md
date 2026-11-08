# MAYNE-23 切片 II 二次退修交付（Kimi）：F-3/F-5/F-6 修复 + 真实聚焦回归与可证伪对照

> 状态：**测试缺陷已修，真实聚焦回归通过；W1 未准出**。本篇是 MAYNE-23 派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 触发评论 `01a1b8ff-38d9-7ccd-92f6-2db59a1d1465` 对切片 II 候选 `19418ef8` 的退修（r3）：按唯一集成者第四轮回执（冻结 `6bf69a3`，第 51 组六项失败的源码级归因）修 F-3/F-5/F-6 三项**测试缺陷**。候选 I 的三项实现缺陷（F-1/F-2/F-4）由 Claude 并行修订，不在本篇范围；本篇的回归同时证明本切片断言**未**因退修而弱化。上一轮记录见 [web-manual-items-tests-20261108-r2.md](web-manual-items-tests-20261108-r2.md)（仍有效，未被本篇取代的部分沿用）。证据约定见[验证约定](../engineering/verification.md)。

## 1. 复现基线：本树重建冻结集成版产物，六项失败逐条复现

集成树 `agent/opencode/mayne-23` 冻结提交 `6bf69a3edcf9aa4be44013948c825f683f4eada4`（tree `60ba4a30b1e780c632142cbfb1c4ce73c64d3998`）在本机对象库可见。本树以 `git archive` 只读导出该冻结树至 gitignored `build/integration-6bf69a3/`（未触碰任何共享检出或其他工作树），按仓库既有命令准备**真实**前置：`npm run build:backend`（`vue-tsc --noEmit` + `vite build` 真实 dist；`cargo build --release --bin web-backend-storage` 真实 Rust 存储二进制，40.4s；组装 `build/web-backend/`，二进制 2,632,352 字节；tauri 声明的 `../build/s0-runtime` 打包资源按历轮独审同法以空目录满足 build.rs，不影响存储二进制功能）。套件经默认产物路径（本树 `build/web-backend` 符号链接指向该 bundle）运行，即门禁同款 `packaged` 模式。

未修订套件对该真实 bundle 的基线（日志 `r3/baseline-*.log`）与第四轮回执**逐条一致**：

| 套件 | 结果 | 失败项 |
|---|---|---|
| http | 18 例 16 pass / 2 fail | A-1/A-2（non-ISO instant 期望 400 实得 200——候选 I F-1）、A-2（不存在本机时刻期望 400 实得 200——候选 I F-2） |
| restart | 2 例 0 pass / 1 fail + 1 cancelled | A-8（F-3，本切片）、A-8/M2（旧 epoch 等 `stream.reset` 20s 超时——候选 I F-4） |
| static | 6 例 4 pass / 2 fail | 1440/640 浏览器冷启动（F-5/F-6，本切片）：`data:image/svg+xml,…`（`PairingGate.vue` 经 vite 内联的 `sidekick-mark.svg`，W0 既有产品资产）被 `new URL(value, base).origin === location.origin` 以 origin `'null'` 误判跨源 |

## 2. 逐项处置

| 项 | 缺陷 | 处置 |
|---|---|---|
| F-3 | restart A-8 用 **create 响应**（`completedAt` 恒 null）作重启后期望值；complete 响应的权威完成时刻未捕获。实现在正确实现下也失败（基线 actual `'2026-11-08T02:42:09.311Z'` vs expected `null`） | `tests/integration/web-manual-items-restart.test.mjs`：捕获 `completedAction = completed.json.item`（完成响应的权威状态），期望绑定到它。新增/加强断言：complete 必须打非 null 的 ISO-8601 UTC 毫秒 `completedAt`（:94）；击杀前数据库行记录同一时刻（:109）；重启后 wire 值等于完成响应时刻（:150）；重启后 wire 值与数据库行 `completed_at_ms` 一致（:152，只读观测）。原"完成状态跨重启保持"（status/version/history）断言全部保留 |
| F-5 | 内联 `data:` 资源与真实网络引用未分离：origin `'null'` 一律误判跨源 | `tests/fixtures/web-manual-items/browser-probe.mjs` 页面内探针按**实际类别**分类每个静态引用：`data:` → 内联资源（验证 payload 非空，单独记录 `inlineDataRefs`）；`http/https` → 真实网络引用（严格同源，`crossOriginRefs` 必须为空）；其余 scheme（`file:`/`blob:`/`about:`/不可解析）→ `unexpectedRefs` 显式拒绝。**不**一概豁免 origin=null |
| F-6 | 断言只读 DOM 声明属性，未观测浏览器真实网络行为 | `probeWithChrome` 启用 CDP `Network` 域，收集 navigate 至探针求值期间的全部 `requestWillBeSent`（url/origin/resourceType）落入 `report.networkRequests`；断言：真实网络请求（非 `data:`）必须全部同源；内联 `data:` 请求按内联资源单独验证（payload 非空）。实测澄清：Chrome 的 Network 域**会**上报 `data:` 请求（origin `'null'`），故网络层同样按内联/网络分离——这正是"分别验证"的落地 |

合成静态根（`tests/fixtures/web-manual-items/static-root.mjs`）同批更新：页面加入与产品同类的内联 `data:` 图片，页内脚本改用同一分类逻辑，使两种静态根模式都行使新分类路径。http 套件与 static 套件非浏览器例**零改动**。

## 3. 真实聚焦回归（对冻结集成版 `6bf69a3`，修订后）

| 套件 | 命令 | exit | 结果 |
|---|---|---|---|
| http | `node --test --test-timeout=20000 tests/integration/web-manual-items-http.test.mjs` | 1 | 18 例 16 pass / 2 fail——与基线**同样的两项**（候选 I F-1/F-2），断言未弱化 |
| restart | 同上（restart） | 1 | 2 例 1 pass / 1 cancelled——**A-8 转绿**（F-3 修复）；A-8/M2 仍 20s 超时（候选 I F-4，正确继续捕获） |
| static | 同上（static） | **0** | 6 例 **6 pass**——1440/640 浏览器冷启动转绿（F-5/F-6 修复）；`packaged` 模式，真实产品 dist + 真实 Chrome |
| static（合成模式） | 临时移开默认产物符号链接、以 `WEB_MANUAL_ITEMS_ENTRY`/`WEB_MANUAL_ITEMS_STORAGE_BIN` 指向同一 bundle | **0** | 6 例 6 pass（合成根新分类路径行使；`inlineDataRefs`=1、`unexpectedRefs`=[]） |

即：本切片三项失败转绿，候选 I 三项失败原样保留（2 fail + 1 cancelled），无跳过关键断言、无预算变化（`--test-timeout=20000` 与用例 `timeout: 60000` 均未动）。

## 4. 对并行 I 修复候选的附加验证（`05f0bc0`，未经独审）

Claude 的并行修复 `05f0bc04f2d4d1188931b5eb1dca540650d196d7`（branch `agent/claude/mayne-23`）已落在本机对象库。将其相对 `e750302` 的两文件生产增量（`server/lib/manual-items-service.mjs`、`server/lib/sse-hub.mjs`，blob 级核对 MATCH）及其 `shared/dates.mjs` 依赖闭包覆盖到上述 bundle 后，三套件全绿：http 18/18、restart 2/2、static 6/6（exit 0/0/0，日志 `r3/ifixed-*.log`）。**边界**：`05f0bc0` 尚未经独立审查，本轮只证明"II 套件在修正实现下全绿、未把 I 的缺陷烤进测试"，不签 I 的修复、不签 W1 准出；新集成版的完整门禁与 OhMyPi 浏览器旅程复验按派发归唯一集成者。

## 5. 可证伪性对照（正确/错误实现与页面）

**F-3（错误实现对照，真实代码变异）**：仅把 bundle 内 `manual-items-service.mjs` 的列表读回映射改为丢弃 `completedAt`（MUTATION-A，只影响读回不影响写响应与数据库），restart 套件 A-8 精确失败于新保留断言（`:150`，actual `null` vs expected `'2026-11-08T02:49:25.144Z'`，日志 `r3/mutatedA-restart.log`）；恢复后文件与冻结树 blob 逐字节相同（`fa679aff…`，双侧 MATCH）。反向（正确实现通过）见 §3；退役绑定在正确实现下失败见 §1 基线。

**F-5/F-6（真实 Chrome 页面对照，`probe-f5-f6-origin.mjs`，14/14 判定成立，exit 0）**：全部页面由**真实后端**服务（真实 HTTP/存储），判定来自真实 headless Chrome + CDP：

| # | 页面 | 期望 | 实测 |
|---|---|---|---|
| 1 | 正确页（同源 http(s) + 内联 `data:` 图 + 挂载） | 接受 | 1440/640 均接受；退役 r2 来源检查在该页**拒绝**（F-5/F-6 复现） |
| 2 | 跨源 http(s) 图片页 | 拒绝 | DOM 层 `crossOriginRefs` 非空拒绝；网络层同样观测到外部源请求 |
| 3 | `file:`（origin 为 null 的非 data scheme）页 | 拒绝 | `unexpectedRefs` 拒绝；而"origin=null 一概放行"的错误修法该页**通过**（证明未采用该修法） |
| 4 | `file://` 页自身（非 http 不透明 origin）带跨源 http(s) 引用 | 拒绝 | per-reference 严格比较仍拒绝（页面级豁免会放行）；网络层观测到外部请求 |
| 5 | 未挂载页（空 `#app`） | 拒绝 | r2 挂载断言继续拒绝（`childElementCount=0, textLength=0`） |
| 6 | 3000px 溢出页 | 拒绝 | r2 溢出断言继续拒绝（`scrollWidth=3008, innerWidth=1440`） |

另实测记录 URL 语义（Node/Chrome 一致）：`blob:<inner-url>` 的 origin 是内层 URL 的 origin（非 null），`file:` 与 `data:` 的 origin 才是 `'null'`；Chrome 对 `file://` 页的 `location.origin` 报字面量 `'file://'`。

## 6. 断言与预算清点（HEAD `b15eaa17` → 本修订）

| 指标 | HEAD | 现在 |
|---|---|---|
| `test(` 声明总数（3 套件） | 24 | 24（http 18 / restart 2 / static 4+2 循环） |
| `assert.` 调用总数 | 273 | 282（restart +4：完成时刻盖章/击杀前 DB/重启后 wire/重启后 DB；browser-probe +5：unexpectedRefs、内联 payload、networkRequests 存在性、内联 data 请求 payload、外部请求） |
| http 套件 assert 调用 | 183 | 183（逐字面名计数全同：`validation_failed` 12、`unauthenticated` 5、`pair_code_invalid` 4、`pair_rate_limited` 2、`csrf_invalid` 3、`origin_rejected` 2、`item_not_found` 3、`version_conflict` 4、`idempotency_conflict` 1、`state_conflict` 3、`replayed` 5、`stream.ready` 4、`item.changed` 4、`completedAt` 5、`HttpOnly` 2、`SameSite=Strict` 2、`taskEvents` 2、`agentTasks` 3） |
| static 套件 assert 调用 | 25 | 25 |
| restart 关键面 | — | `stream.ready` 3、`stream.reset` 4、`item.changed` 1、`SIGKILL` 3、`agentTasks` 1、`sequence DESC` 1 全部不变 |
| 预算 | `--test-timeout=20000`、用例 `timeout: 60000` | 未动 |

r2 覆盖自检口径（§5 端点/错误码/A-1–A-9/M1/M2/MINOR-1/n1）不受影响：本修订只改断言靶点与引用分类，未删除任何契约语义引用（http 套件零改动可证）。

## 7. 本机守卫（均非完整门禁）

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（3 套件 + 6 夹具） | 0 | 9/9 |
| `node scripts/checks/check-structure.mjs --self-test` | 0 | 22 类违规 + 8 处引用违规检出，clean 不误报 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | 1 | 173 处**全部为先存环境条件**（`.kimi/` 170 处 `top.dir`、未构建 `vendor/pi` 3 处 `ref.missing`），**0 处引用本切片文件**（与 r2 同口径） |
| `node scripts/checks/check-docs.mjs` | 0 | 21 文件（含本篇）本地相对链接全部解析 |
| `git diff --check` | 0 | 干净 |

## 8. 未验项与边界

- 完整 `npm run check`（51 组链）、`build:backend` 打包链、`test:web-manual-items` 整组（含候选 I 的 unit 套件）、Rust 全套：归唯一集成者在新冻结版本串行执行；本篇不代签。
- `05f0bc0` 未经独立审查（§4 边界）；OhMyPi 浏览器旅程只绑定原快照 `404a2bc`，本批时间/SSE 变更须在新集成版复验受影响旅程——按派发执行，不属本篇。
- CLI 路径仍未被套件直接 exercise；存储子进程退出断言仍待集成轮在可见真实 spawn 后采纳（r2 §1 末行机制验证仍然有效）。
- Linux/代理、真实凭据/用户根/模型未涉及；证据附件已扫描不含配对码/cookie/token；`build/web-manual-items-tests/*-effective-config.json` 含本机绝对路径，入附件前已仓库相对化（OhMyPi r2 OBS-4 处置）。
- `build/integration-6bf69a3/`、`build/integration-05f0bc0/` 为 gitignored 只读导出与构建产物，非交付物；变异与覆盖均已还原/隔离（§5）。
- MAYNE-23/父任务状态未动，未 push、未部署、未合 main。

## 9. 交付物

精确提交 SHA/tree、相对 `b15eaa17` 的补丁哈希与 admission（pwd/branch/HEAD/祖先核对/回归版本/写入范围/评审者登记）见派发线程回帖；admission.json 与原始日志/探针/截图/DOM 随评论附件（`w1-ii-r3-probes-and-logs.tar.gz` + SHA256SUMS）。
