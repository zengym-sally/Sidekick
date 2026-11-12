# W1 预览发布围栏与完整 draft 映射交付记录（Kimi，2026-11-09）

派工：协调评论 `01a1bf8a`（接 Hermes `01a1bf87` 的独立只读预览核对四面坐实）。
分支 `agent/kimi/mayne-24`，基点 `cbb04f7`（记录提交）之上**两个生产小提交**，未 push、未改状态，MAYNE-24 保持 `in_progress`。生产面恰 1 个 `server/lib/text-intake-service.mjs` 文件；Rust／DDL／003 冻结哈希／package／守卫／前端／II 测试／Runtime 零差异。

## 增量① `42d3b8a`：预览发布围栏

`stageReviseResult` 在 revise worker 的结果帧到达时即写 `candidate_previews` 行——worker 可能仍在运行、退出尚未确认。此前 `getSource` 的 previews 子查询只过滤候选状态（`status!='staged'`），`applyPreview` 只按 candidate/runId 查行，pending 候选＋已知 revise taskId 即可提前读取并实际应用（字段写入、version+1）。

- 公开读取与 apply 统一绑定**该预览所属 revise 的已发布成功结果与已确认退出**：任务终态 `succeeded`＋`attempt_exit_state='exited_confirmed'`＋暂存窗标记 `result_pending_exit=0`，且任务 `result_ref` 解析出的 payload 携带**此行**的 previewId（正常收口与 `commitStagedResume` 恢复发布两条路都落在此形状）。
- payload 绑定即"旧 attempt 遗留行不得借新终态放行"的机制：只有当前结果实际承载的预览会被发布；apply 显式按 released id 取行，同 (candidate_id, run_id) 的遗留行既不可见也永不被应用。
- apply 的前提纳入事务守卫：transact 内对 `tasks` 的预 commit 断言（`expectChanges:1`）重宣发布态与 `result_ref`，检查后交错（并发 apply、状态迁移）整体回滚，落既有 `version_conflict` 映射。
- 围栏不用删除实现：预览行与暂存 payload 字节原样保留，供既有恢复路径；退出未知／失败／取消一律 409 `state_conflict`（既有冻结映射），候选版本／内容零变化；行不存在仍 404 `candidate_not_found`。

## 增量② `2c39d7f`：完整 canonical draft 映射

- 读回按 canonical draft 取 `fields`（`fieldsToDomain`）并保留 `evidence`／`dueExpression`／`followupExpression`／`warnings`／`unresolved`——与候选线型同一属性集（冻结 §5.1）。此前整份 draft 直接喂 `fieldsToDomain`，title/kind/owner/priority/tags 全 undefined、evidence 恒 `''`、expressions 恒 null、warnings 恒 `[]`，静默降级。
- 显式 apply 同事务写全属性列（`fields_json`＋`evidence`＋`due_expression`＋`followup_expression`＋`warnings_json`＋`unresolved`），应用后候选与所应用预览一致；bare-fields draft（无 `fields` 包装）仍只动 fields，其余列保持原值。
- 预览生成本身不改候选（`stageReviseResult` 零字节未动）；不新增 Runtime／DDL／公开状态；候选／预览公共日期点线上转换按派工仍归服务端后继，本批未动 DTO。

## 聚焦前后回归（真实链，同环境，可证伪）

探针（生产服务装配＋真实 Rust 存储二进制＋真实 HTTP；受控真实 worker 进程说冻结 organizer stdio 协议、发 canonical 帧；数据库只读观测）：修复树 **26/26**（两连跑），基点 `cbb04f7` 隔离 detached 树同探针 **15/26**，11 红与登记缺口逐条对应：

| 面 | 基点 | 修复树 |
|---|---|---|
| F1 staged 窗：来源详情泄出预览／已知 taskId apply 成功并改候选 | 红（三项） | 绿 |
| F2 发布后预览完整可见（fields/evidence/双表达/warnings/unresolved）＋apply 恰一次更新＋二次 409 | 红（映射丢字段／属性不一致） | 绿 |
| F3 退出未知：不可见／拒 apply／resolve 409；恢复扫描确认后 resume 发布原预览才可应用 | 红（提前可见可应用） | 绿 |
| F4 旧 attempt 遗留行（同 run_id 异 preview_id）不得借终态放行 | 红（被列出） | 绿 |
| F5 暂存 payload 字节／预览行保留，预览生成不改候选 | 绿（两面均绿） | 绿 |
| G5 setid 逃逸 verifyTree 假 TRUE 仍发布（R7-M-2/M-3） | 红（登记红） | **红，同点保留** |

## 回归（本树字节，与既有登记对照）

- I 单测五套 53/55：恢复套件 F1／W 两红与基点**逐条相同**（ tracked bytes 为 adc31d8 登记版）；按派工原样覆盖 ZCode 更正字节 `82e1bf2`（blob `8c641b11`）跑后还原，**11/11**。
- `test:web-manual-items` **59/59**（源模式 entry＋cargo 二进制）。
- II 四套件同环境同夹具状态（II 夹具旧代配置形状为既存测试侧阻塞，按既有做法以合法配置覆盖物复跑 http）：http **18/24**、queue **4/17**、static **5/9**、controlled-model **5/16**——与基点**失败集逐条相同**；其中 T-9（真实 Pi revise→preview→apply 全链）两树均绿，围栏不阻正常发布路径。
- `check:structure` 自测通过；170 条违规均为会话前既存未跟踪 `.kimi/`，`server/` 零违规；`check:docs` exit 0（21 文件 513 链接）。

## 边界与后继

- 未跑完整 `npm run check`（III 唯一集成轮）；未 push、未改状态；未触真实模型／凭据／用户根。
- 存储二进制本机构建 `5311ffa3…232bd`（≠ 登记 `42af54b5…490fc2`，与上一轮同一未验证项，src-tauri 零改动）；随包 runtime organizer `08f32db2…`、node `9d050fd4…` 与既往登记一致。
- GAP-5（退出保证）保持红；可信 test 安全证明增量仍按既定顺序单独交付；候选／预览公共日期点线上转换、客户端适配分别验证。
- 生产独审请派未写本文件的成员，作者不自签。原始证据（两树探针输出、单测 TAP、II 对照、身份与 SHA256SUMS）在 gitignored `build/mayne24-preview-fence/`。
