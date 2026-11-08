# W1 I 启动/会话增量与前端面独立审查（ZCode）

- 日期：2026-11-08。审查者：ZCode（未参与启动/会话实现）。
- 对象：`05f0bc04f2d4d1188931b5eb1dca540650d196d7..cf8b417d2c0806165245a501f425702348fbb945`，即 db26d64「最小启动契约增量」（父链 05f0bc04→8d4a20d→db26d64）＋ cf8b417「capabilities 归位」；前端面与 helper 归位为主，后端权限/CAS 由 OpenCode 并行独审、本轮不代签。
- **结论：不通过（1 MAJOR）**——受影响设置领域组 `test:layout-domain` 在候选上 9/14 exit 1（5 处 `TypeError: api.readApplicationSettings is not a function`），A/B 基点 `05f0bc04` 同组 14/14 exit 0，回归由本增量引入。除此之外全部核验面通过（详见 §2–§6）。
- 候选只读：/tmp `git archive` 导出（5 关键文件 blob 与提交逐一相等；导出树 `vendor/pi` 子树哈希 `e89822b0…` 与候选一致），临时树已删除，`pgrep` 复核零残留进程。本隔离树仅写入本记录与 gitignored `build/web-manual-items-startup-frontend-review/`。环境：macOS arm64、Node v24.20.0、cargo 1.89。

## 1. 版本与哈希（全部实测一致）

- `db26d64` tree `ab83630c40c4616bdec5f53807ea4afb58481851`、`cf8b417` tree `3d0e4ab22988cc81e49ce88c8e653064b3c2185b`、父链逐级相符；增量补丁 `05f0bc04..db26d64` SHA-256 `0d0b12b6…815dc`、归位补丁 `db26d64..cf8b417` `81dc24b9…3efdf`、累计 `bc4b1c3..cf8b417` `41deee5a…7a8c3e` 均复算一致。
- 范围恰 17 文件 +461/−44；`db26d64..cf8b417` name-only diff 恰 5 文件（记录＋`SettingsPanel/TodayAdvice/Workbench` 导入＋rename）→ **后端与 db26d64 字节一致**。
- 冻结实测不变：`001_web_backend.sql`＝`8511907c…143d`、`002_manual_items.sql`＝`b6cb8e61…f97e`、web-api 契约＝`61863271…f58d`；`src/domain/`、`shared/` 全范围零改动（归位把未获批 domain 文件移出，`src/lib/host-capabilities.ts` 内容 SHA-256 `ba482b81…7338` 与原 `src/domain/capabilities.ts` 逐一相同＝纯 rename）。

## 2. MAJOR-1：设置注入接口变更破坏既有 layout-domain 组（阻断）

`settings.ts` 将 `createApplicationSettings` 注入参数从命令式 `Backend`（`api('read_application_settings')`）改为客户端对象 `SettingsClient`（`api.readApplicationSettings()/writeApplicationSettings(tz,version)`），但 `tests/unit/layout-domain.test.mjs:11,29,33,34,37` 五处既有用例仍注入命令式函数后端，本增量未适配该文件。

实测（npm ci exit 0 后）：候选 `npm run test:layout-domain` **exit 1**（tests 14／pass 9／fail 5，全部 `TypeError: api.readApplicationSettings is not a function`，栈指向 `src/stores/settings.ts:14`）；同命令对基点 `05f0bc04` **exit 0（14/14）**——引入面即本增量。`typecheck` 不覆盖 `.mjs` 测试故未拦截；作者聚焦证据只跑 `web-manual-items.test.mjs`（该文件自注入，未覆盖此接缝）。按本项验收「受影响设置领域组均保留」，此为阻断回归。修复方向：沿原 I 范围适配五处注入为客户端对象（或等价 seam），不得弱化既有断言（这些用例的 CAS/未知结果/重读语义本身仍是正确口径，应保留其验证力）。

## 3. BLOCKER-2 共享客户端/CSRF —— 通过（线级实证）

- `web-api-client.ts` 新增 `getWebApiClient()` 模块级单例；生产装配三处默认全部命中同一实例：`pairing.ts` `createPairing(client=getWebApiClient())`（`usePairing` 无参调用）、`todos.ts` `createTodoModel(getWebApiClient().asBackend())`、`settings.ts` 默认参；无生产调用方传入独立实例。
- 真实 UI 实测：`POST /api/manual-items` 与 `PUT /api/settings/application` 请求头携带**同一** `x-csrf-token: 0npJ…uw`（配对时取得）；负对照同页伪造 token → **403 `csrf_invalid`**，服务端强制校验在线。
- 新单测「the shared web api client is a singleton and carries CSRF into settings writes」断言单例恒等＋CSRF 头传递。

## 4. BLOCKER-1 设置 HTTP/读取快照版本 CAS —— 通过（线级＋库级实证）

- `load()` 读取快照并存 `savedVersion`；`save()` 以该快照版本作 `expectedVersion` 提交。真实 UI：配对后 boot 发 `GET /api/settings/application` → 200 `{"settings":{"timeZone":"Asia/Shanghai"},"version":0}`（实例 OS 默认）；此刻只读库 `settings` **0 行**（默认读不落库）。改时区为美东保存 → `PUT` 体 `{"timeZone":"America/New_York","expectedVersion":0}` → 200；只读库 `application.timeZone|America/New_York|version=1`（首写建 v1）。
- 错误分支由 `!['WORKSPACE_IO','INVALID_TIMEZONE'].includes(code)` 改为 `code!=='validation_failed'` 才置 `ready=false`：对 409 `version_conflict`/网络类失败一律强制重读后再存，语义等价或更保守，非弱化。
- 重启持久：SIGTERM 收尾（close 等待存储子进程与锁释放，进程归零）→ 同根 `initialize:false` 重启 → 新一次性码经产品表单再配对 → 设置读回 `version:1`＋美东、清单恢复原 1 项。

## 5. logout/401 清理 —— 部分（观察登记，非阻断）

`WebApiClient.logout()`（DELETE `/api/session` 后清 `csrfToken`）为**本增量前既有**字节（`05f0bc04` 同在），生产 UI 仍无调用方＝既有缺口，非本增量回归。fresh-load 会话失效路径实测成立：无会话 `GET /api/session` → 401 → 配对门。会话内过期无自动回门（错误态停留、刷新后回门恢复）；契约 401→「重新配对」行的会话内自动转换仍未实现——本增量登记范围未含，登记观察待后续切片。

## 6. 能力守卫（自动/延迟加载与监听轮询）—— 主体通过（1 MINOR 非阻断）

实测全部生效：`nativeBridgeAvailable()`（判 `window.__TAURI_INTERNALS__` 非空对象）；`boot()/initialize()` 的 `loadNative()`（models/agents/advisor/todayAdvice/skills/profile/organizer）门控；1s `poller` 与 60s `clock`（`now` 时钟除外）门控；「待确认」导航 `disabled`；录入对话框「文本智能整理」tab `disabled`；设置面板版本读取早退＋模型/智能体/工具面板 `v-if`＋准确「未接通」文案；TodayAdvice 生成/重新核对按钮禁用＋准确文案。真实浏览器中上述全部呈现为禁用/未接通，无伪成功。`observeWorkspaceChanges` 对 `listen()` 失败 `catch{}`（既有）→ 浏览器安全；SSE 变更提示经 pairing 订阅独立成立。

**MINOR-2（非阻断）**：`watch(page→'today')` 与 `readWindowFacts()`（focus/visibilitychange/pageshow）两条自动加载路径**未**门控 `todayAdvice.load()`（Tauri invoke）——实测页面切回今日后今日建议区出现原始错误行「Cannot read properties of undefined (reading 'invoke')」（被 `catch` 吞掉、无崩溃、无伪成功，但违背登记口径「仅在有原生桥时加载」并向浏览器用户暴露原始错误）。同口径观察：`desktopPreferences.start()`（App.vue 主面）未门控 `invoke('read_desktop_status')`（错误态降级）；`DesktopSettingsPanel` 未按 models/agents/tools 同款 gated（登记口径未含）。fixture `getWebApiClient()` 每次返回新实例（非单例）——与生产语义不同，仅接缝注记（单例契约由真实单测覆盖）。

## 7. 断言强度与聚焦复跑（exit 实录）

- `npm run typecheck` **exit 0**；`npm run test:desktop-controls` **exit 0（9/9）**——测试文件本体相对基点零改动；仅 fixture `api.ts` +12 行接线（`__TAURI_INTERNALS__` 垫片使能力检测视见桌面、`read/writeApplicationSettings`、`getWebApiClient`），属派审允许的「必要 fixture 接线适配」，无断言删改。
- `node --test tests/unit/web-manual-items.test.mjs` **exit 0（25/25）**：20→25 纯新增（MINOR-1 回转拒绝×1、设置服务默认/CAS/校验×3、共享客户端单例/CSRF×1），既有 20 用例零删除零改写。
- `npm run test:layout-domain` **exit 1（9/14）**——见 MAJOR-1。
- 产物（候选导出树构建）：`vite build` exit 0，`dist/assets/index-DOFrumhi.js` 730.84 kB SHA-256 `0f13bc39…ab7e`、`index-hW-4LRhn.css` `e32614bd…1583`、`index.html` `20d4ba60…77cc`；`cargo build --release --bin web-backend-storage` exit 0（2 633 152 B，SHA-256 `314f6723…d994`；`probe:prepare-pi` exit 0、`probe:bundle` 在 lark-cli 复制步 exit 1——`probe:prepare-cli` 未跑所致，资源目录已满足 build.rs，存储二进制真实构建成功）。

## 8. 真实产品 UI 旅程（无 Tauri 诊断注入）

真实 dist＋真实 web-backend-storage 二进制＋显式合成根 `/tmp/.../synth-root`（起始 schema_version=2、items/events/settings 全 0）＋ `startWebBackend({initialize:true, onPairingCode})`（一次性码仅经私有回调内存取得、只进 `/api/pair` 请求体）；Playwright 驱动真实 Chrome 走产品控件，全程无 `__TAURI_INTERNALS__` 垫片。步序与证据（截图 01–06、原始日志、sqlite 只读印证均在 `build/web-manual-items-startup-frontend-review/`）：配对门（401→gate）→ 配对进入工作台（无启动错误，BLOCKER-1 关闭）→ 快速录入保存「ZCode独审-启动契约验证」→ 对话框关闭、清单 1 项、toast 确认（BLOCKER-2 关闭）→ 请求头/只读库双向印证（items=1、events=1 create、settings=0）→ 设置改美东保存（PUT CSRF＋`expectedVersion:0`，库 v1）→ 负对照伪造 CSRF 403 → SIGTERM 重启再配对 → 清单与设置 v1 完整恢复。

## 9. 未验项与处置

未验：完整 `npm run check`／最终集成门禁（唯一集成者在新冻结版串行执行）；OpenCode 并行的 server/Rust 权限/CAS 独审结论；切片 II 面；真实 Tauri 壳内原生路径回归；SSE 断线重连全语义与会话内 401 自动恢复；代理模式与 Linux。处置：**不通过**——待 I 作者沿原范围关闭 MAJOR-1（适配 layout-domain 注入接缝，不弱化断言）并另派独审；MINOR-2 与 §5 观察登记不阻断；MAYNE-23 保持 `in_progress`。
