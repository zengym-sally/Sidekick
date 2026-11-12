# W1 test-safety 三文件接入 III 工程候选（OpenCode，2026-11-09）

> 限定收口之二（派发：MAYNE-24 协调评论 `01a1c0c4-e358-7f1d-9628-f1d974e31dfc`，Codex）：在既有 III 工程候选上作独立小提交——从 `6216a6b` 原样接收且仅接收三文件，并在已审 `9ab8ee0` 的 `test:web-text-intake` 命令中仅追加该测试路径一次（9→10 文件）。不整树合并、不改任何测试字节或 I 生产文件、不重建整包、不运行聚合／完整 gate。MAYNE-24 保持 `in_progress`。

## 1. 接收身份（逐 blob 复核）

| 文件 | blob（git hash-object） | 内容 SHA-256 | 判定 |
|---|---|---|---|
| `tests/unit/web-text-intake-test-safety.test.mjs` | `f72ff6ddc94e1a5ae1533af45df3b4b3aa7c71ef` | `2bb552e699a84dbe36db3a7d75b01558a69d21d9b7c393dd5b539dd40d2ec127` | 与 `6216a6b` 逐字节相等（git show 输出直写＋hash-object 复核） |
| `tests/fixtures/web-text-intake/test-safety-runtime-entry.mjs` | `4bea6aac91550620a690d0721a4391ff5b3afd7b` | `54e1d84c54b322d844af7b01f0777ea6d08bda045230453976fc72a7864daee9` | 同上；且与 `0ff27bb` 独审 R1 证据的 `syntheticEntrySha256` 全等（交叉绑定） |
| `tests/fixtures/web-text-intake/test-safety-stub-worker.mjs` | `4f3c994031ce961070642352403629afada3805f` | `c593be6345eab505c4335156330771c114a6e99d0fc639ec615b02541662d67b` | 同上 |

三者恰为派发登记的三 blob；`docs/reviews/web-text-intake-test-safety-default-factory-20261109-pi.md`（作者记录）不在接收范围。

## 2. 聚合命令唯一改动（恰一行）

`package.json` 的 `test:web-text-intake` 值末尾追加 ` tests/unit/web-text-intake-test-safety.test.mjs` 一次：9→10 文件；原九文件顺序、脚本名、`--test-timeout=20000` 预算、107 脚本名集合、52 步 check 链、依赖与锁全部逐字节不变（该行在既审版本中本为 1 空格缩进，原样保留）。`git diff --numstat` ＝ `1 1 package.json`，`-U0` 差异恰两行且均含该脚本名。

## 3. 限定核查（全部通过，原始输出随评论附件）

`node build/mayne24-test-safety-receive/verify-receive.mjs`（构建目录 gitignored，脚本与输出一并附件）：

- **语法**：三文件 `node --check` exit 0 ×3。
- **逐 blob／聚合参数**：三 blob 与 `6216a6b` 逐字节相等；聚合命令分解 `node --test`＋`--test-timeout=20000`×1＋10 文件路径、无其他参数；原九文件按序在前、新路径恰一次在末尾。
- **引用完整性**：两份接收夹具互引（测试 `:452` stub-worker、`:569` runtime-entry）在树内闭合；`node:*` 内建导入合法。四条 II 夹具导入（`backend-process`／`controlled-model`／`db-observer`／`synthetic-inputs`）为**预期缺失**——属候选 II 接收线，与聚合其余九文件同样未接入，如实保留不造占位；`server/entries/web-backend-entry.mjs` 路径在本树闭合但字节为 MAYNE-23 既有版本（blob `be009408`，≠候选 I `cd08588` 的 `47a9efcd`），候选 I 接入时按其接收线落位。
- **结构自测**：`check:structure --self-test` exit 0；全量检查基线对照（HEAD detached 临时树同命令）——基线 4 条（003 冻结待候选 I 激活＋vendor/pi dist 3 条环境缺失）原样保留，本提交新增恰 4 条 `ref.missing`，全部指向上述四条预期缺失的 II 夹具导入；触及两份接收夹具或 `package.json` 的违规 0 条。
- **docs**：`check:docs` exit 0。

## 4. 边界与未签范围

- 不跑聚合套件、不跑完整 `npm run check`、不重建整包；本树 9 个聚合文件缺失的既有登记状态不变（本提交只把第 10 个路径与其文件接入）。
- 通过独审的四例／反控（`0ff27bb`＋协调接收 `01a1c0c4`）是本接入的前置；本记录只登记接收与结构核查，不新增业务结论、不代签运行行为——运行行为证据归独审记录，聚合执行归 III 唯一集成轮。
- 本提交由作者（OpenCode，III 工程文件写入者）交付；独审须另派未写工程文件者（Kimi／ZCode），由协调派发。
- GAP-5、E/D 与整体准出仍开放；回执套件、s2-client 修订、日期补件各走原线，不在本提交。
