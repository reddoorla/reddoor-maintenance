import { describe, expect, it } from "vitest";
import { convertSite, sitePages } from "../../../src/blux/emit/convert.js";
import { normalizePages } from "../../../src/blux/normalize.js";
import { parseBluxSite } from "../../../src/blux/parse.js";

// A two-page site: band indices restart at 0 on every page (page-block-N is
// page-local), so the manifest MUST be page-namespaced or the pages collide.
const site = {
  name: "Multi",
  id: "site-m",
  domain: "www.multi.test",
  content: {
    pages: [
      { title: "Composition Hospitality", items: [] },
      { title: "Gallery", url: "", items: [] },
      { title: "About Us", url: "about", items: [] },
      // A title-duplicate draft: same title as the homepage, its own url.
      { title: "Composition Hospitality", url: "composition-hospitality-copy", items: [] },
    ],
  },
  feeds: {},
  media: {},
  styles: {},
};

const pageHtml = (n: number, text: string) =>
  `<div id="page-content"><section id="page-block-${n}" class="blocks0">` +
  `<div class="block-content"><h2 class="block-title text5">${text}</h2></div>` +
  `</section></div>`;

describe("normalizePages (multi-page)", () => {
  it("pins the first page's uid to 'home' (the render root-route contract) with path ''", () => {
    const { pages } = normalizePages(parseBluxSite(site));
    expect(pages[0]).toMatchObject({ uid: "home", path: "" });
  });

  it("derives paths from url when set, else the title slug", () => {
    const { pages } = normalizePages(parseBluxSite(site));
    expect(pages[1]).toMatchObject({ uid: "gallery", path: "gallery" }); // empty url → title
    expect(pages[2]).toMatchObject({ uid: "about", path: "about" }); // url wins over "about-us"
    expect(pages[3]).toMatchObject({
      uid: "composition-hospitality-copy",
      path: "composition-hospitality-copy",
    });
  });

  it("renames a colliding uid with a diagnostic instead of overwriting", () => {
    const dup = {
      ...site,
      content: {
        pages: [
          { title: "Home", items: [] },
          { title: "Team", items: [] },
          { title: "Team!", items: [] }, // slugs to "team" too
        ],
      },
    };
    const { pages, diagnostics } = normalizePages(parseBluxSite(dup));
    expect(pages.map((p) => p.uid)).toEqual(["home", "team", "team-2"]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ kind: "duplicate-page-uid", where: "team" }),
    );
  });
});

describe("sitePages", () => {
  it("returns the routing table straight from site.json", () => {
    expect(sitePages(site).map((p) => `${p.uid}:${p.path}`)).toEqual([
      "home:",
      "gallery:gallery",
      "about:about",
      "composition-hospitality-copy:composition-hospitality-copy",
    ]);
  });
});

describe("convertSite feed materialization", () => {
  // A page whose band 1 is a feed grid (only the {{…}} template renders in the
  // static html); convertSite rebuilds its tiles from the feed records.
  const feedSite = {
    name: "Feed",
    id: "site-f",
    domain: "www.feed.test",
    content: {
      pages: [
        {
          title: "Home",
          items: [
            { title: "Welcome" }, // band 0 — plain
            {
              title: "Projects",
              sources: ["projects"],
              sourceConfig: { sort: "title", _body: { class: "disable" } },
              columns: "2",
              type: "grid",
            },
          ],
        },
      ],
    },
    feeds: {
      projects: {
        name: "Projects",
        items: [
          { title: "Beta", body: "<p>b</p>" },
          { title: "Alpha", body: "<p>a</p>" },
        ],
      },
    },
    media: {},
    styles: {},
  };

  it("rebuilds a feed band's tiles from the records, keeping its heading", () => {
    const html =
      '<div id="page-content">' +
      '<section id="page-block-0" class="blocks0"><div class="block-content">' +
      '<h2 class="block-title text5">Welcome</h2></div></section>' +
      '<section id="page-block-1" class="blocks0"><div class="block-content">' +
      '<h2 class="block-title text5">Projects</h2>' +
      '<div class="block-grid-container cagrid" data-columns="2">' +
      '<div id="page-block-1-template" class="block-subcontent cagriditem" style="display:none">' +
      '<h6 class="block-title text6">{{title}}</h6></div>' +
      "</div></div></section></div>";
    const { presentation } = convertSite({
      siteJson: feedSite,
      htmlByUid: new Map([["home", html]]),
    });
    const band1 = presentation.pages["home"]!.bands["1"];
    // Band 1's tree: heading "Projects" over a row of 2 tile cells (sorted).
    const tree = band1?.tree as {
      kind: string;
      children: { kind: string; html?: string; cells?: { node: { html: string } }[] }[];
    };
    expect(tree.kind).toBe("stack");
    expect(tree.children[0]).toMatchObject({ kind: "heading", html: "Projects" });
    const row = tree.children[1]!;
    expect(row.kind).toBe("row");
    expect(row.cells!.map((c) => c.node.html)).toEqual(["Alpha", "Beta"]); // sorted, body disabled
  });
});

describe("convertSite", () => {
  it("converts every page with html into a page-namespaced manifest + one document each", () => {
    const htmlByUid = new Map([
      ["home", pageHtml(0, "Welcome")],
      ["gallery", pageHtml(0, "Gallery")],
      ["about", pageHtml(2, "About")],
    ]);
    const { pages, plan, presentation, ir } = convertSite({ siteJson: site, htmlByUid });
    expect(pages.map((p) => p.uid)).toEqual(["home", "gallery", "about"]);
    // Page-namespaced bands: home and gallery both have band "0" — they must
    // NOT collide (the flat single-page manifest could not hold both).
    expect(Object.keys(presentation.pages).sort()).toEqual(["about", "gallery", "home"]);
    expect(presentation.pages["home"]?.bands["0"]).toBeDefined();
    expect(presentation.pages["gallery"]?.bands["0"]).toBeDefined();
    expect(presentation.pages["about"]?.bands["2"]).toBeDefined();
    // One page document per converted page, uid-keyed.
    expect(plan.documents.map((d) => `${d.type}:${d.uid}`)).toEqual([
      "page:home",
      "page:gallery",
      "page:about",
    ]);
    // The page without html (the draft copy) is skipped with a diagnostic.
    expect(ir.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "missing-page-html",
        where: "composition-hospitality-copy",
      }),
    );
  });
});
