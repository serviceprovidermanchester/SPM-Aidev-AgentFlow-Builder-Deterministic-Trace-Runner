"use strict";
/* Live end-to-end tests for AgentFlow. Starts the real server against a
   FRESH temporary database and exercises the product over HTTP: accounts,
   the seeded showcase workspace with exact expected values, and labelled
   expected-output cases (AF-01…) whose fixtures are computed by hand —
   e.g. knowledge seat_licence = 25, calculator "{prev} * 4" = 100, so the
   template step must finish with exactly
   "Total for 4 seat licences: £100." at a total cost of 5 + 10 + 5 = 20.
   Run: node tests/run-tests.js — non-zero on failure. */
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const PORT = 4741;
const BASE = "http://127.0.0.1:" + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-test-"));
const DB = path.join(tmp, "test.sqlite");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("PASS  " + name + (detail ? " - " + detail : "")); }
  else { failed++; console.log("FAIL  " + name + (detail ? " - " + detail : "")); }
}
async function req(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function makeWorkspace(email) {
  const reg = await req("POST", "/api/v1/auth/register", null,
    { fullName: "Fixture Owner", email, password: "Owner2026!", projectName: "Fixture Workspace " + email });
  return reg.json.data.token;
}
async function addKnowledge(token, key, value) {
  return req("POST", "/api/v1/knowledge", token, { key, value, category: "Fixtures" });
}
async function makeWorkflow(token, name, steps) {
  const r = await req("POST", "/api/v1/workflows", token, { name, steps });
  return r.json.data.workflow;
}
async function startRun(token, workflowId, input) {
  return req("POST", "/api/v1/runs", token, { workflowId, input: input ?? "" });
}
async function setSettings(token, settings) {
  return req("PUT", "/api/v1/project", token, { settings });
}
(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "backend", "src", "server.js")],
    { env: { ...process.env, PORT: String(PORT), DB_PATH: DB }, stdio: "pipe" });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { const r = await fetch(BASE + "/health"); up = r.ok; } catch { await sleep(200); } }
  if (!up) { console.log("FAIL  server did not start"); process.exit(1); }
  try {
    // ---- Seeded showcase workspace: exact expected values ----
    const health = await req("GET", "/health");
    check("health reports 1 project, 6 tools, 8 knowledge entries, 4 workflows",
      health.json.data.projectsLoaded === 1 && health.json.data.toolsLoaded === 6 &&
      health.json.data.knowledgeLoaded === 8 && health.json.data.workflowsLoaded === 4,
      "tools=" + health.json.data.toolsLoaded + ", knowledge=" + health.json.data.knowledgeLoaded);
    const login = await req("POST", "/api/v1/auth/login", null, { email: "owner@connectnorth.co.uk", password: "Owner2026!" });
    check("seeded owner can sign in", login.status === 200, "owner@connectnorth.co.uk");
    const T = login.json.data.token;
    check("wrong password rejected", (await req("POST", "/api/v1/auth/login", null, { email: "owner@connectnorth.co.uk", password: "nope" })).status === 401, "HTTP 401");
    check("workflows need sign-in", (await req("GET", "/api/v1/workflows")).status === 401, "HTTP 401");
    const dash = (await req("GET", "/api/v1/dashboard", T)).json.data;
    check("seeded dashboard: 4 workflows, 4 runs, total spend 49, 3 completed / 1 awaiting approval",
      dash.stats.workflows === 4 && dash.stats.runs === 4 && dash.stats.totalCost === 49 &&
      dash.runsByStatus.completed === 3 && dash.runsByStatus.awaiting_approval === 1,
      "spend=" + dash.stats.totalCost + ", runs=" + dash.stats.runs);
    const runs = (await req("GET", "/api/v1/runs", T)).json.data.runs;
    const quoteRun = runs.find((r) => r.workflowName === "Install Quote Builder");
    const quoteDetail = (await req("GET", "/api/v1/runs/" + quoteRun.id, T)).json.data;
    check("AF-S1 canonical seeded run: lookup 45 -> calculator 90 -> \"Total for 2 replacement routers: £90.\", cost 20, durations 26/18/8",
      quoteRun.finalOutput === "Total for 2 replacement routers: £90." && quoteRun.totalCost === 20 &&
      quoteDetail.trace.map((t) => t.output).join("|") === "45|90|Total for 2 replacement routers: £90." &&
      quoteDetail.trace.map((t) => t.durationMs).join(",") === "26,18,8" && quoteDetail.breakdown.costsReconcile === true,
      "final=" + quoteRun.finalOutput + ", cost=" + quoteRun.totalCost);
    const refundRun = runs.find((r) => r.workflowName === "Refund Deadline Checker");
    check("AF-S2 seeded refund run: 2026-03-01 + 14 days -> \"Your refund deadline is 2026-03-15.\", cost 13",
      refundRun.finalOutput === "Your refund deadline is 2026-03-15." && refundRun.totalCost === 13,
      "final=" + refundRun.finalOutput);
    const escRun = runs.find((r) => r.workflowName === "Escalation Summary with Approval");
    check("AF-S3 seeded escalation run pauses at its approval step: awaiting_approval, pending index 1, 1 step executed, cost 6, prev \"8\"",
      escRun.status === "awaiting_approval" && escRun.pendingStepIndex === 1 && escRun.stepsExecuted === 1 &&
      escRun.totalCost === 6 && escRun.finalOutput === "8",
      "status=" + escRun.status + ", pending=" + escRun.pendingStepIndex);
    const tools = (await req("GET", "/api/v1/tools", T)).json.data.tools;
    check("tool registry holds all 6 tools", tools.length === 6, tools.map((t) => t.code).join(","));
    const calc = (await req("GET", "/api/v1/tools/calculator", T)).json.data.tool;
    check("calculator contract documents the expression input and 4dp output",
      /expression/.test(calc.inputContract) && /4dp/.test(calc.outputContract) && calc.defaultCost === 10,
      calc.inputContract);
    check("unknown tool code is 404", (await req("GET", "/api/v1/tools/no_such_tool", T)).status === 404, "HTTP 404");
    const knowledge = (await req("GET", "/api/v1/knowledge", T)).json.data.entries;
    const router = knowledge.find((k) => k.key === "router_replacement");
    check("knowledge table holds 8 entries and router_replacement = 45",
      knowledge.length === 8 && router && router.value === "45", "entries=" + knowledge.length);
    const wfs = (await req("GET", "/api/v1/workflows", T)).json.data.workflows;
    const w1 = wfs.find((w) => w.name === "Install Quote Builder");
    check("seeded workflows list holds 4 workflows; the quote builder threads lookup -> calculator -> template",
      wfs.length === 4 && w1.steps.map((s) => s.toolCode).join(",") === "lookup,calculator,template",
      w1.steps.map((s) => s.toolCode).join(","));
    const proj = (await req("GET", "/api/v1/project", T)).json.data.project;
    check("project profile carries the default guardrails (maxSteps 12, budgetCap 100, no blocked tools)",
      proj.settings.maxSteps === 12 && proj.settings.budgetCap === 100 && proj.settings.blockedTools.length === 0 &&
      proj.name === "ConnectNorth Support Operations", proj.name);

    // ---- Accounts, scoping, roles ----
    const staffLogin = await req("POST", "/api/v1/auth/login", null, { email: "team@connectnorth.co.uk", password: "Team2026!" });
    const ST = staffLogin.json.data.token;
    check("staff cannot update the project profile or guardrails (owner only)",
      (await req("PUT", "/api/v1/project", ST, { settings: { budgetCap: 1 } })).status === 403, "HTTP 403");
    const TF = await makeWorkspace("fixtures@agentflow.example.co.uk");
    check("register creates an owner with an empty workspace",
      (await req("GET", "/api/v1/workflows", TF)).json.data.workflows.length === 0, "0 workflows");
    check("duplicate email rejected", (await req("POST", "/api/v1/auth/register", null,
      { fullName: "Copy", email: "fixtures@agentflow.example.co.uk", password: "Owner2026!", projectName: "Copy" })).status === 409, "HTTP 409 EMAIL_TAKEN");
    check("another workspace cannot read the seeded workspace's workflow",
      (await req("GET", "/api/v1/workflows/" + w1.id, TF)).status === 404, "HTTP 404");
    check("another workspace cannot read the seeded workspace's run",
      (await req("GET", "/api/v1/runs/" + quoteRun.id, TF)).status === 404, "HTTP 404");

    // ---- Labelled expected-output fixtures (fresh workspace) ----
    await addKnowledge(TF, "seat_licence", "25");
    const canonical = await makeWorkflow(TF, "Seat Licence Quote", [
      { name: "Look up licence price", toolCode: "lookup", config: { key: "seat_licence" }, cost: 5 },
      { name: "Multiply by four seats", toolCode: "calculator", config: { expression: "{prev} * 4" }, cost: 10 },
      { name: "Write the quote", toolCode: "template", config: { template: "Total for 4 seat licences: £{prev}." }, cost: 5 },
    ]);
    const run1 = await startRun(TF, canonical.id, "");
    check("AF-01 canonical chain: 25 -> 100 -> \"Total for 4 seat licences: £100.\", cost 5+10+5=20, durations 20/18/9",
      run1.status === 201 && run1.json.data.run.status === "completed" &&
      run1.json.data.run.finalOutput === "Total for 4 seat licences: £100." && run1.json.data.run.totalCost === 20 &&
      run1.json.data.trace.map((t) => t.output).join("|") === "25|100|Total for 4 seat licences: £100." &&
      run1.json.data.trace.map((t) => t.durationMs).join(",") === "20,18,9",
      "final=" + run1.json.data.run.finalOutput + ", cost=" + run1.json.data.run.totalCost);
    const prec = await makeWorkflow(TF, "Precedence", [
      { name: "Calc", toolCode: "calculator", config: { expression: "2 + 3 * 4" }, cost: 10 }]);
    const runPrec = await startRun(TF, prec.id, "");
    check("AF-02 calculator precedence: 2 + 3 * 4 = 14 (multiplication binds first)",
      runPrec.json.data.run.finalOutput === "14", "final=" + runPrec.json.data.run.finalOutput);
    const paren = await makeWorkflow(TF, "Parentheses", [
      { name: "Calc", toolCode: "calculator", config: { expression: "(10 + 5) / 3" }, cost: 10 }]);
    const runParen = await startRun(TF, paren.id, "");
    check("AF-03 calculator parentheses: (10 + 5) / 3 = 5",
      runParen.json.data.run.finalOutput === "5", "final=" + runParen.json.data.run.finalOutput);
    const decimal = await makeWorkflow(TF, "Decimal division", [
      { name: "Calc", toolCode: "calculator", config: { expression: "10 / 4" }, cost: 10 }]);
    const runDec = await startRun(TF, decimal.id, "");
    check("AF-04 calculator decimal result: 10 / 4 = 2.5",
      runDec.json.data.run.finalOutput === "2.5", "final=" + runDec.json.data.run.finalOutput);
    const wc = await makeWorkflow(TF, "Word count fixture", [
      { name: "Count", toolCode: "word_count", config: { source: "literal", literal: "the quick brown fox jumps" }, cost: 6 }]);
    const runWc = await startRun(TF, wc.id, "");
    check("AF-05 word count: \"the quick brown fox jumps\" has exactly 5 words",
      runWc.json.data.run.finalOutput === "5", "final=" + runWc.json.data.run.finalOutput);
    const upper = await makeWorkflow(TF, "Uppercase fixture", [
      { name: "Shout", toolCode: "text_format", config: { source: "literal", literal: "hello manchester", operation: "uppercase" }, cost: 4 }]);
    const runUpper = await startRun(TF, upper.id, "");
    check("AF-06 text format uppercase: \"hello manchester\" -> \"HELLO MANCHESTER\"",
      runUpper.json.data.run.finalOutput === "HELLO MANCHESTER", "final=" + runUpper.json.data.run.finalOutput);
    const title = await makeWorkflow(TF, "Title fixture", [
      { name: "Title", toolCode: "text_format", config: { source: "literal", literal: "support team manchester", operation: "title" }, cost: 4 }]);
    const runTitle = await startRun(TF, title.id, "");
    check("AF-07 text format title case: \"support team manchester\" -> \"Support Team Manchester\"",
      runTitle.json.data.run.finalOutput === "Support Team Manchester", "final=" + runTitle.json.data.run.finalOutput);
    const dAdd = await makeWorkflow(TF, "Date add fixture", [
      { name: "Add days", toolCode: "date_add", config: { source: "input", days: 10 }, cost: 8 }]);
    const runDate = await startRun(TF, dAdd.id, "2026-03-15");
    check("AF-08 date add: 2026-03-15 + 10 days = 2026-03-25",
      runDate.json.data.run.finalOutput === "2026-03-25", "final=" + runDate.json.data.run.finalOutput);
    const dYear = await makeWorkflow(TF, "Date year boundary", [
      { name: "Add days", toolCode: "date_add", config: { source: "input", days: 5 }, cost: 8 }]);
    const runYear = await startRun(TF, dYear.id, "2026-12-30");
    check("AF-09 date add across the year boundary: 2026-12-30 + 5 days = 2027-01-04",
      runYear.json.data.run.finalOutput === "2027-01-04", "final=" + runYear.json.data.run.finalOutput);
    const greet = await makeWorkflow(TF, "Greeting template", [
      { name: "Greet", toolCode: "template", config: { template: "Hello {input}, your reference is ready." }, cost: 5 }]);
    const runGreet = await startRun(TF, greet.id, "Amelia");
    check("AF-10 template fills {input}: \"Hello Amelia, your reference is ready.\"",
      runGreet.json.data.run.finalOutput === "Hello Amelia, your reference is ready.",
      "final=" + runGreet.json.data.run.finalOutput);

    // ---- Guardrails ----
    await setSettings(TF, { budgetCap: 65 });
    const budgetWf = await makeWorkflow(TF, "Budget fixture", [
      { name: "Step A", toolCode: "calculator", config: { expression: "1 + 1" }, cost: 30 },
      { name: "Step B", toolCode: "calculator", config: { expression: "2 + 2" }, cost: 30 },
      { name: "Step C", toolCode: "calculator", config: { expression: "3 + 3" }, cost: 30 }]);
    const runBudget = await startRun(TF, budgetWf.id, "");
    check("AF-11 budget cap: costs 30+30+30 with cap 65 halts before step 3 (spent 60, halted at index 2)",
      runBudget.json.data.run.status === "halted_guardrail" && runBudget.json.data.run.haltReason === "budget_cap" &&
      runBudget.json.data.run.haltedStepIndex === 2 && runBudget.json.data.run.totalCost === 60 &&
      runBudget.json.data.run.stepsExecuted === 2 &&
      runBudget.json.data.trace.map((t) => t.status).join(",") === "completed,completed,halted_guardrail",
      "spent=" + runBudget.json.data.run.totalCost + ", haltedAt=" + runBudget.json.data.run.haltedStepIndex);
    await setSettings(TF, { budgetCap: 100, maxSteps: 2 });
    const maxWf = await makeWorkflow(TF, "Max steps fixture", [
      { name: "One", toolCode: "word_count", config: { source: "literal", literal: "one" }, cost: 1 },
      { name: "Two", toolCode: "word_count", config: { source: "literal", literal: "one two" }, cost: 1 },
      { name: "Three", toolCode: "word_count", config: { source: "literal", literal: "one two three" }, cost: 1 },
      { name: "Four", toolCode: "word_count", config: { source: "literal", literal: "four" }, cost: 1 }]);
    const runMax = await startRun(TF, maxWf.id, "");
    check("AF-12 max steps: a 4-step workflow with maxSteps 2 halts at index 2 after exactly 2 steps (cost 2)",
      runMax.json.data.run.status === "halted_guardrail" && runMax.json.data.run.haltReason === "max_steps" &&
      runMax.json.data.run.haltedStepIndex === 2 && runMax.json.data.run.stepsExecuted === 2 && runMax.json.data.run.totalCost === 2,
      "executed=" + runMax.json.data.run.stepsExecuted);
    await setSettings(TF, { maxSteps: 12, blockedTools: ["calculator"] });
    const blockedWf = await makeWorkflow(TF, "Blocked tool fixture", [
      { name: "Count first", toolCode: "word_count", config: { source: "literal", literal: "hello world" }, cost: 6 },
      { name: "Then calculate", toolCode: "calculator", config: { expression: "{prev} + 1" }, cost: 10 }]);
    const runBlocked = await startRun(TF, blockedWf.id, "");
    check("AF-13 blocked tool: with calculator blocked, the run halts at index 1 having spent only the first step's 6",
      runBlocked.json.data.run.status === "halted_guardrail" && runBlocked.json.data.run.haltReason === "blocked_tool" &&
      runBlocked.json.data.run.haltedStepIndex === 1 && runBlocked.json.data.run.totalCost === 6 &&
      runBlocked.json.data.run.finalOutput === "2",
      "haltedAt=" + runBlocked.json.data.run.haltedStepIndex + ", spent=" + runBlocked.json.data.run.totalCost);
    await setSettings(TF, { blockedTools: [] });

    // ---- Approval pause & resume ----
    const apprWf = await makeWorkflow(TF, "Approval fixture", [
      { name: "Count the note", toolCode: "word_count", config: { source: "literal", literal: "urgent broadband outage reported" }, cost: 6 },
      { name: "Supervisor approval", stepType: "approval", cost: 0 },
      { name: "Write the note", toolCode: "template", config: { template: "Escalation note: {prev} words checked." }, cost: 5 }]);
    const runAppr = await startRun(TF, apprWf.id, "");
    check("AF-14 approval step pauses the run: awaiting_approval at index 1, 1 step executed, spent 6, prev \"4\"",
      runAppr.json.data.run.status === "awaiting_approval" && runAppr.json.data.run.pendingStepIndex === 1 &&
      runAppr.json.data.run.stepsExecuted === 1 && runAppr.json.data.run.totalCost === 6 &&
      runAppr.json.data.run.finalOutput === "4",
      "status=" + runAppr.json.data.run.status + ", pending=" + runAppr.json.data.run.pendingStepIndex);
    const approved = await req("POST", "/api/v1/runs/" + runAppr.json.data.run.id + "/approve", TF, {});
    check("AF-15 approving resumes and completes: final \"Escalation note: 4 words checked.\", cost 11, 3 steps executed, approval trace completed",
      approved.status === 200 && approved.json.data.run.status === "completed" &&
      approved.json.data.run.finalOutput === "Escalation note: 4 words checked." &&
      approved.json.data.run.totalCost === 11 && approved.json.data.run.stepsExecuted === 3 &&
      approved.json.data.trace.length === 3 && approved.json.data.trace[1].status === "completed" &&
      approved.json.data.trace[1].output === "Approved",
      "final=" + approved.json.data.run.finalOutput + ", cost=" + approved.json.data.run.totalCost);
    check("approving a completed run is a 400",
      (await req("POST", "/api/v1/runs/" + runAppr.json.data.run.id + "/approve", TF, {})).status === 400, "HTTP 400 NOT_AWAITING");

    // ---- Failure modes ----
    const missingWf = await makeWorkflow(TF, "Missing key fixture", [
      { name: "Look up nothing", toolCode: "lookup", config: { key: "no_such_key" }, cost: 5 }]);
    const runMissing = await startRun(TF, missingWf.id, "");
    check("AF-16 a lookup for a missing knowledge key fails the run with no spend",
      runMissing.json.data.run.status === "failed" && runMissing.json.data.run.stepsExecuted === 0 &&
      runMissing.json.data.run.totalCost === 0 && runMissing.json.data.trace[0].status === "failed",
      "status=" + runMissing.json.data.run.status);
    const unsafeWf = await makeWorkflow(TF, "Unsafe expression fixture", [
      { name: "Calc", toolCode: "calculator", config: { expression: "2 + process.exit()" }, cost: 10 }]);
    const runUnsafe = await startRun(TF, unsafeWf.id, "");
    check("AF-17 the calculator rejects code-like input (no eval): \"2 + process.exit()\" fails the run",
      runUnsafe.json.data.run.status === "failed" && /not allowed/.test(runUnsafe.json.data.trace[0].detail),
      "detail=" + runUnsafe.json.data.trace[0].detail);
    const divZeroWf = await makeWorkflow(TF, "Division by zero fixture", [
      { name: "Calc", toolCode: "calculator", config: { expression: "10 / 0" }, cost: 10 }]);
    const runDiv = await startRun(TF, divZeroWf.id, "");
    check("AF-18 division by zero fails the step with a clear detail",
      runDiv.json.data.run.status === "failed" && /Division by zero/.test(runDiv.json.data.trace[0].detail),
      "detail=" + runDiv.json.data.trace[0].detail);
    const run1b = await startRun(TF, canonical.id, "");
    check("AF-19 determinism: re-running the canonical workflow reproduces the identical output, cost and durations",
      run1b.json.data.run.finalOutput === run1.json.data.run.finalOutput &&
      run1b.json.data.run.totalCost === run1.json.data.run.totalCost &&
      run1b.json.data.trace.map((t) => t.durationMs).join(",") === run1.json.data.trace.map((t) => t.durationMs).join(","),
      "durations=" + run1b.json.data.trace.map((t) => t.durationMs).join(","));

    // ---- Builder CRUD, reports, notifications ----
    check("creating a workflow with an unknown tool is a 400",
      (await req("POST", "/api/v1/workflows", TF, { name: "Bad", steps: [{ name: "X", toolCode: "teleport", config: {} }] })).status === 400,
      "HTTP 400 BAD_STEP");
    const emptyWf = (await req("POST", "/api/v1/workflows", TF, { name: "Empty workflow" })).json.data.workflow;
    check("running a workflow with no steps is a 400",
      (await startRun(TF, emptyWf.id, "")).status === 400, "HTTP 400 NO_STEPS");
    const added = await req("POST", "/api/v1/workflows/" + emptyWf.id + "/steps", TF,
      { name: "Count words", toolCode: "word_count", config: { source: "literal", literal: "a b c" } });
    check("adding a step appends it with the tool's default cost (word_count = 6)",
      added.status === 201 && added.json.data.workflow.steps.length === 1 && added.json.data.step.cost === 6,
      "steps=" + added.json.data.workflow.steps.length + ", cost=" + added.json.data.step.cost);
    const added2 = await req("POST", "/api/v1/workflows/" + emptyWf.id + "/steps", TF,
      { name: "Approve it", stepType: "approval" });
    const del = await req("DELETE", "/api/v1/workflows/" + emptyWf.id + "/steps/" + added.json.data.step.id, TF);
    check("deleting a step removes it and keeps the remaining steps in order",
      del.status === 200 && del.json.data.workflow.steps.length === 1 &&
      del.json.data.workflow.steps[0].id === added2.json.data.step.id,
      "remaining=" + del.json.data.workflow.steps.length);
    const upd = await req("PUT", "/api/v1/workflows/" + emptyWf.id, TF, { name: "Renamed workflow", status: "draft" });
    check("owner updates a workflow's name and status",
      upd.status === 200 && upd.json.data.workflow.name === "Renamed workflow" && upd.json.data.workflow.status === "draft",
      upd.json.data.workflow.status);
    check("duplicate knowledge key is a 409",
      (await addKnowledge(TF, "seat_licence", "99")).status === 409, "HTTP 409 KEY_EXISTS");
    const rep = await req("POST", "/api/v1/reports", TF, { runId: run1.json.data.run.id });
    check("report generation summarises the canonical run with its real output and cost",
      rep.status === 201 && /Total for 4 seat licences/.test(rep.json.data.report.summary) &&
      /total cost 20 credits/.test(rep.json.data.report.summary) && /^RPT-/.test(rep.json.data.report.reference),
      rep.json.data.report && rep.json.data.report.reference);
    const reports = (await req("GET", "/api/v1/reports", TF)).json.data.reports;
    check("reports list holds the generated report", reports.length === 1, reports.length + " report(s)");
    const notes = (await req("GET", "/api/v1/notifications", TF)).json.data.notifications;
    check("notifications record the approval pause", notes.length >= 1, notes.length + " notification(s)");
    check("notifications can be marked read", (await req("PATCH", "/api/v1/notifications/read", TF)).status === 200, "HTTP 200");
    const detail1 = (await req("GET", "/api/v1/runs/" + run1.json.data.run.id, TF)).json.data;
    check("run detail breakdown reconciles: trace cost sum equals the run total",
      detail1.breakdown.costsReconcile === true && detail1.breakdown.traceCostSum === 20 && detail1.breakdown.tracedSteps === 3,
      "sum=" + detail1.breakdown.traceCostSum);
  } catch (e) { failed++; console.log("FAIL  unexpected error - " + e.message + "\n" + e.stack); }
  finally { server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
