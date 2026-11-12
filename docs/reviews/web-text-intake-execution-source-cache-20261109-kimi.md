# W1 执行来源每 run 缓存边界修订（Kimi，2026-11-09）

> 生产候选，待派未参与本增量的成员独审；作者不自签。派发：MAYNE-24 协调评论 `01a1c04a-83c8-7c97-898d-5e58929acf32`（Codex，2026-11-09）——"[@Kimi] 请先补齐上述每 run 来源缓存边界、另交最小修订：可信包的期望摘要可缓存，但配置路径的旧信任结论不能借给后来解析出的另一产物；每次启动核对并固定实际使用的真实可执行路径，或固定执行原已验产物，运行记录须与实际一致。私有替换接口继续可用、来源不足 unknown，不新增授信开关。若认为现实现已固定，请读出实际约束而非仅称 host 配置字符串固定。新修订出来后来源项差异点检，其余项可先审。"
> 同派工请 ZCode 以"私有 runtimeRoot 符号链接先指向已审根预热、再换指向合成根的受控反控"独审来源项——本修订即针对该反控面。
> 本增量只改 `server/lib/worker-host.mjs`（生产）＋`server/lib/task-scheduler.mjs`（仅文档注释）；不改测试字节、Runtime／DDL／Rust／package／守卫／前端；不跑完整 `npm run check`（III 唯一集成轮），未 push、未改状态，MAYNE-24 保持 `in_progress`。前次来源判据（`7cfef55`，记录 `d2b2696` 同链的 `docs/reviews/web-text-intake-execution-source-20261109-kimi.md`）已核事实保留，本修订只补其缓存边界。

## 1. 范围与风险级

- **范围（R2）**：`worker-host.mjs`。唯一行为变化：`state.executionSource`（`proven_safe` 授予的执行来源绑定）由**每 host 缓存一次**改为**每次 start 重新解析＋内容哈希**；spawn 的 node／入口参数由**配置字符串拼路径**改为**本次验过的真实（realpath）路径**；`runs/<runId>/worker.json` 记录随之与实际执行产物一致。其余授予条件、协议、取消、退出验证、 deadline 路径逐字节不变。
- `task-scheduler.mjs` 仅更新 `trustedTestPathSafety` 文档注释（"content-hashed at spawn"→"resolved and content-hashed at THIS spawn, and the very paths executed"），零行为变化。
- **不作为**：不新增授信开关、入口 config 字段、Runtime 协议字段；不禁用 `--runtime-root`／`workerProcessFactory`；不动 T-2／T-10 已审字节；不改测试／夹具／DDL／Rust／前端。

## 2. 修订内容（读出实际约束）

前次实现（`7cfef55`）的缺口（Codex／ZCode 指定反控面）：`executionSource()` 的结论按 host 缓存，而 spawn 仍从配置字符串 `runtimeRoot` 拼路径。若配置根是**符号链接**——先指向已审根（预热缓存，`trusted`），再换指向合成根——后续 run 沿用旧结论拿到 `proven_safe`，实际执行的却是合成入口；且即便不缓存，哈希（realpath 解析）与 spawn（配置串再解析）之间也存在替换窗口。本修订把边界改成：

- **期望摘要可缓存**：`auditedRuntimeIdentity()`（进程级缓存）只缓存**已审包的期望产物身份**（根／node／入口三方真实路径＋两个 SHA-256），其来源仍是 worker-host 模块**自身部署位置**（打包 `<bundle>/runtime`、源码树 `build/s0-runtime`），与配置无关——缓存它借不出任何结论。
- **结论不缓存、每 run 现算**：`WorkerHost` 删除 `_executionSource`／`executionSource()`；`start()` 每次对**当前**配置根做 `realpath` 解析＋node／organizer.mjs 内容哈希，与缓存期望逐一相等才 `trusted`。配置根的解析在 run 间发生变化（符号链接换向、稳定路径下换文件）时，新 run 按新事实裁决，旧结论不继承。
- **spawn 固定验过的真实路径**：默认工厂（与私有工厂同一选择代码）以 `executionSource.node`／`executionSource.entry`（realpath 结果，即刚被哈希的文件）派生进程；身份不可解析时回退配置路径且授予保持 `unknown`（记录不谎称身份）。哈希→spawn 的替换窗口由此关闭：执行的就是被记录覆盖的文件。
- **运行记录与实际一致**：`runs/<runId>/worker.json` 的 `executionSource` 是**当次**实际身份（trusted／reason／真实根／真实 node／真实入口／两哈希），与当次 argv 执行的文件同一路径。
- **私有替换接口与来源不足语义不变**：工厂在位仍不对配置根跑布局硬校验、仍正常派生运行、仍不获授予（`unknown`→`needs_review`）；期望根解析不到、实际产物不可解析均保持 `unknown`；无新增开关。
- **边界（沿用并如实登记）**：对**已审定包内产物被就地篡改**（改写 `build/s0-runtime/organizer.mjs` 本身）仍不设防——属构建树完整性，由 `probe:bundle` 的 vendor/pi 树哈希／洁净度校验与结构守卫管辖。打包 bundle 的 `runtime/` 拷贝仍属 III `build-backend.mjs` 待办（冻结装配契约要求）；落地前打包运行解析不到期望根，授予 fail-closed 保持 `unknown`——非本增量引入。

## 3. 前后证据（真实链）

运行方式：本树（AFTER）与 `git archive d2b2696` 原始树（BEFORE，同存储二进制／同 Runtime／同环境，仅 `server/lib` 字节不同；scratch 树以 `build/` 符号链接获得同一已审根）。探针 `build/web-text-intake-execution-source-cache/probe.mjs`（4 例，`node --test --test-timeout=20000`）：真实 HTTP→调度→worker-host→默认工厂真实随包 Pi／受控合成入口→loopback 受控模型服务→真实 Rust 存储，库只读观测。产物身份：存储二进制 `5311ffa3…232bd`（2 647 984 B，本树 cargo 1.99.1 `58cf8f9c3` 重建，与登记逐字节相符）、organizer `08f32db2…`、node `9d050fd4…` v24.20.0。受控合成入口为 Pi 已审夹具副本（blob `4f3c9940`／`4bea6aac`，git 对象库提取，未入分支）。

| 例 | BEFORE（`d2b2696`） | AFTER（本树） |
|---|---|---|
| A 正控：已审根真实 Pi `test` 失败 | proven_safe＋queued，退避后二次 attempt 成功，预算递减，零回执 | 同左（不回归） |
| B 负控：私有替换工厂替身 | unknown＋needs_review（stub 确已派生） | 同左 |
| C 负控：默认工厂＋直接配置合成根 | unknown＋needs_review（marker 绑定当次 run） | 同左 |
| **D 缓存边界：符号链接换向** | **`proven_safe`＋`queued`（旧结论借给合成入口）** | **unknown＋needs_review** |

D 例结构（同一后端、同一配置字符串 `runtimeRoot`＝符号链接）：run 1 链接指向已审根→授予成立、真实 Pi 执行（无 marker）、记录绑定已审身份；换向合成根后 run 2→marker（runId／hostNonce／pid／argv 与 `runs/<runId>/worker.json` 交叉核对三项相等）证明合成入口真实执行。BEFORE 的 run 2 记录仍写 `trusted:true`＋已审根／已审哈希，与 marker 的 argv（`<link>/organizer.mjs`）直接矛盾——正是"运行记录须与实际一致"要堵的面；AFTER 的 run 2 记录绑定合成身份（`trusted:false`、`reason=artifact_identity_mismatch`、`entrySha256=54e1d84c…`≠已审 `08f32db2…`），授予 `unknown`，任务 `needs_review`，零回执、confirmed 退出、无候选。

**spawn 固定真实路径（确定性探针 `probe-spawn-pin.mjs`，经工厂捕获 launcher 实参）**：链接指向已审根时 AFTER 的 launcher 收到已审真实路径（`build/s0-runtime/node`、`…/organizer.mjs`，非链接路径）；换向后收到合成根真实路径，且与当次记录逐项相等。BEFORE 的 launcher 收到 `<link>/node`（配置串再解析）——哈希→spawn 窗口的实据。

**可证伪（两个最小突变，跑后即还原）**：
- 突变 A（恢复每 host 缓存结论，保留其余修订）：4 例中 **仅 D 例转红**（run 2 回到 `proven_safe`），A／B／C 保持——每 run 重算正是承重项。
- 突变 B（保留每 run 校验，spawn 回退配置串拼路径）：spawn-pin 探针 trial 1 即红（launcher 收到 `<link>/node`）——固定验过路径单独承重。

## 4. 回归（同环境，本树字节）

- **I 单测五套 53/55**：F1／W 两红与原始树逐条相同的登记红（同命令同两点）。
- **`test:web-manual-items`**：源模式 entry＋cargo 二进制＋本树 dist 下 59/59。
- **守卫**：`check:structure` 170 条均为会话前既存 `.kimi/` 平台条目，`server/` 零违规，自测通过；`check:docs` 见本记录提交。
- **II 四套件**：按派工未重跑（本增量不触碰其面；上轮 `7cfef55` 已登记与原始树逐字节相同的 ok/not-ok 集合）。
- **未跑**：完整 `npm run check`（III 唯一集成轮）、真实模型／凭据／用户根、打包 app。GAP-5、退出保证 E、D 操作重放与整体准出不随之关闭；Pi 第四例（`6216a6b`）按派工另审，本修订不代签。

## 5. 原始证据

`build/web-text-intake-execution-source-cache/`（gitignored）：`probe.mjs`、`probe-spawn-pin.mjs`、`fixtures/`（Pi 已审夹具副本＋哈希）、`before-tap.txt`／`after-tap.txt`（各含 stderr 0 字节记录）、`before/`／`after/` 证据 JSON（含 D 例两 run 的记录与 marker 绑定）、`mutA-tap.txt`／`mutB-spawn-pin.json`、`i-unit-tap.txt`、`manual-items-tap.txt`。运行后临时根 0 残留、0 遗留进程。
