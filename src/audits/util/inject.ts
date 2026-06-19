import type { Site } from "../../types.js";
import type { SpawnFn } from "./spawn.js";
import type { DomainDeps } from "../domain.js";

export type AuditContext = {
  site: Site;
  spawn?: SpawnFn;
  /** Clock injection (domain audit). Defaults to `new Date()`. */
  now?: Date;
  /** DNS/TLS injection for the domain audit (tests). Defaults to real DNS+TLS. */
  domainDeps?: DomainDeps;
};
