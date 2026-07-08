import type { RecipeName } from "../types.js";
import { syncConfigs, type SyncConfigsOptions } from "./sync-configs.js";
import { bumpDeps, type BumpDepsOptions } from "./bump-deps.js";
import { upgradeSvelte4to5, type UpgradeSvelte4to5Options } from "./svelte-5/index.js";
import { svelteCodemods } from "./svelte-codemods.js";
import { convertToPnpm, type ConvertToPnpmOptions } from "./convert-to-pnpm.js";
import { onboard, type OnboardOptions, type OnboardAudit } from "./onboard.js";
import { a11yFixturesPage } from "./a11y-fixtures-page/index.js";
import { healthEndpoint } from "./health-endpoint/index.js";
import { smokeSuite } from "./smoke-suite/index.js";
import {
  init,
  DEFAULT_INIT_STEPS,
  type InitOptions,
  type InitResult,
  type InitStep,
  type InitStepResult,
} from "./init.js";

export {
  syncConfigs,
  bumpDeps,
  upgradeSvelte4to5,
  svelteCodemods,
  convertToPnpm,
  onboard,
  a11yFixturesPage,
  healthEndpoint,
  smokeSuite,
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
  "health-endpoint",
  "smoke-suite",
  "self-updating",
  "init",
];

export function isRecipeName(value: string): value is RecipeName {
  return (ALL_RECIPE_NAMES as string[]).includes(value);
}
