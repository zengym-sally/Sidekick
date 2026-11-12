# MAYNE-31 TaskQueue 实施独立审查

结论：**needs_revision / BLOCK**。不能进入完成状态，不合入 main。受审候选保留，按项目工作流退回 `started_2`，由 Claude 接续修订。

## 范围与身份

- 审查人：Codex；未参与受审实现。范围为 r3 页内控制实施、S8 适配及其证据，不重开已准出方案。
- 候选：`c944e6ceaf6f11d74c97cd5ff9167641ed6e3a20`，tree `2e52ca97181bb1ef5a21438b5a630b74755fa2a9`；实现 `863d598`，S8 适配 `7cd51de`，方案谱系引入 `4e03caf`。
- 审查分支：`agent/codex/mayne-31`，起点 `a9ad0f291eeff4ef6e0cafd1609a92e4393e64b2`。候选通过 `git archive c944e6c` 导出到忽略的 build 目录验证；未切换 HEAD、改写作者分支或导入候选代码。
- r3 权威：`38f07a4` 中的 `docs/reviews/web-text-intake-task-controls-plan-20261110-opencode.md`，SHA-256 `a67abe96d089a43bc69c31b571f0574c3fc33b0284665dd29c7ac7ff42f7e6ef`，44345 字节；§11 优先。
- 风险：R2，聚焦异步归属、完整内容正确性、失败恢复、CAS 和测试承重；未改变公开契约、安全边界或存储。
- 生产文件 `src/components/TaskQueue.vue` SHA-256 `3723e0f495b14242fb97e08419d1a64badcaa6eab7de781e6a2cc1a396cb8acb`。受审七文件验证后与提交对象逐字节全等；SSE harness blob 仍为 `fe2bd6b15d790710c168df7e62b39e9709675d5f`。

## 发现项

### F1 · P1 · 分段读取失败后重开，内容重复但被标为完整（复现 R3）

位置：`src/components/TaskQueue.vue:478`、`:511`、`:518`、`:528`。

同一绑定首次读取保留部分 `text/loaded`，失败只清 `loading`。关闭再展开时复用该 session，却从 offset 0 新建 decoder 并重新读取；旧前缀没有清空。合法 70000 字节大结果、16384 字节分段，在第二段一次 503 `backend_unavailable` 后重开，实际显示 **「已载 86384／共 70000 字节，内容完整。」**，正文包含重复前缀，旧错误也仍显示。

违反 U10 的完整内容与累计字节语义。用户在提交候选前核对到的内容不等于原始结果，不能以该完整标记作为核对依据。修正：重新读取从零开始时原子清空文本、字节数、完成态及本次加载错误，或完整保留 offset 与解码器实现真正续读；完成前核对累计字节。补失败中途重开、UTF-8 分界及精确全文相等回归。

### F2 · P1 · PUT 被新 GET 抢占后，收敛读取被 pending 直接吞掉（复现 R1）

位置：`src/components/TaskQueue.vue:585`、`:586`、`:647`。

顺序：PUT 在途 → 失效 seam 发起较新 GET，捕获旧 v0 但暂不返回 → PUT 提交 v1 返回，其 ticket 已过期 → 调用重读却因现有 GET pending 立即返回 → 旧 GET 返回并安装 v0。此后没有追加 GET，1 秒任务轮询也不读取并发设置。实际服务形态已为 value 2/v1，界面在超过一次轮询后仍为 **value 3/v0**。

违反 §11.2「丢弃 PUT 后必须统一围栏重读收敛」。修正：将被合并的重读需求保留到当前 GET 完成后执行，确保有一次发生于写响应之后的权威读取；保留版本水位、输入与不自动重发纪律。覆盖 GET 比 PUT 先返回及后返回两种顺序，不能只测前一种。

### F3 · P1 · 恢复绑定变化没有作废旧 resolve 的 pending/续体（复现 R4）

位置：`src/components/TaskQueue.vue:259`、`:381`、`:413`、`:416`。

同 taskId/epoch 发出 v4/itemVersion 1 的 resolve 后，围栏刷新安装 v5/itemVersion 2。`sweepSessions()` 清内容/ACK/既有错误，却未作废旧动作 pending 或 generation；新行的恢复按钮仍被禁用。旧请求随后返回 400，`live()` 仅检查 key/generation/epoch，通过后把 **OLD BINDING ERROR** 写到新行。实际观察同时为 `disabledOnNewBinding=true`、`oldErrorVisible=true`。

违反 §11.1 绑定变化清旧 pending/错误及续体校验当前绑定的要求。修正：动作所有权包含绑定，绑定变化清理其拥有的 pending 并作废 generation；每个异步状态写入前验证当前绑定。旧请求不能清掉新动作的 pending。补当前条目版本和 attempt 变化期间有旧 resolve 在途的回归。

### F4 · P2 · 并发错误没有使用共享视图归属（复现 R2）

位置：`src/components/TaskQueue.vue:598`、`:650`。

PUT 在途期间，新 GET 安装 value 4/v2；旧 PUT 随后失败。错误分支仅检查自己的 WRITE_KEY generation，没有检查共享 ticket，界面在新 v2 下显示 **OLD PUT ERROR**。GET 错误分支亦使用相同的单 key 判据。

违反 §11.2 对数据、错误和 pending 所有权的统一要求。修正：错误显示受共享视图归属控制，pending 仍只由拥有它的操作清理；明确保留当前 409 提示的收敛行为，补交错失败回归。

### F5 · P2 · 首次并发读取失败被隐藏成永久加载态（复现 R5）

位置：`src/components/TaskQueue.vue:599`、`:744`、`:746`。

初始 GET 返回合法 503 `backend_unavailable`，错误已存入 `concurrencyError`，但 alert 在 `v-if="concurrency"` 内；值尚为 null 时只能看到 **「并发设置读取中…」**。展开/收起不重读，任务轮询也不重读，并无用户可用重试入口。

修正：空数据时仍显示失败反馈和明确的重读入口，区分 pending/失败/已就绪。补首次读取失败后用户重试成功的可见行为回归。

## 实际验证

前置单列：Node `v24.20.0`、npm `12.2.1`；导出候选后 `npm ci --ignore-scripts` exit 0（107 packages），未新增或改变依赖。浏览器使用作者驱动器与合成响应。

| 命令 | 结果与边界 |
|---|---|
| `node --test --test-timeout=20000 tests/unit/web-text-intake-task-controls.test.mjs tests/unit/web-text-intake-sse-client.test.mjs` | exit 0，27/27，无 skip/cancel |
| `npm run typecheck` | exit 0 |
| `node tests/fixtures/web-text-intake/task-controls-browser.mjs` | exit 0，19/19；640×900；Chrome/Vite/HTTP/profile 清理均 true |
| `node --test --test-reporter=tap --test-timeout=20000 tests/unit/reviewer-task-controls.test.mjs` | exit 1，5/5 在行为断言处失败，无超时/skip/cancel；每例含清理小于 20 秒 |
| `git diff --check 4e03caf c944e6c` | exit 0 |
| `git diff --exit-code 38f07a4 4e03caf` | exit 0，合并树与冻结方案谱系全等 |
| `npm run check:docs`（审查分支） | exit 0，21 文件、513 个本地链接；新增历史审查正文按守卫约定不扫描 |

审查探针复用作者测试的 transport/编译组件访问辅助代码和只读 SSE harness；新增五例只改合成传输响应，未修改生产 store、回调、受审文件或 harness。R3 使用真实大于 64KiB 的结果与 16384 字节分段；错误码取冻结注册表。原始 TAP、复跑脚本、浏览器日志和身份清单通过本卡附件交付；日志中的本机路径已脱敏。

已查：r3 符合度、失败/重试/并发/绑定失效、S8 差分、写域与依赖边界、真实浏览器布局/键盘/ARIA 的既定检查。未发现本轮新增生产依赖、迁移、client/store/server/Rust 或冻结 harness 改动。

按任务限定未跑聚合、构建、既定 19 业务旅程或完整 `npm run check`；上述浏览器 **19 项组件检查不是 19 业务旅程**。未重新签署结构守卫或端到端验收。真实后端/Pi/恢复权威组合、Workbench 挂载及配置 store 接线仍是原已登记前置，不把受控响应或禁用态签成最终交付。安全/DDL/真实凭据及生产部署面无改动，未做无关全域审计。

## 返修与接收

先在原 TaskQueue 与必要回归写域内关闭 F1–F5，保留本次失败记录。修订须提供精确候选 SHA、上述反例红转绿、原 27 项和浏览器检查回归及实现字节身份；随后再独审。真实恢复处置与最终集成仍交对应任务验收，不要求本卡扩大生产写域或提前跑完整门禁。本轮不合入 main、不 push、不部署。
