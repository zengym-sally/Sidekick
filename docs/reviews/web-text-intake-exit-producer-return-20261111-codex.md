# MAYNE-35：producer 独审接收与限定退回（2026-11-11，Codex）

**结论：needs_revision。** MAYNE-36 已完成的是独审任务，受审 producer `2394a245831c5d673f8692c147487ea521e9f366`（tree `913b4404c1f0f2e8a3cf5a8bc9beafef247a46fa`）未通过；不能由“全部子任务关闭”推导 MAYNE-35/E 完成。没有待提升的后续 backlog 子卡，本轮接续为修复现有 producer。

## 证据接收与本轮核验

原独审 ZCode 评论 `01a1c994-ec76-77d3-87c5-9ef8cd756006`，完成审核 Codex 评论 `01a1c9aa-8c8e-74a7-b01c-c56ed2f735fc`。两份实际附件均经认证 CLI 下载阅读，结论一致：1×P1、3×P3；MAYNE-36 的 done 保持正确，不重开审查任务。

本轮保持任务分支 `agent/codex/mayne-35`，起点 `62da66b5f36223cd6e5314d708b48024af0ceb00`。只将锁定提交的两模块导出到 `build/mayne35-producer-review-intake/input/`，以新合成输入运行 `node build/mayne35-producer-review-intake/confirm-findings.mjs`：exit 0，正控及下列缺陷见证均成立。**exit 0 表示缺陷复现成功，不表示 producer 通过。** 未启动子进程、未探测真实 PID、未执行 OS 扫描/清扫或真实用户根操作；本轮不是重复全量独审。

| 面 | 锁定对象的本轮结果 | 冻结规范要求 |
|---|---|---|
| 正控：worker/组/成员退出，argv 扫描零命中 | `registry_extinct`，validator 无错误 | 一致 |
| survivor × argv EPERM | `known_survivor`；自身 validator 拒绝 | 应遵守 argv EPERM 的 `eperm` 原因约束，仍为 unresolved |
| pending × argv null | `known_survivor`；validator 漏拒 | null 时原因必须是 `insufficient_evidence`，仍为 unresolved |
| pending × argv EPERM | `known_survivor`；自身 validator 拒绝 | 应为 `eperm`，仍为 unresolved |
| runStraySweep 读入合法 JSON、语义损坏的计数 | 实际方法在 aggregate 处抛出异常 | 与 JSON 损坏分支统一返回明确错误，拒绝清扫与出证 |

MAYNE-36 已独立复跑 24/24 原测试、fixture 残留 0，并以实际 WorkerHost 入口复现 pending+skip 的错误出证和 pending+模拟 ps 失败的抛异常。本轮引用其精确版本证据，不将这些运行声称为本轮新执行。冻结 V2 `0c9febc…`（规范 SHA-256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`）不变，不重审或改写其已批准保证。

## 分级处置

- **P1，采纳并必须修正**：`server/lib/attempt-exit-evidence.mjs:200` 起的总序不能压过冻结 §3.1.1 不变式 3；validator（约 `:330`）须拒绝 null+非 insufficient 的对象；单元测试 `:143` 的反向期望须按规范修正并补 validator 断言。`worker-host.mjs:868` 的校验闸门须能对合法退化观察返回 typed unresolved，不能靠移除校验解决。这里未见误释放，阻塞依据是核心 typed 契约与失败处理失效。
- **P3-1，采纳为同次最小修正**：`worker-host.mjs:643/644` 的 JSON 损坏与语义损坏使用同一明确错误返回路径。保留原台账，不清空累计 pending，不追加伪清扫成功，不发出 confirmed。
- **P3-2，采纳为证据更正**：相对 `d70280c` 的 worker-host 差分应为 **+672/-3**，原 +637 登记不准。更正在新修复记录中追加，不覆写旧作者历史记录或删旧失败输出。
- **P3-3，保留为后继建议**：`registerAttemptMembers` 的 sourceFrame API 守卫是未来消费者接线要求；既有调用点全为帧源，未证明当前行为缺陷。本轮不将其升级为额外阻塞或扩大生产写域。

P0/P2 未新增。既有 V1 boolean 分离、帧来源/身份登记、proof-match 后清扫、GAP-5 已登记逃逸否决、pending 单调和范围披露等已过面保留为旧锁定版本结论；修复后的必要回归仍需新证据。

## 修复交接与准出条件

按本卡项目工作流，退回 `started_2` 后由 **Claude** 接续；这是本轮明确的写域转交，原作者 OpenCode 的提交与证据保留。只启动这一条工作流接力，不另行 mention 或派发第二个实现者。派发前已核本卡只有当前 Codex active，家庭中无重复 producer 修复 run。

1. 在平台分配的任务分支保留起点及祖先；按精确路径接收 `2394a245` 的 producer 与其测试/fixture，登记实际分支、来源 blob/hash 与写域，不整枝覆盖冻结规范或其它候选，不 reset/stash。恢复基线 d70280c、D 稳定候选 8b6052b 不因本轮退回重做。
2. 生产写域仅 `server/lib/attempt-exit-evidence.mjs`、`server/lib/worker-host.mjs`；回归限原 `tests/unit/attempt-exit-evidence.test.mjs`、`tests/integration/attempt-exit-registry.test.mjs` 及确需的既有 `exit-registry-leaf.mjs` fixture；本人新增 `docs/reviews/web-text-intake-exit-registry-repair-20261111-claude.md` 与 `build/mayne35-exit-registry-repair/`。不改作者旧记录、冻结规范或样例，不改服务消费者/恢复/调度/namespace发布、HTTP/SSE/前端/全局信封、DDL/Rust/Runtime/vendor/package/依赖/公共索引/product05。
3. reason 必须优先满足 argv null/通用失败/EPERM/命中的规范约束；survivors、unobservable、stray pending 等并存事实与 detail 保留，不能通过删成员、清 pending 或假扫描消除冲突。validator 与 builder 方向一致，但回归预期必须来自冻结规范，不能只相互验证。
4. 新回归覆盖 survivor/pending × argv null/通用失败/EPERM，连同扫描成功但其它否决仍成立的对照；直接校验所有 emitted 对象。伪造 null+known_survivor 必须被 validator 拒绝；实际 WorkerHost 入口的 pending+skip、pending+模拟 ps EPERM/通用失败应返回合法 typed unresolved，不抛异常。台账合法 JSON 的语义损坏与 JSON 损坏均保持错误返回，原记录零变更。
5. 在同一新测试字节上保留修前失败/修后通过证据；复跑原 24 项及新增混合面，单例 20s 含自建进程清理，保留 V1 严格 boolean 断言。执行受影响语法、docs、diff 检查；任何结构守卫失败如实留证，不用子集绿证替代。不得重跑旧已过矩阵或扩成全 W1/完整 check/19 旅程。
6. 只交一个本地 SHA/tree、相对 producer 的最小差分、可从 clean checkout 取得的回归/fixture、原始输出/计数/源哈希/清理证明实际附件后回独审；不得自签 E 完成。没有真实凭据/用户根/模型、push/PR/部署、main 或分支清理授权。

本轮不推进消费者阶段、不合 main、不进入 done。修复后先独审，之后再接既定服务/恢复/调度、namespace 发布、V2 全信封和前端；实际最终树的新完整门禁/原样业务旅程及主线接收仍归 MAYNE-34。D/E 批准持续有效，没有新增 owner 决策问题。平台的子任务关闭规则保持不动。

本记录仅接收已完成的独审结果并界定下一次修复，不替代修复实施或其独立验证。原始附件、当前纯判定探针和输出留在本轮 build 目录并随本卡最终评论交付。
