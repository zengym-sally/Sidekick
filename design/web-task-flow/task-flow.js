// W0 task-queue interaction prototype. Synthetic data only: no model, Feishu, MCP, Bash,
// SQLite or local filesystem access. State transitions are driven by page timers and buttons;
// reload resets. See docs/engineering/web-task-interaction.md for the contract.
const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const STATE_META = {
  queued: { label: "排队中", icon: "queue", pill: "" },
  running: { label: "运行中", icon: "run", pill: "amber" },
  cancelling: { label: "取消中", icon: "cancel", pill: "amber" },
  succeeded: { label: "已完成", icon: "check", pill: "ok" },
  failed: { label: "失败", icon: "close", pill: "danger" },
  cancelled: { label: "已取消", icon: "close", pill: "" },
  interrupted: { label: "运行中断", icon: "warn", pill: "amber" },
  needs_review: { label: "待核对", icon: "warn", pill: "amber" },
};

const state = {
  page: "queue",
  concurrency: 3,
  connection: "connected", // connected | reconnecting | snapshot
  cursor: 12,
  nextSeq: 1,
  nextTask: 7,
  submitting: false,
  submittedKey: null,
  tasks: [
    { id: "T-2011", seq: 1, kind: "整理", role: "事项整理", input: "接入评审纪要 · 2,140 字", revision: "cfg-17", state: "running", slot: 2, slotLimit: 3, attempt: "a3", epoch: "e1", events: [{ t: "09:41:02", text: "提交成功，已落队列（操作 ID op-9f21）" }, { t: "09:41:05", text: "领取执行槽 2/3，attempt a3 启动" }], note: "" },
    { id: "T-2012", seq: 2, kind: "三角色试跑", role: "进展跟踪", input: "样例：方案已发待验收", revision: "cfg-17", state: "running", slot: 3, slotLimit: 3, attempt: "a1", epoch: "e1", events: [{ t: "09:41:20", text: "提交成功，已落队列（操作 ID op-9f22）" }, { t: "09:41:21", text: "领取执行槽 3/3" }], note: "" },
    { id: "T-2013", seq: 3, kind: "今日建议", role: "工作参谋", input: "今日事实快照 · 14 条事项", revision: "cfg-16", state: "queued", events: [{ t: "09:40:58", text: "提交成功，已落队列（操作 ID op-9f20）" }], note: "满槽仍入队列：当前 3 个执行槽都被占用（2 运行中 + 1 取消中），前面退出后自动开始。" },
    { id: "T-2014", seq: 4, kind: "整理", role: "事项整理", input: "周会纪要 · 3,870 字", revision: "cfg-17", state: "queued", events: [{ t: "09:41:33", text: "提交成功，已落队列（操作 ID op-9f23）" }], note: "" },
    { id: "T-2015", seq: 5, kind: "修改预览", role: "事项整理", input: "候选 C-88 · 「第三条改到周五」", revision: "cfg-17", state: "queued", events: [{ t: "09:41:44", text: "提交成功，已落队列（操作 ID op-9f24）" }], note: "" },
    { id: "T-2009", seq: 6, kind: "模型测试", role: "全局默认", input: "示例网关连通性测试", revision: "cfg-16", state: "cancelling", slot: 1, slotLimit: 3, attempt: "a1", epoch: "e1", events: [{ t: "09:38:10", text: "提交成功，已落队列" }, { t: "09:39:02", text: "领取执行槽 1/3" }, { t: "09:39:40", text: "用户取消：先记录取消意图，再停止 worker" }], note: "取消中仍占执行槽 1/3：未确认退出前不释放，也不显示已取消。" },
    { id: "T-2007", seq: 7, kind: "整理", role: "事项整理", input: "试用反馈汇总 · 1,660 字", revision: "cfg-15", state: "failed", attempt: "a2", epoch: "e1", events: [{ t: "09:20:11", text: "提交成功，已落队列" }, { t: "09:20:13", text: "领取执行槽" }, { t: "09:21:02", text: "执行时无法解析凭据引用「MODEL_KEY」，已停止重试" }], note: "认证类失败，不再自动重试。输入已保留，可在设置核对引用后重新提交。" },
    { id: "T-2005", seq: 8, kind: "整理", role: "事项整理", input: "旧版评审纪要 · 4,020 字", revision: "cfg-14", state: "interrupted", attempt: "a1", epoch: "e1", events: [{ t: "09:02:44", text: "提交成功，已落队列" }, { t: "09:02:46", text: "领取执行槽" }, { t: "09:07:20", text: "后端重启，上次运行记为中断，输入已保留" }], note: "有外部副作用结果不明的可能，重新提交前先核对外部结果。" },
    { id: "T-2003", seq: 9, kind: "飞书主动收集", role: "事项整理", input: "周期任务 · 每 30 分钟", revision: "cfg-14", state: "needs_review", attempt: "a1", epoch: "e1", events: [{ t: "08:58:00", text: "周期触发（幂等键 coll-0930-1）" }, { t: "08:58:02", text: "领取执行槽" }, { t: "09:06:50", text: "实例 epoch 变化，无法确认是否已发送飞书读取请求" }], note: "外部副作用未知。核对前不会重新执行，也不会自动重发。" },
    { id: "T-2001", seq: 10, kind: "整理", role: "事项整理", input: "会议纪要 A · 2,880 字", revision: "cfg-13", state: "succeeded", attempt: "a1", epoch: "e1", events: [{ t: "08:31:12", text: "提交成功，已落队列" }, { t: "08:31:14", text: "领取执行槽" }, { t: "08:32:40", text: "完成，3 条候选进入待确认（未签收）" }], note: "任务成功不等于事项已签收。" },
    { id: "T-1998", seq: 11, kind: "整理", role: "事项整理", input: "会议纪要 B · 1,210 字", revision: "cfg-13", state: "cancelled", attempt: "a1", epoch: "e1", events: [{ t: "08:12:03", text: "提交成功，已落队列" }, { t: "08:12:05", text: "排队中取消：事务置 cancelled，调度器不会启动" }], note: "" },
  ],
  reviewItems: [
    { taskId: "T-2003", question: "飞书读取请求是否已发出？", options: ["已确认完成", "标记失败", "保留待核对"], choice: null, evidence: "无发送回执，实例 epoch 已变化" },
    { taskId: "T-2005", question: "整理是否已写入候选？", options: ["已确认完成", "标记失败", "保留待核对"], choice: null, evidence: "无 attempt a1 的结果提交记录" },
    { taskId: "T-0901", question: "恢复点之后的定时收集是否已执行？", options: ["已确认完成", "标记失败", "保留待核对"], choice: null, evidence: "备份时间 09-30 22:14，此后 cron 记录缺失" },
  ],
  recovery: { active: true, paused: true, backupAt: "09-30 22:14", pending: 3 },
  credentials: { provider: "macOS Keychain（可用）", refs: [{ name: "MODEL_KEY", state: "missing", note: "执行时无法解析：引用名在设置中已不存在" }, { name: "LARK_APP", state: "ok", note: "已解析，界面不回读秘密值" }] },
};

const ORDER = { running: 0, cancelling: 1, queued: 2, interrupted: 3, needs_review: 4, failed: 5, succeeded: 6, cancelled: 7 };

function sortedTasks() {
  return [...state.tasks].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || a.seq - b.seq);
}
function queuePosition(task) {
  const queued = state.tasks.filter((t) => t.state === "queued").sort((a, b) => a.seq - b.seq);
  return queued.indexOf(task) + 1;
}
function counts() {
  // 未确认退出前不释放执行槽：占槽集合 = running + cancelling（web-backend-design §5）。
  const occupied = state.tasks.filter((t) => t.state === "running" || t.state === "cancelling");
  const running = occupied.filter((t) => t.state === "running").length;
  const cancelling = occupied.filter((t) => t.state === "cancelling").length;
  const queued = state.tasks.filter((t) => t.state === "queued").length;
  return { running, cancelling, occupied: occupied.length, queued, review: state.tasks.filter((t) => t.state === "needs_review").length };
}
// 槽号取 1..并发中第一个未被 running+cancelling 占用的空闲槽，避免中间槽释放后把新任务分到已占槽。
function nextFreeSlot() {
  const taken = new Set(state.tasks.filter((t) => t.state === "running" || t.state === "cancelling").map((t) => t.slot).filter((s) => typeof s === "number"));
  for (let n = 1; n <= state.concurrency; n += 1) if (!taken.has(n)) return n;
  return null;
}
// 剩余项数实时由 reviewItems 现算：未选择 + 保留待核对。改选、新增核对项（取消转待核对）与渲染都走这里，不缓存过期数字。
function syncRecoveryPending() {
  const parked = state.reviewItems.filter((entry) => entry.choice === "保留待核对").length;
  const undecided = state.reviewItems.filter((entry) => !entry.choice).length;
  state.recovery.pending = parked + undecided;
  return state.recovery.pending;
}

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 3600);
}
function stamp() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
function log(task, text) { task.events.push({ t: stamp(), text }); }
function stateIcon(task) {
  const meta = STATE_META[task.state];
  return `<span class="task-state ${task.state}" aria-hidden="true">${icon(meta.icon)}</span>`;
}
function stateLabel(task) {
  const meta = STATE_META[task.state];
  const slot = (task.state === "running" || task.state === "cancelling") && task.slot ? ` · 槽 ${task.slot}/${task.slotLimit ?? state.concurrency}` : "";
  return `<span class="pill ${meta.pill}">${icon(meta.icon)} ${meta.label}${slot}</span>`;
}
function taskNote(task) {
  if (!task.note) return "";
  const alert = task.state === "needs_review" || task.state === "failed" || task.state === "interrupted";
  const cls = task.state === "needs_review" ? "review" : task.state === "failed" || task.state === "interrupted" ? "retry" : "";
  return `<p class="task-note ${cls}" ${alert ? 'role="alert"' : ""}>${icon(task.state === "needs_review" ? "warn" : "clock")}<span>${escapeHtml(task.note)}</span></p>`;
}
function taskRow(task) {
  const position = task.state === "queued" ? queuePosition(task) : 0;
  const positionCell = position ? `<span class="queue-position-label">第 ${position} 位</span>` : `<span class="queue-position-label"></span>`;
  let actions = `<button class="text-button" data-action="detail" data-id="${task.id}">详情</button>`;
  if (task.state === "queued") actions += `<button class="button small danger" data-action="cancel" data-id="${task.id}">${icon("close")} 取消</button>`;
  if (task.state === "running") actions += `<button class="button small danger" data-action="cancel" data-id="${task.id}">${icon("close")} 取消</button>`;
  if (task.state === "failed" || task.state === "interrupted") actions += `<button class="button small ghost" data-action="resubmit" data-id="${task.id}">${icon("refresh")} 重新提交</button>`;
  if (task.state === "needs_review") actions += `<button class="button small ghost" data-action="open-review" data-id="${task.id}">${icon("warn")} 逐项核对</button>`;
  if (task.state === "cancelled" || task.state === "succeeded") actions += `<button class="button small ghost" data-action="resubmit" data-id="${task.id}">${icon("refresh")} 重新提交</button>`;
  if (task.state === "cancelling") actions += `<span class="small-note">只读</span>`;
  return `<li class="task-row" tabindex="0" role="group" aria-label="任务 ${escapeHtml(task.id)} ${STATE_META[task.state].label}${task.state === "cancelling" ? "，仍占执行槽" : ""}" data-id="${task.id}">
   ${stateIcon(task)}
   <div class="task-main">
    <button class="task-title" data-action="detail" data-id="${task.id}">${escapeHtml(task.kind)} · ${escapeHtml(task.input)}</button>
    <div class="task-meta">${stateLabel(task)}<span>${icon("inbox")} ${escapeHtml(task.role)}</span><span>${icon("source")} 配置修订 ${escapeHtml(task.revision)}</span>${task.attempt ? `<span>attempt ${escapeHtml(task.attempt)} · epoch ${escapeHtml(task.epoch)}</span>` : ""}<span>${icon("clock")} ${escapeHtml(task.id)} · 序号 ${task.seq}</span></div>
    ${taskNote(task)}
   </div>
   <div class="task-actions">${actions}</div>
   ${positionCell}
  </li>`;
}

function renderQueue() {
  const c = counts();
  const active = sortedTasks();
  const bars = Array.from({ length: state.concurrency }, (_, i) => `<span class="${i < c.occupied ? "used" : ""}"></span>`).join("");
  const connText = state.connection === "connected" ? "已连接" : state.connection === "reconnecting" ? "重连中…" : "已用快照重新同步";
  const connClass = state.connection === "connected" ? "" : state.connection === "reconnecting" ? "warn" : "off";
  $("#conn-dot").className = `status-dot ${connClass}`;
  $("#conn-label").textContent = connText;
  const recoveryBanner = state.recovery.active
    ? `<div class="banner warn" role="alert">${icon("warn")}<div><strong>正在从备份恢复（${escapeHtml(state.recovery.backupAt)}）。</strong>已暂停新任务提交、定时收集与提醒投递。恢复点之后发生的外部操作可能已执行：快照里的排队任务全部隔离为待核对，核对前不重新执行、不自动重发。<br><span class="small-note">无法核实时由你逐项选择重试或取消；每项都确认完成、标记失败或明确重试/取消后才恢复普通调度。剩余 ${state.recovery.pending} 项未决（未选择或保留待核对）。</span></div><button class="button small ghost" data-action="go-review">去逐项核对</button></div>`
    : "";
  return `<div class="page-intro"><h1>老板，任务都排着队呢。</h1><p>默认 ${state.concurrency} 个智能体并发，多余任务持久排队。关闭页面不取消任务，刷新后位置、取消意图与待核对项原样重现。</p></div>
  ${recoveryBanner}
  <div class="slot-strip">
   <div class="figure">${c.running}<small>运行中</small></div>
   <div class="figure">${c.cancelling}<small>取消中（占槽）</small></div>
   <div class="figure">${c.queued}<small>排队中</small></div>
   <div class="slot-bars" role="img" aria-label="执行槽占用 ${c.occupied}/${state.concurrency}：运行中 ${c.running}，取消中 ${c.cancelling}（未确认退出不释放）">${bars}</div>
   <div class="slot-meta">
    <span class="pill amber">${icon("run")} 并发上限 ${state.concurrency}（设置页可调，此处只读）</span>
    <button class="button small ghost" data-action="settings-link">${icon("source")} 并发设置入口（设置页）</button>
    <button class="button small ghost" data-action="submit">${icon("plus")} 提交演示任务</button>
    <button class="button small ghost" data-action="drop-event">${icon("refresh")} 断线重连</button>
   </div>
  </div>
  <div class="section-heading"><h2>全部任务</h2><span class="count">${active.length} 条</span><span class="small-note" style="margin-left:auto">按权威队列顺序，运行中的在前</span></div>
  ${active.length ? `<ul class="task-list">${active.map(taskRow).join("")}</ul>` : `<div class="empty"><img src="../../src/assets/brand/banban-idle.svg" alt="待机的班班"><h2>当前没有排队或运行中的任务。</h2><p>提交后会显示在这里；不显示假的进度或示例任务。</p></div>`}`;
}

function renderReview() {
  const pending = state.tasks.filter((t) => t.state === "needs_review");
  return `<div class="page-intro"><h1>这些要你核对，班班不替你决定。</h1><p>外部副作用结果不明，或恢复后无法证明执行历史连续。核对前不重新执行，也不自动重发。</p></div>
  ${state.recovery.active ? `<div class="banner info">${icon("warn")}<div><strong>恢复未放行（剩余 ${state.recovery.pending} 项未决：未选择或保留待核对）。</strong>定时收集、提醒与补偿投递保持暂停；普通调度保持暂停，直到每项都已确认完成、标记失败或你明确重试/取消。保留待核对只是暂缓：拿到回执后可随时改选，不会把这项永久搁置。</div></div>` : state.recovery.pending > 0 ? `<div class="banner info">${icon("check")}<div><strong>恢复流程已放行。</strong>定时收集、提醒与补偿投递恢复；普通调度继续。仍有 ${state.recovery.pending} 项未决（未选择或保留待核对）待处理。</div></div>` : `<div class="banner info">${icon("check")}<div><strong>核对已全部完成，恢复已放行。</strong>定时收集、提醒与补偿投递恢复；普通调度继续。每项都已确认完成、标记失败或由你明确重试/取消，没有遗留的待核对风险。</div></div>`}
  <div class="section-heading"><h2>待核对任务</h2><span class="count">${pending.length} 条</span></div>
  ${pending.length ? `<ul class="task-list">${pending.map(taskRow).join("")}</ul>` : `<div class="empty"><img src="../../src/assets/brand/banban-done.svg" alt="完成致意的班班"><h2>都核对好了，老板。</h2><p>没有待核对项。普通调度已恢复。</p></div>`}
  <div class="section-heading" style="margin-top:30px"><h2>逐项核对</h2><span class="count">${state.reviewItems.length} 项</span><span class="small-note" style="margin-left:auto">没有「全部忽略」；每项独立记录操作者与时间；保留待核对只是暂缓，可随时改选</span></div>
  <div style="display:grid;gap:12px">${state.reviewItems.map((item, index) => {
    const chosen = item.choice ? `<span class="pill ${item.choice === "保留待核对" ? "amber" : "ok"}">${icon(item.choice === "保留待核对" ? "clock" : "check")} ${escapeHtml(item.choice)} · 已记录</span>` : `<span class="pill amber">${icon("clock")} 未选择</span>`;
    return `<article class="cap-card" data-task-id="${escapeHtml(item.taskId)}" tabindex="-1"><h3>${icon("warn")} ${escapeHtml(item.taskId)} ${chosen}</h3><p><strong style="color:var(--ink)">${escapeHtml(item.question)}</strong></p><p>依据：${escapeHtml(item.evidence)}</p><div class="review-choice">${item.options.map((option) => `<button class="button small ${item.choice === option ? "primary" : "ghost"}" data-action="review-choice" data-index="${index}" data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join("")}</div></article>`;
  }).join("")}</div>
  <div class="banner info" style="margin-top:22px">${icon("warn")}<div><strong>恢复边界。</strong>可证无副作用的只读任务可安全恢复；未知一律保留待核对。界面不保证重建备份后发生的外部事实，也不静默删除任务。</div></div>`;
}

function renderCapability() {
  const caps = [
    { name: "系统通知", icon: "bell", status: "薄壳阶段提供", point: "NotificationSink 新增 OS 通知渠道，不重写提醒业务；应用内提醒中心现在可用。" },
    { name: "桌宠气泡", icon: "spark", status: "薄壳阶段提供", point: "PetSnapshot 与语义事件供桌宠消费；保留命中、穿透、拖动等原生行为。" },
    { name: "托盘与全局快捷键", icon: "queue", status: "薄壳阶段提供", point: "壳映射主窗、快录与托盘动作，不新增第二业务 store。" },
    { name: "原生打开目录", icon: "folder", status: "不可用", point: "HostCapabilities 文件选择/打开；现在显示逻辑路径与备份入口。" },
    { name: "登录启动", icon: "plug", status: "不可用", point: "壳阶段实现；设置中占位说明。" },
    { name: "模型与 MCP 执行", icon: "run", status: "可用", point: "随后端 OS 提供凭据；Bash/MCP 在服务器上执行，不能读访问者电脑。" },
  ];
  return `<div class="page-intro"><h1>能力边界说清楚，不伪装原生。</h1><p>系统能力缺失不应使浏览器业务不可用，也不用伪造成功替代。缺它不阻塞 Web 业务。</p></div>
  <div class="cap-grid">${caps.map((c) => `<article class="cap-card"><h3>${icon(c.icon)} ${c.name}</h3><span class="pill ${c.status === "可用" ? "ok" : "amber"}">${c.status}</span><div class="shell-point"><strong>壳适配点：</strong>${escapeHtml(c.point)}</div></article>`).join("")}</div>
  <div class="cred-panel"><h3>凭据属于后端主机 <span class="pill ok">${icon("key")} provider 可用</span></h3>
   <p>界面只返回 provider 能力与可用性，不回读秘密。缺失引用只影响依赖它的任务。</p>
   <div class="cred-row"><div><strong>${escapeHtml(state.credentials.provider)}</strong>macOS 的 Web 与桌面形态都可使用可用的系统钥匙串；无桌面会话的服务可能无法解锁，须显式报错。</div><span class="pill ok">可用</span></div>
   ${state.credentials.refs.map((ref) => `<div class="cred-row"><div><strong>${escapeHtml(ref.name)}</strong>${escapeHtml(ref.note)}</div><span class="pill ${ref.state === "ok" ? "ok" : "danger"}">${ref.state === "ok" ? "已解析" : "无法解析"}</span></div>`).join("")}
   <div class="banner info" style="margin:0">${icon("warn")}<div><strong>Linux 默认没有 macOS 钥匙串。</strong>不模拟、不自动降级成明文凭据文件；明示系统凭据存储不可用，允许环境引用模型/MCP 照常运行。</div></div>
  </div>
  <div class="banner info">${icon("folder")}<div><strong>工作根。</strong>本机配对会话可提交受限的根切换意图（查看当前根、列出启动配置允许的目标、按操作 ID 查询结果）；Linux 固定根只提供备份/导出入口。代理模式不签发根切换能力。</div></div>`;
}

function render() {
  // 剩余项数永远按当前核对项现算，渲染、增删、改选都不会留下过期数字。
  syncRecoveryPending();
  // 重绘会替换 #view 内容：先记住焦点归属，重绘后恢复，避免操作后焦点掉到 BODY（契约 §12）。
  const active = document.activeElement;
  const restoreRowId = active?.closest?.(".task-row")?.dataset?.id ?? null;
  const restoreReviewIndex = active?.dataset?.action === "review-choice" ? active.dataset.index : null;
  const views = { queue: renderQueue, review: renderReview, capability: renderCapability };
  $("#view").innerHTML = views[state.page]();
  document.querySelectorAll(".nav-item").forEach((el) => {
    const active = el.dataset.page === state.page;
    el.classList.toggle("active", active);
    active ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
  });
  $("#page-label").textContent = { queue: "任务队列", review: "待核对", capability: "能力与壳适配" }[state.page];
  const c = counts();
  $("#nav-queue-count").textContent = c.occupied + c.queued;
  $("#nav-queue-count").hidden = c.occupied + c.queued === 0;
  // 恢复期间徽标显示「待你决定的核对项」；放行后显示仍未终态的待核对任务数。
  const reviewBadge = state.recovery.active ? state.recovery.pending : c.review;
  $("#nav-review-count").textContent = reviewBadge;
  $("#nav-review-count").hidden = reviewBadge === 0;
  $("#concurrency-value").textContent = state.concurrency;
  if (restoreRowId) {
    const row = document.querySelector(`.task-row[data-id="${restoreRowId}"]`) || document.querySelector("#view .task-row");
    if (row) { row.focus(); return; }
  }
  if (restoreReviewIndex != null) {
    const button = document.querySelector(`[data-action="review-choice"][data-index="${restoreReviewIndex}"]`);
    if (button) button.focus();
  }
}

function openDetail(id) {
  const task = state.tasks.find((t) => t.id === id); if (!task) return;
  const meta = STATE_META[task.state];
  const stale = [{ t: "09:39:12", text: `旧事件：${task.id} ${meta.label}（低于快照游标，已忽略）`, stale: true }];
  const el = $("#task-dialog");
  el.innerHTML = `<header class="dialog-header"><h2 id="task-dialog-title">${icon(meta.icon)} ${escapeHtml(task.kind)} · ${escapeHtml(task.id)}</h2><button class="icon-button" data-action="close" aria-label="关闭任务详情">${icon("close")}</button></header>
  <div class="dialog-body">
   <div style="display:flex;gap:8px;flex-wrap:wrap">${stateLabel(task)}<span class="pill">${icon("inbox")} ${escapeHtml(task.role)}</span>${task.attempt ? `<span class="pill">attempt ${escapeHtml(task.attempt)} · epoch ${escapeHtml(task.epoch)}</span>` : ""}</div>
   <dl class="detail-grid">
    <dt>输入摘要</dt><dd>${escapeHtml(task.input)}</dd>
    <dt>配置修订</dt><dd>${escapeHtml(task.revision)}（入队时固化，待执行期间改配置不影响本任务）</dd>
    <dt>操作幂等键</dt><dd>op-9f${20 + task.seq} · 同一操作 ID 重试返回同一任务</dd>
    <dt>事件游标</dt><dd>${state.cursor} · 断线按 Last-Event-ID 重放，超出留存取全量快照</dd>
    <dt>排队位置</dt><dd>${task.state === "queued" ? `第 ${queuePosition(task)} 位` : "—"}<span class="small-note">不显示预计等待时长</span></dd>
   </dl>
   ${taskNote(task)}
   <div><h3 style="font-size:13px;margin:0 0 10px">事件</h3><ul class="event-list">${[...task.events, ...stale].map((e) => `<li class="${e.stale ? "stale" : ""}"><time>${escapeHtml(e.t)}</time><span>${escapeHtml(e.text)}</span></li>`).join("")}</ul></div>
   <div class="review-choice">
    ${task.state === "queued" || task.state === "running" ? `<button class="button small danger" data-action="cancel" data-id="${task.id}">取消</button>` : ""}
    ${task.state === "failed" || task.state === "interrupted" || task.state === "cancelled" || task.state === "succeeded" ? `<button class="button small ghost" data-action="resubmit" data-id="${task.id}">重新提交</button>` : ""}
    ${task.state === "needs_review" ? `<button class="button small ghost" data-action="open-review" data-id="${task.id}">逐项核对</button>` : ""}
    <button class="button small ghost" data-action="close">关闭</button>
   </div>
   <p class="small-note">演示数据：不连接模型、飞书、MCP、Bash、SQLite 或本机文件系统；接口字段名以契约冻结为准。</p>
  </div>`;
  if (!el.open) el.showModal();
}

function findTask(id) { return state.tasks.find((t) => t.id === id); }

function submitTask() {
  if (state.recovery.active) { toast("恢复未放行：已暂停新任务提交。请先完成逐项核对。"); return; }
  if (state.submitting) { toast("这条已经提交，显示的是同一个任务。"); return; }
  state.submitting = true;
  const id = `T-${2020 + state.nextTask++}`;
  const seq = state.tasks.length + 1;
  const c = counts();
  // 占槽集合含取消中：取消中未确认退出前不释放槽，新任务不得占用它的位置。
  const canStart = c.occupied < state.concurrency;
  const slotNo = canStart ? nextFreeSlot() : null;
  const task = { id, seq, kind: "整理", role: "事项整理", input: "演示任务 · 合成原文 900 字", revision: "cfg-17", state: canStart ? "running" : "queued", slot: slotNo ?? undefined, slotLimit: canStart ? state.concurrency : undefined, attempt: "a1", epoch: "e1", events: [], note: "" };
  log(task, `提交成功，已落队列（操作 ID op-9f3${seq}）`);
  if (canStart) log(task, `领取执行槽 ${slotNo}/${state.concurrency}，attempt a1 启动`);
  else task.note = `满槽仍入队列：当前 ${c.occupied} 个执行槽都被占用（运行中 ${c.running}、取消中 ${c.cancelling}），前面退出后自动开始。`;
  state.tasks.push(task);
  render();
  toast(task.state === "running" ? `已加入队列并立即开始：${id}。` : `已加入队列，${id} 排在第 ${queuePosition(task)} 位。关闭页面也会继续。`);
  setTimeout(() => { state.submitting = false; }, 400);
}

function cancelTask(id) {
  const task = findTask(id); if (!task) return;
  if (task.state === "queued") {
    task.state = "cancelled"; log(task, "排队中取消：事务置 cancelled，调度器不会启动");
    toast(`${task.id} 已取消，这个任务不会执行。`);
  } else if (task.state === "running") {
    task.state = "cancelling"; task.note = `已记录取消意图，正在停止。取消中仍占执行槽 ${task.slot}/${task.slotLimit ?? state.concurrency}：未确认退出前不释放，也不显示已取消。`;
    log(task, "用户取消：先记录取消意图，再停止 worker/工具树");
    toast(`${task.id} 已记录取消意图，正在停止。`);
    setTimeout(() => {
      if (task.state !== "cancelling") return;
      task.state = "needs_review"; task.slot = undefined; task.note = "无法确认进程树是否已停止、工具是否已产生外部结果。核对前不会重新执行，也不会自动重发。";
      log(task, "无法确认进程树退出与副作用，保留取消意图并转待核对");
      // 转 needs_review 同步生成核对项：取消中占槽到此释放，但外部副作用风险必须由用户逐项决议（契约 §6 第 4 行）。
      if (!state.reviewItems.some((entry) => entry.taskId === task.id)) {
        state.reviewItems.push({ taskId: task.id, question: `取消 ${task.id} 后，进程树是否已停止、工具是否已产生外部结果？`, options: ["已确认完成", "用户明确取消", "标记失败", "保留待核对"], choice: null, evidence: "取消中未能确认进程树退出；无 attempt 结果提交记录", fromCancel: true });
        // 新增核对项只刷新剩余计数：恢复暂停由用户决议驱动（见 reviewChoice），
        // 已放行的恢复不因一个新任务转待核对而自动重新暂停。
        syncRecoveryPending();
      }
      render(); toast(`${task.id} 无法确认外部结果，已转待核对，请逐项核对。`);
    }, 2200);
  }
  render();
}

function resubmit(id) {
  const task = findTask(id); if (!task) return;
  if (state.recovery.active) { toast("恢复未放行：已暂停新任务提交。请先完成逐项核对。"); return; }
  if (task.state === "needs_review" || task.state === "interrupted") { toast("有外部副作用未知：先逐项核对，再重新提交。"); return; }
  const id2 = `T-${2020 + state.nextTask++}`;
  const seq = state.tasks.length + 1;
  const c = counts();
  const canStart = c.occupied < state.concurrency;
  const slotNo = canStart ? nextFreeSlot() : null;
  const next = { id: id2, seq, kind: task.kind, role: task.role, input: task.input, revision: task.revision, state: canStart ? "running" : "queued", slot: slotNo ?? undefined, slotLimit: canStart ? state.concurrency : undefined, attempt: "a1", epoch: "e1", events: [], note: "" };
  log(next, `由 ${task.id} 重新提交，新任务新 ID，不继承旧 attempt`);
  if (canStart) log(next, `领取执行槽 ${slotNo}/${state.concurrency}`);
  else next.note = `满槽仍入队列：当前 ${c.occupied} 个执行槽都被占用（运行中 ${c.running}、取消中 ${c.cancelling}）。`;
  state.tasks.push(next);
  render();
  toast(`已重新提交为 ${id2}，不继承 ${task.id} 的 attempt。`);
}

function reviewChoice(index, option) {
  const item = state.reviewItems[index]; if (!item) return;
  if (item.choice === option) { toast(`${item.taskId}：${option}，已是当前选择。`); return; }
  const previous = item.choice;
  item.choice = option;
  const task = state.tasks.find((t) => t.id === item.taskId);
  if (task) {
    if (option === "已确认完成") {
      task.state = item.fromCancel ? "cancelled" : "succeeded";
      task.note = item.fromCancel ? "已确认进程树退出且无未知外部副作用，取消意图完成。" : "已核对外部回执后转终态，回执引用已保留。";
      log(task, item.fromCancel ? "用户确认进程树已退出且无未知副作用，取消意图完成" : "用户确认已完成，保留回执引用");
    } else if (option === "用户明确取消") {
      task.state = "cancelled"; task.note = "用户明确承担未知外部副作用的风险，取消意图完成；不自动重发。"; log(task, "用户明确取消：未知副作用由用户负责处理");
    } else if (option === "标记失败") {
      task.state = "failed"; task.note = "确认真未生效，已转失败，可重新提交。"; log(task, "用户确认为失败，可重新提交");
    } else if (option === "保留待核对") {
      // 改为保留待核对：无论此前是未选择还是终态，任务都回到未决状态，风险重新记为未解除。
      task.state = "needs_review";
      if (previous && previous !== "保留待核对") {
        task.note = `决议已改回待核对（原「${previous}」）：在重新确认前不执行、不自动重发。`;
        log(task, `用户把「${previous}」改回待核对，风险重新记为未解除`);
      } else {
        task.note = "用户选择保留待核对：不重新执行，不自动重发，风险未解除。";
        log(task, "用户选择保留待核对：不重新执行，不自动重发，风险未解除");
      }
    }
  }
  // 放行条件：每项都是可解除风险的决定（已确认完成／标记失败／用户明确取消）。
  // 只要还有未选择或保留待核对的项，恢复必须保持暂停——包括放行后再把某项改回保留待核对的情形（P1-1）。
  const remaining = syncRecoveryPending();
  if (remaining === 0) {
    state.recovery.active = false;
    toast("核对已全部完成，恢复放行：定时收集与提醒投递恢复，普通调度继续。");
  } else {
    state.recovery.active = true;
    toast(`${item.taskId}：${option}，已记录操作者与时间。仍有 ${remaining} 项未决（未选择或保留待核对），恢复保持暂停。`);
  }
  render();
}

function dropEvent() {
  if (state.connection === "reconnecting") return;
  state.connection = "reconnecting"; render();
  toast("连接中断，正在按 Last-Event-ID 重放…");
  setTimeout(() => {
    state.connection = "snapshot"; state.cursor += 1; render();
    toast("已用全量快照重新同步：排队位置、取消意图与待核对项原样重现。");
    setTimeout(() => { state.connection = "connected"; render(); }, 1800);
  }, 1200);
}

document.addEventListener("click", (event) => {
  const navButton = event.target.closest("[data-page]");
  if (navButton) { state.page = navButton.dataset.page; render(); $("#view").scrollTop = 0; return; }
  const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === "close") { $("#task-dialog").close(); return; }
  if (action === "detail") openDetail(id);
  else if (action === "cancel") cancelTask(id);
  else if (action === "resubmit") resubmit(id);
  else if (action === "submit") submitTask();
  else if (action === "settings-link") { toast("并发是实例级设置：生产入口在设置页，面板只读当前值并链接过去；本演示没有设置页，此处只作说明（契约 §3.1）。"); }
  else if (action === "drop-event") dropEvent();
  else if (action === "open-review") {
    // 从详情进入核对：先关闭模态框，再切页并把焦点放到目标核对项（契约 §12）。
    $("#task-dialog").close();
    state.page = "review"; render(); $("#view").scrollTop = 0;
    const card = document.querySelector(`.cap-card[data-task-id="${id}"]`);
    if (card) card.focus();
  }
  else if (action === "go-review") { state.page = "review"; render(); $("#view").scrollTop = 0; }
  else if (action === "review-choice") reviewChoice(Number(button.dataset.index), button.dataset.option);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#task-dialog")?.open) { $("#task-dialog").close(); return; }
  const row = event.target.closest?.(".task-row");
  // 行级 Enter 只在行本身聚焦时打开详情；行内按钮（取消/重新提交/逐项核对/详情）保持原生键盘行为（契约 §12）。
  if (row && event.key === "Enter" && event.target === row) { event.preventDefault(); openDetail(row.dataset.id); return; }
  // ⌘K／Ctrl+K 是应用级快速录入：演示面板不捕获，放行给现有入口（契约 §12）。
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { toast("快速录入（⌘K／Ctrl+K）由应用级入口处理，本面板不捕获该组合。"); }
});
$("#task-dialog").addEventListener("click", (event) => {
  if (event.target !== $("#task-dialog")) return;
  const b = $("#task-dialog").getBoundingClientRect();
  if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) $("#task-dialog").close();
});
render();
