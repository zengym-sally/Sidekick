# W1 文本整理 III 工程候选独审（ZCode，2026-11-08）

> MAYNE-24 派发线程 `01a1bb76-cd8c-7072-997a-b144eefdbc86`（Codex 队长指派，2026-11-08）：独审工程候选 `ff287ab937d0b30b246302a7b24d30df68cc59da`（tree `bf16958096f4c987e3819beb9bce544dacf1ac04`，分支 `agent/opencode/mayne-24`，基点本地 main `1e37044`/tree `77a5485`）。评审人 ZCode（agent `5e45398f-943e-4151-9efd-b7a580c6d7a8`），未参与 I/II/III 任何写入。**结论：通过（限 III 工程候选范围）**——五个重点核对项全部实证通过，2 条观察不阻断；I/II 未交前置与集成级门禁单列（§8），不构成对工程候选的否决。评审环境：macOS arm64，node v24.20.0，npm 12.2.1，rustc/cargo 1.89.0。原始证据 `build/web-text-intake-engineering-review/`（gitignored：接收附件、复跑日志、本记录配套 `SHA256SUMS-zcode-review.txt`、`admission-zcode-review.json`）。

## 1. 范围与方法

按派发限定：候选只读；仅写本记录与 `build/web-text-intake-engineering-review/`；不重开已审 P1/P2；不跑完整重门禁；聚焦验证 III 范围五重点。候选经共享对象库只读访问；动态复跑在 `ff287ab` 的独立 detached worktree 进行（仅产生 gitignored 构建产物，用后即删，未改候选字节、未动他人分支）。所有核对命令与结果可复跑。

## 2. 附件、准入登记与接收哈希 — 通过

- **平台附件读回**（CLI 下载复算）：`candidate.diff` 245559B SHA-256 `8da4fba4…c8e0`、`admission.json` 7670B `a6cb7402…8d44`、`verification-log.txt` 7646B `6ed2e627…2107`，ID/大小与平台记录一致。
- **附件↔提交互证**：`candidate.diff` 与 `git diff 1e37044 ff287ab` 逐字节一致；提交树 `bf169580`、恰 17 文件 +1529/−10、基点 `1e37044` 为其祖先——三项独立复核成立。
- **准入登记内容**：pwd/branch/HEAD（`a7d2a88`，tree＝基点树 `77a5485`）、基点祖先与树身份、七份接收哈希、17 项写入清单、预定独审机制俱全；写入清单与实际 diff 的 17 文件**恰好一一对应**，零越界（AGENTS.md 平台漂移、`.multica/`、`.opencode/` 如实排除在候选外）。
- **七份接收材料**（`git show <精确提交>:<路径>` 复算 SHA-256，并逐一与候选树副本字节比对）：契约接收态 `5982c062…fe7b0`＝登记冻结值、授权清单 `caa746bb…c6b20`＝冻结值、P2 报告 `2d647417…d17bc`＝冻结值；OhMyPi 核验 `d9288857…e82f`、R3 `2f079209…fd62`、R2 `959e78fd…68f3`、R1 `a1eecd66…c6f7` 六份候选树副本与来源提交**逐字节相同**；契约副本＝已审字节＋恰 1 行元数据 blockquote（`diff` 实测 `2a3` 一行：owner 批准评论、审批包 `d8fc4f3f…37e74c`、接收版本/SHA），业务规范与 DDL 围栏零字节改动。

## 3. 003 冻结正负例 — 通过

- `check-structure.mjs` 改动恰三处（机械 diff 核对）：`IMMUTABLE_MIGRATIONS` 追加 `003_text_intake.sql`→`8e4e3159…7870`（＝owner 批准 A 项冻结值，既有冻结值逐字节未动）、违规文案 `web-backend/1`→`web-backend/1-3`、自测新增 003 三态断言。**无任何层界/目录/拒绝规则放宽。**
- **自测（本机复跑 exit 0）**：003 缺失→拒绝、篡改→拒绝均实测成立；正例按设计在候选 I 文件落地后自动激活（当前树无该文件，正例如实跳过并明示）。
- **仓库模式**：前置未跑时恰 4 条违规＝新增仅 1 条 `schema.immutable-migration 003_text_intake.sql`（候选 I 前置的预期 pending，非环境失败）＋3 条 `ref.missing`（vendor/pi dist，全新树基线既有）；标准 `probe:prepare-pi` 后恰剩 1 条预期违规——与本评审两次独立复跑及候选声明一致。001/002/web-api/1 冻结值经仓库模式全部通过（未触发违规）。

## 4. Runtime 闭包与可执行位 — 通过（本机真实复跑）

前置按仓库既有命令本机重跑：`npm ci --ignore-scripts` exit 0（107 包）、`probe:prepare-cli` exit 0（lark-cli v1.0.98）、`probe:prepare-pi` exit 0（provenance tree `e89822b0…c68`＝W1 登记）、`probe:bundle` exit 0。

- **负例**：移走 `build/s0-runtime` 后 `node scripts/build/build-backend.mjs` exit 1，0.034s 内快速失败，错误点名 `probe:prepare-cli && probe:prepare-pi && probe:bundle`，日志零前端/cargo 构建输出——确证在昂贵构建**之前**失败。
- **正例**：`npm run build:backend` exit 0（47.5s）；bundle 布局恰 `{bin,runtime,server,shared,static}`；`runtime/` 与 `build/s0-runtime` `diff -rq` exit 0（**479 文件逐字节一致**）；`runtime/node`、`runtime/lark-cli`、`bin/web-backend-storage` 均 0755；存储二进制 2633392B SHA-256 `b7dd9339…f422`＝W1 登记值；`runtime/node` `9d050fd4…588a`、`runtime/organizer.mjs` `08f32db2…11a7` 与候选日志一致；runtime `source.json` provenance `e89822b0`/`ad702637`＝W1 登记。
- **层界**：staged server+shared 裸导入仅 `node:` 内建六类（child_process/crypto/fs/http/path/url），零 npm 依赖，零 `runtime/`、`vendor/` 引用；`static/` 为真实产品 dist（index.html＋assets）。

## 5. check 的真实构建前置、套件接入与原预算 — 通过

机械比对基点/候选 `package.json`：`check` 链 51→52 步，前 51 步逐 token 相同，仅尾追 `&& npm run test:web-text-intake`；新增脚本恰 1 条（聚合 `tests/unit/web-text-intake.test.mjs`＋四套 `web-text-intake-{http,queue,controlled-model,static}` integration，`--test-timeout=20000`＝W1 五文件组同款预算），与工单 II 文件清单一一对应；删除 0、其余值零变化、`dependencies`/`devDependencies` 逐字节相同、锁文件不在 diff。**真实构建前置已在链内强制**：`probe:bundle`（第 4 步）产出 `build/s0-runtime`，`build:backend`（第 50 步）缺它即显式失败（§4 负例实证），同一稳定版套件不重复整套跑。五个套件文件属 I/II 写入范围、本树不存在——门禁接线就位但不执行、不造占位，运行会如实失败（符合工单「不代签」要求）。

## 6. 公共记录的签证边界 — 通过

- **已审材料原样性**：R1/R2 两次不通过结论按历史原样保留，未洗白；R3 通过、P2「验收输入非实现」口径与接收字节一致；授权清单原样接收、未追加状态行（批准事实登记于 MAYNE-24 工单与 product05，未改授权原文）。
- **状态区分诚实**：architecture（003 冻结段＋打包行补 `runtime/` 闭包语义）、verification（新聚合门禁＋runtime 构建前置＋003 冻结语义，明示「套件未到前如实失败，不代签业务通过」）、web-backend-design（MAYNE-24 状态行，明示 I/II 候选与集成级门禁未到）、product05（顶部准入登记、三候选总览、W1 队列行补文本整理现状并把 MAYNE-23 docs 收口校准为已落 `1e37044`）——全部只登记「已批准/实施中/未验」，无任何业务通过签发；docs/README 地图、reviews 索引 119→126（七条新登记，含工程候选记录）。
- **零触碰**：`src/`、`shared/`、`runtime/`、`server/`、`src-tauri/`（含 001/002 迁移、Cargo、锁）、`tests/`、`vendor/pi`、`resources/skills`、identifier 均不在 17 文件内；`check:docs` 本机复跑 exit 0（22 文件 556 链接）；`git diff --check` 干净。
- 本记录按派发限定不登记 reviews 索引（索引写入属 III/集成收口），集成接收本评审时须补登记。

## 7. 观察项（不阻断）

- **OBS-1（准入时间戳自相矛盾，建议澄清）**：`admission.json` `registeredAt=2026-11-08T14:05:00Z`，晚于候选提交时间（13:59:28Z）与附件上传时间（14:00:26Z）——「首次修改前完成登记」从现有留痕（build/ 不入 git）无法独立证实，且该字段与其自身上传时间矛盾。登记**内容**七项全部实证准确（含与实际 diff 恰好一致的写入清单），未发现任何越界或事后篡改迹象，故不阻断；建议 OpenCode 说明笔误成因，后续准入登记只写真实时刻，必要时以平台附件上传时间为准。
- **NIT-1（缩进）**：`package.json` 新增行行首 1 空格（相邻行 4 空格）；JSON 合法、零行为影响，集成时顺手对齐即可。

## 8. I/II 未交前置与未验项（单列，不构成对工程候选的否决）

- `003_text_intake.sql`、五个 `test:web-text-intake` 套件文件：属候选 I/II 写入范围，本候选树不存在——仓库模式 1 条预期违规与门禁「接线未执行」状态均为此如实反映。
- 未跑（显式留给唯一集成执行者另派串行新跑）：完整 `npm run check`、cargo 测试族、`test:web-text-intake`/`test:web-manual-items` 套件执行、真实 HTTP/SSE/浏览器路径、entry `--runtime-root` 缺省解析（候选 I 交付面，bundle `runtime/` 布局已就位待接线）。
- 环境边界不变：Linux/代理/真实凭据/真实用户根/真实模型均未验；本评审真实打包复跑限 macOS arm64 本机。MAYNE-24 保持 in_progress；集成与 main 收口另派。

## 9. 结论

**通过**——III 工程候选在其冻结写入范围内完整、诚实、可复现地落地：五重点核对项（附件/准入及接收哈希、003 冻结正负例、Runtime 闭包与可执行位、check 真实构建前置/套件接入与原预算、公共记录签证边界）全部实证通过；候选声明与本评审独立复跑逐项吻合（含 bundle 三哈希与 W1 登记三方一致）。OBS-1/NIT-1 不阻断。已审 P1/P2 未重开；I/II 候选未到不代签；集成级完整门禁、独审登记补索引与 main 收口按派发留待后续。
