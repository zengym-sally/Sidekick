# MAYNE-24 退出保证决策提案限定独审（ZCode，2026-11-09）

- **对象**：`d8fbf3fece89dc56c6788b4c2ad71951385f4eeb`（tree `6acf1656c5c293def198c87d653535de19bb4d66`，父 `23eb1a1`，恰 2 docs 文件 +143/−1）；附件 10 件经 CLI 读回，8 件哈希对 `SHA256SUMS.txt` 全符，另 2 件（`fake-runtime/organizer.mjs`＝附件 `organizer.mjs`、`worker-host.snapshot.mjs`）按 §9 布局落位后复算全符。
- **派发**：协调评论 `01a1bd87-eda6-785c-91cb-e3a3f9f4e909`（Codex）：核对三项包含性质与官方来源；A-UID/A-VM 可满足性与逃逸边界完整性（不得把已列方案写成穷尽证明）；B 保证弱化与秘密残余量化限于实际验证通道；§7 分类及 W1 准出影响由当前可信代码／快照证明；原样复跑 E1/PC-G/PC-H；核对生产输入身份与 harness 重建披露、清理无残留；检查 mcp_ack 属既录缺口还是新增 owner 权限；未改来源事实复用旧审。
- **结论：通过（限定范围）**——作为「可审的决策提案材料」通过：断言可溯源、探针可原样复跑、生产输入身份独立核verified、口径分叉如实呈报 owner。**不等于采纳 A／B，不作为整体通过或授权依据。** 下述 P-1/P-2/P-3 须在送 owner 前的下一版提案中更正或补披露。
- **性质**：本审只写评审文档与 build 证据；不改提案／生产／测试／Runtime／DDL／权限／原 D 申请；未跑完整 check。原始证据在本机 `build/web-text-intake-exit-guarantee-proposal-review/r1/`（gitignored），精选随评论附件交付。MAYNE-24 保持 in_progress。

## 1. 身份与生产输入（独立复算）

- commit/tree/父与派发登记逐字节一致；`README.md` 差异仅索引行，提案正文与附件 `proposal.md` 同哈希（`35ed8a98…5abd648`）。
- **生产输入身份**：`worker-host.snapshot.mjs` 由本审从对象库 `git cat-file blob cfdd3354…` 独立导出，SHA-256 复算 `817591ec…5ae81`、`git hash-object` 复算 `cfdd3354…` 全符——E1 承载锚零转录成立；`run-all.mjs` 步骤 [0] 的运行时自校验在本机再次通过（byte-exact=true）。
- **Runtime 锚 blob 五件**（managed-bash `8efb358d…`、bash-worker `b2212ef6…`、mcp-guardian `5f8d1a6f…`、organizer-entry `9414f23f…`、managed-mcp `2f752b7b…`）在 `23eb1a1` 树内逐一实测相符——r1 来源事实按「未改来源事实复用旧审」沿用的前提成立。
- **E1 探针逐字节同源**：从 r1 交付评论附件（`01a1bd62-e4f3`）重下载，SHA-256 `459ca6a5f2a211eb0b7c9ec7d777d6e32786ee069f5728c4db20357c533244b5`，与 r2 附件 diff 为零——提案 §9 的「逐字节相同（459ca6a5…44b5）」独立证实。
- **harness 重建披露**：admission.json 如实记录 r2 lib/fake-runtime 为按 r1 记录语义重造（非逐字节恢复）及 bring-up 修掉的 4 个缺陷（含 `process.exit` 跳过 finally 曾留 1 个 sleep-30、已杀＋修退出路径并复跑）。披露与现状一致，无隐瞒。

## 2. E1／PC-G／PC-H 原样复跑（全部 CONFIRMED，清理无残留）

本机按 §9 布局落位后 `node run-all.mjs`：exit 0，约 6.2s，离线。

- **E1**：`verifyTree=true`＋`confirmExit` 释放（exited:true, treeVerified:true）期间 detached argv-clean 叶存活，双次复查存活，最终由生产 `stopAll()` 收尾——与 r1 结论及 r2 run.log 同形（新叶 pid 93640）。
- **PC-G**：detached 组长 worker 内成员 `setpgrp(0,0)` 自迁新组带走后代，杀组后 `kill(-G,0)`→ESRCH 而树成员存活——组纪律≠包含。
- **PC-H**：Case A（mcp-guardian.mjs:65 形状 env 继承）幸存后代永久持有 env 秘密 RETAINED=true；Case B 未排空管道字节被孙代读走 RETAINED=true（**当前生产 stdin:'ignore' 不可达，提案已如实标注为机制演示**）；Case B2 排空优先防线 EOF_MITIGATED=true。
- **清理**：复跑前后进程表核查——本审探针零残留；机器上另观察到 2 个**先前任务遗留**的 `mcp-guardian --mode cleaner` 进程（属 mayne-22/mayne-23 工作树，2026-11-07/08 启动，非本审、非提案 r2 产物），按派发范围不处理，登记为环境观察（恰为 F-4/PC-H 家族的活体实例）。

## 3. 三项包含性质与官方来源（O-1…O-13 核验结果）

§3 的三性质（成员强制／空性单事实可观测／崩溃后可重观察）作为形式化是自洽的；§2 十三条断言逐条核验：

- **O-1..O-7（本机 Apple SDK 逐行核实，全部相符）**：kill(2) 负 pid＝组信号、`-1` 非 root＝同 uid 全体；setpgid/setsid EPERM 边界＝自愿成员资格；`sys/sysctl.h:436-443` 七个 KERN_PROC 选择子（436 ALL…443 LCID）行号精确；Darwin `sys/event.h` 仅 NOTE_EXIT/FORK/EXEC、**无 NOTE_TRACK**（r1 修正成立）；无 prctl/procctl man 页（PDEATHSIG 类机制缺席）；`sys/spawn.h:61-62` POSIX_SPAWN_SETSID/CLOEXEC_DEFAULT 行号精确；`sandbox-exec` man 页「DEPRECATED」逐字。
- **O-8（corroborated）**：entitlement 页存在且描述相符（"The entitlement required to monitor system events…"，macOS 10.15+）；「须向 Apple 申请」原句在正文 JS 渲染体内，本环境经官方页元数据＋检索佐证，未能逐字重取——`ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED` 为作者引自 ES 文档，本机 CLT SDK 无 ES 头文件不可本地复核。结论方向（供应商级审批类）与全部已知官方材料一致，登记为「佐证级」。
- **O-9（相符）**：`com.apple.security.virtualization` 官方页确认为「指示 app 可使用 Virtualization 框架」的布尔 entitlement——标准签名类、非 Apple 审批类，与提案的两类划分一致。
- **O-10（corroborated）**：本机 `launchd.plist(5)` 证实特权系统域（LaunchDaemons）与 UserName/GroupName 键语义（域内默认 root，键可选）；developer.apple.com ServiceManagement 页为作者引用。
- **O-11（man7 逐字相符）**：「init 终止→内核经 SIGKILL 终止命名空间内全部进程」「成员资格在创建时固定」「setns 仅限当前及后代」。
- **O-12（man7 逐字相符，r1 修正成立）**：内核到用户不可靠、ENOBUFS 丢弃；多播收发仅 euid 0 或 CAP_NET_ADMIN。
- **O-13（learn.microsoft.com 逐字相符）**：「关联后不能被打破」、子进程默认入 job、breakaway 须 job 方设 BREAKAWAY_OK/SILENT_BREAKAWAY_OK、TerminateJobObject 全杀、KILL_ON_JOB_CLOSE 关柄即杀。

**小结**：事件源买不到完整性（O-4/O-8/O-12 有损或不可得）、Windows=Job/Linux=pidns/macOS=无原语的三平台边界，在已核来源上成立；r1 两处修正（NOTE_TRACK、netlink 特权）均正确。

## 4. A-UID／A-VM 可满足性与逃逸边界

**可满足性核心成立**：A-UID 以「attempt 专用 uid＋KERN_PROC_UID 枚举＋root 助手逐 pid SIGKILL」给出空性单事实，uid 域对**自愿逃逸类**（setsid/setpgid/双 fork——O-2 通道）完整，崩溃后 uid 可重枚举（性质 3）；A-VM 以 VM 本体为域，VZ 宿主进程死＝guest 全灭（单事实），无 root。两者的生产改动清单、权限包、验证办法、W1/旧库影响与派发要求一一对应，且均标为 owner 级授权、本提案不申请——与派发边界一致。

**但「穷尽性」与边界完整性有三处须更正（送 owner 前必须落实）：**

- **P-1（MAJOR，逃逸边界过述）**：A-UID「uid 无 root 不可变更」只覆盖自愿 `setuid(2)`；**setuid-root 二进制 exec** 由内核在 exec 时提升 euid，逃逸进程离开 KERN_PROC_UID 枚举域——空性不再蕴含树灭绝。该类需模型代码刻意调用受权 setuid 程序并使其驻留（日常 sudo 无凭据即败，实际风险低），但它是 A-UID 域外的真实通道，性质 1 的「完整满足」应改述为「对自愿逃逸类完整；setuid-exec 提权类在域外，须披露为残余」。提案未提此通道。
- **P-2（MAJOR，比较集非穷尽）**：「macOS 上真正满足 §3 的构造只有两个」过述。存在第三族：**单个 macOS 宿主 Linux VM＋guest 内每 attempt 独立 namespace 域**（pidns/userns 容器）——域在 guest 内、空性 guest 内单事实可观测、VM 死即全灭（O-11 在 guest 内生效），资源曲线远优于每 attempt 一整 VM（一次 VM 启动、每 attempt 一个廉价容器）。它同时弱化 A-VM 的「基建跃迁最大」表述并改变 §10-① 的选向集合（「四选一」→至少五选一）。提案应补列该族或显式声明比较集非穷尽。
- **P-3（MINOR，分发前提缺项）**：A-UID 的新增权限清单覆盖运行期 root 助手与 Developer ID 签名，但 root LaunchDaemon 的**安装本身**需管理员授权/用户确认（SMAppService 注册 consent）——分发前提应补记。

## 5. B 的保证弱化与秘密残余量化（通道核验）

- B-min 的性质如实：「`registry_extinct` ≠ 树已证明灭绝」「B 不恢复完整性，它放弃完整性声明」——与本轮协调最新口径（`01a1bd87`：注册集清扫只证明自身覆盖范围，`registry_extinct` 不成为未经批准的终局／公开状态）一致；提案给出的发布政策三选项与命名决定均显式留给 owner，无越权表述。
- **残余量化限于实际验证的通道——逐行核验成立**：
  - apiKey 只在 organizer 内存：`organizer-entry.mjs:108`（provider auth resolve 闭包）✓；
  - bash 后代非 apiKey 泄漏面：bash 工具 spawnHook 仅给 `{PATH,TMPDIR}`（`organizer-entry.mjs:113`）；真实命令 shell `stdin:'ignore'`（`bash-worker.mjs:20` 行号精确）；`secrets` 列表只存在于 organizer 侧用于输出 redaction（`managed-bash.mjs:23-27`，从不进入 worker env/argv/stdin）✓；
  - 真实可继承秘密面＝MCP service env：`mcp-guardian.mjs:65` `env: p.env` 行号精确，guardian 自身 env 为清洁 `{PATH,TMPDIR}`（`managed-mcp.mjs:26-27`），敏感值来自用户配置进 server.env 的值（`organizer-entry.mjs:121` sensitiveValues）✓——PC-H Case A 对该形状实证。量化未超出已验证通道，未把未验证通道写成已量化。
- 契约层受影响面全部标注 owner-owned，未动冻结验收文本。

## 6. §7 可达任务分类与 W1 准出影响（可信代码核验）

- 「仍会停车」四类的代码锚全部实证：setsid 逃逸（E1 复跑）；身份依据缺失（F-5：`5926cbc` server/lib **0 处 `mcp_ack` 写入**（git grep 实测），而 runtime `mcp-control.mjs:22` 已实现并等待 `mcp_ack` 校验）；MCP service/cleaner pid 不在任何帧（r1 F-4 沿用，且本机观察到先期任务遗留的 cleaner 孤儿进程活体）；重启面 `recover()` 仅探测 `record?.pid ?? attempt.workerPid`、不查组／注册集／argv（`task-recovery.mjs:86-88` 行号精确）。
- 「`nohup x &` 不逃组」成立（非交互 shell 无作业控制，后台任务留在 shell 进程组）；真逃逸需显式 setsid/setpgid/双 fork 的表述与 O-2 一致。
- **§7 口径分叉已被本轮协调部分裁决**：`01a1bd87` 明确——组灭绝／注册集清扫只证明各自覆盖范围，不得升级为完整树证明；「仅 setsid 逃逸时停车」不能由轮询未命中实现（E1 正是不可识别的逃逸）；现有完整退出义务与证据不足即 unknown 保留。故提案中「域严格读→W1 主旅程可走」在**当前执行口径下不成立**（提案本身已声明不替选、仅呈报，无违规，但本审记录：该读法作为实现基础已被否决）。同时协调要求「所有真实 Pi attempt 均必停车」按路径分别举证（可信 test 无工具／无 MCP 路径 vs 实际 bash／MCP 路径）——提案当前仅以 F-3 结构断言（detached 组长：`managed-bash.mjs:20`、`managed-mcp.mjs:27` 实证），可信 test 路径的独立证明尚缺，属作者后继增量，本审如实登记。
- W1 准出影响的量化表述（裁定严格读下现授权内结构性不可准出）逻辑上由已核代码锚支撑；最终口径仍属 owner。

## 7. mcp_ack：既录接线缺口，非新增 owner 权限（不得混写）

实证：runtime 侧 `mcp-control.mjs:22` **已存在** `mcp_ack` 校验等待（frame.type==='mcp_ack' + runId/hostNonce/action/expected 匹配），host 侧 `server/lib`（`5926cbc`）**零处** `mcp_ack` 写入。即：回路不闭合是**既有接线缺口**——runtime 帧词汇已就绪，缺的是 server/lib（worker-host）的回写，属候选 I 现有授权写入范围内可闭合的实现缺口；不涉 Runtime 变更、不涉 OS 权限、不涉 DDL。提案 §7-2/§10-⑤把它标注为「既录缺口」是正确的，但将其列入「属于 owner 的差异清单」有与本轮协调告诫的「不能把二者混写」相碰的风险——应改述为：既录缺口＋I 范围内可闭合，它是 owner 帧身份证据端到端可用的**语义前置**，而非授权项。

## 8. 结论与送 owner 前置条件

- 提案材料通过限定独审：身份可核、探针可复跑、来源断言与官方材料相符、口径分叉如实、残余量化不越界。
- **不采纳 A／B**；提案不作为整体通过或授权依据。送 owner 前须完成：P-1（A-UID setuid-exec 残余披露＋性质 1 改述）、P-2（补列共享 VM＋per-attempt namespace 域或声明非穷尽，§10-① 选向集合相应修订）、P-3（安装期授权补记）、§7 口径段按 `01a1bd87` 裁决改述（域严格读不作为实现基础；停车面按路径分别举证）、§10-⑤ mcp_ack 改述为既录缺口＋I 范围内闭合项。
- 协调既定分工不受影响：Kimi 后端修复、OhMyPi 前端增量、既有独审继续；MAYNE-24 保持 in_progress。
- 原始证据（本机，gitignored）：`build/web-text-intake-exit-guarantee-proposal-review/r1/`（附件原样、rerun 目录与全量日志、r1 E1 探针对照件、identity 记录、SHA256SUMS）。精选随评论附件交付。
