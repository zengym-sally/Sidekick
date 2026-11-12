# SSE 同步包独审：R1 `b8a659b` 与 R2（锚定 `170f611`）（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c1e3`（接替 Pi 执行 `01a1c1cc`，不依赖黑盒候选）。对象：R1 `b8a659b`（六生产路径＋解析器自测，父 `fdf89c1`）；R2 链 `9cb0b70`（恰 3 文件）→ `d3feccd`（恰 2 文件）→ `c5f5234`（恰 1 文件测试适配）→ 记录 `170f611`；四 blob `2910c15c`/`e47ce430`/`2c164cad`/`fd7e9bf3` 逐项复核相符。本审未参与编写，独立判据，非作者探针复跑。

## 结论（分别裁定，受审字节未替换）

- **R1 `b8a659b`：不通过（needs_revision）**——协调层 `01a1c1a5` 指出的三处缺陷在本审独立探针下于 R1 原字节**全部复现**（见反控 S2/S3/S4/S5-RED）。R1 已被 R2 取代；本结论登记缺陷事实与修复必要性。
- **R2（`9cb0b70`＋`d3feccd`，锚定 `170f611`）：通过（限同步纪律范围）**——七项独立判据全绿（含 d3feccd 首快照修复）；测试适配 `c5f5234` 通过（27/27 独立复跑）。

## 独立探针与证据（本审自建，非作者探针）

探针驱动**真实管线**：`createPairing` 真实帧处理＋真实 `sse-stream.ts` 传输（mock 同源 fetch 的 text/event-stream ReadableStream）＋真实 organizer 工厂；令牌经**下一次 subscribe 实际发出的 `Last-Event-ID` 请求头**观测，不读内部变量。绿跑＝`170f611` 原字节 7/7；红跑＝`b8a659b` 原字节 6/6（红跑因 R1 把被拒读回 promise 泄漏为 unhandled rejection 而需 `--unhandled-rejections=warn`——本身即 R1 缺 gated 消费的旁证）。

| 判据 | R2 绿 | R1 红（缺陷复现） |
|---|---|---|
| S1 读回成功后才提交令牌 | token=e1:5 ✓ | e1:5 ✓ |
| S2 较小游标重放不得倒退令牌 | e1:5 ✓ | **e1:3（倒退）✓复现** |
| S3 异 epoch 帧不就地切换外 epoch、旧同 epoch 快照被栅栏 | e1:5＋重订阅 ✓ | **e9:9（翻转）✓复现** |
| S4 读回失败令牌保持保守 | e1:5 ✓ | **e1:6（到达即提交）✓复现** |
| S5 首快照同 epoch 合并不抹代际（d3feccd） | A v3 保留 ✓ | **A v3→v2 回滚 ✓复现** |
| S6 stream.reset→快照消费→重订阅携快照令牌（真实传输头） | e1:9/e1:9 ✓ | 消费无条件（登记） |
| S7 跨 epoch 整体换代 | A v1 ✓ | — |

## 其余核查

- **测试适配 `d3feccd..c5f5234`**：恰两处 hunk（import 块＋唯一 SSE 用例）；三类提示意图保留（refreshes===3）、reset 在快照消费进基线后才通知（`organizer.run.id==='tsk_snap_1'` 断言）、重订阅请求头携令牌（`inst_probe:7` 断言）、finally 无条件 dispose；用例数 27=27 未削，会话丢失用例未动。**本审独立复跑**：`170f611` 树全文件 **27/27、exit 0、stderr 0 字节**。
- **解析器**：`web-text-intake-sse-stream.test.mjs` 12 例（分块 CRLF/CR、截断尾帧 end() 冲洗、NUL id 拒绝、id 持久、无 id 提示不触令牌）——两棵树各自独立复跑 **12/12、exit 0**。
- **静态**：R2 恰 3+2+1 文件、四 blob 相符；`commitAfter` seq 栅栏与 allSettled 全 fulfilled 才提交、`acceptFrameId` 游标/epoch 判据、快照 applied-cursor 栅栏、organizer `acceptRun` 代际权威与跨 epoch 整体换代、401/重配/dispose 的 syncSeq 栅栏、PairingGate 返回 `Promise.all(reads)` 使失败闸住令牌提交——逐项读成立。（初稿此处误混入能力面包的「对父 `60ecc75` 比零生产增量」口径——该口径属 capability-ui 包，与 SSE 包无关；SSE 包的基线口径以 R2 记录的组合基线更正为准：`fdf89c1` pairing=`3ae7deb3` 非 `d04b09a9`，真基准七节差分 patch `7670a3a9…` 的 `git apply --check` 由协调层核过，本审未复验附件本体。）

## 如实登记（边界与缺口）

1. 本探针为 store 级（真实传输解析＋mock fetch），非真实 HTTP/服务端/Pi——按层证据，与既往评审分级一致；组合基线（完整 I cd08588＋b5＋本包）的整体组装仍属集成轮。
2. 作者双探针、四份原始输出、七节真基准 patch（SHA `7670a3a9…`）未由本审下载复跑——本审以独立判据替代；协调层已完成其身份核验。
3. R1 其余面（TaskQueue 栅栏读、首次/重连补偿覆盖、离开 inbox、401/dispose 动态行为）静态核成立、未动态诱导——不代签运行验收。
4. resolve/retry 与并发 UI 清单仍为后继输入；R2 的 `9cb0b70`/`d3feccd` 中间字节未单独动态测（以最终 `170f611` 为受审锚）。

## 补充：探针证据重绑定（2026-11-10，协调 `01a1c1f4`）

初稿随附的探针脚本与运行日志**版本不一致**（脚本为迭代中的早版：S3 文案/判据、S5 打印时点、无逐场隔离——协调指出的三处失配全部属实），初稿的绿/红日志**不再作为绑定证据**，原件保留于本人 build 存档不改。冻结版 v2（SHA-256 `d7da1fb8…`，两棵树字节互同）逐场隔离（connections/streamQueue/snapshotSpec 各场景重置、快照按场景传入不再被缺省清空）；消费判据改经**真实 organizer store 状态**（S3 栅栏后 organizerRun 仍 null、S6 消费后 organizerRun=A v9），不再以 readSnapshot 调用计数代签；新增 S1b 未决读回反控（读回 pending 时强制重连，头部必须未提交——绿 conn2=null、R1 红 conn2=e1:5 即到达提交）；每场 finally dispose，exit 经 `process.exitCode` 无强制退出，总预算断言 ≤20000ms（绿 2151ms、红 4396ms）。冻结脚本对锁定 `170f611`（绿 8/8 exit 0）与 `b8a659b`（红 7/7 exit 0）各重放一次，两份原始输出与脚本 SHA 一并挂载；两份缺件 `wmi-170f611.err`（0 字节）与 `parser-b8a659b.tap`（12/12）已补挂。R1 淘汰结论与 R2 暂不接收的原因成立；重绑定后结论不变：R1 needs_revision、R2 同步纪律面通过。

## 边界

不改候选与生产；只写本记录与 build 证据；未跑聚合、19 旅程或完整 gate；每例实测远低于 20s 含清理（探针全程内存态、套件 177ms 级）；工程接收与 E/D、GAP-5、整体准出边界不变。MAYNE-24 保持 `in_progress`。
