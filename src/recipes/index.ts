import type { RecipeName } from "../types.js";
import { syncConfigs, type SyncConfigsOptions } from "./sync-configs.js";
import { bumpDeps, type BumpDepsOptions } from "./bump-deps.js";
import { upgradeSvelte4to5, type UpgradeSvelte4to5Options } from "./svelte-5/index.js";
import { convertToPnpm, type ConvertToPnpmOptions } from "./convert-to-pnpm.js";

export { syncConfigs, bumpDeps, upgradeSvelte4to5, convertToPnpm };
export type { SyncConfigsOptions, BumpDepsOptions, UpgradeSvelte4to5Options, ConvertToPnpmOptions };

export const ALL_RECIPE_NAMES: RecipeName[] = [
  "sync-configs",
  "bump-deps",
  "svelte-4-to-5",
  "convert-to-pnpm",
];

export function isRecipeName(value: string): value is RecipeName {
  return (ALL_RECIPE_NAMES as string[]).includes(value);
}
