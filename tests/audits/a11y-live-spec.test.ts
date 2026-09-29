import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { a11yAudit } from "../../src/audits/a11y.js";
import { defaultSpawn, type SpawnFn } from "../../src/audits/util/spawn.js";
import type { AuditResult } from "../../src/types.js";

/**
 * THE GENERATED SPEC, RUN FOR REAL.
 *
 * Every test in a11y.test.ts reads the spec the audit writes as a string, or
 * fakes the artifact it produces. None of them can see what the spec does in a
 * browser, and the two defects this file exists for were both invisible to a
 * string:
 *
 *   - #100: the spec never scrolled, so a `use:animateIn`-style reveal below
 *     the fold was still at `opacity: 0` when axe ran. axe does not measure
 *     contrast through that, so the text fell out of the result. The gate
 *     stayed green and measured less.
 *   - #52: axe's CSSOM preload re-fetches every cross-origin stylesheet with an
 *     XHR, and a site whose CSP allows that origin in `style-src` but not in
 *     `connect-src` (Google Fonts, on roalson-interests) got a real
 *     `connect-src` report posted on every audit.
 *
 * So this builds a throwaway site whose `vite:dev` is a small Node server,
 * serves a page carrying both conditions, and runs the audit with its real
 * spawn. The one substitution is `npx --yes playwright` → this repo's own
 * Playwright CLI: npx would resolve from the throwaway site, and the spec and
 * config it writes import `@playwright/test` and `@axe-core/playwright` from
 * the site's `node_modules`, which is a symlink to this repo's.
 */

const REPO_NODE_MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url));
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");

/** livePlaywright with a tighter spawn budget than the audit's 5 minutes, for a
 *  site whose failure mode is a hang: it must fail in seconds, not minutes. */
const livePlaywrightWithin =
  (timeoutMs: number): SpawnFn =>
  (cmd, args, opts) =>
    livePlaywright(cmd, args, { ...opts, timeoutMs });

const livePlaywright: SpawnFn = (cmd, args, opts) => {
  // Refuse anything but the one command this substitutes for, so a change to
  // how the audit launches Playwright fails here by name instead of running
  // something else.
  if (cmd !== "npx" || args[0] !== "--yes" || args[1] !== "playwright") {
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  }
  // --retries=0: this spec is MEANT to find violations, so its closing
  // expect() fails, and under CI the generated config retries twice.
  return defaultSpawn(
    process.execPath,
    [PLAYWRIGHT_CLI, ...args.slice(2), "--retries=0", "--workers=1"],
    opts,
  );
};

function plainPage(title: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1></main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

/**
 * Two routes that sit next to each other in the audit, for the error labels:
 *
 *   - `/dev/animate-in` throws 3 s after load. Its own iteration takes well
 *     under a second, so without a step between routes the error fires while
 *     the NEXT route is loading, and is charged to it.
 *   - `/late-b`, which comes next, is held 4 s by the server — the window in
 *     which that late error would land — and throws on load itself. Its own
 *     error is thrown outside the reveal pass, so it must carry no label.
 */
const LATE_THROW_PAGE = plainPage(
  "Animate-in",
  `setTimeout(() => { throw new Error("fixture: thrown 3 s after load, by the previous route"); }, 3000);`,
);
const THROWS_ON_LOAD_PAGE = plainPage(
  "Throws on load",
  `throw new Error("fixture: thrown on load");`,
);

/**
 * The page under audit, served by `serverSource` below from two origins: the page on
 * the port Playwright hands `vite:dev`, and a second one (`CROSS_ORIGIN`)
 * standing in for fonts.googleapis.com.
 *
 * The page's CSP has roalson-interests' shape: the stylesheet origin is in
 * `style-src` and absent from `connect-src`. `img-src 'self'` also blocks the
 * canary image, whose report proves the report channel is live — without it,
 * "no connect-src report" could mean reports never arrive at all.
 *
 * The two reveals sit at positions in `vh`, so they hold at any viewport:
 *
 *   - `#below-fold` at 130vh, revealed on first intersection (threshold 0) —
 *     the #100 case exactly.
 *   - `#gap-band`, 10vh tall at 180vh, observed with a -25% bottom margin. A
 *     whole-viewport step stops at 100vh and 200vh, whose observed bands are
 *     100–175vh and 200–275vh, so it never reveals; a half step at 150vh
 *     observes 150–225vh and does.
 *
 * Both reveals hold `#aaa` text on white (2.32:1), so a `color-contrast`
 * violation naming them exists only if axe measured them revealed.
 *
 * Three more are about the settle. Each ENDS failing contrast, so a hit is
 * positive evidence that the pass waited:
 *
 *   - `#waapi` at 250vh animates its text's colour #111 → #aaa over 2 s on the
 *     Web Animations API, `fill: forwards`. Measured early, it passes.
 *   - `#top-fade`, near the top, starts the same kind of animation when the
 *     page comes BACK to the top after being scrolled — so only a settle that
 *     runs after the return waits for it.
 *   - `#spinner` runs an infinite animation. It must not be waited on: the
 *     pass must still report `unsettled: 0` here.
 *
 * (The delayed two-stage intro lives alone on `/delayed`; see DELAYED_PAGE.)
 *
 * And two about the pass itself:
 *
 *   - `#bar-text` is fixed to the viewport and legible (#111) only while the
 *     page is scrolled; at the top it is #aaa. So it fails contrast only if axe
 *     runs back at the top.
 *   - `#grow`, a marker at 390vh, lengthens the page from 400vh to 600vh the
 *     first time it is seen, and shows `#grown` at 560vh, itself a reveal. A
 *     pass that read the height once would stop near 400vh and never see it.
 *
 * `#throws` at 150vh throws from its IntersectionObserver callback, so the
 * error happens only because the pass scrolled to it, and must be labelled so.
 *
 * (The frame fixtures live on `/frames`; see FRAMES_PAGE.)
 *
 * `#outside-landmarks` fails axe's `region` rule, which is tagged
 * `best-practice` only. The gate asks for WCAG tags, so it must never appear;
 * if it does, the tag filter was lost. `AxeBuilder.options()` REPLACES the
 * options object `withTags()` writes into, so the wrong call order drops the
 * filter silently and axe runs every rule it has.
 */
const FIXTURE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reveal fixture</title>
<link rel="stylesheet" href="CROSS_ORIGIN/fonts.css">
<style>
  html { scroll-behavior: smooth; }
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { position: relative; height: 400vh; }
  .reveal { position: absolute; left: 0; right: 0; margin: 0; }
  .faint { color: #aaa; margin: 0; }
  #below-fold { top: 130vh; }
  #gap-band { top: 180vh; height: 10vh; }
  #throws { top: 150vh; height: 1px; }
  #waapi { top: 250vh; }
  #spinner { width: 8px; height: 8px; }
  #grow { top: 390vh; height: 1px; }
  #grown { top: 560vh; }
  #bar { position: fixed; right: 0; bottom: 0; background: #fff; padding: 4px; }
  #bar-text { color: #aaa; margin: 0; }
  #bar.scrolled #bar-text { color: #111; }
</style>
</head>
<body>
<main>
  <h1>Reveal fixture</h1>
  <img src="CROSS_ORIGIN/canary.png" alt="">
  <p id="top-fade">Greys out when the page comes back to the top</p>
  <div id="spinner" aria-hidden="true"></div>
  <div class="reveal" id="below-fold"><p class="faint" id="below-fold-text">Revealed once scrolled to</p></div>
  <div class="reveal" id="gap-band"><p class="faint" id="gap-band-text">Revealed in the top three quarters of the viewport</p></div>
  <div class="reveal" id="throws"></div>
  <div class="reveal" id="waapi"><p id="waapi-text">Fades to a failing grey over two seconds</p></div>
  <div class="reveal" id="grow"></div>
  <div class="reveal" id="grown" hidden><p class="faint" id="grown-text">Only exists once the page has grown</p></div>
  <div id="bar"><p id="bar-text">Legible only while scrolled</p></div>
</main>
<div id="outside-landmarks">Outside every landmark</div>
<script>
  for (const [id, rootMargin] of [["below-fold", "0px"], ["gap-band", "0px 0px -25% 0px"]]) {
    const el = document.getElementById(id);
    el.style.opacity = "0";
    el.style.transition = "opacity 2400ms";
    new IntersectionObserver((entries, observer) => {
      if (entries[0].isIntersecting) {
        el.style.opacity = "1";
        observer.disconnect();
      }
    }, { threshold: 0, rootMargin }).observe(el);
  }
  const toGrey = [{ color: "#111" }, { color: "#aaa" }];
  const onFirstSight = (id, reveal) => {
    const el = document.getElementById(id);
    el.style.opacity = "0";
    new IntersectionObserver((entries, observer) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        el.style.opacity = "1";
        reveal(el);
      }
    }, { threshold: 0 }).observe(el);
  };
  onFirstSight("waapi", () => {
    document.getElementById("waapi-text").animate(toGrey, { duration: 2000, fill: "forwards" });
  });
  onFirstSight("grow", () => {
    document.querySelector("main").style.height = "600vh";
    document.getElementById("grown").hidden = false;
  });
  onFirstSight("grown", () => {});
  onFirstSight("throws", () => {
    throw new Error("fixture: a reveal callback threw");
  });
  addEventListener("scroll", () => {
    document.getElementById("bar").classList.toggle("scrolled", scrollY > 0);
  });
  let scrolledAway = false;
  addEventListener("scroll", () => {
    if (scrollY > 0) {
      scrolledAway = true;
    } else if (scrolledAway) {
      scrolledAway = false;
      document.getElementById("top-fade").animate(toGrey, { duration: 1500, fill: "forwards" });
    }
  });
  document.getElementById("spinner").animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 1000, iterations: Infinity },
  );
</script>
</body>
</html>`;

/** A third party's document: `<title>`, one body, nothing else. */
function thirdPartyPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

/** Documents the second origin serves, by path. */
const CROSS_PAGES: Record<string, string> = {
  // One image-alt failure, which is the third party's, not the site's.
  "/frame.html": thirdPartyPage("Embed", `<img src="/tile.png">`),
  // Something focusable, inside a frame the site gave tabindex="-1".
  "/player.html": thirdPartyPage("Player", `<button type="button">Play</button>`),
  // Text on a colour axe cannot parse (#888), inside a third party's document:
  // not the site's to fix, so it must be counted, not failed.
  "/unparseable.html": thirdPartyPage(
    "Widget",
    `<p style="background-color: oklch(0.205 0 none); color: #3a3a3a">A sentence long enough that axe will actually judge its contrast.</p>`,
  ),
  // A third party's document on which axe's color-contrast rule THROWS (#888's
  // whole-page shape, inside the embed): a white button in a band of a colour
  // axe cannot parse. The crash is the third party's, so it is counted, and
  // it must not cost the site the contrast results axe produced for it.
  "/crash.html": thirdPartyPage(
    "Booking widget",
    `<section style="position: relative; isolation: isolate; padding: 16px; background-color: oklch(0.205 0 none); color: #fff"><p>Widget copy long enough that axe will actually judge its contrast.</p><a href="#book" style="display: inline-block; padding: 8px; background: #fff; color: #000">Book</a></section>`,
  ),
  // A third party's script that throws as soon as it loads.
  "/throws.html": thirdPartyPage(
    "Widget",
    `<p>Widget</p><script>throw new Error("fixture: a third-party embed threw");</script>`,
  ),
  // A library the SITE loads into its own document, from another origin (the
  // shape of Vimeo's player.js, Turnstile's api.js, Google Maps). It throws,
  // and rejects, when the site calls it badly.
  "/lib.js": `window.fixtureLib = {
    render(el) { if (!el) throw new Error("fixture: lib.render was given no element"); },
    load() { return Promise.reject(new Error("fixture: lib.load rejected")); },
  };`,
};

/**
 * A site crashing inside a library it loaded from another origin. Both errors'
 * stacks START on the library's origin, and both are the site's crash: the
 * site called the library with nothing to render into. They must stay
 * `client-error`s and fail. The page also frames a document from the SAME
 * origin as the library — Vimeo serves both `player.js` and its player iframe
 * from player.vimeo.com — so "the stack's origin matches a cross-origin frame
 * on the page" is on offer here, and must not be taken as evidence.
 */
const LIB_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Library</title>
<script src="CROSS_ORIGIN/lib.js"></script></head>
<body><main><h1>Library</h1>
<iframe title="Player" src="CROSS_ORIGIN/player.html"></iframe></main>
<script>
  fixtureLib.load();
  fixtureLib.render(null);
</script>
</body>
</html>`;

/**
 * The library's REJECTION alone, beside the same Vimeo-shaped frame. A
 * rejection in a cross-origin script is hidden from the page completely — no
 * `unhandledrejection` fires, so no log entry exists — which means nothing
 * short-circuits this route: only the rule that an error needs a matching
 * entry in a cross-origin frame's own log keeps it the site's. A fallback that
 * moved an error because its stack starts on the embed's origin would move it.
 */
const LIB_REJECT_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Library rejection</title>
<script src="CROSS_ORIGIN/lib.js"></script></head>
<body><main><h1>Library rejection</h1>
<iframe title="Player" src="CROSS_ORIGIN/player.html"></iframe></main>
<script>
  fixtureLib.load();
</script>
</body>
</html>`;

/**
 * Every shape of frame the node filter has to decide, on one page:
 *
 *   - `#xo-tab`: eager, cross-origin, `tabindex="-1"`, with a button inside —
 *     the site's own defect, `frame-focusable-content` (serious, WCAG 2.1.1),
 *     which axe sees only from inside the frame. Must be KEPT.
 *   - `#so-frame`: the site's own same-origin page, with an unnamed button
 *     (`button-name`). Must be KEPT. It also throws on load: an error in the
 *     site's own child frame is the site's, and must fail.
 *   - `#facade`: a lazy-video facade — `src` on the third party, but a
 *     `srcdoc` of the site's markup, which is what actually loads. Its `<img>`
 *     has no `alt`. Must be KEPT. It throws too, and that is the site's error.
 *   - `#redir`: a same-origin `src` that 302s to the third party. DROPPED.
 *   - `#wrap`: a same-origin wrapper page holding a third-party frame. The
 *     inner frame's `image-alt` is DROPPED.
 *   - a third-party frame inside `#host`'s shadow root. DROPPED.
 *   - `#xo-frame`: lazy, title-less, third-party, at 1000vh — beyond the
 *     lazy-frame load distance, so only the reveal pass loads it. Its
 *     `image-alt` is DROPPED; the `<iframe>` element's own missing title is
 *     the site's and is KEPT (`frame-title`).
 *
 * The four drops are counted, and that count is also the proof that axe
 * reached each third-party document at all.
 */
const FRAMES_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Frames</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { position: relative; height: 1100vh; }
  iframe { width: 300px; height: 150px; border: 0; }
  #xo-frame { position: absolute; top: 1000vh; left: 0; }
</style></head>
<body><main><h1>Frames</h1>
<iframe id="xo-tab" tabindex="-1" title="Player" src="CROSS_ORIGIN/player.html"></iframe>
<iframe id="so-frame" title="Own page" src="/own-frame"></iframe>
<iframe id="facade" title="Video" src="CROSS_ORIGIN/frame.html" srcdoc="<img src='/thumb.png'><script>throw new Error('fixture: the srcdoc facade threw')</script>"></iframe>
<iframe id="redir" title="Redirected embed" src="/go-embed"></iframe>
<iframe id="wrap" title="Wrapper" src="/wrapper"></iframe>
<div id="host"></div>
<iframe id="xo-frame" loading="lazy" src="CROSS_ORIGIN/frame.html"></iframe>
</main>
<script>
  document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
    '<iframe id="shadow-frame" title="Shadowed embed" src="CROSS_ORIGIN/frame.html"></iframe>';
</script>
</body>
</html>`;

/** The site's own page, framed by `#so-frame`: one unnamed button, and a throw. */
const OWN_FRAME_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Own</title></head><body><main><button type="button"></button></main><script>throw new Error("fixture: the site's own frame threw");</script></body></html>`;

/** The site's own wrapper page, framing a third party's document. */
const WRAPPER_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wrapper</title></head><body><main><iframe title="Inner embed" src="CROSS_ORIGIN/frame.html"></iframe></main></body></html>`;

/**
 * A page whose only content below the fold is a lazy third-party embed, at
 * 1000vh — 7200px in the audit's 720px viewport, beyond Chromium's lazy-frame
 * load distance, so it does not load until the reveal pass scrolls to it. Its
 * script throws on load. On main that embed never loaded under the gate; here
 * it does, and its error must be named, not failed on the site.
 */
const THIRD_PARTY_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Embed below the fold</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { position: relative; height: 1100vh; }
  #widget { position: absolute; top: 1000vh; left: 0; width: 300px; height: 150px; border: 0; }
</style></head>
<body><main><h1>Embed below the fold</h1>
<iframe id="widget" loading="lazy" title="Booking widget" src="CROSS_ORIGIN/throws.html"></iframe>
</main></body>
</html>`;

/**
 * A delayed Svelte 5 intro's shape, ALONE on its page: `#delayed` runs a
 * placeholder animation first, and only its `onfinish` starts the real one
 * (text #111 → #aaa over 3 s). Alone, the placeholder is the last animation to
 * finish in the settle's first wait — and `onfinish` is dispatched at the next
 * rendering update, AFTER the `finished` promise the wait resolved on. So the
 * settle sees the real animation only if it yields past the current rendering
 * update before looking again. (On the main page other, longer animations used
 * to hide that.)
 */
const DELAYED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Delayed intro</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { position: relative; height: 200vh; }
  #delayed { position: absolute; top: 150vh; left: 0; right: 0; }
</style></head>
<body><main><h1>Delayed intro</h1>
<div id="delayed"><p id="delayed-text">Starts fading only after a placeholder animation</p></div>
</main>
<script>
  const el = document.getElementById("delayed");
  el.style.opacity = "0";
  new IntersectionObserver((entries, observer) => {
    if (!entries[0].isIntersecting) return;
    observer.disconnect();
    el.style.opacity = "1";
    const placeholder = el.animate([], { duration: 600 });
    placeholder.onfinish = () => {
      document
        .getElementById("delayed-text")
        .animate([{ color: "#111" }, { color: "#aaa" }], { duration: 3000, fill: "forwards" });
    };
  }, { threshold: 0 }).observe(el);
</script>
</body>
</html>`;

/**
 * A page whose pass cannot finish cleanly, for the warn: an 8 s finite
 * animation outlives the 5 s settle budget (`unsettled: 1`), and a scroll
 * listener pushes the page to scrollY 100 as soon as it comes back to the top
 * (`finalScrollY: 100`). Nothing on it fails axe, so the run must WARN.
 * `capped` is not reached here — it needs 400 steps, a page ~200 screens tall
 * — and is held by the unit tests only.
 */
const UNSETTLED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Unsettled</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { height: 300vh; }
  #slow { width: 10px; height: 10px; }
</style></head>
<body><main><h1>Unsettled</h1><div id="slow" aria-hidden="true"></div></main>
<script>
  document.getElementById("slow").animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(10px)" }],
    { duration: 8000 },
  );
  let away = false;
  addEventListener("scroll", () => {
    if (scrollY > 0) {
      away = true;
    } else if (away) {
      away = false;
      scrollTo({ top: 100, behavior: "instant" });
    }
  });
</script>
</body>
</html>`;

/** How one throwaway site is served. */
type SiteConfig = {
  /** HTML by path, served with the CSP below. `CROSS_ORIGIN` is replaced. */
  pages: Record<string, string>;
  /** Added to the audit through package.json#reddoor.a11yRoutes. */
  a11yRoutes?: string[];
  /** Milliseconds to hold a path's response. */
  delaysMs?: Record<string, number>;
  /** 302 targets by path. `CROSS_ORIGIN` is replaced. */
  redirects?: Record<string, string>;
  /** The CSP's style-src sources. Default: 'self', 'unsafe-inline' and the cross origin. */
  styleSrc?: string;
};

const serverSource = (config: SiteConfig): string => `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const log = (file, entry) => appendFileSync(file, JSON.stringify(entry) + "\\n");

const cross = createServer((req, res) => {
  log("cross-origin.jsonl", { url: req.url, mode: req.headers["sec-fetch-mode"] ?? null });
  const crossPages = ${JSON.stringify(CROSS_PAGES)};
  const crossPath = (req.url ?? "/").split("?")[0];
  const doc = crossPages[crossPath];
  if (doc !== undefined) {
    const type = crossPath.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type });
    res.end(doc);
    return;
  }
  res.writeHead(200, { "content-type": "text/css", "cache-control": "no-store" });
  res.end("body { font-family: Georgia, serif; }");
});
await new Promise((resolve) => cross.listen(0, "127.0.0.1", resolve));
const crossOrigin = "http://127.0.0.1:" + cross.address().port;

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' " + crossOrigin,
  "style-src " + (${JSON.stringify(config.styleSrc ?? null)} ?? "'self' 'unsafe-inline' " + crossOrigin),
  "img-src 'self'",
  "frame-src 'self' " + crossOrigin,
  "connect-src 'self'",
  "report-uri /csp-report",
].join("; ");

const pages = Object.fromEntries(
  Object.entries(${JSON.stringify(config.pages)}).map(([path, html]) => [
    path,
    html.replaceAll("CROSS_ORIGIN", crossOrigin),
  ]),
);
const delaysMs = ${JSON.stringify(config.delaysMs ?? {})};
const redirects = ${JSON.stringify(config.redirects ?? {})};

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/csp-report") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const report = JSON.parse(body)["csp-report"] ?? {};
        log("csp-reports.jsonl", {
          directive: report["violated-directive"] ?? report["effective-directive"] ?? null,
          blocked: report["blocked-uri"] ?? null,
        });
      } catch {
        log("csp-reports.jsonl", { unparsed: body.slice(0, 200) });
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }
  const path = (req.url ?? "/").split("?")[0];
  if (redirects[path] !== undefined) {
    res.writeHead(302, { location: redirects[path].replaceAll("CROSS_ORIGIN", crossOrigin) });
    res.end();
    return;
  }
  const html = pages[path];
  if (html === undefined) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  setTimeout(() => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
    res.end(html);
  }, delaysMs[path] ?? 0);
}).listen(port);
`;

async function makeFixtureSite(config: SiteConfig): Promise<string> {
  const site = await mkdtemp(join(tmpdir(), "reddoor-a11y-live-"));
  await writeFile(
    join(site, "package.json"),
    JSON.stringify({
      name: "a11y-live-fixture",
      private: true,
      type: "module",
      scripts: { "vite:dev": "node server.mjs" },
      ...(config.a11yRoutes ? { reddoor: { a11yRoutes: config.a11yRoutes } } : {}),
    }),
  );
  await writeFile(join(site, "server.mjs"), serverSource(config));
  // Both built-in fixtures exist in this tree, so neither can be skipped as
  // absent (#900) — a skip here would pass every assertion below vacuously.
  await mkdir(join(site, "src", "routes", "dev", "a11y-fixtures"), { recursive: true });
  await mkdir(join(site, "src", "routes", "dev", "animate-in"), { recursive: true });
  await symlink(REPO_NODE_MODULES, join(site, "node_modules"), "dir");
  return site;
}

type Violation = {
  id: string;
  route: string;
  help?: string;
  nodes?: Array<{ target?: string[] }>;
};

/**
 * Pages whose frames include one that never loads, next to errors that must be
 * settled — the shape of beachfront-dentistry's footer, a lazy Google Maps
 * iframe on every route. Playwright lists an unloaded lazy frame with url ""
 * and no execution context, and an unbounded read of it waited forever:
 *
 *   - `/` is the hydration smoke's page. The smoke runs no reveal pass, so a
 *     lazy iframe at 1000vh never loads. It throws on load (the site's), and
 *     an eager embed on it throws too (the third party's).
 *   - `/hidden-lazy` is an axe route with the same pair of errors and a
 *     `hidden` lazy iframe, which stays unloaded even after the pass.
 */
const crashingPageWithUnloadedFrame = (title: string, message: string, lazyFrame: string) =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>main { position: relative; height: 1100vh; } #far { position: absolute; top: 1000vh; }</style></head>
<body><main><h1>${title}</h1>
<iframe title="Widget" src="CROSS_ORIGIN/throws.html"></iframe>
${lazyFrame}
</main>
<script>throw new Error(${JSON.stringify(message)});</script>
</body>
</html>`;

const SITE_H: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": plainPage("Fixtures"),
    "/dev/animate-in": plainPage("Animate-in"),
    "/": crashingPageWithUnloadedFrame(
      "Home",
      "fixture: the homepage crashed on hydrate",
      `<iframe id="far" loading="lazy" title="Map" src="CROSS_ORIGIN/frame.html"></iframe>`,
    ),
    "/hidden-lazy": crashingPageWithUnloadedFrame(
      "Hidden lazy frame",
      "fixture: a page with a hidden lazy frame crashed",
      `<iframe hidden loading="lazy" title="Map" src="CROSS_ORIGIN/frame.html"></iframe>`,
    ),
  },
  a11yRoutes: ["/hidden-lazy"],
};

/**
 * #888, run for real: text on a colour axe cannot parse. Chrome resolves
 * `oklch(0.205 0 none)` and paints it; axe-core 4.13 cannot parse it, and
 * leaves each such node `incomplete` with `messageKey: "colorParse"` while the
 * rule runs on everywhere else. Every sentence is long enough to be judged (a
 * one-character node comes back `shortTextContent` instead).
 *
 *   - `#band-text`: #3a3a3a on that colour, 1.57:1 once measured — a real
 *     failure that axe never measures. It must be reported as unmeasured.
 *   - `#fg-text`: text COLOURED with a none-hued token (`text-neutral-*`) on
 *     white. axe cannot parse the foreground either: unmeasured.
 *   - `#hued-text`: the same two colours with an explicit hue, which renders
 *     identically. It must come back as the `color-contrast` violation the
 *     band hides — the remedy turns the measurement on.
 *   - `#revealed-text`: the band's colour on a reveal at 150vh, at opacity 0
 *     until first seen. Only the reveal pass (#100) brings it into the rule, so
 *     its presence proves the detection reads what the pass revealed.
 *   - `#gradient-text`: text on a gradient, which axe leaves `incomplete` as
 *     `bgGradient`. A property of the page, not an instrument failure: it must
 *     NOT be reported.
 *   - `#plain-text`: a healthy control.
 *   - `#xo-unparseable`: a cross-origin frame whose own text sits on the
 *     unparseable colour. The third party's, so it is counted as a dropped
 *     frame node, never failed (#100's positive-evidence rule).
 */
const UNMEASURED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Unmeasured contrast</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  main { position: relative; height: 300vh; }
  .band { background-color: oklch(0.205 0 none); color: #3a3a3a; }
  .hued { background-color: oklch(0.205 0 0); color: #3a3a3a; }
  .gradient { background-image: linear-gradient(#000, #333); color: #eee; }
  #reveal { position: absolute; top: 150vh; left: 0; right: 0; }
  iframe { width: 300px; height: 150px; border: 0; }
</style></head>
<body><main><h1>Unmeasured contrast</h1>
<p id="plain-text">A sentence long enough that axe will actually judge its contrast.</p>
<p id="band-text" class="band">A sentence long enough that axe will actually judge its contrast.</p>
<p id="fg-text" style="color: oklch(0.4 0 none)">A sentence long enough that axe will actually judge its contrast.</p>
<p id="hued-text" class="hued">A sentence long enough that axe will actually judge its contrast.</p>
<p id="gradient-text" class="gradient">A sentence long enough that axe will actually judge its contrast.</p>
<iframe id="xo-unparseable" title="Widget" src="CROSS_ORIGIN/unparseable.html"></iframe>
<div id="reveal"><p id="revealed-text" class="band">A sentence long enough that axe will actually judge its contrast.</p></div>
</main>
<script>
  const el = document.getElementById("reveal");
  el.style.opacity = "0";
  el.style.transition = "opacity 600ms";
  new IntersectionObserver((entries, observer) => {
    if (entries[0].isIntersecting) {
      el.style.opacity = "1";
      observer.disconnect();
    }
  }, { threshold: 0 }).observe(el);
</script>
</body>
</html>`;

/**
 * #888's reported shape: the starter's Hero. The band is the unparseable
 * colour and the CTA inside it is white, so axe finds the CTA's white first,
 * then parses every element under it for the stacking context and THROWS on
 * the band. The whole rule is skipped for the whole page — including
 * `#above`, legible text on white that has nothing to do with the band.
 */
const HERO_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Hero</title>
<style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; }
  .hero { position: relative; isolation: isolate; padding: 24px; background-color: oklch(0.205 0 none); color: #fff; }
  .cta { display: inline-block; padding: 8px 16px; background: #fff; color: #000; }
</style></head>
<body><main><h1>Hero</h1>
<p id="above">A sentence long enough that axe will actually judge its contrast.</p>
<section class="hero"><h2>Hero slice</h2><p>Hero body copy over a dark backdrop, long enough to judge.</p><a class="cta" href="#explore">Explore</a></section>
</main></body>
</html>`;

/** The Hero's band and CTA, as a fragment other pages embed. */
const HERO_SECTION = `<section style="position: relative; isolation: isolate; padding: 24px; background-color: oklch(0.205 0 none); color: #fff"><h2>Hero slice</h2><p>Hero body copy over a dark backdrop, long enough to judge.</p><a href="#explore" style="display: inline-block; padding: 8px 16px; background: #fff; color: #000">Explore</a></section>`;

/** A page of the site's own, with the given body. */
function sitePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body { margin: 0; background: #fff; color: #111; font: 16px/1.5 sans-serif; } iframe { width: 300px; height: 200px; border: 0; }</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

const T = "A sentence long enough that axe will actually judge its contrast.";

/**
 * Where a THROWN rule is attributed (#916 review). axe merges every frame's
 * result for a rule, and when any frame's run threw, its default report keeps
 * only the rule's `incomplete` group: the site's own violations and passes
 * for that rule are dropped. The audit therefore reads axe's raw report and
 * attributes each crash by the frame it happened in:
 *
 *   - `/xo-crash`: the crash is inside a cross-origin frame. It is counted,
 *     not failed, and the site's own contrast results stand — `#site-faint`
 *     (#aaa on white) is still a `color-contrast` violation, and the site's
 *     gradient text is still nobody's crash.
 *   - `/both-crash`: the site's own Hero crashes too. That crash is the site's,
 *     so the route fails `rule-errored`; the frame's crash is still counted.
 *   - `/so-crash`: the crash is inside a SAME-origin frame, the site's own.
 *     Not positive evidence of a third party, so it fails.
 */
const XO_CRASH_PAGE = sitePage(
  "Third-party crash",
  `<p id="site-plain">${T}</p><p id="site-faint" style="color: #aaa">${T}</p><p id="site-gradient" style="background-image: linear-gradient(#000, #333); color: #eee">${T}</p><iframe id="xo-crash" title="Booking" src="CROSS_ORIGIN/crash.html"></iframe>`,
);
const BOTH_CRASH_PAGE = sitePage(
  "Both crash",
  `<p id="site-plain">${T}</p>${HERO_SECTION}<iframe id="xo-crash" title="Booking" src="CROSS_ORIGIN/crash.html"></iframe>`,
);
const SO_CRASH_PAGE = sitePage(
  "Own frame crash",
  `<p id="site-plain">${T}</p><iframe id="so-crash" title="Our booking page" src="/own-crash"></iframe>`,
);

/** The #888 site: the unmeasured-contrast page on the fixtures route, the Hero, and where a crash is attributed. */
const SITE_C: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": UNMEASURED_PAGE,
    "/dev/animate-in": plainPage("Animate-in"),
    "/": plainPage("Home"),
    "/hero": HERO_PAGE,
    "/xo-crash": XO_CRASH_PAGE,
    "/both-crash": BOTH_CRASH_PAGE,
    "/so-crash": SO_CRASH_PAGE,
    "/own-crash": sitePage("Own booking page", HERO_SECTION),
  },
  a11yRoutes: ["/hero", "/xo-crash", "/both-crash", "/so-crash"],
};

/**
 * Each #888 finding ALONE must fail the audit (#916 review): on SITE_C the
 * fail is also carried by an ordinary `color-contrast` violation, so a finding
 * that stopped counting would not change its status.
 *
 *   - SITE_U: the only finding is `contrast-unmeasured`, and it is on the
 *     SECOND fixture route, so a detection that ran on the first route only
 *     would find nothing.
 *   - SITE_E: the only findings are `rule-errored`, for a rule that is not
 *     color-contrast. `document.title` is made to throw, so axe's
 *     document-title rule crashes on `/title-throws`; `/two-crashes` crashes
 *     that rule AND color-contrast, and the summary must name both.
 */
const SITE_U: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": plainPage("Fixtures"),
    "/dev/animate-in": sitePage(
      "Animate-in",
      `<p id="late-band" style="background-color: oklch(0.205 0 none); color: #fff">${T}</p>`,
    ),
    "/": plainPage("Home"),
  },
};
const TITLE_THROWS = `<script>Object.defineProperty(document, "title", { configurable: true, get() { throw new Error("fixture: document.title threw"); } });</script>`;
const SITE_E: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": plainPage("Fixtures"),
    "/dev/animate-in": plainPage("Animate-in"),
    "/": plainPage("Home"),
    "/title-throws": sitePage("Title throws", `<p>${T}</p>${TITLE_THROWS}`),
    "/two-crashes": sitePage("Two crashes", `${HERO_SECTION}${TITLE_THROWS}`),
  },
  a11yRoutes: ["/title-throws", "/two-crashes"],
};

/** A site with nothing to fail and one route whose reveal pass cannot finish. */
const SITE_W: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": plainPage("Fixtures"),
    "/dev/animate-in": plainPage("Animate-in"),
    "/": plainPage("Home"),
    "/unsettled": UNSETTLED_PAGE,
  },
  a11yRoutes: ["/unsettled"],
};

/** The main fixture site: the reveal fixture page, and plain pages elsewhere. */
const SITE_F: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": FIXTURE_PAGE,
    "/dev/animate-in": LATE_THROW_PAGE,
    "/": plainPage("Home"),
    "/late-b": THROWS_ON_LOAD_PAGE,
    "/third-party": THIRD_PARTY_PAGE,
    "/delayed": DELAYED_PAGE,
    "/lib": LIB_PAGE,
    "/lib-reject": LIB_REJECT_PAGE,
    "/frames": FRAMES_PAGE,
    "/own-frame": OWN_FRAME_PAGE,
    "/wrapper": WRAPPER_PAGE,
  },
  a11yRoutes: ["/late-b", "/third-party", "/delayed", "/lib", "/lib-reject", "/frames"],
  delaysMs: { "/late-b": 4000 },
  redirects: { "/go-embed": "CROSS_ORIGIN/frame.html" },
};

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("audits/a11y — the generated spec, run in a real Chromium (#100, #52)", () => {
  let site = "";
  let result: AuditResult | undefined;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_F);
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywright });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  const violations = (route = "a11y fixtures"): Violation[] =>
    ((result?.details as { violations?: Violation[] } | undefined)?.violations ?? []).filter(
      (v) => v.route === route,
    );
  const contrastTargets = (route = "a11y fixtures"): string[] =>
    violations(route)
      .filter((v) => v.id === "color-contrast")
      .flatMap((v) => (v.nodes ?? []).map((n) => (n.target ?? []).join(" ")));

  it("ran, scanned the fixture, and found only what the fixture plants", () => {
    // Not a pass condition — the precondition for the ones below. A spec that
    // crashed, a route reported missing, or a client error would each leave
    // the contrast assertions measuring nothing.
    expect(result?.summary).toMatch(
      /^a11y: \d+ violations across 8 routes \(2 fixtures \+ 6 from package\.json\)/,
    );
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.map((v) => `${v.id} on ${v.route}`).sort()).toEqual([
      "button-name on /frames",
      "client-error on /frames",
      "client-error on /frames",
      "client-error on /late-b",
      "client-error on /lib",
      "client-error on /lib",
      "client-error on /lib-reject",
      "client-error on a11y fixtures",
      "color-contrast on /delayed",
      "color-contrast on a11y fixtures",
      "frame-focusable-content on /frames",
      "frame-title on /frames",
      "image-alt on /frames",
    ]);
  });

  it("records a complete reveal pass for every scanned route", () => {
    type Reveal = {
      route: string;
      steps: number;
      capped: boolean;
      finalScrollY: number;
      unsettled: number;
    };
    const reveals = (result?.details as { reveals?: Reveal[] } | undefined)?.reveals ?? [];
    expect(reveals.map((r) => r.route)).toEqual([
      "a11y fixtures",
      "animate-in demo",
      "/late-b",
      "/third-party",
      "/delayed",
      "/lib",
      "/lib-reject",
      "/frames",
    ]);
    const fixture = reveals[0];
    // 600vh in half-viewport steps is a dozen stops; 1 would mean it never scrolled.
    expect(fixture?.steps).toBeGreaterThan(1);
    expect(fixture).toMatchObject({ capped: false, finalScrollY: 0, unsettled: 0 });
    expect(result?.summary).not.toContain("reveal pass incomplete");
  });

  it("measures a reveal below the fold in its revealed state", () => {
    expect(contrastTargets()).toContain("#below-fold-text");
  });

  it("reaches a reveal that only observes the top three quarters of the viewport", () => {
    expect(contrastTargets()).toContain("#gap-band-text");
  });

  it("waits for a Web Animation started by a reveal to finish before axe runs", () => {
    expect(contrastTargets()).toContain("#waapi-text");
  });

  it("waits for an animation that a finished animation starts (a delayed Svelte 5 intro)", () => {
    expect(contrastTargets("/delayed")).toContain("#delayed-text");
  });

  it("settles after the return to the top, so an animation the return starts is waited for", () => {
    expect(contrastTargets()).toContain("#top-fade");
  });

  it("returns to the top before axe runs", () => {
    expect(contrastTargets()).toContain("#bar-text");
  });

  it("follows a page that a reveal lengthens", () => {
    expect(contrastTargets()).toContain("#grown-text");
  });

  it("labels an error thrown while the reveal pass ran, in the artifact and the summary", () => {
    const errors = violations().filter((v) => v.id === "client-error");
    expect(errors.map((v) => v.help)).toEqual([
      "while the reveal pass ran: fixture: a reveal callback threw",
    ]);
    expect(result?.summary).toContain("client-error on a11y fixtures (while the reveal pass ran)");
  });

  it("withholds the label from an error thrown outside the pass", () => {
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    const onB = all.filter((v) => v.route === "/late-b" && v.id === "client-error");
    // Exactly its own load error: unlabelled, and not the previous route's.
    expect(onB.map((v) => v.help)).toEqual(["fixture: thrown on load"]);
    expect(result?.summary).toContain("client-error on /late-b");
    expect(result?.summary).not.toContain("client-error on /late-b (while the reveal pass ran)");
  });

  it("never charges a route's late error to the next route", () => {
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.map((v) => v.help ?? "").filter((h) => h.includes("by the previous route"))).toEqual(
      [],
    );
  });

  it("names an error thrown inside a third-party embed, and does not fail the site on it", () => {
    type ThirdPartyError = {
      route: string;
      frame?: string;
      source: string | null;
      message: string;
    };
    const errors =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    // Positive evidence first: the embed loaded, threw, and was recorded.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      route: "/third-party",
      message: "fixture: a third-party embed threw",
    });
    // The evidence: the frame whose own log recorded it.
    expect(errors[0]?.frame).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/throws\.html$/);
    expect(errors[0]?.source).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/throws\.html/);
    // Not a client-error on the site's route.
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.filter((v) => v.route === "/third-party")).toEqual([]);
    expect(result?.summary).toMatch(
      /1 uncaught error thrown inside cross-origin frames, not counted: \/third-party \(http:\/\/127\.0\.0\.1:\d+\)/,
    );
  });

  it("keeps the first stack URL on the site's own client error", () => {
    const errors = violations().filter((v) => v.id === "client-error");
    expect(errors.map((v) => (v as Violation & { source?: string }).source)).toEqual([
      expect.stringMatching(/^http:\/\/localhost:\d+\/dev\/a11y-fixtures/),
    ]);
  });

  it("keeps a crash inside a library the site loaded from another origin as the site's", () => {
    const onLib = violations("/lib").filter((v) => v.id === "client-error");
    expect(onLib.map((v) => v.help).sort()).toEqual([
      "fixture: lib.load rejected",
      "fixture: lib.render was given no element",
    ]);
    // Both stacks START on the library's origin — and that is not evidence.
    for (const v of onLib) {
      expect((v as Violation & { source?: string }).source).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/lib\.js/,
      );
    }
    type ThirdPartyError = { route: string };
    const thirdParty =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    expect(thirdParty.filter((e) => e.route === "/lib")).toEqual([]);
  });

  it("keeps a library's rejection the site's beside a frame from the library's own origin", () => {
    expect(
      violations("/lib-reject")
        .filter((v) => v.id === "client-error")
        .map((v) => v.help),
    ).toEqual(["fixture: lib.load rejected"]);
    type ThirdPartyError = { route: string };
    const thirdParty =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    expect(thirdParty.filter((e) => e.route === "/lib-reject")).toEqual([]);
  });

  it("keeps an error thrown in the site's own child frames the site's: same-origin, and srcdoc", () => {
    expect(
      violations("/frames")
        .filter((v) => v.id === "client-error")
        .map((v) => v.help)
        .sort(),
    ).toEqual(["fixture: the site's own frame threw", "fixture: the srcdoc facade threw"]);
    type ThirdPartyError = { route: string };
    const thirdParty =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    expect(thirdParty.filter((e) => e.route === "/frames")).toEqual([]);
  });

  const nodeTargets = (route: string, rule: string): unknown[] =>
    violations(route)
      .filter((v) => v.id === rule)
      .flatMap((v) => (v.nodes ?? []).map((n) => n.target));

  it("counts the site's own frames: a same-origin page, and a srcdoc facade over a cross-origin src", () => {
    expect(nodeTargets("/frames", "button-name")).toEqual([["#so-frame", "button"]]);
    expect(nodeTargets("/frames", "image-alt")).toEqual([["#facade", "img"]]);
  });

  it("drops a third party's document wherever its frame sits: behind a redirect, in a wrapper, in a shadow root, lazy", () => {
    type Dropped = { route: string; count: number; rules: string[] };
    const dropped = (result?.details as { frameNodesDropped?: Dropped[] } | undefined)
      ?.frameNodesDropped;
    // Four documents, each one image-alt: #redir, #wrap's inner frame, the
    // shadow-root frame, and the lazy #xo-frame that only the pass loads.
    expect(dropped?.find((d) => d.route === "/frames")).toEqual({
      route: "/frames",
      count: 4,
      rules: ["image-alt"],
    });
    expect(result?.summary).toContain(
      "4 violation nodes inside cross-origin frames not counted: /frames (4: image-alt)",
    );
  });

  it("still audits the <iframe> element itself: a third-party frame's missing title is the site's", () => {
    expect(nodeTargets("/frames", "frame-title")).toEqual([["#xo-frame"]]);
  });

  it("still reports frame-focusable-content from inside a cross-origin frame", () => {
    expect(nodeTargets("/frames", "frame-focusable-content")).toEqual([["#xo-tab", "html"]]);
  });

  it("does not re-fetch the page's cross-origin stylesheet, so the site's CSP is not tripped (#52)", async () => {
    const hits = await readJsonl(join(site, "cross-origin.jsonl"));
    const reports = await readJsonl(join(site, "csp-reports.jsonl"));
    // The scenario was live: the page itself loaded the cross-origin sheet …
    expect(hits.filter((h) => h.url === "/fonts.css").length).toBeGreaterThan(0);
    // … and reports reach the server: the canary image's img-src report arrived.
    expect(reports.map((r) => String(r.directive).split(" ")[0])).toContain("img-src");
    // Only with both shown does the missing connect-src report mean anything.
    expect(reports.filter((r) => String(r.directive).startsWith("connect-src"))).toEqual([]);
  });
});

describe("audits/a11y — a real reveal pass that cannot finish cleanly warns (#100)", () => {
  let site = "";
  let result: AuditResult | undefined;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_W);
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywright });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  it("warns, and names the route and both reasons, from values the pass itself measured", () => {
    expect(result?.status).toBe("warn");
    expect(result?.summary).toContain(
      "reveal pass incomplete on 1 route: /unsettled (1 animation still running after 5 s; left at scrollY 100, not the top)",
    );
    const violations = (result?.details as { violations?: unknown[] } | undefined)?.violations;
    expect(violations).toEqual([]);
  });
});

describe("audits/a11y — a frame that never loads cannot stall the run (#100 review)", () => {
  // The whole run normally takes seconds. What this site holds is the skip of
  // frames with no document (url ""): without it, an unbounded read hangs to
  // the spawn timeout — this cap makes that fail in under a minute — and a
  // bounded one reads the unloaded frame as a silent SITE frame, so nothing
  // moves and the embed's error is charged to the site. The 2 s read limit
  // itself is held by the fake-frame unit tests in a11y.test.ts, not here: no
  // frame on this site has a document and fails to answer.
  const SPAWN_CAP_MS = 45_000;
  let site = "";
  let result: AuditResult | undefined;
  let elapsedMs = 0;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_H);
    const started = Date.now();
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywrightWithin(SPAWN_CAP_MS) });
    elapsedMs = Date.now() - started;
  }, 90_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  it("finishes, and names the site's crash on the smoke route and on an axe route", () => {
    expect(elapsedMs).toBeLessThan(SPAWN_CAP_MS);
    expect(result?.status).toBe("fail");
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.map((v) => `${v.id} on ${v.route}: ${v.help ?? ""}`).sort()).toEqual([
      "client-error on /hidden-lazy: fixture: a page with a hidden lazy frame crashed",
      "client-error on home: fixture: the homepage crashed on hydrate",
    ]);
  });

  it("still names the embed's errors as the third party's, on both routes", () => {
    type ThirdPartyError = { route: string; frame?: string };
    const errors =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    expect(errors.map((e) => e.route).sort()).toEqual(["/hidden-lazy", "home"]);
    for (const e of errors) expect(e.frame).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/throws\.html$/);
  });
});

describe("audits/a11y — contrast that was never measured, run for real (#888)", () => {
  let site = "";
  let result: AuditResult | undefined;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_C);
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywright });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  const all = (): Violation[] =>
    (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
  const targetsOf = (id: string): string[] =>
    all()
      .filter((v) => v.id === id)
      .flatMap((v) => (v.nodes ?? []).map((n) => (n.target ?? []).join(" ")));

  it("fails on the unmeasured nodes, and on the failure the explicit hue lets axe see", () => {
    expect(result?.status).toBe("fail");
    expect(
      all()
        .map((v) => `${v.id} on ${v.route}`)
        .sort(),
    ).toEqual([
      "color-contrast on /xo-crash",
      "color-contrast on a11y fixtures",
      "contrast-unmeasured on a11y fixtures",
      "rule-errored on /both-crash",
      "rule-errored on /hero",
      "rule-errored on /so-crash",
    ]);
    // The band axe could not parse, text coloured with it, and the same band
    // revealed by the pass.
    expect(targetsOf("contrast-unmeasured").sort()).toEqual([
      "#band-text",
      "#fg-text",
      "#revealed-text",
    ]);
    // Identical pixels with an explicit hue: now measured, and failing. And
    // the site's own failure beside a third party's crash.
    expect(targetsOf("color-contrast").sort()).toEqual(["#hued-text", "#site-faint"]);
  });

  it("names the count, the colour axe rejected and the remedy on the summary line", () => {
    expect(result?.summary).toContain(
      'contrast-unmeasured on a11y fixtures (3 element(s) on a colour axe cannot parse (oklch(0.205 0 none), oklch(0.4 0 none)), so contrast was never measured there — write 0 for "none" in the oklch() token (browsers already render none as 0, so nothing on screen changes))',
    );
  });

  it("does not report text axe is merely unsure of: a gradient", () => {
    expect(targetsOf("contrast-unmeasured")).not.toContain("#gradient-text");
    expect(targetsOf("color-contrast")).not.toContain("#gradient-text");
  });

  it("counts the unparseable colour inside a cross-origin frame, and does not fail on it", () => {
    type Dropped = { route: string; count: number; rules: string[] };
    const dropped =
      (result?.details as { frameNodesDropped?: Dropped[] } | undefined)?.frameNodesDropped ?? [];
    expect(dropped.find((d) => d.route === "a11y fixtures")).toEqual({
      route: "a11y fixtures",
      count: 1,
      rules: ["contrast-unmeasured"],
    });
    expect(targetsOf("contrast-unmeasured").some((t) => t.startsWith("#xo-unparseable"))).toBe(
      false,
    );
  });

  it("fails the Hero shape — a white CTA over the colour — as a thrown rule, with axe's message and the remedy", () => {
    const hero = all().filter((v) => v.route === "/hero");
    expect(hero.map((v) => v.id)).toEqual(["rule-errored"]);
    expect(hero[0]?.help).toBe(
      'axe could not run "color-contrast": Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule. — write 0 for "none" in the oklch() token (browsers already render none as 0, so nothing on screen changes)',
    );
    expect(result?.summary).toContain(
      'rule-errored on /hero (axe could not run "color-contrast": Unable to parse color "oklch(0.205 0 none)"',
    );
  });

  it("records how many nodes each rule measured, per route — none for contrast where the rule threw", () => {
    type Measured = { route: string; ruleNodes: Record<string, number> };
    const measured = (result?.details as { measured?: Measured[] } | undefined)?.measured ?? [];
    expect(measured.map((m) => m.route)).toEqual([
      "a11y fixtures",
      "animate-in demo",
      "/hero",
      "/xo-crash",
      "/both-crash",
      "/so-crash",
    ]);
    // #plain-text and the h1 at least; the band, the reveal and the gradient
    // are not passes.
    expect(measured[0]?.ruleNodes["color-contrast"]).toBeGreaterThanOrEqual(2);
    // The thrown rule measured nothing on the whole page, #above included.
    expect(measured[2]?.ruleNodes["color-contrast"] ?? 0).toBe(0);
    // A crash inside a third party's frame costs the site none of its own:
    // the h1 and #site-plain were measured and passed.
    expect(measured[3]?.ruleNodes["color-contrast"]).toBeGreaterThanOrEqual(2);
  });

  it("counts a rule that threw inside a third party's frame, and keeps the site's own results for that rule", () => {
    const xo = all().filter((v) => v.route === "/xo-crash");
    expect(xo.map((v) => v.id)).toEqual(["color-contrast"]);
    expect(targetsOf("color-contrast")).toContain("#site-faint");
    // The site's gradient text is uncertain, not crashed: nobody's finding.
    expect(
      all().some((v) => (v.nodes ?? []).some((n) => (n.target ?? []).includes("#site-gradient"))),
    ).toBe(false);
    type Dropped = { route: string; count: number; rules: string[] };
    const dropped =
      (result?.details as { frameNodesDropped?: Dropped[] } | undefined)?.frameNodesDropped ?? [];
    expect(dropped.find((d) => d.route === "/xo-crash")).toEqual({
      route: "/xo-crash",
      count: 1,
      rules: ["rule-errored"],
    });
  });

  it("fails the site's own crash even beside a third party's, and a crash in its own same-origin frame", () => {
    const both = all().filter((v) => v.route === "/both-crash");
    expect(both.map((v) => v.id)).toEqual(["rule-errored"]);
    // The site's crash node, not the frame's.
    expect(both[0]?.nodes?.map((n) => n.target?.length)).toEqual([1]);
    type Dropped = { route: string; count: number; rules: string[] };
    const dropped =
      (result?.details as { frameNodesDropped?: Dropped[] } | undefined)?.frameNodesDropped ?? [];
    expect(dropped.find((d) => d.route === "/both-crash")).toEqual({
      route: "/both-crash",
      count: 1,
      rules: ["rule-errored"],
    });
    const own = all().filter((v) => v.route === "/so-crash");
    expect(own.map((v) => v.id)).toEqual(["rule-errored"]);
    expect(own[0]?.nodes?.[0]?.target?.[0]).toBe("#so-crash");
  });
});

describe("audits/a11y — each #888 finding fails the audit on its own (#916 review)", () => {
  let siteU = "";
  let siteE = "";
  let unmeasured: AuditResult | undefined;
  let errored: AuditResult | undefined;

  beforeAll(async () => {
    siteU = await makeFixtureSite(SITE_U);
    siteE = await makeFixtureSite(SITE_E);
    unmeasured = await a11yAudit({ site: { path: siteU }, spawn: livePlaywright });
    errored = await a11yAudit({ site: { path: siteE }, spawn: livePlaywright });
  }, 240_000);

  afterAll(async () => {
    if (siteU) await rm(siteU, { recursive: true, force: true });
    if (siteE) await rm(siteE, { recursive: true, force: true });
  });

  const violationsOf = (r: AuditResult | undefined): Violation[] =>
    (r?.details as { violations?: Violation[] } | undefined)?.violations ?? [];

  it("fails on contrast-unmeasured alone, found on a route other than the first", () => {
    expect(violationsOf(unmeasured).map((v) => `${v.id} on ${v.route}`)).toEqual([
      "contrast-unmeasured on animate-in demo",
    ]);
    expect(unmeasured?.status).toBe("fail");
    expect((unmeasured?.details as { byImpact?: unknown } | undefined)?.byImpact).toEqual({
      serious: 1,
    });
  });

  it("fails on rule-errored alone, for a rule that is not color-contrast, and names each rule that threw", () => {
    const found = violationsOf(errored);
    expect(found.map((v) => `${v.id} on ${v.route}: ${v.help ?? ""}`).sort()).toEqual([
      'rule-errored on /title-throws: axe could not run "document-title": fixture: document.title threw Skipping document-title rule.',
      'rule-errored on /two-crashes: axe could not run "color-contrast": Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule. — write 0 for "none" in the oklch() token (browsers already render none as 0, so nothing on screen changes)',
      'rule-errored on /two-crashes: axe could not run "document-title": fixture: document.title threw Skipping document-title rule.',
    ]);
    expect(errored?.status).toBe("fail");
    // Two different rules on one route are two entries in the summary, not
    // one folded under the first rule's message.
    expect(errored?.summary).toContain(
      'rule-errored on /two-crashes (axe could not run "color-contrast"',
    );
    expect(errored?.summary).toContain(
      'rule-errored on /two-crashes (axe could not run "document-title"',
    );
  });
});

/**
 * #949. A CSP whose style-src has no 'unsafe-inline' refuses a <style> element,
 * and the spec used to inject its motion-freezing sheet as one: the injection
 * threw and the whole audit failed with no results. The page here has that
 * CSP and one transition, started on load, from #111 to #aaa over 30 s:
 *
 *   - frozen, the transition jumps to #aaa (2.32:1 on white), so a
 *     color-contrast violation on `#fade` is positive evidence the sheet
 *     applied under this CSP, not merely that nothing threw;
 *   - left running, the reveal pass would wait its 5 s on it and report it
 *     unsettled.
 *
 * `#keyframes` is the other half of the sheet. Its colour is #aaa, and a 30 s
 * keyframe animation holds it at #111; the page adopts that rule itself, as a
 * constructed sheet, which is the one way this CSP lets a page style an
 * element at all. It fails contrast only if `animation: none` applied AND the
 * freeze kept the page's own adopted sheet beside its own.
 *
 * The canary image, blocked by img-src, proves the report channel is live, so
 * "no style-src report" is a measurement and not silence.
 */
const STRICT_STYLE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Strict styles</title></head>
<body><main><h1>Strict styles</h1><p id="fade">${"Text that transitions to a pale grey. ".repeat(3)}</p>
<p id="keyframes">${"Text whose keyframe animation holds it dark. ".repeat(3)}</p>
<img src="CROSS_ORIGIN/canary.png" alt=""></main>
<script>
const own = new CSSStyleSheet();
own.replaceSync("@keyframes hold-dark { from { color: #111 } to { color: #111 } } #keyframes { color: #aaa; animation: hold-dark 30s linear }");
document.adoptedStyleSheets = [own];
const p = document.getElementById("fade");
p.style.transition = "color 30s linear";
p.style.color = "#111";
requestAnimationFrame(() => requestAnimationFrame(() => { p.style.color = "#aaa"; }));
</script></body></html>`;
const SITE_S: SiteConfig = {
  pages: {
    "/dev/a11y-fixtures": plainPage("Fixtures"),
    "/dev/animate-in": plainPage("Animate-in"),
    "/": plainPage("Home"),
    "/strict-styles": STRICT_STYLE_PAGE,
  },
  a11yRoutes: ["/strict-styles"],
  styleSrc: "'self'",
};

describe("audits/a11y — a CSP without 'unsafe-inline' in style-src (#949)", () => {
  let site = "";
  let result: AuditResult | undefined;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_S);
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywright });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  const all = (): Violation[] =>
    (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];

  it("runs axe on every route instead of failing with no results", () => {
    expect(result?.summary).toMatch(
      /^a11y: 1 violations? across 3 routes \(2 fixtures \+ 1 from package\.json\)/,
    );
  });

  it("still freezes a running transition and a keyframe animation, keeping the page's own adopted sheet", () => {
    expect(all().map((v) => `${v.id} on ${v.route}`)).toEqual(["color-contrast on /strict-styles"]);
    expect(
      all()[0]
        ?.nodes?.map((n) => (n.target ?? []).join(" "))
        .sort(),
    ).toEqual(["#fade", "#keyframes"]);
    type Reveal = { route: string; unsettled?: number };
    const reveals = (result?.details as { reveals?: Reveal[] } | undefined)?.reveals ?? [];
    expect(reveals.find((r) => r.route === "/strict-styles")?.unsettled).toBe(0);
  });

  it("injects nothing the page's CSP refuses, and leaves that CSP enforced", async () => {
    const reports = await readJsonl(join(site, "csp-reports.jsonl"));
    const directives = reports.map((r) => String(r.directive).split(" ")[0] ?? "");
    expect(directives).toContain("img-src");
    expect(directives.filter((d) => d.startsWith("style-src"))).toEqual([]);
  });
});

/**
 * #905. After a Renovate bump carries a newer Playwright, the browsers on disk
 * are the old revision and every launch fails with "Executable doesn't exist".
 * Playwright prints that to stdout, and the audit summarised only stderr, which
 * held an npm warning: the operator read "no results written" and a warning
 * that had nothing to do with it. An empty PLAYWRIGHT_BROWSERS_PATH is exactly
 * that state.
 */
describe("audits/a11y — Playwright's browser is not installed (#905)", () => {
  let site = "";
  let browsers = "";
  let result: AuditResult | undefined;

  beforeAll(async () => {
    site = await makeFixtureSite(SITE_W);
    browsers = await mkdtemp(join(tmpdir(), "reddoor-a11y-no-browsers-"));
    const withoutBrowsers: SpawnFn = (cmd, args, opts) =>
      livePlaywright(cmd, args, {
        ...opts,
        env: { ...opts?.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
      });
    result = await a11yAudit({ site: { path: site }, spawn: withoutBrowsers });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
    if (browsers) await rm(browsers, { recursive: true, force: true });
  });

  it("fails, naming the missing executable and the command that installs it", () => {
    expect(result?.status).toBe("fail");
    expect(result?.summary).toContain("Playwright's browser is not installed");
    expect(result?.summary).toContain(`${browsers}/chromium`);
    expect(result?.summary).toContain("npx playwright install chromium");
    expect(result?.summary).not.toContain("npm warn");
  });
});
