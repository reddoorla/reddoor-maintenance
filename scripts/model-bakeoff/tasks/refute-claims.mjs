import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  enforceQuoteRule,
  refutePrompt,
  validateClaims,
} from "../../meta-week/lib/refute-claims.mjs";

export const id = "refute-claims";
export const title = "T5 refute-claims skeptics on the seeded levers control";
export const row = 5;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The answer key. It is read from the repo, never copied into the frozen input: no arm may
// see it, which is the same rule the refute-claims workflow keeps.
export const KEY_FILE = "docs/meta-week/_data/refute-claims-levers.expected.json";
export const SEEDED_FILE = "docs/meta-week/_data/refute-claims-levers-seeded.json";

// The claims of the seeded control, in its order, with their text unchanged. Only the
// evidence lines differ. The docs corpus they cite is fetched, not committed, and 39 of its
// 40 pages had changed since the 2026-09-14 copy the control's anchors were written against
// (`fetch-corpus.mjs`, 2026-10-19), so each anchor was moved by hand to the passage it cited
// in today's page. Each fact behind a label was re-read there and still holds: for example
// the exit-code-2 table still has exactly 16 "Yes" rows. The test checks ids, order, text
// and kind against SEEDED_FILE.
export const CLAIMS = [
  ["c01", ["corpus/hooks.md:1507-1524", "corpus/hooks.md:2798-2806"]],
  ["c02", ["corpus/settings-reference.md:3026-3032"]],
  ["c03", ["corpus/env-vars.md:324-331", "corpus/sub-agents.md:1063-1067"]],
  ["c04", ["corpus/hooks.md:2577-2583"]],
  ["c05", ["corpus/cli-reference.md:104-106"]],
  ["c06", ["corpus/interactive-mode.md:17-24"]],
  ["c07", ["corpus/hooks.md:3273-3288", "corpus/hooks.md:1122-1128"]],
  ["c08", ["corpus/hooks.md:981-1019"]],
  ["c09", ["corpus/hooks.md:728-741", "corpus/sub-agents.md:304-311"]],
  ["c17", ["meta/10-token-meter.md:175-181"]],
  ["c10", ["corpus/env-vars.md:476"]],
  ["c11", ["corpus/hooks.md:2577-2583"]],
  ["c12", ["corpus/hooks.md:728-741", "corpus/hooks.md:2734-2738"]],
  ["c13", ["corpus/hooks.md:1122-1128", "corpus/hooks.md:1507-1524"]],
  ["c14", ["corpus/settings-reference.md:1068-1075"]],
  ["c15", ["corpus/hooks.md:3273-3288"]],
  ["c16", ["corpus/env-vars.md:329"]],
];

// The bytes the anchors above were written against: the six docs pages fetched on 2026-10-19
// and the in-repo token meter. `truth` refuses a frozen input whose
// pages differ, because a moved line silently changes what every claim citing it says.
export const PAGES = {
  "corpus/hooks.md": "5599b94537beb359bfe35dfa7538503194ea78b8d824fcaccba068915d6a77d7",
  "corpus/settings-reference.md":
    "8ba90434d2801f9e7b3dc44e304bea0e3ca94c25d540cdcf9763369deeb355e4",
  "corpus/env-vars.md": "9f613e71065bbe0a04e97fe201916111eaefedc15af4471316f584a875448995",
  "corpus/sub-agents.md": "2ef84ba688983c9d7c28015fd3b06a9056b0be11efc7ff8f4b39552d36582d8a",
  "corpus/cli-reference.md": "81d5a5b49f43566ba0f43c7725dae858cad39c20b297cc5efbde5e4759462cbf",
  "corpus/interactive-mode.md": "c5c6c87891f9cb427800ffaf72770c72dd9effe82a4cf25d2d67b944ea193aac",
  // In the repo, but edited since the control was written (2026-09-17), so pinned too.
  "meta/10-token-meter.md": "b4f5a095540057a85828a22e013113b56f69974f432c9d44478ea20b7a83bd7a",
};

// The docs pages are gitignored, so fetch them before `prepare`, or it stops on ENOENT:
//   node scripts/meta-week/fetch-corpus.mjs   (reports drift against the 2026-09-14 manifest,
//   which is expected; `truth` checks the bytes against PAGES instead)
export const sources = [
  {
    from: "docs/meta-week/_corpus",
    match: /^(hooks|settings-reference|env-vars|sub-agents|cli-reference|interactive-mode)\.md$/,
    to: "corpus",
  },
  { from: "docs/meta-week", match: /^10-token-meter\.md$/, to: "meta" },
];

export const collections = [
  { name: "verdicts", key: "id", keyKind: "string", fields: { verdict: "string" } },
];

const strings = { type: "array", items: { type: "string" } };

export const schema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["confirmed", "refuted", "unclear", "untested"] },
          reason: { type: "string" },
          quote: { type: "string" },
          quoteSource: { type: "string" },
          evidenceRead: strings,
          readFailed: strings,
          restsOnAbsence: { type: "boolean" },
          experiment: { type: "string" },
        },
        required: [
          "id",
          "verdict",
          "reason",
          "quote",
          "quoteSource",
          "evidenceRead",
          "readFailed",
          "restsOnAbsence",
        ],
      },
    },
  },
  required: ["verdicts"],
};

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** The seeded control's claims with this task's evidence, validated as the workflow does. */
export function claims(seeded = readJson(join(REPO, SEEDED_FILE))) {
  const byId = new Map(seeded.map((c) => [c.id, c]));
  const { claims: valid, errors } = validateClaims(
    CLAIMS.map(([cid, evidence]) => {
      const c = byId.get(cid);
      if (!c) throw new Error(`${cid} is not in ${SEEDED_FILE}`);
      return { ...c, evidence };
    }),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return valid;
}

// The production skeptic prompt, once per claim, word for word: `refutePrompt` from the
// lib the workflow's copy is tested against. The one change is that a single agent gets
// all seventeen, where the workflow spawns one skeptic per claim.
export function prompt(dir) {
  const all = claims();
  return [
    `This is a refuter round over ${all.length} claims, given to you one after another. Treat each block between the ===== lines as its own task, judged only on its own evidence, and return one entry in \`verdicts\` per claim, with its id copied exactly. A claim whose verdict you cannot reach still gets an entry. The evidence files are in the frozen folder ${dir}.`,
    ...all.map((c) => `===== CLAIM ${c.id}\n${refutePrompt(c, dir)}`),
    "=====",
    `Return all ${all.length} verdicts in one structured output.`,
  ].join("\n\n");
}

// The same prompt as the arms: the gold is Opus at the session effort, run as production
// runs it, not a scripted reference. The reference is the answer key.
export const goldAddendum = "";

export function verifyPages(dir, pages = PAGES) {
  const sha = (p) => {
    try {
      return createHash("sha256")
        .update(readFileSync(join(dir, p)))
        .digest("hex");
    } catch {
      return null;
    }
  };
  const bad = Object.entries(pages)
    .filter(([p, want]) => sha(p) !== want)
    .map(([p]) => p);
  if (bad.length) {
    throw new Error(
      `the frozen corpus is not the copy the anchors were written against: ${bad.join(", ")}. Re-anchor CLAIMS and PAGES before scoring.`,
    );
  }
}

/** The answer key as the scored reference: one `{ id, verdict }` per claim, in claim order. */
export function labels(key = readJson(join(REPO, KEY_FILE))) {
  return {
    verdicts: claims().map((c) => {
      const label = key.expected[c.id];
      if (!label) throw new Error(`${c.id} has no label in ${KEY_FILE}`);
      return { id: c.id, verdict: label.verdict };
    }),
  };
}

export function truth(dir) {
  verifyPages(dir);
  return labels();
}

// ---- the decision metric ---------------------------------------------------------------
//
// Each arm's verdicts go through `enforceQuoteRule`, the workflow's own instrument, first:
// an unquoted confirmation counts as "unclear" and a behaviour claim can only be "refuted" or
// "untested", exactly as a production round would record them. Then, against the key:
//
// - catches: false claims (labelled "refuted") the arm refuted. c17 is the seeded one; the
//   other six are the earlier survey's wrong forms, c07 among them (the error R4 names).
// - wrongRefutations: true claims (labelled "confirmed" or "untested") the arm refuted.
// - unconfirmed: the 9 true documentary claims the arm did not confirm, refuted or not.
//
// A run passes on the PASS control's own lines (the workflow header and the key's
// passExpectation): every false claim caught, c03 "untested", and fewer than 2 of the 9 true
// documentary claims left unconfirmed. Counting "unclear" there, not only "refuted", is what
// fails an arm that never confirms anything, and an unquoted confirmation the quote rule
// downgrades. An arm qualifies only if every run of it passes; the gold is held to the same
// lines. The pre-run version (b7c5b538) counted only refutations, over 10 claims with c03
// among them, and passed an arm that confirmed nothing; review round 1 caught it. No arm of
// the 2026-10-19 run passes under one version and fails under the other.

export function tally(output, dir, key = readJson(join(REPO, KEY_FILE))) {
  const all = claims();
  const given = new Map();
  for (const v of (output && output.verdicts) || []) {
    if (v && !given.has(v.id)) given.set(v.id, v);
  }
  const t = {
    falseClaims: 0,
    catches: 0,
    missed: [],
    trueClaims: 0,
    wrongRefutations: 0,
    wrong: [],
    unconfirmed: [],
    behavior: null,
    noVerdict: [],
    downgraded: [],
  };
  for (const c of all) {
    const label = key.expected[c.id].verdict;
    const v = given.get(c.id);
    if (!v) t.noVerdict.push(c.id);
    const effective = v ? enforceQuoteRule(v, c, dir) : null;
    if (effective && effective.downgraded) t.downgraded.push(c.id);
    const verdict = effective ? effective.verdict : null;
    if (c.kind === "behavior") t.behavior = verdict;
    if (label === "refuted") {
      t.falseClaims++;
      if (verdict === "refuted") t.catches++;
      else t.missed.push(c.id);
      continue;
    }
    t.trueClaims++;
    if (verdict === "refuted") {
      t.wrongRefutations++;
      t.wrong.push(c.id);
    }
    if (c.kind !== "behavior" && verdict !== "confirmed") t.unconfirmed.push(c.id);
  }
  return t;
}

export const SHIP_LINE = 2;

export function passes(t) {
  return t.missed.length === 0 && t.behavior === "untested" && t.unconfirmed.length < SHIP_LINE;
}

export const arms = [
  { id: "opus-medium-1", model: "opus", effort: "medium" },
  { id: "opus-medium-2", model: "opus", effort: "medium" },
  { id: "opus-low-1", model: "opus", effort: "low" },
  { id: "opus-low-2", model: "opus", effort: "low" },
  { id: "sonnet-high-1", model: "sonnet", effort: "high" },
  { id: "sonnet-high-2", model: "sonnet", effort: "high" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
];

// The skeptics have no effort of their own and inherit the session's, which is `xhigh` on
// the operator's laptop, so the gold names it.
export const gold = { id: "gold", model: "opus", effort: "xhigh" };
