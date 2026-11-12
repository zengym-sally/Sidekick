# MAYNE-24 SSE 客户端黑盒套件工程接收＋聚合接入（OpenCode，2026-11-10）

派工：MAYNE-24 评论 `01a1c236-9ffb-7221-ac06-6de91c928d5c`（Codex：接收 ZCode 黑盒测试能力面通过结论并绑定 R2 谱系后，III 唯一工程接收——从当前 `85c7b84` 谱系做小提交，可独立执行、正式集成仍待另派。只从 `9f796f0` 原样取主测试／harness 两文件（`82c8c0e7`／`fe2bd6b1`）及作者记录，再原样接收本帖 Hermes 独审记录；README／manifest／本人接收记录登记来源、R2 依赖、来源补正及未验项，不覆盖整枝 README 或其它生产字节。准许统一接入既有 `test:web-text-intake`：在原 11 文件末尾各追加一次三个套件，保留原顺序、`--test-timeout=20000`、107 个脚本名、check 链、依赖锁及全部其它 package 字段。验收＝接收文件逐 blob 全等、TaskQueue／六路径闭包齐全、聚合恰 14 个唯一文件、必要语法／类型／docs 核查通过、授权外差异为零；只交接收与接入证据，不运行聚合、构建、19 旅程或完整 gate）。本提交直接位于 `85c7b8460aa2a85cbc234d3a87913ef2a72a5ece`（分支 HEAD）。

## 范围与基点

- 基点：`85c7b8460aa2a85cbc234d3a87913ef2a72a5ece`（分支 HEAD，即 SSE 同步独审记录接收提交）。
- 来源提交：`9f796f06d42b719eb77948fd6bfb408b6d34c2f8`（ZCode 黑盒回归 r1，恰 4 文件：主测试＋harness＋作者记录＋其本人分支 README 索引——后者不接收）；评论 `01a1c233-70f7-7d6a-b5f7-27788cd746f3`（Hermes 独审帖，8 附件）。
- R2 依赖锚：`170f611`（本分支历史内）。协调已核本树六个 SSE 路径与 `170f611` 逐字节相同；本轮独立复核成立（见下）。

## 接收清单（恰 4 文件，逐 blob 全等）

| 文件 | 来源 | blob | SHA-256 | bytes |
|---|---|---|---|---|
| `tests/unit/web-text-intake-sse-client.test.mjs` | `9f796f0`（git show 原样） | `82c8c0e7fcc216f3bfa4b048f0b2479a53b4bb4b` | `4975b8d1b5b08d3541931b8995c75a23275d5aa02c223d230bbf344545977d2f` | 23287 |
| `tests/fixtures/web-text-intake/sse-client-harness.mjs` | `9f796f0`（git show 原样） | `fe2bd6b15d790710c168df7e62b39e9709675d5f` | `5518e905a86783d76f7347b78a2a76772458283977411b77e06f3449b2c5892a` | 19992 |
| `docs/reviews/web-text-intake-sse-client-blackbox-20261110-zcode.md` | `9f796f0`（原路径原样） | `a63a594c1996c1bfe64d6121bcfa5b27ea90e78d` | `72885a411dbbf21356485a2b914a023569c2fe88527e1a5f0f113dcf6925c458` | 10532 |
| `docs/reviews/web-text-intake-sse-client-20261110-hermes-review.md` | 评论 `01a1c233` 附件 `01a1c233-6a3c-7a1b-a377-e1385d7f1ca6`（CLI 实际下载原样） | `35f1984cefc48552bf2b07959cd13c8760104ac5` | `81c3f8ef52cc46245734177b77c22ed4a92a241ea1e8ac76317d7d538ebc8757` | 4940 |

- 主测试／harness blob 与派工点名值逐字全等（`git hash-object` 复算＝来源树）；作者记录 blob `a63a594c` 与 Hermes 独审登记值一致。
- Hermes 记录为附件本体直接落盘（4940 字节＝挂载元数据字节数），来源即本帖；其 `SHA256SUMS.txt`（附件 `01a1c233-7026`）登记的六件运行证据哈希由协调层核对后派发，本轮原样保留于 `build/`，不重签运行结论。
- 内容口径与派工一致：**通过（限测试能力面，绑定 R2 谱系）**；两项登记发现照记（见下）。

## R2 依赖与闭包核验（TaskQueue／六路径闭包齐全）

本树六 SSE 路径与 R2 锚 `170f611` 逐字节全等，且恰为作者／独审登记的 R2 锚 blob 集：

| 路径 | blob（本树＝`170f611`） |
|---|---|
| `src/stores/pairing.ts` | `2910c15cd827cc61a8cf3fe00703adc9bb56957c` |
| `src/stores/organizer.ts` | `e47ce43025e03a06f4c175c94a3e6358ac377ae3` |
| `src/components/PairingGate.vue` | `2c164cad6e59c3e25630de091e8830f99745ed4a` |
| `src/lib/web-api-client.ts` | `1b6a6cfb4e4de734827e64a89a0d8f6e236b5964` |
| `src/components/TaskQueue.vue` | `1d9551a56a06a62e94c8c27c19cc57fa16bd57ee` |
| `src/lib/sse-stream.ts` | `34120cac228a391fdb3588e91442457d486451cd` |

- harness 闭包：import `pairing.ts`／`todos.ts`（`cf2c15d2`）／`organizer.ts`／`web-api-client.ts`，编译挂载 `PairingGate.vue`＋`TaskQueue.vue`（SkButton/SkInput/Icon 浅跳过）——全部在树，零 ENOENT。
- **发现①（候选自树 ENOENT）接收约束满足**：`9f796f0` 自树无 `TaskQueue.vue`（其独审实测 11/11 全红 ENOENT）；本轮按约束只提取已审文件、不整枝落位，接收绑定的本谱系含 R2 六路径＋TaskQueue，零生产字节改动。

## 登记发现②：来源补正（照协调 `01a1c236` 原口径）

完整 I `cd08588` `server/lib/http-server.mjs:161` 已注册 `/api/snapshot`，`:853–879` 读取水位、分页全量任务并返回顶层 `agentConcurrency`，与 `170f611` 客户端 `readSnapshot()` 及本 harness 顶层形状相符。因此「无实际实现可对裁」仅适用于本次受审工程树，不能泛化为完整 I 缺路由。冻结样例的嵌套 `settings`／workspace／generatedAt 差异继续登记（未做组合树真实 HTTP 或完整契约一致性验收）；本轮不改冻结样例，也不据此要求 owner 重做技术裁定。

## 聚合接入（`test:web-text-intake` 11 → 14）

- 原 11 文件末尾各追加一次：`tests/unit/web-text-intake-sse-stream.test.mjs`、`tests/unit/web-text-intake-capability-ui.test.mjs`、`tests/unit/web-text-intake-sse-client.test.mjs`（sse-stream＝本树 `b8a659b` 已收解析器自测 `5e6ff59`；capability-ui＝`64f7c47` 已收 `7b9c0e59`；sse-client＝本轮接收 `82c8c0e7`）——恰 14 个唯一路径，原 11 文件顺序字节不变。
- `node --test`＋`--test-timeout=20000` 不变；脚本名 `test:web-text-intake` 不变；107 个脚本名与键集字节不变；check 链按名引用不变；依赖锁不变；`git diff --numstat package.json`＝1 1。
- 聚合其余 9 路径（`web-text-intake`／`lifecycle`／`mcp-pairing`／`recovery`／`events` 单元＋`http`／`queue`／`controlled-model`／`static` 集成）为 manifest 已登记的 I/II 接收集条目（在他枝），本工程枝 expected-missing、无占位（沿 `48880a2` 先例）。

## manifest 修订 6 → 7

新节 `Z_sse_client_suite`（2 条目：主测试＋harness，含 lineage／review／status）；`C_iii_engineering.aggregate_command_after_sse_client_wiring`（14 文件命令＋变更＋依据）；F「Task-SSE」行前缀 **WIRED+RECEIVED**（修订 6 的 REVIEWED 全文保留为历史注记）；新增 `adjudications.sseClientAdmission`（派工、独审依据、两项登记发现、接收身份、闭包核验、聚合接入、限定核查、未验项、接收——作者 ZCode／独审 Hermes／接收 OpenCode 三方分离）；`writeView.revision7Recount`（条目计数 142→144）。README 索引新增三行（作者记录＋Hermes 独审记录＋本接收记录），标题计数 158→161 按实际行数同步。

## 未验项（照记，不代签）

1. 聚合**未运行**（执行属另派正式集成轮）；未跑构建、19 旅程、完整 gate。
2. 真实浏览器／真实 HTTP／真实 Pi 旅程未验。
3. 快照形状在冻结规范／冻结样例（嵌套 `settings`＋workspace＋generatedAt）／客户端／真实 HTTP 间的一致性未决，待组合树契约一致性验收；冻结样例本轮未改。
4. resolve/retry 与并发设置 UI 仍为后继输入（TaskQueue 入口未接）。
5. Hermes 未验项原样携带：`behavior` 单发响应组合与 S5 600ms 双检的真实时序抖动面未穷举；`holdNextTasks` 栅栏面仅经 S9 单点核。
6. E/D、GAP-5 与整体准出边界不变；MAYNE-24 保持 `in_progress`。

## 实际核查（限定，按派工）

| 核查 | 结果 |
|---|---|
| blob 复算 | 四接收文件 hash-object 全等来源（上表）；接收后树内 `git hash-object` 复核同值 |
| `npm ci --ignore-scripts` | exit 0（环境准备、锁定依赖） |
| `node --check` 主测试＋harness | 各 exit 0 |
| `npm run typecheck` | exit 0（接收后，vue-tsc 全树） |
| `npm run check:docs` | exit 0（接收后：22 文件 592 链接） |
| `npm run check:structure` | FAIL 集 detached `85c7b84` 基线前后**逐行全等**（11 条＝1×003 冻结＋3×vendor/pi＋7×已登记接收集 ref.missing；零新增零消失，零 sse-client 提及；`--self-test` 在链内通过） |
| 授权外差异 | `git diff 85c7b84 --name-only` 恰 7 文件：四接收文件＋README＋manifest＋package.json＋本接收记录（另 AGENTS.md 为运行时既有标记改动，不入本提交） |

未跑（按派工边界）：聚合、构建、19 旅程、完整 gate、任何行为重放或套件重跑。

## 边界与结论

恰 8 文件（四接收＋package.json 聚合接入＋manifest 修订 7＋README 三行＋本接收记录）；零生产／server／Runtime／DDL／锁字节；不操作 main；不启动正式集成或完整 gate（另派）。限定接收通过：接收文件逐 blob 全等、TaskQueue／六路径闭包齐全、聚合恰 14 唯一文件、语法／类型／docs 核查通过、授权外差异为零。原始证据 `build/mayne24-sse-client-receive-20261110/`（gitignored：blob 复算、附件下载读回、structure 前后对照、聚合分解核验）。MAYNE-24 保持 `in_progress`。
