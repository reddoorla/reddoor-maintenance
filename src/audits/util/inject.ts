import type { Site } from "../../types.js";
import type { SpawnFn } from "./spawn.js";
import type { DomainDeps } from "../domain.js";
import type { DiscoverDeps } from "../route-discovery.js";
import type { BrowserRunner, VerifyDeps } from "../browser.js";
import type { FormRunner } from "../form-e2e.js";
import type { NetlifyDeployDeps } from "../netlify-deploy.js";
import type { FunctionHealthDeps } from "../function-health.js";
import type { DependabotDeps } from "../security.js";

export type AuditContext = {
  site: Site;
  spawn?: SpawnFn;
  /** Clock injection (domain + browser + netlify-deploy audits). Defaults to `new Date()`. */
  now?: Date;
  /** DNS/TLS injection for the domain audit (tests). Defaults to real DNS+TLS. */
  domainDeps?: DomainDeps;
  /** Sitemap/homepage fetch injection for the browser audit (tests). Defaults to real fetch. */
  discoverDeps?: DiscoverDeps;
  /** Playwright runner injection for the browser audit (tests). Defaults to real Playwright. */
  browserRunner?: BrowserRunner;
  /** Plain-fetch re-verification injection for the browser audit (tests). Defaults to real fetch.
   *  Re-checks any route the browser probe called unreachable / title-less before a fail verdict
   *  can persist (WAF challenges hit headless browsers, not plain fetches). */
  verifyDeps?: VerifyDeps;
  /** Playwright runner injection for the form-e2e audit (tests). Defaults to real Playwright. */
  formRunner?: FormRunner;
  /** Netlify API injection for the netlify-deploy audit (tests). Defaults to a real API call. */
  netlifyDeployDeps?: NetlifyDeployDeps;
  /** `/health` fetch injection for the function-health audit (tests). Defaults to a real GET. */
  functionHealthDeps?: FunctionHealthDeps;
  /** GitHub Dependabot fetch injection for the security audit (tests). Defaults to a real client
   *  from GITHUB_TOKEN; absent token or no site.gitRepo → the pnpm/npm audit fallback. */
  dependabotDeps?: DependabotDeps;
};
