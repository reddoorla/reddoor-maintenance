// refute-claims — a standing refuter round for evidence packages and plans.
//
// Recommendation R4 of docs/superpowers/specs/2026-09-14-operating-model-recommendations.md,
// generalised from the census round that produced docs/meta-week/_data/census-refute.json.
// Pure helpers (validation, chunking, cost) live in scripts/meta-week/lib/refute-claims.mjs
// and are covered by tests/meta-week/refute-claims.test.ts.
//
// Run it on a package of ≥10 claims WHOSE EVIDENCE IS ON DISK. Never on prose, never on a
// plan whose claims cannot be re-derived from a file.
//
// ---------------------------------------------------------------------------------------
// REGENERATING THE CORPUS — do this BEFORE either control, every time
// ---------------------------------------------------------------------------------------
//
// The two controls below cite third-party documentation, not repo files: 40 pages of
// https://code.claude.com/docs/ fetched on 2026-09-14. That corpus is NOT committed (it is
// someone else's docs, and `.gitignore` keeps it out); it is re-fetched into
// `docs/meta-week/_corpus/` on demand, and the claims cite it repo-relative from there.
//
//     node scripts/meta-week/fetch-corpus.mjs        # exits 1 on drift or failure
//
// Every page is checked against the sha256 recorded in
// `docs/meta-week/_data/refute-claims-corpus.manifest.json`, which is the copy the claims'
// line anchors were written against. A `drift` line means THAT PAGE CHANGED UNDER A CLAIM:
// the docs are live and edited daily, so the cited line numbers may now point at different
// text, and the round's verdict on every claim citing that page means nothing until those
// anchors are re-derived by hand. Find them with
//
//     grep -n '<page>.md' docs/meta-week/_data/refute-claims-levers*.json
//
// Re-anchor the claims, then re-run. `--update` rewrites the manifest to today's bytes and
// is only correct once that re-anchoring is done — it is not a way to turn a red run green,
// and running it first destroys the record of what the claims were actually written against.
//
// The corpus was already drifting 20/40 pages within six hours of being taken, so assume it
// is stale and check, rather than assuming the last run's copy is still good.
//
// ---------------------------------------------------------------------------------------
// THE TWO CONTROLS — run both before this script is called proven
// ---------------------------------------------------------------------------------------
//
// Both ran on 2026-09-14 and both held: PASS returned 10 confirmed / 6 refuted / 0 unclear
// with every quote at a real line, and FAIL refuted the planted claim while leaving all 16
// shared verdicts identical. They were then RE-RUN blind after the round's own completeness
// critic objected that the first pass was not blind (see below).
//
// CLAIM IDS ARE OPAQUE — `c01`…`c17`, shuffled — and they must stay that way. The first
// version of these controls used `lever-*` for the claims expected to survive and
// `earlier-*` for the ones expected to die, and the skeptic prompt prints the id, so the
// verdict was predictable from the prefix without reading anything. The answer key lives
// in `docs/meta-week/_data/refute-claims-levers.expected.json` and in the test file; this
// script never reads it and no skeptic is given its path. Do not reintroduce a speaking id.
//
// (i) PASS control — the lever survey, 16 claims: 10 stated in their verified form (must
//     come back `confirmed`) and 6 in the earlier survey's wrong form (must come back
//     `refuted`), including the hook-contract error R4 names — a `PreCompact` hook cannot
//     inject context. A round that refutes 2 or more of the 10 true claims is a
//     false-positive generator and does not ship: the silence is the half that tests it.
//
//     Workflow({
//       scriptPath: ".claude/workflows/refute-claims.workflow.js",
//       args: {
//         claimsFile: "docs/meta-week/_data/refute-claims-levers.json",
//         chunk: 3,
//         model: "opus",
//         evidenceHead: "<40-char sha of origin/main at run time>"
//       }
//     })
//
// (ii) FAIL control — the same 16 claims plus one seeded false claim ("the session limit
//      window is 4h", against 10-token-meter.md's measured 5h00m), inserted mid-file so
//      position does not give it away. Expected: that one claim refuted and every other
//      verdict identical to (i). The delta is the signal, not the count.
//
//     Workflow({
//       scriptPath: ".claude/workflows/refute-claims.workflow.js",
//       args: {
//         claimsFile: "docs/meta-week/_data/refute-claims-levers-seeded.json",
//         chunk: 3,
//         model: "opus",
//         evidenceHead: "<40-char sha of origin/main at run time>"
//       }
//     })
//
// `model` is the model the skeptics and the completeness critic run on; it defaults to
// "opus" because R4 specifies one Opus skeptic per claim and the cost figure above is an
// Opus cost — a session running Fable would otherwise silently change both. The guard and
// the loader judge nothing and run on "haiku" at low effort.
//
// The guard reads origin/main with the FULL REFSPEC, `git ls-remote origin refs/heads/main`,
// and matches on the ref name. The glob form is ambiguous here and sorts the wrong ref
// first — `git ls-remote origin main` returns
//
//     91d05fc3fdf9d7dce716cd22d1e06c7e05fb70f5	refs/heads/changeset-release/main
//     aed93a319157d8b21b40db593be943cb36b5993d	refs/heads/main
//
// so a guard reading "the first line" compares against the changeset-release branch and
// fails a checkout that is exactly at main's head.
//
// `evidenceHead` is the sha you believe the evidence checkout is at. The guard reads the
// checkout's real HEAD and origin/main, and the round refuses to run unless all three
// agree — this document's own round read a worktree five commits behind `main` and killed
// a true candidate on markers that exist on `main`.
//
// args: {
//   claimsFile: string,              // path to [{ id, claim, evidence: ["path:line-line"] }]
//   chunk?: number,                  // skeptics in flight, default 3
//   model?: string,                  // model for the skeptics and the critic, default "opus"
//   evidenceHead: string,            // 40-char sha the evidence checkout must be at
//   claims?: array                   // optional: pass the claims inline and skip the loader
// }                                  //   agent, which cannot damage what it never retypes

export const meta = {
  name: "refute-claims",
  description:
    "Refute every claim in an evidence package from the files on disk, after proving the evidence checkout is at main's head",
  phases: [
    { title: "Guard", detail: "the evidence checkout's HEAD must equal origin/main" },
    { title: "Load", detail: "read the claims file verbatim" },
    { title: "Refute", detail: "one skeptic per claim, in chunks, default verdict refuted" },
    { title: "Critique", detail: "what claim is missing, what evidence was not read" },
  ],
};

// The pure rules below are the CANONICAL COPY in scripts/meta-week/lib/refute-claims.mjs,
// pasted here with `export ` stripped because a workflow script has no module loader.
// tests/meta-week/refute-claims.test.ts fails if the two copies drift. Edit the lib, paste here.
// --8<-- shared-with-workflow START
/**
 * Measured on this script's own two controls, 2026-09-14: the PASS control spent
 * 1,244,652 subagent tokens on 16 claims over 19 agents (77,791/claim) and the FAIL
 * control 1,342,927 on 17 over 20 agents (79,001/claim).
 *
 * The earlier data point, kept because it is the only one from a different package: the
 * first census round, 31 claims, 32 agents, 1,981,897 subagent tokens, 7m54s
 * (`docs/meta-week/_data/census-refute.json`) — 63,932/claim. That basis under-predicted
 * the controls by about 20%, which is why it is a comment and not the number.
 */
const MEASURED_ROUND = Object.freeze({
  passClaims: 16,
  passAgents: 19,
  passSubagentTokens: 1244652,
  failClaims: 17,
  failAgents: 20,
  failSubagentTokens: 1342927,
  basis: "measured on the R4 controls, 2026-09-14 (PASS 1.24M/16, FAIL 1.34M/17)",
});

/**
 * 78,000 subagent tokens per claim — between the controls' 77,791 and 79,001, so it
 * under-predicts a 17-claim round by about 1.3%. Guard, loader, skeptics and critic
 * together; there is no separate per-agent term.
 */
const TOKENS_PER_CLAIM = 78000;

/**
 * R4's "mistake if": this round is for packages and plans above ~10 claims. Below that,
 * reading the evidence yourself is cheaper than the fan-out.
 */
const CLAIM_FLOOR = 10;

/** Default skeptics in flight. Three, not the census round's four: other lanes run. */
const DEFAULT_CHUNK = 3;

/**
 * The judging model. R4 specifies one Opus skeptic per claim, and the measured cost above
 * is an Opus cost — so this is pinned rather than inherited from the session, which is
 * routinely Fable. Override with `args.model` only to measure a different one.
 */
const DEFAULT_MODEL = "opus";

/**
 * The model for the two stages that judge nothing: the guard runs three git commands and
 * the loader cats one JSON file. Neither is a reasoning task, and paying Opus rates to
 * read a sha is the dial R4's own pain point PP-E says is welded shut.
 */
const CHORE_MODEL = "haiku";

/** `path:line` or `path:line-line`. The path may be absolute or repo-relative. */
const EVIDENCE_RE = /^(.+):(\d+)(?:-(\d+))?$/;

/**
 * Parse one evidence reference. Returns null unless it names a file AND a line —
 * "read hooks.md" is not a citation, and neither is a bare page name.
 */
function parseEvidenceRef(ref) {
  if (typeof ref !== "string") return null;
  const m = EVIDENCE_RE.exec(ref.trim());
  if (!m) return null;
  const path = m[1].trim();
  if (!path || path.endsWith(":")) return null;
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (!Number.isInteger(from) || from < 1) return null;
  if (!Number.isInteger(to) || to < from) return null;
  return { path, from, to };
}

/**
 * Resolve one evidence path against the evidence checkout's root — the `repoRoot` the guard
 * already derives from the claims file's own directory.
 *
 * The claims packages cite the docs corpus repo-relative (`docs/meta-week/_corpus/hooks.md`)
 * because the corpus is third-party documentation, re-fetched per checkout by
 * `scripts/meta-week/fetch-corpus.mjs` and therefore at a different absolute path in every
 * worktree. The first version of these packages hard-coded one session's scratchpad
 * (`/private/tmp/claude-501/.../scratchpad/docs/`), which no later session could open: every
 * skeptic would have filled `readFailed` and the round would have returned 16 findings about
 * nothing. An ABSOLUTE path is returned unchanged, so a package citing files outside the
 * checkout keeps working.
 *
 * String work only, no `node:path`: a workflow script has no module loader.
 */
function resolveEvidencePath(p, repoRoot) {
  if (typeof p !== "string" || p.trim() === "") return p;
  const rel = p.trim();
  if (rel.startsWith("/")) return rel;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") return rel;
  return `${repoRoot.trim().replace(/\/+$/, "")}/${rel.replace(/^\.\//, "")}`;
}

/** `parseEvidenceRef`, with the path resolved against `repoRoot`. Null on an unparseable ref. */
function resolveEvidenceRef(ref, repoRoot) {
  const parsed = parseEvidenceRef(ref);
  if (parsed === null) return null;
  return { ...parsed, path: resolveEvidencePath(parsed.path, repoRoot) };
}

/**
 * The citation as a skeptic should see it: a path it can actually open, with the line range
 * kept. An unparseable ref is passed through verbatim rather than dropped — the skeptic is
 * told to report what it could not read, and a silently missing line is worse than a bad one.
 */
function formatEvidenceRef(ref, repoRoot) {
  const r = resolveEvidenceRef(ref, repoRoot);
  if (r === null) return String(ref);
  return r.from === r.to ? `${r.path}:${r.from}` : `${r.path}:${r.from}-${r.to}`;
}

/**
 * Validate a parsed claims file. Returns `{ claims, errors }`, and `claims` is empty
 * whenever `errors` is not — a partly-valid package is not a package. A bad claims file
 * is the cheapest failure in the round; sixteen skeptics discovering it one at a time,
 * after the guard has already passed, is the expensive one.
 */
function validateClaims(parsed) {
  const errors = [];
  if (!Array.isArray(parsed)) {
    return { claims: [], errors: ["claims file must be a JSON array of claim objects"] };
  }
  if (parsed.length === 0) {
    return { claims: [], errors: ["claims file is empty"] };
  }
  const seen = new Set();
  const claims = [];
  parsed.forEach((raw, i) => {
    const at = `claim[${i}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${at}: not an object`);
      return;
    }
    const mine = [];
    const id = raw.id;
    const hasId = typeof id === "string" && id.trim() !== "";
    const label = hasId ? `${at} (${id})` : at;
    if (!hasId) mine.push(`${label}: id must be a non-empty string`);
    else if (seen.has(id)) mine.push(`${label}: duplicate id`);
    else seen.add(id);
    if (typeof raw.claim !== "string" || raw.claim.trim() === "") {
      mine.push(`${label}: claim must be a non-empty string`);
    }
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) {
      mine.push(`${label}: evidence must be a non-empty array of "path:line" or "path:line-line"`);
    } else {
      raw.evidence.forEach((ref, j) => {
        if (parseEvidenceRef(ref) === null) {
          mine.push(
            `${label}: evidence[${j}] is not "path:line" or "path:line-line": ${JSON.stringify(ref)}`,
          );
        }
      });
    }
    if (mine.length > 0) {
      errors.push(...mine);
      return;
    }
    claims.push({
      id: raw.id,
      claim: raw.claim,
      evidence: raw.evidence.map((ref) => String(ref).trim()),
      refs: raw.evidence.map((ref) => parseEvidenceRef(ref)),
    });
  });
  return { claims: errors.length === 0 ? claims : [], errors };
}

/**
 * Split into chunks of `size`, preserving order. The round runs a chunk at a time so a
 * concurrent lane is not starved; the second census round used 2 for exactly that reason
 * (`docs/meta-week/_data/census-refute-cab.json`).
 */
function chunkClaims(claims, size = DEFAULT_CHUNK) {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk must be a positive integer, got ${JSON.stringify(size)}`);
  }
  const out = [];
  for (let i = 0; i < claims.length; i += size) out.push(claims.slice(i, i + size));
  return out;
}

/**
 * What the round is about to cost, stated before it is spent. `agents` counts the guard,
 * the loader and the completeness critic alongside the skeptics — the controls ran 19
 * agents for 16 claims and 20 for 17, which is claims + 3; passing `args.claims` inline
 * skips the loader and makes it claims + 2. `subagentTokens` is the measured per-claim
 * rate times the claim count, and models no re-run.
 */
function estimateRound(claimCount, chunk = DEFAULT_CHUNK) {
  if (!Number.isInteger(claimCount) || claimCount < 0) {
    throw new Error(`claimCount must be a non-negative integer, got ${JSON.stringify(claimCount)}`);
  }
  if (!Number.isInteger(chunk) || chunk < 1) {
    throw new Error(`chunk must be a positive integer, got ${JSON.stringify(chunk)}`);
  }
  return {
    claims: claimCount,
    skeptics: claimCount,
    agents: claimCount + 3,
    chunks: Math.ceil(claimCount / chunk),
    chunk,
    subagentTokens: Math.round(TOKENS_PER_CLAIM * claimCount),
    tokensPerClaim: Math.round(TOKENS_PER_CLAIM),
    belowFloor: claimCount < CLAIM_FLOOR,
    basis: MEASURED_ROUND.basis,
  };
}

/** One line for log(), so the cost is on screen before the first skeptic spawns. */
function formatEstimate(est) {
  const floor = est.belowFloor
    ? ` — WARNING: ${est.claims} claims is below the ~${CLAIM_FLOOR}-claim floor R4 sets; read the evidence yourself instead`
    : "";
  return (
    `${est.claims} claims → ${est.agents} agents (1 guard + 1 loader + ${est.skeptics} skeptics + 1 critic) ` +
    `in ${est.chunks} chunk(s) of ${est.chunk}; expected ≈${(est.subagentTokens / 1e6).toFixed(2)}M ` +
    `subagent tokens at the measured ${est.tokensPerClaim}/claim (${est.basis})${floor}`
  );
}

/**
 * The rule the whole round rests on: a `confirmed` verdict must carry a verbatim quote AND
 * the `path:line` it was read from, and that path must be one of the claim's own evidence
 * paths. A confirmation citing nothing is an assertion, so this downgrades it to `unclear`
 * rather than letting it through — the instrument enforces it, not the prompt. Refutations
 * are left alone; `refuted` is the round's default verdict and carries no such privilege.
 *
 * `repoRoot` is optional and only sharpens the comparison: both sides are resolved against
 * it first, so a relative evidence path and the absolute `quoteSource` a skeptic reports
 * after opening the file compare as the same path rather than via the suffix fallback below.
 */
function enforceQuoteRule(verdict, claim, repoRoot) {
  if (verdict.verdict !== "confirmed") return { ...verdict, downgraded: false };
  const ref = resolveEvidenceRef(verdict.quoteSource, repoRoot);
  const quoted = typeof verdict.quote === "string" && verdict.quote.trim() !== "";
  const paths = ((claim && claim.evidence) || [])
    .map((e) => (resolveEvidenceRef(e, repoRoot) || {}).path)
    .filter(Boolean);
  const onEvidence =
    ref !== null &&
    paths.some((p) => p === ref.path || p.endsWith(`/${ref.path}`) || ref.path.endsWith(`/${p}`));
  if (quoted && onEvidence) return { ...verdict, downgraded: false };
  return {
    ...verdict,
    verdict: "unclear",
    downgraded: true,
    downgradeReason: !quoted
      ? "confirmed with no verbatim quote"
      : ref === null
        ? `confirmed with no file:line quoteSource (${JSON.stringify(verdict.quoteSource)})`
        : `confirmed from ${ref.path}, which is not one of the claim's evidence paths`,
  };
}
// --8<-- shared-with-workflow END

const claimsFile = args?.claimsFile;
const evidenceHead = args?.evidenceHead;
const chunk = args?.chunk ?? DEFAULT_CHUNK;
const model = args?.model ?? DEFAULT_MODEL;

if (typeof claimsFile !== "string" || claimsFile.trim() === "") {
  return { error: "args.claimsFile is required", args };
}
if (typeof evidenceHead !== "string" || !/^[0-9a-f]{40}$/.test(evidenceHead)) {
  return { error: "args.evidenceHead must be a 40-char sha", claimsFile, evidenceHead };
}
if (!Number.isInteger(chunk) || chunk < 1) {
  return { error: "args.chunk must be a positive integer", claimsFile, chunk };
}
if (typeof model !== "string" || model.trim() === "") {
  return { error: "args.model must be a non-empty string", claimsFile, model };
}

// ---------------------------------------------------------------------------- Guard

const GUARD = {
  type: "object",
  properties: {
    repoRoot: { type: "string", description: "absolute path of the evidence checkout's git root" },
    head: {
      type: "string",
      description: "40-char sha from git rev-parse HEAD, or empty on failure",
    },
    remoteMain: {
      type: "string",
      description:
        "40-char sha of refs/heads/main from git ls-remote, or empty if that ref was not in the output",
    },
    claimsFileExists: { type: "boolean" },
    trouble: {
      type: "string",
      description: "any command that failed, and its stderr; empty if all succeeded",
    },
  },
  required: ["repoRoot", "head", "remoteMain", "claimsFileExists", "trouble"],
};

phase("Guard");
const guard = await agent(
  `You are a guard. Report facts; decide nothing.

The claims file for a refuter round is at: ${claimsFile}

With Bash, and reporting exactly what the commands print:
1. Resolve the directory holding that file, then \`cd\` there and run \`git rev-parse --show-toplevel\`. That is repoRoot. If the path is relative, resolve it against the current working directory first.
2. From repoRoot, run \`git rev-parse HEAD\` — that is head.
3. From repoRoot, run \`git ls-remote origin refs/heads/main\` — the refspec matters, see below — and take the sha from the line whose SECOND field is exactly \`refs/heads/main\`. That is remoteMain. If no line has that second field, leave remoteMain empty and say so in \`trouble\`; do not fall back to another line.

Use the full refspec, and match on the ref name, because the glob form is ambiguous on this repo: \`git ls-remote origin main\` returns TWO lines and the wrong one FIRST —

    91d05fc3fdf9d7dce716cd22d1e06c7e05fb70f5	refs/heads/changeset-release/main
    aed93a319157d8b21b40db593be943cb36b5993d	refs/heads/main

so "the first line" is the changeset-release branch, and a checkout that IS at main's head would be failed by this guard.
4. Report whether the claims file exists and is readable (\`test -r\`).

Do not fetch, check out, stash, or change anything. Do not "fix" a mismatch — reporting it IS the job. If a command fails, leave that field as an empty string and put the command and its stderr in \`trouble\`.`,
  {
    label: "guard:evidence-head",
    phase: "Guard",
    schema: GUARD,
    model: CHORE_MODEL,
    effort: "low",
  },
);

if (!guard) {
  return { error: "guard agent returned nothing", claimsFile, evidenceHead };
}
if (guard.head !== guard.remoteMain || guard.head !== evidenceHead) {
  return {
    error: "evidence not at main's head",
    detail:
      "the round read nothing. Bring the evidence checkout to origin/main (or correct args.evidenceHead) and re-run — a round over a stale checkout kills true claims on markers that exist on main.",
    claimsFile,
    repoRoot: guard.repoRoot,
    head: guard.head,
    remoteMain: guard.remoteMain,
    evidenceHead,
    trouble: guard.trouble,
  };
}
if (!guard.claimsFileExists) {
  return {
    error: "claims file not readable",
    claimsFile,
    repoRoot: guard.repoRoot,
    trouble: guard.trouble,
  };
}
log(`guard: ${guard.repoRoot} at ${guard.head.slice(0, 8)} = origin/main = args.evidenceHead`);

// ----------------------------------------------------------------------------- Load

let parsed = args?.claims;
if (!Array.isArray(parsed)) {
  phase("Load");
  const loaded = await agent(
    `Read the JSON file at ${claimsFile} with Bash (\`cat\`) and return its contents VERBATIM as the \`claims\` field.

It is an array of objects, each \`{ id, claim, evidence: ["path:line" or "path:line-line", ...] }\`. Copy every id, every claim string and every evidence reference exactly as written — character for character. Do NOT summarise, re-word, shorten, re-order, de-duplicate, correct, or judge anything. You are a file reader. If the file is not valid JSON, return an empty array and say so in \`note\`.`,
    {
      label: "load:claims",
      phase: "Load",
      model: CHORE_MODEL,
      effort: "low",
      schema: {
        type: "object",
        properties: {
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                claim: { type: "string" },
                evidence: { type: "array", items: { type: "string" } },
              },
              required: ["id", "claim", "evidence"],
            },
          },
          note: { type: "string" },
        },
        required: ["claims", "note"],
      },
    },
  );
  if (!loaded) return { error: "loader agent returned nothing", claimsFile };
  parsed = loaded.claims;
  if (loaded.note) log(`loader: ${loaded.note}`);
}

const { claims, errors } = validateClaims(parsed);
if (errors.length > 0) {
  return { error: "claims file is not valid", claimsFile, problems: errors };
}

const estimate = estimateRound(claims.length, chunk);
log(formatEstimate(estimate));

// --------------------------------------------------------------------------- Refute

const VERDICT = {
  type: "object",
  properties: {
    id: { type: "string" },
    verdict: { type: "string", enum: ["confirmed", "refuted", "unclear"] },
    reason: {
      type: "string",
      description: "what the evidence actually says, and why that settles it",
    },
    quote: { type: "string", description: "the verbatim line from the evidence that decides it" },
    quoteSource: {
      type: "string",
      description:
        '"path:line" the quote was read from; must be one of the claim\'s evidence paths',
    },
    evidenceRead: {
      type: "array",
      items: { type: "string" },
      description: "every evidence reference you actually opened",
    },
    readFailed: {
      type: "array",
      items: { type: "string" },
      description: "evidence references you could not open, and why",
    },
    restsOnAbsence: {
      type: "boolean",
      description:
        "true if the verdict rests on something NOT being in the file rather than on a quoted line",
    },
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
};

function refutePrompt(c) {
  return `You are a skeptic. Your job is to REFUTE the claim below, not to agree with it.

CLAIM ${c.id}: ${c.claim}

Evidence cited for it (path:line, already resolved against the evidence checkout at ${guard.repoRoot} — open them exactly as written):
${c.evidence.map((e) => `  - ${formatEvidenceRef(e, guard.repoRoot)}`).join("\n")}

THE RULES OF THIS ROUND, all three learned the hard way:

1. READ THE EVIDENCE FROM DISK. Open every path above with Bash — \`sed -n 'START,ENDp' FILE\` around the cited lines, and widen the range until you have the surrounding context. What you remember about Claude Code, this repo, or these settings is NOT evidence, however confident you are; earlier rounds refuted true claims from priors and confirmed false ones the same way. If a path will not open, put it in \`readFailed\` — do not substitute your own knowledge for it.

2. DEFAULT TO "refuted". A claim earns "confirmed" only when a line you have read on disk says it, and you must return that line verbatim in \`quote\` with the exact \`path:line\` you read it from in \`quoteSource\`. A confirmation with no quote is downgraded to "unclear" by the caller, so an unquoted confirmation is worth nothing. Use "unclear" when the evidence neither says it nor contradicts it.

3. AN ABSENCE IS NOT A REFUTATION. If your verdict rests on something not appearing in the file rather than on a line that contradicts the claim, set \`restsOnAbsence\` to true and prefer "unclear" to "refuted" — the file may not be where that fact lives, or the renderer may not print it. Eight census refutations rested on "no compaction in the window", which turned out to be the window renderer, not a finding.

Try hardest to kill it: is the cited line actually about this claim, or a neighbouring one? Does the claim state a default the docs give differently? Does it state as unconditional something the file conditions on a version, a scope, a mode, or a platform? Does it name a field that the file gives to a different event? Is the claim a paraphrase that has drifted from what the line says?

Return only the structured verdict.`;
}

phase("Refute");
const results = [];
const batches = chunkClaims(claims, chunk);
for (const batch of batches) {
  const got = await parallel(
    batch.map(
      (c) => () =>
        agent(refutePrompt(c), {
          label: `refute:${c.id}`,
          phase: "Refute",
          schema: VERDICT,
          model,
        }),
    ),
  );
  results.push(...got.filter(Boolean));
  log(`${results.length}/${claims.length} claims read`);
}

const byId = new Map(claims.map((c) => [c.id, c]));
const verdicts = results.map((r) => enforceQuoteRule(r, byId.get(r.id), guard.repoRoot));
const downgraded = verdicts.filter((v) => v.downgraded);
if (downgraded.length > 0) {
  log(
    `${downgraded.length} confirmation(s) downgraded to unclear for citing no line on the claim's own evidence`,
  );
}
const blind = verdicts.filter((v) => (v.readFailed ?? []).length > 0);
if (blind.length > 0) {
  log(
    `${blind.length}/${verdicts.length} skeptic(s) could not open some evidence — if that is most of them the evidence root has moved, and the verdicts are about nothing: ${blind[0].readFailed.join("; ")}`,
  );
}
const missing = claims.filter((c) => !verdicts.some((v) => v.id === c.id));
if (missing.length > 0) {
  log(
    `NOT COVERED: ${missing.length} claim(s) returned no verdict — ${missing.map((c) => c.id).join(", ")}`,
  );
}

const confirmed = verdicts.filter((v) => v.verdict === "confirmed");
const refuted = verdicts.filter((v) => v.verdict === "refuted");
const unclear = verdicts.filter((v) => v.verdict === "unclear");

// ------------------------------------------------------------------------- Critique

const CRITIQUE = {
  type: "object",
  properties: {
    missingClaims: {
      type: "array",
      items: { type: "string" },
      description:
        "claims the package should have made and did not — load-bearing assertions with no id of their own",
    },
    evidenceNotRead: {
      type: "array",
      items: { type: "string" },
      description:
        "evidence a verdict should have opened and did not, and which verdict is weaker for it",
    },
    weakVerdicts: {
      type: "array",
      items: { type: "string" },
      description:
        "verdicts whose reason does not follow from the quote, or which rest on an absence",
    },
    strongestRefutations: {
      type: "array",
      items: { type: "string" },
      description: "the refutations most worth acting on, by evidence quality",
    },
  },
  required: ["missingClaims", "evidenceNotRead", "weakVerdicts", "strongestRefutations"],
};

phase("Critique");
const line = (v) =>
  `- ${v.id} [${v.verdict}${v.downgraded ? ", downgraded" : ""}${v.restsOnAbsence ? ", rests on absence" : ""}] ${byId.get(v.id)?.claim ?? ""}\n    reason: ${v.reason}\n    quote: "${v.quote}" (${v.quoteSource})\n    read: ${(v.evidenceRead ?? []).join("; ") || "nothing"}${(v.readFailed ?? []).length ? `\n    FAILED TO READ: ${v.readFailed.join("; ")}` : ""}`;

const critique = await agent(
  `A refuter round over the claims package ${claimsFile} has finished. ${claims.length} claims, each read by one skeptic told to default to "refuted" and to quote a line from disk for any confirmation. Result: ${confirmed.length} confirmed, ${refuted.length} refuted, ${unclear.length} unclear${downgraded.length ? ` (${downgraded.length} of those downgraded from confirmed for citing no line)` : ""}${missing.length ? `; ${missing.length} claim(s) returned no verdict at all: ${missing.map((c) => c.id).join(", ")}` : ""}.

The evidence checkout is ${guard.repoRoot} at ${guard.head}, which equals origin/main.

Verdicts:
${verdicts.map(line).join("\n")}

You are the completeness critic. The skeptics each saw one claim; you see the package. Answer, concretely and short, reading files yourself where you need to:

1. missingClaims — what claim is MISSING? What does this package rest on that no claim states, so no skeptic read it? Name the assertion and the file that would settle it.
2. evidenceNotRead — what evidence was NOT read? Look at the \`read\` and \`FAILED TO READ\` lines: which verdict turns on a file nobody opened, or on one cited line where the surrounding section says something else? Name the verdict and the path.
3. weakVerdicts — which verdicts do not follow from their own quote, or rest on an absence rather than a contradicting line?
4. strongestRefutations — which refutations are the ones to act on, by evidence quality and not by how interesting they are?

Do not re-adjudicate every claim. Find what the method could not see.`,
  { label: "completeness-critic", phase: "Critique", schema: CRITIQUE, model },
);

return {
  ok: true,
  claimsFile,
  repoRoot: guard.repoRoot,
  head: guard.head,
  remoteMain: guard.remoteMain,
  evidenceHead,
  model,
  estimate,
  counts: {
    claims: claims.length,
    verdicts: verdicts.length,
    confirmed: confirmed.length,
    refuted: refuted.length,
    unclear: unclear.length,
    downgraded: downgraded.length,
    noVerdict: missing.length,
  },
  noVerdictIds: missing.map((c) => c.id),
  verdicts,
  critique,
};
