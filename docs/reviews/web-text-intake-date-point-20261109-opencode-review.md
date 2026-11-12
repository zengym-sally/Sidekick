# W1 候选/预览公开日期点 DTO 窄增量独审（OpenCode，2026-11-09）

- 评审对象：`agent/kimi/mayne-24` 生产提交 `72f1bb89a030fc246df4771829a00e99f2dc16d8`（tree `6c2294b945c75478316e75a8322d897dafe3e67a`，父 `c32c251cdf60d453efc74c62ab4432a2558b8800`，记录提交 `e94ec84dd02944302ca58c9a70b1ca6fc7d5839c`），派工为 Codex 评论 `01a1c005-4cd8-72a3-bc36-158bb741deab`。
- 差异面：恰两文件 `server/lib/manual-items-service.mjs`（+6/−1）、`server/lib/text-intake-service.mjs`（+26/−4），合计 +32/−5；DDL/Rust/003 冻结哈希/package/守卫/前端/II 套件/Runtime 零差异（`git diff c32c251..72f1bb8` 复核恰两文件）。
- 独审身份：OpenCode。**未写这两个生产文件**——本审交付分支 `agent/opencode/mayne-24` 的全部 MAYNE-24 提交（`a054244`、`dae0986`、`d750c6b`）均为 docs-only（`docs/reviews/`）；两文件的本次差异由其分支归属者按 2026-11-09 派工补充（I 后端生产→Kimi）提交，本审全程未向该分支提交。
- 冻结契约本审复算吻合（P1 `b190f7c`）：web-api/1 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d`、text-intake `5982c06220b382182ee8ff82715ca0e794b4cd51988426d7d9b37da406cfe7b0`。

## 结论

**通过——限本派工面（候选/预览公开日期点 DTO 的九个面与转换只发生一次）。** 派工要求的覆盖全部成立：minute／day／null、列表／详情／来源候选与预览、编辑／丢弃／apply／签收响应、metadata 保真；转换只在 HTTP 序列化边界发生一次——存储 `fields_json`、revise task input、结果暂存保持私有 `atMs`，内部消费不被公开序列化反向污染；`wirePoint` 仅新增导出、函数体逐字节未变。真实 HTTP 前后反控给出可证伪对照：AFTER 两连跑全绿，BEFORE 恰 22 个判别面红且旧线型实测键集与作者登记一致。不签整体准出；未跑四套件或完整 gate（按派工），手工事项 59/59 证据复用作者登记 TAP。

## 静态读证（锁定字节逐面）

- **wirePoint 仅导出**：`manual-items-service.mjs` 唯一变化是 `function wirePoint` → `export function wirePoint` + 文档注释；返回表达式逐字节未变（`{at: new Date(atMs).toISOString(), timeZone, localText, precision}`，falsy → `null`）。其既有调用方（`toWire` 对手工事项 due/followup）零改动。
- **新增两个纯序列化助手**：`fieldsToWire`（`fieldsToDomain` 后仅替换两日期点）与 `candidateWire`（`{...candidate, fields: fieldsToWire(...)}`）；不新增任何解析路径，无第二套日期实现。
- **公开发射面全覆盖，无遗漏**：候选列表 `listCandidates` :549、单候选读 `getCandidate` :653、来源详情预览草案 `getSource` :634 全部改经 wire 映射；编辑 :681／丢弃 :703／apply :814 应答均经 `return this.getCandidate(...)` 自动同线。其余候选字段出口逐一排除：提交响应只回 task+sourceWire（无候选字段）、来源列表走 sourceWire、SSE 候选事件仅 `{sourceId}` 提示（sse-hub 声明 in-process hints only）、签收响应 items 走手工事项 DatePoint 线（`itemWireFromInternal`，本增量未触碰）。`run?.inputRef` 挂在来源详情响应上，为契约注册的 task DTO 字段（见登记观察 2）。
- **转换只发生一次（内部消费保持私有形）**：`fields_json` 写入走 `normalizeInput`（编辑 :674）与 `normalizeDraftFields`（extract 暂存 :1041、apply :789），输出消费 `atMs`；revise task input 携 `candidate.fields`＝`rowToCandidate` 内部形（:738）；`stageReviseResult`/`stageExtractResult` 原始字节零改动。差异未引入任何 wire→内部的回读。
- **minute/day/null**：`wirePoint` null→null；精度/时区/localText 原样透传；`at` 由同一 `atMs` 经 `toISOString` 确定性生成（恒毫秒精度、可逆）。

## 动态真实 HTTP 前后反控

自建探针（`probe-datepoint.mjs` + `stub-worker.mjs`，方法承 ZCode 已审 preview-fence 装置）：精确树 `startWebBackend` + 登记存储二进制 `5311ffa3…232bd`（2647984 B，SHA 使用前复算）+ 登记 node `9d050fd4`/organizer `08f32db2` + 真实 loopback HTTP + 真实 scheduler/worker-host 经生产 `workerProcessFactory` 接缝 spawn 受控 stub（冻结 stdio 协议、回显真实 runId/hostNonce、零模型调用零外联）；数据库只读观测（`node:sqlite readOnly`）；**零人工种写**——全部业务状态经真实 HTTP 产生。每跑 61 检查（wire 33／db 10／flow 17）。

| 树 | 判定 | 结果 |
|---|---|---|
| AFTER `72f1bb8` ×2 | 全绿 | wire 33/33、db 10/10、flow 17/17，exit 0（`after-run1`/`after-run2`） |
| BEFORE `c32c251` ×2 | 恰判别面红 | 22 个 DatePoint 判别 wire 面全红、11 个点形无关面绿、db 10/10、flow 17/17（`base-run1`/`base-run2`） |

- **判别面**（AFTER 绿/BEFORE 红）：列表、详情、来源候选、预览草案、编辑、丢弃、apply 七面的 due/followup 键集与取值（BEFORE 实测键集 `atMs,localText,precision,timeZone`，与作者登记 A1 红逐字一致——独立复现）、各响应体 `atMs` 零出现（AFTER）/出现（BEFORE）。
- **点形无关面**（双树同绿）：null===null、title/kind/owner/priority/tags 逐字节保真、预览属性保真、预览生成不改候选、来源 sourceAt（先于本增量已是 DatePoint）、**签收事项 DatePoint 线与签收响应零 atMs**（签收面从未在内部线型上——增量对其零波及，正是隔离性要求）。
- **db 面**（双树同绿，承载"只转换一次"）：extract/apply 后 `candidates.fields_json` 含 `"atMs":` 整数；revise task input `tasks.input_ref` 内 `candidate.fields.due.atMs` 为整数；`candidate_previews.draft_json` 暂存草案含 `atMs`；extract 暂存 payload 原始字节含 `atMs`、revise 暂存 payload 恰 `{previewId}`。
- **metadata 保真**（AFTER）：时区/localText/精度经列表→详情→来源→编辑→丢弃→预览→apply 全链逐字节相等；编辑输入以公开线（`at` ISO）提交、响应与存储分离成立；apply 响应字段与预览草案逐字段相等、版本 1→2、预览生成全程候选 version=1 且原 `atMs` 未动。
- **flow 面**（双树同绿 17/17）：提交→extract 发布→列表→详情→来源→编辑→丢弃→revise→预览发布→apply→签收全链在两树等价成立，证明差异只在序列化面。

## 登记观察（非阻断，不属本增量差异）

1. **编辑路径 `fields_json` 携带输入回声**：`normalizeInput` 返回 `{atMs, at, timeZone, localText, precision}`（`normalizePoint` 既有形状），编辑写 `JSON.stringify(normalized)` 后存储 JSON 同时含 `atMs` 与提交 `at` 回声（同一时刻、`normalizePoint` 强制精确往返、无漂移可能）；extract/apply 暂存的 `fields_json` 为纯内部形（本审 DB01b/DB07 实测）。消费只读 `atMs`（`fieldsToDomain`），公开序列化从不读该回声。属 `c32c251` 之前既有行为，本增量未触碰；作者"存储 fields_json 仍为 atMs"的说法成立（含 atMs），此条仅补精确形状披露。
2. **task DTO `inputRef` 公开回显内部形输入**：revise 提交响应/任务读的 `inputRef` 携 `candidate.fields.due.atMs`。web-api/1 §task DTO 明文注册 `inputRef` 为公开字段（"不可变输入引用…不含秘密"），且派工本身就要求该输入保持私有 `atMs`——回显是注册的 task 面而非候选资源泄漏，双树恒等。若未来要求 task DTO 收敛该回显，属另一窄决策，不在本审。
3. **签收 items 线型转换未复用 `wirePoint`**：`itemWireFromInternal`（text-intake :967-987）内联同线转换（多一个 `precision ?? 'minute'` 默认，经 `fieldsToDomain`/调用方形状实际等价）。语义恒等、无漂移实例；与本增量"共享转换器防再漂移"的方向同向，可作后续 nit。
4. `listCandidates` nextCursor 对尾行重复调用 `rowToCandidate`（仅取 ordinal，内部对象不序列化）——既有微低效，未变。

## 边界与不签范围

- 未跑 I 四套件、recovery、II 四套件、完整 gate（派工禁止；唯一集成轮另派）；手工事项 59/59 复用作者登记 TAP（附件 CLI 读回核验 `tests 59 / pass 59 / fail 0`，blob SHA `befe240b…`），未复跑。
- 未触真实模型/凭据/用户根（受控合成引用仅指死 loopback）；运行后 tmp 根 0 残留、0 遗留进程、两棵 detached 树全程 zero tracked modifications 并在取证后移除。
- 客户端配套（候选/预览 `toDomainPoint` 适配、控件旅程）按派工归 OhMyPi 后续交付并另审；sourceAt 面归 Hermes C4 审线；T-2/T-10 修补、来源判据修订、回执清理、退出保证 E、D 申请均按既派继续，本审不代签、不放宽。
- 未验证项如实保留：真实 Pi 正常链（T-9 面）本轮未重签（worker 侧由受控 stub 承载，与作者真实链登记互补）；组合分页光标下的批量列表 wire（本审单来源三候选已覆盖线型，翻页序属既有行为）。

## 证据

- 原始证据（gitignored）：`build/mayne24-date-point-review/r1/`——`admission.json`（身份/禁做项/清理）、`probe-datepoint.mjs`（`2a9cde9d…`）、`stub-worker.mjs`（`3ff7ca72…`）、四次运行原始输出与结果 JSON（`runs/results-*.json`、`runs/*.stdout`）、`SHA256SUMS`（14 项复算 OK）、登记二进制/运行时副本哈希、作者手工事项 TAP 读回。
- 关键原件随 MAYNE-24 评论附件交付：探针脚本、AFTER/BEFORE 各一份原始输出、四份结果 JSON、SHA256SUMS。
