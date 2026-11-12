# MAYNE-24 两项未归属 HTTP 红的只读归属裁定（T-2 / T-10）

- **日期**：2026-11-09
- **执行者**：OpenCode（III；协调派工 `01a1bfe6-732d-7497-9476-45e8db00db7d`，触发线程 `01a1bb65`）
- **范围与风险级**：只读归属裁定（R0——零生产/测试字节改动）；对两项已登记、尚未归属的套件红给出「生产须修／测试须修／未批 D 边界」三选一判定、精确依据、最小修法与写入归属。不重跑四套件／完整 gate，不重审已有归属，不新建台账／DDL。
- **锁定对象**：生产 `c32c251cdf60d453efc74c62ab4432a2558b8800`（`agent/kimi/mayne-24` 分支头；派工文本后缀 `c32c25185ea0…` 在本对象库不存在，短哈希唯一解析为前者，按前者裁定并在回复中登记该转写出入）；II http `787db84`（套件 blob `40237eec…`、夹具 blob `04dcd4c5…`）；冻结契约 P1 `b190f7c6642625c800396fc04d50009769348c83` 两文档 SHA-256 复算吻合冻结值（web-api/1 `61863271…`、text-intake `5982c062…`）。
- **方法与命令**：纯静态源码读证（`git show`／`ls-tree`／`sha256sum`，脚本 `build/mayne24-http-red-attribution/r1/generate-evidence.sh`，exit 0，全部输出在 `verification.log`）。两条红均为源码决定性行为，无需动态复跑——故未做任何动态聚焦，符合「以源码及可读原始证据为先，如仍需动态只做必要聚焦」。

## 结论一：T-2 `GET /api/agents/advisor` 200 vs 套件 4xx → **生产须修**

- **生产行为（源码决定性）**：`http-server.mjs:157` 路由 `/^\/api\/agents\/([^/]+)(?:\/reset)?$/` 接受任意 agentId → `agentRead`（:896）→ `configStore.readAgent('advisor')`（config-store :318）；`advisor ∈ AGENT_IDS=['organizer','tracker','advisor']`（:29）使 `agentPath`（:211）放行，`agents/advisor.json` 缺失时**制造默认草稿**（version/revision/modelId:null/默认偏好，:321-329）→ `sendJson 200`。夹具 `backend-process.mjs` 不预写任何 agent 配置文件（grep 零命中），故 200 与夹具无关。同理 `PUT /api/agents/advisor`（:353 校验同一三角色集合）与 `/reset` 也会 200 成功——写侧同一缺口，套件本轮只断言了 GET。
- **冻结依据**：text-intake 契约 §5.3 该行 200 响应带规范限定词「**本切片只接线 `organizer`**」；§1「**不在本切片**：advisor 模型建议（W2）…三角色完整配置页（W2/W3）」；§2「三角色配置域逻辑可复用；本切片只接线 organizer，tracker/advisor **后续**」——即三角色域逻辑是 W2+ 的复用储备，不是本切片 HTTP 面。工单冻结派工同向：「未实施的advisor/其它角色工具/native入口继续**准确不可用**」。web-api §10 的 400 `unknown_role` 语义是「角色不在固定集合」，advisor 在固定任务角色集合内、只是本切片未接线，故不宜复用该码；套件只断言 4xx 区间，与两种读法均相容。
- **内部不一致佐证（非「按测试红推定生产错」的独立生产面证据）**：生产任务面已自限接线集——`task-service.mjs:16` `TASK_ROLES=['organizer']`、:415 非 organizer 提交即 400 `unknown_role`。同一生产里任务面拒绝 advisor、配置面给 advisor 发默认配置并允许保存，是配置面自相矛盾；advisor 配置在本切片无任何消费流（调度只认 organizer 快照），200 使未实施角色呈现为「可配置」。
- **排除项**：非测试须修（测试是 P2 已审验收输入，其 4xx 期望即契约限定词的代码化）；非未批 D 边界（该端点本就在已批 §5.3 表内，缺的是限定词的执行，不是新边界；D 指 D1 薄壳／原生能力与 004 申请，域不合）。
- **最小修法（建议）**：在 `http-server.mjs` 的 `agentRead`／`agentWrite`／`agentReset` 入口加接线集门控（本切片 `{organizer}`），非接线 agentId 返回 4xx（`not_found` 404「接口不存在」语义最贴：本切片不提供该角色的此端点；避免改冻结算表中 200 行本身或复用 `unknown_role`）。约 3–6 行，`config-store` 三角色默认草稿逻辑保留给 W2+ 复用，不动任何契约文字与测试。
- **写入归属**：`server/lib/http-server.mjs` 属 I 后端生产清单 → 按 2026-11-09 派工补充由 **Kimi** 唯一负责后继修订；独审按纪律另派未写该文件的成员。

## 结论二：T-10 跨族键碰撞 500 vs 套件 409 → **生产须修（仅状态映射缺失；原子回滚已成立）**

- **生产行为（源码决定性）**：`text-intake-service.mjs:111` 派生键 `sign_off:+SHA-256(JSON.stringify(["sign_off",batchOperationId,candidateId]))` 写入 `manual_item_events.operation_id`（002 DDL :42 `TEXT NOT NULL UNIQUE`）与 `manual_item_sources.operation_id`（003 :156 同）。跨族占键（夹具经 `POST /api/manual-items` 以派生键串建事项，`manual-items-service` createItem 的 `INSERT_EVENT` 同表占键）→ signOff 批内 INSERT 触发 UNIQUE → Rust `web_backend_store.rs:129` `From<rusqlite::Error>` → `WEB_BACKEND_SQL_ERROR`（message 含 `UNIQUE constraint failed: manual_item_events.operation_id`）→ JS `StorageError`（storage-client :68）→ `signOff` catch（:919-941）只处理「批台账竞态合并」：查 `sign_off_batches` 不中（批行未及写入）→ `throw error` 原样重抛 → `http-server` `statusFor`（:50-53）非 ServiceError → **500 `internal_error`**。
- **契约满足面**：§5.1「跨族已占用同形键时按 UNIQUE 冲突**整批回滚**（事务原子）」——`transact` 单事务 + expectChanges，UNIQUE 失败即整批回滚，事项计数不变、候选仍 pending，这两条后置断言生产行为已满足；§5.4 反例列「跨族占键→UNIQUE 整批回滚」同。**缺口仅在 HTTP 面**：§5.1 端点表 `/api/sign-offs` 主要错误为 409 `version_conflict`／`state_conflict`；web-api §10 里 500 `internal_error` 不是该端点任何已注册结果，且 500 由客户端可控输入（自选 batchOperationId 可工程化碰撞）触发，违背本仓「受控错误包络」纪律。
- **排除项**：非测试须修（套件恰在执行 §5.1/§5.4 的明文场景与端点 409 错误面；「squatter 不得占用保留前缀」无契约依据——manual-items 的 operationId 是客户端幂等键，无格式限制，而契约明文把跨族占键规定为必须处理的事件）；非未批 D 边界（无新表/列/权限面，002/003 的 UNIQUE 本就是已批 DDL）。
- **最小修法（建议）**：`signOff` catch 内、台账竞态未中时，对 `WEB_BACKEND_SQL_ERROR` 且 message 含 `UNIQUE constraint failed` 的错误改抛 `ServiceError('state_conflict', '签收派生键已被占用，整批已回滚。')` → 409（套件只断言 409；`idempotency_conflict` 不妥——批 operationId 无台账行、规范输入也不同）。约 4–8 行，纯 server/lib，无 DDL/Rust/契约/测试改动；`idempotency_conflict` 竞态合并路径与未知 SQL 错误的重抛（500 保留给真实内部故障）不变。备选（不推荐为本轮最小修）：Rust 侧给约束错误结构化编码，属已授权 src-tauri 文件但扩大改动面。
- **写入归属**：`server/lib/text-intake-service.mjs` 同属 I 后端生产清单 → **Kimi**；独审另派未写该文件的成员。

## 汇总

| 红 | 判定 | 契约锚 | 最小修法 | 归属 |
|---|---|---|---|---|
| T-2 advisor 200 vs 4xx | 生产须修 | text-intake §5.3 限定词＋§1/§2；工单「准确不可用」 | agent 三路由按接线集 `{organizer}` 门控，非接线 4xx（404 语义） | Kimi（server） |
| T-10 碰撞 500 vs 409 | 生产须修（仅状态映射） | text-intake §5.1 跨族 UNIQUE 整批回滚＋端点 409 面；§5.4 反例 | signOff catch 对非竞态 UNIQUE → `state_conflict` 409 | Kimi（server） |

## 未验证项与边界

- 未做动态复跑（两红均为源码决定性；未重跑四套件/完整 gate，符合派工）；「生产 200／500」的行为断言由锁定字节静态推导，与登记红一致。
- `PUT`/`reset` 的 advisor 行为按同源读出登记（:353 同集合校验），套件未断言，修 GET 时应一并门控，不另立红。
- `signOff` catch 中「非竞态非 UNIQUE 的 `WEB_BACKEND_SQL_ERROR`」仍 500——本裁定不改变该兜底语义。
- 派工文本 `c32c25185ea0…` 后缀与实际分支头 `c32c251cdf60…8800` 不符，按短哈希唯一解析裁定，已如实登记。
- 不签整体准出；E 仍待 owner；MAYNE-24 保持 `in_progress`。原始证据：`build/mayne24-http-red-attribution/r1/`（admission.json、generate-evidence.sh、verification.log、SHA256SUMS，gitignored）。
