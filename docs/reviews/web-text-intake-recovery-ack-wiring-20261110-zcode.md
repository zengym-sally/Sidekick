# 恢复链路 ACK 接线闭合：`http-server.mjs` taskResolve 单点转发（MAYNE-24，2026-11-10，ZCode）

- **任务来源**：协调层派工（评论 `01a1c292-f2a8-71c9-aec1-48e4feb83704`）——在修复候选 `b4aea55` 之上独立小提交闭合 ACK 接线；此次明确追加 `server/lib/http-server.mjs` **仅 `taskResolve` 中既有 ACK 的转发范围**，其余写域沿 `01a1c26d`；补真实 handler 正控（暂存路径完整 ACK→202 并提交原结局、缺／错误 ACK→400 且零发布、旧条目版本→409 且零写入、保留普通路径与退出未知正反控、非法 ACK 形状按既有校验语义处理）；交新 SHA／逐文件差分／真实 HTTP 原始输出／必要回归；不重复完整基线矩阵、不跑聚合／完整 gate；**仅本地提交，绝不再 push**。
- **操作偏差确认**：`01a1c292` 核实的网络 push 越界（修复分支被推至 Gitee origin）系本人前轮所为，如实确认。本轮起遵照：远端保持核查时原状（未做任何远端清理），本轮合并与接线全部**本地提交、零 push**，后续亦不 push／不 PR／不部署。
- **交付拓扑（如实登记）**：平台交付约束要求本轮工作必须落在任务分支 `agent/zcode/mayne-24` 之上且包含起点 `1e3199f`；派工要求接线位于 `b4aea55` 之上。两者经**合并提交**调和：`f8a2de4` 把 `b4aea55d34c4cda8228d064eb5ac4ba425bd2d5e` 并入本任务分支——`b4aea55` 保持为祖先（受审版不被静默替换，独审对象在历史可达），接线提交直接位于合并树之上，其**第一父差分＝恰本轮写域**（§2）。合并消解全部登记于 §4。

## 1. 身份

- 接线基点：合并提交 `f8a2de4`（树＝`b4aea55` 树 ∪ `1e3199f` 候选；`git diff b4aea55 f8a2de4 -- server/ src-tauri/ runtime/ shared/ package.json` **为空**——server 闭包与受审候选逐字节一致）。
- 接线提交：本记录随附提交（第一父 `f8a2de4`），恰 2 文件：`server/lib/http-server.mjs`（SHA-256 `f64dd5c8…36bad2`）＋`tests/unit/web-text-intake-recovery-authority.test.mjs`（SHA-256 `003a16f8…da437`）；逐文件差分随附件 `ack-wiring-first-parent.patch`（第一父差分＝写域本体）与 `ack-wiring-vs-b4aea55-server.patch`（对受审候选的生产面差分，恰一文件）。
- 存储二进制：`web-backend-storage` 从**本合并树** `src-tauri` 本轮重建，SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`——与诊断轮／修复轮登记值**逐字节同值**（`src-tauri` 与 `b4aea55` 零差异，第三棵树同值构建；`build/s0-runtime` 资源目录复制自本机既有构建产物，tauri-build 存在性校验前置，不进存储 bin 编译面——与前三轮同口径登记）。
- 冻结契约钉值：`docs/engineering/web-api-contract.md` 本树 SHA-256 复核＝`61863271…f58d`（W0 冻结钉值精确命中；合并零漂移）。

## 2. 接线内容（仅转发，无新规则）

1. **`taskResolve` staged 分支补转发**（http-server.mjs，恰一处调用点）：`commitStagedResume(taskId, current.attemptId, body.expectedVersion)` → 增第 4 参 `body.acknowledgedReceipts ?? []`——与普通路径既有转发（同函数下方 `taskService.resolve` 调用）**同字段、同缺省**；handler 不新增任何预校验、不改任何错误路径。 Accompanying comment（同函数注释块内一句）登记转发与普通入口同门同语义。
2. **服务层两文件零字节**（`task-service.mjs`／`text-intake-service.mjs` 的 `01a1c26d` 写域不动）；其余生产／schema／守卫／契约／package 字节零改动。
3. **测试文件纯追加**：既有 25 面（含 H1–H5）逐字节不动（blob 由 `4b1093e1` 变更为追加后新 blob，既有面文本零改动——`git diff` 仅含头注 H 面清单扩行＋文件尾 H6–H9 四面），新增 H6–H9 四面（§3）。

## 3. 红绿证据（真实 HTTP handler 层，同测试字节）

- **绿（接线树终局运行）**：`node --test tests/unit/web-text-intake-recovery-authority.test.mjs` → **29/29 pass、exit 0、墙钟 0.64s、stderr 空**（25 既有面全保持；H6 最慢面 27ms 量级，20000ms 预算未触及）。原始输出随附件 `authority-tap-green-final.tap`。
- **定向差分反控（不重复基线矩阵）**：仅 H 面（`--test-name-pattern '^H[1-9]'`）在**摘除转发一行**的 handler（还原为合并树 `f8a2de4` 字节，SHA 复核 `63056f0a…`）上运行 → **8 pass / 1 fail、exit 1**：**恰 H6 红**（断言 202 实得 400——即 `01a1c292` 登记的「服务层完整 ACK 绿例签不了暂存路径 HTTP 合法处置」缺口本身在 handler 层的差分显形），H1–H5 与 H7–H9 全部保持绿；接线文件按 SHA-256 复核还原（`f64dd5c8…36bad2`）。原始输出随附件 `hfaces-unwired-differential.tap`。
- **H6（承重新面）**：真实 HTTP staged 入口完整 ACK → **202** ＋ 原暂存结局提交（`state=succeeded`）＋ staged candidates 发布（`staged→pending`）＋ 条目处置同提交（version 2、`resumed`／`resume`／`decided_by=user`／`decided_at`）＋ 恰一事件（无幻影）；且合法请求**纯由 wire 构造**（先 `GET /api/tasks/:id` 读 `recovery.receipts[0].receiptId` 与 `recovery.itemVersion` 再 POST——诊断轮判据 1 的「正确请求不可构造」缺口在 staged 入口的 HTTP 面闭合）。
- **H7（错误 ACK）**：真实 id 在握、故意送非台账 id → 400 `validation_failed`、任务不动、零发布（candidates 全 `staged`）、条目不动（pending/version 1）、零幻影事件。
- **H8／H9（非法 ACK 形状）**：送裸字符串（非契约列表形状）→ 两入口各 **400 `validation_failed`**——handler 无预校验，转发值直达服务层既有回执门作答，无崩溃、零发布。诚实登记：H7–H9 在未接线 handler 上同样绿（未接线时 ACK 恒弃→门恒拒），它们钉的是**接线后转发值真实到门**的语义面，不是差分证据；本闭环的差分承重面是 H6。
- **保留正反控原样绿**：H1（staged 旧条目版本→409 `version_conflict` 零写入）、H2（staged 缺 ACK→400 零发布）、H3/H4（普通路径缺 ACK 400／完整 ACK 202）、H5 CONTROL（退出未确认→409 `exit_unconfirmed`）——`01a1c292` 点名保留的普通路径与退出未知正反控全部保持。

## 4. 合并树消解与回归（合并提交 `f8a2de4` 的登记）

- **冲突消解（2 add/add，均 keep ours）**：`tests/unit/web-text-intake-recovery.test.mjs` 与 `tests/fixtures/web-text-intake/protocol-worker-process.mjs` 保留**本支协调层已接受的修正字节**（F1 restart-stub 无结果夹具、W(deadline)/W(loss) 拆分、`fields` 形状候选——`b4aea55` 侧副本为这些修正所取代的修正前草稿）；`src/components/SettingsPanel.vue` 自动合并取本支 tip（`73c1f643`＝frozen-I `fa75f477` ＋ 已审 capability-UI 修订 `2d5e15f`，本支经 `180c2ae` 已含 `fa75f477`，无回退）。`server/`、`src-tauri/`、`runtime/`、`shared/`、`package.json` 两边零重叠——合并树与 `b4aea55` 逐字节一致。
- **既有 recovery 套件（合并消解核证）**：上述修正字节在本合并树（完整 I server ＋ `5311ffa3…` 二进制）上 **11/11 全绿、exit 0、墙钟 57s**——比修复树当轮 8/10（F1/W 双败，登记「本机真实进程时序前置条件」）恰多出 F1/W 两绿，来自协调层修正夹具。与 `01a1c292` 的「F1/W 本机时序归因未决」**并存不冲突**：本审只证明修正字节在本树全绿，时序归因结论仍按 OpenCode 独审口径保留未决。原始输出随附件 `recovery-suite-merged-tree.tap`。
- **门禁（本合并树）**：`node --check` 2/2 exit 0；`npm ci --ignore-scripts` exit 0；`npm run typecheck` exit 0；`npm run check:structure` 173 条＝170×`.zcode`（本运行环境注入的运行时目录，未入库、非候选字节）＋3×s32 vendor/pi dist 缺失（修复树自身登记基线类）；本支前轮登记的 5 条候选树 `[ref.missing]`（fixture 引 absent server 文件）在合并树上**解析**；全日志零 recovery／authority／http-server／ack 提及。`npm run check:docs` 于本记录落盘后运行（§6）。

## 5. 登记项（不隐瞒）

1. **非法 ACK 形状的既有语义**（两入口共享、`b4aea55` 服务层字节既有、本轮写域外、契约 §4.5 未定义形状规则，故 handler 不补预校验、本轮亦不另造规则）：回执门以 `acknowledgedReceipts.includes(receiptId)` 判覆盖，形状宽松——恰等于回执 id 的字符串会满足覆盖（与 `[id]` 等权，无权限增量）；不可 `includes` 的值（如数字）→ TypeError → 500 `internal_error`。接线后两入口语义**完全一致**（本轮前普通入口即如此）。登记给 owner／独审裁定是否收紧，不在本轮修。
2. **README／manifest／package 零字节**（沿 `01a1c26d`「公共 README／manifest／package 留工程接收，不带前轮索引增量」口径）；本记录不进 README 索引行（同修复记录轮口径）。
3. **边界**：不重复完整基线矩阵（`cd08588` 红轮未重跑——`01a1c292` 明示豁免）；无聚合／完整 gate／19 旅程／`cargo test`／真实模型；HTTP 面严格 handler 层（真实 HttpServer／配对／会话／CSRF／状态码映射＋真实服务＋真实存储二进制；无调度器／worker／真实 Pi）；无网络操作（零 fetch/push/PR）。

## 6. 门禁汇总与证据清单

| 门禁 | 结果 |
|---|---|
| `node --check`（两改动文件） | exit 0 |
| `npm ci --ignore-scripts` | exit 0 |
| authority 套件 29 面（接线树） | **29/29、exit 0、0.64s** |
| H 面定向反控（未接线 handler） | 8/1、exit 1、恰 H6 红 |
| 既有 recovery 套件（合并树） | **11/11、exit 0、57s** |
| `npm run typecheck` | exit 0 |
| `npm run check:structure` | 173＝登记基线类合计（§4），零本轮提及 |
| `npm run check:docs` | exit 0（本记录落盘后运行） |

原始证据（gitignored `build/mayne24-ack-wiring/`）：`evidence/authority-tap-green-final.tap`、`evidence/hfaces-unwired-differential.tap`、`evidence/recovery-suite-merged-tree.tap`、`evidence/typecheck.log`、`evidence/check-structure.log`、`evidence/check-docs.log`（21 文件 519 链接）、`ack-wiring-first-parent.patch`、`ack-wiring-vs-b4aea55-server.patch`、`http-server.wired.mjs`（接线文件全量副本，SHA-256 复核用）、`SHA256SUMS`。作者不自签，独审由协调层另派。
