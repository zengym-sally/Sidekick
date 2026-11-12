# web-api/2 退出核实证据与断线恢复的浏览器呈现 — MAYNE-38 候选交付记录（2026-11-11，OpenCode）

- 卡：MAYNE-38（01a1ca17-2c5f-74e4-9ab8-fe863d38dee0），父卡 MAYNE-35（W1，E 决策 B(a)）。
- 执行者：OpenCode（9f1d3125-8973-4680-b8a6-9f019b743b47），代表 Mayne。首派 OhMyPi 运行
  01a1ca17-2c81-7c36-929e-ff2332cca023 因供应商鉴权错误终局失败（约 4 秒，无交付），本轮为同卡改派，未创建重复任务。
- 准入登记：`build/mayne38-api2-browser/admission.json`（gitignored 原始证据目录；本记录只引用，不复制）。

## 1. 来源与身份（全部经哈希重算核验）

| 输入 | 精确身份 | 处理 |
|---|---|---|
| 平台起点 | `64f0eed459cd3b8971fda910e73da3da64c0cf75` / tree `77a548591ac9b02a51936c806bf4f85d774df7cb`（分支 `agent/opencode/mayne-38`） | 保留为祖先；本轮只在其上加新提交；无 reset/stash/整枝合并 |
| 冻结 V2 规范 | `0c9febc5010015418a5778a49f76d4e0c01f7f9f` 的 `docs/engineering/web-api-contract-v2.md`，blob `99ef71cfac8e22d30c06559cb5b07a5b74ad2cf3`，sha256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`（与卡面一致） | 只读；不在本树（main 未含 V2 冻结），以 commit/blob 引用 |
| 冻结 55 样例 | 同 commit 的 `tests/fixtures/web-contract-v2/`（55 份，逐字只读） | 本树不存在的 16 份按需样例以 `git show` 提取，逐字节复制进自有夹具 `tests/fixtures/web-api-v2-client/frozen/`，两棵树 SHA-256 全部比对相等（`build/mayne38-api2-browser/frozen-sample-copies.sha256`） |
| 前端实际来源 | MAYNE-37 已审 `d7688fbbcf138ec66c383a4dd2a8d3eea2d7a76a` / tree `a142a5b045c40850472577f1c167573983bcfabd`（独审 01a1ca07-cd14-75a8-8919-85d9f74244dc） | 仅按精确路径接源（`git checkout <commit> -- <path>`），hash-object 重算与来源 blob 逐一相等；不整枝合并 |

接源路径（接源后本轮未改，保持与 d7688fb 字节相同）：`src/components/CandidateCard.vue`（卡面明令字节相同）、
`src/lib/sse-stream.ts`、`src/components/PairingGate.vue`、`src/components/SettingsPanel.vue`、
`src/components/ModelSettingsPanel.vue`、`src/components/AgentSettingsPanel.vue`；
另有直接邻域测试 `tests/unit/s2-client.test.mjs`、`tests/unit/web-manual-items.test.mjs`
（基线 main 版本与接源客户端不兼容——Tauri window 桩对 web 客户端；取 d7688fb 已审字节后按「版本/快照契约直接受影响」做了最小适配，见 §4）。

本轮唯一写域（生产）：`src/lib/web-api-client.ts`、`src/stores/pairing.ts`、`src/stores/organizer.ts`、`src/components/TaskQueue.vue`。
server/Rust/DDL/Runtime/vendor/package/锁/公共索引/product05/架构文档/其它候选零字节；冻结规范与 55 样例零字节。

## 2. 交付内容（对照卡面验收 1–5）

1. **统一识别 web-api/2（§1）**：`WebApiClient.request()` 对每个 JSON 响应体强制 `contractVersion==='web-api/2'`
   ——成功与错误包络同规则；V1/缺失/畸形/数组/空体一律以可读错误（`contract_version`）拒绝，无默认、无 V1 兼容层；
   请求形状不添加任何字段（提交/取消/重试/处置体与原来逐字段相同，负控在测试）。SSE 侧 `pairing.ts` 的
   `v2PayloadOf`：每个帧的 data 必须是 `web-api/2` 信封，否则整帧丢弃——不触发读回、不提交令牌、不采纳 epoch、
   不驱动快照 resync（含 V1 `stream.reset` 拒绝驱动我们的快照管线）。
2. **typed `attemptExitEvidence`（§3.1.1）**：`parseAttemptExitEvidence(raw, attemptExitState)` 在客户端做一次结构校验，
   含恒等式（total=confirmedExtinct+unobservable+survivors）、不变式 1/2/4（`registry_extinct` 全确认合取、`unresolved` 否决面、
   `treeExtinctProven` 字面量 false）、`confirmedAt` 出现规则、veto 触发一致性与 §3.1 出现规则
   （not_started/active/exiting 恒 null；exited_confirmed⇔registry_extinct；exited_unknown⇔unresolved）。
   校验结果随 `StoreRun` 新增成员 `wireAttemptId/wireExitState/wireExitEvidence/wireExitEvidenceError` 携带；
   缺失/畸形/自相矛盾 fail-closed 并给出可读原因，永不静默转 truthy。列表、详情、SSE 触发读回、快照共用同一映射。
   organizer `acceptRun` 新增两条围栏：同版本不同 `attemptId` 拒绝（证据保持 attempt 身份）；同版本
   `registry_extinct`→非 `registry_extinct` 拒绝（不变式 6 单向）。既有世代围栏/刷新隔离/候选不可见规则逐字保留。
3. **TaskQueue 呈现（§3.1.2）**：`exited_unknown`（按 attemptExitState 判定，不从 truthy object 推断）显示
   「占 1 个执行槽，等待系统核实退出」＋可读否决原因（known_survivor/insufficient_evidence/identity_mismatch/eperm 四类映射），
   不给任何处置入口；`exited_confirmed` 的核对面板新增诚实披露块：规定句「已确认登记进程集全部退出；不证明全部后代进程已退出。」、
   登记集分解、argv 补充信号、stray 台账 found/swept/pending、found=0 边界句（「发现为 0 不等于不存在残余」）、
   `confirmedAt`；未扫/无台账两种边界分别表述；resolve 双入口同时要求 `exited_confirmed` 状态、有效 `registry_extinct`
   证据、权威条目（decisionOptions/itemVersion/receipts）与回执 ACK，才启用；证据缺失/畸形时行级 role=alert 拒绝原因、
   披露块不渲染、处置禁用且不发 POST。三类版本（task/item/settings）、ACK 逐字回传、旧操作归属清理全部保留。
4. **readSnapshot 消费完整 §6.1**：必需成员逐项校验（epoch/highWatermark/generatedAt/lastEventId 且
   `lastEventId===<epoch>:<highWatermark>`/嵌套 settings{agentConcurrency,version}/嵌套 workspace{mode,currentRoot{id,label},capabilities,recovery 存在}/tasks 数组），
   任务条目按 §3.1 全字段成员表校验（裁剪形整快照拒绝）；顶层 `agentConcurrency` 仅可选同源附加字段，
   出现时必须等于嵌套值（否则拒绝），缺失合法，且永不是 CAS 输入；并发 CAS 只用设置端点真实 `version`
   （浏览器级负控断言 PUT 体 `expectedVersion===5` 而并发值为 3）。低水位拒绝、跨 epoch 整体重装、
   先装快照再按其 token 重订阅全部保留（既有 R2 围栏未动）；客户端不声称证明服务端事务水位正确，
   记录与测试均只断言形状与消费语义。
5. **证据等级声明**：全部证据是客户端层（受控 HTTP/SSE 夹具＋真实编译组件/真实 store/真实传输/真实 Chrome DOM）。
   真实 Pi、真实后端组合、真实水位事务性均未验证，归 MAYNE-35 后端候选与 MAYNE-34 组合验收。

## 3. 验证（原始输出在 build/mayne38-api2-browser/，均含资源清理）

- 新增自有回归（全部与冻结样例/派生负例同源，未复制生产算法进测试互证）：
  - `tests/unit/web-api-v2-client.test.mjs`：32/32（§1 版本正反控、7 份冻结 unresolved 样例逐一正控、
    派生负例逐一拒绝、映射身份携带、§6.1 快照正/负、CAS 来源、错误包络、请求形状零改动）。
  - `tests/unit/web-api-v2-snapshot.test.mjs`：10/10（快照安装携带证据/身份、低水位、跨 epoch 整装、
    同代合并、同版本异 attempt 拒绝、verdict 单向、新版本合法更新、V1 帧驱动零事件、晚到 V1 读回拒绝不覆盖）。
  - `tests/integration/web-api-v2-task-evidence-browser.test.mjs`：1 例（20 秒预算含清理，实际 ~3.6 秒），
    驱动 `tests/fixtures/web-api-v2-client/evidence-browser.mjs`：真实 Chrome 640×900 ＋ 真实编译 TaskQueue/真实
    store/真实 client/真实 SSE 传输，65 个 DOM 观察全部通过：7 份冻结 unresolved 样例逐行诚实呈现＋无处置入口＋无 POST、
    确认行规定句/登记分解/argv/台账/边界句/confirmedAt、resolve 证据门控＋itemVersion/ACK 逐字断言、
    found=0 不出现「无残余」、畸形证据 role=alert 拒绝＋披露不渲染＋无 POST、暂存/取消无早终端文案、
    V1 列表可读拒绝、V2 reset→§6.1 快照→Last-Event-ID 头重订阅、V1 reset 不触发快照、并发 CAS=设置版本、
    Tab/Enter 键盘可达展开、640px 无溢出；清理（Chrome/vite/http/profile）全真。
  - 受影响邻域（最小适配后全绿，反例语义保留）：`s2-client.test.mjs` 35/35、`web-manual-items.test.mjs` 27/27、`layout-domain.test.mjs` 14/14（合计 76/76）。
- 修前红/修后绿（同测试字节）：d7688fb 字节挂临时分离 worktree＋同一套测试字节——client 文件模块级红
  （0/1，旧字节无 `parseAttemptExitEvidence` 导出）、snapshot 5/10 红（围栏/证据面）、浏览器驱动 29 通过/8 失败
  （全部新证据面红：否决原因、诚实披露、畸形拒绝、resolve 门控；通用 a11y 面照旧绿）。输出在
  `build/mayne38-api2-browser/red-d7688fb/`；绿在 `green-candidate/`。
- 机械检查：`npm run typecheck` exit 0；`npm run check:docs` exit 0（21 文件 513 链接）；新/改 .mjs `node --check` 全过；
  `git diff --check` 干净；每例 ≤20 秒含全部资源清理（浏览器面清理四步全真）。
- 结构守卫：候选树 fail 集 = 平台起点 `64f0eed` 基线 fail 集逐项相同
  （3 条既有 `vendor/pi` ref.missing，prepare-pi 产物未构建所致；零新增、零消失）。
  对照输出：`build/mayne38-api2-browser/structure-baseline-64f0eed.txt` / `structure-candidate.txt`。
  注：d7688fb 整树另有 12 条（其自有夹具缺件），与本项目树不同源，不作对照基线。

### 最小适配的既有测试（字节变更披露）

- `tests/unit/web-manual-items.test.mjs`（取 d7688fb 字节后 +3 处版本适配）：pairing 缝隙用例的
  `readSnapshot` 桩改为 §6.1 同形（嵌套 settings/workspace/generatedAt）＋StoreRun 新字段；三个 SSE 帧与
  两处 HTTP mock 信封 `web-api/1`→`web-api/2`。断言数量与意图零变化（旧断线/epoch/晚响应反例全部保留）。
- `tests/unit/s2-client.test.mjs`（取 d7688fb 字节后 +2 处适配）：task 行信封→`web-api/2` 并为
  `exited_unknown` 行补一份合法 unresolved 证据；mock json 助手统一注入 `contractVersion: 'web-api/2'`。
  断言零变化。
- 服务层用例仍断言 `item.contractVersion==='web-api/1'`（web-manual-items :92）——该断言针对本树 server 服务
  （V1 谱系），server 零字节改动，属后端消费者候选范围，前端不改它。

## 4. 未验项与边界（如实）

- 未运行完整 `npm run check`、19 旅程、聚合门禁；未 push/远端 PR/部署；未读真实凭据/用户根/真实模型。
- 快照同形与真实 HTTP 的一致性、退出谓词的真实进程验证、stray 清扫真实性、服务端事务水位：不在客户端层，
  真实组合验证归 MAYNE-34；本卡交付仅为客户端候选输入。
- `docs/reviews/README.md` 索引行未加（卡面把公共索引列为只读）；索引登记留 owner/后继按流程处理。
- 生产后端缺口（若有）只登记给 MAYNE-35，本卡未改任何 server 字节。

## 5. 交付物与对照

- 候选：本分支 `agent/opencode/mayne-38` 最新提交（SHA/tree 见本轮评论与 SHA256SUMS）；评审差分以 d7688fb 为基，
  仅覆盖 §1 所列四个写域生产文件与 §3 所列自有测试/夹具/本记录；接源路径与 d7688fb 逐字节相同（diff 为空）。
- 证据目录：`build/mayne38-api2-browser/`（admission、frozen-sample-copies.sha256、red-d7688fb/、green-candidate/、
  browser-run/（TAP 摘要＋两张截图）、structure-*、SHA256SUMS）。

## 6. 修订轮（2026-11-11，Claude，关闭 Codex 独审 F1–F4）

- 受审候选：`b0b791468041eceb08d2fef2fd395dcc8249a5a3` / tree `7470be2227389dcf269e1cad6be65e94512169a7`
  （Codex 评审 `needs_revision`，2×P1＋2×P2）。本修订以该候选为来源按路径接收，保留其通过面；生产写域仍限
  `src/lib/web-api-client.ts`、`src/components/TaskQueue.vue`（本轮未改 pairing.ts/organizer.ts——四项均无需），
  自有回归文件：`tests/unit/web-api-v2-client.test.mjs`、`tests/fixtures/web-api-v2-client/evidence-browser.mjs`。
  CandidateCard.vue 与 d7688fb 字节不变；冻结规范/55 样例零字节。
- **F1（P1）任务级版本身份**：`isV2TaskResource`＋`taskVersionOf` 新助手；`listTasks`、`getTask`、`readSnapshot`
  与 `toModelRun`（纵深防御）四处贯通任务自身 `contractVersion` 判别，V1/缺失/非法一律可读拒绝
  （`contract_version`/`contract_shape`），外层 V2 信封不再能授权嵌套 V1+V2 混合物。
- **F2（P1）队列安装水位**：TaskQueue 新增每 ID「版本/attempt/verdict」基线（仅当前 epoch 有效）。一次读回只要携带
  低版本、同版本异 attempt 或证据回退任一行，整次读回按不权威整体丢弃（fail-closed），已安装显示原样保留；
  只有显式 `syncEpoch` 重装清空基线与显示。organizer 既有围栏未动。
- **F3（P2）披露独立于处置**：`exitEvidenceView` 现对任何有效证据（`registry_extinct` 或 `unresolved`，含 failed 等
  终态行）渲染只读披露：边界句、登记集分解、argv 补充、stray 台账、pending 警告、confirmedAt；不再绑在
  `needs_review`+`exited_confirmed` 的核对面板内。`known_survivor` 文案按证据实际位置派生（登记集/stray/argv/进程组），
  不再把 stray/argv 幸存者误称为登记成员；unresolved 处置仍全禁用。
- **F4（P2）不变式 2/3**：`parseAttemptExitEvidence` 新增可表达阻塞面校验（无阻塞面的伪造 unresolved 拒绝）与 argv 原因约束
  （`null`⇒insufficient_evidence；`performed=false`⇒insufficient_evidence/eperm；`hits>0`⇒known_survivor/insufficient_evidence；
  `performed=false` 不得带 hits）。七份冻结 unresolved 正控与一份确认正控全部继续通过。
- 回归（同测试字节，修前红/修后绿）：`tests/unit/web-api-v2-client.test.mjs` 新增 3 条任务级版本反例＋5 条不变式 2/3 交叉负例；
  `evidence-browser.mjs` 新增 Face 11（旧版本/旧 attempt 不能取代 unresolved 或启用 resolve）与 Face 12（failed+confirmed 披露、
  unresolved stray-pending 台账），并修正三处 `known_survivor` 文案预期为诚实派生文本。
- 本修验证：聚焦 51/51（client 42＋snapshot 8＋浏览器集成 1）、邻域 76/76；`npm run typecheck` exit 0；
  `npm run check:docs` exit 0（21 文件 513 链接）；新/改 .mjs `node --check` 全过；`git diff --check` 干净。
  Codex 独立探针在本修树重跑：`independent-client` 8/8（修前 1/7）、`review-browser` 5/5（修前 1/5），清理四项全真。
- 新候选：`58fcd3843c78eca89dd97011b2fb94803d057419` / tree `15d07449cf99819155f97f4ee1af5f1170c2b32c`
  （相对受审候选 4 文件 +364/−36）。未跑完整 `npm run check`/19 旅程/真实后端组合；未 push/远端 PR；
  最终组合与 main 接收仍归 MAYNE-34。

## 7. 复审修订轮（2026-11-11，Claude，关闭 Codex 复审 F5/F2）

- 受审候选：`653a23c5bce38c1b5b8d81bee0b4468996834bd5` / tree `ba4b7f704c0bb87e4fb23fbfbe23f49586f7e9e3`
  （Codex 复审 `needs_revision`：F1/F3/F4 既有反例已通过，另 2×P1）。本修订只修 F5 与 F2 剩余路径，
  生产写域仍限 `src/components/TaskQueue.vue`，自有回归文件 `tests/fixtures/web-api-v2-client/evidence-browser.mjs`。
- **F5（P1，本轮新增回归）**：`isRegression` 把「确认不可逆」跨 attempt 使用——正常失败重试（同 taskId、版本严格增加、
  attemptId 变化、active/null 证据）被拒，整次读回被丢弃，队列停留旧失败行且其他行停更。现把不可逆证据比较限定到
  **同一 attempt**：`attemptId` 不同即新 attempt，从 active/null 重新开始，不用旧 verdict 判回退；低版本、
  同版本异 attempt、同 attempt 非法回退仍拒绝。
- **F2（剩余缺口）**：`installedRows` 每次只保留本次 collected 的 ID，普通列表遗漏即删除该 ID 水位，随后旧 confirmed
  可重装并重新授权 resolve。现每个见过 ID 在本 epoch 内**同时保留水位与最后一次安装行**；显示跟随权威读回，
  携带回退行的读回整体丢弃并**恢复**被保护的已安装行（先前的遗漏可能已把它移出显示）；只有显式 `syncEpoch` 重装清空。
- 回归（同测试字节，修前红/修后绿）：`evidence-browser.mjs` 新增 Face 13（合法新 attempt 安装＋无关行继续更新，F5）
  与 Face 14（遗漏后旧确认不能重新授权 resolve/发 POST，F2）；Face 6 的 cancelling 行改用独立 taskId
  （该行原本复用 confirmed 样例的 taskId 但版本更低，正是本轮要求保留的水位会正确判为陈旧行；该面仍只测它原本要测的
  staged/cancelling 呈现，与 Face 4/Face 10 已有的独立 ID 克隆写法一致）。
- 本修验证：聚焦 51/51、邻域 76/76、作者浏览器驱动 **74/74**（原 69）；`npm run typecheck` exit 0；
  `npm run check:docs` exit 0（21 文件 513 链接）；`node --check` 与 `git diff --check` 干净。
  Codex 三个独立探针在本修树重跑：`independent-client` 8/8、`independent-browser` 5/5、`generation-browser` 5/5（F5+F2），
  清理四项全真。
- 新候选：见本轮评论 SHA/tree。未跑完整 `npm run check`/19 旅程/真实后端组合；未 push/远端 PR；
  最终组合与 main 接收仍归 MAYNE-34。
