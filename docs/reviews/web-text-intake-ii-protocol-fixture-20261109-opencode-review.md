# MAYNE-24 II 协议夹具修订独立评审（OpenCode，2026-11-09）

- 派工：协调评论 `01a1bf24-7364-74d7-adb5-8d83e03117d9`（「你未写协议夹具，并行独审 `5b06f0d`／tree `c7809503`，相对 II r5 该文件恰 +17/−5。核 canonical 形、真实 stage 接受、围栏／挂起／300s 后代及未来 revise 边界未弱化；CLI 读回 before/after，必要仅聚焦 control／GAP-5，不重复七例全跑或完整 gate。只写独立评审，不改生产／测试」）。
- 评审者：OpenCode，未写协议夹具及其修订（夹具作者与修订作者均为 ZCode），作者／评审者分离成立。
- 性质：test-only 夹具单文件修订的限定独审；不改生产／测试／索引外任何字节；不跑完整门禁。

## 1. 对象身份（对象库逐字节复核）

| 对象 | 值 | 复核命令 | 结果 |
|---|---|---|---|
| 提交 | `5b06f0d16e73058f27158635dc445b59ad9bb120` | `git cat-file commit` | 存在，tree 恰为 `c78095034c7758b8602cc7ba019efc8271481924`（与派工一致），父 `bd571ca613ca901b14bf809c80947dc065374fc7`（ZCode B1/B2/C1 评审记录提交） |
| before blob（II r5 冻结） | `c9f28a8a20ce4f3e66c4cdfa5f5e1adc62fe09fb`，9978 B，SHA-256 `3ddf71bd…a2823` | `git cat-file -s`／`shasum -a 256` | 与派工、与锁定链 `52b71a2f` 夹具目录条目、与作者登记逐字节一致 |
| after blob | `986f4cfea70aded358fa94d3949e34a78505e426`，10545 B，SHA-256 `1af86498…bfac5` | 同上 | 与作者登记逐字节一致 |
| blob 间差异 | `git diff --numstat c9f28a8a… 986f4cfe…` | | 恰 **+17/−5**，与派工数字一致 |
| 全树差异（对父） | `git diff --numstat bd571ca 5b06f0d` | | 恰一文件 `tests/fixtures/web-text-intake/protocol-worker-process.mjs`（本分支 overlay 语义：父树无此文件，夹具以 blob 对 r5 冻结字节作差为准） |

## 2. 差异面（confined 核验）

`+17/−5` 由且仅由两个 hunk 构成：

1. `payloadFor` 上方注释块 +6 行：登记 canonical 形的依据（真实 organizer `parseModelResult` 形、stage 读取键）。
2. extract 分支返回对象：5 行平铺字段（`title/kind/owner/priority/tags`）改为包进 `fields`（+11 行：六字段＋`due:null`＋`followup:null`，另有顶层 `warnings:[]`＋`unresolved:false`）。

**未触碰（逐字节未动，由 confined diff＋全文件通读双重确认）**：

- 身份围栏：`staleIdentity()`（registry 查找＋nonce 突变回退）、`late-identity-frame` 场景（先发陈旧身份帧、隔 400ms、再发正确帧）。
- 挂起／逃逸场景：`stage-then-hang`（keepAlive 间隔＋cancel 帧身份校验＋`finish()` 清理）、`lingering-tree`、`early-failure`（先登记后代再非零退出）。
- 300s 后代寿命：`deriveGrandchild` 内 `setTimeout(() => {}, 300000)`、spawn 后立即 `noteRegistry` 登记 `lingerPid`、spawn 失败登记 `spawnFailed`，三场景同一寿命——全部逐字节未动。
- `test`（`{ok:true}`）与 `revise`（`{changes:{title:'协议夹具修订标题'}}`）分支：未动，revise 仍为已登记 future 项（协议家族不用）。
- worker-start 预登记、SIGTERM 处理、apiKey 不回显等其余全部逻辑。

## 3. canonical 形核验（本审独立可执行交叉核对）

生产消费链（全部读锁定链 `52b71a2f` 原字节）：

- 真实 worker 发帧：`runtime/entries/organizer-entry.mjs:139` `emit({type:'result', data:canonicalOutput})`，`canonicalOutput = parseModelResult(...)`（:137）。
- `runtime/lib/organizer-contract.mjs`（blob `4fe0d118`）：extract 的 `extraction()` 返回 draft 恰为 `{fields:{title,kind,owner,priority,tags,due,followup}, evidence, dueExpression, followupExpression, warnings, unresolved}`。
- 调度消费：`server/lib/task-scheduler.mjs:219` `stageExtractResult(taskId, attemptId, frame.data?.candidates ?? [])`（worker-host 对帧 JSON 解析后原样转发）。
- 暂存消费：`server/lib/text-intake-service.mjs:759` `normalizeDraftFields(candidate.fields)`；:764-775 落库键恰为 `candidate.evidence`／`dueExpression ?? null`／`followupExpression ?? null`／`warnings ?? []`／`unresolved?1:0`。`normalizeDraftPoint(null)` 返回 null（:47），`normalizeTags(['协议夹具'])` 合法（manual-items-service :114-124）。

可执行核对（材料化锁定链 blob `4fe0d118` 的真实 `parseModelResult`＋夹具引用的 `synthetic-inputs.mjs` blob `d5e10991`，`node canonical-crosscheck.mjs`，**exit 0**，脚本与输出存 `build/mayne24-c3-fixture-review/scratch/`）：

- **A1（值恒等）**：无日期表达文本下，真实 `parseModelResult` 输出的候选与修订后夹具帧 **deepStrictEqual 逐值恒等**——夹具帧就是真实解析后的 canonical 帧。
- **A2（形恒等）**：含 `下周五` 文本下，真实解析输出与夹具帧**键结构完全相同**（候选键与 `fields` 键两两相等）；真实解析会把表达解析进 `fields.due`（atMs/localText/precision=day、`unresolved=false`、warnings=[]），夹具保持 `due:null`——见 §5 观察 1。
- **B（缺陷机理负控）**：修订前平铺帧恰是**解析前** raw model-output 合同形（`parseModelResult` 接受它并包装进 `fields`），直接发给按 post-parse 消费的 stage 时 `candidate.fields === undefined` → `normalizeDraftFields(undefined)` 在暂存事务前抛 `input 必须是对象。` → `resultPendingExit` 恒 0 → §4.6 安全路由（`needs_review/failure_unknown_side_effect`）。与登记 C3 根因逐字吻合。

## 4. 真实 stage 接受（作者 before/after TAP 的 CLI 读回）

按派工未重放七例、未跑完整 gate；以 CLI 读回作者随评论 `01a1bf1d` 交付的两份 TAP 为证据（本机 `build/mayne24-c3-fixture-review/readback/`）：

- `before-run.tap`：SHA-256 `3cdb9c53caea762c…ddf94`（前 16 与作者登记一致），**7 tests / 0 pass / 7 fail**——control 落 `needs_review/exited_confirmed`＋`failure_unknown_side_effect` 暂存级联、GAP-5 `exited_confirmed` vs 期望 `exited_unknown`，红面与登记一致。
- `after-run.tap`：SHA-256 `e26bcc6b7fc9df28…c19b`（前 16 与作者登记一致），**1 pass / 6 fail**——control 端到端绿（4.5s，套件内断言零模型调用），GAP-3×2 红在「staged 候选 1 !== 0 可见」（frozen §4.2/§10 面），GAP-4 红在审计面（事件类型仅 `task.changed`、无 `rejected_late_result`），GAP-5 红在**更锐的生产面**（`succeeded/exited_confirmed` 而树成员仍存活——发布时树成员存活，与本人 `8d87609` owner 草案登记的 R7-M-2/M-3 verifyTree 覆盖缺口互证），exhaustion 红在 `recovery=null`，cleanup 红在 lingering-tree→succeeded。红面全部换到下一层真实面，unknown 判据与生产退出保证缺口**未被掩盖**。

**套件字节身份澄清（登记，非缺陷）**：两份 TAP 的行号（control :975、GAP-3 :1007/:1055、GAP-4 :1105、GAP-5 :1157、exhaustion :1214、cleanup :1294、pollTask :757、断言 :1032/:1087/:1141/:1171/:1253）与 blob `fccd8675`（7f3322b 时代 queue 套件，1399 行）逐一吻合，而非锁定树 `52b71a2f` 内的 `4a74ea0f`（1407 行，control :983）。两 blob 的恰一差异＝`writeModelConfig` 写入形（共享 `model-config.mjs` 夹具导入 vs 内联写入，+13/−6），**协议家族七例及其断言逐字节相同**。即 TAP 实跑套件＝既定 overlay 配方（`5b06f0d` 提交信息登记的「r5 夹具集＋7f3322b config-revision 套件字节＋45b1cfe B1/B2/C1」）下的 II 套件字节，与登记语义一致；`4fc9537`（tree `52b71a2f`）登记指生产字节面。

## 5. 观察与登记（非阻断）

1. **夹具 due 语义与真实解析的分歧**：含 `下周五` 的文本下，真实 post-parse 帧会携带已解析的 `fields.due`（A2 实测 precision=day）与可能非空的 warnings，夹具恒发 `due:null/warnings:[]`。暂存两侧皆接受（`normalizeDraftPoint(null)→null`），协议家族断言面（暂存／可见性／围栏／退出）不触及日期解析；日期解析覆盖在 controlled-model-service 链（真实 Runtime 解析）承担，无覆盖缺口。登记为夹具语义观察，不要求改动。
2. **TAP 套件字节身份**：见 §4 澄清——评审按 `fccd8675` 核对行号，协议面在两版本字节下恒等。

## 6. 明确不代签

- **不重签**三个新暴露生产面（staged 候选可见、`rejected_late_result` 审计缺失、同步 spawn 失败无 recovery）的任何产品判定——已裁定归 Kimi 后继小提交，本审只确认它们在 after 链上真实可达、且为本审无法也无需复核的生产缺口。
- **不签** GAP-5／cleanup 的产品退出保证——缺口保持开放（R7-M-2/M-3），本审仅确认修复夹具未掩盖、且以更锐面复现。
- control／GAP-5 的绿／红面本审签的是「作者 TAP 读回＋生产源码机理核对」级别的佐证；**端到端重放仍是作者证据**（本 build 区已被回收、按派工不重放）。
- 未跑七例全跑、未跑完整门禁、未触真实模型／凭据／用户根；生产／测试／Runtime／DDL／package 零字节改动。

## 7. 结论

**通过（限定 `5b06f0d` 恰一文件 +17/−5 的夹具修订面）**：canonical extract 帧成立（真实 `parseModelResult` 输出与夹具帧值恒等／形恒等，生产消费键逐一核验）；真实 stage 接受获 before/after TAP 读回佐证（哈希逐字节吻合、翻转方向与源码机理一致）；身份围栏、挂起／逃逸场景、300s 后代寿命、未来 revise 边界全部逐字节未弱化。红面保留且更锐，登记观察两条，不代签面如 §6。

原始证据：`build/mayne24-c3-fixture-review/`（gitignored：admission.json、readback/ 两份 TAP、scratch/ 交叉核对脚本与输出、SHA256SUMS）。
