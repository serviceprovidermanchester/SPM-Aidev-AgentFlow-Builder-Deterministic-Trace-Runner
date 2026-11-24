#!/usr/bin/env python3
"""Renders a PNG of every console view of AgentFlow at desktop 1440x900
into ../screenshots/. The drawings replicate the console's real design
system (web/styles.css): ink #1C1917 header, rust orange #EA580C accent,
#FAF4EC page background, monospace data type — with the showcase team's
seeded data (ConnectNorth Support Operations, Northern Quarter) and its
real seeded run results from preview/shot-config.json."""
import json, os
from PIL import Image, ImageDraw, ImageFont
W, H = 1440, 900
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "screenshots")
os.makedirs(OUT, exist_ok=True)
CFG = json.loads(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot-config.json")).read())
def hx(h): h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
BRAND = hx(CFG["header"]); ACCENT = hx(CFG["accent"]); BG = hx(CFG["bg"])
WHITE = (255, 255, 255); INK = (28, 25, 23); MUTED = (120, 113, 108); LINE = (234, 217, 194)
BAD = (185, 28, 28); WARN = (180, 83, 9); GOOD = (21, 128, 61); ACCENT_INK = (255, 247, 237)
FD = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"; FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
def F(s, b=False, mono=False):
    return ImageFont.truetype((FMB if b else FM) if mono else (FB if b else FD), int(s))
def wrap(d, t, f, mw):
    ws, lines, cur = str(t).split(), [], ""
    for w in ws:
        tt = (cur + " " + w).strip()
        if d.textlength(tt, font=f) <= mw: cur = tt
        elif cur: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines
NAV = ["Dashboard", "Workflows", "Tools", "Knowledge", "Runner", "Runs", "Guardrails", "Reports"]
STATUS_FILL = {"completed": (240, 253, 244), "awaiting approval": (255, 247, 237), "halted guardrail": (254, 242, 242), "failed": (254, 242, 242)}
STATUS_FG = {"completed": GOOD, "awaiting approval": WARN, "halted guardrail": BAD, "failed": BAD}
class Page:
    def __init__(self, title, active=""):
        self.img = Image.new("RGB", (W, H), BG); self.d = ImageDraw.Draw(self.img)
        d = self.d
        d.rectangle([0, 0, W, 64], fill=BRAND)
        d.text((28, 20), CFG["name"] + "_", font=F(20, True, mono=True), fill=WHITE)
        x = 268
        for n in NAV:
            col = ACCENT if n == active else (231, 229, 228)
            d.text((x, 25), n, font=F(12.5, n == active), fill=col); x += d.textlength(n, font=F(12.5)) + 18
        d.text((W - 260, 24), CFG["owner"] + " · ConnectNorth", font=F(11.5), fill=WHITE)
        d.rectangle([0, 64, W, 96], fill=ACCENT)
        d.text((W // 2, 72), CFG["name"] + " — " + CFG["tagline"].lower() + " · " + CFG["business"] + ", " + CFG["location"],
               font=F(12, True, mono=True), fill=ACCENT_INK, anchor="ma")
        self.y = 128
        d.text((40, self.y), title, font=F(27, True), fill=INK); self.y += 48
    def save(self, name): self.img.save(os.path.join(OUT, name)); print("wrote", name)
    def card(self, x, y, w, h, fill=WHITE):
        self.d.rounded_rectangle([x, y, x + w, y + h], 14, fill=fill, outline=LINE, width=1)
    def text(self, x, y, s, size=14, bold=False, color=INK, mono=False):
        self.d.text((x, y), str(s), font=F(size, bold, mono), fill=color)
    def para(self, x, y, s, size=13, color=MUTED, maxw=520, lh=19):
        for ln in wrap(self.d, s, F(size), maxw): self.d.text((x, y), ln, font=F(size), fill=color); y += lh
        return y
    def pill(self, x, y, label, status=None):
        fill = STATUS_FILL.get(status, BG); fg = STATUS_FG.get(status, BRAND)
        w = self.d.textlength(label, font=F(11, True, mono=True)) + 20
        self.d.rounded_rectangle([x, y, x + w, y + 24], 12, fill=fill, outline=LINE)
        self.d.text((x + 10, y + 5), label, font=F(11, True, mono=True), fill=fg); return x + w + 8
    def btn(self, x, y, label, accent=False, w=None):
        w = w or (self.d.textlength(label, font=F(13.5, True)) + 34)
        self.d.rounded_rectangle([x, y, x + w, y + 38], 10, fill=ACCENT if accent else BRAND)
        self.d.text((x + w / 2, y + 10), label, font=F(13.5, True), fill=ACCENT_INK if accent else WHITE, anchor="ma")
        return x + w + 10
    def field(self, x, y, label, value, w=560):
        self.text(x, y, label.upper(), 11, True, MUTED)
        self.d.rounded_rectangle([x, y + 20, x + w, y + 58], 9, outline=LINE)
        self.text(x + 12, y + 30, value, 13)
        return y + 74
    def table(self, x, y, cols, rows, widths, mono_cols=()):
        d = self.d; cx = x
        for h, wd in zip(cols, widths): d.text((cx, y), h.upper(), font=F(11, True), fill=MUTED); cx += wd
        y += 24; d.line([x, y, x + sum(widths), y], fill=BRAND, width=2); y += 10
        for row in rows:
            cx = x; lines = 1
            for ci, (v, wd) in enumerate(zip(row, widths)):
                f = F(12.5, mono=ci in mono_cols)
                ls = wrap(d, str(v), f, wd - 12); lines = max(lines, len(ls))
                for j, ln in enumerate(ls): d.text((cx, y + j * 17), ln, font=f, fill=INK)
                cx += wd
            y += 17 * lines + 13; d.line([x, y - 6, x + sum(widths), y - 6], fill=LINE, width=1)
        return y

def dashboard():
    p = Page(CFG["business"], "Dashboard"); s = CFG["stats"]; g = CFG["guardrails"]
    p.card(40, p.y, 1360, 150, fill=BRAND)
    p.text(64, p.y + 16, CFG["business"], 23, True, WHITE)
    p.text(64, p.y + 52, CFG["team"] + " · " + CFG["location"] + " — agent workflows at a glance.", 13, False, (214, 211, 209))
    p.text(64, p.y + 82, str(s["totalCost"]), 34, True, ACCENT, mono=True)
    p.text(300, p.y + 96, "credits spent · " + str(s["runs"]) + " runs · " + str(s["completed"]) + " completed · " +
           str(s["awaiting"]) + " awaiting approval · " + str(s["halted"]) + " halted on guardrails", 12.5, False, (214, 211, 209), mono=True)
    y = p.y + 174; x = 40
    for v, l in [(str(s["workflows"]), "Workflows"), (str(s["tools"]), "Tools in the registry"),
                 (str(s["knowledge"]), "Knowledge entries"), (str(s["runs"]), "Runs recorded")]:
        p.card(x, y, 322, 104); p.text(x + 18, y + 14, v, 28, True, BRAND, mono=True); p.text(x + 18, y + 58, l, 13, False, MUTED); x += 340
    y += 128; p.text(40, y, "Guardrails in force", 19, True); y += 36
    x = 40
    for lab in ["max steps: " + str(g["maxSteps"]), "budget cap: " + str(g["budgetCap"]) + " credits", "blocked tools: " + g["blocked"]]:
        x = p.pill(x, y, lab)
    y += 44; p.text(40, y, "Recent runs", 19, True); y += 38
    for ref, name, status, steps, cost, final in CFG["runs"]:
        p.card(40, y, 1000, 46)
        p.text(58, y + 13, name + " — " + steps + " steps · " + cost + " credits", 13.5)
        p.pill(1080, y + 11, status, status=status); y += 58
    return p
def workflows():
    p = Page("Workflows", "Workflows")
    p.para(40, p.y, "4 workflows in this workspace. Each is an ordered list of steps over the tool registry; outputs thread from step to step.", 13.5, MUTED, 1150); p.y += 26
    y = p.y
    for name, status, steps, cost, chain in CFG["workflows"]:
        p.card(40, y, 1360, 84)
        p.pill(64, y + 14, status); p.pill(170, y + 14, steps + " steps"); p.pill(300, y + 14, "cost " + cost + " credits")
        p.text(64, y + 44, name, 15.5, True); p.text(700, y + 46, chain, 12.5, False, MUTED, mono=True); y += 96
    p.text(40, y + 8, "New workflow", 19, True); y += 44
    y = p.field(40, y, "Name", "", 640)
    p.btn(40, y, "Create workflow", accent=True)
    return p
def workflow_detail():
    p = Page(CFG["workflowDetail"]["name"], "Workflows"); wd = CFG["workflowDetail"]
    p.para(40, p.y, wd["description"], 13.5, MUTED, 1250); p.y += 30
    p.text(40, p.y, "Steps (run in order, outputs thread forward)", 19, True); p.y += 36
    p.card(40, p.y, 1360, 230)
    p.table(64, p.y + 18, ["#", "Step", "Tool", "Config", "Cost"],
            [list(r) for r in wd["steps"]], [50, 300, 160, 560, 100], mono_cols=(0, 2, 3, 4))
    y = p.y + 254
    p.text(40, y, "Add a step", 19, True); y += 36
    p.card(40, y, 1360, 120)
    y2 = p.field(64, y + 14, "Tool", "Template Filler (template)", 400)
    p.text(500, y + 14, "CONFIG KEYS BY TOOL", 11, True, MUTED)
    p.para(500, y + 40, "calculator: expression · lookup: key · template: template · text_format: operation · date_add: days · any tool: source (prev | input | literal) and literal.", 12.5, MUTED, 820, 18)
    p.btn(64, y + 76, "Add step"); p.btn(200, y + 76, "Run this workflow", accent=True)
    return p
def tools():
    p = Page("Tool Registry", "Tools"); td = CFG["toolDetail"]
    p.para(40, p.y, "The 6 local deterministic tools a step can call. Each contract states exactly what goes in and what comes out; in production the same seam connects real tools and hosted model calls.", 13.5, MUTED, 1250); p.y += 30
    p.card(40, p.y, 1360, 440)
    p.table(64, p.y + 18, ["Code", "Tool", "Category", "Default cost", "Base"],
            [list(r) for r in CFG["tools"]], [220, 260, 180, 200, 160], mono_cols=(0, 3, 4))
    y = p.y + 464
    p.card(40, y, 1360, 170)
    p.text(64, y + 14, "Calculator — contract detail", 15.5, True)
    p.para(64, y + 44, td["description"], 12.5, MUTED, 1280, 18)
    p.text(64, y + 108, "In: " + td["input"], 12.5, False, INK, mono=True)
    p.text(64, y + 134, "Out: " + td["output"], 12.5, False, INK, mono=True)
    return p
def knowledge():
    p = Page("Knowledge Table", "Knowledge")
    p.para(40, p.y, "The seeded table the lookup tool reads. A step names a key; the stored value becomes its output.", 13.5, MUTED, 1150); p.y += 26
    p.card(40, p.y, 1360, 480)
    p.table(64, p.y + 18, ["Key", "Value", "Category"],
            [list(r) for r in CFG["knowledge"]], [320, 640, 260], mono_cols=(0,))
    y = p.y + 504
    p.text(40, y, "Add an entry", 19, True); y += 36
    p.field(40, y, "Key", "new_key", 400); p.field(460, y, "Value", "", 400)
    p.btn(880, y + 20, "Add entry", accent=True)
    return p
def runner():
    p = Page("Runner", "Runner"); g = CFG["guardrails"]
    p.card(40, p.y, 1360, 330)
    p.text(64, p.y + 18, "Start a run", 16.5, True)
    p.para(64, p.y + 50, "The runner executes the workflow's steps in order under this workspace's guardrails (max " + str(g["maxSteps"]) +
           " steps · budget " + str(g["budgetCap"]) + " credits · blocked: " + g["blocked"] +
           "). Every step is traced with its input, output, cost and duration.", 13, MUTED, 1250)
    y = p.field(64, p.y + 118, "Workflow", "Install Quote Builder (3 steps)", 640)
    y = p.field(64, y, "Run input", "Text or date the first step reads, e.g. 2026-03-01", 640)
    p.btn(64, y + 6, "Run workflow", accent=True)
    y = p.y + 356
    p.card(40, y, 1360, 130)
    p.text(64, y + 16, "Last run in this workspace", 15.5, True)
    p.para(64, y + 48, "RUN-701DF4 · Escalation Summary with Approval — awaiting approval at step 2 (Supervisor approval) after 1 executed step and 6 credits spent. "
           "Approving it from the trace view resumes the run to its final summary sentence.", 13, MUTED, 1250, 19)
    p.pill(64, y + 96, "awaiting approval", status="awaiting approval")
    return p
def runs():
    p = Page("Runs", "Runs")
    p.para(40, p.y, "all · completed · awaiting approval · halted · failed", 13, ACCENT, 900); p.y += 26
    p.card(40, p.y, 1360, 330)
    p.table(64, p.y + 18, ["Reference", "Workflow", "Status", "Steps", "Cost", "Final output"],
            [[r[0], r[1], r[2], r[3], r[4], r[5]] for r in CFG["runs"]],
            [150, 300, 170, 80, 80, 440], mono_cols=(0, 3, 4))
    return p
def trace():
    p = Page("Run " + CFG["trace"]["ref"], "Runs"); t = CFG["trace"]
    x = p.pill(40, p.y, "completed", status="completed")
    p.text(x + 4, p.y + 3, t["workflow"] + " · triggered by Priya Nair", 13.5, True)
    y = p.y + 40; x = 40
    for v, l in [("3", "Steps executed"), ("20", "Total cost (credits)"), ("3", "Trace entries"), ("✓", "Costs reconcile")]:
        p.card(x, y, 322, 104); p.text(x + 18, y + 14, v, 27, True, BRAND, mono=True); p.text(x + 18, y + 58, l, 12.5, False, MUTED); x += 340
    y += 128
    p.card(40, y, 1360, 84)
    p.text(64, y + 14, "Final output", 15.5, True)
    p.text(64, y + 46, t["final"], 14, False, INK, mono=True)
    y += 108; p.text(40, y, "Trace", 19, True); y += 36
    p.card(40, y, 1360, 250)
    p.table(64, y + 18, ["#", "Step", "Tool", "Input", "Output", "Cost", "Duration", "Status"],
            [list(r) for r in t["rows"]], [40, 250, 130, 200, 330, 70, 100, 120], mono_cols=(0, 2, 3, 5, 6))
    return p
def guardrails():
    p = Page("Guardrails", "Guardrails"); g = CFG["guardrails"]
    p.para(40, p.y, "Checked before every step, in this order: max steps → approval pause → blocked tool → budget cap. A halted run keeps the spend it had already committed and records exactly which guardrail stopped it.", 13.5, MUTED, 1250); p.y += 34
    p.card(40, p.y, 1360, 190)
    p.text(64, p.y + 16, "Workspace settings — " + CFG["business"], 15.5, True)
    y = p.field(64, p.y + 44, "Max steps per run", str(g["maxSteps"]), 400)
    p.field(500, p.y + 44, "Budget cap (credits per run)", str(g["budgetCap"]), 400)
    p.text(64, y + 138, "Blocked tools: " + g["blocked"] + "  ·  calculator ☐  lookup ☐  text_format ☐  word_count ☐  date_add ☐  template ☐", 12.5, False, MUTED, mono=True)
    p.btn(1050, p.y + 128, "Save guardrails", accent=True)
    y = p.y + 214
    for title_, body in [("Max steps", "When the steps already executed reach the limit, the next step never runs; the run ends halted_guardrail with reason max_steps."),
                         ("Budget cap", "Steps carry seeded costs. When the next step's cost would take the run over the cap, the run halts with reason budget_cap — spent stays at the amount already committed (30 + 30 spent, cap 65, third step never runs)."),
                         ("Approval steps", "A step of type approval pauses the run as awaiting_approval; it resumes from the same step once a person approves it in the trace view.")]:
        p.card(40, y, 1360, 92); p.text(64, y + 14, title_, 15.5, True); p.para(64, y + 44, body, 12.5, MUTED, 1280, 18); y += 106
    return p
def reports():
    p = Page("Reports & Help", "Reports"); r = CFG["report"]
    p.card(40, p.y, 1360, 150)
    x = p.pill(64, p.y + 16, r["ref"])
    p.text(64, p.y + 50, r["title"], 16.5, True)
    p.para(64, p.y + 80, r["summary"], 13, MUTED, 1250, 19)
    y = p.y + 172
    cards = [("How AgentFlow runs a workflow", "Steps run in order. Each step's output becomes the next step's {prev}; the run input is available as {input}. The runner records a trace entry per step — resolved input, output, the detail behind the result, its seeded cost and a deterministic duration (tool base + input length) — so the same workflow with the same inputs always traces identically."),
             ("About the data and the tools", "AgentFlow's tools are local deterministic functions — a safe arithmetic calculator (tokeniser and parser, never eval), a lookup over the workspace knowledge table, a text formatter, a word counter, a UTC date adder and a template filler. They stand in at the tool seam where production tools and hosted model calls plug in. All workflows, knowledge entries and runs here are seeded local data for a fictional Manchester support team."),
             ("Reading a trace", "A completed trace's step costs sum exactly to the run's total cost — the trace view checks this for you. A halted trace ends with a halted_guardrail entry naming the guardrail; a paused trace shows the approval step as awaiting_approval until it is approved.")]
    for t, b in cards:
        p.card(40, y, 1240, 118); p.text(62, y + 14, t, 15.5, True); p.para(62, y + 44, b, 12.5, MUTED, 1180, 18); y += 132
    return p

dashboard().save("01-dashboard.png")
workflows().save("02-workflows.png")
workflow_detail().save("03-workflow-detail.png")
tools().save("04-tools.png")
knowledge().save("05-knowledge.png")
runner().save("06-runner.png")
runs().save("07-runs.png")
trace().save("08-trace.png")
guardrails().save("09-guardrails.png")
reports().save("10-reports-help.png")
print("10 screenshots written")
