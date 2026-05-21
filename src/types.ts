export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  meta?: Record<string, unknown>;
};

export type AuditName = "deps" | "lighthouse" | "a11y" | "security" | "lint";

export type RecipeName =
  | "sync-configs"
  | "bump-deps"
  | "svelte-4-to-5"
  | "convert-to-pnpm"
  | "onboard";

export type ConfigName = "lighthouse" | "eslint" | "prettier" | "playwright-a11y" | "svelte";

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
