import type { ProspectAuditListItem } from "../../../src/db/prospect-audits.js";

export const NOW = new Date("2026-08-25T12:10:00.000Z");

export function item(over: Partial<ProspectAuditListItem> = {}): ProspectAuditListItem {
  return {
    id: "pa_1",
    token: "A".repeat(22),
    url: "https://acme.example/",
    business: "Acme Roofing",
    status: "complete",
    created_at: "2026-08-25T12:00:00.000Z",
    edited_at: null,
    opened_at: null,
    chosen_terms: null,
    claimed_at: null,
    ...over,
  };
}

/** One audit of every state and edge the listing branches on. */
export const AUDITS: ProspectAuditListItem[] = [
  item({ id: "complete" }),
  item({ id: "partial", status: "partial", business: null }),
  item({ id: "running", status: "running", created_at: "2026-08-25T12:05:00.000Z" }),
  item({ id: "stale", status: "running", created_at: "2026-08-24T12:00:00.000Z" }),
  item({
    id: "stale-claimed",
    status: "running",
    created_at: "2026-08-24T12:00:00.000Z",
    claimed_at: "2026-08-25T12:08:00.000Z",
  }),
  item({ id: "failed", status: "failed" }),
  item({ id: "badtoken", token: "../../etc" }),
  item({ id: "badurl", url: "javascript:alert(1)" }),
  item({ id: "chosen", chosen_terms: '["a","b"]' }),
  item({ id: "edited", edited_at: "2026-08-25T11:00:00.000Z" }),
  item({ id: "opened", opened_at: "2026-08-25T11:30:00.000Z" }),
  item({
    id: "read-after",
    edited_at: "2026-08-25T10:00:00.000Z",
    opened_at: "2026-08-25T11:00:00.000Z",
  }),
  item({
    id: "edit-after",
    edited_at: "2026-08-25T11:00:00.000Z",
    opened_at: "2026-08-25T10:00:00.000Z",
  }),
  item({
    id: "hostile",
    business: `<script>alert("x")</script> & 'co'`,
    url: "https://x.example/?a=1&b=<2>",
  }),
  item({ id: "empty-business", business: "" }),
];
