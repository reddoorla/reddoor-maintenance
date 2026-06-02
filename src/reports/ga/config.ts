import { dirname, join } from "node:path";
import { defaultCredentialsPath } from "../../util/credentials.js";

export type GaConfig = {
  /** Workspace user the service account impersonates (domain-wide delegation). */
  subject: string;
  /** Absolute path to the service-account JSON key file. */
  keyPath: string;
};

/**
 * Read GA configuration from the environment (credentials.env is already loaded into
 * process.env by the CLI entrypoint). Returns null when `GA_SUBJECT` is unset — the
 * signal that GA enrichment is simply not configured, so drafting skips it silently.
 *
 * `GA_SA_KEY_PATH` is optional; it defaults to `ga-service-account.json` alongside the
 * credentials file (e.g. ~/.config/reddoor-maint/), keeping the key out of the repo.
 */
export function readGaConfig(): GaConfig | null {
  const subject = process.env.GA_SUBJECT?.trim();
  if (!subject) return null;
  const keyPath =
    process.env.GA_SA_KEY_PATH?.trim() ||
    join(dirname(defaultCredentialsPath()), "ga-service-account.json");
  return { subject, keyPath };
}
