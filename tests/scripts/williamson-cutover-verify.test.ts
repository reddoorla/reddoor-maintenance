import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SITES,
  NETLIFY_APEX_IP,
  MAX_HOPS,
  parseArgs,
  hostsFor,
  proxyReexecEnv,
  transportLine,
  normMx,
  normTxt,
  verify,
  type FetchLike,
  type PageResult,
  type DnsResult,
  type CheckResult,
  type Site,
} from "../../scripts/williamson-cutover-verify.mjs";

type Page = { status: number; server?: string | null; location?: string; body?: string };
type Answers = Partial<Record<"MX" | "TXT", string[]>>;
type Dns = Record<string, Answers>;

const OK_BODY = "<!doctype html><html><body><h1>ok</h1></body></html>";
const WF_BODY = '<!doctype html><html data-wf-site="645ec08251dadc9000a072e5"><body></body></html>';

function greenPages(site: Site): Record<string, Page> {
  const pages: Record<string, Page> = {};
  for (const p of site.paths) {
    pages[`https://${site.apex}${p}`] = {
      status: 301,
      server: "Netlify",
      location: `https://${site.www}${p}`,
    };
    pages[`https://${site.www}${p}`] = { status: 200, server: "Netlify", body: OK_BODY };
    pages[`https://${site.preview}${p}`] = { status: 200, server: "Netlify", body: OK_BODY };
  }
  return pages;
}

function webflowPages(site: Site): Record<string, Page> {
  const pages: Record<string, Page> = {};
  for (const p of site.paths) {
    pages[`https://${site.apex}${p}`] = {
      status: 301,
      server: "cloudflare",
      location: `https://${site.www}${p}`,
    };
    pages[`https://${site.www}${p}`] = { status: 200, server: "cloudflare", body: WF_BODY };
  }
  return pages;
}

function greenDns(site: Site): Dns {
  return { [site.apex]: { MX: site.mx.map((m) => `${m}.`), TXT: [...site.txt] } };
}

function world(
  pages: Record<string, Page>,
  dns: Dns,
  opts: { cloudflareDns?: Dns; dnsStatus?: number; throwFor?: Record<string, Error> } = {},
): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (opts.throwFor?.[url]) throw opts.throwFor[url];
    if (u.hostname === "dns.google" || u.hostname === "cloudflare-dns.com") {
      const cf = u.hostname === "cloudflare-dns.com";
      const name = u.searchParams.get("name") ?? "";
      const type = (u.searchParams.get("type") ?? "") as "MX" | "TXT";
      const table = cf && opts.cloudflareDns ? opts.cloudflareDns : dns;
      const data = table[name]?.[type] ?? [];
      const code = type === "MX" ? 15 : 16;
      const Answer = data.map((d) => ({
        name: `${name}.`,
        type: code,
        TTL: 3600,
        data: cf && type === "TXT" ? `"${d}"` : d,
      }));
      return new Response(JSON.stringify({ Status: opts.dnsStatus ?? 0, Answer }), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      });
    }
    const page = pages[url];
    if (!page) throw new Error(`unrouted ${url}`);
    const headers: Record<string, string> = {};
    if (page.server !== null) headers.server = page.server ?? "Netlify";
    if (page.location) headers.location = page.location;
    return new Response(page.status >= 300 && page.status < 400 ? null : (page.body ?? ""), {
      status: page.status,
      headers,
    });
  };
  return { fetch, calls };
}

const homes = SITES.homes;
const construction = SITES.construction;

const pagesOf = (r: { results: CheckResult[] }) =>
  r.results.filter((x): x is PageResult => x.kind === "page");
const dnsOf = (r: { results: CheckResult[] }) =>
  r.results.filter((x): x is DnsResult => x.kind !== "page");
const problemsOf = (r: { results: CheckResult[] }) =>
  pagesOf(r)
    .flatMap((p) => p.problems)
    .concat(dnsOf(r).flatMap((d) => d.problems));

describe("verify on a Netlify-served site with the §2 records", () => {
  it("passes every page on apex and www, and MX and TXT on both resolvers", async () => {
    const { fetch } = world(greenPages(homes), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(pagesOf(r)).toHaveLength(homes.paths.length * 2);
    expect(dnsOf(r).map((d) => `${d.kind} ${d.resolver}`)).toEqual([
      "mx dns.google",
      "txt dns.google",
      "mx cloudflare-dns.com",
      "txt cloudflare-dns.com",
    ]);
    expect(r.lines.at(-1)).toMatch(/^GREEN: all 24 checks passed$/);
  });

  it("follows the apex 301 to www and records both hops", async () => {
    const { fetch } = world(greenPages(homes), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    const apex = pagesOf(r).find((p) => p.url === `https://${homes.apex}/projects`);
    expect(apex?.hops.map((h) => [h.status, h.url])).toEqual([
      [301, `https://${homes.apex}/projects`],
      [200, `https://${homes.www}/projects`],
    ]);
  });

  it("checks only the netlify.app host in --preview mode, and still reads the domain's MX", async () => {
    const { fetch, calls } = world(greenPages(construction), greenDns(construction));
    const r = await verify({ sites: ["construction"], preview: true }, { fetch });
    expect(r.ok).toBe(true);
    expect(pagesOf(r)).toHaveLength(14);
    expect(calls.some((c) => c.includes(construction.www))).toBe(false);
    expect(calls).toContain(`https://dns.google/resolve?name=${construction.apex}&type=MX`);
  });

  it("checks both sites by default", async () => {
    const { fetch } = world(
      { ...greenPages(homes), ...greenPages(construction) },
      { ...greenDns(homes), ...greenDns(construction) },
    );
    const r = await verify(parseArgs([]), { fetch });
    expect(r.ok).toBe(true);
    expect(pagesOf(r)).toHaveLength((10 + 14) * 2);
  });
});

describe("verify on today's Webflow-served hosts", () => {
  it("fails every page: Cloudflare, not Netlify, serves them, and the markup is Webflow's", async () => {
    const { fetch } = world(webflowPages(homes), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(pagesOf(r).every((p) => !p.ok)).toBe(true);
    expect(dnsOf(r).every((d) => d.ok)).toBe(true);
    const www = pagesOf(r).find((p) => p.url === `https://${homes.www}/`);
    expect(www?.problems).toEqual([
      `server: cloudflare at https://${homes.www}/`,
      "data-wf-site present",
    ]);
    expect(r.lines.at(-1)).toBe("RED: 20 of 24 checks failed");
  });
});

describe("mutation 1: a page that still carries data-wf-site", () => {
  it("fails that page even though Netlify serves it", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/projects/manhattan-beach`] = {
      status: 200,
      server: "Netlify",
      body: WF_BODY,
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    const bad = pagesOf(r).filter((p) => !p.ok);
    expect(bad.map((p) => p.url).sort()).toEqual([
      `https://${homes.apex}/projects/manhattan-beach`,
      `https://${homes.www}/projects/manhattan-beach`,
    ]);
    expect(bad.every((p) => p.problems.includes("data-wf-site present"))).toBe(true);
  });

  it("fails a page that still loads assets from Webflow's CDN", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.preview}/about-us`] = {
      status: 200,
      server: "Netlify",
      body: '<img src="https://cdn.prod.website-files.com/645ec/a.jpg">',
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(r.ok).toBe(false);
    expect(problemsOf(r)).toEqual(["loads from website-files.com"]);
  });
});

describe("mutation 2: changed MX answers", () => {
  it("fails when the exchange changes", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = { ...dns[homes.apex], MX: ["10 mx1.secureserver.net."] };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    const mx = dnsOf(r).filter((d) => d.kind === "mx");
    expect(mx.every((d) => !d.ok)).toBe(true);
    expect(mx[0]?.problems).toEqual([
      `missing MX ${homes.mx[0]}`,
      "unexpected MX 10 mx1.secureserver.net",
    ]);
  });

  it("fails when a zone replace drops the MX entirely", async () => {
    const dns = greenDns(construction);
    dns[construction.apex] = { TXT: [...construction.txt] };
    const { fetch } = world(greenPages(construction), dns);
    const r = await verify({ sites: ["construction"], preview: true }, { fetch });
    expect(r.ok).toBe(false);
    expect(problemsOf(r)).toEqual([
      `missing MX ${construction.mx[0]}`,
      `missing MX ${construction.mx[0]}`,
    ]);
  });

  it("fails when only the second resolver sees the change", async () => {
    const cf = greenDns(homes);
    cf[homes.apex] = { ...cf[homes.apex], MX: [] };
    const { fetch } = world(greenPages(homes), greenDns(homes), { cloudflareDns: cf });
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    expect(
      dnsOf(r)
        .filter((d) => !d.ok)
        .map((d) => `${d.kind} ${d.resolver}`),
    ).toEqual(["mx cloudflare-dns.com"]);
  });

  it("fails when an extra MX is added beside the §2 one", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = { ...dns[homes.apex], MX: [`${homes.mx[0]}.`, "10 backup.example.com."] };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
  });

  it("fails when SPF is gone, though MX survives", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = {
      ...dns[homes.apex],
      TXT: homes.txt.filter((t) => !t.startsWith("v=spf1")),
    };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    expect(dnsOf(r).filter((d) => d.kind === "txt" && !d.ok)).toHaveLength(2);
    expect(problemsOf(r)[0]).toBe("missing TXT v=spf1 include:spf.protection.outlook.com -all");
  });

  it("fails when the resolver answers with an error status", async () => {
    const { fetch } = world(greenPages(homes), greenDns(homes), { dnsStatus: 2 });
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    expect(dnsOf(r).every((d) => d.problems.some((p) => /status 2 \(SERVFAIL\)/.test(p)))).toBe(
      true,
    );
  });
});

describe("mutation 3: a 301 loop on the apex", () => {
  it("fails with the loop spelled out", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/`] = {
      status: 301,
      server: "Netlify",
      location: `https://${homes.apex}/`,
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    const apex = pagesOf(r).find((p) => p.url === `https://${homes.apex}/`);
    expect(apex?.problems).toEqual([
      `redirect loop: https://${homes.apex}/ → https://${homes.www}/ → https://${homes.apex}/`,
    ]);
  });

  it("fails a chain longer than the hop cap", async () => {
    const pages = greenPages(homes);
    const hops = MAX_HOPS + 2;
    for (let i = 0; i < hops; i++) {
      const from =
        i === 0 ? `https://${homes.apex}/contact` : `https://${homes.www}/contact?h=${i}`;
      pages[from] = {
        status: 302,
        server: "Netlify",
        location: `https://${homes.www}/contact?h=${i + 1}`,
      };
    }
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    const apex = pagesOf(r).find((p) => p.url === `https://${homes.apex}/contact`);
    expect(apex?.problems).toEqual([`more than ${MAX_HOPS} redirects`]);
  });
});

describe("mutation 4: a path missing from the new host", () => {
  it("fails a 404, on www and through the apex redirect", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/projects/palos-verdes-west`] = {
      status: 404,
      server: "Netlify",
      body: "Not found",
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    const bad = pagesOf(r).filter((p) => !p.ok);
    expect(bad).toHaveLength(2);
    expect(
      bad.every((p) =>
        p.problems.includes(`status 404 at https://${homes.www}/projects/palos-verdes-west`),
      ),
    ).toBe(true);
  });

  it("fails a missing page hidden behind a catch-all redirect to home", async () => {
    const pages = greenPages(construction);
    pages[`https://${construction.preview}/join-the-team`] = {
      status: 301,
      server: "Netlify",
      location: "/",
    };
    const { fetch } = world(pages, greenDns(construction));
    const r = await verify({ sites: ["construction"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual(["landed on /, not /join-the-team"]);
  });

  it("accepts a trailing-slash redirect to the same page", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.preview}/projects`] = {
      status: 308,
      server: "Netlify",
      location: "/projects/",
    };
    pages[`https://${homes.preview}/projects/`] = { status: 200, server: "Netlify", body: OK_BODY };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(r.ok).toBe(true);
  });
});

describe("the other page checks", () => {
  it("fails a redirect that leaves the domain", async () => {
    const pages = greenPages(construction);
    pages[`https://${construction.apex}/services`] = {
      status: 301,
      server: "Netlify",
      location: "https://williamson-construction.webflow.io/services",
    };
    const { fetch } = world(pages, greenDns(construction));
    const r = await verify({ sites: ["construction"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([
      "redirected off-site to https://williamson-construction.webflow.io/services",
    ]);
  });

  it("fails a redirect down to http", async () => {
    const pages = greenPages(construction);
    pages[`https://${construction.apex}/`] = {
      status: 301,
      server: "Netlify",
      location: `http://${construction.www}/`,
    };
    const { fetch } = world(pages, greenDns(construction));
    const r = await verify({ sites: ["construction"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([`redirect leaves https: http://${construction.www}/`]);
  });

  it("fails an apex still answered by Webflow even when www is on Netlify", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.apex}/about-us`] = {
      status: 301,
      server: "cloudflare",
      location: `https://${homes.www}/about-us`,
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([`server: cloudflare at https://${homes.apex}/about-us`]);
  });

  it("fails a response with no server header", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.preview}/contact`] = { status: 200, server: null, body: OK_BODY };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([`server: (none) at https://${homes.preview}/contact`]);
  });

  it("fails an invalid certificate and names the TLS error", async () => {
    const url = `https://${homes.www}/`;
    const cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    const { fetch } = world(greenPages(homes), greenDns(homes), {
      throwFor: { [url]: new TypeError("fetch failed", { cause }) },
    });
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    const bad = pagesOf(r).filter((p) => !p.ok);
    expect(bad.map((p) => p.problems)).toEqual([
      [`certificate invalid at ${url}: CERT_HAS_EXPIRED`],
      [`certificate invalid at ${url}: CERT_HAS_EXPIRED`],
    ]);
  });

  it("fails a host-name mismatch as a certificate problem", async () => {
    const url = `https://${homes.preview}/`;
    const cause = Object.assign(new Error("Hostname/IP does not match"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    const { fetch } = world(greenPages(homes), greenDns(homes), {
      throwFor: { [url]: new TypeError("fetch failed", { cause }) },
    });
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([`certificate invalid at ${url}: ERR_TLS_CERT_ALTNAME_INVALID`]);
  });

  it("fails a network error that is not a certificate problem", async () => {
    const url = `https://${homes.preview}/`;
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const { fetch } = world(greenPages(homes), greenDns(homes), {
      throwFor: { [url]: new TypeError("fetch failed", { cause }) },
    });
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([`request failed at ${url}: ENOTFOUND`]);
  });
});

describe("parsing", () => {
  it("reads the flags", () => {
    expect(parseArgs([])).toEqual({ sites: ["homes", "construction"], preview: false });
    expect(parseArgs(["--site", "homes"])).toEqual({ sites: ["homes"], preview: false });
    expect(parseArgs(["--site", "all", "--preview"])).toEqual({
      sites: ["homes", "construction"],
      preview: true,
    });
    expect(() => parseArgs(["--site", "domaru"])).toThrow(/--site/);
    expect(() => parseArgs(["--site"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--apply"])).toThrow(/unknown argument/);
  });

  it("re-runs through the proxy's CONNECT tunnel whenever a proxy is set", () => {
    expect(proxyReexecEnv({ PATH: "/bin" })).toBeNull();
    expect(
      proxyReexecEnv({ HTTPS_PROXY: "http://127.0.0.1:1", NODE_USE_ENV_PROXY: "1" }),
    ).toBeNull();
    expect(proxyReexecEnv({ https_proxy: "http://127.0.0.1:1", PATH: "/bin" })).toEqual({
      https_proxy: "http://127.0.0.1:1",
      PATH: "/bin",
      NODE_USE_ENV_PROXY: "1",
    });
    expect(proxyReexecEnv({ HTTPS_PROXY: "http://127.0.0.1:1", NODE_USE_ENV_PROXY: "0" })).toEqual({
      HTTPS_PROXY: "http://127.0.0.1:1",
      NODE_USE_ENV_PROXY: "1",
    });
    expect(transportLine({ HTTPS_PROXY: "x", NODE_USE_ENV_PROXY: "1" })).toMatch(/CONNECT tunnel/);
    expect(transportLine({})).toMatch(/direct connection/);
  });

  it("picks the hosts", () => {
    expect(hostsFor(homes, false)).toEqual(["williamson-homes.com", "www.williamson-homes.com"]);
    expect(hostsFor(homes, true)).toEqual(["williamson-homes.netlify.app"]);
  });

  it("normalizes MX and TXT answers from both resolvers", () => {
    expect(normMx("0 WilliamsonHomes-com02e.mail.protection.outlook.com.")).toBe(
      "0 williamsonhomes-com02e.mail.protection.outlook.com",
    );
    expect(normTxt('"v=spf1 include:spf.protection.outlook.com -all"')).toBe(
      "v=spf1 include:spf.protection.outlook.com -all",
    );
    expect(normTxt('"v=spf1 include:a" " -all"')).toBe("v=spf1 include:a -all");
    expect(normTxt("v=verifydomain MS=7526292")).toBe("v=verifydomain MS=7526292");
  });
});

describe("the plan and the checklist say what the verifier checks", () => {
  const plan = readFileSync("docs/webflow-conversions-2026-10.md", "utf-8");
  const runbook = readFileSync("docs/runbooks/williamson-cutover-2026-10-14.md", "utf-8");
  const section = (heading: string) => {
    const start = plan.indexOf(heading);
    const end = plan.indexOf("\n### ", start + heading.length);
    return plan.slice(start, end);
  };
  const cases: [Site, string][] = [
    [homes, "### 2.1 Williamson Homes"],
    [construction, "### 2.2 Williamson Construction"],
  ];

  it.each(cases)("%#: every path is one §2 lists, and the count matches §2", (site, heading) => {
    const text = section(heading);
    expect(text.length).toBeGreaterThan(100);
    const count = Number(/\*\*Pages: (\d+),/.exec(text)?.[1]);
    expect(site.paths).toHaveLength(count);
    expect(new Set(site.paths).size).toBe(count);
    for (const p of site.paths.filter((x) => x !== "/")) {
      const last = p.split("/").at(-1);
      expect(text, p).toMatch(new RegExp("`(/" + last + "|" + last + ")`"));
    }
  });

  it.each(cases)("%#: §2 and the checklist carry the exact MX and TXT values", (site, heading) => {
    const text = section(heading);
    for (const v of [...site.mx, ...site.txt]) {
      expect(text, v).toContain(v);
      expect(runbook, v).toContain(v);
    }
  });

  it("the checklist names the targets and the DO NOT TOUCH rule", () => {
    expect(runbook).toContain(NETLIFY_APEX_IP);
    for (const site of [homes, construction]) {
      expect(runbook).toContain(site.preview);
      expect(runbook).toContain(site.netlifyId);
    }
    expect(runbook).toContain("DO NOT TOUCH");
    expect(runbook).toContain("node scripts/williamson-cutover-verify.mjs");
  });
});
