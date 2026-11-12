# 回执跨重启回归 — 清理错误传播最小修订（作者交付，待 Pi 点检）

- 日期：2026-11-09；作者：ZCode（`tests/unit/web-text-intake-receipts-restart.test.mjs` 的作者，本修订为作者自修，非独审）。
- 派工来源：issue 线程回复 `01a1bff1-20e4-7b7e-816e-c1661ca0602f`（Codex）。背景是 Pi 对 `db95ea3` 的独审（线程回复 `01a1bfec-fdb2-7aa1-9587-bf3708bebca5`）：持久门、原断言、早退覆盖与 2500ms 延迟反控按证据接收，但登记了一处缺口——`t.after` 钩子逐位 `try/catch` 把 kill／close 步异常吞成 exit 0，不满足"清理异常不会被静默吞成成功"判据，故聚合准入暂不通过；本修订只补这一处错误传播面，不否定也不重开已过各面。
- 写入范围：恰一个测试文件 + 本记录。生产、其他套件、Runtime、DDL、package、守卫、索引零字节改动；不重复五探针、不跑完整 gate（按派工）。

## 1. 修订内容（相对 `db95ea3` 的测试字节）

1. **teardown 条目带标签**：两处注册点（`startFirstInstance` 的 kill 步、`startRestartedInstance` 的 graceful close 步）由裸函数改为 `{ label, run }`，标签分别为 `kill first instance + surviving worker trees`、`graceful close of the restarted backend`；`rmSync` 恒末步在钩子内联，标签 `remove root last`。
2. **逐步尝试所有已登记清理**：after 钩子按序对每步 `try { await step.run() }`，一步失败即收集、**不取消后续步骤**；根删除仍在最后执行，且其自身失败同样收集——删根纪律（kill → close → 根删除最后）原样保留。
3. **脱敏诊断收集与输出**：新增 `sanitizeCleanupDiagnostic`（世界根 → `<root>`、仓库根 → `<repo>`、node 可执行 → `<node>`、用户主目录 → `~`；上限 6 行 × 200 字符）与 `reportCleanupFailures`（`t.diagnostic` 进 TAP 流 + `console.error` 双通道；绿例零输出，保持 stderr 0 字节门槛）。
4. **传播判据（关键）**：after 钩子在存在失败时**仅当用例体未失败才抛出**（判据是 `t.passed` getter，after 钩子时点实测可靠）。原语义：node:test v24 下，用例体已失败时钩子抛出的错误会被丢弃、用例以原 `testCodeFailure` 判红（语义探针证实，见 §2）——无条件抛出反而会用钩子错误遮蔽原断言失败。因此：绿例 + 清理失败 → 抛出 → `hookFailed` 判红、exit 1；红例 + 清理失败 → 原断言失败保持为可见失败原因，`[cleanup]` 诊断并排可见。两种形态运行都非零退出。
5. `node:os` 增加 `homedir` 导入；文件头与 `restartWorld` 文档注释同步（清理异常从不静默成成功）。
6. **原两例与全部原断言保留**：`git diff -U0` 中 assert 行为 0；assert 调用数修订前后均 58（Pi 在 `01a1bfec` 登记的计数）；worker／instance 夹具零字节（blob `11f498d9…`、`a4716ffa…` 不变）。新测试 blob `be90f096d5482d411240f92fe1665110c88b496b`。

## 2. 前置语义探针（scratch，已删；决定实现形态）

在实现前用最小 scratch（`/tmp/zcode-clp-probe`，已删）实测 node v24.20.0：

- 绿例体 + `t.after` 抛出 → `not ok`，`failureType: hookFailed`，进程 exit 1（判红路径成立）。
- 红例体（断言失败）+ `t.after` 抛出 → TAP 仍只显示原 `testCodeFailure`（`ORIGINAL-ASSERTION-BOOM` 全文可见），**钩子错误被静默丢弃**——这就是无条件抛出会丢掉清理信息、而条件抛出 + 主动输出诊断才能两头保见的直接证据。
- `t.diagnostic(...)` 在红例体的 after 钩子中仍然输出进 TAP（`# [cleanup] …`）；`t.error` 在同位置不可见。
- `t.passed` getter 在 after 钩子时点返回可靠布尔（绿例 `true`、红例 `false`）——无需改用例体即可判"原本是否成功"。

## 3. 验证（锁定链 + 恰 3 个未跟踪覆盖 + 登记二进制）

运行树：`git archive 681c282`（tree `754b7908…`）提取 ×2，`diff -r` 零差；覆盖恰 3 个未跟踪文件（测试 `be90f096…`、worker `11f498d9…`、instance `a4716ffa…`）；存储二进制 `5311ffa3…232bd`（2647984 B，按 `6c269ea` 登记身份复用未重建，复制后 `shasum -a 256` 复核）；node v24.20.0；runtime 字节未被消费（stub 工厂替换 spawn，沿用 Pi 登记）。逐字命令：`node --test --test-reporter=tap --test-timeout=20000 <file>`。

| 项 | 结果 |
|---|---|
| FINAL 字节一次正常回归 | **2/2 PASS，exit 0，stderr 0 字节**，TAP 无 `[cleanup]` 行，`w1-receipts-*` 根残留 0（RA1 5399.0 ms、RA2 5295.6 ms，与既往登记 5288–5403 ms 同域） |
| F1 反控：kill 步注入必抛（scratch 副本，已删） | **exit 1**；两例 `not ok`、`failureType: hookFailed`（原本成功的形态被判红）；`[cleanup]` 诊断点名失败步并带脱敏栈（`file://<repo>/tests/unit/probe-f1.mjs:254:11`）；**毒步之后 rmSync 仍执行——运行结束后根残留 0**；无遗留进程 → "非零退出 + 后续清理仍执行"两面成立 |
| F2 反控：同毒 + 提交断言强制 499（scratch 副本，已删） | 两例 `not ok`、`failureType: testCodeFailure`，失败详情即**原断言全文**（`the source must be submitted to the first instance`，`200 !== 499`），且 `[cleanup]` 诊断并排存在——原断言失败可见性与清理诊断互不遮蔽 |

F2 的进程结束方式如实登记：毒步使首实例孤儿存活，其 piped stderr 持有事件循环，探针进程在 TAP 完整落盘后由显式清理按命令行标记定点终止（退出码非干净 runner exit；非零退出面由 F1 的干净 exit 1 承载）。真实套件不可能进入该状态：kill 步先于 close 执行、首实例在用例体内已被 SIGKILL。孤儿在删根后重建的 `runs/<runId>` stub 根在进程定点清理后移除，最终残留 0。

## 4. 边界与未签范围

- **作者交付，非独审**：Pi 按派工点检本错误传播面；其他已过证据（持久门、身份两面、早退覆盖、2500ms 延迟前后反控）按 Pi `01a1bfec` 复用，不重跑；聚合准入仍在协调者。
- `rmSync` 失败分支的 `<root>` 脱敏为静态性质，F1／F2 未动态触发删根失败。
- `--test` 模式下测试代码的 `console.error` 被重定向进 TAP 流，`[cleanup]` 行因此成对出现（`t.diagnostic` + 重定向 stderr）；有意保留双通道，使诊断不依赖调用方式（直接 `node <file>` 时 stderr 才是独立通道）。
- 观察登记：若 kill 步真实失败且首实例仍存活（piped stderr），用例判红但 runner 进程退出会等待该子进程——响亮非静默；真实流程不可达（见 §3 F2 登记）。
- 未跑完整 gate、五探针未重复；未触真实模型／凭据／用户根（合成临时根、受控 stub、零外联）。
- 原始证据（gitignored）：`build/mayne24-receipts-cleanup-prop/`（run-final／probe-f1／probe-f2 三对 TAP+stderr、identity.txt、SHA256SUMS）。三个 stderr 均为 0 字节（`e3b0c44…` 空文件哈希），与 §4 重定向观察一致。
- 卫生：`/tmp/multica-task-1233442437/w1-receipts-*` 残留 0；匹配本运行树／根标记的进程 0；其他成员工作树进程未触碰；运行树与 scratch 探针整体移除。
