# W1 执行来源判据＋T-2／T-10 三提交限定独审（ZCode，2026-11-09）

> 派发：MAYNE-24 协调评论 `01a1c04a-83c8-7c97-898d-5e58929acf32`（Codex，2026-11-09）——并行独审三项、分别给结论：来源项用真实 stock 正控、原替换工厂负控、默认工厂非审定入口负控（可用 `6216a6b` 作验证输入，不预签其聚合准入）；再核暖宿主的实际来源绑定（私有 runtimeRoot 符号链接先指向已审根预热、再换指向合成根的受控反控；不改已审包）。T-2 核三路由准确不可用且不落配置、organizer／未知标识／鉴权不退化；T-10 核限定约束映射、整批回滚、台账重放／竞态与其他错误不被泛化吞掉。只做必要聚焦，不跑完整 gate。
> 本审者未写任何受审字节（受审生产提交与记录均为 Kimi 在 `agent/kimi/mayne-24` 交付；`6216a6b` 为 Pi 在 `agent/pi/mayne-24` 交付）。评审记录 docs-only，MAYNE-24 保持 `in_progress`。

## 结论（分别）

| 项 | 提交 | 判定 |
|---|---|---|
| 来源项 | `7cfef553` | **不通过——限「暖宿主实际来源绑定」面**（动态复现 2/2 次：换向后实际执行合成入口，判定与 per-run 记录仍是已审身份，`proven_safe`＋自动重排队）；派工的三个来源控制面（stock 正控／替换工厂负控／非审定入口负控）全部按预期，冷启动缺口确认关闭 |
| T-2 | `be8be1a` | **通过——限派工面**（三路由 404 `not_found` 且不落配置、organizer／未知标识／鉴权不退化；BEFORE 缺口逐面复现） |
| T-10 | `e98b85b` | **通过——限派工面**（两族约束文本经真实存储二进制逐字采集并映射 409、整批回滚动态证实、replay／`idempotency_conflict`／CAS `version_conflict` 均不被吞） |

来源项的总判定随暖宿主面为不通过：绑定的静态构造（期望值取自宿主模块自身部署位置、待验 root 自带清单不参与、任何不可解析即整体 `unknown`）方向正确且冷启动有效关闭，但 Codex 派工指出的「executionSource 按 host 缓存、spawn 仍从配置字符串拼路径」经受控反控成立——可信来源不足的场景在暖宿主下仍会借到旧信任结论。Kimi 已被同派工点名补最小修订（每 run 核对／固定实际可执行路径，运行记录与实际一致）；修订出来后按本记录 §2.4 的差异点检接收即可，T-2／T-10 不受其影响。

## 1. 身份与运行输入

- 候选链（对象库直读，共享对象库；未触碰 Kimi 工作树）：`e94ec84`（生产＝`72f1bb8`）→ `7cfef553`（恰 `worker-host.mjs`＋`task-scheduler.mjs`）→ `be8be1a`（恰 `http-server.mjs`＋`config-store.mjs`）→ `e98b85b`（恰 `text-intake-service.mjs` +28/−0）→ 记录 `d2b2696`（docs-only）。父链逐项核实；相对 `e94ec84` 恰五生产文件 +218/−17，与派工锁定一致。
- 归因有效性：`git diff 7cfef553 e98b85b1 -- worker-host task-scheduler` 为空、`be8be1af..e98b85b1` 仅 `text-intake-service.mjs`——来源项的动态面跑在 `e98b85b1` 顶端与跑在 `7cfef553` 逐字节等价；T-2／T-10 动态面同理覆盖各自提交字节。
- 运行树：`git archive` 双提取（重提取 `diff -r` 零差异）两棵——`rt-after`＝`e98b85b1` 字节、`rt-before`＝`e94ec84` 字节；各加 3 个未跟踪 overlay 作验证输入：`6216a6b` 的 4 例版测试文件＋`test-safety-runtime-entry.mjs`＋`test-safety-stub-worker.mjs`（第三例夹具只存在于 Pi 链；首次运行漏带该 overlay 时**两**树第三例同红 `worker_lost`，补齐后复现登记形态——原始 run0 TAP 留档）。
- 产物：存储二进制 `5311ffa3…232bd`（2 647 984 B）、s0-runtime organizer `08f32db2…`／node `9d050fd4…`，复制后 SHA-256 复算逐一命中登记身份；runner node v24.20.0。未跑完整 gate；未触真实模型／凭据／用户根（合成 key、loopback 受控服务、合成临时根、真实 Rust 存储经已审二进制）。

## 2. 来源项 `7cfef553`

### 2.1 三个派工控制（4 例套件，`node --test --test-timeout=20000`）

| 运行 | 结果 |
|---|---|
| AFTER（`e98b85b1` 字节） | **4/4 PASS，exit 0，stderr 0 字节**：真实 stock 正控（真实随包 Pi→loopback 受控模型全序列 proven_safe→queued→窗口内不认领→时钟推进后二次 attempt 成功）、替换工厂负控（`stubInvocations===1`、legal 帧→needs_review）、**默认工厂非审定入口负控（`6216a6b` 第四例）绿**（合成根→`unknown`／needs_review，marker 证明入口真实派生） |
| BEFORE（`e94ec84` 字节） | **3 pass / 1 fail，exit 1**：唯一红恰在 `GAP-TEST-SAFETY-2` 守卫断言（observed `sideEffectSafety=proven_safe state=queued`）——登记缺口在基点逐字复现；三例原断言保持绿 |

`6216a6b` 仅作验证输入使用，其聚合准入不在本审签名范围。

### 2.2 暖宿主符号链接反控（本审新增，派工点名）

探针：私有目录中建 `runtime-link` 符号链接指向运行树 `build/s0-runtime`，以它为配置 `runtimeRoot` 启动生产后端（默认工厂）；**阶段 1**（预热）跑一个真实 Pi test 任务至 succeeded，`runs/<runId>/worker.json` 记录 `trusted=true, reason=audited_deployment_runtime`，runtimeRoot/node/entry 为已审根真实路径＋登记哈希——绑定本身工作正常。**阶段 2**（换向）：同一符号链接改指合成根（系统 node 符号链接＋测试专用入口），同一后端（暖宿主）提交第二个 test 任务：

- marker（runId/hostNonce/pid 与 run 2 的 worker.json 交叉核对相等，`argv[0]=<link>/organizer.mjs`）证明**默认工厂经配置字符串真实执行了合成入口**；
- 同一 `worker.json` 却记录 `trusted=true`＋已审根的路径与哈希（`worker-host.mjs:384` 消费 `executionSource()` 的 `:306` 惰性缓存；spawn 的 `:402-403` 每次从 `this.runtimeRoot` 拼路径）——**per-run 审计记录与实际执行产物不一致**；
- 判定面：`sideEffectSafety=proven_safe`、任务 `queued`（自动重排队）——**泄漏成立，2/2 次确定**（`symlink-after.out`、`symlink-after-run2.out`）。调度器 `:423` 的 `state.executionSource?.trusted !== true → unknown` 读到的是陈旧缓存，冷启动修复在暖宿主换向场景完全旁路。

该反控不改已审包任何字节（符号链接在私有临时目录），不属 Kimi 记录登记的「包内就地篡改」排除项。

### 2.3 静态核对其余判据

`verifyExecutionSource` 的期望值只来自宿主模块自身部署位置（`trustedRuntimeRoot`），不读配置 runtimeRoot、不信任待验 root 清单；任一不可解析即整体 null→`unknown`（fail-closed）；路径＋双哈希五元全等才 trusted；工厂在位时跳过布局硬校验（`recovery-instance.mjs` 形态不误杀）——与记录声明一致。私有替换接口在本审 4/4 中保持工作（第三例绿）。

### 2.4 修订后差异点检建议（给下轮审）

最小验收面：① 同一暖宿主换向场景下第二 run 判 `unknown`／needs_review 且 worker.json 记录与实际执行产物一致（本探针原样可复用）；② 4 例套件保持 4/4；③ 私有替换工厂与 `--runtime-root` 显式指向已审根两形态行为不变。

## 3. T-2 `be8be1a`（HTTP 探针，两树各 16 面）

| 面 | BEFORE（`e94ec84`） | AFTER |
|---|---|---|
| tracker/advisor GET | 200（制造默认草稿，缺口复现） | **404 `not_found`**（「该智能体角色不在本切片接线范围内。」） |
| tracker/advisor PUT、reset | 409 `version_conflict`（草稿 CAS 面） | **404 `not_found`** |
| 不落配置 | 目录检视：全程无 tracker/advisor 文件 | 同左；检视非空洞（organizer PUT 200 后 `organizer.json` 出现、reset 后消失） |
| organizer | GET 200／PUT（带 CAS）200／reset 200 | 同左，不退化 |
| 未知标识 `bogus-role` | 400 `validation_failed`（落穿 store 校验） | 同左，保留 |
| 鉴权 | 无会话 GET 401 `unauthenticated`、无 CSRF PUT 403 `csrf_invalid` | 同左，不退化（auth 门先于接线门，404 不遮蔽 401/403） |

静态：`requireWiredAgent` 只在会话／写校验之后、store 调用之前；`config-store` 三角色域储备不动（仅导出 `AGENT_IDS`）；`not_found: 404` 映射新增（`readAgent` 的制造草稿路径不再被未接线角色触达）。边界登记：未匹配 `/api/*` 路径走 `serveStatic`（两树同），派工未要求追该面。

## 4. T-10 `e98b85b`（HTTP 探针＋只读 SQL 检视，两树）

- **限定约束映射**：种子行占用 `manual_item_events.operation_id`＝本批派生键（`sign_off:`+SHA-256，逐字复算）→ BEFORE **500 `internal_error`，message 逐字＝`UNIQUE constraint failed: manual_item_events.operation_id`**（真实存储二进制采集，独立证实 Kimi 的约束文本清单）；同探针换种子到 `manual_item_sources.operation_id` → BEFORE 500 逐字第二族文本。AFTER 两变体均 **409 `state_conflict`**。精确匹配为逐字等（`isOperationKeyConflict`），非子串泛化。
- **整批回滚**：409 后只读检视——被签候选仍 `pending` v1、`sign_off_batches` 仅存量成功批、`manual_item_sources` 无新行、无新 manual_items、占位行原样。
- **台账重放／竞态不退化**：同 operationId 同请求首答 200 `replayed:false`、重放 200 `replayed:true`；同 operationId 异请求 409 `idempotency_conflict`（两树一致）。
- **其他错误不被泛化吞掉**：陈旧 expectedVersion（CAS 失利）→ 409 `version_conflict`（非 state_conflict，两树一致）。
- 边界登记：第三族文本 `sign_off_batches.operation_id` 只在 SELECT 与 INSERT 的竞态窗口可达（预置占用会被台账合并分支先接住→`idempotency_conflict`），本审仅静态核对，未做竞态窗口注入；不跑完整 gate。

## 5. 证据与卫生

原始证据 gitignored `build/mayne24-execsource-t2t10-review/`（两树 4 例套件 TAP＋run0 留档、T-2／T-10 前后探针输出、symlink 反控两轮输出、探针脚本、identity.txt、SHA256SUMS 24 项；stderr 全部 0 字节）。运行树与临时根全部删除、零进程残留；本审分支仅本 docs-only 提交。`check:docs` exit 0 后提交。不预签 `6216a6b`／来源项聚合准入；聚合与集成准入仍归协调者。
