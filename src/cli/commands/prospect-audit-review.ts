import type { Db } from "../../db/client.js";
import type { ReviewActionResult } from "../../db/prospect-audits.js";
import { isValidToken } from "../../prospect/audit-status.js";

/**
 * W1: approve, withdraw or supersede one prospect audit report.
 *
 * A finished run is a draft whose link 404s for anyone but the editor. This is
 * the step that makes it live, after a person has read it; and the step that
 * takes a wrong one down. Each writes one `prospect_audits` row and says who.
 *
 * The token is a FLAG (`--token=<token>`), not a positional: about one token in
 * 64 starts with "-", which cac reads as an option when it stands alone.
 */
export type ProspectAuditReviewOptions = {
  /** `unknown` because cac coerces a numeric-looking value to a number. */
  token?: unknown;
  approve?: boolean;
  withdraw?: boolean;
  /** Approve a partial run anyway. */
  partial?: boolean;
  /** The newer, already approved report: the old link points there. */
  supersedeBy?: unknown;
  by?: unknown;
  openDb?: () => Promise<Db>;
};

const text = (v: unknown): string => (v === undefined || v === null ? "" : String(v)).trim();

export async function runProspectAuditReviewCommand(
  opts: ProspectAuditReviewOptions,
): Promise<{ output: string; code: number }> {
  const supersedeBy = opts.supersedeBy === undefined ? undefined : text(opts.supersedeBy);
  const actions = [opts.approve, opts.withdraw, supersedeBy !== undefined].filter(Boolean);
  if (actions.length !== 1) {
    return {
      output: "Pass exactly one of --approve, --withdraw or --supersede-by=<token>.",
      code: 2,
    };
  }
  const token = text(opts.token);
  if (!isValidToken(token)) {
    return { output: "Pass the report's token as --token=<token> (22 characters).", code: 2 };
  }
  if (supersedeBy !== undefined && !isValidToken(supersedeBy)) {
    return { output: `"${supersedeBy}" is not a report token.`, code: 2 };
  }
  const by = text(opts.by);
  if (!by) return { output: "Say who is doing this: --by <your name>.", code: 2 };

  const db = await (opts.openDb?.() ??
    import("../../db/client.js").then(({ openDb, readDbConfig }) => openDb(readDbConfig())));
  const m = await import("../../db/prospect-audits.js");
  let res: ReviewActionResult;
  if (opts.approve)
    res = await m.approveProspectAudit(db, token, by, { allowPartial: opts.partial === true });
  else if (opts.withdraw) res = await m.withdrawProspectAudit(db, token, by);
  else res = await m.supersedeProspectAudit(db, token, supersedeBy!, by);

  switch (res.status) {
    case "approved":
      return { output: `Approved by ${by}: the link is live.`, code: 0 };
    case "withdrawn":
      return { output: `Withdrawn by ${by}: the link now 404s for everyone.`, code: 0 };
    case "superseded":
      return {
        output: "Superseded and withdrawn: the old link now sends readers to the newer report.",
        code: 0,
      };
    case "not-found":
      return { output: `No report behind ${res.token}.`, code: 1 };
    case "refused":
      return { output: `Refused: ${res.reason}.`, code: 1 };
  }
}
