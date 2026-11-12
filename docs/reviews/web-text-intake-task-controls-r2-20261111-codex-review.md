# MAYNE-31 TaskQueue 返修独立复审

结论：**needs_revision / BLOCK**。上一轮 F1–F5 的指定反例全部关闭；本轮发现另两项既有交错遗漏 F6/F7，仍不能进入完成状态，不合入 main。按项目工作流退回 `started_2` 交 Claude 接续。

## 身份与范围

- 审查人 Codex，未参与返修实现；R2 聚焦复审，依据冻结 r3 U1–U10 与 §11，并核对写域、异步归属、失败恢复和测试承重。
- 候选 `934bf1b7359d33aed01433e8df90c7b7a6712560`，tree `7cad27b7686e598ffead38d5290db0eb5c796a58`；基于 `3e36cf6`，该合并树与旧候选 `c944e6c` 全等。
- 增量恰三个文件：TaskQueue、原测试追加五例、Claude 返修记录；331+/13−。原 16 例测试全文是新测试文件的逐字节前缀，未削弱旧断言。
- TaskQueue SHA-256 `92e484210d23d2416971335e2e29e98dd92563a4d0b279c6a38fb8dceb82d255`；测试 SHA-256 `1ebe574a4cc886b1b866d00cd1f6c2ab07ca0e3ab2c5d595f39706dd1ed63b57`；冻结 harness blob `fe2bd6b15d790710c168df7e62b39e9709675d5f` 未变。
- 本轮分支 `agent/codex/mayne-31`，起点 `d740ccfac91df6a1d3decc9b003756dc61672d9d`；用 `git archive 934bf1b` 导出忽略目录验证，未切换 HEAD、接入候选生产代码或改作者分支。

## 上轮发现的关闭证据

经认证 CLI 下载上轮原始五例脚本，SHA-256 `4a2f3b046ffe15ac71611730a339868e8aef7abb006a4889e05d2f307a71fd5f` 与原身份附件一致；脚本原样在返修候选执行 **5/5 通过，exit 0**。

- F1：分段中途失败后重开，70000 字节结果重载为精确全文，无重复前缀。
- F2：PUT 期间重叠旧 GET 的指定顺序，写响应后的补读能收敛到 v1。
- F3：刷新到新恢复绑定后旧 resolve pending 清除，指定的旧错误不再渲染到新行。
- F4：较新 GET 安装后，指定的迟到旧 PUT 错误被隔离。
- F5：首次读取失败可见；新增作者回归还覆盖手动重试成功。

以上关闭结论保留；F6/F7 分别补充其他失效入口和成功路径的第二个 await 窗口。

## F6 · P1 · 设置变更通知仍能被在途 GET 吞掉（新增反例 N1）

位置：`src/components/TaskQueue.vue:641`、`:764`。相关既有契约：r3 §4.5/U6 的他端变更收敛、§11.2 的统一权威重读。

真实 SSE/组件链路下的确定顺序：

1. 初始显示 value 3/v0。任务变更通知触发 GET，该 GET 捕获 v0，暂扣响应。
2. 另一端设置已为 value 2/v1；发合法同 epoch、更高 cursor 的 `settings.changed`。
3. 该通知确实到达真实失效 seam（独立观察本次通知引起的任务 GET），但并发 GET 因 `concurrencyReadPending` 直接返回，未设置补读标记。
4. 放回旧 GET。超过一次 1 秒任务轮询后，界面仍显示 **value 3/v0、运行中 2**；权威响应状态为 **value 2/v1、运行中 1**，没有通知后的追加并发读取。

根因：新增 `queueConcurrencyReRead()` 只接在写操作收敛分支，`onTasksInvalidated` 仍直接调用会丢请求的 `readConcurrencyView()`。最后一次设置通知在旧读取期间被消费后，视图可持续停在旧版本，影响另一窗口修改后的当前并发值、版本和计数显示。

必需修正：让设置/任务失效入口使用同一可合并但不会丢失需求的重读机制，当前 GET 完成后执行补读；保留 epoch、生命周期、版本水位和 409 草稿纪律。补「无本窗口 PUT、外部设置通知发生于旧 GET 在途期间」回归，并以真实显示值与通知后的 GET 为断言。

## F7 · P2 · 动作刷新之后缺少续体归属复核（新增反例 N2）

位置：`src/components/TaskQueue.vue:414`、`:416`、`:425`。相关既有契约：r3 §5.2/U9，每个 await 后的 UI 写入须核对生命周期、epoch 和 generation。

顺序：旧 epoch `inst_a` 的 retry 已成功，动作续体停在 `await refresh()`；通过合法 `stream.reset` 与快照切换到 `inst_b`，新队列只含 extract；再释放旧 epoch 列表响应。列表自己的围栏拒绝旧响应，但 `rowAction` 在 `refresh()` 返回后继续执行，向新页面写出 **「整理任务 revise_candidate 的动作已完成，队列已刷新。」**。N2 直接观察到 `syncEpoch=inst_b` 与旧任务播报同时存在。

根因：`live()` 只在动作请求返回后检查一次，第二个 await 后没有复核。旧续体还会进入相邻焦点处理分支；本例实测的是 aria-live 内容污染，焦点跳转未以此最小渲染器代签。

必需修正：在刷新之后、播报/焦点等 UI 写入之前重新检查 mounted/epoch/generation；同 epoch 时若原行被新的绑定取代，也应区分新行和合法终态离开，避免旧动作影响新会话。保留既有合法行离开后的焦点回落；补 epoch 切换、卸载和新绑定期间延迟列表响应的回归。

## 实际验证与边界

前置：Node `v24.20.0`、npm `12.2.1`，导出候选后 `npm ci --ignore-scripts` exit 0；无新增依赖。所有行为输入为合成传输响应，生产 store、回调和冻结 harness 未改。

| 实际命令 | 结果 |
|---|---|
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-task-controls.test.mjs tests/unit/web-text-intake-sse-client.test.mjs` | exit 0，32/32，通过；无 skip/cancel |
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/reviewer-task-controls.test.mjs` | exit 0，原始五反例 5/5，通过；脚本哈希与上轮附件一致 |
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/reviewer-additional.test.mjs` | exit 1，N1/N2 均在行为断言失败；0 pass/2 fail，无超时/skip/cancel；每例含清理小于 20 秒 |
| `node tests/fixtures/web-text-intake/task-controls-browser.mjs` | exit 0，19/19 组件检查；640×900，Chrome/Vite/HTTP/profile 清理全 true |
| `npm run typecheck` | exit 0 |
| `git diff --check c944e6c 934bf1b` | exit 0 |
| `git diff --exit-code c944e6c 3e36cf6` | exit 0 |

新增 N1/N2 使用既有测试的编译组件/受控网络辅助代码，通知、快照和延迟响应只在传输边界配置；不直接改 store、不重写失效回调。命令、身份与脱敏原始输出随任务评论附件交付。

已检查返修规格符合度、原问题关闭情况、异步交错、失败恢复、S8 与旧测试完整性、生产写域和依赖边界，以及既定真实浏览器布局/键盘/ARIA 检查。无 schema/迁移、依赖、client/store/server/Rust 或权限改动，不做无关全域安全审计。

按本卡限制未跑聚合、构建、完整 `npm run check` 或既定 19 业务旅程；浏览器 19 项组件检查不代表那些业务旅程。真实后端/Pi/恢复权威组合、页面挂载/配置接线和唯一最终集成保持原前置，本轮不将受控响应或禁用态签为最终功能交付。

下一步只需在原 UI/必要回归范围关闭 F6/F7，保留 F1–F5 关闭证据，交精确候选及本次 N1/N2 红转绿后再独审。不操作 main、远端或部署。
