import { describe, it, expect } from "vitest";
import { rewriteDocUrls } from "../../../src/blux/catalog/rewrite-doc-urls.js";

const CDN = "https://d3syaxnfm3oj0e.cloudfront.net/img/abc-123.jpg";
const PRISMIC = "https://images.prismic.io/repo/xyz.jpg";
const map = new Map([[CDN, PRISMIC]]);

describe("rewriteDocUrls", () => {
  it("rewrites CDN urls inside serialized payload strings", () => {
    const docs = [
      {
        type: "page",
        uid: "home",
        data: {
          slices: [
            {
              slice_type: "blux_block",
              primary: { payload: JSON.stringify({ image: { url: CDN, alt: "" } }) },
            },
          ],
        },
      },
    ];
    const r = rewriteDocUrls(docs, map);
    expect(JSON.stringify(r.documents)).toContain(PRISMIC);
    expect(JSON.stringify(r.documents)).not.toContain(CDN);
    expect(r.rewritten).toBe(1);
  });

  it("rewrites widget_html / embed_html / background-image strings", () => {
    const docs = [
      {
        type: "page",
        uid: "home",
        data: {
          slices: [
            {
              slice_type: "blux_section",
              primary: {
                widget_html: `<div class="blux-map"><img src="${CDN}"></div>`,
                background_html: `background-image:url(${CDN})`,
              },
            },
          ],
        },
      },
    ];
    const r = rewriteDocUrls(docs, map);
    const s = JSON.stringify(r.documents);
    expect(s).not.toContain(CDN);
    expect(r.rewritten).toBe(2);
  });

  it("does not touch markers, non-string values, or unrelated strings; input not mutated", () => {
    const docs = [
      {
        type: "page",
        uid: "home",
        data: { title: { __richtext_html: "<h1>x</h1>" }, media: { __asset_id: "abc-123" }, n: 4 },
      },
    ];
    const before = JSON.stringify(docs);
    const r = rewriteDocUrls(docs, map);
    expect(JSON.stringify(r.documents)).toBe(before);
    expect(JSON.stringify(docs)).toBe(before);
    expect(r.rewritten).toBe(0);
  });

  it("reports surviving cloudfront urls as unmatched (never silent)", () => {
    const other = "https://d3syaxnfm3oj0e.cloudfront.net/img/UNKNOWN.jpg";
    const docs = [
      { type: "page", uid: "home", data: { s: `<img src="${other}">` } },
    ];
    const r = rewriteDocUrls(docs, map);
    expect(r.unmatched).toEqual([other]);
  });
});
