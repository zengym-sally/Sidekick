# W1 参数增量独立审查（OpenCode，2026-11-08）：通过

- 审查对象：`74c023cd6d01feda2b31ab46dc0723117e765473..4052d47bbbddb689fd5ed1043053b2f638663fcd`（Claude 的 Task I 参数拒绝增量，父提交即 `74c023c`）。
- 判定依据：MAYNE-23 任务描述 §「2026-11-08 接口字面名与列表参数协调裁定」及冻结契约 `docs/engineering/web-manual-items-contract.md`（SHA-256 `8d7529531e7e5c53a3d195fa20f376a2b72d400e0ce8114b8c8ccc3b17b70e8d`）。
- 审查者：OpenCode（III 工程候选作者，未参与 I 实现；本人 III 增量已由 ZCode 在 `3e8d310` 独立审查，无利益冲突）。
- 边界：只审本增量；候选只读（隔离分离检出 `4052d47`，全程 `git status` 干净）；不改 I/II/III 实现、不跑完整重门禁、不动共享 main、未 push。

## 结论：**通过**（1 条 NIT＋2 条观察，非阻断）

## 1. 版本与身份（全部实测）

| 项 | 申报 | 实测 | 一致 |
|---|---|---|---|
| `4052d47` 父提交 | `74c023c` | `74c023cd…` | ✓ |
| `4052d47` tree | `218551eb…` | `218551ebb9b3e706c7cc07ba7d454ecdf2d43292` | ✓ |
| 增量补丁 SHA-256（`git diff 74c023c 4052d47`） | `e1d19cd0…575e` | `e1d19cd023209f2dd381143eadba48185455870c1ef2c1f0dfaa2b5157bf575e` | ✓ |
| 累计补丁 SHA-256（`git diff bc4b1c3 4052d47`） | `80ec6635…05cf` | `80ec66357b8b0ff958af28a3e6554873b288fa93ab2ad16bb6faa34fc04c05cf` | ✓ |
| 基点祖先 | 6546990 为祖先 | `git merge-base --is-ancestor` YES（对 `74c023c`、`4052d47` 均 YES） | ✓ |

说明：首轮 I 交付评论"HEAD/基点 tree 均为 7b71cdb3"系陈述笔误——实测 tree(`bc4b1c3`)=tree(`6546990`)=`7b71cdb3…`（基点部分为真），tree(`74c023c`)=`b08886e…`、tree(`4052d47`)=`218551eb…`。本增量申报的两处 tree/哈希均逐字准确。完整增量身份矛盾由 ZCode 对原候选的审查处置，此处仅登记实测事实。

## 2. 增量构成与写入范围

`git diff --stat`：恰 4 文件，+95/−16。

| 文件 | SHA-256（在 `4052d47` 实测） | 与申报 | 范围 |
|---|---|---|---|
| `server/lib/manual-items-service.mjs` | `3742c994aa035a2c1cd1ca2880ad32efa1668d0524764a10ab8f01d1244ba7c8` | ✓ | I 唯一写入 |
| `server/lib/http-server.mjs` | `f4d80e628e863a752848b65e503a14b66e4318a649b088324d5f42cf84ac9ab8` | ✓ | I 唯一写入 |
| `tests/unit/web-manual-items.test.mjs` | `d9bc844696108b84ee25421c296b7b8420ffd0748bd4e119704021ff0e242dce` | ✓ | I 测试写入 |
| `docs/reviews/web-manual-items-implementation-20261108.md` | （§6 追加，仅登记本增量哈希与验证） | — | I 证据路径 |

第 4 文件为 I 自身证据记录的 §6 追加，落在 I 允许的 `docs/reviews/web-manual-items-implementation-*.md` 写入范围内；其中登记的哈希与验证声明经本审查逐项独立复算属实。`src-tauri/` 与 `Cargo.toml` 零改动（diff 为空），Rust 侧沿用原候选结论，不属本轮复审。

## 3. 冻结哈希未变（在 `4052d47` 实测）

- `001_web_backend.sql` = `8511907cf755567932f1526af0db20ce0af9128767c5724f2dd75e3de8ff143d` ✓
- `002_manual_items.sql` = `b6cb8e61609f83454164bff6c5628b2c893122b8dbb9bb3ced41bcd3d9e2f97e`（＝批准 DDL 哈希）✓
- `docs/engineering/web-api-contract.md`（web-api/1）= `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` ✓

## 4. 裁定逐条核验（静态 + 动态实测）

**4.1 配对字段 `pairingCode`**：`http-server.mjs` 移除 `code`/`pairing_code` 别名兜底，仅传 `body.pairingCode`。真实 HTTP：`{}`、`{code:"…"}`、`{pairing_code:"…"}` 均 401 `pair_code_invalid`（不消耗限速预算）；`{pairingCode:"00000000"}` 401；`{pairingCode:<真实码>}` 200，响应**顶层** `csrfToken` 非空，`Set-Cookie: sidekick_session=…; HttpOnly; SameSite=Strict`；码一次性（复用 401）。`onPairingCode` 回调与 `result.pairingCode` 一致。浏览器客户端 `src/lib/web-api-client.ts`（本增量未改动）使用同一字面名（`{ pairingCode }` / 顶层 `csrfToken` / `X-CSRF-Token` 头）✓

**4.2 CSRF 标准载体**：写请求读取 `req.headers['x-csrf-token']`（HTTP 头名大小写不敏感）；实测无头 → 403 `csrf_invalid`、错值 → 403、正确 → 200 ✓。`GET /api/session` 顶层 `csrfToken` 与配对响应一致 ✓

**4.3 status 拒绝语义**：缺省走 `status IN ('open','completed')`；实测缺省返回恰 open＋completed 两件、排除 deleted；`open/completed/deleted/all` 均 200 且集合正确；`bogus`、空串、`OPEN`（大小写敏感）、`all%20`（尾空格）均 400 `validation_failed`。缺省语义与冻结契约 M1（§"列表过滤与删除可见性"）逐字一致 ✓

**4.4 limit 拒绝语义**：新增 `parseLimit`——缺省 50；显式值须为 1–200 整数，否则 `validation()` → 400 `validation_failed`。列表与历史两条路径均接入（`listItems`/`history`）。实测列表与历史：`1`/`200` → 200；`0`/`201`/`-1`/`1.5`/`abc`/显式空串 → 400 `validation_failed`；`limit=201` 为硬 400，**无静默截断/回退**；`limit=1` 时 `nextCursor` 非空 ✓。错误信封均为 `contractVersion: web-api/1`＋`error.code` ✓

**4.5 单测**：新增用例「list rejects unknown status and invalid limit (2026-11-08 ruling)」覆盖 `bogus/''/OPEN/'all '` 与 `0/-1/201/1.5/'abc'/''/NaN`（列表＋历史），并通过显式边界 1/200 与四类合法 status。

## 5. 聚焦复跑（命令与退出码）

| 命令（均在隔离检出 `4052d47`） | exit | 结果 |
|---|---|---|
| `node --test tests/unit/web-manual-items.test.mjs` | 0 | 11/11 pass（64.8ms） |
| `cargo build --bin web-backend-storage --offline` | 0 | 存储二进制构建成功（dev profile） |
| 本审查自建 smoke（86 项断言，真实 HTTP） | 0 | 86/86 PASS，0 FAIL |

smoke 环境：`startWebBackend({ root: 合成根, port: 0, staticRoot: 合成静态根, storageBin: <上表二进制>, initialize: true, onPairingCode })`，进程内真实 Node 入口＋真实存储子进程＋真实 SQLite。收尾：`close()` 后同源请求 ECONNREFUSED；`pgrep web-backend-storage` before=1/after=1（本运行子进程已退出；既有的 1 个为其他工作树遗留进程，非本审查创建，未触碰）。原始证据：`build/web-manual-items-params-review/`（01–10 编号取证、admission.json、unit-test.log、cargo-build*.log、smoke-params-opencode.mjs、smoke-run.log）。

## 6. 发现项

- **NIT-1（非阻断）**：`parseLimit` 用 `Number()` 宽松解析，`1e2`、`0x32`、` 50`、`+50` 等可解析为 1–200 整数的字符串会按其数值通过（实测均 200）。裁定只约束值域（1–200 整数、不截断、不回退），未规定字符串文法，故不构成违反；集成轮如需收紧可加 `/^\d+$/`，属可选强化。
- **OBS-1**：配对字段缺失/别名按 401 `pair_code_invalid` 处理（而非 400），与既有"无效码"路径一致，且不消耗限速预算；裁定未规定缺失字段的错误码，此行为合理且与 web-api/1 信封一致，仅登记。
- **OBS-2**：本机存在一个非本审查创建的遗留 `web-backend-storage` 进程（属于其他工作树的现场）；本审查未触碰，仅提醒集成执行者注意现场隔离。

## 7. 缺前置与显式未验项（如实开放，均非本增量缺陷）

- 候选树不含 `docs/engineering/web-manual-items-contract.md`（该文档按分工落 III/集成树）；本审查对裁定的契约对照使用本隔离树副本（SHA-256 等于冻结值 `8d752953…70e8d`）与任务描述裁定原文。
- `cargo build` 需 `../build/s0-runtime` 打包资源（tauri.conf.json 声明，gitignored）；隔离沙箱以空目录补齐后构建通过。该资源只影响应用打包、与 stdio 存储二进制功能无关，已如实登记为环境偏差。
- 未跑：完整 `npm run check`、全量 cargo test/clippy/fmt（I 整体范围，归 ZCode 对原候选的独审与最终集成串行门禁）；II 修订后的真实集成验证；浏览器同源 UI；Linux/代理、真实凭据/用户根/模型。
- 本增量通过**不代表** I 整体或 W1 准出：原候选 `74c023c` 的完整审查仍由 ZCode 进行，II 退修与最终集成未启动。

## 8. 现场收尾

自建进程已全部收尾（见 §5）；隔离检出与合成根已删除；未改 I/II/III 任何实现文件；MAYNE-23 状态未动（保持 in_progress）。
