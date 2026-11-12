# TaskQueue 页内任务控制返修记录（MAYNE-31，F1–F7 关闭）

> 状态：**返修候选（PENDING-REVIEW）**。作者 Claude（2026-11-11），按 MAYNE-31（`01a1c2ad`）工作流「已驳回」步骤与 Codex 独审驳回评论 `01a1c67e-0700-7b0c-bbad-f8b612afd250`（F1–F5）及复审 `01a1c69f-443f-763a-9623-ac1073e8d4d3`（F6–F7）两轮修订；作者不自签，独审另行派发。首轮受审候选：`c944e6ceaf6f11d74c97cd5ff9167641ed6e3a20`（tree `2e52ca97181bb1ef5a21438b5a630b74755fa2a9`）；次轮受审候选：`934bf1b7359d33aed01433e8df90c7b7a6712560`（tree `7cad27b7686e598ffead38d5290db0eb5c796a58`）。
> 分支：`agent/claude/mayne-31`（MAYNE-31 平台隔离任务分支）。起点 `90a8640`（树与共同祖先 `1e37044` 全等）；merge `3e36cf6` 带入被驳回候选 `c944e6c`（合并树与候选逐字节全等），两轮返修增量在其上。仅本地提交，零 push／PR／main 操作。

## 1. 返修写域

- 生产改动恰一文件：`src/components/TaskQueue.vue`（候选 blob `31fdc43c…` → 返修 blob `e9726dde…`，SHA-256 `92e484210d23d2416971335e2e29e98dd92563a4d0b279c6a38fb8dceb82d255`）。client／stores／server／Rust／公开签名／package／守卫／依赖锁：零字节。
- 必要回归：`tests/unit/web-text-intake-task-controls.test.mjs` 追加 F1–F5 五例（16 → 21 例）。SSE harness（blob `fe2bd6b1…`）与 S8 适配字节不动。
- 记录：本文件。

## 2. 发现项 → 修正

### F1（P1）分段读取失败后重开，内容重复但被标为完整
`loadFullContent` 在（重）启动时原子清空 `session.text/loaded/total/done` 与本会话错误；重新读取一律从 offset 0 以新 decoder 累积，完成前累计字节只来自该次分段实际返回，`已载 X／共 Y` 与完整标记只在该次累积上成立。模板中「内容继续载入」提示移出 `<pre>`，内容体恰为被核对的 payload（§4.3/U10 的「精确全文相等」在真实 DOM 文本上成立）。

### F2（P1）PUT 被新 GET 抢占后，收敛读取被 pending 吞掉
新增 `queueConcurrencyReRead()`：读已在途时把收敛重读挂起，并由该读的 `finally` 重放，保证写响应之后仍有一次发生于重叠读之后的权威读取。写路径三处（守卫丢弃、安装失败、409）统一走此入口。

### F3（P1）恢复绑定变化未作废旧 resolve 的 pending/续体
`pending` 值由 `string` 改为 `{binding,label}`；`sweepSessions()` 在绑定变化时清扫其拥有的 pending 并作废对应 generation；`rowAction` 续体在写状态前核对当前绑定，旧请求既不清新动作的 pending，也不把旧错误写到新行。

### F4（P2）并发错误未使用共享视图归属
新增 `ownsView(ticket)`；GET/PUT 的错误分支在 `live()` 之外再验共享 view ticket，迟到失败不再覆盖较新安装。409 的重读与保留草稿纪律不变。

### F5（P2）首次并发读取失败被隐藏成永久加载态
空视图分支区分 pending／失败／已就绪：失败时显示 `role="alert"` 错误与「重试读取并发设置」入口；手动重试清除旧失败并发起一次权威读取。

## 3. 验证（每例 20s 预算含清理；前置单列：Node v24.20.0、npm 12.2.1、锁定依赖树）

| 运行 | 对象字节 | 结果 |
|---|---|---|
| 原回归（含 S8） | 返修树 | **32/32 绿，exit 0**（task-controls 21＋sse-client 11；最慢例约 1.5s） |
| 独审反例复跑 | 返修树 | **5/5 绿，exit 0**（R1–R5，审查附件原样复跑） |
| 真实浏览器 | 返修树 | **19/19 面绿，exit 0**（640×900；chrome/vite/http/profile 清理全 true） |
| 静态 | 返修树 | `npm run typecheck` exit 0；`node --check` 3/3；`npm run check:docs` exit 0（22 文件、592 链接） |
| 结构 | 返修树 | `check:structure` 非噪声 FAIL 集＝注册基线 11 项（1×003 冻结＋3×vendor/pi＋7×接收集 ref.missing），零写域提及 |

反例红转绿：R1–R5 在候选 `c944e6c` 上 5/5 红（审查 TAP `reviewer-repros.tap` 原件），同一测试字节在返修树 5/5 绿。F1–F5 的面内断言：F1 精确全文相等（`已载 70000／共 70000 字节`＋正文等于 payload）、F2 提交 v1 在重叠陈旧 GET 之后收敛、F3 新绑定可操作且旧错误不落地、F4 迟到 PUT 错误不覆盖较新安装、F5 失败可见且重试入口可用。

测试路径纪律：只读复用已接收 harness（`wireTask`/`defaultWorld`/`installControlledNetwork`/`mountGate`/`waitFor`/`settle`，blob `fe2bd6b1` 零改动）；harness 未脚本化的面由测试本地 fetch 包装层应答；种子全部为冻结合法形态、仅落于传输边界；不直接改生产 store、不重写同步回调。浏览器夹具经真实 Vite 管线编译生产 SFC＋真实 pinia，CDP 可信键事件，最小渲染器不签布局。

## 4. 第二轮返修（F6–F7，复审 `01a1c69f`）

首轮 F1–F5 关闭结论由复审保留（原五例脚本原样复跑 5/5 绿）。本轮为两处既有交错遗漏：

### F6（P1）设置变更通知被在途 GET 吞掉
`onTasksInvalidated` 仍直接调用会因 `concurrencyReadPending` 丢请求的 `readConcurrencyView()`：外部 `settings.changed` 落在旧 GET 在途期间时，通知被消费却不排队补读，旧 GET 返回后视图停在旧版本。改为统一走 `queueConcurrencyReRead()`，与写路径收敛同一机制（§4.5/§11.2）。

### F7（P2）动作刷新之后缺少续体归属复核
`rowAction` 成功路径的 `await refresh()` 是第二个 await 窗口：期间合法快照可能切换 epoch，旧列表响应虽被围栏丢弃，续体仍向新页面写旧任务播报。在刷新返回后、播报/焦点写入前复核 `live(key, generation, epochAtStart)`；同 epoch 下若原行被新绑定取代，与合法终态离开相区分——旧动作不播报、不抢焦点，合法行离开的焦点回落保留（§5.2/U9）。

### 次轮验证
- 原回归＋S8：**34/34 绿 exit 0**（task-controls 23＋sse-client 11）。
- 独审反例：原五例 **5/5 绿**；新增 N1/N2 **2/2 绿 exit 0**（候选 `934bf1b` 上 2/2 红）。
- 真实 Chrome：**19/19 面绿 exit 0**；`typecheck` exit 0；`check:docs` exit 0；`check:structure` 非噪声 FAIL 集＝注册基线 11 项，零写域提及。
- 写域增量：`src/components/TaskQueue.vue`（blob `e9726dde…` → `48921090…`，SHA-256 `4460b754a8216e51f1c16e567edfa9eab22bcf97e84c91cfebe49dfe76ccd02c`）；`tests/unit/web-text-intake-task-controls.test.mjs`（21 → 23 例，blob SHA-256 `65fa69e988e1606c67ab55d74d2d0bdcaaf3bbb3021d599a1a690adced289be9`）。

## 5. 边界（诚实登记）

- 全部响应为传输边界受控合法形态；本轮绿面**不签**真实后端／Pi／端到端通过。对照当前后端（权威条目版本/回执未接线，MAYNE-30 在办），resolve/resume 入口正确呈**禁用态**——这是方案 §8.3.4 登记的预期安全行为，不当作功能交付。
- 真实恢复处置验收依赖 MAYNE-30 权威闭环；最终接收依赖未参与者独审与唯一集成新证据。E/D、GAP-5 与整体准出边界不变。
- 未跑：聚合、构建、19 旅程、完整 `npm run check`、真实模型。
- 原始证据：`build/mayne31-task-controls-revision-20261111/`（author-suite.tap／reviewer-repros.tap／reviewer-additional.tap／browser.log／typecheck.log／check-docs.log／逐文件 patch，gitignored）；关键 TAP 与截图随 MAYNE-31 评论区附件交付。
