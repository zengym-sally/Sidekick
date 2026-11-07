# W0 Web API 契约返工记录（MAYNE-19 第四轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md` 与 `tests/fixtures/web-contract/`。
- 基座候选：`agent/claude/mayne-19` 的 `d29bccc6eec83ef4ded677944e020e87cba4f5b2`（第三轮返工后被独立复审 BLOCK 的版本）。本轮以该候选为基座修订，契约版本保持 `web-api/1`，改动均为兼容追加与语义澄清。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| B1 | P1 | 正常完成任务被套用取消专属的退出回收：`exited_unknown` 一律按“无副作用→cancelled / 否则 cancel_unknown_side_effect”处理，会错误取消正常任务或凭空产生取消意图 | §3.2/§3.4/§3.5 按**真实取消意图 + 暂存结果 + 副作用证据**分支回收：**取消路径**（`cancelIntent=true`）保持原迁移；**非取消 + 结果已暂存**（`cause=result_exit_unconfirmed`）→ 无未知副作用则**提交原暂存结果**转 `succeeded`，否则保持 `needs_review`、`result` 转为可见、`cancelIntent=false` 并补 `decisionOptions`；**非取消 + 无暂存结果**（`cause=exit_unconfirmed`）→ 可安全重跑则重入队，否则保持 `needs_review`。§3.5 新增两个非取消 cause，并规定 `decisionOptions` 仅在 `attemptExitState=exited_confirmed` 时出现。新增场景 29/30 与 3 个样例 |
| A1 | P2 | 并发调整的 `expectedVersion` 被写成“任务版本”，与 settings 自身版本冲突 | §3.3 明确三类版本不可混用：**任务版本**（`retry`）、**条目版本**（`resolve`）、**设置版本**（并发调整）；§5 GET/PUT 与 §12 `settings` 同步为校验/返回设置自身 `version` |
| A2 | P2 | 分段结果末段 base64 缺填充，严格解码失败 | 末段改为 88 字节的带填充 base64；自检逐段严格解码核对 256/256/88、总长 600 |
| A3 | P2 | 配置重试样例复用 `credential_unavailable` 失败任务的 ID，却改动创建时间/输入/哈希，且缺允许换配置的前态 | 新增 `task-failed-config-invalid.json`（`auth_or_config_invalid`、`retryable=manual`、`proven_safe`）作为前态；`task-retry-new-config-202.json` 与其同 `taskId`/`operationId`/`createdAt`/`inputRef`/`submitSeq`，仅 `configRevision` 变化、`originalConfigRevision` 保留、版本递增 |
| A4 | P2 | 暂存结果与成功终态同 taskId/attempt、同为 v3，时间互斥 | 时序改为 `running/v2`（12:30:41）→ `resultPendingExit=true/v3`（12:32:31）→ `succeeded/v4`（12:33:05）；结果读取样例的 `completedAt` 与终态时间对齐 |

前三轮（2026-11-06、2026-11-07）的关闭情况以 `docs/reviews/web-contract-revision-20261107.md`、`docs/reviews/web-contract-rework-20261107.md`、`docs/reviews/web-contract-rework-round3-20261107.md` 为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、369 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=42 parseFailures=0 contractVersions=web-api/1` |
| 任务资源字段/槽位与退出语义/恢复分支（`build/web-contract-20261107-r4/verify.py`） | exit 0：42 样例、21 个完整任务资源、71 条链接；`decisionOptions` 与 `exited_confirmed`、`stagedResult`、`cancelIntent`、`itemVersion` 规则全部通过 |
| 场景 1 链路与版本时序 | 同上 | exit 0：同一 `taskId`，v2→v3→v4 递增，时间不冲突 |
| 配置重试配对 | 同上 | exit 0：前态与重试同不可变事实，仅 `configRevision`/版本变化 |
| 分段读取严格解码 | 同上 | exit 0：256/256/88 字节，总长 600 |
| 恢复关联、hold 汇总、快照/事件 | 同上 | exit 0 |
| 样例引用完整性 | 内联检查 | exit 0：42/42 样例被契约文档引用，无缺失引用 |
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

交付内容哈希清单（契约文档、五份本任务记录与 42 个样例）见忽略目录 `build/web-contract-20261107-r4/delivery-manifest.json`；平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；新增字段与端点是契约约定，实现切片接入时以其为测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、42 个样例可解析且版本一致、文档链接守卫通过、本轮驳回清单逐项有对应修订与样例。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
