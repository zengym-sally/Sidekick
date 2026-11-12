# 回执跨重启回归 — 真实 kill 层收窄 + 存储子进程退出门（作者窄修，待独立点检）

- 日期：2026-11-09；作者：ZCode（`tests/unit/web-text-intake-receipts-restart.test.mjs` 的作者，本修订为作者自修）。
- 派工来源：issue 线程回复 `01a1c093-6d8b-74c4-9eba-b3f50b3b8851`（Codex）：完成当前三项独审后（`7cfef55`／T-2／T-10 三提交独审已按 `01a1c09f` 交付、记录 `c026676`），窄修自有回执测试 `f7e8307`。直接背景是 Pi 对 `f7e8307` 的点检（线程回复 `01a1c03a-0811-49b1-9c9b-1d02ba925e4b`）:**不通过——限「真实 kill／close 错误到达收集器」面**——两个关键 kill 步的内层无条件 `catch {}` 吞掉一切非 ESRCH 错误，close 步在生产上不可拒绝，唯一可达失败只剩 `rmSync`。
- 写入范围：恰一个测试文件 + 本记录。生产（含 `server/lib/storage-client.mjs` 的尽力关闭契约）、其他套件、Runtime、DDL、package、守卫、索引零字节改动；不重跑已过持久门／五探针、不跑完整 gate（按派工）。

## 1. 修订内容（相对 `f7e8307` 的测试字节 `be90f096`，新 blob `27d5ee66`）

1. **真实 kill 层只免已证退出（ESRCH）**：三处 kill 位点（`killWorkerTrees` 的 `process.kill(-pgid,'SIGKILL')`、`killFirstInstance` 的 `child.kill('SIGKILL')`、crash 面的进程组 kill）由无条件 `catch {}` 收窄为 `catch (error) { if (error?.code !== 'ESRCH') throw error; }`——ESRCH 是 OS 确认进程／组已不存在（已证退出），其余错误（EPERM 等）原样上抛、到达 teardown 收集器；crash 面的同型收窄使非 ESRCH 失败不会被吞成假 crash。
2. **存储子进程退出门（不能仅凭 close resolve 判成功）**：生产 `close()` 保持既有尽力关闭契约（`StorageClient.close` 命令 catch＋2000ms 定时器 SIGTERM 后立即 resolve、不等待子进程）——零改动。测试侧新增：`findOwnStoragePid()` 在 **close 之前**从 OS 进程表捕获本进程直接子代中恰一个存储二进制进程（后端句柄不暴露适配器；0 个或多个匹配即响亮失败，门不得空洞）；teardown 新增已登记步 `verify own storage subprocess exited after close`（注册在 close 步之后、删根之前）：有界 5000ms 窗口内以 `process.kill(pid,0)` 核退出——ESRCH 是唯一通过态，探测非 ESRCH 错误原样上抛；超时即**强制 SIGKILL＋有界等待退出**（防止存活子进程的管道把运行进程挂住），随后响亮抛错。步骤顺序：kill → close → 退出门 → 删根恒末。
3. **全部业务断言与双重可见性保留**：`git diff -U0` assert 行 0（58 个 assert 调用不变）；`t.passed` 条件抛出、`[cleanup]` 经 `t.diagnostic`＋`console.error` 双通道、脱敏诊断、删根恒末——`f7e8307` 已登记语义逐字保留。
4. 文件头与 `restartWorld` 文档注释同步（真实 kill 层、退出门、生产 close 契约边界）；`node:child_process` 增加 `spawnSync` 导入。

## 2. 验证（锁定链 + 恰 3 个未跟踪覆盖 + 登记二进制，第 6 次独立复现）

运行树：`git archive 681c2825bb053b740cc7fdfd7133e75384389139`（tree `754b790811d8c09732463cafdf6e93d4feff0284`）提取 ×2，`diff -r` 零差；覆盖恰 3 个未跟踪文件（测试 `27d5ee66…`、worker `11f498d9…`、instance `a4716ffa…`）；`build/s0-runtime` 自本机已备好的 runtime 树复制（organizer `08f32db2…911a7`、node `9d050fd4…0588a`＝登记身份）；存储二进制**在运行树内从锁定链 Rust 源重建**：`cargo build --release --bin web-backend-storage` → `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2647984 B）＝登记身份逐字节命中（第 6 次独立复现）。runner node v24.20.0、rustc 1.99.1 `58cf8f9c3`。逐字命令：`node --test --test-reporter=tap --test-timeout=20000 <file>`。

| 项 | 结果 |
|---|---|
| FINAL 字节一次正常回归 | **2/2 PASS，exit 0，stderr 0 字节**，TAP 无 `[cleanup]` 行，总时长 10792 ms（与既往登记 5288–5403 ms/例同域——退出门在绿路上只增加亚秒级 ps 捕获＋一次 ESRCH 探测），`w1-receipts-*` 根残留 0、遗留进程 0 |
| F1 反控：真实调用层 EPERM（scratch 副本，已删） | 探针先用**真实 syscall** 选定受保护进程组（对组领导逐个 trial `kill(-pgid,0)`，命中真 EPERM 才选定，组 343；绝不向 `pgid≤1` 或可选中组发信号），向用例根的 `runs/probe-eprem-seed/worker.json` 播种该 pgid（排序保证它是 `killWorkerTrees` 访问的**最后一条**记录）→ **exit 1**；两例 `not ok`、`failureType: 'hookFailed'`；`[cleanup]` 诊断点名 `kill first instance + surviving worker trees`，错误即真实 `Error: kill EPERM`（`process.kill` 帧，脱敏栈 `file://<repo>/…`）；**毒 kill 之后其余清理仍执行、rmSync 恒末——根残留 0、遗留进程 0、stderr 0 字节**。非假绿（原 `catch {}` 字节下同注入绿，见 Pi `01a1c03a` 动态注入 4 次全吞）、不静默挂起 |
| F2 反控：close 返回但自有子进程仍存活（scratch 副本，已删） | 探针以公开包裹（每次落日志）绕过 `StorageClient.prototype.close` 的优雅握手，生产其余关闭步（scheduler.stop／sse.stop／httpServer.close）与生产字节全部真实 → `backend.close()` **返回而适配器子进程仍在运行** → 退出门在捕获句柄上 5000ms 判活超时 → **强制 SIGKILL 完成（错误信息无 "did not complete" 尾缀）→ 响亮抛错** → **exit 1**；两例 `hookFailed`，`[cleanup]` 点名 `verify own storage subprocess exited after close`，两例各捕获恰一个子进程（pid 52543／52690）；进程**自行退出**（每例 10247／10461 ms，远小于 20s 预算）——非假绿、非静默挂起；根残留 0、存储进程残留 0、stderr 0 字节 |

## 3. 边界与未签范围

- **作者交付，非独审**：按派工由未参与者另派点检；聚合准入仍在协调者。
- 生产 `close()` 的尽力关闭契约按派工**原样保留**（本修订不改生产、不要求 close 可拒绝）；F2 的握手旁路仅为反控 disclosed 注入（生产字节未动），不代表生产语义。
- `--test` 模式下 `console.error` 被重定向进 TAP 流，`[cleanup]` 行成对出现（`t.diagnostic`＋重定向 stderr）；三个运行 stderr 均 0 字节，与 `f7e8307` §4 登记一致。
- 观察登记：退出门的强制 SIGKILL 以 `error?.code !== 'ESRCH'` 同型收窄——若强制 kill 自身非 ESRCH 失败，其信息附入门错误信息一并上报（动态未触发，静态性质）。
- 未重跑持久门／五探针／四套件／完整 gate；未触真实模型／凭据／用户根（合成临时根、受控 stub、零外联；F1 的受保护组只被信号 0 试探与注定 EPERM 的 SIGKILL 命中，无任何信号实际送达）。
- 卫生：运行树与 scratch 探针整体移除；`/tmp/w1-receipts-*` 残留 0；匹配运行树／根标记的进程 0；其他成员工作树进程未触碰。原始证据（gitignored）：`build/mayne24-receipts-killclose/`（三对 TAP+stderr、两个探针日志、两份探针脚本副本、identity.txt、SHA256SUMS）。
