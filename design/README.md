# 跟班 Sidekick 首轮品牌与交互设计

这是可评审的设计原型，布局已确认采用“今日事项主列表＋右侧班班简报”，待确认收件箱独立进入。生产能力仍全部为规划，未经实测。

## 预览

在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory design
```

- 品牌板：`http://127.0.0.1:4173/brand/`
- 交互原型：`http://127.0.0.1:4173/prototype/`

交互原型使用虚构演示资料，不调用模型、飞书、MCP、Bash或本机文件系统；更改仅留在当前页面，刷新可复位。请勿输入真实密钥或业务资料。

## 交付边界

品牌图形使用原生SVG，字体Space Grotesk随附OFL许可；中文使用系统苹方与无衬线回退。原型用于验证信息层级和操作动线，不是Tauri/Vue生产工程，也不证明系统通知、拖拽穿透、数据持久化或真实接入能力。

参考基线：[产品定义](../docs/product/01-产品定义.md)、[用户流程](../docs/product/02-用户流程.md)。

## 原型走查

可体验：文本示例→编辑候选→批量签收；手工录入→编辑／完成／删除；事项进展与催办草稿；飞书卡片完成／稍后提醒；日报预览；模型与三个角色偏好；来源错误恢复；工作目录、Skills和MCP示例状态。`⌘K`／`Ctrl+K`打开录入，`Esc`关闭弹层。

已有Playwright工具环境及Chrome时，可运行以下独立设计检查。它不是生产依赖，也没有为此初始化包管理工程：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node design/verify.cjs
```

验证结果和截图在 [review](review/)；测试脚本会重写演示验证截图，不接触业务数据。`PROTOTYPE_ORIGIN`可覆盖本地服务地址，`CHROME_EXECUTABLE`可指定浏览器。
