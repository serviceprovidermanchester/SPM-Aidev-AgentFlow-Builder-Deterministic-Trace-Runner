"use strict";
// Seed data for AgentFlow. The showcase team is the support & operations
// team at ConnectNorth, a fictional Manchester broadband and support
// provider in the Northern Quarter, automating its support/ops workflows.
// All workflows, knowledge entries and runs below are seeded local data:
// every tool is a local deterministic function, so each seeded run's trace
// reconciles by hand from the values on this page.
//
// Canonical fixture — workflow "Install Quote Builder":
//   knowledge["router_replacement"] = "45"
//   step 1 lookup       -> "45"                          (cost 5)
//   step 2 calculator   -> "45 * 2" = "90"               (cost 10)
//   step 3 template     -> "Total for 2 replacement routers: £90." (cost 5)
//   final output "Total for 2 replacement routers: £90.", total cost 20.
// Trace durations follow durationMs = tool baseMs + input length:
//   lookup 8 + len("router_replacement")=18 -> 26; calculator 12 +
//   len("45 * 2")=6 -> 18; template 6 + len("90")=2 -> 8.
const PRODUCT = {
  name: "AgentFlow", tagline: "Every agent step, traced and guard-railed",
  serviceId: "spm-aidev-agentflow-api",
  ownerName: "Priya Nair", ownerEmail: "owner@connectnorth.co.uk", ownerPassword: "Owner2026!",
  staffName: "Jack Mercer", staffEmail: "team@connectnorth.co.uk", staffPassword: "Team2026!",
};
const PROJECT = {
  name: "ConnectNorth Support Operations", slug: "connectnorth-support-ops",
  team: "Support & Ops Automation", sector: "Broadband & support services",
  location: "Northern Quarter, Manchester",
};
// key, value, category — the workspace knowledge table the lookup tool reads.
const KNOWLEDGE = [
  ["router_replacement", "45", "Prices"],
  ["engineer_visit", "60", "Prices"],
  ["broadband_monthly", "35", "Prices"],
  ["sla_hours", "4", "Service levels"],
  ["support_phone", "0161 496 0200", "Contact"],
  ["office_address", "14 Dale Street, Northern Quarter, Manchester", "Contact"],
  ["refund_window_days", "14", "Policy"],
  ["team_name", "ConnectNorth Support", "Contact"],
];
// name, description, input the seeded run used, steps:
// [stepName, toolCode, stepType, config, cost]
const WORKFLOWS = [
  { name: "Install Quote Builder",
    description: "Looks up the router replacement price, doubles it for a two-router install and writes the quote sentence the support team sends to the customer.",
    seededInput: "",
    steps: [
      ["Look up router price", "lookup", "normal", { key: "router_replacement" }, 5],
      ["Double for two routers", "calculator", "normal", { expression: "{prev} * 2" }, 10],
      ["Write the quote sentence", "template", "normal", { template: "Total for 2 replacement routers: £{prev}." }, 5],
    ] },
  { name: "Response Time Promise",
    description: "Reads the team's response-time SLA from the knowledge table and turns it into the promise sentence used in first replies.",
    seededInput: "",
    steps: [
      ["Look up SLA hours", "lookup", "normal", { key: "sla_hours" }, 5],
      ["Write the promise", "template", "normal", { template: "We aim to respond within {prev} hours of your message." }, 5],
    ] },
  { name: "Refund Deadline Checker",
    description: "Adds the refund window to the purchase date a customer gives and replies with the exact deadline date.",
    seededInput: "2026-03-01",
    steps: [
      ["Add the refund window", "date_add", "normal", { source: "input", days: 14 }, 8],
      ["Write the deadline reply", "template", "normal", { template: "Your refund deadline is {prev}." }, 5],
    ] },
  { name: "Escalation Summary with Approval",
    description: "Counts the words in an escalation note, then pauses for a supervisor's approval before the summary sentence is produced for the ticket.",
    seededInput: "",
    steps: [
      ["Count the note words", "word_count", "normal", { source: "literal", literal: "Customer reports total loss of service since morning" }, 6],
      ["Supervisor approval", "", "approval", {}, 0],
      ["Write the escalation summary", "template", "normal", { template: "Escalation logged: {prev} words summarised for a supervisor." }, 5],
    ] },
];
module.exports = { PRODUCT, PROJECT, KNOWLEDGE, WORKFLOWS };
