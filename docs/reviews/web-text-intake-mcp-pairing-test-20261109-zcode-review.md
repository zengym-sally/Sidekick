# MAYNE-24 MCP 配对测试增量限定独审（ZCode，2026-11-09）

- **对象**：`a02af9e18e8b1a9417bd6de5f55fc027a1b1f4ba`（tree `2fda915fdbbb5befee024cbf483e8d8a1eeb7f53`，父 `85fb851`，恰 4 文件 +647，全为新增）。
- **派发**：协调评论 `01a1bd85-473b-702d-84a3-df2a01432540`（Codex）：核对真实生产链、故障注入仅限服务缝、成功正控与旧版失败、清理／20s 预算及来源哈希；尤其核实两 attempt 交叠是否由持久 begin／显式夹具门控证明。不改测试、不跑完整 check、未改已过面复用。
- **结论：通过（限定范围）**——作为「对已核实生产候选 `31434282` 的可证伪回归输入」通过；不签生产本身（`31434282` 维持 R2 不通过结论），scratch 仅签可满足性。
- **性质**：本审为限定独审。只读候选；原始证据在本机 `build/web-text-intake-mcp-pairing-test-review/r1/`（gitignored），精选随评论附件交付。MAYNE-24 保持 in_progress。

## 1. 身份（独立复算）

- `git cat-file` 实测：commit/tree/父与派发登记逐字节一致；`git diff 85fb851 a02af9e` 恰 4 文件全为新增（+647/−0）：`tests/unit/web-text-intake-mcp-pairing.test.mjs`、`tests/fixtures/web-text-intake/mcp-pairing-worker.mjs`、`tests/fixtures/web-text-intake/mcp-pairing-frames.mjs`、`tests/fixtures/web-text-intake/mcp-pairing-golden-frames.jsonl`。无生产、I 既有单测、II/III 文件、package.json 字节。
- 四文件经 `git show a02af9e:<path>` 落入隔离 detached worktree（`/tmp/mayne24-review-31434282`，HEAD `31434282`），逐文件 SHA-256 与对象一致（测试 `80717c43…`、worker 夹具 `d07c6007…`、frames 夹具 `1b7ba122…`、golden `35d7b97e…`）。
- **golden 帧 `35d7b97edc4fd8aff480a919d51e2728458f27e82812018af58f38ba730d1a18`**＝P-3 冻结 golden 包既有登记哈希，第 6 次独立复验一致。
- 存储二进制按候选树自带 `src-tauri` 源码编译（`cargo build --release --bin web-backend-storage`）：**2649408 B，SHA-256 `42af54b5…490fc2`，与作者登记二进制逐字节相同**——独立确定性复现。Runtime bundle 仅满足 tauri-build 资源检查（spawn 被脚本夹具替换，测试从不消费 runtime 字节）：organizer.mjs `08f32db2…`、node `9d050fd4…`，与既有登记一致。

## 2. 真实生产链（非纯函数、非重写注册循环）

`runScenario` 装配生产 `StorageClient`（真实 Rust 二进制＋sqlite）→ `TaskService`/`TextIntakeService`/`ConfigStore`/`ControlledCredentialProvider` → 生产 `TaskScheduler`（pollMs=30 真实 tick）→ 生产 `WorkerHost.start`（runId＋hostNonce 身份围栏）。脚本夹具（`mcp-pairing-worker.mjs`）**只替换 spawn 调用**：pid/stdio/exit 事件接口与生产一致，帧在收到 host 请求行（携带 runId/hostNonce）后才发出并按请求身份重围栏，golden 外来帧以 `keepFence` 保留原围栏由生产围栏丢弃。全部断言落在 `storage.command('query', …)` 读回的 `side_effect_receipts` 持久行上，`receipt_id` 按冻结公式独立重算归类（`classify` 仅用于归类读回行，不参与配对判定）。生产注册循环零重写、无纯函数驱动。帧形状注释与实现读自 `runtime/lib/mcp-trial.mjs`/`mcp-control.mjs`（`call_response` 不带 `modelCallId`）。

## 3. 故障注入仅限服务缝

唯一注入点：`taskService.recordReceipt` 包装——首个匹配 callKey 的 `tool_call_begin` 抛错（S5）或静默返回 false（S5b），其余全部委托原实现。无深层 monkey-patch、无时钟/网络替身。帧级异常（重复帧、错 callId、孤立 response、跨 server／跨 attempt）全部由真实代码路径产生。

## 4. 成功正控与旧版失败（原样复跑实证）

复跑命令（与作者登记一致）：`node --test --test-timeout=20000 tests/unit/web-text-intake-mcp-pairing.test.mjs`

| 运行 | 树 | 结果 |
|---|---|---|
| run1 | `31434282`＋四文件（原始失败面） | 11 tests，**4 pass / 7 fail**；stderr **16× `pairKey is not defined`**；失败清单与作者逐项一致（golden 精确集合、逆序应答、重复 response、attempt 隔离、重复 begin、跨 server、闭合后重开——全部「该闭合而零闭合」） |
| run2 | 同上＋scratch diff（仅 `task-scheduler.mjs`） | **11/11 pass**，pairKey 出现 0 次，最慢 5327.87ms |
| run3 | 稳定性复跑 | **11/11 pass** |

- 旧版失败**可证伪且精确**：golden 正控期望精确到 7 行序列（含两行 bash closed、外来帧零入账）；scratch 修复后全部转绿，证明判据非不可满足（scratch 仅签可满足性，不交付、非候选，与本审边界一致）。
- run1 的 4 个通过中 3 个为虚胜（错 callId／抛错／静默 false——在「什么都不闭合」的生产上恒真），1 个真实（孤立 response）；该形态与 R2 审查一致且作者已如实披露，不算本增量缺陷。
- 三个候选树身份核对：scratch 运行后 `git checkout -- server/lib/task-scheduler.mjs` 恢复候选字节，恢复后 SHA-256 `6dd20735…7225b1` ＝ `git show 31434282` 复算——**候选树零修改**。

## 5. 两 attempt 交叠的证明方式（派发重点）

S6 用两任务＋同一 `callId`（不同 attempt）。**实测结论：交叠并非由持久 begin 或显式夹具门控证明——它是时序推导的**（claim 由 pollMs=30 的 tick 交错约 30–60ms，帧距 200ms 使两个 begin 几乎必然先于任一应答落库），作者「200ms 帧距保证两个 begin 先于两个应答落库」的表述是软断言而非门控。**但检测能力不依赖交叠成立**：对非 attempt 隔离的全局配对映射，两种交错序都会使 S6 的逐 attempt 断言失败——(a) begin₂ 落在 begin₁ 开放期内被吞 → attempt₂ begin 行数=0 断言失败；(b) begin₁ 先闭合、begin₂ 被去重逻辑拒绝 → 同样 begin=0 失败；(c) 应答误消费他人 begin → closed/unattributed 断言失败。重开面另由 S10（单 attempt 闭合后重复 begin 不重开）独立覆盖。故 S6+S10 合起来对「配对状态须按 attempt 隔离」这一命题的检测是稳健全的；本审把「交叠门控缺失」登记为措辞级观察（OBS-1），不构成不通过项。

## 6. 清理与预算（本机实测）

- 每场景 finally 三步独立清理（scheduler.stop → storage.close → rmSync 临时根），任一步失败不跳过其余。
- 三次复跑结束后实测：`/tmp/mcp-pairing-*` 残留 **0**；本 worktree 无遗留 `web-backend-storage` 进程（进程表中观察到的 storage 进程均属**其他成员正在运行的 worktree**，非本审产物，按范围未触碰）。
- 预算：聚焦命令保留 `--test-timeout=20000`；本机最慢用例 5405.93ms（run1）/5327.87ms（run2），余量充足。
- 夹具重发风险核查：生产 worker-host 对 worker stdin 只写两种请求行（启动请求与 `{type:'cancel'}`），夹具跳过 cancel 行，脚本恰发出一次——无重复发帧风险。

## 7. S9 裁定落实核对

跨 server 用例（S9）按裁定以**不同 `modelCallId`**（`mc-X`/`mc-Y`）表达两个可区分调用，各自 begin 独立、各自应答闭合各自 begin；旧帧同 callKey 复用同一主键的不可满足预期未被断言，更正记录保留在交付评论与 evidence-manifest。裁定其余两点（旧碰撞单列异常、不预签 closed=1/unattributed=0）在测试字节中落实。

## 8. 观察（不阻断）

- OBS-1：S6 交叠为时序推导而非持久 begin 门控（见 §5），作者表述偏强；检测稳健性不受影响。
- OBS-2：run1 的 4 个通过面中 3 个虚胜属生产缺陷形态的固有伴影，作者已披露；生产修复后须全部转为真实通过（探针/测试可原样复跑作回归）。
- OBS-3：测试内 `waitFor(claim)` 读 `scheduler.active` 内部 Map——可接受（测试已限定 II 夹具范围），生产接口未受影响。

## 9. 边界

- 不签 `31434282` 生产（R2 不通过结论维持）；不签 scratch 为候选；不跑完整 check；不改测试、生产、II/III 文件。
- 未改已过面复用：R2 身份核对、golden 帧来源事实按既有登记沿用（本轮第 6 次哈希复验）。
- 原始证据（本机，gitignored）：`build/web-text-intake-mcp-pairing-test-review/r1/`（三次运行全量日志、identity.txt、下载附件、SHA256SUMS）。精选随评论附件交付。
