import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { glob } from "tinyglobby";
import { assembleIR } from "../../blux/assemble.js";
import { buildMigrationPlan } from "../../blux/emit/migration-plan.js";
import { emitThemeCss, emitRolesCss, emitButtonsCss } from "../../blux/emit/theme.js";
import { buildReviewManifest } from "../../blux/emit/review.js";
import { validateCoverage } from "../../blux/validate.js";
import { parseGridBands, extractMapConfig, makeIsMapMount } from "../../blux/grid/index.js";
import { feedAssetBase, extFor } from "../../blux/grid/feed-grid.js";
import { materializeProducts, type ProductRecord } from "../../blux/products.js";
import { convertExport, convertSite, sitePages } from "../../blux/emit/convert.js";
import { bandOrCollection, buildCatalogPlan } from "../../blux/catalog/index.js";
import type { CatalogSpec } from "../../blux/catalog/index.js";
import { buildSiteConfig, socialHrefResolverFromHtml } from "../../blux/emit/site-config.js";
import { validateLayout, formatLayoutReport } from "../../blux/emit/validate-layout.js";
import { rewriteManifestUrls } from "../../blux/emit/rewrite-manifest.js";
import type { SitePresentation } from "../../blux/emit/presentation.js";
import type { MigrationPlan } from "../../blux/emit/plan.js";
import type { Diagnostic } from "../../blux/ir.js";

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
 *  validate: offline layout-fidelity gate (parse+classify index.html, diff the
 *  emitted manifest vs the source answer key) — exits non-zero on drift.
 *  --against <file|url> additionally runs content coverage of a rendered page.
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
    const buttonsCss = emitButtonsCss(ir.theme);
    await writeFile(
      join(out, "theme.css"),
      emitThemeCss(ir.theme) +
        (rolesCss ? "\n" + rolesCss : "") +
        (buttonsCss ? "\n" + buttonsCss : ""),
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
    let manifestRaw: string | null = null;
    try {
      manifestRaw = await readFile(manifestPath, "utf-8");
    } catch {
      /* no manifest beside the plan (e.g. archetype-only emit) — nothing to
         rewrite; not an error. A rewrite failure on a manifest that DOES
         exist must surface, not be swallowed (it silently strands the render
         on Blux CDN urls). */
    }
    if (manifestRaw !== null) {
      const manifest = JSON.parse(manifestRaw) as SitePresentation;
      const rewritten = rewriteManifestUrls(manifest, r.assetUrlByCdn);
      await writeFile(manifestPath, JSON.stringify(rewritten, null, 2) + "\n");
      manifestNote = "\nmanifest media rewritten to Prismic urls";
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
    let exportHtml: string;
    try {
      exportHtml = await readFile(join(dir, "index.html"), "utf-8");
    } catch (err) {
      return { output: `could not read index.html in ${dir}: ${(err as Error).message}`, code: 1 };
    }

    // Resolve the optional --against render FIRST so a bad target hard-fails
    // before we spend the convert pipeline (and so its error message wins).
    let rendered: string | null = null;
    if (opts.against) {
      try {
        if (/^https?:\/\//.test(opts.against)) {
          const res = await (opts.fetchImpl ?? fetch)(opts.against);
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
    }

    let siteJson: unknown;
    try {
      siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
    } catch (err) {
      return { output: `could not read site.json in ${dir}: ${(err as Error).message}`, code: 1 };
    }

    const { specs, presentation } = convertExport({ html: exportHtml, siteJson });
    const layout = validateLayout(specs, presentation);
    const lines = [formatLayoutReport(layout)];

    // Content coverage is informational only — it names export text the render
    // dropped, but layout fidelity alone gates the exit code below. A coverage
    // gap never flips a faithful layout to a non-zero exit.
    if (rendered !== null) {
      const report = validateCoverage(exportHtml, rendered);
      lines.push(
        "",
        `content coverage: ${report.covered}/${report.total} runs (${report.coveragePct}%)`,
        ...(report.missing.length
          ? [
              "missing runs — export text absent from the render:",
              ...report.missing.map((m) => `  - ${m}`),
            ]
          : ["all export text runs present in the render"]),
      );
    }

    return { output: lines.join("\n"), code: layout.faithful ? 0 : 1 };
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
    let siteJson: unknown;
    try {
      siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
    } catch (err) {
      return { output: `could not read export in ${dir}: ${(err as Error).message}`, code: 1 };
    }
    // Every site page renders to its own index.html: the homepage at the
    // export root, the rest at <path>/index.html. A page dir the export
    // doesn't contain (an unexported draft) is skipped — convertSite records
    // the missing-page-html diagnostic.
    const htmlByUid = new Map<string, string>();
    for (const p of sitePages(siteJson)) {
      const file = p.path ? join(dir, p.path, "index.html") : join(dir, "index.html");
      try {
        htmlByUid.set(p.uid, await readFile(file, "utf-8"));
      } catch {
        /* missing page dir — diagnosed by convertSite */
      }
    }
    if (!htmlByUid.size) {
      return { output: `could not read any page html in ${dir}`, code: 1 };
    }
    const { pages, ir, plan, presentation } = convertSite({ siteJson, htmlByUid });

    const outDir = opts.out ?? join(dir, "blux-out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "migration-plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(
      join(outDir, "blux-presentation.json"),
      JSON.stringify(presentation, null, 2) + "\n",
    );
    {
      const buttonsCss = emitButtonsCss(ir.theme);
      await writeFile(
        join(outDir, "theme.css"),
        emitThemeCss(ir.theme) +
          "\n" +
          emitRolesCss(ir.theme) +
          (buttonsCss ? "\n" + buttonsCss : ""),
      );
    }
    // Map configs are per page now (informational — the presentation manifest
    // co-locates each map on its band).
    const mapConfigs = Object.fromEntries(
      pages.filter((p) => p.mapConfig).map((p) => [p.uid, p.mapConfig]),
    );
    if (Object.keys(mapConfigs).length) {
      await writeFile(join(outDir, "map-config.json"), JSON.stringify(mapConfigs, null, 2) + "\n");
    }
    // Site chrome (nav dropdowns + footer socials/copyright) → site-config.json,
    // consumed by the render's Nav/Footer. The nav logo is chrome, not on any
    // page grid, so it isn't in the scraped urlMap — resolve it the scraped url
    // first, else reconstruct the CDN url (base + uuid + ext, like feed media).
    {
      const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
      const base = feedAssetBase([...htmlByUid.values()], ir.meta.bluxSiteId);
      const mediaDict = (siteJson as { media?: Record<string, { type?: string }> }).media ?? {};
      const extByMime: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/svg+xml": "svg",
        "image/gif": "gif",
        "image/webp": "webp",
      };
      const resolveLogo = (uuid: string): string | null => {
        const scraped = sourceUrlById.get(uuid);
        if (scraped) return scraped;
        const ext = extByMime[String(mediaDict[uuid]?.type ?? "")];
        return ext ? `${base}${uuid}.${ext}` : null;
      };
      // Footer social profile urls aren't in the export (Blux injects them at
      // render time), but they ride the scraped live footer — recover them by
      // host from the same page html the grid was built from.
      const resolveSocialHref = socialHrefResolverFromHtml([...htmlByUid.values()]);
      const siteConfig = buildSiteConfig(siteJson, resolveLogo, resolveSocialHref);
      await writeFile(join(outDir, "site-config.json"), JSON.stringify(siteConfig, null, 2) + "\n");
    }
    // Product catalog → products.json. A Blux "products" feed drives a detail
    // page per record (/products/<slug>) from a template the static export
    // drops; rebuild the catalog deterministically with cleaned categories +
    // resolved images. Image urls reconstruct like feed media (base + uuid +
    // ext) — the scraped url map only covers page assets, not feed records.
    {
      const feeds =
        (siteJson as { feeds?: Record<string, { publish?: unknown; items?: unknown }> }).feeds ??
        {};
      const productFeed = Object.values(feeds).find((f) => f?.publish === "products");
      if (productFeed && Array.isArray(productFeed.items)) {
        const base = feedAssetBase([...htmlByUid.values()], ir.meta.bluxSiteId);
        const mediaMeta =
          (siteJson as { media?: Record<string, { type?: string; name?: string }> }).media ?? {};
        const resolveImage = (uuid: string): string | null => {
          const ext = extFor(mediaMeta[uuid]?.type, mediaMeta[uuid]?.name);
          return ext ? `${base}${uuid}.${ext}` : null;
        };
        const products = materializeProducts(productFeed.items as ProductRecord[], resolveImage);
        await writeFile(join(outDir, "products.json"), JSON.stringify(products, null, 2) + "\n");
      }
    }
    // The favicon never rides the migration plan (plan assets get uploaded to
    // Prismic media — the wrong destination), so convert downloads it directly
    // beside the other outputs. This is convert's ONLY network touch and it
    // uses the same injectable fetch seam as --probe, so tests stay offline
    // and convertExport itself stays pure. A fetch failure never fails the
    // command — the {assetId, url} pair is preserved as favicon.json so the
    // download can be re-run by hand.
    let faviconLine = "";
    if (ir.meta.favicon?.sourceUrl) {
      const { assetId, sourceUrl } = ir.meta.favicon;
      try {
        const res = await (opts.fetchImpl ?? fetch)(sourceUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await writeFile(join(outDir, "favicon.png"), new Uint8Array(await res.arrayBuffer()));
        faviconLine = `\nfavicon → ${join(outDir, "favicon.png")}`;
      } catch (err) {
        await writeFile(
          join(outDir, "favicon.json"),
          JSON.stringify({ assetId, url: sourceUrl }, null, 2) + "\n",
        );
        faviconLine =
          `\nfavicon fetch failed (${(err as Error).message}) — ` +
          `url preserved in ${join(outDir, "favicon.json")}`;
      }
    }
    const layoutByUid: Record<string, ReturnType<typeof validateLayout>> = {};
    const reportLines: string[] = [];
    for (const p of pages) {
      const pagePresentation = presentation.pages[p.uid];
      if (!pagePresentation) continue;
      const layout = validateLayout(p.specs, pagePresentation);
      layoutByUid[p.uid] = layout;
      reportLines.push(`[${p.uid}] ${formatLayoutReport(layout)}`);
    }
    await writeFile(
      join(outDir, "layout-report.json"),
      JSON.stringify({ pages: layoutByUid }, null, 2) + "\n",
    );
    const totalBands = pages.reduce((n, p) => n + p.bands.length, 0);
    const missing = ir.diagnostics.filter((d) => d.kind === "missing-page-html");
    return {
      output:
        `Converted ${pages.length} pages / ${totalBands} bands → ${outDir} ` +
        `(${plan.documents.length} page documents` +
        (Object.keys(mapConfigs).length
          ? `, map config on ${Object.keys(mapConfigs).join(", ")}`
          : "") +
        ")" +
        (missing.length ? `\nskipped (no html): ${missing.map((d) => d.where).join(", ")}` : "") +
        faviconLine +
        "\n" +
        reportLines.join("\n"),
      code: 0,
    };
  }

  if (action === "catalog") {
    if (!dir) return { output: "blux catalog needs a Blux export directory.", code: 1 };
    let siteJson: unknown;
    try {
      siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
    } catch (err) {
      return { output: `could not read export in ${dir}: ${(err as Error).message}`, code: 1 };
    }
    // Read every site page's index.html (homepage at the export root, the rest
    // at <path>/index.html) exactly like convert, then route every band through
    // the breadth classifier (classifyBand → rich CatalogSpec) and emit a
    // plan-only, sidecar-free migration plan (full field data in the page doc).
    // Feed bands intercept FIRST (spec §7 rule 1): the positional convert-path
    // join `content.pages[p].items[band.index]` names the band's site.json
    // item; one with `sources[]` becomes a blux_collection query-spec slice.
    const feeds =
      (
        siteJson as {
          feeds?: Record<
            string,
            { name?: string; items?: unknown[]; fields?: unknown } | undefined
          >;
        }
      ).feeds ?? {};
    const pageItemsByIndex = (siteJson as { content?: { pages?: { items?: unknown[] }[] } })
      ?.content?.pages;
    // Classify-time diagnostics (positional-join misalignments, unknown/
    // skipped feed sources) ride the plan alongside emit-time ones.
    const classifyDiagnostics: Diagnostic[] = [];
    const pages: { uid: string; title: string; specs: CatalogSpec[] }[] = [];
    for (const [pageIndex, p] of sitePages(siteJson).entries()) {
      const file = p.path ? join(dir, p.path, "index.html") : join(dir, "index.html");
      let html: string;
      try {
        html = await readFile(file, "utf-8");
      } catch {
        continue; // missing page dir (unexported draft) — skip
      }
      // Decision B (plan 4b): when the page html carries the Blux map script,
      // inject the mount predicate so the map band routes to a BluxSection
      // widget (config inlined at emit); pages without one classify as before.
      const mapConfig = extractMapConfig(html);
      const catalogOpts = mapConfig
        ? { isMapMount: makeIsMapMount(mapConfig), mapConfig, diagnostics: classifyDiagnostics }
        : { diagnostics: classifyDiagnostics };
      const pageItems = pageItemsByIndex?.[pageIndex]?.items;
      const specs: CatalogSpec[] = parseGridBands(html).map((b) =>
        bandOrCollection(b, pageItems?.[b.index], feeds, catalogOpts),
      );
      pages.push({ uid: p.uid, title: p.title, specs });
    }
    if (!pages.length) {
      return { output: `could not read any page html in ${dir}`, code: 1 };
    }
    // Skeleton: no IR asset scrape — nested {__asset_id} markers still emit; they
    // resolve at migrate time once the asset index is wired in (Plan 4). Feeds
    // ride the plan: entity documents + extension custom types + record media.
    const plan = buildCatalogPlan(pages, { assets: [], diagnostics: classifyDiagnostics }, feeds);
    const outDir = opts.out ?? join(dir, "blux-out");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "migration-plan.json"), JSON.stringify(plan, null, 2));
    const totalBands = pages.reduce((n, p) => n + p.specs.length, 0);
    return {
      output:
        `Cataloged ${pages.length} pages / ${totalBands} bands → ` +
        `${join(outDir, "migration-plan.json")} (${plan.documents.length} page documents)`,
      code: 0,
    };
  }

  return {
    output: `unknown blux action '${action}'. Use: emit, migrate, validate, grid, convert, catalog.`,
    code: 1,
  };
}
