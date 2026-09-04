import { resolveNavigable } from "./journey.js";
import { usablePages } from "./pages.js";
import type { Scope } from "./goals.js";
import type { PageVitals } from "./accessibility.js";
import type { FormProbe } from "./interaction.js";
import type { DnsFindings } from "./dns.js";
import { MIN_OG_IMAGE_EDGE, type HttpFindings, type ProbeVerdict } from "./http-probes.js";
import type { ChecksResult, CrawlResult, FormShape, PageAnchor, PageExtract } from "./types.js";

/**
 * The things a careful person would check with a browser and ten minutes.
 *
 * Every check here is a pure function of what the crawl already stored. Nothing
 * in this file makes a request, which is the point: it can be run over every
 * audit already in the database without touching a prospect's server, and a bug
 * found by that replay costs nothing to fix.
 *
 * FOUR STATES, NOT THREE. The rest of this codebase already knows that our
 * failed measurement must never render as the site's defect, which is why
 * `unmeasured` exists. This file adds the state that review kept catching:
 * `not-applicable`. A site with no `LocalBusiness` schema, no HSTS header and no
 * RTL content must not silently PASS the checks about those — that inflates
 * "34 of 35 passed" with checks that never ran, which is the same dishonesty as
 * a false failure wearing nicer clothes. Both non-verdicts leave the
 * denominator; see `tally`.
 *
 * THE FLOOR IS BARE HTML. A hand-written page with a title, a heading and a
 * paragraph should pass almost all of this. A check that a careful, ordinary
 * site fails is not measuring care, it is measuring fashion, and it makes the
 * report an argument rather than a document. Where a bar had to be set, it is
 * set generously and the reasoning is written down next to it.
 *
 * WHAT PASSES IS ONE LINE. Most of these will be green on most sites, and that
 * is by design — they cost one row inside a collapsed section and are invisible
 * until the day one fails, at which point it is the most useful row on the
 * page. That is what makes a trivial check worth having, and it is the only
 * thing that makes it worth having.
 */

export type CheckStatus = "pass" | "fail" | "unmeasured" | "not-applicable";

export type SiteCheck = {
  key: string;
  /** What was checked, in the reader's terms rather than ours. */
  label: string;
  status: CheckStatus;
  /**
   * What we found — the receipt, on a pass as much as on a fail. A green row
   * saying "we looked and it is fine" is worth more when it says what it
   * looked at.
   */
  evidence: string | null;
  /** Why it matters to them. Printed only on a fail; a cleared check needs no
   *  argument. */
  why: string;
  scope: Scope;
};

/**
 * How many checks actually reached a verdict, and how many of those passed.
 *
 * `total` counts ONLY `pass` and `fail`. Printing "34 of 40" where six of the
 * forty were never applicable to this site would be a number we inflated on our
 * own behalf, and a reader who worked out what we had done would be right to
 * discard the other thirty-four.
 */
/** "all 12 links", but "the one link" — because "all 1" reads like a bug in the
 *  report, and a reader who spots one wonders what else is generated wrong. */
function countOf(n: number, singular: string, plural: string): string {
  return n === 1 ? `the one ${singular}` : `all ${n} ${plural}`;
}

export function tally(checks: SiteCheck[]): { passed: number; failed: number; total: number } {
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  return { passed, failed, total: passed + failed };
}

/** One check, phrased once. `evidence` is the receipt either way; `ok` is the
 *  verdict. Use `skip`/`unknown` rather than passing a check that did not run. */
function check(
  key: string,
  label: string,
  why: string,
  scope: Scope,
  ok: boolean,
  evidence: string | null,
): SiteCheck {
  return { key, label, status: ok ? "pass" : "fail", evidence, why, scope };
}

/** This site has nothing for the check to be about — no schema block, no HSTS
 *  header, no second page. Not a pass, and it leaves the denominator. */
function skip(key: string, label: string, why: string, scope: Scope, note: string): SiteCheck {
  return { key, label, status: "not-applicable", evidence: note, why, scope };
}

/** WE could not look. Also leaves the denominator, and for the more important
 *  reason: it is our gap, and it must never be printed as their defect. */
function unknown(key: string, label: string, why: string, scope: Scope): SiteCheck {
  return { key, label, status: "unmeasured", evidence: null, why, scope };
}

// ─── Anchors ─────────────────────────────────────────────────────────────────

/**
 * Link text that names no destination.
 *
 * Deliberately short and deliberately whole-phrase. "More" inside "More about
 * our process" is a fine link; a link whose ENTIRE text is "more" is not, and
 * matching a substring would have flagged the first.
 */
const VAGUE_LINK_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "learn more",
  "more",
  "more info",
  "more information",
  "find out more",
  "this",
  "link",
  "this link",
  "continue",
  "go",
]);

/** Hosts that only ever appear in a link by mistake. `*.local` and the RFC
 *  reserved names are development leftovers; a visitor following one gets a
 *  browser error page with the site's name at the top of it. */
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|.*\.test|.*\.localhost)$/i;

/** Placeholder social URLs, as shipped by the theme. Matched on the whole path
 *  so a real profile at /yourbusiness-la is untouched. */
const PLACEHOLDER_SOCIAL =
  /^(?:https?:\/\/)?(?:www\.)?(?:facebook|twitter|x|instagram|linkedin|youtube|tiktok|pinterest)\.com\/?(?:(?:in|company|user|channel|@)\/)?(?:yourhandle|username|yourusername|yourpage|yourcompany|your-business|profile\.php|home)?\/?$/i;

/** A `tel:` a phone can actually dial: digits, with the punctuation a dialler
 *  tolerates. `tel:call-us-today` is a link that does nothing. */
const DIALABLE_TEL = /^tel:\+?[0-9().\-\s]{6,}$/i;

function anchorChecks(pages: { url: string; extract: PageExtract }[], origin: string): SiteCheck[] {
  const out: SiteCheck[] = [];
  const measured = pages.length > 0 && pages.every((p) => p.extract.anchors !== undefined);

  const WHY_DEAD = "A link that goes nowhere reads as a broken site to the person who clicks it.";
  if (!measured) {
    return [
      unknown("dead-links", "Links that go nowhere", WHY_DEAD, "quick"),
      unknown(
        "staging-links",
        "Links pointing at a development address",
        "A link to localhost or a staging host takes the visitor to a browser error page with your name on it.",
        "quick",
      ),
      unknown(
        "insecure-links",
        "Links that drop out of https",
        "A link back to plain http shows a “not secure” warning on a site that had earned the padlock.",
        "quick",
      ),
      unknown(
        "link-text",
        "Links that say where they go",
        "“Read more” tells a visitor nothing, and it is the whole label a screen reader announces.",
        "content",
      ),
      unknown(
        "tel-dialable",
        "Phone links a phone can dial",
        "A tel: link that is not a number does nothing at all when tapped.",
        "quick",
      ),
      unknown(
        "social-placeholders",
        "Social links that go to your accounts",
        "An unedited theme placeholder sends visitors to a login page or a stranger.",
        "quick",
      ),
      unknown(
        "nav-consistency",
        "Navigation that agrees with itself",
        "The same menu item leading to two different pages is confusing in a way visitors blame on you.",
        "quick",
      ),
    ];
  }

  const all: { a: PageAnchor; page: string }[] = [];
  for (const p of pages) for (const a of p.extract.anchors ?? []) all.push({ a, page: p.url });

  // `href=""` never reaches us — extract.ts only collects anchors with a
  // non-empty href — so the whole finding here is the javascript: no-op. A bare
  // `href="#"` is deliberately NOT counted: it is how a great many perfectly
  // good disclosure buttons are written, and we cannot see the click handler
  // that makes it work.
  const dead = all.filter(({ a }) => /^javascript:\s*(void\s*\(\s*0\s*\)|;)?\s*$/i.test(a.href));
  out.push(
    check(
      "dead-links",
      "Links that go nowhere",
      WHY_DEAD,
      "quick",
      dead.length === 0,
      dead.length === 0
        ? `none among the ${all.length} links we read`
        : `${dead.length} of ${all.length}: ${dead
            .slice(0, 3)
            .map((d) => `“${d.a.text || d.a.href}” on ${d.page}`)
            .join(", ")}`,
    ),
  );

  // A link to the site's OWN host is never a stray development link, whatever
  // that host looks like. Without this the check fired on every internal link
  // of any site served from a `.test`, `.local` or `localhost` name — which
  // includes our own fixture, and would have included any client running an
  // internal tool. The finding is a link that leaves for a development
  // address, not a site that lives at one.
  let ownHost: string | null = null;
  try {
    ownHost = new URL(origin).hostname.toLowerCase();
  } catch {
    ownHost = null;
  }
  const staging = all.filter(({ a, page }) => {
    const abs = resolveNavigable(a.href, page);
    if (!abs) return false;
    try {
      const host = new URL(abs).hostname.toLowerCase();
      return host !== ownHost && LOCAL_HOST.test(host);
    } catch {
      return false;
    }
  });
  out.push(
    check(
      "staging-links",
      "Links pointing at a development address",
      "A link to localhost or a staging host takes the visitor to a browser error page with your name on it.",
      "quick",
      staging.length === 0,
      staging.length === 0
        ? "none"
        : `${staging.length} ${staging.length === 1 ? "link" : "links"}, including ${staging
            .slice(0, 3)
            .map((s) => s.a.href)
            .join(", ")}`,
    ),
  );

  // Only meaningful on a site that is itself on https — on an http site the
  // finding is the site, and `insecureEntry` already says so.
  if (origin.startsWith("https://")) {
    const insecure = all.filter(({ a }) => /^http:\/\//i.test(a.href.trim()));
    out.push(
      check(
        "insecure-links",
        "Links that drop out of https",
        "A link back to plain http shows a “not secure” warning on a site that had earned the padlock.",
        "quick",
        insecure.length === 0,
        insecure.length === 0
          ? "every link stays on https"
          : `${insecure.length} ${insecure.length === 1 ? "link" : "links"}, including ${insecure
              .slice(0, 3)
              .map((s) => s.a.href)
              .join(", ")}`,
      ),
    );
  } else {
    out.push(
      skip(
        "insecure-links",
        "Links that drop out of https",
        "A link back to plain http shows a “not secure” warning on a site that had earned the padlock.",
        "quick",
        "the site is not served over https, which is the finding above instead",
      ),
    );
  }

  const vague = all.filter(({ a }) => VAGUE_LINK_TEXT.has(a.text.trim().toLowerCase()));
  // A generous bar on purpose. One "read more" on a blog index is ordinary
  // writing; a page built entirely out of them is the finding, and a threshold
  // of one would fail most of the good web.
  const VAGUE_LIMIT = 5;
  out.push(
    check(
      "link-text",
      "Links that say where they go",
      "“Read more” tells a visitor nothing, and it is the whole label a screen reader announces when it lists the links on your page.",
      "content",
      vague.length <= VAGUE_LIMIT,
      vague.length === 0
        ? `all ${all.length} links we read name their destination`
        : `${vague.length} of ${all.length} say only “${[...new Set(vague.map((v) => v.a.text.trim()))].slice(0, 3).join("”, “")}”`,
    ),
  );

  const tels = all.filter(({ a }) => /^tel:/i.test(a.href.trim()));
  const badTels = tels.filter(({ a }) => !DIALABLE_TEL.test(a.href.trim()));
  const WHY_TEL = "A tel: link that is not a number does nothing at all when it is tapped.";
  out.push(
    tels.length === 0
      ? skip(
          "tel-dialable",
          "Phone links a phone can dial",
          WHY_TEL,
          "quick",
          "no tel: links on the pages we read",
        )
      : check(
          "tel-dialable",
          "Phone links a phone can dial",
          WHY_TEL,
          "quick",
          badTels.length === 0,
          badTels.length === 0
            ? `all ${tels.length} dial a number`
            : badTels
                .map((b) => b.a.href)
                .slice(0, 3)
                .join(", "),
        ),
  );

  const placeholders = all.filter(({ a }) => PLACEHOLDER_SOCIAL.test(a.href.trim()));
  out.push(
    check(
      "social-placeholders",
      "Social links that go to your accounts",
      "An unedited theme placeholder sends a visitor to a login page or to somebody else entirely.",
      "quick",
      placeholders.length === 0,
      placeholders.length === 0
        ? "none left unedited"
        : placeholders
            .map((p) => p.a.href)
            .slice(0, 3)
            .join(", "),
    ),
  );

  // Nav drift, defined off the shared template rather than guessed at: a link
  // whose TEXT appears on every page we read is part of the navigation, and it
  // should resolve to one place. `consistency.ts` derives the same shared set
  // for its off-template check; this asks whether that set agrees with itself.
  out.push(navConsistency(pages));

  return out;
}

function navConsistency(pages: { url: string; extract: PageExtract }[]): SiteCheck {
  const WHY =
    "The same menu item leading to two different pages is the kind of confusion visitors blame on you rather than on the menu.";
  // Needs at least two pages to compare, and a nav is only a nav if it repeats.
  if (pages.length < 2) {
    return skip(
      "nav-consistency",
      "Navigation that agrees with itself",
      WHY,
      "quick",
      "only one page was read, so there is no shared navigation to compare",
    );
  }

  const perPage = pages.map(({ url, extract }) => {
    const m = new Map<string, Set<string>>();
    for (const a of extract.anchors ?? []) {
      const text = a.text.trim().toLowerCase();
      const abs = resolveNavigable(a.href, url);
      if (!text || !abs) continue;
      if (!m.has(text)) m.set(text, new Set());
      m.get(text)!.add(abs);
    }
    return m;
  });

  const shared = [...(perPage[0]?.keys() ?? [])].filter((text) =>
    perPage.every((m) => m.has(text)),
  );
  if (shared.length === 0) {
    return skip(
      "nav-consistency",
      "Navigation that agrees with itself",
      WHY,
      "quick",
      "no link text appears on every page, so we could not identify a shared navigation",
    );
  }

  const drifting = shared.filter((text) => {
    const targets = new Set<string>();
    for (const m of perPage) for (const t of m.get(text) ?? []) targets.add(t);
    return targets.size > 1;
  });

  return check(
    "nav-consistency",
    "Navigation that agrees with itself",
    WHY,
    "quick",
    drifting.length === 0,
    drifting.length === 0
      ? `${shared.length} shared menu ${shared.length === 1 ? "item goes" : "items go"} to the same place on every page`
      : `${drifting
          .map((d) => `“${d}”`)
          .slice(0, 3)
          .join(
            ", ",
          )} ${drifting.length === 1 ? "leads" : "lead"} somewhere different depending on the page`,
  );
}

// ─── Page text ───────────────────────────────────────────────────────────────

const LOREM = /\b(lorem ipsum|dolor sit amet|consectetur adipiscing)\b/i;

/** Placeholder copy a theme ships and an owner forgets. Whole phrases, because
 *  "your text here" as a fragment of a real sentence is not a finding. */
const PLACEHOLDER_COPY =
  /\b(your (?:text|content|title|headline|company name|business name) here|insert (?:text|content|your) |add your (?:text|content) here|edit this text|this is a sample|sample text|placeholder text|coming soon\.{3})/i;

/**
 * Template syntax that reached the page.
 *
 * Bare `null` and `undefined` are deliberately absent: they are English words
 * that appear in honest prose ("the null hypothesis"), and flagging them would
 * fail a page for writing well. What is matched is syntax nobody types on
 * purpose.
 */
const TEMPLATE_LEAKAGE = /(\{\{[^}]{0,80}\}\}|\[object Object\]|<%=?[^%]{0,80}%>|\$\{[^}]{0,60}\})/;

/**
 * Mojibake — UTF-8 read as Latin-1, then re-encoded.
 *
 * `â€™` for an apostrophe, `Â` before a space, `ï»¿` for a stray byte-order
 * mark. Extremely common on sites that have been migrated between platforms,
 * extremely visible to a reader, and a one-line fix. The sequences below only
 * occur as an encoding accident.
 */
const MOJIBAKE = /(â€[™œ“”˜]|Ã[©¨¤¡«»]|ï»¿|Â[\s£©®])/;

const UNDER_CONSTRUCTION =
  /\b(under construction|coming soon|site is being (?:built|updated)|check back soon|page not found)\b/i;

function textChecks(
  pages: { url: string; extract: PageExtract }[],
  businessName: string | null,
): SiteCheck[] {
  const out: SiteCheck[] = [];

  const firstMatch = (re: RegExp): { page: string; snippet: string } | null => {
    for (const p of pages) {
      const m = re.exec(p.extract.text);
      if (m) {
        const at = Math.max(0, m.index - 40);
        return { page: p.url, snippet: `…${p.extract.text.slice(at, m.index + 60).trim()}…` };
      }
    }
    return null;
  };

  const cases: [string, string, string, Scope, RegExp][] = [
    [
      "lorem",
      "Placeholder Latin left in the copy",
      "Lorem ipsum on a live page tells a visitor the site was never finished.",
      "quick",
      LOREM,
    ],
    [
      "placeholder-copy",
      "Theme placeholder text left in the copy",
      "“Your text here” on a live page reads as a site nobody has looked at since it was built.",
      "quick",
      PLACEHOLDER_COPY,
    ],
    [
      "template-leakage",
      "Template code showing as text",
      "A visitor sees the machinery instead of the sentence, which reads as broken rather than unfinished.",
      "quick",
      TEMPLATE_LEAKAGE,
    ],
    [
      "mojibake",
      "Text with broken characters",
      "Apostrophes and quotes rendering as â€™ is the most visible sign of a migration nobody checked, and it is a one-line fix at the source.",
      "quick",
      MOJIBAKE,
    ],
    [
      "under-construction",
      "Pages that say they are unfinished",
      "A live page announcing it is coming soon is a page better unlinked until it is not.",
      "content",
      UNDER_CONSTRUCTION,
    ],
  ];

  for (const [key, label, why, scope, re] of cases) {
    if (pages.length === 0) {
      out.push(unknown(key, label, why, scope));
      continue;
    }
    const hit = firstMatch(re);
    out.push(
      check(
        key,
        label,
        why,
        scope,
        hit === null,
        hit === null
          ? `none across the ${pages.length} pages we read`
          : `${hit.page}: ${hit.snippet}`,
      ),
    );
  }

  out.push(nameInTitle(pages, businessName));
  return out;
}

function nameInTitle(
  pages: { url: string; extract: PageExtract }[],
  businessName: string | null,
): SiteCheck {
  const WHY =
    "The title is the line in a search result, a browser tab and a shared link. Without your name in it, all three are anonymous.";
  const LABEL = "Your name in the page title";
  // Depends on a name the analyze stage inferred. No name is OUR gap, and a
  // check that grades a site against a name we guessed at would be worse than
  // no check.
  if (!businessName) return unknown("name-in-title", LABEL, WHY, "quick");
  const home = pages[0];
  if (!home || !home.extract.title) {
    return unknown("name-in-title", LABEL, WHY, "quick");
  }
  // Compared on words rather than as a substring: "Acme Roofing" should match a
  // title reading "Acme Roofing, Inc." and also "Acme — Roofing in Boise".
  const words = businessName
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  const title = home.extract.title.toLowerCase();
  const hit = words.length > 0 && words.every((w) => title.includes(w));
  return check("name-in-title", LABEL, WHY, "quick", hit, `“${home.extract.title}”`);
}

// ─── Headings ────────────────────────────────────────────────────────────────

function headingChecks(
  pages: { url: string; extract: PageExtract }[],
  businessName: string | null,
): SiteCheck[] {
  const WHY_ONE =
    "The h1 is the page's headline. None leaves a reader — and an assistant — guessing what the page is about; several means none of them is.";
  if (pages.length === 0) {
    return [
      unknown("single-h1", "One headline per page", WHY_ONE, "content"),
      unknown(
        "h1-not-name",
        "Headlines that say what the page is about",
        "A headline that is just your company name on every page describes none of them.",
        "content",
      ),
      unknown(
        "h1-distinct",
        "A different headline on each page",
        "Identical headlines make every page look like the same page, to a reader and to a search engine.",
        "content",
      ),
    ];
  }

  const h1sPerPage = pages.map((p) => ({
    url: p.url,
    h1s: p.extract.headings.filter((h) => h.level === 1).map((h) => h.text.trim()),
  }));

  // Note: extract.ts only records a heading that HAS text, so an empty <h1>
  // is invisible to us and lands here as "none" rather than as its own finding.
  const wrong = h1sPerPage.filter((p) => p.h1s.length !== 1);
  const out: SiteCheck[] = [
    check(
      "single-h1",
      "One headline per page",
      WHY_ONE,
      "content",
      wrong.length === 0,
      wrong.length === 0
        ? `all ${pages.length} pages carry exactly one`
        : wrong
            .slice(0, 3)
            .map((p) => `${p.url} has ${p.h1s.length === 0 ? "none" : `${p.h1s.length}`}`)
            .join(", "),
    ),
  ];

  const WHY_NAME = "A headline that is only your company name describes none of the page below it.";
  const LABEL_NAME = "Headlines that say what the page is about";
  const named = h1sPerPage.filter((p) => p.h1s.length === 1);
  if (!businessName || named.length === 0) {
    out.push(unknown("h1-not-name", LABEL_NAME, WHY_NAME, "content"));
  } else {
    const bare = named.filter(
      (p) =>
        p.h1s[0]!.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") ===
        businessName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""),
    );
    out.push(
      check(
        "h1-not-name",
        LABEL_NAME,
        WHY_NAME,
        "content",
        bare.length === 0,
        bare.length === 0
          ? "every headline describes its page"
          : `${bare.length} ${bare.length === 1 ? "page's headline is" : "pages' headlines are"} just “${businessName}”`,
      ),
    );
  }

  const WHY_DISTINCT =
    "Identical headlines make every page look like the same page, to a reader scanning tabs and to a search engine choosing which one to show.";
  const LABEL_DISTINCT = "A different headline on each page";
  if (pages.length < 2) {
    out.push(
      skip(
        "h1-distinct",
        LABEL_DISTINCT,
        WHY_DISTINCT,
        "content",
        "only one page was read, so there is nothing to compare it with",
      ),
    );
  } else {
    const texts = named.map((p) => p.h1s[0]!.toLowerCase());
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    out.push(
      check(
        "h1-distinct",
        LABEL_DISTINCT,
        WHY_DISTINCT,
        "content",
        dupes.length === 0,
        dupes.length === 0
          ? `${texts.length} pages, ${new Set(texts).size} different headlines`
          : `“${[...new Set(dupes)].slice(0, 2).join("”, “")}” appears on more than one page`,
      ),
    );
  }

  return out;
}

// ─── Structured data ─────────────────────────────────────────────────────────

/**
 * Every check here is CONDITIONAL, and that is the whole design.
 *
 * A site with no `LocalBusiness` block has not failed a LocalBusiness check —
 * it has no LocalBusiness to check, which is a different sentence and belongs
 * outside the denominator. The absence of schema ALTOGETHER is already reported
 * by `checks.schema.missingExpected`; asking the same question twice under two
 * headings reads as two problems.
 */
type SchemaNode = Record<string, unknown>;

function collectNodes(node: unknown, into: SchemaNode[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) {
    for (const n of node) collectNodes(n, into, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as SchemaNode;
  if (obj["@type"]) into.push(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (k === "@type") continue;
    if (v && typeof v === "object") collectNodes(v, into, depth + 1);
  }
}

const typeOf = (n: SchemaNode): string[] => {
  const t = n["@type"];
  const raw =
    typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
  return raw.map((s) => String(s).replace(/^https?:\/\/schema\.org\//i, ""));
};

const isType = (n: SchemaNode, names: string[]): boolean =>
  typeOf(n).some((t) => names.some((name) => t.toLowerCase() === name.toLowerCase()));

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function schemaChecks(
  pages: { url: string; extract: PageExtract }[],
  origin: string,
  phones: string[],
): SiteCheck[] {
  const nodes: SchemaNode[] = [];
  let parsedAny = false;
  for (const p of pages) {
    for (const block of p.extract.jsonLd) {
      try {
        collectNodes(JSON.parse(block), nodes);
        parsedAny = true;
      } catch {
        // Invalid blocks are counted by checks.schema.invalidBlocks; here they
        // simply contribute nothing.
      }
    }
  }

  const ORG = ["Organization", "LocalBusiness", "ProfessionalService", "Corporation"];
  const org = nodes.find((n) => isType(n, ORG));
  const local = nodes.find((n) => isType(n, ["LocalBusiness", "ProfessionalService"]));

  const noSchema = (key: string, label: string, why: string): SiteCheck =>
    skip(
      key,
      label,
      why,
      "content",
      parsedAny
        ? "no such block in your structured data"
        : "this site publishes no structured data",
    );

  const out: SiteCheck[] = [];

  const WHY_ORG =
    "This is the block an assistant reads to learn who you are. Half-filled, it answers half the question and the rest gets taken from a directory you do not control.";
  if (!org) {
    out.push(noSchema("schema-org-complete", "Your business details in structured data", WHY_ORG));
  } else {
    const missing = ["name", "url", "logo"].filter((f) => !str(org[f]));
    out.push(
      check(
        "schema-org-complete",
        "Your business details in structured data",
        WHY_ORG,
        "content",
        missing.length === 0,
        missing.length === 0
          ? `name, url and logo all present on your ${typeOf(org)[0]} block`
          : `your ${typeOf(org)[0]} block is missing ${missing.join(", ")}`,
      ),
    );
  }

  const WHY_LOCAL =
    "A local business block without an address, a phone or opening hours is the one an assistant will fill in from elsewhere.";
  if (!local) {
    out.push(
      noSchema("schema-local-complete", "Your address and hours in structured data", WHY_LOCAL),
    );
  } else {
    const missing = (["address", "telephone", "openingHours"] as const).filter(
      (f) => local[f] === undefined && local[`${f}Specification`] === undefined,
    );
    out.push(
      check(
        "schema-local-complete",
        "Your address and hours in structured data",
        WHY_LOCAL,
        "content",
        missing.length === 0,
        missing.length === 0
          ? "address, telephone and opening hours all present"
          : `missing ${missing.join(", ")}`,
      ),
    );
  }

  const WHY_URL =
    "A structured-data url pointing at a domain you no longer use tells every assistant that reads it to go and look somewhere else.";
  const declaredUrl = org ? str(org["url"]) : null;
  if (!declaredUrl) {
    out.push(noSchema("schema-url-matches", "Structured data pointing at this site", WHY_URL));
  } else {
    // An unparseable url in their schema is a fail, not an exception: it is
    // still a declaration pointing at nothing this site serves.
    const host = (u: string): string | null => {
      try {
        return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
      } catch {
        return null;
      }
    };
    const declaredHost = host(declaredUrl);
    const sameHost = declaredHost !== null && declaredHost === host(origin);
    out.push(
      check(
        "schema-url-matches",
        "Structured data pointing at this site",
        WHY_URL,
        "content",
        sameHost,
        declaredUrl,
      ),
    );
  }

  const WHY_PHONE =
    "When the number in your structured data is not the number on your page, an assistant may quote either one.";
  const schemaPhone = org ? str(org["telephone"]) : null;
  const digits = (s: string): string => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!schemaPhone || phones.length === 0) {
    out.push(
      skip(
        "schema-phone-matches",
        "One phone number, everywhere",
        WHY_PHONE,
        "quick",
        !schemaPhone
          ? "no telephone in your structured data"
          : "we found no phone number in the page text to compare it with",
      ),
    );
  } else {
    const match = phones.some((p) => digits(p) === digits(schemaPhone));
    out.push(
      check(
        "schema-phone-matches",
        "One phone number, everywhere",
        WHY_PHONE,
        "quick",
        match,
        match
          ? `${schemaPhone}, matching the page`
          : `${schemaPhone} in schema, not among the numbers on your pages`,
      ),
    );
  }

  // Self-serving reviews are INELIGIBLE FOR RICH RESULTS — they are not a
  // penalty, and calling them one would be exactly the overstatement this
  // report cannot afford. A Review nested under a Product or a named third
  // party is fine; one hanging off the organisation's own block is not.
  const WHY_REVIEW =
    "Google does not show star ratings a business publishes about itself, so the markup does nothing but sit there.";
  const selfReview = nodes.filter(
    (n) => isType(n, ["AggregateRating", "Review"]) && org !== undefined,
  );
  const selfServing = org
    ? selfReview.filter(() => org["aggregateRating"] !== undefined || org["review"] !== undefined)
    : [];
  if (!org || selfReview.length === 0) {
    out.push(
      skip(
        "schema-self-review",
        "Ratings you publish about yourself",
        WHY_REVIEW,
        "content",
        "no review or rating markup on this site",
      ),
    );
  } else {
    out.push(
      check(
        "schema-self-review",
        "Ratings you publish about yourself",
        WHY_REVIEW,
        "content",
        selfServing.length === 0,
        selfServing.length === 0
          ? "your rating markup is attached to something other than your own organisation"
          : `an aggregateRating sits on your own ${typeOf(org)[0]} block`,
      ),
    );
  }

  return out;
}

// ─── Response headers ────────────────────────────────────────────────────────

/**
 * The six headers, one check each.
 *
 * Split from a single aggregate deliberately. As one row, "4 of 6 security
 * headers" is a grade nobody can act on; as six rows it is four green lines and
 * two named one-line fixes, and the reader can see which. Every one of them is
 * a line in a config file, which is why they are all `quick`.
 */
const SECURITY_HEADER_CHECKS: { header: string; label: string; why: string }[] = [
  {
    header: "strict-transport-security",
    label: "Telling browsers to always use https",
    why: "Without it, the first visit of the day can still be made over plain http before the redirect happens.",
  },
  {
    header: "content-security-policy",
    label: "A policy for what may run on your pages",
    why: "It is the difference between a compromised script running on your site and being blocked by the browser.",
  },
  {
    header: "x-content-type-options",
    label: "Stopping browsers guessing file types",
    why: "One line that prevents a browser treating an uploaded file as something executable.",
  },
  {
    header: "x-frame-options",
    label: "Stopping other sites framing yours",
    why: "Without it, anyone can put your site inside theirs and collect what visitors type into it.",
  },
  {
    header: "referrer-policy",
    label: "Controlling what you leak when visitors leave",
    why: "By default the full URL a visitor came from is handed to every site they click through to.",
  },
  {
    header: "permissions-policy",
    label: "Declaring what your pages may ask for",
    why: "It stops an embedded third party quietly asking your visitors for their camera or location.",
  },
];

/** A `server` or `x-powered-by` that names a version. The header on its own is
 *  ordinary; the version number is the part that tells an attacker which list
 *  of known holes to work through. */
const VERSIONED = /\d+\.\d+/;

function headerChecks(headers: Record<string, string>, measured: boolean): SiteCheck[] {
  const out: SiteCheck[] = [];

  for (const { header, label, why } of SECURITY_HEADER_CHECKS) {
    if (!measured) {
      out.push(unknown(`header-${header}`, label, why, "quick"));
      continue;
    }
    const present = header in headers;
    out.push(
      check(
        `header-${header}`,
        label,
        why,
        "quick",
        present,
        present ? `${header} is set` : `no ${header} header`,
      ),
    );
  }

  const WHY_LEAK =
    "Naming the exact version you run tells anyone looking which published vulnerabilities to try first.";
  if (!measured) {
    out.push(
      unknown("header-version-leak", "Not advertising your software versions", WHY_LEAK, "quick"),
    );
  } else {
    const leaks = ["server", "x-powered-by"]
      .filter((h) => headers[h] && VERSIONED.test(headers[h]!))
      .map((h) => `${h}: ${headers[h]}`);
    out.push(
      check(
        "header-version-leak",
        "Not advertising your software versions",
        WHY_LEAK,
        "quick",
        leaks.length === 0,
        leaks.length === 0 ? "no version numbers in your response headers" : leaks.join(", "),
      ),
    );
  }

  const WHY_GZIP =
    "Uncompressed HTML is roughly four times the bytes for the same page, paid for by every visitor on a phone.";
  if (!measured) {
    out.push(unknown("header-compression", "Pages sent compressed", WHY_GZIP, "quick"));
  } else {
    const enc = headers["content-encoding"] ?? "";
    const ok = /gzip|br|zstd|deflate/i.test(enc);
    out.push(
      check(
        "header-compression",
        "Pages sent compressed",
        WHY_GZIP,
        "quick",
        ok,
        ok ? `content-encoding: ${enc}` : "your HTML is served uncompressed",
      ),
    );
  }

  // Conditional on HSTS existing at all: a site with no HSTS has already been
  // reported by the check above, and failing it twice reads as two problems.
  const WHY_MAXAGE =
    "A max-age of a few minutes gives almost none of the protection the header exists for.";
  const hsts = headers["strict-transport-security"];
  const SIX_MONTHS = 15_552_000;
  if (!measured || !hsts) {
    out.push(
      skip(
        "header-hsts-age",
        "An https policy that lasts",
        WHY_MAXAGE,
        "quick",
        "no strict-transport-security header to read a max-age from",
      ),
    );
  } else {
    const m = /max-age\s*=\s*(\d+)/i.exec(hsts);
    const age = m ? Number(m[1]) : 0;
    out.push(
      check(
        "header-hsts-age",
        "An https policy that lasts",
        WHY_MAXAGE,
        "quick",
        age >= SIX_MONTHS,
        `max-age=${age}${age >= SIX_MONTHS ? "" : " — six months is the usual minimum"}`,
      ),
    );
  }

  return out;
}

// ─── robots.txt and the sitemap ──────────────────────────────────────────────

function sidecarChecks(crawl: CrawlResult, linkedPages: Set<string>): SiteCheck[] {
  const discoveredLinks = linkedPages.size;
  const out: SiteCheck[] = [];
  const robotsMeasured = crawl.sidecarErrors.robots === null;

  const WHY_DISALLOW =
    "A blanket Disallow tells every search engine and every assistant to stay off the whole site. It is usually left over from a staging server.";
  if (!robotsMeasured) {
    out.push(
      unknown(
        "robots-not-blocking",
        "robots.txt not blocking your whole site",
        WHY_DISALLOW,
        "quick",
      ),
    );
  } else if (crawl.robotsTxt === null) {
    // No robots.txt is not a defect — it means everything is allowed, which is
    // exactly what this check wants to be true.
    out.push(
      check(
        "robots-not-blocking",
        "robots.txt not blocking your whole site",
        WHY_DISALLOW,
        "quick",
        true,
        "no robots.txt, so nothing is disallowed",
      ),
    );
  } else {
    // Only a `Disallow: /` under a group that applies to everyone. A rule
    // aimed at one crawler is a policy, not an accident.
    const blocked = /user-agent\s*:\s*\*[^]*?^\s*disallow\s*:\s*\/\s*$/im.test(crawl.robotsTxt);
    out.push(
      check(
        "robots-not-blocking",
        "robots.txt not blocking your whole site",
        WHY_DISALLOW,
        "quick",
        !blocked,
        blocked ? "Disallow: / applies to every crawler" : "nothing site-wide is disallowed",
      ),
    );
  }

  const WHY_SITEMAP_LINE =
    "Naming the sitemap in robots.txt is how a crawler that has never seen your site finds the list of your pages.";
  if (!robotsMeasured || crawl.robotsTxt === null) {
    out.push(
      skip(
        "robots-names-sitemap",
        "robots.txt naming your sitemap",
        WHY_SITEMAP_LINE,
        "quick",
        robotsMeasured ? "this site has no robots.txt" : "we could not read robots.txt on this run",
      ),
    );
  } else {
    const named = /^\s*sitemap\s*:/im.test(crawl.robotsTxt);
    out.push(
      check(
        "robots-names-sitemap",
        "robots.txt naming your sitemap",
        WHY_SITEMAP_LINE,
        "quick",
        named,
        named ? "a Sitemap: line is present" : "no Sitemap: line in robots.txt",
      ),
    );
  }

  const sitemapMeasured = crawl.sidecarErrors.sitemap === null;
  const WHY_COVERAGE =
    "A sitemap listing fewer pages than your own navigation links to leaves the rest to be found by luck.";
  if (!sitemapMeasured || !crawl.sitemap.present) {
    out.push(
      skip(
        "sitemap-coverage",
        "A sitemap that lists your pages",
        WHY_COVERAGE,
        "content",
        sitemapMeasured
          ? "this site has no sitemap.xml"
          : "we could not read the sitemap on this run",
      ),
    );
  } else if (discoveredLinks === 0) {
    out.push(
      unknown("sitemap-coverage", "A sitemap that lists your pages", WHY_COVERAGE, "content"),
    );
  } else {
    // Compared against pages WE found links to, never against our own crawl
    // cap. "We read 14 of your pages" is a fact about our limit, and using it
    // as the denominator would report our ceiling as their gap.
    const ok = crawl.sitemap.urlCount >= discoveredLinks;
    // When the crawl carried the WHOLE sitemap, a count is not the best we can
    // do — we can name a page it leaves out, and a named page is a job where a
    // count is only a worry. Only when it is whole: against a truncated sample
    // an absent URL may be one we did not carry, and printing that as their
    // omission is our own ceiling reported as their gap for the second time in
    // the same check.
    const sample = crawl.sitemap.sample;
    const whole = sample !== undefined && crawl.sitemap.urlCount <= sample.length;
    const key = (u: string) => u.replace(/\/+$/, "").split("#")[0]!;
    const listed = new Set(sample?.map(key));
    const unlisted = whole ? [...linkedPages].filter((u) => !listed.has(key(u))) : [];
    out.push(
      check(
        "sitemap-coverage",
        "A sitemap that lists your pages",
        WHY_COVERAGE,
        "content",
        ok && unlisted.length === 0,
        unlisted.length > 0
          ? `${unlisted.length} ${unlisted.length === 1 ? "page your own links point to is" : "pages your own links point to are"} missing from it — ${unlisted[0]}`
          : `${crawl.sitemap.urlCount} URLs listed, against ${discoveredLinks} distinct pages your own links point to`,
      ),
    );
  }

  const WHY_LLMS =
    "A short llms.txt is the one file that tells an assistant, in your words, what you do and which pages matter.";
  const llmsMeasured = crawl.sidecarErrors.llms === null;
  if (!llmsMeasured) {
    out.push(unknown("llms-txt", "A file written for AI assistants", WHY_LLMS, "content"));
  } else {
    out.push(
      check(
        "llms-txt",
        "A file written for AI assistants",
        WHY_LLMS,
        "content",
        crawl.llmsTxt.present,
        crawl.llmsTxt.present ? (crawl.llmsTxt.firstLine ?? "present") : "no llms.txt",
      ),
    );
  }

  return out;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

const ANALYTICS_MARKERS =
  /(googletagmanager\.com|google-analytics\.com|plausible\.io|usefathom\.com|clarity\.ms|segment\.(?:com|io)|matomo|piwik|statcounter|hotjar\.com|posthog\.com|umami|simpleanalytics|cloudflareinsights\.com)/i;

function analyticsCheck(pages: { url: string; extract: PageExtract }[]): SiteCheck {
  const WHY =
    "Without any analytics you cannot tell whether a change helped, which visit turned into an enquiry, or whether the work was worth doing.";
  const LABEL = "Something measuring whether any of this works";
  const readable = pages.filter((p) => p.extract.scriptSrcs !== undefined);
  if (readable.length === 0) return unknown("analytics", LABEL, WHY, "quick");

  // Loaded scripts AND hosts named inside inline ones, because a growing share
  // of careful sites defer their tags. reddoorla.com injects gtag.js only after
  // the first pointer or scroll, for privacy — so at crawl time there is no
  // analytics `src` in the DOM at all, and reading that as "this site measures
  // nothing" was our blindness printed as their defect. It is exactly the
  // client who did the considerate thing who would have received that line.
  const loaded = readable.flatMap((p) => p.extract.scriptSrcs ?? []);
  const named = readable.flatMap((p) => p.extract.inlineScriptUrls ?? []);
  const hit = loaded.find((s) => ANALYTICS_MARKERS.test(s));
  const deferred = hit ? undefined : named.find((h) => ANALYTICS_MARKERS.test(h));

  return check(
    "analytics",
    LABEL,
    WHY,
    "quick",
    hit !== undefined || deferred !== undefined,
    hit ??
      (deferred ? `${deferred}, loaded on first interaction` : "no analytics on the pages we read"),
  );
}

// ─── Metas ───────────────────────────────────────────────────────────────────

/**
 * What the page tells search engines and assistants about itself.
 *
 * `<meta name="robots">` is the highest-value check in the whole battery. A
 * site ships `noindex` from staging, loses everything, and nothing on the page
 * looks wrong — it is invisible to the owner and instantly visible to us.
 *
 * Deliberately NOT here: the viewport-zoom check. axe's `meta-viewport` rule
 * tests exactly that (`user-scalable=no`, `maximum-scale` under 2) against the
 * rendered DOM, and asking the same question twice under two headings reads as
 * two problems.
 */
function metaChecks(pages: { url: string; extract: PageExtract }[]): SiteCheck[] {
  const out: SiteCheck[] = [];
  const readable = pages.filter((p) => p.extract.metas !== undefined);

  const WHY_NOINDEX =
    "This one line tells every search engine and assistant to leave the page out of their results entirely. It is almost always left over from a staging site, and nothing on the page looks wrong.";
  const WHY_NOFOLLOW =
    "It tells search engines not to follow any link on the page, so nothing you link to gets credit from it.";
  const WHY_CHARSET =
    "Without a declared character set the browser guesses, and a wrong guess is what turns apostrophes into â€™.";

  if (readable.length === 0) {
    return [
      unknown("meta-noindex", "Pages search engines are allowed to list", WHY_NOINDEX, "quick"),
      unknown("meta-nofollow", "Links search engines are allowed to follow", WHY_NOFOLLOW, "quick"),
      unknown("meta-charset", "A declared character set", WHY_CHARSET, "quick"),
      unknown(
        "title-length",
        "Titles that survive a search result",
        "A title that is too long is cut off mid-word in the result, and one that is too short wastes the most valuable line you get.",
        "content",
      ),
      unknown(
        "description-length",
        "Descriptions that survive a search result",
        "The description is the sentence under your link. Too long and it is truncated; too short and the engine writes its own.",
        "content",
      ),
      unknown(
        "og-image-absolute",
        "A share image with a full web address",
        "A relative og:image renders no card at all on Slack, LinkedIn or iMessage — the link arrives as bare text.",
        "quick",
      ),
      unknown(
        "duplicate-descriptions",
        "A different description on each page",
        "Identical descriptions make every page look like the same page in a search result.",
        "content",
      ),
    ];
  }

  const flagged = (token: RegExp): { url: string; value: string }[] =>
    readable
      .filter((p) => token.test(p.extract.metas?.["robots"] ?? ""))
      .map((p) => ({ url: p.url, value: p.extract.metas!["robots"]! }));

  const noindex = flagged(/\bnoindex\b/i);
  out.push(
    check(
      "meta-noindex",
      "Pages search engines are allowed to list",
      WHY_NOINDEX,
      "quick",
      noindex.length === 0,
      noindex.length === 0
        ? `none of the ${readable.length} pages we read asks to be hidden`
        : `${noindex.length} ${noindex.length === 1 ? "page carries" : "pages carry"} noindex: ${noindex
            .slice(0, 3)
            .map((n) => n.url)
            .join(", ")}`,
    ),
  );

  const nofollow = flagged(/\bnofollow\b/i);
  out.push(
    check(
      "meta-nofollow",
      "Links search engines are allowed to follow",
      WHY_NOFOLLOW,
      "quick",
      nofollow.length === 0,
      nofollow.length === 0
        ? "no page-wide nofollow"
        : `${nofollow.length} ${nofollow.length === 1 ? "page" : "pages"}`,
    ),
  );

  const noCharset = readable.filter((p) => !p.extract.metas?.["charset"]);
  out.push(
    check(
      "meta-charset",
      "A declared character set",
      WHY_CHARSET,
      "quick",
      noCharset.length === 0,
      noCharset.length === 0
        ? `declared on all ${readable.length} pages`
        : `missing on ${noCharset.length} ${noCharset.length === 1 ? "page" : "pages"}`,
    ),
  );

  // Generous bands, on purpose. Sixty characters is where Google truncates by
  // PIXEL width, not by character count, so a hard 60 fails a great many
  // perfectly good titles. Only the genuinely broken ends are flagged.
  const TITLE_MIN = 10;
  const TITLE_MAX = 70;
  const titled = pages.filter((p) => p.extract.title);
  if (titled.length === 0) {
    out.push(
      skip(
        "title-length",
        "Titles that survive a search result",
        "A title that is too long is cut off mid-word in the result, and one that is too short wastes the most valuable line you get.",
        "content",
        "no page we read carries a title, which is reported separately",
      ),
    );
  } else {
    const bad = titled.filter(
      (p) => p.extract.title!.length < TITLE_MIN || p.extract.title!.length > TITLE_MAX,
    );
    out.push(
      check(
        "title-length",
        "Titles that survive a search result",
        "A title that is too long is cut off mid-word in the result, and one that is too short wastes the most valuable line you get.",
        "content",
        bad.length === 0,
        bad.length === 0
          ? `all ${titled.length} are between ${TITLE_MIN} and ${TITLE_MAX} characters`
          : bad
              .slice(0, 2)
              .map((p) => `${p.url}: ${p.extract.title!.length} characters`)
              .join(", "),
      ),
    );
  }

  const DESC_MIN = 50;
  const DESC_MAX = 170;
  const described = pages.filter((p) => p.extract.metaDescription);
  if (described.length === 0) {
    out.push(
      skip(
        "description-length",
        "Descriptions that survive a search result",
        "The description is the sentence under your link. Too long and it is truncated; too short and the engine writes its own.",
        "content",
        "no page we read carries a description, which is reported separately",
      ),
    );
  } else {
    const bad = described.filter(
      (p) =>
        p.extract.metaDescription!.length < DESC_MIN ||
        p.extract.metaDescription!.length > DESC_MAX,
    );
    out.push(
      check(
        "description-length",
        "Descriptions that survive a search result",
        "The description is the sentence under your link. Too long and it is truncated; too short and the engine writes its own.",
        "content",
        bad.length === 0,
        bad.length === 0
          ? `all ${described.length} are between ${DESC_MIN} and ${DESC_MAX} characters`
          : bad
              .slice(0, 2)
              .map((p) => `${p.url}: ${p.extract.metaDescription!.length} characters`)
              .join(", "),
      ),
    );
  }

  const WHY_OG =
    "A relative og:image renders no card at all on Slack, LinkedIn or iMessage — the link arrives as bare text.";
  const withOg = pages.filter((p) => p.extract.social["og:image"]);
  if (withOg.length === 0) {
    out.push(
      skip(
        "og-image-absolute",
        "A share image with a full web address",
        WHY_OG,
        "quick",
        "no page we read declares an og:image",
      ),
    );
  } else {
    const relative = withOg.filter((p) => !/^https?:\/\//i.test(p.extract.social["og:image"]!));
    out.push(
      check(
        "og-image-absolute",
        "A share image with a full web address",
        WHY_OG,
        "quick",
        relative.length === 0,
        relative.length === 0
          ? withOg[0]!.extract.social["og:image"]!
          : `${relative[0]!.url} declares “${relative[0]!.extract.social["og:image"]}”, which has no host`,
      ),
    );
  }

  const WHY_DUP_DESC =
    "Identical descriptions make every page look like the same page in a search result, and the engine usually replaces them with a sentence of its own choosing.";
  if (described.length < 2) {
    out.push(
      skip(
        "duplicate-descriptions",
        "A different description on each page",
        WHY_DUP_DESC,
        "content",
        "fewer than two pages carry a description, so there is nothing to compare",
      ),
    );
  } else {
    const seen = new Map<string, string[]>();
    for (const p of described) {
      const key = p.extract.metaDescription!.trim().toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), p.url]);
    }
    const dupes = [...seen.entries()].filter(([, urls]) => urls.length > 1);
    out.push(
      check(
        "duplicate-descriptions",
        "A different description on each page",
        WHY_DUP_DESC,
        "content",
        dupes.length === 0,
        dupes.length === 0
          ? `${described.length} pages, ${seen.size} different descriptions`
          : `${dupes[0]![1].length} pages share one description`,
      ),
    );
  }

  return out;
}

// ─── The <link> set ──────────────────────────────────────────────────────────

function linkChecks(pages: { url: string; extract: PageExtract }[], origin: string): SiteCheck[] {
  const readable = pages.filter((p) => p.extract.links !== undefined);
  const WHY_FAVICON =
    "Without one the browser shows a blank page icon in the tab and the bookmark, which is the smallest possible thing to fix and the most often seen.";
  const WHY_CANON_SELF =
    "A canonical pointing somewhere else tells search engines to index that page instead of this one. Every page pointing at the home page is the version of this mistake that removes a whole site from search results.";
  const WHY_CANON_ORIGIN =
    "A canonical on another domain hands every page's search ranking to that domain. It is usually a staging host or a site they used to own.";
  const WHY_HREFLANG =
    "An hreflang set that does not name itself is ignored, so the translated pages compete with each other instead of being offered to the right reader.";

  if (readable.length === 0) {
    return [
      unknown("favicon-declared", "An icon for the browser tab", WHY_FAVICON, "quick"),
      unknown("canonical-self", "Pages that point at themselves", WHY_CANON_SELF, "structural"),
      unknown(
        "canonical-origin",
        "Canonicals that stay on your domain",
        WHY_CANON_ORIGIN,
        "structural",
      ),
      unknown("hreflang-self", "Language alternates that name themselves", WHY_HREFLANG, "content"),
    ];
  }

  const out: SiteCheck[] = [];
  const icon = readable
    .flatMap((p) => p.extract.links ?? [])
    .find((l) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(l.rel));
  out.push(
    check(
      "favicon-declared",
      "An icon for the browser tab",
      WHY_FAVICON,
      "quick",
      icon !== undefined,
      icon ? `rel="${icon.rel}" → ${icon.href}` : "no icon link on the pages we read",
    ),
  );

  const host = (u: string, base?: string): string | null => {
    try {
      return new URL(u, base).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return null;
    }
  };
  const ownHost = host(origin);

  const canonical = pages.filter((p) => p.extract.canonical);
  if (canonical.length === 0) {
    out.push(
      skip(
        "canonical-self",
        "Pages that point at themselves",
        WHY_CANON_SELF,
        "structural",
        "no page we read declares a canonical, which is reported separately",
      ),
      skip(
        "canonical-origin",
        "Canonicals that stay on your domain",
        WHY_CANON_ORIGIN,
        "structural",
        "no page we read declares a canonical",
      ),
    );
  } else {
    // Compared path-wise and host-wise, ignoring a trailing slash and a `www.`,
    // because those differences are not what this check is about and flagging
    // them would bury the one case that matters.
    const norm = (u: string, base: string): string | null => {
      try {
        const parsed = new URL(u, base);
        return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${
          parsed.pathname.replace(/\/+$/, "") || "/"
        }`;
      } catch {
        return null;
      }
    };
    const notSelf = canonical.filter((p) => {
      const a = norm(p.extract.canonical!, p.url);
      const b = norm(p.url, p.url);
      return a === null || b === null || a !== b;
    });
    out.push(
      check(
        "canonical-self",
        "Pages that point at themselves",
        WHY_CANON_SELF,
        "structural",
        notSelf.length === 0,
        notSelf.length === 0
          ? `all ${canonical.length} canonicals point at their own page`
          : `${notSelf.length} of ${canonical.length}: ${notSelf[0]!.url} points at ${notSelf[0]!.extract.canonical}`,
      ),
    );

    const offOrigin = canonical.filter((p) => {
      const h = host(p.extract.canonical!, p.url);
      return h !== null && h !== ownHost;
    });
    out.push(
      check(
        "canonical-origin",
        "Canonicals that stay on your domain",
        WHY_CANON_ORIGIN,
        "structural",
        offOrigin.length === 0,
        offOrigin.length === 0
          ? "every canonical stays on this domain"
          : `${offOrigin[0]!.url} points at ${offOrigin[0]!.extract.canonical}`,
      ),
    );
  }

  // Conditional by nature: a monolingual site has no alternates, and passing it
  // would be five free points for something it does not do.
  const alternates = readable.filter((p) =>
    (p.extract.links ?? []).some((l) => l.rel === "alternate" && l.hreflang),
  );
  if (alternates.length === 0) {
    out.push(
      skip(
        "hreflang-self",
        "Language alternates that name themselves",
        WHY_HREFLANG,
        "content",
        "this site publishes no language alternates",
      ),
    );
  } else {
    const missingSelf = alternates.filter((p) => {
      const mine = norm2(p.url);
      return !(p.extract.links ?? []).some(
        (l) => l.rel === "alternate" && l.hreflang && norm2(l.href, p.url) === mine,
      );
    });
    out.push(
      check(
        "hreflang-self",
        "Language alternates that name themselves",
        WHY_HREFLANG,
        "content",
        missingSelf.length === 0,
        missingSelf.length === 0
          ? `${alternates.length} ${alternates.length === 1 ? "page lists" : "pages list"} themselves among their alternates`
          : `${missingSelf[0]!.url} is not among its own alternates`,
      ),
    );
  }

  return out;
}

/** Host + path, trailing slash and `www.` ignored — the comparison every URL
 *  equality check in this file wants. */
function norm2(u: string, base?: string): string | null {
  try {
    const parsed = new URL(u, base);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${
      parsed.pathname.replace(/\/+$/, "") || "/"
    }`;
  } catch {
    return null;
  }
}

// ─── Forms, in the detail that decides whether they get filled in ────────────

/** Providers whose endpoint we recognise, so an action pointing at one is not
 *  reported as a mystery. Deliberately incomplete — see the check. */
const FORM_PROVIDERS =
  /(formspree\.io|hsforms\.(?:net|com)|typeform\.com|jotform\.com|wufoo\.com|formstack\.com|getform\.io|basin\.com|netlify|web3forms\.com|formsubmit\.co|google\.com\/forms)/i;

function formChecks(pages: { url: string; extract: PageExtract }[]): SiteCheck[] {
  const WHY_TYPES =
    "An email field typed as plain text gives a phone the ordinary keyboard, so the visitor hunts for the @ at exactly the moment they had decided to write to you.";
  const WHY_AUTOCOMPLETE =
    "With these, a phone offers to fill the whole form in one tap. Without them it does not offer at all.";
  const WHY_METHOD =
    "A form that submits with GET puts everything the visitor typed into the address bar, and from there into your server logs and their browser history.";
  const WHY_ACTION =
    "A form posting to an endpoint nobody owns any more looks like it worked and silently goes nowhere.";
  const WHY_REQUIRED =
    "Without it the browser cannot stop a half-filled form being sent, and the visitor finds out something was missing only if somebody tells them.";

  const enquiries = pages.flatMap((p) =>
    (p.extract.forms ?? [])
      .filter((f) => f.kind === "enquiry")
      .map((f) => ({ form: f, url: p.url })),
  );
  const measured = enquiries.filter((e) => e.form.fields !== undefined);

  if (enquiries.length === 0) {
    const note = "no enquiry form on the pages we read, which is reported separately";
    return [
      skip("form-field-types", "Fields typed for a phone keyboard", WHY_TYPES, "content", note),
      skip(
        "form-autocomplete",
        "Fields a phone can fill in one tap",
        WHY_AUTOCOMPLETE,
        "content",
        note,
      ),
      skip("form-method", "A form that does not put answers in the URL", WHY_METHOD, "quick", note),
      skip(
        "form-action",
        "A form that posts somewhere we recognise",
        WHY_ACTION,
        "structural",
        note,
      ),
      skip("form-required", "Fields marked as required", WHY_REQUIRED, "quick", note),
    ];
  }
  if (measured.length === 0) {
    return [
      unknown("form-field-types", "Fields typed for a phone keyboard", WHY_TYPES, "content"),
      unknown(
        "form-autocomplete",
        "Fields a phone can fill in one tap",
        WHY_AUTOCOMPLETE,
        "content",
      ),
      unknown("form-method", "A form that does not put answers in the URL", WHY_METHOD, "quick"),
      unknown("form-action", "A form that posts somewhere we recognise", WHY_ACTION, "structural"),
      unknown("form-required", "Fields marked as required", WHY_REQUIRED, "quick"),
    ];
  }

  const out: SiteCheck[] = [];
  const looksLikeEmail = (f: NonNullable<FormShape["fields"]>[number]): boolean =>
    /e-?mail/i.test(`${f.name ?? ""} ${f.autocomplete ?? ""}`);
  const looksLikePhone = (f: NonNullable<FormShape["fields"]>[number]): boolean =>
    /\b(phone|tel|mobile)\b/i.test(`${f.name ?? ""} ${f.autocomplete ?? ""}`);

  const mistyped = measured.flatMap(({ form, url }) =>
    (form.fields ?? [])
      .filter(
        (f) => (looksLikeEmail(f) && f.type !== "email") || (looksLikePhone(f) && f.type !== "tel"),
      )
      .map((f) => `${url}: ${f.name ?? "a field"} is type="${f.type}"`),
  );
  out.push(
    check(
      "form-field-types",
      "Fields typed for a phone keyboard",
      WHY_TYPES,
      "content",
      mistyped.length === 0,
      mistyped.length === 0
        ? "your email and phone fields use the right input types"
        : mistyped.slice(0, 2).join(", "),
    ),
  );

  const withAuto = measured.filter(({ form }) => (form.fields ?? []).some((f) => f.autocomplete));
  out.push(
    check(
      "form-autocomplete",
      "Fields a phone can fill in one tap",
      WHY_AUTOCOMPLETE,
      "content",
      withAuto.length === measured.length,
      withAuto.length === measured.length
        ? `${countOf(measured.length, "enquiry form", "enquiry forms")} ${
            measured.length === 1 ? "carries" : "carry"
          } autocomplete`
        : `${measured.length - withAuto.length} of ${measured.length} carry none`,
    ),
  );

  const getForms = measured.filter(({ form }) => form.method !== "post");
  out.push(
    check(
      "form-method",
      "A form that does not put answers in the URL",
      WHY_METHOD,
      "quick",
      getForms.length === 0,
      getForms.length === 0
        ? "every enquiry form posts"
        : `${getForms[0]!.url} submits with ${getForms[0]!.form.method.toUpperCase()}`,
    ),
  );

  // A provider we do not recognise is UNMEASURED, never a failure: our list will
  // always be incomplete, and calling a working in-house endpoint broken is
  // exactly the false alarm that costs a prospect's trust in everything else.
  const offsite = measured.filter(({ form, url }) => {
    const action = form.action;
    if (!action) return false;
    const h = norm2(action, url);
    const own = norm2(url);
    return h !== null && own !== null && h.split("/")[0] !== own.split("/")[0];
  });
  const unrecognised = offsite.filter(({ form }) => !FORM_PROVIDERS.test(form.action ?? ""));
  out.push(
    unrecognised.length > 0
      ? unknown("form-action", "A form that posts somewhere we recognise", WHY_ACTION, "structural")
      : check(
          "form-action",
          "A form that posts somewhere we recognise",
          WHY_ACTION,
          "structural",
          true,
          offsite.length === 0
            ? "your forms post to your own site"
            : `posts to ${offsite[0]!.form.action}`,
        ),
  );

  const noRequired = measured.filter(({ form }) => !(form.fields ?? []).some((f) => f.required));
  out.push(
    check(
      "form-required",
      "Fields marked as required",
      WHY_REQUIRED,
      "quick",
      noRequired.length === 0,
      noRequired.length === 0
        ? `every enquiry form marks at least one field required`
        : `${noRequired[0]!.url} marks none`,
    ),
  );

  return out;
}

/** T0-04, which needed the `target` attribute and so waited for this tier. */
function newTabChecks(pages: { url: string; extract: PageExtract }[]): SiteCheck[] {
  // Tidiness, NOT a vulnerability. Browsers have implied `noopener` for
  // `target="_blank"` since 2021, so the honest framing is a lint that shows
  // care — overstating it as a security hole is the kind of thing that
  // discredits every other line in the report.
  const WHY =
    'Adding rel="noopener" to links that open a new tab is a one-line habit that keeps older browsers from handing the new page a reference back to yours.';
  const LABEL = 'New-tab links carrying rel="noopener"';
  const readable = pages.filter((p) =>
    (p.extract.anchors ?? []).every((a) => a.target !== undefined),
  );
  if (pages.length === 0 || readable.length !== pages.length) {
    return [unknown("noopener", LABEL, WHY, "quick")];
  }
  const blanks = readable.flatMap((p) =>
    (p.extract.anchors ?? []).filter((a) => a.target === "_blank"),
  );
  if (blanks.length === 0) {
    return [skip("noopener", LABEL, WHY, "quick", "no link on these pages opens a new tab")];
  }
  const bare = blanks.filter((a) => !/\bnoopener\b/.test(a.rel));
  return [
    check(
      "noopener",
      LABEL,
      WHY,
      "quick",
      bare.length === 0,
      bare.length === 0
        ? `all ${blanks.length} new-tab ${blanks.length === 1 ? "link carries" : "links carry"} it`
        : `${bare.length} of ${blanks.length} new-tab ${
            blanks.length === 1 ? "link is" : "links are"
          } missing it`,
    ),
  ];
}

// ─── What the browser itself reported ────────────────────────────────────────

/**
 * The five findings a browser hands you for free once you have already opened
 * the page, and which no amount of markup reading can reach.
 *
 * A JavaScript error on the home page is the single most demonstrable "your
 * site is broken" finding there is: it is invisible in the HTML, invisible to
 * the owner, and a reader can confirm it in fifteen seconds with their own
 * developer tools. Horizontal overflow at 375px is the same shape — the most
 * common mobile bug on the web, and one nobody sees until somebody looks.
 */
function browserChecks(
  pages: { url: string; extract: PageExtract; vitals?: unknown }[],
): SiteCheck[] {
  const WHY_CONSOLE =
    "A script that throws stops running, so whatever it was doing — a menu, a form, a gallery — silently stops working for every visitor from that point on.";
  const WHY_REQUESTS =
    "A file the page asks for and does not get is a missing image, an unstyled section or a feature that does nothing.";
  const WHY_OVERFLOW =
    "Something on the page is wider than a phone screen, so the whole page scrolls sideways. Most of your visitors are on a phone, and this is the first thing they will notice.";
  const WHY_TINY =
    "Text under twelve pixels is uncomfortable on a desktop and unreadable on a phone without pinching.";
  const WHY_HEAVY =
    "These images are downloaded at several times the size they are shown at, so every visitor pays for pixels they never see.";

  const withVitals = pages.filter((p): p is typeof p & { vitals: PageVitals } => p.vitals != null);
  if (withVitals.length === 0) {
    return [
      unknown("console-errors", "Pages without JavaScript errors", WHY_CONSOLE, "structural"),
      unknown("failed-requests", "Files the page asks for and gets", WHY_REQUESTS, "quick"),
      unknown("mobile-overflow", "Pages that fit a phone screen", WHY_OVERFLOW, "structural"),
      unknown("tiny-text", "Text big enough to read", WHY_TINY, "content"),
      unknown("oversized-images", "Images sized for where they are shown", WHY_HEAVY, "quick"),
    ];
  }

  const out: SiteCheck[] = [];

  const erroring = withVitals.filter((p) => p.vitals.consoleErrors.length > 0);
  out.push(
    check(
      "console-errors",
      "Pages without JavaScript errors",
      WHY_CONSOLE,
      "structural",
      erroring.length === 0,
      erroring.length === 0
        ? `none on the ${withVitals.length} pages we opened`
        : `${erroring[0]!.url}: ${erroring[0]!.vitals.consoleErrors[0]}`,
    ),
  );

  // FIRST-PARTY ONLY. A blocked analytics beacon or a third-party widget that
  // 404s is our network, an ad blocker, or somebody else's outage — reporting
  // it as their broken site is the exact error this codebase exists to avoid.
  const broken = withVitals.flatMap((p) =>
    p.vitals.failedRequests.filter((r) => r.firstParty).map((r) => ({ ...r, page: p.url })),
  );
  out.push(
    check(
      "failed-requests",
      "Files the page asks for and gets",
      WHY_REQUESTS,
      "quick",
      broken.length === 0,
      broken.length === 0
        ? "every file your pages asked for came back"
        : `${broken.length}: ${broken
            .slice(0, 2)
            .map((b) => `${b.url}${b.status ? ` (${b.status})` : ""}`)
            .join(", ")}`,
    ),
  );

  const measuredOverflow = withVitals.filter((p) => p.vitals.overflowAt375 !== null);
  if (measuredOverflow.length === 0) {
    out.push(
      unknown("mobile-overflow", "Pages that fit a phone screen", WHY_OVERFLOW, "structural"),
    );
  } else {
    // A couple of pixels is a rounding artefact of a scrollbar or a border, not
    // a layout bug. The bar is where a human would actually see the page move.
    const OVERFLOW_TOLERANCE = 4;
    const wide = measuredOverflow.filter((p) => p.vitals.overflowAt375! > OVERFLOW_TOLERANCE);
    out.push(
      check(
        "mobile-overflow",
        "Pages that fit a phone screen",
        WHY_OVERFLOW,
        "structural",
        wide.length === 0,
        wide.length === 0
          ? `all ${measuredOverflow.length} fit a 375px screen`
          : `${wide[0]!.url} is ${wide[0]!.vitals.overflowAt375}px wider than the screen`,
      ),
    );
  }

  const measuredText = withVitals.filter((p) => p.vitals.tinyText !== null);
  if (measuredText.length === 0) {
    out.push(unknown("tiny-text", "Text big enough to read", WHY_TINY, "content"));
  } else {
    const tiny = measuredText.filter((p) => p.vitals.tinyText!.count > 0);
    out.push(
      check(
        "tiny-text",
        "Text big enough to read",
        WHY_TINY,
        "content",
        tiny.length === 0,
        tiny.length === 0
          ? "no text under 12px on the pages we opened"
          : `${tiny[0]!.url}: ${tiny[0]!.vitals.tinyText!.count} ${
              tiny[0]!.vitals.tinyText!.count === 1 ? "passage" : "passages"
            }, e.g. “${tiny[0]!.vitals.tinyText!.sample}”`,
      ),
    );
  }

  const heavy = withVitals.flatMap((p) => p.vitals.oversizedImages);
  out.push(
    check(
      "oversized-images",
      "Images sized for where they are shown",
      WHY_HEAVY,
      "quick",
      heavy.length === 0,
      heavy.length === 0
        ? "every image is close to the size it is drawn at"
        : `${heavy[0]!.src} is ${heavy[0]!.naturalWidth}px wide and drawn at ${heavy[0]!.renderedWidth}px`,
    ),
  );

  return out;
}

// ─── The domain, as opposed to the website ───────────────────────────────────

/**
 * Five findings that never touch their web server.
 *
 * Every one of these is invisible from any amount of reading their HTML, and
 * two of them — "anyone can send email as you" and "your domain renews in
 * forty-one days" — are acted on the same afternoon they are read.
 */
/** A published DNS record can run to several hundred characters. The reader
 *  needs to see that one exists and how it ends — `~all`, `p=reject` — not to
 *  read every include. The full record is one `dig` away and we are not it. */
function clipRecord(record: string, max = 90): string {
  const one = record.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

export function dnsChecks(dns: DnsFindings | null): SiteCheck[] {
  const WHY_SPF =
    "Without it, anyone can send email that appears to come from your address, and your own mail is more likely to be filed as spam.";
  const WHY_DMARC =
    "SPF says who may send as you. DMARC is what tells the receiving mail server to act on that, and to report attempts to you. Without it the first one is advisory.";
  const WHY_MX =
    "There is no mail server listed for your domain, so email sent to any address at it is rejected.";
  const WHY_CONTACT_MX =
    "The address you publish is on a domain with no mail server, so anything sent to it bounces.";
  // WHAT THIS CHECK CANNOT SEE. The registry publishes the date a registration
  // lapses. It does not publish whether the registrar will renew it
  // automatically, and most well-run domains renew inside the last thirty days
  // — so a date close at hand is a thing to confirm, not a fault we have found.
  // Saying otherwise would be our missing measurement dressed up as their
  // defect, and the client who answers "auto-renew is on" is then right and we
  // are wrong about the one line they checked.
  const WHY_EXPIRY =
    "Registration dates are public; whether it renews automatically is not, so this is one to confirm at your registrar rather than a fault we can see. When a registration does lapse the site and the email stop together, usually on a weekend, and getting them back is neither quick nor certain.";

  if (!dns || !dns.measured) {
    return [
      unknown("dns-spf", "An SPF record, so your email is trusted", WHY_SPF, "quick"),
      unknown("dns-dmarc", "A DMARC record, so SPF is enforced", WHY_DMARC, "quick"),
      unknown("dns-mx", "A mail server for your domain", WHY_MX, "structural"),
      unknown("dns-contact-mx", "An email address that can receive mail", WHY_CONTACT_MX, "quick"),
      unknown("domain-expiry", "A domain registration with room to spare", WHY_EXPIRY, "quick"),
    ];
  }

  const out: SiteCheck[] = [];

  out.push(
    dns.spf === undefined
      ? unknown("dns-spf", "An SPF record, so your email is trusted", WHY_SPF, "quick")
      : check(
          "dns-spf",
          "An SPF record, so your email is trusted",
          WHY_SPF,
          "quick",
          dns.spf !== null,
          (dns.spf ? clipRecord(dns.spf) : null) ?? `no v=spf1 record on ${dns.domain}`,
        ),
  );

  out.push(
    dns.dmarc === undefined
      ? unknown("dns-dmarc", "A DMARC record, so SPF is enforced", WHY_DMARC, "quick")
      : check(
          "dns-dmarc",
          "A DMARC record, so SPF is enforced",
          WHY_DMARC,
          "quick",
          dns.dmarc !== null,
          (dns.dmarc ? clipRecord(dns.dmarc) : null) ?? `no record at _dmarc.${dns.domain}`,
        ),
  );

  out.push(
    dns.mx === undefined
      ? unknown("dns-mx", "A mail server for your domain", WHY_MX, "structural")
      : check(
          "dns-mx",
          "A mail server for your domain",
          WHY_MX,
          "structural",
          dns.mx.length > 0,
          dns.mx.length > 0 ? dns.mx.slice(0, 2).join(", ") : `no MX record on ${dns.domain}`,
        ),
  );

  out.push(
    dns.contactMx === undefined
      ? unknown("dns-contact-mx", "An email address that can receive mail", WHY_CONTACT_MX, "quick")
      : dns.contactMx === null
        ? skip(
            "dns-contact-mx",
            "An email address that can receive mail",
            WHY_CONTACT_MX,
            "quick",
            "the addresses you publish are on your own domain, which is checked above",
          )
        : check(
            "dns-contact-mx",
            "An email address that can receive mail",
            WHY_CONTACT_MX,
            "quick",
            dns.contactMx.hasMx,
            `${dns.contactMx.domain}${dns.contactMx.hasMx ? " accepts mail" : " has no mail server"}`,
          ),
  );

  // Thirty days is the point at which this stops being a diary note and starts
  // being a thing to do today. Many ccTLDs publish no expiry at all, which is
  // the registry's choice and reads as unmeasured.
  const DAYS = 30;
  if (dns.expiresAt === undefined) {
    out.push(
      unknown("domain-expiry", "A domain registration with room to spare", WHY_EXPIRY, "quick"),
    );
  } else {
    const on = dns.expiresAt.slice(0, 10);
    const days = Math.round((Date.parse(dns.expiresAt) - Date.now()) / 86_400_000);
    // Never "renews on" — that word asserts an auto-renewal the registry does
    // not publish. The date is the whole of what we know.
    const evidence =
      days < 0
        ? `the registration lapsed on ${on}`
        : days > DAYS
          ? `registered through ${on}`
          : `registered through ${on} — ${days === 1 ? "1 day" : `${days} days`} away`;
    out.push(
      check(
        "domain-expiry",
        "A domain registration with room to spare",
        WHY_EXPIRY,
        "quick",
        days > DAYS,
        evidence,
      ),
    );
  }

  return out;
}

/**
 * The Tier 2 verdicts — what the server actually served.
 *
 * Every field of `HttpFindings` is three-state, and the shape below is the same
 * three times over: `undefined` becomes `unmeasured`, `null` becomes
 * `not-applicable`, and only a real answer reaches a pass or a fail. A probe we
 * could not read (403 from bot management, 429 we caused ourselves) arrives as
 * the verdict `unverified` and stops there — it never becomes a finding.
 */
export function httpChecks(http: HttpFindings | null): SiteCheck[] {
  const WHY_FAVICON =
    "The icon in the browser tab and the bookmark bar. When the file is missing the tab shows a blank sheet, which is the difference between a site that looks maintained and one that does not.";
  const WHY_UPGRADE =
    "Somebody typing your address without https, or following an old link, should land on the secure version in one step. Every extra redirect is delay on the first impression, and a chain that ends on http means the page is served in the clear.";
  const WHY_STABLE =
    "Two requests seconds apart got different answers, which is what an overloaded or half-deployed server looks like from outside. Some visitors are seeing the bad one.";
  const WHY_SLASH =
    "When /about and /about/ both answer with the same page and neither says which is real, search engines index both and split the credit between them.";
  const WHY_INDEX =
    "Your homepage answers at two addresses. Links, shares and search results scatter across both instead of accumulating on one.";
  const WHY_CASE =
    "The same page answers at two spellings, so the same content competes with itself in search results.";
  const WHY_SITEMAP_LIVE =
    "A sitemap is a list you hand to search engines saying 'these pages exist'. Entries that no longer answer waste the crawl budget you were trying to direct.";
  const WHY_EXTERNAL =
    "A link on your site that leads nowhere is a dead end for the visitor and a small mark against the page for a search engine.";
  const WHY_OG_SERVED =
    "This is the picture that appears when your page is shared in a message, on LinkedIn, or in a Slack channel. When the file does not load, the share renders as a bare grey box.";
  const WHY_OG_SIZE = `A share image under ${MIN_OG_IMAGE_EDGE} pixels on either edge is either cropped to nothing or dropped entirely by the platform showing it.`;
  const WHY_LOGO =
    "A logo that does not load leaves a broken-image icon at the top of every page, and it is the first thing on the page.";
  const WHY_CHAINS =
    "A link that redirects more than once makes every visitor wait through each hop, and search engines pass less credit along a chain than a direct link.";

  const ALL: [string, string, string, Scope][] = [
    ["favicon-served", "A favicon that actually loads", WHY_FAVICON, "quick"],
    ["https-upgrade", "http:// reaching https:// without a detour", WHY_UPGRADE, "structural"],
    ["home-stable", "A homepage that answers the same way twice", WHY_STABLE, "structural"],
    ["trailing-slash", "One address per page, slash or no slash", WHY_SLASH, "structural"],
    ["index-alias", "A homepage that lives at one address", WHY_INDEX, "structural"],
    ["case-alias", "Paths that do not answer to two spellings", WHY_CASE, "structural"],
    ["sitemap-urls-live", "A sitemap whose pages still exist", WHY_SITEMAP_LIVE, "quick"],
    ["external-links-live", "Outbound links that still work", WHY_EXTERNAL, "quick"],
    ["og-image-served", "A share image that loads", WHY_OG_SERVED, "quick"],
    ["og-image-size", "A share image big enough to render", WHY_OG_SIZE, "quick"],
    ["logo-served", "A logo that loads", WHY_LOGO, "quick"],
    ["redirect-chains", "Internal links that go straight there", WHY_CHAINS, "quick"],
  ];

  const meta = new Map(ALL.map(([key, label, why, scope]) => [key, { label, why, scope }]));
  const unmeasuredAll = (): SiteCheck[] =>
    ALL.map(([key, label, why, scope]) => unknown(key, label, why, scope));

  if (!http || !http.measured) return unmeasuredAll();

  const out: SiteCheck[] = [];
  /**
   * One place where the three states are read, so no check below can invent a
   * fourth reading — and so `not-applicable` and `unmeasured` cannot both be
   * pushed for the same key, which is what happened when each check decided
   * for itself.
   *
   *   undefined from `value`    we never got an answer           → unmeasured
   *   undefined from `verdict`  we got one and could not read it → unmeasured
   *   null from `verdict`       there was nothing of this kind   → not-applicable
   */
  const add = (
    key: string,
    value: unknown,
    verdict: () => { ok: boolean; evidence: string } | null | undefined,
  ): void => {
    const m = meta.get(key)!;
    if (value === undefined) return void out.push(unknown(key, m.label, m.why, m.scope));
    const v = verdict();
    if (v === undefined) return void out.push(unknown(key, m.label, m.why, m.scope));
    if (v === null) return void out.push(skip(key, m.label, m.why, m.scope, notApplicable(key)));
    out.push(check(key, m.label, m.why, m.scope, v.ok, v.evidence));
  };

  const notApplicable = (key: string): string =>
    key === "index-alias"
      ? "/index.html does not answer, which is the behaviour we were hoping for"
      : key === "case-alias"
        ? "a differently-cased path 404s, which is the behaviour we were hoping for"
        : key === "og-image-served" || key === "og-image-size"
          ? "the homepage declares no share image, which is covered above"
          : key === "sitemap-urls-live"
            ? "there is no sitemap to check, which is covered above"
            : key === "external-links-live"
              ? "this site does not link out to anywhere else"
              : "there was nothing of this kind to check";

  /** A probe that answered 403 or 429 told us about a CDN, not about the site. */
  const fromVerdict = (v: ProbeVerdict, ok: string, bad: string) =>
    v === "unverified" ? undefined : { ok: v === "ok", evidence: v === "ok" ? ok : bad };

  add("favicon-served", http.favicon, () => {
    const f = http.favicon!;
    return fromVerdict(
      f.verdict,
      f.declared ? "the declared icon is served" : "/favicon.ico is served",
      f.declared ? `the icon at ${f.url} does not load` : "no icon at /favicon.ico",
    );
  });

  add("https-upgrade", http.httpUpgrade, () => {
    const u = http.httpUpgrade!;
    if (!u.https) return { ok: false, evidence: "http:// does not end up on https://" };
    const hops = u.hops;
    if (hops === null) return { ok: true, evidence: "http:// arrives on https://" };
    return {
      ok: hops <= 2,
      evidence:
        hops <= 2
          ? `http:// arrives on https:// in ${hops === 1 ? "one hop" : `${hops} hops`}`
          : `http:// takes ${hops} redirects to reach https://`,
    };
  });

  add("home-stable", http.homeSamples, () => {
    const [a, b] = http.homeSamples!;
    // Both halves must have answered, and a pair of matching non-2xx statuses
    // is a different check's business — reporting it here would say
    // "intermittent" about a server that is consistently down.
    if (a === null || b === null) return null;
    if (a === b)
      return a >= 200 && a < 400 ? { ok: true, evidence: `two requests, both ${a}` } : null;
    return { ok: false, evidence: `two requests seconds apart answered ${a} and ${b}` };
  });

  add("trailing-slash", http.trailingSlash, () => {
    const t = http.trailingSlash!;
    return { ok: t.settled, evidence: `${t.path} — ${t.detail}` };
  });

  add("index-alias", http.indexAlias, () => {
    const i = http.indexAlias;
    return i === null ? null : { ok: !i!.duplicate, evidence: `/index.html — ${i!.detail}` };
  });

  add("case-alias", http.caseAlias, () => {
    const c = http.caseAlias;
    return c === null ? null : { ok: !c!.duplicate, evidence: `${c!.path} — ${c!.detail}` };
  });

  add("sitemap-urls-live", http.sitemapUrls, () => {
    const s = http.sitemapUrls;
    if (s === null) return null;
    const { checked, total, broken } = s!;
    // The denominator travels with the verdict: "every URL works" would be a
    // lie about a sitemap of four hundred when we asked about twelve. Phrased
    // so the two numbers cannot be read as a ratio of working to broken —
    // "12 of 49 answer" says the other 37 did not, and means the opposite.
    return broken.length === 0
      ? {
          ok: true,
          evidence:
            checked >= total
              ? `all ${total} answer`
              : `we sampled ${checked} of ${total}; all of them answer`,
        }
      : {
          ok: false,
          evidence: `${broken.length} of the ${checked} we sampled are gone — ${broken[0]!.url}`,
        };
  });

  add("external-links-live", http.externalLinks, () => {
    const e = http.externalLinks;
    if (e === null) return null;
    const { checked, total, broken } = e!;
    return broken.length === 0
      ? {
          ok: true,
          evidence:
            checked >= total
              ? `${countOf(total, "outbound link", "outbound links")} ${
                  total === 1 ? "answers" : "answer"
                }`
              : `we sampled ${checked} of ${total} outbound links; all of them answer`,
        }
      : {
          ok: false,
          evidence: `${broken.length} of the ${checked} we sampled are dead — ${broken[0]!.url}`,
        };
  });

  add("og-image-served", http.ogImage, () => {
    const o = http.ogImage;
    if (o === null) return null;
    return fromVerdict(
      o!.verdict,
      "the share image loads",
      `the share image does not load — ${o!.url}`,
    );
  });

  add("og-image-size", http.ogImage, () => {
    const o = http.ogImage;
    if (o === null) return null;
    // A format we cannot measure — SVG above all — is not a small image.
    if (o!.width === null || o!.height === null) return null;
    const small = o!.width < MIN_OG_IMAGE_EDGE || o!.height < MIN_OG_IMAGE_EDGE;
    return { ok: !small, evidence: `${o!.width}×${o!.height}` };
  });

  add("logo-served", http.logo, () => {
    const l = http.logo;
    if (l === null) return null;
    return fromVerdict(l!.verdict, `${l!.how} loads`, `${l!.how} does not load — ${l!.url}`);
  });

  add("redirect-chains", http.redirectChains, () => {
    const r = http.redirectChains!;
    return r.chained.length === 0
      ? { ok: true, evidence: `${r.checked} internal links, none redirecting twice` }
      : {
          ok: false,
          evidence: `${r.chained.length} of ${r.checked} take ${r.chained[0]!.hops} hops — ${r.chained[0]!.url}`,
        };
  });

  return out;
}

/**
 * The two verdicts that came from pressing the button.
 *
 * Both are about the same failure a business actually suffers: an enquiry that
 * never arrives. A form that submits empty puts a blank message in the inbox
 * and tells the visitor it worked; a form that accepts "not-an-email" takes a
 * real enquiry and leaves no way to answer it. Neither is visible in the
 * markup — the form looks perfect either way.
 *
 * `undefined` on either field means the click told us nothing (a cross-origin
 * form, a control we could not reach, a browser pass that never ran) and reads
 * as unmeasured. A form we could not press is our gap, never their defect.
 */
function formInteractionChecks(probes: (FormProbe | null | undefined)[]): SiteCheck[] {
  const WHY_EMPTY =
    "Somebody who taps send too early should be told what is missing. A form that submits anyway puts a blank enquiry in your inbox and tells them it worked, so they never follow up and you have nothing to follow up on.";
  const WHY_EMAIL =
    "A mistyped address is the one mistake that costs you the whole enquiry: the message arrives, and there is no way to answer it. Catching it while the visitor is still on the page is the only chance to fix it.";

  const probe = probes.find((p) => p) ?? null;

  if (!probe) {
    // No page we read has a form we could identify as an enquiry. That is a
    // fact about the site, not a gap in the measurement — but the goal battery
    // owns "is there a way to get in touch", so this says nothing about it.
    return [
      skip(
        "form-rejects-empty",
        "A form that catches an empty submission",
        WHY_EMPTY,
        "quick",
        "we found no enquiry form to try",
      ),
      skip(
        "form-rejects-bad-email",
        "A form that catches a mistyped email",
        WHY_EMAIL,
        "quick",
        "we found no enquiry form to try",
      ),
    ];
  }

  const out: SiteCheck[] = [
    probe.emptyRefused === undefined
      ? unknown("form-rejects-empty", "A form that catches an empty submission", WHY_EMPTY, "quick")
      : check(
          "form-rejects-empty",
          "A form that catches an empty submission",
          WHY_EMPTY,
          "quick",
          probe.emptyRefused,
          probe.emptyHow ?? "",
        ),
  ];

  out.push(
    probe.invalidEmailRefused === null
      ? skip(
          "form-rejects-bad-email",
          "A form that catches a mistyped email",
          WHY_EMAIL,
          "quick",
          "this form does not ask for an email address",
        )
      : probe.invalidEmailRefused === undefined
        ? unknown(
            "form-rejects-bad-email",
            "A form that catches a mistyped email",
            WHY_EMAIL,
            "quick",
          )
        : check(
            "form-rejects-bad-email",
            "A form that catches a mistyped email",
            WHY_EMAIL,
            "quick",
            probe.invalidEmailRefused,
            probe.invalidEmailHow ?? "",
          ),
  );

  return out;
}

export const TIER4_CHECK_KEYS = ["form-rejects-empty", "form-rejects-bad-email"] as const;

export const TIER2_HTTP_CHECK_KEYS = [
  "favicon-served",
  "https-upgrade",
  "home-stable",
  "trailing-slash",
  "index-alias",
  "case-alias",
  "sitemap-urls-live",
  "external-links-live",
  "og-image-served",
  "og-image-size",
  "logo-served",
  "redirect-chains",
] as const;

export const TIER2_DNS_CHECK_KEYS = [
  "dns-spf",
  "dns-dmarc",
  "dns-mx",
  "dns-contact-mx",
  "domain-expiry",
] as const;

export const TIER3_CHECK_KEYS = [
  "console-errors",
  "failed-requests",
  "mobile-overflow",
  "tiny-text",
  "oversized-images",
] as const;

export const TIER1_CHECK_KEYS = [
  "meta-noindex",
  "meta-nofollow",
  "meta-charset",
  "title-length",
  "description-length",
  "og-image-absolute",
  "duplicate-descriptions",
  "favicon-declared",
  "canonical-self",
  "canonical-origin",
  "hreflang-self",
  "form-field-types",
  "form-autocomplete",
  "form-method",
  "form-action",
  "form-required",
  "noopener",
] as const;

export const TIER0_CHECK_KEYS = [
  "dead-links",
  "staging-links",
  "insecure-links",
  "link-text",
  "tel-dialable",
  "social-placeholders",
  "nav-consistency",
  "lorem",
  "placeholder-copy",
  "template-leakage",
  "mojibake",
  "under-construction",
  "name-in-title",
  "single-h1",
  "h1-not-name",
  "h1-distinct",
  "schema-org-complete",
  "schema-local-complete",
  "schema-url-matches",
  "schema-phone-matches",
  "schema-self-review",
  ...SECURITY_HEADER_CHECKS.map((h) => `header-${h.header}`),
  "header-version-leak",
  "header-compression",
  "header-hsts-age",
  "robots-not-blocking",
  "robots-names-sitemap",
  "sitemap-coverage",
  "llms-txt",
  "analytics",
] as const;

/**
 * Every check in this file, for one site.
 *
 * `checks` is accepted but optional: a run whose checks stage failed can still
 * answer most of this from the crawl alone, exactly as `basics` does, and the
 * few checks that need it degrade to `unmeasured` rather than taking the rest
 * down with them.
 */
export function runSiteChecks(
  crawl: CrawlResult,
  checks: ChecksResult | null,
  businessName: string | null = null,
  dns: DnsFindings | null = null,
  http: HttpFindings | null = null,
): SiteCheck[] {
  const set = usablePages(crawl.pages);
  const pages = set.pages.map((p) => ({
    url: p.page.url,
    extract: p.extract,
    // Carried through so the browser checks can read what the render pass
    // observed without a second traversal of the capture list.
    vitals: p.page.vitals,
  }));

  // Distinct same-origin pages the site's own links point at. This is the
  // honest denominator for sitemap coverage: our crawl is capped, so using the
  // number of pages we READ would report our own ceiling as their gap.
  const linked = new Set<string>();
  for (const { url, extract } of pages) {
    for (const a of extract.anchors ?? []) {
      const abs = resolveNavigable(a.href, url);
      if (!abs) continue;
      try {
        if (new URL(abs).origin === crawl.origin) linked.add(abs.split("#")[0]!);
      } catch {
        // Not a URL we can reason about; it is not evidence either way.
      }
    }
  }

  // Phone numbers as the page writes them, for the schema comparison. Read off
  // the consistency inventory rather than re-scraped, so there is one
  // implementation of "what numbers does this site publish" and it is the one
  // with tests.
  const phones = (checks?.consistency?.phones ?? []).map((p) => p.normalized);

  const headersMeasured = Object.keys(crawl.homeHeaders ?? {}).length > 0;

  return [
    ...anchorChecks(pages, crawl.origin),
    ...textChecks(pages, businessName),
    ...headingChecks(pages, businessName),
    ...schemaChecks(pages, crawl.origin, phones),
    ...metaChecks(pages),
    ...linkChecks(pages, crawl.origin),
    ...formChecks(pages),
    ...newTabChecks(pages),
    ...browserChecks(pages),
    ...dnsChecks(dns),
    ...httpChecks(http),
    ...formInteractionChecks(crawl.pages.map((p) => p.formProbe)),
    ...headerChecks(crawl.homeHeaders ?? {}, headersMeasured),
    ...sidecarChecks(crawl, linked),
    analyticsCheck(pages),
  ];
}
