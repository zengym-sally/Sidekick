# MAYNE-24 后继批次：error 帧码收口与 C4 日期点（Kimi，2026-11-09）

> 状态：候选交付，待独立评审（另派未写本批 `server/` 四文件的成员；作者不自签）。MAYNE-24 保持 `in_progress`。
> 派工：协调评论 `01a1beec-8043-74e9-adb8-5e72843a9999`（2026-11-09）追加的两个独立增量。
> 分支 `agent/kimi/mayne-24`，基点 `4fc95374ed7550349020fbd96e42cf0a311220f9`（tree `4fc95374…`），两个生产提交未 push、未改状态：
> `58a4cdc` 增量①、`95907cd` 增量②。生产面恰 4 个 `server/lib/` 文件；Rust／DDL／003 冻结哈希／守卫／package／前端／II 测试／Runtime 零差异。

## 增量①：宿主 error 帧码进入无成功暂存的 extract/revise 收口

**登记缺口（ZCode C5 取证，`01a1bee4`）**：worker-host 已收到 error 帧码（worker-host.mjs:397），但 scheduler 未把它传入 extract/revise 收口（task-scheduler.mjs:260-263 旧路径），一切未暂存 extract 失败信封码都是 `worker_lost`，冻结 §4.6 的 FAILURE_CODE_ALIASES 对 extract/revise 不可达。

**修复（`58a4cdc`，task-scheduler.mjs ＋ text-intake-service.mjs，+29/−9）**：

- scheduler `onWorkerDone` 把宿主真实收口事实 `failurePayload`（非 succeeded 时的 `effective.payload`）传入 `confirmExtractExit`/`confirmReviseExit`；succeeded worker 的载荷永不当失败载荷转发。
- 收口按显式优先序经冻结注册表构造信封：**后端 deadline > 收到的 error 帧码 > 零帧死亡**（`runtime_exit`/`runtime_start` 经别名落 `worker_lost`）。真实 `MODEL_TIMEOUT` → `model_request_failed`/`auto_backoff`；`MCP_HTTP_STATUS` → `tool_execution_failed`/`manual`；`MODEL_INVALID_OUTPUT` → `output_contract_invalid`；`INVALID_TIMEZONE`/`UNSUPPORTED_MODEL_PARAMETERS` → `auth_or_config_invalid`。
- 原暂存胜出不变：payload 只在无暂存分支咨询；**不读模型自报安全**——只有 code 与 message 过界，安全面保持 `unknown`（除非回执证明，scheduler 既有强制不变）；公开信封不含 `internalCode`。Runtime 协议零改动（帧与码本就存在）。

## 增量②：C4 日期点上线＋首次规范输入入 `tasks.input_ref`

**修复（`95907cd`，text-intake-service.mjs ＋ task-service.mjs ＋ manual-items-service.mjs，+183/−65）**：

- **线上形状**：`sourceAt` 提交与读回两侧统一为 `{at,timeZone,localText,precision}`（与手工事项 due/followup 同一线型，复用导出的 `normalizePoint` 同一校验，含结构化本地时刻反查）。私有 ms 桥接保留：`source_at_ms`/`anchor_at_ms` 列与 runtime `anchorAtMs` int 不变，变化止于 HTTP DTO；无新增 DDL、无挪用其他台账。
- **三列不足以原样保存 localText/precision**：完整首次规范输入（`source.sourceAt` 点＋首个 `anchorAtMs`）存入既有不可变 `tasks.input_ref`；来源行、任务行与 `succeeded_run_id` 链接经 `TaskService.submit` 新增可选 `companionOps` 钩子**同事务**提交——来源不可能没有其首次输入而存在，失败提交两者皆不留。读回绑定首个任务（指纹去重与 operationId 重放返回的同一首个任务），重启／重放／去重不漂移；无首个任务的来源按列回落且未知点部分留 `null`，不默造元数据。
- **实际 worker 请求用首次 `anchorAtMs`**：extract 输入携带首个锚；revise 输入继承候选来源的首锚（此前 `input.anchorAtMs` 从不落库，排队／重启／重试后静默按 worker 启动时刻解析日期）。revise 时区改走 `source`（worker host 对每个 kind 读取的形状），不再走从未被读取的顶层 `timeZone`。
- **显式锚时区与顶层时区冲突拒 400**（`sourceAt 时区与 timeZone 不一致。`，`validation_failed`，零落库）；省略点时默认首次录入时刻、`localText: null`，不编造原始表达。

## 验证（真实链；存储二进制 2649408 B／`42af54b5…490fc2` 与既往登记逐字节相同）

**聚焦单测（本树字节）**：service 13/13、lifecycle 10/10、events 11/11、MCP 配对 11/11。恢复回归按派工原样覆盖 ZCode 更正字节 `82e1bf2`（SHA `3ab536c9…`、跑后还原登记字节）：**11/11**，W(deadline)（`model_request_failed`/`auto_backoff`＋needs_review）与 W(worker loss)（`worker_lost`/`manual`＋needs_review）双面保持绿——增量①未动两条既有路径。

**真实链探针（`build/web-text-intake-c4-errorframe/probe.mjs`，自包含，生产 entry＋真实 Rust 存储＋真实随包 Pi＋loopback 受控模型服务＋只读 SQLite 观测）**：

- 修复树 **32/32**：显式旧锚逐字保留（提交响应／详情／列表三处）；真实 Pi 解析结果等于共享日期逻辑对该**显式旧锚**的反控（两个相隔一周的锚给出两个不同的周五，证明锚而非时钟驱动解析）；`input_ref` 携完整点与首锚；来源／任务／链接同事务；同根重启后点与锚不变；operationId 重放与指纹去重不漂移且不建第二任务；时区冲突 400 零落库；省略锚默认首次录入；error 帧三态（`MODEL_TIMEOUT`→`model_request_failed`、`MCP_HTTP_STATUS`→`tool_execution_failed`、零帧死亡→`worker_lost`）＋暂存胜出（result 后随 error 帧仍 succeeded）＋无 `internalCode`＋needs_review 安全路由＋零候选＋模型零请求。
- **可证伪性**：同一探针对基点 `4fc9537`（隔离 detached 树、用后即删）**8/14**，6 项红与登记缺口一一对应——C4-1a 显式点提交 400（旧码只收整数 ms）、C4-7 冲突面不可达（点从未解析）、C4-8b/8c 读回无点形状、EF-1a/EF-2 error 帧码落 `worker_lost`（登记的生产缺口）；零帧死亡与暂存胜出在两树皆过（既有行为未变）。

**其他门禁**：`typecheck` exit 0；`check:structure` 自测通过且 `server/` 零违规（170 条 `[top.dir]` 全是会话前既存平台注入 `.kimi/`）；`test:web-manual-items`（构建产品 dist 后）**59/59**；II http 套件与 II static 套件在修复树与基点同环境对比**失败集逐条相同**（http 6/24、static 7/9）——两套件的红均为既有测试侧缺陷（见下），本批零回归。

## 登记的既存测试侧阻塞（非本批范围，归 II／Pi）

II http 与 static 套件自带 `writeModelConfig` 写的 `providers.json` 缺 `name` 且用 `credentialRefs` 形状，被生产 ConfigStore 规范化拒绝（`供应商名称无效。`），模型侧用例因此连带红（T-12 的 C4 断言在该套件内不可达）；static 套件 browser journey 停在"开始整理"按钮禁用（同一配置根因），packaged CLI 项缺 `build:backend` 产物。以上在两树逐条相同，按归属不改 II 断言／夹具。

## 给 OhMyPi 的具体 DTO（前端适配输入）

- HTTP 只读写日期点：提交 `input.sourceAt = {at,timeZone,localText,precision}`；读回 `source.sourceAt` 同形。内部 store／Tauri 的 ms 形保持（适配层转换）。
- 前端现存两处需适配：`web-api-client.ts:717-720` 提交把 `sourceAtMs` 整数直接塞 `sourceAt`（显式来源时刻路径将 400，需转为点）；`:570-572` 读回落 `source.sourceAtMs`（已改为 `source.sourceAt.at`）。省略锚（`at=null`）路径不受影响，仍默认首次录入。
- 日期解析反控：候选 due/followup 按 `source.sourceAt` 的 `at`/`timeZone` 解析（共享 `shared/dates.mjs`），"今天／下周"类表达以首次锚为准。

## 边界

未跑完整 `npm run check`（III 唯一集成轮）；未 push、未改状态；未重跑未改 Rust 全量与前端构建产物以外的套件；`82e1bf2` 测试总准出仍归 ZCode；II 四套件总准出仍归 Pi；真实模型／凭据／用户根未涉及（受控合成）。原始证据（探针两树 summary.json、TAP、admission、SHA256SUMS，脱敏复核 0 命中）随交付评论附件一次交付，`build/` 会回收。
