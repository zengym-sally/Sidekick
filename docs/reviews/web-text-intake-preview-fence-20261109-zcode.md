# W1 预览发布围栏＋完整 canonical draft 映射两增量独立独审（ZCode，2026-11-09）

派工：协调评论 `01a1bfcb`（接作者交付 `01a1bfc7`）。评审人 ZCode 未写 `server/lib/text-intake-service.mjs`（作者 Kimi），本审为独立独审。

**身份核对全部成立**：候选恰为 `42d3b8acb1450709325010f97cdcc0b1a08ab93d`（tree `56b12d11`，父恰 `cbb04f7`）＋`2c39d7f5eb0645144faa3738a85f5078d9ab8646`（tree `d77ecf05158aff6569a2cd274c0f5da8d1107d54`，与锁定一致）；相对基点 `cbb04f7c32d1752bc8be97cd95a50ca2f5185215` 恰一个文件 `server/lib/text-intake-service.mjs` +168/−27（blob `3e3e82e7`→`36eb4c66`；增量① +113/−27、增量② +63/−8），Rust／DDL／003／package／守卫／前端／Runtime 零差异；`src-tauri` 对基点零行。记录 `a3506af` docs-only 恰一新文件，与评论一致。

**实际产物（本审复用，不重建）**：存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2647984 B，即 `6c269ea` 登记的新构建身份；两树 `src-tauri` 与登记输入树零差异，故输入成立）；随包 runtime organizer `08f32db2…`、node `9d050fd4…`（v24.20.0，实际执行 probe 与 stub worker）；本机 rustc 1.99.1（`58cf8f9c3`）读回一致。两棵隔离 detached 运行树 `2c39d7f5`／`cbb04f7` 全程 zero tracked modifications。

**两条独立结论**：

- **增量①（`42d3b8a` 预览发布围栏）：通过**——限派工七面中的围栏面（canonical 帧后 worker 存活的读取／直接 apply 围栏、退出未知及恢复发布、旧 attempt 遗留 previewId 不借新终态放行、检查后交错事务整体回滚）。
- **增量②（`2c39d7f5` 完整 canonical draft 映射）：通过**——限完整 draft 属性读回与显式 apply 一致、预览生成不改候选、既有 bare-fields 路径未退化三面。
- **GAP-5（setid 逃逸 verifyTree 假 TRUE 仍发布）两树同点红，未修未掩**；日期点 DTO 与 D 的操作重放不代签（见边界）。

## 静态审（逐 hunk）

- `publishedPreviewId`：公开形状绑 `state==='succeeded'`＋`attempt_exit_state==='exited_confirmed'`＋`result_pending_exit===0`＋任务 `result_ref` 解析出的 payload 实际携带此行 previewId。两条合法发布路径都精确落在此形状：正常收口 `confirmExtractExit` 暂存分支（`result_pending_exit=0,pending_outcome=NULL`，`result_ref` 保留）与恢复发布 `commitStagedResume`（同样清标记、保 `result_ref`）。`resolvePayloadRef`／`readResultPayload`／`rowToInternal`（`row[16]`=result_ref）均为既有生产方法，未新增接缝。
- getSource 预览查询改 JOIN `tasks ON t.task_id=p.run_id` 并逐行 `previewReleased`：staged 窗、退出未知、失败、取消一律不列出；payload 绑定使旧 attempt 遗留行（同 candidate/run 异 preview_id）不可能借新终态出现。
- applyPreview：先按 (candidate,runId) 查行（无行仍 404），再显式按 released preview_id 取行——应用的就是任务当前结果承载的那一行；取不到行 409 `state_conflict`（既有冻结码），候选版本／内容零变化，预览行与暂存字节原样保留（围栏不用删除实现）。事务守卫 op0 `UPDATE tasks SET version=version WHERE … AND result_ref=?`（`taskRow[16]` 原文绑定，`expectChanges:1`）在 transact 内重宣发布前提；失败走既有 `transact` 助手（`WEB_BACKEND_CONDITION_FAILED`→`version_conflict`，基点 :178 已存在）整体回滚。
- 增量②：`draftAttributes` 读回保留 evidence／双表达／warnings／unresolved（canonical 判定：对象且 `draft.fields` 为非空对象）；bare-fields draft 读回形状与旧字节一致（`''/null/null/[]/false`）。`appliedAttributes`＋扩展 UPDATE 在同一事务写全属性列；bare-fields apply 写回候选自身现值（等价于旧字节只动 fields，且受同一 version CAS 保护）。`stageReviseResult`（预览生成）零字节未动。

## 动态审（真实链，同环境两树对照）

探针：生产 `startWebBackend`（精确树）＋真实 Rust 存储二进制＋真实 loopback HTTP＋真实 scheduler／worker-host 经生产 `workerProcessFactory` 接缝 spawn 受控 stub worker（说冻结 stdio 协议、回显真实 runId/hostNonce、零模型调用零外网）；库只读观测（node:sqlite readOnly）。两处披露的合成种子仅作反控（遗留预览行 INSERT、I2 中对 `result_ref` 的翻转＋恢复），从不伪造成功。会话走 `onPairingCode` 私有码→`/api/pair`，写请求带 CSRF/Origin；模型配置走合法 `PUT /api/models` DTO（受控 credentialProvider、死 loopback baseUrl）。

- **候选树 `2c39d7f5`：31/31（三连跑 cand-run1/2/3，全部通过，确定性）**。
- **基点树 `cbb04f7` 同探针：25/25（三连跑），11 个登记红面逐一复现**：staged 窗预览被列出（1 项）＋已知 revise taskId 直接 apply 200（候选 version 1→2、字段进但 evidence/双表达/warnings/unresolved 全丢）；发布后预览读回属性全空（`''/null/[]/false`）；退出未知期预览被列出且 apply 200；恢复发布后读回属性仍空；遗留行被列出（DB 2 行、HTTP 列 2 行）。
- 候选树逐面对照（基点红→候选绿）：staged 窗（worker 存活、`running`+`resultPendingExit=true`）来源详情 0 预览、apply 409 `state_conflict`「预览尚未发布，请等待整理完成。」、候选 v1 零变化；发布后恰 1 预览、完整属性读回与 canonical draft 逐字段相等（fields 经 fieldsToDomain 同形状）＋显式 apply 200→候选 v2 且 HTTP/DB 列全部等于所应用预览、二次 apply 拒绝；退出未知（`needs_review`/`exited_unknown`/`result_exit_unconfirmed`）不可见、apply 409、resolve 409 `exit_unconfirmed`，重启（registerEpoch+recover）确认退出后 resume→202→`succeeded` 发布原预览→apply 200 一致（恢复发布面闭合）；遗留行（同 candidate/run 异 preview_id 种行）不可见、apply 恰应用 released 行（属性≠种行）、陈旧版本再 apply 拒绝；预览生成全程候选 v1 字节不变。
- 交错面两探针：I1 并发双 apply（纯真实）恰一 200 一 409 `version_conflict`、候选 v2 恰一次、无部分写；I2（披露反控）在 apply 事务内翻转 `result_ref` 后提交——op0 `expectChanges` 不匹配→`WEB_BACKEND_CONDITION_FAILED`→`version_conflict` 409，候选 v1／内容／预览行全部原样（整体回滚），前提恢复后链路不受影响——op0 守卫承重且不误伤。
- bare-fields 面：读回旧形状一致（两树同绿）；apply 后 fields 更新、候选其余属性列保持原值（两树同绿，未退化）。
- **GAP-5 反控（两树同点红）**：stub 叶经中间进程 `setsid` 逃逸（新会话、组外、未注册、无 `--run` 标记）→ `verifyTree` 假 TRUE → 暂存结果照常发布且 apply 200，同时存活进程 `kill(pid,0)` 成立——两树各三跑均复现（G1/G2 gap-red 面 pass=红在），未修未掩，退出保证仍开放。
- 运行卫生：探针根 `/tmp/w1-pvf-*` 六场景×每跑即删，终态 0 残留；0 遗留进程（stub/python/组）；两运行树 zero tracked modifications、用后整体移除；诊断输出无密钥（受控合成引用仅指死 loopback）。

## 边界与非代签（本审不覆盖）

- 真实 Pi worker 正常链（T-9 修订→预览→应用）不在此重签：worker 侧由受控 stub 承载（协议反例夹具），真实 Pi 路径以作者登记与既 II 对照为准；frame→staging 接线属已登记范围，本审未重测。
- 日期点线上转换（候选／预览 DTO）与 D 的操作重放按派工明确不代签，本批两树字节也未触这些面。
- 通用 `taskService.confirmExit` 的暂存分支不清 `result_pending_exit`——通用任务无预览行，不构成本围栏缺口；登记为边界观察。若未来有通用任务携带预览形状，需重审该分支。
- 观察项（非缺陷）：getSource 预览查询 INNER JOIN tasks——tasks 行缺失的预览行会静默消失（生产无 `DELETE FROM tasks`，实际不可达）；canonical draft 缺 `evidence` 键时 apply 回退候选现值而双表达回退 null（canonical 形状 evidence 为必有串，语义合理但不对称，登记备查）；getSource 每预览行一次 payload 读（量级小，性能观察）。
- 未跑四套件、I 单测、manual-items、完整 gate（派工禁止重复）；聚合准入归协调；MAYNE-24 保持 `in_progress`。

## 证据

原始证据 gitignored `build/mayne24-preview-fence-review/`：`probe-final.mjs`＋`stub-worker-final.mjs`（ SHA256 `50798642…`／`eed88f99…`）、`runs/{cand,base}-run{1,2,3}-results.json`（逐检查含实际信封）、`artifacts/`（5311ffa3 二进制＋runtime 副本）、`SHA256SUMS.txt`（9 项＋rustc 读回）。评审评论挂关键原件。
