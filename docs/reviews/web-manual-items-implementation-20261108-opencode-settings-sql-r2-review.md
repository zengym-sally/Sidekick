# W1 I MINOR-2 settings-SQL 收口限定独审 A（R2）— OpenCode：**不通过**（唯一阻断：路由顺序使 settings 写守卫可被业务表提名字样绕过；其余全验通过）

- 审查者：OpenCode。本人未参与 cf8b417..62033e3 任何字节（本人既有工作为集成/门禁、前轮参数审查与 R1 后端面独审）；本审的 MINOR-2 即 R1（`6bb7ff9`）由本人登记，本次为对修复的限定复核，非自审本人代码。
- 派审：MAYNE-23 线程评论 `01a1b94c-b505-759b-94cd-f211006f9bf4`（沿 `6bb7ff9`，范围 `cf8b417d2c0806165245a501f425702348fbb945..62033e3dbcae3f06c7e3c66bff773af0d51b5927`）。
- 方法：候选经 `git archive` 只读导出（blob 逐一核对），在导出树实编 real release `web-backend-storage` 二进制，真实 stdio 对抗 36 例 + 真实 HTTP 首写/CAS 18 例（显式合成根、只读 `sqlite3` 独立观测）；未写任何作者树；未跑完整门禁。MAYNE-23 保持 `in_progress`。

## 结论

**不通过。** 修复把 settings 写守卫收紧为「两条生产模板规范化逐字比对」，在 settings 校验路径内派审列出的全部对抗形状（INSERT…SELECT、多行 VALUES、OR 放大谓词、重写 key、字面量错位、他 key/DELETE/DROP/REPLACE/多语句、query 携写）**全部被拒且零落库（16/16 实测）**，生产模板及注释/空白变体放行正确，错版本零改动，HTTP 单 key/CAS 全链路正确。**但 `validate_write` 的路由顺序在 settings 模板校验之前先按业务表名放行，凡语句提及 `manual_items`/`manual_item_events`（如子查询/EXISTS）即整条跳过 `validate_settings_write`**——真实二进制实测两条「跨 key 写入」与「错版本越过 CAS」反例成立，恰属派审明确要求拒绝的 `INSERT…SELECT` 与 `OR 放大谓词` 形状，也即 owner 登记要求「须在合入前收口」的同一契约（「HTTP 不可达不替代该守卫契约」）。收口方向极小（路由顺序对调或对 settings 目标语句一律走模板校验），但按本轮派审验收字面不满足，须退回 I 作者修订后另派限定独审。

## 版本与边界（全部实测逐字节一致）

- 增量补丁 `cf8b417..62033e3` SHA-256 `7564ecca…771a8`＝申报值；范围恰 2 文件（`web_backend_store.rs` blob `f795f71`、`web_backend_store_tests.rs` blob `fbb16c8`），`shared/`、`Cargo.toml/lock`、`package.json`、`server/`、迁移零差异。
- `62033e3` tree `18929f0f`；B `7fce144` tree `ad685a98`；最终 HEAD `325f5b4` tree `f25c58c1`＝申报值。
- **后续 B/记录提交未改已审 Rust 字节**：`git diff 62033e3..325f5b4 -- src-tauri/` 与 `-- server/` 均为空；`62033e3..7fce144` 仅前端 6 文件；`7fce144..325f5b4` 仅 `docs/reviews/web-manual-items-implementation-20261108.md`（记录），符合「7fce144 后仅记录变动」。
- 冻结输入逐字节不变：001=`8511907c…`、002=`b6cb8e61…`、web-api/1（`docs/engineering/web-api-contract.md`）=`61863271…`（62033e3 与 325f5b4 两处同值）。
- 导出树 `web_backend_store.rs` SHA-256 `5421cbcd…0ac757`、`web_backend_store_tests.rs` `84c30fc5…a8d29`＝对应 blob；release 二进制 2,632,496 B，SHA-256 `a8fcb553…b5e5b`。

## 聚焦命令（候选导出树，全部实跑）

`cargo fmt --check` exit 0；`cargo test --lib web_backend` **30/30**（store 12 + schema 18）exit 0；`cargo clippy --all-targets -- -D warnings` exit 0；`node probe-stdio.mjs`（真实二进制）exit 0、36 例；`node probe-http.mjs`（真实 entry + 真实二进制 + 显式合成根）exit 0、18 例。构建前置 `build/s0-runtime` 从真实主检出只读复制（评审先例）。原始日志与 JSONL 在 `build/web-manual-items-settings-sql-r2-review/`。

## 通过面（真实 stdio 36 例 + 真实 HTTP 18 例，逐一可复核）

1. **settings 校验路径对抗全拒（16/16，零落库）**：`INSERT…SELECT`（字面量位）、多行 VALUES、`OR 1=1`、大写 key 字面量 `'APPLICATION.TIMEZONE'`、字面量塞进无关列（`note` 列）、尾随 `; DROP TABLE`、DELETE、DROP、REPLACE、他 key、字面量内注释（原样保留致不匹配）、小写关键字（合法 SQLite，fail-closed 拒绝）、`sett/**/ings` 注释并标识符、`key'字面量'` 无操作符邻接、PRAGMA、query 携 INSERT——全部 `WEB_BACKEND_SQL_DENIED` 且每次被拒后 settings 表 0 行。
2. **注释与大小写/空白重点面**：生产 INSERT 模板在块注释（`/*c1*/`）、行尾 `--` 注释、`/**/` 充当分隔符、tab/换行/多余空格、最小规范化形状等 5 变体下全部放行且落库值正确；key 字面量大小写/空白原样保留（改写即拒）——符合「规范化不得改变 key 字面量大小写/空白」。
3. **CAS/参数边界**：错版本（99/超前/空表 stale）changes=0 且行不动；CAS 成功 changes=1 v1→v2；空表 UPDATE 放行但 changes=0；params 缺失/多余 → `WEB_BACKEND_SQL_ERROR` 且事务回滚零落库（fail-closed）。
4. **合法生产路径**：真实 stdio 生产 INSERT/CAS 语句与 `application-settings-service.mjs:55/69` 组装的两条 SQL 规范化后逐字相同，放行；手工事项双写（manual_items + events）不受影响。
5. **真实 HTTP 单 key/CAS 全链路（18/18）**：无会话 GET 401；配对 200 + 顶层 csrfToken；默认 GET 返回 OS 默认时区 v0 且 settings 表 0 行（GET 不写库）；无 CSRF PUT 403 `csrf_invalid` 零行；首写 v1→恰一行；CAS v2；stale 409 `version_conflict` 行不动；非法时区 400 `validation_failed`；注入 `key/value` 额外字段被忽略仍单键 v3；非整数 expectedVersion 400；同一会话手工事项创建 200（settings 仍单行）；优雅 close→同根重启→重配对→Asia/Tokyo v3 完整读回→收尾 close。
6. **Rust 单测新增段**：6 类对抗 + 错版本零改动 + 空白变体放行，30/30 与申报一致；但其对抗样本全部走 settings 校验路径，未覆盖下述绕过路径（与发现一致，非断言造假）。

## 发现项

- **MAJOR-1（阻断）**：`validate_write` 路由顺序——业务表放行（`BUSINESS_TABLES` 任一 keyword 命中即 `return Ok(())`）先于 `contains_keyword("SETTINGS") → validate_settings_write`。凡 settings 为写目标且语句同时提及业务表（子查询/EXISTS 即可），模板校验被整体跳过。真实二进制两例反例：
  - A11：`INSERT INTO settings(key,value,version) SELECT 'bypass.probe.key','x',1 FROM manual_items` → **ok:true，落库 `bypass.probe.key` 外键行**（跨 key 写入）；
  - A12：`UPDATE settings SET value=?,version=version+1 WHERE key='application.timeZone' AND version=? OR EXISTS(SELECT 1 FROM manual_items)` 以错版本 99 → **ok:true，CAS 被击穿，version 推进至 2**（OR 放大谓词越过版本门）。
  两例恰为派审验收字面所列 `INSERT…SELECT` 与 `OR 放大谓词` 必须拒绝的形状；非本增量回归（旧守卫同序同样放行），但 owner 已明确「真实跨 key 写入及错版本越过 CAS 不符合已登记的精确写权限，须在合入前收口，HTTP 不可达不替代该守卫契约」，故按本轮验收口径不通过。建议收口方向（供 I 作者裁量）：在业务表放行之前先做 SETTINGS keyword 判定（settings 目标语句一律走模板校验；本切片业务语句不含 settings 子查询），或等价的对「写目标为 settings」一律模板化；同步补 A11/A12 形状单测与真实 stdio 反例。
- **OBS-A（登记不阻断）**：version 参数传字符串 `"1"` 时经 SQLite INTEGER affinity 折叠，CAS 以匹配成功（C3 实测 v2）；生产恒传 JSON 整数，仅在放宽 stdio 参数面时需重审。
- **OBS-B（登记不阻断）**：小写关键字语句被拒属 fail-closed（生产恒发精确大小写）；若未来需要大小写不敏感可在规范化中对非字面量 token 统一大小写，现状无影响。
- **OBS-C（登记不阻断）**：带引号标识符 `"settings"` 因 mask 折叠为空白而落入最终拒绝分支——过严但安全，无泄漏。

## 未验项与收尾

- 完整 `npm run check`、最终集成门禁、SIGKILL 式重启、浏览器旅程归唯一集成者新冻结版；B 前端面由 ZCode 并行 R2 复审，本审不代签。
- 本审只覆盖派审限定范围（Rust 守卫增量及其下游字节稳定性）；7fce144 前端行为仅做文件级核对，未运行前端套件。
- 收尾：本审全部探针根与子进程显式收尾，`pgrep` 复核本树零残留；唯一存活的 `web-backend-storage` 进程属 ZCode 并行 R2 前端评审树（`/tmp/zcode-r2-frontend-review/`），未触碰。
- 证据与脚本：`build/web-manual-items-settings-sql-r2-review/`（admission、hashes、36 例 stdio JSONL、18 例 HTTP JSONL、Rust 命令日志、两份探针脚本、stderr 原样）。不含配对码/cookie/token 真实值。
