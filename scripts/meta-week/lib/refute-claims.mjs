// Pure rules for the refute-claims round (.claude/workflows/refute-claims.workflow.js).
// No I/O, no Node APIs, no clock.
//
// This file is the CANONICAL COPY. Workflow scripts run without a module loader, so the
// workflow cannot import it; it carries the same block inline, `export ` stripped, between
// the same sentinels. tests/meta-week/refute-claims.test.ts asserts the two are identical
// character for character, so the duplication cannot drift silently. Edit here, then paste.
//
// See docs/superpowers/specs/2026-09-14-operating-model-recommendations.md §R4.

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
export const MEASURED_ROUND = Object.freeze({
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
export const TOKENS_PER_CLAIM = 78000;

/**
 * R4's "mistake if": this round is for packages and plans above ~10 claims. Below that,
 * reading the evidence yourself is cheaper than the fan-out.
 */
export const CLAIM_FLOOR = 10;

/** Default skeptics in flight. Three, not the census round's four: other lanes run. */
export const DEFAULT_CHUNK = 3;

/**
 * The judging model. R4 specifies one Opus skeptic per claim, and the measured cost above
 * is an Opus cost — so this is pinned rather than inherited from the session, which is
 * routinely Fable. Override with `args.model` only to measure a different one.
 */
export const DEFAULT_MODEL = "opus";

/**
 * The model for the two stages that judge nothing: the guard runs three git commands and
 * the loader cats one JSON file. Neither is a reasoning task, and paying Opus rates to
 * read a sha is the dial R4's own pain point PP-E says is welded shut.
 */
export const CHORE_MODEL = "haiku";

/** `path:line` or `path:line-line`. The path may be absolute or repo-relative. */
const EVIDENCE_RE = /^(.+):(\d+)(?:-(\d+))?$/;

/**
 * Parse one evidence reference. Returns null unless it names a file AND a line —
 * "read hooks.md" is not a citation, and neither is a bare page name.
 */
export function parseEvidenceRef(ref) {
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
export function resolveEvidencePath(p, repoRoot) {
  if (typeof p !== "string" || p.trim() === "") return p;
  const rel = p.trim();
  if (rel.startsWith("/")) return rel;
  if (typeof repoRoot !== "string" || repoRoot.trim() === "") return rel;
  return `${repoRoot.trim().replace(/\/+$/, "")}/${rel.replace(/^\.\//, "")}`;
}

/** `parseEvidenceRef`, with the path resolved against `repoRoot`. Null on an unparseable ref. */
export function resolveEvidenceRef(ref, repoRoot) {
  const parsed = parseEvidenceRef(ref);
  if (parsed === null) return null;
  return { ...parsed, path: resolveEvidencePath(parsed.path, repoRoot) };
}

/**
 * The citation as a skeptic should see it: a path it can actually open, with the line range
 * kept. An unparseable ref is passed through verbatim rather than dropped — the skeptic is
 * told to report what it could not read, and a silently missing line is worse than a bad one.
 */
export function formatEvidenceRef(ref, repoRoot) {
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
export function validateClaims(parsed) {
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
export function chunkClaims(claims, size = DEFAULT_CHUNK) {
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
export function estimateRound(claimCount, chunk = DEFAULT_CHUNK) {
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
export function formatEstimate(est) {
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
export function enforceQuoteRule(verdict, claim, repoRoot) {
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
