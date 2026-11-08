# MAYNE-23 切片 II r4 修订候选独立复审（OhMyPi，R4）

> 状态：**通过**（限 II r4 写入增量与必要 II 回归；0 阻断、1 观察非阻断）。复审对象 `229c8cb4b1b1b29da3ea7b64d632cc24a4b1a41b..805c4a9a47e1232777b90964a14aad17b52f8076`（3 文件 +277/−2）。审查者是 R3 观察项 OBS-1 的登记者，未参与本 increments 编写。
> 派发：MAYNE-23 派审线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7`，触发评论 `01a1b934-a1c1-7aed-beed-3cab8f7ee810`。
> 依据：R3 审查 `4856d4e` 的 OBS-1；本轮不改 `package.json`、不提前集成、不重跑完整门禁，r3 未改已过面继续沿用。

## 1. 登记与版本复算

| 项 | 值 | 核对 |
|---|---|---|
| 审查树 branch / HEAD | `agent/ohmypi/mayne-23` / `4856d4eb1ef9af1c694ed0b98bbfee05554312f1` | 与派发一致 |
| 候选 commit / tree | `805c4a9a47e1232777b90964a14aad17b52f8076` / `d34fd4881bb1ea74b1549b0dff169630eb03373d` | `git cat-file -t` = commit |
| 父提交 | `805c4a9a^` ＝ `229c8cb4b1b1b29da3ea7b64d632cc24a4b1a41b`（直接父子，无 squash/amend/rebase） | 实测 |
| 增量 diff SHA-256 | `9b0db1c70e6cdc727e2f0a582c78aba6636c97617826a8ba73da9d5909a3a9e3` | **＝候选申报值** |
| format-patch SHA-256 | `83b4bbf1e24479413bc915ca39a74d89a985c77da250d627772fa71d8cd900cc` | **＝候选申报值** |
| 三文件 blob 前 16 位 | 夹具 `b0b415294ca878f9`、回归 `8808b08527398ed4`、记录 `d5aa356cbbd201fd` | 前两项与候选申报一致 |
| r4 记录文档 SHA-256 | `6ebcb30cdf67fb931f37554e60ed88fc08556792c89fecbb31ebfbdb3dcf0576` | **＝候选申报值** |

**既有面未改（逐字节）**：`web-manual-items-http.test.mjs`、`web-manual-items-restart.test.mjs`、`web-manual-items-static.test.mjs`、`browser-probe.mjs`、`static-root.mjs`、`backend-child.mjs`、`db-observer.mjs`、`sse-listener.mjs` 与 `229c8cb4` blob 逐一相等；`package.json` **未动**（本轮不碰预算）。三套件从不向 `startBackend` 传调用方 `root`（只传 `staticRoot`，另一选项），故其唯一模式 `ownsRoot=true` 行为不变。

## 2. OBS-1 修复本身

`backend-process.mjs` 成功路径 `close()`：

```js
async close() {
  await handle.close();
  if (ownsRoot) rmSync(root, { recursive: true, force: true });
}
```

`await handle.close()`（生产语义：等待 HTTP/SSE、存储子进程与根锁释放）仍在删根**之前且被 await**；`ownsRoot` 现同时守护成功与失败路径；`startBackendChild` 未改（只删自建 `configDir`）。与 R3 建议一致，无附带行为变化。

## 3. 独立复跑（本树实测，退出码与日志）

日志在 `build/web-manual-items-tests-r4-review/`：`syntax-check.log`、`ohmypi-r4-fixture.log`、`ab-verification.log`、`ohmypi-r4-{http,restart,static}-prerequisite-gap.log`、`ohmypi-r4-check-structure.log`、`ohmypi-r4-structure-self-test.log`、`ohmypi-r4-check-docs.log`、`ohmypi-r4-diff-check.log`。

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（4 套件 + 6 夹具） | 0 | 10/10 |
| `node --test --test-timeout=20000 tests/integration/web-manual-items-fixture.test.mjs` | 0 | **6/6 pass** |
| 旧/新夹具单变量 A/B（显式合成根） | 0 | OLD exit 1（5 pass／1 fail）；NEW exit 0（6/6） |
| `node --test --test-timeout=20000` 既有三套件 | 1/1/1 | tests 18/2/6，**全部 PrerequisiteGap**（缺 I/III 产物）；失败后 `/tmp/web-manual-items-*` = 0 |
| `check:structure`（候选 11 文件写入本树） | 1 | 173 处全为基线既有（`.omp/` 170 `top.dir` + `vendor/pi` 3 `ref.missing`），**0 处引用候选文件** |
| `check:structure --self-test` | 0 | 22 类违规 + 8 引用违规检出，clean 不误报 |
| `check:docs` | 0 | 20 文件 429 链接 |
| `git diff --cached --check` | 0 | 干净 |

## 4. 六项新回归与旧/新单变量对照

### 4.1 新回归六例（候选自身套件，独立复跑）

`node --test --test-timeout=20000 tests/integration/web-manual-items-fixture.test.mjs` **exit 0，6/6 pass**：

1. 成功 `close()` 保留调用方根及内容（OBS-1）
2. 成功 `close()` 删除夹具自建根
3. 失败启动（配对超时）关闭句柄并保留调用方根
4. 失败启动（配对超时）删除夹具自建根
5. 入口缺 `startWebBackend` → `PrerequisiteGap`，不泄漏根
6. 入口/存储二进制缺失 → `PrerequisiteGap`，根不被触碰

用例用合成 stub 对接界面（自建 `startWebBackend(config)` → `{origin, close}`，spawn 一个替身存储子进程并记录 pid，向根写入 marker），因此不依赖构建产物即可验证夹具自身的所有权、清理与进程收尾逻辑；业务行为仍由真实 HTTP/重启/静态套件覆盖。

### 4.2 旧/新单变量 A/B（`ab-verification.mjs`）

两棵树**仅夹具字节不同**（旧 18 375 B／新 18 923 B），回归文件两树同一 blob：

- `PASS the two trees differ ONLY in the fixture bytes (single variable)`
- **OLD exit 1，tests 6／pass 5／fail 1**；`PASS the OLD failure is exactly the caller-root preservation assertion :: the caller-supplied root must survive: /tmp/…/web-manual-items-caller-…/success`
- `PASS the OLD side fails only the OBS-1 case and no other case :: ["close() on the success path preserves a caller-supplied root and its contents (OBS-1)"]`
- **NEW exit 0，tests 6／pass 6／fail 0**

即旧夹具精确漏签 OBS-1、新夹具精确拒签，单变量归因成立。

### 4.3 语义直验（新夹具 + 显式调用方根）

- `PASS a caller-supplied root survives a SUCCESSFUL close()`；`PASS the caller root's own content survives`（`caller-marker.txt` 内容逐字节）；`PASS content the backend wrote into the caller root also survives`（stub 写入的 `stub-initialized.marker`）
- `PASS a fixture-created root exists while the backend runs` → `PASS a fixture-created root is removed by a successful close()`
- 失败路径：`PASS a failed start reports the pairing-code timeout`；`PASS a caller-supplied root survives a FAILED start`；内容保留
- 进程收尾（三条路径各一例）：`PASS the backend child is reaped by close() (ESRCH)`（成功关闭）、（自建根成功关闭）、（失败启动）
- await 顺序：`PASS a caller-supplied root survives even when the handle close is slow (await ordering)`；`PASS close() resolves only after the awaited handle close completes (>= the 600ms handle delay) :: elapsed=605ms`；`PASS the fixture-created root is removed only after the awaited handle close completed`
- 泄漏：`PASS no fixture-created temporary root leaks after all cases :: []`

合计 21/21 PASS。

## 5. 观察项（非阻断）

- **OBS-1'**：新回归用「`/tmp` 中匹配 `^web-manual-items-[A-Za-z0-9]{6}$` 的自建根名单前后相等」做泄漏断言。该正则可被**其他并行进程**（同前缀的 mkdtemp）干扰——若另一进程在断言窗口内创建/删除同名模式目录，会产生偶发误报。本树单进程复跑稳定通过（且旧/新两侧都用了同一判据，未影响归因）。建议后续把泄漏判据收敛为「本进程创建的根名单」而非全局目录扫描。不影响本轮增量正确性。

## 6. 未验项（如实开放）

- 完整 `npm run check`／`build:backend` 打包链／整组 `test:web-manual-items`／Rust 全套归唯一集成者在新冻版本串行执行。
- 新回归文件加入 `test:web-manual-items`（`package.json`）属集成写入范围，本轮按派发未动；保留 20000ms 预算（新文件自身未声明 per-case timeout，继承 `--test-timeout=20000`）。
- 既有三套件在本树无 I/III 产物，按设计 PrerequisiteGap；其唯一模式（`ownsRoot=true`）行为不变已由「字节相同 + 从不传调用方 root + 单变量对照中该模式两例新旧均过」三重证明。
- OhMyPi 旅程、CLI 路径、Linux/代理、真实凭据/用户根未涉及；r3 已过面未重开。

## 7. 处置

**通过**（限 II r4 写入增量与必要 II 回归）。OBS-1 已按建议修复：成功 `close()` 与失败路径同样遵守 `ownsRoot`，`await handle.close()` 仍在删根之前；调用方根及内容（含后端写入）在成功/失败关闭下均保留，自建根均清理，存储子进程在三条路径下均被 reap，`close()` 仅在 await 句柄完成后解析。六项新回归独立复跑 6/6，旧/新单变量对照精确归因（旧 5/1 fail 且唯一失败即 OBS-1 用例，新 6/6）。补丁/文件/记录哈希复算相符；既有三套件与 `package.json` 字节不变、预算未动。OBS-1' 交后续处理，不阻断。MAYNE-23 保持 `in_progress`；本复审不代签业务通过或完整门禁通过。
