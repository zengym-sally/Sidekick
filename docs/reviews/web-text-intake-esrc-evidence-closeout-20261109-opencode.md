# W1 执行来源缓存独审证据收口（OpenCode，2026-11-09）

> 限定收口之一（派发：MAYNE-24 协调评论 `01a1c0c4-e358-7f1d-9628-f1d974e31dfc`，Codex）：为独审 `0ff27bb`（执行来源缓存增量 `cd08588` 四面＋四例复跑＋三支独立探针）的已挂证据补**身份清单**、**六份 JSON 的脱敏副本／SHA 映射**与**探针脚本逐件披露**。不重跑已过验证；旧结果与旧哈希不改写；删字段不算重新验证。MAYNE-24 保持 `in_progress`。

## 1. 对象库身份清单（本日重新复算，全哈希）

- 候选增量 `cd08588328df27cabdb50f178159424a9534c0b9`／tree `776b252919e1a6eb355c147b542b0d3308c9abe2`／父 `d2b2696d965f81de67155c5ee037a744f1b56f34`；`server/lib/worker-host.mjs` blob `52198fa55dca726964eff6f626eef94061f57eb3`、`server/lib/task-scheduler.mjs` blob `8684d44fd03d92b12f9197103f6d7cf8cb08fb25`（仅注释 5 行）。
- test-safety 候选 `6216a6b25e3869f262897852a19baffc150a879c`／tree `06834225e6fad3a753bd88665f5ecbc2584056c7`／父 `b87d054a6d36512cf2f2642125cb47034ee6e48d`；三文件 blob：测试 `f72ff6ddc94e1a5ae1533af45df3b4b3aa7c71ef`、runtime-entry `4bea6aac91550620a690d0721a4391ff5b3afd7b`、stub-worker `4f3c994031ce961070642352403629afada3805f`。
- 聚合命令已审载体 `9ab8ee0`（tree `5e7d02b31f04c27522327800bf3b8179ca61bfb0`，父 `cce6cfbbae35283189988f3a3bd9823526c83844`）的 `package.json` blob `17d3825ab3abdfff45900d3cf098660dbcbcf589`，与本分支收口前 HEAD（`0ff27bb`）逐字节同 blob。
- **交叉绑定（本日复算）**：`git cat-file blob 4bea6aac | sha256` ＝ `54e1d84c54b322d844af7b01f0777ea6d08bda045230453976fc72a7864daee9`，恰为两份 R1 证据 JSON 内的 `syntheticEntrySha256`（即作者登记夹具哈希）——本次接入的夹具与 R1 探针当时实际执行的入口逐字节相同，两项收口由此互证。
- 登记产物（登记来源，运行树副本已被平台回收）：存储二进制 `5311ffa3…232bd`（2 647 984 B，`a054244` 登记、`0ff27bb` 第 6 次复现）；organizer `08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`、node `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`。三值亦内嵌于六份证据 JSON 的 worker 记录中，随脱敏副本继续可核。

## 2. 六份 JSON 脱敏副本／SHA 映射

原附件经 multica CLI 于本日重新下载，六份对 `SHA256SUMS`（附件 `01a1c0bc-fc85-7095-a36c-571155ad26af`）复算全部逐字节 OK。脱敏副本仅替换 R1 两文件中的 `marker.hostNonce`（原值不转载，占位 `<redacted:hostNonce>`＋`hostNonceVerified:true`，其与当次 worker.json 三方一致系 `0ff27bb` 审内已验事实）；每份内嵌 sanitization 块：替代的附件 ID、原 SHA-256、脱敏字段与政策、以及**本日从下载字节重算的文件内比对布尔（全部 TRUE）**。R2/R3 四份无 nonce 字段，仅随套统一改版供后续引用。删字段不是重新验证；原附件与其哈希仍是权威，不改写。

| 脱敏副本 | 替代附件 ID | 原 SHA 前缀 | 脱敏副本 SHA-256（全） |
|---|---|---|---|
| r1-candidate.sanitized.json | `01a1c0bc-f7a4-73cf-bb76-7ae181b52cac` | `ae235d897efc` | `690b7571d7b526d43a345e17c866601e29978194c8f3d3e1cd75735f9a11b30d` |
| r1-parent.sanitized.json | `01a1c0bc-f88a-7771-8504-97b9983a831f` | `6183daedbacc` | `54fce0c2d4c00a27e62066cef95f187a135ee44c61b891f7ee79889042387ec0` |
| r2-candidate.sanitized.json | `01a1c0bc-f955-731d-a886-9c2515aa52a4` | `69477a9e0a51` | `7e2a05c31442ead031e2cae185bcc4a1e5632e17322011e66a36dbe00b01dcdc` |
| r2-parent.sanitized.json | `01a1c0bc-fa25-75a9-b499-73cda0255625` | `1e97b40a176c` | `25cbf7901b726b7402d58c36b0fc7178538e2db7f1382d6f90efb3ad6808382b` |
| r3-candidate.sanitized.json | `01a1c0bc-faf3-7650-ab3b-5d51828890e9` | `9cc2e3fc4518` | `b57153cdb05053b4d6ea10c3b068898394bbdf6b2d96f99fe1f1ea436d2ff044` |
| r3-parent.sanitized.json | `01a1c0bc-fbbb-7d39-b1c3-035e3c1c6fbb` | `1fd0a103b519` | `2ceaa8228ec3bd157c729b02258ff1fbbff26a7a79af1587e190700d517347a6` |

脱敏副本与身份清单全文随收口评论附件交付（`esrc-closeout-inventory.txt`、六份 `*.sanitized.json`、`SHA256SUMS-sanitized.txt`）；grep 复核两处原 nonce 值在全部副本中出现 0 次。

## 3. 探针脚本逐件披露（不补造旧件）

- `esrc-review-probe.mjs`（R1 预热换向／R2 launcher 实参捕获／R3 期望身份不可解析；真实默认工厂；每例 20s 含清理）与四例复跑驱动脚本：仅存于当次运行的临时目录（`/private/tmp/multica-task-786099651/opencode/mayne24-esrc-review/`），按 `0ff27bb` §6 零残留登记在运行结束时清理；评审当时未随评论挂载（当时 13 件附件＝四例 TAP＋五支探针 TAP＋六份 JSON＋SHA256SUMS），现任务临时目录已不存在，**不可恢复**。
- 按日期补件先例（协调对 `01a1c0bf` 的判据「原脚本若已回收同样逐件披露，不补造旧件」）处理：不重建、不冒充原脚本；已过验证不重跑。仍可独立核验的载体：六份 JSON 原件＋脱敏副本、五支探针 TAP＋四例 TAP＋SHA256SUMS（附件 `01a1c0bc-fd5d`）、本日 §1 全部对象库身份、以及 `0ff27bb` 记录中对三支探针语义的逐面描述。未来若需复现，属**新运行**，须以新输出新哈希登记，不得充当本审原始证据。

## 4. 边界

- 本收口只补证据载体，不新增任何技术结论；`0ff27bb` 的通过范围、边界与未签事项原样保留（聚合准入、III 正式独审、整体准出、GAP-5、E/D 仍开放）。
- 零树外操作：下载与脱敏脚本均在本工作树 gitignored `build/mayne24-esrc-closeout/` 内；无生产/测试/package 字节改动（本记录与索引行为全部 docs 改动）。
