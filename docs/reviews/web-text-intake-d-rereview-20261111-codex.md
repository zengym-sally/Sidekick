# MAYNE-33 D 修订候选复审（Codex，2026-11-11）

结论：**needs_revision / BLOCK**。`370bb64822e9f6aa85533af8894d856338cf59eb`（tree `212e991d88b7c96abd9c0d01bd5d2ef1fc527fec`）关闭了 F1，并补齐 F2 的大部分用例，但“响应未知”证明仍不成立。仅余下述一项 P2；本轮未发现 P0/P1。保留已验证成果，退回修正测试及证据，不要求重写已通过的后端实现。

## 对象、范围与身份

本轮依据 MAYNE-33 当前正文与父卡 MAYNE-24 的最终集成边界，复核相对 `8480b2e` 的 5 文件修订及必要邻域。沿用 `sop-review`，以只读方式检查规格、失败路径、迁移、并发、架构/授权和证据。整体迁移事项仍按仓库 R3 处理；本轮不给双面评审或完整发布闸门通过结论。

任务分支保持 `agent/codex/mayne-33`，起点 `307700e822f71a878be3128a9e645d5c68b2f5f7`。将候选导出到忽略的 `build/mayne33-d-rereview/candidate/` 运行，未切换 HEAD 或修改候选。结束后重新导出比对 **4663 文件零字节差异**。原始审查日志、两份观察补丁及身份清单随任务附件交付。

作者附件 `01a1c909-3699-707e-990c-ab82cb5f0482` 实收 **37152 B**，SHA-256 `4af450f253cc574511cf4d366584e36e3db6771c26a656a224d734250ef8510c`，哈希与评论相符；评论写的 36410 B 是大小登记偏差，不作为阻断项。包内 12 项源码哈希均与候选匹配。004 及生产 Rust 字节相对首轮候选未变，新构建存储二进制 SHA-256 仍为 `111d6d25673e3f6815674381e81ad912f0a52d1ceb311b3af9e5e14e7a189062`。

## 已关闭的面

| 原发现项 | 本轮关闭证据 |
|---|---|
| F1：台账裁决晚于目标存在性 | 三族先进入 `runCandidateOperation` 裁决台账，再查询目标。真实 HTTP 已用键＋缺失目标三族均 409，未用键三族均 404；单元亦通过。失败后重读台账覆盖并发守卫失配路径，未改变规范请求成员 |
| F2：v2 起步、004 失败整笔回 v2 | `web_backend_schema_tests.rs:1150` 新例使用 v2＋AfterFourth，验证表数 13、两版本 2、003/004 表均不存在、原行和 sequence 高水保留，再重开至 v4；本轮实际运行通过 |
| F2：discard 失败不占键 | 新单元和 HTTP 用例均验证旧版本拒绝、无台账行，同键换正确版本后成功；本轮通过 |
| F2：apply 后续操作后重放当前态 | 新单元和 HTTP 用例均先 apply、再 edit，旧 apply 键返回编辑后的 v3/标题；本轮通过 |
| F2：三族跨重启持久性 | 三族普通同根重启重放通过，证明持久性；响应未知前置仍见下文 |

## F2 剩余 · P2 · “响应未知”用例已读到全部成功响应仍通过

位置：`tests/integration/web-text-intake-candidate-operations.test.mjs:148`（`fireWrite`），`:160`（读取 status 和完整正文），`:453`（用例），`:491`（等待并丢弃结果）。

本轮必须证明成功提交后客户端未获响应，随后同根重启以原键重放。当前 `fireWrite` 使用普通 fetch，成功回调会读取 status 和正文。主用例只等待台账落库后 abort，再忽略 promise 的结果，未检查响应是否早已收齐。abort 发生在 promise fulfilled 后也能让该用例通过。

**实际反例**：原候选 HTTP 套件 10/10 通过。只在原第 491 行记录原 promise 的结果、其余发送/轮询/abort/重启/断言保持不变，定向用例仍通过，却得到：

```json
[{"status":200,"aborted":false},{"status":200,"aborted":false},{"status":200,"aborted":false}]
```

这三项依次为 edit/discard/apply，均已读到 200 和正文。再加“各请求未消费任何响应且确实中断”的必要断言，同一观察副本 **0/1、exit 1**，在点名的前置行为处失败。两个观察副本均仅改变 close 后原 promise 结果的收集/记录/断言，未插延迟或替换生产网络/存储行为；复跑补丁、完整输出与身份绑定见附件。

影响：新增数量 10/10 仍只证明成功响应后的重启重放，无法支持作者“客户端始终拿不到响应”及 F2 已闭合的结论。此处是可复现的测试/证据缺口，不声称生产台账已发生重复写入。

必需修正：在已授权测试或 `candidate-operations-*` 夹具范围，确定地阻断客户端响应，例如转发到真实后端、等只读观测确认提交后丢弃响应的测试代理；逐族断言客户端确实未获状态/正文且传输失败，再同根重开，以原键核对当前态、版本只推进一次和每键一行。保留同路径正常返回 200 的控制组及 20s 含清理预算。不能仅在现有随机时序上追加无效 abort。同步纠正作者记录中的闭合声明。

## 实际验证与边界

环境为 macOS arm64、Node v24.20.0、npm 12.2.1、Cargo 1.99.1。前置真实执行 `npm ci --ignore-scripts`、CLI/Pi 准备、Runtime 打包、生产前端构建及 release 存储构建，均 exit 0。

| 命令/检查 | 实际结果 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend -- --test-threads=1` | exit 0，43/43 |
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake.test.mjs` | exit 1，21/22；唯一失败仍为既有 markNeedsReview 用例，其原字节与恢复实现未改 |
| 原候选新增 HTTP 套件，同一 20000ms 预算 | exit 0，10/10；真实 HTTP/真实 Rust/受控模型/真实 Pi，源码入口＋本树新编二进制＋生产 dist |
| 同一未知响应单例，仅记录结果 | exit 0，1/1；三族均 status 200、aborted false |
| 同一单例，增加缺失前置断言 | exit 1，0/1；三族已消费响应，断言失败 |
| 结构 self-test / 候选仓库扫描 | 均 exit 0；26 类/8 引用负例，285 源文件/642 引用。扫描使用独立 index 和 GIT_WORK_TREE，未移动平台文件或削弱守卫 |
| Node 语法、`cargo fmt --check`、候选 `check:docs`、diff 空白 | 均通过；候选文档为 21 文件/519 链接 |
| 标准 `cargo clippy --all-targets -- -D warnings` | exit 101，仍为既有三处 unnecessary_cast/chunks_exact_to_as_chunks；未加 allow，不宣称 Rust 门禁全绿 |

观察副本已从候选目录删除；候选导出字节完整复核，未遗留引用该候选目录的运行进程。复审仅新增本报告，保留首轮报告。main 仍为 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`。

未做完整 `npm run check`、全量 Cargo、浏览器稳定 operationId 接线、19 旅程、E/V2 切换、最终实际组合及真实模型/凭据/用户根；这些继续按当前派工留给后继和 MAYNE-34。未合 main、未 push/PR/部署，不以聚焦结果签 D 整体完成。
