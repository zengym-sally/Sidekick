# W1 文本整理 III：工程接入/守卫/构建/公共记录准备（2026-11-08）

> MAYNE-24 派发线程 `01a1bb65-c871-7719-8329-1e4a37fcf2e9` 分工 III（OpenCode 执行，与候选 I/II 并行；本轮不开始最终集成）。授权依据：owner 评论 `01a1bb58-0b0c-7010-80f0-0664dbcd107a`（member Mayne，2026-11-08「批准」，批准 A–C）＋审批包 SHA-256 `d8fc4f3f…37e74c` ＋ [文本整理授权清单](web-text-intake-authorization-20261108.md)。风险级：中（守卫冻结与共享构建文件变更，但有精确批准哈希与原地自测兜底）。

## 1. 范围与写入边界

唯一写入（与 `build/web-text-intake-engineering/admission.json` 登记一致，该登记在首次修改前完成）：`scripts/build/build-backend.mjs`、`scripts/checks/check-structure.mjs`、`package.json`、`docs/engineering/web-text-intake-contract.md`（原样接收＋仅元数据实施登记）、`docs/engineering/architecture.md`、`docs/engineering/web-backend-design.md`、`docs/engineering/verification.md`、`docs/product/05-第一阶段实施计划.md`、`docs/README.md`、`docs/reviews/README.md`、五份已审记录＋授权清单原样接收、本记录。原始证据在 `build/web-text-intake-engineering/`（gitignored，含 `admission.json`、`received/SHA256SUMS.txt`、前置/正负例日志与哈希清单）。

未触碰：候选 I 的 server/、003 迁移文件本身、Rust store/schema、Cargo.toml、前端文件；候选 II 的四套 integration 套件与夹具；共享 main；vendor/pi、resources/skills 只读消费；锁文件与生产依赖（npm ci／probe:prepare-cli／probe:prepare-pi 均为已锁依赖的仓库既有命令，未新增任何依赖）。AGENTS.md 的平台运行时漂移留在工作区，不入候选。

## 2. 基点与接收哈希

- 工作树：Multica 隔离 worktree，分支 `agent/opencode/mayne-24`，起点 `a7d2a888a73da23941c4ce235b961ebf883b5fad`（父即基点 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`）。
- 基点核对：`git rev-parse a7d2a88^{tree}`＝`77a548591ac9b02a51936c806bf4f85d774df7cb`＝`1e37044^{tree}`；`git diff --stat 1e37044 a7d2a88` 为空（起点与工单登记 main 基点逐字节一致且为其子代）。
- 接收（`git show <commit>:<path>` 提取，禁止整树合并旧分支；来源分支不以 main 为祖先）：

| 输入 | 来源提交 | SHA-256 | 核对 |
|---|---|---|---|
| [文本整理契约](../engineering/web-text-intake-contract.md)（接收态） | `b190f7c6642625c800396fc04d50009769348c83` | `5982c06220b382182ee8ff82715ca0e794b4cd51988426d7d9b37da406cfe7b0` | ＝登记冻结值 |
| [授权清单](web-text-intake-authorization-20261108.md) | `b190f7c`（同上） | `caa746bbff01ce158e04bc3330489607c8683567b5682e8ca7351b6fa6ac6b20` | ＝登记冻结值 |
| [P2 就绪报告](web-text-intake-readiness-20261108.md) | `43433ae5b1093afa4024ba1bde4f6d12abae5c95` | `2d6474171802f16686d6cc4ad4613f028a48e0a253a4e7797cdb7c81125d17bc` | ＝登记冻结值 |
| [P2 OhMyPi 核验](web-text-intake-readiness-20261108-ohmypi-review.md) | `27728f50b30ee39d77716c131192b70b1957b620` | `d92888572c96d475199b91dbf248426d8a400dd54a8da6a3656db2f8a021e82f` | 原样接收（该记录此前无登记哈希，以提交身份为据） |
| [P1 ZCode R3 复审](web-text-intake-contract-20261108-zcode-r3-review.md) | `47d5efaa24357072d74326cb28ead0fb2eb14818` | `2f0792090cb0aecf3dab9d5a78a57241a48f595091ddc45df55bddb2b1f0fd62` | 原样接收（裁定轮） |
| [P1 ZCode R2 复审](web-text-intake-contract-20261108-zcode-r2-review.md) | `89df585a6cee66e9de4c4f7bd13abf76e7d6381d` | `959e78fd56614b0da312d048b1128308b84b78d87b98926956a3a115969868f3` | 原样接收（历史，被 R3 取代） |
| [P1 ZCode 首轮评审](web-text-intake-contract-20261108-zcode-review.md) | `c7e962a5929b74e4e81fe882ab58324f5ee4ab23` | `a1eecd66e5f9747feb89251776e37bad86108747e7ede4bc479f43e6f9a4c6f7` | 原样接收（历史，被 R2/R3 取代） |

契约本轮唯一内容改动为：页首追加一段「实施登记」blockquote（owner 批准事实、审批包哈希、接收版本/SHA、正文准备状态表述的效力说明）；业务规范、DDL 围栏与其余全部字节未动（接收态与登记冻结 SHA 一致，正文以 `git diff` 复核仅新增该段）。授权清单原样接收，未加状态行——批准事实按工单登记在 MAYNE-24 描述与 [实施计划](../product/05-第一阶段实施计划.md) 顶部，不在授权原文上追加。

## 3. 实施内容

1. **结构守卫**（`check-structure.mjs`，批准 C 项）：`IMMUTABLE_MIGRATIONS` 追加 `003_text_intake.sql` 精确哈希 `8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870`（既有冻结值逐字节未动，无任何规则放宽）；自测扩展 003 三态断言（缺失→拒绝、篡改→拒绝、原样存在→通过；正例在候选 I 落地后自动激活），沿用 002 的登记模式。
2. **构建接入**（`build-backend.mjs`，批准 C 项）：bundle 新增 `runtime/`＝真实 `build/s0-runtime` 整体装载（`npm run probe:bundle` 产物，来自固定 `vendor/pi` 源：organizer.mjs、随包 Node、workers、builtin-skills、licenses、source.json）；昂贵构建前先做前置存在性检查（organizer.mjs/node/source.json 任一缺失即以命名前置命令显式失败）；装载后对 `runtime/node`、`runtime/lark-cli` 恢复 0o755 可执行位；汇总日志带 runtime 闭包与随包 Node 字节数。server 不 import runtime/vendor 的层界规则不变（守卫与打包脚本双重强制保留）。
3. **package.json**（批准 C 项）：新增 `test:web-text-intake`（`tests/unit/web-text-intake.test.mjs`＋`tests/integration/web-text-intake-{http,queue,controlled-model,static}.test.mjs`，预算 20000ms 沿用 W1 五文件组口径）；`check` 链尾接入 `npm run build:backend && npm run test:web-manual-items && npm run test:web-text-intake`（同一稳定版不重复整套跑）。既有脚本名、组、预算、依赖与锁文件未动；`check:structure` 先于 `check:docs` 的顺序守卫保持成立。
4. **公共文档**：architecture.md（状态段、迁移冻结段补 003、放置表打包行补 runtime/）；web-backend-design.md（补 MAYNE-24 状态行）；verification.md（Web/后端证据边界补新聚合门禁、runtime 构建前置与 003 冻结语义）；product/05（顶部 as-of 补 MAYNE-24 准入、总览补三候选段、W1 队列行补文本整理现状并把 MAYNE-23 docs 收口表述校准为已落 main）；docs/README.md 地图补契约条目；docs/reviews/README.md 索引 119→126 份（七条新登记）。

## 4. 实际命令与结果

（完整日志在 `build/web-text-intake-engineering/`：`npm-ci.log`、`prepare-cli.log`、`prepare-pi.log`、`probe-bundle.log`、`builder-negative.log`、`build-backend-positive.log`、`received/SHA256SUMS.txt`、`bundle-hashes.txt`、`bundle-manifest.json`）

| 命令 | 结果 |
|---|---|
| `node --check scripts/build/build-backend.mjs && node --check scripts/checks/check-structure.mjs`；`package.json` JSON 解析 | 全部 exit 0 |
| `npm ci --ignore-scripts` / `npm run probe:prepare-cli` / `npm run probe:prepare-pi` | 全部 exit 0；Pi provenance tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`（与 W1 登记一致） |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0：26 类违规检出、clean 正例不误报、001 原样通过/篡改拒绝、002 缺失/篡改拒绝、003 缺失/篡改拒绝（正例待候选 I 自动激活） |
| `node scripts/checks/check-structure.mjs`（仓库模式，前置未跑时） | exit 1 恰 4 条：**新增仅 1 条** `schema.immutable-migration 003_text_intake.sql`（候选 I 未落地的预期 pending 违规）；其余 3 条 `ref.missing`（vendor/pi dist）为基线既有，前置跑完后消失（见下行） |
| `npm run probe:bundle` 后复跑仓库模式守卫 | exit 1 恰 1 条：仅剩 003 预期 pending 违规 |
| `mv build/s0-runtime … && node scripts/build/build-backend.mjs`（负例） | exit 1：在昂贵构建开始前快速失败，错误信息点名 `npm run probe:prepare-cli && npm run probe:prepare-pi && npm run probe:bundle` |
| `npm run build:backend`（正例，真实前置） | exit 0：server 8 文件＋shared 1＋static 4（dist）＋bin（存储二进制 2633392B，SHA-256 `b7dd9339…422` 与 W1 登记逐字节一致）＋**runtime/ 479 文件，`diff -rq` 与 `build/s0-runtime` 逐字节一致**，`runtime/node`/`lark-cli`/`bin/web-backend-storage` 均 0755，runtime `source.json` tree `e89822b0` |
| 接收哈希复算（`shasum -a 256`，7 份） | 全部与声明/登记一致（见 §2） |

## 5. 未验项与前置缺口（如实分列）

- **候选 I 前置缺口**：`003_text_intake.sql` 属候选 I 写入范围，本树不存在——仓库模式守卫据此保留 1 条预期 pending 违规；这是设计行为，不是环境失败。
- **候选 I/II 前置缺口**：`test:web-text-intake` 的五个测试文件属候选 I/II，脚本接线已就位但用例不存在；在本树运行该脚本会在文件加载处如实失败。本轮不执行、不造占位、不代签。
- **未跑**：完整 `npm run check`（唯一集成执行者在候选齐备版本串行执行）、任何 cargo 测试（本轮仅 `build:backend` 所需的单 bin release 构建）、`test:web-text-intake`/`test:web-manual-items` 套件执行、真实 HTTP/SSE/浏览器路径、entry `--runtime-root` 解析（属候选 I 的 entry 交付，bundle 布局已就位待其接线）。
- **环境边界**：本轮真实打包在 macOS arm64 本树完成；Linux/代理/真实凭据/真实工作根/真实模型边界不变。推送、部署、状态变更未授权未做（MAYNE-24 保持 in_progress）。

## 6. 结论

**独立工程候选交付（engineering candidate）**：III 写入范围内全部落地；真实 builder 正/负例、守卫自测、docs、接收哈希全部通过；仓库模式守卫仅剩 003 一条预期违规（候选 I 前置）。跨项接口清单（对接 §1–§5 已按工单落地）：`startWebBackend(config)`／`--runtime-root`／CredentialProvider 注入等签名归候选 I 的 entry；`runtimeRoot` 打包缺省指向 bundle `runtime/` 的布局已由本候选真实产出。工程候选的独立审查建议由当时未参与 III 的 Kimi 或 ZCode 承担（队长另派留痕，作者不自签）；完整重门禁与 main 收口待队长明确派发后由 III 作为唯一集成执行者串行执行。
