# 结构治理与工程约定沉淀（2026-10-31）

> **模式**：结构治理＋约定沉淀的集成记录，**不是**发布 GO／NO-GO，也不代表产品能力验收。范围是仓库工程结构、依赖边界、机械守卫与工程文档，不含功能、schema、依赖或产品承诺变更。
> **风险级**：R3（跨进程契约、凭据与安全边界、数据迁移不变量均受影响面），按双面独立评审 + 独立验证 + owner 授权推进。
> **结论（T8 时点，T9 续记见第 12 节）**：迁移与约定已落地，迁移后完整 `npm run check` exit 0，T5 验证 pass、T6／T7 独立评审 pass（3 条 low 文档发现与 2 条 low 记录笔误，均已在本文档轮关闭或指派更正）；**该时点工作区仍未提交**，提交约束见第 10 节；未验证项与残余风险如实保留（第 6、7 节）。
> **计划来源**：`build/struct-review-20261031/plan.md`（v2，gitignored 工作稿，未提交；本记录与 [工程架构](../engineering/architecture.md) 才是可引用的权威约定）。
> **验证来源**：T5 独立验证报告与证据 `build/struct-review-20261031/post/`（`summary.md`、`summary.json`、`check.log` 等）；T6 架构评审与 T7 实现评审的 verdict 与 findings。

## 1. 目标与本轮范围

本轮解决的是“随切片快速迭代留下的结构债”和“没有工程约定”两件事：

1. **修跨层依赖**：生产前端不得依赖 `design/` 与 `runtime/`；跨进程日期逻辑归入中立 `shared/`；品牌令牌、字体与 SVG 归生产所有，设计稿消费生产资产。
2. **源码归组**：`runtime/` 按 `entries/lib/workers`、`src-tauri/src/` 按 `app/store/host/diagnostics`、`scripts/` 按 `build/checks/probes`、`tests/` 按 `unit/integration/probes/fixtures` 分组；**测试文件名、npm 脚本名、Rust 模块名与公开路径保持不变**。
3. **沉淀约定**：[AGENTS.md](../../AGENTS.md)（导航型）＋ [工程架构](../engineering/architecture.md)（结构／边界／放置）＋ [验证约定](../engineering/verification.md)（门禁／证据／评审）＋ [文档地图](../README.md)＋ [评审记录索引](README.md)。
4. **机械化守卫**：`scripts/checks/check-structure.mjs`（含 `--self-test` 负例）与 `scripts/checks/check-docs.mjs`，作为 `npm run check:structure`／`check:docs` 接入 `npm run check` 首位。
5. **保持可复核**：迁移前后完整门禁对照、独立验证、双面独立评审、代码冻结哈希，全部留证。

**非目标**（本轮明确不做）：不重命名应用 identifier `com.sidekick.s0` 与资源目录 `s0-runtime`；不新增 CI；不重构 IPC 为类型化契约；不改测试文件名、不重命名 npm 脚本（除新增两个守卫脚本）；不做 UI／视觉改动；不运行真实模型、飞书或 MCP 业务调用；不删除历史评审证据。

## 2. 基线与迁移前证据

| 项 | 值 |
|---|---|
| 基线 commit | `808e268b1ca0be034892c2abd1c185d53596c0ee`（`main`，迁移全程未变、未 commit／push） |
| 起点工作区 | 干净（仅后来的 `.agent-teams/` 协调目录被加入 `.gitignore`） |
| 迁移前门禁 | `npm run check` exit 0（plan §7 声明；基线日志 `build/struct-review-20261031/check.log`，该日志无显式 `EXIT_CODE` 行，计数由 `post/parse-check-log.mjs` 解析） |
| 迁移前计数 | Node **266 pass / 0 fail**（20 组，逐组见 `post/baseline-summary.json`）；Rust `cargo test --lib` **126 passed / 0 failed / 2 ignored**；双特性 `verification` guards **8 passed**；两包构建（`Sidekick MCP Verify.app`、`Sidekick.app`）；`ordinaryResourceEntries` = **556** |
| 环境 | Node v24.20.0／npm 12.2.1、Rust／Cargo 1.89.0、Python 3.15.1、macOS 27.0.1 arm64；Playwright 未安装、无公证凭据（见 `post/environment.txt`） |

## 3. 迁移内容

### 3.1 路径映射摘要

| 迁移项 | 迁移前 | 迁移后 | 任务 |
|---|---|---|---|
| 共享层 | `runtime/dates.mjs`、`runtime/dates.d.mts` | `shared/dates.mjs`、`shared/dates.d.mts` | T1 |
| 生产品牌资产 | `design/brand/tokens.css`、`design/brand/fonts/{SpaceGrotesk.ttf,OFL.txt}`、`design/brand/*.svg` | `src/styles/tokens.css`、`src/assets/fonts/*`、`src/assets/brand/*.svg` | T1 |
| Runtime | 15 个平铺模块（14 个 `.mjs` + 1 个 `.d.mts`） | `runtime/entries/`（4）、`runtime/lib/`（7）、`runtime/workers/`（2）；`dates.*` 移入 `shared/` | T1 |
| 打包脚本 | `scripts/probes/{bundle-runtime,build-app}.mjs` | `scripts/build/`（`prepare-s33-lifecycle.mjs`、`rustc-host-macro.py` 留 `scripts/probes/`） | T1 |
| 测试 | `tests/*.test.mjs` 27 个平铺 | `tests/unit/`（17）、`tests/integration/`（11）、`tests/probes/`、`tests/fixtures/`（文件名不变）＋新增 `tests/README.md` 映射 | T1 |
| Rust | `src-tauri/src/` 33 个平铺 `.rs` | `app/`、`store/`、`host/`、`diagnostics/`（35 个 `.rs`，`lib.rs` 46 行只留 `#[path]` 模块清单与 `run()` 装配） | T2 |
| 守卫 | 无 | `scripts/checks/check-structure.mjs`、`check-docs.mjs`；`package.json` 新增 `check:structure`／`check:docs` 并置于 `check` 首位 | T3 |
| 文档 | 无 AGENTS／无工程约定、README 与产品文档状态重复 | `AGENTS.md`、`docs/engineering/`、`docs/README.md`、`docs/reviews/README.md`、README/DESIGN/产品文档同步 | T4 |

目标结构、依赖边界与放置规则见 [工程架构](../engineering/architecture.md)；测试分层与命名见 `tests/README.md`。

### 3.2 不变量（迁移不得改变）

- Rust：模块名、公开路径（`sidekick_lib::mcp_verification`）、`cargo test --lib <filter>` 过滤、52 个 `#[tauri::command]` 命令名与参数、feature 门控、`include_str!` 目标（17 处，`../../migrations/*.sql`）。
- Node：npm 脚本名（除新增两个守卫）、测试文件名、打包产物名（`probe.mjs`／`organizer.mjs`／`skills-manager.mjs`／`mcp-probe.mjs`／`bash-worker.mjs`／`mcp-guardian.mjs`）。
- 配置与数据：`vendor/pi/`、`resources/skills/`、`src-tauri/migrations/`、`Cargo.toml`／`Cargo.lock`、`tauri.conf.json`、identifier、`s0-runtime`、数据库与依赖版本均未改。

### 3.3 目标树（摘要）

```text
AGENTS.md                    # 每轮必读导航
shared/                      # 跨进程纯逻辑（当前 dates.mjs／dates.d.mts）
src/                         # Vue 前端：assets/(brand,fonts) styles/ components/(ui/) domain/ stores/
runtime/                     # entries/(4) lib/(7) workers/(2)
src-tauri/src/               # lib.rs main.rs app/ store/ host/ diagnostics/
tests/                       # unit/(17) integration/(11) probes/ fixtures/ README.md
scripts/                     # build/(2) checks/(2) probes/(2)
design/                      # 原型与品牌板；serve.mjs 只读预览；消费 src/assets、src/styles
vendor/pi/  resources/skills/  # 固定上游与内置技能（只读）
docs/                        # README.md product/ engineering/ reviews/
```

## 4. 验证证据（T5 独立验证）

T5 使用**独立于实现者**的执行路径，报告 `build/struct-review-20261031/post/summary.md`，机器可读结论 `post/summary.json`，**VERDICT: pass**。

### 4.1 门禁命令与退出码

| # | 命令 | 退出码 | 关键输出 | 证据 |
|---|---|---|---|---|
| 1 | `npm run check`（完整，含两包构建） | 0 | 16:07:25→16:10:46，912 行日志，`EXIT_CODE=0` | `post/check.log` |
| 2 | `npm run check:structure`（`--self-test` + 仓库） | 0 | self-test 18 类违规；仓库 143 文件／310 相对引用 | `post/check-structure.log` |
| 3 | `npm run check:docs`（T5 时点） | 0 | 14 文件／160 本地链接 | `post/check-docs.log` |
| 4 | `node --check` 两个守卫 | 0 | — | `post/guard-node-check.txt` |
| 5 | `npm run typecheck`（独立重跑） | 0 | `vue-tsc --noEmit` | `post/rerun-typecheck.log` |
| 6 | `npm run test:s2-domain`（独立重跑） | 0 | 19/19 | `post/rerun-test-s2-domain.log` |
| 7 | `npm run check:rust`（独立重跑） | 0 | `cargo fmt --check` + `clippy -D warnings` | `post/rerun-check-rust.log` |
| 8 | `cargo test --lib -- --test-threads=1`（独立重跑） | 0 | running 128；126 passed／0 failed／2 ignored | `post/rerun-cargo-test-lib.log` |
| 9 | `git status --porcelain`（check 前后） | 0 | 124 行，前后逐字节一致 | `post/git-status-pre.txt`、`git-status-final.txt` |

### 4.2 迁移前后对照

| 指标 | 迁移前 | 迁移后 | 结论 |
|---|---|---|---|
| Node 测试 | 266 pass / 0 fail（20 组） | 266 pass / 0 fail（20 组，逐组计数一致） | 无覆盖降低、无新增失败 |
| Rust 库测试 | 126 passed / 0 failed / 2 ignored | 126 passed / 0 failed / 2 ignored（ignored 同名两项） | 一致 |
| 双特性 guards | 8 passed | 8 passed（128 filtered） | 一致 |
| `ordinaryResourceEntries` | 556 | 556 | 一致 |
| Runtime bundle 次数 | 6 | 6 | 一致 |
| `.app` 构建次数 | 2 | 2 | 一致 |
| 门禁覆盖 | — | 新增 `check:structure`、`check:docs` 各 1 次 | 覆盖增加，无删减 |

> 机器可读对照：`post/baseline-summary.json`、`post/post-summary.json`（同一解析器 `post/parse-check-log.mjs`）。

### 4.3 警告分类（无新增类别）

| 类别 | 迁移前 | 迁移后 | 归因 |
|---|---|---|---|
| esbuild `probe.mjs`／`organizer.mjs` 2.3mb | 12 条（2×6 次 bundle） | 12 条 | Pi 依赖体量，既有 |
| Vite chunk >500 kB | 2 条（单 chunk 661.77 kB） | 2 条 | 既有 |
| 跳过公证（ad-hoc 签名） | 2 条 | 2 条 | 无公证凭据，既有 |
| 其他新警告类别 | — | **0** | — |

### 4.4 静态复核

- 旧路径残留：迁移后的 design 资产、平铺 runtime、旧 scripts、平铺 Rust 模块、`package.json` 旧路径均为 **NONE**；命中项只有守卫 `--self-test` 合成负例（`scripts/checks/check-structure.mjs`）与 `docs/product/05` 中显式历史标注（“当时位于”）。
- 跨层依赖：`src/` 无 `design/`、`runtime/` 相对引用；`src/` 204 条相对引用全部落在 `src/` 或 `shared/` 且存在；`runtime/` 无 `src/`、`design/`；`shared/` 无 import；design 的 20 个唯一相对引用（30 次）全部存在且只指向 `design/`、`src/assets/`、`src/styles/`。
- design 预览：`design/serve.mjs` HTTP 冒烟只暴露允许路径（`/`→302 `/design/`；允许路径 200；`/package.json` 与穿越路径 404；POST 405）。**这是只读服务的范围证据，不是视觉验收。**
- Rust：17 处 `include_str!` 全部 `../../migrations/*.sql` 且存在；handler 注册 52=52；`examples/s33-mcp-host.rs` 仍调用 `sidekick_lib::mcp_verification::run()`；模块过滤器名全部保留。
- git（T5 时点）：HEAD 未变；迁移构成 **86 个 rename**（54 个逐字节相同 + 32 个仅路径型改动）、**28 个原地修改**、**10 个 untracked**（合计 124 条 status；T8 新增本记录后为 11 个 untracked／125 条）；`git diff -M HEAD` 为 114 files changed、+243／−323。生成物卫生：`build/`、`dist/`、`src-tauri/target/`、`node_modules/` 未入库，`.env*` 未入库；`git diff --check` exit 0。

> **记录笔误提醒**：T5 汇总曾把 rename 数写成“87”，其自身证据（`post/git-name-status.txt`）与本节复核均为 **86**；T7 已作为 low 发现指出，更正由 T5 报告方以追加说明处理（见 §5.2 F5）。

### 4.5 代码冻结哈希（供 T9）

T5 时点的冻结清单（现备份为 `t9-fix/code-hashes-before.json`）：schema `sidekick-struct-review-code-hashes/1`，HEAD `808e268…`，范围 `src/ shared/ runtime/ tests/ scripts/ src-tauri/src src-tauri/examples src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json`，**203 个文件**（含 5 个 untracked 非忽略源文件），逐文件 sha256 + 聚合：

```text
307ab3556d4cef89e44735acf9c8aa0969acdb3cda2f40997896578b88480a26
```

以上历史值在 T8 未变；T9 经 owner 授权修复守卫后，`post/code-hashes.json` 已更新，当前聚合与变化范围见 §12。提交前后应比对更新后的清单（`gitStatusEntries` 会随提交变化）。本记录与索引属文档，不在该哈希范围内。

### 4.6 T8 文档收口自验

本记录与索引写入后，在同一工作区（HEAD 仍 `808e268`、未提交）复核：

| 检查 | 结果 |
|---|---|
| `npm run check:docs` | exit 0；**14 文件／162 条本地链接**全部解析（T5 时点为 160，新增本记录与索引条目各 1） |
| `npm run check:structure` | exit 0；self-test 18 类违规可检出；仓库 143 源文件／310 相对引用 |
| 本记录与索引的链接 | 43 条本地相对链接全部存在（含 `../engineering/`、`../product/`、`../../AGENTS.md` 与记录间互链） |
| 代码未变 | 用 `post/gen-code-hashes.mjs` 复算：203 文件／5 untracked，聚合 sha256 仍为 `307ab355…`，逐文件 0 差异 → **T8 只改文档，未动源码、配置或守卫** |
| `git status --porcelain` | 125 条（11 untracked）；本任务新增只有 `docs/reviews/structural-governance-20261031.md`，改动为 `docs/reviews/README.md`、`docs/engineering/architecture.md`、`AGENTS.md`、`README.md` 的文档级修正 |

说明：`check:docs` 不扫描 `docs/reviews/**` 的历史记录，本记录自身的链接用一次性只读脚本单独核对；`check:structure` 的工作集为 tracked + untracked 非忽略文件，新增记录不改变其结构判定。

## 5. 独立评审结论与发现处置

### 5.1 评审 verdict

| 评审 | 范围 | 结论 | 关键判据 |
|---|---|---|---|
| T6 架构评审 | T1／T4：跨层依赖、结构与文档一致性、纯移动性、守卫有效性 | **pass**（无 blocker／high／medium；3 条 low 文档发现） | src 204 条相对引用全落 `src/`／`shared/`；design 30 次引用全存在；`design/serve.mjs` 越权 404；86 rename 中 54 个逐字节相同、32 个仅路径变化；守卫 18 类负例 + 仓库真实运行通过 |
| T7 实现评审 | T2：Rust 归组等价性与证据 | **pass** | `check:rust`／全量 `cargo test --lib`（126／2 ignored）／双特性构建与 Clippy 全 exit 0；52 个命令名 old==new；17 处 `include_str!` 深度正确；模块树 35 个 `.rs` 无孤儿；`cargo test --list` 测试名集合与 baseline diff 为空 |

两份评审均为只读，评审前后 `git status` 哈希一致，未修改工作区，也未重复执行全量 `npm run check`（以 T5 为准）。

### 5.2 发现项与处置

| ID | 来源 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| F1 | T6 | low | [工程架构](../engineering/architecture.md) 称 bare specifier“不在此表内”，但守卫确实禁 `shared/` 的 `vue`／`node:*`／`@tauri-apps/*` 与 `design/` 的 `node:*` | **已关闭**（本轮 T8）：改为“相对引用做层级与存在性检查；bare 通常按依赖别名处理、但 `shared/` 与 `design/` 另有禁用前缀”，与守卫实现一致 |
| F2 | T6 | low | 同一文件称切片名“只”在 npm 脚本名与测试文件名中，与 `scripts/probes/prepare-s33-lifecycle.mjs`、`tests/probes/s33/`、slice 命名的 fixtures 矛盾 | **已关闭**（本轮 T8）：改为“保留在 npm 脚本名、测试文件名、探针脚本与 fixtures 中”，并补三个真实例子 |
| F3 | T6 | low | `AGENTS.md` 与 `README.md` 把 `shared/` 描述为“日期、契约”，实际只有日期／时间锚点（契约在 `runtime/lib/`） | **已关闭**（本轮 T8）：两处均改为“当前为日期与时间锚点”；同时修正 [工程架构](../engineering/architecture.md) 放置表中同一措辞 |
| F4 | T7 | low | T2 报告／验收把 `lib.rs` 写成“13 条 `#[path]`／mod 声明”（实际 11 `#[path]` + 12 `mod`）、`local_store.rs` 写成“12 条子模块 `#[path]`”（实际 17 = 11 特性 + 6 `cfg(test)`） | **未关闭（非仓库文档）**：属 T2 任务报告笔误，需 T2 责任方以 append-only `evidence_note` 更正；本记录采用实测值，不改写 T2 结论（等价性结论不受影响） |
| F5 | T7 | low | T5 汇总写“87 条 rename”，其自身 `git-name-status` 证据为 86（86 rename + 28 modified = 114 files） | **未关闭（非仓库文档）**：属 T5 报告笔误，需 T5 责任方追加更正说明；本记录 §4.4 采用复核值 86，并在旁注明差异 |

> 处置原则：仓库文档级问题在本任务关闭（F1–F3）；任务报告／证据目录里的笔误不由 T8 改写，只如实记录并指派更正（F4／F5）。T6／T7 均未提出 blocker、high 或 medium 级发现，不构成对迁移结论的削弱。

### 5.3 实现前两份独立评审摘要

实现前按 plan 要求做过两次独立评审（架构迁移面、验证治理面），结论均为 **APPROVE_WITH_CHANGES**，v2 计划吸收了其必修项，落地方式如下：

- **Rust 迁移风险**：改为 `#[path]` 模块清单，保持模块名、公开路径、测试过滤与 example 不变，把 crate:: 路径改动降到 0（T7 已逐项复核）。
- **`include_str!` 深度**：迁移时统一修正为 `../../migrations/…`（17 处），并在验证中逐条解析存在性。
- **测试迁移风险**：只做分层归组、**不改文件名**，并新增 `tests/README.md` 映射与命名约定，避免打断历史证据。
- **设计预览**：把 `python3 -m http.server --directory design` 换成窄范围只读服务 `design/serve.mjs`（只暴露 `/design/`、`/src/assets/`、`/src/styles/`），并在 T5 做越权与穿越负例冒烟。
- **守卫有效性**：`check:structure` 必须带 `--self-test` 负例（18 类），并检查打包入口与资产引用存在性，而不只做字符串扫描。
- **文档单一状态源**：README 不再维护第二份状态清单，实施状态统一指向 [实施计划](../product/05-第一阶段实施计划.md)（as-of `808e268`）；评审记录建立索引与留存策略。

## 6. 未验证项

以下项目**没有**在本轮验证，不能写成通过：

| 未验证项 | 原因 |
|---|---|
| 原生 GUI（窗口／托盘／快捷键／点击穿透／通知／Finder 行为） | 未启动 `Sidekick.app`；T5 只做编译期注册与库测试 |
| 设计视觉（Playwright） | `playwright` 未安装、`PLAYWRIGHT_MODULE` 未设置；只做静态引用解析与 HTTP 冒烟 |
| `run_s0_probes` 实际执行 | 需原生 GUI 与打包资源；只验证了注册 52/52 与编译 |
| clean clone 复现 | 迁移未提交，无法干净克隆 + `npm ci` + `npm run check`；`node_modules` 为既有安装 |
| CI | 仓库无 CI 配置，门禁仅本机执行 |
| 真实模型／飞书／MCP 业务调用 | `test:*:live` 为显式可选命令，不属于 `npm run check`（2 个 ignored 用例仍为未验证） |
| 公证／分发 | 无 APPLE_ID／APPLE_API_KEY，两个 `.app` 仅 ad-hoc 签名并跳过公证 |
| 其他平台／架构 | 仅 macOS arm64；未验证 Intel macOS／Windows／Linux |

## 7. 残余风险

1. **T8 时点迁移整体未提交**：单个大工作区变更（86 rename + 28 modified + untracked）。提交时必须包含全部 untracked（见第 10 节），否则守卫脚本或 Rust 模块缺失；提交后必须复跑 `npm run check`。
2. **守卫规则依赖当前路径清单**：`check:structure` 为新增规则，只由 18 类 self-test 与本次真实运行验证；后续新增顶层目录或跨层引用会被拦截，但规则必须随结构演进同步维护（改结构必须同时改守卫与 [工程架构](../engineering/architecture.md)）。
3. **既有体积警告未消除**：`probe.mjs`／`organizer.mjs` 2.3mb、Vite 单 chunk 661.77 kB 与 baseline 相同，非本次回归，但仍是体量债。
4. **分发限制**：ad-hoc 签名 + 跳过公证，属 S5／G5 议题。
5. **覆盖边界**：GUI 行为与设计视觉未覆盖；回归只覆盖域／集成／探针／构建门禁与结构／文档守卫。
6. **两个真实模型用例仍 ignored**：`s2_live…`、`s31_live…` 需显式授权与 owner 配置。
7. **文档与守卫的语义边界**：`check:docs` 只校验本地相对链接存在，不校验语义；`check:structure` 只覆盖相对引用（根绝对导入不查），`.vue` 模板资产属性与 reference-style 链接不在解析范围（项目文档中为 0 处；`vendor/` 上游文档不在扫描范围）。这些是声明的覆盖边界，不是“已验证”。
8. **两份任务报告的笔误待更正（F4／F5）**：T2 报告的数字与 T5 汇总的 rename 数各有 1 处 low 笔误，已在 §5.2 记录并指派 owner 追加更正；它们只影响报告文字，不影响本记录采用的实测值、T6／T7 verdict 与代码等价性结论。

## 8. 后续与落点

- **S4（三窗、托盘、快捷键、提醒调度）**：Rust 侧落 `app/`（窗口／托盘／快捷键注册与事件）、`store/`（提醒数据）、`host/`（外部投递）；前端落 `src/` 组件与 stores。三窗共享权威状态，前端只持界面状态。
- **S5（安装、迁移、备份恢复、工作根切换）**：`store/`（迁移／备份／恢复）、`app/commands.rs`（IPC）、`scripts/build/`（打包与资源）。**identifier `com.sidekick.s0` 与资源目录 `s0-runtime` 的改名是 S5／G4 的显式迁移议题**，本轮未动，不得顺手修改。
- **G2（飞书资料与进展闭环）**：`runtime/lib/`（来源读取与契约）、`runtime/entries/`（任务入口）、`host/`（受控进程与来源连接）、`src/stores/`。
- **G3（提醒与复盘闭环）**：`host/`（调度与投递）、`store/`（日报与提醒数据）、`src/components/`（桌宠／日报呈现）。
- **工程侧待办**：①CI 平台与凭据决策（当前无 CI，是本轮明确开放项）；②IPC 字符串契约类型化（52 个 handler 的命令名／参数在两端重复，新增命令须两端同步并加测试）；③npm 脚本与测试文件的切片命名保持稳定、不趁机重命名，新脚本／测试用领域名；④`domain/` 与 Vue 的边界（允许响应式原语、禁 stores／组件／IPC，如需框架无关领域层则单列迁移）。

以上落点与待办与 [工程架构](../engineering/architecture.md) 的“已知债与暂缓决定”一致；新增一级目录或边界规则时，必须同时更新该文件与守卫。

## 9. 历史路径与检查例外

### 9.1 历史记录不改写

- 迁移把源码从平铺改为分组，但**历史评审记录、产品文档中的历史检查点保留当时路径与哈希**；复核当时内容用 `git show <commit>:<path>`，不按当前工作区重算哈希。
- 唯一在原文内做路径标注的是 [实施计划](../product/05-第一阶段实施计划.md) 的结构治理说明块与 §16.7 的“当时位于 `tests/s33-lifecycle.test.mjs`”，属显式历史标注。
- 解析器/静态检索仍会在 `scripts/checks/check-structure.mjs` 的 `--self-test` 合成负例里看到旧路径字符串，并在 `docs/product/05` 看到上述历史标注；**这些是负例与历史说明，不是功能性残留**。

### 9.2 design 品牌板链接的例外（`../brand` 无尾斜杠）

- `design/prototype/index.html` 的“查看品牌板”链接写作 `href="../brand"`（无尾斜杠），浏览器与静态预览服务都给 302→`/design/brand/`。因此静态代理判据 `rg '\.\./brand/' design` = **0** 成立，但这**不代表**品牌板导航被删除。
- `design/brand/` 仍是设计品牌板目录（`index.html`、`brand.css`），只是 tokens／fonts／SVG 等生产资产已移到 `src/styles/`、`src/assets/`；对它的引用属于设计目录内部导航，不是生产前端对设计稿的跨层依赖。
- 处理原则：**不为通过检查而篡改页面**。检查脚本按“生产前端不得引用 design”判定，品牌板内部链接不受影响；若未来要统一尾斜杠，应作为设计页面的独立小改动，而不是为了让代理判据归零。

## 10. 提交约束

- T8 时点**全部改动未提交**（HEAD 仍 `808e268`，未 push）；提交与推送需 owner 明确授权。T9 已获 owner 授权在全部复核通过后提交，本次不推送。
- 提交必须使用 `git add -A`（或等价地包含全部 untracked），至少包含：`scripts/checks/`、`src-tauri/src/app/mod.rs`、`src-tauri/src/diagnostics/s0_probe.rs`、`tests/README.md`、`AGENTS.md`、`docs/engineering/`、`docs/README.md`、`docs/reviews/README.md`、本记录、`design/serve.mjs`、`design/index.html`。**漏掉守卫脚本或 Rust 模块会导致构建／门禁直接失败。**
- 提交后必须复跑 `npm run check`（含 `check:structure`、`check:docs`）与静态复核，并按 `post/code-hashes.json` 复算冻结哈希；T9 收口时确认代码未再变动。
- 原始证据（`build/struct-review-20261031/`）按 [评审记录索引](README.md) 的留存策略**不随仓库提交**；本记录只固化结论与可复核路径说明。

## 11. 证据索引

| 证据 | 位置（`build/` 为 gitignored） | 用途 |
|---|---|---|
| 计划 v2 | `build/struct-review-20261031/plan.md` | 范围、批次、验收与准出 |
| 迁移前完整门禁日志 | `build/struct-review-20261031/check.log` | baseline 计数（`post/parse-check-log.mjs` 解析） |
| T5 报告 | `build/struct-review-20261031/post/summary.md` | 命令、退出码、对照、警告分类、未验证项、残余风险 |
| T5 机器可读结论 | `build/struct-review-20261031/post/summary.json`、`baseline-summary.json`、`post-summary.json` | verdict／gates／counts |
| 迁移后完整门禁日志 | `build/struct-review-20261031/post/check.log` | 912 行，`EXIT_CODE=0` |
| 守卫单独运行 | `post/check-structure.log`、`post/check-docs.log`、`post/guard-node-check.txt` | 结构／文档守卫与语法检查 |
| 独立重跑 | `post/rerun-typecheck.log`、`post/rerun-test-s2-domain.log`、`post/rerun-check-rust.log`、`post/rerun-cargo-test-lib.log`、`post/independent-reruns-summary.txt` | T5 独立复核实现门禁 |
| 静态复核 | `post/static-*.txt`、`post/design-refs-scan.txt`、`post/include-str-check.txt`、`post/handler-count.txt`、`post/public-path-and-filters.txt`、`post/design-serve-http-smoke.txt`、`post/design-serve-review.txt` | 旧路径残留、跨层依赖、Rust 等价性、预览范围 |
| git 与语义抽查 | `post/git-status-*.txt`、`post/git-diff-stat-*.txt`、`post/git-name-status.txt`、`post/semantic-*.txt`、`post/git-*-hygiene.txt` | 工作区构成、纯移动性、生成物卫生 |
| 代码冻结 | `post/code-hashes.json`、`post/gen-code-hashes.mjs` | T9 复算比对 |
| 环境 | `post/environment.txt` | 工具链与前置条件 |

T6／T7 的完整报告保存在团队任务列表与协调记录中（非仓库文件）；本记录引用其 verdict 与 findings，结论以本记录第 5 节与上表证据为准。

## 12. T9 守卫修复与重新冻结（owner 授权）

本节追加 T9 复核发现与修复，不改写 T5–T8 的历史执行结果。首轮 T9 因守卫漏检与本文 F2／F5 引用错误停止，完整门禁被主动中止（`t9/check-pre.log`，SIGTERM，exit -15），不计为通过，也未提交。F4／F5 的原任务报告笔误仍按 §5.2 保持开放。

### 12.1 独立负例与修复范围

- 独立复现命令：`python3 build/struct-review-20261031/t9-fix/reproduce-relative-urls.py <结果 JSON> [守卫副本]`。每个样本在独立临时 Git 树执行真实 CLI，不复用内置自测的违规汇总。修复前副本的正确夹具结果为 **4 pass／8 fail，exit 1**；8 个缺失资源或跨层 URL 均被错误放行。修复后同一命令为 **12 pass／0 fail，exit 0**（8 个负例各自 exit 1，4 个合法对照各自 exit 0）。证据为 `t9-fix/reproduction-red-corrected.json`、`reproduction-green.json`。
- 根因：HTML／CSS URL 共用 JS 模块导入的相对路径判定，裸相对 URL 被跳过。修复仅让 HTML／CSS 资源引用进入原有存在性与层级检查；生产 CSS 中已声明依赖的直接 `@import`（当前为 `tailwindcss`）保留包导入语义，JS bare import、外部 URL、锚点及既有绝对路径覆盖边界不变。
- 自测新增 **8 个按规则＋文件＋行号逐项断言**，覆盖 HTML `src`／`href`、CSS `@import`／`url()`、跨层 URL 及与依赖同名的资源路径，防止同类违规互相遮蔽；合法本地资源、生产 CSS 包导入、JS bare import 作为对照。原有 18 类违规自测保留。补断言而未改实现时 exit 1（`t9-fix/self-test-red.log`）。
- 本次只改 `scripts/checks/check-structure.mjs` 与本文：前者为守卫及内置自测，后者修正 §4.4 的 F2→F5 引用并追加证据／冻结说明。没有修改生产业务逻辑、schema、命令名、依赖、标识或 §6 未验证范围；原结构迁移仍按第 3 节复核。
- 聚焦命令 `npm run check:structure`、`npm run check:docs`、两个守卫的 `node --check` 均 exit 0。结构检查仍扫描 **143 文件**，相对引用由 **310→318**（新纳入 8 次裸相对资源引用）；自测为 **18 类＋8 项独立引用断言**。文档守卫仍为 **14 文件／162 本地链接**。原始证据在 `t9-fix/focused-results.json`；完整重新复核结果另留 `t9-fix/`。

### 12.2 更新后的代码冻结

`post/code-hashes.json` 仍覆盖 **203 个文件**，相对 T5 清单仅 `scripts/checks/check-structure.mjs` 的逐文件哈希变化，其余 **202 个文件逐字节不变**。旧清单保留在 `t9-fix/code-hashes-before.json`，差异摘要为 `t9-fix/hash-change.json`；本记录不在代码冻结范围内。更新后聚合 sha256：

```text
3b6bf9631a2eef26abd0284707085e19cabe22fbde354400eaf43126ccf63fdf
```

提交前完整复核结果见下节；提交后仍须重跑完整 `npm run check`、逐文件与聚合哈希比对。第 6、7 节未验证项与未受本次修复影响的残余风险继续保持开放。

### 12.3 T9 提交前独立复核

独立验证与结构评审均为 **pass**。基点仍为 `808e268b1ca0be034892c2abd1c185d53596c0ee`；实现者未签署自己的验证结论。证据分别为 `t9-fix/verify-pre/summary.json`、`check.log`、`extra-check-results.json` 与 `t9-fix/structure-review/report.md`、`summary.json`。

| 命令／核对 | 退出码 | 本轮实际结果 |
|---|---|---|
| `npm run check`（完整） | 0 | 198.312 秒；Node 20 组 **266 pass／0 fail**；Rust **126 passed／2 ignored／0 failed**；双特性 verification **8 passed**；Runtime bundle **6** 次、`.app` **2** 个；`ordinaryResourceEntries=556` |
| `npm run check:structure`（独立重跑） | 0 | 18 类＋8 项引用负例；143 文件／318 相对引用 |
| `npm run check:docs`（独立重跑） | 0 | 14 文件／162 本地链接 |
| `node --check scripts/checks/check-structure.mjs` | 0 | 语法通过 |
| `node --check scripts/checks/check-docs.mjs` | 0 | 语法通过 |
| 工作区、冻结与受保护路径 | 0 | HEAD／status 前后一致；203 文件逐项及聚合匹配；仅守卫较 T5 变化；受保护路径为空；`git diff --check` 无输出 |

- 警告与 baseline 同类同数：esbuild **12 条**（probe／organizer 2.3mb，2×6 次）、Vite chunk >500 kB **2 条**、公证跳过 **2 条**；新增类别 **0**。
- 工作区仍为默认 status **125 项**（86 rename＋28 modified＋11 untracked）；11 条 untracked 含两个目录，展开后为 **13 个文件／127 项**，均为 §10 指定范围。已跟踪 diff 仍为 **114 文件、+243／−323**。首次验证包装器误用 `-uall` 对比 125 而在启动门禁前 exit 1，已按正确命令核实口径并记录 `verify-pre/preflight-uall-mismatch.json`，未改工作区。
- 结构面独立核对非 Rust 的 **71／71 个变更文件**为授权移动／路径变换，28 个移动测试保留文件名；package 非 scripts 字段及既有脚本名不变，受保护目录、schema 与标识无变化。独立扫描为 **143 文件／317 条引用**（CSS `@import url()` 只计一次；守卫的318次解析保留既有双计口径），跨层／缺失目标 **0**；品牌板 `../brand` 导航保留。
- 隔离守卫复现 **12／12**、窄预览服务无网络路径用例 **21／21** 通过；后者仅为合成路径检查，不升级为 HTTP、原生 GUI 或设计视觉验收。记录索引仍为 **22 份**，本文及索引 **43 条本地链接**全部存在，证据路径可解析；F4／F5 原任务报告更正仍保持开放。
- 本节为提交前快照；提交与提交后完整门禁的实际结果另留 `t9-fix/` 证据及任务收口报告，不在提交前预填。第 6 节全部未验证项保持不变。
