# S4 桌面偏好与人工验收补记

基点：`e91bbc1556ab3731742cea4fb97d65b981d441b5`。本项新增跨进程契约，按仓库验证约定为R3；不变更依赖、数据库、迁移或应用身份。本地提交已授权，不推送。

## 前项人工反馈

owner在本聊天反馈：“我验证了一下，快速录入、主窗同步和托盘入口都正常”。对应前项从e91bbc1构建并启动的既有Sidekick Profile Verify独立验收身份；沿用其独立数据，无模型或MCP服务配置。原始启动元数据保存在`build/g1-functional-20261104/manual/`。

此为owner人工观察证据，仅签快速录入、主窗同步、托盘入口；没有新增截图、自动化原生操作或独立后台事务核对，不外推快捷键冲突、拖拽、透明、多屏、安装及旧MCP缺证。

## 规范与评审

规范核心见[实施计划§22](../product/05-第一阶段实施计划.md#22-s4桌面偏好切片规范核心)，原始证据保存在`build/desktop-preferences-20261104/`。

首轮独立方案审查BLOCK/reject，指出两项：新增IPC须按仓库提升为R3双面；首次无根读取失败后，仅主窗刷新不足以保证三窗收敛。修订版将初始化成功广播到全部存活生产窗，并保留丢通知后的聚焦/可见恢复。v1快照SHA256 `18484e3551774df5fa71033b3f5e165a0c38e819e9673f560ee6cc4699ec7022`原样保留；v2快照SHA256 `b3883fc634902875837f24f03e89fa225c067912e98585981aca8e113f73ef6d`，fresh互盲A/B均APPROVE/pass后进入实施。两面无必需修正，提示启动显宠不聚焦、后台补读不绕过显式核销；两者已落实。

## 聚焦实现检查点

先补Node反例（新模块尚不存在）：`npm run test:s1-domain` exit1，原38项pass/新增文件1fail；Rust新契约用例在实现前`npm run test:desktop-preferences-store` exit101，31个缺失类型/方法编译错误，不能冒称运行断言失败。最小实现后Node48pass/0fail（含实际DesktopSettingsPanel、SkSwitch/SkFieldset/SkSaveBar/SkButton与TDesign组件的SSR），Rust临时根6pass/0fail，既有desktop-host2pass/0fail。

`npm run typecheck`、`npm run build`、`npm run check:rust`、`npm run check:structure`、`npm run check:docs`及`git diff --check`均exit0。结构守卫19类与8引用负例、191源/432引用；文档15文件236链接；Vite只有既有chunk体积提示。六项存储用例核缺文件不写、保存/重开、业务事项/历史/数据库版本及app.json保持、冲突、坏文件/未知字段/未来版本、文件软/硬链接及目录链接拒绝、写前/写后/读回故障。只用临时根，故障注入不是断电验收。

三窗监听先于读取，焦点/可见回读并清理迟到监听；初始化广播与保存通知均无业务载荷。保存通知失败仍返回已保存并给同步警告；结果未知后的背景回读可以更新呈现但不恢复编辑准入，必须显式重读。桌面草稿由当前窗口Pinia持有，分类切换不销毁；App拥有监听及DOM减少动效标识。普通包启动读取当前持锁根，只show宠窗不set_focus；特殊验收feature在读/存/装配同步前拒绝。生产钥匙串状态未改。

首版源码/测试14项冻结在`source-freeze-v1.json`；默认和双特性Clippy均exit0，邻域`test:layout-domain`14pass/0fail。此为首版聚焦证据，尚不能替代交付审查及完整门禁。

## 交付首轮发现与最小修正

fresh A/B均needs_revision：A面两项P2是桌面分类重挂载自动load()绕过显式核销、dirty草稿后台读推进saved/expected而可覆盖权威配置独立变化。第二项需要独立配置更新，当前真实可编辑入口只有主窗，未声称第二个设置窗已经存在。B面P2是锁定tauri-runtime-wry 2.11.4→tao 0.35.3的macOS show路径会请求makeKeyAndOrderFront，因此“没有调用set_focus”不能证明没有获取焦点；首版上述启动描述不能作为不抢焦点证据。

将A两项固化为tracked真实SFC挂载与客户端交错反例，`npm run test:s1-domain`旧实现exit1（48pass/3fail），修复后exit0（51pass/0fail）。仅把挂载读改为后台load(false)，dirty期间发现权威配置变化则保留原编辑基线并撤销ready，显式重读后才放行。B项改为构造pet时读取已确认偏好、focused(false)/visible(petOnStartup)，去掉构造后show；锁定tao构造路径visible且非focused走orderFront，Webview也初始不聚焦。此为代码/依赖调用路径核实，原生焦点结果仍未验。原v1全部14源保存在`source-v1/`，没有篡改旧反例或冻结清单。

规范核心v2未改。修订源码/测试14项在`source-freeze-v2.json`，SHA256 `315f3372f48e8d020490de8a1c60be5ea6164c3e16954a0a535dbf6233aea9b7`，入库精选副本为[source-hashes.json](desktop-preferences-20261104/source-hashes.json)。

## 修订版独立交付复审

fresh A/B复审均pass，无新增必需修正。A独立`test:s1-domain`51/51、typecheck0，重挂载反例2/2、交错及可见恢复3/3；B独立存储6/0、desktop-host2/0，核锁定Tao/Wry构造路径不再执行首版的show→makeKeyAndOrderFront。两面均核14源/core前后不变、干净检出输入可得，docs检查15文件236链接及diff检查通过。依赖调用路径核实不等于原生焦点已验。

修订版`npm run build`、默认及双特性Clippy均exit0；仅既有Vite chunk体积提示。代码稳定后交由独立验证方运行一次原始完整门禁，结果如下。

## 独立完整门禁：pass

`npm run check`唯一一次exit0，662.72秒；北京时间2026-11-04 17:40:55–17:51:58。29组Node930pass/0fail，默认Rust279pass/0fail＋3ignored，双特性verification37pass/0fail（280filtered），launcher76/0。三项ignored仍逐项保留：两项真实模型、一个由受控父用例调用的子进程入口，不能把ignored记为pass。生命周期12项含10场景、23次合成stdio调用；synthetic-budgeted六次保留/转发/完成，真实模型请求0。系统nonce Keychain合成探针通过不代表生产MCP钥匙串或真实凭据验收。

普通/专用两包557/560资源，deep strict签名、普通包/Runtime受控夹具排除均通过；普通专用入口负控exit2，在开普通根前拒绝。两包本地ad-hoc、未公证，不是GUI或安装验收。普通exe SHA256 `e8254723051f49effd78268910f7d17e2007d3e0c94aa39458ff1e6301dd45df`，专用`a79d2f471259841d6bceae32e8d1fdfd942077bc3007681be167acb94de210fc`。

警告只有既有14条esbuild（7次bundle各2）、2次Vite chunk、2次未公证提示。宿主proc-macro配置负控/host与wrapped正控按探针判定passed，另2条wrapper成功信息；新未归因警告0。结构191源/432引用、19类与8引用负例通过；完整check时docs15文件236链接。14冻结源/core、2858个保护文件及现有Profile Verify可执行文件SHA前后不变；不等于对历史验收包内容重新审计。

完整JSON SHA256 `a0d8483bd9589fa70053dc86b85b2247863083803d3d976eb980b58c121ada5c`；原始日志SHA256 `9a17cf62857ee1b09089540691c7846af0146fe5d7857010db11cd0e1abca60e`。原件与11文件哈希清单在`build/desktop-preferences-20261104/full/`，0600；入库[精选验证摘要](desktop-preferences-20261104/verification-summary.json)与14源清单，保留全部首轮失败，不覆盖原件。完整门禁后只补事实文档，最终文档另查链接，不重复完整门禁或冒称已经检查后写文本。

## 尚未验证

本项新原生动效、多窗/冷启动显宠和焦点动线尚未执行。保持生产MCP钥匙串关闭、不读取.env、不调用真实模型、不动真实用户根、不改系统启动项；历史S3.6/HTTP/stdio、位置/多屏/登录启动与其余S4/S5未验继续开放，G1未关闭。干净检出、CI、其他机器和安装仍未验。只签实现、合成/编译及完整机械门禁通过；按本轮授权本地提交，不推送。
