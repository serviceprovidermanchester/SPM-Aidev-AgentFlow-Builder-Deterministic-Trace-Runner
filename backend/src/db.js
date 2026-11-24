"use strict";
// Database layer — SQLite via built-in node:sqlite. Schema also lives in
// ../../database/schema.sql (mirrored here so the server is self-contained).
// One project (workspace) per owner account; every domain row is scoped by
// project_id and reads for another project's data return 404.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "data", "agentflow.sqlite");
let db;
function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}
function migrate(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, team TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS project_settings (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    max_steps INTEGER NOT NULL DEFAULT 12, budget_cap INTEGER NOT NULL DEFAULT 100,
    blocked_tools TEXT NOT NULL DEFAULT '', notify_on_halt INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS tools (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', input_contract TEXT NOT NULL DEFAULT '',
    output_contract TEXT NOT NULL DEFAULT '', default_cost INTEGER NOT NULL DEFAULT 0,
    base_ms INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS knowledge_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (project_id, key));
  CREATE TABLE IF NOT EXISTS workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS workflow_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, tool_code TEXT NOT NULL DEFAULT '',
    step_type TEXT NOT NULL DEFAULT 'normal' CHECK (step_type IN ('normal','approval')),
    config_json TEXT NOT NULL DEFAULT '{}', cost INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'completed'
      CHECK (status IN ('running','completed','halted_guardrail','awaiting_approval','failed')),
    input_text TEXT NOT NULL DEFAULT '', final_output TEXT NOT NULL DEFAULT '',
    steps_executed INTEGER NOT NULL DEFAULT 0, total_cost INTEGER NOT NULL DEFAULT 0,
    halt_reason TEXT NOT NULL DEFAULT '', halted_step_index INTEGER,
    pending_step_index INTEGER, prev_output TEXT NOT NULL DEFAULT '',
    triggered_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL, step_name TEXT NOT NULL DEFAULT '', tool_code TEXT NOT NULL DEFAULT '',
    step_type TEXT NOT NULL DEFAULT 'normal', input_text TEXT NOT NULL DEFAULT '',
    output_text TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    cost INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed'
      CHECK (status IN ('completed','halted_guardrail','awaiting_approval','failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id, id);
  CREATE INDEX IF NOT EXISTS idx_steps_workflow ON workflow_steps(workflow_id, position);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, id);
  CREATE INDEX IF NOT EXISTS idx_trace_run ON run_steps(run_id, step_index);
  CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_entries(project_id, key);
  `);
}
module.exports = { getDb, DB_PATH };
