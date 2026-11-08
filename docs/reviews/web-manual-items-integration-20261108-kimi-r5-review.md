# MAYNE-23 W1 第五轮集成回执只读复核（Kimi，2026-11-08）

> 状态：**通过**（仅限回执 `8902594` 的接入与公共面：完整 I/II 原样接入、审查记录 blob 身份、契约附录B、fixture 脚本/预算、冻结件、阶段口径与门禁回执一致性；0 项阻断，1 NIT＋2 观察非阻断）。
> 复核对象：回执 `8902594b8d7c2ea78bc420add247a0961d7a8995`，父＝第五轮冻结版 `eca807b6d1911c115abffbb45a9371f38be4b801`（tree `9371002bd327e4ce0deee0488d097321dd9982bf`），增量基座 `a27d9ab1ebcbdafe8512ddd53011c62ed0d3f71e`；未改已过面沿 `b15eaa1` 结论。
> 派发：MAYNE-23 派发线程评论 `01a1b99b-eefe-71b5-bd62-f113c8385359`（最终独立验收准入，与 OhMyPi 原样 UI 旅程并行）。
> 审查边界（重要）：**不签候选 II 行为**（II 测试由 Kimi 编写，按派发不自审；II 各版结论依据 OhMyPi `4856d4e`/`5cdaa3c`/`98fb349` 通过记录，其 blob 身份已核）；**不签 W1 业务准出/浏览器旅程**；**未重跑完整门禁**（门禁由唯一集成执行者在冻结版执行，本复核只做静态抽验与登记一致性核对）；未改候选/main/任务状态。
> 方法：只读。本树 HEAD 仍 `8b2962d`（II r5 候选），以 `git show`／`git diff`／`git archive` 对本地共享对象库取证；对回执树做只读导出后跑守卫自测与文档链接静态抽验。原始日志与脚本见 `build/web-manual-items-integration-r5-review/`（gitignored，本机留存）。

## 1. 链结构与冻结身份

| 项 | 实测 | 登记/结论 |
|---|---|---|
| 回执父提交 | `8902594` 父＝`eca807b`（`git rev-list --parents`） | 回执建于冻结版之上 |
| 冻结 tree | `9371002bd327e4ce0deee0488d097321dd9982bf` | ＝登记值 |
| 回执相对冻结差异 | 仅 `docs/reviews/web-manual-items-integration-20261108.md` 一文件 +11 行（§14 回执） | 门禁证据适用于所交付字节，源码/测试零改动 |
| merge 结构 | `fd4d6cc`＋`d3cc896`→`d42dfd9`；`d42dfd9`＋`8b2962d`→`6b0c4c7`；`6b0c4c7`→`eca807b`→`8902594` | 接入完整候选头，非仅末次修复 |
| merge-base(I, 基座) | `e750302cdb1a6718b3260929707d351163015176` | ＝§13.2 登记 |
| merge-base(II, 基座) | `19418ef8c82de498318d80a39260d1c9778f29c3` | ＝§13.2 登记 |
| 血缘 | `65469904…` 为基座 `a27d9ab` 祖先（`--is-ancestor` YES） | ＝§13.2 登记 |

## 2. 候选原样接入（零偏离核对）

- **完整 I**：`git diff --diff-filter=M d3cc896 eca807b -- server/ src-tauri/ src/ tests/` **无任何修改行**（差异仅表现为 II 新文件的纯新增）；I 自有记录 `docs/reviews/web-manual-items-implementation-20261108.md` blob `06fcf174efaf02d087fdda8662bc547cb854cfa6` 在 `d3cc896`/`eca807b`/`8902594` 三处相等。含 R3 写目标分派修复 `2479587` 的完整候选树 `e26270ec` 原样落入，不只取末次守卫修复。
- **完整 II**：`git diff 8b2962d eca807b` 对 II 全部写入范围（`tests/integration/web-manual-items-{http,restart,static,fixture}.test.mjs`、`tests/fixtures/web-manual-items/` 六夹具、`docs/reviews/web-manual-items-tests-20261108{,-r2,-r3,-r4,-r5}.md`）**为空**——r3/r4/r5 全部修订（F-3、F-5/F-6、ownsRoot OBS-1、泄漏判据 OBS-1'）逐字节落在集成树。
- 本增量（`a27d9ab..eca807b`，42 文件）文件集与三项候选写入范围＋授权公共记录一一对应；`scripts/`（守卫/构建）在增量内**零改动**；无文件删除。

## 3. 审查记录 blob 身份（8 份，src＝frozen＝receipt）

| 来源提交 | 文件 | blob | 结论 |
|---|---|---|---|
| `54badb5` | `docs/reviews/web-manual-items-implementation-20261108-zcode-time-sse-review.md` | `d92a81997ff86f8bae69d35ad729c3a9231ef4ce` | blob 级一致 |
| `51c8579` | `docs/reviews/web-manual-items-implementation-20261108-zcode-startup-frontend-review.md` | `df9fde4421fe43559a79c22f29943cb9be12c7f9` | blob 级一致 |
| `36afeed` | `docs/reviews/web-manual-items-implementation-20261108-zcode-startup-frontend-r2-review.md` | `0ffde7bec5f8d37097b27fd12dcbec4059d652b3` | blob 级一致 |
| `79774c9` | `docs/reviews/web-manual-items-browser-acceptance-20261108.md` | `362bb2fc3ac776f4897946b9e916243c063e89cc` | blob 级一致 |
| `4856d4e` | `docs/reviews/web-manual-items-tests-20261108-ohmypi-r3-review.md` | `afb5881a2aec011a53be48531d2f44d289dedf09` | blob 级一致 |
| `5cdaa3c` | `docs/reviews/web-manual-items-tests-20261108-ohmypi-r4-review.md` | `4b6a9c7fb18edd254166d98cd3073cf2e0a2ba9e` | blob 级一致 |
| `98fb349` | `docs/reviews/web-manual-items-tests-20261108-ohmypi-r5-review.md` | `7721836f4901d9c3a0f3a4ad647678a6c2c44410` | blob 级一致 |
| `fd4d6cc` | `docs/reviews/web-manual-items-implementation-20261108-opencode-settings-sql-r3-review.md` | `7a8608dbcbd5343a5fcb7351363d346237c9b52f` | blob 级一致（经 merge 接入） |

七份按原路径文件级接收（非整树合并外部分支）；其中两份历史**不通过**记录（`79774c9` 旧快照 `404a2bc` 浏览器旅程、`51c8579` 启动前端 R1）原样保留，评审索引行如实标注其结论与后继闭合，无"通过"洗白。

## 4. 契约附录B（`docs/engineering/web-manual-items-contract.md`）

- **纯追加**：基座版本（36,856 字节，SHA-256 `32910de72ceb20b9e4aa8226754316ee7400166c25e9d295bf0ef1811ce11eb4`，即登记的前缀哈希）是冻结版的**逐字节精确前缀**（`head -c 36856 | cmp` 通过）；追加量恰 **3,828 字节**，`diff` 删除行 0。
- **新哈希**：冻结版与回执两处 SHA-256 均 `08afea02c5185b76a1b921cc11deaf2669c78b9ce584a93c4824312bb529ad3c` ＝登记值。
- **转录准确性**（对照任务描述已登记三节裁定逐字面核对）：B.1 最小启动契约（`getWebApiClient()` 懒加载共享实例、配对/会话 CSRF 共享、logout/401 清理并回门、秘密不落本地存储；`application.timeZone` 单 key、GET 信封与 version=0 不写库、PUT 会话/CSRF/精确 Origin 与 CAS 409/400 语义、版本随读快照传递；Rust 写权限限两模板且七命令 stdio/001/002/锁/标识不变；settings 读回才 ready、原生能力入口显式未接通）；B.2 宿主 helper 归位（`nativeBridgeAvailable` 在 `src/lib/host-capabilities.ts`、未获批 `src/domain/capabilities.ts` 已删、不扩 domain 边界）；B.3 DML 写目标分派（settings 一律过精确模板、业务放行仅限真实 manual 表目标、子查询/EXISTS/注释提名不授权、引号/限定名直接拒、A11/A12 拒且零落库，引 R3 独审记录）。无语义拓宽、无"待定"语言。
- 附录自述与实测一致：正文 §1–§14、附录A 与冻结 DDL（001 `8511907c…143d`、002 `b6cb8e61…f97e`、web-api/1 `61863271…f58d`）逐字节未动（附录B 明示＋前缀比对实证）。

## 5. fixture 回归脚本与预算

- `package.json` 全增量唯一改动：`test:web-manual-items` 在既有四文件后追加 `tests/integration/web-manual-items-fixture.test.mjs`，仍为同一 `node --test --test-timeout=20000`（**预算 20000ms 不变**、脚本名不变、五文件同脚本）；`eca807b..8902594` 对 `package.json` 零改动。
- `package-lock.json` 在整个增量（`a27d9ab..8902594`）内**零改动**；依赖未新增。
- fixture 回归文件本身属 II 经审候选（`8b2962d` 原样，见 §2），OhMyPi R5（`98fb349`）通过结论随记录 blob 级接收；II 行为按派发不自审。

## 6. 冻结件与守卫

- 回执树实测：`web-backend/001_web_backend.sql`＝`8511907c…143d`、`web-backend/002_manual_items.sql`＝`b6cb8e61…f97e`（＝owner 批准 DDL 原样哈希）、`docs/engineering/web-api-contract.md`＝`61863271…f58d`——三件与登记逐一相符。
- 回执版 `scripts/checks/check-structure.mjs` 的不可变迁移表含 002 冻结哈希（`b6cb8e61…`）；只读导出后自测 **exit 0**（26 类违规＋8 处引用违规均被合成树检出；既有新 lineage 迁移与 W1 manual-items 迁移原样字节通过、篡改/缺失被标）。

## 7. 阶段口径（无提前准出）

- [architecture.md](../engineering/architecture.md)：候选 I 已随任务分支第五轮原样接入，**未合入 main，完整门禁与浏览器旅程验收未签**，"不假称已交付"。
- [web-backend-design.md](../engineering/web-backend-design.md)：三候选及独审齐备并接入（未合入 main），完整门禁与浏览器旅程由唯一集成执行者在冻结版执行。
- [05-第一阶段实施计划.md](../product/05-第一阶段实施计划.md)：W1 行"第五轮集成中……完整门禁与浏览器旅程验收待执行……不因本切片签通过"；W2–W5 仍待实现。
- [README.md](README.md)：索引 105→116，11 条新记录＋集成行第五轮指针；`79774c9` 行保留**不通过**结论。
- 集成记录 §14「W1 准出判定」：完整门禁本切片首次 exit 0，但**业务准出仍未签**——新冻结版原样 UI 旅程与公共记录增量由未参与者另行独立验收；main 合入/清分支留队长；MAYNE-23 保持 in_progress，不自签 done。
- 结论：全部阶段记录口径与实际状态一致，**无任何提前准出表述**。

## 8. 完整门禁回执一致性（登记层面）

§14 回执、`8902594` 提交信息与任务描述「第五轮门禁已绿」登记三处**逐项一致**：冻结 `eca807b`/tree `9371002b`；GATE `2026-11-08T04:52:45Z→05:08:54Z`（16 分 9 秒）exit 0；51 组全执行零短路；第 47 组真实打包（含 `web-backend-storage` 与 `sidekick` 两二进制 ad-hoc 签名）；第 50 组 `build:backend` 真实产物 3.7M（存储二进制 2,633,392 B、dist→static/）；第 51 组 `test:web-manual-items` 五文件 **59/59/0/0**（20000ms）；node 组合计 879 用例；`probe:native` 325 passed／3 ignored（314.76s）；警告仅既有两类（vite chunks>500kB ×3、tauri notarization-skip ×2）零新增；`pgrep` 零自建残留。

本人静态抽验（只读导出回执树，不重复门禁）：`check:structure --self-test` exit 0；`check:docs` **exit 0（21 文件 508 链接）——与 §14 申报数字相符**；仓库模式 structure 在裸导出下仅 3 处 `vendor/pi` dist `ref.missing`（`probe:prepare-pi` 真实产物，导出环境缺失），**0 处引用 W1 切片文件**。

## 9. 未验项（本复核边界外）

- 原始证据字节：`gate-r5-full.log`（登记 SHA-256 `79cac86c…9203`，3009 行）、`prepare-cli.log`/`prepare-pi.log`/`npm-ci.log`、`admission-r5.json`（`49e72052…74ef`）、`SHA256SUMS-r5.txt` 位于集成者 gitignored `build/` 且未随 issue 附件交付——只完成登记层面一致性核对，未复算其字节。
- 51 组门禁执行本体（逐组 exit/数量、真实打包与 `build:backend` 产物、`probe:native` 325/3）：按派发不重复完整门禁，依据唯一集成执行者回执与三处登记互证。
- 新冻结版 `eca807b` 的完整原样 UI 浏览器旅程：OhMyPi 并行独立验收中（`79774c9` 仅覆盖旧快照 `404a2bc`，沿用条件不满足已在 §13.2 登记）。
- 候选 II 测试行为：按派发不自审，依据 OhMyPi R3/R4/R5 通过记录（blob 已核）。
- Linux/代理、真实凭据/用户根/模型、CLI 路径：未涉及。

## 10. 观察项（非阻断）

- **NIT-1**：回执树上 `docs/product/05` 仍表述第五轮完整门禁"待执行"，而 §14 已登记 exit 0（回执提交只更新了集成记录一文件）。整体口径（W1 未签、浏览器旅程待验）仍准确，属保守滞后而非提前准出；建议后续阶段记录刷新时对齐措辞。
- **OBS-1**：裸导出下 structure 仓库模式 3 处 `vendor/pi` dist `ref.missing` 为构建产物前提（集成者树内 `probe:prepare-pi` 实建后通过），与既往登记的先存环境条件同类。
- **OBS-2**：8 份接收记录含 2 份历史不通过记录，原样保留且索引如实标注，未发现状态洗白。

## 11. 结论

**通过**——回执 `8902594b8d7c2ea78bc420add247a0961d7a8995`（冻结版 `eca807b`，tree `9371002b`）的接入与公共面逐项复核：完整 I `d3cc896`/完整 II `8b2962d` 原样接入（scope diff 为空）、8 份审查记录 blob 级一致、契约附录B 纯追加 3,828 字节且哈希 `08afea02…` 与登记裁定转录准确、`package.json` 仅追加 fixture 回归且 20000ms 预算与锁文件不动、冻结 001/002/web-api/1 字节不变、阶段记录无提前准出、门禁回执三处登记互证且静态抽验（self-test/docs 21 文件 508 链接）相符。0 项阻断；1 NIT＋2 观察非阻断。本结论仅绑定本版源码/回执，不代签 II 行为、浏览器旅程与 W1 业务准出；main 合入与任务状态按派发留队长处理。MAYNE-23 保持 in_progress。

## 附：命令与退出码（实跑，完整输出见 build 证据）

| 命令 | 结果 |
|---|---|
| `git cat-file -t` ×5（回执/冻结/基座/I/II） | 均 commit |
| `git diff --stat eca807b 8902594` | 1 文件 +11 行 |
| `git diff --diff-filter=M d3cc896 eca807b -- server/ src-tauri/ src/ tests/` | 空（I 范围零修改） |
| `git diff 8b2962d eca807b -- <II 全部写入范围>` | 空 |
| blob 身份循环 ×8 | 全 OK（src＝frozen＝receipt） |
| `sha256sum` 契约（冻结/回执） | 均 `08afea02…ad3c` |
| `head -c 36856 frozen \| cmp - base` | PURE-APPEND-OK（delta 3,828 B） |
| `git diff a27d9ab eca807b -- package.json` | 单行（追加 fixture，20000ms 不变） |
| `git diff a27d9ab 8902594 -- package-lock.json` | 空 |
| 冻结件 sha256 ×3（001/002/web-api/1） | 均＝登记值 |
| `git diff a27d9ab 8902594 -- scripts/` | 空 |
| `node scripts/checks/check-structure.mjs --self-test`（回执只读导出） | exit 0 |
| `node scripts/checks/check-docs.mjs`（回执只读导出） | exit 0（21 文件 508 链接） |
| `node scripts/checks/check-structure.mjs`（裸导出） | exit 1，仅 3 处 vendor/pi dist ref.missing（环境前提），0 处 W1 切片 |

收尾：本复核未建任何服务/子进程；只读导出临时树已删；证据目录 `build/web-manual-items-integration-r5-review/`（`verification-log.txt` `b024ff9b…7640`、`verify-r5.sh` `87e703c5…6889`、`SHA256SUMS.txt`）为 gitignored 本机留存，不含配对码/cookie/token；日志中本机工作树路径已替换。
