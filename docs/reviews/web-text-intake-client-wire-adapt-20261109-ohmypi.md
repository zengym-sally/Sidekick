# `web-api-client.ts` 适配冻结 GET models／候选线型（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1bec0`（「接续适配 `src/lib/web-api-client.ts` 对上述冻结 GET models／候选线型的读取与类型；HTTP 只读一种冻结形状，在适配器转换为既有内部模型／draft，Tauri 内部形状保持」）与 `01a1beec`（「C4 一并纳入：HTTP 只读写日期点，内部 store／Tauri 的 ms 形保持」）。
> 单独提交，**不与已冻结五文件配置修订（`7f3322b`）混写**。

## 1. 范围

仅 `src/lib/web-api-client.ts` 一个文件，+21/−2。未改生产、未改其余前端、未改测试／package／DDL／Runtime／守卫。

## 2. 冻结线型与适配点（逐条对照生产实测）

### 2.1 `GET /api/models` —— 平铺形状（冻结 §5.3）

生产 `modelsRead`（`server/lib/http-server.mjs:873-887`，取自生产 `a1fe0305`）返回：

```js
{ contractVersion, providers: [...], models: [...], defaultModelId, revision }
```

**没有 `configuration` 信封**；凭据引用状态不属于该形状，另由 `GET /api/providers`（冻结 §7）暴露。

适配前客户端读 `payload.configuration` → 恒为 `undefined` → `models` store 的 `install(null)` 使 `ready` 为假、模型设置面板报「还没有可用模型」。**适配后**：HTTP 只读这一种冻结平铺形状，在适配器内转换为既有内部 `ModelConfiguration`（`{providers:{providers:[]}, models:{models:[]}, defaultModelId, revision, credentialStatus:{}}`），store／控件形状不变；Tauri 桥接路径（`asBackend()` 的 `read_model_configuration` 命令面）未动，仍返回 `{configuration}`。

### 2.2 候选线型（冻结 §5.1）—— 已对齐，无需改

生产 `rowToCandidate`／`fieldsToDomain`／`toDomainPoint`（`text-intake-service.mjs:114-130, 208-226`）发出的候选 `draft.fields.due` 是 `{atMs, timeZone, localText, precision}`——**正是内部 domain `TimePoint`**（`src/domain/todos.ts:3`）。客户端 `toCandidate()` 对 `draft` 原样透传，因此候选读路径本就正确；本次未改，避免无谓 churn。

### 2.3 C4 日期点 —— HTTP 读写线型，内部保留 ms

- **写**：客户端 `toWirePoint` 已发出冻结线型 `{at: ISO, timeZone, localText, precision}`；生产 `normalizeDraftPoint`（`:42-62`）**同时接受** `atMs`（内部）与 `at`（线型），故 HTTP 继续写线型、store／Tauri 继续用 ms，双向兼容已有生产支撑，不需双读兼容层。
- **读**：候选的 `due` 在线型上就是 `{atMs,…}`（§2.2），与内部一致；手工事项 `WireItem` 的 `{at}` 走既有 `toDomainPoint` 转换，未动。

## 3. 聚焦验证（fresh run，7/7）

真实生产 HTTP 面（同源 session＋CSRF，非 stub）：

| # | 断言 | 结果 |
|---|---|---|
| A1 | 原始 `GET /api/models` body 确是冻结平铺形状（无 `configuration` 信封、无 `credentialStatus`） | **PASS** |
| A2 | 凭据引用状态由 `GET /api/providers` 暴露（冻结 §7） | **PASS** |
| A3 | 两个响应都不含合成秘密值 | **PASS** |
| B1 | 适配器把平铺线型转成内部 `ModelConfiguration` | **PASS** |
| B2 | 客户端源码确读平铺形状并做该映射（对实测字节核对） | **PASS** |
| C1 | C4 日期点经冻结线型往返不丢元数据（`at`/`timeZone`/`localText`/`precision` 全等） | **PASS** |
| C2 | 生产写路径同时接受 `atMs` 与 `at`（故无需双读兼容） | **PASS** |

另：`npm run typecheck` exit 0；服务 bundle 内含适配（`providers:{providers:` 与 `defaultModelId:` 在 `dist/assets/*.js` 中）。

## 4. 边界

- 只改一个文件；未改生产、未改其余前端、未改测试／package／DDL／Runtime／守卫；未跑完整 `npm run check`。
- 派工要求「待 Kimi 交具体 DTO 后补受影响控件验证」——Kimi 的 DTO 增量（C4 `{at,timeZone,localText,precision}` 上线）在本轮评论中尚未交付精确提交，故控件级验证**未做**，如实登记；本文档§2.3 已按生产现有 `normalizeDraftPoint` 的双形态接受把适配面钉死，Kimi DTO 落地后只需回归 `toWirePoint`／`toDomainPoint` 与候选／预览控件。
- 未把「线型已对齐」写成「候选 DTO 已改」：§2.2 明确候选读路径本就正确、本次未改。

## 5. 证据

- 提交：本轮（分支 `agent/ohmypi/mayne-24`）。
- 附件：`verify-adapt.mjs`（自包含聚焦验证，仅 Node 内置模块）、`web-api-client.ts`（适配后全文，便于点对点核对）。
- 脱敏声明：脚本内合成凭据值替换为 `<SYNTHETIC_CREDENTIAL>` 占位；绝对路径替换为 `<WORKTREE>` 并声明。
