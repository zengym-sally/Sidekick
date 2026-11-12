# W1 恢复回归三文件独立审（OpenCode，2026-11-09）

- 派发：MAYNE-24 评论 `01a1bdda-d754-7cb4-b4fa-30fabdc6bbfe`（Codex，2026-11-09T01:09:58Z）。
- 对象：ZCode 恢复回归候选 `adc31d895186960372af7b9c55abc6a58d35abdc`（tree `7ed233b828c1d26089228f48776ce085a4855f89`，父 `2f6a261`，恰 3 个新文件 +905）。审查者未写该测试；本审为平行独审，不签作者身份。
- 更正版：对象库中 `adc31d8` 无任何子提交，"其后更正版"尚不存在，本审仅覆盖现候选；W 按派发登记待修，不签其旧预期。

## 结论

**限定范围：通过（附范围标注与证据缺口）。** 10 用例中 PC1 正控实跑通过；其余 9 例逐一失败在已登记缺陷的断言上（非夹具性失败），失败面与 R8-M-1/M-2/M-3、R6-M-1/B3、R5-M-1/D1(b) 的登记机制一一对应。真实链、预算、清理、可证伪性均核实。W 旧预期不签（见下）。候选三文件零生产改动、零既有测试改动，追加式交付成立。

## 身份复算（本机对象库 + 独立构建实测）

- `adc31d8` tree/父与派发登记一致；`git diff --name-status 2f6a261 adc31d8` 恰 3 个 A（新增），无其他改动。
- 三文件 SHA-256 与提交登记逐字节一致：unit `bf2e6b102e80…76c5d1`、instance `256001ace611…b1339065`、stub `8e76c570a88b…1d58c484`。
- 运行树：`5926cbc`（tree `2c7bfae696bb1745c64906ee2d6a448381fc561b`，与既有身份裁定一致）+ 三文件原字节复制（untracked，候选树哈希零改动）。
- 独立前置链（本机复建）：npm ci + prepare-cli + prepare-pi + probe:bundle + build:backend。存储二进制 2649408 B，SHA-256 `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2`——与既有登记的 R2 审查二进制逐字节相同；`build/s0-runtime/organizer.mjs` SHA-256 `08f32db22205…833911a7`，与既有登记标准构建一致。

## 真实链核对

- **入口**：两个实例均走生产 `startWebBackend`——首实例经 `recovery-instance.mjs` 以真实子进程启动（storage 适配器、恢复扫描、调度器、HTTP/SSE 装配），SIGKILL 产生真实崩溃面；重启实例同入口在本进程内按"先恢复后调度"顺序启动。`registerEpoch+recover` 先于 `scheduler.start` 的生产启动顺序由 PC1 实跑闭合证实。
- **HTTP**：全部业务面走真实 fetch（配对码换会话、cookie + `x-csrf-token` + Origin）；恢复条目 `resolve(resume)`、`/api/tasks` 读回、cancel、retry、`/api/settings/agent-concurrency`、`/api/snapshot`、`/api/events`（`last-event-id` 重连）均经 HTTP 端点。
- **进程**：worker 经生产 `WorkerHost` `processFactory` 接缝（worker-host.mjs:168/239、entry :71/:76 在 `5926cbc` 均存在）spawn 真实 stub 进程；冻结 stdio 帧协议、`--run` argv 标记保留；退出核实用 `kill(pid,0)`/pgid SIGKILL + 树消亡等待，崩溃面用 worker.json 落盘记录定位。
- **存储**：真实 `web-backend-storage` 二进制（初始化含 003 迁移树），无任何绕过存储的结果伪造；`PC2` 的 attempt 关闭与 `M1c` 的 exited_unknown 均直呼生产原语构造（见范围标注）。
- 断言不复制迁移逻辑：状态迁移、CAS、路由全部落在 HTTP 读回与只读 SQLite 观测（W 对 attempt 行 ended_at 的查询为只读）。

## 实跑与可证伪性（本审独立复跑，非沿用作者数字）

命令：`node --test --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs`（Node v24.20.0）。
实跑完成 2026-11-09T01:23:16Z，suite 60.5s，exit 1。**形状：tests 10 / pass 1 / fail 9 / cancelled 0**——提交信息"三次 1 过／9 败"的待核对登记本轮以原始 TAP 独立证实。逐例失败落点：

| 用例 | 实跑落点 | 对应登记 |
|---|---|---|
| PC1 | ✔ 4895ms（崩溃→恢复→HTTP resume 提交原始暂存结局） | 正控，修复后须保持绿 |
| PC2 | 469: `queued !== succeeded`（关闭 attempt 后 resume 丢弃暂存改重排队） | R8-M-1/判据2 |
| M1a | 496: `202 !== 409`（活 worker 在暂存窗被发布） | R8-M-1/C2 |
| M1b | 531: `202 !== 409`（一个 resume POST 击穿 cancelling+暂存） | R8-M-1 |
| M1c | 561: `202 !== 409 exit_unconfirmed` | R8-M-1/B3 |
| F1 | 591: waitFor 超时（二认领与年轻任务推进均不发生，13.8s） | R8-M-2 UNIQUE 吞没饥饿 |
| E1 | 623: 实际 `model_request_failed` ≠ `auth_or_config_invalid` | R8-M-3/E1 |
| E2 | 646: `409 !== 202`（配置修订重试被 `config_revision_change_not_allowed` 拒绝） | R8-M-3/E2 |
| W | 673: `settled.failure` 为 null（信封不可见） | 见下节，待修不签 |
| D1 | 731: 暂存窗令牌重连恒 `stream.reset(cursor_out_of_window)` | R5-M-1/D1(b) |

- **反例可证伪性成立**：同一夹具上 PC1 绿、9 例红，红色均落已登记缺陷断言而非环境噪声；stderr 零输出；临时根清理零残留、本运行零进程残留（ps 复核）。E1 的实测公开码与 `normalizeFailure`（task-service.mjs:27-44：`code` 恒置 `model_request_failed`、原码降级进 `internalCode`）源码一致。
- **预算**：最慢 F1 13.8s（含清理）< 20s 用例预算；总时长 60.5s。清理路径（worker pgid SIGKILL → scheduler.stop → http close → sse.stop → storage.close → 根删除；崩溃实例 t.after SIGKILL）核实无残留。

## W：按派发待修，旧预期不签（本审独立复核更正依据）

- 更正在契约与源码两侧均成立：冻结 `docs/engineering/web-api-contract.md` §4.6（:202-214）注册表**无 `model_timeout` 公开行**（`worker_lost` 行默认 `manual`、语义为恢复扫描预算耗尽/不可自动续跑；`model_request_failed` 默认 `auto_backoff`）；§4.6:214 明文"无法证明即 unknown，转 needs_review。失败码本身不构成安全证明"。生产侧 scheduler.mjs:207-208 `deadlineTriggered` 产出内部 `model_timeout`，normalizeFailure 注释与实现钉死"model_timeout 仅内部诊断、公开恒为 model_request_failed"。
- 故测试 :654 用 `bare`+`runLimitMs:1200`（后端时限触发）却断言 `worker_lost`/`manual`/`failed`（:674-677），与既定映射矛盾；且 :677 把 state 绑定 retryable 的写法不具契约依据（安全路由独立于 retryable）。旧 W 实跑失败在 :673（信封不可见），其断言整体须按两场景拆分重写：无时限触发的意外 worker 丢失保留 `worker_lost/manual`；后端独立超时按登记超时映射。两者安全路由均按 §4.6 独立判定。
- 其余面不受 W 待修影响：9 例中 8 例的失败落点与契约判据逐条对应（resolve 需退出确认 §3.4/:84、exited_unknown→409 §4.5/:198、cancelling→一律 409 §3.2/:80、配置修订重试白名单 §4.5/:194、失败信封形状 §3.1/:62 无 internalCode、§6 短断线重放/超窗 reset/快照 lastEventId）。

## 范围标注（如实）

1. **PC2 前置由测试直呼生产 `TaskService.closeAttempt`（:464）构造**，非当前恢复器自行完成；修复树上恢复器应自行到达该形状，测试以生产原语固定两树共同判据。测试内注释（:457-461）有此披露；交付与登记须保持该标注，不得写成恢复器行为。
2. **M1c 前置由直呼生产 `confirmExtractExit`（:556，exited:false）构造**（调度器对未证实树所用的同一生产迁移），测试内已注明"仅构造，被测面是 HTTP resolve 契约"。
3. **全部模型结局来自受控 stub 帧**（无真实 Pi）：PC1/PC2/D1 的"成功终态"证明的是恢复/提交/SSE 机制，不代签真实模型链路；真实模型验收仍单独开放。
4. setup 的模型配置经生产 `ConfigStore` 直写（非 HTTP models 端点）；HTTP 配置写路径由 II 套件覆盖，不在本回归声明范围。
5. **分支树形态**：`2f6a261`（ZCode 分支树）不含候选 I 生产文件，本套件在分支树上无法导入生产入口；可运行形态 = 携带候选 I 的树 + 三文件（作者已按 `5926cbc`+3 文件披露）。III 集成必须落在携带 I 的集成树上，不得按 ZCode 分支树整树取用。

## 证据缺口（按派发如实单列）

- 作者对 `adc31d8` 的正式证据交付未完成：本议题 CLI 读回不到该候选的源码/binary/runtime 身份登记、聚焦命令、原始 TAP/stderr、哈希清单附件（作者最近带附件评论仍为 r8，2026-11-08T23:14Z）。
- 提交信息引用的 `build/web-text-intake-implementation-review/r9/`（run4/run5 完整日志 + SHA256SUMS）在现有各 mayne-24 工作树均不存在——原始日志已回收、不可恢复。后续签发须以新跑为准、另记时间与哈希，不沿旧值。本审已按此执行：上表实跑为本审新证据（TAP `9c9a495a…16fe04`、stderr 空文件 `e3b0c442…52b855`、时间 2026-11-09T01:23:16Z，SHA256SUMS 随评论附件）。

## 边界

只读独审 + 一次性聚焦复跑；候选树零改动（分离运行树已清理）；未写生产/测试/package/DDL/Runtime；不跑完整门禁；不触碰其他工作树现场与遗留进程；无真实模型/凭据/用户根；MAYNE-24 保持 `in_progress`，状态未动；本通过不关闭任何已登记缺陷（修复归 I 后继），不预签更正版——更正版落地后按本审判据另做限定差异审。
