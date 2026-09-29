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
 * `#xo-frame` is a lazy, title-less iframe from the second origin, at 330vh:
 * the shape of a Google Maps footer embed that the pass now brings into load
 * range. Its document has an `<img>` with no `alt`. The `<iframe>` element must
 * still fail `frame-title` in the top document; the `image-alt` inside is a
 * third party's and must not count — but must be counted as dropped, which is
 * also the proof that axe reached the frame at all.
 *
 * `#xo-tab` is an eager cross-origin iframe with `tabindex="-1"` whose
 * document has a button: the site's own defect, `frame-focusable-content`
 * (serious, WCAG 2.1.1), which axe can only see from inside the frame. The
 * filter that drops third-party nodes must keep it.
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
  #xo-frame { position: absolute; top: 330vh; left: 0; width: 300px; height: 150px; border: 0; }
  #xo-tab { width: 300px; height: 150px; border: 0; }
  #bar { position: fixed; right: 0; bottom: 0; background: #fff; padding: 4px; }
  #bar-text { color: #aaa; margin: 0; }
  #bar.scrolled #bar-text { color: #111; }
</style>
</head>
<body>
<main>
  <h1>Reveal fixture</h1>
  <img src="CROSS_ORIGIN/canary.png" alt="">
  <iframe id="xo-tab" tabindex="-1" title="Player" src="CROSS_ORIGIN/player.html"></iframe>
  <p id="top-fade">Greys out when the page comes back to the top</p>
  <div id="spinner" aria-hidden="true"></div>
  <div class="reveal" id="below-fold"><p class="faint" id="below-fold-text">Revealed once scrolled to</p></div>
  <div class="reveal" id="gap-band"><p class="faint" id="gap-band-text">Revealed in the top three quarters of the viewport</p></div>
  <div class="reveal" id="throws"></div>
  <div class="reveal" id="waapi"><p id="waapi-text">Fades to a failing grey over two seconds</p></div>
  <div class="reveal" id="grow"></div>
  <div class="reveal" id="grown" hidden><p class="faint" id="grown-text">Only exists once the page has grown</p></div>
  <iframe id="xo-frame" loading="lazy" src="CROSS_ORIGIN/frame.html"></iframe>
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
  // A third party's script that throws as soon as it loads.
  "/throws.html": thirdPartyPage(
    "Widget",
    `<p>Widget</p><script>throw new Error("fixture: a third-party embed threw");</script>`,
  ),
};

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
 * settle sees the real animation only if it lets a frame pass before looking
 * again. (On the main page other, longer animations used to hide that.)
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
};

const serverSource = (config: SiteConfig): string => `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const log = (file, entry) => appendFileSync(file, JSON.stringify(entry) + "\\n");

const cross = createServer((req, res) => {
  log("cross-origin.jsonl", { url: req.url, mode: req.headers["sec-fetch-mode"] ?? null });
  const crossPages = ${JSON.stringify(CROSS_PAGES)};
  const doc = crossPages[(req.url ?? "/").split("?")[0]];
  if (doc !== undefined) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
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
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' " + crossOrigin,
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
  },
  a11yRoutes: ["/late-b", "/third-party", "/delayed"],
  delaysMs: { "/late-b": 4000 },
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
      /^a11y: \d+ violations across 5 routes \(2 fixtures \+ 3 from package\.json\)/,
    );
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.map((v) => `${v.id} on ${v.route}`).sort()).toEqual([
      "client-error on /late-b",
      "client-error on a11y fixtures",
      "color-contrast on /delayed",
      "color-contrast on a11y fixtures",
      "frame-focusable-content on a11y fixtures",
      "frame-title on a11y fixtures",
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

  it("audits a third-party iframe element, but does not count the third party's document", () => {
    const frameTitle = violations().filter((v) => v.id === "frame-title");
    expect(frameTitle.flatMap((v) => (v.nodes ?? []).map((n) => n.target))).toEqual([
      ["#xo-frame"],
    ]);
    expect(violations().map((v) => v.id)).not.toContain("image-alt");
    // Not absence alone: axe DID reach the frame, and its image-alt node was
    // dropped and counted — in the artifact and, by name, in the summary.
    type Dropped = { route: string; count: number; rules: string[] };
    const dropped = (result?.details as { frameNodesDropped?: Dropped[] } | undefined)
      ?.frameNodesDropped;
    expect(dropped?.find((d) => d.route === "a11y fixtures")).toEqual({
      route: "a11y fixtures",
      count: 1,
      rules: ["image-alt"],
    });
    expect(result?.summary).toContain(
      "1 violation node inside cross-origin frames not counted: a11y fixtures (1: image-alt)",
    );
  });

  it("names an error thrown inside a third-party embed, and does not fail the site on it", () => {
    type ThirdPartyError = { route: string; source: string | null; message: string };
    const errors =
      (result?.details as { thirdPartyErrors?: ThirdPartyError[] } | undefined)?.thirdPartyErrors ??
      [];
    // Positive evidence first: the embed loaded, threw, and was recorded.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      route: "/third-party",
      message: "fixture: a third-party embed threw",
    });
    expect(errors[0]?.source).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/throws\.html/);
    // Not a client-error on the site's route.
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.filter((v) => v.route === "/third-party")).toEqual([]);
    expect(result?.summary).toMatch(
      /1 uncaught error from another origin, not counted: \/third-party \(http:\/\/127\.0\.0\.1:\d+\)/,
    );
  });

  it("keeps the first stack URL on the site's own client error", () => {
    const errors = violations().filter((v) => v.id === "client-error");
    expect(errors.map((v) => (v as Violation & { source?: string }).source)).toEqual([
      expect.stringMatching(/^http:\/\/localhost:\d+\/dev\/a11y-fixtures/),
    ]);
  });

  it("still reports frame-focusable-content from inside a cross-origin frame", () => {
    const ffc = violations().filter((v) => v.id === "frame-focusable-content");
    expect(ffc.flatMap((v) => (v.nodes ?? []).map((n) => n.target))).toEqual([["#xo-tab", "html"]]);
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
