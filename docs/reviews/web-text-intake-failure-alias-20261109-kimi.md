# MAYNE-24 后继批次：模型传输类失败码别名收口（Kimi，2026-11-09）

> 状态：候选交付，待独立评审（另派未写本批 `server/` 两文件的成员；作者不自签）。MAYNE-24 保持 `in_progress`。
> 派工：协调评论 `01a1bf3e-14c9-7076-9509-c921246ac770`（2026-11-09）——按 `01a1bef1` 已定映射补独立最小提交。
> 分支 `agent/kimi/mayne-24`，基点 `0536a44a39e8c228a95c9f548c73c3d72ffc174d`（tree `0536a44a…`），一个生产提交未 push、未改状态。
> 生产面恰 2 个 `server/lib/` 文件；Rust／DDL／003 冻结哈希／守卫／package／前端／II 测试／Runtime 零差异。

## 背景（登记的传递面缺口）

增量①（`58a4cdc`）已把宿主真实 error 帧码传入无暂存 extract/revise 收口，Pi 的 `75d49cb` 也证明了真实 401／429 帧会到达该路径；但 `FAILURE_CODE_ALIASES` 缺 `MODEL_AUTH`／`MODEL_RATE_LIMIT`／`MODEL_NETWORK`／`MODEL_SERVICE` 四个运行时码且无其他映射分支——真实 401／429 仍落 `worker_lost`（Hermes `01a1bf56` 独审明确不代签逐码闭合，归本最小提交）。

## 修复：`FAILURE_CODE_ALIASES` 补四个模型传输类别名（task-service.mjs，+9/−2）

按 `01a1bef1` 已定映射，逐字收口运行时 `category()` 实际产出的四个码（organizer-entry.mjs:54-58）：

| 运行时帧码 | 触发 | 注册码 | retryable |
|---|---|---|---|
| `MODEL_AUTH` | 401／403／鉴权失败 | `auth_or_config_invalid` | `manual`（配置类，用户改配置后手动重试） |
| `MODEL_RATE_LIMIT` | 429／限流 | `model_request_failed` | `auto_backoff` |
| `MODEL_NETWORK` | 连接／fetch／TLS 失败 | `model_request_failed` | `auto_backoff` |
| `MODEL_SERVICE` | 其它模型服务错误 | `model_request_failed` | `auto_backoff` |

- 既定 `MODEL_TIMEOUT`／`MODEL_INVALID_OUTPUT` 等映射逐字未动；未知码仍落 `worker_lost`／`manual`（不伪装成功、不发明分类）——`DEFAULT_PUBLIC_FAILURE_CODE` 与注册表单字不变。
- §4.6 安全路由不变：别名只决定 `code`／`retryable`，任何码都不构成安全证明，未知副作用一律转 `needs_review`。

## 随附硬化：宿主载荷过界前剥除安全声明（task-scheduler.mjs，+8/−1）

采纳 Hermes `01a1bf56` 登记的非阻断建议（`normalizeFailure` 透传 `payload.sideEffectSafety`，服务级实测可达；宿主白名单使真实帧不可达且行为先于本批存在；增量①把宿主载荷路由进该函数）。scheduler 构造 `failurePayload` 时显式只取 `{code, message}`：

- 生产行为逐字节不变：worker-host 早已把 error 帧收敛为 `{code, message}`（worker-host.mjs:417）；后端自建载荷（`runtime_start`、deadline 的 `model_timeout`）携带的 `sideEffectSafety` 本就是默认 `unknown`；`retryable` 恒由注册表派生。
- scheduler 后端自建的 `proven_safe` 声明（无默认模型／凭据不可用两条 launch 路径经 `stageResult`）不受影响——剥除只发生在增量①新增的宿主载荷过界面。
- 效果：即使未来宿主白名单放宽或新增载荷路由，载荷携带的安全声明也不可能随信封落库。

## 验证（真实链，同环境，全部可证伪）

**真实链探针（`scripts/probes/failure-alias-probe.mjs`，一次性、不入库；生产 entry＋真实 Rust 存储＋真实随包 Pi＋loopback 受控模型服务＋只读 SQLite；生产合法配置形状，不重做 II 配置修订）**：

两层证据：**帧层**直接驱动真实 organizer 过 stdio 协议，观测每个注入故障的真实 error 帧码；**业务层**走生产路径（config→scheduler→worker-host→真实 Pi→受控服务），从真实 SQLite 读回落库信封（§4.6 安全路由把未证明失败隔离进 `needs_review`，wire 不发布未暂存失败信封，故库内读回是权威观测点）。

| 故障 | 真实帧码（两树一致） | 修复树落库信封 | 基点落库信封 |
|---|---|---|---|
| 真实 401 | `MODEL_AUTH` | `auth_or_config_invalid`/`manual` | `worker_lost`/`manual` |
| 真实 429 | `MODEL_RATE_LIMIT` | `model_request_failed`/`auto_backoff` | `worker_lost`/`manual` |
| 真实 500 | `MODEL_SERVICE` | `model_request_failed`/`auto_backoff` | `worker_lost`/`manual` |
| 死端口（拒连） | `MODEL_NETWORK` | `model_request_failed`/`auto_backoff` | `worker_lost`/`manual` |

- **修复树 59/59**：四故障帧码＋业务层落库信封（code／retryable／无 `internalCode`／安全面恒 `unknown`）＋`needs_review` 与 `failure_unknown_side_effect` 恢复原因＋受控服务实测请求（Authorization 存在且值不入记录、合成密钥零命中）＋注册表单测（四码映射、`MODEL_TIMEOUT`／`MODEL_INVALID_OUTPUT` 既定映射未动）＋负控（未见码→`worker_lost`/`manual`，不伪装成功）＋硬化面（code+message 构造的信封不声明安全）。
- **可证伪性**：同一探针以 `PROBE_MODE=gap` 对基点 `0536a44`（隔离 detached 树、用后即删）**57/57**——真实 401／429 落 `worker_lost`，正是协调登记的缺口；两树帧码逐项相同，差异只在后端映射。
- 传递面不代签逐码闭合：探针同时正面陈述基点上四个真实码均无别名（`worker_lost`），与修复树映射形成对照。

**聚焦单测（本树字节，当前构建二进制）**：I 单测四套 **45/45**；恢复回归按派工原样覆盖 ZCode 更正字节 `82e1bf2`（SHA `3ab536c9…`、跑后还原登记字节）**11/11**（W(deadline) 与 W(worker loss) 双面保持绿，本批未动两条既有收口路径）；`test:web-manual-items` **59/59**。本树内 recovery 登记字节的 F1／W 两红为既存旧字节条件（更正字节 11/11 已证），与本批无关（stash 对照复现相同失败集）。

**其他门禁**：`node --check` 两文件 exit 0；`check:structure` 自测通过且 `server/` 零违规（170 条 `[top.dir]` 全是会话前既存平台注入 `.kimi/`）；未跑完整 `npm run check`（III 唯一集成轮）；未 push、未改状态；真实模型／凭据／用户根未涉及（受控合成）。

## 登记：存储二进制哈希未复现（如实披露）

本会话首次冷构建产出登记二进制 `42af54b5…490fc2`（2649408 B，与既往登记逐字节相同）；其后 6 次构建（含 `cargo clean` 全净重建、另一目录冷建）均确定性产出 `5311ffa3…232bd`（2647984 B）。Rust 源零改动（`git status src-tauri/` 清洁，HEAD 血缘经评审链 Rust 零差异）。本批功能证据分布：单测在 `42af54b5` 与 `5311ffa3` 两个二进制上分别全绿（本树字节相同），探针 59/57 在 `5311ffa3` 上通过。**不断言本批探针证据与登记二进制逐字节同哈希**；差异为构建环境现象，已按未验证项登记，供集成轮复核。organizer.mjs（`08f32db2…`）与 node 随包件两树一致。

## 边界与后继

- 未跑完整 `npm run check`（III 唯一集成轮）；未跑未改 Rust 全套／typecheck（前端零改动）；未 push。
- II 四套件总准出仍归 Pi；`82e1bf2` 测试总准出仍归 ZCode；II 套件自带配置夹具缺陷（缺 `name`／`credentialRefs` 形状）按派工不重做修订。
- 候选／预览内部日期点线上转换仍未闭（OhMyPi 适配轨），不由本批代签；通用退出保证边界不变。
- 生产独审请派未写本批 2 个 `server/` 文件的成员，作者不自签。原始证据（两树探针 summary、TAP、身份与 SHA256SUMS，脱敏复核）随交付评论附件一次交付，`build/` 会回收。
