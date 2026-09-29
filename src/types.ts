export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  /** GitHub repo identity as `owner/repo`, when known (from the fleet roster). */
  gitRepo?: string;
  /** Deployed/production URL. When set, the lighthouse audit runs against this
   *  URL directly (no checkout, no dev server) instead of a local vite server. */
  deployedUrl?: string;
  /** Netlify site id (the API `id`/`site_id`, e.g. a UUID), when known (from
   *  the fleet roster). The `netlify-deploy` audit needs it to query the Netlify API;
   *  absent → that audit skips. NOT derived from the URL — it's an explicit
   *  identity column on the Websites row. */
  netlifyId?: string;
  /** GA4 NUMERIC property ID from the site row — what the Data API reads, and
   *  not the `G-…` measurement ID that ships in the page. The analytics audit pairs
   *  it against the tag the checkout declares. Three states, and they are not
   *  interchangeable: a string is the row's property; `null` means a row WAS read
   *  and carries none; absent means no row was read at all (a checkout audited by
   *  path), so nothing is known about the property. Like `netlifyId`, an explicit
   *  operator-set column, never derived. */
  ga4PropertyId?: string | null;
  /** The row accepts `no analytics` under Accepted watch conditions (spec D8,
   *  #936): the client runs their own analytics, or none. Read through
   *  `analyticsOptedOut`, the predicate the setup check and the cockpit use, so
   *  an alias cannot mute one and not the other. The analytics audit skips such
   *  a site. Absent = not opted out. */
  analyticsOptedOut?: boolean;
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
  | "form-e2e"
  | "analytics";

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
  | "prismic-ci"
  | "match-harness"
  | "init";

export type ConfigName =
  | "lighthouse"
  | "eslint"
  | "prettier"
  | "prettier-ignore"
  | "playwright-a11y"
  | "svelte"
  | "gitignore"
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
