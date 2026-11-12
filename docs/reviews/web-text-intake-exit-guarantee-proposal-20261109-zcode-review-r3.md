# 退出保证提案 r3 限定独审（ZCode，2026-11-09）

- **对象**：`ae3e10f37484455f996d080e837c7f568837e547`（tree `01d490bf3b0314cf48b2fcc80c0972c3107626fd`，父 `099fc57`），恰 `docs/reviews/web-text-intake-exit-guarantee-proposal-20261109.md` 一文件 +77/−29（对象库 `git diff --numstat` 直读复核）。
- **派发**：协调评论 `01a1be13-17e1`（锁定 `ae3e10f`）；作者修订说明 `01a1be0f-6a3f`。审前材料：本审 r2 记录（`web-text-intake-exit-guarantee-proposal-20261109-zcode-review.md`，提交 `c05e545`）。
- **范围**：只审 §12 五组修改面及受影响论证；O-1…O-13、E1/PC-G/PC-H 探针、r1 裁定等未改来源沿 r2 已过结论复用，未重跑探针、未重复全轮。本轮新验材料（O-14 line-exact、XNU 过滤语义、23eb1a1 Runtime entry 行核验）存 `build/web-text-intake-exit-guarantee-proposal-review/r2/`（本机，gitignored）。
- **性质**：决策材料复核。不签生产候选、不采纳 A/B、无任何实施或授权效力；不申请权限；未跑完整门禁。

## 0. 结论

**通过（限定范围）＋一处必要更正（N-1，§7 矩阵「可信 test 面」行）**。P-1／P-2／P-3／mcp_ack 四组更正全部核实成立；§7 路径矩阵结构与裁定口径正确，但其「可信 test 面」行以「无锚」概括不准确——登记树内存在已核的输入侧结构事实，须按三级证据分列登记。该更正只改提案行文与锚点登记，不改停车结论（结论仍由通用裁定支撑）。

## 1. P-1（MAJOR，A-UID 完整保证定位撤去）——成立

- 完整性分级标注在场（§4-A-UID 节首）：「**受限保证**——对自愿逃逸类完整；对 setuid-exec 提权类不完整；补齐前不作为保完整义务方案列出」。§4 结论「A-UID 本版降级为受限保证（P-1），不再列为保义务方案」、§6 表列名「A-UID（受限保证，r3/P-1）」、§8「（setuid-exec 类残余除外）」、§10-③、§11 同步到位——完整保证定位确实撤去。
- 构造段收窄为「uid 无 root 不可**自愿**变更」，补「域空不再蕴含树灭绝」；「残余披露」段在场：「实际风险低」标注为**未验证推断**，补齐方向标注为新增授权／有损通道且本提案不引入；验证设计把该类列为已知残余＋正控形态、不设反控通过条件——与 r2 审 P-1 要求逐条对应。
- **O-14 独立复验（line-exact）**：本机 SDK `share/man/man2/execve.2` 在场，原句「If the set-user-ID mode bit of the new process image file is set (see chmod(2)), the effective user ID of the new process image is set to the owner ID of the new process image file.」与锚表引用一致；同页确认 ruid 不变。`setuid.2` 在场（自愿边界）。
- **承载语义补锚（本审新增，非必要更正）**：O-14 证明 euid 被内核改写，而该残余成立还取决于 `KERN_PROC_UID` 按 **euid** 过滤。XNU `xnu-11215.81.4` `bsd/kern/kern_sysctl.c:752-769` `sysdoproc_filt_KERN_PROC_UID` 用 `kauth_cred_getuid()`（effective uid），相邻 `sysdoproc_filt_KERN_PROC_RUID` 用 `kauth_cred_getruid()`（real uid）——区分刻意、方向正确：setuid-exec 幸存者（euid→0、ruid 不变）确离枚举域。建议提案 §12 锚表补此源；即便不补，提案自设的正控形态（域内 exec setuid-root 程序并使其驻留→枚举漏计）也会在验证期暴露任何反例，故不构成送审阻断。

## 2. P-2（MAJOR，比较集非穷尽＋共享 VM／每 attempt 域）——成立

- 非穷尽声明四处独立在场：§2 小结（「本提案比较集不声称穷尽」）、§4 引言（登记族清单替代「只有两个」）、§10-①（「至少五选一，比较集非穷尽」）、§11。「macOS 上真正满足 §3 的构造只有两个」确已撤回。
- A-VM-NS 三类标注分离正确：**官方能力**＝VZ entitlement（O-9）与 pidns 语义（O-11）各有官方来源（两者均为 r2 审已核来源，复用成立）；**架构推断**＝「组合构成 §3 满足构造」整体未证，且点名宿主经 vsock／串口对 guest 内域做恢复期重枚举的观测通道形态；**未验证成本**＝镜像管线、guest 域生命周期、每 attempt 容器开销、启动延迟、跨 VM 模型调用路径，不给数字。三类边界与 r2 审 P-2 要求一致。
- A-VM 成本标注解除外推（「基建跃迁最大」收窄为仅「每 attempt 一整 VM」形态，且与本形态的数字双双标注未验证）；§6 表增列与各行改述自洽；§10-① 选向集合至少五项。
- 相对定位（资源曲线优于 A-VM、与 A-NS 同源）标注为架构推断级的从属判断，未冒充实测——通过。

## 3. P-3（MINOR，安装期管理员授权）——成立

「安装期：root LaunchDaemon 的注册／装载需管理员授权／用户确认（SMAppService 注册 consent）」补入 §4-A-UID 新增权限段；§6 表「新增 OS 权限」行、§10-③ 同步——三处在场，与 r2 审 P-3 要求一致。

## 4. mcp_ack 归类——成立，与 r2 审裁定一致

- §10 原第 5 项确已删除；§10 前言块与 §7-2 改述为「runtime `mcp-control.mjs:22` 已实现并等待校验、5926cbc server/lib 0 处写入＝**原 I 既有接线缺口**，属候选 I 现有授权写入范围内可闭合项，不是 owner 授权项；owner 帧证据的语义前置；闭合仅限 server/lib worker-host 回写，不扩 W2」——与本审 r2 §7 裁定逐点一致，无混写回潮。
- 本轮独立复测：`git grep -rn mcp_ack 5926cbc -- server/` = 0 处；`mcp-control.mjs:22` 校验字段（frame.type/runId/hostNonce/action/expected）与提案引用一致。

## 5. §7 路径矩阵——结构与口径正确；一处必要更正（N-1）

**正确面**：三行矩阵（实际 bash 面／实际 MCP 面／可信 test 面）按「已核结构锚／探针／依据类型」分列；bash／MCP 面的 detached 组长锚与探针家族沿用已核结论；两面的触发可达性如实标注未验证；「所有 attempt 必停车」明确由通用裁定（r1 主裁定＋`01a1bd87`）支撑、不由 F-3 外推；口径分叉段按 `01a1bd87` 标注域严格读不作为实现基础，引用「ZCode 独审 §6」属实（该节即域严格读否决的登记处）；§8/§11 同步到位。

**必要更正 N-1：「可信 test 面」行的锚点登记不准确（派发已点名核对项）**。

该行现写「**无跨组 detached 后代锚**。唯一已核的通用 spawn 形状事实：worker-host :251…」＋「无探针」。两点不准确：

1. 「唯一已核」不成立——登记树 `23eb1a1` 的 Runtime entry（`organizer-entry.mjs`，blob `9414f23f`，提案前言既登记锚）存在**已核的输入侧结构事实**，与该面的「无工具／无 MCP」刻画直接相关：`:63` kind 白名单＋snapshot.provider/model＋apiKey 协议校验；`:114` `request.kind!=='test'` 为 useTools 合取项；`:115` `tools=!useTools?[]:…` 空工具集（连 bash 工具包装都不构造）；`:116-117` MCP 分支仅允许 trial/extract/revise，test＋MCP → `RUNTIME_PROTOCOL` throw（fail-closed）。另：`:109` managedBash 宿主对象虽无条件构造，但派生是**惰性**的（`managed-bash.mjs` `:12-14` 构造仅建闭包，`:20` detached spawn 在 `operations.exec` 内）——无工具 attempt 不派生任何 bash 进程。现成代码分支不能写成没有锚点。
2. 这些结构事实同样**不足以签该面的完整退出**：它们是运行时入口的输入侧处理，不是「服务端沿真实调用链保证 kind/snapshot/MCP 输入派生一致」的端到端证明，也不是可达性证明。按派发口径分三级登记：
   - **已有结构事实**（上列行，已核，登记树内）；
   - **可信路径完整证明**：服务端派生保证——**未核**，属沿 server/lib→worker spawn 帧真实调用链的欠账；
   - **可达性／无其它派生面**：双向未验证（架构推断）。

   矩阵停车结论**不变**：仍由通用裁定支撑（证据不足即 unknown 保留）；通用 unknown 是证据不足时的执行落点，不代替路径特异性核验——矩阵应把这三级写清，而不是以「无锚」概括。

**更正方式**：只改 §7 矩阵第三行（及 §11 相应半句）的行文——把上列结构锚登记进「已核结构锚」列、按三级分列依据类型、保留「无探针」与「停车由通用裁定支撑」不变。作者交付评论（`01a1be0f`）中「可信 test 面**无锚**、无探针」的概括应随之更正为「无 detached 后代锚、无探针；输入侧有已核结构锚，服务端沿链保证未核」。属文字与登记面更正，无需重跑探针。

## 6. 引用与登记一致性抽查

- 前言/§12 引 ZCode 独审文件路径、议题评论 id（`01a1bdf9-460b`／`01a1bdfb-b508`）——相符。
- §12 锚表行项复核：worker-host `:251`/`:282`、task-recovery `:80`/`:84-86`（与 r2 审登记 :86-88 为相邻行，两种描述皆实）、O-14 来源在场——精确。
- r2 已审事实（O-1…O-13、探针）声明原样复用、未重跑——与派发一致，且 O-14 作为新锚未混入「r2 已审」清单——登记诚实。

## 7. 边界

本轮只读：未改提案／生产／测试／Runtime／DDL／权限／D；未实施、未装 helper／VM；未重跑探针；未跑完整 check；未调用真实模型／凭据／用户根。新验行摘录、r3 patch 与身份记录存本机 `build/web-text-intake-exit-guarantee-proposal-review/r2/`。MAYNE-24 保持 in_progress。
