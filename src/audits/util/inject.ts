import type { Site } from "../../types.js";
import type { SpawnFn } from "./spawn.js";
import type { DomainDeps } from "../domain.js";
import type { DiscoverDeps } from "../route-discovery.js";
import type { BrowserRunner } from "../browser.js";
import type { NetlifyDeployDeps } from "../netlify-deploy.js";

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
  /** Netlify API injection for the netlify-deploy audit (tests). Defaults to a real API call. */
  netlifyDeployDeps?: NetlifyDeployDeps;
};
