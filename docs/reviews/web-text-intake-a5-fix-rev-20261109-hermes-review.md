# A5 修订 `787db84` 独立复审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf8e`（Codex）。对象：`787db8450b6fcc3c9ae4c4117951716c22cf012a`（tree `097b494ae89970ed05fc0a93a7840599353aa04b`，父 `0443e00`），恰两文件 +84/−25：`tests/fixtures/web-text-intake/backend-process.mjs`（+80/−25，blob `415db765`→`04dcd4c5`）＋`tests/integration/web-text-intake-http.test.mjs`（+4/−0，blob `40237eec`）；生产／Runtime／DDL／package／索引零改动（自验）。本人为原 900ms IPC 延迟反例审查者。

## 结论

**通过（限 A5 修订的判据与机制面）。** 原竞态反例窗口重放被闭合；消费登记三场景齐全且仅在真实配对成功后登记；检索不消费有直接正证；旧码 401 保持；T-13 与 two-clients 组合两连跑全绿，断言／清理／私有渠道未退化。

## 身份与 overlay 清单（精确锁定，非浮动分支名）

- 生产链：`4fc9537`——entry blob **`47a9efcd`** ✓、003 blob `e5103262` ✓、存储二进制由该链 Rust 源在当前工具链（rustc 1.99.1）重建＝`5311ffa3…7623a`（既往 `42af54b5…` 登记不迁移，差异已登记为工具链漂移；Rust 源零差异自验）。
- 修订树自带 src-tauri 为**旧一代**（store −819 行）——若用其默认二进制将运行不同代存储；本审以锁定链 Rust 重建运行。
- **修订树缺失清单（重要登记）**：修订的 http 套件自身导入 6 个夹具文件，但候选树仅有 `backend-process.mjs`／`test-safety-stub-worker.mjs` 两个——`model-config.mjs`（已审 II `7f3322b`，blob `8596b78e`）、`db-observer.mjs`（`173857dd`）／`sse-listener.mjs`（`9d0fda4f`）（@`4fc9537`）、`controlled-model.mjs`（`72a8d755`）／`controlled-model-service.mjs`／`synthetic-inputs.mjs`（`d5e10991`）／`protocol-worker.mjs`（@`c7cc116`）需另行 materialize，外加 `backend-child.mjs`（`agent/kimi/mayne-24`，已登记集成前置）。**该候选的 T-13 无法仅凭自身树字节运行**；作者登记的运行必然使用过 materialize 环境——此 overlay 面应随候选一并锁定。

## 900ms IPC 延迟窗口重放（原反例方法，child face）

- **修订字节：7/7 PASS**。缺陷窗内检索**等待 918ms**（≥ 窗宽）返回**新**未消费码（非缓存末项的已消费码）→ 配对 200；**检索不消费有直接正证**（配对前立即二次检索返回同一码）；新码 200 后登记消费；旧启动码仍 401；`pairAdditionalClient` 等到下一代新码配对 200（内部登记）；已消费的第一新码随后 401。码值未打印。
- **基线对照（`e69ee59` 字节，同 overlay 同窗）：1/1**——检索 **0ms 立即返回已消费码**（`latest===consumed`）→ 配对 401。按派工仅采共同面；旧字节后续在新增方法处 TypeError 不计入产品行为反证。
- 可证伪对比成立：0ms/已消费码/401（旧）vs 918ms/新码/200（新）。

## 消费登记齐全性与不退化（静态核 + 动态核）

- **启动**：in-process `pairWithStartupCode` 与子进程内部启动配对均在 `pair` 成功后才登记（`markPairingCodeConsumed`／`recordConsumedPairingCode`）✓；**手动重配**：T-13 两处显式登记 ✓；**附加客户端**：`pairAdditionalClient` 成功后登记 ✓。两 face 共用 `latestUnconsumedCode`（自最新向 `lastConsumedIndex` 扫描、跳过已消费集），等待循环保持 50ms 轮询／事件唤醒，`PrerequisiteGap` 报文含已发射/已消费计数。
- **检索不消费**：仅 `pair` 成功路径调用登记；探针②直接实证。登记失败语义：配对抛错不登记（注释如实——被拒码不重挂，服务端单用语义兜底；现套件无该路径，非缺陷，观察项登记）。
- **未退化**：diff 仅新增消费登记＋等待谓词＋报文细节；原断言全部保留；私有渠道（`onPairingCode` 回调／子进程 IPC）与生命周期／清理零改动；`PrerequisiteGap` 命名缺口行为保留。

## 聚焦组合复跑（真实随包 Pi，锁定 overlay）

- **T-13**：run1（spec）3/3 exit 0（10.2s）；run2（TAP）3/3 ok exit 0。
- **queue two-clients**：run1（TAP）2/2 exit 0（T-6 竞争取消恰一胜者＋共享权威队列）；run2 2/2 exit 0。
- 清理实测：全部探针／套件运行后 `/tmp/w1-a5rev2-*`／`/tmp/w1-a5base-*` 残留 0，backend-child.mjs 已删，无本树残留进程。

## 边界

不沿作者绿关闭 A5 的整体准出——本审仅签 A5 修订的机制与判据面；四套件不重跑、完整 gate 不跑；GAP-5 与其他已登记缺口状态不变。只写本审文档与本机证据（两探针＋两套件四份原始输出＋身份清单随附件）；候选字节未改。MAYNE-24 保持 `in_progress`。
