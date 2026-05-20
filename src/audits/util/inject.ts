import type { Site } from "../../types.js";
import type { SpawnFn } from "./spawn.js";

export type AuditContext = {
  site: Site;
  spawn?: SpawnFn;
};
