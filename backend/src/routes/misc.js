"use strict";
// Dashboard, project profile + guardrail settings, reports, notifications.
const { getDb } = require("../db");
const { ok, fail } = require("../utils/respond");
const { requireAuth, requireOwner, myProject } = require("../middleware/auth");
const { refCode } = require("../utils/tokens");
const { TOOL_BY_CODE } = require("../ai/engine");
const { getSettings } = require("../seed");
const { runShape } = require("./workflows");

const projectShape = (db, p) => {
  const s = getSettings(db, p.id);
  return { id: p.id, name: p.name, slug: p.slug, team: p.team, sector: p.sector, location: p.location,
    settings: { maxSteps: s.maxSteps, budgetCap: s.budgetCap, blockedTools: s.blockedTools, notifyOnHalt: s.notifyOnHalt } };
};
const reportShape = (r) => ({ id: r.id, runId: r.run_id, reference: r.reference, title: r.title,
  summary: r.summary, createdBy: r.created_by, createdAt: r.created_at });

module.exports = [
  // ---- Project profile & guardrail settings ----
  ["GET", "/api/v1/project", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    return ok(res, { project: projectShape(getDb(), p) });
  }],
  ["PUT", "/api/v1/project", requireOwner, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    db.prepare("UPDATE projects SET name = ?, team = ?, sector = ?, location = ? WHERE id = ?")
      .run(req.body.name ?? p.name, req.body.team ?? p.team, req.body.sector ?? p.sector, req.body.location ?? p.location, p.id);
    if (req.body.settings) {
      const cur = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get(p.id);
      const s = req.body.settings;
      const maxSteps = s.maxSteps !== undefined ? Math.max(1, Math.min(50, Number(s.maxSteps) || cur.max_steps)) : cur.max_steps;
      const budgetCap = s.budgetCap !== undefined ? Math.max(0, Number(s.budgetCap) || 0) : cur.budget_cap;
      let blocked = cur.blocked_tools;
      if (s.blockedTools !== undefined) {
        const list = Array.isArray(s.blockedTools) ? s.blockedTools : String(s.blockedTools).split(",").map((x) => x.trim()).filter(Boolean);
        for (const code of list) if (!TOOL_BY_CODE[code]) return fail(res, 400, "BAD_TOOL", "Unknown tool in blocked list: " + code);
        blocked = list.join(",");
      }
      db.prepare("UPDATE project_settings SET max_steps = ?, budget_cap = ?, blocked_tools = ?, notify_on_halt = ? WHERE project_id = ?")
        .run(maxSteps, budgetCap, blocked, s.notifyOnHalt !== undefined ? (s.notifyOnHalt ? 1 : 0) : cur.notify_on_halt, p.id);
    }
    return ok(res, { project: projectShape(db, db.prepare("SELECT * FROM projects WHERE id = ?").get(p.id)) });
  }],
  // ---- Dashboard ----
  ["GET", "/api/v1/dashboard", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    const byStatus = { completed: 0, halted_guardrail: 0, awaiting_approval: 0, failed: 0 };
    for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM runs WHERE project_id = ? GROUP BY status").all(p.id))
      if (r.status in byStatus) byStatus[r.status] = r.n;
    const totalCost = db.prepare("SELECT COALESCE(SUM(total_cost),0) AS s FROM runs WHERE project_id = ?").get(p.id).s;
    const recent = db.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 5").all(p.id);
    const names = {};
    for (const w of db.prepare("SELECT id, name FROM workflows WHERE project_id = ?").all(p.id)) names[w.id] = w.name;
    return ok(res, { project: projectShape(db, p),
      stats: { workflows: db.prepare("SELECT COUNT(*) AS n FROM workflows WHERE project_id = ?").get(p.id).n,
        tools: db.prepare("SELECT COUNT(*) AS n FROM tools").get().n,
        knowledgeEntries: db.prepare("SELECT COUNT(*) AS n FROM knowledge_entries WHERE project_id = ?").get(p.id).n,
        runs: db.prepare("SELECT COUNT(*) AS n FROM runs WHERE project_id = ?").get(p.id).n,
        reports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE project_id = ?").get(p.id).n,
        totalCost, awaitingApproval: byStatus.awaiting_approval },
      runsByStatus: byStatus,
      recentRuns: recent.map((r) => Object.assign(runShape(r), { workflowName: names[r.workflow_id] || "" })) });
  }],
  // ---- Reports ----
  ["GET", "/api/v1/reports", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const rows = getDb().prepare("SELECT * FROM reports WHERE project_id = ? ORDER BY id DESC").all(p.id);
    return ok(res, { reports: rows.map(reportShape) });
  }],
  ["POST", "/api/v1/reports", requireAuth, async (req, res) => {
    const p = myProject(req); if (!p) return fail(res, 404, "NO_PROJECT", "No workspace is attached to this account");
    const db = getDb();
    let run = null;
    if (req.body && req.body.runId) {
      run = db.prepare("SELECT * FROM runs WHERE id = ? AND project_id = ?").get(Number(req.body.runId), p.id);
      if (!run) return fail(res, 404, "RUN_NOT_FOUND", "Run not found");
    } else {
      run = db.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(p.id);
      if (!run) return fail(res, 404, "NO_RUN", "No run exists for this workspace yet");
    }
    const w = db.prepare("SELECT * FROM workflows WHERE id = ?").get(run.workflow_id);
    const trace = db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index").all(run.id);
    const summary = "Run " + run.reference + " of \"" + (w ? w.name : "workflow") + "\" finished with status " + run.status +
      ": " + run.steps_executed + " step(s) executed, " + trace.length + " trace entries, total cost " + run.total_cost + " credits" +
      (run.status === "halted_guardrail" ? ", halted by guardrail \"" + run.halt_reason + "\" at step index " + run.halted_step_index : "") +
      (run.status === "awaiting_approval" ? ", awaiting approval at step index " + run.pending_step_index : "") +
      ". Final output: " + (run.final_output ? "\"" + run.final_output + "\"" : "(none yet)") + ".";
    const info = db.prepare(`INSERT INTO reports (project_id, run_id, reference, title, summary, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(p.id, run.id, refCode("RPT"), req.body.title || ("Run report — " + run.reference), summary, req.user.full_name);
    return ok(res, { report: reportShape(db.prepare("SELECT * FROM reports WHERE id = ?").get(info.lastInsertRowid)) }, 201);
  }],
  // ---- Notifications ----
  ["GET", "/api/v1/notifications", requireAuth, async (req, res) =>
    ok(res, { notifications: getDb().prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.user.id) })],
  ["PATCH", "/api/v1/notifications/read", requireAuth, async (req, res) => {
    getDb().prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
    return ok(res, { markedRead: true });
  }],
];
