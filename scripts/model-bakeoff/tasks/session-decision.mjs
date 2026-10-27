// P1-83d class (a): a decision file and a journal entry from a frozen set of facts, under the
// home base's rules (decisions/README.md; CLAUDE.md "Asking, and finishing" and "Journals").
// The facts are synthetic. Traps: times are given in UTC and must read as PT in prose, a
// reproduced defect is still open so "land as is" may not be the pick, and the Usage line's
// figures must be copied, not rounded away.
import { basename } from "node:path";
import { parseDecision } from "../../decisions.mjs";

export const id = "session-decision";
export const title = "Decision file and journal entry from frozen facts";

export const FACTS = {
  session: "https://claude.ai/code/session_01EXAMPLEbakeoffP183dFACTS",
  asked: "2026-10-27T16:12:00Z",
  refs: ["reddoorla/reddoor-maintenance#1690", "reddoorla/reddoor-maintenance#1688"],
  usage: {
    cost: "4.2731",
    input: "1834",
    output: "90211",
    cacheRead: "5120334",
    cacheWrite: "402118",
    rateLimit: "allowed",
  },
  measured: "2.735",
};

export function prompt() {
  const u = FACTS.usage;
  return [
    "You are the worker on backlog item P1-77 (a synthetic item for this measurement). Write the decision file this repository's rules call for at a stop condition, and the journal entry for the session, from these facts alone:",
    "",
    "- PR reddoorla/reddoor-maintenance#1690 makes `land-prs.mjs` re-read a PR's head SHA after CI and refuse the merge when it moved. It builds on reddoorla/reddoor-maintenance#1688.",
    "- Review round 5 finished at 2026-10-27T16:05Z and was dirty: one `major` finding, reproduced. Input: a PR whose head moved from abc1234 to def5678 while CI ran. Wrong output: `land-prs.mjs` merged def5678, which CI never ran on.",
    "- Rounds 1 to 4 each had at least one `major` finding; all were fixed.",
    "- A measured number from the work: the gate's check now takes 2.735× as long as before.",
    "- The options: (a) land with the finding open, on the operator's word; (b) a sixth round that fixes it, with his leave; (c) close the PR and re-plan the gate.",
    `- You ask at ${FACTS.asked}. Your session's URL is ${FACTS.session}.`,
    `- get_session's usage just now: cost_usd ${u.cost}, input ${u.input}, output ${u.output}, cache read ${u.cacheRead}, cache write ${u.cacheWrite}, rate limit status ${u.rateLimit}.`,
    "",
    "Do not write the files: return their names and full texts. The json block's shape:",
    '{"decision": {"filename": path from the repository root, "text": the whole file}, "journal": {"filename": path from the repository root, "text": the whole file}}',
  ].join("\n");
}

export function truth() {
  return FACTS;
}

export const checkCount = 13;

const frontMatter = (text) => {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fields = Object.fromEntries(
    m[1].split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  return { fields, body: m[2] };
};
const refsOf = (v) =>
  String(v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
// A time in UTC written for a reader: `16:05Z`, `T16:05Z` or `16:05 UTC`.
// A PT time for 16:05Z: 9:05am PT, 09:05 a.m. PDT.
const PT_0905 = /(?<!\d)0?9:05\s*a\.?m\.?\s*P[DS]?T\b/i;
const Z_TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z\b|UTC\b)/;
const BARE_REF = /(^|[^\w/.-])#\d{2,}\b/m;
// The option a Pick section chooses: the first "(b)", "option c" or a leading "B," that is not
// negated ("not (a)", "rather than (a)").
const firstOption = (text) => {
  const t = String(text)
    .replace(/\(?a\)?[^.\n]*?\bruled out\b/gi, "")
    .replace(/\b(?:not|neither|nor|rather than|over|instead of)\s+(?:option\s+)?\(?[abc]\)?/gi, "");
  const m = t.match(
    /\(([abc])\)|\boption\s+\(?([abc])\b|^\W*(?:(?:my\s+)?pick:?\s*)?([abc])\b\s*[),.:—–-]/im,
  );
  return m ? (m[1] ?? m[2] ?? m[3]).toLowerCase() : null;
};

export function check(out, f) {
  const d = out?.decision ?? {};
  const j = out?.journal ?? {};
  const dText = String(d.text ?? "");
  const jText = String(j.text ?? "");
  const fm = frontMatter(dText);
  const body = fm?.body ?? "";
  // The repository's own checker, so the scorer and `decisions.mjs check` cannot disagree.
  // Read at the moment asked, so "asked is in the future" depends on nothing but the file.
  const parsed = parseDecision(
    basename(String(d.filename ?? "decision.md")),
    dText,
    Date.parse(f.asked),
  );
  const firstLine = parsed.ask ?? "";
  const pickSection =
    (body.match(/^##[^\n]*\bpick\b[^\n]*\n([\s\S]*?)(?=\n## |(?![\s\S]))/im) ?? [])[1] ?? "";
  const usageLine =
    jText
      .split("\n")
      .filter((l) => l.trim())
      .at(-1) ?? "";
  const u = f.usage;
  // The rule's order: cost, input/output tokens, cache read/write, rate limit. The cost may be
  // rounded to the cent, never to another figure.
  const um = usageLine
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .match(
      /^\s*Usage:\s*\$(\d+(?:\.\d+)?),?\s+(\d+)\s*\/\s*(\d+)\s+tokens,?\s+(\d+)\s*\/\s*(\d+)\s+cache/,
    );
  const usageOk =
    !!um &&
    Math.abs(Number(um[1]) - Number(u.cost)) < 0.005 &&
    [um[2], um[3], um[4], um[5]].join("/") ===
      [u.input, u.output, u.cacheRead, u.cacheWrite].join("/") &&
    new RegExp(`rate limit (?:status )?${u.rateLimit}\\b`).test(usageLine);
  const asked = f.asked.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*/, "$1-$2-$3-$4$5");
  const c = (check, ok, got, want) => ({ check, ok: !!ok, got, want });
  return [
    c(
      "decision filename",
      new RegExp(`^decisions/${asked}-[a-z0-9-]+\\.md$`).test(d.filename ?? ""),
      d.filename,
      `decisions/${asked}-<slug>.md`,
    ),
    c("front matter status open", fm?.fields.status === "open", fm?.fields.status, "open"),
    c(
      "front matter asked",
      Date.parse(fm?.fields.asked ?? "") === Date.parse(f.asked),
      fm?.fields.asked,
      f.asked,
    ),
    c("front matter from", fm?.fields.from === f.session, fm?.fields.from, f.session),
    c(
      "front matter refs",
      refsOf(fm?.fields.refs).includes(f.refs[0]) &&
        refsOf(fm?.fields.refs).every((r) => f.refs.includes(r)),
      fm?.fields.refs,
      f.refs,
    ),
    c(
      "decisions.mjs parses it; the ask is a question",
      parsed.errors.length === 0 && /\?\s*$/.test(firstLine),
      parsed.errors.length ? parsed.errors : firstLine,
      "no errors, an ask ending in ?",
    ),
    c("has ## Answer", /^## Answer\s*$/m.test(body), null, "## Answer"),
    c(
      // CLAUDE.md: a pick may not be "land as is" while a reproduced defect is unfixed.
      "pick is not (a)",
      ["b", "c"].includes(firstOption(pickSection)),
      pickSection.trim().split("\n")[0],
      "(b) or (c)",
    ),
    c(
      "round 5 time in PT",
      PT_0905.test(dText) || PT_0905.test(jText),
      (dText.match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?\s*\w*/i) ?? [null])[0],
      "9:05am PT",
    ),
    c(
      "no UTC times in prose",
      !Z_TIME.test(body) && !Z_TIME.test(jText.replace(/^Usage:.*$/m, "")),
      (body.match(Z_TIME) ?? jText.match(Z_TIME) ?? [null])[0],
      "none",
    ),
    c(
      "no bare #NNN",
      !BARE_REF.test(dText) && !BARE_REF.test(jText),
      (dText.match(BARE_REF) ?? jText.match(BARE_REF) ?? [null])[0],
      "owner/repo#NNN",
    ),
    c("journal names the measured number", jText.includes(f.measured), null, f.measured),
    c("journal ends with the Usage line", usageOk, usageLine, "Usage: $4.27, 1834/90211 …"),
  ];
}

export const arms = [
  { id: "sonnet-1", model: "sonnet" },
  { id: "sonnet-2", model: "sonnet" },
  { id: "opus-1", model: "opus" },
  { id: "opus-2", model: "opus" },
];
