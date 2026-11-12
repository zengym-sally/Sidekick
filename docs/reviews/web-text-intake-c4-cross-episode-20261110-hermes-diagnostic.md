# C-4 跨轮旧请求重放独立核证（Hermes，2026-11-10）

派工：MAYNE-24 评论 `01a1c2ab`（与修复并行，只读独立核 `caff8b2` C-4「契约自身设计残余」判断）。受审树：当前本地候选线顶端 `4bf3472be37d320073a1ba48a8f4b9ae81f8e774`（含 ACK 接线合并与 `b4aea55` 修复）；存储二进制＝登记 `5311ffa3…`（本审留存件，与三方可复构建同哈希）。方法：同 taskId 两轮合法业务路径（每轮 submit/claim→`confirmExtractExit(exited:false)` 停靠→真实 `TaskRecovery.recover()` 回收至 `exited_confirmed`），**无回执、无暂存**（ACK 免除，避免回执门掩盖版本问题），零状态注入；归因账本逐步记录 task.version、attemptId、itemId、itemVersion。

## 实测账本（`4bf3472` 原字节，探针 exit 0，全程 <1s）

| 步骤 | task | recovery_items 行 | attempts |
|---|---|---|---|
| ep1 停靠 | needs_review/4/exited_confirmed | `rec_07d8…` v1 pending | 1（att_2442…） |
| ep1 resolve(resume, ev=1) | **成功** → queued/5 | 该行 → **v2 resumed/resume** | 1 |
| ep2 停靠（新 attempt） | needs_review/8/exited_confirmed | **插入第二行** `rec_f52a…` **v1 pending**；ep1 行 v2/resumed 保留 | 2（att_5169…） |
| **重放 ep1 请求**（resume, ev=1, ack=[]） | **接受** → queued/9，＋事件 | 第二行 → v2 resumed/resume | 2 |
| 变体：ev=当前 1 的 cancel | 409 `state_conflict`（任务已 queued） | — | — |

## 归因区分（逐项）

- **task.version**：4→5→8→9 单调；固定树条目 CAS 不读 task.version（R4：字面旧 task.version 重放在修复树已无意义——条目 CAS 是唯一相关校验）。
- **itemVersion**：**每轮重启为 1**（ep2 新行 v1）——旧请求的 ev=1 与新轮合法请求不可区分，这是重放窗口的成因。
- **itemId**：**每轮不同**（`rec_07d8…` vs `rec_f52a…`）——itemId 是现协议内唯一能区分轮次的字段。
- **attemptId**：每轮不同（att_2442… vs att_5169…）；请求不携带 attempt 绑定。
- **重放效果**：第一轮的 resume 决定被原样套用到第二轮条目上（第二轮行 v1→v2/resumed）——旧决定跨轮生效，无任何围栏拦截。

## C-4 判断的裁定：**「契约自身设计残余」不成立——既有契约内即可拒绝**

- 冻结 §12（`web-api-contract.md:389`）逐字：「`recovery_items`…每个 `needs_review` 任务对应**一行**；`version` 从 1 起、**每次变更 +1**」——按此唯一行+单调递增语义，第二轮停靠应 **UPSERT 既有行**（version 2→3、`verification_state` 回 pending、清 decision），而非插入第二行。若实现照此办理：ep1 旧请求 `expectedVersion=1` ≠ 行版本 3 → **409 `version_conflict` 拒绝**，无需 schema 变更、无需新规则、无需 owner 裁定。
- 实测中「每轮插新行」是实现选择而非契约要求；ZCode 的「per-episode version restart（§12:389）」引用实际与 §12 的单行单调措辞相悖——**「新集合从 1 起」不能作为豁免依据**（照协调层口径登记）。
- **附带发现（加固 C-2）**：第二条 pending 行由**合法业务流自然产生**（非注入）——C-2 的多行歧义面不止注入可达，两轮恢复即达；修复（UPSERT 语义）同时闭合 C-2 与 C-4。
- **最小方案（供修复轮）**：`markNeedsReview`/停靠写入改「同任务已有行则 UPDATE（version+1、state→pending、清 decision/decided_*），无行才 INSERT」——落在已授权写域语义内（不改 schema/守卫/契约/公共接口），与 §12:389 逐字对齐；resolve/`commitStagedResume` 的权威 CAS（rowid DESC 当前 pending 行）随之自然拒绝跨轮旧请求。**无需改公共承诺、无需交回 owner。**

## 未验项

`4bf3472` 的 UPSERT 行为未实施（本审只读）；HTTP 层状态码仍为代码读证（沿用上轮边界登记）；同轮内 `markNeedsReview` 并发窗口（C-2 注入面）未在本探针单独复测（ZCode 修复轮回归清单已含）。

## 边界

只读候选与生产；仅新增本记录与 build 证据附件；未跑聚合、构建、19 旅程或完整 gate；探针全程内存态＋临时根即删，无遗留。MAYNE-24 保持 `in_progress`；E/D、GAP-5 与整体准出边界不变。
