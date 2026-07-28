import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMigration } from "../../blux/emit/run-migration.js";
import type { AssetRef } from "../../webflow/crawl.js";
import { collectAssets, crawlSite, liveFetcher } from "../../webflow/crawl.js";
import { webflowToPlan } from "../../webflow/to-plan.js";
import { irToDocs } from "../../webflow/to-docs.js";
import type { WfDoc } from "../../webflow/to-docs.js";
import type { WebflowIR } from "../../webflow/types.js";

export type WebflowCommandOptions = {
  /** Output directory for capture (default: webflow-out) / docs (default: dirname of the ir.json). */
  out?: string;
};

/** `webflow <action> [target]` — capture: live-crawl a Webflow site (baseUrl)
 *  into <out>/ir.json, progress streamed to stderr (a ~80-fetch crawl with a
 *  per-fetch courtesy delay takes about a minute; silence reads as a hang).
 *  docs: convert a saved ir.json into docs.json (Prismic entity docs, Task 6's
 *  irToDocs) + assets.json (the dedupe'd content-image manifest) beside it, or
 *  in --out. migrate: read a capture dir's docs.json + assets.json, build a
 *  MigrationPlan (to-plan), and push it via the shared runMigration runner —
 *  LIVE Prismic I/O, needs PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (read
 *  by runMigration itself); output ends with the Missing-asset count (the live
 *  acceptance gate is `0 Missing asset`). */
export async function runWebflowCommand(
  action: string,
  target: string | undefined,
  opts: WebflowCommandOptions = {},
): Promise<{ output: string; code: number }> {
  if (action === "capture") {
    if (!target) return { output: "webflow capture needs a base url.", code: 1 };
    const base = target.replace(/\/$/, "");
    const out = opts.out ?? "webflow-out";
    await mkdir(out, { recursive: true });
    // Progress to stderr, mirroring runMigration(plan, log) in
    // src/blux/emit/run-migration.ts.
    const ir = await crawlSite(base, liveFetcher(base), undefined, (line) =>
      process.stderr.write(`${line}\n`),
    );
    const irPath = join(out, "ir.json");
    await writeFile(irPath, JSON.stringify(ir, null, 2));
    return {
      output:
        `captured ${ir.team.length} team / ${ir.services.length} services / ` +
        `${ir.questions.length} questions / ${ir.reviews.length} reviews → ${irPath}`,
      code: 0,
    };
  }

  if (action === "docs") {
    if (!target) return { output: "webflow docs needs an ir.json path.", code: 1 };
    let ir: WebflowIR;
    try {
      ir = JSON.parse(await readFile(target, "utf-8")) as WebflowIR;
    } catch (err) {
      return {
        output: `could not read ir.json at ${target}: ${(err as Error).message}`,
        code: 1,
      };
    }
    // Shape guard: a wrong-shape JSON (e.g. a migration plan, or docs.json
    // itself) would otherwise die in irToDocs/collectAssets with an
    // uncontextualized TypeError.
    if (
      !ir ||
      !Array.isArray(ir.team) ||
      !Array.isArray(ir.services) ||
      !Array.isArray(ir.questions)
    ) {
      return { output: `not a webflow IR file: ${target}`, code: 1 };
    }
    const out = opts.out ?? dirname(target);
    await mkdir(out, { recursive: true });
    const docs = irToDocs(ir);
    const assets = collectAssets(ir);
    await writeFile(join(out, "docs.json"), JSON.stringify(docs, null, 2));
    await writeFile(join(out, "assets.json"), JSON.stringify(assets, null, 2));
    return { output: `${docs.length} docs, ${assets.length} assets → ${out}`, code: 0 };
  }

  if (action === "migrate") {
    if (!target) return { output: "webflow migrate needs a capture dir.", code: 1 };
    let docs: WfDoc[];
    let assets: AssetRef[];
    try {
      docs = JSON.parse(await readFile(join(target, "docs.json"), "utf-8")) as WfDoc[];
    } catch (err) {
      return {
        output: `could not read docs.json in ${target}: ${(err as Error).message}`,
        code: 1,
      };
    }
    try {
      assets = JSON.parse(await readFile(join(target, "assets.json"), "utf-8")) as AssetRef[];
    } catch (err) {
      return {
        output: `could not read assets.json in ${target}: ${(err as Error).message}`,
        code: 1,
      };
    }
    // Shape guard, mirroring the docs action: a wrong-shape JSON would otherwise
    // die deep inside webflowToPlan/runMigration with an uncontextualized error.
    if (!Array.isArray(docs) || !Array.isArray(assets)) {
      return { output: `not a webflow capture dir (docs.json / assets.json): ${target}`, code: 1 };
    }
    // runMigration reads PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN itself and
    // throws a clear "Set …" error before any I/O when they're unset; runOrExit
    // surfaces that message. Progress to stderr, mirroring the capture action.
    const plan = webflowToPlan({ docs, assets });
    const r = await runMigration(plan, (line) => process.stderr.write(`${line}\n`));
    // Keep the exact `0 Missing asset` string for the zero case — it's the
    // documented acceptance-gate grep; the nonzero case names the culprits.
    const miss =
      r.missingAssets.length === 0
        ? "0 Missing asset"
        : `${r.missingAssets.length} Missing asset: ${r.missingAssets.join(", ")}`;
    return {
      output:
        `${r.docsCreated} created, ${r.docsUpdated} updated, ` +
        `${r.assetsUploaded} assets uploaded, ${r.assetsReused} reused, ${miss}`,
      code: r.missingAssets.length === 0 ? 0 : 1,
    };
  }

  return { output: `unknown webflow action '${action}'. Use: capture, docs, migrate.`, code: 1 };
}
