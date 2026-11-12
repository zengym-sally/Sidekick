# MAYNE-33 响应丢弃修订复审（Codex，2026-11-11）

结论：**needs_revision / BLOCK**。候选 `a24570d8824f6c7b93c2fe695b616eb22b28e29a`（tree `8d5f362a44574ab5dd56d4674d406458c70af7b9`）已关闭上轮剩余 F2；新增代理夹具存在一项 **F3 / P2 清理缺陷**。本轮未发现 P0/P1。保留 F1/F2 关闭结论，退回仅处理新夹具的失败路径收尾。

## 范围与证据身份

沿用 `sop-review`，只读检查相对 `370bb64` 的三个文件：响应丢弃夹具、HTTP 套件与作者更正记录。任务分支保持 `agent/codex/mayne-33`，起于 `4544ad498038652a1e622bf8b26c12abfd31dc54`。生产 server/Rust/原单元文件相对上轮逐字节未变，未重新扩大到整个 D；004 迁移的 R3 与最终集成边界仍保留。

经 CLI 下载作者附件 `01a1c91f-8016-70e7-bc9d-612cbf522490`，38427 B，SHA-256 `704873de5513c6b48c226676ecc498dd40080ba85ebafc8dccc060425d2c1727`，与登记一致；包内 13 项源码哈希均匹配候选。本轮导出精确候选构建、运行，结束后重新导出比对 **4664 文件零字节差异**。新建存储二进制 SHA-256 仍为 `111d6d25673e3f6815674381e81ad912f0a52d1ceb311b3af9e5e14e7a189062`。

## F2 已关闭

原 HTTP 套件本轮 **10/10、exit 0**。在原用例第 490 行之后仅记录三族请求结果的观察副本 **1/1、exit 0**，三者均无状态、无正文、发生传输失败，并完成同根重启与原键重放。正常写入 200 的控制组保留，作者亦已更正上一轮误将已收到 200 称为响应未知的记录。

```json
[{"receivedStatus":null,"receivedBody":false,"transportFailure":true},{"receivedStatus":null,"receivedBody":false,"transportFailure":true},{"receivedStatus":null,"receivedBody":false,"transportFailure":true}]
```

定向反控仅把观察副本的代理句柄改成直连真实后端，其他业务动作与断言不变：三族均收到 200/正文，新断言在 `200 !== undefined` 处正确失败，**0/1、exit 1**。这证明本轮不再是“拿到响应但丢弃结果也能通过”的旧用例。生产源码和原用例保持原样。

## F3 · P2 · 新代理的 close 无法清理未完成连接

位置：`tests/fixtures/web-text-intake/candidate-operations-response-dropper.mjs:74`–`:78`；调用方为 `tests/integration/web-text-intake-candidate-operations.test.mjs:498` 的 finally。

夹具由 `node:net.createServer` 创建 TCP Server。`close()` 调用 `server.close()` 后，试图用 `server.closeAllConnections?.()` 清理遗留连接，但 **net.Server 没有该方法**，可选调用实际无操作。夹具也未记录连接集合。只要一个连接停在半截 HTTP 请求、且上游没有数据/错误/end，`drop()` 就不会触发，`server.close()` 会等待该连接自行结束。

定向生命周期探针使用本候选夹具与一个合成 TCP 上游，客户端只发出未结束的 HTTP 头。在连接保持打开时调用 close，观察 200ms 后 promise 仍未完成；显式从外部销毁客户端/上游连接后 close 才完成。探针最后清完所有自建套接字和监听器，再以必要清理断言失败退出（**exit 1**）。原脚本及输出随附件交付。

```json
{"closeSettledWithoutExternalSocketDestruction":false,"netServerHasCloseAllConnections":false}
{"case":"after external socket destruction","closeSettled":true}
```

200ms 是取证观察窗口，不是本轮实测的 20s 超时；“可能无限等待”来自无清理/无超时且 TCP Server 等待活动连接的代码路径。影响是失败或取消时 finally 无法自行收尾，测试可能越过点名的 20s 含清理预算并遗留句柄；健康请求下的 10/10 不覆盖该面。这是测试夹具缺陷，不是新增的生产幂等错误。

必需修正：在夹具内跟踪客户端和上游 socket，close 时停止接入并显式销毁所有本夹具持有的连接，待其关闭后完成收尾；删除对不存在方法的依赖。补入半包/上游不响应的清理反例，断言无需外部销毁即可完成 close，并保留现有真实三族丢包/重启证明。修改限于已授权夹具与对应聚焦回归。

## 本轮执行与边界

环境：macOS arm64、Node v24.20.0、npm 12.2.1。前置 `npm ci --ignore-scripts`、CLI/Pi 准备、Runtime 打包、生产前端与 release 存储构建均 exit 0。

| 检查 | 实际结果 |
|---|---|
| 原候选 HTTP 套件，`--test-reporter=tap --test-timeout=20000` | 10/10，exit 0；真实 HTTP/真实 Rust/真实 Pi/受控模型，本树构建产物 |
| 三族丢包观察副本，同一预算 | 1/1，exit 0；三族均传输失败，无状态/正文，重启重放通过 |
| 直连反控，同一预算 | 0/1，exit 1；200 被新增断言正确拒绝 |
| 生命周期清理探针 | exit 1；未完成连接不能由 close 自行清掉，外部销毁后收尾；所有自建资源已清理 |
| Node 语法、结构 self-test/仓库扫描、候选 docs、diff 空白 | 均通过；结构为 26 类/8 引用负例、286 源文件/643 引用；文档 21 文件/519 链接 |

原 Rust/单元源码相对上轮未变，因此本轮未重复运行 Rust 测试、单元和标准 Clippy。上轮独立结果仍明确为 Rust 43/43、单元 21/22、标准 Clippy exit 101；已知单元失败与三项工具链告警继续开放，未转写成本轮全绿。

两份观察副本已从候选目录删除，原文件完整复核，未遗留引用该候选目录的进程。仅新增本报告，历史报告保留。main 仍 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`，未合入或 push/PR。完整 check、浏览器 operationId 接线、E/V2、19 旅程和最终组合继续按任务正文留给后继/MAYNE-34，不以本轮局部结果签 D 整体完成。
