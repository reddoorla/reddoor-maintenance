import { describe, expect, it } from "vitest";
import { buildSiteConfig } from "../../../src/blux/emit/site-config.js";

const site = {
  navigation: [
    {
      logo: { media: { media: "logo-1", "max-width": "250px" } },
      items: [
        { title: "Catalogs", link: "/product-catalogs", items: [] },
        {
          title: "Products",
          link: "",
          items: [
            { title: "Upholstered", link: "/products/upholstered" },
            { title: "Case", link: "/products/case" },
          ],
        },
        { title: "", link: "/skip-me" }, // no title → dropped
        { title: "Contact", link: "/contact" },
      ],
    },
  ],
  footer: [
    {
      items: [
        {
          media: {
            type: "social",
            networks: { facebook: true, instagram: true, twitter: false },
            urls: { facebook: "https://fb.com/x" },
          },
        },
        { title: "© Composition Hospitality 2017, All Rights Reserved" },
      ],
    },
  ],
};

describe("buildSiteConfig", () => {
  it("parses the nested nav tree, resolving the logo url", () => {
    const cfg = buildSiteConfig(site, (uuid) =>
      uuid === "logo-1" ? "https://cdn/logo.png" : null,
    );
    expect(cfg.nav.logo).toEqual({ url: "https://cdn/logo.png", maxWidth: "250px" });
    expect(cfg.nav.items.map((i) => i.label)).toEqual(["Catalogs", "Products", "Contact"]);
    // The dropdown carries its children; a leaf has none.
    const products = cfg.nav.items.find((i) => i.label === "Products");
    expect(products?.children?.map((c) => `${c.label}:${c.href}`)).toEqual([
      "Upholstered:/products/upholstered",
      "Case:/products/case",
    ]);
    expect(cfg.nav.items[0]?.children).toBeUndefined();
  });

  it("parses footer socials (only enabled networks, with urls) and the copyright line", () => {
    const cfg = buildSiteConfig(site, () => null);
    // twitter:false dropped; facebook keeps its url, instagram has none
    expect(cfg.footer.socials).toEqual([
      { network: "facebook", href: "https://fb.com/x" },
      { network: "instagram" },
    ]);
    expect(cfg.footer.text).toBe("© Composition Hospitality 2017, All Rights Reserved");
  });

  it("degrades to empty config on a site with no navigation/footer", () => {
    const cfg = buildSiteConfig({}, () => null);
    expect(cfg).toEqual({ nav: { items: [] }, footer: { socials: [] } });
  });

  it("omits the logo when its asset is unresolved", () => {
    const cfg = buildSiteConfig(site, () => null);
    expect(cfg.nav.logo).toBeUndefined();
  });
});
