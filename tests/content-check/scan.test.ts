// P1-120 phase 2: the per-file rules. Each case is a literal a visitor sees
// (reported) or a fallback / non-content string (not reported), one rule each.
import { describe, expect, it } from "vitest";
import { scanSource, type Finding } from "../../src/content-check/scan.js";

const svelte = (src: string, file = "src/routes/+page.svelte"): Array<[string, string]> =>
  scanSource(file, src).map((f: Finding) => [f.kind, f.text]);
const ts = (src: string, file = "src/lib/copy.ts"): Array<[string, string]> =>
  scanSource(file, src).map((f: Finding) => [f.kind, f.text]);

describe("template text", () => {
  it("reports words by the element they sit in", () => {
    expect(
      svelte(
        `<h2>Our process</h2><p>We build homes.</p><button>Send it</button><blockquote>Great work.</blockquote>`,
      ),
    ).toEqual([
      ["heading", "Our process"],
      ["copy", "We build homes."],
      ["button", "Send it"],
      ["testimonial", "Great work."],
    ]);
  });

  it("reports the page title and meta description as seo", () => {
    expect(
      svelte(
        `<svelte:head><title>About us</title><meta name="description" content="Who we are." /><meta name="robots" content="noindex" /></svelte:head>`,
      ),
    ).toEqual([
      ["seo", "About us"],
      ["seo", "Who we are."],
    ]);
  });

  it("narrows copy to phone, email, address and hours by what it says", () => {
    expect(
      svelte(
        `<p>(208) 724-4034</p><p>info@example.com</p><p>12 N. Echohawk Lane, Suite 102</p><p>Open 9am to 5pm</p>`,
      ),
    ).toEqual([
      ["phone", "(208) 724-4034"],
      ["email", "info@example.com"],
      ["address", "12 N. Echohawk Lane, Suite 102"],
      ["hours", "Open 9am to 5pm"],
    ]);
  });

  it("skips decorative labels: fewer than two letters, or a roman numeral", () => {
    expect(svelte(`<div>01</div><div>V</div><span>•</span><div>3/5</div><div>XII</div>`)).toEqual(
      [],
    );
  });

  it("reports a string literal in an expression tag, but not a code word", () => {
    expect(svelte(`<p>{"Hello there"}</p><p>{"script"}</p>`)).toEqual([["copy", "Hello there"]]);
  });

  it("reports the line the literal starts on", () => {
    const [f] = scanSource(
      "src/routes/+page.svelte",
      `<div>\n\n  <p>\n    Hello there\n  </p></div>`,
    );
    expect(f?.line).toBe(4);
  });
});

describe("attributes", () => {
  it("reports alt, title, placeholder and aria-label on elements", () => {
    expect(
      svelte(
        `<img alt="A kitchen" /><input placeholder="Your name" /><a title="Read more" aria-label="Open menu">x</a>`,
      ),
    ).toEqual([
      ["alt", "A kitchen"],
      ["copy", "Your name"],
      ["copy", "Read more"],
      ["copy", "Open menu"],
    ]);
  });

  it("classifies links: internal, external, tel, mailto, social", () => {
    expect(
      svelte(
        `<a href="/contact">x</a><a href="https://example.org">x</a><a href="tel:+12087244034">x</a><a href="mailto:a@b.co">x</a><a href="https://instagram.com/x">x</a><a href="#top">x</a>`,
      ),
    ).toEqual([
      ["link", "/contact"],
      ["link", "https://example.org"],
      ["phone", "tel:+12087244034"],
      ["email", "mailto:a@b.co"],
      ["social", "https://instagram.com/x"],
    ]);
  });

  it("reports image and video sources, and a video embed", () => {
    expect(
      svelte(
        `<img src="/img/a.webp" /><video src="/v/a.mp4" poster="/v/a.jpg"></video><iframe src="https://player.vimeo.com/video/123456"></iframe>`,
      ),
    ).toEqual([
      ["image", "/img/a.webp"],
      ["video", "/v/a.mp4"],
      ["video", "/v/a.jpg"],
      ["video", "https://player.vimeo.com/video/123456"],
    ]);
  });

  it("reports component props by their name, and ignores names that are not content", () => {
    expect(
      svelte(
        `<Hero heading="Built to last" vimeoId={1092190178} ctaText="Call us" variant="dark" class="mt-4 flex" />`,
      ),
    ).toEqual([
      ["heading", "Built to last"],
      ["video", "1092190178"],
      ["button", "Call us"],
    ]);
  });

  it("reports words with a hole in them, but not a link built from data", () => {
    expect(svelte(`<img alt="Photo of {name}" /><a href="/projects/{slug}">x</a>`)).toEqual([
      ["alt", "Photo of ${…}"],
    ]);
  });

  it("ignores class, style, ids and other attributes no visitor reads", () => {
    expect(
      svelte(
        `<div class="Hero Big" id="Main Hero" style="color: red" data-name="Big Thing"></div>`,
      ),
    ).toEqual([]);
  });
});

describe("script values", () => {
  it("reports a literal under a content name", () => {
    expect(
      ts(
        `export const items = [{ label: "About us", href: "/about" }, { title: "Our work", bio: "Twenty years." }];`,
      ),
    ).toEqual([
      ["copy", "About us"],
      ["link", "/about"],
      ["heading", "Our work"],
      ["team", "Twenty years."],
    ]);
  });

  it("reads the last word of a longer name: DEFAULT_TITLE, heroHeading", () => {
    expect(
      ts(`export const DEFAULT_TITLE = "Home"; export const heroHeading = "Hello there";`),
    ).toEqual([
      ["heading", "Home"],
      ["heading", "Hello there"],
    ]);
  });

  it("reports a value by its shape under any name", () => {
    expect(
      ts(
        `export const a = { x: "tel:+12087244034", y: "hi@example.com", z: "https://www.facebook.com/acme", w: "/images/a.png" };`,
      ),
    ).toEqual([
      ["phone", "tel:+12087244034"],
      ["email", "hi@example.com"],
      ["social", "https://www.facebook.com/acme"],
      ["image", "/images/a.png"],
    ]);
  });

  it("does not report code words, types, comparisons, keys or call arguments", () => {
    expect(
      ts(
        `type T = { label: "About us" };
         export const a = { label: "contact-form", name: "email" };
         export function f(x: string) { if (x === "Hello there") throw new Error("Something went wrong"); return x; }
         export const m = { "About us": 1 };`,
      ),
    ).toEqual([]);
  });

  it("follows a value through a Svelte rune", () => {
    expect(
      svelte(
        `<script>const headline = $derived(status === 404 ? "Page not found" : "Something broke");</script><h1>{headline}</h1>`,
      ),
    ).toEqual([
      ["heading", "Page not found"],
      ["heading", "Something broke"],
    ]);
  });
});

describe("asset imports", () => {
  it("reports an image or video import at the import, when it is shown", () => {
    expect(
      svelte(
        `<script>import hero from "$lib/assets/hero.jpg?as=run"; import clip from "$lib/v/a.mp4";</script><img src={hero} alt="" /><video src={clip}></video>`,
      ),
    ).toEqual([
      ["image", "hero.jpg"],
      ["video", "a.mp4"],
    ]);
  });
});

describe("fallbacks are never reported (decision 2026-11-21-1841, fork 1)", () => {
  const cases: Array<[string, string]> = [
    ["field || literal", `<h1>{doc.title || "Welcome home"}</h1>`],
    ["field ?? literal", `<h1>{doc.title ?? "Welcome home"}</h1>`],
    ["ternary on the same field", `<h1>{doc.title ? doc.title : "Welcome home"}</h1>`],
    [
      "ternary on isFilled of the field",
      `<h1>{isFilled.keyText(doc.title) ? doc.title : "Welcome home"}</h1>`,
    ],
    ["a fallback-named helper", `<V vimeoId={vimeoIdOr(doc.vimeo, "1092190178")} />`],
    ["a prop default", `<script>let { heading = "Welcome home" } = $props();</script>`],
    ["a Svelte 4 prop default", `<script>export let heading = "Welcome home";</script>`],
    [
      "media beside a field prop",
      `<script>import img from "$lib/a.jpg";</script><Media field={doc.image} src={img} alt="A home" />`,
    ],
    [
      "an else branch for the same field",
      `{#if doc.intro}<PrismicRichText field={doc.intro} />{:else}<p>We build homes.</p>{/if}`,
    ],
    [
      "a constant read only as a fallback",
      `<script>const DEFAULT_DESCRIPTION = "Custom homes since 1998."; const d = doc.meta || DEFAULT_DESCRIPTION;</script>`,
    ],
    [
      "an argument to a parameter named fallback",
      `<script>function text(value, fallback) { return value || fallback; }</script><h1>{text(doc.title, "Welcome home")}</h1>`,
    ],
    [
      "a ternary on a value derived from the other branch",
      `<script>const quoted = named(d?.name); const pair = isFilled.image(d?.logo) && quoted;</script><p>{pair ? quoted : "Revogen"}</p>`,
    ],
  ];
  for (const [name, src] of cases) {
    it(name, () => {
      expect(svelte(src)).toEqual([]);
    });
  }

  it("a choice between two literals is not a fallback", () => {
    expect(svelte(`<p>{open ? "Close menu" : "Open menu"}</p>`)).toEqual([
      ["copy", "Close menu"],
      ["copy", "Open menu"],
    ]);
  });

  it("a ternary on another value is not a fallback for this one", () => {
    expect(
      svelte(`<h1>{page.status === 404 ? "Page not found" : (page.error?.message ?? "Oops")}</h1>`),
    ).toEqual([["heading", "Page not found"]]);
  });

  it("a component's own words beside a field prop are not fallbacks", () => {
    expect(
      svelte(`<PrismicLink field={doc.link} aria-label="Instagram photo">Learn more</PrismicLink>`),
    ).toEqual([
      ["copy", "Instagram photo"],
      ["copy", "Learn more"],
    ]);
  });

  it("a constant read plainly anywhere is reported", () => {
    expect(
      svelte(
        `<script>const DEFAULT_TITLE = "Fixture Co."; const t = doc.meta || DEFAULT_TITLE;</script><h1>{DEFAULT_TITLE}</h1>`,
      ),
    ).toEqual([["heading", "Fixture Co."]]);
  });

  it("an extra helper named in the site's settings", () => {
    expect(
      scanSource("src/routes/+page.svelte", `<h1>{buildTitle(doc.t, "Welcome home")}</h1>`, {
        fallbackHelpers: ["buildTitle"],
      }),
    ).toEqual([]);
  });
});

describe("dev-only code (SvelteKit's `dev`) is not a visitor's", () => {
  it("is not reported, and its reads do not count", () => {
    expect(
      ts(
        `import { dev } from "$app/environment";
         const COPY = { heading: "Homes built to last" };
         export const load = () => (dev && cookie ? fixture(COPY) : { heading: doc.heading || COPY.heading, label: dev ? "Dev only label" : null });`,
        "src/routes/+page.ts",
      ),
    ).toEqual([]);
  });

  it("needs the real `dev`: a local variable of that name is not it", () => {
    expect(
      ts(`const dev = true; export const a = dev ? { label: "Shown to visitors" } : null;`),
    ).toEqual([["copy", "Shown to visitors"]]);
  });
});

describe("ignore list", () => {
  it("drops exact literals and /regex/ matches", () => {
    expect(
      scanSource(
        "src/routes/+page.svelte",
        `<p>Reddoor</p><p>© 2026 Fixture Co.</p><p>Keep me</p>`,
        {
          ignore: ["Reddoor", "/^©/"],
        },
      ).map((f) => f.text),
    ).toEqual(["Keep me"]);
  });
});

describe("TypeScript files", () => {
  it("parses a file holding a </script> string, at the file's own line numbers", () => {
    const src = `export const jsonLd = (d: object) => \`<script type="application/ld+json">\${JSON.stringify(d)}</script>\`;\nexport const SITE = { phone: "(208) 724-4034" };`;
    expect(scanSource("src/lib/seo.ts", src)).toEqual([
      { file: "src/lib/seo.ts", line: 2, kind: "phone", text: "(208) 724-4034" },
    ]);
  });
});

describe("code is not content", () => {
  it("a script or stylesheet URL under a media name is not reported", () => {
    expect(
      ts(
        `export const load = () => { const s = { src: "https://player.vimeo.com/api/player.js", href: "/app.css" }; return s; };`,
      ),
    ).toEqual([]);
  });
});
