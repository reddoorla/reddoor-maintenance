// P1-83d class (c): the PM pass's cockpit section (`pm-pass.md`, "The pass", step 2) from a
// frozen `pm-cockpit.mts` output. Every site is synthetic. Traps: a NEW site in Watch goes to the
// top of stack, an undated attention reason ending "ready" does not, and a dated one does not.
export const id = "session-cockpit";
export const title = "PM pass cockpit section from a frozen pm-cockpit output";

export const COCKPIT = `PM_COCKPIT_SUMMARY broken=1 attention=4 watch=4 approval=0 setup=2 sites=14 new=2 since=2026-10-26T11:52:10Z
now=2026-10-27T11:49:02.000Z just_wait_left_out=3

## Needs you (5)
- Alder Studio · broken · /s/alder-studio
  - deploy: production deploy failed (flagged 2026-10-26)
- NEW Birch Dental · attention · /s/birch-dental
  - lighthouse: performance 41 on / (flagged 2026-10-27)
- Cedar Bakery · attention · /s/cedar-bakery
  - search-console: no-property (undated)
- Dogwood Law · attention · /s/dogwood-law
  - renovate: fix PR ready (undated)
- Elm Fitness · attention · /s/elm-fitness
  - form-e2e: contact form failing (flagged 2026-10-24)

## Watch (4)
- NEW Fir Realty · /s/fir-realty · vuln: GHSA-7x2q-9m4p-ffr3 auto-fix wait failed (failed 2026-10-27)
- Ginkgo Cafe · /s/ginkgo-cafe · renovate: PR red 3 days (flagged 2026-10-24)
- Hazel Yoga · /s/hazel-yoga · uptime: 2 slow checks (flagged 2026-10-26)
- Ivy Kennels · /s/ivy-kennels · vuln: GHSA-3c9r-h2wv-8kq1 auto-fix exhausted (undated)

## Setup (2)
- Juniper Tours · /s/juniper-tours · no GA4; Search Console no-property
- Kauri Arts · /s/kauri-arts · no custom domain
`;

export function prompt() {
  return [
    'Write the cockpit part of today\'s morning report from the frozen `pm-cockpit.mts` output below, following `pm-pass.md` in this repository ("The pass", step 2): which sites go into the top of stack, each as an exact ask, and which go on the one-line attention, Watch and Setup lists. Do not run the script; this is what it printed.',
    "",
    "```",
    COCKPIT.trimEnd(),
    "```",
    "",
    "The json block's shape, each site by its slug (the part after /s/):",
    '{"topOfStack": [{"slug": s, "ask": the exact ask}], "attention": [slugs], "watch": [slugs], "setup": [{"slug": s, "gaps": [gap texts]}]}',
  ].join("\n");
}

function parse(text) {
  const sites = [];
  let section = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^## (Needs you|Watch|Setup)/);
    if (h) {
      section = h[1];
      continue;
    }
    const m = line.match(/^- (NEW )?(.+?) · /);
    if (m) {
      const slug = line.match(/\/s\/([\w-]+)/)[1];
      const group = section === "Needs you" ? line.split(" · ")[1] : section.toLowerCase();
      const rest = section === "Needs you" ? [] : [line.split(" · ").slice(2).join(" · ")];
      sites.push({ slug, section, group, isNew: !!m[1], reasons: rest });
      continue;
    }
    const r = line.match(/^ {2}- (.+)$/);
    if (r && sites.length) sites.at(-1).reasons.push(r[1]);
  }
  return sites;
}

// A gap compared without case or punctuation: "No GA4" and "no GA4." are one gap.
const gapKey = (g) =>
  String(g)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function truth() {
  const sites = parse(COCKPIT);
  const undatedNotReady = (s) =>
    s.reasons.some((r) => /\(undated\)$/.test(r) && !/ready \(undated\)$/.test(r));
  const top = (s) =>
    s.isNew ||
    s.group === "broken" ||
    (s.section === "Needs you" && s.group === "attention" && undatedNotReady(s));
  const sorted = (xs) => xs.map((s) => s.slug).sort();
  return {
    topOfStack: sorted(sites.filter(top)),
    attention: sorted(sites.filter((s) => s.group === "attention" && !top(s))),
    watch: sorted(sites.filter((s) => s.section === "Watch" && !top(s))),
    setup: Object.fromEntries(
      sites
        .filter((s) => s.section === "Setup")
        .map((s) => [s.slug, s.reasons[0].split("; ").map(gapKey).sort()]),
    ),
  };
}

export const checkCount = 6;

const slugsOf = (xs) =>
  [...new Set((xs ?? []).map((x) => String(typeof x === "string" ? x : x?.slug)))].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function check(out, t) {
  const got = out ?? {};
  const top = slugsOf(got.topOfStack);
  const asks = (got.topOfStack ?? []).filter((x) => x && typeof x === "object");
  const setup = Object.fromEntries(
    (got.setup ?? []).map((x) => [String(x?.slug), (x?.gaps ?? []).map(gapKey).sort()]),
  );
  return [
    { check: "topOfStack", ok: same(top, t.topOfStack), got: top, want: t.topOfStack },
    {
      // An exact ask names the site's page, as the pass's rule writes it: on `/s/<slug>`, ….
      check: "topOfStack asks name /s/<slug>",
      ok:
        asks.length === t.topOfStack.length &&
        asks.every((x) => String(x.ask ?? "").includes(`/s/${x.slug}`)),
      got: asks.map((x) => x.ask),
      want: "each ask names /s/<slug>",
    },
    {
      check: "attention",
      ok: same(slugsOf(got.attention), t.attention),
      got: slugsOf(got.attention),
      want: t.attention,
    },
    {
      check: "watch",
      ok: same(slugsOf(got.watch), t.watch),
      got: slugsOf(got.watch),
      want: t.watch,
    },
    {
      check: "setup sites",
      ok: same(Object.keys(setup).sort(), Object.keys(t.setup).sort()),
      got: Object.keys(setup).sort(),
      want: Object.keys(t.setup).sort(),
    },
    {
      check: "setup gaps",
      ok: same(
        Object.entries(setup).sort(([a], [b]) => (a < b ? -1 : 1)),
        Object.entries(t.setup).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
      got: setup,
      want: t.setup,
    },
  ];
}

export const arms = [
  { id: "sonnet-1", model: "sonnet" },
  { id: "sonnet-2", model: "sonnet" },
  { id: "opus-1", model: "opus" },
  { id: "opus-2", model: "opus" },
];
