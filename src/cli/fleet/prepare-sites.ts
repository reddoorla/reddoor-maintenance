import type { Site } from "../../types.js";
import { cloneIfNeeded } from "./clone-if-needed.js";

/** A fleet site that couldn't be prepared for a command, with the reason. */
export type SkippedSite = { site: string; reason: string };
export type FleetPrepResult = { prepared: Site[]; skipped: SkippedSite[] };

type CloneFn = (site: Site, opts: { workdir: string }) => Promise<Site>;

/**
 * Prepare every fleet site for a command, tolerating per-site failures.
 *
 * A site is cloned into `workdir` unless `needsCheckout` says otherwise (the
 * default is "always clone" — recipe commands operate on a local checkout; the
 * audit command overrides this so a deployed-URL site skips the clone). The
 * critical property is ISOLATION: a per-site prep failure (no clone source,
 * clone error, the wrong-repo guard) is CAUGHT and recorded in `skipped` rather
 * than thrown. A single malformed inventory row can therefore never abort the
 * whole fleet run — a bare `Promise.all(map(cloneIfNeeded))` used to (one site
 * with no repo threw and rejected prep for EVERY site, so nothing ran). Each
 * site is prepared independently (parallel) so one slow/failed clone can't
 * serialize or sink the rest.
 *
 * The skipped-site label prefers `site.name` but uses a truthiness check (not
 * `??`) so an empty-string name (an Airtable row whose slug came out empty)
 * still falls back to the path instead of rendering blank.
 */
export async function prepareFleetSites(
  sites: Site[],
  opts: { workdir: string; needsCheckout?: (site: Site) => boolean; clone?: CloneFn },
): Promise<FleetPrepResult> {
  const clone = opts.clone ?? cloneIfNeeded;
  const needsCheckout = opts.needsCheckout ?? (() => true);
  const settled = await Promise.all(
    sites.map(async (site): Promise<{ ok: true; site: Site } | ({ ok: false } & SkippedSite)> => {
      if (!needsCheckout(site)) return { ok: true, site };
      try {
        return { ok: true, site: await clone(site, { workdir: opts.workdir }) };
      } catch (e) {
        return { ok: false, site: site.name || site.path, reason: (e as Error).message };
      }
    }),
  );
  const prepared: Site[] = [];
  const skipped: SkippedSite[] = [];
  for (const r of settled) {
    if (r.ok) prepared.push(r.site);
    else skipped.push({ site: r.site, reason: r.reason });
  }
  return { prepared, skipped };
}

/** One-line operator notice for sites dropped during fleet prep; null when none
 *  were skipped. The leading "⚠ … site(s) skipped (could not prepare)" token is
 *  what the nightly fleet-lighthouse workflow greps to raise a `::warning::`, so
 *  a tolerated skip stays visible in the Actions UI rather than buried. */
export function formatSkippedNotice(skipped: SkippedSite[]): string | null {
  if (skipped.length === 0) return null;
  const detail = skipped.map((s) => `${s.site} (${s.reason})`).join("; ");
  return `⚠ ${skipped.length} site(s) skipped (could not prepare): ${detail}`;
}

/** Append the skip notice to a command's output on a blank line, or return the
 *  output unchanged when nothing was skipped. Keeps every fleet command's
 *  return paths uniform. */
export function appendSkipNotice(output: string, skipped: SkippedSite[]): string {
  const notice = formatSkippedNotice(skipped);
  return notice ? `${output}\n\n${notice}` : output;
}
