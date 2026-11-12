# W1 工程候选精确接收：第五例入位＋回执重启三件＋聚合 10→11（OpenCode，2026-11-10）

> 接收依据（派发：MAYNE-24 协调评论 `01a1c168-7ad3-74cf-a562-b8bb19a07b7a`，Codex；日期收尾同步依据 `01a1c141`）：在既有 III 工程候选上作独立小提交——(1) test-safety 测试原样更新到 `bdf3ae4` blob `7c0cb4ba`（两夹具不变）；(2) 从 `6fd8679` 只接收 receipts-restart 测试＋instance＋worker 三件；(3) 在当前十文件命令末尾仅追加 `tests/unit/web-text-intake-receipts-restart.test.mjs` 一次，10→11。同步 manifest 修订 3：两套回归为已审工程候选、日期 `779a4d1` 限定证据齐备；新 UI 能力修订、任务 SSE 实现／新测试、E/D 等仍待准入。只做语法、逐 blob、引用／参数一致性、必要结构自测与 docs 核查；不重跑已过用例或聚合、不重建整包、不造缺失 I／II 占位、不整树合并、不改 I 生产／main、不启动正式集成或完整 gate。MAYNE-24 保持 `in_progress`。

## 1. 接收身份（逐 blob 复核）

| 文件 | 来源 | blob（git hash-object） | 内容 SHA-256 | 字节 | 判定 |
|---|---|---|---|---|---|
| `tests/unit/web-text-intake-test-safety.test.mjs` | `bdf3ae4`（tree `36eb8471`＝协调锁定） | `7c0cb4ba27e41f7baa985a1dae8f2064d95d5e28` | `dec1eb9d20631912d81722fd65ac90cc93471b4dd11b0ca37a147877fe189f88` | 47028 | 与 `bdf3ae4` 逐字节相等（git show 直写＋hash-object 复核）；相对 `f72ff6dd` 恰 +191/−1（import 行扩 `readdirSync, realpathSync`＋末尾单一 hunk 追加第五例），两夹具 `4bea6aac`/`4f3c9940` 未触 |
| `tests/unit/web-text-intake-receipts-restart.test.mjs` | `6fd8679`（tree `313038cb`＝协调登记） | `13bc604a2e15f2e1e5078203795d7c22ba602bb7` | `1943d6db8e636ab1673cb8c9ee3f0b229a787257cb95272e20b4f79012b29c81` | 42576 | 同上；即协调接收登记的终版 blob（微修后） |
| `tests/fixtures/web-text-intake/receipts-restart-instance.mjs` | `6fd8679` | `a4716ffa302c35b110e0b4a80fde0ae29bec90c8` | `d21a7d6455facaebb4ff1e13986b9a555f62da7596a870331178467e6775d241` | 4323 | 同上 |
| `tests/fixtures/web-text-intake/receipts-restart-worker.mjs` | `6fd8679` | `11f498d912e59cc4aa49779a6ba433829f64bbca` | `ec5645b5303d5111b05e1612083c65ce3b13db39ed202450f2d827d0e1758cd5` | 5218 | 同上 |

恰为派发登记的四 blob；`6fd8679` 内其余恰 4 个 docs 文件（ZCode 记录）不在接收范围。前置独审：第五例 ZCode `c4904a9` 五面限定通过；回执终版 Pi `b93a048` 主体通过＋协调层微差核对＋F3 载体通过；均由协调 `01a1c168` 准入。

## 2. 聚合命令唯一改动（恰一行）

`package.json` 的 `test:web-text-intake` 值末尾追加 ` tests/unit/web-text-intake-receipts-restart.test.mjs` 一次：10→11 文件；原十文件顺序、脚本名、`--test-timeout=20000` 预算、全部既有脚本名、52 步 check 链、依赖与锁逐字节不变。`git diff --numstat` ＝ `1 1 package.json`，差异恰该行。

## 3. 限定核查

- **语法**：四文件 `node --check` exit 0 ×4。
- **逐 blob**：第 1 节四 blob 全命中。
- **引用／参数一致性**：测试 `:119-120` join 引用的 worker/instance 路径本树闭合；instance 夹具仅 `node:*` 内建（树内自洽）；worker 夹具 `:44` 引 `./mcp-pairing-frames.mjs`（manifest 在册 `7a1dfac0`，随 mcp-pairing 接收线落位）；测试 `:113` 引 `server/lib/credential-provider.mjs`（manifest A[3]，`cd08588` blob `0f8cf42e`）、`:115` 引 `db-observer.mjs`（manifest D_ii_fixtures_r5[4]）——三处均为已在册接收集路径，与十文件命令既有文件的 II 候选导入同类，本树预期缺失、不造占位。
- **结构自测**：`check:structure --self-test` exit 0（003 原字节正例待候选 I 激活的既有语义保留）。全量检查 HEAD 净基线对照（临时 detached 树同命令，`build/mayne24-receive-20261110/check-structure-{before,after}.txt`）：基线 8 条（003 冻结待候选 I 激活＋vendor/pi dist 3 条环境缺失＋test-safety 四条 II 夹具导入）原样保留；本提交新增恰 3 条 `ref.missing`，全部指向第 3 节列出的在册接收集路径；触及 `package.json` 或接收夹具自身完整性的违规 0 条。
- **docs**：`check:docs` exit 0（22 文件 580 链接——579＋本接收新增的 README 索引行恰 1 条新链接）。

## 4. manifest 修订 3（`web-text-intake-integration-inventory-20261110-manifest.json`）

- §E：test-safety 条目 `6216a6b`/`f72ff6dd` → `bdf3ae4`/`7c0cb4ba`（新 sha/bytes/lineage/review）；新增 receipts-restart 测试＋instance＋worker 三条目（均 `receivable`，review 记 Pi 主体＋协调微差＋F3 载体链）。条目 128→133（writeView 计数同步，附分节 recount）。
- §F：回执终版条目改 RECEIVED（`a1562c1`/`b422ee08` 保留为微修前主体链历史登记，不反签旧字节）；第五例条目改 RECEIVED；日期收尾条目改「限定证据齐备」（`779a4d1`：三件 SHA 复算相符、body 3212＋cleanup 4096＝7308ms<20000、rootRemoved/residue/exit0，旧记录按已披露范围保留）；新增两条 PENDING admission（UI 能力修订三文件包、任务 SSE 实现＋新测试）。
- §C：保留 `aggregate_command_at_6fad178` 历史字段原样，新增 `aggregate_command_after_receipts_restart_receive`（11 文件命令＋唯一改动说明＋本树不跑聚合的边界）。

## 5. 边界与未签范围

- 不跑聚合套件、不跑完整 `npm run check`、不重建整包；本树 003/vendor 与 II 夹具缺失的既有登记状态不变。
- 独审通过的运行行为证据归各自独审记录；本记录只登记逐字节接收与结构核查，不代签运行行为；聚合执行归 III 唯一集成轮。
- 工程接收差异由协调层复核（不替代子测试独审）；本提交作者 OpenCode（III 工程文件写入者），独审另派。
- 新 UI 能力修订（ZCode 三文件包）、任务 SSE 实现／新测试（路线 `f3b9d3c` 已交待裁定）、E/D 与 GAP-5 等准出前置仍开放，各走原线。
