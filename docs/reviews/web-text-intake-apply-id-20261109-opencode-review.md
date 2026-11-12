# W1 前端 apply ID 修复独立评审（OpenCode，2026-11-09）

> 派工来源：MAYNE-24 评论 `01a1bf4b`（Codex 锁定 `4c98309f`／tree `540a9eb3`，指派未写该文件的 OpenCode 并行独审差异与本轮证据）。评审对象是 OhMyPi 的候选提交；本评审者未写该前端文件，也未参与其证据轮。

## 1. 范围与身份

- 候选提交 `4c98309f2e14142d6e415bbfc8dbd9028f4622d6`（tree `540a9eb3…`，父 `b29afdcf`）。**实际含 3 个文件**：`src/lib/web-api-client.ts` +43/−12（55 为变更行总数，登记口径「一文件 +55/−12」不准）、新增作者评审记录 69 行、`docs/reviews/README.md` ±1。
- 附件 CLI 读回 10/10；`SHA256SUMS.txt` 复算 **9/9 OK**；`web-api-client-adapted.ts` 与 `git show 4c98309:src/lib/web-api-client.ts` 逐字节一致（`71b9b73d…f146aa2`）。

## 2. 代码面结论

对照审定后端字节（Kimi 增量树 `f91ddf56`，git blob 直接核对）：

- **修复一（apply ID）成立**：审定服务端 `candidate_previews.run_id` 确存 revise 任务 id（`stageReviseResult` 以 `taskId` 入列；apply 查询按 `candidate_id AND run_id`），`WirePreview` 同时携带 `previewId`/`runId`，`toPreviewRun` 改用 `runId` 正确且未加服务端别名。
- **修复二（候选平铺线型）成立**：审定 `rowToCandidate`（:270）确为 §5.1 平铺（`fields`/`evidence`/… 顶层、无 `draft` 包装），预览行确为嵌套 `draft`（:495）——两形状不对称属实，分别按实测登记是对的。`fields` 线型即内部 `TimePoint` 形，读路径免转换成立。

### 发现项（阻断最终签收的两个仍在）

- **F1（缺陷，已派修）**：`toCandidate` 把线型独有 `staged` 映射为 `pending`。审定服务端在退出确认前 wire 上确有 staged 行（:1049/:1054/:1110/:1115 证实生命周期），该映射会把未发布候选显示并变为可操作，违反「staged 不可见不可签收」；服务端隐身义务在 Kimi（仍待独立完成），客户端防线不替代。
- **F2（注释口径，已派修）**：diff 注释称「冻结 §5.1：fields 载内部 `TimePoint`」——atMs 形是**当前服务现状**，不是已批准的线上日期契约；候选／预览 ISO 点适配仍是未闭项。
- **F3（登记精度）**：提交范围与 numstat 口径见第 1 节，登记应为「一文件 +43/−12（55 变更行）＋恰两件 docs」。
- **F4（证据口径）**：`model-requests-sanitised.jsonl` 按目录跨轮累积——86 条中 **79 条属本轮之前**（06:37–07:40Z），**本轮自身增量 7**（A 段 5＋C1 提取 1＋C3 修订 1）；「本轮 86 次」为误标。A0 门控证明不受影响（79→82 为同文件轮内增量，采样窗 +3，第 4/5 个请求 29.96s/30.59s 落在采样后）；C5/C6 应用本身零模型请求。
- **F5（关键边界）**：运行时 dist（`index-DDAOkTXz.js`）与候选提交源码**不对应**——本审环境逐字节复现了 `5926cbc` 时代 on-disk dist（`index-Da2cpR9H`/`index-CQH58FJW`，证明构建哈希管线一致），而 `4c98309` 及其父 `b29afdc` 的重建均得不同资产名。且**提交字节本身过不了 C1**：`models.ts`/`agents.ts` 底部仍硬接 Tauri `invoke`（纯浏览器下「开始整理」永不启用）、`Workbench.vue` 收件箱导航 `:disabled="!nativeAvailable"`。作者运行树必然携带上述 I 范围文件的未提交接线改动（其工作树在审计期间被平台回收，字节不可追溯）。**候选提交对所记录证据不自足**；独审复跑需注册 overlay（见第 3 节），最终独立浏览器验收必须运行在完整前端状态（含这些 I 范围接线）已由授权写入者提交的树上。
- **F6（措辞）**：「逐旅程 20s 含清理」实为断言级 elapsed（最长 10111ms）≤ 预算，清理在 finally 于计量之外执行；两轮均无残留。

## 3. 浏览器证据面

**作者证据审计**：harness 无 `workerProcessFactory`（唯一出现为头注）、每次点击前检查 `disabled`、仅用原生 setter＋input 事件录入、真实 DOM `.click()`；`network.jsonl` 中 apply req/res（200）逐行在案；19/19 内部一致、预算 0 超时。

**本审独立聚焦 C 段复跑**（作者证据自足性被 F5 打破，故复跑必要）：

- 材料：审定服务端字节（`f91ddf56` git blob 物化 `server/`＋`shared/`）＋已登记存储二进制 `42af54b5…490fc2`＋organizer `08f32db2…11a7`＋node `9d050fd4…0588a`（均逐哈希复算）＋**本审自建 dist**（候选提交精确字节，资产 `index-BaaDl1HL.js`）。默认真实 Pi（不传 worker 工厂）；II 审定 fixture（`9a8b509d`／`aa84e81a`／`ea3211e5`，全引用逐字节稳定）驱动 loopback 受控模型。
- 注册 overlay（仅为解锁浏览器旅程，映射逻辑全部来自候选自身的 `asBackend()`）：`models.ts`/`agents.ts` 底部 `invoke`→`getWebApiClient().asBackend()`（2 行）＋`Workbench.vue` 收件箱导航解锁与 boot 刷新（3 处）——正是 F5 点名的三个 I 范围文件。
- 结果（全部页面真实控件、无 Vue 状态注入）：提交→真实 Pi extract succeeded→候选发布（staged→pending 由审定服务端完成）→**候选卡片完整渲染（平铺线型修复生效）**→页面请求修订预览→revise succeeded、preview `run_id`=revise 任务 id→C4 候选仍 v1/原题→**C5 真实点击发出 `POST /api/candidates/cand_859a5d03…/previews/tsk_01447b9c…/apply`→200**→**C6 候选变更：页面标题更新，只读库 v1→2、status pending、fields.due `{atMs,timeZone:Asia/Shanghai,localText:"11月25日",precision:"day"}`**。本轮模型请求恰 2（提取＋修订），应用零请求；临时根与进程零残留。

## 4. 结论

**通过（限定）**：`4c98309` 的两个修复面（apply ID 贯通 `runId`、候选平铺线型映射）对照审定后端字节成立，且经本审在精确候选字节＋审定服务端上的独立浏览器复跑证实。**不签最终版验收**：F1（staged→pending，已派修）与 F5（提交不自足／dist 溯源断裂）未闭。

未闭边界照旧登记：候选／预览日期点线上转换（本审复跑的预览面板同样显示「截止 拟改：未定期」，与作者记录一致，属该未闭项的表现）、显式 sourceAt 路径、staged 服务端隐身（Kimi 三项）、未参与生产的最终独立浏览器验收、完整 `npm run check`（III 集成轮）。

证据：`build/web-text-intake-apply-id-review/r1/`（复跑截图、模型请求记录、环境日志、SHA256SUMS；gitignored）。作者附件读回与哈希复算清单见第 1 节。
