import { readFile, stat } from "node:fs/promises";

/** True when `path` names something that exists (a file or a directory; a
 *  symlink counts only when its target exists). Any error, a permission one
 *  included, reads as "no". */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The file's UTF-8 text, or null when it cannot be read for any reason. */
export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** The file parsed as JSON, or null when it cannot be read or does not parse.
 *  The cast is unchecked: the caller vouches for the shape. */
export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
