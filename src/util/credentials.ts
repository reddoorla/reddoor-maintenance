import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve the canonical credentials file path. Respects $XDG_CONFIG_HOME
 *  (Linux/macOS convention) and falls back to ~/.config/reddoor-maint/. */
export function defaultCredentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "reddoor-maint", "credentials.env");
}

/** Parse a tiny subset of dotenv: `KEY=value` per line, `# comments`,
 *  blank lines. Quoted values strip the surrounding quotes. Unknown
 *  shapes (no `=`, leading whitespace before `=`, etc.) are skipped
 *  silently — this is a credentials file, not a config language. */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load credentials from `path` (default: canonical file) into `process.env`.
 *  `process.env` values win — file-defined keys are only applied when the
 *  env var is currently undefined. Missing/unreadable file is a silent
 *  no-op; commands that need the credentials will fail downstream with
 *  their own clear error. Returns the keys actually applied (diagnostics). */
export function loadCredentialsIntoEnv(path: string = defaultCredentialsPath()): string[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const parsed = parseEnvFile(contents);
  const applied: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      applied.push(k);
    }
  }
  return applied;
}
