# W1 I 类型映射退修限定复审（ZCode，2026-11-08）

> 结论：**通过**（最终门禁拦截的三处 TS 错误在该增量中全部消除且仅以最小面消除；minute/day/null、due/followup 与 manual 来源转换实测保留冻结语义；新增用例实跑客户端转换并能拒绝旧错误映射；未发现新的阻断或登记级问题）。
> 审查对象：`agent/claude/mayne-23` 增量 `4ca93440b9bb86623e2c9f0f309f4ff462bebcf6..ff5d6c24e1a8c4ad006ad52532b64fdf47f7c064`（父即已审 R2 通过版 `4ca93440`），沿 R2 记录 `4889f87` 的结论做限定复审；未改且已过部分（Rust、服务端、HTTP/重启/CLI 面）不重开。
> 审查者：ZCode（I 首轮与 R2 独立审查者，未参与本次客户端修订），按派审线程 `01a1b898-99cc-77bc-87c2-ff70d2580b4c` 执行。
> 候选只读：以 /tmp 临时 `git archive` 导出阅读与验证，本隔离树仅写入本记录与 gitignored `build/web-manual-items-typecheck-review/`；临时树审查后已删除，自建进程为零（仅前台 vue-tsc／node --test，`pgrep` 复核无残留）。环境：macOS arm64、Node v24.20.0。

## 1. 版本与增量身份（全部实测一致）

| 项 | 交付声明 | 实测 | 判定 |
|---|---|---|---|
| 候选提交 | `ff5d6c24e1a8c4ad006ad52532b64fdf47f7c064` | 同，tree `f99af22cb00b40dc7d7d07bd2c81e501f9aeaf32`，父即 `4ca93440`（衔接 R2 通过链 `74c023c→4052d47→4ca93440→ff5d6c2`） | 一致 |
| 增量补丁 `4ca93440..ff5d6c2` | `7ef64137ecc2253557099cbfcfa66ac6f794620e9403ff616089d1ae7d25331f` | 同（`03-increment-4ca93440-ff5d6c2.patch`） | 逐字节一致 |
| 累计补丁 `bc4b1c3..ff5d6c2` | `b0e03254f3530d44607d24861729889b1e86dc480742a41bc98decee58aaa002` | 同（`04-cumulative-bc4b1c3-ff5d6c2.patch`） | 逐字节一致 |
| 增量规模 | 3 文件 +93/−8 | 同（numstat：client +17/−5、tests +52/−0、record +24/−3）；`git diff --check` 无空白错误 | 一致 |
| 逐文件 SHA-256 | client `b4bec882…3fc16`、tests `d0b7ebfe…1d7a` | 2/2 实测一致 | 一致 |

- **写入范围**：仅派审允许的两文件＋I 自有交付记录 `docs/reviews/web-manual-items-implementation-20261108.md`（三处哈希刷新＋纯追加 §8，内容与实际增量相符）。`git diff 4ca93440 ff5d6c2 -- src-tauri/ server/ src/domain/ shared/ scripts/ tests/integration/ package.json` 为空：**零 Rust、零服务端、零域/协议、零 II/III、零守卫/构建/锁文件改动**。
- **冻结实测（逐字节不变）**：`001_web_backend.sql`＝`8511907c…143d`、`002_manual_items.sql`＝`b6cb8e61…f97e`（批准 DDL 原样）、`web-api-contract.md`（web-api/1）＝`61863271…f58d`；域 `src/domain/todos.ts` 相对基点 `bc4b1c3` 零差异。
- **未吞错检查**：增量内无 `any`、无 `as` 强制断言、无类型豁免注释；`WirePoint`/`WireItem` 线类型声明未改（`source: 'manual'` 字面不变），未拓宽域或协议。

## 2. 修复本体与冻结语义核对

集成门禁 `a02bfef` 拦截的三处错误全部在 `src/lib/web-api-client.ts`（L91/L92 TS2322 精度、L101 TS2367 source）。本增量的处置与冻结语义逐项核对：

- **minute/day/null 时点**：新增 `toDomainPoint`＝`precision: point.precision === 'day' ? 'day' : undefined`。与冻结语义严格互逆：域 `TimePoint.precision?: 'day'`（`src/domain/todos.ts`，缺省即分钟精度；`pointFromInput` 产出的域时点本就无 precision 字段）；契约 §4.2 线格式 `precision` 枚举 `minute`／`day`；服务端 `manual-items-service.mjs` 归一化为 `precision ?? 'minute'` 且仅接受这两个值（该文件本增量零改动）。因此线 `'minute'`→域缺省 `undefined`、线 `'day'`→域 `'day'`、线空时点 `null`→域 `null`（`fromWireItem` 的 `item.due ? toDomainPoint(...) : null` 不变），`toWirePoint`（`?? 'minute'`）↔`toDomainPoint` 往返稳定。旧代码把线 `'minute'` 直通进域，正是 TS2322 的根源。
- **due/followup**：两者共用同一 `toDomainPoint`，独立映射、互不改写，符合契约 §7 两时间独立语义；R2 已验的 due/followup 独立性用例照常通过（16 用例含「due and followup stay independent and precision is preserved」）。
- **manual 来源**：`fromWireItem` 直接映到域 `'manual'`，移除与 `'signed_ai'` 的无重叠比较。冻结 002 DDL `CHECK (source IN ('manual'))` 使服务端只能产出 `manual`；线类型 `WireItem.source: 'manual'` 未变。对所有可达线值，新旧运行时行为完全一致（旧比较对 `'manual'` 同样得 `'manual'`）——该缺陷本就是纯类型层错误（TS2367），由 typecheck 拒绝而非运行时。

## 3. 独立复跑（真实导出树，非声明转抄）

以 `git archive` 分别导出候选与父版，共享同一 `npm ci --ignore-scripts` exit 0 的 node_modules：

| 命令 | 树 | 退出码 | 证据 |
|---|---|---|---|
| `npm run typecheck`（vue-tsc --noEmit） | `ff5d6c2` | **0** | `06-typecheck-new-exit.log` |
| `vue-tsc --noEmit`（直跑） | `4ca93440`（父） | **2**，错误与集成回执逐字相同：L91/L92 TS2322（`"day"\|"minute"` 不可赋给 `"day"\|undefined`）、L101 TS2367（`'manual'` 与 `'signed_ai'` 无重叠） | `07-typecheck-old-exit2.log` |
| `node --test tests/unit/web-manual-items.test.mjs` | `ff5d6c2` | **0**，16/16 pass（14 旧＋2 新，用例名与交付声明一致，两条新用例均实跑通过） | `08-unit-new.log` |

A/B 单变量证明：同一依赖环境下，父版 exit 2 且三处错误逐字节复现集成回执、候选 exit 0——修复恰好对准门禁缺陷，且未引入新错误。

## 4. 新增用例的可证伪性

- **机械拒绝旧字节**：新测试文件导入 `toDomainPoint`，旧 `4ca93440` 版客户端无该导出——ESM 链接即 `SyntaxError`，整套用例无法在旧字节上通过（`09-unit-newtests-vs-oldclient.log`，exit 1）。
- **行为判别（单变量变异）**：仅把候选客户端两条映射改回旧错误逻辑（`precision` 直通；source 恢复 `=== 'signed_ai'` 比较），其余全部不变，复跑 16 用例：**恰好两条新用例失败**（14/16，exit 1），断言转储 `actual: 'minute', expected: undefined`——正是旧缺陷"线分钟漏进域"的运行时表现（`10-unit-mutated-oldmapping.log`）。两条新用例均真实调用 `toWirePoint`/`toDomainPoint`/`fromWireItem`/`toWireInput` 客户端转换，不 mock、不经服务端代跑。
- **source 变异为运行时惰性**（如实记录）：source 恢复旧比较后，`source='manual'` 断言仍通过——因为对所有 DDL 可达线值新旧运行时等价；该面由 typecheck 拒绝（§3 第二行 A/B 已证）。与派审要求的"能拒绝旧错误映射"逐面对应：精度面由单测拒绝、来源面由 typecheck 拒绝，两者均实测成立。

## 5. 处置与未验项

- **判定：通过。** 增量是门禁缺陷的最小修复面，身份/哈希/冻结/语义/回归全部独立复验一致；R2 已验且本增量未触碰的面（Rust store/schema、服务端语义、HTTP/重启/CLI、幂等与竞争回归）继续沿用 `12d42f2`/`4889f87` 结论，不重开。
- **未验/边界（如实开放）**：完整 `npm run check` 不在本轮范围，仍由唯一集成者在新冻结版本串行重跑（含 II 套件、build:backend、浏览器路径）；本增量未改 Rust/服务端，故未重跑 Rust 套件；typecheck 通过不代表完整门禁通过，后者以集成者新回执为准。
- 原始证据：`build/web-manual-items-typecheck-review/`（gitignored）＝`00-admission.txt`、`01/02` 提交对象、`03/04` 增量与累计补丁、`05` npm ci、`06/07` typecheck 新旧对照、`08` 候选单测、`09` 旧字节链接拒绝、`10` 变异判别。
