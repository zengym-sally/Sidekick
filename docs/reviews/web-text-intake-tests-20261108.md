# W1 文本整理验收套件候选（MAYNE-24 Stage 4 / II 交付）

> 本篇是 MAYNE-24 II（Kimi：真实 HTTP／持久队列／受控 Pi／同源 UI 验收）的交付登记。输入为最终 P1 契约 `b190f7c6`（`docs/engineering/web-text-intake-contract.md`，SHA-256 `5982c062…`，经 `git show` 逐字节提取并复算一致）与 P2 验收矩阵 `43433ae5`（`docs/reviews/web-text-intake-readiness-20261108.md`，SHA-256 `2d647417…`，T-1–T-14）。本篇不实现业务、不改 I/III 文件、不宣称任何业务通过；本篇交付的是**可证伪的验收套件候选与其机械/来源覆盖证据**。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. 准入登记（首次修改前）

| 项 | 值 |
|---|---|
| 执行位置 | `pwd`：平台分配独立工作树（MAYNE-24 任务分支）；`branch`：`agent/kimi/mayne-24` |
| 工作树 HEAD | `7074163e084644ebb4b96d18aa595700456cb0ee`，tree `77a548591ac9b02a51936c806bf4f85d774df7cb` |
| 基点关系 | HEAD~1 = 登记本地 main `1e3704432e7014f1e23b40e9aff9791662e9c6f5`；基点 tree 与登记值实测一致；基点 Ancestor-of-HEAD 通过 |
| 接收材料 | P1 `b190f7c6`（contract `5982c062…`、authorization `caa746bb…`）、P2 `43433ae5`（readiness `2d647417…`）、ZCode R3 `47d5efaa`（PASS，仅 R3 文字收口）；均 `git show` 提取后复算 SHA-256 一致，未整树合并旧分支 |
| 环境准备 | 根 `npm ci --ignore-scripts`、`vendor/pi` `npm ci --ignore-scripts` + `hydrate:model-data` + `build:offline`、`npm run probe:bundle`（核心 runtime 产出：`build/s0-runtime/{node,organizer.mjs,bash-worker.mjs,mcp-guardian.mjs,builtin-skills,…}`；脚本在可选 `lark-cli` 复制处以非零退出——`node_modules/@larksuite/cli` 二进制缺失，需 `probe:prepare-cli` 联网准备，organizer 路径不依赖它）、`cargo build --bin web-backend-storage`、`npm run build:backend`（`build/web-backend/{server,shared,bin,static}`） |
| organizer 冒烟 | 打包产物 `organizer.mjs` 对不完整 stdin payload 以 `{type:error,code:RUNTIME_PROTOCOL}` exit 1 拒绝——协议冒烟通过 |
| 预定独审者 | OhMyPi（未参与 II 写作），交付后由 Codex 另派；作者不自签 |

完整登记见 `build/web-text-intake-tests/admission.json`。

## 2. 交付物与写入范围（II 冻结范围）

| 类别 | 文件 |
|---|---|
| 夹具 | `tests/fixtures/web-text-intake/backend-process.mjs`（扩展对接接口包装：`runtimeRoot` 与 `credentialProvider` 程序化注入、子进程 IPC 注入、进程树观测）、`backend-child.mjs`（SIGKILL 重启子进程 + 私有 IPC 凭证注入）、`db-observer.mjs`（只读观测，表/列缺失显式报错）、`sse-listener.mjs`（任务帧/提示帧解析）、`controlled-model-service.mjs`（受控 OpenAI 兼容服务：请求匹配脚本、请求记录只记"认证头存在+长度"不记值、六类故障注入）、`controlled-model.mjs`（服务驱动 + 合成模型答案）、`synthetic-inputs.mjs`（合成语料与请求体构造）、`browser-probe.mjs`（CDP 无头浏览器探针 + 页面内配对/录入驱动）、`static-root.mjs`（合成静态根，仅签夹具机械） |
| 套件 | `tests/integration/web-text-intake-http.test.mjs`（23 例）、`web-text-intake-queue.test.mjs`（7 例）、`web-text-intake-controlled-model.test.mjs`（15 例）、`web-text-intake-static.test.mjs`（9 例） |
| 证据 | `build/web-text-intake-tests/`（admission、received 只读材料、各套件 TAP、effective config、静态套件 DOM/截图） |
| 文档 | 本篇 |

未写：I 的 unit/Rust/server/frontend、III 的构建/守卫/`package.json`/公共文档、`tests/fixtures/web-manual-items/**`（只读参照，零改动）、`domain/shared/runtime/vendor`。

## 3. 覆盖矩阵（T-1–T-14 → 套件断言）

| # | 验收项 | 套件与用例 | 关键可证伪断言 |
|---|---|---|---|
| T-1 | 无模型不回归 | http `T-1` | 未配模型时手工事项全动线（建/完成/历史）可用；`tasks`/`task_events` 零行 |
| T-2 | 模型配置与凭据引用 | http `T-2`×2、controlled-model `T-4` | `GET /api/models` 读回+修订；`GET /api/providers` 只出引用状态（available/missing/unavailable）；明文密钥 PUT 被拒（400/422）且不回显；advisor 未接线准确 4xx；全链路 grep 秘密为零 |
| T-3 | 缺失/撤销凭据 | http `T-3` | 缺引用 → 任务 `failed`+`credential_unavailable`+`retryable=manual`+`exited_confirmed`（不占槽）；零候选；受控服务零新请求；来源保留可重试 |
| T-4 | 受控服务经真实 Pi | controlled-model `fixture mechanics`×5 + `T-4` | 真实 `build/s0-runtime/organizer.mjs` 子进程经生产路径调用受控服务；请求记录条数证伪"未经模型"；`hasAuthorization=true` 且记录不含值；候选与模型输出一致、evidence 为原文子串；工具序列（read→bash→final）驱动真实 ManagedBash；非法输出（非 JSON/evidence 非子串/action 带跟进/标签超限/未知键/超 50）被运行时拒绝且无 result 事件 |
| T-5 | 5 任务 3 运行 2 排队 | queue `T-5` | 满槽无 409 忙碌拒绝；FIFO（前三个提交占槽）；`queuePosition` 1/2；DB 槽位计数=3；调升补发空槽；调降不杀运行、FIFO 排泄；每任务恰好 1 候选 |
| T-6 | 取消竞争/退出未知占槽 | queue `T-6`×3 | 两客户端同取消一赢（200）一 409 `state_conflict`；取消 queued 永不启动（attempt 0 行）；取消 running 先持久 `cancelIntent=true`/`exiting` 占槽，终态 `cancelled`+`cancelIntent=false`+`exited_confirmed`；SIGKILL 真实 worker → `needs_review`+`exited_unknown`+`cause=exit_unconfirmed`+占槽；`resolve` → 409 `exit_unconfirmed`；三槽全被 `exited_unknown` 占据时新提交保持 queued |
| T-7 | SIGKILL 同根重启 | queue `T-7` | 根锁释放可重开；已签收事项/来源/候选/历史逐字节重现；queued 保持；旧 attempt 被恢复扫描关闭（不静默重发）；新 attempt 只属于新 epoch（先核实再调度）；旧 cookie 401；SSE epoch 变 → `stream.reset` → `/api/snapshot` 高水位重同步；`instance_epochs` +1 |
| T-8 | 重复提交/响应未知 | http `T-8`×2 | 同 operationId 同输入 → `replayed:true` 同一对象当前权威态；异输入 → 409 `idempotency_conflict`；同指纹 → `reused:true` 不建第二来源/任务；`GET /api/tasks?operationId=` 读回；未知 type → 400 `unknown_task_type` |
| T-9 | 修改先预览 | http `T-9` | 空指令 400；revision 提交 revise 任务；预览存在且候选 version/内容不变；过期版本 apply → 409 `version_conflict`；当前版本 apply → version+1 且 DB 一致 |
| T-10 | 编辑/关联/丢弃/批量原子 | http `T-10`×5 | 编辑校验与手工事项同规则；过期版本 409；批量一条失败整批回滚（零事项、候选仍 pending）；N≥2 混合成功原子；重放返回当前权威事项不重复入库；跨族占键（`sign_off:`+SHA-256 派生键被手工事项占用）整批回滚；丢弃留痕、pending 集移除、重复丢弃 409；关联不覆盖目标（标题/owner 不变、version+1、`link` 事件、零新事项）、目标过期版本 409 |
| T-11 | 今日/完成/来源证据 | http `T-11` | 签收项 `source=signed_ai` 入列表；历史可读；`manual_item_sources` 关联回源；完成正常 |
| T-12 | 时间锚点/原文证据 | http `T-12` | `sourceAt` ISO ms 锚点；未定期须 `timeReviewed`（400 `time_review_required`），核对后放行；DB 存储的 due 时刻等于 `shared/dates.mjs` 对原文表达式的解析；原表达式逐字保留 |
| T-13 | Origin/CSRF/会话/秘密 | http `T-13`×3、queue 两客户端、controlled-model 全部 | 未配对 401；缺/错 CSRF 403；跨源/跨 Host 403 且零落库；会话失效后任务继续、重配对按同 ID 读回；秘密不出现在响应/SSE/DB/子进程 argv/后端 stdout+stderr/请求记录 |
| T-14 | 窄宽屏真实同源 UI | static 全部 | 真实 product dist 同源供给（MIME/缓存/SPA 回退/`/api` 不回退）；真实打包 CLI 默认路径起停；1440/640 无头 Chrome 冷启（挂载、同源 API 401 信封、无横向溢出、无跨域引用）；真实产品配对门冷启/会话失效/刷新；文本整理入口启用态与提交→候选可见旅程（基础树显式失败，见 §5） |

矩阵外显式边界：三角色完整配置/Skills/MCP/飞书/提醒/薄壳不在范围；真实模型验收未授权、未执行，受控服务结果不冒充真实模型。

## 4. 套件设计与机械验证（本树实跑）

- **请求匹配脚本**：受控服务按请求内容（user/system 文本、tool 结果数）匹配答案，`repeat` 常驻答案不被消耗——任务交错时答案仍跟随请求；一次性条目按序消费（慢答案占槽、故障注入）。
- **确定性就绪**：全部等待用 `pollUntil`（轮询真实任务资源/DB/进程表），无固定 sleep 掩盖就绪；受控服务以 stdout URL 行为就绪信号。
- **根所有权/并发泄漏**：沿用 W1 已修复判据——`close()` 先关后端句柄再删自建根，调用方根与其内容全程保留；失败路径同样不泄漏 HTTP server/storage child/临时目录。
- **夹具自检（本树通过）**：合成模型答案经真实 `runtime/lib/organizer-contract.mjs` 解析器验证（有效答案全部可解析、无效答案按预期 reason 拒绝）；真实 organizer 直接驱动 5 例全过（提取/工具序列/非法输出/空候选+argv 秘密检查/测试类）。
- **机械/来源覆盖（本树实跑，exit 非零=业务显式失败）**：`node --check` 全部通过；四套件对真实打包后端＋真实打包 runtime＋真实 product dist 运行：
  - HTTP 23 例：1 通过（T-1 无模型手工路径），22 例在缺失整理路由上显式失败（`405 method_not_allowed`/`404 not_found`，响应体随断言输出）；
  - queue 7 例：0 通过，7 例显式失败（`GET /api/tasks` 404）；
  - controlled-model 15 例：5 例夹具机械通过（真实 Pi 直接驱动），10 例业务显式失败（`POST /api/text-sources` 405）；
  - static 9 例：7 通过（静态供给机械 3、浏览器冷启 1440/640 2、真实产品配对旅程 2——配对/会话失效/刷新均经产品自身 UI 驱动），2 例显式失败（打包 CLI 默认路径 GAP-1；整理旅程 intake tab 禁用）。
- **产品行为备注**（供 I 复核，非缺陷）：会话失效的门恢复发生在下一次经产品自身 API client 的认证请求 401 时（`web-api-client.ts` 的 `handleSessionLost`）；套件用一次真实的手工事项写入承载该 401，不用合成 IPC 代替产品路径。

## 5. 前置未齐的显式失败（不假报业务通过）

I/III 在本树均未集成（基点无整理路由、无 003、无调度器、`build-backend.mjs` 未含 runtime、`package.json` 无 `test:web-text-intake`）。套件对真实后端发起真实请求，在第一个缺失能力上失败并随断言输出响应体，不跳过、不伪造：

| 失败点 | 证据（本树实测） |
|---|---|
| 整理路由缺失 | `POST /api/text-sources` → `405 method_not_allowed`；`GET /api/tasks`、`GET /api/models` → `404 not_found`（web-api/1 信封） |
| 003 未应用 | `schema_meta.schema_version = 2`（断言要求 3）；`text_sources` 等 5 表不存在（db-observer 显式报错） |
| 打包 CLI 默认路径 | 真实 CLI 仅传 `--root/--init` 启动失败：`spawn build/bin/web-backend-storage ENOENT`。入口默认值 `../../../bin/web-backend-storage`（相对入口文件）解析到 `build/bin/`，而 bundle 布局为 `build/web-backend/bin/`——**默认 binary/static 定位与打包布局差一层**（跨项缺口 GAP-1，见 §6） |
| 整理入口未启用 | 真实产品 UI 的「文本智能整理」tab 在基础树为 disabled +「未接通：浏览器模式不提供文本智能整理」——断言启用态显式失败（I 接线后转绿） |

两例失败均为**可证伪断言按设计显式失败**：CLI 用例暴露默认路径与 bundle 布局差一层（GAP-1，附实测 stderr `spawn build/bin/web-backend-storage ENOENT`）；旅程用例在 intake tab 启用态上失败（I 接线后转绿）。无跳过、无假报。

## 6. 跨项接口缺口（提交队长统一裁定）

| # | 缺口 | 具体签名/事实 | 影响 |
|---|---|---|---|
| GAP-1 | 打包 CLI 默认路径差一层 | `server/entries/web-backend-entry.mjs:23-25` `defaultStorageBin()/defaultStaticRoot()` 用 `../../../`（入口在 `build/web-backend/server/entries/` → 解析到 `build/`），bundle 实际布局 `build/web-backend/{bin,static}`；`npm run start:backend -- --root X --init` 因此 ENOENT | I（入口默认值）或 III（bundle 布局）二选一修正；`test:web-text-intake` 纳入 check 前必须收口 |
| GAP-2 | 第二个配对码的发放触发点 | 冻结契约 §2 客户端处置为「取新配对码」，但基础入口仅在启动时生成一个一次性码（`web-backend-entry.mjs:57`）。两客户端/刷新后再配对需要后端经私有 `onPairingCode` 通道再发码 | queue 两客户端用例（`T-6` 取消竞争、两客户端关页）在该触发点定案前显式失败（夹具已支持多码捕获，I 实现后即绿）；static 配对旅程改为记录「本实例仅发 1 个码」的观测继续覆盖冷启/会话失效/刷新 |
| GAP-3 | 暂存窗口的确定性注入 | 「staged 候选退出确认前不可见」的定点断言需要测试私有 worker 工厂或结果后挂起钩子（派发 §4 允许登记的私有测试签名）；公开契约无 `runLimitMs` 入参 | 现行断言为不变量形式（任务非终态前零候选可见 + DB staged→pending 迁移）；定点断言待签名登记 |
| GAP-4 | 迟到帧 fencing 的 HTTP 可观测触发 | attemptId+epoch 不匹配的晚到结果由调度器内部拒绝（冻结 §3.3），无公开触发面 | 确定性用例待私有 seam；契约语义已在队列/重启套件以相邻不变量覆盖 |
| GAP-5 | 模型超时（`runLimitMs`）用例 | 受控服务可注入慢响应/挂起，但公开请求无 `runLimitMs` 入参，20s 用例预算内无法真实触发 ≤120s 上限 | 夹具能力已在（`slow`/`hang` 条目）；用例待 seam 或专门长预算运行 |

## 7. 证据索引（`build/web-text-intake-tests/`）

- `admission.json`：准入登记（pwd/branch/HEAD/基点/接收哈希/写入清单/独审者）
- `received/`：P1 契约与授权、P2 报告只读副本（SHA-256 复算一致）
- `runs/http-base-run.tap`、`runs/queue-base-run.tap`、`runs/controlled-model-base-run.tap`、`runs/static-base-run.tap`：本树各套件完整 TAP
- `http-effective-config.json`、`queue-effective-config.json`、`controlled-model-effective-config.json`、`static-effective-config.json`：非秘密生效配置（wire 字面/工件路径/Node 版本）
- `static-browser/`：静态套件 DOM、截图、报告（1440/640 冷启）
- 原始 TAP 与截图随评论附件交付；平台回收 `build/` 前以 CLI 下载复算为准

## 8. 边界与未验项

- 未验证：任何整理业务通过（I 未集成——本树全部业务断言显式失败，无跳过）；真实模型/真实凭据/用户根/Linux/代理未授权未执行；完整 `npm run check` 由 III 在稳定集成版另派执行，本篇不代跑。
- 夹具机械（受控服务驱动真实 Pi、合成答案合约有效性、进程树/秘密边界观测）已在本树真实打包 runtime 上实证；业务语义断言以待集成版本运行。
- 独审默认 OhMyPi；交付后由 Codex 另派未参与者独审。本篇作者不自签。
