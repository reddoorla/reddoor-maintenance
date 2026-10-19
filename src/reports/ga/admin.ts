import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { withSubjectFailover } from "./failover.js";

const ANALYTICS_READONLY = "https://www.googleapis.com/auth/analytics.readonly";
const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

type DataStream = { type?: string; webStreamData?: { measurementId?: string } };

/**
 * The `G-` measurement IDs of a GA4 property's web streams, from the Admin
 * API, impersonating each subject in order until one answers.
 *
 * The fleet row stores only the numeric property ID the Data API reads, and
 * the site's code ships only the measurement ID, so this is the one authority
 * that says which tag feeds which property. `launch-check` asks it before
 * looking at the live page, so a page loading some other property's tag is
 * not read as done.
 */
export async function fetchWebStreamIds(
  propertyId: string,
  subjects: string[],
  keyPath: string,
): Promise<string[]> {
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as {
    client_email: string;
    private_key: string;
  };
  return withSubjectFailover(subjects, "GA Admin", async (subject) => {
    const jwt = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [ANALYTICS_READONLY],
      subject,
    });
    const res = await jwt.request<{ dataStreams?: DataStream[] }>({
      url: `${ADMIN_BASE}/properties/${encodeURIComponent(propertyId.trim())}/dataStreams`,
      method: "GET",
    });
    return (res.data.dataStreams ?? [])
      .filter((s) => s.type === "WEB_DATA_STREAM")
      .map((s) => s.webStreamData?.measurementId ?? "")
      .filter((id) => /^G-/i.test(id));
  });
}
