import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";
import { isSiteHost, siteHostnames } from "../client/site-host.js";
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

/**
 * What the GA4 Data API answered for the window.
 *
 * The two failure kinds are NOT the same verdict. `denied` is a standing
 * configuration fault: the property is gone, or the shared subject lost access.
 * `unavailable` is a quota blip, a 5xx or a DNS hiccup, and must not red a
 * site's row — one Airtable quota once reddened six workflows here, and an
 * audit that cries wolf about upstream weather stops being read. Anything
 * unrecognised is `unavailable`, so the benefit of the doubt runs toward not
 * accusing the site.
 */
export type PropertyRead =
  { ok: true; users: number } | { ok: false; kind: "denied" | "unavailable"; error: string };

/** Errors meaning the property, or our access to it, is genuinely wrong rather
 *  than that Google was briefly unreachable. */
const DENIED_RE = /PERMISSION_DENIED|NOT_FOUND|UNAUTHENTICATED|403|404|invalid_grant/i;

export function classifyPropertyError(message: string): "denied" | "unavailable" {
  return DENIED_RE.test(message) ? "denied" : "unavailable";
}

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
  /**
   * True only for the browser probe. An HTML positive is real evidence that
   * something NAMES a loader, but it cannot tell a live tag from a string in a
   * JSON blob, a `data-` attribute, or a branch that never runs. Conclusions
   * drawn from HTML alone are therefore reported one notch softer.
   */
  authoritative: boolean;
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
      authoritative: true,
    };
  }
  if (ev.htmlIds !== null && ev.htmlIds.length > 0) {
    return { emitting: true, ids: ev.htmlIds, source: "the served HTML", authoritative: false };
  }
  return {
    emitting: null,
    ids: [],
    source: "no browser, and a JS-injected loader is invisible to a plain GET",
    authoritative: false,
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

  /**
   * Only the browser probe earns a hard `fail`.
   *
   * Everything drawn from the HTML scan, or from no observation at all, is
   * reported one notch softer: neither can tell a live tag from a loader URL
   * sitting in a JSON blob, a `data-` attribute, or a branch that never runs.
   * The finding still surfaces; it just does not claim to have been seen. A red
   * build that turns out to mean "no browser on this runner" teaches people to
   * ignore the audit, which costs more than the finding is worth.
   *
   * Config-only faults below do NOT go through this. A missing production host
   * is read straight off the checkout and is certain either way.
   */
  const observed = (s: AuditResult["status"]): AuditResult["status"] =>
    emission.authoritative || s !== "fail" ? s : "warn";

  if (facts.config === null && emission.emitting === null) {
    return {
      status: "skip",
      summary:
        "analytics: could not read the site's declared tag and could not observe the live page, so nothing was checked.",
      unchecked: ["everything"],
    };
  }

  const declared = facts.config?.measurementId ?? null;
  const hasProperty = typeof facts.propertyId === "string" && facts.propertyId.length > 0;
  const rowUnavailable = facts.propertyId === undefined;

  // ---- Nothing configured, nothing emitting ------------------------------
  if (declared === null && !hasProperty && emission.emitting !== true) {
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
        "analytics: this site emits no tag and has no GA4 property. Nothing about it is measured, " +
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
      status: emission.emitting === true ? observed("fail") : "warn",
      summary:
        `analytics: the site carries ${what} but its fleet row has no GA4 property ID, so it is collecting ` +
        "into a property no report reads. The monthly analytics section renders blank while the data exists. " +
        "Fix: put the numeric property ID on the row.",
      unchecked,
    };
  }

  // ---- A property with nothing feeding it --------------------------------
  if (hasProperty && emission.emitting !== true && declared === null) {
    return {
      status: observed("fail"),
      summary:
        `analytics: the fleet row carries GA4 property ${facts.propertyId} but the site emits no tag, ` +
        "so that property can only ever answer zero. Fix: add the measurement ID and call initAnalytics.",
      unchecked,
    };
  }

  // ---- Both ends present. Is the gate even reachable? --------------------
  if (declared !== null) {
    const configuredHost = facts.config?.productionHost ?? null;
    if (configuredHost === null) {
      return {
        status: "fail",
        summary:
          `analytics: the site declares ${declared} but no production hostname, so initAnalytics ` +
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
    return {
      status: observed("fail"),
      summary:
        `analytics: ${declared ?? facts.propertyId} is configured, but ${emission.source} show no gtag loader. ` +
        `The tag is not firing, so property ${facts.propertyId} is recording nothing.`,
      unchecked,
    };
  }
  if (emission.emitting === true && declared !== null && !emission.ids.includes(declared)) {
    return {
      status: observed("fail"),
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
        "Two loaders for one property double every session. A legacy inline snippet is the usual cause.",
      unchecked,
    };
  }

  // ---- The property answers ---------------------------------------------
  const label = declared ?? emission.ids[0] ?? "the tag";
  if (facts.property !== null) {
    if (!facts.property.ok) {
      const standing = facts.property.kind === "denied";
      return {
        status: standing ? "fail" : "warn",
        summary: standing
          ? `analytics: the GA4 Data API refused property ${facts.propertyId} — ${facts.property.error}`
          : `analytics: the GA4 Data API was unreachable for property ${facts.propertyId} — ${facts.property.error}. ` +
            "Upstream weather, not a defect in this site; the property went unmeasured.",
        unchecked: standing
          ? unchecked
          : [...unchecked, "the GA4 property (the API was unreachable)"],
      };
    }
    if (facts.property.users === 0) {
      return {
        status: "warn",
        summary:
          `analytics: ${label} is configured and property ${facts.propertyId} answers, but it recorded ` +
          `0 users on this site's own hostnames in ${facts.windowDays} days. ` +
          "That is the shape of a tag that quietly stopped firing.",
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

  // ---- Configured, but nothing was actually measured ----------------------
  // A `pass` here would be this audit's own worst failure mode. After the sweep
  // every loader is JS-injected, so with no browser and no credentials THIS is
  // the normal branch, and passing from it would green the entire fleet on the
  // strength of two config values agreeing with each other.
  if (emission.emitting === true) {
    return {
      status: "pass",
      summary:
        `analytics: ${label} is configured at both ends and ${emission.source} confirm it loads, ` +
        `property ${facts.propertyId}. The property itself was not read.`,
      unchecked,
    };
  }
  return {
    status: "skip",
    summary:
      `analytics: ${label} is configured at both ends (property ${facts.propertyId}), but nothing about ` +
      "this site was observed — neither that the tag fires nor that the property answers.",
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
  /**
   * Read activeUsers for the window, filtered to `hostnames`.
   *
   * The filter is not optional. `src/reports/draft.ts` reads the same property
   * through `measuredHostnames(siteRow.url)`, and an unfiltered read here would
   * answer a DIFFERENT number than the report renders — on Reddoor's own
   * property, 13,417 against 105. The zero-users warning exists to catch a tag
   * that stopped firing, and it could never fire while localhost and preview
   * traffic held the unfiltered count above zero.
   */
  readUsers?:
    ((propertyId: string, days: number, hostnames: string[]) => Promise<PropertyRead>) | undefined;
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
export function gtagLoaderIds(text: string): string[] {
  // A commented-out snippet is not a tag. Leaving one behind is a plausible
  // mid-sweep state for this very rollout, and counting it as emission produced
  // a confident, wrong accusation: "the live site loads G-OLD but the checkout
  // declares G-NEW".
  const scannable = text.replace(/<!--[\s\S]*?-->/g, " ");
  const ids = new Set<string>();
  // Anchored at the scheme and the host START, so a path segment that merely
  // CONTAINS the host — https://evil.test/googletagmanager.com/gtag/js?id=… —
  // is not read as Google serving the tag.
  const re =
    /https?:\/\/(?:www\.)?googletagmanager\.com\/gtag\/js\?[^"'\s>]*\bid=([A-Za-z0-9_-]+)/gi;
  for (const m of scannable.matchAll(re)) {
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
  ((propertyId: string, days: number, hostnames: string[]) => Promise<PropertyRead>) | undefined
> {
  const [{ readGaConfig }, { fetchPeriodUsers }] = await Promise.all([
    import("../reports/ga/config.js"),
    import("../reports/ga/client.js"),
  ]);
  const cfg = readGaConfig();
  if (!cfg) return undefined;
  return async (propertyId: string, days: number, hostnames: string[]): Promise<PropertyRead> => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    try {
      const { current } = await fetchPeriodUsers(
        { propertyId, subjects: cfg.subjects, keyPath: cfg.keyPath, hostnames },
        start,
        end,
      );
      return { ok: true, users: current };
    } catch (e) {
      const msg = (e as Error).message;
      return { ok: false, kind: classifyPropertyError(msg), error: msg };
    }
  };
}

/**
 * Wire the real IO, skipping any half this environment cannot do. A browser
 * that will not launch, or absent GA credentials, must leave the audit saying
 * "not checked" — never failing a site for the runner's shortcomings.
 */
/** Opt-in for the browser probe. See {@link defaultAnalyticsDeps}. */
export const PROBE_ENV = "REDDOOR_ANALYTICS_PROBE";

export async function defaultAnalyticsDeps(site: {
  ga4PropertyId?: string | undefined;
}): Promise<AnalyticsDeps> {
  // OFF by default, deliberately. This audit is in ALL_AUDIT_NAMES,
  // `reddoor-maint audit --fleet` defaults to every audit, and its default
  // concurrency is unbounded — so a probe on by default would launch one
  // Chromium per site, ~27 at once, from a bare `audit --fleet`. Six concurrent
  // agents plus one local Chrome already took this machine down on 2026-08-24.
  // The probe is this audit's strong mode and it is asked for deliberately,
  // with --concurrency set; without it the audit still runs and reports what it
  // could not check.
  let probeTag: ((url: string) => Promise<TagProbe>) | undefined;
  if (process.env[PROBE_ENV]) {
    try {
      probeTag = await defaultTagProbe();
    } catch {
      probeTag = undefined;
    }
  }
  return {
    propertyId: site.ga4PropertyId ?? null,
    probeTag,
    fetchHtml: defaultFetchHtml,
    readUsers: await defaultReadUsers(),
  };
}

/**
 * The hostnames the monthly report counts for this site — deliberately the same
 * computation `measuredHostnames` in reports/ga/client.ts performs, through the
 * same shared rule, so the audit measures what the report renders.
 *
 * Not imported from there: that module statically imports google-auth-library
 * and @google-analytics/data, and pulling them into the CLI entry is exactly
 * what scripts/smoke-dist.mjs's central-dep blocker exists to catch.
 */
function reportedHostnames(siteUrl: string | null): string[] {
  return siteUrl !== null && isHttpUrl(siteUrl) ? siteHostnames(hostnameOf(siteUrl)) : [];
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
  // The Data API takes the NUMERIC property id. A `G-…` measurement id pasted
  // into that column is an easy mistake and would otherwise read as a
  // configured property that merely went unmeasured.
  const rawProperty = deps.propertyId;
  const propertyId =
    typeof rawProperty === "string" && !/^\d+$/.test(rawProperty.trim()) ? null : rawProperty;
  const malformedProperty =
    propertyId === null && typeof rawProperty === "string" && rawProperty.length > 0;
  if (deps.readUsers && typeof propertyId === "string" && propertyId.length > 0) {
    try {
      property = await deps.readUsers(propertyId, windowDays, reportedHostnames(siteUrl));
    } catch (e) {
      const msg = (e as Error).message;
      property = { ok: false, kind: classifyPropertyError(msg), error: msg };
    }
  }

  const evidence: EmissionEvidence = { probe, htmlIds };
  if (malformedProperty) {
    return {
      audit: "analytics",
      site: siteLabel(site),
      status: "fail",
      summary:
        `analytics: the fleet row's GA4 property ID is ${JSON.stringify(rawProperty)}, which is not a ` +
        "numeric property ID. That is the `G-…` measurement ID, which the Data API cannot read. " +
        "The two are different values and only one of them belongs on the row.",
      details: { propertyId: rawProperty },
    };
  }

  const verdict = classifyAnalytics({
    config,
    propertyId,
    siteUrl,
    evidence,
    property,
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
