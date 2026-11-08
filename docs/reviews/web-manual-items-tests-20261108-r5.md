# MAYNE-23 切片 II r5 泄漏判据收敛（Kimi）：OBS-1'——只跟踪本进程创建的根

> 状态：**泄漏判据已收敛，受控并发旧/新对照证明不再误报，本进程真实泄漏仍被拒；W1 未准出**。本篇是派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 触发评论 `01a1b93c-4653-7cae-831a-af26d82231aa` 对切片 II 候选 `805c4a9a47e1232777b90964a14aad17b52f8076` 的新增修正（r5）：OhMyPi r4 独审（提交 `5cdaa3c`）登记的非阻断观察 OBS-1'——新回归用「`/tmp` 中匹配 `^web-manual-items-[A-Za-z0-9]{6}$` 的自建根名单前后全等」做泄漏断言，该集合可被其他并行进程（同前缀 `mkdtemp`）干扰而偶发误报。按派发只收敛该泄漏判据与自有证据；fixture 已审 ownsRoot 修复、既有三业务套件、六项语义覆盖与预算均不动，未跑完整门禁，MAYNE-23 保持 in_progress。r4 记录见 [web-manual-items-tests-20261108-r4.md](web-manual-items-tests-20261108-r4.md)（OBS-1 已闭，已过面不重开）。证据约定见[验证约定](../engineering/verification.md)。

## 1. 判据收敛（唯一改动文件，+26/−4）

`tests/integration/web-manual-items-fixture.test.mjs` 的泄漏断言原先对整个共享临时目录的同前缀集合做前后全等，无法区分「本进程泄漏」与「他进程同前缀扰动」。收敛为**只跟踪本进程创建的根**：文件模块作用域先建一个每次运行私有的临时基座（`mkdtempSync('web-manual-items-fixture-run-')`，建在真实共享目录、名字多出 `fixture-run-` 段故永不匹配泄漏正则），把 `process.env.TMPDIR` 指向它（`os.tmpdir()` 每次调用都读环境变量，本机 Node v24.20.1 实测），并用 `after()` 钩子在收尾时恢复环境并整基座删除。于是本进程创建的一切临时根——夹具 `mkdtempSync('web-manual-items-')` 自建根、stub 工作区、调用方根——都只落在该基座内；泄漏检查只读这一份「本进程根名单」，stub/caller 前缀仍被同一正则排除。

```diff
-import test from 'node:test';
+import test, { after } from 'node:test';
...
-// mkdtempSync('web-manual-items-') names; the stub/caller prefixes carry extra segments and
-// are excluded, so the leak check sees exactly the roots the fixture itself created.
+// (私有基座块：mkdtempSync('web-manual-items-fixture-run-') → process.env.TMPDIR 指向它；
+//  after() 恢复 TMPDIR 并 rmSync 整基座；注释说明 OBS-1' 归因理由)
 const selfCreatedRootName = /^web-manual-items-[A-Za-z0-9]{6}$/;
 function selfCreatedRoots() {
-  return readdirSync(tmpdir()).filter((name) => selfCreatedRootName.test(name)).sort();
+  return readdirSync(privateTmpBase).filter((name) => selfCreatedRootName.test(name)).sort();
 }
```

判据形状不变（同一正则、前后快照 `deepEqual`），只是被比较的集合从「整个共享目录同前缀集」换成「本进程私有基座内的同前缀集」：本进程真实泄漏仍落在基座内、仍被拒；他进程在共享目录的创建/删除不可见。

## 2. 受控并发旧/新对照（关键反例）

受控另一进程 `churn.mjs`：独立进程在共享临时目录以 20ms 节律循环 `mkdtempSync('web-manual-items-')`（与泄漏正则同形）并滚动删除（同时保有 4 个），持续 9s——模拟三业务套件（各自独立进程、同前缀 mkdtemp）或任何其他租户并行扰动。三次运行分别创建/删除 401／417／402 个合成根。驱动 `run.sh`，两棵探针树仅测试字节不同（夹具字节两树同一 blob，单变量）：

| # | 场景 | exit | 结果 |
|---|---|---|---|
| 01 | 新字节、无并发 | 0 | 6/6 pass |
| 02 | **旧字节 + 受控并发** | **1** | **误报**：6 tests／4 pass／2 fail |
| 03 | **新字节 + 同规格受控并发** | **0** | 6/6 pass，不再误报 |

02 的两处失败正是两个 300ms 配对超时用例的泄漏断言（`a failed start must not leak a temporary root`／`a failed start must remove a root the fixture created`），断言 diff 即关键反例：actual 为并发进程创建的 `web-manual-items-AzcReG/H6tKyA/Y8lIFT/mzGv0d`，expected 为被并发进程删掉的 `web-manual-items-RWJf9k/UPHFa4/dVFAU7/jgIwef`——本进程未泄漏任何根，旧判据纯误报。03 同规格并发下新判据 6/6。

## 3. 本进程真实泄漏仍被拒（反例，两处泄漏点逐一）

以两份合成变异夹具（仅删一行自建根清理，其余字节不动）证明收敛没有靠「忽略泄漏断言」通过：

| # | 场景 | exit | 失败断言 |
|---|---|---|---|
| 04 | 新字节 vs 成功 `close()` 路径泄漏 | 1 | `close() on the success path removes a root the fixture created`：`a root the fixture created must be removed by close()` |
| 05 | 新字节 vs 失败路径泄漏 | 1 | `a failed start (pairing timeout) removes a root the fixture created`：私有基座名单 actual `['web-manual-items-ZImAXt']` vs expected `[]` |
| 06 | 05 + 受控并发 | 1 | 同上唯一失败——并发不能掩盖真实泄漏 |
| 07 | 对照：旧判据 vs 失败路径泄漏 | 1 | 同上唯一失败——旧判据同样拒签，检测力未被收敛削弱 |

05 的断言 diff 同时证明新判据的私有基座 `deepEqual` 仍在实质工作（泄漏根精确出现在 actual 名单）。

## 4. 本机守卫（均非完整门禁）

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（收敛后回归文件） | 0 | 1/1 |
| `node --test --test-timeout=20000 tests/integration/web-manual-items-fixture.test.mjs` | 0 | 6/6 pass（01） |
| `node scripts/checks/check-structure.mjs --self-test` | 0 | 违规全检出、clean 不误报 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | 1 | 173 处**全部为先存环境条件**（`.kimi/` 170 `top.dir`、`vendor/pi` 3 `ref.missing`，与 r4 同口径），**0 处引用本切片文件** |
| `npm run check:docs` | 0 | 20 文件 429 链接全解析 |
| `git diff --check` | 0 | 干净 |

进程/目录收尾：驱动前后 stub 存储子进程残留 0/0（`ps` 核 `setInterval(() => {}, 1000)` 替身 0 个）；各用例内仍断言 close 后子进程 ESRCH（未动）。探针运行后共享目录同前缀合成根 0、私有基座 0（旧字节两次运行遗留的 8 个 `web-manual-items-caller-*` mkdtemp 父目录与 07 检测到的 1 个泄漏根已由本轮回清理；新字节运行因 `after()` 整基座清扫，自身零残留）。

## 5. 语义覆盖与预算清点

- 六项用例声明与名称逐字未动；`assert.` 调用 19（`equal` 6、`deepEqual` 4、`ok` 3、`rejects` 5、`fail` 1）与 r4 登记一致——四项泄漏 `deepEqual` 全部保留且仍拒签（§3）。
- 预算：文件不自带 per-test 超时（继承 `--test-timeout=20000`），`pairingTimeoutMs: 300` 未动；全套实测 <1.5s（01 duration_ms 726）。
- 未改面（逐字节）：`tests/fixtures/web-manual-items/backend-process.mjs`（ownsRoot 修复未动）、http/restart/static 三业务套件、`package.json`；`git diff 805c4a9 -- tests/` 仅回归文件一文件（+26/−4）。

## 6. 未验项与边界

- 完整 `npm run check`／`build:backend`／整组 `test:web-manual-items`／Rust 全套归唯一集成者新冻版本串行执行；本树无 I/III 产物，三套件按设计 PrerequisiteGap（与历轮同口径），其唯一使用模式行为不变已由字节相同＋从不传调用方 root＋r4 单变量对照三重证明。
- 新回归文件加入集成树 `test:web-manual-items` 脚本（`package.json` 属集成写入范围，本轮未动）沿用 r4 §6 建议命令。
- OhMyPi 浏览器旅程、CLI 路径、Linux/代理、真实凭据/用户根/模型未涉及；未 push、未合 main、未改 MAYNE-23 状态；r4 及此前结论不重开。OBS-1' 关闭以本记录与派发线程回帖为准。

## 7. 交付物

精确提交 SHA/tree、相对 `805c4a9` 的补丁与 format-patch 哈希、文件 blob 哈希见派发线程回帖；admission（pwd/branch/HEAD/基点核对/写入范围）、七场景 TAP 与 exit、churn 统计、守卫日志、增量补丁随评论附件（`w1-ii-r5-leak-criterion-evidence.tar.gz` + `SHA256SUMS.txt`；日志中本机工作树路径已替换为 `<worktree>`，不含配对码/cookie/token）。修后限定独审请队长按精确版本另派。
