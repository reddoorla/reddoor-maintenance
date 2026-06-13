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
 *  blank lines. A leading `export ` token is stripped (dotenv does this),
 *  so a hand-edited `export AIRTABLE_PAT=…` parses instead of being dropped.
 *  Quoted values strip the surrounding quotes. A non-blank, non-comment line
 *  that still doesn't parse (no `=`, bad key) is skipped with a one-line
 *  stderr warning naming the line number — this is a credentials file, so a
 *  silent drop turns into a confusing "missing credential" downstream. */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Strip a leading `export ` so `export KEY=value` (a common hand-edit)
    // parses the same as `KEY=value`.
    const line = trimmed.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    const key = eq > 0 ? line.slice(0, eq).trim() : "";
    if (eq <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      console.warn(`credentials: skipping unparseable line ${i + 1}: ${trimmed}`);
      continue;
    }
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
