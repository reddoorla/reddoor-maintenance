import type { AuditResult } from "../types.js";
import type { FunctionHealthResult } from "../reports/airtable/websites.js";

type FunctionHealthDetails = {
  ok: boolean;
  prismic: "ok" | "error" | "skipped" | null;
  forms: unknown;
  checkedAt: string;
};

/** True when an AuditResult is a `function-health` audit carrying a usable details payload (i.e. it
 *  actually ran — a self-skip for an unreachable / non-JSON `/health`, or a site with no deployed
 *  URL, has no details, so the writer preserves the prior verdict). */
export function hasFunctionHealthResult(result: AuditResult): boolean {
  if (result.audit !== "function-health") return false;
  const d = result.details as FunctionHealthDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable function-health verdicts. `functionHealth` from `ok`; `cmsReachable`
 *  from the same body's `prismic` sub-status (R2.2): `"ok"` → `"pass"`, `"error"` → `"fail"`, and
 *  anything else (`"skipped"` — a placeholder repo, or a raw `null` from a "deployed but erroring"
 *  body / an unrecognized value) → `null` — the CMS probe never actually ran, so it must not red CMS
 *  reachability for a site that simply hasn't wired Prismic yet. Only `functionHealth` keys off
 *  `ok`. */
export function functionHealthResultFromAudit(result: AuditResult): FunctionHealthResult {
  if (result.audit !== "function-health") {
    throw new Error(`Expected a 'function-health' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as FunctionHealthDetails | undefined;
  const cmsReachable: "pass" | "fail" | null =
    d?.prismic === "ok" ? "pass" : d?.prismic === "error" ? "fail" : null;
  // `forms` is untyped on the details payload (unknown) — validate defensively. A boolean
  // `turnstile` inside an object → concrete verdict; anything else (null forms from an older
  // site package or a "deployed but erroring" body, a malformed shape) → null: the widget
  // state is simply unknown this run, never a fail. Powers the Require-Turnstile guardrail.
  const formsRaw = d?.forms;
  const turnstileFlag =
    formsRaw && typeof formsRaw === "object"
      ? (formsRaw as Record<string, unknown>)["turnstile"]
      : undefined;
  const turnstileWidget: "pass" | "fail" | null =
    typeof turnstileFlag === "boolean" ? (turnstileFlag ? "pass" : "fail") : null;
  return {
    functionHealth: d?.ok === true ? "pass" : "fail",
    cmsReachable,
    turnstileWidget,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
