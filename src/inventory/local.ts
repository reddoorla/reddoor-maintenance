import { basename } from "node:path";
import type { InventoryProvider, Site } from "../types.js";

export type LocalPathOptions = {
  name?: string;
};

export function localPath(path: string, opts: LocalPathOptions = {}): InventoryProvider {
  // `||` not `??`: an explicit empty `--name ""` should fall back to the path's
  // basename, not become a blank site name.
  const site: Site = { path, name: opts.name || basename(path) };
  return async () => [site];
}
