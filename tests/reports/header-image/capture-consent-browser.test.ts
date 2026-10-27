import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import {
  defaultShooter,
  ConsentStillVisibleError,
} from "../../../src/reports/header-image/capture.js";

const TEAL = [31, 138, 112] as const;

function page(delayMs: number | null, dismissable: boolean): string {
  const banner =
    delayMs === null
      ? ""
      : `<script>
setTimeout(() => {
  const root = document.createElement("div");
  root.className = "w-screen h-screen fixed top-0 left-0 z-50";
  root.style.cssText = "position:fixed;inset:0;z-index:50";
  root.innerHTML = '<div class="w-full h-full absolute top-0 left-0 backdrop-blur-sm bg-black/40" style="position:absolute;inset:0;backdrop-filter:blur(8px);background:rgba(0,0,0,.4)"></div>' +
    '<div class="z-20 relative" style="position:absolute;left:15%;right:15%;bottom:40px;background:#fcfcfc;padding:20px;font:16px sans-serif">' +
    '<p>We use cookies to track website usage and personalize content.</p>' +
    '<button id="a">Accept</button> <button id="r">REJECT</button></div>';
  document.body.appendChild(root);
  ${dismissable ? 'for (const id of ["a", "r"]) root.querySelector("#" + id).addEventListener("click", () => root.remove());' : ""}
}, ${delayMs});
</script>`;
  return `<!doctype html><html><body style="margin:0"><div style="width:100vw;height:100vh;background:rgb(${TEAL.join(",")})"></div>${banner}</body></html>`;
}

/** No overlay at all: an ordinary "OK" button in page flow, and a footer that
 *  mentions cookies, the shape a site with a newsletter form and a cookie-policy
 *  link has. */
/** A newsletter "OK" earlier in the DOM than a banner that mounts late, so
 *  `first()` would pick the wrong button. */
function contentThenLateBanner(): string {
  return page(3500, true).replace(
    '<body style="margin:0">',
    '<body style="margin:0"><form style="position:absolute;top:0;left:0"><button type="button">OK</button></form>',
  );
}

/** The whole page pinned in a fixed scroll wrapper (GSAP ScrollSmoother's
 *  shape), with an in-page "OK" and a cookie-policy footer inside it. */
function scrollWrapperPage(): string {
  return `<!doctype html><html><body style="margin:0"><div id="smooth-wrapper" style="position:fixed;inset:0;overflow:hidden"><div id="smooth-content"><div style="width:100vw;height:100vh;background:rgb(${TEAL.join(",")})"></div><div style="height:150vh"><form><button type="button">OK</button></form></div><footer>Privacy · Cookie Policy</footer></div></div></body></html>`;
}

function contentPage(): string {
  return `<!doctype html><html><body style="margin:0"><div style="width:100vw;height:100vh;background:rgb(${TEAL.join(",")})"></div><form><input name="email"><button type="button">OK</button></form><footer>Privacy · Cookie Policy</footer></body></html>`;
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const delay = u.searchParams.get("delay");
    res.setHeader("content-type", "text/html");
    if (u.searchParams.has("content")) return void res.end(contentPage());
    if (u.searchParams.has("okfirst")) return void res.end(contentThenLateBanner());
    if (u.searchParams.has("wrapper")) return void res.end(scrollWrapperPage());
    res.end(page(delay === null ? null : Number(delay), u.searchParams.get("stuck") === null));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function shoot(query: string): Promise<Uint8Array> {
  const s = await defaultShooter();
  return s.shoot({
    url: `${base}${query}`,
    width: 800,
    height: 500,
    deviceScaleFactor: 1,
    settleMs: 2500,
  });
}

/** Mean RGB over the band where the consent panel sits. */
async function panelBand(png: Uint8Array): Promise<number[]> {
  const { data, info } = await sharp(png)
    .extract({ left: 160, top: 380, width: 480, height: 80 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels)
    for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
  const n = data.length / info.channels;
  return sum.map((v) => Math.round(v / n));
}

function expectTeal(rgb: number[]): void {
  rgb.forEach((v, i) => expect(Math.abs(v - TEAL[i]!)).toBeLessThanOrEqual(6));
}

describe("defaultShooter against a real browser: consent banners (#654)", () => {
  it("photographs the hero on a page with no banner", async () => {
    expectTeal(await panelBand(await shoot("")));
  }, 30_000);

  it("dismisses a banner that is there at load", async () => {
    expectTeal(await panelBand(await shoot("?delay=0")));
  }, 30_000);

  it("dismisses a banner that mounts after the first look, during the settle, as Sonder's does", async () => {
    expectTeal(await panelBand(await shoot("?delay=1500")));
  }, 30_000);

  it("dismisses a banner that mounts after the settle, inside the late-look window", async () => {
    expectTeal(await panelBand(await shoot("?delay=3500")));
  }, 30_000);

  it("still photographs a page whose only OK button is content, beside a cookie-policy link", async () => {
    expectTeal(await panelBand(await shoot("?content")));
  }, 30_000);

  it("clicks the banner's button, not an earlier content button with the same name", async () => {
    expectTeal(await panelBand(await shoot("?okfirst")));
  }, 30_000);

  it("does not mistake a full-page fixed scroll wrapper for a consent overlay", async () => {
    expectTeal(await panelBand(await shoot("?wrapper")));
  }, 30_000);

  it("refuses to photograph a banner that will not leave", async () => {
    await expect(shoot("?delay=3500&stuck")).rejects.toBeInstanceOf(ConsentStillVisibleError);
  }, 30_000);
});
