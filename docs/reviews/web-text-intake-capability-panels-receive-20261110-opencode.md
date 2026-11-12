# MAYNE-24 能力面三面板工程接收（OpenCode，2026-11-10）

派工：MAYNE-24 评论 `01a1c1b6`（Codex：另作工程小提交，仅从 `60ecc75` 原样接收三面板并逐 blob 核对；manifest 登记五项代码审范围、模型连接单次成功及探针残留／截止声明的限定；不接作者测试、夹具或整枝记录）。前置交付：任务 SSE 修订已于同日评论 `01a1c1c7` 交付（`9cb0b70`＋`d3feccd`＋`c5f5234`＋`170f611`，本提交在其之上）。本工树＝`agent/opencode/mayne-24`，基点 `170f611`。

## 范围与基点

- 基点：`170f611`（分支 HEAD）；来源提交 `60ecc75594a8c9ecbcf2397d03c843580f36c415`（tree `2e57f7a0…b791`，父 `61bd170`）。
- 接收恰三文件（生产前端，其余零字节）：
  - `src/components/AgentSettingsPanel.vue` → blob `8a44fc3d279e070d4df3820bd0681bd6def4288d`，SHA-256 `c44ca75a…e158`，13448 B
  - `src/components/ModelSettingsPanel.vue` → blob `e67f8d18d7d17f8dca01699c48e9b2000fcfa15a`，SHA-256 `8ce5ca2d…bad0`，21245 B
  - `src/components/SettingsPanel.vue` → blob `73c1f643fa15bb1335ee6b628ffe3de1ea182a8c`，SHA-256 `73e3fea9…6436`，9226 B
- 方法：`git show 60ecc75:<path>` 直接写盘后 `git hash-object` 复算，三者与派工 blob 全等；内容 SHA-256 同步登记 manifest。交叉稳定核验：`62bdccd`/`a1e15d4`/`8164dea`/`1e679ac` 四提交 `git ls-tree` 复算三 blob 逐一同值（作者后续测试／记录提交零生产增量）。
- 被取代字节：Agent `107b8d74`（frozen-I＝cd08588＝b5，本分支同）、Model `0216921e`（b5）、Settings `fa75f477`（frozen-I；本分支原为 `c412cf3f` 工程世系字节）；本分支差分恰 +55/−8，仅此三文件。

## 接收依据与 manifest 登记（修订 3 → 4）

- **五项代码审范围**（Hermes 独审 `6094a30`，五项要求源自协调 `01a1c15f`；静态全成立＋真实 Chrome×真实编译组件运行时 7/8 面）：①只开 organizer（未接角色 tab disabled＋诚实标注，背书 cd08588 `WIRED_AGENT_IDS`/`requireWiredAgent`）；②去未接角色预读；③试跑不因宿主标志解锁（`trialWired=false` 常量）；④凭据帮助按实际 HTTP 能力（钥匙串/native 分支删除）；⑤About/tab 文案收窄。第 8 面（连接测试完成时点）审时 91s 窗口未观测、如实登记——后由下项闭合。
- **模型连接单次成功**：修正编码重放（Hermes `01a1c1b3`）＝真实 UI→HTTP→默认 Pi→loopback 受控模型恰 1 次请求、任务一次尝试 `succeeded`（506ms）、totalMs=5539 exitCode=0；旧失败归因更正为探针双重编码（记录 `4fea18f`），不再归因生产退避（协调 `01a1c1b6` 接收）。窄收口补证（Hermes `01a1c1c6`，分支 `155a116`）＝句柄级逐 PID 退出核验＋`task_attempts.exit_reason=confirmed`（非取自 close 契约）、一次尝试 succeeded 604ms、totalMs=6251≤20000；结论限本例与当次夹具形态。
- **探针声明限定**（协调 `01a1c1b6` 不照单接收，按限定登记）：残留检查只查 storage／organizer 名称且要求 argv 含 root——漏 Chrome、模型服务、仅带 runtime 路径与 runId 的 worker；`backend.close()` 尽力关闭契约不替代确认退出事实；预算主要限制启动完成后的部分等待并终检 totalMs，尚非覆盖启动与清理失败的硬截止。5539ms 原件不改，不扩成普遍硬截止或全树保证。
- manifest 落点：三条目原位取代（B_frontend_b5／B_frontend_frozenI_rest，沿用 test-safety 原位更新先例）、F「UI capability revision」行改 RECEIVED、F「Task-SSE」行更新为 DELIVERED 待独审、新增 `adjudications.capabilityPanelsAdmission`、`writeView.revision4Recount`（条目计数不变仍 133）。旧字节身份在 lineage/supersedes 字段原样保留，不重签历史结论。

## 不接收清单

作者测试三文件（`web-text-intake-capability-ui.test.mjs` `7b9c0e59`／`capability-ui-browser.mjs` `ea0991d7`／`capability-ui-session.mjs` `486493a8`）及其夹具、`8164dea`/`1e679ac`/`a1e15d4` 整枝记录文档一律不接；测试新版仍走 Hermes 独审原线，不随此接收。

## 实际核查（限定，按派工）

| 核查 | 结果 |
|---|---|
| blob 复算 ×3 | 全等派工哈希（见上表） |
| `npm run typecheck`（接收前后各一次，vue-tsc 全树） | 前 exit 0、后 exit 0——可归因 |
| `npm run check:structure`（前后对照） | FAIL 集逐行全等：11 条（1×003 冻结＋3×vendor/pi＋7×在册接收集 ref.missing），零新增零消失 |
| `npm run check:docs` | exit 0（22 文件 583 链接） |
| manifest JSON 解析＋断言 | 三 blob/条目计数断言全过 |

未跑（按派工边界）：vite build／打包重建、行为套件重跑、聚合、完整 gate。

## 未验证项与边界

- 三面板运行时行为证据＝`6094a30` 独审及 `01a1c1b3`/`01a1c1c6` 限定运行观察，本提交不重跑、不扩签。
- 不接测试与夹具（ZCode 候选独审原线推进）；不改 package／依赖锁／其他生产路径；不操作 main；不启动正式集成或完整 gate。
- native 运行、整体准出、E/D/GAP-5 前置不变。MAYNE-24 保持 `in_progress`。

## 结论

限定接收通过：三面板以 `60ecc75` 原样字节成为本分支已审工程候选输入，blob 逐一命中；五项审范围、模型连接单次成功及探针声明限定已按协调口径登记 manifest 修订 4。原始证据 `build/mayne24-capability-panels-receive-20261110/`（gitignored：结构前后对照、blob 核验、manifest 更新脚本）。
