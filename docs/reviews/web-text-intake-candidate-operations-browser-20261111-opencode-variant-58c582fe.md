# W1 候选直改的浏览器请求幂等与响应未知读回 —— MAYNE-37 实施记录（OpenCode；候选交付，待独审）

- **范围与风险级**：一次有界 D 后继（MAYNE-33 已批 D 范围的浏览器面）。验证并最小补齐浏览器 `edit`/`discard`/`applyPreview` 的稳定 operationId 与响应未知读回。改动风险 R2（一处生产组件行为修订＋新增聚焦集成套件与夹具）；作者不自签整体 D 完成，交付后由未写本增量者独审。
- **基点与平台现场**：平台分支 `agent/opencode/mayne-37` 起点 `b858257`（tree `77a5485`＝只读主线参照 `1e37044`）。本候选以 merge 引入已审 UI 基点 `29f2ac8`/tree `b37655a5`（merge 后 tree 逐字节等于 `b37655a5`，见 admission 登记与 `git rev-parse HEAD^{tree}` 对照）；无 reset/stash/他枝 checkout，main 未动，未 push。
- **锁定后端**：D 候选 `8b6052b`/tree `883930d`（MAYNE-33 评论 `01a1c942` 限定独审通过，F1–F3 关闭）。**只读消费**：`git worktree add --detach build/mayne37-candidate-browser/backend-tree 8b6052b`，套件内 `git -C <tree> rev-parse HEAD` 硬断言等于锁定 SHA；后端候选零字节未改、未并入本枝。
- **已审前端输入**：UI `29f2ac8`（tree `b37655a5`）及其 SSE R2 谱系（`organizer.ts` wire 代际＋快照围栏、`PairingGate` 的 `candidate.changed`→`organizer.refresh()` 读回路由、TaskQueue 已审字节）——本轮 `src/stores/organizer.ts` **零字节改动**（红前 SHA `c767c6d4`＝绿后 SHA）。

## 1. 交付物

| 文件 | 性质 | SHA-256（交付字节） |
|---|---|---|
| `src/components/CandidateCard.vue` | 生产修订（唯一生产改动） | `3720a7bbcd090be0a38b96ebe48facb6983cfdca7f4ec5d771ae9af93984e46e`（基线 `0fa155ce…`） |
| `tests/integration/web-text-intake-candidate-operations-browser.test.mjs` | 新增聚焦套件（7 例） | `523510eec1c5398a439723f25bd6d27796333bb98c594f5d55f9b813de025e9e` |
| `tests/fixtures/web-text-intake/candidate-operations-browser.mjs` | 新增浏览器驱动＋页工装服务 | `a3d6569d9768c3befeb52aa7b2ec45d548f796b22a2093d46756c866a8b1120b` |
| `tests/fixtures/web-text-intake/candidate-operations-browser-page/index.html` | 新增挂载页 | `1b19567b7ced9e12ac6a156b7a7b722a67cdc54a561dee90be3c6b842c2d71b4` |
| `tests/fixtures/web-text-intake/candidate-operations-browser-page/candidate-operations-entry.ts` | 新增页内入口（真实组件挂载＋只读观测缝） | `a803226096f31913f089d8486578d3c54a8e4527ababb001f6c21b08a2b2e6a5` |
| `src/stores/organizer.ts` | **零改动**（对照登记） | `c767c6d4baa31d2d1ac9f903c3bd72cc1dffaa4c7779fcb45c3fd0627777150d`（红前＝绿后） |

生产 diff 恰为 `CandidateCard.vue` 一处：共享单槽（`lastSignature`/`operationId`）改为**每动作独立槽位**（`operationSlots` Map，save/discard/apply 各持（签名→键）），签名内容不变（动作＋候选当前版本＋全部输入）。`organizer.ts`、`web-api-client.ts`、TaskQueue、导航、client/server/Rust/DDL/守卫/Runtime/package/锁 零字节。

## 2. 实测层声明（每条结果标注所在层）

- **浏览器 DOM**：生产 `PairingGate`＋`InboxView`＋`CandidateCard` 由本树生产 vite 管线（中间件模式，同 `task-controls`/`capability-ui` 谱系）真实编译，经组件自身 click handler 驱动，零 store 注入。
- **浏览器 HTTP**：页面同源请求经 CDP Fetch 层捕获（URL/方法/body 全量，含 `operationId`），反代至锁定后端（Host/Origin 重写＝锁定树响应丢弃代理的同一受控传输）；响应丢弃用本套件自有的**单次定向页流量丢弃代理**（`startPageDropper`：转发请求至锁定后端、上游响应头到达即毁双端 socket——与锁定树 `candidate-operations-response-dropper.mjs` 同机制；锁定脚本为测试进程全流量代理、同源页面无法穿越，故按「可只读复用」精神在本夹具实现单次定向版，未改锁定脚本字节）。传输失败=页面级 `Failed to fetch`（debug 实证，见 3.4）。
- **受控模型**：随包 Pi organizer 真实运行（锁定树 `build/s0-runtime`），模型答复来自受控 OpenAI 兼容服务；无真实模型/凭据/用户根。
- **数据库**：`node:sqlite` 只读观测合成根（`candidate_operations` 台账行数、`candidates` 行），种子全部经真实 HTTP 创建（受控模型驱动真实整理），无手工插行。

## 3. 验证命令与结果（红→绿同字节）

前置（构建单列，不占用例预算）：锁定树内 `npm ci --ignore-scripts`／`npm run probe:prepare-cli`／`npm run probe:prepare-pi`（含 provenance `git rev-parse HEAD:vendor/pi` 校验）／`npm run probe:bundle`／`npm run build:backend`（exit 0；storage 二进制 SHA-256 `111d6d25673e3f6815674381e81ad912f0a52d1ceb311b3af9e5e14e7a189062`）；本树 `npm ci --ignore-scripts`／`npm run build`（typecheck＋vite，exit 0；`dist/index.html` `4bed4a86…`）。

套件命令（用例预算 20000ms 含清理；before 钩子在用例外，120s）：

```
MAYNE37_BACKEND_TREE=<锁定后端工作树> node --test --test-timeout=20000 \
  tests/integration/web-text-intake-candidate-operations-browser.test.mjs
```

- **红基线（修前生产字节）**：**6 过 1 红、exit 1**（`build/mayne37-candidate-browser/red-baseline-tap.log`）；唯一红恰落指名缺陷——
  `the same-intent retry must reuse the original operationId: 4d81d4aa-… vs 3fbcf489-…`：同一动作同一规范请求在**另动作干预后**的重试被静默换了新键（共享单槽被干预动作覆盖）。红基线四文件 SHA 见 `red-baseline-sha256.txt`（与绿轮测试/夹具字节全同，唯生产 `CandidateCard.vue` 不同）。
- **绿（修后，同测试字节）**：**7/7、exit 0**，连跑两轮（`green-tap.log`、`green-run2-tap.log`，用例时长 0.5–1.9s/例）；`node --check` exit 0；`npx vue-tsc --noEmit` exit 0。

七例与独立预期一一对应（每例结果层见括号）：

1. **三按钮/请求路径/body 的 operationId**（DOM＋HTTP＋DB）：真实 DOM 填标题→`保存候选修改`→捕获 `POST /api/candidates/:id/edits`，body 含 UUIDv4 `operationId`/`expectedVersion`/`input`/`timeReviewed`；卡片收敛新标题；DB 版本＋1、台账恰 1 行（该键）。
2. **同意图重试复用原 operationId（跨干预动作）**（DOM＋HTTP＋DB）：丢弃请求在浏览器内传输失败（CDP Request 段 failRequest——请求未出网，受控传输）→干预一次保存（同样失败）→再次丢弃（同键同字节）→红基线两键不同（缺陷复现），修后同键同字节、服务端台账恰 1 行、未发出的保存键台账 0 行。该红绿差即本卡唯一生产修订的必要性证明。
3. **不同意图新键＋逐字重放收敛**（DOM＋HTTP＋DB）：标题甲→标题乙两键不同且 `expectedVersion` 随规范请求推进；随后在页面内以捕获的甲 body 逐字重放→200、版本不前进、返回当前权威态（乙）；台账 A=1、B=1。
4. **响应未知读回＋不自动重发＋重挂先读权威**（DOM＋HTTP＋DB）：丢弃响应在页流量代理处销毁（请求已达锁定后端并提交——台账先行观测）→页面报传输错误→`candidate.changed` 提示经 `PairingGate` 路由 `organizer.refresh()` 读回，卡片离开待确认批次（锁定后端批次读仅含 pending，`text-intake-service.mjs` `getSource` `status:'pending'`——丢弃后卡片消失即权威态渲染）→**全程除该次丢弃外零候选 POST**；整页重载后同样零候选写入（丢失原请求身份不自动用新 ID 重发、不重复执行）。
5. **applyPreview 浏览器路径**（DOM＋HTTP＋DB）：HTTP 预置真实修订任务（受控模型）→页面渲染「班班的修改预览」→`应用到候选`→捕获 `POST /api/candidates/:id/previews/:runId/apply`（body UUIDv4）→版本＋1、预览被消费（应用按钮消失、候选保持 pending——签收是独立批量流程）→页面内逐字重放→200 不再前进、台账仍 1 行。
6. **apply 响应未知读回**（DOM＋HTTP＋DB）：apply 响应销毁→提交先行（台账）→SSE 读回使预览字段并入卡片（标题变化）且保持 pending→除该次外零候选 POST。
7. **页面内负控**（HTTP＋DB）：同键异体→`409 idempotency_conflict`（冻结封套 `web-api/1`）；新键＋过期版本→`409 version_conflict` 且台账 0 行；被拒请求不移动候选。

每例清理真实执行并留证：`cleanup.json`（chrome SIGKILL 退出确认 `exitConfirmed:true`、vite/http 监听关闭、受控模型停止、后端关闭、合成根与 chrome profile 删除）；后端侧按调用方根存活语义由套件 `rmSync` 复删。

## 4. 结构守卫与文档

- `npm run check:structure`：修前修后各跑一次，FAIL 集逐行全等——**恰 11 条全部为合并基线既有**（UI 谱系 29f2ac8 携带的 receipts-restart/test-safety 测试引用后端谱系模块 db-observer/backend-process/controlled-model/synthetic-inputs/credential-provider/mcp-pairing-frames、s32 引用 vendor/pi dist、003 迁移冻结哈希跨谱系差异），本候选零新增零消失；归属对照见 `build/mayne37-candidate-browser/`（基线树 `git archive HEAD` 复检输出）。两谱系组合属 MAYNE-33 最终组合与 MAYNE-34 全门禁，不在本轮范围。
- `npm run check:docs`：本记录入册后 exit 0（见提交前核查）。

## 5. 未验证项与边界

- 未跑聚合（`test:web-text-intake` 接线由 MAYNE-34 在候选独审齐备后统一）、未跑完整 check/19 旅程/全量 cargo；未做 Tauri 壳内组合验证（本页为纯浏览器组合＋最小原生桥 double：`window.__TAURI_INTERNALS__.invoke` 仅把配置读命令委托给 WebApiClient 自身的命令 shim——`/api/models`、`/api/agents/:id` 冻结面回答真实后端配置；被测三操作不经此桥）。
- 观测登记（不在本卡范围，不自行扩域）：①丢弃后批次读仅含 pending，已丢弃/已签收候选不再渲染于收件箱卡片（锁定后端 §getSource 行为，与页面收敛一致，属产品语义确认项）；②合并基线 11 条结构违规与 003 冻结哈希跨谱系差异（见 §4）；③基线树 `organizer.ts`（后端谱系 64 行版）与本枝（R2 谱系 146 行版）并存，最终组合由 MAYNE-33/34 裁定。
- 无 push/远端 PR/部署/真实凭据/真实用户根；API 版本保持 web-api/1；main 只读。

## 6. 结论

**候选交付，待独审**：浏览器面独立预期 1–7 全部有实测层证据；唯一生产修订（每动作槽位）以同字节红绿差证明必要性且最小（恰一文件三处调用点）；`organizer.ts` 现有实现（透传＋SSE 读回＋代际围栏）经验证满足读回预期、零改动保留。不自签整体 D 完成；MAYNE-33 仍需最终组合，MAYNE-34 仍需全门禁。原始证据（红绿 TAP、七例 JSON、清理证明、哈希清单、后端构建日志）在 `build/mayne37-candidate-browser/`（gitignored），精选主证据随评论挂载。
