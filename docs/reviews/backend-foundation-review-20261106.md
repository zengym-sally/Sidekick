# MAYNE-20 后端基础探针：in_review 门禁复核（2026-11-06）

> 结论：**NEEDS_REVISION / BLOCK**。候选探针在 macOS 上可复现通过，但普通打开仍有创建副作用，调度准入会把无法核实的旧 worker 记录当成可调度，且 Linux 运行路径与 Rust 质量门禁未闭合。本记录由 Codex 在最终 workflow 收口时作出；未合入 `main`。

## 1. 评审对象

- 基线：`85feb8aaa431a2a1c9f92b238e26a7a2400baa9e`
- 候选提交：`355d1a0d317ed9a6bce80a7df732f615161fefc1`（tree `0ee251229ce3d6b80d9336bb33c7984f3b1bf01b`）
- 候选分支：`agent/kimi/mayne-17`；Codex 审核分支为 `agent/codex/mayne-20`
- 风险级：R3（根/数据库文件身份、根锁、旧 worker 调度与凭据能力边界）
- 变更规模：非批量，8 个新增文件、2155 行；全部位于任务允许的探针、工程说明和评审记录范围

## 2. 新鲜验证

候选被导出到独立临时目录后执行，避免污染交付分支：

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node tests/probes/backend-foundation/run-probes.mjs` | 0 | 24/24 场景、80 项检查、33 次 harness 调用通过；离线构建成功 |
| `node --check tests/probes/backend-foundation/run-probes.mjs` | 0 | 语法检查通过 |
| `node scripts/checks/check-docs.mjs` | 0 | 18 文件、300 条本地链接通过 |
| `cargo fmt --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml -- --check` | 1 | 两个 Rust 文件存在格式差异 |
| `cargo clippy --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml --all-targets -- -D warnings` | 101 | 2 个 `needless_borrows_for_generic_args` 错误 |
| `git diff --check 85feb8a..355d1a0` | 0 | 无空白错误 |

主场景通过只证明当前 24 个断言成立，不能关闭下面的反例缺口。

## 3. 发现项

### P1：普通打开仍会创建缺失目录和归属标记

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs:161`、`:240`、`:258`

违反不变量：已有根普通打开不得通过新建内容掩盖缺失状态；新根初始化必须是独立显式流程。

证据：`allow_init=false` 时，`private_dir()` 仍会创建缺失的 `data/`、`runs/`、`skills/` 等目录；空目录也会先由 `acquire_root_lock()` 创建 `.sidekick-workspace`，随后才返回 `UNKNOWN_ROOT`。实测移除合成根的 `skills/` 后，`open-check` 成功并把目录重建；对空目录执行 `open-reject --expect UNKNOWN_ROOT` 后，`.sidekick-workspace` 被创建。现有 A2 只删除数据库文件，没有捕获这两类副作用。

影响：错误根、部分损坏根或误选目录会被探针修改；若缺少敏感目录，也可能被重建后继续，违背“失败不改变现场”的安全边界。

建议：把初始化创建逻辑从普通打开完全分离；普通打开在产生任何文件系统写入前校验根标记和全部必需目录，缺失即拒绝；增加空目录无标记、缺 `data/`、缺 `skills/` 等反例，并断言拒绝后目录树字节/项集合不变。

### P1：无法解析的 worker 记录被当作“没有旧 worker”而放行

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:322`

违反不变量：拿根锁不等于旧 worker 已停；无法核实上次执行者时必须暂停调度。

证据：`try_schedule` 使用 `read_to_string(...).ok().and_then(parse.ok())`；文件不存在、不可读或 JSON 损坏都折叠成 `worker=None`。实测在合法合成根写入 `{not-json` 后，命令返回 `decision=ACCEPT`、`worker=null`。D2 只证明了可解析且 PID 存活时会拒绝，没有覆盖记录损坏/不可读。

影响：旧 worker 退出状态无法证明时仍可进入调度，可能出现任务超发或与残留进程交错写库。

建议：区分“历史上从未有 worker 记录”和“存在记录但无法核实”；后者返回明确的暂停状态（例如 `WORKER_UNVERIFIED`），并校验记录文件本身的普通文件/权限/身份；增加损坏 JSON、读失败和记录被替换的反例。

### P1：要求的文件安全证据矩阵仍不完整

位置：`tests/probes/backend-foundation/run-probes.mjs:291`

违反不变量：任务要求核查 NOFOLLOW、身份、权限与硬链拒绝，设计还明确覆盖根、数据库及 WAL 侧文件。

证据：当前矩阵覆盖数据库的符号链接/硬链/权限、WAL 的符号链接/硬链，以及标记和根目录权限；没有持久断言覆盖 `runs/`、`config/`、`data/` 等目录身份，没有覆盖 `sidekick.sqlite-shm` 的硬链/权限/替换，也没有覆盖打开后的 WAL/SHM 身份变化。实现虽能拒绝部分未列举情形，但探针产物本身是证据交付，不能用“代码看起来处理了”替代命令与正反例。

影响：当前“NOFOLLOW/身份/权限/硬链拒绝通过”的说法超过实际矩阵，后续正式适配可能漏掉侧文件替换或目录替换。

建议：按根、数据目录、主库、WAL、SHM 五类逐项覆盖符号链接、硬链、权限、打开前/打开后身份替换，并把每项结果写入记录；无法在 macOS 合成的项明确留给 Linux。

### P2：Linux 运行器当前必然在主机能力场景失败

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/main.rs:486`、`tests/probes/backend-foundation/run-probes.mjs:493`

违反不变量：Linux 准入清单把同一 runner 列为重跑入口，探针应至少能表达“不支持 Keychain”而不是失败。

证据：非 macOS `keychain-facts` 返回 `ok=true, supported=false`，但 E 场景无条件断言 `syntheticOnly=true` 和 `fixtureRemoved=true`。Linux 上这两项缺失会使整个 runner 退出 1，即使存储场景全部通过。

影响：未来 Linux 机器无法用一个明确结果区分“存储失败”和“钥匙串不适用”，会阻断或误导跨平台准入。

建议：按平台分支断言 macOS Keychain 往返；Linux 只断言 `supported=false` 和 env 能力未实测状态，或将主机能力拆成独立探针。

### P2：新增 Rust 文件未过格式与 Clippy 门禁

位置：`tests/probes/backend-foundation/storage-adapter-probe/src/adapter.rs`、`src/main.rs`

证据：`cargo fmt --check` 退出 1；`cargo clippy -D warnings` 退出 101，指出两处 `needless_borrows_for_generic_args`。

影响：交付不能被视为可直接进入集成的 Rust 候选，且后续集成仍需返工。

建议：运行 `cargo fmt` 并修复两处 Clippy 错误，之后重新执行本探针、格式和 Clippy；再在集成版本运行完整仓库门禁。

### P2：文档把“根锁串行化适配器打开者”写成“串行化所有打开者”

位置：`docs/engineering/backend-foundation-probes.md:52`

证据：WAL 场景直接通过 `Connection::open_with_flags` 按路径打开业务库以模拟第二只读连接；这证明根锁只约束遵守同一适配器的打开者，不会阻止任意代码绕过适配器。

影响：可能被误解为操作系统级互斥保证，掩盖“所有业务访问必须经适配器”的实现纪律。

建议：改为“根锁串行化本适配器实例的打开；直接按路径打开的连接不受该 advisory lock 约束”，并明确这是代码层约束而非文件系统强制隔离。

### P3：评审记录缺少候选版本冻结信息

位置：`docs/reviews/backend-foundation-20261106.md:13`

证据：记录只写作者当时的 `fdc37e8`；实际候选内容在 `355d1a0`，且没有列出交付源码哈希。

影响：第三方难以确认被评审的字节与最终候选一致。

建议：在修订记录中补候选 commit/tree、改动文件清单和源码哈希；若平台自动生成提交，记录“候选内容提交”而非作者本地基线。

## 4. 维度结论

- 规格符合度：不通过。核心场景有证据，但创建副作用、无法核实 worker 和文件安全覆盖不符合任务验收。
- 架构与范围：通过。未改生产实现、Cargo manifests/锁文件、vendor、identifier 或真实工作根；文件均在授权范围。
- 安全与隐私：不通过。普通打开产生写入副作用，且侧文件/目录身份矩阵不完整；未读取真实凭据，合成 Keychain 删除通过。
- 失败、并发与恢复：不通过。损坏 worker 记录可放行调度。
- 测试充分性：不通过。当前 24 个场景缺少关键负例；Linux 主机断言未适配。
- 性能与 API/SSE：显式跳过，不在本任务范围。

## 5. 处置

- 不合入 `main`。
- MAYNE-20 退回 `started_2`，由 workflow 指定处理人按本记录 P1/P2 修订后重新独立评审。
- 本记录只确认门禁拒绝，不替代 ZCode 对通过版本的独立评审。
