import { resolveNavigable } from "./journey.js";
import { usablePages } from "./pages.js";
import type { Scope } from "./goals.js";
import type { ChecksResult, CrawlResult, PageAnchor, PageExtract } from "./types.js";

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

  const staging = all.filter(({ a, page }) => {
    const abs = resolveNavigable(a.href, page);
    if (!abs) return false;
    try {
      return LOCAL_HOST.test(new URL(abs).hostname);
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
        : `${staging.length}: ${staging
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
          : `${insecure.length}: ${insecure
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

function sidecarChecks(crawl: CrawlResult, discoveredLinks: number): SiteCheck[] {
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
    out.push(
      check(
        "sitemap-coverage",
        "A sitemap that lists your pages",
        WHY_COVERAGE,
        "content",
        ok,
        `${crawl.sitemap.urlCount} URLs listed, against ${discoveredLinks} distinct pages your own links point to`,
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
  const hit = readable
    .flatMap((p) => p.extract.scriptSrcs ?? [])
    .find((s) => ANALYTICS_MARKERS.test(s));
  return check(
    "analytics",
    LABEL,
    WHY,
    "quick",
    hit !== undefined,
    hit ?? "no analytics script on the pages we read",
  );
}

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
): SiteCheck[] {
  const set = usablePages(crawl.pages);
  const pages = set.pages.map((p) => ({ url: p.page.url, extract: p.extract }));

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
    ...headerChecks(crawl.homeHeaders ?? {}, headersMeasured),
    ...sidecarChecks(crawl, linked.size),
    analyticsCheck(pages),
  ];
}
