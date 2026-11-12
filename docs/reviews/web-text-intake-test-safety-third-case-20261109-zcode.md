# web-text-intake test-safety 第三例（未可信执行来源负控）限定面独审（ZCode，2026-11-09）

派发：MAYNE-24 协调评论 `01a1bf7b-13a9-77ec-933a-1ad16f0340e4`（Codex，2026-11-09）。评审人未参与该增量实现（作者 Pi）；与 Hermes 的生产／重启回执审并行，互不覆盖。本审限定面：第三例（未可信执行来源负控）＋头注更正。锁定候选 `0443e00d7696ee6f87d5f80cb88b14745c561907`（tree `8764036bffe8840ffac39852dd547f064e6c4bf7`），实际生产输入锁定 `0536a44a39e8c228a95c9f548c73c3d72ffc174d`（tree `61e8a527`）。

## 结论

通过（限定面）——第三例作为「未可信执行来源不得晋升 `proven_safe`」的负控测试候选成立，头注更正与生产字节逐字相符；快捷反证按作者附件核实成立（未重打 scratch 补丁）；生产正控 GAP-TEST-SAFETY-1 在最新 I 生产输入上仍红——判据成立与生产正控仍红分别登记，安全证明仍未闭合，不入聚合。

## 1. 身份

- 提交 `0443e00d`／tree `8764036b` 复核一致，父恰为 `34958bb`（tree `ccad6309`，与既往 cm 审登记一致）。
- 恰三文件：`docs/reviews/web-text-intake-test-safety-20261109-pi.md`（blob `2be9c1ce`→`faff0cae`，+26/−0，即 959f54b 原记录 blob 的头注更正与 §8 追加）、新夹具 `tests/fixtures/web-text-intake/test-safety-stub-worker.mjs`（blob `4f3c9940`，60 行）、`tests/unit/web-text-intake-test-safety.test.mjs`（blob `4ed197de`→`10eb7031`，+123/−12，即 959f54b 原测试文件 blob 的纯追加）。合计 +209/−12。
- 生产／Runtime／DDL／package／守卫／索引零改动——同为 test-only 增量成立。
- 作者附件五件 SHA256SUMS 4/4 复核通过；`diff.patch` 与 `git diff 34958bb 0443e00d` 逐字节相同。

## 2. 判据逐条（对照 0536a44 生产字节）

1. **同为 test**：见 §1。生产路由字节核对——`server/lib/task-service.mjs` 信封默认 `sideEffectSafety ?? 'unknown'`（:98）、别名 `MODEL_INVALID_OUTPUT → output_contract_invalid`（:59）、冻结注册表 `output_contract_invalid → auto_backoff`（:41）、安全路由 `sideEffectSafety !== 'proven_safe' → markNeedsReview(cause 'failure_unknown_side_effect', exited:true)`（:880-882）；`server/lib/task-scheduler.mjs` 仅有的 `proven_safe` 授予是配置类路径（无快照 `auth_or_config_invalid`／无凭据 `credential_unavailable`），第三例写合法模型配置＋可用凭据绕开两者，负控非空真。
2. **工厂确被调用**：第三例 `startWebBackend({ workerProcessFactory })` 指向测试专用替身；`server/lib/worker-host.mjs` `const launcher = this.processFactory ?? spawn`（:279）——工厂完全替换 spawn；`stubInvocations === 1` 断言替身运行且真实 Pi 未被派生。全文件恰两处 `startWebBackend`：`before()` 主后端无工厂（真实随包 Pi 正控路径），第三例 stub 后端——**原默认真实 Pi 正控不被替身代签成立**，正控用例体字节未动。
3. **合法身份错误帧**：替身读冻结 stdio 请求行、校验并回显 `runId`＋`hostNonce`、发一封 `type:'error'`／`code:'MODEL_INVALID_OUTPUT'` 帧后延迟 100ms 退出（夹具注释写明：立即退出会与 stdout data/exit 事件竞争而丢帧误判 worker 丢失）；无工具／MCP 帧；argv 保持 `args.slice(1)`（`--run` 标记幸存供退出确认）。
4. **零回执与 unknown 路由承重**：断言 receipts===0、`failure.sideEffectSafety==='unknown'`、`task.state==='needs_review'`、`failure.cause==='failure_unknown_side_effect'`、`failure.code==='output_contract_invalid'`、`failure.retryable==='auto_backoff'`、恰一 attempt 且 `exit_reason='confirmed'`、候选零行——逐条绑生产派生事实；轮询只等终态集（needs_review/queued/succeeded/cancelled）不等瞬态 `failed`，与安全路由无竞争。
5. **根／时钟隔离**：第三例自建 mkdtemp 根＋第二后端实例＋独立受控凭据提供者；`finally` 内 close＋rmSync 且位于用例体内（用例时长含自身清理）；时钟唯一接缝 `taskService.now = () => clock`（既有实例属性赋值＋读回断言），无新增生产开关。
6. **头注更正准确**：0536a44 入口 blob `47a9efcd` 构造 `new TaskService({ storage, epoch: sse.epoch })`（:79）确未传 `now`（用默认）；测试头注、`before()` 注释与记录 §8.3 三处更正一致——关闭本审（d1b87e2）登记的 MINOR 措辞缺陷。
7. **20s 预算（含清理）**：逐字命令含 `--test-timeout=20000`；新负控两轮 4461.8ms／4452.8ms（用例时长已含其 finally 清理），全套件 11358ms／9757ms，run2 全进程墙钟（含套件级 `after()` 主后端清理）9806ms——全部在预算内。注：本套件用例清理在用例体 `finally` 内，故用例时长已含清理；套件级 `after()` 清理由墙钟覆盖。协调层「计时不含 finally 清理」的登记更正针对 OpenCode 增量情形，不适用于本套件，特此分别登记。

## 3. 原样复跑（独立证据，判据成立）

运行树＝detached `0536a44`（零 tracked 修改）＋恰两未跟踪覆盖（候选测试文件 sha256 `24868481…`、候选夹具 sha256 `c593be63…`，即 blob `10eb7031`/`4f3c9940`）＋复用既往登记存储二进制 `42af54b5…7490fc2`（2649408B，sha256 复算逐字节一致）＋s0-runtime organizer `08f32db2`（provenance `ad702637`/`e89822b0`、bundled node `9d050fd4` v24.20.0）。夹具目录 `tests/fixtures/web-text-intake/` 在 681c282 与 0536a44 逐 blob 相同（零差异），套件仅依赖在树夹具，无需其他覆盖。

命令逐字：`node --test --test-timeout=20000 --test-reporter=tap tests/unit/web-text-intake-test-safety.test.mjs`

- run1：tests 3 / pass 2 / fail 1（extract 负控 2422.1ms 绿／正控 394.9ms 红／新负控 4461.8ms 绿，套件 11358ms），stderr 0 字节。
- run2：tests 3 / pass 2 / fail 1，exit 1（预期红），（834.5/403.5/4452.8ms，套件 9757.5ms，墙钟 9806ms），stderr 0 字节。
- 两轮红均恰为 GAP-TEST-SAFETY-1（`:344:1`），失败信封与作者登记逐字节相同 `{output_contract_invalid, 整理进程返回错误。, auto_backoff, unknown, cause failure_unknown_side_effect}`——**生产正控仍红，单独登记**。
- 运行后：/tmp 零 test-safety 临时根（两种前缀），零本树进程残留，运行树恰两未跟踪覆盖不变。

## 4. 快捷反证（按附件核实，未重打 scratch 补丁）

按派发不重打生产 scratch 补丁；反证由作者附件承载，本审核其内部一致性：`scratch-shortcut.tap` 显示快捷规则（`test` 类型＋零回执 ⇒ `proven_safe`）下——正控转绿（1427.6ms, ok，快捷规则满足了它）、extract 负控仍绿（类型 `extract` 不在规则键内，自洽）、新负控红在恰 `:523:12`——即守卫断言 `assert.equal(failure.sideEffectSafety, 'unknown', 'an untrusted execution source must never be promoted to proven_safe')` 本身（actual `proven_safe`）。守卫断言咬合非空真，负控确实抓住 type＋零记录捷径。反证方法学（SCRATCH SHORTCUT 标记＋逐字节回退）为作者登记（记录 §8.2），本审未独立重现。

## 5. 不签与边界

- 不签安全证明闭包：GAP-TEST-SAFETY-1 在最新 I 生产输入上仍红；未可信执行来源负控绿不晋升任何生产状态，不入聚合。
- 快捷反证为作者附件证据的内部一致性核实，非本审独立重现；作者原两轮 TAP（其运行树 `/private/tmp/mayne24-negctl`）不可在本机重放位逐字节比较，交付绿面由本审两轮复跑承载。
- A5 窄修 `787db84`、receipts-restart 候选、Hermes／OhMyPi／OpenCode 各增量均不在本审范围。
- 未跑完整 gate；未触真实模型／凭据／用户根（合成密钥仅指 loopback 受控服务；替身零模型调用，baseUrl 指死环回端口）。
- 候选字节未动（运行树覆盖为副本，审后工作树整体移除）；原始证据在 gitignored `build/mayne24-test-safety2/`（12 件＋SHA256SUMS）。
