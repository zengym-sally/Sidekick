# ZCode 测试新版 r2.1 `8164dea`＋记录 `1e679ac` 独立独审（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c1b6`（目标更新至 `8164dea`，沿 `01a1c1b2` 定界）。对象 blob 逐项复核：test `7b9c0e59`、browser `ea0991d7`、session `486493a8`，页内工装与 HTML 与 `62bdccd` 零差异（diff 为空）；三生产 blob＝`8a44fc3d`/`e67f8d18`/`73c1f643`（工程候选接收不变）；相对父 `60ecc75` 的 src/、src-tauri/、server/、package、依赖锁 diff 为空（零生产增量成立，比较对象＝父提交，与 r2.1 记录更正后的口径一致）。本审未参与编写。

## 结论：通过（限测试能力面）

## 静态核查（五文件全读）

1. **预算**：`WORK_MS=14000`＋`CLEANUP_MS=6000` 在用例入口显式传入，等于 runner 每例 20s 拆分；所有等待（DevTools 端点、WS open、CDP send、页内 waitForFunction、vite create、http listen、navigate）均以剩余工作预算封顶（`withDeadline`）；清理独占 6s 切片并以断言守住（`elapsedMs <= CLEANUP_MS`）；runner 强杀从不充当清理。
2. **迟到续体**：`withDeadline` 给竞速双方先挂 no-op handler——输者不会以未处理 rejection 崩进程，原始 rejection 仍达等待方。
3. **失败回收**：startChrome spawn 后每步（端点等待、WS open、Page/Runtime.enable）同处一个 try；任一失败先关 socket、SIGKILL 本测试自有的 child 并确认退出（`killChildConfirmed`），`error.chromeReclaim` 随原错误传播；DevTools 等待对 child 退出/spawn 失败**快速失败**（非 Chrome 二进制不再烧满预算）。
4. **逐步关闭**：同一收集器同时服务 `close()` 与启动失败路径（无漂移）；chrome→vite→http→profile 无论前错逐项尝试；vite 关闭错误上浮（closeVite 吞错已删）；http 优雅关闭超时走 `closeAllConnections` 并记录 `connectionsForced`；profile 删除后盘上核验。启动失败把**同一报告**挂在原错误（`error.cleanupReport`），用例失败与清理诊断同存；`close()` 不抛（收集器兜底入报告），finally 断言不会掩盖已记录的 face 失败。
5. **关闭 fault 缝（TEST-ONLY）**：hook 在真实尝试**之后**运行、仅覆盖记录判定（`applyFault`）；真实回收由 `steps.*.detail`（`exitConfirmed`）独立承载——verdict 与真实事实在报告结构上分离，符合派工「不能互相代签」的要求。
6. **注入边界与种子合法性**：页内工装在 store 工厂文档化的 Backend 注入缝换记录型传输（`web-api-client.ts` 明文允许），请求计数在该缝；种子全部是后端边界数据（含冻结 `WIRED_AGENT_IDS` 404 镜像、活动 run 跟踪）；测试头注如实声明「默认 HTTP 接线不是这些 face 的 exercising 对象」。原八面（B1–B7、B3b）与 T1 负控（.vue.txt 字节钉、永不编译执行）沿 `62bdccd` 未动；基线差异措辞更正（对父 `60ecc75` 比零生产增量，不对 cd08588+b5 逐 blob 相等）已在测试头注与记录落实。

## 独立复跑与定向反控（本审自测，非引用作者数字）

- **正常复跑**（`/tmp/rev-cand`@`8164dea`，npm ci + typecheck exit 0）：**12/12 通过、exit 0、墙钟 6.68s、stderr 29B（仅 time -p 输出）、残留 0**（capui-chrome 目录 0、chrome 进程 0）；两个新反控在本人复跑中同过（启动失败 CC 117ms、关闭 fault CC 918ms，断言全数成立）。
- **自选变异反控**（独立于作者六变异矩阵，身份核验恰一处）：`AgentSettingsPanel.vue` `const trialWired=false;→true`（试跑解锁）→ **恰 B3＋B3b 红**（exit 1），其余六面绿，残留 0——测试在 r2.1 加固后仍咬住真实编译字节；变异后已恢复原字节（hash 复核）。
- **资源归属**：Chrome 回收按本测试自有的 child 句柄 SIGKILL＋确认退出，非全局名称匹配。

## 如实登记（缺口不代签）

1. **真实关闭错误传播未动态诱导**：fault CC 按设计仅覆盖判定，真实「Chrome 拒不退出 → exitConfirmed=false」分支仅静态核（收集器同源、`steps.chrome.error` 与 `ok=false` 分支读成立）；两者不互相代签，此缺口如实保留。
2. **Chrome 启动失败 CC 用 `/bin/echo`**（spawn 成功后即退）覆盖了回收主径；spawn 拒绝（ENOENT）路径与端点等待同 try 静态成立、未动态诱导。
3. **六变异矩阵未重跑**（按派工，旧输出原样保留）；本审以一个独立变异确认测试仍咬合，其余五个变异承重依赖 r2 输出＋未动的页内工装。
4. r2 记录的基线措辞错误已由 r2.1 在记录与 README 更正（含 120→121 off-by-one 登记）；`a1e15d4` 提交消息本身不可变、以记录为准——处置合理。

## 边界

不改候选；不重开三组件七面／连接探针；未跑聚合或完整 gate。记录型 Backend 计数与种子 succeeded run 仍非真实 HTTP/Pi（边界原样保留）；B3b 仍为标志条件面（native 不签）。package 接入待工程接收。MAYNE-24 保持 `in_progress`；E/D、GAP-5 与整体准出边界不变。
