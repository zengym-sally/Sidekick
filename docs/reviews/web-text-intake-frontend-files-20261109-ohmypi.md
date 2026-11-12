# W1 前端四文件增量：移除提交单飞闸（OhMyPi，2026-11-09）

> 派工来源：MAYNE-24 正文「当前派工补充：四个前端文件独立收口（2026-11-09）」。
> 本记录只覆盖 OhMyPi 的前端四文件增量与聚焦验证，不签后端、II/III、完整门禁或业务准出。

## 1. 范围与写入边界

- 基点：I 候选 `d79b1f69d242081bee1657a2247ef6b2d28740e4`（tree `8324c0b2837e0bb0119f0222f01595e5b1ae232a`，父 `e8405339`）。该 I 候选**只是可运行前置，未获整体通过**。
- 交付提交：`76f44e7`（父 `dc83b34`，恰 4 文件 +562/−12）。
- 写入范围恰四个文件，无越界：

| 文件 | 相对基点 | 说明 |
|---|---|---|
| `src/components/TextIntake.vue` | **+2/−2 修改** | 唯一改动文件 |
| `src/components/TaskQueue.vue` | 字节相同 | I 候选原字节接收 |
| `src/stores/organizer.ts` | 字节相同 | I 候选原字节接收 |
| `src/lib/web-api-client.ts` | 字节相同 | I 候选原字节接收 |

- 未写：`server/`、`src-tauri/`、其余 `src/`、`tests/`、`scripts/`、`package.json`、`docs/engineering/`、`AGENTS.md`、共享 main。
- 为完成真实无 Tauri 运行，曾把 I 候选的 `server/lib/*.mjs`（credential-provider、model-snapshot、task-recovery、task-scheduler、task-service、text-intake-service、worker-host）与 `src-tauri/migrations/web-backend/003_text_intake.sql` 落盘作**只读运行前置**；交付前已全部移除，工作树恢复为 HEAD 状态加四文件增量。

## 2. 缺陷与修复

**缺陷**：`TextIntake.vue` 的**提交按钮** `<SkButton kind="commit" type="submit">` 绑定 `:disabled="organizer.running||organizer.starting||…"`，而 `organizer.running` 取自**当前选中 run** 的状态（`isRunning(run)` → `queued|running`，`run` 即 `selected` 的那一个 run）。因此只要存在任意后端任务活动，提交按钮即永久 disabled，页面无法提交第二个任务——这正是 e84 源模式诊断「journey B 页面路径不可达」的根因。

**归因更正（Codex 于评论 `01a1bd8f` 提出，已独立复算并接受）**：原记录把该门误归于 `SkFieldset`。实测 `d79b1f6` 的 `SkFieldset` 绑定本已是 `:disabled="organizer.starting||!settings.ready||settings.loading||settings.saving"`，**不含** `organizer.running`；`organizer.running` 在该文件只出现一次，就在提交按钮上。故实际解除的是**提交按钮上的 running 门**，字段集无需改动。缺陷结论、修复与证据不变，仅归因纠正。

**修复**（2 hunk，均在 `TextIntake.vue`）：

```diff
-async function submit(){if(!model.ready||model.saving||…
+async function submit(){if(organizer.starting||!model.ready||model.saving||…

-<SkButton kind="commit" type="submit" :loading="organizer.starting" :disabled="organizer.running||organizer.starting||…
+<SkButton kind="commit" type="submit" :loading="organizer.starting" :disabled="organizer.starting||…
```

- 文本提交**只在本次请求发出期间**受 `starting`／输入有效性限制；已有后端任务活动不再阻止继续提交（与派工冻结一致）。
- `starting` 保留：同一时间仍只允许一个在飞请求（`organizer.organize` 已有 `startGeneration` 竞态守卫）。
- 未绕过任何 disabled 控件，未用 API 调用替代页面动作。

## 3. 聚焦验证（真实无 Tauri 产品 DOM，14/14，两轮稳定）

驱动方式：headless Chrome 经 CDP 驱动**产品自身控件**——配对闸（输入配对码 →「进入工作台」）、capture 入口（今日页「整理一段原文」／待确认页「整理新文本」）、tab「文本智能整理」、textarea、提交按钮「开始整理」、修订面板「告诉班班怎么改」→「生成修改预览」、队列面板逐任务「取消」。合成工作根 + 内存 controlled provider（凭据引用 `synthetic:frontend`）+ 受控 worker 进程工厂（真实 stdio、真实退出事件、讲生产帧协议、持槽 25s）+ 真实 bundled Pi 产物。HTTP 与只读 SQLite 仅作互证；未绕任何 disabled 控件，未用 API 替代页面动作。

| # | 断言 | 实测 |
|---|---|---|
| — | 产品配对闸配对 / capture entry 就绪 | 通过 / 通过 |
| A1 | 从页面连续提交五个任务 | **通过**（5/5 ok，无 error） |
| A2 | 3 running / 2 queued（HTTP 互证） | **通过**——提交过程形状 `1/0 → 2/0 → 3/0 → 3/1 → 3/2` |
| A3 | 页面队列面板列出任务与排队位次 | **通过**——5 行，`第 1 位`／`第 2 位` |
| B1 | 页面逐任务取消 ×5 | **通过** |
| B2 | 取消后队列前进至空 | **通过**——`active=0 terminal=5`（`cancelled=4`：第 5 个在取消到达前已自行 succeeded，队列仍排空） |
| B3 | 面板报告队列已排空 | **通过**——「当前没有排队或进行中的整理任务。」 |
| C1 | 队列排空后再提交一文本 | **通过** |
| C2 | 候选出现在产品待确认区 | **通过**——候选 `cand_…` version=1，页面卡片 1 张 |
| C3 | 页面请求自然语言修改预览 | **通过** |
| C4 | **预览前后候选不变（version + title）** | **通过**——`v1/合成预览候选` → 预览后仍 `v1/合成预览候选` |
| D1 | 同合成根重启后来源保留 | **通过**——`before=6 after=6`，重启前会话 401（新 epoch） |
| D2 | 只读库互证 | **通过**——db sources=6、candidates=2、tasks=7 与 HTTP 一致 |

聚焦机械验证：`npm run typecheck` exit 0（4.37s）。

**受控面的诚实披露**：loopback 模型服务是凭据的目标，但**收到 0 个请求**——受控 worker 自行产出 extract 结果帧，不调用模型；故 `model-requests.jsonl` 为空。三运行／二排队形状由 worker 持槽 25s 产生，不是模型延迟的实测值。这是夹具属性，不是产品性能结论。

**Bring-up 期间修掉的 harness 缺陷（均记入证据，未动生产语义）**：① 配对按钮选择器误配（真实文案是「进入工作台」）；② capture 入口选择器误配（真实文案「整理一段原文」／「整理新文本」，tab 为「文本智能整理」）；③ HTTP 互证在配对前调 `/api/session` 致 401、cookie 从未建立，且页面会话 cookie 是 HttpOnly 不可读——改为用同一次性配对码独立配对一个第二会话；④ worker 用 `node -e` 时尾随 `--run` 被当作脚本名，加 `--` 分隔；⑤ 结果帧的 candidates 放错层级（调度器读 `frame.data.candidates`，不是 `frame.data.payload.candidates`），且候选形状须为 `{fields:{title,kind,owner,priority,…}}`；⑥ Chrome profile 单例锁在硬杀后残留，改为每次运行新建并退出时删除；⑦ `page.dom()` 大页偶发无响应，加 20s watchdog 且证据捕获失败不中断运行。

## 4. 未验证与后续（不代签）

- **未签**：完整 `npm run check`（III 唯一集成轮执行）；前端独立代码审查（本轮改派 OpenCode）；最终版原样浏览器验收（按派工改由未参与生产实现的 Kimi 或另派者承担）。
- **未实施**：「确认应用才变更」的完整页面点击——C4 已证「预览前不改候选」，`applyPreview` 的 `expectChanges:1` 版本守卫在源码层成立，页面点击留待最终版浏览器验收一并覆盖。
- 真实模型／真实凭据／用户根／Linux／代理：未授权未执行。
- 清理：自建 backend、受控 worker、Chrome 全部终止并经进程表核实；Chrome profiles 已删。
- 脱敏：证据中合成秘密值 0 命中、配对码 0 命中、`/Users/` 绝对路径 0 命中。
- 运行前置：`npm ci --ignore-scripts` → `probe:prepare-cli`（lark-cli 1.0.98）→ `probe:prepare-pi`（provenance `ad702637`/`e89822b0`）→ `probe:bundle` → `build` → `build:backend`。为运行曾把 I 候选的 `server/**`、5 个 `src-tauri/**` 文件与 `src/components/{SettingsPanel,Workbench}.vue`、`src/stores/{agents,models,pairing}.ts` 落盘作只读前置，**交付前已全部还原**，工作树恢复为 HEAD 加四文件增量。

## 5. 证据

- 提交：`76f44e7`（增量）、`95801d3`（本记录与索引），分支 `agent/ohmypi/mayne-24`。
- 真实产物身份：storage binary `42af54b5…`（2649408 B）、organizer bundle `08f32db2…`（2515908 B）、bundled node `9d050fd4…`（121911744 B）、static index `7a653e1a…`（366 B）；Pi provenance `ad702637`/tree `e89822b0`。
- 原始证据（`build/`，gitignored，可重建）：`build/web-text-intake-frontend/run/verify-frontend.mjs`（自包含，仅用 Node 内置模块）、`run/verify-frontend-run.txt`、`run/verify-frontend-run2.txt`（两轮 14/14）、`run/result.json`、`run/journeyC.png`、`run/journeyC-dom.html`、`run/model-requests.jsonl`（空，见 §3 披露）。
- 精选随工单附件：`build/web-text-intake-frontend/pkg/`（`admission.json`、`frontend-four-file-delta.diff`、`verify-frontend.mjs`、两轮实跑日志、`result.json`、截图、DOM、`SHA256SUMS.txt`）。
- 复跑命令：`node build/web-text-intake-frontend/run/verify-frontend.mjs <repo-root>`（需上述前置链）。
