import { dirname, join } from "node:path";
import { defaultCredentialsPath } from "../../util/credentials.js";

export type GaConfig = {
  /** Workspace users the service account impersonates (domain-wide delegation), in
   *  failover order — the first subject that authenticates wins. */
  subjects: string[];
  /** Absolute path to the service-account JSON key file. */
  keyPath: string;
};

/**
 * Read GA configuration from the environment (credentials.env is already loaded into
 * process.env by the CLI entrypoint). Returns null when `GA_SUBJECT` is unset/blank — the
 * signal that GA enrichment is simply not configured, so drafting skips it silently.
 *
 * `GA_SUBJECT` is a comma-separated list of impersonation subjects tried in order
 * (e.g. `reports@reddoorla.com,person@reddoorla.com`), so losing one Workspace account
 * degrades to a logged failover instead of blanking the whole fleet's analytics; a single
 * address remains the degenerate one-element case. Entries are trimmed, empties dropped.
 *
 * `GA_SA_KEY_PATH` is optional; it defaults to `ga-service-account.json` alongside the
 * credentials file (e.g. ~/.config/reddoor-maint/), keeping the key out of the repo.
 */
export function readGaConfig(): GaConfig | null {
  const subjects = (process.env.GA_SUBJECT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (subjects.length === 0) return null;
  const keyPath =
    process.env.GA_SA_KEY_PATH?.trim() ||
    join(dirname(defaultCredentialsPath()), "ga-service-account.json");
  return { subjects, keyPath };
}
