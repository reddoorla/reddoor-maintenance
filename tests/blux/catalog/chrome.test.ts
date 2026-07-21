// Plan 4d Task 4: site chrome for the catalog path. Fixtures mirror the REAL
// the-pointe export shapes: every nav/footer item's display string is `title`
// (`text` is the boilerplate "Navigation Item"/"Sub-Footer Item"), `link` is a
// plain string, the nav logo is a `hideTitle: true` nav ITEM carrying `media`
// (there is no `navigation[0].logo`), footer columns are
// `footer[0].items[].items[]`, and layout spacers are `&nbsp;`-titled rows.
import { describe, it, expect } from "vitest";
import { buildChrome } from "../../../src/blux/catalog/chrome.js";

const resolve = (uuid: string): string | null =>
  uuid === "uuid-logo"
    ? "https://cdn/logo.png"
    : uuid === "uuid-tbp"
      ? "https://cdn/tbp.png"
      : null;

const siteJson = {
  navigation: [
    {
      items: [
        {
          text: "Navigation Item",
          link: "/",
          title: "Logo",
          hideTitle: true,
          media: { media: "uuid-logo", "max-width": "200px" },
          items: [],
        },
        { text: "Navigation Item", link: "/#1", title: "Vision", items: [] },
        { text: "Navigation Item", link: "/#5", title: "Amenities", items: [] },
        { text: "Navigation Item", link: "/#11", title: "Contact Us", items: [] },
      ],
    },
  ],
  footer: [
    {
      items: [
        {
          text: "Footer Item",
          link: "",
          items: [
            {
              text: "Sub-Footer Item",
              link: "",
              title: "Logo",
              hideTitle: true,
              media: { media: "uuid-logo", "max-width": "150px" },
            },
          ],
        },
        {
          text: "Footer Item",
          link: "",
          items: [
            { text: "Sub-Footer Item", link: "", title: "Leasing Team" },
            // Real the-pointe row: a media whose url can't resolve (the CBRE
            // logo when the scrape misses it) draws nothing — never junk text.
            {
              text: "Sub-Footer Item",
              link: "",
              media: { media: "uuid-unresolved" },
              title: " &nbsp;",
              hideTitle: true,
            },
            { text: "Sub-Footer Item", link: "", title: "Todd Doney" },
            // Ground truth from the export: displayed number and tel: target
            // DIFFER (213.613.3330 shown, tel:213.593.1360 dialed) — both
            // must survive verbatim.
            { text: "Sub-Footer Item", link: "tel:213.593.1360", title: "213.613.3330" },
            {
              text: "Sub-Footer Item",
              link: "mailto:Todd.Doney@cbre.com",
              title: "Todd.Doney@cbre.com",
            },
            // Spacer rows: `&nbsp;`-titled, no hideTitle — must vanish.
            { text: "Sub-Footer Item", link: "", title: " &nbsp;", style: {} },
            {
              text: "Sub-Footer Item",
              link: "https://www.theburbankportfolio.com/",
              title: "TBP Logo",
              hideTitle: true,
              media: { media: "uuid-tbp", "max-width": "300px" },
            },
          ],
        },
      ],
    },
  ],
};

describe("buildChrome", () => {
  it("nav rides buildSiteConfig; the hideTitle media item becomes the logo, not a text link", () => {
    const c = buildChrome(siteJson, resolve);
    expect(c.nav.items).toEqual([
      { label: "Vision", href: "/#1" },
      { label: "Amenities", href: "/#5" },
      { label: "Contact Us", href: "/#11" },
    ]);
    expect(c.nav.logo).toEqual({ url: "https://cdn/logo.png", maxWidth: "200px" });
  });

  it("footer keeps FULL columns: contacts with tel/mailto verbatim, logos as images, spacers dropped", () => {
    const c = buildChrome(siteJson, resolve);
    expect(c.footer.columns).toHaveLength(2);
    expect(c.footer.columns[0]!.items).toEqual([
      { image: { url: "https://cdn/logo.png", maxWidth: "150px" } },
    ]);
    expect(c.footer.columns[1]!.items).toEqual([
      { text: "Leasing Team" },
      { text: "Todd Doney" },
      { text: "213.613.3330", href: "tel:213.593.1360" },
      { text: "Todd.Doney@cbre.com", href: "mailto:Todd.Doney@cbre.com" },
      {
        image: { url: "https://cdn/tbp.png", maxWidth: "300px" },
        href: "https://www.theburbankportfolio.com/",
      },
    ]);
  });

  it("tolerates missing navigation/footer arrays", () => {
    const c = buildChrome({}, () => null);
    expect(c.nav.items).toEqual([]);
    expect(c.nav.logo).toBeUndefined();
    expect(c.footer.columns).toEqual([]);
  });
});
