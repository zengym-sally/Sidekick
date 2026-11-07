# MAYNE-23 切片 II 交付：真实 HTTP/重启/同源浏览器验收套件（Kimi）

> 状态：**候选已交付，未验业务**。本篇是 MAYNE-23 派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 分派的切片 II 交付记录：按冻结契约与 P2 九条矩阵编写三个 Node 验收套件与夹具，只覆盖写入范围内的文件。所有业务断言在候选 I/III 落地前**未执行通过**——当前基点缺生产入口，套件以显式 PrerequisiteGap 失败（见 §5），不假报业务 pass、不跳过关键断言。
> 依据：`docs/engineering/web-api-contract.md`（web-api/1，冻结）与最终提案 19045b8 的 `docs/engineering/web-manual-items-contract.md`（SHA-256 `8d752953…b70e8d`，本树由 III 接收，故以行内代码引用）；验收矩阵来源 `docs/reviews/web-manual-items-readiness-20261108.md`（d94de69，OhMyPi f031e21 独立通过）。证据约定见[验证约定](../engineering/verification.md)；测试布局见 [tests/README.md](../../tests/README.md)。

## 1. 登记与基点

| 项 | 值 |
|---|---|
| 执行位置 | 平台分配隔离工作树（branch `agent/kimi/mayne-23`） |
| HEAD | `425778591c2d53773fc11d743bec5b99d775a601`（平台分配基线提交） |
| 基座核对 | `65469904d8baddde738646dfed3bf4a921f47b68` 为 HEAD 祖先，tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`，与登记一致 |
| 接收材料 | 冻结契约（附件 01a1b726-f64f…，SHA-256 复验一致）、002 DDL（`b6cb8e61…f97e` 复验一致）、P2 报告（`900d28c1…5778` 复验一致）、批准包 `w1-implementation-approval-20261108.tar.gz`（SHA-256 `eb6ca72d…be8f`） |
| 写入范围 | `tests/integration/web-manual-items-{http,restart,static}.test.mjs`、`tests/fixtures/web-manual-items/`（仅合成数据与测试辅助，无 `*.test.mjs`）、`docs/reviews/web-manual-items-tests-20261108.md`、`build/web-manual-items-tests/`（本地证据，已忽略） |
| 未触碰 | I 的实现/单测、III 的公共文件、共享 main、MAYNE-23/MAYNE-17 状态 |
| 独立审查 | OhMyPi（未参与本套件编写），交付后由队长派发 |

完整 admission（含逐项哈希）见随评论附件 `admission.json`（同内容在本树 `build/web-manual-items-tests/admission.json`）。

## 2. 套件设计与矩阵映射

三个套件共用夹具 `tests/fixtures/web-manual-items/`：`backend-process.mjs` 封装冻结对接接口（`startWebBackend({root,port,staticRoot,storageBin,initialize,onPairingCode})` → `{origin,close}`）、`backend-child.mjs`（测试自有子进程，经专用 IPC 转送配对码，供 SIGKILL 重启）、`db-observer.mjs`（只读观测同一合成根 `data/web-backend.sqlite`）、`sse-listener.mjs`（SSE 帧解析）、`static-root.mjs`（无真实 dist 时的合成静态根）。

| 套件 | 覆盖 |
|---|---|
| `web-manual-items-http.test.mjs`（17 例） | A-9 会话边界（未配对 401、错码/单次有效/严格 cookie、登出撤销、限速类拒绝）、CSRF/Origin/Host 拒绝且不入库、A-1 两类事项与库行、A-1/A-2 字段校验与时间语义（day 精度保原表达、歧义显式instant、不存在本地时刻拒绝、时区不漂移）、A-3/M1 列表排序/详情一致/游标分页/MINOR-1 新项只现重读首页、A-4 版本冲突与双客户端重读重决、A-6 幂等三态与重放优先状态守卫、A-5 完成/重开/软删/历史/删除后拒绝变更/状态过滤、n1 历史分页、响应未知读回、M2 SSE 首订阅/`item.changed` 无 id/重连/读回补偿/不写 task_events、A-7 不进任务队列、错误信封卫生 |
| `web-manual-items-restart.test.mjs`（2 例） | A-8：显式 init 合成根 → 提交两类事项与变更 → **SIGKILL** → 同根重开（根锁释放、旧会话失效、事项/版本/状态/历史逐条重现、无重复、版本连续、可继续变更）；epoch 变化后重连收 `stream.reset` 并按事项接口读回补偿 |
| `web-manual-items-static.test.mjs`（6 例） | 同源静态：index.html MIME 与不缓存、hash 资产长缓存、各扩展名 MIME、SPA fallback 与 `/api` 不 fallback（JSON 信封）；无头 Chrome 1440×1000 与 640×900 冷启动后端同源 UI、挂载、引用全同源、无横向溢出、页面同源访问 `/api` 与 `/api/events` 得 JSON 信封（非 HTML） |

数据库观测全部只读（WAL 读连接与 Rust 写者共存；硬杀后只读打开被拒时退化为读写打开但仍只发 SELECT）；测试不写业务行。业务搭建只走真实 HTTP。两客户端复用同一用户会话模拟多标签，不为测试放宽配对策略；配对码只进 `/api/pair` 请求体，经 `onPairingCode`/子进程专用 IPC 在内存取得，并断言不出现在子进程 stdout/stderr。

## 3. 接口假设（待 Codex 对照 I 裁定）

冻结契约固定语义但未固定字面名的点，套件按下列默认值断言，均可用环境变量覆盖而不改代码（`WEB_MANUAL_ITEMS_PAIR_FIELD`/`WEB_MANUAL_ITEMS_CSRF_HEADER`）：

1. `POST /api/pair` 请求体字段默认 `code`；
2. CSRF token 载体：`GET /api/session` 响应体 `csrfToken`/`csrf_token` 或响应头 `x-csrf-token`/`x-csrf`；提交头默认 `x-csrf-token`；
3. 会话 cookie 名从 `Set-Cookie` 捕获并原样回放（不依赖名字）；
4. `status` 未知值与 `limit>200` 按 400 `validation_failed`（契约“最大 200”的边界读法）；
5. 重启用测试自有子进程（`backend-child.mjs`）导入同一 `startWebBackend` 接口并经专用 IPC 取码，不解析 CLI stdout。

## 4. 本机已执行的验证（均非完整门禁）

| 命令 | 结果 |
|---|---|
| `node --check`（3 套件 + 5 夹具） | 全部通过 |
| `node scripts/checks/check-structure.mjs --self-test` | 通过（22 类违规与 8 处引用违规检出，干净样本保持干净） |
| `node scripts/checks/check-structure.mjs` | 173 处违规**全部为先存环境条件**：`.kimi/`（CLI 自带技能目录，非本树生产源码）171 处 `top.dir`、`vendor/pi/packages/coding-agent/dist/` 未构建 2 处 `ref.missing`；**0 处引用本切片文件** |
| `node build/web-manual-items-tests/coverage-check.mjs` | 84/84：§5 全部端点、§5/§6+web-api §10 相关错误码、语义规则、A-1–A-9、§11 全部验收行均被套件引用 |
| 夹具机械自测（合成 mock 入口，`/tmp` 临时，非仓库文件） | in-process 与子进程两条路径的配对/cookie/CSRF/Origin/SSE/IPC 取码/SIGKILL 机制全部通过；**只证夹具机制，不签任何业务行为** |
| `git diff --check` | 通过（无空白/冲突标记） |

## 5. 套件执行现状（预期失败＝前置缺口，非业务通过）

当前基点缺 I/III 产物（`server/entries/web-backend-entry.mjs`、`web-backend-storage` 二进制、`build/web-backend/`），三套件在 before 钩子即失败并给出可操作提示（构建或用 `WEB_MANUAL_ITEMS_ENTRY`/`WEB_MANUAL_ITEMS_STORAGE_BIN`/`WEB_MANUAL_ITEMS_STATIC_ROOT` 指向本树 source 入口/cargo 产物/dist）：

| 套件（`node --test --test-timeout=20000`） | tests | pass | fail | exit |
|---|---|---|---|---|
| `web-manual-items-http.test.mjs` | 17 | 0 | 17（均 PrerequisiteGap） | 1 |
| `web-manual-items-restart.test.mjs` | 2 | 0 | 2（均 PrerequisiteGap） | 1 |
| `web-manual-items-static.test.mjs` | 6 | 0 | 6（均 PrerequisiteGap） | 1 |

日志：`build/web-manual-items-tests/runs/{http,restart,static}-prerequisite-gap.log`。无跳过关键断言、无合成 IPC 代签 HTTP、未跑完整重门禁（按派发留待唯一集成者）。

## 6. 未验项与边界

- 任何业务行为均未验证：端点、持久化、重启恢复、同源静态、浏览器矩阵都等候选齐备后在实际集成版执行；本交付只签“套件/夹具独立可审 + 来源覆盖 + 夹具机制”。
- 完整浏览器用户旅程（配对进页面后的表单→列表→详情→编辑→完成→删除→历史）按派发归 OhMyPi 独立验证；本套件浏览器部分只签到“同源冷启动 + `/api`/SSE 可达 + 宽窄屏不溢出”，且无真实 dist 时以合成静态根运行并在证据中记录模式。
- CLI 路径（`--root/--port/--static-root/--storage-bin/--init`）未被本套件直接 exercise（in-process 与测试子进程两条路径已覆盖同一 `startWebBackend` 接口）；CLI 冒烟留待集成。
- 限速阈值、`status` 未知值、`limit` 越界等未固定字面按 §3 假设断言；与 I 不一致时按接口争议交 Codex 裁定，不单方面改契约。
- Linux/代理、真实凭据/用户根/模型未涉及；`node:sqlite` 实验性警告只进 stderr，不影响判定。

## 7. 交付物与哈希

分支 `agent/kimi/mayne-23` 上的提交（精确 SHA 见派发线程回帖）：三个套件、五个夹具、本记录。随评论附件：`admission.json`、三个前置缺口日志、覆盖自检日志。
