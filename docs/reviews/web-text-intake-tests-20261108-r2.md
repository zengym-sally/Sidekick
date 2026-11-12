# W1 文本整理验收套件修订候选（MAYNE-24 Stage 4 / II 第二轮）

> 本篇是 MAYNE-24 II（Kimi：真实 HTTP／持久队列／受控 Pi／同源 UI 验收）在第一轮候选 `b463f18b91d3145d34596299f004ae705a39043e`（tree `442d1a46`）之上的修订交付登记，落实队长 2026-11-08 冻结内部对接评论 `01a1bba1-4cd4-7729-bd87-6547af6cafcc`。输入不变：最终 P1 契约 `b190f7c6`（`docs/engineering/web-text-intake-contract.md`，SHA-256 `5982c062…`）与 P2 验收矩阵 `43433ae5`（T-1–T-14，SHA-256 `2d647417…`），均 `git show` 提取并复算一致（本树 `git cat-file` 实测两提交存在，`sha256sum` 复算值与冻结值逐字节相同）。本篇不实现业务、不改 I/III 文件、不宣称任何业务通过；公开业务契约不变，一切新增只涉及测试私有夹具与定点断言。
> 实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)；证据约定见[验证约定](../engineering/verification.md)。

## 1. 本轮落实的冻结对接（评论 `01a1bba1`）

| 缺口 | 冻结归属与签名 | II 侧落实 |
|---|---|---|
| GAP-1 | 归 I：entry 的 binary/static 缺省改为与实际 `build/web-backend/{bin,static}` 一致；III 已审布局不改，保留真实 CLI 仅 `--root/--init` 的反例及回归 | static 套件 CLI 用例保持反例语义，失败信息显式命名 GAP-1 与 ENOENT 签名；新增「CLI 已退出即快速失败」判定（不再空转 20s 被用例预算杀掉的假超时） |
| GAP-2 | 归 I：成功配对消费旧码后经既有私有 `onPairingCode` 回调发放下一枚一次性码；保留 TTL/一次性/限流语义，不增加未鉴权 HTTP 取码接口。II 沿回调/专用 IPC 捕获下一码，继续真实两客户端竞争与失效重配对 | 夹具早已支持多码捕获（`receivePairingCode(n)`／`pairAdditionalClient`）；static 配对旅程由「记录仅 1 码的观测」升级为真实失效重配对：刷新后用回调捕获的第二枚码在产品 UI 再次配对并断言门关闭 |
| GAP-3–5 | 只批准程序化私有配置 `config.workerProcessFactory(file, args, spawnOptions): ChildProcess`（同步返回具备真实 stdio/退出事件的 Node 子进程接口）与 `config.workerRunLimitMs`（整数 1–120000，缺省仍 120000）；工厂仅替代 WorkerHost 的 spawn 调用，缺省必须调用真实 Pi；短时限传入同一生产超时路径；不得进入 HTTP/CLI/环境配置，不改 fencing、退出核实或状态转换判据；协议夹具须经生产解析/持久化链触发暂存后挂起、迟到身份帧与退出未知，不能直接写业务结果，真实 Pi 正常链仍另验 | 新夹具 `protocol-worker-process.mjs`（说真实 organizer stdio 协议的子进程）+ `protocol-worker.mjs`（工厂）；queue 套件新增 6 个定点用例（见 §3）；夹具自检 7/7 通过（见 §4） |
| 凭据注入 | 不新增生产 setter：II 的 `backend-child` 在启动前经专用 IPC 收到内存 controlled provider，再传既定 `config.credentialProvider`；撤销通过夹具持有的 provider 状态变化，不再猜 `handle.setCredentialProvider`/`handle.configure` 双别名 | `backend-child.mjs` 重写为启动门（gate）：先经 IPC 收 provider spec（或显式 begin）再 import/start；撤销经 `credential-status` IPC 消息变更子进程内 provider 状态并回执；双别名猜测整段删除。http 套件 T-3 新增夹具持有的内存撤销用例（无任何配置改写） |

## 2. 写入范围（II 冻结范围内）

| 类别 | 文件 |
|---|---|
| 新夹具 | `tests/fixtures/web-text-intake/protocol-worker-process.mjs`、`tests/fixtures/web-text-intake/protocol-worker.mjs` |
| 改夹具 | `backend-process.mjs`（转发两个私有键、controlled provider `setStatus`、`startBackendChild` 改启动前 IPC 注入并暴露 `setCredentialStatus`）、`backend-child.mjs`（启动门 + IPC 撤销） |
| 改套件 | `web-text-intake-http.test.mjs`（T-3 新增夹具持有撤销；`queueText` 序号全局去重）、`web-text-intake-queue.test.mjs`（T-7 第二子进程同送 provider；新增协议夹具段 6 例；长用例显式声明预算；`SLOW_MS` 6000→3000）、`web-text-intake-static.test.mjs`（CLI 反例快速失败 + 命名；配对旅程失效重配对） |
| 文档 | 本篇 |

未写：I 的 unit/Rust/server/frontend、III 的构建/守卫/`package.json`/公共文档、`tests/fixtures/web-manual-items/**`（只读参照，零改动）、`domain/shared/runtime/vendor`。`docs/reviews/README.md` 索引归 III，未动。

## 3. 协议夹具段（queue 套件，GAP-3–5 定点断言）

夹具行为均**经生产解析/持久化链**：假 worker 说真实 stdio 协议，暂存/发布/fencing/退出核实/状态转换判据全部是生产代码对真实帧的反应；夹具不写任何业务结果。真实 Pi 正常链仍由 controlled-model 套件 T-4 与 queue 的 T-5/T-6/T-7 另验（本段用例同时断言受控服务零新请求，证伪「假 worker 被真 Pi 冒充」）。

| 用例 | 场景 | 关键可证伪断言 |
|---|---|---|
| protocol factory control | `well-behaved` | 任务 `succeeded`+`exited_confirmed`；候选来自假 worker payload（标题/证据为原文子串）；受控服务零新请求（工厂确已替代 spawn） |
| GAP-3 | `stage-then-hang`×3 + `workerRunLimitMs=3000` + 第 4 任务 | 暂存窗：`state=running`、`resultPendingExit=true`、`result`/`failure` 对外 null、DB 三行 `staged`、HTTP 候选列表零、第 4 任务保持 queued（暂存占槽）；短时限后任务必须离开 staged-running，且落点只能是冻结迁移表两个合法分支之一（提交原暂存结局→终态+`exited_confirmed`+候选发布；或退出无法确认→`needs_review`+`exited_unknown`+`cause=result_exit_unconfirmed`+占槽+暂存不可见） |
| GAP-3 缺省时限对照 | `stage-then-hang`×3，不传 `workerRunLimitMs` | 观测窗（5s）内三任务保持 `running`+暂存、槽不释放、第 4 任务 queued；证明上一例是短时限（同一生产超时路径）结束的挂起，缺省 120000 未提前触发；三个挂起假 worker 的 argv 不含合成秘密 |
| GAP-4 | `well-behaved` + `late-identity-frame` | 第二任务先发**旧身份**（上一次 attempt 的 runId+hostNonce，来自 registry）结果帧再发正确帧：任务仍 `succeeded`，来源恰好 1 条已发布候选（迟到帧若被接受会多出暂存行/污染 attempt），第一任务候选不受影响 |
| GAP-5 退出未知 | `lingering-tree`×3 | worker 发暂存结果后派生**长命孙进程**再干净退出：直接子进程已退但进程树无法确认退出 → `needs_review`+`exited_unknown`+`cause=result_exit_unconfirmed`+`cancelIntent=false`+`result`/`failure` 不可见；DB 三行 `staged` 保留；HTTP 候选零可见；用 staged 候选 ID 直接签收必须非 200 且零事项；`resolve` → 409 `exit_unconfirmed`；第 4 任务保持 queued（三槽全占） |
| `workerRunLimitMs` 范围 | 0 / -1 / 120001 / 1.5 / '500' / null | 每个越界值必须被生产配置拒绝（启动即败）；边界 1 与 120000 必须被接受 |

**两个合法分支的说明（不代签、不让套件假设改写契约）**：冻结 web-api/1 §3.2 对「暂存结果 + 生产超时」只锁定了两个合法落点（退出已确认→提交原暂存结局并释放槽；退出无法确认→`needs_review`/`exited_unknown` 占槽）。后端超时究竟先发 cancel 帧还是直接杀、以及杀后是否可确认进程树退出，属 I 的实现细节；本段因此对两个分支都断言其完整不变量（任一第三落点——如 `failed` 带非注册表码、暂存候选提前可见、`needs_review` 却释放槽——立即失败），并把实际落点记入证据供集成轮核对。

## 4. 机械与夹具自检（本树实跑）

- `node --check`：全部 9 个夹具 + 4 个套件通过。
- 夹具自检 `build/web-text-intake-tests/self-check-protocol.mjs`（证据脚本，gitignored）：**7/7 通过**——
  1. `well-behaved`：帧带请求身份、payload 经**真实** `runtime/lib/organizer-contract.mjs` `parseModelResult` 解析通过、退出码 0、stdout/stderr 无秘密；
  2. `late-identity-frame`：首帧带 registry 中的旧身份、次帧带正确身份；
  3. `stage-then-hang`：暂存后存活、匹配身份的 cancel 帧令其干净退出、异身份 cancel 被忽略（自检中发现并修复：keep-alive interval 未清除导致 cancel 无法结束进程——真实缺陷，已修）；
  4. `lingering-tree`：干净退出且孙进程存活并在 registry 记录 pid（自检中发现并修复：`process.kill(pid,0)` 在 Node 24 返回 `true` 而非 `undefined`——断言写法已修）；
  5. 工厂：同步返回真实 `ChildProcess`（stdio 可写/可读、exit 事件），`cleanup()` 能 SIGKILL 全部 spawn 的 worker；
  6. controlled provider `setStatus`：撤销→`CREDENTIAL_MISSING`、`status` 报 missing、恢复→可再解析；
  7. `backend-child` 启动门：未收到 IPC 凭证消息不前置于启动，收到后才 import 失败并上报命名错误。
- 环境准备（仓库固定命令）：根 `npm ci --ignore-scripts` exit 0；`npm run probe:prepare-pi` exit 0（provenance `e89822b0…`＝W1 登记）；`npm run probe:bundle` 产出 `build/s0-runtime`（organizer/node 在位；可选 lark-cli 复制处按已知基线非零退出，organizer 路径不依赖）；`npm run build:backend` exit 0（storage 二进制 2633392B，SHA-256 前缀 `b7dd9339…`＝W1 登记值）；`cargo build --manifest-path src-tauri/Cargo.toml --bin web-backend-storage` exit 0。

## 5. 聚焦套件运行（本树 base `b463f18`，I/III 未集成——业务断言按设计显式失败）

| 套件 | 结果 | 说明 |
|---|---|---|
| http | 24 例：1 通过 / 23 显式失败 | 通过项仍为 T-1 无模型手工路径；失败均落在缺失能力并带响应体（`POST /api/text-sources` 405、`GET /api/tasks|/api/models` 404、`schema_version=2`）；新增 T-3 夹具持有撤销同态显式失败 |
| queue | 13 例：0 通过 / 13 显式失败 | 原 7 例在 `GET /api/tasks` 404 显式失败；新增 6 例（协议夹具 5 + 范围 1）在 `POST /api/text-sources` 405 或「生产未校验私有键」命名信息上显式失败 |
| controlled-model | 15 例：5 通过 / 10 显式失败 | 5 例夹具机械仍通过（真实打包 `organizer.mjs` 直接驱动受控服务：提取/read→bash→final 工具序列/七类非法输出拒绝/空候选+argv 无秘密/测试类）；业务 10 例在 405 显式失败 |
| static | 9 例：5 通过 / 4 显式失败 | 静态供给机械 3、1440/640 无头 Chrome 冷启 2 通过；CLI 反例以 GAP-1 命名信息快速失败（实测 stderr `spawn …/build/bin/web-backend-storage ENOENT`，入口缺省解析到 `build/` 而 bundle 在 `build/web-backend/{bin,static}`，归 I）；配对旅程在「未收到第二枚码」的命名 GAP-2 缺口上失败（归 I）；整理旅程在 intake tab 禁用态显式失败（归 I） |

完整 TAP 与自检输出随评论附件交付（已脱敏：绝对工作树路径替换为 `<worktree>`；无配对码、cookie、CSRF token 或合成密钥值）。

## 6. 对第一轮候选的附带修正（同一冻结范围内）

1. **用例预算声明**：`--test-timeout=20000` 会杀死超过 20s 的用例（本树实测确认）。第一轮 T-5/T-6/T-7/两客户端/设置用例内含 25–90s 轮询，集成版会因预算被杀。本轮为这些用例显式声明预算（60–180s，均为真实多任务/重启路径的诚实上界）并把 `SLOW_MS` 6000→3000（仍足以确定性观测 3 运行/2 排队，常见路径落回 20s 内）；不延长预算掩盖缺陷——各轮询上限原样保留。
2. **指纹去重冲突**：第一轮 http 套件多个用例复用同一 `queueText` 序号（如 T-9 与 SSE 同用 7、T-10 批量与 T-3 同用 9/10），I 集成后同指纹提交会走 `reused:true` 且不再提交第二任务，`submitted.json.task` 不可依赖。本轮将需要新任务的用例全部改为全局唯一文本（T-8 的故意重放/去重 triple 保留）。
3. **CLI 反例快速失败**：CLI 已退出仍轮询启动行 30s，被 20s 用例预算杀掉呈现为假超时。本轮先判活后超时，失败信息带 exitCode+stderr 并命名 GAP-1。
4. **凭据注入改启动门**：第一轮 `backend-child` 在 start 后猜 `handle.setCredentialProvider`/`handle.configure` 双别名（队长明令删除）；本轮按冻结签名改为启动前 IPC 注入 + IPC 撤销，T-7 第二子进程也送 provider（恢复扫描重派任务可解析同一合成引用）。

## 7. 缺口与未验项（集成轮输入，不代签）

- **I 未集成**：全部整理业务断言在本树显式失败（路由 404/405、schema_version=2、intake tab 禁用、第二配对码未发放、私有键未校验）；无任何业务通过声明。
- **GAP-1/GAP-2 归 I**：CLI 默认路径与下一枚配对码发放触发点；夹具与断言已按冻结签名就位，I 落地即转绿（反例/回归保留）。
- **私有键生产语义**：`workerProcessFactory`/`workerRunLimitMs` 的范围校验、超时路径的 cancel/杀细节、进程树退出核实范围，以 I 实现为准；本段用例对两个冻结合法分支都断言，第三落点即失败。
- **未验证**：真实模型/真实凭据/用户根/Linux/代理（未授权未执行）；完整 `npm run check`（III 在稳定集成版另派串行执行，本候选不代跑）；`package.json` 的 `test:web-text-intake` 聚合属 III 写入范围，未动。
- 独审默认 OhMyPi（未参与 II）；交付后由 Codex 另派。本篇作者不自签。
