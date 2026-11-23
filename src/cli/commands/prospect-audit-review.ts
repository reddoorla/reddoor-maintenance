import type { Db } from "../../db/client.js";
import type { ReviewActionResult } from "../../db/prospect-audits.js";
import { isValidToken } from "../../prospect/audit-status.js";

/**
 * W1: approve, withdraw or supersede one prospect audit report.
 *
 * A finished run is a draft whose link 404s for anyone but the editor. This is
 * the step that makes it live, after a person has read it; and the step that
 * takes a wrong one down. Each writes one `prospect_audits` row and says who.
 */
export type ProspectAuditReviewOptions = {
  approve?: boolean;
  withdraw?: boolean;
  /** The newer report's token: the old link points there while it is live. */
  supersedeBy?: string;
  by?: string;
  openDb?: () => Promise<Db>;
};

export async function runProspectAuditReviewCommand(
  token: string,
  opts: ProspectAuditReviewOptions,
): Promise<{ output: string; code: number }> {
  const actions = [opts.approve, opts.withdraw, opts.supersedeBy !== undefined].filter(Boolean);
  if (actions.length !== 1) {
    return {
      output: "Pass exactly one of --approve, --withdraw or --supersede-by <token>.",
      code: 2,
    };
  }
  if (!isValidToken(token)) return { output: `"${token}" is not a report token.`, code: 2 };
  if (opts.supersedeBy !== undefined && !isValidToken(opts.supersedeBy)) {
    return { output: `"${opts.supersedeBy}" is not a report token.`, code: 2 };
  }
  const by = (opts.by ?? "").trim();
  if (!by) return { output: "Say who is doing this: --by <your name>.", code: 2 };

  const db = await (opts.openDb?.() ??
    import("../../db/client.js").then(({ openDb, readDbConfig }) => openDb(readDbConfig())));
  const m = await import("../../db/prospect-audits.js");
  let res: ReviewActionResult;
  if (opts.approve) res = await m.approveProspectAudit(db, token, by);
  else if (opts.withdraw) res = await m.withdrawProspectAudit(db, token, by);
  else res = await m.supersedeProspectAudit(db, token, opts.supersedeBy!, by);

  switch (res.status) {
    case "approved":
      return { output: `Approved by ${by}: the link is live.`, code: 0 };
    case "withdrawn":
      return { output: `Withdrawn by ${by}: the link now 404s for everyone.`, code: 0 };
    case "superseded":
      return {
        output: `Superseded by the newer report and withdrawn: the old link points to it while it is live.`,
        code: 0,
      };
    case "not-found":
      return { output: `No report behind ${res.token}.`, code: 1 };
    case "refused":
      return { output: `Refused: ${res.reason}.`, code: 1 };
  }
}
