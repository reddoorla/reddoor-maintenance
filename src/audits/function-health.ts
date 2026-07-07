import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** The parts of the deployed `/health` body this audit reads. `ok` is the endpoint's self-rollup
 *  (`functionRan && prismic !== "error"`); `prismic` is the server-side CMS probe status; `forms`
 *  are booleans recorded for the dashboard only. A public endpoint can return anything, so every
 *  field is validated/coerced by `parseHealthBody`. */
export type HealthBody = {
  ok: boolean;
  prismic: "ok" | "error" | "skipped" | null;
  forms: { ingestUrl: boolean; ingestToken: boolean; turnstile: boolean } | null;
};

/** Outcome of fetching `{deployedUrl}/health`, distinguishing "no usable report" (`present:false`
 *  → self-skip, the writer preserves the prior verdict) from "read a body" (`present:true`
 *  → a real pass/fail). `present:true` with a real `HealthBody` is a 200 JSON response (`ok`
 *  drives pass/fail); the fetch layer also synthesizes an all-`ok:false` body for "deployed but
 *  erroring" responses (a non-404 non-2xx, or a 200 that isn't valid JSON) so those fail loudly
 *  instead of silently skipping. Mirrors `netlify-deploy`'s `NetlifyDeployFetch` read/no-read split. */
export type HealthFetch = { present: false } | { present: true; body: HealthBody };

/** Injected IO so the audit is unit-testable without a network. `fetchHealth` returns a
 *  `HealthFetch`; `now` is the clock for the checked-at stamp. */
export type FunctionHealthDeps = {
  fetchHealth: (deployedUrl: string) => Promise<HealthFetch>;
  now: Date;
};

const HEALTH_TIMEOUT_MS = 10_000;

/** A synthetic "deployed but erroring" body for responses that carry no real health data — a
 *  non-404 non-2xx status, or a 200 whose body isn't valid JSON. `ok:false` drives a `fail`
 *  verdict; the null fields just mean "nothing more to report" (not a real CMS/forms read). */
const ERRORING_BODY: HealthBody = { ok: false, prismic: null, forms: null };

/** Coerce an untrusted `/health` JSON payload into a `HealthFetch`. PURE. A non-object, or a body
 *  without a boolean `ok`, is `{present:false}` (not a usable report — the endpoint hasn't
 *  adopted the health-check contract, distinct from a deployed-but-erroring response). An
 *  unrecognized `prismic` or a missing/!object `forms` degrades that field to null but keeps the
 *  body present. */
export function parseHealthBody(raw: unknown): HealthFetch {
  if (!raw || typeof raw !== "object") return { present: false };
  const o = raw as Record<string, unknown>;
  if (typeof o["ok"] !== "boolean") return { present: false };
  const prismic =
    o["prismic"] === "ok" || o["prismic"] === "error" || o["prismic"] === "skipped"
      ? (o["prismic"] as "ok" | "error" | "skipped")
      : null;
  const f = o["forms"];
  const forms =
    f && typeof f === "object"
      ? {
          ingestUrl: (f as Record<string, unknown>)["ingestUrl"] === true,
          ingestToken: (f as Record<string, unknown>)["ingestToken"] === true,
          turnstile: (f as Record<string, unknown>)["turnstile"] === true,
        }
      : null;
  return { present: true, body: { ok: o["ok"], prismic, forms } };
}

/** Real fetch deps. GETs `{deployedUrl}/health` with a 10s abort timeout. Maps the response
 *  precisely so a _deployed-but-erroring_ function fails loudly while a _not-yet-adopted_
 *  `/health` stays a self-skip (spec R2.1):
 *   - unparseable deployed URL, network error/timeout, or HTTP 404 → `{present:false}` (not
 *     adopted / unreachable — self-skip, writer preserves the prior verdict).
 *   - any OTHER non-2xx (5xx, 403, …), or a 200 whose body isn't valid JSON → `{present:true,
 *     body:ERRORING_BODY}` (deployed but erroring — a real `fail`).
 *   - a 200 JSON body → `parseHealthBody` (usually a real pass/fail; an unrecognized shape still
 *     degrades to `{present:false}`, i.e. not-yet-adopted).
 *  NEVER throws, so one site's dead endpoint can't red an unrelated site in the fleet sweep.
 *  `fetchImpl` is injected only so the default deps stay testable; production callers pass
 *  nothing. */
export function defaultFunctionHealthDeps(
  now: Date,
  fetchImpl: typeof fetch = fetch,
): FunctionHealthDeps {
  return {
    now,
    fetchHealth: async (deployedUrl): Promise<HealthFetch> => {
      let url: string;
      try {
        // Root `/health` — an absolute path replaces any path on the deployed URL.
        url = new URL("/health", deployedUrl).toString();
      } catch {
        return { present: false }; // unparseable deployed URL — nothing to probe
      }
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      } catch {
        return { present: false }; // network error / timeout — unreachable, self-skip
      }
      if (res.status === 404) return { present: false }; // not adopted yet — self-skip
      if (!res.ok) return { present: true, body: ERRORING_BODY }; // deployed but erroring — fail
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { present: true, body: ERRORING_BODY }; // 200 non-JSON — deployed but erroring, fail
      }
      return parseHealthBody(body);
    },
  };
}

/**
 * Audit a site's deployed `/health` function. Checkout-free — needs only `site.deployedUrl`. Skips
 * a site with no deployed URL. Status mapping (spec Phase 2, R2.1):
 *  - no usable report (unreachable, timeout, or `/health` 404 — not yet adopted) → `skip` WITHOUT
 *    details → the Airtable writer preserves the prior verdict (a site that hasn't adopted
 *    `/health`, or a transient outage, stays "never ran"; Plan 4 maps that to unknown/amber, which
 *    blocks).
 *  - deployed but erroring — any other non-2xx, a 200 non-JSON body, or a 200 JSON body with
 *    `ok:false` → `fail` (records details so the fail persists).
 *  - a 200 JSON body with `ok:true` → `pass` (records details).
 * `details` carries `{ ok, prismic, forms, checkedAt }`; the Airtable layer derives the
 * `Function health` + `CMS Reachable` verdicts (CMS from `prismic === "ok"`) + the checked-at stamp.
 * It must NEVER write `Deploy status` — that stays the Netlify build state.
 */
export async function functionHealthAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "function-health", site: label, status: "skip", summary: "no deployed URL" };
  }
  const now = ctx.now ?? new Date();
  const deps = ctx.functionHealthDeps ?? defaultFunctionHealthDeps(now);
  const fetched: HealthFetch = await deps
    .fetchHealth(site.deployedUrl)
    .catch(() => ({ present: false }) as HealthFetch);

  if (!fetched.present) {
    return {
      audit: "function-health",
      site: label,
      status: "skip",
      summary: "health endpoint unreachable / not JSON",
    };
  }
  const checkedAt = now.toISOString();
  const status: AuditResult["status"] = fetched.body.ok ? "pass" : "fail";
  const summary = `health ${fetched.body.ok ? "ok" : "not ok"} (prismic ${fetched.body.prismic ?? "?"})`;
  return {
    audit: "function-health",
    site: label,
    status,
    summary,
    details: {
      ok: fetched.body.ok,
      prismic: fetched.body.prismic,
      forms: fetched.body.forms,
      checkedAt,
    },
  };
}
