# MAYNE-35 web-api/2 修订复审通过与接续（2026-11-11，Codex）

**结论：pass，限规范与样例。** `0c9febc5010015418a5778a49f76d4e0c01f7f9f`（tree `06adbf5095d8a265f1b6e09cade1a5918bc1fdf6`）的 F5/F6 已关闭；未发现新增 P0–P3 问题。前轮 F1–F4 的关闭结论保持。本记录不把文档通过写成 E 功能完成。

## 1. 身份、范围与冻结声明

本轮审查相对 `d78caf310cbae301f5eb5b4677207ffa2e5c69f6` 的三文件差异：V2 规范、作者实施接续表、新增 argv EPERM 样例；并重核全部 55 个样例、冻结来源与请求对应关系。修订仅统一否决原因编码、补真实章节标题及关联样例/登记；owner 已选 B(a) 的公共保证没有变化。整体退出/恢复实现仍按仓库 R3 管理；本次一致性修订不代替其后独立生产验证。

按本卡“独审通过后接续实施”的授权及 V2 §14，**冻结上述提交中的 V2 规范与 55 个样例作为后继 E 实施的精确依据**，原文件字节不重写：

- `docs/engineering/web-api-contract-v2.md` SHA-256：`449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`。
- 全部样例及文件身份由本轮附件 `SHA256SUMS-reviewed-v2.txt` 逐项固定；源提交/tree 如上。
- 升版原因：V1 的完整树退出语义改为 B(a) 登记域退出确认，增加有类型 `attemptExitEvidence`。`registry_extinct` 只证明登记域，任何已知存活者或证据不足仍否决，未登记且未发现的后代可按用户权限无界存活；工作目录与 attemptId 仅作归因纪律。
- 迁移方式：后继组合候选统一切换所有响应/错误/事件/快照/设置/工作根操作等信封为 `web-api/2`，客户端按版本判别；不得以旧 `web-api/1` 信封发布新退出保证。V1 契约与原 fixtures 冻结保留作历史来源；DDL、依赖、凭据等边界不随升版扩大。
- 此冻结是实施输入冻结，未修改运行后端、未宣布产品交付；main 接收及最终状态仍归 MAYNE-34 的实际组合验收。

## 2. F5/F6 关闭证据

**F5（原 P2）**：候选 `web-api-contract-v2.md:69/78/133` 已一致区分未执行、通用失败、OS 拒绝与命中。`performed=false` 的允许原因包含 `eperm`，明确扫描 EPERM 优先于通用证据不足；新增 `task-exit-unconfirmed-argv-scan-eperm.json` 为 `{performed:false,hits:0}`＋`unresolved`＋`veto.reason=eperm`，保持 `exited_unknown`、隐藏结果、无 decisionOptions。原未扫描/通用失败/命中三样例分别保持 `insufficient_evidence`/`insufficient_evidence`/`known_survivor`；放行所需“已扫描且零命中”未放宽。

**F6（原 P3）**：候选 `:157` 已有真实 `#### 3.5.1 权威条目版本与 ACK 规则`；正文 7 处引用及接续表可定位，规则正文没有回退为缺省版本 1/空回执。

## 3. 本轮实际核验

在任务分支 HEAD `c27f81d365cf1a6871a43ffe1c1b597ab6571666` 保持不切换，使用 `git archive 0c9febc…` 导出完整受审树。开工状态仅 AGENTS.md 平台附加内容及 `.multica/` 元数据，与本轮交付分开。

| 命令/核验 | 实际结果 |
|---|---|
| `python3 build/mayne35-api2-r2-review/verify.py` | exit 0；55/55 JSON，48 个 V1 同名＋7 个新增样例；32 个完整任务资源的证据出现规则；23 个非空证据对象（13 confirmed/10 unresolved）的必要条件、计数、否决与未知状态不可处置规则均通过 |
| F5 四种 argv 否决样例及规范原因定义 | 逐项一致；只证明合成形状，不冒称 OS 实测 |
| F6 正文标题与引用核验 | 标题存在，7 处引用可定位 |
| 原作者本轮哈希附件 | 经认证 CLI 下载，3/3 与受审提交字节一致 |
| V1 契约及原 fixtures 相对 `1e37044` | diff 零字节；契约 SHA-256 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` |
| 全部请求样例及快照 | 与 E 无关的请求语义不变；快照全字段任务形状、设置值/设置版本对应核验通过 |
| 受审完整导出树 `npm run check:docs` | exit 0，22 文件/527 本地链接 |
| `git diff --check d78caf3… 0c9febc…` | exit 0 |

检查了规格一致性、版本/回执/快照承诺、失败与恢复的文档/样例关系、残余保证边界、路径卫生。生产性能、真实 OS/HTTP、真实浏览器、打包/部署未验；本卡限定本轮不跑旧 OS 探针、完整 `npm run check` 或 19 旅程，未跑项不是退回原因，也没有被相邻文档绿证关闭。

## 4. 已授权后继的第一份有界候选：宿主登记与退出证据 producer

本卡描述已明确由 Codex 在规范独审后另派小候选。本轮给 OpenCode 一份有界生产准备增量，候选交付后另审；不另建按层拆开的子卡，不提前统一集成。派发前已读本卡/父卡及 D 的当前说明、扫描讨论并核 active：本卡只有本次 Codex，D 只有其 Codex 独审，OpenCode 无重复 active，实时名单显示 idle。

**输入**：本记录冻结的 `0c9febc…`；服务源按已审 `d70280c452038210c0ae6a60f980623de79c8d93` 的精确路径/字节取证；旧保证取舍来源 `329cf86` 保留。当前 D 候选 `8480b2e` 仍在独审，不能当已准入来源。登记实际任务分支/起点/来源 blob/hash 与写域后再修改；遵守平台分支祖先约束，不换分支、不 reset/stash，不整枝覆盖其它候选。

**本候选唯一写域**：`server/lib/worker-host.mjs`；如确需隔离纯判定逻辑，可新增一个 `server/lib/attempt-exit-evidence.mjs`；新增对应 `tests/unit/attempt-exit-evidence.test.mjs`、`tests/integration/attempt-exit-registry.test.mjs` 与 `tests/fixtures/web-text-intake/exit-registry-*`；本人 `docs/reviews/web-text-intake-exit-registry-20261111-opencode.md` 和 `build/mayne35-exit-registry/`。从已审树接入的必要来源文件逐项登记，范围外前置只报告精确路径，不夹带其它写入。

**目标**：落实已有 worker/工具 owner 帧的来源与存活期身份登记、递归 ppid 最佳努力登记及其生命周期钩子；持久化 attempt 登记与逐次 stray 观察/清扫记录；提供符合冻结 V2 的 typed 退出观察结果。真实登记来源不得由 argv 无命中反推；成员清扫必须先 proof-match，EPERM/身份不符/任何已知存活者/证据不足均否决，pending 不可被最新一轮的“未发现”覆盖。命名空间与台账归属不得复用 attemptId；这不构成 OS 隔离或完整树证明。

**接线边界**：本轮交 producer 和受控测试，不把新 B(a) 放行语义启用到旧 V1 API。现有 boolean 调用约定不得悄悄改成可被当作 truthy 的 object；新的 typed 入口与原消费者接口清楚区分。`task-service`、`task-recovery`、`task-scheduler`、`text-intake-service`、HTTP/SSE、前端/全局版本切换由后继候选串行接入，届时再验证占槽/resolve/暂存发布。该有界候选不是可独立发布的 E 功能。

**独立验收预期**：至少覆盖登记成员退出正控与仍存活反控、已登记 setsid 逃逸（GAP-5）否决、未登记且未发现逃逸的范围披露、身份不符与 PID 复用、组 ESRCH/仍存活/EPERM、argv 未扫描/通用失败/EPERM/命中、stray pending 保持与清扫后解除、台账重读不丢来源。纯判定用合成观察测试；进程登记/清扫用本候选自建合成子进程并回收，禁止真实用户进程/凭据/工作根。EPERM 若用观察适配器模拟，明确标注，不能冒称真实 OS 拒绝。新回归应能证伪逐项违反谓词的变异。

**交付与停止点**：跑直接相关的语法/聚焦测试及 docs/diff 检查，每例 20s 含自建进程清理；不重跑旧已过矩阵、旧官方/OS 探针、聚合或完整 check/19 旅程。交一个本地 SHA/tree、相对精确来源的差分、可从 clean checkout 获取的 fixtures、原始命令/计数/hash/进程回收证据实际附件后停止，交未参与者独审。零新生产依赖、Runtime/vendor、Rust/DDL、package/锁、公共索引/product05、main/远端/部署改动。遇到确需跨写域的前置，带精确差异报告，不扩大任务。

## 5. 状态与交付

规范审查已通过并按 §1 固定实施输入；E 生产与统一业务验收尚在继续，因此 MAYNE-35 保留当前步骤，不进入 done、不以文档通过合 main，也不再因 F5/F6 退回。后继派发通过本轮唯一最终评论完成；触发结果需读回确认。

本轮只新增本复审记录，未改作者规范、样例或接续表。原始输出、核验器与逐文件 SHA 清单在 `build/mayne35-api2-r2-review/` 并随任务评论附送；本机路径仅为证据留存位置。
