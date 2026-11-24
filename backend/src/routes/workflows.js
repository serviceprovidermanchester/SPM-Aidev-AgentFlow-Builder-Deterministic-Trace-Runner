"use strict";
// Tool registry, knowledge table, workflow builder and the trace runner.
const { getDb } = require("../db");
const { ok, fail } = require("../utils/respond");
const { requireAuth } = require("../middleware/auth");
const { requireFields } = require("../middleware/validate");
const { TOOL_BY_CODE } = require("../ai/engine");
const { workflowSteps, startRun, approveRun, insertWorkflow } = require("../seed");
const { myProject } = require("../middleware/auth");

const toolShape = (t) => ({ code: t.code, name: t.name, category: t.category, description: t.description,
  inputContract: t.input_contract, outputContract: t.output_contract, defaultCost: t.default_cost, baseMs: t.base_ms });
const knowledgeShape = (k) => ({ id: k.id, key: k.key, value: k.value, category: k.category, createdAt: k.created_at });
const stepShape = (s) => { let config = {}; try { config = JSON.parse(s.config_json || "{}"); } catch { config = {}; }
  return { id: s.id, position: s.position, name: s.name, toolCode: s.tool_code, stepType: s.step_type, config, cost: s.cost }; };
const workflowShape = (db, w) => ({ id: w.id, name: w.name, description: w.description, status: w.status,
  createdBy: w.created_by, createdAt: w.created_at, updatedAt: w.updated_at,
  steps: db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY position, id").all(w.id).map(stepShape) });
const runShape = (r) => ({ id: r.id, workflowId: r.workflow_id, reference: r.reference, status: r.status,
  input: r.input_text, finalOutput: r.final_output, stepsExecuted: r.steps_executed, totalCost: r.total_cost,
  haltReason: r.halt_reason, haltedStepIndex: r.halted_step_index, pendingStepIndex: r.pending_step_index,
  triggeredBy: r.triggered_by, createdAt: r.created_at, updatedAt: r.updated_at });
const traceShape = (t) => ({ id: t.id, stepIndex: t.step_index, stepName: t.step_name, toolCode: t.tool_code,
  stepType: t.step_type, input: t.input_text, output: t.output_text, detail: t.detail,
  cost: t.cost, durationMs: t.duration_ms, status: t.status });

function validateSteps(steps) {
  if (!Array.isArray(steps)) return "steps must be an array";
  for (const s of steps) {
    const type = s.stepType || "normal";
    if (type !== "normal" && type !== "approval") return "stepType must be normal or approval";
    if (type === "normal" && !TOOL_BY_CODE[s.toolCode]) return "Unknown tool: " + (s.toolCode || "(missing)");
    if (s.name !== undefined && String(s.name).trim() === "") return "step name must not be empty";
  }
  return null;
}
function myWorkflow(db, project, id) {
  return db.prepare("SELECT * FROM workflows WHERE id = ? AND project_id = ?").get(Number(id), project.id) || null;
}

module.exports = [
  // ---- Tool registry ----
  ["GET", "/api/v1/tools", requireAuth, async (req, res) => {
    const rows = getDb().prepare("SELECT * FROM tools ORDER BY sort_order").all();
    return ok(res, { tools: rows.map(toolShape) });
  }],
  ["GET", "/api/v1/tools/:code", requireAuth, async (req, res, params) => {
    const t = getDb().prepare("SELECT * FROM tools WHERE code = ?").get(params.code);
    if (!t) return fail(res, 404, "TOOL_NOT_FOUND", "Tool not found");
    return ok(res, { tool: toolShape(t) });
  }],
  // ---- Knowledge table ----
  ["GET", "/api/v1/knowledge", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const rows = getDb().prepare("SELECT * FROM knowledge_entries WHERE project_id = ? ORDER BY key").all(p.id);
    return ok(res, { entries: rows.map(knowledgeShape) });
  }],
  ["POST", "/api/v1/knowledge", requireAuth, async (req, res) => {
    requireFields(req.body, ["key", "value"]);
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    if (db.prepare("SELECT id FROM knowledge_entries WHERE project_id = ? AND key = ?").get(p.id, String(req.body.key)))
      return fail(res, 409, "KEY_EXISTS", "A knowledge entry with that key already exists");
    const info = db.prepare("INSERT INTO knowledge_entries (project_id, key, value, category) VALUES (?, ?, ?, ?)")
      .run(p.id, String(req.body.key), String(req.body.value), req.body.category || "");
    return ok(res, { entry: knowledgeShape(db.prepare("SELECT * FROM knowledge_entries WHERE id = ?").get(info.lastInsertRowid)) }, 201);
  }],
  // ---- Workflows ----
  ["GET", "/api/v1/workflows", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const rows = db.prepare("SELECT * FROM workflows WHERE project_id = ? ORDER BY id").all(p.id);
    return ok(res, { workflows: rows.map((w) => workflowShape(db, w)) });
  }],
  ["POST", "/api/v1/workflows", requireAuth, async (req, res) => {
    requireFields(req.body, ["name"]);
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const steps = req.body.steps || [];
    const err = validateSteps(steps);
    if (err) return fail(res, 400, "BAD_STEP", err);
    const db = getDb();
    const norm = steps.map((s) => ({ name: s.name || (s.stepType === "approval" ? "Approval" : (TOOL_BY_CODE[s.toolCode] || {}).name || "Step"),
      toolCode: s.stepType === "approval" ? "" : s.toolCode, stepType: s.stepType || "normal",
      config: s.config || {}, cost: s.cost !== undefined ? Math.max(0, Number(s.cost) || 0)
        : (s.stepType === "approval" ? 0 : (TOOL_BY_CODE[s.toolCode] || {}).defaultCost || 0) }));
    const w = insertWorkflow(db, p.id, { name: req.body.name, description: req.body.description || "", steps: norm }, req.user.full_name);
    return ok(res, { workflow: workflowShape(db, w) }, 201);
  }],
  ["GET", "/api/v1/workflows/:id", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const w = myWorkflow(db, p, params.id);
    if (!w) return fail(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    return ok(res, { workflow: workflowShape(db, w) });
  }],
  ["PUT", "/api/v1/workflows/:id", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const w = myWorkflow(db, p, params.id);
    if (!w) return fail(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    if (req.body.status !== undefined && !["draft", "active", "archived"].includes(req.body.status))
      return fail(res, 400, "BAD_STATUS", "Status must be draft, active or archived");
    db.prepare("UPDATE workflows SET name = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(req.body.name ?? w.name, req.body.description ?? w.description, req.body.status ?? w.status, w.id);
    return ok(res, { workflow: workflowShape(db, db.prepare("SELECT * FROM workflows WHERE id = ?").get(w.id)) });
  }],
  ["POST", "/api/v1/workflows/:id/steps", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const w = myWorkflow(db, p, params.id);
    if (!w) return fail(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    const err = validateSteps([req.body]);
    if (err) return fail(res, 400, "BAD_STEP", err);
    const type = req.body.stepType || "normal";
    const pos = db.prepare("SELECT COUNT(*) AS n FROM workflow_steps WHERE workflow_id = ?").get(w.id).n;
    const toolCode = type === "approval" ? "" : req.body.toolCode;
    const info = db.prepare(`INSERT INTO workflow_steps (workflow_id, position, name, tool_code, step_type, config_json, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(w.id, pos, req.body.name || (type === "approval" ? "Approval" : (TOOL_BY_CODE[toolCode] || {}).name || "Step"),
        toolCode, type, JSON.stringify(req.body.config || {}),
        req.body.cost !== undefined ? Math.max(0, Number(req.body.cost) || 0)
          : (type === "approval" ? 0 : (TOOL_BY_CODE[toolCode] || {}).defaultCost || 0));
    db.prepare("UPDATE workflows SET updated_at = datetime('now') WHERE id = ?").run(w.id);
    return ok(res, { step: stepShape(db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(info.lastInsertRowid)),
      workflow: workflowShape(db, w) }, 201);
  }],
  ["DELETE", "/api/v1/workflows/:id/steps/:stepId", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const w = myWorkflow(db, p, params.id);
    if (!w) return fail(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    const step = db.prepare("SELECT * FROM workflow_steps WHERE id = ? AND workflow_id = ?").get(Number(params.stepId), w.id);
    if (!step) return fail(res, 404, "STEP_NOT_FOUND", "Step not found");
    db.prepare("DELETE FROM workflow_steps WHERE id = ?").run(step.id);
    db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY position, id").all(w.id)
      .forEach((s, i) => db.prepare("UPDATE workflow_steps SET position = ? WHERE id = ?").run(i, s.id));
    db.prepare("UPDATE workflows SET updated_at = datetime('now') WHERE id = ?").run(w.id);
    return ok(res, { deleted: true, workflow: workflowShape(db, db.prepare("SELECT * FROM workflows WHERE id = ?").get(w.id)) });
  }],
  // ---- Runs & traces ----
  ["GET", "/api/v1/runs", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    let rows = db.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC").all(p.id);
    if (req.query.workflowId) rows = rows.filter((r) => r.workflow_id === Number(req.query.workflowId));
    if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
    const names = {};
    for (const w of db.prepare("SELECT id, name FROM workflows WHERE project_id = ?").all(p.id)) names[w.id] = w.name;
    return ok(res, { runs: rows.map((r) => Object.assign(runShape(r), { workflowName: names[r.workflow_id] || "" })) });
  }],
  ["POST", "/api/v1/runs", requireAuth, async (req, res) => {
    requireFields(req.body, ["workflowId"]);
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const w = myWorkflow(db, p, req.body.workflowId);
    if (!w) return fail(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    if (!workflowSteps(db, w.id).length) return fail(res, 400, "NO_STEPS", "Workflow has no steps to run");
    const run = startRun(db, p, w, req.body.input ?? "", req.user.full_name);
    if (run.status === "awaiting_approval" || run.status === "halted_guardrail") {
      db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
        .run(req.user.id, run.status === "awaiting_approval" ? "approval" : "guardrail",
          "Run " + run.reference + (run.status === "awaiting_approval" ? " is awaiting approval" : " halted on a guardrail"),
          "\"" + w.name + "\" " + (run.status === "awaiting_approval"
            ? "paused at step " + ((run.pending_step_index ?? 0) + 1) + "."
            : "halted (" + run.halt_reason + ") at step " + ((run.halted_step_index ?? 0) + 1) + " after spending " + run.total_cost + " credits."));
    }
    const trace = db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index").all(run.id).map(traceShape);
    return ok(res, { run: Object.assign(runShape(run), { workflowName: w.name }), trace }, 201);
  }],
  ["GET", "/api/v1/runs/:id", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const run = db.prepare("SELECT * FROM runs WHERE id = ? AND project_id = ?").get(Number(params.id), p.id);
    if (!run) return fail(res, 404, "RUN_NOT_FOUND", "Run not found");
    const w = db.prepare("SELECT * FROM workflows WHERE id = ?").get(run.workflow_id);
    const trace = db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index").all(run.id).map(traceShape);
    const costCheck = trace.filter((t) => t.status === "completed").reduce((a, t) => a + t.cost, 0);
    return ok(res, { run: Object.assign(runShape(run), { workflowName: w ? w.name : "" }), trace,
      breakdown: { tracedSteps: trace.length, completedSteps: trace.filter((t) => t.status === "completed").length,
        traceCostSum: costCheck, totalCost: run.total_cost, costsReconcile: costCheck === run.total_cost,
        formula: "totalCost = Σ cost of completed trace steps" } });
  }],
  ["POST", "/api/v1/runs/:id/approve", requireAuth, async (req, res, params) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const run = db.prepare("SELECT * FROM runs WHERE id = ? AND project_id = ?").get(Number(params.id), p.id);
    if (!run) return fail(res, 404, "RUN_NOT_FOUND", "Run not found");
    if (run.status !== "awaiting_approval") return fail(res, 400, "NOT_AWAITING", "Run is not awaiting approval");
    const updated = approveRun(db, p, run, req.user.full_name);
    const trace = db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index").all(run.id).map(traceShape);
    return ok(res, { run: runShape(updated), trace });
  }],
];
module.exports.runShape = runShape;
module.exports.workflowShape = workflowShape;
