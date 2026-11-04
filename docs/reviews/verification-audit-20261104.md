# 验证审计 JSONL 并发写入最小修复

基点 `01b98f90e3cb2c1cd35654864b8c9f152316a4b6`。用户明确授权独立修复验证审计整行写入与失败拒绝，先反例、最小修、回归评审，再完整check续原生；保持生产行为、信号与清理语义，不提交推送。R3、非批量；范围仅Rust验证特性模块和同模块测试、文档证据。

## 问题与范围

前次窗口适配的独立完整check实际exit1/150.151s，18组Node共755pass/1fail；失败用例为未改动的`SIGKILL runtime still cleans owned group with unrelated control alive`。575B原始signal-audit记录中，一条Rust JSON的run字符串内部插入完整cleaner JSON，再接回Rust尾部。原件、解释性分析、失败及128文件封存保留在build/s36-g1-viewport-20261103/full/，不修复原日志、不跳坏行、不把它归为尾行截断。详见[前次记录](s36-native-resume-20261102.md)。

Rust验证写入使用writeln!直接格式化Value，会跨多次底层write；Mutex仅约束Rust进程，不能约束继承同一FD3的Node cleaner。Node已有单次writeSync整行追加，本轮不改worker。Rust模块只在s33-mcp-verification启用，普通构建不编译它。

## 准出与实现

core-v1经fresh A面APPROVE，B面要求把“失败停止发信号”收窄为对应单次信号；core-v2明确失败的该次写入对应信号不发送、reap当次返回、cleanup_owners后续阶段及Node独立writer不变，不增加全局失败锁存。修订后fresh A/B均APPROVE。

先把旧writeln!原样提取到私有write_audit_record边界，字段、锁和返回语义保持；在此真实序列化路径加入确定性Writer：第一次write后插入一条独立合法cleaner记录，严格逐行解析并比较两条Value。另测短写、0、BrokenPipe和一次Interrupted后可写。取得红证后，仅把私有helper改为在内存形成完整UTF-8 JSONL再执行一次Write::write；只有返回完整字节数才成功，短写/0/Err均false，不续写或重试。

原append/0600、Mutex、审计字段、FD3继承/服务隔离、身份校验、signal/reap/slot路径均保持；既有真实File只读、poisoned锁及真实reap gate测试逐字保留。新测试只使用owned内存Writer，短写替身仅保存实际接受的前缀，不填满磁盘或修改系统。该修复消除已观察到的格式化分块交错面，不承诺I/O故障、短写或崩溃后的日志事务性。

## 已执行验证

在新的0700私有候选中检出精确HEAD并叠加已批准的窗口两源及本项Rust源；依赖/旧target仅独立APFS复制，58106准备条目逐项一致、链接落新树、普通文件inode独立，Cargo离线。旧封存full和候选未改。此为缓存辅助候选，不是标准clean-clone准备证明。

| 命令 | exit | 结果 |
|---|---:|---|
| 红阶段 `npm run test:s33-verification-guards` | 101 | 28 passed / 3 failed / 0 ignored；交错JSON、短写续写、中断重试真实失败，尚未应用单次写修复 |
| 修后同一命令 | 0 | 31 passed / 0 failed / 0 ignored；测试与红阶段完全相同 |
| `npm run check:rust` | 0 | fmt/default clippy通过 |
| `npm run check:s33-verification` | 0 | 双特性clippy通过 |
| `npm run test:s33-discovery` | 0 | 77 pass / 0 fail；原SIGKILL runtime失败用例实跑通过，原清理/FD断言不变 |

交付fresh A/B源码评审均APPROVE：12项冻结在主仓库与候选匹配；红→绿只有helper实现差异，所有新增测试字节相同；原全部审计能力测试保留；没有扩大对应信号失败拒绝为全局清理保证。记录、源码副本、红绿/原始回归日志、新12文件冻结在build/s36-audit-record-20261104/；[精选摘要](verification-audit-20261104/verification-summary.json)绑定关键哈希。

## 当前结论与未验证项

源码评审、聚焦回归与新的独立完整check通过；随后按批准的新root、1440×900与原A→B协议实际启动，但仍未取得就绪回执。审计修复已取得完整机械证据，原生与S3.6/G1继续开放，也不以新通过改写前次full失败。

## 新独立完整门禁

fresh验证方只执行一次原`npm run check`，exit0/618.810s（UTC2026-11-03 16:32:21–16:42:39，对应北京时间11月4日）。实际29组Node870pass/0fail；默认Rust271passed/0failed/3ignored；双特性31passed/0failed，分列不混计。原discovery组在full中再次77/0，launcher52/0。4313源/文档输入、58106准备依赖、12freeze、主仓库非文档输入与旧封存均前后稳定。

最终专用资源560entries/482files、普通557/480；Runtime源563项到包内555项仅省略8个本次确为空的命名许可目录，18个非空许可文件严格匹配bytes/SHA/ownerExec。两包deep strict codesign exit0，普通包排除受控fixture，未公证/ad-hoc边界保持；无新增无法解释警告。最终专用exe SHA仍f36318746fb17c1c541c4506433cb32382659577069f6eaf37c1f778c20217e8。候选范围进程、已知PID/PGID、cwd及监听无残余，不作全机unknown0声明。

完整报告/日志/输入与产物清单封存在本slice full/，Root逐项回读1078个路径的bytes/SHA和已记录ownerExec一致：1076个regular路径及2个指向同证据目录内的负例symlink引用。Root首检误假定全为regular而exit1，按原seal的跟随字节语义限定链接目标在本证据目录内后复核通过，未改seal或原文件。原失败128文件仍不改。

## 后续原生启动仍未就绪

使用本次full最终canonical专用包，实际执行`npm run probe:mcp-native -- --g1 <新native-01/launcher目录>`，exit1：`G1 startup identity and ready receipt disagree.`。请求尺寸确为1440×900，startup完整身份正确、无native-info；没有重试、getApp、AX、截图或业务操作，B工具尚未创建。本次是启动就绪失败，不是新的-3811捕获复现。

独立只读Swift/AppKit环境投影（保留源码/命令/SDK/哈希，无App控制/AX/捕获/权限申请）：NSScreen.frame为1512×982@2，visibleFrame为(0,62,1512,887)，菜单栏33/Dock底部62逻辑留白。900内高已超过可用高887；之前900建议只依据整屏高度，未核清可用区。Rust仍按完整monitor居中并等待精确position，存在可用区域必要条件不兼容；没有取得未ready App实际窗口尺寸或具体Tauri失败分支，不能称唯一根因。App FD1/2都是/dev/null，现代码只发通用错误，因此仍需有界失败阶段证据。

临时库v4、quick_check=ok、FK0、业务表0，model/service持久日志不存在。初始完整身份重新核对后仅TERM本轮App，三个known PID、scope进程/cwd及55985监听均清零，无KILL；Root/证据保留。独立23个原生诊断证据文件封存，Root逐项bytes/SHA复核一致。

当前已向用户申请下一独立增量：专用验收改固定宽1440×800/窄640×800、旧尺寸历史兼容保留，补私有/限长/脱敏的就绪失败阶段回执；先评审、反例/最小修、回归与完整check再续原A→B。未获明确授权前不改新尺寸/App侧诊断，不调整系统显示/权限、不放松身份/精确尺寸/容屏/超时门禁。审计修复结论pass，原生结论needs_revision。

生产MCP钥匙串保持关闭，仅合成模型/资料、本机受控服务与owned临时根；未调用真实模型、未读取.env.deepseek/真实预算/真实用户根，依赖/Cargo/schema/001–005/identifier/vendor/resources/系统不变，无commit/push。旧HTTP02差异、剩余角色/Skills/H3/无模型根/键盘/重复操作、S4/S5、安装/真实服务/CI/其他机器等未验证项保持开放。
