# S3.3／P3：organizer受控隔离MCP调用（2026-10-31）

基点`30fffb87c70462cdae275865a9ab1474d5c3c47d`。owner确认本轮范围：organizer隔离试跑接通stdio MCP、持久调用确认和必要unknown保护；执行验证只用合成模型、临时根与本机fixture。生产钥匙串保持关闭，不接真实模型／业务服务，不改schema／依赖／vendor／identifier，不提交或推送。P2遗留验收、P4完整矩阵、P5正式文本入口、P6原生与S4不在本轮补签。

本轮R3，依据[实施计划§16.19–16.20](../product/05-第一阶段实施计划.md)的T1–T6。设计经正确性与全新安全／恢复两面独立APPROVE；前置核查发生的评审摘要意外暴露不作正式准出。修订后的交付经全新上下文两面独立APPROVE，独立完整门禁exit0；本轮P3受控隔离开发与验证为 **pass**。仅签署本轮范围，不关闭P2或宣称S3.3／发布完成。精选主证据见[验证摘要](s33-p3-controlled-20261031-evidence.json)。

## 实现范围与验收接缝

| 路径 | 本轮行为 |
|---|---|
| `runtime/lib/mcp-control.mjs`、`mcp-trial.mjs`、`mcp-tool-contract.mjs` | 多服务实际发现与固定命名、匹配ACK、严格参数与结果／隐私预算、unknown后abort与全部工具门闸、共享清理期限 |
| `runtime/entries/organizer-entry.mjs`、`runtime/lib/managed-mcp.mjs` | 仅trial接MCP；每次tools/call需一次许可及持久begin ACK；有效响应经response ACK后才交模型。P2没有callGuard／许可，继续拒绝tools/call；正式extract／revise及连接测试不接MCP |
| `src-tauri/src/store/mcp_calls.rs`、`agent_trials.rs`、`local_store.rs` | 复用004，冻结含空集合；possibly_sent／responded／unknown台账，防重与最小冷启恢复；unknown以failed＋MCP_RESULT_UNKNOWN表达，先于取消／中断并保持首次终态时间 |
| `src-tauri/src/host/mcp_trial.rs`、`runtime_host.rs`、`mcp_host.rs` | 有界双向帧、真实宿主持久ACK、每服务intent／owner、全部冻结服务删除保护；信号前身份与审计门保留，确认组消失及管道收口后才解除活动槽 |
| `src/domain/organizer.ts` | 结果未知显示“操作可能已生效，请先核对外部结果”，不回落为通用重试提示；未做界面布局改造 |
| `tests/fixtures/mcp-trial.mjs`及Rust／Node领域测试 | 合成HTTP模型经真实Pi选工具，两个同名stdio工具分别计数；SQLite只读核对、未授权后续Read／Bash标记、冷重开及进程清理；全部fixture可从检出取得 |

没有修改001–004、生产凭据工厂、Cargo／锁文件、Tauri配置、受控验证根的模型文件禁用护栏、上游或品牌。新增聚焦脚本为`test:mcp-contract`、`test:mcp-calls`、`test:mcp-trial`；既有脚本名不变，Node契约测试加入完整check，Rust新测试随原probe:native进入，不重复运行整链。

## 先失败再修复的证据

原始证据位于`build/p3-controlled-20261031/`，不入库；最终命令／计数另行收口，下面仅记录实际发生的反馈环。

- Node契约入口最初因模块缺失exit1；实现后通过，随后增加unknown文案反例。存储入口因缺接口exit101；追加终态时间幂等、opaque模型调用ID和v4空集合冻结反例分别真实失败后修正。空集合首轮第二次prepare会热装入新服务，现无论空配置或全禁用均固定安全snapshot，旧run不得重新准备。
- 真实Rust整链首轮有只读SQLite夹具未canonicalize临时根的问题（macOS的`/var`链接与NOFOLLOW冲突），已修正夹具，不归因于产品。正确夹具在旧宿主下为2通过／3失败：没有持久回执、没有unknown；接通后5／5通过。日志`runtime/trial-red-corrected.log`与后续聚焦日志保留。
- 新增取消／Runtime强杀后，9项中8通过／1失败。定向红证确认强杀分支已落failed／MCP_RESULT_UNKNOWN且pid=0，清理日志却出现`proof=false gone=true`、`final_gone=true verified=false`。原因是guardian自行退出与宿主回收竞争，一次身份查询过渡态被永久记为失败。修复不在缺proof时发信号，并保留审计明确拒绝为失败；最终仍须证明所有组消失。原取消／强杀用例随后exit0，全部自有PID退出、无关合成模型存活；临时诊断已移除。证据`runtime/cancel-attribution.log`、`cancel-green.log`。

## 证明边界与未验证项

独立服务计数、SQLite台账、四张正式业务表及真实子进程分别核对；循环场景不增加独立测试计数。fixture的模型Key及服务环境值为合成数据，真实密钥和普通用户配置均未读取。通用Read／Bash仍具有当前用户权限，不把四表检查写成沙箱承诺。

真实模型、第三方MCP／飞书、真实凭据／MCP系统钥匙串、普通用户根、原生GUI／设计视觉、clean clone、CI、公证分发、其他平台及历史未补验项继续开放。完整check中的旧合成Keychain探针不能证明MCP生产凭据已启用。P4的完整发送故障／宿主强杀矩阵和P5／P6后续动线仍待独立切片。

## 聚焦验证与首轮交付处置

所有命令均从当前package脚本执行；日志为`focused/commands.json`、`focused/summary.json`及修正后的`focused-revision/commands.json`，没有把循环子场景加算为独立测试。

| 命令 | exit | 实际统计／覆盖 |
|---|---:|---|
| `npm run test:mcp-contract` | 0 | 7项，含ACK错配／缺失、参数和结果预算及unknown文案；正确性审查另独立复跑7／7 |
| `npm run test:mcp-calls` | 0 | 16项，真实SQLite事务、冻结、防重、终态优先及冷启 |
| `npm run test:mcp-trial`（修正后） | 0 | 10项，真实Rust→随包Node／Pi→合成模型→两个stdio服务→台账／重开 |
| `npm run typecheck` | 0 | vue-tsc |
| `npm run check:rust`、`check:s33-verification` | 0 | fmt及默认／双特性Clippy；修正后重跑，未忽略警告 |
| `npm run check:s33-p2-runtime` | 0 | 原P2真实受控发现及隔离护栏、双特性验证；非P3替身 |
| `npm run test:s33-lifecycle` | 0 | 原P1生命周期12项 |
| S2／S3.1／Skills／MCP配置／安全／诊断域脚本 | 0 | 分别19／6／28／33／7／18项；原路径回归未删减 |

交付首轮分面结论保持原文：正确性面APPROVE_WITH_CHANGES（持久化屏障P1、无关进程存活证据P2）；安全面APPROVE_WITH_CHANGES（同一屏障P2）。两面未证明自动重放；问题在终态未知时没有持续保留活动槽。原始报告和源码冻结在`correctness/delivery-review.*`、`safety-review/delivery-review.json`与`code-hashes.json`。

实际新增SQLite拒写红证后修复：`runtime/storage-barrier-red.log`为exit101，服务实际调用1次、台账仍possibly_sent，storage_error后active_trial却为空。修正后同命令exit0（`storage-barrier-green.log`），保留pid=0的活动槽、第二次启动RUNTIME_BUSY、恢复写权限并冷重开后为unknown，计数不增加；只有MCP试跑要求这一额外持久化门槛。无关模型现明确排除空／Z状态，避免ps exit0被当作存活。此段记录首轮处置；最终复核及全量结果见下节。

## 最终独立复核与完整门禁

原两面定向核对技术上确认关闭，但共享续记检索自动展开了另一面首轮摘要，故不作严格互盲准出。随后另起两个全新上下文，只提供逐字规范核心、相关源码和原始命令日志，均APPROVE，各自独立复跑真实SQLite拒写用例1／1、exit0；未读取另一面报告或汇总结论。有效交付报告为`final-review/correctness.json`、`safety.json`。§16.19核心SHA-256仍为`6ab86a7f7366c9005befa30383fbe71b21c40196a65c137ec850c4e792c3250e`。

源码稳定后由独立验证方串行执行一次原完整门禁；没有使用skip或`--ignored`，实现者没有给自己签验证。证据为`verify/command.json`、`summary.json`、`check.log`：

| 命令／核对 | exit | 实际结果 |
|---|---:|---|
| `npm run check`（完整） | 0 | 247.271秒；Node **21组／273 pass／0 fail**；默认Rust **152 passed／2 ignored／0 failed**；双特性 **8／8** |
| Runtime与包内门禁（完整check内） | 0 | **6**次Runtime打包、**2**个实际App；两包deep strict签名与资源排除通过；`ordinaryResourceEntries=556` |
| `npm run check:structure`（独立重跑） | 0 | 18类＋8项自测；**148文件／327相对引用** |
| `npm run check:docs`（独立重跑） | 0 | **14文件／164本地链接** |
| 新控制／契约／适配模块、organizer入口、合成fixture的5条`node --check` | 0 | 每条语法检查均通过，完整命令见摘要 |
| HEAD／工作区／源码冻结／卫生 | 0 | 运行前后HEAD仍`30fffb87`，212源码／26工作集逐项哈希、status及diff stat不变；保护区无变动，无生成物／env入库；`git diff --check`通过 |

比此前基线新增Node **7**项、Rust **26**项（存储16＋真实整链10），不减旧覆盖。警告仍为esbuild **12**条（2×6次）、Vite大chunk **2**条、公证跳过 **2**条，未新增类别；既有toolchain宿主包装方案继续通过。S0专属合成Keychain往返实际执行通过，不代替MCP生产凭据验收；两个真实模型用例仍ignored。

最终源码冻结为212文件，聚合SHA-256 `20f6b57e9810291e90f072db83ea1a630eb1e168ffa9bd2a133c998ee80dd3c8`（`code-hashes-v2.json`）。全量之后只同步本记录／计划／索引及精选JSON，不改实现字节；文档另做读回核对。所有开发改动保留未提交、未推送，Git授权不沿用前序提交。上述未验证项及后续切片边界不变。
