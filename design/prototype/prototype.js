const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const seedText = "本次接入评审明确：由我整理模型网关接入清单，周五17点前提交。林川负责修复SDK鉴权问题，周五16点前交付，我需要跟进。下一轮试用名单由我确认，具体时间待定。";
const state = {
  page: "today", filter: "active", query: "", settingsTab: "agents", agent: "organizer", nextId: 108, signed: 0,
  modelStatus: "idle", sourceStatus: "connected", mcpStatus: "idle", quiet: false, selected: new Set([1, 2, 3]),
  workspace: "~/Library/Application Support/Sidekick/workspace", directoryOpen: false, lastDetail: 4,
  tasks: [
    { id: 101, title: "梳理平台接入方案的三个决策点", kind: "action", owner: "我", due: "今天 13:30", priority: "高", tag: "架构评审", source: "评审纪要", done: false, urgent: true },
    { id: 102, title: "补充试用反馈中的异常场景", kind: "action", owner: "我", due: "今天 17:00", priority: "中", tag: "产品体验", source: "手工录入", done: false },
    { id: 103, title: "确认明天评审会的讨论材料", kind: "action", owner: "我", due: "今天 18:00", priority: "中", tag: "会议准备", source: "飞书消息", done: false },
    { id: 4, title: "跟进接入方案交付，确认验收结论", kind: "followup", owner: "林川", due: "今天 16:00", followup: "今天 14:30", priority: "高", tag: "方案交付", source: "飞书消息", done: false, progress: "林川发来了方案文件，等你检查验收。", pending: true },
    { id: 105, title: "跟进知识库样例数据的补充", kind: "followup", owner: "周宁", due: "明天 11:00", followup: "今天 17:30", priority: "中", tag: "知识库", source: "评审纪要", done: false },
    { id: 106, title: "整理上次评审的问题清单", kind: "action", owner: "我", due: "昨天 18:00", priority: "中", tag: "架构评审", source: "手工录入", done: true },
  ],
  candidates: [
    { id: 1, title: "整理模型网关接入清单", kind: "action", owner: "我", due: "10月30日 17:00", quote: "由我整理模型网关接入清单，周五17点前提交。" },
    { id: 2, title: "跟进SDK鉴权问题修复", kind: "followup", owner: "林川", due: "10月30日 16:00", quote: "林川负责修复SDK鉴权问题，周五16点前交付，我需要跟进。" },
    { id: 3, title: "确认下一轮试用名单", kind: "action", owner: "我", due: "未定期", quote: "下一轮试用名单由我确认，具体时间待定。" },
  ],
  preferences: {}, drafts: {}, agentModels: {}, collectInterval: "每 30 分钟",
};
const agents = {
  organizer: { name: "事项整理", label: "读懂资料，整理成事", icon: "inbox", prompt: "优先关注我需要执行或跟进的行动项。保留原文依据；没有明确截止时间时标记为未定期。" },
  tracker: { name: "进展跟踪", label: "新线索，接上旧事情", icon: "link", prompt: "关联已有事项的后续消息。区分已提交和已验收，发现关键变化时提出建议，不直接改动状态。" },
  advisor: { name: "工作参谋", label: "理清重点，收好一天", icon: "spark", prompt: "按截止时间和跟进责任提出今日重点。日报保持简短，数字引用已确认事项，未核实进展明确标记。" },
};
const pageNames = { today: "今日工作台", inbox: "待确认", all: "全部事项", report: "日报复盘", settings: "设置" };

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}
function updateNavigation() {
  document.querySelectorAll(".nav-item").forEach((el) => { const active = el.dataset.page === state.page; el.classList.toggle("active", active); active ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current"); });
  $("#nav-inbox-count").textContent = state.candidates.length;
  $("#nav-inbox-count").hidden = state.candidates.length === 0;
  $("#page-label").textContent = pageNames[state.page];
}
function navigate(page) { state.page = page; updateNavigation(); render(); $("#view").scrollTop = 0; }
function taskRow(task) {
  return `<li class="task-row ${task.done ? "completed" : ""}"><button class="complete-check ${task.done ? "done" : ""}" data-action="complete" data-id="${task.id}" aria-label="${task.done ? "重新打开" : "标记完成"}：${escapeHtml(task.title)}">${icon("check")}</button><div><button class="task-title" data-action="detail" data-id="${task.id}">${escapeHtml(task.title)}</button><div class="task-meta">${task.kind === "followup" ? `<span>${icon("user")} ${escapeHtml(task.owner)}执行</span><span>·</span>` : ""}<span class="task-tag">${escapeHtml(task.tag)}</span><span>${icon("source")} ${escapeHtml(task.source)}</span>${task.reminder ? `<span>· ${escapeHtml(task.reminder)}</span>` : ""}</div>${task.progress && !task.done ? `<div class="progress-line"><span class="status-dot"></span><span>新进展 · ${escapeHtml(task.progress)}</span></div>` : ""}</div><span class="due ${task.urgent && !task.done ? "urgent" : ""}">${escapeHtml(task.kind === "followup" && !task.done ? task.followup : task.due)}</span></li>`;
}
function renderToday() {
  const active = state.tasks.filter((t) => !t.done); const mine = active.filter((t) => t.kind === "action"); const follows = active.filter((t) => t.kind === "followup");
  return `<div class="page-intro page-intro-row"><div><h1>老板，今天先盯住重点。</h1><p>${mine.length} 件待处理，${follows.length} 件待跟进。新的进展，班班替你记着。</p></div><time class="date-stamp">2026.10.29 · 星期四</time></div><div class="today-grid"><div class="work-list"><section class="task-section"><div class="section-heading"><h2>待我处理</h2><span class="count">${mine.length}</span><button class="text-button" data-page="all">查看全部 ${icon("chevron")}</button></div>${mine.length ? `<ul class="task-list">${mine.map(taskRow).join("")}</ul>` : `<p class="quiet-info">今天待处理的事都收好了。可以看看跟进事项。</p>`}</section><section class="task-section"><div class="section-heading"><h2>待我跟进</h2><span class="count">${follows.length}</span><span class="small-note" style="margin-left:auto">按下次跟进时间</span></div>${follows.length ? `<ul class="task-list">${follows.map(taskRow).join("")}</ul>` : `<p class="quiet-info">暂无待跟进事项。</p>`}</section>${state.candidates.length ? `<div class="inbox-nudge">${icon("inbox")}<div><strong>${state.candidates.length} 条事项，等你签收</strong><p>来自一份接入评审纪要 · 演示资料</p></div><button class="text-button" data-page="inbox">去确认 ${icon("arrow")}</button></div>` : `<div class="progress-ack">${icon("check")} 待确认已清空，今天的事情都在这里。</div>`}<p class="quiet-info">所有资料均为虚构演示。原型中的完成、签收和提醒仅更新当前页面，刷新即可复位。</p></div><aside class="brief-rail"><div class="brief-heading"><img src="../brand/sidekick-mark.svg" alt=""><h2>班班简报</h2></div><div class="brief-message"><h3>盯着呢，老板。</h3><p>${!state.tasks.find((t) => t.id === 4)?.done ? "林川的方案有新进展。先看看交付，再确认是否完成。" : "这次交付已经收好了。下一个跟进节点，也替你记着。"}</p><button class="text-button" data-action="detail" data-id="4">查看这条进展 ${icon("arrow")}</button><div class="brief-pet"><span>替你记着。</span><img src="../brand/banban-found.svg" alt="举着小本子的班班"></div></div><section class="rail-section"><h3>今天的安排建议</h3><div class="priority-note"><span class="num">1</span><p>先理清接入方案的决策点<small>13:30 截止，预留一点整理时间</small></p></div><div class="priority-note"><span class="num">2</span><p>验收林川提交的方案<small>已发现交付线索，完成结论由你确认</small></p></div></section><section class="rail-section"><h3>来源收集</h3><button class="rail-link" data-action="source-settings"><span>飞书纪要与 @ 我的消息</span>${icon("chevron")}</button><div class="source-status"><span><i class="status-dot"></i> 演示已连接</span><span>${escapeHtml(state.collectInterval)}</span></div><p class="small-note">Coremail 与语音仍在后续规划中。</p></section></aside></div>`;
}
function candidateCard(c) {
  return `<article class="candidate"><div class="candidate-top"><input type="checkbox" data-candidate-select="${c.id}" ${state.selected.has(c.id) ? "checked" : ""} aria-label="选择候选：${escapeHtml(c.title)}"><input class="candidate-title" data-candidate-field="title" data-id="${c.id}" value="${escapeHtml(c.title)}" aria-label="候选事项标题"></div><div class="candidate-fields"><select data-candidate-field="kind" data-id="${c.id}" aria-label="事项类型"><option value="action" ${c.kind === "action" ? "selected" : ""}>待我处理</option><option value="followup" ${c.kind === "followup" ? "selected" : ""}>待我跟进</option></select><input data-candidate-field="owner" data-id="${c.id}" value="${escapeHtml(c.owner)}" aria-label="实际负责人"><input data-candidate-field="due" data-id="${c.id}" value="${escapeHtml(c.due)}" aria-label="截止时间"></div><blockquote>“${escapeHtml(c.quote)}”</blockquote><div class="candidate-footer"><span>${c.edited ? "已修改，等待签收" : "有原文依据 · 未入库"}</span><button class="text-button" data-action="discard" data-id="${c.id}">丢弃这条</button></div></article>`;
}
function renderInbox() {
  if (!state.candidates.length) return `<div class="page-intro"><h1>待确认</h1><p>所有 AI 提取结果，经过你签收才成为正式事项。</p></div><div class="empty"><img src="../brand/banban-done.svg" alt="完成致意的班班"><h2>都收好了，老板。</h2><p>${state.signed ? `本次已签收 ${state.signed} 条事项。` : "这一批没有剩余候选。"}<br>新事项已经进入你的工作清单。</p><button class="button dark" data-page="all">查看全部事项 ${icon("arrow")}</button></div>`;
  return `<div class="page-intro"><h1>先过一眼，再交给班班盯。</h1><p>检查归属与时间，修改或丢弃不合适的候选。签收前不会提醒。</p></div>${state.signed ? `<div class="progress-ack">${icon("check")} 已签收 ${state.signed} 条，剩余 ${state.candidates.length} 条待确认。</div>` : ""}<div class="candidate-layout"><div><div class="batch-source">${icon("source")} 接入评审纪要 <span class="pill">演示资料</span><span style="margin-left:auto">${state.candidates.length} 条候选</span></div>${state.candidates.map(candidateCard).join("")}<div class="assist-bar">${icon("spark")}<label class="screen-reader-only" for="assist-input">用自然语言修改候选</label><input id="assist-input" placeholder="例如：把第一条改为明天17点"><button class="button small ghost" data-action="assist">预览修改</button></div><p class="small-note">演示中的辅助修改支持示例指令；真实自然语言理解尚未接入。</p></div><aside class="source-reader"><h3>原文依据</h3><p>本次接入评审明确：</p><p><mark>由我整理模型网关接入清单，周五17点前提交。</mark></p><p>林川负责修复SDK鉴权问题，周五16点前交付，我需要跟进。</p><p>下一轮试用名单由我确认，具体时间待定。</p><small>示例来源时间：2026-10-29<br>日期理解锚点：Asia/Shanghai<br>未识别的时间保留“未定期”，由你补充。</small></aside></div>`;
}
function renderAll() {
  const q = state.query.trim().toLowerCase();
  const tasks = state.tasks.filter((t) => (state.filter === "done" ? t.done : state.filter === "all" ? true : !t.done) && (!q || `${t.title} ${t.owner} ${t.tag}`.toLowerCase().includes(q)));
  return `<div class="page-intro"><h1>每件事，都有着落。</h1><p>执行的、跟进的、已收好的，都在你的个人清单里。</p></div><div class="sub-toolbar"><div class="tabs" aria-label="事项状态">${[["active", "未完成"], ["done", "已完成"], ["all", "全部"]].map(([key, label]) => `<button class="tab ${state.filter === key ? "active" : ""}" data-action="filter" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join("")}</div><label class="screen-reader-only" for="task-search">搜索事项或负责人</label><input id="task-search" class="search-input" placeholder="搜索事项或负责人" value="${escapeHtml(state.query)}"></div><div class="section-heading"><h2>${state.filter === "done" ? "已完成事项" : "个人事项"}</h2><span class="count">${tasks.length}</span></div>${tasks.length ? `<ul class="task-list">${tasks.map(taskRow).join("")}</ul>` : `<div class="empty"><img src="../brand/banban-idle.svg" alt="班班"><h2>${q ? "没有找到相关事项" : "这里暂时没有事项"}</h2><p>${q ? "换个关键词，或者清除搜索条件。" : "可以先从一条简单的事项开始。"}</p><button class="button ghost" data-action="${q ? "clear-search" : "intake"}">${q ? "清除搜索" : "记录一条"}</button></div>`}`;
}
function renderReport() {
  const done = state.tasks.filter((t) => t.done).length;
  return `<div class="page-intro page-intro-row"><div><h1>今天的事，收个尾。</h1><p>事实有据，线索有区分。日报不会自动创建或修改事项。</p></div><button class="button ghost" data-action="report-refresh">${icon("refresh")} 模拟重新生成</button></div><article class="report-paper"><span class="report-date">2026.10.29 · 日报预览</span><h2 style="margin-top:12px">老板，今天盯住这些事。</h2><span class="pill">演示生成 · 非真实 AI 输出</span><div class="report-summary"><div><strong>${done}</strong><small>已完成</small></div><div><strong>${state.signed}</strong><small>新签收</small></div><div><strong>${state.tasks.filter((t) => !t.done && t.kind === "followup").length}</strong><small>待跟进</small></div></div><h3>今天已经收好的</h3><ul>${state.tasks.filter((t) => t.done).map((t) => `<li>${escapeHtml(t.title)}</li>`).join("") || "<li>暂未记录完成事项。</li>"}</ul><h3>值得留意的新进展</h3><p>林川的接入方案出现交付线索。${state.tasks.find((t) => t.id === 4)?.done ? "你已手动确认完成。" : "目前仍待你验收，不计为已完成。"}</p><blockquote>“方案文件已发，请查收。”<br>示例飞书消息 · 新线索，尚未自动改变事项状态。</blockquote><h3>明天可以先盯的</h3><ul><li>跟进知识库样例数据补充，确认周宁的交付安排。</li><li>检查接入清单的未定项，提前准备评审材料。</li></ul><p class="small-note">数字根据本原型当前事项计算，其余文字为固定示例。真实报告生成、自动调度与数据持久化尚未接入。</p><button class="button ghost" data-action="copy-report">${icon("copy")} 复制日报示例</button></article>`;
}
function renderAgentSettings() {
  const a = agents[state.agent]; const prompt = state.drafts[state.agent] ?? state.preferences[state.agent] ?? a.prompt;
  return `<div class="settings-layout"><div class="agent-selector">${Object.entries(agents).map(([id, agent]) => `<button class="agent-choice ${id === state.agent ? "active" : ""}" data-action="agent" data-agent="${id}">${icon(agent.icon)}<span><strong>${agent.name}</strong><small>${agent.label}</small></span></button>`).join("")}<p class="small-note">三个角色，共同组成班班。<br>不需要你来分派，也不能新增。</p></div><section class="settings-content"><h2>${a.name}</h2><p>${a.label}。角色职责固定，模型和偏好可以调整。</p><div class="setting-row"><div><strong>使用的模型</strong><small>未单独选择时，继承全局默认模型。</small></div><select class="select" id="agent-model" aria-label="智能体模型"><option>继承默认 · 示例公司网关</option><option>示例快速模型</option><option>示例推理模型</option></select></div><div class="setting-row"><div><strong>保留来源依据</strong><small>整理时同时展示可核对的原文。</small></div><span class="pill">固定业务规则</span></div><div class="field"><label class="field-label" for="agent-prompt">个性化补充说明</label><textarea id="agent-prompt">${escapeHtml(prompt)}</textarea><p class="small-note">这里调整工作习惯和表达；不改变正常业务接口的签收规则。</p></div><div style="display:flex;gap:8px"><button class="button dark" data-action="save-agent">保存偏好</button><button class="button ghost" data-action="reset-agent">恢复默认</button></div><div class="connection-panel"><h3>模型连接 <span class="pill ${state.modelStatus === "error" ? "danger" : ""}">${state.modelStatus === "connected" ? "演示连接成功" : state.modelStatus === "running" ? "演示测试中" : "未执行真实测试"}</span></h3><p>个人 API Key 或已有公司网关，统一连接层供三个角色使用。</p><label class="field-label" for="model-endpoint">服务端点（示例）</label><input class="field-input" id="model-endpoint" value="https://model.example.com/v1" aria-describedby="model-hint"><p id="model-hint" class="small-note">原型不会发送请求，请勿填写真实密钥。</p><button class="button ghost small" data-action="test-model" ${state.modelStatus === "running" ? "disabled" : ""}>${state.modelStatus === "running" ? '<span class="spinner"></span>' : icon("link")} 模拟测试连接</button></div></section></div>`;
}
function renderSourceSettings() {
  return `<section class="settings-content"><h2>接好来源，让班班持续盯事。</h2><p>首批支持飞书纪要、妙记链接与 @ 我的内容。所有连接状态均为原型演示。</p><div class="connection-panel"><h3>飞书资料与消息 <span class="pill ${state.sourceStatus === "error" ? "danger" : ""}">${state.sourceStatus === "connected" ? "演示已连接" : state.sourceStatus === "running" ? "模拟收集中" : "模拟连接失败"}</span></h3><p>会议纪要 · @ 我的消息 · 链接原文</p><div class="setting-row"><div><strong>收集周期</strong><small>资料整理后进入待确认，已有事项更新进展线索。</small></div><select class="select" id="source-interval" aria-label="飞书收集周期"><option>每 30 分钟</option><option>每 1 小时</option><option>仅手动收集</option></select></div><button class="button dark small" data-action="collect" ${state.sourceStatus === "running" ? "disabled" : ""}>${icon("refresh")} 模拟收集一次</button> <button class="text-button" data-action="source-error">预览失败状态</button>${state.sourceStatus === "error" ? '<p class="form-error">示例：飞书连接已失效。重新连接后可重试，当前没有真实调用。</p><button class="button ghost small" data-action="source-reconnect">模拟重新连接</button>' : ""}</div><div class="setting-row"><div><strong>公司 Coremail 邮箱</strong><small>下一阶段验证读取方式与登录流程。</small></div><span class="pill">后续接入</span></div><div class="setting-row"><div><strong>语音录入</strong><small>当前仅保留规划位置，不使用麦克风。</small></div><button class="button ghost small" disabled>规划中</button></div><div class="setting-row"><div><strong>工作模式</strong><small>减少装饰动效，保留静态提醒。</small></div><button class="toggle" role="switch" aria-label="工作模式" aria-checked="${state.quiet}" data-action="quiet"></button></div></section>`;
}
function renderToolSettings() {
  return `<section class="settings-content"><h2>一个目录，收好班班的工作。</h2><p>配置、数据库、运行产物、Skills 与 MCP 分开存放。此处仅预览，不读写本机。</p><div class="field"><label class="field-label" for="workspace-path">工作目录</label><input class="field-input" id="workspace-path" value="${escapeHtml(state.workspace)}"><div style="margin-top:10px;display:flex;gap:9px"><button class="button ghost small" data-action="directory">${icon("folder")} ${state.directoryOpen ? "收起目录结构" : "查看目录结构"}</button><button class="text-button" data-action="save-directory">保存演示路径</button></div>${state.directoryOpen ? '<pre class="code-view">workspace/\n├── config/\n├── data/sidekick.sqlite\n├── runs/&lt;runId&gt;/\n├── skills/\n├── mcp/servers.json\n├── logs/\n└── backups/</pre>' : ""}</div><h2 style="margin-top:28px">Skills</h2><p>完整技能包，按需加载；添加技能不会新增智能体。</p>${[["lark-meeting", "妙记、纪要及相关资料"], ["lark-im", "消息与提醒卡片"], ["lark-doc", "飞书文档正文"], ["lark-shared", "连接与身份基础"]].map(([name, desc]) => `<div class="skill-row"><span><strong>${name}</strong><small>${desc}</small></span><span class="pill">示例已载入</span></div>`).join("")}<button class="button ghost small" data-action="skills-refresh" style="margin-top:13px">${icon("refresh")} 模拟重新扫描</button><div class="connection-panel"><h3>MCP 服务 <span class="pill ${state.mcpStatus === "error" ? "danger" : ""}">${state.mcpStatus === "connected" ? "演示已连接" : state.mcpStatus === "error" ? "模拟连接失败" : "待演示连接"}</span></h3><p>示例资料服务 · stdio · 两个示例工具</p>${state.mcpStatus === "connected" ? '<p>可用工具：搜索示例资料、读取示例内容</p>' : ""}${state.mcpStatus === "error" ? '<p class="form-error">示例：服务命令不可用，请检查配置与运行依赖。</p>' : ""}<button class="button ghost small" data-action="mcp-connect">${icon("link")} ${state.mcpStatus === "connected" ? "模拟断开" : "模拟连接"}</button> <button class="text-button" data-action="mcp-error">预览错误</button></div><p class="small-note">生产规划：Pi 源码随工程构建，Bash 按当前用户能力执行。目录不是沙箱，原型不会执行任何工具。</p></section>`;
}
function renderSettings() {
  return `<div class="page-intro"><h1>让班班更懂你的工作。</h1><p>接好模型与来源，调整习惯。日常只需要与班班交互。</p></div><div class="tabs settings-tabs">${[["agents", "模型与智能体"], ["sources", "信息来源"], ["tools", "工作目录与工具"]].map(([key, name]) => `<button class="tab ${key === state.settingsTab ? "active" : ""}" data-action="settings-tab" data-tab="${key}" aria-pressed="${key === state.settingsTab}">${name}</button>`).join("")}</div>${state.settingsTab === "agents" ? renderAgentSettings() : state.settingsTab === "sources" ? renderSourceSettings() : renderToolSettings()}`;
}
function updateReviewBar() {
  const show = state.page === "inbox" && state.candidates.length > 0;
  const bar = $("#review-bar"); bar.hidden = !show; document.body.classList.toggle("reviewing", show);
  bar.innerHTML = show ? `<div class="review-summary"><button class="text-button" data-action="select-all">${state.selected.size === state.candidates.length ? "取消全选" : "全选"}</button><span>已选 ${state.selected.size} / ${state.candidates.length} 条</span></div><button class="button primary" data-action="sign" ${state.selected.size ? "" : "disabled"}>${icon("check")} 签收选中事项 <span id="sign-count">${state.selected.size}</span></button>` : "";
}
function render() { $("#view").innerHTML = ({ today: renderToday, inbox: renderInbox, all: renderAll, report: renderReport, settings: renderSettings })[state.page](); updateNavigation(); updateReviewBar(); if ($("#agent-model") && state.agentModels[state.agent]) $("#agent-model").value = state.agentModels[state.agent]; if ($("#source-interval")) $("#source-interval").value = state.collectInterval; }

function openIntake(tab = "smart") {
  state.parseToken += 1;
  const el = $("#intake-dialog");
  el.innerHTML = `<header class="dialog-header"><h2 id="intake-title">交给班班，先记下来。</h2><button class="icon-button" data-action="close" aria-label="关闭录入">${icon("close")}</button></header><div class="dialog-body"><div class="tabs intake-tabs"><button class="tab ${tab === "smart" ? "active" : ""}" data-action="intake-tab" data-tab="smart">${icon("spark")} 智能整理</button><button class="tab ${tab === "manual" ? "active" : ""}" data-action="intake-tab" data-tab="manual">表单录入</button></div>${tab === "smart" ? `<p>粘贴文本或妙记链接，让班班先理解，再由你确认。</p><label class="screen-reader-only" for="intake-text">文本或妙记链接</label><textarea id="intake-text" class="intake-text" placeholder="粘贴会议纪要、邮件内容，或飞书妙记链接……"></textarea><p class="small-note">这是设计原型，展示固定示例结果，不分析真实输入。请使用下方示例体验。</p><div class="intake-footer"><button class="text-button" data-action="fill-sample">填入示例纪要</button><button class="button primary" id="parse-button" data-action="parse" disabled>${icon("spark")} 整理成事项</button></div>` : `<form id="manual-form"><div class="form-grid"><div class="field"><label class="field-label" for="manual-title">事项标题</label><input id="manual-title" class="field-input" required maxlength="100" placeholder="要做什么，或需要盯住什么？"></div><div class="field"><label class="field-label" for="manual-kind">事项类型</label><select id="manual-kind" class="select"><option value="action">待我处理</option><option value="followup">待我跟进</option></select></div><div class="field"><label class="field-label" for="manual-owner">实际负责人</label><input id="manual-owner" class="field-input" value="我" required></div><div class="field"><label class="field-label" for="manual-due">截止时间（可留空）</label><input id="manual-due" class="field-input" type="datetime-local"></div><div class="field"><label class="field-label" for="manual-priority">优先级</label><select id="manual-priority" class="select"><option>中</option><option>高</option><option>低</option></select></div></div><div class="intake-footer"><span class="small-note">仅保留在当前演示页面。</span><button class="button primary" type="submit">保存事项 ${icon("check")}</button></div></form>`}</div>`;
  if (!el.open) el.showModal();
}
function openDetail(id) {
  const task = state.tasks.find((t) => t.id === Number(id)); if (!task) { toast("该事项已从当前演示清单移除。"); return; }
  state.lastDetail = task.id; const el = $("#detail-dialog");
  el.innerHTML = `<header class="dialog-header"><h2 id="detail-title">事项详情 <span class="muted" style="font:11px var(--latin);margin-left:8px">SK-${task.id}</span></h2><button class="icon-button" data-action="close" aria-label="关闭事项详情">${icon("close")}</button></header><div class="dialog-body"><span class="pill">${task.kind === "followup" ? "待我跟进" : "待我处理"} · ${task.done ? "已完成" : "未完成"}</span><h3 class="detail-heading">${escapeHtml(task.title)}</h3><dl class="detail-metadata"><div><dt>实际负责人</dt><dd>${escapeHtml(task.owner)}</dd></div><div><dt>截止时间</dt><dd>${escapeHtml(task.due)}</dd></div><div><dt>${task.kind === "followup" ? "下次跟进" : "优先级"}</dt><dd>${escapeHtml(task.kind === "followup" ? task.followup || "未设置" : task.priority)}</dd></div><div><dt>来源</dt><dd>${escapeHtml(task.source)} · 演示资料</dd></div></dl><div class="section-heading"><h2>进展与依据</h2><span class="count">${task.progress ? 2 : 1}</span></div>${task.progress ? `<div class="timeline-item"><span class="status-dot" style="background:var(--amber)"></span><div><p>${escapeHtml(task.progress)}</p><small>今天 14:20 · 班班自动关联 · 新线索</small><blockquote>“方案文件已发，请查收。”<br>此处为虚构消息，交付不等于验收完成。</blockquote><button class="text-button" data-action="unlink" data-id="${task.id}">这条线索关联有误</button></div></div>` : ""}<div class="timeline-item"><span class="status-dot"></span><div><p>${task.done ? "你已确认完成这件事。" : "事项已签收，班班开始跟踪。"}</p><small>今天 · 当前页面的演示记录</small></div></div>${task.pending && !task.done ? `<div class="pending-change"><p>发现交付线索，是否验收完成由你决定。班班不会自动关单。</p><button class="button ghost small" data-action="complete-detail" data-id="${task.id}">我已验收，标记完成</button></div>` : ""}${task.reminder ? `<p class="small-note">提醒计划：${escapeHtml(task.reminder)}；截止未改变。</p>` : ""}<div class="detail-actions">${task.kind === "followup" ? `<button class="button ghost" data-action="draft" data-id="${task.id}">${icon("copy")} 催办草稿</button>` : ""}<button class="button ghost" data-action="edit-detail" data-id="${task.id}">编辑</button><button class="button ghost" data-action="snooze" data-id="${task.id}">${icon("clock")} 稍后提醒</button><button class="button dark" data-action="complete-detail" data-id="${task.id}">${icon("check")} ${task.done ? "重新打开" : "完成事项"}</button></div><div id="draft-result"></div></div>`;
  if (!el.open) el.showModal();
}
function openReminder() {
  const task = state.tasks.find((t) => !t.done && t.kind === "followup") || state.tasks.find((t) => !t.done) || state.tasks[0];
  if (!task) { toast("当前没有可提醒的事项。"); return; }
  const el = $("#reminder-dialog");
  el.innerHTML = `<header class="dialog-header"><h2 id="reminder-title">飞书提醒预览</h2><button class="icon-button" data-action="close" aria-label="关闭提醒预览">${icon("close")}</button></header><div class="dialog-body"><p>仅模拟提醒卡片及轻量操作，不发送真实消息。</p><article class="feishu-card"><header>跟班 · 老板，这件事该盯一下了。</header><div class="card-content"><h3>${escapeHtml(task.title)}</h3><p>负责人：${escapeHtml(task.owner)}<br>截止：${escapeHtml(task.due)} · Asia/Shanghai<br>事项：SK-${task.id}</p><div class="card-buttons"><button class="button dark" data-action="reminder-complete" data-id="${task.id}">${icon("check")} 完成</button><button class="button ghost" data-action="reminder-snooze" data-id="${task.id}">${icon("clock")} 稍后提醒</button></div></div></article><p class="small-note">“稍后提醒”仅调整提醒计划。复杂编辑和新事项签收在桌面端完成。</p></div>`;
  el.showModal();
}
function complete(id, reopen = true) { const task = state.tasks.find((t) => t.id === Number(id)); if (!task) return; task.done = reopen ? !task.done : true; task.pending = false; render(); $("#floating-pet").src = `../brand/banban-${task.done ? "done" : "idle"}.svg`; toast(task.done ? "演示：已完成，旧提醒已取消。" : "演示：事项已重新打开。"); }
function snooze(id) { const task = state.tasks.find((t) => t.id === Number(id)); if (!task) return; task.reminder = "1小时后提醒"; render(); toast("演示：1小时后再提醒，截止时间未改变。"); }

function openEdit(id) {
  const task = state.tasks.find((t) => t.id === Number(id)); if (!task) return;
  const el = $("#detail-dialog");
  el.innerHTML = `<header class="dialog-header"><h2 id="detail-title">编辑事项</h2><button class="icon-button" data-action="close" aria-label="关闭编辑">${icon("close")}</button></header><div class="dialog-body"><form id="edit-form" data-id="${task.id}"><div class="form-grid"><div class="field"><label class="field-label" for="edit-title">事项标题</label><input id="edit-title" class="field-input" required maxlength="100" value="${escapeHtml(task.title)}"></div><div class="field"><label class="field-label" for="edit-kind">事项类型</label><select id="edit-kind" class="select"><option value="action" ${task.kind === "action" ? "selected" : ""}>待我处理</option><option value="followup" ${task.kind === "followup" ? "selected" : ""}>待我跟进</option></select></div><div class="field"><label class="field-label" for="edit-owner">实际负责人</label><input id="edit-owner" class="field-input" required value="${escapeHtml(task.owner)}"></div><div class="field"><label class="field-label" for="edit-due">截止时间</label><input id="edit-due" class="field-input" value="${escapeHtml(task.due)}"></div><div class="field"><label class="field-label" for="edit-followup">下次跟进（跟进事项适用）</label><input id="edit-followup" class="field-input" value="${escapeHtml(task.followup || "未设置")}"></div></div><p class="small-note">此处演示字段修改，时间文本不做真实解析。保存表示你已确认此次修改。</p><div class="detail-actions"><button class="text-button" type="button" data-action="delete-prompt" data-id="${task.id}" style="margin-right:auto;color:var(--brick)">删除事项</button><button class="button ghost" type="button" data-action="detail" data-id="${task.id}">取消</button><button class="button dark" type="submit">保存修改</button></div><div id="edit-warning"></div></form></div>`;
  if (!el.open) el.showModal();
}

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) { event.preventDefault(); navigate(pageButton.dataset.page); return; }
  const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === "close") button.closest("dialog").close();
  else if (action === "intake") openIntake();
  else if (action === "intake-tab") openIntake(button.dataset.tab);
  else if (action === "fill-sample") { $("#intake-text").value = seedText; $("#parse-button").disabled = false; $("#intake-text").focus(); }
  else if (action === "parse") {
    button.disabled = true; button.innerHTML = '<span class="spinner"></span> 演示整理中';
    const token = ++state.parseToken;
    setTimeout(() => { if (!$("#intake-dialog").open || token !== state.parseToken) return; $("#intake-dialog").close(); navigate("inbox"); toast(state.candidates.length ? "正在展示预置候选；没有调用真实AI或读取链接。" : "这份示例已经处理，未重复创建候选。"); }, 700);
  }
  else if (action === "detail") openDetail(id);
  else if (action === "edit-detail") openEdit(id);
  else if (action === "delete-prompt") { $("#edit-warning").innerHTML = `<div class="pending-change"><p>确认删除这件事？它将从本次演示清单移除，刷新页面可恢复。</p><button type="button" class="button small ghost" data-action="delete-confirm" data-id="${id}">确认删除</button></div>`; }
  else if (action === "delete-confirm") { state.tasks = state.tasks.filter((t) => t.id !== Number(id)); $("#detail-dialog").close(); render(); toast("演示：事项已删除，未操作真实数据库。"); }
  else if (action === "complete") complete(id);
  else if (action === "complete-detail") { complete(id); openDetail(id); }
  else if (action === "snooze") { snooze(id); openDetail(id); }
  else if (action === "reminder") openReminder();
  else if (action === "reminder-complete") { complete(id, false); $("#reminder-dialog").close(); }
  else if (action === "reminder-snooze") { snooze(id); $("#reminder-dialog").close(); }
  else if (action === "discard") { state.candidates = state.candidates.filter((c) => c.id !== Number(id)); state.selected.delete(Number(id)); render(); toast("演示：候选已丢弃，没有创建事项。"); }
  else if (action === "select-all") { state.selected = state.selected.size === state.candidates.length ? new Set() : new Set(state.candidates.map((c) => c.id)); render(); }
  else if (action === "sign") {
    const selected = state.candidates.filter((c) => state.selected.has(c.id)); if (!selected.length) return;
    if (selected.some((c) => !c.title.trim())) { toast("请先为选中事项填写标题。"); return; }
    selected.forEach((c) => state.tasks.push({ id: state.nextId++, title: c.title, kind: c.kind, owner: c.owner || "我", due: c.due || "未定期", followup: c.kind === "followup" ? c.due || "未定期" : undefined, priority: "中", source: "接入评审纪要", tag: "新签收", done: false }));
    state.signed += selected.length; state.candidates = state.candidates.filter((c) => !state.selected.has(c.id)); state.selected.clear(); render(); toast(`演示：已签收 ${selected.length} 条事项，现在才进入正式清单。`);
  }
  else if (action === "assist") {
    const value = $("#assist-input").value.trim(); if (!value) { $("#assist-input").focus(); return; }
    if (!/第一条|明天|17/.test(value)) { toast("原型支持示例指令：把第一条改为明天17点。"); return; }
    const candidate = state.candidates[0]; if (candidate) { candidate.due = "10月30日 17:00"; candidate.edited = true; render(); toast("演示：已预览第一条时间修改，仍需签收。"); }
  }
  else if (action === "filter") { state.filter = button.dataset.filter; render(); }
  else if (action === "clear-search") { state.query = ""; render(); }
  else if (action === "search") { navigate("all"); $("#task-search").focus(); }
  else if (action === "settings-tab") { state.settingsTab = button.dataset.tab; render(); }
  else if (action === "agent") { state.agent = button.dataset.agent; render(); }
  else if (action === "save-agent") { state.preferences[state.agent] = $("#agent-prompt").value; state.agentModels[state.agent] = $("#agent-model").value; toast("偏好已保留在当前原型页面，未写入本机配置。"); }
  else if (action === "reset-agent") { delete state.preferences[state.agent]; delete state.drafts[state.agent]; delete state.agentModels[state.agent]; render(); toast("演示：已恢复该角色的默认说明。"); }
  else if (action === "test-model") { state.modelStatus = "running"; render(); setTimeout(() => { state.modelStatus = "connected"; if (state.page === "settings") render(); toast("模拟连接成功，没有发送网络请求。"); }, 700); }
  else if (action === "source-settings") { state.settingsTab = "sources"; navigate("settings"); }
  else if (action === "collect") { state.sourceStatus = "running"; render(); setTimeout(() => { state.sourceStatus = "connected"; if (state.page === "settings") render(); toast("演示：收集已结束，未调用真实飞书，也未重复创建候选。"); }, 700); }
  else if (action === "source-error") { state.sourceStatus = "error"; render(); }
  else if (action === "source-reconnect") { state.sourceStatus = "connected"; render(); toast("演示连接已恢复。"); }
  else if (action === "quiet") { state.quiet = !state.quiet; document.body.classList.toggle("quiet-mode", state.quiet); render(); }
  else if (action === "directory") { state.workspace = $("#workspace-path").value; state.directoryOpen = !state.directoryOpen; render(); }
  else if (action === "save-directory") { state.workspace = $("#workspace-path").value; toast("仅保存演示路径，未迁移或访问任何本机文件。"); }
  else if (action === "skills-refresh") toast("演示：四个示例技能已重新扫描，未读取本机技能目录。");
  else if (action === "mcp-connect") { state.mcpStatus = state.mcpStatus === "connected" ? "idle" : "connected"; render(); toast("仅切换演示状态，未启动或连接MCP服务。"); }
  else if (action === "mcp-error") { state.mcpStatus = "error"; render(); }
  else if (action === "report-refresh") { button.disabled = true; button.innerHTML = '<span class="spinner"></span> 模拟生成中'; setTimeout(() => { if (state.page === "report") render(); toast("日报示例已更新，没有调用模型。"); }, 700); }
  else if (action === "copy-report") { const content = $(".report-paper").innerText; navigator.clipboard?.writeText(content).then(() => toast("已复制日报示例。"), () => toast("浏览器未允许剪贴板操作，可手动选择复制。")); }
  else if (action === "unlink") { const task = state.tasks.find((t) => t.id === Number(id)); task.progress = undefined; task.pending = false; render(); openDetail(id); toast("演示：已取消这条线索关联，事项状态未改变。"); }
  else if (action === "draft") { $("#draft-result").innerHTML = `<div class="connection-panel"><h3>催办草稿 · 示例</h3><p>${escapeHtml(state.tasks.find((t) => t.id === Number(id)).owner)}，想跟你确认一下这件事目前的进展。有需要我协调的地方，也一起告诉我。</p><small class="small-note">草稿由你自行联系对方，原型不会发送消息。</small></div>`; }
  else if (action === "pet") { $("#pet-bubble").hidden = !$("#pet-bubble").hidden; }
  else if (action === "pet-progress") { $("#pet-bubble").hidden = true; openDetail(4); }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "intake-text") $("#parse-button").disabled = !event.target.value.trim();
  if (event.target.dataset.candidateField) { const c = state.candidates.find((c) => c.id === Number(event.target.dataset.id)); if (c) c[event.target.dataset.candidateField] = event.target.value; }
  if (event.target.id === "task-search") { const start = event.target.selectionStart; state.query = event.target.value; render(); $("#task-search").focus(); $("#task-search").setSelectionRange(start, start); }
  if (event.target.id === "agent-prompt") state.drafts[state.agent] = event.target.value;
});
document.addEventListener("change", (event) => {
  if (event.target.dataset.candidateSelect) { const id = Number(event.target.dataset.candidateSelect); event.target.checked ? state.selected.add(id) : state.selected.delete(id); updateReviewBar(); }
  if (event.target.id === "source-interval") { state.collectInterval = event.target.value; toast("演示：收集周期已调整，仅保留在当前页面。"); }
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "edit-form") {
    event.preventDefault(); const task = state.tasks.find((t) => t.id === Number(event.target.dataset.id)); if (!task) return;
    const title = $("#edit-title").value.trim(); if (!title) return;
    task.title = title; task.kind = $("#edit-kind").value; task.owner = $("#edit-owner").value.trim() || "我"; task.due = $("#edit-due").value.trim() || "未定期"; task.followup = task.kind === "followup" ? $("#edit-followup").value.trim() || "未设置" : undefined;
    task.reminder = undefined; render(); openDetail(task.id); toast("演示：修改已保存，旧提醒计划已清除。"); return;
  }
  if (event.target.id !== "manual-form") return; event.preventDefault(); const title = $("#manual-title").value.trim(); if (!title) return;
  const kind = $("#manual-kind").value; const rawDue = $("#manual-due").value; const due = rawDue ? `${rawDue.slice(5, 7)}月${rawDue.slice(8, 10)}日 ${rawDue.slice(11, 16)}` : "未定期";
  state.tasks.push({ id: state.nextId++, title, kind, owner: $("#manual-owner").value.trim() || "我", due, followup: kind === "followup" ? due : undefined, priority: $("#manual-priority").value, tag: "手工录入", source: "手工录入", done: false });
  $("#intake-dialog").close(); state.filter = "active"; state.query = ""; navigate("all"); toast("演示：手工事项已记录，刷新页面可复位。");
});
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openIntake(); } });
state.parseToken = 0;
$("#intake-dialog").addEventListener("close", () => { state.parseToken += 1; });
document.querySelectorAll("dialog").forEach((dialog) => { dialog.addEventListener("click", (event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } }); });
render();
