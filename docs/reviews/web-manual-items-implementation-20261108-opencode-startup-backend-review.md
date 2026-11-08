# W1 启动增量后端面独审（OpenCode，2026-11-08）：通过（1 项 MINOR 登记不阻断 + 2 项观察）

按派审（MAYNE-23 线程评论 `01a1b925-c1dc-75a9-b075-cd4af92ad9ae`）独立审查 Claude 启动/会话增量 `05f0bc04f2d4d1188931b5eb1dca540650d196d7..db26d64f03ebc7396d481b9d661f9751fcba269b` 的**后端面**：server 增量、Rust store/测试与后端单测段。审查者未参与该增量任何字节的编写（本人既有工作为集成/门禁轮次与前轮参数审查 `a5708d5`）。**结论：通过**——五个重点面全部真实验证闭合；同时以真实 stdio 对抗探针发现 Rust settings 写守卫存在可被受信 Node 进程构造 SQL 绕过的形状缺口，登记为 MINOR-2（不阻断理由见 §5），建议下一版 I 修订顺手收口。

本审查只写本记录与本机 `build/web-manual-items-startup-backend-review/`（gitignored 原始证据，含 admission、哈希核对日志、聚焦 Rust 日志、两份 JSONL 探针证据、可证伪对照日志、单测日志、四个探针脚本与 SHA256SUMS）。候选经 `git archive` 只读导出至 `/private/tmp/multica-task-115709512/opencode/` 验证，未写任何作者树；未跑最终完整门禁；MAYNE-23 保持 in_progress。

## 1. 版本与哈希（全部实测逐字节一致）

| 项 | 申报 | 实测 |
|---|---|---|
| 增量补丁 `05f0bc0..db26d64`（17 文件） | `0d0b12b6…815dc` | 一致 |
| 累计补丁 `bc4b1c3..db26d64` | `f83b3b9f…beb4d` | 一致 |
| 候选 tree / 基点 tree | `ab83630c…` / `f64c094f…` | 一致 |
| 提交链 | 主体 `8d4a20d`（17 文件 +445/−39）+ 证据刷新 `db26d64`（1 文件 +5/−5） | 一致（申报口径准确） |
| 祖先链 | `6546990`（集成基座）与 `e750302`（第四轮已审版）均为候选祖先 | `merge-base --is-ancestor` 均 exit 0 |

后端增量恰 7 文件（`server/entries/web-backend-entry.mjs` +3、`server/lib/application-settings-service.mjs` 新增 76 行、`server/lib/http-server.mjs` +29/−1、`server/lib/manual-items-service.mjs` +6、`src-tauri/src/store/web_backend_store.rs` +46/−1、`src-tauri/src/store/web_backend_store_tests.rs` +41、`tests/unit/web-manual-items.test.mjs` +94）；其余 10 个文件均为前端/夹具/I 自有记录，不在本审范围。

## 2. 边界核对

- 冻结物逐字节不变：001=`8511907c…143d`、002=`b6cb8e61…f97e`（批准 DDL）、`web-api/1`=`61863271…f58d`，实测与冻结值一致。
- `shared/`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`package.json` 相对 `05f0bc0` **零差异**（diff --stat 为空）；无新增生产依赖；`sse-hub.mjs` blob 与 `05f0bc0` 相同（时间/SSE 面未触碰，沿 ZCode `54badb5` 已过结论）。

## 3. 五个重点面验证（静态 + 真实运行时证据）

运行环境：macOS arm64、Node v24.20.0、cargo 1.89.0；真实 `server/entries/web-backend-entry.mjs` + 真实 release `web-backend-storage` 二进制（本树构建，`build:release` exit 0）+ 显式合成根 + `node:sqlite` 只读取库观测。

### F-A 权限/CSRF/Origin 拒绝不写入 —— 闭合
`requireWrite` 静态确认四重（session→CSRF 精确比对→Host==expectedHost→Origin==`http://<expectedHost>`）；`PUT /api/settings/application` 与全部事项写路径均经它。真实 HTTP 探针（`02-http-adversarial.jsonl`，41/41 pass，driver exit 0）：无会话 401、无/错 CSRF 403 `csrf_invalid`、错 Origin 与无 Origin 403 `origin_rejected`——settings 与事项两面上，**每次拒绝后只读开库计数 settings/manual_items/manual_item_events 三表均与拒绝前完全相同**（A10、B8、B10）；complete 带错 CSRF 被拒后事项 version 不变、事件数不变。错误信封 `{contractVersion,error:{code,message}}` 与状态码映射（400/401/403/409）逐例正确。

### F-B 默认 GET 不写库 —— 闭合
新根上 `GET /api/settings/application` 返回 `{contractVersion:"web-api/1", settings:{timeZone:<实例 OS 时区>}, version:0, warning:null}`，随后的只读查询确认 `settings` 表 **0 行**（A3/A4）；单测段 `application settings reads the OS default at version 0 without writing` 同判据（count 0）。读路径走 Rust `validate_read`（仅 SELECT），无任何写语句。

### F-C 版本 CAS / 重启 —— 闭合
首写 `expectedVersion:0`→v1 并落库；陈旧 0 与超前 5 均 409 `version_conflict` 且库值不变；CAS `1`→v2 成功（A11–A15）。同根 graceful close→重启（`initialize:false`）→重新配对后 `GET` 返回持久值 `Europe/Paris` v3、事项 2 条完整读回、`settings` 仍恰 1 行（C1–C7）。并发正确性静态核实：预检非原子但 UPDATE 的 `WHERE … AND version=?` 在单事务内原子复核，`changes!==1` 即 409；首写竞态两条并发 INSERT 一胜一败，败者 UNIQUE 约束错误被映射为 409 `version_conflict`，语义正确。

### F-D settings 单 key 权限对抗 —— 闭合（含 1 项 MINOR-2，见 §5）
HTTP 面：请求体注入 `key`/`value` 额外字段被忽略，库中仍恰 `application.timeZone` 一行（A20–A23）——HTTP 无任何途径写其他 key。Rust stdio 面（`03-stdio-single-key-adversarial.jsonl`）：九项对照全部符合——INSERT v1 / 参数化 CAS UPDATE 放行，DELETE/DROP/REPLACE/多语句/他 key 字面量/非 CAS UPDATE/query 携带写语句全部 `WEB_BACKEND_SQL_DENIED`；Rust 单测 `settings_write_scope_is_limited_to_the_application_key` 断言与实测一致。

### F-E UTC 日历回转（MINOR-1 收口）—— 闭合，新旧可证伪
单测 25/25（候选导出树实跑 exit 0），含四个滚动反例（`2026-02-30`、`24:00`、月 13、分 60）全部 `validation_failed` 且 `manual_items` 0 行。服务层新旧对照（`05-minor1-falsify.log`）：**基点字节（05f0bc0）在 day/自由表达路径把 Feb30 静默落库为 Mar 2（`2026-03-02`）、24:00 落为次日**（与 ZCode MINOR-1 落库证据吻合）；**候选字节同样四例全部拒绝、零落库**，且有效闰日（2024-02-29 day）、普通 day、自由表达（「周五下午」）照常接受——无过拒。回转检查位于 ISO 形状门之后，仅作用于 ISO `at` 字符串，不触碰自由表达解析与 day/时区语义，符合派审口径。真实 HTTP 线复验：Feb30 自由表达 400、24:00 day 400、闰日 200（B5–B7）。

## 4. 聚焦命令与退出码

| 命令（候选导出树） | exit | 结果 |
|---|---|---|
| `cargo fmt --check` | 0 | 通过 |
| `cargo test --lib web_backend` | 0 | 30/30（store 12 + schema 18，与申报一致；297 项无关测试被过滤） |
| `cargo clippy --all-targets -- -D warnings` | 0 | 无告警 |
| `cargo build --release --bin web-backend-storage` | 0 | 2,633,152 B |
| `node --test tests/unit/web-manual-items.test.mjs` | 0 | 25/25 |
| HTTP 对抗探针（自建驱动） | 0 | 41/41 |
| stdio 对抗探针（自建驱动） | 0 | 对照 9/9；探针发现 MINOR-2 |

构建前置：本树 `build/s0-runtime`（gitignored、被平台清理）按 ZCode 评审先例从真实主检出只读复制后构建成功；首轮失败日志（`01-rust-focused.log` 前段，资源缺失 exit 101）原样保留。

## 5. 发现项

**MINOR-2（登记不阻断）：settings 写守卫的「字面量存在性」检查不限定 key 位置，受信 Node 进程可构造 SQL 写入任意 key 或击穿 CAS。** 实测（真实 release 二进制 stdio，`03`/`04` 证据）：`INSERT INTO settings(key,value,version) SELECT 'probe.select.key','p4',1 FROM settings WHERE key='application.timeZone'` 与多行 VALUES 形状（字面量元组+外键元组）均通过 `validate_settings_write` 并**真实落库外键行**；`UPDATE … AND version=? OR 1=1` 以错误版本参数执行成功且**跨全部 settings 行更新**（CAS 被击穿）。不阻断理由：(a) 生产服务只组装两条固定参数化语句（`application-settings-service.mjs` 逐行核实），HTTP 面无任何途径触达 transact；(b) 触达前提是本地 Node 服务进程本身已被控，而该进程对 `manual_items` 本就持有经批准的 DELETE 等写权限，守卫威胁模型是防意外/过宽写入；(c) 派审单 key 验收判据（HTTP 注入、他 key 字面量、DELETE/DROP、非 CAS、REPLACE、多语句）全部通过。建议下一版 I 修订收口：settings 写拒绝含 `SELECT`/` OR `/多行 VALUES 的形状，或执行后断言仅 `application.timeZone` 一行变化；是否并入由你裁定。

**OBS-1**：业务表写语句可经子查询**读** settings（`UPDATE manual_items SET title=(SELECT value FROM settings)…` 放行执行）——只读、无权限提升，登记备忘。

**OBS-2**：settings 首写竞态把 `WEB_BACKEND_SQL_ERROR` 整体映射为 409 `version_conflict`——在本表仅 PK 冲突一种现实错误源的前提下语义正确；若未来放宽 settings 写入面需重新审视该映射宽度。

## 6. 未验项（如实开放）

- 前端面（共享客户端/启动守卫/capabilities 归位后）不在本审，将由归位新版本另派独审并原样实测；**最终接收须核对归位后后端字节与本审候选逐字节一致**（本审绑定 tree `ab83630c…`），单面结论不签整体。
- 完整 `npm run check`、最终集成与浏览器旅程留唯一集成者在新冻结版执行；SIGKILL 式重启、SSE 语义、幂等重放等未改面沿既有已审结论（`4889f87`/`54badb5` 等）。
- Linux/代理、真实凭据/真实用户工作根/真实模型在授权边界外。

## 7. 收尾

自建后端/存储子进程全部显式 close 并 `pgrep` 复核 `web-backend-storage` 为 0；探针临时合成根与静态目录已删除；`git archive` 导出树保留于任务临时目录 `/private/tmp/multica-task-115709512/opencode/`（含 node_modules，平台托管清理，可随时再生）。本树仅新增提交本记录；`build/web-manual-items-startup-backend-review/` 为 gitignored 原始证据，随附哈希清单 `SHA256SUMS.txt`。证据不含配对码/cookie/token 真实值。
