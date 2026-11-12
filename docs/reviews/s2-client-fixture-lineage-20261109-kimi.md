# W1 `s2-client` 隔离用例重写：夹具线型合法性限定独审（Kimi，2026-11-09）

> 范围：仅审 OhMyPi 测试候选 `6e7e60c82d3951a0d036c3c1692cd42903e6f1cd`（tree `de311a0a21d1106ced902a72f73c4a98e15563b0`，父 `b5fdfb9`，恰 `tests/unit/s2-client.test.mjs` +75/−5）及记录 `572f301`。派工：`01a1c0aa`（Codex）。
> 风险级：R2（只改测试；但该文件在 `test:s2-domain` 门禁内，红即门禁红）。
> 结论：**不通过——限「新增 `unknownTask()`／取消响应夹具线型合法性」面**；因果、可证伪性、真实接线、隔离与全局恢复、原用例空转发现五项**验证通过**。附最小测试修法（仅测试侧）。未改任何生产字节，未重跑完整 gate。
> MAYNE-24 保持 `in_progress`。

## 1. 身份复核（对象库直读，逐项相符）

| 项 | 登记值 | 实测 |
|---|---|---|
| 测试提交 | `6e7e60c8…` | 相符；`6e7e60c8^{tree}`＝`de311a0a…` 相符 |
| 父提交 | `b5fdfb9` | 相符 |
| 差异 | 恰测试 +75/−5 | `git show --stat`：1 file +75/−5 相符 |
| 记录提交 | `572f301` | docs-only 2 文件（记录＋索引）相符 |
| 修订前测试 blob | `bb845bc9` | `38a7402`/`1e37044`/`72f1bb8`/`b5fdfb9` 四处逐字节相同，相符 |
| 修订后测试 blob | — | `825e133c…`（本审导出处复算相同） |
| runner | — | node v24.20.0；`npm ci --ignore-scripts --offline`（107 包，缓存离线） |

作者根因（字节定位）复现：本树 HEAD（＝修订前同 blob）跑 `npm run test:s2-domain` → 46/47 exit 1，唯一红即该用例，`TypeError: Cannot read properties of undefined (reading 'host')` at `src/lib/web-api-client.ts` `request()`——store 自 `76f44e7` 走 web 客户端后，桩内无 `window.location`。根因成立。

## 2. 作者主张的复跑（锁定树 `git archive` 物化，未动生产）

| 项 | 结果 |
|---|---|
| `node --test tests/unit/s2-client.test.mjs` | **35/35 exit 0** |
| `npm run test:s2-domain`（门禁脚本，4 文件） | **47/47 exit 0** |
| `npm run check:docs` | exit 0（21 文件 524 链接） |
| `npm run check:structure` | 自测通过；本审导出树 25 条违规全部为缺前置（`vendor/pi` dist 未 prepare、本审自建 `node_modules` 符号链接被 `git add`），**触及 `s2-client.test.mjs` 的为 0** |

## 3. 反控（均在 `build/mayne24-s2client-review/`  gitignored 导出树，跑后还原，最终 35/35 复绿）

| 编号 | 变异 | 结果 |
|---|---|---|
| M1a | `acceptRun` 全直通（删全部保护） | 16 红；**本用例红**，失败值 `null` vs `'MCP_RESULT_UNKNOWN'`，正是命名断言（`:213`）——作者登记属实 |
| M1b | 仅删 unknown 粘滞子句、保留不复活子句 | 10 红；**本用例仍红**——本用例全部承重在 `old.errorCode==='MCP_RESULT_UNKNOWN'` 这一子句上 |
| M2 | `useOrganizer` 绕开 web 客户端（直连工厂抛错） | **恰 1 红＝本用例**——夹具确证驱动真实 `useOrganizer → asBackend → fetch` 全链 |
| M3 | 删 `mutation()` 的 generation 围栏 | 2 红（`a late cancellation cannot replace a newer run…`、`a late candidate mutation…`），**本用例不红**——围栏本身在套件内有独立承重，重写没有放弃它 |
| V-1 | 在重写夹具上恢复「中间 refresh」的原结构 | 35/35 绿 |
| V-2 | V-1 结构＋删 `acceptRun` 保护 | 15 红但**本用例仍绿**——原结构对本断言确系空转（中间 refresh 重新读回权威 unknown 掩盖了裁决），作者「原用例空转」发现复现成立 |

## 4. 夹具合法性：不成立（本审阻断项）

新增 `unknownTask()`＝`state:'failed'`＋`failure.code:'MCP_RESULT_UNKNOWN'`，取消响应＝`state:'cancelled'`。对照契约、真实序列化与失败注册表，两者均**不可能由冻结 HTTP 面发出**：

1. **失败码注册表**（`server/lib/task-service.mjs:39-46`，冻结 web-api/1 §4.6，契约 `docs/engineering/web-api-contract.md:202-211`）：公开码恰 6 个（`model_request_failed`/`output_contract_invalid`/`auth_or_config_invalid`/`credential_unavailable`/`tool_execution_failed`/`worker_lost`）。`MCP_RESULT_UNKNOWN` 不在注册表、不在别名表；真实 `normalizeFailure({code:'MCP_RESULT_UNKNOWN'})` → **`worker_lost`**（C1 实测）。`tasks.failure` 的全部写入点均经 `normalizeFailure` 或直写注册码——HTTP 面永远发不出该 code。
2. **权威态是 `needs_review` 而非 `failed`**：副作用不可证明一律转 `needs_review`（`maybeAutoRetry`→`markNeedsReview`、`confirmExit` 退出未确认、`task-recovery` 重启分支；契约 §3.4/§4.6「失败码不构成副作用安全证明」）。`visibleFailure` 对 `needs_review` 返回 null（仅暂存失败结局窄例外）。客户端 `toModelRun` 把 `needs_review→'interrupted'`、`errorCode=failure?.code ?? null`——**mapper 往返不校验码注册**（派工怀疑属实）：它能读回任意 code，所以「mapper 能读」不构成合法性。
3. **C2 实测（真实接管线）**：合法 `needs_review` 行 → store 持 `{status:'interrupted', errorCode:null}`；合法 `failed`+`worker_lost` 行 → `{status:'failed', errorCode:'worker_lost'}`。`MCP_RESULT_UNKNOWN` 是**原生领域 sentinel**（`src/domain/organizer.ts` 错误注册表；Rust `mcp_calls.rs` 恰写 `status='failed', error_code='MCP_RESULT_UNKNOWN'`）——真实存在于 Tauri invoke 管，在 HTTP 管不可达。即：该 sentinel 在 web 管上是死值，`acceptRun` 的 unknown 粘滞子句在真实 HTTP 接线下不可被执行到。
4. **取消响应合法性**：`task-service.mjs:508-547`——`queued`→200 `cancelled`、`running`→202 `cancelling`、其余一律 `state_conflict`（`http-server.mjs:45` 映射 409，「当前状态不允许取消。」）。夹具让一个 store 已持终态/待核对的任务回答 200 `cancelled`，不可达。
5. **夹具自相矛盾**：同一刷新内 `/api/tasks?limit=200` 报 taskId A 为 `running`、`/api/tasks/A` 报同一任务为 `failed`+unknown——真实两端点读同一行，不能分歧；且终态/`needs_review` 任务根本不在列表的 active 集合（queued/running/cancelling）里，store 只能从来源详情的 `run` 字段取得它（C2 即此合法形态）。
6. **时间戳倒挂**：取消行 `terminalAt`（002Z）早于 unknown 行（003Z）——后发生的迁移带更早终态时间，不可生产。

## 5. 因果与保护范围判断

- **迟到响应形状**：新结构（首读已 unknown → 发 cancel → 响应后至）对赋值路径确是迟到形状：capture 与 resolve 之间无 generation 抬升，`organizer.ts:48` 的赋值真实执行；取消后读取失败（合成 outage）移除了 refresh 掩盖。因果机制成立。
- **但线型不合法**：派工判据是「**合法真实接线**下较新权威态不被旧响应覆盖」。本用例所移动的状态对（unknown sentinel ↔ cancelled）在合法 HTTP 接线下一侧不可存在、另一侧不可发出，故按判据**不通过**。M1b 进一步表明其全部保护价值恰压在该不可达子句上。
- **generation 围栏**：原结构中围栏本身是真实保护（M3：删它两个专用例红），只是在原结构里它顺带把取消赋值变成 no-op，使断言改由 refresh 满足——所以本用例排除中间 refresh 是正确的「去 mask」，不等于放弃围栏保护。
- **已删 `model.batch.run` 断言**：新结构里来源详情 `run:null`，`batch.run` 全程为 null，旧断言在新夹具下结构性不存在；其意图（迟到弱行不覆盖 batch 权威态）由 `:67-71` 循环例等价覆盖（7 种迟到行均断言 `batch.value.run` 保持 persisted，且 M1a 中与该例同红，承重同一子句）。
- **真实 Pinia→asBackend→fetch**：M2 通过。**隔离断言**：保留且前后各一次（`no active Pinia`）。**全局夹具恢复**：window/fetch 描述符均存均还、`$dispose`＋`setActivePinia(undefined)`，通过。

## 6. 最小测试修法（仅测试侧；生产零改动）

合法 HTTP 接线下，取消赋值路径**不可能**与更新的权威态冲突（取消响应只反映取消发起时的状态：queued→200 cancelled／running→202 cancelling／其余 409；途中的更新只能来自 refresh，而围栏已把该赋值变 no-op）。故二选一：

- **修法 A（推荐，保结构改进）**：把本用例移回本文件既有的直连工厂领域对象风格（对照 `:97`「a late cancellation cannot replace unknown reconciled by refresh」），保留作者的结构改进——无中间 refresh＋取消后读取失败——使 `acceptRun` 的 unknown 粘滞承重且可证伪；用例名去掉 HTTP 线型措辞（`MCP_RESULT_UNKNOWN` 领域形状在原生管真实存在，领域层测试合法）。Pinia 隔离断言可保留为独立关注点。
- **修法 B（保 HTTP 管框架）**：`unknownTask()` 换成合法权威行（`needs_review`＋recovery cause，或 `failed`+注册码），列表/详情一致（无 active 行、run 走来源详情），取消响应只用法理上可发的形状——但此时本用例退化为围栏/不复活覆盖（与 `:102` 及 M3 的两例近重复），unknown 粘滞子句仍无合法 HTTP 覆盖；应如实登记该子句「仅原生管可达」的已知限制，不得以非法行代签。

## 7. 未验证与边界

未跑完整 `npm run check`、未触真实模型/凭据/用户根、未审 `572f301` 记录文字以外内容；`check:structure` 在导出树因缺 `vendor/pi` 前置有 25 条环境性违规（0 触及受审文件），未在备齐前置的树重跑；日期审、来源缓存审、回执修订按已派继续，不预签。原始证据 `build/mayne24-s2client-review/evidence/`（gitignored）：identity.txt、baseline-prefix-red.tap、locked-35.tap、gate-47.tap、m1a/m1b/m2/m3、vacuity 两轮、c1-failure-registry.txt、c2-fixture-legality.tap、run-all.sh（全部 stderr 留档）。
