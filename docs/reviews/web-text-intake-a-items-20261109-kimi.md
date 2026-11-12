# MAYNE-24 审后 A 项生产修复交付记录（Kimi，2026-11-09）

> 派工：队长评论 `01a1bec0-361e-7c39-8446-1f8e720ab9b3`（ZCode 对 II 配置夹具 `7f3322b` 独审的三类清单）。本批只处理**生产须修**面中派给 Kimi 的 A1/A2/A3/A5/A6/A7，A4 `settings.changed` 按派工纳入当前事件族收口；D1 已于 `7613843`（记录 `681c282`）交付，本批在其上继续。分支 `agent/kimi/mayne-24`，基点 `681c2825bb053b740cc7fdfd7133e75384389139`。

## 结论

**A1/A2/A3/A4/A6/A7 六项已在生产侧修复并聚焦验证（24/24 通过，修复前字节同探针 5 项缺陷原样复现）；A5 复现后定位为测试侧陈旧索引缺陷，生产行为符合冻结契约，本轮不作生产改动——详见 §3。** C2–C5 按派工等 ZCode 取证结论后另定，未批 D 未动；II 断言／Runtime／DDL 本轮零改动。

## 1. 修复明细（按 DTO／签收／事件族／打包入口分提交）

### A1＋A2＋A6（DTO／响应形状）

- **A1**（`server/lib/http-server.mjs` `modelsRead`）：冻结 P1 §5.3 逐字要求 GET `/api/models` → 200 `{providers, models, defaultModelId, revision}`（平铺）；生产原返回 `{contractVersion, configuration}`。现按冻结形状平铺输出，`providers`/`models` 为数组（与 PUT `input` 同侧线型），`credentialStatus` 不属于该形状（由 `/api/providers` 冻结 §7 暴露），未加双读兼容。
- **A2**（`server/lib/text-intake-service.mjs` `rowToCandidate`）：冻结 §5.1 将 `fields`／`evidence`／`dueExpression`／`followupExpression`／`warnings`／`unresolved` 列为候选属性，无 `draft` 包装。现候选线型平铺；内部消费者同步更新（edit/discard/sign-off 的 `unresolved`、`evidence`；revise 任务输入仍以同一 draft 对象经 worker-host `request.candidate.draft` 包装送 Runtime，输入字节与修复前一致）。
- **A6**（`http-server.mjs` `sendError`）：`notFound()` 等无消息抛出的 `Error.message` 是空串，`?? ` 不拦截。信封消息集中改为 falsy 兜底（`服务错误。`），错误信封永远携带非空 message。

### A3（签收）

- `server/lib/text-intake-service.mjs` `signOff`：原 `choices.length < 2 → validation_failed '批量签收至少需要两条候选。'` 无契约依据（冻结 §5.1 该端点唯一 400 是时间未核对 `time_review_required`）。现改为**非空**批次：单选与多选走同一事务、同一 `sign_off_batches` 台账、同一 `sign_off:` 派生键族与 `expectChanges` 守卫（单选批量的台账／派生键／原子性由 I 单测直接断言）；空批次仍 400 `validation_failed`。

### A4（事件族收口）

- `server/lib/task-service.mjs` `writeConcurrency`：`settings.changed` 事件行与设置写入**同一事务**提交，条件 UPDATE 加预提交 `expectChanges: 1`——丢失前提时事件行随整事务回滚，不产生幻影帧（沿用 D1 批次 `fb8c1f4` 的事件族纪律）；返回权威事件 cursor。
- `server/lib/http-server.mjs` `concurrencyWrite`：提交后广播，best-effort（断线／关闭不回滚已提交设置，客户端经 `/api/snapshot` 补偿）。
- `server/lib/sse-hub.mjs` `broadcastSettingsChanged`：帧带 `id: <epoch>:<cursor>`（权威 `task_events` cursor，与 `/api/snapshot` 高水位同源）、`objectType: 'setting'`，纳入有界重放窗与淘汰边界（冻结 web-api/1 §5「变更以 settings.changed 事件广播」／§6 事件类型枚举）。

### A7（打包入口）

- `server/entries/web-backend-entry.mjs`：缺省 `staticRoot`/`storageBin` 从 `server/entries/` 多退一级（`../../../` → `build/{static,bin}`），与 bundle 实际布局 `build/web-backend/{static,bin}` 差一级（静态套件 packaged CLI ENOENT 的登记根因）。改为 `../../`（bundle 根正是模块目录上两级）。`runtimeRoot` 原本就是 `../../runtime`，未动。缺省仍只从模块实际位置（`import.meta.url`）推导，不依赖 cwd；CLI／测试显式覆盖语义不变。

## 2. 聚焦验证（真实链）

环境准备（本轮实跑）：`npm ci --ignore-scripts` → `probe:prepare-cli` → `probe:prepare-pi` → `probe:bundle` → `build` → `build:backend`（cargo release 存储二进制 2649408 B，与既往登记逐字节相同）。

- **聚焦探针**（`build/a1234-probe.mjs`，真实 packaged 入口＋真实 Rust 存储＋真实 bundled Pi organizer＋受控模型服务）：修复后 **24/24 PASS**（A1 平铺四字段且无 configuration／credentialStatus；A2 候选字段平铺且无 draft 包装；A3 单选 200 一事项、空批 400；A4 `settings.changed` 帧 `inst_…:cursor`＋`objectType:setting`；A6 404 信封非空 message）。修复前字节（stash 生产改动重打包）同探针：A1/A2/A3/A4/A6 **五项原样失败**（`configuration` 信封、`draft` 包装、单选 400、无 settings 帧、`"message":""`）——可证伪性成立。TAP：`build/a1234-before.tap`／`build/a1234-after.tap`。
- **A7 真实 CLI 起包**：`node build/web-backend/server/entries/web-backend-entry.mjs --root <tmp> --init` 仅凭缺省路径启动，`/` 返回 200 `text/html`（packaged static），`/api/pair` 正常应答；修复前该启动以 `spawn …/build/bin/web-backend-storage ENOENT` 失败（ZCode r2/r4 TAP 已登记）。
- **I 单测**（我负责的 I 单元面，随生产形状同步更新）：五套 W1 单测合计 **55 例 53 过 2 败**——`web-text-intake.test.mjs` 13/13（含新的单选签收用例：单品批次成功＋派生键＋空批拒绝；`writeConcurrency` 新返回形状）；`events` 11/11；`lifecycle` 10/10（staged 不可签收用例改钉真实 staged 候选 ID 的 `state_conflict` 码，不再借已撤回的批次大小规则）；`mcp-pairing` 11/11；`recovery` 8/10——F1／旧 W 两例为 D1 批次已登记撤回预期，本批在父提交 `681c282` 生产字节上同探针复跑**同两例同签名失败**（8/10），本批增量零回归。
- **守卫**：`check:docs` exit 0（21 文件 513 链接）；`check:structure` 仅余 170 条会话前即存在的平台注入 `.kimi/` `[top.dir]` 违例（与 D1 批次登记一致），本批增量零违例。

## 3. A5：复现结论——测试侧陈旧索引，生产不改

**复现**（`build/a5-repro.mjs`，真实 backend）：

- http T-13（`pair:false` 隔离实例）：首配对成功→经 `onPairingCode` 收到第二码→登出→测试第二次 `receivePairingCode()`（**默认 index 0**）取回的仍是**已消费的第一码**→pair 401 `pair_code_invalid`。与 ZCode TAP 失败点逐字一致（`web-text-intake-http.test.mjs:1164` 第二次 pair）。
- queue two-clients：T-6 先以 `pairAdditionalClient(backend, 1)` 消费 codes[1]（T-6 在 ZCode TAP 中为 ok）；two-clients 再次 `pairAdditionalClient(backend, 1)` 取回**同一已消费码**→401。与 ZCode TAP 失败点一致（`web-text-intake-queue.test.mjs:630`）。

**根因**：两例都是测试重复请求固定索引的已消费码；夹具 `receivePairingCode(index)` 返回 `codes[index]`（ append-only 数组），生产每次成功配对后确实经私有回调发放新码。生产 GAP-2 行为正确的对照证据：static 配对旅程（`receivePairingCode()`→失效→`receivePairingCode(1)` 重新配对）在 ZCode 四套件 after TAP 中通过；本复现中每个被发放码的**首次**配对均 200。

**为何不改生产**：让已消费码重新可用＝多签可用，直接违反冻结 web-api/1 §2「单次有效」与 r2 GAP-2 仲裁「保留 TTL/一次性/限流语义」；按派工「不顺改状态／码断言造绿」，不以实现兼容 Hack 掩盖分歧。

**关闭 A5 所需（测试侧，II 断言Owner）**：http T-13 第二次取码改 `receivePairingCode(1)`；queue two-clients 第二个附加客户端改 `pairAdditionalClient(backend, 2)`。本轮「不改 II 断言」，未动；请队长派 II 断言 Owner（http 套件现由 Pi 持有）落地后 A5 转绿。

## 4. 边界

- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust／前端；II 四套件仍受 Pi 的 B1/B2/C1 夹具修订与 §3 的 A5 索引修复影响，本批不宣称套件准出。
- `82e1bf2` 恢复回归与 events 套件的最终准出分别归 ZCode 既有任务与本批事件族改动的独审；本批仅作验证输入。
- 未 push、未改工单状态（MAYNE-24 保持 `in_progress`）；无真实模型／凭据／用户根；探针与 TAP 在 gitignored `build/`，脱敏复核 0 命中（合成密钥仅经受控 provider 注入）。
