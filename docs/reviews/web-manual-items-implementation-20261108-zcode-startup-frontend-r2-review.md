# W1 I 前端段 R2 限定复审（ZCode）

- 日期：2026-11-08。审查者：ZCode（未参与 A/B 两段修订，R1 独审记录见 `web-manual-items-implementation-20261108-zcode-startup-frontend-review.md`）。
- 对象：前端段 `62033e3dbcae3f06c7e3c66bff773af0d51b5927..7fce1448788907457df412f0842fac8fefe15eb5`，最终绑定 `325f5b4352c9f4c900eacccab827380b7bf6c120`；A 段（Rust settings 收紧 `cf8b417..62033e3`）归 OpenCode 限定独审，本轮不代签。
- **结论：通过。** R1 MAJOR-1（layout-domain 组回归）已按派审口径关闭：注入边界恢复为命令式 `Backend`、原十四用例文件逐字节保留且 14/14 exit 0；typecheck/desktop-controls 通过；会话内 401→配对门、SSE 关闭、重新配对保存三项原样实测成立；自动原生加载守卫实测不停止 HTTP 业务读回。无阻断发现；两条非阻断观察见 §6。
- 候选只读：共享对象库可达四提交（`git cat-file`），只读 `git archive` 导出于 /tmp/zcode-r2-frontend-review 复跑聚焦测试与真实旅程；未写作者树；本隔离树仅写入本记录与 gitignored `build/web-manual-items-startup-frontend-r2-review/`。环境：macOS arm64、Node v24.20.0、cargo 1.89。

## 1. 版本与哈希（全部实测一致）

- 提交链 `cf8b417`→`62033e3`（A，恰 2 Rust 文件）→`7fce144`（B，恰 6 前端/测试文件）→`b58b2839`→`325f5b4`（两笔均仅 `docs/reviews/web-manual-items-implementation-20261108.md`）。tree：`62033e3`=`18929f0f…`、`7fce144`=`ad685a98…`、`325f5b4`=`f25c58c1…`（与作者申报一致）。
- 补丁 SHA-256 复算全部相等：A `cf8b417..62033e3`=`7564ecca…7aa8`、B `62033e3..7fce144`=`612cc135…44d25`、累计 `cf8b417..325f5b4`=`6242e2ab…caba`、对基点 `bc4b1c3..325f5b4`=`d9594887…1af8`。
- **绑定口径成立**：`7fce144..325f5b4` name-status 恰 1 文件（上述记录文档）＝仅记录变动；`62033e3..325f5b4` 零 Rust/server/shared/domain 改动＝B/记录未触碰 A 已审字节（与 OpenCode 线互证）。
- 冻结不变（内容 SHA-256 与 R1 记录逐一相等）：`001_web_backend.sql`=`8511907c…143d`、`002_manual_items.sql`=`b6cb8e61…f97e`、web-api 契约=`61863271…f58d`。`tests/unit/layout-domain.test.mjs` 对 R1 基点 `05f0bc04` **diff 为空**（十四用例/注入断言逐字节保留）；`tests/unit/web-manual-items.test.mjs` 对 `05f0bc04` **+128/−0**（纯新增，无删改）。

## 2. MAJOR-1 关闭：注入边界恢复（线级＋实测）

- `settings.ts` 恢复 `createApplicationSettings(api: Backend = getWebApiClient().asBackend())` 命令式注入（`api('read_application_settings')`／`api('save_application_settings',{input:…})`），保存形参恢复原 `{timeZone, expectedTimeZone}` 形状；读快照版本仍存 `savedVersion` 并作 `expectedVersion` 提交 CAS。`asBackend()` 新增两命令映射到共享客户端 HTTP 方法；生产默认仍走单例（`getWebApiClient()`），layout-domain 注入 fake 与生产互不干扰。
- 实测：`npm run test:layout-domain` **exit 0（14/14，无 fail）**——R1 在候选上为 9/14 exit 1、基点 14/14，本轮回归消除且断言未被弱化（文件逐字节未动）。错误分支由 R1 候选的 `code!=='validation_failed'` 改为 `!['WORKSPACE_IO','validation_failed'].includes(code)`：对基点原列表 `['WORKSPACE_IO','INVALID_TIMEZONE']` 是把 Tauri 时代码名映射为 web 契约码名（400 `validation_failed`），`SETTINGS_CONFLICT`/`SETTINGS_UNCERTAIN`/网络类仍强制 `ready=false` 重读——与原语义等价、偏保守，十四用例（含 SETTINGS_CONFLICT→ready=false、未知错误→ready=false）全部照旧通过。

## 3. 会话内 401 → 配对门／SSE 关闭／重新配对保存 —— 原样实测成立

真实产品 dist（`index-CAsbIzss.js` SHA-256 `2706d627…`）＋绑定提交真实构建存储二进制（2,632,496 B，SHA-256 `a8fcb553…`）＋显式合成根＋真实 `web-backend-entry.mjs`（一次性码仅经 `onPairingCode` 内存回调、只进 /api/pair 请求体），无诊断注入。原始证据：`build/web-manual-items-startup-frontend-r2-review/journey-log.md`＋两张脱敏截图＋playwright 快照/控制台日志。

- **会话内 401→门（无刷新）**：配对进工作台、保存 1 项后，SIGTERM 服务进程并同根重启（内存 SessionStore 全新）。页面不刷新直接提交快速录入 → **POST /api/manual-items → 401**（携旧会话 csrf）→ `handleSessionLost` 立即回配对门；页面注入的 `window.__r2marker` 原值未变＝同一 JS 上下文、零刷新；门输入框仍留旧码＝DOM 状态保留。fresh-load 探针（GET /api/session、/api/pair）按实现排除在 session-lost 外，门上静置无循环。
- **SSE 关闭**：门出现后静置 9s（EventSource 默认重连秒级），网络日志零次新增 /api/events 尝试——旧流经 `dispose()`→`source.close()` 真实关闭（旧流重启窗口期一次自动重连 401 后不再重试）；页面注入的 EventSource 钩子在重新配对时记录 construct＋open＝订阅重建可见。单元测试 'pairing store returns to the gate when the session is lost' 与 'an in-session 401 clears the shared CSRF token' 同判据。
- **重新配对保存**：新一次性码经门表单再配对 → 清单 HTTP 读回首项；再存「重新配对后的新事项」→ POST 200 携**新** csrf（与旧值不同＝共享 token 确经 401 清空换新）；SQLite 只读核验 items=2、events=2。设置面板保存纽约时区 →「通用设置已保存」、库 `application.timeZone=America/New_York @ v1`（恢复后的 asBackend 命令缝全链路走通）。

## 4. 自动原生加载守卫不停止 HTTP 业务读回 —— 实测成立

`watch(page→'today')` 与 `readWindowFacts()` 现以 `nativeAvailable` 门控 `todayAdvice.load()`，**`store.refresh()` 保持无条件**；`App.vue` 的 `desktopPreferences.start()` 以 `nativeBridgeAvailable()` 门控。浏览器多轮切页（today→settings→today→all→today）：全程无「Cannot read properties of undefined」（R1 MINOR-2 原始错误行不再出现），console 全程恰 4 条且全部为预期失败请求（fresh-load session 401、favicon 404、events 401、会话内 POST 401）；HTTP 业务数据照常呈现（班班简报 待我处理 2、全部事项 2、「还有 2 项未定期」）；今日建议区保持 disabled＋「未接通：浏览器模式不生成今日建议，手工事项不受影响」准确文案；应用时区即时生效（NY 显示 11月7日）。守卫只挡原生 invoke，不挡 HTTP 读回，符合派审口径。

## 5. 聚焦命令（候选导出树，实跑实录）

| 命令 | 结果 |
|---|---|
| `npm ci --ignore-scripts` | exit 0（107 packages） |
| `npm run typecheck` | exit 0 |
| `npm run test:layout-domain` | exit 0，14/14（R1 候选为 9/14 exit 1） |
| `npm run test:desktop-controls` | exit 0，9/9 |
| `node --test tests/unit/web-manual-items.test.mjs` | exit 0，27/27（25＋2 会话失效新增） |
| `npx vite build` | exit 0（chunk>500kB 警告，R1 已见，非本段引入） |
| `cargo build --release --bin web-backend-storage` | exit 0（build/s0-runtime 前置按评审先例从真实主检出只读复制） |

## 6. 发现项（均非阻断）

- **OBS-R2-1**：`WebApiClient.logout()` 现经 `handleSessionLost()` 统一清理（DELETE 失败也清本地态），但生产 UI 仍无调用方——派审明确「不新增登出UI」，属按口径保留的既有缺口，非回归；其行为与 401 路径同一实现（单测覆盖）。
- **OBS-R2-2**：`asBackend()` 的 `save_application_settings` 映射只取 `input.timeZone/expectedVersion`，`expectedTimeZone` 仅在领域缝传递（layout-domain fake 可见、wire 契约无此字段）——缝保真与 web 契约各安其位，无行为分歧；若未来原生命令回归需记得该字段仅存于命令形。

## 7. 未验项

完整 `npm run check`／最终集成门禁（唯一集成者在新冻结版串行执行）；A 段 Rust 收紧的行为结论（OpenCode 线，本审仅确认 B/记录未改其字节并在绑定提交上成功构建）；切片 II 面；CLI/代理/Linux/真实 Tauri 壳内原生路径；SSE epoch/reset 全语义（沿 54badb5 已过结论）；真实凭据/模型。

## 8. 收尾

合成根、导出树、驱动脚本、脱敏截图、playwright 快照/控制台日志留存于本隔离树 gitignored `build/web-manual-items-startup-frontend-r2-review/`（不含配对码/cookie/token 真实值；门截图码区已打码）；含码 status 文件已删。两服务进程均 SIGTERM 干净退出，`pgrep` 复核 serve-r2/web-backend-storage/web-backend-entry 零残留；浏览器已关闭。候选树只读，未 push，MAYNE-23 保持 `in_progress`。
