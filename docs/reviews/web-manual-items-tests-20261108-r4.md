# MAYNE-23 切片 II r4 夹具所有权退修（Kimi）：OBS-1 成功 close() 尊重 ownsRoot + 所有权回归

> 状态：**夹具缺陷已修，所有权回归旧/新对照通过（旧字节精确失败于新断言、新字节 6/6 exit 0）；W1 未准出**。本篇是派发线程 `01a1b81e-3cdb-78b4-8791-d12c8931f8f7` 触发评论 `01a1b928-4876-7187-8329-ba2d1d9eb1a6` 对切片 II 候选 `229c8cb4` 的新增修正（r4）：OhMyPi r3 独审（提交 `4856d4e`，记录 `docs/reviews/web-manual-items-tests-20261108-ohmypi-r3-review.md`，在审查方隔离树，未在本分支）登记的非阻断观察 OBS-1——in-process 夹具 `close()` 无条件 `rmSync(root)`，失败路径有 `ownsRoot` 保护而成功路径没有，调用方自备根在成功关闭时也被删。按派发只改该夹具所有权逻辑、必要 II 回归与自有记录；I/III、预算、真实用户根未触碰，MAYNE-23 保持 in_progress。上一轮记录见 [web-manual-items-tests-20261108-r3.md](web-manual-items-tests-20261108-r3.md)（F-3/F-5/F-6 已关闭，未改面结论沿用）。证据约定见[验证约定](../engineering/verification.md)。

## 1. 缺陷与修复

`tests/fixtures/web-manual-items/backend-process.mjs` 的 `startBackend` 在 r2 引入 `ownsRoot`（仅夹具自建根可删），失败路径（:301）遵守，但成功路径 `close()`（修订前 :292-295）无条件 `rmSync(root, {recursive:true, force:true})`——调用方以 `options.root` 显式传入的合成根及其内容（含生产实现写入的库文件）在成功关闭时被整体删除。当前三套件均不以调用方根调用 `startBackend`（http/static 无 root 传入，restart 走 `startBackendChild` 子进程模式，其 `close()`/`release()` 只删自建 `configDir`、从不触碰调用方 root），故缺陷未在既有套件暴露，属夹具 API 所有权缺口。

修复（唯一行为行＋注释）：

```diff
       async close() {
         await handle.close();
-        rmSync(root, { recursive: true, force: true });
+        if (ownsRoot) rmSync(root, { recursive: true, force: true });
       },
```

`await handle.close()` 仍在删根之前且被 await（生产语义：等待 HTTP/SSE、存储子进程与根锁释放），成功/失败两条路径现在遵守同一所有权规则：调用方根及内容保留，夹具自建根清理。`startBackendChild` 未改（其删除对象 `configDir` 恒为自建）。

## 2. 必要 II 回归（新文件，单一领域主题）

`tests/integration/web-manual-items-fixture.test.mjs`（6 例，无构建产物依赖）：夹具对接界面由夹具自身钉住（`startWebBackend(config)` 解析 `{origin, close}`），回归以合成 stub 入口实现该界面——spawn 存储子进程替身并记录 pid、向 root 写入初始化标记、`close()` SIGKILL 并 reap 子进程——从而在没有 I/III 产物的树上也能运行夹具自身的所有权与收尾逻辑。生产行为仍由真实 HTTP/restart/static 三套件背书，本篇不签任何业务结果。

| 用例 | 覆盖（对应派发要求） |
|---|---|
| `close() on the success path preserves a caller-supplied root and its contents (OBS-1)` | 成功关闭＋调用方根内容保留（调用方标记、嵌套内容、后端写入内容均在）＋进程收尾（stub 存储子进程已消亡） |
| `close() on the success path removes a root the fixture created` | 成功关闭＋自建根清理＋进程收尾 |
| `a failed start (pairing timeout) closes the handle and preserves a caller-supplied root` | 失败关闭（配对超时，handle 存在后的失败路径）＋调用方根保留＋进程收尾＋无临时根泄漏 |
| `a failed start (pairing timeout) removes a root the fixture created` | 失败关闭＋自建根清理＋进程收尾 |
| `an entry without startWebBackend fails with PrerequisiteGap and leaks no root` | 界面不符失败＋调用方根保留＋无泄漏 |
| `a missing entry or storage binary fails with PrerequisiteGap before the root is touched` | 前置缺失失败（早于任何 root 创建）＋调用方根保留 |

显式合成根：调用方根为 `mkdtemp` 下带 `caller-marker.txt`／`nested/deep.txt` 的具名目录；自建根泄漏检查按 `mkdtempSync('web-manual-items-')` 精确命名匹配，排除 stub/caller 前缀。

## 3. 真实聚焦回归与旧/新对照（显式合成根，单变量）

- **新字节（本树修订后）**：`node --test tests/integration/web-manual-items-fixture.test.mjs` → **exit 0，6/6 pass**（日志 `01-new-fixture-regression.log`）。
- **旧/新对照**（驱动 `ab-old-new.sh`，两棵隔离树仅夹具字节不同）：旧侧取 `git show 229c8cb4:tests/fixtures/web-manual-items/backend-process.mjs`，blob 复核 `224a0b6b…283b4` 与 `git rev-parse 229c8cb4:<path>` 逐字节相同；回归文件两树同一 blob `8808b085…1486`（单变量）。结果：**旧 exit 1（5 pass / 1 fail），新 exit 0（6/6）**；旧侧唯一失败正是 OBS-1 用例，断言详情 `the caller-supplied root must survive: /tmp/…/web-manual-items-caller-…/success`——旧 `close()` 删除了调用方根。其余 5 例（含失败路径所有权、自建根清理、进程收尾）新旧均通过，证明修复未改动失败路径与自建根语义。
- **进程收尾**：驱动前后 `pgrep -f` stub 子进程残留在 0/0；各用例内断言 close 后存储子进程 ESRCH。

## 4. 本机守卫（均非完整门禁）

| 命令 | exit | 结果 |
|---|---|---|
| `node --check`（夹具＋回归） | 0 | 2/2 |
| `node scripts/checks/check-structure.mjs --self-test` | 0 | 违规全检出、clean 不误报 |
| `node scripts/checks/check-structure.mjs`（仓库模式） | 1 | 173 处**全部为先存环境条件**（`.kimi/` 170 `top.dir`、`vendor/pi` 3 `ref.missing`，与 r3 同口径），**0 处引用本切片文件** |
| `npm run check:docs` | 0 | 20 文件 429 链接全解析 |
| `git diff --check` | 0 | 干净 |

## 5. 断言与预算清点

- 新回归文件：`test(` 声明 6；`assert.` 调用 19（`equal` 6、`deepEqual` 4、`ok` 3、`rejects` 5、`fail` 1）。
- 既有套件**零改动**：`git diff 229c8cb -- tests/` 仅夹具一文件（+8/−2，其中行为行 1）；http 18 / restart 2 / static 4+2 循环声明与全部 `assert.` 计数不变（r3 §6 口径沿用）。
- 预算：`--test-timeout=20000`、用例 `timeout: 60000` 未动；新文件不自带超时（内部 `pairingTimeoutMs: 300` 为夹具配置非套件预算），接入 `test:web-manual-items` 链时任一 `--test-timeout` 均远够（实测全套 <1.5s）。

## 6. 未验项与边界

- 完整 `npm run check`／`build:backend` 打包链／`test:web-manual-items` 整组／Rust 全套归唯一集成者新冻版本串行执行；本树无 I/III 产物，三套件按设计 PrerequisiteGap（与历轮同口径），其唯一使用模式（`startBackend` 无调用方根 → `ownsRoot=true`）已由旧/新对照中「自建根清理」用例在新旧字节双双通过证明行为不变。
- 新回归文件需由集成轮加入集成树 `test:web-manual-items` 脚本（`package.json` 属集成写入范围，本篇未动）：建议 `node --test --test-timeout=20000 tests/unit/web-manual-items.test.mjs tests/integration/web-manual-items-fixture.test.mjs tests/integration/web-manual-items-http.test.mjs tests/integration/web-manual-items-restart.test.mjs tests/integration/web-manual-items-static.test.mjs`。
- OhMyPi 浏览器旅程、CLI 路径、Linux/代理、真实凭据/用户根/模型未涉及；未 push、未合 main、未改 MAYNE-23 状态；r3 及此前结论不重开。

## 7. 交付物

精确提交 SHA/tree、相对 `229c8cb4` 的补丁与 format-patch 哈希、admission（pwd/branch/HEAD/基点核对/写入范围/评审者登记）见派发线程回帖；admission.json 与全部原始日志（聚焦回归、旧/新 TAP、identity、进程残留、守卫）随评论附件（`w1-ii-r4-obs1-evidence.tar.gz` + SHA256SUMS）。
