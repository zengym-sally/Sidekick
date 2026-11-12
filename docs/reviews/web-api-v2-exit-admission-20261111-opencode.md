# web-api/2 契约候选：B(a) 退出保证的实施接续表与登记（2026-11-11，OpenCode / MAYNE-35）

## 0. 性质

本文登记 MAYNE-35 第 1 个有界交付：**web-api/2 契约候选（规范＋样例）已成稿，交未参与者独审**。本文不是验收、不是冻结、不是 E 功能完成声明；实施状态唯一来源仍是 [第一阶段实施计划](../product/05-第一阶段实施计划.md)，本记录只登记本轮候选与后继实施的接续安排。

## 1. 授权与输入身份（本轮已逐项复核）

| 输入 | 身份 | 本轮核验 |
|---|---|---|
| owner 授权 | MAYNE-17 评论 `01a1c890-956e-7b11-9745-cd5717ee7fc2`「D批准；E选B(a)」 | 决策申请 `01a1c884-b4a1-741a-9b1e-24d3be5c2fe6` |
| 完整决策包 | 附件 `01a1c884-b296-77c0-b2b1-fb8f1a3be747` | 下载重算 SHA-256 ＝ `9f29189ee8ada5ee170f76855a422b847e42638122d2e3971dc9bc6c60d2e647`（与卡上登记一致） |
| E 差异包（r4） | 提交 `329cf86f95fdf57184cbf266b55af51c711b4633` | 包内副本 SHA-256 `ea620194…eee08b6` 与 `329cf86` blob 逐字节一致（diff 为空）；提案文件同验一致（`408ab54e…da0689`） |
| V1 冻结契约 | `docs/engineering/web-api-contract.md` | 在树 SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`（与 E 包冻结锚一致）；本轮零字节改动 |
| 已审恢复候选 | `d70280c452038210c0ae6a60f980623de79c8d93`（独审 `a177d924`） | 仅按精确路径读取 `recoveryFor`/`resolve`/`confirmExit`/`acknowledgedReceiptsOrRefuse`/`RECOVERY_ITEM_CAUSES`，把其权威条目版本＋ACK 语义显文化进 V2 §3.3/§3.5.1/§4.5；未整枝合并、未重跑其矩阵 |
| 快照已核事实 | `cd28027` 快照对照记录＋`c7fa655` 只读独审（MAYNE-32 面） | 完整 I `cd08588` 处理器 `:853-879` 水位优先＋200 页全量走查、`:161` 路由、顶层 `agentConcurrency` `:832`；R2 `170f611` 客户端对 `WireSnapshot.agentConcurrency` 零下游消费者；`task.changed` 线帧与样例一致、`settings.changed` 嵌套差异在册——V2 §6.1 据此定同形目标，不以"无消费者"删承诺 |
| GAP-5 定义 | `d70280c` 的 `docs/reviews/web-text-intake-c2c5a8-forensics-20261109-zcode.md` §2 | lingering-tree 夹具＝E1 类 setsid 逃逸的真实暴露面（`verifyTree` 假 TRUE）；V2 下的正反控见 §4 |
| 前端/SSE 谱系 | UI `29f2ac8`、SSE 客户端 `170f611` | 仅作派生面谱系锚登记，本轮不合并、不改其文件 |

工作树身份：平台分配独立 worktree，分支 `agent/opencode/mayne-35`，基点 `59fac8c`（tree `77a54859…df7cb`，与 main `1e37044` 的 tree 相同——main 仍 `1e3704432e7014f1e23b40e9aff9791662e9c6f5/tree77a548591ac9b02a51936c806bf4f85d774df7cb`，只读取证）。完整登记见 `build/mayne35-api2-contract/admission.json`（登记先行于产物写入）。

## 2. 本轮交付清单

| 交付 | 路径 | 说明 |
|---|---|---|
| V2 规范 | `docs/engineering/web-api-contract-v2.md` | 完整可实施规范：`web-api/2` 全信封、登记域谓词（§3.2.1）、`attemptExitEvidence` 有类型证据与六条不变式（§3.1.1）、诚实文案与禁用文案（§3.1.2）、状态机/回收/resolve 门、权威条目版本与 ACK 无回退（§3.3/§3.5.1/§4.5）、快照同形目标（§6.1）、V1→V2 逐触点映射（§15）；§4.6 安全路由明确零变更 |
| V2 样例 | `tests/fixtures/web-contract-v2/`（55 文件＝48 个 V1 同名对应＋7 个 V2 新增独立否决样例） | 信封全部 `web-api/2`；23 个任务资源形状携有类型证据（`registry_extinct` ×13、`unresolved` ×10，覆盖 registered-survivor/stray-pending/group-EPERM/group-survivor/argv-hit/argv-not-performed/argv-scan-failed/argv-scan-eperm/insufficient_evidence 各否决面与 found/swept/pending 披露面）；快照样例含规范 `settings` 块＋兼容顶层 `agentConcurrency`（同源同值）；SSE 样例 `task.changed` 帧携 `attemptExitState`；请求语义与 E 无关处零改动 |
| 实施接续表 | 本文 §3–§5 | producer/consumer/fixtures/文档/测试路径、语义与判据、预定 owner、并行/串行依赖、GAP-5 正反控、独立预期清单 |
| 证据 | `build/mayne35-api2-contract/`（gitignored） | `admission.json`、生成器与核验脚本、核验输出、SHA256SUMS、逐文件差异摘要 |

机械核验（本轮全部实际执行，原始输出在 `build/mayne35-api2-contract/`）：
- 55/55 文件 JSON 解析通过；其中 48 个与 V1 目录 1:1 同名对应，7 个为本轮新增独立否决样例；
- 版本对应：V2 全目录零 `web-api/1` 残留；V1 目录＋冻结契约 `git status` 零字节改动；
- §3.1.1 六条不变式对 23 个证据对象逐一断言通过（含 `registry` 恒等式、`treeExtinctProven` 字面量 `false`、veto 形状、`unresolved` 必有阻塞面、`argvScan` 已执行且零命中为 confirmed 必要条件、`strayLedger.pending>0` 必否决、argv 失败原因集合与 EPERM 优先级）；
- §3.5.1 小节真实存在，7 处正文引用可定位；
- 12 处退出相关旧文案（"process tree"类）已换为登记域口径，断言无残留；
- `npm run check:docs` exit 0（22 文件、527 链接，含新增规范与样例全部相对链接）。

## 3. 实施接续表（后继生产候选的路径、判据与预定 owner）

写域列是**路径级**的：同文件两行＝重叠，必须串行；不同文件可并行。判据列是验收锚，实施候选的独审按此点对点复核。

| # | 面 | 生产/测试路径 | 改动语义 | 判据（可证伪） | 预定 owner | 依赖 |
|---|---|---|---|---|---|---|
| 1 | 帧注册与登记集 | `server/lib/worker-host.mjs`（`WorkerHost` 帧注册：`worker start/end`＋`mcp owner`；`verifyTree`/`confirmExit` 登记集）、`server/lib/task-scheduler.mjs`（attempt 生命周期钩子：cancel/deadline/stopAll/退出）；台账落 `runs/<runId>/worker.json` | 注册进程集：帧来源＋存活期递归 ppid 登记；无 DDL、**无 Runtime 改动** | 已登记成员可按身份追溯；钩子触发时登记完整；E1 反例（§4）不得在登记中缺失；**不承诺任何派生后代必被登记**，未登记逃逸按 stray 台账披露 | E 生产候选（MAYNE-35 后继，协调层另派） | 与 #2–#5 同候选；与 D-33 无文件重叠，可并行 |
| 2 | `verifyTree` 收窄＋`registry_extinct` 判定 | `server/lib/worker-host.mjs`（`verifyTree`/`confirmExit` 收窄）、`server/lib/task-service.mjs`（`confirmExit` 判定） | 谓词＝worker 退出 ∧ 组 ESRCH ∧ 注册集逐成员 proof-matched ∧ argv 已执行且零命中；否决四因（known_survivor/insufficient_evidence/identity_mismatch/eperm）＋stray `pending>0` | V2 §3.1.1 六条不变式在真实判定输出上成立；已知存活者/组或 argv 否决/`pending>0` →`exited_unknown` 占槽、resolve 409 | 同上（同一候选） | 依赖 #1；文件与 D-33 的 task-service 候选直改**重叠→串行**（D 稳定后接入） |
| 3 | 退出证据上线域 | `server/lib/task-service.mjs`（资源组装/recoveryFor）、`server/lib/http-server.mjs`（信封 `contractVersion=web-api/2`） | `attemptExitEvidence` 进线域；`web-api/2` 全信封切换（不只 tasks 端点）；SSE `task.changed` 增 `attemptExitState` | 线域资源含证据成员且随状态出现/null；`task.changed` 帧含 `attemptExitState`；样例（本轮 fixtures）与真实 HTTP 同形 | 同上 | 与 #2 同文件串行；与 MAYNE-30 后继的 `server/lib/http-server.mjs` ACK 接线（`acknowledgedReceipts` 形状/覆盖）**重叠→串行** |
| 4 | 恢复扫描重验＋清扫登记 | `server/lib/task-recovery.mjs`（`TaskRecovery.recover()`）、`server/lib/task-service.mjs`（`confirmExit`/`recoveryFor` 回收迁移） | 重启扫描重验登记域谓词；stray 台账逐次登记 found/swept/pending＋证据范围；`exited_unknown` 回收迁移证据 | 重验不成立保持占槽；清扫逐次可审计；回收后证据 `confirmedAt` 更新且 `registry_extinct` 不可逆 | 同上 | 依赖 #1/#2；与 D-33 无重叠，可并行 |
| 5 | 归因纪律（命名空间＋attemptId） | `server/lib/text-intake-service.mjs` 暂存/发布路径 | attempt 命名空间永不复用；产物引用携带 attemptId（`result://<attemptId>/<name>` 已具形，收口为守卫） | 新 attempt 必出新命名空间；产物引用可按 attemptId 归因；无"复用/覆盖旧目录"路径 | 同上 | 与 D-33 的 apply/直改路径**重叠→串行**（D 的三操作族接线稳定后） |
| 6 | 派生面：客户端与前端 | `src/lib/web-api-client.ts`（快照/信封判别）、前端四文件（31 谱系：TaskQueue 等）、SSE 消费 | 按 §6.1 同形目标消费：`settings.version` 做 CAS、顶层 `agentConcurrency` 仅兼容展示、`attemptExitState`/证据驱动诚实文案（§3.1.2 禁用文案清单） | UI 无"树已全部退出/已证明完整"类文案；`exited_unknown` 行禁用处置并显示占槽；快照/设置端点版本同源消费 | 前端归属成员（31 谱系接续，协调层派发） | 依赖 #3 落地后切换；UI 面与 #2–#5 可并行开发、串行接入 |
| 7 | 测试接续：II 套件 T-6 类判据显式重写 | `tests/integration/web-text-intake-queue.test.mjs`（SIGKILL exit-unknown 用例）、`tests/unit/web-text-intake-recovery.test.mjs`（回收判定） | 按 V2 §3.2.1 把期望从保守 `exited_unknown` 改为**谓词的显式判定结果**（成立→放行；不可证→`exited_unknown`）；判据文本必须写明谓词依据 | `TERMINAL` 轮询集合与 `needs_review` 观测不变；改写后的用例在"注册成员存活"反例下仍红 | E 生产候选（随 #2 同候选交付） | 依赖 #2；**不得仅改期望值签通过**（§5 独立预期 10） |
| 8 | 测试接续：V2 样例接线 | `tests/fixtures/web-contract-v2/`（本轮已交付）→ 契约断言测试 | 新断言以 V2 规范＋本轮样例为独立预期来源（字段/状态/证据/错误） | 断言失败可追溯到规范条目；样例与真实 HTTP 一致性在组合轮核对 | E 生产候选 | 依赖 #3 |
| 9 | 文档接续 | 冻结记录＋`docs/reviews/README.md` 索引行＋product05 状态 | V1→V2 升版声明（§14）；索引与状态登记 | 冻结记录含迁移方式；product05 不把规范候选当功能完成 | 队长（冻结宣布方） | 依赖独审通过 |
| 10 | D（MAYNE-33） | `src-tauri/migrations/004…`＋D 三操作族接线 | **不在本候选**：按 owner 已批 D 范围独立实施 | D 自身申请面判据 | Claude（MAYNE-33） | 与 #2/#3/#5 重叠文件串行：**D 稳定 → E 接入** |

**并行/串行结论**：#1/#4（worker-host 登记集与恢复扫描）与 D 无文件重叠可立即并行；#2/#3/#5 与 D-33 的 `task-service`/`http-server`/`text-intake-service` 重叠，必须**在 D 服务改动稳定后串行接入**，不整枝合并覆盖；#6/#7/#8 依赖 #3 的线域形状落地，开发可并行、接入串行。原 30/31 已过矩阵与 SSE R2 11 面不重跑；最终组合的完整门禁与 19 旅程归 MAYNE-34 在最终实际版本统一执行，不能重用 web-api/1 旧绿证。

## 4. GAP-5 在 B(a) 新保证下的正反控（不得仅改期望值签通过）

GAP-5 原反例：`protocol-worker-process.mjs` 孙进程 `detached:true` 自成组、argv 不含 `--run`、worker 退出后被重父化使直子核查空转——三重检查全盲，`verifyTree` 假 TRUE，生产在孙进程仍存活时 `exited_confirmed`（旧契约下这是误释放缺陷）。V2/B(a) 下该场景拆成两个**都必须成立**的控制面：

- **反控（必须红/不得误释放）**：孙进程在存活期内被 ppid 链**登记**、清扫/确认时仍存活 → 判定必须 `unresolved`（`veto.reason=known_survivor`、`registry.survivors` 非空）、`exited_unknown` 占槽、`resolve` 409 `exit_unconfirmed`。若实现输出 `registry_extinct`，即为缺陷——期望值不是"从 unknown 改成 confirmed"，而是**绑死在谓词上**：注册成员存活 ⇒ 否决。等价负控：把登记步骤从实现中变异删除后，该场景退化为"未登记残余"，若仍输出 `registry_extinct` 且无台账披露，则变异未被反控捕获。
- **正控（必须绿/如实放行＋披露）**：同一孙进程被登记后**已退出** → `registry_extinct`、槽释放、`residual.strayLedger` 记录本次清扫 found/swept/pending 与证据范围；若逃逸后代**从未被登记**（首次观察前已逃逸），谓词成立放行属 B(a) 的**登记域残余**语义，放行同时必须有台账披露面——`found=0` 不得写成"已证明无残余"。
- **独立否决面（F2/F3/F5）**：组观察 EPERM、组仍存在但登记成员已退出、argv 命中、argv 未执行/失败（含被 OS 以 EPERM 拒绝，记 `eperm`），均须输出 `unresolved`＋占槽＋409，不得伪记为某个登记成员不明；对应样例 `task-exit-unconfirmed-group-eperm.json`、`task-exit-unconfirmed-group-survivor.json`、`task-exit-unconfirmed-argv-hit.json`、`task-exit-unconfirmed-argv-not-performed.json`、`task-exit-unconfirmed-argv-scan-failed.json`、`task-exit-unconfirmed-argv-scan-eperm.json`。
- 对应样例：`task-exit-unconfirmed-noncancel.json`（registered-survivor 否决面）、`task-needs-review-exit-reclaimed.json`（回收＋found/swept 披露面）、`task-result-reclaimed-needs-review.json`（回收＋found/swept/pending=0 披露面）、`task-exit-unconfirmed-stray-pending.json`（pending=1 的已知存活残余否决面）。四条预期互相独立，任何一条单独通过不构成其它三条的证据。

## 5. 独立预期清单（后继验收逐项断言，不照现实现推期望）

1. **残余披露**：每次恢复扫描（及确认时补充清扫）逐次登记 found/swept/pending＋证据范围；`none`（found=0）不等于不存在；台账为审计面。
2. **已知幸存者否决**：注册集内 proof-matched 存活成员 ⇒ `unresolved`＋占槽＋resolve 409；不得按超时/多数推定放行。
3. **EPERM/身份不匹配拒绝**：观察、argv 扫描或清扫被 OS 拒绝（`eperm`）、身份无法 proof-match（`identity_mismatch`）各为独立否决因，不得静默改写为已确认/已清扫；argv 扫描因 EPERM 失败时 `veto.reason=eperm`（优先于通用 `insufficient_evidence`）。
4. **逃逸反例（E1/GAP-5 类）**：观察间隔内 setsid 逃逸——已登记者走否决面，未登记者走残余披露面（§4）。
5. **重启扫描**：恢复扫描必须重验谓词＋重跑清扫，不得复用上次判定；回收迁移后 `registry_extinct` 不可逆。
6. **终态不早发布**：`resultPendingExit=true` 期间任何读取不得见终态或终态结果；确认与终态同一事务提交。
7. **分段读取**：`offset/limit` 纪律、`done=true`/累计 `totalBytes` 完成条件、失败结局不分段——语义与 V1 相同，作为独立断言保留。
8. **ACK 门**：`acknowledgedReceipts` 非字符串数组 → 400；`resume` 未覆盖全部 `verifiable=true` 权威回执 → 400；缺省空回执/缺省版本 1 不得构成有效 CAS/ACK；歧义待核对行（多条 pending）→ 两入口拒绝且不暴露 `itemVersion`。
9. **样例/真实 HTTP 一致性**：V2 样例（含快照同形目标、证据字段、`web-api/2` 信封）与真实 HTTP 响应逐形状核对——独立组合验收，本轮样例不冒称已实测。
10. **判据改写纪律**：T-6 类期望值改写必须绑定谓词文本（§3 接续表 #7）；「现套件判据严于冻结契约」的旧争议不构成放宽其它测试的授权。
11. **全局版本切换**：`web-api/2` 出现在全部信封（任务资源、事件、快照、错误、设置、工作根操作、结果读取、`stream.ready/reset`），不只单个 tasks 端点。

## 6. 超出 B(a) 的公共保证变更：无

本轮对快照同形目标（§6.1）的收敛是把 V1 已承诺散文＋冻结样例成员显文化（MAYNE-32 已核事实内的技术收口，无承诺删减、无新增保证）；若独审认定任何条目超出 B(a) 授权或 V1 既有承诺，按差异报协调层，不在本候选内自行选择。

## 7. 边界（如实）

- 本轮只写：`docs/engineering/web-api-contract-v2.md`、`tests/fixtures/web-contract-v2/`、本文、`build/mayne35-api2-contract/`（gitignored）。生产、Runtime/vendor、Rust/DDL、package/锁、守卫、`docs/reviews/README.md` 公共索引、product05、他人记录：零字节。
- 未运行：官方来源/OS 探针、聚合、完整 `npm run check`、19 旅程、任何行为套件；未做实际 E 生产实现；未重跑 30/31/32 已过矩阵。`check:docs` 与机械核验为本轮全部验证面。
- 仅本地候选提交（`agent/opencode/mayne-35`），不合 main、不清分支、不推送、无远端 PR、不部署；未安装 helper/VM/新依赖；未读真实凭据/用户根/模型。
- V1 契约文件与 V1 fixtures 冻结字节保留为历史来源（git 零改动已断言）；001/002/003 DDL 冻结不动；D 的 004 不在本候选。
- 本文交付后交**未参与此稿的** ZCode 或 Kimi 独审；独审通过前不得按 V2 开工改生产，也不得宣布冻结。
