# 空态与图标按钮一致性修订

基点`1f3bed98474311f9574fc8de0e9341cf33244fa9`。owner提供今日、待确认、全部事项空态及快速录入按钮原生截图，要求统一提示与符号/文字对齐和高度。R2共享前端展示/样式、单一可回退切片。沿用G1评审验证后本地提交授权，不推送；合成/loopback/临时根，生产MCP钥匙串关闭，不真实模型/凭据/用户根，不改后端/IPC/schema/依赖/identifier/系统设置。原生App在代码验证期间保持原样。

## 归因与改动

三个空态原来分别是按钮优先、标题优先、带插图；Today另有44px局部入口，与常规38px按钮不同。SkButton的TDesign内层文本容器没有居中和间距，外层flex不能对齐内部图标/文字；kbd额外高度把徽标按钮撑高。真实浏览器红证（`test:desktop-controls` exit1、0pass/4fail）确认当前图标17px、内层gap0、徽标/同排按钮42px、Today缺统一标题层级。后续补测还确认载入符号12px/文字间距16px，单独红证2失败保留。

新增纯展示SkEmptyState，统一标题/说明/操作，无默认插图；Today整体空时不再堆叠两个空分组与首次按钮。首次数据、历史无待办、实际筛选无结果、隐藏历史与原文零结果分别说明，只有实际筛选存在才提供清除筛选主操作。加载/错误不冒充新空态，旧行数据不清掉。录入/整理入口仍使用原处理函数，没有新增模型或签收调用。

公共样式统一内部文字容器、16px图标及载入符号、8px间距、20px徽标；普通38px、原紧凑30px。移除旧空态与44px首次按钮规则，保留窄工具栏隐藏徽标的更明确选择器。未全局导入主题，也未调整侧栏/搜索等独立控件。

## 聚焦验证与评审

原始证据进`build/ui-consistency-20261104/`。方案`plan.md` SHA256 `80eaf01bfe19e847b10e02cf371959e9c5f7dfead3c472c323ca254f4f0e2393`经fresh独立APPROVE/pass后实施；没有改产品承诺。复用已跟踪Chrome/Vite闭环，真实Workbench/Inbox/公共控件和生产CSS，仅IPC为内存资料。所有断言在integration runner；未复制用户截图中无关系统通知。

初步绿色4/4后扩展三页×两宽实际渲染、历史及状态检查，测试曾因未等前一刷新结束而点击禁用刷新按钮，出现6项等待/加载断言失败；增加等待可操作和Vue状态落定后8/8通过，未因此改数据逻辑。轨道开关和禁用事件回归继续保留。当前按钮实测常规38/紧凑30、图标16、内层gap8、图标文字中心误差0–0.5px；标题18px、说明12px和CTA38px三页一致。载入符号补正与最终域/构建/守卫、独立交付及完整门禁待收口。

## 中断恢复与测量修订

owner明确要求继续完成至可提交并启动验收。恢复时HEAD与8源逐字节匹配旧冻结，先修正`src/style.css`尾多空行（此前diff检查exit2），再冻结v2；恢复后domain51/51、layout14/14、typecheck/build及diff检查通过。未在中断后假称已经运行完整门禁。

独立交付v2结论needs_revision，仅两项P2验收问题，生产实现未发现必改：旋转载入SVG的外接矩形会随角度变为约22.627px，不能用它断言16px布局；固定等待300ms也不能保证无头浏览器有限过渡已到终点。该轮实际复现控制组失败，并独立执行两宽各13项状态断言，旧事项/候选/原文在加载/错误时保留，零提取与失败/取消/中断/排队/运行状态区分，无模型或签收调用。

v3仅修改runner：用SVG clientWidth/clientHeight测不受旋转影响的布局；只推进开关有限动画至终点再量测，保留无限载入动画，未修改生产CSS或关闭真实动效。新8项实际pass/skip0；私有副本强制滑块left=80px、transform=none，仍准确exit1报告越界，证明未掩盖真实错位（`thumb-mutant-v3.log/json`）。旧v2八源另存`source-v2/`，各版冻结与失败日志均保留。当前八源v3清单SHA256 `45bb9eedc51f2531f5fd356c9a147bdde909b8abe6d4093cf8fb651293b82373`，方案未改，独立复审与完整门禁仍待终态。

工作区另有并行桌宠动画调研草稿及评审索引行，不属于本项，不修改或混入本次提交。工作区索引含两项新增记录；提交只登记本项，保留并行变化。

## 修订交付复审：pass

fresh复审独立8/8 pass、skip0，补充14类×两宽状态断言全部通过；私有滑块越界及32px载入图标反例均准确失败，45度旋转时client尺寸仍为16×16、外接框约22.627×22.627，且无限动画保持running。八源/方案/HEAD前后不变，无新增必需修正。此为浏览器/实现复核，不是原生验收。八源清单为[source-hashes.json](ui-consistency-20261104/source-hashes.json)；随后完成的独立完整门禁结果如下。

## 独立完整门禁：pass（自动层）

唯一原始`npm run check` exit0/661.809秒，北京时间2026-11-04 23:12:03–23:23:05。Node30组938pass/0fail/0skip，其中browser8/8、launcher76；默认Rust279pass/0fail＋3ignored，dual37pass/0fail（280filtered）。三项ignored仍是两项真实模型和受控子进程入口，不计作pass；合成预算child另1pass，6次保留/完成、realModelRequests=0/upperBound=0。生命周期12及各Runtime切片通过；默认/双特性Clippy、结构196源/446引用、19类与8引用负例、docs15文件242链接通过。

普通/专用两包557/560资源，deep strict签名、普通/Runtime受控夹具排除通过，普通负入口exit2且未启动普通工作根。普通exe SHA256 `9a0e3d894a12217681e08a87c834dd06e6bbbbecd4178b156690af30df17a1cf`，专用`03727e474a51fc3a9bd08dfdf983ac4da7b5b0033b1f8668788bcf4f4cbd3d98`。本地ad-hoc、未公证，不等于安装或GUI验收。

既有生产构建输出Runtime体积14、Vite chunk2、未公证2；配置proc-macro旧LINKEDIT负控与host/wrapped正控显式通过，Rust新增编译警告0。Chrome载体本轮实际displaylink(-6670)56、taskCategory12、taskSuppression12、allocator8，与复审数量不同，原因未定位，原件分项保留；图和DOM完成不表示控制台零错误或原生通过。系统nonce Keychain仅合成探针，不代表生产MCP或真实凭据验收。

8源/方案/HEAD与3172保护文件前后稳定，67份封存证据hash一致，保护区与diff检查均exit0。完整JSON SHA256 `82ee678a3bdc42c0092fe02446a5b2fb033091380f2c9b52744dc0ac4de84769`，日志SHA256 `89530eb498510f2bb041a85f23f086e9a99774a31f4a13cd58f42b4dbf68f7fb`，原件在`build/ui-consistency-20261104/full/`（目录0700/文件0600）。入库[精选摘要](ui-consistency-20261104/verification-summary.json)与8源清单；各版红证/needs_revision保留。仅后补真实文档，最终另查链接，未改可执行输入，不重复完整门禁。

## 未验证与边界

原生文字光学效果、焦点/键盘及三窗/冷启动仍待专用App重建后用户确认；浏览器DOM模拟事件与静态语义不等同于系统键盘。既有Chrome displaylink/allocator/task_policy测试载体诊断根因未定位，原件按视口留存，不改系统设置或扩大捕获。旧MCP缺证、位置/多屏/登录启动/S5、真实服务/凭据/用户根、clean checkout/CI/其他机器继续开放，G1未关闭。通过评审与完整门禁后仅本地提交，并按既有授权恢复同一专用App/临时根，不自动代改偏好。
