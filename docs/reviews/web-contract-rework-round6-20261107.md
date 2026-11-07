# W0 Web API 契约返工记录（MAYNE-19 第六轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md` 与 `tests/fixtures/web-contract/`。
- 基座候选：`agent/claude/mayne-19` 的 `bd374a1d556f2dcca37a73e200af0a48f78d60b7`（第五轮返工后的候选；第六轮复审结论为 needs_revision，仅 1 项 P2）。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| A1 | P2 | 暂存**失败**且副作用未知时，待核对失败的读取入口与数据形状未定义：`failure` 只被描述为终态信封，结果端点只定义成功 payload 形状 | §3.1 `failure` 增加**受守卫的非终态可见**例外（`cause=result_exit_unconfirmed` + `attemptExitState=exited_confirmed`）；§4.3 引入结局判别 `outcome: "succeeded"\|"failed"`：成功结局沿用内联/分段协议并给出 `failure: null`；失败结局返回 `{contractVersion, taskId, outcome: "failed", kind: null, payload: null, failure: {...}, acceptedByAttempt, completedAt}`，**不分段**（携带 `offset`/`limit` 即 400 `result_range_invalid`）；读取白名单同步覆盖两种结局。新增场景 33 与 `task-failed-result-reclaimed-needs-review.json`、`task-failed-result-read-needs-review-200.json`（同任务「读回待核对失败 → 人工处置」）；两个成功读取样例补 `outcome`/`failure` 字段 |

前六轮（2026-11-06、2026-11-07）的关闭情况以 `docs/reviews/web-contract-revision-20261107.md` 与 `docs/reviews/web-contract-rework-*-20261107.md` 系列记录为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、375 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=48 parseFailures=0 contractVersions=web-api/1` |
| 全量一致性与恢复语义（`build/web-contract-20261107-r6/verify.py`） | exit 0：48 样例、25 个完整任务资源、78 条链接；同身份不可变事实（14 个 taskId）、`recovery` 状态约束、`decisionOptions`/`stagedResult`/`cancelIntent`/`itemVersion`、暂存成功与失败两条链路全部通过 |
| 结局判别读取 | 同上 | exit 0：成功/失败两类待核对读取样例的 `outcome`、`readGuard`、payload/failure 组合正确 |
| 场景 1 链路、配置重试配对、分段严格解码、hold 汇总、快照/事件 | 同上 | exit 0 |
| 样例引用完整性 | 内联检查 | exit 0：48/48 样例被契约文档引用，无缺失引用 |
| `git diff --check` | `git diff --check` | exit 0 |

样例解析命令原文：

```sh
node --input-type=module -e "
import { readdirSync, readFileSync } from 'node:fs';
const dir = 'tests/fixtures/web-contract';
let n = 0, bad = 0; const versions = new Set();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  n++;
  try { const j = JSON.parse(readFileSync(dir + '/' + f, 'utf8')); versions.add(j.contractVersion ?? '(missing)'); }
  catch (e) { bad++; console.log('PARSE FAIL', f, e.message); }
}
console.log('files=' + n + ' parseFailures=' + bad + ' contractVersions=' + [...versions].join(','));
process.exit(bad || versions.size !== 1 ? 1 : 0);
"
```

交付内容哈希清单（契约文档、七份本任务记录与 48 个样例）见忽略目录 `build/web-contract-20261107-r6/delivery-manifest.json`；平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；新增字段与端点是契约约定，实现切片接入时以其为测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、48 个样例可解析且版本一致、文档链接守卫通过、本轮唯一 P2 已补齐读取入口与数据形状。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
