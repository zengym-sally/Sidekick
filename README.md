# 跟班 Sidekick

**盯着呢，老板。** / *On it, boss.*

macOS 桌面 AI 待办管家。由班班收拢事项、辅助签收、持续跟踪与提醒，管理“待我处理”和“待我跟进”。

当前交付 S1 本地手工版：工作目录选择、两类事项录入与管理、SQLite 持久化和重启恢复。验证范围见 [S1 记录](docs/reviews/s1-20261029.md)。**AI 文本整理、候选签收、持续收集、到期提醒及日报仍为规划，未经业务实测**；S0 剩余补测继续保留，当前版本不代表可推广试用版。

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

## 构建与验证

探针工程使用 Node 24、npm 12 与 Rust 1.89，当前仅在 macOS 27.0.1 arm64 验证。先执行：

```sh
npm ci --ignore-scripts
npm run probe:prepare-cli
npm run probe:prepare-pi
npm run check
npm run probe:app
```

Pi 从 `vendor/pi/` 固定源码构建，准备阶段会获取上游公开模型目录数据，需要网络；不是完全离线或逐字节可复现的构建。模型目录与构建产物不提交，源码和两份锁文件保留版本依据。安装包为 `src-tauri/target/release/bundle/macos/Sidekick.app`，使用 ad-hoc 签名、未经公证。正常启动是本地手工工作台，不调用模型或飞书、不自动种入演示数据。S0 诊断页保留为开发路由 `?probe=1`。

真实模型验证为显式可选命令：`SIDEKICK_MODEL_ENV="$PWD/.env.deepseek" npm run probe:model`，先运行 `npm run probe:bundle`。密钥不进入构建资源；此命令使用合成材料并会访问所选模型服务。详细前提、证据和剩余补测见 S0 记录。


## 本地手工使用

1. 打开 `Sidekick.app`，使用默认位置或选择空文件夹；已有跟班工作目录会先校验归属和版本。
2. 点击“快速录入”或在应用内按 ⌘K，填写标题、类型、实际负责人、优先级和标签。截止与下次跟进分别启用；不设置时间即保留为未定期。
3. 从今日或全部事项打开详情，可编辑／延期、完成、重新打开、确认删除和查活动历史。删除从普通清单移除，本地记录仍保留。
4. 退出应用后重开，自动读取同一工作根。设置可查看并打开该目录；运行中迁移、备份恢复、正式全局快捷窗及桌宠常驻体验在后续切片验收。

业务库在 `workspaceRoot/data/sidekick.sqlite`，历史与事项同事务保存。固定应用数据目录中的 `bootstrap.json` 定位工作根。根丢失、库损坏或版本过新时显示错误，不以空库替代；请先恢复原目录或保留现场交由维护者检查。

聚焦检查：`npm run test:s1-domain`、`npm run test:s1-store`。隔离原生验收包使用 `npm run build:s1-verify` 构建，标识为 `com.sidekick.s1.verify.r2`，与普通包的数据指针分开。仓库截图与验收样本均为合成资料。

个人信息与设置从左下角个人按钮进入，默认打开个人信息。可填写昵称（默认“小明同学”）及独立的班班称呼（默认BOSS），可用“与昵称一致”复制后统一保存，保存后侧栏与简报立即生效，重启后恢复；偏好存于工作目录`config/profile.json`。通用设置保留工作目录入口，关于显示实际版本。桌宠仍按S4接入。
