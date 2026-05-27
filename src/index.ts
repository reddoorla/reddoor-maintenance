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
