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
    return { output: "forms-notify-target requires <site> (slug or Airtable name)", code: 2 };
  }
  const set = opts.set?.trim().toLowerCase();
  if (set !== undefined && set !== "on" && set !== "off") {
    return { output: `--set must be 'on' or 'off' (got '${opts.set}')`, code: 2 };
  }
  try {
    const result = await formsNotifyTarget({
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
