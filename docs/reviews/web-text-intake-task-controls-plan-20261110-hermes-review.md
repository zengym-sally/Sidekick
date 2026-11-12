# TaskQueue 任务控制方案 `9d520861` 独立独审（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c250`。对象：`agent/opencode/mayne-24` 提交 `9d5208616cdfee05662a30e6e6e6fc4fba55aebe`（恰 1 文件 `docs/reviews/web-text-intake-task-controls-plan-20261110-opencode.md`，blob `dad97783732fd201e3aeaf82098c2c06ffc1755f`，SHA-256 `cf472285b92e2c22…`＝作者登记值，192 行）。本审未参与编写；逐源事实核查全部对 `5233e01` 在树文件、`git show cd08588`／`b190f7c` 提取件独立完成（task-service/recovery 提取件逐行读）。

## 结论：**通过（方案足以实施）**——五项待证点逐项裁定如下，附三处澄清

## ① `itemVersion ?? 1`／缺回执→空数组的镜像：成立

- 服务端 resolve 校验（task-service ~606–614，本审逐行核）：`internal.inputRef?.recovery?.itemVersion ?? 1` 对 `expectedVersion`；回执 `?? []` 后按 `verifiable !== false` 门控 resume 否则 400——与方案 §3.2 客户端窄类型守卫镜像同源。
- 线对象 `recoveryFor`（~338–353 核）：`receipts: inputRef?.recovery?.receipts ?? []`；`itemVersion ?? 1` **仅在 `exited_unknown` 分支出现**，`exited_confirmed` 分支只有 `decisionOptions:['resume','cancel']` 无 itemVersion——与方案 §4.3 矩阵（处置按钮仅 `exited_confirmed`、resolve 时按 §3.2 回退取 1）自洽。
- 镜像不是实现崇拜：两侧读**同一权威源** `inputRef.recovery`，未来切片填充后客户端无需改码（方案原话成立）。
- **澄清（登记）**：当前实现 `inputRef.recovery` 从不写入（grep 全树仅读；`recovery_items` 表虽有带版本行，但 **CAS 源是 `inputRef.recovery.itemVersion` 而非该表**——故今日 resolve CAS 实际恒过（1===1），是「空转 CAS」。方案 §3 已如实写出（「现实现…恒为 1」「两端口径一致才构成有效 CAS」）；其安全行为与真实前置明确：权威字段缺位时两侧同回退、无错误放行面；CAS 有意义的前提=未来切片填充 `inputRef.recovery` 并以其为唯一写源。
- **更正（2026-11-10 追记，协调 `01a1c26d`；本条安全结论被实测否定，旧文保留于上）**：上句「无错误放行面」**不成立，撤回更正**。ZCode 有界诊断（`e361be7`，探针 SHA `6b17383c…`）与本审独立复放（自有 `cd08588` detached 树＋登记二进制 `5311ffa3…`＝ZCode 独立构建同哈希，双构建互证；面型 10/10 一致：9 DEFECT／1 CONFORMS，exit 1）坐实：冻结 web-api/1 §3.3/§3.5/§12 明定 resolve 校验**权威表 `recovery_items.version`** 并暴露已知回执（样例 `task-needs-review-exit-reclaimed.json` 的 `itemVersion:2`＋`decisionOptions` 并存），而受审字节以从未写入的 `inputRef.recovery ?? 1/[]` 校验——**空转 CAS 恰恰就是错误放行**：权威条目版本注入推进到 2 后，旧请求 `expectedVersion=1` 在两入口（普通 resolve／`commitStagedResume`）均被接受且写入（后者直接发布暂存结局）；真版本请求反被 409 假冲突；真实 verifiable 回执在 `side_effect_receipts` 在库但 wire `receipts=[]`、客户端无从 ACK，缺 ACK resume 照常重入队。既有任务行 version/attempt 事务围栏（F2 PASS）约束任务行竞争，与条目生命周期正交，不能替代条目校验。反转原因：本审原以「两侧回退一致」推安全，漏掉了契约要求校验的是**权威表**而非「实现内部一致」——一致地绕过权威表本身就是违约。取证边界照协调层登记：服务层实测（真实 TaskService/TextIntakeService/TaskRecovery＋真实存储二进制＋业务路径到位），ServiceError→状态码映射为代码读证（http-server 注册表 `validation_failed:400`/`version_conflict:409`/`state_conflict:409`，本审复核）而非实际 HTTP 取证；探针状态注入唯一且标注（`UPDATE recovery_items SET version=2`，无 inputRef 补假值——本审逐行审计探针源码确认）。UI 前置继续保持未闭合；修复独审待 ZCode 候选交付另派，本更正不预签修复。

## ② 新配置修订来源／快照绑定／attemptCount 时点：成立，附一处时点澄清

- 修订来源**独立有据**：`writeModels`（PUT /api/models）响应携带 `{configuration}` 含新 `revision`（web-api-client 538–541 核），models store 持 `configuration.revision`（pair/expectedRevision 机制，models.ts:23 核）——方案 §4.2 的 newRevision 来源是契约自身的保存响应机制，非「当前实现读法」的循环论证；启用三条件（store 就绪、值存在、≠行内 `task.configRevision`）+退化普通重试明确。
- 快照绑定：服务端 retry 时刻 `snapshotFor()` 重解析、修订未变保原快照（http-server 790 语义核）、客户端永不上送快照（retry SQL `input_ref=?` 重置为服务端给值，task-service 585 核）——RS-1 成立。
- failure-code 限制逐字核：非 `auth_or_config_invalid`/`config_revision_unknown` 换修订即 409 `config_revision_change_not_allowed`（567–570）✓。
- **澄清（登记）**：`attemptCount`＝`task_attempts` 行计数（243–247 核），**在调度器认领时点递增，不在 retry 事务内**（retry SQL 只 `version=version+1`、重置 budget，不碰 attempt_count）。方案「重试后 +1 可观测」为最终可观测但受认领时点门控——实施时 UI 不得在 202 即断言 +1；U1 的红例设计（`attemptCount 不再变化`）不受影响。

## ③ 结果白名单／暂存门控／摘要深度：成立，深度按 §9.3 保持开放

- 白名单逐字核（670–680）：仅 `succeeded`，或 `needs_review`+`resultPendingExit=1`+`exited_confirmed`+cause=`result_exit_unconfirmed` ✓；failed 结局仅整读不支持分段 ✓。
- 回执门控与服务端 400 校验同口径；「暂存 resume 专线」（`commitStagedResume`：成功发布 staged 候选、失败删除）与 U3 的双路径互斥反例（发布→收件箱可见／放弃→不可见）在该可观察量上**可证伪** ✓。
- 摘要深度：标题级紧凑摘要＋「发布后于收件箱核对完整内容」注记是**契约门控之上的最小充分显示**——冻结契约的核对硬门是回执确认与白名单，显示深度是 UX 决策；方案 §9.3 已自列「升为分段完整内容展示」为可冻结修订单列项。裁定：不阻塞；建议冻结时保留该开放项。
- U1–U8 可证伪性：UI 面走新聚焦单测（本地 fetch 包装层先答未脚本化面、零改动已接收 harness 字节）＋另派浏览器旅程；服务端红例（U2/U4/U5 直连 HTTP）登记为 II 集成面既有职责——分层合理。**一处限制（登记）**：U8 窄屏「640px 无横向滚动」需真实布局，最小渲染器不可测——只能由浏览器旅程证明，方案 §7 已如此归层。

## ④ 围栏与异步归属：成立

三道既有围栏（分页全量/请求序/epoch）原样保留；**动作响应体不安装进队列状态**（只清 pending 键＋围栏化读回）是最严格的归属纪律；per-task `pendingAction` 同任务互斥；卸载置 `mounted=false`、await 续体触状态前检查、在途 HTTP 不中断；错误永不改列表；organizer 草稿按候选 id 存活、任务控制不清 drafts。乱序/跨 epoch/卸载三面均有归属。焦点回落/aria-live/键盘可达在单测层验事件语义，窄屏布局归旅程（见上）。

## ⑤ 挂载可达性与写域：成立，附一处归属更正

- **完整产品路径可达**：完整 I `cd08588` `Workbench.vue:19` import、`:162` `page==='inbox'` 挂载 TaskQueue——组件在真实产品路径上；工程树 Workbench 未 import 属谱系装配缺口，方案 §8.3.2 以 PrerequisiteGap 登记而非「不可达」——框架正确。
- **归属更正（登记，非阻塞）**：方案 §8.3.1 称「TaskQueue.vue 属 OhMyPi 四文件独占写域」——该归属已过时：`01a1c180` 第 3 条／`fdf89c1` 已把 OhMyPi 三路径（含 TaskQueue）在本包范围内**明示转移给 OpenCode**（R1 的 TaskQueue 75 行修订即 OpenCode 作者）。按协调层本轮口径（写域按 `01a1c180` 等后继转交核对、过期 OhMyPi 归属不构成授权阻塞），实施派发归协调者裁定，方案自身未自签亦未自授权——保守登记不构成缺陷。

## 未验项

方案为计划文本，无运行行为可验；§8.2 新单测与浏览器旅程未实施（实施轮交付后另审）；II 集成面既有服务端红例未复跑；ZCode 快照形状核对（并行任务）结论不在本审范围。逐源核查提取件（task-service/recovery）为本审 build 证据。

## 边界

原方案/生产/package 零改动；仅新增本记录与 build 附件；未跑聚合、构建、19 旅程或完整 gate；最小事实核查（git show 提取＋逐行读）无运行树遗留。MAYNE-24 保持 `in_progress`；E/D、GAP-5 与整体准出边界不变。
