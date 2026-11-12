# 凭据候选 `125280d` F2/F3 限定独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bfc5`（Codex）。对象：`125280d98bb5a3c585bdc245c275467a954e7194`（tree `d2028221c7839de6e87f0b99ddf01e1b6f31a040`，父 `4846e61`），源码两文件 +74/−9（`web-api-client.ts` `70ea8976`→`c28227a5` +43/−3；`ModelSettingsPanel.vue` `71f9639a`→`0216921` +31/−6）＋记录/索引；本审未参与编写。**F1 本次不签**（按派工，修正提交后再点检）。

## 结论

**F2：通过。F3 功能面：通过（真实浏览器＋模块级双证）；F3 注释面一处失实已登记（协调层已派窄修，不另立缺陷）。** F1 不签；native 实际运行未验（如实登记）。

## 静态核（候选两文件全文读回）

- **F2**：`missing` → `'凭据引用未解析到值'`（中性，不断言「尚未保存」）；`available/stored/environment/unavailable` 词汇不动；注释如实记录中性化理由。渲染出的任何 label 都不含「凭据引用尚未保存」（模块④断言）。
- **F3 client**：`save_model_configuration` shim 在 `writeModels`（即发写请求）**之前**逐项检查 `input.apiKeys`，非空抛本地 `WebApiError('PLAIN_CREDENTIAL', 400)`（消息说明浏览器无钥匙串并给出可行路径）；空值/缺省放行。该码是本地 shim 抛出，不上 HTTP 线——冻结公开码未改。
- **F3 panel**：`keychainPipe=nativeBridgeAvailable()`；`keyHelp`/`keyPlaceholder` 按管道分化并绑定（`:help`/`:placeholder`）；native+available 保留「凭据引用可解析；留空保留原引用。」不变。
- **登记（注释失实，协调 `01a1bfc5` 已派校正）**：client 注释「The native host rejects the same input with `PLAIN_CREDENTIAL`」不实——native 管道 `input.apiKeys` 写钥匙串（`model_config.rs`），并不拒绝同一输入；「本地命令兼容码 vs 服务端公开 plain_credential」的区分同样待窄修表述。功能行为不受影响。

## 动态证据（三面分别给结论）

**一、真实浏览器（本审新补，协调指定项）——9/9 PASS**。运行树＝`cbb04f7` detached（完整 I 接线：`SettingsPanel` `fa75f477` 无 native 门控、`models` store `2be89983` `asBackend`、`agents` `da044b6e`；server 字节与登记最新 I `8860314` 零差异自验）＋**恰候选两文件 overlay**；构建 `vite build` exit 0；后端＝真实 entry（in-process fixture，`pair:false`）＋存储二进制 `5311ffa3…`（新登记身份）；**真实 Chrome（puppeteer-core＋系统 Chrome）加载真实页面，全程无 Tauri 桩**：真实配对门输入一次性码配对进入 → 工作台 → 设置 → 模型服务 tab → 添加服务 → 填名称/地址/**合成 API Key 草稿** → 点保存：①保存被**拒绝**，保存栏呈现 `PLAIN_CREDENTIAL` 错误消息（danger 态 role=status，拒载弹错）；②**草稿保留**（密码输入框值＝输入值）；③无成功提示；④服务端零写入（保存前后 `/api/models` 读回逐字节稳定）；⑤web 文案三面在真实 DOM：`浏览器模式没有钥匙串…`（keyHelp）、`请改用环境变量引用`（placeholder）、无「尚未保存」断言。截图随附件。

**二、模块级——4/4 PASS**。真实 `web-api-client.ts`（候选字节，`--experimental-strip-types` 装载）× 死端口基址：非空 `apiKeys` → `PLAIN_CREDENTIAL` 先于任何请求抛出（死端口下若发请求应为连接错误而非该码——**先拒后发直接证**）；空值/缺省放行到线路（拒绝按值门控）。

**三、native 文案渲染——3/3 PASS（仅模块类证据）**。同真实页面＋最小 `__TAURI_INTERNALS__` 标记使 `keychainPipe=true`（**不执行任何 native 命令、不触真实钥匙串**）：未解析态 help＝「密钥将写入系统钥匙串，不回读已有密钥明文。」、placeholder＝「填写密钥」、web 拒绝文案不泄漏。**native 实际运行（真实钥匙串写入/读取/真实 Tauri 渲染）未验，如实保留**——作者 SSR 矩阵与本审模块类渲染互证，均不代签 native 行为。

## 边界

不跑完整 gate／19 旅程；未触真实钥匙串／真实凭据／用户根（API Key 值为合成探针串）；运行后 tmp root 残留 0；候选字节未改。原始证据（浏览器 9/9 日志＋拒绝态截图、模块 4/4、native 文案 3/3、身份清单、SHA256SUMS）随评论挂载。MAYNE-24 保持 `in_progress`。
