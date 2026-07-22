import { describe, it, expect } from "vitest";
import { rewriteDocUrls, collectCdnUrls } from "../../../src/blux/catalog/rewrite-doc-urls.js";

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
    // Purity on the rewriting path: the input documents keep the CDN url.
    expect(JSON.stringify(docs)).toContain(CDN);
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
    const docs = [{ type: "page", uid: "home", data: { s: `<img src="${other}">` } }];
    const r = rewriteDocUrls(docs, map);
    expect(r.unmatched).toEqual([other]);
  });

  it("bounds an unmatched url at the escaping backslash in doubly-serialized JSON", () => {
    const other = "https://d3syaxnfm3oj0e.cloudfront.net/img/UNKNOWN.jpg";
    // Outer stringify escapes the inner quotes, so the url is immediately
    // followed by `\"` — the reported url must carry no trailing backslash/quote.
    const docs = [
      {
        type: "page",
        uid: "home",
        data: { s: JSON.stringify({ payload: JSON.stringify({ image: { url: other } }) }) },
      },
    ];
    const r = rewriteDocUrls(docs, map);
    expect(r.unmatched).toEqual([other]);
  });

  it("counts every occurrence of the same mapped url within one string", () => {
    const docs = [
      { type: "page", uid: "home", data: { s: `<img src="${CDN}"><img src="${CDN}">` } },
    ];
    const r = rewriteDocUrls(docs, map);
    expect(r.rewritten).toBe(2);
    expect(JSON.stringify(r.documents)).not.toContain(CDN);
  });

  it("swaps the mapped url and reports the unmapped one from the same string", () => {
    const other = "https://d3syaxnfm3oj0e.cloudfront.net/img/UNKNOWN.jpg";
    const docs = [
      { type: "page", uid: "home", data: { s: `<img src="${CDN}"><img src="${other}">` } },
    ];
    const r = rewriteDocUrls(docs, map);
    expect(r.rewritten).toBe(1);
    expect(r.unmatched).toEqual([other]);
  });
});

// collectCdnUrls underpins the emit backstop: it finds every Blux-CDN url baked
// into a document as a RAW STRING (an embed_html <a href> to a PDF, a payload
// background, a widget) — the surfaces no media marker captures — so each can be
// registered as an asset and evicted. Same host-anchored match as the rewrite.
describe("collectCdnUrls", () => {
  const PDF = "https://dv4tl7yyk1zlp.cloudfront.net/site-1/1b5b96c1.pdf";
  const IMG = "https://d3syaxnfm3oj0e.cloudfront.net/site-1/abc-123.jpg";

  it("finds a CDN url inside an embed_html <a href> (the PDF-button case)", () => {
    const docs = [
      {
        type: "page",
        uid: "home",
        data: {
          slices: [
            {
              slice_type: "blux_grid",
              primary: { cells: [{ embed_html: `<a href="${PDF}">Burbank Incentives</a>` }] },
            },
          ],
        },
      },
    ];
    expect(collectCdnUrls(docs)).toEqual([PDF]);
  });

  it("walks nested arrays/objects and serialized payload strings", () => {
    const value = {
      a: [{ b: `bg:url(${IMG})` }],
      c: { payload: JSON.stringify({ image: { url: PDF } }) },
    };
    expect(collectCdnUrls(value).sort()).toEqual([IMG, PDF].sort());
  });

  it("dedups repeated urls, first-seen order, and ignores non-cloudfront strings", () => {
    const value = {
      s1: `<img src="${IMG}"><img src="${IMG}">`,
      s2: `<a href="${PDF}">x</a>`,
      s3: "https://images.prismic.io/repo/already-migrated.jpg",
      n: 42,
    };
    expect(collectCdnUrls(value)).toEqual([IMG, PDF]);
  });

  it('bounds the url at the escaping backslash in doubly-serialized JSON (no trailing \\")', () => {
    const value = { s: JSON.stringify({ payload: JSON.stringify({ href: PDF }) }) };
    expect(collectCdnUrls(value)).toEqual([PDF]);
  });
});
