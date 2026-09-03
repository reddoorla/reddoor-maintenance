/**
 * What the domain itself says, as opposed to what the website says.
 *
 * Five questions, one lookup each, and none of them touches the prospect's web
 * server at all — so this is the cheapest section of the whole audit and the
 * one nobody else sends. "Anyone can send email as you" and "your domain
 * renews in 41 days" are findings a reader acts on the same afternoon, and
 * neither is visible from any amount of reading their HTML.
 *
 * `basics.ts` deliberately excludes TLS certificate expiry, on the grounds that
 * a successful https fetch already proved the certificate valid to a real
 * client. DOMAIN expiry is a different thing entirely — nothing about today's
 * successful request tells you the registration lapses in six weeks — which is
 * why it belongs here and that one does not.
 *
 * EVERY FAILURE MODE HERE IS OURS. A DNS timeout, a resolver that refuses, an
 * RDAP service that is down, a TLD that publishes no expiry: each is a gap in
 * our measurement and each must come back `unmeasured`. The one thing this
 * module must never do is report "no SPF record" because the lookup failed —
 * that is our network outage printed as their security hole.
 */

export type DnsFindings = {
  /** False when the domain itself could not be determined — nothing below is
   *  then attributable to the prospect. */
  measured: boolean;
  domain: string | null;
  /** The apex TXT record starting `v=spf1`, or null when there is none.
   *  `undefined` means the lookup did not answer — a different claim. */
  spf: string | null | undefined;
  /** The `_dmarc` TXT record starting `v=DMARC1`. Same three states. */
  dmarc: string | null | undefined;
  /** Mail exchangers for the apex, lowest preference first. */
  mx: string[] | undefined;
  /** Whether the domain in a published `mailto:` can receive mail. Null when
   *  the site publishes no email address to check. */
  contactMx: { domain: string; hasMx: boolean } | null | undefined;
  /** ISO date the registration lapses, from RDAP. Undefined when RDAP did not
   *  answer or the registry publishes no expiry, which many ccTLDs do not. */
  expiresAt: string | undefined;
};

export type DnsDeps = {
  /** TXT records for a name. Throwing means "we could not ask", never "none". */
  resolveTxt: (name: string) => Promise<string[][]>;
  resolveMx: (name: string) => Promise<{ exchange: string; priority: number }[]>;
  /** RDAP lookup for a domain, returning the raw JSON body or null. */
  rdap: (domain: string) => Promise<unknown | null>;
};

/**
 * Which RDAP server is authoritative for this domain's TLD.
 *
 * Via IANA's bootstrap registry, NOT via rdap.org. The obvious approach is to
 * hand rdap.org the domain and let it redirect, and it is what the first
 * version did — but rdap.org sits behind Cloudflare and answers a plain fetch
 * with a 403 challenge page. Every expiry then came back "not measured",
 * including for `.com`, where the data is definitely published. A check that is
 * unmeasured everywhere is a broken check, not a fact about the world.
 *
 * The bootstrap is fetched once per process: it is a 590-entry document that
 * changes when a TLD does, and a batch of audits has no business asking IANA
 * for it once per site.
 */
let bootstrapPromise: Promise<Map<string, string> | null> | null = null;

async function rdapBootstrap(): Promise<Map<string, string> | null> {
  bootstrapPromise ??= (async () => {
    try {
      const res = await fetch("https://data.iana.org/rdap/dns.json", {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { services?: [string[], string[]][] };
      const map = new Map<string, string>();
      for (const [tlds, urls] of body.services ?? []) {
        const base = urls.find((u) => u.startsWith("https://"));
        if (!base) continue;
        for (const tld of tlds) map.set(tld.toLowerCase(), base.endsWith("/") ? base : `${base}/`);
      }
      return map.size > 0 ? map : null;
    } catch {
      return null;
    }
  })();
  return bootstrapPromise;
}

/** Exported only so a test can force a re-fetch; nothing in production calls it. */
export function resetRdapBootstrap(): void {
  bootstrapPromise = null;
}

async function rdapBaseFor(domain: string): Promise<string | null> {
  const map = await rdapBootstrap();
  if (!map) return null;
  const labels = domain.split(".");
  // Longest suffix first: `co.uk` before `uk`, because the bootstrap lists
  // both and only one of them is authoritative for the domain in hand.
  for (let i = 1; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    const base = map.get(suffix);
    if (base) return base;
  }
  return null;
}

/** Node's resolver plus the registry RDAP service for the domain's TLD.
 *  Nothing here is influenced by the content of the site being audited. */
export function defaultDnsDeps(): DnsDeps {
  return {
    async resolveTxt(name) {
      const { resolveTxt } = await import("node:dns/promises");
      return resolveTxt(name);
    },
    async resolveMx(name) {
      const { resolveMx } = await import("node:dns/promises");
      return resolveMx(name);
    },
    async rdap(domain) {
      const base = await rdapBaseFor(domain);
      if (!base) return null;
      try {
        const res = await fetch(`${base}domain/${encodeURIComponent(domain)}`, {
          headers: { accept: "application/rdap+json" },
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        // A 404 is a real answer — this registry has no record — but it is not
        // an expiry date, so it lands as "we learned nothing" either way.
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
  };
}

/**
 * The registrable domain, roughly.
 *
 * `www.acme.co.uk` → `acme.co.uk`. Done with a short list of known two-label
 * public suffixes rather than the full Public Suffix List, which is a
 * dependency and a monthly update for a job this small. A miss costs us one
 * lookup against the wrong name, which comes back unmeasured — never a wrong
 * finding.
 */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.br",
  "co.jp",
  "co.in",
  "com.mx",
  "com.sg",
]);

export function registrableDomain(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) return null;
  const parts = host.split(".");
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return lastTwo;
}

/** Joins the chunks a long TXT record is split into — a DKIM or SPF record over
 *  255 bytes arrives as several strings and means nothing until concatenated. */
const joinTxt = (chunks: string[][]): string[] => chunks.map((c) => c.join(""));

async function txtStartingWith(
  deps: DnsDeps,
  name: string,
  prefix: RegExp,
): Promise<string | null | undefined> {
  try {
    const records = joinTxt(await deps.resolveTxt(name));
    return records.find((r) => prefix.test(r.trim())) ?? null;
  } catch (err) {
    // ENOTFOUND / ENODATA mean the name resolved and carries no such record —
    // a real answer of "none". Anything else (timeout, refused, no resolver)
    // is our failure, and must not be reported as their missing record.
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return null;
    return undefined;
  }
}

/** The first plausible ISO date in an RDAP event list. Registries disagree
 *  about casing and about which event names they publish. */
function expiryFrom(rdap: unknown): string | undefined {
  if (!rdap || typeof rdap !== "object") return undefined;
  const events = (rdap as { events?: unknown }).events;
  if (!Array.isArray(events)) return undefined;
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const action = String((e as { eventAction?: unknown }).eventAction ?? "").toLowerCase();
    if (!/expir/.test(action)) continue;
    const date = (e as { eventDate?: unknown }).eventDate;
    if (typeof date === "string" && !Number.isNaN(Date.parse(date))) return date;
  }
  return undefined;
}

export async function lookupDns(
  origin: string,
  contactEmails: string[],
  deps: DnsDeps,
): Promise<DnsFindings> {
  let domain: string | null = null;
  try {
    domain = registrableDomain(new URL(origin).hostname);
  } catch {
    domain = null;
  }
  if (!domain) {
    return {
      measured: false,
      domain: null,
      spf: undefined,
      dmarc: undefined,
      mx: undefined,
      contactMx: undefined,
      expiresAt: undefined,
    };
  }

  const [spf, dmarc] = await Promise.all([
    txtStartingWith(deps, domain, /^v=spf1\b/i),
    txtStartingWith(deps, `_dmarc.${domain}`, /^v=DMARC1\b/i),
  ]);

  let mx: string[] | undefined;
  try {
    mx = (await deps.resolveMx(domain))
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange.toLowerCase());
  } catch (err) {
    const code = (err as { code?: string }).code;
    mx = code === "ENOTFOUND" || code === "ENODATA" ? [] : undefined;
  }

  // Only an address on a DIFFERENT domain needs its own lookup; one on the
  // site's own domain is already answered by `mx` above.
  const otherDomains = [
    ...new Set(
      contactEmails
        .map((e) => registrableDomain(e.split("@")[1] ?? ""))
        .filter((d): d is string => d !== null && d !== domain),
    ),
  ];
  let contactMx: DnsFindings["contactMx"] = null;
  if (otherDomains.length > 0) {
    const target = otherDomains[0]!;
    try {
      const records = await deps.resolveMx(target);
      contactMx = { domain: target, hasMx: records.length > 0 };
    } catch (err) {
      const code = (err as { code?: string }).code;
      contactMx =
        code === "ENOTFOUND" || code === "ENODATA" ? { domain: target, hasMx: false } : undefined;
    }
  }

  return {
    measured: true,
    domain,
    spf,
    dmarc,
    mx,
    contactMx,
    expiresAt: expiryFrom(await deps.rdap(domain)),
  };
}
