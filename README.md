# 跟班 Sidekick

**盯着呢，老板。** / *On it, boss.*

macOS 桌面 AI 待办管家。由班班收拢事项、辅助签收、持续跟踪与提醒，管理“待我处理”和“待我跟进”。

当前进入 S0 技术探针阶段。**生产待办业务能力仍为规划，未经实测**；已运行的合成探针、真实接入检查及未验证项分别记录，不能据此宣称产品闭环已交付。

## 产品基线

- [产品定义](docs/product/01-产品定义.md)
- [用户流程](docs/product/02-用户流程.md)
- [智能体与架构](docs/product/03-智能体与架构.md)
- [分期交付与验收](docs/product/04-分期交付与验收.md)
- [第一阶段实施计划与状态](docs/product/05-第一阶段实施计划.md)
- [S0 技术探针记录](docs/reviews/s0-20261029.md)

本仓库的历史说明书、评审资料保留溯源，以 `docs/product/` 为当前产品基线。

## 品牌与交互设计

- [设计预览与运行说明](design/README.md)
- [设计规范](DESIGN.md)：配色、字阶、组件与响应式约定。
- [品牌板](design/brand/index.html)：标志、桌宠四态、配色、字体及SVG资产。
- [交互原型](design/prototype/index.html)：今日工作台、候选签收、事项处理、日报及配置流程。

在仓库根目录运行 `python3 -m http.server 4173 --bind 127.0.0.1 --directory design` 后访问 `http://127.0.0.1:4173/prototype/`。原型使用虚构演示数据，交互仅保留在当前页面。

## S0 开发验证

探针工程使用 Node 24、npm 12 与 Rust 1.89，当前仅在 macOS 27.0.1 arm64 验证。先执行：

```sh
npm ci --ignore-scripts
npm run probe:prepare-cli
npm run probe:prepare-pi
npm run check
npm run probe:app
```

Pi 从 `vendor/pi/` 固定源码构建，准备阶段会获取上游公开模型目录数据，需要网络；不是完全离线或逐字节可复现的构建。模型目录与构建产物不提交，源码和两份锁文件保留版本依据。安装包为 `src-tauri/target/release/bundle/macos/Sidekick S0.app`，只做合成诊断，使用 ad-hoc 签名、未经公证。

真实模型验证为显式可选命令：`SIDEKICK_MODEL_ENV="$PWD/.env.deepseek" npm run probe:model`，先运行 `npm run probe:bundle`。密钥不进入构建资源；此命令使用合成材料并会访问所选模型服务。详细前提、证据和剩余补测见 S0 记录。
