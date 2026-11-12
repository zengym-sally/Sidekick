# W1 残余失败 C2–C5 与 A8 只读取证（ZCode，2026-11-09）

派工：`01a1bec0-361e-7c39-8446-1f8e720ab9b3`（2026-11-09，队长）。对象：本审 `3e867a7` 登记的「待裁 12 例／5 族」中的 C2–C5 与生产须修 A8，全部只读取证（对象库 blob 读取＋CLI 附件实读），零探针重跑、零生产／测试／Runtime 字节改动。TAP 原件为 OhMyPi 交付评论 `01a1be84` 的 14 附件，本轮 CLI 重下载五份（queue/cm 各前后＋static 后），SHA-256 见 `build/mayne24-c2c5a8-forensics/SHA256SUMS-taps.txt`（gitignored）。

## 0. 对象身份（blob 锚，本轮逐一读取）

| 内容 | blob（短） |
|---|---|
| `ef0f0d4` worker-host / text-intake-service / task-scheduler / task-service | `4b5331fb` / `9ae8fc09` / `7f9c9da0` / `89f7e329` |
| `7f3322b` 四套件（queue/cm/http/static）＋ model-config 夹具 | `fccd8675` / `3fe17f58` / `58ede62f` / `837b9143` / `8596b78e` |
| `61a069b` protocol-worker-process / backend-process / controlled-model / synthetic-inputs | `c9f28a8a` / `7069c665` / `72a8d755` / `d5e10991` |
| `9414f23f` organizer-entry（`23eb1a1:runtime/entries/organizer-entry.mjs`）；`c4a9c67` organizer-contract | `9414f23f` / `4fe0d118` |
| 冻结契约：`b190f7c6` web-text-intake-contract；当前 HEAD web-api-contract | `30f1c7af` / HEAD |
| `d79b1f6`（tree `8324c0b2`，I 候选树顶）Workbench / TextIntake / web-api-client；基线 `1e37044` Workbench | `c5af8bac` / `1816420f` / `2aa6e481` / `2aa1f2b9` |

## 1. C3：协议工厂 6 例 —— stage 失败先于一切，派工点名问题核实成立

队列套件 after-TAP 协议家族红共 7 例（not ok 10–16）；其中 GAP-5（not ok 14）按 C2 面裁定（§2），其余 6 例归本节。**单一根因：夹具载荷非规范形。**

链路（全部行号锚到上表 blob）：

1. `protocol-worker-process.mjs:71-89` `payloadFor` 对 extract 发出**平铺候选** `{candidates:[{title,kind,owner,priority,tags,evidence,dueExpression,followupExpression}]}`——无 `fields` 对象。真实 `organizer-entry` 经 `parseModelResult` 后发出的是规范形：`organizer-contract.mjs:21` `extraction()` 产出 `{fields:{…},evidence,dueExpression,followupExpression,warnings:[],unresolved:false}`，`organizer-entry:139` 原样 `emit({type:'result',data:canonicalOutput})`。
2. 生产 `task-scheduler.mjs:205-216` result 帧驱动 `stageExtractResult`；`text-intake-service.mjs:738` 逐候选读 `candidate.fields` → `normalizeDraftFields(undefined)` 在 `:65` **抛 validation（'input 必须是对象。'）**——暂存事务从未执行，`resultPendingExit` 保持 0、零暂存候选行。
3. 暂存失败被 worker-host `:349-351` 吞为 `frameFailures`，但 `:354` 仍记 `state.result=frame.data`，`:395-396` 退出时 outcome='succeeded'——这只是宿主侧出口事实。
4. `task-scheduler.mjs:260-261` extract 收口走 `confirmExtractExit`；`text-intake-service.mjs:835-859`（R7-M-1 分支）`resultPendingExit!==1` 且非取消 → **failed，信封 `worker_lost`／'整理进程未返回结果。'／manual／sideEffectSafety unknown**（`:842-844`＋`task-service.mjs:87` 默认 unknown）。
5. `task-scheduler.mjs:281` → `task-service.mjs:809-818` `maybeAutoRetry`：`sideEffectSafety!=='proven_safe'` → **§4.6 安全路由 `markNeedsReview(cause='failure_unknown_side_effect')`（exited:true → exited_confirmed）**。

TAP 逐例吻合：not ok 10（well-behaved 控制）断言即刻抓到 `failed/worker_lost/exited_confirmed/resultPendingExit:false`；not ok 11/15/16 的 poll 观察到 `needs_review/exited_confirmed/recovery.cause=failure_unknown_side_effect`（failed→needs_review 翻转发生在两次 poll 之间）；not ok 13（GAP-4）首任务断言 `succeeded` 实得 `needs_review`，同根因。GAP-4 的围栏面（stale 帧被拒）未被本轮红证伪——用例死在正确盖章帧的暂存失败上。

**裁定**：派工问题「是否先发生了 stage 失败，不能把失败暂存当成功暂存裁定」——**核实成立：暂存先失败，生产从未把失败暂存当成功暂存**；产物不是「§4.3 发布 vs §4.6 安全路由」两裁定相撞（根本没有成功暂存可发布），而是「夹具非法载荷 → 暂存拒绝 → 无暂存确认退出 → R7-M-1 failed → §4.6 安全路由」的单一合法链。§4.3「暂存＋确认退出→提交原暂存结局」的真实链已由他证覆盖（cm T-4 `length===2` 断言过，真实 Pi 全链 staged→confirmed→publish；OpenCode `db96401` 审：暂存落库后 deadline 击杀两树均 succeeded＋发布）。修复归属夹具：Pi 修 `payloadFor` 发规范形——最小规范载荷为 `candidates:[{fields:{title,kind:'action',owner,priority,due:null,followup:null,tags}, evidence, dueExpression, followupExpression:null, warnings:[], unresolved:false}]`（`normalizeDraftFields` 全部校验点：`:65-83`，`normalizeDraftPoint:null` 合法 `:44`）。附注：`payloadFor` 的 revise 形 `{changes:{title}}` 同样非规范（真实形为 `{preview: draft}`，`organizer-contract.mjs:32-38`）；现无用例经 revise 协议夹具，留一句防后患。

**~14s 更正（对我 `3e867a7` 登记）**：GAP-3-default（not ok 12，duration 14044ms）的 TAP 错误文写明 **last observed `state=running attemptExitState=active resultPendingExit=false`**——任务未终止；~14s 是用例自身 poll 窗口（`waitWithin(deadline,10000)`）到期的用时，非任务终点。r5 前TAP 同用例死于提交 400（配置非法，4045ms）。**缺省 120000ms 误触发无证据，「查明终止来源」问题消解**——该红与 GAP-3 同根因（暂存从未成功，`resultPendingExit` 永不置位），不构成独立裁定项。

## 2. C2：T-6／GAP-5 `exited_confirmed` vs 断言 `exited_unknown`

两例实红同为 `actual: 'exited_confirmed' / expected: 'exited_unknown'`（queue TAP not ok 4 `:380`、not ok 14 `:1171`），但机制不同：

**T-6（真实 Pi worker 被 SIGKILL）**：生产确认不是「把根进程退出当树退出」——`worker-host.mjs:395` exit 事件后 `finish()` 调 `verifyTree`（`:69-94`），三重实证：`process.kill(-pgid,0)` 组灭 ESRCH、`record.children` 直子核查、`ps` 全表 `--run <runId>` 扫描；`confirmExit:471-475` 仅 `treeVerified!==false` 才 confirmed。无工具/无 MCP 的真实 extract worker 无组员，SIGKILL 后组确实灭——confirmed 是**实证组灭绝**，符合冻结契约 `web-api-contract.md:75-76`（迁移键是「所属进程树退出已确认／无法确认」）与 `:61`（结果上报不构成退出确认——此处确认来自进程表证据，非上报）。套件「SIGKILL ⇒ 必 exited_unknown」的 blanket 断言比契约严：契约按核实结果分支，不按终止方式分支。**裁定：T-6 归「套件期望严于契约」，生产落在其实证覆盖内；按 r1＋`01a1bd87` §7 口径（组灭绝只证自身覆盖、不升级为完整树证明）停车，本轮不改。**

**GAP-5（lingering-tree 夹具）**：这是 **E1 类逃逸的具体实例**——`protocol-worker-process.mjs:114-127` 孙进程 `detached:true` 自成进程组、argv 不含 `--run`，worker 退出后孙进程被重父化使 `childPids(死pid)` 恒空（`:371` 的直子核查在 exit 时刻已空转）——三重检查全部失明，`verifyTree` 返回假 TRUE，生产在**孙进程仍存活**时 confirmed。契约要求「退出无法确认 → exited_unknown」（`:76`），§7 口径明文「E1 正是无法被识别的逃逸」。**裁定：GAP-5 登记为生产侧 `verifyTree` 覆盖边界缺陷（setid 逃逸后代不可见）的真实暴露面，按通用 unknown 裁定停车不变；补强（如 runtime 注册后代身份／spawn 时预枚举直子）属后继生产改动，非本轮。** 另注：GAP-5 同时叠着 §1 的暂存失败根因（其断言先死在 exit 状态上），修夹具载荷不会让它变绿。

## 3. C5：M-11 与 cm boundary —— 均可归因，且都不是产品面

**M-11（T-4 joint proof，cm not ok 7）**：红在 `cm.test.mjs:395-397` —— `const tree = new Set(descendantPids(process.pid))` **一次性快照**后再 poll `tree.has(entry.pid)`。`backend-process.mjs:231-246` `descendantPids` 只枚举调用时刻存活的后代；bash-worker 只能在「worker 起来 → 模型往返 → toolCalls 响应 → managed-bash spawn」之后存在，必然晚于快照 → 该 poll **无论产品行为如何都不可能命中**（对照：同文件 `findOrganizerWorkers:251-255` 每次 poll 内新鲜枚举，故第一个 poll 能抓到晚生的 worker）。夹具自证缺陷，TAP 8s 超时与机制吻合。**M-11 联合证明本轮仍未被签红也未被证伪**（用例死在 relay 断言之前，子进程是否真跑过无从得知）；修复归属夹具（poll 谓词内重算后代集）。旁证：直驱工具链用例（cm ok 2）三请求＋relay 全过，能力位（model-config `:73` `capabilities.toolCall:true`）与 runtime 门（`organizer-entry:114` useTools 对 extract＋toolCall!==false 为真）都成立——产品侧无反证。

**cm boundary（not ok 16，10s poll 'the empty-candidate task to finish' 超时，last observed null）**：级联，空候选场景根本没跑到。链条：用例 12（'service dies mid-request'，**通过**）按设计杀死模型服务且套件不重启（`cm.test.mjs:512-514` 注释自认）；用例 13–15 全死在 B1（`runFaultCase:448` `deadline is not defined`，TAP 逐例证实，未触任何产品路径；用例 14 崩前已把 baseUrl 写回，但服务进程已死）；用例 16 提交后 worker 打到死端口 → 模型请求失败 → **无 result 帧 → 无暂存 → 确认退出走 R7-M-1 `worker_lost`（§1 链第 4-5 步）→ `maybeAutoRetry` 安全路由 → `needs_review`** ——而用例 poll 谓词只认 `TERMINAL=['succeeded','failed','cancelled']`（`cm.test.mjs:53`、`:560-565`），`needs_review` 永不命中 → 10s 超时。**空候选的产品语义本轮既未证红也未证绿**：直驱用例（cm ok 4）已证真实 runtime 接受空候选为合法成功（result `candidates:[]`、exit 0），生产路径空候选面待夹具修复后重验。附带夹具缺口：poll 谓词宜纳入 `needs_review`（或按状态断言），且死服务后应重建服务再测空候选。

**新登记（生产侧，B1/R8-M-3 族相关）**：extract/revise 收口**丢弃错误帧码**——worker-host `:397` 把 errorFrame 码放进 outcome payload，但 `task-scheduler.mjs:260-263` extract/revise 分支不传 payload，`confirmExtractExit:835-859` 无暂存分支只写 `worker_lost`（deadline 面 `model_timeout`→别名 `model_request_failed`）。后果：模型 401/5xx/断流/非法输出/不可达等**一切未暂存 extract 失败的信封码都是 `worker_lost`**，`task-service` 的 FAILURE_CODE_ALIASES（`MODEL_INVALID_OUTPUT`→`output_contract_invalid` 等，`:33-45`）对 extract/revise 不可达；随后 §4.6 安全路由一律 `needs_review`（sideEffectSafety 默认 unknown，`maybeAutoRetry:816`）。**R8-M-3 逐码故障矩阵在现链上即使修好 B1 也无法按码观测**——这是生产侧缺口（错误帧码应进 extract/revise 收口信封），归属 Kimi 后继，非本轮改动；登记以供 B1 修复后预期落点对齐。

## 4. C4：来源时间锚唯一线型建议（不改实现／测试）

**建议线型（唯一）**：`sourceAt` 请求与响应两侧均为**手工事项 due/followup 点 DTO 的同一线型**——

```json
{"at":"2026-11-13T10:00:00.000Z","timeZone":"Asia/Shanghai","localText":null,"precision":"minute"}
```

依据三重收敛，无第二候选：(a) 冻结 web-api §1（HEAD `web-api-contract.md:13`）钉死线上时间＝ISO 8601 UTC 毫秒字符串；(b) 既有日期 DTO 已是该形——`text-intake-service.mjs:676-677` `itemWireFromInternal` 的 `due/followup` 线上形 `{at:toISOString(), timeZone, localText, precision:??'minute'}`，且 P1 §5.1（`30f1c7af:119`）钉「候选字段与手工事项同构」；(c) II 套件已按此形断言（http T-12 `:905-918` `sourceAt.at` ISO 断言＋显式锚 verbatim；dedup `:528`）——**改成任何别的线型都要改已冻结的套件面，唯此形三方零冲突**。生产现状 diverge 于两侧：提交侧 `submitSource:263-265` 只收整数 ms（对象即 400 'sourceAt 无效。'），读回侧 `rowToSource:189-201` 裸出 `sourceAtMs` int（T-12 实红 `:905` 'the source must carry its time anchor'）。

**语义不动**：缺省＝首次录入（`anchorAtMs = sourceAtMs ?? now`，`:285`）、显式锚 verbatim、指纹去重保首锚（P1 `:117`）全保持。**存储／DDL 零改动**：`source_at_ms/anchor_at_ms/time_zone` 已足，读回时映射为 DTO（首锚默认 `localText:null, precision:'minute'`）。**Runtime 零改动**：worker 请求内部形保持 `{source:{text,sourceAtMs,timeZone}}`（`:306`）＋`anchorAtMs` int（worker-host `:238`；tte2e r2 已锚 `organizer-entry:63` 门），线型变化止于 HTTP DTO。

**受影响消费方**（后继改动清单，本轮全不动）：① `text-intake-service.mjs` submit 校验/解析（`at`→`Date.parse` 整数替换 `:263-265`）与 source 读回映射（`rowToSource` 或 HTTP 边界新 mapper；`http-server.mjs:580-583` 为透传无需改）；② 前端 `src/lib/web-api-client.ts` 适配器（`d79b1f6` 现用 `sourceAtMs:number|null` `:60/:409-410/:570/:717-720`——按派工对 OhMyPi 的边界「HTTP 只读冻结形状、适配器转内部、Tauri 内部形状保持」，内部 store `organizer.ts:53` 的 `sourceAtMs` 不动，只翻适配层）；③ II 套件**零改动**（已在冻结形上）；④ 浏览器 journey（A8 线）经产品表单走同一适配层。

## 5. A8：浏览器未接线 = 构建输入缺 I 前端，非接线缺口

实测 DOM 事实（static TAP not ok 9）：tab 存在、`tabDisabled=true`、`title='未接通：浏览器模式不提供文本智能整理'`。该 title 字符串**只存在于未接线基线 Workbench**（`1e37044`＝`23eb1a1` 同 blob `2aa1f2b9` `:171`：`:disabled="…||!nativeAvailable"`＋未接通 title）；I 候选树（`d79b1f6`，tree `8324c0b2`）的 Workbench（`c5af8bac:174`）**已删 `!nativeAvailable` 析取与 title**，`TextIntake.vue`（`1816420f:11`）提供 `form.text-intake`＋开始整理表单，`整理一段原文` 入口在位（`:153/:167`）——恰是 browser-probe（`browser-probe.mjs:312-328`）探测的面。**裁定：A8 红的根因是本轮 II 运行树组装的前端 `src/` 未含 I 候选四文件（构建出的 dist 仍是基线未接线 Workbench），不是接线分支有缺口**——与 static not ok 4 的 GAP-1 ENOENT（`build/bin` 缺省路径差一级，entry `:27/:31`，A7 已登记生产侧）同属该运行树的构建布局问题族。准出路径：dist 改从携带 `d79b1f6` 四文件的树构建（OhMyPi 前端增量分支线），tab enabled 即可证伪信号复测；勿回修基线旧缺口。

## 6. 对 `3e867a7` 登记的更正与细化

1. C3「两裁定相撞」框架**作废**：无成功暂存，§4.3 vs §4.6 不构成相撞；6 例单一根因＝夹具载荷非规范形。
2. 「GAP-3-default ~14s 即终止」**更正**：任务全程 `running/active`，~14s 为用例时长；缺省 120000ms 无误触发证据。
3. C5「无法从 TAP 单侧归因」**闭合**：M-11＝夹具陈旧后代集 poll 缺陷；cm boundary＝死服务级联＋`needs_review` 不在 poll 谓词。两例产品语义均未验，非产品红。
4. GAP-5 面补全：C2 家族内它是 verifyTree 覆盖边界的**真实暴露**（假 confirmed），非套件过严；与 T-6 分开裁定。
5. 新增生产侧登记：extract/revise 错误帧码丢弃（§3 末条），R8-M-3 矩阵影响归属 Kimi 后继。

## 7. 边界

只读取证＋CLI 附件下载；未重跑任何套件／探针／gate；未触生产／测试／Runtime／DDL 字节（`candidate bytes untouched`，工作树零修改）；C4 仅建议、实现与测试均未动；C1 维持原状（PUT CAS 先后未裁，待 Pi 按派工以合法 body 改测后自然消解）。真实模型／凭据／用户根零接触。TAP 原件五份重下载存 `build/mayne24-c2c5a8-forensics/`（gitignored）。MAYNE-24 保持 `in_progress`。
