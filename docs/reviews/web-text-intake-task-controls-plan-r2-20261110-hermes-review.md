# TaskQueue 任务控制方案 r2 `f8599ca` 限定复审（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c292`（接替未形成交付的 Claude run，沿 `01a1c270` 全部判据复审同一 `f8599ca`）。对象：`agent/opencode/mayne-24` 提交 `f8599cab6efb7972a2240ae986b21d4bd853fa2c`，恰 1 文件原位修订（blob `7ab436e`，SHA-256 `cd1063dbfd5b739e…`＝作者登记；r1 `9d52086`/`cf472285…` 自历史复算保留）。本审未参与方案编写；本人即 r1 独审（`01a1c254`）与恢复权威核证（`01a1c271`）作者——r1 被驳回结论的反转事实由本人 `9db4b8e` 独立复放坐实，本次复审以此为基础。逐源核查对 `5233e01` 在树文件、`git show cd08588`／`b190f7c` 提取件独立完成。

## 结论：**通过**（五焦点＋`01a1c270` 四反例核毕；两处补充判据须在冻结时补入文字，不动摇方案结构）

## 逐焦点裁定

1. **回退承诺废除**：r1 的「缺 itemVersion 取 1／缺回执当空即有效 CAS」规范承诺全文废除（§3.2 r2 规则、§3 表、§4.3、§7 U4、§8.3.4；全文 grep 无客户端回退残留——现存 `?? 1`/缺省字样均为服务端偏差描述或 exited_unknown 无 UI 路径注记）。新规则：`itemVersion` 须正整数、`receipts` 须数组；缺失/形状不符 → 入口禁用＋围栏重读＋行内提示，**缺失不等于 1、不等于空**，请求根本不发出。后端可用性（§8.3.4 显式前置，对照现后端全部入口呈禁用态＝正确安全行为）与 UI 测试种子（U4 权威前置红例构造缺字段线域行）已分开；并发版本仍取 settings 端点快照（§3 表、§4.5）。
2. **§2.3 偏差登记逐行核**：冻结锚 :102/:121/:136/:198 本审前轮已核成立；**:389 §12 本轮补核**——`recovery_items.version`「从 1 起、每次变更 +1」「任务 `recovery.itemId`/`itemVersion` 指向此行；两个 resolve 入口共用该版本做乐观并发」逐字在文。`cd08588` 偏差四条（权威源未接线/可处置形态不暴露版本/回执门空转/task 围栏不可替代）与本人 `9db4b8e` 独立复放（9 DEFECT/1 CONFORMS）及静态读一致。「后端前置不永久豁免」显式登记。
3. **attemptCount 时点**：§4.2 修正为本审 r1 澄清的原话方向——读时计数（243–245 核）、attempt 行于 `claimNext` 认领插入（841–872、`INSERT INTO task_attempts` 865 核），202 不携带 +1，U1 断言随之修正 ✓。
4. **提交前完整核对**：r1「标题＋索引＋发布后再读」口径废除；新专段：内联 ≤64KiB 渲染完整 payload，>64KiB 以现成 `readTaskResult(taskId, offset, limit)`（web-api-client 642–648，本审于 cd08588 独立核过支持分段参数）逐段累积至 `done===true`，「已载 X／共 totalBytes」进度；部分累积不写共享 store；**U10 红例明文「部分加载即标『完整』判红、累计 <totalBytes 时『完整』标记不出现」** ✓。零 client 改动经核成立（本审独立核过签名）。
5. **请求代次归属**：§5.2 r2 三元条件（mounted ∧ syncEpoch 不变 ∧ 该 key 无更新 generation）给出明确判据；行内错误/pending 归最新 generation（新动作清旧错误、旧代次迟到错误不渲染）；U9 带守卫摘除负例 ✓。
6. **写域/签名/挂载**：§8.3.1 过期 OhMyPi 登记按 `01a1c180` ③ 更正（与协调层本轮口径一致）；client 签名（本审 cd08588 独立核）、修订来源（writeModels 响应 revision）、挂载（完整 I Workbench `page==='inbox'`）均经源核。

## 两处登记缺口（须在冻结时补入判据，文字补齐即可）

1. **分段与 ACK 勾选对条目/attempt 变化的失效判据缺失**：`01a1c270` 明列「同一 taskId 在同 epoch 进入新 attempt 或恢复条目版本改变时，旧分段和旧勾选也不能沿用」——§4.3 专段只给加载会话的 generation/epoch/卸载归属，未写：围栏刷新带回新行（attemptCount 变化或 `itemVersion` 变化）时，已累积分段与已勾选 ACK 必须作废重置。建议补一句判据：分段缓存与 ACK 勾选以 `(taskId, epoch, itemVersion)` 为键，任一变化即整组作废。
2. **并发视图缺版本单调安装守卫**：`01a1c270` 问「仅声明每 key 最新 generation 是否足够」——**对共享的并发视图不够**：GET 与 PUT 若分属不同 key，generation 规则挡不住「旧 PUT 响应在较新 GET 读回之后落地、把显示版本拉回旧值」。需补判据：并发视图安装须版本单调（`响应 version ≥ 当前显示 version` 才安装），或把并发 GET/PUT 归入同一 key 并叠加版本单调。U6 宜加对应红例。

两项均为文字判据补齐，不涉及方案结构或生产面改动；冻结时补入即可。

## 未验项

方案文本无运行行为可验；§8.2 新单测与浏览器旅程未实施；后端修复候选 `b4aea55` 的 ACK 接线缺口（`taskResolve:817` 未转发 ACK）由 OpenCode 并行独审、ZCode 补线——本审不涉；r2 前置（后端权威修复）仍开放，r2 旧时点登记不视作前置闭合。逐源提取件（contract §12/claimNext/attemptCount）为本审 build 证据。

## 边界

不改方案/生产/package/公共索引；仅新增本记录与 build 附件；未跑聚合、构建、19 旅程或完整 gate。MAYNE-24 保持 `in_progress`；UI 实施与整体准出前置仍未闭合；E/D、GAP-5 边界不变。
