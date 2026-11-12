# W1 源模式 UI 缺口诊断（MAYNE-24 / OhMyPi，候选 `e84fab6b`）

> 派工 `01a1bc6f-3248-7761-a4fc-43cff83f33ba`：OhMyPi 未参与生产实现，对 I 候选 `e84fab6bcebffe4249dd7439367e320d7dc63a1c`（tree `99c23bc1b8754377cb014990135373490b5a6986`，父 `4dfc9e9`，8 文件 +350/−41）做**独立源模式 UI 缺口诊断**。在本隔离树安全接收精确候选作为只读运行前置；只用合成根、内存 controlled 引用、真实 Pi 与真实产品 DOM。HTTP/只读库仅作互证，不绕 disabled 控件、不调内部函数、不用 API 提交替代页面操作。失败给精确控件/状态/响应证据。本诊断不改 I 生产代码。
> 结论只签该源版本诊断；最终稳定版原样浏览器验收仍另派。

## 1. 运行前置与身份登记

候选在本树以**只读运行前置**方式接收（逐字节取自候选 tree，运行后按 `restore-plan.txt` 还原，不提交任何候选字节）。真实产物：

| 项 | 值 |
|---|---|
| 候选 commit/tree | `e84fab6bcebffe4249dd7439367e320d7dc63a1c` / `99c23bc1b8754377cb014990135373490b5a6986` |
| storage binary | `build/web-backend/bin/web-backend-storage`，SHA-256 前缀 `b7dd9339598418a1`，2649408 B |
| static index.html | `build/web-backend/static/index.html`，SHA-256 前缀 `ef649416d21062d8` |
| bundled organizer | `build/s0-runtime/organizer.mjs`，SHA-256 前缀 `08f32db22205ffba` |
| bundled node | `build/s0-runtime/node`，SHA-256 前缀 `9d050fd455b56426`，可执行 |
| Pi provenance | `npm run probe:prepare-pi` → commit `ad702637…` / tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`（＝W1 登记值） |
| 003 迁移 | `src-tauri/migrations/web-backend/003_text_intake.sql`，SHA-256 `8e4e31597425a911a61a87bdac32d5d61683ac71d24fc2a39855282e68ea7870`（＝owner 批准值，逐字节一致） |
| 候选源码保真 | 候选 tree 的 `src/**`、`server/**`、`src-tauri/**` 全部落盘后与候选树逐字节 `diff` 一致（0 差异）；`build:backend` 产物的 server 文件同样逐字节一致 |

环境准备（工单许可的固定命令）：`npm ci --ignore-scripts`（根）、`vendor/pi` 的 `npm ci` + `hydrate:model-data` + `build:offline`、`probe:prepare-pi`、`probe:bundle`（ organizer/node 在位；可选 lark-cli 复制处按已知基线非零退出，organizer 路径不依赖）、`cargo build --release --bin web-backend-storage`、`npm run build`（前端 dist）、`npm run build:backend`。

## 2. 诊断方法

- 真实产品 DOM：headless Chrome 经 CDP 驱动**产品自身控件**——配对码入产品配对闸（原生 value setter + `input` 事件 + `form.requestSubmit()`）、点产品自己的「整理一段原文／整理新文本」入口、切产品自己的「文本智能整理」tab、填产品自己的 textarea、点产品自己的「开始整理」「生成修改预览」「取消」。
- 合成根 + 内存 controlled provider：`config.credentialProvider` 注入内存 controlled 引用（`env:UI_DIAGNOSIS_SYNTHETIC_KEY`），不读环境秘密、不落盘；`providers.json`/`models.json`/`agents/organizer.json` 按生产文件结构预置，revision 用生产 `revisionOf` 派生（否则 `identifier('')` 拒为 400，见 §5 的 L-1）。
- 受控模型服务：loopback OpenAI 兼容，脚本化 25s 延迟用于占槽观测；请求记录只记 `hasAuthorization` + 长度，不记值。
- 互证：HTTP 与只读 SQLite（`node:sqlite` readOnly）只用于 corroborate 页面所见，不替代页面操作。

## 3. 结果（10/12 通过，2 项失败均为同一根因）

| # | 断言 | 结果 |
|---|---|---|
| 1 | 产品配对闸配对 | **通过** |
| 2 | 真实产品 UI 打开整理入口（tab 未 disabled、表单渲染） | **通过** |
| 3 | 从页面提交整理文本 | **通过** |
| 4 | 候选出现在产品待确认区 | **通过** |
| 5 | 从页面请求自然语言修改预览 | **通过** |
| 6 | **预览前候选不变（version + title）** | **通过** |
| 7 | 从页面连续提交五任务 | **失败**（第 2 次起 `开始整理` disabled） |
| 8 | 3 running / 2 queued（HTTP 互证） | **失败**（同上根因，页面无法入队第二任务） |
| 9 | 逐任务取消（页面） | **通过** |
| 10 | 五任务全部到达终态 | **通过** |
| 11 | 同根重启读回（来源保留） | **通过** |
| 12 | 只读库互证（重启后） | **通过** |

### 3.1 旅程 A：预览 → 确认应用（派工重点）——通过

- 页面请求「生成修改预览」后，候选 **version 仍为 1、title 仍为「合成预览候选」**（HTTP 读回与页面文本双重确认，页面 `hasRevisedTitle=false`）；
- 服务端侧证（只读源码核对）：`requestRevision`（`text-intake-service.mjs:434-463`）只 `taskService.submit(...)`，**不写 candidates**；`applyPreview`（`:465-495`）才以 `UPDATE candidates SET fields_json=?,version=version+1 WHERE candidate_id=? AND version=? AND status='pending'` + `expectChanges:1` 落库，并在版本不符时 409 `version_conflict`。即「预览不覆盖、应用才带版本落库」在源码层成立，页面层观测一致。
- 未签部分：本诊断未走完「确认应用」的页面点击（该控件在预览成功后渲染，需 revision 任务完成后的下一次轮询）；**预览前不改候选**这一派工重点已实证，应用动作本身留待集成版旅程。

### 3.2 旅程 B：五任务 → 3 running/2 queued → 逐任务取消 → 重启读回

**根因（精确控件/状态证据）**：全候选组件中只有 `src/components/TextIntake.vue` 一处调用 `organizer.organize()`，其提交按钮绑定：

```
:disabled="organizer.running||organizer.starting||!model.ready||model.saving
           ||!settings.ready||settings.loading||settings.saving
           ||!agents.states.organizer.ready"
```

`organizer.running` 在有 run 活动期间为 true，因此**第二个页面提交被拒**直到第一个到达终态。实测：

```
submission 1 -> ok=true，source 建成，开始整理转为 disabled
submission 2 -> {ok:false, reason:'开始整理 disabled',
                 buttons:[{t:'选择日期与时间',d:false},
                          {t:'配置或检查模型服务',d:false},
                          {t:'开始整理',d:true}]}
submission 3/4/5 -> 同
```

**因此「从页面连续提交五任务 → 3 running/2 queued」在本候选中不可达。** 持久队列与 `TaskQueue.vue`（渲染 `queuePosition` 与逐任务「取消」）均已实现，HTTP/DB 层也能正确报告形状，但页面无法在首个任务运行中入队第二个。

**未代签**：本诊断不签 3-running/2-queued 的页面路径——签它需要 API 提交（派工禁止）或产品改动（超范围）。

**同根因下仍通过的部分**（说明队列/取消/重启本身可用）：
- 逐任务取消：页面「取消」对每个 queued/running 任务返回 200；
- 全部任务到达终态；
- 同根重启读回：来源与候选逐条保留（本 run 2/2 sources、2/2 candidates），重启前会话被 401（新实例 epoch），只读库与 HTTP 一致。

## 4. 附带发现（供 I 复核，非本诊断判定）

| # | 现象 | 证据 |
|---|---|---|
| L-1 | 预置 `config/` 时 `revision` 置空会导致 `GET /api/models`、`GET /api/agents/organizer` 返回 **400「配置修订无效」**，页面 `organizerReady=false`、`开始整理` 永久 disabled | `config-store.mjs:247` `identifier(sidekick.revision ?? '', '配置修订')`、`:342` 同规则；空串被 `identifier()` 拒。用生产 `revisionOf` 派生真实 revision 后即恢复。属**预置形状要求**，非产品缺陷；但这意味着「空配置 + 页面保存」是唯一可行初始化路径，测试/诊断必须按生产结构预置 |
| L-2 | 提交成功后产品**保持录入框打开**（`sourceSubmitted` 只在 `run.sourceId` 到达时关框，而 `toModelRun` 的 `sourceId` 取自 `inputRef.sourceId`） | 页面实测五次提交均为「dialog stayed open」，需用产品自己的「关闭录入」收起后才能下一次提交 |
| L-3 | 单飞闸与队列语义存在张力：闸的设计意图是「一次一个整理请求」，而契约要求 3 并发槽位 | `TextIntake.vue` 的 `organizer.running` 绑定 vs `task-scheduler.mjs:71-79` 的 `agentConcurrency` 循环 |

## 5. 边界与未验项

- 未验证：真实模型/真实凭据/用户根/Linux/代理（未授权未执行）；完整 `npm run check`；四套 II 业务测试（按派工不整跑）；「确认应用」的完整页面点击（§3.1）；3-running/2-queued 的页面路径（§3.2，页面不可达）。
- 本诊断只签该源版本诊断，不签稳定版原样浏览器验收（另派）。
- 自建进程（backend、受控模型服务、Chrome）在运行结束前全部终止；进程表残留检查见证据包。

## 6. 证据索引（`build/web-text-intake-ui-source/`）

- `admission.json`：本诊断准入登记（角色/树/候选/写入范围/自建进程）
- `identities.txt`：候选与真实 binary/dist/runtimeRoot 身份（含候选源码逐字节保真核对）
- `restore-plan.txt`：候选字节的接收与还原计划（未提交任何候选字节）
- `run/ui-diagnosis.mjs`：诊断脚本（CDP + 受控模型 + 只读库互证）
- `run/ui-diagnosis-run.txt`：完整实跑输出（10/12）
- `run/gap-evidence.txt`：旅程 B 缺口的精确控件/状态证据
- `run/probe-readiness.mjs` / `probe-readiness.log`：L-1 就绪闸定位（store flags + HTTP 状态码）
- `run/probe-entry.mjs` / `probe-entry.log`：入口控件标签随页面变化（今日页「整理一段原文」／待确认页「整理新文本」）
- `run/controlled-model.mjs`：loopback 受控模型服务（脚本化延迟、只记 auth 存在性）
- `run/journeyA.png`、`run/journeyA-dom.html`：旅程 A 截图与 DOM
- `SHA256SUMS.txt`：上述文件哈希

复跑（真实解释器命令）：

```sh
node build/web-text-intake-ui-source/run/ui-diagnosis.mjs <repo-root>
```

## 7. 给队长的结论

**本源版本诊断：旅程 A（预览前不改候选）通过；旅程 B 的「页面连续五任务 → 3 running/2 queued」不可达，根因是 `TextIntake.vue` 提交按钮的 `organizer.running` 单飞闸——全候选仅此一处提交路径。** 队列、逐任务取消、同根重启读回在页面/HTTP/只读库三层均可用。是否放开页面多提交（或承认单飞为产品意图并改由 TaskQueue 承担排队入口）需队长裁定；本诊断不改 I 生产代码。
