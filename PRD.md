# AgentFlow — Product Requirements Document

**Enterprise AI Platform Specification**  
**Maintained by:** SPManchester Private Limited (https://spmanchester.com/)  
**Author:** Sayed Mudassar Akbar (info@spmanchester.com)  

## 1. Product summary

AgentFlow is an agent workflow builder and trace runner for AI and
operations teams. Users assemble workflows from explicit, ordered steps
over a documented tool registry, run them under guardrails (max steps,
budget cap, blocked tools, human approval), and inspect a complete,
deterministic trace of every run. It is product #6 of SPManchester Private Limited's AI
Development series (developer/engineering-facing AI tooling).

## 2. Users

- **Workspace owner** (team lead / AI engineer): creates the workspace,
  sets guardrails, approves paused runs, owns billing-style cost caps.
- **Staff member** (support/ops engineer): builds and runs workflows,
  reads traces, generates reports; cannot change guardrail settings.
- **Reviewer** (supervisor, via the owner/staff accounts): the human in
  the approval step — reads why a run paused and approves it to resume.

## 3. Problems

1. Agent behaviour lives in chained prompts and glue code; nobody can say
   afterwards which step produced a bad output or what it cost.
2. Runs have no spend ceiling, no step ceiling and no way to forbid a
   dangerous tool, so a looping or expensive workflow is discovered from
   its effects.
3. Workflows that need a human decision either block a person synchronously
   or skip the decision entirely; there is no pause/resume record.
4. "It worked yesterday" cannot be checked: runs are not deterministic,
   so there is no trustworthy replay.

## 4. Functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-1 | Tool registry with contracts | `GET /api/v1/tools` lists all 6 tools with input/output contracts, default cost and base duration; unknown code returns 404. |
| FR-2 | Knowledge table | Owners/staff can list and add entries; duplicate key per workspace returns 409; the lookup tool reads entries of the run's own workspace only. |
| FR-3 | Workflow builder | Create workflows with ordered steps in one call; append and remove steps; rename and set draft/active/archived. A step naming an unknown tool is a 400. |
| FR-4 | Step types | Normal steps call one registry tool; approval steps call no tool and cost 0. Step config is per-tool JSON (expression, key, template, operation, days, source, literal). |
| FR-5 | Runner with threading | Steps execute in order; outputs thread via `{prev}`, run input via `{input}`, per-step `source` selects prev/input/literal. Starting a run returns 201 with the run and its trace. |
| FR-6 | Full trace | Every run stores one trace entry per attempted step: step index, name, tool, resolved input, output, detail, cost, deterministic duration, status. Run detail reports whether trace costs reconcile with the run total. |
| FR-7 | Guardrails | Workspace settings: max steps (default 12), budget cap in credits (default 100), blocked-tool list. Checked before each step in the documented order; halts end the run as `halted_guardrail` with `haltReason` and `haltedStepIndex`, preserving spend. |
| FR-8 | Approval pause/resume | A run reaching an approval step becomes `awaiting_approval` with `pendingStepIndex`; `POST /runs/:id/approve` marks the step approved and resumes from it; approving a non-paused run is a 400. A notification is created on pause. |
| FR-9 | Failure handling | A failing step (missing knowledge key, invalid expression, unknown template placeholder) ends the run as `failed` with the failing trace entry's detail; the failed step is not charged. |
| FR-10 | Run history & reports | Runs list filters by workflow and status; a report can be generated for any run (or the latest) summarising status, steps, cost and final output. |
| FR-11 | Accounts & scoping | Register/login with hashed passwords and token sessions; one workspace per owner; staff share the workspace; another workspace's workflows/runs return 404; guardrail changes are owner-only (staff 403). |
| FR-12 | Console | Exactly 10 views (dashboard, workflows, builder, tools, knowledge, runner, runs, trace, guardrails, reports & help), every view calling the real API, hash routing, no external assets. |

## 5. Engine-behaviour requirements

- **EB-1 Determinism.** Same workflow + same inputs + same settings ⇒
  identical outputs, costs and durations. Durations are a documented
  counter (`tool baseMs + resolved input length`), never wall-clock.
- **EB-2 Calculator safety.** Arithmetic only via a tokeniser and
  recursive-descent parser; no `eval()`; any letter or disallowed
  character fails the step; division/modulo by zero fails the step;
  results rounded to 4 decimal places with trailing zeros trimmed.
- **EB-3 Hand-verifiability.** The canonical seeded workflow must finish
  with exactly `Total for 2 replacement routers: £90.` at cost 20. The
  budget fixture (three steps at 30 credits, cap 65) must halt before
  step 3 with 60 spent. At least 12 labelled expected-output checks in
  the test suite are computed independently of the engine.
- **EB-4 Cost integrity.** A step is charged only when it completes; a
  completed trace's costs sum exactly to the run total on every run.

## 6. KPIs

- 100% of runs carry a complete trace whose costs reconcile (EB-4).
- 0 runs execute a step past a guardrail (max steps / budget / blocked).
- Approval pauses resume with 0 lost steps: resumed runs complete with
  the same outputs an uninterrupted run would produce.
- Test suite: ≥35 checks, all passing, ≥12 labelled expected-output cases.

## 7. Backlog (production engagement)

- Hosted model steps: plug OpenAI, Anthropic, Google and Azure OpenAI
  calls in behind the step interface (a `model_call` tool with the same
  trace/guardrail treatment, real token-based costing instead of seeded
  step costs).
- Real tool integrations at the tool seam: CRM/ticketing lookups,
  payment actions, email/Slack senders, web fetch — each as a registry
  tool with a contract, replacing the local deterministic functions.
- Branching and loops (conditional steps, fan-out), parallel steps,
  scheduled and webhook-triggered runs, and run replay with edited
  inputs.
- Multi-user approval policies (named approvers, quorum, timeouts with
  escalation), workspace roles beyond owner/staff, SSO.
- Trace export (JSON/CSV), run comparison and cost analytics across
  workflows and time.
