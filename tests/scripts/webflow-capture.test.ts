import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  exclusionFor,
  extractFromCss,
  extractFromHtml,
  extractFromJs,
  extractFromLottie,
  extractPageLinks,
  pageToLocal,
  sha256,
  urlToLocal,
  webfontGoogleCssUrls,
} from "../../scripts/webflow-capture/lib.mjs";
import { checkCapture } from "../../scripts/webflow-capture/check.mjs";

const CDN = "https://cdn.prod.website-files.com/645ec08251dadc9000a072e5";
const PAGE = "https://www.example-wf.com/";
const urls = (refs: Array<{ url: string }>) => refs.map((r) => r.url);

describe("extractFromHtml", () => {
  it("finds every srcset variant, both background-video transcodes, posters, Lottie and runtime loads", () => {
    const html = `
      <link href="${CDN}/css/site.webflow.shared.abc.css" rel="stylesheet" type="text/css"/>
      <link href="${CDN}/fav.png" rel="shortcut icon" type="image/x-icon"/>
      <link href="https://fonts.googleapis.com" rel="preconnect"/>
      <link href="/projects/one" rel="prefetch"/>
      <img src="${CDN}/a_photo.jpg" srcset="${CDN}/a_photo-p-500.jpg 500w, ${CDN}/a_photo-p-800.jpg 800w, ${CDN}/a_photo.jpg 1200w"/>
      <div data-video-urls="${CDN}/v-transcode.mp4,${CDN}/v-transcode.webm" data-poster-url="${CDN}/v-poster-00001.jpg"></div>
      <div data-animation-type="lottie" data-src="${CDN}/anim.json"></div>
      <div style="background-image:url(&quot;${CDN}/bg.jpg&quot;)"></div>
      <a href="${CDN}/app.pdf">Download</a>
      <a href="https://www.flaticon.com/free-icons/house">icons</a>
      <script>$.getScript("https://raw.githack.com/o/r/main/countersAnim.js")</script>
      <script>WebFont.load({  google: {    families: ["Lato:100,300","Open Sans:400"]  }});</script>
      <iframe src="//cdn.embedly.com/widgets/media.html?src=x"></iframe>`;
    const got = urls(extractFromHtml(html, PAGE));
    expect(got).toEqual(
      expect.arrayContaining([
        `${CDN}/css/site.webflow.shared.abc.css`,
        `${CDN}/fav.png`,
        `${CDN}/a_photo.jpg`,
        `${CDN}/a_photo-p-500.jpg`,
        `${CDN}/a_photo-p-800.jpg`,
        `${CDN}/v-transcode.mp4`,
        `${CDN}/v-transcode.webm`,
        `${CDN}/v-poster-00001.jpg`,
        `${CDN}/anim.json`,
        `${CDN}/bg.jpg`,
        `${CDN}/app.pdf`,
        "https://raw.githack.com/o/r/main/countersAnim.js",
        "https://fonts.googleapis.com/css?family=Lato:100,300%7COpen+Sans:400",
        "https://cdn.embedly.com/widgets/media.html?src=x",
      ]),
    );
    expect(got).not.toContain("https://fonts.googleapis.com/");
    expect(got).not.toContain("https://www.example-wf.com/projects/one");
    expect(got.some((u) => u.includes("flaticon"))).toBe(false);
    expect(new Set(got).size).toBe(got.length);
  });

  it("collects same-origin page links, not files, fragments or other hosts", () => {
    const html = `<a href="/about-us">a</a><a href="/about-us/">b</a><a href="/projects/x#top">c</a>
      <a href="https://other.com/p">d</a><a href="mailto:info@x.com">e</a><a href="${CDN}/f.pdf">f</a><a href="#">g</a>`;
    expect(extractPageLinks(html, PAGE)).toEqual(["/about-us", "/projects/x"]);
  });
});

describe("extractFromCss / Js / Lottie", () => {
  it("keeps a quoted url() whose filename contains parentheses and skips data URIs", () => {
    const css = `a{background:url("${CDN}/Untitled design (16).png")} b{background:url(data:image/png;base64,AA)} @import "x.css";`;
    expect(urls(extractFromCss(css, `${CDN}/css/s.css`))).toEqual([
      `${CDN}/Untitled%20design%20(16).png`,
      `${CDN}/css/x.css`,
    ]);
  });

  it("lists each Adobe Fonts face from a kit's URI templates, and excludes it by name", () => {
    const js = `{"src":"https://use.typekit.net/af/442215/000000000000000000010b5a/27/{format}{?primer,subset_id,fvd,v}"}`;
    const got = extractFromJs(js, "https://use.typekit.net/htt1asl.js");
    expect(urls(got)).toEqual(["https://use.typekit.net/af/442215/000000000000000000010b5a/27/"]);
    expect(exclusionFor(got[0]!.url)).toMatch(/licensed/);
  });

  it("finds a Lottie image loaded from outside the JSON, and not an embedded one", () => {
    const doc = JSON.stringify({
      assets: [
        { u: "images/", p: "img_0.png", e: 0 },
        { p: "data:image/png;base64,AA", e: 1 },
      ],
    });
    expect(urls(extractFromLottie(doc, `${CDN}/anim.json`))).toEqual([`${CDN}/images/img_0.png`]);
  });

  it("builds the stylesheet URL webfont.js requests", () => {
    expect(webfontGoogleCssUrls(`WebFont.load({google:{families:["Jost:300,regular"]}})`)).toEqual([
      "https://fonts.googleapis.com/css?family=Jost:300,regular",
    ]);
  });
});

describe("urlToLocal / pageToLocal", () => {
  it("mirrors host and decoded path, and folds a query into the name", () => {
    expect(urlToLocal(`${CDN}/a%20b%20(1).png`)).toBe(
      "files/cdn.prod.website-files.com/645ec08251dadc9000a072e5/a b (1).png",
    );
    expect(urlToLocal("https://d3e54v103j8qbb.cloudfront.net/js/jquery.min.js?site=1")).toMatch(
      /^files\/d3e54v103j8qbb\.cloudfront\.net\/js\/jquery\.min\.q[0-9a-f]{8}\.js$/,
    );
    expect(urlToLocal("https://fonts.googleapis.com/css?family=Lato")).toMatch(
      /^files\/fonts\.googleapis\.com\/css\.q[0-9a-f]{8}\.css$/,
    );
    expect(urlToLocal("https://fonts.googleapis.com/css?family=Lato")).not.toBe(
      urlToLocal("https://fonts.googleapis.com/css?family=Jost"),
    );
  });

  it("puts pages at <path>/index.html", () => {
    expect(pageToLocal("/")).toBe("pages/index.html");
    expect(pageToLocal("/projects/pv-malaga-cove/")).toBe(
      "pages/projects/pv-malaga-cove/index.html",
    );
  });
});

describe("checkCapture", () => {
  const SITE = "645ec08251dadc9000a072e5";
  let dir: string;
  const files: Record<string, string> = {};

  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };

  function build(opts: { pages?: Record<string, string> } = {}) {
    const pages = opts.pages ?? {
      "/": `<html data-wf-site="${SITE}"><link href="${CDN}/s.css" rel="stylesheet"/><a href="/about">x</a>
        <img src="${CDN}/p.jpg" srcset="${CDN}/p-p-500.jpg 500w, ${CDN}/p.jpg 900w"/>
        <script src="https://www.google.com/recaptcha/api.js"></script></html>`,
      "/about": `<html data-wf-site="${SITE}"><a href="/">home</a><div data-src="${CDN}/a.json"></div></html>`,
    };
    const fileBodies: Record<string, string> = {
      [`${CDN}/s.css`]: `x{background:url("${CDN}/bg (1).jpg")}`,
      [`${CDN}/bg%20(1).jpg`]: "bg",
      [`${CDN}/p.jpg`]: "p",
      [`${CDN}/p-p-500.jpg`]: "p500",
      [`${CDN}/a.json`]: JSON.stringify({ assets: [] }),
    };
    const manifest = {
      ref: "https://www.example-wf.com",
      siteId: SITE,
      pages: Object.entries(pages).map(([path, html]) => {
        write(pageToLocal(path), html);
        return { path, file: pageToLocal(path), sha256: sha256(html) };
      }),
      files: Object.entries(fileBodies).map(([url, body]) => {
        const file = urlToLocal(url);
        files[url] = file;
        write(file, body);
        return { url, file, sha256: sha256(body) };
      }),
    };
    write("manifest.json", JSON.stringify(manifest));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wf-capture-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("passes a whole capture, counting the reCAPTCHA script as excluded, not present", () => {
    build();
    const r = checkCapture(dir, { expectPages: 2 });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.present).toBe(5);
    expect(r.excluded.map((e) => e.url)).toEqual(["https://www.google.com/recaptcha/api.js"]);
  });

  it("fails naming a deleted page asset", () => {
    build();
    unlinkSync(join(dir, files[`${CDN}/p-p-500.jpg`]!));
    const r = checkCapture(dir);
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringContaining(`missing: ${CDN}/p-p-500.jpg`)]);
  });

  it("fails naming a deleted file that only a stylesheet references", () => {
    build();
    unlinkSync(join(dir, files[`${CDN}/bg%20(1).jpg`]!));
    const r = checkCapture(dir);
    expect(r.failures).toEqual([expect.stringContaining(`missing: ${CDN}/bg%20(1).jpg`)]);
  });

  it("fails an empty file, a changed file and a file the manifest never recorded", () => {
    build();
    writeFileSync(join(dir, files[`${CDN}/p.jpg`]!), "");
    writeFileSync(join(dir, files[`${CDN}/a.json`]!), JSON.stringify({ assets: [], v: 2 }));
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    m.files = m.files.filter((f: { url: string }) => f.url !== `${CDN}/s.css`);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
    const f = checkCapture(dir).failures.join("\n");
    expect(f).toContain(`missing: ${CDN}/p.jpg`);
    expect(f).toContain(`changed: ${files[`${CDN}/a.json`]}`);
    expect(f).toContain(`unrecorded: ${files[`${CDN}/s.css`]}`);
  });

  it("fails a page link that was not captured, and a wrong page count", () => {
    build({
      pages: { "/": `<html data-wf-site="${SITE}"><a href="/projects">p</a></html>` },
    });
    const f = checkCapture(dir, { expectPages: 10 }).failures;
    expect(f).toContain("page / links to /projects, which was not captured");
    expect(f).toContain("1 pages captured, expected 10");
  });

  it("fails a page that does not carry the site id", () => {
    build({ pages: { "/": `<html data-wf-site="somethingelse"></html>` } });
    expect(checkCapture(dir).failures).toEqual([
      `page / does not carry data-wf-site="${SITE}": not the reference`,
    ]);
  });
});
