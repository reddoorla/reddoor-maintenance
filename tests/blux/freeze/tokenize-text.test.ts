import { describe, expect, it } from "vitest";
import { tokenizeText } from "../../../src/blux/freeze/tokenize-text.js";
import { TOKEN_RE } from "../../../src/blux/freeze/types.js";

describe("tokenizeText", () => {
  it("tokenizes non-whitespace text nodes, keyed by section", () => {
    const { html, slots } = tokenizeText(
      `<body><section><h1>Distinguished Design</h1><p>   </p><p>Body copy.</p></section></body>`,
    );
    expect(slots).toEqual([
      { key: "s0.t0", kind: "text", text: "Distinguished Design", section: "s0" },
      { key: "s0.t1", kind: "text", text: "Body copy.", section: "s0" },
    ]);
    expect(html).toContain("<h1>⟦t:s0.t0⟧</h1>");
    expect(html).toContain("<p>⟦t:s0.t1⟧</p>");
    // whitespace-only <p> is untouched
    expect(html).toContain("<p>   </p>");
  });

  it("keys chrome above sections as `h`, and numbers per section", () => {
    const { slots } = tokenizeText(
      `<body><nav>Menu</nav><section>One</section><section>Two<span>Three</span></section></body>`,
    );
    expect(slots.map((s) => [s.key, s.text])).toEqual([
      ["h.t0", "Menu"],
      ["s0.t0", "One"],
      ["s1.t0", "Two"],
      ["s1.t1", "Three"],
    ]);
  });

  it("skips script/style/head content", () => {
    const { slots } = tokenizeText(
      `<head><title>T</title></head><body><style>.x{color:red}</style><script>var a='hi'</script><p>Real</p></body>`,
    );
    expect(slots.map((s) => s.text)).toEqual(["Real"]);
  });

  it("leaves entity-encoded whitespace literal instead of making it a CMS field", () => {
    // The shape page builders emit for a blank row: a list item whose only
    // content is `&nbsp;`, there to occupy one line. Tokenizing it produces a
    // Prismic Rich Text field that CANNOT hold the value — it round-trips to ""
    // and the row collapses — so the leaf has to stay in the template.
    const { html, slots } = tokenizeText(
      `<body><ul><li>Lic. 00852254</li><li> &nbsp;</li><li>Doug Marlow</li></ul></body>`,
    );
    expect(slots.map((s) => [s.key, s.text])).toEqual([
      ["h.t0", "Lic. 00852254"],
      ["h.t1", "Doug Marlow"],
    ]);
    expect(html).toContain("<li> &nbsp;</li>");
  });

  it("treats every spelling of blank alike, and a real character as content", () => {
    const { html, slots } = tokenizeText(
      // Named, decimal and hex references for the same character, two other
      // Unicode spaces, an undecoded literal U+00A0, and a plain space — every
      // form an export might use for a blank row. `&amp;` is the control: it is
      // an entity too, but it decodes to a CHARACTER, so it stays editable copy.
      `<body><p>&nbsp;</p><p>&#160;</p><p>&#xa0;</p><p>&emsp;</p><p>&thinsp;</p>` +
        `<p>\u00A0</p><p> </p><p>&amp;</p></body>`,
    );
    expect(slots.map((s) => s.text)).toEqual(["&amp;"]);
    expect(html).toContain("<p>&nbsp;</p>");
    expect(html).toContain("<p>&emsp;</p>");
    expect(html).toContain("<p>\u00A0</p>");
    expect(html).toContain("<p>⟦t:h.t0⟧</p>");
  });

  it("numbers around a skipped leaf exactly as around plain whitespace", () => {
    // A skipped leaf must not advance the counter, or the two kinds of blank
    // would number differently and the rule would be impossible to reason about.
    const entity = tokenizeText(`<body><p>A</p><p>&nbsp;</p><p>B</p></body>`);
    const plain = tokenizeText(`<body><p>A</p><p>   </p><p>B</p></body>`);
    expect(entity.slots.map((s) => s.key)).toEqual(["h.t0", "h.t1"]);
    expect(entity.slots.map((s) => s.key)).toEqual(plain.slots.map((s) => s.key));
  });

  it("leaves no residual token-less copy and preserves inline structure", () => {
    const { html } = tokenizeText(`<body><section><p>a <em>b</em> c</p></section></body>`);
    // three text runs: "a ", "b", " c" → three tokens, <em> preserved
    const tokens = [...html.matchAll(TOKEN_RE())];
    expect(tokens.length).toBe(3);
    expect(html).toContain("<em>");
  });
});
