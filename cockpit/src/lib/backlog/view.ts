import type { BacklogPanel } from "../../../../src/dashboard/backlog-source.js";
import type { BacklogRef } from "../../../../src/dashboard/backlog.js";
import { WORKSPACE_REPO, BACKLOG_PATH } from "../../../../src/dashboard/backlog.js";
import { agoInWords, pacificStamp } from "../overview/view.js";

/** The Triage page's backlog section (P1-111), every string decided here. */
export type BacklogItemView = {
  rank: number;
  id: string;
  title: string;
  tier: string | null;
  status: { when: string; sentence: string; refs: BacklogRef[] } | null;
};

export type BacklogView =
  | { kind: "ok"; meta: string; fileHref: string; items: BacklogItemView[] }
  | { kind: "unavailable"; reason: string; fileHref: string };

export const BACKLOG_FILE_HREF = `https://github.com/${WORKSPACE_REPO}/blob/main/${BACKLOG_PATH}`;

/** "2026-11-11" → "Nov 11", the date as written (a calendar day, no time zone). */
function writtenDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

export function buildBacklogView(panel: BacklogPanel, now: Date): BacklogView {
  if (panel.kind === "unavailable") {
    return { kind: "unavailable", reason: panel.reason, fileHref: BACKLOG_FILE_HREF };
  }
  const parts: string[] = [];
  if (panel.rerankedAt) parts.push(`Ranked ${pacificStamp(panel.rerankedAt)}`);
  else parts.push("Re-rank time not written");
  if (panel.writtenAt) {
    const ago = agoInWords(panel.writtenAt, now);
    parts.push(`file last written ${pacificStamp(panel.writtenAt)}${ago ? ` (${ago})` : ""}`);
  }
  return {
    kind: "ok",
    meta: parts.join(" · "),
    fileHref: BACKLOG_FILE_HREF,
    items: panel.items.map((it) => ({
      rank: it.rank,
      id: it.id,
      title: it.title,
      tier: it.tier,
      status: it.status
        ? { when: writtenDay(it.status.date), sentence: it.status.sentence, refs: it.status.refs }
        : null,
    })),
  };
}
