# W0：平台元数据导致的开发门禁阻断修复（MAYNE-18）

> 结论先行：结构守卫已区分「机器本地运行时元数据」与「生产源码」，本任务工作树新完整 `npm run check` **exit 0**（attempt 2；attempt 1 的失败已逐项归因为既有性能抖动，证据留档）。修复候选达可送审状态，门禁恢复声明仅限本工作树（macOS arm64）。

## 1. 范围与风险级

- 范围：`scripts/checks/check-structure.mjs`（含原地 self-test）、`docs/engineering/architecture.md`（守卫规则同步）、本记录。未改 `.gitignore`、`AGENTS.md`、`package.json`、锁文件、生产源码、vendor、resources。
- 风险级：R2（机械守卫脚本行为变化；不触碰跨进程契约、凭据、schema、依赖、vendor）。按[验证约定](../engineering/verification.md)需独立评审，评审者 ZCode。
- 基点：本地基线 `85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（MAYNE-17 队长提交）；本任务工作树 HEAD `fb76dd049199a3577abe7cfc505e0340ebef0fbf`（基线之上的空标记提交，树内容等同基线）。交付时新增提交仅含上述三文件。
- 工作树核实（2026-11-06）：`pwd` = `…/ming-space-bc02289231eb/mayne-18-90a32718c451/worktree`；branch `agent/opencode/mayne-18-77944aa22df7`；`git merge-base --is-ancestor 85feb8a HEAD` → exit 0。

## 2. 修前失败证据（复现）

命令 `node scripts/checks/check-structure.mjs`（真实平台元数据在场的未跟踪文件）：

- 失败：**175 violations、exit 1**。
  - 172 × `top.dir`：`.multica/daemon_task_context.json`、`.multica/project/resources.json` 及 `.opencode/skills/**`（编码代理平台/运行时写入的机器本地元数据，均未跟踪、未被 `.gitignore` 覆盖，但 `git ls-files --others` 计入守卫工作集）。
  - 3 × `ref.missing`：`vendor/pi/packages/coding-agent/dist/**` —— 与元数据无关的构建前置缺口（本工作树未跑 `probe:prepare-pi`；共享根已构建故无此项）。
- `npm run check` 首步即 `check:structure`，因此整链被阻断。原始日志：`build/runtime-metadata-20261106/`（本机，不入库）。
- 事实说明：本轮核查时共享 main 根（`/Users/zengym/workspace/projects/ai/sidekick`）当前**不存在** `.multica`／`.opencode`（`ls` 报 No such file）；阻断发生在此前平台元数据在场的运行时点与本类代理工作树。守卫以工作集为准，两类环境同样适用。

## 3. 修复设计（守卫侧，一行未关 top.dir）

`check-structure.mjs` 新增两组显式常量与一条独立检查：

- `RUNTIME_METADATA_DIRS = { .multica, .opencode }`：仅这两个**显式列出**的平台/代理运行时元数据目录，在 `checkTopLevel` 中不再触发 `top.dir`（且仅限目录内文件；根级同名文件仍走 `top.file`）。
- 新规则 `metadata.tracked`：任何被 git 跟踪的 `.multica/**`／`.opencode/**` 一律拒绝 —— 元数据必须保持"可用且不入库"。
- 新规则 `metadata.code`：`.multica/**`（守护进程数据目录）中出现可执行代码扩展名（`mjs|cjs|js|mts|cts|ts|jsx|tsx|vue|py|pyc|sh|bash|zsh|rs|go|rb|pl|php|java|kt|kts|swift|c|cc|cpp|h|hpp|exe|so|dylib|dll|wasm`）即拒绝 —— 生产源码不能伪装成元数据；`.opencode/` 的自带工具载荷（技能脚本）按机器本地运行时容忍，但同样永不入库。
- 其余边界零改动：层级引用扫描（`SCAN_TOPS` 不含元数据目录，元数据也从不进打包输入——打包入口是显式清单）、`layout.*`、`tracked.forbidden`、`tracked.env`、`schema.immutable-migration`、`pkg.*` 全部原样。未知新顶层目录（含未来新平台目录）依旧 `top.dir`，须同步文档+守卫并评审。
- 设计取舍：不改 `.gitignore`（属公共基线文件，且 gitignore 不影响守卫的"入库卫生"目标；未跟踪状态保持可见）；不建议把任意 agent 目录批量豁免，新目录按例逐个显式登记。

## 4. 验证证据（实际命令与退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `node --check scripts/checks/check-structure.mjs` | 0 | 语法通过 |
| 2 | `node scripts/checks/check-structure.mjs --self-test` | 0 | **22 个违规类**（原 19 + `top.dir` 显式断言 + `metadata.tracked` + `metadata.code`）、8 项逐条引用违规全部检出；合成正例（未跟踪 `.multica/*.json`、`.opencode/**` 含脚本载荷）零误报 |
| 3 | `node scripts/checks/check-structure.mjs`（修后、真实 `.multica`+`.opencode` 在场） | 1→0 | 先剩 3 × `ref.missing`（构建前置）；`npm run probe:prepare-pi`（exit 0，pi 固定源 `tree=e89822b…`）后 **exit 0**（211 源文件、460 相对引用） |
| 4 | 负例 A：写入未跟踪 `.multica/sneaky.mjs`（跨层 import） | 1 | `FAIL [metadata.code]` ✓ 拒绝 |
| 5 | 负例 B：`git add .multica/project/resources.json` 后检查（随后 `git reset` 还原索引） | 1 | `FAIL [metadata.tracked]` ✓ 拒绝 |
| 6 | 负例 C：未跟踪 `randomtool/cache.json` | 1 | `FAIL [top.dir]` ✓ 未知顶层目录仍拒绝 |
| 7 | 负例 D：未跟踪 `src/tmp-crosslayer-probe.mjs`（import runtime/） | 1 | `FAIL [layer.src]` ✓ 层级边界未被绕过 |
| 8 | `npm run probe:prepare-cli` | 0 | 随包 CLI v1.0.98（`--ignore-scripts` 跳过了 postinstall，属准备命令，非新依赖） |
| 9 | `npm run check`（attempt 1） | **1** | 走到 `probe:bundle-smoke` 失败，见 §5 归因 |
| 10 | `npm run check`（attempt 2，机器空闲） | **0** | 全链通过，见 §6 |

## 5. attempt 1 失败归因（非本修复引入）

- 失败点：`probe:bundle-smoke` → 打包探针自吞错误（`Bundled Runtime probe failed.`）。用调试副本（仅改 catch 打印，验证后删除）定位到 bash 步骤 `lark-cli --version` 返回 `command not found (127)`——但**同一时刻**以完全相同调用（受限 `env` + 绝对路径 + 20s 超时）在空闲机器上重跑真实 `probe.mjs`：`{"status":"passed",…}` exit 0。
- 归类：attempt 1 时机器刚串行跑完 306s cargo 测试套件等重载步骤，47MB `lark-cli` 冷启动超出探针写死的 `timeout: 3`（秒）。属**既有性能抖动**（探针代码不在本任务写入范围，未改动）；与本修复无因果（本修复只改静态结构守卫，不触碰打包探针）。
- 处置：attempt 1 日志保留 `build/runtime-metadata-20261106/full-check.attempt1.log`；根治候选（调大该步 timeout 或预热）列入 §8 开放项，交 stage 2 决策。

## 6. attempt 2 全量门禁（exit 0）与警告分类

- 计数（对日志全量求和）：Node `node --test` 35 节 **968 pass / 0 fail**；cargo 6 个套件 **375 passed / 0 failed / 4 ignored 槽位**（不同特性组合重复计数）；64 个 npm 脚本步骤；两包构建 + ad-hoc 签名完成（`Sidekick MCP Verify.app`、`Sidekick.app`）。
- 警告分类（全部为[验证约定](../engineering/verification.md)既知基线，无新增类别）：
  1. esbuild 随包 Runtime 体积提示（`probe.mjs 2.3mb ⚠️`、`organizer.mjs 2.4mb ⚠️`）×14 —— 基线；
  2. Rolldown/Vite chunk >500kB 提示 ×2 —— 基线；
  3. ad-hoc 签名 "replacing existing signature" 与跳过公证（无 APPLE_ID 等）×2 —— 基线。
- 环境前置（均已按 AGENTS.md 准备命令补齐，非新增依赖）：`npm ci --ignore-scripts`、`probe:prepare-pi`、`probe:prepare-cli`。
- 原始日志：`build/runtime-metadata-20261106/full-check.log`（attempt 2）、`full-check.attempt1.log`、`preflight.txt`（HEAD/工作区状态）。按留存策略不入库，本记录收摘要。

## 7. 冻结哈希（记录时点）

```
22a80a4d303b5ad46e111ad42df4246adb3354b5b5847f90a8a61f73ad3aea31  scripts/checks/check-structure.mjs
b74424cf1758ba8940862c274e07e83242725b4b41d8852831ea526f3d70aef3  docs/engineering/architecture.md
（本记录自身哈希随提交生成；复核用 git show <delivery-commit>:docs/reviews/runtime-metadata-20261106.md）
```

## 8. 未验证项与开放项（保持开放）

1. 共享 main 工作根未实测（授权边界禁止动共享根）；守卫为同一脚本，行为推断一致但未签。
2. Linux／Windows 未验证（本机 macOS arm64；与仓库现状一致，不外推）。
3. `docs/reviews/README.md` 索引登记未做（本任务写入范围不含该文件）——需集成任务/队长补登一行（见 §9）。
4. `.gitignore` 是否追加 `.multica/`、`.opencode/` 由 stage 2 决策（不改不阻断守卫；若加仅影响 git status 噪音，不影响入库卫生判定）。建议 diff（供队长审阅，未执行）：在 `# AgentTeams coordination state` 块附近追加 `# Coding-agent platform runtime metadata (never committed)`、`/.multica/`、`/.opencode/`。
5. 打包探针 `timeout: 3` 冷启动抖动（§5）的根治不在本任务范围。
6. attempt 1 属单次观察的负载相关抖动，未做压力复现统计。

## 9. 交接清单（给队长 / stage 2）

- 交付提交：本工作树分支 `agent/opencode/mayne-18-77944aa22df7` 上、基线 `fb76dd0` 之上的单个新提交，仅含 `scripts/checks/check-structure.mjs`、`docs/engineering/architecture.md`、`docs/reviews/runtime-metadata-20261106.md`；工作区中 `AGENTS.md` 的平台自动托管改动与 `.multica/`、`.opencode/`、`build/` 均**不入提交**。
- 索引补登（`docs/reviews/README.md` 表首行）：
  `| [runtime-metadata-20261106.md](runtime-metadata-20261106.md) | 2026-11-06 | W0 门禁修复：结构守卫区分平台运行时元数据；本工作树新完整 check exit 0（attempt1 失败已归因既有冷启动抖动） | 原始证据 build/runtime-metadata-20261106/ |`
- 独立评审：ZCode（未参与本实现）；评审可执行命令见 §4 表。
