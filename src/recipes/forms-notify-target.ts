import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import {
  listWebsites,
  siteSlug,
  updateSiteField,
  type Status,
  type WebsiteRow,
} from "../reports/airtable/websites.js";
import { describeNotifyTarget, type NotifyTarget } from "../forms/notify.js";

/** The Airtable column the pre-launch guard actually lives in. */
export const STATUS_COLUMN = "Status";

/** The two ends of the verify flip. Deliberately the ONLY transition this
 *  performs: a site in any other status is already guarded (or is deliberately
 *  something else, like "hosting"), and silently rewriting that would be the
 *  same class of unseen change as the incident. */
export const LIVE_STATUS: Status = "maintenance";
export const VERIFY_STATUS: Status = "launch period";

export type FormsNotifyTargetDeps = {
  base?: AirtableBase;
  /** Site slug or the Airtable Websites NAME (both accepted). */
  site: string;
  /** `on` routes notifications to the operator; `off` restores. Omit to read. */
  set?: "on" | "off";
  /** Status to restore with `--set off`. Required, never inferred. */
  restore?: string;
};

export type FormsNotifyTargetResult = {
  site: string;
  status: Status | null;
  target: NotifyTarget;
  /** Present only when a flip was attempted. `confirmed` is the whole point:
   *  it comes from RE-READING the row, not from the write call returning. */
  flip?: { from: Status | null; to: Status; confirmed: boolean };
};

function findSite(rows: WebsiteRow[], site: string): WebsiteRow | undefined {
  const wanted = site.trim().toLowerCase();
  return rows.find(
    (r) => siteSlug(r.name) === siteSlug(site) || r.name.trim().toLowerCase() === wanted,
  );
}

/**
 * Answer "who would a form submission on this site email?" — and optionally
 * flip the pre-launch guard, confirming the flip by reading it back.
 *
 * The guard is a single Airtable `Status` cell. Nothing between "I intended to
 * flip it" and "the client received a test lead" reported the current state, so
 * on 2026-08-03 a flip that never landed sent a real client a test submission.
 * The fix is not a better intention, it is feedback: this reads the row back
 * after every write and refuses to call the flip confirmed on anything less.
 */
export async function formsNotifyTarget(
  deps: FormsNotifyTargetDeps,
): Promise<FormsNotifyTargetResult> {
  const base = deps.base ?? openBase(readAirtableConfig());
  const rows = await listWebsites(base);
  const row = findSite(rows, deps.site);
  if (!row) {
    // The Websites NAME is not the repo slug ("Sonder", not "gallerysonder"),
    // and that mismatch has cost time before — so name the near misses rather
    // than making the operator go read Airtable to find the spelling.
    const needle = siteSlug(deps.site);
    const near = rows
      .map((r) => r.name)
      .filter((n) => siteSlug(n).includes(needle) || needle.includes(siteSlug(n)));
    throw Object.assign(
      new Error(
        `No Websites row matches '${deps.site}'. The Websites NAME is not always the repo ` +
          `slug (Sonder, not gallerysonder).` +
          (near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : ""),
      ),
      { exitCode: 2 },
    );
  }

  if (!deps.set) {
    return { site: row.name, status: row.status, target: describeNotifyTarget(row) };
  }

  const to = deps.set === "on" ? VERIFY_STATUS : (deps.restore?.trim() as Status | undefined);
  if (deps.set === "off" && !to) {
    throw Object.assign(
      new Error(
        `--set off needs --restore <status>: the status to return to is never inferred. ` +
          `Guessing "${LIVE_STATUS}" for a site that was "hosting" or "legacy" would start ` +
          `sending real client notifications — the inverse of the failure this command exists ` +
          `to prevent.`,
      ),
      { exitCode: 2 },
    );
  }
  // Only ever flip a LIVE site into verify mode. A site already outside
  // "maintenance" is guarded already, and rewriting its status would destroy a
  // real value nobody asked us to touch.
  if (deps.set === "on" && row.status !== LIVE_STATUS) {
    throw Object.assign(
      new Error(
        `${row.name} is "${row.status ?? "blank"}", not "${LIVE_STATUS}" — notifications ` +
          `already go to the operator only, so there is nothing to flip. Leaving the status ` +
          `untouched.`,
      ),
      { exitCode: 2 },
    );
  }

  await updateSiteField(base, row.id, STATUS_COLUMN, to!);

  // Read it back. The write returning is NOT evidence the field changed.
  const after = findSite(await listWebsites(base), deps.site);
  if (!after) {
    throw Object.assign(new Error(`${row.name} vanished from Websites during the flip.`), {
      exitCode: 1,
    });
  }
  return {
    site: after.name,
    status: after.status,
    target: describeNotifyTarget(after),
    flip: { from: row.status, to: to!, confirmed: after.status === to },
  };
}
