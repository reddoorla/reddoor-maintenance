export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  /** GitHub repo identity as `owner/repo`, when known (from Airtable). */
  gitRepo?: string;
  /** Deployed/production URL. When set, the lighthouse audit runs against this
   *  URL directly (no checkout, no dev server) instead of a local vite server. */
  deployedUrl?: string;
  /** Netlify site id (the API `id`/`site_id`, e.g. a UUID), when known (from
   *  Airtable). The `netlify-deploy` audit needs it to query the Netlify API;
   *  absent → that audit skips. NOT derived from the URL — it's an explicit
   *  identity column on the Websites row. */
  netlifyId?: string;
  meta?: Record<string, unknown>;
};

export type AuditName =
  | "deps"
  | "lighthouse"
  | "a11y"
  | "security"
  | "lint"
  | "domain"
  | "browser"
  | "netlify-deploy"
  | "function-health"
  | "smoke"
  | "form-e2e";

export type RecipeName =
  | "sync-configs"
  | "bump-deps"
  | "svelte-4-to-5"
  | "svelte-codemods"
  | "convert-to-pnpm"
  | "onboard"
  | "a11y-fixtures-page"
  | "health-endpoint"
  | "smoke-suite"
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
