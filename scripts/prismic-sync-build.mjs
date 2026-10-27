#!/usr/bin/env node
// The one place the D1 pull-sync runs a site's own code: its install, its
// prettier and its `prismic` CLI. fleet-prismic-sync.yml runs this file inside
// `docker run --rm`, in a job that holds no secret, so nothing the site's code
// does can reach a token, and anything it leaves running dies with the
// container. It imports nothing but node built-ins, because it runs from a
// bare copy with no node_modules of its own.
//
// It never decides anything. It extracts the site's tree, runs the three
// steps, and copies out only the files the spec names, as regular files. The
// publish job, which holds the write token and runs no site code, treats
// everything here as untrusted: it checks every model against Prismic's own
// copy and builds the commit itself.
//
// It exits 0 whatever the site does, and says what happened in result.json, so
// one broken site never stops the others.
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9._@-]+$/;

/** A relative path the spec may name: plain segments, no `..`, no absolute. */
export function safeRelative(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/")) return false;
  const segments = path.split(posix.sep);
  return segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const keep = (d) => {
      stderr = (stderr + d).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stderr: String(e.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function isFile(p) {
  try {
    return (await lstat(p)).isFile();
  } catch {
    return false;
  }
}

/** The real steps, as the container runs them. */
export const realSteps = {
  async extract(tarFile, work) {
    await mkdir(work, { recursive: true });
    const r = await run("tar", ["-xf", tarFile, "-C", work], work, 300_000);
    if (r.code !== 0) throw new Error(`tar failed (${r.code}): ${r.stderr.trim()}`);
  },
  async install(work) {
    if (!(await isFile(join(work, "package.json")))) return;
    const r = await run(
      "corepack",
      ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"],
      work,
      600_000,
    );
    if (r.code !== 0) throw new Error(`pnpm install failed (${r.code}): ${r.stderr.trim()}`);
  },
  async format(work, paths) {
    const bin = join(work, "node_modules", ".bin", "prettier");
    if (!(await lstat(bin).catch(() => null))) return false;
    const r = await run(bin, ["--write", "--", ...paths], work, 120_000);
    return r.code === 0;
  },
  async codegen(work) {
    const bin = join(work, "node_modules", ".bin", "prismic");
    if (!(await lstat(bin).catch(() => null))) {
      throw new Error(
        "this site has prismic.config.json but no prismic CLI in node_modules, so its generated files cannot be regenerated",
      );
    }
    for (const args of [
      ["gen", "types"],
      ["gen", "slice-index"],
    ]) {
      const r = await run(bin, args, work, 180_000);
      if (r.code !== 0) {
        throw new Error(`prismic ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
      }
    }
  },
};

/**
 * Build one site: `inDir` holds the fetch job's `tree.tar` and `spec.json`
 * ({ models: string[], generated: string[], migrated: boolean }). Writes the
 * named files that exist, as regular files, under `outDir`, and `result.json`.
 */
export async function buildSite({ inDir, outDir, work, steps = realSteps }) {
  await mkdir(outDir, { recursive: true });
  const result = { ok: false, formatted: false, error: null };
  try {
    const spec = JSON.parse(await readFile(join(inDir, "spec.json"), "utf-8"));
    const models = Array.isArray(spec.models) ? spec.models.filter(safeRelative) : [];
    const generated = Array.isArray(spec.generated) ? spec.generated.filter(safeRelative) : [];
    if (models.length === 0) throw new Error("the spec names no model files");
    await steps.extract(join(inDir, "tree.tar"), work);
    await steps.install(work);
    result.formatted = (await steps.format(work, models)) === true;
    if (spec.migrated === true) await steps.codegen(work);
    for (const rel of [...models, ...generated]) {
      const from = join(work, rel);
      const st = await lstat(from).catch(() => null);
      if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) continue;
      await mkdir(dirname(join(outDir, "files", rel)), { recursive: true });
      await copyFile(from, join(outDir, "files", rel));
    }
    result.ok = true;
  } catch (e) {
    result.error = String(e instanceof Error ? e.message : e).slice(-2000);
  }
  await writeFile(join(outDir, "result.json"), JSON.stringify(result) + "\n", "utf-8");
  return result;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const inDir = arg("--in");
  const outDir = arg("--out");
  const work = arg("--work");
  if (!inDir || !outDir || !work) {
    console.error("usage: prismic-sync-build.mjs --in <dir> --out <dir> --work <dir>");
    process.exit(2);
  }
  const result = await buildSite({ inDir, outDir, work });
  console.log(result.ok ? "built" : `not built: ${result.error}`);
}
