---
name: 跟班 Sidekick
description: 有分寸、记得住事的桌面 AI 待办管家；浅色原型与原生主窗共用品牌。
colors:
  ink: "#1f3a5f"
  night: "#16283f"
  amber: "#c8872b"
  ivory: "#f6f3ec"
  brick: "#b4442c"
  surface: "#fffdf9"
  sidebar: "#eeeae2"
  line: "#deddd5"
  muted: "#566370"
  soft-ink: "#e7ebef"
  soft-amber: "#f5e8d1"
  soft-brick: "#f6e7e1"
typography:
  display:
    fontFamily: '"Space Grotesk", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(90px, 11.4vw, 158px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.6px"
  title:
    fontFamily: '"PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: '"PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0.02em"
  label:
    fontFamily: '"PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 550
  meta:
    fontFamily: '"PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  latin:
    fontFamily: '"Space Grotesk", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
rounded:
  tag: "3px"
  badge: "4px"
  chip: "5px"
  tab: "6px"
  control: "7px"
  content: "12px"
  dialog: "15px"
  shell: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "24px"
  page: "32px"
  wide: "40px"
components:
  button-quick-entry:
    backgroundColor: "{colors.soft-amber}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  button-quick-entry-hover:
    backgroundColor: "#eedcbf"
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.night}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  button-primary-hover:
    backgroundColor: "#d4953a"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  button-ghost-hover:
    backgroundColor: "{colors.sidebar}"
  search-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 12px"
    width: "240px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "#556371"
    rounded: "{rounded.content}"
    padding: "12px 14px"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ivory}"
  chip:
    backgroundColor: "{colors.soft-ink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "4px 7px"
  chip-warning:
    backgroundColor: "{colors.soft-amber}"
    textColor: "#79501b"
  chip-danger:
    backgroundColor: "{colors.soft-brick}"
    textColor: "{colors.brick}"
  candidate-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.content}"
    padding: "18px"
  task-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "18px 0"
  review-bar:
    backgroundColor: "{colors.ivory}"
    padding: "16px 32px"
---

# Design System: 跟班 Sidekick

## Overview

**Creative North Star: "有分寸的桌面跟班"**

象牙底承载工作，墨蓝组织信息，琥珀标出行动。界面以扫描和操作为先；穿小马甲的圆豆「班班」承担亲和感，反馈简短、克制。

这是基于已渲染浅色原型的代码提取记录，视觉值以生产令牌 [tokens.css](src/styles/tokens.css)、[prototype.css](design/prototype/prototype.css) 和 [brand.css](design/brand/brand.css) 为准。品牌方向已定，SVG 与应用图标仍为首轮草案，不代表最终商标或生产资产验收。当前没有深色主题。

**Key Characteristics:**

- 扁平事项列表与温和圆角，依靠文字层级和分隔线组织信息。
- 主操作和问题状态各有固定颜色，状态同时有文字说明。
- 中文系统无衬线与拉丁品牌字配合，桌宠表情服务反馈。

## Colors

### Primary

- **墨蓝 Ink / 深墨 Night**：主要文字和选中导航；正式主窗的操作按钮按入口／提交语义着色。
- **琥珀 Amber / 浅琥珀 Soft Amber**：浅琥珀底＋墨蓝字用于快速录入、首次录入、初始化与重试等入口；实心琥珀底＋深墨字用于保存、签收、完成等提交；琥珀也用于焦点和待确认提示。

### Secondary

- **砖红 Brick / 浅砖红 Soft Brick**：逾期、连接失败与表单问题；不要用作一般装饰。

### Neutral

- **象牙 Ivory**：应用主底；**纸白 Surface**：输入、候选卡与浮层。
- **侧栏 Sidebar / 分隔 Line**：稳定导航与结构分界。
- **次要文字 Muted / 浅墨 Soft Ink**：元信息与中性反馈。正文、标签和状态均需保留文字可辨性。

**The Action Color Rule.** 入口类操作统一浅琥珀＋墨蓝；保存、签收、完成等明确提交使用实心琥珀；砖红用于删除等危险动作。选中导航的墨蓝底保留，不能据此派生深色确认按钮。

当前 CSS 的次要文字对比度：对象牙为 5.55:1，对侧栏为 5.13:1；深墨对琥珀为 4.94:1。这只覆盖上述组合，不构成整站无障碍认证。JSON 中合成的色阶仅用于面板预览，不是新增界面令牌。

## Typography

- **Display**：仅品牌板的拉丁字标，紧凑字距；其自适应尺寸见品牌 CSS。
- **Headline / Title**：页面标题与列表分组，靠字号和字重建立层级，不额外加装饰标签。
- **Body / Meta / Label**：事项标题、来源依据、状态和控件。UI 以紧凑字号组织短句，较长依据用更宽松行距。
- **Latin**：字标、日期、计数与部分代码示例使用 Space Grotesk；中文回退到系统苹方、思源黑体及无衬线字体。

Space Grotesk 本地可变字体声明覆盖字重 300–700；随资产保留 [OFL.txt](src/assets/fonts/OFL.txt)。其品牌选择以及象牙底已有两个目标 HTML 的窄范围检测例外，未关闭整个文件或检测规则。

## Layout

本轮原型遵守用户选择的「主事项列表＋右侧班班简报」，待确认独立入口；这是原型页面契约，不强加给品牌展示板。完整方向见 [surface brief](.impeccable/surfaces/sidekick-prototype.md)。

- 应用容器最大宽度 1460px，桌面侧栏 196px，顶部模拟窗口栏 42px、工具栏 68px。内容区常规留白为上 31px、横 32px、下 28px。
- 今日区采用流动主列和 270px 简报，间距 31px。大于等于 1500px 时简报增至 300px；小于等于 1160px 时侧栏 174px、简报 238px，内容间距随 CSS 收紧。
- 小于等于 960px 时侧栏缩至 66px，保留图标、短标签和待确认数量。小于等于 760px 时简报移到主列表下方，工具栏吸顶、候选原文侧栏隐藏，候选卡内仍保留原文摘录，桌宠入口隐藏。
- 待确认签收栏与内容滚动分离；窄窗口固定在底部，左侧避让 66px 导航，并为内容增加底部留白。选中数与签收操作持续可见。
- 桌面最终覆盖规则为最小高度 720px、窗口高度 `calc(100svh - 150px)`；窄窗口恢复内容自然高度，不能按早期同文件声明误记为固定满高。
- 品牌板最大宽度 1240px、横向留白 38px；其独立断点为 1000px 和 700px。

验证尺寸为 1440×1000 与 640×900；后者验证桌面窄窗口适应，不表示增加移动产品。

## Elevation & Depth

列表和普通内容容器不带阴影，依靠底色、细边框和留白区分。柔和阴影只出现在模拟应用外框、桌宠气泡、提示、对话框及窄窗口签收栏；具体阴影值保存在 sidecar。原型外围灰色是设计预览环境，不提升为生产应用背景规范。

**The Quiet Surface Rule.** 普通列表与候选卡保持扁平，浮层才通过阴影表达覆盖关系。

## Shapes

控件用紧凑圆角，卡片和导航用较大圆角，对话框及模拟窗口再放宽；准确值见 frontmatter。事项完成控件为直径 24px 的圆，常规图标为 20px 描边 SVG。品牌圆豆与马甲轮廓来自现有 SVG，不用字体字符替代图标。品牌板的倾斜展示底板属于该展示场景，不能泛化为工作区卡片样式。

## Components

- **Buttons**：浅琥珀入口、实心琥珀提交、砖红删除、描边次操作；常规最小高度 36px，小按钮最小高度 30px。悬停变换底色，按下位移 1px，禁用降低不透明度；键盘焦点默认使用琥珀 3px 外框、3px 间距；浅琥珀快速录入使用墨蓝外框。
- **Inputs / Fields**：纸白底、细描边、墨蓝文字和插入符；表单标签可见，搜索另有无障碍名称。错误以砖红文字明确说明，不能只靠颜色。
- **Navigation**：当前项墨蓝底与象牙文字，同时设置 `aria-current`；窄导航继续显示短标签。原生主窗现有今日、待确认和全部事项；设置由左下角个人入口打开，默认个人信息Tab，通用设置及关于并列。日报随后续切片接入。
- **Chips / Cards**：标签是简短状态，不承担主操作。候选卡包含勾选、可编辑字段、原文摘录与丢弃入口；未签收不能混入正式事项。
- **Task Row**：完成圆按钮、可点击标题、标签与来源，时间独立对齐；进展线索紧贴原事项，出现交付线索仍由用户确认完成。
- **Review Bar**：显示全选／取消全选、选中数和签收按钮；零选中时签收禁用。桌面参与工作区布局，窄窗口固定底部。
- **班班反馈**：四份静态 SVG 对应待机、签收后举本子、提醒、完成致意。原型的明确完成操作会切换致意资产；发现与提醒姿态在品牌板中预览，签收更新列表与提示。现有短过渡、加载旋转与工作模式遵守减少动效设置，不等于已实现原生角色动画。

三个角色固定为事项整理、进展跟踪、工作参谋；可调模型与偏好不意味着可新增角色。组件预览仅演示外观，业务行为以 [prototype.js](design/prototype/prototype.js) 为准。

## Do's and Don'ts

### Do:

- **Do** 从实际 CSS 复用现有颜色、字系、层级与圆角；品牌资产沿用当前 SVG 底稿。
- **Do** 保留状态文字、来源依据、可见键盘焦点，以及窄导航短标签和持续可见的签收操作。
- **Do** 将候选、进展线索和用户确认的完成分别呈现，模拟连接与演示数据保持明确标注。

### Don't:

- **Don't** 把新进展或发现交付直接表现为完成，也不要把未签收候选算成正式事项。
- **Don't** 将四态 SVG 草案称为已验证的原生动画、点击穿透、多屏适配或最终商标。
- **Don't** 将历史HTML原型的页面内存称为持久化，或把尚无实施证据的渠道、工具及原生能力写成已接入；当前实现状态以产品文档与逐项证据为准。

既有 [verification.json](design/review/verification.json) 记录 11 组浏览器交互、13 份截图和零浏览器错误；本文件提取不新增业务验证。finish reviewer 的三个已评分修复项均为 resolved，ship 仅覆盖这些修复项。本轮 code-led，没有 approved raster comp 或外部 QUALITY BAR 卡，不宣称达到外部视觉上限。本地服务仅提供 design 目录；开发契约、生产接入与原生能力不纳入本规范验收。


## S1 个人信息与按钮语义（2026-10-29）

正式主窗统一消费`tokens.css`的`--action-entry-*`、`--action-commit-*`、`--action-quiet-*`、`--action-danger-*`；悬停、按下、焦点与禁用同样由共享语义定义。旧原型中的dark类属于历史示例，不作为正式主窗按钮先例。品牌颜色和tagline不变。

左下角仅保留个人按钮：只显示昵称，默认“小明同学”，不回退为班班称呼；副标题“个人信息与设置”，激活时复用导航墨蓝底／象牙字与12px圆角，不加右箭头。窄窗保留可点击头像和完整可访问名称。设置页签为个人信息／通用设置／模型／关于；每次从个人按钮进入默认个人信息，草稿跨页签和页面切换保留。

个人页昵称留空按“小明同学”，称呼独立留空按BOSS；“与昵称一致”只复制当前草稿、不自动保存或持续绑定，两字段上限统一60字。预览明确为“保存后”；实际简报只消费已保存值。错误、读取／保存中、未确认同步各有文字反馈；关于显示Tauri真实版本，侧栏不摆放“本地手工版”等阶段说明。桌宠原生显示继续留S4，不因界面回访提前启动。

## S2 文本与候选遵循同一套操作语义（2026-10-29）

快速录入通过“手工录入／文本智能整理”Tab切换，不将粘贴原文直接保存为事项。文本界面显示来源时间及缺省时间锚点；当前正式主窗的时区统一在通用设置，历史S2截图中的逐次IANA字段不再使用，提交后进入独立待确认页。卡片编辑类型、负责人和时间，保留原文引用；日期与下次跟进分别控制，支持“仅日期”。无法可靠解析时显示警告，用户补充或明确接受未定期。

候选使用未签收／已签收／已丢弃文字状态；终态卡只读。签收方式可选新建或人工关联已有事项，并说明关联不覆盖关键字段。原文在桌面右侧，窄窗隐藏侧栏但保留卡片引用；底部签收条独立于滚动列表、始终可见，空选／正在提交时禁用。顶部录入及整理新文本用浅琥珀入口，保存／应用预览／签收用实心琥珀。

自然语言修改按“先保存人工草稿 → 生成前后预览 → 应用到候选 → 签收”展开。预览不是已保存修改，也不是签收；候选已有新版本时不覆盖用户草稿，提供明确重读操作。任务失败、取消和中断显示实际状态与重试入口，输入不被清空。

当前模型服务页区分已保存配置与独立供应商／模型草稿；当前编辑修改后，测试结果说明对应已保存快照。JSON导入已移除；改用可视化增改、显式放弃与对象范围的保存。连接测试仅证明真实调用响应，不等同来源、工具或三角色配置均已验收。S2界面截图使用合成API替身，证据层级见S2记录。


## S3.1 智能体配置与只读试跑（2026-10-29）

个人入口仍默认个人信息；新增智能体Tab，固定三个分工按钮与当前角色详情，不新增侧栏入口。当前角色使用墨蓝／象牙激活，窄窗横向排列；表单和间距沿用现有节奏，几何常量仅作用于本组件。

配置含模型继承／覆盖、关注重点、表达详略及补充说明；角色草稿独立保存，切换角色或设置页不丢输入。保存／恢复用明确文字，旧修订冲突与结果未知保留草稿并指向读回核对；未核对前禁用试跑。恢复默认只修改所选角色，不影响模型服务或其他角色。

事项整理试跑在当前正式主窗中与配置并排，窄窗回退到下方，说明合成样例和不写正式事项；必须先保存才能试跑。结果只读展示标题、类型、负责人、标签、两类时间和原文引用，并可查看本次原文／设置。当前配置或草稿改变时说明结果仍对应旧快照。开始／运行／取消／失败／中断／成功有文字反馈；迟到取消不得替换新任务。另两角色的试跑明确暂未开放，不显示演示成功。

本轮浏览器夹具仅用于Vue／CSS，原生与真实模型证据分别记在S3.1记录，不互相代替，也不关闭历史原生补验。

## MCP 配置编辑沿用公共表单（2026-10-31）

工具页的MCP服务采用列表／编辑区，当前对象保存栏仍固定在底部。编辑区右上用紧凑的“表单／JSON”选择组：纸白选中面、墨蓝字、明确按下状态及键盘焦点；不增加页面导航。JSON输入复用SkTextarea，保持既有字系、纸白输入面、错误与帮助位置；多服务识别使用SkSelect选择本次保存对象。无名称的单个对象可见显示默认new-server，切表单后可改名；不静默批量导入。

诊断存储状态压紧为浅墨分组，长路径换行；参数保持独立项，环境项在宽编辑区同排、窄区换行。JSON识别摘要与诊断结果分组，保存仍实心琥珀、粘贴入口浅琥珀／墨蓝；未保存或不支持的JSON不能触发诊断。HTTP／SSE只显示尚未接入，不能呈现已连接。品牌令牌、字体和公共控件基础样式均不变。

## 公共表单与配置布局（2026-10-29，owner已确认）

本节为正式主窗当前约定，优先于上方历史HTML原型的密度记录；品牌色、字系、tagline、马甲圆豆保持不变。来源为[已确认布局](design/layout-review/index.html)、`src/styles/forms.css`、`src/styles/settings.css`及`src/components/ui/`。不把此约定当作全部原生场景已验收。

- 公共控件默认38px、圆角8px；表格／弹层紧凑操作30px，面板12px；设置页标题21px，窄窗19px。标签和帮助固定位置，标签必须关联真实焦点元素；数字步进、开关、选择器及分组提供正确角色／状态，错误用砖红文字和`aria-invalid=true`，焦点用墨蓝。普通输入仍保留语义HTML，选择／数字／开关／按钮／弹层复用TDesign；复选由公共SkCheckbox使用原生语义输入与独立SVG绘勾，避免平台伪元素和旧输入样式遮蔽，不逐页拼装另一套。
- 日历为公共civil控件，独立保存日期／小时／分钟并使用UTC做日历运算，避免组件按设备时区把02:30改成03:30或吞掉日期。只有领域层按统一应用时区解析；不存在时刻阻止、重复时刻明确选择。清空／取消／确定、方向键、Esc和焦点恢复统一；弹层归当前dialog所有，隐藏和卸载时释放观察／焦点工作。
- 设置分类为个人信息／通用／模型服务／智能体／关于。个人入口仍默认个人信息；昵称与称呼各有含义。设置内容独立滚动，当前对象保存栏固定在底部，DOM和视觉顺序一致，其他对象草稿不随保存清掉。
- 通用采用短分组行；路径与尾部选择／打开图标组成一体，选择入口在S5前明确未开放。时区只在这里统一选择，其他页面不重复铺IANA提示。
- 模型服务为供应商列表＋服务字段／模型表／内联编辑。普通字段优先，高级连接／采样／成本按需展开；GUI替代JSON导入，底层双文件格式与未知非秘密元数据保留。全局默认选择后显式应用；测试明确所选模型，不能偷换全局默认。未保存模型在列表可重新进入，失败／冲突／未知结果保留草稿并可读回。
- 智能体为紧凑三角色切换、配置／隔离试跑双栏。保存栏只管当前角色；恢复默认先是草稿。试跑只消费已保存快照，未保存或配置未确认时禁止新调用，另两角色未开放试跑的提示保留。
- 来源批次与“整理新文本”同高、底边对齐；签收提交仍保留实心琥珀。事项筛选、手工录入、文本与候选编辑也消费同一公共控件。

验证层级以[配置布局交付记录](docs/reviews/layout-production-20261029.md)为准：真实Vue夹具只证布局和交互，Rust与打包Runtime分别证明存储／参数；历史多屏、桌宠等原生缺项不因浏览器通过而关闭。

## 表单对稿修订（2026-10-30）

- 标签行统一24px，行内文本动作不撑高标签；常规输入仍38px。
- 下拉触发器只读；可搜索项在弹层顶部独立搜索。选项8px内边距、墨蓝文字，说明用10px次级文字；选中浅琥珀并在右侧绘勾。单行34px，两行49px；分组／禁用／空结果与原始ID类型保留。方向键选择，搜索Home／End编辑文本，Enter不提交外层表单，Tab按原焦点顺序离开，Escape先收下拉。
- 复选框18px纸白底与清晰细边，选中墨蓝底／象牙SVG勾；原生Space和change只切换一次，禁用域沿用公共契约。
- 工作台空态移除主列表中间的班班图，以44px浅琥珀“＋记录第一条”为中心；下方说明与文本整理入口保持低强调。侧栏标志与右侧简报形象保留。

本轮前后证据与验证边界见[表单对稿修订记录](docs/reviews/visual-parity-20261030.md)。

## Skills 工具页（S3.2）

沿用同一设置外壳，工具页提供技能路径、尾部打开图标、浅琥珀重扫按钮、包列表及详情；只读内容不占用底部保存栏。内置／自定义／本地修改／不可用状态以文字区分，诊断显示安全相对路径；恢复先展示具体包与文件范围，提交仍用实心琥珀。窄窗按列表→详情单列，品牌、字阶和公共表单保持不变。


## S4 快捷录入与班班入口

正常快捷窗沿用纸白／象牙、现有表单控件和实心琥珀保存；标题、类型、负责人、优先级、两类独立时间及标签直接对应手工事项。缺根和日期规则未确认时禁用保存；保存结果未知时保留原输入、锁住编辑，以“重试原保存”核对，窗口显隐失败不冒充提交失败。文本智能整理仍指向工作台。

班班复用原SVG与透明拖动区域，明确提供工作台、快速录入、隐藏，不展示虚构提醒。托盘提供对应入口及退出，快捷键失败仍有托盘路径。此为生产功能候选的界面约定，原生拖拽／透明／托盘／键盘／多屏效果仍需实机验收，不能从SSR或编译通过关闭。

## S4 桌面偏好

设置新增“桌面”分类，使用既有短分组行、公共开关与当前对象的固定保存栏。工作模式只减少装饰动效、过渡和平滑滚动，不隐藏内容或改变任务；系统减少动态效果的偏好继续生效。启动时显示班班只影响下次启动，本次显隐仍由托盘控制，不关联系统登录启动。读取、保存、冲突与结果未知保留草稿并提供明确的读回入口；后台刷新不能代替用户确认未知结果。此界面约定不代表原生多窗效果或冷启动已验。

公共SkSwitch在自身范围内补齐TDesign必需变量：沿用其20px默认尺寸，圆角与关闭/悬停/禁用态使用现有品牌令牌。不依赖未加载的全局主题，也不为单个开关导入全局reset；浏览器回归须验证实际轨道/滑块尺寸、颜色、点击/键盘、禁用与保存，组件SSR存在不等于控件可见。
