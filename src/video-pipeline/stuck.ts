import type { FoundVideo } from "./classify.js";
import type { Renditions } from "./manifest.js";

export const STUCK_LABEL = "video-pipeline";
export const STUCK_TITLE = "Videos stuck on Prismic: the R2 video pipeline has not encoded them";
export const STUCK_AFTER_MS = 60 * 60 * 1000;
export type StuckVideo = FoundVideo & { ageMs: number | null };

/** A video is stuck when resolved.onR2 is false and (publishedAt is null/unparsable, or now - publishedAt > thresholdMs). */
export function findStuck(
  found: FoundVideo[],
  resolved: Map<string, Renditions>,
  now: Date,
  thresholdMs = STUCK_AFTER_MS,
): StuckVideo[] {
  const stuck: StuckVideo[] = [];
  for (const video of found) {
    if (resolved.get(video.url)?.onR2) continue;
    const published = video.publishedAt === null ? NaN : Date.parse(video.publishedAt);
    if (Number.isNaN(published)) {
      stuck.push({ ...video, ageMs: null });
      continue;
    }
    const ageMs = now.getTime() - published;
    if (ageMs > thresholdMs) stuck.push({ ...video, ageMs });
  }
  return stuck;
}

export function stuckIssueBody(stuck: StuckVideo[], now: Date): string {
  const lines = stuck.map((v) => {
    const age = v.ageMs === null ? "unknown" : `${Math.round(v.ageMs / 60000)} min`;
    return `- ${v.url} (class ${v.class}, document ${v.documentId}, slice ${v.sliceType}, field ${v.field}, published ${age} ago)`;
  });
  return [
    `As of ${now.toISOString()}, ${stuck.length} video(s) are still on Prismic and not encoded to R2:`,
    "",
    ...lines,
    "",
    "What to do:",
    "- Re-run the `video-encode` workflow with workflow_dispatch for each url above.",
    "- Check the Prismic webhook is enabled: Prismic disables it after 5 failures.",
    "- Check the Action's secrets exist (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and CF_AI_TOKEN for player videos).",
    "",
    `Filed by \`reddoor-maint video-pipeline stuck --open-issue\`, label \`${STUCK_LABEL}\`.`,
  ].join("\n");
}
