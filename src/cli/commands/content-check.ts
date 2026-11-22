// `reddoor-maint content-check`: warn (or, per site, fail) on NEW hard-coded
// visitor-facing content in a SvelteKit site's src/routes and src/lib (P1-120
// phase 2). The rules are in src/content-check/.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_FILE,
  CONFIG_FILE,
  newFindings,
  readBaseline,
  readConfig,
  scanSite,
  staleCount,
  writeBaselineFile,
} from "../../content-check/check.js";
import type { Finding } from "../../content-check/scan.js";
import {
  STARTER_CONFIG,
  WORKFLOW_PATH,
  contentCheckWorkflow,
} from "../../content-check/workflow.js";
import { resolvePackageVersion } from "../version.js";

export type ContentCheckOptions = {
  cwd?: string;
  writeBaseline?: boolean;
  all?: boolean;
  init?: boolean;
  /** Injected by tests; production reads process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected by tests; production reads this package's own version. */
  version?: string;
};

/** How many findings become GitHub annotations. GitHub shows ten of each
 *  level per step; the rest are in the log, in full. */
const MAX_ANNOTATIONS = 10;

const escapeData = (s: string): string =>
  s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s: string): string => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

const quote = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

export function annotation(f: Finding, level: "warning" | "error"): string {
  return (
    `::${level} file=${escapeProp(f.file)},line=${f.line},title=${escapeProp(`Hard-coded content (${f.kind})`)}::` +
    escapeData(
      `"${quote(f.text)}" is written in code, so an editor cannot change it. ` +
        `Read it from a Prismic field (a code fallback behind the field is fine), ` +
        `or exempt it in ${CONFIG_FILE}.`,
    )
  );
}

export async function runContentCheckCommand(
  opts: ContentCheckOptions = {},
): Promise<{ output: string; code: number }> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  const config = readConfig(cwd);
  const result = await scanSite(cwd, config);
  const lines: string[] = [];
  const notes = (): void => {
    for (const u of result.unparsed) lines.push(`note: not scanned, could not parse ${u}`);
  };

  if (opts.init) {
    const version = opts.version ?? resolvePackageVersion(dirname(fileURLToPath(import.meta.url)));
    const workflow = contentCheckWorkflow(version);
    mkdirSync(join(cwd, dirname(WORKFLOW_PATH)), { recursive: true });
    writeFileSync(join(cwd, WORKFLOW_PATH), workflow);
    lines.push(`wrote ${WORKFLOW_PATH} (pinned to @reddoorla/maintenance@${version})`);
    if (!existsSync(join(cwd, CONFIG_FILE))) {
      writeFileSync(join(cwd, CONFIG_FILE), STARTER_CONFIG);
      lines.push(`wrote ${CONFIG_FILE} (mode: warn)`);
    } else {
      lines.push(`kept ${CONFIG_FILE} (mode: ${config.mode})`);
    }
  }

  if (opts.init || opts.writeBaseline) {
    // Re-running --init re-pins the workflow; it must never re-record the
    // baseline as a side effect, which would absorb every literal added since.
    if (opts.init && !opts.writeBaseline && existsSync(join(cwd, BASELINE_FILE))) {
      readBaseline(cwd); // a broken one is still exit 2
      lines.push(`kept ${BASELINE_FILE} (--write-baseline re-records it)`);
    } else {
      writeBaselineFile(cwd, result.findings);
      lines.push(
        `wrote ${BASELINE_FILE}: ${result.findings.length} literal(s) in ${result.files} file(s) (${result.exempt.length} exempt)`,
      );
    }
    notes();
    return { output: lines.join("\n"), code: 0 };
  }

  const baseline = readBaseline(cwd);
  const shown = opts.all ? result.findings : newFindings(result.findings, baseline);
  const level = config.mode === "fail" ? "error" : "warning";
  const inActions = env.GITHUB_ACTIONS === "true";

  shown.forEach((f, i) => {
    if (inActions && i < MAX_ANNOTATIONS) lines.push(annotation(f, level));
    lines.push(`${level} ${f.file}:${f.line} ${f.kind} "${quote(f.text)}"`);
  });
  notes();

  const stale = staleCount(result.findings, baseline);
  const what = opts.all ? "hard-coded literal(s), baseline ignored" : "NEW hard-coded literal(s)";
  lines.push(
    `content-check: ${shown.length} ${what}; ${result.findings.length} in ${result.files} file(s), ${result.exempt.length} exempt; mode ${config.mode}.`,
  );
  if (stale > 0) {
    lines.push(
      `content-check: ${stale} baseline entr${stale === 1 ? "y is" : "ies are"} no longer in the code; \`reddoor-maint content-check --write-baseline\` shrinks ${BASELINE_FILE}.`,
    );
  }
  const failed = config.mode === "fail" && !opts.all && shown.length > 0;
  return { output: lines.join("\n"), code: failed ? 1 : 0 };
}
