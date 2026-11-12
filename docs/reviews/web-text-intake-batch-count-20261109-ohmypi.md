# Web/后端文本整理 — 批量计数防线与适配层边界（OhMyPi，2026-11-09）

> 范围：仅 `src/lib/web-api-client.ts` 一个文件（生产改动）＋本文档（docs-only 自纠旧记录）。
> 对象：分支 `agent/ohmypi/mayne-24`，`125280d` 之后的小提交。
> 结论：**计数防线与注释更正均通过**；聚焦回归 4/4，收口前源码 3/4（可证伪）。不重跑 19 旅程或完整 gate。
> MAYNE-24 保持 `in_progress`。

## 一、派工来源

`01a1bfc0`（Codex，接 `bf81826` 独审的两条登记项）：

- **登记一（真实缺口）**：`list_import_batches` 用 raw wire 计数——在公共读会泄 staged 的后端上 `total`
  计入 staged（独审实字节 A9＋真实线数据 R3：total=2、可见=1），与本提交自述"must never be displayed"相悖。
- **登记二（minor 注释失实）**：`toCandidate` 文档注释所称 `toCandidateOrNull` 不存在（实为
  `toCandidateList`）；raw `getCandidate()` 仍是未映射直通，与注释"单读同样拒绝"不符。

## 二、修法

### 1. 计数改走过滤后的可见集合

```ts
const visible = this.toCandidateList(all.candidates ?? []);
pending: pending.candidates.filter(c => c.status === 'pending').length,
total:   visible.length,
```

`total` 现在由 `toCandidateList`（即列表读同一过滤器）导出，因此**计数就是可见集合**，不可能超过 UI 实际
能显示的候选数；`pending` 亦显式按 `status==='pending'` 计，不依赖服务端是否正确执行了 `?status=pending`。
已发布候选（含 `accepted` 及其 `acceptedItemId`）与 runId 路径不受影响。

### 2. 注释更正（`toCandidate` 文档块）

- 删去不存在的 `toCandidateOrNull`，改为 `toCandidateList`（真实名称，并说明它"应用本映射并丢弃 null"）。
- 新增 **BOUNDARY** 段，明确两层边界：本方法属**领域适配层**；`listCandidates`/`getCandidate`/
  `editCandidate` 等 raw 方法是**薄 HTTP 直通**，原样返回 `WireCandidate`、不做状态判断，也**不继承**上述
  staged 拒绝。要领域视图必须走 `asBackend()` 的 `case` shim（经 `toCandidate`/`toCandidateList` 映射，
  单读 staged 以 `state_conflict` 拒绝）。
- **未改 raw API 契约**：raw 方法签名、返回类型与路径均未动。

## 三、聚焦回归（真实适配器＋明确私有响应夹具）

驱动真实 `WebApiClient.asBackend()`；夹具为**明确标注的私有响应 fixture**（非生产形状），按客户端真实构造的
请求 URL 匹配，避免夹具与生产查询形状漂移。

```
POST-FIX: ℹ tests 4  ℹ pass 4  ℹ fail 0
PRE-FIX : ℹ pass 3    ℹ fail 1     （同一脚本指向 `git show HEAD:` 的收口前源码）
```

| # | 断言 | 结果 |
|---|---|---|
| 1 | 有 staged 时，`total`＝可见集合（2），非 raw 行数（3）；`pending`＝1；`total ≥ pending` | **PASS**；收口前实测 `total=3`，收口后 `total=2` |
| 2 | 同一夹具经 `read_import_batch` 只显示可见候选，`accepted` 保留 `acceptedTodoId` | **PASS**（收口前后均绿，证明未误伤已发布候选） |
| 3 | staged 行经 mutation 仍被 `state_conflict` 拒绝（适配层边界保持） | **PASS**（收口前后均绿） |
| 4 | raw `getCandidate()` 仍为未映射直通、保留 runId（边界与注释一致） | **PASS**（收口前后均绿） |

可证伪性：唯一失败项正是派工登记的计数缺口，且失败值是具体的 `3 !== 2`；其余三项在收口前后均绿，
说明本次只补计数、未改动已发布候选、runId 与拒绝语义。

## 四、来源与构建身份锁定

- 本分支 HEAD 之前的完整 I 全部为祖先：`b29afdc`（flat `GET /api/models`）、`4c98309`（WirePreview.runId
  ＋flat candidate row）、`6e27d1e`（§7 credential status）、`4846e61`（staged 不得 surfaced）、
  `125280d`（F1–F3 凭据收口）。
- 本轮所选前端字节：`src/lib/web-api-client.ts` = `c28227a5d66e`（收口前）→ 本轮改动；
  `src/components/ModelSettingsPanel.vue` = `0216921e5e13`（本轮未改）。
- 本轮生产改动仅一个文件、+20/−4。

## 五、旧记录 S2/S3 证明范围更正（docs-only）

已在 `docs/reviews/web-text-intake-staged-candidate-20261109-ohmypi.md` 追加 §8（不改写上文，按留档规则）：

- **S2/S3 不是生产适配器证据**：由 `verify-staged.mjs:61-63` 脚本内重写的映射求值，全程未 import 生产
  `web-api-client.ts`；改为引用 `bf81826` 的实字节 11/11 ×2 与真实链 7/7 ×2 承载。
- **S1 只属 pre-`ba92104` 的 `29305da` 窗口构建**：该构建 `listCandidates` 无默认 staged 排除；合格最新 I
  谱系 `0536a44` 上服务端已隐身、S1 前提不复现。不倒写成最新 I 行为。
- **附件缺口如实披露，不补造旧数据**：`admission.json` 未实际挂载（评论仅 4 件）；"三连跑"仅附一轮原始
  输出；后端构建身份当时未登记，现按独审补登（`29305da` entry `5a799cdb`／service `85212b72`／存储二进制
  `5311ffa3…`＝2647984 B／rustc 1.99.1 `58cf8f9c3`；边界 `0536a44` service `0dc3424f`）。旧 `42af54b5…`
  记录按原产物保留，不追改。

## 六、边界（未签）

- 未跑完整 `npm run check`。`npm run typecheck` exit 0；`npm run check:docs` 通过（21 文件）。
- `npm run check:structure` 的失败为**预先存在**（`.omp/` 顶层目录与缺失 `vendor/pi` dist／未取回夹具），
  无一落在本轮文件（已 grep 确认为 0）。
- 未跑 Rust／真实 Pi／backend 构建／web-text-intake 集成套件（夹具与 `build/web-backend` 不在本工作树）。
- `tests/unit/s2-client.test.mjs` 34 pass / 1 fail，该失败（Tauri 迟到取消响应路径）与本次单文件改动无关。
- 未跑 19 旅程；最终独立浏览器验收仍未签。C4 候选日期与显式 `sourceAt` 沿既派后继继续。

## 七、证据

- 附件：`verify-batch-count.mjs`（聚焦回归，4 项）、`verify-prefix.txt`（收口前源码运行输出）、
  `checks.txt`（typecheck／check:docs／check:structure／相关单测原始输出）。
- 脱敏声明：夹具全部为合成值，无秘密值入证据。
