# 增量 `ba92104`／`6caba12`／`c7cc116` 独立限定独审＋预览只读核对（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf77`（Codex）。对象：`29305da..c7cc1167fd87cbc35062bad01759a43e83ad1703`（tree `88fe669c…cc0b`，父链逐级复核一致），四个生产文件 +168/−28（task-scheduler 42/14、task-service 57/4、text-intake-service 47/8、worker-host 22/2）＋记录 `0536a44`；Rust／DDL／003／package／前端／II 套件／Runtime 零差异（自验）。未跑完整 gate；GAP-5 按派工保持开放未重测。

## 增量① `ba92104`（staged 公开读取不可见）：通过

HTTP 独立复放（真实 entry＋存储＋同根重启）：默认列表排除 staged；`?status=staged` 由 200 泄出改为 **400 `validation_failed`**；单候选读取 staged 行答 **404 `candidate_not_found`**（不揭示存在）；来源详情 candidates 排除 staged；重启后仍不可见；DB 内 staged 行原样保留（内部暂存未动）；staged 签收仍 409 `state_conflict`（`dd609765` 钉住的写守卫零改动）；来源详情 previews 子查询同幂排除。过滤词表收窄（staged 移出公开词表）与 §4.3 一致。

## 增量② `6caba12`（晚到结果 `rejected_late_result` 审计）：通过

service 级独立复放（真存储二进制，本树自建）：审计行 `type='rejected_late_result'`、`object_version`=**当前版本**（不 +1，多次审计各自携带当时版本）、payload 键恰 `{attemptId, reason}`、**不伪造 `task.changed`**（计数增量 0）、重复审计为独立行互不污染；worker-host 只传 `{reason:'attempt_identity'}`（帧字节/nonce 不过界，实读），审计挂同一有序帧队列保持到达时序；三栅栏（transport 身份 / attempt 非 active / attempt-epoch 归因失败）全部接线，归因失败经 staging 返回 false 捕获。审计写失败 best-effort（记 stderr 丢弃，与回执持久化失败同纪律）。cursor 前进无广播由 D1 既有 gap/淘汰语义容纳（未重测，静态核）。

## 增量③ `c7cc116`（不可确认退出登记 cause＋恢复条目）：通过

service 级独立复放（generic kind 实测）：`!exited` → `needs_review`/`exited_unknown`，`recovery` 对象解析（cause `exit_unconfirmed`，非 null——此前 recovery=null 的登记缺口闭合）；库内 failure 信封 `worker_lost/manual/unknown`＋cause（§4.6 注册表，runtime_start 映射）；`recovery_items`（version 1、pending）与任务迁移**同事务**；重复不可确认确认为**静默 no-op**（attempt/attempt-id 前置守卫，无第二恢复条目、无幻影事件）；extract/revise face 另有 `expectChanges:1`。有暂存分支保留暂存信封只缀 cause（静态核）。

## 只读预览核对（独立项；归属＝Kimi 服务端后继，非本三增量缺陷）

三面全部坐实（service 级，合法 canonical preview 帧后保持 worker 存活）：

1. **过早可读**：`stageReviseResult` 在退出前写 `candidate_previews`，候选保持 `pending`（staged 过滤不覆盖），来源详情的 previews 列表即列出该预览。
2. **过早可应用**：`applyPreview(candidateId, 已知 revise runId)` 在 worker 存活时全部闸门通过（候选 pending、版本一致、预览在）→ **实际应用**（字段写入、候选 version+1）——无任何退出确认围栏。
3. **draft_json 读回丢字段**：`getSource` 把存储的**整份 draft** 喂给宽容的 `fieldsToDomain`（无校验）——wire 预览 draft 的 `title/kind/owner/priority/tags` 全部丢失为 undefined，`evidence` 硬编码 `''`、`dueExpression/followupExpression` 硬编码 null、`warnings` 硬编码 `[]`；不抛错、静默降级（实测返回 `{"fields":{"due":null,"followup":null},"evidence":"",…}` vs 存储含完整字段与证据）。
4. 附带观察：revise 任务关闭（暂存结局胜出）后预览行**无退出耦合清理**，长期驻留。

以上四面属相邻生产缺口，单列归属：修法应在 `stageReviseResult`/公开读取与 `applyPreview` 增加退出确认围栏、`draft_json` 读取改按 draft 结构取 `fields` 并透传元数据；归 Kimi 服务端后继，与本三增量的判定互不影响（本三增量未触碰这些行）。

## 环境／来源登记（如实）

- 存储二进制为候选树自建，SHA-256 `5311ffa3…3232bd`（2647984 B）——**≠ 规范登记 `42af54b5…490fc2`（+1424B）**。诊断：src-tauri 对 `4fc9537` 零行差异、001/002/003 blob 逐字节相同（`93b0ed00`/`874c6049`/`e5103262`）、organizer provenance `ad702637`/`e89822b0` 与 organizer bundle `08f32db2…3911a7` 同登记——差异为本次构建嵌入的 s0-runtime 非源资源字节漂移，非候选所致；本审所核白名单／迁移／FK 语义均来自同一 Rust 源。既往登记仍以 `42af54b5…` 为准。
- 探针 12/12（随附件：脚本＋原始输出）；GAP-5 未重测；未触真实模型／凭据／用户根；MAYNE-24 保持 `in_progress`。
