export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  /** GitHub repo identity as `owner/repo`, when known (from Airtable). */
  gitRepo?: string;
  /** Deployed/production URL. When set, the lighthouse audit runs against this
   *  URL directly (no checkout, no dev server) instead of a local vite server. */
  deployedUrl?: string;
  meta?: Record<string, unknown>;
};

export type AuditName = "deps" | "lighthouse" | "a11y" | "security" | "lint" | "domain" | "browser";

export type RecipeName =
  | "sync-configs"
  | "bump-deps"
  | "svelte-4-to-5"
  | "svelte-codemods"
  | "convert-to-pnpm"
  | "onboard"
  | "a11y-fixtures-page"
  | "self-updating"
  | "init";

export type ConfigName =
  | "lighthouse"
  | "eslint"
  | "prettier"
  | "prettier-ignore"
  | "playwright-a11y"
  | "svelte"
  | "gitignore"
  | "ci"
  | "renovate-action"
  | "renovate-config"
  | "netlify";

export type AuditResult = {
  audit: AuditName;
  site: string;
  status: "pass" | "warn" | "fail" | "skip";
  summary: string;
  details?: unknown;
};

export type RecipeResult = {
  recipe: RecipeName;
  site: string;
  status: "applied" | "noop" | "failed";
  commits: string[];
  notes?: string;
};

export type InventoryProvider = () => Promise<Site[]>;
