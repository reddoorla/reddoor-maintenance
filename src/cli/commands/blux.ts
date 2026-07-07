import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { assembleIR } from "../../blux/assemble.js";
import { buildMigrationPlan } from "../../blux/emit/migration-plan.js";
import { emitThemeCss } from "../../blux/emit/theme.js";
import { buildReviewManifest } from "../../blux/emit/review.js";
import type { MigrationPlan } from "../../blux/emit/plan.js";

export type BluxCommandOptions = {
  /** Output directory for emit (default: <exportDir>/blux-out). */
  out?: string;
  /** Base URL of the converted site for the review manifest. */
  convertedBase?: string;
  /** Base URL of the original Blux site (default: https://<site.json domain>). */
  bluxBase?: string;
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
    const plan = buildMigrationPlan(ir);
    const manifest = buildReviewManifest(ir, {
      convertedBase: opts.convertedBase ?? "http://localhost:5173",
      bluxBase: opts.bluxBase ?? `https://${ir.meta.domain}`,
    });

    await mkdir(join(out, "customtypes"), { recursive: true });
    await writeFile(join(out, "ir.json"), JSON.stringify(ir, null, 2));
    await writeFile(join(out, "migration-plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(join(out, "theme.css"), emitThemeCss(ir.theme));
    await writeFile(join(out, "review-manifest.json"), JSON.stringify(manifest, null, 2));
    for (const ct of plan.customTypes) {
      await writeFile(join(out, "customtypes", `${ct.id}.json`), JSON.stringify(ct.json, null, 2));
    }

    const resolved = ir.assets.filter((a) => a.sourceUrl !== null).length;
    const diagnostics = [...ir.diagnostics, ...plan.diagnostics];
    const lines = [
      `site: ${ir.meta.name} (${ir.meta.domain})`,
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
    const progress: string[] = [];
    const pushed = await pushCustomTypes(plan.customTypes);
    await runMigration(plan, (line) => progress.push(line));
    return {
      output:
        `custom types pushed: ${pushed.join(", ") || "none"}\n` +
        `migrated ${plan.documents.length} documents + ${plan.assets.length} assets into ` +
        `${process.env.PRISMIC_REPOSITORY_NAME} (${progress.length} migration events)`,
      code: 0,
    };
  }

  return { output: `unknown blux action '${action}'. Use: emit, migrate.`, code: 1 };
}
