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

  it("leaves no residual token-less copy and preserves inline structure", () => {
    const { html } = tokenizeText(`<body><section><p>a <em>b</em> c</p></section></body>`);
    // three text runs: "a ", "b", " c" → three tokens, <em> preserved
    const tokens = [...html.matchAll(TOKEN_RE())];
    expect(tokens.length).toBe(3);
    expect(html).toContain("<em>");
  });
});
