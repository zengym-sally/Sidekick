# 桌宠动画技术调研（待机动画与事件动画）

> 类型：调研记录（纯调研，无代码改动）。应 owner 要求，将 2026-11-04 会话中完成的桌宠动画可行性调研落库存档，供后续桌宠动画切片实施（Codex 或其他实施方）参考。
> 本文不改变任何实施状态与产品承诺；当前实施状态唯一来源是[第一阶段实施计划](../product/05-第一阶段实施计划.md)，产品承诺以 `docs/product/01`–`04` 为准。

## 1. 范围与结论

- 问题：macOS 下，桌宠"班班"能否具备**待机动画**（常态循环）与**事件动画**（业务时刻触发的序列）？用什么技术栈实现？
- **结论：可行，且不需要更换技术栈。** 现有 Tauri 2 ＋ Vue 3 底座已具备全部窗口层前置条件（透明/置顶/穿透 API 已有 S0 证据）；动画属渲染层增量工作，存在零新增依赖的起步路线。
- 风险级：低。剩余风险集中在原生验收项（安装包透明、隐藏动画释放、逐像素穿透），见 §6。
- 性质：本文为调研判断＋已有证据引用，**不含任何新实施的实现或验证**。

## 2. 基点与方法

- 基点 commit：`1f3bed98474311f9574fc8de0e9341cf33244fa9`（2026-11-04，工作区 clean）。
- 方法：仓库现状核对（本文所有 `文件:行号` 均按该基点逐一核实）＋外部资料检索（§7）。调研初稿基于更早的仓库快照，落库前已按当前基点复核并更新现状（生产 pet 窗已上线，见 §3）。
- 命令：无机械门禁（无代码改动）。撰写并登记索引后运行 `npm run check:docs`，exit 0。

## 3. 现状快照（基点已实现/已有证据）

| 维度 | 现状 | 依据 |
|---|---|---|
| 生产 pet 窗口 | `?window=pet` 路由；280×200、透明、无边框、无阴影、置顶、不进任务栏、不抢焦点；默认隐藏，托盘"显示/隐藏班班"与 `petOnStartup` 偏好控制显隐 | `src-tauri/src/app/desktop.rs:117-132`、`:167-170` |
| pet 渲染 | 单张静态 `banban-idle.svg` ＋ 工作台/快速录入/隐藏三按钮；无任何动画（无 keyframes／motion-v／SMIL） | `src/components/PetWindow.vue:5,10` |
| 四态资产 | `banban-idle/found/remind/done.svg` 四张静态 SVG，无 SMIL；found/remind/done 未接入生产 | `src/assets/brand/` |
| 事件通道 | Rust→前端 emit 模式已在生产使用：`todos-changed`、`desktop-preferences-changed`，另有 organizer/mcp-probe/today-advice/agent-trial 等 changed 事件；**无 pet 专属事件** | `src-tauri/src/app/commands.rs:152`、`src-tauri/src/app/desktop.rs:98` |
| 桌面偏好 | `workMode`/`petOnStartup` 持久化，三窗订阅 `desktop-preferences-changed` 同步 | `src/stores/desktopPreferences.ts:8,13` |
| 减少动效 | 工作模式与系统 `prefers-reduced-motion` 已全局禁用 animation/transition（会影响未来桌宠动画，见 §6.5） | `src/style.css:4,13` |
| pet 窗权限 | 仅默认能力＋`core:window:allow-start-dragging`；无穿透/位置类前端权限 | `src-tauri/capabilities/main.json:4-5` |
| 透明前置 | `macOSPrivateApi: true` 与 Cargo `macos-private-api` 特性均已开启 | `src-tauri/tauri.conf.json:13`、`src-tauri/Cargo.toml:15` |

已有原生证据（S0，API 级、探针环境）：透明窗创建、置顶、`set_ignore_cursor_events` 穿透往返、`set_visible_on_all_workspaces`、多显示器枚举通过，见 [s0-20261029.md](s0-20261029.md) 与 [s0-20261029-evidence.json](s0-20261029-evidence.json)（`clickThroughApiRoundtrip`／`petAlwaysOnTop`）。逐像素点击、拖拽边界、全屏 Space、多屏拔插与真实安装包内的表现仍属 S0 remaining，未验证。

## 4. 目标架构（建议）

事件动画的数据通路，复用既有 emit→listen 模式：

```
Rust 宿主（业务时刻）                          pet 窗（PetWindow）
  发现候选 → found             emit("pet-state", {state, reason})
  到期提醒 → remind      ────────────────────────────────────▶  listen → 桌宠状态机 → 渲染层
  完成致意 → done                                        （idle 循环＋事件序列，播完回 idle）
```

- 事件源：建议由宿主在业务时刻显式 emit 专用 `pet-state` 事件，而不是让 pet 窗订阅全部业务事件（保持 pet 窗薄、语义集中）。
- 状态机：纯逻辑放 `src/domain/`（守则：允许 Vue 响应式原语，禁止 stores／组件／IPC）；状态集合即产品四态（[产品定义](../product/01-产品定义.md) 四态行）；输入至少含事件、工作模式、`prefers-reduced-motion`。
- 资产改造：四张 SVG 需命名分组／class 才能做分层 CSS 动画（呼吸、眨眼、举本子等）；WebKit 上对 SVG 元素做 CSS 动画应动画 `transform`（配 `transform-box: fill-box`），不要动画几何属性（WebKit 兼容性经验，见 §7）。

## 5. 渲染层选型

| 方案 | 运行时 | 优势 | 代价/风险 | 判断 |
|---|---|---|---|---|
| A. 四态 SVG ＋ CSS keyframes（motion-v 编排） | 零新增依赖（motion-v 2.9.0 已在 `package.json`） | 最符合"桌宠优先 SVG"（[分期交付与验收](../product/04-分期交付与验收.md) 资源行）；合成器驱动、空闲开销最低；工作模式/减少动效开关天然覆盖 | 表现力上限低；SVG 需重构为可动画结构（美术工作） | **推荐起步** |
| B. Lottie（lottie-web，纯 JS） | 约 70KB | After Effects 管线成熟；无 CSP 改动；矢量 | 无内建状态机，idle⇄event 全手写；复杂场景性能弱于 WebGL 方案 | 第一升级选项 |
| C. Rive（@rive-app/canvas） | WASM＋WebGL | 内建 state machine（待机⇄事件转换是原生能力）、性能最好，最适合交互吉祥物 | 需 CSP `script-src` 增加 `'wasm-unsafe-eval'`（§6.4）；与"优先 SVG"约束冲突，属"确有价值时引入" | 引入前必须连 CSP 一起探针 |

不推荐：Spine（编辑器收费、面向游戏骨骼）、Live2D（最重、授权受限、与圆豆形象不匹配）、帧序列／透明视频（WKWebView 不可靠、体积大）、原生 Swift 重写（放弃现有栈，无收益）。

升级路径：先用 A 交付四态动画；若角色需更丰富表现，按仓库流程先跑 B/C 对比探针再决策（新增生产依赖需 owner 单独授权）。

## 6. 关键风险与未验证项（实施切片必须收口）

1. **安装包内透明度**：Tauri 有 dev 透明正常、bundle 后失效的已知案例（tauri#13415，§7）。S4 原生验收必须包含真实安装包的 pet 窗透明表现（并入 S0 remaining 的安装包补测；逐项留证要求见 [分期交付与验收](../product/04-分期交付与验收.md) 原生体验行）。
2. **隐藏窗口动画释放**：属既有逐项留证要求（同上原生体验行、资源行）。WKWebView 随宿主窗隐藏时的 `visibilitychange` 行为未验证；实现需事件驱动暂停动画，并在原生验收留证。
3. **点击穿透与可交互共存**：宠物本体可点可拖、透明区域穿透，需按命中区域动态切换 `setIgnoreCursorEvents`；逐像素边界未验证（S0 remaining）。当前 pet 窗前端无穿透权限（穿透仅 Rust 侧探针调用过），实施时需补 capability 与守卫认知。
4. **Rive 路线的 CSP**：现有 CSP `script-src 'self'`（`src-tauri/tauri.conf.json:25`）会阻塞 WASM；WebKit 自 Safari 16.4 起支持 `'wasm-unsafe-eval'`（WebKit bug 235408，§7），而 bundle `minimumSystemVersion 12.0` 覆盖未更新到 16.4 的机器。选 C 必须先探针并同步改 CSP。
5. **工作模式语义**：现有全局禁动画 CSS（`src/style.css:4`）会连桌宠待机动画一起关掉；验收要求"装饰动画不阻碍操作，工作模式保留静态提醒与未读"（[分期交付与验收](../product/04-分期交付与验收.md) 视觉验收行），实施时需把提醒态从全局禁用中豁免或单独处理。
6. **资源口径**：空闲 CPU、进程树 RSS、安装包体积与隐藏窗口动画行为属既有验收项（同上资源行），动画方案定稿后按同机同数据口径补测，不照搬未实测预算。
7. **附加发现（已知债候选，非本次调研目标）**：`run_s0_probes` 在正常生产包仍注册且可调用（`src-tauri/src/app/mod.rs:27`；仅在 `s33-mcp-ui-verification` feature 下被拒绝，见 `src-tauri/src/diagnostics/s0_probe.rs:9-15`），且会直接操作生产 pet 窗（穿透开关、全工作区）。若非有意保留，桌面切片收口时应处理（拒绝或改用专用窗口）。

另按 [DESIGN.md](../../DESIGN.md)（班班反馈行、Don't 行）：四态静态 SVG 草案不得称为已验证的原生动画／点击穿透／多屏适配；本文 §5 选型同样属未实施的规划判断。

## 7. 外部参考

- Tauri 配置参考（transparent／macOSPrivateApi 与 Cargo 特性需匹配）：<https://v2.tauri.app/reference/config/>；<https://github.com/tauri-apps/tauri/issues/11142>
- 打包后透明失效案例：<https://github.com/tauri-apps/tauri/issues/13415>
- WebKit CSP `wasm-unsafe-eval` 实现（Safari 16.4 起）：<https://bugs.webkit.org/show_bug.cgi?id=235408>
- WKWebView CSS 动画支持表：<https://caniwebview.com/features/mdn-css-property-animationtimingfunction>
- Rive 与 Lottie 对比、性能基准：<https://rive.app/>；<https://www.callstack.com/blog/lottie-vs-rive-performance>

## 8. 结论

- 桌宠待机动画＋事件动画在当前 Tauri 2 ＋ Vue 3 栈上**可行**；推荐 SVG 四态＋CSS/motion-v 起步，Lottie／Rive 作为受控升级。
- 本文全部"建议/判断"均未实施、未验证；引用的"已验证"以所引评审记录为准。后续如立桌宠动画切片，按[验证约定](../engineering/verification.md)走门禁与留证。
