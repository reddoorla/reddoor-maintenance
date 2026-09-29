import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
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
 *
 * The same rule governs the checkout reader. It is a STATIC read of code that
 * can take shapes it cannot see through (an imported ID, a dev/prod ternary, a
 * wrapper), so a value it cannot see is reported as unknown and never turned
 * into a confident fail. That was the root cause of most review findings on
 * this module across six rounds.
 */

/** What the site's own checkout declares it will emit. */
export type TagConfig = {
  /**
   * The one measurement ID every `initAnalytics` call in `src/` names as a
   * string literal (or, failing a call, `src/lib/site-config.json` declares).
   * null = none legible: either nothing declares one, or a call exists whose
   * ID cannot be read — `unreadableCall` says which.
   */
  measurementId: string | null;
  /**
   * The production host those calls gate on, when it is one literal. null =
   * not legible (an identifier, an expression, two calls that disagree, or
   * absent). A static read cannot tell "absent" from "not seen", so a null
   * here is never evidence that the tag is off.
   */
  productionHost: string | null;
  /** Where the declaration was read, relative to the checkout. */
  declaredIn?: string;
  /**
   * `initAnalytics` is referenced here (a call, an import, an alias) but no
   * single measurement ID could be read out of the checkout.
   *
   * Its own state because "declares nothing" would otherwise route a site that
   * DOES run the package — from its root layout, from `hooks.client.js`, with
   * an imported ID — to "the property can only ever answer zero", a confident
   * fail about a site that may be working.
   */
  unreadableCall?: string;
  /**
   * The checkout references a tag manager OUTSIDE `initAnalytics`: an inline
   * snippet in `app.html`, a site-local loader component, anything
   * hand-rolled. Without this the audit falsely accuses the sites that already
   * work (beachfront's own component, msot's inline snippet).
   */
  foreignAnalytics?: boolean;
  /** The first file that references one, relative to the checkout. */
  foreignFile?: string;
  /** The walk stopped at its file cap, so "nothing foreign" is unproven. */
  scanIncomplete?: boolean;
};

/** What driving the live production URL observed. */
export type TagProbe = {
  /**
   * GA4 measurement IDs whose gtag loader the page requested AND received with
   * a 2xx, in order. Not deduplicated: two loads of one ID is the case that
   * doubles every session.
   *
   * A request alone is not emission. A loader the page's own CSP refuses, or
   * one that 404s, is still requested, and counting it passed the exact CSP
   * failure `analytics-tag`'s CSP half exists to fix.
   */
  loadedIds: string[];
  /** Loader requests that failed or answered non-2xx, with why. */
  failed?: Array<{ id: string; reason: string }>;
};

/**
 * What the GA4 Data API answered for the window.
 *
 * The failure kinds are NOT the same verdict:
 * - `denied` is a standing fault of THIS site's row: the property is gone, or
 *   the shared subject cannot read this property.
 * - `credentials` is the shared service account itself being refused
 *   (`invalid_grant`, `unauthorized_client`, UNAUTHENTICATED). It is
 *   fleet-wide by construction and says nothing about this site.
 * - `unavailable` is a quota blip, a 5xx or a DNS hiccup.
 *
 * Only `denied` may red a site's row. Anything unrecognised is `unavailable`,
 * so the benefit of the doubt runs toward not accusing the site.
 */
export type PropertyRead =
  | { ok: true; users: number }
  | { ok: false; kind: "denied" | "unavailable" | "credentials"; error: string };

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

/** The shared credentials refused outright. OAuth error CODES and the gRPC
 *  code NAME, word-anchored; `status code 401` as a phrase. A missing key file
 *  is the same fault seen from the filesystem. */
const CREDENTIALS_REFUSED =
  /\binvalid_grant\b|\bunauthorized_client\b|\binvalid_client\b|\bUNAUTHENTICATED\b|status code 401\b|Could not load the default credentials|ENOENT[\s\S]{0,200}\.json/;

/**
 * Is this GA failure a fault of THIS site's row, of the shared credentials, or
 * upstream weather?
 *
 * Delegates to the classifiers `src/reports/ga/failover.ts` already carries,
 * rather than matching on message text here. A hand-rolled
 * `/…|403|404|…/` regex was wrong in BOTH directions: those are unanchored
 * digit runs, so "Requested 403, available 0", "Deadline exceeded after
 * 60.403s" and any 9-digit property ID containing 403 all read as denied — and
 * meanwhile "The caller does not have permission", which is the literal message
 * Google returns for a real 403, read as transient.
 *
 * Quota is checked FIRST: Google surfaces per-user throughput caps AS 403s, so
 * an auth-shaped test alone would call every rate limit a lost grant. The
 * shared credentials come SECOND: `failover.ts` rightly counts `invalid_grant`
 * as auth-shaped, but it is the service account being refused for every site
 * at once, and calling it this site's `denied` reddened every row in a sweep.
 */
export function classifyPropertyError(e: unknown): "denied" | "unavailable" | "credentials" {
  if (isQuotaShapedError(e)) return "unavailable";
  const err = e as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  const msg = e instanceof Error ? e.message : String(e);
  if (
    Number(err?.code) === 16 ||
    Number(err?.status) === 401 ||
    Number(err?.response?.status) === 401 ||
    CREDENTIALS_REFUSED.test(msg)
  ) {
    return "credentials";
  }
  if (MISSING_PROPERTY.test(msg) || BAD_PROPERTY_ARGUMENT.test(msg) || DENIED_PHRASE.test(msg)) {
    return "denied";
  }
  return isAuthShapedError(e) ? "denied" : "unavailable";
}

/**
 * How we learned whether the site emits, and how good that evidence is.
 *
 * - A browser probe is AUTHORITATIVE in both directions. It sees the loader
 *   whether it came from `app.html` or was injected from the bundle, and it
 *   counts only a loader that actually arrived.
 * - The served HTML is POSITIVE-ONLY. An inline snippet shows up in it, so
 *   finding one proves something names a loader; finding none proves nothing,
 *   because `initAnalytics` appends the loader from JS and a plain GET never
 *   runs it. This is the cheap signal that lets the audit be useful with no
 *   browser.
 * - The checkout is INTENT, never proof. It says what the site means to emit,
 *   which is what a mismatch is measured against.
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
  /** Loaders the probe saw requested that did not arrive, and why. */
  failed: Array<{ id: string; reason: string }>;
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
      emitting: ev.probe.loadedIds.length > 0,
      ids: ev.probe.loadedIds,
      source: "the live page's network responses",
      authoritative: true,
      failed: ev.probe.failed ?? [],
    };
  }
  if (ev.htmlIds !== null && ev.htmlIds.length > 0) {
    return {
      emitting: true,
      ids: ev.htmlIds,
      source: "the served HTML",
      authoritative: false,
      failed: [],
    };
  }
  return {
    emitting: null,
    ids: [],
    source: "no browser, and a JS-injected loader is invisible to a plain GET",
    authoritative: false,
    failed: [],
  };
}

/** Everything the verdict is derived from. Every "not available" is an
 *  explicit null so the classifier can tell it from a measured absence. */
export type AnalyticsFacts = {
  /** null = the checkout could not be read at all. */
  config: TagConfig | null;
  /** null = the row carries no property ID. undefined = no row was read. */
  propertyId: string | null | undefined;
  /** The site's production URL from the fleet row, for the host cross-check. */
  siteUrl: string | null;
  evidence: EmissionEvidence;
  /** null = the property was not read here; `propertyNotRead` says why. */
  property: PropertyRead | null;
  /** Why the property was not read, when it was not. */
  propertyNotRead?: string;
  /** Days the property read covered, for the summary. */
  windowDays: number;
};

export type AnalyticsVerdict = {
  status: AuditResult["status"];
  summary: string;
  /** Every check that could not run, named. Empty when the audit was complete. */
  unchecked: string[];
};

/** The Fix line for a site whose declaration is its own and cannot be read. */
function unreadableFix(file: string): string {
  return (
    `Write the measurementId and productionHost in ${file} as string literals to make it ` +
    "checkable. `analytics-tag` will not touch a checkout that already references initAnalytics."
  );
}

/**
 * The whole verdict, as a pure function. PURE and exported so the test can
 * drive every state directly, including the ones that need a browser and
 * credentials to reach in the wild.
 *
 * `fail` is reserved for defects that were actually OBSERVED, or read off both
 * the checkout and the row with nothing in between. Where emission could not
 * be determined, or the checkout reader could not see a value, the same defect
 * is reported as `warn` with the reason named — a red build that turns out to
 * mean "no browser on this runner" or "the ID is imported" teaches people to
 * ignore the audit, which costs more than the finding is worth.
 */
export function classifyAnalytics(facts: AnalyticsFacts): AnalyticsVerdict {
  const emission = determineEmission(facts.evidence);
  const hasProperty = typeof facts.propertyId === "string" && facts.propertyId.length > 0;
  const unchecked: string[] = [];
  if (emission.emitting === null) unchecked.push(`whether the tag fires (${emission.source})`);
  if (hasProperty) {
    if (facts.property === null) {
      unchecked.push(
        `the GA4 property (${facts.propertyNotRead ?? "no credentials, or no site URL to filter it by"})`,
      );
    } else if (!facts.property.ok) {
      // Disclosed on EVERY path, once. The read failed, so whatever else this
      // verdict says, it did not learn anything from the property — and an
      // earlier branch returning without mentioning it claims a completeness it
      // does not have.
      const why =
        facts.property.kind === "unavailable"
          ? "the read failed, API unreachable"
          : facts.property.kind === "credentials"
            ? "the read failed, GA credentials refused"
            : "the read failed";
      unchecked.push(`the GA4 property (${why}: ${facts.property.error})`);
    }
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

  if (facts.propertyId === undefined) {
    return {
      status: "skip",
      summary: "analytics: no fleet row was read, so the site's tag has nothing to pair with.",
      unchecked: [
        ...unchecked.filter((u) => !u.startsWith("the GA4 property")),
        "the GA4 property (no fleet row)",
      ],
    };
  }

  const cfg = facts.config;
  const declared = cfg.measurementId;
  const unreadable = cfg.unreadableCall;
  const foreign = cfg.foreignAnalytics === true;
  const scanIncomplete = cfg.scanIncomplete === true;

  /**
   * Every mechanism the fleet uses has been looked at: the package call, read
   * from the checkout, a legacy inline snippet, which lives in the markup a
   * plain GET returns, and anything hand-rolled under `src/`. Only then is
   * "this site emits nothing" a finding rather than a guess.
   */
  const checkedEveryMechanism =
    !foreign &&
    !scanIncomplete &&
    unreadable === undefined &&
    (facts.evidence.probe !== null || facts.evidence.htmlIds !== null);

  /** Downgrades a `fail` that rests on an OBSERVATION we did not manage to make. */
  const observed = (s: AuditResult["status"]): AuditResult["status"] =>
    emission.authoritative || s !== "fail" ? s : "warn";

  // ---------------------------------------------------------------- PAIRING
  // Certain: both operands are read, not observed. This is the half the audit
  // exists for, and it needs no browser and no credentials.

  if (declared !== null && !hasProperty) {
    return {
      status: "fail",
      summary:
        `analytics: ${cfg.declaredIn ?? "the checkout"} declares ${declared}, but the fleet row ` +
        "has no GA4 property ID, so whatever that tag collects is read by no report and the " +
        "monthly analytics section renders blank. Fix: put the numeric property ID on the row.",
      unchecked,
    };
  }

  if (declared === null && hasProperty && emission.emitting !== true) {
    if (unreadable !== undefined) {
      // The site runs the package, from somewhere this reader cannot see the
      // ID in. Nothing here is certain about the pairing.
      return {
        status: "warn",
        summary:
          `analytics: the fleet row carries GA4 property ${facts.propertyId} and ${unreadable} ` +
          "references initAnalytics, but no measurement ID could be read out of the checkout, so " +
          `whether it installs that property cannot be told from here. ${unreadableFix(unreadable)}`,
        unchecked: [...unchecked, "which measurement ID the site's initAnalytics call uses"],
      };
    }
    if (foreign && emission.emitting !== false) {
      return {
        status: "warn",
        summary:
          `analytics: the fleet row carries GA4 property ${facts.propertyId} and ` +
          `${cfg.foreignFile ?? "the checkout"} references a tag manager, but not through ` +
          "initAnalytics — so whether the two describe the same property cannot be told from " +
          "here. Re-run with REDDOOR_ANALYTICS_PROBE=1, or REMOVE that loader and then run " +
          "`reddoor-maint analytics-tag` (it refuses while one is present).",
        unchecked: [...unchecked, "which property the site's own loader uses"],
      };
    }
    if (foreign) {
      // The probe authoritatively saw nothing load, yet the checkout DOES
      // reference a tag manager — a blocked or dead legacy snippet.
      return {
        status: "fail",
        summary:
          `analytics: the fleet row carries GA4 property ${facts.propertyId}, and ` +
          `${emission.source} show no gtag loader arriving even though ` +
          `${cfg.foreignFile ?? "the checkout"} references a tag manager. A blocked or dead ` +
          "legacy snippet. Remove it, then run `reddoor-maint analytics-tag`.",
        unchecked,
      };
    }
    return {
      // Hard only once every known mechanism has been checked; otherwise the
      // site might carry a legacy snippet nothing here has looked for yet.
      status: emission.authoritative || checkedEveryMechanism ? "fail" : "warn",
      summary: scanIncomplete
        ? `analytics: the fleet row carries GA4 property ${facts.propertyId}, the site declares ` +
          "no tag, and the scan of src/ stopped at its file cap before ruling out a loader of " +
          "its own. Re-run with REDDOOR_ANALYTICS_PROBE=1 to observe it."
        : `analytics: the fleet row carries GA4 property ${facts.propertyId} but the site ` +
          "declares no tag and nothing in its checkout references one, so that property can " +
          "only ever answer zero. Fix: run `reddoor-maint analytics-tag`.",
      unchecked: scanIncomplete ? [...unchecked, "the rest of src/ (file cap)"] : unchecked,
    };
  }

  if (declared === null && !hasProperty) {
    const what =
      unreadable !== undefined
        ? `${unreadable} references initAnalytics with a measurement ID that cannot be read here`
        : foreign
          ? `${cfg.foreignFile ?? "the checkout"} references a tag manager outside initAnalytics`
          : null;
    if (emission.emitting === true) {
      return {
        status: observed("fail"),
        summary:
          `analytics: the site loads ${emission.ids.join(", ")}` +
          (what !== null ? ` (${what})` : ", declares no tag,") +
          " and its row has no GA4 property, so nothing that collects here is read by any report.",
        unchecked,
      };
    }
    return {
      status: "warn",
      summary:
        `analytics: ${
          what ??
          (emission.emitting === false ? "this site emits no tag" : "this site declares no tag")
        } and has no GA4 property on its row. Nothing it collects is read by any report, and ` +
        "its monthly report has no analytics section to render.",
      unchecked,
    };
  }

  // A property on the row, and a loader we can see but whose ID the checkout
  // does not declare legibly. The measurement ID in the page and the numeric
  // property ID on the row are different values and cannot be compared without
  // the Admin API, so whether they describe the SAME property is unknown here.
  if (declared === null && hasProperty) {
    const loads = [...new Set(emission.ids)].join(", ");
    if (unreadable !== undefined && !foreign) {
      return {
        status: "warn",
        summary:
          `analytics: the site loads ${loads} and ${unreadable} references initAnalytics, but ` +
          "no measurement ID could be read out of the checkout, so whether it is property " +
          `${facts.propertyId} cannot be told from here. ${unreadableFix(unreadable)}`,
        unchecked: [...unchecked, "whether the emitted tag and the row's property match"],
      };
    }
    return {
      status: "warn",
      summary:
        `analytics: the site loads ${loads} through a mechanism this audit did not install` +
        (cfg.foreignFile !== undefined ? ` (${cfg.foreignFile})` : "") +
        `, and the row carries property ${facts.propertyId}. Whether those are the same property ` +
        "cannot be told from here. To migrate: REMOVE the site's own loader first, then run " +
        "`reddoor-maint analytics-tag` — it refuses while one is present, because two loaders " +
        "for one property double every session.",
      unchecked: [...unchecked, "whether the emitted tag and the row's property match"],
    };
  }

  // Both ends present from here on.
  const id = declared as string;

  // ------------------------------------------------------------ GATE SANITY
  // A LEGIBLE host that cannot match the live one is read off the checkout and
  // the row, no observation involved. An ILLEGIBLE one is not evidence of
  // anything: the reader could not see it, so the gate is unchecked, not off.
  const configuredHost = cfg.productionHost;
  if (configuredHost === null && !(emission.authoritative && emission.ids.includes(id))) {
    return {
      status: "warn",
      summary:
        `analytics: ${cfg.declaredIn ?? "the checkout"} declares ${id}, paired with property ` +
        `${facts.propertyId}, but its productionHost could not be read as one literal (an ` +
        "identifier, an expression, or calls that disagree), so whether the tag can fire on " +
        "the live host was not checked.",
      unchecked: [...unchecked, "whether the tag's host gate matches the live host"],
    };
  }
  if (configuredHost !== null && facts.siteUrl !== null && isHttpUrl(facts.siteUrl)) {
    const liveHost = hostnameOf(facts.siteUrl);
    if (!isSiteHost(liveHost, configuredHost)) {
      return {
        status: "fail",
        summary:
          `analytics: the site is served from ${liveHost} but ${cfg.declaredIn ?? "the checkout"} ` +
          `gates its tag on ${configuredHost}, so the tag is inert in production and the ` +
          "property will read zero forever.",
        unchecked,
      };
    }
  }

  /** A successful property read, said wherever a verdict returns early, so a
   *  read the audit paid for is never discarded. */
  const propertyNote =
    facts.property !== null && facts.property.ok
      ? ` Property ${facts.propertyId} recorded ${facts.property.users} users on this site's ` +
        `hostnames in ${facts.windowDays} days.`
      : "";

  // --------------------------------------------------------------- EMISSION
  // Everything below rests on an observation, so everything below is softened
  // when the observation was not authoritative.
  if (emission.emitting === false) {
    const blocked = emission.failed.filter((f) => f.id === id);
    return {
      status: observed("fail"),
      summary:
        blocked.length > 0
          ? `analytics: the page requested the ${id} loader but it never arrived ` +
            `(${blocked[0]!.reason}). A Content-Security-Policy without ` +
            "https://www.googletagmanager.com in script-src refuses it exactly like this; so " +
            `does a blocked host. Property ${facts.propertyId} is recording nothing.` +
            propertyNote
          : `analytics: ${id} is configured at both ends, but ${emission.source} show no gtag ` +
            `loader. The tag is not firing, so property ${facts.propertyId} is recording nothing.` +
            propertyNote,
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
          "Traffic is going to a property nobody reads, and the configured one reads zero." +
          propertyNote,
        unchecked,
      };
    }
    if (emission.ids.length > distinct.length && emission.authoritative) {
      return {
        status: "warn",
        summary:
          `analytics: ${id} is loaded ${emission.ids.filter((x) => x === id).length} times. Two ` +
          "loaders for one property double every session. A legacy inline snippet left alongside " +
          "the package call is the usual cause." +
          propertyNote,
        unchecked,
      };
    }
    if (distinct.length > 1) {
      return {
        status: "warn",
        summary:
          `analytics: the live site loads ${distinct.length} different properties ` +
          `(${distinct.join(", ")}). Only ${id} is read by any report.` +
          propertyNote,
        unchecked,
      };
    }
  }

  // --------------------------------------------------------------- PROPERTY
  const how =
    emission.emitting === true
      ? emission.authoritative
        ? "loads"
        : "is named in the served HTML"
      : "is declared";
  if (facts.property !== null) {
    if (!facts.property.ok) {
      // `denied` returned at the top; what is left is not this site's fault.
      return {
        status: "warn",
        summary:
          facts.property.kind === "credentials"
            ? `analytics: the GA credentials were refused reading property ${facts.propertyId} — ` +
              `${facts.property.error}. That is the shared service account, fleet-wide, not this ` +
              "site: see docs/runbooks/ga-search-role-account-cutover.md."
            : `analytics: the GA4 Data API was unreachable for property ${facts.propertyId} — ` +
              `${facts.property.error}. Upstream weather, not a defect in this site.`,
        unchecked,
      };
    }
    if (facts.property.users === 0) {
      return {
        status: "warn",
        summary:
          emission.authoritative && emission.emitting === true
            ? `analytics: ${id} loads on the live page, yet property ${facts.propertyId} recorded ` +
              `0 users on this site's own hostnames in ${facts.windowDays} days. The stream behind ` +
              `${id} may not belong to that property, or the traffic arrives on a host the ` +
              "report's filter excludes."
            : `analytics: ${id} ${how} and property ${facts.propertyId} answers, but it recorded ` +
              `0 users on this site's own hostnames in ${facts.windowDays} days — the shape of a ` +
              "tag that is not firing.",
        unchecked,
      };
    }
    return {
      status: "pass",
      summary:
        `analytics: ${id} ${how}, paired with property ${facts.propertyId}, which recorded ` +
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
          `${configuredHost ?? "a host the probe confirmed"}, and ${emission.source} name its loader.`
        : `analytics: ${id} is declared, paired with property ${facts.propertyId}, and gated on ` +
          `${configuredHost}. Whether it actually fires was not observed.`,
    unchecked,
  };
}

/** `readUsers`' shape: activeUsers for the window, filtered to `hostnames`. */
export type ReadUsers = (
  propertyId: string,
  days: number,
  hostnames: string[],
) => Promise<PropertyRead>;

/** Injected IO. Every field optional: an absent one means that half of the
 *  audit cannot run here, which the verdict reports rather than hides. */
export type AnalyticsDeps = {
  /** The GA4 property ID on this site's fleet row. `undefined` = no row. */
  propertyId?: string | null | undefined;
  /** Drive the live URL with a browser and report which gtag loaders arrived. */
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
  readUsers?: ReadUsers | undefined;
  /** Why `readUsers` is absent, for the verdict. */
  readUsersUnavailable?: string | undefined;
  windowDays?: number | undefined;
};

const DEFAULT_WINDOW_DAYS = 7;

/**
 * GA4 measurement IDs a gtag loader is named for anywhere in a string. PURE.
 *
 * Runs over BOTH evidence paths — a served HTML document and a single loader
 * URL from the browser probe — deliberately, so the two can never disagree
 * about what counts as a tag.
 *
 * Matches the loader URL and not a bare `G-` string: a measurement ID printed
 * in a comment, a CSP directive or a JSON blob is not a tag.
 *
 * `/gtag/js` specifically, so a GTM container (`/gtm.js`) is not miscounted as
 * a GA4 tag. And only `G-` IDs: the same loader serves Google Ads (`AW-`),
 * Floodlight (`DC-`) and Google-tag (`GT-`) IDs, none of which is a GA4
 * web stream this audit can pair with a property.
 */
export function gtagLoaderIds(text: string): string[] {
  // A commented-out snippet is not a tag. Leaving one behind is a plausible
  // mid-sweep state for this very rollout.
  const scannable = text.replace(/<!--[\s\S]*?-->/g, " ");
  const ids: string[] = [];
  // Anchored at the scheme and the host START, so a path segment that merely
  // CONTAINS the host — https://evil.test/googletagmanager.com/gtag/js?id=… —
  // is not read as Google serving the tag.
  const re =
    /https?:\/\/(?:www\.)?googletagmanager\.com\/gtag\/js\?[^"'\s>]*\bid=([A-Za-z0-9_-]+)/gi;
  for (const m of scannable.matchAll(re)) {
    const id = m[1];
    if (id && /^G-/i.test(id)) ids.push(id);
  }
  return ids;
}

const SITE_CONFIG_RELATIVE = "src/lib/site-config.json";

/** `measurementId: "G-…"` / `productionHost: "…"` as a literal object value. */
const CALL_FIELD = (name: string): RegExp =>
  new RegExp(`\\b${name}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`, "g");

/** Blank `//` and block comments (and HTML comments, for markup), preserving
 *  length. String-aware, because a regex-only stripper blanks the rest of the
 *  line after any `//` inside a string — and `new URL("https://x.com")` next to
 *  a declaration is ordinary code. */
export function stripComments(src: string): string {
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
    if (c === "<" && src.startsWith("<!--", i)) {
      const close = src.indexOf("-->", i + 4);
      const end = close === -1 ? src.length : close + 3;
      blank(i, end);
      i = end;
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

/** The distinct literal values `name` is set to in `code`. */
function literalValues(code: string, name: string): Set<string> {
  const found = new Set<string>();
  for (const m of code.matchAll(CALL_FIELD(name))) {
    if (m[1] !== undefined) found.add(m[1].trim());
  }
  return found;
}

/** Extensions worth scanning, and a hard cap so a monorepo-sized checkout
 *  cannot turn one audit into a tree walk. The largest fleet tree measured was
 *  402 files; hitting the cap is REPORTED, never read as "nothing found". */
const SCAN_EXTS = [".html", ".svelte", ".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"];
export const SCAN_FILE_CAP = 1_500;
const FOREIGN_ANALYTICS = /googletagmanager\.com|\bgtag\s*\(|\bdataLayer\b/;
const INIT_ANALYTICS = /\binitAnalytics\b/;

/** One file under `src/` that references `initAnalytics`. */
export type InitAnalyticsReference = {
  /** Relative to the checkout. */
  file: string;
  /** The single literal measurementId in the file, or null when none/several. */
  measurementId: string | null;
  /** The single literal productionHost in the file, or null when none/several. */
  productionHost: string | null;
};

/** What a walk of `src/` found. Shared by the audit and `analytics-tag`, so the
 *  recipe's gate and the audit's reading can never disagree about one file. */
export type CheckoutScan = {
  references: InitAnalyticsReference[];
  /** First file referencing a tag manager outside initAnalytics, or null. */
  foreignFile: string | null;
  /** false when the walk stopped at SCAN_FILE_CAP. */
  complete: boolean;
};

/**
 * Walk `src/` once: every `initAnalytics` reference, wherever it is (the
 * recipe's `hooks.client.ts`, a `hooks.client.js`, the root layout the
 * package's own docs name, an aliased import), and the first file that loads a
 * tag manager some other way.
 *
 * Returns null when there is no `src/` to read.
 */
export async function scanCheckout(
  sitePath: string,
  cap: number = SCAN_FILE_CAP,
): Promise<CheckoutScan | null> {
  const root = join(sitePath, "src");
  try {
    await stat(root);
  } catch {
    return null;
  }
  let budget = cap;
  let complete = true;
  const references: InitAnalyticsReference[] = [];
  let foreignFile: string | null = null;
  const walk = async (dir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (!complete) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(full);
        continue;
      }
      if (!SCAN_EXTS.some((x) => e.name.endsWith(x))) continue;
      if (budget <= 0) {
        complete = false;
        return;
      }
      budget--;
      const text = await readIfPresent(full);
      if (text === null) continue;
      const rel = relative(sitePath, full).split("\\").join("/");
      // Both detections run on the RAW text, comments included, so they fail
      // closed: a commented-out loader still counts as one. The stripper
      // cannot parse markup (an apostrophe in `<p>Don't</p>` opens a phantom
      // string), and the recipe's refusal to install alongside an existing
      // loader must never depend on it. Only the literal VALUES are read from
      // the stripped text, where a misparse can only lose a value — which
      // reads as unknown, the safe direction.
      if (INIT_ANALYTICS.test(text)) {
        const code = stripComments(text);
        const ids = literalValues(code, "measurementId");
        const hosts = literalValues(code, "productionHost");
        references.push({
          file: rel,
          measurementId: ids.size === 1 ? [...ids][0]! : null,
          productionHost: hosts.size === 1 ? [...hosts][0]! : null,
        });
      }
      if (foreignFile === null && FOREIGN_ANALYTICS.test(text)) foreignFile = rel;
    }
  };
  await walk(root);
  return { references, foreignFile, complete };
}

/** Back-compat shim for callers that only need the first foreign file. */
export async function findForeignAnalytics(sitePath: string): Promise<string | null> {
  const scan = await scanCheckout(sitePath);
  return scan === null ? null : scan.foreignFile === null ? null : join(sitePath, scan.foreignFile);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** `src/lib/site-config.json`'s analytics block, or null when absent, and
 *  "corrupt" when it cannot be parsed. */
async function readSiteConfig(
  sitePath: string,
): Promise<{ measurementId: string | null; productionHost: string | null } | null | "corrupt"> {
  const raw = await readIfPresent(join(sitePath, SITE_CONFIG_RELATIVE));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "corrupt";
  }
  const block =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["analytics"]
      : undefined;
  if (!block || typeof block !== "object") return null;
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
  return declared.measurementId !== null || declared.productionHost !== null ? declared : null;
}

/**
 * What the site's checkout declares it will emit.
 *
 * Every `initAnalytics` reference under `src/` is read, not one file: the
 * recipe writes `src/hooks.client.ts`, but the package's own docs have the root
 * layout call it, and a JS site has `hooks.client.js`. Reading only the
 * recipe's file made every other shape "declares nothing", and the default
 * path then hard-failed the site.
 *
 * A declaration is legible only when every reference names the SAME literal
 * measurement ID. Anything else — an imported ID, two references that
 * disagree, an aliased import — is `unreadableCall`, which the verdict treats
 * as unknown. `src/lib/site-config.json` supplies the values when the code
 * reads them from there, and is the declaration when nothing calls the package.
 *
 * The foreign-loader scan runs on every path, and a walk that hit its cap says
 * so. Returns null only when the checkout could not be inspected at all (no
 * `src/`, or a corrupt site-config.json).
 */
export async function readTagConfig(
  sitePath: string,
  cap: number = SCAN_FILE_CAP,
): Promise<TagConfig | null> {
  const scan = await scanCheckout(sitePath, cap);
  if (scan === null) return null;

  const common: Pick<TagConfig, "foreignAnalytics" | "foreignFile" | "scanIncomplete"> = {
    foreignAnalytics: scan.foreignFile !== null,
    ...(scan.foreignFile !== null ? { foreignFile: scan.foreignFile } : {}),
    ...(scan.complete ? {} : { scanIncomplete: true }),
  };

  const refs = scan.references;
  const ids = new Set(refs.map((r) => r.measurementId));
  if (refs.length > 0 && ids.size === 1 && !ids.has(null)) {
    const hosts = new Set(refs.map((r) => r.productionHost));
    return {
      measurementId: [...ids][0]!,
      // Legible only when every reference names the same literal host.
      productionHost: hosts.size === 1 && !hosts.has(null) ? [...hosts][0]! : null,
      declaredIn: refs.map((r) => r.file).join(", "),
      ...common,
    };
  }

  // Needed only now, so a corrupt file cannot blank a legible declaration.
  const siteConfig = await readSiteConfig(sitePath);
  if (siteConfig === "corrupt") return null;

  if (refs.length > 0) {
    // The code reads its values from site-config.json: that file is the
    // declaration, and the references are where it is used.
    if (
      siteConfig !== null &&
      siteConfig.measurementId !== null &&
      ids.size === 1 &&
      ids.has(null)
    ) {
      return { ...siteConfig, declaredIn: SITE_CONFIG_RELATIVE, ...common };
    }
    return {
      measurementId: null,
      productionHost: null,
      unreadableCall: refs.map((r) => r.file).join(", "),
      ...common,
    };
  }

  if (siteConfig !== null && siteConfig.measurementId !== null) {
    return { ...siteConfig, declaredIn: SITE_CONFIG_RELATIVE, ...common };
  }
  return { measurementId: null, productionHost: null, ...common };
}

/** A page's event surface, as much of Playwright's `Page` as the probe uses. */
export type ProbePage = {
  on(event: "response", handler: (res: ProbeResponse) => void): unknown;
  on(event: "requestfailed", handler: (req: ProbeRequest) => void): unknown;
};
export type ProbeRequest = { url(): string; failure(): { errorText: string } | null };
export type ProbeResponse = { url(): string; status(): number; ok(): boolean };

/**
 * Record which gtag loaders ARRIVE on `page`: a 2xx response counts, and a
 * failed request (net::ERR_BLOCKED_BY_CSP, a DNS failure) or a non-2xx
 * response is recorded as failed with its reason. Returns a live view the
 * caller reads after the page has settled.
 */
export function collectLoaderIds(
  page: ProbePage,
): TagProbe & { failed: Array<{ id: string; reason: string }> } {
  const result = { loadedIds: [] as string[], failed: [] as Array<{ id: string; reason: string }> };
  page.on("response", (res) => {
    const ids = gtagLoaderIds(res.url());
    if (ids.length === 0) return;
    if (res.ok()) result.loadedIds.push(...ids);
    else for (const id of ids) result.failed.push({ id, reason: `HTTP ${res.status()}` });
  });
  page.on("requestfailed", (req) => {
    for (const id of gtagLoaderIds(req.url())) {
      result.failed.push({ id, reason: req.failure()?.errorText ?? "request failed" });
    }
  });
  return result;
}

/**
 * The real probe: drive the production URL in Chromium and record every gtag
 * loader that ARRIVES.
 *
 * Asserting the network and not the markup is the whole point: after the sweep
 * every fleet site injects its loader from bundle JS, so a markup assertion
 * would fail on precisely the sites that are working. And a response, not a
 * request: a loader the page's own CSP refuses is still requested.
 *
 * `waitUntil: "load"` and not `"networkidle"`: networkidle broke 4 of 14 sites
 * on the header-image work, and a site with a chat widget never reaches idle at
 * all. The settle window after load is what catches the effect-appended loader.
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
      const seen = collectLoaderIds(page);
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(settleMs);
      return { loadedIds: [...seen.loadedIds], failed: [...seen.failed] };
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
 * Read `activeUsers` for the window, or say why it cannot be read here.
 *
 * The GA client is imported only AFTER the credentials check, and its import
 * is caught. `src/reports/ga/client.ts` statically imports google-auth-library
 * and @google-analytics/data, which are devDependencies a fleet site never
 * installs — and this audit is in the default set, so an eager import made a
 * bare `reddoor-maint audit` in any site end in "unexpected error".
 */
export async function defaultReadUsers(): Promise<
  { readUsers: ReadUsers } | { readUsers: undefined; reason: string }
> {
  const { readGaConfig } = await import("../reports/ga/config.js");
  const cfg = readGaConfig();
  if (!cfg) return { readUsers: undefined, reason: "no GA credentials here" };
  let fetchPeriodUsers: (typeof import("../reports/ga/client.js"))["fetchPeriodUsers"];
  try {
    ({ fetchPeriodUsers } = await import("../reports/ga/client.js"));
  } catch {
    return {
      readUsers: undefined,
      reason: "the GA client libraries are not installed here (a site install never has them)",
    };
  }
  return {
    readUsers: async (
      propertyId: string,
      days: number,
      hostnames: string[],
    ): Promise<PropertyRead> => {
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
    },
  };
}

/** Opt-in for the browser probe. See {@link defaultAnalyticsDeps}. */
export const PROBE_ENV = "REDDOOR_ANALYTICS_PROBE";

/** `1`, `true`, `yes`, `on` (any case) turn the probe on; anything else,
 *  including `0` and `false`, leaves it off. */
export function probeRequested(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

/**
 * Wire the real IO, skipping any half this environment cannot do. A browser
 * that will not launch, absent GA credentials, or absent GA libraries must
 * leave the audit saying "not checked" — never failing a site for the runner's
 * shortcomings.
 *
 * The browser probe is OFF unless `REDDOOR_ANALYTICS_PROBE` is truthy. This
 * audit is in `ALL_AUDIT_NAMES`, `reddoor-maint audit --fleet` defaults to every
 * audit and its default concurrency is unbounded, so a probe on by default
 * would launch one Chromium per site. The 2026-08-24 overload was six agents
 * and one Chrome.
 */
export async function defaultAnalyticsDeps(site: {
  ga4PropertyId?: string | null | undefined;
}): Promise<AnalyticsDeps> {
  let probeTag: ((url: string) => Promise<TagProbe>) | undefined;
  if (probeRequested(process.env[PROBE_ENV])) {
    try {
      probeTag = await defaultTagProbe();
    } catch {
      probeTag = undefined;
    }
  }
  let read: Awaited<ReturnType<typeof defaultReadUsers>>;
  try {
    read = await defaultReadUsers();
  } catch (e) {
    read = {
      readUsers: undefined,
      reason: `the GA client could not load (${(e as Error).message})`,
    };
  }
  return {
    propertyId: site.ga4PropertyId,
    probeTag,
    fetchHtml: defaultFetchHtml,
    readUsers: read.readUsers,
    ...("reason" in read ? { readUsersUnavailable: read.reason } : {}),
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

function result(
  site: AuditContext["site"],
  status: AuditResult["status"],
  summary: string,
  details: unknown,
): AuditResult {
  return { audit: "analytics", site: siteLabel(site), status, summary, details };
}

export async function analyticsAudit(ctx: AuditContext): Promise<AuditResult> {
  const site = ctx.site;
  // Spec D8 (#936): a site that accepts `no analytics` runs its own analytics,
  // or none, by the operator's decision. Neither end is ours to pair, so this
  // returns before any IO is wired: no GET, no browser, no Data API call.
  if (site.analyticsOptedOut === true) {
    return result(
      site,
      "skip",
      "analytics: the site row accepts `no analytics`, so there is no tag or property of ours " +
        "to pair.",
      { optedOut: true },
    );
  }

  // Everything that needs no IO first, so a verdict that needs none never
  // waits on a GET, a browser or the Data API.
  const rawProperty = ctx.analyticsDeps ? ctx.analyticsDeps.propertyId : site.ga4PropertyId;
  // Trim the VALUE, not just the test. A trailing newline is what a
  // `gh api --jq` round-trip or a spreadsheet paste leaves behind.
  const trimmed = typeof rawProperty === "string" ? rawProperty.trim() : rawProperty;
  if (typeof trimmed === "string" && trimmed.length > 0 && !/^\d+$/.test(trimmed)) {
    return result(
      site,
      "fail",
      `analytics: the fleet row's GA4 property ID is ${JSON.stringify(rawProperty)}, which is not ` +
        "a numeric property ID" +
        (/^G-/i.test(trimmed)
          ? " — it is a `G-…` measurement ID, which ships in the page and which the Data API " +
            "cannot read. The two are different values and only the numeric one belongs on the row."
          : ". The Data API reads only the numeric ID shown under Admin → Property details."),
      { propertyId: rawProperty },
    );
  }
  const propertyId = trimmed === "" ? null : trimmed;
  const config = await readTagConfig(site.path);
  const siteUrl = site.deployedUrl ?? null;

  if (config === null || propertyId === undefined) {
    const verdict = classifyAnalytics({
      config,
      propertyId,
      siteUrl,
      evidence: { probe: null, htmlIds: null },
      property: null,
      windowDays: DEFAULT_WINDOW_DAYS,
    });
    return result(site, verdict.status, withUnchecked(verdict), {
      config,
      propertyId: propertyId ?? null,
      unchecked: verdict.unchecked,
    });
  }

  const deps: AnalyticsDeps = ctx.analyticsDeps ?? (await defaultAnalyticsDeps(site));
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const reachable = siteUrl !== null && isHttpUrl(siteUrl);

  let probe: TagProbe | null = null;
  if (deps.probeTag && reachable) {
    try {
      probe = await deps.probeTag(siteUrl);
    } catch {
      // A probe that threw is "not checked", never "no tag".
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

  // An EMPTY hostname list is not "no filter wanted" — `fetchPeriodUsers` omits
  // the dimensionFilter entirely for it and answers with every environment's
  // traffic, which on reddoor's own property is 13,417 against 105. So a site
  // with no usable URL simply does not get this half checked.
  let property: PropertyRead | null = null;
  let propertyNotRead: string | undefined;
  const hostnames = reportedHostnames(siteUrl);
  if (typeof propertyId === "string") {
    if (!deps.readUsers) {
      propertyNotRead = deps.readUsersUnavailable ?? "no GA credentials here";
    } else if (hostnames.length === 0) {
      propertyNotRead = "no site URL to filter it by";
    } else {
      try {
        property = await deps.readUsers(propertyId, windowDays, hostnames);
      } catch (e) {
        property = { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
      }
    }
  }

  const evidence: EmissionEvidence = { probe, htmlIds };
  const verdict = classifyAnalytics({
    config,
    propertyId,
    siteUrl,
    evidence,
    property,
    ...(propertyNotRead !== undefined ? { propertyNotRead } : {}),
    windowDays,
  });
  return result(site, verdict.status, withUnchecked(verdict), {
    config,
    propertyId,
    emission: determineEmission(evidence),
    property,
    unchecked: verdict.unchecked,
  });
}

function withUnchecked(verdict: AnalyticsVerdict): string {
  return verdict.unchecked.length > 0
    ? `${verdict.summary} Not checked: ${verdict.unchecked.join("; ")}.`
    : verdict.summary;
}
