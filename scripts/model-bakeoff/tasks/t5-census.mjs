import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export const id = "t5-census";
export const title = "T5 fleet sweep: workflow inventory and script grep census";
export const row = 4;

export const sources = [
  { from: ".github/workflows", match: /\.ya?ml$/, to: "workflows" },
  { from: "scripts", match: /\.(mjs|sh)$/, to: "scripts" },
];

export const collections = [
  {
    name: "workflows",
    key: "file",
    keyKind: "file",
    fields: {
      name: "string",
      triggers: "set:string",
      crons: "set:string",
      actions: "set:string",
      secrets: "set:string",
      jobs: "number",
    },
  },
  {
    name: "scripts",
    key: "file",
    keyKind: "file",
    fields: {
      lines: "number",
      shebang: "boolean",
      nodeImports: "set:string",
      ghApi: "boolean",
    },
  },
];

const strings = { type: "array", items: { type: "string" } };

export const schema = {
  type: "object",
  properties: {
    workflows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          name: { type: "string" },
          triggers: strings,
          crons: strings,
          actions: strings,
          secrets: strings,
          jobs: { type: "number" },
        },
        required: ["file", "name", "triggers", "crons", "actions", "secrets", "jobs"],
      },
    },
    scripts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          lines: { type: "number" },
          shebang: { type: "boolean" },
          nodeImports: strings,
          ghApi: { type: "boolean" },
        },
        required: ["file", "lines", "shebang", "nodeImports", "ghApi"],
      },
    },
    unverified: strings,
  },
  required: ["workflows", "scripts", "unverified"],
};

export function prompt(dir) {
  return [
    `Read-only census of a frozen snapshot of the reddoor-maintenance repository, in ${dir}.`,
    `${dir}/workflows holds GitHub Actions workflow files and ${dir}/scripts holds .mjs and .sh scripts.`,
    "",
    "1. workflows: one entry for every file in workflows/, with:",
    '   - file: the file name, e.g. "ci.yml"',
    '   - name: the value of the top-level `name:` key, or "" if there is none',
    "   - triggers: the event names under the top-level `on:` key (for a map, its keys; for a list or a single string, its values)",
    "   - crons: every `cron:` string under `on.schedule`, exactly as written, or []",
    "   - actions: every `uses:` value in the jobs (job-level `uses:` and step-level `uses:`), with any `@ref` suffix removed, deduplicated; commented-out lines do not count",
    "   - secrets: every distinct NAME in any `secrets.NAME` occurrence anywhere in the file text, comments included",
    "   - jobs: the number of keys under the top-level `jobs:` map",
    "2. scripts: one entry for every file in scripts/, with:",
    '   - file: the file name, e.g. "land-prs.mjs"',
    "   - lines: the number of newline characters in the file (what `wc -l` prints)",
    "   - shebang: true if the file's first two characters are `#!`",
    '   - nodeImports: every distinct quoted string literal in the file that starts with `node:`, e.g. "node:fs", or []',
    "   - ghApi: true if the file contains the literal text `gh api` anywhere",
    "3. unverified: anything you could not establish (empty if none).",
    "",
    "Be exact: every field is checked against a script's answer.",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are building the GOLD STANDARD the other runs are compared against. Establish every field mechanically: write and run small scripts (node, or python3 -I) against the files rather than reading them by eye, and put anything you could not verify that way in unverified.";

function listFiles(dir) {
  return readdirSync(dir).sort();
}

function triggerNames(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

export function workflowFacts(file, text) {
  const doc = yaml.load(text) || {};
  const on = doc.on ?? doc[true];
  const schedule = on && typeof on === "object" && !Array.isArray(on) ? on.schedule : undefined;
  const actions = new Set();
  for (const job of Object.values(doc.jobs || {})) {
    if (!job || typeof job !== "object") continue;
    if (typeof job.uses === "string") actions.add(job.uses.replace(/@.*$/, ""));
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (step && typeof step.uses === "string") actions.add(step.uses.replace(/@.*$/, ""));
    }
  }
  return {
    file,
    name: typeof doc.name === "string" ? doc.name : "",
    triggers: triggerNames(on),
    crons: Array.isArray(schedule) ? schedule.map((s) => s && s.cron).filter(Boolean) : [],
    actions: [...actions],
    secrets: [
      ...new Set([...text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])),
    ],
    jobs: Object.keys(doc.jobs || {}).length,
  };
}

export function scriptFacts(file, text) {
  return {
    file,
    lines: (text.match(/\n/g) || []).length,
    shebang: text.startsWith("#!"),
    nodeImports: [...new Set([...text.matchAll(/["'`](node:[^"'`\s]*)["'`]/g)].map((m) => m[1]))],
    ghApi: text.includes("gh api"),
  };
}

export function truth(dir) {
  const read = (sub, f) => readFileSync(join(dir, sub, f), "utf8");
  return {
    workflows: listFiles(join(dir, "workflows")).map((f) => workflowFacts(f, read("workflows", f))),
    scripts: listFiles(join(dir, "scripts")).map((f) => scriptFacts(f, read("scripts", f))),
  };
}

export const arms = [
  { id: "haiku-low-1", model: "haiku", effort: "low" },
  { id: "haiku-low-2", model: "haiku", effort: "low" },
  { id: "haiku-medium-1", model: "haiku", effort: "medium" },
  { id: "haiku-medium-2", model: "haiku", effort: "medium" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
  { id: "opus-low-1", model: "opus", effort: "low" },
  { id: "opus-low-2", model: "opus", effort: "low" },
];

export const gold = { id: "gold", model: "opus", effort: "high" };
