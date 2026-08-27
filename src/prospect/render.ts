import { escapeHtml, safeUrl } from "../util/html.js";
import { hostnameOf } from "../util/url.js";
import { ANALYZE_SKIPPED, PROBES_SKIPPED } from "./pipeline.js";
import { resolveBusinessName } from "./probes.js";
import type {
  AnalyzeResult,
  ChecksResult,
  Fix,
  LighthouseScores,
  ProbeAnswer,
  ProbesResult,
  ProspectAuditResult,
  StageResult,
} from "./types.js";

const RED = "#d71920";
const IMPACT_ORDER: Record<Fix["impact"], number> = { high: 0, medium: 1, low: 2 };
const KIND_LABEL: Record<ProbeAnswer["kind"], string> = {
  branded: "Branded — asked about the business by name",
  category: "Category — the questions a buyer would actually type",
  competitor: "Competitor — head-to-head comparisons",
};
const KIND_ORDER: ProbeAnswer["kind"][] = ["category", "branded", "competitor"];

/** Terse product mapping so a recipient who has never seen a crawler's raw
 *  user-agent string can place it — factual labelling, not a voice change. */
const AI_AGENT_LABELS: Record<string, string> = {
  GPTBot: "ChatGPT",
  "OAI-SearchBot": "ChatGPT's search results",
  ClaudeBot: "Claude",
  PerplexityBot: "Perplexity",
  "Google-Extended": "Gemini and Google's AI Overviews",
  CCBot: "Common Crawl, used to train many AI models",
};

function describeAgent(agent: string): string {
  const label = AI_AGENT_LABELS[agent];
  return label ? `${agent} (feeds ${label})` : agent;
}

/** Every genuine stage failure collapses to this one phrase — the real error
 *  (status codes, retry counts, timeouts — operator vocabulary) stays in the
 *  persisted JSON and CLI output for operators, but never reaches a stranger
 *  who would read it as broken software rather than a diagnostic. */
const STAGE_FAILED_MESSAGE = "we could not complete this part of the analysis";

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #faf8f5; color: #1a1a1a;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
  h1, h2, h3 { font-family: Besley, Georgia, "Times New Roman", serif; font-weight: 600; line-height: 1.2; }
  h1 { font-size: 40px; margin: 0 0 8px; }
  h2 { font-size: 26px; margin: 48px 0 12px; border-top: 2px solid #e6e1da; padding-top: 24px; }
  h3 { font-size: 18px; margin: 24px 0 8px; }
  .lede { color: #57544f; margin: 0 0 8px; }
  .scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 32px 0; }
  .score { background: #fff; border: 1px solid #e6e1da; border-radius: 8px; padding: 16px; }
  .score .n { font-family: Besley, Georgia, serif; font-size: 38px; line-height: 1; color: ${RED}; }
  .score .n.na { font-size: 18px; color: #8a857e; }
  .score .l { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #57544f; margin-top: 8px; }
  .score .hint { font-size: 12px; color: #8a857e; margin-top: 4px; }
  .card { background: #fff; border: 1px solid #e6e1da; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .q { font-weight: 600; }
  .tag { display: inline-block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    border-radius: 999px; padding: 2px 10px; border: 1px solid currentColor; }
  .yes { color: #14663c; } .partial { color: #8a6d00; } .no { color: ${RED}; }
  ul { padding-left: 20px; } li { margin: 6px 0; }
  .muted { color: #8a857e; }
  .cta { margin-top: 56px; background: ${RED}; color: #fff; border-radius: 8px; padding: 24px 28px; }
  .cta h2 { border: 0; padding: 0; margin: 0 0 8px; color: #fff; }
  .cta a { color: #fff; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  @media print {
    body { background: #fff; }
    .card, .score, .cta { break-inside: avoid; }
    /* Browsers default "print background graphics" OFF, which drops the red
       .cta background but keeps its white text — the only ask in the report
       would otherwise print white-on-white and vanish. Fall back to dark
       text on no background with a visible border instead of relying on the
       background for contrast. */
    .cta { background: none; color: #1a1a1a; border: 2px solid ${RED}; }
    .cta h2, .cta a { color: #1a1a1a; }
  }
`;

function scoreCard(label: string, value: number | null, hint?: string): string {
  const n =
    value === null ? `<div class="n na">Not measured</div>` : `<div class="n">${value}</div>`;
  const hintHtml = hint ? `<div class="hint">${escapeHtml(hint)}</div>` : "";
  return `<div class="score">${n}<div class="l">${escapeHtml(label)}</div>${hintHtml}</div>`;
}

/** Body for a stage that succeeded, or a uniform "Not measured" note when it didn't. */
function stageBody<T>(stage: StageResult<T>, body: (data: T) => string): string {
  return stage.ok ? body(stage.data) : notMeasuredNote();
}

/** The stage's real error is deliberately not a parameter here — see
 *  STAGE_FAILED_MESSAGE above. Every genuine failure reads the same
 *  client-safe way, regardless of what actually broke. */
function notMeasuredNote(): string {
  return `<p class="muted">Not measured — ${STAGE_FAILED_MESSAGE}.</p>`;
}

/** A stage a human deliberately turned off (--no-probes, or analyze skipped
 *  because checks failed upstream) must read as "you asked us to skip this" —
 *  never as "we tried and could not", which is what a bare "Not measured —
 *  {error}" would otherwise imply. Compares against the pipeline's exported
 *  constants rather than a retyped string literal. */
function skippableStageNote(error: string, skipConstant: string, skipMessage: string): string {
  if (error === skipConstant) {
    return `<p class="muted">${escapeHtml(skipMessage)}</p>`;
  }
  return notMeasuredNote();
}

/** `new Date(iso).toLocaleDateString()` never throws on a bad timestamp — it
 *  silently returns "Invalid Date" — so a try/catch here is dead code. Guard
 *  on getTime() instead, and fall back to the raw ISO string so a corrupt
 *  timestamp is at least visibly a timestamp rather than the literal words
 *  "Invalid Date". */
function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The probes section leads the report, so a branded-only run (analyze
 *  failed upstream and supplied no buyer questions, or every category query
 *  itself failed) must not let the branded recognition line read as a
 *  positive discoverability finding on its own — an engine echoing a name
 *  it was just handed proves nothing about whether a buyer who never named
 *  the business would find it. */
/** `businessNameUsed` is whether the engines were actually queried with the
 *  business NAME — not merely whether one existed. `resolveBusinessName` falls
 *  back to the bare domain for anything it cannot use, so a name can be present
 *  and still never reach a query. Without this gate, "even with the name handed
 *  to them" is a false claim: whenever businessName was empty, and (until the
 *  caller was fixed) whenever the name was rejected and the probes searched for
 *  the domain instead. Never derived from the raw ProbesResult, which has no
 *  way to say "no name was available". */
function buildProbesSection(p: ProbesResult, businessNameUsed: boolean): string {
  const byKind = new Map<ProbeAnswer["kind"], ProbeAnswer[]>();
  for (const a of p.answers) {
    const bucket = byKind.get(a.kind) ?? [];
    bucket.push(a);
    byKind.set(a.kind, bucket);
  }

  const recognition = p.brandedRecognized
    ? "<p>When the engines were asked about the business by name, they recognized it.</p>"
    : businessNameUsed
      ? "<p>When the engines were asked about the business by name, they did not recognize it — a real citation of the site never showed up, even with the name handed to them.</p>"
      : "<p>The engines did not recognize the business — there was no business name available to ask them with, so this reflects a harder starting point than a named query would.</p>";

  const categoryCaveat = byKind.has("category")
    ? ""
    : `<p class="muted"><strong>No buyer-question (category) query was tested here</strong> — only name-recognition. An engine echoing back a name it was just given says nothing about whether a buyer who had never heard of the business would be shown it; treat the line above as a floor, not a visibility signal.</p>`;

  // A degraded run says so. The score now divides by what was ASKED, so failed
  // probes push it DOWN rather than silently inflating it — which is the safe
  // direction, but only if the reader is told the run was incomplete. Silence
  // here would trade one misleading number for another.
  // Bound to a local so the narrowing survives into the template — `missing > 0`
  // says nothing to the compiler about `p.categoryProbes` itself, and a stored
  // report from before the field existed genuinely does not have it.
  const tally = p.categoryProbes;
  const missing = tally ? tally.attempted - tally.answered : 0;
  const degradedNotice =
    tally && missing > 0
      ? `<p class="muted"><strong>${missing} of ${tally.attempted} buyer-question searches did not come back</strong> — the engine errored on them. They are counted as "not found", so the visibility figure above is a floor: the real number could be higher, not lower. Worth re-running before drawing a conclusion from it.</p>`
      : "";

  const groups = KIND_ORDER.filter((k) => byKind.has(k))
    .map((kind) => {
      const answers = byKind.get(kind) ?? [];
      const cards = answers
        .map(
          (a) => `<div class="card">
          <div class="q">${escapeHtml(a.engine)} · “${escapeHtml(a.query)}”</div>
          <p class="muted">Asked ${escapeHtml(formatIsoDate(a.askedAt))}</p>
          <p>${escapeHtml(a.snippet)}${a.truncated ? "…" : ""}</p>
          <p class="muted">${
            // The scorer's own decision, recorded on the answer — NOT
            // `domainCited || brandMentioned`, which is a looser rule. Using the
            // loose one printed "You were named in this answer" above a card
            // contributing zero to the score beside it. Reports persisted before
            // the field existed fall back to what they already said.
            (a.countedAsVisible ?? (a.domainCited || a.brandMentioned))
              ? "You were named in this answer."
              : "You were not named in this answer."
          }${a.citedDomains.length ? ` Sources the engine retrieved: ${escapeHtml(a.citedDomains.join(", "))}` : ""}</p>
        </div>`,
        )
        .join("");
      return `<h3>${escapeHtml(KIND_LABEL[kind])}</h3>${cards}`;
    })
    .join("");

  const competitors = p.competitorsSeen.length
    ? `<h3>Who the engines cited instead</h3><ul>${p.competitorsSeen
        .map((c) => `<li>${escapeHtml(c.domain)} — ${c.count} time${c.count === 1 ? "" : "s"}</li>`)
        .join("")}</ul>`
    : "";

  return recognition + categoryCaveat + degradedNotice + groups + competitors;
}

/** crawlerAccessMeasured is false only when the robots.txt fetch itself
 *  failed, so the blocked/allowed lists are empty out of ignorance, not
 *  because we confirmed access. Saying "every crawler can reach the site" in
 *  that case would manufacture a finding from our own missing data.
 *  sitemapMeasured/llmsTxtMeasured get the same treatment as
 *  crawlerAccessMeasured: a failed fetch reads as "not measured", never as a
 *  confirmed "missing" — that's a claim about the prospect's site we haven't
 *  earned. Item 1: none of the three "not measured" lines below take the raw
 *  fetch error as input anymore — status codes and transport vocabulary
 *  ("503 Service Unavailable", "ETIMEDOUT") are operator vocabulary, same as
 *  a stage failure (see STAGE_FAILED_MESSAGE); the real error still lives in
 *  the persisted JSON and CLI output, never in this client-facing page. */
function buildFindabilitySection(c: ChecksResult): string {
  const accessBlock = !c.crawlerAccessMeasured
    ? `<p class="muted">Crawler access: not measured — ${STAGE_FAILED_MESSAGE}.</p>`
    : c.crawlerAccess.blockedAi.length
      ? `<p><strong>Blocked AI crawlers:</strong> ${escapeHtml(
          c.crawlerAccess.blockedAi.map(describeAgent).join(", "),
        )}</p>`
      : // Says what was measured, which is robots.txt, and no more. "Every AI
        // crawler can reach the site" was a claim robots.txt cannot support:
        // a CDN's bot management enforces its own answer and can contradict the
        // file without the owner knowing. Confirmed on a live prospect —
        // ludlowkingsley.com publishes a robots.txt that blocks nothing relevant
        // and returns 403 to ClaudeBot on every request, while serving a browser,
        // GPTBot and PerplexityBot normally. The report said they were fine.
        `<p>Nothing in your robots.txt blocks the AI crawlers we checked.</p>`;
  const classical =
    c.crawlerAccessMeasured && c.crawlerAccess.blockedClassical.length
      ? `<p><strong>Blocked search crawlers:</strong> ${escapeHtml(
          c.crawlerAccess.blockedClassical.join(", "),
        )}</p>`
      : "";
  const sitemapLine = c.sitemapMeasured
    ? `<li>sitemap.xml: ${c.sitemapPresent ? "present" : "missing"}</li>`
    : `<li>sitemap.xml: not measured — ${STAGE_FAILED_MESSAGE}.</li>`;
  // llms.txt is no longer listed as a finding. It used to sit here as
  // "present"/"missing" beside sitemap.xml, which put the two on equal footing
  // — and "missing" beside a checklist reads as a job to do. Search crawlers
  // demonstrably read a sitemap; no answer engine has documented reading
  // llms.txt to build an answer. The footnote below says that outright instead
  // of leaving a prospect to infer it, or to go and build one on our say-so.
  const llmsFootnote = `<p class="muted"><strong>A note on llms.txt.</strong> You may have been told to
    add one. We check for it — this site ${
      !c.llmsTxtMeasured ? "could not be checked" : c.llmsTxtPresent ? "has one" : "does not"
    } — but we do not score it and we will not recommend it. It is a 2024 proposal that no
    answer engine has committed to reading, and adding one has no measured effect on whether you
    are cited. If that changes we will say so and score it then.</p>`;
  return `${accessBlock}${classical}
    <ul>
      ${sitemapLine}
      <li>Pages missing a meta description: ${c.meta.missingDescription} of ${c.meta.pageCount}</li>
      <li>Pages missing a canonical URL: ${c.meta.missingCanonical} of ${c.meta.pageCount}</li>
      <li>Pages missing share images/titles: ${c.meta.missingSocial} of ${c.meta.pageCount}</li>
      <li>Security headers missing: ${
        c.securityHeaders.missing.length ? escapeHtml(c.securityHeaders.missing.join(", ")) : "none"
      }</li>
      ${
        c.meta.pagesWithoutExtract > 0
          ? `<li><strong>${c.meta.pagesWithoutExtract}</strong> additional page${
              c.meta.pagesWithoutExtract === 1 ? "" : "s"
            } produced no readable content at all and ${
              c.meta.pagesWithoutExtract === 1 ? "is" : "are"
            } not counted in the ${c.meta.pageCount} pages above.</li>`
          : ""
      }
    </ul>${llmsFootnote}`;
}

/** Lighthouse runs as its own independent pipeline stage (see pipeline.ts) —
 *  it does not depend on `checks` succeeding. Rendering it off `result.checks`
 *  would throw away real, measured performance/SEO/accessibility numbers
 *  whenever an unrelated stage failed, so this reads `result.lighthouse`
 *  directly and is rendered unconditionally, not nested inside the checks
 *  degrade path. */
function buildLighthouseBlock(lh: StageResult<LighthouseScores>): string {
  return lh.ok
    ? `<p class="muted">Lighthouse — performance ${lh.data.performance ?? "not measured"},
       SEO ${lh.data.seo ?? "not measured"}, accessibility ${lh.data.accessibility ?? "not measured"}.</p>`
    : `<p class="muted">Lighthouse not measured — ${STAGE_FAILED_MESSAGE}.</p>`;
}

function buildReadabilitySection(c: ChecksResult): string {
  const jsLine =
    c.jsDependence.avgMissing === null
      ? `<p class="muted">JavaScript-dependence: not measured — no page produced a comparable raw/rendered pair.</p>`
      : `<p><strong>${Math.round(c.jsDependence.avgMissing * 100)}%</strong> of the words a visitor reads only appear after JavaScript runs.
    Most AI crawlers do not run JavaScript, so that share of your site is invisible to them.</p>`;
  return `${jsLine}
    <ul>
      <li>Structured data found: ${c.schema.typesFound.length ? escapeHtml(c.schema.typesFound.join(", ")) : "none"}</li>
      <li>Expected structured data missing: ${
        c.schema.missingExpected.length ? escapeHtml(c.schema.missingExpected.join(", ")) : "none"
      }</li>
      <li>Pages without a top-level heading: ${c.headings.pagesWithoutH1} of ${c.meta.pageCount}</li>
      ${
        c.meta.pagesWithoutExtract > 0
          ? `<li><strong>${c.meta.pagesWithoutExtract}</strong> page${
              c.meta.pagesWithoutExtract === 1 ? "" : "s"
            } produced no extract at all — excluded from every figure above, not counted as readable or unreadable.</li>`
          : ""
      }
    </ul>`;
}

/** The report's whole premise is claims the recipient can go check — so the
 *  one quoted passage of evidence links to the page it came from (via
 *  safeUrl; a null/non-http page renders as plain escaped text, no dead
 *  "#" anchor). `answered`/`impact`/`effort` are escaped even though a zod
 *  enum constrains them upstream — the renderer should not depend on
 *  another file staying in sync to stay safe. */
function buildAnswersSection(a: AnalyzeResult): string {
  const rows = a.buyerQuestions
    .map((q) => {
      const answered = escapeHtml(q.answered);
      const evidenceText = q.evidence ? escapeHtml(q.evidence) : null;
      const evidenceHref = q.evidence && q.page ? safeUrl(q.page) : null;
      const evidenceCell =
        evidenceText === null
          ? '<span class="muted">no passage on the site</span>'
          : evidenceHref && evidenceHref !== "#"
            ? `<a href="${escapeHtml(evidenceHref)}" target="_blank" rel="noopener noreferrer">${evidenceText}</a>`
            : evidenceText;
      return `<tr>
          <td>${escapeHtml(q.question)}</td>
          <td><span class="tag ${answered}">${answered}</span></td>
          <td>${evidenceCell}</td>
        </tr>`;
    })
    .join("");
  return `<p>${escapeHtml(a.narrative.answers)}</p>
    <table><tr><th>What buyers ask</th><th>Answered</th><th>Evidence</th></tr>${rows}</table>`;
}

export function renderProspectReport(result: ProspectAuditResult): string {
  const host = hostnameOf(result.url);
  // `businessName` is the searchable NAME (possibly ""), never the
  // description. An empty/missing name is itself a finding — fall back to
  // the hostname rather than printing nothing, or worse, printing "" as if
  // it were a verified fact about the business.
  const name = result.businessName && result.businessName.trim() ? result.businessName : host;
  const date = formatIsoDate(result.generatedAt);

  const findabilitySection = stageBody(result.checks, buildFindabilitySection);
  const lighthouseBlock = buildLighthouseBlock(result.lighthouse);
  const readabilitySection = stageBody(result.checks, buildReadabilitySection);

  // A real business name was resolved and handed to the engines only when
  // `result.businessName` is non-empty — the same value the pipeline
  // actually queried with (see pipeline.ts). Used to gate the probes
  // section's "even with the name handed to them" phrasing (Fix 6).
  // Whether the engines were actually queried with the NAME, which is not the
  // same as whether a name existed. resolveBusinessName falls back to the bare
  // domain for anything it cannot use, and this line used to read the
  // un-resolved value — so a report could claim the engines were given the name
  // "even with the name handed to them" while the probes had in fact searched
  // for "stlouisroofing.com". Resolve it the same way probes.ts does.
  const businessNameUsed = Boolean(
    result.businessName &&
    result.businessName.trim() &&
    resolveBusinessName(result.businessName, result.url) === result.businessName.trim(),
  );

  const fixes = result.analyze.ok
    ? (() => {
        const sorted = [...result.analyze.data.fixes].sort(
          (x, y) => IMPACT_ORDER[x.impact] - IMPACT_ORDER[y.impact],
        );
        if (sorted.length === 0) {
          // A genuinely well-optimized site: a bare empty list reads as a
          // rendering bug, not a compliment. Say so directly, and keep this
          // section as a pitch — it's the one the salesperson is sending
          // the report to make.
          return `<p>Nothing here reads as urgent — the essentials are already in place.
          Reddoor can still help push this further: tightening structured data, monitoring
          how the answer engines describe you, and keeping pace as they change.</p>`;
        }
        return `<ol>${sorted
          .map((f) => {
            const impact = escapeHtml(f.impact);
            const effort = escapeHtml(f.effort);
            return `<li><strong>${escapeHtml(f.title)}</strong> — ${escapeHtml(f.why)}
          <span class="muted">(${impact} impact, ${effort} effort)</span></li>`;
          })
          .join("")}</ol>`;
      })()
    : skippableStageNote(
        result.analyze.error,
        ANALYZE_SKIPPED,
        "Skipped — the checks stage failed, so there was nothing to build fixes from.",
      );

  const probesSectionFinal = result.probes.ok
    ? buildProbesSection(result.probes.data, businessNameUsed)
    : skippableStageNote(
        result.probes.error,
        PROBES_SKIPPED,
        "This audit did not run the AI-visibility probes.",
      );

  const answersSectionFinal = result.analyze.ok
    ? buildAnswersSection(result.analyze.data)
    : skippableStageNote(
        result.analyze.error,
        ANALYZE_SKIPPED,
        "Skipped — the checks stage failed, so there were no buyer questions to check.",
      );

  const description = result.analyze.ok ? result.analyze.data.business : null;
  const narrative = result.analyze.ok
    ? `<p class="lede">${escapeHtml(description ?? "")}</p>
       <p class="lede">${escapeHtml(result.analyze.data.narrative.findability)}
       ${escapeHtml(result.analyze.data.narrative.readability)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Can AI find ${escapeHtml(name)}? — Reddoor audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Besley:wght@400;600&display=swap" rel="stylesheet" />
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <h1>Can AI and Google actually find ${escapeHtml(name)}?</h1>
  <p class="lede"><a href="${escapeHtml(safeUrl(result.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a> · audited ${escapeHtml(date)} by Reddoor Creative</p>
  ${narrative}

  <p class="muted">Each score below runs 0–100 — read it as a score, not a percentage.</p>
  <div class="scores">
    ${scoreCard("Findability", result.scores.findability, "How easily AI and search crawlers can find and reach your site — crawl rules, sitemap, key metadata")}
    ${scoreCard("Readability", result.scores.readability, "How much of your site's content those crawlers can actually read once they're in — most don't run JavaScript")}
    ${scoreCard("Answers", result.scores.answers, "How many buyer questions your site's own content answers — separate from what the AI engines say back")}
    ${scoreCard("AI Visibility", result.scores.aiVisibility, "Based on buyer questions — not questions that name the business directly")}
  </div>

  <h2>What the AI engines said about you</h2>
  ${probesSectionFinal}

  <h2>What the crawlers can reach</h2>
  ${findabilitySection}
  ${lighthouseBlock}

  <h2>What the crawlers can read</h2>
  ${readabilitySection}

  <h2>The questions your buyers ask</h2>
  ${answersSectionFinal}

  <h2>What to fix first</h2>
  ${fixes}

  <div class="cta">
    <h2>Want this fixed?</h2>
    <p>Reddoor Creative rebuilds sites so answer engines can read, quote and recommend them.
    Reply to the email this link came from, or start at
    <a href="https://reddoorla.com/">reddoorla.com</a>.</p>
  </div>
</div>
</body>
</html>`;
}
