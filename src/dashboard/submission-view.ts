import type { SubmissionRow } from "../reports/submission-row.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

/** Render a submission's `extraFields` JSON as a key/value list; on parse failure
 *  show the raw string (escaped) rather than dropping it. Returns "" when blank. */
function extraFieldsList(raw: string | null): string {
  if (!raw || raw.trim() === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `<div class="subm-kv"><span class="k">Extra fields</span> <code>${escapeHtml(raw)}</code></div>`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `<div class="subm-kv"><span class="k">Extra fields</span> <code>${escapeHtml(raw)}</code></div>`;
  }
  const rows = Object.entries(parsed as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `<div class="subm-kv"><span class="k">${escapeHtml(k)}</span> ${escapeHtml(String(v))}</div>`,
    )
    .join("");
  return rows;
}

export function renderSubmissionRow(s: SubmissionRow): string {
  const when = s.submittedAt ? escapeHtml(relativeTimeFromNow(s.submittedAt)) : "—";
  const type = escapeHtml(s.formType);
  const who = escapeHtml(s.name || "(no name)");
  const email = escapeHtml(s.email || "");
  const status = escapeHtml(s.status);
  const id = escapeHtml(s.id);
  const url = `/api/submissions/${encodeURIComponent(s.id)}/status`;
  const btn = (label: string, action: string) =>
    `<button class="subm-status" data-id="${id}" data-status="${action}" data-url="${url}">${label}</button>`;

  // One detail row per present field; absent fields are omitted (no blank rows).
  const kv = (label: string, value: string | number | null) =>
    value === null || value === ""
      ? ""
      : `<div class="subm-kv"><span class="k">${label}</span> ${escapeHtml(String(value))}</div>`;
  const sourceLink = s.sourceUrl
    ? `<div class="subm-kv"><span class="k">Source</span> <a href="${escapeHtml(safeUrl(s.sourceUrl))}" rel="noopener noreferrer">${escapeHtml(s.sourceUrl)}</a></div>`
    : "";
  const messageBlock = s.message
    ? `<div class="subm-kv"><span class="k">Message</span></div><div class="subm-msg">${escapeHtml(s.message)}</div>`
    : "";
  const details = [
    kv("Phone", s.phone),
    messageBlock,
    sourceLink,
    kv("UTM", s.utm),
    extraFieldsList(s.extraFields),
    kv("Notify", s.notifyStatus),
    kv("Resend ID", s.resendMessageId),
    kv("Submission #", s.submissionId),
  ].join("");

  return `<li class="subm-item">
    <details>
      <summary class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span> <span class="muted">${when}</span></summary>
      <div class="subm-detail">${details}</div>
    </details>
    <div class="subm-actions">${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
  </li>`;
}

/** CSS rules for the submission list UI. Append to the page's <style> block. */
export const SUBMISSION_STYLES = `.subm-list { list-style: none; padding: 0; margin: 0; }
.subm-item { padding: 0.6rem 0; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { .subm-item { border-color: #2a2a2a; } }
.subm-head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.subm-msg { margin: 0.35rem 0; white-space: pre-wrap; }
.subm-detail { padding: 0.35rem 0 0.2rem; }
.subm-kv { font-size: 0.9rem; margin: 0.15rem 0; }
.subm-kv .k { color: #888; margin-right: 0.4rem; }
summary.subm-head { cursor: pointer; }
.subm-actions { display: flex; gap: 0.4rem; }
button.subm-status { font: inherit; padding: 0.25rem 0.7rem; border: 1px solid #888; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
button.subm-status:disabled { opacity: 0.6; cursor: default; }
.spam-screen .spam-kv { font-size: 0.95rem; margin: 0.2rem 0; }
.spam-screen .spam-kv .k { color: #888; display: inline-block; min-width: 11rem; }
.pill.subm-new { background: #e8f0fe; color: #1a56db; }
.pill.subm-read { background: #f0f0f0; color: #555; }
.pill.subm-archived { background: #eee; color: #888; }
.pill.subm-spam { background: #fdecea; color: #b00; }
.subm-viewall { font-size: 0.8rem; font-weight: normal; margin-left: 0.4rem; white-space: nowrap; }`;

/** Client-side JS for the submission status triage buttons. Insert bare (no <script> wrapper). */
export const SUBMISSION_STATUS_SCRIPT = `document.querySelectorAll("button.subm-status").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(b.dataset.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: b.dataset.status }),
          });
          b.textContent = res.ok ? "✓" : "Failed";
          if (!res.ok) b.disabled = false;
        } catch {
          b.textContent = "Failed";
          b.disabled = false;
        }
      });
    });`;
