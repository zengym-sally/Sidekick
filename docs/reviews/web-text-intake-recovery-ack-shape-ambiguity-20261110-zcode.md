# 恢复链路 ACK 形状门与权威条目唯一性：C-2／C-3 一次闭合（MAYNE-24，2026-11-10，ZCode）

- **任务来源**：协调层派工（评论 `01a1c2ab-9d8c-7f1b-a364-7ffefb749f26`）——沿当前本地候选 `4bf3472` 一次处理 OpenCode 独审（`caff8b2`）登记的两项反例：**C-3**（ACK 形状：显式提供的非数组／非字符串成员数组须在两入口得 `validation_failed`／HTTP 400，不能子串确认、不能 TypeError 500，不加新回执 ID 格式规则）与 **C-2**（权威 pending 不唯一不得任选 rowid 最新处置；`markNeedsReview` 重复／并发不多插 pending、无幻影事件，保留原任务／attempt 围栏）。写域沿已授权两服务文件（`01a1c26d`）＋ `http-server.taskResolve`；必要夹具／回归允许；不扩 schema／守卫／公共接口；不再整枝合并；仅本地提交、零 push。
- **交付拓扑**：本提交直接位于 `4bf3472be37d320073a1ba48a8f4b9ae81f8e774` 之上（无合并、无 reset，保留全部历史），恰 5 文件：3 个授权生产文件＋1 测试＋1 夹具。README／manifest／package 零字节（工程接收接线，`01a1c26d` 口径）；本记录不进索引行（同前两轮）。

## 1. 身份

- 基点：`4bf3472`（合并 `f8a2de4` ＋ 接线）；本提交第一父＝`4bf3472`，差分＝恰本轮写域。
- 文件 SHA-256（提交字节）：`server/lib/task-service.mjs` `3a15a2e8…2bfc`、`server/lib/text-intake-service.mjs` `4bf48ad3…ee67`、`server/lib/http-server.mjs` `bc828184…88ba`、`tests/unit/web-text-intake-recovery-authority.test.mjs` `5ef4da8d…cb1f`、`tests/fixtures/web-text-intake/recovery-authority-instance.mjs` `5fa020ce…8714`。
- 存储二进制：本树 `src-tauri` 重建 `web-backend-storage`，SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`——与诊断／修复／接线三轮登记值**逐字节同值**（`build/s0-runtime` 资源目录复制自本机既有构建产物，tauri-build 存在性校验前置，不进存储 bin 编译面——同前几轮登记）。
- 冻结契约钉值：`docs/engineering/web-api-contract.md` 本树 SHA-256 复核＝`61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`（W0 冻结钉值精确命中）。

## 2. C-3：ACK 形状门（共享一处判定，两入口同门）

1. **共享形状判定**：`task-service.mjs` 新增模块级 `acknowledgedReceiptsOrRefuse(value)`（导出；`text-intake-service.mjs` 经既有 task-service 导入面引入）——`undefined`（省略）→ 既有空数组缺省；显式提供的值必须为数组且**每个成员都是字符串**，否则抛 `validation_failed`（HTTP 400 映射不变）。**无任何回执 ID 格式规则**：字符串成员不再有第二层形状。
2. **两入口接线**：`TaskService.resolve` 的 resume 回执门先过形状门再查台账；`TextIntakeService.commitStagedResume` 同位置同门。判定与消费点同址（resume 门），既有 409 门（状态／退出／缺失／已处置／版本）的先后次序对合法请求**逐字节不变**。
3. **handler 原样转发**：`taskResolve` 两处 `body.acknowledgedReceipts ?? []` 改为**原样转发** `body.acknowledgedReceipts`——省略仍走服务层空数组缺省；显式 JSON `null` 不再被合并为 `[]`，直达形状门得 400（派工点名的 null 反例面）。handler 仍零预校验（转发即全部）。
4. **被本门关死的旧语义**（`caff8b2` CC1 实测基线）：字符串含真实 receiptId 经 `includes` 子串放行（CC1a）、数字／对象 `.includes` TypeError→500（CC1b/c）——本门之后两者均为 400 `validation_failed`。

## 3. C-2：权威唯一性与生产者幂等

1. **`currentRecoveryItem` 歧义可见**：查询改为先取该任务的 **pending** 行——恰 1 行＝权威（两入口 CAS 对象不变）；0 行 → 回退「最新任意状态行」（已处置面 `state_conflict` 语义不变，B8 正控原样绿）；**≥2 行 → 返回可见 `{ambiguous:true}` 标记**，`resolve` 与 `commitStagedResume` 在已处置检查之前同答 `state_conflict`（「恢复条目存在多条待核对记录」），**不再任选 rowid 最新处置**（`caff8b2` CC2 实测反例关死）。`recoveryFor` 对歧义态**不暴露 `itemVersion`**（缺席成员＝可见信号，与缺行同口径）——客户端拿不到任何一行的版本，因为没有任何绑定该版本的请求能合法处置。
2. **`markNeedsReview` 幂等围栏**：任务 UPDATE（两变体）加 `expectChanges: 1` 前置断言；`exited:true` 变体 WHERE 增 `state<>'needs_review'`（不重复进入 needs_review：不二次推版本、不插第二条 pending、不发幻影事件）；前提丢失整事务回滚并按既有围栏口径答 `state_conflict`（transact 显式 `conflictCode: 'state_conflict'`）。两个既有调用方均容错（scheduler 完成失败路径 `.catch(()=>{})`；`maybeAutoRetry` 抛出由 worker-done 链既有 catch 承接，且其兜底 `markNeedsReview(exited:false)` 在前提丢失时同样零副作用）。

## 4. 红绿证据（同一测试字节：45 面＝既有 29＋新增 16）

- **绿（本提交字节终局运行）**：`node --test tests/unit/web-text-intake-recovery-authority.test.mjs` → **45/45 pass、exit 0、墙钟 0.79s、stderr 空**；提交前同字节另跑一次全绿（双运行留档）。最慢面 20ms 量级，20000ms 预算未触及。原始 TAP 随附件。
- **新增 16 面全为派工点名面**：G1–G7＝普通／暂存两入口的「含真实 receiptId 字符串」「数字」「对象」「显式 null（无回执任务，证明按形状拒绝而非按覆盖拒绝）」「混合数组」各反例＋零写入／零发布断言（任务不动、零版本推进、零幻影事件、条目 pending 不动、candidates 保持 staged）；**G8 CONTROL**＝合法数组（含空数组）照常通过形状门（完整 ACK 正控由既有 B6/C4/H4/H6 承载）；K1–K3＝双 pending 注入后普通／暂存入口 `state_conflict` 拒绝＋两行原样＋wire 无 `itemVersion`；K4–K6＝`markNeedsReview` 重复（exited:false／exited:true）与并发（Promise.allSettled）各恰一胜者：恰一条 pending、恰一事件、版本恰推进一次。H10/H11＝真实 HTTP 两个承重面：普通入口含真实 receiptId 字符串→**400**（前树 **202** 放行）、暂存入口数字→**400**（前树 **500**）。
- **定向差分反控（不重复基线红矩阵）**：3 个生产文件回退为 `4bf3472` 字节（SHA 复核还原）跑同一测试字节 → **30 pass / 15 fail、exit 1**：**恰 15 个新面全红且各按点名症状**（G1/G4/H10＝「Missing expected rejection」／`202 !== 400`——子串放行原样显形；G2/G3/G6/H11＝500／TypeError 侧症状（H11 实测 `500 !== 400`）；K1–K6＝静默处置最新行／双插入／幻影事件原样显形），29 个既有面＋G8 全保持绿。还原后 SHA 复核逐字节同值，终局绿运行在还原字节上复跑（`authority-45-green-final.tap`）。
- **邻域回归**：既有 recovery 套件（`web-text-intake-recovery.test.mjs`，F1/W 修正夹具字节）在本树 **11/11 绿、exit 0、墙钟 56.7s**——与接线轮登记的合并树结果一致，本轮写域对其零回归。

## 5. 门禁（聚焦口径，不跑聚合／完整 gate）

`node --check` 5/5（3 生产＋测试＋夹具）exit 0；`npm ci --ignore-scripts` exit 0；`typecheck` exit 0；`check:docs` exit 0（21 文件 519 链接，计数与接线轮一致——本记录零本地相对链接）；`check:structure` FAIL 集＝登记基线逐项同集合（运行环境注入的 `.zcode`／AGENTS.md 噪声＋3×s32 vendor/pi dist 缺失），**零新增零消失、零本轮写域提及**。未跑：聚合、完整 gate、19 旅程、`cargo test`、真实模型、`cd08588` 完整基线红矩阵（本轮差分以 3 文件回退承载）。

## 6. 登记（不隐瞒）

1. **形状门绑定消费点**：普通入口 `decision:'cancel'` 携非法形状 ACK 仍被既有语义忽略（cancel 不消费回执，门在 resume 分支内）——两入口指普通 resolve 与暂存 resume 两条**入口**；若 owner 要求 cancel 亦校验形状，属新增语义，另行派工。
2. **查询成本**：`currentRecoveryItem` 正常路径仍一次查询（pending 查询）；仅「零 pending（已处置面）」回退路径多一次查询（1→2）——与 C-6 同类的边缘读放大，活跃路径零增量。
3. **写域外观察（未动）**：`TaskRecovery.classify` 的 running 分支（running→needs_review 直插 pending 条目）在**并发 recover()** 下存在与 C-2 同类的理论双插窗口；该文件不在本轮授权写域，仅登记，不代改。
4. **跨轮旧请求**：C-4（跨集陈旧重放）按派工归 Hermes 独立核；本轮未实施任何跨集重放语义，套件未含该面——待 Hermes 证据到达后再定是否入回归候选。
5. 作者不自签；本候选整体及后继差分待独审。原始 TAP／差分输出／逐文件 patch／SHA256SUMS 在 gitignored `build/mayne24-ack-shape-ambiguity/`，随评论附件交付关键件。MAYNE-24 保持 `in_progress`。
