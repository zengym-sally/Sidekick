# W1 可信 `test` 路径安全证明生产增量（Kimi，2026-11-09）

> 生产候选，待派未参与本增量的成员独审；作者不自签。派发：MAYNE-24 协调评论 `01a1bfcb-f5a6-76ad-ad30-54d2c7d4853f`（Codex，2026-11-09）——"预览已交付，现正式接续既派可信 test 安全证明……真实正控转绿、extract 与同类型不可信来源两负控保持 unknown 后，另交独立生产小提交与前后证据；日期点后继仍由服务端／客户端各负其责，MAYNE-24 保持 `in_progress`"。
> 本增量闭合 GAP-TEST-SAFETY-1 的**生产侧**（`959f54b`/`0443e00` 登记的测试侧正控红），不改测试字节、不改 Runtime／DDL／package／守卫／前端／II 套件，不跑完整 `npm run check`（III 唯一集成轮），未 push、未改状态。

## 1. 范围与风险级

- **范围**：`server/lib` 恰 3 文件（`task-scheduler.mjs`、`task-service.mjs`、`worker-host.mjs`），+101/−0。唯一行为变化：generic（`test` kind）worker 失败在 stage 前的安全面判定新增一条**可信路径证明**；其余路径（extract／revise 收口、配置类 launch 失败、取消、暂存、deadline）逐字节不变。
- **风险级 R2**：改变 `test` kind 失败的路由（`unknown→needs_review` 变为证明成立时 `proven_safe→queued/manual`）。影响面由锁定三例与下述反控承载；extract／revise 不受影响（代码路径互斥）。
- **不作为**：不为全绿改测试；不把组／注册集为空当证明；不接收客户端／模型证明；不动 GAP-5、日期点后继（C4 源点／显式 `sourceAt`）、退出保证边界。

## 2. 锁定输入与产物身份

- **测试输入**：`0443e00d7696ee6f87d5f80cb88b14745c561907`／tree `8764036bffe8840ffac39852dd547f064e6c4bf7`（三例：extract 负控／真实 Pi 正控／私有替换工厂负控；ZCode `eb9d461` 限定通过，前序 `d1b87e2`）。本树以未跟踪 overlay 原样使用，blob 复核 `10eb7031`（测试）／`4f3c9940`（夹具），与锁定逐字节相同；`tests/` 对锁定生产输入 `0536a44` 零差异（`git diff 0536a44 HEAD -- tests/` 为空）。
- **生产基点**：`a3506af9e3cce66e67a39be9d812b55330d1c51e`／tree `d77ecf05158aff6569a2cd274c0f5da8d1107d54`（分支 `agent/kimi/mayne-24`）。
- **存储二进制**：`src-tauri/target/release/web-backend-storage`＝`5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，rustc 1.99.1 `58cf8f9c3`）——按 `6c269ea`／`01a1bfb8` 登记的新构建身份（输入树 `48b54730`）；旧 `42af54b5…` 证据不迁签。
- **随包 Runtime**：`build/s0-runtime`，organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`（provenance `ad702637`／`e89822b0`），node v24.20.0。
- 准入登记：`build/web-text-intake-test-safety-proof/admission.json`（gitignored）。

## 3. 证明的绑定（`TaskScheduler.trustedTestPathSafety`）

Frozen §4.6 对每个注册码都把未证明副作用路由到 `needs_review`——失败码永远不是安全证明。本证明是 worker 产生失败的**唯一** `proven_safe` 授予点（另两处是无 worker 运行的配置类 launch 失败），且只在下述事实**全部**成立时授予：
1. 任务类型是服务端 `test` kind（固定无工具路径；extract／revise 各走自身收口，保持 `unknown`）；
2. 运行快照是任务行上**服务端派生**的 `input_ref.snapshot`（含 provider／model 身份；客户端携带快照从不落为可信）；
3. worker 由**默认工厂**派生——真实随包 Pi，绝不是私有替换工厂（`state.replacementFactory`）；
4. 失败来自本 run 的**合法身份帧**（`state.errorFrame`；无帧死亡／被丢帧不含）；
5. worker **整树退出已验证**（`treeVerified === true`；单进程观察不算）；
6. **无工具／无 MCP**：本 attempt 未观测到 `progress{phase:'tool'}`／`mcp`／`worker` 帧；
7. **回执持久化事实充分**：无回执写失败，且库内该 attempt 回执计数为 0（`hasNonReadonlyReceipts` false＋`receiptCount` 0）；
8. **当前 attempt/epoch**：判定对正在收口的 attempt 计算，经 epoch 围栏的 `stageResult` 落库，旧 attempt 不能继承。

任务类型或零计数单独从不构成判定；backend deadline 击杀（`deadlineFailure`）显式跳过证明。客户端或 worker 载荷携带的 `sideEffectSafety` 声明到不了本方法——只有宿主观测事实与服务端行。

## 4. 前后证据（锁定三例，真实链）

运行方式：本树（AFTER，修复字节）与 detached `a3506af` 工作树（BEFORE，生产字节同基点）＋同一锁定 overlay＋同一产物；BEFORE 树以符号链接接 `build/s0-runtime`，`WEB_TEXT_INTAKE_STORAGE_BIN` 指向上述二进制。命令逐字：

```
node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-test-safety.test.mjs
```

| 运行 | 结果 | 退出码 | stderr |
|---|---|---|---|
| BEFORE run1 | tests 3／pass 2／fail 1（正控红） | 1 | 0 B |
| BEFORE run2 | tests 3／pass 2／fail 1（正控红） | 1 | 0 B |
| AFTER run1 | tests 3／pass 3／fail 0 | 0 | 0 B |
| AFTER run2 | tests 3／pass 3／fail 0 | 0 | 0 B |

- **BEFORE 红点**恰为 GAP-TEST-SAFETY-1 目标断言（`:394:10`，expected `proven_safe`／actual `unknown`），信封与登记逐字节相同 `{output_contract_invalid, 整理进程返回错误。, auto_backoff, unknown, failure_unknown_side_effect}`；确定性（两轮同点）。
- **AFTER 正控全目标序列成立**：`proven_safe`→`queued`＋`next_attempt_at>` 时钟→窗口内不认领→推进时钟后二次 attempt 成功→预算递减→仍零回执；两负控保持 `unknown`/`needs_review`（extract 含伪造客户端证明字段；私有替换工厂 `stubInvocations===1`）。用例时长 2 139／1 406／4 458 ms（run1）≪ 20s 含清理。
- 运行后零临时根、零本树进程残留（`pgrep` 实测）。

## 5. 可证伪反控（最小，跑后即删）

- **工厂判据承重（端到端突变）**：scratch 副本仅删去 `if (!state || state.replacementFactory) return 'unknown';` 的工厂条件→第三例（未可信来源）恰红在守卫断言 `an untrusted execution source must never be promoted to proven_safe`（actual `proven_safe`）。即：私有替换工厂正是被该条件挡住，非空真。
- **判据矩阵（单元级 15/15）**：对 `trustedTestPathSafety` 从全好基线逐条翻转每个事实（类型／快照／工厂／身份帧／退出验证／工具帧／MCP 帧／worker 帧／回执写失败／非只读回执／回执计数／无宿主记录），每翻一条判定回落 `unknown`——每条绑定单独承重（`probe-criteria-matrix.txt`）。
- 不重打生产 scratch 补丁、不重复四套件或完整 gate。

## 6. 回归（同环境，本树字节）

- **I 单测五套**：`web-text-intake`／`events`／`lifecycle`／`mcp-pairing`／`recovery`＝**53/55**，红恰为登记项 F1／W（与基点相同，tracked bytes 为 `adc31d8` 登记版）；按派工以 ZCode 更正字节 `82e1bf2` 覆盖恢复套件复跑 **11/11** exit 0 后还原（`git diff` 空）。
- **`test:web-manual-items`**：核心四套 53/53＋static 6/6（源模式 entry＋cargo 二进制＋本树 `dist`）＝**59/59**，与登记一致。
- **`check:structure`**：自测通过；失败 170 条均为会话前既存 `.kimi/` 平台注入 `top.dir`，`server/` 零违规——与登记基线逐条相同。
- **`check:docs`**：exit 0（21 文件 513 链接）。
- **II 四套件**：本增量未重跑（派工明示不重复）；不可达论证＋实证——四套件与单测中除锁定三例外无任何 `test` kind 后端任务（`type:'test'` 提交点全量 grep），extract／revise 路径字节未触。

## 7. 边界与未验证项

- 未跑完整 `npm run check`（III 唯一集成轮）；未 push；未改 MAYNE-24 状态（保持 `in_progress`）。
- 未触真实模型／真实凭据／用户根／Linux／原生；受控服务仅 loopback 合成密钥。
- 本候选**待独立独审**（派未写本 3 文件的成员，作者不自签）；通过前不入聚合。
- 工具／MCP 帧计数与回执计数的绑定经单元矩阵与代码路径承载；端到端仅工厂判据有锁定用例可翻（其余无对应夹具，未新造）。
- GAP-5（setid 逃逸）、候选／预览线上日期点转换（服务端）与客户端适配（分别验证）、退出保证边界均不变；`5311ffa3…` 按实际产物登记，旧 `42af54b5…` 不追改。
- 原始证据（gitignored）：`build/web-text-intake-test-safety-proof/`——admission.json、after-run1/2.tap＋stderr、i-unit-tracked.tap、recovery-corrected.tap、manual-items-core/static.tap、check-structure.txt、probe-criteria-matrix.mjs/.txt；BEFORE 两轮 TAP 在 detached 树（已移除）。

## 8. 结论

生产侧可信 `test` 路径安全证明已交付：锁定三例在真实链上 BEFORE 2/1（正控红，恰 GAP-TEST-SAFETY-1）→ AFTER 3/3 exit 0 两轮；每条证明绑定可证伪；回归与守卫同登记基线。待独立独审后由协调层决定聚合。
