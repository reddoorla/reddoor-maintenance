#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PROJECTS = (slugs) => slugs.map((s) => `/projects/${s}`);

export const SITES = {
  homes: {
    key: "homes",
    label: "Williamson Homes",
    apex: "williamson-homes.com",
    www: "www.williamson-homes.com",
    preview: "williamson-homes.netlify.app",
    netlifyId: "9072ea82-4428-4ff2-b941-63084eaecb1b",
    paths: [
      "/",
      "/projects",
      "/about-us",
      "/contact",
      ...PROJECTS([
        "palos-verdes-cove",
        "pv-malaga-cove",
        "manhattan-beach",
        "hermosa-home-gym",
        "palos-verdes-north",
        "palos-verdes-west",
      ]),
    ],
    mx: ["0 williamsonhomes-com02e.mail.protection.outlook.com"],
    txt: [
      "v=spf1 include:spf.protection.outlook.com -all",
      "v=verifydomain MS=7526292",
      "google-site-verification=5M-cvpiEh6WVPkbik9fboRy3MRD42q6dix6GBxTPdNc",
    ],
  },
  construction: {
    key: "construction",
    label: "Williamson Construction",
    apex: "williamson-construction.com",
    www: "www.williamson-construction.com",
    preview: "williamson-construction-co.netlify.app",
    netlifyId: "7e2831e2-1a1b-4184-8399-981d0f6361c1",
    paths: [
      "/",
      "/about-us",
      "/services",
      "/projects",
      "/contact",
      "/join-the-team",
      ...PROJECTS([
        "cedars-sinai-beverly-hills",
        "cedars-sinai-pro-building-cooling-tower-refurbishment",
        "providence-express-care",
        "providence-hospital-little-company-of-mary",
        "providence-saint-johns",
        "west-high-school",
        "torrance-high-school",
        "mbm-hospitality",
      ]),
    ],
    mx: ["0 williamsonconstruction-com02e.mail.protection.outlook.com"],
    txt: ["v=spf1 include:spf.protection.outlook.com ~all", "v=verifydomain MS=1109765"],
  },
};

export const NETLIFY_APEX_IP = "75.2.60.5";
export const MAX_HOPS = 5;

export const RESOLVERS = [
  {
    name: "dns.google",
    url: (name, type) => `https://dns.google/resolve?name=${name}&type=${type}`,
  },
  {
    name: "cloudflare-dns.com",
    url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${name}&type=${type}`,
  },
];

const TYPE_CODES = { A: 1, CNAME: 5, MX: 15, TXT: 16 };
const RCODES = { 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED" };
const UA = "reddoor-cutover-verify (+https://github.com/reddoorla/reddoor-maintenance)";
const CERT_CODE = /CERT|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;

const USAGE =
  "usage: node scripts/williamson-cutover-verify.mjs [--site homes|construction|all] [--preview]";

export function parseArgs(argv) {
  const o = { sites: ["homes", "construction"], preview: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("--site needs a value");
      if (v === "all") o.sites = ["homes", "construction"];
      else if (v === "homes" || v === "construction") o.sites = [v];
      else throw new Error(`--site needs homes, construction or all, got ${v}`);
    } else if (a === "--preview") o.preview = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function proxyReexecEnv(env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return null;
  return { ...env, NODE_USE_ENV_PROXY: "1" };
}

export function transportLine(env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  return proxy && env.NODE_USE_ENV_PROXY === "1"
    ? "TLS: CONNECT tunnel through HTTPS_PROXY, so each site's own certificate is the one checked"
    : "TLS: direct connection, so each site's own certificate is the one checked";
}

export function hostsFor(site, preview) {
  return preview ? [site.preview] : [site.apex, site.www];
}

export function normMx(data) {
  return data.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
}

export function normTxt(data) {
  const s = data.trim();
  if (!s.startsWith('"')) return s;
  return [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1")).join("");
}

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const ROBOTS_META = /<meta\b[^>]*\bname=["']?robots\b[^>]*>/i;
const CANONICAL = /<link\b[^>]*\brel=["']?canonical\b[^>]*>/i;
const attr = (tag, name) => new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];

function originOf(href, base) {
  try {
    return new URL(href, base).origin;
  } catch {
    return null;
  }
}

function describeError(e, url) {
  const code = e?.cause?.code ?? e?.code ?? "";
  if (CERT_CODE.test(code)) return `certificate invalid at ${url}: ${code}`;
  if (e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError") return `timed out at ${url}`;
  return `request failed at ${url}: ${code || e?.cause?.message || e?.message || String(e)}`;
}

async function discard(res) {
  await res.body?.cancel().catch(() => undefined);
}

function contentProblems(site, path, url, res, body, production) {
  const out = [];
  const at = new URL(url);
  const landed = trimSlash(at.pathname);
  if (landed !== trimSlash(path)) out.push(`landed on ${landed}, not ${trimSlash(path)}`);
  if (/data-wf-site/i.test(body)) out.push("data-wf-site present");
  if (/website-files\.com/i.test(body)) out.push("loads from website-files.com");
  if (!production) return out;
  if (at.hostname !== site.www) out.push(`landed on ${at.hostname}, not ${site.www}`);
  const robots = res.headers.get("x-robots-tag");
  if (robots && /noindex/i.test(robots)) out.push(`x-robots-tag: ${robots}`);
  const meta = ROBOTS_META.exec(body)?.[0];
  const content = meta ? (attr(meta, "content") ?? "") : "";
  if (/noindex/i.test(content)) out.push(`meta robots: ${content}`);
  const link = CANONICAL.exec(body)?.[0];
  const href = link ? attr(link, "href") : undefined;
  if (!href) out.push("no canonical link");
  else if (originOf(href, url) !== `https://${site.www}`) out.push(`canonical points at ${href}`);
  return out;
}

export async function checkPage(site, host, path, allowed, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const production = host !== site.preview;
  const start = `https://${host}${path}`;
  const hops = [];
  const problems = [];
  const seen = new Set();
  let url = start;
  try {
    for (;;) {
      if (seen.has(url)) {
        problems.push(`redirect loop: ${[...hops.map((h) => h.url), url].join(" → ")}`);
        break;
      }
      if (hops.length > MAX_HOPS) {
        problems.push(`more than ${MAX_HOPS} redirects`);
        break;
      }
      seen.add(url);
      const res = await fetchImpl(url, {
        redirect: "manual",
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const server = res.headers.get("server");
      const location = res.headers.get("location");
      hops.push({ url, status: res.status, server, location });
      if ((server ?? "").trim().toLowerCase() !== "netlify")
        problems.push(`server: ${server ?? "(none)"} at ${url}`);
      if (res.status >= 300 && res.status < 400) {
        await discard(res);
        if (!location) {
          problems.push(`${res.status} without a location at ${url}`);
          break;
        }
        let next;
        try {
          next = new URL(location, url);
        } catch {
          problems.push(`unreadable location ${JSON.stringify(location)} at ${url}`);
          break;
        }
        if (next.protocol !== "https:") {
          problems.push(`redirect leaves https: ${next.href}`);
          break;
        }
        if (!allowed.includes(next.hostname)) {
          problems.push(`redirected off-site to ${next.href}`);
          break;
        }
        url = next.href;
        continue;
      }
      if (res.status !== 200) {
        await discard(res);
        problems.push(`status ${res.status} at ${url}`);
        break;
      }
      const body = await res.text();
      problems.push(...contentProblems(site, path, url, res, body, production));
      break;
    }
  } catch (e) {
    problems.push(describeError(e, url));
  }
  return { kind: "page", site: site.key, url: start, ok: problems.length === 0, problems, hops };
}

const NORM = { A: (d) => d.trim(), CNAME: normMx, MX: normMx, TXT: normTxt };

async function lookup(resolver, name, type, deps) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  try {
    const res = await fetchImpl(resolver.url(name, type), {
      redirect: "manual",
      headers: { accept: "application/dns-json", "user-agent": UA },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
    });
    if (res.status !== 200) {
      await discard(res);
      return { error: `${type} lookup via ${resolver.name} answered HTTP ${res.status}` };
    }
    const j = JSON.parse(await res.text());
    if (j.Status !== 0)
      return {
        error: `${type} lookup via ${resolver.name} answered status ${j.Status} (${RCODES[j.Status] ?? "?"})`,
      };
    return {
      answers: (j.Answer ?? [])
        .filter((a) => a.type === TYPE_CODES[type])
        .map((a) => NORM[type](a.data)),
    };
  } catch (e) {
    return { error: `${type} lookup via ${resolver.name} failed: ${e?.cause?.code ?? e?.message}` };
  }
}

function exactProblems(type, got, want) {
  const out = [];
  for (const w of want) if (!got.includes(w)) out.push(`missing ${type} ${w}`);
  for (const g of got) if (!want.includes(g)) out.push(`unexpected ${type} ${g}`);
  return out;
}

function txtProblems(site, got) {
  const out = site.txt.filter((w) => !got.includes(w)).map((w) => `missing TXT ${w}`);
  const spf = got.filter((g) => /^v=spf1\b/i.test(g));
  if (spf.length > 1) out.push(`${spf.length} SPF records, which receivers treat as a permerror`);
  return out;
}

export async function checkDns(site, deps = {}, production = false) {
  const checks = [
    ...(production
      ? [
          {
            kind: "a",
            name: site.apex,
            type: "A",
            judge: (g) => exactProblems("A", g, [NETLIFY_APEX_IP]),
          },
          {
            kind: "cname",
            name: site.www,
            type: "CNAME",
            judge: (g) => exactProblems("CNAME", g, [site.preview]),
          },
        ]
      : []),
    {
      kind: "mx",
      name: site.apex,
      type: "MX",
      judge: (g) => exactProblems("MX", g, site.mx.map(normMx)),
    },
    { kind: "txt", name: site.apex, type: "TXT", judge: (g) => txtProblems(site, g) },
  ];
  const out = [];
  for (const resolver of RESOLVERS) {
    for (const c of checks) {
      const r = await lookup(resolver, c.name, c.type, deps);
      const problems = r.error ? [r.error] : c.judge(r.answers);
      out.push({
        kind: c.kind,
        site: site.key,
        name: c.name,
        resolver: resolver.name,
        ok: problems.length === 0,
        problems,
        got: r.answers ?? [],
      });
    }
  }
  return out;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

function pageLine(r) {
  if (!r.ok) return `  FAIL ${r.url} — ${r.problems.join("; ")}`;
  const last = r.hops.at(-1);
  const via = r.hops.length > 1 ? ` → ${last.url}` : "";
  return `  PASS ${r.url}${via} ${last.status} ${last.server}`;
}

function dnsLine(r, site) {
  const what = `${r.kind.toUpperCase()} ${r.name} via ${r.resolver}`;
  if (!r.ok) return `  FAIL ${what} — ${r.problems.join("; ")}`;
  if (r.kind === "txt") return `  PASS ${what}: all ${site.txt.length} DO NOT TOUCH values present`;
  return `  PASS ${what}: ${r.got.join(", ")}`;
}

export async function verify(o, deps = {}) {
  const lines = [];
  const results = [];
  for (const key of o.sites) {
    const site = SITES[key];
    const hosts = hostsFor(site, o.preview);
    lines.push(
      `${site.label} — ${o.preview ? "preview" : "production"} hosts: ${hosts.join(", ")}`,
    );
    const jobs = hosts.flatMap((h) => site.paths.map((p) => [h, p]));
    const pages = await pool(jobs, deps.concurrency ?? 4, ([h, p]) =>
      checkPage(site, h, p, hosts, deps),
    );
    const dns = await checkDns(site, deps, !o.preview);
    for (const r of pages) lines.push(pageLine(r));
    for (const r of dns) lines.push(dnsLine(r, site));
    const mine = [...pages, ...dns];
    const failed = mine.filter((r) => !r.ok).length;
    lines.push(
      failed === 0
        ? `${site.label}: GREEN, all ${mine.length} checks passed`
        : `${site.label}: RED, ${failed} of ${mine.length} checks failed`,
    );
    results.push(...mine);
  }
  const failed = results.filter((r) => !r.ok).length;
  const ok = results.length > 0 && failed === 0;
  lines.push(
    ok
      ? `GREEN: all ${results.length} checks passed`
      : `RED: ${failed} of ${results.length} checks failed`,
  );
  return { ok, code: ok ? 0 : 1, lines, results };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`williamson-cutover-verify: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const env = proxyReexecEnv(process.env);
  if (env) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: "inherit", env },
    );
    process.exitCode = child.status ?? 1;
    return;
  }
  const r = await verify(o);
  process.stdout.write([transportLine(process.env), ...r.lines].join("\n") + "\n");
  process.exitCode = r.code;
}

const self = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`williamson-cutover-verify: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
