# 跟班 Sidekick — 仓库指令（每轮必读）

> 导航型文件：只放每轮都要的定位、红线与指针。结构与依赖边界的权威是 [工程架构](docs/engineering/architecture.md)，门禁与证据要求的权威是 [验证约定](docs/engineering/verification.md)，本文不重复它们的内容。

## 1. 目录骨架

| 路径 | 职责 |
|---|---|
| `src/` | Vue 3 生产前端；`domain/` 纯规则、`stores/` 状态与 IPC、`components/ui/` 公共控件、`styles/tokens.css` 与 `assets/` 生产品牌资产 |
| `shared/` | 跨进程纯逻辑（当前为日期与时间锚点），前端与 Runtime 共用，无框架／平台依赖 |
| `runtime/` | 随包 Node Runtime：`entries/` 任务入口、`lib/` 库、`workers/` 子进程 |
| `src-tauri/` | Tauri 2 Rust 宿主：`src/app/` 装配与 IPC、`src/store/` 唯一业务写入方、`src/host/` 外部宿主、`src/diagnostics/` 探针 |
| `tests/` | `unit/`、`integration/`、`probes/`、`fixtures/`；映射与命名见 `tests/README.md` |
| `scripts/` | `build/` 生产打包、`checks/` 结构与文档守卫、`probes/` 一次性探针 |
| `design/` | 设计原型与评审；只读消费 `src/assets/`、`src/styles/`；预览用 `node design/serve.mjs` |
| `vendor/pi/`、`resources/skills/` | 固定上游 Pi 源码与内置技能，只读 |
| `docs/` | `product/` 产品承诺与实施状态、`engineering/` 工程约定、`reviews/` 历史记录与证据 |
| `build/`、`dist/`、`src-tauri/target/` | 本地产物与原始证据，已被忽略，不入库 |

## 2. 项目事实

- 当前实现：跟班 Sidekick，Tauri 2 + Vue 3 + Pinia + TDesign + Tailwind v4 + SQLite；Pi 从 `vendor/pi/` 固定源码构建。已确认的 Web/后端优先目标见[Web/后端设计](docs/engineering/web-backend-design.md)，不把目标当现状。
- 工具链：Node ≥24、npm 12、Rust 1.89；目前只在 macOS arm64 验证。版本号见 `package.json`。
- 应用身份：identifier `com.sidekick.s0`，包内资源目录 `s0-runtime`。改名会破坏既有用户工作根指针，属于 S5／G4 迁移议题。
- 单工作根：`workspaceRoot/` 下含 `data/sidekick.sqlite`、`config/`、`runs/`、`mcp/`、`backups/`；路径指针在固定应用数据目录的 `bootstrap.json`。
- 当前实施状态：唯一来源是 [第一阶段实施计划](docs/product/05-第一阶段实施计划.md)（其顶部写明 as-of 基点），证据在 `docs/reviews/`。不要在本文件或 README 维护第二份状态清单。
- 产品承诺：以 `docs/product/01`–`04` 为准；文档改动不得删减或反转为“已完成”。

## 3. 关键命令

```sh
npm ci --ignore-scripts
npm run probe:prepare-cli          # 随包 CLI（需网络）
npm run probe:prepare-pi           # 从 vendor/pi 固定源码准备（需网络）
npm run dev                        # Vite 前端，127.0.0.1
npm run typecheck
npm run check                      # 全量门禁：类型 + 域/集成测试 + Rust + 结构/文档守卫 + 两包构建
npm run check:structure            # 结构边界（含 --self-test 负例）
npm run check:docs                 # 文档本地相对链接
npm run check:rust                 # cargo fmt --check + clippy -D warnings
npm run probe:app                  # 打包 Sidekick.app（ad-hoc、未公证）
node design/serve.mjs              # 设计预览 127.0.0.1:4173/design/
```

- 聚焦测试用 npm 脚本名（`test:*`、`probe:*`）；脚本名是稳定接口，不因目录调整改名。
- 真实模型验证是显式可选命令（`test:s2-live`／`test:s31-live`／`test:s32-live`），读 owner 指定的 `.env.deepseek`，不属于 `npm run check`。

## 4. 硬约束

- **跨层依赖**（`check:structure` 强制）：`src/` 只能相对引用 `src/`、`shared/`；`runtime/` 只能引用 `runtime/`、`shared/`；`shared/` 只能引用自身（禁 `vue`、`node:*`、`@tauri-apps/*`）；`design/` 只能引用 `design/`、`src/assets/`、`src/styles/`。生产前端禁止引用 `design/` 与 `runtime/`。
- **只读区**：`vendor/pi/`、`resources/skills/` 是固定上游与内置技能；不改第三方源码、不新增依赖、不重新生成清单，版本变更需 owner 明确授权。
- **证据与状态**：未验证不关闭。不把计划、原型、合成替身或浏览器夹具写成已实测；实施状态写 `docs/product/05`，验证证据写 `docs/reviews/<slice>-<date>.md`，原始证据默认放 `build/<slice>/`。
- **密钥与个人资料**：真实密钥、个人来源原文、运行数据库、本机私有路径不入库；日志与截图必须脱敏；测试只用合成 fixture。
- **授权**：未获 owner 明确授权不得 `commit`／`push`；新增生产依赖、改 schema／migrations、改 identifier、真实凭据或真实用户根操作都需要单独授权。
- **机械守卫不可绕过**：`npm run check` 包含 `check:structure` 与 `check:docs`；本地失败不得用“只跑了子集”替代。

## 5. 高频任务入口

| 任务 | 先读 |
|---|---|
| 新增／移动代码，判断放哪一层 | [工程架构](docs/engineering/architecture.md) 的“依赖边界”与“放置决策表” |
| 加测试、跑门禁、留证据、做独立验证／评审 | [验证约定](docs/engineering/verification.md) |
| 查产品行为、边界与当前实施状态 | [第一阶段实施计划](docs/product/05-第一阶段实施计划.md)、[评审记录索引](docs/reviews/README.md) |
| 改设计、视觉、组件样式 | [DESIGN.md](DESIGN.md)、[设计说明](design/README.md) |
| 查文档有哪些、谁是权威 | [文档地图](docs/README.md) |
| 查历史切片做了什么、证据在哪 | [评审记录索引](docs/reviews/README.md) |

## 6. 陷阱指针

- **要改 `src-tauri/src/` 的目录或模块名** → 先读工程架构的“Rust 宿主”；模块名、公开路径与 `cargo test --lib <filter>` 过滤必须不变（`lib.rs` 用 `#[path]` 模块清单，`include_str!` 相对深度随之变化）。
- **要改测试文件名或 npm 脚本名** → 不做。切片名保留用于对照历史证据；新测试用领域名并放 `tests/unit`／`tests/integration`。
- **要从 `src/` 引 `design/` 或 `runtime/`** → 禁止。品牌令牌、字体、SVG 已归 `src/styles/`、`src/assets/`；跨进程纯逻辑放 `shared/`。
- **要把日志、截图或大文件塞进 `docs/reviews/`** → 先读验证约定的留存策略；原始证据进 `build/<slice>/`，仓库只收精选主证据。
- **要顺手改 identifier、`s0-runtime`、迁移或依赖** → 停下，属于 S5／G4 或需单独授权，不随本轮改动。
- **改了任何 `.md`** → 跑 `npm run check:docs`；本地相对链接必须存在，不要把链接写成代码围栏或行内代码里的样子来规避检查。
- **改了 `domain/`** → 允许 Vue 响应式原语，但不得引入 stores、组件或 IPC；跨进程逻辑去 `shared/`。

## 7. 维护守则

- 本文件上限 120 行；只放每轮都要的定位、红线与带触发条件的指针。
- 净增趋零：只有新增一级目录、新增红线或新增陷阱时才允许净增，同时删掉一条过时内容。
- 逐轮流水、日期、实测数字、评审轮次写入 `docs/reviews/` 或 git 历史，不写进本文件。
- 单一事实来源：结构边界以 `docs/engineering/architecture.md` 为准，门禁与证据以 `docs/engineering/verification.md` 为准，实施状态以 `docs/product/05` 为准；本文件只导航。
- 改规则后必须同步守卫（`scripts/checks/check-structure.mjs`、`check-docs.mjs`）并跑通 `npm run check`。
