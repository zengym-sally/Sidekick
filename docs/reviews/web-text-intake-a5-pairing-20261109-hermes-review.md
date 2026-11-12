# A5 `e69ee59` 独立限定独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf50`（Codex）。对象：`e69ee59acc5ba9fd826a7758781a26277a11d178`（tree `2a3ed01d…326b`，父 `287b82c`）：恰三文件——`tests/fixtures/web-text-intake/backend-process.mjs` 53/7、`tests/integration/web-text-intake-http.test.mjs` 5/2、`tests/integration/web-text-intake-queue.test.mjs` 2/2（含 queue 两处 `pairAdditionalClient(backend,1)`→无参调用，按真实路径登记）。未改候选字节；未跑完整 gate。

## 结论

**不通过（子进程 face 取已用码竞态实锤；两处已登记调用点所在的进程内 face 本身安全）。**

## 修法与调用面核实

- 修法＝新增 `receiveLatestPairingCode()`（进程内与子进程两 handle 各一）＋http T-13 第二次取码改用之＋queue 两处调用替换。生命周期／清理逻辑、私有回调渠道未动；两处 PrerequisiteGap 文案只含 `codes.length`，**无码值输出**（逐行核）。
- **进程内 face（两处登记调用点实际所用：http T-13 `startBackend`、queue 两例 `startBackend`）安全**：现生产 entry 的 GAP-2 包装在 `sessionStore.pair` 内**同步**发放下一码（配对处理中、HTTP 响应解析前），任何配对完成后的检索必然看到新码——测试侧无法构造延迟窗口，单例／组合两连绿在该 face 有结构支撑。
- **子进程 face（`startBackendChild`）存在实锤竞态**：受控反例（探针随附件）——以 `ChildProcess.prototype.emit` 对 `type:'pairing-code'` 的 IPC 事件施加**受控 900ms 延迟**（探针层注入，候选字节零改动；`backend-child.mjs` 按 II overlay 材料化）：在「配对已成功、新码尚在 IPC 途中」的窗口内，`receiveLatestPairingCode()` 立即返回 `pairingCodes[last]`＝**已消费的启动码** → 用它配对 **401**；延迟解除后同 helper 返回新码配对 200；旧码重用仍 401（§2 单次有效未被破坏）。**4/4**——正是派工点名「latest 不自动等于未消费」：helper 只看缓存最后一项、不等待「新于最后消费」的码。
- **另发现（登记）**：该分支自带 server 字节为旧 I 谱系——`server/entries/web-backend-entry.mjs`（blob `be009408`）**无 GAP-2「成功配对发下一码」包装**（只发启动码），子进程两客户端配对在该生产基座上根本无第二码可取；两处登记调用点能工作完全依赖 server overlay（现 I entry `47a9efcd`）。实跑中该旧 entry 与现 I 存储二进制还互不兼容（transact 白名单拒绝任务写入）——候选必须按「server overlay＋现 I 二进制」的既定叠层运行，此依赖应显式写入登记。

## 独立验证清单

- 受控延迟反例 **4/4**（缺陷窗 401／解除后 200／旧码 401／setup），探针与日志随附件；码值零输出。
- 进程内 face 安全性＝结构性论证（同步发放＋HTTP 时序），非两连绿外推。
- 作者登记的单例／组合套件绿未独立重跑（本审结论不依赖它们；且反例证明机制面两连绿不充分——与派工判断一致）。

## 须修（返回作者）

子进程 handle 的 `receiveLatestPairingCode()` 不得只看缓存最后一项：应等待「新于最后已消费码」的码（例如记录最后消费的码/序号，检索时要求 `pairingCodes` 出现新条目且非已消费集内成员，超时按 PrerequisiteGap 报告）——进程内 handle 同改以保持两 face 语义一致（虽当前无可达窗口）。修毕以同一受控延迟反例复验（反例须转绿）再交独审。

## 边界

只写本审阅文档与本机证据（探针＋日志＋SHA256SUMS 随附件）；未改候选／生产／测试，未跑完整 gate；验证环境＝隔离 detached 树＋II overlay 材料化（探针层，用后即除）；码值零输出；MAYNE-24 保持 `in_progress`。
