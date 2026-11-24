"use strict";
// AgentFlow engine — a deterministic agent-workflow runner over local
// tools. Plain JavaScript, no network calls, no API keys, no eval().
// Workflows are ordered lists of steps; each step calls one tool from the
// registry below, threading the previous step's output forward. The runner
// records a full trace (per-step input, output, cost, duration, status)
// and enforces guardrails: a max-steps limit, a per-run cost budget cap
// and a blocked-tool list, plus a required-approval step type that pauses
// a run until a person approves it through the API.
//
// The tools are local deterministic functions standing in at the tool seam:
// in a production engagement the same step contracts plug in real tools and
// hosted model calls (see PRD backlog). Everything the local tools do is
// real and implemented here, and every result can be recomputed by hand.
//
// Tool contracts (input -> output):
//   calculator   input: an arithmetic expression string (after {prev} /
//                {input} substitution) over numbers, + - * / % and
//                parentheses -> output: the numeric result as a string,
//                rounded to 4 decimal places, trailing zeros trimmed.
//   lookup       input: a knowledge key (config.key) -> output: the value
//                stored for that key in the workspace knowledge table.
//                A missing key fails the step (and the run).
//   text_format  input: text -> output: the text after one operation:
//                uppercase | lowercase | title | trim.
//   word_count   input: text -> output: the number of whitespace-separated
//                words as a string ("0" for empty text).
//   date_add     input: a date string YYYY-MM-DD -> output: the date
//                config.days later (negative allowed), also YYYY-MM-DD,
//                computed in UTC so month/year boundaries are exact.
//   template     input: the previous output (for {prev}) and the run input
//                (for {input}) -> output: config.template with every
//                {prev} / {input} placeholder filled. An unknown
//                placeholder fails the step.
//
// Step input resolution: config.source chooses the step's primary input —
// "prev" (previous step's output; default for steps after the first),
// "input" (the run input; default for the first step) or "literal"
// (config.literal). calculator and template read {prev} / {input} from
// the run context regardless of source.
//
// Costs and durations: every step carries a cost (seeded per step; the
// tool's defaultCost is used when a step is created without one). The
// runner charges a step's cost only when the step completes. durationMs
// is a deterministic counter, not a wall-clock measurement:
//   durationMs = tool.baseMs + length of the step's resolved input text
// so the same workflow with the same inputs always traces identically.
// Approval steps that complete cost 0 and trace durationMs 2; steps that
// halt a run trace durationMs 0.
//
// Guardrail order (checked before each step, exactly as implemented):
//   1. max steps — steps already executed >= maxSteps halts the run.
//   2. approval — an approval step pauses the run (awaiting_approval)
//      unless it is the step being resumed after an approval.
//   3. blocked tool — the step's tool is on the workspace blocked list.
//   4. budget — spent + step cost would exceed the budget cap.
// A halt returns status "halted_guardrail" with haltReason one of
// "max_steps" | "blocked_tool" | "budget_cap" and haltedStepIndex set to
// the step that was not run; the trace gains a final halted entry for it.

const TOOLS = [
  { code: "calculator", name: "Calculator", category: "Compute", defaultCost: 10, baseMs: 12,
    description: "Evaluates a safe arithmetic expression (numbers, + - * / %, parentheses, {prev} / {input} placeholders). No eval() — a tokeniser and recursive-descent parser reject anything else.",
    inputContract: "expression: string, e.g. \"{prev} * 3\" or \"(10 + 5) / 3\"",
    outputContract: "the numeric result as a string, rounded to 4dp" },
  { code: "lookup", name: "Knowledge Lookup", category: "Data", defaultCost: 5, baseMs: 8,
    description: "Looks a key up in the workspace knowledge table and returns the stored value. Fails the run when the key is absent.",
    inputContract: "key: string naming a knowledge-table entry (config.key)",
    outputContract: "the stored value as a string" },
  { code: "text_format", name: "Text Formatter", category: "Text", defaultCost: 4, baseMs: 5,
    description: "Applies one deterministic formatting operation to the step input: uppercase, lowercase, title case or trim.",
    inputContract: "text: string; operation: uppercase | lowercase | title | trim (config.operation)",
    outputContract: "the formatted text as a string" },
  { code: "word_count", name: "Word Counter", category: "Text", defaultCost: 6, baseMs: 7,
    description: "Counts whitespace-separated words in the step input. Empty or all-whitespace text counts as 0.",
    inputContract: "text: string",
    outputContract: "the word count as a string" },
  { code: "date_add", name: "Date Adder", category: "Dates", defaultCost: 8, baseMs: 9,
    description: "Adds a signed number of days to a YYYY-MM-DD date in UTC and returns the resulting date in the same format.",
    inputContract: "date: string YYYY-MM-DD; days: integer (config.days)",
    outputContract: "the resulting date as a string YYYY-MM-DD" },
  { code: "template", name: "Template Filler", category: "Text", defaultCost: 5, baseMs: 6,
    description: "Fills {prev} and {input} placeholders in a template string. Any other placeholder fails the step, so a broken template never ships silently.",
    inputContract: "template: string with {prev} / {input} placeholders (config.template)",
    outputContract: "the filled template as a string" },
];
const TOOL_BY_CODE = {};
for (const t of TOOLS) TOOL_BY_CODE[t.code] = t;

// ---- Calculator: tokeniser + recursive-descent parser (no eval) ----
function tokenise(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const raw = expr.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value) || (raw.match(/\./g) || []).length > 1)
        throw new Error("Invalid number in expression: " + raw);
      tokens.push({ type: "number", value });
      i = j; continue;
    }
    if ("+-*/%()".includes(c)) { tokens.push({ type: c }); i++; continue; }
    throw new Error("Character not allowed in expression: " + JSON.stringify(c));
  }
  return tokens;
}
function evaluateExpression(rawExpr, ctx) {
  const substituted = String(rawExpr ?? "")
    .replaceAll("{prev}", String(ctx.prev ?? ""))
    .replaceAll("{input}", String(ctx.input ?? ""));
  const tokens = tokenise(substituted);
  if (!tokens.length) throw new Error("Empty expression");
  let pos = 0;
  const peek = () => tokens[pos];
  function parseExpr() {
    let v = parseTerm();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const op = tokens[pos++].type;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() && (peek().type === "*" || peek().type === "/" || peek().type === "%")) {
      const op = tokens[pos++].type;
      const rhs = parseFactor();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero");
      v = op === "*" ? v * rhs : op === "/" ? v / rhs : v % rhs;
    }
    return v;
  }
  function parseFactor() {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "-") { pos++; return -parseFactor(); }
    if (t.type === "+") { pos++; return parseFactor(); }
    if (t.type === "number") { pos++; return t.value; }
    if (t.type === "(") {
      pos++;
      const v = parseExpr();
      if (!peek() || peek().type !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return v;
    }
    throw new Error("Unexpected token in expression: " + t.type);
  }
  const value = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input in expression");
  return { value, substituted };
}
function formatNumber(n) {
  const r = Math.round(n * 10000) / 10000;
  return String(Object.is(r, -0) ? 0 : r);
}

// ---- Individual tools ----
function countWords(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return { count: words.length, words };
}
function formatText(text, operation) {
  const s = String(text ?? "");
  switch (operation || "trim") {
    case "uppercase": return s.toUpperCase();
    case "lowercase": return s.toLowerCase();
    case "title": return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
    case "trim": return s.trim();
    default: throw new Error("Unknown text_format operation: " + operation);
  }
}
function addDays(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? "").trim());
  if (!m) throw new Error("Expected a date in YYYY-MM-DD format, got: " + JSON.stringify(dateStr));
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw new Error("Invalid date: " + dateStr);
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
function fillTemplate(template, ctx) {
  return String(template ?? "").replace(/\{([a-z_]+)\}/g, (whole, name) => {
    if (name === "prev") return String(ctx.prev ?? "");
    if (name === "input") return String(ctx.input ?? "");
    throw new Error("Unknown placeholder in template: {" + name + "}");
  });
}
function resolveInput(step, ctx, stepIndex) {
  const cfg = step.config || {};
  const source = cfg.source || (stepIndex === 0 ? "input" : "prev");
  if (source === "input") return String(ctx.input ?? "");
  if (source === "literal") return String(cfg.literal ?? "");
  return String(ctx.prev ?? "");
}
// Execute one normal (non-approval) step. Returns { output, detail, input }
// where input is the resolved input text recorded in the trace.
function executeStep(step, ctx, knowledge, stepIndex) {
  const cfg = step.config || {};
  const tool = TOOL_BY_CODE[step.toolCode];
  if (!tool) throw new Error("Unknown tool: " + step.toolCode);
  if (step.toolCode === "calculator") {
    const { value, substituted } = evaluateExpression(cfg.expression || "", ctx);
    return { input: substituted, output: formatNumber(value),
      detail: "evaluated " + JSON.stringify(substituted) + " = " + formatNumber(value) };
  }
  if (step.toolCode === "lookup") {
    const key = String(cfg.key || "");
    if (!key) throw new Error("lookup step has no key configured");
    if (!knowledge || !(key in knowledge)) throw new Error("Knowledge key not found: " + key);
    return { input: key, output: String(knowledge[key]), detail: "knowledge[\"" + key + "\"] = " + JSON.stringify(String(knowledge[key])) };
  }
  const input = resolveInput(step, ctx, stepIndex);
  if (step.toolCode === "text_format") {
    const out = formatText(input, cfg.operation);
    return { input, output: out, detail: "operation " + (cfg.operation || "trim") + " over " + input.length + " chars" };
  }
  if (step.toolCode === "word_count") {
    const { count } = countWords(input);
    return { input, output: String(count), detail: count + " word(s) in " + input.length + " chars" };
  }
  if (step.toolCode === "date_add") {
    const out = addDays(input, cfg.days);
    return { input, output: out, detail: JSON.stringify(input) + " + " + (Number(cfg.days) || 0) + " day(s) = " + out };
  }
  if (step.toolCode === "template") {
    const out = fillTemplate(cfg.template || "", ctx);
    return { input: String(ctx.prev ?? ""), output: out, detail: "filled template (" + (cfg.template || "").length + " chars) -> " + out.length + " chars" };
  }
  throw new Error("Tool not executable: " + step.toolCode);
}

// ---- The runner ----
// steps: [{ name, toolCode, stepType: "normal"|"approval", config, cost }]
// opts: { input, knowledge, maxSteps, budgetCap, blockedTools,
//         startIndex, initialPrev, initialSpent, executedSoFar, approveIndex }
function runWorkflow(steps, opts) {
  const o = opts || {};
  const ctx = { input: String(o.input ?? ""), prev: String(o.initialPrev ?? "") };
  const knowledge = o.knowledge || {};
  const maxSteps = o.maxSteps ?? 12;
  const budgetCap = o.budgetCap ?? 100;
  const blocked = new Set(o.blockedTools || []);
  const startIndex = o.startIndex || 0;
  const approveIndex = o.approveIndex ?? -1;
  let spent = o.initialSpent || 0;
  let executed = o.executedSoFar || 0;
  const trace = [];
  const entry = (step, i, patch) => Object.assign({
    stepIndex: i, stepName: step.name || ("Step " + (i + 1)), toolCode: step.toolCode || "",
    stepType: step.stepType || "normal", input: "", output: "", detail: "",
    cost: 0, durationMs: 0, status: "completed",
  }, patch);
  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];
    const cost = Math.max(0, Number(step.cost) || 0);
    // 1. max steps
    if (executed >= maxSteps) {
      trace.push(entry(step, i, { status: "halted_guardrail", detail: "max steps reached (" + maxSteps + ")" }));
      return { status: "halted_guardrail", haltReason: "max_steps", haltedStepIndex: i,
        pendingStepIndex: null, trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev };
    }
    // 2. approval pause
    if ((step.stepType || "normal") === "approval") {
      if (i === approveIndex) {
        trace.push(entry(step, i, { status: "completed", input: ctx.prev, output: "Approved",
          detail: "approval recorded; run resumed", cost: 0, durationMs: 2 }));
        executed++;
        continue;
      }
      trace.push(entry(step, i, { status: "awaiting_approval", input: ctx.prev,
        detail: "waiting for a person to approve this step" }));
      return { status: "awaiting_approval", haltReason: "", haltedStepIndex: null,
        pendingStepIndex: i, trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev };
    }
    // 3. blocked tool
    if (blocked.has(step.toolCode)) {
      trace.push(entry(step, i, { status: "halted_guardrail", detail: "tool is on the blocked list: " + step.toolCode }));
      return { status: "halted_guardrail", haltReason: "blocked_tool", haltedStepIndex: i,
        pendingStepIndex: null, trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev };
    }
    // 4. budget cap
    if (spent + cost > budgetCap) {
      trace.push(entry(step, i, { status: "halted_guardrail",
        detail: "budget cap: spent " + spent + " + step cost " + cost + " would exceed cap " + budgetCap }));
      return { status: "halted_guardrail", haltReason: "budget_cap", haltedStepIndex: i,
        pendingStepIndex: null, trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev };
    }
    // Execute
    try {
      const r = executeStep(step, ctx, knowledge, i);
      const tool = TOOL_BY_CODE[step.toolCode];
      trace.push(entry(step, i, { status: "completed", input: r.input, output: r.output,
        detail: r.detail, cost, durationMs: (tool ? tool.baseMs : 0) + r.input.length }));
      ctx.prev = r.output;
      spent += cost;
      executed++;
    } catch (err) {
      trace.push(entry(step, i, { status: "failed", detail: String(err.message || err), cost: 0, durationMs: 0 }));
      return { status: "failed", haltReason: "", haltedStepIndex: null, pendingStepIndex: null,
        trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev, error: String(err.message || err) };
    }
  }
  return { status: "completed", haltReason: "", haltedStepIndex: null, pendingStepIndex: null,
    trace, spent, stepsExecuted: executed, prev: ctx.prev, finalOutput: ctx.prev };
}

module.exports = { TOOLS, TOOL_BY_CODE, evaluateExpression, formatNumber, countWords,
  formatText, addDays, fillTemplate, resolveInput, executeStep, runWorkflow };
