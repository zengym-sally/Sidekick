# W1 手工事项 III：工程接入/守卫/构建/公共记录准备（2026-11-08）

> MAYNE-23 派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 分工 III（OpenCode 执行，与候选 I/II 并行；本轮不开始最终集成）。授权依据：owner 评论 `01a1b80b-f132-716c-bebb-28f260f0c73d`（2026-11-07T22:05:52Z「批准 W1 A–D」）＋ [授权清单 §12](web-manual-items-authorization-20261108.md)。风险级：中（结构性守卫与共享文件变更，但有精确批准范围与原地自测兜底）。

## 1. 范围与写入边界

唯一写入（与派发登记一致）：`scripts/build/build-backend.mjs`（新增）、`scripts/checks/check-structure.mjs`、`package.json`、`docs/engineering/architecture.md`、`docs/engineering/web-backend-design.md`、`docs/engineering/web-manual-items-contract.md`（原样接收）、`docs/product/05-第一阶段实施计划.md`、`docs/README.md`、`docs/reviews/README.md`、`docs/reviews/web-manual-items-authorization-20261108.md`（接收＋状态文字）、四份已审记录原样接收、本记录。原始证据在 `build/web-manual-items-engineering/`（gitignored，含 `admission.json`、接收文件哈希、基线守卫副本、合成打包用例与本日志）。

未触碰：候选 I 的 server/、002 迁移文件、Rust 存储/bin 源、Cargo.toml、前端接线文件；候选 II 的三个 integration 套件与夹具目录；共享 main；vendor/pi、resources/skills；锁文件与生产依赖。

## 2. 基点与接收哈希

- 工作树：Multica 隔离 worktree，分支 `agent/opencode/mayne-23`，起点 `ab696b8d5ad7ca3a3e15b1c8025e3697210036d0`（tree `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`）。
- 基点核对：`git cat-file -t 6546990`→commit；`git rev-parse 6546990^{tree}`＝`7b71cdb3…`；`git merge-base --is-ancestor 6546990 HEAD` 成立；`git diff --stat 6546990 HEAD` 为空（起点与实际集成基座 `6546990` 内容逐字节一致，且为其后代）。
- 接收（`git show <commit>:<path>` 提取，禁止整树合并旧分支）：

| 输入 | 来源提交 | SHA-256 | 核对 |
|---|---|---|---|
| [手工事项契约](../engineering/web-manual-items-contract.md) | `19045b8` | `8d7529531e7e5c53a3d195fa20f376a2b72d400e0ce8114b8c8ccc3b17b70e8d` | ＝登记冻结值 |
| [授权清单](web-manual-items-authorization-20261108.md)（接收版） | `19045b8` | `452dc4366b3d56f269f6864d372d5942727e4f48ad1e371edeb97628a19e8c0f` | ＝登记冻结值 |
| 002 DDL（授权 §5.1 原样 SQL 块） | 同上提取 | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` | ＝批准哈希 |
| [P2 就绪报告](web-manual-items-readiness-20261108.md) | `d94de69` | `900d28c11281863ada072a9f7da19659bcc62ed9e37548a44ac300ad77ff5778` | ＝OhMyPi 复核值 |
| [P2 OhMyPi 审阅](web-manual-items-readiness-20261108-ohmypi-review.md) | `f031e21` | `7d340c700e908c519ecb23aa207a4793c6e8d509ad7d66fec8ed619f5c7faa21` | 原样接收（该记录此前无登记哈希） |
| [P1 ZCode 首轮评审](web-manual-items-contract-20261108-zcode-review.md) | `2706044` | `e67fff2b3ad6af2cac711fdc41ab49afe61b2d4fa60adff34c5d9ae04a88d17e` | ＝R1 评论声明值 |
| [P1 ZCode R2 复审](web-manual-items-contract-20261108-zcode-r2-review.md) | `c0f88f6` | `5e72c5b7e2dfb0375b95b87e0d4c32805a1acf581977493bbac2202bd1dd2a8f` | 原样接收（该记录此前无登记哈希） |

授权清单经 §12 状态登记后提交版 SHA-256 为 `242ea3db295bcbaa57e9d12dae06c6b27fd0fbee68243f709383b699f048f304`（接收版 `452dc436…` 哈希即上表，两版差异仅 §1 所述状态文字与 §12 追加）。

基线冻结复验：`001_web_backend.sql`＝`8511907c…143d`、`web-api-contract.md`＝`61863271…f58d`，与登记一致。授权清单本轮唯一内容改动为：页首状态行改「已批准、实施中」、§11 状态行同步、文末追加 §12 实施准入登记（A–D 批准事实＋三项并行分工）；§3/§10 申请原文、§5.1 DDL 块（含其 PROPOSAL-ONLY 注释行）逐字节未动。

## 3. 实施内容

1. **结构守卫**（`check-structure.mjs`，按批准 A/B 项与守卫集合 §4.6）：`TOP_LEVEL_DIRS` 增加 `server`；`SRC_TAURI_TOP_DIRS` 增加 `bin`；新增收敛规则 `layout.server-top`（server/ 只允许 `entries/`/`lib/`）与 `layout.src-tauri-bin`（bin/ 只允许 `web-backend-storage.rs`）；引用层新增 `layer.server`（server/ 相对引用仅 `server/`＋`shared/`）与裸限定 `layer.server-bare`（server/ bare 仅 `node:*`，零 npm 依赖）；`server/` 纳入引用扫描 `SCAN_TOPS`；`IMMUTABLE_MIGRATIONS` 追加 002 精确哈希 `b6cb8e61…f97e`（旧冻结值逐字节未动，不建仓库根级 bin/，不扩为任意目录）。自测扩展：新增 4 类违规样本＋clean 正例（`server/lib/clean.mjs`、`src-tauri/src/bin/web-backend-storage.rs`）＋002 三态断言（缺失→拒绝、篡改→拒绝、原样存在→通过；正例在候选 I 落地后自动激活）。
2. **构建接入**（`build-backend.mjs`，批准 D 项）：输出统一 `build/web-backend/`＝`server/`（保持相对布局）＋实际引用的 `shared/` 闭包＋`bin/web-backend-storage`（cargo release）＋`static/`（前端 dist）；打包前独立复验 server 依赖规则（相对仅 server/+shared/、bare 仅 Node 内置、shared 不得 bare、不得逃逸），缺 server 入口时以「候选 I 前置缺失」显式失败，不造占位。
3. **package.json**（批准 D 项）：新增 `build:backend`、`start:backend`（打包后入口）、`test:web-manual-items`（unit＋HTTP/restart/static，预算 20000ms 按最终清单）；`check` 链尾部接入 `npm run build:backend && npm run test:web-manual-items`（真实构建前置＋新 Web 组）。既有脚本名、预算、依赖与锁文件未动。
4. **公共文档**：architecture.md 同步（结构树、依赖边界表 server 行、收敛与迁移冻结、模块职责、放置表）；web-backend-design.md 增 2026-11-08 状态行；product/05 总览改 2026-11-08（W0 关闭/W1 A–D 批准/三候选并行/待办链）、W0/W1 队列行更新；docs/README.md 地图补两份契约；docs/reviews/README.md 索引 85→91 份。

## 4. 实际命令与结果

（完整日志 `build/web-manual-items-engineering/verification-log.txt`）

| 命令 | 结果 |
|---|---|
| `node --check scripts/checks/check-structure.mjs && node --check scripts/build/build-backend.mjs` | exit 0 |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0：26 类违规全部检出、8 处独立引用断言命中、clean 正例不误报、001 原样通过/篡改拒绝、002 缺失/篡改拒绝 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | exit 1：恰 4 条——**新增仅 1 条** `schema.immutable-migration 002_manual_items.sql`（候选 I 未落地，预期待集成违规）；其余 3 条 `ref.missing`（vendor/pi dist 未本地准备）为**基线既有**，用基点守卫副本 `ab696b8` 原样复现对照确认 |
| `node build/web-manual-items-engineering/fixtures/run-synthetic.mjs`（真实 builder＋npm/cargo 桩） | 7/7 通过：完整装配（server+shared 闭包+二进制+static）、未引用 shared 不复制、缺入口拒绝、bare npm 拒绝、逃逸 server/+shared 拒绝、shared bare 拒绝、shared 引 server 拒绝 |
| `node scripts/checks/check-docs.mjs` | exit 0：21 文件、483 链接全部解析（含接收的 P1/P2 记录与本轮新增链接） |
| `git diff --check` | exit 0 |
| 接收哈希复算（`shasum -a 256`，7 份） | 全部与声明/登记一致（见 §2） |

## 5. 未验项与边界

- **真实打包未验**：`npm run build:backend` 的端到端真实构建依赖候选 I 的 `server/entries/web-backend-entry.mjs` 与 `[[bin]]` 登记，本树不可跑；本轮仅合成桩验证装配与规则逻辑，不冒称打包已通。
- **`test:web-manual-items` 未验**：四个测试文件属候选 I/II 写入范围，脚本接线已就位但用例不存在，`npm run check` 在本树会在该步如实失败（缺前置）。
- **仓库模式守卫的 3 条 vendor/pi ref.missing** 为本树预置环境状态（`probe:prepare-pi` 需网络安装＋构建，属重前置，本轮未跑）；基点守卫对照证明非本轮引入。集成轮按仓库命令准备后即消。
- **未跑**：完整 `npm run check`（唯一集成执行者在候选齐备版本串行）、任何 cargo 构建/测试、真实 HTTP/SSE/浏览器路径。Linux/代理/真实凭据/真实工作根边界不变。
- 推送、部署、真实模型/凭据未授权未做；MAYNE-23/父任务状态未改（成员不改状态）。

## 6. 结论

**候选交付（engineering candidate）**：III 写入范围内全部落地，聚焦验证全过；002 冻结守卫按设计在集成前保留一条预期违规。工程候选的独立审查建议由未参与本轮的 Kimi 或 ZCode 承担（按派发由队长实际派发留痕）；最终集成（接入 I/II 候选、补齐验证、串行新完整门禁）由队长另行派发后执行。
