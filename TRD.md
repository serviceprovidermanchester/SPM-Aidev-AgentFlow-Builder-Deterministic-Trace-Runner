# AgentFlow — Technical Requirements Document

**Enterprise AI Architecture Specification**  
**Maintained by:** SPManchester Private Limited (https://spmanchester.com/)  
**Author:** Sayed Mudassar Akbar (info@spmanchester.com)  

## 1. Architecture (zero → high level)

- **Zero level:** one Node.js process (`backend/src/server.js`) serving a
  JSON API under `/api/v1/…`, a health endpoint, and the static web
  console at `/`. Storage is one SQLite file via the built-in
  `node:sqlite`. No external dependencies, no network calls, no API keys.
- **Module level:** `app.js` is an explicit router over `node:http`
  (patterns with `:params`, middleware chain). Routes live in
  `src/routes/` (`auth.js`, `workflows.js`, `misc.js`). All workflow
  execution logic lives in `src/ai/engine.js` as pure functions;
  `src/seed.js` owns persistence of runs/traces (shared by the seed and
  the API) so there is exactly one execution path.
- **High level:** a workspace (project) owns knowledge entries, workflows
  (with steps), runs (with trace rows) and reports. Guardrail settings
  live on the workspace and are read at run start and at resume. The
  console is a dependency-free SPA (hash routing, `fetch`) with 10 views.

## 2. Module map

| Module | Responsibility |
|---|---|
| `backend/src/server.js` | HTTP server bootstrap (PORT/HOST), signal handling |
| `backend/src/app.js` | Router, body parsing, `/health`, static serving of `web/` |
| `backend/src/db.js` | SQLite open + schema (mirrors `database/schema.sql`) |
| `backend/src/seed-data.js` | Product identity, showcase project, knowledge entries, workflow definitions |
| `backend/src/seed.js` | Idempotent seed; `createProject`, `getSettings`, `workflowSteps`, `startRun`, `approveRun`, `insertWorkflow` |
| `backend/src/ai/engine.js` | Tool registry + contracts, safe calculator, tool executors, deterministic runner with guardrails |
| `backend/src/middleware/auth.js` | Bearer-session loading, `requireAuth` / `requireOwner`, `myProject` |
| `backend/src/middleware/errors.js` | Error → JSON mapping (status/code, UNIQUE → 409) |
| `backend/src/middleware/validate.js` | `requireFields` |
| `backend/src/routes/auth.js` | Register / login / logout / profile (5 endpoints) |
| `backend/src/routes/workflows.js` | Tools, knowledge, workflows, steps, runs, approve (14 endpoints) |
| `backend/src/routes/misc.js` | Project + guardrails, dashboard, reports, notifications (7 endpoints) |
| `backend/src/utils/respond.js` | JSON envelope `{ data }` / `{ error }`, static file serving |
| `backend/src/utils/tokens.js` | Session tokens, reference codes, scrypt password hashing |

## 3. Algorithms — exactly as implemented

### 3.1 Tools and contracts

| Tool | Input contract | Output contract | Default cost | Base ms |
|---|---|---|---|---|
| `calculator` | expression string, e.g. `"{prev} * 3"`, `"(10 + 5) / 3"` | numeric result as a string, rounded to 4dp | 10 | 12 |
| `lookup` | knowledge key (`config.key`) | stored value as a string | 5 | 8 |
| `text_format` | text; `config.operation` ∈ uppercase/lowercase/title/trim | formatted text | 4 | 5 |
| `word_count` | text | whitespace-separated word count as a string | 6 | 7 |
| `date_add` | `YYYY-MM-DD` date; `config.days` signed integer | resulting `YYYY-MM-DD` date (UTC) | 8 | 9 |
| `template` | `config.template` with `{prev}` / `{input}` | filled template | 5 | 6 |

Step input resolution: `config.source` is `prev` (default after the
first step), `input` (default for the first step) or `literal`
(`config.literal`). Calculator substitutes `{prev}` / `{input}` into the
expression before parsing; template substitutes both into the template
and fails on any other `{placeholder}`.

### 3.2 Calculator

Tokeniser accepts digits, `.`, `+ - * / % ( )` and whitespace only —
anything else throws `Character not allowed in expression`. A
recursive-descent parser implements the usual precedence
(`*` `/` `%` over `+` `-`), parentheses and unary minus. Division or
modulo by zero throws. Results are formatted by
`round(n × 10000) / 10000` with trailing zeros trimmed (`2.5`, `90`,
`0.3333`). There is no `eval()` anywhere in the codebase.

### 3.3 Runner and guardrails

`runWorkflow(steps, opts)` walks steps from `startIndex` with context
`{ input, prev }` and returns `{ status, trace, spent, stepsExecuted,
prev, finalOutput, haltReason, haltedStepIndex, pendingStepIndex }`.
Before each step, in order:

1. **Max steps:** `stepsExecuted >= maxSteps` → halt
   (`halted_guardrail`, reason `max_steps`, halted index = current step).
2. **Approval:** an approval step pauses (`awaiting_approval`, pending
   index = current step) unless `approveIndex` equals the current index
   (a resumed approval: trace entry completes with output `Approved`,
   cost 0, duration 2ms, and counts as an executed step).
3. **Blocked tool:** step's tool ∈ workspace blocked list → halt
   (reason `blocked_tool`).
4. **Budget:** `spent + stepCost > budgetCap` → halt (reason
   `budget_cap`); spend is unchanged.

A halt appends a final trace entry with status `halted_guardrail` and a
detail naming the guardrail and the numbers behind it. A step that
throws ends the run as `failed` with the error in the trace detail and
is not charged. A completing step is charged its cost, sets `prev` to
its output, and traces `durationMs = tool.baseMs + resolvedInput.length`.

Resume (`approveRun` in `seed.js`) re-invokes the runner with
`startIndex = approveIndex = pendingStepIndex`, `initialPrev` and
`initialSpent` from the stored run row, and `executedSoFar` from the
run; the approval trace row is updated in place, later steps append.

### 3.4 Worked fixture (canonical)

Knowledge `router_replacement = "45"`; steps lookup (5) → calculator
`{prev} * 2` (10) → template `Total for 2 replacement routers: £{prev}.`
(5). Trace: inputs `router_replacement` / `45 * 2` / `90`, outputs
`45` / `90` / `Total for 2 replacement routers: £90.`, durations
8+18=26 / 12+6=18 / 6+2=8, total cost 20.

## 4. Data model (12 tables)

| Table | Purpose |
|---|---|
| `users` | Accounts (owner/staff), scrypt password hash, `project_id` |
| `sessions` | Bearer tokens with expiry |
| `projects` | Workspaces (name, slug, team, sector, location) |
| `project_settings` | Guardrails per workspace: `max_steps`, `budget_cap`, `blocked_tools` (CSV), `notify_on_halt` |
| `tools` | The 6-tool registry with contracts (seeded from the engine) |
| `knowledge_entries` | Workspace knowledge table, `UNIQUE(project_id, key)` |
| `workflows` | Workflow headers (status draft/active/archived) |
| `workflow_steps` | Ordered steps: position, tool, type, `config_json`, cost |
| `runs` | Run records incl. resume state (`pending_step_index`, `prev_output`) and halt fields |
| `run_steps` | Trace rows, one per attempted step, in `step_index` order |
| `reports` | Generated run summaries |
| `notifications` | Per-user notifications (approval pauses, guardrail halts) |

All domain reads are scoped by `project_id`; another workspace's rows
return 404.

## 5. Endpoint inventory (26 + `GET /health`)

Auth (5): `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
`GET /auth/me`, `PUT /auth/me`. Project/dashboard (3): `GET /project`,
`PUT /project` (owner-only), `GET /dashboard`. Tools (2): `GET /tools`,
`GET /tools/:code`. Knowledge (2): `GET /knowledge`, `POST /knowledge`.
Workflows (6): `GET /workflows`, `POST /workflows`,
`GET /workflows/:id`, `PUT /workflows/:id`,
`POST /workflows/:id/steps`, `DELETE /workflows/:id/steps/:stepId`.
Runs (4): `GET /runs`, `POST /runs`, `GET /runs/:id`,
`POST /runs/:id/approve`. Reports (2): `GET /reports`, `POST /reports`.
Notifications (2): `GET /notifications`, `PATCH /notifications/read`.
All under `/api/v1`; success envelope `{ data }`, errors
`{ error: { code, message } }`.

## 6. File inventory (40 files)

```
README.md  PRD.md  TRD.md  VERIFICATION.md  PROJECT-DETAILS.md
backend/README.md  backend/package.json
backend/src/server.js  backend/src/app.js  backend/src/db.js
backend/src/seed-data.js  backend/src/seed.js
backend/src/ai/engine.js
backend/src/middleware/auth.js  backend/src/middleware/errors.js  backend/src/middleware/validate.js
backend/src/routes/auth.js  backend/src/routes/workflows.js  backend/src/routes/misc.js
backend/src/utils/respond.js  backend/src/utils/tokens.js
database/README.md  database/schema.sql  database/seed.sql
web/index.html  web/app.js  web/styles.css
tests/run-tests.js
preview/make_screenshots.py  preview/shot-config.json
screenshots/01-dashboard.png … 10-reports-help.png  (10 PNGs, 1440×900)
```

## 7. Testing approach

`tests/run-tests.js` boots the real server on a fresh temporary SQLite
database (unique temp dir per run, deleted afterwards) and drives the
product over HTTP: 50 checks covering the seeded workspace's exact
values, auth/roles/scoping, builder CRUD, failure modes, and 22 labelled
expected-output cases (AF-S1…AF-S3, AF-01…AF-19) whose expected values
are literal hand-computed results written into the test file (quote
strings, arithmetic results, dates, halt indices, spends). Screenshots
are rendered by `preview/make_screenshots.py` (PIL, 1440×900) from
`preview/shot-config.json`, whose figures are the seeded engine's real
outputs. `node --check` must pass on every JS file.

## 8. Production notes

The local tools are deterministic functions at a documented seam: a
production engagement replaces tool implementations (hosted model calls
via OpenAI / Anthropic / Google / Azure OpenAI, CRM and ticketing
integrations) without changing workflow definitions, traces or
guardrails, and swaps seeded step costs for measured token/tool costs.
The runner's interfaces (`runWorkflow` options, trace entry shape) are
the contract those integrations code against. Guardrail semantics
(order, halt reasons, spend preservation) should be kept identical so
existing run records stay interpretable.
