// A hand-authored minimal Blux site.json exercising each archetype, one feed,
// and shared media. Field names match the real export: display text lives in
// `title`/`body`; the underscore twins `_title`/`_body` are per-element style
// config objects where `class: "disable"` hides the element on the rendered
// site (media, backgroundMedia, class, items, styles as in the export).
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
          // hero: backgroundMedia + copy (styled title, empty body style config)
          {
            title: "Welcome",
            _title: { color: "#ffffff", "font-size": "44px" },
            body: "<p>Intro copy.</p>",
            _body: {},
            backgroundMedia: { media: "img-1" },
            class: "",
            styles: {},
          },
          // heading + text + media
          {
            title: "About",
            _title: {},
            body: "<p>About us.</p>",
            media: { media: "img-1" },
            styles: {},
          },
          // heading + text (no style config at all)
          { title: "Mission", body: "<p>Our mission.</p>", styles: {} },
          // grid container of two children; Card B's title is a disabled
          // editor label and must not be migrated
          {
            class: "grid",
            items: [
              {
                title: "Card A",
                _title: { color: "#111111" },
                body: "<p>A.</p>",
                media: { media: "img-2" },
                styles: {},
              },
              {
                title: "Card B",
                _title: { class: "disable" },
                body: "<p>B.</p>",
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
    // Real export shape: a position-stable array whose slots are
    // { _label, ".textN": css props }. text0/text1 are Blux's default
    // title/body roles; text5 is a named role blocks reference via
    // `_title: { class: "text5" }`. Index 4 is a deleted-style tombstone;
    // text11 mirrors the real export's malformed `letter-spacing: "0.px"`,
    // `padding: "px"`, and `__media_mobile_*` responsive overrides.
    text: {
      "0": {
        _label: "Title (Default)",
        ".text0": {
          "font-family": "'Scope One'",
          "font-size": "44px",
          "font-weight": 400,
          "line-height": "60px",
          "text-transform": "capitalize",
          "font-ident": "G:Scope One:400:",
        },
      },
      "1": {
        _label: "Body (Default)",
        ".text1": {
          "font-family": "'Montserrat'",
          "font-size": "18px",
          "font-weight": 300,
          "line-height": "36px",
          "font-ident": "G:Montserrat:300:",
        },
      },
      "4": { removed: true },
      "5": {
        _label: "Grid Titles",
        ".text5": {
          "font-family": "'Montserrat'",
          "font-size": "15px",
          "font-weight": 500,
          "line-height": "26px",
          "text-transform": "uppercase",
          "letter-spacing": "1.5px",
          "font-ident": "G:Montserrat:500:",
        },
      },
      "11": {
        _label: "Page Title Serif",
        ".text11": {
          "font-family": "'Martel'",
          "font-size": "50px",
          "font-weight": 200,
          "line-height": "80px",
          "text-transform": "capitalize",
          padding: "px",
          "letter-spacing": "0.px",
          "__media_mobile_font-size": "40px",
          "__media_mobile_line-height": "60px",
          "font-ident": "G:Martel:200:",
        },
      },
    },
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
  settings: {
    // heading/body drive the CSS font-family pair; `google` is the separate
    // load manifest (which weights to install), matching the real export.
    fonts: {
      heading: "Inter",
      body: "Inter",
      google: "Scope+One:regular|Montserrat:300,500,regular|Martel:200",
    },
    widgets: {},
  },
};

// A rendered HTML string that references the assets via the real CDN URL shape
// (with a transform segment) so assets.ts can be exercised.
export const minimalHtml = `<html><body>
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg">
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png">
</body></html>`;
