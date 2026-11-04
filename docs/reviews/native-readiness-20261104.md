# G1 800视口与私有就绪失败诊断

基点`01b98f90e3cb2c1cd35654864b8c9f152316a4b6`。用户明确授权G1宽1440×800/窄640×800、旧尺寸兼容及私有/限长/脱敏的失败阶段回执，评审、反例/最小修、回归与完整check后续原A→B；保留身份、精确尺寸、容屏与超时，不改产品功能/显示/依赖/schema，不提交推送。R3、非批量。

## 证据与范围

前次审计修复独立full已通过（Node870/0、默认Rust271/0＋3ignored、双特性31/0），但新900高App只有startup无ready。独立环境探针得整屏1512×982@2、可用区1512×887；FD1/2为dev/null，不能确定实际Tauri失败分支。原失败、私有数据和证据封存不改，详见[审计记录](verification-audit-20261104.md)。800满足当前已知可用高度的必要条件，不预称App一定ready。

仅改固定launcher/既有native-launcher测试、Rust mcp_ui_verification.rs、verification_root.rs和LocalState私有桥接。G1首窗800、CLI/stdin仅G1增加1440×800/640×800；已有640×900、1440×1000与G1专属1440×900保留，旧MCP初窗1000且仍拒800/宽900。原几何判据、完整monitor容屏、定位算法、3秒共享deadline和8秒轮询保持，普通产品构建不启用新诊断桥接，没有新增业务IPC。

## 双面设计与诊断契约

core-v1 fresh A/B均BLOCK：成功info在同步结束前已可见，随后再写failure会产生迟到冲突；旧readFile只有事后限长。core-v2收窄为成功发布前的size/API/geometry/store失败，准备失败只写failure，准备成功只调用原info writer；info创建/write/sync/目录sync出错不再转成新failure，保留原generic失败及既有发布语义，不宣称新持久提交协议。并改为单次最多读取limit+1，保留原权限/身份/稳定性检查。修订后两面均APPROVE。

新G1-only native-failure回执最多4096B，固定kind/version/scope、自身PID、nonce SHA256及静态阶段/原因、实际采到的numeric/null几何；没有原始error、路径、env、模型参数或原nonce。Guard在写前/后按既有startup模式校scope/目录/DB/nonce/model，create_new/0600，不夸大为同UID原子路径隔离。legacy/普通LocalState、未知阶段、不可表示数值等拒绝；负屏幕坐标、outer超monitor和position不同target必须保留，不能过滤真实失败。

consumer先核startup，再按NOFOLLOW/owner600/nlink1/稳定/4096限长读取新failure，严格核字段、nonceHash/PID/argv尺寸和fresh ps。部分failure或先于startup可见时不允许info绕过原deadline；坏文件只输出固定错误，合法failure只输出阶段/原因，不成为ready来源。size_request可能随setup失败退出，仍保留fresh ps拒绝；报告写入失败或成功info自身IO失败可能仍只有通用失败/timeout，不假称覆盖所有情况。

## 已执行回归与交付评审

| 命令 | exit | 结果 |
|---|---:|---|
| `NATIVE_LAUNCHER_SCRIPT=<保存旧实现> npm run test:mcp-native-launcher` | 1 | 最终同一测试哈希：53pass/23fail，暴露800拒绝及失败回执忽略 |
| 当前`npm run test:mcp-native-launcher` | 0 | 76pass/0fail，含新旧scope CLI/stdin、部分/异常/超限/链接/增长/退出PID、真失败观测和禁止ready绕过 |
| `npm run test:s33-verification-guards` | 0 | 36passed/0failed/0ignored；实际phase helper、共享deadline、真实info已完整可读后sync故障不产生迟到failure、私有guard/脱敏/权限/范围拒绝 |
| 默认/双特性Rust检查 | 0 | fmt/clippy通过，最终版本会在独立完整门禁重新执行 |

growth反例在读前文件合法、读取时增长，实际单次请求4097B，未用readFile到EOF。failure的symlink/hardlink负例目标不带failure前缀，触达NOFOLLOW/nlink检查。测试OS open均拦截、只允许确切随包Node/fixture/owned模型进程，不作原生证据。Rust普通build门控和原Root/owner/nonce/精确几何负例保持。

fresh源码交付A/B均APPROVE，12项冻结/候选匹配，原审计修复不变；原始core/批准/红绿/源码before与新冻结位于build/s36-readiness-20261104/。[精选摘要](native-readiness-20261104/verification-summary.json)绑定范围与哈希。

## 独立完整门禁与最终包

fresh独立验证者执行原始`npm run check`一次，exit0、641.212秒（UTC 2026-11-03 21:15:14–21:25:55）：Node29组894pass/0fail，默认Rust271passed/0failed＋3ignored，双特性36passed/0failed。4315输入、58106准备依赖、12冻结文件及三套旧封存稳定。复用依赖/Cargo缓存，不宣称标准clean clone。

专用资源560条/482文件、普通557条/480文件；两包deep strict签名exit0，普通专用入口开根前exit2。仅省略8个具名且实际为空的许可证目录，18个非空许可证逐字节/哈希/执行位匹配。警告均为既有Runtime/Vite体积、ad-hoc/未公证或明确负例输出，未分类0。最终专用exe SHA256为`525bebf8106adc4cf9c9e555e5438d8130cb1211630760a6863e2a636419a6c5`；whole-App清单SHA256为`15f689228ca15ff848ddf0c39a8b0f42c30c46a38bac55f74e4774feff441dd4`。`full/report.json` SHA256为`adb0ee8077293f6e9724e966d0161bf58db0535f4b5ac71c236d54de4e55d536`，完整证据已封存，不再改写。

## 官方CUA原生增量（进行中）

最终专用App在1440×800下就绪，精确尺寸/容屏/身份门禁通过；官方CUA图像及AX成功，原始图未变换存于`native-01/cua/`。没有新建B路线helper、改系统设置或重放旧失败业务。独立observer逐步只读校验原根/WAL、完整表/rowid、配置原件、备份与合成调用日志。

新主根手工录入1项；文本提取1次后候选pending v1、正式事项不增；修改预览1次后候选/正式事项不变；只应用后候选pending v2且未签，正式事项不增；签收后候选accepted v3、正式事项从1变2，新增1条来源关联/签收回执。文本事项完成/刷新后仅其状态与版本改变，手工事项不变。真实CmdQ退出、同根同合成模型owner冷重开，逐表/rowid保持，界面仍为手工待处理1＋文本已完成1，没有重复候选。合成HTTP累计2（提取/修改各1），agent/tool/service调用0，真实模型0。

冷重开配置原始before/after已保存；唯一配置字段差异为派生技能索引`scannedAtMs`，技能安装/扫描状态及既有备份未变，不补签旧人工根的原始before缺口。主根采用UTC时间锚点，界面日期按该锚点核对。

重新打开文本事项后，正式2项均open，仅该事项v2→v3及reopen事件增1。真正升级前快照已保存，今日确认框完整展示v4→v5、备份与旧版兼容限制；确认后只点一次备份升级，不刷新/回车。独立核新增备份version4、integrity_check=ok、schema及10张表全行/rowid与before相同，旧备份/配置/技能原始字节不变，模型HTTP仍2。迁移005实际重建既有`agent_runs`以允许`today_advice`并加partial index，没有新增三张表。

随后首次刷新一次，唯一`today_advice`成功、HTTP2→3，完整事实为签收事项v3和手工事项v1、total/open/undated均2，ranking正确绑定两ID/版本与`open_action`/`undated`理由；工具空、正式业务逐行不变。短暂界面`RUNTIME_BUSY`提示与核对中状态并存，终态成功；保留为未决观测，没有同期锁遥测，不能把同槽竞争假设写成已证实根因。详情历史将签收事项create显示“手工录入”，对应现有固定create标签映射，来源原文及后台`capture_method`/事件来源仍为签收；列为生产UI待处理，不在本次载体范围修复。另一次旧AX索引被工具拒绝、实际点击未执行，已用fresh索引纠正，单列操作错误。

标题只保存一次后，独立核该事项v3→v4及update事件增1，旧成功snapshot/result原字节保持；界面显示事实已变化并保留原标题。刷新一次后新成功对应新标题/v4，HTTP3→4、正式数据不变。经GUI逐次保存`S36_CASE=fail`/`empty`/`hold`，各配置保存均HTTP不增，原有效默认及每次raw-before独立留存。

失败一次为`MODEL_SERVICE`且保留上一成功与完整事实，HTTP4→5；空结果一次为成功/ranking[]、明确空文案且事实2项可展开，HTTP5→6。挂起一次在服务ready后15326ms持久取消（≥5秒且小于25秒），服务记录client-closed；HTTP6→7，越过原期限43843ms后的独立快照没有晚到成功/重放或数据变化，最近空成功保持。恢复角色默认并保存后有效值回到空说明/null模型继承/standard+deadline，新显式advisor文件保留，不宣称恢复原“文件不存在”；正常生成一次成功、HTTP7→8，6条today历史及所有正式业务不被覆盖，工具0。每步有原生图/AX及对应独立只读结果。

初始忙碌提示在首成功、失败、空、挂起和恢复共5次官方工具返回中观察到，首例有原始图/AX，终态均独立核对；仍列为未决，不以成功终态消除。

## 窄窗冷开、键盘与角色增量

真正v5冷开before及关闭后全量核证完成后，原固定`npm run probe:mcp-native -- --reopen <本轮launcher目录> 640 800` exit0。新App同根/nonce/模型owner，inner1280×1600@2、outer(872,182,1280,1600)在实际屏/可用区内；v5全表行/rowid、6条today历史/最近正常结果、正式2项、两备份和模型日志保持，HTTP仍8。配置仅派生`skills-index.scannedAtMs`变化，真实raw-before/after已存；官方窄窗原图及只读滚动显示两项建议和当前性恢复，不需要再次生成。

窄窗空录入表单的标题初始焦点、Tab后类型控件焦点环、Return打开类型菜单/Escape只关菜单、12次Tab循环，以及Escape关录入后焦点返回QuickEntry、Return重开回标题已实际操作并留原AX/图。Tab中HTML content/dialog container两个非控件停点如实保留，不签“完美focus trap”；后台确认没有保存空事项、配置/DB/HTTP均不增。

同根三角色各试跑一次：organizer默认生成1条只读候选，tracker针对固定两项合成样本给1条submission线索（不等于确认完成），advisor针对固定2026-11-02/Asia/Shanghai的4项合成事实（3open/1done）给3条排序/多理由，不混作真实今日事项。每次仅新增对应`role_trial`、HTTP各增1至11；tracker/advisor工具空/无Skills，正式/来源/候选/业务runs及旧角色/Today历史逐行不变。organizer广告Read/Bash/Skills但实际调用0，不当作技能执行。试跑的技能安装状态文件可同字节重写inode/mtime，未声称物理元数据不变。

organizer经GUI显式选择既有P6合成模型、详细表达与“更关注本人执行”，原角色菜单没有advisor的deadline选项，按实际合法值`my_actions`记录，没有新增选项。保存HTTP不增、旧结果仍明示对应旧配置；下一次试跑唯一成功、冻结`modelId=p6-synthetic`/`detail=detailed`/`focus=my_actions`及新revision，模型元数据`detail=true`，HTTP11→12。旧9条Agent历史、正式及相邻表原字节保持。

真正before/关闭核证后原固定CLI宽1440×800冷重开exit0；相同root/模型owner、v5全部数据/10条历史/显式偏好配置字节保持、HTTP仍12，仅派生技能索引扫描时间变化。官方只读设置页与结果页证实偏好和原22:14预览恢复。恢复默认并保存后有效值为null/standard/balanced/空说明，保留显式文件，正常试跑HTTP12→13且模型`detail=false`。

organizer随后独立`role_trial`的fail一次为failed/MODEL_SERVICE/result=null、HTTP13→14；hold一次ready后15763ms持久取消、16336ms客户端关闭、HTTP14→15，名义25秒期限后39367ms的独立快照无晚到/新增请求/重放。再次恢复空说明默认并正常试跑，HTTP15→16，旧失败/取消与其他全部历史原字节保持，正式/相邻表不变、MCP持久调用0。当前14条Agent历史为6today与8role_trial；这些失败/取消结论只属于organizer，tracker/advisor异常、Skills实际执行/MCP等继续，不外推关闭N1–N3或S3.6/G1。

tracker的显式fail试跑独立通过：HTTP16→17、唯一role_trial failed/MODEL_SERVICE、工具空/无Skills，旧14条历史和正式数据保持。下一次hold取消取证为`needs_revision`：跨工具确认后旧AX取消索引被工具拒绝、没有dispatch；服务实际ready后25002ms以deadline结束，持久failed/MODEL_SERVICE，未出现client-closed/CANCELLED。HTTP17→18仅1次、无重放，旧15条历史/正式/配置保持，准确owned额外子进程0。该结果证明合成期限正常生效，未验证产品主动取消路径；旧失败保留，不改写成通过。当前16条Agent历史（6today/10role_trial）。

仅限官方A路线的有界调用编排将一次新case的Start、同owned日志ready核对、6.1秒等待、fresh AX取消组合在单次官方CUA调用内，没有自动重试或新捕获后端。私有纯解析自测先11过/1失败暴露多角色选择漏检，修后12/0；最终使用冻结的真实合成元数据与原AX反例。首次独立评审BLOCK等待后缺少归属重核；仅加2行在fresh AX后重新核同一ready tuple/请求计数/PID，紧邻Cancel核时限。相同driver级内存用例旧3/4 exit1、新7/0 exit0，重评APPROVE，绑定driver SHA256 `c41ca613c7840605c8fe3235fdd15c43e8b65b9f1e9b234bdc0ee260ca3cd7f7`。这些纯内存自测不当作原生证据，原App源码/25秒期限/身份及隔离守卫不变。

经真正新before、固定caller和新0700目录准入，另一个tracker取消case仅Start1/Cancel1，HTTP18→19。官方原图/AX明确取消；独立核持久CANCELLED在ready后6719ms、client-closed6729ms，名义25秒边界后85560ms的库/日志保持，无晚到/重放，旧16条历史（含旧18失败）和正式/配置不变，MCP持久调用0。随后仅恢复有效默认并正常试跑一次，HTTP19→20，原18失败与19取消历史原字节保留。tracker取消能力按新case通过，旧attempt仍needs_revision。

advisor的role_trial fail一次也独立通过：HTTP20→21、failed/MODEL_SERVICE，固定4项合成事实保留、工具空/无Skills，旧18条Agent历史及正式/相邻表不变。advisor caller经独立条件化评审与真正计数21/全部terminal/同owner及冻结/已保存hold/新空0700目录准入后，使用同一冻结官方编排仅执行一次新22。独立核持久CANCELLED在ready后6729ms、client-closed6738ms，名义25秒后77773ms的库/日志无晚到/重放，HTTP21→22；旧19条Agent历史与正式/配置保持，工具空，固定4项事实仍可见。

随后GUI恢复advisor有效默认并保存，显式文件保留；正常试跑一次HTTP22→23，3条合法建议与固定4项事实恢复，旧20条历史和正式/相邻表不变、MCP持久调用0。三角色的成功/预期失败/主动取消/恢复均分别有官方UI与独立后台证据，偏好显式覆盖/默认恢复/冷开及角色历史分离按上述实际子项记录；不据此关闭其余原生矩阵。当前21条Agent历史（6today/15role_trial），合成HTTP23、正式2；旧18失败及旧评审BLOCK不改写。N2仅完成只读before：MCP无配置、合成技能目标不存在、3份技能状态原文及内置完整文件清单已留，尚未新增技能或执行Read/Bash。Skills/MCP及其他未验保持，G1不关闭。

## Skills 放置、重扫与实际执行

N1记录及N2模板计划独立APPROVE后，只在原不存在的合成目标目录排他创建3个冻结fixture文件与3个目录，文件0600/目录0700；没有覆盖原内置包、改索引或直接写业务库。独立核原工作根441个内置文件和App/repo各444文件的内容/执行位保持；App中包外3文件另列，不误称工作根漏装。产品界面实际只提供完整目录放置后重扫，未将此步骤记成GUI导入。

官方GUI只重扫一次，可用技能18→19，选中`s36-reader`可见准确描述与3文件。独立核原18项逐项不变，只增合成包/技能条目及合法revision/scannedAtMs；安装清单原字节保持，inode/mtime同字节重写另记。新包hash为`5c9f810b925d33d52440b9ed5d44e7122bc50554afd2ea1f323e6a2d9446a941`，没有把索引通过当作执行通过。

恢复默认的organizer仅试跑一次，官方原图/AX显示1条只读候选；唯一新`role_trial`成功，合成HTTP实际23→27的4轮均属于同run，模型实际结果序列为0→1→2→3。真实Read分别返回191B冻结SKILL正文及32B相对引用，Bash调用冻结脚本，stdout为`g1-skill-ok\n`，本次run产物为精确11B的`g1-skill-ok`。`skills-proof`精确Read2/Bash1，路径/包hash/run/命令hash相符，脚本的transport控制环境名检查本次通过。未单列数字exitCode，产物原权限0644如实留证；不扩称Bash有OS文件沙箱。

旧21条Agent历史及全部正式/邻表/rowid保持，新增后22条（6today/16role_trial），正式仍2项。角色/app/3份技能缓存原字节均保持，旧run文件不变，只有新run的447文件；源12/完整包567/签名与三进程完整身份复核通过，额外owned子进程0。持久MCP `tool_calls`仍0且无服务配置/服务日志0，**该0只属于MCP账本，不表示本次Read/Bash未执行**。独立报告`native-01/verifier/skills-organizer-execution-result.json` SHA256为`a57eac1390474b27d9a17f64eb28ae85b907e5fd07835934f97e8c3e738a9b0a`。真正stdio保存前基线已另取；MCP尚未保存/诊断/调用，N3与整G1继续开放。

## stdio 配置保存检查点

N2记录独立pass（4阶段/28证据引用SHA/12份CUA原件SHA）及stdio分步计划APPROVE后，新鲜准入核HTTP27/Agent22/正式2/全terminal/无MCP配置及同源/包/owner。官方GUI粘贴固定输入并只保存一次，识别单项stdio、5参数/1非秘密环境项，终态为已保存/已启用且无诊断记录。独立核唯一新增`mcp/servers.json`为UID/mode/nlink及原目录身份合法；规范化仅type→transport、环境对象→literal数组，其余内容严格匹配冻结输入，原22条Agent/全部业务/配置/Skills/N2产物与日志保持。HTTP仍27、服务日志/持久MCP调用/新增probe均0、额外owned子进程0，证明本保存未启动该fixture。诊断和实际调用仍未执行，等只读PID监测就绪后才分别推进；不能用保存成功代替连接成功。

stdio诊断前的只读监测01因字段冲突实际exit1，02未取得足够循环准入证据，两者均零诊断/零服务动作并保留；03经顺序自测4/0及实际guard后loop-entered/存活/期限核证才准入。官方CUA在期限内仅点一次连接诊断，界面显示发现`lookup`1项、进程已清理，展开只读schema与实际目录一致。独立核唯一新`mcp_probe`成功、server/revision/schema/catalog及持久回执绑定正确；HTTP仍27、MCP工具调用0，旧22条Agent及所有正式/邻表/配置/技能/N2产物保持，当前Agent23（6today/16role_trial/1probe）、正式2项。

**该次诊断总体为needs_revision，未进入实际试跑。** 03实采到service的PID/PPID/UID/lstart/完整命令及随后退出；cwd只由固定fixture自报匹配，独立lsof已退出而未取得。child没有任何历史PID/UID/start/命令/cwd/父子记录，不能事后补签其执行或清理；当前额外owned进程0只证明当前快照。环境只实测到service的合成标签及`modelKeyPresent=false`，child及transport控制环境名检查未实测，不外推N2。异步child自记录与快速收尾的关系仅为源码支持的可能性，没有证明产品清理缺陷。分层报告`native-01/verifier/stdio-diagnostic-attempt-01-needs-revision-result.json` SHA256为`30b72a57415c2ef7ab28f2a0aed56fbad9ee1ab0f46fe897deca666e6c028d78`，稳定停点SHA256为`b684beaa6212e440e3d4d4d71ca9641194fae4ad09a2b1422b9e8037f41bd03d`；不重试、不新建服务/监测或推进依赖的trial/HTTP，另待取证方案及授权。

同时仅在忽略的build目录准备HTTP元数据观察封装，未启动。设计首轮将已发出调用的主动取消预设为cancelled，被独立评审阻断；已按现有unknown/MCP_RESULT_UNKNOWN契约修订，GUI动作与账本终态分列后准出。封装交付评审又以实际wrapper/fixture源码的纯内存server/fs复现异步异常泄露及graceful→fatal状态丢失，保留旧BLOCK/反例后最小修私有封装。最终纯模拟20/0及syntax0经独立复跑/复核pass；旧graceful→fatal同反例仍1过/1失败、exit1，修后2/0。历史误名`clean-eof`实际是显式stop，真正EOF另证`stdin_end`；stop回执不充当持久exit提交。这些测试没有真实监听或AppRoot写入，也不作为HTTP/原生通过，真实FS/网络/生命周期和启动准入仍待验。App及产品源码/包未因此变化，原完整门禁封存不改写，不无故重复full。

owner已明确授权新增独立生命周期补证：先细化/独立评审私有观察屏障与release，补反例/最小实现后，同App/临时根/固定Node只改一次测试配置、诊断一次，完整身份与清理通过后恢复原N3。设计从v1的动态归属/发布/失败尾段缺口修到v4，原件和needs_revision均保留；v4 SHA256为`2020539e7312a1fa82f93ae3197af12028a549aa27bbcdcf6419857820e8b9ee`，fresh互盲A/B均APPROVE，仅为设计准出。新增disabled诊断代理，保留原enabled normal与冻结fixture/App；真实目录按字节暂存，proxy独立OS祖先/run/nonce与typed held响应逐项绑定，FIFO完整帧引用已sync的完整证据，held-ready也有单次完整LF发布规则。1500ms/原3秒预算及失败后的有界只读尾段保持，不伪造结果。初个实际冻结fixture源码的内存反例已跑：旧无屏障路径1过/1失败、exit1，证明目录可能早于child自记录返回；真实进程/Root写0。实现/交付复核和唯一原生补证仍待，不因设计通过签运行。此前报告“未授权”仅对应当时快照，新授权不回填旧attempt。

生产MCPKeychain关闭、真实模型未调用，仅合成资料、本机受控服务和owned临时根；不读.env.deepseek/真实预算/真实用户根，不改依赖/Cargo/001–005/schema/identifier/vendor/resources/系统。旧HTTP02差异、H3/两类MCP整合/独立无模型/其余键盘与重复操作、S4/S5及真实/安装/CI/其他机器未验保持，无commit/push。

### 独立补证的实现前事实纠正与交付候选

v4设计后独立复核确认，冻结Native UI不初始化生产信号审计，也没有持久owner/end原始日志；原审计必需项的可得性假设错误，旧设计/批准均保留并追加纠正。按两面技术裁决，清理结果改用完整活体OS身份/独立cwd/run与组归属、生产成功门禁及真实退出联合核验；信号发送者/顺序仍未验，不用私有日志冒充生产审计，不改App。随后发现wall时间不能排除单调watchdog，经收敛选择更小的既有release因果锚方案，保留全部1500/4000及产品时限，不新增点击通道或重武装。

最终设计v7 SHA256为`00b39c86b47f13bbdbdc8f7db9ab65c35213e06702b67abd9674335ab4bfcb4b`，两面设计APPROVE：唯一FIFO写前M、完整转发F-S<1500、所有目标及Runtime缺席查询完成上界A-M<1900、可核时间误差E<=100，再连续600ms确认及原10秒尾段。实际冻结Node/libuv的连续时间源与Python默认时间域不同，辅助观察使用只读相同连续时间源；时钟异常/来源不明失败，未调整系统。

私有实现候选已冻结，Node67/0、Python33/0及语法检查exit0；测试包括实际冻结fixture源码的内存监督链、独立合成OS/ledger、私有真实FS/FIFO和合成SQLite WAL，只证明相应辅助层。过程中已用反例暴露并最小修复start/raw证据绑定、共享deadline、log先验、完成转发凭据、提前watchdog回调及文件/FD收尾等遗漏；旧红证/初次夹具调度错误保留，不冒称产品缺陷。`delivery-freeze-v1.json` SHA256为`be9f544100244c283ad85dfee15cb32b453b3385099a13bbc66748f13f24a9b9`，fresh互盲交付A/B正在只读核证。当前未新增实际case目录、未改一次配置/诊断计数、未启动真实MCP/观察器或HTTP；实际补证仍未验，原stdio停点/全部其他未验保持。

### 独立交付首轮阻断与最小修订

首轮交付A/B均为needs_revision，不能用原67/33测试结果放行。A以实际观察循环复现缺forward-start仍接受完成事件、未知OS状态后消失仍可通过，以及第二次独立cwd未采；B复现SQLite对原路径mode=ro仍创建或改写WAL/SHM，并发现只读utility初始化异常未完整回收。旧冻结、反例红证和BLOCK报告保留，均属辅助取证实现问题，不归为产品生命周期缺陷。

最小修订要求完整有序且同身份/响应的start→forward-start→forward-completed事件链、拒绝未知macOS状态、两次独立cwd一致，并将utility启动/selector失败纳入自身子进程回收。原根SQLite读取方式另经双面方案pass：原DB/WAL仅O_RDONLY双轮稳定读取，拒绝rollback journal/非WAL/变化，SQLite仅连接私有WAL-aware副本；单文件64MiB、最多8快照/共256MiB，不删除旧证据，所有IO仍计原时限，不承诺原子事务快照或OS atime不变。

修后实际Node67/0、Python39/0、A反例3/0、B反例3组/0，全部exit0；B已实际验证closed与active WAL源目录/字节保持且读取当前提交。新增并发WAL用例初次缺少预提交导致未触发预定写入，测试前置修正后通过，原失败如实保留。新delivery-freeze-v2.json SHA256为`3ec5a4a3b4b0a99f3576e7606c059355314a88425152eaa03a1e528c52153771`，16源/测试文件，fresh互盲交付A/B重新核证中。当前唯一实际补证仍未执行：新增配置/诊断/服务/观察CLI均0；旧normal历史未验不回填。


交付v2的fresh互盲复核再次needs_revision：A以完整合法forward链控制样本证明最终只读检查可跨10秒期限或ClockFence失效后仍误pass；B以真实自建FIFO证明普通文件入口在fstat前阻塞，并注入首次fstat错误复现FD泄漏。新回归先红（Python5个FIFO超时＋1个FD失败，Node私有文件7过/3失败），再仅为普通文件入口加NONBLOCK并保留类型拒绝、把初次fstat放入FD保护、最终检查后重核原期限/ClockFence。原时限/协议/产品/App不变。

当前v3冻结SHA256为`fe01d6f139a786665e6cfb984df6a81baa75120b101af3d0c2896edf03434a09`，17文件；固定随包Node70/0、Python41/0、原A反例3/0、原B反例3组/0、最终边界3/0及语法exit0。复跑B时一次漏传observer参数，实际选择旧v1并得到原3组红证，已由receipt核清并保留；随后显式绑定当前源通过，未误记成当前回归。两面正在对v3有界复审，尚无新增实际case/保存/诊断。历史后台mode=ro/query_only的业务只读证据不等同SQLite sidecar物理零写证明，本次改用私有副本，不能倒签旧次物理零写。

v3有界交付复审A/B均pass，报告SHA256分别为`3e4b4a21e937142f0d66269457b429e343df051fcf391de159958ba64a99f902`与`cccf49824ff4a512bf983f87e808ba155c27d7587358ed65dc6e4c35b70e7ba1`。两面独立复跑上述70/41/各3反例及语法并核17文件前后稳定，只签私有辅助交付。固定随包Node另外实跑prospective manifest形状5/0；未调用实际loadCase，也不作为实际Root/监测准入。后台核对工具仍在合成补测，现场准入/唯一保存与诊断未执行。

独立后台核对工具另外以先红后修关闭初次fstat泄漏及实际stdio快照省略transport的识别问题，17/17与AST通过；Root复跑/静态审读后仅授权一次fresh before读取。该次实际exit2：scope-directory-set-drift，发生在SQLite副本读取前，未生成before快照，不签完整准入，也未改配置/启动服务/诊断。只读对照冻结Rust NATIVE_DIRECTORIES与旧归档已定位为根目录`""`和Python相对路径`"."`的表示差异；正在补合成回归及最小工具修正，旧准入失败回执保留，不归为实际目录漂移。

后台工具根目录表示修正后，实际before读取第二轮exit2/FileNotFoundError，仍未产生完整快照；错误为将归档扁平文件名误当现场mcp目录下路径。冻结mcp_catalog存储与旧runFiles一致表明目录文件属于runs/<probeId>/mcp-catalog.json，正在补实际路径/结果hash绑定回归，只改私有核对器。两次实际只读准入失败均保留，不签当前完整计数，不消耗唯一GUI保存/诊断次数。另对“正常清理会触发proxy失败”假设，两面基于实际guardian只STOP/KILL整组且不转发EOF的源码独立驳回，v3保持，不为人工SIGTERM/EOF改正常终止分支。


## 独立补证当前停点：官方捕获再次失败，原生未验

最终私有barrier v3双面pass，固定Node70/0、Python41/0、A/B及最终边界各3/0；后台核对器经实际路径与权限前置修正，默认环境及022/077回归22/0，2AST通过。旧交付BLOCK、红证和两次只读准入失败均保留。第三轮完整fresh before实际exit0：23条Agent全终态（14成功/5失败/4取消，6today/16role/1probe）、HTTP27、正式2/open2、持久MCP调用0；3991旧run、7配置、2备份、全表当前rowid/schema、原normal元素/原件、12源码×2和567包条目、10目录及三owner前后身份均核对，scoped extra0。历史归档未直接存rowid，本次仅钉住当前完整before，不追溯补签历史逐项rowid。

进入任何新配置写入之前，官方`recordNative('stdio-supplement-before-save')`实际返回工具-10005 / ScreenCaptureKit SCStreamErrorDomain **-3812**（参数无效）；唯一一次同canonical专用App完整路径重绑也返回相同错误。按owner“捕获仍失败，保留未验”边界停止GUI，未改系统、重置捕获器或切换取证后端。没有生成本次截图/AX原件、实际case目录、新配置保存、新诊断、barrier observer或MCP服务，依赖的原N3实际试跑/HTTP未开始。`official-cua-stopped.json` SHA256为`1f0c79e2443dc2a9d06e8d42737da3b21e9e02661d8e9daf3ee8cfa5e2963c3e`；不据后台准入或私有测试关闭该原生边界。

随后独立只读checkpoint实际exit0，再次assert_initial并逐表/rowid/schema、源DB/WAL字节/metadata、配置、run/backup/log/MCP原件与完整before比较均相同；三owner仍活体、额外受控子进程0，HTTP27/Agent23/正式2/MCPcall0保持。checkpoint SHA256为`8259c2b104aef072867017b1cb81ef518169d4910b28dbd34c9821eb9351e941`，原始快照SHA256为`5fcfbbdc5c13581a327b7fc0f28b5ce701dce09d32ef0dc881fb8508bea6ef7c`。专用App与既有合成模型/runner有意保活，未发业务进程信号、未删除Root或证据；准入登记当前无在跑项，无待释放资格。

本轮变更仅在ignored build私有辅助工具/测试及本文、精选摘要/实施状态；产品源码与冻结App/原fixture未因补证改变。完整npm run check仍是此前641.212秒封存结果，本轮未重复执行，不能把新私有工具测试写成新full通过。当前结论：**私有辅助交付pass；原生补证needs_revision/未验证，原normal历史缺口、其余N3/N0/N4/N5与整个G1继续开放。** 恢复官方取证后再续原一次Save/一次诊断；改变验收证据方式需要另行确认。本轮无commit/push，真实模型/业务服务/生产MCP钥匙串与真实用户根未触碰。


## Owner 改向与验收现场收尾（2026-11-04）

owner明确停止在捕获补证上继续投入，要求恢复现场、提交已有改动后立即推进G1剩余功能。此指令将原生未验项转为保留待补，不自动关闭它，也不再把本次截图阻塞作为其他独立功能开发的前置条件。

实际仅对fresh UID/lstart/完整命令SHA匹配的专用App发送TERM，确认PID退出后通过既有runner的stop-model协议结束合成模型及启动器（exit0）。三个登记PID均不存在、62489监听0；未按名称杀进程、未删除临时根或备份。原根只用稳定DB/WAL复制到私有副本核对，全部表/rowid/schema/userVersion与退出前相同，Agent23、正式2、MCPcall0，servers/model/service日志原字节相同。补证配置保存和诊断仍0，无需恢复配置。cleanup结果SHA256为`e8595f45c924684d95a58e1311f703eb4321a96470ec492a1fbfbde1477e6a15`（原始证据build/s36-readiness-20261104/native-01/owner-directed-cleanup-result.json）。首个审计调用因缓存路径非绝对而拒绝，修正调用路径后复核通过，未改核对工具或Root。

窗口适配/私有就绪失败回执和验证审计整行写入已具独立源码评审与冻结完整门禁，按owner要求纳入本地提交；ignored build的临时辅助程序与原始产物不纳管。G1后续按既定S4桌面使用/S5恢复出口及已确认产品缺陷继续，真实模型/生产MCP钥匙串/用户根等边界保持。


提交前独立范围复核pass：main/candidate的12冻结源逐项一致，4315封存输入中所有非文档输入未变，旧完整门禁的日志SHA、894个Node/271个Rust＋3ignored/双特性36与脚本闭包均独立核对，可复用封存full；未执行新full。当前结构/文档/diff检查独立exit0，7新增交付文件（3记录/3JSON/1合成JPEG）隐私复核通过，源码与测试不依赖ignored私有补证程序。

Root另执行聚焦复核：主树未准备包时launcher在setup因App fixture ENOENT失败；同字节候选cwd、显式主树NATIVE_LAUNCHER_SCRIPT复跑76/0 exit0。主树旧organizer bundle SHA532691…与冻结08f32…不一致，首次Rust verification为33/3且三个MODEL_AUTH；执行既有npm run probe:bundle（exit0、仅既有体积提示）后organizer与冻结字节匹配，再跑test:s33-verification-guards为36/0 exit0。未放宽断言或改源码；测试前置/旧失败如实保留，聚焦测试不作为原生GUI通过。
