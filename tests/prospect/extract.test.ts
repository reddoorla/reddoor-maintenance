import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractPage, MAX_SCRIPTS } from "../../src/prospect/extract.js";

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

  it("reads a logo wrapped in the headline by its alt text", () => {
    // One of the commonest homepage patterns there is. Reading text nodes alone
    // yielded "", the empty heading was dropped, and the page arrived at the
    // checks as one with no headline at all — a site with an h1 reported as a
    // site without one, and invisible in the stored corpus because the extract
    // only ever kept the headings that survived.
    const page = extractPage('<h1><img src="/logo.svg" alt="Acme Roofing"></h1>');
    expect(page.headings).toEqual([{ level: 1, text: "Acme Roofing" }]);
  });

  it("prefers a heading's own aria-label, exactly as a screen reader does", () => {
    const page = extractPage('<h1 aria-label="Commercial roof repair"><span>ACME</span></h1>');
    expect(page.headings).toEqual([{ level: 1, text: "Commercial roof repair" }]);
  });

  it("still drops a heading that names nothing at all", () => {
    const page = extractPage('<h1><img src="/spacer.gif" alt=""></h1><h2>Real</h2>');
    expect(page.headings).toEqual([{ level: 2, text: "Real" }]);
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

  // Asserted on `hasContactField` rather than on `kind`: this test is about
  // reading the meaning out of whichever attribute an author happened to use,
  // and a two-field form is no longer an enquiry form on its own — see
  // "telling an enquiry form from a two-field newsletter box" below.
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
        `<html><body><form><input name="name">${control}<textarea name="message"></textarea></form></body></html>`,
      );
      expect(page.forms?.[0]?.hasContactField, control).toBe(true);
      expect(page.forms?.[0]?.kind, control).toBe("enquiry");
    }
  });
});

// A form that a visitor cannot use to start a conversation is not a conversion
// path, and journey.ts counts ONLY `enquiry`: "counting any of them would
// report a site nobody can actually reach as having a conversion path — the
// exact failure this check exists to catch". A patient-portal login sitting in
// a site header does exactly that on every page of the site.
describe("formShape — forms that are not a way to reach a person", () => {
  const kindOf = (html: string) =>
    extractPage(`<html><body>${html}</body></html>`).forms?.[0]?.kind;

  it("does not call a login form an enquiry form", () => {
    expect(
      kindOf(`<form action="/account/login" method="post">
        <input type="email" name="email"><input type="password" name="password">
        <button>Sign in</button>
      </form>`),
    ).toBe("other");
  });

  it("does not call an account signup an enquiry form, however many fields it asks for", () => {
    expect(
      kindOf(`<form action="/create" method="post">
        <input name="first_name"><input name="last_name"><input type="email" name="email">
        <input type="password" name="password"><input type="password" name="password_confirm">
        <button>Create account</button>
      </form>`),
    ).toBe("other");
  });

  it("does not call a WordPress comment form an enquiry form", () => {
    expect(
      kindOf(`<form action="https://blog.example/wp-comments-post.php" method="post">
        <input name="author"><input name="email" type="email"><input name="url">
        <textarea name="comment"></textarea><input type="submit" value="Post Comment">
      </form>`),
    ).toBe("other");
  });

  // A portal login that asks for a member number and a PIN has no password
  // input to disqualify it, so the path is the only thing left that knows.
  it("does not call a patient-portal sign-in an enquiry form", () => {
    expect(
      kindOf(`<form action="/patient-portal/signin" method="post">
        <input name="member_email" type="email"><input name="pin"><input name="dob">
        <input name="zip"><button>Enter portal</button>
      </form>`),
    ).toBe("other");
  });

  it("excludes a form by the path it posts to, whatever it asks for", () => {
    for (const action of [
      "/login",
      "/sign-in",
      "/signin",
      "/users/sign_up",
      "/register",
      "/checkout",
      "/cart",
      "/search",
      "https://shop.example/cart/add",
      "/wp-login.php",
      "/wp-comments-post.php",
    ]) {
      expect(
        kindOf(`<form action="${action}" method="post">
          <input name="name"><input type="email" name="email"><textarea name="message"></textarea>
          <button>Send</button>
        </form>`),
        action,
      ).toBe("other");
    }
  });

  // The exclusion is on whole path SEGMENTS, not substrings: a lead form living
  // at /signup-for-a-consultation is the real thing, and reading it as a login
  // would report a reachable practice as unreachable.
  it("does not exclude a real enquiry form whose path merely contains one of those words", () => {
    for (const action of [
      "/signup-for-a-consultation",
      "/contact/new-patient-registration-request",
      "/research-inquiry",
    ]) {
      expect(
        kindOf(`<form action="${action}" method="post">
          <input name="name"><input type="email" name="email"><textarea name="message"></textarea>
          <button>Send</button>
        </form>`),
        action,
      ).toBe("enquiry");
    }
  });

  it("keeps counting a password as a field the visitor fills in, so fieldCount stays true", () => {
    const form = extractPage(
      `<html><body><form action="/login"><input type="email" name="e"><input type="password" name="p"></form></body></html>`,
    ).forms?.[0];
    expect(form?.fieldCount).toBe(2);
    expect(form?.hasContactField).toBe(true);
    expect(form?.kind).toBe("other");
  });
});

describe("formShape — telling an enquiry form from a two-field newsletter box", () => {
  const kindOf = (html: string) =>
    extractPage(`<html><body>${html}</body></html>`).forms?.[0]?.kind;

  // "Name + email + Subscribe" is the second-commonest newsletter box on the
  // web, and the old `fieldCount >= 2` rule read every one of them as a way to
  // reach a human.
  it("does not call a name-and-email signup box an enquiry form", () => {
    expect(
      kindOf(`<form action="/newsletter" method="post">
        <input name="first_name" placeholder="First name">
        <input type="email" name="email" placeholder="Email">
        <button>Subscribe</button>
      </form>`),
    ).toBe("subscribe");
  });

  it("calls a form with a message box an enquiry form", () => {
    expect(
      kindOf(`<form action="/send" method="post">
        <input type="email" name="email"><textarea name="message"></textarea><button>Send</button>
      </form>`),
    ).toBe("enquiry");
  });

  it("calls a form with no message box an enquiry form once it asks three other questions", () => {
    expect(
      kindOf(`<form action="/quote" method="post">
        <input name="name"><input type="email" name="email"><input type="tel" name="phone">
        <select name="service"><option>Cleaning</option></select>
        <input name="preferred_date" type="date"><button>Request a quote</button>
      </form>`),
    ).toBe("enquiry");
  });

  // The lean quote form: contact details plus two other questions and no
  // message box. It is an enquiry form — reading it as a newsletter signup
  // would cost the site a conversion path it really has, and could make a page
  // with a working enquiry form report as having none.
  it("counts a quote form with no message box", () => {
    expect(
      kindOf(`<form action="/quote" method="post">
        <input name="name"><input type="email" name="email"><input type="tel" name="phone">
        <input name="subject"><button>Send</button>
      </form>`),
    ).toBe("enquiry");
  });

  // The boundary that must still hold: an email box with one extra question is
  // the second commonest newsletter signup on the web, not an enquiry form.
  it("still reads first-name-plus-email as a newsletter box", () => {
    expect(
      kindOf(`<form action="/subscribe" method="post">
        <input name="first_name"><input type="email" name="email"><button>Subscribe</button>
      </form>`),
    ).toBe("subscribe");
  });
});

describe("extractPage — metas and script sources", () => {
  it("keys every non-social meta by its name, and og:/twitter: stay in social", () => {
    const page = extractPage(fixture("rich.html"));
    expect(page.metas?.["description"]).toContain("Treasure Valley");
    expect(page.metas?.["viewport"]).toBe("width=device-width, initial-scale=1");
    // The two prefixes `social` owns must not be stored a second time — that
    // would double the biggest part of a persisted extract.
    expect(page.metas?.["og:title"]).toBeUndefined();
    expect(page.metas?.["twitter:card"]).toBeUndefined();
  });

  it("reads a bare charset attribute, which has no name/content pair at all", () => {
    // `<meta charset="utf-8">` is how essentially every page declares its
    // encoding, and it carries neither `name` nor `content`. Keyed off those
    // alone it was invisible, so the charset check could never have gone green.
    expect(extractPage(fixture("rich.html")).metas?.["charset"]).toBe("utf-8");
  });

  it("reads the older http-equiv spelling of the same declaration", () => {
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"></head><body>x</body></html>`;
    expect(extractPage(html).metas?.["charset"]).toBe("ISO-8859-1");
  });

  it("collects script srcs and ignores inline scripts", () => {
    const html = `<html><head>
      <script src="/wp-content/plugins/gravityforms/js/form.js"></script>
      <script>window.dataLayer = [];</script>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script>
    </head><body>x</body></html>`;
    const page = extractPage(html);
    // An inline blob has no address a reader can go and check, so it is not a
    // receipt and is not collected.
    expect(page.scriptSrcs).toEqual([
      "/wp-content/plugins/gravityforms/js/form.js",
      "https://www.googletagmanager.com/gtag/js?id=G-ABC",
    ]);
    expect(page.scriptCount).toBe(2);
  });

  it("caps the list but reports the true total", () => {
    const many = Array.from(
      { length: MAX_SCRIPTS + 25 },
      (_, i) => `<script src="/s/${i}.js"></script>`,
    ).join("");
    const page = extractPage(`<html><head>${many}</head><body>x</body></html>`);
    expect(page.scriptSrcs).toHaveLength(MAX_SCRIPTS);
    // A capped list must never be mistaken for a complete one.
    expect(page.scriptCount).toBe(MAX_SCRIPTS + 25);
  });

  it("still finds ld+json on a script that also has a src", () => {
    const html = `<html><head><script type="application/ld+json" src="/x.js">{"@type":"Organization"}</script></head><body>x</body></html>`;
    const page = extractPage(html);
    expect(page.jsonLd).toHaveLength(1);
    expect(page.scriptSrcs).toEqual(["/x.js"]);
  });
});
