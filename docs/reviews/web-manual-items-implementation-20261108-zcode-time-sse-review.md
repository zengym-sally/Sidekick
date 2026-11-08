# W1 I 时间/SSE 退修限定独审（ZCode，R4 增量）

- 日期：2026-11-08。审查者：ZCode（未参与本次时间/SSE 修订）。
- 对象：`e750302cdb1a6718b3260929707d351163015176..05f0bc04f2d4d1188931b5eb1dca540650d196d7`（Claude 的 I F-1/F-2/F-4 退修，父提交即第四轮已审通过版 `e750302`）。
- 判定依据：集成第四轮回执 F-1/F-2/F-4 归因、派审裁定（严格 UTC 毫秒 ISO 线格式、复用 `shared/dates.mjs::zonedCandidates` 校验结构化本地时刻、保留自由原表达、不改 shared/DDL/任务协议、事项帧无 id 不占任务 cursor）、冻结契约与 002 DDL。
- **结论：通过**（1 项 MINOR 登记不阻断＋1 项观察；F-1/F-2/F-4 在全部枚举类上独立复验关闭，可证伪回归双向成立）。
- 候选只读：/tmp `git archive` 导出验证，临时树已删除，`pgrep` 复核零残留进程。本隔离树仅写入本记录与 gitignored `build/web-manual-items-time-sse-review/`（含全部原始日志与驱动）。环境：macOS arm64、Node v24.20.0、cargo 1.89.0（仅构建存储二进制，非 Rust 测试套件）。

## 1. 版本与哈希（全部实测逐字节一致）

- 提交 `05f0bc04`，tree `f64c094fae1fa61391c2645fda9b2f12c4d7a28d`，父即 `e750302c`（merge-base 复核，无 squash/amend）；`6546990`、`bc4b1c3` 均为祖先（`--is-ancestor` exit 0）。
- 增量补丁（`e750302..05f0bc04`）SHA-256 `bc512e39856db4a1c1919a6dec9a36361245c48d510bb0d3a1ff1d6e650b2360`、累计补丁（`bc4b1c3..`）`cf053d75e4815dbaff546bb8e6ec8c87712e074774f1aa173ce4485f2c3c37db` 均复算一致；`git diff --check` exit 0。
- 恰 4 文件 +199/−12：`server/lib/manual-items-service.mjs`（+23/−3，SHA-256 `9c33d552…95a6`）、`server/lib/sse-hub.mjs`（+23/−0，`f49951aa…ceea`）、`tests/unit/web-manual-items.test.mjs`（+126/−1，`35cd623d…9ee7`）——三文件与申报哈希 3/3 一致；第 4 文件 `docs/reviews/web-manual-items-implementation-20261108.md`（+27/−8）为 I 自有交付记录：3 处哈希表刷新＋3 处增量文件行刷新＋纯追加 §11，无历史改写。
- 冻结实测（逐字节不变）：`001_web_backend.sql`＝`8511907c…143d`、`002_manual_items.sql`＝`b6cb8e61…f97e`（批准 DDL 原样）、`web-api-contract.md`（web-api/1）＝`61863271…f58d`；`src-tauri/`、`shared/`、`src/`（含 `pairing.ts`）、`src/domain/`、`scripts/`、`package.json`、`tests/integration`、`tests/fixtures` 相对 `e750302` **零差异**；无新增依赖。

## 2. F-1 关闭（严格 ISO UTC 毫秒）——已验证

`normalizePoint` 改为：`at` 必须匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` 且 `Date.parse` 有限，否则 400 `validation_failed`；移除旧 `at ?? atMs` 双路径（数字 `atMs` 输入不再被接受；II 套件经 19418ef 全量 grep 证实零 HTTP `atMs` 用例，客户端 `toWirePoint` 只发 `at` ISO 串——收窄无破坏面）。响应 `at` 由 `toWire` 一律按 `atMs` 重算（服务 line 195），读写一致。

真实 HTTP 复跑（驱动对候选 vs 旧字节同例对照）：
- 候选：`'2026-11-13 18:00'`（空格无 Z）→ 400；`'2026-11-13T18:00:00Z'`（无毫秒）→ 400；数字 `atMs` → 400；非法时区 → 400（不变）。
- 旧字节：同三条 **200 接受**（空格串按服务器本地时区解析为 `2026-11-13T10:00:00Z`，`atMs:1765648800000` 直通为 `2025-12-13T18:00Z`）——第四轮归因的 F-1 机制原样复现。
- **拒绝不落库、不烧键**：全部拒绝例后 DB `manual_items`/`manual_item_events` 零新增（最终 11 items＝11 events，恰等于成功写入数）；以**同一 operationId** 改正载荷重提交 → 200 创建成功（§1.1 未接收语义成立）。

## 3. F-2 关闭（结构化本地时刻存在性/显式 instant）——已验证

`precision=minute` 且 `localText` 匹配 `^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$` 时调用 `shared/dates.mjs::zonedCandidates`（shared/ 零改动，仅导入）：无候选（夏令空缺/日历无效结构串）→ 400「本地时刻不存在」；`at` 不在候选集（回落歧义未选显式 instant）→ 400「时刻与本地表达不一致」；自由表达保留原文不在服务端解析。

真实 HTTP 复跑（America/New_York 实测 2026 年真实日历）：
- 夏令空缺 `2026-03-08 02:30`（at=`07:30Z`）→ **400**；同刻 03:30 对照 → 200（有效时刻不被误拒）。
- 回落歧义 `2026-11-01 01:30` 两个候选 instant **均被显式接受**：`05:30Z` → 200、`06:30Z` → 200；非候选 `07:30Z` → 400。
- 自由表达 `周五下午` → 200 且 `localText` 原样返回；结构化一致 `2026-11-13 18:00`/`10:00Z`（Asia/Shanghai）→ 200。
- 旧字节同例：空缺 `02:30` **200 静默吸附**、歧义 mismatch `07:30Z` 200、结构化 `2026-02-30 10:00` 200（滚动为 Mar 2）——F-2 反例「静默吸附」原样复现，新门恰对此判别。
- day 语义保持：`precision='day'` 有效时点 → 200 原样（day 无交叉校验为既有语义，本增量未触碰）。

## 4. F-4 关闭（SSE epoch reset→ready 与事项帧）——已验证

`sse-hub.mjs` 读取 `Last-Event-ID`：无/空 token → 仅 `stream.ready`；`^([^:]+):(\d+)$` 不匹配 → `malformed_last_event_id`；epoch ≠ 当前 → `epoch_changed`；同 epoch cursor>0 → `cursor_out_of_window`（W1 无任何带 id 帧，正游标不可被服务，reset 是唯一正确应答；负游标 `-1` 落 malformed）。reset 帧在 ready 之前，data `{contractVersion, epoch(当前实例), reason}`，无 `id` 行。

真实 HTTP/SSE 复跑（候选，实例 `inst_27a447b76aa5`）：`inst_000000000000:0` → `reset(epoch_changed)`+`ready`（顺序正确）；无 token / `${epoch}:0` → 仅 `ready`（cursor 0）；`${epoch}:9` → `reset(cursor_out_of_window)`；`garbage`、`${epoch}:-1` → `reset(malformed_last_event_id)`。打开流中创建事项收到实时 `item.changed`：data `{contractVersion, objectType:"item", itemId, itemVersion, at}`、**无 `id:` 行**；随后以 `${epoch}:0` 重连 → 仅 `ready` 且 cursor 0——事项帧不占任务 cursor；DB `task_events`=0。旧字节同例：旧 epoch / 超窗 / malformed → **全部仅 ready，0 帧 reset**（第四轮 A-8 20s 超时缺陷原样复现）。

浏览器读回接线（未改而验证其真实存在）：`src/stores/pairing.ts:28` 对 `stream.ready`/`stream.reset`/`item.changed` 三帧注册监听并调用 `onItemChanged`；`src/components/PairingGate.vue:13` 注册 `todos.refresh()` 读回。单测 `pairing re-reads on stream.ready/stream.reset/item.changed`（真实 `createPairing`，不 mock 监听路径）候选 20/20 通过。服务端此前从不发 reset，接线不可达；本增量使三帧读回补偿首次端到端可达。

## 5. 独立复跑清单（命令与 exit）

| 命令 | 候选 `05f0bc04` | 旧字节 `e750302` |
|---|---|---|
| `npm ci --ignore-scripts` | exit 0 | （共享 node_modules） |
| `node --test tests/unit/web-manual-items.test.mjs` | **20/20 pass，exit 0** | 同文件在父服务字节上 **17/20，exit 1**：恰 `validation rejects malformed input`（期望新报错文案）、`rejects non-ISO instants…(F-1/F-2)`、`SSE answers an old epoch…(F-4)` 三条修复定向用例失败；两条既有行为新用例（事项帧无 id、pairing 三帧读回）新旧皆过，与其「既有接线」性质一致 |
| 真实 HTTP/SSE 驱动（`driver-time-sse.mjs`，真实 entry＋真实 `web-backend-storage` release 二进制＋合成根） | 26 断言全符合预期（F-1/F-2 拒绝集 400 且零落库、正例集 200、SSE 七场景） | 同驱动复现 F-1/F-2 全部缺陷（非 ISO/空缺/歧义 mismatch/结构化日历无效均 200）与 F-4（0 帧 reset） |
| `npm run typecheck`（vue-tsc --noEmit） | exit 0 | —（增量未触客户端） |
| `cargo build --bin web-backend-storage --release`（驱动前置，真实资源 `build/s0-runtime` 只读复制自本机既有产物） | exit 0 | — |

原始证据（本树 gitignored `build/web-manual-items-time-sse-review/`）：`01`–`05` 身份/补丁/冻结/作用域/增量 diff、`06` npm ci、`07` 候选单测、`08` cargo 构建、`09` 候选驱动 JSONL（含两次运行：首轮路由笔误 405、次轮 inst_27a4 为有效运行）、`10` 旧字节单测可证伪、`11` 旧字节驱动 JSONL、`12` typecheck、`driver-time-sse.mjs`。

## 6. 发现项

- **MINOR-1（登记不阻断）：日历无效但形状合法的 `at` 在 day/自由表达路径被静默滚动接受并落库。** 实测候选：`precision='day'`、`at='2026-02-30T00:00:00.000Z'` → 200，落库 `due_at_ms=1772409600000`（=2026-03-02T00:00Z）、`due_local='2026-02-30'`；`precision='minute'`、自由表达 `周末`、`at='2026-02-30T18:00:00.000Z'` → 200 落库 Mar 2。根因：门禁＝形状正则＋`Date.parse` 有限，而 V8 对 `2026-02-30`/非闰年 `02-29`/`04-31` 等滚动到下一有效日；存在性校验只经 `zonedCandidates` 在「minute＋结构化」路径生效。与第四轮 F-2 归因点名的「静默吸附」同类，但（a）不在 F-1/F-2 枚举门例内（A-1 形状类、A-2 夏令类均已闭合），（b）生产客户端不可达（域 `pointFromInput` 经 `zonedCandidates` 拒绝不存在日期，`at` 恒由域 atMs 生成），（c）落库后全部读回按 atMs 重算、内部自洽，无数据损坏面，（d）day/自由表达语义保持本身是裁定要求。建议下一版 I 修订顺手收口：day 精度按 `civilDate` 存在性校验、自由表达路径加 instant↔日历回转检查（复用现有导出即可）。派审可裁定是否并入下版。
- **OBS-1（观察）**：`YYYY-MM-DD HH:mm:ss`（带秒）的结构化串落自由表达语义、不做交叉校验——与 `zonedCandidates`/裁定的结构化定义（`HH:mm`）一致，属 MINOR-1 同族的边界说明，非缺陷。
- `cursor_out_of_window` 对一切正游标成立：W1 无任何带 id 帧，客户端今日不可能持有正游标；未来任务流引入回放窗口时需重审该分支（登记给后续切片，不影响本增量）。

## 7. 未验项（如实开放）

- 完整 `npm run check`／最终集成门禁不在本轮，仍由唯一集成者在新冻结版本从头串行重跑；II 的 F-3/F-5/F-6 修订（Kimi 树）不在本审。
- Rust 套件未重跑：本增量 Rust 零差异，沿 `12d42f2`/`4889f87` 既有结论；cargo 仅用于构建驱动前置二进制。
- 浏览器端到端旅程（真实 UI 消费 reset 帧）须在新集成版快照上复验（派审已明示）；本轮以单测（pairing 三帧真实监听）＋线级 HTTP 证据为界。
- 新旧集成版对受影响旅程的回归由集成轮承担。

## 8. 判定

**通过。** 增量身份/哈希/冻结/作用域全部逐字节复核一致；F-1/F-2/F-4 在全部枚举缺陷类上以「候选闭合＋旧字节原样复现」双向可证伪证据关闭；非法时间拒绝不落库、同 operationId 不烧键、有效时间（空缺对照/双候选显式/结构化一致/day/自由表达）不被误拒、事项帧无 id 不占 cursor、reset→ready 顺序与字段、浏览器三帧读回接线均实测成立。MINOR-1 为登记项，不阻断本增量，交派审裁定是否并入下一版修订。MAYNE-23 保持 in_progress。
