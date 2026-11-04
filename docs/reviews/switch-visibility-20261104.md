# 公共开关不可见修复

基点`b19c735c2ccd0b3257c04631d3748b60e7500c3e`。owner在专用验收App报告“无法编辑和选择？”，截图显示桌面偏好两项文本但无开关。R2共享控件样式与浏览器回归，单一可回退修复；沿用G1范围和本地提交授权，不推送。不改IPC/存储/schema/依赖/身份/系统设置，不触碰真实用户根/模型/凭据，生产MCP钥匙串保持关闭。

## 复现、归因与修复

现有构建有`.t-switch`规则，但缺少其依赖的尺寸/圆角/底色变量。候选假设为加载/禁用未恢复、CSS变量缺失、布局挤出；独立Chrome诊断实际得到width=0、height=0、底色透明、尺寸变量为空，disabled并非true；真实组件浏览器夹具在1440/640也均复现0×0（`npm run test:desktop-controls` exit1，0pass/2fail）。因此前项SSR结构与状态测试不能证明可见尺寸，前项原生工作模式/启动显宠不能写为通过。

只在既有`.sk-switch`规则补六个局部TDesign变量：尺寸沿用锁定库默认20px，圆角/各状态颜色引用既有品牌令牌；未引入全局主题/reset，未改组件API/事件。新增真实DesktopSettingsPanel、Pinia/SkSwitch/TDesign/生产CSS夹具，只有Tauri换为合成内存后端；Node runner用既有Vite与本机Chrome，通过真实DOM读取和合成点击/键盘验证宽/窄尺寸、轨道/滑块/底色与命中区、保存、公共复用及禁用两态。浏览器不等于原生，也不验证后端持久事务。

原始证据在`build/switch-visibility-20261104/`：独立诊断`computed-red.json`与`before.png`；首版真实夹具红证`browser-red.log`及`browser-red/`，后续绿色指标/图在`browser/`。所有runner/fixture为tracked候选输入，不依赖被忽略脚本；Chrome缺失为显式skip，当前机器实际执行。计划`plan.md`经fresh独立聚焦APPROVE/pass后实施；该计划不是产品契约改写。

## 当前验证与状态

首次修复后浏览器2/2通过；补稳定后滑块边界和正确保存栏承载后仍2/2通过。既有`test:s1-domain`51/51、`test:layout-domain`14/14、`npm run build`exit0，仅既有Vite chunk提示；结构195源/438相对引用及19类+8引用负例通过。runner生成代码的相对import曾被结构守卫检出，改为指向真实fixture文件的绝对构建导入后通过，未绕过或修改守卫。

## 交付首轮与测试修订

fresh独立交付needs_revision，仅P2禁用态测试假阳性：固定modelValue、未接收更新的夹具会忽略错误事件，最终ARIA不变不能证明没有更新。评审者在临时源码副本只移除原SkSwitch键盘禁用保护，旧测试仍2/2通过但实际发生禁用更新。生产组件的原保护没有改动，问题属于新增回归的可证伪性。

仅修改测试输入/断言，为两个禁用状态记录更新事件，分别在click、Space、Enter后断言0事件与状态保持，避免连续两次错误更新抵消。当前真实浏览器2/2通过、skip0；在临时源码副本移除原键盘guard，同一新测试exit1并准确报disabled Space事件（`disabled-mutant-v2.log/json`），证明可以检出错误。原v1六源留在`source-v1/`，当前v2六源清单SHA256 `9cca453e42c7f816611f39d158d556ebb1817c4f7100124d3afd17b7e71e21bd`。结构现195源/439引用，文档15文件239链接均exit0，独立复审及完整门禁待收口。

浏览器stderr出现Chrome无头显示的`CVDisplayLinkCreateWithCGDisplay failed`（-6670）及重复allocator提示，底层原因本轮未定位；实际DOM断言、图片生成与Chrome退出均成功，原件保留在各宽度stderr日志中。这是新增浏览器载体诊断，不能声称所有输出逐字等同旧基线，也不把它当作生产编译警告或原生通过。未据此更改系统或扩展捕获权限。

## 修订交付复审：pass

fresh复审独立执行原CSS两宽0×0红证、新测试2/2且skip0、移除键盘guard后准确失败、缺Chrome分支0pass/2skip；域51+14、typecheck、结构/文档检查均通过，六源/plan前后匹配，无新增必需项。复审报告SHA256 `a141d898f3c6b8bc28343bf1f8796acf9e647a15fecb6e2ef4020d18a201fba4`。私有副本已清理，清理探针首个“整个TMPDIR必须空”包装断言曾被npm自动缓存干扰；随后只核自身目录/进程的清理通过，不把包装器首失败删掉或写成未发生。

复审还观察到`task_policy_set`的TASK_CATEGORY_POLICY/TASK_SUPPRESSION_POLICY invalid argument提示，数量随运行变化；同属未定位的测试载体诊断，按实际原件保留，不扩展到系统设置。宽窄图片及DOM正常仅覆盖浏览器层。交付准出后运行唯一独立完整门禁，结果如下。

## 独立完整门禁：pass（自动层）

`npm run check`唯一一次exit0/643.538秒，北京时间2026-11-04 18:47:56–18:58:39。Node30组932pass/0fail/0skip（新浏览器2/2、launcher76）；Rust默认279pass/0fail＋3ignored，dual37pass/0fail（280filtered）。两项真实模型和受控子进程入口的ignored仍不计pass；生命周期12及runtime各组通过，合成预算6次完成、realModelRequests=0、upperBound=0。默认及双特性Clippy、结构/文档守卫通过。

普通/专用包资源557/560，两包deep strict签名、普通/Runtime受控夹具排除通过，普通负入口exit2且开普通根前拒绝。普通exe SHA256 `333806d5082089a53044b63aad63b858ba51fcdf29f8c7121d0d27b8a84356d2`，专用`90adb1b263142cfb2d903960c7ec30fa6af8bebd6feab3743328d2b144e7d777`。本地ad-hoc、未公证，不等于安装或GUI验收。

既有输出为14条esbuild体积、2次Vite chunk、2次未公证、2次宿主macro workaround；配置负控与host/wrapped正控按探针通过。新增Chrome载体实际诊断：1440px displaylink7/allocator1/category1/suppression1，640px 7/1/0/0。轨道实际32.359375×20px，关闭态滑块12×12，两宽保存均一次、禁用更新0；图/DOM断言与进程退出成功。诊断根因仍未定位，保持残余，不外推成原生或真实凭据通过；系统nonce Keychain探针只属于合成门禁，生产MCP钥匙串保持关闭。

六源、批准plan与清单、HEAD及2857保护文件前后不变。原件`build/switch-visibility-20261104/full/`的JSON SHA256 `23e6c73ff2bff77ef5171e7e57d40c8498681c1916ec4ae077d7142659044d6d`，日志SHA256 `63def4e267b3d3e2d52c979c01dc32183c0e1446a67b3635de44419f3ec7082f`，可读报告SHA256 `d5e757125157b711f8ca7d4601e184f27eb5cb08a95ce2c42da9a2c47da5364d`，0600。入库[六源清单](switch-visibility-20261104/source-hashes.json)与[精选摘要](switch-visibility-20261104/verification-summary.json)；所有红证/首轮needs_revision保留，不覆盖历史。仅后补事实文档，最后另查链接；源码未变，不重复完整门禁。

## 未验证与边界

通过全部自动验证后才重建并重开同一身份、同一临时根，原生替换/启动元数据仅记`build/switch-visibility-20261104/manual/`，不代写用户确认。新原生可见性/可操作、跨窗动效/冷启动显宠/焦点、旧MCP历史缺证、位置/多屏/登录启动/S5、真实服务/用户根/生产凭据、clean checkout/CI/其他机器仍未验，G1未关闭。按现有授权仅本地提交，不推送。
