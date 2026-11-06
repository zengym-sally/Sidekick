# 文档地图与权威边界

> 本目录按“谁说了算”组织，而不是按时间顺序。写文档前先确认主题落在哪一层；一处事实只保留一个权威来源，其余位置用指针。

## 1. 权威边界

| 主题 | 权威文件 | 说明 |
|---|---|---|
| 产品承诺、用户流程、分期验收 | `product/01`–`04` | 目标能力与验收要求，不随实现进度改写 |
| 当前实施状态与切片证据 | [第一阶段实施计划](product/05-第一阶段实施计划.md) | 唯一当前状态源，顶部写明 as-of 基点；未验证项保持开放 |
| Web/后端目标契约 | [Web/后端设计](engineering/web-backend-design.md) | owner 新方向、部署/凭据/队列/薄壳接缝；目标尚未实现，执行顺序看 product/04–05 |
| 工程结构、依赖边界、新代码放置 | [工程架构](engineering/architecture.md) | 与 `scripts/checks/check-structure.mjs` 同源；改结构必须同步守卫 |
| 验证门禁、测试分层、证据与评审要求 | [验证约定](engineering/verification.md) | 与 `package.json` 脚本及 `check:docs` 同源 |
| 已授权连续目标的准入、选取与无人值守流程 | [无人值守约定](engineering/unattended.md) | 授权及进度仍以实施计划和当次用户指令为准 |
| 每轮必读的定位与红线 | [AGENTS.md](../AGENTS.md) | 只导航，不维护第二份状态清单 |
| 设计规范与视觉约定 | [DESIGN.md](../DESIGN.md) | 令牌的代码来源是 `src/styles/tokens.css` |
| 桌宠交互与动效专项设计 | [桌宠设计](engineering/pet-interaction-design.md) | owner 确认的体验、技术路线与待探针验收；不替代实施状态或工程规则 |
| 设计预览与原型边界 | [设计说明](../design/README.md) | 原型不是生产代码，也不是验收证据 |
| 历史评审记录与证据 | [评审记录索引](reviews/README.md) | 按当时版本保留，不改写结论 |
| 早期产品说明书 | [产品说明书 v0.3](产品说明书-v0.3.md) | 历史文档，只作溯源，不代表现状 |

冲突时按上表取权威：产品承诺看 `product/`，工程规则看 `engineering/`，近期事实看最新评审记录与代码；发现文档与代码不一致时先报告，不静默改写承诺，也不把未验证写成通过。

## 2. 文档地图

```text
AGENTS.md                     # 每轮必读：目录骨架、项目事实、命令、红线、指针
README.md                     # 面向使用者与贡献者：产品概览、结构、命令、使用说明
DESIGN.md                     # 设计规范：颜色、字阶、组件、布局与各切片视觉约定
design/README.md              # 设计预览方式与原型边界
docs/README.md                # 本文件：文档地图与权威边界
docs/product/
  01-产品定义.md              # 定位、对象、边界
  02-用户流程.md              # 端到端动线
  03-智能体与架构.md          # 三角色、目标架构与技术选型
  04-分期交付与验收.md        # W0–W5 Web 完整业务 → D1 薄壳 → G4/G5；保留业务 G 编号
  05-第一阶段实施计划.md      # 切片计划、契约、证据与当前状态
docs/engineering/
  web-backend-design.md       # Web/后端目标、持久队列、代理与凭据、薄壳接口
  architecture.md             # 结构、边界、模块职责、放置决策表、后续落点、已知债
  verification.md             # 门禁矩阵、测试分层、证据新鲜度、留存、独立验证、CI 缺口
  unattended.md               # 已授权连续目标的准入、选取、预算与收口流程
  pet-interaction-design.md   # 桌宠半隐、右键菜单、动效/事件与原生验证设计
docs/reviews/
  README.md                   # 记录索引、证据目录映射与留存策略
  <slice>-<YYYYMMDD>.md       # 各切片的评审／验证记录
  <slice>-<YYYYMMDD>/         # 同名证据目录（精选主证据）
docs/产品说明书-v0.3.md       # 历史产品说明书（溯源用）
```

## 3. 放置规则

| 要写的内容 | 位置 | 不要放 |
|---|---|---|
| 产品承诺、用户可见行为、验收要求 | `docs/product/` | 工程实现细节、命令清单 |
| 目录结构、依赖边界、放置决策、架构债 | `docs/engineering/architecture.md` | README、评审记录 |
| 门禁、测试分层、证据与评审流程 | `docs/engineering/verification.md` | 产品文档 |
| 某一轮的实现／验证／评审结论 | `docs/reviews/<slice>-<YYYYMMDD>.md` | `docs/product/` 正文、`AGENTS.md` |
| 面向使用者的操作说明与命令 | 根 `README.md` | `AGENTS.md`（只放每轮必读的） |
| 品牌、组件与视觉约定 | `DESIGN.md`（或 `design/` 原型说明） | 工程架构文档 |
| 每轮都需要的定位、红线与指针 | `AGENTS.md` | 长篇说明（下沉到本目录） |

配套约定：

- 新评审记录必须同时登记到 [评审记录索引](reviews/README.md)，否则视为未收口。
- 原始日志与临时产物默认留在 `build/<slice>/`（不入库）；仓库只收精选主证据，见 [验证约定](engineering/verification.md)。
- 文档中的本地相对链接必须存在，`npm run check:docs` 会检查；不要用代码围栏或行内代码规避。
- 历史记录中的路径与哈希属于当时版本；复核用 `git show <commit>:<path>`，不按当前工作区重算。

## 4. 状态记法

- **已实现**：代码已落地，且当轮记录写明命令、退出码与计数。
- **已验证**：有独立验证证据；浏览器夹具、合成替身、单元测试只证明各自那一层。
- **未验证／开放**：计划内但缺证据，必须显式列出并保持开放，不因相邻项通过而关闭。
- **规划**：只出现在产品基线，未经实测，不写进实现状态。

任何文档只描述自己那一层的状态；跨层的当前状态统一指向 [第一阶段实施计划](product/05-第一阶段实施计划.md) 与最新评审记录。
