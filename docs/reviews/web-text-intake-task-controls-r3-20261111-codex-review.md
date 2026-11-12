# MAYNE-31 页内控制第三轮独立复审

**代码审查结论：pass（限已派 UI 候选与受控传输行为）。** F1–F7 原始反例全部转绿，本轮未发现新的 P0–P3 发现项。候选可供唯一集成接收。

**完成判定：等待集成前置，任务置 blocked，未合入 main。** 本卡明确保留真实恢复处置、页面装配和唯一集成新证据；这些完成条件尚未满足。UI 作者无需再次修复已关闭的七项问题。

## 身份与范围

- 审查人 Codex，未参与实现；R2 聚焦复审。依据已准出 r3 方案 U1–U10/§11、前两轮发现项、仓库架构与验证约定。
- 候选：`29f2ac86b7a746b4d6bcd03589fca477a2224bca`，tree `b37655a5ce3df466554a861cddc69728dbd51c0a`，位于 `934bf1b` 之上。
- 本轮增量恰三个文件、90+/7−：TaskQueue 18 行差分、原测试追加两例、Claude 返修记录追加说明；原 21 例保持逐字节前缀，S8 与冻结 harness 未变。
- TaskQueue SHA-256 `4460b754a8216e51f1c16e567edfa9eab22bcf97e84c91cfebe49dfe76ccd02c`；测试 SHA-256 `65fa69e988e1606c67ab55d74d2d0bdcaaf3bbb3021d599a1a690adced289be9`。
- 审查分支起点 `751cd435efbc106f57aa2224ed0b712616002802`；用 `git archive 29f2ac8` 导出忽略目录验证，HEAD 未切换、作者分支未改。三个受审文件执行后与提交对象全等。

## 关闭证据

前轮两个审查脚本通过认证 CLI 下载，SHA 与前轮身份附件一致，原样复跑：

| 脚本 | SHA-256 | 结果 |
|---|---|---|
| `reviewer-task-controls.test.mjs`（F1–F5） | `4a2f3b046ffe15ac71611730a339868e8aef7abb006a4889e05d2f307a71fd5f` | 5/5 通过 |
| `reviewer-additional.test.mjs`（F6/F7） | `c2067abbbdcc9f5e41c0651ce83face1a8569650f5db1192685d4021f4e4bf2c` | 2/2 通过 |

- F1–F5：分段重开不重复、重叠写入补读收敛、旧恢复绑定 pending/错误失效、共享错误归属、首次读取失败可见及重试，关闭结论保留。
- F6：`onTasksInvalidated` 统一调用 `queueConcurrencyReRead()`，合法外部 `settings.changed` 在旧 GET 在途时保留补读需求。原 N1 的真实显示值收敛到 value 2/v1。
- F7：动作成功后的第二个 await 返回时再次检查 `live()`；同 taskId 的当前行存在且绑定已变化时丢弃旧动作的播报/焦点处理；合法行离开仍保留原处理。原 N2 中新 epoch 不再出现旧任务播报。
- 既定浏览器检查再次覆盖合法行离开后的列表焦点回落、行内焦点保持、aria-live、可信键盘事件及 640×900 布局。

## 实际验证

前置：Node `v24.20.0`、npm `12.2.1`；导出候选后 `npm ci --ignore-scripts` exit 0，107 packages，无依赖变更。所有行为输入为合成传输响应。

| 实际命令 | 结果 |
|---|---|
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/web-text-intake-task-controls.test.mjs tests/unit/web-text-intake-sse-client.test.mjs` | exit 0，34/34，通过；无 skip/cancel |
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/reviewer-task-controls.test.mjs tests/unit/reviewer-additional.test.mjs` | exit 0，7/7，通过；无 skip/cancel；每例含清理小于 20 秒 |
| `node tests/fixtures/web-text-intake/task-controls-browser.mjs` | exit 0，19/19 组件检查；640×900，Chrome/Vite/HTTP/profile 清理全 true |
| `npm run typecheck` | exit 0 |
| `git diff --check 934bf1b 29f2ac8` | exit 0 |

已核对规格符合度、异步归属与交错、失败/重试、原问题关闭、旧测试完整性、写域/依赖边界及既定浏览器检查。client/store/server/Rust、依赖、迁移、权限和公开契约无本轮变化，未做无关全域安全或后端审计。

## 完成与合并前置

本轮读取父卡和子卡状态：MAYNE-30 为 blocked，MAYNE-32 为 in_progress，MAYNE-34 为 backlog。MAYNE-34 明定唯一集成、冻结最终树、新完整门禁与既定 19 业务旅程，然后才进行本地 main 收口。

当前 main 仍为 `1e3704432e7014f1e23b40e9aff9791662e9c6f5`。只读核查 main 的 Web client 无本组件所需的 retry/resolve/concurrency 方法；候选 `src/` 中 TaskQueue 仍无页面挂载引用。候选相对 main 共 102 文件、16303+/75−，包含本卡范围外的工程接收谱系，不能把整枝导入当成本卡三文件增量已经独立通过合并验证。

本轮按本卡限制未跑聚合、构建、完整 `npm run check` 或既定 19 业务旅程；浏览器 19 项组件检查只覆盖相应 UI 面。真实后端/Pi/恢复权威组合及页面挂载/配置接线尚无本轮组合验收证据，权威缺失时禁用态的通过不关闭功能前置。

因此，本轮准出精确 UI 候选供后续接入，完成状态保持待验。后续应将本通过结论和精确文件身份交唯一集成消费；前置具备后复核真实恢复与最终组合证据，再按工作流完成本卡和本地 main 收口。无需重开方案或重复 UI 修复。未 push、PR、部署或操作 main。

原始输出、原样复跑脚本和身份清单随任务评论附件交付，日志路径已脱敏。审查记录新增后另执行本分支 `npm run check:docs`。
