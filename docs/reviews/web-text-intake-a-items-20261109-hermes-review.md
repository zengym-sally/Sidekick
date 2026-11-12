# MAYNE-24 A 项批独立独审记录（Hermes，2026-11-09）

派工：MAYNE-24 线程评论 `01a1befb-614e-798e-88dc-55edcee4d390`（Codex，2026-11-09）。对象：生产范围 `681c282..4fc95374ed7550349020fbd96e42cf0a311220f9`，按四个生产提交分别裁定，另覆盖两份 I 单测修改。本人未参与该候选的任何生产／测试写入。

## 1. 身份复核（全部成立）

- `4fc9537` tree `52b71a2f1ae14ef427c49861fc0b353bad2a698e` 与锁定值逐字节一致；范围恰 7 个提交（4 生产＋1 测试＋2 docs）。
- 生产五文件 numstat 复算 +128/−31 与锁定数一致：`web-backend-entry.mjs` 10/6、`http-server.mjs` 29/3、`sse-hub.mjs` 27/0、`task-service.mjs` 30/6、`text-intake-service.mjs` 32/16。
- `git diff 681c282 4fc9537 -- src-tauri/ runtime/ vendor/ package.json` 为空：DDL／003／Runtime／依赖零改动；无新增依赖、无 II 套件／夹具改动（A5 确未触碰，保持开放，归 Pi 既派任务）。

## 2. 逐提交结论（对照冻结契约）

冻结输入复核：P1 契约 `b190f7c` 处 `web-text-intake-contract.md` SHA-256 复算 `5982c062…7b0` 与登记一致；web-api/1 冻结件定位在 `9d094d39`，SHA-256 复算 `61863271…f58d` 与登记一致。

- **`f0ae347`（A1/A2/A6 DTO）：通过。** GET `/api/models` 平铺 `{providers, models, defaultModelId, revision}`（§5.3 逐字），无 `configuration` 信封、无 `credentialStatus`、无双读兼容；凭据引用与状态仅在 `/api/providers`（§7 `listProviders` 只出 ref/status/detail，不回读秘密）。候选平铺 `fields/evidence/dueExpression/followupExpression/warnings/unresolved`（§5.1），内部消费（edit/sign-off/`unresolved` 门、evidence 落 `manual_item_sources`）全部同步；revise 任务输入经 worker-host `request.candidate={draft: input.candidate}` 包装后与修复前同形（`worker-host.mjs:250` 未动），输入字节不变。错误信封 falsy 兜底使空 message 不再出现。
- **`620c31f`（A3 签收）：通过。** `choices.length < 2` 无契约依据（§5.1 该端点 400 仅时间未核对），改非空批次；单选与多选同事务、同一 `sign_off_batches` 台账、同一 `sign_off:`＋SHA-256(紧凑 JSON) 派生键族（§5.1 派生定义逐字）与 `expectChanges` 守卫；空批 400 `validation_failed`；重放／`idempotency_conflict`／跨族 UNIQUE 整批回滚路径未动。
- **`a1fe030`（A4 设置事件）：通过。** `settings.changed` 事件行与设置写同一事务；两条 agentConcurrency 模板 SQL 字节未动，仅加预提交 `expectChanges: 1`（丢失 CAS 连事件一起回滚，无幻影帧）；提交后 best-effort 广播，帧带权威 `id: <epoch>:<task_events cursor>` 与 `objectType:'setting'`（web-api/1 §5「变更以 settings.changed 广播」／§6 枚举），进有界重放窗；`readHighWatermark` 与 `/api/snapshot`、SSE 握手同源（MAX(cursor) 不分 object_type），跨客户端重放一致。
- **`d0c8ec2`（A7 打包入口）：通过。** bundle 布局 `build/web-backend/{static,bin}` 与 III `build-backend.mjs` 实际输出一致；入口在 `<bundle>/server/entries/`，`../../` 恰达 bundle 根；缺省仍从 `import.meta.url` 推导、不依赖 cwd；CLI／测试显式覆盖语义未动。
- **`dd609765`＋`f0ae347` 的两份 I 单测修改：通过。** staged 不可签收用例改为先 `SELECT candidate_id,status` 读回**真实 staged 行**、用其真实 `candidate_id` 触发状态守卫，断言收紧为 `state_conflict`（旧写法借 `'cand_missing'`＋已撤回的批次大小规则，恰是本批要消除的伪绿）；`web-text-intake.test.mjs` 同步平铺形状／单选签收／`writeConcurrency` 新返回形状并断言权威 cursor。
- **两份 docs（`0c741e9`／`4fc9537`）：与实跑一致。** 最终 55/53 计数与本人独立复跑逐套吻合（23＋11＋11＋8 过；recovery 10 例中 F1／旧 W 两败）。

## 3. 独立动态验证（真实链，全部本机实跑）

前置链实跑 exit 0：`npm ci --ignore-scripts` → `probe:prepare-pi`（provenance `ad702637`/`e89822b0` 与既往登记一致）→ `probe:prepare-cli` → `probe:bundle` → cargo release 存储二进制 **2649408 B／`42af54b5…490fc2` 与全部既往登记逐字节相同** → `build`＋`build:backend`（bundle `build/web-backend/{bin,server,shared,static}`，static 为真实产品 dist）。隔离 detached worktree（head `4fc9537`／base `681c282`），node v24.20.0／cargo 1.89.0。

1. **I 单测 @ head**：main＋lifecycle 23/23、events 11/11、mcp-pairing 11/11、recovery 8/10——F1／旧 W 两例在父提交 `681c282` 生产字节上复跑同两例同签名（8/10），本批增量零回归。
2. **可证伪（单测面）**：head 两份单测文件覆写 pristine base 字节 → 19/23，恰四处改动点红：A2 平铺断言、A3 单选签收、A4 `writeConcurrency` 新返回形状＋cursor、lifecycle `state_conflict` 钉（base 以批次大小规则拒绝，证明新断言确钉状态守卫）。
3. **HTTP 探针（自写 harness，种子候选行，真实 entry＋Rust 存储＋HTTP/SSE，无脚本化 worker）**：head **19/19 两连跑 exit 0**——A1 平铺四字段且无 `configuration`/`credentialStatus`；A2 平铺无 `draft`；A6 404 信封非空 message；A3 单选 200 一事项＋同 operationId 重放 `replayed:true`＋空批 400＋staged 409 `state_conflict`＋库内 `sign_off_batches` 台账行＋`manual_item_events` 派生键与 `deriveSignOffKey` 逐字相等；A4 PUT 200（响应含 frozen §5.3 设置读回形状）、`settings.changed` 帧 `inst_…:<cursor>`＋`objectType:'setting'`＋cursor 与库内 `task_events` 行（`object_type='setting'`）一致、第二客户端连入收到帧、带 `last-event-id` 重连该帧被重放、过期 CAS 409 且**零幻影帧零幻影事件行**。base 服务四文件同探针 **5/19**，A1/A2/A3/A4/A6 全部按预期方向失败（`configuration` 信封、`draft` 包装、单选 400、无 settings 帧、空 message）。
4. **A7 真实打包 CLI**：head 入口仅凭 `--root/--init` 启动（缺省路径），`/` → 200 `text/html`（真实 packaged static），`/api/pair` 正常应答；base 入口字节放同一 bundle 启动 → `spawn …/build/bin/web-backend-storage ENOENT`（登记缺陷原样复现）。

## 4. 缺件与登记（如实）

- **作者动态证据未随评论交付**：交付评论 `01a1bef7-635e` 附件为空（CLI 读回确认），TAP／探针（`build/a1234-*.tap` 等）在 gitignored `build/`，按平台惯例已不可读回。**作者 24/24 不预签**；本审结论只依据上文本人独立前后链。
- 观察（非阻断）：`sse-hub.mjs broadcastSettingsChanged` 的 `cursor ?? this.cursor+1` 兜底在事件行未返回 cursor 时会以 hub 本地计数造帧 cursor；提交成功后 `INSERT…RETURNING cursor` 恒有行，实际不可达，且超水位伪造令牌走安全 `cursor_out_of_window` reset。不要求改动。
- 日期点：候选线上 `fields.due` 仍为内部 `{atMs,timeZone,localText,precision}`（探针实录）——C4 线上日期点（`{at,…}`）是队长 `01a1beec` 已排的 Kimi 后继增量，本批未改、未回退，保持开放。
- A5：范围零改动，与派工一致，暂不关。

## 5. 边界

只写本审阅文档与本机证据（隔离树＋scratch，随评论交付 SHA256SUMS）；未跑完整 `npm run check`、未跑未改 Rust 的 cargo 全套；未触其他成员工作树、真实凭据、真实模型、真实用户根；MAYNE-24 保持 `in_progress`，未提前集成。
