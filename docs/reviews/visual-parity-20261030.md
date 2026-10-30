# 公共表单恢复原稿表达，首页首条入口收紧

2026-10-30。owner要求修正四项实际验收差异，原稿为`http://127.0.0.1:4174/layout-review/`。本轮只改公共表单呈现与首页空态，不改品牌、数据／模型／时区契约；不推进S3.2，不提交推送，原生历史未验保留。

## 1. 先复现，再修

[before.json](visual-parity-20261030/before.json)来自实际生产Vue夹具与原稿的同尺寸对照；[before-capture.jpg](visual-parity-20261030/before-capture.jpg)为合成资料。修改前检查已报FAIL。

| owner观察 | 实测／归因 | 最小修正 |
|---|---|---|
| 昵称与称呼框高度不齐 | 实际都38px，但标签行19.80／24.15px，导致顶部相差4.35px；焦点外框进一步放大差异 | 公共标签行及行内动作采用统一高度，保持框38px，不补字段私有margin |
| 下拉与原稿差距大 | 原稿有独立搜索、49px两行选项、8px内边距及说明；当前无搜索栏／说明，选项28px | 使用现有TDesign panelTopContent及Option.content公开接口，在公共SkSelect内恢复独立搜索、描述／勾选、原稿间距和弹层样式，触发框只读；保留选择／禁用／分组／稳定ID／dialog归属 |
| 复选框不清楚 | 用户原生截图勾与未选边框不可辨；浏览器勾存在，但TDesign隐藏输入宽达107px而非其本意1px，表明全局.field input规则污染。主题令牌实际存在，已排除“未加载主题”假设 | SkCheckbox保持原API／禁用域／布尔事件，改用语义原生checkbox和独立SVG装饰框，明确18px边界与勾选，原生键盘切换；不用供应方伪元素绘勾，不改vendor |
| 首页首条入口拥挤 | 当前静态图＋标题＋说明＋按钮层叠 | 只移除主列表空态中的图，保留品牌标志与右侧简报图；浅琥珀“＋记录第一条”作为44px主入口，下方简短原说明及低强调文本整理入口，不新增卡片／功能 |

## 2. 实施边界与验证

R2共享表单修正，复用已装TDesign1.20.10，无新增依赖。SkSelect只加可选description，模型选项提供wire模型标识，通用设置常用时区提供UTC／夏令时说明；完整时区列表保留，不能为像原稿而仅保留四项。非可搜索下拉不强加搜索栏。

搜索／选择由现有受控value驱动：单独查询不改已保存选项；清空查询恢复列表；分组、数字0继承哨兵和字符串ID不混用；禁用项不可选、空结果可见。搜索框支持方向键、Enter选择、Escape返回、Tab离开，避免误提交表单。生命周期属于当前实例，隐藏／关闭／卸载清理观察器与焦点任务；晚到挂载回调不得给已卸载控件添加监听。弹层仍附着当前dialog，使用受控TDesign开关，不自造表单引擎。

先用原始截图和同一组DOM／视觉判据做前后对照：字段top差≤1px且高38px；搜索在弹层、触发器不编辑；说明／右勾可见、选项padding8px，两行高49px；未选边框与选中SVG可见、checked状态及disabled／Space行为正确；首条入口无主列表图且仍打开原录入／文本流程。1440×1000、1240×820、640×900及dialog内选择器；真实Vue夹具与原生新包分别取证，不把浏览器当WebKit原生验收。

验收脚本来自package.json：类型、相关域回归、build与隔离包；核心业务／Rust／Runtime未改时不无依据重复昂贵全量。独立共享控件复核后执行最终聚焦验证与构建。

为避免关闭owner正在验收的旧应用和丢内存草稿，本轮原生视觉验证使用新的独立测试应用标识／包名，不复制或迁移原工作根。完成后给可比较的新包；旧窗口保留。原生捕获不可用则如实保留未验，不用API成功代替视觉结论。

## 3. 证据与状态

实施前复现已完成。共享组件方案独立评审／代码修改／回归与新包证据待追加；此处不提前标为修复完成。

### 方案独立复核与修订

第1轮APPROVE_WITH_CHANGES：两项Major均采纳。新增独立搜索不会继承TDesign输入键盘，且供应方分组／连续禁用跳过不足；旧aria-activedescendant查找的hover类名也不匹配。实现改为wrapper唯一键盘路径：触发器捕获方向／Enter／Space／Escape，弹层搜索处理同一扁平叶子导航，保持原始typed value（0与"0"不同），不转发供应方键盘。以稳定active value而非可变索引持有高亮，连续禁用项跳过；IME合成不选择，Enter阻止表单提交，Tab回到触发器后正常前进。

ARIA引用归当前焦点所在搜索／触发输入，指向当前实际option ID；分组和叶子option分开处理。mounted＋代次＋root连通／可见性守卫覆盖nextTick／rAF，关闭／卸载使旧任务失效；dialog close独立监听只在打开期间存在，隐藏的实例不得继续观察／抢焦点。checkbox只由原生change发一次更新，不给label或SVG增加toggle，不手写Space。

增加仅开发夹具的真实公共控件测试入口，覆盖类型哨兵、连续禁用、空结果、Enter不提交、Space单次、dialog、卸载／重开等；不加入产品菜单，不引入依赖，不把声明扫描当行为测试。修订版方案复核待追加。

第2轮方案复核APPROVE；实施后再核验真实事件、原稿视觉与原生新包。


## 4. 四项修正已完成，代码复核通过

| 项目 | 已实现与实测结果 |
|---|---|
| 个人输入 | 公共标签行24px，动作不再撑高；真实页面两框均38px、top同为248.789px。原生截图也已确认齐平 |
| 下拉对稿 | 保留已装TDesign选择／弹层，公开panelTopContent＋Option.content提供独立32px搜索、8px选项内边距、49px两行说明、右侧SVG勾。选中浅琥珀、文字墨蓝、阴影与圆角沿用原稿；完整时区不裁剪，模型选项显示API标识。触发输入只读且value始终来自完整选项标签，搜索不会改显示或已选ID |
| 复选 | 公共SkCheckbox使用原生语义checkbox＋18px装饰框／独立象牙SVG，清楚区分未选与选中。点击、Space、disabled域均实测；原生已截图确认勾选和空框，不再仅依赖Chromium判断 |
| 首页 | 移除主列表空态图与重复标题，44px浅琥珀“＋记录第一条”作中心动作，下方保留原说明与较低强调文本整理入口；品牌标志和右侧班班保留。两个入口原生均打开原流程，未保存合成事项 |

共享选择器键盘由wrapper处理。实际检查包括typed0／"0"、连续禁用、查询不更改选择、空结果不提交、清空恢复、Tab／Shift+Tab、dialog与卸载／隐藏清理。空结果保留listbox关联及公告状态，搜索Home／End保留文字编辑。输入法仅做明确的合成事件注入（1次事件、0次选择／提交）及后续正常Enter，不声称完整真实输入法验收。

独立代码复核第1轮APPROVE_WITH_CHANGES，空结果ARIA和搜索Home／End两项均整改，限定复核APPROVE；末次真实输入框读值修正也获限定APPROVE。未把作者CUA操作称为独立浏览器验收。

## 5. 验证记录与交付边界

| 实际命令／操作 | 结果 |
|---|---|
| `npm run typecheck` | exit0；vue-tsc无类型错误 |
| `npm run test:s1-domain` | 15通过，0失败 |
| `npm run test:s2-domain` | 19通过，0失败 |
| `npm run test:s31-domain` | 6通过，0失败 |
| `npm run test:layout-domain` | 14通过，0失败；以上合计54项域回归，不能替代实际控件事件 |
| CUA真实Vue生产组件与公共控件夹具 | 事件／样式见[after.json](visual-parity-20261030/after.json)和[读值检查](visual-parity-20261030/value-display-probe.json)；生产页与夹具控制台采集无error／warn |
| CUA实际640×900与1440×1000 | DOM实测尺寸确认后取证，弹层边界均在视口内；临时CDP尺寸覆盖已清除。最初高层viewport设置未生效的结果未计入对应尺寸结论 |
| `npm run probe:bundle` | exit0，沿用现有Pi／CLI打包流程，无模型凭据 |
| `node scripts/probes/build-app.mjs tests/fixtures/visual-parity-verify.config.json` | exit0；Vite构建476ms，Rust release13.52s，生成并签名独立.app；既有JS包体积提示保留（606.34kB），未改打包策略 |

原生验收使用`Sidekick Form Verify.app`／`com.sidekick.form.verify`，新建自身默认测试根；没有读取、复制、迁移owner原工作根、模型凭据或旧应用内存草稿。只初始化测试工作目录并查看空态／设置／录入，未保存事项、未调用模型或外发。旧应用未关闭。本轮自己的中间测试窗口在末次重建前关闭，最终版本重新打开。

截图：[个人资料](visual-parity-20261030/native-profile.jpg)、[原生下拉](visual-parity-20261030/native-select.jpg)、[原生复选](visual-parity-20261030/native-checkbox.jpg)、[首页](visual-parity-20261030/native-home.jpg)。完整源文件和依赖／品牌不变检查见[source-hashes.json](visual-parity-20261030/source-hashes.json)。包为本地adhoc签名，尚未公证，不代表发布就绪。

本轮未改数据库／Rust／Runtime业务逻辑，无新增依赖，包管理清单／锁文件／品牌tokens与开工哈希相同。未重复运行Rust和Runtime昂贵全量；前一轮相关证据保留原日期。本轮原生只覆盖上述四项修订和直接入口；历史多屏、桌宠、快捷键冲突等未补验项继续保留，未标完成。未提交、未推送。

最终包`codesign --verify --deep --strict --verbose=2` exit0：`valid on disk`、`satisfies its Designated Requirement`。已重新启动最终包，实际combo box读出“中国标准时间 · 上海”，四张原生截图已更新为最终包；窗口停留在通用下拉供owner验收。末次源代码限定复核APPROVE，品牌及依赖开工哈希复查通过。
