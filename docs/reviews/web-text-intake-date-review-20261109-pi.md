# W1 客户端日期独审：sourceAt 精确毫秒、候选／预览映射与真实控件（Pi，2026-11-09）

- 范围与风险级：MAYNE-24 W1 客户端日期面独立审（接管 `01a1c02a-d437` 未交付项，沿 `01a1c02a-d42c` 原判据）。风险级 R2（只读审＋真实链聚焦验证，不改生产／测试／package／DDL）。
- 基点／候选身份（对象库逐项复核）：
  - `e54c27307c01199f7a56994183158bea09fd5d6c`／tree `d31be7f19bf3244d9710721a1fe96b6eac87b5f3`／父 `1d09811`；`src/lib/web-api-client.ts` blob `af34cc73d2dbea96bcf1c89d46aaefb0a74a846c`。
  - `b5fdfb9b1445fc767a9c54aa160815e09fca03bb`／tree `283ba6655d9f75e3c08db5b8da118ece31f5bf96`／父 `e54c273`；`src/lib/web-api-client.ts` blob `e730d4a344c4150d89737d08dd7c1a7a182c118d`。
  - DTO 后端 `72f1bb89a030fc246df4771829a00e99f2dc16d8`／tree `6c2294b945c75478316e75a8322d897dafe3e67a`／父 `c32c251`；`server/lib/text-intake-service.mjs` blob `8de136a1a03720b93ce87d8f645d1d45f2e3d353`、`server/lib/manual-items-service.mjs` blob `c11e75956a0dbae596467916acc9339517a06ac2`、entry blob `47a9efcd4c79977a04c413fc281b2e0d1d35229c`。
  - 本次未写客户端候选：`e54c273`／`b5fdfb9` 均由 OhMyPi 提交，本记录零候选字节改动。
- 产物身份（SHA-256 现场复算）：存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B，登记身份）；runtime `organizer.mjs 08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`、`node 9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`；node v24.20.0。combined 树（Kimi `d2b2696`＋所选四文件 overlay，四文件 blob 逐项 MATCH b5）`vite build`：b5 `dist/assets/index-CLcRV5aH.js 67c099a23728bf0bd698fa92ca128266601513dccca0f2a5d3021ebf7091e128`；e54 负控 `dist/assets/index-BGhUHsuC.js c87547a2547dabb6db644d31aaedf4c5708cb84669616a070b639d481598a1d4`。`vue-tsc --noEmit` 在 combined 树 exit 0。

## 一、代码面（sourceAt `e54c273`）

**通过。** `pointFromInstant(atMs, timeZone)` 用 `new Date(atMs).toISOString()` 原样生成 `at`，无 `floor`／截断；`localText` 取 `formatToParts` 的 `second`，毫秒非零补 `.SSS`，与 `at` 同粒度；`precision` 仍 `'minute'`，未新增精度值；注释已把「截断必需」整段替换为「VERBATIM，静默截断会把另一个时刻交还调用方」。真实 HTTP 实测（见二）`at` 逐毫秒往返。

## 二、API 面：同一 DTO 后端 `72f1bb8` 上 e54 vs b5 候选／预览映射

真实链：`startWebBackend`（`72f1bb8` entry）＋登记存储二进制＋登记 runtime＋loopback 受控模型；**默认工厂**（未传 `workerProcessFactory`）。两次独立旅程（e54、b5 各一，源文本带批次标记避免指纹去重合并），各 2 次模型请求、`Authorization` 头存在（值未记录）。

- **sourceAt 精确毫秒（两前端一致）**：提交 `sourceAtMs=1773981065250`（`2026-03-20T04:31:05.250Z`）→ 公开 `sourceAt.at` 逐字节 `2026-03-20T04:31:05.250Z`；`read_import_batch` 的 `sourceAtMs=1773981065250`、`anchorAtMs=1773981065250`。派生 `localText=2026-03-20 12:31:05.250`。
- **e54（候选／预览映射未桥接）**：`read_import_batch.candidates[*].fields.due/followup` 直接是公开线型 `{at,timeZone,localText,precision}`，**无 `atMs`**；`save_candidate` 回读、`previews[*].preview.fields`、`apply` 后 `fields` 同样无 `atMs`。即领域 `TimePoint` 的 `atMs` 丢失，UI 读 `due.atMs` 得 `undefined`。
- **b5（已桥接）**：`candidates[0].fields.due.atMs=1774540800000`（`2026-03-26T16:00:00Z`）、`candidates[1].fields.due.atMs=1795104000000`／`followup.atMs=1774022400000`；`previews[*].preview.fields.due.atMs=1796054400000`；`save_candidate` 以显式 `atMs=1798100130250` 写入并逐毫秒回读（`2026-12-24T08:15:30.250Z`）；`apply` 后候选 version 1→2、`due.atMs=1796054400000`。时区／`localText`／`precision` 全链保留；`null` 点映射为 `null`，未伪造。
- **写路径**：`toWireInput`→`toWirePoint` 发同一条线；`toDomainFields` 为唯一桥（`...fields` 透传 title/kind/owner/priority/tags），未双读旧 `atMs` 线型。

**结论：b5 的候选／预览映射通过（限该面）；e54 该面不通过（`atMs` 缺失）。**

## 三、控件面：真实随包 Pi＋受控模型下的完整 I 接线

真实产品 UI（combined 树 `dist` 由后端同源服务）＋ headless Chrome（CDP）＋**默认工厂派生真实随包 organizer**（进程树实测命令 `…/build/s0-runtime/node …/build/s0-runtime/organizer.mjs --run run_…`，无替换工厂）＋ loopback 受控模型；凭据引用经私有 `credentialProvider` 解析 2 次（值未记录）。

- **来源时间控件**：产品 `SkDateTimeField` 选「今天 12:31」→ 原文依据侧栏 `来源时间：2026/11/9 12:31`，与控件一致。
- **候选日期（UI＝只读库）**：两张候选卡 `due` 均 `2026-11-20`、followup `2026-11-14`；只读库 `candidates.fields_json` 对应 `due.atMs=1795104000000`（`2026-11-19T16:00Z`＝沪 `2026-11-20`）、`followup.atMs=1794585600000`（沪 `2026-11-14`）。
- **预览不提前改候选**：生成修改预览后 UI 候选仍 `due=2026-11-20`；只读库候选 version 仍 1、`fields_json` 未变。预览区显示 `截止 原：2026/11/20（仅日期） 拟改：2026/12/1（仅日期）`。
- **真实 apply 点击**：点「应用到候选」后 UI 候选 `due=2026-12-01`；只读库候选 version 1→2、`fields_json.due.atMs=1796054400000`（`2026-11-30T16:00Z`＝沪 `2026-12-01`），与预览「拟改」一致。
- **预算**：用例体 3 861 ms；含清理 10 000 ms ≪ 20 000 ms。运行后 0 遗留进程、0 临时根残留（`worker.json` 记录的两个 pid 已退出）。

**结论：控件面通过——候选日期、预览拟改、真实 apply 后 UI／只读库日期与版本一致，预览生成不改候选。**

## 四、负控（e54 同一旅程）

同一后端、同一模型脚本、同一 UI 旅程，仅把 `web-api-client.ts` 换成 e54：产品页渲染 **0 张候选卡**，页面出现 `Invalid time value` 错误两处，页脚仍显示 `已选 0 / 2 条`（只读库确有 2 条 pending）。即 e54 的候选映射缺失 `atMs` 会使 `timeDraft` 在 `calendarDate(undefined)` 处抛错、收件箱整块渲染失败；b5 无此现象。负控证明本浏览器探针**有判别力**，非空真。

## 五、边界与未签范围

- 未跑 19 旅程／完整 `npm run check`；未跑真实模型／真实凭据／用户根；未改生产／测试／package／DDL／Runtime。
- 浏览器控件面只签 b5 所选前端在 combined 树（Kimi `d2b2696`＋四文件 overlay）上的日期控件与 apply；不签 e54 后继修订、不签其他前端文件、不签整体准出。
- `72f1bb8` 与 `d2b2696` 的日期相关 server 文件逐字节相同，唯一差异是 T-10 签收 operation-key 冲突映射（`text-intake-service.mjs` +28 行），与本面无关；本审用 `72f1bb8` entry 精确执行。
- 观察（非阻断）：`WireCandidate` 上方注释仍写「`fields` carries the internal domain `TimePoint`」，与 `WireFields` 类型矛盾，属过期注释；建议后继收口。
- 原始证据（gitignored `build/mayne24-date-review/`）：`api-probe.mjs`＋`evidence/api-probe.json`；`browser-probe.mjs`＋`evidence/browser-probe.json`；`browser-probe-e54.mjs`＋`evidence/browser-probe-e54.json`；两棵 run-tree 的 dist 哈希如上。

## 六、补交付（2026-11-09，dispatch 01a1c0bf）

本节只补交付缺口，不重开已过代码／API／正控结论。

### 6.1 原探针脚本逐件披露（不补造）

`531157f` 评论实挂仅 3 件结果 JSON（`api-probe.json`／`browser-probe.json`／`browser-probe-e54.json`，哈希见 6.5）。三份探针脚本 `api-probe.mjs`、`browser-probe.mjs`、`browser-probe-e54.mjs` 当时写在运行树 `build/mayne24-date-review/` 内，该运行树已随任务结束回收；副本未保存，会话记录不含其字节。**三份原件均已回收、不可再挂，逐件披露如上，不补造旧件。** 现有记录只有源码与 dist 哈希，不能单独代签「页面实际加载的是哪份字节」；故另做 6.3 的最小页面身份核对，单独登记。

### 6.2 combined 四文件 blob 与所用后端（对象库逐项复核）

combined 树＝Kimi `d2b2696`（tree `542c169d`）＋ b5 所选四文件 overlay；四文件 blob 逐项如下（b5 `283ba665`）：

| 文件 | blob SHA-256 |
|---|---|
| `src/components/TextIntake.vue` | `fcf2dd756d4f2c4b37fd3f8f0b3574b010de9c7a327b23ec9363bfb7b5033e06` |
| `src/components/TaskQueue.vue` | `f0d049198a684fa1d62f255606ee199460624599df900b448aab786102cb2556` |
| `src/stores/organizer.ts` | `8a0410161fcfb721eaf9a4a8540d6b3278e8d18ba7a8e9815f1a81d6e19ffcec` |
| `src/lib/web-api-client.ts`（b5） | `52a70e2b9628682bd816d71d697aed11cb58b3d9c805be1dc82f510bdfcd9348` |
| `src/lib/web-api-client.ts`（e54 负控） | `f01371fd2b48b354cea71670ece74f85aa7cd282c8d6fb6beee649ea5439876b` |

e54 负控只替换 `src/lib/web-api-client.ts`（其余三文件与 b5 逐字节相同）。所用后端＝DTO 后端 `72f1bb8`（tree `6c2294b9`）：entry 内容 SHA-256 `5a799cdbe08661b4f3477f732b75b7338a967c89776873259645c2844f19713f`（对象库 blob `47a9efcd4c79977a04c413fc281b2e0d1d35229c`）；存储二进制 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`（2 647 984 B）；runtime `organizer.mjs 08f32db22205ffbac25160f15549a8d4fa5be31020588339e85a7076833911a7`、`node 9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`；node v24.20.0。

### 6.3 新最小页面身份核对（单独登记，不冒充旧日志）

从同一源码字节重建两棵运行树并 `vite build`（node_modules 与旧轮相同，vite 8.3.5）：

- combined（d2b2696＋b5 四文件）→ `dist/assets/index-CLcRV5aH.js` `67c099a23728bf0bd698fa92ca128266601513dccca0f2a5d3021ebf7091e128`（742 571 B），与旧记录**逐字节相同**。
- e54 负控（d2b2696＋e54 `web-api-client.ts`）→ `dist/assets/index-BGhUHsuC.js` `c87547a2547dabb6db644d31aaedf4c5708cb84669616a070b639d481598a1d4`，与旧记录**逐字节相同**。

真实后端（`72f1bb8` entry＋登记存储／runtime）服务 combined dist，headless Chrome 实际加载页面：DOM 实际引用 `/assets/index-CLcRV5aH.js`，浏览器实际请求 `http://127.0.0.1:<port>/assets/index-CLcRV5aH.js`，**响应体 SHA-256＝`67c099a2…`＝dist 文件哈希**（`matchesDist=true`）。即「源码→dist 哈希→页面实际加载响应哈希」三者对应成立。证据：`page-identity.json`＋`page-identity-probe.mjs`（新脚本，非旧件）。

### 6.4 负控重放更正（旧数字保留）

旧原件 `browser-probe-e54.json` 的 `totalDurationMs=23288` **保留不改**。新重放改用派工指定的就绪信号：以实际 `Invalid time value` 出现为错误已兑现信号（本次 3 062 ms 出现，两处），随后核候选卡＝0、只读库 pending＝2、页脚 `已选 0 / 2 条`；不再对永不出现的卡固定等满 16 s。用例体 3 062 ms、含清理 7 129 ms ≪ 20 000 ms，0 遗留进程／0 临时根残留。证据：`negative-control-replay.json`＋`negative-control-replay.mjs`（新脚本，非旧件）。

### 6.5 证据清单与 SHA256SUMS

| 文件 | 说明 |
|---|---|
| `api-probe-531157f.json` | 旧 API 面结果（附件 `01a1c0b9-d605…`） |
| `browser-probe-531157f.json` | 旧正控结果（附件 `01a1c0b9-d6d5…`） |
| `browser-probe-e54-531157f.json` | 旧负控结果（附件 `01a1c0b9-d7a5…`，23288 ms 保留） |
| `page-identity-probe.mjs` | 新最小页面身份核对脚本 |
| `page-identity.json` | 新页面身份核对结果 |
| `negative-control-replay.mjs` | 新负控重放脚本 |
| `negative-control-replay.json` | 新负控重放结果 |
| `SHA256SUMS` | 上述 7 件逐项 SHA-256 |
| `negative-control-rerun.json` | 6.6 重放新结果（清理后 durationMs／判别条件） |
| `negative-control-rerun-stderr.txt` | 6.6 重放原始收尾输出（totalMs／pass） |
| `negative-control-rerun-runlog.txt` | 6.6 重放命令／退出码／清理与零残留／装配身份 |

### 6.6 负控重放原始收尾输出补挂与装配登记（2026-11-10，dispatch 01a1c100）

`01a1c100` 指出：6.4 的 `negative-control-replay.json` 只记清理前 `durationMs`，含清理的 `totalMs／pass／退出码` 只在当时 stderr、未随附件交付。原运行树（`mayne-24-a06c5605bb4b`）已随任务回收，**原始 stderr 缺件、不可再挂**，不补造。按派工仅重放这一个负控，未重跑正控／API／19 旅程。

- **运行树重建**：`d2b2696`＋e54 `web-api-client.ts` overlay，`vite build`（node_modules 与旧轮相同，vite 8.3.5）→ `dist/assets/index-BGhUHsuC.js` `c87547a2…`，与 6.3 记录**逐字节相同**；后端 `72f1bb8` entry 内容 SHA-256 `5a799cdb…`；存储二进制 `5311ffa3…`；runtime `organizer.mjs 08f32db2…`／`node 9d050fd4…`；node v24.20.0。
- **原始收尾输出**（本次重放，raw stderr，exit 0）：`negative-control: errorSeen=true cards=0 pending=2 bodyMs=4108 totalMs=8192 pass=true`。含清理 `totalMs=8192 < 20000`；清理后 0 遗留进程、0 临时根残留（探针脚本不删调用方自有根，该根由本补件手动清除）。
- **新结果**：`negative-control-rerun.json`（`durationMs=4108`；候选卡 0／只读库 pending 2／页脚 `已选 0 / 2 条`）。原 `negative-control-replay.json`（`26065f76…`）**不改**。

**装配清单登记**（实际版本／哈希，对象库 2026-11-10 复算；运行树副本与对象库逐字节相符）：

| 夹具 | 来源提交 | blob SHA-1 | 内容 SHA-256 | 字节 |
|---|---|---|---|---|
| `model-config.mjs` | `7f3322b` | `8596b78e360de5ed60cd44ad8eeb61e3d90022a8` | `8c52f0ed25f23027b3cd9f7fb749330e1c9fde9a656267ca93627fde648ec2bf` | 5004 |
| `backend-process.mjs` | `d2b2696` | `7069c6657076cb0ccfb37106e8f2bdcd587b0571` | `98bfc544904d8674cf85a0f2ba478c18476614ed48da3c01dac9f92a34c3dbe9` | 34950 |
| `controlled-model.mjs` | `d2b2696` | `72a8d7554b111de92bbfc2b0884577a57a4d3903` | `9a8b509d397e5ae71aeb66f54845fa44a9ba1e2bf6b7a5d69fde8f1d199aaec7` | 8747 |
| `browser-probe.mjs` | `d2b2696` | `2aafda22869ade854873554817b5e2d87550d5f1` | `cd2c64f318bf2607ab56b2f65c78fc647eb42206cdae8872a29dbd460f43c366` | 19622 |
| `db-observer.mjs` | `d2b2696` | `173857dd93292ff4433d388c109041b6f77ceb45` | `d13d5ec60ab21a7fe16dc641834f2ea1860cce290a4b5a97fc9f423a2a9bdb4a` | 8935 |
| `synthetic-inputs.mjs` | `d2b2696` | `d5e1099128d7d4ec9833c5c1d23ba1ef93f3f4eb` | `ea3211e54f92edf38e6f158ecd38606f8ffd99e59193e62dfaafd59d231d6611` | 6685 |

`model-config.mjs` 即派工所指「树内未带」的 helper：它不在 `d2b2696` 树内，本次运行树所装版本逐字节取自已审 `7f3322b`（内容 SHA-256 如上），未给未知 helper 补造旧身份；该值与集成清单 manifest 的 `model-config.mjs 8596b78e@7f3322b` 一致。其余五件均取自 `d2b2696`。

`WireCandidate` 过期注释仍作非阻断观察保留，本次不因此改生产。本补件不构成最终独立浏览器验收或集成准入。

### 6.7 负控计时边界收口（2026-11-10，dispatch 01a1c12f）

`01a1c12f` 指出：6.6 的 `8192ms` 只能签 Chrome／backend／model 关闭时长——计时起点在自有临时根与控制模型子进程取得之后，且脚本退出后根由调用方另行删除；`mkdtempSync(...mayne24-date-negctl-...)` 创建的正是本例自有根，不能作为计时外的调用方资源排除。本节按派工只收口这一个负控，未重跑正控／API／页面身份／19 旅程或完整 gate，不改生产／测试／package。

**驱动修正**（新驱动 `negative-control-closeout.mjs`，非旧件；旧 `negative-control-replay.mjs` 字节不动）：

- 计时起点移到用例顶部、`mkdtempSync` 与 `startControlledModelService` 之前（构建准备在本脚本外已完成；证据目录创建属 harness 脚手架，非用例资源）。
- 同一驱动的 `finally` 拥有全部清理：依次 `chrome.close()`／`backend.close()`／`model.stop()`，再 `rmSync(root,{recursive:true,force:true})`；随后核 `rootRemoved=!existsSync(root)`，并以 `descendantPids(process.pid)` 为「自有进程」判据，有界等待（2s）确认无本驱动后代残留。
- `totalMs／pass／exitCode` 只在清理完成后导出；正常与失败路径都执行同一清理；任一清理失败（close／stop／rm／进程表）都使 `pass=false`。脚本退出后不再另行删根。
- `pass` 判据＝无 bodyError ∧ errorSeen ∧ cards=0 ∧ pending=2 ∧ 无清理失败 ∧ rootRemoved ∧ 无自有进程残留 ∧ `totalMs<20000`。

**一次必要重放**（运行树、后端、存储、runtime、node 身份与 6.6 逐项相同：dist `c87547a2…`、entry `5a799cdb…`、存储 `5311ffa3…`、organizer `08f32db2…`／node `9d050fd4…`、node v24.20.0；夹具六件字节复算与 6.6 表一致）：

- 原始收尾输出（raw stderr，exit 0）：`negative-control: errorSeen=true cards=0 pending=2 bodyMs=3212 cleanupMs=4096 totalMs=7308 rootRemoved=true residue=0 exitCode=0 pass=true`。
- 判别条件不变：`Invalid time value` 出现 2 处；候选卡 0；只读库 pending 2（`cand_6bcabe80076d81d481973e9c4445f482`／`cand_0cbc6b464142207dd09df1dac0f40435`）；页脚 `已选 0 / 2 条`；模型请求 2 条。
- 全部清理后 `totalMs=7308 < 20000`；`rootRemoved=true`；自有进程残留 0；临时根无残留。

**旧 8192ms 原件保留与范围**：`negative-control-rerun-stderr.txt`（`sha256 0a3514eb49c6c9f7425206e17991b8a1b9b7bd2c210746996820ee5df1adda85`，`bodyMs=4108 totalMs=8192 pass=true`）与 `negative-control-rerun.json`（`sha256 d1a067d4d7a6be4aef488ab19efbfd9557afbf6efdd0eb438ad117529f0a1b11`）**不改**，其范围仅限旧计时边界（不含根创建与根删除），本节收口后以 `totalMs` 全覆盖为准；其判别结论（errorSeen／cards=0／pending=2）与本节一致，不重开。原 `negative-control-replay.json`（`sha256 26065f76fab03fa56eb63fc780196e9eabebbf48d085fd3a1bf6e1a899b5b8a9`）与旧驱动（`sha256 b7308fec22fe9fb0b8dd3cc4c9533c01ecd53fc32eb80ce46bfd2f03d14f9986`）同样保留不改。

**新证据**：

| 文件 | 说明 |
|---|---|
| `negative-control-closeout.mjs` | 新驱动实际字节（12 733 B），`sha256 2fbff36d526cc87094410c2b2afcc3f899a6caf80df57d902913b2a5d4ec9df2` |
| `negative-control-closeout.json` | 新结果（bodyMs／cleanupMs／totalMs／rootRemoved／ownProcessResidue／exitCode／pass） |
| `closeout-stderr.txt` | 新原始收尾输出（同上字段） |
| `SHA256SUMS-closeout` | 上述文件逐项 SHA-256 |

本节不构成最终独立浏览器验收或集成准入。
