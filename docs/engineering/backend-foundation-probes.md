# 后端基础探针：独立存储适配与主机运行边界（W0）

> 本篇记录 MAYNE-20 的隔离验证 harness、运行方式与已验证边界。它证明的是**探针本身覆盖的那一段**：目标存储适配契约在现有依赖下可达，以及主机部署/凭据能力事实。它不实现正式后端，不生产化该适配，也不代替 W1–W5 的业务验收。目标契约见 [Web/后端设计](web-backend-design.md)，证据约定见[验证约定](verification.md)。

## 1. 范围与边界

- 验证对象：[Web/后端设计](web-backend-design.md) §2/§5 描述的**独立 Rust 存储适配**契约——连接与根锁同生命周期、无 CREATE 的已有库打开、文件身份与私有性、WAL 与短事务、崩溃释放与旧 worker 未退时的调度拒绝（含记录不可核实即暂停调度）、初始化创建与普通打开完全分离。
- harness 位于 `tests/probes/backend-foundation/`：一个独立 Rust crate（`storage-adapter-probe/`，按目标契约写的参考实现，仅用于验证）加一个 Node 运行器（`run-probes.mjs`）。**未改动** `src-tauri/` 业务实现、Cargo manifests 与锁文件。
- 所有场景只使用合成根（`build/backend-foundation/roots/`）与合成钥匙串 fixture；不打开真实库、不读真实凭据、不动真实工作根。
- 本 harness 不是生产适配：它复刻了 `src-tauri/src/store/` 中已被门禁覆盖的文件安全模式（归属标记锁、身份捕获、NOFOLLOW 打开），用于在隔离环境先证明边界假设，再谈正式实现。

## 2. 运行方式

```sh
node tests/probes/backend-foundation/run-probes.mjs
```

- 运行器先用 `cargo build --release --offline` 构建 harness（依赖版本与 `src-tauri/Cargo.lock` 锁定的一致：rusqlite 0.39.0 bundled、serde_json 1.0.154、keyring-core 1.0.1、apple-native-keyring-store 1.0.2；全部来自本机 cargo 缓存，不联网）；失败时回退一次联网构建并在结果里记录实际模式。`CARGO_TARGET_DIR` 固定为 `build/backend-foundation/target`，不触碰 `src-tauri/target`，因此不需要与门禁负责人协调重编译。
- 原始证据（每次调用的命令、退出码、stdout/stderr JSON、合成根）写入 `build/backend-foundation/`（`results.json`、`run.log`、`roots/`），已被 `.gitignore` 忽略，可重建。
- Rust 侧回归测试：`cargo test --offline --manifest-path tests/probes/backend-foundation/storage-adapter-probe/Cargo.toml`（`CARGO_TARGET_DIR=build/backend-foundation/target`）。`root_lock_must_survive_until_sqlite_close` 通过 `SQLITE_TRACE_CLOSE` 回调断言：SQLite 执行 CLOSE 回调期间根锁仍被持有，连接完全关闭后才释放锁；`marker_privacy_change_must_stop_storage` 断言归属标记权限降级后首次读取 `PATH_CHANGED`、随后 `STORAGE_STOPPED`。
- `try-schedule` 的进程探测默认调用 `/bin/kill -0 <pid>`，并把结果分成存活／确认退出／无法核实三态；设置 `SIDEKICK_PROBE_KILL` 可覆盖探测程序，供运行器注入合成权限拒绝与启动失败（仅测试钩子，不影响生产适配）。
- `try-schedule` 的准入顺序：先取得完整适配/根锁，再在锁保护下读取 worker 记录（受控句柄 + 身份/版本快照：dev/ino/mode/nlink/mtime/size），探测后、发布准入前再核对一次记录身份/版本，变化即暂停；探测程序运行期间根锁始终持有。
- 未新增 npm 脚本：`package.json` 属共享文件，由集成任务统一维护；本条只交付可直接执行的运行器路径。聚焦回归时直接跑上面的命令即可。
- harness 子命令（每个输出最后一行 JSON，退出码 0=符合预期）：`seed`、`init`、`open-check`、`open-reject`、`wal-check`、`rows`、`mutate`、`hold`、`try-schedule`、`control-default-open`、`host-facts`、`keychain-facts`。其中 `init` 是**唯一**允许创建归属标记、私有目录与数据库的显式初始化流程；`open-check`/`open-reject`/`wal-check`/`rows`/`hold`/`try-schedule` 全部按已有根打开，任何缺失都拒绝且不创建。`try-schedule` 与普通打开共用同一完整校验入口，不旁路标记/目录/数据库身份检查。

## 3. Node 如何调用独立适配

当前不需要新依赖：适配以**独立二进制**交付，Node 用子进程调用——argv 传参，stdout 最后一行回 JSON，退出码 0/1 表示是否符合预期（`run-probes.mjs` 对全部 74 次调用都是这个方式，含崩溃场景的拉起与 `SIGKILL`）。秘密不经过 argv；探针只传合成根路径。

若未来要把适配改为**进程内绑定**（Node 直接加载 Rust 动态库），需要新增构建链与依赖授权，本轮不擅自安装：N-API 方案（`napi-rs`/neon 类 crate）需要 Node 头文件与每平台预构建产物，或引入 `node-gyp`/`cargo-cp-artifact` 类工具链，并决定随包分发与签名方式。把这些列为正式依赖前，需按仓库约定形成具体清单并由 owner 授权。把适配二进制随 App 打包同样涉及 `scripts/build/` 变更，属集成/门禁负责人范围。

## 4. macOS 合成根实测矩阵（2026-11-07 第三轮修订）

主机：macOS 27.0.0 arm64（Darwin 27.0.0），Apple clang 21.0.0，cargo/rustc 1.89.0，Node v24.20.0；harness 内 SQLite 3.51.3（rusqlite bundled）。运行结果 **65/65 场景、242 项检查、74 次 harness 调用全部通过**；命令与退出码见 `build/backend-foundation/run.log` 与 `results.json`。所有拒绝类场景都附带“拒绝后文件树不变”断言（`run-probes.mjs` 的 `snapshot()` 对比）。

| 组 | 场景（期望） | 结果 |
|---|---|---|
| A 连接/根锁同生命周期 | `open-check`：打开成功；`journal_mode=wal`、`busy_timeout=5000`、`synchronous=2(FULL)`、`foreign_keys=1`；适配存活期间同进程二次打开 `ROOT_IN_USE`；`drop` 后可重开 | 通过 |
| A 无 CREATE 打开 | 缺库时 `MISSING_DATABASE` 且**不新建文件**；对照组证明默认 `Connection::open` 会新建（适配因此不能用默认标志） | 通过 |
| A 显式初始化 | `init` 在空目录创建归属标记（含 MAGIC）、7 个 0700 私有目录与 0600 数据库（写入 application_id/user_version 与合成 schema）；产物随后可作已有根 `open-check`（`countBefore=0`）；对非空无标记目录 `init` 返回 `UNKNOWN_ROOT` 且文件树不变 | 通过 |
| A 普通打开零创建 | 空目录（无标记）`open-reject` 返回 `UNKNOWN_ROOT` 且目录仍为空；有标记但缺私有目录返回 `INVALID_ROOT` 且不补建——初始化创建与普通打开完全分离 | 通过 |
| B 文件身份拒绝 | db 符号链接/硬链（nlink=2）/0644、`-wal` 符号链接/硬链、`-shm` 符号链接/硬链/0644、`data/` `runs/` `config/` 符号链接或 0755、标记符号链接/硬链/0644、根目录 0755、损坏库、错误 application_id、未来 user_version=6、无标记非空目录——分别拒绝于 `PATH_CHANGED`/`INVALID_ROOT`/`CORRUPT_DATABASE`/`UNKNOWN_DATABASE`/`SCHEMA_TOO_NEW`/`UNKNOWN_ROOT` | 通过（18 项） |
| B 中途身份变化 | `swap-db`：身份捕获后被换库 → `PATH_CHANGED`，原库保留不覆盖；`replace-marker`：打开后标记被换 → 首次使用 `PATH_CHANGED`，之后保持 `STORAGE_STOPPED`（任何失败停止读写，不静默恢复） | 通过 |
| B 打开后侧文件/目录身份变化 | `replace-wal`：写入后 `-wal` 被换成符号链接 → 首次使用 `PATH_CHANGED`、之后 `STORAGE_STOPPED`；`replace-shm`：写入后 `-shm` 被换成额外硬链 → 同上；`degrade-runs`：打开后 `runs/` 权限被降为 0755 → 同上；`degrade-marker`：打开后归属标记权限被降为 0644 → 同上 | 通过（4 项） |
| C WAL/短事务 | 提交可见、未提交行对第二只读连接不可见、失败语句整事务回滚、写后 `-wal` 存在、最后连接关闭后检查点移除 `-wal` | 通过 |
| D 崩溃与调度 | worker 存活持锁：`try-schedule` REJECT `ROOT_IN_USE`、`open-check` `ROOT_IN_USE`；`SIGKILL` 后 `try-schedule` ACCEPT、根可重开、数据完好 | 通过 |
| D 锁非证明与三态探测 | `runs/worker.json` 记录存活 PID 而锁空闲：REJECT `WORKER_ALIVE`（拿根锁不等于旧 worker 已停）；记录已退出 PID、无记录：ACCEPT；`kill -0` 权限不足（EPERM）按存活暂停，只有确认不存在（ESRCH）才放行 | 通过（5 项） |
| D 记录不可核实即暂停调度 | worker 记录内容损坏、缺 pid 字段、是符号链接、有额外硬链、权限 0644、pid 超出 `1..=2147483647`、探测命令无法启动——均 REJECT `WORKER_UNVERIFIED`（“无法核实”与“无历史记录”是两种状态，前者不得当作可调度） | 通过（7 项） |
| D 调度入口复用完整根校验 | `try-schedule` 与普通打开共用同一入口：空目录/标记内容错误 → `UNKNOWN_ROOT`，标记符号链接/硬链/缺私有目录 → `INVALID_ROOT`，缺库 → `MISSING_DATABASE`，库硬链/0644、`runs/` 符号链接、根 0755 → `PATH_CHANGED`；拒绝后文件树不变 | 通过（10 项） |
| D worker 记录准入竞争 | 探测期间记录被原子替换为存活 PID、或权限被降为 0644：均 REJECT `WORKER_UNVERIFIED`；探测程序运行期间根锁始终持有（`rootLockAvailableDuringProbe=false`）；记录不变的正对照 ACCEPT | 通过（3 项） |
| D 写事务中崩溃 | `SIGKILL` 于未提交写事务：重开 WAL 恢复丢弃未提交行，已提交行保留，`try-schedule` ACCEPT | 通过 |
| D 正常退出 | stdin EOF 正常退出实际执行适配器析构（先关连接再放锁）后释放根锁，`try-schedule` ACCEPT | 通过 |
| E 主机事实 | `host-facts` 记录 OS/SQLite 版本；macOS 上 `keychain-facts` 合成 fixture 往返（写入/读回/删除/确认缺失）通过，仅合成条目；非 macOS 平台只断言 `supported=false`，不跨 OS 代签 | 通过 |

一个由探针观察到的边界事实：根锁是 advisory 文件锁，只约束通过同一适配器取得锁的打开者——C 场景的第二只读连接本身就按路径直接打开数据库，说明锁不能替代访问纪律。正式适配必须把“业务库只由持锁适配打开、不按路径重开”作为**代码层访问纪律**来实现和审查，不把它当作文件系统级强制隔离。

## 5. 主机部署与凭据能力事实

- macOS 本机：登录钥匙串可用；`apple-native-keyring-store` 1.0.2 合成往返通过（不触碰任何真实条目）。
- 当前生产代码事实：`src-tauri/src/store/mcp_keychain.rs` 的 `production_credentials()` 固定 `enabled: false`——**现有构建的 MCP 凭据后端处于关闭状态**；`diagnostics/storage_probe.rs` 的合成钥匙串往返测试存在于 Rust 测试层（`test:rust-no-keychain` 明确跳过它）。新后端的 CredentialProvider 需要显式打开与能力探测，不能假定现状已可用。
- Linux 服务：设计默认环境变量引用、无 macOS Keychain；本机无 Linux 机器，**未做任何 Linux 实测**。

## 6. Linux：仅静态依据，未验证

以下为按 POSIX/SQLite 文档与本实验结果做的静态判断，**均未在 Linux 实测，不构成跨平台通过**：

| 项 | 静态依据 | 待验证 |
|---|---|---|
| `SQLITE_OPEN_NOFOLLOW` | SQLite 跨平台统一的 open 标志 | Linux 上对符号链接的拒绝行为实测 |
| `try_lock`（advisory 文件锁） | POSIX 锁语义：进程死亡即释放；同一文件不同 fd 互斥 | Linux（ext4/xfs 等）实测持锁、崩溃释放、跨进程拒绝 |
| 权限位 0600/0700、nlink、dev/ino 身份 | POSIX 文件属性，Linux 语义一致 | Linux 实测（含不同 umask、挂载选项） |
| WAL/短事务、崩溃恢复 | SQLite 跨平台一致； bundled 编译需 Linux C 工具链 | Linux 构建 + 崩溃恢复矩阵实测 |
| 凭据 | 设计默认 env 引用；Linux 无 Keychain | Linux 上 env 引用、缺失引用显式失败的实测 |

Linux 准入清单（达成前不得把本节任何一项写成已验证）：一台 Linux 构建/运行环境（CI runner 或 VM）；在 Linux 重跑本 harness（`node tests/probes/backend-foundation/run-probes.mjs`，harness 本身跨平台可编译，`keychain-facts` 子命令在非 macOS 自动报告 `supported=false`，运行器 E 场景按平台分支断言，不会把存储场景误报为失败）；目标 glibc/musl 与最小内核决定；Linux 上的代理模式与部署边界另属 W5。

## 7. 后续准入清单（本探针不关闭的部分）

1. 正式适配实现：按目标契约落到生产层（schema、迁移、依赖授权单独走流程）；本 harness 的参考实现不并入生产。
2. 进程内 Node→Rust 绑定或随包分发适配二进制：需新增构建链/依赖与打包授权（见 §3）。
3. 凭据 Provider 打开与能力探测：当前生产 Keychain 后端关闭；macOS 不可用（无桌面会话）与 Linux env 引用分别实测。
4. 并发 3/持久队列/取消/恢复语义：属 W1–W2 实施切片，本探针只验证存储边界前提。
5. 真实工作根、真实凭据、Linux 与代理部署：均需对应授权与实测，不得以本探针代签。
6. 评审索引登记：本记录需由集成负责人在 `docs/reviews/README.md` 登记（该文件为共享写入范围，本任务不改）。
