# SSE 黑盒回归候选 `9f796f0` 独立独审（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c22d`（接替 `01a1c21d`/`01a1c220`，Kimi/OhMyPi 两 run 未形成可验评审）。对象：`9f796f06d42b719eb77948fd6bfb408b6d34c2f8` 恰四文件——主测试 `82c8c0e7`、harness `fe2bd6b1`、作者记录 `a63a594c`、README 索引（122→123）；blob 逐项复核相符。本审未参与编写。

## 结论：**通过（限测试能力面，绑定 R2 谱系）**，附两项登记发现

## 独立复跑（本审自建两棵树，非引用作者输出）

- **绿**：detached `170f611`（R2 锚）＋恰候选两文件复制 → `node --test tests/unit/web-text-intake-sse-client.test.mjs` → **11/11、exit 0、stderr 0 字节**。
- **红**：detached `fdf89c1`＋pairing→`d04b09a9`（`cd08588` 字节）→ 同两文件复制 → **11 例：2 过 9 红、exit 1**。五路径身份逐 blob 核对：web-api-client `e730d4a3`、PairingGate `01e43233`、TaskQueue `1bd5d476`、organizer `d4b824cb`（＝作者登记的真组合基准配方，本审独立复核）。
- **红位全部落在同步断言**：两锚先绿（A1 269ms／A2 460ms）；九红分别为 organizer 读回缺位（×4，标签化等待超时）、epoch 采纳缺位、会话丢失未回闸门、needs_review 槽位可见性（57.9ms 快红）、sync-epoch 栅栏缺位——与作者登记的红位一一对应，无传输管道误红。
- 预算：每例 `{ timeout: 20000 }`，两树实测最大 2.57s，未触预算。

## 静态核查要点

1. **真实接线、不重写生产回调**：harness 编译真实 `PairingGate.vue`（被测 handler＝生产 gate 注册的那个）＋槽内真实 `TaskQueue.vue`＋真实 stores／`WebApiClient` 单例；测试零自写同步回调，帧只在传输边界写入（fetch 流 body／原生 EventSource double）。
2. **双树传输替身忠实度**：R2 树走真实 `text/event-stream` Response body 经生产解析器（Accept/Host 头可观测）；旧树走忠实原生 double（记录实例/监听/close，emit 传零参 hint）；`sse-stream.ts` 不被 harness 直接 import，双树各自用己方真实传输。
3. **轮询隔离**：断言窗口 400–700ms，远低于队列 1s 轮询——轮询无法掩盖缺失补偿。
4. **失败清理与 globals 恢复**：`openCase.finish` 无条件 unmount＋`pairing.dispose()`＋`net.restore()`（fetch/window/EventSource 三 globals 存前恢复）＋settle；用例失败不遗留流/定时器/重连循环。
5. **左遗 harness 处置**：`2e8b5d53`（blob `95fa6115`）逐文件核读登记，Vue 卸载错误根因（最小渲染器 fragment 遍历死循环等四处）修复并记录——登记合理。

## 两项登记发现（逐源说明，不影响测试能力面通过，但约束工程接收）

1. **候选自树不可运行**：`9f796f0` 自树**无 `src/components/TaskQueue.vue`**（其 pairing=`3ae7deb3`、PairingGate=`01e43233` 为包前字节）——harness 编译该组件即 ENOENT，**本审实测候选自树 11/11 全红（exit 1，全数 ENOENT）**。作者绿/红证据均在拼装树（R2 树／真组合基准树）上取得——测试字节本身有效，但工程接收**必须绑到含 R2 六路径与 TaskQueue 的谱系**（如 `170f611` 一线），不得按候选自身分支树落位；此为接收规划约束，登记由协调层处置。
2. **快照形状逐源不一致**（派工特别核项）：①冻结规范（`web-api-contract.md` §6）：快照＝全量＋`highWatermark`，任务条目与 §3.1 全字段同形，未明定并发字段位置；②冻结样例（`snapshot-high-watermark.json`）：`settings:{agentConcurrency,version}` 嵌套＋`workspace`/`generatedAt`；③harness/夹具：顶层 `agentConcurrency`、无 settings/workspace/generatedAt（＝客户端 `readSnapshot` 的消费形状，harness 头注明言按客户端 wire 映射建模）；④**实际 HTTP 实现：本树 server/ 无 `/api/snapshot` 路由、无 highWatermark 实现——无真实来源可对裁**。不能以客户端可消费推定合法：若真实服务端按样例嵌套形状返回，客户端顶层读取将为 undefined——此风险须在集成/服务端轮由 owner 裁定样例与客户端映射孰为权威，测试候选本身不受其影响。

## 未验项

Real HTTP/服务端来源（无实现在树）；`behavior` 一发响应的全组合、S5 600ms 双检的真实时序抖动面未逐一穷举；红树的 `holdNextTasks` 栅栏面仅经 S9 单点核（红位成立）。已过面（生产同步纪律七判据、测试适配 27/27、解析器 12/12、能力面七面）不重开。

## 边界

只读候选；仅新增本记录与 build 证据；未改生产/package/main；未跑聚合、19 旅程或完整 gate；实测最长大约 2.6s/例，预算内含清理；运行树用后即删无遗留。MAYNE-24 保持 `in_progress`；E/D、GAP-5 与整体准出边界不变。
