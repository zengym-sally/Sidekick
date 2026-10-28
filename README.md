# 跟班 Sidekick

**盯着呢，老板。** / *On it, boss.*

macOS 桌面 AI 待办管家。由班班收拢事项、辅助签收、持续跟踪与提醒，管理“待我处理”和“待我跟进”。

当前处于产品与设计阶段，**生产能力全部为规划，未经实测**。

## 产品基线

- [产品定义](docs/product/01-产品定义.md)
- [用户流程](docs/product/02-用户流程.md)
- [智能体与架构](docs/product/03-智能体与架构.md)
- [分期交付与验收](docs/product/04-分期交付与验收.md)

本仓库的历史说明书、评审资料保留溯源，以 `docs/product/` 为当前产品基线。

## 品牌与交互设计

- [设计预览与运行说明](design/README.md)
- [设计规范](DESIGN.md)：配色、字阶、组件与响应式约定。
- [品牌板](design/brand/index.html)：标志、桌宠四态、配色、字体及SVG资产。
- [交互原型](design/prototype/index.html)：今日工作台、候选签收、事项处理、日报及配置流程。

在仓库根目录运行 `python3 -m http.server 4173 --bind 127.0.0.1 --directory design` 后访问 `http://127.0.0.1:4173/prototype/`。原型使用虚构演示数据，交互仅保留在当前页面。
