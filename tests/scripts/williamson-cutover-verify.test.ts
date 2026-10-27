import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
  type ResponseLike,
  type PageResult,
  type DnsResult,
  type CheckResult,
  type Site,
} from "../../scripts/williamson-cutover-verify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(ROOT, "scripts/williamson-cutover-verify.mjs");

type Page = {
  status: number;
  server?: string | null;
  location?: string;
  body?: string;
  headers?: Record<string, string>;
  textError?: Error;
};
type RecordType = "A" | "CNAME" | "MX" | "TXT";
type Dns = Record<string, Partial<Record<RecordType, string[]>>>;

const TYPE_CODES: Record<RecordType, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16 };

const html = (canonical: string, extra = "") =>
  `<!doctype html><html><head><link rel="canonical" href="${canonical}"/>${extra}</head><body><h1>ok</h1></body></html>`;
const WF_BODY = (canonical: string) =>
  `<!doctype html><html data-wf-site="645ec08251dadc9000a072e5"><head><link rel="canonical" href="${canonical}"/></head><body></body></html>`;

function greenPages(site: Site): Record<string, Page> {
  const pages: Record<string, Page> = {};
  for (const p of site.paths) {
    pages[`https://${site.apex}${p}`] = {
      status: 301,
      server: "Netlify",
      location: `https://${site.www}${p}`,
    };
    pages[`https://${site.www}${p}`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${site.www}${p}`),
    };
    pages[`https://${site.preview}${p}`] = {
      status: 200,
      server: "Netlify",
      headers: { "x-robots-tag": "noindex, nofollow" },
      body: html(`https://${site.preview}${p}`),
    };
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
    pages[`https://${site.www}${p}`] = {
      status: 200,
      server: "cloudflare",
      body: WF_BODY(`https://${site.www}${p}`),
    };
  }
  return pages;
}

function greenDns(site: Site): Dns {
  return {
    [site.apex]: { A: [NETLIFY_APEX_IP], MX: site.mx.map((m) => `${m}.`), TXT: [...site.txt] },
    [site.www]: { CNAME: [`${site.preview}.`] },
  };
}

function webflowDns(site: Site): Dns {
  const dns = greenDns(site);
  return {
    ...dns,
    [site.apex]: { ...dns[site.apex], A: ["198.202.211.1"] },
    [site.www]: { CNAME: ["cdn.webflow.com."] },
  };
}

function world(
  pages: Record<string, Page>,
  dns: Dns,
  opts: { cloudflareDns?: Dns; dnsStatus?: number; throwFor?: Record<string, Error> } = {},
): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (init?.redirect !== "manual") throw new Error(`fetch without redirect: "manual": ${url}`);
    calls.push(url);
    const u = new URL(url);
    if (opts.throwFor?.[url]) throw opts.throwFor[url];
    if (u.hostname === "dns.google" || u.hostname === "cloudflare-dns.com") {
      const cf = u.hostname === "cloudflare-dns.com";
      if (cf && init.headers.accept !== "application/dns-json")
        return new Response("bad request", { status: 400 });
      const name = u.searchParams.get("name") ?? "";
      const type = (u.searchParams.get("type") ?? "") as RecordType;
      const table = cf && opts.cloudflareDns ? opts.cloudflareDns : dns;
      const Answer = (table[name]?.[type] ?? []).map((d) => ({
        name: `${name}.`,
        type: TYPE_CODES[type],
        TTL: 600,
        data: cf && type === "TXT" ? `"${d}"` : d,
      }));
      return new Response(JSON.stringify({ Status: opts.dnsStatus ?? 0, Answer }), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      });
    }
    const page = pages[url];
    if (!page) throw new Error(`unrouted ${url}`);
    const headers: Record<string, string> = { ...page.headers };
    if (page.server !== null) headers.server = page.server ?? "Netlify";
    if (page.location) headers.location = page.location;
    if (page.textError) {
      const err = page.textError;
      const res: ResponseLike = {
        status: page.status,
        headers: new Headers(headers),
        text: () => Promise.reject(err),
        body: null,
      };
      return res;
    }
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
const pageAt = (r: { results: CheckResult[] }, url: string) =>
  pagesOf(r).find((p) => p.url === url);

describe("verify on a Netlify-served site with the §2 records", () => {
  it("passes every page on apex and www, and A, CNAME, MX and TXT on both resolvers", async () => {
    const { fetch } = world(greenPages(homes), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(pagesOf(r)).toHaveLength(homes.paths.length * 2);
    expect(dnsOf(r).map((d) => `${d.kind} ${d.name} ${d.resolver}`)).toEqual([
      `a ${homes.apex} dns.google`,
      `cname ${homes.www} dns.google`,
      `mx ${homes.apex} dns.google`,
      `txt ${homes.apex} dns.google`,
      `a ${homes.apex} cloudflare-dns.com`,
      `cname ${homes.www} cloudflare-dns.com`,
      `mx ${homes.apex} cloudflare-dns.com`,
      `txt ${homes.apex} cloudflare-dns.com`,
    ]);
    expect(r.lines.at(-1)).toBe("GREEN: all 28 checks passed");
  });

  it("follows the apex 301 to www and records both hops", async () => {
    const { fetch } = world(greenPages(homes), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(pageAt(r, `https://${homes.apex}/projects`)?.hops.map((h) => [h.status, h.url])).toEqual(
      [
        [301, `https://${homes.apex}/projects`],
        [200, `https://${homes.www}/projects`],
      ],
    );
  });

  it("in --preview mode checks only the netlify.app host, tolerates its noindex, and reads MX and TXT only", async () => {
    const { fetch, calls } = world(greenPages(construction), greenDns(construction));
    const r = await verify({ sites: ["construction"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([]);
    expect(pagesOf(r)).toHaveLength(14);
    expect(dnsOf(r).map((d) => d.kind)).toEqual(["mx", "txt", "mx", "txt"]);
    expect(calls.some((c) => c.includes(`https://${construction.www}`))).toBe(false);
    expect(calls.some((c) => /type=(A|CNAME)$/.test(c))).toBe(false);
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
    expect(r.lines.at(-1)).toBe("GREEN: all 64 checks passed");
  });
});

describe("verify on today's Webflow-served hosts", () => {
  it("fails every page, the apex A and the www CNAME; MX and TXT still pass", async () => {
    const { fetch } = world(webflowPages(homes), webflowDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(pagesOf(r).every((p) => !p.ok)).toBe(true);
    expect(pageAt(r, `https://${homes.www}/`)?.problems).toEqual([
      `server: cloudflare at https://${homes.www}/`,
      "data-wf-site present",
    ]);
    expect(
      dnsOf(r)
        .filter((d) => !d.ok)
        .map((d) => `${d.kind} ${d.resolver}: ${d.problems.join("; ")}`),
    ).toEqual([
      `a dns.google: missing A ${NETLIFY_APEX_IP}; unexpected A 198.202.211.1`,
      `cname dns.google: missing CNAME ${homes.preview}; unexpected CNAME cdn.webflow.com`,
      `a cloudflare-dns.com: missing A ${NETLIFY_APEX_IP}; unexpected A 198.202.211.1`,
      `cname cloudflare-dns.com: missing CNAME ${homes.preview}; unexpected CNAME cdn.webflow.com`,
    ]);
    expect(r.lines.at(-1)).toBe("RED: 24 of 28 checks failed");
  });
});

describe("mutation 1: a page that still carries data-wf-site", () => {
  it("fails that page even though Netlify serves it", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/projects/manhattan-beach`] = {
      status: 200,
      server: "Netlify",
      body: WF_BODY(`https://${homes.www}/projects/manhattan-beach`),
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
    expect(problemsOf(r)).toEqual([
      "unexpected MX 10 backup.example.com",
      "unexpected MX 10 backup.example.com",
    ]);
  });

  it("fails when SPF is gone, though MX survives", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = {
      ...dns[homes.apex],
      TXT: homes.txt.filter((t) => !t.startsWith("v=spf1")),
    };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(dnsOf(r).filter((d) => d.kind === "txt" && !d.ok)).toHaveLength(2);
    expect(problemsOf(r)[0]).toBe("missing TXT v=spf1 include:spf.protection.outlook.com -all");
  });

  it("fails when a second SPF record is added", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = {
      ...dns[homes.apex],
      TXT: [...homes.txt, "v=spf1 include:secureserver.net -all"],
    };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([
      "2 SPF records, which receivers treat as a permerror",
      "2 SPF records, which receivers treat as a permerror",
    ]);
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

describe("the cutover's own two records", () => {
  it("fails a new apex A added beside the old one instead of replacing it", async () => {
    const dns = greenDns(homes);
    dns[homes.apex] = { ...dns[homes.apex], A: [NETLIFY_APEX_IP, "198.202.211.1"] };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual(["unexpected A 198.202.211.1", "unexpected A 198.202.211.1"]);
  });

  it("fails a www CNAME aimed at the other site's netlify.app name", async () => {
    const dns = greenDns(homes);
    dns[homes.www] = { CNAME: [`${construction.preview}.`] };
    const { fetch } = world(greenPages(homes), dns);
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(dnsOf(r).find((d) => d.kind === "cname")?.problems).toEqual([
      `missing CNAME ${homes.preview}`,
      `unexpected CNAME ${construction.preview}`,
    ]);
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
    expect(pageAt(r, `https://${homes.apex}/`)?.problems).toEqual([
      `redirect loop: https://${homes.apex}/ → https://${homes.www}/ → https://${homes.apex}/`,
    ]);
  });

  const chain = (redirects: number): Record<string, Page> => {
    const pages = greenPages(homes);
    for (let i = 0; i < redirects; i++) {
      const from =
        i === 0 ? `https://${homes.apex}/contact` : `https://${homes.www}/contact?h=${i}`;
      pages[from] = {
        status: 302,
        server: "Netlify",
        location: `https://${homes.www}/contact?h=${i + 1}`,
      };
    }
    pages[`https://${homes.www}/contact?h=${redirects}`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${homes.www}/contact`),
    };
    return pages;
  };

  it(`passes a chain of exactly ${MAX_HOPS} redirects`, async () => {
    const { fetch } = world(chain(MAX_HOPS), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(pageAt(r, `https://${homes.apex}/contact`)?.hops).toHaveLength(MAX_HOPS + 1);
    expect(problemsOf(r)).toEqual([]);
  });

  it(`fails a chain of ${MAX_HOPS + 1} redirects`, async () => {
    const { fetch } = world(chain(MAX_HOPS + 1), greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(pageAt(r, `https://${homes.apex}/contact`)?.problems).toEqual([
      `more than ${MAX_HOPS} redirects`,
    ]);
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
    pages[`https://${homes.preview}/projects/`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${homes.preview}/projects`),
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(r.ok).toBe(true);
  });
});

describe("what Google will see on the production hosts", () => {
  it("fails a canonical still baked to the netlify.app host (no redeploy after the domain was set)", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/about-us`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${homes.preview}/about-us`),
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([
      `canonical points at https://${homes.preview}/about-us`,
      `canonical points at https://${homes.preview}/about-us`,
    ]);
  });

  it("fails a canonical on www over plain http", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/about-us`] = {
      status: 200,
      server: "Netlify",
      body: html(`http://${homes.www}/about-us`),
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([
      `canonical points at http://${homes.www}/about-us`,
      `canonical points at http://${homes.www}/about-us`,
    ]);
  });

  it("fails a page with no canonical link", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/contact`] = { status: 200, server: "Netlify", body: "<p>hi</p>" };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual(["no canonical link", "no canonical link"]);
  });

  it("fails a noindex header and a noindex meta tag", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.www}/`] = {
      status: 200,
      server: "Netlify",
      headers: { "x-robots-tag": "noindex, nofollow" },
      body: html(`https://${homes.www}/`),
    };
    pages[`https://${homes.www}/projects`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${homes.www}/projects`, '<meta name="robots" content="noindex"/>'),
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(pageAt(r, `https://${homes.www}/`)?.problems).toEqual([
      "x-robots-tag: noindex, nofollow",
    ]);
    expect(pageAt(r, `https://${homes.www}/projects`)?.problems).toEqual(["meta robots: noindex"]);
  });

  it("fails when the apex, not www, ends up as the primary host", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.apex}/`] = {
      status: 200,
      server: "Netlify",
      body: html(`https://${homes.www}/`),
    };
    pages[`https://${homes.www}/`] = {
      status: 301,
      server: "Netlify",
      location: `https://${homes.apex}/`,
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: false }, { fetch });
    expect(problemsOf(r)).toEqual([
      `landed on ${homes.apex}, not ${homes.www}`,
      `landed on ${homes.apex}, not ${homes.www}`,
    ]);
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

  it("fails a redirect with no location, and one with an unreadable location", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.preview}/contact`] = { status: 302, server: "Netlify" };
    pages[`https://${homes.preview}/about-us`] = {
      status: 301,
      server: "Netlify",
      location: "https://[bad",
    };
    const { fetch } = world(pages, greenDns(homes));
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([
      `unreadable location "https://[bad" at https://${homes.preview}/about-us`,
      `302 without a location at https://${homes.preview}/contact`,
    ]);
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
    pages[`https://${homes.preview}/contact`] = {
      status: 200,
      server: null,
      body: html(`https://${homes.preview}/contact`),
    };
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
    expect(problemsOf(r)).toEqual([
      `certificate invalid at ${url}: CERT_HAS_EXPIRED`,
      `certificate invalid at ${url}: CERT_HAS_EXPIRED`,
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

  it("fails a network error, a timeout and a body cut off mid-read, without crashing the run", async () => {
    const pages = greenPages(homes);
    pages[`https://${homes.preview}/contact`] = {
      status: 200,
      server: "Netlify",
      textError: new TypeError("terminated"),
    };
    const refused = `https://${homes.preview}/`;
    const slow = `https://${homes.preview}/projects`;
    const { fetch } = world(pages, greenDns(homes), {
      throwFor: {
        [refused]: new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        }),
        [slow]: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      },
    });
    const r = await verify({ sites: ["homes"], preview: true }, { fetch });
    expect(problemsOf(r)).toEqual([
      `request failed at ${refused}: ECONNREFUSED`,
      `timed out at ${slow}`,
      `request failed at https://${homes.preview}/contact: terminated`,
    ]);
    expect(pagesOf(r)).toHaveLength(10);
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

describe("the command line", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", HTTPS_PROXY: "http://127.0.0.1:9" },
      timeout: 60_000,
    });

  it("re-runs itself through the proxy, prints every check, and exits 1 when nothing answers", () => {
    const r = run(["--site", "homes"]);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^TLS: CONNECT tunnel through HTTPS_PROXY/);
    expect(lines.filter((l) => l.startsWith("  FAIL "))).toHaveLength(28);
    expect(lines.at(-1)).toBe("RED: 28 of 28 checks failed");
    expect(r.status).toBe(1);
  });

  it("exits 2 with the usage on a bad flag, before any request", () => {
    const r = run(["--site", "domaru"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/--site needs homes, construction or all/);
    expect(r.stderr).toMatch(/^usage: /m);
  });
});

describe("the plan and the checklist say what the verifier checks", () => {
  const plan = readFileSync(join(ROOT, "docs/webflow-conversions-2026-10.md"), "utf-8");
  const runbook = readFileSync(
    join(ROOT, "docs/runbooks/williamson-cutover-2026-10-14.md"),
    "utf-8",
  );
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
    expect(site.paths[0]).toBe("/");
    expect(text).toContain("`/projects/<slug>`");
    for (const p of site.paths.slice(1)) {
      const m = /^\/projects\/([a-z0-9-]+)$/.exec(p);
      if (m) expect(text, p).toContain("`" + m[1] + "`");
      else expect(text, p).toMatch(new RegExp("`" + p + "`"));
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
