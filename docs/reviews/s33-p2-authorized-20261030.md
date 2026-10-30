# P2补验：已授权完整check与原生隔离尝试

从`2d30009897b0867f1e461347f33223f6eaed4ef6`干净main继续，唯一写者。owner针对两项具体许可回复“都同意”：完整check允许旧本机受控MCP调用、生命周期信号及S0专用合成login Keychain条目；原生允许Sidekick MCP Verify的AX、截图与键鼠，仅合成无凭据服务。不是生产MCP凭据启用或真实工作根升级授权。见[授权边界](s33-p2-authorized-20261030/authorization.json)。

这是既有§16及已评审运行手册的执行证据追加，不改规范核心、产品代码、依赖、品牌或验收定义；沿用sop-spec-delivery。非批量，没有新功能或设计选择；保留原R3安全／迁移边界，以两面只读交付核实补验事实。原步骤历史记录不回写为“当时通过”，本报告是新的执行结果。

## 完整check已通过

实际执行`python3 docs/reviews/s33-p2-authorized-20261030/run-check.py 01-full-check npm run check`，UTC 18:53:54至18:57:07，退出码0。[checks.json](s33-p2-authorized-20261030/checks.json)及[原始日志](s33-p2-authorized-20261030/raw/01-full-check.log)保存完整npm串行子命令，未改package脚本、未跳过原门禁、未传`--ignored`。

| 分支 | 本轮真实结果 |
| --- | --- |
| S0合成OS Keychain | `storage_probe::tests::keychain_synthetic_roundtrip ... ok`；原测试执行`com.sidekick.s0.fixture.<SystemTime nanos>`／`synthetic-probe`，初始缺失→写`s0-synthetic-value`→读回→删除本条目→再次缺失。不是MCP适配器替身，也没有测试真实凭据 |
| 默认Rust库 | 125 passed、0 failed、2原有ignored、0 filtered。两项真实模型用例保持ignored，未提供真实模型Key |
| 旧受控调用／生命周期 | Runtime9项包含stdio发现／调用／错误／取消、回环Streamable HTTP调用／401；bundle smoke实际Read／Bash、两种MCP传输和AgentTool往返通过，externalModel=false、businessWrites=0。P1共12项，含8种生命周期、2种启动场景及2项ownership；8种生命周期记录本轮23次受控调用，均确认所属进程退出、无关对照存活 |
| P2运行与包 | CLI护栏5、受控发现56、特性护栏4、双特性Clippy、两个实际包及资源排除2通过；两包deep strict签名有效，普通包验证flag在开根前exit2，资源仍无受控服务 |
| 历史邻域／前端 | 类型、fmt／默认Clippy、S1／S2／S3.1／layout／S3.2及P2配置／安全／UI／升级客户端、受控模型HTTP运行时、card／contracts／toolchain均在同一完整脚本实际执行通过；不扩大为真实模型或历史原生界面验收 |

P2发现另导出58份真实进程快照，53个隔离app。按同app核对累计日志前缀后只计最长一次：initialize43、initialized41、tools/list177、tools/call=0；原始快照累计44／42／178单列，gate-1包含于gate-2。[进程摘要](s33-p2-authorized-20261030/process-summary.json)和[summarize-evidence.py](s33-p2-authorized-20261030/summarize-evidence.py)保留口径。**零调用仅指P2发现分支，完整check包含已获许可的旧受控工具调用。**

213项产品／测试／脚本／依赖／品牌字节核对与当前提交一致，运行中快照及执行后也一致。快照是在完整check开始后取得，不冒称严格开跑前采样；初始Git干净，另逐文件核对提交字节。[提交比较](s33-p2-authorized-20261030/inputs-committed-comparison.json)、[前后比较](s33-p2-authorized-20261030/inputs-after.json)及[6项生成物摘要](s33-p2-authorized-20261030/generated-artifacts.json)可复核。没有实现改动，不编造本轮产品失败反例。

## 原生只取得部分证据，完整验收受阻

UTC 18:57:24启动新建临时根`/tmp/sidekick-s33-authorized-f889amz_/app`，私有会话文件保存nonce；清空继承环境，仅PATH／TMPDIR，`controlled-upgrade-no-credentials`，请求1440×1000。真实native-info及只读SQLite均为v3，模型文件禁用、生产凭据关闭；未触及普通用户根。

`cua.getApp('com.sidekick.s33.ui.verify')`首次成功，取得真实原生工作台AX和[截图](s33-p2-authorized-20261030/screenshots/initial.jpg)，并点击个人设置、读到设置分类。图像原始容器为JPEG，以`.jpg`保存，没有裁切、缩放或转换。随后点“工具”时工具明确报告`Computer Use is not active ... get_app_state`，未执行该点击；按文档刷新`getAXState({disableDiffing:true})`返回`Computer Use server error -10005: timeoutReached`。

只读确认首个PID80489已不在且无同隔离实例后，以同根／nonce重新启动，并让本轮启动父进程等待，以记录子进程存续／退出；不是重复启动尚在运行的操作。新的PID54341已启动，再次正常`getApp`返回：

> Computer Use server error -10005；ScreenCaptureKit.SCStreamErrorDomain Code=-3811；音频/视频捕捉失败，无法开始流播放。

最后一次失败已返回，没有后续重试、绕过、代点权限或更改系统设置。未观察到OS权限弹窗，不能据错误码认定缺哪项权限。当前是**已获用户许可、工具技术失败**，不是仍等用户回复或审批卡。

另发现同时间的系统崩溃报告，PID24925为SIGABRT、tao启动栈；它不同于显式启动的80489／54341。只保存[筛选摘要](s33-p2-authorized-20261030/native-crash-summary.json)，不据此把首进程退出归因于产品、捕获工具或启动父进程。80489原退出码／原因未记录，事实边界保留；本轮持有父进程的54341在捕获失败后由精确身份清理，退出码-15。启动器从首次返回改为等待子进程，是测试载体寿命／退出码取证调整，不改生产实现；原始首次元数据不覆盖。

[native-control.json](s33-p2-authorized-20261030/native-control.json)记录逐项工具结果；[native-partial-state.json](s33-p2-authorized-20261030/native-partial-state.json)只读核对v3、quick_check=ok、各已有业务／agent_runs表零行，没有配置保存、备份或服务日志。初始测得physical2880×1774、scale2，即逻辑1440×887，仅启动时即时测量；不当稳定1440×1000验收。640×900没有执行。

因此升级确认→配置保存→初始化／分页目录→失败／取消→GUI退出重开、原生焦点／滚动和两个规定实际尺寸**本轮均未验收通过**。已有浏览器ship及本轮原生工作台截图不能替代这些路径。后续在捕获技术恢复后，可沿用既有许可、隔离根／nonce及运行手册继续，先确认没有存活实例；不需再次泛问这两项许可。

## 清理与剩余边界

完整check与持有原生启动器的exec均已结束。对54341核对精确可执行文件、隔离根和nonce后SIGTERM，记录退出-15；首进程已消失，原生服务从未启动。最终只读扫描无相关验证进程、1475无监听；未新建浏览器标签或dev server。[清理请求](s33-p2-authorized-20261030/native-cleanup-request.json)、[实际退出](s33-p2-authorized-20261030/native-reopen-01-exit.json)、[最终状态](s33-p2-authorized-20261030/final-state.json)分开留证。生成build／dist／node_modules／target保留；此前53个隔离目录仍全部存在，未删除。本次完整check的53个发现目录和新原生会话也保留；不能称磁盘临时目录全部清空。

| 门禁／能力 | 本轮后的状态 |
| --- | --- |
| 完整check、S0合成Keychain与旧受控调用／生命周期回归 | 已真实执行通过，关闭“未获许可／完整check未跑”这一缺项 |
| P2原生完整动线及两规定尺寸 | 仍技术阻塞／未验；部分启动与设置证据保留 |
| 生产MCP Keychain启用 | 继续硬关闭，`production_credentials()`仍enabled=false、没有启用开关。适配器代码已实现；生产激活需要另行明确边界授权和代码变更，以及MCP自身命名空间的真实OS集成补验。S0条目往返不替代它 |
| 真实普通工作根升级／还原 | 产品确认入口已实现并有真实隔离SQLite测试；本轮没有对普通根执行迁移／恢复，实际操作仍另需授权 |
| 历史原生缺项／第三方MCP／真实旧包兼容／真实模型 | 继续原状态，没有因完整check或部分截图补签 |
| P3／P4业务调用／发送ACK／unknown账本 | 仍后续切片；旧测试实际调用不等于P3接线完成 |

P2整体保持开放；当前没有新增产品修复或品牌修改。两面交付核实结论追加于本目录review文件后按owner既有授权本地commit，push留owner。
