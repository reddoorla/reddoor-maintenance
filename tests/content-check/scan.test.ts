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
    [
      "media beside a field prop",
      `<script>import img from "$lib/a.jpg";</script><Media field={doc.image} src={img} fallbackAlt="A home" />`,
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

// Review round 1 on #2231: each case is a reproduced miss or false report.
describe("a fallback needs the SAME field, not a shared helper (round 1, critical)", () => {
  it("two runes do not share a field through `$state`", () => {
    expect(
      svelte(
        `<script>let submitted = $state(false); let email = $state("");</script>{#if !submitted}<input bind:value={email} />{:else}<h2>Thank you for joining our list!</h2>{/if}<p>{submitted ? email : "We never share your address."}</p>`,
      ),
    ).toEqual([
      ["heading", "Thank you for joining our list!"],
      ["copy", "We never share your address."],
    ]);
  });

  it("two calls to one function do not share a field through its name", () => {
    expect(
      svelte(
        `<script>const app = getAppState(); const menu = getAppState();</script><p>{app.open ? menu.label : "Browse the menu"}</p>`,
      ),
    ).toEqual([["copy", "Browse the menu"]]);
  });

  it("a function's body is not what its name reads", () => {
    expect(
      svelte(
        `<script>let sent = $state(false); const handleSubmit = async () => { sent = true; };</script>{#if !sent}<form onsubmit={handleSubmit}></form>{:else}<p>Thanks, we will call you back.</p>{/if}`,
      ),
    ).toEqual([["copy", "Thanks, we will call you back."]]);
  });

  it("a member of an alias is not the alias's whole source", () => {
    expect(
      svelte(
        `<script>const page = $derived(data.page.data);</script>{#if page.layout === "wide"}{page.title}{:else}<h2>Our story began in 1901</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our story began in 1901"]]);
  });

  it("a branch's alias is not followed back to the test (a layout switch)", () => {
    expect(
      svelte(
        `<script>const isMobile = $derived(w < 768); const brands = $derived(isMobile ? few : all);</script>{#if !isMobile}<h4>Join these brands</h4>{:else}{#each brands as b}{b.name}{/each}{/if}`,
      ),
    ).toEqual([["heading", "Join these brands"]]);
  });

  it("a test on a member of an alias is not about the alias's whole source", () => {
    expect(
      svelte(
        `<script>const page = $derived(data.page.data);</script>{#if page.layout === "wide"}<h1>{data.page.data.title}</h1>{:else}<h2>Our story began in 1901</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our story began in 1901"]]);
  });

  it("an alias read itself still reaches its source", () => {
    expect(
      svelte(
        `<script>const title = $derived(data.page.title);</script>{#if title}<h1>{data.page.title}</h1>{:else}<h1>Welcome home</h1>{/if}`,
      ),
    ).toEqual([]);
  });
});

describe("fallbacks written other ways (round 1)", () => {
  it("a negated #if whose else shows the field", () => {
    expect(svelte(`{#if !doc.title}<h1>Welcome</h1>{:else}<h1>{doc.title}</h1>{/if}`)).toEqual([]);
  });

  it("a negated #if whose else shows something else is reported", () => {
    expect(svelte(`{#if !doc.title}<h1>Welcome</h1>{:else}<h1>{doc.name}</h1>{/if}`)).toEqual([
      ["heading", "Welcome"],
    ]);
  });

  it("`if (!x) x = literal` and `x ||= literal`", () => {
    expect(
      svelte(
        `<script>let heading = doc.title; if (!heading) heading = "Welcome"; let sub = doc.sub; if (!sub) { sub = "Since 1901"; } let cta = doc.cta; cta ||= "Book a tour";</script><h1>{heading}</h1><p>{sub}{cta}</p>`,
      ),
    ).toEqual([]);
  });

  it("an assignment under some other test is reported", () => {
    expect(
      svelte(
        `<script>let heading = doc.title; if (!other) heading = "Welcome back";</script><h1>{heading}</h1>`,
      ),
    ).toEqual([["heading", "Welcome back"]]);
  });

  it('`cond && "A" || "B"` is a choice of two literals, not a fallback', () => {
    expect(svelte(`<p>{open && "Close menu" || "Open menu"}</p>`)).toEqual([
      ["copy", "Close menu"],
      ["copy", "Open menu"],
    ]);
  });

  it("alt beside a field prop is the component's own words", () => {
    expect(svelte(`<Img field={doc.image} alt="A sunlit tasting room" />`)).toEqual([
      ["alt", "A sunlit tasting room"],
    ]);
  });

  it("fallbackAlt beside a field prop is a fallback", () => {
    expect(svelte(`<Img field={doc.image} fallbackAlt="A sunlit tasting room" />`)).toEqual([]);
  });
});

describe("constants that are not prop defaults (round 1)", () => {
  it("an `export const` in a .svelte module is reported", () => {
    expect(
      svelte(
        `<script module>export const HERO_TITLE = "Welcome to Acme Winery";</script><h1>{HERO_TITLE}</h1>`,
      ),
    ).toEqual([["heading", "Welcome to Acme Winery"]]);
  });

  it("an `export const` in the instance script is reported", () => {
    expect(svelte(`<script>export const HERO_TITLE = "Welcome to Acme Winery";</script>`)).toEqual([
      ["heading", "Welcome to Acme Winery"],
    ]);
  });
});

describe("roman numerals are only the small ones a list numbers with (round 1)", () => {
  it("keeps real words and abbreviations", () => {
    expect(
      svelte(
        `<p>ID</p><p>VIVID</p><p>MIX</p><p>CIVIC</p><p>MD</p><p>DC</p><p>IL</p><p>MI</p><p>LLC</p>`,
      ).map(([, t]) => t),
    ).toEqual(["ID", "VIVID", "MIX", "CIVIC", "MD", "DC", "IL", "MI", "LLC"]);
  });

  it("still skips II to XXXIX", () => {
    expect(svelte(`<p>II</p><p>IV</p><p>IX.</p><p>XIV</p><p>XXXIX</p>`)).toEqual([]);
  });
});

describe("literals with no slot of their own (round 1)", () => {
  it("an #each over literal words", () => {
    expect(
      svelte(`<ul>{#each ["Weddings", "Private events"] as s}<li>{s}</li>{/each}</ul>`),
    ).toEqual([
      ["copy", "Weddings"],
      ["copy", "Private events"],
    ]);
  });

  it("a call or method on words shown in the template", () => {
    expect(
      svelte(`<h1>{upper("Welcome to the vineyard")}</h1><p>{"Open daily".toUpperCase()}</p>`),
    ).toEqual([
      ["heading", "Welcome to the vineyard"],
      ["copy", "Open daily"],
    ]);
  });

  it("a local constant shown in the template", () => {
    expect(
      svelte(`<script>const greeting = "Welcome to the vineyard";</script><h1>{greeting}</h1>`),
    ).toEqual([["heading", "Welcome to the vineyard"]]);
  });

  it("a local constant used only as a fallback is not", () => {
    expect(
      svelte(
        `<script>const greeting = "Welcome to the vineyard";</script><h1>{doc.title || greeting}</h1>`,
      ),
    ).toEqual([]);
  });

  it("a code word in a constant shown in the template is not", () => {
    expect(svelte(`<script>const variant = "hero-dark";</script><p>{variant}</p>`)).toEqual([]);
  });

  it("FAQ, stat and price keys", () => {
    expect(
      ts(
        `export const items = [{ question: "Do you host weddings?", answer: "Yes, year round." }]; export const s = { stat: "Since 1901", price: "From $40 a person" };`,
      ),
    ).toEqual([
      ["copy", "Do you host weddings?"],
      ["copy", "Yes, year round."],
      ["copy", "Since 1901"],
      ["copy", "From $40 a person"],
    ]);
  });
});

describe("a string a method matches against is not content (found after round 1)", () => {
  it("startsWith, includes, get and querySelector arguments", () => {
    expect(
      svelte(
        `<script>const phone = $derived.by(() => { for (const item of items) if (item.href?.startsWith("tel:")) return item; }); const topic = $derived(page.url.searchParams.get("Topic Name")); const el = document.querySelector("Main Menu");</script><a href={phone.href}>{phone.text}</a><p>{topic}</p>`,
      ),
    ).toEqual([]);
  });

  it("replace's replacement is still words", () => {
    expect(
      svelte(
        `<p>{name.replace("_", " ") || "Unnamed listing"}</p><p>{"Call us today".replace("us", "Acme")}</p>`,
      ),
    ).toEqual([["copy", "Call us today"]]);
  });
});

describe("a constant read only for styling is not content (found after round 1)", () => {
  it("is not reported under a content name", () => {
    expect(
      svelte(
        `<script>const lines = $derived(on ? STEPS.map(() => "translate-y-0 opacity-100") : []);</script><p class="t-h4 {active ? lines[0] : out}">{doc.text}</p>`,
      ),
    ).toEqual([]);
  });

  it("is reported once anything else reads it", () => {
    expect(
      svelte(
        `<script>const lines = ["Rooted in the valley", "Built to last"];</script><p class={lines[0]}>{lines[1]}</p>`,
      ),
    ).toEqual([
      ["copy", "Rooted in the valley"],
      ["copy", "Built to last"],
    ]);
  });
});

describe("video URLs need a video in them (found after round 1)", () => {
  it("a bare player origin is not a video", () => {
    expect(ts(`export const ORIGIN = { video: "https://player.vimeo.com" };`)).toEqual([]);
  });

  it("a player, watch, embed or short link with an ID is", () => {
    expect(
      ts(
        `export const v = { a: "https://player.vimeo.com/video/1092190178", b: "https://vimeo.com/1092190178", c: "https://www.youtube.com/embed/dQw4w9WgXcQ", d: "https://youtu.be/dQw4w9WgXcQ", e: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };`,
      ).map(([k]) => k),
    ).toEqual(["video", "video", "video", "video", "video"]);
  });
});

describe("ignore list, round 1", () => {
  it("a /g or /y regex matches every literal, not every other one", () => {
    expect(
      scanSource(
        "src/routes/+page.svelte",
        `<p>Acme one</p><p>Acme two</p><p>Acme three</p><p>Acme four</p>`,
        { ignore: ["/Acme/g"] },
      ),
    ).toEqual([]);
  });
});

// Review round 2 on #2231.
describe("a branch is a fallback only behind an emptiness test it renders (round 2, blocker)", () => {
  it("a menu toggle's other branch is not a fallback", () => {
    expect(
      svelte(
        `{#if menuOpen}<button aria-expanded={menuOpen} onclick={() => (menuOpen = false)}>x</button>{:else}<nav><a href="/about">About Us</a></nav>{/if}`,
      ),
    ).toEqual([
      ["link", "/about"],
      ["copy", "About Us"],
    ]);
  });

  it("a form whose done state styles itself is not a fallback", () => {
    expect(
      svelte(
        `{#if !submitted}<form><h2>Get a free quote</h2><button>Send it</button></form>{:else}<p class:done={submitted}>Thanks, we got it</p>{/if}`,
      ),
    ).toEqual([
      ["heading", "Get a free quote"],
      ["button", "Send it"],
      ["copy", "Thanks, we got it"],
    ]);
  });

  it("a comparison with a literal is a switch, not an emptiness test", () => {
    expect(
      svelte(
        `{#if theme === "dark"}<div class="bg-{theme}">{theme}</div>{:else}<h2>Our Services</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our Services"]]);
    expect(
      svelte(`<p>{status.code === 404 ? "Page not found, sorry" : status.message}</p>`),
    ).toEqual([["copy", "Page not found, sorry"]]);
  });

  it("a layout switch whose branch reads the switch only in a class is not a fallback", () => {
    expect(
      svelte(
        `<script>const isMobile = $derived(w > 0 && w < 768);</script>{#if !isMobile}<h4>Join these brands</h4>{:else}<div class="w-{isMobile ? 1 : 2}">x</div>{/if}`,
      ),
    ).toEqual([["heading", "Join these brands"]]);
  });

  it("a local holding a comparison is a switch, not the field it compares", () => {
    expect(
      svelte(
        `<script>const isWide = $derived(doc.layout === "wide");</script>{#if isWide}<h1>{doc.layout}</h1>{:else}<h2>Our story began in 1901</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our story began in 1901"]]);
  });

  it("emptiness tests that do make a fallback", () => {
    const cases = [
      `{#if doc.links.length > 0}{#each doc.links as l}{l.text}{/each}{:else}<p>Links coming soon</p>{/if}`,
      `{#if doc.title != null}{doc.title}{:else}<h1>Welcome home</h1>{/if}`,
      `{#if doc.items.length === 0}<p>No listings right now</p>{:else}{#each doc.items as i}{i.name}{/each}{/if}`,
      `{#if doc.title == null}<h1>Welcome home</h1>{:else}{doc.title}{/if}`,
      `<p>{!doc.tagline ? "Built to last" : doc.tagline}</p>`,
      `<script>const has = $derived(isFilled.keyText(doc.title));</script>{#if has}<h1>{doc.title}</h1>{:else}<h1>Welcome home</h1>{/if}`,
      `<script>const quoted = named(d?.name); const pair = isFilled.image(d?.logo) && quoted ? d.logo : null;</script><p>{pair ? quoted : "Revogen"}</p><img src={pair ? src(pair) : "/logo.png"} alt="" />`,
    ];
    for (const src of cases) expect(svelte(src), src).toEqual([]);
  });
});

describe("style values are not copy, but their images are images (round 2)", () => {
  it("a style: directive value is not reported as copy", () => {
    expect(
      svelte(`<div style:height="600px" style:font-family={"Open Sans, serif"}></div>`),
    ).toEqual([]);
  });

  it("a background image in a style attribute or directive is an image", () => {
    expect(
      svelte(
        `<div style="background-image: url('/images/hero.jpg')"></div><div style:background-image="url(/images/two.webp)"></div>`,
      ),
    ).toEqual([
      ["image", "/images/hero.jpg"],
      ["image", "/images/two.webp"],
    ]);
  });

  it("an image constant read only in a style is still an image", () => {
    expect(
      svelte(
        `<script>const heroImage = "/images/hero.jpg";</script><div style="background-image: url({heroImage})"></div>`,
      ),
    ).toEqual([["image", "/images/hero.jpg"]]);
  });
});

describe("prop defaults (round 2, critical)", () => {
  it("are reported on their own: a default is what shows when no caller passes the prop", () => {
    expect(
      svelte(
        `<script>let { label = "Request Appointment", phone = "(310) 555-1234" } = $props();</script><p>{label} {phone}</p>`,
        "src/lib/components/CtaBand.svelte",
      ),
    ).toEqual([
      ["copy", "Request Appointment"],
      ["phone", "(310) 555-1234"],
    ]);
  });

  it("a destructuring default outside $props() is still a fallback", () => {
    expect(
      svelte(`<script>const { title = "Welcome home" } = data.page;</script><h1>{title}</h1>`),
    ).toEqual([]);
  });
});

describe("built-in fallback helpers (round 2)", () => {
  it("a call named …Or, withFallback or orDefault", () => {
    expect(
      svelte(
        `<p>{textOr(doc.a, "Built to last")}</p><p>{withFallback(doc.b, "Since 1901")}</p><p>{orDefault(doc.c, "Call us today")}</p>`,
      ),
    ).toEqual([]);
  });
});

describe("an else is a fallback only when it is a leaf substitute (round 3, blocker)", () => {
  it("a whole alternate template behind an emptiness test is reported (the starter Nav)", () => {
    expect(
      svelte(
        `<script>let { navLinks = [] } = $props(); const useNavLinks = $derived(navLinks.length > 0);</script>
{#if useNavLinks}{#each navLinks as l}<a href={l.href}>{l.text}</a>{/each}{:else}<nav><a href="/">Home</a><a href="/services">Services</a><a href="tel:+12105550100">(210) 555-0100</a><button>Request Appointment</button></nav>{/if}`,
      ),
    ).toEqual([
      ["link", "/"],
      ["copy", "Home"],
      ["link", "/services"],
      ["copy", "Services"],
      ["phone", "tel:+12105550100"],
      ["phone", "(210) 555-0100"],
      ["button", "Request Appointment"],
    ]);
  });

  it("a link, a button or a component in the else makes it an alternate", () => {
    expect(
      svelte(
        `{#if href}<a {href}>{label}</a>{:else}<button><img src="/arrow.svg" alt="link arrow" /></button>{/if}`,
      ),
    ).toEqual([
      ["image", "/arrow.svg"],
      ["alt", "link arrow"],
    ]);
    expect(
      svelte(`{#if doc.title}<h1>{doc.title}</h1>{:else}<Hero heading="Welcome home" />{/if}`),
    ).toEqual([["heading", "Welcome home"]]);
    expect(
      svelte(
        `{#if !doc.title}<p>Call <a href="/contact">our office</a></p>{:else}<h1>{doc.title}</h1>{/if}`,
      ),
    ).toEqual([
      ["copy", "Call"],
      ["link", "/contact"],
      ["copy", "our office"],
    ]);
  });

  it("two elements in the else make it an alternate", () => {
    expect(
      svelte(
        `{#if doc.title}<h1>{doc.title}</h1>{:else}<h1>Welcome home</h1><p>Since 1998</p>{/if}`,
      ),
    ).toEqual([
      ["heading", "Welcome home"],
      ["copy", "Since 1998"],
    ]);
  });

  it("one text, one heading, one image or one picture is still a fallback", () => {
    const cases = [
      `{#if doc.title}{doc.title}{:else}Welcome home{/if}`,
      `{#if doc.title}<h1>{doc.title}</h1>{:else}<h1>Welcome <em>home</em></h1>{/if}`,
      `{#if doc.image.url}<img src={doc.image.url} alt="" />{:else}<div class="ph"><img src="/hero.jpg" alt="Our team" /></div>{/if}`,
      `{#if doc.image.url}<img src={doc.image.url} alt="" />{:else}<picture><source srcset="/hero.webp" /><img src="/hero.jpg" alt="Our team" /></picture>{/if}`,
      `{#if !doc.title}<h1>Welcome home</h1>{:else}<h1>{doc.title}</h1>{/if}`,
    ];
    for (const src of cases) expect(svelte(src), src).toEqual([]);
  });
});

describe("&& is an emptiness test only when every conjunct is one (round 3, critical)", () => {
  it("a comparison beside a field makes the else a choice", () => {
    expect(
      svelte(
        `{#if slice.variation === "default" && slice.primary.vimeo_id}<iframe src={slice.primary.vimeo_id} title=""></iframe>{:else}<h2>Our latest project</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our latest project"]]);
  });

  it("a toggle the branch does not show makes the else a choice", () => {
    expect(
      svelte(
        `<script>let playing = $state(false);</script>{#if video && playing}<iframe src={video} title=""></iframe>{:else}<p>Watch the film</p>{/if}`,
      ),
    ).toEqual([["copy", "Watch the film"]]);
  });

  it("the same holds for a ternary", () => {
    expect(
      svelte(
        `<script>const t = theme === "dark" && doc.title ? doc.title : "Welcome to Vineyard Homes";</script><h1>{t}</h1>`,
      ),
    ).toEqual([["heading", "Welcome to Vineyard Homes"]]);
    expect(
      svelte(
        `<script>let open = $state(false);</script><h1>{doc.title && open ? doc.title : "Welcome home"}</h1>`,
      ),
    ).toEqual([["heading", "Welcome home"]]);
  });

  it("two fields the branch shows still make a fallback", () => {
    expect(
      svelte(
        `{#if doc.title && doc.subtitle}<h1>{doc.title}</h1><p>{doc.subtitle}</p>{:else}<h1>Welcome home</h1>{/if}`,
      ),
    ).toEqual([]);
  });

  it("an {:else if} arm is judged by its own test", () => {
    expect(
      svelte(
        `{#if slice.primary.image.url}<img src={slice.primary.image.url} alt="" />{:else if slice.variation === "video"}<iframe src="https://player.vimeo.com/video/123456789" title=""></iframe>{:else}<p>Call us today for a free estimate</p>{/if}`,
      ),
    ).toEqual([
      ["video", "https://player.vimeo.com/video/123456789"],
      ["copy", "Call us today for a free estimate"],
    ]);
    expect(
      svelte(
        `{#if doc.image.url}<img src={doc.image.url} alt="" />{:else if doc.title}<h1>{doc.title}</h1>{:else}<h1>Welcome home</h1>{/if}`,
      ),
    ).toEqual([]);
  });
});

describe("words reached another way (round 3, majors)", () => {
  it("a {@render} argument is shown", () => {
    expect(
      svelte(`{#snippet card(t)}<h3>{t}</h3>{/snippet}{@render card("Rendered arg words")}`),
    ).toEqual([["copy", "Rendered arg words"]]);
  });

  it("a returned literal sits under its function's name", () => {
    expect(
      ts(
        `class Report { get title() { return "Getter title text"; } }\nfunction heading() { return "Plain function heading"; }\nconst subtitle = () => "Arrow subtitle words";\nexport { Report, heading, subtitle };`,
      ),
    ).toEqual([
      ["heading", "Getter title text"],
      ["heading", "Plain function heading"],
      ["heading", "Arrow subtitle words"],
    ]);
  });

  it("a private field is named like a public one", () => {
    expect(ts(`export class Standing { #title = "Private words here"; }`)).toEqual([
      ["heading", "Private words here"],
    ]);
  });

  it("a returned call or an unnamed callback is still behaviour", () => {
    expect(
      ts(
        `export function title(d) { return d.toLocaleDateString("en-US", { month: "long" }); }\nexport const list = (xs) => xs.map((x) => "translate-y-0 opacity-100");`,
      ),
    ).toEqual([]);
  });
});

describe("round 3's fleet diff", () => {
  it("a {@render} argument the snippet only styles with is not words", () => {
    expect(
      svelte(
        `{#snippet heading(cls)}<h1 class={cls}>{doc.title}</h1>{/snippet}{@render heading("mt-16 max-w-[450px] px-8")}`,
      ),
    ).toEqual([]);
    expect(
      svelte(
        `{#snippet card(cls, t)}<h3 class={cls}>{t}</h3>{/snippet}{@render card("mt-16 px-8", "Shown words here")}`,
      ),
    ).toEqual([["copy", "Shown words here"]]);
  });

  it("an image import read only in a class is compared against, not shown", () => {
    expect(
      svelte(
        `<script>import placeholder from "$lib/assets/ph.svg";</script><img {src} alt="" class="w-full {src === placeholder ? 'lg:w-1/2' : ''}" />`,
      ),
    ).toEqual([]);
    expect(
      svelte(
        `<script>import hero from "$lib/assets/hero.jpg";</script><div class="{hero ? 'a' : 'b'}" style="background-image: url({hero})"></div>`,
      ),
    ).toEqual([["image", "hero.jpg"]]);
  });
});

describe("a renamed prop default sits under the prop's name (round 3 hand-off)", () => {
  it("names it by the key, not the local", () => {
    expect(
      svelte(
        `<script>let { heading: h = "Welcome home" } = $props();</script><h1>{h}</h1>`,
        "src/lib/Hero.svelte",
      ),
    ).toEqual([["heading", "Welcome home"]]);
  });
});

describe("round 3's mutation sweep", () => {
  it("a local whose initialiser ANDs a comparison is not an emptiness test", () => {
    expect(
      svelte(
        `<script>const show = $derived(slice.variation === "default" && slice.primary.vimeo_id);</script>{#if show}<iframe src={slice.primary.vimeo_id} title=""></iframe>{:else}<h2>Our latest project</h2>{/if}`,
      ),
    ).toEqual([["heading", "Our latest project"]]);
  });

  it("an attribute no visitor reads does not show the field", () => {
    expect(
      svelte(`{#if doc.title}<h1 id={doc.title}>Hi there</h1>{:else}<h1>Welcome home</h1>{/if}`),
    ).toEqual([
      ["heading", "Hi there"],
      ["heading", "Welcome home"],
    ]);
  });
});
