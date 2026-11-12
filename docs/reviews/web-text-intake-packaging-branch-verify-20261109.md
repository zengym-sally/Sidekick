# MAYNE-24 打包分支验证记录（OpenCode，2026-11-09）

## 范围与授权

协调者派工（MAYNE-24 评论 `01a1c04a-83c8-7c97-898d-5e58929acf32`，2026-11-09T12:31:11Z）：在第四例独审交付（评论 `01a1c036`，本审即作者）之后，用「精确 I＋已审 III 文件」临时组装，移动产物到独立目录，以包内真实 entry 的默认资源路径、默认工厂＋受控凭据／loopback 模型验证一次实际 Pi 任务和包内 `executionSource` 归属；不靠 runtime-root 覆盖回源码树、不改已实现脚本、不伪造 Runtime、不跑完整 gate。**仅补打包分支验证，不作正式集成准入**；E/D 仍待 owner，MAYNE-24 保持 `in_progress`。

风险级：R2（只读组装＋一次性真实链验证；不改任何分支生产字节、不改脚本、不改共享 main）。

## 基点与组装身份

- 精确 I：`d2b2696d965f81de67155c5ee037a744f1b56f34`（`agent/kimi/mayne-24` 顶＝记录提交；生产树＝父 `e98b85b1`，含锁定的来源修订 `7cfef55`／T-2 `be8be1a`／T-10 `e98b85b`）。I 树 `542c169d…`；`src-tauri` 子树 `48b54730…`＝已登记存储二进制输入树。
- 已审 III 文件：`scripts/build/build-backend.mjs` blob `34c58f516dc09be3ff3fa348c2f2200293e2c29f`（本分支 `94f8d85` HEAD＝`ff287ab`＝`9ab8ee0` 三处同 blob，与协调者纠正一致）。仅此一文件 overlay 进临时运行树（`git cat-file blob` 写入后 `git hash-object` 复核恰 `34c58f51…`）；`copy-executable.mjs` 两树同 blob `79df98b4…` 无需覆盖。I 树原 blob `87b851f7…` 只在运行树内被替换，**分支字节零改动**。
- Pi 来源：`vendor/pi` 树 `e89822b0…`＝`tests/probes/pi-source.json` 登记值；工具链 node v24.20.0、rustc/cargo 1.99.1（`58cf8f9c3`）＝登记身份工具链。

## 命令与退出码（运行树＝`build/mayne24-packaging-branch-verify/r1/runtree/`，gitignored）

| 步骤 | 命令 | 退出 |
|---|---|---|
| 物化精确 I | `git archive d2b2696 \| tar -x -C runtree`（5028 项） | 0 |
| III overlay | `git cat-file blob 34c58f51… > scripts/build/build-backend.mjs`（hash-object 复核） | 0 |
| 依赖 | `npm ci --ignore-scripts`（107 包） | 0 |
| 随包 CLI | `npm run probe:prepare-cli`（lark-cli 1.0.98 安装成功） | 0 |
| Pi 源 | `npm run probe:prepare-pi`（vendor/pi npm ci＋hydrate＋build:offline；tree 复核 `e89822b0`） | 0 |
| Runtime 闭包 | `npm run probe:bundle` → `build/s0-runtime`（479 文件；organizer `08f32db2…`、node `9d050fd4…`） | 0 |
| 打包 | `node scripts/build/build-backend.mjs`（typecheck＋vite build＋cargo release 39.55s＋装配） | 0 |
| 移动 | `mv runtree/build/web-backend /private/tmp/multica-task-1556045348/opencode/mayne24-packaging/bundle` | 0 |
| 验证 | `node verify.mjs`（仓库外自建探针，只 import 移动后 bundle 的真实模块） | 0 |

## 包内身份（装配后、移动后）

- `bin/web-backend-storage` SHA-256 **`5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`**（2 647 984 B）＝登记构建身份逐字节命中（第 5 次独立复现）。
- `runtime/` 与 `build/s0-runtime` `diff -rq` **0 差异**；`runtime/node`、`runtime/lark-cli` 恢复 0755；`runtime/node` `9d050fd4…0588a`、`runtime/organizer.mjs` `08f32db2…9111a7`＝登记运行时身份；`runtime/source.json` provenance `e89822b0`／node v24.20.0／lark-cli 1.0.98。
- bundle 布局：`server/`16 文件＋`shared/`1＋`static/`4（真实 vite dist，`index.html` 在）＋`bin/`＋`runtime/`479 文件，共约 179.5 MiB；entry blob `47a9efcd…`＝I 树原字节。
- bundle 位于 `/private/tmp/multica-task-1556045348/opencode/mayne24-packaging/`（仓库树之外）；运行树 `build/s0-runtime` 仍在场，供与实际 spawn 根对照。

## 真实链验证（默认资源路径＋默认工厂）

探针仅传 `startWebBackend({root, port:0, initialize:true, credentialProvider})`——**不传 runtimeRoot/staticRoot/storageBin/workerProcessFactory**；凭据用包内 `ControlledCredentialProvider`（受控引用 `controlled:packaging-verify`，合成值不出进程）；模型为本审 loopback OpenAI 兼容 SSE 服务（`POST /v1/chat/completions` 流式）。三次运行行为一致（前两次因本审探针自身 DB 文件名／列名写错中断，生产链行为与第三次逐面相同；第三次完整收口）：

- 默认根解析自 entry 自身位置：`runtimeRoot` 解析为**移动后 bundle 的 `runtime/`**（`…/mayne24-packaging/bundle/runtime`），非源码树、非运行树。
- 配置走真实 HTTP 面：pair（配对码一次性消费，cookie/CSRF 不落日志）→ GET/PUT `/api/models`（revision `""`→`f8803a9b…`）→ POST `/api/text-sources`（operationId `op-packaging-verify-3`，原文含「明天17:00前」）。
- **实际 Pi 任务成功**：真实 `runtime/node`＋`organizer.mjs` 被 spawn（默认工厂，`assertRuntimeLayout` 通过），恰好 1 次模型请求（`stream:true`、system+user 2 条消息、2 个工具、Bearer 在场——授权值脱敏）；任务 `succeeded`／`attempt_exit_state=exited_confirmed`／`exit_reason=confirmed`（树验证通过），4 行 task_events，零回执帧。
- 候选落库：`cand_4407a0b3…` `pending` v1，字段标题「提交季度报告」、evidence 精确子串、`明天17:00前` 解析为 `2026-11-10T09:00:00.000Z`（Asia/Shanghai 17:00）precision=minute，warnings `[]`、unresolved 0；只读 DB 复核 tasks／task_attempts／candidates／text_sources。
- **包内 executionSource 归属**：`runs/<runId>/worker.json` 记 `trusted=true`、`reason=audited_deployment_runtime`、`runtimeRoot`＝移动后 bundle runtime 真实路径（≠运行树 `build/s0-runtime`）、node/entry 真实路径＋SHA-256 与包内文件逐字节相等。7cfef55 的绑定在打包形态下把该授予落到了「实际 spawn 的包内产物」，非配置字符串。

## 未验证项／边界

- 不签：III 工程候选正式独审结论、来源修订 `7cfef55`／T-2／T-10 的聚合准入（ZCode 并行独审中）、整体集成准出（唯一集成轮＋完整 `npm run check` 仍待）；真实外部模型、真实凭据、浏览器 UI 旅程不在本审。
- 真实工具路径未触发（模型未调工具；bash-worker/MCP 面不在本审）。
- 环境性残留：本环境批量删除守卫拒绝清理两次中断运行的 `/tmp/multica-task-1556045348/mayne24-packaging-root-*` 临时工作根（无秘密：配置只含受控引用，DB 无密钥值；worker.json hostNonce 留在临时根）；bundle 与探针保留于 `/private/tmp/.../mayne24-packaging/`（平台临时区，非交付面）。
- 运行树（约 1.7 GB，gitignored `build/`）按仓库留存策略保留在 `build/mayne24-packaging-branch-verify/r1/runtree/`。

## 结论

**通过（限打包分支验证面）**：III 的 `build-backend.mjs` blob `34c58f51` 在精确 I 树上完成真实打包，bundle 携带已审运行时闭包与登记身份的存储二进制；移动到独立目录后以包内默认资源路径＋默认工厂完成一次真实 Pi extract 任务（succeeded／exited_confirmed），包内 `executionSource` 归属为 `trusted`／`audited_deployment_runtime` 且指向包内产物。不预签聚合准入，不跑完整 gate；E/D 仍待 owner，MAYNE-24 保持 `in_progress`。

## 证据

`build/mayne24-packaging-branch-verify/r1/`（gitignored）：admission.txt、identity.txt、bundle-manifest.txt、verify-harness.mjs（探针原文件）、verify-transcript.log、verify-result.json、五段构建日志、db-copy.sqlite（运行 2 库副本，模式勘误用）、SHA256SUMS（12 项）。分支交付为 docs-only 恰 2 文件（本记录＋README 索引行）。
