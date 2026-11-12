# W1 凭据状态展示独立收口独审（OpenCode，2026-11-09）

> 派工来源：评论 `01a1bf5f`（锁定 `6e27d1ed`/tree `eeef6c83`，源码两文件作为待审候选；「当前 `4c98309` 审后续审这两份源码与凭据证据，代码／HTTP／UI／native 未验面分别给结论，必要仅聚焦重放，不再跑 A/B/C 全旅程」）。作者 OhMyPi（未参与本审）；本审未写该候选任何字节。

## 0. 结论

**不通过（退作者窄修）。** 分面结论：

- **HTTP 读取面：通过（限定）**——词汇原样透传（`available|missing|unavailable` 不翻译、不把 available 说成 stored）、缺引用／读失败降级不伪造状态、会话失效信号不被吞、16 个捕获响应 0 秘密命中（13/13 探针全绿）。
- **代码面：不通过**——F1 并发引用变更误归属（受控反例实锤）；F2 `missing` 文案「凭据引用尚未保存」对已配置引用失实；F3 新 placeholder/help 文案与 web／native 实际存取管道均不符。
- **UI 面：作者证据按原范围保留＋覆盖面须补披露**——提交树浏览器模式下该面板根本不渲染（`SettingsPanel.vue:27` nativeAvailable 门），作者 headless Chrome UI 证据必然带 `__TAURI_INTERNALS__` 桩与 invoke→asBackend 换接，记录未披露（与本审上一轮 apply-ID 评审 F5 同类证据口径问题）。
- **native 面：结构核通过（形状未变），实跑未验（明列）**——无 Tauri 运行时与真实钥匙串，未实跑 native 渲染；候选对 `src-tauri/` 零字节改动（diff 复核）。

## 1. 身份与证据读回

- 候选：`6e27d1ed84ef2a23c12157c1a845d2a3ae553433`／tree `eeef6c835b01ab15e31dd33a56e1e8518be7166e`／父 `4c98309f`（tree `540a9eb3`），4 文件：`src/lib/web-api-client.ts` **+57/−7**、`src/components/ModelSettingsPanel.vue` **+15/−1**、作者记录 +83/−0、README 索引 +2/−1（numstat 自算）。作者记录所写「+64/−12」「+16/−3」与提交 numstat 不符（64/16 恰为变更行总数），登记精度注记，不另立案。
- blob：适配器 `d65f6f64`（SHA-256 `b3e00425…710aec`）、面板 `71f9639a`（`a64f7330…80edd2`）、记录 `d883848b`（`beaf8a6b…1604c2`）。
- 附件 CLI 读回 3/3：`web-api-client-adapted.ts`、`ModelSettingsPanel-adapted.vue` 与提交内文件逐字节一致；`SHA256SUMS.txt` 内该两文件哈希复算一致（清单另 6 项为作者本地文件，未随评论附文件）。
- 对照服务端字节：审定生产链最新记录提交 `0536a44`／生产末提交 `c7cc116`（tree `88fe669c`）；凭据相关四文件 blob 在 `29305da`（`f91ddf56`）／`c7cc116`／`0536a44` 三树逐一致——`config-store.mjs` `752c414c`、`http-server.mjs` `c94a359e`、`model-snapshot.mjs` `7d7d84dd`、`credential-provider.mjs` `0f8cf42e`。冻结契约 `docs/engineering/web-api-contract.md` SHA-256 `61863271…58d`（§5.3／§7 :257）复核不变。
- 候选树 `vue-tsc --noEmit` exit 0；`vite build` 产物 `dist/index-Dgs2i8QW.js`（本审自建，仅作可构建证据）。

## 2. 聚焦重放（真实适配器 × 真实后端，13/13）

方法：候选适配器字节（blob `d65f6f64`，仅类型导入，tsc 单文件转译后确认无运行时 import）在 Node 内对**真实生产后端**（`0536a44`/`c7cc116` 的 `server/entries/web-backend-entry.mjs`＋`c7cc116` src-tauri 自建存储二进制 `5311ffa3…3232bd`）执行；受控凭据 provider 经**授权私有注入口**（`config.credentialProvider`）注入，配对码走私有 `onPairingCode`；并发时序用 `request` 覆写夹子注入（候选字节零改动）；会话失效两例在独立后端实例上隔离（删除会话会作废待用配对码）。探针脚本与结果随评论附件（probe-cred.mjs `580fcf3c…8607`、probe-result.json `18f84edb…83aa1`、门禁截图 `552e878e…68a3e`）。

1. **字段身份**：`GET /api/models` providers 行携带 `auth`（引用身份在客户端可见）；`GET /api/providers` 行携带 `credentialRefs[0]`＝`{ref,status,detail}` 且当前服务端恒单条——但**视图 ref＝原始 auth 成员**（`apiKeyRef ?? apiKeyEnv`，config-store :397），`env:` 前缀只存在于状态计算（:268）；客户端若做身份比对必须按 `wireRef === (auth.apiKeyRef ?? auth.apiKeyEnv)`。契约 :257 的 `credentialRefs` 是数组，客户端取 `[0]` 是位置取值（现服务端字节单条，不立案，接线时须防多引用）。
2. **F1（实锤）：并发引用变更误归属**。时序＝读 `/api/models`（旧配置快照，provider 认证 `env:OTHER_KEY`，真状态 unavailable）→ 其间受控 `PUT /api/models` 改为 `env:TEST_KEY`（真状态 available）→ 读 `/api/providers`。适配器返回：configuration 仍显示旧引用 `OTHER_KEY`，而 `credentialStatus[p1]='available'`——**新引用的 available 被安到旧引用的配置快照上**；快照 revision 停留旧值（后续保存 CAS 会 409，但读取展示在重读前一直失真）。派工原文要求「按 provider＋引用身份读」，实现只按 providerId 键控取 `credentialRefs[0].status`，未做身份关联——**偏离派工**。
3. **F2（实锤）：`missing` 文案失实**。provider p2 认证携带 env 名（引用**已配置**）、受控值置空 → 服务端 `missing`（状态源 detail「引用存在但暂无可用值。」）→ 面板按候选文案渲染「凭据引用尚未保存」。且 §7 视图把 `detail` 硬编码为 `null`（config-store :399），UI 永远拿不到状态源给出的区分性 detail——文案无法自洽覆盖「从未保存」与「已配置但暂无值」两情形。
4. **降级与零秘密（通过）**：providers 面读失败 → 空 map（不伪造，控件显示「凭据状态未知」）；整读 401 → 抛 `unauthenticated` 且 `sessionLost` 恰触发一次；读中途 401（models 成功、providers 前 DELETE 会话）→ `readModels` **正常返回**＋空 map，且 sessionLost 仍触发（信号未被 catch 吞掉，配对门接管——登记细微点：models store 自身 `ready=true`，读取「成功」与全局会话失效并存）；16 个捕获响应 0 秘密标记命中。

## 3. 文案与管道（F3）

- **web 管道**：面板 API Key 输入绑定 `model.keys[p.id]`；保存时经 `saveProvider` 进 `input.apiKeys`（stores/models.ts :27），而适配器 `save_model_configuration` shim（web-api-client.ts :881-890）**只解构 providers/models/defaultModelId，`apiKeys` 整体丢弃**；服务端本也拒绝非空 `apiKeys`（`plain_credential`，config-store :270-274）。即 web 下该输入值**哪都不去**；新 key 模式 provider 经 `serializeProvider`（model-catalog :15）落到 `apiKeyEnv='SIDEKICK_API_KEY'` 回退，重读后还改显示为环境变量模式。故 help「只写入凭据引用，不回读已有密钥明文。」在 web 承诺了**不存在的写入行为**，placeholder「填写凭据引用」邀请的输入会被静默丢弃。
- **native 管道（结构核，未实跑）**：`model_config.rs` 保存路径把 `api_keys` 的**值**作为真实密钥写钥匙串（:497-528 `credential_write`→`set_password` :374），配置只留生成的 `credential-<rand>` 引用（:507-510）；状态词汇 `stored`/`environment`（:458/:452）。placeholder「填写凭据引用」**改变了 native 输入语义**——native 用户实际输入的是密钥本体；照文案输入引用串会被当成密钥存入钥匙串。help 对 native 半准（配置面只写引用、不回读明文），但与 placeholder 合并误导。
- 面板对两条路径渲染同一份无条件文案（无模式分支）。

## 4. 接线与证据覆盖（F4）

- 提交树中 `SettingsPanel.vue:27` 以 `nativeBridgeAvailable()`（host-capabilities.ts :7，检测 `__TAURI_INTERNALS__`）门控 `ModelSettingsPanel`——本审真实浏览器打开设置→模型服务，实见「未接通：浏览器模式不加载模型服务配置。」（截图随附件），**候选全部面板改动在浏览器模式不可达**。
- `stores/models.ts:35` 把模型设置 store 绑定原生 `invoke`（非 `getWebApiClient().asBackend()`）；`read_model_configuration` 生产调用点仅此一处——**候选的 `readModels()`/`readCredentialStatus()` 在提交树内无生产调用方**（shim case 存在但无 store 走它）。
- 因此：作者「真实产品 UI（headless Chrome）4/4」必然同时带 `__TAURI_INTERNALS__` 桩＋invoke→asBackend 换接（否则既过不了门、store 也到不了 web 客户端），其记录未披露这两处 overlay——**作者 UI 证据按原范围保留，覆盖面须补披露**；现树中面板可达语境只有 native（词汇为 stored/environment，候选新增 §7 分支属前瞻接线面），而 F3-native 的 placeholder 误述恰恰命中今天可达的 native 用户。

## 5. 窄修方向（退作者；不改契约、不扩权）

1. F1：两次读齐后按 §4.1 的身份规则比对（`wireRef === (auth.apiKeyRef ?? auth.apiKeyEnv)`），不一致即丢该条（未知）或重读；补受控并发变更回归。
2. F2：`missing` 文案改中性（如「凭据引用暂无可解析值」），不声称「尚未保存」；detail 转发属服务端面（config-store :399 硬编码 null）另归属，不在本候选强行补。
3. F3：文案按管道分述或回退中性（web 不承诺写入；native 恢复「保存到钥匙串」语义），不得两态共用一句失实承诺。
4. F4：作者记录补披露 UI 证据 overlay；web 模式可见性与 store 换接属后续独立派工，不在本候选顺手扩权。

## 6. 边界（如实）

未跑 A/B/C 全旅程与完整 gate；未跑真实 Pi／真实钥匙串／环境秘密；native 渲染与 `stored/environment` 行为未实跑（明列）；DOM 独立复核止于浏览器门禁事实，未做桩下面板渲染复核（作者 UI 证据保留）；不改生产／测试／契约／状态；`npm run check:docs` 见提交；MAYNE-24 保持 `in_progress`。本审证据 `build/web-text-intake-credential-review/r1/`（gitignored：探针脚本、probe-result.json、截图、哈希清单）。
