# W1 手工事项 III 工程候选独立审查（ZCode，2026-11-08）

> 派发：MAYNE-23 线程评论 `01a1b832-a66c-7b52-bd46-6c0aa873c3f2`（Codex 派审，ZCode 未参与 III 实现）。审查对象：工程候选 `ab696b8d5ad7ca3a3e15b1c8025e3697210036d0..133a2a18860dbd453f70f693585f4fc08e27882c`（OpenCode，III 工程接入/守卫/构建/公共记录）。
> **结论：通过（限 III 写入增量）。** 补丁与全部冻结哈希逐字节核实；002 三态、布局与引用边界反例、打包合成用例在本机独立复现全过；未发现实际缺陷，1 项 NIT 与 2 项观察登记为非阻断。真实 `build:backend` 打包、`test:web-manual-items` 四套件与完整 `npm run check` 属候选 I/II 依赖的前置，本轮桩验证不代签，保持开放。
> 本轮为候选只读审查：全部运行在临时分离检出上进行，候选树（`133a2a1`）全程 `git status` 干净。原始证据：`build/web-manual-items-engineering-review/`（gitignored；本机路径，不入库）。审查环境：macOS arm64（darwin 27.0.0）、Node v24.20.0、git 2.56.0（`git format-patch` 版本尾注）。

## 1. 基点、拓扑与补丁核实

| 项 | 实测 | 与声明/登记 |
|---|---|---|
| `ab696b8^{tree}` | `7b71cdb36888dd1e2955cfa566d2ca606670d4bf` | ＝集成基座 `6546990^{tree}`，逐字节一致（`git rev-parse` 双点复算） |
| `6546990` → `ab696b8` 祖先 | `git merge-base --is-ancestor` 成立，且 `ab696b8` 父恰为 `6546990` | ＝admission 声明 |
| `133a2a1` 父／tree | 父＝`ab696b8`；tree＝`15ad350a2f09f26bdd9e8ddfcfdcb5801a30944c` | ＝交付声明 |
| 补丁 SHA-256 | 随附 `w1-iii-engineering.patch`＝`4109daa97bf2fbdff3d9ae519b03986c9c9fc0bf3a434b70822bd9dff5eb65aa`；本机 `git format-patch ab696b8..133a2a1 --stdout` 复算**逐字节同哈希** | 一致 |
| diff 规模 | 15 文件 +1449/−30（`git diff --stat`） | 一致 |
| 写入范围 | 15 文件全部落在本轮批准的 III 清单内（守卫/构建/package/公共文档/接收记录/工程记录）；**无** I 范围（server/、002、src-tauri、Cargo.toml、前端）、**无** II 范围（integration 套件、fixtures）、**无** vendor/pi、锁文件、依赖、identifier 改动 | 一致 |
| `git diff --check ab696b8 133a2a1` | exit 0 | 一致 |

## 2. 冻结哈希核实（逐字节）

| 对象 | 实测 SHA-256 | 权威值 |
|---|---|---|
| `src-tauri/migrations/web-backend/001_web_backend.sql` | `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` | ＝登记冻结值 |
| 001–005 既有迁移（`IMMUTABLE_MIGRATIONS` 旧值） | 守卫内 4 个旧值与各文件实测一致，diff 证明旧 Map 项逐字节未动 | 未变 |
| `docs/engineering/web-api-contract.md`（web-api/1） | `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` | ＝登记冻结值 |
| 手工事项契约（候选内） | `8d7529531e7e5c53a3d195fa20f376a2b72d400e0ce8114b8c8ccc3b17b70e8d` | ＝登记值，且＝`19045b8` 处 blob（原样接收） |
| 授权清单接收版（`19045b8`） | `452dc4366b3d56f269f6864d372d5942727e4f48ad1e371edeb97628a19e8c0f` | ＝登记值 |
| 授权清单提交版（`133a2a1`） | `242ea3db295bcbaa57e9d12dae06c6b27fd0fbee68243f709383b699f048f304` | ＝交付声明；两版 `diff` 仅 2 处——页首状态行、§11 状态行＋文末追加 §12；§3/§10 申请原文与 §5.1 SQL 块逐字节未动（独立 diff 核实） |
| 002 DDL（自授权 §5.1 SQL 块提取） | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` | ＝owner 批准哈希；接收版与提交版块哈希相同 |
| 守卫 `IMMUTABLE_MIGRATIONS` 新增项 | 恰一条 `002_manual_items.sql → b6cb8e61…f97e` ＋2 行注释；无其他冻结变更 | ＝批准 A 项 |

002 迁移文件本身在候选中**不存在**（属候选 I），守卫按设计如实报缺失（见 §4）。

## 3. 接收的已审记录（blob 级）

四份记录在候选与来源提交间 `git cat-file blob` 哈希逐一相同：

| 记录 | 来源提交 | SHA-256（两端一致） |
|---|---|---|
| P2 就绪报告 | `d94de69` | `900d28c11281863ada072a9f7da19659bcc62ed9e37548a44ac300ad77ff5778` |
| P2 OhMyPi 审阅 | `f031e21` | `7d340c700e908c519ecb23aa207a4793c6e8d509ad7d66fec8ed619f5c7faa21` |
| P1 ZCode 首轮 | `2706044` | `e67fff2b3ad6af2cac711fdc41ab49afe61b2d4fa60adff34c5d9ae04a88d17e` |
| P1 ZCode R2 复审 | `c0f88f6` | `5e72c5b7e2dfb0375b95b87e0d4c32805a1acf581977493bbac2202bd1dd2a8f` |

`docs/reviews/README.md` 索引 85→91 恰为上述 4 份＋授权清单＋工程记录 6 行新增，既有行未动。**未改且已通过的 P1 规范（R1 不通过→修订→R2 通过 `c0f88f6`）与 P2 基座/验收（`d94de69`/OhMyPi `f031e21` 通过）结论在本轮保留，不重开。**

## 4. 守卫独立复现（候选树临时检出，Node v24.20.0）

| 命令（候选树内） | exit | 结果 |
|---|---|---|
| `node scripts/checks/check-structure.mjs --self-test` | 0 | 26 类违规＋8 处独立引用断言全检出；clean 正例（含 `server/lib/clean.mjs`、`src-tauri/src/bin/web-backend-storage.rs`）不误报；001 原样通过/篡改拒绝；002 缺失/篡改拒绝 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | 1 | 恰 4 条：**唯一新增** `schema.immutable-migration 002_manual_items.sql`（预期待集成违规）＋3 条 `ref.missing`（vendor/pi dist） |
| 基线对照（基点守卫在基点树运行） | 1 | 恰 3 条同样的 vendor/pi `ref.missing`，无 `schema.immutable-migration` → 守卫 delta 恰为 002 一条预期违规，与交付声明一致 |

### 4.1 002 三态（独立复现，非仅信任自测）

- **缺失**：候选树现状 → `schema.immutable-migration` 拒绝（上表）。
- **原样**：把授权 §5.1 提取的 DDL（哈希即批准值 `b6cb8e61…f97e`）放入候选树该路径（untracked）→ 该违规消失，仅剩基线 3 条；`--self-test` 在 002 存在时输出「W1 manual-items migration original bytes passed and tampered/missing bytes were flagged」，**正例自动激活路径实测有效**。
- **篡改**：原文件仅追加一行注释 → 立即恢复 `schema.immutable-migration` 拒绝。

### 4.2 布局与引用边界反例（8 负例＋3 正例）

负例全部以正确规则检出：根级 `bin/`→`top.dir`；`server/loose.mjs`、`server/other/x.mjs`→`layout.server-top`；`src-tauri/src/bin/other.rs`→`layout.src-tauri-bin`；`server/lib` 内 `import express`→`layer.server-bare`；server→`src/`→`layer.server`；shared→server→`layer.shared`；src→server→`layer.src`。正例（`server/entries/*.mjs` 用 `node:http`＋相对引 `shared/dates.mjs`、`server/lib/*.mjs` 用 `node:fs`、`src-tauri/src/bin/web-backend-storage.rs`）零误报；删除全部反例后守卫回到基线 3 条。

## 5. 打包输入输出（`build-backend.mjs`）独立复现

- **缺入口拒绝（真实候选树实测）**：`node scripts/build/build-backend.mjs` → exit 1，命名前置错误「Missing server/entries/web-backend-entry.mjs … candidate I's deliverable … refuses to fabricate placeholders」，且失败发生在 `npm run build`／cargo 之前，`build/web-backend/` 未被伪造。
- **合成 7 用例（真实 builder 字节复制＋npm/cargo 桩，全部独立复现通过）**：
  1. 完整装配 exit 0：`build/web-backend/` 下 `server/entries`＋`server/lib` 相对布局保留（入口字节一致）、恰 1 个实际引用的 `shared` 模块、`bin/web-backend-storage` 可执行（0755）、`static/`＝dist。
  2. 未引用 `shared` 模块不进 bundle。
  3. 缺入口拒绝（同上，真实树）。
  4. server 内 bare npm（express）拒绝；5. 逃逸 server/＋shared（→`src/`）拒绝；6. shared 内 bare import（got）拒绝；7. shared 引 server 拒绝——四例均 exit 1、命名 `Packaging violation`、发生在构建之前、无产物伪造。
- **桩验证边界（如实声明）**：以上仅证明装配与规则逻辑；**不构成真实打包通过**。`npm run build:backend` 端到端（真实前端构建＋cargo release＋`[[bin]]` 登记）依赖候选 I，留唯一集成执行者，本轮未签。

## 6. package.json 与 check 真实构建前置

- 程序化比对（`git show` 两版 JSON）：`scripts.check` 尾部恰追加 ` && npm run build:backend && npm run test:web-manual-items`，前缀逐字节不变；新增脚本恰 `build:backend`／`start:backend`／`test:web-manual-items`（20000ms 预算）三个；无删除、无改名、无预算变化；`dependencies`／`devDependencies` 及其余顶层键逐字节相同。
- **前置缺失（如实开放，非缺陷）**：候选阶段四个 `test:web-manual-items` 文件与 server 入口/bin 源不存在（实测逐一路径 ABSENT）；`npm run test:web-manual-items` exit 1（node --test 找不到文件）；`build:backend` 命名前置失败（§5）；完整 `npm run check` 在本候选会先在 `check:structure`（002 缺失）如实失败——三者均为守卫按设计拦截，集成轮在 I/II 齐备版本上才可运行。`pkg.check-order`（check:structure 先于 check:docs）实测仍满足。
- `node scripts/checks/check-docs.mjs`（候选树）exit 0：21 文件、483 链接全部解析；`node --check` 两脚本 exit 0。

## 7. 发现项（全部非阻断）

- **NIT-1（builder/guard bare 内建口径差）**：builder `isBuiltinBare` 接受旧式裸内建名（如 `fs`，经 `builtinModules`），守卫 `layer.server-bare` 仅接受 `node:` 前缀。守卫更严且在仓内权威，零 npm 依赖性质两侧均成立（npm 包两侧都拒），风险方向安全；建议集成轮或后续小改将 builder 对齐为仅 `node:` 前缀，避免「bundle 可带仓内守卫不接受的 bare 内建」的不一致。
- **OBS-1（`.zcode/` 平台元数据不在守卫豁免表）**：守卫元数据豁免仅 `.multica/`、`.opencode/`；ZCode 运行的工作树会因 untracked `.zcode/` 产生大量 `top.dir` 噪声（本审查主树实测 ~170 条，基点守卫同样行为，非 III 引入、非候选缺陷）。集成轮跑完整门禁时应从无 `.zcode` 噪声的检出执行；是否豁免属守卫规则变更，须另行按流程批准，本轮候选未动它是正确处置。
- **OBS-2（builder 整目录复制 server/）**：server/ 按目录整体复制进 bundle（shared/ 则是精确闭包）。当前无害：`layout.server-top` 已把 server/ 收敛为 entries/＋lib/，全部属于 bundle 相关内容，与冻结装配契约「server 相对布局」一致；仅登记为行为观察。

## 8. 结论

**通过**——III 写入增量（守卫收敛与冻结、构建接入、脚本接线、公共记录与接收）全部与批准范围一致且独立复现成立；候选前置缺失（002 文件、server 入口、bin 源、四测试文件、真实打包、完整门禁）均按守卫/构建的如实失败路径存在，留待唯一集成执行者在候选齐备版本处理，不构成本候选缺陷。真实 `build:backend`、`test:web-manual-items`、完整 `npm run check` 本轮**未签**；MAYNE-23 状态未动，索引登记（本记录入 `docs/reviews/README.md`）按派发写入边界留唯一集成轮执行。

原始证据（本机 `build/web-manual-items-engineering-review/`，gitignored）：`received/`（随附补丁/admission/日志与两版授权清单、002 提取块、四份接收记录双端 blob）、`logs-*.log`（002 三态、边界反例、builder 七用例、docs、结构守卫基线与候选对照）、`builder-synth/`（npm/cargo 桩与用例根）、`candidate-tree`／`counterexample-tree`（临时分离检出，审查后已清理）。可复核命令与哈希均在上文。
