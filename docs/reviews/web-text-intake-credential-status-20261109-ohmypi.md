# 凭据状态展示独立收口（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1bf33`（「独立收口凭据状态展示：§7 的 `available|missing|unavailable` 不变，适配器按 provider＋引用身份读真实 `/api/providers` 元数据，不再把状态丢成空字典，也不能把 available 直接说成 stored。为此仅增授权 `src/components/ModelSettingsPanel.vue` 的状态文案／展示判断，你原四文件范围继续；Tauri 内部状态形状不改，不新增 API 或环境／钥匙串读写权限。以合成引用验证三种 web 状态、原 native 状态与设置控件读回一致，单独提交送审；不要顺改原件缺失的 UI 数字」）。

## 1. 范围

两个文件：

- `src/lib/web-api-client.ts`（+64/−12）：适配器补上凭据状态读取；同时把 §7 provider 能力面命名成模块级类型（`WireProviderCapabilities` 等），替掉原先内联在 `listProviders` 返回位的匿名形状。
- `src/components/ModelSettingsPanel.vue`（+16/−3）：**本次新增授权**的状态文案／展示判断。

未改生产、未改 `src/domain/organizer.ts` 的 `credentialStatus` 内部形状、未改其余前端、未改测试／package／DDL／Runtime／守卫；未新增 API、未新增环境变量或钥匙串读写权限。

## 2. 缺陷

**缺陷一（适配器丢状态）**：上一轮 models 线型适配（`b29afdc`）为把平铺 §5.3 形状转回内部 `ModelConfiguration`，把 `credentialStatus` 写死成空字典 `{}`——并注释「凭据引用状态不属于 GET /api/models 形状，另由 §7 暴露」。注释正确，但**没有真的去读那个 §7 端点**，于是设置面板永远拿到 `undefined`。

**缺陷二（文案把 available 说成 stored）**：面板原有判断是 `credential === 'stored'` → 「已有钥匙串凭据／已保存 · 留空保留原Key」。`'stored'` 是 **native（Tauri）路径的词汇**——`src-tauri/src/model_config.rs:361` 在钥匙串读到密钥时返回 `"stored"`，`apiKeyEnv` 命中时返回 `"environment"`。而 web 侧 §7 词汇是 `available|missing|unavailable`（`config-store.mjs:265-272` 的 `credentialStatusFor` 直接把 provider 的 `status.status` 透出）。两套词汇从未对齐：即使适配器补齐了状态，`available` 也永远匹配不上 `'stored'`，面板恒显示「未保存」文案。

## 3. 修复

### 3.1 适配器：按 provider 身份 join 两个只读面

`readModels()` 读平铺 §5.3 形状后，新增 `readCredentialStatus()`：

- 调 `GET /api/providers`（§7），其每行带 `providerId` 与引用身份 `credentialRefs[0].ref` 及活状态；
- **按 providerId 身份**把状态写进内部 `credentialStatus`（该 map 本就以 provider id 为键，正是面板读取的键）；
- §7 词汇**原样保留**，不做任何翻译；
- 读不到 providers 面时返回空 map（不猜状态），让控件显示自己的「未知」文案——不 fabrication。

同时把 §7 能力面提成模块级命名类型 `WireCredentialRef`／`WireProviderCapability`／`WireProviderCapabilities`，`listProviders()` 与 `readCredentialStatus()` 共用；替掉原先内联在返回位的匿名形状（也修掉一处 `ReturnType<typeof …>` 式的实现耦合）。

### 3.2 面板：文案按 §7 词汇派生，available ≠ 已保存

新增 `credentialLabel` 与 `credentialResolved` 两个 computed：

| 状态 | 文案 | 计入「已配置」 |
|---|---|---|
| `available` | **凭据引用可解析** | 是 |
| `stored`（native） | 已有钥匙串凭据 | 是 |
| `environment`（native） | 当前使用宿主环境变量 | 是 |
| `missing` | 凭据引用尚未保存 | 否 |
| `unavailable` | 凭据引用不可用 | 否 |
| 其它／缺失 | 凭据状态未知 | 否 |

原 `credential==='stored'?'已保存 · 留空保留原Key':'填写后保存到钥匙串'` 改为基于 `credentialResolved` 的中性文案，并在 API Key 字段下以 `role="status"` 渲染 `credentialLabel`。**`available` 明确不译成「已保存」**——该端点只断言引用可解析，不断言秘密已落 OS 存储。native 的 `stored`/`environment` 分支保留，故 Tauri 内部形状与既有行为不变。

## 4. 验证（11/11）

**A. 真实 HTTP 面（合成引用，controlled provider 状态由 harness 翻转）——7/7**

| # | 断言 | 结果 |
|---|---|---|
| W1 | `available`：适配器按 provider 身份 join `/api/providers` 并记录活状态 | **PASS**（`{controlled: "available"}`，且 map 恰 1 键） |
| W2 | `missing`：已知引用但无值 → `missing` | **PASS** |
| W3 | `unavailable`：未知引用 → `unavailable` | **PASS** |
| V1 | §7 词汇原样保留，未把 `available` 映射成 stored 声明 | **PASS** |
| V2 | 设置控件从同一状态派生文案，且不把 `available` 标为「已保存」 | **PASS** |
| V3 | 内部 `credentialStatus` 形状未变（provider 键控的 string map） | **PASS** |
| V4 | 两个响应都不含合成秘密值 | **PASS** |

**B. 真实产品 UI（headless Chrome，配对 → 设置 → 模型 → 选中供应商，每次翻转后 reload 重读）——4/4**

| # | 断言 | 结果 |
|---|---|---|
| UI available | 控件渲染「凭据引用可解析」，密文框 placeholder「引用已配置 · 留空保留」 | **PASS** |
| UI missing | 渲染「凭据引用尚未保存」 | **PASS** |
| UI unavailable | 渲染「凭据引用不可用」 | **PASS** |
| UI restore | 恢复后回到「凭据引用可解析」，且文案从不出现「已保存」 | **PASS** |

两种读法都证明文案**跟随活值**（每次翻转后 reload 重读），而非缓存或硬编码。

## 5. 边界

- 只改上述两个文件；未改生产、未改内部状态形状、未改其余前端、未改测试／package／DDL／Runtime／守卫；未新增 API 或环境／钥匙串读写权限。
- 未跑完整 `npm run check`；`npm run typecheck` exit 0。
- **未顺改原件缺失的 UI 数字**（派工明确禁止）：本提交不含任何既有 UI 数值修订。
- native（Tauri）路径的 `stored`/`environment` 行为保留但**未在 native 宿主实跑**（本工作树无 Tauri 运行时）；其形状兼容由 V3 与面板分支保留保证，实际 native 渲染留最终版验收。

## 6. 证据

- 附件：`verify-cred.mjs`（HTTP 面 7/7，自包含）、`verify-cred-ui.mjs`（浏览器 4/4，自包含）、两次实跑日志、`web-api-client-adapted.ts` 与 `ModelSettingsPanel-adapted.vue`（适配后全文）、`admission.json`、`SHA256SUMS.txt`。
- 脱敏声明：脚本内合成凭据值替换为 `<SYNTHETIC_CREDENTIAL>` 占位；V4 实证两响应 0 秘密命中；绝对路径替换为 `<WORKTREE>` 并声明。
