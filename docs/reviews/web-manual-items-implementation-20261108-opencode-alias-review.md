# W1 desktop-controls alias 修复增量独立审查（OpenCode，2026-11-08）：通过

- 审查对象：`ff5d6c24e1a8c4ad006ad52532b64fdf47f7c064..91b78ede9f072598b7879aa461cdc03625ac1ccf`（Claude 的 Task I alias 精确匹配退修，父提交即 `ff5d6c2`）。
- 判定依据：集成第二轮回执 §8.3 的失败归因（无锚点子串 alias 拼出 `../lib/<abs>api.ts.ts`）与队长派审要求（评论 `01a1b8b2-5714-72ea-98eb-50045bb6a60a`）。
- 审查者：OpenCode（III 工程作者兼唯一集成者；本 alias 增量未参与编写——增量交付与提交均由 I 作者 Claude 完成，`91b78ed` 提交者即其树，无利益冲突）。
- 边界：只审本增量；候选只读（`git archive` 导出至沙箱临时树＋共享 node_modules，全程不改候选）；不代修、不豁免守卫、不改 I/II/III 交付字节；完整重门禁不在本审查内（审查通过后由集成轮在同一冻结版本串行执行）。

## 结论：**通过**（0 阻断；0 NIT——本轮申报的身份、范围、断言/预算、动态验证逐项独立复算全部属实）

## 1. 版本与身份（全部实测）

| 项 | 申报 | 实测 | 一致 |
|---|---|---|---|
| `91b78ed` 父提交 | `ff5d6c2` | `ff5d6c24e1a8c4ad006ad52532b64fdf47f7c064` | ✓ |
| `91b78ed` tree | `da4061a74e2578b9a28154c534fefa885bfef547` | 同左（`git log --format=%T`） | ✓ |
| 增量补丁 SHA-256（`git diff ff5d6c2 91b78ed`） | `5a339edc1b5e26c5d8d73690ec70473abd551a48e5217193a0f4a40bc5365ea0` | 同左（逐字节复算） | ✓ |
| 累计补丁 SHA-256（`git diff bc4b1c3 91b78ed`） | `8634afb4…`（截断申报） | `8634afb4796847152e317ce962fec10f74fc7ebb16da77533d13331ed136bae2` | ✓ |
| 链完整性 | 父即 `ff5d6c2`，无 squash/amend/rebase | `git merge-base --is-ancestor ff5d6c2 91b78ed` YES；`6546990` 为 `91b78ed` 祖先 | ✓ |

## 2. 增量构成与写入范围（恰 2 文件，+19/−2）

| 文件 | 变化 | SHA-256（在 `91b78ed` 实测） | 与申报 | 范围 |
|---|---|---|---|---|
| `tests/integration/desktop-controls.test.mjs` | +1/−1，恰一行 alias | `2ee8c910c0565ffe7eea2bef0b0da0aebe2e601fc998e05811daa25b0b214632` | ✓（交付评论与 I 记录 §9 均一致） | I 允许的最小 desktop-controls 适配内 |
| `docs/reviews/web-manual-items-implementation-20261108.md` | +18/−1（哈希表行刷新＋纯追加 §9） | `de9ef7355c77e68d361f65ffc7dfbccac67ccecba96cb980c2e268ee9f2b57fd` | — | I 自有证据路径 |

第 2 文件为 I 自身交付记录的哈希表刷新（旧值 `74b240d6…`→新值 `2ee8c910…`，与两版测试文件实测 blob 逐一相符）与 §9 纯追加，落在 I 允许的 `docs/reviews/web-manual-items-implementation-*.md` 证据范围内；§9 登记的验证声明经本审查独立复跑属实（见 §5）。除这 2 文件外无任何改动：`git diff --numstat ff5d6c2 91b78ed` 仅此 2 行；I 生产文件（`server/`、`src-tauri/`、`src/`）、II 测试、III 工程/公共文件零触碰。

## 3. 映射正确性（静态核验）

- **修复内容**：alias 第二项由无锚点子串正则 `{find:/web-api-client/, replacement:join(fixture,'api.ts')}` 改为对实际完整模块标识的精确匹配 `{find:/^\.\.\/lib\/web-api-client\.ts$/, replacement:join(fixture,'api.ts')}`。vite alias 对正则 `find` 按匹配子串替换——旧写法把 `'../lib/web-api-client.ts'` 中的 `web-api-client` 段替换为 fixture 绝对路径，残留 `../lib/` 前缀与 `.ts` 后缀（＝第二轮回执 §8.3 的失败机制）；新锚定正则整串命中、整串替换，无残留。
- **匹配面恰好闭合、不扩大**：生产源码中 `web-api-client` 导入恰两处——`src/stores/pairing.ts:9` 与 `src/stores/todos.ts:3`，说明符均为 `'../lib/web-api-client.ts'`，与新锚定正则精确对应。单元测试 `tests/unit/web-manual-items.test.mjs:13` 的 `'../../src/lib/web-api-client.ts'` 不匹配该正则（该路径为 Node 直导真实客户端，本就无需 fixture）。基线既有第一 alias（`^@tauri-apps/…$` 锚定）未动。
- **seam 完整**：`tests/fixtures/desktop-controls/api.ts` 导出 `WebApiClient` 合成实现（第 6 行），两条生产导入均可解析。
- **生产导入未为夹具改写**：本增量零改动 `src/`（与第二轮回执“队长已只读核对生产导入无需改写”一致）。

## 4. 断言与预算未动（逐字节核验）

- 测试文件除该一行 alias 外逐字节不变（`git diff` 全文核对）：九用例循环（controls×{1440,640}＋workbench today×{1440,640}＋inbox×{1440,1024,640}＋all×{1440,640}）、`timeout:30000` 逐用例预算与全部断言探测代码原样。
- `package.json` 的 `test:desktop-controls` 脚本（`node --test --test-timeout=30000 …`）在 `ff5d6c2` 与 `91b78ed` 间零改动（`git diff` 为空）；九项用例数量与预算均未动。
- 冻结哈希复核（在 `91b78ed` 实测）：001 `8511907c…143d`、002＝批准 DDL `b6cb8e61…f97e`、web-api/1 `61863271…8f58` 逐字节未变；契约文件（含附录A，`32910de7…`）在候选链中不存在、仅在集成树，本增量零触碰。

## 5. 动态复跑（真实 fixture 构建＋headless Chrome，共享 node_modules）

| 验证 | 树 | 命令 | 结果 |
|---|---|---|---|
| 候选复跑 | `91b78ed` 导出（新锚定 alias） | `npm run test:desktop-controls` | **exit 0：9 tests／9 pass／0 fail**（duration 7.0s；九项全为 ✔，含真实 vite build＋preview＋Chrome 探测） |
| 旧/新映射对照 | 同一导出仅把 alias 换回旧 `/web-api-client/` | 同上 | **exit 1：9 tests／0 pass／9 fail**，`[UNLOADABLE_DEPENDENCY] Could not load ../lib/<abs>/tests/fixtures/desktop-controls/api.ts.ts`（`src/stores/todos.ts:3:30`）——与集成第二轮回执逐字同构，证明该增量正是门禁失败的闭合项 |
| 类型检查 | `91b78ed` 导出 | `npm run typecheck`（vue-tsc --noEmit） | exit 0 |

原始日志：`build/web-manual-items-alias-review/candidate-91b78ed-desktop-controls.log`、`candidate-old-alias-AB.log`、`candidate-91b78ed-typecheck.log`（gitignored，随集成证据包归档哈希）。

## 6. 处置

- 审查通过。按派发授权，集成轮在同一 run 以集成回执 `ecb7804c…` 为基点接入该两文件精确增量（merge 接入、合并前 blob 级预检），冻结新 SHA/tree 后从头串行执行完整 `npm run check`；结果与逐组回执见 `docs/reviews/web-manual-items-integration-20261108.md` §9–§10。
- 本审查不代修、不重开 I/II 任何已审未改结论；`ff5d6c2` 已闭合的三处 TS 错误与 ZCode R1–R3/OhMyPi R1–R2/Kimi 公共审查的原结论全部沿用。
- 未验项：完整重门禁与第 12–51 组在本审查范围内未执行（属集成轮）；Linux/代理、真实凭据/真实用户工作根/真实模型在授权边界外。
