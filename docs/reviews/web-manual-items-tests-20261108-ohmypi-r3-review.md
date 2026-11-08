# MAYNE-23 切片 II r3 修订候选独立复审（OhMyPi，R3）

> 状态：**通过**（限 II r3 写入增量与受影响路径；0 阻断、2 观察非阻断）。复审对象 `b15eaa17c49380709d64bc59d5646900873c5b02..229c8cb4b1b1b29da3ea7b64d632cc24a4b1a41b`（4 文件 +225/−20）。审查者未参与 II 修订。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b919-898f-71b5-9ae8-f6dcd64c553b`。
> 依据：R2 审查 `ad90915` 的 F-1/F-2/F-3 关闭结论与冻结契约 §3 路径 7、§9.4、§11；本轮不签 `05f0bc0` 生产修复或原样 UI 通过，不重复完整门禁，先前浏览器两阻断结论保留。

## 1. 登记与版本复算

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `79774c90d00df28a0cca236fe0cb486e30bb6fd6` | 与派发一致 |
| 候选 commit / tree | `229c8cb4b1b1b29da3ea7b64d632cc24a4b1a41b` / `5e8be320e71d7486e6c2599285fa5e8333ab3632` | `git cat-file -t` = commit |
| 父提交 | `229c8cb4^` ＝ `b15eaa17c49380709d64bc59d5646900873c5b02`（直接父子，无 squash/amend/rebase） | 实测 |
| 增量 diff SHA-256 | `38a7dace5500edf9d839a4529e647f9d347e9c1a1eba0db15afc87286bb7185e` | **＝候选申报值** |
| format-patch SHA-256 | `7eedbdffd0690ba5e4cc669a6f3667bf144503ce395b5ab2ac57bef684171f86` | **＝候选申报值** |
| 四文件 blob 前 16 位 | restart `d3669c512207dec6`、browser-probe `b868e6b2788db43a`、static-root `52e5b2094ac51472`、r3 记录 `d0a07d7e8053d481` | 与候选申报一致 |
| 未改文件 | `backend-child` `3e7f5ef7…`、`backend-process` `bab97b79…`、`db-observer` `7f2c0428…`、`sse-listener` `0ec66505…`、http 套件、static 套件、`web-manual-items-tests-20261108.md` 与 `b15eaa17` blob 逐一相等 | 实测 SAME |

## 2. 独立复跑（本树实测，退出码与日志）

日志在 `build/web-manual-items-tests-r3-review/`：`syntax-check.log`、`ohmypi-r3-{http,restart,static}-prerequisite-gap.log`、`ohmypi-r3-static-synthetic.log`、`ohmypi-r3-check-structure.log`、`ohmypi-r3-structure-self-test.log`、`ohmypi-r3-check-docs.log`、`ohmypi-r3-diff-check.log`、`f356-verification.log`、`f6-net.log`。

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（3 套件 + 6 夹具） | 0 | 9/9 |
| `node --test --test-timeout=20000` 三套件（缺 I/III 产物） | 1/1/1 | tests 18/2/6，pass 0，**全部 PrerequisiteGap**；失败后 `/tmp/web-manual-items-*` = 0 |
| static 套件 synthetic 模式 + 真实 Chrome（指向 mock 静态后端） | 0 | **6/6 pass**，浏览器两档真实运行、未 skip |
| `check:structure`（候选 4 文件写入本树） | 1 | 173 处全为基线既有（`.omp/` 170 `top.dir` + `vendor/pi` 3 `ref.missing`），**0 处引用候选文件** |
| `check:structure --self-test` | 0 | 22 类违规 + 8 引用违规检出，clean 不误报，002 原样通过/篡改拒绝 |
| `check:docs` | 0 | 20 文件 429 链接 |
| `git diff --cached --check` | 0 | 干净 |
| 自建 F-3 三方一致性 + F-5/F-6 分类（真实 Chrome） | 0 | 21/21 |
| 自建 F-6 网络层跨源判别（真实 Chrome） | 0 | 3/3 |

## 3. F-3 关闭证据（完成响应／数据库／重启三方一致性）

修订内容：restart A-8 原来把重启后的 `completedAt` 期望值绑到 **create 响应**（`item.completedAt`，恒为 `null`），对任何正确实现都失败。改为绑定 **complete 响应** 的权威状态，并新增两条交叉校验。diff 为纯增量：替换 1 行错误绑定 + 新增 4 条断言（`assert.` 46→50），原状态/版本/标题/历史/根锁/401 断言逐字保留。

独立验证（`f356-verification.mjs`，用候选自身夹具 `backend-process.mjs`／`db-observer.mjs` + 自建 mock 后端，真实 SQLite）：

- `PASS the create response leaves completedAt :: null` —— 复现首轮缺陷前提
- `PASS the complete response stamps a non-null completedAt :: "2026-11-08T03:09:26.053Z"`，且匹配 ISO-8601 UTC 毫秒正则
- `PASS leg 1: the pre-kill DB row records the same completion timestamp :: db=1794107366053 response=1794107366053`
- `PASS leg 1b: the pre-kill DB row is completed at version 2`
- `PASS leg 2: the restored wire value equals the complete response timestamp :: restored=2026-11-08T03:09:26.053Z response=2026-11-08T03:09:26.053Z`
- `PASS leg 2b: the restored completedAt agrees with the DB row :: wire=1794107366053 db=1794107366053`
- `PASS leg 2c: the restored status/version/history are unchanged :: status=completed v=2 events=create,complete`

**可证伪对照**：把恢复值突变（丢弃 `completedAt`）后——`PASS the retired binding (create response) would pass on a wrong value :: create.completedAt=null mutated=null`（退役式漏签）；`PASS the revised binding catches the mutated value :: expected=2026-11-08T03:09:26.053Z mutated=null`（修订式拒签）。即修订式在正确数据上成立、在坏数据上失败。

## 4. F-5/F-6 关闭证据（data 内联／真实跨源网络／其他不透明 scheme）

修订内容：`PAGE_PROBE` 按**实际类别**分类静态引用——`data:` 内联（验证 payload 非空、单独记录）、`http/https` 真实网络引用（严格同源）、其余 scheme 显式拒绝；**不**一概豁免 `origin=null`。`probeWithChrome` 启用 CDP `Network` 域，从 navigate 到探针求值期间记录页面实际发出的全部请求（`report.networkRequests`），网络层同样按内联/网络分离。合成静态根加入与产品同类的内联 `data:` 图。

独立验证（`f356-verification.mjs` + `f6-net.mjs`，真实 headless Chrome，6 类页面对照）：

| 页面 | 期望 | 实测 |
|---|---|---|
| 正确页（同源资产 + 内联 `data:` 图） | 接受 | **PASS** —— `dom classes=[network,inline-data]`、`crossOrigin=[]`、`unexpected=[]` |
| 跨源 `http(s)` 引用 | 拒绝 | **PASS** —— `every http(s) static reference must be same-origin: ["https://evil.example/track.png"]` |
| `file:` scheme | 拒绝 | **PASS** —— `no static reference may use an unexpected scheme: ["file:///etc/passwd"]` |
| `blob:` scheme | 拒绝 | **PASS** —— 同上，`["blob:https://example.com/abc"]` |
| 未挂载页 | 拒绝 | **PASS** —— `the application must mount into #app in the live DOM (childElementCount=0, textLength=0)` |
| 3000px 溢出页 | 拒绝 | **PASS** —— `scrollWidth=3008, innerWidth=1440` |

- `PASS the correct page classifies inline data: separately from network references` —— DOM 层 `inline-data` 与 `network` 分开记录，`data:` 不计入跨源。
- `PASS the Network domain also reports the data: request separately :: network kinds=[net,net,data,net,net,net]` —— 证实候选的澄清：Chrome Network 域**会**上报 `data:` 请求，故网络层同样分流。
- **F-6 网络层判别（`f6-net.mjs`）**：页面脚本 `fetch('https://cross-origin.example/beacon')`，DOM 属性只声明同源引用——`PASS the Network domain observed the script-issued cross-origin request`；`PASS the Network-domain assertion rejects the page`；`PASS the DOM-side check alone would NOT have caught it (this is why F-6 exists) :: dom crossOriginRefs=[]`。即 F-6 确实覆盖了 DOM 层看不见的真实网络出口。

**候选自身套件复跑**：static 套件 synthetic 模式 + 真实 Chrome **6/6 pass**（未 skip）；其落证 `same-origin-1440.json` 显示 `classified=[network,network,inline-data,network]`、`inlineDataRefs=1`、`crossOriginRefs=[]`、`unexpectedRefs=[]`、`overflow=true`、`scrollWidth=1440/1440`，`static-root.json` 记录 `mode:"synthetic"`——边界披露到位。过程中该套件的「`/api` 不 fallback」断言还如实拒绝了我 mock 的一次错误实现（`/api must not fall back to index.html (got 200)`），进一步证明断言可证伪。

## 5. 原断言与预算未弱化

- **测试声明不降**：http 18→18、restart 2→2、static 4→4（顶层 `test(` 计数）；无 test 被删或改名。
- **断言纯增**：`browser-probe` 19→24、restart 46→50；http 183、static 25 不变。
- **restart diff 为纯增量**：唯一删除行是错误绑定 `assert.equal(restoredAction.completedAt, action.completedAt, …)`，替换为 `completedAction.completedAt` 绑定 + 2 条新交叉校验；`stream.reset`/`stream.ready`/`item.changed`/`SIGKILL`/`root lock`/401 等字面名计数全部不变。
- **预算未动**：`--test-timeout=20000` 与用例 `timeout: 60000` 三套件逐一相同。

## 6. 观察项（非阻断）

- **OBS-1**：`f356-verification.mjs` 中我用「先开第二实例再关第一实例」建模重启，因为候选 in-process 夹具的 `close()` 无条件 `rmSync(root)`（`backend-process.mjs:292-295`）。候选自身的 restart 套件用 `startBackendChild` 子进程建模重启（不受此影响），语义正确；但 in-process 夹具对**调用方自备根**也在 `close()` 时删除，与 R2 审查中我实测的「调用方自备根在失败后不被删除」不对称（失败路径有 `ownsRoot` 保护，成功路径没有）。建议后续统一：`ownsRoot` 同样应用于 `close()`。不影响本轮增量正确性。
- **OBS-2**：真实产品 dist 的浏览器路径本轮只在 mock 静态根 + 真实 Chrome 上验证了断言机制（6/6）；产品 UI 的 640px 不溢出等仍以新集成版实测为准（候选已在未验项中如实登记）。

## 7. 未验项（如实开放）

- 任何业务行为仍未执行：http/restart 套件在缺 I/III 产物时全部 PrerequisiteGap；`05f0bc0` 生产修复（BLOCKER-1/2）未经独审，本复审不签。
- 完整 `npm run check`／`build:backend` 打包链／整组 `test:web-manual-items`／Rust 全套归唯一集成者在新冻版本串行执行。
- CLI 路径仍未直接 exercise；存储子进程退出断言待集成轮采纳；Linux/代理、真实凭据/用户根/模型未涉及。
- 先前浏览器两阻断结论（BLOCKER-1 `src/stores/settings.ts` invoke 绑定、BLOCKER-2 `todos.ts`/`pairing.ts` 双 `WebApiClient` 实例）**保留**，不因本轮流检而改变。

## 8. 处置

**通过**（限 II r3 写入增量与受影响路径）。F-3 的完成响应/数据库/重启三方一致性、F-5/F-6 对 `data:` 内联／真实跨源网络／其他不透明 scheme 的判别均已独立关闭，并有可证伪对照与真实 Chrome 聚焦回归；补丁/文件哈希复算相符，原断言与 20000ms 预算未弱化。OBS-1/OBS-2 交后续处理，不阻断。MAYNE-23 保持 `in_progress`；本复审不代签业务通过或原样 UI 通过。
