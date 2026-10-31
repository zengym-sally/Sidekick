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
| `s2-client.test.mjs` | unit | 文本整理客户端与模型设置 |
| `s2-bash.test.mjs` | integration | managed Bash worker 生命周期与凭据脱敏 |
| `s2-runtime.test.mjs` | integration | 打包 organizer Runtime 的提取流程 |
| `s31-client.test.mjs` | unit | 智能体偏好配置、同run未知结果／终态吸收及真实Pinia store |
| `s31-runtime.test.mjs` | integration | 打包 Runtime 的隔离试跑 |
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
| `mcp-recovery.test.mjs` | integration | 真实Pi／Runtime取消、迟到、progress硬期限、ACK身份与拥塞下绝对期限；受控ACK替身 |

Rust的`store/mcp_calls_tests.rs`覆盖调用台账、冻结和终态优先级，聚焦入口为`npm run test:mcp-calls`；`host/mcp_trial_tests.rs`通过真实Rust宿主、随包Runtime／Pi、本机合成模型和stdio服务做整链集成，使用`npm run test:mcp-trial`（先打包）。两者也随既有`probe:native`进入完整`check`，不需要真实模型或用户根。合成模型／服务输入在`fixtures/mcp-trial.mjs`；不能用这些结果替代原生验收。

P4恢复矩阵在`host/mcp_recovery_tests.rs`及嵌套的`mcp_host_recovery_tests.rs`，入口`npm run test:mcp-recovery-host`：实际事务故障、精确累计预算、禁止重试、真实宿主强杀／冷启、进程组回收和OS管道限额；随`probe:native`进入完整门禁。Node接缝入口`npm run test:mcp-recovery`先由纳管脚本`prepare-mcp-recovery.mjs`从固定Pi源码构建，再运行14项集成测试；只把ACK作为受控替身，持久化由Rust矩阵另证。停读／畸形输出／累计字节超限及槽恢复输入在`fixtures/mcp-runtime-fault.mjs`，不冒充真实Pi。所有输入仅合成，均不调用真实模型、生产钥匙串或真实用户根。

## 新测试命名约定

- 新测试用领域名，不再用交付切片号：`<domain>-<subject>.test.mjs`（例如 `skills-freeze.test.mjs`、`mcp-discovery-timeout.test.mjs`）。
- 只依赖纯逻辑与 store 的测试放 `unit/`；需要打包 Runtime、Rust 二进制、真实子进程或 `.app` 产物的放 `integration/`；探针脚本与探针自测放 `probes/`。
- 新增断言优先落在已有测试的领域文件里；确需新文件时保持单一领域主题，并同步在本文档增加一行映射。
- 测试数据只放 `fixtures/`，使用合成内容；不提交真实密钥、个人来源原文或本机私有路径。
- npm 脚本名沿用既有切片命名（稳定接口）；新测试通过既有 `test:*` 脚本或 `node --test` 路径接入，必要时由维护者另行决定脚本名。
