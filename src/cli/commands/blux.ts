import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { assembleIR } from "../../blux/assemble.js";
import { buildMigrationPlan } from "../../blux/emit/migration-plan.js";
import { emitThemeCss, emitRolesCss } from "../../blux/emit/theme.js";
import { buildReviewManifest } from "../../blux/emit/review.js";
import type { MigrationPlan } from "../../blux/emit/plan.js";

export type BluxCommandOptions = {
  /** Output directory for emit (default: <exportDir>/blux-out). */
  out?: string;
  /** Base URL of the converted site for the review manifest. */
  convertedBase?: string;
  /** Base URL of the original Blux site (default: https://<site.json domain>). */
  bluxBase?: string;
  /** Reconstruct + HEAD-probe CDN URLs for used assets the HTML scrape missed (network). */
  probe?: boolean;
  /** Test seam for --probe; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  cwd?: string;
  verbose?: boolean;
};

/** `blux <action> [dir]` — emit: Blux export dir → migration plan + custom-type
 *  schemas + theme CSS + review manifest, all deterministic and offline.
 *  migrate: a previously emitted plan → live Prismic (creds-gated; the runner
 *  is imported lazily so emit runs never touch @prismicio). */
export async function runBluxCommand(
  action: string,
  dir: string | undefined,
  opts: BluxCommandOptions,
): Promise<{ output: string; code: number }> {
  if (action === "emit") {
    if (!dir) return { output: "blux emit needs a Blux export directory.", code: 1 };
    let siteJson: unknown;
    try {
      siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
    } catch (err) {
      return {
        output: `could not read site.json in ${dir}: ${(err as Error).message}`,
        code: 1,
      };
    }
    const out = opts.out ?? join(dir, "blux-out");
    const htmlPaths = (
      await glob(["**/*.html"], { cwd: dir, absolute: true, ignore: ["blux-out/**"] })
    ).sort();
    const htmls = await Promise.all(htmlPaths.map((p) => readFile(p, "utf-8")));

    const ir = assembleIR({ siteJson, htmls });

    let probeLine = "";
    if (opts.probe) {
      const { probeAssetUrls } = await import("../../blux/emit/probe.js");
      // derive "used" from the plan's own __asset_id markers — the single
      // source of truth for which assets documents actually reference
      const used = new Set<string>();
      const collect = (v: unknown): void => {
        if (!v || typeof v !== "object") return;
        if ("__asset_id" in v) used.add((v as { __asset_id: string }).__asset_id);
        else if (Array.isArray(v)) v.forEach(collect);
        else Object.values(v).forEach(collect);
      };
      buildMigrationPlan(ir).documents.forEach((d) => collect(d.data));

      const targets = ir.assets.filter((a) => used.has(a.id) && !a.sourceUrl);
      const probed = await probeAssetUrls(targets, ir.meta.bluxSiteId, opts.fetchImpl ?? fetch);
      let hits = 0;
      for (const a of ir.assets) {
        const url = probed.get(a.id);
        if (url) {
          a.sourceUrl = url;
          hits++;
        }
      }
      ir.diagnostics = ir.diagnostics.filter(
        (d) => !(d.kind === "unresolved-asset" && probed.get(d.where)),
      );
      probeLine = `probe resolved ${hits}/${targets.length} used assets`;
    }

    const plan = buildMigrationPlan(ir);
    const manifest = buildReviewManifest(ir, {
      convertedBase: opts.convertedBase ?? "http://localhost:5173",
      bluxBase: opts.bluxBase ?? `https://${ir.meta.domain}`,
    });

    await mkdir(join(out, "customtypes"), { recursive: true });
    await writeFile(join(out, "ir.json"), JSON.stringify(ir, null, 2));
    await writeFile(join(out, "migration-plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(join(out, "theme.css"), emitThemeCss(ir.theme) + "\n" + emitRolesCss(ir.theme));
    await writeFile(join(out, "review-manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(
      join(out, "styles-manifest.json"),
      JSON.stringify(plan.stylesManifest, null, 2),
    );
    for (const ct of plan.customTypes) {
      await writeFile(join(out, "customtypes", `${ct.id}.json`), JSON.stringify(ct.json, null, 2));
    }

    const resolved = ir.assets.filter((a) => a.sourceUrl !== null).length;
    const diagnostics = [...ir.diagnostics, ...plan.diagnostics];
    const lines = [
      `site: ${ir.meta.name} (${ir.meta.domain})`,
      ...(probeLine ? [probeLine] : []),
      `pages: ${ir.pages.length} | custom types: ${plan.customTypes.length} | documents: ${plan.documents.length} | assets: ${resolved}/${ir.assets.length} resolved`,
      `diagnostics: ${diagnostics.length}`,
      ...diagnostics.map((d) => `  - [${d.kind}] ${d.where}: ${d.message}`),
      `wrote ${out}`,
    ];
    return { output: lines.join("\n"), code: 0 };
  }

  if (action === "migrate") {
    if (!dir) {
      return {
        output: "blux migrate needs an emitted output directory (or a plan .json path).",
        code: 1,
      };
    }
    if (!process.env.PRISMIC_REPOSITORY_NAME || !process.env.PRISMIC_WRITE_TOKEN) {
      return {
        output: "Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN to run a live migration.",
        code: 1,
      };
    }
    const planPath = dir.endsWith(".json") ? dir : join(dir, "migration-plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf-8")) as MigrationPlan;
    const { pushCustomTypes, runMigration } = await import("../../blux/emit/run-migration.js");
    const pushed = await pushCustomTypes(plan.customTypes);
    // stream progress to stderr — a throttled run over many assets/docs takes
    // minutes and silence reads as a hang; stdout stays the result summary
    const r = await runMigration(plan, (line) => process.stderr.write(`${line}\n`));
    const missing = r.missingAssets.length
      ? `\nWARNING missing assets: ${r.missingAssets.join(", ")}`
      : "";
    return {
      output:
        `custom types pushed: ${pushed.join(", ") || "none"}\n` +
        `assets: ${r.assetsUploaded} uploaded, ${r.assetsReused} reused | ` +
        `documents: ${r.docsCreated} created, ${r.docsUpdated} updated → ` +
        `${process.env.PRISMIC_REPOSITORY_NAME} (publish the migration release in the dashboard)` +
        missing,
      code: 0,
    };
  }

  return { output: `unknown blux action '${action}'. Use: emit, migrate.`, code: 1 };
}
