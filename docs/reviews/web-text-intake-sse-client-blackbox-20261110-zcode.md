# W1 任务 SSE 客户端黑盒回归（ZCode，2026-11-10）

- **范围与风险级**：测试建设（中）。唯一写入＝`tests/unit/web-text-intake-sse-client.test.mjs`＋`tests/fixtures/web-text-intake/sse-client-harness.mjs`＋本记录＋README 索引行；零生产／package／server／main 字节。
- **派工**：原始 SSE 黑盒派工 `01a1c15f-071c-7020-bcb8-9d8f123d9320`（2026-11-09）；改派接手 `01a1c1e3-b46e-7119-9bd7-5741af26aac9`（2026-11-09，Codex）：沿原主测试／`sse-client-*` 唯一写入范围与全部验收面，本人隔离树按文件核取遗留 harness，旧完整 I＋b5 与 R2 `170f611` 组合分别取证，配对／合法响应／卸载先成立，红须命中同步行为断言，R2 同源 fetch SSE 流／快照／请求头经真实接线观测。
- **作者自报，待独审**；MAYNE-24 保持 `in_progress`。

## 1. 遗留 harness 核取与处置

平台保存提交 `2e8b5d5310452f66b2ddba75ad10f753e0b49192` 仅含 `tests/fixtures/web-text-intake/sse-client-harness.mjs`（blob `95fa6115`，217 行，无主测试）。逐文件核取结论：其编译／挂载机制、受控 double、合法响应表、带标签 waitFor 骨架**复用**；其传输替身（仅 `globalThis.EventSource`）**被取代**——冻结 web-api/1 §6 的字面补偿要求以快照 `lastEventId` 作 `Last-Event-ID` 请求头重订阅，原生 EventSource 不可携带，真实传输是同源 fetch 流（`src/lib/sse-stream.ts`）。旧 run 的「配对响应器／Vue 卸载夹具错误」在本轮得到定位：最小化渲染器 `nextSibling: () => null` 使 Vue 的 fragment 锚点遍历不终止（同步死循环）、`createText` 丢弃内容使静态文本全空——本轮渲染器按子列表模型修正（见 §5），卸载确定性返回，文本断言可用。

## 2. 方法与红绿判据

测试以**真实组合**驱动所在树的字节：真实编译 `PairingGate.vue`（被测路由回调＝生产 gate 注册的那一个，测试零自写回调）＋槽内真实 `TaskQueue.vue`＋真实 stores／`WebApiClient` 单例＋树的**真实传输**（R2 fetch 流＝真实 `text/event-stream` Response body 走生产解析器；旧基线＝忠实原生 EventSource double）。测试只在传输边界写合法 SSE 帧、在冻结 HTTP 边界答合法受控响应（wire 形状按冻结样例 `tests/fixtures/web-contract/snapshot-high-watermark.json`／`sse-events-sample.json` 建模）。观测点：fetch 日志（路径／方法／**请求头含 Last-Event-ID**／AbortSignal）、store 真实状态（todos.rows／organizer.run 含 wireVersion／pairing.syncEpoch）、渲染文本、AbortSignal。断言窗口远小于队列 1s 轮询（判据窗口 ≤2.5s、seam 窗口 450ms、静默窗 400–700ms），轮询无法掩盖缺失补偿；不注入 store 状态。

- **绿树**：`170f611`（R2 锚定，生产 blob＝`2910c15c`/`1b6a6cfb`/`2c164cad`/`1d9551a5`/`e47ce430`/`34120cac`，`git ls-tree` 在案）。
- **红树**：真实组合基线＝`fdf89c1` 树＋pairing blob **`d04b09a9`**（frozen-I 五事件版；R2 记录 §3 的组合基线更正口径；`git hash-object` 复算＝`d04b09a998b7178db63eeedb4e304f3404af793f`；其余五路径＝fdf89c1 所载 b5 blob：client `e730d4a3`、gate `01e43233`、queue `1bd5d476`、organizer `d4b824cb`）。
- 两树跑**同一字节**测试（SHA-256 见 §4，git blob：test `82c8c0e7`、harness `fe2bd6b1`）。

## 3. 面／红绿表（11 例，每例 {timeout: 20000} 含全部清理）

**锚（两树都必须成立）**：

| 面 | 判据 | 绿树 | 红树 |
|---|---|---|---|
| A1 配对＋合法响应＋树自身传输 | session 401→gate；真实 `pair()`→POST /api/pair（Host 头）；订阅经树自身传输打开（R2：fetch /api/events 带 `Accept: text/event-stream`＋Host、首订无 token、**EventSource 零构造**；旧树：原生 double on /api/events）；ready 后合法响应解析进真实 stores（todos.rows、queue 渲染排队槽——标签形态按树各自纪律） | ✔ 278ms | ✔ 269ms |
| A2 卸载关闭流 | unmount→gate onUnmounted→dispose：R2 = /api/events fetch 的 AbortSignal.aborted=true；旧树 = EventSource double closed；随后 400ms 静默零任何端点读 | ✔ 458ms | ✔ 459ms |

**同步面（绿树全绿／红树全红，每条红命中其同步行为断言）**：

| 面 | 判据（绿树观测） | 红树命中点（实测失败标签） |
|---|---|---|
| S1 ready 全量读回 | stream.ready→manual-items **且** organizer 链（text-sources 列表＋tasks 列表＋read_model_run） | timeout: organizer read_model_run after stream.ready（旧 gate 只刷 todos） |
| S2 提示读回（intake §6.3） | candidate.changed（无 id）→organizer 链；task.changed（id inst_a:1）→organizer 链＋队列 seam（limit=100 读，窗口 450ms＜轮询） | timeout: first organizer read-back settling |
| S3 reset 快照补偿＋令牌头 | stream.reset→GET /api/snapshot→**消费**进 organizer 基线（run.wireVersion 2＝快照独有态）→重订阅 `Last-Event-ID: inst_a:7` | timeout: first organizer read-back settling |
| S4 跨 epoch 走快照 | 外来 epoch 帧（inst_b:9）→快照路径；syncEpoch 仅在快照消费后翻转；基线整体替换（run=tsk_9）；重订阅令牌＝快照 inst_b:9，非杂散帧 | timeout: ready handshake adopting the instance epoch（旧 store 无 syncEpoch／快照路径） |
| S5 合法新 attempt／旧响应隔离 | 同 taskId/createdAt 重试 v2 终态→读回 v3 running **显示**（wire version 权威）；再喂 v2 陈旧响应→run 保持 v3 running（≥600ms 双检） | timeout: first organizer read-back settling（setup 面即缺快照补偿） |
| S6 陈旧快照栅栏 | 同 epoch 快照 hw5≤已应用 7→不消费、run 不回滚为 cancelled、订阅以**已承诺令牌** inst_a:7 恢复 | timeout: first organizer read-back settling |
| S7 流断＋401 回栅 | 自然流断→重连尝试 401→handleSessionLost（paired=false）→700ms 零重连风暴；重配对→全新订阅无 token 头 | timeout: session loss returning the gate（旧传输无会话丢失语义，paired 恒真） |
| S8 队列权威覆盖 | 两页翻页走全；needs_review／interrupted 槽以「退出待核对／退出未知」可见，不冒充空队列 | assert: the needs_review slot stays visible（56ms 快速判红，旧队列过滤+不翻页） |
| S9 队列 epoch 栅栏 | mount 读（前 epoch）扣留至 ready 翻转 epoch 后放行→响应完整合法但不落（渲染无其类型）；400ms 迟落双检 | timeout: ready read-backs settling |

## 4. 证据与命令

工作目录 `build/mayne24-sse-client/`（gitignored，原始件全留）：

- `green-run.tap`（11/11，exit 0）、`green-run.stderr`（29B＝time -p 输出）、`green-exit.txt`、`green-head.txt`（=170f611）、`green-production-blobs.txt`
- `red-run.tap`（2 过 9 红，exit 1）、`red-run.stderr`、`red-exit.txt`、`red-head.txt`（=fdf89c1）、`red-production-blobs.txt`（含 d04b09a9 覆写核验）
- `test-file-identity.txt`（三树同字节）、`test-file-blobs.txt`、`run-output-shasums.txt`、`run-summary.txt`

命令（两树同）：`npm ci --ignore-scripts`（exit 0）→ `node --test --test-timeout=20000 tests/unit/web-text-intake-sse-client.test.mjs`（`/usr/bin/time -p` 包裹，完整 stdout/stderr 落盘，未用 head 截断）。

- 绿：exit 0，tests 11 / pass 11 / fail 0，外墙 real **3.98s**（最慢单例 1.01s），stderr 29B。
- 红：exit 1，tests 11 / pass 2 / fail 9，外墙 real **21.53s**，最慢单例 **2.56s**——每例 20000ms 预算（含清理）两树均未触及。
- 本树门禁：`node --check` 两文件 exit 0；`npm run typecheck` exit 0；`check:structure` 183 FAIL＝本分支注册基线、sse-client 零提及（零新增）；`check:docs` 见提交时点（README 122→123 行）。

## 5. 夹具修正登记（诚实记录）

1. **渲染器契约修正**（本轮发现并修复，桌面偏好测试的旧渲染器同款式存在但从未暴露）：`createText` 必须接收内容（hoisted 静态文本否则全空）；`nextSibling` 必须按父 children 表实现（恒 null 使 Vue fragment 锚点遍历同步死循环——即旧 run「Vue 卸载夹具错误」的根因之一）；`insert` 必须尊重 anchor 参数；`walkText` 需收集元素自身 text（TEXT_CHILDREN 走 hostSetElementText 契约）。修复后卸载确定性返回、文本断言可用。
2. **hook 归一化**：一次性 behavior hook 可回原始 body 或 `{status,body}`（401 探针用），fetch 处统一 `normalizeAnswer` 归一——首版红绿跑中快照 hook 原始 body 未包裹导致 `payload` null、S3–S6 假红，已修复并重跑两树终局（首版输出未保留，此为 dated 更正）。
3. **标签形态更正**：首版终局红跑锚 A1 因「排队中」字样在旧树渲染为原始态 `queued` 而误红——锚面／渲染等待改为双标签纪律（`/(排队中|queued)/`），使红准确落于同步断言；同步面自身的中文标签断言（S8「退出待核对／退出未知」）保持原样，红即真实覆盖缺口。首版红跑 TAP 未保留，此为 dated 更正；终局两跑为最终字节上的必要跑。

## 6. 边界与未验证项

- **未改**：生产六路径、package／scripts／依赖锁、server／Runtime／DDL、共享 main；未跑聚合套件、完整 check 链、19 旅程；不重跑 19 用例矩阵。
- 快照响应形状按**客户端消费的冻结 §6 形状**（顶层 `agentConcurrency`；冻结样例 JSON 的 `settings.agentConcurrency` 嵌套形态与客户端读取不一致，以冻结 §6 文句与生产客户端为准，已在案备注）。
- 旧树「流开启 401」在原生传输上以 double 的 `error` 事件建模（真实 EventSource 对 401 的行为）；R2 路径为真实 401 Response。
- 残留纪律：每例 finally＝unmount→dispose→restore globals→settle(25ms)；锚 A2 含 400ms 静默窗断言（零任何端点读）；S7 含 700ms 零重连风暴断言；泄漏的 reconnect timer／poll 会使 runner 可见挂起（每例 20s 硬超时兜底）。未做进程级残留清点（单元级无子进程／浏览器）。
- 真实 HTTP／真实 Pi／真实浏览器旅程、native 运行、Linux、真实凭据／用户根：原样保留，不在本面。
- **独审待派**：候选已就绪（commit 见交付评论），按派工由未写本候选者独审；作者不自签。
