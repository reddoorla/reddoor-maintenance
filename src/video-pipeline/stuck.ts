import type { FoundVideo } from "./classify.js";
import { isPrismicFileUrl, relayRefusal, videoKey } from "./key.js";
import { needsEncode } from "./manifest.js";
import type { Renditions } from "./manifest.js";

export const STUCK_LABEL = "video-pipeline";
export const STUCK_TITLE = "Videos stuck on Prismic: the R2 video pipeline has not encoded them";
export const STUCK_AFTER_MS = 60 * 60 * 1000;
export type StuckVideo = FoundVideo & { ageMs: number | null };

/** A video is stuck when needsEncode(video, resolved) (nothing on R2, or a background on R2 for a player request) and (publishedAt is null/unparsable, or now - publishedAt > thresholdMs). */
export function findStuck(
  found: FoundVideo[],
  resolved: Map<string, Renditions>,
  now: Date,
  thresholdMs = STUCK_AFTER_MS,
): StuckVideo[] {
  const stuck: StuckVideo[] = [];
  for (const video of found) {
    const r = resolved.get(video.url);
    if (r !== undefined && !needsEncode(video, r)) continue;
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

/**
 * Why the relay cannot re-run this video, or null when it can: not a Prismic file URL, no video key for the
 * site, or a URL the relay refuses (its safe-URL rule, the same check the relay runs).
 */
export function cannotEncodeReason(url: string, site: string): string | null {
  if (!isPrismicFileUrl(url)) return "not a Prismic file URL";
  if (videoKey(site, url) === null) return "no video key for this site";
  return relayRefusal(url);
}

/** The issue body. Re-runnable videos come first, under the re-run advice; the rest say why and that the Prismic field needs fixing. */
export function stuckIssueBody(stuck: StuckVideo[], now: Date, site: string): string {
  const rerun: string[] = [];
  const cannot: string[] = [];
  for (const v of stuck) {
    const age = v.ageMs === null ? "unknown" : `${Math.round(v.ageMs / 60000)} min`;
    const where = `document ${v.documentId}, slice ${v.sliceType}, field ${v.field}, published ${age} ago`;
    const reason = cannotEncodeReason(v.url, site);
    if (reason === null) {
      rerun.push(`- ${v.url} (${where}) class=${v.class} key=${videoKey(site, v.url)}`);
    } else {
      cannot.push(`- ${v.url} (${where}): ${reason}`);
    }
  }
  const lines = [
    `As of ${now.toISOString()}, ${stuck.length} video(s) are still on Prismic and not encoded to R2:`,
  ];
  if (rerun.length > 0) {
    lines.push(
      "",
      "Re-runnable by the relay:",
      ...rerun,
      "",
      "- Re-run the `video-encode` workflow with workflow_dispatch for each url above, with its class and key as the inputs.",
      "- If the re-run prints SKIP, R2 already has the manifest: check that the media base serves `<key>/manifest.json` (custom domain, public access), or re-run with force.",
    );
  }
  if (cannot.length > 0) {
    lines.push(
      "",
      "Cannot be encoded by the relay. Fix the Prismic field, then republish:",
      ...cannot,
    );
  }
  lines.push(
    "",
    "What to do:",
    "- Check the Prismic webhook is enabled: Prismic disables it after 5 failures.",
    "- Check the Action's secrets exist (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and CF_AI_TOKEN for player videos).",
    "",
    `Filed by \`reddoor-maint video-pipeline stuck --open-issue\`, label \`${STUCK_LABEL}\`.`,
  );
  return lines.join("\n");
}
