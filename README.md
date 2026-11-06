# 跟班 Sidekick

**盯着呢，老板。** / *On it, boss.*

个人 AI 待办管家。由班班收拢事项、辅助签收、持续跟踪与提醒，管理“待我处理”和“待我跟进”。目标为 Web/后端完整业务先行，浏览器验收后接入轻量 macOS 桌宠壳。

## 当前状态

- 实施状态的唯一来源是[第一阶段实施计划](docs/product/05-第一阶段实施计划.md)顶部的当前实施总览；逐项证据与开放项见[评审记录索引](docs/reviews/README.md)。本文件说明使用方式，不维护第二份进度清单。
- 功能实现、受控服务、真实模型、浏览器与原生验收分别记账。安装包可构建或合成验证通过，不代表原生完整动线、真实服务、真实用户根或同事试用验收通过。
- 规划中的能力只出现在产品基线里，未经业务实测；文档不会把计划、原型或合成替身写成已实现。

目标方向与当前代码分开阅读：新目标为 Node/TypeScript 后端＋SQLite 持久队列（默认 3 并发）＋Vue Web，支持本机及 Linux 主机反向代理；当前代码仍为 Rust/Tauri 宿主。新后端尚未实现，目标契约见[Web/后端设计](docs/engineering/web-backend-design.md)。下列构建与使用命令仍适用于现有桌面代码，不是新 Web 部署说明。

## 产品基线

- [产品定义](docs/product/01-产品定义.md)
- [用户流程](docs/product/02-用户流程.md)
- [智能体与架构](docs/product/03-智能体与架构.md)
- [分期交付与验收](docs/product/04-分期交付与验收.md)
- [第一阶段实施计划与状态](docs/product/05-第一阶段实施计划.md)
- [S0 技术探针记录](docs/reviews/s0-20261029.md)
- [S2 实现与分层验证记录](docs/reviews/s2-20261029.md)

本仓库的历史说明书、评审资料保留溯源，以 `docs/product/` 为当前产品基线。

## 仓库结构

```text
AGENTS.md            # 每轮必读：项目事实、命令、硬约束、文档地图
shared/              # 跨进程纯逻辑（日期与时间锚点），前端与 Runtime 共用
src/                 # Vue 3 前端：components/（含 ui/ 公共控件）、domain/、stores/、styles/、assets/
runtime/             # 随包 Node Runtime：entries/ 任务入口、lib/ 库、workers/ 子进程
src-tauri/src/       # Rust 宿主：app/ 装配与 IPC、store/ 业务存储、host/ 外部宿主、diagnostics/ 探针
tests/               # unit/、integration/、probes/、fixtures/
scripts/             # build/ 打包、checks/ 结构与文档守卫、probes/ 一次性探针
design/              # 设计原型与评审；预览 node design/serve.mjs
vendor/pi/           # 固定上游 Pi 源码（只读）
resources/skills/    # 内置技能与哈希清单（只读）
docs/                # product/ 产品基线、engineering/ 工程约定、reviews/ 记录与证据
```

- 结构、依赖边界与新代码放置的权威文件是[工程架构](docs/engineering/architecture.md)；生产前端只依赖 `src/` 与 `shared/`，不引用 `design/` 或 `runtime/`。
- `vendor/pi/`、`resources/skills/` 是固定上游与内置技能，只读；版本变化需要单独授权。
- 目录迁移不改变 npm 脚本名与测试文件名，历史命令仍可按名执行。

## 工程约定

- 全量门禁：`npm run check`（包含 `check:structure` 与 `check:docs`）；门禁矩阵、测试分层、证据新鲜度与独立评审要求见[验证约定](docs/engineering/verification.md)。
- 不可绕过：未验证不关闭；证据默认放 `build/<slice>/`，仓库只收精选主证据与对应记录。
- 需授权才能做：新增生产依赖、改 schema／migrations、改 identifier `com.sidekick.s0` 与资源目录 `s0-runtime`、真实凭据或真实用户根操作、commit／push。
- 文档地图与权威边界见[文档地图](docs/README.md)；历史记录按当时版本保留，复核用 `git show <commit>:<path>`。

## 品牌与交互设计

- [设计预览与运行说明](design/README.md)
- [设计规范](DESIGN.md)：配色、字阶、组件与响应式约定。
- [品牌板](design/brand/index.html)：标志、桌宠四态、配色、字体及SVG资产。
- [已确认配置布局](design/layout-review/index.html)：设置、模型服务、智能体与公共控件。
- [首轮交互原型](design/prototype/index.html)：今日工作台、候选签收、事项处理、日报及配置流程。

在仓库根目录运行 `node design/serve.mjs`（只读服务，默认 `127.0.0.1:4173`，`PORT` 可覆盖）后访问：

- 品牌板 `http://127.0.0.1:4173/design/brand/`
- 交互原型 `http://127.0.0.1:4173/design/prototype/`
- 配置布局 `http://127.0.0.1:4173/design/layout-review/`

生产设计令牌在 `src/styles/tokens.css`，品牌字体与 OFL 许可在 `src/assets/fonts/`；原型消费生产资产。原型使用虚构演示数据，交互仅保留在当前页面，不证明原生能力。

## 构建与验证

探针工程使用 Node 24、npm 12 与 Rust 1.89，当前仅在 macOS 27.0.1 arm64 验证。先执行：

```sh
npm ci --ignore-scripts
npm run probe:prepare-cli
npm run probe:prepare-pi
npm run check
npm run probe:app
```

Pi 从 `vendor/pi/` 固定源码构建，准备阶段会获取上游公开模型目录数据，需要网络；不是完全离线或逐字节可复现的构建。模型目录与构建产物不提交，源码和两份锁文件保留版本依据。安装包为 `src-tauri/target/release/bundle/macos/Sidekick.app`，使用 ad-hoc 签名、未经公证。正常启动不自动调用模型或飞书、不种入演示数据；用户发起连接测试、文本整理或候选修改时才调用所配模型。S0 诊断页保留为开发路由 `?probe=1`。

真实模型验证为显式可选命令：`SIDEKICK_MODEL_ENV="$PWD/.env.deepseek" npm run test:s2-live`，使用已选配置、合成文本、临时工作根及隔离钥匙串条目，结束后清理。它会访问所选模型服务，不属于自动 `check`；产品不会自行读取 `.env`。S0 原探针仍可单独运行，详细前提见 S0 记录。

## 本地手工使用

1. 打开 `Sidekick.app`，使用默认位置或选择空文件夹；已有跟班工作目录会先校验归属和版本。
2. 点击“快速录入”或在应用内按 ⌘K，填写标题、类型、实际负责人、优先级和标签。截止与下次跟进分别启用；不设置时间即保留为未定期。
3. 从今日或全部事项打开详情，可编辑／延期、完成、重新打开、确认删除和查活动历史。删除从普通清单移除，本地记录仍保留。
4. 退出应用后重开，自动读取同一工作根。设置可查看并打开该目录；运行中迁移、备份恢复、正式全局快捷窗及桌宠常驻体验在后续切片验收。
5. 业务库在 `workspaceRoot/data/sidekick.sqlite`，历史与事项同事务保存。固定应用数据目录中的 `bootstrap.json` 定位工作根。根丢失、库损坏或版本过新时显示错误，不以空库替代；请先恢复原目录或保留现场交由维护者检查。

聚焦检查：`npm run test:s1-domain`、`npm run test:s1-store`。隔离原生验收包使用 `npm run build:s1-verify` 构建，标识为 `com.sidekick.s1.verify.r2`，与普通包的数据指针分开。仓库截图与验收样本均为合成资料。

个人信息与设置从左下角个人按钮进入，默认打开个人信息。可填写昵称（默认“小明同学”）及独立的班班称呼（默认BOSS），可用“与昵称一致”复制后统一保存，保存后侧栏与简报立即生效，重启后恢复；偏好存于工作目录`config/profile.json`。通用设置保留工作目录入口，关于显示实际版本。桌宠仍按S4接入。

## 文本整理与签收

1. 个人入口 → “模型服务”，可视化管理多个供应商及模型；首个服务与首个模型一起保存。认证选择钥匙串Key或环境变量引用；没有JSON导入入口。连接测试选择当前供应商的已保存模型，不改变全局默认。Finder启动缺少环境变量时，可改用系统钥匙串。
2. “通用”统一选择应用时区；“快速录入 → 文本智能整理”粘贴原文，按需填写来源时间，不逐次填写时区。不填时间就固定使用首次录入锚点，旧来源重试保留原时间规则。原文直接送往所配模型，无逐批授权页。
3. 在“待确认”核对原文、负责人、类型、截止和下次跟进。可编辑、丢弃或用一句话生成修改预览，再单独应用。歧义时间需人工补充或明确核对未定期；仅日期不补造时刻。
4. 选择新建或人工关联已有事项，点击底部“签收选中事项”。关联只添加来源和历史，不覆盖原事项关键字段。未签收候选不进入正式计数；相同来源重复提交返回已有批次。
5. 从今日／全部事项继续完成、编辑和查看来源。任务失败保留输入，取消不签收；应用重开将未结束任务标为中断，已存候选可继续处理。

S2 每次任务总期限 120 秒；Bash 缺省 30 秒、最多 60 秒并受任务剩余期限约束。工作目录不是沙箱；通用 Bash 使用当前用户权限。事项整理使用已保存的角色配置和工具快照；MCP发现与调用、角色试跑及今日建议的验证边界见实施计划，不从相邻测试外推原生或真实服务通过。

新工作根初始化到 schema v3；首次打开 v1／v2 库先在工作根 `backups/` 做一致性备份，再事务升级到 v3。MCP存储由用户明确确认后升级到 v4，今日建议另经确认和备份升级到 v5；普通打开不自动跨越这些确认。当前版本可校验并打开已升级的 v4／v5 根，旧包不能强行降级写入。完整工作根的产品内备份恢复／运行中切根仍留 S5。

聚焦验证：`npm run test:s2-domain`、`npm run test:s2-store`、`npm run test:s2-runtime`。`npm run build:s2-verify` 构建隔离原生包；`npm run dev:s2-native-model` 仅启动本地合成模型服务，不是真实模型。`dev:profile-ui` 是真实 Vue／CSS 加 API 替身的界面夹具，不能证明 SQLite、钥匙串或原生 IPC。

## 智能体配置与隔离试跑

1. 个人入口 → “智能体”，选择事项整理、进展跟踪或工作参谋。模型可继承全局默认或单独覆盖，调整关注重点、表达详略和补充说明后保存；恢复默认先成为当前角色草稿，保存后生效。配置在工作根`config/agents/<roleId>.json`，保存后只影响新任务，重开恢复。
2. 事项整理可在右侧样例区发起真实模型试跑；有未保存草稿时先保存。结果只保存在`agent_runs`，不进入来源、待确认、正式事项或业务历史，可按需读取已发布Skills快照并调用Read／Bash；工作目录不是沙箱，不代表限制任意脚本的文件或网络能力。
3. 试跑可取消，失败保留样例和错误；重开可查最近结果与当时设置。旧结果不随当前草稿变化，配置改变后需重新试跑；保存结果未知时须先读回核对。
4. 进展跟踪试跑基于宿主固定合成事项和输入线索，输出关联／变更建议预览；工作参谋试跑基于固定完整合成事实给出排序和理由。这两种试跑不提供工具、不读取正式事项，也不改变正式业务数据。试跑配置和历史可重开查看；实际来源持续跟踪在 G2 交付。

原业务文本整理和修改预览也使用事项整理的配置；模型页的连接测试使用当前选择的已保存模型，结果绑定当时模型／配置修订，不修改全局默认。被角色覆盖引用的模型不能直接移除或禁用，应先解除覆盖。

聚焦：`npm run test:s31-domain`、`npm run test:s31-store`、`npm run test:s31-runtime`。真实隔离试跑：`SIDEKICK_MODEL_ENV="$PWD/.env.deepseek" npm run test:s31-live`，只读取owner指定配置，使用临时根／钥匙串条目及合成材料，不是普通启动行为。`npm run build:s31-verify`构建独立原生验收包，不打开普通包的用户工作根。

## 今日建议

今日工作台保留正式事项事实版；点击“启用今日建议”或“刷新建议”，由宿主读取事项、时间与状态并计算计数，工作参谋只给开放事项排序和理由。首次启用须核对当前根、备份和旧版本兼容说明后明确升级到 v5。生成可取消，失败保留事实版及上次成功结果；重开或事实、日期发生变化后重新核对当前性，旧快照明确标记。

设置中的工作参谋试跑使用固定合成场景；这里读取当前正式事项，两者用途和历史分开。N3已有受控宿主、Runtime与实际Vue合成IPC证据，原生／真实环境缺项见[今日建议记录](docs/reviews/s35-today-20261102.md)及[最终提交后核证补记](docs/reviews/g1-status-sync-20261102.md)。聚焦入口为 `npm run test:today-domain`、`test:today-store`、`test:today-runtime`、`test:today-host`。

## 公共表单与配置页验收

表单通过`src/components/ui/`统一，入口浅琥珀，保存实心琥珀，日期／下拉均为公共组件。通用设置的路径尾部为选择／打开两个图标；选择新目录明确未开放，完整迁移仍留S5。时区保存在工作根`config/app.json`，已有UTC时刻不平移，旧仅日期保留civil日期；保存结果未知或冲突须读回后再输入新时间／发起新任务。

供应商与模型草稿独立；未保存模型可从列表重新进入。Key替换草稿仅在内存，成功保存后清除，前端不读回已有明文。模型参数包含上下文／输出上限、工具与推理声明、可选采样与本地价格记录；未知价格不表示免费。推理“由服务决定／关闭／具体强度”区分实际请求，端点仍需支持；输出还受Pi剩余上下文和任务时限限制。

聚焦：`npm run test:layout-domain`、`npm run test:layout-runtime`。完整`npm run check`已包含这些检查。`npm run build:layout-verify`生成`Sidekick Layout Verify.app`（`com.sidekick.layout.verify`），与普通包工作根分开；用于新布局验收，不替代正式发布或历史原生补验。记录见[配置布局交付](docs/reviews/layout-production-20261029.md)。

`npm run dev:profile-ui`启动真实Vue／CSS的合成IPC夹具：`http://127.0.0.1:1475/?catalog=1`预置合成供应商；`modelConflict=1`／`settingsUncertain=1`验证恢复路径。夹具不会访问真实模型或用户工作根，不能用其“连接通过”文字证明真实业务服务已接通。

## Skills 安装、重扫与任务快照

1. 工作目录首次就绪后，安装缺失的18个内置技能包；包含正文、引用、场景与脚本共441文件，另有1份固定源码支持文件。资源来源、CLI兼容版本、MIT许可证与哈希清单见`resources/skills/manifest.json`。不自动扫描用户全局Skills，不发起飞书业务调用。
2. 个人入口 → “工具”，查看技能目录、有效索引、包详情、诊断与内置文件清单；路径尾部图标在Finder打开当前技能目录。将包含`SKILL.md`的完整文件夹放入后重新扫描，自定义包不会增加智能体数量。
3. 同名技能双方均不加载；坏入口、缺失引用、链接和超限显示包与文件诊断。扫描失败保留旧索引，但新工具任务须等重新扫描成功。200包、总4096文件／64MiB、单文件2MiB；索引只发布摘要，完整IPC响应限2MB；私有生成元数据读写限16MiB，技能单文件仍限2MiB。这些是包完整性规则，不是Bash沙箱。
4. 本地编辑和升级不会覆盖已有包，用户主动移除的内置包不因重扫被补回。需要重置时，选择具体内置包 → “恢复内置版本” → 核对文件范围 → “备份并恢复”；原目录整体保存在`backups/skills-<id>/`。确认后内容又变化会停止。恢复先将操作记录绑定到固定内置包清单、文件集合与哈希；来源不可确认时保留目录、备份和`config/skills-operation.json`供核对，不反复覆盖。
5. 新任务固定索引和完整有效包到`runs/<runId>/skill-resources/`；旧任务继续使用旧副本。技能正文按需Read，相对引用按成功读取的技能文件解释；通用Read继续支持`~`、`@`前缀和`file://`。Bash产物cwd仍为本次run。`skills-proof.json`只记录成功读取的相对位置及Bash命令摘要，不保存命令原文或模型密钥；独占创建，遇到已有文件或链接保留原目标，遗留记录不当作本次新证据。
6. 事项整理隔离试跑可实际使用Skills；禁用toolCall的模型只整理文本，界面明确不能验证Skills。进展跟踪／工作参谋隔离试跑保持空工具；事项整理可按当前配置发现并调用MCP工具。正式结果仍须人工签收，宿主没有给试跑提供正式业务写接口；通用Bash的用户级能力保持既定边界。

聚焦：`npm run test:s32-domain`、`npm run test:s32-runtime`。显式真实模型合成试跑：`SIDEKICK_MODEL_ENV="$PWD/.env.deepseek" npm run test:s32-live`，只读owner指定私有配置，使用临时根，结束清理。`npm run check`已接入S3.2回归，并先准备随包Runtime。

`npm run build:s32-verify`生成独立`Sidekick Skills Verify.app`（`com.sidekick.s32.verify`）。本轮原生证据包含18包安装、自定义包重扫、实际备份恢复、合成服务工具试跑与重开；真实DeepSeek另行验证。验收根含1个`s32-reader`合成技能和明确命名的本地合成模型，普通包不种入它们。`npm run dev:s32-native-model`为可选本地合成HTTP服务，端口由启动输出给出，可用`SIDEKICK_SYNTHETIC_PORT`固定；不代表真实模型或MCP服务。

详见[S3.2实现与验证记录](docs/reviews/s32-20261030.md)。历史原生缺项仍保留，当前不标记G1、S5或推广试用完成。

## stdio MCP 生命周期探针（S3.3／P1）

`npm run test:s33-lifecycle`从固定Pi源码构建独立探针，用随包Node与本机合成服务验证真实发现／调用、取消、工具及守护超时、分别强杀各层后的普通子孙清理，以及启动ACK／初始化取消。另有隔离的安全替身测试核对进程拥有关系结束后不再向旧PGID发信号；替身不作为真实清理证据。

探针及输入位于`tests/probes/s33/`、`tests/integration/s33-lifecycle.test.mjs`；`build/s33-lifecycle/`仅为可重建测试输出，没有加入安装包。宿主为Node替身，尚未接入Rust、MCP设置页、数据库台账或AgentTool；无真实模型／业务服务调用。实施边界与证据见[计划§16.7](docs/product/05-第一阶段实施计划.md#167-p1实施与分层证据2026-10-30)。历史原生未补验继续保留。

## MCP 服务配置与调用

个人入口 → 工具 → MCP服务，可保存stdio或Streamable HTTP服务；stdio支持命令、独立参数、可选工作目录和环境引用，HTTP支持URL与静态请求头的整值宿主变量引用。支持编辑、禁用、确认移除和重开读回。配置位于工作根`mcp/servers.json`，稳定ID不随名称变化；旧修订、坏配置、链接和超限不覆盖原文件。保存响应未知时保留草稿，重新读取核对后再继续。编辑区支持“表单／JSON”两种方式：可直接粘贴`mcpServers`、服务名映射、单个服务对象，以及`mcp_servers`／`servers`的JSON表达；多项配置先选择一项，再保存当前服务，不会按名称覆盖其他服务。Codex的TOML需先转JSON；未知字段、重复键、不支持的动态表达和旧式独立SSE传输会明确提示，不会丢字段后伪装成功。Streamable HTTP响应中的SSE是已支持传输的一部分，协议版本由Pi自动协商。

**保存不会启动服务；保存确认后可手动连接诊断，查看本次只读工具目录。成功表示初始化、发现、清理及持久化完成，不表示持续在线，也不会调用工具。** 草稿或保存结果未知时先保存／重新读取；旧修订结果明确标注，取消只针对已确认任务。普通环境值只供非秘密资料；宿主显式准备环境及安全引用，解析结果不经IPC回传，环境认证值使用整值`${HOST_VARIABLE}`引用。当前不启用生产秘密存储：钥匙串适配器代码已接入默认工厂，但工厂固定关闭，GUI不能新增／替换安全值；只有底层替身与编译／静态检查，真实系统钥匙串访问未授权、未执行；浏览器安全值使用内存替身，重载后显示缺失，不代表真实凭据持久化。

存储升级：004增加MCP探测与调用记录。普通打开仍最高自动到v3；MCP页提供明确确认的升级入口，先预检及一致备份再升级到v4，旧版本将不能打开此根；备份失败或未知结果不自动还原／重试。已为今日建议升级到v5的根沿用MCP所有权与调用语义。本轮未迁移真实用户根。生产宿主与固定Pi公开客户端经受控初始化、分页发现、共享槽及拥有ACK验证，清理确认后才保存完整schema与摘要回执。`npm run build:s33-ui-verify`生成专用隔离包，必须使用明确隔离启动参数，不会回落普通根。

实际调用：事项整理正式文本任务与隔离试跑可使用已配置MCP，调用发送与回执持久化；已发调用结果未知时停止本次任务，不自动重放副作用。stdio完整链路已有合成服务及历史真实模型合成材料验证，HTTP已有受控发现／调用／错误恢复与部分原生证据，分别见[S3.3收尾](docs/reviews/s33-closure-20261101.md)、[HTTP实现](docs/reviews/s34-http-20261101.md)和[HTTP原生补验](docs/reviews/s34-native-20261101.md)。

**仍未验收**：完整原生路径与两规定尺寸、HTTP剩余H3场景、真实MCP系统凭据／业务服务、真实用户根升级、S3整步及安装分发。原生捕获曾发生ScreenCaptureKit -3812，已取得的补验与剩余缺项分别保留；不据受控服务或后端通过关闭真实环境。生产MCP凭据后端保持关闭。

聚焦命令：`npm run test:s33-config-domain`／`test:s33-config-store`、`test:s33-security-domain`／`test:s33-security-store`、`test:s33-schema-store`、`test:s33-upgrade-domain`／`test:s33-upgrade-store`、`test:s33-keychain-adapter`、`test:s33-catalog-store`、`test:s33-ui-domain`／`test:s33-ui-safety`／`test:s33-ui-artifacts`、`test:s33-discovery`、`test:s33-native-fd`、`test:s33-verification-guards`；HTTP另有 `npm run test:mcp-http`、`test:mcp-http-host`、`test:mcp-http-task`。聚合入口`npm run check:s33-p2`覆盖对应受控回归，不能代替完整`npm run check`或整步原生验收；`npm run test:rust-no-keychain`仅跳过已列名的一项系统钥匙串探针，真实模型入口仍须显式授权运行。`test:s33-discovery`会启动并强杀自建测试进程，需允许本机ps／kill身份检查，不访问真实模型、真实凭据或外部服务。

证据按检查点存放，逐项边界见[配置保存](docs/reviews/s33-p2-config-20261030.md)、[环境项与安全边界](docs/reviews/s33-p2-security-20261030.md)、[迁移／存储](docs/reviews/s33-p2-schema-20261030.md)、[连接发现](docs/reviews/s33-p2-discovery-20261030.md)、[诊断页面](docs/reviews/s33-p2-ui-20261030.md)、[产品升级入口](docs/reviews/s33-p2-upgrade-20261030.md)、[钥匙串适配器](docs/reviews/s33-p2-keychain-20261030.md)、[P2收口核对](docs/reviews/s33-p2-closure-20261030.md)、[授权补验完整check](docs/reviews/s33-p2-authorized-20261030.md)、[原生续验](docs/reviews/s33-p2-native-20261031.md)、[-3812排查与复验](docs/reviews/s33-p2-sck-diagnosis-20261031.md)、[表单／JSON双模式](docs/reviews/s33-p2-json-20261031.md)。其中“完整check尚未执行”属于更早收口轮的历史状态，后续授权补验已实际跑通。
