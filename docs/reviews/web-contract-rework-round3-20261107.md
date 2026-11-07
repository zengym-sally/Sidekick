# W0 Web API 契约返工记录（MAYNE-19 第三轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md` 与 `tests/fixtures/web-contract/`。
- 基座候选：`agent/claude/mayne-19` 的 `b08bf02492f2d60f59329e9cfbf0fed3dd91fa6f`（第二轮返工后被两份独立只读评审 BLOCK 的版本）。本轮以该候选为基座修订，契约版本保持 `web-api/1`，改动均为兼容追加与语义澄清。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| A1 | P1 | 大结果读取仍没有确定的后续请求（只有不可直接请求的 `result://`，Range/分页未定义） | §4.3 改为**确定协议**：内联阈值 `maxInlineBytes`；超限返回索引响应（含 `totalBytes`/`maxSegmentBytes`/`nextOffset`/`done`）；分段请求 `?offset=&limit=`（字节偏移，`limit` 默认且最大 `maxSegmentBytes`）；分段响应 `{offset, limit, bytesReturned, totalBytes, nextOffset, done, payloadBase64}`；完成条件 `done=true` 或累计满 `totalBytes`；错误 `result_range_invalid`/`result_range_unsatisfiable`。新增场景 25 与 `task-result-read-segmented-200.json` 完整交互样例 |
| B1 | P1 | 正常结果上报被等同进程退出确认，提前释放槽 | 新增任务资源字段 `resultPendingExit`；§3.2 把“提交结果”拆为三步：结果暂存（仍 `running`、`result` 不可见、**槽位不释放**）→ 所属进程树退出确认 → 终态并释放槽；退出无法确认 → `needs_review` + `exited_unknown`（占槽）。新增场景 24 与 `task-result-pending-exit.json` |
| B2 | P1 | 任务 resolve 与 hold 条目 resolve 的版本守卫不等价 | §3.5 统一：**每个 `needs_review` 任务对应一行 `recovery_items`**（非 hold 来源 `hold_id` 为 NULL），其 `version` 经任务资源 `recovery.itemVersion` 与报告条目 `version` 暴露；两个入口同接受 `{expectedVersion, decision, acknowledgedReceipts}` 并校验**条目版本`，不匹配 → 409 `version_conflict`；已处置条目 → 409 `state_conflict`。`recovery_items` 增 `version`。新增场景 27 与 `error-resolve-version-conflict-409.json`，并在全部 `needs_review` 样例补 `itemVersion` |
| A2 | P2 | 同一任务不可变事实与关联投影不一致 | `task-succeeded-result.json` 对齐 `task-resource-running.json` 的 `createdAt`/`inputRef`（`byteSize`/`contentHash`）；`task-recovery-backup-restore.json`、`task-recovery-root-activation.json` 的 `type` 改为 `reminder_send`，与所引用 hold 条目一致；自检新增同任务不可变事实与关联类型/版本一致性核验 |
| A3 | P2 | 自动重试预算耗尽后的状态、retryable 与人工操作未定义 | §3.2/§4.6 恢复预算语义：`auto_backoff` 且 `proven_safe` 但 `attempt_budget` 用尽 → 保持 `failed`，`retryable` 降为 `manual`、`nextAttemptAt=null`；§4.5 定义用户 `retry` **重置剩余预算**为新的人工尝试周期。新增场景 26 与 `task-failed-budget-exhausted.json` |
| B3 | P2 | `exited_unknown` 回收后没有合法的 recovery 形状 | §3.4/§3.5 定义回收时的迁移：台账证明无外部副作用 → `cancelled`（终态）；否则 `cause` 由 `cancel_exit_unconfirmed` 迁移为 `cancel_unknown_side_effect` 并补 `decisionOptions`，`cancelIntent` 保持 true，条目版本递增。新增场景 28 与 `task-needs-review-exit-reclaimed.json` |

前两轮（2026-11-06、2026-11-07）的关闭情况以 `docs/reviews/web-contract-revision-20261107.md` 与 `docs/reviews/web-contract-rework-20261107.md` 为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、365 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=39 parseFailures=0 contractVersions=web-api/1` |
| 任务资源字段完整性與其否语义 | `python3 build/web-contract-20261107-r3/verify.py` | exit 0：39 样例、18 个完整任务资源、68 条链接；`resultPendingExit`、`exited_unknown`、`itemVersion` 规则全部通过 |
| 场景 1 链路一致性 | 同上 | exit 0：同一 `taskId`，`createdAt`/`inputRef`/`operationId` 不变 |
| 恢复关联一致性 | 同上 | exit 0：恢复任务 `type`/`holdId`/`itemVersion` 与所引用 hold 条目一致 |
| 快照/事件、hold 汇总、分段读取 | 同上 | exit 0 |
| 样例引用完整性 | 内联检查 | exit 0：39/39 样例被契约文档引用，无缺失引用 |
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

交付内容哈希清单（契约文档、四份本任务记录与 39 个样例）见忽略目录 `build/web-contract-20261107-r3/delivery-manifest.json`；平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；新增字段与端点是契约约定，实现切片接入时以其为测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、39 个样例可解析且版本一致、文档链接守卫通过、本轮驳回清单逐项有对应修订与样例。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
