# 工程架构与放置规则（权威）

> 本文是仓库结构与依赖边界的唯一权威来源；`AGENTS.md` 只做导航，`scripts/checks/check-structure.mjs` 把这里的规则做成机械守卫。
> 适用范围：所有新增、移动、重命名的源码与脚本。改动本文中的边界、顶层目录或打包入口时，必须同时改守卫规则，否则 `npm run check:structure` 失败。
> 最近一次结构调整：2026-11-08 W1 手工事项实施准入（owner 批准 A–D 后新增 `server/` 与 `src-tauri/src/bin/`，守卫同步，见 §2）；2026-10-31 结构治理（前端跨层依赖修复、`runtime/` 与 `src-tauri/` 归组、`tests/` 分层、`scripts/` 归组）。历史记录保留当时路径，见 [实施计划](../product/05-第一阶段实施计划.md) 的路径说明。

> **当前代码与下一目标分开**：本文的结构/守卫规则描述当前实现与已批准的落地布局。owner 已确认 Web/后端优先目标，详见[Web/后端设计](web-backend-design.md)；产品边界与执行次序以 product/01–05 为准。2026-11-08 owner 批准 W1 A–D 后，`server/`、`src-tauri/src/bin/` 的布局与依赖边界已写入守卫并生效；对应生产代码（后端入口/库、存储适配二进制、浏览器接线，含启动/会话共享客户端与应用时区接线）已按候选 I 随 MAYNE-23 任务分支第五轮集成原样接入（含 OpenCode R3 写目标分派收口独审通过），**未合入 main**；第五轮冻结版 `eca807b` 完整门禁已串行执行 exit 0（51 组），原样真实 UI 浏览器旅程 34/34 独立验收通过（OhMyPi `9c0f202`）、集成公共增量复核通过（Kimi `2ad7a48`，见[集成回执 §14–§15](../reviews/web-manual-items-integration-20261108.md)），主线合入留队长按 owner 既有授权确认精确版本，本文不假称已交付。手工事项纵向接口见[手工事项契约](web-manual-items-contract.md)。

## 1. 当前代码结构

```text
AGENTS.md                     # 每轮必读：项目事实、命令、硬约束、文档地图（导航型）
shared/                       # 跨进程纯逻辑：无 vue／node／tauri 依赖，可被 src 与 runtime 引用
  dates.mjs  dates.d.mts
src/                          # Vue 3 生产前端；品牌／字体／令牌等生产资产归自己
  App.vue  main.ts  style.css
  assets/brand/*.svg          # 生产品牌 SVG（原 design/brand/*.svg）
  assets/fonts/               # SpaceGrotesk.ttf、OFL.txt
  styles/                     # tokens.css（生产设计令牌）、forms.css、settings.css、mcp.css
  components/                 # 功能组件；components/ui/ 为公共表单控件
  domain/                     # 纯业务规则与类型（允许 vue 响应式原语；禁止 stores／组件／IPC）
  stores/                     # Pinia 状态与 IPC 调用
runtime/                      # 随包 Node JS Runtime（不打包进前端产物）
  entries/                    # 任务入口：probe-entry、organizer-entry、mcp-probe-entry、skills-manager、today-facts
  lib/                        # 库：managed-bash、managed-mcp、mcp-catalog、skills-store、
                              #     organizer-contract、probe-contract、skill-read
  workers/                    # 子进程：bash-worker、mcp-guardian
src-tauri/src/                # Tauri 2 Rust 宿主；lib.rs 只做模块清单与装配（用 #[path] 保持模块名）
  lib.rs  main.rs
  app/                        # Builder／窗口／托盘／事件／run；commands.rs 为 IPC 命令（模块名仍为 store_commands）
  bin/                        # web-backend-storage.rs：W1 存储适配 stdio 二进制（唯一允许的 bin 源）
  store/                      # local_store 及其特性模块、*_tests.rs（模块名不变）
  host/                       # mcp_host、runtime_host、skills_host
  diagnostics/                # storage_probe、s0_probe、verification、verification_root、mcp_ui_verification
server/                       # W1 独立 Node 后端（随包分发的源码布局；只允许 entries/ 与 lib/）
  entries/                    # web-backend-entry.mjs：后端进程入口（显式配置启动，不自动监听）
  lib/                        # http-server、session-store、manual-items-service、storage-client、
                              #     sse-hub、static-files
tests/
  unit/                       # 纯域／客户端模型测试（原文件平移，文件名不变）
  integration/                # 需要构建产物或子进程的测试（含 lifecycle、discovery、native-fd、runtime）
  probes/                     # 探针脚本与 probe 测试（保持原位，含 s33/）
  fixtures/                   # 合成输入、配置与本地合成服务（只放输入）
  README.md                   # 切片名→领域映射与命名约定
scripts/
  build/                      # bundle-runtime.mjs、build-app.mjs、build-backend.mjs（生产打包入口）
  checks/                     # check-structure.mjs、check-docs.mjs（机械守卫）
  probes/                     # prepare-s33-lifecycle.mjs、rustc-host-macro.py（一次性探针）
design/                       # 设计原型与评审记录；只读消费 src/assets、src/styles；serve.mjs 为窄服务
vendor/pi/                    # 固定上游 Pi 源码（subtree，只读）
resources/skills/             # 内置技能与哈希清单（只读）
docs/
  README.md                   # 文档地图与权威边界
  product/                    # 产品基线：01–04 承诺，05 实施状态
  engineering/                # 工程架构与验证约定（本目录）
  reviews/                    # 评审记录与证据（索引见 docs/reviews/README.md）
build/  dist/  src-tauri/target/   # 本地产物与原始证据，不入库
```

## 2. 依赖边界（可机械检查）

守卫对**相对路径引用**做层级与存在性检查；bare specifier（如 `vue`、`node:fs`、`@earendil-works/pi-ai`）通常按依赖／构建或宿主别名处理，不受相对引用规则约束，但 `shared/`、`design/` 与 `server/` 另有明确禁用的 bare 前缀（见下表与文件级例外）。CSS 的 `@import`、`url()` 与 HTML 的 `src`／`href` 同样检查，且目标必须存在。

| 层 | 允许的相对引用 | 禁止 | 原因 |
|---|---|---|---|
| `src/**` | `src/`、`shared/` | `server/`、`runtime/`、`design/`、`src-tauri/`、`vendor/`、`tests/`、`scripts/` | 生产前端不能依赖后端进程、设计稿目录或 Node Runtime；品牌与令牌已归 `src/` |
| `server/**` | `server/`、`shared/` | `src/`、`runtime/`、`design/`、`src-tauri/`、`vendor/`；bare 仅允许 `node:*`（零 npm 依赖） | W1 独立后端只共享跨进程纯逻辑；`scripts/build/build-backend.mjs` 打包时重复校验同一规则 |
| `runtime/**` | `runtime/`、`shared/` | `src/`、`design/`、`src-tauri/`、`vendor/`（bare 的 `@sidekick/pi-*` 除外） | Runtime 独立随包运行，只共享跨进程纯逻辑 |
| `shared/**` | `shared/` | `vue`、`@tauri-apps/*`、`node:*`、其他顶层目录 | 中立层必须能同时被前端与 Runtime 引用 |
| `design/**` | `design/`、`src/assets/`、`src/styles/` | `src/components/`、`runtime/`、`src-tauri/` | 设计稿消费生产资产，方向不可反转；`node:*` 仅限 `serve.mjs`／`verify.cjs` 工具 |

其他结构规则（同一守卫内）：

- **顶层目录白名单**（以 `git ls-files` 为准）：`.cargo`、`.impeccable`、`design`、`docs`、`resources`、`runtime`、`scripts`、`server`、`shared`、`src`、`src-tauri`、`tests`、`vendor`，外加根文件白名单。新增一级目录必须同步本文与守卫。`server` 于 2026-11-08 随 W1 A–D 批准加入（不建仓库根级 `bin/`；Rust 二进制源码收敛在 `src-tauri/src/bin/`）。
- **本地运行时元数据**：编码代理平台写进检出目录的机器本地元数据（当前仅 `.multica/`、`.opencode/`）不参与顶层白名单判定，本地保持可用、不入库、不打包。它们一旦被 git 跟踪即被拒绝（守卫规则 `metadata.tracked`）；`.multica/` 是守护进程数据目录，其中伪装成元数据的可执行代码仍按生产源码拒绝（`metadata.code`）。这两个目录不进入引用扫描与打包输入；其他任何新顶层目录（含未来新平台目录）仍走 `top.dir`，须先同步本文与守卫并经评审。
- **入库卫生**：`git ls-files` 不得包含 `build/`、`dist/`、`src-tauri/target/`、`node_modules/`、`.env*`（`.env.example` 除外）。
- **测试分层**：`tests/**.test.mjs` 只能位于 `unit/`、`integration/`、`probes/`；`fixtures/` 只放输入，不放断言。
- **目录收敛**：`runtime/` 顶层只允许 `entries/`、`lib/`、`workers/`；`scripts/` 顶层只允许 `build/`、`checks/`、`probes/`；`server/` 顶层只允许 `entries/`、`lib/`（守卫规则 `layout.server-top`）；`src-tauri/src/` 顶层只允许 `lib.rs`、`main.rs`、`app/`、`bin/`、`store/`、`host/`、`diagnostics/`，其中 `bin/` 只允许 `web-backend-storage.rs`（守卫规则 `layout.src-tauri-bin`）。
- **打包入口存在性**：`runtime/entries/{probe-entry,organizer-entry,mcp-probe-entry,skills-manager,today-facts}.mjs`、`runtime/workers/{bash-worker,mcp-guardian}.mjs` 必须存在（产物名 `probe.mjs`／`organizer.mjs`／`skills-manager.mjs`／`mcp-probe.mjs`／`bash-worker.mjs`／`mcp-guardian.mjs` 不变，新增窄纯事实计算产物 `today-facts.mjs`）。
- **旧路径不得回流**：`package.json` 不得残留 `tests/s[0-9]`、`tests/layout-`、`scripts/probes/bundle-runtime` 等迁移前路径；`check` 必须包含 `check:structure` 与 `check:docs`。
- **历史迁移字节**：001–004 的原始SHA-256由结构守卫固定；只追加新迁移，禁止原地重写历史SQL。**2026-11-07**：owner 授权全新建表方案后，新独立 web-backend/1 lineage 迁移落 `src-tauri/migrations/web-backend/`（不触碰既有 001–005）；其 `001_web_backend.sql` 的精确 SHA-256（`8511907c…143d`，与审定 DDL 逐字节一致）现同样由结构守卫冻结并纳入原地自测正/负例（见[准备记录](../reviews/web-foundation-integration-schema-integration-prep-20261107.md)）。既有守卫对该路径无需新收敛规则：`src-tauri/src/` 顶层收敛只约束第一层（`store/` 已允许）、`src-tauri/migrations/` 无顶层限制、引用扫描不覆盖 `src-tauri`（见[集成记录](../reviews/web-foundation-integration-main-ff-20261107.md)）。迁移文件已接入但未合入 main，状态见[实施计划](../product/05-第一阶段实施计划.md)。**2026-11-08**：W1 手工事项迁移 `002_manual_items.sql` 获 owner 批准（A 项，原样 SHA-256 `b6cb8e61…f97e`，含块内注释行），其精确哈希同样入守卫冻结并纳入原地自测正/负例（缺失/篡改拒绝；批准事实见[授权清单 §12](../reviews/web-manual-items-authorization-20261108.md)）；迁移文件本身属候选 I，集成前守卫按“冻结文件缺失”如实报违规。
- **守卫自测**：`check:structure` 带 `--self-test`，用临时目录合成违规样本逐条断言可检出，再检查仓库；规则不能只写在文档里。

文档规则（`check:docs` 强制）：只校验 `README.md`、`AGENTS.md`、`DESIGN.md`、`design/README.md`、`docs/**/*.md`（`docs/reviews/**` 的历史记录除外，但包含 `docs/reviews/README.md`）；跳过代码围栏、行内代码、外部链接与锚点。新增或修改文档后本地相对链接必须存在。

## 3. 模块职责

**前端 `src/`**

- `App.vue`／`main.ts`／`style.css`：应用外壳、入口与全局样式装配。
- `styles/tokens.css`：生产设计令牌（`--action-*` 语义、颜色、字阶），是 `DESIGN.md` 与设计原型的共同来源。
- `components/`：业务组件（工作台、候选、设置、工具、MCP 等）；`components/ui/`：公共表单控件，其他组件不得另拼一套输入样式。
- `domain/`：纯业务规则与类型（日期语义、候选、事项、模型目录、MCP 配置解析）。允许 Vue 响应式原语，禁止组件、stores 与 IPC。
- `stores/`：Pinia 状态与全部 IPC 调用；组件只通过 stores 触碰宿主。

**共享层 `shared/`**

跨进程纯逻辑，当前为日期与时间锚点（`dates.mjs`／`dates.d.mts`）。不含框架与平台依赖；前端、server 与 Runtime 的相对引用都必须落回本目录。

**独立后端 `server/`（W1 起步，候选 I 已随 MAYNE-23 任务分支集成，未合入 main）**

- `entries/web-backend-entry.mjs`：后端进程唯一入口；显式配置（root/port/staticRoot/storageBin 等）启动，模块导入本身不监听，成功返回 `{origin, close}`。
- `lib/`：`node:http` 路由与会话/CSRF、事项业务事务、应用时区设置（单 key HTTP 读/CAS 写）、Rust 存储适配 stdio 客户端、SSE 广播与同源静态供给；只引用 `server/`、`shared/` 与 Node 内置模块（零 npm 依赖，守卫与打包脚本双重强制）。

**Node Runtime `runtime/`**

- `entries/`：宿主拉起的任务入口，各自是独立进程的起点。
- `lib/`：托管 Bash、托管 MCP、MCP 目录、技能存储与读取、organizer／probe 契约。
- `workers/`：需要独立进程身份的工人（`bash-worker`、`mcp-guardian`）。
- 只通过契约文件与宿主通信；不读写 SQLite，不直接改业务事实。

**Rust 宿主 `src-tauri/src/`**

- `lib.rs`：仅模块清单（`#[path]`）与 `run()` 装配，保持模块名、公开路径与 `cargo test --lib <filter>` 过滤不变。
- `app/`：Tauri Builder、窗口、托盘、全局快捷键、事件与 IPC 命令注册；`commands.rs` 的模块名仍为 `store_commands`。
- `bin/web-backend-storage.rs`：W1 存储适配 stdio 二进制入口（由 Node 后端作为子进程调用）；`bin/` 收敛仅此一个源文件，经 `src-tauri/Cargo.toml` 的 `[[bin]]` 构建为 `web-backend-storage`，由 `scripts/build/build-backend.mjs` 装入后端 bundle。
- `store/`：正常业务唯一写入方（SQLite、迁移、事务、备份与恢复原语），`local_store.rs` 用 `#[path]` 引入特性模块与 `*_tests.rs`。
- `host/`：外部宿主生命周期（MCP、Runtime、Skills）。
- `diagnostics/`：探针、诊断、验证载体；不被业务路径依赖。

**测试与脚本**

- `tests/unit`：纯域与客户端模型断言；`tests/integration`：需要构建产物或真实子进程；`tests/probes`：探针与 probe 契约；`tests/fixtures`：合成输入与本地合成服务。
- `scripts/build`：生产打包（`bundle-runtime`、`build-app`、`build-backend`）；`scripts/checks`：结构与文档守卫；`scripts/probes`：一次性探针辅助。
- 切片名（`s1`…`s33`）保留在 npm 脚本名、测试文件名、探针脚本与 fixtures 中（如 `scripts/probes/prepare-s33-lifecycle.mjs`、`tests/probes/s33/`、`tests/fixtures/s33-ui-verify.config.json`），用于对照历史证据；新增测试与脚本使用领域名。

**设计、上游与文档**

- `design/`：原型、品牌板、评审截图与窄预览服务（`node design/serve.mjs`）。只引用 `src/assets/`、`src/styles/` 中的生产资产。
- `vendor/pi/`、`resources/skills/`：固定上游源码与内置技能，只读；构建只核对本地固定清单。
- `docs/product/`：产品承诺与实施状态；`docs/engineering/`：本文件与验证约定；`docs/reviews/`：历史记录与证据。

## 4. 新代码放置决策表

| 要新增的东西 | 放到 | 约束 |
|---|---|---|
| 跨进程纯逻辑（当前为日期与时间锚点） | `shared/` | 禁 vue／node／tauri；前端、server 与 Runtime 共用同一份实现 |
| 后端进程入口与 HTTP/SSE/会话/事项服务库 | `server/entries/`、`server/lib/` | 只引用 `server/`、`shared/` 与 Node 内置模块；零 npm 依赖；布局收敛 `layout.server-top` |
| 独立 Rust 存储适配二进制源 | `src-tauri/src/bin/web-backend-storage.rs` | `bin/` 仅此一文件（`layout.src-tauri-bin`）；manifest 登记 `[[bin]]` 需 owner 批准（A–D 已批） |
| 前端业务规则或类型 | `src/domain/` | 允许 vue 响应式；禁 stores、组件、IPC |
| IPC 调用、界面状态 | `src/stores/` | 组件不得直连 `@tauri-apps/api` |
| 业务组件 | `src/components/` | 公共表单控件放 `src/components/ui/` 并复用 |
| 生产品牌资产、令牌、字体 | `src/assets/`、`src/styles/tokens.css` | 设计稿只能引用，不能反向定义 |
| Runtime 任务入口 | `runtime/entries/` | 同时更新 `scripts/build/bundle-runtime.mjs` 入口表与产物名 |
| Runtime 共享库 | `runtime/lib/` | 不依赖 `src/`；与宿主只通过契约通信 |
| 独立子进程工人 | `runtime/workers/` | 自带拥有/清理身份，不共享父进程信号组 |
| Rust IPC 命令 | `src-tauri/src/app/commands.rs` | 命令名/参数需与 TS 调用端同名同参并加测试 |
| 数据模型、迁移、事务 | `src-tauri/src/store/` | 迁移只追加；备份失败不覆盖原根 |
| 外部宿主生命周期 | `src-tauri/src/host/` | 不直接写业务表 |
| 探针、诊断、验证载体 | `src-tauri/src/diagnostics/` | 业务路径不得依赖 |
| 生产打包脚本 | `scripts/build/` | 产物名与资源目录名保持兼容；`build-backend.mjs` 输出统一 `build/web-backend/`（server 布局、实际引用的 shared、`bin/web-backend-storage`、`static/`=前端 dist） |
| 结构/文档守卫 | `scripts/checks/` | 无第三方依赖，带 `--self-test` 负例 |
| 一次性探针辅助脚本 | `scripts/probes/` | 可重建，产物写入 `build/` |
| 单元测试 | `tests/unit/` | 用领域名，不依赖构建产物 |
| 集成测试 | `tests/integration/` | 需构建产物／子进程时必须放这里 |
| 探针与 probe 契约测试 | `tests/probes/` | 含 `tests/probes/s33/` 等切片输入 |
| 合成输入与本地合成服务 | `tests/fixtures/` | 只放输入，不放断言 |
| 设计原型与评审材料 | `design/` | 不 import 生产组件；只引用生产资产 |
| 产品承诺与实施状态 | `docs/product/` | 不写工程细节 |
| 工程结构与验证约定 | `docs/engineering/` | 结构性改动必须同步守卫 |
| 评审记录与证据 | `docs/reviews/` | 索引与留存策略见 `docs/reviews/README.md` |

## 5. 旧架构的职责定位（S4／S5／G2／G3，不是现行交付队列）

本节只用于理解旧代码与历史记录，后续业务职责迁至独立后端，先完成 Web G1–G3 再接薄壳；现行目标与接口见 Web/后端设计，不按此表继续旧桌面优先队列；产品范围以 [产品基线](../product/01-产品定义.md) 与 [实施计划](../product/05-第一阶段实施计划.md) 为准。

| 方向 | 主要落点 | 说明 |
|---|---|---|
| S4 三窗、托盘、快捷键、提醒调度 | `src-tauri/src/app/`（窗口／托盘／快捷键注册与事件）、`src/`（桌宠窗、快捷录入窗组件与 stores） | 三窗共享权威状态，前端只持有界面状态；提醒调度的数据落 `store/`，外部投递走 `host/` |
| S5 安装、迁移、备份恢复、工作根切换 | `src-tauri/src/store/`（迁移／备份／恢复）、`src-tauri/src/app/commands.rs`（IPC）、`scripts/build/`（打包与资源） | identifier `com.sidekick.s0` 与资源目录 `s0-runtime` 的改名是 S5／G4 的显式迁移议题，影响既有用户工作根指针，不得顺手改 |
| G2 飞书资料与进展闭环 | `runtime/lib/`（来源读取与契约）、`runtime/entries/`（任务入口）、`src-tauri/src/host/`（受控进程与来源连接）、`src/stores/` | 来源与关联证据仍由宿主事务保存；不新增角色 |
| G3 提醒与复盘闭环 | `src-tauri/src/host/`（调度与投递）、`src-tauri/src/store/`（日报与提醒数据）、`src/components/`（桌宠／日报呈现） | 主窗关闭仍需运行；卡片操作必须真正落库 |
| 任何新的一级目录 | 本文件 + `scripts/checks/check-structure.mjs` | 未同步即被守卫拒绝 |

## 6. 已知债与暂缓决定

这些是**有意保留**的现状，不是遗漏；改动前先确认是否属于对应切片的范围。

1. **应用 identifier 与资源目录名**：仍为 `com.sidekick.s0`、`s0-runtime`。改名会破坏既有用户工作根指针与包内资源路径，作为 S5／G4 迁移议题处理；本轮不动。
2. **IPC 字符串契约**：命令名与参数在 TS stores 与 Rust handler 两处以字符串重复（当前 52 个 `#[tauri::command]`），没有类型化契约。新增或改名命令必须两端同步并加测试；整体类型化不在本轮范围。
3. **`domain/` 使用 Vue 响应式原语**：`src/domain/` 允许 `vue` 的响应式 API，因此不是框架无关层。纯跨进程逻辑应放 `shared/`；若未来要拆出框架无关领域层，单列迁移并同步守卫。
4. **切片命名的保留**：npm 脚本名（如 `test:s33-config-domain`、`check:s33-p2-runtime`）与测试文件名（`tests/unit/s33-*.test.mjs`、`tests/integration/s33-*.test.mjs`）保持原样，避免打断历史证据与命令习惯。新测试使用领域名；脚本改名需要单独的迁移与记录。
5. **CI 缺口**：全量门禁只在本机由人触发，没有 CI 托管；见 [验证约定](verification.md)。
6. **设计原型不是生产代码**：`design/` 与生产共享品牌资产，但原型仍以页面内存模拟业务，不能作为实现或验收证据。
7. **原始证据不入库**：`build/<slice>/` 保存可重建的原始日志与产物；仓库只收精选证据，见 [评审留存策略](../reviews/README.md)。
