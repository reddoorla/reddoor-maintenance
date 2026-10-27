import { describe, expect, it } from "vitest";
import { readStack } from "../../src/prospect/stack.js";
import type { CrawlResult, PageCapture, PageExtract } from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "A page",
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    scriptSrcs: [],
    scriptCount: 0,
    ...over,
  };
}

function site(over: Partial<PageExtract>, headers: Record<string, string> = {}): CrawlResult {
  const home: PageCapture = {
    url: "https://acme.example/",
    status: 200,
    raw: null,
    rendered: extract(over),
    error: null,
  };
  return {
    origin: "https://acme.example",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: false, urlCount: 0 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: headers,
    pages: [home],
  };
}

const named = (r: ReturnType<typeof readStack>, layer: string): string[] =>
  r.items.filter((i) => i.layer === layer).map((i) => i.name);

describe("readStack — naming a WordPress site back to itself", () => {
  const readout = readStack(
    site(
      {
        scriptSrcs: [
          "https://acme.example/wp-content/themes/astra/js/frontend.js?ver=4.1",
          "https://acme.example/wp-content/plugins/elementor/assets/js/frontend.min.js",
          "https://acme.example/wp-content/plugins/gravityforms/js/form.js",
          "https://acme.example/wp-content/plugins/wp-rocket/assets/js/lazyload.js",
          "https://www.googletagmanager.com/gtag/js?id=G-ABC123",
        ],
        imageSrcs: ["https://acme.example/wp-content/uploads/2024/hero.jpg"],
        metas: { generator: "WordPress 6.4.2" },
      },
      { "cf-ray": "8a1b2c3d4e5f6789-LAX", server: "nginx" },
    ),
  );

  it("names the platform", () => {
    expect(named(readout, "cms")).toEqual(["WordPress"]);
  });

  it("names the theme by its own slug", () => {
    expect(named(readout, "theme")).toEqual(["astra"]);
  });

  it("names the plugins individually — the line nobody else can write", () => {
    expect(named(readout, "plugin")).toEqual(
      expect.arrayContaining(["elementor", "gravityforms", "wp-rocket"]),
    );
  });

  it("lifts the page builder and the form plugin out of the plugin list", () => {
    expect(named(readout, "page-builder")).toEqual(["Elementor"]);
    expect(named(readout, "forms")).toEqual(["Gravity Forms"]);
  });

  it("names the analytics and the host", () => {
    expect(named(readout, "analytics")).toEqual(["Google Analytics 4"]);
    expect(named(readout, "hosting")).toEqual(expect.arrayContaining(["Cloudflare", "Nginx"]));
  });

  it("carries a receipt on every single line", () => {
    // A line without a receipt is an assertion, and this module does not make
    // assertions. There is no code path that produces one, and this is the test
    // that keeps it that way.
    expect(readout.items.length).toBeGreaterThan(5);
    for (const item of readout.items) {
      expect(item.evidence, `${item.layer}/${item.name} has no receipt`).toBeTruthy();
    }
  });

  it("prints the generator string it read, version and all", () => {
    const wp = readout.items.find((i) => i.name === "WordPress");
    // The reader sees what we saw, not the name we mapped it to.
    expect(wp?.evidence).toContain("WordPress 6.4.2");
  });
});

describe("readStack — our blindness is never reported as their absence", () => {
  it("is unmeasured when no page carried a scriptSrcs array", () => {
    // Every report stored before the field existed looks like this. Read as an
    // empty array it becomes a site that loads nothing and runs nothing we
    // recognise — a confident wrong answer.
    const stored = site({});
    const { scriptSrcs: _s, scriptCount: _c, ...withoutTheField } = extract({});
    stored.pages[0]!.rendered = withoutTheField;
    const readout = readStack(stored);
    expect(readout.measured).toBe(false);
    expect(readout.items).toEqual([]);
    expect(readout.pagesExamined).toBe(0);
  });

  it("distinguishes 'we read it and recognised nothing' from 'we could not read it'", () => {
    // A hand-built static site is a real and unremarkable answer, and it must
    // not look identical to a failed run.
    const readout = readStack(site({ scriptSrcs: ["/js/main.js"], scriptCount: 1 }));
    expect(readout.measured).toBe(true);
    expect(readout.items).toEqual([]);
    expect(readout.pagesExamined).toBe(1);
  });

  it("says whether headers were available, since hosting rides entirely on them", () => {
    expect(readStack(site({}, {})).headersExamined).toBe(false);
    expect(readStack(site({}, { "cf-ray": "x" })).headersExamined).toBe(true);
  });
});

describe("readStack — a wrong name on page one costs more than a right one earns", () => {
  it("does not credit a platform to a lookalike hostname", () => {
    // The failure BOOKING_HOSTS already learned: a substring test credited
    // cal.com to medical.com. These are the same shape.
    const readout = readStack(
      site({
        scriptSrcs: [
          "https://notsquarespace.com/x.js",
          "https://mywixstatic.com.evil.example/y.js",
          "https://example.com/blog/why-we-left-shopify.com/post.js",
        ],
        scriptCount: 3,
      }),
    );
    expect(named(readout, "cms")).toEqual([]);
  });

  it("does not read a blog post about wp-content as a WordPress install", () => {
    const readout = readStack(
      site({
        scriptSrcs: ["https://acme.example/articles/wp-content-explained.js"],
        scriptCount: 1,
      }),
    );
    expect(named(readout, "cms")).toEqual([]);
  });

  it("names each thing once, however many pages reference it", () => {
    const many = site({
      scriptSrcs: [
        "/wp-content/plugins/gravityforms/a.js",
        "/wp-content/plugins/gravityforms/b.js",
        "/wp-content/plugins/gravityforms/c.js",
      ],
      scriptCount: 3,
    });
    expect(named(readStack(many), "forms")).toEqual(["Gravity Forms"]);
    expect(named(readStack(many), "plugin")).toEqual(["gravityforms"]);
  });
});

describe("readStack — the other platforms", () => {
  const cases: [string, string, string][] = [
    ["Squarespace", "https://static1.squarespace.com/static/x/y.js", "cms"],
    ["Wix", "https://static.wixstatic.com/shapes/a.js", "cms"],
    ["Webflow", "https://cdn.prod.website-files.com/abc/site.js", "cms"],
    ["Next.js", "https://acme.example/_next/static/chunks/main.js", "framework"],
    ["SvelteKit", "https://acme.example/_app/immutable/entry/start.js", "framework"],
    ["Nuxt", "https://acme.example/_nuxt/entry.abc.js", "framework"],
    ["Shopify", "https://cdn.shopify.com/s/files/1/theme.js", "ecommerce"],
    ["Adobe Fonts (Typekit)", "https://use.typekit.net/abc1def.js", "fonts"],
    ["Hotjar", "https://static.hotjar.com/c/hotjar-123.js", "analytics"],
  ];

  it.each(cases)("names %s", (name, src, layer) => {
    const readout = readStack(site({ scriptSrcs: [src], scriptCount: 1 }));
    expect(named(readout, layer)).toContain(name);
  });

  it("reads Webflow's older asset host too", () => {
    const readout = readStack(
      site({ scriptSrcs: ["https://assets.website-files.com/abc/site.js"], scriptCount: 1 }),
    );
    expect(named(readout, "cms")).toContain("Webflow");
  });
});
