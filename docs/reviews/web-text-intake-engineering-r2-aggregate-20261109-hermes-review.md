# `9ab8ee0` 工程登记（test:web-text-intake 窄追加）独立限定审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bf24`（Codex，接替 Claude，其分支无工程评审产物、不计通过）。对象：`9ab8ee0f1212d5408148c886ca7768a6276a89fa`（tree `5e7d02b31f04c27522327800bf3b8179ca61bfb0`）三文件——`package.json` 1/1、`docs/reviews/web-text-intake-engineering-20261109-r2.md` 75/0、`docs/reviews/README.md` 2/1；父 `cce6cfb` 复核一致。复用已锁定输入，未跑任何套件、未改 package／索引／生产／测试。

## 结论

**通过（限工程登记面）。** 全部核查项独立复算成立；被登记字节、顺序、不变面与已审状态引用逐项属实；排除项与前置构造边界如实登记。

## 逐项核查（全部本轮独立复算）

| 派工判据 | 结果 |
|---|---|
| 九文件入口 | `test:web-text-intake` 值恰 9 路径，前缀 `node --test --test-timeout=20000` 原样 |
| 原六文件相对顺序 | 不变（I 两单元 idx 0/1，II 四 integration idx 5–8 原顺序）；恰 3 新单元插在 lifecycle（第 2 位）后，顺序＝派工点名 MCP 配对→recovery→events |
| 脚本名集合 | 107 个脚本名称与顺序和 `cce6cfb` 完全一致；唯一值变化＝`test:web-text-intake`（自写 JSON 全量对比，非引用作者记录） |
| 20000ms | 仅聚合值内前缀，未放大任何预算 |
| check 链 | 52 段逐字节相同，聚合在链尾引用 1 次不变 |
| 依赖／锁 | `dependencies`/`devDependencies` 及其余全部顶层键逐字节相同；`package-lock.json` blob 两树同 id（`6dd5dd5e…`），零变化 |
| blob 及登记边界 | 见下 |
| 排除项 | `tests/unit/web-text-intake-test-safety.test.mjs` 未纳入 ✓（按 `01a1bed7` 未交审） |
| 索引 | README 129→130，仅顶部新增本记录一行，其余无改动 |

## 被登记字节（对象库逐项复核，blob id 即内容寻址）

- **MCP 配对 `a02af9e`**（tree `2fda915f…` ✓，父 `85fb851` ✓，恰 4 新文件 ✓）：单测 `3011552f`（SHA-256 `80717c43…`、27047 B）＋frames `7a1dfac0`＋golden 帧 `97f8bfaf`（SHA-256 `35d7b97e…`＝P-3 冻结帧包登记哈希，ZCode 记录第 6 次复验）＋worker `d8bf1dab`（路径 `mcp-pairing-worker.mjs`）——四 blob 与记录表格及 ZCode 独审登记逐字节一致。
- **recovery `82e1bf2`**（tree `a6b25de9…` ✓，父 `b232828` ✓，恰改 1 文件 ✓）：测试 `8c641b11`（SHA-256 `3ab536c9…`、42909 B）＋两夹具 `5fe68cb4`/`6d638db0` ✓；测试内容确认按**路径**加载两夹具（登记的构造边界成立）。
- **events `727c6fb`**（tree `70b77cda…` ✓，父 `599d1cf` ✓，恰 1 新文件 ✓）：单文件 blob `67f52618`（513 行）✓；实测导入恰 9 个 `server/lib` 模块——「在集成生产树上闭合」的前置边界登记属实且必要。
- 7 个 `.mjs` 从对象库提取副本逐一 `node --check` exit 0（复现记录声明）。

## 已审状态引用（不新签，核对原记录）

MCP 配对＝ZCode 限定通过（`31434282` 可证伪回归输入 4/7＋scratch 11/11 两遍；四文件 SHA 逐字在其记录）＋OpenCode `59b405f`（scheduler 单文件 +33/−7）树内同四文件 blob 一致、11/11 实跑；recovery/events＝`cce6cfb`（HEAD `7613843` 两轮 11/11、recovery 基线 10/11 恰 D1 红＋缺件补齐披露、events 基线 5/11 六失败面对应）——引用数字与原记录逐一吻合，登记未代签任何独审结论。

## 边界

本树九个聚合文件零落盘（不造占位）、无测试／生产／Runtime 字节写入、未跑套件与完整 gate；登记仅主张「哪些精确字节进入聚合＋跑起来需要什么前置」，不构成业务准出。MAYNE-24 保持 `in_progress`。
