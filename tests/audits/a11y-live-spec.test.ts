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

function plainPage(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;
}

/**
 * The page under audit, served by `SERVER` below from two origins: the page on
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
 * Two more are about the settle, and both END failing contrast, so a hit is
 * positive evidence that the pass waited:
 *
 *   - `#waapi` at 250vh animates its text's colour #111 → #aaa over 2 s on the
 *     Web Animations API, `fill: forwards`. Measured early, it passes.
 *   - `#delayed` at 380vh is a delayed Svelte 5 intro's shape: a placeholder
 *     animation runs first, and only its `onfinish` starts the real one. A
 *     settle that reads `getAnimations()` once waits for the placeholder and
 *     measures the real animation at its start. The real one runs 3 s so it
 *     outlasts `#waapi`: a single read waits on everything it saw, and a
 *     shorter tail would finish inside that wait and pass by accident.
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
 * `#xo-frame` is a lazy, title-less iframe from the second origin, at 330vh:
 * the shape of a Google Maps footer embed that the pass now brings into load
 * range. Its document has an `<img>` with no `alt`. The `<iframe>` element must
 * still fail `frame-title` in the top document; the frame's own contents are a
 * third party's and must not be audited.
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
  #waapi { top: 250vh; }
  #delayed { top: 380vh; }
  #grow { top: 390vh; height: 1px; }
  #grown { top: 560vh; }
  #xo-frame { position: absolute; top: 330vh; left: 0; width: 300px; height: 150px; border: 0; }
  #bar { position: fixed; right: 0; bottom: 0; background: #fff; padding: 4px; }
  #bar-text { color: #aaa; margin: 0; }
  #bar.scrolled #bar-text { color: #111; }
</style>
</head>
<body>
<main>
  <h1>Reveal fixture</h1>
  <img src="CROSS_ORIGIN/canary.png" alt="">
  <div class="reveal" id="below-fold"><p class="faint" id="below-fold-text">Revealed once scrolled to</p></div>
  <div class="reveal" id="gap-band"><p class="faint" id="gap-band-text">Revealed in the top three quarters of the viewport</p></div>
  <div class="reveal" id="waapi"><p id="waapi-text">Fades to a failing grey over two seconds</p></div>
  <div class="reveal" id="delayed"><p id="delayed-text">Starts fading only after a placeholder animation</p></div>
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
  onFirstSight("delayed", (el) => {
    const placeholder = el.animate([], { duration: 600 });
    placeholder.onfinish = () => {
      document.getElementById("delayed-text").animate(toGrey, { duration: 3000, fill: "forwards" });
    };
  });
  onFirstSight("grow", () => {
    document.querySelector("main").style.height = "600vh";
    document.getElementById("grown").hidden = false;
  });
  onFirstSight("grown", () => {});
  addEventListener("scroll", () => {
    document.getElementById("bar").classList.toggle("scrolled", scrollY > 0);
  });
</script>
</body>
</html>`;

/** The third-party frame's document: one `image-alt` failure, not the site's. */
const FRAME_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head><body><main><img src="/tile.png"></main></body></html>`;

const SERVER = `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const log = (file, entry) => appendFileSync(file, JSON.stringify(entry) + "\\n");

const cross = createServer((req, res) => {
  log("cross-origin.jsonl", { url: req.url, mode: req.headers["sec-fetch-mode"] ?? null });
  if (req.url === "/frame.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(${JSON.stringify(FRAME_PAGE)});
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

const pages = {
  "/dev/a11y-fixtures": ${JSON.stringify(FIXTURE_PAGE)}.replaceAll("CROSS_ORIGIN", crossOrigin),
  "/dev/animate-in": ${JSON.stringify(plainPage("Animate-in"))},
  "/": ${JSON.stringify(plainPage("Home"))},
};

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
  const html = pages[(req.url ?? "/").split("?")[0]];
  if (html === undefined) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
  res.end(html);
}).listen(port);
`;

async function makeFixtureSite(): Promise<string> {
  const site = await mkdtemp(join(tmpdir(), "reddoor-a11y-live-"));
  await writeFile(
    join(site, "package.json"),
    JSON.stringify({
      name: "a11y-live-fixture",
      private: true,
      type: "module",
      scripts: { "vite:dev": "node server.mjs" },
    }),
  );
  await writeFile(join(site, "server.mjs"), SERVER);
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
  nodes?: Array<{ target?: string[] }>;
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
    site = await makeFixtureSite();
    result = await a11yAudit({ site: { path: site }, spawn: livePlaywright });
  }, 180_000);

  afterAll(async () => {
    if (site) await rm(site, { recursive: true, force: true });
  });

  const violations = (): Violation[] =>
    ((result?.details as { violations?: Violation[] } | undefined)?.violations ?? []).filter(
      (v) => v.route === "a11y fixtures",
    );
  const contrastTargets = (): string[] =>
    violations()
      .filter((v) => v.id === "color-contrast")
      .flatMap((v) => (v.nodes ?? []).map((n) => (n.target ?? []).join(" ")));

  it("ran, scanned the fixture, and found only what the fixture plants", () => {
    // Not a pass condition — the precondition for the ones below. A spec that
    // crashed, a route reported missing, or a client error would each leave
    // the contrast assertions measuring nothing.
    expect(result?.summary).toMatch(/^a11y: \d+ violations across 2 routes/);
    const all = (result?.details as { violations?: Violation[] } | undefined)?.violations ?? [];
    expect(all.map((v) => `${v.id} on ${v.route}`).sort()).toEqual([
      "color-contrast on a11y fixtures",
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
    expect(reveals.map((r) => r.route)).toEqual(["a11y fixtures", "animate-in demo"]);
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
    expect(contrastTargets()).toContain("#delayed-text");
  });

  it("returns to the top before axe runs", () => {
    expect(contrastTargets()).toContain("#bar-text");
  });

  it("follows a page that a reveal lengthens", () => {
    expect(contrastTargets()).toContain("#grown-text");
  });

  it("audits a third-party iframe element, but not the third party's document", async () => {
    // The frame really loaded, so its image-alt failure was there to be found.
    const hits = await readJsonl(join(site, "cross-origin.jsonl"));
    expect(hits.map((h) => h.url)).toContain("/frame.html");
    const frameTitle = violations().filter((v) => v.id === "frame-title");
    expect(frameTitle.flatMap((v) => (v.nodes ?? []).map((n) => n.target))).toEqual([
      ["#xo-frame"],
    ]);
    expect(violations().map((v) => v.id)).not.toContain("image-alt");
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
