import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, ACTIVE_STATUSES } from "../../reports/airtable/websites.js";
import type { WebsiteRow } from "../../reports/airtable/websites.js";
import { uploadAttachment } from "../../reports/airtable/attachments.js";
import { generateHeaderImage } from "../../reports/header-image/index.js";

export type HeaderImageOptions = {
  all?: boolean;
  force?: boolean;
  writeAirtable?: boolean;
  outDir?: string;
  settleMs?: string;
};

/** Which rows this invocation should act on. Pure, so it is unit-tested. */
export function resolveTargets(
  rows: readonly WebsiteRow[],
  // `| undefined` spelled out because `exactOptionalPropertyTypes` otherwise
  // rejects the caller passing through possibly-undefined CLI flags.
  opts: { site?: string | undefined; all?: boolean | undefined; force?: boolean | undefined },
): WebsiteRow[] {
  if (opts.site) {
    const want = siteSlug(opts.site);
    return rows.filter((r) => siteSlug(r.name) === want);
  }
  if (!opts.all) return [];
  return rows.filter((r) => {
    if (!r.url) return false;
    if (r.status === null || !ACTIVE_STATUSES.has(r.status)) return false;
    return opts.force ? true : !r.headerImage;
  });
}

/** Parse the `--settle-ms <ms>` flag. Unset → undefined (the generator's own
 *  default settle). `Number("abc")` is NaN, which would sail through as a NaN
 *  timeout and silently skip the settle entirely, so anything non-finite or
 *  negative is rejected up front rather than producing a subtly-wrong capture. */
export function parseSettleMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw Object.assign(
      new Error(`--settle-ms must be a non-negative number of milliseconds, got "${value}"`),
      { exitCode: 2 },
    );
  }
  return n;
}

/** Injected in tests so the file-writing branch can be exercised without
 *  driving a real browser (mirrors `GenerateInput.shooter`). */
type Generate = typeof generateHeaderImage;

/**
 * Generate a header image per target row and either upload it to Airtable or
 * write it locally for review. Split out of {@link runHeaderImageCommand} so
 * the local-output path is testable without an Airtable base.
 */
export async function generateForTargets(
  targets: readonly WebsiteRow[],
  opts: HeaderImageOptions,
  generate: Generate = generateHeaderImage,
): Promise<{ output: string; code: number }> {
  const outDir = resolve(opts.outDir ?? "reports");
  const settleMs = parseSettleMs(opts.settleMs);
  // `reports/` does not exist on a fresh checkout, so the writeFile() below
  // would throw ENOENT for the first operator to run the default (local) path.
  // Create it once, before the loop, rather than per site.
  if (!opts.writeAirtable) await mkdir(outDir, { recursive: true });

  const lines: string[] = [];
  let failed = 0;

  for (const row of targets) {
    try {
      const gen = await generate({
        url: row.url,
        slug: siteSlug(row.name),
        // `exactOptionalPropertyTypes` rejects an explicit `settleMs: undefined`
        // against `settleMs?: number`, so omit the key entirely when unset.
        ...(settleMs === undefined ? {} : { settleMs }),
      });
      if (opts.writeAirtable) {
        await uploadAttachment(row.id, "Header image", gen.bytes, gen.filename, gen.contentType);
        lines.push(
          `✔ ${row.name} — uploaded ${gen.filename} (${(gen.bytes.byteLength / 1024 / 1024).toFixed(2)} MB)`,
        );
      } else {
        const path = resolve(outDir, gen.filename);
        await writeFile(path, gen.bytes);
        lines.push(`✔ ${row.name} — wrote ${path} (review, then re-run with --write-airtable)`);
      }
    } catch (err) {
      failed++;
      lines.push(`✖ ${row.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  lines.push(`${targets.length - failed}/${targets.length} generated.`);
  return { output: lines.join("\n"), code: failed > 0 ? 1 : 0 };
}

/**
 * `header-image [site]` — capture a site's live homepage and composite its
 * report header image. Defaults to writing the JPEG locally so the operator can
 * eyeball it; `--write-airtable` uploads it to the Websites row's Header image
 * field. `--all` backfills every live site that has no header image yet.
 */
export async function runHeaderImageCommand(
  site: string | undefined,
  opts: HeaderImageOptions,
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const rows = await listWebsites(base);
  const targets = resolveTargets(rows, { site, all: opts.all, force: opts.force });
  if (targets.length === 0) {
    return {
      output: site ? `No site matched "${site}".` : "No sites need a header image.",
      code: 1,
    };
  }
  return generateForTargets(targets, opts);
}
