# 测试结构说明

本目录按测试**运行依赖**分层。历史交付切片的文件名保持不变，用于对照 `docs/reviews/` 中的证据；npm 脚本名同样是稳定接口，不随目录调整改名。

## 四个子目录

| 目录 | 职责 | 运行条件 |
|---|---|---|
| `unit/` | 纯域模型、客户端 store、契约解析；只进程内调用，不依赖构建产物 | `node --test` 直接可跑 |
| `integration/` | 需要构建产物的测试：`build/s0-runtime/`（打包 Runtime）、Rust example、`.app` 包、真实子进程生命周期 | 先 `npm run probe:bundle` 或先构建对应 Rust 目标 |
| `probes/` | 探针脚本与探针自测（`bundle-smoke.mjs`、`probe-contract.test.mjs`、`s33/` 进程夹具等），保持原位 | 由 `probe:*` 脚本驱动 |
| `fixtures/` | 合成输入、配置、服务与浏览器夹具；只放输入，不放断言 | 被测试或脚本按相对路径引用 |

跨层路径规则：`unit/` 与 `integration/` 引用仓库源码时使用 `../../src/…`、`../../shared/…`、`../../runtime/…`；需要构建产物时用相对仓库根的 `build/…` 路径。`fixtures/`、`probes/` 仍在 `tests/` 下一层，引用深度保持 `../../…`。

## 切片 → 领域映射

| 测试文件（文件名保持不变） | 层 | 覆盖领域 |
|---|---|---|
| `s1-domain.test.mjs` | unit | 事项域：候选、过滤、今日列表 |
| `s1-state.test.mjs` | unit | 待办 store 状态机 |
| `s1-profile.test.mjs` | unit | 个人资料模型 |
| `s2-dates.test.mjs` | unit | 日期表达式解析与时区（`shared/dates.mjs`） |
| `s2-contract.test.mjs` | unit | 模型输出契约（`runtime/lib/organizer-contract.mjs`） |
| `s2-client.test.mjs` | unit | 文本整理客户端、正式任务unknown／迟到接收与模型设置 |
| `s2-bash.test.mjs` | integration | managed Bash worker 生命周期与凭据脱敏 |
| `s2-runtime.test.mjs` | integration | 打包 organizer Runtime 的提取流程 |
| `s31-client.test.mjs` | unit | 智能体偏好配置、同run未知结果／终态吸收及真实Pinia store |
| `tracker-contract.test.mjs` | unit | tracker独立结果、样本引用、未知字段／控制字符／重复与工具载荷拒绝 |
| `advisor-contract.test.mjs` | unit | advisor完整固定事实、快照／日期／时区、多合法排序与解释、谓词／比较及工具载荷拒绝 |
| `s31-runtime.test.mjs` | integration | 打包 Runtime 的三角色隔离试跑及advisor联网前拒绝正反控 |
| `layout-domain.test.mjs` | unit | 布局/表单/设置域模型与控件绑定 |
| `layout-runtime.test.mjs` | integration | 打包 Runtime 的采样与推理参数透传 |
| `s32-skills.test.mjs` | unit | Skills 扫描、冻结与内置包 |
| `s32-client.test.mjs` | unit | Skills 客户端 store |
| `s32-read.test.mjs` | unit | Skill Read 路径约束 |
| `s32-runtime.test.mjs` | integration | 打包 Runtime 的 Skills 工具循环 |
| `s32-live.mjs` | integration | 显式可选的真实模型验证（读 owner 指定的模型环境文件） |
| `s33-catalog.test.mjs` | unit | MCP 目录归一化 |
| `s33-config.test.mjs` | unit | MCP 配置 store |
| `s33-json.test.mjs` | unit | MCP JSON 导入/导出 |
| `s33-security.test.mjs` | unit | MCP 凭据引用与安全校验 |
| `s33-ui-state.test.mjs` | unit | MCP 诊断 store 与订阅清理 |
| `s33-upgrade.test.mjs` | unit | MCP 配置升级 store |
| `s33-lifecycle.test.mjs` | integration | 进程/宿主生命周期 |
| `s33-discovery.test.mjs` | integration | 原生宿主的 MCP 发现 |
| `s33-native-fd.test.mjs` | integration | 原生文件描述符审计 |
| `s33-ui-safety.test.mjs` | integration | 验证包的 UI 安全守卫 |
| `s33-ui-artifacts.test.mjs` | integration | 打包产物内容与签名边界 |
| `mcp-trial.test.mjs` | unit | MCP隔离调用的命名、参数、结果预算、ACK归属及unknown提示 |
| `mcp-http-config.test.mjs` | unit | HTTP URL／头引用、JSON互斥往返、transport草稿与保存读回；无网络 |
| `mcp-http-host.test.mjs` | integration | 真实Rust／Pi HTTP诊断、宿主头引用、取消／关闭、目录重开与正式表不变；只用loopback |
| `mcp-http.test.mjs` | integration | 固定Pi HTTP适配、真实loopback JSON／SSE、取消／重定向／读取边界及会话关闭；只用合成值 |
| `mcp-recovery.test.mjs` | integration | 真实Pi／Runtime取消、迟到、progress硬期限、ACK身份与拥塞下绝对期限；受控ACK替身 |
| `model-budget.test.mjs` | integration | 独立临时SQLite／假上游的跨进程额度、锁、故障、SSE及MCP-only边界 |
| `native-launcher.test.mjs` | integration | 原生runner恢复准入与零副作用拒绝；仅OS替身，不启动GUI |
| `native-model-fetch.test.mjs` | integration | 原生验收专用固定socket、模型owner、零重连／重定向与有界HTTP；合成输入 |
| `mcp-launcher.test.mjs` | integration | 真实验收launcher准入、异常收尾、进程退出竞态；替身与自有OS进程分层 |

Rust的`store/mcp_calls_tests.rs`覆盖调用台账、冻结和终态优先级，聚焦入口为`npm run test:mcp-calls`；`host/mcp_trial_tests.rs`通过真实Rust宿主、随包Runtime／Pi、本机合成模型和stdio服务做整链集成，使用`npm run test:mcp-trial`（先打包）。两者也随既有`probe:native`进入完整`check`，不需要真实模型或用户根。合成模型／服务输入在`fixtures/mcp-trial.mjs`；不能用这些结果替代原生验收。

P4恢复矩阵在`host/mcp_recovery_tests.rs`及嵌套的`mcp_host_recovery_tests.rs`，入口`npm run test:mcp-recovery-host`：实际事务故障、精确累计预算、禁止重试、真实宿主强杀／冷启、进程组回收和OS管道限额；随`probe:native`进入完整门禁。Node接缝入口`npm run test:mcp-recovery`先由纳管脚本`prepare-mcp-recovery.mjs`从固定Pi源码构建，再运行14项集成测试；只把ACK作为受控替身，持久化由Rust矩阵另证。停读／畸形输出／累计字节超限及槽恢复输入在`fixtures/mcp-runtime-fault.mjs`，不冒充真实Pi。所有输入仅合成，均不调用真实模型、生产钥匙串或真实用户根。

P5正式任务矩阵在`host/mcp_formal_tests.rs`，聚焦`npm run test:mcp-formal`，存储扩展在`store/mcp_formal_calls_tests.rs`并由原`test:mcp-calls`带入。`npm run test:model-budget`聚合两份预算／launcher测试；故障接缝`probes/model-budget-faults.py`纳管，只用新临时库和假上游，不能把mock fsync／commit冒充真实断电或SQLite VFS验证。`npm run test:mcp-budgeted`通过受控代理、真实Pi／stdio与Rust闭环，但上游仍合成，不读真实env；需要先有`probe:bundle`产物，runner按`probe:mcp-live:prepare`编译验收test。上述均随完整门禁执行。

显式`npm run probe:mcp-live`仅供owner已授权的有界真实验收：先核独立双面交付及预算验证的私有、冻结证据，再打开已有本夜预算库，所有真实HTTP先持久占槽；不自动初始化／重置、不会运行旧unbudgeted live用例。真实key只进可信代理内存，Runtime／App只拿合成relay凭据；真实与合成结果分别署名，原生验收仍需单独证据。

## 新测试命名约定

- 新测试用领域名，不再用交付切片号：`<domain>-<subject>.test.mjs`（例如 `skills-freeze.test.mjs`、`mcp-discovery-timeout.test.mjs`）。
- 只依赖纯逻辑与 store 的测试放 `unit/`；需要打包 Runtime、Rust 二进制、真实子进程或 `.app` 产物的放 `integration/`；探针脚本与探针自测放 `probes/`。
- 新增断言优先落在已有测试的领域文件里；确需新文件时保持单一领域主题，并同步在本文档增加一行映射。
- 测试数据只放 `fixtures/`，使用合成内容；不提交真实密钥、个人来源原文或本机私有路径。
- npm 脚本名沿用既有切片命名（稳定接口）；新测试通过既有 `test:*` 脚本或 `node --test` 路径接入，必要时由维护者另行决定脚本名。

P6原生入口`npm run probe:mcp-native`只启动专用包、新根／nonce和随包Node合成模型，先核实际LISTEN归属再经LaunchServices启动；不读取模型环境文件，不调用真实上游。`test:mcp-native-fetch`随完整门禁运行，校验已连接socket发送前归属、owner丢失／端口替代、无重试／重定向与输入响应预算；它不代替原生GUI。Rust双特性守卫另覆盖内存模型、校验后稳定路径替换、journal入口拒绝、冷启owner和恢复前身份门。

无交互stdin时，冷重开用`node scripts/probes/run-mcp-native.mjs --reopen <本轮证据目录> 640 900`或1440 1000；必须先经GUI退出旧App。独立入口只读已有私有receipt并验证原模型owner／marker／scope，不创建新根或模型Child；实际尺寸确认后才发布ready。`test:mcp-native-launcher`在完整check的两包构建之后运行，所有负例由测试包装器阻止OS open，不能冒充原生启动证据。

HTTP任务矩阵在`host/mcp_http_task_tests.rs`，聚焦`npm run test:mcp-http-task`：真实Rust／随包Pi／本机合成模型与HTTP CLI fixture，覆盖混合同名、正式闭环、声明头与session脱敏、配置冻结、ACK／落库故障、unknown冷启和迟到不发布；随原`probe:native`进入完整门禁。`fixtures/mcp-http.mjs`既可作为in-process受控HTTP服务，也可由测试自建Child启动；产品仅关闭连接，不终止服务。

S3.5 advisor宿主矩阵在`host/advisor_trial_tests.rs`，聚焦`npm run probe:native -- advisor_trial_tests`：真实Rust／随包Pi／本机合成模型，非空正式五表与tool_calls逐行不变、旧恢复先行、配置冻结、多种排序／说明、空／失败／取消与冷重开。固定日期场景与模型回答输入在`fixtures/advisor-trial.mjs`及自包含`mcp-trial.mjs`中；全部仅合成，不代表原生或真实今日建议。advisor最终接收反例随稳定`test:s31-store`，契约及客户端随`test:s31-domain`，直接Runtime随`test:s31-runtime`及完整check执行。
