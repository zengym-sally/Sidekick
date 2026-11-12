# MAYNE-35：producer 修复复审通过与消费者接续（2026-11-11，Codex）

**结论：pass，限 producer 修复候选。** 接收 `5f3f6563f6ad7bb63ca7300349f8cc9764139794`（tree `3fd87bdb3262371c1ac3f193498ec54abe112ff2`）作为后继消费者输入；原 P1、P3-1、P3-2 已关闭，P3-3 保留为消费者接线要求。未发现此次修订新增的 P0–P3 问题。E 的服务/恢复/调度、namespace 发布、V2 信封及前端尚未完成，不能进入 done 或据此合 main。

## 1. 范围与输入

本轮为 R3 退出安全切片的限定修复复审，不是整个切片或发布的最终闸门。原 producer 为 `2394a245831c5d673f8692c147487ea521e9f366`；本轮逐行审核相对它的两模块、两测试增量（+208/-23），核对不变 fixture、旧作者记录与新修复记录。Claude 分支从冻结 `0c9febc…` 按路径接收原 producer，未整枝覆盖；冻结规范/55 样例保持原字节。

审查分支保持 `agent/codex/mayne-35`，基点 `feac2f948316486f1aa2c9bd6332496ecc3dd59a`。通过 `git archive` 在本轮 ignored build 目录导出候选；修前副本只替换两模块为原 producer，测试与 fixture 与修后字节相同。工作树原有 AGENTS.md 平台附加内容及 `.multica/` 不纳入本轮交付。

## 2. 发现项关闭

- **P1**：builder 先处理 argv null/通用失败/EPERM 的规范性原因约束，随后保留其它否决；detail 拼接全部阻塞事实，survivors、identity mismatch、pending 未被删除。validator 现在拒绝所有违规 null/failed 原因；旧单元反向期望已改为规范要求并补校验断言。生产 `observeAttemptExit` 校验闸门保留。
- **P3-1**：`runStraySweep` 的语义损坏 aggregate 由局部 catch 转为 `stray_ledger_corrupt`，与 JSON 损坏同口径，在任何清扫/写入前返回。原磁盘记录保留。
- **P3-2**：新 Claude 记录追加更正原宿主相对 d70280c 为 +672/-3，旧作者记录原字节保留。当前修订相对原 producer 的差分另行登记，不混用两个基点。
- **P3-3**：来源 API 守卫仍未纳入本次窄修；没有因此将当前调用点问题扩大成新的 producer 阻塞。后继消费者必须保持“帧/身份来源登记，argv 不创建成员”的边界。

V1 的 verifyTree/confirmExit/done boolean 代码未被此次生产 diff 改动；真实合成进程测试保留严格 boolean 断言。没有将 B(a) 出口启用到旧 V1 消费者。

## 3. 本轮实际证据

| 核验 | 实际结果 |
|---|---|
| 同一新测试字节，原 2394a245 两模块 | **23 pass / 6 fail，exit 1**；失败均落在指定混合面、validator 与坏台账处理 |
| `node --test --test-timeout=20000`，修后候选两文件 | **29/29 pass，exit 0**，约 8.03s；原 24 项与新增 5 项均执行，0 skipped |
| 两轮执行后的 fixture 检查 | 残留 0；仅自建合成进程，未调用真实模型/凭据/用户根 |
| 独立纯判定矩阵 `mixed-matrix.mjs` | **720/720**：4 个满足完整谓词的 confirmed，716 个 unresolved；所有对象满足独立谓词与原因要求并被 validator 接受；survivor/mismatch/pending 事实保留 |
| 独立 validator 反控 | 三种伪造 null-scan 原因均拒绝，四个完整退出正控接受 |
| 独立实际 host 方法＋模拟 adapter | pending＋ps EPERM 与 pending＋ps EIO 都返回合法 typed unresolved，无异常；原因分别 eperm/insufficient_evidence。未操作真实 OS/PID；不是实机 EPERM 证据 |
| 作者附件 SHA 清单 | 5/5 匹配受审提交；修前/修后两测试 SHA 相同，冻结 V2/55 样例、旧作者记录及 fixture 字节未变 |
| 候选完整导出树 `npm run check:docs` | exit 0，22 文件/527 链接 |
| 受审四文件 `git diff --check` | exit 0 |

独立矩阵预期直接来自冻结谓词与 argv 原因条款，未用 builder 的结果反推预期。host adapter 探针首次因审查脚手架未挂接 lateEnrichMembers 而失败，补齐实际 prototype 方法后重跑成功；候选未修改，这次脚手架错误不算候选缺陷。两轮原始测试输出留 build，交付副本仅替换本机路径，计数/错误不删改；原始输出哈希保留在 run-results.json。

本轮覆盖规格符合度、修改范围、失败处理、证据保留、回归可证伪性、V1 兼容边界和输入身份。未重审未变 producer 全部安全面，也未重做 MAYNE-36 的四项旧变异；真实 OS EPERM、真实 Pi、HTTP/恢复/调度/前端组合、Rust/打包、完整 `npm run check` 与 19 旅程未验。结构守卫旧 vendor dist 前置缺失未由本轮解决；聚焦绿证不替代最终全门禁。

## 4. 下一份有界候选：后端消费者、恢复与 API2 线域接线

本卡早已授权规范/producer 通过后继续接力；本次限定由 **Claude** 交一份后端候选，完成即交独审。没有新的 owner 方向/DDL/依赖问题，不重做已过 D 或重新比较 B(a)。当前核得本卡仅本次 Codex active，无重复消费者实现；Claude 名单存在且可被调用，可能有其它任务，其本卡任务正常排队即可。

**精确输入**：D 后端已过 `8b6052b5f54f3f4dff89e46a1a49bd852c7b68da` / tree `883930de850b7b9e71c51d8d30ca0c647e042bd1`（MAYNE-33 当前说明确认）；producer 采用本轮已过 `5f3f656…`；规范/55 样例采用冻结 `0c9febc5010015418a5778a49f76d4e0c01f7f9f`，规范 SHA-256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`。按路径登记接收来源/实际任务分支/祖先/哈希，不整枝覆盖前端、冻结规范或其它候选，不换分支、reset/stash。必要已审基线文件原样接收与本轮修改分别列清单。

**唯一修改生产写域**：`server/lib/task-service.mjs`、`task-recovery.mjs`、`task-scheduler.mjs`、`text-intake-service.mjs`（仅 attempt namespace/暂存发布衔接，保留已过 D 三操作族）、`worker-host.mjs`（必要持久化/来源守卫/调用适配）、`http-server.mjs`、`sse-hub.mjs`；`manual-items-service.mjs` 仅共享 CONTRACT_VERSION，`static-files.mjs` 仅错误信封中硬编码版本；`server/entries/web-backend-entry.mjs` 如确需，仅作这些消费者的装配。纯判定模块已过，不重新设计谓词。其余新生产路径如确需，先报具体前置与最小差异，不自行扩大。

**目标与独立验收**：

1. 运行结束、取消、deadline、停止与新实例恢复均消费 typed 证据，明确 `.verdict` 判别；不得将对象当 boolean、不得 `treeVerified=true` 默认放行。任何已知存活者/证据不足/pending 均为 exited_unknown 占槽且 resolve 409。对已有 attempt 的缺失/损坏证据明确 fail closed；合法未启动 not_started 情况单独处理。补 P3-3 的来源守卫或隔离测试 seam，argv 不反向创建登记。
2. 退出证据随 attempt 可靠保留并进入任务线资源；不用客户端镜像充当权威，不新增 schema/migration。退出确认、版本/事件、槽位释放和原暂存结局受现有 task/attempt/epoch 事务围栏约束；不能先发布终态再补证据。恢复先完成当轮重验/清扫，再开放槽位与处置；损坏台账不抛成成功、不清 pending。未知副作用/needs_review/ACK/安全重试规则零放宽。
3. attempt 命名空间不复用，结果引用与实际产生的 attemptId 匹配；不将普通目录表述为 OS 隔离。三种回收分支与暂存成功/失败都提交原结局，旧 attempt 的晚到观察不得关闭/发布新 attempt。
4. 在这一后端候选中全局切换响应/错误/事件/快照/设置/工作根等信封到 web-api/2，不能在 V1 下启用新保证。已核服务共享版本出口在 manual-items-service，static-files 的 404 另有硬编码，需要一起核对；历史注释不要求机械替换。SSE task.changed 含 attemptExitState；快照按冻结 §6.1 全字段/epoch/高水位、settings 真实 version、workspace/generatedAt 同形，顶层兼容并发字段同源，保留既有重连围栏。
5. 真实服务/HTTP＋合成根验证已登记幸存者/pending/组或 argv 退化全部否决、退出后正控释放、重启回收、终态不早发布、失败原结局、旧 attempt/条目版本/缺 ACK 拒绝、结果分段门、所有版本出口与 V2 样例同形。对改变的行为先红后绿，不改 TERMINAL 轮询集合或放宽其它旅程；20s 含清理，存储构建前置单列。

**测试/交付域**：沿必要既有 task lifecycle/recovery/authority/queue/http/events 聚焦文件补回归，必要新增 `tests/unit/attempt-exit-consumer.test.mjs`、`tests/integration/attempt-exit-consumer.test.mjs` 及 `tests/fixtures/web-text-intake/exit-consumer-*`；本人 `docs/reviews/web-text-intake-exit-consumer-20261111-claude.md` 与 `build/mayne35-exit-consumer/`。版本预期按冻结 V2 有据调整，冻结 fixtures 本身不改。依赖只用现有库/工具，不改 package/锁、Rust/DDL/守卫、Runtime/vendor、前端、公共索引/product05、main/远端/真实凭据或用户根。

执行受影响语法、聚焦回归、docs/diff；结构/文档守卫结果如实留证，旧基线红不伪记绿。只交一份本地 SHA/tree、必要来源/最小修改差分、可复跑输入与实际 TAP/HTTP/存储只读观察/清理/哈希后停止。不是最终 E 交付，不跑完整 check/19 旅程、不发布部署。候选到达后未参与者独审，再接前端 API2 判别与诚实文案；MAYNE-37 的 D 浏览器实现/验收字节保留，不能被 E 覆盖。统一组合与 main 接收仍归 MAYNE-34。

MAYNE-35 保留 in_review 表示部分已审且后继在继续；不再因已关闭的 producer P1 退回，也不提前关闭本卡。本轮仅新增本复审记录；实际后继派工通过本轮唯一最终评论，并读回触发结果确认。
