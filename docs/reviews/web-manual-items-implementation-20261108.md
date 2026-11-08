# W1 手工事项纵向：生产实现交付（Task I，Claude）

> 状态：**候选实现（candidate）**，未集成、未独立审查、未签准出。本文记录 MAYNE-23 Task I 的交付事实、精确哈希、可复核命令与未验项；集成与最终门禁由队长按精确版本另行派发。
> 依据：[手工事项纵向契约](../engineering/web-manual-items-contract.md)（SHA-256 `8d7529531e7e5c53a3d195fa20f376a2b72d400e0ce8114b8c8ccc3b17b70e8d`）、[授权差异提案](web-manual-items-authorization-20261108.md)（SHA-256 `452dc4366b3d56f269f6864d372d5942727e4f48ad1e371edeb97628a19e8c0f`）、P1 ZCode R2 `c0f88f6`、P2 OhMyPi `f031e21`。

## 1. 基点与写入范围

- 工作树：`agent/claude/mayne-23`，HEAD `bc4b1c38919165c01b31f48eb63ccc1ba4a56e93`（基线提交）。
- 基点核对：`65469904d8baddde738646dfed3bf4a921f47b68` 是 HEAD 的祖先；HEAD/基点 tree 均为 `7b71cdb36888dd1e2955cfa566d2ca606670d4bf`（实测相等）。
- 冻结输入：`001_web_backend.sql` `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d`、`web-api-contract.md` `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`，均未改动。
- 写入范围严格限于任务描述的 Task I 清单；未改 `package.json`、`scripts/build/`、`scripts/checks/`、`docs/engineering/`、契约/授权文档、II 的三个 integration 文件与夹具目录。

## 2. 交付文件与 SHA-256

### 新增生产代码

| 文件 | SHA-256 |
|---|---|
| `server/entries/web-backend-entry.mjs` | `bff28c8749e9268e58a078c04104d2197a8f2760c37f4737a849da87fc2cca91` |
| `server/lib/http-server.mjs` | `ae4287bee7649e870793b6ca2f0d20b8e743aaa5ea4ff8c068c5dcbaf308779e` |
| `server/lib/manual-items-service.mjs` | `c4e4da19f431884053d8fedc2d50fec3583fae57374d4288631ad7189cd2735d` |
| `server/lib/session-store.mjs` | `9823db95128835c84f77a35eea68f9fbd63173f9f18156fc8c8f94059609fc1e` |
| `server/lib/sse-hub.mjs` | `f49951aa6fbcc9f6e3ba67b5f70fff8ce2ebbebd47036909c54379fdf189ceea` |
| `server/lib/static-files.mjs` | `3c07b73eb6be8af6ee903b257d49178735c3f59a6dffb2437a84ee63975251ac` |
| `server/lib/storage-client.mjs` | `c721fc110b1fc96269dea96b1065ada098383fa07d43ce5ac916a3120410bcbe` |
| `src-tauri/migrations/web-backend/002_manual_items.sql` | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` |
| `src-tauri/src/store/web_backend_store.rs` | `5421cbcd8078aba742815d3cc19ca0c3e3d7a9d5dba52f7b11de0275ba0ac757` |
| `src-tauri/src/bin/web-backend-storage.rs` | `71b83d7a240f50c294db3cbdbc312eaa50af8d8cb2e12a3fa7dd268994f40d0a` |
| `src/lib/web-api-client.ts` | `12015d6d921269caadff0ea2573c6f30cc91bffda981712f1ec6ef761d5c0563` |
| `src/stores/pairing.ts` | `9a49150cbca2056aa14373b6c10e51a126cf09f77319e6aebb3a3936ce31b8fa` |
| `src/components/PairingGate.vue` | `405ddcda24ea817021c2e0c406a29fd16067bd0d0130b0623ab99979abfaddb4` |

### 修改文件

| 文件 | SHA-256 | 修改 |
|---|---|---|
| `src-tauri/src/store/local_store.rs` | `97b61662cbcab68a16a39933864402dc52b59db784e5423c21fa76af5055943b` | 登记 `web_backend_store`/`web_backend_store_tests`，未建 `store/mod.rs` |
| `src-tauri/src/store/web_backend_schema.rs` | `73892eb80b8f8625fce5ee06962458c892eef579589c904b72e96b29f78f9259` | `SCHEMA_VERSION` 1→2、追加 `SQL_002`、双迁移故障注入、`conn_mut` |
| `src-tauri/src/store/web_backend_schema_tests.rs` | `560528de8b6ed7db98e2e628b57c0d2c6d55409e62094e1b17d12578ad63b43d` | 13 表、v1 前向迁移回滚用例 |
| `src-tauri/Cargo.toml` | `922938c7d58d86b70b72317d6be7f51b20e358cdd6d292a919c9e1f50dba194a` | 新增 `[[bin]] web-backend-storage`，依赖不动 |
| `src/stores/todos.ts` | `d5e63732e4760a6547f1d3c64f0812206a0014c2e0315648f84e60f30e0c65a0` | 由 Tauri `invoke` 切换到 `WebApiClient` |
| `src/App.vue` | `0a5e760765256a8355d338e17bbffec2ba5fad9115925f948c2b2ee7f820370d` | 默认 surface 经 `PairingGate` 渲染 `Workbench` |
| `tests/integration/desktop-controls.test.mjs` | `2ee8c910c0565ffe7eea2bef0b0da0aebe2e601fc998e05811daa25b0b214632` | 增加 `web-api-client` 别名，保留既有断言意图 |
| `tests/fixtures/desktop-controls/api.ts` | `7e3a65806d10bed4a8e91b3d0cd04772f6e4a53c04b5cfba947e45689377a393` | 提供合成 `WebApiClient`，保持浏览器 seam |

### 测试与证据

| 文件 | SHA-256 |
|---|---|
| `src-tauri/src/store/web_backend_store_tests.rs` | `84c30fc531459f25ab0e873c1109c4917dc44829b118f78b9611172d5c1a8d29` |
| `tests/unit/web-manual-items.test.mjs` | `d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963` |

## 3. 实现要点

- **存储协议**：`web_backend_store.rs` 实现 `init/open/close/backup/transact/query/pragma` 七命令 JSON-line 帧协议；`transact` 单事务原子执行，返回每 op 的 `rows` 与 `changes`。`transact` 仅接受参数化 `INSERT/UPDATE/DELETE/REPLACE`，目标限 `manual_items`/`manual_item_events`；`query` 仅读；`pragma` 仅白名单只读事实。二进制掩码屏蔽字符串/注释后做关键字判定，防止值文本伪装语句。
- **根锁**：`<root>/.web-backend-lock` 咨询式整文件锁，连接先于锁释放（字段顺序 + 显式 close 顺序），stdin EOF 退出码 0。
- **schema**：`SCHEMA_VERSION=2`，`migrations()` 为 `[001, 002]`；故障注入在 002 之后，验证 v1 前向迁移失败整体回滚（`rusqlite_migration` 对全部待应用迁移使用单事务，新库回滚到空白）。
- **HTTP**：`node:http` 零依赖路由；`/api` 前缀；配对码仅请求体、单次有效、10 分钟过期、失败限速；会话 HttpOnly/SameSite=Strict cookie；写请求校验会话 + `X-CSRF-Token` + 精确 `Host`/`Origin`；错误包络 `web-api/1`。
- **事项服务**：创建/更新/完成/重开/删除均单事务（条件更新 + 历史插入）；`operationId` 幂等重放先于状态/版本守卫；同 ID 不同规范输入 409；`expectedVersion` 条件更新影响行数校验；软删后详情/历史可读、变更一律 409。
- **SSE**：`stream.ready`（无 id）+ `item.changed`（无 id、不计任务 cursor）；心跳注释行。
- **静态**：同源 `dist/`，MIME/缓存/SPA fallback，`/api` 不 fallback。
- **前端**：`WebApiClient` 承担 CSRF/错误包络/线格式↔领域转换；`todos.ts` 保留 `createTodoModel` 与 `src/domain/todos.ts` 纯逻辑；`PairingGate` 无会话时显示配对码，配对后渲染默认 surface，并把 SSE 提示接到 `store.refresh()` 读回补偿。

## 4. 聚焦验证（实际执行）

| 命令 | 结果 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_store -- --test-threads=1` | 11/11 pass |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib web_backend_schema -- --test-threads=1` | 18/18 pass |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | exit 0 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | exit 0 |
| `node --test tests/unit/web-manual-items.test.mjs` | 10/10 pass |
| `node build/web-manual-items-implementation/smoke-server.mjs` | 创建/重放/列表/更新/完成/历史/删除/删除后变更 409/CSRF 403/静态/index.html/API 404/优雅关闭全部符合预期 |
| `node build/web-manual-items-implementation/smoke-restart-sse.mjs` | 观察到 `stream.ready` 与 `item.changed`；关闭后重开（`initialize=false`）事项与历史逐条恢复 |
| `node build/web-manual-items-implementation/smoke-kill.mjs` | SIGKILL 存储子进程后重开，已提交事项仍在（WAL） |

原始日志：`build/web-manual-items-implementation/{focused-verification,smoke-server,smoke-restart-sse,smoke-kill}.txt`（本机证据目录，不入库）。

## 5. 未验项与集成依赖（注册，非缺陷）

1. **III 的守卫/构建接入尚未落地**：`server/` 与 `src-tauri/src/bin/` 目前会被 `check-structure.mjs` 的 `top.dir`/`layout.src-tauri-top` 拒绝；`package.json` 的 `build:backend`/`start:backend`/`test:web-manual-items` 与 `scripts/build/build-backend.mjs` 由 III 按授权清单维护。因此本候选**不能**通过完整 `npm run check`；聚焦验证已在上表单独执行。
2. **II 的 HTTP/重启/静态集成测试尚未落地**：本候选的真实 HTTP 调用由 Task I 自己的 smoke 脚本验证（合成根、显式本树 binary/static），未使用设计原型或合成 IPC 代签。
3. **结构检查中的环境性失败**：本工作树存在平台运行时目录 `.claude/` 与 `CLAUDE.md`（非本任务创建，守卫未白名单），以及 `vendor/pi` 未构建导致的 3 条 `ref.missing`；这些与本候选无关，需在集成环境按实际状态处理。
4. **未验边界**：Linux/代理部署、真实凭据/用户工作根/模型、push 与发布仍未授权，不在本切片验收范围；浏览器同源 UI 的 Playwright 矩阵由 II 在候选齐备后执行。
5. **独立审查**：本增量由未参与实现的 ZCode 承担（队长按精确版本派发）；作者不自签 APPROVE。


## 6. 2026-11-08 接口补充裁定增量

依据任务描述 §「2026-11-08 接口字面名与列表参数协调裁定」，在 Task I 服务与必要单测范围内落实：

- **参数拒绝**：`manual-items-service.mjs` 新增 `parseLimit` 与 `ALLOWED_STATUSES`。列表/历史 `limit` 缺省 50；显式值必须是 1–200 整数，否则 400 `validation_failed`（不再静默截断/回退）。列表 `status` 缺省 open+completed；显式未知值返回 400 `validation_failed`。
- **标准线格式核对**：`POST /api/pair` 仅接受请求体 `pairingCode`（移除 `code`/`pairing_code` 别名兜底）；配对与 `GET /api/session` 响应顶层 `csrfToken`；写请求读取 `X-CSRF-Token`（HTTP 头名大小写不敏感）。浏览器客户端 `web-api-client.ts` 已使用同一字面名，无需改动。

**本增量文件 SHA-256**
- `server/lib/manual-items-service.mjs`：`c4e4da19f431884053d8fedc2d50fec3583fae57374d4288631ad7189cd2735d`（§12 MINOR-1 回转校验后更新）
- `server/lib/http-server.mjs`：`ae4287bee7649e870793b6ca2f0d20b8e743aaa5ea4ff8c068c5dcbaf308779e`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`

**本增量聚焦验证（实跑）**
- `node --test tests/unit/web-manual-items.test.mjs`：11/11 pass（新增「list rejects unknown status and invalid limit」）。
- 真实 HTTP smoke（`build/web-manual-items-implementation/smoke-params.mjs`）：`{code}` 别名 → 401 `pair_code_invalid`；`{pairingCode}` → 200 且顶层 `csrfToken`；`status=bogus`/`status=` → 400；`limit=0/201/1.5/abc/空` → 400；`limit=50/200` 与 `status=open/completed/deleted/all` → 200。
- Rust 侧未改动，沿用 `74c023c` 的 11/11 与 18/18、clippy/fmt 结论。


## 7. 2026-11-08 MAJOR-1 退修增量（事务内门控 + 幂等键绑定）

依据 ZCode 对 `74c023c` 的独立审查（MAJOR-1）与任务描述 OBS-2 统一裁定，在 Task I 服务/必要单测范围内修订：

- **MAJOR-1（事务内门控）**：`updateItem` 与 `transitionItem` 的历史插入改为 `INSERT … SELECT … WHERE (SELECT changes()) = 1`（`INSERT_EVENT_GATED`）。条件更新影响 0 行时事件行**不写入**，败者不留幽灵历史、不占幂等键；成功路径事件照常落库。校验从 `results[0].changes` 改为 `results[1].changes`（事件插入行数）。
- **OBS-2（幂等键绑定动作与目标事项）**：规范输入纳入 `action` 与 `itemId`——create `{action:'create',input}`；update `{action:'update',itemId,expectedVersion,input}`；complete/reopen/delete `{action,itemId,expectedVersion}`。跨动作/跨事项复用同一 operationId 返回 409 `idempotency_conflict`；同意图重放优先守卫、返回当前权威状态不变；不改 DDL/stdio 协议或域内命名空间。
- **CLI MINOR-1**：`parseArgs` 改为逐旗标解析，`--init` 作为布尔开关不再吞相邻旗标或末位失效；`isDirectRun` 两侧用 `realpathSync` 解析符号链接，经 `/tmp` 符号链接调用也能正常执行。

**本增量文件 SHA-256**
- `server/lib/manual-items-service.mjs`：`c4e4da19f431884053d8fedc2d50fec3583fae57374d4288631ad7189cd2735d`（§12 MINOR-1 回转校验后更新）
- `server/entries/web-backend-entry.mjs`：`bff28c8749e9268e58a078c04104d2197a8f2760c37f4737a849da87fc2cca91`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`

**本增量聚焦验证（实跑）**
- `node --test tests/unit/web-manual-items.test.mjs`：14/14 pass。新增「failed concurrent writes leave no event and keep the operationId free」对 update/complete/reopen/delete 四条写路径做确定性竞争（败者事务内先注入胜者提交，再执行败者事务）：败者 409 `version_conflict`、无事件行、以原 operationId＋新版本重试成功。新增「idempotency key binds action and item across reuse」验证跨事项/跨动作复用 409、同意图重放 `replayed:true`。新增 `parseArgs` 用例。
- 真实 HTTP（`build/web-manual-items-implementation/smoke-major1-http.mjs`）：create 200→update 200→stale update 409（历史无该操作）→同 operationId 新版本重试 200→complete 200；跨事项复用 409 `idempotency_conflict`；历史仅含成功事件。
- CLI（`build/web-manual-items-implementation/smoke-cli.mjs`）：无 `--init` 打开不存在根 exit 1「工作目录不存在」；经符号链接无参调用 exit 1「--root 必须显式给定」；`--init` 居中/末位均正常启动并建库；缺值 exit 1「参数 --root 缺少值」。
- Rust 侧未改动：store 11/11、schema 18/18、clippy `-D warnings`、`cargo fmt --check` 全绿；冻结 `001`/`002`/`web-api/1` 哈希逐字节不变。


## 8. 2026-11-08 类型映射退修增量（最终门禁 typecheck 拦截）

依据集成门禁 `a02bfef` 的 typecheck 失败回执（三处 TS 错误均在候选 I `src/lib/web-api-client.ts`），仅在该文件与必要单测范围内修订：

- **精度映射**：新增 `toDomainPoint`，把线格式 `'minute'` 映回域缺省（`precision: undefined`），`'day'` 保留为 `'day'`；`fromWireItem` 的 `due`/`followup` 改用它。域 `TimePoint.precision?: 'day'` 不变。
- **source 映射**：W1 为 manual-only（冻结 002 DDL `CHECK (source IN ('manual'))`），`fromWireItem` 直接映到域 `'manual'`，不再与 `'signed_ai'` 做无重叠比较；线类型 `WireItem.source: 'manual'` 不变，未拓宽域/协议，未用 `any` 或强制断言。
- **CLI MINOR-1**：见 §7（本增量未再改 CLI）。

**本增量文件 SHA-256**
- `src/lib/web-api-client.ts`：`12015d6d921269caadff0ea2573c6f30cc91bffda981712f1ec6ef761d5c0563`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`

**本增量聚焦验证（实跑）**
- `npm run typecheck`（`vue-tsc --noEmit`）：exit 0（门禁失败的三个 TS 错误已消除）。
- `node --test tests/unit/web-manual-items.test.mjs`：16/16 pass。新增「wire↔domain time mapping keeps minute default and day precision」（分钟→undefined、日→day、null→null、往返稳定）与「fromWireItem maps due/followup and source per the manual wire format」（due 分钟缺省、followup 日精度、source=manual、空时点保持 null）。
- Rust 侧本增量未改动：store 11/11、schema 18/18、clippy `-D warnings` exit 0、`cargo fmt --check` exit 0；冻结 `001`/`002`/`web-api/1` 哈希逐字节不变。


## 9. 2026-11-08 desktop-controls alias 精确匹配退修增量

依据集成第二轮门禁第 11 组 `test:desktop-controls` 的失败回执，仅改 `tests/integration/desktop-controls.test.mjs` 的 alias：

- **原问题**：`{find:/web-api-client/, replacement:<fixture>/api.ts}` 为无锚点子串正则。Vite 的 alias 按子串替换，`'../lib/web-api-client.ts'` 被替换为 `'../lib/<fixture>/api.ts.ts'`，残留 `../lib/` 前缀与 `.ts` 后缀，构建期报 `[UNLOADABLE_DEPENDENCY] Could not load ../lib/.../api.ts.ts`，9/9 用例挂于 `before`。
- **修复**：改为对实际完整模块标识的精确匹配 `{find:/^\.\.\/lib\/web-api-client\.ts$/, replacement:<fixture>/api.ts}`，只匹配 `src/stores/todos.ts`／`src/stores/pairing.ts` 实际使用的 `'../lib/web-api-client.ts'`，不扩大到无关模块。生产导入无需改写；fixture seam `api.ts` 未提供 `WebApiClient` 的既有导出已满足该标识。

**本增量文件 SHA-256**
- `tests/integration/desktop-controls.test.mjs`：`2ee8c910c0565ffe7eea2bef0b0da0aebe2e601fc998e05811daa25b0b214632`

**本增量聚焦验证（实跑）**
- `npm run test:desktop-controls`：**exit 0，9/9 pass**（1440/640 controls＋workbench today/inbox/all，断言意图与 30000ms 预算未动）。
- **旧/新映射真实 fixture 构建对照**：同一测试文件仅替换 alias，旧 `/web-api-client/` → **exit 1，9 tests／0 pass／9 fail**，错误与集成回执逐字同构（`Could not load ../lib/.../api.ts.ts`）；新锚定 alias → **exit 0，9/9 pass**。
- `npm run typecheck`：exit 0；`node --test tests/unit/web-manual-items.test.mjs`：16/16 pass；`git diff --check`：exit 0。
- Rust／服务端／II／III 文件零改动；冻结 `001`/`002`/`web-api/1` 哈希逐字节不变。


## 10. 2026-11-08 manifest default-run 消歧增量

依据集成第三轮门禁第 47 组 `check:s33-p2-package` 的失败回执，仅改 `src-tauri/Cargo.toml`：

- **原问题**：候选 I 已批变更 C 追加 `[[bin]] web-backend-storage` 后，包内有两个 bin 且无 `package.default-run`；`tauri build` 报 `failed to find main binary, make sure you have a 'package > default-run' in the Cargo.toml file`。
- **修复**：在 `[package]` 追加 `default-run = "sidekick"`，明确主二进制仍为 `src/main.rs` 隐式 `sidekick`；`web-backend-storage` 仍显式构建。未改其余 manifest/锁/标识。

**本增量文件 SHA-256**
- `src-tauri/Cargo.toml`：`922938c7d58d86b70b72317d6be7f51b20e358cdd6d292a919c9e1f50dba194a`

**本增量聚焦验证（实跑，日志在 `build/`）**
- **真实完整 `npm run check:s33-p2-package`**：**exit 0**（`build:s33-ui-verify`→`probe:app`→`test:s33-ui-artifacts` 2/2；Tauri 真实打包产出 `Sidekick.app`，ad-hoc 签名成功）。
- **显式存储二进制仍可构建**：`cargo build --bin web-backend-storage` exit 0。
- **旧/新对照**：仅移除 `default-run`（及注释）后 `node scripts/build/build-app.mjs tests/fixtures/s33-ui-verify.config.json` → **exit 1**，报 `failed to find main binary, make sure you have a 'package > default-run' in the Cargo.toml file`；恢复后 `check:s33-p2-package` exit 0。
- `git diff --check` exit 0；`npm run typecheck` exit 0；冻结 `001`/`002`/`web-api/1` 哈希逐字节不变。


## 11. 2026-11-08 时间线格式与 SSE epoch 退修增量（F-1/F-2/F-4）

依据集成第四轮门禁第 51 组的三项候选 I 失败（F-1/F-2/F-4），沿原 I 服务/SSE/单测范围修订：

- **F-1（严格 ISO）**：`normalizePoint` 不再用裸 `Date.parse` 接受非 ISO 字符串；`at` 必须匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（契约 §4.2 ISO 8601 UTC 毫秒），否则 400 `validation_failed`。
- **F-2（结构化本地时刻存在性/显式 instant）**：复用 `shared/dates.mjs::zonedCandidates`——当 `precision=minute` 且 `localText` 为 `YYYY-MM-DD[T ]HH:mm` 结构时，本地时刻无候选（夏令时空缺）即拒，`at` 不在候选集内（含回落歧义未选显式 instant）即拒。自由表达（如「周五下午」）保留原文、不在服务端解析。
- **F-4（SSE epoch 语义）**：`sse-hub.mjs` 读取 `Last-Event-ID`；令牌 epoch ≠ 当前实例、格式非法或游标超窗口时，先发 `stream.reset`（`{contractVersion, epoch, reason}`，无 id），再发 `stream.ready`。事项帧仍无 id、不占任务 cursor。客户端 `pairing.ts` 已监听 `stream.reset`／`stream.ready`／`item.changed` 触发读回补偿。

**本增量文件 SHA-256**
- `server/lib/manual-items-service.mjs`：`c4e4da19f431884053d8fedc2d50fec3583fae57374d4288631ad7189cd2735d`（§12 MINOR-1 回转校验后更新）
- `server/lib/sse-hub.mjs`：`f49951aa6fbcc9f6e3ba67b5f70fff8ce2ebbebd47036909c54379fdf189ceea`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`

**本增量聚焦验证（实跑，日志在 `build/`）**
- `node --test tests/unit/web-manual-items.test.mjs`：**20/20 pass**。新增：非 ISO `at` 拒绝；纽约夏令时空缺（2026-03-08 02:30）拒绝、回落歧义未选显式 instant 拒绝、歧义显式选 05:30Z 接受、自由表达保留原文；SSE 旧 epoch → `stream.reset`+`stream.ready`，同 epoch 无 token → 仅 `stream.ready`，游标超窗口/格式非法 → reset；`item.changed` 无 `id` 行；`pairing.ts` 在 `stream.ready`/`stream.reset`/`item.changed` 均触发读回刷新。
- 真实 HTTP（`smoke-time-sse.mjs`）：非 ISO → 400；夏令空缺 → 400；时刻不一致 → 400；歧义显式 → 200；自由表达 → 200 且 `localText='周五下午'`；旧 epoch 订阅 → `stream.reset`+`stream.ready`；`item.changed` 帧无 `id`。
- `npm run typecheck` exit 0；`cargo clippy -D warnings`、`cargo fmt --check` exit 0；`git diff --check` exit 0；冻结 `001`/`002`/`web-api/1` 哈希逐字节不变。


## 12. 2026-11-08 最小启动契约增量（BLOCKER-1/2 + MINOR-1）

依据浏览器原样验收的两处阻断与任务描述新增的「最小启动契约」，沿原 I 前端/服务/单测范围修订：

- **共享客户端（BLOCKER-2）**：`web-api-client.ts` 新增 `getWebApiClient()` 懒加载单例；`pairing.ts`／`todos.ts` 生产默认使用它，配对/会话读回的 CSRF 供事项与设置写入复用。构造器/工厂仍保留显式注入。
- **设置接线（BLOCKER-1）**：`settings.ts` 改走真实 HTTP（`GET/PUT /api/settings/application`），版本随读取快照传递，保存用该快照版本做 CAS；只有成功读回才 ready。新增 `server/lib/application-settings-service.mjs`：复用冻结 001 的 `settings(key,value,version)` 表，仅 `application.timeZone` 一个 key；无保存值时以实例 OS 默认时区返回 `version=0` 且 GET 不写库；首次写创建 v1，随后参数化 CAS 递增，冲突 409 `version_conflict`，非法参数 400 `validation_failed`。
- **Rust 写权限**：`web_backend_store.rs` 的 `transact` 新增 `settings` 写范围，**仅限** `application.timeZone` 字面量的 INSERT/UPDATE CAS 形状；其他 key、DELETE、DROP 等一律拒绝。未放宽任意 settings 或 task 表写入；七命令 stdio、001/002、依赖/锁/标识、旧库均不变。
- **浏览器能力守卫（BLOCKER-1）**：新增 `src/domain/capabilities.ts::nativeBridgeAvailable()`；`Workbench.vue` 仅在原生桥可用时加载 models/agents/skills/profile/organizer 与轮询/监听，浏览器下禁用「待确认」导航与「文本智能整理」入口；`SettingsPanel.vue` 的模型/智能体/工具面板与 `TodayAdvice.vue` 的生成按钮显示准确「未接通」状态。未扩迁模型系统，未伪造配置成功。
- **MINOR-1（UTC instant 日历回转）**：`normalizePoint` 在 ISO 解析后校验 `new Date(atMs).toISOString() === raw`，拒绝 `2026-02-30…`、`24:00…`、月份 13 等自动滚动值；有效闰日/普通日期与自由表达、day 语义不变。

**本增量文件 SHA-256**
- `src/lib/web-api-client.ts`：`12015d6d921269caadff0ea2573c6f30cc91bffda981712f1ec6ef761d5c0563`
- `src/stores/settings.ts`：`cf39a03a19411acbde8302ac549b43a864aed5b0c273475067ca04aba1b95c5f`
- `src/stores/pairing.ts`：`9a49150cbca2056aa14373b6c10e51a126cf09f77319e6aebb3a3936ce31b8fa`
- `src/stores/todos.ts`：`d5e63732e4760a6547f1d3c64f0812206a0014c2e0315648f84e60f30e0c65a0`
- `src/lib/host-capabilities.ts`：`ba482b81ec5078b9d369f55781e7bc6e82604030021ffdc912fd038613433738`
- `src/components/Workbench.vue`：`0d4e81a7d141a337f1a1930683d8386d94ac3a99851fadbf70d2d7c39491ce53`
- `src/components/SettingsPanel.vue`：`0b8a013ab4ee97322d7d2b6b18850e1d1a411d0fef48f533c938b23429d3b70d`
- `src/components/TodayAdvice.vue`：`78ee7a2f4588a8d929b7b49caf311286932e12b4afea081159c670a2741cf825`
- `server/lib/application-settings-service.mjs`：`b9add2f41b39c46bee32f53837e1b2de659148d48cb7a60b668358a2a4c2ccbf`
- `server/lib/http-server.mjs`：`ae4287bee7649e870793b6ca2f0d20b8e743aaa5ea4ff8c068c5dcbaf308779e`
- `server/entries/web-backend-entry.mjs`：`bff28c8749e9268e58a078c04104d2197a8f2760c37f4737a849da87fc2cca91`
- `src-tauri/src/store/web_backend_store.rs`：`5421cbcd8078aba742815d3cc19ca0c3e3d7a9d5dba52f7b11de0275ba0ac757`
- `src-tauri/src/store/web_backend_store_tests.rs`：`84c30fc531459f25ab0e873c1109c4917dc44829b118f78b9611172d5c1a8d29`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`
- `tests/fixtures/desktop-controls/api.ts`：`7e3a65806d10bed4a8e91b3d0cd04772f6e4a53c04b5cfba947e45689377a393`

**本增量聚焦验证（实跑，日志在 `build/`）**
- `node --test tests/unit/web-manual-items.test.mjs`：**25/25 pass**（含设置服务默认/CAS/校验、共享客户端单例与 CSRF 传递、MINOR-1 回转拒绝）。
- 真实 HTTP（`smoke-settings-csrf.mjs`）：GET 缺省 v0 不写库；PUT 首次 v1；陈旧版本 409；CAS 成功 v2；错 CSRF 403；非法时区 400；共享 CSRF 创建事项 200；同根重启后时区/版本持久。
- `cargo test --lib web_backend_store` 12/12（含 settings 写范围正负例）、`web_backend_schema` 18/18；`cargo clippy -D warnings`、`cargo fmt --check` exit 0。
- `npm run typecheck` exit 0；`npm run test:desktop-controls` 9/9 pass（fixture 仅补 desktop bridge seam，断言/预算未动）。
- 冻结 `001`/`002`/`web-api/1` 哈希逐字节不变；未改依赖/锁/标识。


## 13. 2026-11-08 归位修正（capabilities 路径）

按任务描述新增的归位登记，仅做路径/证据修正：

- `src/domain/capabilities.ts` 原样移到 `src/lib/host-capabilities.ts`（内容逐字节不变，SHA-256 `ba482b81ec5078b9d369f55781e7bc6e82604030021ffdc912fd038613433738`）；删除未获批的 `src/domain/` 新文件。
- 更新三处必要引用：`Workbench.vue`／`SettingsPanel.vue`／`TodayAdvice.vue` 的导入改为 `../lib/host-capabilities.ts`。
- 后端字节未动（`server/`、`src-tauri/`、001/002、web-api/1 逐字节不变）。

**聚焦验证（实跑）**：`npm run typecheck` exit 0；`node --test tests/unit/web-manual-items.test.mjs` 25/25 pass；`npm run test:desktop-controls` 9/9 pass；`git diff --check` exit 0。


## 14. 2026-11-08 MINOR-2 收口与启动契约补全（两段独立提交）

**提交 A（`62033e3`）Rust settings 写守卫收紧**：`validate_settings_write` 改为对两条**精确生产模板**（`INSERT INTO settings(key,value,version)VALUES('application.timeZone',?,1)` 与 `UPDATE settings SET value=?,version=version+1 WHERE key='application.timeZone' AND version=?`）做规范化逐字比对（去注释、折叠空白、保留 key 字面量大小写/空白）。关闭 MINOR-2：`INSERT…SELECT`、多行 VALUES、`OR` 放大谓词、重写 key、把字面量塞进无关列一律拒绝；错版本不改动任何行；生产首次写/CAS 与手工事项写仍通。

**提交 B（`7fce144`）前端启动契约补全**：
- **MAJOR-1**：恢复 `createApplicationSettings(api: Backend)` 命令式注入边界（`read_application_settings`／`save_application_settings`），生产默认接共享客户端 `asBackend()`；版本仍随读取快照传递并用于 CAS。原 layout-domain 十四用例/注入及 CAS、未知结果、重读断言保留。
- **能力守卫**：`watch(page→today)`、`readWindowFacts()` 与 `App.vue` 的 `desktopPreferences.start()` 均尊重 `nativeBridgeAvailable()`；设置面板对未接通原生面板的守卫准确。
- **会话失效**：共享客户端在会话内 401/登出时清 CSRF、置配对态为未配对、关闭 SSE 并回到配对门，不只在 fresh-load 生效。

**本增量文件 SHA-256**
- `src-tauri/src/store/web_backend_store.rs`：`5421cbcd8078aba742815d3cc19ca0c3e3d7a9d5dba52f7b11de0275ba0ac757`
- `src-tauri/src/store/web_backend_store_tests.rs`：`84c30fc531459f25ab0e873c1109c4917dc44829b118f78b9611172d5c1a8d29`
- `src/lib/web-api-client.ts`：`12015d6d921269caadff0ea2573c6f30cc91bffda981712f1ec6ef761d5c0563`
- `src/stores/settings.ts`：`a61a844c6a8e219a25988d33e397e7da6edc2e8c414f2da2d57b0afaefd19f01`
- `src/stores/pairing.ts`：`9a49150cbca2056aa14373b6c10e51a126cf09f77319e6aebb3a3936ce31b8fa`
- `src/components/Workbench.vue`：`1ab0858dec5afa864a018a8eaec5d2c45d529ab2dfd34d7bf7dd6d0ff3d50c4a`
- `src/App.vue`：`0a5e760765256a8355d338e17bbffec2ba5fad9115925f948c2b2ee7f820370d`
- `tests/unit/web-manual-items.test.mjs`：`d730e933f3b3088eb1618f98a998c3eb598ad4bdd2aa3e01f7de0618779d4963`

**聚焦验证（实跑，日志在 `build/`）**
- Rust：`cargo test --lib web_backend_store` 12/12（含 MINOR-2 六类对抗 + 错版本零改动 + 空白变体放行）、`web_backend_schema` 18/18、`cargo clippy -D warnings`、`cargo fmt --check` exit 0。
- 真实 stdio 对抗（真实二进制）：生产 INSERT 模板放行；`INSERT…SELECT`／多行 VALUES／`OR 1=1`／重写 key（大小写）／字面量错列／他 key／DELETE／DROP／多语句全部 `WEB_BACKEND_SQL_DENIED`；终态恰一行 `application.timeZone`。
- 真实 HTTP：生产首次写 v1、CAS v2 均 200（收紧后生产 SQL 仍被接受）。
- 前端：`node --test tests/unit/web-manual-items.test.mjs` 27/27（含会话内 401 清共享 CSRF、配对态回门）；`npm run test:layout-domain` 14/14；`npm run test:desktop-controls` 9/9；`npm run typecheck` exit 0。
- 冻结 `001`/`002`/`web-api/1` 哈希逐字节不变；未改依赖/锁/标识。
