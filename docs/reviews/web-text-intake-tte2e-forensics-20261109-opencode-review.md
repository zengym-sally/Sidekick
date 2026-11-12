# Web 文本接入 · 可信 test 端到端取证 `b72c4b9` 独立独审（2026-11-09，OpenCode）

- 审者：OpenCode（未参与 `b72c4b9` 取证、未写其目标树 `c4a9c67` 生产三文件、未写被审文档）。
- 派工：MAYNE-24 触发评论 `01a1be6b-f259`（Codex）："静态面可先审、动态面等实件；核实默认真实 Pi／HTTP／受控模型链及七个派生点论证，RS-1/RS-4 下究竟哪些结论仍成立。只签有证据的无工具路径，不将零帧采样当通用完整性证明；不改生产、不重复已过探针或完整门禁。"
- 被审对象：`b72c4b956fe884bff0c824dd23fa9e85e2bce792`（`docs/reviews/web-text-intake-trusted-test-e2e-forensics-20261109.md`，ZCode）。
- **结论先行：静态面通过（限定）——文档全部结构/行号/字节断言经对象库逐行复核 57/57 成立，七个 spawn 位点清点逐字属实，RS-1/RS-4 影响划分与协调裁定要求一致；动态面不签（该评论 CLI 附件为空，`build/trusted-test-e2e/` 已按平台惯例回收，S1–S5/S7 两轮结论均为作者声明，待 ZCode 补件后另审）。** 通用进程树退出完整性未证状态不变。

## 1. 提交身份（通过）

- `b72c4b9` 父提交＝`24960e4`（ZCode r3 独审记录），树 `6c07ac40`；`diff-tree` 恰 1 个新增文件（53 行，docs-only），无 README 索引改动（沿既定范围）；提交消息与文档内容一致。
- CLI 附件核验：被审评论 `01a1be57` 的 attachments 为空（与协调裁定"该评论 CLI 附件为空"一致）。

## 2. 静态链独立复核（57/57，对象库逐行）

方法：全部事实经 `git show <tree>:<path>` 与 `git grep -n <pattern> <tree>` 从对象库直读（非工作树），逐条对行号断言；复核脚本与全量输出见附录 A／B（`build/mayne24-tte2e-forensics-review/r1/`，gitignored，关键结果已录本文与附录）。

- **身份类**：`runtime/` 在 `23eb1a1` 与 `c4a9c67` 间 diff 为空（逐字节相同）；`organizer-entry.mjs` blob＝`9414f23f` 与登记一致；`src-tauri/`、`vendor/`、`shared/` 在 `5926cbc..c4a9c67` 无差异；`vendor/pi` tree＝`e89822b0` 与 `tests/probes/pi-source.json` 登记（commit `ad702637`/tree `e89822b0`）一致。
- **RS-1 面**：`http-server.mjs:676-686` `snapshotForTest`；`:678` 对客户端 `input.snapshot` 原样采用（返回整个 `body.input`，见 §4-3）；`:673-675` 注释意图"client 只送 modelId、服务端解析不可变快照"与实现不符，RS-1 成立；`:683-685` 解析抛错回退无 snapshot；`:139` 路由、`:688` `tasksCreate`。**RS-1 在当前锁定候选 `0dbae12` 仍在位**（`:678` 零差异；`0dbae12` 对 http-server 的唯一修改在 `taskRetry` 的服务端 `snapshotFor()` 重解析——恰是 RS-1 收口应沿用的正确形态）。
- **submit/调度面**：`task-service.mjs:15-16` 白名单、`:315-316` 校验、`:336` 全树唯一 `INSERT INTO tasks`，c4a9c67 上 15 处 `UPDATE tasks` 均不触碰 `input_ref`/`type`（retry 复用原行成立）；`task-scheduler.mjs:94` 快照唯一来源 `row.inputRef?.snapshot`，无快照/凭据失败路径均在 spawn 前落库返回（`:95-107`/`:109-126`），`:127` `workerHost.start`；`web-backend-entry.mjs:72` 全树唯一 `new WorkerHost`（git grep 计数＝1）；服务端另一 spawn 仅 `storage-client.mjs:34`。
- **请求构造面**：`worker-host.mjs:229` hostNonce 24B→48hex、`:231` `kind=task.type`、`:229-252` 请求对象**无 `mcp` 字段、无 `tools` 字段、无 `verification*` 字段**；`:246-248` 非 extract 强制 `rawText:''`；`:280-283` env 恰 `{PATH,TMPDIR}`；`:285` detached；`:421` apiKey 仅经 stdin（JSON 请求体）；服务端全树 0 处 `verification*`/`SIDEKICK_S36`/`request.mcp`/`request.tools` 引用（git grep 空）。
- **Runtime 门面（已登记 blob `9414f23f`）**：`:63` 输入门（runId 正则＋kind 白名单＋snapshot.provider/model＋非空 apiKey）；`:64-74` g1 需控制环境变量＋argv 旗标＋请求字段三重同时在位（本链全缺）；`:109` managedBash 惰性构造（`managed-bash.mjs` spawn 仅在 `operations.exec` 内 `:20`，bash 工具不构造即不可达）；`:114` `useTools` 含 `kind!=='test'` 合取＋`skillSnapshot→proofPath`（RS-4）；`:115` 空工具集；`:116-117` test＋MCP → `RUNTIME_PROTOCOL` fail-closed；`:131` test 上下文恒 `{task:'connection test'}`；`organizer-contract.mjs:29` test 结果契约恰 `{ok:true}`；`:141` finally 仅在 proofPath 存在时以 `wx`/`0600` 写 `skills-proof.json`（RS-4 文件写面成立，服务端派生 skills=null → 无文件）。
- **七个派生点（spawn 位点）清点：逐字属实。** `git grep 'spawn(' c4a9c67 -- runtime/`（剔除 execFileSync 行）恰 7 处，行号与文档逐一相同：managed-bash:20、managed-mcp:27、bash-worker:7/20、mcp-guardian:39/48/65；无第 8 处。三门（服务端不 spawn／Runtime 输入门／MCP 门）与位点的前置关系在源码成立，test 路径三门全闭。
- **receipts 帧级映射**：`receiptFactsFor`（`:124-167`）覆盖 `mcp` 帧（三种 action 形状均产出事实）、`progress{phase:'tool'}`、`worker` 帧；帧持久化有序 awaited（`:347-351`），done settle 在 `frameQueue.then` 之后（`:376-380`）——"receipts=0 ⇒ 全程无工具/MCP/bash 帧"**不依赖 ps 采样间隔**的论证在源码成立（其边界见 §3/§4-2）。

## 3. RS-1/RS-4 下哪些结论仍成立（核心裁定面）

**仍然成立（不受 RS-1/RS-4 影响）：**

1. **固定 kind 的无工具门**：tools/mcp/verification 字段在 `worker-host` 请求构造中**结构性不存在**（不从 input 拷贝、不 spread），Runtime 三门按请求形状判定——无论 snapshot 由服务端派生还是客户端自带，kind='test' 的无工具/无 MCP/无 g1/结果契约 `{ok:true}` 四层 fail-closed 面全部不变。S1 的零工具面、S5 的 mcp 结构性丢弃、S2/S3 的 spawn 前失败、S4-runA 无 auth 变体的 `:63` fail-closed（静态同构：无 auth ref → credential='' → spawn 照发 → `:63` 拒）均在此列。
2. **receipts=0 的帧级精确性**：如 §2 末条，该论证是帧级映射＋settle 时序，不是采样；但其证明力范围=本路径帧面，**不是通用树完整性**（协调裁定口径，本文照签）。
3. **七个派生点的路径特异退出论证**：7 处 spawn 位点全部位于三门之后且 test 路径三门全闭——成立（精度补全见 §4-1，不推翻）。
4. **"通用退出完整性未证"登记**：verifyTree/恢复扫描域不变，`23eb1a1` 裁决不变——ZCode 未越权签发，正确。

**必须收窄（RS-1/RS-4 直达）：**

1. **"输入侧派生已沿真实链核清"只对服务端派生分支成立**（客户端仅送 modelId）。RS-1 分支（客户端自带 snapshot）是客户端派生：provider.baseUrl/model、auth 引用（服务端按客户端点名的 ref 解析凭据并注入 `request.apiKey`）均客户端可选，RS-4 子项（客户端 skills → 退出写 `skills-proof.json` 空数组）同属该分支。**S4 是该缺口的存在性证明，不是安全证明**——ZCode 文档 §5 已按此登记，协调裁定"两 claim 必须分开"在文档中已满足，本文复核确认该划分正确且必要。
2. **RS-1/RS-4 在 `0dbae12` 仍未收口**（§2 已证 `:678` 原样在位）——Kimi 的 RS-1 独立小提交派工（协调裁定）仍然待交；收口应沿 `0dbae12` taskRetry 已有形态扩展到 submit：服务端重派生或对整个 input 形状校验（不止 snapshot 子键，见 §4-3）。

**动态面（S1–S5/S7 两轮、默认真实 Pi/HTTP/受控模型链的实测）：不签。** 静态上"默认真实 Pi"链路成立（entry 默认 `runtimeRoot` 指向 bundle 布局、WorkerHost 生产 spawn 形态、bundle 重建的 vendor/pi 来源树已核），但两轮运行是否确实未注入任何 factory 缝、模型服务审计恰 1 请求、DB receipts=0、worker.json pgid==pid/children=[]、S4 bodyModel=client-specified-model、S7 13 次捕获等关键数字目前只有文档文字。待 ZCode 按 `01a1be6b` 派工补交自包含 harness／输入身份／两轮原始证据与哈希后，按补件面另行核验；不预签、不沿旧数字追认。

## 4. 精度补全与新登记（不推翻，随 RS-1 收口/后续批次处理）

1. **运行时进程执行清点补全**：除 7 处 `spawn()` 外，runtime 另有 **4 处 `execFileSync` 只读探针**——managed-mcp.mjs:88（`/bin/ps`）、native-model-fetch.mjs:18（`/bin/ps`）与 ：20（`/usr/sbin/lsof`）、mcp-guardian.mjs:18（`/bin/ps`）。全部同步、非 detached、1s 超时上界、只读列出；且在本链不可达（MCP 类在 MCP 门后，native-model-fetch 仅经 g1 owner 或 `request.verificationNativeModel` 激活——后者在服务端 0 引用）。**对 E1 形状（detached 未标记后代）无派生面**；建议取证记录把"7 处 spawn 位点"表述补齐为"7 处 spawn＋4 处同步只读探针"，清点才算完整。
2. **receipt 映射的窄缺口（实际不可达）**：`worker` 帧若同时缺 pid 与 nonce 则不产出事实（`receiptFactsFor` 返回 `[]`）；两处实际发射点（managed-bash:21/:38）恒带 pid+nonce，缺口不可达。登记仅为把"receipts=0 ⇒ 无 bash 帧"的前提写全：它还依赖"发射点恒带身份"这一已核事实。
3. **RS-1 收口范围提示**：`:678` 返回的是**整个 `body.input`**（不止 snapshot 子键）——客户端多余字段会随 input 进任务行。Kimi 收口时应对整个 input 形状校验/重派生，不只验 `snapshot`。
4. **行号小疵（N-1）**：文档 §2.1 引 `model-snapshot.mjs:17-39`，签名实在 `:16`（skills=null 默认与返回 `:37` 均已核）——差一行，实质不受影响，不作返工条件。

## 5. 边界

- 只读独审：对象库直读＋一支复核脚本；**未改生产/测试/Runtime/DDL/package**，本分支提交 docs-only；未跑完整门禁、未重复任何已过探针、未跑 Rust。
- 未触碰兄弟工作树与运行进程；无新进程驻留；复核脚本只调 `git show`/`git grep`，无网络、无真实模型/凭据/用户根。
- 动态面结论（S1–S5/S7）在本文中一律以"作者声明"对待；补件到齐前的任何动态数字不因本文获得签发。
- MAYNE-24 保持 `in_progress`；R8-M-3 §4.6 面不通过、F-R8-2 待修、RS-1 收口待交等既派欠账均不在本文范围，状态未动。

## 附录 A：复核命令与身份

```
git rev-parse b72c4b9^{commit}          # b72c4b956fe884bff0c824dd23fa9e85e2bce792
git rev-parse b72c4b9^                  # 24960e4556ac568ef677754ff73d4a12b3738543
git diff-tree -r --name-status --no-commit-id b72c4b9
                                        # A docs/reviews/web-text-intake-trusted-test-e2e-forensics-20261109.md
git diff --stat 23eb1a1 c4a9c67 -- runtime/          # (empty)
git rev-parse c4a9c67:runtime/entries/organizer-entry.mjs   # 9414f23feedc619ecee579bc0a243307fcb696ec
git ls-tree c4a9c67 vendor/pi           # tree e89822b0d7a2baf5cc518d3baf568e8dceb73c68
node verify-b72c4b9-static.mjs <worktree>            # 57 pass / 0 fail, exit 0
```

复核脚本：`build/mayne24-tte2e-forensics-review/r1/verify-b72c4b9-static.mjs`（仅 Node 内置＋git，只读）；SHA-256 见交付附件 SHA256SUMS.txt。

## 附录 B：逐条复核结果（脚本全量输出）

```
PASS commit b72c4b9 exists | b72c4b956fe884bff0c824dd23fa9e85e2bce792
PASS parent == 24960e4 | 24960e4556ac568ef677754ff73d4a12b3738543
PASS docs-only: exactly 1 added file | A	docs/reviews/web-text-intake-trusted-test-e2e-forensics-20261109.md
PASS runtime/ byte-identical 23eb1a1 vs c4a9c67 | (empty diff)
PASS organizer-entry blob 9414f23f | 9414f23feedc619ecee579bc0a243307fcb696ec
PASS src-tauri/vendor/shared unchanged 5926cbc..c4a9c67 | (empty diff)
PASS vendor/pi tree e89822b0 (matches pi-source.json registration) | 040000 tree e89822b0... vendor/pi
PASS http :676 snapshotForTest
PASS http :678 client snapshot adopted verbatim (RS-1) | if (body.input && body.input.snapshot) return body.input;
PASS http :673-675 intent comment "only a modelId"
PASS http :683-685 resolve-error fallback to input
PASS http :139 route /api/tasks POST
PASS http :688 tasksCreate
PASS RS-1 persists at 0dbae12 (:678 unchanged)
PASS task-service :15 TASK_TYPES
PASS task-service :16 TASK_ROLES
PASS task-service :315-316 whitelist validation
PASS unique INSERT INTO tasks | count=1
PASS no UPDATE tasks touches input_ref (c4a9c67) | updates=15
PASS scheduler :94 snapshot from inputRef only
PASS scheduler no-snapshot fail before spawn
PASS scheduler credential-fail before spawn
PASS scheduler :127 workerHost.start
PASS entry :72 unique WorkerHost construction
PASS server-wide single new WorkerHost
PASS storage-client :34 spawn (only other server spawn)
PASS worker-host :231 kind = task.type
PASS request has no mcp field
PASS request has no tools field
PASS request has no verification* fields
PASS worker-host :246-248 non-extract rawText=''
PASS worker-host :280-283 env {PATH,TMPDIR} only
PASS worker-host :285 detached
PASS worker-host :421 apiKey via stdin write
PASS worker-host :229 hostNonce 24B=48hex
PASS receiptFactsFor :125 mcp frames
PASS receiptFactsFor :160 progress phase:tool
PASS receiptFactsFor :162 worker frames
PASS receipts persisted per-frame before done settle
PASS server 0 verification*/SIDEKICK_S36 references | (none)
PASS server 0 request.mcp/request.tools writers | (none)
PASS runtime :63 input gate (runId+kind+snapshot+apiKey)
PASS runtime :109 managedBash constructed
PASS runtime :114 useTools kind!==test conjunct (RS-4 proofPath)
PASS runtime :115 empty tools for !useTools
PASS runtime :116-117 test+mcp RUNTIME_PROTOCOL fail-closed
PASS runtime :131 test context constant
PASS runtime :64-74 g1 needs env+argv+request triple
PASS organizer-contract :29 test result exactly {ok:true}
PASS runtime :141 finally writes proofPath wx/0600 (RS-4 face)
PASS managed-bash :12 factory (lazy, no spawn at def)
PASS managed-bash spawn :20 inside operations.exec
PASS worker-frame emissions ALWAYS carry pid+nonce (:21/:38)
PASS exactly 7 runtime spawn() sites at claimed lines | managed-bash:20, managed-mcp:27, bash-worker:7/20, mcp-guardian:39/48/65
PASS 4 execFileSync read-probe sites (3x /bin/ps + 1x lsof; synchronous, non-detached, activation-gated)
PASS model-snapshot :16 buildModelSnapshot skills=null default
PASS model-snapshot returns skills
TOTAL 57 pass / 0 fail
```
