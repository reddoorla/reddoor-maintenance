import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";
import { isSiteHost } from "../client/site-host.js";
import { hostnameOf, isHttpUrl } from "../util/url.js";

/**
 * Does this site actually measure anything?
 *
 * Analytics has two halves that are configured in different places, by
 * different people, at different times: the TAG in the site's own repo, and
 * the numeric GA4 PROPERTY on the fleet row that the monthly report reads.
 * Nothing held them together until this audit, and on 2026-09-22 a fleet-wide
 * measurement found four of fourteen maintained sites broken at one end:
 *
 * - `revogen` had a live tag and no property. It has been collecting into a
 *   property no report reads, so its analytics section renders blank while the
 *   data sits in GA.
 * - `alamo-anatomy`, `hedloc` and `la-homelessness-youth` had a property and
 *   no tag anywhere. Those properties can only ever answer zero.
 *
 * Both failures are SILENT. A blank section and a zero both look like a quiet
 * month, and the only thing that ever surfaced them was someone going to look.
 * That is what this audit is for.
 *
 * It degrades honestly rather than wholesale. The row/config pairing needs no
 * network and runs anywhere; the live-tag probe needs a browser and the
 * property read needs GA credentials, and where those are absent the audit
 * says which half it could not check instead of reporting a pass it did not
 * earn. "Could not run" and "ran and found nothing" are never the same verdict
 * here — collapsing them is the 2026-08-12 mistake this repo's first rule
 * exists to stop.
 */

/** What the site's own checkout declares it will emit. */
export type TagConfig = {
  /** `site-config.json` → `analytics.measurementId`. null = analytics is OFF
   *  for this site, which is the starter's shipped state and not an error. */
  measurementId: string | null;
  /** `analytics.productionHost`, the hostname `initAnalytics` gates on. null
   *  when absent — which, with a measurement ID present, is itself a defect:
   *  the tag can never fire. */
  productionHost: string | null;
};

/** What driving the live production URL observed. */
export type TagProbe = {
  /** Measurement IDs the page requested a gtag loader for, in request order.
   *  Empty = the page loaded and asked for no tag. Asserting the REQUEST and
   *  not the markup is what makes this true of a loader injected from JS,
   *  which is the only shape the fleet ships after #918. */
  requestedIds: string[];
};

/** What the GA4 Data API answered for the window. */
export type PropertyRead = { ok: true; users: number } | { ok: false; error: string };

/**
 * How we learned whether the site emits, and how good that evidence is.
 *
 * Three levels, because the fleet has two tag shapes and they are not equally
 * visible:
 *
 * - A browser probe is AUTHORITATIVE in both directions. It sees the request
 *   whether the loader came from `app.html` or was injected from the bundle.
 * - The served HTML is POSITIVE-ONLY. An inline snippet shows up in it, so
 *   finding one proves emission; finding none proves nothing, because
 *   `initAnalytics` appends the loader from JS and a plain GET never runs it.
 *   This is the cheap signal that lets the audit be useful with no browser.
 * - `site-config.json` is INTENT, never proof. It says what the site means to
 *   emit, which is what a mismatch is measured against.
 */
export type EmissionEvidence = {
  /** null = no browser in this environment. */
  probe: TagProbe | null;
  /** Measurement IDs found in a plain GET of the production URL. null = not
   *  fetched. An EMPTY list is not evidence of absence — see above. */
  htmlIds: string[] | null;
};

export type Emission = {
  /** true / false / null, and null genuinely means "not determined". */
  emitting: boolean | null;
  /** The IDs observed, when any were. */
  ids: string[];
  /** Where the answer came from, for the summary. */
  source: string;
};

/**
 * Decide whether the site emits, from whatever evidence exists. PURE.
 *
 * The one rule that matters: an empty HTML scan NEVER becomes `false`. The
 * fleet's own mechanism injects the loader from JS, so "not in the HTML" and
 * "not emitting" are different facts, and a verdict that conflates them would
 * fail every correctly-migrated site the moment no browser was available.
 */
export function determineEmission(ev: EmissionEvidence): Emission {
  if (ev.probe !== null) {
    return {
      emitting: ev.probe.requestedIds.length > 0,
      ids: ev.probe.requestedIds,
      source: "the live page's network requests",
    };
  }
  if (ev.htmlIds !== null && ev.htmlIds.length > 0) {
    return { emitting: true, ids: ev.htmlIds, source: "the served HTML" };
  }
  return {
    emitting: null,
    ids: [],
    source: "no browser, and a JS-injected loader is invisible to a plain GET",
  };
}

/** Everything the verdict is derived from. Every "not available" is an
 *  explicit null so the classifier can tell it from a measured absence. */
export type AnalyticsFacts = {
  /** null = the checkout could not be read at all. */
  config: TagConfig | null;
  /** null = the row carries no property ID. undefined = no row was available. */
  propertyId: string | null | undefined;
  /** The site's production URL from the fleet row, for the host cross-check. */
  siteUrl: string | null;
  evidence: EmissionEvidence;
  /** null = no GA credentials in this environment, so the property was not read. */
  property: PropertyRead | null;
  /** Pre-launch sites are not audited as production: the tag is inert by
   *  design until the production host resolves to the new site, so an absent
   *  tag is expected rather than broken. */
  preLaunch: boolean;
  /** Days the property read covered, for the summary. */
  windowDays: number;
};

export type AnalyticsVerdict = {
  status: AuditResult["status"];
  summary: string;
  /** Every check that could not run, named. Empty when the audit was complete. */
  unchecked: string[];
};

/**
 * The whole verdict, as a pure function. PURE and exported so the test can
 * drive every state directly, including the ones that need a browser and
 * credentials to reach in the wild.
 *
 * `fail` is reserved for defects that were actually OBSERVED. Where emission
 * could not be determined, the same defect is reported as `warn` with the
 * reason named — a red build that turns out to mean "no browser on this
 * runner" teaches people to ignore the audit, which costs more than the
 * finding is worth.
 */
export function classifyAnalytics(facts: AnalyticsFacts): AnalyticsVerdict {
  const emission = determineEmission(facts.evidence);
  const unchecked: string[] = [];
  if (emission.emitting === null) unchecked.push(`whether the tag fires (${emission.source})`);
  if (facts.property === null) {
    unchecked.push("the GA4 property (no credentials in this environment)");
  }

  if (facts.config === null && emission.emitting === null) {
    return {
      status: "skip",
      summary:
        "analytics: could not read the site's site-config.json and could not observe the live page, so nothing was checked.",
      unchecked: ["everything"],
    };
  }

  const declared = facts.config?.measurementId ?? null;
  const hasProperty = typeof facts.propertyId === "string" && facts.propertyId.length > 0;
  const rowUnavailable = facts.propertyId === undefined;
  /** Softened to `warn` when emission is a guess rather than an observation. */
  const hard = (s: AuditResult["status"]): AuditResult["status"] =>
    emission.emitting === null && s === "fail" ? "warn" : s;

  // ---- Nothing configured, nothing emitting ------------------------------
  if (declared === null && !hasProperty && emission.emitting !== true) {
    if (facts.preLaunch) {
      return {
        status: "skip",
        summary: "analytics: not launched yet — the tag and the property are set at go-live.",
        unchecked,
      };
    }
    if (rowUnavailable) {
      return {
        status: "skip",
        summary:
          "analytics: this site declares no tag, and no fleet row was available to check the property against.",
        unchecked: [...unchecked, "the GA4 property (no fleet row)"],
      };
    }
    return {
      status: "warn",
      summary:
        "analytics: this maintained site emits no tag and has no GA4 property. Nothing about it is measured, " +
        "and its monthly report has no analytics section to render.",
      unchecked,
    };
  }

  // ---- Emitting into nothing --------------------------------------------
  if ((emission.emitting === true || declared !== null) && !hasProperty) {
    const what = emission.emitting === true ? emission.ids.join(", ") : (declared as string);
    if (rowUnavailable) {
      return {
        status: "skip",
        summary: `analytics: the site carries ${what}, but no fleet row was available to check for a property.`,
        unchecked: [...unchecked, "the GA4 property (no fleet row)"],
      };
    }
    return {
      status: emission.emitting === true ? "fail" : "warn",
      summary:
        `analytics: the site carries ${what} but its fleet row has no GA4 property ID, so it is collecting ` +
        "into a property no report reads. The monthly analytics section renders blank while the data exists. " +
        "Fix: put the numeric property ID on the row.",
      unchecked,
    };
  }

  // ---- A property with nothing feeding it --------------------------------
  if (hasProperty && emission.emitting !== true && declared === null) {
    const shared =
      `analytics: the fleet row carries GA4 property ${facts.propertyId} but the site emits no tag, ` +
      "so that property can only ever answer zero.";
    if (facts.preLaunch) {
      return {
        status: "warn",
        summary: `${shared} Expected before launch — the measurement ID goes in with the launch PR.`,
        unchecked,
      };
    }
    return {
      status: hard("fail"),
      summary: `${shared} Fix: add analytics.measurementId to site-config.json and call initAnalytics.`,
      unchecked,
    };
  }

  // ---- Both ends present. Is the gate reachable? -------------------------
  if (declared !== null) {
    const configuredHost = facts.config?.productionHost ?? null;
    if (configuredHost === null) {
      return {
        status: "fail",
        summary:
          `analytics: the site declares ${declared} but no analytics.productionHost, so initAnalytics ` +
          "keeps the tag off everywhere. Fix: set the production hostname.",
        unchecked,
      };
    }
    if (facts.siteUrl !== null && isHttpUrl(facts.siteUrl)) {
      const liveHost = hostnameOf(facts.siteUrl);
      if (!isSiteHost(liveHost, configuredHost)) {
        return {
          status: "fail",
          summary:
            `analytics: the site is served from ${liveHost} but gates its tag on ${configuredHost}, ` +
            "so the tag is inert in production and the property will read zero forever.",
          unchecked,
        };
      }
    }
  }

  // ---- Emission, observed ------------------------------------------------
  if (emission.emitting === false) {
    const shared = `analytics: ${declared ?? facts.propertyId} is configured, but ${emission.source} show no gtag loader.`;
    return facts.preLaunch
      ? { status: "warn", summary: `${shared} Expected before launch.`, unchecked }
      : {
          status: "fail",
          summary: `${shared} The tag is not firing, so property ${facts.propertyId} is recording nothing.`,
          unchecked,
        };
  }
  if (emission.emitting === true && declared !== null && !emission.ids.includes(declared)) {
    return {
      status: "fail",
      summary:
        `analytics: the live site loads ${emission.ids.join(", ")} but the checkout declares ${declared}. ` +
        "Traffic is going to a property nobody reads, and the configured one reads zero.",
      unchecked,
    };
  }
  if (emission.ids.length > 1) {
    return {
      status: "warn",
      summary:
        `analytics: the live site loads ${emission.ids.length} gtag loaders (${emission.ids.join(", ")}). ` +
        "Two loaders on one property double every session. A legacy inline snippet is the usual cause.",
      unchecked,
    };
  }

  // ---- The property answers ---------------------------------------------
  const label = declared ?? emission.ids[0] ?? "the tag";
  if (facts.property !== null) {
    if (!facts.property.ok) {
      return {
        status: "fail",
        summary: `analytics: the GA4 Data API could not read property ${facts.propertyId} — ${facts.property.error}`,
        unchecked,
      };
    }
    if (facts.property.users === 0 && !facts.preLaunch) {
      return {
        status: "warn",
        summary:
          `analytics: ${label} is configured and property ${facts.propertyId} answers, but it recorded ` +
          `0 users in ${facts.windowDays} days. That is the shape of a tag that quietly stopped firing.`,
        unchecked,
      };
    }
    return {
      status: "pass",
      summary:
        `analytics: ${label} emitting, property ${facts.propertyId} recorded ` +
        `${facts.property.users} users in ${facts.windowDays} days.`,
      unchecked,
    };
  }

  return {
    status: "pass",
    summary:
      `analytics: ${label} is configured at both ends` +
      (emission.emitting === true ? `, and ${emission.source} confirm it loads` : "") +
      `, property ${facts.propertyId}.`,
    unchecked,
  };
}

/** Injected IO. Every field optional: an absent one means that half of the
 *  audit cannot run here, which the verdict reports rather than hides. */
export type AnalyticsDeps = {
  /** The GA4 property ID on this site's fleet row. `undefined` = no row. */
  propertyId?: string | null | undefined;
  /** Drive the live URL with a browser and report which gtag loaders it requested. */
  probeTag?: ((url: string) => Promise<TagProbe>) | undefined;
  /** Plain GET of the production URL, for the positive-only HTML scan. */
  fetchHtml?: ((url: string) => Promise<string>) | undefined;
  /** Read activeUsers for the window. */
  readUsers?: ((propertyId: string, days: number) => Promise<PropertyRead>) | undefined;
  /** Pre-launch lifecycle, from the fleet row. Defaults to false. */
  preLaunch?: boolean | undefined;
  windowDays?: number | undefined;
};

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Measurement IDs a gtag loader is named for anywhere in a string. PURE.
 *
 * Runs over BOTH evidence paths — a served HTML document and a single network
 * request URL from the browser probe — deliberately, so the two can never
 * disagree about what counts as a tag.
 *
 * Matches the loader URL and not a bare `G-` string: a measurement ID printed
 * in a comment, a CSP directive or a JSON blob is not a tag, and counting one
 * as emission would turn this audit into a source of false greens on exactly
 * the sites it exists to catch.
 *
 * `/gtag/js` specifically, so a GTM container (`/gtm.js`) is not miscounted as
 * a GA4 tag — they are different products and gallerysonder runs the other one.
 */
export function gtagLoaderIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /googletagmanager\.com\/gtag\/js\?[^"'\s>]*\bid=([A-Za-z0-9_-]+)/g;
  for (const m of html.matchAll(re)) {
    const id = m[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Read `analytics` out of a site's `src/lib/site-config.json`. Returns null
 * when the file is missing or unparseable (the audit then says it could not
 * look), and a config with null fields when the file is fine but carries no
 * `analytics` block — the difference between "could not look" and "looked, it
 * is off".
 */
export async function readTagConfig(sitePath: string): Promise<TagConfig | null> {
  let raw: string;
  try {
    raw = await readFile(join(sitePath, "src", "lib", "site-config.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const block = (parsed as Record<string, unknown>)["analytics"];
  if (!block || typeof block !== "object") {
    return { measurementId: null, productionHost: null };
  }
  const o = block as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  };
  return { measurementId: str(o["measurementId"]), productionHost: str(o["productionHost"]) };
}

/**
 * The real probe: drive the production URL in Chromium and record every gtag
 * loader it REQUESTS.
 *
 * Asserting the request rather than the markup is the whole point. After the
 * sweep every fleet site injects its loader from bundle JS inside an effect,
 * so the served HTML contains no `<script src>` to find and a markup assertion
 * would fail on precisely the sites that are working.
 *
 * `waitUntil: "load"` and not `"networkidle"`: networkidle broke 4 of 14 sites
 * on 2026-07-xx (see the header-image work) and a site with a live chat widget
 * or a poll never reaches idle at all. The settle window after load is what
 * catches the effect-appended loader, which by construction arrives after the
 * page has loaded.
 */
export async function defaultTagProbe(
  settleMs = 4_000,
): Promise<(url: string) => Promise<TagProbe>> {
  const { chromium } = await import("@playwright/test");
  return async (url: string): Promise<TagProbe> => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const requestedIds: string[] = [];
      page.on("request", (req) => {
        for (const id of gtagLoaderIds(req.url())) {
          if (!requestedIds.includes(id)) requestedIds.push(id);
        }
      });
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(settleMs);
      return { requestedIds };
    } finally {
      await browser.close();
    }
  };
}

const HTML_TIMEOUT_MS = 15_000;

/** Plain GET of the production URL, for the positive-only HTML scan. Throws on
 *  any non-2xx so an error page is never scanned and read as "no tag". */
export async function defaultFetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return await res.text();
}

/**
 * Read `activeUsers` for the window, or report why not. Returns null when this
 * environment has no GA credentials at all — which the verdict names as an
 * unchecked half rather than treating as a failing property.
 */
export async function defaultReadUsers(): Promise<
  ((propertyId: string, days: number) => Promise<PropertyRead>) | undefined
> {
  const [{ readGaConfig }, { fetchPeriodUsers }] = await Promise.all([
    import("../reports/ga/config.js"),
    import("../reports/ga/client.js"),
  ]);
  const cfg = readGaConfig();
  if (!cfg) return undefined;
  return async (propertyId: string, days: number): Promise<PropertyRead> => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    try {
      const { current } = await fetchPeriodUsers(
        { propertyId, subjects: cfg.subjects, keyPath: cfg.keyPath, hostnames: [] },
        start,
        end,
      );
      return { ok: true, users: current };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
}

/**
 * Wire the real IO, skipping any half this environment cannot do. A browser
 * that will not launch, or absent GA credentials, must leave the audit saying
 * "not checked" — never failing a site for the runner's shortcomings.
 */
export async function defaultAnalyticsDeps(site: {
  ga4PropertyId?: string | undefined;
  preLaunch?: boolean | undefined;
}): Promise<AnalyticsDeps> {
  let probeTag: ((url: string) => Promise<TagProbe>) | undefined;
  try {
    probeTag = await defaultTagProbe();
  } catch {
    probeTag = undefined;
  }
  return {
    propertyId: site.ga4PropertyId ?? null,
    preLaunch: site.preLaunch ?? false,
    probeTag,
    fetchHtml: defaultFetchHtml,
    readUsers: await defaultReadUsers(),
  };
}

export async function analyticsAudit(ctx: AuditContext): Promise<AuditResult> {
  const site = ctx.site;
  const deps: AnalyticsDeps = ctx.analyticsDeps ?? (await defaultAnalyticsDeps(site));
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const siteUrl = site.deployedUrl ?? null;
  const reachable = siteUrl !== null && isHttpUrl(siteUrl);

  const config = await readTagConfig(site.path);

  let probe: TagProbe | null = null;
  if (deps.probeTag && reachable) {
    try {
      probe = await deps.probeTag(siteUrl);
    } catch {
      // A probe that threw is "not checked", never "no tag". A browser failure
      // reported as a site defect is how an audit loses its credibility.
      probe = null;
    }
  }

  let htmlIds: string[] | null = null;
  if (deps.fetchHtml && reachable) {
    try {
      htmlIds = gtagLoaderIds(await deps.fetchHtml(siteUrl));
    } catch {
      htmlIds = null;
    }
  }

  let property: PropertyRead | null = null;
  const propertyId = deps.propertyId;
  if (deps.readUsers && typeof propertyId === "string" && propertyId.length > 0) {
    try {
      property = await deps.readUsers(propertyId, windowDays);
    } catch (e) {
      property = { ok: false, error: (e as Error).message };
    }
  }

  const evidence: EmissionEvidence = { probe, htmlIds };
  const verdict = classifyAnalytics({
    config,
    propertyId,
    siteUrl,
    evidence,
    property,
    preLaunch: deps.preLaunch ?? false,
    windowDays,
  });

  return {
    audit: "analytics",
    site: siteLabel(site),
    status: verdict.status,
    summary:
      verdict.unchecked.length > 0
        ? `${verdict.summary} Not checked: ${verdict.unchecked.join("; ")}.`
        : verdict.summary,
    details: {
      config,
      propertyId: propertyId ?? null,
      emission: determineEmission(evidence),
      property,
      unchecked: verdict.unchecked,
    },
  };
}
