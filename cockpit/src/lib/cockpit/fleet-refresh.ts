/**
 * The ↻ Audit fleet run follower, ported from the cockpit's inline
 * `AUDIT_SCRIPT` (#582): dispatch, then poll the actual runs and follow them,
 * resuming after a reload from localStorage. Pure helpers here; the component
 * holds the state.
 */

export const RF_KEY = "reddoor:fleet-refresh";
export const RF_POLL_MS = 10000;
/** Safety ceiling; a full fleet Lighthouse run was ~48 min (2026-06-24). */
export const RF_MAX_MS = 90 * 60 * 1000;
export const RF_CONFIRM =
  "Kick off the security + Lighthouse sweeps for the whole fleet? They take a few minutes.";

export type WorkflowStatus = { workflow?: unknown; state?: unknown; url?: unknown };
export type FleetStatus = {
  perWorkflow: WorkflowStatus[];
  allDone?: boolean;
  anyFailure?: boolean;
};

export type RfRow =
  | {
      kind: "workflow";
      icon: "done" | "failed" | "spin";
      label: string;
      state: string;
      /** Shown while the run is still going. */
      progress: { elapsed: string; eta: string; url: string | null } | null;
      /** Shown on a failed run. */
      failedUrl: string | null;
    }
  | { kind: "text"; text: string }
  | { kind: "starting" }
  | { kind: "reload" };

/** Per-workflow ETA hint (the lighthouse fleet sweep runs ~48 min; security ~1-2 min). */
function eta(label: string): string {
  return label === "lighthouse" ? "~48m" : label === "security" ? "~2m" : "";
}

/** A run link must be a GitHub run URL. Anything else is dropped rather than
 *  rendered, so a compromised or unexpected API response cannot place an
 *  arbitrary href (javascript:, data:, an attacker's host) in the panel. */
function runUrl(u: unknown): string | null {
  return typeof u === "string" && u.indexOf("https://github.com/") === 0 ? u : null;
}

const isFailed = (s: unknown) => s === "failure" || s === "cancelled" || s === "timed_out";

export function workflowRows(status: FleetStatus, startedAt: number, now: number): RfRow[] {
  const mins = Math.floor((now - startedAt) / 60000);
  const elapsed = mins < 1 ? "<1m" : mins + "m";
  return status.perWorkflow.map((w) => {
    const label = String(w.workflow || "")
      .replace(".yml", "")
      .replace("fleet-", "");
    const done = w.state === "success";
    const failed = isFailed(w.state);
    const url = runUrl(w.url);
    return {
      kind: "workflow",
      icon: done ? "done" : failed ? "failed" : "spin",
      label,
      state: String(w.state || "").replace("_", " "),
      progress: !done && !failed ? { elapsed, eta: eta(label), url } : null,
      failedUrl: failed ? url : null,
    };
  });
}

/** The saved in-flight run, if it is still worth following. */
export function readSaved(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now: number,
): { since: string; startedAt: number } | null {
  try {
    const saved = JSON.parse(storage.getItem(RF_KEY) || "null");
    if (saved && saved.since && saved.startedAt && now - saved.startedAt < RF_MAX_MS) {
      return { since: saved.since, startedAt: saved.startedAt };
    }
    if (saved) storage.removeItem(RF_KEY);
  } catch {
    // unreadable storage or JSON: nothing to resume
  }
  return null;
}
