---
name: 跟班 Sidekick
description: 有分寸、记得住事的桌面 AI 待办管家；当前为浅色浏览器交互原型。
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
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.night}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  button-primary-hover:
    backgroundColor: "#d4953a"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  button-dark-hover:
    backgroundColor: "{colors.night}"
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

这是基于已渲染浅色原型的代码提取记录，视觉值以 [tokens.css](design/brand/tokens.css)、[prototype.css](design/prototype/prototype.css) 和 [brand.css](design/brand/brand.css) 为准。品牌方向已定，SVG 与应用图标仍为首轮草案，不代表最终商标或生产资产验收。当前没有深色主题。

**Key Characteristics:**

- 扁平事项列表与温和圆角，依靠文字层级和分隔线组织信息。
- 主操作和问题状态各有固定颜色，状态同时有文字说明。
- 中文系统无衬线与拉丁品牌字配合，桌宠表情服务反馈。

## Colors

### Primary

- **墨蓝 Ink / 深墨 Night**：主要文字、选中导航与深色按钮；深墨用于深色交互反馈。
- **琥珀 Amber / 浅琥珀 Soft Amber**：快速录入、签收、焦点与待确认提示；琥珀按钮使用深墨文字。

### Secondary

- **砖红 Brick / 浅砖红 Soft Brick**：逾期、连接失败与表单问题；不要用作一般装饰。

### Neutral

- **象牙 Ivory**：应用主底；**纸白 Surface**：输入、候选卡与浮层。
- **侧栏 Sidebar / 分隔 Line**：稳定导航与结构分界。
- **次要文字 Muted / 浅墨 Soft Ink**：元信息与中性反馈。正文、标签和状态均需保留文字可辨性。

**The Action Color Rule.** 琥珀强调行动与提醒，砖红表达问题；两者不互换职责。

当前 CSS 的次要文字对比度：对象牙为 5.55:1，对侧栏为 5.13:1；深墨对琥珀为 4.94:1。这只覆盖上述组合，不构成整站无障碍认证。JSON 中合成的色阶仅用于面板预览，不是新增界面令牌。

## Typography

- **Display**：仅品牌板的拉丁字标，紧凑字距；其自适应尺寸见品牌 CSS。
- **Headline / Title**：页面标题与列表分组，靠字号和字重建立层级，不额外加装饰标签。
- **Body / Meta / Label**：事项标题、来源依据、状态和控件。UI 以紧凑字号组织短句，较长依据用更宽松行距。
- **Latin**：字标、日期、计数与部分代码示例使用 Space Grotesk；中文回退到系统苹方、思源黑体及无衬线字体。

Space Grotesk 本地可变字体声明覆盖字重 300–700；随资产保留 [OFL.txt](design/brand/fonts/OFL.txt)。其品牌选择以及象牙底已有两个目标 HTML 的窄范围检测例外，未关闭整个文件或检测规则。

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

- **Buttons**：琥珀主操作、墨蓝确认操作、描边次操作；常规最小高度 36px，小按钮最小高度 30px。悬停变换底色，按下位移 1px，禁用降低不透明度；键盘焦点使用琥珀 3px 外框、3px 间距。
- **Inputs / Fields**：纸白底、细描边、墨蓝文字和插入符；表单标签可见，搜索另有无障碍名称。错误以砖红文字明确说明，不能只靠颜色。
- **Navigation**：当前项墨蓝底与象牙文字，同时设置 `aria-current`；窄导航继续显示短标签。保留今日、待确认、全部事项、日报与设置的当前入口。
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
- **Don't** 将当前页面内存中的状态称为持久化，或把真实 AI、飞书、Bash、MCP、存储及原生窗口写成已接入。

既有 [verification.json](design/review/verification.json) 记录 11 组浏览器交互、13 份截图和零浏览器错误；本文件提取不新增业务验证。finish reviewer 的三个已评分修复项均为 resolved，ship 仅覆盖这些修复项。本轮 code-led，没有 approved raster comp 或外部 QUALITY BAR 卡，不宣称达到外部视觉上限。本地服务仅提供 design 目录；开发契约、生产接入与原生能力不纳入本规范验收。
