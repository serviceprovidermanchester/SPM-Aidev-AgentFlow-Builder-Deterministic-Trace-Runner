# AgentFlow — Verification

## Method

1. `node --check` on every JavaScript file (backend, web, tests) — all pass.
2. `node tests/run-tests.js` — boots the real server against a fresh
   temporary SQLite database (unique temp dir per run, deleted afterwards)
   and drives the full product over HTTP: seeded workspace, auth, roles,
   workspace scoping, builder CRUD, failure modes, and 22 labelled
   expected-output cases (AF-S1…AF-S3, AF-01…AF-19) whose expected values
   are literal hand-computed results in the test file, computed
   independently of the engine (the £100 quote chain written as
   25 × 4 with costs 5 + 10 + 5 = 20; the budget fixture written as
   30 + 30 spent under a cap of 65, halting at index 2).
3. `python3 preview/make_screenshots.py` — renders the 10 console views at
   1440×900 from the seeded figures; screenshots 01 (dashboard) and 08
   (trace) were visually inspected and their numbers checked against the
   live engine output (49 total credits, 4/6/8/4 stats, trace outputs
   45 → 90 → quote sentence, durations 26/18/8 ms, cost 20 — all match).
4. Counts verified from source: 26 `/api/v1` route registrations in
   `backend/src/routes/*.js` (+ `GET /health` in `app.js`), 12
   `CREATE TABLE` statements in `database/schema.sql`, 40 files total,
   10 views / 10 screenshots. A full-tree scan for the forbidden wording
   (the d-word, and the m/f words named in the build spec) returns no hits.

## Result

```
50 passed, 0 failed
```

## Key evidence (real values from the live run)

- Canonical seeded run (AF-S1): lookup `router_replacement` → `45`,
  calculator `45 * 2` → `90`, template → **"Total for 2 replacement
  routers: £90."**, total cost **20**, trace durations **26/18/8 ms**,
  trace costs reconcile with the run total.
- Seeded workspace totals: 4 workflows, 4 runs, **49 credits** spent,
  3 completed / 1 awaiting approval (the escalation run paused at step
  index 1 after 1 step and 6 credits, prev output "8").
- AF-01 independent fixture: knowledge 25 → ×4 → **"Total for 4 seat
  licences: £100."**, cost 20, durations 20/18/9.
- Guardrails: AF-11 budget — costs 30+30+30, cap 65 → **halted at index
  2, spent 60**; AF-12 max steps — 4-step workflow, limit 2 → halted at
  index 2, 2 executed, cost 2; AF-13 blocked calculator → halted at
  index 1, spent only 6.
- Approval (AF-14/AF-15): run pauses `awaiting_approval` at index 1,
  approving resumes it to **"Escalation note: 4 words checked."**,
  cost 11, 3 steps executed.
- Safety (AF-17/AF-18): `2 + process.exit()` fails with "Character not
  allowed in expression" (no eval anywhere); `10 / 0` fails with
  "Division by zero".
- Determinism (AF-19): re-running the canonical workflow reproduces the
  identical output, cost and duration sequence.
- Health on the seeded database: 1 project, 6 tools, 8 knowledge
  entries, 4 workflows, 4 runs.

## Test output (full PASS list)

```
PASS  health reports 1 project, 6 tools, 8 knowledge entries, 4 workflows - tools=6, knowledge=8
PASS  seeded owner can sign in - owner@connectnorth.co.uk
PASS  wrong password rejected - HTTP 401
PASS  workflows need sign-in - HTTP 401
PASS  seeded dashboard: 4 workflows, 4 runs, total spend 49, 3 completed / 1 awaiting approval - spend=49, runs=4
PASS  AF-S1 canonical seeded run: lookup 45 -> calculator 90 -> "Total for 2 replacement routers: £90.", cost 20, durations 26/18/8 - final=Total for 2 replacement routers: £90., cost=20
PASS  AF-S2 seeded refund run: 2026-03-01 + 14 days -> "Your refund deadline is 2026-03-15.", cost 13 - final=Your refund deadline is 2026-03-15.
PASS  AF-S3 seeded escalation run pauses at its approval step: awaiting_approval, pending index 1, 1 step executed, cost 6, prev "8" - status=awaiting_approval, pending=1
PASS  tool registry holds all 6 tools - calculator,lookup,text_format,word_count,date_add,template
PASS  calculator contract documents the expression input and 4dp output - expression: string, e.g. "{prev} * 3" or "(10 + 5) / 3"
PASS  unknown tool code is 404 - HTTP 404
PASS  knowledge table holds 8 entries and router_replacement = 45 - entries=8
PASS  seeded workflows list holds 4 workflows; the quote builder threads lookup -> calculator -> template - lookup,calculator,template
PASS  project profile carries the default guardrails (maxSteps 12, budgetCap 100, no blocked tools) - ConnectNorth Support Operations
PASS  staff cannot update the project profile or guardrails (owner only) - HTTP 403
PASS  register creates an owner with an empty workspace - 0 workflows
PASS  duplicate email rejected - HTTP 409 EMAIL_TAKEN
PASS  another workspace cannot read the seeded workspace's workflow - HTTP 404
PASS  another workspace cannot read the seeded workspace's run - HTTP 404
PASS  AF-01 canonical chain: 25 -> 100 -> "Total for 4 seat licences: £100.", cost 5+10+5=20, durations 20/18/9 - final=Total for 4 seat licences: £100., cost=20
PASS  AF-02 calculator precedence: 2 + 3 * 4 = 14 (multiplication binds first) - final=14
PASS  AF-03 calculator parentheses: (10 + 5) / 3 = 5 - final=5
PASS  AF-04 calculator decimal result: 10 / 4 = 2.5 - final=2.5
PASS  AF-05 word count: "the quick brown fox jumps" has exactly 5 words - final=5
PASS  AF-06 text format uppercase: "hello manchester" -> "HELLO MANCHESTER" - final=HELLO MANCHESTER
PASS  AF-07 text format title case: "support team manchester" -> "Support Team Manchester" - final=Support Team Manchester
PASS  AF-08 date add: 2026-03-15 + 10 days = 2026-03-25 - final=2026-03-25
PASS  AF-09 date add across the year boundary: 2026-12-30 + 5 days = 2027-01-04 - final=2027-01-04
PASS  AF-10 template fills {input}: "Hello Amelia, your reference is ready." - final=Hello Amelia, your reference is ready.
PASS  AF-11 budget cap: costs 30+30+30 with cap 65 halts before step 3 (spent 60, halted at index 2) - spent=60, haltedAt=2
PASS  AF-12 max steps: a 4-step workflow with maxSteps 2 halts at index 2 after exactly 2 steps (cost 2) - executed=2
PASS  AF-13 blocked tool: with calculator blocked, the run halts at index 1 having spent only the first step's 6 - haltedAt=1, spent=6
PASS  AF-14 approval step pauses the run: awaiting_approval at index 1, 1 step executed, spent 6, prev "4" - status=awaiting_approval, pending=1
PASS  AF-15 approving resumes and completes: final "Escalation note: 4 words checked.", cost 11, 3 steps executed, approval trace completed - final=Escalation note: 4 words checked., cost=11
PASS  approving a completed run is a 400 - HTTP 400 NOT_AWAITING
PASS  AF-16 a lookup for a missing knowledge key fails the run with no spend - status=failed
PASS  AF-17 the calculator rejects code-like input (no eval): "2 + process.exit()" fails the run - detail=Character not allowed in expression: "p"
PASS  AF-18 division by zero fails the step with a clear detail - detail=Division by zero
PASS  AF-19 determinism: re-running the canonical workflow reproduces the identical output, cost and durations - durations=20,18,9
PASS  creating a workflow with an unknown tool is a 400 - HTTP 400 BAD_STEP
PASS  running a workflow with no steps is a 400 - HTTP 400 NO_STEPS
PASS  adding a step appends it with the tool's default cost (word_count = 6) - steps=1, cost=6
PASS  deleting a step removes it and keeps the remaining steps in order - remaining=1
PASS  owner updates a workflow's name and status - draft
PASS  duplicate knowledge key is a 409 - HTTP 409 KEY_EXISTS
PASS  report generation summarises the canonical run with its real output and cost - RPT-842620
PASS  reports list holds the generated report - 1 report(s)
PASS  notifications record the approval pause - 4 notification(s)
PASS  notifications can be marked read - HTTP 200
PASS  run detail breakdown reconciles: trace cost sum equals the run total - sum=20

50 passed, 0 failed
```
