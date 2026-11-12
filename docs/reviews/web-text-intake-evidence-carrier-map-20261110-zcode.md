# 证据载体补全 — 本批发布附件的发布集合 SHA 重算与原→副本哈希映射（ZCode，仅载体）

- 日期：2026-11-10；作者：ZCode。本批＝本人在交付评论 `01a1c136-c3bd-764a-a071-c3b56ab357ff`（2026-11-09T16:49:14Z）挂载的 6 个附件；本记录只补证据载体映射，不触任何工程输入字节。
- 派工来源：issue 线程回复 `01a1c13e-b356-7361-b4b5-c0c3e06c0af4`（Codex）：仅从本批实际附件字节重算发布集合 SHA，逐件注明原相对路径／附件 ID／发布名、脱敏字段与原→副本哈希映射；保留原未脱敏清单、不改写旧哈希；F3 明确绑定已修 setter 语义的最终运行；原件若已失如实披露、不补造、不重跑正常／F1／F2／F3 或第五例。
- 成因（如实登记）：该交付评论写「脱敏精选原件随本评论挂载」，但随附的 `SHA256SUMS`（附件 `01a1c136-c2e3`）是 14 项**未脱敏原始**清单（含 `receipts-f3/f3.tap` 等原相对路径），而发布副本中四件经脱敏／改名——除 `after-5th.tap` 外哈希必然异于清单项。措辞「原件」与实际「副本」混用导致清单未闭合，本记录按派工补映射；旧清单逐字保留（见下），零改写。

## 1. 发布集合重算（2026-11-10，从附件实际字节 `shasum -a 256`）

| 发布名 | 附件 ID | 字节 | 实测 SHA-256 |
|---|---|---|---|
| after-5th.tap | `01a1c136-bee0-7791-b16f-61d01582469d` | 504 | `e2250e3c3aa6706dafff1309aa56d498c672ed4bfae9f7a0f50e89a2c4869dba` |
| before-5th.tap | `01a1c136-bfac-7345-8bf3-b03eab450fbe` | 1461 | `1b8d4ababb89b7152bb7e91ccc0eb3d94fd606d8d1d5d48d20aeead12f29e5bd` |
| receipts-f3.tap | `01a1c136-c080-7758-bb18-e545e8b1a141` | 5665 | `a832f5ae9fc7f20ee4561dae5378ffc880fe373b761b7831ed1c1c7731fba95d` |
| dump-manifest.json | `01a1c136-c14a-7d8b-835d-fc9f69c66475` | 1890 | `2b272db3d28b1a5fc64254d733d62ffae95120396257a43eb17abf37feca1888` |
| identity.txt | `01a1c136-c20e-73bd-ad6b-3af951e579dc` | 1178 | `aebffe33be659d0e2bc6ae287e58c86fc47eac0be5d2ce9f76c3fdb11005f9a4` |
| SHA256SUMS | `01a1c136-c2e3-7e11-990d-727e0c7ea7dc` | 1244 | `bd800fa972693a1d95c94ddc3f7baabb4397094ad71ffecf6b07bda144cce189` |

下载字节与登记的附件 size 逐件相等（504/1461/5665/1890/1178/1244）。`SHA256SUMS` 是清单自身，不是清单项。

## 2. 原→副本映射（清单原始路径 ↔ 附件 ID ↔ 发布名 ↔ 脱敏字段）

原清单（未改写，14 项）关键项 → 发布副本：

| 清单原始路径（原 SHA-256） | 发布（附件 ID） | 副本 SHA-256 | 关系与脱敏字段 |
|---|---|---|---|
| `after-5th.tap`（`e2250e3c…`） | after-5th.tap（`…bee0`） | `e2250e3c…` | **副本＝原件逐字节**（绿色 TAP 无绝对路径，无需脱敏）——协调层核读相符的唯一一项 |
| `before-5th.tap`（`84399fdb…`） | before-5th.tap（`…bfac`） | `1b8d4aba…` | 脱敏副本：`location`/`stack` 内工作树绝对前缀→`<repo>`（`…zreview/before/tests/…` 相对段保留）；断言文本、`GAP-TEST-SAFETY-3` 错误逐字、时长未动。原件字节未留存 |
| `receipts-f3/f3.tap`（`5ae3c3b6…`） | receipts-f3.tap（`…c080`） | `a832f5ae…` | 脱敏＋改名副本（路径扁平化）。双层脱敏：①测试自身 `sanitizeCleanupDiagnostic`（提交字节 ：245-261：世界根→`<root>`、运行树根→`<repo>`、execPath→`<node>`、homedir→`~`，≤6 行 ≤200 字符 `' \| '` 连接）作用于 `[cleanup]` 通道；②发布时对 node 渲染的 TAP failure stack 做工作树绝对前缀→`<repo>`。业务 face 未动 |
| `zprobe-evidence/dump-manifest.json`（`6a5c409d…`） | dump-manifest.json（`…c14a`） | `2b272db3…` | 脱敏＋改名副本（目录段扁平化）。`runId`×6→`<runId>`、`hostNonce`×2+marker→`<hostNonce>`、`pid`×3→`<pid>`、`runtimeRoot/node/entry` 工作树前缀→`<repo>`、合成根→`<tmp>/<temp-root>`、`nodeSha256/entrySha256` 长十六进制→占位符＋尾 16 位；`attemptId`/`taskId`/`pgid`/`startedAt`/`trusted`/`reason` 原样。原件字节未留存 |
| `identity.txt`（`08f10c96…`） | identity.txt（`…c20e`） | `aebffe33…` | 脱敏副本：64 位十六进制串→`<hostNonce>`＋尾 16 位、工作树绝对前缀→`<repo>`；提交／树／blob 哈希、版本（node v24.20.0／rustc 1.99.1）、字节长度原样。**过度脱敏如实登记**：存储二进制哈希 `5311ffa3…232bd` 是多方评论与记录里的公开登记值，也被十六进制规则截为 `<hostNonce>f945a4d2753232bd`——无害但不精确，不回写。原件字节未留存 |

说明：`[cleanup]` 通道的 `<repo>`＝**运行树根**（`repositoryRoot = resolve(import.meta.dirname, '..', '..')`，提交字节 ：117；测试自身运行时脱敏），而 TAP failure stack 的 `<repo>`＝**工作树根**（发布时脱敏）——两通道占位符语义不同是已提交字节的行为，非异常；已依 ：245-261 的发射器格式（行数／长度上限、`' | '` 连接、表头措辞）核对发布副本一致。

## 3. 清单未发布项与今日再锚定

未随评论发布、仅存在于原清单的 9 项：`after-5th.stderr`（`47e7966d…`）、`before-5th.stderr`（`e37e97bf…`）、`zprobe-dump.tap`（`43dad4b3…`）、`zprobe-dump.stderr`（空文件 `e3b0c442…`）、`receipts-f3/f3.stderr`（`af42d0f1…`）、`receipts-f3/f3-close-marker.txt`（`2ae4c303…`）、`receipts-f3/receipts-fixed.mjs`（`1943d6db…`）、`receipts-f3/receipts-f3-scratch.mjs`（`af35961e…`，注入 scratch 副本，按披露已删）、`receipts-f3/receipts-current.mjs`（`79657d3a…`）。

其中两项**本日在共享对象库再锚定到持久 git 字节**（原 raw 副本虽失，其清单哈希可与提交字节互证）：

- `receipts-fixed.mjs` 清单哈希 `1943d6db8e63…4f79012b29c81` ＝ 提交 `6fd8679` 内 `tests/unit/web-text-intake-receipts-restart.test.mjs` 内容 SHA-256（git blob `13bc604a`）——本日 `git show | shasum -a 256` 相等。
- `receipts-current.mjs` 清单哈希 `79657d3a4a91…2bdc316a44f7` ＝ 提交 `a1562c1` 同文件内容 SHA-256（git blob `b422ee08`）——本日复算相等。

## 4. F3 绑定：发布 `receipts-f3.tap` ＝ 已修 setter 语义的最终运行

按派工明确绑定，不混入首版注入（getter 缺 setter 那轮，close 步失败诊断在案的 TAP 已失、未参与发布）：

- **时长三元组逐位命中登记值**：RA1 `5038.085166` ms／RA2 `5327.344709` ms／整进程 `10430.164292` ms ＝ 登记的 5038/5327/10430（捕获失败即时重抛、无 5s 等待的时长形态）。
- **AFTER face 完整**：2/2 `hookFailed`、exit 1；每例恰 1 个清理步失败＝门步重抛捕获错误，错误逐字 `own storage subprocess handle is not a real ChildProcess (backend.recovery.storage.child)`；**close 步零失败诊断**（无任何 close 步 TypeError 条目）——首版注入 face（close 步 `this.child=null` TypeError 诊断）在此副本中不存在，排除混入。
- **发射器格式与提交字节一致**：`[cleanup]` 表头措辞、1 步失败计数、脱敏栈形态均为提交字节 `reportCleanupFailure`/`sanitizeCleanupDiagnostic` 的输出形状。
- 栈行号（`:432:17`/`:589:19`/`:607:17`/`:676:1` 等）是运行树 **scratch 副本**（fixed 字节＋披露注入 A/B）内的位置；scratch 已删，行号与提交字节的逐行对应不可今日复算——如实登记，不影响 face 绑定。

## 5. 如实披露与边界

- **原件留存**：五份脱敏副本的原件（`before-5th.tap`／`dump-manifest.json`／`identity.txt`／`receipts-f3/f3.tap` 原始未脱敏字节）与 9 项未发布原件的 raw 目录，随更早工作树实例回收已不在本机；本记录不补造、不重跑任何用例，映射依三足成立：原清单哈希（保留）＋发布副本实测哈希（本日重算）＋副本内可见脱敏对应（占位符与未脱敏字段同登记事实逐一相符）。
- 旧清单（附件 `01a1c136-c2e3`）逐字保留；`SHA256SUMS-published`（发布集合 6 项）随本轮交付评论另行挂载，两者互不覆盖。
- 仅文档 1 新文件；生产／测试／package／guard 零字节；未运行任何测试、探针或反控；未触真实模型／凭据／用户根。MAYNE-24 保持 `in_progress`。
