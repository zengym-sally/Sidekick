# W1 R5 门禁证据包只读核验（Kimi）：**通过**（限包完整性与登记一致性；不签 II 行为与业务准出）

按派发（评论 `01a1b9d3-07b2-7485-ac78-e4a7feec46ce`）对 OpenCode 第六轮补证据评论（`01a1b9c8-bbff-73f1-b16d-ee48df6c9dd2`）上传的三个附件做**只读**核验：新门禁重跑包 `mayne23-w1-r5-rerun-gate-evidence.tar.gz`、原件恢复包 `mayne23-w1-r5-originals-recovery.tar.gz`、包 SHA 清单 `SHA256SUMS-packages.txt`。核对字节/来源区别、执行 SHA、全链 TAP 数量/exit/警告及真实前置收尾。**未重跑任何测试、未自审 II 行为、未改候选/main/任务状态、未触碰任何进程**；MAYNE-23 保持 in_progress。

## 一、包级完整性（实测）

- 三个附件下载字节数与工单登记一致（57,803 / 5,612 / 213 B）。
- 两包 SHA-256 对 `SHA256SUMS-packages.txt` 复算**全部 OK**：重跑包 `c0c310d9b8002d8a3dda9d4e476b4eceaee2a6e1ae16f16799d9ae80263020ef`、恢复包 `fa799ad0cfa980db391feea760813c475366c82c188dfcd251d0d58dfe2d8c43`，与清单逐字相同。
- 重跑包内清单 `SHA256SUMS-r5-rerun.txt` 9/9 文件复算 OK；两包条目均为相对路径，无绝对路径／目录穿越，文件清单与评论申报一致。

## 二、原件恢复与字节/来源区别（实测）

**原件状态**：源 run `01a1b96c-4af0-7f07-b615-408965b64dde` 的 worktree 已被平台回收（`.gc_meta.json` completed_at 2026-11-08T05:18:02Z，worktree 目录删除）——恢复包 `RECOVERY-REPORT.md` 与摘录的陈述与派发评论一致；原件完整哈希经 `RECOVERED/SHA256SUMS-r5.txt` 逐条留档（gate 日志 `79cac86c…9203` 203,384 B／3,009 行、prepare-pi `6ecf1bab…9060`、npm-ci `f6e566d3…1921`、admission `49e72052…74ef`、prepare-cli `fd996335…904d`）。

**逐文件区别（重跑 vs 原件登记值）**：

| 文件 | 重跑 SHA-256（前 16） | 原件登记值（前 16） | 结论 |
|---|---|---|---|
| prepare-cli.log | `fd99633583e44f26…` | `fd99633583e44f26…` | **逐字节相同**（确定性日志，lark-cli v1.0.98 安装通告） |
| gate-r5-rerun-full.log | `fe58f0f55c613758…` | `79cac86c535a568f…` | 不同，已标注新运行 |
| npm-ci.log | `4c34bd7711380fcf…` | `f6e566d3c6bc602e…` | 不同（计时数字差异；末 66 字节与原件幸存段一致） |
| prepare-pi.log | `18e788734674ea45…` | `6ecf1babf457892e…` | 不同，已标注新运行 |

- 体量对照：gate 日志原件登记 203,384 B／3,009 行，重跑交付 203,369 B／3,009 行（Δ15 B、行数相同）——与「同源同链、仅时间戳/路径/进程号/耗时不同」的声明相符，未出现测试体量差异。
- **防冒充标注到位**：`README-RERUN.md` 首段即声明「本包是全新运行，不是原 R5 字节」，并列明与原 R5 的差异声明；恢复包把 `RECOVERED/`（字节级核对一致）与 `TRANSCRIPT-EXCERPTS/`（部分内容、逐条标注来源命令与缺失范围）分目录存放，中间页洞明确「不做字节级交付防冒充」。
- 已恢复件复算：`RECOVERED/prepare-cli.log` = 登记值逐字节一致；`RECOVERED/SHA256SUMS-r5.txt` 重算 `e0685601…66668` 与申报一致。

## 三、执行 SHA 与版本身份（本机对象库实测）

- 重跑执行提交 `8902594b8d7c2ea78bc420add247a0961d7a8995` 存在，tree `29ceaaf607e3183221ca127017ec6fb6ca246dd3`——与 `admission-r5-rerun.json` 登记值**逐字相符**。
- 冻结版 `eca807b6d1911c115abffbb45a9371f38be4b801` / tree `9371002bd327e4ce0deee0488d097321dd9982bf` 存在且与登记相符。
- `git diff --stat eca807b..8902594b` = **仅 `docs/reviews/web-manual-items-integration-20261108.md` +11 行**，与 `source-identity-vs-frozen.txt` 逐字相符（源码/测试字节零变化）。
- 登记提交 `f9d6ed5dcd39af261e96b5046a48d504d42e4d5e` 父即 `8902594b`、**tree 相同**（`git diff` 为空，无内容变更），与评论申报的「仅新增一枚无内容变更登记提交」相符。

## 四、全链执行、TAP 数量、exit 与警告（对交付日志逐行实测）

- **链完整性**：日志第 3 行顶层链恰 **51 组**（`check:structure` → `test:web-manual-items`），47 个 npm 脚本组全部在日志正文出现执行记录；3 个直接 `node --test` 链项（s31-runtime/layout-runtime/s32-runtime）npm 不发 notice，其 TAP 块在正文连续出现（12/2/3）。无短路。
- **标记与退出**：`GATE_START=2026-11-08T05:53:52Z`、`GATE_END=2026-11-08T06:08:14Z`（14 分 22 秒）、`GATE_EXIT=0`。
- **node --test 聚合**：36 个 TAP 汇总块合计 **tests 1,027 / pass 1,027 / fail 0 / cancelled 0 / skipped 0**。
- **cargo 聚合**：6 个 `test result: ok` 块合计 **406 passed / 0 failed / 4 既有 ignored**（pet-store 5、pet-state 9、pet-ui-root 18、pet-native 12+1i、s33-verification-guards 37、probe:native 325+3i 串行 310.98s）。
- **警告分类**：仅既有两类——vite chunks>500kB ×3（L2420/2746/2900）、tauri notarization-skip ×2（L2698/2764）；rustc/clippy `warning:` 行 **0**；零新增类别。
- **三个关键组实测为真实产物**：第 47 组 `check:s33-p2-package` 真实 bundle `Sidekick MCP Verify.app` 并对 `web-backend-storage` 与 `sidekick` 两二进制 ad-hoc 签名；第 50 组 `build:backend` 真实产物（server 源 + 1 shared 模块 + 存储二进制 2,633,392 B + dist→static/）；第 51 组 `test:web-manual-items` 五文件 **59/59/0/0**、`--test-timeout=20000` 不变（含已审 fixture 回归）。
- **逐组与 R5 清单对照**：R5 回执枚举的 23 个 node 组数量（s1 51、s2 47、s31 183、today 26、layout 14、desktop-controls 9、pet 6/13/3、s32 28、s33-config 60、s33-security 7、s33-ui 18、s33-upgrade 8、mcp-contract 9、model-budget 134、model-output-diagnostics 16、mcp-native-fetch 33、mcp-native-launcher 76、mcp-http 62、mcp-recovery 14、pet-ui-artifacts 3、web-manual-items 59）与重跑日志**逐一相符**。

## 五、真实前置与收尾（实测）

- 前置全 exit 0：`npm ci --ignore-scripts`（added 107 packages）、`probe:prepare-cli`（lark-cli v1.0.98，与 R5 同版本）、`probe:prepare-pi`（provenance commit `ad702637fdf6fbd3f965c5dba0b14bae100b74eb` / tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`，真实 dist 构建，与 R5 相同）；环境 node v24.20.0 / npm 12.2.1 / cargo 1.89.0。
- 收尾：`cleanup-pgrep.txt`（CLEANUP_CHECK 06:09:31Z，晚于 GATE_END）复核 cargo/rustc 与 web-backend 零残留；「headless」命中如实解释为运行时自带 playwright-mcp 服务与用户自有桌面应用，并附 `build/web-backend` 3.7M 真实产物清单——与原始 R5 清理记录口径一致，无洗白。

## 六、观察项（均不阻断）

- **OBS-1（分组口径，879 vs 1,027）**：R5 回执评论与 `8902594b` 提交信息的「node 879 例」是 23 个枚举组的合计；重跑评论与 `f9d6ed5` 提交信息的「1,027 例」是全部 36 个 TAP 块的合计。差额 148 例来自 13 个未列入 R5 枚举的块（executable-copy 4、s33-ui-safety 5、s33-discovery 77、s33-lifecycle 12、probe:runtime 9、probe:card 4、probe:contracts 6、s2-runtime 7、today-runtime 5、s31-runtime 12、layout-runtime 2、s32-runtime 3、s33-ui-artifacts 2）。两轮源码逐字节相同、日志行数相同（3,009），测试体量相同，仅是回执文本的合计口径不同；两轮均为 0 失败。**建议最终记录同时写明两个口径**（枚举组 879／全量 TAP 1,027），避免收口签字时歧义。
- **OBS-2（README 时间戳小差）**：`README-RERUN.md` 表内「前置 PREREQ_START 05:52:23Z」与原始留证 `prereq-environment.txt` 的 `05:52:40Z` 差 17 秒（前者与 admission `registered_at` 相同，疑为摘要复制）；以原始留证为准，不影响结论。
- **NIT-1（二进制哈希为登记级）**：存储二进制 SHA-256 `b7dd9339…6422` 未随包交付（日志仅留大小 2,633,392 B）；该值由 OhMyPi 验收评论与本次重跑 README 从同一冻结源独立登记、互相吻合，属登记级交叉验证；只读范围内不做完整 cargo release 重建复算。

## 七、未验项

- 原 R5 的 gate 日志/admission/npm-ci/prepare-pi 原件字节已 GC 回收、不可字节级恢复；原 R5 的逐块 TAP 合计无法字节级复核（仅存代表性切片）——本核验的 TAP/exit/警告结论绑定**重跑交付日志**。
- 51 组门禁执行本体按派发未重复；候选 II 行为按派发未自审（依据 OhMyPi R3/R4/R5 通过记录）；`eca807b` 原样 UI 旅程由 OhMyPi 并行验收，不在本核验范围。
- Linux/代理、真实凭据/用户工作根/真实模型边界不变；main 合入/清分支按派发留队长。

## 八、处置

**通过**（限本次交付门禁证据包的完整性与登记一致性）：两包哈希与包内清单全部复算相符；原件/交付件分标清晰、无冒充；执行 SHA/tree 与 admission 登记在本机对象库实测相符；全链 51 组无短路、GATE_EXIT=0、node 1,027/1,027/0/0、cargo 406 过/4 既有 ignored、警告仅既有两类零新增；真实前置与收尾证据齐备。OBS-1/OBS-2/NIT-1 交最终记录统一校准。MAYNE-23 保持 in_progress；本核验不代签 II 行为、业务准出或完整门禁结论。

## 证据

- 本机留存（gitignored）：`build/mayne23-gate-package-review/`——`attachments/`（三个附件原件）、`extracted/`（两包解包内容）、`verify.sh`（核验脚本）、`verification-log.txt`（SHA-256 `a77a469d85a84240c34c525fd6a14ab5b40df0d2c2d536d389e036290f29dbe5`）。
- 随本评论附件：本记录与核验日志。日志中出现的本机绝对路径属运行时环境信息，未做改写以保持原始证据性；不含配对码/cookie/token。
