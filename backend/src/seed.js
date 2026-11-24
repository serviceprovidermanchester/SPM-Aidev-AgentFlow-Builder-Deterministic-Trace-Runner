"use strict";
// Seeds AgentFlow on first start (idempotent): the 6-tool registry, the
// showcase workspace (ConnectNorth Support Operations, Northern Quarter),
// its owner and staff accounts, 8 knowledge entries, 4 workflows with
// their steps, three seeded runs produced by the real engine (two
// completed, one paused at its approval step), a summary report and
// notifications. createProject() is also used by registration, so a new
// account gets its own empty workspace with default guardrail settings.
const { getDb } = require("./db");
const { PRODUCT, PROJECT, KNOWLEDGE, WORKFLOWS } = require("./seed-data");
const { TOOLS, runWorkflow } = require("./ai/engine");
const { hashPassword, refCode } = require("./utils/tokens");

function slugify(s) {
  return String(s || "my-workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-workspace";
}
function uniqueSlug(db, base) {
  let slug = base, n = 2;
  while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) slug = base + "-" + (n++);
  return slug;
}
function seedTools(db) {
  TOOLS.forEach((t, i) => {
    db.prepare(`INSERT OR IGNORE INTO tools (code, name, category, description, input_contract, output_contract, default_cost, base_ms, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.code, t.name, t.category, t.description, t.inputContract, t.outputContract, t.defaultCost, t.baseMs, i);
  });
}
function createProject(db, ownerUserId, fields) {
  const info = db.prepare(`INSERT INTO projects (owner_user_id, name, slug, team, sector, location)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ownerUserId, fields.name, uniqueSlug(db, slugify(fields.slug || fields.name)),
      fields.team || "", fields.sector || "", fields.location || "");
  const projectId = info.lastInsertRowid;
  db.prepare("UPDATE users SET project_id = ? WHERE id = ?").run(projectId, ownerUserId);
  db.prepare("INSERT INTO project_settings (project_id) VALUES (?)").run(projectId);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
}
function getSettings(db, projectId) {
  const s = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get(projectId)
    || { max_steps: 12, budget_cap: 100, blocked_tools: "", notify_on_halt: 1 };
  return { maxSteps: s.max_steps, budgetCap: s.budget_cap,
    blockedTools: String(s.blocked_tools || "").split(",").map((x) => x.trim()).filter(Boolean),
    notifyOnHalt: !!s.notify_on_halt };
}
function knowledgeMap(db, projectId) {
  const map = {};
  for (const r of db.prepare("SELECT key, value FROM knowledge_entries WHERE project_id = ?").all(projectId)) map[r.key] = r.value;
  return map;
}
function workflowSteps(db, workflowId) {
  return db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY position, id").all(workflowId)
    .map((s) => { let config = {}; try { config = JSON.parse(s.config_json || "{}"); } catch { config = {}; }
      return { id: s.id, name: s.name, toolCode: s.tool_code, stepType: s.step_type, config, cost: s.cost }; });
}
function insertTrace(db, runId, trace) {
  const ins = db.prepare(`INSERT INTO run_steps (run_id, step_index, step_name, tool_code, step_type, input_text, output_text, detail, cost, duration_ms, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const t of trace) ins.run(runId, t.stepIndex, t.stepName, t.toolCode, t.stepType, t.input, t.output, t.detail, t.cost, t.durationMs, t.status);
}
// Start a run of a workflow and persist the run + its trace. Shared by the
// seed and POST /api/v1/runs. The engine does the execution; this helper
// only stores what it returns.
function startRun(db, project, workflow, inputText, triggeredBy) {
  const reference = refCode("RUN");
  const info = db.prepare(`INSERT INTO runs (project_id, workflow_id, reference, status, input_text, triggered_by)
    VALUES (?, ?, ?, 'running', ?, ?)`)
    .run(project.id, workflow.id, reference, String(inputText ?? ""), triggeredBy || "");
  const runId = info.lastInsertRowid;
  const settings = getSettings(db, project.id);
  const result = runWorkflow(workflowSteps(db, workflow.id), {
    input: String(inputText ?? ""), knowledge: knowledgeMap(db, project.id),
    maxSteps: settings.maxSteps, budgetCap: settings.budgetCap, blockedTools: settings.blockedTools });
  insertTrace(db, runId, result.trace);
  db.prepare(`UPDATE runs SET status = ?, final_output = ?, steps_executed = ?, total_cost = ?,
      halt_reason = ?, halted_step_index = ?, pending_step_index = ?, prev_output = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(result.status, result.finalOutput, result.stepsExecuted, result.spent,
      result.haltReason || "", result.haltedStepIndex, result.pendingStepIndex, result.prev, runId);
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
}
// Approve the pending approval step of a paused run and resume it. The
// approval trace row is updated in place; the engine continues from the
// pending step with the stored prev output and spend.
function approveRun(db, project, run, approverName) {
  const pending = run.pending_step_index;
  const settings = getSettings(db, project.id);
  const result = runWorkflow(workflowSteps(db, run.workflow_id), {
    input: run.input_text, knowledge: knowledgeMap(db, project.id),
    maxSteps: settings.maxSteps, budgetCap: settings.budgetCap, blockedTools: settings.blockedTools,
    startIndex: pending, approveIndex: pending,
    initialPrev: run.prev_output, initialSpent: run.total_cost, executedSoFar: run.steps_executed });
  for (const t of result.trace) {
    if (t.stepIndex === pending && t.stepType === "approval") {
      db.prepare(`UPDATE run_steps SET status = ?, output_text = ?, detail = ?, duration_ms = ?
        WHERE run_id = ? AND step_index = ?`)
        .run(t.status, t.output, "approved by " + (approverName || "") + "; run resumed", t.durationMs, run.id, pending);
    } else {
      db.prepare(`INSERT INTO run_steps (run_id, step_index, step_name, tool_code, step_type, input_text, output_text, detail, cost, duration_ms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(run.id, t.stepIndex, t.stepName, t.toolCode, t.stepType, t.input, t.output, t.detail, t.cost, t.durationMs, t.status);
    }
  }
  db.prepare(`UPDATE runs SET status = ?, final_output = ?, steps_executed = ?, total_cost = ?,
      halt_reason = ?, halted_step_index = ?, pending_step_index = ?, prev_output = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(result.status, result.finalOutput, result.stepsExecuted, result.spent,
      result.haltReason || "", result.haltedStepIndex, result.pendingStepIndex, result.prev, run.id);
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(run.id);
}
function insertWorkflow(db, projectId, w, createdBy) {
  const info = db.prepare(`INSERT INTO workflows (project_id, name, description, status, created_by)
    VALUES (?, ?, ?, 'active', ?)`)
    .run(projectId, w.name, w.description || "", createdBy || "");
  const wid = info.lastInsertRowid;
  (w.steps || []).forEach((s, i) => {
    db.prepare(`INSERT INTO workflow_steps (workflow_id, position, name, tool_code, step_type, config_json, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(wid, i, s[0] ?? s.name, s[1] ?? s.toolCode ?? "", s[2] ?? s.stepType ?? "normal",
        JSON.stringify(s[3] ?? s.config ?? {}), s[4] ?? s.cost ?? 0);
  });
  return db.prepare("SELECT * FROM workflows WHERE id = ?").get(wid);
}
function seed() {
  const db = getDb();
  seedTools(db);
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return;
  const owner = db.prepare("INSERT INTO users (full_name, email, role, password_hash) VALUES (?, ?, 'owner', ?)")
    .run(PRODUCT.ownerName, PRODUCT.ownerEmail, hashPassword(PRODUCT.ownerPassword));
  const ownerId = owner.lastInsertRowid;
  const project = createProject(db, ownerId, PROJECT);
  const pid = project.id;
  db.prepare("INSERT INTO users (full_name, email, role, project_id, password_hash) VALUES (?, ?, 'staff', ?, ?)")
    .run(PRODUCT.staffName, PRODUCT.staffEmail, pid, hashPassword(PRODUCT.staffPassword));
  for (const [key, value, category] of KNOWLEDGE)
    db.prepare("INSERT INTO knowledge_entries (project_id, key, value, category) VALUES (?, ?, ?, ?)").run(pid, key, value, category);
  const created = WORKFLOWS.map((w) => insertWorkflow(db, pid, w, PRODUCT.ownerName));
  // Seeded runs are produced by the real engine over the seeded workflows.
  const runs = created.map((wf, i) => startRun(db, project, wf, WORKFLOWS[i].seededInput, PRODUCT.ownerName));
  const completed = runs.filter((r) => r.status === "completed");
  const totalSpent = runs.reduce((a, r) => a + r.total_cost, 0);
  db.prepare(`INSERT INTO reports (project_id, run_id, reference, title, summary, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(pid, completed[0] ? completed[0].id : null, refCode("RPT"),
      "Workflow run summary — " + PROJECT.name,
      completed.length + " of " + runs.length + " seeded runs completed; 1 run is awaiting approval at its supervisor step. " +
      "Total seeded spend " + totalSpent + " credits across " + runs.reduce((a, r) => a + r.steps_executed, 0) +
      " executed steps. Canonical workflow \"Install Quote Builder\" finished with output \"Total for 2 replacement routers: £90.\" at a cost of 20 credits.",
      PRODUCT.ownerName);
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'approval', ?, ?)")
    .run(ownerId, "Run " + runs[3].reference + " is awaiting approval",
      "\"Escalation Summary with Approval\" paused at step 2 (Supervisor approval) after spending " + runs[3].total_cost + " credits.");
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'system', ?, ?)")
    .run(ownerId, "Welcome to AgentFlow", "Your ConnectNorth workspace ships with 4 workflows, 8 knowledge entries and a 6-tool registry.");
}
module.exports = { seed, createProject, slugify, getSettings, knowledgeMap, workflowSteps, startRun, approveRun, insertWorkflow, seedTools };
