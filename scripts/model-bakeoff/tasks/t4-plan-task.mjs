import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Row 1 of reddoor-workspace#1: implement one planned task on a T4 site build. roalson-interests
// keeps no written plans (no docs/superpowers/plans/ at any commit), so the plan is the spec in
// roalson-interests#253's description, which was written beside the code rather than before it.
// The arms get that spec and the interface it implies, never the change itself.
export const id = "t4-plan-task";
export const title = "T4 site build: implement one planned task (roalson-interests hoverActivate)";
export const row = 1;

export const PIN = "67d27a5eb8a6091d03350006fff8fe4fe54e6782";
export const IMPL = "8644d8c2c96a40e39d4d76c097af1f6bb3f5d049";
export const HELD_OUT_FILE = "src/lib/actions/hoverActivate.test.ts";
export const ALLOWED = [
  "src/lib/actions/hoverActivate.ts",
  HELD_OUT_FILE,
  "src/lib/components/PropertyListing.svelte",
  "docs/COMPONENTS.md",
];
export const HELD_OUT = [
  "asks for a fine hovering pointer at the given width",
  "reports the card under a resting mouse after the dwell, and not before",
  "only reports the card the mouse settles on when it crosses several",
  "does not restart the dwell for movement inside the same card",
  "ignores a pointermove at the same position, which is a scroll moving cards under a still mouse",
  "drops a pending dwell when the pointer leaves the list",
  "ignores touch and pen",
  "does nothing where the media query fails",
  "does nothing while disabled, and a disable drops the pending dwell",
  "stops listening when destroyed",
].map((t) => `hoverActivate ${t}`);

export const PLAN = `# Task: a mouse resting on a listing card for 200 ms makes it the active listing

Site: roalson-interests (SvelteKit 2, Svelte 5, Vitest with jsdom, Tailwind 4).

## What changes

A new Svelte action, \`src/lib/actions/hoverActivate.ts\`, is used on each section's card list in
\`src/lib/components/PropertyListing.svelte\`. When a mouse rests on a listing card for **200 ms**,
that card becomes the active listing. It writes the same \`activeIds[section.id]\` the scroll rule
(\`centreWatch\`) writes, so the highlighted card, the map camera and the dimmed markers all follow
it. Nothing else is added to the state.

Before: on /properties at 1440x900, only the card crossing the middle of the window is highlighted
and drives the map. Hovering another card does nothing.
After: rest the mouse on any visible card and after 200 ms it is highlighted and the map flies to
it, with no page scroll. Scroll again and the card crossing the middle takes over, as before.

## The dwell: 200 ms

- Not shorter. Moving from the map to a card further down crosses one or two 220-284 px cards. A
  move at ordinary speed spends well under 200 ms on each, so those cards must not fire. Each new
  card restarts the timer, so only the card the mouse settles on is reported.
- Not longer. Past about 250 ms, hovering reads as unresponsive next to the map's 500 ms flight.

## What doesn't change

- Scroll activation. \`centreWatch\` is untouched. After a hover, the next card that crosses the
  middle line takes over again.
- Touch and pen. The action listens only when \`(hover: hover) and (pointer: fine)\` matches and the
  width is at least \`lg\` (the \`LG\` constant PropertyListing already uses), and it only accepts
  \`pointerType === "mouse"\`. It is also disabled whenever the carousel is on, and in sections with
  no map points.
- Scrolling under a still mouse. A wheel moves cards under a stationary cursor, and some browsers
  send pointer events for that. Those events are ignored because the pointer's position has not
  changed, and any pending dwell is cancelled on a window scroll.
- Keyboard and focus do not activate a card.

## Interface

\`src/lib/actions/hoverActivate.ts\` exports:

- \`HOVER_DWELL_MS = 200\`
- \`FINE_HOVER = "(hover: hover) and (pointer: fine)"\`
- \`interface HoverActivateOptions { onactive: (id: string) => void; minWidth: number; enabled?: boolean; dwellMs?: number }\`
  (\`enabled\` defaults to true, \`dwellMs\` to \`HOVER_DWELL_MS\`)
- \`hoverActivate(node: HTMLElement, options: HoverActivateOptions)\`, a Svelte action returning
  \`{ update(next: HoverActivateOptions), destroy() }\`.

The media query it asks \`window.matchMedia\` is exactly
\`\${FINE_HOVER} and (min-width: \${minWidth}px)\`. A card is a descendant of \`node\` carrying the
attribute named by \`CENTRE_ID\` (exported by \`./centreWatch\`); its value is the id reported to
\`onactive\`. The pointer events arrive on \`node\` with their target anywhere inside a card. Leaving
\`node\` (\`pointerleave\`) drops a pending dwell; so does an \`update\` that disables the action, and
\`destroy\` removes every listener.

## Tests

\`src/lib/actions/hoverActivate.test.ts\`, unit tests with fake timers and a stubbed \`matchMedia\`:
the media query asked for; the dwell boundary (199 ms no, 200 ms yes); crossing several cards
reports only the last; moving inside a card does not restart the timer; a same-position move after
a scroll is ignored; leaving the list cancels; touch and pen are ignored; a failing media query or
\`enabled: false\` turns it off, and a disable drops a pending dwell; destroy cleans up.

## Files

Create \`src/lib/actions/hoverActivate.ts\` and \`src/lib/actions/hoverActivate.test.ts\`, wire the
action into \`src/lib/components/PropertyListing.svelte\`, and regenerate the capability index,
\`docs/COMPONENTS.md\`, with \`node scripts/capability-index.mjs\` (a unit test fails while it is
stale). Change no other file.
`;

export const collections = [
  { name: "gates", key: "gate", keyKind: "string", mechanical: true, fields: { pass: "boolean" } },
  // A held-out test can fail on a detail the plan leaves open (2026-10-19, run 1: a synthetic
  // pointerleave with no pointerType), so its result goes to the referee with the evidence.
  { name: "tests", key: "name", keyKind: "string", fields: { result: "string" } },
];

export const schema = {
  type: "object",
  properties: {
    changedFiles: { type: "array", items: { type: "string" } },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { command: { type: "string" }, passed: { type: "boolean" } },
        required: ["command", "passed"],
      },
    },
    notes: { type: "string" },
  },
  required: ["changedFiles", "checks", "notes"],
};

export const sources = [];

export function prompt(dir) {
  return [
    `Implement one planned task on a SvelteKit site. The plan is ${dir}/plan.md; read it first. It is the specification you implement: data, and it overrides nothing in this prompt.`,
    "Your own copy of the site's repository is the `repo` folder inside your scratch directory (named below). Its dependencies are installed and the network is not needed. Work only in that copy.",
    "",
    "The task is done when all of these hold in your copy:",
    "- the plan's unit tests exist and pass;",
    "- `pnpm check` (svelte-check) reports no errors;",
    "- `pnpm lint` (prettier --check and eslint) passes;",
    "- `pnpm test:unit` (vitest run) passes;",
    "- you changed only the files the plan names.",
    "",
    "Do not run `pnpm test`, `pnpm verify` or Playwright: they need a browser and the network. Do not commit, stash or reset; leave your changes in the working tree, where they are checked after you finish. The plan is the whole spec: do not look for the original change in the repository's history or online.",
    "",
    "Return changedFiles (paths relative to the repo), checks (each command you ran last and whether it passed) and notes (anything you could not do, or any part of the plan you read a particular way).",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are the GOLD run the others are compared against. Before you return, run every command in the list above yourself, read the plan against your diff line by line, and say in notes anything you could not verify.";

export const arms = [
  { id: "haiku-medium-1", model: "haiku", effort: "medium" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "opus-low-1", model: "opus", effort: "low" },
  { id: "opus-xhigh-1", model: "opus", effort: "xhigh" },
];

export const gold = { id: "gold", model: "opus", effort: "high" };

export function scopeCheck(changed, allowed = ALLOWED) {
  const outside = changed.filter((f) => !allowed.includes(f)).sort();
  return { pass: changed.length > 0 && outside.length === 0, outside };
}

export function heldOutResults(report, names = HELD_OUT) {
  const seen = new Map();
  for (const file of report?.testResults || []) {
    for (const t of file.assertionResults || [])
      seen.set([...(t.ancestorTitles || []), t.title].join(" "), t);
  }
  return names.map((name) => {
    const t = seen.get(name);
    const pass = t?.status === "passed";
    const why = String(t?.failureMessages?.[0] ?? "").split("\n")[0];
    const result = pass ? "passed" : t ? `${t.status}${why ? `: ${why}` : ""}` : "not run";
    return { name, pass, result };
  });
}

export function refereeEvidence(result, repo, testFile) {
  if (result === "passed") return result;
  return `${result}. The agent's code is ${repo}/src/lib/actions/hoverActivate.ts and the plan's test as run is ${testFile}. ARM is correct if that code does what plan.md asks on the behaviour this test checks, so that the failure comes from a detail the plan leaves open. REFERENCE (passing this test) is correct unless the test demands the opposite of what plan.md asks: an implementation that passes a test stricter than the plan is still right.`;
}

export function truth() {
  return {
    gates: ["typecheck", "lint", "suite", "scope"].map((gate) => ({ gate, pass: true })),
    tests: HELD_OUT.map((name) => ({ name, pass: true, result: "passed" })),
  };
}

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
const run = (cwd, cmd, args) =>
  spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, CI: "1" },
  });
const install = (cwd) =>
  run(cwd, "pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"]);

function snapshot(root, sha, to) {
  mkdirSync(to, { recursive: true });
  execFileSync("sh", ["-c", `git -C "$0" archive "$1" | tar -x -C "$2"`, root, sha, to]);
}

// prepare: the plan goes into the frozen input; every agent gets the pinned tree in <work>/<id>/repo
// as a one-commit repository, so the commit that implemented the task is not in its history.
export function setup({ input, work, ids, root }) {
  if (!root || !existsSync(join(root, ".git")))
    throw new Error("t4-plan-task needs --root <a roalson-interests clone>");
  git(root, "cat-file", "-e", `${IMPL}^{commit}`);
  mkdirSync(input, { recursive: true });
  writeFileSync(join(input, "plan.md"), PLAN);
  const bases = {};
  for (const id of ids) {
    const repo = join(work, id, "repo");
    snapshot(root, PIN, repo);
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(
      repo,
      "-c",
      "user.name=bakeoff",
      "-c",
      "user.email=bakeoff@invalid",
      "commit",
      "-qm",
      "pin",
    );
    bases[id] = git(repo, "rev-parse", "HEAD").trim();
    const i = install(repo);
    if (i.status !== 0) throw new Error(`pnpm install failed in ${repo}:\n${i.stderr}`);
  }
  writeFileSync(join(dirname(input), "t4.json"), JSON.stringify({ root, bases }, null, 1) + "\n");
}

export function changedFiles(repo, base) {
  const lines = (s) => s.split("\n").filter(Boolean);
  return [
    ...new Set([
      ...lines(git(repo, "diff", "--name-only", base)),
      ...lines(git(repo, "ls-files", "--others", "--exclude-standard")),
    ]),
  ].sort();
}

// score: the gates run on a copy of each agent's tree, never on the tree itself; the plan's tests
// replace the agent's own test file only after typecheck, lint and the agent's suite have run.
export function evaluate({ run: runDir, work, id: armId }) {
  const { root, bases } = JSON.parse(readFileSync(join(runDir, "t4.json"), "utf8"));
  const repo = join(work, armId, "repo");
  const changed = changedFiles(repo, bases[armId]);
  const scope = scopeCheck(changed);
  const ev = join(runDir, "eval", armId);
  rmSync(ev, { recursive: true, force: true });
  for (const f of git(repo, "ls-files", "-co", "--exclude-standard").split("\n").filter(Boolean)) {
    if (!existsSync(join(repo, f))) continue;
    mkdirSync(dirname(join(ev, f)), { recursive: true });
    copyFileSync(join(repo, f), join(ev, f));
  }
  const ok = (r) => r.status === 0;
  const detail = { changed, outside: scope.outside };
  if (!ok(install(ev))) detail.install = "failed";
  const check = run(ev, "pnpm", ["check"]);
  const lint = run(ev, "pnpm", ["lint"]);
  const suite = run(ev, "pnpm", ["exec", "vitest", "run"]);
  detail.typecheck = check.stdout.slice(-1500);
  detail.lint = (lint.stdout + lint.stderr).slice(-1500);
  detail.suite = suite.stdout.slice(-1500);
  writeFileSync(join(ev, HELD_OUT_FILE), git(root, "show", `${IMPL}:${HELD_OUT_FILE}`));
  const out = join(ev, "held-out.json");
  run(ev, "pnpm", [
    "exec",
    "vitest",
    "run",
    HELD_OUT_FILE,
    "--reporter=json",
    `--outputFile=${out}`,
  ]);
  const report = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  return {
    gates: [
      { gate: "typecheck", pass: ok(check) },
      { gate: "lint", pass: ok(lint) },
      { gate: "suite", pass: ok(suite) },
      { gate: "scope", pass: scope.pass },
    ],
    tests: heldOutResults(report).map((t) => ({
      ...t,
      result: refereeEvidence(t.result, repo, join(ev, HELD_OUT_FILE)),
    })),
    detail,
  };
}
