import {
  formsNotifyTarget,
  LIVE_STATUS,
  VERIFY_STATUS,
  type FormsNotifyTargetResult,
} from "../../recipes/forms-notify-target.js";

export type FormsNotifyTargetCommandOptions = {
  set?: string;
  restore?: string;
  cwd?: string;
};

const AUDIENCE_LABEL = {
  client: "THE CLIENT",
  operator: "OPERATOR ONLY",
  nobody: "NOBODY",
} as const;

/** The line that decides whether it is safe to test-submit. Deliberately the
 *  loudest thing on screen: the incident happened because the answer was
 *  invisible, not because it was subtle. */
export function formatNotifyTarget(r: FormsNotifyTargetResult): string {
  const lines: string[] = [];
  if (r.flip) {
    const arrow = `${r.flip.from ?? "blank"} → ${r.flip.to}`;
    lines.push(
      r.flip.confirmed
        ? `${r.site}  Status: ${arrow}  ✓ confirmed by read-back`
        : `${r.site}  Status: ${arrow}  ✗ NOT CONFIRMED — the row still reads "${r.status ?? "blank"}". Nothing was verified; do not test-submit.`,
    );
  } else {
    lines.push(`${r.site}  Status: ${r.status ?? "blank"}`);
  }

  lines.push(`A submission right now would notify: ${AUDIENCE_LABEL[r.target.audience]}`);
  if (r.target.to.length > 0) lines.push(`  to: ${r.target.to.join(", ")}`);
  if (r.target.cc.length > 0) lines.push(`  cc: ${r.target.cc.join(", ")}`);
  lines.push(`  ${r.target.reason}`);

  if (r.target.audience === "client") {
    lines.push(
      "",
      `⚠️  A test submission WILL email the client, and email cannot be recalled.`,
      `   Route it to yourself first:  reddoor forms-notify-target ${r.site} --set on`,
    );
  }
  if (r.flip?.confirmed && r.flip.to === VERIFY_STATUS) {
    lines.push(
      "",
      `Safe to test. When you are done, restore it:`,
      `  reddoor forms-notify-target ${r.site} --set off --restore ${r.flip.from ?? LIVE_STATUS}`,
    );
  }
  return lines.join("\n");
}

/**
 * `forms-notify-target <site>` — show who a form submission would email, and
 * optionally flip the pre-launch guard with a read-back confirmation.
 *
 * Read-only by default: answering the question must never be riskier than not
 * asking it.
 */
export async function runFormsNotifyTargetCommand(
  site: string | undefined,
  opts: FormsNotifyTargetCommandOptions,
): Promise<{ output: string; code: number }> {
  if (!site?.trim()) {
    return { output: "forms-notify-target requires <site> (slug or site name)", code: 2 };
  }
  const set = opts.set?.trim().toLowerCase();
  if (set !== undefined && set !== "on" && set !== "off") {
    return { output: `--set must be 'on' or 'off' (got '${opts.set}')`, code: 2 };
  }
  try {
    // #539 Phase 5: the flip writes Status on the Websites row; mirror it so the
    // console (which reads Turso) shows the new routing immediately.
    const { makeSiteMirror } = await import("../../db/site-mirror.js");
    // #646 step 4: the fleet roster — and the flip's read-back — come from Turso,
    // which is the store `/api/forms/:slug` reads to decide who a submission
    // emails, and the only one that can see a `site_<ULID>` site.
    const { readFleetRoster } = await import("../../fleet/roster.js");
    const result = await formsNotifyTarget({
      roster: () => readFleetRoster(),
      siteMirror: await makeSiteMirror(),
      site: site.trim(),
      ...(set ? { set: set as "on" | "off" } : {}),
      ...(opts.restore ? { restore: opts.restore } : {}),
    });
    // An unconfirmed flip must not exit 0: a script (or a person skimming) that
    // reads exit status would otherwise take "I flipped it" on faith, which is
    // exactly the assumption that sent a client a test lead.
    return {
      output: formatNotifyTarget(result),
      code: result.flip && !result.flip.confirmed ? 1 : 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}
