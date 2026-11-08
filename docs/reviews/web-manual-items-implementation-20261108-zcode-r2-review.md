# W1 I 生产实现候选限定复审 R2（ZCode，2026-11-08）

> 结论：**通过**（MAJOR-1 在四个写路径实测关闭；OBS-2 绑定与 CLI MINOR-1 均实测落地；未发现新的阻断或登记级问题）。
> 审查对象：`agent/claude/mayne-23` 增量 `4052d47bbbddb689fd5ed1043053b2f638663fcd..4ca93440b9bb86623e2c9f0f309f4ff462bebcf6`（父即已审参数版 `4052d47`），沿首轮审查记录 `12d42f2` 的结论做限定复审。
> 审查者：ZCode（I 首轮独立审查者，未参与 I/II/III 实现），按派审线程 `01a1b870-3203-7d17-8e0c-ca37515e36dc` 执行。
> 候选只读：以 /tmp 临时分离检出阅读与验证，候选树 `git status` 始终干净，审查后工作树已删除。原始证据在本机 `build/web-manual-items-implementation-r2-review/`（gitignored，随本记录列明文件名）。环境：macOS arm64、Node v24.20.0、cargo/rustc 1.89.0。
> 说明：R1 的驱动脚本随上一运行工作树的 gitignored `build/` 未留存；本轮按 R1 记录 §5/§6 的规格重建驱动（`evidence/race-driver-r2.mjs`、`evidence/cli-driver-r2.mjs`），判定口径与 R1 一致并加严（确定性注入 + 自然并发 + 重启恢复 + 新旧对照）。

## 1. 版本与增量身份（全部实测一致）

| 项 | 交付声明 | 实测 | 判定 |
|---|---|---|---|
| 候选提交 | `4ca93440b9bb86623e2c9f0f309f4ff462bebcf6` | 同，tree `cfda86b5d8b5c7c497f0251ff489f0cf379a0eef`，父 `4052d47`（父链 `74c023c→4052d47→4ca93440` 与 R1 链条衔接） | 一致 |
| 增量补丁 `4052d47..4ca93440` | `d3a01ce336626bb91f96e548ff24f2190bcb998840cefaf56b8d8bf13c9ba890` | 同（`evidence/r2-increment.patch`） | 逐字节一致 |
| 累计补丁 `bc4b1c3..4ca93440` | `ff79d46bc8b9aa6f699b9714950fbdc3815592bc49e9a882ecaed264e72f74a4` | 同（`evidence/r2-cumulative.patch`） | 逐字节一致 |
| 增量规模 | 4 文件 +153/−17 | 4 文件 +153/−17（numstat：record +25/−5、entry +19/−5、service +17/−7、tests +92/−0）；`git diff --check` exit 0 | 一致 |
| 逐文件 SHA-256 | service `fa679aff…d433f`、entry `c7234a75…e29aa`、tests `5e00fe45…bc1f9` | 3/3 实测一致 | 一致 |

- **写入范围**：仅 I 范围内三文件＋其自有交付记录 `docs/reviews/web-manual-items-implementation-20261108.md`（表格哈希刷新＋新增 §7，内容与实际增量相符）。无 Rust 文件、无 II/III 文件、无 package.json/守卫/构建脚本、无 vendor/pi、无锁文件变更。
- **未改面确认（逐字节）**：`storage-client.mjs`/`http-server.mjs`/`session-store.mjs`/`sse-hub.mjs`/`static-files.mjs` 在 `4052d47` 与 `4ca93440` 完全相同；冻结 `001_web_backend.sql`＝`8511907c…143d`、`002_manual_items.sql`＝`b6cb8e61…f97e`、`web-api-contract.md`（web-api/1）＝`61863271…f58d` 不变。
- 候选树 `node scripts/checks/check-docs.mjs` exit 0（20 文件 429 链接）。

## 2. MAJOR-1 关闭——四个写路径全部实测（真实 SQLite：打包二进制自带 SQLite）

修复本体（代码审阅）：`manual-items-service.mjs` 新增 `INSERT_EVENT_GATED`＝`INSERT … SELECT ?,… WHERE (SELECT changes()) = 1`，`updateItem` 与 `transitionItem`（complete/reopen/delete 四路径）同事务历史插入全部换用；影响行数校验从事后 `results[0].changes`（败者判定发生在提交后）改为 `results[1].changes`（门控事件插入行数）。`createItem` 保持无条件 `INSERT_EVENT`——create 无版本守卫、无败者模式，同 op 并发由 UNIQUE 约束＋catch 内 findEvent→replay/conflict 兜底（R1 已审，未改）。002 DDL 无 trigger，`changes()` 恰好反映前一条件 UPDATE；该语义在真实打包二进制的 SQLite 上经下列驱动实测成立。

**驱动验证（`logs/race-driver-candidate.log`，117/117 PASS，exit 0）**——以候选 `StorageClient`＋`ManualItemsService` 驱动本树 cargo build 的真实 `web-backend-storage`（BUILD_EXIT=0，51.65s）：

- **确定性强制竞争（四路径各一轮）**：胜者提交注入于败者 read-before 与事务之间——败者 409 `version_conflict`；历史**无该败者 operationId 行**（无幽灵历史）；以**原失败 operationId＋新版本**重试成功且 `replayed:false`、留下恰一条自身事件（幂等键未被烧毁）；盲重试（同 ID＋旧版本）被拒（`idempotency_conflict`），不再出现 R1 的"幽灵重放胜者状态"。
- **自然并发（四路径 × 3 轮）**：两个并发写同 `expectedVersion`，每轮恰一个成功、败者 409 `version_conflict`；历史只含胜者事件；败者 operationId 可用新版本重决（update 路径重决成功；complete/reopen/delete 路径当胜者已改状态时重决得 `state_conflict`——合法守卫，**绝不出现 `idempotency_conflict`**，即键未被烧毁；两种分支均断言）。
- **重启恢复**：close→重开（initialize=false）后无幽灵行持久化、败者 operationId 仍可用。

**对旧实现的可证伪性（同驱动、同真实二进制，仅换 `4052d47` 版 service；`logs/race-driver-falsify.log`，56/110，54 项失败全部命中旧缺陷）**：四路径全部复现幽灵事件行（强制、自然并发、重启后均持久）；修正重试（同 ID＋新版本）永久 `idempotency_conflict`（键烧毁）；盲重试返回 `replayed:true`（幽灵重放）。R1 的 MAJOR-1 后果链在生产层逐条复现，证明驱动口径确实可判别新旧实现。

**单测层可证伪性（`logs/test-unit-candidate.log`、`test-unit-old-service.log`）**：候选 14/14 exit 0；仅把 service 换回 `4052d47` 版（entry/tests 保持新版，单变量对照）后**恰好两条修复目标用例失败**——「failed concurrent writes …（MAJOR-1）」与「idempotency key binds action and item across reuse（OBS-2）」，其余 12 条不受影响照常通过；失败断言转储正是幽灵事件（`after.title='败者'` 描述从未应用的变更）。新回归的竞争注入点（败者 read-before 后、事务前注入胜者提交）经代码审阅确认强制"旧版本读后再提交胜者"的确定性语义，不依赖时序。

## 3. OBS-2 作用域——按任务描述裁定落地，边界未扩散

- 规范输入绑定（代码审阅＋驱动矩阵实测）：create＝`{action:'create',input}`；update＝`{action:'update',itemId,expectedVersion,input}`；complete/reopen/delete＝`{action,itemId,expectedVersion}`——与裁定文本逐字对应。
- 复用矩阵（`logs/race-driver-candidate.log` OBS-2 段）：跨事项复用（同 ID 异事项）409 `idempotency_conflict`；跨动作复用（complete→delete、complete@2→reopen@2 同 ID）409；**判别性用例**——跨事项复用同 input 同版本：旧实现按重放返回**另一事项**的对象（falsify 日志实测返回 `mi_33a7…`），新实现 409；同 ID 同版本异动作（complete@2 后 reopen@2）：旧实现静默"重放"complete（`replayed:true status:completed`），新实现 409。两条判别用例在旧实现恰好失败、新实现通过，证明绑定新增量正是裁定要求的最小面。
- 同意图重放规则保留：重放优先于版本/状态守卫、返回**当前权威状态**（complete@1 在事项已至 v3/open 后重放仍 `replayed:true` 且返回 version 3、status open；已删事项重放 delete 返回 deleted 态；删除后写入仍 `state_conflict`）。
- 范围不扩散：DDL 逐字节不变；stdio 协议面（storage-client、Rust store）零改动；域内动作名沿用既有 `create/update/complete/reopen/delete` 命名空间，无新增命名。

## 4. CLI MINOR-1 关闭——新旧对照实测（`logs/cli-driver-new.log`、`cli-driver-oldentry.log`）

新 entry（真实二进制驱动，A1/A2 以 `配对码` 输出确认服务真实启动后 SIGKILL 收尾）：

| 用例 | 新 `4ca93440` | 旧 `4052d47`（对照） |
|---|---|---|
| 末位裸 `--init`（`--root R --init --storage-bin B`） | 服务启动＋建库（`data/web-backend.sqlite` 落盘） | exit 1 `无法识别的参数：<bin 路径>`（`--init` 吞掉 `--storage-bin`） |
| 首位裸 `--init`（`--init --root R …`） | 服务启动＋建库 | exit 1 `无法识别的参数：<root 路径>` |
| 缺值（末位 `--root`） | exit 1 `参数 --root 缺少值` | exit 1 `--root 必须显式给定`（吞 undefined，恰好不崩） |
| `--root` 后接旗标 | exit 1 `参数 --root 缺少值`（不再吞旗标） | exit 1 `工作目录不存在`（把 `--init` 当路径，误导） |
| 经 `/tmp` 符号链接调用 | 真实执行（`配对码` 打印，服务可启动） | **静默 exit 0，什么都不执行**（`isDirectRun` 字符串比较失效） |

单测新增 `parseArgs` 用例（末位/首位布尔、多值旗标、缺值、非旗标参数）随 14/14 通过；`isDirectRun` 两侧 `realpathSync` 与 `parseArgs` 逐旗标解析与实测行为一致。注：`/tmp` 本身是 macOS 指向 `/private/tmp` 的符号链接，故直连用例以 realpath 调用执行（A1–A5），符号链接用例单列（A6）——旧实现的静默失效面比 R1 记载的"经 /tmp 调用"更宽（realpath 差异即可触发），新实现两侧解析后全部消除。

## 5. 交付记录一致性

`docs/reviews/web-manual-items-implementation-20261108.md` 新增 §7 与表格哈希刷新，其三项文件哈希与本轮实测一致；其聚焦验证声明（单测 14/14、真实 HTTP smoke、CLI smoke、Rust 未动）与本轮独立复跑结果方向一致——其中 HTTP/CLI/单测均由本轮自有驱动独立复现，未采信其日志本身。

## 6. 显式未验项（如实开放）

1. **Rust 全套未重跑**（按派审边界：本增量零 Rust 文件、冻结 SQL 逐字节不变，R1 的 store 11/11、schema 18/18、全量串行 323/323、fmt/clippy exit 0 结论对未改面继续有效）。
2. `build:backend` 端到端、`test:web-manual-items` 接入、完整 `npm run check`——唯一集成执行者（与 R1 相同，不提前集成）。
3. HTTP 层（配对/CSRF/Origin/SSE/静态）本增量未触碰（`http-server.mjs` 等逐字节相同），R1 的 51/54＋原始套接字证伪结论沿用；完整浏览器旅程与 II 三套件仍归 II/OhMyPi/集成。
4. 真实模型、Linux/反代、真实凭据/用户根——授权边界外未动。
5. 驱动细节备注（非实现缺陷）：web-backend 存储根的库文件为 `data/web-backend.sqlite`（与本轮驱动初版断言用的 `sidekick.sqlite` 文件名不同，已按实际落盘核对）；`build/` 目录为 gitignored 原始证据区，本记录 §1–§4 所引文件均在其内。

## 7. 结论

**通过。** R1 唯一阻断项 MAJOR-1 在四个写路径经真实 SQLite（打包二进制）确定性驱动与自然并发实测关闭，且新旧对照证明新增回归确实可证伪旧实现；OBS-2 按裁定落地且两条判别性用例证明绑定面精确；CLI MINOR-1 首中末 `--init` 与符号链接路径全部修复并有旧实现对照。增量身份、补丁/文件/冻结哈希全部实测一致，未改面逐字节确认，写入范围未越界。无新增阻断或登记级发现项。

按派审约定：不重跑 Rust 全套与最终完整门禁，不提前集成；MAYNE-23 状态未动（保持 in_progress）；本记录未登记 `docs/reviews/README.md` 索引（留集成轮）。审查全程自建进程已收尾（pgrep 复核为空），/tmp 临时检出与合成根已删除，候选树只读未改。
