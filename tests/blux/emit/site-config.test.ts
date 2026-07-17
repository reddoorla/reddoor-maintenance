import { describe, expect, it } from "vitest";
import {
  buildSiteConfig,
  socialHrefResolverFromHtml,
} from "../../../src/blux/emit/site-config.js";

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

  it("recovers hrefless socials from the scraped footer via resolveSocialHref", () => {
    // instagram has no export url; the scraped footer supplies it. facebook's
    // export url still wins over the scrape.
    const resolve = socialHrefResolverFromHtml([
      `<a href="https://www.instagram.com/compositionhospitality">ig</a>` +
        `<a href="https://www.facebook.com/pages/Composition/999">fb</a>`,
    ]);
    const cfg = buildSiteConfig(site, () => null, resolve);
    expect(cfg.footer.socials).toEqual([
      { network: "facebook", href: "https://fb.com/x" }, // export url unchanged
      { network: "instagram", href: "https://www.instagram.com/compositionhospitality" },
    ]);
  });
});

describe("socialHrefResolverFromHtml", () => {
  const html =
    `<footer>` +
    `<a href="#site-icon-facebook"></a>` +
    `<a href="http://www.facebook.com/pages/Composition-Hospitality/1505590556391395">f</a>` +
    `<a href="http://www.twitter.com/Composition2014">t</a>` +
    `<a href="http://www.instagram.com/compositionhospitality">i</a>` +
    `<a href="http://www.pinterest.com/composition2014">p</a>` +
    `<a href="http://www.linkedin.com/company/composition-hospitality">l</a>` +
    `<a href="/about">about</a>` +
    `</footer>`;

  it("matches each network to its live profile url by host", () => {
    const resolve = socialHrefResolverFromHtml([html]);
    expect(resolve("facebook")).toBe(
      "http://www.facebook.com/pages/Composition-Hospitality/1505590556391395",
    );
    expect(resolve("twitter")).toBe("http://www.twitter.com/Composition2014");
    expect(resolve("instagram")).toBe("http://www.instagram.com/compositionhospitality");
    expect(resolve("pinterest")).toBe("http://www.pinterest.com/composition2014");
    // linkedin-company shares the linkedin.com domain map.
    expect(resolve("linkedin-company")).toBe(
      "http://www.linkedin.com/company/composition-hospitality",
    );
  });

  it("ignores in-page anchors and relative links, and unknown networks", () => {
    const resolve = socialHrefResolverFromHtml([html]);
    // No absolute youtube link present.
    expect(resolve("youtube")).toBeUndefined();
    // Not in the domain map at all.
    expect(resolve("myspace")).toBeUndefined();
  });

  it("does not match look-alike hosts (suffix spoofing)", () => {
    const resolve = socialHrefResolverFromHtml([
      `<a href="https://notfacebook.com/x">nope</a>` +
        `<a href="https://facebook.com.evil.example/x">nope</a>`,
    ]);
    expect(resolve("facebook")).toBeUndefined();
  });

  it("matches twitter's x.com host", () => {
    const resolve = socialHrefResolverFromHtml([
      `<a href="https://x.com/Composition2014">x</a>`,
    ]);
    expect(resolve("twitter")).toBe("https://x.com/Composition2014");
  });
});
