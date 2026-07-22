import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasVisibleContent, sanitizeHtml } from "../../../src/blux/catalog/sanitize.js";

const mapBand = readFileSync(
  fileURLToPath(new URL("../fixtures/the-pointe-map-band.html", import.meta.url)),
  "utf-8",
);

describe("sanitizeHtml", () => {
  it("strips script blocks but keeps the visible legend markup (real map band)", () => {
    const out = sanitizeHtml(mapBand);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("initMap");
    expect(out).not.toContain("clickMap");
    expect(out).toContain("The Burbank Portfolio");
    expect(out).toContain("Hotel And Services");
    expect(out).toContain('id="burbank_map"');
  });

  it("strips multiple script blocks case-insensitively and tolerates an unclosed one at EOF", () => {
    expect(
      sanitizeHtml(
        '<p>a</p><SCRIPT>var x=1;</SCRIPT><p>b</p><script type="text/javascript">y()</script>',
      ),
    ).toBe("<p>a</p><p>b</p>");
    expect(sanitizeHtml("<p>a</p><script>trailing, never closed")).toBe("<p>a</p>");
  });

  it("strips inline on* handler attributes in any quoting style", () => {
    expect(sanitizeHtml('<div onclick="evil()" class="k">x</div>')).toBe('<div class="k">x</div>');
    expect(sanitizeHtml("<img onerror='p()' src=\"a.jpg\">")).toBe('<img src="a.jpg">');
    expect(sanitizeHtml("<body onload=boot()>hi</body>")).toBe("<body>hi</body>");
  });

  it("neutralizes javascript: urls in href/src", () => {
    const a = sanitizeHtml('<a href="javascript:evil()">go</a>');
    expect(a).not.toContain("javascript:");
    expect(a).toContain(">go</a>");
    expect(sanitizeHtml("<img src=javascript:evil()>")).not.toContain("javascript:");
  });

  it("passes everything else through verbatim", () => {
    const html = "<div class=\"blux-map\" data-x='1'><span>hi</span>&amp;</div>";
    expect(sanitizeHtml(html)).toBe(html);
  });
});

describe("hasVisibleContent", () => {
  it("is false for empty/script-only html", () => {
    expect(hasVisibleContent('<div data-exec="custom_abc"></div>')).toBe(false);
    expect(hasVisibleContent("<div><script>var x=1;</script></div>")).toBe(false);
    expect(hasVisibleContent("  \n ")).toBe(false);
  });

  it("is true for text or a media element", () => {
    expect(hasVisibleContent("<div><span>Legend</span></div>")).toBe(true);
    expect(hasVisibleContent('<div><img src="a.jpg"></div>')).toBe(true);
    expect(hasVisibleContent('<iframe src="https://x"></iframe>')).toBe(true);
    expect(hasVisibleContent("<video src='v.mp4'></video>")).toBe(true);
  });
});
