import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { glob } from "tinyglobby";
import { assembleIR } from "../../blux/assemble.js";
import { buildMigrationPlan } from "../../blux/emit/migration-plan.js";
import { emitThemeCss, emitRolesCss } from "../../blux/emit/theme.js";
import { buildReviewManifest } from "../../blux/emit/review.js";
import { validateCoverage } from "../../blux/validate.js";
import {
  parseGridBands,
  extractMapConfig,
  classifyBands,
  makeIsMapMount,
} from "../../blux/grid/index.js";
import type { MapConfig } from "../../blux/grid/index.js";
import { buildGridPlan, mediaCdnUrl } from "../../blux/emit/grid-plan.js";
import {
  buildPresentation,
  type PresentationDeps,
  type RenderMedia,
  type MapRenderConfig,
  type Presentation,
} from "../../blux/emit/presentation.js";
import { rewriteManifestUrls } from "../../blux/emit/rewrite-manifest.js";
import { blockStylesByIndex } from "../../blux/emit/block-styles.js";
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
  /** validate: the converted site's rendered HTML — a file path or http(s) URL. */
  against?: string;
  /** Test seam for --probe; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  cwd?: string;
  verbose?: boolean;
};

/** `blux <action> [dir]` — emit: Blux export dir → migration plan + custom-type
 *  schemas + theme CSS + review manifest, all deterministic and offline.
 *  migrate: a previously emitted plan → live Prismic (creds-gated; the runner
 *  is imported lazily so emit runs never touch @prismicio).
 *  validate: content coverage of a converted site's render (--against a file or
 *  URL) against the export's index.html answer key — names any text the
 *  transform dropped, no tokens spent eyeballing.
 *  grid: parse rendered index.html → grid-tree.json (layout tree).
 *  convert: parse+classify index.html + assemble IR from site.json → the grid
 *  migration-plan.json (page doc) + blux-presentation.json (render manifest) +
 *  theme.css (+ map-config.json when a map is present), all offline, no creds. */
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
    const rolesCss = emitRolesCss(ir.theme);
    await writeFile(
      join(out, "theme.css"),
      emitThemeCss(ir.theme) + (rolesCss ? "\n" + rolesCss : ""),
    );
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
    // Rewrite the render manifest's media urls from the CDN url the export
    // carries → the durable Prismic url we just uploaded to. Skipped silently
    // when no manifest sits beside the plan (e.g. an archetype-only emit).
    let manifestNote = "";
    const manifestPath = join(dirname(planPath), "blux-presentation.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as Presentation;
      const rewritten = rewriteManifestUrls(manifest, r.assetUrlByCdn);
      await writeFile(manifestPath, JSON.stringify(rewritten, null, 2) + "\n");
      manifestNote = "\nmanifest media rewritten to Prismic urls";
    } catch {
      /* no manifest beside the plan (e.g. archetype emit) — skip silently */
    }
    return {
      output:
        `custom types pushed: ${pushed.join(", ") || "none"}\n` +
        `assets: ${r.assetsUploaded} uploaded, ${r.assetsReused} reused | ` +
        `documents: ${r.docsCreated} created, ${r.docsUpdated} updated → ` +
        `${process.env.PRISMIC_REPOSITORY_NAME} (publish the migration release in the dashboard)` +
        missing +
        manifestNote,
      code: 0,
    };
  }

  if (action === "validate") {
    if (!dir) return { output: "blux validate needs a Blux export directory.", code: 1 };
    if (!opts.against) {
      return {
        output: "blux validate needs --against <rendered html file or url>.",
        code: 1,
      };
    }
    let exportHtml: string;
    try {
      exportHtml = await readFile(join(dir, "index.html"), "utf-8");
    } catch (err) {
      return {
        output: `could not read index.html in ${dir}: ${(err as Error).message}`,
        code: 1,
      };
    }
    let rendered: string;
    try {
      if (/^https?:\/\//.test(opts.against)) {
        const res = await (opts.fetchImpl ?? fetch)(opts.against);
        // fetch resolves on 4xx/5xx; without this an error page would be
        // coverage-checked as if it were the render (a bogus 1% "gap" alarm)
        if (!res.ok) {
          return {
            output: `could not fetch --against ${opts.against}: HTTP ${res.status}`,
            code: 1,
          };
        }
        rendered = await res.text();
      } else {
        rendered = await readFile(opts.against, "utf-8");
      }
    } catch (err) {
      return {
        output: `could not read --against ${opts.against}: ${(err as Error).message}`,
        code: 1,
      };
    }

    const report = validateCoverage(exportHtml, rendered);
    const lines = [
      `content coverage: ${report.covered}/${report.total} runs (${report.coveragePct}%)`,
      ...(report.missing.length
        ? [
            "missing runs — export text absent from the render:",
            ...report.missing.map((m) => `  - ${m}`),
          ]
        : ["all export text runs present in the render"]),
    ];
    return { output: lines.join("\n"), code: 0 };
  }

  if (action === "grid") {
    if (!dir) return { output: "blux grid needs a Blux export directory.", code: 1 };
    let html: string;
    try {
      html = await readFile(join(dir, "index.html"), "utf-8");
    } catch (err) {
      return {
        output: `could not read index.html in ${dir}: ${(err as Error).message}`,
        code: 1,
      };
    }
    const bands = parseGridBands(html);
    const outDir = opts.out ?? join(dir, "blux-out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "grid-tree.json"), JSON.stringify(bands, null, 2));
    const mapConfig = extractMapConfig(html);
    if (mapConfig) {
      await writeFile(
        join(outDir, "map-config.json"),
        JSON.stringify(mapConfig, null, 2) + "\n",
        "utf-8",
      );
    }
    return {
      output:
        `Parsed ${bands.length} bands → ${join(outDir, "grid-tree.json")}` +
        (mapConfig ? ", map config extracted" : ""),
      code: 0,
    };
  }

  if (action === "convert") {
    if (!dir) return { output: "blux convert needs a Blux export directory.", code: 1 };
    let html: string;
    let siteJson: unknown;
    try {
      html = await readFile(join(dir, "index.html"), "utf-8");
      siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
    } catch (err) {
      return { output: `could not read export in ${dir}: ${(err as Error).message}`, code: 1 };
    }
    const bands = parseGridBands(html);
    const mapConfig = extractMapConfig(html);
    const specs = classifyBands(bands, mapConfig ? { isMapMount: makeIsMapMount(mapConfig) } : {});
    const ir = assembleIR({ siteJson, htmls: [html] });

    const assetsById = new Map(ir.assets.map((a) => [a.id, a] as const));
    const styles = blockStylesByIndex(siteJson);
    const deps: PresentationDeps = {
      resolveMedia: (m) => {
        const url = mediaCdnUrl(m) ?? assetsById.get(m.assetId)?.sourceUrl ?? null;
        if (!url) return null;
        const alt = assetsById.get(m.assetId)?.alt;
        const rm: RenderMedia = { kind: m.kind, url, ...(alt ? { alt } : {}) };
        return rm;
      },
      styleFor: (i) => styles.get(i),
      map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
    };

    const plan = buildGridPlan(specs, ir);
    const presentation = buildPresentation(specs, deps);

    const outDir = opts.out ?? join(dir, "blux-out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "migration-plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(
      join(outDir, "blux-presentation.json"),
      JSON.stringify(presentation, null, 2) + "\n",
    );
    await writeFile(join(outDir, "theme.css"), emitThemeCss(ir.theme) + "\n" + emitRolesCss(ir.theme));
    if (mapConfig) {
      await writeFile(join(outDir, "map-config.json"), JSON.stringify(mapConfig, null, 2) + "\n");
    }
    const sliceCount = (plan.documents[0]?.data.slices as unknown[] | undefined)?.length ?? 0;
    return {
      output:
        `Converted ${bands.length} bands → ${outDir} ` +
        `(${Object.keys(presentation.bands).length} manifest bands, ${sliceCount} slices` +
        (mapConfig ? ", map config extracted" : "") +
        ")",
      code: 0,
    };
  }

  return {
    output: `unknown blux action '${action}'. Use: emit, migrate, validate, grid, convert.`,
    code: 1,
  };
}

/** Drop the source-only `mountId` from an extracted MapConfig → the render-side
 * MapRenderConfig the presentation manifest carries. */
function mapRenderFromConfig(c: MapConfig): MapRenderConfig {
  return {
    mid: c.mid,
    layers: c.layers,
    toggles: c.toggles,
    styles: c.styles,
    ...(c.center ? { center: c.center } : {}),
    ...(c.zoom !== undefined ? { zoom: c.zoom } : {}),
  };
}
