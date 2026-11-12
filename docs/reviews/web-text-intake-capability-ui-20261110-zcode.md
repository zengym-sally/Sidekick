# 文本整理能力面 UI 修订（capability-UI）— 2026-11-10 ZCode

- **范围与风险级**：按派工 `01a1c15f`（协调层，MAYNE-24 线程）唯一修订三个生产路径 `src/components/AgentSettingsPanel.vue`、`ModelSettingsPanel.vue`、`SettingsPanel.vue`，使能力／文案与实际管道一致；新增针对性红绿回归单元与基线夹具。风险级：中（生产前端文案与门控面，不改任何 store／client／server／package 行为）。
- **基点**：分支 `agent/zcode/mayne-24`，起点 `34c2e6d`；本切片提交 `180c2ae` → `b08bf01` → `2d5e15f` → `61bd170` →（本记录提交）。
- **先行事项**：派工要求「先完成当前发布哈希补件」——该补件已在前一轮交付（提交 `34c2e6d`＝`docs/reviews/web-text-intake-evidence-carrier-map-20261110-zcode.md`，交付评论 `01a1c148`，发布集合 `SHA256SUMS-published` 六项自实际附件字节重算＋原→副本全映射），本轮未重做、未改动该记录。

## 1. 修订依据（只读事实，全部来自已锁定字节）

- `cd08588` `server/lib/http-server.mjs:19` `WIRED_AGENT_IDS=['organizer']`；`:910` `requireWiredAgent`，agent read（`:918`）／write（`:925`）／reset（`:934`）均先过门，tracker/advisor 答 404 `not_found`；`task-service.mjs:16` `TASK_ROLES=['organizer']`。`AGENT_IDS` 三角色是领域储备，不是 HTTP 接线证明（派工对 `84aa934` 审的纠正）。
- `cd08588` `server/lib/config-store.mjs` `writeModelConfiguration`：`input.apiKeys` 非空即抛 `plain_credential`（「配置接口不接受明文密钥，请改用凭据引用。」）；`credentialStatusFor` 仅由注入的凭据提供方解析引用（`env:<NAME>` 合成引用／`apiKeyRef`），状态词表 `available|missing|unavailable`（§7）。models/agents 两 store 在基线与 b5 选择字节中均默认 `getWebApiClient().asBackend()`——两种宿主同一管道，钥匙串写入不在该管道内（不实现 D1／OS provider）。
- 基线（完整 I `cd08588` ＋ b5 所选前端 overlay，注册 blob：web-api-client `e730d4a3`、organizer `d4b824cb`、TaskQueue `1bd5d476`、ModelSettingsPanel `0216921e`、TextIntake `b6c1897d`；SettingsPanel／AgentSettingsPanel 取冻结 I／cd 同 blob `fa75f477`／`107b8d74`）中三文件的确凿缺陷：ModelSettingsPanel 以 `nativeBridgeAvailable()` 选钥匙串文案（桌面端同样走 asBackend，两支文案都不真）；onMounted 预读三角色（tracker/advisor 必 404）；AgentSettingsPanel 三角色 tab 均可点、试跑按钮仅受 `canTrial` 门控（点击即得 unsupported_command 内联错误）；SettingsPanel About 与 tab 描述宣称三角色配置可用。

## 2. 提交序列与字节身份

| 提交 | 内容 | 身份 |
|---|---|---|
| `180c2ae` | 基线对齐（仅派工三路径内的两文件） | ModelSettingsPanel `d8273800`→`0216921e`；SettingsPanel `c412cf3f`→`fa75f477`；AgentSettingsPanel 本分支已是 `107b8d74`（＝基线，零改动）。内容 SHA-256：`2e025366…`／`cdaa145c…`／`e289bae4…` |
| `b08bf01` | 红回归单元＋三份基线夹具（`.vue` 命名，后被重命名） | 测试 blob 后经 `61bd170` 更新；夹具＝注册基线 blob 原字节 |
| `2d5e15f` | 三文件能力面修复＋夹具重命名 `.vue.txt`（见 §5 更正） | 修复后 blob：Agent `8a44fc3d`／Model `e67f8d18`／Settings `73c1f643` |
| `61bd170` | 单元改读 `.vue.txt` 夹具＋头部扩展名说明 | 测试 blob `c868820b`，内容 SHA `00c5ce66…` |

最终树内容 SHA-256（`build/mayne24-capability-ui/SHA256SUMS-committed`）：AgentSettingsPanel `c44ca75a…`、ModelSettingsPanel `8ce5ca2d…`、SettingsPanel `73e3fea9…`、测试 `00c5ce66…`、三夹具 `e289bae4…`／`2e025366…`／`cdaa145c…`（＝注册基线 blob 原字节，HEAD `git ls-tree` 逐项核对相等）。

## 3. 修复面逐条（全部为模板／脚本文案与门控，零行为管道改动）

1. **只开放 organizer 配置**：AgentSettingsPanel 角色 tab `:disabled="item.id!=='organizer'||…"`，tracker/advisor 标注「· 未接通」；领域三角色（`src/domain/agents.ts`）与原生工厂（`src/lib/host-capabilities.ts` 的 `nativeBridgeAvailable`）零改动（真实模块导入断言在案）。
2. **去掉未接角色预读**：ModelSettingsPanel onMounted 由三角色循环改为仅 `agents.load('organizer')`，注释写明 `requireWiredAgent` 门槛；`uses()` 只列已加载角色，「正在使用」列自然如实。
3. **隔离试跑禁用并说明**：`trialWired=false`（注释写明 asBackend 双宿主 `unsupported_command`，不按 nativeAvailable 门控）；开始按钮与样例输入框禁用；三段按角色试跑许诺文案（含「使用已保存配置与已发布技能索引。」）删除，换成「隔离试跑在当前管道未接通……仅保留为草稿，不会被发送。」；结果空态改「暂无试跑结果」。`start()`／`canTrial` 保留作纵深防御。
4. **凭据输入帮助按实际 HTTP 能力**：删除 `keychainPipe=nativeBridgeAvailable()` 分支与钥匙串许诺（「密钥将写入系统钥匙串」「或在桌面端填写密钥」「API Key · 钥匙串」全部消失）；`keyHelp`/`keyPlaceholder` 无条件如实——`不接收明文密钥：请改用环境变量引用；已有引用留空保留`（对应服务端 `plain_credential` 拒载、草稿由 store 已知码保留）、引用可解析时「留空保留原引用」。**凭据状态判据逐字保留**：`credentialLabel` 五态映射（含 native 历史 `stored`/`environment`）、`credentialResolved` 判据、§7 词表注释块、`SkSecretInput` 仅绑 `model.keys[p.id]` 草稿（非空密钥拒载不变）。
5. **About 与真实可用范围一致**：About「三个内置智能体配置」→「事项整理（organizer）智能体配置；进展跟踪、工作参谋的配置与隔离试跑尚未接通。」；agents tab 描述、models tab「供不同角色选择」同步收窄。真实面板（`<ModelSettingsPanel/>`／`<AgentSettingsPanel @models=…/>`）保持冻结 I 字节原样，无 native 门复辟；desktop/tools/version 的 native-only 文案未动。
6. **保留项**：模型连通性 test 任务（`测试连接`／`organizer.testModel`／`testRun` 判据）、文本整理、草稿保留与「重新读取，保留草稿」流、`stageReset`、非组织角色领域储备（store 内 tracker/advisor 样例与 states 结构未动）——均由红绿单元 F6 面固定。`toolsEnabled` computed 保留（其唯一消费者段落随 §3.3 移除；为试跑未来接线留备，tsconfig 无 noUnusedLocals）。

## 4. 红绿回归与门禁

`tests/unit/web-text-intake-capability-ui.test.mjs`：七个 test，每面「缺陷在已钉基线夹具＋修复在生产字节」双向断言；夹具逐字节钉死（内容 SHA 断言，防篡改）。方法边界在文件头如实声明：SFC 字节在 node --test 下不可导入，能力面以字节事实钉住；仅纯 TS 域模块真实导入（三角色、nativeBridgeAvailable 工厂面）；无生产状态注入、无进程、无临时根，清理为零。

| 命令 | 结果 |
|---|---|
| `node --test --test-reporter=tap tests/unit/web-text-intake-capability-ui.test.mjs`（修复前树，`b08bf01` 字节） | exit 1，恰 #2–#6 五个生产面红、#1/#7 绿，stderr 0 B（`red-capability-ui.tap`） |
| 同上（修复后，最终字节，stash 往返重证） | exit 1，#2–#6 红（`red-final.tap`）；修复恢复后 exit 0，7/7 绿、stderr 0 B（`green-final.tap`／`green-after-pop.tap`） |
| `node --check tests/unit/web-text-intake-capability-ui.test.mjs` | exit 0 |
| 单元墙钟 | 0.10 s（≪20 s 含清理预算；无资源取得，清理为零） |
| `npm ci --ignore-scripts` | exit 0（`npm-ci.log`） |
| `npm run typecheck`（vue-tsc --noEmit） | exit 0（`typecheck-after.txt`） |
| `npm run check:structure` | 183＝本分支登记基线、零新增；capability-ui 零命中（`structure-final.txt`） |

## 5. 过程更正（如实登记，不掩盖）

1. **夹具命名**：初版夹具以 `.vue` 命名入库（`b08bf01`），`check:structure` 将其冻结 import 当源码引用扫出 47 条 `ref.missing`（230 vs 基线 183）。夹具是字节快照而非活组件，改名 `.vue.txt`（字节不变、SHA 不变）；重命名已暂存，随 `2d5e15f` 一起落盘——**该提交实际含 6 文件（三面板＋三重命名），其提交消息「rename in next commit」对这三个重命名不准确**，以此段为准；`61bd170` 完成单元侧路径／头部更新并按最终字节重证红绿。过渡态如实登记：仅 `2d5e15f` 单树内单元会因夹具名 ENOENT，紧随其后的 `61bd170` 修复。
2. **红绿两轮**：`b08bf01` 轮（.vue 夹具名）与 `61bd170` 轮（最终字节）两套 TAP 均保留（`red-capability-ui.tap`／`red-final.tap`／`green-final.tap`／`green-after-pop.tap`），结论一致。

## 6. 边界与未验证项

- 未做浏览器／原生运行时验收、未跑聚合套件 `test:web-text-intake`、未跑完整门禁、未重跑 19 旅程；本分支对 client/store/server/package 携带自有世系字节，完整基线树组装仍归唯一集成轮（惯例不变）。
- SSE 生产修复未动（等路线裁定，未夹入本包）；未实现 D1／OS provider、未删领域三角色或原生工厂、未新增依赖。
- 试跑禁用的运行时行为（适配器 `unsupported_command`）引用已接收的 b5 审事实，未在本轮动态重证；文案与判据的正确性由字节面＋真实模块导入面覆盖。
- 原始证据（gitignored）：`build/mayne24-capability-ui/`（双轮红绿 TAP＋stderr、timing、typecheck、structure 前后、npm-ci 日志、SHA256SUMS-committed、基线对齐前后 SHA 记录）。

## 7. 结论

**限定通过（作者自报，待独立独审）**：派工五项要求（只开 organizer、准确禁用／标明未接角色并去预读、试跑禁用并说明、凭据帮助按实际 HTTP 能力、About 与真实范围一致）逐项落地且由红绿单元固定；六项保留判据（test 任务、文本整理、拒载／草稿、凭据状态词表、领域三角色、原生工厂）逐项在案。仅涉派工授权的三路径，其余路径最小清单为**空**。MAYNE-24 保持 `in_progress`。
