import { createHash } from "node:crypto";

export type MailchimpResult = { ok: boolean; status: number };

export type AddMailchimpMemberInput = {
  /** Mailchimp Marketing API key, format `key-dc` (e.g. "abc123-us21"). */
  apiKey: string;
  /** Audience (list) ID. */
  audienceId: string;
  email: string;
  name?: string | null;
  /** Status for a NEW member. Default "subscribed" (immediate, no double opt-in). */
  status?: "subscribed" | "pending";
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
};

/** Split a full name into Mailchimp FNAME/LNAME merge fields. */
function splitName(name: string | null | undefined): { FNAME?: string; LNAME?: string } {
  const n = (name ?? "").trim();
  if (!n) return {};
  const [first = n, ...rest] = n.split(/\s+/);
  const out: { FNAME?: string; LNAME?: string } = { FNAME: first };
  if (rest.length) out.LNAME = rest.join(" ");
  return out;
}

/**
 * Upsert a subscriber into a Mailchimp audience (PUT /members/{md5(lowercased
 * email)} — idempotent, so a repeat signup is a no-op rather than an error). Uses
 * `status_if_new` only, so an already-unsubscribed member is NOT force-resubscribed
 * (compliance-safe). NEVER throws — a missing datacenter, non-2xx, or network error
 * returns `{ok:false}` so the caller treats it as a swallowed side-effect.
 */
export async function addMailchimpMember(input: AddMailchimpMemberInput): Promise<MailchimpResult> {
  const doFetch = input.fetch ?? fetch;
  const dash = input.apiKey.lastIndexOf("-");
  const dc = dash >= 0 ? input.apiKey.slice(dash + 1) : "";
  const email = input.email.trim();
  if (!dc || !input.audienceId || !email) {
    console.error("[mailchimp] missing datacenter/audience/email — skipping");
    return { ok: false, status: 0 };
  }
  const hash = createHash("md5").update(email.toLowerCase()).digest("hex");
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(
    input.audienceId,
  )}/members/${hash}`;
  const body: Record<string, unknown> = {
    email_address: email,
    status_if_new: input.status ?? "subscribed",
  };
  const merge = splitName(input.name);
  if (Object.keys(merge).length > 0) body.merge_fields = merge;
  const auth = Buffer.from(`anystring:${input.apiKey}`).toString("base64");
  try {
    const res = await doFetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[mailchimp] add member → ${res.status} (audience ${input.audienceId})`);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error(`[mailchimp] add member failed: ${String(err)}`);
    return { ok: false, status: 0 };
  }
}
