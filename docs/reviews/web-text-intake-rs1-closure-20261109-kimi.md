# Web 文本接入 · RS-1 收口交付记录（2026-11-09，Kimi）

派工：MAYNE-24 触发评论 `01a1be6b-f259-7b45-8357-f253a8b198ae`（Codex）。任务：当前修复之后，用独立小提交收口 RS-1——test 配置快照经服务端重新派生，允许的模型选择沿冻结 DTO 与配置引用，客户端原始 snapshot／skills 不能原样执行或持久化为可信快照；保留已允许的正常 test 输入与既有错误语义；以客户端自带模型／skills 的正反控证明越界输入不生效、配置与引用仍正确；不加新接口或 Runtime 字段，不为证明注入 proven_safe。

**结论先行：RS-1／RS-4 已收口。生产面恰一个文件 `server/lib/http-server.mjs`（`snapshotForTest`，+25/−8）。真实链正反控在修复后 23/23 两连跑全绿；同一套正反控在修复前字节上 4/4 复现越界输入生效（可证伪性成立）。**

## 1. 身份与写入面

- 分支 `agent/kimi/mayne-24`，基点 `ef0f0d4e097391a8e01a8a346973f0fc9b9c45ee`（tree `65d3e0ee…`，即 F-R8-2＋§4.6 路由＋启动校验批次的交付记录提交）。
- 生产 diff 仅 `server/lib/http-server.mjs`：`snapshotForTest` 一个方法。Rust、DDL、003 冻结哈希、守卫、package、前端、Runtime、II/III 文件零差异；未新增接口、未新增 Runtime 字段、未注入任何 proven_safe（生产失败信封的 `sideEffectSafety` 仍由既有注册表产出）。
- 权威输入：ZCode 可信 test 取证 `b72c4b956fe884bff0c824dd23fa9e85e2bce792`（RS-1：`http-server.mjs:678` 对客户端 `input.snapshot` 原样采用、无服务端校验，与 `:673-675`「client 只送 modelId」的意图不符；RS-4：客户端 snapshot 携带 skills 时即使 test 也写 `skills-proof.json`）；前端冻结 DTO `src/lib/web-api-client.ts:733-741`（`test_model` 只送 `{modelId}`）。

## 2. 修复内容（`snapshotForTest`）

修复前：`type='test'` 且客户端带 `input.snapshot` 时**原样采用**（RS-1）；否则用**默认模型**服务端派生——客户端 `modelId` 被完全忽略。修复后：

- 客户端携带的原始 `snapshot`／`skills` 在任何路径都被剥离：既不执行，也不落进 `tasks.input_ref`（无可信快照持久化面）。
- 快照**一律服务端重新派生**：`buildModelSnapshot({modelId: input.modelId ?? null})`——客户端唯一影响是沿冻结 DTO 命名一个**已配置**模型，经 `ConfigStore.resolveModel` 服务端解析（未知名与缺失默认同等解析为无）。
- 模型不可解析时保持既有错误语义：任务照常入队、无 snapshot、运行时由调度器以 `auth_or_config_invalid` 失败（ZCode S2 形状），不在 intake 拒绝。
- RS-4 随之关闭：服务端派生 snapshot 恒 `skills=null`，Runtime `organizer-entry.mjs:114` 的 `skillSnapshot` 分支不可达，`skills-proof.json` 写入面消失。

**语义变化（如实登记）**：修复前未知 `modelId` 被静默忽略、回退默认模型并成功；修复后按配置类失败（`auth_or_config_invalid`，零模型请求）。这是「允许的模型选择沿冻结 DTO」的必要结果——选择必须真实生效，未知名不能静默换成别的模型。生产前端只从已配置列表取 `modelId`（`modelId || null`），不受影响；空串／非字符串同样落该既有失败语义。

## 3. 验证（真实链，原始证据 `build/rs1-closure/`，gitignored）

运行组合：服务端＝本树 `server/entries/web-backend-entry.mjs` 源字节经 `startWebBackend` 启动；Runtime＝本树重建 `build/s0-runtime`（**默认真实 Pi**，非替身）；存储＝release 二进制 **2649408 B、sha256 `42af54b5…490fc2`**（与既往登记逐字节相同）；organizer `08f32db2…`、随包 node `9d050fd4…` 同既往登记。两个 loopback 受控模型服务：已配置服务 A（配置指向）＋rogue 审计服务 R（客户端 snapshot 指向）。凭据为内存 `ControlledCredentialProvider`（合成引用 `controlled:e2e`／`controlled:rogue`，秘密只在 provider 内存与 worker 私有 stdin）。数据库只读观测（`node:sqlite` readOnly，仅 SELECT）。前置链本轮实跑：`npm ci --ignore-scripts` exit 0、`probe:prepare-cli` lark-cli 1.0.98、`probe:prepare-pi` provenance `ad702637`／`e89822b0`、`probe:bundle`、cargo 构建。

### 修复后（HEAD，两连跑形状一致，23/23，exit 0）

| 场景 | 输入 | 结果 |
|---|---|---|
| P1 正控 | `{modelId:null}` | succeeded；A 恰 1 请求（`rs1-model-api`，带 Authorization 头、值不记录）；`input_ref.snapshot` 为服务端派生（provider `rs1-openai`／model `rs1-model`，skills=null）；无 `skills-proof.json` |
| P2 正控 | `{modelId:'rs1-model-2'}` | succeeded；A 恰 1 请求携带**所选** `rs1-model-2-api`；持久化 snapshot 为所选模型的服务端派生——允许的模型选择沿 DTO 生效 |
| N1 反控 | 客户端 raw snapshot（rogue provider/baseUrl/model＋自带 `controlled:rogue` 引用） | **R 零请求**；`controlled:rogue` **从未被解析**（resolvedRefs 仅 4× `controlled:e2e`）；任务仍 succeeded（走已配置默认）；`input_ref.snapshot` 仍是服务端派生（baseUrl＝A，model＝默认），客户端 snapshot 未持久化 |
| N2 反控 | 同上且 snapshot 带 `skills:{root,index:[]}` | **无 `skills-proof.json`**（RS-4 关闭）；持久化 `skills=null`；R 零请求；succeeded |
| N3 反控 | `{modelId:'no-such-model'}` | failed `auth_or_config_invalid`（manual，既有配置类语义）；**零模型请求**；无 snapshot 持久化；客户端 modelId 仍记录在 input |

### 修复前（`ef0f0d4` 原字节，detached 只读工作树 `/tmp/rs1-pristine`，4/4，exit 0）

同一 harness、同一存储／Runtime 构件（差异仅在 server 字节）：N1 的 rogue 服务**收到 1 请求**且 `controlled:rogue` **被解析**；N2 的 `skills-proof.json` **被写出**且客户端 skills **持久化**。即正反控在破损字节上确实检出越界输入生效——非空断言。

### 其他门禁

- I 单测：`web-text-intake` + `web-text-intake-lifecycle` + `web-text-intake-mcp-pairing` **34/34**（`node --test --test-timeout=20000`，stderr 0）。
- `node --check server/lib/http-server.mjs` exit 0；`npm run check:structure`：自测通过，`server/` 零违规——全部 170 条 `[top.dir]` 违例来自会话开始前即存在的平台注入未跟踪目录 `.kimi/`／`.multica/`（与 `ef0f0d4` 登记一致，未删除、未触碰）。
- 脱敏复核：合成秘密值、配对码、cookie/CSRF 在全部运行产物 0 命中；`/Users/` 绝对路径仅出现在运行树路径字段，交付副本已替换为 `<WORKTREE>` 占位并在此声明。

## 4. 边界（如实）

- 未跑完整 `npm run check`（III 唯一集成轮）；未重跑未改 Rust 全量、MCP 配对以外的套件按上表聚焦执行；未 push、未改工单状态，MAYNE-24 保持 `in_progress`。
- 本收口只盖 RS-1／RS-4（客户端 snapshot／skills 面）。RS-2（input.mcp 结构性丢弃）与 RS-3（verification*/g1 不可达）为 ZCode 已核的 fail-safe 面，不在本提交范围；通用进程树退出完整性未证（与 `b72c4b9` 登记一致，不因本提交改变）。
- 生产独审请派未写 `server/lib/http-server.mjs` 的成员；作者不自签。harness 与原始证据在 gitignored `build/rs1-closure/`（`rs1-controls.mjs` 自包含，仅 Node 内置＋slice-II fixtures；两模式运行输出、summary/checks、脱敏副本），平台会回收，关键数字已录本文。
