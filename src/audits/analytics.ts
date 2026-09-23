import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";
import { isSiteHost, siteHostnames } from "../client/site-host.js";
import { isAuthShapedError, isQuotaShapedError } from "../reports/ga/failover.js";
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
  /**
   * The checkout references a tag manager somewhere this audit does not parse:
   * an inline snippet in `app.html`, a site-local loader component, anything
   * hand-rolled.
   *
   * Without this the audit falsely accuses the sites that already work. Before
   * the sweep, beachfront injects its loader from its OWN component, so the
   * hook is absent AND a plain GET of the page shows nothing — and "declares no
   * tag, so the property can only answer zero" would be a confident lie about a
   * site emitting 1,051 users a month. A third mechanism exists; this is how
   * the audit knows to stop short of certainty and ask for the probe.
   */
  foreignAnalytics?: boolean;
  /**
   * `src/hooks.client.ts` exists but nothing legible could be read out of it —
   * a dev/prod ternary, an imported identifier, two disagreeing calls.
   *
   * It is its own state because the scan deliberately SKIPS that file (it is
   * the thing being parsed), so without this the audit reported "nothing in its
   * checkout references one" about the one file that certainly does, and then
   * prescribed `analytics-tag`, which no-ops on "already exists". A permanent
   * red with no reachable fix.
   */
  hookUnreadable?: boolean;
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

/**
 * Is this GA failure a standing fault, or upstream weather?
 *
 * Delegates to the classifiers `src/reports/ga/failover.ts` already carries,
 * rather than matching on message text here. A hand-rolled
 * `/…|403|404|…/` regex was wrong in BOTH directions: those are unanchored
 * digit runs, so "Requested 403, available 0", "Deadline exceeded after
 * 60.403s" and any 9-digit property ID containing 403 all read as denied — and
 * meanwhile "The caller does not have permission", which is the literal message
 * Google returns for a real 403, read as transient. `failover.ts` anchors on
 * `status code 40[13]` as a phrase and knows the quota `reason` codes, because
 * telling a quota-403 from a lost grant is exactly the job it was written for.
 *
 * Quota is checked FIRST: Google surfaces per-user throughput caps AS 403s, so
 * an auth-shaped test alone would call every rate limit a lost grant and send
 * someone to the offboarding runbook over a blip.
 */
/** gRPC code NAMES, word-anchored — never a bare digit run. `NOT_FOUND` means
 *  the property id on the row does not exist, which is a standing fault
 *  `failover.ts` has no reason to care about (it is not worth another subject)
 *  but this audit very much does. */
const MISSING_PROPERTY = /\bNOT_FOUND\b/;

/** GA4 answers `INVALID_ARGUMENT` for ANY malformed request — a bad dimension
 *  name, a bad date range, an unsupported metric — so treating the code alone
 *  as a standing fault reddens a client's row for OUR bug. It is a real signal
 *  only when the argument it names is the property (a UA property id on the
 *  row returns exactly that). Measured: "Field hostName is not a valid
 *  dimension" and "date_ranges[0].start_date is invalid" are ours, not theirs. */
const BAD_PROPERTY_ARGUMENT = /\bINVALID_ARGUMENT\b[\s\S]{0,80}\bpropert/i;

/** Phrases `failover.ts` does not carry because they do not tell it to try
 *  another subject, but which are standing faults for one property.
 *  "The caller does not have permission" is the literal `message` Google's JSON
 *  error surface returns for a 403 — matched as a PHRASE, never as a digit run. */
const DENIED_PHRASE =
  /does not have permission|caller does not have access|property .{0,40}\bdeleted\b/i;

export function classifyPropertyError(e: unknown): "denied" | "unavailable" {
  // Quota FIRST: Google surfaces per-user throughput caps AS 403s, so an
  // auth-shaped test alone calls every rate limit a lost grant.
  if (isQuotaShapedError(e)) return "unavailable";
  const msg = e instanceof Error ? e.message : String(e);
  if (MISSING_PROPERTY.test(msg) || BAD_PROPERTY_ARGUMENT.test(msg) || DENIED_PHRASE.test(msg)) {
    return "denied";
  }
  return isAuthShapedError(e) ? "denied" : "unavailable";
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
    unchecked.push("the GA4 property (no credentials, or no site URL to filter it by)");
  } else if (!facts.property.ok) {
    // Disclosed on EVERY path. The read failed, so whatever else this verdict
    // says, it did not learn anything from the property — and an earlier branch
    // returning without mentioning it claims a completeness it does not have.
    unchecked.push(`the GA4 property (the read failed: ${facts.property.error})`);
  }

  // A property the API says is GONE, or that the shared subject can no longer
  // read, outranks EVERYTHING below — including the pairing. Sitting after the
  // pairing meant the three sweep targets (property on the row, no declared
  // tag) were told "run analytics-tag" while the Data API had already answered
  // NOT_FOUND for the property they would be installing into.
  if (facts.property !== null && !facts.property.ok && facts.property.kind === "denied") {
    return {
      status: "fail",
      summary:
        `analytics: the GA4 Data API refused property ${facts.propertyId} — ${facts.property.error}. ` +
        "Fix the row's property ID before anything is installed against it.",
      unchecked: unchecked.filter((u) => !u.startsWith("the GA4 property")),
    };
  }

  // Could the checkout be inspected at all? Distinct from "it declares nothing",
  // which is a real measurement and the left half of the pairing below.
  if (facts.config === null) {
    return {
      status: "skip",
      summary:
        "analytics: could not inspect this site's checkout, so there is no declared tag to pair " +
        "against its GA4 property.",
      unchecked: ["everything"],
    };
  }

  const declared = facts.config.measurementId;
  const hasProperty = typeof facts.propertyId === "string" && facts.propertyId.length > 0;

  if (facts.propertyId === undefined) {
    return {
      status: "skip",
      summary: "analytics: no fleet row was available, so the site's tag has nothing to pair with.",
      unchecked: [...unchecked, "the GA4 property (no fleet row)"],
    };
  }

  /**
   * Both mechanisms the fleet actually uses have been looked at: the package
   * call, read from the checkout, and a legacy inline snippet, which lives in
   * the markup a plain GET returns. When both have been checked, "this site
   * emits nothing" is a finding rather than a guess.
   */
  const foreign = facts.config.foreignAnalytics === true;
  const checkedEveryMechanism =
    !foreign && (facts.evidence.probe !== null || facts.evidence.htmlIds !== null);

  /** Downgrades a `fail` that rests on an OBSERVATION we did not manage to make.
   *  It must never be applied to a conclusion drawn from the checkout and the
   *  row, which are read off disk and are equally true with no browser. */
  const observed = (s: AuditResult["status"]): AuditResult["status"] =>
    emission.authoritative || s !== "fail" ? s : "warn";

  // ---------------------------------------------------------------- PAIRING
  // Certain: both operands are read, not observed. This is the half the audit
  // exists for, and it needs no browser and no credentials. Softening it was
  // what made the four known-broken sites report an exit-0 warn on every run.

  if (declared !== null && !hasProperty) {
    return {
      status: "fail",
      summary:
        `analytics: the site declares ${declared} but its fleet row has no GA4 property ID, so it ` +
        "collects into a property no report reads. The monthly analytics section renders blank " +
        "while the data exists. Fix: put the numeric property ID on the row.",
      unchecked,
    };
  }

  if (declared === null && hasProperty && emission.emitting !== true) {
    // Hard only once both known mechanisms have been checked; otherwise the
    // site might carry a legacy snippet nothing here has looked for yet.
    return {
      status: emission.authoritative || checkedEveryMechanism ? "fail" : "warn",
      // `foreign` describes the CHECKOUT. When the probe has authoritatively
      // established that nothing loads, the checkout's leftovers are beside the
      // point, and telling the operator to "re-run with the probe" sends them
      // to the instrument that already answered.
      summary:
        foreign && emission.emitting !== false
          ? `analytics: the fleet row carries GA4 property ${facts.propertyId} and the checkout ` +
            "references a tag manager, but not through initAnalytics — so whether the two describe " +
            "the same property cannot be told from here. Re-run with REDDOOR_ANALYTICS_PROBE=1, " +
            "or REMOVE that loader and then run `reddoor-maint analytics-tag` (it refuses while " +
            "one is present)."
          : foreign
            ? // The probe authoritatively saw nothing load, yet the checkout DOES
              // reference a tag manager — a blocked or dead legacy snippet. Saying
              // "nothing in its checkout references one" here contradicts a fact
              // this same verdict measured.
              `analytics: the fleet row carries GA4 property ${facts.propertyId}, and ` +
              `${emission.source} show no gtag loader even though the checkout references a tag ` +
              "manager. A blocked or dead legacy snippet. Remove it, then run " +
              "`reddoor-maint analytics-tag`."
            : facts.config.hookUnreadable === true
              ? `analytics: the fleet row carries GA4 property ${facts.propertyId} and ` +
                "src/hooks.client.ts exists, but no measurement ID could be read out of it. Fix " +
                "the hook by hand — the recipe no-ops on a file that already exists."
              : `analytics: the fleet row carries GA4 property ${facts.propertyId} but the site ` +
                "declares no tag and nothing in its checkout references one, so that property can " +
                "only ever answer zero. Fix: run `reddoor-maint analytics-tag`.",
      // Gated on the emission too: when the probe authoritatively saw nothing
      // load, which property the site's own loader WOULD have used is moot, and
      // listing it as unchecked invites someone to go and find out.
      unchecked:
        foreign && emission.emitting !== false
          ? [...unchecked, "which property the site's own loader uses"]
          : unchecked,
    };
  }

  if (declared === null && !hasProperty) {
    if (emission.emitting === true) {
      return {
        status: observed("fail"),
        summary:
          `analytics: the site loads ${emission.ids.join(", ")} but declares no tag and its row has ` +
          "no GA4 property, so nothing that collects here is read by any report.",
        unchecked,
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

  // A property on the row, and a loader we can see but did not put there. This
  // is every pre-sweep site that already works: msot's inline app.html snippet,
  // beachfront's own component. The site is emitting, so "nothing feeding it"
  // is false — but the measurement ID in the page and the numeric property ID
  // on the row are different values and cannot be compared without the Admin
  // API, so whether they describe the SAME property is genuinely unknown here.
  if (declared === null && hasProperty) {
    return {
      status: "warn",
      summary:
        `analytics: the site loads ${[...new Set(emission.ids)].join(", ")} through a mechanism ` +
        `this audit did not install, and the row carries property ${facts.propertyId}. Whether ` +
        "those are the same property cannot be told from here. To migrate: REMOVE the site's own " +
        "loader first, then run `reddoor-maint analytics-tag` — it refuses while one is present, " +
        "because two loaders for one property double every session.",
      unchecked: [...unchecked, "whether the emitted tag and the row's property match"],
    };
  }

  // Both ends present from here on.
  const id = declared as string;

  // ------------------------------------------------------------ GATE SANITY
  // Also certain: read off the checkout and the row, no observation involved.
  const configuredHost = facts.config.productionHost;
  if (configuredHost === null) {
    return {
      status: "fail",
      summary:
        `analytics: the site declares ${id} but no production hostname, so initAnalytics keeps the ` +
        "tag off everywhere. Fix: set the production hostname.",
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

  // --------------------------------------------------------------- EMISSION
  // Everything below rests on an observation, so everything below is softened
  // when the observation was not authoritative.
  if (emission.emitting === false) {
    return {
      status: observed("fail"),
      summary:
        `analytics: ${id} is configured at both ends, but ${emission.source} show no gtag loader. ` +
        `The tag is not firing, so property ${facts.propertyId} is recording nothing.`,
      unchecked,
    };
  }
  if (emission.emitting === true) {
    const distinct = [...new Set(emission.ids)];
    if (!distinct.includes(id)) {
      return {
        status: observed("fail"),
        summary:
          `analytics: the live site loads ${distinct.join(", ")} but the checkout declares ${id}. ` +
          "Traffic is going to a property nobody reads, and the configured one reads zero.",
        unchecked,
      };
    }
    if (emission.ids.length > distinct.length && emission.authoritative) {
      return {
        status: "warn",
        summary:
          `analytics: ${id} is loaded ${emission.ids.filter((x) => x === id).length} times. Two ` +
          "loaders for one property double every session. A legacy inline snippet left alongside " +
          "the package call is the usual cause.",
        unchecked,
      };
    }
    if (distinct.length > 1) {
      return {
        status: "warn",
        summary:
          `analytics: the live site loads ${distinct.length} different properties ` +
          `(${distinct.join(", ")}). Only ${id} is read by any report.`,
        unchecked,
      };
    }
  }

  // --------------------------------------------------------------- PROPERTY
  if (facts.property !== null) {
    if (!facts.property.ok) {
      const standing = facts.property.kind === "denied";
      return {
        status: standing ? "fail" : "warn",
        summary: standing
          ? `analytics: the GA4 Data API refused property ${facts.propertyId} — ${facts.property.error}`
          : `analytics: the GA4 Data API was unreachable for property ${facts.propertyId} — ` +
            `${facts.property.error}. Upstream weather, not a defect in this site.`,
        unchecked: standing
          ? unchecked
          : [...unchecked, "the GA4 property (the API was unreachable)"],
      };
    }
    if (facts.property.users === 0) {
      return {
        status: "warn",
        summary:
          `analytics: ${id} is configured and property ${facts.propertyId} answers, but it recorded ` +
          `0 users on this site's own hostnames in ${facts.windowDays} days. That is the shape of a ` +
          "tag that quietly stopped firing.",
        unchecked,
      };
    }
    return {
      status: "pass",
      summary:
        `analytics: ${id} emitting, property ${facts.propertyId} recorded ` +
        `${facts.property.users} users in ${facts.windowDays} days.`,
      unchecked,
    };
  }

  // The pairing and the gate are sound, and that is a real result even when
  // nothing live was watched — it is the half that catches both silent
  // failures. What was NOT verified is carried in `unchecked` and repeated in
  // the summary, so a pass here cannot be mistaken for "the tag is firing".
  return {
    status: "pass",
    summary:
      emission.emitting === true
        ? `analytics: ${id} is declared, paired with property ${facts.propertyId}, gated on ` +
          `${configuredHost}, and ${emission.source} name its loader.`
        : `analytics: ${id} is declared, paired with property ${facts.propertyId}, and gated on ` +
          `${configuredHost}. Whether it actually fires was not observed.`,
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
  const ids: string[] = [];
  // Anchored at the scheme and the host START, so a path segment that merely
  // CONTAINS the host — https://evil.test/googletagmanager.com/gtag/js?id=… —
  // is not read as Google serving the tag.
  const re =
    /https?:\/\/(?:www\.)?googletagmanager\.com\/gtag\/js\?[^"'\s>]*\bid=([A-Za-z0-9_-]+)/gi;
  for (const m of scannable.matchAll(re)) {
    const id = m[1];
    if (id) ids.push(id);
  }
  return ids;
}

/** Where `analytics-tag` writes the call. The audit reads the SAME file the
 *  recipe writes, which is the whole point — the two disagreeing is how the
 *  first version of this audit came to answer "nothing was checked" for the
 *  entire fleet. */
const HOOK_RELATIVE = "src/hooks.client.ts";
const SITE_CONFIG_RELATIVE = "src/lib/site-config.json";

/** `measurementId: "G-…"` / `productionHost: "…"` inside an initAnalytics call. */
const HOOK_FIELD = (name: string): RegExp =>
  new RegExp(`\\b${name}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`, "g");

/** Blank `//` and block comments, preserving length so nothing else shifts.
 *  `gtagLoaderIds` strips HTML comments on exactly this reasoning and this
 *  reader did not: a commented-out old call sitting above the new one is the
 *  most likely artefact of THIS rollout, and taking the first match turned it
 *  into a red build naming a host nobody configured. */
function stripJsComments(src: string): string {
  // String-aware, because a regex-only stripper blanks the rest of the line
  // after any `//` inside a string — and `new URL("https://x.com").hostname`
  // next to a declaration is ordinary code. Confirmed: the naive version read
  // both fields as null there and prescribed a command that then no-ops.
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      i = Math.min(j + 1, src.length);
      continue;
    }
    if (c === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? src.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * The one value `name` is set to in `src`, or null.
 *
 * Null when it appears twice with DIFFERENT values — a dev/prod pair, a
 * commented-out predecessor the stripper missed, a type declaration. Guessing
 * between them is how the first version reported a site as gated on a staging
 * host. Null here means "declares nothing legible", which routes to the same
 * place an absent declaration does rather than to a confident accusation.
 */
function soleHookField(src: string, name: string): string | null {
  const found = new Set<string>();
  for (const m of src.matchAll(HOOK_FIELD(name))) {
    if (m[1] !== undefined) found.add(m[1]);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Extensions worth scanning for a hand-rolled loader, and a hard cap so a
 *  monorepo-sized checkout cannot turn one audit into a tree walk. */
const SCAN_EXTS = [".html", ".svelte", ".ts", ".js"];
const SCAN_FILE_CAP = 600;
const FOREIGN_ANALYTICS = /googletagmanager\.com|\bgtag\s*\(|dataLayer/;

/** Does anything under `src/` reference a tag manager? Bounded walk, and a
 *  read error is "no" rather than a throw — this is corroboration, not a gate. */
export async function hasForeignAnalytics(sitePath: string, skip: string): Promise<boolean> {
  return (await findForeignAnalytics(sitePath, skip)) !== null;
}

/** The first file under `src/` that references a tag manager, or null. The
 *  path matters to the `analytics-tag` recipe, which has to tell an operator
 *  WHICH file to remove before it can install alongside safely. */
export async function findForeignAnalytics(sitePath: string, skip: string): Promise<string | null> {
  let budget = SCAN_FILE_CAP;
  const walk = async (dir: string): Promise<string | null> => {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (budget <= 0) return null;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const hit = await walk(full);
        if (hit !== null) return hit;
        continue;
      }
      if (full === skip) continue;
      if (!SCAN_EXTS.some((x) => e.name.endsWith(x))) continue;
      budget--;
      const text = await readIfPresent(full);
      if (text !== null && FOREIGN_ANALYTICS.test(text)) return full;
    }
    return null;
  };
  return walk(join(sitePath, "src"));
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * What the site's checkout declares it will emit.
 *
 * Reads `src/hooks.client.ts` FIRST, because that is where the `analytics-tag`
 * recipe puts it, then falls back to `src/lib/site-config.json` for any site
 * that carries the starter's config convention instead. Only 4 of 28 fleet
 * checkouts have that JSON file at all and none of them has an `analytics`
 * block, so reading it alone — which is what the first version did — meant the
 * audit never found a declaration anywhere and reported "nothing was checked"
 * for every site.
 *
 * Returns `null` only when the checkout could not be inspected at all (no
 * `src/` directory — a bad path, or a clone that failed). A checkout that is
 * readable and simply declares nothing returns a config with null fields: that
 * is a real measurement, and it is what pairs with a property on the row to
 * catch "a property with nothing feeding it".
 */
export async function readTagConfig(sitePath: string): Promise<TagConfig | null> {
  try {
    await stat(join(sitePath, "src"));
  } catch {
    return null;
  }

  const hookRaw = await readIfPresent(join(sitePath, HOOK_RELATIVE));
  if (hookRaw !== null) {
    const hook = stripJsComments(hookRaw);
    const id = soleHookField(hook, "measurementId");
    const host = soleHookField(hook, "productionHost");
    if (id !== null) {
      // A declared ID is the whole answer; nothing else in the tree can change
      // the pairing verdict.
      return { measurementId: id, productionHost: host, foreignAnalytics: false };
    }
    if (host !== null) {
      // FINDING (round 3): a PARTIAL declaration used to return
      // `foreignAnalytics: false` without ever scanning — an assertion nothing
      // tested — and with `measurementId` null that lands on the hard branch
      // whose summary flatly claims "nothing in its checkout references one".
      // beachfront's real shape is exactly this: the ID comes from an imported
      // identifier, not a string literal. So the scan runs on every path that
      // reports no declared ID.
      return {
        measurementId: null,
        productionHost: host,
        foreignAnalytics: await hasForeignAnalytics(sitePath, join(sitePath, HOOK_RELATIVE)),
        hookUnreadable: true,
      };
    }
    return {
      measurementId: null,
      productionHost: null,
      foreignAnalytics: await hasForeignAnalytics(sitePath, join(sitePath, HOOK_RELATIVE)),
      hookUnreadable: true,
    };
  }

  const raw = await readIfPresent(join(sitePath, SITE_CONFIG_RELATIVE));
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt config is not "declares nothing" — say we could not look.
      return null;
    }
    const block =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)["analytics"]
        : undefined;
    if (block && typeof block === "object") {
      const o = block as Record<string, unknown>;
      const str = (v: unknown): string | null => {
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t.length > 0 ? t : null;
      };
      const declared = {
        measurementId: str(o["measurementId"]),
        productionHost: str(o["productionHost"]),
      };
      if (declared.measurementId !== null || declared.productionHost !== null) {
        return { ...declared, foreignAnalytics: false };
      }
    }
  }

  return {
    measurementId: null,
    productionHost: null,
    foreignAnalytics: await hasForeignAnalytics(sitePath, join(sitePath, HOOK_RELATIVE)),
  };
}

/**
 * The real probe: drive the production URL in Chromium and record every gtag
 * loader it REQUESTS.
 *
 * Asserting the request rather than the markup is the whole point. After the
 * sweep every fleet site injects its loader from bundle JS inside an effect, so
 * the served HTML contains no `<script src>` to find and a markup assertion
 * would fail on precisely the sites that are working.
 *
 * NOT deduplicated, deliberately. Two loaders for ONE property is the case that
 * doubles every session, and a Set made that case indistinguishable from a
 * single healthy load — the warning that names it could only ever have fired
 * for two DIFFERENT properties.
 *
 * `waitUntil: "load"` and not `"networkidle"`: networkidle broke 4 of 14 sites
 * on the header-image work, and a site with a chat widget never reaches idle at
 * all. The settle window after load is what catches the effect-appended loader,
 * which by construction arrives after the page has loaded.
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
        requestedIds.push(...gtagLoaderIds(req.url()));
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
 * Read `activeUsers` for the window, or report why not. Returns undefined when
 * this environment has no GA credentials at all, which the verdict names as an
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
      return { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
    }
  };
}

/** Opt-in for the browser probe. See {@link defaultAnalyticsDeps}. */
export const PROBE_ENV = "REDDOOR_ANALYTICS_PROBE";

/**
 * Wire the real IO, skipping any half this environment cannot do. A browser
 * that will not launch, or absent GA credentials, must leave the audit saying
 * "not checked" — never failing a site for the runner's shortcomings.
 *
 * The browser probe is OFF unless `REDDOOR_ANALYTICS_PROBE` is set. This audit
 * is in `ALL_AUDIT_NAMES`, `reddoor-maint audit --fleet` defaults to every audit
 * and its default concurrency is unbounded, so a probe on by default would
 * launch one Chromium per site — ~27 at once from a bare invocation. The
 * 2026-08-24 overload was six agents and one Chrome. The checkout/row pairing,
 * which is what catches the two silent failures, needs no browser at all.
 */
export async function defaultAnalyticsDeps(site: {
  ga4PropertyId?: string | undefined;
}): Promise<AnalyticsDeps> {
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
  const trimmedProperty = typeof rawProperty === "string" ? rawProperty.trim() : rawProperty;
  // Trim the VALUE, not just the test. A trailing newline is what a
  // `gh api --jq` round-trip or a spreadsheet paste leaves behind, and it would
  // otherwise ride into `properties/${id}` and 404.
  const propertyId =
    typeof trimmedProperty === "string" && !/^\d+$/.test(trimmedProperty) ? null : trimmedProperty;
  const malformedProperty =
    propertyId === null && typeof trimmedProperty === "string" && trimmedProperty.length > 0;
  // An EMPTY hostname list is not "no filter wanted" — `fetchPeriodUsers` omits
  // the dimensionFilter entirely for it and answers with every environment's
  // traffic, which on reddoor's own property is 13,417 against 105. Reading the
  // property unfiltered and calling the result a pass is worse than not reading
  // it, so a site with no usable URL simply does not get this half checked.
  const hostnames = reportedHostnames(siteUrl);
  if (
    deps.readUsers &&
    typeof propertyId === "string" &&
    propertyId.length > 0 &&
    hostnames.length > 0
  ) {
    try {
      property = await deps.readUsers(propertyId, windowDays, hostnames);
    } catch (e) {
      property = { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
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
