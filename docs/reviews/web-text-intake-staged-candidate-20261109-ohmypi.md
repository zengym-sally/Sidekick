# staged 候选不得 surfaced（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1bf4b`（「补独立最小修复：`toCandidate` **不得把 staged 改 pending**；公共响应若含 staged，应过滤或按违例拒绝，不能显示或成为可操作候选。补一个持槽暂存窗的针对性回归，保持已发布候选／预览 runId 路径；不改服务端来兼容此映射。代码注释中"冻结 fields 是内部 atMs 形"也应校正……19/19 不代签这些缺项」）。

## 1. 范围

仅 `src/lib/web-api-client.ts` 一个文件。未改服务端、未改其余前端、未改测试／package／DDL／Runtime／守卫。

## 2. 缺陷

`toCandidate` 把线型独有的 `staged` 状态**改写**成 `pending`：

```ts
status: candidate.status === 'staged' ? 'pending' : candidate.status,
```

`staged` 的语义是「结果帧已持久化，但退出尚未确认」——即候选**未发布**。改写后：

- `GET /api/text-sources/{id}/candidates`（不带 status 过滤）会返回 staged 行 → 客户端把它显示为可操作候选；
- `GET /api/candidates/{id}` 直接读同样可返回 staged 行；
- 更糟的是，对 staged 行执行 edit/discard/apply 会打到未发布候选上。

内部 `Candidate.status` 没有 `staged` 态，这是当初改写的理由；但正确做法是**过滤或拒绝**，不是改标签。

## 3. 修复

- `toCandidate` 返回 `Candidate | null`：遇 `staged` 返回 `null`；
- 新增 `toCandidateList`：列表视图过滤掉 staged 行（批量读路径）；
- 新增 `requirePublished`：mutation（`save_candidate`／`discard_candidate`／`apply_candidate_preview`）的响应若为 staged，抛 `WebApiError('state_conflict', 409, …)` 而不是显示或持久化；
- 批量读（`read_import_batch`）改用 `toCandidateList`。

**服务端未加任何兼容**（派工明确要求）。服务端 `getSource` 本就用 `status: 'pending'` 过滤，故 inbox 主路径不受影响；暴露面在直接候选读与 mutation 响应，客户端此面是防线，不替代服务端义务。

## 4. 注释校正

原注释称「The wire `fields` already is the internal domain shape」——把当前服务现状说成了已批准的线上契约。已改为：

> The wire `fields` carries the CURRENT server domain shape (`{atMs,timeZone,localText,precision}`) and is carried through unchanged. That is a statement about the current implementation, NOT an approved on-the-wire date contract: the frozen C4 date-point adaptation is a separate, still-open task.

## 5. 回归（5/5，三连跑稳定，约 9s/次）

构造方式：经真实后端建来源并等任务终局 → 停 backend → 按生产暂存路径同列集直接写入一行 `staged` 候选 → 重启 backend → 读公共 HTTP 面。这样暂存窗**确定存在**（行保持 staged 直至退出确认），无时序竞争。

| # | 断言 | 结果 |
|---|---|---|
| S1 | 退出未确认时，公共候选读确实返回 `staged` 行 | **PASS**（`observedStatusHistory: ["pending","staged"]`） |
| S2 | 适配器把 staged 行**过滤**出列表，绝不改贴 `pending` | **PASS**（`rawStatuses:["staged"] → visibleCount:0`） |
| S3 | staged 行被**拒绝**为契约违例，而非显示或持久化 | **PASS**（`fixedRejects:true`；同一行上旧映射 `legacyWouldSurfaceAsPending:true`，可证伪） |
| S4 | 退出确认后，已发布候选重新可见可操作 | **PASS**（`status:"pending"`） |
| S5 | 预览 runId 路径仍正常（apply 用冻结 runId，非 previewId） | **PASS**（`previewRunIdPrefix:"tsk_"`，apply 200） |

S3 的可证伪性：同一实测行上，旧行为会把它 surface 成 `pending`，新行为拒绝——差异在同一数据上可观察。

## 6. 边界

- 只改一个文件；未改服务端来兼容此映射；未跑完整 `npm run check`（`npm run typecheck` exit 0）。
- 本轮 19/19 **不代签**以下缺项：候选日期（C4 源点）、显式 `sourceAt`、最终独立浏览器验收——按派工原样登记为未闭。
- 服务端 staged 隐身等三项修复仍须 Kimi 独立完成；客户端防线不替代服务端义务。

## 7. 证据

- 附件：`verify-staged.mjs`（自包含回归，仅 Node 内置模块＋II 受控模型夹具）、`verify-staged-run.txt`（5/5 实跑）、`web-api-client-adapted.ts`（适配后全文）、`admission.json`、`SHA256SUMS.txt`。
- 脱敏声明：绝对路径替换为 `<WORKTREE>` 并声明；无秘密值入证据。

---

## 8. 证明范围更正（2026-11-09，docs-only，OhMyPi 自纠）

协调层按 `bf81826`（OpenCode staged 候选窄增量独审）裁定后，本节收紧上文 §5 的证明范围。
上文为当时的原始记录，按留档规则不改写；以本节为准。

**§5 中 S2 / S3 不是生产适配器证据。** 二者由 `verify-staged.mjs:61-63` **脚本内重写的映射**求值
（脚本自注 "Re-derive the client's mapping exactly as implemented"，全程未 import 生产
`web-api-client.ts`）。因此 S2 只能读作"重写后的映射会过滤 staged"、S3 只能读作"重写后的映射会拒绝
staged"，**不能**如上文 §5 表格那样表述为"适配器把 staged 行过滤"／"staged 行被拒绝为契约违例"——
那超出了实测面。生产适配器的对应行为现由独审的实字节证据承载：

- 实字节 × 明确标注的私有响应夹具 **11/11 ×2 轮**（含父字节 `6e27d1e` 在同一夹具下把 staged 响应
  surface 成可操作 `pending` 的实字节可证伪）；
- 实字节 × 实后端 **7/7 ×2 轮**，其中 R7 用真实链、无人工改状态补齐适配器面。

**§5 中 S1 只属 pre-`ba92104` 的 `29305da` 窗口构建。** 该构建的 `listCandidates` 无默认 staged 排除，
故公共读会返回 staged 行；在合格最新 I 谱系 `0536a44` 上服务端已隐身，S1 前提**不复现**
（运行期采样＋终局列表零 staged、显式 `status=staged` 拒 400）。S1 因此**不得倒写成最新 I 的行为**，
只能读作"该窗口构建上公共读确实返回 staged"。

**保持采信**：S4（`getSource` 服务端本就 `status:'pending'` 过滤）、S5（raw revise→apply 200、冻结
runId）为真实 HTTP 观察；S1 的真实后端＋种行构造部分亦成立（仅其前提的版本范围如上收窄）。

**附件缺口如实披露，不补造旧数据**：

- `admission.json` 列于 §7 与 SHA256SUMS，但评论实际只挂载 4 件（CLI 读回），该件**缺失**；
- "三连跑"仅附一轮原始输出（`verify-staged-run.txt`），另两轮原件**缺失**；
- §7 所列后端构建身份当时**未登记**（脚本从 cwd 引 `build/web-backend`，不锁哈希）。经独审补登：
  窗口构建＝`29305da`（entry `5a799cdb`、`text-intake-service` `85212b72`、存储二进制
  `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`＝2647984 B，rustc 1.99.1
  `58cf8f9c3`）；边界构建＝`0536a44`（service `0dc3424f`）。旧 `42af54b5…` 记录按原产物保留，不追改。

本节为 docs-only 更正，不改生产、测试、夹具或 `package`；未重跑任何套件。日期点（C4）与预览发布
后继沿既派继续，最终独立浏览器验收仍未签。
