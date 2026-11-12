# 文本整理能力面 UI 测试清理与预算加固 r2.1（capability-UI cleanup）— 2026-11-10 ZCode

- **范围与风险级**：按派工评论 `01a1c1b2`（协调层对 r2 候选 `62bdccd`／`a1e15d4` 的核读意见）**只窄修** capability-ui 测试及其专用会话／浏览器夹具，闭合协调层指出的三处夹具缺口：① `startChrome` 在 spawn 之后、返回句柄之前的 CDP 等待／连接／enable 任一失败缺少本函数回收路径（session 此时拿不到 chrome 句柄）；② `closeVite` 吞关闭错误、`session.close` 串行步骤可能因前一步失败跳过其余资源；③ CDP 单次 30s／启动 20s 等待未从整例 20s 预算中预留清理预算（正常轮 ≈3s 不能证明失败路径有界）。同时更正 r2 记录的差异措辞。风险级：低（纯测试面：测试文件＋两夹具；生产路径、package、依赖锁、脚本名集合零字节）。
- **基点**：分支 `agent/zcode/mayne-24`，父提交 `a1e15d4`（r2 记录提交）；本切片提交＝（测试面提交）＋（本记录提交）。三生产 blob 未动（HEAD `git ls-tree` 复核 `8a44fc3d`／`e67f8d18`／`73c1f643`）。
- **作者不自签**：作者自报；本清理差分与 r2 五文件候选一并待 Hermes 独审（`01a1c1b2` 派工），不替作者修改的边界不变。

## 1. 加固内容（恰两夹具＋测试文件）

- **浏览器夹具**（`tests/fixtures/web-text-intake/capability-ui-browser.mjs`）：spawn 之后的所有启动步骤进入同一 try 块——任一失败（DevTools 端点等待、WebSocket 打开、`Page.enable`／`Runtime.enable`）先关闭 socket（如已存在）、SIGKILL 本例自有子进程并**确认退出**，回收记录挂在原错误上（`error.chromeReclaim`＝`{socketClosed,killed,exitConfirmed}`）再传播；DevTools 等待对**子进程已退出／spawn 失败**快速失败（非 Chrome 二进制不再烧满预算轮询空端口）；所有等待（端点、WS 打开、每次 CDP 调用、页内 waitForFunction）一律以调用方传入的**工作截止时刻**为界，不再有裸 30s／20s 常量。
- **会话夹具**（`capability-ui-session.mjs`）：唯一清理收集器 `collectCleanupSteps` 同时服务 `close()` 与启动失败路径（保证两者语义不漂移）——**逐项尝试** chrome（socket＋SIGKILL＋有界退出确认）→ vite（关闭错误如实上浮，不再吞）→ http（有界优雅关闭，keep-alive 未及时排空时 `closeAllConnections` 强制释放并如实记录）→ profile（rmSync＋在盘核验），**任何一步失败不跳过其余步骤**，每步结果入报告，`report.ok=false` 即向上传播（不静默算成功）；启动失败走同一收集器并把报告挂到**原错误**（`error.cleanupReport`）后按原错误抛出——原用例失败与清理诊断同时保留；`close()` 永不抛（收集器兜底也入报告），测试 `finally` 的清理断言因此不会遮蔽已记录的子测失败。
- **预算管线**（测试文件为用例入口）：入口显式传 `{workMs:14000, cleanupMs:6000}`（＝runner 每例 20000ms 的分账：资源工作 14s＋**预留清理 6s**）——清理不必与 runner 超时抢时间，失败路径与 ≈3s 绿路径同受预算约束，不依赖 runner 强行退出代清理。
- **反控缝（仅测试）**：`close(faults)` 的 fault 钩子在**该步真实尝试完成之后**运行、只覆盖记录判 verdict（真实回收照常执行），使传播与跳过保护可被观测而不泄漏资源；报告把「verdict」（`steps.*.ok`，含 fault）与「已核实的现实」（`chromeClosed`／`profileRemoved`／`steps.*.detail`）分开，残留始终可查。
- r2 的 8 行为面、B3b、T1 字节负控与页内工装（`capability-ui-page/`）零改动。

## 2. 差异措辞更正（r2 记录 §5.4 已登记）

- 零生产增量的比较对象是**父提交 `60ecc75`**；不能说修后三组件与原始 `cd08588`＋b5 组合基准逐 blob 相等——`git ls-tree` 复核：`cd08588` 处 Agent `107b8d74`、Model `d8273800`、Settings `fa75f477`（修复前原字节），而本树三面板是修复后 blob `8a44fc3d`/`e67f8d18`/`73c1f643`，逐 blob **不相等**。r2 记录 §2 第二条已改为正确表述并加更正注记；当日提交 `a1e15d4` 的提交消息含同样措辞，提交消息不可改，以记录为准。
- 记录型 Backend 注入与真实默认 HTTP 接线的边界保持明确：注入缝在 store 工厂文档化的 Backend 缝（`web-api-client.ts`），本套件不签默认 HTTP 接线行为。
- 顺带更正索引计数：r2 提交（`a1e15d4`）登记「README 索引 120→121」但只加了行、标题计数仍写「120 份」（实际已有 121 行）；本轮加新记录后标题一并更正为 122。

## 3. 证据（一次必要终跑＋两个受控反控；原六变异矩阵未重跑）

运行环境：node v24.20.0、Chrome 156.0.8078.80、macOS arm64。命令 `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-capability-ui.test.mjs`（r2 同命令）。旧输出（`build/mayne24-capability-ui-behavioral/`）原样保留；本轮原始证据在 `build/mayne24-capability-ui-cleanup/`。

| 轮 | 结果 | 关键时长 |
|---|---|---|
| 必要终跑 `final.tap`（4 顶测／12 测试全绿） | exit 0，12/12，含两个新反控 | 外墙钟 **3.93 s**（`/usr/bin/time`）＝T1 1.8ms＋行为面 2971ms＋启动失败反控 114ms＋关闭失败反控 711ms，全部含各自清理 |
| 反控 A：启动失败回收（`chromePath:'/bin/echo'`，存在且非 Chrome） | 会话启动**如实判红**（`assert.rejects`，错误含子进程已退出事实）；`chromeReclaim.exitConfirmed=true`（本例自有子进程回收并确认退出）；`cleanupReport.ok=true`——vite／http／profile 其余清理继续、profile 在盘核验为零残留 | 114 ms，含全部清理，≪20s |
| 反控 B：关闭失败传播（`close({chrome:()=>new Error('injected…')})` 仅覆盖 verdict） | `report.ok=false`（**不静默算成功**）；`steps.chrome.error`＝注入错误；同报告 `steps.chrome.detail.exitConfirmed=true`（真实回收仍执行并核实子进程退出）；vite／http／profile 步骤逐项 `ok=true`（前错不跳过其余）；`profileRemoved=true`（零残留可查） | 711 ms，≪20s |
| 残留核验 `residue.txt` | 套件前后 `capui-chrome-*` 临时根 0→0、自有 chrome 进程 0→0 | — |

预先热身轮 `warmup1.tap`（exit 0、12/12、4.52s）作废保留，仅证明机制可跑；终跑以上表为准。两反控长期随套件运行（Chrome 缺席环境按既有 `chromeAvailable()` 约定一并 skip）。

## 4. 门禁（本树）

| 命令 | 结果 |
|---|---|
| `node --check`（测试＋两夹具 mjs） | exit 0 |
| `npm run typecheck`（vue-tsc --noEmit；`npm ci --ignore-scripts` exit 0 先行） | exit 0 |
| `npm run check:structure` | 183＝本分支登记基线、零新增；capability-ui 零命中 |
| 终跑 stderr | 29 B＝`/usr/bin/time -p` 外墙钟输出（real 3.93s），套件自身 0 B |

## 5. 边界与未验证项

- 未重跑原六变异矩阵、未跑聚合套件、未跑完整门禁；未动 SSE／server／native／D1；未改 package.json／脚本名集合／依赖锁；零新增依赖。
- 反控只证明清理／预算机制的判红、继续清理、零残留与有界；B3b 仍只验证标志条件（不签 native 运行）；记录型 Backend 的命令计数与种子 run 仍不等于真实 HTTP 请求或真实 Pi 成功（协调层 `01a1c1b2` 口径不变）。
- 测试新版与清理差分仍待独审与工程接收，package 暂不接入。

## 6. 结论

**限定通过（作者自报，待独审）**：协调层 `01a1c1b2` 指出的三处夹具缺口逐项闭合——Chrome 取得即具备失败回收（启动未完成也关闭 socket、终止并确认本例自有子进程退出）、关闭逐项尝试收集后传播（HTTP／Vite／profile 不被前错跳过或静默算成功，原用例失败与清理诊断同时保留）、硬预算从用例入口统一传入并给全部清理预留时间；一次必要终跑＋启动失败／关闭失败两个受控反控证明实际判红、其余清理继续、残留为零且均在 20s 内；差异措辞已更正并登记。原始脚本／输出／SHA 随交付评论挂载。MAYNE-24 保持 `in_progress`。
