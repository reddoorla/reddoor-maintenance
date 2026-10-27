import { createHash } from "node:crypto";
import type { FormType } from "./types.js";

export type MailchimpResult = {
  ok: boolean;
  status: number;
  /** Whether the requested tags were applied. Present ONLY when tags were asked for
   *  and the member add itself succeeded — absent means "no tags requested", which is
   *  not the same as "tagging failed". */
  tagged?: boolean;
};

/** Tags identifying a member the ingest pipeline added, so form signups are
 *  distinguishable from imported/manually-added members inside Mailchimp (the
 *  audience is otherwise a flat list — every API write shows the same
 *  "API - Generic" source). "Online Form" is the human-facing segment name the
 *  gallery asked for; the `form:` tag keeps the specific form machine-readable
 *  for later segmentation. PURE. */
export function mailchimpTagsFor(formType: FormType): string[] {
  return ["Online Form", `form:${formType}`];
}

export type AddMailchimpMemberInput = {
  /** Mailchimp Marketing API key, format `key-dc` (e.g. "abc123-us21"). */
  apiKey: string;
  /** Audience (list) ID. */
  audienceId: string;
  email: string;
  name?: string | null;
  /** Status for a NEW member. Default "subscribed" (immediate, no double opt-in). */
  status?: "subscribed" | "pending";
  /** Tags to apply (see mailchimpTagsFor). Blank entries are dropped. */
  tags?: string[];
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
  const tags = (input.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tags.length > 0) body.tags = tags;
  const auth = Buffer.from(`anystring:${input.apiKey}`).toString("base64");
  const headers = { "content-type": "application/json", authorization: `Basic ${auth}` };
  try {
    const res = await doFetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[mailchimp] add member → ${res.status} (audience ${input.audienceId})`);
      return { ok: false, status: res.status };
    }
    if (tags.length === 0) return { ok: true, status: res.status };
    // The `tags` in the PUT body above only take effect when the member is CREATED —
    // Mailchimp silently ignores them for an already-existing member, which is exactly
    // the repeat-signup case. The dedicated endpoint is what makes tagging reliable, so
    // both are sent: the body covers a brand-new member if this second call is lost,
    // and this call covers everyone else. Additive and idempotent (re-applying an
    // active tag is a no-op), and NEVER fatal — the member is already in the audience,
    // so a tag failure is reported (tagged:false) rather than failing the add.
    let tagged = false;
    try {
      const tagRes = await doFetch(`${url}/tags`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tags: tags.map((name) => ({ name, status: "active" })) }),
      });
      tagged = tagRes.ok;
      if (!tagRes.ok) {
        console.error(`[mailchimp] tag member → ${tagRes.status} (audience ${input.audienceId})`);
      }
    } catch (err) {
      console.error(`[mailchimp] tag member failed: ${String(err)}`);
    }
    return { ok: true, status: res.status, tagged };
  } catch (err) {
    console.error(`[mailchimp] add member failed: ${String(err)}`);
    return { ok: false, status: 0 };
  }
}
