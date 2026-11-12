# W1 候选／预览公开日期点 DTO 统一（Kimi，2026-11-09）

> 生产候选，待派未参与本增量的成员独审；作者不自签。派发：MAYNE-24 协调评论 `01a1bfdc-b8d0-70df-aa99-aa2fe503b8b8`（Codex，2026-11-09）——"当前安全证明交付后，正式接续既派候选／预览日期点后继，另交小提交：公开 HTTP 的 due/followup 统一既定 DatePoint，转换止于 HTTP 序列化边界，内部候选、task input 与 Runtime 继续使用私有 ms；覆盖列表／详情、来源详情中的候选与预览、编辑／apply 响应，不动 DDL／Runtime／II 断言。交精确 DTO 与提交后，OhMyPi 再配套候选／预览的 toDomainPoint 适配和控件验证；该前端面依赖服务端此增量，不用双读兼容掩盖旧线型。两侧分别独审，均不跑完整 gate，MAYNE-24 保持 `in_progress`"，接前序派工 `01a1bf8a-552e-74b3-8241-ff4ee10d101f`（"原已派候选／预览公共日期点转换继续由服务端负责，与客户端适配分别验证"）。
> 本增量只改公开序列化线型：不动 DDL／Runtime／task input／存储字节／II 断言，不跑完整 `npm run check`（III 唯一集成轮），未 push、未改状态。

## 1. 范围与风险级

- **范围**：`server/lib` 恰 2 文件，+32/−5。唯一行为变化：公开 HTTP 上候选（及来源详情中的预览草案）的 `fields.due`／`fields.followup` 由私有内部形 `{atMs,timeZone,localText,precision}` 改为既定 DatePoint 线 `{at,timeZone,localText,precision}`（ISO 8601 UTC 毫秒字符串 `at`）——与手工事项 `due`／`followup` 完全同线（冻结 web-api/1 §1＋手工事项契约 §4.2 `TimePoint`）。
- **风险级 R2**：改变公开响应线型（客户端读取面）。转换止于 HTTP 序列化边界：`rowToCandidate` 保持**内部**转换器（其 `atMs` 点是 revise task input、签收路径与存储 `fields_json` 使用的形），每个公开读经 `candidateWire`／`fieldsToWire` 映射。内部候选、task input 与 Runtime 继续使用私有 ms；无双读兼容、无第二套日期实现（复用手工事项的 `wirePoint`，仅将其导出）。
- **覆盖的公开面**：`GET /api/text-sources/{id}/candidates`（列表）、`GET /api/candidates/{id}`（详情）、`GET /api/text-sources/{id}`（来源详情的 candidates 与 previews）、`POST /api/candidates/{id}/edits`、`POST /api/candidates/{id}/discard`、`POST /api/candidates/{id}/previews/{runId}/apply`（后三者经 `getCandidate` 应答，自动同线）。
- **不变**：输入侧（编辑早已经 `normalizeInput`／`normalizePoint` 在既定线上校验；Runtime 草案保持内部形）；`fields_json` 存储字节；task input（revise 的 `candidate.fields` 仍私有 ms）；task result payload 暂存字节（内部形，II 恢复断言读取处）；DDL／Rust／003 冻结哈希／package／守卫／前端／II 套件／Runtime。

## 2. 精确 DTO

候选公开线（相对改前唯一变化是 `fields.due`／`fields.followup`）：

```json
{
  "candidateId": "cand_<32hex>",
  "sourceId": "src_<32hex>",
  "runId": "tsk_<32hex>",
  "ordinal": 1,
  "status": "pending",
  "version": 1,
  "fields": {
    "title": "…", "kind": "action", "owner": "…", "priority": "high",
    "due":    { "at": "2026-11-20T02:00:00.000Z", "timeZone": "Asia/Shanghai", "localText": "2026-11-20 10:00", "precision": "minute" },
    "followup": null,
    "tags": ["…"]
  },
  "evidence": "…",
  "dueExpression": "…" | null,
  "followupExpression": "…" | null,
  "warnings": ["…"],
  "unresolved": false,
  "acceptedItemId": null,
  "processedAt": null
}
```

`due`／`followup`：`null` 或恰四键 `{at,timeZone,localText,precision}`——`at` 为 ISO 8601 UTC 毫秒字符串（`YYYY-MM-DDTHH:mm:ss.sssZ`），`precision ∈ minute|day`。预览（来源详情 `previews[].draft.fields`）同一转换。签收事项（`items[]`）本就在该线上，本次不变、不二次转换。

## 3. 锁定输入与产物身份

- **生产基点**：`c32c251cdf60d453efc74c62ab4432a2558b8800`／tree `96d1e3510690c5d1f9d6e4399c68107d91f541bd`（分支 `agent/kimi/mayne-24`；安全证明记录提交）。
- **生产提交**：`72f1bb89a030fc246df4771829a00e99f2dc16d8`／tree `6c2294b945c75478316e75a8322d897dafe3e67a`，父 `c32c251`，恰 2 文件 +32/−5（`text-intake-service.mjs` +26/−4；`manual-items-service.mjs` +6/−1，仅导出既有 `wirePoint` 并加注释）。
- **存储二进制**：`src-tauri/target/release/web-backend-storage`＝`5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，rustc 1.99.1 `58cf8f9c3`）——按 `6c269ea`／`01a1bfb8` 登记的新构建身份；旧 `42af54b5…` 证据不迁签。本树 `cargo build --release --bin web-backend-storage` 复现同哈希。
- **随包 Runtime**：`build/s0-runtime`（`npm run probe:bundle`，vendor/pi `ad702637`／tree `e89822b0`，lark-cli v1.0.98），organizer blob `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`，node v24.20.0。
- 准入登记：`build/web-text-intake-date-point/admission.json`（gitignored）。

## 4. 聚焦验证（真实 HTTP，完整 I 链）

运行方式：探针 `build/web-text-intake-date-point/probe.mjs`（gitignored）经打包入口 `startWebBackend` 起真实后端（真实 cargo 二进制＋真实产品 dist＋真实随包 Pi Runtime），模型为受控 OpenAI 兼容服务（合成密钥只存在于内存受控 provider 与 worker 私有 stdin）；数据库观测全部只读。命令逐字：

```
node build/web-text-intake-date-point/probe.mjs
```

十个可证伪面（AFTER＝本树 `72f1bb8` 生产字节；BEFORE＝`git archive c32c251` 抽取的原始树，同一二进制／Runtime，仅 `server/lib` 字节不同）：

| 面 | 断言 | AFTER | BEFORE |
|---|---|---|---|
| A1 显式点 | 列表候选 `fields.due` 恰四键 DatePoint、`at` 等于 `shared/dates.mjs` 对原文表达式＋显式锚点的解析、`atMs` 全程不出现、`dueExpression` 原样保留 | PASS | **红**（实测键 `['atMs','localText','precision','timeZone']`） |
| A2 详情 | 单候选读与列表同线 | PASS | 未达（A1 红即止） |
| A3 来源详情 | candidates 与 previews 同线 | PASS | 未达 |
| B 缺省 | 省略锚点保留首录语义（`sourceAt.localText=null`，不冒称原话）；解析点仍走 DatePoint 线 | PASS | 未达 |
| C 编辑响应 | 响应在 DatePoint 线；只读观测存储 `fields_json` 仍为私有 `atMs`（`=1795572000000`） | PASS | 未达 |
| D 预览＋apply | 来源详情预览草案与 apply 响应同在 DatePoint 线；修订表达式 `11月25日` 保留 | PASS | 未达 |
| H task input | 只读观测 revise task input `candidate.fields.due.atMs` 为整数（私有 ms 不进公开线）；首任务 input 携 `source.sourceAt` 点 | PASS | 未达 |
| E 去重／同 operationId 重放／首锚保留 | 同 operationId `replayed:true`；同指纹 `reused:true` 且保留**首个**锚点；无第二候选集 | PASS | 未达 |
| F 时区冲突 | 显式锚点时区与顶层 timeZone 矛盾仍 400 `validation_failed` | PASS | 未达 |
| G 签收 | 签收事项与 accepted 候选同线，无二次转换 | PASS | 未达 |

- AFTER run1／run2 连续两次 **10/10 PASS，exit 0**（各约 5s，远低于 20s 用例预算）；BEFORE exit 1，红点恰在 A1 的 DatePoint 键断言（旧线型 `atMs`）——探针承重、非空真，修复即转绿。
- 运行后零临时根、零本树进程残留。

## 5. 回归（同环境，本树字节）

| 套件 | 命令 | 结果 |
|---|---|---|
| I 单测四套 | `node --test --test-timeout=20000 tests/unit/web-text-intake{,-lifecycle,-events,-mcp-pairing}.test.mjs` | **45/45 pass，exit 0** |
| I recovery | `node --test --test-timeout=20000 tests/unit/web-text-intake-recovery.test.mjs` | 8/10；F1、W 两红与基点**逐条相同**（BEFORE 同命令同两红：F1 8 313ms／W 7 490ms；AFTER：F1 8 262ms／W 7 354ms），为登记红 |
| 手工事项 | `npm run test:web-manual-items` | **59/59 pass，exit 0**（共享 `wirePoint` 导出无回归） |
| 结构守卫 | `npm run check:structure` | 170  violation 全为既有 `.kimi/`／`.multica/` 平台目录条目；`server/`／`src/`／`runtime/`／`shared/` 零违规；self-test 通过（26 类＋8 例，冻结迁移原字节通过、篡改 flagged） |
| II http 套件 | `node --test --test-reporter=tap --test-timeout=20000 tests/integration/web-text-intake-http.test.mjs` | 6/24；**与基点逐条相同**（`diff` 两树 TAP 的 ok/not ok 行：IDENTICAL）。红因是 II 夹具 `writeModelConfig` 的旧供应商形状（`authMode`/`credentialRefs`、缺 `name`）与现行 `config-store`（自 `2022d1c` 起要求 `name`＋`auth.apiKeyRef`＋`sidekick.revision`）的**既有漂移**，T-2 起全部 400 `供应商名称无效`——先于本增量存在，非本次引入；II 断言字节零改动，按派工不回改 |
| 文档守卫 | `npm run check:docs` | 见提交 `a3506af` 之后的记录提交 |

II 套件对候选点线型**没有任何断言**（全量 grep：无 `fields.due`／`due.at` 读取断言；唯一存储形断言 `:958-961` 读 DB `fields_json` 的 `atMs`，属内部形，本次不变），故上述既有红不影响本 DTO 的正确性承载；DTO 证据以第 4 节真实 HTTP 探针为准。

## 6. 边界与保留

- 客户端适配（候选／预览 `toDomainPoint` 与控件验证）按派工由 OhMyPi 后续交付，依赖本服务端增量；前端不得以双读兼容掩盖旧线型。
- 未跑完整 `npm run check`（III 唯一集成轮）；未触真实模型／凭据／用户根；GAP-5、退出保证 E、D 操作重放、整体准出均不随之关闭。
- 候选待派未写本 2 文件的成员独审；MAYNE-24 保持 `in_progress`。
