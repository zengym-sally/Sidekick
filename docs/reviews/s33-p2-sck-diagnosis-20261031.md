# 本次-3812定位到捕获矩形越界，P2无凭据功能主线已复验

北京时间2026-10-31，从`ceceaa0`继续。用户要求先排查ScreenCaptureKit -3812，不切换／重置系统权限、不绕过工具；控制恢复后继续P2无凭据验收，不推进P3／P4，历史未补验保持。本轮沿用sop-bug-fix与已批准P2契约，非批量，修正一个测试审计能力接线缺陷；原R3身份／清理／凭据边界不放宽。

## 捕获错误的直接原因有故障时系统日志

SDK `SCError.h`明确`SCStreamErrorInvalidParameter=-3812`，与拒绝录屏权限的错误项不同。[Apple定义](https://developer.apple.com/documentation/screencapturekit/scstreamerror/invalidparameter)。只读查询上一轮两次失败的准确时间窗口，在控制服务PID53372均找到：

> SCStream validateStreamConfiguration: contentRect does not contain sourceRect

对应本地时间04:17:51.904、04:18:18.072，与上一轮原始CUA错误回执一致。显示内容矩形为1512×982、scale2；候选窗口75189在成功阶段为`(36,33,640,887)`，随后成为`(-271,342,93,151)`的小区域，已在显示边界外。仅导出该候选和矩形校验的[筛选日志](s33-p2-sck-diagnosis-20261031/capture-bounds-log.json)，没有把完整系统窗口清单复制进仓库。

这确认了本次框架拒绝的直接原因是捕获区域超出内容矩形。缩略化／屏外状态符合窗口管理转换，但没有证据归因于某个用户动作或具体系统开关，不声称已证实Stage Manager为唯一原因。安装绑定源码还显示`getAXState`与截图都调用同一`get_app_state`，`emit:false`只控制输出，因此所谓“只读AX”也可能被截图失败阻断。

本轮仅使用窗口AX已公开的`Raise`动作恢复可见性，再读取／操作目标应用。没有改控制服务、插件、SDK、系统权限或窗口管理设置，没有使用隐藏参数、替代截图或键鼠后端。后续[62次CUA调用及原始文字返回](s33-p2-sck-diagnosis-20261031/native-cua-transcript.json)未再出现-3812，实际完成表单／诊断／退出重开。**这是有效操作缓解，不是已修复控制工具自身的边界处理。**

## 原生继续执行暴露了另一条确定的P2缺陷

PID29752同根v4／无凭据原生包成功保存服务；保存时agent_runs=0、服务日志不存在。三次normal均真实initialize及两页tools/list后约5.37秒返回MCP_CLEANUP，不发布目录。两次wait-list通过GUI取消。旧失败保留，不能用“服务实际发现过”签成功。记录见[修复前摘要](s33-p2-sck-diagnosis-20261031/native-before-fix-summary.json)。

只读lsof核对同一原生进程、其Runtime及guardian，FD3均为只读REG，未读取该文件内容或名称：[fd3-observation.json](s33-p2-sck-diagnosis-20261031/fd3-observation.json)。旧代码仅凭`fstatSync(3).isFile()`就将它视作验证审计，继续传给keeper／cleaner；cleaner写审计失败即停止发组信号。正常发现因此等不到清理／管道收口。CLI验证宿主总提供可写AUDIT，掩蔽了原生分支。

FD观测来自wait-list；未直接记录三次normal的cleaner异常栈。随后真实Runtime反例在无关只读FD3下复现MCP_CLEANUP，并在无关可写文件中产生了错误审计写入，从而确认该缺陷路径，而不是只靠时序推断。独立审查同时发现Rust回退原先丢弃审计写错误，亦纳入一致性修正；没有为了通过而延长清理窗口或忽略drain。

## 只修正审计授予与失败门闸

- CLI验证宿主仅在持有AUDIT、成功克隆并安排dup2时，向已清空环境的Runtime设置私有标记`SIDEKICK_MCP_AUDIT_FD=3`。普通／UI路径不设置，父环境假标记被清除，服务载荷的同名变量不授予Runtime能力。
- Runtime／guardian仅按精确标记接收审计文件；无标记不检查／写入／转交任意FD3；错误标记、显式缺文件／非普通文件不降级成无审计成功。控制子代传播标记和FD，服务不自动继承两者。
- AUDIT准备锁／clone／dup2错误传回启动失败；Node或Rust审计写／锁错误均在信号前停止。身份、组消失、管道排空、终态、取消与目录发布屏障保持。

修改为`runtime/managed-mcp.mjs`、`runtime/mcp-guardian.mjs`、`src-tauri/src/mcp_host.rs`／`mcp_verification.rs`及回归／脚本入口，无新依赖、vendor、配置、schema、凭据或品牌变更。§16.16方案双面第2轮APPROVE后实施；交付首轮补齐三项P2证明缺口，第2轮两面APPROVE，未自签放行。

| 检查 | 实际结果 |
| --- | --- |
| 修正前Runtime反例 | 9项中6失败，含原生同类只读误判及无关可写文件被写；[red](s33-p2-sck-diagnosis-20261031/raw/fd-red.log) |
| 修正后Runtime | 10/10，含9个标记／FD组合及独立keeper恢复；真实Pi／Node／组信号，零tools/call；[日志](s33-p2-sck-diagnosis-20261031/raw/fd-regression.log) |
| Rust审计／环境 | 5/5；只读／锁失败到真实reap消费门闸，可写正控实际清理；[日志](s33-p2-sck-diagnosis-20261031/raw/rust-regression.log) |
| 门闸变异 | 仅在自己控制的临时源码变异中忽略审计false，真实受控组测试按预期失败；已逐字恢复；[red](s33-p2-sck-diagnosis-20261031/raw/rust-mutation-red.log) |
| 完整`npm run check` | UTC21:45:34–21:49:06 exit0，输入哈希不变；Node242通过；默认Rust126通过／2原ignored／0 filtered，另双特性过滤测试8通过；[执行记录](s33-p2-sck-diagnosis-20261031/full-check.json)、[原始日志](s33-p2-sck-diagnosis-20261031/raw/full-check.log) |
| 原生包与普通包 | 完整check内实际构建、deep strict验签及资源隔离通过；普通包拒绝验证flag、不打开普通根。专用包guardian与修正源码字节一致 |

显式只读审计负例保持MCP_CLEANUP、零end帧／ACK，测试补救前组及普通后代仍活且未停止；随后测试按身份独立善后。它不算生产清理成功。keeper正控只杀guardian，以keeper的run／nonce／proofPid核对真实STOP／KILL，未用测试补救。最初新增Rust测试有一次缺trait导入编译失败，修正后通过，不将其计为功能red。

完整check沿用已有明确许可，包含S0专用合成login Keychain及旧受控MCP工具调用；**零tools/call只指下述P2原生分支与新增FD反例，不指整套check**。未读真实模型配置，两项真实模型测试仍ignored；生产MCP凭据工厂仍硬关闭。

## 修正后的真实原生功能闭环

先GUI退出旧PID29752、exit0，再正常构建替换专用包；以同根／nonce正常启动PID52234，原生主进程的FD3仍为只读REG。不是靠换成CLI环境避开原生分支。所有填写／保存／诊断／取消均经公开CUA和真实Tauri IPC，不直接改配置或数据库制造结果。

| 路径 | 原生及只读回查证据 |
| --- | --- |
| 重开既有配置 | 正确Node／三个独立参数／env空、旧取消与修订标记恢复；方法计数仍5／5／8，没有自动连接 |
| normal手动诊断 | 显示“进程已清理，发现2项工具”；lookup／second的只读schema展开；succeeded及绑定probeId／serverId／修订的目录文件落库，SHA核对；[原图](s33-p2-sck-diagnosis-20261031/04-native-normal-success-schema.jpg)与[AX](s33-p2-sck-diagnosis-20261031/04-native-normal-success-schema-ax.txt)、[读回](s33-p2-sck-diagnosis-20261031/native-first-success.json) |
| 缺命令 | 保存不存在的合成程序路径、手动诊断，MCP_COMMAND_MISSING，未新增服务方法，旧成功目录字节不变；[读回](s33-p2-sck-diagnosis-20261031/native-missing-command.json) |
| 取消 | 恢复命令、wait-list保存／诊断／GUI取消；cancelled，普通后代退出，旧目录仍在；[读回](s33-p2-sck-diagnosis-20261031/native-fixed-cancel.json) |
| 恢复 | GUI恢复normal、保存后重新诊断，第二次succeeded及2工具，未覆盖旧失败／取消记录 |
| GUI退出与冷重开 | PID52234经⌘Q退出0；同根重开PID1935，配置／成功目录GUI可见，9份任务记录与目录文件只读核对完全保留，无自动重连；宽窗实测Tab由服务名称移动到连接方式再到命令字段，未改内容 |

键盘只作当前宽窗的局部实测，不签署全部尺寸／焦点旅程。窄窗滚动后真实截图显示诊断／两工具及固定保存栏；AX树无结构变化不被单独当作滚动成功证据。

原生方法日志累计initialize8、initialized8、tools/list13、tools/call0；3份修正前cleanup失败、3份取消、2份成功和1份缺命令失败全部保留。业务sources／candidates／todos／todo_events及tool_calls仍0。主库v4完整、外键零违例，旧v3备份保留；没有重新做升级按钮动作或升级普通根。三次本轮实例06／07／08均由GUI退出0，最终无本轮原生／Runtime残留。详见[最终读回](s33-p2-sck-diagnosis-20261031/native-final-readback.json)。

## 规定尺寸和历史缺项不补签

窄窗原图1280×1774，宽窗2880×1774，均含标题栏、未经裁切／缩放。请求640×900、1440×1000不等于实际内容区达到两尺寸；当前显示区域不能据这些原图签署两规定高度。本轮不改屏幕／窗口管理设置，不用模拟或改图补签。

因此当前出口为：**P2无凭据保存／发现／失败／取消／恢复／GUI重开主线已实测；完整P2仍保留两尺寸及既定生产凭据等边界，历史S0／S1／S2／S3.1／S3.2未验状态保持。** ScreenCaptureKit底层边界处理仍属控制工具，Raise缓解的边界已说明；没有推进P3／P4。旧02–04六份用户记录、旧53个临时根和旧报告不覆盖／删除；本轮新06–08记录另行纳管。后续证据复核与本地提交按既有授权执行，不push。

最终证据交叉核实：A／B均APPROVE，源码与完整check快照一致；两面分别核对62次原始CUA调用／返回、8张原图／AX、真实隔离库／目录与退出记录。旧六文件SHA与两组各53根存在性均独立核对。评审只认可本轮修正与有界事实，不签P2全项。见[review.json](s33-p2-sck-diagnosis-20261031/review.json)。按既有授权本地提交本轮相关改动，不push。
