import { basename } from "node:path";
import type { InventoryProvider, Site } from "../types.js";

export type LocalPathOptions = {
  name?: string;
};

export function localPath(path: string, opts: LocalPathOptions = {}): InventoryProvider {
  const site: Site = { path, name: opts.name ?? basename(path) };
  return async () => [site];
}
