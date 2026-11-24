"use strict";
/* AgentFlow console — single-page console wired to the AgentFlow API.
   Views: dashboard, workflows, workflow builder, tool registry, knowledge
   table, runner, run history, trace detail, guardrails, reports & help. */
const app = document.getElementById("app");
let token = localStorage.getItem("af_token") || "";
let me = null, myProjectInfo = null, toolList = [];
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || ("HTTP " + res.status));
  return json.data;
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function loadSession() {
  if (!token) return false;
  try {
    me = (await api("GET", "/api/v1/auth/me")).user;
    myProjectInfo = (await api("GET", "/api/v1/project")).project;
    toolList = (await api("GET", "/api/v1/tools")).tools;
    document.getElementById("who").textContent = me.fullName + " · " + myProjectInfo.name;
    return true;
  } catch { token = ""; localStorage.removeItem("af_token"); return false; }
}
document.getElementById("signout").addEventListener("click", async (e) => {
  e.preventDefault();
  try { await api("POST", "/api/v1/auth/logout"); } catch {}
  token = ""; localStorage.removeItem("af_token"); location.hash = "#/dashboard"; route();
});
function signinView() {
  document.getElementById("mainnav").style.display = "none";
  app.innerHTML = `<h1>Sign in to AgentFlow</h1>
  <div class="row"><div class="col card"><h3>Sign in</h3>
    <label>Email <input id="li-email" type="email"></label>
    <label>Password <input id="li-pass" type="password"></label>
    <p><button class="btn" onclick="doLogin()">Sign in</button></p>
    <p class="small muted">Showcase workspace owner: owner@connectnorth.co.uk</p></div>
  <div class="col card"><h3>Start a new workspace</h3>
    <label>Your name <input id="rg-name"></label>
    <label>Email <input id="rg-email" type="email"></label>
    <label>Password <input id="rg-pass" type="password"></label>
    <label>Workspace name <input id="rg-biz"></label>
    <label>Team <input id="rg-team" placeholder="Support & Ops Automation"></label>
    <p><button class="btn accent" onclick="doRegister()">Create account &amp; workspace</button></p>
    <p class="small muted">A new workspace starts empty — add knowledge entries, build a workflow, then run it.</p></div></div>`;
}
async function doLogin() {
  try {
    const d = await api("POST", "/api/v1/auth/login", { email: document.getElementById("li-email").value, password: document.getElementById("li-pass").value });
    token = d.token; localStorage.setItem("af_token", token); document.getElementById("mainnav").style.display = ""; route();
  } catch (e) { alert(e.message); }
}
async function doRegister() {
  try {
    const d = await api("POST", "/api/v1/auth/register", { fullName: document.getElementById("rg-name").value,
      email: document.getElementById("rg-email").value, password: document.getElementById("rg-pass").value,
      projectName: document.getElementById("rg-biz").value, team: document.getElementById("rg-team").value });
    token = d.token; localStorage.setItem("af_token", token); document.getElementById("mainnav").style.display = ""; route();
  } catch (e) { alert(e.message); }
}
function statusPill(s) { return `<span class="pill ${esc(s)}">${esc(s.replace(/_/g, " "))}</span>`; }
const VIEWS = {
  async dashboard() {
    const d = await api("GET", "/api/v1/dashboard");
    app.innerHTML = `<section class="hero"><h1>${esc(d.project.name)}</h1>
      <p>${esc(d.project.team)} · ${esc(d.project.location)} — agent workflows at a glance.</p>
      <div class="score">${d.stats.totalCost}<span style="font-size:22px"> credits spent</span></div>
      <p>${d.stats.runs} runs · ${d.runsByStatus.completed} completed · ${d.runsByStatus.awaitingApproval ?? d.stats.awaitingApproval} awaiting approval · ${d.runsByStatus.halted_guardrail} halted on guardrails</p></section>
      <div class="grid">
        <div class="card"><div class="stat">${d.stats.workflows}</div><div class="muted">Workflows</div></div>
        <div class="card"><div class="stat">${d.stats.tools}</div><div class="muted">Tools in the registry</div></div>
        <div class="card"><div class="stat">${d.stats.knowledgeEntries}</div><div class="muted">Knowledge entries</div></div>
        <div class="card"><div class="stat">${d.stats.runs}</div><div class="muted">Runs recorded</div></div>
      </div>
      <h2>Guardrails in force</h2>
      <p><span class="pill">max steps: ${d.project.settings.maxSteps}</span>
      <span class="pill">budget cap: ${d.project.settings.budgetCap} credits</span>
      <span class="pill">blocked tools: ${d.project.settings.blockedTools.length ? esc(d.project.settings.blockedTools.join(", ")) : "none"}</span></p>
      <h2>Recent runs</h2>
      ${d.recentRuns.map((r) => `<div class="card">${statusPill(r.status)} <strong>${esc(r.workflowName)}</strong>
        <span class="mono small">${esc(r.reference)}</span> — ${r.stepsExecuted} steps · ${r.totalCost} credits
        ${r.finalOutput ? `<div class="small muted">Output: ${esc(r.finalOutput)}</div>` : ""}
        <a href="#/run/${r.id}">Trace →</a></div>`).join("") || "<p class='muted'>No runs yet.</p>"}`;
  },
  async workflows() {
    const rows = (await api("GET", "/api/v1/workflows")).workflows;
    app.innerHTML = `<h1>Workflows</h1><p class="muted">${rows.length} workflows in this workspace. Each is an ordered list of steps over the tool registry.</p>
    ${rows.map((w) => `<div class="card"><span class="pill">${esc(w.status)}</span> <span class="pill">${w.steps.length} steps</span>
      <span class="pill">cost ${w.steps.reduce((a, s) => a + s.cost, 0)} credits</span>
      <h3>${esc(w.name)}</h3><p>${esc(w.description)}</p>
      <p class="small mono">${w.steps.map((s) => esc(s.stepType === "approval" ? "approval" : s.toolCode)).join(" → ") || "no steps yet"}</p>
      <p><a href="#/workflow/${w.id}">Open builder →</a> · <a href="#/runner?wf=${w.id}">Run it →</a></p></div>`).join("")}
    <h2>New workflow</h2><div class="card">
      <label>Name <input id="wf-name"></label>
      <label>Description <textarea id="wf-desc" rows="2"></textarea></label>
      <p><button class="btn accent" onclick="createWorkflow()">Create workflow</button></p>
      <p class="small muted">Steps are added in the builder, one tool at a time.</p></div>`;
  },
  async workflow(id) {
    const w = (await api("GET", "/api/v1/workflows/" + id)).workflow;
    app.innerHTML = `<h1>${esc(w.name)}</h1>
    <p>${statusPill(w.status)} <span class="muted">${esc(w.description)}</span></p>
    <h2>Steps (run in order, outputs thread forward)</h2>
    ${w.steps.length ? `<table><tr><th>#</th><th>Step</th><th>Tool</th><th>Config</th><th class="num">Cost</th><th></th></tr>
    ${w.steps.map((s, i) => `<tr><td class="num">${i + 1}</td><td><strong>${esc(s.name)}</strong></td>
      <td class="mono">${esc(s.stepType === "approval" ? "approval" : s.toolCode)}</td>
      <td class="mono small">${esc(JSON.stringify(s.config))}</td><td class="num">${s.cost}</td>
      <td><button class="btn small ghost" onclick="deleteStep(${w.id}, ${s.id})">Remove</button></td></tr>`).join("")}</table>`
      : `<p class="muted">No steps yet — add the first one below.</p>`}
    <h2>Add a step</h2><div class="card">
      <div class="row"><div class="col"><label>Step name <input id="st-name"></label></div>
      <div class="col"><label>Type <select id="st-type"><option value="normal">Tool step</option><option value="approval">Approval step</option></select></label></div>
      <div class="col"><label>Tool <select id="st-tool">${toolList.map((t) => `<option value="${esc(t.code)}">${esc(t.name)} (${esc(t.code)})</option>`).join("")}</select></label></div>
      <div class="col"><label>Cost (credits) <input id="st-cost" type="number" placeholder="tool default"></label></div></div>
      <label>Config (JSON) <textarea id="st-config" rows="2">{}</textarea></label>
      <p class="small muted">Config keys by tool — calculator: <code>expression</code> · lookup: <code>key</code> · template: <code>template</code> ·
      text_format: <code>operation</code> · date_add: <code>days</code> · any tool: <code>source</code> (prev | input | literal) and <code>literal</code>.</p>
      <p><button class="btn" onclick="addStep(${w.id})">Add step</button>
      <a class="btn accent" href="#/runner?wf=${w.id}">Run this workflow</a></p></div>
    <h2>Workflow settings</h2><div class="card">
      <div class="row"><div class="col"><label>Name <input id="wf2-name" value="${esc(w.name)}"></label></div>
      <div class="col"><label>Status <select id="wf2-status">
        ${["draft", "active", "archived"].map((s) => `<option ${s === w.status ? "selected" : ""}>${s}</option>`).join("")}</select></label></div></div>
      <label>Description <textarea id="wf2-desc" rows="2">${esc(w.description)}</textarea></label>
      <p><button class="btn" onclick="updateWorkflow(${w.id})">Save changes</button></p></div>`;
  },
  async tools() {
    const rows = (await api("GET", "/api/v1/tools")).tools;
    app.innerHTML = `<h1>Tool Registry</h1><p class="muted">The ${rows.length} local deterministic tools a step can call. Each contract states exactly what goes in and what comes out; in production the same seam connects real tools and hosted model calls.</p>
    ${rows.map((t) => `<div class="card"><span class="pill">${esc(t.category)}</span> <span class="pill">default cost ${t.defaultCost}</span> <span class="pill">base ${t.baseMs}ms</span>
      <h3>${esc(t.name)} <code>${esc(t.code)}</code></h3><p>${esc(t.description)}</p>
      <p class="small"><strong>In:</strong> <span class="mono">${esc(t.inputContract)}</span></p>
      <p class="small"><strong>Out:</strong> <span class="mono">${esc(t.outputContract)}</span></p></div>`).join("")}`;
  },
  async knowledge() {
    const rows = (await api("GET", "/api/v1/knowledge")).entries;
    app.innerHTML = `<h1>Knowledge Table</h1><p class="muted">The seeded table the <code>lookup</code> tool reads. A step names a key; the stored value becomes its output.</p>
    <table><tr><th>Key</th><th>Value</th><th>Category</th></tr>
    ${rows.map((k) => `<tr><td class="mono">${esc(k.key)}</td><td>${esc(k.value)}</td><td>${esc(k.category)}</td></tr>`).join("")}</table>
    <h2>Add an entry</h2><div class="card">
      <div class="row"><div class="col"><label>Key <input id="kn-key" placeholder="new_key"></label></div>
      <div class="col"><label>Value <input id="kn-value"></label></div>
      <div class="col"><label>Category <input id="kn-cat" placeholder="Prices"></label></div></div>
      <p><button class="btn" onclick="addKnowledge()">Add entry</button></p></div>`;
  },
  async runner() {
    const wfs = (await api("GET", "/api/v1/workflows")).workflows;
    const wanted = new URLSearchParams(location.hash.split("?")[1] || "").get("wf");
    app.innerHTML = `<h1>Runner</h1>
    <div class="card"><h3>Start a run</h3>
      <p class="muted">The runner executes the workflow's steps in order under this workspace's guardrails
      (max ${myProjectInfo.settings.maxSteps} steps · budget ${myProjectInfo.settings.budgetCap} credits ·
      blocked: ${myProjectInfo.settings.blockedTools.length ? esc(myProjectInfo.settings.blockedTools.join(", ")) : "none"}).
      Every step is traced with its input, output, cost and duration.</p>
      <label>Workflow <select id="rn-wf">${wfs.map((w) => `<option value="${w.id}" ${String(w.id) === String(wanted) ? "selected" : ""}>${esc(w.name)} (${w.steps.length} steps)</option>`).join("")}</select></label>
      <label>Run input <input id="rn-input" placeholder="Text or date the first step reads, e.g. 2026-03-01"></label>
      <p><button class="btn accent" onclick="startRunNow()">Run workflow</button> <span id="rnmsg"></span></p>
      <div id="rnresult"></div></div>`;
  },
  async runs() {
    const status = new URLSearchParams(location.hash.split("?")[1] || "").get("status");
    const rows = (await api("GET", "/api/v1/runs" + (status ? "?status=" + encodeURIComponent(status) : ""))).runs;
    app.innerHTML = `<h1>Runs</h1>
    <p><a href="#/runs">all</a> · <a href="#/runs?status=completed">completed</a> · <a href="#/runs?status=awaiting_approval">awaiting approval</a> ·
    <a href="#/runs?status=halted_guardrail">halted</a> · <a href="#/runs?status=failed">failed</a></p>
    <table><tr><th>Reference</th><th>Workflow</th><th>Status</th><th class="num">Steps</th><th class="num">Cost</th><th>Final output</th><th>When</th><th></th></tr>
    ${rows.map((r) => `<tr><td class="mono">${esc(r.reference)}</td><td>${esc(r.workflowName)}</td><td>${statusPill(r.status)}</td>
      <td class="num">${r.stepsExecuted}</td><td class="num">${r.totalCost}</td><td>${esc(r.finalOutput || "—")}</td><td>${esc(r.createdAt)}</td>
      <td><a href="#/run/${r.id}">Trace →</a></td></tr>`).join("")}</table>`;
  },
  async run(id) {
    const d = await api("GET", "/api/v1/runs/" + id);
    const r = d.run;
    app.innerHTML = `<h1>Run ${esc(r.reference)}</h1>
    <p>${statusPill(r.status)} <strong>${esc(r.workflowName)}</strong> · triggered by ${esc(r.triggeredBy)} · ${esc(r.createdAt)}</p>
    <div class="grid">
      <div class="card"><div class="stat">${r.stepsExecuted}</div><div class="muted">Steps executed</div></div>
      <div class="card"><div class="stat">${r.totalCost}</div><div class="muted">Total cost (credits)</div></div>
      <div class="card"><div class="stat">${d.trace.length}</div><div class="muted">Trace entries</div></div>
      <div class="card"><div class="stat">${d.breakdown.costsReconcile ? "✓" : "✗"}</div><div class="muted">Trace costs reconcile with the total</div></div>
    </div>
    ${r.status === "halted_guardrail" ? `<div class="error">Halted by guardrail <strong>${esc(r.haltReason)}</strong> at step index ${r.haltedStepIndex}. Spend stayed at ${r.totalCost} credits.</div>` : ""}
    ${r.status === "awaiting_approval" ? `<div class="notice">This run is paused at step index ${r.pendingStepIndex} waiting for approval.
      <p><button class="btn accent" onclick="approveRun(${r.id})">Approve &amp; resume</button></p></div>` : ""}
    <div class="card"><h3>Final output</h3><p class="mono">${esc(r.finalOutput || "(none yet)")}</p>
    <p class="small muted">Run input: <span class="mono">${esc(r.input || "(empty)")}</span> · ${esc(d.breakdown.formula)} = ${d.breakdown.traceCostSum}</p>
    <p><button class="btn" onclick="makeReport(${r.id})">Generate report for this run</button></p></div>
    <h2>Trace</h2>
    <table><tr><th>#</th><th>Step</th><th>Tool</th><th>Input</th><th>Output</th><th>Detail</th><th class="num">Cost</th><th class="num">Duration</th><th>Status</th></tr>
    ${d.trace.map((t) => `<tr><td class="num">${t.stepIndex + 1}</td><td><strong>${esc(t.stepName)}</strong></td>
      <td class="mono">${esc(t.stepType === "approval" ? "approval" : t.toolCode)}</td><td class="mono small">${esc(t.input)}</td>
      <td class="mono small">${esc(t.output)}</td><td class="small">${esc(t.detail)}</td><td class="num">${t.cost}</td>
      <td class="num">${t.durationMs}ms</td><td>${statusPill(t.status)}</td></tr>`).join("")}</table>`;
  },
  async guardrails() {
    const p = (await api("GET", "/api/v1/project")).project;
    app.innerHTML = `<h1>Guardrails</h1>
    <p class="muted">Checked before every step, in this order: max steps → approval pause → blocked tool → budget cap. A halted run keeps the spend it had already committed and records exactly which guardrail stopped it.</p>
    <div class="card"><h3>Workspace settings — ${esc(p.name)}</h3>
      <div class="row"><div class="col"><label>Max steps per run <input id="gr-max" type="number" value="${p.settings.maxSteps}"></label></div>
      <div class="col"><label>Budget cap (credits per run) <input id="gr-budget" type="number" value="${p.settings.budgetCap}"></label></div></div>
      <label>Blocked tools</label>
      ${toolList.map((t) => `<label style="display:inline-block;margin:4px 14px 4px 0;font-weight:400"><input type="checkbox" class="gr-blocked" value="${esc(t.code)}" style="width:auto" ${p.settings.blockedTools.includes(t.code) ? "checked" : ""}> ${esc(t.name)}</label>`).join("")}
      <p><button class="btn accent" onclick="saveGuardrails()">Save guardrails</button> <span id="grmsg"></span></p></div>
    <div class="card"><h3>How each guardrail behaves</h3>
      <p><strong>Max steps.</strong> When the steps already executed reach the limit, the next step never runs; the run ends <code>halted_guardrail</code> with reason <code>max_steps</code>.</p>
      <p><strong>Budget cap.</strong> Steps carry seeded costs. When the next step's cost would take the run over the cap, the run halts with reason <code>budget_cap</code> — spent stays at the amount already committed.</p>
      <p><strong>Blocked tools.</strong> A step naming a blocked tool halts the run with reason <code>blocked_tool</code> before that step executes.</p>
      <p><strong>Approval steps.</strong> A step of type approval pauses the run as <code>awaiting_approval</code>; it resumes from the same step once a person approves it in the trace view.</p></div>`;
  },
  async reports() {
    const rows = (await api("GET", "/api/v1/reports")).reports;
    const notes = (await api("GET", "/api/v1/notifications")).notifications;
    app.innerHTML = `<h1>Reports &amp; Help</h1>
    <div class="card"><h3>Generate a run report</h3>
      <p class="muted">Summarises the most recent run in this workspace — status, steps, cost and final output.</p>
      <p><button class="btn accent" onclick="makeReport()">Generate report from latest run</button></p></div>
    ${rows.map((r) => `<div class="card"><span class="pill">${esc(r.reference)}</span><h3>${esc(r.title)}</h3>
      <p>${esc(r.summary)}</p><p class="small muted">by ${esc(r.createdBy)} · ${esc(r.createdAt)}</p></div>`).join("")}
    <h2>Notifications</h2>
    ${notes.map((n) => `<div class="card"><strong>${esc(n.title)}</strong><div class="small muted">${esc(n.body)}</div></div>`).join("") || "<p class='muted'>None yet.</p>"}
    <h2>Help &amp; guide</h2>
    <div class="card"><h3>How AgentFlow runs a workflow</h3><p>Steps run in order. Each step's output becomes the next step's <code>{prev}</code>; the run input is available as <code>{input}</code>. The runner records a trace entry per step — resolved input, output, the detail behind the result, its seeded cost and a deterministic duration (tool base + input length) — so the same workflow with the same inputs always traces identically.</p></div>
    <div class="card"><h3>About the data and the tools</h3><p>AgentFlow's tools are local deterministic functions — a safe arithmetic calculator (tokeniser and parser, never eval), a lookup over the workspace knowledge table, a text formatter, a word counter, a UTC date adder and a template filler. They stand in at the tool seam: in a production engagement the same step contracts plug in real tools and hosted model calls (OpenAI, Anthropic, Google, Azure OpenAI) — see the product backlog. All workflows, knowledge entries and runs in this workspace are seeded local data for a fictional Manchester support team.</p></div>
    <div class="card"><h3>Reading a trace</h3><p>A completed trace's step costs sum exactly to the run's total cost — the trace view checks this for you. A halted trace ends with a <code>halted_guardrail</code> entry naming the guardrail; a paused trace shows the approval step as <code>awaiting_approval</code> until it is approved.</p></div>`;
  },
};
async function createWorkflow() {
  try { const d = await api("POST", "/api/v1/workflows", { name: document.getElementById("wf-name").value,
    description: document.getElementById("wf-desc").value }); location.hash = "#/workflow/" + d.workflow.id; }
  catch (e) { alert(e.message); }
}
async function addStep(wfId) {
  let config = {};
  try { config = JSON.parse(document.getElementById("st-config").value || "{}"); }
  catch { alert("Config must be valid JSON"); return; }
  const costRaw = document.getElementById("st-cost").value;
  try {
    await api("POST", "/api/v1/workflows/" + wfId + "/steps", { name: document.getElementById("st-name").value,
      stepType: document.getElementById("st-type").value, toolCode: document.getElementById("st-tool").value,
      config, ...(costRaw === "" ? {} : { cost: Number(costRaw) }) });
    route();
  } catch (e) { alert(e.message); }
}
async function deleteStep(wfId, stepId) {
  try { await api("DELETE", "/api/v1/workflows/" + wfId + "/steps/" + stepId); route(); } catch (e) { alert(e.message); }
}
async function updateWorkflow(wfId) {
  try { await api("PUT", "/api/v1/workflows/" + wfId, { name: document.getElementById("wf2-name").value,
    description: document.getElementById("wf2-desc").value, status: document.getElementById("wf2-status").value }); route(); }
  catch (e) { alert(e.message); }
}
async function addKnowledge() {
  try { await api("POST", "/api/v1/knowledge", { key: document.getElementById("kn-key").value,
    value: document.getElementById("kn-value").value, category: document.getElementById("kn-cat").value }); route(); }
  catch (e) { alert(e.message); }
}
async function startRunNow() {
  const msg = document.getElementById("rnmsg"); msg.textContent = "Running…";
  try {
    const d = await api("POST", "/api/v1/runs", { workflowId: Number(document.getElementById("rn-wf").value),
      input: document.getElementById("rn-input").value });
    document.getElementById("rnresult").innerHTML = `<div class="notice">Run <strong>${esc(d.run.reference)}</strong> finished as
      <strong>${esc(d.run.status)}</strong> · ${d.run.stepsExecuted} steps · ${d.run.totalCost} credits.
      Output: <span class="mono">${esc(d.run.finalOutput || "(none)")}</span>
      <a href="#/run/${d.run.id}">Open the full trace →</a></div>`;
    msg.textContent = "";
  } catch (e) { msg.textContent = e.message; }
}
async function approveRun(id) {
  try { await api("POST", "/api/v1/runs/" + id + "/approve", {}); route(); } catch (e) { alert(e.message); }
}
async function makeReport(runId) {
  try { await api("POST", "/api/v1/reports", runId ? { runId } : {}); location.hash = "#/reports"; route(); }
  catch (e) { alert(e.message); }
}
async function saveGuardrails() {
  const blocked = [...document.querySelectorAll(".gr-blocked:checked")].map((c) => c.value);
  try {
    const d = await api("PUT", "/api/v1/project", { settings: { maxSteps: Number(document.getElementById("gr-max").value),
      budgetCap: Number(document.getElementById("gr-budget").value), blockedTools: blocked } });
    myProjectInfo = d.project;
    document.getElementById("grmsg").textContent = "Saved — max " + d.project.settings.maxSteps + " steps, cap " + d.project.settings.budgetCap + " credits.";
  } catch (e) { alert(e.message); }
}
async function route() {
  const raw = location.hash.replace(/^#\//, "") || "dashboard";
  const [pathPart] = raw.split("?");
  const segs = pathPart.split("/").filter(Boolean);
  const view = segs[0] || "dashboard";
  const arg = segs[1] ? decodeURIComponent(segs[1]) : undefined;
  if (!(await loadSession())) { signinView(); return; }
  document.getElementById("mainnav").style.display = "";
  try {
    if (view === "workflow" && arg) await VIEWS.workflow(arg);
    else if (view === "run" && arg) await VIEWS.run(arg);
    else await (VIEWS[view] || VIEWS.dashboard)();
  } catch (e) { app.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
window.addEventListener("hashchange", route);
route();
