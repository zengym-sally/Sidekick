# `b29afdc` models 读取适配限定复核（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1befe`（Codex）。对象：`b29afdcf0e1a51facd3db3abd9ea324881bb2444`（tree `048d01eb…4208`）中 `src/lib/web-api-client.ts` 恰 +21/−2 的 `readModels` 适配；按派工限定，不扩大到候选／C4／apply。本人未参与该写入。

## 结论

**通过（限 models 读取适配面）**，附三项如实登记（树混合事实、`credentialStatus:{}` 的真实影响面、跨路径词汇缺口归后继）。

## 动态验证（真实链，非类型检查／源码字符串）

环境：隔离 detached 树两棵——服务端取 I 生产字节 `4fc9537`（tree `52b71a2f`，真实 entry＋Rust 存储二进制 2649408 B／`42af54b5…490fc2` 与既往登记逐字节相同＋真实 HTTP/SSE，合成 config：1 provider（`apiKeyRef` 引用）＋1 model＋defaultModelId/revision）；客户端取 `b29afdc` 原字节与其父字节（Node 24 原生 type-stripping 直接加载，未改一字节；cookie‑jar 与 `window.location` 由探针外层补齐，客户端代码零改动）。

- **适配正确性**：`readModels()` 对真实 A1 平铺响应返回非空内部 `ModelConfiguration`——providers/models 各 1、`defaultModelId='model_p'`、`revision='r_probe1'`、provider 文档逐字段保真；**9/9 PASS**（探针随附件）。
- **可证伪**：同探针对父字节（旧 `payload.configuration` 读法）→ `configuration === undefined`，store `install(null/undefined)` → 模型设置面不可用——适配必要性成立。
- **`credentialStatus:{}` 的控件状态影响（派工点名）**：消费面清点——`credentialStatus` 在前端仅两处被读：`ModelSettingsPanel.vue:15`（本适配面）与 `McpSettingsPanel.vue:36`（MCP 自有配置，不受影响）。面板判定是 `credential==='stored'`，驱动 API Key 控件的 placeholder/help 两态。实测：适配后 HTTP 路径 `credentialStatus` 恒 `{}`；**但**（a）冻结 web-api §7 的凭据引用状态枚举是 `available|missing|unavailable`（本审对 `providers-capability` 契约行核字），web 服务端**永远产不出 `'stored'`**——即使适配器原样转发服务端状态，该两态控件在 HTTP 路径也不可能点亮「已保存」分支；（b）`'stored'`/`'environment'` 词汇只存在于桌面 Tauri 路径的 Rust `read_models`（`model_config.rs:440-465` 实读）。因此 **`{}` 未在本适配授权面内引入新的可见控件状态回退**（转发与否渲染相同），判通过；但它确实丢弃了状态数据，见登记 3。

## 登记（如实，不阻断本判定）

1. **树混合事实**：`048d01eb` 树内**不含 W1 text-intake 服务端**（server 谱系止于 MAYNE-23，无 `server/lib/text-intake-service.mjs`，`http-server.mjs` 为旧 blob）——作者记录所引「生产 `modelsRead` :873-887（取自 `a1fe0305`）」必然来自混合树的实测，与协调「不把混合旧服务的实测外推到新 DTO」的告诫一致。本审显式配对「`b29afdc` 客户端字节 × `4fc9537` 服务端字节」消除该混淆；后续候选适配验证须同样锁定同树字节。另注册「恰一文件 +21/−2」仅指 src 文件，提交另含两份 docs。
2. **候选适配尚未完成**（维持协调既定口径）：`WireCandidate`/`toCandidate` 仍读 `draft` 包装，本审未扩大核验；C4 来源日期点、`submitSource` 线型同理不在本审范围。
3. **跨路径词汇缺口归后继控件验证**：桌面路径 `'stored'` vs web 冻结 §7 `available` 族——同一把已存钥匙串凭据，桌面显示「已保存 · 留空保留原Key」、web 路径恒显示「填写后保存到钥匙串」。这不是本提交的回退（词汇分歧先于本提交存在），但 OhMyPi 后续「受影响控件验证」（派工 `01a1beec`）必须把它列为待决产品分歧：要么 web 侧词汇/面板判定对齐（涉及 §7 语义，属契约面），要么接受两路径显示差异，不得静默放过。作者记录自述「控件级验证未做」与此一致。
4. 小勘误：作者记录称旧字节下「`install(null)` 使 `ready` 为假」——实测旧路径 `readModels` 返回 `{configuration: undefined}`，`install(undefined)` 后 `ready=true` 而 `configuration` 为空，症状是空目录态而非 `ready=false`；不影响其结论方向。

## 边界

只写本审阅文档与本机证据（探针脚本＋运行日志＋SHA256SUMS 随评论交付）；未改生产／测试／索引、未跑完整 gate；服务端前置链实跑（provenance `ad702637`/`e89822b0`、存储二进制哈希同登记）；MAYNE-24 保持 `in_progress`。
