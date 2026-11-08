# MAYNE-23 切片 II r5 修订候选独立复审（OhMyPi，R5）

> 状态：**通过**（限泄漏判据归属这一新判据；0 阻断、0 观察）。复审对象 `805c4a9a47e1232777b90964a14aad17b52f8076..8b2962d4dd1eac08d902fddaa6b0df3d98ac088c`（2 文件 +104/−4）。审查者是 R4 观察项 OBS-1' 的登记者，未参与 r5 编写。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b947-f3d2-7cc4-bdbf-f9f4978348c8`。
> 依据：R4 审查 `5cdaa3c` 的 OBS-1'；本轮只审新判据归属，fixture ownsRoot 修复及 r4 未改已过面沿用，不重开业务矩阵、不跑完整门禁。

## 1. 登记与版本复算

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `5cdaa3c9cb34856bb7bb612ad9d65fb8b634b3f6` | 与派发一致 |
| 候选 commit / tree | `8b2962d4dd1eac08d902fddaa6b0df3d98ac088c` / `f56a9c3882f0b663d7cf2468554dc7be2d8e37b7` | `git cat-file -t` = commit |
| 父提交 | `8b2962d4^` ＝ `805c4a9a47e1232777b90964a14aad17b52f8076`（直接父子，无 squash/amend/rebase） | 实测 |
| 增量 diff SHA-256 | `a9b640dc660ef5dcbb0dbf96764d5ffede50059c9133e2d466692ff30615a43b` | **＝候选申报值** |
| format-patch SHA-256 | `d166ac797947d57aedc7cda728eec9f04adc4e69ba05197c0ac0aca7c665959c` | **＝候选申报值** |
| 两文件 blob | 回归 `923c9295ffc8c7b9383a4a956a32a74a46e6b3cd`、记录 `9d61092bc053b5377ed39ab18715b686fd092d4a` | 回归项与候选申报一致 |
| fixture 与其余全部 II 文件 | `backend-process.mjs`（`b0b41529…`，ownsRoot 修复）、三个业务套件、`browser-probe`/`static-root`/`backend-child`/`db-observer`/`sse-listener`、`package.json` 与 `805c4a9a` blob 逐一相等 | 实测 SAME |

## 2. 判据收敛本身

`web-manual-items-fixture.test.mjs` 模块作用域建**每次运行私有的临时基座**（`mkdtempSync('web-manual-items-fixture-run-')`，多出 `fixture-run-` 段故永不匹配泄漏正则），把 `TMPDIR` 指向它，`after()` 钩子恢复环境并整基座删除；`selfCreatedRoots()` 从「`readdirSync(tmpdir())`（共享目录全量同前缀集合）」改为「`readdirSync(privateTmpBase)`（本进程根名单）」。判据形状不变：同一正则、前后快照 `deepEqual`。

关键前提已实测成立（Node v24.20.0）：`os.tmpdir()` **每次调用都读 `TMPDIR`**（改写后 `tmpdir()` 返回基座、删除后恢复原值），故夹具内 `mkdtempSync(join(tmpdir(), 'web-manual-items-'))` 全部落进基座。

## 3. 独立复跑（本树实测，退出码与日志）

日志在 `build/web-manual-items-tests-r5-review/`：`r5-verification.log`、`ohmypi-r5-fixture.log`、`ohmypi-r5-{http,restart,static}-prerequisite-gap.log`、`syntax-check.log`、`ohmypi-r5-check-structure.log`、`ohmypi-r5-structure-self-test.log`、`ohmypi-r5-check-docs.log`、`ohmypi-r5-diff-check.log`。

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（4 套件 + 6 夹具） | 0 | 10/10 |
| 六项回归（新字节） | 0 | **6/6 pass** |
| 泄漏判据归属验证（`r5-verification.mjs`，18 项） | 0 | **18/18 pass** |
| 既有三套件 | 1/1/1 | tests 18/2/6，**全部 18/2/6 PrerequisiteGap**（缺 I/III 产物），行为未变；`/tmp` 零残留 |
| `check:structure`（候选 10 文件写入本树） | 1 | 173 处全为基线既有（`.omp/` 170 `top.dir` + `vendor/pi` 3 `ref.missing`），**0 处引用候选文件** |
| `check:structure --self-test` | 0 | 22 类违规 + 8 引用违规检出，clean 不误报 |
| `check:docs` | 0 | 20 文件 429 链接 |
| `git diff --cached --check` | 0 | 干净 |

## 4. 受控并发旧/新对照（关键反例）

自建独立 churn 进程在**共享临时目录**以 20ms 节律循环创建/删除同形合成根（恒保有 4 个），实测扰动 `created=394 / removed=391`（另两轮 392/389、401/398）。两棵探针树**仅判据字节不同**（fixture 同一 blob，单变量）：

- `PASS the two probe trees differ ONLY in the criterion bytes (single variable) :: regression identical=false, fixture identical=true`
- `PASS the shared temp dir starts clean for the controlled experiment :: []`
- **旧字节 + 受控并发：exit 1，tests 6／pass 4／fail 2**；`PASS every OLD failure is a selfCreatedRoots() leak assertion (false positive from foreign churn)`，两个失败用例均含 `selfCreatedRoots()` 泄漏断言
- `PASS the OLD false positive is foreign churn, not a real leak :: actual: ['web-manual-items-1gUy87','web-manual-items-dSKPny','web-manual-items-xs8aPO'] vs expected: ['web-manual-items-C9Lqxz','web-manual-items-GjRvZu','web-manual-items-WdjlRO']` —— actual/expected 全是 churn 进程创建/删除的目录，本进程未泄漏任何根
- **新字节 + 同规格并发：exit 0，6/6 pass**；无并发同样 6/6 exit 0

即误报根因被独立复现，且新判据在同等并发下不再误报。

## 5. 本进程真实泄漏仍被拒（两处泄漏点，非忽略断言）

对 fixture 各删一行自建根清理（其余字节不动，行数不变）：成功 `close()` 路径泄漏、失败路径泄漏。

- `PASS both leak mutations actually changed the fixture (and only that)`
- 成功路径泄漏：`PASS a real success-path leak is rejected by the NEW criterion (no churn) :: exit=1 fail=1 ["close() on the success path removes a root the fixture created"]`；`PASS … STILL rejected under controlled concurrency :: exit=1 fail=1`
- 失败路径泄漏：`PASS a real failure-path leak is rejected by the NEW criterion (no churn) :: exit=1 fail=1 ["a failed start (pairing timeout) removes a root the fixture created"]`；`PASS … STILL rejected under controlled concurrency :: exit=1 fail=1`
- 检测力基线：`PASS the OLD criterion also rejects the same real leak (detection power not reduced) :: exit=1 fail=1`

即判据是**收敛归属**而非**削弱检测**：并发不能掩盖真实泄漏，旧判据对同一泄漏同样拒签。

## 6. 环境恢复与私有基座收尾

- `PASS TMPDIR redirection sends this process's roots into the private base :: {"redirectedIsBase":true,"innerInsideBase":true,…}`
- `PASS the environment is restored and the private base is removed by the teardown :: {"restored":"/tmp/multica-task-…","baseGone":true}`
- `PASS the NEW-criterion runs add nothing to the shared temp dir (its roots stay in the private base) :: pre-existing=0, left by the OLD runs=0, added by the NEW runs=0`
- `PASS no private per-run base is left behind :: []`

## 7. 六项语义覆盖与预算保留

- **六个用例声明与名称逐字未动**（`diff` 为空）。
- `assert.` **19 处**（r4 与 r5 相同）。
- 预算未动：`--test-timeout=20000` 继承、`pairingTimeoutMs: 300`；全套实测 <1.5s。
- fixture（ownsRoot 修复）、三个业务套件、`package.json` 字节不变。

## 8. 未验项（如实开放）

- 完整 `npm run check`／`build:backend`／整组 `test:web-manual-items`／Rust 全套归唯一集成者在新冻版本串行执行。
- 既有三套件在本树无 I/III 产物，按设计 PrerequisiteGap；其唯一模式行为不变沿用 r4 结论（字节相同 + 从不传调用方 root + r4 单变量对照三重证明）。
- OhMyPi 浏览器旅程、CLI 路径、Linux/代理、真实凭据/用户根/模型未涉及；r4 及此前已过面不重开。

## 9. 处置

**通过**（限泄漏判据归属这一新判据）。OBS-1' 已按建议收敛：临时根只在本进程私有基座内创建，泄漏检查只读该名单；受控并发下旧字节误报（两个 `selfCreatedRoots()` 断言被他进程扰动，actual/expected 均为外来目录）而新字节 6/6 通过，本进程真实泄漏在两处泄漏点及并发下均仍被拒，检测力未削弱；环境恢复与基座收尾直接观测成立；六项用例/断言数/预算/fixture/三业务套件/`package.json` 全部未动。补丁与文件哈希复算相符。MAYNE-23 保持 `in_progress`；本复审不代签业务通过或完整门禁通过。
