import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { asRendered, defaultCrawlDeps, type RenderedPage } from "../../src/prospect/crawl.js";

/**
 * W4. THREE CRAWL SETTINGS, PROVED IN A REAL BROWSER.
 *
 * Each of these was a false finding printed in a prospect's report, and each
 * one lives in how the browser is set up, which no fake can see:
 *
 * - DES-14: axe measured colour contrast on text still fading in, and
 *   reported dozens of "Serious" failures on sites whose own gates hold AA.
 *   The crawl's context now asks for reduced motion.
 * - TEC-05: a styled `console.error` banner was counted as "a script that
 *   throws". Thrown errors are now recorded apart from console messages.
 * - DES-13: the inside of a cross-origin frame (a video player) was reported
 *   as the site's own critical accessibility failure.
 *
 * Every assertion that something is ABSENT has a CONTROL beside it showing
 * the same instrument reports it when it is really there, so a crashed axe
 * run or a listener that never fired cannot pass for a clean page.
 */

const FADE_IN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fade</title>
<style>
  body { background: #fff; }
  p { color: #222; animation: rise 20s linear forwards; }
  @keyframes rise { from { opacity: 0.12 } to { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { p { animation: none; } }
</style></head>
<body><main><h1>Fade</h1><p>Dark text that fades in over twenty seconds.</p></main></body></html>`;

const LOW_CONTRAST = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Low</title>
<style>body { background: #fff; } p { color: #ccc; }</style></head>
<body><main><h1>Low</h1><p>Pale grey text on white, at rest.</p></main></body></html>`;

const STYLED_LOG = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Log</title>
<script>console.error("%c%d", "font-size:0;color:transparent", NaN);</script></head>
<body><main><h1>Log</h1><p>Prints a styled console.error and keeps going.</p></main></body></html>`;

const THROWS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Throws</title>
<script>setTimeout(function () { null.slice(); }, 0);</script></head>
<body><main><h1>Throws</h1><p>A script that throws.</p></main></body></html>`;

const NAMELESS_BUTTON = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Widget</title></head>
<body><main><button class="player-control"></button></main></body></html>`;

const framePage = (
  src: string,
  title = ' title="A video"',
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head>
<body><main><h1>Embed</h1><iframe${title} src="${src}"></iframe></main></body></html>`;

describe("the crawl's browser settings, against a real browser", () => {
  let server: Server;
  let other: Server;
  let base = "";
  let otherBase = "";

  const serve = (routes: Record<string, string>) =>
    createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(routes[req.url ?? "/"] ?? "<!doctype html><title>x</title>");
    });

  beforeAll(async () => {
    other = serve({ "/widget": NAMELESS_BUTTON });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    // A different port is a different origin: that is the whole test.
    otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    server = serve({
      "/fade": FADE_IN,
      "/low": LOW_CONTRAST,
      "/log": STYLED_LOG,
      "/throws": THROWS,
      "/widget": NAMELESS_BUTTON,
      "/third-party-frame": framePage(`${otherBase}/widget`),
      "/own-frame": framePage("/widget"),
      "/untitled-third-party-frame": framePage(`${otherBase}/widget`, ""),
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (other) await new Promise<void>((r) => other.close(() => r()));
  }, 60_000);

  const render = async (path: string): Promise<RenderedPage> => {
    const url = `${base}${path}`;
    const out = await defaultCrawlDeps({ probeForms: false, delayMs: 0 }).renderPages([url]);
    const page = asRendered(out.get(url));
    expect(page, `no render for ${path}`).not.toBeNull();
    return page!;
  };
  const nodes = (p: RenderedPage, rule: string): number =>
    p.axe?.violations.find((v) => v.id === rule)?.nodes ?? 0;

  it("reads a fade-in page as it ends, with no contrast failures", async () => {
    const p = await render("/fade");
    expect(p.axe, "axe did not run").not.toBeNull();
    expect(nodes(p, "color-contrast")).toBe(0);
  }, 60_000);

  it("CONTROL: still reports text that is pale at rest", async () => {
    expect(nodes(await render("/low"), "color-contrast")).toBeGreaterThan(0);
  }, 60_000);

  it("counts zero script errors on a page that only logs a styled console.error", async () => {
    const p = await render("/log");
    expect(p.vitals?.scriptErrors).toEqual([]);
    // Recorded, as a note.
    expect(p.vitals?.consoleErrors.length).toBe(1);
  }, 60_000);

  it("CONTROL: counts a script that throws", async () => {
    const p = await render("/throws");
    expect(p.vitals?.scriptErrors?.length).toBe(1);
  }, 60_000);

  it("leaves a cross-origin frame's markup out of the accessibility scan", async () => {
    const p = await render("/third-party-frame");
    expect(p.axe, "axe did not run").not.toBeNull();
    expect(nodes(p, "button-name")).toBe(0);
  }, 60_000);

  it("still reports a missing title on the site's own <iframe> tag", async () => {
    const p = await render("/untitled-third-party-frame");
    expect(nodes(p, "frame-title")).toBeGreaterThan(0);
    expect(nodes(p, "button-name")).toBe(0);
  }, 60_000);

  it("CONTROL: the same widget in a same-origin frame is the site's own, and reported", async () => {
    expect(nodes(await render("/own-frame"), "button-name")).toBeGreaterThan(0);
  }, 60_000);
});
