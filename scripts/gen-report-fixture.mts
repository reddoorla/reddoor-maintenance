/**
 * Regenerates the `siteChecks` block of the report renderer's all-pass fixture.
 *
 * WHY THIS IS A SCRIPT AND NOT A HAND-WRITTEN FILE. The fixture behind
 * `/dev/audit-report` in reddoor-website exists to prove the renderer can draw
 * a report where nothing is wrong. Written by hand it drifts out of reach of
 * the checks it claims to satisfy and then passes forever while proving
 * nothing. Generated from the real `runSiteChecks`, it has caught four
 * instrument bugs so far — every one of them overstating the client's fault.
 *
 * The crawl below is an exemplary small-business site: ordinary, careful, and
 * doing nothing clever. Every check in the battery has to go green on it. When
 * one does not, the check is usually wrong, not the fixture — that is what
 * happened each of the four times.
 *
 *   pnpm tsx scripts/gen-report-fixture.mts
 *
 * Prints the JSON to stdout; paste it into `src/lib/report/fixtures/all-pass.ts`
 * over the `siteChecks.data` array. The DNS and HTTP findings are supplied
 * directly rather than probed, so this makes no network requests at all.
 */
import { runSiteChecks } from "../src/prospect/site-checks.js";
import type { DnsFindings } from "../src/prospect/dns.js";
import type { HttpFindings } from "../src/prospect/http-probes.js";
import type { FormProbe } from "../src/prospect/interaction.js";
import type { ChecksResult, CrawlResult, PageCapture, PageExtract } from "../src/prospect/types.js";

const ORIGIN = "https://acme.example";

const HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), geolocation=()",
  "content-encoding": "br",
  server: "nginx",
};

const SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "Acme Roofing",
  url: `${ORIGIN}/`,
  logo: `${ORIGIN}/logo.png`,
  telephone: "(208) 555-0142",
  address: { "@type": "PostalAddress", addressLocality: "Boise", addressRegion: "ID" },
  openingHours: "Mo-Fr 08:00-17:00",
});

const CLEAN_VITALS = {
  consoleErrors: [],
  failedRequests: [],
  overflowAt375: 0,
  tinyText: { count: 0, sample: null },
  oversizedImages: [],
};

function extract(url: string, over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "Acme Roofing — Commercial Roof Repair in Boise",
    metaDescription:
      "Commercial roof repair and replacement across the Treasure Valley, from a Boise crew.",
    canonical: url,
    social: { "og:image": `${ORIGIN}/share.png`, "og:title": "Acme Roofing" },
    headings: [{ level: 1, text: "Commercial roof repair in Boise" }],
    jsonLd: [SCHEMA],
    images: { total: 3, withAlt: 3 },
    hasViewportMeta: true,
    text: "We repair commercial roofs across the Treasure Valley. Call us on (208) 555-0142. Our crew has worked on flat roofs, standing seam and TPO across Boise, Meridian and Nampa since 2004, and we quote in writing before anyone climbs a ladder.",
    anchors: [
      { href: "/services", text: "Services", rel: "", target: "" },
      { href: "/contact", text: "Contact", rel: "", target: "" },
      { href: "tel:+12085550142", text: "Call us", rel: "", target: "" },
      { href: "https://www.facebook.com/acmeroofingboise", text: "Facebook", rel: "", target: "" },
    ],
    anchorCount: 4,
    imageSrcs: ["/logo.png", "/hero.jpg"],
    scriptSrcs: ["https://www.googletagmanager.com/gtag/js?id=G-ABC"],
    scriptCount: 1,
    metas: { charset: "utf-8" },
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "canonical", href: url },
    ],
    forms: [
      {
        kind: "enquiry",
        action: "/enquiry",
        method: "post",
        fieldCount: 4,
        hasContactField: true,
        hasSubmit: true,
        fields: [
          { type: "text", name: "name", autocomplete: "name", required: true },
          { type: "email", name: "email", autocomplete: "email", required: true },
          { type: "tel", name: "phone", autocomplete: "tel", required: false },
          { type: "textarea", name: "message", autocomplete: null, required: true },
        ],
      },
    ],
    ...over,
  } as PageExtract;
}

/** What the browser found when it pressed this site's enquiry form: a form
 *  with required fields and a typed email, which the browser itself refuses to
 *  submit empty or with junk in the address. The ordinary careful case. */
const FORM_PROBE: FormProbe = {
  url: `${ORIGIN}/contact`,
  emptyRefused: true,
  emptyHow: "the browser blocks it — the form marks its fields required",
  invalidEmailRefused: true,
  invalidEmailHow: "the browser catches it — the field is typed as an email",
  blocked: 0,
};

const page = (
  url: string,
  over: Partial<PageExtract> = {},
  formProbe: FormProbe | null = null,
): PageCapture =>
  ({
    url,
    status: 200,
    raw: null,
    rendered: extract(url, over),
    error: null,
    vitals: CLEAN_VITALS,
    formProbe,
  }) as PageCapture;

const PAGES = [
  page(`${ORIGIN}/`),
  page(`${ORIGIN}/services`, {
    title: "Roof repair services — Acme Roofing",
    metaDescription: "What we repair, how long it takes, and what a commercial roof job costs.",
    canonical: `${ORIGIN}/services`,
    headings: [{ level: 1, text: "What we repair" }],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "canonical", href: `${ORIGIN}/services` },
    ],
  }),
  page(
    `${ORIGIN}/contact`,
    {
      title: "Contact Acme Roofing — Boise, Idaho",
      metaDescription: "Call, email or send us the details of the roof and we will come and look.",
      canonical: `${ORIGIN}/contact`,
      headings: [{ level: 1, text: "Get in touch" }],
      links: [
        { rel: "icon", href: "/favicon.ico" },
        { rel: "canonical", href: `${ORIGIN}/contact` },
      ],
    },
    FORM_PROBE,
  ),
];

const SITEMAP = [`${ORIGIN}/`, `${ORIGIN}/services`, `${ORIGIN}/contact`];

const crawl: CrawlResult = {
  origin: ORIGIN,
  robotsTxt: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml`,
  agentAccess: [],
  sitemap: { present: true, urlCount: SITEMAP.length, sample: SITEMAP },
  llmsTxt: { present: true, firstLine: "# Acme Roofing" },
  sidecarErrors: { robots: null, llms: null, sitemap: null },
  homeHeaders: HEADERS,
  pages: PAGES,
} as CrawlResult;

const checks = {
  consistency: {
    phones: [
      {
        normalized: "2085550142",
        seenAs: ["(208) 555-0142"],
        pages: PAGES.map((p) => p.url),
        linked: true,
      },
    ],
    emails: [],
    copyrightYears: [],
    newestCopyrightYear: null,
    pagesOffTemplate: [],
    sharedNavLinks: 2,
    pagesExamined: PAGES.length,
  },
} as unknown as ChecksResult;

const dns: DnsFindings = {
  measured: true,
  domain: "acme.example",
  spf: "v=spf1 include:_spf.google.com ~all",
  dmarc: "v=DMARC1; p=reject; rua=mailto:dmarc@acme.example",
  mx: ["aspmx.l.google.com"],
  contactMx: null,
  // A FIXED date, not `now + 400 days`. A relative one makes every
  // regeneration produce a diff in a line nothing changed about, which buries
  // the lines that did change — and reading that diff is the whole point of
  // generating the fixture instead of writing it.
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const http: HttpFindings = {
  measured: true,
  requests: 34,
  favicon: { url: `${ORIGIN}/favicon.ico`, declared: true, verdict: "ok" },
  httpUpgrade: { hops: 1, https: true },
  homeSamples: [200, 200],
  trailingSlash: {
    path: "/services",
    settled: true,
    detail: "one form redirects to the other",
  },
  indexAlias: null,
  caseAlias: null,
  sitemapUrls: { checked: SITEMAP.length, total: SITEMAP.length, broken: [] },
  externalLinks: { checked: 1, total: 1, broken: [] },
  ogImage: { url: `${ORIGIN}/share.png`, verdict: "ok", width: 1200, height: 630 },
  logo: {
    url: `${ORIGIN}/logo.png`,
    how: "the first image with 'logo' in its file name",
    verdict: "ok",
  },
  redirectChains: { checked: 3, chained: [] },
};

const result = runSiteChecks(crawl, checks, "Acme Roofing", dns, http);

const bad = result.filter((c) => c.status === "fail");
if (bad.length > 0) {
  // Loud, and on stderr so a paste of stdout is never silently wrong. A check
  // failing on THIS site is the signal to look at the check.
  console.error(`\n${bad.length} check(s) fail on the exemplary site:\n`);
  for (const c of bad) console.error(`  ${c.key} — ${c.evidence ?? "no evidence"}`);
  console.error("");
  process.exitCode = 1;
}

const counts = result.reduce<Record<string, number>>((acc, c) => {
  acc[c.status] = (acc[c.status] ?? 0) + 1;
  return acc;
}, {});
console.error(`${result.length} checks: ${JSON.stringify(counts)}`);

console.log(JSON.stringify(result, null, 2));
