# 三修增量 `0dbae12..432305b` 限定独审（OpenCode，2026-11-09）

派工：MAYNE-24 评论 `01a1be9c`（锁定生产 `432305b6d5cd4283c6a6b8420e940c75ccccd172`／tree `c87f017863b7a519b86483938cd4b27f015e6de9`，交付记录 `ef0f0d4`）。本审延续 `01a1be39`（R8-M-1/M-2 原审、F-R8-2 原始反证）与 `9b305d9`（`c4a9c67..0dbae12` 限定独审）的既过面，按 `e12c569`／`db96401`／`432305b` 三个提交边界限定复核。原始证据 `build/mayne24-r82-fixes-review/r1/`（gitignored）。

## 结论（按三类，明确签／不签）

| 提交 | 面 | 结论 |
|---|---|---|
| `e12c569`（tree `fd046fd3`，恰 task-service 一文件 +33/−19） | F-R8-2 事务回滚不误闭新 attempt、错误码归属 | **通过（限定）** |
| `db96401`（tree `6078f95f`，恰 3 文件 +50/−29） | §4.6 路由：真实 deadline／无帧死亡／实际 Runtime error 帧分类区别、原暂存优先 | **通过（限定）** |
| `432305b`（恰 entry 一文件 +123/−99） | 启动严格类型、纯校验顺序、失败释放、原异常保留 | **通过（限定）** |

D1（`cursor_out_of_window`）为既有失败、非本批回归（本审在基点与 HEAD 各自实测，见下）；本批不关闭 R8-M-1/M-2/M-3、MCP／M-5，不提前集成。RS-1（`6f12c3a`）在本批边界之外，按 `01a1be9f` 另行续审。

## 身份复核（对象库逐字节）

- `432305b` 与锁定哈希一致；tree `c87f0178` 复算相等。生产范围 `0dbae12..432305b` 恰 4 文件 **+206/−147**：entry +123/−99、scheduler +9/−3、task-service +53/−38、text-intake +21/−7；src-tauri／DDL／003 冻结哈希／package／前端／守卫零差异（numstat 全树复核，未改面不重跑）。交付记录 `ef0f0d4` 全文读回，其登记数字与本审独立实测逐点吻合。
- 隔离树 `git archive` 导出后 `git init` 提交使 provenance 可解析：导出树 `HEAD^{tree}` 复算 **= `c87f0178`**、`HEAD:vendor/pi` **= `e89822b0`**（内容寻址，提交元数据无关）。前置链全实跑：npm ci／prepare-cli（lark-cli 1.0.98）／prepare-pi（provenance `ad702637`）／probe:bundle（organizer `08f32db2…` 2515908B、node `9d050fd4…` 121911744B）；cargo 存储二进制 **2649408B、sha256 `42af54b5…490fc2`**——全部与既往登记逐字节相同；基点树共用同一二进制（两树 src-tauri 零差异，哈希复核相等）。
- W 正反控按派工**原样**用 `82e1bf2` 更正字节（sha256 `3ab536c9…46b86`＝blob `8c641b11`，复算相等）覆盖两树，fixtures 用树自带登记 blob `5fe68cb4`／`6d638db0`，跑后不回写。

## 证据实际读回（CLI）

三修交付评论 `01a1be6b-de5e` 经 CLI 实读 **attachments=[]**——其动态数字（10/11、竞争探针、启动探针等）在评论面无原始工件可核，动态面以本审下列独立重放为准；作者文本声明与本审实测无一处冲突（含「队列套件 14 败为既有 II 配置形状问题」与 OhMyPi `01a1be84` 的修订前 TAP 一致）。交付记录 `ef0f0d4` 的身份、逐提交 diff 数字、修前修后结果表全部与实测吻合。

## 一、`e12c569` F-R8-2：通过

静态：cancel／resume 两分支任务 UPDATE 绑定读时事实（`version=?`＋`state='needs_review'`＋`attempt_exit_state='exited_confirmed'`）并声明 `expectChanges:1`；`task.changed` 事件经 `eventOp` 移入同事务；`transact` 新增按调用 `conflictCode`（默认仍 `version_conflict`，全局映射不变）。

动态（确定性竞争门重放，真实 SIGKILL→重启→恢复就绪→resolve#2 守卫读被一次性 promise 门持于过期 needs_review 快照→胜方真实 HTTP 202 收尾 attempt#1→tick 认领 attempt#2→门释放；seam 仅 fixture 缝 prototype 注入，生产字节零修改）：

| 树 | 败方应答 | attempt#2 行 | 活 worker | 判定 |
|---|---|---|---|---|
| 基点 `0dbae12` | 409 `state_conflict`（提交后） | **已闭** `exit_reason='confirmed'` | 存活（pid 实测 alive） | **缺陷复现**：`changes [0,1]` 已提交后才抛错，活 worker 被记成已核实退出 |
| HEAD `432305b` | 409 `state_conflict`（提交前） | **保持打开** `ended_at IS NULL` | 存活 | **修复成立**：整事务提交前回滚，任务停留 running，胜方 attempt#1 正常收尾 |

- 注：原探针脚本随 `build/` 回收不可恢复，本探针按 `01a1be39` 登记的确定性机制重写（同崩溃/恢复/门控时序），两树结果与原反证签名一致。
- 错误码归属：显式恢复项版本失配（`expectedVersion=itemVersion+99`）→ 409 **`version_conflict`**、零写入（version 不变）；并发状态前提丢失 → 409 **`state_conflict`**；全局映射未改。
- cancel 分支未单独动态重放（其新 attempt 伤害场景需要 resume 重认领才有观测物）；按行级同一性签：与 resume 分支相同的绑定／`expectChanges`／`eventOp`／`conflictCode` 形状，逐行复核一致。作者 cancel 聚焦探针声明无附件，不代签、不反证。

## 二、`db96401` §4.6 路由：通过

静态：`deadlineTriggered` 沿 scheduler → `confirmExtractExit/confirmReviseExit` 真实传递且仅在无暂存时查阅；注册表删除 `isolateOnUnknownSafety`，unknown→needs_review 改为码无关；信封统一经 `normalizeFailure`（别名表 `RUNTIME_PROTOCOL`→`worker_lost` 等，公开信封无 `internalCode`）；暂存分支完全不查阅 deadline 事实。

动态（`82e1bf2` 原样正反控＋分类三面探针，真实 entry→HTTP→调度→WorkerHost→真实 stub 进程→真实存储）：

| 运行 | 基点 `0dbae12` | HEAD `432305b` |
|---|---|---|
| 全套 11 例（HEAD） | — | **10 过 1 败**：PC1/PC2/M1a/M1b/M1c/F1/E1/E2/**W(deadline)**/**W(worker loss)** 绿；stderr 0 字节 |
| W 两面（name-pattern 单跑） | **双面红**，均败于 `failed ≠ needs_review` 安全路由判据（可证伪性成立） | — |
| deadline（bare＋1200ms） | `failed`＋`worker_lost`/manual（超时被记成丢失且停 failed） | `needs_review`＋**`model_request_failed`/`auto_backoff`**＋exit confirmed |
| 无帧死亡（stub 500ms exit1 零帧） | `failed`＋`worker_lost`/manual | `needs_review`＋**`worker_lost`/`manual`**＋exit confirmed |
| 实际 Runtime error 帧（stub 发真实 `RUNTIME_PROTOCOL` 错误帧后退出） | `failed`＋`worker_lost`/manual | `needs_review`＋**`worker_lost`/`manual`**，帧内诊断码**不泄漏**（无 `internalCode`）、非静默成功、exit confirmed |

分类区别成立：真实 deadline → `model_request_failed`/`auto_backoff`；无帧死亡与实际 Runtime error 帧 → `worker_lost`/`manual`（帧码属内部诊断，公开层按注册码归属），三类均不静默成功、均按码无关 unknown 路由落 `needs_review`。

原暂存优先（保留面，两树均须过）：result-hang 暂存落库后 deadline 击杀挂起 worker → 两树均 **succeeded＋暂存候选发布（status pending）＋exit confirmed**——修复未让 deadline 事实覆盖暂存结局（§3.2/§6.1.1 不变）。

## 三、`432305b` 启动：通过

动态（生产 entry、进程级适配器计数 ppid=探针进程）：

| 检查 | 基点 `0dbae12` | HEAD `432305b` |
|---|---|---|
| `'500'`／`null` | **接受**（coercion／当缺省）并泄漏适配器 | **拒绝**，精确报错 `workerRunLimitMs 必须是 1–120000 的整数。` |
| `0`／`-1`／`120001`／`1.5` | 拒绝但在适配器启动**之后**（每例泄漏 1 个适配器，计数实测 3/4/5/6） | 拒绝且**适配器子进程恒为 0**——纯校验先于任何资源开启 |
| 省略 → 缺省 | — | WorkerHost 实得 `120000`；适配器正常开启、close 后释放 |
| 边界 `1`／`120000` | — | 接受且实值一致 |
| EADDRINUSE 装配失败 | 适配器**不释放**（泄漏） | 已开适配器**释放**（计数回落）；**原异常保留**——原生 `Error`、`code='EADDRINUSE'`，非包装替换 |

进程清理后本机零残留适配器。try/catch 移动块逐行复核为纯再缩进＋try 包裹（装配语义、pairing 钩子、shutdown、return 形状不变）；释放顺序 scheduler→SSE→HTTP→storage 非严格逆构但功能正确（worker 先于适配器停止），登记为观察项不计缺陷。

## D1：既有失败，非本批回归

HEAD 全套中 D1 唯一红，失败点 `cursor_out_of_window`（`last reset reason`）；本审另在基点 `0dbae12` 单独重放 D1（name-pattern 单跑）→ 同一失败点逐字相同，stderr 均 0 字节。归属不变（Kimi 的 D1／任务事件补偿批次），不计本批回归。

## 新发现与新登记（不阻断本批）

1. `retry`（:514-524）与 cancel-intent／cancel 路径（:478/:490）仍有事后 `insertEvent`——`retry` 幻影事件已在 `9b305d9` 登记、队长已纳入 Kimi 当前 D1／事件补偿批次；cancel 族同形，属该批「覆盖 claim／stage／retry／cancel／resolve 事件一致性」的既有授权范围，非本批新缺陷（本批 resolve 两分支已同事务化）。
2. 本批边界外顺带确认：`db96401` 导出 `FAILURE_REGISTRY`／`normalizeFailure` 供收尾信封共用，test-kind 失败经 `stageResult` 同样归一（`RUNTIME_PROTOCOL`→`worker_lost`），与 extract 面一致。

## 边界

未跑完整 `npm run check`（III 集成轮，非本派工）；未重跑未改 Rust 测试与前端套件（范围零差异，numstat 复核）；E1/E2/时区面沿既有过面复用（E1/E2 在本审全套中保持绿；entry 移动块为纯再缩进，时区装配线未变）；未 push、未改工单状态；无真实模型／凭据／用户根（合成 controlled:e2e、死端口 baseUrl、stub worker、合成根）；隔离树用后即删、零残留进程；seam 注入仅 fixture 缝，两树 tracked 字节零修改。
