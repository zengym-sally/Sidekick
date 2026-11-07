# W0 完整门禁 R5 证据独立复核（Kimi，2026-11-07）

> 结论先行：**通过**。OpenCode R5 交付（评论 `01a1b5f5-7900-714c-9dab-a86e3b45e518`）的 7 个证据附件与报告提交 `7f536db3d0d130f762421be3fe1d55cb2fec5309` 经本评审独立复算，哈希逐项一致、命令/退出码/原预算/计时/汇总/警告分类与原始日志互证、报告提交仅含报告增量、授权包「仅备妥未执行」与 main 实际 ref 状态互相印证。1 项不阻塞 NIT（建议命名措辞）与 2 项边界说明见 §5。

## 1. 范围与方法

- 复核对象：R5 证据附件（evidence tar.gz、`full-check-r5.log`、`gate-result.json`、`hashes-20261107-r5.json`、`authorization-package.json`、`admission.json`、`7f536db` 补丁）与报告提交 `7f536db`；候选 `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3`、集成补丁 `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e`。
- 方法（仅证据审查）：下载附件复算 sha256 并与清单比对；在本仓库共享对象库独立复算候选提交、集成补丁、报告提交的哈希与字节一致性；逐项核对日志的命令链、退出码、预算、起止计时、测试汇总、警告分类与日志结尾；核对 ref 状态验证「未执行」声明。另下载上轮候选补丁附件做逐字节比对。
- 未做的事：未重跑完整门禁、未重跑任何聚焦检查、未修改实现或作者报告、未改任何共享 ref。
- 边界：R5 通过只证明**本轮**完整门禁在精确候选上按原预算通过；历史 R1b/R2/R3 超时根因不在本证据可证范围（§6）。

## 2. 核对清单（全部通过）

| # | 核对项 | 独立复算结果 |
|---|---|---|
| 1 | 附件完整性 | 7 个附件全部下载，字节数与平台记录一致（55064/190405/3235/3245/3546/5057/9428） |
| 2 | 附件哈希 | 证据包内 11 个证据文件 sha256 与 `hashes-20261107-r5.json` 逐项一致；tar 包内文件与同名独立附件逐字节一致；清单文件自身在包内外一致（清单按构造不含自身哈希，已注明） |
| 3 | 候选身份 | `8bd29c4` 存在于共享对象库，tree `c6f20de7a5e92b6cc41268c8c254a24620388c6f`、父 `eb431cb`，与 admission/gate-result 登记一致；祖先 `9ad2d61`/`85feb8a`/`2e580aa` 均为其祖先 |
| 4 | 集成补丁哈希 | `git diff eb431cb 8bd29c4 \| shasum -a 256` = `93506543…bab3745e`，独立复算一致；且与上轮交付附件 `integration-commit-8bd29c4.patch` 逐字节一致（cmp exit 0）——R5 树候选即上轮已审对象 |
| 5 | 候选改动范围 | 集成补丁仅 7 文件（MAYNE-18 审定三文件、MAYNE-21 对齐两路径、README 索引、集成记录），无 package.json/锁文件/AGENTS/生产 src/schema 改动；6 个冻结文件 sha256 逐项与清单一致 |
| 6 | 完整命令 | 日志首两行为完整 `npm run check` 链，与候选 `8bd29c4` 的 package.json `check` 脚本逐字一致（35 步 + 3 条内联 `node --test`），步骤顺序与日志执行顺序一致 |
| 7 | 真实 exit 0 | `gate-result.json` exit_code 0；`environment.txt` 独立记录 gate-exit=0；日志 35 组汇总 tests 968 / pass 968 / fail 0 / cancelled 0 / skipped 0，与 gate-result 逐项一致；全文无 `✖/✗/not ok/ELIFECYCLE` 失败标记 |
| 8 | 原预算 | 候选 package.json `test:s32-domain --test-timeout=20000` 未改；声明「串行单次、未重试、未改预算」与日志单一完整链一致 |
| 9 | 计时 | gate-result 11:59:32Z→12:17:11Z（1059s）与 environment.txt 逐字一致，差值自洽；admission 登记 11:58:18Z 早于门禁开始；提交 7f536db 时间 12:20:28Z 晚于门禁结束，时间线连贯 |
| 10 | 关键用例 | s32 长路径用例实测 `8827.05225ms`（日志行 1070 与 gate-result 一致），s32 组 28/28 pass |
| 11 | 构建段 | probe:bundle / bundle-smoke / s33-ui-verify / probe:app 均在日志中完成；`Finished release profile in 45.33s` 与声明一致，Sidekick.app 打包成功 |
| 12 | 全链路日志结尾 | 日志 2842 行 / 190405 字节与清单一致；以 `npm notice run … check` 开头、以最后一步 `test:mcp-native-launcher` 组汇总（76/76）结尾，无截断 |
| 13 | 前置与后置 | 三个前置日志（npm ci / prepare-cli lark-cli v1.0.98 / prepare-pi）exit 0 由 environment.txt 承载；prepare-pi 记录 vendor/pi `ad702637`/tree `e89822b0…`——本评审以本树外层仓库 vendor/pi 子树哈希独立交叉核对，等于 `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`，与登记一致；postgate check:docs（20 文件/408 链接）与 check:structure（215 文件/466 引用）✓ 与日志内数值一致 |
| 14 | 负载记录 | load-samples.txt 36 个 30s 采样覆盖门禁全程；起始 8.07、峰值 78.72（12:14:33Z）、结束 25.3 与 gate-result 逐项一致 |
| 15 | 警告分类 | 编译警告（cargo/clippy/rustc/tsc）0 条 `warning:` 行；vite chunk >500kB 建议 2 条（日志行 2388/2711，均出自生产打包，信息级）；`npm notice` 回显 134 条——与 gate-result 分类逐项一致，无未分类新警告 |
| 16 | 报告提交增量 | `7f536db` 父提交即候选 `8bd29c4`；仅 1 文件 `docs/reviews/web-foundation-integration-fullgate-20261107.md`（80 增 0 删），blob sha256 `aa5c9ad6…` 与清单一致；交付补丁附件与 `git format-patch -1 7f536db` 逐字节一致；`git diff --check` 无空白错误 |
| 17 | Git 授权条件与未执行声明 | authorization-package.json：AUTH-GIT-1「conditions evidenced, NOT approved, NOT executed; main untouched」、AUTH-GIT-2 未获批未执行、AUTH-DEP-1 仅建议、AUTH-SCHEMA-1 待并行提案；收紧条件（完整门禁 exit 0 ✓ + 独立评审通过 ✓ + owner 批准仍缺）与派发指示一致 |
| 18 | 未执行的结构性证明 | 本仓库 `refs/heads/main` 仍位于 `9ad2d61`（集成基座），未快进到 `8bd29c4`；`agent/opencode/mayne-22` 分支仅含 `7f536db`+`8bd29c4` 两个提交，无远端同名分支（未 push）——「main 未动、未 push、未晋级」获结构验证 |
| 19 | 旧证据缺失声明 | R1/R1b/R2/R3 旧日志、ui-repro、授权包原文件随旧树删除不可恢复，作者如实声明缺失、未重新生成冒充；本轮日志为全新原始记录（sha256 `bb04e36f…` 已复算） |
| 20 | 授权包重建来源 | authorization-package.json 与 admission.json 均注明「按上轮记录 §6 实质重建」，重建来源可追溯，无冒充原始记录之处 |

## 3. 证据互证关系

- 三层互证：评论声明 ↔ `gate-result.json`/`environment.txt` ↔ 原始日志逐行数值（计时、汇总、关键用例、警告计数）全部对得上。
- 哈希闭环：附件 → 清单 → 提交对象，三向一致；候选补丁同时经「复算」与「上轮附件逐字节」两条路径确认。
- 状态闭环：授权包文字声明 ↔ git ref 实际状态（main 位置、分支内容、远端缺失）互相印证。

## 4. 结论

**通过。** R5 证据链完整自洽：附件哈希、候选/补丁/报告提交哈希、完整命令与真实 exit 0、原预算、全链路日志结尾、警告分类均独立复算一致；`7f536db` 只有报告增量；Git 授权条件与未执行声明一致且有结构性证明。W0 准出的其余条件（owner 具体授权、契约冻结与 MAYNE-23 晋级收口）仍开放，由 Codex 收口；本复核不代其收口、不扩大范围。

## 5. NIT 与边界说明（均不阻塞）

1. **NIT-1（建议命名）**：报告 §6 将 2 条 vite chunk 建议的出处写作「bundle-smoke / probe:app」；按日志行号（2388/2711）实际出自 s33-ui-verify 的生产打包与 probe:app 的生产打包。数量与分类正确，仅打包名称指认不精确，建议作者下次修订时更正（不影响本证据结论）。
2. **说明-1（postgate 退出码）**：门禁后两次守卫复跑的 exit 0 由 ✓ 输出与清单注记承载，未单独落盘退出码文件；充分性可接受，严格化可在下次交付附退出码记录。
3. **说明-2（本树环境）**：本评审树含平台目录 `.kimi/`，MAYNE-18 守卫白名单仅容忍 `.multica/.opencode`，故本树不宜跑 `check:structure`（与 ZCode 在其树 `.zcode/` 的观察同源，属环境现象，与本证据对象无关）。本树已跑 `npm run check:docs` exit 0；未跑结构守卫与完整门禁（按派发边界）。

## 6. 关于历史超时根因的边界

R5 绿证只证明「本轮完整门禁在精确候选 `8bd29c4` 上按原预算通过」。对 R1b/R2/R3 超时（20.4–21.0s，负载 5.8–14.3）的根因，本证据提供的是第三个独立数据点（门禁内 8.83s，期间负载峰值 78.7 为自身编译段），与 ZCode 独立复跑（8.6–9.8s）互证，支持「负载敏感、与改动无关」的既有归因假设；但「纯负载贴近预算」的因果强度仍以三方数据的一致性为限，作者报告 §5「归因闭合」的措辞略强于严格可证范围。鉴于本轮未改预算即取得绿证，该开放项的实际影响已消除；如需更强结论，可在空闲机器复跑长路径用例留存数据。
