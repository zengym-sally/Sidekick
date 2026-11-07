# W0 Web API 契约返工记录（MAYNE-19 第八轮修订）

## 对象、基点与身份

- 返工对象：`docs/engineering/web-api-contract.md`（**仅一处规范文本**）。
- 基座候选：`agent/claude/mayne-19` 的 `6e8b56af6e9565f4433221248d08af69de515f3a`（第七轮返工后的候选；第八轮聚焦复审结论为 needs_revision，仅 1 项 P2）。
- 编写基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`（本机基线，尚未 push）。
- 交付分支：`agent/claude/mayne-19`（平台自动提交，本任务不自行 commit/push/合并）。
- 写入范围：契约文档、本任务样例目录、本任务 `docs/reviews/web-contract-*.md`；未改生产源码、DDL、manifest、锁文件、共享文档索引、`vendor/pi`、`resources/skills`、identifier。
- 结论：作者侧 **pass（非独立）**；待新一轮独立复审与队长契约冻结。

## 驳回清单逐项处置

| # | 级别 | 驳回发现 | 本轮修订 |
|---|---|---|---|
| A1 | P2 | §4.3 新增的「判别与元信息的作用范围」把大小/分段元信息说成“仅出现在索引与分段”，与内联响应定义及两份内联样例冲突（内联也含 `totalBytes`/`maxInlineBytes`/`maxSegmentBytes`） | 按实际 DTO 重写该句：`totalBytes` 用于成功结局的内联、索引、分段；`maxInlineBytes`/`maxSegmentBytes` 用于内联与索引；`nextOffset`/`done` 用于索引与分段；失败结局不带任何大小/分段元信息。**未改任何响应形状与 JSON 样例** |

前八轮（2026-11-06、2026-11-07）的关闭情况以 `docs/reviews/web-contract-revision-20261107.md` 与 `docs/reviews/web-contract-rework-*-20261107.md` 系列记录为准，本表只覆盖本轮驳回清单。

## 自检（本机实测，非独立）

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档本地链接 | `node scripts/checks/check-docs.mjs` | exit 0：18 个文件、375 条本地链接通过 |
| 样例解析与版本一致 | 见下方命令 | exit 0：`files=48 parseFailures=0 contractVersions=web-api/1` |
| 字段作用范围一致性（`build/web-contract-20261107-r8/verify.py`） | exit 0：内联/索引/分段三类响应的大小元信息范围与规范描述逐项一致；失败读取不带大小元信息 |
| 读取判别与分段字节 | 同上 | exit 0：全部读取响应带 `outcome`、成功响应 `failure=null`；分段严格解码 256/256/88、总长 600 |
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

交付内容哈希清单（契约文档、九份本任务记录与 48 个样例）见忽略目录 `build/web-contract-20261107-r8/delivery-manifest.json`；平台自动提交落定后，复审以该提交为准重算。

## 未验项与边界

- 未运行任何服务端点、真实 SSE/代理、真实模型/凭据、真实工作根、Linux/macOS 原生适配或完整 `npm run check`；本项仍为未实现契约提案。
- 全量门禁（含结构守卫）由集成负责人在实际集成版本上串行执行，不在本任务内。
- 本轮只提案，不改 DDL/manifest/锁文件、不安装依赖；契约约定是实现切片测试断言的独立预期来源。
- 契约冻结由队长在 W0 阶段末统一宣布；本文不构成冻结或实现通过。

## 结论

作者侧 **pass**：写入范围合规、48 个样例可解析且版本一致、文档链接守卫通过、本轮唯一 P2（规范内部字段作用范围冲突）已修正且不涉及响应形状或样例字段。本记录不签实现或运行通过；待新一轮独立复审与队长收口。
