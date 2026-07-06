// A hand-authored minimal Blux site.json exercising each archetype, one feed,
// and shared media. Field names match the real export (title/_title, body/_body,
// media, backgroundMedia, class, items, styles).
export const minimalSite = {
  name: "Test Site",
  id: "site-1",
  domain: "www.testsite.com",
  content: {
    pages: [
      {
        title: "Home",
        description: "",
        items: [
          // hero: backgroundMedia + copy
          {
            _title: "<h1>Welcome</h1>",
            _body: "<p>Intro copy.</p>",
            backgroundMedia: { media: "img-1" },
            class: "",
            styles: {},
          },
          // heading + text + media
          {
            _title: "<h2>About</h2>",
            _body: "<p>About us.</p>",
            media: { media: "img-1" },
            styles: {},
          },
          // heading + text
          { _title: "<h2>Mission</h2>", _body: "<p>Our mission.</p>", styles: {} },
          // grid container of two children
          {
            class: "grid",
            items: [
              {
                _title: "<h3>Card A</h3>",
                _body: "<p>A.</p>",
                media: { media: "img-2" },
                styles: {},
              },
              {
                _title: "<h3>Card B</h3>",
                _body: "<p>B.</p>",
                media: { media: "img-2" },
                styles: {},
              },
            ],
            styles: {},
          },
        ],
        widgets: {},
        featured: false,
      },
    ],
  },
  navigation: [{ items: [{ title: "Home", url: "/" }], styles: {}, config: {} }],
  footer: [{ items: [], styles: {}, config: {} }],
  styles: {
    colors: { c1: "#111111", c2: "#ffffff", c3: "#3bb0c9" },
    text: { t1: { size: "16px", weight: 400, lineHeight: 1.5 } },
    buttons: {},
  },
  media: {
    "img-1": { name: "Hero.jpg", type: "image/jpeg", size: { w: 1600, h: 900 }, siteID: "site-1" },
    "img-2": { name: "Card.jpg", type: "image/jpeg", size: { w: 800, h: 600 }, siteID: "site-1" },
  },
  feeds: {
    "feed-1": {
      name: "Team",
      source: "manual",
      publish: "team",
      fields: [{ title: "Role", field: "role", type: "text" }],
      items: [
        { title: "Jane Doe", role: "CEO", body: "<p>Bio.</p>", media: { media: "img-2" } },
        { title: "John Roe", role: "CTO", body: "<p>Bio.</p>" },
      ],
    },
  },
  settings: { fonts: { heading: "Inter", body: "Inter" }, widgets: {} },
};

// A rendered HTML string that references the assets via the real CDN URL shape
// (with a transform segment) so assets.ts can be exercised.
export const minimalHtml = `<html><body>
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg">
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png">
</body></html>`;
