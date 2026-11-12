# W1 执行来源判据修订＋T-2／T-10 生产小修（Kimi，2026-11-09）

> 生产候选，待派未参与本增量的成员独审；作者不自签。派发：MAYNE-24 协调评论 `01a1bffb-3fe7-76f9-b208-001f439eeacf`（Codex，2026-11-09）——"请收尾当前日期 DTO 小提交后，独立修此来源判据：授予绑定实际 node、入口及已审执行依赖的可信产物身份，期望值须有独立可信来源，不能只查路径／存在性或相信待验 runtimeRoot 自带清单；校验不足保持 unknown。校验用于安全授予，不借机禁用既有私有替换运行接口，不新增授信开关／Runtime 字段。正控与原两负控保持，Hermes 的默认工厂＋非审定入口反例转为 unknown 后再交差异独审；旧证据不用重做。"
> 同派工另读 `d750c6b`（OpenCode 只读归属判定）：T-2（已知未接线 tracker/advisor 配置 GET/PUT/reset）与 T-10（签收保留台账竞态合并）接收为生产须修，各交小提交、均另送独审。
> 本增量只改 `server/lib` 5 文件；不改测试字节、Runtime／DDL／Rust／package／守卫／前端；不跑完整 `npm run check`（III 唯一集成轮），未 push、未改状态，MAYNE-24 保持 `in_progress`。日期 DTO 小提交（`72f1bb8`＋记录 `e94ec84`）已在本基点前收尾，本增量从其顶端继续。

## 1. 范围与风险级

- **范围 A（执行来源判据，R2）**：`worker-host.mjs`＋`task-scheduler.mjs`。唯一行为变化：`proven_safe` 授予在"默认工厂"之外新增**实际执行产物的可信身份绑定**；其余授予条件与全部其他路径逐字节不变。
- **范围 B（T-2，R2）**：`http-server.mjs`＋`config-store.mjs`（仅导出既有 `AGENT_IDS` 常量）。唯一行为变化：已知未接线角色（tracker/advisor）的配置 GET/PUT/reset 由"制造默认草稿 200"改为 404 `not_found`；未知标识保持 400 `validation_failed`；organizer 接线路径不变；config-store 三角色域储备不动。
- **范围 C（T-10，R1）**：`text-intake-service.mjs`。唯一行为变化：签收事务撞已审派生键 `operation_id` UNIQUE 且本批次无台账行时，由裸 SQL 错误（500 面）改答 `state_conflict` 409；台账竞态合并、`idempotency_conflict`、其他 SQL 错误原样重抛均不变。
- **不作为**：不禁用 `--runtime-root`／`workerProcessFactory`（仍可正常派生运行，只是不获授予）；不新增授信开关、入口 config 字段、Runtime 协议字段、DDL、台账；不借机改 `WEB_BACKEND_CONDITION_FAILED` 既有映射（CAS 失利已由 `transact` 包装映射 `version_conflict`，非本派工面）；不动 II 夹具与四套件。

## 2. 范围 A：执行来源判据（`verifyExecutionSource` → `state.executionSource`）

Hermes `a20c9bc` 实证：默认工厂（无 `workerProcessFactory`）＋临时合成 runtime 根（系统 node 符号链接＋测试专用入口）同样拿到 `proven_safe` 并被自动重排队——`replacementFactory` 缺失不等于"真实随包 Pi"。修法把授予绑定到**实际被 spawn 的产物身份**：

- **实际身份**（`runtimeArtifactIdentity`）：对配置的 `runtimeRoot` 取 `realpath`，解析实际 `node` 与 `organizer.mjs` 两个真实路径并计算 SHA-256 内容哈希；任一不可解析／不可读即整体 `null`（不部分信任）。
- **期望值来源**（`trustedRuntimeRoot`）：从 **worker-host 模块自身部署位置**推导（`<模块目录>/../../`），与配置的 `runtimeRoot`、runtimeRoot 自带清单（如 `source.json`）都无关——打包布局取 `<bundle>/runtime`，源码树取 `<repo>/build/s0-runtime`（`<repo>/runtime` 是无 `organizer.mjs`/`node` 的源码形态，按 bundle 形态判定跳过）。解析不到即 `null`，授予保持 `unknown`，不猜。
- **绑定**：实际与期望的根、node、入口三方路径及两个内容哈希全部相等才 `trusted`；每 host 惰性计算一次（node 二进制只哈希一次），逐 run 记入 `state.executionSource` 与 `runs/<runId>/worker.json`（审计轨迹）。
- **判据消费**（`trustedTestPathSafety`）：在既有"默认工厂"条件之后新增 `state.executionSource?.trusted !== true → unknown`；其余 7 条绑定（类型／快照／合法帧／整树退出／无工具 MCP 帧／回执事实／当前 attempt-epoch）与文档逐字保留。
- **私有替换接口不受影响**：工厂在位时**不**对配置根跑布局硬校验（工厂自带载荷二进制，配置根布局与其无关——`recovery-instance.mjs` 正是"默认根＋工厂替身"形态，硬校验会误杀该接口）；默认工厂才校验布局（缺失即既有 `runtime_start` 类型化失败）。身份校验只影响授予，不影响派生。
- **边界（如实登记）**：绑定关闭"配置指向非审定根／合成根"这一类来源不明；对**已审定包内产物被就地篡改**（改写 `build/s0-runtime/organizer.mjs` 本身）不设防——那属于构建树完整性问题，由 `probe:bundle` 的 vendor/pi 树哈希／洁净度校验与结构守卫管辖。另：打包 bundle 的 `runtime/` 拷贝属 III `build-backend.mjs` 待办（冻结装配契约要求），在其落地前打包运行解析不到期望根，授予保持 `unknown`（fail-closed），且入口默认路径本身同样无法 spawn——非本增量引入。

## 3. 范围 B：T-2 智能体配置接线门（按 `d750c6b` 冻结依据）

- 生产链（只读判定已核）：`http-server.mjs` 正则接受任意 agentId → `config-store.readAgent` 在文件缺失时**制造默认草稿**并 200；`PUT`/`reset` 走同一集合。与契约 §5.3"本切片只接线 organizer"及生产任务面 `TASK_ROLES=['organizer']`（非 organizer 提交即 400 `unknown_role`）自相矛盾。
- 修法：HTTP 面按接线集 `{organizer}` 门控（`requireWiredAgent`，在会话／写校验之后、store 调用之前）——已知未接线角色 404 `not_found`（本切片不提供该角色端点）；标识不在固定角色集时**落穿**到 store 既有校验（400 `validation_failed`，未知标识原校验保留）；config-store 三角色草稿与域储备不动（仅导出既有 `AGENT_IDS` 供门控判别）。
- 配套：`STATUS_BY_CODE` 增加 `not_found: 404`（该码原被 `:365` 未知路由抛出却映射 500，状态与码不一致；此次一并修正，未知路由随之返回其声明码）。

## 4. 范围 C：T-10 签收操作键竞态映射（按 `d750c6b` 冻结依据）

- 生产链（只读判定已核）：跨族占键（他族行先占 `manual_item_events.operation_id`＝本批派生键）时事务整体回滚已成立，但 catch 只查 `sign_off_batches` 无行便重抛裸 SQL 错误 → 500 面。
- 修法：catch 内保留既有台账竞态合并（同规范请求重放／异请求 `idempotency_conflict`）；**无本批台账行**时，仅当错误信息逐字等于已审操作键族的 UNIQUE 约束文本（`manual_item_events.operation_id`／`manual_item_sources.operation_id`／`sign_off_batches.operation_id`，实测消息形状经真实存储二进制探针采集）才答 `state_conflict` 409；其他 SQL 错误原样重抛，不泛化吞掉。`WEB_BACKEND_CONDITION_FAILED`（CAS 失利）与 SQL 错误不同码，不存在误路由。

## 5. 前后证据

运行方式：本树（AFTER）与 `git archive e94ec84` 原始树（BEFORE，同二进制／同 Runtime／同环境，仅 `server/lib` 字节不同）；源码模式入口＋`WEB_TEXT_INTAKE_*` 显式指向。锁定三例以未跟踪 overlay 原样使用（`0443e00` 测试 `10eb7031`＋夹具 `4f3c9940`，与锁定逐字节相同），验证后已删除，`tests/` 对分支零差异。命令逐字：

```
node --test --test-timeout=20000 tests/unit/web-text-intake-test-safety.test.mjs   # 锁定三例
node tests/probes/web-text-intake-execution-source-counterexample.mjs              # Hermes 反例（scratch）
node tests/probes/t2-agent-gate-probe.mjs                                          # T-2 面（scratch）
node tests/probes/t10-signoff-race-probe.mjs                                       # T-10 面（scratch）
```

### 5.1 执行来源判据

| 运行 | 结果 |
|---|---|
| BEFORE（反例探针，`e94ec84` 字节） | marker 证明默认工厂真实派生合成入口；合法身份错误帧／零回执／confirmed 退出俱全 → **`proven_safe`＋`queued` 自动重排队**（漏洞复现） |
| AFTER（同探针，本树字节） | 同链同事实 → **`unknown`＋`needs_review`**，`cause=failure_unknown_side_effect`，不重排队 |
| 锁定三例 BEFORE（`e94ec84` 字节，即 `ceece1f` 证明＋DTO 之上） | 3/3 exit 0 |
| 锁定三例 AFTER（本树字节） | 3/3 exit 0，stderr 0 字节；正控全序列（proven_safe→queued→窗口内不认领→时钟推进后二次 attempt 成功→预算递减→零回执），两负控保持 unknown/needs_review |

**可证伪（两个最小突变，跑后即还原）**：
- 突变 A：`trustedRuntimeRoot` 只保留 `<base>/runtime`（去掉 bundle 回退）→ 正控恰红在 GAP-TEST-SAFETY-1 目标断言（observed `unknown`/`needs_review`）——正控的授予**经新绑定成立**，非绕行。
- 突变 B：删去 `state.executionSource?.trusted` 条件 → 反例探针回到 `proven_safe`＋`queued`，锁定三例仍 3/3——该条件正是堵口项，单独承重。

### 5.2 T-2 / T-10

| 探针面 | BEFORE（`e94ec84` 字节） | AFTER（本树字节） |
|---|---|---|
| organizer GET | 200 | 200 |
| advisor/tracker GET | **200（制造默认草稿）** | **404 `not_found`** |
| advisor PUT/reset | **409 version_conflict（草稿 CAS 面）** | **404 `not_found`** |
| 未知标识 GET | 400 `validation_failed` | 400 `validation_failed`（保留） |
| organizer PUT/reset（CAS 往返） | 200 | 200 |
| 跨族占键签收 | **裸 `WEB_BACKEND_SQL_ERROR: UNIQUE constraint failed: manual_item_events.operation_id`（500 面）** | **409 `state_conflict`**，整批回滚（事项数不变、候选留 pending） |
| 同 operationId 同请求重放 | replayed 合并 | replayed 合并（不变） |
| 同 operationId 异请求 | `idempotency_conflict` | `idempotency_conflict`（不变） |
| 新建／link 签收 | 200 | 200（不变） |

## 6. 回归（同环境，本树合并字节）

- **I 单测五套 53/55**：F1／W 两红与 `e94ec84` 原始树逐条相同（同命令同两点；`recovery` 在基树上同跑 8/10 对照）。期间发现并修正一处自身引入的回归：布局硬校验最初无条件执行，误杀"默认根＋私有工厂替身"接口（`recovery-instance.mjs` 形态，PC1/PC2 红）；改为工厂在位不校验后 PC1/PC2 恢复，F1/W 回到登记红。
- **`test:web-manual-items` 59/59**（源码模式 entry＋cargo 二进制）。
- **II 四套件**：与原始树逐项 diff，ok/not-ok 集合**逐字节相同**（http 6/24、queue 4/31、controlled-model 5/28、static 5/14）；红因均为会话前既存——II 夹具 providers 缺 `name` 被现行配置规范化拒（`validation_failed`）与静态套件要求打包 CLI／真实 dist 的 PrerequisiteGap，两树一致，无 II 断言改动。
- **守卫**：`check:structure` 173 条＝170 条会话前既存 `.kimi/`／`.multica/` 平台条目＋3 条环境性 `ref.missing`（本工作树 vendor/pi dist 构建产物缺失，被引文件未改），`server/` 零违规；`check:docs` exit 0（21 文件 513 链接）。
- **未跑**：完整 `npm run check`（III 唯一集成轮）、真实模型／凭据／用户根、打包 app。GAP-5、C4／日期点后续、回执审清理错误传播（ZCode 另修）均不变。

## 7. 产物身份与准入

- 分支 `agent/kimi/mayne-24`，基点 `e94ec84dd02944302ca58c9a70b1ca6fc7d5839c`；生产提交见本节末三条，记录提交一条。
- 存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，rustc 1.99.1 `58cf8f9c3`，登记身份，逐字节复制后复算）。
- 随包 Runtime：organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`（2 515 908 B），node `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`（121 911 744 B，v24.20.0）；`HEAD:vendor/pi`＝`e89822b0…` 与包内 `source.json` 登记树一致。
- 准入与原始证据：`build/web-text-intake-execution-source/`（gitignored）：`admission.json`、三例 TAP、反例／T-2／T-10 前后探针输出、I 单测／manual-items TAP、II 四套件前后 ok/not-ok、守卫输出、`SHA256SUMS`。
- 旧证据不重做：`c32c251`（安全证明）、`e94ec84`（日期 DTO）按原范围保留；本增量只在其上新增来源绑定与两个小修。
