# 评审记录与证据索引

> 本目录保存各切片的评审／验证记录与**精选**证据，用于回溯“当时做了什么、证明了什么、还差什么”。它不是当前状态源——当前实施状态见 [第一阶段实施计划](../product/05-第一阶段实施计划.md)。
> 记录与证据按当时版本保留：路径、哈希、命令均不因后续结构调整而改写。要复核历史内容，用 `git show <commit>:<path>` 取当时版本，不按当前工作区重算哈希。

## 1. 留存策略

- **记录命名**：`<slice>-<YYYYMMDD>.md`，与同名证据目录配对；早期目录命名不同，见第 3 节。
- **原始证据默认不入库**：中间日志、批量截图、临时产物放 `build/<slice>/`（已在 `.gitignore`），可重建、可覆盖。
- **入库只收精选主证据**：足以让第三方复核结论的最小集合（证据 JSON／摘要、关键命令日志、关键截图、哈希清单）。完整原始日志留在 `build/`，记录里写明路径与取舍。
- **不删除历史**：已提交的记录与证据不删除、不改写结论。纠错用追加说明或新记录；新记录不覆盖旧结论。
- **必备字段**：范围与风险级、基点 commit、实际命令与退出码、通过／失败计数、未验证项、结论（pass／needs_revision／reject 或限定的验收结论）。
- **索引强制**：新增记录必须登记到本文件；未登记视为未收口。`check:docs` 只校验链接存在，语义一致性靠评审。
- **新路径**：2026-10-31 结构治理后，新记录使用新路径（`runtime/{entries,lib,workers}/`、`src-tauri/src/{app,store,host,diagnostics}/`、`tests/{unit,integration,probes,fixtures}/`、`scripts/{build,checks,probes}/`）；旧记录保留原路径，按文件名仍可检索。

## 2. 记录索引（101 份）

| 记录 | 日期 | 范围与结论 | 证据 |
|---|---|---|---|
| [web-manual-items-integration-20261108.md](web-manual-items-integration-20261108.md) | 2026-11-08 | MAYNE-23 W1 最终集成（OpenCode，唯一集成执行者）：三候选完整经审链自基点 `6546990` 逐字节接入（I `4ca93440`、II `19418ef`、III `133a2a1`，补丁/树哈希全部复算相符，交叉 diff 证 I/II 范围零偏离），五份审查记录按原路径 blob 级接收，契约附录A 仅转录两次协调裁定（纯追加，新哈希 `32910de7…` 登记），评审索引 91→101；完整 `npm run check` 在冻结提交上串行执行，结果以回执为准；main/状态未动，浏览器旅程独立验收另派 | 原始证据 `build/web-manual-items-integration/`（gitignored，含 admission.json 与编号取证） |
| [web-manual-items-engineering-20261108-zcode-review.md](web-manual-items-engineering-20261108-zcode-review.md) | 2026-11-08 | W1 III 工程候选独立审查（ZCode `3e8d310`）：通过——patch/format-patch `4109daa9` 逐字节复核，冻结哈希全验（含授权清单 `452dc436→242ea3db` delta＝2 hunk），4/4 接收 P1/P2 记录 blob 级一致；守卫自测/正负例、builder 7 合成用例、package.json 增量恰三脚本＋check 尾接入；1 NIT＋2 观察不阻断；真实 build:backend/test:web-manual-items/完整门禁显式留集成 | 见记录 |
| [web-manual-items-tests-20261108-ohmypi-r2-review.md](web-manual-items-tests-20261108-ohmypi-r2-review.md) | 2026-11-08 | W1 II 修订候选独立复审（OhMyPi R2 `ad90915`）：通过——F-1/F-2/F-3 以可证伪正反例关闭（真实 SQLite/静态服务器/headless Chrome+CDP），CDP 与失败清理生命周期 12/12，线格式固定为 `pairingCode`/`csrfToken`/`X-CSRF-Token` 无环境覆盖，断言计数不降、预算未放宽；4 项观察不阻断交集成轮 | 见记录 |
| [web-manual-items-tests-20261108-ohmypi-review.md](web-manual-items-tests-20261108-ohmypi-review.md) | 2026-11-08 | W1 II 首轮独立审查（OhMyPi `fe8ac7b`）：退修——F-1 共享实例全局/逐事项事件计数永假断言、F-2 hash 资产选择器误配 MIME、F-3 真实 dist 浏览器模式缺挂载/可达性/溢出断言；五项接口假设对照冻结契约核出两项待裁定 | 见记录 |
| [web-manual-items-tests-20261108-r2.md](web-manual-items-tests-20261108-r2.md) | 2026-11-08 | W1 II 修订交付（Kimi `19418ef`，链 `c24dc4a→2110cd1→19418ef`）：F-1/F-2/F-3 修复＋线格式固定＋失败清理＋CDP 真实 dist 断言＋非秘密生效配置证据；修订 diff `97dfd92a…`、format-patch `e585b642…`；本机仍为前置缺口验证（缺 I/III 产物），业务执行留集成 | 见记录 |
| [web-manual-items-tests-20261108.md](web-manual-items-tests-20261108.md) | 2026-11-08 | W1 II 首轮交付（Kimi `c24dc4a`）：三套件＋夹具按冻结契约与九条矩阵编写，业务走真实 HTTP、观测只读合成库；基点缺 I/III 产物，全部 PrerequisiteGap 如实申报，无业务 pass 代签 | 见记录 |
| [web-manual-items-implementation-20261108-zcode-r2-review.md](web-manual-items-implementation-20261108-zcode-r2-review.md) | 2026-11-08 | W1 I 退修限定复审（ZCode R2 `4889f87`）：通过——增量身份逐字节一致（`d3a01ce3`/`ff79d46b`，4 文件 +153/−17）；MAJOR-1 四写路径实测关闭（重建竞争驱动 117/117，旧版 56/110 复现幽灵链），OBS-2 判别用例两向证实，CLI MINOR-1 新旧对照消除；Rust 全套/完整门禁显式未验（零 Rust 文件） | 见记录 |
| [web-manual-items-implementation-20261108-zcode-review.md](web-manual-items-implementation-20261108-zcode-review.md) | 2026-11-08 | W1 I 首轮独立审查（ZCode `12d42f2`）：不通过（限一处 MAJOR）——并发败者提交幽灵历史事件（修正重试永久 409）；其余增量全部独立核实（24 文件全在 I 清单、fmt/clippy/store 11/schema 18/lib 323 串行全绿、真实 HTTP 驱动 51/54）；身份矛盾判定为陈述笔误，MINOR-1 CLI 登记随修 | 见记录 |
| [web-manual-items-implementation-20261108-opencode-params-review.md](web-manual-items-implementation-20261108-opencode-params-review.md) | 2026-11-08 | W1 I 参数增量独立审查（OpenCode `a5708d5`）：`74c023c..4052d47` 通过——pairingCode/csrfToken/X-CSRF-Token/status/limit 按裁定逐项复核，真实 HTTP 86/86 断言，单测 11/11；1 NIT＋2 观察非阻断 | 原始证据 `build/web-manual-items-params-review/`（gitignored） |
| [web-manual-items-implementation-20261108.md](web-manual-items-implementation-20261108.md) | 2026-11-08 | W1 I 首轮交付（Claude 链至 `74c023c`）：server 六库＋entry、002 迁移、Rust store/bin、前端 pairing/web-api-client/todos 接线、单测与最小 desktop-controls 适配；哈希/冻结如实申报，后续经参数增量 `4052d47` 与退修 `4ca93440` 修订（见 R1/R2 记录） | 见记录 |
| [web-manual-items-engineering-20261108.md](web-manual-items-engineering-20261108.md) | 2026-11-08 | MAYNE-23 W1 III 工程候选（OpenCode）：结构守卫按批准 A–D 落地（`server/`＋`src-tauri/src/bin/` 收敛、server 层引用/裸依赖规则、002 精确哈希 `b6cb8e61…f97e` 冻结与自测正/负例）、`build-backend.mjs`（打包规则双重强制）、package 三脚本与 check 接入、公共文档更新与已审记录/契约接收（哈希逐字核对）；聚焦验证自测/docs/diff 全过，仓库模式守卫仅剩 002 待集成一条预期违规；真实打包与完整门禁留集成轮 | 原始证据 `build/web-manual-items-engineering/`（gitignored，含 admission.json 与合成打包用例） |
| [web-manual-items-authorization-20261108.md](web-manual-items-authorization-20261108.md) | 2026-11-08 | W1 P1 最终授权清单（Claude `19045b8`，ZCode R2 通过后定稿）：逐文件写入清单、002 DDL `b6cb8e61…f97e` 与 A–D 申请；本轮由工程候选接收并按批准事实追加 §12 实施准入登记（owner `01a1b80b` 批准 A–D），§3/§10 保留申请原文 | 见记录 |
| [web-manual-items-contract-20261108-zcode-r2-review.md](web-manual-items-contract-20261108-zcode-r2-review.md) | 2026-11-08 | W1 P1 修订版独立复审（ZCode R2 `c0f88f6`）：通过——B1 镜像 UPDATE 五用例实证、M1 删除读写与重放顺序闭环、M2 事项提示帧与任务 cursor 隔离、M3 同源静态/构建/测试清单闭合；m1–m7/n1–n7 处置属实，MINOR-1/NIT×3 登记为非阻断 | 见记录 |
| [web-manual-items-contract-20261108-zcode-review.md](web-manual-items-contract-20261108-zcode-review.md) | 2026-11-08 | W1 P1 首轮独立评审（ZCode `2706044`）：不通过——1 阻断（002 缺 schema_meta 镜像）＋3 主要（删除读取矛盾、事项 SSE 补偿未定义、同源静态缺位），修订量小；身份/引用/授权对应全部核实 | 见记录 |
| [web-manual-items-readiness-20261108-ohmypi-review.md](web-manual-items-readiness-20261108-ohmypi-review.md) | 2026-11-08 | W1 P2 独立审阅（OhMyPi `f031e21`）：通过（无阻塞项）——四项基座差距从精确基点独立重建成立，九条验收矩阵来源/观测/反例逐条核对，命令与授权判断有据 | 见记录 |
| [web-manual-items-readiness-20261108.md](web-manual-items-readiness-20261108.md) | 2026-11-08 | W1 P2 启动准备（Kimi `d94de69`）：实际基座差距（HTTP 服务、事项端点、事项表、浏览器传输四项空白）＋九条浏览器验收矩阵＋可复用/拟新增命令与授权缺口，作为实施输入，不视作已实现 | 见记录 |
| [web-foundation-integration-schema-final-integration-20261107.md](web-foundation-integration-schema-final-integration-20261107.md) | 2026-11-07 | MAYNE-22 W0 最终集成（OpenCode，唯一重门禁执行者）：在通过审查的准备候选 `882e6e3` 上逐字节接入已复核 F-1 修订 `cab73aa`（补丁 `99706d93…ae587`）与 ZCode/Kimi 两份复核记录，四生产文件与 `cab73aa` blob 级一致；修正链接计数 20/414→20/424，公共文档 F-1 状态更新且不预签门禁；冻结前聚焦验证全过（17/17、structure、docs、diff --check），原预算完整 `npm run check` 在冻结提交上串行执行、结果以回执为准 | 原始证据 `build/web-foundation-integration/`（gitignored） |
| [web-foundation-integration-schema-implementation-20261107-zcode-f1-review.md](web-foundation-integration-schema-implementation-20261107-zcode-f1-review.md) | 2026-11-07 | MAYNE-22 F-1 修订增量独立复核（ZCode）：`67860d3..cab73aa` 通过——增量恰 3 文件 +161/−3、补丁 `99706d93…ae587` 复算一致、DDL 审定哈希不变；同一合成反例修前复现（受写字节 18/19/27/95）、修后 open/init 拒绝零写入，17/17 真树复跑；N-1–N-4 维持登记不修 | 见记录 |
| [web-foundation-integration-schema-integration-prep-20261107-kimi-review.md](web-foundation-integration-schema-integration-prep-20261107-kimi-review.md) | 2026-11-07 | MAYNE-22 集成准备候选独立审查（Kimi）：`b11fd05..882e6e3` 通过（限准备增量）——补丁 `2a04c62b…7641` 逐字节复核，审定来源 blob 级接收、W0 基座零覆盖、守卫仅新增指定冻结且正/负例独立复现、文档真实状态保留；1 项不阻塞 NIT（docs 计数 414 陈旧，本集成轮已修正） | 见记录 |
| [web-foundation-integration-schema-integration-prep-20261107.md](web-foundation-integration-schema-integration-prep-20261107.md) | 2026-11-07 | MAYNE-22 W0 最终集成准备（与 F-1 修正并行）：隔离树逐字节接入已审候选 `67860d3`、`598d2da` 最终提案与全部审查记录；结构守卫冻结新迁移精确哈希 `8511907c…143d` 并补原地自测正/负例；聚焦检查全过（structure 215/466 exit 0、self-test、docs 20/424）；完整门禁与合入未发生，F-1 修订待接入 | 原始证据 `build/web-foundation-integration/`（gitignored） |
| [web-foundation-integration-schema-implementation-20261107-zcode-review.md](web-foundation-integration-schema-implementation-20261107-zcode-review.md) | 2026-11-07 | MAYNE-22 schema 实施独立评审（ZCode）：候选 `67860d3` 通过——补丁/源码哈希复算一致，19 场景证伪全过；登记 1 项 MINOR（F-1 拒绝路径 WAL 改写）与 4 项 NIT，均不阻塞 | 见记录 |
| [web-foundation-integration-schema-implementation-20261107.md](web-foundation-integration-schema-implementation-20261107.md) | 2026-11-07 | MAYNE-22 schema 实施记录（Claude）：web-backend/1 四文件交付（`67860d3`），显式 init/普通 open 校验、原子迁移、每连接设置与一致性备份；聚焦 cargo 验证全过，完整门禁留给集成执行者 | 原始证据见原树 `build/`（附件留存于任务） |
| [web-foundation-integration-main-ff-20261107-kimi-review.md](web-foundation-integration-main-ff-20261107-kimi-review.md) | 2026-11-07 | MAYNE-22 main 快进与守卫/公共文档增量独立审查（Kimi）：`7f536db..b11fd05` 五文件增量通过，补丁 `e5f6eb99…` 逐字节复核；登记 5 项不阻塞观察（含新 lineage 迁移当时无字节冻结，本批准备轮已补） | 见记录 |
| [web-foundation-integration-schema-authorization-20261107-zcode-r2-review.md](web-foundation-integration-schema-authorization-20261107-zcode-r2-review.md) | 2026-11-07 | MAYNE-22 schema 授权提案修订增量独立复核（ZCode R2）：提案 `bc8876c3…`、DDL `8511907c…` 与裁定八项全部落实，独立 21/21 exit 0，通过 | 见记录 |
| [web-foundation-integration-schema-authorization-20261107-zcode-review.md](web-foundation-integration-schema-authorization-20261107-zcode-review.md) | 2026-11-07 | MAYNE-22 schema 授权提案首轮独立评审（ZCode）：提案通过并附两项批准前条件（唯一索引/版本镜像），由 R2 复核闭合 | 见记录 |
| [web-foundation-integration-schema-authorization-20261107.md](web-foundation-integration-schema-authorization-20261107.md) | 2026-11-07 | MAYNE-22 schema 授权最终提案（`598d2da`）：全新建表 web-backend/1 lineage、11 表 DDL `8511907c…143d`、校验与备份契约；经 owner 评论 `01a1b648` 批准后由 `67860d3` 实施 | 见记录 |
| [web-foundation-integration-main-ff-20261107.md](web-foundation-integration-main-ff-20261107.md) | 2026-11-07 | MAYNE-22 W0（owner 新授权后）：干净本地 main 仅快进 `9ad2d61`→`8bd29c4`（tree 互证一致、无新提交、未 push）；结构守卫核实为无需改动并以合成树正/负例实证；公共文档按已授权/正在实施/已验证区分更新，新 schema 未提前签完成；聚焦检查全过，完整门禁留给最终集成轮 | 原始证据 `build/web-foundation-integration/`（gitignored） |
| [web-foundation-integration-fullgate-20261107.md](web-foundation-integration-fullgate-20261107.md) | 2026-11-07 | MAYNE-22 W0 R5（本轮补登记）：候选 `8bd29c4` 上原预算完整 `npm run check` exit 0（968/968，s32 长路径 8.83s），Kimi 独立复核证据通过；当时写入清单不含索引，本轮补登 | 原始证据 `build/web-foundation-integration/`（gitignored） |
| [web-foundation-integration-20261107.md](web-foundation-integration-20261107.md) | 2026-11-07 | MAYNE-22 W0 集成：MAYNE-18 门禁修复按审定补丁接入基座（三文件与候选逐字节一致）；任务面板占槽/退出核实语义按已接受 attemptExitState 契约对齐并动态复现（退出未知仍占槽、决议闸门、释放后领取正确空闲槽、恢复闸门与焦点/窄屏不回归）；聚焦门禁全过，完整门禁因机器高负载在既有 s32 长路径测试如实失败开放 | 原始证据 `build/web-foundation-integration/`（gitignored） |
| [web-contract-independent-review-round9-20261107.md](web-contract-independent-review-round9-20261107.md) | 2026-11-07 | MAYNE-19 第九轮验收收口：接收候选 `9d094d3`（JSON 字节未变，仅元信息适用范围）；契约 web-api/1 定稿 | 见记录 |
| [web-contract-rework-round8-20261107.md](web-contract-rework-round8-20261107.md) | 2026-11-07 | MAYNE-19 第八轮修订：仅规范文本一处（attemptExitState 口径），返工记录 | 见记录 |
| [web-contract-independent-review-round8-20261107.md](web-contract-independent-review-round8-20261107.md) | 2026-11-07 | MAYNE-19 第八轮聚焦复审：候选 `6e8b56a`（3 文件） | 见记录 |
| [web-contract-rework-round7-20261107.md](web-contract-rework-round7-20261107.md) | 2026-11-07 | MAYNE-19 第七轮修订返工记录 | 见记录 |
| [web-contract-independent-review-round7-20261107.md](web-contract-independent-review-round7-20261107.md) | 2026-11-07 | MAYNE-19 第七轮聚焦复审：候选 `369ce00`（6 文件） | 见记录 |
| [web-contract-rework-round6-20261107.md](web-contract-rework-round6-20261107.md) | 2026-11-07 | MAYNE-19 第六轮修订返工记录 | 见记录 |
| [web-contract-independent-review-round6-20261107.md](web-contract-independent-review-round6-20261107.md) | 2026-11-07 | MAYNE-19 第六轮独立复审：候选 `bd374a1`（10 文件） | 见记录 |
| [web-contract-rework-round5-20261107.md](web-contract-rework-round5-20261107.md) | 2026-11-07 | MAYNE-19 第五轮修订返工记录 | 见记录 |
| [web-contract-independent-review-round5-20261107.md](web-contract-independent-review-round5-20261107.md) | 2026-11-07 | MAYNE-19 第五轮独立复审：候选 `307c7b9`（11 文件） | 见记录 |
| [web-contract-rework-round4-20261107.md](web-contract-rework-round4-20261107.md) | 2026-11-07 | MAYNE-19 第四轮修订返工记录 | 见记录 |
| [web-contract-independent-review-round4-20261107.md](web-contract-independent-review-round4-20261107.md) | 2026-11-07 | MAYNE-19 第四轮独立复审：候选 `d29bccc`（25 文件） | 见记录 |
| [web-contract-rework-round3-20261107.md](web-contract-rework-round3-20261107.md) | 2026-11-07 | MAYNE-19 第三轮修订返工记录 | 见记录 |
| [web-contract-independent-review-round3-20261107.md](web-contract-independent-review-round3-20261107.md) | 2026-11-07 | MAYNE-19 第三轮独立复审：候选 `b08bf02`（38 文件） | 见记录 |
| [web-contract-rework-20261107.md](web-contract-rework-20261107.md) | 2026-11-07 | MAYNE-19 第二轮修订（返工）记录，配套 `tests/fixtures/web-contract/` | 见记录 |
| [web-contract-independent-review-20261107.md](web-contract-independent-review-20261107.md) | 2026-11-07 | MAYNE-19 第二轮独立复审：候选 `7ade737` | 见记录 |
| [web-contract-revision-20261107.md](web-contract-revision-20261107.md) | 2026-11-07 | MAYNE-19 第一轮修订记录（契约与 fixture） | 见记录 |
| [web-contract-independent-review-20261106.md](web-contract-independent-review-20261106.md) | 2026-11-06 | MAYNE-19 第一轮独立复核：候选 `9750467`（23 文件） | 见记录 |
| [web-contract-20261106.md](web-contract-20261106.md) | 2026-11-06 | MAYNE-19 初版 W0 Web API 契约与样例交付记录 | 见记录 |
| [backend-foundation-20261107-r4.md](backend-foundation-20261107-r4.md) | 2026-11-07 | MAYNE-20 第五轮作者侧记录（候选 `5cd3538`），随后 ZCode R3 独立复审 APPROVE 并收口 | 原始证据见记录 |
| [backend-foundation-20261107-r3.md](backend-foundation-20261107-r3.md) | 2026-11-07 | MAYNE-20 第四轮修订作者记录（`fa88332`），被 Codex 复审 BLOCK 后由 r4 取代；历史保留 | 见记录 |
| [backend-foundation-20261107-r2.md](backend-foundation-20261107-r2.md) | 2026-11-07 | MAYNE-20 第三轮修订作者记录（`a17a6b4`），被 Codex 复审 BLOCK 后由 r3 取代；历史保留 | 见记录 |
| [backend-foundation-20261107.md](backend-foundation-20261107.md) | 2026-11-07 | MAYNE-20 第二轮修订作者记录（`55684a2`），被 Codex 复审 BLOCK 后由 r2 取代；历史保留 | 见记录 |
| [backend-foundation-20261106.md](backend-foundation-20261106.md) | 2026-11-06 | MAYNE-20 首轮作者记录（`355d1a0`），ZCode 出具 BLOCK/needs_revision 后由后续修订取代；历史保留 | 见记录 |
| [runtime-metadata-20261106.md](runtime-metadata-20261106.md) | 2026-11-06 | MAYNE-18 W0 门禁修复：结构守卫区分平台运行时元数据（`.multica/`、`.opencode/`）与生产源码；本工作树新完整 check exit 0（attempt1 失败已归因既有冷启动抖动）；ZCode APPROVE | 原始证据 `build/runtime-metadata-20261106/` |
| [web-task-interaction-20261106.md](web-task-interaction-20261106.md) | 2026-11-06 | MAYNE-21 W0 浏览器任务交互契约与静态演示：队列/取消/恢复/核对界面语义、凭据与原生边界、壳适配点；ZCode 两轮独立评审 APPROVE_WITH_CHANGES（占槽集合含取消中、保留待核对不放行恢复、槽号按空闲槽分配、保留项可改选、取消转核对生成核对卡、暂停期拦截重新提交）+ 18 组浏览器交互检查通过，守卫与 175 项既有基线一致；未实现生产 HTTP/队列 | 原始证据 `build/mayne-21/`（gitignored） |
| [web-backend-direction-20261106.md](web-backend-direction-20261106.md) | 2026-11-06 | owner 五项决定：完整 Web 业务先行、OS 凭据、默认 3 并发持久队列、旧版无兼容桥；文档同步与设计，功能尚未实现 | 原始证据 `build/mayne-16-review/` |
| [pet-native-20261105.md](pet-native-20261105.md) | 2026-11-05 | 单屏桌宠动效/半隐/原生右键菜单、语义反馈与单色菜单栏图标已接线；双面代码评审/完整门禁通过，正式版物理验收及P4仍开放 | build/pet-native-20261105 完整日志与冻结；正式UI源/包哈希见记录 |
| [pet-interaction-design-20261105.md](pet-interaction-design-20261105.md) | 2026-11-05 | 桌宠D1–D7分阶段设计及正式UI隔离载体v3.3，两面独立APPROVE/pass；只签设计，不替代代码/原生验收 | 规范核心及评审处置见记录 |
| [inbox-width-20261105.md](inbox-width-20261105.md) | 2026-11-05 | 来源工具条与候选主列对齐，窄窗换行；真实浏览器9项、独立交付/完整门禁通过（Node939、Rust279/3ignored、dual37） | 原始证据`build/inbox-width-20261105/` |
| [ui-consistency-20261104.md](ui-consistency-20261104.md) | 2026-11-04 | 三页空态与图标按钮共享规范修订；独立复审/完整门禁通过（Node938、Rust279/3ignored、dual37），原生待验 | 原始证据`build/ui-consistency-20261104/` |
| [pet-animation-research-20261104.md](pet-animation-research-20261104.md) | 2026-11-04 | 桌宠动画技术调研：macOS＋Tauri 栈下待机/事件动画可行；SVG 四态＋CSS/motion-v 起步、Lottie 次选、Rive 需 CSP 探针；纯调研无代码改动 | 无证据目录（外部来源见文内链接） |
| [switch-visibility-20261104.md](switch-visibility-20261104.md) | 2026-11-04 | 原生报告开关不可见；浏览器已复现0×0并最小修复，独立复审及完整门禁通过（Node932、Rust279/3ignored、dual37），原生待重试 | 原始证据`build/switch-visibility-20261104/` |
| [desktop-preferences-20261104.md](desktop-preferences-20261104.md) | 2026-11-04 | S4桌面偏好：设计/修订交付双面及独立完整门禁通过（Node930、Rust279/3ignored、dual37）；补记owner人工确认快速录入/主窗同步/托盘入口，G1其余未验保留 | 原始证据`build/desktop-preferences-20261104/` |
| [desktop-entry-20261104.md](desktop-entry-20261104.md) | 2026-11-04 | S4首条桌面录入候选：设计/交付双面及新独立full通过（Node917、Rust273/3ignored、dual37），原生与其余S4/S5待验，G1未闭 | 同名精选摘要；原始证据`build/g1-functional-20261104/` |
| [native-readiness-20261104.md](native-readiness-20261104.md) | 2026-11-04 | G1固定800视口/私有前置诊断：双面及独立full通过（Node894、Rust271/3ignored、dual36）；官方文本/今日/角色/Skills子项通过，stdio补证私有交付通过，官方CUA再次-3812；owner结束补证并安全收尾，原生缺证待补、G1功能继续 | 同名目录精选摘要，原始证据`build/s36-readiness-20261104/`，旧900失败保留 |
| [verification-audit-20261104.md](verification-audit-20261104.md) | 2026-11-04 | 审计修复双面及独立full通过（Node870、Rust271/3ignored、dual31）；后续900高原生启动仍无ready，可用高887/800与诊断增量待授权，G1未闭 | 同名目录精选摘要；原始证据`build/s36-audit-record-20261104/`，旧失败封存不改 |
| [s36-native-resume-20261102.md](s36-native-resume-20261102.md) | 2026-11-02 | S3.6人工受控子项保留；重建载体/窗口适配聚焦与源码复核通过，但新完整check在验证审计JSON交错处失败，原生HTTP/H3等未闭 | 同名目录预览原图与精选摘要；原始证据另含`build/s36-native-tools-20261103/`与`build/s36-g1-viewport-20261103/` |
| [s36-g1-20261102.md](s36-g1-20261102.md) | 2026-11-02 | S3.6：固定G1载体／源码第2轮双面与独立完整机械门禁pass；原生手工／三角色／Skills实测后SCK再现停止，S3.6／G1未闭 | 同名目录精选源／验证摘要与原生原图；完整原证在`build/s36-g1-20261102/` |
| [g1-status-sync-20261102.md](g1-status-sync-20261102.md) | 2026-11-02 | G1状态同步：修正当前入口与过期说明，补记N1–N3实际提交／exactHEAD；S3.6及真实／原生边界保持开放 | 同名目录精选提交后命令／计数／原报告SHA |
| [s35-today-20261102.md](s35-today-20261102.md) | 2026-11-02 | S3.5 N3：设计／交付最终第3轮与独立fullAttempt2通过；实际提交083f3b7及提交后精确HEAD聚焦通过，原full1失败保留；原生／真实环境未验 | 原始证据仍在`build/night-20261101-s35/n3-*`；最终核证见[状态补记](g1-status-sync-20261102.md) |
| [s35-advisor-20261102.md](s35-advisor-20261102.md) | 2026-11-02 | S3.5 N2：独立交付、原完整门禁与实际提交c783c85后的精确HEAD聚焦通过；原生／真实环境未验 | 同名目录精选冻结／评审／验证；最终核证见[状态补记](g1-status-sync-20261102.md) |
| [s35-tracker-20261101.md](s35-tracker-20261101.md) | 2026-11-01 | S3.5 N1：独立交付、原完整门禁与实际提交951d500后的标准准备／精确HEAD聚焦通过；准备前cold失败及原生／真实环境未验保留 | 同名目录精选源冻结；最终核证见[状态补记](g1-status-sync-20261102.md) |
| [s34-native-20261101.md](s34-native-20261101.md) | 2026-11-01 | S3.4 原生补验：N0／N1与 SSE 正常 trial 部分实测；SCK -3812 再现后有界收尾，H3 仍未验 | `build/s34-native-20261101/` 原始证据；同名目录原图／计数与源包绑定／固定观察命令 |
| [s34-http-20261101.md](s34-http-20261101.md) | 2026-11-01 | S3.4 受控 HTTP：H0–H2准出；预算最小修复＋候选原完整门禁pass；原生／真实环境未验（提交前时点） | `build/s34-http-20261101/`及`build/budget-restart-fix-20261101/`原始证据；历史失败、50源绑定与未验分列 |
| [spec-review-20261028.md](spec-review-20261028.md) | 2026-10-28 | 产品说明书 v0.2 规格评审，结论 BLOCK；修订产物为 [产品说明书 v0.3](../产品说明书-v0.3.md) | 无证据目录（纯规格评审） |
| [s0-20261029.md](s0-20261029.md) | 2026-10-29 | S0 四组技术探针：部分通过，G0 未全项完成 | `s0-20261029-evidence.json`（无同名目录） |
| [layout-review-20261029.md](layout-review-20261029.md) | 2026-10-29 | 设置与公共表单布局设计提案；后续 owner 确认并授权生产改造 | `layout-20261029/`（目录名无 `-review`） |
| [s1-20261029.md](s1-20261029.md) | 2026-10-29 | S1 本地手工事项闭环实现与验收；AI／提醒等未交付 | `s1-20261029/`、`s1-20261029-evidence.json` |
| [layout-production-20261029.md](layout-production-20261029.md) | 2026-10-29 起，10-30 收尾 | 公共表单与配置页生产改造落地；原生 GUI 补验保留 | `layout-production-20261029/` |
| [s2-20261029.md](s2-20261029.md) | 2026-10-29 | S2 真实文本整理到签收的分层验证；原生完整操作待补验 | `s2-20261029/` |
| [s31-20261029.md](s31-20261029.md) | 2026-10-29 | S3.1 三角色配置与事项整理隔离试跑；另两角色试跑未开放 | `s31-20261029/` |
| [s32-20261030.md](s32-20261030.md) | 2026-10-30 | S3.2 Skills 安装／重扫／备份恢复与任务快照；MCP 留后续 | `s32-20261030/` |
| [visual-parity-20261030.md](visual-parity-20261030.md) | 2026-10-30 | 公共表单对稿修订与首页空态收紧 | `visual-parity-20261030/` |
| [s33-p2-config-20261030.md](s33-p2-config-20261030.md) | 2026-10-30 | P2 首检查点：MCP 服务配置可保存，保存不启动服务 | `s33-p2-config-20261030/` |
| [s33-p2-security-20261030.md](s33-p2-security-20261030.md) | 2026-10-30 | P2 第二检查点：环境项与凭据安全边界，生产后端固定关闭 | `s33-p2-security-20261030/` |
| [s33-p2-schema-20261030.md](s33-p2-schema-20261030.md) | 2026-10-30 | P2 第三检查点：004 迁移与无角色探测存储，仅隔离根 | `s33-p2-schema-20261030/` |
| [s33-p2-discovery-20261030.md](s33-p2-discovery-20261030.md) | 2026-10-30 | P2 无模型初始化／分页发现／清理的生产宿主接线 | `s33-p2-discovery-20261030/` |
| [s33-p2-ui-20261030.md](s33-p2-ui-20261030.md) | 2026-10-30 | P2 诊断页面与隔离载体检查点 | `s33-p2-ui-20261030/` |
| [s33-p2-upgrade-20261030.md](s33-p2-upgrade-20261030.md) | 2026-10-30 | P2 工作根升级产品入口，仅新建隔离根验证 | `s33-p2-upgrade-20261030/` |
| [s33-p2-keychain-20261030.md](s33-p2-keychain-20261030.md) | 2026-10-30 | P2 钥匙串适配器代码与隔离替身；未调用系统钥匙串 | `s33-p2-keychain-20261030/` |
| [s33-p2-closure-20261030.md](s33-p2-closure-20261030.md) | 2026-10-30 | P2 收口核对：聚合门禁、缺项矩阵与授权边界 | `s33-p2-closure-20261030/` |
| [s33-p2-authorized-20261030.md](s33-p2-authorized-20261030.md) | 2026-10-30 | 授权补验：完整 `npm run check` 实际通过，原生隔离尝试 | `s33-p2-authorized-20261030/` |
| [s33-p2-native-20261031.md](s33-p2-native-20261031.md) | 2026-10-31 | 原生续验取得同根启动与窗口操作；新建服务前再次受阻 | `s33-p2-native-20261031/`、`s33-p2-authorized-20261030/` |
| [s33-p2-sck-diagnosis-20261031.md](s33-p2-sck-diagnosis-20261031.md) | 2026-10-31 | ScreenCaptureKit -3812 定位到捕获矩形越界；P2 无凭据主线复验 | `s33-p2-sck-diagnosis-20261031/` |
| [s33-p2-json-20261031.md](s33-p2-json-20261031.md) | 2026-10-31 | MCP 配置改为表单／JSON 双模式，保存仍不启动服务 | `s33-p2-json-20261031/` |
| [structural-governance-20261031.md](structural-governance-20261031.md) | 2026-10-31 | 结构治理与工程约定沉淀：迁移后完整 `npm run check` exit 0，T5 验证与 T6／T7 评审 pass；非发布 GO／NO-GO | `build/struct-review-20261031/`（gitignored，见 §3.1） |
| [s33-p3-controlled-20261031.md](s33-p3-controlled-20261031.md) | 2026-10-31 | P3受控隔离调用：双面复核与完整check通过；P2遗留验收及P4–P6继续开放 | `build/p3-controlled-20261031/`（gitignored），精选验证摘要随记录保存 |
| [s33-p4-recovery-20261101.md](s33-p4-recovery-20261101.md) | 2026-11-01 | P4中断与未知结果恢复：最终双面APPROVE，独立完整check pass；真实模型／原生保持开放 | `build/p4-recovery-20261101/`（gitignored），精选验证摘要及冻结清单随记录保存 |
| [s33-p5-formal-20261101.md](s33-p5-formal-20261101.md) | 2026-11-01 | P5正式文本／有界模型：最低分层验收及G06已闭合；历史真实失败保留，本轮补验另列 | `build/p5-formal-20261101/`原始证据；同名目录精选源码冻结／机械／覆盖3份JSON |
| [s33-p6-native-20261101.md](s33-p6-native-20261101.md) | 2026-11-01 | P6受控原生宽窄矩阵、双面复评、两次独立完整门禁与新入口正控通过；当时保留既有P3及生产边界；提示后续见本轮收尾 | `build/p6-native-20261101/`原始证据；同名目录精选源码冻结与原图 |
| [s33-p5-revise-20261101.md](s33-p5-revise-20261101.md) | 2026-11-01 | 新独立预算下真实提取／修改／签收／trial补验通过；历史拒绝未复现，独立完整门禁通过 | `build/p5-revise-20261101/`原始证据；同名目录精选冻结／真实读回／预算与门禁摘要 |
| [s33-closure-20261101.md](s33-closure-20261101.md) | 2026-11-01 | 保存提示根因修复与回归、独立新检出完整门禁通过；真实模型0，生产／原生边界保持 | `build/s33-closure-20261101/`原始证据；同名目录精选冻结／验证摘要 |

## 3. 目录名与记录名不一致的证据目录

以下三个证据目录没有与目录同名的 `.md` 记录（`layout-20261029/` 有对应记录，只是命名不同），引用时必须说明来源：

| 目录 | 内容与记录位置 |
|---|---|
| `layout-20261029/` | [布局评审提案](layout-review-20261029.md) 的证据：合成原型截图、`browser-observations.json`、`artifact-hashes.json`。目录名比记录名少 `-review`，是早期命名，不重命名以免打断已提交引用。 |
| `s1-profile-20261029/` | S1 个人信息与按钮语义修订的证据（34 JS／26 Rust 通过、构建与签名校验、浏览器夹具截图、`sourceSha256`）。该轮工作记录在[实施计划 §11.4](../product/05-第一阶段实施计划.md) 的检查点，未单独成篇。 |
| `s33-p1-20261030/` | S3.3 P1 生命周期探针的证据（`lifecycle.log`、`baseline-red.log`、`startup-red.log`、`ownership-red.log`、`evidence.json`）。记录在[实施计划 §16.7](../product/05-第一阶段实施计划.md) 的检查点。 |

`layout-20261029/` 属于“有记录、目录名不同”；`s1-profile-20261029/` 与 `s33-p1-20261030/` 属于“有证据、记录并入实施计划”。三类都不因结构调整而合并或删除。

### 3.1 不在仓库内的证据目录（`build/`）

结构治理轮（2026-10-31）的原始证据在 `build/struct-review-20261031/`：`plan.md`（v2 计划工作稿）、迁移前 `check.log`、迁移后 `post/`（完整 `npm run check` 日志、守卫日志、独立重跑、静态复核、git 语义抽查、`code-hashes.json`、`summary.md`／`summary.json`）。

- `build/` 被 `.gitignore` 忽略，按 §1 留存策略**不随仓库提交**；仓库只保留 [本记录](structural-governance-20261031.md) 的结论与证据路径说明。
- 复核方式：在同一工作区按记录中的命令重跑；代码冻结比对用 `post/code-hashes.json`（聚合 sha256 见记录 §4.5）。
- 该目录不参与 `check:docs`（不在扫描范围），也不构成产品交付物。

## 4. 新增记录的落点

1. 先按 [验证约定](../engineering/verification.md) 跑门禁并留原始证据到 `build/<slice>/`。
2. 写 `docs/reviews/<slice>-<YYYYMMDD>.md`：范围、基点 commit、命令与退出码、计数、未验证项、结论。
3. 只把精选主证据复制到同名目录；大体积原始日志留在 `build/`，在记录里说明路径。
4. 在本文件第 2 节登记记录与证据目录，并同步更新标题中的记录数；若目录与记录不同名，在第 3 节说明。
5. 跑 `npm run check:docs` 确认链接存在。
