# MAYNE-35 producer 窄修：typed 退出证据不变式 3 与台账损坏处理（2026-11-11，Claude）

## 0. 性质与身份

接收 MAYNE-36 独审结论（1×P1＋3×P3），按本卡项目工作流做**限定窄修**。这不是重做 producer、不是重审冻结规范、不是 E 完成声明。

- 待修 producer：`2394a245831c5d673f8692c147487ea521e9f366`（tree `913b4404c1f0f2e8a3cf5a8bc9beafef247a46fa`，父 `8c1626aa`）。
- 冻结规范：`0c9febc5010015418a5778a49f76d4e0c01f7f9f`（`docs/engineering/web-api-contract-v2.md`，SHA-256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd`），本轮零字节改动。
- 任务分支 `agent/claude/mayne-35`，起点 `0c9febc`（tree `06adbf50…df6`）；按精确路径取 producer 六文件并登记哈希（`build/mayne35-exit-registry-repair/admission.json`），不整枝覆盖冻结规范或其它候选。
- 写域：`server/lib/attempt-exit-evidence.mjs`、`server/lib/worker-host.mjs`、`tests/unit/attempt-exit-evidence.test.mjs`、`tests/integration/attempt-exit-registry.test.mjs`、确需的 `tests/fixtures/web-text-intake/exit-registry-leaf.mjs`、本人记录、`build/mayne35-exit-registry-repair/`。

## 1. P1：冻结 §3.1.1 不变式 3 的 builder/validator 语义冲突

**根因**：builder 的文档化总序把 `known_survivor` 面排在 argv 面之前，而冻结不变式 3 对 argv 退化面的 reason 是**无条件**约束——`argvScan=null ⇒ veto.reason="insufficient_evidence"`；`argvScan.performed=false ⇒ veto.reason ∈ {insufficient_evidence, eperm}`。二者对同一 emitted 对象互斥。

**修复**（`attempt-exit-evidence.mjs`）：

- builder 将 argv 退化面（`null` / `performed=false`+EPERM / `performed=false` 通用失败）改为**无条件优先**，覆盖并存的 survivor、stray pending、identity_mismatch、group EPERM 等面；reason 由不变式 3 直接固定。
- `veto.detail` 改为**拼接全部阻塞面**（`; ` 连接），并存事实（survivor pid、`pending=N`、mismatch pid）不再被丢弃；未删成员、未清 pending、未假扫描。
- validator 补齐无条件约束：`null` 且 verdict=`unresolved` 时 reason 必须为 `insufficient_evidence`；`performed=false` 且 verdict=`unresolved` 时 reason 必须 ∈ {`insufficient_evidence`,`eperm`}。原实现只分别挡了 `null+eperm` 与 `failed+known_survivor`，漏掉 `null+known_survivor` 与 `failed+identity_mismatch` 等组合。
- 单元测试原 `:143-149` 把「survivor 压过 scan EPERM」钉为期望（且唯独此处省略 validator 断言），现改写为 `eperm`＋detail 保留 survivor＋validator 通过。

## 2. P3-1：`runStraySweep` 语义损坏台账的错误口径

`worker-host.mjs` 的 `runStraySweep` 对 JSON 层损坏（`:643` 的 `readStrayLedgerRows` `corrupt`）返回 `{error:'stray_ledger_corrupt', detail}`，却对语义层损坏（`aggregateStrayLedger` 的单调性/seq/算术抛错）未捕获、直接抛异常。现用同一 `try/catch` 兜住 `aggregateStrayLedger`，与 JSON 损坏**同口径**返回错误；不清台账、不追加伪清扫行、不发出 confirmed。

## 3. P3-2：宿主差分口径更正

producer 记录声称 worker-host 相对 `d70280c` 为「+637 行」；实测 `git diff --numstat d70280c:server/lib/worker-host.mjs 2394a24:server/lib/worker-host.mjs` 为 **+672 / −3**。更正在本记录追加，原作者记录（`web-text-intake-exit-registry-20261111-opencode.md`）与旧失败输出保留、不覆写。

## 4. 新增回归（同一测试字节修前红/修后绿）

- **单元**：argv 退化面覆盖并存面（survivor / pending / identity_mismatch × null / 通用失败 / EPERM）；干净扫描（`performed=true, hits=0`）不覆盖并存否决的对照；伪造 `null+known_survivor`、`performed=false+identity_mismatch` 必须被 validator 拒绝。
- **集成（真实 WorkerHost 入口）**：pending+`argvScan:'skip'`、pending+模拟 ps 不可用 → 必须返回**合法 typed `unresolved`**（`insufficient_evidence`）而非抛异常；台账 JSON 损坏与语义损坏同口径错误返回且**磁盘原记录零变更**。

## 5. 验证（本轮实际执行）

- **修前红**：新测试字节对原始 producer 两模块 → `node --test` **6 fail / 23 pass，exit 1**（`red-green/red-output.txt`）。
- **修后绿**：`node --test --test-timeout=20000` 单元＋集成 **29/29 pass，exit 0**（原 24 项＋新增 5 项；`red-green/green-output.txt`）；测试后 fixture 残留进程 0。
- 语法 `node --check` 五个文件通过；`npm run check:docs` exit 0（22 文件/527 链接）；`git diff --check` 干净。
- 未跑：旧已过矩阵、聚合/cargo、完整 `npm run check`、19 旅程；真实 OS EPERM 仍为 adapter 模拟（证据 `simulated` 明注）。

## 6. 边界

- 只写上述域。冻结规范与 V2 样例、producer 旧记录、服务/恢复/调度/namespace 发布、HTTP/SSE/前端/全局信封、DDL/Rust/Runtime/vendor/package/依赖/公共索引/product05、main/远端/真实凭据/用户根均未改。
- 未自签 E 完成；未在 V1 消费者启用 B(a)。交精确 SHA/tree、最小差分与原始证据回独审。最终实际树的新完整门禁、原样旅程与主线接收仍归 MAYNE-34。
