# W1 文本整理逐路径集成清单（OpenCode 只读接收准备，2026-11-10）

- **派工**：MAYNE-24 评论 `01a1c107-20de-7e6d-89a9-694db4f24c0b`（Codex，2026-11-09T15:57Z；按 ZCode `ac7daa1` 接收 `b548777` 后的下一步只读接收准备）。**修订 2（2026-11-10）**：按协调裁定 `01a1c123-dcfb-7e7b-90b2-0543e5872df8`（歧义 A ＋ queue 锚定）与同评论的清单准入精度要求，仅更新出处／状态／manifest 一致性并做 docs 核对；不改任何源码接收字节、不集成、不操作 main，不跑构建或门禁（`check:docs` 为唯一执行命令）。本清单**只让后续唯一集成可审，不是正式集成授权**。
- **方法与身份口径**：本树对象库（与各成员工作树共享）对下列每个锁定提交逐一 `git ls-tree` 复核 blob id、`git show` 提取副本复算**内容 SHA-256 与字节数**（2026-11-10 本日复算，完整值在可携带 manifest [web-text-intake-integration-inventory-20261110-manifest.json](web-text-intake-integration-inventory-20261110-manifest.json)，同字节随评论附件交付，128 条目；§G 冻结校验 3 行为校验面，不计入条目与写入文件数）。接收范围与独审记录引自派工线程 `01a1bb65` 各已接收独审／协调接收评论；**不重新签署任何独审结论**，各路径的通过状态以其原有记录为准。
- **风险级**：R0（零生产／测试／package 字节改动）。

## 1. 输入锚点（派工点名）

| 输入 | 锁定 |
|---|---|
| I 生产字节 | `56cf3db`（Kimi 记录提交；生产树＝`cd08588`／tree `776b2529`，分支 `agent/kimi/mayne-24`） |
| b5 所选五前端 | `b5fdfb9`（tree `283ba665`，OhMyPi `agent/ohmypi/mayne-24`） |
| 已审 III／十文件命令 | `6fad178`（tree `25090a1a`，本分支；HEAD `923ef54`） |
| s2-client 测试 | `b548777`（本分支，ZCode `ac7daa1` 限定通过、触发评论接收） |
| 恢复测试更正字节 | `82e1bf2`（tree `a6b25de9`，ZCode；**不取** I 树内旧 F1／W 断言） |
| 其余前端基座 | 冻结 I `d79b1f6`（tree `8324c0b2`） |

## 2. I 生产逐路径（树 `cd08588`，23 文件）

逐文件 blob／内容 SHA-256／字节数见 manifest §A（全部本日复算命中）。关键锚点：entry `47a9efcd`、worker-host `52198fa`、task-scheduler `8684d44`（均与 `0ff27bb` 登记逐字节相符）、003 SQL blob `e5103262`＝冻结哈希 `8e4e3159…7870` 本日复算相符。

增量链与独审／接收（各增量限定面以其原记录为准）：

| 增量（记录） | 独审 | 接收 |
|---|---|---|
| A 项批 `f0ae347`/`620c31f`/`a1fe030`/`d0c8ec2`＋两单测 `dd60976`（`4fc9537`） | Hermes `f53b659`（`01a1bf1c`）四提交＋单测修改分别通过 | 后继增量在其上锁定（`01a1bf3e` 等） |
| `58a4cdc`＋`95907cd`（`29305da`） | Hermes `9393e22`（`01a1bf56`）通过（限 sourceAt／error 帧面） | 同上 |
| `ba92104`＋`6caba12`＋`c7cc116`（`0536a44`） | Hermes `2979afe`（`01a1bf87`）三增量分别通过 | 同上 |
| `8860314` 四别名＋failurePayload 白名单（`cbb04f7`） | ZCode（`01a1bf92` 派工） | **协调 `01a1bfc8` 限定接收** |
| `42d3b8a`＋`2c39d7f` 预览围栏＋完整 draft 映射（`a3506af`） | ZCode `76f1523`（结论评论 `01a1c005-f37e`，由裁定 `01a1c123` 定位）：①预览发布围栏四面通过；②读回／apply 一致＋预览不改候选＋bare-fields 未退化三面通过 | 协调 `01a1c123` 按两项派工限定面接收；GAP-5／DTO／D 重放及真实 Pi 边界按原审保留；后继 `ceece1f` 锁定（`01a1bfe2`）与触发评论整链登记不变 |
| `ceece1f` 可信 test 安全证明（`c32c251`） | Hermes `a20c9bc` **不通过**（执行来源缺口） | 缺口由 `7cfef55` 修复，旧字节不被取用 |
| `72f1bb8` 候选／预览 DatePoint DTO（`e94ec84`） | 本分支 `885791c` 通过（限九面＋转换一次） | **协调 `01a1c02a` 限定接收** |
| `7cfef55`＋`be8be1a`(T-2)＋`e98b85b`(T-10)（`d2b2696`） | ZCode `c026676`：T-2/T-10 限定通过；旧 `7cfef55` 暖宿主失败不追改 | **协调 `01a1c0c4`** |
| `cd08588` 每 run 来源缓存边界（`56cf3db`） | 本分支 `0ff27bb`（`01a1c0bc`）通过限四面＋四例复跑＋三探针 | **协调 `01a1c0c4` 接收**；触发评论终局确认 |

## 3. 前端（b5 五文件 overlay ＋ 冻结 I 基座）

b5 五文件（blob 全部本日复核＝既登记值）：ModelSettingsPanel `0216921e`、TaskQueue `1bd5d476`、TextIntake `b6c1897d`、web-api-client `e730d4a3`、organizer `d4b824cb`。

- **web-api-client `e730d4a3`**：Pi 日期独审通过（记录提交 `531157f`，评论 `01a1c0bf`：sourceAt 精确毫秒、同 DTO 后端 e54→b5 映射、b5 正控日期／apply 事实按限定接收）。措辞澄清：既有登记「＝`531157f` 已审 blob」指**该记录登记的已审字节**；`531157f` 本身是 docs-only 提交，其树内 web-api-client 为 Pi 分支旧字节 `34c87f8a`——不构成与该树字节相等的声明（本日对象库实核）。
- organizer `d4b824cb`＝冻结 I `72f1bb8`／`d79b1f6` 同 blob（web 管道，`01a1c03b` 定位、ZCode `ac7daa1` 复核）；TaskQueue `1bd5d476` 同 d79（`4641ef0`）。
- **其余前端取冻结 I `d79b1f6` 原字节**：协调 `01a1bf7b` 核对 `d79b1f6`/`29305da`/`0536a44` 三树 models.ts `2be89983`／agents.ts `da044b6e`／Workbench.vue `c5af8bac` 同 blob；F-4（`4641ef0`）Workbench 必须取 d79 字节。完整 d79 前端清单（**63 文件**，修订 2 更正修订 1「60 文件」的计数措辞）在 manifest §B。
- **§B 准入精度（裁定 `01a1c123`，2026-11-10 对 main `1e37044` 逐路径复算）**：63 路径中恰 **5 份**相对 main 改动，且均与最新 I `cd08588`／冻结 I `d79b1f6` 同 blob——SettingsPanel `fa75f477`（main 为 `c412cf3f`）、Workbench `c5af8bac`（`2aa1f2b9`）、stores/agents `da044b6e`（`71abbabf`）、stores/models `2be89983`（`52634c43`）、stores/pairing `d04b09a9`（`3ae7deb3`）。五份逐项审查覆盖出处（未定位覆盖即标待确认，不以「冻结 I 未变」标作已审可收）：
  - **Workbench＝部分覆盖**：本分支 `4641ef0` 审（评论 `01a1bdd2`）F-2/F-4 对 d79 字节作结构性核对（TaskQueue import/挂载、nativeAvailable 禁用绑定、浏览器模式 boot/轮询）并规定集成必须取 d79 字节；`01a1bf7b` 三树同 blob＋「已解锁、native 判断前加载」；`01a1beec` 基座采用裁定——整文件代码审未定位，余面**待确认覆盖**。
  - **SettingsPanel／stores/agents／stores/models＝仅身份类出处，逐文件审未定位→待确认覆盖**：`01a1bfa3`（`d79b1f6`/`cbb04f7` SettingsPanel 同 blob `fa75f477`、面板已无 native 门控）、OhMyPi overlay 披露 `01a1bfc3`（其分支仍持 `c412cf3f`/`52634c43`/`71abbabf`）、本分支 `0e32576`（评论 `01a1bf9d`）对候选树 `models.ts:35`/SettingsPanel:27 的归因证据——均为身份／归因，非对 d79 字节的代码审。
  - **stores/pairing＝未定位任何覆盖→待确认覆盖**：线程内 pairing 讨论均指 II http 套件配对机制（A5/`787db84`）与 MCP 配对单测，非本 store。
  - 其余 **58 路径与 main 字节相同，仅作基座校验**（manifest 逐条 `coverage` 字段登记），不声称逐文件审。

## 4. III 工程链与聚合命令（本分支）

链：`a7d2a88`（基点）→ `ff287ab`（工程候选：守卫 003 冻结＋build-backend＋聚合五文件＋公共记录与七份已审记录原样接收）→ `589eeaa`（＋lifecycle）→ `9ab8ee0`（r2：＋mcp-pairing/recovery/events＝九文件）→ `cce6cfb`（D1 批独审记录）→ `6fad178`（＋test-safety＝**十文件**）→ `308ddc1`（esrc 证据收口）→ `b548777`＋`923ef54`（s2-client，触发评论已接收）。

聚合命令（`6fad178` 与 HEAD 逐字节相同，HEAD 本日复读）：

```
node --test --test-timeout=20000 tests/unit/web-text-intake.test.mjs tests/unit/web-text-intake-lifecycle.test.mjs tests/unit/web-text-intake-mcp-pairing.test.mjs tests/unit/web-text-intake-recovery.test.mjs tests/unit/web-text-intake-events.test.mjs tests/integration/web-text-intake-{http,queue,controlled-model,static}.test.mjs tests/unit/web-text-intake-test-safety.test.mjs
```

（实际值为展开的十路径；107 脚本名集合、52 步 check 链、依赖与锁在 `ff287ab`/`589eeaa`/`9ab8ee0`/`6fad178` 各登记点逐字节不变。）`build-backend.mjs` blob `34c58f51`（HEAD 本日复核＝`ff287ab`＝`9ab8ee0` 登记）；`check-structure.mjs` 003 冻结自测在案（engineering-20261108 §4）。III 工程接入 `6fad178`／补件 `308ddc1` 经 ZCode 限定审通过（记录 `d0f6b03`，评论 `01a1c0f3`）。

## 5. II 多谱系逐文件锁定（按已接收独审）

四套件（谱系均自 II r5 `61a069b`／tree `e0a6028b` 起；配置修订共同基座 `7f3322b` 由协调 `01a1bec0` 限定接收并把直接基座登记更正为 `61a069b`）：

| 文件 | 锁定提交 | blob | 独审／接收 |
|---|---|---|---|
| http | `787db84`（tree `097b494a`，Pi） | `40237eec` | 谱系 r5→`7f3322b`(配置)→`45b1cfe`(B2/C1)→`787db84`(A5 T-13)；Hermes `e645bae`（`01a1bfab`）通过限判据与机制面 |
| queue | `787db84`（tree `097b494a`，Pi；**源锚定按裁定 `01a1c123`**） | `ef98d1d6` | 本日对象库复核：`e69ee59`（tree `2a3ed01d`）与 `787db84` 该文件同 blob `ef98d1d6`；源锚 `787db84`，连同该修订夹具 `04dcd4c5`／http `40237eec` 一并引用 Hermes `e645bae`（`01a1bfab`）two-clients／A5 限定证据；**不补写「`e69ee59` 整体通过」**——其旧缓存竞态不通过（Hermes `8635e6f`/`01a1bf64`）按历史保留 |
| controlled-model | `34958bb`（tree `ccad6309`，Pi） | `3cfb1649` | `7f3322b`(3fe17f58)→`45b1cfe`(4d9556b2, B1)→`34958bb`(M-11 机制)；ZCode `153834e`（`01a1bf8a`）通过限面；协调 `01a1bfc8`「机制／判据审保留」 |
| static | `7f3322b`（OhMyPi） | `837b9143` | 仅配置修订一跳；全分支对象库复核无更后修订（Kimi `1bfc352`/`a2fb15b`/`ab7f609` 为 r5 前历史） |

配套夹具：r5 原字节九件（backend-child `c50f07b4`、browser-probe `2aafda22`、controlled-model-service `109e53c4`、controlled-model `72a8d755`、db-observer `173857dd`、protocol-worker `aecc1903`、sse-listener `9d0fda4f`、static-root `9b87569f`、synthetic-inputs `d5e10991`）＋修订三件——canonical worker `protocol-worker-process.mjs` `986f4cfe`@`5b06f0d`（r5 前 `c9f28a8a`；本分支 `0fa6b52`／`01a1bf34` 通过限 +17/−5 修订面）、backend-process `04dcd4c5`@`787db84`（r5 前 `7069c665`；`e645bae`）、model-config.mjs `8596b78e`@`7f3322b`（新增）。

单套回归（聚合第 3–5、10 位）：mcp-pairing `a02af9e` 四文件（`3011552f`/`7a1dfac0`/`97f8bfaf` golden `35d7b97e`＝P-3 冻结帧包/`d8bf1dab`；ZCode `01a1bdf9` 通过；生产 pairKey 修复 `59b405f` 本分支 `099fc57` 通过 11/11）；**recovery 取 `82e1bf2` 更正字节**（测试 `8c641b11`/内容 `3ab536c9`＋夹具 `5fe68cb4`/`6d638db0`；协调 `01a1bef5` 按已审接收、基线缺件由 `cce6cfb` 重放补齐；基线 `7613843` 11/11×2、`ef50461` 10/11；`a1562c1` 树内本文件 blob 本日复核仍＝`8c641b11`，回执修订不触此文件）；events `727c6fb`（`67f52618`；`cce6cfb` 通过）；test-safety `6216a6b` 三文件（`f72ff6dd`/`4bea6aac`〔内容 `54e1d84c`＝R1 `syntheticEntrySha256` 交叉〕/`4f3c9940`；本分支 `94f8d85` 通过限第四例面；`6fad178` 原样接入；协调 `01a1c0c4` 允许接入；`cd08588` 上四例 4/4＝`0ff27bb` 复跑）。

I 两单测（聚合第 1–2 位）取 I 树 `cd08588` 字节：service `0a39c864`（末触 `a1fe030`）、lifecycle `d160f0b6`（末触 `dd60976`）；A 批独审 `f53b659` 含两单测修改通过。s2-client（聚合外、`test:s2-domain` 门内）＝`b548777` blob `f0019938`（内容 `e87ecbfc`＝ZCode `ac7daa1` 登记）。

## 6. 尚不能接收与准出前置（分列，不造占位、不豁免现组）

1. **回执重启回归终版**：`a1562c1`（tree `f4ee780f`）`tests/unit/web-text-intake-receipts-restart.test.mjs` blob `b422ee08`（本日复核＝协调 `01a1c0db` 登记）＋夹具 receipts-restart-worker.mjs（`db95ea3` 修订）。谱系 `959f54b`→`f7e8307`→`db95ea3`（持久门/原断言/早退按 `01a1bff1` 接收、聚合准入不通过）→`c29219f`（协调 `01a1c0b8` 逐行介入仍不通过两处）→`a1562c1`（`01a1c0db` 锁定）。**修订 2 时点**：Pi 点检已交 `b93a048`（tree `929e528f`、父 `bdf3ae4`、恰 1 记录 +52；评论 `01a1c11b`）——两主体（collect-all 后传播、句柄化退出门绑定真实 ChildProcess）限定通过＋1 项非阻断静态观察（undefined 时 close 注册晚于监听注册；锁定链不可达）；协调 `01a1c11e` 按限定面接收两主体，并已派 ZCode **捕获注册顺序微修**（close 在取得 backend 时先登记、捕获／监听错误门步重抛、统一 null/undefined、一个有界自有后端捕获失败反控）。**待该微修**；仍不在聚合十文件内，集成不取。
2. **test-safety 第五例**（暖宿主回借判别回归）：**已交** `bdf3ae4`（tree `36eb8471` 本日复核＝协调 `01a1c11e` 锁定、父 `7ee7304`；测试 blob `f72ff6dd`→`7c0cb4ba`（+191/−1，唯一删除行为 import 行扩展，原四例断言未触）；夹具 `4bea6aac`/`4f3c9940` 未动；恰 1 新记录 +68；评论 `01a1c11b`）。作者登记 AFTER `cd08588` 1/1 PASS／BEFORE `d2b2696` 1/1 FAIL 于 GAP-TEST-SAFETY-3（作者主张，本清单未重跑）。**待 ZCode 独审**（`01a1c11e` 已派）；不替换 `6216a6b` 已锁接收字节、不改聚合文件数与 package。
3. **日期收尾证据**：负控清理后 totalMs/pass/退出码原始输出未挂（`01a1c100` 派工）；新脚本引用的 `model-config.mjs` 需在装配清单登记实际版本（已审 `7f3322b` 对应 helper＝`8596b78e` 在案）。**截至 2026-11-10 仍待收尾原件。**
4. **GAP-5（退出保证完整性缺口）**：实现缺口——套件 GAP-5 例持续红（发布 succeeded 而树成员仍存活；R7-M-2/M-3；本分支 `23eb1a1` 裁定、owner 包 `8d87609`/`329cf86`）。
5. **E**：登记域退出保证（web-api/1→/2，B(a)）owner 申请已送（`01a1bfd2`，r4 `329cf86`），待 owner。
6. **D**：`004_candidate_operations.sql` 申请待 owner；其**操作重放**（幂等）验收族按 storage-decision 记录（`06291e0` §8.4.3）在 D 批准后必须新增——准出前置。
7. **歧义 A——已由协调裁定（`01a1c123`），原待确认项收口**：`42d3b8a`/`2c39d7f` 的 ZCode 结论评论＝`01a1c005-f37e-7bb8-8902-fbb1f2e34b87`、记录＝`76f1523`（本日对象库复核：tree `4d04d41f`、父 `db95ea3`、docs-only 恰 1 新文件 +44）；本轮按两项派工限定面接收，GAP-5／DTO／D 重放及真实 Pi 边界按原审保留（增量身份 `42d3b8a` tree `56b12d11` 父 `cbb04f7`、`2c39d7f` tree `d77ecf05` 父 `42d3b8a`，本日复核相符）。`e69ee59` 子项按同 blob 锚定 `787db84` 收口（见 §5），不补写整体通过。

## 7. 环境准备／证据缺件／实现缺口（三分）

- **环境准备**（仓库既有命令，非实现缺口）：`npm ci --ignore-scripts`→`probe:prepare-cli`→`probe:prepare-pi`→`probe:bundle`→`build:backend`（engineering-20261108 §4 已验证正负例）；构建身份 `5311ffa3…232bd`（2647984 B＝输入树 `48b54730`＋rustc 1.99.1 `58cf8f9c3`，本分支 `a054244` 登记；最终门禁前后读回工具链与二进制，不自动沿用旧哈希，旧 `42af54b5…` 证据按原产物保留）。
- **证据缺件**：§6.1–6.3（回执终审、第五例、日期收尾）——如实缺，不补造。
- **实现缺口**：GAP-5（待 E owner 裁定）、D 操作重放族（待 D 批准）。两者按登记保持开放。
- 四套件**聚合级绿色从未声称**：各轮失败集为已登记生产缺口面，修复后未整套重跑——聚合执行归唯一集成轮，不沿用任何旧绿证。

## 8. 纪律核对（本日复算）

- 001 `8511907c…`、002 `b6cb8e61…`、003 `8e4e3159…`（blob `e5103262`）在 `cd08588` 全部命中冻结值。
- **唯一写入视图**：§A（23 条目）为 server/src-tauri 生产面的唯一写入视图；§G 三行仅冻结哈希校验（与 §A 同 blob 同源 `cd08588`），是校验用途、不折算为写入文件数；manifest 条目数＝128（A 23＋B 68＋D 16＋E 14＋F 7），§G 不计入，清单行数≠写入文件数。
- 依赖锁／107 脚本名集合／52 步 check 链在工程链各登记点逐字节不变。
- 集成前置构造边界沿 aggregate r2 登记(aggregate r2 record section 4)：字节落盘按 blob 寻址提取（`git show <commit>:<path>` 后复算）、recovery 夹具按路径加载、b5 五文件 overlay 于 d79 前端之上、聚合命令沿 `6fad178` 十路径——不按记忆重写、不取其它版本、不整树合并任何候选分支。

## 9. 边界与结论

只读交付：修订 1 恰 3 文件（本记录＋manifest＋README 索引行）；修订 2（本提交）恰 3 文件（本记录＋manifest＋README 同行时点更新）。未接入／改写任何生产、测试、package 字节；未操作 main；未跑构建或门禁（`check:docs` 仅链接守卫）。可携带 manifest 随评论附件交付（完整 SHA-256／blob／128 条目＋裁定与不可接收项的截至时点）。本清单使后续唯一集成可逐路径审计；**不是集成授权**，其余已派工作继续，MAYNE-24 保持 `in_progress`。
