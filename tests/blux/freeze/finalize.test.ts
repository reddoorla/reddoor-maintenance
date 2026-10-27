import { describe, expect, it } from "vitest";
import { finalize } from "../../../src/blux/freeze/finalize.js";

describe("finalize", () => {
  const fin = finalize(
    `<html><head><title>The Pointe</title>` +
      `<meta property="og:title" content="OG Pointe">` +
      `<meta property="og:image" content="https://cdn/og.jpg">` +
      `<style>.a{color:red}</style></head>` +
      `<body class="page0" style="background-color:#eee"><h1>Hi</h1><script>var x=1</script></body></html>`,
  );

  it("reads title + og meta", () => {
    expect(fin.title).toBe("The Pointe");
    expect(fin.metaTitle).toBe("OG Pointe");
    expect(fin.metaImageUrl).toBe("https://cdn/og.jpg");
  });

  it("extracts page styles and appends the reveal-force override", () => {
    expect(fin.styleCss).toContain(".a{color:red}");
    expect(fin.styleCss).toContain(".block-effects{opacity:1!important");
  });

  it("strips scripts and styles from the template, keeps content", () => {
    expect(fin.templateHtml).toContain("<h1>Hi</h1>");
    expect(fin.templateHtml).not.toContain("<script");
    expect(fin.templateHtml).not.toContain("<style");
  });

  it("wraps the body carrying its class + style", () => {
    expect(fin.templateHtml).toContain('class="frozen-root page0"');
    expect(fin.templateHtml).toContain('style="background-color:#eee"');
  });
});
