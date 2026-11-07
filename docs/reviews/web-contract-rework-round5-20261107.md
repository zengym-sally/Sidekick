# W0 Web API 契约返工记录（MAYNE-19 第五轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md` 与 `tests/fixtures/web-contract/`。
- 基座候选：`agent/claude/mayne-19` 的 `307c7b959b280f1501702bb0521b349ceb1f761d`（第四轮返工后被独立复审 BLOCK 的版本）。本轮以该候选为基座修订，契约版本保持 `web-api/1`。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| A1 | P1 | 待核对结果没有可用的读取路径：needs_review 暴露 `result://` 引用，但结果端点拒绝所有非 `succeeded` 状态 | §4 端点表、§4.3、§10 增加**读取白名单**：`state=succeeded`，或 `state=needs_review` 且 `recovery.cause=result_exit_unconfirmed` 且 `attemptExitState=exited_confirmed` 时可读取，沿用同一内联/分段协议；其余状态仍 409 `state_conflict`。新增场景 32 与 `task-result-read-needs-review-200.json`（先读取、后处置） |
| B1 | P1 | 退出回收会把暂存的失败结局提交为成功 | §3.1/§3.2/§3.4 定义**暂存信封** `{outcome: "succeeded"\|"failed", result?, failure?}`：`resultPendingExit=true` 期间对外不可见；退出确认、恢复扫描回收与 `resolve(resume)` 均提交**原结局**（成功→`succeeded`、失败→`failed`），不因退出时序改变判别。§12 `tasks` 增 `pending_outcome`。新增场景 31 与 `task-failed-result-pending-exit.json`、`task-failed-result-reclaimed.json` |
| A2 | P2 | 场景 24 样例为 `running`/`active` 却携带仅允许在 `needs_review` 的 `recovery` | `task-result-pending-exit.json` 的 `recovery` 置 null（正常暂存阶段不带恢复对象）；退出无法确认的 `needs_review`/`exited_unknown` 另用独立样例 `task-result-exit-unconfirmed.json` 表达 |
| A3 | P2 | 同一身份的不可变输入/顺序冲突 | `task-recovery-backup-restore.json` 对齐 `task-needs-review.json` 的 `createdAt`/`inputRef`/`operationId`/`submitSeq`/`type`/`role`；`task-needs-review-exit-unconfirmed.json`、`task-needs-review-exit-reclaimed.json` 的 `submitSeq` 由 1041 统一为 1043（与快照、取消样例一致）。自检新增**全量同身份一致性核验**（覆盖 13 个 taskId 的 `operationId`/`type`/`role`/`createdAt`/`inputRef`/`submitSeq`） |

前四轮（2026-11-06、2026-11-07）的关闭情况以 `docs/reviews/web-contract-revision-20261107.md`、`docs/reviews/web-contract-rework-20261107.md`、`docs/reviews/web-contract-rework-round3-20261107.md`、`docs/reviews/web-contract-rework-round4-20261107.md` 为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、373 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=46 parseFailures=0 contractVersions=web-api/1` |
| 全量一致性与恢复语义（`build/web-contract-20261107-r5/verify.py`） | exit 0：46 样例、24 个完整任务资源、75 条链接；同身份不可变事实、`recovery` 状态约束、`decisionOptions`/`stagedResult`/`cancelIntent`/`itemVersion` 规则全部通过 |
| 暂存失败→回收保留失败 | 同上 | exit 0：前态与回收态同身份，终态为 `failed` 且保留原失败码 |
| 读取白名单样例 | 同上 | exit 0：`readGuard` 三要素齐全，返回 200 与 payload |
| 场景 1 链路与版本时序、配置重试配对、分段严格解码 | 同上 | exit 0 |
| 样例引用完整性 | 内联检查 | exit 0：46/46 样例被契约文档引用，无缺失引用 |
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

交付内容哈希清单（契约文档、六份本任务记录与 46 个样例）见忽略目录 `build/web-contract-20261107-r5/delivery-manifest.json`；平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；新增字段与端点是契约约定，实现切片接入时以其为测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、46 个样例可解析且版本一致、文档链接守卫通过、本轮驳回清单逐项有对应修订与样例。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
