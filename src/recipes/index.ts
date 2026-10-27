import type { RecipeName } from "../types.js";
import { syncConfigs, type SyncConfigsOptions } from "./sync-configs.js";
import { bumpDeps, type BumpDepsOptions } from "./bump-deps.js";
import { upgradeSvelte4to5, type UpgradeSvelte4to5Options } from "./svelte-5/index.js";
import { svelteCodemods } from "./svelte-codemods.js";
import { convertToPnpm, type ConvertToPnpmOptions } from "./convert-to-pnpm.js";
import { onboard, type OnboardOptions, type OnboardAudit } from "./onboard.js";
import { a11yFixturesPage } from "./a11y-fixtures-page/index.js";
import {
  init,
  DEFAULT_INIT_STEPS,
  type InitOptions,
  type InitResult,
  type InitStep,
  type InitStepResult,
} from "./init.js";

// Library value exports. Not every recipe is one: health-endpoint, smoke-suite,
// match-harness and analytics-tag are CLI-only (operator decision on #731) — they stay in
// ALL_RECIPE_NAMES and run as `reddoor-maint <name>`, but the CLI commands and
// init.ts import them from their own modules, not from here. smoke-dist requires
// every value export of this barrel to reach dist/index.js, so adding one here
// makes it public API.
export {
  syncConfigs,
  bumpDeps,
  upgradeSvelte4to5,
  svelteCodemods,
  convertToPnpm,
  onboard,
  a11yFixturesPage,
  init,
  DEFAULT_INIT_STEPS,
};
export type {
  SyncConfigsOptions,
  BumpDepsOptions,
  UpgradeSvelte4to5Options,
  ConvertToPnpmOptions,
  OnboardOptions,
  OnboardAudit,
  InitOptions,
  InitResult,
  InitStep,
  InitStepResult,
};

export const ALL_RECIPE_NAMES: RecipeName[] = [
  "sync-configs",
  "bump-deps",
  "svelte-4-to-5",
  "svelte-codemods",
  "convert-to-pnpm",
  "onboard",
  "a11y-fixtures-page",
  "analytics-tag",
  "health-endpoint",
  "smoke-suite",
  "self-updating",
  "prismic-ci",
  "match-harness",
  "init",
];

export function isRecipeName(value: string): value is RecipeName {
  return (ALL_RECIPE_NAMES as string[]).includes(value);
}
