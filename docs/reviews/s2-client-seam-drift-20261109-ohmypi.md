# W1 `s2-client` 门禁红：接缝漂移修复（OhMyPi，2026-11-09）

> 范围：仅 `tests/unit/s2-client.test.mjs`（派工授权：对应夹具／用例及自有记录）。
> 结论：**测试／夹具漂移，已修；35/35，门禁脚本 `test:s2-domain` 47/47。** 生产代码零改动。
> MAYNE-24 保持 `in_progress`。

## 一、红的位置与是否在门禁内

锁定命令：

```
node --test --test-timeout=15000 tests/unit/s2-client.test.mjs
→ tests 35 / pass 34 / fail 1
```

失败用例（原 `:143`）「the process-isolated Pinia organizer keeps unknown when a Tauri
cancellation response arrives late」：

```
TypeError: Cannot read properties of undefined (reading 'host')
  at WebApiClient.request (src/lib/web-api-client.ts:369)   ← window.location.host
```

**在完整 check 链内**：`package.json` 的 `test:s2-domain` 含该文件，`check` 跑 `test:s2-domain`。
故不能以"无关"带过——这一点更正了本作者此前"既有、无关"的不充分表述。

## 二、字节定位（不靠行为猜测）

`tests/unit/s2-client.test.mjs` blob 在四处**完全相同**（`bb845bc9855c`）：任务基线 `38a7402`、
`1e37044`、完整 I `72f1bb8`、I＋所选前端 `b5fdfb9`。

变的是 store 管道：

| 提交 | `src/stores/organizer.ts` | 管道 |
|---|---|---|
| `38a7402`／`1e37044` | `612ecafc` | `createOrganizerModel(invoke)` — Tauri |
| `72f1bb8`（完整 I） | `d4b824cb` | `createOrganizerModel(getWebApiClient().asBackend())` — web |
| `b5fdfb9`（我的分支） | `d4b824cb` | 同完整 I |

**测试字节从未变，变的是 store 走哪条管道。**

## 三、二分

每棵树 `git archive` 物化，同一锁定命令：

```
38a7402（原始基线）                        pass 35 / fail 0   ← 绿
76f44e7（首个把 store 切到 web 客户端）      pass 34 / fail 1
7f3322b, b29afdc, 6e27d1e, 4c98309, 4846e61,
125280d, 5255c1c, 090872a, 1d09811, e54c273, b5fdfb9
                                          pass 34 / fail 1  （不变）
```

红由 `76f44e7` 引入，与本作者的凭据／staged／计数／sourceAt／DatePoint 各提交无关。

## 四、根因

该用例把 `window` 桩成 `{__TAURI_INTERNALS__:{invoke:fixture.api}}`，即打算经 Tauri `invoke`
接缝驱动 store。store 改用 web 客户端后两处同时失配：

1. fixture 的 `invoke` 根本不会被调用（实际走 shared `WebApiClient` 单例）；
2. `request()` 读 `window.location.host`，而桩里没有 `location`。

## 五、修法（仅测试侧）

- 保留真实 `useOrganizer → asBackend → fetch` 全链；`window.location` 如实提供。
- fetch 夹具**按客户端真实构造的 URL** 匹配（`/api/text-sources?limit=200`、
  `.../candidates?status=pending&limit=200`、`/api/tasks?limit=200`、`/api/tasks/A`、
  `/api/tasks/A/cancel`），答**合法 Task/Source 线型**。
- 线型合法性经生产 mapper 往返验证：task 行经 `toModelRun` 得
  `{id,sourceId,kind,status,errorCode,…}`；source 行经 `toTextSource` 得
  `sourceAtMs = Date.parse(sourceAt.at)`。**不把旧原生领域对象伪装成公开 DTO。**
- **未**改生产容忍缺失 `window.location`——那会让真实页面静默发出无 Host/Origin 的请求。
- **未**改成只测直连工厂：用例仍建真实 Pinia store，并保留
  `assert.throws(()=>useOrganizer(),/no active Pinia/)` 隔离断言。

## 六、重要发现：原用例本身是空转的

原用例先置权威 unknown，再 `await model.refresh()`，最后才 resolve 取消响应。而
`mutation()` 在 await **之前**捕获 `request=++generation`，那次 refresh 又把 generation 顶高，
于是取消响应回来后 `if(request!==generation) return result;` **提前返回**——取消结果的赋值
根本没执行。断言之所以通过，靠的是一个与受保护行为无关的 generation 守卫。

已用变异证实：删掉 `acceptRun` 的保护后，原结构的用例**仍然全绿**（mask 它的正是随后那次
把权威 unknown 又读回来的 refresh）。

重写后：去掉中间 refresh，并让取消后的读取失败（合成 read outage），使
`acceptRun` 的裁决成为 store 最终持有的状态——无处可mask。

## 七、可证伪性（两项变异均被抓）

| 变异 | 结果 |
|---|---|
| 删 `acceptRun` 的保护（`knownRuns.set(next.id,next); return next;`） | **红**，失败值 `null` vs `MCP_RESULT_UNKNOWN`，正是命名断言 |
| store 绕过 web 客户端（直连工厂抛错） | **红** |

即用例既钉住保护，也确实驱动了真实接线。

## 八、边界

- 只改一个测试文件；生产、store、client、package 零改动（`git status` 仅该文件）。
- `typecheck` exit 0；`check:docs` 通过（21 文件 524 链接）；`check:structure` 该文件 0 违规。
- `test:s2-domain` 47/47；`s2-client` 35/35。
- 未跑完整 `npm run check`、未跑真实 Tauri／钥匙串、未扩到 D1。
- 未签：整体准出、最终独立浏览器验收。

---

## 9. 修订与撤回（2026-11-09，OhMyPi 自纠，接 `01a1c0bb`）

`3ee282e`（Kimi 限定独审）判**不通过——限「新增夹具线型合法性」面**；其余六面（基线红复现、锁定树复跑、因果、可证伪性、隔离断言／全局恢复、已删 `batch.run` 断言的等价覆盖）验证通过。协调层接收该结论，`6e7e60c` 的绿证**不关闭门禁缺口**。本节按派工修正并撤回失实主张。

### 9.1 撤回：`unknownTask()` 是"合法 HTTP 线型"

**该主张错误，现撤回。** `unknownTask()`＝`state:'failed'`＋`failure.code:'MCP_RESULT_UNKNOWN'` 不可能由冻结 HTTP 面发出：

- `MCP_RESULT_UNKNOWN` 是**原生领域 sentinel**：Rust `mcp_calls.rs` 把它写进本地 DB（`status='failed'`, `error_code='MCP_RESULT_UNKNOWN'`），只存在于 Tauri invoke 管。
- 公开失败码恰为 `FAILURE_REGISTRY`（`server/lib/task-service.mjs:39-46`，冻结 web-api/1 §4.6）六项，该码不在其中；`normalizeFailure` 将其映射为已注册的 `worker_lost`——HTTP 面永远发不出它。
- mapper 往返**不校验**公开码注册／状态组合，故"mapper 能读"不构成合法性证据——此前以此为据的判断不成立。
- 副作用不可证明一律路由 `needs_review`（契约 §3.4/§4.6），且 `visibleFailure` 对 `needs_review` 仅在暂存 failed 结局时发布；客户端 `toModelRun` 把 `needs_review` 映射为 `interrupted`。

另有三处同类不合法：让已终态／`needs_review` 任务答 200 `cancelled`（`cancel` 对非 queued/running 一律 409 `state_conflict`）；同一刷新内列表报 `running` 而详情报 `failed`（两端点读同一行，列表只报 active）；取消行 `terminalAt`（002Z）早于权威行（003Z）造成终态时间倒挂。

### 9.2 保留：原用例空转的发现

派工明确限定：原结构**对 unknown 粘滞子句**无辨别力，**不等于** generation 围栏对业务保护无效。该围栏由既有用例 `a late cancellation cannot replace a newer run or restart reads for the previous source` 独立承重（删围栏→该例红），本节发现仅针对"unknown 粘滞子句"这一狭窄面，不外推为围栏无效。

同时撤回"跨 HTTP 请求可要求共同快照"的隐含假设：列表／详情可因真实迁移而不同，不能仅凭"同一 refresh"一概判非法。

### 9.3 现行修法（`0633388`）：合法因果

从可取消的 `running` 发起 → 请求时形成合法 **202 `cancelling`**（`cancelIntent:true`、`attemptExitState:'exiting'`、version 2）并延迟交还 → 经真实 refresh 读到较新的 **`needs_review`** 权威态（`attemptExitState:'exited_unknown'`、version 3、`failure={code:'worker_lost',cause:'exit_unconfirmed'}`、携带 recovery item）→ 再交还旧响应，断言 `run` 与 `batch.run` 均不被旧态覆盖。

来源详情自带 run 行，故 `batch.run` 断言恢复而非删除。取消后的 refresh 以**已披露的读取失败**隔离，否则它会重新读回权威行、掩盖赋值结果。

### 9.4 可证伪性（按派工不重复旧 14 件变异矩阵）

| 变异 | 结果 |
|---|---|
| generation 围栏＋no-resurrect 子句**同时**删除 | **红**，正落在命名断言 |
| 仅删 no-resurrect 子句（围栏完好） | 本例绿——此处由围栏单独承重，而围栏已由既有用例独立钉住，本例不重复该覆盖 |
| 仅删 generation 围栏 | 本例绿；同上 |

### 9.5 唯一覆盖

本用例是全文件**唯一**经真实 Pinia store 走真实 web HTTP 管（`useOrganizer → asBackend → fetch`）并发起真实 POST 取消的用例；其余用例均以直连工厂 api 构造 store。

### 9.6 边界（不变）

仅改测试文件；生产、store、client、package 零改动。`test:s2-domain` 47/47、`s2-client` 35/35、`typecheck` exit 0、`check:docs` 通过（21 文件 525 链接）、`check:structure` 该文件 0 违规。未跑完整 `npm run check`、未跑真实 Tauri／钥匙串、未扩到 D1。整体准出与最终独立浏览器验收仍未签；修订后另派差异点检。
