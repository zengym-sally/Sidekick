# MAYNE-23 W1 集成公共增量只读审查（Kimi，2026-11-08）

> 状态：**通过**（仅限集成公共增量：契约附录A、原样接收的审查记录、评审索引、失败回执；0 项阻断，2 NIT＋2 观察非阻断）。
> 审查对象：`868eaaf3c75f5de6f52b76533802a022a9b96ca2`（branch `agent/opencode/mayne-23`，回执提交），增量范围 `a5708d567d88da017b06f2b41e339efc294ddcbc..868eaaf3c75f5de6f52b76533802a022a9b96ca2`（merge I `6cf60cb`、merge II `0a33965`、公共记录冻结 `a02bfef`、回执 `868eaaf`）。
> 派发：MAYNE-23 派发线程 `01a1b892-a716-77ab-8181-028cf1c88d3d`（触发评论，回复 OpenCode 集成回报 `01a1b891-717b-7374-a2ba-d611a53910b3`）。
> 审查边界（重要）：**本记录不签候选 II**（`tests/integration/web-manual-items-*.mjs`、`tests/fixtures/web-manual-items/` 由 Kimi 编写，按派发不自审）；**不签 W1 业务通过/浏览器旅程**；**未跑完整门禁**。门禁在第 5 组失败的事实保留，I 修订＋独审通过后才重新冻结并从头重跑完整检查。
> 方法：只读。全程未 checkout 集成分支、未切分支、未改 HEAD（本树 HEAD 仍 `19418ef`），以 `git show`／`git diff`／`git archive` 对本地对象取证。

## 1. 登记与版本复算

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/kimi/mayne-23` / `19418ef8c82de498318d80a39260d1c9778f29c3` | 与平台分配一致；审查前 `git status` 仅平台注入的 AGENTS.md 运行时块与未跟踪 `.kimi/` `.multica/` |
| 被审提交 / 父 / tree | `868eaaf3` / 父 `a02bfef` / tree `a93b20bd0806ab0e98f75d7782223165f6c3c028` | `git cat-file -t` = commit |
| 冻结提交 / tree | `a02bfef2945bc7c147eef14746a14f180a9c2578` / `5fe0b3907b83d95b7d722280c437ffde6cf467eb` | **＝门禁日志 `GATE_FROZEN_HEAD`/`GATE_FROZEN_TREE`** |
| 回执提交相对冻结树差异 | 仅 `docs/reviews/web-manual-items-integration-20261108.md` 一文件 | 即门禁证据适用于所交付字节 |
| 候选 I tree | `cfda86b5d8b5c7c497f0251ff489f0cf379a0eef` | ＝登记值 |
| 候选 II tree | `85badfe11156af26c2e55735fa02d7ef6d156367` | ＝登记值 |
| 候选 III tree | `15ad350a2f09f26bdd9e8ddfcfdcb5801a30944c` | ＝登记值 |
| merge 结构 | `6cf60cb` 父＝`a5708d5`+`4ca9344`；`0a33965` 父＝`6cf60cb`+`19418ef` | 接入完整候选头，非仅末次修复 |
| 血缘 | `merge-base(4ca93440, 65469904)`＝`65469904`；`merge-base(19418ef, 65469904)`＝`65469904` | 三候选同基点分出 |
| 累计/修订补丁哈希复算 | I `bc4b1c3..4ca93440`＝`ff79d46b…f74a4`；II `c24dc4a..19418ef` diff＝`97dfd92a…2cf5`、format-patch＝`e585b642…40b1` | **全部＝申报值** |

## 2. 候选文件是否原样接入（零偏离核对）

| 候选 | 变更文件数 | 与集成树逐文件 `git diff` | 结论 |
|---|---|---|---|
| I（`4ca93440`） | 24 | 24/24 无差异 | **原样接入** |
| II（`19418ef`） | 11 | 11/11 无差异 | **原样接入** |
| III（`133a2a1`） | 15 | 13/15 无差异；2 处差异恰为本次授权的公共记录（契约附录、评审索引） | **原样接入＋授权公共记录** |

- `src/lib/web-api-client.ts` 在 `4ca93440` 与 `868eaaf3` 为同一 blob（`fb2dfdcfce5963ce2b25f9dd4b2bae63d7b33508`）；`src/domain/todos.ts` 与基点 `65469904` 为同一 blob（`f5bd14778011ec8036bd966742650373da295edd`）。
- 本增量（`a5708d5..868eaaf3`）共 33 新增＋10 修改＝I 24＋II 11＋5 份审查记录＋1 份集成记录＋契约＋索引，与派发写入清单一致；`package.json`、守卫脚本、Cargo.toml 之外的构建/守卫文件在本增量内**零改动**。
- 冻结文件实测：001 `8511907c…143d`（＝基点，未动）、002 `b6cb8e61…f97e`（＝批准 DDL）、web-api/1 `61863271…f58d`（＝基点，未动）；授权清单 `452dc436…`→`242ea3db…` 差异仅 +17/−2（状态行＋§12 准入登记），与申报一致。
- 集成提交内无平台注入痕迹：AGENTS.md 未被本增量触碰，树内无 `.multica/`、`.kimi/`、`.opencode/`、`build/` 跟踪文件。

## 3. 契约附录A（`docs/engineering/web-manual-items-contract.md`）

- **纯追加**：19045b8 原审字节是新文件的精确前缀（`startswith` 实测 True）；追加 1907 字节／20 行，`diff` 删除行数 0。
- 原审版 SHA-256 `8d7529531e7e5c53a3d195fa20f376a2b72d400e0ce8114b8c8ccc3b17b70e8d`（＝登记）；追加后 `32910de72ceb20b9e4aa8226754316ee7400166c25e9d295bf0ef1811ce11eb4`（**＝登记新哈希**，实测文件字节复算一致）。
- 正文 §1–§14 与 DDL 未动：原审正文确有 §1–§14 共 14 节；附录自述的冻结哈希（001 `8511907c…`、002 `b6cb8e61…`、web-api/1 `61863271…`）与实测文件逐一相符。
- 附录内容＝两次已登记协调裁定的忠实转录，无语义拓宽：A.1 覆盖 `pairingCode`、顶层 `csrfToken`／`X-CSRF-Token`／`Set-Cookie`、`status` 语义与未知 status→400 `validation_failed`、`limit` 缺省 50 与 1–200 整数、证据不落码/token；A.2 覆盖同 `operationId` 重放条件（动作／目标事项／规范化 input／`expectedVersion`）、重放先于守卫并返回当前权威态、跨动作或跨 `itemId` 复用→409 `idempotency_conflict` 不写新事件、不改 001/002/schema/legacy。逐字面核对无缺失，无 `any`／`@ts-ignore`／"待定"等放宽语言。
- 附录尾部自述"SHA-256 见集成记录登记"：集成记录 §2 已登记 `32910de7…`，闭合。

## 4. 原样接收的审查记录与交付记录

| 文件 | 来源提交 | 集成树 blob | 结论 |
|---|---|---|---|
| `web-manual-items-implementation-20261108-zcode-review.md` | `12d42f2` | `c0d2da59…` | blob 级一致 |
| `web-manual-items-implementation-20261108-zcode-r2-review.md` | `4889f87` | `121be7c1…` | blob 级一致 |
| `web-manual-items-tests-20261108-ohmypi-review.md` | `fe8ac7b` | `2df4a32c…` | blob 级一致 |
| `web-manual-items-tests-20261108-ohmypi-r2-review.md` | `ad90915` | `68ea3f96…` | blob 级一致 |
| `web-manual-items-engineering-20261108-zcode-review.md` | `3e8d310` | `36be131d…` | blob 级一致 |
| `web-manual-items-implementation-20261108.md` | `4ca93440` | 同左 | blob 级一致 |
| `web-manual-items-tests-20261108.md` / `-r2.md` | `19418ef` | 同左 | blob 级一致 |
| `web-manual-items-engineering-20261108.md` | `133a2a1` | 同左 | blob 级一致 |

五份审查记录按原路径逐文件取自审查提交，无整树合并外部分支；blob 哈希与集成记录申报的五个值逐一相符。

## 5. 评审索引（`docs/reviews/README.md`）

- 计数 91→101，新增 10 行（实测 `grep -c '^+|'` = 10），覆盖：本集成记录、III ZCode 审查、II 交付原版/r2＋OhMyPi R1/R2、I 交付＋ZCode R1/R2＋OpenCode 参数审查。
- 新增 10 行的相对链接在 `868eaaf3` 树内 10/10 解析存在。
- 独立复跑文档守卫：对 `868eaaf3` 的 `git archive` 导出树执行 `node scripts/checks/check-docs.mjs`，**exit 0**，21 文件／493 链接，与门禁日志第 2 组数字一致（本审查未跑完整门禁，只跑这一个聚焦守卫）。

## 6. 失败回执（`build/web-manual-items-integration/11`–`13`，随评论附件交付）

- `11-check-full.log`：`GATE_START=2026-11-08T00:26:51Z`、`GATE_END=00:26:57Z`、`GATE_EXIT=2`、`FROZEN_HEAD=a02bfef`／`FROZEN_TREE=5fe0b390`（与 §1 复算一致）。逐组：① structure（含 self-test，26 类违规负例）② docs ③ executable-copy 4/4 ④ probe:bundle 均 exit 0；⑤ `typecheck` exit 2，输出恰 3 处 TS 错误；其后 `&&` 短路，无后续 `npm notice run` 行——"未执行"表述与日志相符。
- 日志第 3 行的 check 链与 `868eaaf3` 的 `package.json` `check` 脚本逐组相同（51 组，次序一致），链尾为 `npm run build:backend && npm run test:web-manual-items`：真实打包前置与新 Web 套件确在门禁内。
- **缺陷独立确证**（静态类型核对，不依赖回执自述）：`src/lib/web-api-client.ts` L91/L92 将 `WirePoint.precision`（L14 `'minute' | 'day'`）赋给域 `TimePoint.precision?: 'day'`（`src/domain/todos.ts:3`）→ TS2322；L101 以 `WireItem.source`（L33 字面量 `'manual'`）比较 `'signed_ai'`（域 `src/domain/todos.ts:5` 为 `'manual' | 'signed_ai'`）→ TS2367。服务端 `server/lib/manual-items-service.mjs:83` 为 `value.precision ?? 'minute'`，证实线协议含 `'minute'`，客户端类型声明与 `fromWireItem` 转换未对齐域可空语义。行号与日志逐条相同。
- **A/B 归因复核**：失败 blob 在候选 I 与集成树同一，`src/domain/`、`shared/` 自基点未改；三处错误仅由这两个文件的类型声明即可成立，无需其它文件参与——"缺陷内在于候选 I 交付字节、非集成组装产物"的结论成立。

## 7. 发现项

无阻断项。

| 级别 | 项 | 说明 |
|---|---|---|
| NIT-1 | 门禁起止时间表述不一 | 集成记录 §4.1 写"gate 于 00:19Z 启动、00:26:57Z 结束"，而 `11-check-full.log` 的 `GATE_START=00:26:51Z`。00:19Z 应指含前置（`npm ci`／`probe:prepare-cli`／`probe:prepare-pi`）的阶段起点，建议在记录中区分"前置阶段起点"与"`npm run check` 起点"，避免与日志字面冲突。不影响判定。 |
| NIT-2 | 编号证据未全量随评论交付 | `admission` 称证据编号 00–14，本次仅 11/12/13 与 admission 四件随附件交付；00–10（真实前置构建与聚焦检查）与 14（收尾 `pgrep`）只存在于集成树 gitignored `build/` 内，第三方无法从工单记录独立复算前置退出码与进程收尾。建议重跑门禁时把前置日志与清理日志一并哈希/附件。 |
| OBS-1 | typecheck 不在任何聚焦范围内 | 该缺陷穿过 I 的聚焦验证与两轮独审，最终由完整门禁拦下——正是全量门禁的设计用途。建议后续涉及前端的候选把 `npm run typecheck` 列入聚焦验证清单。 |
| OBS-2 | 第 5 组之后的约 46 组在本集成版零证据 | Rust 全套、两包构建、`build:backend` 真实打包、`test:web-manual-items` 与浏览器路径均未执行；I 修订后的新冻结版必须从头完整重跑，不得以本次部分绿证外推。 |

## 8. 结论与后续

**通过**：集成公共增量（契约附录A、五份审查记录与三份交付记录的原样接收、评审索引 91→101、门禁失败回执）与派发写入清单一致，未发现擅改候选业务/测试字节、未放宽守卫/断言/预算、未把平台产物带入提交；契约附录为纯追加且忠实转录两次已登记裁定；失败回执与实测代码缺陷互相印证，归因成立。

同时明确：本通过**不覆盖**候选 II（不自审）、**不覆盖** W1 业务/浏览器旅程通过、**不代表**门禁通过——`npm run check` 在冻结版第 5 组 exit 2 的事实保留。按登记应由 I 原作者（Claude）从 `4ca93440` 沿原范围修订 `src/lib/web-api-client.ts` 类型映射（minute 对应域缺省精度、day 保留日精度、source 按实际 manual 线格式转换，不用 any/强制断言吞错）并另派独立复审，通过后重新冻结集成版并从头串行重跑完整 `npm run check`（含此前未执行的约 46 组）。MAYNE-23 保持 in_progress。

## 9. 本审查留痕

- 审查记录：`docs/reviews/web-manual-items-integration-20261108-kimi-review.md`（本文件）。
- admission 与原始证据：`build/web-manual-items-integration-review/`（gitignored）：`admission.json`、`evidence/admission.json`、`evidence/11-check-full.log`、`evidence/12-typecheck-fail-section.log`、`evidence/13-ab-candidate-i-typecheck.log`、`tree-868eaaf3/`（`git archive` 导出树，仅用于跑 `check:docs`）。
- 本审查执行的操作：只读 git 取证＋一次聚焦 `check:docs`（exit 0）。未 checkout 集成分支、未改 HEAD、未跑完整门禁、未启动任何服务/浏览器/存储子进程，无收尾项。
