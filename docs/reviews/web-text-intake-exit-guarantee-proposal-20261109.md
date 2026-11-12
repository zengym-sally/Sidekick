# MAYNE-24 退出保证决策提案：attempt 隔离（保义务）vs 契约修改（改义务）（2026-11-09，OpenCode）

## 1. 范围与基点

- **派发**：协调评论 `01a1bd64-6187-7573-8b65-2361b928ceea`（2026-11-08，Codex 协调 run）——OpenCode 继续**只做可审的决策提案，不实施**：给出保持完整退出义务所需的最小 attempt 隔离方案（A），与明确修改退出保证的契约方案（B）分别比较；列本机 macOS 可用性、跨平台边界、精确生产／Runtime／构建改动与新增权限、验证办法、对 W1 正常旅程及旧库恢复的实际影响；OS 能力与权限断言用官方来源核实；明确现授权内保守接线能完成什么、哪些正常任务仍会停车；材料含反例／正控脚本与输入哈希，交未参与者独审后再把真正属于 owner 的差异送审。**不顺手申请权限、不动现 004/D 申请、不处理其他工作树遗留进程。**
- **前提裁定**：`docs/reviews/web-text-intake-identity-adjudication-20261109.md`（r1）——原 I 范围内不可证完整（E1 端到端反例）；本提案在 r1 基础上把「完整性怎么买回来（A）」与「要不要完整性（B）」两个 owner 决策做成可比较、可验证、可授权的形态。
- **裁定源与生产锚**：候选 I 第七轮 `5926cbc81422f550bdd9db253e794ca1e0b6f1b6`（tree `2c7bfae6…`），`server/lib/worker-host.mjs` blob `cfdd335468d52673d1c65cb8123f5d1bf90ba78f`（内容 SHA-256 `817591ec…5ae81`）——本轮探针再次直 import 该 blob 原字节并在运行时复算哈希（零转录）。Runtime 锚（本树 `23eb1a1` tree 内）：`managed-bash.mjs` blob `8efb358d…`、`bash-worker.mjs` `b2212ef6…`、`mcp-guardian.mjs` `5f8d1a6f…`、`organizer-entry.mjs` `9414f23f…`、`managed-mcp.mjs` `2f752b7b…`。
- **本记录性质**：决策提案。不签任何候选通过、不改冻结验收文本、不实施、不新增恢复错误名、不改 Runtime／DDL／守卫／依赖。MAYNE-24 保持 in_progress。
- **r3 修订（2026-11-09）**：按限定独审（ZCode `c05e545`，`docs/reviews/web-text-intake-exit-guarantee-proposal-20261109-zcode-review.md`，该文件在其作者分支 `agent/zcode/mayne-24`；议题评论 `01a1bdf9-460b`）与协调派发（评论 `01a1bdfb-b508`）窄修五面：P-1（A-UID setuid-exec 域外残余→降级为受限保证）、P-2（共享宿主 VM＋guest 内每 attempt 域补列＋比较集非穷尽声明＋官方能力／架构推断／未验证成本分类）、P-3（安装期管理员授权／用户确认补记）、mcp_ack 移出 owner 差异清单（改登记为原 I 既有接线缺口）、§7 按路径证据矩阵。修订面清单见 §12；r2 已审事实（O-1…O-13、探针 E1/PC-G/PC-H）原样复用，未重跑、未实施。
- **r4 修订（2026-11-09）**：按 ZCode r3 限定独审（提交 `24960e4` 于 `agent/zcode/mayne-24`，评审记录 `docs/reviews/web-text-intake-exit-guarantee-proposal-20261109-zcode-review-r3.md`；议题评论 `01a1be2c-c92d`）与协调派发（评论 `01a1be33-775f`：P-1/P-2/P-3 成立、N-1 仍须收口）**仅收口 N-1**：§7 矩阵「可信 test 面」行按「已有已核结构事实／尚缺端到端完整证明／双向可达性未验证」三级分列，并把登记树内已核的输入侧结构锚（`organizer-entry.mjs` kind／工具／MCP 入口处理＋`managed-bash.mjs` 惰性派生）补进「已核结构锚」列；作者交付评论（`01a1be0f-6a3f`）「可信 test 面无锚、无探针」的概括同步更正为「无 detached 后代锚、无探针；输入侧有已核结构锚，服务端沿链保证未核」；另按 r3 审建议补登 XNU euid/ruid 承载语义锚 O-15（**转引登记**：由 ZCode r3 审核验，本修订未独立复验该源文件，§2/§4/§12 标注复验状态）。停车结论、探针状态（仍无）、口径分叉与 D／004 状态均不动；未重跑探针、未实施。修订面见 §12 r4 块。

## 2. OS 能力与权限断言——官方来源核实清单

全部断言逐条落到官方来源（本机 Apple SDK 头文件与 man 页＝Apple 官方发行物；man7.org＝kernel 官方 man-pages 发行物；developer.apple.com／learn.microsoft.com＝官方文档站）：

| # | 断言 | 官方来源 | 原文要点 |
|---|---|---|---|
| O-1 | 进程组信号域：负 pid（非 -1）＝向该进程组全体发信号；非 root `kill(-1)`＝同 uid 全体 | Apple SDK `share/man/man2/kill.2`（本机） | 组信号与 EPERM 语义；`-1` 的 uid 语义是 A-UID 清扫的原语基础 |
| O-2 | 组／会话成员资格**自愿**：非会话组长可随意 `setpgid(0,0)` 建新组；仅目标是会话组长才 EPERM；fork+setsid 可脱离任意会话（组长不能 setsid，但任何子进程都不是组长） | Apple SDK `man2/setpgid.2`、`man2/setsid.2`（本机） | 两条 man 页的错误清单＝逃逸通道的官方依据 |
| O-3 | 枚举原语按域完整：`KERN_PROC_ALL/PGRP/SESSION/TTY/UID/RUID/PID` 选择子存在于 Darwin | Apple SDK `sys/sysctl.h:436-443`（本机） | 按 pgid／session／**euid** 枚举是内核选择子——域内枚举完整 |
| O-4 | Darwin 无 `NOTE_TRACK`；EVFILT_PROC 只有 `NOTE_EXIT/NOTE_FORK/NOTE_EXEC/…`，按 pid 预先挂接 | Apple SDK `sys/event.h:261-267`＋`man2/kqueue.2`（本机） | **修正 r1**：r1 写「kqueue NOTE_TRACK 无特权但有损」——NOTE_TRACK 是 FreeBSD 词汇，Darwin 没有；Darwin 等价物（对已知 pid 挂 NOTE_FORK）既有队列丢失也有挂接面不全，同样**有损**，结论不变、机制名修正 |
| O-5 | macOS 无 prctl/procctl：无 PDEATHSIG 类机制 | 本机无 `man2/prctl`、无 `man2/procctl`；`PR_SET_PDEATHSIG(2const)` STANDARDS 栏「Linux」（man7） | 父死传信号在 macOS 无原语；Linux 的 PDEATHSIG 也只覆盖直接子、父先死不发、fork/setuid-exec/凭据变更即清除——孙代无覆盖 |
| O-6 | spawn 属性可用：`POSIX_SPAWN_SETSID`、`POSIX_SPAWN_CLOEXEC_DEFAULT` | Apple SDK `sys/spawn.h:61-62`（本机） | host 侧spawn 形状可控，但不改变自愿成员资格 |
| O-7 | sandbox-exec 已废弃；App Sandbox 是 app 级静态沙箱 | Apple SDK `man1/sandbox-exec.1`（本机）：「DEPRECATED」逐字 | macOS 上不存在受支持的「每次 spawn 动态沙箱」公开路径 |
| O-8 | EndpointSecurity 需向 Apple 申请 entitlement | developer.apple.com `com.apple.developer.endpoint-security.client` 页：「**You must request this entitlement from Apple**」；缺失时 `es_new_client` 返回 `ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED` | 供应商级审批（MDM/AV 类），非本产品可自行取得；另有新的 `es_new_descendants_client`（仅后代范围客户端）——同样以该 entitlement 为前提 |
| O-9 | Virtualization.framework 需 `com.apple.security.virtualization` entitlement；macOS 11+；官方支持 Linux guest | developer.apple.com Virtualization 框架页＋entitlement 页（「`VZVirtualMachineConfiguration.validate()` 检查 entitlement」） | 标准 code-signing entitlement（自主签名可配，非 Apple 审批类），与 O-8 的「须申请」是两类 |
| O-10 | root 级组件的官方形态：LaunchDaemon 以 root 运行，由 app bundle 经 SMAppService／SMJobBless 注册 | developer.apple.com ServiceManagement 框架页（「LaunchDaemons: … which runs as root」） | A-UID 的权限跃迁落点：root 级常驻组件＋分发级签名身份 |
| O-11 | Linux pid namespace 完整性：「若命名空间的 init 终止，内核经 SIGKILL 终止该命名空间内全部进程」；成员资格在进程创建时固定、不可更改；setns 只能进当前及后代 | man7.org `pid_namespaces(7)` | Linux 上存在无特权（配 user ns）的完整性原语——完整性义务在 Linux 是可持续的 |
| O-12 | netlink 既**有损**又**受限**：「内核到用户可靠的传输不可能……socket 缓冲满则消息被丢弃（ENOBUFS）」；「仅 euid 0 或 CAP_NET_ADMIN 可收发 netlink 多播组」 | man7.org `netlink(7)` | **修正 r1**：r1 写「netlink proc connector 无特权但有损」——官方原文是多播收听默认需特权；proc connector 属 NETLINK_CONNECTOR 族。无论特权与否，有损已足以否定其作完整性证明 |
| O-13 | Windows Job Object 是内核强制的包含域：关联后「不能被打破」（默认）；子进程默认入 job；breakaway 仅当 job **所有者**设置 `BREAKAWAY_OK`/`SILENT_BREAKAWAY_OK`；`TerminateJobObject` 杀全体；`KILL_ON_JOB_CLOSE` 句柄关闭即杀全体 | learn.microsoft.com「Job Objects」（Win32） | Windows 存在廉价完整性原语；三平台边界：Windows=Job、Linux=pidns、macOS=无 |
| O-14 | setuid-exec 提权通道：新进程映像文件带 set-user-ID 位时，内核在 exec 时把新映像的有效 uid 置为该文件属主——进程**不经任何自愿 `setuid(2)` 调用**即改变 euid | Apple SDK `man2/execve.2`（本机）：「If the set-user-ID mode bit of the new process image file is set … the effective user ID of the new process image is set to the owner ID of the new process image file」 | P-1 的官方锚（r3 补）：按 euid 枚举的域可被 exec 一枚 setuid-root 二进制跨出（§4-A-UID 残余）；自愿 `setuid(2)` 边界另见本机 `man2/setuid.2` |
| O-15 | `KERN_PROC_UID` 按 **effective uid** 过滤、`KERN_PROC_RUID` 按 real uid 过滤——两选择子刻意区分 | XNU `xnu-11215.81.4` `bsd/kern/kern_sysctl.c:752-769`：`sysdoproc_filt_KERN_PROC_UID` 用 `kauth_cred_getuid()`，相邻 `sysdoproc_filt_KERN_PROC_RUID` 用 `kauth_cred_getruid()`——**ZCode r3 独审 §1 复核（评论 `01a1be2c-c92d`）；本修订转引登记，作者未独立复验该源文件** | O-14 的承载语义补锚（r4 补，r3 审建议）：setuid-exec 幸存者 euid→0、ruid 不变，确离按 euid 过滤的 `KERN_PROC_UID` 枚举域（§4-A-UID 残余的内核侧依据） |

**小结**：事件源类（ES、NOTE_FORK、netlink/auditd/eBPF）无论特权与否都有损或不可得（O-4/O-8/O-12），**没有一个事件源能买完整性**；只有「包含域」构造能买（O-11/O-13 及 §4 登记的 macOS 构造族——**本提案比较集不声称穷尽**，§4／§12-P2）。与 r1 R-3 结论一致且更精确。

## 3. 问题形式化：「完整退出证明」需要的域性质

冻结契约要求 attempt 终局前证明其**整棵进程树**死亡。机械地，这要求每个 attempt 有一个包含域 D 满足：

1. **成员强制**：树内任何后代都不能自愿脱离 D（否则 §2 O-2 类逃逸永远存在）；
2. **空性可观测**：「D 为空」或「D 已死」是单次可查事实（枚举选择子或单事件），不是推断；
3. **生命周期可行**：D 可按 attempt 创建／销毁；且 **host 崩溃后 D 仍可被重观察**（恢复面，r1 F-6 的弱项）。

现有机制对照：进程组／会话（1 不满足，PC-G 实证）、argv/注册集（非域，只是观察集）、事件源（2 不满足，有损）、macOS 上不存在满足 1 的公开原语（O-2/O-5/O-7）。**满足 1–3 的只有包含域构造**——这是 A 类方案的充足理由，也是 B 类方案（放弃性质 1 的证明、接受残余）的对立面。

## 4. 方案 A：保持完整退出义务所需的最小 attempt 隔离

A 类的共同形态：为每个 attempt 建一个真包含域，退出确认＝「域空／域死」这一单事实。r1 的「组＋注册集已核实灭绝」**不是** A——那是缩小窗口的观察，不是域。macOS 上的 §3 构造登记如下（**比较集不声称穷尽**，P-2；每条标注「官方能力／架构推断／未验证成本」）：A-UID（本版降级为**受限保证**，见节内标注）、A-VM（每 attempt 一整 VM）、A-VM-NS（共享宿主 VM＋guest 内每 attempt 域，P-2 补列）、以及 Linux 方向的 A-NS。

### A-UID：每 attempt 专用 OS uid ＋ root 生命周期助手（macOS 最小改动路径）

> **完整性分级（r3/P-1）**：**受限保证**——对自愿逃逸类（setsid/setpgid/双 fork，O-2）完整；对 setuid-exec 提权类（O-14）**不完整**。在引入对应完整性机制补齐该类之前，A-UID 不作为「保完整义务方案」列出，只能按「受限保证＋显式残余」参与比较。

- **构造**：attempt 进程全部运行在专用数字 uid 下（无需目录条目；`HOME`=attempt 目录）。spawn 走 root 助手（LaunchDaemon，SMAppService 注册，O-10）；清扫＝按 `KERN_PROC_UID` 枚举（O-3，域内**完整**）＋逐 pid SIGKILL 循环直至枚举为空——**空性由 syscall 语义直接给出**，且 uid 无 root 不可**自愿**变更（绕不过 O-2 类自愿逃逸：逃逸进程仍是该 uid）。**但该边界只覆盖自愿通道**：exec 一枚 setuid-root 二进制由内核在 exec 时提升 euid（O-14），逃逸进程随即离开 `KERN_PROC_UID` 枚举域（O-15：枚举按 euid 过滤——幸存者 euid→0、ruid 不变，故离域）——**域空不再蕴含树灭绝**。该类需模型代码刻意调用受权 setuid 程序并使其驻留（日常 sudo 无凭据即败——「实际风险低」属**未验证推断**，不是证明），它是 A-UID 域外的真实残余通道。重启恢复：**uid 跨 host 崩溃存活**，新 host 直接重枚举同一 uid——性质 3 完整满足，r1 F-6 的恢复盲区按构造消失。pid 复用安全：复用者不持 attempt uid。
- **残余披露（r3/P-1）**：A-UID 的空性单事实对「uid 域内全灭」是 syscall 事实，对「整树灭绝」只在自愿逃逸类下成立；setuid-exec 类幸存者既不在枚举域内，也不被本方案任何域内机制观测——唯一补齐方向（exec 面 ES 类事件源、或 exec 前后的 uid 重枚举窗口）本身是新增授权／有损通道（O-8/O-4 类），本提案不引入。验证设计须把该类列为**已知残余**（正控形态：域内 exec setuid-root 程序并使其驻留→`KERN_PROC_UID` 枚举漏计），不列入「反控通过」条件。
- **生产改动（精确清单）**：新增 root 助手二进制＋plist（**新 binary＋分发签名身份变更**——违反当前「不改 Cargo.toml／锁／新 binary」冻结，即明确的新授权项）；`server/lib/worker-host.mjs` spawn/sweep 路径改走助手（IPC 鉴权用现有 hostNonce/attempt token 形态）；`runtime/` 零改动（organizer 原样在 attempt uid 下运行）；`runs/<runId>/worker.json` 增 `uid` 字段（无 DDL）；attempt 目录属主改共享组＋setgid 使 host 可读结果。
- **新增权限**：root 级常驻组件（O-10 类）＋Developer ID 签名／公证分发链（当前 ad-hoc 签名不够装助手）；**安装期**：root LaunchDaemon 的注册／装载需管理员授权／用户确认（SMAppService 注册 consent）——与运行期助手权限、签名链并列的分发前提（r3/P-3 补记）。
- **验证办法**：正控＝UID 域内做 E1 同款 setsid 逃逸，清扫后 `KERN_PROC_UID` 枚举必空、确认退出；反控＝E1 类探针在 A-UID 下**不得**释放（叶被枚举到、被杀、域空才确认）；恢复正控＝杀 host→重启→重枚举 uid→发现幸存者→清扫→同根重启不假确认。
- **W1 旅程影响**：用户可见旅程不变；attempt 启动多一次助手往返（毫秒级）；3 并发＝3 个 uid，无资源问题。**旧库恢复**：无 schema 变更；存量 `exited_unknown` 行的原 attempt uid 不存在→按契约既有的 unknown／人工 resolve 路径保留，不被新机制追溯确认。

### A-VM：每 attempt 一个 Linux 微虚拟机（macOS 零特权路径，基建跃迁最大）

- **构造**：Virtualization.framework 起 Linux guest（O-9），organizer＋managedBash＋guardian 全在 guest 内跑；attempt 域＝VM 本体：VM 停止／进程消失＝全树死（guest 内甚至可用 pidns 双保险，O-11）。逃逸面＝VM 边界外不可达（进程意义上的逃逸按构造不存在）。
- **生产改动**：guest 镜像构建管线（Linux Node runtime＋Pi bundle 入镜像）；host-guest 传输（VZ vsock，官方 Sockets 设备）；Rust/ObjC 宿主模块接入 VZ（**Cargo 依赖变更＝授权项**）；`build-backend.mjs` 增镜像装配；app 包体＋镜像体积、每 attempt 内存（数百 MB ×3 并发）、attempt 启动延迟（秒级）。
- **新增权限**：`com.apple.security.virtualization` entitlement（O-9，标准签名 entitlement，**无 root**）；无 Apple 审批。
- **验证办法**：VM 停止完整性正控（guest 内 daemonize 后停 VM→guest 进程全灭）；E1 类探针在 guest 内复跑→逃逸仍困于 VM→确认以「无 VM 进程」为准；资源/延迟预算实测入 II 类套件。
- **W1 旅程影响**：UI 旅程不变；attempt 延迟与资源占用显著上升；受控模型服务调用需经 guest 网络栈（NAT）。**旧库恢复**：无 schema 变更；同 A-UID 的存量 unknown 处理。
- **成本/比较标注（r3/P-2）**：「每 attempt 一整 VM」是 VM 族的最贵形态；共享宿主 VM＋guest 内每 attempt 域（下节 A-VM-NS）资源曲线更优——故「基建跃迁最大」只对本形态成立，不外推到 VM 族整体；本形态与 A-VM-NS 的资源／延迟数字均**未验证**。

### A-VM-NS：共享宿主 Linux VM＋guest 内每 attempt namespace 域（r3/P-2 补列；架构推断级）

- **构造**：单个 macOS 宿主 Linux VM（Virtualization.framework，entitlement 同 A-VM／O-9）；guest 内为每个 attempt 建独立 pidns（＋userns）域——O-11 语义在 guest 内生效：域 init 死＝内核 SIGKILL 全员、成员资格创建时固定、setns 仅限当前及后代（性质 1）。空性在 guest 内单事实可观测（性质 2）；宿主侧兜底＝VM 本体死即全灭（单事件）。恢复：域 id／VM 句柄登记于 `runs/<runId>/worker.json`（无 DDL），host 重启后重连 VM 重枚举（性质 3）。
- **分类标注（r3/P-2 要求）**：官方能力＝VZ entitlement（O-9）与 pidns 语义（O-11）各自有官方来源；**架构推断＝「两者组合构成本机 §3 满足构造」**——组合整体未经探针或文献直接证明，尤其宿主经 vsock／串口对 guest 内域做恢复期重枚举的观测通道形态；**未验证成本＝镜像管线、guest 内域生命周期管理、每 attempt 容器开销、启动延迟、跨 VM 模型调用路径**——本提案不给数字。
- **生产改动（推断级，不逐项展开）**：同 A-VM 的镜像＋vsock＋宿主 VZ 模块（Cargo 依赖变更＝授权项），另加 guest 内 init/agent 的域生命周期管理；若 owner 选向此族，再出精确清单与验证方案。
- **相对定位**：资源曲线优于 A-VM（一次 VM 启动、每 attempt 一个廉价容器）；域原语与 A-NS 同源（O-11），该族同时是 Linux 方向的自然过渡形态。

### A-NS：Linux 宿主上的 pid+user namespace（未来 web/backend 目标的原生路径）

非本机可用，登记为方向事实：Linux 上 `unshare(CLONE_NEWUSER|CLONE_NEWPID)` 无特权建域，init 死＝内核 SIGKILL 全员（O-11）。**含义**：退出完整性义务在 Linux 是廉价的、可持续的；macOS 是唯一昂贵的平台。这直接影响 `docs/engineering/web-backend-design.md` 方向下的长期架构选择—— obligation 不必在 Linux 上放宽。

### A 类结论

**不存在「现授权内的小改动」满足 §3**——r1 已裁定，本轮用 O-1…O-14 把「为什么」钉死到官方来源。「保完整义务」构造族＝A-VM（每 attempt 一整 VM）与 A-VM-NS（共享宿主＋guest 内每 attempt 域，架构推断级）；**A-UID 本版降级为受限保证（P-1），不再列为保义务方案**。三者的 OS 权限／基建跃迁形态各异，均需 owner 单独授权；**本比较集不声称穷尽（P-2）**。均不可由 I/II/III 任何成员顺手实施。

## 5. 方案 B：明确修改退出保证的契约方案

B 类不买域，改定义：退出确认不再宣称「树完整灭绝」，改为**有类型证据的收敛判定**，并给残余风险一个显式的生命周期。

### B-min：`registry_extinct`（注册集已清扫）作为新的诚实终局证据

- **确认谓词**（提案文本，措辞由 owner 定稿）：一方事实的 worker 退出 ∧ attempt 组 ESRCH ∧ 注册集逐成员 proof-matched 确认全灭（帧来源＋存活期登记，P3 语义）∧ argv 扫描无命中（仅补充信号）。命名必须诚实：`registry_extinct` ≠ 「树已证明灭绝」——E1 类（观察间隔内完成全部派生链死亡的 setsid 后代）仍可能存在。
- **发布／占槽政策**（三个选项，owner 选）：(a) `registry_extinct` 即释放槽＋发布已通过完整性校验的暂存结局；(b) 释放槽但结局保持 needs_review；(c) 不释放（＝现状，B 无增益）。**本提案推荐 (a)**，前提是下面四项伴随义务同时成立。
- **伴随义务 1：attempt 域文件命名空间**——attempt 目录永不复用，产物引用携带 attemptId：幸存者最多污染**已退役**的目录，无法腐蚀后继 attempt 的输出；这是「未知副作用不盲重试」在 B 下的替代防线（域隔离替代死亡证明）。
- **伴随义务 2：stray 台账**——清扫动作与结果（found/killed/none＋成员身份）落 `runs/<runId>/worker.json`（无 DDL），每次恢复扫描重复执行；台账是审计面，不是完整性声明。
- **伴随义务 3：凭据残余的显式量化与封口**——本机生产形状实测：apiKey 只在 organizer 内存（`organizer-entry.mjs:108` resolve 回调），managedBash 仅用于输出 redaction（`managed-bash.mjs:23-27`），真实命令 shell `stdin:'ignore'`（`bash-worker.mjs:20`）→ **bash 后代不构成 apiKey 泄漏面**；**真实可继承秘密面＝MCP server env**（`mcp-guardian.mjs:65` `env: p.env`＋`organizer-entry.mjs:121` sensitiveValues）——逃逸的 service 后代**永久持有**配置进 env 的敏感值直到用户在上游吊销（PC-H Case A CONFIRMED；无任何域内机制能收回已继承的 env）。B-min 必须二选一并写进契约：(i) MCP server 配置不得携带 secret env 值（引用化），或 (ii) 显式接受该残余并披露吊销责任。未来任何把秘密放上可继承 fd 的新 spawn 形状，必须先「读完再派生」（PC-H Case B2 防线 CONFIRMED）。
- **契约层受影响面（全部 owner-owned，本提案不动）**：退出确认定义（冻结 §202/§217 的 `exited_unknown` 边界）、取消完成语义（`registry_extinct`＋stray 台账 vs 现行已核实退出）、冻结 W1 验收旅程措辞（「取消/退出核实」步骤在 B 下按残余接受放行）、操作者可见状态命名（是否引入新公开 verdict 名——含 UI 面与 SSE 面；本提案不发明错误名，只标注该决定属于契约修订）。
- **B 的诚实性质**：B 用「域隔离＋台账＋吊销责任」换掉「死亡证明」，把 E1 类从「停车」变为「有界残余」。**B 不恢复完整性，它放弃完整性声明。** 可回退：B 的 worker.json 台账与命名空间纪律在 A 落地后仍有效（A 的域空证明可以叠加在 B 的纪律上）。

## 6. A vs B 对比

| 维度 | A-UID（受限保证，r3/P-1） | A-VM（保义务） | A-VM-NS（保义务，r3/P-2 推断级） | B-min（改义务） |
|---|---|---|---|---|
| 本机 macOS 今天可用 | 技术可行，需 root 助手（新授权＋安装期用户确认） | 技术可行，需镜像/vsock 基建（新授权） | 架构推断（组合未实测）；成本未验证 | **可立即**（服务层语义＋worker.json，无新依赖） |
| 完整性 | **受限恢复**（自愿逃逸类域空＝syscall 事实；setuid-exec 类域外残余，O-14） | **恢复**（VM 死＝单事件） | 恢复（O-11 于 guest 内生效；组合整体为架构推断） | 不恢复——改为接受有界残余 |
| 跨平台边界 | Linux 可用同名机制；Windows 用 Job Object（O-13）更廉价 | Windows/Linux 有更廉价原生域（Job/pidns） | 域原语与 A-NS 同源（O-11），为 Linux 方向过渡形态 | 三平台语义一致（都是「接受残余」） |
| 生产/Runtime/构建改动 | 助手二进制＋worker-host spawn/sweep＋目录属主；runtime 零改 | 镜像管线＋vsock＋宿主 VZ 模块（Cargo 变更）＋build-backend | 镜像管线＋vsock＋宿主 VZ 模块＋guest 内域管理（推断级清单） | server/lib 语义＋worker.json 字段＋契约修订文档 |
| 新增 OS 权限 | root LaunchDaemon（含**安装期管理员授权／用户确认**）＋分发级签名（O-10） | `com.apple.security.virtualization`（O-9，无 root） | 同 A-VM entitlement（O-9，无 root） | 无 |
| 验证办法 | UID 域逃逸正控／E1 反控／重启重枚举；setuid-exec 类列为已知残余正控（不设反控通过条件） | VM 停止完整性正控／guest 内 E1 | guest 内 init 死全灭正控＋宿主恢复通道（推断，须先设计验证） | E1 反例转为「残余接受」用例；命名空间/台账/秘密封口用例（II 面可写） |
| W1 正常旅程 | 不变，attempt 可确认（setuid-exec 类残余除外） | 不变，attempt 延迟/资源升 | 不变（推断），attempt 延迟低于每 attempt VM | 旅程放行（daemonize 类不再停车），残余按台账披露 |
| 旧库恢复 | 无 DDL；存量 unknown 不追溯确认 | 同左 | 同 A-VM | 无 DDL；存量 unknown 的处置措辞属契约修订（owner） |
| 残余风险 | root 助手=新攻击面（须鉴权）；助手故障=新可用性依赖；**setuid-exec 类幸存者**（O-14） | 资源/延迟；镜像供应链 | guest 供应链；宿主-观测通道未验证 | 幸存者持有继承 env 秘密（MCP 面，PC-H A）；attempt 域内文件写；无凭据外呼 |
| 授权层级 | owner（新 binary＋签名） | owner（新基建） | owner（新基建） | owner（契约修订）＋队长（实施面） |
| 与未来 Linux 方向 | 平移（同名机制） | 降级为不必要（pidns 原生） | 过渡形态（pidns 同源） | 若 Linux 落地则 B 的放宽**不必要**——O-11 使义务可持续 |

## 7. 现授权内保守接线能完成什么、哪些正常任务仍会停车

**能完成**（Claude 后继增量范围，r1 R-5＋队长 `01a1bd64` 指示）：帧注册（`worker start/end`＋`mcp owner`，零 Runtime 变更）＋存活期递归 ppid 登记（挂 cancel/deadline/stopAll/退出钩子）＋`verifyTree` 语义收窄为「组＋注册集已核实灭绝」（true 不得当树完整性发布）＋注册幸存者 proof-matched 清扫＋`recover()` 收紧（组＋注册集）——全部落 `worker.json`，无 DDL、无 Runtime 改动、无新权限。覆测预期：**E1 重放必须不再误释放**（叶 setsid 逃逸→组外且未注册→收窄后的 verifyTree=false→`exited_unknown` 占槽）——这是保守接线的核心验收，E1 探针可直接当反例用。

**仍会停车**——精确到形态：
1. **setsid 类逃逸的 attempt**：E1 形态（观察间隔内派生→祖先全灭）。日常 shell 的 `nohup x &` **不**逃组（仍在 W 的组，组杀可达）；真逃逸需要显式 `setsid`/`setpgid`/双 fork（python `os.setsid`、node `detached`、perl `setpgrp`——模型代码完全可能写出）。这类 attempt 按裁定**保持 `exited_unknown` 占槽**直到人工 resolve——并发槽被逐个吃掉后队列减速/停摆，只能靠人工 resolve 解锁。
2. **身份依据缺失/陈旧/不可读的 attempt**：host 崩溃窗口、worker.json 损坏、帧缺 ack 回路（F-5：runtime `mcp-control.mjs:22` 已实现并等待 `mcp_ack` 校验，而 5926cbc 的 server/lib **0 处**写入——**原 I 既有接线缺口**，属候选 I 现有授权写入范围内可闭合的实现缺口，不涉 Runtime／OS 权限／DDL，**不是 owner 授权项**（r3 修订：移出 §10 清单）；未闭合前 owner 帧身份证据端到端不可用，是 owner 帧证据的**语义前置**。闭合仅限 server/lib worker-host 回写，不新增 W2 配置／工具入口）。
3. **MCP 面的未登记 pid**：MCP service/cleaner pid 不在任何帧里（r1 F-4）——若它们逃出 guardian 组，登记只能靠存活期扫描撞上；撞不上即停车。
4. **重启面的残余**：恢复收紧后，重启只能核实组＋注册集；重启前已 setsid 逃逸且从未被观察的后代，仍然永久不可见（r1 主裁定，本轮 O-2/O-4/O-12 官方化）。

**停车结论按路径举证（r3 修订；不以单一结构断言代替可达性证明）**：

| attempt 路径 | 已核结构锚 | 探针 | 停车结论的依据类型 |
|---|---|---|---|
| 实际 bash 面（attempt 内真实命令执行） | bash worker 为 detached 组长（`managed-bash.mjs:20`，`detached:true`，blob `8efb358d`） | E1（逃逸形态可测量）、PC-G（组纪律≠包含） | 结构锚＋探针家族支持「组内证据不能闭合该面」；「真实 attempt 会调用 bash」依赖配置与模型行为，**未验证** |
| 实际 MCP 面（配置并触发 MCP 的 attempt） | guardian 为 detached 组长（`managed-mcp.mjs:27`，blob `2f752b7b`），guardian 自身 env 干净（:26）；service/cleaner pid 不入帧（r1 F-4）；ack 回路未闭合（F-5，见上） | PC-H Case A（env 继承面实证） | 同上：结构锚已核；触发可达性**未验证** |
| 可信 test 面（受控模型服务的 test 任务，无工具调用／无 MCP 服务） | **无跨组 detached 后代锚**（r4/N-1 概括更正：非「无锚」）。spawn 形状事实：worker-host 以 `detached:true` spawn Pi 运行时（`worker-host.mjs:251`，blob `cfdd3354`，`detached: process.platform !== 'win32'`）——attempt 根进程为自组组长，根组长自身退出即可空其组，**不构成** bash/MCP 面那种跨组成员问题。**输入侧已核结构事实（r4/N-1 补登记，均为运行时入口处理、登记树内已核）**：`organizer-entry.mjs`（blob `9414f23f`，前言既登记锚）:63 kind 白名单＋`snapshot.provider/model`＋apiKey 协议校验；:114 `request.kind!=='test'` 为 `useTools` 合取项；:115 `tools=!useTools?[]:…` 空工具集（连 bash 工具包装都不构造）；:116-117 MCP 分支仅允许 trial/extract/revise，test＋MCP→`RUNTIME_PROTOCOL` throw（fail-closed）；另 :109 managedBash 宿主对象虽无条件构造，但派生是**惰性**的（`managed-bash.mjs` blob `8efb358d` :12-14 构造仅建闭包、:20 detached spawn 在 `operations.exec` 内）——无工具 attempt 不派生任何 bash 进程 | **无探针** | 按 r4/N-1 三级分列：①**已有已核结构事实**＝上列行（运行时入口的输入侧处理，登记树内已核，本修订只读对象库复读一致）；②**尚缺端到端完整证明＝服务端沿真实调用链的 kind/snapshot/MCP 输入派生一致保证未核**——属沿 server/lib→worker spawn 帧调用链的取证欠账，不能以入口结构事实代签；③**双向可达性未验证**＝「本面不存在其它派生面／触发可达性」为架构推断、双向未验证。本面停车结论**不变**，仍由通用裁定支撑（r1 主裁定：域内观察买不到完整性→unknown 保留，协调 `01a1bd87` 确认；通用 unknown 是证据不足时的执行落点，不代替路径特异性核验），**不依赖**「本面存在 detached 后代」这类未证断言，也**不得**以 F-3 外推该面 |

矩阵结论：「所有真实 Pi attempt 均必停车」在**裁定口径**（r1 主裁定＋`01a1bd87`：组灭绝／注册集清扫不得升级为完整树证明、证据不足即 unknown 保留）下成立，其依据是**通用裁定**而非 F-3 外推；F-3 结构锚只支持 bash／MCP 两面。可信 test 面的路径特异性断言（有无其它派生面）双向未验证——若推断成立，根组灭绝可覆盖全树（域内可观测），但按裁定口径仍不得据此确认。

**一个必须由队长/owner 明确的口径分叉**（它决定现授权内 W1 是否可居住）：裁定要求「只有另有独立完整证据的 attempt 才能确认退出」。两种读法：
- **域严格读**：P1 已证组＋注册集在其健全域内是完整证明——组内自包含的 attempt（无 setsid 逃逸）可确认；只有逃逸类停车。→ 保守接线下 W1 主旅程（非 daemonize）可走，daemonize 类停车。**（r3 标注：协调 `01a1bd87` 已裁决——组灭绝／注册集清扫只证明各自覆盖范围，不得升级为完整树证明；「仅 setsid 逃逸时停车」不能由轮询未命中实现（E1 正是不可识别逃逸）。本读法记录在案，但按该裁决不作为实现基础；见 ZCode 独审 §6。）**
- **裁定严格读**：bash worker／MCP guardian 按设计 detached 成独立组长（F-3）→「组灭绝」对它们恒不成立→**所有真实 Pi attempt** 只剩注册集证据→全部保持 unknown→**整个 W1 冻结旅程（5 任务 3 运行 2 排队、逐任务取消）在现授权内无法通过**，除非先落 A 或 B。（r3 标注：按上方路径矩阵，本读法对可信 test 面的停车结论由通用裁定支撑，不由 F-3 外推。）
本提案不替队长选读法（r3 标注：`01a1bd87` 之后执行口径即裁定严格读，域严格读不再作为实现基础呈报）；只指出：若采裁定严格读，停车是**全局性**的，W1 准出在现授权内结构性不可能——这就是「完整性缺口阻断准出」的量化形态，A/B 是仅有的两条解法。

## 8. 对 W1 正常旅程与旧库恢复的实际影响（汇总）

- **旅程**：现授权＋域严格读（r3 标注：该读法按 `01a1bd87` 不作为实现基础，仅存档）→主旅程可走、setsid 类停车（槽减速）；现授权＋裁定严格读→全局停车；A-UID→旅程不变、attempt 可确认（setuid-exec 类残余除外）；A-VM/VM-NS→旅程不变、attempt 可确认（A-VM 延迟/资源升）；B-min(a)→旅程放行、残余按台账披露、UI/SSE 面若引入新公开状态则前端四文件（OhMyPi 范围）受影响——属契约修订派生面，须按当前派工归属另行分派。
- **旧库**：三个方案都无 DDL、无 schema 迁移；存量 `exited_unknown` 行：A 下按原 uid/域不可追溯→维持人工 resolve；B 下处置措辞（是否被新政策自动降级）属契约修订文本，owner 定稿前**不追溯**。

## 9. 反例／正控材料与输入哈希（交未参与者独审）

- 证据目录 `build/web-text-intake-exit-guarantee-proposal/r2/`（gitignored；admission.json、worker-host.snapshot.mjs、lib.mjs、fake-runtime/organizer.mjs、probe-e1-between-scans.mjs、probe-pcg-group-escape.mjs、probe-pch-inheritance.mjs、run-all.mjs、run.log、SHA256SUMS.txt）。复跑：`cd build/…/r2 && node run-all.mjs`（离线、纯 node+ps+stock perl、确定性时序，总时长约 6.5s，自校验 production blob 哈希，跑后无残留——本轮曾因 `process.exit` 跳过 finally 留下 1 个 sleep-30，已修退出路径并复跑验证 NO STRAYS）。
- **E1（反例，重确认）**：`probe-e1-between-scans.mjs` 与 r1 附件**逐字节相同**（SHA-256 `459ca6a5…44b5`，从评论附件重下载核对），直 import 5926cbc 生产 worker-host 原字节——`verifyTree=true`＋`confirmExit` 释放后 detached 叶存活（run.log：leaf=40660 双次复查 true）。前提事实在当前候选上仍成立。
- **PC-G（新正控）**：组纪律不是包含——worker（detached 组长，生产 managed-bash 形状）内成员 `setpgrp(0,0)` 自迁新组并带走后代，杀组后 `kill(-G,0)`→ESRCH 而树成员存活（O-2 的可运行证明）。**含义**：不存在「只要大家都别 detach 就行」的 A 类廉价替身。
- **PC-H（新正控，B 残余量化）**：继承保留——Case A 环境继承（生产 `mcp-guardian.mjs:65` 形状）幸存后代永久持有 env 秘密；Case B 未排空 stdin 管道的缓冲字节被 detached 孙代读走（**当前生产命令 shell `stdin:'ignore'`，不可达**——标注为机制演示）；Case B2 排空优先防线有效。
- harness 再造披露：r1 harness 随 build/ 被回收，r2 的 lib/fake-runtime **按 r1 记录钉死的语义重造，非逐字节恢复**；生产 blob 身份是承载锚且运行时自校验。再造过程中修掉的四个 harness bug（`node -e` 把 `--nonce` 当 CLI 选项、verdict 布尔语义、worker 事件循环排空自退、exit 跳过 finally）已如实记入 admission.json。

## 10. 属于 owner 的差异清单（独审通过后送审；本提案不申请）

> **r3 修订**：mcp_ack 回路闭合**移出本清单**——它不是新增 owner 权限，而是原 I 既有接线缺口（runtime `mcp-control.mjs:22` 已等待校验、server/lib 0 处写入），属候选 I 现有授权写入范围内的实现项（§7-2）；它与 owner 帧可用性是**语义前置**关系，不是授权项；闭合不扩 W2 配置／工具入口。

1. **选向**：A-UID（受限保证）／A-VM／A-VM-NS／B-min／现状严格读——至少五选一，**比较集非穷尽**（r3/P-2；或 A 与 B 分阶段：短期 B 纪律＋长期 A 域）。
2. **口径**：§7 的「域严格读 vs 裁定严格读」——决定现授权内 W1 是否可准出（r3 标注：`01a1bd87` 后执行口径即裁定严格读）。
3. **若 A**：单独授权 root 助手（新 binary＋签名链＋安装期管理员授权／用户确认，r3/P-3）**或** VM 基建（Cargo＋镜像管线；含共享宿主 VM＋guest 内域形态）——互斥的授权包，不捆绑。
4. **若 B**：契约修订包（退出确认定义、取消完成、验收旅程措辞、公开状态命名）＋MCP env 秘密政策二选一。

## 11. 结论

- 完整退出义务在三平台上的可持续性不同：Windows 有 Job Object、Linux 有 pidns（O-13/O-11），**macOS 没有公开原语**（O-2/O-5/O-7）——在 macOS 上「保义务」构造族本版登记为 A-VM／A-VM-NS（后者为架构推断级、成本未验证），A-UID 降级为受限保证（O-14 setuid-exec 域外残余）——**比较集不声称穷尽（P-2）**；均为 owner 级授权跃迁；事件源买不到完整性（O-4/O-8/O-12）。
- B-min 是唯一现授权形态可及的解，但它改的是义务本身：残余（继承 env 秘密、attempt 域内文件写、无凭据外呼）必须被 owner 显式接受并写进契约，不能用「已清扫」的措辞冒充「已证明」。
- 现授权内保守接线能恢复正确性（不再误释放、E1 覆测按冻结 unknown 占槽），但停车面（§7）的宽度取决于口径分叉——这个问题不回答，W1 准出的判定就无法收口。停车结论按路径举证（§7 矩阵，r3/r4）：bash／MCP 面有已核结构锚与探针家族；可信 test 面输入侧有已核结构锚（入口 kind／工具／MCP 处理，r4/N-1 补登记），其服务端沿链派生保证未核、路径可达性双向未验证，停车仍由通用裁定支撑而非 F-3 外推。
- 本提案未实施任何方案、未申请任何权限、未动 004/D、未改冻结验收；MAYNE-24 保持 in_progress。

## 12. r3 修订记录（送审前更正面清单；只改本文档，不改生产／测试／Runtime／DDL）

**权威输入**：ZCode 限定独审（提交 `c05e545` 于 `agent/zcode/mayne-24`，评审记录 `docs/reviews/web-text-intake-exit-guarantee-proposal-20261109-zcode-review.md`，议题评论 `01a1bdf9-460b`）＋协调派发（评论 `01a1bdfb-b508`）。五组更正：

1. **P-1（MAJOR，逃逸边界）**：§4-A-UID 增完整性分级标注（受限保证）；构造段把「uid 无 root 不可变更」限定为**自愿**通道并补 setuid-exec 域外残余（O-14 官方锚：本机 Apple SDK `execve.2`「If the set-user-ID mode bit …」）；新增「残余披露」段；§6 表 A-UID 列、§8、§10-③、§11 同步改述。原文「逃逸进程仍是该 uid」仅对自愿类成立，已按此收窄。
2. **P-2（MAJOR，比较集）**：§4 引言由「真正满足 §3 的构造只有两个」改为**登记族清单＋非穷尽声明＋能力/推断/成本三类标注**；新增 A-VM-NS 节（共享宿主 Linux VM＋guest 内每 attempt pidns/userns 域：O-9 entitlement 与 O-11 pidns 语义为官方能力，组合满足 §3 为**架构推断**，镜像/容器/延迟成本**未验证**）；§2 小结、§6 表（增列）、§10-①（四选一→至少五选一＋非穷尽）、§11 同步。
3. **P-3（MINOR，分发前提）**：§4-A-UID 新增权限段补**安装期管理员授权／用户确认**（SMAppService 注册 consent）；§6 表、§10-③ 同步。
4. **mcp_ack 归类**：自 §10 清单移除原第 5 项，§10 前言与 §7-2 改述为——runtime `mcp-control.mjs:22` 已实现并等待 `mcp_ack` 校验、5926cbc server/lib **0 处**写入（git grep 实测）＝**原 I 既有接线缺口**，属候选 I 现有授权写入范围内可闭合项，不是 owner 授权项；owner 帧证据的语义前置；闭合不扩 W2 配置／工具入口。
5. **§7 路径证据矩阵**：新增「停车结论按路径举证」表（实际 bash 面／实际 MCP 面／可信 test 面各列已核结构锚、探针、依据类型），并改述口径分叉段（域严格读按 `01a1bd87` 记录为不作为实现基础；「所有 attempt 必停车」的依据是通用裁定而非 F-3 外推；可信 test 面断言双向未验证）。§8、§11 同步。

**本轮锚复核（只读对象库取证，零树改动；与 r2／ZCode 审登记逐字节相同，未重跑探针）**：

| 锚 | blob | 位置 | 本轮实测 |
|---|---|---|---|
| worker-host spawn Pi 运行时 | `cfdd3354`（5926cbc） | :251 | `detached: process.platform !== 'win32'`；:282 组长注释 |
| managed-bash detached spawn | `8efb358d`（23eb1a1 树） | :20 | `detached:true`，env 由调用方给出 |
| managed-mcp guardian spawn | `2f752b7b`（23eb1a1 树） | :26/:27 | env 清洁 `{PATH,TMPDIR}`；`detached:true` |
| mcp-control ack 校验 | `c470108f`（23eb1a1 树） | :22 | `frame.type !== 'mcp_ack'`＋runId/hostNonce/action/expected 匹配 |
| task-recovery recover() | 5926cbc server/lib | :80/:84-86 | 仅探测 `record?.pid ?? attempt.workerPid` 存活 |
| server/lib mcp_ack 写入 | 5926cbc | 全目录 | git grep 0 处（runtime 1 处＝mcp-control.mjs） |
| O-14 来源 | 本机 Apple SDK | `share/man/man2/execve.2` | 「If the set-user-ID mode bit …」在场；`setuid.2` 在场（自愿边界） |

**r4 修订块（2026-11-09，N-1 收口；只改本文档，不改生产／测试／Runtime／DDL）**

**权威输入**：ZCode r3 限定独审（提交 `24960e4` 于 `agent/zcode/mayne-24`，评审记录 `docs/reviews/web-text-intake-exit-guarantee-proposal-20261109-zcode-review-r3.md`，议题评论 `01a1be2c-c92d`／附件 `01a1be2c-735b`：P-1/P-2/P-3/mcp_ack 成立、N-1 须收口）＋协调派发与锁定（评论 `01a1be33-775f`）。更正两项：

6. **N-1（§7 矩阵「可信 test 面」行锚点登记，必要更正）**：删除「唯一已核的通用 spawn 形状事实」的不准确概括，把登记树内**已核的输入侧结构事实**补进「已核结构锚」列——`organizer-entry.mjs`（blob `9414f23f`）:63 kind 白名单＋snapshot.provider/model＋apiKey 协议校验、:114 `request.kind!=='test'` 为 useTools 合取项、:115 `tools=!useTools?[]:…` 空工具集（连 bash 工具包装都不构造）、:116-117 MCP 分支仅允许 trial/extract/revise（test＋MCP→`RUNTIME_PROTOCOL` throw，fail-closed）；:109 managedBash 宿主对象虽无条件构造但派生**惰性**（`managed-bash.mjs` blob `8efb358d` :12-14 构造仅建闭包、:20 detached spawn 在 `operations.exec` 内）——无工具 attempt 不派生任何 bash 进程。「依据类型」按派发口径三级分列：①已有已核结构事实（上列行）；②尚缺端到端完整证明（服务端沿真实调用链的 kind/snapshot/MCP 输入派生一致保证**未核**，属沿 server/lib→worker spawn 帧调用链的取证欠账）；③双向可达性未验证（架构推断）。「无探针」与「停车由通用裁定支撑（r1 主裁定＋`01a1bd87`；通用 unknown 是证据不足的执行落点，不代替路径特异性核验）」保持不变，矩阵停车结论不变。§11 相应半句同步。作者交付评论（`01a1be0f-6a3f`）「可信 test 面**无锚**、无探针」的概括更正为「无 detached 后代锚、无探针；输入侧有已核结构锚，服务端沿链保证未核」。
7. **XNU euid/ruid 承载语义补锚（可选项，按 r3 审 §1 建议登记）**：新增 O-15（§2 表）——`KERN_PROC_UID` 按 effective uid 过滤、相邻 `KERN_PROC_RUID` 按 real uid 过滤（XNU `xnu-11215.81.4` `bsd/kern/kern_sysctl.c:752-769`）；§4-A-UID 构造段「逃逸进程随即离开枚举域」处补 O-15 引用；§12 锚表补行。**该锚由 ZCode r3 审核验；本修订仅登记转引，作者未独立复验该源文件**——引用状态按此如实标注，不把未核路径写成已证。

**r4 锚复核（只读对象库取证，零树改动；`git cat-file blob` 直读，blob id 即内容哈希）**：

| 锚 | blob | 位置 | 本轮实测 |
|---|---|---|---|
| organizer-entry 输入侧 kind/工具/MCP 处理 | `9414f23f`（23eb1a1 树，前言既登记锚） | :63/:109/:114/:115/:116-117 | :63 kind 白名单 `['extract','revise','test','trial','today']`＋`snapshot?.provider/model`＋apiKey 协议校验在场；:109 `bash=managedBash({…})` 无条件构造；:114 `useTools` 合取含 `request.kind!=='test'`；:115 `tools=!useTools?[]:[…]`；:116-117 MCP 分支仅 `['trial','extract','revise']` 否则 `RUNTIME_PROTOCOL` throw——与 ZCode r3 审登记逐行一致 |
| managed-bash 惰性派生 | `8efb358d`（23eb1a1 树） | :12-14/:20 | :12-14 构造仅建 `children` Map＋`close` 闭包，无 spawn；:20 `spawn(…,{detached:true,…})` 位于 `operations.exec` 内——无 exec 调用即无 bash 进程 |
| XNU `KERN_PROC_UID` 过滤语义 | opensource.apple.com xnu-11215.81.4 源码 | `bsd/kern/kern_sysctl.c:752-769` | **ZCode r3 审已核、本修订转引未独立复验**：`sysdoproc_filt_KERN_PROC_UID` 用 `kauth_cred_getuid()`（effective uid），相邻 `sysdoproc_filt_KERN_PROC_RUID` 用 `kauth_cred_getruid()`（real uid） |

r3 锚表各行（worker-host `cfdd3354` :251/:282、managed-mcp、mcp-control、task-recovery、server/lib mcp_ack grep、O-14 本机 man 页）未改动来源，原样复用，未重跑探针。

**r4 边界**：只改本文档（§1 增 r4 行、§2 增 O-15 行、§4-A-UID 一处括注、§7 矩阵第三行、§11 一句、§12 本块）；停车结论、探针状态、口径分叉、§10 owner 清单与 D／004 状态不动；未重跑任何探针、未实施、未申请权限、不跑完整门禁；后续仍由未参与者按本清单做限定独审（点对点复核 §7 第三行＋O-15 三处＋§12 本块即可）。MAYNE-24 保持 in_progress。

**边界**：只改本文档；旧审通过来源（O-1…O-13、r1 裁定、F-3/F-4/F-5/F-6 事实）与原样探针（E1 `459ca6a5…`、PC-G、PC-H）复用其已审结论，未重跑、未新增探针；不实施、不装 helper／VM、不改冻结契约／公开状态／004/D、不申请权限、不跑完整门禁；后续由未参与者按本清单做限定独审。
