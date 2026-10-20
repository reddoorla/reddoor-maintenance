// Small helpers shared by the scripts/*.mjs and *.mts CLIs. Plain JS, Node built-ins only,
// so every script that imports it still runs with bare `node scripts/x.mjs` and no build.
// A script that is copied out on its own (prismic-sync-build.mjs, the hooks) must NOT
// import this file: it would arrive without it.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** `p` with symlinks resolved, or `p` itself when it cannot be resolved (it does not exist). */
export function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Whether the module at `importMetaUrl` is the script node was started with. Both sides go
 * through realpath, so a symlinked script (or a symlinked tmpdir) still counts as itself.
 */
export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  return Boolean(argv1) && realOrSelf(argv1) === realOrSelf(fileURLToPath(importMetaUrl));
}

/** The value after `flag`, refusing a missing one or the next `--flag` in its place. */
export function flagValue(v, flag) {
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The env to re-exec under when HTTPS_PROXY is set but Node's fetch is not yet using it
 * (NODE_USE_ENV_PROXY=1), or null when no re-exec is needed.
 */
export function proxyReexecEnv(env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return null;
  return { ...env, NODE_USE_ENV_PROXY: "1" };
}
