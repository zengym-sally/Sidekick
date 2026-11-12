# W1 构建身份登记：web-backend-storage `5311ffa3…`（III 工程记录构建身份区，独立增补）（2026-11-09，OpenCode）

## 0. 性质、采纳链与输入

- **性质**：本文件是 III 工程记录的**构建身份专节**（按协调评论 `01a1bfb8` 单独增补，与生产／测试修订并行，仅 docs＋索引）。登记协调层已采纳的存储二进制新构建身份；**本登记不构成提前集成准入**——最终门禁仍在实际集成版本执行，并发／崩溃／恢复／backup 等验收证据不由本登记承载。本轮零构建、零 smoke、零 gate；本机只读读回见 §5。
- **采纳链**：Pi 只读取证（MAYNE-24 评论 `01a1bfae`，四附件）→ Hermes 未参与限定复核（评论 `01a1bfb7`，其分支 `6c269ea`：**可以据此登记新构建身份 `5311ffa3…232bd`（rustc 1.99.1、输入树 `48b54730`）**；原清单 §1「前后缀一致可视为同字节复现」按协调要求收窄为「摘要相符＋本次完整哈希」，不为已失的 09:07 原件作逐字节回收签署；历史 `42af54b5…` 记录不追改；三条链证据保持登记边界）→ 协调采纳（评论 `01a1bfb8`：登记依据是完整输入、工具链及独立产物复现，不依失件摘要推断，不把三条 smoke 链签成全行为等价；旧 `42af54b5…` 证据按原产物保留）→ III 增补本登记。
- **输入（本轮 CLI 读回）**：Pi 四附件 `input-manifest.md`（SHA-256 `89c9a6138e33…36bc5`）、`protocol-smoke.txt`（`dc23fd8e0722…1460`）、`section-compare.txt`（`1713cff6e216…afb1`）、`SHA256SUMS.txt`（文件本体 `758178887b13…735e`）；下载复算 SHA256SUMS **3/3 相符**。Hermes 复核记录（`01a1bfb7-c866…d4b`）CLI 读回。原始证据留存 `build/mayne24-build-identity/`（gitignored）。

## 1. 登记的构建身份（采纳值）

| 项 | 值 |
|---|---|
| 产物 | `web-backend-storage`（`src-tauri` release bin，经 `scripts/build/build-backend.mjs` 构建） |
| 大小 | 2 647 984 B |
| SHA-256 | `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd` |
| Rust 输入树 | `src-tauri` tree `48b54730cdaa63df503706b8ec3b48c67826c999`（Pi 核对 e84fab6／5926cbc／2c39d7f 同树；Hermes 复核另覆盖 4fc9537／681c282／c7cc116——合并六提交同树） |
| 工具链 | rustc 1.99.1（`58cf8f9c3`，2026-10-13，stable-aarch64-apple-darwin）／LLVM 23.1.1／内嵌 std `/rustc/58cf8f9c…/library`；SDK 27.0、链接器 LD 27037.1、`COMPILER=clang-21.0.0`（与旧件相同） |
| 登记依据 | 完整构建输入（清单 §2 的 Cargo.toml／Cargo.lock／build.rs／入口与 store 源／lib.rs／三迁移／tauri.conf.json 等哈希在 Hermes 审中逐一实算相符）＋工具链证据＋**独立产物复现**（Hermes 三会话三树 `c7cc116`／`681c282`／`787db84`+overlay 构建均得同字节）；不依失件摘要推断——09:07 原件未保留，17:22 重建由独立可复现性承重 |

## 2. 新旧二进制与工具链对应

| 侧 | SHA-256 | 大小 (B) | rustc / LLVM | 内嵌 std 路径 | 构建会话 |
|---|---|---:|---|---|---|
| 旧（按原产物保留，不迁签） | `42af54b545fba55fc36826dd8b575290018612e9303485d6d1bc58aae7490fc2` | 2 649 408 | 1.89.0（`29483883e`，2025-08-04）／20.1.7 | `/rustc/29483883…/library` | candidate-e84 03:23 与 candidate-5926cbc 07:24 两处独立构建同字节；Hermes 自留 15:53 独立副本同哈希 |
| 新（本次登记） | `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd` | 2 647 984 | 1.99.1（`58cf8f9c3`，2026-10-13）／23.1.1 | `/rustc/58cf8f9c…/library` | 17:22 新构建；Hermes 三会话三树独立复现字节互同 |

- **成因唯一可证**：stable 工具链 2026-11-09 16:34:25 CST 被原地升级，1.89.0 现不可用；源码、迁移、锁、Tauri 配置／图标／能力、build-script `out` 7 文件、构建参数逐字节相同（清单 §2／§3；fingerprint 仅 `rustc`／`profile`／`config` 哈希不同，`target`／`path`／`features`／`rustflags` 相同——差异来自编译器版本，非参数或源码）。
- **差异形态**（清单 §4＋`section-compare.txt`）：总 −1 424 B；`__TEXT/__const` −23 488、`__DATA_CONST/__const` −6 032、`__cstring` +2 145、`__text` −620、`__LINKEDIT` filesize +47 728（v0 mangling 符号名更长）；符号 mangling legacy→v0；入口可达嵌入资源（001/002/003 SQL、Info.plist）两侧**逐字节相同**，icon 及其余 build-script 产物两侧均未嵌入；差异集中在 std／编译器 panic 文案与格式及编译器生成表。符号表读回（Pi）保留为其证据，Hermes 未独立重验（非承重项）。
- **旧证据保留不迁移**：既往以 `42af54b5…` 承载的验证证据按原产物保留，不迁签、不追改；此后所有验证记录必须声明实际使用的产物身份，不得笼统写「与既往逐字节相同」（协调 `01a1bfb2`／`01a1bfb8`）。

## 3. 缺件边界

- **09:07 UTC 评论时的 `5311ffa3…` 原件未保留**（其 target 已清理）：现登记以 17:22 重建＋Hermes 三会话独立复现承重；不为失件作逐字节回收签署，不以「前后缀相符」当复现证明（Hermes §1 收窄裁定，`6c269ea`）。
- **1.89.0 工具链已不可用**：`42af54b5…` 现无法重建；其本体证据＝candidate-e84／5926cbc 的登记产物与 `.rustc_info.json`／内嵌 std 路径＋Hermes 自留独立副本（数与哈希一致）——「无法重建」仅在工具链意义上成立，旧件并未全失。
- 其余输入（`Cargo.lock`、三迁移、Tauri 配置、图标、能力、构建脚本产物）在位且两侧相同，无其他缺件（清单 §6）。

## 4. 三条协议链：已验／未验范围

**已验**（Pi `protocol-smoke.txt`：两二进制 × 三链，各自独立临时 root）：

1. `init`＋pragma（`user_version`/`foreign_keys`/`journal_mode`）＋`schema_meta`＋全表枚举＋一次失败写；
2. `init`＋成功写 `manual_items`/`manual_item_events`（002）＋读回；
3. `init`＋成功写 `text_sources`（003）＋读回＋`quick_check`。

结果：三链 stdout 逐字节相同、exit 0、生成 `data/web-backend.sqlite` 逐字节相同（链 1 `c51a594d…0fe9`、链 2 `edad6a70…40d7`、链 3 `e898d5d8…17bc`）——迁移应用（`user_version=3`、`schema_lineage=web-backend/1`）、pragma、002／003 写入路径两侧一致。

**未验（登记边界，不外推）**：并发、崩溃、恢复、backup、全部错误路径、完整测试套件均未跑；**三条 smoke 链不签全行为等价**（协调 `01a1bfb8`）；该面由实际集成版本的最终门禁承载，不由本登记或既往 `42af54b5…` 证据代签。

## 5. 本机只读读回（2026-11-09 登记时点）

- `rustc --version --verbose`＝rustc 1.99.1（`58cf8f9c35b355199727627d07ae34a4e2846d67`，2026-10-13，aarch64-apple-darwin），LLVM 23.1.1——与登记工具链一致。
- Pi 四附件 CLI 下载＋SHA256SUMS 复算 3/3 相符（§0）。
- 本轮零构建、零 smoke、零 gate，未触其他工作树或进程。

## 6. 后续纪律（对 III 与全部验证记录的执行约束）

- **后续日志与 manifest 必须填实际产物**：哈希＋大小＋构建会话，逐条登记；不得沿写 `42af54b5…` 或 `5311ffa3…` 旧值，每次「同一构建」主张以当次读回承重。
- **最终门禁前后读回工具链与二进制**：`rustc --version`＋产物 SHA-256 复算，读回值写入门禁记录；不自动沿用旧哈希。
- 工具链再漂移沿本轮先例：先只读定位输入与成因（不做 `cargo clean` 循环、不为追旧哈希改代码或资源），缺件如实登记；是否登记新身份由协调层裁定，III 只作记录。

## 7. 边界（如实）

仅 docs＋`docs/reviews/README.md` 索引行；未改工具链／生产／测试／package／生成器／守卫；未跑 smoke／完整 gate；未重跑 OS 探针或官方来源核验；引文取自 `01a1bfae` 四附件与 `01a1bfb7`／`6c269ea` 限定结论，未新增独立断言。本登记不构成提前集成准入；最终门禁仍在实际集成版本执行。MAYNE-24 保持 `in_progress`。
