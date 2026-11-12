# Web/后端文本整理 — 凭据候选 F1–F3 收口独审（OhMyPi，2026-11-09）

> 范围：仅客户端 `src/lib/web-api-client.ts` 与 `src/components/ModelSettingsPanel.vue` 两文件。
> 对象：本分支 `agent/ohmypi/mayne-24` 上 `4846e61`（父 `6e27d1e`）之后的收口改动。
> 结论：**F1 / F2 / F3 三项均按 `0e32576` 收口并通过**；HTTP 读取面限定证据保留，不签完整 UI/native 验收。
> MAYNE-24 保持 `in_progress`。

## 一、三项缺陷的机械核对与修法

### F1 — 状态必须同时匹配 provider 与配置中的实际引用

**原状**（`readCredentialStatus()` 无参）：只按 `providerId` 取 `credentialRefs[0].status`。
`readModels()` 的 `GET /api/models` 与 `readCredentialStatus()` 的 `GET /api/providers` 是两次独立往返，两次之间发生配置写入时，providers 行描述的是**新引用**，而快照携带的是**旧引用**；旧实现把新引用的 `available` 安到旧引用上。

**修法**：`readCredentialStatus(configuredProviders)` 改为按引用身份匹配——
从 models 快照的每个 provider 取 `auth.apiKeyRef ?? (auth.apiKeyEnv ? 'env:'+apiKeyEnv : null)` 作为期望引用，
providers 行 `credentialRefs[0].ref` 与期望引用不一致时**丢弃该条目**（entry 保持缺失，控件显示自身"未知"文案），
不归因到快照引用。这是刻意的保守选择：不一致行描述的可能是与配置实际使用的不同的凭据。
providers 读取失败仍返回 `{}`，不伪造状态。

**核对**：跨读引用切换反例（快照 `credential-a`，providers 行 `credential-b`）→ `credentialStatus` 为空，不再误报 `available`。

### F2 — `missing` 改为缺值/不可解析的中性描述

**原状**：`凭据引用尚未保存` —— 断言了"引用尚未保存"，这是 endpoint 不断言的事实。
`missing` 的语义是"引用已知但没有解析到值"，与"是否曾保存过"是两件事。

**修法**：改为 `凭据引用未解析到值`。内部 status 形状不变（仍走 `credentialStatus` 记录）。

### F3 — 凭据输入文案与实际管道一致

**两条管道的真实行为**（已核对源码，非推测）：

| 管道 | 输入 `model.keys[providerId]` 的真实去向 |
|---|---|
| native（Tauri bridge 在位） | `saveProvider()` 置 `input.apiKeys[id]`；`src-tauri/src/store/model_config.rs` 为其生成 `credential-<new_ref>` 引用、`credential_write()` 写入系统钥匙串，并把 provider 重指向该引用。明文永不入配置文件，已有密钥不回读。 |
| web（纯浏览器） | `asBackend()` 的 `save_model_configuration` 分支**完全不读 `input.apiKeys`**，直接 `writeModels()`。非空值被静默丢弃，而保存仍报告成功。 |

**修法（两处，均为必要机械改动）**：

1. `web-api-client.ts`：`save_model_configuration` 在写配置前逐项检查 `input.apiKeys`，非空值抛
   `WebApiError('PLAIN_CREDENTIAL', 400)`，消息说明浏览器模式没有钥匙串、请改用环境变量引用或在桌面端保存。
   复用 native 的 `PLAIN_CREDENTIAL` 码，使 store 与用户看到同一失败；空值仍放行（store 每次保存都会带上该槽位）。
2. `ModelSettingsPanel.vue`：新增 `keychainPipe = nativeBridgeAvailable()` 与 `keyHelp` / `keyPlaceholder`，
   两管道分别给出与实际存取一致的中文案；`credentialLabel` 的注释补充 `missing` 的中性语义说明。

不新增 API、OS provider 或权限，不扩写 SettingsPanel/store/领域形状。

## 二、聚焦前后验证

聚焦验证脚本（throwaway，随本评论附件交付，不入库）驱动**真实** `WebApiClient` 的
`readModels()` / `save_model_configuration()` 路径与**真实**编译后的面板 setup/template。

```
$ node --test build/web-cred-closeout/verify-f123.mjs
ℹ tests 10   ℹ pass 10   ℹ fail 0
```

三次连跑均 10/10。**可证伪性**：同一脚本指向收口前源码（`git show HEAD:…`）时：

```
PRE-FIX : ℹ pass 5  ℹ fail 5
POST-FIX: ℹ pass 10 ℹ fail 0
```

失败的 5 项正是 F1 跨读切换、F1 无配置引用、F2 missing 文案、F3 非空 apiKeys 拒载、F3 两管道文案——
每项在**同一输入**上可观察地从失败转为通过，不是换断言凑绿。

面板真实渲染矩阵（`render-panel.mjs`，SSR 渲染真实编译模板）：

| 管道 | status | 收口前 help / placeholder | 收口后 help / placeholder |
|---|---|---|---|
| web | missing | 只写入凭据引用，不回读已有密钥明文。/ 填写凭据引用 | 浏览器模式没有钥匙串：请改用环境变量引用，或在桌面端填写密钥。/ 请改用环境变量引用 |
| web | available | 凭据引用可解析；留空保留原引用。/ 引用已配置 · 留空保留 | 同左（web 下同样说明无钥匙串） |
| native | missing | 只写入凭据引用，不回读已有密钥明文。/ 填写凭据引用 | 密钥将写入系统钥匙串，不回读已有密钥明文。/ 填写密钥 |
| native | available | 凭据引用可解析；留空保留原引用。/ 引用已配置 · 留空保留 | 同左 |

收口前 web 与 native 渲染**完全相同**的文案，且 web 承诺了它无法执行的"写入凭据引用"——这正是 F3 的可见症状；
收口后两管道分叉，各自与真实管道一致。

## 三、来源与 overlay 披露

- 本分支 HEAD `4846e610ae1349921a06003a7abe2513ba045857` / tree `92151ae2150a95acc77530236862e609ccd64ada`。
- 完整 I：`b29afdc`（adapt web-api-client.ts to the frozen flat `GET /api/models` shape）、
  `4c98309`（carry `WirePreview.runId` through the apply path + map the flat candidate wire row）、
  `6e27d1e`（read the real §7 credential status and stop calling `available` "stored"）、
  `4846e61`（never surface a staged candidate as an actionable one）。
- 本轮所选前端提交：上述 `6e27d1e` 与 `4846e61` 已在本分支；本轮在其上叠加 F1–F3 两文件改动。

**overlay 披露（重要，不代签）**：本轮只改两文件，**未包含**下列 overlay 接线，因此浏览器端
模型面板的**实际运行**仍未被本轮验证：

- `src/components/SettingsPanel.vue` 本分支仍为 `ModelSettingsPanel v-if="nativeAvailable"`（blob `c412cf3f`），
  而对象库读回的 `d79b1f6` / `cbb04f7` 为 `fa75f477`（models/agents 面板已无 native 门控）。
- `src/stores/models.ts` 本分支仍 `createModelSettings(invoke)`（blob `52634c43`），
  `d79b1f6` 为 `2be89983`（`getWebApiClient().asBackend()`）。
- `src/stores/agents.ts` 同理（本分支 `71abbabf` vs overlay `da044b6e`）。

即：F3 的 client 拒载与文案在**模块级**已验证，但"web 管道端到端弹错并保留草稿"需上述接线在场才能跑通，
本轮未跑。此项不因 UI 归因纠正而消失，按协调层口径留待唯一集成轮。

## 四、未签范围

- 未跑完整 `npm run check`。`npm run typecheck`（vue-tsc）干净；`npm run check:docs` 通过（21 文件 522 链接）。
- `npm run check:structure` 在本工作树有 **194 项预先存在的失败**（170 项 `.omp/` 顶层目录、24 项缺失
  `vendor/pi` dist 与未取回的 web-text-intake 夹具）；已用 `git stash` 对照确认改动前后同为 194 项，
  且无一落在本轮两文件上。未修，属环境缺口。
- 未跑 Rust / 真实 Pi / backend 构建 / web-text-intake 集成套件（夹具与 `build/web-backend` 不在本工作树）。
- `tests/unit/s2-client.test.mjs` 34 pass / 1 fail，该失败（Tauri 迟到取消响应路径）改动前后同为 1 项，与本次两文件无关。
- 未跑真实钥匙串/环境秘密读写；native 实际渲染未验仍须明列。真实模型/Linux/代理/真实凭据/用户根/原生未验逐条保留。

## 五、附件

- `verify-f123.mjs` — 聚焦验证脚本（10 项，含指向收口前源码的 falsifiability 变体用法见脚本头）。
- `verify-prefix.txt` — 收口前源码上的运行输出（pass 5 / fail 5）。
- `render-panel.mjs` — 真实编译模板的两管道 × 两状态渲染矩阵。
- `rendered-copy.txt` / `rendered-copy-prefix.txt` — 收口后 / 收口前渲染文案矩阵。
- `checks.txt` — typecheck / check:docs / check:structure / 相关单测的原始输出。
