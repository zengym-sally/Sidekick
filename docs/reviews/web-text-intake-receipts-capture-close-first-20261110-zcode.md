# 回执跨重启回归 — 捕获失败不漏清理的最后一项微修（作者自修，待协调层差异接收）

- 日期：2026-11-10；作者：ZCode（该测试作者；本修为其自有回执测试的独立微修）。
- 派工来源：issue 线程回复 `01a1c11e-a2ff-7afa-b161-dde7694dbaea`（Codex）：`a1562c1` 的 undefined／监听失败观察虽在锁定真实链不可达，但原派工已明确要求 capture 失败不漏清理——close 在取得 backend 时**先登记**，捕获与监听错误保存在门步重抛，统一处理 null／undefined，避免 `.once` 在 close 注册前逸出；保留已过两处主体与所有业务断言，不动生产；静态差异＋一个自有后端捕获失败的有界反控（证明仍尝试 close／删根、自动非零退出），不重跑正常／F1′／F2′整组；协调层再作该微小差异接收，不反签旧字节。
- 观察出处：Pi 点检记录 `b93a048` 的非阻断静态观察——`storageChild` 为 `undefined` 时守卫 `storageChild !== null` 对 undefined 仍为真，`.once` 在 `teardown.push(close)`／`teardown.push(gate)` 之前抛错，该次 close／门未注册（锁定链 entry 恒返回真实句柄故不可达，静态上注册次序确然）；本审另核：真值非句柄对象同走该泄漏路径。

## 1. 修订内容（相对 `a1562c1` 测试字节 blob `b422ee08`）

恰一个测试文件，生产／其他套件／Runtime／package 零字节改动。三处，全部在 `startRestartedInstance` 取得 backend 之后、门步注册之前的同一段：

1. **close 先登记**：`teardown.push({ label: 'graceful close of the restarted backend', … })` 从监听注册之后移到**捕获 try 之前**——捕获或监听注册无论怎样抛错，close（及其后的删根）已在清理队列里，必然仍被尝试。teardown 数组顺序 kill → close → 门 → 删根恒末不变。
2. **统一 null／undefined 并收纳监听错误**：捕获读改为 `backend.recovery?.storage?.child ?? null`（undefined 归一为 null）；`storageChild.once('exit', …)` 移入同一 try——捕获与监听注册错误统一落 `storageCaptureError`，由门步**在 close 之后**重抛。`.once` 不再可能在 close 注册前逸出。
3. 头注释与门段注释同步（close 先登记、捕获失败不漏清理）。**两处已过主体（collect-all-then-propagate kills、句柄化退出门门体）与全部业务断言逐字未动**：`git diff -U0` 断言行 0（58 个 assert 调用不变）、门步门体逐字节不变。

## 2. 静态核与 F3 反控（锁定链 681c282，恰 3 个覆盖＋登记产物）

运行树：`git archive 681c282…9139`（tree `754b7908`）＋恰 3 个覆盖（测试＝本修新字节、worker `11f498d9`、instance `a4716ffa`＝登记 blob）＋登记产物：存储二进制 `5311ffa3…232bd`（2 647 984 B，从 `48b54730` Rust 源重建逐字节命中，第 8 次）、s0-runtime organizer `08f32db2`／node `9d050fd4`、node v24.20.0（依赖与 `cd08588` 同锁，package-lock/package.json 两树同 blob）。逐字命令：`node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-receipts-restart.test.mjs`。

**静态核**：`node --check` exit 0；diff 仅上述三段；58 assert 不变；捕获失败（null／undefined／非句柄）三态现在都归一为 `storageCaptureError` 并由门步重抛，close 与删根不再可被跳过。

**F3 反控（自有后端捕获失败，disclosed scratch 副本，已删；仅此一控，不重跑正常／F1′／F2′）**：

- 注入 A（捕获面）：`backend.recovery.storage.child` 换成首读返回 `undefined` 的存取器——**仅首次读**（捕获读）看不见句柄；后续读与全部写（生产 close 的 `this.child = null`）保持普通字段语义，close 自身全生产真。注入 B（close 步标记）：close teardown 步回调先写探针标记文件再透传调用 `backend.close()`（直通、不旁路任何生产语义）。
- **AFTER（本修字节）实测**：**exit 1（自动、无人工终止）**、两例 `hookFailed`、**每例恰 1 个清理步失败＝门步重抛捕获错误**（`[cleanup]` 点名 `verify own storage subprocess exited after close: Error: own storage subprocess handle is not a real ChildProcess (backend.recovery.storage.child)`，脱敏栈）；**close 步零失败诊断且标记文件在写**（close 仍被尝试且成功）；根残留 0（rmSync 恒末）、存储子进程残留 0（真实句柄被生产 close 正常收尾）、套件 stderr 0 字节；RA1 5038 ms／RA2 5327 ms，整进程 10430 ms——捕获失败走门步即时重抛，无 5s 等待，预算内。
- **BEFORE 面（静态登记，不另跑）**：`b422ee08` 字节上同一注入 face 由 diff 本身证成——`.once` 行位于 close 注册之前，undefined／真值非句柄即抛 TypeError 并被 boot 重试循环吞为启动失败，既往 backend 泄漏、close／门对该次注册缺失；与 Pi 点检观察一致。按派工「一个反控」不重复动态 BEFORE。
- 首版注入（只读 getter，缺 setter）曾令生产 close 的 `this.child = null` 抛 TypeError（close 步失败诊断在案）——已修正为读 1 次后全真字段语义并重跑；该首版 TAP 留存 gitignored 原始证据并在此如实登记（教训：对生产字段的探针存取器必须保持全部写语义）。

## 3. 边界与未签范围

- 本修为**作者交付**：协调层作微小差异接收，不反签 `a1562c1` 旧字节；聚合准入不变。
- 生产 `StorageClient.close` 尽力关闭契约零改动；注入 A/B 仅为反控 disclosed scratch，不代表生产语义。
- F3 目标边界：全部进程为本测试／探针自行启动并持有；未触碰外部进程与他成员工作树的两个存储进程。零残留：`/tmp/w1-receipts-*` 0、运行树进程 0。
- 未重跑正常回归／F1′／F2′／持久门／五探针／四套件／完整 gate；未触真实模型／凭据／用户根（合成临时根、受控 stub、零外联）。
- `check:structure` 零新增（测试文件无新增相对引用）；`check:docs` exit 0（见提交登记）。
- 原始证据 gitignored `build/mayne24-test-safety-5th-zreview/receipts-f3/`（F3 TAP＋stderr、close 标记、fixed/scratch/current 三份字节、identity.txt、SHA256SUMS）；精选原件随交付评论实际挂载（脱敏副本）。
