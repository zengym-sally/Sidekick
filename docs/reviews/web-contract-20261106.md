# W0 Web API 契约与样例交付记录（MAYNE-19）

## 范围与写入面

- 实现：OpenCode（2026-11-06）。此前两轮 run 均因 provider 网络错误失败、无可接收交付；本轮从任务原范围重新执行。
- 交付物：
  - [web-api-contract.md](../engineering/web-api-contract.md)——W0 契约**提案**（未冻结）：提交/查询/取消/重试、幂等键与版本、默认 3 并发配置、SSE 高水位快照补偿、worker attempt/epoch fencing、退出/清理顺序、恢复旧备份与已有根激活的恢复保持、受限工作根管理（`workspace.manage`）、provider 能力与控制通道分离、错误码注册表、17 个"提交到用户看到结果/错误"场景矩阵、任务台账/事件/恢复数据结构提案、schema/migration 与依赖提案、冻结流程。
  - [tests/fixtures/web-contract/](../../tests/fixtures/web-contract/task-submit-request.json)——21 个合成 JSON 样例，全部携带 `contractVersion: "web-api/1"`；场景矩阵逐行链接到样例文件。样例只表达契约形状，不是请求/响应实测，不含断言。
  - 本记录。
- 未触碰：其它 W0 文件、全局文档索引（含 reviews/README）、product/05、根 README、package.json、锁文件、任何 DDL/迁移、vendor/pi、resources/skills、identifier。无生产代码、无依赖安装。
- 风险级：纯文档 + 合成样例；契约内容涉及跨进程与安全边界，按项目流程交**未参与者独立评审**。原定独立评审者为 OpenCode，本轮 OpenCode 已是 implementer，按"评审者参与实现时改派未参与者并记录"须改派（建议 ZCode 或 Claude，由队长指派）。

## 基点与工作树

- 平台本次分配的独立工作树为唯一交付树；分支 `agent/opencode/mayne-17`，起始 commit `2a6c353a9731c32eef497bec757de05e58722744`。
- `pwd`、`git worktree list`、当前分支核实通过；`git merge-base --is-ancestor 85feb8aaa431a2a1c9f92b238e26a7a2400baa9e HEAD` 通过。
- 未切换共享 main，未使用 `build/team-w0-*` 手工预备树；未自行 commit/push/合并，交付为工作树内可评审 diff，由队长按 Git 授权收口。

## 实际验证

| 命令 | 结果 |
|---|---|
| `npm run check:docs` | exit 0：18 个文件、336 条本地链接；含契约文档场景矩阵指向样例的全部链接 |
| 样例解析与版本一致性检查（命令见下） | exit 0：`files=21 parseFailures=0 contractVersions=web-api/1` |
| `node scripts/checks/check-structure.mjs --self-test` | exit 0：19 类负例 + 8 个引用负例通过 |
| `node scripts/checks/check-structure.mjs` | exit 1：175 项，全部为既有冲突——172 项 `top.dir`（`.multica/`、`.opencode/` 平台托管元数据）+ 3 项 `ref.missing`（`vendor/pi` dist 未准备）；`grep -c "web-api-contract|web-contract"` 命中 0，本次新增文件未引入任何违规 |
| `git diff --check` | exit 0 |

样例一致性检查命令原文：

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

结构失败与 [web-backend-direction-20261106](web-backend-direction-20261106.md) 记录同类：平台元数据与顶层白名单冲突，另加本工作树未运行 Pi 准备导致的 dist 引用缺失；均非本次交付引入。不以聚焦通过冒称全量门禁通过。

## 验收对照（MAYNE-19 要求）

| 要求 | 落点 |
|---|---|
| 从提交到用户看到结果/错误的契约场景矩阵 | 契约文档 §11，17 个场景（含要求的重复提交/满槽/取消竞争/重启/旧备份/旧根/凭据缺失/跨源拒绝） |
| JSON 样例可解析且对应相同版本 | 21/21 解析通过、版本唯一 `web-api/1`（上方命令） |
| 提交/查询/取消/重试、幂等/版本、并发配置、SSE 补偿、attempt/epoch、退出/清理、恢复、受限根管理、provider/控制通道 | 契约文档 §2–§10 |
| queued/cancelling/interrupted/needs_review、响应未知、副作用未知、不恢复 RUNTIME_BUSY 丢任务 | 契约文档 §1/§3；`RUNTIME_BUSY` 在 §1/§10 显式移除 |
| 任务台账/事件/恢复数据结构与 schema/migration 建议 | 契约文档 §12（只提案，不改 DDL） |
| 可复用依赖与新增依赖清单（版本依据/用途/替代项） | 契约文档 §13（复用锁定版本；新增候选须另行授权） |

## 未验证项（保持开放）

- 契约未实现：无运行服务、无端点可调用；样例是评审输入，不构成请求/响应实测。
- 全量 `npm run check` 未通过（结构守卫被上述平台元数据阻断、vendor/pi dist 未准备）；本项为纯文档 + 样例，按验证约定只要求 `check:docs`，不以此替代实现门禁。
- §12 schema、§13 依赖候选均为提案：未建表、未迁移、未安装、未锁版本；生产依赖引入须按仓库授权单独批准。
- 配对/跨源/代理/凭据等安全行为是设计目标，本轮无任何真实环境实测；原生适配与跨平台探针由独立负责人（MAYNE-20）推进，本契约不等待其结论即可评审。
- 独立评审未开始；契约冻结由队长在阶段末统一宣布，成员不得按草案自行开工。

## 结论

作者侧 **pass**：写入范围合规（仅契约文档、本任务样例目录、本记录三类）、21 个样例可解析且版本一致、文档链接守卫通过、无新增结构违规。本记录不签实现或运行通过；待未参与者独立评审与队长契约冻结。
