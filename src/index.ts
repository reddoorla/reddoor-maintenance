export type {
  Site,
  AuditName,
  AuditResult,
  RecipeName,
  RecipeResult,
  ConfigName,
  InventoryProvider,
} from "./types.js";

export {
  runAudits,
  runAuditsAcross,
  ALL_AUDIT_NAMES,
  depsAudit,
  lintAudit,
  securityAudit,
  lighthouseAudit,
  a11yAudit,
} from "./audits/index.js";

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
  ALL_RECIPE_NAMES,
  isRecipeName,
} from "./recipes/index.js";

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
} from "./recipes/index.js";

export {
  localPath,
  fromJsonFile,
  fromAirtableBase,
  type LocalPathOptions,
  type AirtableInventoryOptions,
} from "./inventory/index.js";

export { draftReportForSite, type DraftOptions, type DraftResult } from "./reports/draft.js";
export { sendApprovedReports, type OrchestrateOptions } from "./reports/send/orchestrate.js";
export { renderReportHtml, type RenderResult } from "./reports/render.js";
export { findDueReports, type DueItem } from "./reports/due.js";
export type { ReportType, LighthouseScores, ReportData, HeaderImage } from "./reports/types.js";

// Exposed so the bundled-assets regression test can invoke the loader in a
// production-equivalent context (would-be consumers go through dist/index.js).
export {
  loadBundledImages,
  CHECK_CID,
  BLURRED_CID,
  type BundledImage,
} from "./reports/maintenance-email/assets/index.js";

// Same reason: lets the dist-resolution regression test exercise the
// `import.meta.url` walk-up from production bundling context. Without
// the export, the test would only verify selfPackageVersion against its
// src/ shape (where vitest evaluates the .ts directly).
export { selfPackageVersion, selfCaretRange } from "./util/self-version.js";
