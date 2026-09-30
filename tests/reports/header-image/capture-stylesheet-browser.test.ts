import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  defaultShooter,
  ownHostStylesheetFailures,
  UnstyledPageError,
} from "../../../src/reports/header-image/capture.js";

let server: Server;
let port: number;

function html(links: string[], extraHead = ""): string {
  return `<!doctype html><html><head>${links.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}${extraHead}</head><body style="margin:0"><div class="hero">hero</div></body></html>`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/ok.css") {
      res.setHeader("content-type", "text/css");
      return void res.end(".hero{width:100vw;height:100vh;background:rgb(31,138,112)}");
    }
    if (u.pathname === "/missing.css") {
      res.statusCode = 404;
      return void res.end("not found");
    }
    if (u.pathname === "/missing-as-css.css") {
      res.statusCode = 404;
      res.setHeader("content-type", "text/css");
      return void res.end("/* not found */");
    }
    if (u.pathname === "/reset.css") return void req.socket.destroy();
    if (u.pathname === "/moved.css") {
      res.statusCode = 301;
      res.setHeader("location", "/missing-as-css.css");
      return void res.end();
    }
    if (u.pathname === "/redirect") {
      res.statusCode = 302;
      res.setHeader("location", `http://localhost:${port}/own-404`);
      return void res.end();
    }
    if (u.pathname === "/print-and-preload-404") {
      res.setHeader("content-type", "text/html");
      return void res.end(
        html(
          ["/ok.css"],
          '<link rel="stylesheet" media="print" href="/missing.css"><link rel="preload" as="style" href="/missing-as-css.css">',
        ),
      );
    }
    res.setHeader("content-type", "text/html");
    const other = `http://localhost:${port}`;
    const pages: Record<string, string[]> = {
      "/styled": ["/ok.css"],
      "/own-404": ["/ok.css", "/missing.css"],
      "/own-reset": ["/ok.css", "/reset.css"],
      "/own-404-css": ["/ok.css", "/missing-as-css.css"],
      "/own-404-redirected": ["/ok.css", "/moved.css"],
      "/own-404-fragment": ["/ok.css", "/missing-as-css.css#v2"],
      "/third-party-404": ["/ok.css", `${other}/missing.css`],
    };
    res.end(html(pages[u.pathname] ?? []));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function shoot(path: string): Promise<Uint8Array> {
  const s = await defaultShooter();
  return s.shoot({
    url: `http://127.0.0.1:${port}${path}`,
    width: 800,
    height: 500,
    deviceScaleFactor: 1,
    settleMs: 200,
  });
}

describe("defaultShooter against a real browser: unstyled pages", () => {
  it("photographs a page whose stylesheets all loaded", async () => {
    expect((await shoot("/styled")).length).toBeGreaterThan(0);
  }, 30_000);

  it("refuses a page whose own stylesheet 404'd", async () => {
    await expect(shoot("/own-404")).rejects.toBeInstanceOf(UnstyledPageError);
  }, 30_000);

  it("refuses a page whose own stylesheet 404'd with a text/css body, which the browser does not report as failed", async () => {
    await expect(shoot("/own-404-css")).rejects.toThrow(/missing-as-css\.css \(HTTP 404\)/);
  }, 30_000);

  it("refuses a page whose own stylesheet's connection was reset", async () => {
    await expect(shoot("/own-reset")).rejects.toThrow(/reset\.css/);
  }, 30_000);

  it("refuses when the page's stylesheet redirected to a URL that 404'd", async () => {
    await expect(shoot("/own-404-redirected")).rejects.toThrow(/moved\.css \(HTTP 404\)/);
  }, 30_000);

  it("refuses when the failed stylesheet's href carries a #fragment", async () => {
    await expect(shoot("/own-404-fragment")).rejects.toBeInstanceOf(UnstyledPageError);
  }, 30_000);

  it("refuses when the failed stylesheet is on the host the page redirected to", async () => {
    await expect(shoot("/redirect")).rejects.toThrow(/localhost:\d+\/missing\.css/);
  }, 30_000);

  it("names each failed stylesheet once, though the browser reports a 404 twice", async () => {
    const err = await shoot("/own-404").catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(UnstyledPageError);
    expect((err as Error).message).toMatch(/^1 stylesheet\(s\)/);
  }, 30_000);

  it("still photographs a page whose only failed stylesheets are print-only or a preload", async () => {
    expect((await shoot("/print-and-preload-404")).length).toBeGreaterThan(0);
  }, 30_000);

  it("still photographs a page whose only failed stylesheet is on another host", async () => {
    expect((await shoot("/third-party-404")).length).toBeGreaterThan(0);
  }, 30_000);
});

describe("ownHostStylesheetFailures", () => {
  const fail = (url: string) => ({ url, reason: "HTTP 404" });

  it("keeps failures on the requested host or the host it redirected to", () => {
    expect(
      ownHostStylesheetFailures(
        [
          fail("https://a.com/x.css"),
          fail("https://www.a.com/y.css"),
          fail("https://cdn.b.com/z.css"),
        ],
        ["https://a.com/", "https://www.a.com/"],
      ),
    ).toEqual(["https://a.com/x.css (HTTP 404)", "https://www.a.com/y.css (HTTP 404)"]);
  });

  it("drops third-party failures and unparseable URLs", () => {
    expect(
      ownHostStylesheetFailures(
        [fail("https://use.typekit.net/k.css"), fail("not a url")],
        ["https://gallerysonder.com/"],
      ),
    ).toEqual([]);
  });
});
