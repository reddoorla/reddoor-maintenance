import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractPage } from "../../src/prospect/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

describe("extractPage — a fully marked-up page", () => {
  const page = extractPage(fixture("rich.html"));

  it("reads the title, description and canonical", () => {
    expect(page.title).toBe("Acme Roofing — Commercial Roof Repair in Boise, Idaho");
    expect(page.metaDescription).toContain("Treasure Valley");
    expect(page.canonical).toBe("https://acme.example/");
  });

  it("collects only og:/twitter: metas as social", () => {
    expect(page.social["og:title"]).toBe("Acme Roofing");
    expect(page.social["og:image"]).toBe("https://acme.example/og.jpg");
    expect(page.social["twitter:card"]).toBe("summary_large_image");
    expect(page.social["description"]).toBeUndefined();
    expect(page.social["viewport"]).toBeUndefined();
  });

  it("reads headings in document order, flattening inline markup", () => {
    expect(page.headings).toEqual([
      { level: 1, text: "Commercial roof repair in Boise" },
      { level: 2, text: "What it costs" },
    ]);
  });

  it("captures JSON-LD blocks verbatim", () => {
    expect(page.jsonLd).toHaveLength(1);
    expect(JSON.parse(page.jsonLd[0]!)["@type"]).toBe("LocalBusiness");
  });

  it("counts images with a non-empty alt", () => {
    expect(page.images).toEqual({ total: 2, withAlt: 1 });
  });

  it("detects the viewport meta", () => {
    expect(page.hasViewportMeta).toBe(true);
  });

  it("returns word-separated visible text without script or head content", () => {
    expect(page.text).toContain("roof repair in Boise We repair flat commercial roofs");
    expect(page.text).not.toContain("should not appear in text");
    expect(page.text).not.toContain("Acme Roofing — Commercial");
    expect(page.text).not.toContain("<!doctype");
  });
});

describe("extractPage — a client-rendered shell", () => {
  const page = extractPage(fixture("bare.html"));

  it("has a title but no body text, headings or schema", () => {
    expect(page.title).toBe("Acme");
    expect(page.text).toBe("");
    expect(page.headings).toEqual([]);
    expect(page.jsonLd).toEqual([]);
  });

  it("reports the missing description and canonical as null", () => {
    expect(page.metaDescription).toBeNull();
    expect(page.canonical).toBeNull();
  });
});

// Item 5: the only two fixtures before this were a hand-perfect showcase and
// an empty SPA shell — neither resembles a real small-business target, which
// is almost always page-builder output (WordPress/Elementor/Squarespace).
// This models that reality: two page-builder <h1>s, a heading level skip, two
// JSON-LD blocks (one valid, one hand-pasted and malformed), og:title with no
// og:image, a duplicate canonical, and one image with alt beside one without.
describe("extractPage — a realistic page-builder site (messy.html)", () => {
  const page = extractPage(fixture("messy.html"));

  it("reads the title, and reports the missing description honestly", () => {
    expect(page.title).toBe("Home - Riverside Plumbing Co");
    expect(page.metaDescription).toBeNull();
  });

  it("picks the FIRST of two conflicting canonical links, not a merge or a throw", () => {
    // Real page-builder sites frequently emit two: one from the theme, one
    // from an SEO plugin, disagreeing on the trailing path. extractPage has
    // no way to know which is "correct" — it takes the first in document
    // order, silently. Documented here so a future change to that tie-break
    // is a deliberate decision, not an accidental one.
    expect(page.canonical).toBe("https://riversideplumbing.example/home/");
  });

  it("captures both page-builder h1s, in document order, plus the heading skip past h2", () => {
    expect(page.headings).toEqual([
      { level: 1, text: "Riverside Plumbing Co" },
      { level: 1, text: "24/7 Emergency Plumbing in Riverside County" },
      { level: 3, text: "Our Services" },
    ]);
  });

  it("reports partial social meta: og:title present, og:image absent", () => {
    expect(page.social["og:title"]).toBe("Riverside Plumbing Co");
    expect(page.social["og:image"]).toBeUndefined();
  });

  it("captures both JSON-LD blocks verbatim — one valid, one that fails to parse", () => {
    expect(page.jsonLd).toHaveLength(2);
    expect(JSON.parse(page.jsonLd[0]!)["@type"]).toBe("Organization");
    expect(() => JSON.parse(page.jsonLd[1]!)).toThrow();
  });

  it("counts one image with alt beside one without", () => {
    expect(page.images).toEqual({ total: 2, withAlt: 1 });
  });
});

describe("extractPage — text rendered the way a browser does", () => {
  it("skips a <template> stamp's headings, images and schema entirely, while a real sibling heading still counts", () => {
    const page = extractPage(
      '<template><h1>Phantom</h1><img src="/x.jpg" alt="phantom"><script type="application/ld+json">{"a":1}</script></template><h1>Real</h1>',
    );
    expect(page.headings).toEqual([{ level: 1, text: "Real" }]);
    expect(page.images).toEqual({ total: 0, withAlt: 0 });
    expect(page.jsonLd).toEqual([]);
  });

  it("does not insert a space between adjacent inline runs", () => {
    const page = extractPage("<p>Welcome to <b>Acme</b>Corp today.</p>");
    expect(page.text).toContain("AcmeCorp");
  });

  it("does not insert a space before trailing punctuation split across inline elements", () => {
    const page = extractPage('<p>Call <a href="tel:+12085550199">208-555-0199</a>. Now.</p>');
    expect(page.text).toContain("208-555-0199.");
  });

  it("still separates adjacent block elements with no whitespace between them in the source", () => {
    const page = extractPage("<p>alpha</p><p>beta</p>");
    expect(page.text).toBe("alpha beta");
  });

  it("breaks a heading at a <br> instead of jamming the two lines together", () => {
    const page = extractPage("<h1>Big Bold<br>Headline</h1>");
    expect(page.headings).toEqual([{ level: 1, text: "Big Bold Headline" }]);
  });

  it("reads a <title> misplaced inside <body> into page.title but keeps it out of text", () => {
    const page = extractPage("<body><title>Sneaky</title><p>Hello</p></body>");
    expect(page.title).toBe("Sneaky");
    expect(page.text).not.toContain("Sneaky");
  });
});

describe("extractPage — pathological nesting", () => {
  // Word/Google-Docs paste soup and broken page-builder plugins produce spans
  // nested far past anything a hand-written page would ever reach; the plain
  // recursive walk throws `RangeError: Maximum call stack size exceeded`
  // around 5,000 levels, which would otherwise take down the whole audit.
  const depth = 5000;

  it("does not throw on markup nested far past ordinary depth", () => {
    const html =
      "<html><body>" +
      "<span>".repeat(depth) +
      "deep text" +
      "</span>".repeat(depth) +
      "</body></html>";
    expect(() => extractPage(html)).not.toThrow();
  });

  it("stays partial rather than throwing: shallow content survives, content past the depth cap is dropped", () => {
    const html =
      "<html><body><h1>Shallow heading</h1>" +
      "<div>".repeat(depth) +
      "<h2>Buried heading</h2>text buried deep" +
      "</div>".repeat(depth) +
      "</body></html>";
    const page = extractPage(html);
    expect(page.headings.some((h) => h.text === "Shallow heading")).toBe(true);
    expect(page.headings.some((h) => h.text === "Buried heading")).toBe(false);
  });
});

describe("extractPage — anchors, images and forms", () => {
  it("collects hrefs as authored, and counts them truthfully", () => {
    // Kept as authored on purpose: resolving here would erase the difference
    // between a relative link and one that hardcodes an absolute host, which is
    // itself a finding when a site ships a staging URL to production.
    const page = extractPage(`<html><body>
      <a href="/about">About</a>
      <a href="https://elsewhere.example/x">Away</a>
      <a href="tel:+15550100">Call</a>
      <a>no href</a>
      <a href="  ">blank href</a>
    </body></html>`);
    expect(page.anchors?.map((a) => a.href)).toEqual([
      "/about",
      "https://elsewhere.example/x",
      "tel:+15550100",
    ]);
    expect(page.anchorCount).toBe(3);
  });

  it("reads an anchor's visible label, not its markup", () => {
    const page = extractPage(
      `<html><body><a href="/x"><svg><title>icon</title></svg><span>Contact us</span></a></body></html>`,
    );
    expect(page.anchors?.[0]?.text).toBe("Contact us");
  });

  it("collects image sources and drops empty ones", () => {
    const page = extractPage(
      `<html><body><img src="/a.jpg" alt="a"><img src=""><img alt="no src"></body></html>`,
    );
    expect(page.imageSrcs).toEqual(["/a.jpg"]);
  });

  it("classifies a multi-field form that asks for a reply as an enquiry", () => {
    const page = extractPage(`<html><body><form method="POST" action="/send">
      <input name="name"><input type="email" name="email"><textarea name="message"></textarea>
      <input type="hidden" name="csrf"><input type="submit" value="Send">
    </form></body></html>`);
    const form = page.forms?.[0];
    expect(form?.kind).toBe("enquiry");
    // Hidden and submit are not questions asked of the visitor.
    expect(form?.fieldCount).toBe(3);
    expect(form?.method).toBe("post");
    expect(form?.action).toBe("/send");
    expect(form?.hasSubmit).toBe(true);
  });

  // The Icovy case: a lone email box in the footer of every page. Counting it
  // as a way to reach a human put that whole site at zero clicks from contact.
  it("classifies a lone email box as subscribe, not enquiry", () => {
    const page = extractPage(
      `<html><body><form action="/subscribe"><input type="email" name="email"><button>Join</button></form></body></html>`,
    );
    expect(page.forms?.[0]?.kind).toBe("subscribe");
    expect(page.forms?.[0]?.hasContactField).toBe(true);
  });

  it("classifies a search box as other, and defaults its method to get", () => {
    const page = extractPage(
      `<html><body><form><input type="text" name="q" placeholder="Search"><button>Go</button></form></body></html>`,
    );
    expect(page.forms?.[0]?.kind).toBe("other");
    expect(page.forms?.[0]?.method).toBe("get");
  });

  it("recognises a contact field from any attribute an author might use", () => {
    for (const control of [
      `<input type="tel" name="x">`,
      `<input name="user_phone">`,
      `<input id="contact-field">`,
      `<input name="contact_email">`,
      `<input name="yourPhone">`,
      `<input placeholder="Your email">`,
      `<input aria-label="Phone number">`,
    ]) {
      const page = extractPage(
        `<html><body><form><input name="name">${control}</form></body></html>`,
      );
      expect(page.forms?.[0]?.kind, control).toBe("enquiry");
    }
  });
});
