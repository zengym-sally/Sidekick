# F1 修正 `090872a` 补审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bfd2`（Codex）：F2/F3 已核面不重开，只补审 F1 修正 `090872a` 的 key/env 正常匹配、跨读换引用、同名跨认证方式切换与未知降级；锁完整 I＋所选前端字节，不以 OhMyPi 分支自身称完整 I。本审未写前端。

## 结论

**F1 修正：通过。** 四个派工面全部成立，pre-fix 反控复现已登记偏差，real-wire 对齐坐实夹具与生产线型同形。F3 注释校正一并核过。

## 身份与范围

`090872a2ef9b1aeaf91be3e02cff6283b8c75d0c`（tree `40e3f8a5f2639e2168c319d1f64428fd465e8371`，父 `5255c1c`，链 `125280d`→`5255c1c`→`090872a`）；对 `5255c1c` 恰 `src/lib/web-api-client.ts` +33/−9 = F1 身份面＋F3 注释校正（`5255c1c` 自身的计数/BOUNDARY 面属 OpenCode 派工范围，本审不重复）。运行树＝`cbb04f7` detached（完整 I 接线与 server 字节）＋恰该文件 overlay（blob `127c9da`）。

## 权威线型对齐（锁定 I `0536a44` 实读）

- `listProviders`（config-store :395-405）：`authMode: provider.auth?.apiKeyRef ? 'api_key' : 'env'`、`credentialRefs[0].ref: apiKeyRef ?? apiKeyEnv ?? ''`——**裸引用、无前缀**。
- `credentialStatusFor`（:266-270）：`ref = auth.apiKeyRef ?? (auth.apiKeyEnv ? 'env:'+apiKeyEnv : null)`——`env:` 前缀确为私有派生，不上线。
- 客户端新身份构造 `(providerId, authMode, rawReference)`：`ref = auth.apiKeyRef ?? auth.apiKeyEnv ?? null`（裸）、`authMode = auth.apiKeyRef ? 'api_key' : 'env'`，与能力行 `provider.authMode` 比对——与服务端构造逐项一致。

## 动态证据

**一、真实适配器字节 × 明确标注私有响应夹具（真请求 URL）——6/6 PASS**：

1. key 正常匹配 → `available` 按身份归因；2. **env 正常匹配**（线上裸 env 名，两侧无前缀）→ 归因；3. **跨读换引用**（providers 行显示新引用）→ 条目丢弃，绝不把新引用的 available 安到快照引用上；4. **同名跨认证方式切换**（引用串相同、模式 key→env）→ 丢弃——authMode 进入身份非装饰；5. **未知降级**：被丢条目零状态输出（`available` 从不伪造），控件落自身 unknown 文案；6. **PRE 反控（125280d 字节）**：env 正常匹配缺失（旧代码比对私有 `env:` 派生）——已登记偏差如实复现。

**二、真实后端 real-wire 对齐——4/4 PASS**：真实 entry＋存储二进制 `5311ffa3…`＋真实 `config/providers.json`（key＋env 两 provider，合成值）：真实能力行 env provider `ref='SIDEKICK_F1_REAL'`（裸）＋`authMode='env'`、key provider `ref='keychain://synthetic-f1-real'`＋`authMode='api_key'`；真实适配器 `readModels()` 两 provider 状态**均被归因**且与能力行逐字一致（pre-fix 字节会丢掉全部 env provider）。夹具形状与生产线型同形，无漂移。

**三、F3 注释校正核过**：新注释如实写明该拒载是 **web 管道自己的决定**、native **接受** `apiKeys` 并写钥匙串（`model_config.rs`）、`PLAIN_CREDENTIAL` 为本地命令兼容码而服务端公开契约码是小写 `plain_credential`（`writeModelConfiguration`）、冻结 HTTP 码未改——我上轮登记的失实注释已按派工校正。

## 边界

F2/F3 功能面不重开（090872a 未触碰其行为行，仅注释面）。不跑 19 旅程／完整 gate；合成引用/环境名，未触真实凭据；运行后 tmp root 残留 0。原始证据（夹具 6/6＋real-wire 4/4 日志、身份清单、SHA256SUMS）随评论挂载。另：同帖 @Mayne 的 **MAYNE-24 E（B(a) 登记域退出保证）批准申请非本审范围**，本审不代 owner 表态。MAYNE-24 保持 `in_progress`。
