# W1 I 生产实现候选独立审查（ZCode，2026-11-08）

> 结论：**不通过**（限一处 MAJOR，修订后重交；其余增量全部独立核实通过，已验面不需重开）。
> 审查对象：`agent/claude/mayne-23` HEAD `74c023cd6d01feda2b31ab46dc0723117e765473`，基点 `bc4b1c38919165c01b31f48eb63ccc1ba4a56e93`。
> 审查者：ZCode（未参与 I/II/III 实现），按派审线程 `01a1b843-3ccb-7ab4-a194-57d8b72c6a82` 执行。
> 候选只读：全程以 /tmp 临时分离检出阅读与验证，候选树 `git status` 始终干净，审查后工作树已删除。原始证据在本机 `build/web-manual-items-implementation-review/`（gitignored，随本记录列明文件名）。环境：macOS arm64、Node v24.20.0、cargo/rustc 1.89.0。

## 1. 版本与身份（含 tree 陈述矛盾的裁定）

实测（`git cat-file`）：

| 项 | 交付声明 | 实测 | 判定 |
|---|---|---|---|
| HEAD tree | `b08886e0358e1ac1bd74348e06f53c808952d737` | `b08886e0358e1ac1bd74348e06f53c808952d737` | 一致 |
| 基点 | `bc4b1c3` | `bc4b1c38919165c01b31f48eb63ccc1ba4a56e93` | 一致 |
| 基点 tree | — | `7b71cdb36888dd1e2955cfa566d2ca606670d4bf` ＝ 集成基座 `6546990` tree | 一致 |
| 祖先 | `6546990` 是 HEAD 祖先 | `bc4b1c3 → 6546990`，`git merge-base --is-ancestor` 通过 | 一致 |
| 提交链 | — | `74c023c`（收紧 query 为 SELECT＋加固静态流式）→ 父 `da79aed`（纵向实现主体）→ 父 `bc4b1c3` | 两提交增量均在派审范围内 |

**矛盾裁定：陈述笔误，非交付身份问题。** 交付评论中"HEAD/基点 tree 均为 `7b71cdb3…`"一句与同评论上一行的 HEAD tree `b08886e0…` 矛盾；实测证明 `b08886e0…` 才是 HEAD tree，`7b71cdb3…` 是**基点** tree（且＝集成基座 tree）。该句应为"HEAD 的基点（与基点）tree 均为 `7b71cdb3…`"的表述错误。候选本体（基点血缘、tree 身份）与两处自述哈希均正确。

## 2. 补丁与写入范围

- `git diff bc4b1c3 74c023cd` 复算 SHA-256 ＝ `6617112cb52d9bec7ace7ca2a41ff592412ce982f8806157916843d5bcbdd88c`，**与声明逐字节一致**（随附 `i-diff.patch`）。`git format-patch bc4b1c3..74c023cd --stdout`（两提交形式）＝ `cd16a32c0e3cc490079915e008967fcb4959e99c1b83bbf0c5c2040d5e49f5e4`，一并登记供集成轮复算（随附 `i-format-patch.patch`）。`git diff --check` 干净。
- 24 文件 +3259/−17，**逐一对照 I 的唯一写入清单**：server/ 七文件、002 迁移、Rust store/bin/Cargo.toml、前端五文件、`tests/unit/web-manual-items.test.mjs`、desktop-controls 最小适配、`docs/reviews/web-manual-items-implementation-20261108.md` —— 全部在清单内；无 II 的 integration 文件、无 package.json/守卫/构建脚本/公共文档、无 vendor/pi、无锁文件/依赖变更。
- 最小性抽查：`Cargo.toml` 仅新增已批 `[[bin]]`；`local_store.rs` 仅 `#[path]` 模块/测试登记；`todos.ts` 仅把 `invoke` 换成 `new WebApiClient().asBackend()`（`createTodoModel` 与 `src/domain/todos.ts` 未动）；desktop-controls 适配为夹具内合成 `WebApiClient` shim ＋ 一条 alias，既有断言未动。
- 六个关键文件自报 SHA-256 全部实测一致（002／web_backend_store.rs／manual-items-service.mjs／http-server.mjs／web-backend-storage.rs／web-api-client.ts）。

## 3. 冻结哈希

- `002_manual_items.sql` 实测 ＝ `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e` ＝ 批准哈希（＝III 守卫冻结值）；DDL 语义抽查（schema_meta 镜像同事务推进到 2、删除态 CHECK、m6 列表序索引）与批准文本一致。
- `001_web_backend.sql`、`web-api-contract.md`（web-api/1）base 与 HEAD 逐字节不变（`8511907c…`、`61863271…`）。
- 手工事项契约文件不在 I 树中——属 III 写入清单，并行树设计使然，非缺陷（III 候选已另行核实其冻结值 `8d752953…`）。

## 4. 独立复跑（命令与退出码）

环境前置：tauri 构建要求 `../build/s0-runtime`（基线既有 gitignored 资源，候选未改）；从集成基座工作树**只读复制**满足后复跑。

| 命令 | 结果 | 证据 |
|---|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | exit 0 | clippy.log 之外单独运行 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | exit 0 | clippy.log |
| `cargo test --lib web_backend_store -- --test-threads=1` | **11/11**，exit 0 | test-store.log |
| `cargo test --lib web_backend_schema -- --test-threads=1` | **18/18**，exit 0 | test-schema.log |
| `cargo test --lib -- --test-threads=1`（全量回归，因候选动了 local_store 登记） | **323/323**（3 ignored），exit 0，310s | test-full-serial.log |
| `node --test tests/unit/web-manual-items.test.mjs` | **10/10**，exit 0 | test-unit.log |
| `cargo test --lib`（默认并行，本沙箱） | 候选树 23 fail / 基点树 17 fail，失败集合**不同但同族**（agent_config、mcp_calls、mcp_formal、mcp_recovery、today_advice，多为 WORKSPACE_IO） | test-full-lib.log、test-base-par.log |

并行模式说明：基点树同样在并行下非确定性失败同名族测试（基点甚至另有 `local_store::tests::committed_data_recovers_after_abrupt_process_stop` 失败），判定为**本沙箱并行负载的环境性干扰，非候选回归**；候选特有的是 `web_backend_store_tests::open_rejects_missing_root` 一次 `WEB_BACKEND_ROOT_IN_USE`（`acquire_root_lock` 把一切 `try_lock` 错误都映射为占用，见 OBS-3），契约规定的串行执行下从未复现。集成轮完整门禁请按仓库既有串行约定执行。

## 5. 真实 HTTP／重启聚焦验证（54 项断言，51 过 3 失败）

以候选源码入口 `startWebBackend` ＋ 候选真实二进制 `web-backend-storage`（本树 cargo build 产物，BUILD_EXIT=0）驱动真实 HTTP，合成根＋合成静态根，不触设计原型。证据：`http-driver-run.log`、`http-driver-result.json`、驱动脚本 `evidence/http-driver.mjs`。

通过面（摘要）：配对一次性/过期/限速（401 `pair_code_invalid`／429 `pair_rate_limited`）；无会话 401、缺 CSRF 403 `csrf_invalid`、伪造 Origin/Host 403 `origin_rejected` 且不入库（Host 另用原始套接字证明，见下）；CRUD/完成/重开/软删/历史全链路（版本递增、completedAt/deletedAt 语义、删除后可读且写操作 409 `state_conflict`）；幂等重放（同 ID 同规范输入 `replayed:true` 返回当前权威状态且不新建行；不同输入 409 `idempotency_conflict`；**重放优先于状态守卫**——删除后重放 create/delete 均 200 当前态）；时间语义（day 精度原样保留、action 挂 followup 接受、非法时区 400）；游标分页稳定无重叠；SSE `stream.ready`（epoch＋cursor 0）与 `item.changed` **无 id 行**、数据形如 `{contractVersion, objectType:"item", itemId, itemVersion, at}`；同源静态（index.html no-cache、hash 资源 immutable、SPA fallback、`/api` 不 fallback 且返回 JSON 404、编码路径穿越被拒）；优雅 close 后重开（initialize=false）事项/版本/历史逐条恢复、旧会话 401；SIGKILL 后 storage 经 stdin-EOF 退出释放根锁、事项/历史恢复；同根第二实例被拒（根锁）。`static-files`/`sse-hub`/路由/错误包络逐文件人工审阅与实测一致。

B8/B9 两项"失败"为**驱动自身工件**（undici fetch 忽略自定义 `Host` 头）：改用原始套接字复测（`host-socket-test.out`）——伪造 `Host: localhost:1` → 403 `origin_rejected`；伪造 `Origin: http://evil.example` → 403；合法 Host/Origin → 200。服务端精确 Host/Origin 拒绝成立。

### 实测线格式（供 II 对齐与 Codex 统一裁定）

1. `POST /api/pair` 请求体字段：主名 **`pairingCode`**，同时接受 `code`、`pairing_code` 别名（http-server.mjs:210）→ II 假设①的 `code` 可直接跑通。冻结 web-api/1 只规定"码仅存在于请求体"，未固定字面名，双方均不违冻。
2. CSRF：会话响应字段 **`csrfToken`**（pair 与 `GET /api/session` 都返回），写请求头 **`x-csrf-token`** → 与 II 假设②完全一致。
3. Cookie：**`sidekick_session`**，`HttpOnly; SameSite=Strict; Path=/`（无 Domain）→ II 假设③按 Set-Cookie 捕获可行。
4. 列表参数语义：未知 `status` **静默按默认过滤**（open+completed），未知 `kind` 静默忽略，`limit>200` **钳制为 200**，非数字 limit 回落 50，仅非法 cursor 返回 400 `validation_failed` → **与 II 假设④（未知 status／limit>200 按 400）不符**，需 Codex 裁定收紧 I 或放宽 II（当前字面契约只写"最大 200"，未规定越界动作）。
5. 重启：II 假设⑤（测试自有子进程导入同一 `startWebBackend`）实测可行（本次验证即以子进程方式复现重启）。
6. SSE 帧线格式：`event: stream.ready` data `{contractVersion, epoch:"inst_<12hex>", cursor:0}`；`event: item.changed` data `{contractVersion, objectType:"item", itemId, itemVersion, at}`，无 `id:` 行；15s 注释心跳。
7. 幂等规范输入：create＝`{input}`；update＝`{expectedVersion, input}`；complete/reopen/delete＝`{expectedVersion}`（**不含 action、不含 itemId**，见 OBS-2）。
8. 错误包络实测：`{"contractVersion":"web-api/1","status":<int>,"error":{"code","message"}}`。

## 6. 发现项

### MAJOR-1（阻断修订项）：并发失败路径把"未发生的历史"提交入库——违反 §7"失败整体回滚"

- 位置：`manual-items-service.mjs` 四个写路径（`updateItem`、`transitionItem`=complete/reopen/delete）中，条件更新 `UPDATE … WHERE item_id=? AND version=?` 影响 0 行的判定发生在 `transact` **返回之后**（JS `result.results[0].changes !== 1`），而同事务的 `INSERT_EVENT` 已随 `tx.commit()` 落库。Rust `transact` 只在 SQL 错误时回滚，不感知应用层断言。
- 实测复现（`phantom-force.out`，第 1 轮即触发；同场景另一轮被 JS 前置版本守卫拦住——**间歇性**）：两个并发写同 `expectedVersion`，败者收到 409 `version_conflict`，但 `manual_item_events` 仍多出一条该败者的 `update` 事件，其 `after` 快照描述从未应用的标题（事项实际为胜者内容）。历史台账被污染：§11 m7"事件行与动作一致"被破坏，§7"事项与历史在同一事务提交，失败整体回滚"在该失败模式不成立。
- 连带后果（实测）：该败者 `operationId` 的规范输入已入库——按契约"读回后按新版本重新决策"的修正重试（同 ID＋新 `expectedVersion`）永久 409 `idempotency_conflict`；盲重试（同 ID＋旧版本）返回 200 `replayed:true` ＋ 胜者的当前状态，客户端可能误认己方变更已被重放。
- 触发面：多客户端版本并发是契约明示场景（§3 路径、§11 多客户端行），II 的双客户端矩阵可能间歇踩中；单用户主路径不受影响，故定级 MAJOR 而非 BLOCKER，但**必须在集成候选（或 I 修订）中修复并补串行/并发回归**。
- 修复方向（不改 §9.1 协议）：把历史插入改为依赖同事务前一条 UPDATE 的影响行数，例如 `INSERT INTO manual_item_events (…) SELECT ?,?,?,?,?,?,? WHERE (SELECT changes()) = 1`；或为 op 增加可选 `expectChanges` 断言、Rust 侧 0 行即回滚整个事务。两法均保持"校验影响行数在事务内生效"。

### MINOR-1（登记，建议集成轮处理，不单独阻断）：CLI 位置参数解析——末位 `--init` 被静默忽略

- `parseArgs` 按"旗标-值"成对消费：`--root R … --init`（末位）→ `args['init']=undefined` → `initialize:false` → 对不存在根执行 open，报"工作目录不存在或不是目录"（实测 `cli-a1.log`），初始化旗标在最自然的位置失效；中间裸 `--init` 会吞掉下一个旗标并把再下一个值报成"无法识别的参数"（`cli-a2.log`，响亮但困惑；若下一旗标为 `--port N` 形式则更会静默回退默认端口）。
- 另 OBS：`isDirectRun` 以字符串相等比较 `import.meta.url` 与 `argv[1]`，macOS 经 `/tmp`（→`/private/tmp`）符号链接路径调用时**静默不执行且 exit 0**（实测）；建议 realpath 比较。
- 源码树直接调用未带 `--storage-bin` 报 ENOENT 属打包默认路径设计（对接约定 4），非缺陷。

### OBS-2（对齐登记，不判缺陷）：幂等规范输入不含 action/itemId

- 契约 §6 字面定义"规范输入含 input 的规范化形式与 expectedVersion"，实现逐字遵循；但同一 `operationId` 复用于**不同动作**（如 complete@v1 后接 delete@v1）或**不同事项**（同 input 同版本）时，实现按"同规范输入重放"返回先前对象当前态而非 409。建议 Codex 统一裁定是否把 `action`（与 `itemId`）纳入规范输入（建议纳入），并同步 II 断言。

### NIT/OBS（非阻断）

- NIT-1：`run_stdio` 文档注释称 stdout 写失败返回 1，实现恒返回 0（`web_backend_store.rs:571-609`）。择一修正。
- OBS-2b：`static-files.mjs` 对**所有**非 index.html 资源发 `immutable, max-age=1y`，含未带 hash 的 `favicon.ico` 等；契约只要求"带 hash 的资源长缓存"。当前 Vite 产物主要资源带 hash，风险低。
- OBS-2c：`serveStatic` 对畸形百分号编码（如 `/%zz`）`decodeURIComponent` 抛 URIError → 500 `internal_error`（应 400 更妥；进程不崩）。
- OBS-2d：`StorageClient.close()` 2s 后发 SIGTERM 即返回，不等真正退出、无 SIGKILL 升级；Rust 侧协议简单，实际风险低。
- OBS-3：`acquire_root_lock` 把一切 `try_lock` 错误映射为 `WEB_BACKEND_ROOT_IN_USE`（不分 EWOULDBLOCK/EINTR 等）；本沙箱并行满载下出现过一次误报（§4）。建议区分错误类别。
- 语义核对为正确而非缺陷：删除已完成事项时同时清 `completed_at_ms`（满足 002 CHECK）、重开清空完成时间、删除后读路径开放、`workspace_info` 映射、`open_workspace_directory` 浏览器下降级为 null（不引 Tauri 业务依赖）、`status=all` 全量拉取与旧实现 `list()` 全量＋domain 过滤语义一致、pairing 码 8 hex/10min/一次性/5 次失败 60s 限速。

## 7. 前端实际业务接线（代码审阅＋单测＋HTTP 层验证）

- `todos.ts` 经 `WebApiClient.asBackend()` 把既有 `createTodoModel` 七命令映射到真实端点（list/create/update/setCompleted/delete/history/workspace_info），`operationId` 由 Workbench 以 `crypto.randomUUID()` 按用户意图生成；`src/domain/todos.ts` 纯逻辑未动。
- `PairingGate`：`readSession` 恢复会话（401→配对门）、配对成功后订阅 SSE；`item.changed`/`stream.ready`/`stream.reset` 均触发 `todos.refresh()` 读回补偿（M2：提示仅触发刷新）。App.vue 默认 surface 经 `PairingGate` 渲染 `Workbench`，其余 surface 不受影响。浏览器完整旅程仍归 II/OhMyPi/集成验证（本审查未签）。
- desktop-controls 合成 seam 保留既有断言意图（shim 返回原 `invoke`），本次未重跑该浏览器夹具（属既有回归，归集成门禁）。

## 8. 显式未验项（如实开放）

1. 完整浏览器用户旅程／真实 dist 同源冷启动（1440×1000／640×900）——II 套件＋OhMyPi 独立验证＋集成轮，本审查不以 smoke 代签。
2. II 三套件对本候选的实跑——先决是第 5 节线格式差异（假设④）经 Codex 裁定。
3. III 守卫/构建接入、`build:backend` 端到端、`test:web-manual-items`、完整 `npm run check`——唯一集成执行者；本树（未含 III 守卫）实测 `check-structure` 恰按基线规则拒绝 `server/`＋`src-tauri/src/bin/`（structure-cand.log），与 Claude 登记的集成依赖一致；`check:docs` exit 0（20 文件 429 链接）。
4. 全量并行 cargo（本沙箱环境性 flake）在集成环境的表现；`probe:prepare-*` 网络前置。
5. Linux/反向代理、Secure cookie/代理模式、真实凭据/用户根/模型、push/部署——授权边界外，未动。

## 9. 结论

**不通过——仅因 MAJOR-1 一处**：并发版本冲突失败路径违反"同事务失败整体回滚"，实测复现幽灵历史行＋幂等键烧毁。修复（建议事务内以影响行数门控历史插入）＋补一条并发回归后重交；其余增量（版本/补丁/哈希身份、冻结契约、SQL 权限范围、根锁与恢复、会话/CSRF/Origin、SSE、静态供给、前端接线、聚焦测试）全部独立核实通过，**重交时已验面不需重开**，只需复验受影响写路径与新增回归。MINOR-1（CLI `--init` 解析）与 OBS 一并登记，建议随同一修订或集成轮处理。

MAYNE-23 状态未动（保持 in_progress）；本记录未登记 `docs/reviews/README.md` 索引（按派审写入边界留唯一集成轮）；审查全程自建进程已收尾（pgrep 复核为空），候选树只读未改。
