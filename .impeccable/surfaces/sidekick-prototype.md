# 跟班桌面原型设计方向

状态：首轮设计初稿；产品、品牌与布局方向已确认，具体视觉资产待本轮评审。模式：Operate。

用户在2026-10-29选择“今日事项主列表＋右侧班班简报”，待确认独立进入。布局选择覆盖本轮原型；不将同一布局强加到品牌展示板。品牌保持墨蓝／琥珀／象牙／砖红、Space Grotesk及马甲圆豆。

FORM：用户选择的主列表结构优先；结构探索种子参考 `seed:bcda8d6bd39f52cd` 不覆盖用户选择。

首屏：左侧稳定导航，中央待我处理／待我跟进清单，右侧班班简报、重点建议和来源状态。状态与来源能被扫描，签收单独进入，避免将未签收候选当正式事项。

标志性交互：同一事项的进展证据紧贴事项显示；“发现交付”保持为线索，完成需用户明确操作。班班以小范围反馈与四态资产表达人格，不让装饰阻挡列表。

覆盖：今日、待确认、全部事项及搜索空态、事项详情与编辑、飞书提醒预览、日报、三个角色配置、来源失败恢复、工作目录与Skills/MCP示例。

边界：静态HTML/CSS/JS交互原型；使用虚构数据，仅页面内存；不调用真实模型、飞书、MCP、Bash或文件系统。无生产接线、持久化、原生窗口或系统通知证明。

验证尺寸：1440×1000桌面、640×900窄窗口；窄窗口只验证内容适应，不表示新增移动端产品。实际用户IAB视口未能读取，浏览器自动化通道Transport closed，改用本地Chrome+Playwright。

## Direction contract

THESIS：在今日清单中读懂“我做什么、我盯什么”，候选先签收，进展不冒充完成。

OWN-WORLD：象牙底、墨蓝信息与导航、琥珀主操作、砖红问题状态；扁平列表与温和圆角，SVG马甲圆豆承担人格。

STORY：用户先看今日事项，再签收收集结果、查看后续线索、处理提醒，结束时查看日报。

FIRST VIEWPORT：左侧稳定导航，中间执行／跟进事项，右侧班班简报。待确认独立页面；其签收按钮和选中数持续可见。

FORM：主事项列表＋右侧简报，原始结构清单第1项，由用户通过结构问题直接选择。CLI为`/Users/zengym/.agents/skills/impeccable/scripts/impeccable`；roll得到4、1、7，种子参考`seed:bcda8d6bd39f52cd`。用户选择优先，本轮没有采用catalogue新视觉世界。

TYPE：中文系统苹方／无衬线，拉丁Space Grotesk；MATERIAL：原生SVG与平面UI；GROUND：用户固定象牙色与派生中性色。

QUALITY BAR：原型以已定品牌、关键操作可见、状态诚实、键盘与窄导航可达为可验证标准。未提供外部catalogue卡片或approved raster comp，不声称达到其视觉上限。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
