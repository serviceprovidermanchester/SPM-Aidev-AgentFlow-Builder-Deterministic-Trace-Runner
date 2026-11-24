# AgentFlow — Project Details

**Product:** AgentFlow — Agent Workflow Builder & Trace Runner  
**Series:** SPManchester Portfolio, Series 10 — AI Development (product 6 of 10)  
**Organization:** SPManchester Private Limited (https://spmanchester.com/)  
**Lead Architect & Author:** Sayed Mudassar Akbar  
**Corporate Inquiries:** info@spmanchester.com  

## Portfolio summary

AgentFlow is the platform layer for teams whose agents have become
untestable spaghetti. Workflows are explicit, ordered step lists over a
documented 6-tool registry (safe calculator, knowledge lookup, text
formatter, word counter, date adder, template filler). A deterministic
runner threads outputs step to step and records a full trace — resolved
input, output, detail, cost and duration per step — whose costs reconcile
exactly with the run total. Guardrails checked before every step (max
steps, per-run budget cap, blocked-tool list) halt runs with a named
reason and the spend preserved, and approval steps pause a run mid-flight
until a person approves it through the API, resuming exactly where it
stopped. The shipped workspace is seeded for a fictional Manchester
support team (ConnectNorth, Northern Quarter): 4 workflows, 8 knowledge
entries, 4 seeded runs including the canonical quote workflow that turns
a £45 lookup into `Total for 2 replacement routers: £90.` for 20 credits,
and one run waiting at its supervisor approval step.

**Stack:** zero-dependency Node.js (`node:http`, `node:sqlite`,
`node:crypto`), SQLite (12 tables), dependency-free SPA console
(10 views), 26 REST endpoints + health, 50 live HTTP tests (22 labelled
hand-computed expected-output cases), 10 screenshots at 1440×900.

**Honest scope:** the tools are local deterministic functions standing in
at the tool seam, and all data is seeded local data — stated plainly in
the product docs. Production hosted-model calls and real tool
integrations plug in behind the same step contracts (PRD backlog).

## LinkedIn draft

Agent behaviour you can't replay is agent behaviour you can't trust. 🚦

For our AI Development portfolio series at SPManchester, we built
**AgentFlow** — an agent workflow builder & trace runner.

🔗 Workflows as explicit step lists over a documented tool registry —
calculator, knowledge lookup, formatter, word counter, date adder,
template filler — with outputs threading step to step
🧾 A full trace for every run: per-step input, output, cost and duration,
with trace costs reconciling exactly to the run total
🛑 Guardrails that actually stop runs: max steps, a per-run budget cap
(30 + 30 spent, cap 65 → the third step never runs), and a blocked-tool
list — each halt naming its reason
✋ Approval steps that pause a run mid-flight and resume from the same
step once a person approves
🧮 A calculator with no eval() — a tokeniser and parser that reject
code-like input character by character

Deterministic by design: the same workflow with the same inputs produces
the identical trace, verified by 50 live tests including 22 hand-computed
expected-output cases.

[GitHub link]

#AIDevelopment #LLMOps #Manchester #SPManchester #AIAgents #AgentWorkflows #SoftwareDevelopment
