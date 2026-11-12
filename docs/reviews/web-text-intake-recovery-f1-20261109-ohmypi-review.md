# F1 修改面限定独审（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1be33`。接续限定独审 F1 测试修订 `82e1bf2cee161c829dd1d2919ec272b8b681693d` 的 `b232828..82e1bf2` 修改面，复用未改的 W 与其余已过面（`cd5f6c1`／`d8c7a39`）。

## 1. 结论

**F1 修改面：通过（限定范围）。** 修改方向与派工判据逐条相符：`restartStubMode` 默认 `result-hang` 使 PC1/PC2 行为保持；F1 以 `restartStubMode:'bare'` + `restartLifetimeMs:3000` 显式钉住**原始无暂存场景**；候选零断言**未被删除或削弱**（条数不变、判据不变，仅文案更精确）。

**反证成立**：在**已修复**树 `c4a9c67` 上，修订前 F1 以 `1 !== 0` 失败——即原稿确实会要求压制修复后合法产出的候选。修订后同树通过。

## 2. 修改面复算

- `b232828..82e1bf2`：恰 **1 个文件 +22/−6**（`tests/unit/web-text-intake-recovery.test.mjs`），5 个 hunk，全部落在 F1  blast radius 内（文档头、`restartWithStagedOutcome` 签名、restart 实例启动调用、F1 setup、F1 末条断言）。
- 两个 fixture（`recovery-instance.mjs` `256001ac…9065`、`recovery-stub-worker.mjs` `8e76c570…c484`）与 `b232828` **逐字节相同**。
- 关键等价性：`startRestartedInstance(root, { stubMode: 'result-hang', … })` 由硬编码改为 `restartStubMode` 参数，**默认值即 `'result-hang'`**。PC1（`:456`）与 PC2（`:480`）均不传该参数 → 有效调用与修订前逐字节等价。

## 3. 独立复跑（数字为本审新跑）

前置：`git archive` 导出目标树 + `82e1bf2` 三测试文件原字节覆盖（`git hash-object` 逐一相等）；`cargo build --release --bin web-backend-storage` → 两树均为 **2649408 B、sha256 `42af54b5…490fc2`**。

| 运行 | 树 | 结果 |
|---|---|---|
| PC1/PC2/F1 | `c4a9c67`（待审生产） | **3 过 / 0 败**（exit 0，18.38s） |
| PC1/PC2/F1 | `5926cbc`（破损树） | **1 过 / 2 败**（PC2、F1；exit 1） |
| 全套 11 例 | `c4a9c67` | **7 过 / 4 败**（E1、E2、W(worker loss)、D1） |

- **可证伪性**：F1 在 `5926cbc` 上失败于 `:622` 的「second claim and younger progress」饥饿断言（`timeout waiting for …: null`），**位于候选断言之前**——证明修订后 F1 仍检出真实 R8-M-2 缺陷，且候选断言从来不是其操作性判据。
- **反证（修订必要性）**：把 `b232828` 的 F1 原字节放到已修复的 `c4a9c67` 上跑 → **FAIL `1 !== 0`**（`no staged outcome existed for the lost first attempt`）。即原稿要求修复树压制一次合法候选发布；修订后同树通过。
- **W 面未受扰**：`c4a9c67` 上 W(deadline) PASS、W(worker loss) FAIL，与 `d8c7a39` 结论一致（后者仍属 R8-M-3 欠账）。
- 全套 4 败均为既有未闭项（R8-M-3 的 E1/E2/W(worker loss)、R5-M-1 的 D1），非 F1 回归。

## 4. 派工三项核对

**4.1 `restartStubMode` 默认值与 PC1/PC2 行为保持——成立。** 默认 `'result-hang'`；PC1/PC2 调用点不传该参数，等效调用与修订前逐字节等价；实跑 PC1 两树均过、PC2 在 `5926cbc` 败／`c4a9c67` 过，与 W 审登记形状一致。

**4.2 F1 的 bare／有界退出确实实现两次无暂存场景——成立。** 首 attempt `stubMode:'bare'`（不发射结果帧）并在崩溃中死亡；restart 实例 `restartStubMode:'bare'` + `restartLifetimeMs:3000`——夹具 `:47-55` 只对 `result-hang`/`ignore-cancel-hang` 发射结果帧，`bare` 零帧；`:79-81` 的 `lifetimeMs>0` 在 3000ms 后 `exit(1)` 释放槽位供年轻任务认领。故第二次 attempt 同样无帧、无可发布物，`candidates === 0` 在破损树与修复树上**都**成立，不要求任何一方压制合法候选。

**4.3 候选零断言未被削弱——成立。** F1 断言条数修订前后均为 4；末条 `assert.equal(empty.body.candidates.length, 0, …)` 保留，仅文案由「no staged outcome existed for the lost first attempt」改为「the lost first attempt staged nothing and the second no-frame attempt could not publish either」——后者更严格地说明了为何零候选是**预期**而非压制。未删断言、未放宽比较、未加 skip/todo/only。

## 5. 边界（不代签）

- 未改测试、生产、package、DDL/Runtime；未跑完整 `npm run check`，未跑整套 17 项业务套件（仅本面必要的 PC1/PC2/F1 与全套一次核对）。
- `c4a9c67` 只作**测试可满足性验证**，不代签整个 R8-M-1/M-2 生产增量；该增量另有 OpenCode 独审。
- 20s 预算：最慢单例 F1 8.28s（`c4a9c67`）、13.88s（`5926cbc` 失败路径含 settle），均在 20000ms 内；全套 60.99s 为 11 例累计，未以整轮时长当单例超时。
- 负证控制用的 `b232828` 原字节为临时覆盖，跑后已还原，`git hash-object` 复算与 `82e1bf2` blob 一致（`8c641b1…`）。
- 运行树（`build/f1-review`、`build/f1-5926`）为临时导出，交付前删除。

## 6. 证据

- 原始证据（gitignored，平台会回收）：`build/f1-review-evidence/`——`f1-c4a9c67.txt`（PC1/PC2/F1 3 过）、`f1-5926.txt`（1 过 2 败，F1 失败点 `:622`）、`f1-full.txt`（`c4a9c67` 全套 7 过 4 败）、`pre-f1-run.txt`（负证 `1 !== 0`）、`README.txt`（候选/命令/结果/结论）。
- 复跑命令见 `build/f1-review-evidence/README.txt`。

---

## 附录 A：证据原件（fresh run 20261109T031523Z，防回收）

> 派工 `01a1be49`：把命令、经声明脱敏的实际 TAP 与输入哈希原文附录到本文档并同提交保存；附件仍须实际挂载。
> 上一轮 `build/` 已被平台回收且不可恢复；以下全部为本附录轮**新跑**，新时间戳 `20261109T031523Z`，未沿旧值签发，也未为复原 7/4 重跑全 11 例。

### A.1 命令（按序）

```sh
npm ci --ignore-scripts
git archive c4a9c67 | tar -x -C <run-tree>            # 修复树
git archive 5926cbc  | tar -x -C <run-tree>            # 破损树
git show 82e1bf2:tests/unit/web-text-intake-recovery.test.mjs        > <run-tree>/tests/unit/web-text-intake-recovery.test.mjs
git show 82e1bf2:tests/fixtures/web-text-intake/recovery-instance.mjs   > <run-tree>/tests/fixtures/web-text-intake/recovery-instance.mjs
git show 82e1bf2:tests/fixtures/web-text-intake/recovery-stub-worker.mjs > <run-tree>/tests/fixtures/web-text-intake/recovery-stub-worker.mjs
ln -s ../node_modules <run-tree>/node_modules
mkdir -p <run-tree>/build/s0-runtime                   # 仅满足 tauri-build 资源检查
cargo build --manifest-path <run-tree>/src-tauri/Cargo.toml --release --bin web-backend-storage

# 正控（修复树 c4a9c67）
node --test --test-name-pattern="^(PC1|PC2|F1)" --test-reporter=tap --test-timeout=20000 \
  tests/unit/web-text-intake-recovery.test.mjs

# 负证（旧 F1 原字节 b232828 覆盖到同一修复树，只跑 F1）
cp <corrected>.mjs /tmp/keep.mjs
git show b232828:tests/unit/web-text-intake-recovery.test.mjs > tests/unit/web-text-intake-recovery.test.mjs
node --test --test-name-pattern="^F1" --test-reporter=tap --test-timeout=20000 \
  tests/unit/web-text-intake-recovery.test.mjs
cp /tmp/keep.mjs tests/unit/web-text-intake-recovery.test.mjs     # 还原并复算 blob

# 反证（破损树 5926cbc）
node --test --test-name-pattern="^(PC1|PC2|F1)" --test-reporter=tap --test-timeout=20000 \
  tests/unit/web-text-intake-recovery.test.mjs
```

### A.2 输入身份（git blob / sha256 原文）

```
82e1bf2 tests/unit/web-text-intake-recovery.test.mjs        = 8c641b1178b54ccd8f0d9ae699f927d813d978bd
b232828 tests/unit/web-text-intake-recovery.test.mjs        = e5e47e7ef022ea3e21ece061fd52950c2d43d3c5
82e1bf2 tests/fixtures/web-text-intake/recovery-instance.mjs   = 5fe68cb4651c017f30d1aaa2680f0e0ccb69b714
82e1bf2 tests/fixtures/web-text-intake/recovery-stub-worker.mjs = 6d638db05e588bfd90df2135e866ab382106a007

82e1bf2  commit / tree a6b25de9bb0cf0ee234470b7bd688583458b3524  (parent b232828)
b232828  commit / tree 5f27dc5f4127d6b8647bfdc5559935e29b2a5296  (parent c05e545)
c4a9c67  commit / tree 9545029de58d97dd8604d7b191b9cdaa62205e5c
5926cbc  commit / tree 2c7bfae696bb1745c64906ee2d6a448381fc561b

storage binary (both run trees, rebuilt this turn):
  sha256 42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2
  bytes  2649408

run-tree server bytes (verified equal to the c4a9c67 blobs after scratch-free runs):
  server/lib/text-intake-service.mjs = b27a4cba02f7a2c62310b31cc9fbd08c9ace8d10
  server/lib/task-service.mjs        = c5bce9a66fc40a41d58e2b16b42970c903702b35

node v24.20.0；npm ci --ignore-scripts exit 0；cargo build exit 0
```

### A.3 结果（本轮新跑）

| 运行 | 树 | 结果 |
|---|---|---|
| PC1/PC2/F1 | `c4a9c67` | **3 过 / 0 败**（exit 0，suite 18.83s，stderr 0 字节） |
| F1（旧 `b232828` 字节） | `c4a9c67` | **FAIL** `1 !== 0`（负证：旧稿要求压制合法候选） |
| PC1/PC2/F1 | `5926cbc` | **1 过 / 2 败**（PC2、F1；F1 失败于 `:622` 饥饿断言，位于候选断言之前） |

单例时长：PC1 5.69s、PC2 4.82s、F1 8.26s（`c4a9c67`）；负证 F1 8.28s；`5926cbc` 失败路径 13.88s——均在 20000ms 预算内。

### A.4 脱敏声明

附件 TAP 中的 `location`／`stack` 行原含运行树绝对路径（TAP reporter 固有），已替换为 `<WORKTREE>` 占位并在此声明；除此之外无 `/Users/` 路径、无合成秘密值、无配对码。stderr 均为 0 字节。

### A.5 附件范围映射

| 附件 | 对应本文档章节 |
|---|---|
| `input-identity.txt` | §A.2 |
| `pc12f1-c4a9c67.tap` / `.stderr` | §A.3 第 1 行 |
| `f1-negative-precorrection.tap` | §A.3 第 2 行（负证） |
| `pc12f1-5926.tap` / `.stderr` | §A.3 第 3 行 |
| `admission.json` | §1–§6 汇总 |
| `review-record.md` | 本文档 §1–§6 |
| `SHA256SUMS.txt` | 附件自校验 |
