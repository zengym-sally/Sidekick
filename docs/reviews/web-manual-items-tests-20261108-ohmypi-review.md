# MAYNE-23 切片 II 测试候选独立审查（OhMyPi）

> 状态：**不通过（附 3 项必须修订）**。审查对象是切片 II（Kimi）测试候选 `c24dc4a8c2b4d5c79a3bf68c86d45fb972530350`（九文件增量，+1616），只审测试候选本身；候选 I/III 未在本树落地，任何业务行为均未执行通过，本审查不签业务通过。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b838-2efd-7c6a-af0c-f642c6f502fa`。审查者未参与本套件编写。
> 依据：冻结契约 `docs/engineering/web-manual-items-contract.md`（SHA-256 `8d752953…b70e8d`，提交 `19045b8`）、冻结 `web-api/1`（SHA-256 `61863271…f58d`）、授权清单 `452dc436…8c0f`、002 DDL `b6cb8e61…f97e`、P2 验收矩阵 `d94de69`（OhMyPi `f031e21` 已独立通过）。

## 1. 登记与核对

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 pwd | 平台分配隔离 worktree | — |
| branch / HEAD | `agent/ohmypi/mayne-23` / `759075eef1979190a03d43c8a9166a635151c136` | 与派发一致 |
| 候选 commit / tree | `c24dc4a8c2b4d5c79a3bf68c86d45fb972530350` / `01bf3686cfadb47470e22f1a72fcb362f2f3973f` | `git cat-file -t` = commit |
| 候选父提交 | `425778591c2d53773fc11d743bec5b99d775a601` | 未 squash/rebase/reset |
| 补丁（`git show c24dc4a`） | 1676 行，9 files +1616/−0 | SHA-256 `658ca0e6a15ee9dc511e327d3b39b07167a66c4ef1f5768685f510e789a75448` |
| 九文件 blob 前 16 位 | 与候选评论逐条一致（见 admission.json） | 一致 |
| 冻结契约 / 授权 / web-api / 002 DDL 哈希 | 从 `19045b8` 提取复算 | 四项全部等于登记冻结值 |
| 候选只读 | 是；本树仅写本记录与 `build/web-manual-items-tests-review/` | 已核 |

**候选评论声明与本审查复算的差异**：无。九文件哈希、补丁规模、测试例数（17/2/6，其中 static 的浏览器 2 例由 `for (const width of [1440,640])` 展开）全部复算一致。

## 2. 独立复跑（本树实测，命令与退出码）

原始日志在 `build/web-manual-items-tests-review/`（gitignored）：`syntax-check.log`、`ohmypi-{http,restart,static}-prerequisite-gap.log`、`ohmypi-check-docs.log`、`ohmypi-diff-check.log`、`fixture-mechanics.log`、`fixture-subprocess.log`、`fixture-mechanics.json`。

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（3 套件 + 5 夹具，从候选 blob 落到本树 `build/…/review/`） | 0 | 8/8 通过 |
| `node --test --test-timeout=20000 tests/integration/web-manual-items-{http,restart,static}.test.mjs`（在还原真实目录布局的暂存树） | 1 / 1 / 1 | tests 17/2/6，pass 0，fail 17/2/6，**全部为 PrerequisiteGap**，与候选声明一致 |
| `node scripts/checks/check-structure.mjs`（含候选九文件写入本树 `tests/` 后） | 非 0（基线既有） | 173 处违规全部为**基线既有环境条件**：本树 `.omp/` 技能目录 170 处 `top.dir` + `vendor/pi` dist 未构建 3 处 `ref.missing`；**0 处引用候选文件**（候选评论报 `.kimi/` 171 + `vendor/pi` 2，同为基线条件，因执行者环境而异） |
| `node scripts/checks/check-docs.mjs`（含候选记录文档） | 0 | 20 文件 429 链接全解析，与候选声明一致 |
| `git diff --cached --check`（候选九文件暂存） | 0 | 无空白/冲突标记 |
| 夹具机械自测（本审查自建合成 mock 入口，只证夹具机制，不签业务） | 0 | in-process 10/10、子进程 5/5 通过 |

夹具机械自测复现了候选声明的机制面：`onPairingCode` 内存取码、`Set-Cookie` 捕获回放、缺 CSRF→403 `csrf_invalid`、跨 Origin→403 `origin_rejected`、授权写→200、`readSession` 取 capabilities+csrfToken、SSE `stream.ready`/`item.changed` 解析（`id` 行为 null）、子进程 IPC 取码、配对码不出现在 stdout/stderr、`SIGKILL` 后 `waitExit` 收敛。

## 3. 结论：不通过

套件的**设计骨架、来源覆盖与取证纪律是合格的**：业务搭建只走真实 HTTP、数据库只读观测同一合成根、配对码只进请求体并断言不入子进程 stdout/stderr、PrerequisiteGap 显式失败不假报业务通过、合成静态根在证据中记录 mode。按派发口径（mock 与 PrerequisiteGap 均不签业务通过），这些都不构成阻塞。

但存在 **1 项使断言永久失效的缺陷** 与 **2 项在真实 dist 模式下会漏签/误签的缺陷**，以及若干必须与候选 I 对齐的字面名假设。测试候选的职责是「可证伪」，上述缺陷直接削弱该职责，故不通过。

## 4. 必须修订项

### F-1（阻断）：`web-manual-items-http.test.mjs:424` 全局计数与单事项计数相比较，永真失败

```js
const counts = tableCounts(backend.root);            // manualItemEvents 是全局计数
const rows = itemRow(backend.root, itemId);
assert.ok(rows, 'exactly one database row may exist for the item');
assert.equal(counts.manualItemEvents, itemEvents(backend.root, itemId).length);
```

`backend` 是文件级共享实例（`let backend`，`before` 中 `startBackend()`）。`node:test` 默认按声明顺序串行执行顶层 test，A-6 之前已有 5 个 test 写入同一 `backend`（CSRF 控制写 1 项 1 事件、A-1 两项 2 事件、A-1/A-2 归一化 1 项 1 事件、A-2 三项 3 事件、A-4 一项三次写 3 事件），全局 `manualItemEvents` 累计约 10+；A-6 自身只为本事项写 3 条（create/update/delete）。`assert.equal(全局≈13, 单事项=3)` **在任何实现下都不可能通过**，A-6 因此失去「可证伪」意义——它不是校验重放不写额外事件，而是必然失败。

同类写法其余 12 处均合法：`L79-81` 位于首个 test 且 `backend` 全新、`L94-95`/`L151` 用 `isolated` 全新根、`L579-580`/`L585-587` 断言 `taskEvents`/`agentTasks` 恒 0（本套件从不入队任务），均不受共享累积影响。

修订：在 A-6 写入前捕获 `const eventsBefore = tableCounts(backend.root).manualItemEvents`，改为 `assert.equal(tableCounts(backend.root).manualItemEvents, eventsBefore + 3)`；或直接删去该行，仅保留 `assert.deepEqual(events, ['create','update','delete'])`（该行已足够证伪「重放写额外事件」）。

### F-2（阻断）：真实 dist 模式下 `findHashedAsset()` 可能返回 `.css`，随后断言 `/javascript/` 误拒

```js
const hashed = staticRootMode === 'synthetic' ? '/assets/app-9f8e7d6c5b4a.js' : findHashedAsset(staticRoot);
...
assert.match(response.headers.get('content-type') ?? '', /javascript/);
```

`findHashedAsset` 用 `readdirSync` 取**第一个**匹配 `/-[A-Za-z0-9_-]{8,}\.(?:js|css)$/` 的文件，未区分扩展名。Vite 产物 `index-<hash>.css` 与 `index-<hash>.js` 并存时字典序 `.css` 在前，`content-type` 为 `text/css`，`/javascript/` 断言失败。今天只因 dist 缺席（走 synthetic 分支）而未暴露；候选 I/III 落地后 `mode='packaged'`，该例会**误拒正确实现**。

修订：`findHashedAsset` 改为按扩展名分流并各自断言（js→`/javascript/`、css→`/^text\/css/`），或显式优先选 `.js`。

### F-3（阻断）：真实 dist 模式下浏览器例只签「#app 存在 + 无跨源引用」，漏签 `/api`/SSE 可达、挂载与宽窄屏不溢出

`staticRootMode !== 'synthetic'` 分支只做 `assert.match(dom, /<div id="app"/)` 与跨源引用过滤。合成模式反而断言更全（`report.mounted`、`report.origin`、`report.crossOriginRefs`、`report.overflow`、`report.session.status===401`、`report.events.status===401`）。后果：

- `<div id="app">` 来自静态 `index.html`，Vue 未挂载也满足——**挂载未被证伪**；
- 页面同源访问 `/api/session`、`/api/events` 得 401 JSON 信封（契约 §9.4「再同源访问 `/api` 与 SSE」）**在真实 dist 模式下完全没有断言**；
- 1440/640 两档「不横向溢出」**在真实 dist 模式下没有断言**，与派发重点「宽窄屏」直接相关。

修订：把合成模式中已写好的探针断言（挂载、同源、`/api/session` 与 `/api/events` 的 401 信封、`scrollWidth <= innerWidth`）提升为**两种模式共有**的最小断言集；真实 dist 无法注入探针脚本时，用 `--dump-dom` 后以独立同源 `fetch`（带 origin 的页面上下文不可行，可改为从测试进程用 `backend.origin` 请求并断言 401 信封，同时在 DOM 中断言应用根节点出现产品 UI 标记）补齐。至少必须补：`/api` 与 `/api/events` 的 401 JSON 信封断言 + 两档 `scrollWidth <= innerWidth` 断言。

## 5. 五项接口假设逐项核对（供 Codex 统一裁定）

| # | 假设 | 冻结契约依据 | 裁定建议 |
|---|---|---|---|
| 1 | `POST /api/pair` 体字段默认 `code` | 冻结 `web-api/1` §2 只说「码仅存在于请求体」，**未固定字段名**；全文 `code` 只出现在错误信封字段 | **未定字面名**。建议冻结为 `code`（与错误信封 `error.code` 同形、最短且无歧义），要求候选 I 依此实现；同时保留 `WEB_MANUAL_ITEMS_PAIR_FIELD` 作为集成期逃生阀 |
| 2 | CSRF 载体默认 session 响应 `csrfToken`／提交头 `x-csrf-token` | 冻结 `web-api/1` §2「返回 `session`（含 `capabilities`）与 CSRF token」、§10 `csrf_invalid`，**未固定载体字面名** | **未定字面名**。建议冻结响应体 `csrfToken` + 提交头 `x-csrf-token`；测试侧已同时接受 `csrf_token`/`x-csrf-token`/`x-csrf` 四种读法（`readSession`），宽容度足够，**不建议再放宽** |
| 3 | cookie 名从 `Set-Cookie` 捕获回放 | 冻结契约只规定 cookie **属性**（HttpOnly、SameSite=Strict、限定 Path、不设 Domain），未规定名字 | **做法正确，无需裁定**。测试不依赖名字，是本题唯一正确处理方式 |
| 4 | `status` 未知值与 `limit>200` 按 400 `validation_failed` | 契约 §5 列表行「主要错误 400 `validation_failed`」在列；`status` 取值集合为 `{缺省,open,completed,deleted,all}`，未知值行为未写；`limit`「默认 50、最大 200」，越界是**拒绝还是截断未写** | **未定字面名/语义**。建议：未知 `status` → 400 `validation_failed`（与 §10「类型非法」一致，低风险）；`limit>200` → **400 `validation_failed`**（拒绝优于静默截断：截断会让客户端误以为已取到上限内全部，破坏 MINOR-1 的可观测性）。需候选 I 依此实现，否则改测试 |
| 5 | 重启用测试自有子进程导入同一 `startWebBackend` | 契约 §9.1 规定 stdio 子进程模式与根锁生命周期，但**未规定重启验证机制**；任务书模块对接约定 1 已冻结 `startWebBackend(config)` → `{origin,close}` | **做法正确**。自有子进程可 `SIGKILL`，且经专用 IPC 取码不解析 stdout，符合「配对码不进日志」；无需裁定 |

补充核对：环境变量只用于**指向本树产物与未定字面名**（`WEB_MANUAL_ITEMS_{ENTRY,STORAGE_BIN,STATIC_ROOT,PAIR_FIELD,CSRF_HEADER}`、既有约定 `SIDEKICK_TEST_CHROME`），没有用来放宽任何已冻结语义（不跳断言、不改错误码、不放宽配对策略）。

## 6. 子进程 / SSE 收尾

- **测试自有子进程**：`backend-child.mjs` 由 `startBackendChild` spawn，`ready` 超时会 `SIGKILL`；`after()` 对 `second`/`first` 逐个 `close()`（已死者跳过 kill，仅清理 `configDir`）；SIGKILL 路径 `killHard()` + `waitExit()` 收敛。本审查实测子进程路径 5/5（含 SIGKILL 后 `process.kill(pid,0)` 确认消亡）。
- **SSE 句柄**：http 套件 M2 的 `stream`/`reconnect`、restart 套件的 `stream`/`hintStream` 均在 `finally` 中 `controller.abort()`；restart 中 `stream` 在 `killHard()` 前已 `close()`。无泄漏。
- **生产侧存储子进程退出**：夹具无法观测 Rust 子进程 pid（归生产代码所有），只能间接验证——restart 套件以「同根重开成功」证明根锁已释放（5×400ms 有界重试区分「慢释放」与「泄漏」）。这是可观测契约要求的正确验证方式，但**建议**候选 I 落地后补一条「`close()` 后存储子进程确已退出」的断言（需要生产侧暴露 pid 或 `close()` 承诺同步等待存储退出；任务书模块对接约定 1 已写「close 为等待 HTTP/SSE、存储子进程退出和锁释放的异步函数」，因此该断言应可直接写）。
- **已知小瑕（不阻断）**：`startBackendChild` 在 `waitFor('pairing-code')` 超时、`pair()`、`readSession()` 抛错时未 kill 子进程、未清理 `configDir`；restart 重试循环中每次失败都会泄漏一个 `configDir`（均在 `tmpdir`）。建议包一层 `try/catch` 统一收尾。

## 7. 真实 dist 与合成静态根的证据边界

- **披露到位**：`static-root.json` 记录 `mode`（`explicit`/`packaged`/`synthetic`）与 root；合成探针页自带「not the product UI」标注；候选记录文档 §5/§6 明说未签业务。按派发口径可接受。
- **优先级正确**：显式 env > 打包产物 > 合成根，不会在真实 dist 存在时静默退化到合成根。
- **边界风险（不阻断但需记录）**：`WEB_MANUAL_ITEMS_STATIC_ROOT` 可指向任意目录，包括 `design/` 原型目录——契约 §9.4 禁止以设计预览代替验收链路。当前缓解只有「证据记录了 root 路径」，可审计但不可自动阻止。**建议**在 `before` 钩子中显式拒绝 root 位于 `design/` 之下的取值，把「不得以设计预览代替」从文档约束变成机器约束。
- **运行时字面名未落证据（建议修订）**：`WEB_MANUAL_ITEMS_PAIR_FIELD`/`WEB_MANUAL_ITEMS_CSRF_HEADER` 生效时，运行证据（`admission.json`/`static-root.json`/套件日志）不记录实际生效值。这与派发「不靠环境变量静默改业务契约」相抵牾。建议在 `startBackend` 成功后将 `pairField()`/`csrfHeader()` 写入运行证据文件，使任何字面名偏离都可被复核。

## 8. 未验项（如实开放）

- 任何业务行为均未执行：端点、持久化、重启恢复、同源静态、浏览器矩阵都依赖候选 I/III。本审查只签「套件独立可审 + 语法 + 前置缺口显式失败 + 夹具机制 + 守卫/文档/diff 不回归」。
- `npm run check` 完整重门禁未跑（按派发留待唯一集成者）；cargo 未跑。
- 候选 I 的生产实现（`server/`、`web_backend_store.rs`、`src/bin/`、`dist/`）在本树不存在，故 F-2/F-3 的「真实 dist 模式」缺陷是**静态推断 + 代码路径推演**，未在真实 dist 上复现；F-1 是纯逻辑推断（共享实例累积），确定性高。
- Linux/代理、真实凭据/用户根/模型未涉及。

## 9. 处置建议

**退回候选 II 修订**：F-1、F-2、F-3 三项必修；第 6/7 节的两项收尾与证据记录建议同批处理。修订后按精确版本重新派审（仍由未参与者承担），再进入最终集成。MAYNE-23 保持 `in_progress`；实际集成后的浏览器用户旅程按派发另行分派。
