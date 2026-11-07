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
| `server/entries/web-backend-entry.mjs` | `776b9b39b72994106abdf0e71d570347d8c9af6a18c78f56c0caf6e289b44797` |
| `server/lib/http-server.mjs` | `f4d80e628e863a752848b65e503a14b66e4318a649b088324d5f42cf84ac9ab8` |
| `server/lib/manual-items-service.mjs` | `3742c994aa035a2c1cd1ca2880ad32efa1668d0524764a10ab8f01d1244ba7c8` |
| `server/lib/session-store.mjs` | `9823db95128835c84f77a35eea68f9fbd63173f9f18156fc8c8f94059609fc1e` |
| `server/lib/sse-hub.mjs` | `174507c6ce2e36016013546473cdc19b6678799ca38e33bb06f2092840006ade` |
| `server/lib/static-files.mjs` | `3c07b73eb6be8af6ee903b257d49178735c3f59a6dffb2437a84ee63975251ac` |
| `server/lib/storage-client.mjs` | `c721fc110b1fc96269dea96b1065ada098383fa07d43ce5ac916a3120410bcbe` |
| `src-tauri/migrations/web-backend/002_manual_items.sql` | `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` |
| `src-tauri/src/store/web_backend_store.rs` | `5041d337285f6365de5893741aa36662b56c8188cea310f8c991b89898382542` |
| `src-tauri/src/bin/web-backend-storage.rs` | `71b83d7a240f50c294db3cbdbc312eaa50af8d8cb2e12a3fa7dd268994f40d0a` |
| `src/lib/web-api-client.ts` | `678b118e71dd7bcce6efd359cb903b2e733e1f1fb6d71e11e5033884836175f5` |
| `src/stores/pairing.ts` | `dfb824a9916e4cc8d7a2f89865d0e85e93a11569e96a34dc76d40844354cbddc` |
| `src/components/PairingGate.vue` | `405ddcda24ea817021c2e0c406a29fd16067bd0d0130b0623ab99979abfaddb4` |

### 修改文件

| 文件 | SHA-256 | 修改 |
|---|---|---|
| `src-tauri/src/store/local_store.rs` | `97b61662cbcab68a16a39933864402dc52b59db784e5423c21fa76af5055943b` | 登记 `web_backend_store`/`web_backend_store_tests`，未建 `store/mod.rs` |
| `src-tauri/src/store/web_backend_schema.rs` | `73892eb80b8f8625fce5ee06962458c892eef579589c904b72e96b29f78f9259` | `SCHEMA_VERSION` 1→2、追加 `SQL_002`、双迁移故障注入、`conn_mut` |
| `src-tauri/src/store/web_backend_schema_tests.rs` | `560528de8b6ed7db98e2e628b57c0d2c6d55409e62094e1b17d12578ad63b43d` | 13 表、v1 前向迁移回滚用例 |
| `src-tauri/Cargo.toml` | `99ac5709c7eb86cf0d5eda4c522e28969cf0d0339b95d70fac81c02f0f4e3093` | 新增 `[[bin]] web-backend-storage`，依赖不动 |
| `src/stores/todos.ts` | `8b48f47db2326ac3872cec10b02518a4927a7e293ec61251dacc7f55b4dd034b` | 由 Tauri `invoke` 切换到 `WebApiClient` |
| `src/App.vue` | `8c2a04f18c1e6c1bf900a38000217104720e2c3e8793625e927be802bb1165f5` | 默认 surface 经 `PairingGate` 渲染 `Workbench` |
| `tests/integration/desktop-controls.test.mjs` | `74b240d60a7f0a984ac9ca6798e3580ab21a58d8b0ffe8970ebc8c03a34fc27f` | 增加 `web-api-client` 别名，保留既有断言意图 |
| `tests/fixtures/desktop-controls/api.ts` | `5872b710f951ce3b6baa2239a5f178672d71896842f3d0f83b5d91d042b72810` | 提供合成 `WebApiClient`，保持浏览器 seam |

### 测试与证据

| 文件 | SHA-256 |
|---|---|
| `src-tauri/src/store/web_backend_store_tests.rs` | `5b371d0826dd2ba3946353619da4682e90b00bdf32139c95d3eaaf3936a745be` |
| `tests/unit/web-manual-items.test.mjs` | `d9bc844696108b84ee25421c296b7b8420ffd0748bd4e119704021ff0e242dce` |

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
- `server/lib/manual-items-service.mjs`：`3742c994aa035a2c1cd1ca2880ad32efa1668d0524764a10ab8f01d1244ba7c8`
- `server/lib/http-server.mjs`：`f4d80e628e863a752848b65e503a14b66e4318a649b088324d5f42cf84ac9ab8`
- `tests/unit/web-manual-items.test.mjs`：`d9bc844696108b84ee25421c296b7b8420ffd0748bd4e119704021ff0e242dce`

**本增量聚焦验证（实跑）**
- `node --test tests/unit/web-manual-items.test.mjs`：11/11 pass（新增「list rejects unknown status and invalid limit」）。
- 真实 HTTP smoke（`build/web-manual-items-implementation/smoke-params.mjs`）：`{code}` 别名 → 401 `pair_code_invalid`；`{pairingCode}` → 200 且顶层 `csrfToken`；`status=bogus`/`status=` → 400；`limit=0/201/1.5/abc/空` → 400；`limit=50/200` 与 `status=open/completed/deleted/all` → 200。
- Rust 侧未改动，沿用 `74c023c` 的 11/11 与 18/18、clippy/fmt 结论。
