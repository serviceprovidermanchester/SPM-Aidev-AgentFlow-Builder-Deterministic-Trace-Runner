# AgentFlow Database Architecture

Maintained by **SPManchester Private Limited** (https://spmanchester.com/)  
Author: **Sayed Mudassar Akbar** (info@spmanchester.com)

SQLite database accessed through Node's built-in `node:sqlite` module — no
external driver. `schema.sql` documents the 12 tables; the same DDL is
mirrored in `backend/src/db.js` so the server creates and migrates the
database itself on first start. `seed.sql` summarises the seeded dataset;
the executable seed lives in `backend/src/seed.js` + `seed-data.js`.

Tables: `users`, `sessions`, `projects`, `project_settings`, `tools`,
`knowledge_entries`, `workflows`, `workflow_steps`, `runs`, `run_steps`,
`reports`, `notifications`. Every domain row is scoped by `project_id`;
reads for another project's rows return 404. A run's full trace lives in
`run_steps` (one row per step, in `step_index` order), and a paused run
keeps its resume state on the `runs` row (`pending_step_index`,
`prev_output`, `total_cost`).

Default location: `backend/data/agentflow.sqlite` (override with the
`DB_PATH` environment variable — the test harness uses a fresh temporary
database per run).
