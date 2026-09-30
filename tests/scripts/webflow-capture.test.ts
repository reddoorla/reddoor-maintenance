import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { spawnSync } from "node:child_process";
import {
  exclusionFor,
  extractFromCss,
  extractFromHtml,
  extractFromJs,
  extractFromLottie,
  extractPageLinks,
  pageToLocal,
  paginationLinks,
  pathConflict,
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

describe("review round 1: reference forms a check must not skip", () => {
  it("reads single-quoted attributes, a `>` inside alt, svg <image>, <object>, relative og:image and imagesrcset", () => {
    const html = `
      <img alt="a > b" src="${CDN}/alt.jpg"/>
      <img srcset='${CDN}/q-p-500.jpg 500w, ${CDN}/q.jpg 900w'/>
      <div style='background-image:url(${CDN}/sq.jpg)' data-src='${CDN}/sq.json'></div>
      <div data-video-urls='${CDN}/v2.mp4,${CDN}/v2.webm'></div>
      <svg><image href="${CDN}/svgimg.png"/></svg>
      <object data="${CDN}/doc.pdf"></object>
      <meta property="og:image" content="/og.jpg"/>
      <meta name="description" content="A site about homes"/>
      <link rel="preload" as="image" imagesrcset="${CDN}/pre-p-500.jpg 500w, ${CDN}/pre.jpg 900w"/>`;
    expect(urls(extractFromHtml(html, PAGE))).toEqual(
      expect.arrayContaining([
        `${CDN}/alt.jpg`,
        `${CDN}/q-p-500.jpg`,
        `${CDN}/q.jpg`,
        `${CDN}/sq.jpg`,
        `${CDN}/sq.json`,
        `${CDN}/v2.mp4`,
        `${CDN}/v2.webm`,
        `${CDN}/svgimg.png`,
        `${CDN}/doc.pdf`,
        "https://www.example-wf.com/og.jpg",
        `${CDN}/pre-p-500.jpg`,
        `${CDN}/pre.jpg`,
      ]),
    );
  });

  it("keeps a script URL whose filename has parentheses or a comma, and reads escaped slashes", () => {
    const html = `<script type="application/json" class="w-json">{"items":[
      {"url":"${CDN}/zz_Untitled%20design%20(16).png"},{"url":"https:\\/\\/cdn.x.com\\/zz_a,b.jpg"}]}</script>
      <script>load("${CDN}/anim.lottie")</script>`;
    expect(urls(extractFromHtml(html, PAGE))).toEqual(
      expect.arrayContaining([
        `${CDN}/zz_Untitled%20design%20(16).png`,
        "https://cdn.x.com/zz_a,b.jpg",
        `${CDN}/anim.lottie`,
      ]),
    );
  });

  it("does not throw on a bare % in a filename", () => {
    expect(urlToLocal(`${CDN}/zz_50%off.jpg`)).toBe(
      "files/cdn.prod.website-files.com/645ec08251dadc9000a072e5/zz_50%off.jpg",
    );
  });

  it("splits a srcset of relative candidates with no space after the comma", () => {
    expect(urls(extractFromHtml(`<img srcset="a/r1.jpg 1x,a/r2.jpg 2x"/>`, PAGE))).toEqual([
      "https://www.example-wf.com/a/r1.jpg",
      "https://www.example-wf.com/a/r2.jpg",
    ]);
  });

  it("counts an absolute link to the apex as a page of the www site", () => {
    expect(extractPageLinks(`<a href="https://example-wf.com/secret">s</a>`, PAGE)).toEqual([
      "/secret",
    ]);
  });
});

describe("review round 2: the round-1 fixes must not lose references", () => {
  it("reads the tags after an inline script whose code has `<` and a comment with an apostrophe", () => {
    const html = `<script>for(var i=0;i<a.length;i++){} // don't</script>
      <nav><a href="/about">a</a><a href="/work">w</a><a href="/contact">c</a><a href="/blog?c2b1_page=2">n</a></nav>
      <div style="background:url(${CDN}/one.jpg)"></div><div style="background:url(${CDN}/two.jpg)"></div>
      <p>We're here</p>`;
    expect(extractPageLinks(html, PAGE)).toEqual(["/about", "/blog", "/contact", "/work"]);
    expect(paginationLinks(html, PAGE)).toEqual(["https://www.example-wf.com/blog?c2b1_page=2"]);
    expect(urls(extractFromHtml(html, PAGE))).toEqual(
      expect.arrayContaining([`${CDN}/one.jpg`, `${CDN}/two.jpg`]),
    );
  });

  it("finds both files of url(a),url(b) and a file loaded as f(a.js);g() in script code", () => {
    const js = `el.style.background="url(https://cdn.x.com/a.png),url(https://cdn.x.com/b.png)"; loadScript(https://cdn.x.com/a.js);init()`;
    expect(urls(extractFromJs(js, "https://x.com/"))).toEqual([
      "https://cdn.x.com/a.png",
      "https://cdn.x.com/b.png",
      "https://cdn.x.com/a.js",
    ]);
  });

  it("keeps a comma inside a srcset URL", () => {
    expect(
      urls(
        extractFromHtml(
          `<img srcset="https://c.com/a,b-p-500.jpg 500w, https://c.com/c.jpg 800w"/>`,
          PAGE,
        ),
      ),
    ).toEqual(["https://c.com/a,b-p-500.jpg", "https://c.com/c.jpg"]);
  });
});

describe("review round 3: references and paths the round-2 code lost or misplaced", () => {
  it("reads the tags after a `<!--` inside an inline script string", () => {
    const html = `<script>var s="<!--";</script><img src="/lost.png"><a href="/kept">k</a><!-- c -->`;
    expect(urls(extractFromHtml(html, PAGE))).toContain("https://www.example-wf.com/lost.png");
    expect(extractPageLinks(html, PAGE)).toEqual(["/kept"]);
  });

  it("reads an attribute by its own name, not by text inside another attribute's value", () => {
    expect(urls(extractFromHtml(`<img alt="see src=x.png here" src="/real.png">`, PAGE))).toEqual([
      "https://www.example-wf.com/real.png",
    ]);
    expect(extractPageLinks(`<a title="a href=/wrong b" href="/right">r</a>`, PAGE)).toEqual([
      "/right",
    ]);
  });

  it("reads image-set() sources and an upper-case URL()", () => {
    const css = `.a{background-image:-webkit-image-set("hero.png" 1x,'hero@2x.png' 2x)} .b{background:URL(up.png)} .c{background:image-set(url(set.png) 1x)}`;
    expect(urls(extractFromCss(css, `${CDN}/css/s.css`)).sort()).toEqual(
      [
        `${CDN}/css/hero.png`,
        `${CDN}/css/hero@2x.png`,
        `${CDN}/css/set.png`,
        `${CDN}/css/up.png`,
      ].sort(),
    );
  });

  it("finds a protocol-relative runtime load in an inline script and in a script file", () => {
    expect(
      urls(
        extractFromHtml(`<script>$.getScript("//cdn.jsdelivr.net/npm/x/x.min.js")</script>`, PAGE),
      ),
    ).toEqual(["https://cdn.jsdelivr.net/npm/x/x.min.js"]);
    expect(
      urls(
        extractFromJs(
          `load('//cdn.x.com/a.js'); // see //example.com/notes`,
          "https://s.com/app.js",
        ),
      ),
    ).toEqual(["https://cdn.x.com/a.js"]);
  });

  it("keeps each file under its capture directory, whatever a percent-encoded path decodes to", () => {
    const inside = (local: string, top: string) =>
      normalize(join("cap", local)).startsWith(join("cap", top) + "/") &&
      !local.split("/").some((s) => s === ".." || s === ".");
    for (const u of [
      "https://cdn.example.com/a/..%2F..%2F..%2F..%2Fescape.js",
      "https://cdn.example.com/%2E%2E%2Fx.png",
      "https://cdn.example.com/a%2F..%2F..%2Fb/c.png",
      "https://cdn.example.com/a%5C..%5C..%5Cd.png",
    ])
      expect(inside(urlToLocal(u), "files/cdn.example.com"), `${u} -> ${urlToLocal(u)}`).toBe(true);
    for (const p of ["/a%2F..%2F..%2F..%2Fp", "/%2E%2E%2F%2E%2E%2Fq"])
      expect(inside(pageToLocal(p), "pages"), `${p} -> ${pageToLocal(p)}`).toBe(true);
    expect(pageToLocal("/a%2Fb")).not.toBe(pageToLocal("/a/b"));
  });

  it("names a path that collides with another, by case or as a file under a file", () => {
    const claimed = new Map<string, string>();
    expect(pathConflict(claimed, "files/h/img", "https://h/img")).toBeNull();
    expect(pathConflict(claimed, "files/h/img/x.png", "https://h/img/x.png")).toBe("https://h/img");
    expect(pathConflict(claimed, "files/h/IMG", "https://h/IMG")).toBe("https://h/img");
    expect(pathConflict(claimed, "files/h/img", "https://h/img")).toBeNull();
    expect(pathConflict(claimed, "files/h/img", "http://h/img")).toBeNull();
    expect(pathConflict(claimed, "files/h/a/b.png", "https://h/a/b.png")).toBeNull();
    expect(pathConflict(claimed, "files/h/a", "https://h/a")).toBe("https://h/a/b.png");
  });

  it("excludes only the Adobe Fonts faces, never a kit whose id starts with af", () => {
    expect(exclusionFor("https://use.typekit.net/af/442215/0000/27/")).toMatch(/licensed/);
    expect(exclusionFor("https://use.typekit.net/afx3kdq.css")).toBeNull();
    expect(exclusionFor("https://use.typekit.net/afx3kdq.js")).toBeNull();
    expect(exclusionFor("https://use.typekit.net/htt1asl.js")).toBeNull();
    expect(exclusionFor("https://use.typekit.net/htt1asl.css")).toBeNull();
  });
});

describe("review round 3: extractor behaviour the earlier tests did not bind", () => {
  it("reads <style> blocks, media sources and posters, apple-touch-icon and svg xlink:href", () => {
    const html = `<style>.h{background:url(${CDN}/styleblock.jpg)}</style>
      <video poster="${CDN}/vposter.jpg"><source src="${CDN}/clip.mp4"><track src="${CDN}/subs.vtt.txt"></video>
      <audio src="${CDN}/a.mp3"></audio><embed src="${CDN}/e.pdf"><input type="image" src="${CDN}/btn.png">
      <link rel="apple-touch-icon" href="${CDN}/touch.png">
      <svg><image xlink:href="${CDN}/xl.png"/></svg>`;
    expect(urls(extractFromHtml(html, PAGE)).sort()).toEqual(
      [
        `${CDN}/styleblock.jpg`,
        `${CDN}/vposter.jpg`,
        `${CDN}/clip.mp4`,
        `${CDN}/subs.vtt.txt`,
        `${CDN}/a.mp3`,
        `${CDN}/e.pdf`,
        `${CDN}/btn.png`,
        `${CDN}/touch.png`,
        `${CDN}/xl.png`,
      ].sort(),
    );
  });

  it("reads single-quoted url('…') and @import '…'", () => {
    expect(
      urls(extractFromCss(`a{background:url('sq.png')} @import 'more.css';`, `${CDN}/css/s.css`)),
    ).toEqual([`${CDN}/css/sq.png`, `${CDN}/css/more.css`]);
  });

  it("cuts a script URL at an unbalanced `)` and trims a sentence's full stop", () => {
    expect(urls(extractFromJs("load(https://cdn.x.com/a.js?v=1)", "https://x.com/"))).toEqual([
      "https://cdn.x.com/a.js?v=1",
    ]);
    expect(urls(extractFromJs("see https://cdn.x.com/guide.pdf. Then", "https://x.com/"))).toEqual([
      "https://cdn.x.com/guide.pdf",
    ]);
  });

  it("keeps same-origin files and commented-out links out of the page list", () => {
    expect(
      extractPageLinks(
        `<a href="/doc.pdf">d</a><!-- <a href="/old">o</a> --><a href="/new">n</a>`,
        PAGE,
      ),
    ).toEqual(["/new"]);
  });

  it("decodes &amp; and &#39; in attribute values", () => {
    expect(
      urls(
        extractFromHtml(
          `<img src="/a.jpg?x=1&amp;y=2"><div style="background:url(&#39;/b.jpg&#39;)"></div>`,
          PAGE,
        ),
      ),
    ).toEqual(["https://www.example-wf.com/a.jpg?x=1&y=2", "https://www.example-wf.com/b.jpg"]);
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

  function build(
    opts: { pages?: Record<string, string>; extraFiles?: Record<string, string> } = {},
  ) {
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
      ...opts.extraFiles,
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

  it("fails a page whose bytes were cut short, even though its site id survives", () => {
    build();
    const home = join(dir, pageToLocal("/"));
    const html = readFileSync(home, "utf8");
    writeFileSync(home, html.slice(0, html.indexOf("<img")));
    expect(checkCapture(dir).failures).toContain(
      "changed: pages/index.html does not match its manifest sha256",
    );
  });

  it("fails when the capture itself recorded a failed download or page", () => {
    build();
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    m.failed = [{ url: `${CDN}/gone.jpg`, status: 404, note: "0 bytes" }];
    m.pageFailures = ["/old: 404"];
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
    const f = checkCapture(dir).failures;
    expect(f).toContain(`capture recorded a failure: ${CDN}/gone.jpg 404 0 bytes`);
    expect(f).toContain("capture recorded a page failure: /old: 404");
  });

  it("fails two references that map to one file", () => {
    build({
      pages: {
        "/": `<html data-wf-site="${SITE}"><img src="${CDN}/p.jpg"/><img src="${CDN}/p.jpg?v=1"/><img src="${CDN}/x%3Fy.jpg"/><img src="${CDN}/x_y.jpg"/></html>`,
      },
    });
    writeFileSync(join(dir, urlToLocal(`${CDN}/x_y.jpg`)), "xy");
    const f = checkCapture(dir).failures.join("\n");
    expect(f).toMatch(
      /collision: .*x_y\.jpg and .*x%3Fy\.jpg|collision: .*x%3Fy\.jpg and .*x_y\.jpg/,
    );
  });

  it("fails a page that paginates a collection list", () => {
    build({
      pages: {
        "/": `<html data-wf-site="${SITE}"><a href="?a1b2c3_page=2" class="w-pagination-next">Next</a></html>`,
      },
    });
    expect(checkCapture(dir).failures).toEqual([
      "page / paginates (https://www.example-wf.com/?a1b2c3_page=2): list pages beyond the first are not captured",
    ]);
  });

  it("fails a page that does not carry the site id", () => {
    build({ pages: { "/": `<html data-wf-site="somethingelse"></html>` } });
    expect(checkCapture(dir).failures).toEqual([
      `page / does not carry data-wf-site="${SITE}": not the reference`,
    ]);
  });

  const editManifest = (f: (m: Record<string, unknown>) => void) => {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    f(m);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
  };

  it("fails a page file that was deleted", () => {
    build();
    unlinkSync(join(dir, pageToLocal("/about")));
    expect(checkCapture(dir).failures).toContain("page /about is missing: pages/about/index.html");
  });

  it("fails a capture with no pages, or without the crawl root", () => {
    build();
    editManifest((m) => {
      m.pages = [];
    });
    expect(checkCapture(dir).ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "wf-capture-"));
    build({ pages: { "/about": `<html data-wf-site="${SITE}"></html>` } });
    expect(checkCapture(dir).failures).toEqual([
      "manifest.json has no page /: the crawl root was not captured",
    ]);
  });

  it("fails a manifest without a site id", () => {
    build();
    editManifest((m) => {
      delete m.siteId;
    });
    expect(checkCapture(dir).failures).toContain(
      "manifest.json has no siteId: nothing proves these pages are the reference",
    );
  });

  it("fails more pages than expected, not only fewer", () => {
    build();
    expect(checkCapture(dir, { expectPages: 1 }).failures).toEqual([
      "2 pages captured, expected 1",
    ]);
  });

  it("follows a Google Fonts stylesheet to its font files", () => {
    const css = "https://fonts.googleapis.com/css?family=Jost:300";
    const woff = "https://fonts.gstatic.com/s/jost/v20/a.woff2";
    build({
      pages: {
        "/": `<html data-wf-site="${SITE}"><link href="${css}" rel="stylesheet"/></html>`,
      },
      extraFiles: { [css]: `@font-face{src:url(${woff}) format('woff2')}`, [woff]: "w" },
    });
    expect(checkCapture(dir).failures).toEqual([]);
    unlinkSync(join(dir, urlToLocal(woff)));
    expect(checkCapture(dir).failures).toEqual([expect.stringContaining(`missing: ${woff}`)]);
  });

  it("passes a file referenced from a page and again from a stylesheet", () => {
    build({
      extraFiles: {
        [`${CDN}/s.css`]: `x{background:url("${CDN}/bg (1).jpg")} y{background:url(${CDN}/p.jpg)}`,
      },
    });
    expect(checkCapture(dir, { expectPages: 2 }).failures).toEqual([]);
  });

  it("counts an http and an https reference to one file as that file, not a collision", () => {
    build({
      pages: {
        "/": `<html data-wf-site="${SITE}"><img src="${CDN}/p.jpg"/><img src="${CDN.replace("https:", "http:")}/p.jpg"/></html>`,
      },
    });
    expect(checkCapture(dir).failures).toEqual([]);
  });

  it("fails two pages that map to one page file", () => {
    build({
      pages: {
        "/": `<html data-wf-site="${SITE}"><a href="/x_y">a</a><a href="/x:y">b</a></html>`,
        "/x_y": `<html data-wf-site="${SITE}"><a href="/">h</a></html>`,
        "/x:y": `<html data-wf-site="${SITE}"><a href="/">h</a></html>`,
      },
    });
    expect(checkCapture(dir).failures.join("\n")).toMatch(
      /collision: page \/x:y and \/x_y both map to pages\/x_y\/index\.html|collision: page \/x_y and \/x:y/,
    );
  });

  it("exits 0 on a whole capture, 1 on a gap and 2 on a bad page count", () => {
    build();
    const run = (...a: string[]) =>
      spawnSync(process.execPath, ["scripts/webflow-capture/check.mjs", dir, ...a], {
        encoding: "utf8",
      }).status;
    expect(run("--expect-pages", "2")).toBe(0);
    expect(run("--expect-pages", "3")).toBe(1);
    expect(run("--expect-pages", "two")).toBe(2);
    unlinkSync(join(dir, files[`${CDN}/p.jpg`]!));
    expect(run()).toBe(1);
  });
});
