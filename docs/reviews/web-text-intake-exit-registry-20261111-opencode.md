# MAYNE-35 第 2 个有界交付：宿主登记与 typed 退出证据 producer（2026-11-11，OpenCode）

**角色与边界**：按本卡复审通过记录 `web-api-v2-20261111-codex-r2-pass.md` §4 执行的有界生产候选。只交 producer 与受控测试；不把 B(a) 放行语义启用到 V1 API，不接线 task-service/recovery/scheduler/HTTP/SSE/前端，不跑完整 check/19 旅程，不合 main/不推送。候选交付后交未参与者独审；E 完成与最终业务验收仍归后继串行接入与 MAYNE-34。

## 1. 输入身份

| 输入 | 身份 | 核验 |
|---|---|---|
| 冻结规范 | `0c9febc5010015418a5778a49f76d4e0c01f7f9f` / tree `06adbf50…fdf6`，规范 SHA-256 `449bf0b0b2a0799c201a7fe865d6950b1852f61175eb790993badf9cc10af2cd` | 经认证 CLI 下载附件逐字节 `shasum` 相等 |
| 服务源基线 | 已审 `d70280c452038210c0ae6a60f980623de79c8d93:server/lib/worker-host.mjs`，blob `52198fa55dca726964eff6f626eef94061f57eb3`，SHA-256 `554c3bf51f80360d458a2b126ce4b822941c380c075e14e1e582e68abe90aadd` | 采纳时字节级相等后才开始扩展；D 当前候选 `8480b2e` 未采用（仍在独审，§4 明令） |
| 任务分支/起点 | `agent/opencode/mayne-35`，起点 `8c1626aa0a9a70a3f1982c91615d3293667eb5aa`（tree `f7aa1634aa02a276f07046db63d56e6f1f2e0443`） | 开工登记见 `build/mayne35-exit-registry/admission.json`（修改前写入） |

## 2. 交付物（唯一写域）

| 文件 | 性质 |
|---|---|
| `server/lib/worker-host.mjs` | 自 `d70280c` 字节级采纳后**纯增量**扩展（+637 行；仅 3 行原文件被 1:1 加长替换：fs import、`start()` 签名加可选 `attemptEpoch`、`worker` 帧分支加登记钩子）。既有导出与语义零改动 |
| `server/lib/attempt-exit-evidence.mjs` | 新增**纯判定模块**（无 I/O、无 OS 调用）：`buildAttemptExitEvidence` / `validateAttemptExitEvidence` / `aggregateStrayLedger` / `assertVerdictTransition` / `identityToString` |
| `tests/unit/attempt-exit-evidence.test.mjs` | 16 个纯合成判定测试 |
| `tests/integration/attempt-exit-registry.test.mjs` | 8 个真实合成进程测试（自建自回收） |
| `tests/fixtures/web-text-intake/exit-registry-leaf.mjs` | 自回收合成进程 fixture（hold/child/detach/orphan 四模式；帧身份取 `--run/--host-nonce`，无身份不产帧） |
| `docs/reviews/web-text-intake-exit-registry-20261111-opencode.md` | 本记录 |

## 3. 落地语义（对应冻结 V2）

- **typed producer 与 V1 boolean 面完全分离**：`verifyTree` 仍返回 boolean；`confirmExit` 返回形状不变；`done.treeVerified` 仍为 boolean。新 typed 入口只有 `observeAttemptExit(runId, options)`，返回 `{attemptExitEvidence, registry, ledgerAggregate, workerRecord}`，形状按规范 §3.1.1（`verdict`/`workerExited`/`groupAbsent`/`registry`（恒等式 total=confirmedExtinct+unobservable+survivors）/`argvScan`/`veto`/`residual.treeExtinctProven 字面量 false`/`confirmedAt`）。集成测试显式断言 `typeof treeVerified === 'boolean'`，排除 object-truthy 误放行。
- **帧来源/存活期身份登记**：worker 自身 spawn 帧（`worker_frame`）、栅栏校验通过的运行时 `worker` 帧（`tool_owner_frame`）、退出时直接子进程快照（`exit_children_snapshot`）、150ms 周期性递归 ppid 最佳努力走查（`ppid_walk`）与退出走查。身份 = 注册时刻进程表锚点（lstart+command+nonce）；注册只能来自帧源，argv 扫描结果永不创建成员（测试断言 decoy 不入注册表）。
- **proof-matched 清扫**：`runStraySweep` 每轮只对"存活占用者身份 proof-match 成功"的成员执行 SIGKILL，并限次重读进程表确认死亡后才计入 swept；身份不符（PID 复用嫌疑）成员**永不触碰**（集成测试断言占用者在清扫后仍存活）。
- **否决面与确定性优先级**（规范只钉住 argv 面的 EPERM>通用与本词表；多面并存的总序为本 producer 已文档化决策，见 `attempt-exit-evidence.mjs` 头注）：known_survivor（proof-match 存活者 / 台账 pending>0 / 可归因 argv 命中）→ insufficient_evidence（不可归因命中，不变式 3 强制）→ identity_mismatch → eperm（argv EPERM 与组探测 EPERM，均优先于通用证据不足）→ insufficient_evidence（worker 未退出/组仍在/不可观察/未扫描/失败）。
- **pending 不可被"未发现"覆盖**：台账 JSONL 逐轮追加、计数为**累计值**；表不可读轮次原样结转并在 notes 声明；`aggregateStrayLedger` 机械校验 found 非降、swept≤found、pending≡found−swept、sweepSeq 连续——损坏台账是证据损坏，抛错拒绝出证。
- **不变式 6 方向守卫**：同一活动句柄上观测到 verdict 回退（registry_extinct→unresolved）直接抛错；`assertVerdictTransition` 导出供消费侧持久层使用。
- **命名空间**：attempt 工作区用 `runs/<runId>/`（runId 每次 start 随机生成、永不复用），`attempt-registry.json` 与 `stray-ledger.jsonl` 均内含 attemptId/runId/epoch（`start()` 新增可选 `attemptEpoch` 形参，本轮测试传缺省 null，真实 epoch 由后继 task-service 接线时传入）；attemptId 只作归因数据，不作命名空间键。
- **诚实披露**：`residual` 恒为 `{treeExtinctProven: false, scope: 'registry_domain', strayLedger}`；GAP-5 组逃逸正控（组已灭而注册成员存活 → 否决）与未登记逃逸披露对照（marker 证明孤儿真实存在过、注册表查无此人、verdict 仍只声明登记域）都有独立测试。

## 4. 实际验证（原始输出 `build/mayne35-exit-registry/verify-output.txt` 等）

| 命令 | 结果 |
|---|---|
| `node --test --test-timeout=20000 tests/unit/attempt-exit-evidence.test.mjs tests/integration/attempt-exit-registry.test.mjs` | **24/24 pass（16 单元 + 8 集成），6.2s**；每例最长 1.44s，含自建进程清理，全部低于 20s |
| 进程回收 | 测试结束后 `ps` 扫 `exit-registry-leaf` 残留 = **0**；各测试内 `waitGone` 有界轮询 |
| `npm run check:docs` | exit 0（22 文件/527 链接；`docs/reviews/**` 为该守卫的排除面，仅 README 索引在扫描内，故本记录不改变计数） |
| `npm run check:structure` | 仅 3 项**基线预存**违规（`tests/*/s32-*` 引用的 `vendor/pi/.../dist` 产物本 worktree 未构建，需网络命令未跑）；stash 对照确认与本次文件无关，本人文件 0 违规 |
| `git diff --check` | clean |

§4 独立验收预期逐项对照：登记成员退出正控（集成 #1）、仍存活反控（#2）、已登记 setsid 逃逸否决 GAP-5（#3）、未登记未发现逃逸范围披露（#4）、身份不符与 PID 复用（#5+单元）、组 ESRCH/仍存活/EPERM（#1/#2/#8，EPERM 为 adapter 模拟且 evidence detail 明注 simulated）、argv 未扫描/通用失败/EPERM/命中（#6+单元矩阵）、stray pending 保持与清扫解除（#7）、台账重读不丢来源（#7 磁盘重读 3 行折叠=(1,1,0)）。变异可证伪性：验收断言精确到否决原因码、计数三元组与存活事实（如"清扫后 mismatch 占用者必须仍存活"、"不可观察轮后 pending 仍为 1"），逐项违反谓词的变异均有独立失败面。

## 5. 边界与后继

- 本轮未做：task-service/task-recovery/task-scheduler/text-intake-service/HTTP/SSE 接线、B(a) 放行启用、全局 contractVersion 切换、真实 OS EPERM 实测（adapter 模拟已标注）、完整 check/旧探针/19 旅程、DDL/依赖/包/Rust 改动、main/远端/部署。
- 未决（留给后继串行候选，均为 §4 既定派发）：`attemptExitEvidence`/`exit_verdict` 持久层落位（task_attempts，D 域）、恢复扫描接线（§3.4 重验 + 清扫登记）、槽位核算切换、信封 web-api/2 切换与 UI 文案。
- 避让声明：未触碰 MAYNE-33 D 候选（`8480b2e`）的服务/DDL/守卫写域；`server/lib/worker-host.mjs` 基线取 `d70280c` 而非 `8480b2e`。
