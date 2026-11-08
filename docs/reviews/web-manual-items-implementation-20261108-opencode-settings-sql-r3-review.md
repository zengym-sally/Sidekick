# W1 I MAJOR-1（A/R2）写目标分派收口限定独审（R3）— OpenCode：**通过**

- 审查者：OpenCode。本人未参与 `325f5b4..d3cc896` 任何字节；R2（`a27d9ab`）的 MAJOR-1 即本人登记，本次为对该修复的限定复核，非自审本人代码。
- 派审：MAYNE-23 线程评论 `01a1b96c-4ae4-77b6-b087-5bacd5295b9f`（范围 `325f5b4352c9f4c900eacccab827380b7bf6c120..d3cc8966649dbfb482ae4e2f801b84007f57122a`，仅审守卫入口与受影响路径；通过后同 run 接续集成的条件授权单列于集成记录）。
- 方法：候选经 `git archive` 只读导出（`git write-tree` 实测导出树＝申报 tree），在导出树实编 real release `web-backend-storage`（2,633,392 B），真实 stdio 对抗 21 例＋fail-closed 1 例＋合法语句 6 类，真实 HTTP 首写/CAS 8 例（`startWebBackend` 显式合成根＋真实二进制＋真实 entry）；未写任何作者树；未跑完整门禁。MAYNE-23 保持 `in_progress`。

## 结论

**通过。** 修复以 `write_target`（前导子句提取）按真实 DML 写目标分派权限，与队长裁定逐条一致：settings 目标一律先过两条生产模板逐字比对（业务表提名不能再绕过）；业务放行仅适用于真正以 `manual_items`/`manual_item_events` 为目标的语句；引号（`"`/`` ` ``/`[]`）与限定名（含 `.`）目标直接拒绝；仅出现在子查询/EXISTS/注释中的表名永远到不了分派入口。A11/A12 两类 R2 反例在其真实二进制上**已被拒绝且零落库**，既有合法条件历史 `INSERT…SELECT`、settings 模板首写/CAS（stdio 与 HTTP 两侧）全部保持通过。无阻断项，2 项观察登记不阻断。

## 版本与哈希（全部实测逐字节一致）

- 父子链精确：`d3cc896` 父即 `2479587`，`2479587` 父即 `325f5b43`（无 squash/amend/rebase）。
- `d3cc896` tree `e26270ecfde141e7b86372c53c48d3faf923fb76`＝申报值；`git archive` 导出后 `git write-tree` 复算同值。
- 修复提交 `2479587` 增量补丁（`325f5b43..2479587`）SHA-256 `17576cd0d5e8e4399fd4e8b244f2b5a27b6c374392daf887941863ac8a7c3216`＝申报值；恰 2 文件（`web_backend_store.rs`、`web_backend_store_tests.rs`）。
- 含证据刷新的增量（`325f5b43..d3cc896`）SHA-256 `359bdf176e91c15080305b68a2d2a8715fc91e40de032aaef65ffbebc2ff9fa7`＝申报值；恰 3 文件＝上述 2 Rust 文件＋I 记录 `docs/reviews/web-manual-items-implementation-20261108.md`（仅哈希表与收口记录文字，无守卫/契约字节）。
- 相对基点 `bc4b1c3` 累计补丁 SHA-256 `263263dd6f083f49432a20e6b6143c07c5ad5aa9e81413621a346e3d9651294d`＝任务描述申报值。
- **前端通过面字节稳定**：`git diff 325f5b43..d3cc896 -- src/ server/ shared/` 为空；ZCode R2（`36afeed`）通过结论绑定 `325f5b4` 的 src 字节可按零差异沿用，后端 6bb7ff9/时间-SSE 54badb5 覆盖的未改面不受本次影响（本次新结论绑定 R3）。
- 冻结输入逐字节不变：001=`8511907c…ff143d`、002=`b6cb8e61…f97e`、web-api/1=`61863271…f58d`（导出树实算）；`Cargo.toml`/`Cargo.lock` 零差异。
- 记录内申报 blob 与实际一致：`web_backend_store.rs`＝`c1a3a157…86f0`、`web_backend_store_tests.rs`＝`632c7c6e…1b0c`。
- release 二进制（导出树实编，占位 `build/s0-runtime` 资源目录仅满足 tauri build script 路径检查）SHA-256 `b7dd9339598418a18858ed5b7d2dd8ffbf568aff6ef324fd152273421af36422`。

## 守卫入口核对（代码级）

`validate_write` 新路由：mask → 多语句拒绝 → 首关键字必须 INSERT/UPDATE/DELETE/REPLACE → 禁用关键字 → **`write_target(&upper)` 返回 `None` 即 `WEB_BACKEND_SQL_DENIED`（"无法识别写目标"）** → `target=="settings"` 一律 `validate_settings_write`（模板逐字比对）→ `BUSINESS_TABLES.contains(target)` 放行 → 兜底拒绝。`write_target` 只看前导子句（INSERT/REPLACE 的 INTO 后一词、UPDATE 一词、DELETE 的 FROM 后一词），剥列清单括号后凡以引号开头或含 `.` 即 `None`；字符串字面量与注释已先被 `mask_sql` 折叠，子查询/EXISTS 中的表名不可能进入目标位。R2 MAJOR-1 的「业务提名先于 settings 模板」顺序问题被结构性消除（分派不再依赖全文 keyword 命中）。

## 通过面（真实 stdio 21 拒 + 1 fail-closed + 6 合法；真实 HTTP 8/8）

1. **A11/A12 及变体全拒、零落库**：`INSERT INTO settings…SELECT…FROM manual_items`（R2 A11 原形）；`…AND version=? OR EXISTS(SELECT 1 FROM manual_items)` 参数化错版本 99 与字面量错版本（R2 A12 原形）；`…WHERE EXISTS(SELECT 1 FROM manual_item_events)` 提名；每次被拒后 settings/manual_items/manual_item_events 三表行数逐一复测不变。
2. **引号/限定/别名目标与业务提名组合全拒**：`"settings"`、`[settings]`、`` `settings` ``、`main.settings`（INSERT/UPDATE/DELETE 三形态）、`UPDATE settings AS s`、带引号目标＋FROM manual_items 组合、`tasks` 目标＋业务子查询（DELETE/UPDATE/INSERT…SELECT 三形态）、REPLACE INTO settings、小写关键字业务提名、业务名写进注释（`/* manual_items */`）不能改路由、key 重写＋EXISTS 组合、key 字面量大小写改写（`'Application.TimeZone'`）。
3. **合法路径全部保持**：真实业务 INSERT 落库 changes=1；条件历史 `INSERT INTO manual_item_events…SELECT … WHERE (SELECT changes())=1` 放行且恰落 1 行（目标真为 events）；settings 模板首写 v1、空白/注释变体 CAS v2→v3 放行且值正确、陈旧版本 changes=0 行不动、多语句拒绝保持、逐字模板的 key 大小写/空白原样保留。
4. **fail-closed 验证**：模板形状 `version + 1`（`+` 两侧带空格）被拒——规范化折叠空白仅发生在 `(`、`)`、`,`、`=` 邻位，属过严方向，生产恒发两条精确字符串，无影响（OBS-A）。
5. **真实 HTTP 单 key/CAS 全链路（8/8）**：配对 200＋顶层 csrfToken；默认 GET v0（OS 默认时区、不写库）；首写 v1；CAS v2；陈旧 409 `version_conflict`；非法时区 400 `validation_failed`（校验先于 CAS，顺序正确）；无会话写 401；优雅 close→同根重启→重配对→Europe/Paris v2 完整读回。
6. **聚焦 Rust（候选导出树实跑）**：`cargo fmt --check` exit 0；`cargo clippy --all-features -- -D warnings` exit 0；`cargo test --lib web_backend` **31/31** exit 0（R2 基线 30＋新增 `write_target_dispatch_ignores_business_names_in_subqueries`，该新测单独复跑亦通过，含引号/限定/别名/他目标提名 7 例拒绝断言与合法条件历史落库断言）。

## 观察项（登记不阻断）

- **OBS-A**：settings 模板规范化不在 `+` 等运算符邻位折叠空白，故生产模板的少量空白变体（如 `version + 1`）会被拒；属 fail-closed、比生产面更严，HTTP 生产组装恒发两条精确语句，无功能影响。若未来放宽需在规范化中统一运算符邻位空白，属 I 作者裁量。
- **OBS-B**：限定名/引号目标一律拒绝（含业务表限定名，如 `main.manual_items`）——较「引号/限定仅对 settings 拒绝」更严，业务 stdio 面同样收敛到裸名；与裁定「不支持的形态可直接拒绝」一致，无泄漏。

## 未验项与收尾

- 完整 `npm run check`、最终集成门禁与新冻结版浏览器旅程归唯一集成阶段（同 run 接续，另行记录）；本审不代签。
- 本审只覆盖派审限定范围（守卫入口与受影响路径）；前端/时间-SSE 面按零差异沿用既有独审结论，未复跑前端套件。
- 收尾：stdio/HTTP 探针根与子进程全部显式收尾，`pgrep web-backend-storage|web-backend-entry` 复核零残留。
- 证据与脚本：`build/web-manual-items-settings-sql-r3-review/`（stdio-driver.log 21+1+6 例、http-driver.log 8 例、两份驱动脚本、SHA256SUMS.txt）。不含配对码/cookie/token 真实值。
