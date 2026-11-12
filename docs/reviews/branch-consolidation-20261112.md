# 分支收束与研发进度校准（2026-11-12）

## 范围与结论

用户要求收束所有非 main 分支并校准后续计划；随后明确同意“有效实现入本地主线，过时/草稿只保留可恢复记录与备份，远端动作最后单独确认”。R3 批量整合，从 `1e3704432e7014f1e23b40e9aff9791662e9c6f5` 开始。**本地源码收束已完成**：验证基点 `0c4d439` 已合入本地 main，53个非main本地分支已清理，3个dirty工作区原样保全；远端尚未修改。此结论不关闭 W1 整体验收或发布出口。

53 个本地非 main 分支已逐项盘点。它们不等于 53 项独立功能：许多是共同基座、重复评审或自动快照。两个远端仅 origin 有一个非 main 分支；origin/main 为本轮起点，github/main 为 `e91bbc1`。本轮不访问真实业务凭据、用户根或外部平台任务状态。既有完整门禁允许 macOS Keychain 的随机 fixture 条目写读删，严格不读既有业务条目；它只证明合成适配路径。

## 采用的实现与冲突取舍

| 主题 | 采用来源 | 取舍与边界 |
|---|---|---|
| 文本整理／Rust 存储与 004 | `8b6052b`（33） | 承接其后端、存储、台账与已批准字节；API2 后端再叠加35修订 |
| API2 后端与退出证据 | `a0a4ec2`（35） | 最新作者修订仍有两项可复现恢复缺陷，本轮补回归后修复；原作者通过不冒称独立通过 |
| Web 生产装配 | 33 的 Workbench、models/agents stores | 35/37/38 缺这三处，不按整树覆盖回退 |
| 任务控制／候选键 | `d7688fb`（37） | CandidateCard operationId 行为保留；API2 客户端接38 |
| API2 浏览器／快照 | `329ea3f`（38） | 精确候选已有独审 pass，范围不外推后端组合 |
| 真实 HTTP 测试配置 | `8aaf8c5`（OhMyPi 24）与35测试的三方合并 | 补齐合法模型配置夹具；保留004、API2、队列与后续修订，不重复维护非法 DTO |
| 构建／守卫／门禁 | 37 + 33 + 本轮并集 | runtime 闭包、003与004冻结及各自正/负例都保留；接齐实际新增套件 |
| 历史评审 | 各分支唯一 review blob | 原字节保存在 bundle；3份含本机私有路径的新增副本显式脱敏，其余原字节接收；同路径异字节另存 `-variant-<blob>`，不改写历史结论 |
| 任务平台导出／旧探针草稿 | 仅备份 | root JSON、work/压缩日志和失效探针不加入生产树；不使用 ours 假合并 |

来源细表和每文件 blob 清单存于本地 `build/branch-consolidation-20261112/` 的 `branch-inventory.json`、`source-provenance.json`、`review-provenance.json`。备份与原始证据不入库。

## 备份、恢复与独立闸门

- 全 refs bundle 大小 31,490,864 bytes；另外保存5个 detached HEAD bundle、dirty binary patch、index patch、untracked tar 与 SHA-256 清单。3个 dirty 工作区的原内容保持不动。
- **实际恢复演练通过**：隔离 bare 仓库导入并核对117个 refs、5个 detached HEAD；导出原HEAD、应用补丁/解包后比对5个 dirty 文件，0差异。37个备份文件 SHA-256 核对0差异；原始命令与恢复结果见 ignored `backup/`、`restore-check/result.json`。首次恢复命令的绝对目录 patch 应用失败保留，改为隔离仓库内应用后通过。
- 两面计划独审均先提出修订，再对修订后的计划给出 APPROVE。A面发现两项P1恢复缺陷、缺失的三文件接线与守卫并集；B面要求最终冻结树由独立验证方执行完整门禁。发现项全部纳入，不由整合者自签。
- 本轮未改新 DDL、未添加依赖；003 `8e4e3159…7870`、004 `5de175b6…c5bf`、API1 `61863271…f58d` 与 API2 `449bf0b0…f2cd` 保持原字节。历史 D/E 授权依据是仓库材料引用的 `01a1c890` 与决策包 `9f29189e…`，未独立回读外部原评论。

## 缺陷与验证检查点

| 检查 | 实际结果 | 范围 |
|---|---|---|
| 新增真实存储恢复回归 | 修前15/15失败，修后15/15通过 | open/closed park、取消意图、暂存成功/失败、重复扫描、并发、旧attempt围栏、拒绝不误计成功 |
| `npm run check:structure` | exit 0，003/004原字节与缺失/篡改负例全部通过 | 不绕过守卫 |
| `npm run test:web-task-controls` | 23/23，exit 0 | API2 合法夹具；原业务断言保留 |
| `npm run test:web-api-v2` | 51/51，exit 0 | 规范形状、拒绝旧版本、快照与浏览器证据披露 |
| 首轮组合 `test:web-text-intake` | 209/247通过、38失败，exit 1 | 暴露遗漏的OhMyPi合法配置、旧API/快照夹具及旧ACK前提；失败保留，不以旧分支通过代签 |
| `test:web-candidate-operations` | 22/22，exit 0 | 当前 API2 后端的真实HTTP及生产CandidateCard浏览器旅程 |
| `test:web-exit-evidence` | 37/37，exit 0 | 登记域生产、消费、持久化失败与归属 |
| 队列＋生产工作台浏览器聚焦 | 26/26，exit 0 | 1440/640、配对/会话、真实UI粘贴→候选与队列；受控模型 |
| A 面修复与装配复核 | APPROVE；独立恢复回归15/15，capability UI聚焦9/9 | 对照指定来源和修复；未代签完整门禁 |
| 受控模型正常／故障矩阵 | 16/16，exit 0 | 真实Pi、无候选半成品、规范错误与未知副作用核对；真实模型未验 |
| 首轮独立完整门禁（`8a7d90a`） | exit 1；56组中7过，第8组 s31-domain 182/183，后48未执行 | 原Pinia集成仍注入Tauri；生产默认已接Web。域工厂的迟到/未知结果回归保留，将该集成改为真实默认Web配置与试跑未接通边界 |
| 第二轮独立完整门禁（`7b8d4c6`） | exit 1；第11组 desktop-controls 的构建夹具缺 parser 导出，后45组未执行 | 补齐现行纯证据解析器导出及空队列/并发合法fixture，不改生产实现与UI断言 |
| 第三轮独立完整门禁（`b610984`） | exit 101；前16组过，第17组 check:pet-ui 因3条Clippy错误失败，后39未执行 | 本机Rust1.99.1新增静态判据；删除无效u64 cast、两处等价as_chunks写法；最低Rust1.89不变；聚焦check:pet-ui exit0 |
| 第四轮独立完整门禁（`66cd13b`） | exit101，646.095秒；第38组 probe:native 336过/1失败/3ignored，后18未执行 | 自建验证工作区的target缓存符号链接导致进程启动命令与canonical exe不符。改为物理构建目录，同源码host-crash矩阵1/1通过；未放宽归属断言 |
| 产物根入库守卫补缺 | 新自测修前exit1，修后结构守卫exit0 | 缓存链接曾被Git按根文件收录，原规则只禁目录后代；移除链接跟踪并禁止4种产物根自身，保留target-source反控。最终整合树重新生成在原main之上，不携带含本机链接的中间提交 |
| 第五轮独立完整门禁（`8415872`） | exit1，842.054秒；前50组过，第51组手工事项55/59，后5未执行 | 4个API1正控未接API2：物理target修正及host-crash已验证，Rust337/0/3、两包/签名/后端均通过；更新正控版本，不变业务断言 |
| 构建工具链新增警告 | rust-objcopy缺`@rpath/libLLVM.dylib`，7次debug stripping SIGABRT；构建仍exit0 | 已定位本机Rust1.99.1配套库缺失；不改profile绕过，不擅自更改全局工具链。符号剥离及发布验证保持开放；最小补验为修复工具链LLVM配套库后，在物理干净target重建两包（probe:app/build:backend）并核对符号、签名和包排除 |
| 末段全部6脚本预验 | 439/439，exit0 | 手工59＋文本247＋任务23＋候选22＋API2 51＋退出37；串行使用与完整链相同脚本，不能代替完整check |
| 第六轮最终独立完整门禁（`0c4d439`） | **exit0，947.527秒，56/56无短路**；Node41汇总块1407/1407/0；Rust主库337/0/3 ignored；末段Web439/439 | 独立B结论pass（本地源码收束）；4926个tracked文件哈希零漂移、工作区干净、不可变字节与只读区/依赖/产品01–04/旧路径均通过 |
| 本地Git收尾 | main快进至已验版本；53分支删除；仅main；当前工作区干净；3个dirty原内容再比对零差异 | 先复核53refs、37备份哈希和工作区状态，再detached四个clean team工作区、移除两处不存在的锁定登记，最后删除分支；未删已有工作目录或dirty内容 |

故障矩阵的旧 `failed` 断言经独立裁决按 API1 §4.6／API2 保留规则适配：无法证明副作用安全时必须等待最终 `needs_review`，并严格检查 `failure_unknown_side_effect`、`autoResume=false`、退出已确认与权威失败码；不放过暂态 failed，不通过授予 proven_safe 求绿。

闭合恢复只确认已验证的退出并释放槽位；外部副作用未知仍保持人工核对、原暂存结局不被覆盖，取消意图保留。已确认过的任务不重复扫描推进版本；并发或旧版本失去前提时不得误报 recovered。

## 全部分支处置清单

“替代”表示该分支有效成果已由所列组合承接，未采用的历史差异留在已验证备份；不宣称其每个旧 tip 都是主线祖先。以下指针按盘点时冻结，删除前重读漂移。本地删除已按此清单全部完成，具体操作回执见下节。

| 本地分支 | 原 tip | 独有提交／变更文件 | 处置 |
|---|---|---|---|
| `agent/claude/mayne-17` | `b190f7c6` | 8／4 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/claude/mayne-19` | `9d094d39` | 0／0 | 起点 main 已包含，可清理 |
| `agent/claude/mayne-20` | `5cd35388` | 0／0 | 起点 main 已包含，可清理 |
| `agent/claude/mayne-21` | `7b3ef31d` | 0／0 | 起点 main 已包含，可清理 |
| `agent/claude/mayne-24` | `31434282` | 17／29 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/claude/mayne-30` | `d70280c4` | 143／132 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/claude/mayne-31` | `29f2ac86` | 73／102 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/claude/mayne-33` | `8b6052b5` | 149／137 | 采用文本整理／存储／台账及三文件Web装配 |
| `agent/claude/mayne-35` | `a0a4ec27` | 8／133 | 采用API2后端＋真实恢复回归修复 |
| `agent/claude/mayne-37` | `d7688fbb` | 80／108 | 采用候选操作／工程接入，客户端由38接续 |
| `agent/claude/mayne-38` | `329ea3f9` | 6／48 | 采用最新API2客户端及浏览器证据披露 |
| `agent/claude/mayne-39` | `74b88cf3` | 2／100 | 平台审计导出仅归档，不纳入生产树 |
| `agent/codex/mayne-19` | `2e580aa4` | 0／0 | 起点 main 已包含，可清理 |
| `agent/codex/mayne-20` | `77fc6bc3` | 6／5 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/codex/mayne-21` | `ffbfb73c` | 2／8 | W0/原型旧候选已由main或新组合替代；保留独有评审 |
| `agent/codex/mayne-30` | `a177d924` | 3／2 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/codex/mayne-31` | `33068e48` | 4／3 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/codex/mayne-33` | `884be30a` | 6／5 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/codex/mayne-35` | `695619a9` | 8／7 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/codex/mayne-38` | `fd4df34d` | 2／1 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/hermes/mayne-24` | `f22a08f9` | 27／24 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/hermes/mayne-32` | `b34c3eeb` | 2／1 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/kimi/mayne-17` | `43433ae5` | 6／11 | W0/原型旧候选已由main或新组合替代；保留独有评审 |
| `agent/kimi/mayne-20` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |
| `agent/kimi/mayne-20-1dee4da98ee6` | `238ab813` | 2／3 | 旧探针草稿被W0替代，仅归档 |
| `agent/kimi/mayne-23` | `2528121f` | 2／2 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/kimi/mayne-24` | `3ee282e7` | 82／78 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/ohmypi/mayne-17` | `27728f50` | 6／10 | W0/原型旧候选已由main或新组合替代；保留独有评审 |
| `agent/ohmypi/mayne-21` | `edc8022a` | 2／8 | W0/原型旧候选已由main或新组合替代；保留独有评审 |
| `agent/ohmypi/mayne-23` | `d4a390ba` | 9／7 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/ohmypi/mayne-24` | `8aaf8c50` | 36／27 | 采用合法配置及真实HTTP测试修订；前端由38承接 |
| `agent/opencode/mayne-17` | `9ad2d61e` | 0／0 | 起点 main 已包含，可清理 |
| `agent/opencode/mayne-18` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |
| `agent/opencode/mayne-18-77944aa22df7` | `3427560b` | 2／3 | W0/原型旧候选已由main或新组合替代；保留独有评审 |
| `agent/opencode/mayne-23` | `1e370443` | 0／0 | 起点 main 已包含，可清理 |
| `agent/opencode/mayne-24` | `c9a3246e` | 65／101 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/opencode/mayne-31` | `c944e6ce` | 69／101 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/opencode/mayne-35` | `2394a245` | 3／56 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/opencode/mayne-37` | `d8522e20` | 77／108 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/opencode/mayne-38` | `b0b79146` | 2／48 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/pi/mayne-24` | `2e8b5d53` | 22／18 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/pi/mayne-33` | `db368b5b` | 2／1 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/zcode/mayne-17` | `47d5efaa` | 6／5 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/zcode/mayne-20` | `ab77b8ff` | 5／4 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/zcode/mayne-21` | `af9711ad` | 3／0 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/zcode/mayne-23` | `36afeed4` | 8／7 | 历史评审／契约材料保留；旧元数据不驱动当前状态 |
| `agent/zcode/mayne-24` | `25b7f69b` | 136／130 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/zcode/mayne-24-recovery-authority-fix` | `b4aea55d` | 81／77 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `agent/zcode/mayne-30` | `5623faee` | 139／131 | 由33/35/37/38最新组合承接；保留独有评审及备份 |
| `team/w0-contract` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |
| `team/w0-gate` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |
| `team/w0-storage` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |
| `team/w0-ux` | `85feb8aa` | 0／0 | 起点 main 已包含，可清理 |

## 进度校准与后续

当前仍是 W1 收口，后续按[实施计划](../product/05-第一阶段实施计划.md)的单一队列推进。W2–W5/D1 的 Web／OS／Linux 出口保持开放，真实模型／飞书／钥匙串／用户根均未在本轮验证。分支收束只证明工程基线统一，不等同于业务全部交付。

## 最终证据、警告与Git回执

- 已验证源码提交：`0c4d439051892678645e46a936e83d2029445532`；tree `c8f58b0adb152deb5a8c116a8cde83a9af881de4`。其祖先只含原main后的两个清洁提交，不携带中间缓存链接提交。后续仅登记事实文档，生产/测试/构建源码与此版本逐字核对。
- 独立B回执：本地 `build/branch-consolidation-20261112/b-verification-6/summary.md`、`verification-verdict.json`、`full-check-result.json`、`evidence-sha256.json`；全量源码manifest SHA-256 `769a5394…3bdb5`。Node1407是41次汇总块的执行统计，Web439是其子集，不重复相加；Rust主库337通过/3忽略，其他特性过滤执行块不当作独有用例累加。
- 警告分类：既有Runtime体积提示14处、Vite体积提示3次构建、未公证提示2处；已归因rust-objcopy/LLVM工具链缺库仍有7处输出。没有新增未归因类别；符号剥离和可发布包出口保持开放。本次不是发布GO。
- Keychain真实OS调用限随机自有 `com.sidekick.s0.fixture.*` 合成条目，写读删与清理断言通过；真实业务凭据、真实模型、飞书及用户工作根未验证。Linux、完整W1产品旅程与D1原生出口继续按实施计划排队。
- 本地回执 `build/branch-consolidation-20261112/local-closeout.json`：53分支、37备份哈希、3个dirty内容删除前均重验；当前本地仅main、工作区干净。四个旧team工作区保留数据并转detached，原有detached工作区内容保持。
- **持久恢复备份**另存 `.git/branch-archives/20261112/`（37份原备份哈希全部匹配），不依赖构建目录留存；原始恢复演练和日志仍在 `build/branch-consolidation-20261112/`。本机绝对路径和原始平台导出只留本地备份；入库3份历史副本已显式脱敏。
- 远端检查仍是起点：origin/main `1e37044`，github/main `e91bbc1`，origin唯一任务分支 `agent/zcode/mayne-24-recovery-authority-fix`=`b4aea55`。推送及远端删除按仓库对外状态规则留待用户最终确认。

### 主工作区收尾复核

本地主线接收后，`npm run build:backend` **exit0**，主工作区的前端、Rust存储适配及真实Pi Runtime闭包已刷新（存储二进制2,664,496 bytes，随包Node121,911,744 bytes）。`npm run check:docs` exit0（23文件/981本地链接），`npm run check:structure` exit0（313源文件/696引用，含003/004与产物根自测），`git diff --check`通过。与已验`0c4d439`比较，生产、测试、构建、依赖与只读资源零字节差异；后续仅事实文档登记。本地分支实际仅main，当前主工作区干净，未提交工作所在三个原工作区保持原样。
